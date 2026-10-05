import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InternalCreativePlanningQueueMessageSchema } from "@alchemy-video/contracts";
import { canonicalJson } from "@alchemy-video/domain";
import {
  createSemanticNarrativeBeatLineage,
  normalizeLocation,
  normalizeName,
  semanticValueHash,
} from "../../creative-planning/src/semantic-director.js";

import { InMemoryCreativePlanningStore, type PromptPackageDraft } from "../src/creative-planning-repository.js";
import {
  freezeDoubaoAudioSourceIdentity,
  formalNarrationMatchesApprovedSample,
  matchesFrozenDoubaoAudioSourceIdentity,
} from "../src/approved-narration-timeline.js";

const hash = (suffix: string) => suffix.padEnd(64, "0").slice(0, 64);

test("frozen Doubao source identity binds run plan, timeline, section, asset version, bytes, and voice facts", () => {
  const approved = {
    timelinePlanId: "tlp_frozen",
    narrationScriptRevisionId: "nsr_frozen",
    sourceScriptHash: hash("script-source"),
    deliveryPlanRevisionId: "dpr_frozen",
    narrationSections: [{ sectionId: "sec_one", startMs: 0, endMs: 1_000, visualRole: "PRIMARY" as const, narrationAssetVersionId: "nav_frozen" }],
    narrationSegments: [],
    visualSegments: [],
    effectiveDurationMs: 1_000,
    narrationAsset: {
      assetVersionId: "nav_frozen",
      id: "ast_frozen",
      workspaceId: "ws_frozen",
      projectId: "prj_frozen",
      objectKey: "ws_frozen/prj_frozen/ast_frozen/audio.wav",
      sha256: hash("audio-sha"),
      byteSize: 10,
      mimeType: "audio/wav",
      durationMs: 900,
      provider: "doubao",
      voiceId: "voice_frozen",
      providerSettings: { speed: 1 },
    },
    narrationScriptText: "approved speech",
  };
  const frozen = freezeDoubaoAudioSourceIdentity({
    timeline: approved,
    workspaceId: "ws_frozen",
    projectId: "prj_frozen",
    storyboardRevisionId: "sbr_frozen",
  });
  assert.ok(frozen);
  assert.equal(frozen.timelinePlanId, "tlp_frozen");
  assert.equal(frozen.assetVersions[0]?.assetVersionId, "nav_frozen");
  assert.equal(frozen.assetVersions[0]?.assetId, "ast_frozen");
  assert.ok(matchesFrozenDoubaoAudioSourceIdentity(frozen, frozen));
  assert.equal(matchesFrozenDoubaoAudioSourceIdentity({ ...frozen, assetVersions: [{ ...frozen.assetVersions[0]!, sha256: hash("new-sha") }] }, frozen), false);
  assert.equal(matchesFrozenDoubaoAudioSourceIdentity({ ...frozen, timelinePlanId: "tlp_newer" }, frozen), false);
  assert.equal(matchesFrozenDoubaoAudioSourceIdentity({ ...frozen, assetVersions: [{ ...frozen.assetVersions[0]!, provider: "piper" }] }, frozen), false);
  assert.equal(matchesFrozenDoubaoAudioSourceIdentity({ ...frozen, assetVersions: [{ ...frozen.assetVersions[0]!, providerSettings: { speed: 1.1 } }] }, frozen), false);
  assert.equal(freezeDoubaoAudioSourceIdentity({
    timeline: { ...approved, narrationAsset: { ...approved.narrationAsset, provider: "piper" } },
    workspaceId: "ws_frozen",
    projectId: "prj_frozen",
    storyboardRevisionId: "sbr_frozen",
  }), undefined);
});

test("formal narration must preserve the approved sample's script hash, provider, voice, and settings", () => {
  const approved = {
    generation_kind: "SAMPLE",
    canonical_script_hash: hash("approved-script"),
    provider: "doubao",
    voice_id: "voice-approved",
    provider_settings: { resource_id: "seed-tts-2.0", format: "mp3" },
  };
  const formal = {
    sourceScriptHash: hash("approved-script"),
    sampleAssetId: "ast_sample",
    sampleGeneration: approved,
    formalAssetId: "ast_formal",
    formalProvider: "doubao",
    formalVoiceId: "voice-approved",
    formalProviderSettings: { resource_id: "seed-tts-2.0", format: "mp3" },
  };
  assert.equal(formalNarrationMatchesApprovedSample(formal), true);
  for (const drift of [
    { ...formal, sourceScriptHash: hash("different-script") },
    { ...formal, formalProvider: "piper" },
    { ...formal, formalVoiceId: "voice-other" },
    { ...formal, formalProviderSettings: { resource_id: "seed-tts-2.0", format: "ogg_opus" } },
    { ...formal, formalAssetId: "ast_sample" },
  ]) assert.equal(formalNarrationMatchesApprovedSample(drift), false);
});

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

test("provider duration policy reaches final storyboard validation", async () => {
  const planningStore = store();
  const brief = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_short_policy"),
    creativeBriefRevisionId: "cbr_short_policy",
    targetDurationSeconds: 6,
  });
  assert.equal(brief.kind, "NEW");
  const requested = await planningStore.requestCreativePlan({
    scope: "usr_dev_owner:/api/v1/creative-brief-revisions/cbr_short_policy/plan",
    idempotencyKey: "idem_short_policy_plan",
    requestHash: hash("idem_short_policy_plan"),
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_short_policy",
    event: event("short_policy_plan"),
  });
  assert.equal(requested.kind, "NEW");
  const storyboard = await planningStore.completeCreativePlan({
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_short_policy",
    event: event("short_policy_complete"),
    draft: {
      scriptRevisionId: "scr_short_policy",
      storyboardRevisionId: "sbr_short_policy",
      beats: [{ sequence: 1, title: "Short", summary: "One short shot.", narrative_goal: "One short shot.", visible_facts: ["shot"], generation_segment_sequence: 1 }],
      title: "Short policy",
      summary: "One exact short shot.",
      totalDurationSeconds: 6,
      durationPolicy: { minDurationSeconds: 1, maxDurationSeconds: 15 },
      continuityLevel: "STANDARD",
      continuityNote: "One shot.",
      shotSpecs: [{
        id: "ssp_short_policy",
        sequence: 1,
        title: "Short",
        durationSeconds: 6,
        narrativeGoal: "One short shot.",
        startState: "Start",
        endState: "End",
        transitionSummary: "None",
        referencePolicy: "TEXT_TRANSITION",
        dependsOnSequences: [],
        continuityNote: "One shot.",
        narrativeBeatSequences: [1],
      }],
      generationSegmentCount: 1,
    },
  });
  assert.ok(storyboard);
  assert.equal(storyboard.totalDurationSeconds, 6);
});

test("objective reference observations never become semantic object locks", async () => {
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
  assert.deepEqual(locks, []);
});

const completePlan = (
  planningStore: InMemoryCreativePlanningStore,
  ids = { scriptRevisionId: "scr_story_1", storyboardRevisionId: "sbr_story_1" },
  promptPackages?: PromptPackageDraft[],
  semanticVisualEntitySemantics?: {
    normalizeName: (name: string) => string;
    normalizeLocation: (location: string) => string;
    semanticValueHash: (value: unknown) => string;
  },
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
        sceneId: "cve_scene_factory",
        characterIds: ["cve_character_founder"],
        propIds: ["cve_prop_product"],
        referenceAnchors: ["@Founder", "@Factory"],
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
    ...(promptPackages ? { promptPackages } : {}),
  },
  ...(semanticVisualEntitySemantics ? { semanticVisualEntitySemantics } : {}),
});

test("G02 in-memory planning stages entity claims and mappings until every package binding passes", async () => {
  const planningStore = store();
  const sourceText = [
    "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。",
    "G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。",
    "G02_APPROVED_BEAT_3:女性使用产品并以包装特写收尾。",
  ].join("\n");
  const created = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_g02_atomicity"),
    sourceText,
    sourceAssetRoles: [{ assetId: "ast_ready", role: "SUBJECT", usage: "面霜罐产品参考图" }],
  });
  assert.equal(created.kind, "NEW");
  const requested = await planningStore.requestCreativePlan({
    scope: "usr_dev_owner:/api/v1/creative-brief-revisions/cbr_story_1/plan",
    idempotencyKey: "idem_g02_atomicity_plan",
    requestHash: hash("idem_g02_atomicity_plan"),
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_story_1",
    event: event("g02_atomicity_plan"),
  });
  assert.equal(requested.kind, "NEW");
  const candidates = [
    {
      candidate_key: "entity-jar",
      kind: "PROP" as const,
      exact_name: "面霜罐",
      source_evidence_refs: ["G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。"],
      reference_asset_ids: [],
      type: "护肤品容器",
      description: "面霜罐",
    },
    {
      candidate_key: "entity-scene",
      kind: "SCENE" as const,
      exact_name: "研发灌装环境",
      source_evidence_refs: ["G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。"],
      reference_asset_ids: [],
      location: "研发灌装环境",
      prompt: "研发灌装环境",
    },
  ];
  const packages: PromptPackageDraft[] = ["ssp_story_1", "ssp_story_2", "ssp_story_3"].map((shotSpecId, index) => ({
    id: `ppk_g02_atomic_${index + 1}`,
    shotSpecId,
    compilerVersion: "g02-test",
    prompt: "A source-bounded test prompt.",
    visualConstraints: {},
    referenceMap: {
      reference_policy: "REFERENCE_SET",
      semantic_reference_projection: {
        version: 1,
        source_hash: hash("g02-empty-source"),
        decision_hash: hash("g02-empty-decision"),
        segment_id: `seg_empty_${shotSpecId}`,
        references: [],
      },
    },
    capabilitySnapshot: { semantic_narrative_beat_lineage: { fixture: true } },
    semanticEntityCandidates: candidates,
  }));
  await assert.rejects(() => completePlan(planningStore, undefined, packages, {
    normalizeName: (name) => name.replace(/\s/gu, "").toLowerCase(),
    normalizeLocation: (location) => location.replace(/\s/gu, "").toLowerCase(),
    semanticValueHash: (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"),
  }), /at least one approved reference asset/u);
  const internal = planningStore as unknown as {
    visualEntityContexts: Map<string, unknown>;
    visualEntityMappings: Map<string, unknown>;
    promptPackages: Map<string, unknown>;
    scripts: Map<string, unknown>;
    storyboards: Map<string, unknown>;
  };
  assert.equal(internal.visualEntityContexts.size, 0);
  assert.equal(internal.visualEntityMappings.size, 0);
  assert.equal(internal.promptPackages.size, 0);
  assert.equal(internal.scripts.size, 0);
  assert.equal(internal.storyboards.size, 0);
  assert.equal((await planningStore.findCreativeBriefRevision("ws_story", "cbr_story_1"))?.status, "PLANNING");
});

test("InMemory planning selects G02 gates from locked Brief markers, not optional package fields", async () => {
  const planningStore = store();
  await planningStore.createCreativeBriefRevision(createBrief("idem_non_g02_private_fields"));
  await planningStore.requestCreativePlan({
    scope: "usr_dev_owner:/api/v1/creative-brief-revisions/cbr_story_1/plan",
    idempotencyKey: "idem_non_g02_private_fields_plan",
    requestHash: hash("idem_non_g02_private_fields_plan"),
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_story_1",
    event: event("non_g02_private_fields_plan"),
  });
  const packages: PromptPackageDraft[] = ["ssp_story_1", "ssp_story_2", "ssp_story_3"].map((shotSpecId, index) => ({
    id: `ppk_non_g02_semantic_${index + 1}`,
    shotSpecId,
    compilerVersion: "g02-negative-test",
    prompt: "No G02 source marker exists.",
    visualConstraints: {},
    referenceMap: {},
    capabilitySnapshot: { semantic_narrative_beat_lineage: { version: 1 } },
  }));
  await assert.rejects(
    () => completePlan(planningStore, undefined, packages),
    /without a locked Brief source marker/u,
  );
  assert.equal((await planningStore.findCreativeBriefRevision("ws_story", "cbr_story_1"))?.status, "PLANNING");
});

test("G02 reuses source-normalized entities, applies truthy fallback, and hashes the fixed array once", async () => {
  assert.equal(normalizeName("林小雨（主角）"), "林小雨");
  assert.equal(normalizeName("林小雨(女主)"), "林小雨");
  assert.equal(normalizeLocation("新加坡 工厂（A）"), "新加坡工厂（a）");
  assert.notEqual(normalizeLocation("火车站（候车厅）"), normalizeLocation("火车站（站台）"));

  const briefLines = [
    "G02_APPROVED_BEAT_1:面霜罐展示乳霜质地。",
    "G02_APPROVED_BEAT_2:面霜罐位于研发灌装环境。",
    "G02_APPROVED_BEAT_3:面霜罐与包装特写收尾。",
  ];
  const sourceText = briefLines.join("\n");
  const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const assetId = "ast_g02_hash_asset";
  const assetSha256 = createHash("sha256").update("g02-hash-asset", "utf8").digest("hex");
  const evidenceId = `evd_${"a".repeat(24)}`;
  const decisionHash = createHash("sha256").update("g02-hash-decision", "utf8").digest("hex");
  const assets = new Map([[assetId, {
    id: assetId,
    projectId: "prj_story",
    status: "READY",
    origin: "USER_UPLOAD",
    kind: "IMAGE",
    sha256: assetSha256,
    mimeType: "image/png",
  }]]);
  const planningStore = new InMemoryCreativePlanningStore({
    findAsset: async (_workspaceId, id) => assets.get(id),
  });
  const semantics = { normalizeName, normalizeLocation, semanticValueHash };

  const complete = async (
    suffix: string,
    candidateFields: { type?: string; description?: string; prompt?: string; lighting?: string },
    exactName = "面霜罐",
    kind: "PROP" | "SCENE" = "PROP",
    sceneTime?: string,
    promptAnchorName = exactName,
    bindingOverride?: NonNullable<PromptPackageDraft["semanticEntityCandidateBindings"]>,
    expectRejected = false,
  ) => {
    const usage = `${exactName}在三个节拍中作为${kind === "SCENE" ? "场景" : "产品实体"}参考。`;
    const briefRevisionId = `cbr_g02_hash_${suffix}`;
    const created = await planningStore.createCreativeBriefRevision({
      ...createBrief(`idem_g02_hash_${suffix}`),
      creativeBriefRevisionId: briefRevisionId,
      sourceText,
      targetDurationSeconds: 30,
      sourceAssetIds: [assetId],
      sourceAssetRoles: [{ assetId, role: kind === "SCENE" ? "SCENE" : "SUBJECT", usage }],
    });
    assert.equal(created.kind, "NEW");
    const requested = await planningStore.requestCreativePlan({
      scope: `usr_dev_owner:/api/v1/creative-brief-revisions/${briefRevisionId}/plan`,
      idempotencyKey: `idem_g02_hash_plan_${suffix}`,
      requestHash: hash(`g02_hash_plan_${suffix}`),
      workspaceId: "ws_story",
      creativeBriefRevisionId: briefRevisionId,
      event: event(`g02_hash_plan_${suffix}`),
    });
    assert.equal(requested.kind, "NEW");

    const lineage = createSemanticNarrativeBeatLineage({ briefRevisionId, sourceText });
    assert.ok(lineage);
    const candidate = {
      candidate_key: "entity-jar",
      kind,
      exact_name: exactName,
      source_evidence_refs: [briefLines[0]!, usage],
      reference_asset_ids: [assetId],
      ...(kind === "SCENE"
        ? { location: exactName, ...(sceneTime !== undefined ? { time: sceneTime } : {}), ...candidateFields }
        : candidateFields),
    };
    const promptPackages: PromptPackageDraft[] = briefLines.map((_line, index) => {
      const segmentId = `seg_g02_hash_${suffix}_${index + 1}`;
      const referenceProjection = {
        version: 1 as const,
        source_hash: sourceHash,
        decision_hash: decisionHash,
        segment_id: segmentId,
        references: [{ asset_id: assetId, provider_role: (kind === "SCENE" ? "SCENE" : "SUBJECT") as "SCENE" | "SUBJECT", usage, evidence_ids: [evidenceId] }],
      };
      const beatProjection = {
        version: 1 as const,
        brief_revision_id: briefRevisionId,
        source_hash: sourceHash,
        beat: lineage.beats[index]!,
      };
      return {
        id: `ppk_g02_hash_${suffix}_${index + 1}`,
        shotSpecId: `ssp_g02_hash_${suffix}_${index + 1}`,
        compilerVersion: "g02-hash-test",
        prompt: `@${promptAnchorName} 在第${index + 1}节拍展示。`,
        visualConstraints: {
          semantic_segment_id: segmentId,
          semantic_decision_hash: decisionHash,
          evidence_ids: [evidenceId],
        },
        referenceMap: { reference_policy: "REFERENCE_SET", semantic_reference_projection: referenceProjection },
        capabilitySnapshot: {
          semantic_dialogue_projection: { version: 1, source_hash: sourceHash, decision_hash: decisionHash, segment_id: segmentId, dialogues: [] },
          audio_owner: "NATIVE_PROVIDER",
          source_prompt: sourceText,
          generated_prompt_parts: [`@${promptAnchorName} 在第${index + 1}节拍展示。`],
          evidence_ids: [evidenceId],
          max_duration_seconds: 15,
          max_reference_images: 7,
          semantic_narrative_beat_lineage: beatProjection,
          semantic_narrative_beat_lineage_hash: semanticValueHash(beatProjection),
        },
        semanticEntityCandidates: [candidate],
        semanticEntityCandidateBindings: bindingOverride ?? (kind === "SCENE"
          ? { scene: candidate.candidate_key, characters: [], props: [] }
          : { characters: [], props: [candidate.candidate_key] }),
        semanticReferenceSourceAssets: [{ assetId, assetSha256, usage, evidenceId }],
      };
    });
    const completeRequest = () => planningStore.completeCreativePlan({
      workspaceId: "ws_story",
      creativeBriefRevisionId: briefRevisionId,
      event: event(`g02_hash_ready_${suffix}`),
      semanticVisualEntitySemantics: semantics,
      draft: {
        scriptRevisionId: `scr_g02_hash_${suffix}`,
        storyboardRevisionId: `sbr_g02_hash_${suffix}`,
        beats: briefLines.map((line, index) => ({ sequence: index + 1, title: `Beat ${index + 1}`, summary: line, narrative_goal: line, visible_facts: ["面霜罐"] })),
        title: "G02 hash behavior",
        summary: "Exercise source-normalized immutable entity revisions.",
        totalDurationSeconds: 30,
        continuityLevel: "STANDARD",
        continuityNote: "Three source-aligned segments.",
        shotSpecs: briefLines.map((_line, index) => ({
          id: `ssp_g02_hash_${suffix}_${index + 1}`,
          sequence: index + 1,
          title: `Beat ${index + 1}`,
          durationSeconds: 10,
          narrativeGoal: `Beat ${index + 1}`,
          startState: "Start",
          endState: "End",
          transitionSummary: "Continue.",
          referencePolicy: "REFERENCE_SET",
          dependsOnSequences: index === 0 ? [] : [index],
          continuityNote: "Keep the source entity consistent.",
          narrativeBeatSequences: [index + 1],
        })),
        narrativeBeatCount: 3,
        generationSegmentCount: 3,
        promptPackages,
      },
    });
    if (expectRejected) {
      const internalBefore = planningStore as unknown as {
        visualEntityContexts: Map<string, unknown>;
        visualEntityMappings: Map<string, unknown>;
        promptPackages: Map<string, unknown>;
        scripts: Map<string, unknown>;
        storyboards: Map<string, unknown>;
      };
      const countsBefore = {
        visualEntityContexts: internalBefore.visualEntityContexts.size,
        visualEntityMappings: internalBefore.visualEntityMappings.size,
        promptPackages: internalBefore.promptPackages.size,
        scripts: internalBefore.scripts.size,
        storyboards: internalBefore.storyboards.size,
      };
      await assert.rejects(completeRequest, /scene binding must resolve to a SCENE candidate/u);
      const internalAfter = planningStore as unknown as typeof internalBefore;
      assert.deepEqual({
        visualEntityContexts: internalAfter.visualEntityContexts.size,
        visualEntityMappings: internalAfter.visualEntityMappings.size,
        promptPackages: internalAfter.promptPackages.size,
        scripts: internalAfter.scripts.size,
        storyboards: internalAfter.storyboards.size,
      }, countsBefore);
      assert.equal((await planningStore.findCreativeBriefRevision("ws_story", briefRevisionId))?.status, "PLANNING");
      return undefined;
    }
    const storyboard = await completeRequest();
    assert.ok(storyboard);
    const normalizedIdentity = kind === "SCENE"
      ? JSON.stringify([normalizeLocation(exactName), sceneTime || ""])
      : normalizeName(exactName);
    return (await planningStore.resolveCanonicalVisualEntityContext("ws_story", "prj_story"))
      .find((entity) => entity.entity_kind === kind && entity.normalized_identity === normalizedIdentity);
  };

  const original = await complete("original", { type: "护肤品容器", description: "柔润乳霜" });
  assert.ok(original);
  await complete("wrong_scene_kind", { type: "护肤品容器", description: "错绑场景" }, "错误场景绑定", "PROP", undefined, "错误场景绑定", {
    scene: "entity-jar",
    characters: [],
    props: [],
  }, true);
  const fixedFields = ["PROP", "护肤品容器", "柔润乳霜"];
  const expectedHash = semanticValueHash(fixedFields);
  assert.equal(original.content_hash, expectedHash);
  assert.notEqual(expectedHash, semanticValueHash(canonicalJson(fixedFields)));

  const sameHash = await complete("same", {});
  assert.equal(sameHash?.entity_id, original.entity_id);
  assert.equal(sameHash?.revision_id, original.revision_id);
  assert.equal(sameHash?.revision_number, 1);
  assert.equal(sameHash?.content_hash, expectedHash);

  const normalizedAlias = await complete("normalized_alias", {}, "面霜罐（主角）", "PROP", undefined, "面霜罐");
  assert.equal(normalizedAlias?.entity_id, original.entity_id);
  assert.equal(normalizedAlias?.revision_id, original.revision_id);
  assert.equal(normalizedAlias?.exact_name, "面霜罐", "a source-normalized alias keeps the original canonical name");

  const changed = await complete("changed", { description: "更丰富的乳霜质地" });
  assert.equal(changed?.entity_id, original.entity_id);
  assert.equal(changed?.revision_number, 2);
  assert.equal(changed?.content_hash, semanticValueHash(["PROP", "护肤品容器", "更丰富的乳霜质地"]));
  assert.notEqual(changed?.content_hash, expectedHash);

  const reverted = await complete("reverted", { type: "护肤品容器", description: "柔润乳霜" });
  assert.equal(reverted?.entity_id, original.entity_id);
  assert.equal(reverted?.revision_id, changed?.revision_id, "the current entity context stays at the latest appended revision");
  assert.equal(reverted?.revision_number, 2, "reusing an earlier hash must not append a duplicate revision");
  assert.equal(reverted?.content_hash, changed?.content_hash);

  const promptPackages = (planningStore as unknown as { promptPackages: Map<string, PromptPackageDraft> }).promptPackages;
  const originalPackage = promptPackages.get("ppk_g02_hash_original_1");
  const revertedPackage = promptPackages.get("ppk_g02_hash_reverted_1");
  assert.ok(originalPackage && revertedPackage);
  const bindingFor = (promptPackage: PromptPackageDraft) => {
    const projection = promptPackage.referenceMap.semantic_entity_reference_projection as {
      bindings: Array<{ entity_id: string; entity_revision_id: string; exact_name: string }>;
    };
    return projection.bindings[0];
  };
  const originalBinding = bindingFor(originalPackage!);
  const revertedBinding = bindingFor(revertedPackage!);
  assert.equal(revertedBinding?.entity_id, originalBinding?.entity_id);
  assert.equal(revertedBinding?.entity_revision_id, original.revision_id,
    "A→B→A must bind the exact original A revision, as Drizzle does");
  assert.equal(revertedBinding?.exact_name, original.exact_name);

  const historyKey = `ws_story\u0000prj_story\u0000PROP\u0000${normalizeName("面霜罐")}`;
  const revisionHistory = (planningStore as unknown as {
    visualEntityRevisionHistory: Map<string, Array<{ revision_id: string; revision_number: number; content_hash: string; exact_name: string; type?: string; description?: string }>>;
  }).visualEntityRevisionHistory.get(historyKey);
  assert.deepEqual(revisionHistory?.map(({ revision_id, revision_number, content_hash, exact_name, type, description }) => ({
    revision_id,
    revision_number,
    content_hash,
    exact_name,
    type,
    description,
  })), [
    { revision_id: original.revision_id, revision_number: 1, content_hash: expectedHash, exact_name: original.exact_name, type: "护肤品容器", description: "柔润乳霜" },
    { revision_id: changed?.revision_id, revision_number: 2, content_hash: changed?.content_hash, exact_name: original.exact_name, type: "护肤品容器", description: "更丰富的乳霜质地" },
  ]);

  const sceneOriginal = await complete("scene_original", { prompt: "明亮的研发空间", lighting: "柔和自然光" }, "研发灌装环境", "SCENE", "白天");
  assert.ok(sceneOriginal);
  const sceneAlias = await complete("scene_alias", { prompt: "研发空间中保持明亮", lighting: "柔和自然光" }, "研发 灌装环境", "SCENE", "白天", "研发灌装环境");
  assert.equal(sceneAlias?.entity_id, sceneOriginal.entity_id, "scene whitespace aliases reuse the exact source-normalized location identity");
  assert.equal(sceneAlias?.exact_name, "研发灌装环境");
  assert.equal(sceneAlias?.location, "研发灌装环境");
  assert.equal(sceneAlias?.time, "白天");
  assert.equal(sceneAlias?.prompt, "研发空间中保持明亮", "a truthy candidate prompt updates the existing scene prompt");
  assert.equal(sceneAlias?.lighting, "柔和自然光");
  const sceneEmptyFields = await complete("scene_empty_fields", {}, "研发 灌装环境", "SCENE", "白天", "研发灌装环境");
  assert.equal(sceneEmptyFields?.entity_id, sceneAlias?.entity_id);
  assert.equal(sceneEmptyFields?.revision_id, sceneAlias?.revision_id, "omitted optional prompt and lighting preserve the current content revision through source truthy fallback");
  assert.equal(sceneEmptyFields?.prompt, "研发空间中保持明亮");
  assert.equal(sceneEmptyFields?.lighting, "柔和自然光");
  const sceneCaseOriginal = await complete("scene_case_original", { prompt: "North Factory in daylight", lighting: "soft light" }, "North Factory", "SCENE", "白天");
  const sceneCaseWhitespaceAlias = await complete("scene_case_whitespace_alias", { prompt: "North Factory with open space", lighting: "soft light" }, "north  factory", "SCENE", "白天", "North Factory");
  assert.equal(sceneCaseWhitespaceAlias?.entity_id, sceneCaseOriginal?.entity_id, "scene location matching preserves source whitespace and case normalization");
  assert.equal(sceneCaseWhitespaceAlias?.exact_name, "North Factory");
  assert.equal(sceneCaseWhitespaceAlias?.location, "North Factory");
  assert.equal(sceneCaseWhitespaceAlias?.time, "白天");
  const sceneBracketVariant = await complete("scene_bracket_variant", { prompt: "车站候车厅", lighting: "柔和自然光" }, "车站（候车厅）", "SCENE", "白天");
  const sceneBracketDifferent = await complete("scene_bracket_different", { prompt: "车站站台", lighting: "柔和自然光" }, "车站（站台）", "SCENE", "白天");
  assert.notEqual(sceneBracketVariant?.entity_id, sceneBracketDifferent?.entity_id, "scene parentheses remain identity-significant");
  const sceneDifferentTime = await complete("scene_different_time", { prompt: "夜间研发空间", lighting: "夜间照明" }, "研发 灌装环境", "SCENE", "夜间");
  assert.notEqual(sceneOriginal.entity_id, sceneDifferentTime?.entity_id, "different exact scene times do not merge");
});

test("InMemory planning exposes persisted storyboard music intent hints in shot order", async () => {
  const planningStore = store();
  const created = await planningStore.createCreativeBriefRevision(createBrief("idem_music_hints"));
  assert.equal(created.kind, "NEW");
  const requested = await planningStore.requestCreativePlan({
    scope: "usr_dev_owner:/api/v1/creative-brief-revisions/cbr_story_1/plan",
    idempotencyKey: "idem_music_hints_plan",
    requestHash: hash("idem_music_hints_plan"),
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_story_1",
    event: event("music_hints_plan"),
  });
  assert.equal(requested.kind, "NEW");
  await completePlan(planningStore, undefined, [
    {
      id: "pp_story_1",
      shotSpecId: "ssp_story_1",
      compilerVersion: "fixture",
      prompt: "shot 1",
      visualConstraints: {},
      referenceMap: {},
      capabilitySnapshot: { bgm_prompt: "ambient beauty" },
    },
    {
      id: "pp_story_2",
      shotSpecId: "ssp_story_2",
      compilerVersion: "fixture",
      prompt: "shot 2",
      visualConstraints: {},
      referenceMap: {},
      capabilitySnapshot: { bgm_prompt: "warm piano" },
    },
    {
      id: "pp_story_3",
      shotSpecId: "ssp_story_3",
      compilerVersion: "fixture",
      prompt: "shot 3",
      visualConstraints: {},
      referenceMap: {},
      capabilitySnapshot: {},
    },
  ]);
  assert.deepEqual(
    await planningStore.listStoryboardMusicIntentHints?.("ws_story", "sbr_story_1"),
    ["ambient beauty", "warm piano"],
  );
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
  assert.equal(storyboard.shotSpecs[0]?.sceneId, "cve_scene_factory");
  assert.deepEqual(storyboard.shotSpecs[0]?.characterIds, ["cve_character_founder"]);
  assert.deepEqual(storyboard.shotSpecs[0]?.propIds, ["cve_prop_product"]);
  assert.deepEqual(storyboard.shotSpecs[0]?.referenceAnchors, ["@Founder", "@Factory"]);
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

  const unverifiedDoubao = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production_doubao_without_transactional_timeline",
    requestHash: hash("idem_production_doubao_without_transactional_timeline"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_doubao_blocked",
    storyboardRevisionId: "sbr_story_1",
    audioSelection: "DOUBAO_TTS_REPLACE",
    event: event("production_doubao_blocked"),
  });
  assert.deepEqual(unverifiedDoubao, { kind: "PREFLIGHT_BLOCKED" });
  const unverifiedMusicReplacement = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production_music_without_transactional_asset_identity",
    requestHash: hash("idem_production_music_without_transactional_asset_identity"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_music_blocked",
    storyboardRevisionId: "sbr_story_1",
    audioSelection: "MUSIC_REPLACE_PROVIDER_AUDIO",
    musicPlan: { mode: "MANUAL", asset_id: "ast_unverified_music", style_hint: "" },
    event: event("production_music_blocked"),
  });
  assert.deepEqual(unverifiedMusicReplacement, { kind: "PREFLIGHT_BLOCKED" });
  assert.equal((await planningStore.listProjectProductionRuns("ws_story", "prj_story")).length, 0);

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
  const replayedProduction = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production",
    requestHash: hash("idem_production"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_1",
    storyboardRevisionId: "sbr_story_1",
    event: event("production"),
  });
  assert.equal(replayedProduction.kind, "REPLAY");
  const changedSelection = await planningStore.createProductionRun({
    scope: "usr_dev_owner:/api/v1/production-runs",
    idempotencyKey: "idem_production",
    requestHash: hash("idem_production_with_doubao_selection"),
    workspaceId: "ws_story",
    projectId: "prj_story",
    productionRunId: "prd_story_1",
    storyboardRevisionId: "sbr_story_1",
    audioSelection: "DOUBAO_TTS_REPLACE",
    event: event("production"),
  });
  assert.deepEqual(changedSelection, { kind: "CONFLICT" });
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

test("canonical reference resolution preserves every selected image or fails closed", async () => {
  const imageIds = Array.from({ length: 8 }, (_, index) => `ast_image_${index + 1}`);
  const assets = new Map<string, {
    id: string;
    projectId: string;
    status: "READY";
    origin: "USER_UPLOAD" | "DERIVED";
    kind: "IMAGE" | "DOCUMENT";
    sha256?: string;
    mimeType?: string;
  }>();
  assets.set("ast_document_canonical", {
    id: "ast_document_canonical", projectId: "prj_story", status: "READY",
    origin: "USER_UPLOAD", kind: "DOCUMENT",
  });
  imageIds.forEach((id, index) => assets.set(id, {
    id, projectId: "prj_story", status: "READY", origin: "USER_UPLOAD",
    kind: "IMAGE", sha256: String(index + 1).repeat(64), mimeType: "image/png",
  }));
  assets.set("ast_derived_canonical", {
    id: "ast_derived_canonical", projectId: "prj_story", status: "READY",
    origin: "DERIVED", kind: "IMAGE", sha256: "a".repeat(64), mimeType: "image/png",
  });
  const planningStore = new InMemoryCreativePlanningStore({
    findAsset: async (_workspaceId, assetId) => assets.get(assetId),
  });
  const valid = await planningStore.resolveCanonicalReferenceSources(
    "ws_story",
    "prj_story",
    ["ast_document_canonical", imageIds[0]!, imageIds[1]!],
    [{ assetId: imageIds[0]!, role: "SUBJECT", usage: "The cream jar shown in the first beat." }],
  );
  assert.deepEqual(valid?.map((item) => ({
    asset_id: item.asset_id,
    position: item.position,
    user_declared_usage: item.user_declared_usage,
  })), [
    { asset_id: imageIds[0], position: 0, user_declared_usage: "The cream jar shown in the first beat." },
    { asset_id: imageIds[1], position: 1, user_declared_usage: undefined },
  ]);
  assert.equal(await planningStore.resolveCanonicalReferenceSources(
    "ws_story", "prj_story", [imageIds[0]!, "ast_missing"],
  ), undefined);
  assert.equal(await planningStore.resolveCanonicalReferenceSources(
    "ws_story", "prj_story", ["ast_derived_canonical"],
  ), undefined);
  assert.equal(await planningStore.resolveCanonicalReferenceSources(
    "ws_story", "prj_story", imageIds,
  ), undefined);
});

test("in-memory planning lease can be reclaimed after a retryable release", async () => {
  const planningStore = store();
  const created = await planningStore.createCreativeBriefRevision({
    ...createBrief("idem_retryable_lease"),
    creativeBriefRevisionId: "cbr_retryable_lease",
  });
  assert.equal(created.kind, "NEW");
  const requested = await planningStore.requestCreativePlan({
    scope: "usr_dev_owner:/api/v1/creative-brief-revisions/cbr_retryable_lease/plan",
    idempotencyKey: "idem_retryable_lease_plan",
    requestHash: hash("idem_retryable_lease_plan"),
    workspaceId: "ws_story",
    creativeBriefRevisionId: "cbr_retryable_lease",
    event: event("retryable_lease"),
  });
  assert.equal(requested.kind, "NEW");
  const message = InternalCreativePlanningQueueMessageSchema.parse({
    contract_version: "1.0",
    event_id: "evt_retryable_lease",
    workspace_id: "ws_story",
    project_id: "prj_story",
    creative_brief_revision_id: "cbr_retryable_lease",
    correlation_id: "cor_retryable_lease",
  });
  const first = await planningStore.claimCreativePlanningEvent({
    message, consumerName: "planning-consumer", workerId: "worker-one",
    now: new Date(0), leaseMs: 1_000,
  });
  assert.equal(first.kind, "CLAIMED");
  await planningStore.releaseCreativePlanningEvent({
    eventId: message.event_id,
    workspaceId: message.workspace_id,
    consumerName: "planning-consumer",
    workerId: "worker-one",
    reason: "DIRECTOR_TIMEOUT",
    deadLetter: false,
    now: new Date(1),
  });
  const reclaimed = await planningStore.claimCreativePlanningEvent({
    message, consumerName: "planning-consumer", workerId: "worker-two",
    now: new Date(2), leaseMs: 1_000,
  });
  assert.equal(reclaimed.kind, "CLAIMED");
  await planningStore.releaseCreativePlanningEvent({
    eventId: message.event_id,
    workspaceId: message.workspace_id,
    consumerName: "planning-consumer",
    workerId: "worker-two",
    reason: "DIRECTOR_TIMEOUT",
    deadLetter: false,
    now: new Date(3),
  });
  await planningStore.releaseCreativePlanningEvent({
    eventId: message.event_id,
    workspaceId: message.workspace_id,
    consumerName: "planning-consumer",
    workerId: "worker-two",
    reason: "DIRECTOR_CONTENT_FORMAT_INVALID",
    deadLetter: true,
    now: new Date(4),
  });
  const terminalDuplicate = await planningStore.claimCreativePlanningEvent({
    message, consumerName: "planning-consumer", workerId: "worker-three",
    now: new Date(5), leaseMs: 1_000,
  });
  assert.equal(terminalDuplicate.kind, "DUPLICATE");
});
