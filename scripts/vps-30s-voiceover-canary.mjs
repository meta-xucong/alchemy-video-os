import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const apiOrigin = "https://video.aiself.vip";
const projectId = "prj_01M0S6Z9KEQ54GXEPGN371J0H3";
const sourceAssetIds = [
  "ast_01M0S748WRVBCNSM8FN448Q4ZY",
  "ast_01M0S755C5272APFAX5RFN5ZEX",
  "ast_01M0S75KHGGDDKDYKVSGEG6FCB",
  "ast_01M0S7EH2T8DBB130MRJ5XP2GR",
  "ast_01M0S7ES32G919RV6PH0D9TXJ6",
];
const sourceText = `第1张上传图片（人物.png）为人物原型，第2张上传图片（场景.jpg）为场地背景；其余上传图片仅作为商业宣传片视觉风格参考。严格依据人物图和场景图，保持人物身份、服装、建筑、庭院、水面和山林空间关系，不添加参考图中不存在的主体。以主持人连续口播为主，空景镜头仅作辅助，必须完整说完以下台词，前后两段要连续承接，不得重复、跳过或改写：“受够城市雾霾尾气，就来茅山温泉・桃李春风。背靠茅山原生山林，富含高浓度负氧离子。推窗尽揽草木清香，漫步竹海，在家坐拥天然氧吧，畅快呼吸，被绿意滋养身心。”`;
const password = (await readFile(".codex-longrun/video-deploy-browser-password.txt", "utf8")).trim();
const auth = Buffer.from(`video-admin:${password}`).toString("base64");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (label) => `vps-30s-voiceover-${randomUUID()}-${label}`;
const requestJson = async (path, options = {}) => {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.method && options.method !== "GET" ? { "Idempotency-Key": key(path) } : {}),
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
    await sleep(3000);
  }
  throw new Error(`${label} timed out; last=${last || "unknown"}`);
};

const brief = await requestJson(`/api/v1/projects/${projectId}/creative-brief-revisions`, {
  method: "POST",
  body: {
    source_text: sourceText,
    target_duration_seconds: 30,
    target_resolution: "480p",
    style_preferences: "商业宣传片，真实人物连续口播为主，空景辅助，中文口型同步，前后段保持同一人物和场景连续性。",
    source_asset_ids: sourceAssetIds,
  },
});
console.log(`VPS_30S_BRIEF=${brief.id}`);
await requestJson(`/api/v1/creative-brief-revisions/${brief.id}/plan`, { method: "POST", body: {} });
const detail = await waitFor("storyboard", 180_000, async () => {
  const project = await requestJson(`/api/v1/projects/${projectId}`);
  const currentBrief = project.creative_brief_revisions?.find((item) => item.id === brief.id);
  const storyboard = project.storyboard_revisions?.filter((item) => item.created_at >= brief.created_at).at(-1);
  if (currentBrief?.status === "FAILED") throw new Error(`Planning failed: ${JSON.stringify(currentBrief)}`);
  if (storyboard?.status === "READY_FOR_REVIEW") return { done: true, data: { project, storyboard } };
  return { done: false, status: `${currentBrief?.status ?? "waiting"} ${storyboard?.status ?? "no-storyboard"}` };
});
const { project, storyboard } = detail;
console.log(`VPS_30S_STORYBOARD=${JSON.stringify({
  id: storyboard.id,
  status: storyboard.status,
  total_duration_seconds: storyboard.total_duration_seconds,
  shots: storyboard.shot_specs?.map((shot) => ({ sequence: shot.sequence, duration_seconds: shot.duration_seconds, narrative_goal: shot.narrative_goal })),
})}`);
const approved = await requestJson(`/api/v1/storyboard-revisions/${storyboard.id}/approve`, { method: "POST", body: {} });
const production = await requestJson(`/api/v1/projects/${projectId}/production-runs`, { method: "POST", body: { storyboard_revision_id: approved.id } });
console.log(`VPS_30S_PRODUCTION=${production.id}`);
const finalVersion = await waitFor("production", 35 * 60_000, async () => {
  const [runs, versions] = await Promise.all([
    requestJson(`/api/v1/projects/${projectId}/production-runs`),
    requestJson(`/api/v1/projects/${projectId}/video-versions`),
  ]);
  const current = runs.find((item) => item.production_run.id === production.id);
  if (["FAILED", "BLOCKED"].includes(current?.production_run.status)) throw new Error(`Production failed: ${JSON.stringify(current)}`);
  const version = versions.find((item) => item.production_run_id === production.id && item.status === "SUCCEEDED");
  if (version) return { done: true, data: version };
  return { done: false, status: `${current?.production_run.status ?? "waiting"} ${current?.segments?.map((segment) => `${segment.sequence}:${segment.status}`).join(",") ?? ""}` };
});
const download = await requestJson(`/api/v1/assets/${finalVersion.asset_id}/download-url`);
const videoResponse = await fetch(download.download_url);
if (!videoResponse.ok) throw new Error(`Final video download failed: ${videoResponse.status}`);
const bytes = Buffer.from(await videoResponse.arrayBuffer());
const output = `.codex-longrun/media-review/vps-30s-voiceover-${production.id}.mp4`;
await writeFile(output, bytes);
console.log(`VPS_30S_FINAL=${JSON.stringify({ output, video_version_id: finalVersion.id, asset_id: finalVersion.asset_id, duration_ms: finalVersion.duration_ms, bytes: bytes.length })}`);
