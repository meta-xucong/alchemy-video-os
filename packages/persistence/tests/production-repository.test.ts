import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("AUTO music tie-break is stable for retries and can rotate equal candidates across new runs", () => {
  const first = selectAutoMusicAsset({ candidates: musicCandidates, briefText: "warm", targetDurationMs: 30_000, productionRunId: "prd_run_a" });
  const retry = selectAutoMusicAsset({ candidates: musicCandidates, briefText: "warm", targetDurationMs: 30_000, productionRunId: "prd_run_a" });
  const second = selectAutoMusicAsset({ candidates: musicCandidates, briefText: "warm", targetDurationMs: 30_000, productionRunId: "prd_run_c" });
  assert.ok(first);
  assert.equal(retry?.id, first?.id);
  assert.notEqual(second?.id, undefined);
  assert.notEqual(second?.id, first?.id);
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
