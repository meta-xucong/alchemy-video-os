import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("C11 Studio uses only public story-planning commands and keeps project detail as its source of truth", () => {
  const api = read("app/composables/useControlApi.ts");
  const workspace = read("app/pages/projects/[project_id].vue");

  for (const route of [
    "/api/v1/projects/${projectId}/creative-brief-revisions",
    "/api/v1/creative-brief-revisions/${creativeBriefRevisionId}/plan",
    "/api/v1/projects/${projectId}/storyboard-revisions",
    "/api/v1/storyboard-revisions/${storyboardRevisionId}/approve",
    "/api/v1/projects/${projectId}/production-runs",
  ]) {
    assert.match(api, new RegExp(route.replaceAll("/", "\\/").replaceAll("$", "\\$")));
  }
  for (const field of ["creative_brief_revisions", "storyboard_revisions", "production_runs"]) {
    assert.match(api, new RegExp(field));
    assert.match(workspace, new RegExp(field));
  }
  assert.doesNotMatch(api, /\/internal\//);
  assert.doesNotMatch(api, /\b(?:provider|queue|outbox|object_key|veyra)\b/i);
});

test("C11 Studio hides planning buttons but still runs the public plan-approve-production sequence", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const panel = read("app/components/studio/StoryPlanningPanel.vue");
  const source = `${workspace}\n${panel}`;

  for (const symbol of ["createCreativeBriefRevision", "requestCreativePlan", "approveStoryboardRevision", "createProductionRun"]) {
    assert.match(source, new RegExp(symbol));
  }
  for (const key of ["studio-auto-brief", "studio-auto-plan", "studio-auto-approve", "studio-auto-production"]) {
    assert.match(workspace, new RegExp(`commandKey\\("${key}"\\)`));
  }
  assert.match(workspace, /waitForAutoStoryboard/);
  assert.match(workspace, /applyStoryboardRevision\(approved\.data\);/);
  assert.match(workspace, /applyProductionRun\(production\.data\);/);
  assert.match(panel, /AI 会在后台完成所有准备和制作/);
  assert.doesNotMatch(panel, /生成故事计划|确认故事计划|确认完整制作计划|当前不会提交任何视频/);
  assert.doesNotMatch(panel, /createGeneration|TaskRun|Provider|模型|队列/);
});

test("C11 Studio retains a long-story input, adjustable total duration, user-facing resolution, and default reference material selection", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const panel = read("app/components/studio/StoryPlanningPanel.vue");
  const references = read("app/components/studio/ReferenceShelf.vue");
  const events = read("app/composables/useProjectEvents.ts");

  assert.match(panel, /maxlength="50000"/);
  assert.match(panel, /min="15" max="600"/);
  assert.match(panel, /story-resolution-480p/);
  assert.match(panel, /story-resolution-720p/);
  assert.match(panel, /标准清晰/);
  assert.match(panel, /高清/);
  assert.match(panel, /预计生成 \{\{ estimatedSegments\.length \}\} 段视频/);
  assert.match(panel, /叙事点只是关键剧情内容，不会截断故事/);
  assert.match(panel, /aria-label="预计生成片段"/);
  assert.match(panel, /第 \{\{ segment\.sequence \}\} 段/);
  assert.match(panel, /约 \{\{ segment\.durationSeconds \}\} 秒/);
  assert.match(panel, /function estimateGenerationSegments/);
  assert.match(panel, /Math\.ceil\(safeDurationSeconds \/ 10\)/);
  assert.match(references, /已自动作为参考素材/);
  assert.match(workspace, /targetResolution: "720p" as "480p" \| "720p"/);
  assert.match(workspace, /target_resolution: planningDraft\.targetResolution/);
  assert.match(workspace, /function eligibleReferenceImageIds\(ids: string\[\]\)/);
  assert.match(workspace, /function defaultSelectedReferenceIds\(\)/);
  assert.match(workspace, /\? eligibleReferenceImageIds\(brief\.source_asset_ids\)/);
  assert.match(workspace, /syncPlanningReferenceSourceIds\(selectedReferenceIds\.value\)/);
  assert.match(workspace, /planningDraft\.sourceAssetIds = uniqueReferenceIds\(\[\.\.\.readyPlanningDocumentIds\.value, \.\.\.selectedReferenceIds\.value\]\);/);
  assert.match(workspace, /planningDraft\.sourceAssetIds = uniqueReferenceIds\(\[\.\.\.planningDraft\.sourceAssetIds, request\.data\.asset_id\]\);/);
  assert.doesNotMatch(panel, /story-source-assets|selected-source-asset-ids|sourceAssets/);
  for (const eventType of ["creative_brief.planning_requested", "storyboard_revision.ready_for_review", "storyboard_revision.approved", "production_run.confirmed"]) {
    assert.match(events, new RegExp(eventType.replaceAll(".", "\\.")));
  }
});
