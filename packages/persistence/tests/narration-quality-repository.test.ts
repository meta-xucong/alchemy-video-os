import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import type { InternalEventEnvelope } from "@alchemy-video/contracts";
import { InMemoryNarrationQualityStore, type DeliveryPreflightStore } from "../src/narration-quality-repository.js";

const workspaceId = createPrefixedId("ws");
const projectId = createPrefixedId("prj");
const deliveryPlanRevisionId = createPrefixedId("dpr");
const sampleAssetId = createPrefixedId("ast");
const formalAssetId = createPrefixedId("ast");
const formalAssetVersionId = createPrefixedId("nav");

const event = (suffix: string) => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
  suffix,
});

const requestHash = (value: string) => value.padEnd(64, "0").slice(0, 64);

const createStore = (eventSink?: (event: InternalEventEnvelope) => void) => {
  let sampleCanonicalScriptHash: string | undefined;
  let sampleReady = true;
  const deliveryStore = {
    async findDeliveryPlanRevision(scopeWorkspaceId: string, id: string) {
      return scopeWorkspaceId === workspaceId && id === deliveryPlanRevisionId
        ? { projectId, targetDurationSeconds: 30 }
        : undefined;
    },
  } as unknown as DeliveryPreflightStore;
  const store = new InMemoryNarrationQualityStore(deliveryStore, {
    async findAsset(scopeWorkspaceId, assetId) {
      if (scopeWorkspaceId !== workspaceId || ![sampleAssetId, formalAssetId].includes(assetId)) return undefined;
      return {
        projectId,
        kind: "AUDIO",
        status: sampleReady ? "READY" : "PENDING_UPLOAD",
        origin: "GENERATED",
        durationMs: 2_000,
        metadata: {
          narration_generation: {
            generation_kind: "SAMPLE",
            provider: "piper",
            voice_id: "platform-generic-zh",
            provider_settings: {},
            canonical_script_hash: sampleCanonicalScriptHash,
          },
        },
      };
    },
  }, eventSink);
  return {
    store,
    setSampleCanonicalScriptHash: (value: string) => { sampleCanonicalScriptHash = value; },
    setSampleReady: (value: boolean) => { sampleReady = value; },
  };
};

test("C12.7B persists canonical transcript quality as unavailable or checked private facts", async () => {
  const sinkEvents: InternalEventEnvelope[] = [];
  const { store, setSampleCanonicalScriptHash } = createStore((event) => sinkEvents.push(event));
  const created = await store.createNarrationScriptRevision({
    scope: "test:create",
    idempotencyKey: "create",
    requestHash: requestHash("create"),
    workspaceId,
    deliveryPlanRevisionId,
    command: {
      display_sections: [{ id: "intro", text: "人工智能完成交付。" }],
      pronunciation_glossary: [],
      normalization_version: "test-v1",
    },
    event: event("create"),
  });
  assert.equal(created.kind, "NEW");
  if (created.kind !== "NEW") return;
  setSampleCanonicalScriptHash(created.value.source_script_hash);

  const approved = await store.approveNarrationScriptRevision({
    scope: "test:approve",
    idempotencyKey: "approve",
    requestHash: requestHash("approve"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      sample_asset_id: sampleAssetId,
      sample_provider: "piper",
      sample_voice_id: "platform-generic-zh",
      sample_provider_settings: {},
      sample_duration_ms: 2_000,
      canonical_script_hash: created.value.source_script_hash,
      word_timestamps_asset_id: null,
    },
    event: event("approve"),
  });
  assert.equal(approved.kind, "NEW");
  if (approved.kind !== "NEW") return;

  const storedAssets = (store as unknown as { assets: Map<string, unknown> }).assets;
  // Sample approval is persisted as the approval event only; no sample bytes
  // are inserted into the formal narration asset-version map.
  assert.equal(storedAssets.size, 0);

  const blockedTimeline = await store.createTimelinePlan({
    scope: "test:timeline",
    idempotencyKey: "timeline",
    requestHash: requestHash("timeline"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      section_durations_ms: [{ section_id: "intro", duration_ms: 2_000 }],
      target_duration_ms: 30_000,
      flexible_percent: 20,
      max_provider_duration_seconds: 15,
    },
    event: event("timeline"),
  });
  assert.deepEqual(blockedTimeline, { kind: "INVALID_TIMELINE" });

  const formalVersion = {
    id: formalAssetVersionId,
    workspace_id: workspaceId,
    project_id: projectId,
    narration_script_revision_id: created.value.id,
    // First model the forbidden case: a formal-looking row reuses the
    // already-approved sample object.  The next call switches to the distinct
    // full-track object and is the only path allowed to create a timeline.
    asset_id: sampleAssetId,
    provider: "piper-local",
    voice_id: "platform-generic-zh",
    provider_settings: { engine: "piper", length_scale: 1 },
    duration_ms: 2_000,
    sample_approved: false,
    word_timestamps_asset_id: null,
    canonical_transcript_check: {
      status: "UNAVAILABLE" as const,
      transcript_asset_id: null,
      matches: null,
      accuracy: null,
      issues: ["未附加可比较的 canonical transcript。"],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  storedAssets.set(formalVersion.id, formalVersion);
  const reusedSample = await store.createTimelinePlan({
    scope: "test:timeline-sample-reused",
    idempotencyKey: "timeline-sample-reused",
    requestHash: requestHash("timeline-sample-reused"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      section_durations_ms: [{ section_id: "intro", duration_ms: 2_000 }],
      target_duration_ms: 30_000,
      flexible_percent: 20,
      max_provider_duration_seconds: 15,
      narration_asset_version_id: formalAssetVersionId,
    },
    event: event("timeline-sample-reused"),
  });
  assert.deepEqual(reusedSample, { kind: "INVALID_TIMELINE" });
  storedAssets.set(formalVersion.id, { ...formalVersion, asset_id: formalAssetId });
  const timeline = await store.createTimelinePlan({
    scope: "test:timeline-formal",
    idempotencyKey: "timeline-formal",
    requestHash: requestHash("timeline-formal"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      section_durations_ms: [{ section_id: "intro", duration_ms: 2_000 }],
      target_duration_ms: 30_000,
      flexible_percent: 20,
      max_provider_duration_seconds: 15,
      narration_asset_version_id: formalAssetVersionId,
    },
    event: event("timeline-formal"),
  });
  assert.equal(timeline.kind, "NEW");
  assert.equal(await store.hasReadyTimelinePlan(workspaceId, projectId, deliveryPlanRevisionId), true);
  assert.deepEqual(store.listEvents(workspaceId).map((value) => value.event_type).sort(), [
    "narration_script.approved",
    "narration_script.normalized",
    "timeline_plan.created",
  ]);
  assert.deepEqual(sinkEvents.map((value) => value.event_type).sort(), [
    "narration_script.approved",
    "narration_script.normalized",
    "timeline_plan.created",
  ]);
});

test("C12.7B rejects timeline creation before sample approval", async () => {
  const { store } = createStore();
  const created = await store.createNarrationScriptRevision({
    scope: "test:create-unapproved",
    idempotencyKey: "create-unapproved",
    requestHash: requestHash("create-unapproved"),
    workspaceId,
    deliveryPlanRevisionId,
    command: {
      display_sections: [{ id: "intro", text: "完成交付。" }],
      pronunciation_glossary: [],
      normalization_version: "test-v1",
    },
    event: event("create-unapproved"),
  });
  assert.equal(created.kind, "NEW");
  if (created.kind !== "NEW") return;
  const result = await store.createTimelinePlan({
    scope: "test:timeline-unapproved",
    idempotencyKey: "timeline-unapproved",
    requestHash: requestHash("timeline-unapproved"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      section_durations_ms: [{ section_id: "intro", duration_ms: 1_000 }],
      target_duration_ms: 15_000,
      flexible_percent: 20,
      max_provider_duration_seconds: 15,
    },
    event: event("timeline-unapproved"),
  });
  assert.deepEqual(result, { kind: "STATE_INVALID" });
});

test("C12.7B rejects declared sample and section durations that do not match measured asset facts", async () => {
  const { store, setSampleCanonicalScriptHash } = createStore();
  const created = await store.createNarrationScriptRevision({
    scope: "test:create-duration",
    idempotencyKey: "create-duration",
    requestHash: requestHash("create-duration"),
    workspaceId,
    deliveryPlanRevisionId,
    command: {
      display_sections: [{ id: "intro", text: "完成交付。" }],
      pronunciation_glossary: [],
      normalization_version: "test-v1",
    },
    event: event("create-duration"),
  });
  assert.equal(created.kind, "NEW");
  if (created.kind !== "NEW") return;
  setSampleCanonicalScriptHash(created.value.source_script_hash);

  const mismatch = await store.approveNarrationScriptRevision({
    scope: "test:approve-duration-mismatch",
    idempotencyKey: "approve-duration-mismatch",
    requestHash: requestHash("approve-duration-mismatch"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      sample_asset_id: sampleAssetId,
      sample_provider: "piper",
      sample_voice_id: "platform-generic-zh",
      sample_provider_settings: {},
      sample_duration_ms: 3_000,
      canonical_script_hash: created.value.source_script_hash,
      word_timestamps_asset_id: null,
    },
    event: event("approve-duration-mismatch"),
  });
  assert.deepEqual(mismatch, { kind: "INVALID_SAMPLE" });

  const approved = await store.approveNarrationScriptRevision({
    scope: "test:approve-duration",
    idempotencyKey: "approve-duration",
    requestHash: requestHash("approve-duration"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      sample_asset_id: sampleAssetId,
      sample_provider: "piper",
      sample_voice_id: "platform-generic-zh",
      sample_provider_settings: {},
      sample_duration_ms: 2_000,
      canonical_script_hash: created.value.source_script_hash,
      word_timestamps_asset_id: null,
    },
    event: event("approve-duration"),
  });
  assert.equal(approved.kind, "NEW");

  const timeline = await store.createTimelinePlan({
    scope: "test:timeline-duration-mismatch",
    idempotencyKey: "timeline-duration-mismatch",
    requestHash: requestHash("timeline-duration-mismatch"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      section_durations_ms: [{ section_id: "intro", duration_ms: 1_000 }],
      target_duration_ms: 15_000,
      flexible_percent: 20,
      max_provider_duration_seconds: 15,
    },
    event: event("timeline-duration-mismatch"),
  });
  assert.deepEqual(timeline, { kind: "INVALID_TIMELINE" });
});

test("C12.7B queues server-generated sample then formal narration once and replays by idempotency", async () => {
  const { store, setSampleCanonicalScriptHash, setSampleReady } = createStore();
  const created = await store.createNarrationScriptRevision({
    scope: "test:generation:create",
    idempotencyKey: "generation-create",
    requestHash: requestHash("generation-create"),
    workspaceId,
    deliveryPlanRevisionId,
    command: {
      display_sections: [{ id: "intro", text: "茅山温泉值得慢慢体验。" }],
      pronunciation_glossary: [],
      normalization_version: "test-v1",
    },
    event: event("generation-create"),
  });
  assert.equal(created.kind, "NEW");
  if (created.kind !== "NEW") return;
  setSampleCanonicalScriptHash(created.value.source_script_hash);
  setSampleReady(false);

  const sampleInput = {
    scope: "test:generation:sample",
    idempotencyKey: "generation-sample",
    requestHash: requestHash("generation-sample"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    assetId: sampleAssetId,
    objectKey: `${workspaceId}/${projectId}/${sampleAssetId}/narration.wav`,
    command: {
      generation_kind: "SAMPLE" as const,
      section_id: "intro",
      provider: "piper",
      voice_id: "platform-generic-zh",
      provider_settings: {},
      canonical_script_hash: created.value.source_script_hash,
    },
    event: event("generation-sample"),
  };
  const sampleQueued = await store.requestNarrationAudioGeneration(sampleInput);
  assert.equal(sampleQueued.kind, "NEW");
  if (sampleQueued.kind !== "NEW") return;
  const sampleEvent = store.listEvents(workspaceId).find((candidate): candidate is Extract<InternalEventEnvelope, { event_type: "narration_audio.generation_requested" }> => candidate.event_type === "narration_audio.generation_requested");
  assert.ok(sampleEvent);
  const sampleCompletion = await store.completeNarrationAudioGeneration({
    event: sampleEvent,
    facts: { mimeType: "audio/wav", sha256: "a".repeat(64), byteSize: 3, durationMs: 2_000 },
  });
  assert.equal(sampleCompletion, undefined);
  setSampleReady(true);

  const approved = await store.approveNarrationScriptRevision({
    scope: "test:generation:approve",
    idempotencyKey: "generation-approve",
    requestHash: requestHash("generation-approve"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    command: {
      sample_asset_id: sampleAssetId,
      sample_provider: "piper",
      sample_voice_id: "platform-generic-zh",
      sample_provider_settings: {},
      sample_duration_ms: 2_000,
      canonical_script_hash: created.value.source_script_hash,
      word_timestamps_asset_id: null,
    },
    event: event("generation-approve"),
  });
  assert.equal(approved.kind, "NEW");
  if (approved.kind !== "NEW") return;

  const formalInput = {
    scope: "test:generation:formal",
    idempotencyKey: "generation-formal",
    requestHash: requestHash("generation-formal"),
    workspaceId,
    narrationScriptRevisionId: created.value.id,
    assetId: formalAssetId,
    narrationAssetVersionId: formalAssetVersionId,
    objectKey: `${workspaceId}/${projectId}/${formalAssetId}/narration.wav`,
    command: {
      generation_kind: "FORMAL" as const,
      section_id: "intro",
      provider: "piper",
      voice_id: "platform-generic-zh",
      provider_settings: {},
      canonical_script_hash: created.value.source_script_hash,
      sample_asset_id: sampleAssetId,
    },
    event: event("generation-formal"),
  };
  const formalQueued = await store.requestNarrationAudioGeneration(formalInput);
  assert.equal(formalQueued.kind, "NEW");
  if (formalQueued.kind !== "NEW") return;
  const formalEvent = store.listEvents(workspaceId).find((candidate): candidate is Extract<InternalEventEnvelope, { event_type: "narration_audio.generation_requested" }> => candidate.event_type === "narration_audio.generation_requested" && candidate.data.generation_kind === "FORMAL");
  assert.ok(formalEvent);
  const formalVersion = await store.completeNarrationAudioGeneration({
    event: formalEvent,
    facts: { mimeType: "audio/wav", sha256: "b".repeat(64), byteSize: 4, durationMs: 2_000 },
  });
  assert.equal(formalVersion?.id, formalAssetVersionId);
  assert.equal(formalVersion?.sample_approved, false);

  const replayedSample = await store.requestNarrationAudioGeneration(sampleInput);
  assert.equal(replayedSample.kind, "REPLAY");
  if (replayedSample.kind === "REPLAY") assert.equal(replayedSample.value.event_id, sampleQueued.value.event_id);
  await assert.rejects(
    store.ensureGeneratedNarrationAsset({
      event: {
        ...sampleEvent,
        event_id: createPrefixedId("evt"),
        data: { ...sampleEvent.data, provider: "doubao" },
      },
    }),
    /identity conflicts/,
  );
  assert.equal(store.listEvents(workspaceId).filter((candidate) => candidate.event_type === "narration_audio.generation_requested").length, 2);
  assert.equal(store.listEvents(workspaceId).filter((candidate) => candidate.event_type === "narration_asset_version.ready").length, 1);
  const generatedAssets = (store as unknown as { generatedAssets: Map<string, { objectKey: string; status: string; facts?: { sha256: string } }> }).generatedAssets;
  assert.equal(generatedAssets.get(formalAssetId)?.objectKey, formalInput.objectKey);
  assert.equal(generatedAssets.get(formalAssetId)?.status, "READY");
  assert.equal(generatedAssets.get(formalAssetId)?.facts?.sha256, "b".repeat(64));
});
