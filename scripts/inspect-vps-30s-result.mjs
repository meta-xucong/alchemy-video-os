import { readFile } from "node:fs/promises";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const password = (await readFile(".codex-longrun/video-deploy-browser-password.txt", "utf8")).trim();
const auth = Buffer.from(`video-admin:${password}`).toString("base64");
const projectId = "prj_01M0S6Z9KEQ54GXEPGN371J0H3";
const response = await fetch(`https://video.aiself.vip/api/v1/projects/${projectId}`, { headers: { Authorization: `Basic ${auth}` } });
const body = await response.json();
const data = body.data;
const brief = data.creative_brief_revisions?.find((item) => item.id === "cbr_01M0T431N4MK2CKBRM4XX6B0ER");
const storyboard = data.storyboard_revisions?.find((item) => item.id === "sbr_01M0T434ZE7XN48HVSAF6RDB33");
const run = data.production_runs?.find((item) => item.id === "prd_01M0T43DP7K92SM070QXR8B89K");
const version = data.video_versions?.find((item) => item.production_run_id === run?.id);
console.log(JSON.stringify({
  brief: { id: brief?.id, status: brief?.status, target_duration_seconds: brief?.target_duration_seconds },
  storyboard: {
    id: storyboard?.id,
    status: storyboard?.status,
    shots: storyboard?.shot_specs?.map((shot) => ({ sequence: shot.sequence, duration_seconds: shot.duration_seconds, narrative_goal: shot.narrative_goal })),
  },
  run,
  version: version ? { id: version.id, status: version.status, asset_id: version.asset_id, duration_ms: version.duration_ms, final_review: version.final_review } : undefined,
}, null, 2));
