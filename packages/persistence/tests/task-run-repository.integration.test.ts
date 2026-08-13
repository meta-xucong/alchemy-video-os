import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { InternalEventEnvelopeSchema, InternalTaskRunQueueMessageSchema } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import { DrizzleAssetWorkspaceRepository } from "../src/asset-workspace-repository.js";
import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { createDatabase } from "../src/db.js";
import { commandDeduplications, eventConsumptions, outboxEvents, users, workspaces } from "../src/schema.js";
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

const queueMessage = (event: Extract<ReturnType<typeof InternalEventEnvelopeSchema.parse>, { event_type: "task_run.queued" }>) =>
  InternalTaskRunQueueMessageSchema.parse({
    contract_version: event.contract_version,
    event_id: event.event_id,
    workspace_id: event.workspace_id,
    task_run_id: event.data.task_run_id,
    attempt_no: 1,
    correlation_id: event.correlation_id,
    input_snapshot: event.data.input_snapshot,
  });

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
    const firstClaim = await reconstructed.claimOutboxEvents({ relayId: "relay-a", now: leaseStart, leaseMs: 100, limit: 10 });
    assert.deepEqual(firstClaim.map((event) => event.id), [firstEvent.eventId]);
    assert.equal((await reconstructed.claimOutboxEvents({ relayId: "relay-b", now: leaseStart, leaseMs: 100, limit: 10 })).length, 0);
    const recoveredClaim = await reconstructed.claimOutboxEvents({ relayId: "relay-b", now: new Date(leaseStart.getTime() + 101), leaseMs: 100, limit: 10 });
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
    const finalClaim = await reconstructed.claimOutboxEvents({ relayId: "relay-c", now: new Date(leaseStart.getTime() + 112), leaseMs: 100, limit: 10 });
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
