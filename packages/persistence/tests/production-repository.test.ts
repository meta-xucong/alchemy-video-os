import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MediaRuntimeCompositionPlanSchema,
  semanticPromptPackageIntegrityPayload,
} from "@alchemy-video/contracts";
import { canonicalJson } from "@alchemy-video/domain";

import {
  isUsableMusicAsset,
  selectAutoMusicAsset,
  measuredVisualSegmentMatchesRequest,
  resolveAudioOwnerForComposition,
  resolveAudioTrackGainDb,
  compositionQcSafeSummary,
  validateSemanticPromptPackage,
  isApprovedNarrationAuthoritative,
} from "../src/production-repository.js";

test("QC safe summary distinguishes a qualified PASS from complete review", () => {
  assert.equal(compositionQcSafeSummary({ status: "PASS", review_completeness: "PARTIAL" }), "已执行的基础检查通过；部分检查未运行，建议人工复核。");
  assert.equal(compositionQcSafeSummary({ status: "PASS", review_completeness: "COMPLETE" }), "成片检查通过。");
  assert.equal(compositionQcSafeSummary({ status: "NEEDS_ATTENTION", review_completeness: "PARTIAL" }), "检查发现需要复核的质量项；部分检查未运行，建议人工复核。");
});

test("composition-plan schema rejects null track fades instead of treating them as absent", () => {
  const result = MediaRuntimeCompositionPlanSchema.safeParse({
    target_duration_ms: 1_000,
    transitions: [],
    audio_plan: {
      version: 1,
      target_duration_ms: 1_000,
      narration_sections: [{ section_id: "hold", start_ms: 0, end_ms: 1_000, visual_role: "HOLD" }],
      tracks: [{
        track_id: "music",
        ownership: "MUSIC",
        asset_id: "ast_music",
        start_ms: 0,
        end_ms: 1_000,
        gain_db: "0",
        fade_in_ms: null,
        fade_out_ms: null,
      }],
      stitch_policy: "LEGACY_PRESERVE",
    },
  });

  assert.equal(result.success, false);
});

test("explicit Doubao replacement makes approved narration authoritative for native-owned video while Preserve stays closed", () => {
  const preserveProviderAudio = true;
  const selectedReplacement = "DOUBAO_TTS_REPLACE" as const;
  assert.equal(isApprovedNarrationAuthoritative(preserveProviderAudio, selectedReplacement), true);
  assert.equal(isApprovedNarrationAuthoritative(preserveProviderAudio, "PRESERVE_PROVIDER_AUDIO"), false);
  assert.equal(isApprovedNarrationAuthoritative(false, "MUSIC_REPLACE_PROVIDER_AUDIO"), false, "BGM-only mode must never promote script text into narration");
  const audioPlan = {
    version: 1 as const,
    target_duration_ms: 1_000,
    narration_asset_id: "ast_doubao",
    narration_sections: [{
      section_id: "sec_full",
      start_ms: 0,
      end_ms: 1_000,
      visual_role: "PRIMARY" as const,
      narration_asset_version_id: "nav_doubao",
    }],
    tracks: [{
      track_id: "platform-narration",
      ownership: "PLATFORM_NARRATION" as const,
      asset_id: "ast_doubao",
      start_ms: 0,
      end_ms: 1_000,
      gain_db: "0",
      duck_under_narration: false,
    }],
    stitch_policy: "CONTINUOUS_NARRATION" as const,
    transcript_script: "approved speech",
  };
  const replacementPlan = MediaRuntimeCompositionPlanSchema.parse({
    target_duration_ms: 1_000,
    transitions: [],
    audio_policy: "CONTINUOUS_NARRATION",
    audio_selection: "DOUBAO_TTS_REPLACE",
    audio_plan: audioPlan,
  });
  assert.equal(replacementPlan.audio_selection, "DOUBAO_TTS_REPLACE");
  assert.equal(replacementPlan.audio_policy, "CONTINUOUS_NARRATION");
  assert.equal(replacementPlan.audio_plan?.stitch_policy, "CONTINUOUS_NARRATION");
  assert.equal(MediaRuntimeCompositionPlanSchema.safeParse({
    target_duration_ms: 1_000,
    transitions: [],
    audio_policy: "LEGACY_PRESERVE",
    audio_selection: "PRESERVE_PROVIDER_AUDIO",
    audio_plan: audioPlan,
  }).success, false);
});

const semanticHash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const semanticPromptPackageFixture = () => {
  const sourcePrompt = "用户原始故事文本。";
  const sourceHash = createHash("sha256").update(sourcePrompt, "utf8").digest("hex");
  const decisionHash = "d".repeat(64);
  const segmentId = "seg_semantic_projection_001";
  const shotSpecId = "ssp_semantic_projection_001";
  const prompt = "经过编译的语义视频提示。";
  const projectedSourcePrompt = "银白样本瓶保持真实结构。";
  const generatedPromptParts = ["镜头保持冷白实验室照明。"];
  const evidenceIds = ["evd_semantic_projection_001"];
  const dialogueProjection = {
    version: 1 as const,
    source_hash: sourceHash,
    decision_hash: decisionHash,
    segment_id: segmentId,
    dialogues: [],
  };
  const referenceProjection = {
    version: 1 as const,
    source_hash: sourceHash,
    decision_hash: decisionHash,
    segment_id: segmentId,
    references: [],
  };
  const capabilitySnapshot: Record<string, unknown> = {
    prompt_source_kind: "SEMANTIC_VISUAL_PROJECTION",
    authored_source_hash: sourceHash,
    semantic_decision_hash: decisionHash,
    semantic_segment_id: segmentId,
    semantic_dialogue_projection: dialogueProjection,
    semantic_dialogue_projection_hash: semanticHash(dialogueProjection),
    semantic_reference_projection_hash: semanticHash(referenceProjection),
    source_prompt: projectedSourcePrompt,
    generated_prompt_parts: generatedPromptParts,
    audio_owner: "NATIVE_PROVIDER",
    max_duration_seconds: 15,
    max_reference_images: 7,
  };
  capabilitySnapshot.semantic_prompt_package_integrity_hash = semanticHash(
    semanticPromptPackageIntegrityPayload({
      shotSpecId,
      prompt,
      referencePolicy: "REFERENCE_SET",
      sourcePrompt: projectedSourcePrompt,
      generatedPromptParts,
      evidenceIds,
      dialogueProjection,
      referenceProjection,
      audioOwner: "NATIVE_PROVIDER",
      maxDurationSeconds: 15,
      maxReferenceImages: 7,
    }),
  );
  return {
    shotSpecId,
    prompt,
    sourcePrompt,
    referencePolicy: "REFERENCE_SET",
    capabilitySnapshot,
    referenceMap: {
      reference_policy: "REFERENCE_SET",
      semantic_reference_projection: referenceProjection,
    },
    visualConstraints: {
      semantic_decision_hash: decisionHash,
      semantic_segment_id: segmentId,
      evidence_ids: evidenceIds,
    },
  };
};

test("semantic PromptPackage projections must share one source, decision, segment, and policy identity", () => {
  const valid = semanticPromptPackageFixture();
  assert.equal(validateSemanticPromptPackage(valid).kind, "VERIFIED");

  const referenceDecisionSwap = semanticPromptPackageFixture();
  referenceDecisionSwap.referenceMap.semantic_reference_projection.decision_hash = "e".repeat(64);
  assert.equal(validateSemanticPromptPackage(referenceDecisionSwap).kind, "INVALID");

  const dialogueSegmentSwap = semanticPromptPackageFixture();
  (dialogueSegmentSwap.capabilitySnapshot.semantic_dialogue_projection as { segment_id: string }).segment_id = "seg_swapped_002";
  assert.equal(validateSemanticPromptPackage(dialogueSegmentSwap).kind, "INVALID");

  const compiledPromptSwap = semanticPromptPackageFixture();
  compiledPromptSwap.prompt = "被手工替换的 Provider 提示。";
  assert.equal(validateSemanticPromptPackage(compiledPromptSwap).kind, "INVALID");

  const shotSpecSwap = semanticPromptPackageFixture();
  shotSpecSwap.shotSpecId = "ssp_cross_shot_replacement_002";
  assert.equal(validateSemanticPromptPackage(shotSpecSwap).kind, "INVALID");

  const policySwap = semanticPromptPackageFixture();
  policySwap.referenceMap.reference_policy = "TEXT_TRANSITION";
  assert.equal(validateSemanticPromptPackage(policySwap).kind, "INVALID");

  const partialSemanticMarker = semanticPromptPackageFixture();
  delete partialSemanticMarker.capabilitySnapshot.semantic_dialogue_projection;
  assert.equal(validateSemanticPromptPackage(partialSemanticMarker).kind, "INVALID");

  assert.equal(validateSemanticPromptPackage({
    shotSpecId: "ssp_legacy_prompt_001",
    prompt: "legacy prompt",
    sourcePrompt: "legacy",
    referencePolicy: "TEXT_TRANSITION",
    capabilitySnapshot: {},
    referenceMap: { reference_policy: "TEXT_TRANSITION" },
    visualConstraints: {},
  }).kind, "LEGACY");

  assert.equal(validateSemanticPromptPackage({
    shotSpecId: "ssp_historical_missing_sidecars_001",
    prompt: "historical prompt",
    sourcePrompt: "historical source",
    referencePolicy: "TEXT_TRANSITION",
    capabilitySnapshot: undefined,
    referenceMap: undefined,
    visualConstraints: undefined,
  }).kind, "LEGACY");

  assert.equal(validateSemanticPromptPackage({
    shotSpecId: "ssp_partial_semantic_sidecar_001",
    prompt: "partial semantic prompt",
    sourcePrompt: "partial semantic source",
    referencePolicy: "REFERENCE_SET",
    capabilitySnapshot: { prompt_source_kind: "SEMANTIC_VISUAL_PROJECTION" },
    referenceMap: undefined,
    visualConstraints: undefined,
  }).kind, "INVALID");
});

test("measured provider video may exceed its request ceiling by the shared encoder tolerance", () => {
  assert.equal(measuredVisualSegmentMatchesRequest({ measuredDurationMs: 15_042, providerDurationSeconds: 15 }), true);
  assert.equal(measuredVisualSegmentMatchesRequest({ measuredDurationMs: 15_251, providerDurationSeconds: 15 }), false);
  assert.equal(measuredVisualSegmentMatchesRequest({ measuredDurationMs: 14_900, providerDurationSeconds: 15 }), true);
});

test("selected MUSIC gain maps the OpenMontage omitted-volume default and rejects malformed metadata", () => {
  assert.equal(resolveAudioTrackGainDb(undefined), "0");
  assert.equal(resolveAudioTrackGainDb({ audio_gain_db: "-6" }), "-6");
  assert.throws(() => resolveAudioTrackGainDb({ audio_gain_db: "-6dB" }), /audio gain metadata is invalid/);
});

test("provider-owned composition audio requires one explicit owner across accepted segments", () => {
  assert.equal(resolveAudioOwnerForComposition([
    { kind: "KNOWN", owner: "NATIVE_PROVIDER" },
    { kind: "KNOWN", owner: "NATIVE_PROVIDER" },
  ]), "NATIVE_PROVIDER");
  assert.equal(resolveAudioOwnerForComposition([
    { kind: "ABSENT" },
    { kind: "ABSENT" },
  ]), undefined);
  assert.throws(() => resolveAudioOwnerForComposition([
    { kind: "KNOWN", owner: "NATIVE_PROVIDER" },
    { kind: "KNOWN", owner: "TTS" },
  ]), /mixed or unknown audio owners/);
  assert.throws(() => resolveAudioOwnerForComposition([
    { kind: "KNOWN", owner: "NATIVE_PROVIDER" },
    { kind: "ABSENT" },
  ]), /mixed or unknown audio owners/);
});

test("AUTO music preserves MUSIC role isolation and target-duration coverage", () => {
  const candidate = (audioRole: string | undefined, durationMs: number | null) => ({
    id: "ast_music_scoped",
    workspaceId: "ws_music_scoped",
    projectId: "prj_music_scoped",
    kind: "AUDIO",
    status: "READY",
    objectKey: "ws_music_scoped/prj_music_scoped/ast_music_scoped/music.mp3",
    sha256: "a".repeat(64),
    byteSize: 100,
    mimeType: "audio/mpeg",
    durationMs,
    metadata: { audio_role: audioRole },
  });
  assert.equal(isUsableMusicAsset(candidate("MUSIC", 30_000), { minimumDurationMs: 30_000 }), true);
  assert.equal(isUsableMusicAsset(candidate("MUSIC", 29_999), { minimumDurationMs: 30_000 }), false);
  assert.equal(isUsableMusicAsset(candidate("MUSIC", null), { minimumDurationMs: 30_000 }), false);
  assert.equal(isUsableMusicAsset(candidate("NARRATION_SAMPLE", 60_000), { minimumDurationMs: 30_000 }), false);
  assert.equal(isUsableMusicAsset(candidate("USER_SOURCE_AUDIO", 60_000), { minimumDurationMs: 30_000 }), false);
  assert.equal(isUsableMusicAsset(candidate(undefined, 60_000), { minimumDurationMs: 30_000 }), false);
});

test("AUTO music selects one matching candidate from a multi-track library and is retry-stable", () => {
  const candidates = [
    { id: "ast_music_warm", createdAt: "2026-01-01", durationMs: 42_000, metadata: { mood: "warm", audio_role: "MUSIC" } },
    { id: "ast_music_calm", createdAt: "2026-01-02", durationMs: 42_000, metadata: { mood: "calm", audio_role: "MUSIC" } },
  ];
  const input = { candidates, briefText: "calm corporate", targetDurationMs: 30_000, productionRunId: "prd_music_multi" };
  assert.equal(selectAutoMusicAsset(input)?.id, "ast_music_calm");
  assert.equal(selectAutoMusicAsset(input)?.id, "ast_music_calm");
});

test("AUTO selector keeps equal-score candidates stable for one production run", () => {
  const candidates = [
    { id: "ast_music_equal_a", createdAt: "2026-01-01", durationMs: 42_000, metadata: { mood: "calm", audio_role: "MUSIC" } },
    { id: "ast_music_equal_b", createdAt: "2026-01-02", durationMs: 42_000, metadata: { mood: "calm", audio_role: "MUSIC" } },
  ];
  const input = { candidates, briefText: "calm", targetDurationMs: 30_000, productionRunId: "prd_music_equal" };
  const first = selectAutoMusicAsset(input);
  assert.ok(first);
  assert.equal(selectAutoMusicAsset(input)?.id, first.id);
});

test("AUTO selector fails closed when no existing music metadata matches the authored brief", () => {
  const candidates = [
    { id: "ast_music_unlabelled", createdAt: "2026-01-01", durationMs: 42_000, metadata: { audio_role: "MUSIC" } },
  ];
  assert.equal(selectAutoMusicAsset({
    candidates,
    briefText: "calm corporate",
    targetDurationMs: 30_000,
    productionRunId: "prd_music_unmatched",
  }), undefined);
});

test("AUTO selector receives only duration-qualified candidates", () => {
  const candidate = (id: string, durationMs: number) => ({
    id,
    workspaceId: "ws_music_duration",
    projectId: "prj_music_duration",
    kind: "AUDIO",
    status: "READY",
    objectKey: `ws_music_duration/prj_music_duration/${id}/music.mp3`,
    sha256: "a".repeat(64),
    byteSize: 100,
    mimeType: "audio/mpeg",
    durationMs,
    createdAt: "2026-01-01",
    metadata: { audio_role: "MUSIC", mood: "calm" },
  });
  const short = candidate("ast_music_short", 10_000);
  const long = candidate("ast_music_long", 42_000);
  assert.equal(isUsableMusicAsset(short, { minimumDurationMs: 30_000 }), false);
  assert.equal(isUsableMusicAsset(long, { minimumDurationMs: 30_000 }), true);
  assert.equal(selectAutoMusicAsset({
    candidates: [long],
    briefText: "calm",
    targetDurationMs: 30_000,
    productionRunId: "prd_music_duration",
  })?.id, "ast_music_long");
});

test("AUTO selector does not treat generic music tokens as authored content", () => {
  const candidates = [
    { id: "ast_music_generic", createdAt: "2026-01-01", durationMs: 42_000, metadata: { audio_role: "MUSIC", mood: "bgm", tags: ["music"] } },
  ];
  assert.equal(selectAutoMusicAsset({
    candidates,
    briefText: "bgm music",
    targetDurationMs: 30_000,
    productionRunId: "prd_music_generic",
  }), undefined);
});
