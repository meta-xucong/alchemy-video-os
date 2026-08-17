import assert from "node:assert/strict";
import test from "node:test";

import { InternalCreativePlanningQueueMessageSchema } from "@alchemy-video/contracts";
import type { ControlCreativeBriefRevision, ControlStoryboardRevision } from "@alchemy-video/persistence";

import { CreativePlanningEventConsumer, CreativePlanningOutboxRelay, createCreativePlanningQueueMessage } from "../src/service.js";

const requestedEvent = {
  contract_version: "1.0" as const,
  message_id: "msg_c11_planning_service",
  event_id: "evt_c11_planning_service",
  event_type: "creative_brief.planning_requested" as const,
  occurred_at: "2026-08-16T00:00:00.000Z",
  trace_id: "trc_c11_planning_service",
  correlation_id: "cor_c11_planning_service",
  idempotency_key: "internal:evt_c11_planning_service",
  producer: "control-api",
  workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  aggregate: { type: "creative_brief" as const, id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: { creative_brief_revision_id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  version: 1 as const,
};

const brief: ControlCreativeBriefRevision = {
  id: requestedEvent.data.creative_brief_revision_id,
  workspaceId: requestedEvent.workspace_id,
  projectId: requestedEvent.project_id,
  revision: 1,
  sourceText: "创始人在雨夜抵达工厂，决定让团队继续完成最后一次交付。",
  targetDurationSeconds: 18,
  stylePreferences: "纪实感",
  sourceAssetIds: [],
  status: "PLANNING",
  createdAt: requestedEvent.occurred_at,
  updatedAt: requestedEvent.occurred_at,
};

const queueMessage = () => InternalCreativePlanningQueueMessageSchema.parse({
  contract_version: requestedEvent.contract_version,
  event_id: requestedEvent.event_id,
  workspace_id: requestedEvent.workspace_id,
  project_id: requestedEvent.project_id,
  creative_brief_revision_id: requestedEvent.data.creative_brief_revision_id,
  correlation_id: requestedEvent.correlation_id,
});

const storyboard: ControlStoryboardRevision = {
  id: "sbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  workspaceId: requestedEvent.workspace_id,
  projectId: requestedEvent.project_id,
  scriptRevisionId: "scr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  revision: 1,
  title: "雨夜交付",
  summary: "团队在雨夜完成交付。",
  totalDurationSeconds: 18,
  continuityLevel: "STANDARD",
  continuityNote: "需在执行阶段核验镜头衔接。",
  status: "READY_FOR_REVIEW",
  shotSpecs: [],
  createdAt: requestedEvent.occurred_at,
  updatedAt: requestedEvent.occurred_at,
};

test("Creative planning relay rejects an outbox row whose durable scope differs from its internal event", () => {
  assert.throws(() => createCreativePlanningQueueMessage({
    id: requestedEvent.event_id,
    workspaceId: "ws_other_workspace",
    event: requestedEvent,
    publishAttempts: 0,
  }), /scope do not match/);
});

test("Creative planning relay leases only planning requests and leaves lifecycle events to their owners", async () => {
  const enqueued: unknown[] = [];
  const published: string[] = [];
  const store = {
    async claimOutboxEvents(input: { eventTypes?: readonly string[] }) {
      assert.deepEqual(input.eventTypes, ["creative_brief.planning_requested"]);
      return [{ id: requestedEvent.event_id, workspaceId: requestedEvent.workspace_id, event: requestedEvent, publishAttempts: 0 }];
    },
    async markOutboxPublished(input: { eventId: string }) { published.push(input.eventId); },
    async releaseOutboxEvent() { throw new Error("release should not run"); },
  };
  const relay = new CreativePlanningOutboxRelay(store, {
    async enqueue(message) { enqueued.push(message); },
  }, { relayId: "c11-relay", leaseMs: 100, retryDelayMs: 10, maxAttempts: 3, batchSize: 10 });

  assert.deepEqual(await relay.runOnce(new Date(requestedEvent.occurred_at)), { published: 1, retried: 0, deadLettered: 0 });
  assert.equal(enqueued.length, 1);
  assert.equal(published.join(","), requestedEvent.event_id);
});

test("Creative planning consumer completes a claimed plan without creating a video task", async () => {
  const completed: Array<Record<string, unknown>> = [];
  const executions: Array<Record<string, unknown>> = [];
  const consumer = new CreativePlanningEventConsumer({
    async claimCreativePlanningEvent() { return { kind: "CLAIMED" as const, brief }; },
    async completeCreativePlanningEvent(input) { completed.push(input as unknown as Record<string, unknown>); },
    async releaseCreativePlanningEvent() { throw new Error("release should not run"); },
    async failCreativePlan() { throw new Error("failure transition should not run"); },
  }, {
    async execute(input) { executions.push(input as unknown as Record<string, unknown>); return storyboard; },
  }, { consumerName: "c11-planning-service", workerId: "c11-worker", leaseMs: 100 });

  assert.equal(await consumer.process(queueMessage()), "CLAIMED");
  assert.equal(executions[0]?.brief, brief);
  assert.deepEqual(Object.keys(executions[0] ?? {}).sort(), ["brief", "event"]);
  assert.equal(completed[0]?.workspaceId, requestedEvent.workspace_id);
  assert.equal(completed[0]?.eventId, requestedEvent.event_id);
});

test("Creative planning consumer records a safe planning failure before dead-letter release", async () => {
  const failures: Array<Record<string, unknown>> = [];
  const releases: Array<Record<string, unknown>> = [];
  const consumer = new CreativePlanningEventConsumer({
    async claimCreativePlanningEvent() { return { kind: "CLAIMED" as const, brief }; },
    async completeCreativePlanningEvent() { throw new Error("complete should not run"); },
    async releaseCreativePlanningEvent(input) { releases.push(input as unknown as Record<string, unknown>); },
    async failCreativePlan(input) { failures.push(input as unknown as Record<string, unknown>); return brief; },
  }, {
    async execute() { throw new Error("controlled planner failure"); },
  }, { consumerName: "c11-planning-service", workerId: "c11-worker", leaseMs: 100 });

  await assert.rejects(consumer.process(queueMessage()), /controlled planner failure/);
  await consumer.deadLetter({
    eventId: requestedEvent.event_id,
    workspaceId: requestedEvent.workspace_id,
    creativeBriefRevisionId: brief.id,
    reason: "controlled retry exhaustion",
  });
  assert.equal(failures[0]?.workspaceId, requestedEvent.workspace_id);
  assert.equal(failures[0]?.creativeBriefRevisionId, brief.id);
  assert.equal(failures[0]?.code, "PLANNING_FAILED");
  assert.equal(releases[0]?.eventId, requestedEvent.event_id);
  assert.equal(releases[0]?.deadLetter, true);
});
