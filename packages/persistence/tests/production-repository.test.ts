import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { semanticPromptPackageIntegrityPayload } from "@alchemy-video/contracts";
import { canonicalJson } from "@alchemy-video/domain";

import {
  isUsableMusicAsset,
  selectAutoMusicAsset,
  measuredVisualSegmentMatchesRequest,
  resolveAudioOwnerForComposition,
  resolveAudioTrackGainDb,
  validateSemanticPromptPackage,
} from "../src/production-repository.js";

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
