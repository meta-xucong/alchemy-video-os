import assert from "node:assert/strict";
import test from "node:test";

import {
  BullMqInternalEventQueue,
  clearInternalEventQueues,
  createBullMqInternalEventWorker,
  type DeadLetterQueueJob,
} from "../src/index.js";
import { InternalTaskRunQueueMessageSchema, type InternalTaskRunQueueMessage } from "@alchemy-video/contracts";

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for BullMQ terminal delivery.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

test("BullMQ retries a durable internal event and sends the final failure to the dead-letter handler", { skip: !process.env.REDIS_URL }, async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queueName = `alchemy-video-c05-queue-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const eventId = `evt_c05_queue_${suffix}`;
  const workspaceId = `ws_c05_queue_${suffix}`;
  const taskRunId = `tsk_c05_queue_${suffix}`;
  const message: InternalTaskRunQueueMessage = InternalTaskRunQueueMessageSchema.parse({
    contract_version: "1.0",
    event_id: eventId,
    workspace_id: workspaceId,
    task_run_id: taskRunId,
    attempt_no: 1,
    correlation_id: `cor_c05_queue_${suffix}`,
    input_snapshot: { model: "c05-queue-test", prompt: "frozen queue snapshot" },
  });
  let attempts = 0;
  let terminal: DeadLetterQueueJob | undefined;
  const queue = new BullMqInternalEventQueue(redisUrl, { queueName });
  const worker = createBullMqInternalEventWorker({
    redisUrl,
    queueName,
    deadLetterQueueName,
    processor: async () => {
      attempts += 1;
      throw new Error("controlled retryable delivery failure");
    },
    onTerminalFailure: async (input) => {
      terminal = input;
    },
  });

  try {
    await worker.waitUntilReady();
    await queue.enqueue(message);
    await waitFor(() => terminal !== undefined);
    assert.equal(attempts, 3);
    assert.deepEqual(terminal, {
    event_id: eventId,
    workspace_id: workspaceId,
    task_run_id: taskRunId,
    attempts: 3,
      reason: "controlled retryable delivery failure",
    });
  } finally {
    await worker.close();
    await queue.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
  }
});
