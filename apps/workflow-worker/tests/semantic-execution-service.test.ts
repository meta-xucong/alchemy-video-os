import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { normalizeLocation, semanticValueHash } from "@alchemy-video/creative-planning/semantic-director";
import {
  hasExactEntityNameMention,
  semanticPromptPackageIntegrityPayload,
  type SemanticDialogueProjection,
  type SemanticDirectorDecision,
  type SemanticReferenceProjection,
} from "@alchemy-video/contracts";
import type { ControlCreativeBriefRevision, CreativePlanningDraft } from "@alchemy-video/persistence";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import {
  createDatabase,
  DrizzleAssetWorkspaceRepository,
  DrizzleControlPlaneRepository,
  DrizzleCreativePlanningRepository,
  DrizzleProductionRepository,
  DrizzleTaskRunRepository,
} from "@alchemy-video/persistence";
import { createMockMp4Fixture, MockVideoProvider, resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";
import { createInMemoryStoragePort } from "@alchemy-video/storage-client";
import { MockVideoTaskExecutor } from "../../task-worker/src/execution-service.js";
import { createTaskRunQueueMessage, TaskRunEventConsumer } from "../../task-worker/src/service.js";
import {
  assets,
  canonicalVisualEntities,
  canonicalVisualEntityRevisions,
  canonicalVisualEntityRevisionAssets,
  promptPackages,
  storyboardShotSpecs,
} from "../../../packages/persistence/src/schema.js";

import { SemanticPlanningExecutionError } from "../src/creative-planning-failure.js";
import { SemanticDirectorCanonicalizationError } from "../src/semantic-director-canonicalizer.js";
import { SemanticCreativePlanningExecutor } from "../src/semantic-execution-service.js";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("CI must provide isolated PostgreSQL for the G02 planner-to-Worker integration test.");
}

const sourceText = "她走进旧式站台，说：“我回来了。”";
const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
const canonicalSegmentId = `seg_${createHash("sha256").update("segment-1", "utf8").digest("hex").slice(0, 24)}`;
const dialogueText = "我回来了。";
const dialogueStart = sourceText.indexOf(dialogueText);
const reference = {
  asset_id: "ast_reference_001",
  asset_sha256: "a".repeat(64),
  mime_type: "image/png" as const,
  position: 0,
  provider_role: "SCENE" as const,
  user_declared_usage: "仅作为旧式站台的场景锚点。",
  objective_description: "可见旧式站台、砖墙和暖色吊灯。",
};
const canonicalReferenceEvidenceId = `evd_${createHash("sha256").update(`REFERENCE_ASSET:${JSON.stringify(reference.asset_id)}`, "utf8").digest("hex").slice(0, 24)}`;

const brief: ControlCreativeBriefRevision = {
  id: "cbr_semantic_001",
  workspaceId: "ws_semantic",
  projectId: "prj_semantic",
  revision: 1,
  sourceText,
  targetDurationSeconds: 8,
  targetResolution: "720p",
  stylePreferences: "自然、克制。",
  sourceAssetIds: [reference.asset_id],
  documentContexts: [],
  factContexts: [],
  status: "PLANNING",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const decisionFor = (sourceHash: string): SemanticDirectorDecision => ({
  version: 1,
  source_hash: sourceHash,
  target_duration_seconds: 8,
  execution_status: "READY",
  dialogues: [{
    dialogue_id: "dlg_return_001",
    exact_text: dialogueText,
    evidence: {
      evidence_id: "evd_dialogue_001",
      kind: "SOURCE_TEXT",
      source_hash: sourceHash,
      span: { start: dialogueStart, end: dialogueStart + dialogueText.length, quote: dialogueText },
    },
  }],
  reference_usages: [{
    asset_id: reference.asset_id,
    provider_role: "SCENE",
    usage: "仅作为旧式站台的场景锚点。",
    evidence_refs: [{
      evidence_id: "evd_reference_001",
      kind: "REFERENCE_ASSET",
      asset_id: reference.asset_id,
      asset_sha256: reference.asset_sha256,
      observation: reference.objective_description,
    }],
  }],
  segments: [{
    segment_id: "seg_station_001",
    sequence: 1,
    duration_seconds: 8,
    visual_decision: "人物走入旧式站台，在暖色吊灯下停住；使用一个有动机的缓慢跟随镜头，终点为人物稳定站定。",
    evidence_refs: [
      {
        evidence_id: "evd_source_001",
        kind: "SOURCE_TEXT",
        source_hash: sourceHash,
        span: { start: 0, end: sourceText.length, quote: sourceText },
      },
      {
        evidence_id: "evd_target_resolution_001",
        kind: "USER_DECISION",
        decision_id: "dec_target_resolution",
        field: "target_resolution",
        value_hash: semanticValueHash(brief.targetResolution),
      },
      {
        evidence_id: "evd_style_preferences_001",
        kind: "USER_DECISION",
        decision_id: "dec_style_preferences",
        field: "style_preferences",
        value_hash: semanticValueHash(brief.stylePreferences),
      },
    ],
    dialogue_ids: ["dlg_return_001"],
    reference_asset_ids: [reference.asset_id],
  }],
  unresolved_items: [],
});

const rawPlanFor = (input: SemanticDirectorDecision) => ({
  execution_status: input.execution_status,
  segments: input.segments.map((segment, index) => ({
    segment_id: `segment-${index + 1}`,
    duration_seconds: segment.duration_seconds,
    visual_prompt: segment.visual_decision,
    dialogue_line_ids: segment.dialogue_ids.map((_, dialogueIndex) => `line-${dialogueIndex + 1}`),
    reference_asset_ids: segment.reference_asset_ids,
  })),
  unresolved_items: input.unresolved_items.map((item) => item.question),
});

test("real semantic executor persists exact dialogue, canonical references, and no legacy motion facts", async () => {
  let captured: CreativePlanningDraft | undefined;
  const director = {
    async decide(bundle) {
      assert.deepEqual(
        bundle.user_decisions.map((item) => ({ id: item.decision_id, field: item.field, value: item.value })),
        [
          { id: "dec_target_resolution", field: "target_resolution", value: brief.targetResolution },
          { id: "dec_style_preferences", field: "style_preferences", value: brief.stylePreferences },
        ],
      );
      return rawPlanFor(decisionFor(bundle.source_hash));
    },
  };
  const profile = {
    ...resolveVideoProviderRuntimeProfile("sub2api"),
    minDurationSeconds: 4,
    maxDurationSeconds: 12,
    maxReferenceImages: 1,
  };
  const executor = new SemanticCreativePlanningExecutor({
    async resolveCanonicalReferenceSources() { return [reference]; },
    async completeCreativePlan(input) {
      captured = input.draft;
      return { id: input.draft.storyboardRevisionId } as never;
    },
  }, director, profile, undefined, ((prefix) => `${prefix}_semantic_001`) as never);

  const result = await executor.execute({
    brief,
    event: { eventId: "evt_semantic", messageId: "msg_semantic", traceId: "trc_semantic", correlationId: "cor_semantic" },
  });
  assert.ok(result);
  assert.ok(captured);
  assert.equal(captured!.shotSpecs.length, 1);
  assert.deepEqual(captured!.durationPolicy, { minDurationSeconds: 4, maxDurationSeconds: 12 });
  assert.equal(captured!.shotSpecs[0]!.startState, undefined);
  assert.equal(captured!.shotSpecs[0]!.endState, undefined);
  assert.equal(captured!.shotSpecs[0]!.transitionSummary, undefined);
  assert.deepEqual(captured!.shotSpecs[0]!.dependsOnSequences, []);
  const promptPackage = captured!.promptPackages?.[0];
  assert.ok(promptPackage);
  assert.match(promptPackage!.prompt, /Character says: "我回来了。"/);
  assert.match(promptPackage!.prompt, /Reference images \(input order\): image 1 = SCENE/);
  assert.ok(promptPackage!.prompt.includes(reference.user_declared_usage));
  assert.equal(promptPackage!.prompt.includes(reference.asset_id), false);
  assert.doesNotMatch(promptPackage!.prompt, /PLATFORM_OWNED_|__MOCK_UNSPECIFIED_|Motion timeline|PROP CONTINUITY CONTRACT/);
  assert.equal(Object.hasOwn(promptPackage!.capabilitySnapshot, "motion_plan"), false);
  assert.equal(promptPackage!.capabilitySnapshot.prompt_source_kind, "SEMANTIC_VISUAL_PROJECTION");
  assert.equal(promptPackage!.capabilitySnapshot.authored_source_hash, sourceHash);
  assert.equal(promptPackage!.capabilitySnapshot.source_prompt, decisionFor(sourceHash).segments[0]!.visual_decision);
  assert.notEqual(promptPackage!.capabilitySnapshot.source_prompt, sourceText);
  const capabilitySnapshot = promptPackage!.capabilitySnapshot;
  const dialogueProjection = capabilitySnapshot.semantic_dialogue_projection as SemanticDialogueProjection;
  assert.deepEqual(
    dialogueProjection.dialogues.map((item) => item.exact_text),
    [dialogueText],
  );
  const referenceProjection = promptPackage!.referenceMap.semantic_reference_projection as SemanticReferenceProjection;
  assert.equal(referenceProjection.segment_id, canonicalSegmentId);
  assert.equal(referenceProjection.decision_hash, capabilitySnapshot.semantic_decision_hash);
  assert.deepEqual(
    referenceProjection.references,
    [{ asset_id: reference.asset_id, provider_role: "SCENE", usage: reference.user_declared_usage, evidence_ids: [canonicalReferenceEvidenceId] }],
  );
  assert.equal(capabilitySnapshot.max_duration_seconds, 12);
  assert.equal(capabilitySnapshot.max_reference_images, 1);
  assert.equal(capabilitySnapshot.semantic_dialogue_projection_hash, semanticValueHash(dialogueProjection));
  assert.equal(capabilitySnapshot.semantic_reference_projection_hash, semanticValueHash(referenceProjection));
  assert.equal(
    capabilitySnapshot.semantic_prompt_package_integrity_hash,
    semanticValueHash(semanticPromptPackageIntegrityPayload({
      shotSpecId: promptPackage!.shotSpecId,
      prompt: promptPackage!.prompt,
      referencePolicy: promptPackage!.referenceMap.reference_policy as string,
      sourcePrompt: capabilitySnapshot.source_prompt as string,
      generatedPromptParts: capabilitySnapshot.generated_prompt_parts as string[],
      evidenceIds: promptPackage!.visualConstraints.evidence_ids as string[],
      dialogueProjection,
      referenceProjection,
      audioOwner: capabilitySnapshot.audio_owner as "NATIVE_PROVIDER",
      maxDurationSeconds: capabilitySnapshot.max_duration_seconds as number,
      maxReferenceImages: capabilitySnapshot.max_reference_images as number,
    })),
  );
});

test("real semantic executor blocks when a source asset cannot be resolved canonically", async () => {
  const director = { async decide(bundle) { return rawPlanFor(decisionFor(bundle.source_hash)); } };
  const executor = new SemanticCreativePlanningExecutor({
    async resolveCanonicalReferenceSources() { return undefined; },
    async completeCreativePlan() { throw new Error("must not persist"); },
  }, director, resolveVideoProviderRuntimeProfile("sub2api"));
  await assert.rejects(
    () => executor.execute({ brief, event: { eventId: "evt", messageId: "msg", traceId: "trc", correlationId: "cor" } }),
    (error) => error instanceof SemanticPlanningExecutionError
      && error.code === "CANONICAL_REFERENCE_FACTS_INVALID",
  );
});

test("G02 alias-only frozen usage cannot persist a mapping to an existing canonical identity", async () => {
  const beatQuotes = [
    "G02_APPROVED_BEAT_1:面霜罐展示乳霜。",
    "G02_APPROVED_BEAT_2:North Factory内的窗外天际线。",
    "G02_APPROVED_BEAT_3:外包装盒作为结尾特写。",
  ];
  const usages = [
    "面霜罐的产品参考图，展示罐身。",
    "north  factory场景参考图，用于第二节拍。",
    "外包装盒的参考图，用于结尾特写。",
  ];
  const assetIds = ["ast_g02_alias_jar", "ast_g02_alias_scene", "ast_g02_alias_box"];
  const sourceReferences = assetIds.map((assetId, position) => ({
    asset_id: assetId,
    asset_sha256: String(position + 1).repeat(64),
    mime_type: "image/png" as const,
    position,
    provider_role: position === 1 ? "SCENE" as const : "SUBJECT" as const,
    user_declared_usage: usages[position],
  }));
  const g02Brief: ControlCreativeBriefRevision = {
    ...brief,
    id: "cbr_semantic_g02_alias",
    sourceText: beatQuotes.join("\n"),
    targetDurationSeconds: 30,
    sourceAssetIds: assetIds,
    sourceAssetRoles: assetIds.map((assetId, index) => ({
      assetId,
      role: index === 1 ? "SCENE" as const : "SUBJECT" as const,
      usage: usages[index],
    })),
  };
  const candidates = [
    {
      candidate_key: "entity-jar",
      kind: "PROP",
      exact_name: "面霜罐",
      source_evidence_refs: [beatQuotes[0], usages[0]],
      reference_asset_ids: [assetIds[0]],
      type: "护肤品容器",
    },
    {
      candidate_key: "entity-scene",
      kind: "SCENE",
      exact_name: "north  factory",
      source_evidence_refs: [beatQuotes[1], usages[1]],
      reference_asset_ids: [assetIds[1]],
      location: "north  factory",
      time: "day",
      prompt: "A single exterior-facing factory scene.",
    },
    {
      candidate_key: "entity-box",
      kind: "PROP",
      exact_name: "外包装盒",
      source_evidence_refs: [beatQuotes[2], usages[2]],
      reference_asset_ids: [assetIds[2]],
      type: "产品包装",
    },
  ];
  const timeline = (first: string, second: string) => `【镜头1】0-3秒：${first}\n3-6秒：细节延续。\n【镜头2】6-9秒：${second}\n9-10秒：画面停留。`;
  const director = {
    async decide(bundle) {
      assert.equal(bundle.references.find((item) => item.asset_id === assetIds[1])?.user_declared_usage, usages[1],
        "the planner receives the frozen alias-only usage unchanged");
      assert.equal(bundle.visual_entities?.find((item) => item.entity_id === "cve_existing_north_factory")?.exact_name, "North Factory",
        "the frozen project registry provides the existing canonical identity");
      return {
        execution_status: "READY" as const,
        entity_candidates: candidates,
        segments: [
          { segment_id: "segment-1", duration_seconds: 10, visual_prompt: timeline("@面霜罐展示乳霜。", "乳霜质地延续。"), dialogue_line_ids: [], reference_asset_ids: [assetIds[0]!], source_narrative_beat_sequences: [1], prop_candidate_keys: ["entity-jar"] },
          { segment_id: "segment-2", duration_seconds: 10, visual_prompt: timeline("@north  factory内窗外天际线。", "North Factory空间延续。"), dialogue_line_ids: [], reference_asset_ids: [assetIds[1]!], source_narrative_beat_sequences: [2], scene_candidate_key: "entity-scene" },
          { segment_id: "segment-3", duration_seconds: 10, visual_prompt: timeline("@外包装盒结尾特写。", "包装画面停留。"), dialogue_line_ids: [], reference_asset_ids: [assetIds[2]!], source_narrative_beat_sequences: [3], prop_candidate_keys: ["entity-box"] },
        ],
        unresolved_items: [],
      };
    },
  };
  let persisted = false;
  const executor = new SemanticCreativePlanningExecutor({
    async resolveCanonicalReferenceSources() { return sourceReferences; },
    async resolveCanonicalVisualEntityContext() {
      return [{
        entity_id: "cve_existing_north_factory",
        entity_kind: "SCENE" as const,
        normalized_identity: JSON.stringify(["northfactory", "day"]),
        revision_id: "cvr_existing_north_factory",
        revision_number: 1,
        content_hash: "f".repeat(64),
        exact_name: "North Factory",
        location: "North Factory",
        time: "day",
      }];
    },
    async completeCreativePlan(input) {
      persisted = true;
      return { id: input.draft.storyboardRevisionId } as never;
    },
  }, director, {
    ...resolveVideoProviderRuntimeProfile("sub2api"),
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
    maxReferenceImages: 7,
  }, undefined, ((prefix) => `${prefix}_g02_alias`) as never);

  await assert.rejects(
    () => executor.execute({
      brief: g02Brief,
      event: { eventId: "evt_g02_alias", messageId: "msg_g02_alias", traceId: "trc_g02_alias", correlationId: "cor_g02_alias" },
    }),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.message.includes("reference usage")
      && error.message.includes("canonical exact_name"),
  );
  assert.equal(persisted, false, "a noncanonical model candidate must fail before planning persistence");
});

test("G02 canonical reference-order failure occurs before any successful planning persistence", async () => {
  const beatQuotes = [
    "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。",
    "G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。",
    "G02_APPROVED_BEAT_3:女性使用产品并以外包装盒特写收尾。",
  ];
  const usages = [
    "面霜罐在第一节拍展示乳霜质地。",
    "研发灌装环境与窗外新加坡天际线用于第二节拍。",
    "外包装盒在第三节拍结尾特写。",
    "女性在第三节拍自然使用产品。",
  ];
  const assetIds = ["ast_g02_jar", "ast_g02_scene", "ast_g02_box", "ast_g02_woman"];
  const referenceSources = assetIds.map((assetId, position) => ({
    asset_id: assetId,
    asset_sha256: String(position + 1).repeat(64),
    mime_type: "image/png" as const,
    position,
    provider_role: position === 1 ? "SCENE" as const : "SUBJECT" as const,
    user_declared_usage: usages[position],
  }));
  const g02Brief: ControlCreativeBriefRevision = {
    ...brief,
    id: "cbr_semantic_g02_order",
    revision: 8,
    sourceText: beatQuotes.join("\n"),
    targetDurationSeconds: 30,
    sourceAssetIds: assetIds,
    sourceAssetRoles: assetIds.map((assetId, index) => ({
      assetId,
      role: index === 1 ? "SCENE" as const : "SUBJECT" as const,
      usage: usages[index],
    })),
  };
  const candidateFor = (candidate_key: string, kind: "PROP" | "SCENE" | "CHARACTER", exact_name: string, sourceIndex: number, assetIndex: number) => ({
    candidate_key,
    kind,
    exact_name,
    source_evidence_refs: [beatQuotes[sourceIndex], usages[assetIndex]],
    reference_asset_ids: [assetIds[assetIndex]],
    ...(kind === "SCENE" ? { location: exact_name, prompt: "单一场景。" } : {}),
    ...(kind === "PROP" ? { type: "护肤产品" } : {}),
    ...(kind === "CHARACTER" ? { role: "产品使用者" } : {}),
    description: exact_name,
  });
  const candidates = [
    candidateFor("entity-jar", "PROP", "面霜罐", 0, 0),
    candidateFor("entity-scene", "SCENE", "研发灌装环境", 1, 1),
    candidateFor("entity-box", "PROP", "外包装盒", 2, 2),
    candidateFor("entity-woman", "CHARACTER", "女性", 2, 3),
  ];
  const timeline = (first: string, second: string) => `【镜头1】0-3秒：${first}\n3-6秒：细节延续。\n【镜头2】6-9秒：${second}\n9-10秒：画面停留。`;
  let persistenceCalled = false;
  const successfulSideEffects = {
    readyStoryboards: 0,
    promptPackages: 0,
    entityMappings: 0,
    successfulOutboxEvents: 0,
  };
  const director = {
    async decide() {
      return {
        execution_status: "READY" as const,
        entity_candidates: candidates,
        segments: [
          { segment_id: "segment-1", duration_seconds: 10, visual_prompt: timeline("@面霜罐乳霜質地。", "肌膚舒緩。"), dialogue_line_ids: [], reference_asset_ids: [assetIds[0]!], source_narrative_beat_sequences: [1], prop_candidate_keys: ["entity-jar"] },
          { segment_id: "segment-2", duration_seconds: 10, visual_prompt: timeline("@研发灌装环境，窗外城市天际线。", "单一研发空间延续。"), dialogue_line_ids: [], reference_asset_ids: [assetIds[1]!], source_narrative_beat_sequences: [2], scene_candidate_key: "entity-scene" },
          { segment_id: "segment-3", duration_seconds: 10, visual_prompt: timeline("@女性自然使用产品。", "@外包装盒特写收尾。"), dialogue_line_ids: [], reference_asset_ids: [assetIds[3]!, assetIds[2]!], source_narrative_beat_sequences: [3], character_candidate_keys: ["entity-woman"], prop_candidate_keys: ["entity-box"] },
        ],
        unresolved_items: [],
      };
    },
  };
  const planningExecutor = new SemanticCreativePlanningExecutor({
    async resolveCanonicalReferenceSources() { return referenceSources; },
    async resolveCanonicalVisualEntityContext() { return []; },
    async completeCreativePlan(input) {
      persistenceCalled = true;
      successfulSideEffects.readyStoryboards += 1;
      successfulSideEffects.promptPackages += input.draft.promptPackages?.length ?? 0;
      successfulSideEffects.entityMappings += 1;
      successfulSideEffects.successfulOutboxEvents += 1;
      return { id: input.draft.storyboardRevisionId } as never;
    },
  }, director, {
    ...resolveVideoProviderRuntimeProfile("sub2api"),
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
    maxReferenceImages: 7,
  }, undefined, ((prefix) => `${prefix}_g02_order`) as never);

  await assert.rejects(
    () => planningExecutor.execute({
      brief: g02Brief,
      event: { eventId: "evt_g02_order", messageId: "msg_g02_order", traceId: "trc_g02_order", correlationId: "cor_g02_order" },
    }),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
  );
  assert.equal(persistenceCalled, false);
  assert.deepEqual(successfulSideEffects, {
    readyStoryboards: 0,
    promptPackages: 0,
    entityMappings: 0,
    successfulOutboxEvents: 0,
  });
});

test("real semantic executor rejects BLOCKED director output without a deterministic fallback", async () => {
  let persisted = false;
  const director = {
    async decide(bundle) {
      return {
        version: 1,
        source_hash: bundle.source_hash,
        target_duration_seconds: 8,
        execution_status: "BLOCKED",
        dialogues: [],
        reference_usages: [],
        segments: [],
        unresolved_items: [{
          unresolved_id: "unr_missing_001",
          question: "缺少可执行的用户决定。",
          blocking: true,
          evidence_refs: [],
        }],
      };
    },
  };
  const executor = new SemanticCreativePlanningExecutor({
    async resolveCanonicalReferenceSources() { return [reference]; },
    async completeCreativePlan() { persisted = true; return undefined; },
  }, director, resolveVideoProviderRuntimeProfile("sub2api"));
  await assert.rejects(
    () => executor.execute({ brief, event: { eventId: "evt", messageId: "msg", traceId: "trc", correlationId: "cor" } }),
    /not executable|blocked|unresolved/i,
  );
  assert.equal(persisted, false);
});

test("G02 PostgreSQL planning, active identity mapping, scheduler TaskRun, and Worker preflight stay connected", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `g02-executor-alias-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefRevisionId = createPrefixedId("cbr");
  const database = createDatabase(databaseUrl);
  const control = new DrizzleControlPlaneRepository(database.db);
  const planning = new DrizzleCreativePlanningRepository(database.db);
  const sourceText = [
    "G02_APPROVED_BEAT_1:面霜罐在第一节拍展示质地。",
    "G02_APPROVED_BEAT_2:团队进入 north  factory 场景。",
    "G02_APPROVED_BEAT_3:女性在第三节拍自然使用产品。",
  ].join("\n");
  const sceneAlias = "north  factory";
  const aliasOnlySceneUsage = `${sceneAlias} standalone scene reference for place identity and visual purpose.`;
  const sceneUsage = "North Factory（north  factory）单体场景参考图，用于该地点身份和画面用途。";
  assert.equal(hasExactEntityNameMention(aliasOnlySceneUsage, sceneAlias), true);
  assert.equal(hasExactEntityNameMention(aliasOnlySceneUsage, "North Factory"), false,
    "alias-only frozen usage cannot satisfy the later scheduler's exact canonical-name preflight");
  assert.equal(hasExactEntityNameMention(sceneUsage, "North Factory"), true);
  const jarUsage = "面霜罐单体参考图，用于该产品身份和画面用途。";
  const womanUsage = "女性单体参考图，用于该人物身份和画面用途。";
  const beatLines = sourceText.split("\n");
  const bindings = [
    { candidateKey: "entity-jar", name: "面霜罐", kind: "PROP" as const, role: "SUBJECT" as const, usage: jarUsage, beatQuote: beatLines[0]! },
    { candidateKey: "entity-scene", name: sceneAlias, kind: "SCENE" as const, role: "SCENE" as const, usage: sceneUsage, beatQuote: beatLines[1]! },
    { candidateKey: "entity-woman", name: "女性", kind: "CHARACTER" as const, role: "SUBJECT" as const, usage: womanUsage, beatQuote: beatLines[2]! },
  ].map((binding) => ({
    ...binding,
    assetId: createPrefixedId("ast"),
    sha256: createHash("sha256").update(`${scope}:${binding.candidateKey}`, "utf8").digest("hex"),
  }));

  try {
    await control.ensureDevIdentity({
      user: { id: userId, displayName: "G02 alias PostgreSQL integration" },
      workspace: { id: workspaceId, name: "G02 alias PostgreSQL integration" },
    });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "G02 alias executor integration" }),
      workspaceId,
      projectId,
      name: "G02 alias executor integration",
    })).kind, "NEW");

    await database.db.insert(assets).values(bindings.map((binding) => ({
      id: binding.assetId,
      workspaceId,
      projectId,
      kind: "IMAGE" as const,
      origin: "USER_UPLOAD" as const,
      status: "READY" as const,
      objectKey: `${workspaceId}/${projectId}/${binding.assetId}/approved-fixture.png`,
      sha256: binding.sha256,
      mimeType: "image/png",
      byteSize: 256,
      metadata: {},
    })));

    const canonicalSceneId = createPrefixedId("cve");
    const canonicalSceneRevisionId = createPrefixedId("cvr");
    const canonicalScenePrompt = "Existing single factory scene.";
    const canonicalSceneLighting = "Soft natural daylight.";
    await database.db.insert(canonicalVisualEntities).values({
      id: canonicalSceneId,
      workspaceId,
      projectId,
      entityKind: "SCENE",
      normalizedIdentity: JSON.stringify([normalizeLocation("North Factory"), "day"]),
    });
    await database.db.insert(canonicalVisualEntityRevisions).values({
      id: canonicalSceneRevisionId,
      workspaceId,
      projectId,
      entityId: canonicalSceneId,
      revisionNumber: 1,
      exactName: "North Factory",
      contentHash: semanticValueHash(["SCENE", canonicalScenePrompt, canonicalSceneLighting]),
      location: "North Factory",
      time: "day",
      prompt: canonicalScenePrompt,
      lighting: canonicalSceneLighting,
    });

    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ sourceText, bindings: bindings.map(({ assetId, usage, role }) => ({ assetId, usage, role })) }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefRevisionId,
      sourceText,
      targetDurationSeconds: 30,
      targetResolution: "720p",
      stylePreferences: "Keep exact source-specific scene identity.",
      sourceAssetIds: bindings.map(({ assetId }) => assetId),
      sourceAssetRoles: bindings.map(({ assetId, usage, role }) => ({ assetId, usage, role })),
      event: {
        eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor"),
      },
    })).kind, "NEW");
    const planningRequest = await planning.requestCreativePlan({
      scope: `${scope}:plan`,
      idempotencyKey: "request-plan",
      requestHash: fingerprintRequest({ briefRevisionId }),
      workspaceId,
      creativeBriefRevisionId: briefRevisionId,
      event: {
        eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor"),
      },
    });
    assert.equal(planningRequest.kind, "NEW");
    if (planningRequest.kind !== "NEW") throw new Error("Expected a frozen G02 Brief in PLANNING state.");

    const timeline = (first: string, second: string) => `【镜头1】0-3秒：${first}\n3-6秒：${second}\n【镜头2】6-9秒：细节延续。\n9-10秒：画面稳定收尾。`;
    const sceneRawTimeline = timeline("@north  factory 内部窗边可见自然光。", "north  factory 的窗面和灯光保持不变。");
    const candidates = [
      { candidate_key: "entity-jar", kind: "PROP" as const, exact_name: "面霜罐", source_evidence_refs: [bindings[0]!.beatQuote, jarUsage], reference_asset_ids: [bindings[0]!.assetId], type: "护肤品容器" },
      { candidate_key: "entity-scene", kind: "SCENE" as const, exact_name: sceneAlias, source_evidence_refs: [bindings[1]!.beatQuote, sceneUsage], reference_asset_ids: [bindings[1]!.assetId], location: sceneAlias, time: "day" },
      { candidate_key: "entity-woman", kind: "CHARACTER" as const, exact_name: "女性", source_evidence_refs: [bindings[2]!.beatQuote, womanUsage], reference_asset_ids: [bindings[2]!.assetId], role: "产品使用者", description: "自然状态的成年女性" },
    ];
    const director = {
      async decide(bundle) {
        assert.equal(bundle.references.find((item) => item.asset_id === bindings[1]!.assetId)?.user_declared_usage, sceneUsage,
          "the planning executor passes frozen usage through unchanged; this positive path explicitly supplies the canonical name");
        return {
          execution_status: "READY" as const,
          entity_candidates: candidates,
          segments: [
            { segment_id: "segment-1", duration_seconds: 10, visual_prompt: timeline("@面霜罐展示乳霜质地；镜头停在罐身标签。", "质地和构图自然延续。"), dialogue_line_ids: [], reference_asset_ids: [bindings[0]!.assetId], source_narrative_beat_sequences: [1], prop_candidate_keys: ["entity-jar"] },
            { segment_id: "segment-2", duration_seconds: 10, visual_prompt: sceneRawTimeline, dialogue_line_ids: [], reference_asset_ids: [bindings[1]!.assetId], source_narrative_beat_sequences: [2], scene_candidate_key: "entity-scene" },
            { segment_id: "segment-3", duration_seconds: 10, visual_prompt: timeline("@女性自然拿起面霜罐。", "女性继续使用产品。"), dialogue_line_ids: [], reference_asset_ids: [bindings[2]!.assetId], source_narrative_beat_sequences: [3], character_candidate_keys: ["entity-woman"] },
          ],
          unresolved_items: [],
        };
      },
    };
    const executor = new SemanticCreativePlanningExecutor(planning, director, {
      ...resolveVideoProviderRuntimeProfile("sub2api"),
      minDurationSeconds: 8,
      maxDurationSeconds: 15,
      maxReferenceImages: 7,
    });
    const storyboard = await executor.execute({ brief: planningRequest.value, event: {
      eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"),
      traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor"),
    } });
    assert.ok(storyboard);

    const loaded = await planning.findStoryboardRevision(workspaceId, storyboard.id);
    assert.ok(loaded);
    const loadedPackages = (await database.db.select().from(promptPackages))
      .filter((pkg) => pkg.workspaceId === workspaceId && pkg.projectId === projectId);
    assert.equal(loadedPackages.length, 3);
    const scenePackage = loadedPackages.find((pkg) => {
      const projection = pkg.referenceMap.semantic_reference_projection as { references?: Array<{ asset_id: string }> } | undefined;
      return projection?.references?.some((reference) => reference.asset_id === bindings[1]!.assetId) ?? false;
    });
    assert.ok(scenePackage);
    const sceneSourcePrompt = (scenePackage.capabilitySnapshot as { source_prompt?: string }).source_prompt;
    const expectedCanonicalSceneSource = sceneRawTimeline
      .replace(/^【镜头[1-9]\d*】/gmu, "")
      .replace(`@${sceneAlias}`, "@North Factory");
    assert.equal(sceneSourcePrompt, expectedCanonicalSceneSource, "only the exact alias anchor changes; all surrounding prompt bytes are preserved");
    assert.ok(scenePackage.prompt.startsWith(expectedCanonicalSceneSource));
    assert.equal(sceneSourcePrompt?.includes("north  factory 的窗面和灯光保持不变"), true);
    assert.equal(candidates[1]!.exact_name, sceneAlias, "the director candidate remains unchanged");
    assert.equal(candidates[1]!.source_evidence_refs[1], sceneUsage);

    const persistedEntities = (await database.db.select().from(canonicalVisualEntities))
      .filter((row) => row.workspaceId === workspaceId && row.projectId === projectId);
    assert.equal(persistedEntities.find((row) => row.entityKind === "SCENE")?.id, canonicalSceneId);
    const sceneRevisions = (await database.db.select().from(canonicalVisualEntityRevisions))
      .filter((row) => row.workspaceId === workspaceId && row.projectId === projectId && row.entityId === canonicalSceneId);
    assert.equal(sceneRevisions.length, 1);
    assert.equal(sceneRevisions[0]?.id, canonicalSceneRevisionId);
    assert.equal(sceneRevisions[0]?.exactName, "North Factory");
    assert.equal(sceneRevisions[0]?.location, "North Factory");
    assert.equal(sceneRevisions[0]?.time, "day");

    const sceneMappings = (await database.db.select().from(canonicalVisualEntityRevisionAssets))
      .filter((row) => row.workspaceId === workspaceId && row.projectId === projectId && row.entityId === canonicalSceneId);
    assert.equal(sceneMappings.length, 1);
    assert.equal(sceneMappings[0]?.assetId, bindings[1]!.assetId);
    assert.equal(sceneMappings[0]?.usage, sceneUsage);
    assert.equal(sceneMappings[0]?.briefRevisionId, briefRevisionId);
    assert.equal(sceneMappings[0]?.changeKind, "ADD");

    const loadedShotRows = (await database.db.select().from(storyboardShotSpecs))
      .filter((row) => row.workspaceId === workspaceId && row.storyboardRevisionId === storyboard.id);
    const loadedSceneShot = loadedShotRows.find((shot) => shot.sequence === 2);
    assert.equal(loadedSceneShot?.sceneId, canonicalSceneId);
    assert.deepEqual(loadedSceneShot?.referenceAnchors, ["@North Factory"]);
    const storedProjection = (scenePackage.referenceMap.semantic_entity_reference_projection as { bindings?: Array<{ entity_id: string; entity_revision_id: string; asset_id: string; exact_name: string; provider_position: number }> } | undefined)?.bindings;
    assert.deepEqual(storedProjection?.map((binding) => ({ entityId: binding.entity_id, revisionId: binding.entity_revision_id, assetId: binding.asset_id, exactName: binding.exact_name, position: binding.provider_position })), [{
      entityId: canonicalSceneId,
      revisionId: canonicalSceneRevisionId,
      assetId: bindings[1]!.assetId,
      exactName: "North Factory",
      position: 0,
    }]);
    assert.equal(loaded.shotSpecs.find((shot) => shot.sequence === 2)?.sceneId, canonicalSceneId);
    assert.deepEqual(loaded.shotSpecs.find((shot) => shot.sequence === 2)?.referenceAnchors, ["@North Factory"]);

    const approved = await planning.approveStoryboardRevision({
      scope: `${scope}:approve`,
      idempotencyKey: "approve",
      requestHash: fingerprintRequest({ approved: storyboard.id }),
      workspaceId,
      storyboardRevisionId: storyboard.id,
      event: {
        eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor"),
      },
    });
    assert.equal(approved.kind, "NEW");
    const productionRunId = createPrefixedId("prd");
    const createdRun = await planning.createProductionRun({
      scope: `${scope}:production-run`,
      idempotencyKey: "production-run",
      requestHash: fingerprintRequest({ storyboardRevisionId: storyboard.id }),
      workspaceId,
      projectId,
      productionRunId,
      storyboardRevisionId: storyboard.id,
      musicPlan: { mode: "OFF" },
      event: {
        eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor"),
      },
    });
    assert.equal(createdRun.kind, "NEW");

    const taskStore = new DrizzleTaskRunRepository(database.db);
    const confirmation = (await taskStore.listWorkspaceEvents({ workspaceId, limit: 100 }))
      .find((event) => event.event_type === "production_run.confirmed"
        && event.data.production_run_id === productionRunId);
    assert.ok(confirmation?.event_type === "production_run.confirmed");
    if (!confirmation || confirmation.event_type !== "production_run.confirmed") {
      throw new Error("The persisted production confirmation event is missing.");
    }

    const production = new DrizzleProductionRepository(database.db);
    const scheduled = await production.initializeProductionRun({ event: confirmation, now: new Date() });
    const firstSegment = scheduled?.segments.find((segment) => segment.sequence === 1);
    assert.equal(scheduled?.productionRun.status, "GENERATING");
    assert.equal(firstSegment?.status, "GENERATING", "the scheduler must create a TaskRun only after the active G02 mappings pass");

    const scheduledQueueEvent = (await taskStore.listWorkspaceEvents({ workspaceId, limit: 100 }))
      .find((event) => event.event_type === "task_run.queued"
        && event.data.input_snapshot.generation_segment_sequence === 1);
    assert.ok(scheduledQueueEvent?.event_type === "task_run.queued");
    if (!scheduledQueueEvent || scheduledQueueEvent.event_type !== "task_run.queued") {
      throw new Error("The scheduler did not persist a queued TaskRun for the first G02 segment.");
    }
    const taskRunId = scheduledQueueEvent.data.task_run_id;

    const queuedOutbox = (await taskStore.claimOutboxEvents({
      relayId: `${scope}:outbox-relay`,
      now: new Date(),
      leaseMs: 30_000,
      limit: 20,
      workspaceId,
      eventTypes: ["task_run.queued"],
    })).find((outbox) => outbox.event.event_type === "task_run.queued"
      && outbox.event.data.task_run_id === taskRunId);
    assert.ok(queuedOutbox);
    if (!queuedOutbox) throw new Error("The scheduler did not persist a task_run.queued outbox event.");
    const queueMessage = createTaskRunQueueMessage(queuedOutbox);
    assert.ok(queueMessage);
    if (!queueMessage) throw new Error("The persisted queue event did not produce a Worker message.");

    const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
    const deliveredReferenceIds: string[][] = [];
    const workerExecutor = new MockVideoTaskExecutor(taskStore, provider, createInMemoryStoragePort(), {
      assetStore: new DrizzleAssetWorkspaceRepository(database.db),
      referenceDelivery: {
        async createVisualInput(input) {
          const referenceIds = input.visualInput.references.map((reference) => reference.asset_id);
          deliveredReferenceIds.push(referenceIds);
          return { mode: "REFERENCE_SET", urls: referenceIds.map((assetId) => `https://provider-input.invalid/${assetId}`) };
        },
      },
    });
    const consumer = new TaskRunEventConsumer(taskStore, {
      consumerName: `${scope}:task-consumer`,
      workerId: `${scope}:worker`,
      leaseMs: 30_000,
    }, workerExecutor);
    assert.equal(await consumer.process(queueMessage), "PROCESSED");
    await taskStore.markOutboxPublished({
      eventId: queuedOutbox.id,
      workspaceId,
      relayId: `${scope}:outbox-relay`,
      now: new Date(),
    });

    const completedTask = await taskStore.findTaskRun(workspaceId, taskRunId);
    assert.equal(completedTask?.status, "SUCCEEDED");
    assert.equal(provider.submitCount, 1);
    assert.equal(deliveredReferenceIds.length, 1);
    assert.deepEqual(deliveredReferenceIds[0], completedTask?.inputSnapshot.reference_asset_ids);
    assert.ok(completedTask?.inputSnapshot.semantic_entity_reference_projection_hash);
    assert.ok(completedTask?.inputSnapshot.semantic_narrative_beat_lineage_hash);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM event_consumptions WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM canonical_visual_entity_revision_assets WHERE workspace_id = $1 AND project_id = $2", [workspaceId, projectId]);
      await client.query("DELETE FROM outbox_events WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
