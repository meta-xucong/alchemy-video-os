import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  InternalEventEnvelopeSchema,
  InternalMediaRuntimeQueueMessageSchema,
  VideoGenerationInputSnapshotSchema,
  semanticPromptPackageIntegrityPayload,
  type InternalEventEnvelope,
} from "@alchemy-video/contracts";
import { canonicalJson, createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { DrizzleCreativePlanningRepository } from "../src/creative-planning-repository.js";
import { createDatabase } from "../src/db.js";
import { DrizzleDeliveryPreflightStore } from "../src/delivery-preflight-repository.js";
import { DrizzleAssetWorkspaceRepository } from "../src/asset-workspace-repository.js";
import {
  DrizzleProductionRepository,
  ProductionCompositionInputUnavailableError,
  narrationDurationFeedbackLogId,
  type ProductionTaskRunInputFactory,
} from "../src/production-repository.js";
import {
  assets,
  creativeBriefRevisions,
  creativeDecisionLogs,
  eventConsumptions,
  handoffReviews,
  outboxEvents,
  promptPackages,
  providerAttempts,
  productionRuns,
  productionSegments,
  qcReports,
  taskRuns,
  transitionRepairs,
  videoVersions,
  scriptRevisions,
  storyboardRevisions,
  storyboardShotSpecs,
} from "../src/schema.js";

const semanticHash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const isDisposableBgmLifecycleDatabaseUrl = (value: string) => {
  try {
    const url = new URL(value);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    return url.protocol === "postgres:"
      && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
      && /^alchemy_bgm_lifecycle_test_[a-z0-9_-]+$/iu.test(databaseName);
  } catch {
    return false;
  }
};

const eventMetadata = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const taskSucceededEvent = (input: { workspaceId: string; projectId: string; taskRunId: string; assetId: string }): Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }> =>
  InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: createPrefixedId("msg"),
    event_id: createPrefixedId("evt"),
    event_type: "task_run.succeeded",
    occurred_at: new Date().toISOString(),
    trace_id: createPrefixedId("trc"),
    correlation_id: createPrefixedId("cor"),
    idempotency_key: `internal:task-succeeded:${input.taskRunId}`,
    producer: "task-worker-test",
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    aggregate: { type: "task_run", id: input.taskRunId },
    data: {
      task_run_id: input.taskRunId,
      result_asset_id: input.assetId,
      sha256: "a".repeat(64),
    },
    version: 1,
  });

const taskFailedEvent = (input: { workspaceId: string; projectId: string; taskRunId: string; retryable: boolean }): Extract<InternalEventEnvelope, { event_type: "task_run.failed" }> =>
  InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: createPrefixedId("msg"),
    event_id: createPrefixedId("evt"),
    event_type: "task_run.failed",
    occurred_at: new Date().toISOString(),
    trace_id: createPrefixedId("trc"),
    correlation_id: createPrefixedId("cor"),
    idempotency_key: `internal:task-failed:${input.taskRunId}`,
    producer: "task-worker-test",
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    aggregate: { type: "task_run", id: input.taskRunId },
    data: {
      task_run_id: input.taskRunId,
      error_code: "PROVIDER_UNAVAILABLE",
      retryable: input.retryable,
    },
    version: 1,
  });

const readEvent = async (database: ReturnType<typeof createDatabase>["db"], input: {
  workspaceId: string;
  eventType: InternalEventEnvelope["event_type"];
  predicate?: (event: InternalEventEnvelope) => boolean;
}) => {
  const rows = await database.select().from(outboxEvents)
    .where(and(eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.eventType, input.eventType)));
  const event = rows.map((row) => InternalEventEnvelopeSchema.parse(row.payload)).find((value) => input.predicate?.(value) ?? true);
  if (!event) {
    throw new Error(`Expected durable ${input.eventType} event.`);
  }
  return event;
};

const generatedAsset = async (database: ReturnType<typeof createDatabase>["db"], input: {
  workspaceId: string;
  projectId: string;
  taskRunId: string;
}) => {
  const assetId = createPrefixedId("ast");
  await database.insert(assets).values({
    id: assetId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "VIDEO",
    origin: "GENERATED",
    status: "READY",
    objectKey: `${input.workspaceId}/${input.projectId}/${assetId}/generated.mp4`,
    sha256: "a".repeat(64),
    mimeType: "video/mp4",
    byteSize: 1024,
    durationMs: 1_000,
    metadata: { fixture: "c12" },
  });
  await database.update(taskRuns).set({ status: "SUCCEEDED", resultAssetId: assetId, updatedAt: new Date().toISOString() })
    .where(and(eq(taskRuns.workspaceId, input.workspaceId), eq(taskRuns.id, input.taskRunId)));
  return assetId;
};

test("C12 Drizzle production persists QC, handoff, dependency scheduling, composition, and terminal media failure", {
  skip: !process.env.DATABASE_URL && process.env.BGM_LIFECYCLE_TEST_DATABASE_URL === undefined,
}, async () => {
  const bgmLifecycleDatabaseUrl = process.env.BGM_LIFECYCLE_TEST_DATABASE_URL;
  if (bgmLifecycleDatabaseUrl !== undefined && !isDisposableBgmLifecycleDatabaseUrl(bgmLifecycleDatabaseUrl)) {
    throw new Error("BGM_LIFECYCLE_TEST_DATABASE_URL must use postgres:// on loopback and an alchemy_bgm_lifecycle_test_ database name.");
  }
  // An explicitly supplied disposable URL always wins; never silently run the
  // BGM lifecycle negative against the ordinary development DATABASE_URL.
  const databaseUrl = bgmLifecycleDatabaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const runBgmLifecycleNegative = bgmLifecycleDatabaseUrl !== undefined;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `c12-pg-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    const productionSnapshotInputs: Array<{
      prompt: string;
      sourcePrompt?: string;
      generatedPromptParts?: string[];
      referenceAssetIds: string[];
    }> = [];
    const productionSnapshotFactory: ProductionTaskRunInputFactory = (input) => {
      productionSnapshotInputs.push({
        prompt: input.prompt,
        ...(input.sourcePrompt !== undefined ? { sourcePrompt: input.sourcePrompt } : {}),
        ...(input.generatedPromptParts !== undefined ? { generatedPromptParts: [...input.generatedPromptParts] } : {}),
        referenceAssetIds: [...input.referenceAssetIds],
      });
      return VideoGenerationInputSnapshotSchema.parse({
        model: "c12-integration-snapshot",
        prompt: input.prompt,
        duration: input.duration,
        resolution: input.resolution,
        ratio: input.ratio,
        reference_asset_ids: input.referenceAssetIds,
        generation_segment_sequence: input.generationSegmentSequence,
        narrative_beat_sequences: input.narrativeBeatSequences,
        ...(input.motionPlanVersion ? { motion_plan_version: input.motionPlanVersion } : {}),
        ...(input.motionPlanHash ? { motion_plan_hash: input.motionPlanHash } : {}),
        ...(input.motionTimeline ? { motion_timeline: input.motionTimeline } : {}),
        ...(input.deliveryPlanRevisionId ? { delivery_plan_revision_id: input.deliveryPlanRevisionId } : {}),
        ...(input.billing ? { billing: input.billing } : {}),
        visual_input: input.visualInput,
      });
    };
    const production = new DrizzleProductionRepository(database.db, productionSnapshotFactory);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C12 PostgreSQL" }, workspace: { id: workspaceId, name: "C12 PostgreSQL" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "C12 durable production" }),
      workspaceId,
      projectId,
      name: "C12 durable production",
    })).kind, "NEW");

    const sourceImageAssetId = createPrefixedId("ast");
    const sourceDocumentAssetId = createPrefixedId("ast");
    await database.db.insert(assets).values({
      id: sourceDocumentAssetId,
      workspaceId,
      projectId,
      kind: "DOCUMENT",
      origin: "USER_UPLOAD",
      status: "READY",
      objectKey: `${workspaceId}/${projectId}/${sourceDocumentAssetId}/original.pptx`,
      sha256: "f".repeat(64),
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      byteSize: 1024,
      metadata: { fixture: "source-document" },
    });
    await database.db.insert(assets).values({
      id: sourceImageAssetId,
      workspaceId,
      projectId,
      kind: "IMAGE",
      origin: "USER_UPLOAD",
      status: "READY",
      objectKey: `${workspaceId}/${projectId}/${sourceImageAssetId}/original.png`,
      sha256: "e".repeat(64),
      mimeType: "image/png",
      byteSize: 512,
      width: 160,
      height: 90,
      metadata: {
        fixture: "source-reference",
        visual_analysis: { role: "SUBJECT", confidence: 0.95, summary: "团队人物主体" },
        visual_analysis_status: "READY",
      },
    });

    const briefSourceText = "口播文案：团队在黎明前完成交付。\n视频生成意图描述：雨夜抵达工厂，团队完成交付。";
    const created = await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ source_text: briefSourceText, target_duration_seconds: 30, target_resolution: "480p", source_asset_ids: [sourceImageAssetId] }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText: briefSourceText,
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "克制的纪实感",
      sourceAssetIds: [sourceImageAssetId],
      event: eventMetadata(),
    });
    assert.equal(created.kind, "NEW");
    // Historical C11 data may contain a source document beside image references.
    await database.db.update(creativeBriefRevisions)
      .set({ sourceAssetIds: [sourceDocumentAssetId, sourceImageAssetId] })
      .where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, briefId)));
    const requested = await planning.requestCreativePlan({
      scope: `${scope}:plan`,
      idempotencyKey: "request-plan",
      requestHash: fingerprintRequest({}),
      workspaceId,
      creativeBriefRevisionId: briefId,
      event: eventMetadata(),
    });
    assert.equal(requested.kind, "NEW");
    const firstShotSpecId = createPrefixedId("ssp");
    const secondShotSpecId = createPrefixedId("ssp");
    const firstSourcePrompt = "第一段口播：黎明前完成交付。\n保留 @anchor 与 ASCII \"引号\"，不得改写。";
    const firstGeneratedPromptParts = [
      "视觉补充第一项：雨夜工厂入口。",
      "视觉补充第二项：保持 @anchor 与 ASCII \"引号\" 的顺序。",
    ];
    const secondSourcePrompt = "第二段口播：团队在车间完成交接。\n第二行保留 @anchor 与 ASCII \"收尾\"。";
    const secondGeneratedPromptParts = [
      "视觉补充第一项：车间灯光从冷到暖。",
      "视觉补充第二项：镜头停在交接动作。",
    ];
    const secondSemanticSourceHash = createHash("sha256").update(briefSourceText, "utf8").digest("hex");
    const secondSemanticDecisionHash = "d".repeat(64);
    const secondSemanticSegmentId = "seg_c12_semantic_002";
    const secondCompiledPrompt = [secondSourcePrompt, ...secondGeneratedPromptParts].join(" ");
    const secondSemanticEvidenceIds = ["evd_c12_segment_002"];
    const secondSemanticDialogueProjection = {
      version: 1 as const,
      source_hash: secondSemanticSourceHash,
      decision_hash: secondSemanticDecisionHash,
      segment_id: secondSemanticSegmentId,
      dialogues: [],
    };
    const secondSemanticReferenceProjection = {
      version: 1 as const,
      source_hash: secondSemanticSourceHash,
      decision_hash: secondSemanticDecisionHash,
      segment_id: secondSemanticSegmentId,
      references: [{
        asset_id: sourceImageAssetId,
        provider_role: "SUBJECT" as const,
        usage: "用户参考图作为本段人物主体身份参考。",
        evidence_ids: ["evd_c12_reference_001"],
      }],
    };
    const secondSemanticPackageHash = semanticHash(semanticPromptPackageIntegrityPayload({
      shotSpecId: secondShotSpecId,
      prompt: secondCompiledPrompt,
      referencePolicy: "HANDOFF_FIRST_FRAME",
      sourcePrompt: secondSourcePrompt,
      generatedPromptParts: secondGeneratedPromptParts,
      evidenceIds: secondSemanticEvidenceIds,
      dialogueProjection: secondSemanticDialogueProjection,
      referenceProjection: secondSemanticReferenceProjection,
      audioOwner: "LEGACY_PRESERVE",
      maxDurationSeconds: 15,
      maxReferenceImages: 7,
    }));
    const completed = await planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: briefId,
      draft: {
        scriptRevisionId: createPrefixedId("scr"),
        storyboardRevisionId: createPrefixedId("sbr"),
        beats: [
          { sequence: 1, title: "抵达", summary: "雨夜抵达工厂", narrative_goal: "建立压力", visible_facts: ["雨夜", "工厂"] },
          { sequence: 2, title: "交付", summary: "团队完成交付", narrative_goal: "兑现承诺", visible_facts: ["车间", "黎明"] },
        ],
        title: "雨夜交付",
        summary: "团队在黎明前完成承诺。",
        totalDurationSeconds: 30,
        continuityLevel: "STANDARD",
        continuityNote: "通过交接帧承接两段叙事。",
        shotSpecs: [
          { id: firstShotSpecId, sequence: 1, title: "雨夜抵达", durationSeconds: 15, narrativeGoal: "建立压力", startState: "雨夜街道", endState: "进入车间", transitionSummary: "车间亮灯", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "建立开场状态" },
          { id: secondShotSpecId, sequence: 2, title: "黎明交付", durationSeconds: 15, narrativeGoal: "兑现承诺", startState: "车间亮灯", endState: "客户收到成果", transitionSummary: "淡入黎明", referencePolicy: "HANDOFF_FIRST_FRAME", dependsOnSequences: [1], continuityNote: "使用前段交接帧承接画面" },
        ],
        promptPackages: [
          { id: createPrefixedId("ppk"), shotSpecId: firstShotSpecId, compilerVersion: "c12-integration", prompt: [firstSourcePrompt, ...firstGeneratedPromptParts].join(" "), visualConstraints: {}, referenceMap: { reference_policy: "TEXT_TRANSITION" }, capabilitySnapshot: { max_duration_seconds: 15, source_prompt: firstSourcePrompt, generated_prompt_parts: firstGeneratedPromptParts, audio_owner: "LEGACY_PRESERVE" } },
          {
            id: createPrefixedId("ppk"),
            shotSpecId: secondShotSpecId,
            compilerVersion: "c12-integration",
            prompt: secondCompiledPrompt,
            visualConstraints: {
              semantic_segment_id: secondSemanticSegmentId,
              semantic_decision_hash: secondSemanticDecisionHash,
              evidence_ids: secondSemanticEvidenceIds,
            },
            referenceMap: {
              reference_policy: "HANDOFF_FIRST_FRAME",
              semantic_reference_projection: secondSemanticReferenceProjection,
            },
            capabilitySnapshot: {
              max_duration_seconds: 15,
              max_reference_images: 7,
              source_prompt: secondSourcePrompt,
              generated_prompt_parts: secondGeneratedPromptParts,
              audio_owner: "LEGACY_PRESERVE",
              prompt_source_kind: "SEMANTIC_VISUAL_PROJECTION",
              authored_source_hash: secondSemanticSourceHash,
              semantic_decision_hash: secondSemanticDecisionHash,
              semantic_segment_id: secondSemanticSegmentId,
              semantic_dialogue_projection: secondSemanticDialogueProjection,
              semantic_dialogue_projection_hash: semanticHash(secondSemanticDialogueProjection),
              semantic_reference_projection_hash: semanticHash(secondSemanticReferenceProjection),
              semantic_prompt_package_integrity_hash: secondSemanticPackageHash,
            },
          },
        ],
      },
      event: eventMetadata(),
    });
    assert.ok(completed);
    if (!completed) return;
    const persistedPromptPackages = await database.db.select().from(promptPackages)
      .where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.projectId, projectId)));
    assert.equal(persistedPromptPackages.length, 2);
    const persistedFirstPromptPackage = persistedPromptPackages.find((value) => value.shotSpecId === firstShotSpecId);
    const persistedSecondPromptPackage = persistedPromptPackages.find((value) => value.shotSpecId === secondShotSpecId);
    assert.deepEqual((persistedFirstPromptPackage?.capabilitySnapshot as { source_prompt?: unknown; generated_prompt_parts?: unknown }).source_prompt, firstSourcePrompt);
    assert.deepEqual((persistedFirstPromptPackage?.capabilitySnapshot as { source_prompt?: unknown; generated_prompt_parts?: unknown }).generated_prompt_parts, firstGeneratedPromptParts);
    assert.deepEqual((persistedSecondPromptPackage?.capabilitySnapshot as { source_prompt?: unknown; generated_prompt_parts?: unknown }).source_prompt, secondSourcePrompt);
    assert.deepEqual((persistedSecondPromptPackage?.capabilitySnapshot as { source_prompt?: unknown; generated_prompt_parts?: unknown }).generated_prompt_parts, secondGeneratedPromptParts);
    const approved = await planning.approveStoryboardRevision({
      scope: `${scope}:approve`,
      idempotencyKey: "approve",
      requestHash: fingerprintRequest({}),
      workspaceId,
      storyboardRevisionId: completed.id,
      event: eventMetadata(),
    });
    assert.equal(approved.kind, "NEW");
    assert.ok(persistedFirstPromptPackage);
    if (!persistedFirstPromptPackage) return;

    const originalFirstCapabilitySnapshot = persistedFirstPromptPackage.capabilitySnapshot;
    await database.db.update(promptPackages).set({
      capabilitySnapshot: {
        ...originalFirstCapabilitySnapshot,
        prompt_source_kind: "SEMANTIC_VISUAL_PROJECTION",
      },
    }).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.id, persistedFirstPromptPackage.id),
    ));
    const invalidProjectionRunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `${scope}:production:invalid-semantic-projection`,
      idempotencyKey: "production-invalid-semantic-projection",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id, invalid_projection: true }),
      workspaceId,
      projectId,
      productionRunId: invalidProjectionRunId,
      storyboardRevisionId: completed.id,
      musicPlan: { mode: "OFF" },
      event: eventMetadata(),
    })).kind, "NEW");
    const invalidProjectionConfirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (value) => value.event_type === "production_run.confirmed"
        && value.data.production_run_id === invalidProjectionRunId,
    });
    assert.equal(invalidProjectionConfirmed.event_type, "production_run.confirmed");
    if (invalidProjectionConfirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: invalidProjectionConfirmed, now: new Date() });
    const invalidProjectionProgress = await production.findProductionRunProgress(workspaceId, invalidProjectionRunId);
    assert.equal(invalidProjectionProgress?.productionRun.status, "BLOCKED");
    assert.equal(invalidProjectionProgress?.segments[0]?.status, "WAITING");
    assert.equal(invalidProjectionProgress?.segments[0]?.retryable, false);
    assert.equal(invalidProjectionProgress?.segments[0]?.taskRunId, undefined);
    assert.equal(invalidProjectionProgress?.segments[0]?.safeSummary, "语义规划投影校验失败，需要重新规划。");
    await database.db.update(promptPackages).set({
      capabilitySnapshot: originalFirstCapabilitySnapshot,
    }).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.id, persistedFirstPromptPackage.id),
    ));

    const markedBriefSource = [
      "G02_APPROVED_BEAT_1:冻结节拍一。",
      "G02_APPROVED_BEAT_2:冻结节拍二。",
      "G02_APPROVED_BEAT_3:冻结节拍三。",
    ].join("\n");
    await database.db.update(creativeBriefRevisions).set({ sourceText: markedBriefSource })
      .where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, briefId)));
    const missingProjectionRunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `${scope}:production:g02-missing-projection`,
      idempotencyKey: "production-g02-missing-projection",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id, g02_missing_projection: true }),
      workspaceId,
      projectId,
      productionRunId: missingProjectionRunId,
      storyboardRevisionId: completed.id,
      musicPlan: { mode: "OFF" },
      event: eventMetadata(),
    })).kind, "NEW");
    const missingProjectionConfirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (value) => value.event_type === "production_run.confirmed" && value.data.production_run_id === missingProjectionRunId,
    });
    assert.equal(missingProjectionConfirmed.event_type, "production_run.confirmed");
    if (missingProjectionConfirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: missingProjectionConfirmed, now: new Date() });
    const missingProjectionProgress = await production.findProductionRunProgress(workspaceId, missingProjectionRunId);
    assert.equal(missingProjectionProgress?.productionRun.status, "BLOCKED");
    assert.equal(missingProjectionProgress?.segments.every((segment) => segment.status === "WAITING" && segment.taskRunId === undefined), true);
    await database.db.update(creativeBriefRevisions).set({ sourceText: briefSourceText })
      .where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, briefId)));

    await database.db.update(promptPackages).set({
      capabilitySnapshot: { ...originalFirstCapabilitySnapshot, semantic_narrative_beat_lineage: { fixture: true } },
    }).where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.id, persistedFirstPromptPackage.id)));
    const mismatchedG02RunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `${scope}:production:g02-metadata-without-marker`,
      idempotencyKey: "production-g02-metadata-without-marker",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id, g02_metadata_without_marker: true }),
      workspaceId,
      projectId,
      productionRunId: mismatchedG02RunId,
      storyboardRevisionId: completed.id,
      musicPlan: { mode: "OFF" },
      event: eventMetadata(),
    })).kind, "NEW");
    const mismatchedG02Confirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (value) => value.event_type === "production_run.confirmed" && value.data.production_run_id === mismatchedG02RunId,
    });
    assert.equal(mismatchedG02Confirmed.event_type, "production_run.confirmed");
    if (mismatchedG02Confirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: mismatchedG02Confirmed, now: new Date() });
    const mismatchedG02Progress = await production.findProductionRunProgress(workspaceId, mismatchedG02RunId);
    assert.equal(mismatchedG02Progress?.productionRun.status, "BLOCKED");
    assert.equal(mismatchedG02Progress?.segments.every((segment) => segment.status === "WAITING" && segment.taskRunId === undefined), true);
    await database.db.update(promptPackages).set({ capabilitySnapshot: originalFirstCapabilitySnapshot })
      .where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.id, persistedFirstPromptPackage.id)));

    const bgmAssetId = runBgmLifecycleNegative ? createPrefixedId("ast") : undefined;
    const bgmSha256 = "e".repeat(64);
    if (bgmAssetId) {
      const targetDurationMs = completed.totalDurationSeconds * 1_000;
      await database.db.insert(assets).values({
        id: bgmAssetId,
        workspaceId,
        projectId,
        kind: "AUDIO",
        origin: "USER_UPLOAD",
        status: "READY",
        objectKey: `${workspaceId}/${projectId}/${bgmAssetId}/music.mp3`,
        sha256: bgmSha256,
        mimeType: "audio/mpeg",
        byteSize: 4_096,
        durationMs: targetDurationMs,
        metadata: { audio_role: "MUSIC", fixture: "c12-bgm-lifecycle" },
      });
    }
    const bgmDeliveryPlanRevisionId = runBgmLifecycleNegative ? createPrefixedId("dpr") : undefined;
    if (bgmDeliveryPlanRevisionId) {
      const delivery = new DrizzleDeliveryPreflightStore(database.db);
      assert.equal((await delivery.createDeliveryPlanRevision({
        scope: `${scope}:bgm-delivery-plan`,
        idempotencyKey: "bgm-delivery-plan",
        requestHash: fingerprintRequest({ storyboard_revision_id: completed.id, target_duration_seconds: completed.totalDurationSeconds }),
        workspaceId,
        projectId,
        deliveryPlanRevisionId: bgmDeliveryPlanRevisionId,
        creativeBriefRevisionId: briefId,
        storyboardRevisionId: completed.id,
        targetDurationSeconds: completed.totalDurationSeconds,
        durationPolicy: "EXACT",
        flexibleDurationPercent: 0,
        captionPolicy: "OFF",
        lipSyncRequirement: "OFF",
        voiceMode: "PLATFORM_GENERIC",
        event: eventMetadata(),
      })).kind, "NEW");
      assert.equal((await delivery.approveDeliveryPlanRevision({
        scope: `${scope}:bgm-delivery-plan-approval`,
        idempotencyKey: "bgm-delivery-plan-approval",
        requestHash: fingerprintRequest({ delivery_plan_revision_id: bgmDeliveryPlanRevisionId }),
        workspaceId,
        deliveryPlanRevisionId: bgmDeliveryPlanRevisionId,
        event: eventMetadata(),
      })).kind, "NEW");
    }
    const firstRunId = createPrefixedId("prd");
    const firstRun = await planning.createProductionRun({
      scope: `${scope}:production:success`,
      idempotencyKey: "production-success",
      requestHash: fingerprintRequest({
        storyboard_revision_id: completed.id,
        ...(bgmAssetId ? {
          audio_selection: "MUSIC_REPLACE_PROVIDER_AUDIO",
          music_asset_id: bgmAssetId,
          delivery_plan_revision_id: bgmDeliveryPlanRevisionId,
        } : {}),
      }),
      workspaceId,
      projectId,
      productionRunId: firstRunId,
      storyboardRevisionId: completed.id,
      ...(bgmDeliveryPlanRevisionId ? { deliveryPlanRevisionId: bgmDeliveryPlanRevisionId } : {}),
      // The ordinary integration path remains explicitly music-off. The
      // isolated BGM lifecycle path freezes a real MANUAL asset through the
      // production command and then follows the same accepted-segment flow.
      musicPlan: bgmAssetId
        ? { mode: "MANUAL", asset_id: bgmAssetId, style_hint: "" }
        : { mode: "OFF" },
      ...(bgmAssetId ? { audioSelection: "MUSIC_REPLACE_PROVIDER_AUDIO" as const } : {}),
      event: eventMetadata(),
    });
    assert.equal(firstRun.kind, "NEW");
    const confirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (event) => event.event_type === "production_run.confirmed" && event.data.production_run_id === firstRunId,
    });
    assert.equal(confirmed.event_type, "production_run.confirmed");
    if (confirmed.event_type !== "production_run.confirmed") return;
    // A Worker restart can leave the confirmation event leased or already
    // delivered to an old queue before initialization completes. Recovery must
    // therefore include CONFIRMED runs, not only GENERATING runs.
    const recoveredConfirmed = await production.recoverActiveProductionRuns({ now: new Date(), workspaceId });
    assert.equal(recoveredConfirmed.length, 1);
    let progress = await production.findProductionRunProgress(workspaceId, firstRunId);
    assert.equal(progress?.productionRun.status, "GENERATING");
    assert.deepEqual(progress?.segments.map((segment) => segment.status), ["GENERATING", "WAITING"]);

    const [firstSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId), eq(productionSegments.sequence, 1)));
    assert.ok(firstSegment?.taskRunId);
    const [firstTask] = await database.db.select().from(taskRuns)
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.id, firstSegment!.taskRunId!)));
    const firstSnapshot = firstTask?.inputSnapshot as { prompt?: string } | undefined;
    assert.deepEqual(productionSnapshotInputs[0]?.sourcePrompt, firstSourcePrompt);
    assert.deepEqual(productionSnapshotInputs[0]?.generatedPromptParts, firstGeneratedPromptParts);
    assert.equal(firstSnapshot?.prompt, [firstSourcePrompt, ...firstGeneratedPromptParts].join(" "));
    assert.ok(firstSnapshot?.prompt?.includes("@anchor"));
    assert.ok(firstSnapshot?.prompt?.includes("ASCII \"引号\""));
    assert.equal(productionSnapshotInputs.length, 1);
    const taskCountBeforeDuplicateInitialization = (await database.db.select().from(taskRuns)
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.projectId, projectId)))).length;
    await production.initializeProductionRun({ event: confirmed, now: new Date() });
    assert.equal((await database.db.select().from(taskRuns)
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.projectId, projectId)))).length, taskCountBeforeDuplicateInitialization);
    assert.equal(productionSnapshotInputs.length, 1);

    // Simulate a process restart after a legacy scheduler left the segment waiting.
    await database.db.update(productionSegments).set({ status: "WAITING", shotId: null, taskRunId: null, updatedAt: new Date().toISOString() })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, firstSegment!.id)));
    const recovered = await production.recoverActiveProductionRuns({ now: new Date(), workspaceId });
    assert.equal(recovered.length, 1);
    const [recoveredSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, firstSegment!.id)));
    assert.equal(recoveredSegment?.status, "GENERATING");
    assert.ok(recoveredSegment?.taskRunId);
    assert.notEqual(recoveredSegment?.taskRunId, firstSegment?.taskRunId);
    // The recovery path reuses the persisted task snapshot; the sidecar
    // evidence above is asserted at the first factory boundary, while this
    // branch verifies that a new task is attached without a duplicate submit.
    const queuedEvents = await database.db.select().from(outboxEvents)
      .where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "task_run.queued")));
    assert.ok(queuedEvents.some((row) => (row.payload as { data?: { task_run_id?: string } }).data?.task_run_id === recoveredSegment?.taskRunId));

    // Continue the lifecycle using the recovered TaskRun.
    const recoveredTaskRunId = recoveredSegment!.taskRunId!;
    const firstAssetId = await generatedAsset(database.db, { workspaceId, projectId, taskRunId: recoveredTaskRunId });
    await production.recordProductionTaskSucceeded({ event: taskSucceededEvent({ workspaceId, projectId, taskRunId: recoveredTaskRunId, assetId: firstAssetId }), now: new Date() });
    const firstQcEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === recoveredTaskRunId,
    });
    assert.equal(firstQcEvent.event_type, "production_segment.qc_requested");
    if (firstQcEvent.event_type !== "production_segment.qc_requested") return;
    const firstQcMessage = InternalMediaRuntimeQueueMessageSchema.parse({
      contract_version: firstQcEvent.contract_version,
      event_type: firstQcEvent.event_type,
      event_id: firstQcEvent.event_id,
      workspace_id: firstQcEvent.workspace_id,
      project_id: firstQcEvent.project_id,
      production_run_id: firstQcEvent.data.production_run_id,
      production_segment_id: firstQcEvent.data.production_segment_id,
      task_run_id: firstQcEvent.data.task_run_id,
      correlation_id: firstQcEvent.correlation_id,
    });
    const firstClaimedAt = new Date();
    assert.equal((await production.claimMediaRuntimeEvent({ message: firstQcMessage, consumerName: "c12-pg-media", workerId: "c12-pg-worker", now: firstClaimedAt, leaseMs: 1_000 })).kind, "CLAIMED");
    assert.equal((await production.claimMediaRuntimeEvent({ message: firstQcMessage, consumerName: "c12-pg-media", workerId: "c12-pg-worker", now: new Date(firstClaimedAt.getTime() + 1), leaseMs: 1_000 })).kind, "BUSY");
    const restartedWorkerId = "c12-pg-worker-restarted";
    assert.equal((await production.claimMediaRuntimeEvent({
      message: firstQcMessage,
      consumerName: "c12-pg-media",
      workerId: restartedWorkerId,
      now: new Date(firstClaimedAt.getTime() + 2_000),
      leaseMs: 1_000,
    })).kind, "CLAIMED");
    const firstHandoffAssetId = createPrefixedId("ast");
    await production.acceptProductionSegmentQc({
      event: firstQcEvent,
      handoffAsset: {
        id: firstHandoffAssetId,
        objectKey: `${workspaceId}/${projectId}/${firstHandoffAssetId}/handoff.png`,
        sha256: "b".repeat(64),
        byteSize: 512,
        width: 160,
        height: 90,
      },
      now: new Date(),
    });
    await production.completeMediaRuntimeEvent({ eventId: firstQcEvent.event_id, workspaceId, consumerName: "c12-pg-media", workerId: restartedWorkerId, now: new Date() });
    assert.equal((await production.claimMediaRuntimeEvent({
      message: firstQcMessage,
      consumerName: "c12-pg-media",
      workerId: "c12-pg-worker",
      now: new Date(),
      leaseMs: 1_000,
    })).kind, "DUPLICATE");
    const handoffEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "handoff_asset.accepted",
      predicate: (event) => event.event_type === "handoff_asset.accepted" && event.data.production_run_id === firstRunId,
    });
    assert.equal(handoffEvent.event_type, "handoff_asset.accepted");
    if (handoffEvent.event_type !== "handoff_asset.accepted") return;
    await production.resumeProductionRun({ event: handoffEvent, now: new Date() });
    const [secondSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId), eq(productionSegments.sequence, 2)));
    assert.ok(secondSegment?.taskRunId);
    const [secondTask] = await database.db.select().from(taskRuns)
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.id, secondSegment.taskRunId!)));
    const snapshot = secondTask?.inputSnapshot as { resolution?: string; reference_asset_ids?: string[]; visual_input?: { mode?: string; references?: Array<{ asset_id?: string; role?: string }> } } | undefined;
    assert.equal(snapshot?.resolution, "480p");
    assert.equal(snapshot?.visual_input?.mode, "REFERENCE_SET");
    assert.equal(snapshot?.visual_input?.references?.length, 2);
    assert.deepEqual(snapshot?.reference_asset_ids, [firstHandoffAssetId, sourceImageAssetId]);
    assert.deepEqual(snapshot?.visual_input?.references?.map((reference) => reference.asset_id), [firstHandoffAssetId, sourceImageAssetId]);
    assert.deepEqual(snapshot?.visual_input?.references?.map((reference) => reference.role), ["HANDOFF", "SUBJECT"]);
    assert.deepEqual(productionSnapshotInputs.at(-1)?.sourcePrompt, secondSourcePrompt);
    assert.deepEqual(productionSnapshotInputs.at(-1)?.generatedPromptParts, secondGeneratedPromptParts);
    assert.equal(snapshot?.prompt, [secondSourcePrompt, ...secondGeneratedPromptParts].join(" "));
    assert.ok(snapshot?.prompt?.includes("@anchor"));
    assert.ok(snapshot?.prompt?.includes("ASCII \"收尾\""));

    const secondAssetId = await generatedAsset(database.db, { workspaceId, projectId, taskRunId: secondSegment.taskRunId! });
    await production.recordProductionTaskSucceeded({ event: taskSucceededEvent({ workspaceId, projectId, taskRunId: secondSegment.taskRunId!, assetId: secondAssetId }), now: new Date() });
    const secondQcEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === secondSegment.taskRunId,
    });
    assert.equal(secondQcEvent.event_type, "production_segment.qc_requested");
    if (secondQcEvent.event_type !== "production_segment.qc_requested") return;
    assert.ok(secondTask);
    assert.ok(persistedSecondPromptPackage);
    if (!secondTask || !persistedSecondPromptPackage) return;
    const originalSecondTaskSnapshot = secondTask.inputSnapshot;
    await database.db.update(taskRuns).set({
      inputSnapshot: { ...originalSecondTaskSnapshot, audio_owner: "NATIVE_PROVIDER" },
    }).where(and(
      eq(taskRuns.workspaceId, workspaceId),
      eq(taskRuns.id, secondTask.id),
    ));
    await database.db.update(promptPackages).set({
      prompt: `${secondCompiledPrompt} QC 前被手工替换`,
    }).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.id, persistedSecondPromptPackage.id),
    ));
    await assert.rejects(
      () => production.findProductionSegmentQcInput({ event: secondQcEvent }),
      (error) => error instanceof ProductionCompositionInputUnavailableError
        && /semantic prompt package integrity is invalid/u.test(error.message),
    );
    await database.db.update(promptPackages).set({ prompt: secondCompiledPrompt }).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.id, persistedSecondPromptPackage.id),
    ));
    const verifiedSecondQcInput = await production.findProductionSegmentQcInput({ event: secondQcEvent });
    assert.equal(verifiedSecondQcInput?.productionSegmentId, secondQcEvent.data.production_segment_id);
    await database.db.update(taskRuns).set({
      inputSnapshot: originalSecondTaskSnapshot,
    }).where(and(
      eq(taskRuns.workspaceId, workspaceId),
      eq(taskRuns.id, secondTask.id),
    ));
    const secondHandoffAssetId = createPrefixedId("ast");
    await production.acceptProductionSegmentQc({
      event: secondQcEvent,
      handoffAsset: {
        id: secondHandoffAssetId,
        objectKey: `${workspaceId}/${projectId}/${secondHandoffAssetId}/handoff.png`,
        sha256: "c".repeat(64),
        byteSize: 512,
        width: 160,
        height: 90,
      },
      now: new Date(),
    });
    if (runBgmLifecycleNegative) {
      const [deliveryPlanRun] = await database.db.select({ status: productionRuns.status, continuityStatus: productionRuns.continuityStatus })
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, firstRunId)));
      assert.deepEqual(deliveryPlanRun, { status: "REVIEWING", continuityStatus: "NOT_CHECKED" });
      assert.equal((await database.db.select().from(handoffReviews).where(and(
        eq(handoffReviews.workspaceId, workspaceId),
        eq(handoffReviews.productionRunId, firstRunId),
      ))).length, 0, "DeliveryPlan-backed source hard-cut does not create legacy handoff reviews");
      assert.equal((await database.db.select().from(transitionRepairs).where(and(
        eq(transitionRepairs.workspaceId, workspaceId),
        eq(transitionRepairs.productionRunId, firstRunId),
      ))).length, 0, "DeliveryPlan-backed source hard-cut does not create legacy transition repairs");
    } else {
      const reviewEvent = await readEvent(database.db, {
        workspaceId,
        eventType: "handoff_review.requested",
        predicate: (event) => event.event_type === "handoff_review.requested" && event.data.production_run_id === firstRunId,
      });
      assert.equal(reviewEvent.event_type, "handoff_review.requested");
      if (reviewEvent.event_type !== "handoff_review.requested") return;
      const reviewInput = await production.findHandoffReviewInput({ event: reviewEvent });
      assert.equal(reviewInput?.fromSequence, 1);
      assert.equal(reviewInput?.toSequence, 2);
      await production.completeHandoffReview({
        event: reviewEvent,
        evaluation: {
          result: "UNAVAILABLE",
          reasonCodes: ["EVALUATOR_UNAVAILABLE"],
          safeSummary: "衔接检查不可用，保留需要注意并采用直切。",
          evaluatorVersion: "unavailable",
          retryable: false,
        },
        now: new Date(),
      });
      assert.equal((await database.db.select().from(handoffReviews).where(and(eq(handoffReviews.workspaceId, workspaceId), eq(handoffReviews.productionRunId, firstRunId)))).length, 1);
      assert.equal((await database.db.select().from(transitionRepairs).where(and(eq(transitionRepairs.workspaceId, workspaceId), eq(transitionRepairs.productionRunId, firstRunId)))).length, 0);
      const [reviewedRun] = await database.db.select({ continuityStatus: productionRuns.continuityStatus }).from(productionRuns).where(and(
        eq(productionRuns.workspaceId, workspaceId),
        eq(productionRuns.id, firstRunId),
      ));
      assert.equal(reviewedRun?.continuityStatus, "NEEDS_ATTENTION");
    }
    const compositionEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "video_version.composition_requested",
      predicate: (event) => event.event_type === "video_version.composition_requested" && event.data.production_run_id === firstRunId,
    });
    assert.equal(compositionEvent.event_type, "video_version.composition_requested");
    if (compositionEvent.event_type !== "video_version.composition_requested") return;
    assert.equal((await database.db.select().from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.aggregateType, "production_run"),
      eq(outboxEvents.aggregateId, firstRunId),
      eq(outboxEvents.eventType, "video_version.composition_requested"),
    ))).length, 1);
    if (runBgmLifecycleNegative) {
      const [runBeforeTamper] = await database.db.select().from(productionRuns).where(and(
        eq(productionRuns.workspaceId, workspaceId),
        eq(productionRuns.id, firstRunId),
      ));
      assert.equal(runBeforeTamper?.status, "REVIEWING");
      assert.equal(runBeforeTamper?.acceptedShotCount, 2);
      const frozenGuard = runBeforeTamper?.budgetGuard;
      assert.ok(frozenGuard);
      const frozenMusic = frozenGuard?.music_replacement_source as Record<string, unknown> | undefined;
      assert.equal(frozenGuard?.audio_selection, "MUSIC_REPLACE_PROVIDER_AUDIO");
      assert.deepEqual(frozenGuard?.music_plan, { mode: "MANUAL", asset_id: bgmAssetId, style_hint: "" });
      assert.equal(frozenMusic?.assetId, bgmAssetId);
      assert.equal(frozenMusic?.sha256, bgmSha256);
      assert.equal(frozenMusic?.byteSize, 4_096);
      assert.equal(frozenMusic?.durationMs, runBeforeTamper?.totalDurationSeconds * 1_000);

      const acceptedSegmentsBefore = await database.db.select({ id: productionSegments.id, sequence: productionSegments.sequence, status: productionSegments.status, taskRunId: productionSegments.taskRunId })
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId)))
        .orderBy(asc(productionSegments.sequence));
      assert.deepEqual(acceptedSegmentsBefore.map((segment) => segment.status), ["ACCEPTED", "ACCEPTED"]);
      const outboxIdsBefore = (await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
        eq(outboxEvents.workspaceId, workspaceId),
        eq(outboxEvents.aggregateType, "production_run"),
        eq(outboxEvents.aggregateId, firstRunId),
      )).orderBy(asc(outboxEvents.id))).map((row) => row.id);
      const videoVersionIdsBefore = (await database.db.select({ id: videoVersions.id }).from(videoVersions).where(and(
        eq(videoVersions.workspaceId, workspaceId),
        eq(videoVersions.productionRunId, firstRunId),
      ))).map((row) => row.id);
      assert.deepEqual(videoVersionIdsBefore, [], "no composition output VideoVersion exists before the reload attempt");
      const projectAssetIdsBefore = (await database.db.select({ id: assets.id }).from(assets).where(and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, projectId),
      )).orderBy(asc(assets.id))).map((row) => row.id);
      const segmentTaskRunIds = acceptedSegmentsBefore.flatMap((segment) => segment.taskRunId ? [segment.taskRunId] : []);
      const providerAttemptIdsBefore = segmentTaskRunIds.length > 0
        ? (await database.db.select({ id: providerAttempts.id }).from(providerAttempts).where(and(
          eq(providerAttempts.workspaceId, workspaceId),
          inArray(providerAttempts.taskRunId, segmentTaskRunIds),
        )).orderBy(asc(providerAttempts.id))).map((row) => row.id)
        : [];

      const tamperedBudgetGuard = {
        ...frozenGuard,
        music_replacement_source: { ...frozenMusic, sha256: "f".repeat(64) },
      };
      await database.db.update(productionRuns).set({ budgetGuard: tamperedBudgetGuard }).where(and(
        eq(productionRuns.workspaceId, workspaceId),
        eq(productionRuns.id, firstRunId),
      ));
      try {
        await assert.rejects(
          () => production.findProductionCompositionInput({ event: compositionEvent }),
          (error) => error instanceof ProductionCompositionInputUnavailableError
            && /frozen BGM replacement asset identity or full-run duration has changed/u.test(error.message),
        );
      } finally {
        await database.db.update(productionRuns).set({ budgetGuard: frozenGuard }).where(and(
          eq(productionRuns.workspaceId, workspaceId),
          eq(productionRuns.id, firstRunId),
        ));
      }

      const [runAfterTamper] = await database.db.select().from(productionRuns).where(and(
        eq(productionRuns.workspaceId, workspaceId),
        eq(productionRuns.id, firstRunId),
      ));
      assert.equal(runAfterTamper?.status, "REVIEWING");
      assert.equal(runAfterTamper?.acceptedShotCount, 2);
      assert.deepEqual((await database.db.select({ id: productionSegments.id, sequence: productionSegments.sequence, status: productionSegments.status, taskRunId: productionSegments.taskRunId })
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId)))
        .orderBy(asc(productionSegments.sequence))), acceptedSegmentsBefore);
      assert.deepEqual((await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
        eq(outboxEvents.workspaceId, workspaceId),
        eq(outboxEvents.aggregateType, "production_run"),
        eq(outboxEvents.aggregateId, firstRunId),
      )).orderBy(asc(outboxEvents.id))).map((row) => row.id), outboxIdsBefore);
      assert.deepEqual((await database.db.select({ id: videoVersions.id }).from(videoVersions).where(and(
        eq(videoVersions.workspaceId, workspaceId),
        eq(videoVersions.productionRunId, firstRunId),
      ))).map((row) => row.id), videoVersionIdsBefore);
      assert.deepEqual((await database.db.select({ id: assets.id }).from(assets).where(and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, projectId),
      )).orderBy(asc(assets.id))).map((row) => row.id), projectAssetIdsBefore);
      const providerAttemptIdsAfter = segmentTaskRunIds.length > 0
        ? (await database.db.select({ id: providerAttempts.id }).from(providerAttempts).where(and(
          eq(providerAttempts.workspaceId, workspaceId),
          inArray(providerAttempts.taskRunId, segmentTaskRunIds),
        )).orderBy(asc(providerAttempts.id))).map((row) => row.id)
        : [];
      assert.deepEqual(providerAttemptIdsAfter, providerAttemptIdsBefore);
    }
    assert.ok(persistedSecondPromptPackage);
    if (!persistedSecondPromptPackage) return;
    await database.db.update(promptPackages).set({
      prompt: `${secondCompiledPrompt} 被手工替换`,
    }).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.id, persistedSecondPromptPackage.id),
    ));
    await assert.rejects(
      () => production.findProductionCompositionInput({ event: compositionEvent }),
      (error) => error instanceof ProductionCompositionInputUnavailableError
        && /semantic prompt package integrity is invalid/u.test(error.message),
    );
    await database.db.update(promptPackages).set({
      prompt: secondCompiledPrompt,
    }).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.id, persistedSecondPromptPackage.id),
    ));
    const compositionInput = await production.findProductionCompositionInput({ event: compositionEvent });
    assert.deepEqual(compositionInput?.segments.map((segment) => segment.sequence), [1, 2]);
    assert.equal(compositionInput?.compositionPlan.target_duration_ms, 2_000);
    assert.deepEqual(compositionInput?.compositionPlan.transitions, ["PASS"]);
    assert.deepEqual(compositionInput?.compositionPlan.bridge_durations_ms, []);
    assert.equal(compositionInput?.compositionPlan.audio_policy, bgmAssetId ? "LEGACY_PRESERVE" : "CONTINUOUS_NARRATION");
    assert.equal(compositionInput?.compositionPlan.music_mix.enabled, Boolean(bgmAssetId));
    assert.deepEqual(compositionInput?.compositionPlan.music_segments_ms, bgmAssetId ? [{ start_ms: 0, end_ms: 2_000 }] : []);
    assert.equal(compositionInput?.musicAsset?.id, bgmAssetId);
    if (bgmAssetId) {
      assert.equal(compositionInput?.compositionPlan.audio_plan?.target_duration_ms, 2_000);
      assert.deepEqual(compositionInput?.compositionPlan.audio_plan?.tracks.map((track) => track.track_id), ["music"]);
      assert.equal(compositionInput?.compositionPlan.audio_plan?.tracks[0]?.asset_id, bgmAssetId);
      assert.equal(compositionInput?.compositionPlan.audio_plan?.tracks[0]?.end_ms, 2_000);
    }
    const composedAssetId = createPrefixedId("ast");
    await production.completeProductionComposition({
      event: compositionEvent,
      videoAsset: {
        id: composedAssetId,
        objectKey: `${workspaceId}/${projectId}/${composedAssetId}/composed.mp4`,
        sha256: "d".repeat(64),
        byteSize: 2_048,
        durationMs: 30_000,
      },
      finalReview: {
        status: "PASS",
        review_completeness: "PARTIAL",
        issues_found: ["语义评估器未提供；保持 UNAVAILABLE。"],
        recommended_action: "PRESENT_WITH_REVIEW",
      },
      now: new Date(),
    });
    progress = await production.findProductionRunProgress(workspaceId, firstRunId);
    assert.equal(progress?.productionRun.status, "SUCCEEDED");
    assert.equal(progress?.productionRun.acceptedShotCount, 2);
    const firstVideoVersions = await database.db.select().from(videoVersions).where(and(eq(videoVersions.workspaceId, workspaceId), eq(videoVersions.productionRunId, firstRunId)));
    assert.deepEqual(firstVideoVersions.map((version) => version.status), ["SUCCEEDED"]);
    const firstQcReport = await database.db.select().from(qcReports).where(and(eq(qcReports.workspaceId, workspaceId), eq(qcReports.id, firstVideoVersions[0]!.qcReportId!)));
    assert.equal(firstQcReport[0]?.status, "PASS");
    assert.match(firstQcReport[0]?.safeSummary ?? "", /部分检查未运行/);
    const firstQcConsumptions = await database.db.select().from(eventConsumptions).where(and(
      eq(eventConsumptions.workspaceId, workspaceId),
      eq(eventConsumptions.eventId, firstQcEvent.event_id),
      eq(eventConsumptions.consumerName, "c12-pg-media"),
    ));
    assert.equal(firstQcConsumptions.length, 1);

    // A retry with a fresh idempotency key must reuse the existing durable
    // composition request for the run, rather than enqueueing a duplicate.
    const firstRunSegments = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId)));
    assert.equal(firstRunSegments.length, 2);
    assert.ok(firstRunSegments.every((segment) => segment.taskRunId));
    await database.db.update(productionRuns).set({ status: "FAILED" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, firstRunId)));
    await database.db.update(productionSegments).set({ status: "ACCEPTED", retryable: false })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId)));
    const retryCompositionEventCount = async () => (await database.db.select().from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.aggregateType, "production_run"),
      eq(outboxEvents.aggregateId, firstRunId),
      eq(outboxEvents.eventType, "video_version.composition_requested"),
    ))).length;
    const beforeCompositionRetry = await retryCompositionEventCount();
    const firstCompositionRetry = await production.retryProductionComposition({
      scope: `${scope}:retry-composition-existing`,
      idempotencyKey: "retry-composition-existing-1",
      requestHash: fingerprintRequest({ retry: 1 }),
      workspaceId,
      productionRunId: firstRunId,
      event: eventMetadata(),
    });
    assert.equal(firstCompositionRetry.kind, "NEW");
    assert.equal(await retryCompositionEventCount(), beforeCompositionRetry);
    await database.db.update(productionRuns).set({ status: "FAILED" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, firstRunId)));
    const secondCompositionRetry = await production.retryProductionComposition({
      scope: `${scope}:retry-composition-existing`,
      idempotencyKey: "retry-composition-existing-2",
      requestHash: fingerprintRequest({ retry: 2 }),
      workspaceId,
      productionRunId: firstRunId,
      event: eventMetadata(),
    });
    assert.equal(secondCompositionRetry.kind, "NEW");
    assert.equal(await retryCompositionEventCount(), beforeCompositionRetry);

    const previousCompositionEvent = (await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.aggregateType, "production_run"),
      eq(outboxEvents.aggregateId, firstRunId),
      eq(outboxEvents.eventType, "video_version.composition_requested"),
    )).limit(1))[0];
    assert.ok(previousCompositionEvent);
    const consumptionScope = and(
      eq(eventConsumptions.workspaceId, workspaceId),
      eq(eventConsumptions.eventId, previousCompositionEvent.id),
      eq(eventConsumptions.consumerName, "media-runtime-transition"),
    );
    const deadLetteredAt = new Date().toISOString();
    const existingCompositionConsumption = (await database.db.select({ eventId: eventConsumptions.eventId }).from(eventConsumptions).where(consumptionScope).limit(1))[0];
    if (existingCompositionConsumption) {
      await database.db.update(eventConsumptions).set({ deadLetteredAt, completedAt: null })
        .where(consumptionScope);
    } else {
      await database.db.insert(eventConsumptions).values({
        workspaceId,
        eventId: previousCompositionEvent.id,
        consumerName: "media-runtime-transition",
        attempts: 3,
        deadLetteredAt,
      });
    }
    await database.db.update(eventConsumptions).set({ completedAt: deadLetteredAt })
      .where(consumptionScope);
    const retryWithConflictingConsumptionState = await production.retryProductionComposition({
      scope: `${scope}:retry-composition-existing`,
      idempotencyKey: "retry-composition-conflicting-consumption-state",
      requestHash: fingerprintRequest({ retry: "conflicting-consumption-state" }),
      workspaceId,
      productionRunId: firstRunId,
      event: eventMetadata(),
    });
    assert.equal(retryWithConflictingConsumptionState.kind, "STATE_INVALID");
    assert.equal(await retryCompositionEventCount(), beforeCompositionRetry);
    const failedCompositionVersionId = createPrefixedId("vvr");
    await database.db.insert(videoVersions).values({
      id: failedCompositionVersionId,
      workspaceId,
      projectId,
      productionRunId: firstRunId,
      storyboardRevisionId: completed.id,
      status: "FAILED",
      assetId: null,
      durationMs: null,
      qcReportId: null,
      createdAt: new Date().toISOString(),
    });
    await database.db.update(eventConsumptions).set({ completedAt: null, deadLetteredAt: null, attempts: 3, lastError: "QC_FAILED", leaseOwner: null, leaseExpiresAt: null })
      .where(consumptionScope);
    await database.db.update(productionRuns).set({ status: "REVIEWING" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, firstRunId)));
    const retryAfterDeadLetter = await production.retryProductionComposition({
      scope: `${scope}:retry-composition-existing`,
      idempotencyKey: "retry-composition-existing-after-dead-letter",
      requestHash: fingerprintRequest({ retry: "after-dead-letter" }),
      workspaceId,
      productionRunId: firstRunId,
      event: eventMetadata(),
    });
    assert.equal(retryAfterDeadLetter.kind, "NEW");
    assert.equal(await retryCompositionEventCount(), beforeCompositionRetry + 1);
    const [reconciledFailedConsumption] = await database.db.select({ deadLetteredAt: eventConsumptions.deadLetteredAt })
      .from(eventConsumptions).where(consumptionScope);
    assert.ok(reconciledFailedConsumption?.deadLetteredAt, "a terminal failed video plus an exhausted unleased consumption must be reconciled as dead-lettered");
    const retryWhileReplacementOutstanding = await production.retryProductionComposition({
      scope: `${scope}:retry-composition-existing`,
      idempotencyKey: "retry-composition-while-replacement-outstanding",
      requestHash: fingerprintRequest({ retry: "while-replacement-outstanding" }),
      workspaceId,
      productionRunId: firstRunId,
      event: eventMetadata(),
    });
    assert.equal(retryWhileReplacementOutstanding.kind, "STATE_INVALID");
    assert.equal(await retryCompositionEventCount(), beforeCompositionRetry + 1);

    // The retry command deliberately reopens the run for composition review.
    // Close that fixture before creating the independent failure run below so
    // the active-production-run guard is not testing an unrelated conflict.
    await database.db.update(productionRuns).set({ status: "SUCCEEDED" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, firstRunId)));

    const noHistoryRunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `${scope}:production:composition-review-without-history`,
      idempotencyKey: "production-composition-review-without-history",
      requestHash: fingerprintRequest({ composition_review_without_history: true }),
      workspaceId,
      projectId,
      productionRunId: noHistoryRunId,
      storyboardRevisionId: completed.id,
      event: eventMetadata(),
    })).kind, "NEW");
    const noHistoryConfirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (event) => event.event_type === "production_run.confirmed" && event.data.production_run_id === noHistoryRunId,
    });
    assert.equal(noHistoryConfirmed.event_type, "production_run.confirmed");
    if (noHistoryConfirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: noHistoryConfirmed, now: new Date() });
    const noHistorySegments = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, noHistoryRunId)))
      .orderBy(asc(productionSegments.sequence));
    assert.equal(noHistorySegments.length, firstRunSegments.length);
    for (const [index, segment] of noHistorySegments.entries()) {
      const priorTaskRunId = firstRunSegments[index]?.taskRunId;
      assert.ok(priorTaskRunId);
      await database.db.update(productionSegments).set({ status: "ACCEPTED", retryable: false, taskRunId: priorTaskRunId })
        .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, segment.id)));
    }
    await database.db.update(productionRuns).set({ status: "REVIEWING" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, noHistoryRunId)));
    const noHistoryCompositionRetry = await production.retryProductionComposition({
      scope: `${scope}:retry-composition-without-history`,
      idempotencyKey: "retry-composition-without-history",
      requestHash: fingerprintRequest({ retry: "without-history" }),
      workspaceId,
      productionRunId: noHistoryRunId,
      event: eventMetadata(),
    });
    assert.equal(noHistoryCompositionRetry.kind, "STATE_INVALID");
    assert.equal((await database.db.select().from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.aggregateType, "production_run"),
      eq(outboxEvents.aggregateId, noHistoryRunId),
      eq(outboxEvents.eventType, "video_version.composition_requested"),
    ))).length, 0);
    await database.db.update(productionRuns).set({ status: "SUCCEEDED" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, noHistoryRunId)));

    const failedRunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `${scope}:production:failure`,
      idempotencyKey: "production-failure",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id, failure: true }),
      workspaceId,
      projectId,
      productionRunId: failedRunId,
      storyboardRevisionId: completed.id,
      event: eventMetadata(),
    })).kind, "NEW");
    const failedConfirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (event) => event.event_type === "production_run.confirmed" && event.data.production_run_id === failedRunId,
    });
    assert.equal(failedConfirmed.event_type, "production_run.confirmed");
    if (failedConfirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: failedConfirmed, now: new Date() });
    const [failedSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, failedRunId), eq(productionSegments.sequence, 1)));
    assert.ok(failedSegment?.taskRunId);
    const [failedTaskBeforeRetry] = await database.db.select().from(taskRuns)
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.id, failedSegment.taskRunId!)));
    const uncertainAttemptId = createPrefixedId("att");
    await database.db.insert(providerAttempts).values({
      id: uncertainAttemptId, workspaceId, taskRunId: failedSegment.taskRunId!, provider: "mock", model: "mock-video-v1",
      status: "FAILED", submissionReservedAt: new Date().toISOString(),
    });
    const uncertainFailure = taskFailedEvent({ workspaceId, projectId, taskRunId: failedSegment.taskRunId!, retryable: false });
    uncertainFailure.data.error_code = "PROVIDER_REJECTED";
    await production.recordProductionTaskFailed({ event: uncertainFailure, now: new Date() });
    const [uncertainSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment.id)));
    assert.equal(uncertainSegment?.retryable, false, "an unknown submission must not become retryable through PROVIDER_REJECTED projection");
    // Historical/externally repaired segment flags cannot bypass the durable
    // reservation by creating a new TaskRun through segment retry.
    await database.db.update(productionSegments).set({ retryable: true })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment.id)));
    const blockedUnknownRetry = await production.retryProductionSegment({
      scope: `${scope}:retry-segment`, idempotencyKey: "retry-unknown-submission", requestHash: fingerprintRequest({}),
      workspaceId, productionRunId: failedRunId, sequence: 1, event: eventMetadata(),
    });
    assert.equal(blockedUnknownRetry.kind, "STATE_INVALID");
    assert.equal((await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment.id))))[0]?.taskRunId, failedSegment.taskRunId);
    await database.db.update(productionSegments).set({ retryable: false })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment.id)));
    await database.db.update(providerAttempts).set({ providerRequestId: `reconciled-${uncertainAttemptId}` })
      .where(and(eq(providerAttempts.workspaceId, workspaceId), eq(providerAttempts.id, uncertainAttemptId)));
    const blockedLateIdRetry = await production.retryProductionSegment({
      scope: `${scope}:retry-segment`, idempotencyKey: "retry-late-request-id", requestHash: fingerprintRequest({}),
      workspaceId, productionRunId: failedRunId, sequence: 1, event: eventMetadata(),
    });
    assert.equal(blockedLateIdRetry.kind, "STATE_INVALID", "a late ID does not authorize fresh generation; ordinary task retry resumes polling");
    await database.db.update(productionSegments).set({ retryable: true })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment.id)));
    for (const status of ["FAILED", "ABANDONED"] as const) {
      await database.db.update(providerAttempts).set({ status, responsePayload: { code: "PROVIDER_REJECTED", provider_request_terminal: "true" } })
        .where(and(eq(providerAttempts.workspaceId, workspaceId), eq(providerAttempts.id, uncertainAttemptId)));
      const staleFlagRetry = await production.retryProductionSegment({
        scope: `${scope}:retry-segment`, idempotencyKey: `retry-unproven-${status}`, requestHash: fingerprintRequest({}),
        workspaceId, productionRunId: failedRunId, sequence: 1, event: eventMetadata(),
      });
      assert.equal(staleFlagRetry.kind, "STATE_INVALID", "stale segment flags and unproven ABANDONED rows cannot authorize another POST");
    }
    // Continue the existing fresh-generation fixture only after an explicit
    // terminal Provider rejection, not merely after learning a late request ID.
    await database.db.update(taskRuns).set({ status: "FAILED", error: { code: "PROVIDER_REJECTED", message: "Synthetic terminal rejection.", retryable: false } })
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.id, failedSegment.taskRunId!)));
    await database.db.update(providerAttempts).set({ status: "FAILED", responsePayload: { code: "PROVIDER_REJECTED", provider_request_terminal: true } })
      .where(and(eq(providerAttempts.workspaceId, workspaceId), eq(providerAttempts.id, uncertainAttemptId)));
    await database.db.update(productionSegments).set({ retryable: true })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment.id)));
    for (const status of ["QUEUED", "RUNNING"] as const) {
      await database.db.update(taskRuns).set({ status }).where(eq(taskRuns.id, failedSegment.taskRunId!));
      const alreadyActive = await production.retryProductionSegment({
        scope: `${scope}:retry-segment`, idempotencyKey: `retry-active-${status}`, requestHash: fingerprintRequest({}),
        workspaceId, productionRunId: failedRunId, sequence: 1, event: eventMetadata(),
      });
      assert.equal(alreadyActive.kind, "STATE_INVALID");
    }
    await database.db.update(taskRuns).set({ status: "FAILED" }).where(eq(taskRuns.id, failedSegment.taskRunId!));

    // Hold the exact lock used by ordinary TaskRun retry while its QUEUED
    // transition is uncommitted. Segment retry must wait, then see QUEUED.
    const { Client } = await import("pg");
    const retryTransaction = new Client({ connectionString: databaseUrl });
    await retryTransaction.connect();
    let concurrentSegmentRetry: ReturnType<typeof production.retryProductionSegment> | undefined;
    try {
      await retryTransaction.query("BEGIN");
      const lockKey = `${workspaceId}:${failedSegment.taskRunId}`;
      await retryTransaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      await retryTransaction.query("UPDATE task_runs SET status = 'QUEUED' WHERE workspace_id = $1 AND id = $2", [workspaceId, failedSegment.taskRunId]);
      concurrentSegmentRetry = production.retryProductionSegment({
        scope: `${scope}:retry-segment`, idempotencyKey: "retry-concurrent-task", requestHash: fingerprintRequest({}),
        workspaceId, productionRunId: failedRunId, sequence: 1, event: eventMetadata(),
      });
      let waiting = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const locks = await retryTransaction.query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext($1)::bigint & 4294967295)", [lockKey]);
        if (locks.rowCount) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, "segment retry must contend on the same TaskRun advisory lock");
      await retryTransaction.query("COMMIT");
      assert.equal((await concurrentSegmentRetry).kind, "STATE_INVALID");
    } finally {
      await retryTransaction.query("ROLLBACK");
      await retryTransaction.end();
      await concurrentSegmentRetry;
    }
    await database.db.update(taskRuns).set({ status: "FAILED" }).where(eq(taskRuns.id, failedSegment.taskRunId!));
    const retried = await production.retryProductionSegment({
      scope: `${scope}:retry-segment`,
      idempotencyKey: "retry-first-segment",
      requestHash: fingerprintRequest({}),
      workspaceId,
      productionRunId: failedRunId,
      sequence: 1,
      event: eventMetadata(),
    });
    assert.equal(retried.kind, "NEW");
    assert.equal(retried.kind === "NEW" ? retried.value.productionRun.status : undefined, "GENERATING");
    const replayed = await production.retryProductionSegment({
      scope: `${scope}:retry-segment`,
      idempotencyKey: "retry-first-segment",
      requestHash: fingerprintRequest({}),
      workspaceId,
      productionRunId: failedRunId,
      sequence: 1,
      event: eventMetadata(),
    });
    assert.equal(replayed.kind, "REPLAY");
    const [retriedSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment!.id)));
    assert.ok(retriedSegment?.taskRunId);
    assert.notEqual(retriedSegment?.taskRunId, failedSegment?.taskRunId);
    const [failedTaskAfterRetry] = await database.db.select().from(taskRuns)
      .where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.id, failedSegment!.taskRunId!)));
    assert.deepEqual(failedTaskAfterRetry?.inputSnapshot, failedTaskBeforeRetry?.inputSnapshot);
    const failedAssetId = await generatedAsset(database.db, { workspaceId, projectId, taskRunId: retriedSegment!.taskRunId! });
    await production.recordProductionTaskSucceeded({ event: taskSucceededEvent({ workspaceId, projectId, taskRunId: retriedSegment!.taskRunId!, assetId: failedAssetId }), now: new Date() });
    const failedQcEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === retriedSegment.taskRunId,
    });
    await production.failMediaRuntimeEvent({
      eventId: failedQcEvent.event_id,
      workspaceId,
      errorCode: "QC_FAILED",
      retryable: false,
      now: new Date(),
    });
    const [failedRun] = await database.db.select().from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, failedRunId)));
    assert.equal(failedRun?.status, "BLOCKED");
    const [failedQcSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, failedSegment!.id)));
    assert.equal(failedQcSegment?.status, "FAILED");
    assert.equal(failedQcSegment?.retryable, false);
    assert.equal((await database.db.select().from(qcReports).where(and(eq(qcReports.workspaceId, workspaceId), eq(qcReports.subjectId, failedSegment!.id)))).at(-1)?.status, "FAILED");

    const legacyRunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `${scope}:production:legacy-retry-reconcile`,
      idempotencyKey: "production-legacy-retry-reconcile",
      requestHash: fingerprintRequest({ legacy: true }),
      workspaceId,
      projectId,
      productionRunId: legacyRunId,
      storyboardRevisionId: completed.id,
      event: eventMetadata(),
    })).kind, "NEW");
    const legacyConfirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (event) => event.event_type === "production_run.confirmed" && event.data.production_run_id === legacyRunId,
    });
    assert.equal(legacyConfirmed.event_type, "production_run.confirmed");
    if (legacyConfirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: legacyConfirmed, now: new Date() });
    const [legacySegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, legacyRunId), eq(productionSegments.sequence, 1)));
    assert.ok(legacySegment?.taskRunId);
    await production.recordProductionTaskFailed({ event: taskFailedEvent({ workspaceId, projectId, taskRunId: legacySegment.taskRunId!, retryable: false }), now: new Date() });
    const legacyAssetId = await generatedAsset(database.db, { workspaceId, projectId, taskRunId: legacySegment.taskRunId! });
    await production.recordProductionTaskSucceeded({ event: taskSucceededEvent({ workspaceId, projectId, taskRunId: legacySegment.taskRunId!, assetId: legacyAssetId }), now: new Date() });
    const [reconciledRun] = await database.db.select().from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, legacyRunId)));
    const [reconciledSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, legacySegment!.id)));
    assert.equal(reconciledRun?.status, "GENERATING");
    assert.equal(reconciledSegment?.status, "CHECKING");
    assert.equal(reconciledSegment?.retryable, false);
    const legacyQcEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === legacySegment.taskRunId,
    });
    assert.ok(legacyQcEvent);
    const completedAttemptId = createPrefixedId("att");
    await database.db.insert(providerAttempts).values({
      id: completedAttemptId, workspaceId, taskRunId: legacySegment.taskRunId!, provider: "mock", model: "mock-video-v1",
      status: "SUCCEEDED", providerRequestId: `completed-${completedAttemptId}`,
    });
    await database.db.update(assets).set({ metadata: { fixture: "c12", task_run_id: legacySegment.taskRunId } }).where(eq(assets.id, legacyAssetId));
    await production.failMediaRuntimeEvent({ eventId: legacyQcEvent.event_id, workspaceId, errorCode: "QC_FAILED", retryable: true, now: new Date() });
    const retryCompleted = (idempotencyKey: string) => production.retryProductionSegment({
      scope: `${scope}:retry-completed-segment`, idempotencyKey, requestHash: fingerprintRequest({}),
      workspaceId, productionRunId: legacyRunId, sequence: 1, event: eventMetadata(),
    });
    await database.db.update(assets).set({ status: "PENDING_UPLOAD" }).where(eq(assets.id, legacyAssetId));
    assert.equal((await retryCompleted("unverified-result")).kind, "STATE_INVALID");
    await database.db.update(assets).set({ status: "READY" }).where(eq(assets.id, legacyAssetId));
    await database.db.update(taskRuns).set({ status: "BILLING_PENDING", resultAssetId: null }).where(eq(taskRuns.id, legacySegment.taskRunId!));
    assert.equal((await retryCompleted("unpaid-result")).kind, "STATE_INVALID");
    await database.db.update(taskRuns).set({ status: "SUCCEEDED", resultAssetId: legacyAssetId }).where(eq(taskRuns.id, legacySegment.taskRunId!));
    await database.db.update(providerAttempts).set({ status: "PROCESSING" }).where(eq(providerAttempts.id, completedAttemptId));
    assert.equal((await retryCompleted("unresolved-attempt")).kind, "STATE_INVALID");
    await database.db.update(providerAttempts).set({ status: "SUCCEEDED" }).where(eq(providerAttempts.id, completedAttemptId));
    assert.equal((await retryCompleted("completed-media-retry")).kind, "NEW", "verified successful video may be explicitly regenerated after recoverable QC failure");
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C12 persists terminal media dead-letter after a retry releases its lease", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const userId = createPrefixedId("usr");
  const releasedEventId = createPrefixedId("evt");
  const ownedEventId = createPrefixedId("evt");
  const database = createDatabase(databaseUrl);
  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const production = new DrizzleProductionRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C12 terminal dead-letter" }, workspace: { id: workspaceId, name: "C12 terminal dead-letter" } });
    assert.equal((await control.createProject({
      scope: `c12-terminal-dead-letter:${projectId}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ projectId }),
      workspaceId,
      projectId,
      name: "C12 terminal dead-letter",
    })).kind, "NEW");
    const now = new Date();
    await database.db.insert(outboxEvents).values([releasedEventId, ownedEventId].map((eventId) => ({
      id: eventId,
      workspaceId,
      projectId,
      aggregateType: "production_run",
      aggregateId: createPrefixedId("prd"),
      eventType: "video_version.composition_requested",
      payload: { event_id: eventId },
      occurredAt: now.toISOString(),
      publishedAt: now.toISOString(),
      publishAttempts: 1,
    })));
    await database.db.insert(eventConsumptions).values([
      { workspaceId, eventId: releasedEventId, consumerName: "media-runtime-transition", attempts: 3, lastError: "QC_FAILED" },
      { workspaceId, eventId: ownedEventId, consumerName: "media-runtime-transition", leaseOwner: "another-worker", leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(), attempts: 2 },
    ]);
    await production.releaseMediaRuntimeEvent({
      eventId: releasedEventId,
      workspaceId,
      consumerName: "media-runtime-transition",
      workerId: "local-production-worker",
      reason: "QC_FAILED",
      deadLetter: true,
      now,
    });
    const [releasedDeadLetter] = await database.db.select({ deadLetteredAt: eventConsumptions.deadLetteredAt, leaseOwner: eventConsumptions.leaseOwner })
      .from(eventConsumptions).where(and(eq(eventConsumptions.workspaceId, workspaceId), eq(eventConsumptions.eventId, releasedEventId)));
    assert.ok(releasedDeadLetter?.deadLetteredAt);
    assert.equal(releasedDeadLetter?.leaseOwner, null);
    await production.releaseMediaRuntimeEvent({
      eventId: ownedEventId,
      workspaceId,
      consumerName: "media-runtime-transition",
      workerId: "local-production-worker",
      reason: "QC_FAILED",
      deadLetter: true,
      now,
    });
    const [unownedDeadLetter] = await database.db.select({ deadLetteredAt: eventConsumptions.deadLetteredAt, leaseOwner: eventConsumptions.leaseOwner })
      .from(eventConsumptions).where(and(eq(eventConsumptions.workspaceId, workspaceId), eq(eventConsumptions.eventId, ownedEventId)));
    assert.equal(unownedDeadLetter?.deadLetteredAt, null);
    assert.equal(unownedDeadLetter?.leaseOwner, "another-worker");
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C12 composition retry reconciles a failed video with an exhausted unleased event", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const userId = createPrefixedId("usr");
  const briefId = createPrefixedId("cbr");
  const database = createDatabase(databaseUrl);
  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    const production = new DrizzleProductionRepository(database.db, (input) => VideoGenerationInputSnapshotSchema.parse({
      model: "c12-recovery-test",
      prompt: input.prompt,
      duration: input.duration,
      resolution: input.resolution,
      ratio: input.ratio,
      reference_asset_ids: input.referenceAssetIds,
      generation_segment_sequence: input.generationSegmentSequence,
      narrative_beat_sequences: input.narrativeBeatSequences,
      visual_input: input.visualInput,
    }));
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C12 composition recovery" }, workspace: { id: workspaceId, name: "C12 composition recovery" } });
    assert.equal((await control.createProject({
      scope: `c12-composition-recovery:${projectId}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ projectId }),
      workspaceId,
      projectId,
      name: "C12 composition recovery",
    })).kind, "NEW");
    assert.equal((await planning.createCreativeBriefRevision({
      scope: `c12-composition-recovery:${projectId}:brief`,
      idempotencyKey: "brief",
      requestHash: fingerprintRequest({ briefId }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText: "测试成片恢复",
      targetDurationSeconds: 15,
      targetResolution: "480p",
      stylePreferences: "",
      sourceAssetIds: [],
      event: eventMetadata(),
    })).kind, "NEW");
    assert.equal((await planning.requestCreativePlan({
      scope: `c12-composition-recovery:${projectId}:planning`,
      idempotencyKey: "planning",
      requestHash: fingerprintRequest({ planning: true }),
      workspaceId,
      creativeBriefRevisionId: briefId,
      event: eventMetadata(),
    })).kind, "NEW");
    const storyboardId = createPrefixedId("sbr");
    const shotSpecId = createPrefixedId("shs");
    const completed = await planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: briefId,
      draft: {
        scriptRevisionId: createPrefixedId("scr"),
        storyboardRevisionId: storyboardId,
        beats: [{ sequence: 1, title: "测试", summary: "测试", narrative_goal: "测试", visible_facts: ["测试"] }],
        title: "测试成片恢复",
        summary: "测试成片恢复",
        totalDurationSeconds: 15,
        continuityLevel: "STANDARD",
        continuityNote: "单镜头测试",
        shotSpecs: [{ id: shotSpecId, sequence: 1, title: "测试镜头", durationSeconds: 15, narrativeGoal: "测试", startState: "开始", endState: "结束", transitionSummary: "无转场", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "单镜头" }],
        promptPackages: [{ id: createPrefixedId("ppk"), shotSpecId, compilerVersion: "c12-recovery-test", prompt: "测试", visualConstraints: {}, referenceMap: { reference_policy: "TEXT_TRANSITION" }, capabilitySnapshot: { max_duration_seconds: 15, source_prompt: "测试", generated_prompt_parts: [], audio_owner: "LEGACY_PRESERVE" } }],
      },
      event: eventMetadata(),
    });
    assert.ok(completed);
    if (!completed) return;
    assert.equal((await planning.approveStoryboardRevision({
      scope: `c12-composition-recovery:${projectId}:approve`,
      idempotencyKey: "approve",
      requestHash: fingerprintRequest({ approve: true }),
      workspaceId,
      storyboardRevisionId: completed.id,
      event: eventMetadata(),
    })).kind, "NEW");
    const productionRunId = createPrefixedId("prd");
    assert.equal((await planning.createProductionRun({
      scope: `c12-composition-recovery:${projectId}:run`,
      idempotencyKey: "run",
      requestHash: fingerprintRequest({ storyboardId }),
      workspaceId,
      projectId,
      productionRunId,
      storyboardRevisionId: completed.id,
      musicPlan: { mode: "OFF" },
      event: eventMetadata(),
    })).kind, "NEW");
    const confirmed = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.confirmed",
      predicate: (event) => event.event_type === "production_run.confirmed" && event.data.production_run_id === productionRunId,
    });
    assert.equal(confirmed.event_type, "production_run.confirmed");
    if (confirmed.event_type !== "production_run.confirmed") return;
    await production.initializeProductionRun({ event: confirmed, now: new Date() });
    const [segment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, productionRunId)));
    assert.ok(segment?.taskRunId);
    await database.db.update(productionSegments).set({ status: "ACCEPTED", retryable: false })
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.id, segment!.id)));
    await database.db.update(productionRuns).set({ status: "REVIEWING" })
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, productionRunId)));
    const compositionEventId = createPrefixedId("evt");
    await database.db.insert(outboxEvents).values({
      id: compositionEventId,
      workspaceId,
      projectId,
      aggregateType: "production_run",
      aggregateId: productionRunId,
      eventType: "video_version.composition_requested",
      payload: { event_id: compositionEventId },
      occurredAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      publishAttempts: 1,
    });
    await database.db.insert(eventConsumptions).values({
      workspaceId,
      eventId: compositionEventId,
      consumerName: "media-runtime-transition",
      attempts: 3,
      lastError: "QC_FAILED",
    });
    const failedVideoVersionId = createPrefixedId("vvr");
    const failedVideoVersion = {
      id: failedVideoVersionId,
      workspaceId,
      projectId,
      productionRunId,
      storyboardRevisionId: storyboardId,
      status: "FAILED",
      assetId: null,
      durationMs: null,
      qcReportId: null,
    } as const;
    await database.db.insert(videoVersions).values(failedVideoVersion);
    const assertRecoveryBlocked = async (caseName: string) => {
      const blocked = await production.retryProductionComposition({
        scope: `c12-composition-recovery:${projectId}:retry:${caseName}`,
        idempotencyKey: `retry-${caseName}`,
        requestHash: fingerprintRequest({ retry: caseName }),
        workspaceId,
        productionRunId,
        event: eventMetadata(),
      });
      assert.equal(blocked.kind, "STATE_INVALID", `${caseName} must fail closed`);
      const events = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
        eq(outboxEvents.workspaceId, workspaceId),
        eq(outboxEvents.aggregateId, productionRunId),
        eq(outboxEvents.eventType, "video_version.composition_requested"),
      ));
      assert.equal(events.length, 1, `${caseName} must not enqueue another composition`);
    };
    const resetConsumption = async (values: Partial<typeof eventConsumptions.$inferInsert>) => {
      await database.db.update(eventConsumptions).set({
        attempts: 3,
        lastError: "QC_FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        ...values,
      }).where(and(eq(eventConsumptions.workspaceId, workspaceId), eq(eventConsumptions.eventId, compositionEventId)));
    };

    await resetConsumption({ attempts: 2 });
    await assertRecoveryBlocked("attempts-below-threshold");
    await resetConsumption({ lastError: "   " });
    await assertRecoveryBlocked("empty-error");
    await resetConsumption({ leaseOwner: "another-worker", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    await assertRecoveryBlocked("active-lease");
    await resetConsumption({});
    await database.db.delete(videoVersions).where(and(eq(videoVersions.workspaceId, workspaceId), eq(videoVersions.id, failedVideoVersionId)));
    await assertRecoveryBlocked("missing-failed-version");
    await database.db.insert(videoVersions).values(failedVideoVersion);
    const duplicateFailedVideoVersionId = createPrefixedId("vvr");
    await database.db.insert(videoVersions).values({ ...failedVideoVersion, id: duplicateFailedVideoVersionId });
    await assertRecoveryBlocked("duplicate-failed-version");
    await database.db.delete(videoVersions).where(and(eq(videoVersions.workspaceId, workspaceId), eq(videoVersions.id, duplicateFailedVideoVersionId)));
    const recovered = await production.retryProductionComposition({
      scope: `c12-composition-recovery:${projectId}:retry`,
      idempotencyKey: "retry",
      requestHash: fingerprintRequest({ retry: true }),
      workspaceId,
      productionRunId,
      event: eventMetadata(),
    });
    assert.equal(recovered.kind, "NEW");
    const [consumption] = await database.db.select({ deadLetteredAt: eventConsumptions.deadLetteredAt })
      .from(eventConsumptions).where(and(eq(eventConsumptions.workspaceId, workspaceId), eq(eventConsumptions.eventId, compositionEventId)));
    assert.ok(consumption?.deadLetteredAt);
    const compositionEvents = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.aggregateId, productionRunId),
      eq(outboxEvents.eventType, "video_version.composition_requested"),
    ));
    assert.equal(compositionEvents.length, 2);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("E11 persists source narration duration feedback idempotently", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const userId = createPrefixedId("usr");
  const productionRunId = createPrefixedId("prd");
  const eventId = createPrefixedId("evt");
  const database = createDatabase(databaseUrl);
  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const production = new DrizzleProductionRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "E11 duration feedback" }, workspace: { id: workspaceId, name: "E11 duration feedback" } });
    assert.equal((await control.createProject({
      scope: `e11-feedback:${projectId}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ projectId }),
      workspaceId,
      projectId,
      name: "E11 duration feedback",
    })).kind, "NEW");
    const feedback = {
      narration_durations: [{ section_id: "section-1", planned_duration_seconds: 20, actual_duration_seconds: 20.5 }],
      total_narration_seconds: 20.5,
      decision: "ADJUST_SCENE_PLAN" as const,
      decision_reason: "WITHIN_25_PERCENT" as const,
    };
    const input = { eventId, workspaceId, projectId, productionRunId, feedback, now: new Date() };
    await production.recordNarrationDurationFeedback(input);
    await production.recordNarrationDurationFeedback(input);
    await assert.rejects(
      production.recordNarrationDurationFeedback({ ...input, productionRunId: createPrefixedId("prd") }),
      /idempotency conflict/,
    );
    const rows = await database.db.select().from(creativeDecisionLogs)
      .where(and(eq(creativeDecisionLogs.workspaceId, workspaceId), eq(creativeDecisionLogs.projectId, projectId)));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, narrationDurationFeedbackLogId(eventId));
    assert.deepEqual(rows[0]?.metadata, feedback);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C12 blocks an idle reference-dependent run before it can hold source assets hostage", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const userId = createPrefixedId("usr");
  const briefId = createPrefixedId("cbr");
  const scriptId = createPrefixedId("scr");
  const storyboardId = createPrefixedId("sbr");
  const shotSpecId = createPrefixedId("ssp");
  const productionRunId = createPrefixedId("prd");
  const assetId = createPrefixedId("ast");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const production = new DrizzleProductionRepository(database.db);
    const assetStore = new DrizzleAssetWorkspaceRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C12 idle run" }, workspace: { id: workspaceId, name: "C12 idle run" } });
    assert.equal((await control.createProject({
      scope: `c12-idle:${projectId}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ projectId }),
      workspaceId,
      projectId,
      name: "C12 idle reference cleanup",
    })).kind, "NEW");

    const now = new Date().toISOString();
    await database.db.insert(assets).values({
      id: assetId,
      workspaceId,
      projectId,
      kind: "IMAGE",
      origin: "USER_UPLOAD",
      status: "READY",
      objectKey: `${workspaceId}/${projectId}/${assetId}/reference.png`,
      sha256: "e".repeat(64),
      mimeType: "image/png",
      byteSize: 512,
      metadata: { filename: "stale-reference.png" },
    });
    await database.db.insert(creativeBriefRevisions).values({
      id: briefId,
      workspaceId,
      projectId,
      revision: 1,
      sourceText: "一段需要参考图分析的宣传片。",
      targetDurationSeconds: 15,
      targetResolution: "480p",
      stylePreferences: "",
      sourceAssetIds: [assetId],
      status: "APPROVED",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(scriptRevisions).values({
      id: scriptId,
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      revision: 1,
      beats: [],
      status: "APPROVED",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(storyboardRevisions).values({
      id: storyboardId,
      workspaceId,
      projectId,
      scriptRevisionId: scriptId,
      revision: 1,
      title: "需要参考图分析",
      summary: "等待参考图分析后再生成。",
      totalDurationSeconds: 15,
      continuityLevel: "STANDARD",
      continuityNote: "",
      status: "APPROVED",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(storyboardShotSpecs).values({
      id: shotSpecId,
      workspaceId,
      projectId,
      storyboardRevisionId: storyboardId,
      sequence: 1,
      title: "等待分析",
      durationSeconds: 15,
      narrativeGoal: "等待参考图分析",
      startState: "未开始",
      endState: "未开始",
      transitionSummary: "",
      referencePolicy: "REFERENCE_SET",
      dependsOnSequences: [],
      narrativeBeatSequences: [1],
      continuityNote: "",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(promptPackages).values({
      id: createPrefixedId("ppk"),
      workspaceId,
      projectId,
      shotSpecId,
      compilerVersion: "c12-idle-test",
      prompt: "等待参考图分析后生成。",
      visualConstraints: {},
      referenceMap: { reference_policy: "REFERENCE_SET" },
      capabilitySnapshot: {},
      createdAt: now,
    });
    await database.db.insert(productionRuns).values({
      id: productionRunId,
      workspaceId,
      projectId,
      storyboardRevisionId: storyboardId,
      status: "CONFIRMED",
      totalShotCount: 1,
      acceptedShotCount: 0,
      totalDurationSeconds: 15,
      createdAt: now,
      updatedAt: now,
    });

    const confirmed = InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      message_id: createPrefixedId("msg"),
      event_id: createPrefixedId("evt"),
      event_type: "production_run.confirmed",
      occurred_at: now,
      trace_id: createPrefixedId("trc"),
      correlation_id: createPrefixedId("cor"),
      idempotency_key: `c12-idle:${productionRunId}`,
      producer: "production-test",
      workspace_id: workspaceId,
      project_id: projectId,
      aggregate: { type: "production_run", id: productionRunId },
      data: { production_run_id: productionRunId, storyboard_revision_id: storyboardId, total_shot_count: 1 },
      version: 1,
    });
    const progress = await production.initializeProductionRun({ event: confirmed, now: new Date(now) });
    assert.equal(progress?.productionRun.status, "BLOCKED");
    assert.deepEqual(progress?.segments.map((segment) => segment.status), ["WAITING"]);
    assert.equal((await database.db.select().from(taskRuns).where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.projectId, projectId)))).length, 0);

    const deleted = await assetStore.deleteAsset({
      scope: `c12-idle:${projectId}:delete`,
      idempotencyKey: "delete-reference",
      requestHash: fingerprintRequest({}),
      workspaceId,
      assetId,
    });
    assert.equal(deleted.kind, "NEW");
    if (deleted.kind === "NEW") assert.equal(deleted.value.status, "DELETED");
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C12 surfaces a prompt-budget preflight failure instead of leaving the run confirmed", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const userId = createPrefixedId("usr");
  const briefId = createPrefixedId("cbr");
  const scriptId = createPrefixedId("scr");
  const storyboardId = createPrefixedId("sbr");
  const shotSpecId = createPrefixedId("ssp");
  const productionRunId = createPrefixedId("prd");
  const database = createDatabase(databaseUrl);
  const now = new Date().toISOString();
  const production = new DrizzleProductionRepository(database.db, () => {
    const error = new Error("The video prompt cannot fit the configured provider prompt limit after source-aligned compaction.");
    error.name = "UnsupportedVideoGenerationInputError";
    (error as Error & { code: string }).code = "PROMPT_BUDGET";
    throw error;
  });

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C12 prompt budget" }, workspace: { id: workspaceId, name: "C12 prompt budget" } });
    assert.equal((await control.createProject({
      scope: `c12-prompt-budget:${projectId}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ projectId }),
      workspaceId,
      projectId,
      name: "C12 prompt budget",
    })).kind, "NEW");

    await database.db.insert(creativeBriefRevisions).values({
      id: briefId,
      workspaceId,
      projectId,
      revision: 1,
      sourceText: "一段超过 Provider 输入预算的宣传片。",
      targetDurationSeconds: 15,
      targetResolution: "480p",
      stylePreferences: "",
      sourceAssetIds: [],
      status: "APPROVED",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(scriptRevisions).values({
      id: scriptId,
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      revision: 1,
      beats: [],
      status: "APPROVED",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(storyboardRevisions).values({
      id: storyboardId,
      workspaceId,
      projectId,
      scriptRevisionId: scriptId,
      revision: 1,
      title: "提示词超限",
      summary: "压缩后仍超过 Provider 输入上限。",
      totalDurationSeconds: 15,
      continuityLevel: "STANDARD",
      continuityNote: "",
      status: "APPROVED",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(storyboardShotSpecs).values({
      id: shotSpecId,
      workspaceId,
      projectId,
      storyboardRevisionId: storyboardId,
      sequence: 1,
      title: "提示词超限片段",
      durationSeconds: 15,
      narrativeGoal: "验证输入预算失败收口",
      startState: "开始",
      endState: "结束",
      transitionSummary: "",
      referencePolicy: "TEXT_TRANSITION",
      dependsOnSequences: [],
      narrativeBeatSequences: [1],
      continuityNote: "",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(promptPackages).values({
      id: createPrefixedId("ppk"),
      workspaceId,
      projectId,
      shotSpecId,
      compilerVersion: "c12-prompt-budget-test",
      prompt: "故意由快照工厂拒绝的超长提示词。",
      visualConstraints: {},
      referenceMap: { reference_policy: "TEXT_TRANSITION" },
      capabilitySnapshot: {},
      createdAt: now,
    });
    await database.db.insert(productionRuns).values({
      id: productionRunId,
      workspaceId,
      projectId,
      storyboardRevisionId: storyboardId,
      status: "CONFIRMED",
      totalShotCount: 1,
      acceptedShotCount: 0,
      totalDurationSeconds: 15,
      createdAt: now,
      updatedAt: now,
    });

    const confirmed = InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      message_id: createPrefixedId("msg"),
      event_id: createPrefixedId("evt"),
      event_type: "production_run.confirmed",
      occurred_at: now,
      trace_id: createPrefixedId("trc"),
      correlation_id: createPrefixedId("cor"),
      idempotency_key: `c12-prompt-budget:${productionRunId}`,
      producer: "production-test",
      workspace_id: workspaceId,
      project_id: projectId,
      aggregate: { type: "production_run", id: productionRunId },
      data: { production_run_id: productionRunId, storyboard_revision_id: storyboardId, total_shot_count: 1 },
      version: 1,
    });
    assert.equal(confirmed.event_type, "production_run.confirmed");
    const progress = await production.initializeProductionRun({ event: confirmed, now: new Date(now) });
    assert.equal(progress?.productionRun.status, "BLOCKED");
    assert.equal(progress?.segments.length, 1);
    assert.equal(progress?.segments[0]?.status, "FAILED");
    assert.equal(progress?.segments[0]?.retryable, false);
    assert.match(progress?.segments[0]?.safeSummary ?? "", /4096/);
    assert.equal((await database.db.select().from(taskRuns).where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.projectId, projectId)))).length, 0);
    const blocked = await readEvent(database.db, {
      workspaceId,
      eventType: "production_run.blocked",
      predicate: (event) => event.event_type === "production_run.blocked" && event.data.production_run_id === productionRunId,
    });
    assert.equal(blocked.event_type, "production_run.blocked");
    assert.equal(blocked.data.retryable, false);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
