import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("C05 registers only the public SSE route and leaves C06 TaskRun routes unimplemented", async () => {
  const source = await readFile(resolve(import.meta.dirname, "..", "src", "app.ts"), "utf8");

  assert.match(source, /app\.get\("\/api\/v1\/events"/);
  assert.doesNotMatch(source, /app\.(?:get|post|patch)\("\/api\/v1\/shots\/:shot_id\/generations/);
  assert.doesNotMatch(source, /app\.(?:get|post|patch)\("\/api\/v1\/task-runs/);
});
