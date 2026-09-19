import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("C06 registers the public TaskRun routes after C05's durable SSE boundary", async () => {
  const source = await readFile(resolve(import.meta.dirname, "..", "src", "app.ts"), "utf8");

  assert.match(source, /app\.get\("\/api\/v1\/events"/);
  assert.match(source, /app\.post\("\/api\/v1\/shots\/:shot_id\/generations/);
  assert.match(source, /app\.get\("\/api\/v1\/task-runs\/:task_run_id/);
  assert.match(source, /app\.post\("\/api\/v1\/task-runs\/:task_run_id\/retry/);
});
