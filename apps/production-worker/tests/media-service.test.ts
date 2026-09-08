import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { InternalEventEnvelope, MediaRuntimeNarrationSegment } from "@alchemy-video/contracts";
import { ProductionCompositionInputUnavailableError } from "@alchemy-video/persistence";
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

const handoffReviewRequestedEvent: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }> = {
  ...qcRequestedEvent,
  message_id: "msg_c121_handoff_review_service",
  event_id: "evt_c121_handoff_review_service",
  event_type: "handoff_review.requested",
  aggregate: { type: "handoff_review", id: "hrv_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    production_run_id: qcRequestedEvent.data.production_run_id,
    handoff_review_id: "hrv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    from_sequence: 1,
    to_sequence: 2,
  },
};

const narrationGenerationRequestedEvent: Extract<InternalEventEnvelope, { event_type: "narration_audio.generation_requested" }> = {
  ...qcRequestedEvent,
  message_id: "msg_c12_narration_generation_service",
  event_id: "evt_c12_narration_generation_service",
  event_type: "narration_audio.generation_requested",
  aggregate: { type: "narration_plan_revision", id: "nsr_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    narration_script_revision_id: "nsr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    generation_kind: "SAMPLE",
    section_id: "intro",
    asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    provider: "piper",
    voice_id: "platform-generic-zh",
    provider_settings: {},
    canonical_script_hash: "a".repeat(64),
    object_key: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/narration.wav",
  },
};

test("Media Runtime relay refuses an outbox row whose durable scope differs from its event", () => {
  assert.throws(() => createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: "ws_other_workspace",
    event: qcRequestedEvent,
    publishAttempts: 0,
  }), /scope do not match/);
});

test("Media Runtime relay leases only durable QC, handoff review, composition, and narration generation requests", async () => {
  const enqueued: unknown[] = [];
  const published: string[] = [];
  const relay = new MediaRuntimeOutboxRelay({
    async claimOutboxEvents(input: { eventTypes?: readonly string[] }) {
      assert.deepEqual(input.eventTypes, ["narration_audio.generation_requested", "production_segment.qc_requested", "handoff_review.requested", "video_version.composition_requested"]);
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

test("Media Runtime narration generation submits once and reuses the measured asset on retry", async () => {
  const storage = createInMemoryStoragePort();
  const generatedBytes = new TextEncoder().encode("controlled-local-wav-fixture");
  const generatedSha256 = createHash("sha256").update(generatedBytes).digest("hex");
  const generatedObjectKey = narrationGenerationRequestedEvent.data.object_key;
  let generatedReady = false;
  let synthesizeCalls = 0;
  let inspectAudioCalls = 0;
  let completedEvents = 0;
  let measuredFacts: unknown;
  const sourceInput = {
    event: narrationGenerationRequestedEvent,
    workspaceId: narrationGenerationRequestedEvent.workspace_id,
    projectId: narrationGenerationRequestedEvent.project_id!,
    narrationScriptRevisionId: narrationGenerationRequestedEvent.data.narration_script_revision_id,
    sectionId: "intro",
    scriptText: "第一句。\n\n第二句，继续说明。",
    provider: "piper",
    voiceId: "platform-generic-zh",
    providerSettings: {},
    generationKind: "SAMPLE" as const,
    assetId: narrationGenerationRequestedEvent.data.asset_id,
    objectKey: generatedObjectKey,
  };
  const narrationStore = {
    async findNarrationAudioGenerationInput() { return sourceInput; },
    async ensureGeneratedNarrationAsset() {
      return generatedReady
        ? {
          workspaceId: sourceInput.workspaceId,
          projectId: sourceInput.projectId,
          assetId: sourceInput.assetId,
          objectKey: generatedObjectKey,
          status: "READY" as const,
          sha256: generatedSha256,
          mimeType: "audio/wav",
          byteSize: generatedBytes.byteLength,
          durationMs: 2_000,
        }
        : {
          workspaceId: sourceInput.workspaceId,
          projectId: sourceInput.projectId,
          assetId: sourceInput.assetId,
          objectKey: generatedObjectKey,
          status: "PENDING_UPLOAD" as const,
        };
    },
    async completeNarrationAudioGeneration(input: { facts: unknown }) {
      completedEvents += 1;
      measuredFacts = input.facts;
      generatedReady = true;
      return undefined;
    },
  };
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: narrationGenerationRequestedEvent }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent(input) { completedEvents += input.eventId === narrationGenerationRequestedEvent.event_id ? 1 : 0; },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("generic inspect should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async synthesizeNarration(input) {
      synthesizeCalls += 1;
      assert.equal(input.preferredProvider, "piper");
      assert.equal(input.voiceId, "platform-generic-zh");
      assert.equal(input.scriptText, "第一句。\n\n第二句，继续说明。");
      return { bytes: generatedBytes, mime_type: "audio/wav" as const, sha256: generatedSha256, byte_size: generatedBytes.byteLength, duration_ms: 2_000 };
    },
    async inspectAudio(input) {
      inspectAudioCalls += 1;
      assert.deepEqual(input.bytes, generatedBytes);
      assert.equal(input.expectedSha256, generatedSha256);
      return { mime_type: "audio/wav" as const, sha256: generatedSha256, byte_size: generatedBytes.byteLength, duration_ms: 2_000 };
    },
    async compose() { throw new Error("composition should not run"); },
  }, { consumerName: "narration-generation-consumer", workerId: "narration-generation-worker", leaseMs: 100 }, undefined, narrationStore);

  const message = createMediaRuntimeQueueMessage({
    id: narrationGenerationRequestedEvent.event_id,
    workspaceId: narrationGenerationRequestedEvent.workspace_id,
    event: narrationGenerationRequestedEvent,
    publishAttempts: 0,
  });
  assert.ok(message);
  assert.equal(await consumer.process(message), "CLAIMED");
  assert.equal(await consumer.process(message), "CLAIMED");
  assert.equal(synthesizeCalls, 1);
  assert.equal(inspectAudioCalls, 1);
  assert.equal(completedEvents, 4);
  assert.deepEqual(measuredFacts, { mimeType: "audio/wav", sha256: generatedSha256, byteSize: generatedBytes.byteLength, durationMs: 2_000 });
  assert.deepEqual(await storage.inspectObject({ objectKey: generatedObjectKey }), { mimeType: "audio/wav", byteSize: generatedBytes.byteLength, sha256: generatedSha256 });
});

test("Media Runtime narration generation recovers an uploaded pending object without resubmitting", async () => {
  const storage = createInMemoryStoragePort();
  const generatedBytes = new TextEncoder().encode("controlled-local-pending-wav-fixture");
  const generatedSha256 = createHash("sha256").update(generatedBytes).digest("hex");
  const generatedObjectKey = narrationGenerationRequestedEvent.data.object_key;
  let synthesizeCalls = 0;
  let inspectAudioCalls = 0;
  let completionCalls = 0;
  let releaseCalls = 0;
  let failFirstCompletion = true;
  const sourceInput = {
    event: narrationGenerationRequestedEvent,
    workspaceId: narrationGenerationRequestedEvent.workspace_id,
    projectId: narrationGenerationRequestedEvent.project_id!,
    narrationScriptRevisionId: narrationGenerationRequestedEvent.data.narration_script_revision_id,
    sectionId: "intro",
    scriptText: "茅山温泉值得慢慢体验。",
    provider: "piper",
    voiceId: "platform-generic-zh",
    providerSettings: {},
    generationKind: "SAMPLE" as const,
    assetId: narrationGenerationRequestedEvent.data.asset_id,
    objectKey: generatedObjectKey,
  };
  const narrationStore = {
    async findNarrationAudioGenerationInput() { return sourceInput; },
    async ensureGeneratedNarrationAsset() {
      return {
        workspaceId: sourceInput.workspaceId,
        projectId: sourceInput.projectId,
        assetId: sourceInput.assetId,
        objectKey: generatedObjectKey,
        status: "PENDING_UPLOAD" as const,
      };
    },
    async completeNarrationAudioGeneration() {
      completionCalls += 1;
      if (failFirstCompletion) {
        failFirstCompletion = false;
        throw new Error("simulated completion interruption");
      }
      return undefined;
    },
  };
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: narrationGenerationRequestedEvent }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { /* acknowledged only after recovery */ },
    async releaseMediaRuntimeEvent() { releaseCalls += 1; },
  }, storage, {
    async inspect() { throw new Error("generic inspect should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async synthesizeNarration() {
      synthesizeCalls += 1;
      return { bytes: generatedBytes, mime_type: "audio/wav" as const, sha256: generatedSha256, byte_size: generatedBytes.byteLength, duration_ms: 2_000 };
    },
    async inspectAudio(input) {
      inspectAudioCalls += 1;
      assert.deepEqual(input.bytes, generatedBytes);
      assert.equal(input.expectedSha256, generatedSha256);
      return { mime_type: "audio/wav" as const, sha256: generatedSha256, byte_size: generatedBytes.byteLength, duration_ms: 2_000 };
    },
    async compose() { throw new Error("composition should not run"); },
  }, { consumerName: "narration-generation-consumer", workerId: "narration-generation-worker", leaseMs: 100 }, undefined, narrationStore);

  const message = createMediaRuntimeQueueMessage({
    id: narrationGenerationRequestedEvent.event_id,
    workspaceId: narrationGenerationRequestedEvent.workspace_id,
    event: narrationGenerationRequestedEvent,
    publishAttempts: 0,
  });
  assert.ok(message);
  await assert.rejects(consumer.process(message), /simulated completion interruption/);
  assert.equal(await consumer.process(message), "CLAIMED");
  assert.equal(synthesizeCalls, 1);
  assert.equal(inspectAudioCalls, 2);
  assert.equal(completionCalls, 2);
  assert.equal(releaseCalls, 1);
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
  let transcriptionCalls = 0;
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
        // A native clip without an authored provider_text is visual/BGM-only
        // for this gate and must remain on the existing QC path.
        audioOwner: "NATIVE_PROVIDER" as const,
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
    async transcribe() {
      transcriptionCalls += 1;
      throw new Error("visual/BGM-only QC must not transcribe");
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
  assert.equal(transcriptionCalls, 0);
  assert.equal(handoffCalls, 1);
  assert.deepEqual(completed, [qcRequestedEvent.event_id]);
  const handoff = accepted[0]?.handoffAsset as { id?: string; objectKey?: string; sha256?: string } | undefined;
  assert.equal(handoff?.id, "ast_c12_qc_requested_service");
  assert.equal(handoff?.sha256, handoffSha256);
  assert.equal(handoff?.objectKey, "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_c12_qc_requested_service/handoff.png");
  assert.deepEqual(await readStoredBytes(storage, handoff!.objectKey!), handoffBytes);
});

test("native provider speech QC stops before handoff when checked transcription has zero words", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("native-speech-zero-word-fixture");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_native_zero_words/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  let transcriptionCalls = 0;
  let handoffCalls = 0;
  let acceptedCalls = 0;
  let completedCalls = 0;
  let releasedCalls = 0;
  let transcriptStatus: "CHECKED" | "UNAVAILABLE" = "CHECKED";
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: qcRequestedEvent }; },
    async findProductionSegmentQcInput() {
      return {
        workspaceId: qcRequestedEvent.workspace_id,
        projectId: qcRequestedEvent.project_id!,
        productionRunId: qcRequestedEvent.data.production_run_id,
        productionSegmentId: qcRequestedEvent.data.production_segment_id,
        taskRunId: qcRequestedEvent.data.task_run_id,
        audioOwner: "NATIVE_PROVIDER" as const,
        providerText: "第一段应该有口播",
        sourceAsset: {
          id: "ast_native_zero_words",
          objectKey: sourceObjectKey,
          sha256: sourceSha256,
          byteSize: sourceBytes.byteLength,
          mimeType: "video/mp4",
        },
      };
    },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async acceptProductionSegmentQc() { acceptedCalls += 1; return undefined; },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { completedCalls += 1; },
    async releaseMediaRuntimeEvent() { releasedCalls += 1; },
  }, storage, {
    async inspect() { return {}; },
    async transcribe(input) {
      transcriptionCalls += 1;
      assert.deepEqual(input.bytes, sourceBytes);
      assert.equal(input.expectedSha256, sourceSha256);
      return { status: transcriptStatus, word_timestamps: [], issues: [] };
    },
    async extractHandoffFrame() {
      handoffCalls += 1;
      throw new Error("zero-word native speech must stop before handoff");
    },
    async compose() { throw new Error("composition should not run"); },
  }, { consumerName: "native-speech-qc", workerId: "native-speech-qc-worker", leaseMs: 100 });

  await assert.rejects(consumer.process(createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    event: qcRequestedEvent,
    publishAttempts: 0,
  })!), /QC_FAILED: native provider speech transcript returned zero words/);
  transcriptStatus = "UNAVAILABLE";
  await assert.rejects(consumer.process(createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    event: qcRequestedEvent,
    publishAttempts: 0,
  })!), /MEDIA_RUNTIME_UNAVAILABLE: native provider speech transcription is unavailable/);
  assert.equal(transcriptionCalls, 2);
  assert.equal(handoffCalls, 0);
  assert.equal(acceptedCalls, 0);
  assert.equal(completedCalls, 0);
  assert.equal(releasedCalls, 2);
});

test("native provider speech QC accepts a checked transcript with authored provider_text", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("native-speech-checked-fixture");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_native_checked/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const handoffBytes = new TextEncoder().encode("native-speech-checked-handoff");
  const handoffSha256 = createHash("sha256").update(handoffBytes).digest("hex");
  let transcriptionCalls = 0;
  let handoffCalls = 0;
  let acceptedCalls = 0;
  let completedCalls = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: qcRequestedEvent }; },
    async findProductionSegmentQcInput() {
      return {
        workspaceId: qcRequestedEvent.workspace_id,
        projectId: qcRequestedEvent.project_id!,
        productionRunId: qcRequestedEvent.data.production_run_id,
        productionSegmentId: qcRequestedEvent.data.production_segment_id,
        taskRunId: qcRequestedEvent.data.task_run_id,
        audioOwner: "NATIVE_PROVIDER" as const,
        providerText: "alpha beta",
        sourceAsset: {
          id: "ast_native_checked",
          objectKey: sourceObjectKey,
          sha256: sourceSha256,
          byteSize: sourceBytes.byteLength,
          mimeType: "video/mp4",
        },
      };
    },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async acceptProductionSegmentQc() { acceptedCalls += 1; return undefined; },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { completedCalls += 1; },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { return {}; },
    async transcribe(input) {
      transcriptionCalls += 1;
      assert.deepEqual(input.bytes, sourceBytes);
      assert.equal(input.expectedSha256, sourceSha256);
      return {
        status: "CHECKED" as const,
        word_timestamps: [{ word: "alpha" }, { word: "beta" }],
        issues: [],
      };
    },
    async extractHandoffFrame() {
      handoffCalls += 1;
      return { bytes: handoffBytes, sha256: handoffSha256, byte_size: handoffBytes.byteLength, width: 160, height: 90 };
    },
    async compose() { throw new Error("composition should not run"); },
  }, { consumerName: "native-speech-qc", workerId: "native-speech-qc-worker", leaseMs: 100 });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    event: qcRequestedEvent,
    publishAttempts: 0,
  })!), "CLAIMED");
  assert.equal(transcriptionCalls, 1);
  assert.equal(handoffCalls, 1);
  assert.equal(acceptedCalls, 1);
  assert.equal(completedCalls, 1);
});

test("C12.1 handoff review reads both bounded boundary frames and persists only the evaluator result", async () => {
  const storage = createInMemoryStoragePort();
  const firstBytes = new TextEncoder().encode("first-local-video");
  const secondBytes = new TextEncoder().encode("second-local-video");
  const firstSha256 = createHash("sha256").update(firstBytes).digest("hex");
  const secondSha256 = createHash("sha256").update(secondBytes).digest("hex");
  const firstKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/first.mp4";
  const secondKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJY/second.mp4";
  await storage.putObject({ objectKey: firstKey, mimeType: "video/mp4", bytes: firstBytes, ifNoneMatch: "*" });
  await storage.putObject({ objectKey: secondKey, mimeType: "video/mp4", bytes: secondBytes, ifNoneMatch: "*" });
  const completed: string[] = [];
  const evaluations: Array<Record<string, unknown>> = [];
  const frameBytes = new TextEncoder().encode("boundary-png");
  const frameSha256 = createHash("sha256").update(frameBytes).digest("hex");
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: handoffReviewRequestedEvent }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async findHandoffReviewInput() {
      return {
        workspaceId: handoffReviewRequestedEvent.workspace_id,
        projectId: handoffReviewRequestedEvent.project_id!,
        productionRunId: handoffReviewRequestedEvent.data.production_run_id,
        handoffReviewId: handoffReviewRequestedEvent.data.handoff_review_id,
        fromSequence: 1,
        toSequence: 2,
        fromSourceAsset: { id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX", objectKey: firstKey, sha256: firstSha256, byteSize: firstBytes.byteLength, mimeType: "video/mp4" },
        toSourceAsset: { id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJY", objectKey: secondKey, sha256: secondSha256, byteSize: secondBytes.byteLength, mimeType: "video/mp4" },
        continuityHints: { fromTitle: "进入办公楼", toTitle: "会议室对话" },
      };
    },
    async completeHandoffReview(input) { evaluations.push(input.evaluation as unknown as Record<string, unknown>); return undefined; },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent(input) { completed.push(input.eventId); },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("QC should not run"); },
    async extractHandoffFrame() { throw new Error("QC should not run"); },
    async extractBoundaryFrames(input) {
      assert.ok(input.expectedSha256 === firstSha256 || input.expectedSha256 === secondSha256);
      return {
        first: { bytes: frameBytes, sha256: frameSha256, byte_size: frameBytes.byteLength, width: 160, height: 90 },
        last: { bytes: frameBytes, sha256: frameSha256, byte_size: frameBytes.byteLength, width: 160, height: 90 },
      };
    },
    async compose() { throw new Error("composition should not run"); },
  }, { consumerName: "c121-media-service", workerId: "c121-media-worker", leaseMs: 100 }, {
    async evaluate(input) {
      assert.deepEqual(input.fromTailFrame, frameBytes);
      assert.deepEqual(input.toHeadFrame, frameBytes);
      assert.equal(input.continuityHints.sceneSummary, "进入办公楼 → 会议室对话");
      return {
        result: "BRIDGE_REQUIRED",
        reasonCodes: ["SCENE_DRIFT"],
        safeSummary: "相邻画面需要补一段自然转场。",
        evaluatorVersion: "fixture-v1",
        retryable: false,
      };
    },
  });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({
    id: handoffReviewRequestedEvent.event_id,
    workspaceId: handoffReviewRequestedEvent.workspace_id,
    event: handoffReviewRequestedEvent,
    publishAttempts: 0,
  })!), "CLAIMED");
  assert.deepEqual(completed, [handoffReviewRequestedEvent.event_id]);
  assert.equal(evaluations[0]?.result, "BRIDGE_REQUIRED");
});

test("C12.1 handoff review does not acknowledge an event when source assets are unavailable", async () => {
  const completed: string[] = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: handoffReviewRequestedEvent }; },
    async findHandoffReviewInput() { return undefined; },
    async completeHandoffReview() { throw new Error("review completion should not run"); },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() { throw new Error("composition should not run"); },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { throw new Error("composition should not run"); },
    async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to the dead-letter path"); },
    async completeMediaRuntimeEvent(input) { completed.push(input.eventId); },
    async releaseMediaRuntimeEvent() { throw new Error("release belongs to the queue caller"); },
  }, createInMemoryStoragePort(), {
    async inspect() { throw new Error("inspect should not run"); },
    async extractHandoffFrame() { throw new Error("handoff extraction should not run"); },
    async extractBoundaryFrames() { throw new Error("boundary extraction should not run"); },
    async compose() { throw new Error("compose should not run"); },
  }, { consumerName: "c121-media-service", workerId: "c121-media-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({
      id: handoffReviewRequestedEvent.event_id,
      workspaceId: handoffReviewRequestedEvent.workspace_id,
      event: handoffReviewRequestedEvent,
      publishAttempts: 0,
    })!),
    /source assets are not ready/,
  );
  assert.deepEqual(completed, []);
});

test("Media Runtime consumer composition path keeps ordered source bytes and writes one immutable final artifact", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("controlled-local-composition-fixture");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const narrationBytes = new TextEncoder().encode("controlled-approved-narration-wav");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_c12_narration/narration.wav";
  await storage.putObject({ objectKey: narrationObjectKey, mimeType: "audio/wav", bytes: narrationBytes, ifNoneMatch: "*" });
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
  let synthesizeCalls = 0;
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
        scriptText: "你好。",
        narrationSegments: [{ text: "旧分段", startMs: 0 }],
        narrationAsset: {
          id: "ast_c12_narration",
          workspaceId: compositionEvent.workspace_id,
          projectId: compositionEvent.project_id!,
          objectKey: narrationObjectKey,
          sha256: narrationSha256,
          byteSize: narrationBytes.byteLength,
          mimeType: "audio/wav",
          durationMs: 1000,
        },
        compositionPlan: { target_duration_ms: 1000, transitions: [], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION", music_mix: { enabled: false }, music_segments_ms: [] },
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
    async inspectAudio(input) {
      assert.deepEqual([...input.bytes], [...narrationBytes]);
      assert.equal(input.expectedSha256, narrationSha256);
      return { mime_type: "audio/wav" as const, sha256: narrationSha256, byte_size: narrationBytes.byteLength, duration_ms: 1000 };
    },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("approved narration must bypass synthesis"); },
    async compose(input) {
      assert.deepEqual(input.segments, [sourceBytes]);
      assert.deepEqual(input.narrationBytes, narrationBytes);
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 1000 } };
    },
    async finalReview(input) {
      assert.deepEqual(input.bytes, finalBytes);
      assert.equal(input.expectedSha256, finalSha256);
      assert.equal(input.captionPolicy, "OFF");
      return {
        status: "NEEDS_ATTENTION" as const,
        issues_found: ["语义评估器未配置。"],
        recommended_action: "PRESENT_WITH_REVIEW" as const,
      };
    },
  }, { consumerName: "c12-media-service", workerId: "c12-media-worker", leaseMs: 100 });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({
    id: compositionEvent.event_id,
    workspaceId: compositionEvent.workspace_id,
    event: compositionEvent,
    publishAttempts: 0,
  })!), "CLAIMED");
  assert.equal(synthesizeCalls, 0);
  assert.deepEqual(completed, [compositionEvent.event_id]);
  const video = persisted[0]?.videoAsset as { id?: string; objectKey?: string; sha256?: string; durationMs?: number } | undefined;
  assert.equal(video?.id, "ast_c12_composition_service");
  assert.equal(video?.sha256, finalSha256);
  assert.equal(video?.durationMs, 1000);
  assert.equal(video?.objectKey, "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_c12_composition_service/composed.mp4");
  assert.deepEqual(await readStoredBytes(storage, video!.objectKey!), finalBytes);
  const finalReview = persisted[0]?.finalReview as { status?: string; recommended_action?: string } | undefined;
  assert.equal(finalReview?.status, "NEEDS_ATTENTION");
  assert.equal(finalReview?.recommended_action, "PRESENT_WITH_REVIEW");
  const reviewPayload = persisted[0]?.finalReview as Record<string, unknown> | undefined;
  assert.equal(reviewPayload && "object_key" in reviewPayload, false);
  assert.equal(reviewPayload && "provider_request_id" in reviewPayload, false);
  assert.equal(reviewPayload && "transcript_script" in reviewPayload, false);
});

test("approved narration asset is consumed without Piper synthesis and accepts an identical replay artifact", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("approved-source-mp4");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_approved_source/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const narrationBytes = new TextEncoder().encode("approved-narration-mp3");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_approved_narration/narration.mp3";
  await storage.putObject({ objectKey: narrationObjectKey, mimeType: "audio/mpeg", bytes: narrationBytes, ifNoneMatch: "*" });
  const event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_approved_narration",
    event_id: "evt_approved_narration",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let synthesizeCalls = 0;
  let composeNarration: Uint8Array | undefined;
  let claimCalls = 0;
  let composeCalls = 0;
  let burnCaptionCalls = 0;
  let persisted = 0;
  const finalBytes = new TextEncoder().encode("approved-final-mp4");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  // A Worker restart can happen after the object write but before the
  // composition transaction commits.  The existing source-aligned storage
  // boundary is idempotent: an identical object is accepted and persistence
  // may safely retry without replacing bytes.
  await storage.putObject({
    objectKey: `${event.workspace_id}/${event.project_id}/ast_approved_narration/composed.mp4`,
    mimeType: "video/mp4",
    bytes: finalBytes,
    ifNoneMatch: "*",
  });
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() {
      claimCalls += 1;
      return { kind: "CLAIMED" as const, event };
    },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_approved_narration",
        scriptText: "原始来源文本",
        narrationSegments: [{ text: "批准后的旁白文本", startMs: 0 }],
        narrationAsset: {
          id: "ast_approved_narration",
          workspaceId: event.workspace_id,
          projectId: event.project_id!,
          objectKey: narrationObjectKey,
          sha256: narrationSha256,
          byteSize: narrationBytes.byteLength,
          mimeType: "audio/mpeg",
          durationMs: 1000,
        },
        captionPolicy: "REQUIRED" as const,
        compositionPlan: {
          target_duration_ms: 1000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION",
          audio_plan: {
            version: 1,
            target_duration_ms: 1000,
            narration_asset_id: "ast_approved_narration",
            narration_sections: [{ section_id: "sec_approved", start_ms: 0, end_ms: 1000, visual_role: "PRIMARY" }],
            stitch_policy: "CONTINUOUS_NARRATION",
            transcript_script: "批准后的旁白文本",
            tracks: [{ track_id: "platform-narration", ownership: "PLATFORM_NARRATION", asset_id: "ast_approved_narration", start_ms: 0, end_ms: 1000, gain_db: "0", duck_under_narration: false }],
          },
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_approved_narration",
          sourceAsset: {
            id: "ast_approved_source",
            objectKey: sourceObjectKey,
            sha256: sourceSha256,
            byteSize: sourceBytes.byteLength,
            mimeType: "video/mp4",
          },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { return undefined; },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("QC should not run"); },
    async inspectAudio(input) {
      assert.deepEqual([...input.bytes], [...narrationBytes]);
      return { mime_type: "audio/mpeg" as const, sha256: narrationSha256, byte_size: narrationBytes.byteLength, duration_ms: 1000 };
    },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("approved narration must bypass synthesis"); },
    async compose(input) {
      composeCalls += 1;
      composeNarration = input.narrationBytes;
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 1000 } };
    },
    async burnCaptions(input) {
      burnCaptionCalls += 1;
      assert.deepEqual(input.bytes, finalBytes);
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 1000 } };
    },
    async finalReview(input) {
      assert.equal(input.scriptText, "批准后的旁白文本");
      return { status: "PASS" as const, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" as const };
    },
  }, { consumerName: "approved-narration-test", workerId: "approved-narration-worker", leaseMs: 100 });

  await consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!);
  // A worker restart/replay after the object write must accept the identical
  // immutable artifact without replacing its bytes or changing its identity.
  await consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 1 })!);
  assert.deepEqual(composeNarration, narrationBytes);
  assert.equal(claimCalls, 2);
  assert.equal(composeCalls, 2);
  assert.equal(synthesizeCalls, 0);
  assert.equal(burnCaptionCalls, 2);
  assert.equal(persisted, 2);
  assert.deepEqual(await readStoredBytes(storage, `${event.workspace_id}/${event.project_id}/ast_approved_narration/composed.mp4`), finalBytes);
});

test("Media Runtime rejects a conflicting retry artifact before composition persistence", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("artifact-conflict-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_artifact_conflict_source/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_artifact_conflict",
    event_id: "evt_artifact_conflict",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  const finalBytes = new TextEncoder().encode("new-composed-bytes");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  const conflictingBytes = new TextEncoder().encode("old-composed-bytes");
  await storage.putObject({
    objectKey: `${event.workspace_id}/${event.project_id}/ast_artifact_conflict/composed.mp4`,
    mimeType: "video/mp4",
    bytes: conflictingBytes,
    ifNoneMatch: "*",
  });
  const released: Array<Record<string, unknown>> = [];
  let composeCalls = 0;
  let persisted = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_artifact_conflict",
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "LEGACY_PRESERVE" as const,
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_artifact_conflict",
          sourceAsset: {
            id: "ast_artifact_conflict_source",
            objectKey: sourceObjectKey,
            sha256: sourceSha256,
            byteSize: sourceBytes.byteLength,
            mimeType: "video/mp4",
          },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("dead-letter should not run"); },
    async completeMediaRuntimeEvent() { throw new Error("event must not complete"); },
    async releaseMediaRuntimeEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, storage, {
    async inspect() { throw new Error("QC should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async compose(input) {
      composeCalls += 1;
      assert.deepEqual(input.segments, [sourceBytes]);
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 1000 } };
    },
  }, { consumerName: "artifact-conflict-test", workerId: "artifact-conflict-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /derived object conflicts with persisted media bytes/,
  );
  assert.equal(composeCalls, 1);
  assert.equal(persisted, 0);
  assert.equal(released.length, 1);
  assert.equal(released[0]?.deadLetter, false);
  assert.match(String(released[0]?.reason), /derived object conflicts with persisted media bytes/);
});

test("AudioPlan transcript drift from the approved narration script fails before composition", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("audio-plan-transcript-drift-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const objectKey = `${workspaceId}/${projectId}/ast_audio_plan_transcript_drift/source.mp4`;
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_audio_plan_transcript_drift",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let composeCalls = 0;
  let persisted = 0;
  const released: Array<Record<string, unknown>> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_audio_plan_transcript_drift",
        narrationScriptText: "批准后的旁白文本",
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "LEGACY_PRESERVE",
          audio_plan: {
            version: 1,
            target_duration_ms: 1_000,
            narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY" }],
            stitch_policy: "LEGACY_PRESERVE",
            transcript_script: "错误的旁白文本",
            tracks: [{ track_id: "segment-1", ownership: "LEGACY_PRESERVE", asset_id: "ast_audio_plan_transcript_drift", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false }],
          },
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_audio_plan_transcript_drift",
          sourceAsset: { id: "ast_audio_plan_transcript_drift", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { throw new Error("event must not complete"); },
    async releaseMediaRuntimeEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, storage, {
    async inspect() { throw new Error("inspect should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async compose() { composeCalls += 1; throw new Error("compose must not run"); },
  }, { consumerName: "audio-plan-transcript-drift-test", workerId: "audio-plan-transcript-drift-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!),
    /AudioPlan transcript does not match the approved narration script/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
  assert.equal(released.length, 1);
  assert.match(String(released[0]?.reason), /AudioPlan transcript does not match/);
});

test("independent approved narration assets are measured and sent as OpenMontage speech tracks (E11 exact no-music cross-segment consumer)", async () => {
  const storage = createInMemoryStoragePort();
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const firstSourceBytes = new TextEncoder().encode("section-source-one-mp4");
  const secondSourceBytes = new TextEncoder().encode("section-source-two-mp4");
  const firstSourceSha256 = createHash("sha256").update(firstSourceBytes).digest("hex");
  const secondSourceSha256 = createHash("sha256").update(secondSourceBytes).digest("hex");
  const firstSourceObjectKey = `${workspaceId}/${projectId}/ast_section_source_one/generated.mp4`;
  const secondSourceObjectKey = `${workspaceId}/${projectId}/ast_section_source_two/generated.mp4`;
  const firstBytes = new TextEncoder().encode("section-one-mp3");
  const secondBytes = new TextEncoder().encode("section-two-mp3");
  const firstSha256 = createHash("sha256").update(firstBytes).digest("hex");
  const secondSha256 = createHash("sha256").update(secondBytes).digest("hex");
  const firstObjectKey = `${workspaceId}/${projectId}/ast_section_one/narration.mp3`;
  const secondObjectKey = `${workspaceId}/${projectId}/ast_section_two/narration.mp3`;
  await storage.putObject({ objectKey: firstSourceObjectKey, mimeType: "video/mp4", bytes: firstSourceBytes, ifNoneMatch: "*" });
  await storage.putObject({ objectKey: secondSourceObjectKey, mimeType: "video/mp4", bytes: secondSourceBytes, ifNoneMatch: "*" });
  await storage.putObject({ objectKey: firstObjectKey, mimeType: "audio/mpeg", bytes: firstBytes, ifNoneMatch: "*" });
  await storage.putObject({ objectKey: secondObjectKey, mimeType: "audio/mpeg", bytes: secondBytes, ifNoneMatch: "*" });
  const event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_section_narration",
    event_id: "evt_section_narration",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let synthesizeCalls = 0;
  let persisted = 0;
  let receivedTracks: Array<{ track_id: string; bytes: Uint8Array }> | undefined;
  const finalBytes = new TextEncoder().encode("section-final-mp4");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_section_narration",
        narrationScriptText: "第一段。第二段。",
        narrationSegments: [{ text: "第一段。", startMs: 0 }, { text: "第二段。", startMs: 1_000 }],
        narrationAssets: [
          { sectionId: "sec_1", assetVersionId: "nav_section_one", id: "ast_section_one", workspaceId, projectId, objectKey: firstObjectKey, sha256: firstSha256, byteSize: firstBytes.byteLength, mimeType: "audio/mpeg", durationMs: 1_000 },
          { sectionId: "sec_2", assetVersionId: "nav_section_two", id: "ast_section_two", workspaceId, projectId, objectKey: secondObjectKey, sha256: secondSha256, byteSize: secondBytes.byteLength, mimeType: "audio/mpeg", durationMs: 1_000 },
        ],
        compositionPlan: {
          target_duration_ms: 2_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION",
          audio_plan: {
            version: 1,
            target_duration_ms: 2_000,
            narration_sections: [
              { section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY", narration_asset_version_id: "nav_section_one" },
              { section_id: "sec_2", start_ms: 1_000, end_ms: 2_000, visual_role: "PRIMARY", narration_asset_version_id: "nav_section_two" },
            ],
            stitch_policy: "CONTINUOUS_NARRATION",
            tracks: [
              { track_id: "narration-ast_section_one", ownership: "PLATFORM_NARRATION", asset_id: "ast_section_one", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false },
              { track_id: "segment-1", ownership: "PROVIDER_DIALOGUE", asset_id: "ast_section_source_one", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false },
              { track_id: "segment-2", ownership: "PROVIDER_DIALOGUE", asset_id: "ast_section_source_two", start_ms: 1_000, end_ms: 2_000, gain_db: "0", duck_under_narration: false },
              { track_id: "narration-ast_section_two", ownership: "PLATFORM_NARRATION", asset_id: "ast_section_two", start_ms: 1_000, end_ms: 2_000, gain_db: "0", duck_under_narration: false },
            ],
          },
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [
          { sequence: 1, taskRunId: "tsk_section_narration_one", sourceAsset: { id: "ast_section_source_one", objectKey: firstSourceObjectKey, sha256: firstSourceSha256, byteSize: firstSourceBytes.byteLength, mimeType: "video/mp4" } },
          { sequence: 2, taskRunId: "tsk_section_narration_two", sourceAsset: { id: "ast_section_source_two", objectKey: secondSourceObjectKey, sha256: secondSourceSha256, byteSize: secondSourceBytes.byteLength, mimeType: "video/mp4" } },
        ],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { return undefined; },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("QC should not run"); },
    async inspectAudio(input) {
      const bytes = new Uint8Array(input.bytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      return { mime_type: "audio/mpeg" as const, sha256: digest, byte_size: bytes.byteLength, duration_ms: 1_000 };
    },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("independent narration must bypass synthesis"); },
    async compose(input) {
      receivedTracks = input.narrationTrackBytes?.map((track) => ({ track_id: track.track_id, bytes: new Uint8Array(track.bytes) }));
      assert.equal(input.narrationBytes, undefined);
      assert.equal(input.musicBytes, undefined);
      assert.deepEqual(input.segments, [firstSourceBytes, secondSourceBytes]);
      assert.deepEqual(input.compositionPlan?.music_segments_ms, []);
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 2_000 } };
    },
    async finalReview() {
      return { status: "PASS" as const, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" as const };
    },
  }, { consumerName: "section-narration-test", workerId: "section-narration-worker", leaseMs: 100 });

  await consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!);
  assert.deepEqual(receivedTracks?.map((track) => track.track_id), ["narration-ast_section_one", "narration-ast_section_two"]);
  assert.deepEqual(receivedTracks?.map((track) => [...track.bytes]), [[...firstBytes], [...secondBytes]]);
  assert.equal(synthesizeCalls, 0);
  assert.equal(persisted, 1);
});

test("E11 short narration with a declared MUSIC window reaches the existing consumer compose path", async () => {
  const storage = createInMemoryStoragePort();
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const sourceBytes = new TextEncoder().encode("e11-short-music-source-mp4");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = `${workspaceId}/${projectId}/ast_e11_short_music_source/generated.mp4`;
  const narrationBytes = new TextEncoder().encode("e11-short-narration-wav");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = `${workspaceId}/${projectId}/ast_e11_short_narration/narration.wav`;
  const musicBytes = new TextEncoder().encode("e11-music-mp3");
  const musicSha256 = createHash("sha256").update(musicBytes).digest("hex");
  const musicObjectKey = `${workspaceId}/${projectId}/ast_e11_music/music.mp3`;
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  await storage.putObject({ objectKey: narrationObjectKey, mimeType: "audio/wav", bytes: narrationBytes, ifNoneMatch: "*" });
  await storage.putObject({ objectKey: musicObjectKey, mimeType: "audio/mpeg", bytes: musicBytes, ifNoneMatch: "*" });
  const event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_e11_short_music",
    event_id: "evt_e11_short_music",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let composeCalls = 0;
  let persisted: Record<string, unknown> | undefined;
  const finalBytes = new TextEncoder().encode("e11-short-music-final-mp4");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_e11_short_music",
        narrationScriptText: "短旁白",
        narrationSegments: [{ text: "短旁白", startMs: 0 }],
        narrationAsset: {
          id: "ast_e11_short_narration",
          workspaceId,
          projectId,
          objectKey: narrationObjectKey,
          sha256: narrationSha256,
          byteSize: narrationBytes.byteLength,
          mimeType: "audio/wav",
          durationMs: 1_000,
        },
        compositionPlan: {
          target_duration_ms: 2_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION",
          audio_tracks: [
            { track_id: "platform-narration", ownership: "PLATFORM_NARRATION", asset_id: "ast_e11_short_narration", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false },
            { track_id: "music", ownership: "MUSIC", asset_id: "ast_e11_music", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: true },
          ],
          music_mix: { enabled: true },
          music_segments_ms: [{ start_ms: 0, end_ms: 2_000 }],
        },
        musicAsset: {
          id: "ast_e11_music",
          workspaceId,
          projectId,
          objectKey: musicObjectKey,
          sha256: musicSha256,
          byteSize: musicBytes.byteLength,
          mimeType: "audio/mpeg",
          durationMs: 2_000,
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_e11_short_music",
          sourceAsset: { id: "ast_e11_short_music_source", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4", durationMs: 2_000 },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition(input) { persisted = input as unknown as Record<string, unknown>; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { return undefined; },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("QC should not run"); },
    async inspectAudio(input) {
      assert.deepEqual(input.bytes, narrationBytes);
      assert.equal(input.expectedSha256, narrationSha256);
      return { mime_type: "audio/wav" as const, sha256: narrationSha256, byte_size: narrationBytes.byteLength, duration_ms: 1_000 };
    },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async synthesizeNarration() { throw new Error("approved short narration must bypass synthesis"); },
    async compose(input) {
      composeCalls += 1;
      assert.deepEqual(input.segments, [sourceBytes]);
      assert.deepEqual(input.narrationBytes, narrationBytes);
      assert.deepEqual(input.musicBytes, musicBytes);
      assert.deepEqual(input.compositionPlan?.music_segments_ms, [{ start_ms: 0, end_ms: 2_000 }]);
      assert.equal(input.compositionPlan?.audio_tracks?.find((track) => track.ownership === "MUSIC")?.asset_id, "ast_e11_music");
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 2_000 } };
    },
    async finalReview() {
      return { status: "PASS" as const, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" as const };
    },
  }, { consumerName: "e11-short-music-test", workerId: "e11-short-music-worker", leaseMs: 100 });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!), "CLAIMED");
  assert.equal(composeCalls, 1);
  assert.equal((persisted?.finalReview as { audio_summary?: { music_applied?: boolean } } | undefined)?.audio_summary?.music_applied, true);
});

test("short independent narration uses full-target MUSIC coverage and rejects an undeclared tail", async () => {
  const runCase = async (withMusic: boolean) => {
    const storage = createInMemoryStoragePort();
    const workspaceId = qcRequestedEvent.workspace_id;
    const projectId = qcRequestedEvent.project_id!;
    const sourceBytes = new TextEncoder().encode(`independent-short-${withMusic ? "music" : "no-music"}-source`);
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const sourceObjectKey = `${workspaceId}/${projectId}/ast_independent_short_source/generated.mp4`;
    const firstBytes = new TextEncoder().encode("independent-short-one-wav");
    const secondBytes = new TextEncoder().encode("independent-short-two-wav");
    const firstSha256 = createHash("sha256").update(firstBytes).digest("hex");
    const secondSha256 = createHash("sha256").update(secondBytes).digest("hex");
    const firstObjectKey = `${workspaceId}/${projectId}/ast_independent_short_one/narration.wav`;
    const secondObjectKey = `${workspaceId}/${projectId}/ast_independent_short_two/narration.wav`;
    const musicBytes = new TextEncoder().encode("independent-short-music-mp3");
    const musicSha256 = createHash("sha256").update(musicBytes).digest("hex");
    const musicObjectKey = `${workspaceId}/${projectId}/ast_independent_short_music/music.mp3`;
    await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
    await storage.putObject({ objectKey: firstObjectKey, mimeType: "audio/wav", bytes: firstBytes, ifNoneMatch: "*" });
    await storage.putObject({ objectKey: secondObjectKey, mimeType: "audio/wav", bytes: secondBytes, ifNoneMatch: "*" });
    if (withMusic) {
      await storage.putObject({ objectKey: musicObjectKey, mimeType: "audio/mpeg", bytes: musicBytes, ifNoneMatch: "*" });
    }
    const event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
      ...qcRequestedEvent,
      message_id: `msg_independent_short_${withMusic ? "music" : "no_music"}`,
      event_id: `evt_independent_short_${withMusic ? "music" : "no_music"}`,
      event_type: "video_version.composition_requested",
      aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
      data: { production_run_id: qcRequestedEvent.data.production_run_id },
    };
    const finalBytes = new TextEncoder().encode("independent-short-final-mp4");
    const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
    const narrationTracks = [
      { track_id: "narration-ast_independent_short_one", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast_independent_short_one", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false },
      { track_id: "narration-ast_independent_short_two", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast_independent_short_two", start_ms: 1_000, end_ms: 2_000, gain_db: "0", duck_under_narration: false },
    ];
    const sourceTrack = { track_id: "segment-1", ownership: "PROVIDER_DIALOGUE" as const, asset_id: "ast_independent_short_source", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false };
    const musicTrack = { track_id: "music", ownership: "MUSIC" as const, asset_id: "ast_independent_short_music", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: true };
    const consumer = new MediaRuntimeEventConsumer({
      async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
      async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
      async findProductionCompositionInput() {
        return {
          workspaceId,
          projectId,
          productionRunId: event.data.production_run_id,
          storyboardRevisionId: `sbr_independent_short_${withMusic ? "music" : "no_music"}`,
          narrationScriptText: "第一段。第二段。",
          narrationSegments: [{ text: "第一段。", startMs: 0 }, { text: "第二段。", startMs: 1_000 }],
          narrationAssets: [
            { sectionId: "sec_1", assetVersionId: "nav_independent_short_one", id: "ast_independent_short_one", workspaceId, projectId, objectKey: firstObjectKey, sha256: firstSha256, byteSize: firstBytes.byteLength, mimeType: "audio/wav", durationMs: 500 },
            { sectionId: "sec_2", assetVersionId: "nav_independent_short_two", id: "ast_independent_short_two", workspaceId, projectId, objectKey: secondObjectKey, sha256: secondSha256, byteSize: secondBytes.byteLength, mimeType: "audio/wav", durationMs: 500 },
          ],
          compositionPlan: {
            target_duration_ms: 2_000,
            transitions: [],
            bridge_durations_ms: [],
            audio_policy: "CONTINUOUS_NARRATION",
            audio_plan: {
              version: 1,
              target_duration_ms: 2_000,
              narration_sections: [
                { section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY", narration_asset_version_id: "nav_independent_short_one" },
                { section_id: "sec_2", start_ms: 1_000, end_ms: 2_000, visual_role: "PRIMARY", narration_asset_version_id: "nav_independent_short_two" },
              ],
              stitch_policy: "CONTINUOUS_NARRATION",
              tracks: [
                ...narrationTracks,
                sourceTrack,
                ...(withMusic ? [musicTrack] : []),
              ],
            },
            music_mix: { enabled: withMusic },
            music_segments_ms: withMusic ? [{ start_ms: 0, end_ms: 2_000 }] : [],
          },
          ...(withMusic ? {
            musicAsset: {
              id: "ast_independent_short_music",
              workspaceId,
              projectId,
              objectKey: musicObjectKey,
              sha256: musicSha256,
              byteSize: musicBytes.byteLength,
              mimeType: "audio/mpeg",
              durationMs: 2_000,
            },
          } : {}),
          segments: [{
            sequence: 1,
            taskRunId: `tsk_independent_short_${withMusic ? "music" : "no_music"}`,
            sourceAsset: { id: "ast_independent_short_source", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4", durationMs: 2_000 },
          }],
        };
      },
      async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
      async completeProductionComposition() { return undefined; },
      async recordNarrationDurationFeedback() { return undefined; },
      async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to the dead-letter path"); },
      async completeMediaRuntimeEvent() { return undefined; },
      async releaseMediaRuntimeEvent() { return undefined; },
    }, storage, {
      async inspect() { throw new Error("QC should not run"); },
      async inspectAudio(input) {
        const bytes = new Uint8Array(input.bytes);
        const digest = createHash("sha256").update(bytes).digest("hex");
        return { mime_type: "audio/wav" as const, sha256: digest, byte_size: bytes.byteLength, duration_ms: 500 };
      },
      async extractHandoffFrame() { throw new Error("handoff should not run"); },
      async synthesizeNarration() { throw new Error("approved section narration must bypass synthesis"); },
      async compose(input) {
        assert.equal(input.narrationBytes, undefined);
        assert.equal(input.narrationTrackBytes?.length, 2);
        assert.equal(Boolean(input.musicBytes), withMusic);
        return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 2_000 } };
      },
      async finalReview() { return { status: "PASS" as const, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" as const }; },
    }, { consumerName: `independent-short-${withMusic ? "music" : "no-music"}-test`, workerId: `independent-short-${withMusic ? "music" : "no-music"}-worker`, leaseMs: 100 });

    const message = createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!;
    if (withMusic) {
      assert.equal(await consumer.process(message), "CLAIMED");
    } else {
      await assert.rejects(consumer.process(message), /section narration duration does not match its measured AudioPlan window/);
    }
  };

  await runCase(true);
  await runCase(false);
});

test("section narration asset version drift fails closed before runtime composition", async () => {
  const storage = createInMemoryStoragePort();
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const sourceBytes = new TextEncoder().encode("section-version-drift-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = `${workspaceId}/${projectId}/ast_section_version_source/generated.mp4`;
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const narrationBytes = new TextEncoder().encode("section-version-drift-wav");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = `${workspaceId}/${projectId}/ast_section_version_narration/narration.wav`;
  const event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_section_version_drift",
    event_id: "evt_section_version_drift",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let composeCalls = 0;
  let persisted = 0;
  const released: Array<Record<string, unknown>> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_section_version_drift",
        narrationScriptText: "第一段。",
        narrationAssets: [{
          sectionId: "sec_1",
          assetVersionId: "nav_wrong_version",
          id: "ast_section_version_narration",
          workspaceId,
          projectId,
          objectKey: narrationObjectKey,
          sha256: narrationSha256,
          byteSize: narrationBytes.byteLength,
          mimeType: "audio/wav",
          durationMs: 1_000,
        }],
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION",
          audio_plan: {
            version: 1,
            target_duration_ms: 1_000,
            narration_sections: [{
              section_id: "sec_1",
              start_ms: 0,
              end_ms: 1_000,
              visual_role: "PRIMARY",
              narration_asset_version_id: "nav_expected_version",
            }],
            stitch_policy: "CONTINUOUS_NARRATION",
            tracks: [
              { track_id: "narration-ast_section_version_narration", ownership: "PLATFORM_NARRATION", asset_id: "ast_section_version_narration", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false },
              { track_id: "segment-1", ownership: "PROVIDER_DIALOGUE", asset_id: "ast_section_version_source", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false },
            ],
          },
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_section_version_drift",
          sourceAsset: { id: "ast_section_version_source", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { throw new Error("event must not complete"); },
    async releaseMediaRuntimeEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, storage, {
    async inspect() { throw new Error("inspect should not run"); },
    async inspectAudio() { throw new Error("inspectAudio should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async compose() { composeCalls += 1; throw new Error("compose must not run"); },
  }, { consumerName: "section-version-drift-test", workerId: "section-version-drift-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!),
    /section narration asset does not match its source AudioPlan section and track/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
  assert.equal(released.length, 1);
  assert.match(String(released[0]?.reason), /section narration asset does not match/);
});

test("approved timeline without a standalone asset fails closed before runtime synthesis", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("cue-timeline-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_cue_timeline/source.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_cue_timeline_synthesis",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let composeCalls = 0;
  let persisted = 0;
  const finalBytes = new TextEncoder().encode("cue-timeline-final");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      throw new Error("QC_FAILED: approved narration without a standalone asset requires a single continuous cue or approved timing asset.");
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("failure should not run"); },
    async completeMediaRuntimeEvent() { return undefined; },
    async releaseMediaRuntimeEvent() { throw new Error("release should not run"); },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration() { throw new Error("runtime synthesis must not be reached"); },
    async compose(input) {
      composeCalls += 1;
      assert.deepEqual(input.narrationBytes, new Uint8Array([1, 2, 3]));
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 2_000 } };
    },
    async finalReview(input) {
      assert.equal(input.scriptText, "第一句。 第二句。");
      return { status: "PASS" as const, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" as const };
    },
  }, { consumerName: "cue-timeline-test", workerId: "cue-timeline-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /approved narration without a standalone asset/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
});

test("continuous narration blocks source audio with no persisted ownership fact", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("unclassified-source-audio");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_unclassified/source.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_unclassified_source_audio",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let synthesizeCalls = 0;
  let composeCalls = 0;
  let persisted = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_unclassified",
        narrationSegments: [{ text: "批准旁白", startMs: 0 }],
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION",
          audio_tracks: [
            { track_id: "platform-narration", ownership: "PLATFORM_NARRATION", start_ms: 0, end_ms: 1_000 },
            { track_id: "segment-1", ownership: "LEGACY_PRESERVE", start_ms: 0, end_ms: 1_000 },
          ],
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{ sequence: 1, taskRunId: "tsk_unclassified", sourceAsset: { id: "ast_unclassified", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" } }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("not used"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent() { return undefined; },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("must not synthesize unclassified source audio"); },
    async compose() { composeCalls += 1; throw new Error("must not compose unclassified source audio"); },
  }, { consumerName: "unclassified-audio-test", workerId: "unclassified-audio-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /explicit source audio ownership/,
  );
  assert.equal(synthesizeCalls, 0);
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
});

test("explicit narration without an approved timeline fails closed before compose", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("missing-timeline-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const objectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_missing_timeline/generated.mp4";
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_missing_narration_timeline",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let composeCalls = 0;
  let persisted = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_missing_timeline",
        narrationSegments: [{ text: "第一句", startMs: 0 }, { text: "第二句", startMs: 500 }],
        compositionPlan: { target_duration_ms: 1000, transitions: [], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION", music_mix: { enabled: false }, music_segments_ms: [] },
        segments: [{ sequence: 1, taskRunId: "tsk_missing_timeline", sourceAsset: { id: "ast_missing_timeline", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" } }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("not used"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent() { return undefined; },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration() { throw new Error("synthesis must not start without cues"); },
    async compose() { composeCalls += 1; throw new Error("must not compose"); },
  }, { consumerName: "missing-timeline-test", workerId: "missing-timeline-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /multi-cue narration requires an approved full narration asset or OpenMontage full_mix/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
});

test("continuous narration with only script text does not implicitly invoke Piper", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("script-only-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const objectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_script_only/generated.mp4";
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_script_only_narration",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let synthesizeCalls = 0;
  let composeCalls = 0;
  let persisted = 0;
  const released: unknown[] = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_script_only",
        scriptText: "只有脚本文本。",
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION" as const,
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_script_only",
          sourceAsset: { id: "ast_script_only", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("not used"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent(input) { released.push(input); },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("must not synthesize script-only narration"); },
    async compose() { composeCalls += 1; throw new Error("must not compose script-only narration"); },
  }, { consumerName: "script-only-test", workerId: "script-only-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /explicit source audio ownership for every segment/,
  );
  assert.equal(synthesizeCalls, 0);
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
  assert.equal(released.length, 1);
});

test("continuous narration with one cue and no approved asset does not invoke Piper", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("cue-only-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const objectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_cue_only/generated.mp4";
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_cue_only_narration",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let synthesizeCalls = 0;
  let composeCalls = 0;
  const released: unknown[] = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_cue_only",
        scriptText: "单条旁白 cue",
        narrationSegments: [{ text: "单条旁白 cue", startMs: 0 }],
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION" as const,
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_cue_only",
          sourceAsset: { id: "ast_cue_only", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { throw new Error("must not complete"); },
    async failMediaRuntimeEvent() { throw new Error("not used"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent(input) { released.push(input); },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("must not synthesize cue-only narration"); },
    async compose() { composeCalls += 1; throw new Error("must not compose cue-only narration"); },
  }, { consumerName: "cue-only-test", workerId: "cue-only-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /explicit source audio ownership for every segment/,
  );
  assert.equal(synthesizeCalls, 0);
  assert.equal(composeCalls, 0);
  assert.equal(released.length, 1);
});

test("continuous narration with one default cue uses provider text input for Doubao", async () => {
  const storage = createInMemoryStoragePort();
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const sourceBytes = new TextEncoder().encode("structured-cue-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = `${workspaceId}/${projectId}/ast_structured_cue/source.mp4`;
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const generatedBytes = new TextEncoder().encode("structured-cue-generated-wav");
  const generatedSha256 = createHash("sha256").update(generatedBytes).digest("hex");
  const finalBytes = new TextEncoder().encode("structured-cue-final-mp4");
  const finalSha256 = createHash("sha256").update(finalBytes).digest("hex");
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_structured_cue_narration",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  const cue: MediaRuntimeNarrationSegment = {
    text: "provider-text-default",
    provider_text: "provider-text-default",
    start_ms: 0,
  };
  let capturedInput: { scriptText?: string; segments?: MediaRuntimeNarrationSegment[]; targetDurationMs?: number; preferredProvider?: string } | undefined;
  let composeCalls = 0;
  let persisted = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_structured_cue",
        narrationSegments: [{
          text: cue.provider_text!,
          startMs: cue.start_ms,
        }],
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION" as const,
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_structured_cue",
          sourceAsset: { id: "ast_structured_cue", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("not used"); },
    async completeMediaRuntimeEvent() { return undefined; },
    async releaseMediaRuntimeEvent() { return undefined; },
  }, storage, {
    narrationProvider: "doubao",
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration(input) {
      capturedInput = input;
      return { bytes: generatedBytes, mime_type: "audio/wav" as const, sha256: generatedSha256, byte_size: generatedBytes.byteLength, duration_ms: 1_000 };
    },
    async compose(input) {
      composeCalls += 1;
      assert.deepEqual(input.segments, [sourceBytes]);
      assert.deepEqual(input.narrationBytes, generatedBytes);
      return { bytes: finalBytes, inspection: { sha256: finalSha256, byte_size: finalBytes.byteLength, duration_ms: 1_000 } };
    },
    async finalReview(input) {
      assert.equal(input.scriptText, cue.text);
      return { status: "PASS" as const, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" as const };
    },
  }, { consumerName: "structured-cue-test", workerId: "structured-cue-worker", leaseMs: 100 });

  assert.equal(await consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!), "CLAIMED");
  assert.equal(capturedInput?.scriptText, cue.provider_text);
  assert.equal(capturedInput?.segments, undefined);
  assert.equal(capturedInput?.targetDurationMs, 1_000);
  assert.equal(capturedInput?.preferredProvider, "doubao");
  assert.equal(composeCalls, 1);
  assert.equal(persisted, 1);
});

test("continuous narration rejects non-default cue delivery before Doubao Runtime", async () => {
  const storage = createInMemoryStoragePort();
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const sourceBytes = new TextEncoder().encode("doubao-non-default-cue-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = `${workspaceId}/${projectId}/ast_doubao_non_default/source.mp4`;
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_doubao_non_default_cue",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let synthesizeCalls = 0;
  let composeCalls = 0;
  let persisted = 0;
  let releaseCalls = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_doubao_non_default",
        narrationSegments: [{ text: "provider-text-with-pause", startMs: 0, pauseAfterMs: 250 }],
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "CONTINUOUS_NARRATION" as const,
          music_mix: { enabled: false },
          music_segments_ms: [],
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_doubao_non_default",
          sourceAsset: { id: "ast_doubao_non_default", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async failMediaRuntimeEvent() { throw new Error("not used"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent() { releaseCalls += 1; },
  }, storage, {
    narrationProvider: "doubao",
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async synthesizeNarration() { synthesizeCalls += 1; throw new Error("must not call Doubao with structured metadata"); },
    async compose() { composeCalls += 1; throw new Error("must not compose"); },
  }, { consumerName: "doubao-non-default-test", workerId: "doubao-non-default-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!),
    /MEDIA_RUNTIME_UNAVAILABLE: selected narration provider cannot consume structured cue delivery metadata/,
  );
  assert.equal(synthesizeCalls, 0);
  assert.equal(composeCalls, 0);
  assert.equal(persisted, 0);
  assert.equal(releaseCalls, 1);
});

test("stale composition requests may complete when the repository reports no live run", async () => {
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_stale_composition",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let completed = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    // The repository contract reserves undefined for stale/duplicate runs;
    // live REVIEWING input failures are represented by the typed QC error.
    async findProductionCompositionInput() { return undefined; },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { throw new Error("not used"); },
    async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to dead-letter path"); },
    async completeMediaRuntimeEvent() { completed += 1; },
    async releaseMediaRuntimeEvent() { throw new Error("stale event should complete"); },
  }, createInMemoryStoragePort(), {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async compose() { throw new Error("not used"); },
  }, { consumerName: "stale-composition-test", workerId: "stale-composition-worker", leaseMs: 100 });

  await consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!);
  assert.equal(completed, 1);
});

test("live composition input failures are released for retry and never acknowledged", async () => {
  const event = {
    ...qcRequestedEvent,
    event_id: "evt_blocked_composition_input",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  let completed = 0;
  const released: Array<Record<string, unknown>> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      throw new ProductionCompositionInputUnavailableError("approved narration timeline is required before composition");
    },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { throw new Error("not used"); },
    async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to dead-letter path"); },
    async completeMediaRuntimeEvent() { completed += 1; },
    async releaseMediaRuntimeEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, createInMemoryStoragePort(), {
    async inspect() { throw new Error("not used"); },
    async extractHandoffFrame() { throw new Error("not used"); },
    async compose() { throw new Error("not used"); },
  }, { consumerName: "blocked-composition-test", workerId: "blocked-composition-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /QC_FAILED: approved narration timeline is required/,
  );
  assert.equal(completed, 0);
  assert.equal(released.length, 1);
  assert.equal(released[0]?.deadLetter, false);
  assert.match(String(released[0]?.reason), /QC_FAILED/);
});

test("overlong narration rejects before compose or persistence", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("mp4");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const objectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_overlong/generated.mp4";
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const narrationBytes = new TextEncoder().encode("overlong-approved-narration-wav");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_overlong_narration/narration.wav";
  await storage.putObject({ objectKey: narrationObjectKey, mimeType: "audio/wav", bytes: narrationBytes, ifNoneMatch: "*" });
  const event = { ...qcRequestedEvent, event_id: "evt_overlong", event_type: "video_version.composition_requested" as const, aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id }, data: { production_run_id: qcRequestedEvent.data.production_run_id } };
  let composeCalls = 0;
  let reviewCalls = 0;
  let persisted = 0;
  const durationFeedback: Array<Record<string, unknown>> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() { return { workspaceId: event.workspace_id, projectId: event.project_id!, productionRunId: event.data.production_run_id, storyboardRevisionId: "sbr_overlong", scriptText: "超长旁白", narrationSegments: [{ text: "超长旁白", startMs: 0 }], narrationAsset: { id: "ast_overlong_narration", workspaceId: event.workspace_id, projectId: event.project_id!, objectKey: narrationObjectKey, sha256: narrationSha256, byteSize: narrationBytes.byteLength, mimeType: "audio/wav", durationMs: 2001 }, compositionPlan: { target_duration_ms: 1000, transitions: [], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION", music_mix: { enabled: false }, music_segments_ms: [] }, segments: [{ sequence: 1, taskRunId: "tsk_overlong", sourceAsset: { id: "ast_overlong", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" } }] }; },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { persisted += 1; },
    async recordNarrationDurationFeedback(input) { durationFeedback.push(input.feedback as unknown as Record<string, unknown>); },
    async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to the dead-letter path"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent() { return undefined; },
  }, storage, {
    async inspect() { throw new Error("not used"); }, async inspectAudio(input) { assert.deepEqual([...input.bytes], [...narrationBytes]); return { mime_type: "audio/wav" as const, sha256: narrationSha256, byte_size: narrationBytes.byteLength, duration_ms: 2001 }; }, async extractHandoffFrame() { throw new Error("not used"); },
    async compose() { composeCalls += 1; throw new Error("must not compose"); },
    async finalReview() { reviewCalls += 1; throw new Error("must not review"); },
  }, { consumerName: "overlong-test", workerId: "overlong-worker", leaseMs: 100 });
  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /narration duration requires source SEND_BACK/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(reviewCalls, 0);
  assert.equal(persisted, 0);
  assert.equal(durationFeedback.length, 1);
  assert.equal(durationFeedback[0]?.decision, "SEND_BACK");
});

test("E11 keeps a smaller source-window overrun as an explicit scene-plan adjustment", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("mp4");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const objectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_adjust/generated.mp4";
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const narrationBytes = new TextEncoder().encode("adjust-approved-narration-wav");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_adjust_narration/narration.wav";
  await storage.putObject({ objectKey: narrationObjectKey, mimeType: "audio/wav", bytes: narrationBytes, ifNoneMatch: "*" });
  const event = { ...qcRequestedEvent, event_id: "evt_e11_adjust", event_type: "video_version.composition_requested" as const, aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id }, data: { production_run_id: qcRequestedEvent.data.production_run_id } };
  const feedback: Array<Record<string, unknown>> = [];
  let composeCalls = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_e11_adjust",
        scriptText: "一段自然旁白",
        narrationSegments: [{ text: "一段自然旁白", startMs: 0 }],
        narrationAsset: { id: "ast_adjust_narration", workspaceId: event.workspace_id, projectId: event.project_id!, objectKey: narrationObjectKey, sha256: narrationSha256, byteSize: narrationBytes.byteLength, mimeType: "audio/wav", durationMs: 1_100 },
        compositionPlan: { target_duration_ms: 1_000, transitions: [], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION" as const, music_mix: { enabled: false }, music_segments_ms: [] },
        segments: [{ sequence: 1, taskRunId: "tsk_e11_adjust", sourceAsset: { id: "ast_adjust", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4", durationMs: 1_000 } }],
      };
    },
    async recordNarrationDurationFeedback(input) { feedback.push(input.feedback as unknown as Record<string, unknown>); },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { throw new Error("must not persist"); },
    async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to the dead-letter path"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent() { return undefined; },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async inspectAudio(input) { assert.deepEqual([...input.bytes], [...narrationBytes]); return { mime_type: "audio/wav" as const, sha256: narrationSha256, byte_size: narrationBytes.byteLength, duration_ms: 1_100 }; },
    async extractHandoffFrame() { throw new Error("not used"); },
    async compose() { composeCalls += 1; throw new Error("must not compose"); },
  }, { consumerName: "e11-adjust-test", workerId: "e11-adjust-worker", leaseMs: 100 });
  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /narration duration requires source ADJUST_SCENE_PLAN/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0]?.decision, "ADJUST_SCENE_PLAN");
  assert.equal(feedback[0]?.decision_reason, "WITHIN_25_PERCENT");
});

test("E11 blocks the overlapping source duration options without choosing one", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("mp4");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const objectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_overlap/generated.mp4";
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const narrationBytes = new TextEncoder().encode("overlap-approved-narration-wav");
  const narrationSha256 = createHash("sha256").update(narrationBytes).digest("hex");
  const narrationObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_overlap_narration/narration.wav";
  await storage.putObject({ objectKey: narrationObjectKey, mimeType: "audio/wav", bytes: narrationBytes, ifNoneMatch: "*" });
  const event = { ...qcRequestedEvent, event_id: "evt_e11_overlap", event_type: "video_version.composition_requested" as const, aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id }, data: { production_run_id: qcRequestedEvent.data.production_run_id } };
  const feedback: Array<Record<string, unknown>> = [];
  let composeCalls = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("not used"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: event.workspace_id,
        projectId: event.project_id!,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_e11_overlap",
        scriptText: "一段自然旁白",
        narrationSegments: [{ text: "一段自然旁白", startMs: 0 }],
        narrationAsset: { id: "ast_overlap_narration", workspaceId: event.workspace_id, projectId: event.project_id!, objectKey: narrationObjectKey, sha256: narrationSha256, byteSize: narrationBytes.byteLength, mimeType: "audio/wav", durationMs: 1_200 },
        compositionPlan: { target_duration_ms: 1_000, transitions: [], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION" as const, music_mix: { enabled: false }, music_segments_ms: [] },
        segments: [{ sequence: 1, taskRunId: "tsk_e11_overlap", sourceAsset: { id: "ast_overlap", objectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4", durationMs: 1_000 } }],
      };
    },
    async recordNarrationDurationFeedback(input) { feedback.push(input.feedback as unknown as Record<string, unknown>); },
    async acceptProductionSegmentQc() { throw new Error("not used"); },
    async completeProductionComposition() { throw new Error("must not persist"); },
    async failMediaRuntimeEvent() { throw new Error("terminal failure belongs to the dead-letter path"); },
    async completeMediaRuntimeEvent() { throw new Error("must not complete"); },
    async releaseMediaRuntimeEvent() { return undefined; },
  }, storage, {
    async inspect() { throw new Error("not used"); },
    async inspectAudio(input) { assert.deepEqual([...input.bytes], [...narrationBytes]); return { mime_type: "audio/wav" as const, sha256: narrationSha256, byte_size: narrationBytes.byteLength, duration_ms: 1_200 }; },
    async extractHandoffFrame() { throw new Error("not used"); },
    async compose() { composeCalls += 1; throw new Error("must not compose"); },
  }, { consumerName: "e11-overlap-test", workerId: "e11-overlap-worker", leaseMs: 100 });
  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId: event.workspace_id, event, publishAttempts: 0 })!),
    /overlapping source rules/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0]?.decision, "SOURCE_DECISION_REQUIRED");
  assert.deepEqual(feedback[0]?.source_actions, ["SEND_BACK", "ADJUST_SCENE_PLAN"]);
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

  await consumer.deadLetter({
    eventId: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    reason: "QC_FAILED: generic media validation failure",
  });
  assert.equal(calls[2]?.input.errorCode, "QC_FAILED");
  assert.equal(calls[2]?.input.retryable, false);

  await consumer.deadLetter({
    eventId: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    reason: "QC_FAILED: native provider speech transcript returned zero words.",
  });
  assert.equal(calls[4]?.input.errorCode, "QC_FAILED");
  assert.equal(calls[4]?.input.retryable, true);
});

test("Media Runtime duplicate claims do not reconsume composition inputs or acknowledge twice", async () => {
  let storeCalls = 0;
  let runtimeCalls = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "DUPLICATE" as const }; },
    async findProductionSegmentQcInput() { storeCalls += 1; throw new Error("duplicate must not load QC input"); },
    async findProductionCompositionInput() { storeCalls += 1; throw new Error("duplicate must not load composition input"); },
    async acceptProductionSegmentQc() { storeCalls += 1; throw new Error("duplicate must not persist QC"); },
    async completeProductionComposition() { storeCalls += 1; throw new Error("duplicate must not persist composition"); },
    async failMediaRuntimeEvent() { storeCalls += 1; throw new Error("duplicate must not fail again"); },
    async completeMediaRuntimeEvent() { storeCalls += 1; throw new Error("duplicate must not acknowledge again"); },
    async releaseMediaRuntimeEvent() { storeCalls += 1; throw new Error("duplicate must not release again"); },
  }, createInMemoryStoragePort(), {
    async inspect() { runtimeCalls += 1; throw new Error("duplicate must not inspect"); },
    async extractHandoffFrame() { runtimeCalls += 1; throw new Error("duplicate must not extract"); },
    async compose() { runtimeCalls += 1; throw new Error("duplicate must not compose"); },
  }, { consumerName: "duplicate-consumer-test", workerId: "duplicate-worker", leaseMs: 100 });

  const result = await consumer.process(createMediaRuntimeQueueMessage({
    id: qcRequestedEvent.event_id,
    workspaceId: qcRequestedEvent.workspace_id,
    event: qcRequestedEvent,
    publishAttempts: 0,
  })!);
  assert.equal(result, "DUPLICATE");
  assert.equal(storeCalls, 0);
  assert.equal(runtimeCalls, 0);
});

test("Media Runtime rejects a cross-workspace music asset before composition", async () => {
  const storage = createInMemoryStoragePort();
  const workspaceId = qcRequestedEvent.workspace_id;
  const projectId = qcRequestedEvent.project_id!;
  const sourceBytes = new TextEncoder().encode("cross-workspace-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = `${workspaceId}/${projectId}/ast_cross_workspace_source/source.mp4`;
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const event = {
    ...qcRequestedEvent,
    message_id: "msg_cross_workspace_music",
    event_id: "evt_cross_workspace_music",
    event_type: "video_version.composition_requested" as const,
    aggregate: { type: "production_run" as const, id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  const released: Array<Record<string, unknown>> = [];
  let composeCalls = 0;
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId,
        projectId,
        productionRunId: event.data.production_run_id,
        storyboardRevisionId: "sbr_cross_workspace_music",
        compositionPlan: {
          target_duration_ms: 1_000,
          transitions: [],
          bridge_durations_ms: [],
          audio_policy: "LEGACY_PRESERVE",
          audio_plan: {
            version: 1,
            target_duration_ms: 1_000,
            narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY" }],
            tracks: [{ track_id: "music", ownership: "MUSIC", asset_id: "ast_other_workspace_music", start_ms: 0, end_ms: 1_000, gain_db: "0", duck_under_narration: false }],
            stitch_policy: "LEGACY_PRESERVE",
          },
          music_mix: { enabled: true },
          music_segments_ms: [{ start_ms: 0, end_ms: 1_000 }],
        },
        musicAsset: {
          id: "ast_other_workspace_music",
          workspaceId: "ws_other_workspace",
          projectId: "prj_other_workspace",
          objectKey: "ws_other_workspace/prj_other_workspace/ast_other_workspace_music/music.wav",
          sha256: "1".repeat(64),
          byteSize: 4,
          mimeType: "audio/wav",
        },
        segments: [{
          sequence: 1,
          taskRunId: "tsk_cross_workspace_music",
          sourceAsset: { id: "ast_cross_workspace_source", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4", durationMs: 1_000 },
        }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { throw new Error("composition must not complete"); },
    async failMediaRuntimeEvent() { throw new Error("dead-letter should not run"); },
    async completeMediaRuntimeEvent() { throw new Error("event must not complete"); },
    async releaseMediaRuntimeEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, storage, {
    async inspect() { throw new Error("inspect should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async compose() { composeCalls += 1; throw new Error("cross-workspace music must not compose"); },
  }, { consumerName: "cross-workspace-music-test", workerId: "cross-workspace-music-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: event.event_id, workspaceId, event, publishAttempts: 0 })!),
    /music asset workspace scope does not match/,
  );
  assert.equal(composeCalls, 0);
  assert.equal(released.length, 1);
  assert.equal(released[0]?.deadLetter, false);
  assert.match(String(released[0]?.reason), /music asset workspace scope does not match/);
});

test("Media Runtime releases its lease when composition fails so retries preserve the root error", async () => {
  const storage = createInMemoryStoragePort();
  const sourceBytes = new TextEncoder().encode("composition-source");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceObjectKey = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/generated.mp4";
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "video/mp4", bytes: sourceBytes, ifNoneMatch: "*" });
  const compositionEvent: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> = {
    ...qcRequestedEvent,
    message_id: "msg_c12_composition_release",
    event_id: "evt_c12_composition_release",
    event_type: "video_version.composition_requested",
    aggregate: { type: "production_run", id: qcRequestedEvent.data.production_run_id },
    data: { production_run_id: qcRequestedEvent.data.production_run_id },
  };
  const released: Array<Record<string, unknown>> = [];
  const consumer = new MediaRuntimeEventConsumer({
    async claimMediaRuntimeEvent() { return { kind: "CLAIMED" as const, event: compositionEvent }; },
    async findProductionSegmentQcInput() { throw new Error("QC should not run"); },
    async findProductionCompositionInput() {
      return {
        workspaceId: compositionEvent.workspace_id,
        projectId: compositionEvent.project_id!,
        productionRunId: compositionEvent.data.production_run_id,
        storyboardRevisionId: "sbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
        segments: [{ sequence: 1, taskRunId: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX", sourceAsset: { id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX", objectKey: sourceObjectKey, sha256: sourceSha256, byteSize: sourceBytes.byteLength, mimeType: "video/mp4" } }],
      };
    },
    async acceptProductionSegmentQc() { throw new Error("QC should not run"); },
    async completeProductionComposition() { throw new Error("completion should not run"); },
    async failMediaRuntimeEvent() { throw new Error("dead-letter should not run"); },
    async completeMediaRuntimeEvent() { throw new Error("complete should not run"); },
    async releaseMediaRuntimeEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, storage, {
    async inspect() { throw new Error("inspect should not run"); },
    async extractHandoffFrame() { throw new Error("handoff should not run"); },
    async compose() { throw new Error("QC_FAILED: black frame"); },
  }, { consumerName: "c12-media-service", workerId: "c12-media-worker", leaseMs: 100 });

  await assert.rejects(
    consumer.process(createMediaRuntimeQueueMessage({ id: compositionEvent.event_id, workspaceId: compositionEvent.workspace_id, event: compositionEvent, publishAttempts: 0 })!),
    /QC_FAILED: black frame/,
  );
  assert.equal(released.length, 1);
  assert.equal(released[0]?.deadLetter, false);
  assert.match(String(released[0]?.reason), /QC_FAILED: black frame/);
});
