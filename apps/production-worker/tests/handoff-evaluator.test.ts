import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureHandoffEvaluator } from "../src/handoff-evaluator.js";

test("fixture evaluator is fail-closed by default", async () => {
  const result = await createFixtureHandoffEvaluator().evaluate({
    fromTailFrame: new Uint8Array([1]),
    toHeadFrame: new Uint8Array([2]),
    continuityHints: { characterCount: 1, sceneSummary: "室内" },
  });
  assert.equal(result.result, "UNAVAILABLE");
  assert.equal(result.reasonCodes[0], "EVALUATOR_UNAVAILABLE");
});

test("fixture evaluator supports deterministic bridge-required and rejects empty frames", async () => {
  const evaluator = createFixtureHandoffEvaluator({ result: "BRIDGE_REQUIRED", safeSummary: "人物动作方向需要过渡。" });
  const result = await evaluator.evaluate({
    fromTailFrame: new Uint8Array([1]),
    toHeadFrame: new Uint8Array([2]),
    continuityHints: { characterCount: 2, sceneSummary: "街道" },
  });
  assert.equal(result.result, "BRIDGE_REQUIRED");
  assert.match(result.safeSummary, /过渡/);
  const failed = await evaluator.evaluate({
    fromTailFrame: new Uint8Array(),
    toHeadFrame: new Uint8Array([2]),
    continuityHints: { characterCount: 1, sceneSummary: "街道" },
  });
  assert.equal(failed.result, "FAILED");
});
