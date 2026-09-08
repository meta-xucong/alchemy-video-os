import { createDatabase, DrizzleAssetWorkspaceRepository, DrizzleBillingRepository, DrizzleTaskRunRepository } from "@alchemy-video/persistence";
import { HttpVeyraCreditTransport, VeyraSub2ApiCreditAdapter } from "@alchemy-video/credit-veyra";
import { BullMqInternalEventQueue, createBullMqInternalEventWorker } from "@alchemy-video/task-queue";
import { createS3StoragePort } from "@alchemy-video/storage-client";

import { MockVideoTaskExecutor } from "./execution-service.js";
import { createWorkerVideoProviderRuntime } from "./provider-runtime.js";
import { createWorkerReferenceDeliveryPort } from "./reference-delivery.js";
import { VideoBillingExecutor } from "./billing-executor.js";
import { OutboxRelay, TaskRunEventConsumer, recoverC06TaskRuns } from "./service.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error("DATABASE_URL and REDIS_URL are required for the C05 task worker.");
}

const workerId = process.env.TASK_WORKER_ID ?? `task-worker-${process.pid}`;
const database = createDatabase(databaseUrl);
const store = new DrizzleTaskRunRepository(database.db);
const assetStore = new DrizzleAssetWorkspaceRepository(database.db);
const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the C06 Worker.");
}
const storage = createS3StoragePort({ endpoint: process.env.S3_ENDPOINT!, region: process.env.S3_REGION!, bucket: process.env.S3_BUCKET!, accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! });
class BillingStoreAdapter {
  constructor(private readonly receipts: DrizzleBillingRepository, private readonly tasks: DrizzleTaskRunRepository) {}
  recordUsageReceipt(input: Parameters<DrizzleBillingRepository["recordUsageReceipt"]>[0]) { return this.receipts.recordUsageReceipt(input); }
  markBillingSucceeded(input: Parameters<DrizzleTaskRunRepository["markBillingSucceeded"]>[0]) { return this.tasks.markBillingSucceeded(input); }
  markBillingFailed(input: Parameters<DrizzleTaskRunRepository["markBillingFailed"]>[0]) { return this.tasks.markBillingFailed(input); }
  scheduleBillingRetry(input: Parameters<DrizzleTaskRunRepository["scheduleBillingRetry"]>[0]) { return this.tasks.scheduleBillingRetry(input); }
}
let billingExecutor: VideoBillingExecutor | undefined;
if (process.env.VEYRA_AUTH_ENABLED === "true") {
  const baseUrl = process.env.VIDEO_VEYRA_INTERNAL_BASE_URL;
  const internalToken = process.env.VIDEO_VEYRA_INTERNAL_TOKEN;
  if (!baseUrl || !internalToken) throw new Error("VIDEO_VEYRA_INTERNAL_BASE_URL and VIDEO_VEYRA_INTERNAL_TOKEN are required when VEYRA_AUTH_ENABLED=true.");
  const transport = new HttpVeyraCreditTransport({ baseUrl });
  billingExecutor = new VideoBillingExecutor(new VeyraSub2ApiCreditAdapter({ transport, internalToken }), new BillingStoreAdapter(new DrizzleBillingRepository(database.db), store));
}
const runtime = await createWorkerVideoProviderRuntime({ environment: process.env });
const executor = new MockVideoTaskExecutor(store, runtime.provider, storage, {
  providerName: runtime.profile.provider,
  expectedModel: runtime.profile.model,
  pollIntervalMs: runtime.profile.pollIntervalMs,
  maxPollAttempts: runtime.profile.maxPollAttempts,
  retryableStatusPolls: runtime.profile.mode === "sub2api" ? 4 : 0,
  assetStore,
  referenceDelivery: createWorkerReferenceDeliveryPort({ profile: runtime.profile, environment: process.env }),
  allowLegacyReferenceAssets: runtime.profile.mode === "mock",
  ...(billingExecutor ? { billingExecutor } : {}),
});
const queueName = process.env.TASK_QUEUE_NAME;
const deadLetterQueueName = process.env.TASK_DEAD_LETTER_QUEUE_NAME;
const queue = new BullMqInternalEventQueue(redisUrl, { ...(queueName ? { queueName } : {}) });
const relay = new OutboxRelay(store, queue, {
  relayId: `${workerId}:relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 5,
  batchSize: 25,
  eventTypes: ["task_run.queued"],
});
const consumer = new TaskRunEventConsumer(store, {
  consumerName: "task-run-transition",
  workerId,
  leaseMs: 30_000,
}, executor);
const worker = createBullMqInternalEventWorker({
  redisUrl,
  autoStart: false,
  ...(queueName ? { queueName } : {}),
  ...(deadLetterQueueName ? { deadLetterQueueName } : {}),
  processor: async (message) => {
    try {
      await consumer.process(message);
    } catch (error) {
      console.error(JSON.stringify({
        event: "task_worker.execution.failed",
        event_id: message.event_id,
        workspace_id: message.workspace_id,
        task_run_id: message.task_run_id,
        reason: error instanceof Error ? error.message.replace(/[\\r\\n]+/g, " ").slice(0, 500) : String(error),
      }));
      throw error;
    }
  },
  onTerminalFailure: async ({ event_id, workspace_id, task_run_id, reason }) => {
    await consumer.finalizeExecutionFailure({ workspace_id, task_run_id, reason });
    await consumer.deadLetter({ event_id, workspace_id, reason });
  },
});

await worker.waitUntilReady();
const recovery = await recoverC06TaskRuns(executor, {
  onFailure: ({ workspaceId, taskRunId, reason }) => {
    console.error(JSON.stringify({
      event: "task_worker.recovery.failed",
      workspace_id: workspaceId,
      task_run_id: taskRunId,
      reason,
    }));
  },
  finalizeFailure: ({ workspaceId, taskRunId, reason }) =>
    consumer.finalizeExecutionFailure({ workspace_id: workspaceId, task_run_id: taskRunId, reason }),
});
console.info(JSON.stringify({
  event: "task_worker.recovery.completed",
  recovered: recovery.filter((result) => !result.failure).length,
  failed: recovery.filter((result) => result.failure).length,
}));
worker.start();
const relayTimer = setInterval(() => {
  void relay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
await relay.runOnce();
console.info(JSON.stringify({ event: "task_worker.ready", worker_id: workerId, provider_mode: runtime.profile.mode, provider_model: runtime.profile.model }));

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayTimer);
  await worker.close();
  await queue.close();
  await database.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
