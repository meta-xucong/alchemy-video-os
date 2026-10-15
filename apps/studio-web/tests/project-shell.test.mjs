import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

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

test("Studio never re-parses authored narration during automatic production", () => {
  const page = read("app/pages/projects/[project_id].vue");
  assert.doesNotMatch(page, /quotedNarrationSections|extractQuotedNarration|labelledNarration/);
  assert.doesNotMatch(page, /口播文案\|旁白文案\|配音文案\|对白文案/);
  assert.doesNotMatch(page, /createNarrationScriptRevision|provider_text/);
  assert.match(page, /AI 正在确认分镜并开始制作视频/);
});

test("Studio exposes an explicit, default-preserve ProductionRun audio choice", () => {
  const page = read("app/pages/projects/[project_id].vue");
  const api = read("app/composables/useControlApi.ts");
  assert.match(page, /PRESERVE_PROVIDER_AUDIO/);
  assert.match(page, /DOUBAO_TTS_REPLACE/);
  assert.match(page, /MUSIC_REPLACE_PROVIDER_AUDIO/);
  assert.match(page, /会移除视频 Provider 原声/);
  assert.match(page, /audioConfig\.musicPlan\.mode !== "MANUAL" \|\| !selectedMusicAssetAtStart/);
  const musicReplacementLabel = page.match(/<label class="music-plan-option"[\s\S]*?value="MUSIC_REPLACE_PROVIDER_AUDIO"[\s\S]*?<\/label>/)?.[0];
  assert.ok(musicReplacementLabel);
  assert.match(musicReplacementLabel, /:disabled="audioSelectionLocked"/, "audio source intent stays selectable until a run is active");
  assert.match(page, /先上传或导入一首工作区 MUSIC 曲目[\s\S]*?此选择不会自动选曲/);
  assert.match(page, /自动模式或关闭模式不能用于本次替换/);
  assert.match(page, /aria-labelledby="audio-selection-title"[\s\S]{0,220}id="audio-selection-title"/);
  assert.match(page, /const audioSelection = ref<.*>\("PRESERVE_PROVIDER_AUDIO"\)/);
  assert.match(page, /const audioConfig = snapshotAudioConfig\(audioSelection\.value, musicPlan\)/);
  assert.match(page, /startAutomatedProduction\(current\.project\.id, operationToken, audioConfig\)/);
  assert.match(page, /audio_selection: audioConfig\.audioSelection/);
  assert.match(page, /mode: audioConfig\.musicPlan\.mode/);
  assert.match(page, /asset_id: audioConfig\.musicPlan\.assetId/);
  assert.match(page, /value="MUSIC_REPLACE_PROVIDER_AUDIO" :disabled="audioSelectionLocked"/);
  assert.match(page, /value="AUTO" :disabled="audioSelectionLocked"/);
  assert.match(page, /class="music-plan-select" aria-label="选择工作区音乐" :disabled="audioSelectionLocked"/);
  assert.match(page, /type="file" accept="audio\/mpeg,audio\/wav,audio\/ogg" :disabled="audioSelectionLocked"/);
  assert.match(page, /const audioSelectionLocked = computed\(\(\) => Boolean\([\s\S]*?activeProductionStatuses\.has\(currentProductionRun\.value\.status\)/);
  assert.match(page, /async function importPixabayMusicAsset\(\)[\s\S]*?if \(!projectIdAtStart \|\| !query \|\| audioSelectionLocked\.value\) return/);
  assert.match(page, /&& !pixabayImportBusy\.value/);
  assert.match(page, /selectedMusicAssetAtStart = musicAssets\.value\.find\(\(asset\) => asset\.id === audioConfig\.musicPlan\.assetId\)/);
  assert.match(page, /AUTH_FORBIDDEN: "登录状态已失效或当前账号无权执行此操作，请重新登录或检查账号权限后重试。"/);
  assert.match(page, /safeResultMediaErrorMessage\(error, "这版成片暂时无法播放/);
  assert.match(page, /safeResultMediaErrorMessage\(error, "这版成片暂时无法下载/);
  assert.match(page, /function safeResultMediaErrorMessage[\s\S]*?已生成的成片仍保留，无需重新生成。/);
  assert.match(api, /audio_selection: "PRESERVE_PROVIDER_AUDIO" \| "DOUBAO_TTS_REPLACE" \| "MUSIC_REPLACE_PROVIDER_AUDIO"/);
});

test("Studio freezes the selected audio configuration instead of retaining reactive music state", () => {
  const page = read("app/pages/projects/[project_id].vue");
  const helper = page.slice(page.indexOf("function snapshotAudioConfig("), page.indexOf("async function generateVideo()"));
  const javascript = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const snapshotAudioConfig = new Function(`${javascript}\nreturn snapshotAudioConfig;`)();
  const musicPlan = { mode: "MANUAL", assetId: "ast_selected", styleHint: "gentle" };
  const config = snapshotAudioConfig("MUSIC_REPLACE_PROVIDER_AUDIO", musicPlan);

  musicPlan.mode = "OFF";
  musicPlan.assetId = "";
  musicPlan.styleHint = "changed while planning";
  assert.deepEqual(config, {
    audioSelection: "MUSIC_REPLACE_PROVIDER_AUDIO",
    musicPlan: { mode: "MANUAL", assetId: "ast_selected", styleHint: "gentle" },
  });
  assert.notEqual(config.musicPlan, musicPlan);
});

test("Studio scopes retained-result auth guidance to preview/download errors", () => {
  const page = read("app/pages/projects/[project_id].vue");
  const helpers = page.slice(page.indexOf("function apiErrorCode("), page.indexOf("function uniqueReferenceIds("));
  const javascript = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const { safeErrorMessage, safeResultMediaErrorMessage } = new Function(`${javascript}\nreturn { safeErrorMessage, safeResultMediaErrorMessage };`)();
  const forbidden = { data: { error: { code: "AUTH_FORBIDDEN" } } };

  const generic = safeErrorMessage(forbidden, "操作失败");
  const media = safeResultMediaErrorMessage(forbidden, "无法播放");
  assert.match(generic, /重新登录或检查账号权限/);
  assert.doesNotMatch(generic, /成片仍保留/);
  assert.match(media, /重新登录或检查账号权限/);
  assert.match(media, /已生成的成片仍保留，无需重新生成/);
});
