import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("M1 project shell has accessible Chinese project controls", () => {
  const home = read("app/pages/projects/index.vue");
  const workspace = read("app/pages/projects/[project_id].vue");

  for (const label of [
    "新建项目",
    "创建并进入",
    "返回项目列表",
    "刷新项目",
    "编辑名称",
    "保存名称",
    "归档项目",
    "删除项目",
  ]) {
    assert.match(`${home}\n${workspace}`, new RegExp(label));
  }

  assert.match(home, /aria-label="项目列表"/);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /aria-describedby="delete-capability-note"/);
  assert.match(workspace, /deleteNameConfirmation/);
  assert.match(workspace, /输入“删除”确认/);
  assert.match(workspace, /确认删除项目/);
  assert.doesNotMatch(`${home}\n${workspace}`, /Create project|Delete project|Generate mock video/);
});

test("M1 project browser state is route-owned and safe to replace", () => {
  const session = read("app/composables/useProjectSession.ts");
  const workspace = read("app/pages/projects/[project_id].vue");

  assert.match(workspace, /useRoute\(\)/);
  assert.match(workspace, /watch\(projectId/);
  assert.match(session, /clearProjectState\(\)/);
  assert.match(session, /replaceProjectDetail/);
  assert.match(session, /selectedProjectId\.value = projectId/);
  assert.match(session, /detail\.value = loaded/);
  assert.match(session, /releasePreview/);
});

test("C10 presents project materials through public commands with user-facing status and retry controls", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const materials = read("app/components/studio/ProjectMaterials.vue");
  const composable = read("app/composables/useControlApi.ts");
  const events = read("app/composables/useProjectEvents.ts");
  const source = `${workspace}\n${materials}\n${composable}\n${events}`;

  for (const name of ["documents", "createDocumentConversion", "retryDocumentConversion", "uploadDocument", "retryDocument", "refreshDocuments"]) {
    assert.match(source, new RegExp(name));
  }
  for (const label of ["项目资料", "添加资料", "正在整理", "正在理解项目内容", "已准备好用于这次创作", "这份资料暂时无法使用", "重新整理", "查看要点", "本次不采用"]) {
    assert.match(`${workspace}\n${materials}`, new RegExp(label));
  }
  for (const eventType of ["document_conversion.queued", "document_conversion.started", "document_conversion.succeeded", "document_conversion.failed"]) {
    assert.match(events, new RegExp(eventType));
  }
  assert.doesNotMatch(`${workspace}\n${materials}`, /MarkItDown|object_key|runtime_url|document-runtime|bullmq|outbox|查看资料/i);
  assert.doesNotMatch(composable, /\/internal\//);
});

test("C11.2 keeps document understanding safe, explicit, and generation-gated", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const materials = read("app/components/studio/ProjectMaterials.vue");
  const composable = read("app/composables/useControlApi.ts");
  const events = read("app/composables/useProjectEvents.ts");
  const source = `${workspace}\n${materials}\n${composable}\n${events}`;

  for (const label of ["正在理解项目资料，完成后即可开始", "有资料暂时无法使用", "本次采用", "重新理解", "documentKnowledgeDetail", "retryDocumentKnowledgeRevision"]) {
    assert.match(source, new RegExp(label));
  }
  for (const eventType of ["document_knowledge.queued", "document_knowledge.started", "document_knowledge.succeeded", "document_knowledge.failed"]) {
    assert.match(events, new RegExp(eventType));
  }
  assert.doesNotMatch(materials, /download-url|assetDownloadUrl|object_key|provider|runtime_url|查看资料/i);
  assert.match(workspace, /blockingDocumentMaterials/);
  assert.match(workspace, /understanding\?\.status === "READY"/);
});

test("M1 CSS keeps project views bounded on desktop and mobile", () => {
  const styles = read("app/assets/studio.css");

  assert.match(styles, /--black-soft:\s*#f3f0ea/);
  assert.match(styles, /--brass:\s*#9a7535/);
  assert.match(styles, /\.project-home/);
  assert.match(styles, /\.project-grid/);
  assert.match(styles, /minmax\(240px, 1fr\)/);
  assert.match(styles, /\.project-workspace-header/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.project-management-actions/);
  assert.match(styles, /border-radius:\s*(?:4|6|8)px/);
});
