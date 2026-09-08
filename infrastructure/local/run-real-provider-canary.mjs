import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const args = new Set(process.argv.slice(2));
if (!args.has("--real-call")) {
  throw new Error("Refusing to create a real Provider task without --real-call.");
}

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const statePath = resolve(repoRoot, ".codex-longrun", "local-acceptance", "full-stack-pids.json");
const apiOrigin = process.env.CANARY_API_ORIGIN ?? "http://127.0.0.1:3133";
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const suffix = randomUUID();
const key = (name) => `real-canary-${suffix}:${name}`;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

const crc32 = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
};

const createReferencePng = () => {
  const width = 640;
  const height = 360;
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      let r = 248;
      let g = 246;
      let b = 238;
      const dx = x - 210;
      const dy = y - 180;
      if (dx * dx + dy * dy < 72 * 72) {
        r = 222; g = 55; b = 64;
      }
      if (x > 360 && x < 520 && y > 100 && y < 265 && y > -0.75 * (x - 360) + 220 && y > 0.75 * (x - 520) + 220) {
        r = 36; g = 96; b = 218;
      }
      if (x > 70 && x < 570 && y > 292 && y < 315) {
        r = 42; g = 128; b = 91;
      }
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload.data;
};

const waitFor = async (label, timeoutMs, poll) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const value = await poll();
    if (value.done) return value.data;
    if (value.status && value.status !== lastStatus) {
      lastStatus = value.status;
      console.log(`${label}: ${lastStatus}`);
    }
    await sleep(2_500);
  }
  throw new Error(`${label} did not finish before timeout. Last status: ${lastStatus || "unknown"}`);
};

const assertRealStack = async () => {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (state?.mode?.video_provider !== "sub2api") {
    throw new Error("The persistent local stack is not running in VIDEO_PROVIDER=sub2api mode.");
  }
  if (!state?.mode?.reference_delivery_origin) {
    throw new Error("The real Provider stack is missing a public reference delivery origin.");
  }
};

await assertRealStack();
await requestJson("/api/v1/health");

const project = await requestJson("/api/v1/projects", {
  method: "POST",
  idempotencyKey: key("project"),
  body: JSON.stringify({ name: `真实视频链路自检 ${suffix.slice(0, 8)}` }),
});

const imageBytes = createReferencePng();
const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
const upload = await requestJson(`/api/v1/projects/${project.id}/assets/upload-requests`, {
  method: "POST",
  idempotencyKey: key("upload"),
  body: JSON.stringify({
    kind: "IMAGE",
    filename: "real-provider-canary-reference.png",
    mime_type: "image/png",
    byte_size: imageBytes.length,
  }),
});
if (!upload.upload_url) throw new Error("Upload request did not return a presigned URL.");
const uploadResponse = await fetch(upload.upload_url, {
  method: "PUT",
  headers: upload.headers ?? {},
  body: imageBytes,
});
if (!uploadResponse.ok) throw new Error(`Presigned upload failed: ${uploadResponse.status}`);

const asset = await requestJson(`/api/v1/assets/${upload.asset_id}/confirm-upload`, {
  method: "POST",
  idempotencyKey: key("confirm"),
  body: JSON.stringify({ sha256: imageSha256, mime_type: "image/png", byte_size: imageBytes.length }),
});

const brief = await requestJson(`/api/v1/projects/${project.id}/creative-brief-revisions`, {
  method: "POST",
  idempotencyKey: key("brief"),
  body: JSON.stringify({
    source_text: "一个简洁的商业级视频：干净桌面上，红色圆环与蓝色三角作为品牌元素被柔和光线扫过，镜头缓慢推进，最后形成稳定的科技感展示画面。",
    target_duration_seconds: 15,
    target_resolution: "720p",
    style_preferences: "写实、干净、商业广告质感、柔和自然光、稳定镜头。",
    source_asset_ids: [asset.id],
  }),
});

await requestJson(`/api/v1/creative-brief-revisions/${brief.id}/plan`, {
  method: "POST",
  idempotencyKey: key("plan"),
  body: JSON.stringify({}),
});

const storyboard = await waitFor("storyboard", 120_000, async () => {
  const detail = await requestJson(`/api/v1/projects/${project.id}`);
  const latest = detail.storyboard_revisions?.at(-1);
  const failed = detail.creative_brief_revisions?.find((revision) => revision.id === brief.id && revision.status === "FAILED");
  if (failed) throw new Error("Creative planning failed before Provider canary.");
  if (latest?.status === "READY_FOR_REVIEW") return { done: true, data: latest };
  return { done: false, status: detail.creative_brief_revisions?.at(-1)?.status ?? "waiting" };
});
if (storyboard.shot_specs.length !== 1) {
  throw new Error(`Expected one real Provider canary segment, got ${storyboard.shot_specs.length}.`);
}
if (storyboard.shot_specs[0].duration_seconds !== 15 || storyboard.shot_specs[0].reference_policy !== "REFERENCE_SET") {
  throw new Error(`Unexpected canary storyboard shape: ${JSON.stringify(storyboard.shot_specs[0])}`);
}

const approved = await requestJson(`/api/v1/storyboard-revisions/${storyboard.id}/approve`, {
  method: "POST",
  idempotencyKey: key("approve"),
  body: JSON.stringify({}),
});

const deliveryPlan = await requestJson(`/api/v1/projects/${project.id}/delivery-plan-revisions`, {
  method: "POST",
  idempotencyKey: key("delivery-plan"),
  body: JSON.stringify({
    creative_brief_revision_id: brief.id,
    storyboard_revision_id: approved.id,
    duration_policy: "FLEXIBLE",
    flexible_duration_percent: 20,
    caption_policy: "OFF",
    lip_sync_requirement: "OFF",
    voice_mode: "PLATFORM_GENERIC",
    budget_limit: "0",
  }),
});

const approvedDeliveryPlan = await requestJson(`/api/v1/delivery-plan-revisions/${deliveryPlan.id}/approve`, {
  method: "POST",
  idempotencyKey: key("delivery-plan-approve"),
  body: JSON.stringify({}),
});

const productionRun = await requestJson(`/api/v1/projects/${project.id}/production-runs`, {
  method: "POST",
  idempotencyKey: key("production"),
  body: JSON.stringify({
    storyboard_revision_id: approved.id,
    delivery_plan_revision_id: approvedDeliveryPlan.id,
    music_plan: { mode: "OFF", style_hint: "" },
  }),
});

const finalVersion = await waitFor("production", 20 * 60_000, async () => {
  const [progress, versions] = await Promise.all([
    requestJson(`/api/v1/projects/${project.id}/production-runs`),
    requestJson(`/api/v1/projects/${project.id}/video-versions`),
  ]);
  const current = progress.find((run) => run.production_run.id === productionRun.id);
  if (current?.production_run.status === "FAILED" || current?.production_run.status === "BLOCKED") {
    throw new Error(`Production canary failed: ${JSON.stringify(current)}`);
  }
  const version = versions.find((item) => item.production_run_id === productionRun.id && item.status === "SUCCEEDED");
  if (version) return { done: true, data: version };
  const segmentStatus = current?.segments?.map((segment) => `${segment.sequence}:${segment.status}`).join(",") ?? "waiting";
  return { done: false, status: `${current?.production_run.status ?? "waiting"} ${segmentStatus}` };
});

const downloadInfo = await requestJson(`/api/v1/assets/${finalVersion.asset_id}/download-url`);
const videoResponse = await fetch(downloadInfo.download_url);
if (!videoResponse.ok) throw new Error(`Final video download failed: ${videoResponse.status}`);
const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
if (videoBytes.length < 10_000) throw new Error(`Final video is unexpectedly small: ${videoBytes.length} bytes.`);

console.log(`REAL_PROVIDER_CANARY=${JSON.stringify({
  ok: true,
  project_id: project.id,
  production_run_id: productionRun.id,
  video_version_id: finalVersion.id,
  asset_id: finalVersion.asset_id,
  duration_ms: finalVersion.duration_ms,
  downloaded_bytes: videoBytes.length,
})}`);
