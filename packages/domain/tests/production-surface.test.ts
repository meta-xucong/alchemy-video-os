import assert from "node:assert/strict";
import test from "node:test";

import * as productionSurface from "../src/index.js";
import * as mockHeuristics from "../src/mock/index.js";

test("production domain surface excludes natural-language inference heuristics", () => {
  for (const symbol of [
    "inferVisualReferenceRoles",
    "inferVisualReferenceLockPolicies",
    "extractKeyVisualObjectLocks",
    "extractNarrativeSentences",
    "extractVisualConstraints",
  ]) {
    assert.equal(Object.hasOwn(productionSurface, symbol), false, symbol);
    assert.equal(Object.hasOwn(mockHeuristics, symbol), true, symbol);
  }
});

test("objective visual-analysis parser remains a non-inferential production boundary", () => {
  assert.equal(typeof productionSurface.parseVisualReferenceAnalysis, "function");
  const parsed = productionSurface.parseVisualReferenceAnalysis({
    summary: "A person is visible under cool blue light.",
    objects: [],
  });
  assert.equal(parsed?.summary, "A person is visible under cool blue light.");
  assert.equal(parsed?.role, undefined);
});
