import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("Studio presents an operator workbench with accessible local-MVP controls", () => {
  const page = read("app/pages/index.vue");

  for (const label of [
    "创建项目",
    "上传参考图",
    "创建分镜",
    "标记为可生成",
    "生成本地 Mock 视频",
    "重试失败任务",
    "关闭预览",
  ]) {
    assert.match(page, new RegExp(label));
  }

  for (const surface of ["project-navigator", "asset-library", "storyboard-workbench", "run-activity", "media-dialog"]) {
    assert.match(page, new RegExp(surface));
  }

  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /:aria-label="item.name"/);
  assert.match(page, /SSE/);
  assert.match(page, /closePreview/);
  assert.match(page, /cancelShotEdit/);
  assert.match(page, /localWorkspaceLabel/);
  assert.match(page, /localIdentityLabel/);
  assert.doesNotMatch(page, /Create project|Generate mock video|Retry failed task|Preview generated video/);
});

test("Studio workbench retains only public Control API and safe browser state", () => {
  const page = read("app/pages/index.vue");
  const composable = read("app/composables/useControlApi.ts");

  assert.match(page, /new EventSource\(`\/api\/v1\/events/);
  assert.match(page, /assetDownloadUrl/);
  assert.match(page, /safeErrorMessage/);
  assert.doesNotMatch(`${page}\n${composable}`, /\/internal\//);
  assert.doesNotMatch(`${page}\n${composable}`, /\b(?:object_key|provider_request_id|request_payload|response_payload|veyra|minio|bullmq|outbox)\b/i);
});

test("Studio CSS defines stable desktop columns and single-column mobile recovery", () => {
  const styles = read("app/assets/studio.css");

  assert.match(styles, /--black-soft:\s*#f3f0ea/);
  assert.match(styles, /--brass:\s*#9a7535/);
  assert.match(styles, /border-radius:\s*(?:5|6|8)px/);
  assert.match(styles, /backdrop-filter:\s*blur\(20px\)/);
  assert.match(styles, /\.workbench-columns/);
  assert.match(styles, /grid-template-columns:\s*220px/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.media-dialog/);
  assert.match(styles, /\.project-navigator/);
});
