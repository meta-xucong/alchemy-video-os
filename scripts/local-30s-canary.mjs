import { randomUUID } from "node:crypto";

const apiOrigin = process.env.CANARY_API_ORIGIN ?? "http://127.0.0.1:3133";
const projectId = process.env.CANARY_PROJECT_ID ?? "prj_01M093K8047Z291CX006ZYSE3X";
const sourceText = process.env.CANARY_SOURCE_TEXT ?? `第1张上传图片中的人物为人物主体和主持人原型，第2张上传图片为场景背景；其他参考图只用于商业宣传片的视觉风格。严格依据这两张图还原人物、服装、建筑和环境，不添加参考图中不存在的主体。录一段包含商业宣传片、口播为一体的短视频，其中以主持人说话为主，商业级别的空景镜头为辅。口播文案为：“受够城市雾霾尾气，就来茅山温泉・桃李春风。背靠茅山原生山林，富含高浓度负氧离子。推窗尽揽草木清香，漫步竹海，在家坐拥天然氧吧，畅快呼吸，被绿意滋养身心。”`;
const sourceAssetIds = (process.env.CANARY_SOURCE_ASSET_IDS ?? "ast_01M09NQKKK95MSSQRPHMERMYVQ,ast_01M09S1ZV8E7MN713W2ETHB8D3")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (sourceAssetIds.length === 0) throw new Error("CANARY_SOURCE_ASSET_IDS must contain at least one confirmed asset id.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (name) => `local-30s-canary-${randomUUID()}:${name}`;

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey ?? key(path),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload.data;
};

const waitFor = async (label, timeoutMs, poll) => {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const result = await poll();
    if (result.done) return result.data;
    if (result.status && result.status !== last) { last = result.status; console.log(`${label}: ${last}`); }
    await sleep(2_000);
  }
  throw new Error(`${label} timed out; last=${last || "unknown"}`);
};

await requestJson("/api/v1/health", { headers: { "Idempotency-Key": undefined } });
const brief = await requestJson(`/api/v1/projects/${projectId}/creative-brief-revisions`, {
  method: "POST",
  idempotencyKey: key("brief"),
  body: {
    source_text: sourceText,
    target_duration_seconds: 30,
    target_resolution: "480p",
    style_preferences: "商业宣传片，真实人物口播为主，空镜作为辅助，严格依据参考人物和场景图，口型与中文台词同步。",
    source_asset_ids: sourceAssetIds,
  },
});
console.log(`LOCAL_30S_BRIEF=${brief.id}`);
await requestJson(`/api/v1/creative-brief-revisions/${brief.id}/plan`, { method: "POST", idempotencyKey: key("plan"), body: {} });
const storyboard = await waitFor("storyboard", 120_000, async () => {
  const detail = await requestJson(`/api/v1/projects/${projectId}`);
  const currentBrief = detail.creative_brief_revisions?.find((item) => item.id === brief.id);
  const latest = detail.storyboard_revisions
    ?.filter((item) => item.created_at && item.created_at >= brief.created_at)
    ?.at(-1);
  if (currentBrief?.status === "FAILED") throw new Error(`Planning failed: ${JSON.stringify(currentBrief)}`);
  if (latest?.status === "READY_FOR_REVIEW") return { done: true, data: latest };
  return { done: false, status: `${currentBrief?.status ?? "waiting"} ${latest?.status ?? "no-storyboard"}` };
});
console.log(`LOCAL_30S_STORYBOARD=${JSON.stringify({ id: storyboard.id, status: storyboard.status, total_duration_seconds: storyboard.total_duration_seconds, shots: storyboard.shot_specs?.map((shot) => ({ sequence: shot.sequence, duration_seconds: shot.duration_seconds, dialogue_lines: shot.dialogue_lines })) })}`);
const approved = await requestJson(`/api/v1/storyboard-revisions/${storyboard.id}/approve`, { method: "POST", idempotencyKey: key("approve"), body: {} });
// ProductionRun creation is already delivery-plan gated by the Control API.
// Keep this canary on the same public flow as Studio: create and approve the
// existing DeliveryPlanRevision, then pass its immutable id into the run.
const deliveryPlan = await requestJson(`/api/v1/projects/${projectId}/delivery-plan-revisions`, {
  method: "POST",
  idempotencyKey: key("delivery-plan"),
  body: {
    creative_brief_revision_id: brief.id,
    storyboard_revision_id: approved.id,
    duration_policy: "FLEXIBLE",
    flexible_duration_percent: 20,
    caption_policy: "REQUIRED",
    lip_sync_requirement: "OFF",
    voice_mode: "PLATFORM_GENERIC",
    budget_limit: "0",
  },
});
const approvedDeliveryPlan = await requestJson(`/api/v1/delivery-plan-revisions/${deliveryPlan.id}/approve`, {
  method: "POST",
  idempotencyKey: key("delivery-plan-approve"),
  body: {},
});
const production = await requestJson(`/api/v1/projects/${projectId}/production-runs`, {
  method: "POST",
  idempotencyKey: key("production"),
  body: { storyboard_revision_id: approved.id, delivery_plan_revision_id: approvedDeliveryPlan.id },
});
console.log(`LOCAL_30S_PRODUCTION=${production.id}`);
const finalVersion = await waitFor("production", 25 * 60_000, async () => {
  const [progress, versions] = await Promise.all([
    requestJson(`/api/v1/projects/${projectId}/production-runs`),
    requestJson(`/api/v1/projects/${projectId}/video-versions`),
  ]);
  const current = progress.find((item) => item.production_run.id === production.id);
  if (["FAILED", "BLOCKED"].includes(current?.production_run.status)) throw new Error(`Production failed: ${JSON.stringify(current)}`);
  const version = versions.find((item) => item.production_run_id === production.id && item.status === "SUCCEEDED");
  if (version) return { done: true, data: version };
  return { done: false, status: `${current?.production_run.status ?? "waiting"} ${current?.segments?.map((segment) => `${segment.sequence}:${segment.status}`).join(",") ?? ""}` };
});
const download = await requestJson(`/api/v1/assets/${finalVersion.asset_id}/download-url`);
const response = await fetch(download.download_url);
if (!response.ok) throw new Error(`Final video download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const output = `.codex-longrun/media-review/local-30s-canary-${production.id}.mp4`;
const { writeFile } = await import("node:fs/promises");
await writeFile(output, bytes);
console.log(`LOCAL_30S_FINAL=${JSON.stringify({ output, video_version_id: finalVersion.id, asset_id: finalVersion.asset_id, duration_ms: finalVersion.duration_ms, bytes: bytes.length })}`);
