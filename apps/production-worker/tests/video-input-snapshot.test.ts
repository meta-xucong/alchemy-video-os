import assert from "node:assert/strict";
import test from "node:test";

import { createProductionTaskRunInputSnapshotFactory } from "../src/video-input-snapshot.js";

const reference = {
  asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  sha256: "a".repeat(64),
  mime_type: "image/png" as const,
  position: 0,
};

test("the real production factory creates a Grok-compatible immutable task snapshot", () => {
  const createSnapshot = createProductionTaskRunInputSnapshotFactory("sub2api");

  const snapshot = createSnapshot({
    prompt: "A calm cinematic product reveal on a sunlit desk.",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
    referenceAssetIds: [reference.asset_id],
    visualInput: { mode: "REFERENCE_SET", references: [reference] },
    generationSegmentSequence: 2,
    narrativeBeatSequences: [7, 8, 9, 10, 11, 12],
  });

  assert.equal(snapshot.model, "grok-imagine-video-1.5");
  assert.equal(snapshot.duration, 5);
  assert.equal(snapshot.resolution, "720p");
  assert.equal(snapshot.ratio, "16:9");
  assert.deepEqual(snapshot.reference_asset_ids, [reference.asset_id]);
  assert.equal(snapshot.generation_segment_sequence, 2);
  assert.deepEqual(snapshot.narrative_beat_sequences, [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(snapshot.visual_input, { mode: "REFERENCE_SET", references: [reference] });
});

test("the Mock factory preserves planned production timing without pretending to be real media", () => {
  const createSnapshot = createProductionTaskRunInputSnapshotFactory("mock");

  const snapshot = createSnapshot({
    prompt: "A deterministic local test segment.",
    duration: 15,
    resolution: "480p",
    ratio: "16:9",
    referenceAssetIds: [],
    visualInput: { mode: "TEXT", references: [] },
    generationSegmentSequence: 1,
    narrativeBeatSequences: [1, 2, 3],
  });

  assert.equal(snapshot.model, "mock-video-v1");
  assert.equal(snapshot.duration, 15);
  assert.equal(snapshot.resolution, "480p");
  assert.equal(snapshot.generation_segment_sequence, 1);
});
