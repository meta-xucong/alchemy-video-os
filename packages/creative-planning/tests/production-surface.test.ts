import assert from "node:assert/strict";
import test from "node:test";

import * as productionSurface from "../src/index.js";
import * as mockSurface from "../src/mock.js";

test("production creative-planning surface excludes deterministic and legacy freeform planners", () => {
  for (const symbol of [
    "DeterministicPlanningModel",
    "DeterministicStoryboardCompiler",
    "LlmFreeformPromptPlanningModel",
  ]) {
    assert.equal(Object.hasOwn(productionSurface, symbol), false, symbol);
    assert.equal(Object.hasOwn(mockSurface, symbol), true, symbol);
  }
  assert.equal(Object.hasOwn(productionSurface, "ProvenanceCheckedSemanticDirector"), true);
  assert.equal(Object.hasOwn(productionSurface, "verifySemanticDirectorProvenance"), true);
});

test("production creative-planning source contains no platform-owned sentinel contract", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/index.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /PLATFORM_OWNED_|__MOCK_UNSPECIFIED_/u);
});
