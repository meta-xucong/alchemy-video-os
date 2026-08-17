import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { InternalEventEnvelope } from "@alchemy-video/contracts";
import { createInMemoryStoragePort } from "@alchemy-video/storage-client";

import { MediaRuntimeEventConsumer, MediaRuntimeOutboxRelay, createMediaRuntimeQueueMessage } from "../src/media-service.js";

const readStoredBytes = async (storage: ReturnType<typeof createInMemoryStoragePort>, objectKey: string) => {
  const object = await storage.readObject({ objectKey });
  assert.ok(object);
  const reader = object.stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks));
};

const qcRequestedEvent: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }> = {
  contract_version: "1.0",
  message_id: "msg_c12_qc_requested_service",
  event_id: "evt_c12_qc_requested_service",
  event_type: "production_segment.qc_requested",
  occurred_at: "2026-08-16T00:00:00.000Z",
  trace_id: "trc_c12_qc_requested_service",
  correlation_id: "cor_c12_qc_requested_service",
  idempotency_key: "internal:evt_c12_qc_requested_service",
  producer: "production-worker",
  workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  aggregate: { type: "production_segment", id: "psg_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    production_run_id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    production_segment_id: "psg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  },
  version: 1,
};

test("Media Runtime relay refuses an outbox row whose durable scope differs from its event", () => {
  assert.throws(() => createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: "ws_other_workspace",
    event: qcRequestedEvent,
    publishAttempts: 0,
  }), /scope do not match/);
});

test("Media Runtime relay leases only durable QC and composition requests", async () => {
  const enqueued: unknown[] = [];
  const published: string[] = [];
  const relay = new MediaRuntimeOutboxRelay({
    async claimOutboxEvents(input: { eventTypes?: readonly string[] }) {
      assert.deepEqual(input.eventTypes, ["production_segment.qc_requested", "video_version.composition_requested"]);
      return [{ id: qcRequestedEvent.event_id, workspaceId: qcRequestedEvent.workspace_id, event: qcRequestedEvent, publishAttempts: 0 }];
    },
    async markOutboxPublished(input: { eventId: string }) { published.push(input.eventId); },
    async releaseOutboxEvent() { throw new Error("release should not run"); },
  }, {
    async enqueue(message) { enqueued.push(message); },
  }, { relayId: "c12-media-relay", leaseMs: 100, retryDelayMs: 10, maxAttempts: 3, batchSize: 10 });

  assert.deepEqual(await relay.runOnce(new Date(qcRequestedEvent.occurred_at)), { published: 1, retried: 0, deadLettered: 0 });
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    contract_version: "1.0",
    event_type: "production_segment.qc_requested",
    event_id: qcRequestedEvent.event_id,
    workspace_id: qcRequestedEvent.workspace_id,
    project_id: qcRequestedEvent.project_id,
    production_run_id: qcRequestedEvent.data.production_run_id,
    production_segment_id: qcRequestedEvent.data.production_segment_id,
    task_run_id: qcRequestedEvent.data.task_run_id,
    correlation_id: qcRequestedEvent.correlation_id,
  });
  assert.deepEqual(published, [qcRequestedEvent.event_id]);
});

test("Media Runtime consumer QC path reads verified private bytes and persists only a derived handoff artifact", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("controlled-local-mp4-fixture");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const completed: string[] = [];
  const accepted: Array<Record<string, unknown>> = [];
  let inspectionCalls = 0;
  let handoffCalls = 0;
  const handoffBytes = new TextEncoder().encode("controlled-handoff-png");
  const handoffSha256 = createHash("sha256").update(handoffBytes).digest("hex");
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: qcRequestedEvent }; },
    async findProductionSegmentQcInput() {
      return {
        workspaceId: qcRequestedEvent.workspace_id,
        projectId: qcRequestedEvent.project_id!,
        productionRunId: qcRequestedEvent.data.production_run_id,
        productionSegmentId: qcRequestedEvent.data.production_segment_id,
        taskRunId: qcRequestedEvent.data.task_run_id,
        sourceAsset: {
          id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
          objectKey: sourceObjectKey,
          sha256: sourceSha256,
          byteSize: sourceBytes.byteLength,
          mimeType: "video/mp4",
        },
      };
    },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async acceptProductionSegmentQc(input) { accepted.push(input as unknown as Record<string, unknown>); return undefined; },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent(input) { completed.push(input.eventId); },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect(input) {
      inspectionCalls += 1;
      assert.equal(input.expectedSha256, sourceSha256);
      assert.deepEqual(input.bytes, sourceBytes);
      return {};
    },
    async extractHandoffFrame(input) {
      handoffCalls += 1;
      assert.equal(input.expectedSha256, sourceSha256);
      return { bytes: handoffBytes, sha256: handoffSha256, byte_size: handoffBytes.byteLength, width: 160, height: 90 };
    },
    async compose() { throw new Error("composition should not run"); },
  }, { consumerName: "c12-media-service", workerId: "c12-media-worker", leaseMs: 100 });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    event: qcRequestedEvent,
    publishAttempts: 0,
  })!), "CLAIMED");
  assert.equal(inspectionCalls, 1);
  assert.equal(handoffCalls, 1);
  assert.deepEqual(completed, [qcRequestedEvent.event_id]);
  const handoff = accepted[0]?.handoffAsset as { id?: string; objectKey?: string; sha256?: string } | undefined;
  assert.equal(handoff?.id, "ast_c12_qc_requested_service");
  assert.equal(handoff?.sha256, handoffSha256);
  assert.equal(handoff?.objectKey, "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_c12_qc_requested_service/handoff.png");
  assert.deepEqual(await readStoredBytes(storage, handoff!.objectKey!), handoffBytes);
});

test("Media Runtime consumer composition path keeps ordered source bytes and writes one immutable final artifact", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("controlled-local-composition-fixture");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const compositionEvent: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_c12_composition_service",
    event_id: "evt_c12_composition_service",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  const finalBytes = new TextEncoder().encode("controlled-composed-mp4");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  const completed: string[] = [];
  const persisted: Array<Record<string, unknown>> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: compositionEvent }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: compositionEvent.workspace_id,
        projectId: compositionEvent.project_id!,
        productionRunId: compositionEvent.data.production_run_id,
        storyboardRevisionId: "sbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
        segments: [{
          sequence: 1,
          taskRunId: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
          sourceAsset: {
            id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            objectKey: sourceObjectKey,
            sha256: sourceSha256,
            byteSize: sourceBytes.byteLength,
            mimeType: "video/mp4",
          },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition(input) { persisted.push(input as unknown as Record<string, unknown>); return undefined; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent(input) { completed.push(input.eventId); },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("QC should not run"); },
    async extractHandoffFrame() { throw new Error("QC should not run"); },
    async compose(input) {
      assert.deepEqual(input.segments, [sourceBytes]);
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 1000 } };
    },
  }, { consumerName: "c12-media-service", workerId: "c12-media-worker", leaseMs: 100 });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({
    id: compositionEvent.event_id,
    workspaceId: compositionEvent.workspace_id,
    event: compositionEvent,
    publishAttempts: 0,
  })!), "CLAIMED");
  assert.deepEqual(completed, [compositionEvent.event_id]);
  const video = persisted[0]?.videoAsset as { id?: string; objectKey?: string; sha256?: string; durationMs?: number } | undefined;
  assert.equal(video?.id, "ast_c12_composition_service");
  assert.equal(video?.sha256, finalSha256);
  assert.equal(video?.durationMs, 1000);
  assert.equal(video?.objectKey, "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_c12_composition_service/composed.mp4");
  assert.deepEqual(await readStoredBytes(storage, video!.objectKey!), finalBytes);
});

test("Media Runtime terminal failure persists a normalized failure before releasing its durable lease", async () => {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "DUPLICATE" as const }; },
    async findProductionSegmentQcInput() { throw new Error("should not run"); },
    async findProductionCompositionInput() { throw new Error("should not run"); },
    async acceptProductionSegmentQc() { throw new Error("should not run"); },
    async completeProductionComposition() { throw new Error("should not run"); },
    async failMediaRuntimeEvent(input) { calls.push({ method: "failure", input: input as unknown as Record<string, unknown> }); return undefined; },
    async completeMediaRuntimeEvent() { throw new Error("should not run"); },
    async releaseMediaRuntimeEvent(input) { calls.push({ method: "release", input: input as unknown as Record<string, unknown> }); },
  }, createInMemoryStoragePort(), {
    async inspect() { throw new Error("should not run"); },
    async extractHandoffFrame() { throw new Error("should not run"); },
    async compose() { throw new Error("should not run"); },
  }, { consumerName: "c12-media-service", workerId: "c12-media-worker", leaseMs: 100 });

  await consumer.deadLetter({
    eventId: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    reason: "MEDIA_RENDER_FAILED",
  });
  assert.deepEqual(calls.map((call) => call.method), ["failure", "release"]);
  assert.equal(calls[0]?.input.errorCode, "MEDIA_RENDER_FAILED");
  assert.equal(calls[0]?.input.retryable, false);
  assert.equal(calls[1]?.input.deadLetter, true);
});
