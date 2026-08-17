import assert from "node:assert/strict";
import test from "node:test";

import { CreativeBriefRevisionSchema, ProductionRunSchema, ProjectDetailSchema, StoryboardRevisionSchema } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import { InMemoryCreativePlanningStore } from "@alchemy-video/persistence";

import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;
const event = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const post = (app: ReturnType<typeof createApp>, path: string, idempotencyKey: string, body: Record<string, unknown> = {}) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });

test("C11 creative planning routes are replay-safe, reviewable, and never create a video task", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const planningStore = new InMemoryCreativePlanningStore(assetStore);
  const app = createApp({ store, assetStore, taskStore, planningStore });
  const project = await readJson(await post(app, "/api/v1/projects", "c11-project", { name: "C11 narrative planning" }));
  const projectId = project.data.id as string;

  const briefPath = `/api/v1/projects/${projectId}/creative-brief-revisions`;
  const briefCommand = {
    source_text: "创始人在雨夜抵达工厂，决定让团队完成最后一次交付。团队点亮车间，客户在黎明前收到成果。",
    target_duration_seconds: 30,
    target_resolution: "480p",
    style_preferences: "纪实感、克制的暖色灯光",
    source_asset_ids: [],
  };
  const briefResponse = await post(app, briefPath, "c11-create-brief", briefCommand);
  const brief = await readJson(briefResponse);
  assert.equal(briefResponse.status, 201);
  assert.equal(brief.data.status, "DRAFT");
  assert.equal(brief.data.revision, 1);
  assert.equal(brief.data.target_resolution, "480p");
  assert.doesNotThrow(() => CreativeBriefRevisionSchema.parse(brief.data));
  assert.equal((await readJson(await post(app, briefPath, "c11-create-brief", briefCommand))).data.id, brief.data.id);

  const planPath = `/api/v1/creative-brief-revisions/${brief.data.id}/plan`;
  const plannedResponse = await post(app, planPath, "c11-request-plan");
  assert.equal(plannedResponse.status, 202);
  assert.equal((await readJson(plannedResponse)).data.status, "PLANNING");
  assert.equal((await post(app, planPath, "c11-plan-conflict")).status, 409);
  assert.equal((await readJson(await post(app, planPath, "c11-plan-conflict-2"))).error.code, "CREATIVE_PLAN_ACTIVE_CONFLICT");

  const completed = await planningStore.completeCreativePlan({
    workspaceId: "ws_dev_default",
    creativeBriefRevisionId: brief.data.id,
    draft: {
      scriptRevisionId: createPrefixedId("scr"),
      storyboardRevisionId: createPrefixedId("sbr"),
      beats: [
        { sequence: 1, title: "抵达", summary: "创始人抵达工厂", narrative_goal: "建立危机", visible_facts: ["雨夜", "工厂"] },
        { sequence: 2, title: "交付", summary: "团队完成交付", narrative_goal: "完成承诺", visible_facts: ["车间亮灯", "黎明"] },
      ],
      title: "雨夜交付",
      summary: "团队在雨夜完成承诺。",
      totalDurationSeconds: 30,
      continuityLevel: "STANDARD",
      continuityNote: "使用明确转场维持叙事连续性。",
      shotSpecs: [
        { id: createPrefixedId("ssp"), sequence: 1, title: "雨夜抵达", durationSeconds: 15, narrativeGoal: "建立危机", startState: "雨夜街道", endState: "进入车间", transitionSummary: "切至亮灯", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "第一段", narrativeBeatSequences: [1] },
        { id: createPrefixedId("ssp"), sequence: 2, title: "黎明交付", durationSeconds: 15, narrativeGoal: "完成承诺", startState: "车间亮起", endState: "客户收到成果", transitionSummary: "淡入黎明", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [1], continuityNote: "承接前段结果", narrativeBeatSequences: [2] },
      ],
      narrativeBeatCount: 2,
      generationSegmentCount: 2,
    },
    event: event(),
  });
  assert.ok(completed);

  const storyboards = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}/storyboard-revisions`));
  assert.equal(storyboards.data.length, 1);
  assert.equal(storyboards.data[0].shot_specs.length, 2);
  assert.equal(storyboards.data[0].narrative_beat_count, 2);
  assert.equal(storyboards.data[0].generation_segment_count, 2);
  assert.deepEqual(storyboards.data[0].shot_specs.map((shotSpec: Record<string, unknown>) => shotSpec.narrative_beat_sequences), [[1], [2]]);
  assert.doesNotThrow(() => StoryboardRevisionSchema.parse(storyboards.data[0]));
  const productionPath = `/api/v1/projects/${projectId}/production-runs`;
  const productionCommand = { storyboard_revision_id: completed.id };
  const premature = await post(app, productionPath, "c11-production-before-approval", productionCommand);
  assert.equal(premature.status, 400);
  assert.equal((await readJson(premature)).error.code, "PRODUCTION_RUN_STATE_INVALID");

  const approved = await post(app, `/api/v1/storyboard-revisions/${completed.id}/approve`, "c11-approve-storyboard");
  assert.equal(approved.status, 202);
  assert.equal((await readJson(approved)).data.status, "APPROVED");
  const production = await post(app, productionPath, "c11-confirm-production", productionCommand);
  const productionBody = await readJson(production);
  assert.equal(production.status, 202);
  assert.equal(productionBody.data.status, "CONFIRMED");
  assert.equal(productionBody.data.total_segment_count, 2);
  assert.equal(productionBody.data.accepted_segment_count, 0);
  assert.doesNotThrow(() => ProductionRunSchema.parse(productionBody.data));
  assert.equal((await readJson(await post(app, productionPath, "c11-confirm-production", productionCommand))).data.id, productionBody.data.id);

  const detail = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}`));
  assert.equal(detail.data.creative_brief_revisions.length, 1);
  assert.equal(detail.data.storyboard_revisions[0].status, "APPROVED");
  assert.equal(detail.data.production_runs[0].id, productionBody.data.id);
  assert.doesNotThrow(() => ProjectDetailSchema.parse(detail.data));
  assert.deepEqual(await taskStore.listProjectTaskRuns("ws_dev_default", projectId), []);
  assert.equal(JSON.stringify(productionBody).includes("provider"), false);
  assert.equal(JSON.stringify(productionBody).includes("task_run"), false);
});

test("C11 planning routes reject a missing project and preserve idempotency conflicts", async () => {
  const app = createApp();
  const missingProjectId = "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const path = `/api/v1/projects/${missingProjectId}/creative-brief-revisions`;
  const body = { source_text: "未存在项目", target_duration_seconds: 15, target_resolution: "720p", style_preferences: "", source_asset_ids: [] };
  const missing = await post(app, path, "c11-missing-project", body);
  assert.equal(missing.status, 404);
  assert.equal((await readJson(missing)).error.code, "NOT_FOUND");

  const conflictPath = "/api/v1/projects";
  const first = await post(app, conflictPath, "c11-project-conflict", { name: "first" });
  assert.equal(first.status, 201);
  const conflicting = await post(app, conflictPath, "c11-project-conflict", { name: "second" });
  assert.equal(conflicting.status, 409);
  assert.equal((await readJson(conflicting)).error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(fingerprintRequest({ name: "first" }) === fingerprintRequest({ name: "second" }), false);
});
