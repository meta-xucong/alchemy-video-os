import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CreativeBriefRevisionSchema, DeliveryPlanRevisionSchema, ProductionRunSchema, ProjectDetailSchema, StoryboardRevisionSchema } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import { InMemoryCreativePlanningStore, InMemoryDeliveryPreflightStore, InMemoryDocumentConversionStore, type CreativePlanningStore, type DeliveryPreflightStore, type NarrationQualityStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";

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

const createReadyReference = async (input: Readonly<{
  app: ReturnType<typeof createApp>;
  assetStore: ReturnType<typeof createInMemoryAssetWorkspaceStore>;
  storage: InMemoryStoragePort;
  projectId: string;
  keySuffix: string;
}>) => {
  const bytes = new Uint8Array([1, 2, 3, input.keySuffix.length]);
  const upload = await readJson(await post(input.app, `/api/v1/projects/${input.projectId}/assets/upload-requests`, `c11-visual-upload-${input.keySuffix}`, {
    kind: "IMAGE",
    filename: `${input.keySuffix}.png`,
    mime_type: "image/png",
    byte_size: bytes.byteLength,
  }));
  const assetId = upload.data.asset_id as string;
  const asset = await input.assetStore.findAsset("ws_dev_default", assetId);
  assert.ok(asset);
  input.storage.putObject({ objectKey: asset.objectKey, mimeType: "image/png", bytes });
  const confirmed = await post(input.app, `/api/v1/assets/${assetId}/confirm-upload`, `c11-visual-confirm-${input.keySuffix}`, {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mime_type: "image/png",
    byte_size: bytes.byteLength,
  });
  assert.equal(confirmed.status, 200);
  return assetId;
};

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
  assert.equal((await readJson(premature)).error.code, "VALIDATION_FAILED");

  const approved = await post(app, `/api/v1/storyboard-revisions/${completed.id}/approve`, "c11-approve-storyboard");
  assert.equal(approved.status, 202);
  assert.equal((await readJson(approved)).data.status, "APPROVED");
  const delivery = await readJson(await post(app, `/api/v1/projects/${projectId}/delivery-plan-revisions`, "c11-create-delivery", {
    creative_brief_revision_id: brief.data.id,
    storyboard_revision_id: completed.id,
    budget_limit: "0",
  }));
  const deliveryApproval = await readJson(await post(app, `/api/v1/delivery-plan-revisions/${delivery.data.id}/approve`, "c11-approve-delivery"));
  const confirmedProductionCommand = {
    ...productionCommand,
    delivery_plan_revision_id: deliveryApproval.data.id,
    music_plan: { mode: "OFF" },
  };
  const production = await post(app, productionPath, "c11-confirm-production", confirmedProductionCommand);
  const productionBody = await readJson(production);
  assert.equal(production.status, 202);
  assert.equal(productionBody.data.status, "CONFIRMED");
  assert.equal(productionBody.data.total_segment_count, 2);
  assert.equal(productionBody.data.accepted_segment_count, 0);
  assert.doesNotThrow(() => ProductionRunSchema.parse(productionBody.data));
  assert.equal((await readJson(await post(app, productionPath, "c11-confirm-production", confirmedProductionCommand))).data.id, productionBody.data.id);

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

test("reference planning retries content analysis for READY images without using upload order", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const storage = new InMemoryStoragePort();
  const uploadApp = createApp({ store, assetStore, taskStore, storage });
  const project = await readJson(await post(uploadApp, "/api/v1/projects", "c11-vision-lazy-project", { name: "C11 lazy vision" }));
  const projectId = project.data.id as string;
  const sceneId = await createReadyReference({ app: uploadApp, assetStore, storage, projectId, keySuffix: "scene" });
  const subjectId = await createReadyReference({ app: uploadApp, assetStore, storage, projectId, keySuffix: "subject" });
  const calls: string[] = [];
  const planningApp = createApp({
    store,
    assetStore,
    taskStore,
    storage,
    referenceVisionAnalyzer: {
      analyze: async ({ assetId }) => {
        calls.push(assetId);
        return assetId === sceneId
          ? { role: "SCENE" as const, confidence: 0.96, summary: "建筑环境" }
          : { role: "SUBJECT" as const, confidence: 0.95, summary: "人物主体" };
      },
    },
  });
  const brief = await readJson(await post(planningApp, `/api/v1/projects/${projectId}/creative-brief-revisions`, "c11-lazy-vision-brief", {
    source_text: "制作一段企业介绍视频，画面需要使用这些参考图。",
    target_duration_seconds: 15,
    target_resolution: "480p",
    style_preferences: "克制、真实",
    source_asset_ids: [sceneId, subjectId],
  }));
  assert.equal(brief.data.status, "DRAFT");
  const planned = await post(planningApp, `/api/v1/creative-brief-revisions/${brief.data.id}/plan`, "c11-lazy-vision-plan");
  assert.equal(planned.status, 202);
  assert.deepEqual(calls, [sceneId, subjectId]);
  const detail = await assetStore.findProjectDetail("ws_dev_default", projectId);
  const byId = new Map(detail?.assets.map((asset) => [asset.id, asset]));
  assert.equal(byId.get(sceneId)?.metadata.visual_analysis_status, "READY");
  assert.equal((byId.get(sceneId)?.metadata.visual_analysis as { role?: string } | undefined)?.role, "SCENE");
  assert.equal((byId.get(subjectId)?.metadata.visual_analysis as { role?: string } | undefined)?.role, "SUBJECT");
});

test("explicit image-purpose text avoids visual analysis and remains authoritative", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const storage = new InMemoryStoragePort();
  const uploadApp = createApp({ store, assetStore, taskStore, storage });
  const project = await readJson(await post(uploadApp, "/api/v1/projects", "c11-explicit-vision-project", { name: "C11 explicit vision" }));
  const projectId = project.data.id as string;
  const firstId = await createReadyReference({ app: uploadApp, assetStore, storage, projectId, keySuffix: "first" });
  const secondId = await createReadyReference({ app: uploadApp, assetStore, storage, projectId, keySuffix: "second" });
  let calls = 0;
  const planningApp = createApp({
    store,
    assetStore,
    taskStore,
    storage,
    referenceVisionAnalyzer: { analyze: async () => { calls += 1; return { role: "STYLE" as const, confidence: 0.99 }; } },
  });
  const brief = await readJson(await post(planningApp, `/api/v1/projects/${projectId}/creative-brief-revisions`, "c11-explicit-vision-brief", {
    source_text: "第1张是场景图，第2张是人物图。",
    target_duration_seconds: 15,
    target_resolution: "480p",
    style_preferences: "",
    source_asset_ids: [firstId, secondId],
  }));
  const planned = await post(planningApp, `/api/v1/creative-brief-revisions/${brief.data.id}/plan`, "c11-explicit-vision-plan");
  assert.equal(planned.status, 202);
  assert.equal(calls, 0);
  const detail = await assetStore.findProjectDetail("ws_dev_default", projectId);
  assert.ok(detail?.assets.every((asset) => asset.metadata.visual_analysis_status === "UNAVAILABLE"));
});

test("C11.7 delivery preflight is approval-gated, fail-closed, and event-backed", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const planningStore = new InMemoryCreativePlanningStore(assetStore);
  const deliveryPreflightStore = new InMemoryDeliveryPreflightStore(planningStore);
  const app = createApp({ store, assetStore, taskStore, planningStore, deliveryPreflightStore });
  const project = await readJson(await post(app, "/api/v1/projects", "c117-project", { name: "C11.7 delivery preflight" }));
  const projectId = project.data.id as string;
  const briefPath = `/api/v1/projects/${projectId}/creative-brief-revisions`;
  const briefResponse = await post(app, briefPath, "c117-brief", {
    source_text: "企业团队在夜间完成交付，客户在清晨收到成果。",
    target_duration_seconds: 30,
    target_resolution: "480p",
    style_preferences: "克制、清晰",
    source_asset_ids: [],
  });
  const brief = await readJson(briefResponse);
  assert.equal(briefResponse.status, 201);
  const planResponse = await post(app, `/api/v1/creative-brief-revisions/${brief.data.id}/plan`, "c117-plan");
  assert.equal(planResponse.status, 202);
  const completed = await planningStore.completeCreativePlan({
    workspaceId: "ws_dev_default",
    creativeBriefRevisionId: brief.data.id,
    draft: {
      scriptRevisionId: createPrefixedId("scr"),
      storyboardRevisionId: createPrefixedId("sbr"),
      beats: [
        { sequence: 1, title: "夜间交付", summary: "团队完成交付", narrative_goal: "建立进展", visible_facts: ["夜间", "交付"] },
        { sequence: 2, title: "清晨收件", summary: "客户收到成果", narrative_goal: "完成承诺", visible_facts: ["清晨", "成果"] },
      ],
      title: "清晨交付",
      summary: "团队完成企业交付。",
      totalDurationSeconds: 30,
      continuityLevel: "STANDARD",
      continuityNote: "保持空间和人物连续。",
      shotSpecs: [
        { id: createPrefixedId("ssp"), sequence: 1, title: "完成交付", durationSeconds: 15, narrativeGoal: "建立进展", startState: "夜间车间", endState: "团队完成交付", transitionSummary: "切至车间", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "第一段", narrativeBeatSequences: [1] },
        { id: createPrefixedId("ssp"), sequence: 2, title: "清晨收件", durationSeconds: 15, narrativeGoal: "完成承诺", startState: "清晨门口", endState: "客户收到成果", transitionSummary: "淡入清晨", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [1], continuityNote: "承接前段结果", narrativeBeatSequences: [2] },
      ],
      narrativeBeatCount: 2,
      generationSegmentCount: 2,
    },
    event: event(),
  });
  assert.ok(completed);
  const storyboardApproval = await post(app, `/api/v1/storyboard-revisions/${completed.id}/approve`, "c117-approve-storyboard");
  assert.equal(storyboardApproval.status, 202);

  const deliveryPath = `/api/v1/projects/${projectId}/delivery-plan-revisions`;
  const command = {
    creative_brief_revision_id: brief.data.id,
    storyboard_revision_id: completed.id,
    duration_policy: "FLEXIBLE",
    flexible_duration_percent: 20,
    caption_policy: "REQUIRED",
    lip_sync_requirement: "OFF",
    voice_mode: "PLATFORM_GENERIC",
    budget_limit: "0",
  };
  const createdResponse = await post(app, deliveryPath, "c117-create-delivery", command);
  const created = await readJson(createdResponse);
  assert.equal(createdResponse.status, 202);
  assert.equal(created.data.status, "AWAITING_APPROVAL");
  assert.doesNotThrow(() => DeliveryPlanRevisionSchema.parse(created.data));
  const replayed = await readJson(await post(app, deliveryPath, "c117-create-delivery", command));
  assert.equal(replayed.data.id, created.data.id);
  const conflict = await post(app, deliveryPath, "c117-create-delivery", { ...command, caption_policy: "OPTIONAL" });
  assert.equal(conflict.status, 409);
  assert.equal((await readJson(conflict)).error.code, "IDEMPOTENCY_CONFLICT");

  const listed = await readJson(await app.request(`http://localhost${deliveryPath}`));
  assert.deepEqual(listed.data.map((plan: Record<string, unknown>) => plan.id), [created.data.id]);
  assert.equal((await deliveryPreflightStore.listDeliveryPreflightEvents("ws_dev_default", projectId)).length, 1);

  const approvalPath = `/api/v1/delivery-plan-revisions/${created.data.id}/approve`;
  const approvedResponse = await post(app, approvalPath, "c117-approve-delivery");
  const approved = await readJson(approvedResponse);
  assert.equal(approvedResponse.status, 202);
  assert.equal(approved.data.status, "APPROVED");
  assert.equal((await readJson(await post(app, approvalPath, "c117-approve-delivery"))).data.id, created.data.id);
  const eventsAfterApproval = await deliveryPreflightStore.listDeliveryPreflightEvents("ws_dev_default", projectId);
  assert.deepEqual(eventsAfterApproval.map((item) => item.event_type), ["delivery_plan.preflight_requested", "delivery_plan.approved"]);

  const productionPath = `/api/v1/projects/${projectId}/production-runs`;
  const productionCommand = {
    storyboard_revision_id: completed.id,
    delivery_plan_revision_id: approved.data.id,
    music_plan: { mode: "OFF" },
  };
  const productionResponse = await post(app, productionPath, "c117-production", productionCommand);
  const production = await readJson(productionResponse);
  assert.equal(productionResponse.status, 202);
  assert.equal(production.data.delivery_plan_revision_id, approved.data.id);
  assert.equal((await deliveryPreflightStore.findDeliveryPlanRevision("ws_dev_default", approved.data.id)).status, "CONSUMED");
  const productionReplay = await post(app, productionPath, "c117-production", productionCommand);
  assert.equal(productionReplay.status, 202);
  assert.equal((await readJson(productionReplay)).data.id, production.data.id);
  const secondProduction = await post(app, productionPath, "c117-production-second", productionCommand);
  assert.equal(secondProduction.status, 400);
  assert.equal((await readJson(secondProduction)).error.code, "DELIVERY_PREFLIGHT_BLOCKED");

  const blockedResponse = await post(app, deliveryPath, "c117-blocked-delivery", { ...command, voice_mode: "AUTHORIZED_CLONE" });
  const blocked = await readJson(blockedResponse);
  assert.equal(blockedResponse.status, 202);
  assert.equal(blocked.data.status, "PREFLIGHT_BLOCKED");
  assert.deepEqual(blocked.data.block_reasons, ["VOICE_AUTHORIZATION_REQUIRED"]);
  assert.equal((await deliveryPreflightStore.listDeliveryPreflightEvents("ws_dev_default", projectId)).length, 4);
  assert.deepEqual(await taskStore.listProjectTaskRuns("ws_dev_default", projectId), []);
});

test("native provider audio bypasses the platform narration TimelinePlan gate while Mock remains fail-closed", async () => {
  const createScenario = async (videoProviderMode: "mock" | "sub2api") => {
    const store = createInMemoryControlPlaneStore();
    const assetStore = createInMemoryAssetWorkspaceStore(store);
    const taskStore = createInMemoryTaskRunStore(assetStore);
    let projectId = "";
    let createProductionRunCalls = 0;
    let timelineReadinessChecks = 0;
    const deliveryPlanRevisionId = createPrefixedId("dpr");
    const creativeBriefRevisionId = createPrefixedId("cbr");
    const planningStore = {
      async findCreativeBriefRevision() {
        return { projectId, sourceText: "旁白：Provider 原生音轨承载这段台词。" };
      },
      async createProductionRun(input: { productionRunId: string; workspaceId: string; projectId: string; storyboardRevisionId: string; deliveryPlanRevisionId?: string }) {
        createProductionRunCalls += 1;
        const timestamp = new Date().toISOString();
        return {
          kind: "NEW" as const,
          status: 202 as const,
          value: {
            id: input.productionRunId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            storyboardRevisionId: input.storyboardRevisionId,
            ...(input.deliveryPlanRevisionId ? { deliveryPlanRevisionId: input.deliveryPlanRevisionId } : {}),
            status: "CONFIRMED" as const,
            totalShotCount: 1,
            acceptedShotCount: 0,
            totalSegmentCount: 1,
            acceptedSegmentCount: 0,
            totalDurationSeconds: 15,
            continuityStatus: "NOT_CHECKED" as const,
            plannedSegmentCount: 1,
            maxAutoRepairCount: 2,
            autoRepairCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      },
    } as unknown as CreativePlanningStore;
    const deliveryPreflightStore = {
      async findDeliveryPlanRevision(workspaceId: string, id: string) {
        return workspaceId === "ws_dev_default" && id === deliveryPlanRevisionId
          ? {
            id: deliveryPlanRevisionId,
            workspaceId,
            projectId,
            creativeBriefRevisionId,
            storyboardRevisionId: createPrefixedId("sbr"),
            revision: 1,
            status: "APPROVED" as const,
            durationPolicy: "FLEXIBLE" as const,
            flexibleDurationPercent: 20,
            targetDurationSeconds: 15,
            requiresSampleApproval: true,
            captionPolicy: "REQUIRED" as const,
            lipSyncRequirement: "OFF" as const,
            voiceMode: "PLATFORM_GENERIC" as const,
            safeSummary: "local fixture",
            blockReasons: [],
            approvedAt: new Date().toISOString(),
            consumedByProductionRunId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          : undefined;
      },
    } as unknown as DeliveryPreflightStore;
    const narrationQualityStore = {
      async hasReadyTimelinePlan() {
        timelineReadinessChecks += 1;
        return false;
      },
    } as unknown as NarrationQualityStore;
    const app = createApp({
      store,
      assetStore,
      taskStore,
      planningStore,
      deliveryPreflightStore,
      narrationQualityStore,
      videoProviderMode,
    });
    const project = await readJson(await post(app, "/api/v1/projects", `native-gate-${videoProviderMode}`, { name: `${videoProviderMode} native gate` }));
    projectId = project.data.id as string;
    const response = await post(app, `/api/v1/projects/${projectId}/production-runs`, `native-gate-production-${videoProviderMode}`, {
      storyboard_revision_id: createPrefixedId("sbr"),
      delivery_plan_revision_id: deliveryPlanRevisionId,
      music_plan: { mode: "OFF" },
    });
    return { response, timelineReadinessChecks, createProductionRunCalls };
  };

  const native = await createScenario("sub2api");
  assert.equal(native.response.status, 202);
  assert.equal(native.timelineReadinessChecks, 0);
  assert.equal(native.createProductionRunCalls, 1);

  const mock = await createScenario("mock");
  assert.equal(mock.response.status, 422);
  assert.equal((await readJson(mock.response)).error.code, "DELIVERY_PLAN_STATE_INVALID");
  assert.equal(mock.timelineReadinessChecks, 1);
  assert.equal(mock.createProductionRunCalls, 0);
});


test("C11.1 rejects a document until its Markdown conversion succeeds without creating a brief", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const documentStore = new InMemoryDocumentConversionStore(assetStore);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store, assetStore, documentStore, storage });
  const project = await readJson(await post(app, "/api/v1/projects", "c111-project", { name: "C11.1 资料规划" }));
  const projectId = project.data.id as string;
  const sourceBytes = new TextEncoder().encode("# 企业资料\n交付承诺");
  const upload = await readJson(await post(app, `/api/v1/projects/${projectId}/assets/upload-requests`, "c111-upload", {
    kind: "DOCUMENT",
    filename: "brief.md",
    mime_type: "text/markdown",
    byte_size: sourceBytes.byteLength,
  }));
  const sourceAssetId = upload.data.asset_id as string;
  const sourceAsset = await assetStore.findAsset("ws_dev_default", sourceAssetId);
  assert.ok(sourceAsset);
  await storage.putObject({ objectKey: sourceAsset.objectKey, mimeType: "text/markdown", bytes: sourceBytes });
  const confirmed = await post(app, `/api/v1/assets/${sourceAssetId}/confirm-upload`, "c111-confirm", {
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    mime_type: "text/markdown",
    byte_size: sourceBytes.byteLength,
  });
  assert.equal(confirmed.status, 200);
  const conversion = await post(app, `/api/v1/projects/${projectId}/documents/${sourceAssetId}/conversions`, "c111-convert");
  assert.equal(conversion.status, 202);
  const brief = await post(app, `/api/v1/projects/${projectId}/creative-brief-revisions`, "c111-brief", {
    source_text: "围绕企业交付承诺规划一段短片。",
    target_duration_seconds: 15,
    target_resolution: "720p",
    style_preferences: "",
    source_asset_ids: [sourceAssetId],
  });
  assert.equal(brief.status, 422);
  assert.equal((await readJson(brief)).error.code, "DOCUMENT_CONTEXT_INVALID");
  const detail = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}`));
  assert.deepEqual(detail.data.creative_brief_revisions, []);
});
