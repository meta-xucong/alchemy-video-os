import { createDatabase, DrizzleProductionRepository } from "@alchemy-video/persistence";
import { BullMqMediaRuntimeQueue, BullMqProductionQueue, createBullMqMediaRuntimeWorker, createBullMqProductionWorker } from "@alchemy-video/task-queue";
import { createS3StoragePort } from "@alchemy-video/storage-client";

import { MediaRuntimeEventConsumer, MediaRuntimeOutboxRelay } from "./media-service.js";
import { HttpMediaRuntimeClient } from "./media-runtime-client.js";
import { ProductionEventConsumer, ProductionOutboxRelay } from "./service.js";
import { createProductionTaskRunInputSnapshotFactory } from "./video-input-snapshot.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error("DATABASE_URL and REDIS_URL are required for the C12 Production Worker.");
}

const workerId = process.env.PRODUCTION_WORKER_ID ?? `production-worker-${process.pid}`;
const database = createDatabase(databaseUrl);
const store = new DrizzleProductionRepository(
  database.db,
  createProductionTaskRunInputSnapshotFactory(process.env.VIDEO_PROVIDER),
);
const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the C12 Production Worker.");
}
const mediaRuntimeUrl = process.env.MEDIA_RUNTIME_URL;
const mediaRuntimeToken = process.env.MEDIA_RUNTIME_TOKEN;
if (!mediaRuntimeUrl || !mediaRuntimeToken) {
  throw new Error("MEDIA_RUNTIME_URL and MEDIA_RUNTIME_TOKEN are required for the C12 Production Worker.");
}
const storage = createS3StoragePort({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
});
const mediaRuntime = new HttpMediaRuntimeClient({ runtimeUrl: mediaRuntimeUrl, token: mediaRuntimeToken });
const queueName = process.env.PRODUCTION_QUEUE_NAME;
const deadLetterQueueName = process.env.PRODUCTION_DEAD_LETTER_QUEUE_NAME;
const queue = new BullMqProductionQueue(redisUrl, { ...(queueName ? { queueName } : {}) });
const mediaQueueName = process.env.MEDIA_RUNTIME_QUEUE_NAME;
const mediaDeadLetterQueueName = process.env.MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME;
const mediaQueue = new BullMqMediaRuntimeQueue(redisUrl, { ...(mediaQueueName ? { queueName: mediaQueueName } : {}) });
const relay = new ProductionOutboxRelay(store, queue, {
  relayId: `${workerId}:relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 3,
  batchSize: 25,
});
const consumer = new ProductionEventConsumer(store, {
  consumerName: "production-transition",
  workerId,
  leaseMs: 30_000,
});
const mediaRelay = new MediaRuntimeOutboxRelay(store, mediaQueue, {
  relayId: `${workerId}:media-relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 3,
  batchSize: 25,
});
const mediaConsumer = new MediaRuntimeEventConsumer(store, storage, mediaRuntime, {
  consumerName: "media-runtime-transition",
  workerId,
  leaseMs: 30_000,
});
const worker = createBullMqProductionWorker({
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
const mediaWorker = createBullMqMediaRuntimeWorker({
  redisUrl,
  autoStart: false,
  ...(mediaQueueName ? { queueName: mediaQueueName } : {}),
  ...(mediaDeadLetterQueueName ? { deadLetterQueueName: mediaDeadLetterQueueName } : {}),
  processor: async (message) => {
    await mediaConsumer.process(message);
  },
  onTerminalFailure: async ({ event_id, workspace_id, reason }) => {
    await mediaConsumer.deadLetter({ eventId: event_id, workspaceId: workspace_id, reason });
  },
});

await Promise.all([worker.waitUntilReady(), mediaWorker.waitUntilReady()]);
worker.start();
mediaWorker.start();
const relayTimer = setInterval(() => {
  void relay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "production_outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
  void mediaRelay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "media_runtime_outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
await Promise.all([relay.runOnce(), mediaRelay.runOnce()]);
console.info(JSON.stringify({ event: "production_worker.ready", worker_id: workerId }));

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayTimer);
  await Promise.all([worker.close(), mediaWorker.close()]);
  await Promise.all([queue.close(), mediaQueue.close()]);
  await database.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
