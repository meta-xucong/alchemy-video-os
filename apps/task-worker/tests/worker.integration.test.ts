import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { InternalEventEnvelopeSchema, type InternalTaskRunQueueMessage } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import {
  DrizzleAssetWorkspaceRepository,
  DrizzleControlPlaneRepository,
  DrizzleTaskRunRepository,
  commandDeduplications,
  createDatabase,
  eventConsumptions,
  outboxEvents,
  providerAttempts,
  users,
  workspaces,
} from "@alchemy-video/persistence";
import {
  BullMqInternalEventQueue,
  clearInternalEventQueues,
  createBullMqInternalEventWorker,
} from "@alchemy-video/task-queue";

import { OutboxRelay, TaskRunEventConsumer } from "../src/service.js";

const taskCommand = {
  model: "c05-queue-only",
  prompt: "The C05 Worker must not submit a video Provider request.",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  reference_asset_ids: [],
};

const waitFor = async (predicate: () => Promise<boolean>, message: string, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

test("a restarted C05 Worker consumes durable BullMQ events once and dead-letters a terminal missing TaskRun", { skip: !process.env.DATABASE_URL || !process.env.REDIS_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseScope = `c05-worker-${suffix}`;
  const queueName = `alchemy-video-c05-worker-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const tamperedQueueName = `${queueName}-tampered`;
  const tamperedDeadLetterQueueName = `${tamperedQueueName}-dead-letter`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const otherUserId = createPrefixedId("usr");
  const otherWorkspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const queuedEventId = createPrefixedId("evt");
  const queuedCorrelationId = createPrefixedId("cor");
  const database = createDatabase(databaseUrl);
  const queue = new BullMqInternalEventQueue(redisUrl, { queueName });
  const tamperedQueue = new BullMqInternalEventQueue(redisUrl, { queueName: tamperedQueueName });
  let worker: ReturnType<typeof createBullMqInternalEventWorker> | undefined;
  let tamperedWorker: ReturnType<typeof createBullMqInternalEventWorker> | undefined;
  const received: InternalTaskRunQueueMessage[] = [];

  try {
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    await clearInternalEventQueues({ redisUrl, queueName: tamperedQueueName, deadLetterQueueName: tamperedDeadLetterQueueName });
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({
      user: { id: userId, displayName: "C05 Worker Test" },
      workspace: { id: workspaceId, name: "C05 Worker Test" },
    });
    await control.ensureDevIdentity({
      user: { id: otherUserId, displayName: "C05 Worker Other Workspace" },
      workspace: { id: otherWorkspaceId, name: "C05 Worker Other Workspace" },
    });
    assert.equal((await control.createProject({
      scope: `${baseScope}:project`,
      idempotencyKey: "project-create",
      requestHash: fingerprintRequest({ name: "C05 worker project" }),
      workspaceId,
      projectId,
      name: "C05 worker project",
    })).kind, "NEW");
    assert.equal((await assets.createShot({
      scope: `${baseScope}:shot`,
      idempotencyKey: "shot-create",
      requestHash: fingerprintRequest({ position: 0, prompt: "C05 worker shot" }),
      workspaceId,
      projectId,
      shotId,
      position: 0,
      prompt: "C05 worker shot",
      model: null,
      generationSettings: {},
      referenceBindings: [],
    })).kind, "NEW");
    const created = await tasks.createTaskRun({
      scope: `${baseScope}:task`,
      idempotencyKey: "task-create",
      requestHash: fingerprintRequest(taskCommand),
      workspaceId,
      taskRunId,
      shotId,
      kind: "VIDEO_GENERATION",
      inputSnapshot: taskCommand,
      event: {
        eventId: queuedEventId,
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: queuedCorrelationId,
      },
    });
    assert.equal(created.kind, "NEW");

    let tamperedTerminal = false;
    const tamperedConsumer = new TaskRunEventConsumer(tasks, {
      consumerName: "task-run-transition-tampered",
      workerId: `worker-tampered-${suffix}`,
      leaseMs: 50,
    });
    tamperedWorker = createBullMqInternalEventWorker({
      redisUrl,
      queueName: tamperedQueueName,
      deadLetterQueueName: tamperedDeadLetterQueueName,
      processor: async (message) => tamperedConsumer.process(message),
      onTerminalFailure: async ({ event_id, workspace_id, reason }) => {
        tamperedTerminal = true;
        await tamperedConsumer.deadLetter({ event_id, workspace_id, reason });
      },
    });
    await tamperedWorker.waitUntilReady();
    await tamperedQueue.enqueue({
      contract_version: "1.0",
      event_id: queuedEventId,
      workspace_id: otherWorkspaceId,
      task_run_id: taskRunId,
      attempt_no: 1,
      correlation_id: queuedCorrelationId,
      input_snapshot: taskCommand,
    });
    await waitFor(async () => tamperedTerminal, "tampered workspace terminal failure");
    assert.equal((await tasks.findTaskRun(workspaceId, taskRunId))?.status, "QUEUED");
    const tamperedConsumptions = await database.db
      .select({ eventId: eventConsumptions.eventId })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, otherWorkspaceId),
        eq(eventConsumptions.eventId, queuedEventId),
        eq(eventConsumptions.consumerName, "task-run-transition-tampered"),
      ));
    assert.deepEqual(tamperedConsumptions, []);
    await tamperedWorker.close();
    tamperedWorker = undefined;
    await tamperedQueue.close();
    await clearInternalEventQueues({ redisUrl, queueName: tamperedQueueName, deadLetterQueueName: tamperedDeadLetterQueueName });

    const missingTaskId = createPrefixedId("tsk");
    const missingEvent = InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      message_id: createPrefixedId("msg"),
      event_id: createPrefixedId("evt"),
      event_type: "task_run.queued",
      occurred_at: new Date().toISOString(),
      trace_id: createPrefixedId("trc"),
      correlation_id: createPrefixedId("cor"),
      idempotency_key: "missing-task-worker-event",
      producer: "task-worker-test",
      workspace_id: workspaceId,
      project_id: projectId,
      aggregate: { type: "task_run", id: missingTaskId },
      version: 1,
      data: {
        task_run_id: missingTaskId,
        kind: "VIDEO_GENERATION",
        input_snapshot: taskCommand,
      },
    });
    await database.db.insert(outboxEvents).values({
      id: missingEvent.event_id,
      workspaceId,
      projectId,
      aggregateType: missingEvent.aggregate.type,
      aggregateId: missingEvent.aggregate.id,
      eventType: missingEvent.event_type,
      payload: missingEvent,
      occurredAt: missingEvent.occurred_at,
    });

    const relay = new OutboxRelay(tasks, queue, {
      relayId: `relay-${suffix}`,
      leaseMs: 1_000,
      retryDelayMs: 100,
      maxAttempts: 3,
      batchSize: 10,
      workspaceId,
    });
    const relayRuns: Array<{ published: number; retried: number; deadLettered: number }> = [];
    let publishedTargetEvents = new Set<string>();
    for (let attempt = 0; attempt < 5 && publishedTargetEvents.size < 2; attempt += 1) {
      relayRuns.push(await relay.runOnce(new Date(Date.now() + 1_000)));
      const publishedRows = await database.db
        .select({ id: outboxEvents.id, publishedAt: outboxEvents.publishedAt })
        .from(outboxEvents)
        .where(eq(outboxEvents.workspaceId, workspaceId));
      publishedTargetEvents = new Set(
        publishedRows
          .filter((row) => row.publishedAt && (row.id === queuedEventId || row.id === missingEvent.event_id))
          .map((row) => row.id),
      );
    }
    assert.deepEqual([...publishedTargetEvents].sort(), [missingEvent.event_id, queuedEventId].sort());
    assert.equal(relayRuns.reduce((total, result) => total + result.retried + result.deadLettered, 0), 0);

    const consumer = new TaskRunEventConsumer(tasks, {
      consumerName: "task-run-transition",
      workerId: `worker-${suffix}`,
      leaseMs: 50,
    });
    worker = createBullMqInternalEventWorker({
      redisUrl,
      queueName,
      deadLetterQueueName,
      processor: async (message) => {
        received.push(message);
        await consumer.process(message);
      },
      onTerminalFailure: async ({ event_id, workspace_id, reason }) => {
        await consumer.deadLetter({ event_id, workspace_id, reason });
      },
    });
    await worker.waitUntilReady();

    await waitFor(async () => (await tasks.findTaskRun(workspaceId, taskRunId))?.status === "RUNNING", "TaskRun transition");
    const taskMessage = received.find((message) => message.event_id === queuedEventId);
    assert.deepEqual(taskMessage, {
      contract_version: "1.0",
      event_id: queuedEventId,
      workspace_id: workspaceId,
      task_run_id: taskRunId,
      attempt_no: 1,
      correlation_id: queuedCorrelationId,
      input_snapshot: taskCommand,
    });
    if (taskMessage) assert.equal(await consumer.process(taskMessage), "DUPLICATE");
    assert.equal((await tasks.listWorkspaceEvents({ workspaceId, limit: 20 })).filter((event) => event.event_type === "task_run.started" && event.data.task_run_id === taskRunId).length, 1);
    await waitFor(async () => {
      const [consumption] = await database.db
        .select({ deadLetteredAt: eventConsumptions.deadLetteredAt })
        .from(eventConsumptions)
        .where(and(
          eq(eventConsumptions.workspaceId, workspaceId),
          eq(eventConsumptions.eventId, missingEvent.event_id),
          eq(eventConsumptions.consumerName, "task-run-transition"),
        ));
      return consumption?.deadLetteredAt !== null && consumption?.deadLetteredAt !== undefined;
    }, "terminal dead-letter persistence");

    const [consumption] = await database.db
      .select({ attempts: eventConsumptions.attempts, lastError: eventConsumptions.lastError, deadLetteredAt: eventConsumptions.deadLetteredAt })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceId),
        eq(eventConsumptions.eventId, missingEvent.event_id),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.equal(consumption?.attempts, 3);
    assert.ok(consumption?.deadLetteredAt);
    assert.match(consumption?.lastError ?? "", /requires another delivery attempt/);
    const providerRows = await database.db
      .select({ id: providerAttempts.id })
      .from(providerAttempts)
      .where(eq(providerAttempts.workspaceId, workspaceId));
    assert.deepEqual(providerRows, []);
  } finally {
    if (worker) await worker.close();
    if (tamperedWorker) await tamperedWorker.close();
    await queue.close();
    await tamperedQueue.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    await clearInternalEventQueues({ redisUrl, queueName: tamperedQueueName, deadLetterQueueName: tamperedDeadLetterQueueName });
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [[workspaceId, otherWorkspaceId]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[userId, otherUserId]]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
