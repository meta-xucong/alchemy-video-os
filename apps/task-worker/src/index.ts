import { config } from "dotenv";

import { createDatabase, DrizzleTaskRunRepository } from "@alchemy-video/persistence";
import { BullMqInternalEventQueue, createBullMqInternalEventWorker } from "@alchemy-video/task-queue";

import { OutboxRelay, TaskRunEventConsumer } from "./service.js";

config({ path: ".env.local" });
config();

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error("DATABASE_URL and REDIS_URL are required for the C05 task worker.");
}

const workerId = process.env.TASK_WORKER_ID ?? `task-worker-${process.pid}`;
const database = createDatabase(databaseUrl);
const store = new DrizzleTaskRunRepository(database.db);
const queue = new BullMqInternalEventQueue(redisUrl);
const relay = new OutboxRelay(store, queue, {
  relayId: `${workerId}:relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 5,
  batchSize: 25,
});
const consumer = new TaskRunEventConsumer(store, {
  consumerName: "task-run-transition",
  workerId,
  leaseMs: 30_000,
});
const worker = createBullMqInternalEventWorker({
  redisUrl,
  processor: async (message) => {
    await consumer.process(message);
  },
  onTerminalFailure: async ({ event_id, workspace_id, reason }) => {
    await consumer.deadLetter({ event_id, workspace_id, reason });
  },
});

await worker.waitUntilReady();
const relayTimer = setInterval(() => {
  void relay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
await relay.runOnce();
console.info(JSON.stringify({ event: "task_worker.ready", worker_id: workerId }));

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
