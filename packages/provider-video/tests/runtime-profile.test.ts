import assert from "node:assert/strict";
import test from "node:test";

import {
  UnsupportedVideoGenerationInputError,
  createRuntimeVideoInputSnapshot,
  resolveVideoProviderRuntimeProfile,
} from "../src/index.js";

const reference = {
  asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  sha256: "a".repeat(64),
  mime_type: "image/png" as const,
  position: 0,
};

test("runtime profiles keep the Mock default and encode the certified SUB2API visual-input bounds", () => {
  const mock = resolveVideoProviderRuntimeProfile(undefined);
  assert.deepEqual(mock, {
    mode: "mock",
    provider: "mock",
    model: "mock-video-v1",
    duration: 1,
    resolution: "160x90",
    ratio: "16:9",
    inputMode: "mock",
    supportedVisualInputModes: ["TEXT", "FIRST_FRAME", "REFERENCE_SET"],
    pollIntervalMs: 0,
    maxPollAttempts: 2,
  });

  const real = resolveVideoProviderRuntimeProfile("sub2api");
  assert.equal(real.provider, "sub2api");
  assert.equal(real.model, "grok-imagine-video-1.5");
  assert.equal(real.duration, 5);
  assert.equal(real.resolution, "720p");
  assert.equal(real.ratio, "16:9");
  assert.deepEqual(real.supportedVisualInputModes, ["TEXT", "FIRST_FRAME", "REFERENCE_SET"]);
  assert.equal(real.maxPollAttempts, 120);
});

test("runtime snapshots freeze text, opening-frame, and reference-set visual inputs", () => {
  const profile = resolveVideoProviderRuntimeProfile("sub2api");
  assert.deepEqual(createRuntimeVideoInputSnapshot({
    prompt: "A paper kite moving above a green field.",
    visualInput: { mode: "TEXT", references: [] },
    profile,
  }), {
    model: "grok-imagine-video-1.5",
    prompt: "A paper kite moving above a green field.",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
    reference_asset_ids: [],
    visual_input: { mode: "TEXT", references: [] },
  });
  const firstFrame = createRuntimeVideoInputSnapshot({
    prompt: "A first frame must remain explicit.",
    visualInput: { mode: "FIRST_FRAME", references: [reference] },
    profile,
  });
  assert.deepEqual(firstFrame.reference_asset_ids, [reference.asset_id]);
  assert.equal(firstFrame.visual_input?.mode, "FIRST_FRAME");
  assert.throws(() => createRuntimeVideoInputSnapshot({
    prompt: "A reference set cannot exceed seven images.",
    visualInput: { mode: "REFERENCE_SET", references: Array.from({ length: 8 }, (_, position) => ({ ...reference, asset_id: `ast_01J4N8QZ8PCW2N2G6D2XJXJXJ${position}`, position })) },
    profile,
  }), UnsupportedVideoGenerationInputError);
  assert.throws(() => resolveVideoProviderRuntimeProfile("untrusted"));
});

test("real snapshots accept only the declared runtime parameter range", () => {
  const profile = resolveVideoProviderRuntimeProfile("sub2api");
  const snapshot = createRuntimeVideoInputSnapshot({
    prompt: "A concise product video.",
    visualInput: { mode: "TEXT", references: [] },
    profile,
    settings: { duration: 15, resolution: "480p", ratio: "16:9" },
  });
  assert.equal(snapshot.duration, 15);
  assert.equal(snapshot.resolution, "480p");
  assert.throws(() => createRuntimeVideoInputSnapshot({
    prompt: "Unsupported quality request.",
    visualInput: { mode: "TEXT", references: [] },
    profile,
    settings: { duration: 16, resolution: "720p", ratio: "16:9" },
  }), UnsupportedVideoGenerationInputError);
});

test("Mock runtime preserves the ordered reference-set snapshot for the local MVP flow", () => {
  const profile = resolveVideoProviderRuntimeProfile("mock");
  const snapshot = createRuntimeVideoInputSnapshot({
    prompt: "A local Mock task may retain its reference binding.",
    visualInput: { mode: "REFERENCE_SET", references: [reference] },
    profile,
  });

  assert.deepEqual(snapshot.reference_asset_ids, [reference.asset_id]);
  assert.notEqual(snapshot.reference_asset_ids, [reference.asset_id]);
  assert.equal(snapshot.visual_input?.mode, "REFERENCE_SET");
});
