import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("studio retains the Huobao Nuxt app layout and local API proxy shape", () => {
  const packageJson = JSON.parse(read("package.json"));
  const config = read("nuxt.config.ts");
  const localServer = read("scripts/serve-local.mjs");

  assert.equal(packageJson.dependencies.nuxt, "^3.17.5");
  assert.match(config, /srcDir:\s*"app\//);
  assert.match(config, /ssr:\s*false/);
  assert.match(config, /"\/api\/v1"/);
  assert.equal(packageJson.scripts.dev, "node scripts/serve-local.mjs");
  assert.match(localServer, /\.output\/server\/index\.mjs/);
  assert.match(localServer, /process\.env\.HOST \?\?= "127\.0\.0\.1"/);
  assert.match(localServer, /process\.env\.PORT \?\?= "3031"/);
  assert.match(localServer, /pathToFileURL\(serverEntry\)\.href/);
});

test("studio health screen uses the public control API boundary", () => {
  const composable = read("app/composables/useControlApi.ts");
  const page = read("app/pages/index.vue");

  assert.match(composable, /\$fetch<HealthStatus>\("\/api\/v1\/health"\)/);
  assert.match(page, /useControlApi/);
  assert.match(page, /Refresh control API status/);
});
