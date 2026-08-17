import assert from "node:assert/strict";
import test from "node:test";

import { InternalProductionQueueMessageSchema, type InternalEventEnvelope } from "@alchemy-video/contracts";

import { ProductionEventConsumer, ProductionOutboxRelay, createProductionQueueMessage } from "../src/service.js";

const confirmedEvent: Extract<InternalEventEnvelope, { event_type: "production_run.confirmed" }> = {
  contract_version: "1.0",
  message_id: "msg_c12_confirmed_service",
  event_id: "evt_c12_confirmed_service",
  event_type: "production_run.confirmed",
  occurred_at: "2026-08-16T00:00:00.000Z",
  trace_id: "trc_c12_confirmed_service",
  correlation_id: "cor_c12_confirmed_service",
  idempotency_key: "internal:evt_c12_confirmed_service",
  producer: "control-api",
  workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  aggregate: { type: "production_run", id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    production_run_id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    storyboard_revision_id: "sbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    total_shot_count: 2,
  },
  version: 1,
};

const succeededEvent: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }> = {
  ...confirmedEvent,
  message_id: "msg_c12_succeeded_service",
  event_id: "evt_c12_succeeded_service",
  event_type: "task_run.succeeded",
  aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    result_asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    sha256: "a".repeat(64),
  },
};

const confirmationMessage = () => InternalProductionQueueMessageSchema.parse({
  contract_version: confirmedEvent.contract_version,
  event_type: confirmedEvent.event_type,
  event_id: confirmedEvent.event_id,
  workspace_id: confirmedEvent.workspace_id,
  project_id: confirmedEvent.project_id,
  production_run_id: confirmedEvent.data.production_run_id,
  correlation_id: confirmedEvent.correlation_id,
});

const successMessage = () => InternalProductionQueueMessageSchema.parse({
  contract_version: succeededEvent.contract_version,
  event_type: succeededEvent.event_type,
  event_id: succeededEvent.event_id,
  workspace_id: succeededEvent.workspace_id,
  project_id: succeededEvent.project_id,
  task_run_id: succeededEvent.data.task_run_id,
  correlation_id: succeededEvent.correlation_id,
});

test("Production relay rejects an outbox row whose durable scope differs from its internal event", () => {
  assert.throws(() => createProductionQueueMessage({
    id: confirmedEvent.event_id,
    workspaceId: "ws_other_workspace",
    event: confirmedEvent,
    publishAttempts: 0,
  }), /scope do not match/);
});

test("Production relay leases only durable C12 scheduling events", async () => {
  const enqueued: unknown[] = [];
  const published: string[] = [];
  const relay = new ProductionOutboxRelay({
    async claimOutboxEvents(input: { eventTypes?: readonly string[] }) {
      assert.deepEqual(input.eventTypes, ["production_run.confirmed", "task_run.succeeded", "task_run.failed", "handoff_asset.accepted"]);
      return [{ id: confirmedEvent.event_id, workspaceId: confirmedEvent.workspace_id, event: confirmedEvent, publishAttempts: 0 }];
    },
    async markOutboxPublished(input: { eventId: string }) { published.push(input.eventId); },
    async releaseOutboxEvent() { throw new Error("release should not run"); },
  }, {
    async enqueue(message) { enqueued.push(message); },
  }, { relayId: "c12-relay", leaseMs: 100, retryDelayMs: 10, maxAttempts: 3, batchSize: 10 });

  assert.deepEqual(await relay.runOnce(new Date(confirmedEvent.occurred_at)), { published: 1, retried: 0, deadLettered: 0 });
  assert.equal(enqueued.length, 1);
  assert.equal(published.join(","), confirmedEvent.event_id);
});

test("Production consumer initializes confirmed runs and records only the matching task outcome", async () => {
  const calls: Array<{ method: string; eventId: string }> = [];
  const completed: string[] = [];
  const consumer = new ProductionEventConsumer({
    async claimProductionEvent(input) {
      return { kind: "CLAIMED" as const, event: input.message.event_type === "production_run.confirmed" ? confirmedEvent : succeededEvent };
    },
    async initializeProductionRun(input) { calls.push({ method: "initialize", eventId: input.event.event_id }); return undefined; },
    async recordProductionTaskSucceeded(input) { calls.push({ method: "succeeded", eventId: input.event.event_id }); return undefined; },
    async recordProductionTaskFailed() { throw new Error("failure transition should not run"); },
    async resumeProductionRun() { throw new Error("handoff transition should not run"); },
    async completeProductionEvent(input) { completed.push(input.eventId); },
    async releaseProductionEvent() { throw new Error("release should not run"); },
  }, { consumerName: "c12-production-service", workerId: "c12-worker", leaseMs: 100 });

  assert.equal(await consumer.process(confirmationMessage()), "CLAIMED");
  assert.equal(await consumer.process(successMessage()), "CLAIMED");
  assert.deepEqual(calls, [
    { method: "initialize", eventId: confirmedEvent.event_id },
    { method: "succeeded", eventId: succeededEvent.event_id },
  ]);
  assert.deepEqual(completed, [confirmedEvent.event_id, succeededEvent.event_id]);
});

test("Production consumer records a terminal queue failure against only its durable consumption lease", async () => {
  const releases: Array<Record<string, unknown>> = [];
  const consumer = new ProductionEventConsumer({
    async claimProductionEvent() { return { kind: "DUPLICATE" as const }; },
    async initializeProductionRun() { throw new Error("should not run"); },
    async recordProductionTaskSucceeded() { throw new Error("should not run"); },
    async recordProductionTaskFailed() { throw new Error("should not run"); },
    async resumeProductionRun() { throw new Error("should not run"); },
    async completeProductionEvent() { throw new Error("should not run"); },
    async releaseProductionEvent(input) { releases.push(input as unknown as Record<string, unknown>); },
  }, { consumerName: "c12-production-service", workerId: "c12-worker", leaseMs: 100 });

  await consumer.deadLetter({ eventId: confirmedEvent.event_id, workspaceId: confirmedEvent.workspace_id, reason: "controlled retry exhaustion" });
  assert.equal(releases[0]?.eventId, confirmedEvent.event_id);
  assert.equal(releases[0]?.workspaceId, confirmedEvent.workspace_id);
  assert.equal(releases[0]?.deadLetter, true);
});
