import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import {
  InternalEventEnvelopeSchema,
  InternalMediaRuntimeQueueMessageSchema,
  type InternalEventEnvelope,
} from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { DrizzleCreativePlanningRepository } from "../src/creative-planning-repository.js";
import { createDatabase } from "../src/db.js";
import { DrizzleAssetWorkspaceRepository } from "../src/asset-workspace-repository.js";
import { DrizzleProductionRepository, narrationDurationFeedbackLogId } from "../src/production-repository.js";
import {
  assets,
  creativeBriefRevisions,
  creativeDecisionLogs,
  eventConsumptions,
  handoffReviews,
  outboxEvents,
  promptPackages,
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

test("C12 Drizzle production persists QC, handoff, dependency scheduling, composition, and terminal media failure", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

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
    const production = new DrizzleProductionRepository(database.db);
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

    const created = await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ source_text: "口播文案：团队在黎明前完成交付。\n视频生成意图描述：雨夜抵达工厂，团队完成交付。", target_duration_seconds: 30, target_resolution: "480p", source_asset_ids: [sourceImageAssetId] }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText: "口播文案：团队在黎明前完成交付。\n视频生成意图描述：雨夜抵达工厂，团队完成交付。",
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
          { id: createPrefixedId("ppk"), shotSpecId: firstShotSpecId, compilerVersion: "c12-integration", prompt: "雨夜抵达工厂，进入车间。", visualConstraints: {}, referenceMap: { reference_policy: "TEXT_TRANSITION" }, capabilitySnapshot: { max_duration_seconds: 15 } },
          { id: createPrefixedId("ppk"), shotSpecId: secondShotSpecId, compilerVersion: "c12-integration", prompt: "承接车间亮灯，团队在黎明完成交付。", visualConstraints: {}, referenceMap: { reference_policy: "HANDOFF_FIRST_FRAME" }, capabilitySnapshot: { max_duration_seconds: 15 } },
        ],
      },
      event: eventMetadata(),
    });
    assert.ok(completed);
    if (!completed) return;
    const persistedPromptPackages = await database.db.select().from(promptPackages)
      .where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.projectId, projectId)));
    assert.equal(persistedPromptPackages.length, 2);
    const approved = await planning.approveStoryboardRevision({
      scope: `${scope}:approve`,
      idempotencyKey: "approve",
      requestHash: fingerprintRequest({}),
      workspaceId,
      storyboardRevisionId: completed.id,
      event: eventMetadata(),
    });
    assert.equal(approved.kind, "NEW");

    const firstRunId = createPrefixedId("prd");
    const firstRun = await planning.createProductionRun({
      scope: `${scope}:production:success`,
      idempotencyKey: "production-success",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id }),
      workspaceId,
      projectId,
      productionRunId: firstRunId,
      storyboardRevisionId: completed.id,
      // The composition assertions below intentionally exercise the explicit
      // no-music path.  AUTO requires a READY server-owned MUSIC asset; this
      // fixture does not create one, so make the existing contract choice
      // explicit instead of relying on the production default.
      musicPlan: { mode: "OFF" },
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
    await production.initializeProductionRun({ event: confirmed, now: new Date() });
    let progress = await production.findProductionRunProgress(workspaceId, firstRunId);
    assert.equal(progress?.productionRun.status, "GENERATING");
    assert.deepEqual(progress?.segments.map((segment) => segment.status), ["GENERATING", "WAITING"]);

    const [firstSegment] = await database.db.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, firstRunId), eq(productionSegments.sequence, 1)));
    assert.ok(firstSegment?.taskRunId);

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

    const secondAssetId = await generatedAsset(database.db, { workspaceId, projectId, taskRunId: secondSegment.taskRunId! });
    await production.recordProductionTaskSucceeded({ event: taskSucceededEvent({ workspaceId, projectId, taskRunId: secondSegment.taskRunId!, assetId: secondAssetId }), now: new Date() });
    const secondQcEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === secondSegment.taskRunId,
    });
    assert.equal(secondQcEvent.event_type, "production_segment.qc_requested");
    if (secondQcEvent.event_type !== "production_segment.qc_requested") return;
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
        result: "BRIDGE_REQUIRED",
        reasonCodes: ["SCENE_DRIFT"],
        safeSummary: "相邻片段需要一段自然转场。",
        evaluatorVersion: "fixture-v1",
        retryable: false,
      },
      now: new Date(),
    });
    assert.equal((await database.db.select().from(handoffReviews).where(and(eq(handoffReviews.workspaceId, workspaceId), eq(handoffReviews.productionRunId, firstRunId)))).length, 1);
    assert.equal((await database.db.select().from(transitionRepairs).where(and(eq(transitionRepairs.workspaceId, workspaceId), eq(transitionRepairs.productionRunId, firstRunId)))).at(0)?.strategy, "BRIDGE");
    const compositionEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "video_version.composition_requested",
      predicate: (event) => event.event_type === "video_version.composition_requested" && event.data.production_run_id === firstRunId,
    });
    assert.equal(compositionEvent.event_type, "video_version.composition_requested");
    if (compositionEvent.event_type !== "video_version.composition_requested") return;
    const compositionInput = await production.findProductionCompositionInput({ event: compositionEvent });
    assert.deepEqual(compositionInput?.segments.map((segment) => segment.sequence), [1, 2]);
    assert.equal(compositionInput?.compositionPlan.target_duration_ms, 2_000);
    assert.deepEqual(compositionInput?.compositionPlan.transitions, ["BRIDGE"]);
    assert.deepEqual(compositionInput?.compositionPlan.bridge_durations_ms, [2_000]);
    assert.equal(compositionInput?.compositionPlan.audio_policy, "CONTINUOUS_NARRATION");
    assert.equal(compositionInput?.compositionPlan.music_mix.enabled, false);
    assert.deepEqual(compositionInput?.compositionPlan.music_segments_ms, []);
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
      now: new Date(),
    });
    progress = await production.findProductionRunProgress(workspaceId, firstRunId);
    assert.equal(progress?.productionRun.status, "SUCCEEDED");
    assert.equal(progress?.productionRun.acceptedShotCount, 2);
    assert.deepEqual((await database.db.select().from(videoVersions).where(and(eq(videoVersions.workspaceId, workspaceId), eq(videoVersions.productionRunId, firstRunId)))).map((version) => version.status), ["SUCCEEDED"]);
    assert.equal((await database.db.select().from(eventConsumptions).where(and(eq(eventConsumptions.workspaceId, workspaceId), eq(eventConsumptions.eventId, firstQcEvent.event_id)))).length, 1);

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
    await production.recordProductionTaskFailed({ event: taskFailedEvent({ workspaceId, projectId, taskRunId: failedSegment.taskRunId!, retryable: true }), now: new Date() });
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
    assert.ok(await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === legacySegment.taskRunId,
    }));
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
