import assert from "node:assert/strict";
import test from "node:test";
import { Queue } from "bullmq";

import {
  BullMqCreativePlanningQueue,
  BullMqInternalEventQueue,
  clearCreativePlanningQueues,
  clearInternalEventQueues,
  createBullMqCreativePlanningWorker,
  createBullMqInternalEventWorker,
  InternalEventRequiresRecoveryError,
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

test("BullMQ deferred terminal failure is finalized even when processor is bypassed, and a busy finalizer retains the durable job", { skip: !process.env.REDIS_URL, timeout: 15_000 }, async () => {
  const redisUrl = process.env.REDIS_URL!;
  const parsed = new URL(redisUrl);
  const queueName = `closure-stalled-${Date.now()}`;
  const deadLetterQueueName = `${queueName}-dead`;
  const source = new Queue(queueName, { connection: { host: parsed.hostname, port: Number(parsed.port || 6379) } });
  const dead = new Queue(deadLetterQueueName, { connection: { host: parsed.hostname, port: Number(parsed.port || 6379) } });
  const message = InternalTaskRunQueueMessageSchema.parse({ contract_version: "1.0", event_id: `evt_${queueName}`, workspace_id: `ws_${queueName}`, task_run_id: `tsk_${queueName}`, attempt_no: 1, correlation_id: `cor_${queueName}`, input_snapshot: {} });
  let processors = 0;
  let finalizers = 0;
  let complete = false;
  const worker = createBullMqInternalEventWorker({ redisUrl, queueName, deadLetterQueueName, autoStart: false,
    processor: async () => { processors += 1; throw new Error("Controlled recoverable execution failure."); },
    onTerminalFailure: async (failure) => {
      finalizers += 1;
      assert.equal(failure.event_id, message.event_id);
      assert.ok(failure.attempts >= 3);
      if (finalizers === 1) throw new Error("Controlled competing execution owner.");
      complete = true;
    },
  });
  try {
    await worker.waitUntilReady();
    await source.add("internal-event", message, { jobId: message.event_id, attempts: 3, removeOnFail: false });
    // Exact persisted BullMQ 6.1.0 shape written by its stalled-job script.
    // It bypasses processor in Worker.processJob, unlike an ordinary throw.
    await (await source.getBackend().connection.client).hset(source.toKey(message.event_id), "atm", "2", "defa", "job stalled more than allowable limit");
    const stalled = await source.getJob(message.event_id);
    assert.equal(stalled?.attemptsMade, 2);
    assert.equal(stalled?.deferredFailure, "job stalled more than allowable limit");
    worker.start();
    await waitFor(() => complete).catch(async () => {
      const current = await source.getJob(message.event_id);
      assert.fail(JSON.stringify({ processors, finalizers, complete, state: await current?.getState(), attempts: current?.attemptsMade, deferred: current?.deferredFailure }));
    });
    await worker.close();
    assert.equal(processors, 1);
    assert.equal(finalizers, 2);
    assert.equal(await (await source.getJob(message.event_id))?.getState(), "failed");
    assert.ok(await dead.getJob(`dead-${message.event_id}`));
  } finally {
    await worker.close();
    await source.close();
    await dead.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
  }
});

test("ambiguous historical execution generations reach observable dead-letter recovery without an endless delay loop", { skip: !process.env.REDIS_URL, timeout: 15_000 }, async () => {
  const redisUrl = process.env.REDIS_URL!;
  const parsed = new URL(redisUrl);
  const queueName = `closure-generation-${Date.now()}`;
  const deadLetterQueueName = `${queueName}-dead`;
  const connection = { host: parsed.hostname, port: Number(parsed.port || 6379) };
  const source = new Queue(queueName, { connection });
  const dead = new Queue(deadLetterQueueName, { connection });
  const message = InternalTaskRunQueueMessageSchema.parse({ contract_version: "1.0", event_id: `evt_${queueName}`, workspace_id: `ws_${queueName}`, task_run_id: `tsk_${queueName}`, attempt_no: 1, correlation_id: `cor_${queueName}`, input_snapshot: {} });
  let processors = 0;
  let finalizers = 0;
  const worker = createBullMqInternalEventWorker({ redisUrl, queueName, deadLetterQueueName,
    processor: async () => { processors += 1; throw new Error("Controlled pre-submit outage."); },
    onTerminalFailure: async () => { finalizers += 1; throw new InternalEventRequiresRecoveryError("Historical generations require controlled startup recovery."); },
  });
  try {
    await worker.waitUntilReady();
    await source.add("internal-event", message, { jobId: message.event_id, attempts: 3, backoff: { type: "fixed", delay: 10 }, removeOnFail: false });
    await waitFor(() => finalizers === 1);
    await worker.close();
    assert.equal(processors, 3);
    assert.equal(finalizers, 1);
    assert.equal(await (await source.getJob(message.event_id))?.getState(), "failed");
    assert.ok(await dead.getJob(`dead-${message.event_id}`));
  } finally { await worker.close(); await source.close(); await dead.close(); await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName }); }
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
