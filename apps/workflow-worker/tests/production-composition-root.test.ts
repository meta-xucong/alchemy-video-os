import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("real Workflow composition root names no deterministic creative implementation", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /DeterministicPlanningModel/u);
  assert.doesNotMatch(source, /DeterministicStoryboardCompiler/u);
  assert.doesNotMatch(source, /LlmFreeformPromptPlanningModel/u);
  assert.doesNotMatch(source, /@alchemy-video\/creative-planning\/mock/u);
  assert.doesNotMatch(source, /@alchemy-video\/domain\/mock-heuristics/u);
  assert.match(source, /runtimeProfile\.mode === "mock"/u);
  assert.match(source, /import\("\.\/mock\/bootstrap\.js"\)/u);
  assert.match(source, /new SemanticCreativePlanningExecutor/u);
});

test("mock bootstrap is the only Workflow composition root that names deterministic classes", async () => {
  const source = await readFile(new URL("../src/mock/bootstrap.ts", import.meta.url), "utf8");
  assert.match(source, /@alchemy-video\/creative-planning\/mock/u);
  assert.match(source, /DeterministicStoryboardCompiler/u);
  assert.match(source, /createMockCreativePlanningExecutor/u);
});
