import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("M1 exposes only the existing project create, detail, and rename controls", () => {
  const api = read("app/composables/useControlApi.ts");
  const home = read("app/pages/projects/index.vue");
  const workspace = read("app/pages/projects/[project_id].vue");

  assert.match(api, /const updateProject = \(projectId: string, input: \{ name\?: string; status\?: "ACTIVE" \| "ARCHIVED" \}, idempotencyKey: string\)/);
  assert.match(api, /\$fetch<ProjectResponse>\(`\/api\/v1\/projects\/\$\{projectId\}`/);
  assert.match(api, /method: "PATCH"/);
  assert.match(home, /createProject/);
  assert.match(home, /navigateTo\(`\/projects\/\$\{created\.data\.id\}`\)/);
  assert.match(workspace, /useRoute\(\)/);
  assert.match(workspace, /updateProject/);
  assert.match(workspace, /编辑名称/);
  assert.match(workspace, /归档项目/);
  assert.match(workspace, /删除功能等待服务端开放/);
  assert.doesNotMatch(`${api}\n${home}\n${workspace}`, /method:\s*"DELETE"|\$fetch[^\n]*DELETE/);
});

test("M1 resets per-project browser state and ignores stale project responses", () => {
  const session = read("app/composables/useProjectSession.ts");

  for (const symbol of ["previewUrl", "uploadFile", "selectedReferenceIds", "projectError", "AbortController", "requestSequence"]) {
    assert.match(session, new RegExp(symbol));
  }

  assert.match(session, /URL\.revokeObjectURL/);
  assert.match(session, /sequence !== requestSequence\.value/);
  assert.match(session, /activeRequest\?\.abort\(\)/);
});

test("M1 project routes and browser state do not expose internal implementation details", () => {
  const home = read("app/pages/projects/index.vue");
  const workspace = read("app/pages/projects/[project_id].vue");
  const session = read("app/composables/useProjectSession.ts");
  const source = `${home}\n${workspace}\n${session}`;

  assert.match(home, /新建项目/);
  assert.match(home, /从一个视频想法开始/);
  assert.match(workspace, /返回项目列表/);
  assert.doesNotMatch(source, /\/internal\//);
  assert.doesNotMatch(source, /\b(?:provider_request_id|object_key|veyra|minio|bullmq|outbox)\b/i);
});
