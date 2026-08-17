import { config } from "dotenv";

import { DrizzleDocumentConversionRepository, DrizzleTaskRunRepository, createDatabase } from "@alchemy-video/persistence";
import { createS3StoragePort } from "@alchemy-video/storage-client";
import { BullMqDocumentConversionQueue, createBullMqDocumentConversionWorker } from "@alchemy-video/task-queue";

import { DocumentConversionExecutor } from "./execution-service.js";
import { HttpDocumentRuntimeClient, validateDocumentRuntimeUrl } from "./runtime-client.js";
import { DocumentConversionEventConsumer, DocumentOutboxRelay } from "./service.js";

config({ path: ".env.local" });
config();

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const runtimeUrl = process.env.DOCUMENT_RUNTIME_URL;
const runtimeToken = process.env.DOCUMENT_RUNTIME_TOKEN;
if (!databaseUrl || !redisUrl || !runtimeUrl || !runtimeToken) {
  throw new Error("DATABASE_URL, REDIS_URL, DOCUMENT_RUNTIME_URL, and DOCUMENT_RUNTIME_TOKEN are required for the C10 Document Worker.");
}
const validatedRuntimeUrl = validateDocumentRuntimeUrl(runtimeUrl);
const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the C10 Document Worker.");
}

const workerId = process.env.DOCUMENT_WORKER_ID ?? `document-worker-${process.pid}`;
const database = createDatabase(databaseUrl);
const documentStore = new DrizzleDocumentConversionRepository(database.db);
const outboxStore = new DrizzleTaskRunRepository(database.db);
const storage = createS3StoragePort({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
});
const executor = new DocumentConversionExecutor(
  documentStore,
  storage,
  new HttpDocumentRuntimeClient({ runtimeUrl: validatedRuntimeUrl, token: runtimeToken }),
);
const queueName = process.env.DOCUMENT_CONVERSION_QUEUE_NAME;
const deadLetterQueueName = process.env.DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME;
const queue = new BullMqDocumentConversionQueue(redisUrl, { ...(queueName ? { queueName } : {}) });
const relay = new DocumentOutboxRelay(outboxStore, queue, {
  relayId: `${workerId}:relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 5,
  batchSize: 25,
});
const consumer = new DocumentConversionEventConsumer(documentStore, executor, {
  consumerName: "document-conversion-transition",
  workerId,
  leaseMs: 30_000,
});
const worker = createBullMqDocumentConversionWorker({
  redisUrl,
  autoStart: false,
  ...(queueName ? { queueName } : {}),
  ...(deadLetterQueueName ? { deadLetterQueueName } : {}),
  processor: async (message) => {
    await consumer.process(message);
  },
  onTerminalFailure: async ({ event_id, workspace_id, reason }) => {
    await consumer.deadLetter({ eventId: event_id, workspaceId: workspace_id, reason });
  },
});

await worker.waitUntilReady();
const recovery = await executor.recover({ limit: 100 });
worker.start();
const relayTimer = setInterval(() => {
  void relay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "document_outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
await relay.runOnce();
console.info(JSON.stringify({ event: "document_worker.ready", worker_id: workerId, recovered: recovery.length }));

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
