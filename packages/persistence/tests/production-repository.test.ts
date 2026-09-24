import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  isUsableMusicAsset,
  hasMusicContentMatch,
  measuredVisualSegmentMatchesRequest,
  resolveAudioOwnerForComposition,
  resolveAudioTrackGainDb,
  scoreMusicAsset,
  selectAutoMusicAsset,
} from "../src/production-repository.js";

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

const musicCandidates = [
  { id: "ast_music_a", createdAt: "2026-09-01T00:00:00.000Z", durationMs: 60_000, metadata: { audio_role: "MUSIC", mood: "warm" } },
  { id: "ast_music_b", createdAt: "2026-09-02T00:00:00.000Z", durationMs: 60_000, metadata: { audio_role: "MUSIC", mood: "warm" } },
] as const;

test("AUTO music intent raises a matching metadata score without changing duration semantics", () => {
  assert.equal(scoreMusicAsset(musicCandidates[0], "warm piano", 30_000), 12);
  assert.equal(scoreMusicAsset(musicCandidates[0], "unmatched", 30_000), 2);
});

test("AUTO music matching ignores Pixabay query metadata but reads returned titles and tags", () => {
  const base = { id: "ast_music_source", createdAt: "2026-09-01T00:00:00.000Z", durationMs: 60_000 };
  const queryOnly = { ...base, metadata: { pixabay_query: "forest ambience" } };
  assert.equal(scoreMusicAsset(queryOnly, "forest", 30_000), 2);
  assert.equal(hasMusicContentMatch(queryOnly, "forest"), false);
  assert.equal(scoreMusicAsset({ ...base, metadata: { pixabay_title: "quiet piano" } }, "piano", 30_000), 12);
  assert.equal(scoreMusicAsset({ ...base, metadata: { source_title: "warm guitar" } }, "guitar", 30_000), 12);
  assert.equal(scoreMusicAsset({ ...base, metadata: { tags: ["cinematic", "ambient"] } }, "ambient", 30_000), 12);
  assert.equal(scoreMusicAsset({
    ...base,
    metadata: {
      mood: "Unknown",
      pixabay_query: "Unknown",
      pixabay_title: "Unknown",
      source_title: "Unknown",
      filename: "pixabay_music_Unknown.mp3",
    },
  }, "unknown", 30_000), 2);
});

test("AUTO music ignores file and transport tokens but matches descriptive content tags", () => {
  const base = { createdAt: "2026-09-01T00:00:00.000Z", durationMs: 60_000 };
  assert.equal(scoreMusicAsset({
    ...base,
    id: "ast_music_generic_filename",
    metadata: { filename: "latest-selected-bgm.mp3" },
  }, "BGM latest selected track music audio pixabay", 30_000), 2);
  assert.equal(scoreMusicAsset({
    ...base,
    id: "ast_music_content_tags",
    metadata: { tags: ["instrumental", "ambient", "beauty"] },
  }, "instrumental ambient beauty", 30_000), 32);
});

test("AUTO music transport words do not make an otherwise unclassified candidate win same-score preference", () => {
  const base = { createdAt: "2026-09-01T00:00:00.000Z", durationMs: 60_000 };
  const transportTags = {
    ...base,
    id: "ast_music_transport_tags",
    metadata: { tags: ["bgm", "music", "audio", "latest", "selected", "pixabay", "track"] },
  };
  const unclassified = { ...base, id: "ast_music_unclassified", metadata: { mood: "Unknown" } };
  const productionRunId = "prd_filename_generic_4";
  const stableFirstId = [transportTags, unclassified]
    .map((asset) => ({
      id: asset.id,
      digest: createHash("sha256").update(`${productionRunId}${asset.id}`).digest("hex"),
    }))
    .sort((left, right) => left.digest.localeCompare(right.digest))[0]?.id;
  assert.equal(stableFirstId, unclassified.id);
  assert.equal(hasMusicContentMatch(transportTags, "BGM music audio latest selected Pixabay track"), false);
  assert.equal(selectAutoMusicAsset({
    candidates: [transportTags, unclassified],
    briefText: "BGM music audio latest selected Pixabay track",
    targetDurationMs: 30_000,
    productionRunId,
  }), undefined);
  assert.equal(stableFirstId, unclassified.id);
});

test("AUTO music ignores non-string tag array values for matching and label preference", () => {
  const base = { createdAt: "2026-09-01T00:00:00.000Z", durationMs: 60_000 };
  const nonStringTags = {
    ...base,
    id: "ast_music_invalid_tags",
    metadata: { tags: [123, { mood: "ambient" }] },
  };
  assert.equal(scoreMusicAsset(nonStringTags, "123 ambient", 30_000), 2);

  const unclassified = {
    ...base,
    id: "ast_music_unclassified",
    metadata: { mood: "Unknown" },
  };
  const productionRunId = "prd_tag_types_a";
  const stableFirstId = [nonStringTags, unclassified]
    .map((asset) => ({
      id: asset.id,
      digest: createHash("sha256").update(`${productionRunId}${asset.id}`).digest("hex"),
    }))
    .sort((left, right) => left.digest.localeCompare(right.digest))[0]?.id;
  assert.equal(stableFirstId, unclassified.id);
  assert.equal(selectAutoMusicAsset({
    candidates: [nonStringTags, unclassified],
    briefText: "unmatched",
    targetDurationMs: 30_000,
    productionRunId,
  }), undefined);
  assert.equal(stableFirstId, unclassified.id);
});

test("AUTO music prefers an existing descriptive label over an unclassified candidate at the same score", () => {
  const selected = selectAutoMusicAsset({
    candidates: [
      { id: "ast_music_unclassified", createdAt: "2026-09-02T00:00:00.000Z", durationMs: 60_000, metadata: { mood: "Unknown", source_title: "cinematic", filename: "pixabay_music_Unknown.mp3" } },
      { id: "ast_music_labelled", createdAt: "2026-09-01T00:00:00.000Z", durationMs: 60_000, metadata: { tags: ["cinematic"] } },
    ],
    briefText: "cinematic",
    targetDurationMs: 30_000,
    productionRunId: "prd_music_labels",
  });
  assert.equal(selected?.id, "ast_music_labelled");
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

test("AUTO music tie-break orders equal candidates by each run-and-asset SHA-256", () => {
  const expectedId = (productionRunId: string) => musicCandidates
    .map((asset) => ({
      asset,
      digest: createHash("sha256").update(`${productionRunId}${asset.id}`).digest("hex"),
    }))
    .sort((left, right) => left.digest.localeCompare(right.digest))[0]?.asset.id;
  const first = selectAutoMusicAsset({ candidates: musicCandidates, briefText: "warm", targetDurationMs: 30_000, productionRunId: "prd_run_a" });
  const retry = selectAutoMusicAsset({ candidates: [...musicCandidates].reverse(), briefText: "warm", targetDurationMs: 30_000, productionRunId: "prd_run_a" });
  const second = selectAutoMusicAsset({ candidates: musicCandidates, briefText: "warm", targetDurationMs: 30_000, productionRunId: "prd_run_c" });
  assert.ok(first);
  assert.equal(first.id, expectedId("prd_run_a"));
  assert.equal(retry?.id, first.id);
  assert.equal(second?.id, expectedId("prd_run_c"));
  assert.notEqual(second?.id, first.id);
});

test("AUTO music keeps a higher intent match ahead of tie rotation", () => {
  const selected = selectAutoMusicAsset({
    candidates: [...musicCandidates, { id: "ast_music_c", createdAt: "2026-09-03T00:00:00.000Z", durationMs: 60_000, metadata: { mood: "warm", style: "piano" } }],
    briefText: "warm piano",
    targetDurationMs: 30_000,
    productionRunId: "prd_run_b",
  });
  assert.equal(selected?.id, "ast_music_c");
});
