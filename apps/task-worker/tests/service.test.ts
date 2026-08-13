import assert from "node:assert/strict";
import test from "node:test";

import { InternalEventEnvelopeSchema, InternalTaskRunQueueMessageSchema, type InternalTaskRunQueueMessage } from "@alchemy-video/contracts";
import type { InternalEventQueuePort } from "@alchemy-video/task-queue";
import type { PersistedOutboxEvent, TaskRunStore } from "@alchemy-video/persistence";

import { OutboxRelay, TaskRunEventConsumer } from "../src/service.js";

const queuedEvent = InternalEventEnvelopeSchema.parse({
  contract_version: "1.0",
  message_id: "msg_c05_service_test",
  event_id: "evt_c05_service_test",
  event_type: "task_run.queued",
  occurred_at: "2026-08-13T00:00:00.000Z",
  trace_id: "trace-c05-service-test",
  correlation_id: "correlation-c05-service-test",
  idempotency_key: "c05-service-test",
  producer: "control-api",
  workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  version: 1,
  data: {
    task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    kind: "VIDEO_GENERATION",
    input_snapshot: {},
  },
});

const outbox = (publishAttempts: number): PersistedOutboxEvent => ({
  id: queuedEvent.event_id,
  workspaceId: queuedEvent.workspace_id,
  event: queuedEvent,
  publishAttempts,
});

test("OutboxRelay rejects an outbox payload whose workspace differs from the database scope", async () => {
  const releases: Array<Parameters<TaskRunStore["releaseOutboxEvent"]>[0]> = [];
  const enqueued: InternalTaskRunQueueMessage[] = [];
  const row = { ...outbox(1), workspaceId: "ws_database_scope" };
  const store: Pick<TaskRunStore, "claimOutboxEvents" | "markOutboxPublished" | "releaseOutboxEvent"> = {
    async claimOutboxEvents() { return [row]; },
    async markOutboxPublished() { throw new Error("must not publish a mismatched outbox"); },
    async releaseOutboxEvent(input) { releases.push(input); },
  };
  const queue: InternalEventQueuePort = {
    async enqueue(input) { enqueued.push(input); },
    async close() {},
  };
  const relay = new OutboxRelay(store, queue, {
    relayId: "relay-c05-scope-test",
    leaseMs: 100,
    retryDelayMs: 50,
    maxAttempts: 2,
    batchSize: 10,
  });

  assert.deepEqual(await relay.runOnce(new Date("2026-08-13T00:00:00.000Z")), { published: 0, retried: 1, deadLettered: 0 });
  assert.deepEqual(enqueued, []);
  assert.equal(releases[0]?.workspaceId, "ws_database_scope");
});

const queueMessage = (): InternalTaskRunQueueMessage => InternalTaskRunQueueMessageSchema.parse({
  contract_version: "1.0",
  event_id: queuedEvent.event_id,
  workspace_id: queuedEvent.workspace_id,
  task_run_id: queuedEvent.data.task_run_id,
  attempt_no: 1,
  correlation_id: queuedEvent.correlation_id,
  input_snapshot: queuedEvent.data.input_snapshot,
});

test("OutboxRelay records retry and dead-letter outcomes when queue delivery fails", async () => {
  const releases: Array<Parameters<TaskRunStore["releaseOutboxEvent"]>[0]> = [];
  const store: Pick<TaskRunStore, "claimOutboxEvents" | "markOutboxPublished" | "releaseOutboxEvent"> = {
    async claimOutboxEvents() { return [outbox(1), outbox(2)]; },
    async markOutboxPublished() { throw new Error("must not publish when enqueue fails"); },
    async releaseOutboxEvent(input) { releases.push(input); },
  };
  const queue: InternalEventQueuePort = {
    async enqueue() { throw new Error("redis unavailable"); },
    async close() {},
  };
  const relay = new OutboxRelay(store, queue, {
    relayId: "relay-c05-test",
    leaseMs: 100,
    retryDelayMs: 50,
    maxAttempts: 2,
    batchSize: 10,
  });

  const result = await relay.runOnce(new Date("2026-08-13T00:00:00.000Z"));
  assert.deepEqual(result, { published: 0, retried: 1, deadLettered: 1 });
  assert.deepEqual(releases.map((input) => input.workspaceId), [queuedEvent.workspace_id, queuedEvent.workspace_id]);
  assert.deepEqual(releases.map((input) => input.maxAttempts), [2, 2]);
  assert.equal(releases.every((input) => input.reason === "redis unavailable"), true);
});

test("OutboxRelay constructs the complete versioned TaskRun queue message from a verified outbox row", async () => {
  const enqueued: InternalTaskRunQueueMessage[] = [];
  const published: Array<Parameters<TaskRunStore["markOutboxPublished"]>[0]> = [];
  const store: Pick<TaskRunStore, "claimOutboxEvents" | "markOutboxPublished" | "releaseOutboxEvent"> = {
    async claimOutboxEvents() { return [outbox(1)]; },
    async markOutboxPublished(input) { published.push(input); },
    async releaseOutboxEvent() { throw new Error("must not retry a valid queued event"); },
  };
  const queue: InternalEventQueuePort = {
    async enqueue(input) { enqueued.push(input); },
    async close() {},
  };
  const relay = new OutboxRelay(store, queue, {
    relayId: "relay-c05-message-test",
    leaseMs: 100,
    retryDelayMs: 50,
    maxAttempts: 2,
    batchSize: 10,
  });

  assert.deepEqual(await relay.runOnce(new Date("2026-08-13T00:00:00.000Z")), { published: 1, retried: 0, deadLettered: 0 });
  assert.deepEqual(enqueued, [queueMessage()]);
  assert.equal(published[0]?.workspaceId, queuedEvent.workspace_id);
});

test("TaskRunEventConsumer retries a busy delivery and dead-letters within the same workspace", async () => {
  const released: Array<Parameters<TaskRunStore["releaseConsumerEvent"]>[0]> = [];
  const store: Pick<TaskRunStore, "processEvent" | "releaseConsumerEvent"> = {
    async processEvent() { return "BUSY"; },
    async releaseConsumerEvent(input) { released.push(input); },
  };
  const consumer = new TaskRunEventConsumer(store, {
    consumerName: "task-run-transition",
    workerId: "worker-c05-test",
    leaseMs: 100,
  });

  await assert.rejects(
    consumer.process(queueMessage()),
    /requires another delivery attempt/,
  );
  await consumer.deadLetter({ event_id: queuedEvent.event_id, workspace_id: queuedEvent.workspace_id, reason: "final delivery failure" });
  assert.equal(released.length, 1);
  assert.equal(released[0]?.eventId, queuedEvent.event_id);
  assert.equal(released[0]?.workspaceId, queuedEvent.workspace_id);
  assert.equal(released[0]?.consumerName, "task-run-transition");
  assert.equal(released[0]?.workerId, "worker-c05-test");
  assert.equal(released[0]?.reason, "final delivery failure");
  assert.equal(released[0]?.deadLetter, true);
  assert.ok(released[0]?.now instanceof Date);
});
