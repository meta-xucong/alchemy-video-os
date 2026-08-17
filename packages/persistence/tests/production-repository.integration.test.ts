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
import { DrizzleProductionRepository } from "../src/production-repository.js";
import {
  assets,
  eventConsumptions,
  outboxEvents,
  promptPackages,
  productionRuns,
  productionSegments,
  qcReports,
  taskRuns,
  videoVersions,
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
      metadata: { fixture: "source-reference" },
    });

    const created = await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ source_text: "雨夜抵达工厂，团队在黎明前完成交付。", target_duration_seconds: 30, target_resolution: "480p", source_asset_ids: [sourceImageAssetId] }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText: "雨夜抵达工厂，团队在黎明前完成交付。",
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "克制的纪实感",
      sourceAssetIds: [sourceImageAssetId],
      event: eventMetadata(),
    });
    assert.equal(created.kind, "NEW");
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
    const firstAssetId = await generatedAsset(database.db, { workspaceId, projectId, taskRunId: firstSegment.taskRunId! });
    await production.recordProductionTaskSucceeded({ event: taskSucceededEvent({ workspaceId, projectId, taskRunId: firstSegment.taskRunId!, assetId: firstAssetId }), now: new Date() });
    const firstQcEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "production_segment.qc_requested",
      predicate: (event) => event.event_type === "production_segment.qc_requested" && event.data.task_run_id === firstSegment.taskRunId,
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
    assert.equal((await production.claimMediaRuntimeEvent({ message: firstQcMessage, consumerName: "c12-pg-media", workerId: "c12-pg-worker", now: new Date(), leaseMs: 1_000 })).kind, "CLAIMED");
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
    await production.completeMediaRuntimeEvent({ eventId: firstQcEvent.event_id, workspaceId, consumerName: "c12-pg-media", workerId: "c12-pg-worker", now: new Date() });
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
    const snapshot = secondTask?.inputSnapshot as { resolution?: string; reference_asset_ids?: string[]; visual_input?: { mode?: string; references?: Array<{ asset_id?: string }> } } | undefined;
    assert.equal(snapshot?.resolution, "480p");
    assert.equal(snapshot?.visual_input?.mode, "REFERENCE_SET");
    assert.equal(snapshot?.visual_input?.references?.length, 2);
    assert.deepEqual(snapshot?.reference_asset_ids, [firstHandoffAssetId, sourceImageAssetId]);
    assert.deepEqual(snapshot?.visual_input?.references?.map((reference) => reference.asset_id), [firstHandoffAssetId, sourceImageAssetId]);

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
    const compositionEvent = await readEvent(database.db, {
      workspaceId,
      eventType: "video_version.composition_requested",
      predicate: (event) => event.event_type === "video_version.composition_requested" && event.data.production_run_id === firstRunId,
    });
    assert.equal(compositionEvent.event_type, "video_version.composition_requested");
    if (compositionEvent.event_type !== "video_version.composition_requested") return;
    const compositionInput = await production.findProductionCompositionInput({ event: compositionEvent });
    assert.deepEqual(compositionInput?.segments.map((segment) => segment.sequence), [1, 2]);
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
