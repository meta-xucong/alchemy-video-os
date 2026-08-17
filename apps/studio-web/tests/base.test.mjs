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
  assert.match(config, /buildDir:\s*localBuildDirectory/);
  assert.match(config, /dir:\s*localNitroOutputDirectory/);
  assert.match(config, /ssr:\s*false/);
  assert.match(config, /"\/api\/v1"/);
  assert.match(config, /runtimeConfig/);
  assert.match(config, /controlApiOrigin:\s*defaultControlApiOrigin/);
  assert.doesNotMatch(config, /routeRules/);
  assert.match(read("app/server/routes/api/v1/[...path].ts"), /resolveControlApiOrigin/);
  assert.match(read("app/server/routes/api/v1/[...path].ts"), /proxyControlApiRequest/);
  assert.equal(packageJson.scripts.dev, "node scripts/serve-local.mjs");
  assert.match(localServer, /STUDIO_NITRO_OUTPUT_DIR/);
  assert.match(localServer, /resolve\(outputDirectory, "server", "index\.mjs"\)/);
  assert.match(localServer, /process\.env\.HOST \?\?= "127\.0\.0\.1"/);
  assert.match(localServer, /process\.env\.PORT \?\?= "3031"/);
  assert.match(localServer, /if \(!process\.env\.NITRO_CONTROL_API_ORIGIN && process\.env\.CONTROL_API_ORIGIN\)/);
  assert.match(localServer, /pathToFileURL\(serverEntry\)\.href/);
});

test("M1 root route hands off to project home and all project commands stay public", () => {
  const rootPage = read("app/pages/index.vue");
  const home = read("app/pages/projects/index.vue");
  const workspace = read("app/pages/projects/[project_id].vue");
  const composable = read("app/composables/useControlApi.ts");

  assert.match(rootPage, /navigateTo\("\/projects", \{ replace: true \}\)/);
  assert.match(home, /currentIdentity/);
  assert.match(home, /createProject/);
  assert.match(workspace, /project\(nextProjectId, signal\)/);
  assert.match(workspace, /updateProject/);
  assert.match(composable, /\$fetch<HealthStatus>\("\/api\/v1\/health"\)/);
  assert.match(composable, /\/api\/v1\/projects/);
  assert.match(composable, /Idempotency-Key/);
  assert.doesNotMatch(`${rootPage}\n${home}\n${workspace}\n${composable}`, /\/internal\//);
});

test("M1 exposes the real project lifecycle and never simulates deletion", () => {
  const home = read("app/pages/projects/index.vue");
  const workspace = read("app/pages/projects/[project_id].vue");
  const source = `${home}\n${workspace}`;

  assert.match(home, /我的项目/);
  assert.match(home, /新建项目/);
  assert.match(home, /从一个视频想法开始/);
  assert.match(workspace, /编辑名称/);
  assert.match(workspace, /归档项目/);
  assert.match(workspace, /删除功能等待服务端开放/);
  assert.match(workspace, /disabled aria-disabled="true"/);
  assert.doesNotMatch(source, /method:\s*"DELETE"|删除成功/);
  assert.doesNotMatch(source, /\b(?:provider_request_id|object_key|veyra|minio|bullmq|outbox)\b/i);
});
