import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { InternalEventEnvelopeSchema, InternalTaskRunQueueMessageSchema, type InternalEventEnvelope } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import { DrizzleAssetWorkspaceRepository } from "../src/asset-workspace-repository.js";
import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { DrizzleCreativePlanningRepository } from "../src/creative-planning-repository.js";
import { createDatabase } from "../src/db.js";
import {
  assets as assetRows,
  canonicalVisualEntities,
  canonicalVisualEntityRevisionAssets,
  canonicalVisualEntityRevisions,
  commandDeduplications,
  creativeBriefRevisions,
  eventConsumptions,
  outboxEvents,
  providerAttempts,
  users,
  workspaces,
} from "../src/schema.js";
import { DrizzleTaskRunRepository } from "../src/task-run-repository.js";

const taskCommand = {
  model: "c05-queue-only",
  prompt: "C05 only persists and transports this frozen task snapshot.",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  reference_asset_ids: [],
};

const eventMetadata = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const queueMessage = (event: InternalEventEnvelope) => {
  if (event.event_type !== "task_run.queued") throw new Error("Expected a queued task-run event.");
  return InternalTaskRunQueueMessageSchema.parse({
    contract_version: event.contract_version,
    event_id: event.event_id,
    workspace_id: event.workspace_id,
    task_run_id: event.data.task_run_id,
    attempt_no: 1,
    correlation_id: event.correlation_id,
    input_snapshot: event.data.input_snapshot,
  });
};

test("Drizzle TaskRunRepository persists outbox facts, leases, deduplication, and workspace-scoped consumption", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseScope = `c05-pg-${suffix}`;
  const userA = createPrefixedId("usr");
  const workspaceA = createPrefixedId("ws");
  const projectA = createPrefixedId("prj");
  const shotA = createPrefixedId("sht");
  const shotB = createPrefixedId("sht");
  const userB = createPrefixedId("usr");
  const workspaceB = createPrefixedId("ws");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({
      user: { id: userA, displayName: "C05 PostgreSQL A" },
      workspace: { id: workspaceA, name: "C05 PostgreSQL A" },
    });
    await control.ensureDevIdentity({
      user: { id: userB, displayName: "C05 PostgreSQL B" },
      workspace: { id: workspaceB, name: "C05 PostgreSQL B" },
    });
    assert.equal((await control.createProject({
      scope: `${baseScope}:project`,
      idempotencyKey: "project-create",
      requestHash: fingerprintRequest({ name: "C05 durable project" }),
      workspaceId: workspaceA,
      projectId: projectA,
      name: "C05 durable project",
    })).kind, "NEW");

    for (const [shotId, position] of [[shotA, 0], [shotB, 1]] as const) {
      assert.equal((await assets.createShot({
        scope: `${baseScope}:shot:${position}`,
        idempotencyKey: `shot-${position}`,
        requestHash: fingerprintRequest({ position, prompt: `C05 shot ${position}` }),
        workspaceId: workspaceA,
        projectId: projectA,
        shotId,
        position,
        prompt: `C05 shot ${position}`,
        model: null,
        generationSettings: {},
        referenceBindings: [],
      })).kind, "NEW");
      assert.equal((await assets.updateShot({
        scope: `${baseScope}:shot-ready:${position}`,
        idempotencyKey: `shot-ready-${position}`,
        requestHash: fingerprintRequest({ status: "READY" }),
        workspaceId: workspaceA,
        shotId,
        status: "READY",
      })).kind, "NEW");
    }

    const firstTaskId = createPrefixedId("tsk");
    const firstEvent = eventMetadata();
    const firstInput = {
      scope: `${baseScope}:task:first`,
      idempotencyKey: "task-first",
      requestHash: fingerprintRequest(taskCommand),
      workspaceId: workspaceA,
      taskRunId: firstTaskId,
      shotId: shotA,
      kind: "VIDEO_GENERATION" as const,
      inputSnapshot: taskCommand,
      event: firstEvent,
    };
    const created = await tasks.createTaskRun(firstInput);
    assert.equal(created.kind, "NEW");
    if (created.kind !== "NEW") return;
    assert.equal(created.value.status, "QUEUED");

    const reconstructed = new DrizzleTaskRunRepository(database.db);
    const replay = await reconstructed.createTaskRun({ ...firstInput, taskRunId: createPrefixedId("tsk") });
    assert.equal(replay.kind, "REPLAY");
    if (replay.kind === "REPLAY") assert.equal(replay.value.id, firstTaskId);
    assert.deepEqual(
      await reconstructed.createTaskRun({
        ...firstInput,
        taskRunId: createPrefixedId("tsk"),
        requestHash: fingerprintRequest({ ...taskCommand, prompt: "different idempotent command" }),
      }),
      { kind: "CONFLICT" },
    );

    const leaseStart = new Date(Date.now() + 1_000);
    const firstClaim = await reconstructed.claimOutboxEvents({
      relayId: "relay-a",
      now: leaseStart,
      leaseMs: 100,
      limit: 10,
      workspaceId: workspaceA,
      eventTypes: [
        "document_conversion.queued",
        "document_conversion.started",
        "document_conversion.succeeded",
        "document_conversion.failed",
        "task_run.queued",
      ],
    });
    assert.deepEqual(firstClaim.map((event) => event.id), [firstEvent.eventId]);
    assert.equal((await reconstructed.claimOutboxEvents({ relayId: "relay-b", now: leaseStart, leaseMs: 100, limit: 10, workspaceId: workspaceA })).length, 0);
    const recoveredClaim = await reconstructed.claimOutboxEvents({ relayId: "relay-b", now: new Date(leaseStart.getTime() + 101), leaseMs: 100, limit: 10, workspaceId: workspaceA });
    assert.deepEqual(recoveredClaim.map((event) => event.id), [firstEvent.eventId]);
    assert.equal(recoveredClaim[0]?.publishAttempts, 2);
    await reconstructed.releaseOutboxEvent({
      eventId: firstEvent.eventId,
      workspaceId: workspaceA,
      relayId: "relay-b",
      now: new Date(leaseStart.getTime() + 101),
      retryDelayMs: 10,
      maxAttempts: 3,
      reason: "controlled relay failure",
    });
    const finalClaim = await reconstructed.claimOutboxEvents({ relayId: "relay-c", now: new Date(leaseStart.getTime() + 112), leaseMs: 100, limit: 10, workspaceId: workspaceA });
    assert.deepEqual(finalClaim.map((event) => event.id), [firstEvent.eventId]);
    await reconstructed.releaseOutboxEvent({
      eventId: firstEvent.eventId,
      workspaceId: workspaceA,
      relayId: "relay-c",
      now: new Date(leaseStart.getTime() + 112),
      retryDelayMs: 10,
      maxAttempts: 3,
      reason: "controlled final relay failure",
    });
    const [deadOutbox] = await database.db
      .select({ deadLetteredAt: outboxEvents.deadLetteredAt, lastError: outboxEvents.lastError })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.id, firstEvent.eventId), eq(outboxEvents.workspaceId, workspaceA)));
    assert.ok(deadOutbox?.deadLetteredAt);
    assert.equal(deadOutbox?.lastError, "controlled final relay failure");

    const secondTaskId = createPrefixedId("tsk");
    const secondEvent = eventMetadata();
    const secondCreated = await reconstructed.createTaskRun({
      ...firstInput,
      scope: `${baseScope}:task:second`,
      idempotencyKey: "task-second",
      taskRunId: secondTaskId,
      shotId: shotB,
      event: secondEvent,
    });
    assert.equal(secondCreated.kind, "NEW");
    const secondQueuedEvent = (await reconstructed.listWorkspaceEvents({ workspaceId: workspaceA, limit: 20 })).find((event) => event.event_id === secondEvent.eventId);
    assert.ok(secondQueuedEvent && secondQueuedEvent.event_type === "task_run.queued");
    if (!secondQueuedEvent || secondQueuedEvent.event_type !== "task_run.queued") return;
    const secondMessage = queueMessage(secondQueuedEvent);
    assert.equal(await reconstructed.processEvent({
      message: secondMessage,
      consumerName: "task-run-transition",
      workerId: "worker-a",
      now: new Date(),
      leaseMs: 100,
    }), "PROCESSED");
    assert.equal((await reconstructed.findTaskRun(workspaceA, secondTaskId))?.status, "RUNNING");
    assert.equal(await reconstructed.processEvent({
      message: secondMessage,
      consumerName: "task-run-transition",
      workerId: "worker-b",
      now: new Date(),
      leaseMs: 100,
    }), "DUPLICATE");
    assert.equal(await reconstructed.processEvent({
      message: { ...secondMessage, workspace_id: workspaceB },
      consumerName: "task-run-transition",
      workerId: "worker-b",
      now: new Date(),
      leaseMs: 100,
    }), "RETRY");
    assert.equal(await reconstructed.findTaskRun(workspaceB, secondTaskId), undefined);

    const [completedConsumption] = await database.db
      .select({ workspaceId: eventConsumptions.workspaceId })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceA),
        eq(eventConsumptions.eventId, secondEvent.eventId),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.equal(completedConsumption?.workspaceId, workspaceA);

    const missingTaskEvent = InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      message_id: createPrefixedId("msg"),
      event_id: createPrefixedId("evt"),
      event_type: "task_run.queued",
      occurred_at: new Date().toISOString(),
      trace_id: createPrefixedId("trc"),
      correlation_id: createPrefixedId("cor"),
      idempotency_key: "missing-task-event",
      producer: "task-worker-test",
      workspace_id: workspaceA,
      project_id: projectA,
      aggregate: { type: "task_run", id: createPrefixedId("tsk") },
      version: 1,
      data: {
        task_run_id: createPrefixedId("tsk"),
        kind: "VIDEO_GENERATION",
        input_snapshot: taskCommand,
      },
    });
    await database.db.insert(outboxEvents).values({
      id: missingTaskEvent.event_id,
      workspaceId: workspaceA,
      projectId: projectA,
      aggregateType: missingTaskEvent.aggregate.type,
      aggregateId: missingTaskEvent.aggregate.id,
      eventType: missingTaskEvent.event_type,
      payload: missingTaskEvent,
      occurredAt: missingTaskEvent.occurred_at,
    });
    const tamperedTaskEvent = InternalEventEnvelopeSchema.parse({
      ...missingTaskEvent,
      event_id: createPrefixedId("evt"),
      workspace_id: workspaceB,
    });
    await database.db.insert(outboxEvents).values({
      id: tamperedTaskEvent.event_id,
      workspaceId: workspaceA,
      projectId: projectA,
      aggregateType: tamperedTaskEvent.aggregate.type,
      aggregateId: tamperedTaskEvent.aggregate.id,
      eventType: tamperedTaskEvent.event_type,
      payload: tamperedTaskEvent,
      occurredAt: tamperedTaskEvent.occurred_at,
    });
    const tamperedMessage = InternalTaskRunQueueMessageSchema.parse({ ...queueMessage(tamperedTaskEvent), workspace_id: workspaceA });
    assert.equal(await reconstructed.processEvent({
      message: tamperedMessage,
      consumerName: "task-run-transition",
      workerId: "worker-tampered",
      now: new Date(),
      leaseMs: 100,
    }), "RETRY");
    const tamperedConsumption = await database.db
      .select({ eventId: eventConsumptions.eventId })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceA),
        eq(eventConsumptions.eventId, tamperedTaskEvent.event_id),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.deepEqual(tamperedConsumption, []);
    const missingTaskMessage = queueMessage(missingTaskEvent);
    const consumerStart = new Date();
    assert.equal(await reconstructed.processEvent({
      message: missingTaskMessage,
      consumerName: "task-run-transition",
      workerId: "worker-a",
      now: consumerStart,
      leaseMs: 100,
    }), "RETRY");
    const [leasedConsumption] = await database.db
      .select({ workspaceId: eventConsumptions.workspaceId, leaseOwner: eventConsumptions.leaseOwner, attempts: eventConsumptions.attempts })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceA),
        eq(eventConsumptions.eventId, missingTaskEvent.event_id),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.deepEqual(leasedConsumption, { workspaceId: workspaceA, leaseOwner: "worker-a", attempts: 1 });
    assert.equal(await reconstructed.processEvent({
      message: { ...missingTaskMessage, workspace_id: workspaceB },
      consumerName: "task-run-transition",
      workerId: "worker-wrong-workspace",
      now: new Date(consumerStart.getTime() + 1),
      leaseMs: 100,
    }), "RETRY");
    const wrongWorkspaceConsumption = await database.db
      .select({ eventId: eventConsumptions.eventId })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceB),
        eq(eventConsumptions.eventId, missingTaskEvent.event_id),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.deepEqual(wrongWorkspaceConsumption, []);
    await assert.rejects(
      database.db.insert(eventConsumptions).values({
        workspaceId: workspaceB,
        eventId: missingTaskEvent.event_id,
        consumerName: "task-run-transition",
        attempts: 1,
      }),
      (error: unknown) => {
        const databaseError = (error as { cause?: { code?: string; constraint?: string } }).cause;
        return databaseError?.code === "23503" && databaseError.constraint === "event_consumptions_event_workspace_outbox_fk";
      },
    );
    assert.equal(await reconstructed.processEvent({
      message: missingTaskMessage,
      consumerName: "task-run-transition",
      workerId: "worker-b",
      now: new Date(consumerStart.getTime() + 1),
      leaseMs: 100,
    }), "BUSY");
    assert.equal(await reconstructed.processEvent({
      message: missingTaskMessage,
      consumerName: "task-run-transition",
      workerId: "worker-b",
      now: new Date(consumerStart.getTime() + 101),
      leaseMs: 100,
    }), "RETRY");
    await reconstructed.releaseConsumerEvent({
      eventId: missingTaskEvent.event_id,
      workspaceId: workspaceB,
      consumerName: "task-run-transition",
      workerId: "worker-b",
      reason: "wrong workspace must not release the lease",
      deadLetter: true,
      now: new Date(consumerStart.getTime() + 101),
    });
    const [afterWrongScopeRelease] = await database.db
      .select({ workspaceId: eventConsumptions.workspaceId, leaseOwner: eventConsumptions.leaseOwner, deadLetteredAt: eventConsumptions.deadLetteredAt })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceA),
        eq(eventConsumptions.eventId, missingTaskEvent.event_id),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.deepEqual(afterWrongScopeRelease, { workspaceId: workspaceA, leaseOwner: "worker-b", deadLetteredAt: null });
    await reconstructed.releaseConsumerEvent({
      eventId: missingTaskEvent.event_id,
      workspaceId: workspaceA,
      consumerName: "task-run-transition",
      workerId: "worker-b",
      reason: "controlled terminal worker failure",
      deadLetter: true,
      now: new Date(consumerStart.getTime() + 102),
    });
    const [consumption] = await database.db
      .select({ attempts: eventConsumptions.attempts, deadLetteredAt: eventConsumptions.deadLetteredAt, lastError: eventConsumptions.lastError })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceA),
        eq(eventConsumptions.eventId, missingTaskEvent.event_id),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.equal(consumption?.attempts, 2);
    assert.ok(consumption?.deadLetteredAt);
    assert.equal(consumption?.lastError, "controlled terminal worker failure");

    const publicEventIds = (await reconstructed.listWorkspaceEvents({ workspaceId: workspaceA, limit: 20 })).map((event) => event.event_id);
    assert.equal(publicEventIds.includes(secondEvent.eventId), true);
    assert.equal(publicEventIds.some((eventId) => eventId !== secondEvent.eventId), true);
    assert.deepEqual(await reconstructed.listWorkspaceEvents({ workspaceId: workspaceB, limit: 20 }), []);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [[workspaceA, workspaceB]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[userA, userB]]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("G02 serializes mapping revocation against attempt creation and preserves committed submit intent", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `g02-attempt-pg-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const entityId = createPrefixedId("ent");
  const revisionId = createPrefixedId("evr");
  const sourceText = [
    "G02_APPROVED_BEAT_1: 首个批准节拍。",
    "G02_APPROVED_BEAT_2: 第二个批准节拍。",
    "G02_APPROVED_BEAT_3: 第三个批准节拍。",
  ].join("\n");
  const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const database = createDatabase(databaseUrl);
  const addRows: Array<{
    id: string;
    assetId: string;
    assetSha256: string;
    mappingEvidenceId: string;
    referenceEvidenceId: string;
  }> = [];

  const appendRevocation = (planning: DrizzleCreativePlanningRepository, add: (typeof addRows)[number], overrides: Partial<{
    workspaceId: string;
    projectId: string;
    briefRevisionId: string;
    entityId: string;
    revisionNumber: number;
    assetId: string;
    assetSha256: string;
  }> = {}) => planning.appendG02EntityMappingRevoke({
    workspaceId,
    projectId,
    briefRevisionId: briefId,
    addMappingEvidenceId: add.id,
    entityId,
    revisionNumber: 1,
    assetId: add.assetId,
    assetSha256: add.assetSha256,
    ...overrides,
  });

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const assetRepository = new DrizzleAssetWorkspaceRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "G02 attempt race" }, workspace: { id: workspaceId, name: "G02 attempt race" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ projectId }),
      workspaceId,
      projectId,
      name: "G02 attempt race",
    })).kind, "NEW");

    const imageAssets = [createPrefixedId("ast"), createPrefixedId("ast")];
    const assetHashes = ["a".repeat(64), "b".repeat(64)];
    await database.db.insert(assetRows).values(imageAssets.map((assetId, index) => ({
      id: assetId,
      workspaceId,
      projectId,
      kind: "IMAGE" as const,
      origin: "USER_UPLOAD" as const,
      status: "READY" as const,
      objectKey: `${workspaceId}/${projectId}/${assetId}/reference.png`,
      sha256: assetHashes[index]!,
      mimeType: "image/png",
      byteSize: 512,
      metadata: { filename: `g02-reference-${index}.png` },
    })));

    const brief = await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "brief",
      requestHash: fingerprintRequest({ sourceText, imageAssets }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText,
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "",
      sourceAssetIds: imageAssets,
      sourceAssetRoles: imageAssets.map((assetId) => ({ assetId, role: "SUBJECT" as const, usage: "G02 approved character reference" })),
      event: eventMetadata(),
    });
    assert.equal(brief.kind, "NEW");
    await database.db.update(creativeBriefRevisions).set({ status: "APPROVED" }).where(eq(creativeBriefRevisions.id, briefId));

    await database.db.insert(canonicalVisualEntities).values({
      id: entityId,
      workspaceId,
      projectId,
      entityKind: "CHARACTER",
      normalizedIdentity: "character:g02-attempt-race",
    });
    await database.db.insert(canonicalVisualEntityRevisions).values({
      id: revisionId,
      workspaceId,
      projectId,
      entityId,
      revisionNumber: 1,
      exactName: "批准人物",
      contentHash: "c".repeat(64),
    });

    for (let index = 0; index < imageAssets.length; index += 1) {
      const id = createPrefixedId("mpe");
      const referenceEvidenceId = createPrefixedId("rfe");
      const assetId = imageAssets[index]!;
      const assetSha256 = assetHashes[index]!;
      await database.db.insert(canonicalVisualEntityRevisionAssets).values({
        id,
        workspaceId,
        projectId,
        changeKind: "ADD",
        entityId,
        revisionNumber: 1,
        assetId,
        assetSha256,
        mappingEvidenceId: id,
        referenceEvidenceId,
        briefRevisionId: briefId,
        usage: "G02 approved character reference",
        revokedAddId: null,
      });
      addRows.push({ id, assetId, assetSha256, mappingEvidenceId: id, referenceEvidenceId });
    }

    const createScenario = async (
      assetIndex: number,
      addOverride?: (typeof addRows)[number],
      scenarioNamespace = String(assetIndex),
      shotPosition = assetIndex,
    ) => {
      const shotId = createPrefixedId("sht");
      const taskRunId = createPrefixedId("tsk");
      const asset = imageAssets[assetIndex]!;
      const add = addOverride ?? addRows[assetIndex]!;
      const quote = sourceText.split("\n")[0]!;
      const exactQuoteSha256 = createHash("sha256").update(quote, "utf8").digest("hex");
      const beatIdentitySha256 = fingerprintRequest({ brief_revision_id: briefId, sequence: 1, exact_quote_sha256: exactQuoteSha256 });
      const lineage = {
        version: 1 as const,
        brief_revision_id: briefId,
        source_hash: sourceHash,
        beat: {
          sequence: 1 as const,
          span: { start: 0, end: quote.length, quote },
          exact_quote_sha256: exactQuoteSha256,
          identity_sha256: beatIdentitySha256,
        },
      };
      const projection = {
        version: 1 as const,
        brief_revision_id: briefId,
        source_hash: sourceHash,
        decision_hash: "d".repeat(64),
        segment_id: `g02-race-segment-${scenarioNamespace}`,
        prompt_package_id: createPrefixedId("ppk"),
        bindings: [{
          entity_kind: "CHARACTER" as const,
          entity_id: entityId,
          entity_revision_id: revisionId,
          exact_name: "批准人物",
          asset_id: asset,
          asset_sha256: assetHashes[assetIndex]!,
          provider_position: 0,
          mapping_evidence_id: add.mappingEvidenceId,
        }],
      };
      const inputSnapshot = {
        model: "g02-attempt-race",
        prompt: "以 @批准人物 为唯一人物参考。",
        duration: 10,
        resolution: "480p",
        ratio: "16:9",
        reference_asset_ids: [asset],
        generation_segment_sequence: 1,
        narrative_beat_sequences: [1],
        visual_input: {
          mode: "REFERENCE_SET" as const,
          references: [{ asset_id: asset, sha256: assetHashes[assetIndex]!, mime_type: "image/png" as const, position: 0 }],
        },
        semantic_entity_reference_projection: projection,
        semantic_entity_reference_projection_hash: fingerprintRequest(projection),
        semantic_narrative_beat_lineage: lineage,
        semantic_narrative_beat_lineage_hash: fingerprintRequest(lineage),
      };

      assert.equal((await assetRepository.createShot({
        scope: `${scope}:shot:${scenarioNamespace}`,
        idempotencyKey: `shot-${scenarioNamespace}`,
        requestHash: fingerprintRequest({ assetIndex, shotPosition, scenarioNamespace }),
        workspaceId,
        projectId,
        shotId,
        position: shotPosition,
        prompt: inputSnapshot.prompt,
        model: inputSnapshot.model,
        generationSettings: {},
        referenceBindings: [],
      })).kind, "NEW");
      assert.equal((await assetRepository.updateShot({
        scope: `${scope}:shot-ready:${scenarioNamespace}`,
        idempotencyKey: `shot-ready-${scenarioNamespace}`,
        requestHash: fingerprintRequest({ status: "READY", scenarioNamespace }),
        workspaceId,
        shotId,
        status: "READY",
      })).kind, "NEW");
      assert.equal((await tasks.createTaskRun({
        scope: `${scope}:task:${scenarioNamespace}`,
        idempotencyKey: `task-${scenarioNamespace}`,
        requestHash: fingerprintRequest(inputSnapshot),
        workspaceId,
        taskRunId,
        shotId,
        kind: "VIDEO_GENERATION",
        inputSnapshot,
        event: eventMetadata(),
      })).kind, "NEW");
      return { taskRunId, add };
    };

    const revokeFirst = await createScenario(0);
    const { Client } = await import("pg");
    const revokeFirstClient = new Client({ connectionString: databaseUrl });
    await revokeFirstClient.connect();
    try {
      await revokeFirstClient.query("BEGIN");
      await revokeFirstClient.query("SELECT id FROM creative_brief_revisions WHERE id = $1 FOR UPDATE", [briefId]);
      const revokePromise = appendRevocation(planning, revokeFirst.add);
      let revokeSettled = false;
      void revokePromise.then(() => { revokeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(revokeSettled, false);
      const attemptPromise = tasks.ensureProviderAttempt({
        workspaceId,
        taskRunId: revokeFirst.taskRunId,
        providerAttemptId: createPrefixedId("att"),
        provider: "mock",
        model: "g02-attempt-race",
        now: new Date(),
      });
      let attemptSettled = false;
      void attemptPromise.then(() => { attemptSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(attemptSettled, false);
      await revokeFirstClient.query("COMMIT");
      assert.equal(typeof await revokePromise, "string");
      assert.equal(await attemptPromise, undefined);
      assert.deepEqual(await tasks.listTaskRunAttempts(workspaceId, revokeFirst.taskRunId), []);
    } finally {
      await revokeFirstClient.query("ROLLBACK").catch(() => undefined);
      await revokeFirstClient.end();
    }

    const attemptFirst = await createScenario(1);
    const committedIntent = await tasks.ensureProviderAttempt({
      workspaceId,
      taskRunId: attemptFirst.taskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: "g02-attempt-race",
      now: new Date(),
    });
    assert.ok(committedIntent);
    assert.equal(committedIntent?.status, "CREATED");
    assert.equal(typeof await appendRevocation(planning, attemptFirst.add), "string");
    await assert.rejects(() => appendRevocation(planning, attemptFirst.add), /cannot be revoked twice/u);
    await assert.rejects(() => appendRevocation(planning, attemptFirst.add, { assetSha256: "0".repeat(64) }), /exactly bind/u);
    await assert.rejects(() => appendRevocation(planning, attemptFirst.add, { projectId: createPrefixedId("prj") }), /locked source-marked Brief/u);

    const replacementAddId = createPrefixedId("mpe");
    const replacementAdd = {
      id: replacementAddId,
      assetId: attemptFirst.add.assetId,
      assetSha256: attemptFirst.add.assetSha256,
      mappingEvidenceId: replacementAddId,
      // The frozen canonical REFERENCE_ASSET evidence is reused. A second
      // ADD after REVOKE must not invent a new source-evidence identity.
      referenceEvidenceId: attemptFirst.add.referenceEvidenceId,
    };
    await database.db.insert(canonicalVisualEntityRevisionAssets).values({
      id: replacementAdd.id,
      workspaceId,
      projectId,
      changeKind: "ADD",
      entityId,
      revisionNumber: 1,
      assetId: replacementAdd.assetId,
      assetSha256: replacementAdd.assetSha256,
      mappingEvidenceId: replacementAdd.mappingEvidenceId,
      referenceEvidenceId: replacementAdd.referenceEvidenceId,
      briefRevisionId: briefId,
      usage: "G02 approved character reference",
      revokedAddId: null,
    });
    const addAfterRevoke = await createScenario(1, replacementAdd, "1-replacement", 2);
    const replacementIntent = await tasks.ensureProviderAttempt({
      workspaceId,
      taskRunId: addAfterRevoke.taskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: "g02-attempt-race",
      now: new Date(),
    });
    assert.ok(replacementIntent);
    assert.equal(replacementIntent?.status, "CREATED");
    assert.equal(typeof await appendRevocation(planning, replacementAdd), "string");
    const mappingHistory = await database.db.select({
      id: canonicalVisualEntityRevisionAssets.id,
      changeKind: canonicalVisualEntityRevisionAssets.changeKind,
      revokedAddId: canonicalVisualEntityRevisionAssets.revokedAddId,
      referenceEvidenceId: canonicalVisualEntityRevisionAssets.referenceEvidenceId,
    }).from(canonicalVisualEntityRevisionAssets).where(and(
      eq(canonicalVisualEntityRevisionAssets.workspaceId, workspaceId),
      eq(canonicalVisualEntityRevisionAssets.projectId, projectId),
      eq(canonicalVisualEntityRevisionAssets.briefRevisionId, briefId),
      eq(canonicalVisualEntityRevisionAssets.assetId, attemptFirst.add.assetId),
    ));
    assert.equal(mappingHistory.length, 4);
    assert.deepEqual(mappingHistory.map((row) => row.changeKind).sort(), ["ADD", "ADD", "REVOKE", "REVOKE"]);
    assert.equal(mappingHistory.filter((row) => row.changeKind === "ADD")
      .every((row) => row.referenceEvidenceId === attemptFirst.add.referenceEvidenceId), true);
    const recoveredReplacementIntent = await tasks.ensureProviderAttempt({
      workspaceId,
      taskRunId: addAfterRevoke.taskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: "g02-attempt-race",
      now: new Date(),
    });
    assert.equal(recoveredReplacementIntent?.id, replacementIntent?.id);
    assert.equal(recoveredReplacementIntent?.status, "CREATED");
    const recoveredIntent = await tasks.ensureProviderAttempt({
      workspaceId,
      taskRunId: attemptFirst.taskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: "g02-attempt-race",
      now: new Date(),
    });
    assert.equal(recoveredIntent?.id, committedIntent?.id);
    assert.equal(recoveredIntent?.status, "CREATED");
    assert.equal((await tasks.listTaskRunAttempts(workspaceId, attemptFirst.taskRunId)).length, 1);
    const attemptRows = await database.db.select({ id: providerAttempts.id }).from(providerAttempts)
      .where(eq(providerAttempts.taskRunId, attemptFirst.taskRunId));
    assert.equal(attemptRows.length, 1);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${scope}%`]);
      // The append-only ledger has RESTRICT FKs to assets, Brief revisions,
      // and prior ADD rows. Remove this test's REVOKE rows before their ADD
      // targets, then clear only the unique workspace/project created above.
      await client.query(
        "DELETE FROM canonical_visual_entity_revision_assets WHERE workspace_id = $1 AND project_id = $2 AND change_kind = 'REVOKE'",
        [workspaceId, projectId],
      );
      await client.query(
        "DELETE FROM canonical_visual_entity_revision_assets WHERE workspace_id = $1 AND project_id = $2",
        [workspaceId, projectId],
      );
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
