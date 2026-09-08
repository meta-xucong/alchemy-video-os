import { mkdir, readFile, writeFile } from "node:fs/promises";

const api = "http://127.0.0.1:3133";
const sourceText = "第1张上传图片（人物.png）为人物原型，第2张上传图片（场景.jpg）为场地背景；用上传图片中的人物.png\" 为人物原型，上传的场景图“场景.jpg”为场地背景。其他几张图片为商业宣传片的视觉效果参考，录一段包含商业宣传片、口播为一体的短视频。其中，应以主持人说话为主，商业级别的空景镜头为辅，呈现整体的视觉效果。口播文案为：“受够城市雾霾尾气，就来茅山温泉・桃李春风。背靠茅山原生山林，富含高浓度负氧离子。推窗尽揽草木清香，漫步竹海，在家坐拥天然氧吧，畅快呼吸，被绿意滋养身心。”";
const sourceFiles = [
  ["人物.png", "image/png", ".codex-longrun/local-acceptance/ast_01M09NQKKK95MSSQRPHMERMYVQ.bin"],
  ["场景.jpg", "image/jpeg", ".codex-longrun/local-acceptance/ast_01M09S1ZV8E7MN713W2ETHB8D3.bin"],
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = async (path, method = "GET", body) => {
  const response = await fetch(`${api}${path}`, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": `vps-repro-${Date.now()}-${Math.random()}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload.data;
};

const project = await request("/api/v1/projects", "POST", { name: "茅山温泉・桃李春风 空气环节（VPS本地复现）" });
const assets = [];
for (const [filename, mimeType, filePath] of sourceFiles) {
  const bytes = await readFile(filePath);
  const upload = await request(`/api/v1/projects/${project.id}/assets/upload-requests`, "POST", { kind: "IMAGE", filename, mime_type: mimeType, byte_size: bytes.length });
  const put = await fetch(upload.upload_url, { method: "PUT", headers: upload.headers, body: bytes });
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  const sha256 = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
  await request(`/api/v1/assets/${upload.asset_id}/confirm-upload`, "POST", { sha256, mime_type: mimeType, byte_size: bytes.length });
  assets.push(upload.asset_id);
}
const brief = await request(`/api/v1/projects/${project.id}/creative-brief-revisions`, "POST", {
  source_text: sourceText,
  target_duration_seconds: 15,
  target_resolution: "480p",
  style_preferences: "商业宣传片，真实人物口播为主，空镜作为辅助，严格依据参考人物和场景图，口型与中文台词同步。",
  source_asset_ids: assets,
});
await request(`/api/v1/creative-brief-revisions/${brief.id}/plan`, "POST", {});
let storyboard;
for (;;) {
  const detail = await request(`/api/v1/projects/${project.id}`);
  storyboard = detail.storyboard_revisions?.filter((item) => item.created_at >= brief.created_at).at(-1);
  if (storyboard?.status === "READY_FOR_REVIEW") break;
  if (brief.status === "FAILED") throw new Error("planning failed");
  await sleep(1000);
}
const approved = await request(`/api/v1/storyboard-revisions/${storyboard.id}/approve`, "POST", {});
const production = await request(`/api/v1/projects/${project.id}/production-runs`, "POST", { storyboard_revision_id: approved.id });
for (;;) {
  const [runs, versions] = await Promise.all([request(`/api/v1/projects/${project.id}/production-runs`), request(`/api/v1/projects/${project.id}/video-versions`)]);
  const current = runs.find((item) => item.production_run.id === production.id);
  const version = versions.find((item) => item.production_run_id === production.id);
  if (version) {
    const download = await request(`/api/v1/assets/${version.asset_id}/download-url`);
    const response = await fetch(download.download_url);
    const bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(".codex-longrun/media-review", { recursive: true });
    const output = `.codex-longrun/media-review/vps-project-local-repro-${production.id}.mp4`;
    await writeFile(output, bytes);
    console.log(JSON.stringify({ project_id: project.id, brief_id: brief.id, storyboard_id: storyboard.id, production_id: production.id, status: current.production_run.status, duration_ms: version.duration_ms, output }, null, 2));
    break;
  }
  if (["FAILED", "BLOCKED"].includes(current?.production_run.status)) throw new Error(JSON.stringify(current));
  await sleep(1500);
}
