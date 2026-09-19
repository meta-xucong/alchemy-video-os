import assert from "node:assert/strict";
import test from "node:test";

import { measuredVisualSegmentMatchesRequest, resolveAudioOwnerForComposition, resolveAudioTrackGainDb } from "../src/production-repository.js";

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
