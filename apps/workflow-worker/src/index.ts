import { DeterministicPlanningModel, DeterministicStoryboardCompiler } from "@alchemy-video/creative-planning";
import { resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";
import { DrizzleCreativePlanningRepository, createDatabase } from "@alchemy-video/persistence";
import { BullMqCreativePlanningQueue, createBullMqCreativePlanningWorker } from "@alchemy-video/task-queue";
import { createS3StoragePort } from "@alchemy-video/storage-client";

import { BoundedDocumentContextReader } from "./document-context-reader.js";
import { CreativePlanningExecutor, resolvePlanningDurationPolicy } from "./execution-service.js";
import { CreativePlanningEventConsumer, CreativePlanningOutboxRelay } from "./service.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error("DATABASE_URL and REDIS_URL are required for the C11 Workflow Worker.");
}

const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the C11.1 Workflow Worker.");
}

const workerId = process.env.WORKFLOW_WORKER_ID ?? `workflow-worker-${process.pid}`;
const database = createDatabase(databaseUrl);
const planningStore = new DrizzleCreativePlanningRepository(database.db);
const storage = createS3StoragePort({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
});
const runtimeProfile = resolveVideoProviderRuntimeProfile(process.env.VIDEO_PROVIDER);
const durationPolicy = resolvePlanningDurationPolicy(runtimeProfile);
const executor = new CreativePlanningExecutor(
  planningStore,
  new DeterministicPlanningModel(),
  new DeterministicStoryboardCompiler(),
  new BoundedDocumentContextReader(storage),
  undefined,
  runtimeProfile.audioOwner,
  durationPolicy,
);
const queueName = process.env.CREATIVE_PLANNING_QUEUE_NAME;
const deadLetterQueueName = process.env.CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME;
const queue = new BullMqCreativePlanningQueue(redisUrl, { ...(queueName ? { queueName } : {}) });
const relay = new CreativePlanningOutboxRelay(planningStore, queue, {
  relayId: `${workerId}:relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 3,
  batchSize: 25,
});
const consumer = new CreativePlanningEventConsumer(planningStore, executor, {
  consumerName: "creative-planning-transition",
  workerId,
  leaseMs: 30_000,
});
const worker = createBullMqCreativePlanningWorker({
  redisUrl,
  autoStart: false,
  ...(queueName ? { queueName } : {}),
  ...(deadLetterQueueName ? { deadLetterQueueName } : {}),
  processor: async (message) => {
    await consumer.process(message);
  },
  onTerminalFailure: async ({ event_id, workspace_id, creative_brief_revision_id, reason }) => {
    await consumer.deadLetter({ eventId: event_id, workspaceId: workspace_id, creativeBriefRevisionId: creative_brief_revision_id, reason });
  },
});

await worker.waitUntilReady();
worker.start();
const relayTimer = setInterval(() => {
  void relay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "creative_planning_outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
await relay.runOnce();
console.info(JSON.stringify({ event: "workflow_worker.ready", worker_id: workerId }));

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
