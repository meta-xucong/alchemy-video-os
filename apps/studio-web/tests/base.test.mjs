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
  assert.match(config, /runtimeConfig/);
  assert.match(config, /controlApiOrigin:\s*defaultControlApiOrigin/);
  assert.doesNotMatch(config, /routeRules/);
  assert.match(read("app/server/routes/api/v1/[...path].ts"), /resolveControlApiOrigin/);
  assert.match(read("app/server/routes/api/v1/[...path].ts"), /proxyControlApiRequest/);
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
  assert.match(page, /刷新工作台/);
});

test("studio C03-C06 surfaces stay on the public control API boundary", () => {
  const composable = read("app/composables/useControlApi.ts");
  const page = read("app/pages/index.vue");
  const assetMedia = read("app/composables/useAssetMedia.ts");

  assert.match(composable, /\/api\/v1\/me/);
  assert.match(composable, /\/api\/v1\/projects/);
  assert.match(composable, /assets\/upload-requests/);
  assert.match(composable, /confirm-upload/);
  assert.match(composable, /download-url/);
  assert.match(composable, /\/shots/);
  assert.match(composable, /Idempotency-Key/);
  assert.match(page, /currentIdentity/);
  assert.match(page, /创建项目/);
  assert.match(page, /选择参考图片/);
  assert.match(page, /confirmAssetUpload/);
  assert.match(page, /createShot/);
  assert.match(page, /updateShot/);
  assert.match(page, /createGeneration/);
  assert.match(page, /retryTaskRun/);
  assert.match(page, /new EventSource\(`\/api\/v1\/events/);
  assert.match(page, /生成本地 Mock 视频/);
  assert.match(page, /预览生成视频/);
  assert.match(page, /fetch\(request\.data\.upload_url/);
  assert.match(assetMedia, /thumbFallback/);
  assert.doesNotMatch(composable, /\/internal\//);
  assert.doesNotMatch(`${composable}\n${page}\n${assetMedia}`, /\b(?:object_key|provider_request_id|request_payload|response_payload|veyra|minio|bullmq|outbox)\b/i);
});
