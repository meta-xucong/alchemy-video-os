import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("M1 exposes project create, detail, rename, and source-material removal controls", () => {
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
  assert.match(api, /const deleteAsset = \(assetId: string, idempotencyKey: string\)/);
  assert.match(api, /method: "DELETE"/);
  assert.match(api, /const deleteProject = \(projectId: string, idempotencyKey: string\)/);
  assert.match(workspace, /removeProjectAsset/);
  assert.match(workspace, /删除项目/);
  assert.match(workspace, /输入“删除”确认/);
  assert.match(workspace, /确认删除项目/);
  assert.match(workspace, /:disabled="deletingProject"[^>]*@click="beginDeleteProject"/);
  assert.doesNotMatch(workspace, /beginDeleteProject[\s\S]{0,200}creationBusy/);
});

test("M1 resets per-project browser state and ignores stale project responses", () => {
  const session = read("app/composables/useProjectSession.ts");

  for (const symbol of ["previewUrl", "uploadFiles", "selectedReferenceIds", "projectError", "AbortController", "requestSequence"]) {
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

test("project shell exposes relay health without exposing SSH credentials", () => {
  const page = read("app/pages/projects/[project_id].vue");
  const composable = read("app/composables/useRelayConnection.ts");
  const statusRoute = read("app/server/routes/api/relay/status.get.ts");
  const reconnectRoute = read("app/server/routes/api/relay/reconnect.post.ts");

  assert.match(page, /useRelayConnection/);
  assert.match(page, /视频链路正常/);
  assert.match(page, /relayReconnect/);
  assert.match(page, /const refreshRelay = relayConnection\.refresh/);
  assert.match(page, /void refreshRelay\(\)/);
  assert.match(page, /@click="refreshProjectAndRelay"/);
  assert.match(page, /async function refreshProjectAndRelay\(\)/);
  assert.match(page, /let relayCheckTimer: number \| undefined;/);
  assert.match(page, /relayCheckTimer = window\.setInterval/);
  assert.match(page, /if \(relayCheckTimer !== undefined\) window\.clearInterval\(relayCheckTimer\)/);
  assert.doesNotMatch(composable, /POLYMARKET_SSH_PASSPHRASE/);
  assert.match(statusRoute, /reconnect_available/);
  assert.match(reconnectRoute, /LOCAL_AUTH_MODE/);
  assert.match(reconnectRoute, /VIDEO_RELAY_RECONNECT_SCRIPT/);
});

test("project shell exposes source-aligned Pixabay import and AUTO local-first fallback", () => {
  const page = read("app/pages/projects/[project_id].vue");
  const api = read("app/composables/useControlApi.ts");
  assert.match(api, /audioCapabilities/);
  assert.match(api, /music_assets/);
  assert.match(api, /importPixabayMusic/);
  assert.match(page, /refreshAudioCapabilities/);
  assert.match(page, /audio_summary/);
  assert.match(page, /原仓库逻辑：筛选后取首条/);
  assert.match(page, /importPixabayMusicAsset/);
  assert.match(page, /const workspaceMusicAssets = ref<Asset\[\]>\(\[\]\);/);
  assert.match(page, /\[\.\.\.\(detail\.value\?\.assets \?\? \[\]\), \.\.\.workspaceMusicAssets\.value\]/);
  assert.match(page, /response\.data\.music_assets \?\? \[\]/);
  assert.match(page, /const selectedMusicAsset = computed/);
  assert.match(page, /@click="auditionSelectedMusic"/);
  assert.match(page, /assetDownloadUrl\(asset\.id\)/);
  assert.match(page, /aria-label="试听背景音乐"/);
  assert.match(page, /没有合适曲目且 Pixabay 可用时，点击生成会自动补一首/);
  assert.match(page, /<details class="music-plan-disclosure">/);
  assert.match(page, /<summary>上传工作区音乐<\/summary>/);
  assert.match(page, /<summary>从 Pixabay 导入<\/summary>/);
  assert.doesNotMatch(`${page}\n${api}`, /searchFreeMusic|importFreeMusic|FREESOUND_API_KEY|AUDIO_EXTERNAL_CATALOG/);
});

test("Studio keeps authored narration line breaks before the provider receives provider_text", () => {
  const page = read("app/pages/projects/[project_id].vue");
  assert.match(page, /const quotedNarrationSections =/);
  assert.match(page, /口播文案\|旁白文案\|配音文案\|对白文案/);
  assert.match(page, /”\(\[\\s\\S\]\*\?\)”/);
  assert.match(page, /replace\(\/\\r\\n\?\/gu, "\\n"\)/);
  assert.match(page, /replace\(\/\[\^\\S\\n\]\+\/gu, " "\)/);
  assert.doesNotMatch(page, /match\[1\]!\.replace\(\/\\s\+\/gu, " "\)/);
});
