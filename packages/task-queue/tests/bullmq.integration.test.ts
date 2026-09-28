import assert from "node:assert/strict";
import test from "node:test";

import {
  BullMqCreativePlanningQueue,
  BullMqInternalEventQueue,
  clearCreativePlanningQueues,
  clearInternalEventQueues,
  createBullMqCreativePlanningWorker,
  createBullMqInternalEventWorker,
  type DeadLetterQueueJob,
} from "../src/index.js";
import {
  InternalCreativePlanningQueueMessageSchema,
  InternalTaskRunQueueMessageSchema,
  type InternalCreativePlanningQueueMessage,
  type InternalTaskRunQueueMessage,
} from "@alchemy-video/contracts";

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

class PlanningQueueFailure extends Error {
  constructor(
    readonly retryable: boolean,
    readonly safeReason: string,
  ) {
    super("private planning failure detail");
    this.name = "PlanningQueueFailure";
  }
}

const creativePlanningMessage = (suffix: string): InternalCreativePlanningQueueMessage =>
  InternalCreativePlanningQueueMessageSchema.parse({
    contract_version: "1.0",
    event_id: `evt_c11_queue_${suffix}`,
    workspace_id: `ws_c11_queue_${suffix}`,
    project_id: `prj_c11_queue_${suffix}`,
    creative_brief_revision_id: `cbr_c11_queue_${suffix}`,
    correlation_id: `cor_c11_queue_${suffix}`,
  });

const exerciseCreativePlanningFailure = async (input: {
  retryable: boolean;
  expectedAttempts: number;
  safeReason: string;
}) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queueName = `alchemy-video-c11-queue-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const message = creativePlanningMessage(suffix);
  let attempts = 0;
  let terminalCalls = 0;
  let terminal: Record<string, unknown> | undefined;
  const queue = new BullMqCreativePlanningQueue(redisUrl, { queueName });
  const worker = createBullMqCreativePlanningWorker({
    redisUrl,
    queueName,
    deadLetterQueueName,
    processor: async () => {
      attempts += 1;
      throw new PlanningQueueFailure(input.retryable, input.safeReason);
    },
    isRetryableFailure: (error) => error instanceof PlanningQueueFailure && error.retryable,
    onTerminalFailure: async (failure) => {
      terminalCalls += 1;
      terminal = failure as unknown as Record<string, unknown>;
    },
  });
  try {
    await worker.waitUntilReady();
    await queue.enqueue(message);
    await waitFor(() => terminal !== undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(attempts, input.expectedAttempts);
    assert.equal(terminalCalls, 1);
    assert.equal(terminal?.attempts, input.expectedAttempts);
    assert.equal(terminal?.reason, input.safeReason);
    assert.equal(terminal?.event_id, message.event_id);
  } finally {
    await worker.close();
    await queue.close();
    await clearCreativePlanningQueues({ redisUrl, queueName, deadLetterQueueName });
  }
};

test("Creative planning queue retries a retryable director failure three real times", {
  skip: !process.env.REDIS_URL,
}, async () => {
  await exerciseCreativePlanningFailure({
    retryable: true,
    expectedAttempts: 3,
    safeReason: "DIRECTOR_TIMEOUT",
  });
});

test("Creative planning queue terminates a deterministic failure after one delivery", {
  skip: !process.env.REDIS_URL,
}, async () => {
  await exerciseCreativePlanningFailure({
    retryable: false,
    expectedAttempts: 1,
    safeReason: "SEMANTIC_DECISION_MALFORMED",
  });
});
