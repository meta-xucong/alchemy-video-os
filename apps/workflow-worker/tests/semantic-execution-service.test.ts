import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  semanticValueHash,
} from "@alchemy-video/creative-planning/semantic-director";
import {
  semanticPromptPackageIntegrityPayload,
  type SemanticDialogueProjection,
  type SemanticDirectorDecision,
  type SemanticReferenceProjection,
} from "@alchemy-video/contracts";
import type { ControlCreativeBriefRevision, CreativePlanningDraft } from "@alchemy-video/persistence";
import { resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";

import { SemanticPlanningExecutionError } from "../src/creative-planning-failure.js";
import { SemanticCreativePlanningExecutor } from "../src/semantic-execution-service.js";

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
  assert.match(promptPackage!.prompt, /image 1 = scene reference/);
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
    [{ asset_id: reference.asset_id, provider_role: "SCENE", usage: "canonical reference asset", evidence_ids: [canonicalReferenceEvidenceId] }],
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
