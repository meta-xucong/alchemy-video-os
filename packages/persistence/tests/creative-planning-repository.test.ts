import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCreativePlanningStore } from "../src/creative-planning-repository.js";

const hash = (suffix: string) => suffix.padEnd(64, "0").slice(0, 64);

const event = (suffix: string) => ({
  eventId: `evt_${suffix}`,
  messageId: `msg_${suffix}`,
  traceId: `trc_${suffix}`,
  correlationId: `cor_${suffix}`,
});

const sourceAssets = new Map([
  ["ast_ready", { projectId: "prj_story", status: "READY", origin: "USER_UPLOAD", kind: "IMAGE" }],
  ["ast_document", { projectId: "prj_story", status: "READY", origin: "USER_UPLOAD", kind: "DOCUMENT" }],
  ["ast_handoff", { projectId: "prj_story", status: "READY", origin: "DERIVED", kind: "IMAGE" }],
  ["ast_pending", { projectId: "prj_story", status: "PENDING_UPLOAD", origin: "USER_UPLOAD", kind: "IMAGE" }],
  ["ast_other", { projectId: "prj_other", status: "READY", origin: "USER_UPLOAD", kind: "IMAGE" }],
]);

const store = () => new InMemoryCreativePlanningStore({
  findAsset: async (_workspaceId, assetId) => sourceAssets.get(assetId),
});

const createBrief = (idempotencyKey = "idem_create") => ({
  scope: "usr_dev_owner:/api/v1/projects/prj_story/creative-brief-revisions",
  idempotencyKey,
  requestHash: hash(idempotencyKey),
  workspaceId: "ws_story",
  projectId: "prj_story",
  creativeBriefRevisionId: "cbr_story_1",
  sourceText: "A founder returns to the factory and resolves a delayed delivery with the team.",
  targetDurationSeconds: 24,
  targetResolution: "480p" as const,
  stylePreferences: "Cinematic, warm industrial daylight.",
  sourceAssetIds: ["ast_ready"],
  event: event(idempotencyKey),
});

test("reference-only UI analysis is not promoted to object locks", async () => {
  const sourceAssetIds = ["ast_ui_dashboard", "ast_ui_mobile", "ast_ui_style", "ast_ui_detail"];
  const uiObjects = (count: number) => Array.from({ length: count }, (_, index) => ({
    name: `UI模块${index + 1}`,
    description: "界面中的信息模块。",
    relation: "位于屏幕布局中。",
    prohibited_changes: ["不得删除模块"],
  }));
  const assets = new Map(sourceAssetIds.map((assetId, index) => [assetId, {
    projectId: "prj_story",
    status: "READY",
    origin: "USER_UPLOAD",
    kind: "IMAGE",
    metadata: {
      filename: ["02.png", "16.png", "04.png", "26.png"][index],
      visual_analysis: { role: "SCENE", confidence: 0.98, objects: uiObjects(7) },
    },
  }]));
  const planningStore = new InMemoryCreativePlanningStore({
    findAsset: async (_workspaceId, assetId) => assets.get(assetId),
  });
  const locks = await planningStore.resolveVisualObjectLocks({
    workspaceId: "ws_story",
    projectId: "prj_story",
    sourceAssetIds,
    sourcePrompt: "参考图用途说明（按文件名，不按上传顺序推断）：02.png 是产品界面主体参考；16.png 是场景环境参考；04.png 是视觉风格和配色参考；26.png 是视觉风格和配色参考。所有参考图仅作为视觉锚点。",
  });
  assert.deepEqual(locks, []);
});

test("mixed references keep explicit foreground analysis locks and filter UI analysis", async () => {
  const sourceAssetIds = ["ast_ui_screen", "ast_person"];
  const assets = new Map(sourceAssetIds.map((assetId, index) => [assetId, {
    projectId: "prj_story",
    status: "READY",
    origin: "USER_UPLOAD",
    kind: "IMAGE",
    metadata: {
      filename: index === 0 ? "dashboard.png" : "person.png",
      visual_analysis: {
        role: index === 0 ? "SUBJECT" : "SUBJECT",
        confidence: 0.98,
        objects: [{
          name: index === 0 ? "界面模块" : "人物主体",
          description: index === 0 ? "屏幕中的界面模块。" : "参考图中的人物主体。",
          relation: index === 0 ? "位于屏幕布局中。" : "位于画面前景。",
          prohibited_changes: ["保持原样"],
        }],
      },
    },
  }]));
  const planningStore = new InMemoryCreativePlanningStore({
    findAsset: async (_workspaceId, assetId) => assets.get(assetId),
  });
  const locks = await planningStore.resolveVisualObjectLocks({
    workspaceId: "ws_story",
    projectId: "prj_story",
    sourceAssetIds,
    sourcePrompt: "dashboard.png 是产品界面参考；person.png 是人物原型。",
  });
  assert.deepEqual(locks.map((lock) => lock.name), ["人物主体"]);
});

const completePlan = (
  planningStore: InMemoryCreativePlanningStore,
  ids = { scriptRevisionId: "scr_story_1", storyboardRevisionId: "sbr_story_1" },
) => planningStore.completeCreativePlan({
  workspaceId: "ws_story",
  creativeBriefRevisionId: "cbr_story_1",
  event: event("ready"),
  draft: {
    scriptRevisionId: ids.scriptRevisionId,
    storyboardRevisionId: ids.storyboardRevisionId,
    beats: [
      { sequence: 1, title: "Return", summary: "The founder arrives at the factory.", narrative_goal: "Set the delivery pressure.", visible_facts: ["factory", "founder"], generation_segment_sequence: 1 },
      { sequence: 2, title: "Decision", summary: "The team agrees on a recovery plan.", narrative_goal: "Make the recovery plan visible.", visible_facts: ["team", "schedule"], generation_segment_sequence: 2 },
      { sequence: 3, title: "Recovery", summary: "The shipment leaves on time.", narrative_goal: "Show the promise fulfilled.", visible_facts: ["truck", "dock"], generation_segment_sequence: 3 },
    ],
    title: "Factory delivery recovery",
    summary: "A three-scene plan resolves the delivery delay through a visible team decision.",
    totalDurationSeconds: 24,
    continuityLevel: "STANDARD",
    continuityNote: "Each segment begins from the prior location and action state.",
    shotSpecs: [
      {
        id: "ssp_story_1",
        sequence: 1,
        title: "Arrival",
        durationSeconds: 8,
        narrativeGoal: "Show the founder discovering the delay.",
        startState: "Factory gate at morning.",
        endState: "Founder enters the assembly floor.",
        transitionSummary: "Continue the walking direction indoors.",
        referencePolicy: "REFERENCE_SET",
        dependsOnSequences: [],
        continuityNote: "Keep the founder wardrobe and factory palette consistent.",
        narrativeBeatSequences: [1],
      },
      {
        id: "ssp_story_2",
        sequence: 2,
        title: "Decision",
        durationSeconds: 8,
        narrativeGoal: "Show the team agreeing on a recovery plan.",
        startState: "Assembly floor discussion begins.",
        endState: "Team points to the revised schedule.",
        transitionSummary: "Cut from entry motion to the meeting table.",
        referencePolicy: "TEXT_TRANSITION",
        dependsOnSequences: [1],
        continuityNote: "Use a deliberate cut; no unsupported frame-continuity claim.",
        narrativeBeatSequences: [2],
      },
      {
        id: "ssp_story_3",
        sequence: 3,
        title: "Recovery",
        durationSeconds: 8,
        narrativeGoal: "Show the shipment leaving on time.",
        startState: "The revised schedule is approved.",
        endState: "Truck departs the loading dock.",
        transitionSummary: "Carry the schedule card into the loading-dock scene.",
        referencePolicy: "HANDOFF_FIRST_FRAME",
        dependsOnSequences: [2],
        continuityNote: "C12 must obtain an accepted handoff frame before this segment runs.",
        narrativeBeatSequences: [3],
      },
    ],
    narrativeBeatCount: 3,
    generationSegmentCount: 3,
  },
});

test("C11 keeps story planning immutable, workspace-scoped, and free of execution side effects", async () => {
  const planningStore = store();
  const created = await planningStore.createCreativeBriefRevision(createBrief());
  assert.equal(created.kind, "NEW");
  assert.equal(created.status, 201);
  if (created.kind !== "NEW") return;
  assert.equal(created.value.status, "DRAFT");
  assert.equal(created.value.targetResolution, "480p");

  const replay = await planningStore.createCreativeBriefRevision(createBrief());
  assert.equal(replay.kind, "REPLAY");
  assert.equal(replay.status, 201);
  assert.equal(await planningStore.findCreativeBriefRevision("ws_other", "cbr_story_1"), undefined);

  const requested = await planningStore.requestCreativePlan({
    scope: "usr_dev_owner:/api/v1/creative-brief-revisions/cbr_story_1/plan",
    idempotencyKey: "idem_plan",
    requestHash: hash("idem_plan"),
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_story_1",
    event: event("planning"),
  });
  assert.equal(requested.kind, "NEW");
  if (requested.kind !== "NEW") return;
  assert.equal(requested.value.status, "PLANNING");

  const storyboard = await completePlan(planningStore);
  assert.ok(storyboard);
  assert.equal(storyboard.status, "READY_FOR_REVIEW");
  assert.equal(storyboard.narrativeBeatCount, 3);
  assert.equal(storyboard.generationSegmentCount, 3);
  assert.equal(storyboard.shotSpecs.length, 3);
  assert.deepEqual(storyboard.shotSpecs.map((shotSpec) => shotSpec.narrativeBeatSequences), [[1], [2], [3]]);
  assert.deepEqual(storyboard.shotSpecs.map((shotSpec) => shotSpec.dependsOnSequences), [[], [1], [2]]);
  const replayedPlan = await completePlan(planningStore, { scriptRevisionId: "scr_retry", storyboardRevisionId: "sbr_retry" });
  assert.equal(replayedPlan?.id, "sbr_story_1");

  const beforeApproval = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production_before_approval",
    requestHash: hash("idem_production_before_approval"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_0",
    storyboardRevisionId: "sbr_story_1",
    event: event("production_before_approval"),
  });
  assert.deepEqual(beforeApproval, { kind: "STATE_INVALID" });

  const approved = await planningStore.approveStoryboardRevision({
    scope: "usr_dev_owner:/api/v1/storyboard-revisions/sbr_story_1/approve",
    idempotencyKey: "idem_approve",
    requestHash: hash("idem_approve"),
    workspaceId: "ws_story",
    storyboardRevisionId: "sbr_story_1",
    event: event("approved"),
  });
  assert.equal(approved.kind, "NEW");
  if (approved.kind !== "NEW") return;
  assert.equal(approved.value.status, "APPROVED");

  const confirmed = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production",
    requestHash: hash("idem_production"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_1",
    storyboardRevisionId: "sbr_story_1",
    event: event("production"),
  });
  assert.equal(confirmed.kind, "NEW");
  if (confirmed.kind !== "NEW") return;
  assert.equal(confirmed.value.status, "CONFIRMED");
  assert.equal(confirmed.value.totalShotCount, 3);
  assert.equal(confirmed.value.acceptedShotCount, 0);
  assert.equal(confirmed.value.totalSegmentCount, 3);
  assert.equal(confirmed.value.acceptedSegmentCount, 0);
  assert.equal((await planningStore.listProjectProductionRuns("ws_story", "prj_story")).length, 1);

  // BLOCKED remains historical/retryable, but must not prevent a revised
  // immutable storyboard from starting a separate production run.
  const storedRuns = (planningStore as unknown as {
    productionRuns: Map<string, { status: string }>;
  }).productionRuns;
  const storedRun = storedRuns.get("prd_story_1");
  assert.ok(storedRun);
  storedRun.status = "BLOCKED";
  const revisedVersion = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production_revised_version",
    requestHash: hash("idem_production_revised_version"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_2",
    storyboardRevisionId: "sbr_story_1",
    event: event("production_revised_version"),
  });
  assert.equal(revisedVersion.kind, "NEW");
  if (revisedVersion.kind === "NEW") assert.equal(revisedVersion.value.id, "prd_story_2");
});

test("C11 rejects unconfirmed or cross-project source material before planning", async () => {
  const planningStore = store();
  const pending = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_pending"),
    creativeBriefRevisionId: "cbr_pending",
    sourceAssetIds: ["ast_pending"],
  });
  assert.deepEqual(pending, { kind: "INVALID_SOURCE" });

  const crossProject = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_other"),
    creativeBriefRevisionId: "cbr_other",
    sourceAssetIds: ["ast_other"],
  });
  assert.deepEqual(crossProject, { kind: "INVALID_SOURCE" });

  const derivedHandoff = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_handoff"),
    creativeBriefRevisionId: "cbr_handoff",
    sourceAssetIds: ["ast_handoff"],
  });
  assert.deepEqual(derivedHandoff, { kind: "INVALID_SOURCE" });

  const uploadedDocument = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_document"),
    creativeBriefRevisionId: "cbr_document",
    sourceAssetIds: ["ast_document"],
  });
  assert.deepEqual(uploadedDocument, { kind: "DOCUMENT_CONTEXT_INVALID" });
});


test("C11.1 freezes only successful document conversions for later planning", async () => {
  let resolvedMarkdownAssetId = "ast_markdown_v1";
  const planningStore = new InMemoryCreativePlanningStore({
    findAsset: async (_workspaceId, assetId) => sourceAssets.get(assetId),
  }, {
    resolveDocumentContexts: async () => [{
      documentId: "doc_story",
      conversionId: "dcv_story",
      sourceAssetId: "ast_document",
      markdownAssetId: resolvedMarkdownAssetId,
      markdownSha256: hash("a"),
      markdownObjectKey: "ws_story/prj_story/ast_markdown_v1/document.md",
      sequence: 1,
      maxContentCharacters: 5_000,
    }],
  });
  const created = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_document_success"),
    creativeBriefRevisionId: "cbr_document_success",
    sourceAssetIds: ["ast_document"],
  });
  assert.equal(created.kind, "NEW");
  if (created.kind !== "NEW") return;
  assert.deepEqual(created.value.documentContexts.map((context) => ({
    sourceAssetId: context.sourceAssetId,
    conversionId: context.conversionId,
    markdownAssetId: context.markdownAssetId,
    maxContentCharacters: context.maxContentCharacters,
  })), [{
    sourceAssetId: "ast_document",
    conversionId: "dcv_story",
    markdownAssetId: "ast_markdown_v1",
    maxContentCharacters: 5_000,
  }]);
  resolvedMarkdownAssetId = "ast_markdown_v2";
  const stored = await planningStore.findCreativeBriefRevision("ws_story", "cbr_document_success");
  assert.equal(stored?.documentContexts[0]?.markdownAssetId, "ast_markdown_v1");
});

test("C11.2 in-memory planning blocks document briefs until READY facts are available", async () => {
  const planningStore = new InMemoryCreativePlanningStore({
    findAsset: async (_workspaceId, assetId) => sourceAssets.get(assetId),
  }, {
    resolveDocumentContexts: async () => [{
      documentId: "doc_story",
      conversionId: "dcv_story",
      sourceAssetId: "ast_document",
      markdownAssetId: "ast_markdown_v1",
      markdownSha256: hash("a"),
      markdownObjectKey: "ws_story/prj_story/ast_markdown_v1/document.md",
      sequence: 1,
      maxContentCharacters: 5_000,
    }],
  }, {
    resolveFactContexts: async () => undefined,
  });
  const blocked = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_document_knowledge_gate"),
    creativeBriefRevisionId: "cbr_document_knowledge_gate",
    sourceAssetIds: ["ast_document"],
  });
  assert.deepEqual(blocked, { kind: "DOCUMENT_KNOWLEDGE_NOT_READY" });
});
