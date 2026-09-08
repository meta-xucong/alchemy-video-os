import assert from "node:assert/strict";
import test from "node:test";

import { InternalEventEnvelopeSchema, type VideoAudioOwner } from "@alchemy-video/contracts";
import type { PlatformDatabase } from "../src/db.js";
import { DrizzleProductionRepository } from "../src/production-repository.js";

const drizzleName = Symbol.for("drizzle:Name");
const timestamp = "2026-09-01T00:00:00.000Z";

type RowMap = Record<string, unknown[]>;
type RowSequences = Record<string, unknown[][]>;

/**
 * A read-only Drizzle-shaped fixture.  It deliberately ignores SQL
 * predicates: the repository still supplies workspace/project predicates, but
 * this fixture keeps the behavior test local and deterministic.
 */
const fakeDatabase = (rows: RowMap, sequences: RowSequences = {}): PlatformDatabase => {
  const calls = new Map<string, number>();
  const nextRows = (tableName: string) => {
    const sequence = sequences[tableName];
    if (!sequence) return rows[tableName] ?? [];
    const index = calls.get(tableName) ?? 0;
    calls.set(tableName, index + 1);
    return sequence[Math.min(index, sequence.length - 1)] ?? [];
  };
  const db = {
    select() {
      return {
        from(table: Record<symbol, unknown>) {
          const tableName = table[drizzleName] as string;
          const query = {
            where() { return query; },
            orderBy() { return query; },
            limit: async () => nextRows(tableName).slice(0, 1),
            then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(nextRows(tableName)).then(resolve, reject),
          };
          return query;
        },
      };
    },
  };
  return db as unknown as PlatformDatabase;
};

const ids = {
  workspaceId: "ws_native_audio_fixture",
  projectId: "prj_native_audio_fixture",
  productionRunId: "prd_native_audio_fixture",
  storyboardRevisionId: "sbr_native_audio_fixture",
  scriptRevisionId: "scr_native_audio_fixture",
  briefRevisionId: "cbr_native_audio_fixture",
  segmentId: "pse_native_audio_fixture",
  shotSpecId: "sss_native_audio_fixture",
  taskRunId: "tsk_native_audio_fixture",
  sourceAssetId: "ast_native_video_fixture",
  deliveryPlanRevisionId: "dpr_native_audio_fixture",
  narrationScriptRevisionId: "nsr_native_audio_fixture",
  narrationAssetVersionId: "nav_native_audio_fixture",
  narrationAssetId: "ast_native_narration_fixture",
};

const sourceObjectKey = `${ids.workspaceId}/${ids.projectId}/${ids.sourceAssetId}/generated.mp4`;
const narrationObjectKey = `${ids.workspaceId}/${ids.projectId}/${ids.narrationAssetId}/narration.wav`;
const sha256 = "a".repeat(64);

const compositionEvent = () => InternalEventEnvelopeSchema.parse({
  contract_version: "1.0",
  message_id: "msg_native_audio_fixture",
  event_id: "evt_native_audio_fixture",
  event_type: "video_version.composition_requested",
  occurred_at: timestamp,
  trace_id: "trc_native_audio_fixture",
  correlation_id: "cor_native_audio_fixture",
  idempotency_key: "native-audio-composition-fixture",
  producer: "persistence-test",
  workspace_id: ids.workspaceId,
  project_id: ids.projectId,
  aggregate: { type: "production_run", id: ids.productionRunId },
  data: { production_run_id: ids.productionRunId },
  version: 1,
}) as Extract<import("@alchemy-video/contracts").InternalEventEnvelope, { event_type: "video_version.composition_requested" }>;

const productionRun = (overrides: Record<string, unknown> = {}) => ({
  id: ids.productionRunId,
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  storyboardRevisionId: ids.storyboardRevisionId,
  deliveryPlanRevisionId: null,
  status: "REVIEWING",
  acceptedShotCount: 1,
  totalShotCount: 1,
  budgetGuard: { music_plan: { mode: "OFF" } },
  ...overrides,
});

const sourceAsset = (overrides: Record<string, unknown> = {}) => ({
  id: ids.sourceAssetId,
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  status: "READY",
  kind: "VIDEO",
  objectKey: sourceObjectKey,
  sha256,
  byteSize: 1_024,
  mimeType: "video/mp4",
  durationMs: 1_000,
  metadata: {},
  ...overrides,
});

const taskRun = (owner: VideoAudioOwner, overrides: Record<string, unknown> = {}) => ({
  id: ids.taskRunId,
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  status: "SUCCEEDED",
  resultAssetId: ids.sourceAssetId,
  inputSnapshot: {
    model: "grok-imagine-video-1.5",
    prompt: "source dialogue fixture",
    duration: 1,
    resolution: "720p",
    ratio: "16:9",
    reference_asset_ids: [],
    audio_owner: owner,
    visual_input: { mode: "TEXT", references: [] },
  },
  ...overrides,
});

const baseRows = (owner: VideoAudioOwner, overrides: { run?: Record<string, unknown>; task?: Record<string, unknown>; assets?: unknown[] } = {}): RowMap => ({
  production_runs: [productionRun(overrides.run)],
  storyboard_revisions: [{ workspaceId: ids.workspaceId, projectId: ids.projectId, id: ids.storyboardRevisionId, scriptRevisionId: ids.scriptRevisionId }],
  script_revisions: [{ workspaceId: ids.workspaceId, projectId: ids.projectId, id: ids.scriptRevisionId, creativeBriefRevisionId: ids.briefRevisionId }],
  creative_brief_revisions: [{ workspaceId: ids.workspaceId, projectId: ids.projectId, id: ids.briefRevisionId, sourceText: "旁白文案：源对白", stylePreferences: "" }],
  handoff_reviews: [],
  transition_repairs: [],
  production_segments: [{
    id: ids.segmentId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    productionRunId: ids.productionRunId,
    shotSpecId: ids.shotSpecId,
    sequence: 1,
    status: "ACCEPTED",
    taskRunId: ids.taskRunId,
  }],
  task_runs: [taskRun(owner, overrides.task)],
  assets: overrides.assets ?? [sourceAsset()],
  prompt_packages: [{
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    shotSpecId: ids.shotSpecId,
    capabilitySnapshot: {
      motion_plan: {
        voice_performance: {
          delivery_cues: [{ provider_text: "源对白" }],
        },
      },
    },
  }],
});

const handoffReviewRow = (fromSequence: number, toSequence: number, result: string) => ({
  fromSequence,
  toSequence,
  result,
});

const transitionRepairRow = (boundarySequence: number, strategy: string, durationMs = 2_000) => ({
  boundarySequence,
  strategy,
  status: "ACCEPTED",
  durationMs,
});

const twoSegmentCompositionDatabase = (reviews: unknown[], repairs: unknown[] = []) => {
  const secondSourceAssetId = "ast_native_video_fixture_two";
  const secondTaskRunId = "tsk_native_audio_fixture_two";
  const secondSegmentId = "pse_native_audio_fixture_two";
  const secondShotSpecId = "sss_native_audio_fixture_two";
  const firstSource = sourceAsset();
  const secondSource = sourceAsset({
    id: secondSourceAssetId,
    objectKey: `${ids.workspaceId}/${ids.projectId}/${secondSourceAssetId}/generated.mp4`,
  });
  const rows = baseRows("NATIVE_PROVIDER", {
    run: { acceptedShotCount: 2, totalShotCount: 2 },
    assets: [firstSource, secondSource],
  });
  const firstSegment = rows.production_segments[0] as Record<string, unknown>;
  const firstTask = rows.task_runs[0] as Record<string, unknown>;
  const firstPrompt = rows.prompt_packages[0] as Record<string, unknown>;
  const secondTask = { ...firstTask, id: secondTaskRunId, resultAssetId: secondSourceAssetId };
  const secondPrompt = { ...firstPrompt, shotSpecId: secondShotSpecId };
  rows.handoff_reviews = reviews;
  rows.transition_repairs = repairs;
  rows.production_segments = [
    firstSegment,
    { ...firstSegment, id: secondSegmentId, shotSpecId: secondShotSpecId, sequence: 2, taskRunId: secondTaskRunId },
  ];
  rows.task_runs = [firstTask, secondTask];
  rows.prompt_packages = [firstPrompt, secondPrompt];
  return fakeDatabase(rows, {
    assets: [[firstSource], [secondSource]],
    task_runs: [[firstTask], [secondTask]],
    prompt_packages: [[firstPrompt], [secondPrompt]],
  });
};

const approvedNarrationRows = () => ({
  timeline_plans: [{
    id: "tlp_native_audio_fixture",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    deliveryPlanRevisionId: ids.deliveryPlanRevisionId,
    narrationScriptRevisionId: ids.narrationScriptRevisionId,
    narrationAssetVersionId: ids.narrationAssetVersionId,
    effectiveDurationMs: 1_000,
    narrationSections: [{ section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY" }],
    visualSegments: [{ sequence: 1, start_ms: 0, end_ms: 1_000, provider_duration_seconds: 1 }],
    status: "READY",
    decisionReasons: [],
    createdAt: timestamp,
  }],
  narration_script_revisions: [{
    id: ids.narrationScriptRevisionId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    deliveryPlanRevisionId: ids.deliveryPlanRevisionId,
    status: "APPROVED",
    sourceScriptHash: sha256,
    displaySections: [{ id: "sec_1", text: "批准旁白" }],
    spokenSections: [{
      id: "sec_1",
      display_text: "批准旁白",
      provider_text: "批准旁白",
      pronunciation_guides: [],
      delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 },
    }],
    language: "zh-CN",
    normalizationVersion: "c12.7b-local-v1",
    decisionReasons: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  narration_asset_versions: [{
    id: ids.narrationAssetVersionId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    narrationScriptRevisionId: ids.narrationScriptRevisionId,
    assetId: ids.narrationAssetId,
    provider: "piper",
    voiceId: "zh-CN",
    providerSettings: {},
    durationMs: 1_000,
    sampleApproved: false,
    wordTimestampsAssetId: null,
    canonicalTranscriptCheck: { status: "CHECKED", transcript_asset_id: null, matches: true, accuracy: 1, issues: [] },
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  outbox_events: [],
  delivery_plan_revisions: [{ captionPolicy: "OFF" }],
});

test("accepted native-owner composition preserves the source audio boundary without narration work", async () => {
  const repository = new DrizzleProductionRepository(fakeDatabase(baseRows("NATIVE_PROVIDER")));
  const result = await repository.findProductionCompositionInput({ event: compositionEvent() });

  assert.ok(result);
  assert.deepEqual(result.narrationSegments ?? [], []);
  assert.equal(result.scriptText, undefined);
  assert.equal(result.compositionPlan?.audio_policy, "LEGACY_PRESERVE");
  assert.equal(result.compositionPlan?.audio_plan, undefined);
  assert.equal((result.compositionPlan?.audio_tracks ?? []).some((track) => track.ownership === "PLATFORM_NARRATION"), false);
  assert.equal(result.compositionPlan?.music_mix.enabled, false);
  // LEGACY_PRESERVE is the source track-preservation instruction.  The
  // repository does not emit a platform narration track for native audio, so
  // no TTS input can be assembled from this fixture.
});

test("native-owner composition rejects an approved platform narration timeline before assembly", async () => {
  const approved = approvedNarrationRows();
  const repository = new DrizzleProductionRepository(fakeDatabase({
    ...baseRows("NATIVE_PROVIDER", {
      run: { deliveryPlanRevisionId: ids.deliveryPlanRevisionId },
      assets: [approved.narration_asset_versions[0] ? {
        id: ids.narrationAssetId,
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        status: "READY",
        kind: "AUDIO",
        objectKey: narrationObjectKey,
        sha256,
        byteSize: 512,
        mimeType: "audio/wav",
        durationMs: 1_000,
        metadata: {},
      } : sourceAsset(), sourceAsset()],
    }),
    ...approved,
  }, {
    assets: [
      [approved.narration_asset_versions[0] ? {
        id: ids.narrationAssetId,
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        status: "READY",
        kind: "AUDIO",
        objectKey: narrationObjectKey,
        sha256,
        byteSize: 512,
        mimeType: "audio/wav",
        durationMs: 1_000,
        metadata: {},
      } : sourceAsset()],
      [sourceAsset()],
    ],
  }));

  await assert.rejects(
    repository.findProductionCompositionInput({ event: compositionEvent() }),
    /provider-owned segment audio conflicts with an approved platform narration timeline/,
  );
});

test("TTS-owner composition emits a platform narration cue and keeps provider dialogue explicit", async () => {
  const repository = new DrizzleProductionRepository(fakeDatabase(baseRows("TTS")));
  const result = await repository.findProductionCompositionInput({ event: compositionEvent() });

  assert.ok(result);
  assert.equal(result.scriptText, "源对白");
  assert.deepEqual(result.narrationSegments, [{ text: "源对白", startMs: 0 }]);
  assert.equal(result.compositionPlan?.audio_policy, "CONTINUOUS_NARRATION");
  const tracks = result.compositionPlan?.audio_tracks ?? [];
  const narrationTrack = tracks.find((track) => track.ownership === "PLATFORM_NARRATION");
  const providerDialogueTrack = tracks.find((track) => track.ownership === "PROVIDER_DIALOGUE");
  assert.equal(narrationTrack?.start_ms, 0);
  assert.equal(narrationTrack?.end_ms, 1_000);
  assert.equal(narrationTrack?.duck_under_narration, false);
  assert.equal(providerDialogueTrack?.asset_id, ids.sourceAssetId);
  assert.equal(providerDialogueTrack?.duck_under_narration, true);
  assert.equal(result.narrationAsset, undefined);
});

test("reference audio and narration samples are not promoted to a final TTS output", async () => {
  const approved = approvedNarrationRows();
  const sampleAssetId = "ast_narration_sample_fixture";
  const referenceAudioAssetId = "ast_reference_audio_fixture";
  const sampleAsset = {
    ...sourceAsset(),
    id: sampleAssetId,
    kind: "AUDIO" as const,
    objectKey: `${ids.workspaceId}/${ids.projectId}/${sampleAssetId}/sample.mp3`,
    mimeType: "audio/mpeg",
    metadata: { audio_role: "NARRATION_SAMPLE", source_kind: "reference_audio" },
  };
  const referenceAudioAsset = {
    ...sourceAsset(),
    id: referenceAudioAssetId,
    kind: "AUDIO" as const,
    objectKey: `${ids.workspaceId}/${ids.projectId}/${referenceAudioAssetId}/reference.mp3`,
    mimeType: "audio/mpeg",
    metadata: { audio_role: "USER_SOURCE_AUDIO", source_kind: "reference_audio" },
  };
  const sampleVersion = {
    ...approved.narration_asset_versions[0],
    sampleApproved: true,
    assetId: sampleAssetId,
  };
  const repository = new DrizzleProductionRepository(fakeDatabase({
    ...baseRows("TTS", {
      run: { deliveryPlanRevisionId: ids.deliveryPlanRevisionId },
      assets: [sourceAsset(), sampleAsset, referenceAudioAsset],
    }),
    ...approved,
    narration_asset_versions: [sampleVersion],
  }));
  const result = await repository.findProductionCompositionInput({ event: compositionEvent() });

  assert.ok(result);
  assert.equal(result.narrationAsset, undefined);
  assert.equal(result.narrationAssets, undefined);
  assert.equal(result.musicAsset, undefined);
  assert.deepEqual(result.narrationSegments, [{ text: "源对白", startMs: 0 }]);
  const serializedPlan = JSON.stringify(result.compositionPlan);
  assert.equal(serializedPlan.includes(sampleAssetId), false);
  assert.equal(serializedPlan.includes(referenceAudioAssetId), false);
});

test("composition rejects a misaligned handoff review instead of defaulting the boundary to PASS", async () => {
  const repository = new DrizzleProductionRepository(twoSegmentCompositionDatabase([
    handoffReviewRow(2, 3, "PASS"),
  ]));

  await assert.rejects(
    repository.findProductionCompositionInput({ event: compositionEvent() }),
    /handoff reviews are not complete/,
  );
});

test("composition rejects an unknown handoff result instead of defaulting the boundary to PASS", async () => {
  const repository = new DrizzleProductionRepository(twoSegmentCompositionDatabase([
    handoffReviewRow(1, 2, "UNKNOWN"),
  ]));

  await assert.rejects(
    repository.findProductionCompositionInput({ event: compositionEvent() }),
    /handoff reviews are not complete/,
  );
});

test("composition rejects BRIDGE_REQUIRED without an accepted matching BRIDGE repair", async () => {
  const repository = new DrizzleProductionRepository(twoSegmentCompositionDatabase([
    handoffReviewRow(1, 2, "BRIDGE_REQUIRED"),
  ]));

  await assert.rejects(
    repository.findProductionCompositionInput({ event: compositionEvent() }),
    /accepted BRIDGE repair is missing or does not match handoff review/,
  );
});

test("composition maps an accepted BRIDGE repair only to its reviewed boundary", async () => {
  const repository = new DrizzleProductionRepository(twoSegmentCompositionDatabase(
    [handoffReviewRow(1, 2, "BRIDGE_REQUIRED")],
    [transitionRepairRow(2, "BRIDGE")],
  ));
  const result = await repository.findProductionCompositionInput({ event: compositionEvent() });

  assert.ok(result);
  assert.deepEqual(result.compositionPlan?.transitions, ["BRIDGE"]);
  assert.deepEqual(result.compositionPlan?.bridge_durations_ms, [2_000]);
});

test("composition keeps an unavailable or failed handoff as a direct cut needing attention", async () => {
  for (const resultCode of ["UNAVAILABLE", "FAILED"] as const) {
    const repository = new DrizzleProductionRepository(twoSegmentCompositionDatabase([
      handoffReviewRow(1, 2, resultCode),
    ]));
    const result = await repository.findProductionCompositionInput({ event: compositionEvent() });

    assert.ok(result);
    assert.deepEqual(result.compositionPlan?.transitions, ["PASS"]);
  }
});

test("composition rejects a repair attached to an unavailable or failed handoff", async () => {
  for (const resultCode of ["UNAVAILABLE", "FAILED"] as const) {
    const repository = new DrizzleProductionRepository(twoSegmentCompositionDatabase(
      [handoffReviewRow(1, 2, resultCode)],
      [transitionRepairRow(2, "BRIDGE")],
    ));

    await assert.rejects(
      repository.findProductionCompositionInput({ event: compositionEvent() }),
      /transition repair does not match handoff review/,
    );
  }
});
