import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { acquireC06E2EIsolation } from "../../../packages/persistence/tests/support/c06-e2e-isolation.mjs";

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
  taskRuns,
  users,
  workspaces,
} from "@alchemy-video/persistence";
import {
  BullMqInternalEventQueue,
  clearInternalEventQueues,
  createBullMqInternalEventWorker,
} from "@alchemy-video/task-queue";
import { StorageUnavailableError, createS3StoragePort, type StoragePort } from "@alchemy-video/storage-client";
import { createMockMp4Fixture, MockVideoProvider } from "@alchemy-video/provider-video";

import { createApp } from "../../control-api/src/app.js";
import type { IdentityPort } from "../../control-api/src/identity.js";
import { MockVideoTaskExecutor } from "../src/execution-service.js";
import { OutboxRelay, TaskRunEventConsumer, recoverC06TaskRuns } from "../src/service.js";

let integrationIsolation: Awaited<ReturnType<typeof acquireC06E2EIsolation>> | undefined;

before(async () => {
  if (!process.env.DATABASE_URL) return;
  integrationIsolation = await acquireC06E2EIsolation(process.env.DATABASE_URL, {
    timeoutMs: 120_000,
    verifyIdle: false,
  });
});

after(async () => {
  await integrationIsolation?.release();
});

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

class FailFirstWritesStorage implements StoragePort {
  private readonly remainingWrites = new Map<string, number>();

  constructor(
    private readonly storage: StoragePort,
    private readonly failuresPerObject: number,
  ) {}

  createUploadUrl(input: Parameters<StoragePort["createUploadUrl"]>[0]) {
    return this.storage.createUploadUrl(input);
  }

  inspectObject(input: Parameters<StoragePort["inspectObject"]>[0]) {
    return this.storage.inspectObject(input);
  }

  async putObject(input: Parameters<StoragePort["putObject"]>[0]) {
    const remaining = this.remainingWrites.get(input.objectKey) ?? this.failuresPerObject;
    if (remaining > 0) {
      this.remainingWrites.set(input.objectKey, remaining - 1);
      throw new StorageUnavailableError("Controlled C06 local MinIO write failure.");
    }
    return this.storage.putObject(input);
  }

  createDownloadUrl(input: Parameters<StoragePort["createDownloadUrl"]>[0]) {
    return this.storage.createDownloadUrl(input);
  }
}

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
    assert.equal((await assets.updateShot({
      scope: `${baseScope}:shot-ready`,
      idempotencyKey: "shot-ready",
      requestHash: fingerprintRequest({ status: "READY" }),
      workspaceId,
      shotId,
      status: "READY",
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

const hasC06Infrastructure = Boolean(
  process.env.DATABASE_URL
  && process.env.REDIS_URL
  && process.env.S3_ENDPOINT
  && process.env.S3_REGION
  && process.env.S3_BUCKET
  && process.env.S3_ACCESS_KEY
  && process.env.S3_SECRET_KEY,
);

test("C06 BullMQ retry resumes a persisted Mock request after executor interruption without resubmitting", { skip: !hasC06Infrastructure }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!databaseUrl || !redisUrl || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseScope = `c06-worker-${suffix}`;
  const queueName = `alchemy-video-c06-worker-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const eventId = createPrefixedId("evt");
  const database = createDatabase(databaseUrl);
  const queue = new BullMqInternalEventQueue(redisUrl, { queueName });
  let worker: ReturnType<typeof createBullMqInternalEventWorker> | undefined;
  let objectKey: string | undefined;

  try {
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C06 Mock Worker" }, workspace: { id: workspaceId, name: "C06 Mock Worker" } });
    assert.equal((await control.createProject({
      scope: `${baseScope}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ name: "C06 Mock Worker" }),
      workspaceId,
      projectId,
      name: "C06 Mock Worker",
    })).kind, "NEW");
    assert.equal((await assets.createShot({
      scope: `${baseScope}:shot`,
      idempotencyKey: "shot",
      requestHash: fingerprintRequest({ position: 0, prompt: "C06 Mock Worker shot" }),
      workspaceId,
      projectId,
      shotId,
      position: 0,
      prompt: "C06 Mock Worker shot",
      model: "mock-video-v1",
      generationSettings: {},
      referenceBindings: [],
    })).kind, "NEW");
    assert.equal((await assets.updateShot({
      scope: `${baseScope}:shot-ready`,
      idempotencyKey: "shot-ready",
      requestHash: fingerprintRequest({ status: "READY" }),
      workspaceId,
      shotId,
      status: "READY",
    })).kind, "NEW");

    const taskInput = { model: "mock-video-v1", prompt: "C06 Mock Worker shot", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] };
    assert.equal((await tasks.createTaskRun({
      scope: `${baseScope}:task`,
      idempotencyKey: "task",
      requestHash: fingerprintRequest(taskInput),
      workspaceId,
      taskRunId,
      shotId,
      kind: "VIDEO_GENERATION",
      inputSnapshot: taskInput,
      event: { eventId, messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
    })).kind, "NEW");

    const fixture = await createMockMp4Fixture();
    const provider = new MockVideoProvider({ fixtureBytes: fixture });
    const storage = createS3StoragePort({ endpoint, region, bucket, accessKeyId, secretAccessKey });
    const executor = new MockVideoTaskExecutor(tasks, provider, storage);
    let interrupted = false;
    const interruptedExecutor = {
      async execute(input: { workspaceId: string; taskRunId: string }) {
        if (!interrupted) {
          interrupted = true;
          const attempt = await tasks.ensureProviderAttempt({
            workspaceId: input.workspaceId,
            taskRunId: input.taskRunId,
            providerAttemptId: createPrefixedId("att"),
            provider: "mock",
            model: "mock-video-v1",
            now: new Date(),
          });
          assert.ok(attempt);
          const submission = await provider.submit({ taskRunId: input.taskRunId, inputSnapshot: taskInput });
          await tasks.recordProviderSubmission({
            workspaceId: input.workspaceId,
            taskRunId: input.taskRunId,
            providerAttemptId: attempt!.id,
            providerRequestId: submission.providerRequestId,
            now: new Date(),
          });
          const processing = await provider.getStatus({ providerRequestId: submission.providerRequestId });
          assert.equal(processing.state, "PROCESSING");
          await tasks.recordProviderProcessing({ workspaceId: input.workspaceId, taskRunId: input.taskRunId, providerAttemptId: attempt!.id, now: new Date() });
          throw new Error("Controlled C06 executor interruption after persisted submit and status.");
        }
        return executor.execute(input);
      },
    };
    const consumer = new TaskRunEventConsumer(tasks, { consumerName: "c06-task-run-transition", workerId: `c06-${suffix}`, leaseMs: 30_000 }, interruptedExecutor);
    worker = createBullMqInternalEventWorker({
      redisUrl,
      queueName,
      deadLetterQueueName,
      processor: async (message) => consumer.process(message),
      onTerminalFailure: async ({ event_id, workspace_id, reason }) => consumer.deadLetter({ event_id, workspace_id, reason }),
    });
    await worker.waitUntilReady();

    const relay = new OutboxRelay(tasks, queue, { relayId: `c06-relay-${suffix}`, leaseMs: 30_000, retryDelayMs: 100, maxAttempts: 3, batchSize: 10, workspaceId });
    await relay.runOnce();
    await waitFor(async () => (await tasks.findTaskRun(workspaceId, taskRunId))?.status === "SUCCEEDED", "C06 Mock TaskRun success", 30_000);

    const completed = await tasks.findTaskRun(workspaceId, taskRunId);
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(interrupted, true);
    assert.ok(completed?.resultAssetId);
    const generated = await tasks.findTaskRunResultAsset(workspaceId, completed!.resultAssetId!);
    assert.equal(generated?.status, "READY");
    assert.equal(generated?.mimeType, "video/mp4");
    assert.equal(generated?.width, 160);
    assert.equal(generated?.height, 90);
    objectKey = generated?.objectKey;
    assert.ok(objectKey);
    const inspected = await storage.inspectObject({ objectKey: objectKey! });
    assert.equal(inspected?.sha256, generated?.sha256);
    assert.equal(provider.submitCount, 1);

    await worker.close();
    worker = undefined;
    const restartedProvider = new MockVideoProvider({ fixtureBytes: fixture });
    const replay = await new MockVideoTaskExecutor(tasks, restartedProvider, storage).execute({ workspaceId, taskRunId });
    assert.equal(replay?.status, "SUCCEEDED");
    assert.equal(restartedProvider.submitCount, 0);
  } finally {
    if (worker) await worker.close();
    await queue.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    if (objectKey) {
      const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const cleanup = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
      await cleanup.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => undefined);
      cleanup.destroy();
    }
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C06 startup recovery retries transient storage failures, prefers a persisted request over a later blank attempt, and leaves queued work to one processor", { skip: !hasC06Infrastructure }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!databaseUrl || !redisUrl || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseScope = `c06-recovery-${suffix}`;
  const queueName = `alchemy-video-c06-recovery-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const recoveryShotId = createPrefixedId("sht");
  const queuedShotId = createPrefixedId("sht");
  const terminalShotId = createPrefixedId("sht");
  const nonVideoShotId = createPrefixedId("sht");
  const recoveryTaskRunId = createPrefixedId("tsk");
  const queuedTaskRunId = createPrefixedId("tsk");
  const terminalTaskRunId = createPrefixedId("tsk");
  const nonVideoTaskRunId = createPrefixedId("tsk");
  const database = createDatabase(databaseUrl);
  const queue = new BullMqInternalEventQueue(redisUrl, { queueName });
  let worker: ReturnType<typeof createBullMqInternalEventWorker> | undefined;
  const objectKeys: string[] = [];

  try {
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C06 Recovery Worker" }, workspace: { id: workspaceId, name: "C06 Recovery Worker" } });
    assert.equal((await control.createProject({
      scope: `${baseScope}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ name: "C06 recovery project" }),
      workspaceId,
      projectId,
      name: "C06 recovery project",
    })).kind, "NEW");
    for (const [shotId, position] of [[recoveryShotId, 0], [queuedShotId, 1], [terminalShotId, 2], [nonVideoShotId, 3]] as const) {
      assert.equal((await assets.createShot({
        scope: `${baseScope}:shot:${position}`,
        idempotencyKey: `shot-${position}`,
        requestHash: fingerprintRequest({ position, prompt: `C06 recovery shot ${position}` }),
        workspaceId,
        projectId,
        shotId,
        position,
        prompt: `C06 recovery shot ${position}`,
        model: "mock-video-v1",
        generationSettings: {},
        referenceBindings: [],
      })).kind, "NEW");
      assert.equal((await assets.updateShot({
        scope: `${baseScope}:shot-ready:${position}`,
        idempotencyKey: `shot-ready-${position}`,
        requestHash: fingerprintRequest({ status: "READY" }),
        workspaceId,
        shotId,
        status: "READY",
      })).kind, "NEW");
    }

    const taskInput = { model: "mock-video-v1", prompt: "Recover a durable local Mock video.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] };
    const recoveryEvent = { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") };
    const queuedEvent = { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") };
    assert.equal((await tasks.createTaskRun({
      scope: `${baseScope}:recovery-task`, idempotencyKey: "recovery-task", requestHash: fingerprintRequest(taskInput), workspaceId,
      taskRunId: recoveryTaskRunId, shotId: recoveryShotId, kind: "VIDEO_GENERATION", inputSnapshot: taskInput, event: recoveryEvent,
    })).kind, "NEW");
    await database.db.insert(taskRuns).values([
      {
        id: terminalTaskRunId,
        workspaceId,
        projectId,
        shotId: terminalShotId,
        kind: "VIDEO_GENERATION",
        status: "FAILED",
        inputSnapshot: taskInput,
      },
      {
        id: nonVideoTaskRunId,
        workspaceId,
        projectId,
        shotId: nonVideoShotId,
        kind: "RENDER",
        status: "RUNNING",
        inputSnapshot: taskInput,
      },
    ]);
    assert.equal((await tasks.createTaskRun({
      scope: `${baseScope}:queued-task`, idempotencyKey: "queued-task", requestHash: fingerprintRequest({ ...taskInput, prompt: "Queue after recovery" }), workspaceId,
      taskRunId: queuedTaskRunId, shotId: queuedShotId, kind: "VIDEO_GENERATION", inputSnapshot: { ...taskInput, prompt: "Queue after recovery" }, event: queuedEvent,
    })).kind, "NEW");
    const recoveryEnvelope = (await tasks.listWorkspaceEvents({ workspaceId, limit: 20 })).find((event) => event.event_id === recoveryEvent.eventId);
    assert.ok(recoveryEnvelope && recoveryEnvelope.event_type === "task_run.queued");
    if (!recoveryEnvelope || recoveryEnvelope.event_type !== "task_run.queued") throw new Error("recovery event missing");

    const consumedWithoutExecutor = new TaskRunEventConsumer(tasks, {
      consumerName: "task-run-transition",
      workerId: `c05-completed-${suffix}`,
      leaseMs: 30_000,
    });
    assert.equal(await consumedWithoutExecutor.process({
      contract_version: "1.0",
      event_id: recoveryEnvelope.event_id,
      workspace_id: workspaceId,
      task_run_id: recoveryTaskRunId,
      attempt_no: 1,
      correlation_id: recoveryEnvelope.correlation_id,
      input_snapshot: recoveryEnvelope.data.input_snapshot,
    }), "PROCESSED");
    assert.equal((await tasks.findTaskRun(workspaceId, recoveryTaskRunId))?.status, "RUNNING");
    const [completedConsumption] = await database.db
      .select({ completedAt: eventConsumptions.completedAt })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceId),
        eq(eventConsumptions.eventId, recoveryEvent.eventId),
        eq(eventConsumptions.consumerName, "task-run-transition"),
      ));
    assert.ok(completedConsumption?.completedAt);

    const fixture = await createMockMp4Fixture();
    const provider = new MockVideoProvider({ fixtureBytes: fixture });
    const storage = new FailFirstWritesStorage(
      createS3StoragePort({ endpoint, region, bucket, accessKeyId, secretAccessKey }),
      2,
    );
    const executor = new MockVideoTaskExecutor(tasks, provider, storage);
    const submittedAttempt = await tasks.ensureProviderAttempt({
      workspaceId,
      taskRunId: recoveryTaskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: "mock-video-v1",
      now: new Date(),
    });
    assert.ok(submittedAttempt);
    const submission = await provider.submit({ taskRunId: recoveryTaskRunId, inputSnapshot: taskInput });
    await tasks.recordProviderSubmission({
      workspaceId,
      taskRunId: recoveryTaskRunId,
      providerAttemptId: submittedAttempt!.id,
      providerRequestId: submission.providerRequestId,
      now: new Date(),
    });
    await database.db.insert(providerAttempts).values({
      id: createPrefixedId("att"),
      workspaceId,
      taskRunId: recoveryTaskRunId,
      provider: "mock",
      model: "mock-video-v1",
      status: "CREATED",
      requestPayload: {},
      responsePayload: {},
    });
    const preferredAttempt = await tasks.ensureProviderAttempt({
      workspaceId,
      taskRunId: recoveryTaskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: "mock-video-v1",
      now: new Date(),
    });
    assert.equal(preferredAttempt?.id, submittedAttempt!.id);
    const consumer = new TaskRunEventConsumer(tasks, { consumerName: "task-run-transition", workerId: `c06-recovery-${suffix}`, leaseMs: 30_000 }, executor);
    worker = createBullMqInternalEventWorker({
      redisUrl,
      queueName,
      deadLetterQueueName,
      autoStart: false,
      processor: async (message) => consumer.process(message),
      onTerminalFailure: async ({ event_id, workspace_id, reason }) => consumer.deadLetter({ event_id, workspace_id, reason }),
    });
    await worker.waitUntilReady();
    const recoverableBeforeStart = await tasks.listRecoverableVideoTaskRuns({ limit: 10 });
    assert.deepEqual(recoverableBeforeStart.map((taskRun) => taskRun.id), [recoveryTaskRunId]);
    assert.deepEqual(recoverableBeforeStart.map((taskRun) => taskRun.status), ["PROVIDER_PROCESSING"]);
    const recovered = await recoverC06TaskRuns(executor);
    assert.deepEqual(recovered.map((result) => result.taskRunId), [recoveryTaskRunId]);
    assert.equal(recovered[0]?.attempts, 3);
    assert.equal(recovered[0]?.failure, undefined);
    assert.equal((await tasks.findTaskRun(workspaceId, recoveryTaskRunId))?.status, "SUCCEEDED");
    assert.equal((await tasks.findTaskRun(workspaceId, queuedTaskRunId))?.status, "QUEUED");
    assert.equal((await tasks.findTaskRun(workspaceId, terminalTaskRunId))?.status, "FAILED");
    assert.equal((await tasks.findTaskRun(workspaceId, nonVideoTaskRunId))?.status, "RUNNING");
    assert.equal(provider.submitCount, 1);
    const recoveryAttempts = await tasks.listTaskRunAttempts(workspaceId, recoveryTaskRunId);
    assert.equal(recoveryAttempts.length, 2);
    assert.equal(recoveryAttempts.find((attempt) => attempt.providerRequestId)?.providerRequestId, submission.providerRequestId);

    worker.start();
    const relay = new OutboxRelay(tasks, queue, { relayId: `c06-recovery-relay-${suffix}`, leaseMs: 30_000, retryDelayMs: 100, maxAttempts: 3, batchSize: 10, workspaceId });
    await relay.runOnce();
    await waitFor(async () => (await tasks.findTaskRun(workspaceId, queuedTaskRunId))?.status === "SUCCEEDED", "queued C06 task after startup recovery", 30_000);
    assert.equal(provider.submitCount, 2);
    for (const taskRunId of [recoveryTaskRunId, queuedTaskRunId]) {
      const taskRun = await tasks.findTaskRun(workspaceId, taskRunId);
      assert.ok(taskRun?.resultAssetId);
      const asset = await tasks.findTaskRunResultAsset(workspaceId, taskRun!.resultAssetId!);
      assert.equal(asset?.status, "READY");
      objectKeys.push(asset!.objectKey);
    }
  } finally {
    if (worker) await worker.close();
    await queue.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    if (objectKeys.length > 0) {
      const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const cleanup = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
      await Promise.all(objectKeys.map((Key) => cleanup.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(() => undefined)));
      cleanup.destroy();
    }
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C06 BullMQ exhaustion persists a public retryable failure and public retry resumes download without resubmitting", { skip: !hasC06Infrastructure }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!databaseUrl || !redisUrl || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseScope = `c06-exhaustion-${suffix}`;
  const queueName = `alchemy-video-c06-exhaustion-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const database = createDatabase(databaseUrl);
  const queue = new BullMqInternalEventQueue(redisUrl, { queueName });
  let worker: ReturnType<typeof createBullMqInternalEventWorker> | undefined;
  let objectKey: string | undefined;

  try {
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C06 Exhaustion Worker" }, workspace: { id: workspaceId, name: "C06 Exhaustion Worker" } });
    assert.equal((await control.createProject({
      scope: `${baseScope}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ name: "C06 exhaustion project" }),
      workspaceId,
      projectId,
      name: "C06 exhaustion project",
    })).kind, "NEW");
    assert.equal((await assets.createShot({
      scope: `${baseScope}:shot`,
      idempotencyKey: "shot",
      requestHash: fingerprintRequest({ position: 0, prompt: "C06 exhaustion shot" }),
      workspaceId,
      projectId,
      shotId,
      position: 0,
      prompt: "C06 exhaustion shot",
      model: "mock-video-v1",
      generationSettings: {},
      referenceBindings: [],
    })).kind, "NEW");
    assert.equal((await assets.updateShot({
      scope: `${baseScope}:shot-ready`,
      idempotencyKey: "shot-ready",
      requestHash: fingerprintRequest({ status: "READY" }),
      workspaceId,
      shotId,
      status: "READY",
    })).kind, "NEW");

    const taskInput = { model: "mock-video-v1", prompt: "Persist one Mock request across recovery.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] };
    assert.equal((await tasks.createTaskRun({
      scope: `${baseScope}:task`,
      idempotencyKey: "task",
      requestHash: fingerprintRequest(taskInput),
      workspaceId,
      taskRunId,
      shotId,
      kind: "VIDEO_GENERATION",
      inputSnapshot: taskInput,
      event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
    })).kind, "NEW");

    const fixture = await createMockMp4Fixture();
    const provider = new MockVideoProvider({ fixtureBytes: fixture });
    const storage = new FailFirstWritesStorage(
      createS3StoragePort({ endpoint, region, bucket, accessKeyId, secretAccessKey }),
      3,
    );
    const executor = new MockVideoTaskExecutor(tasks, provider, storage);
    const consumer = new TaskRunEventConsumer(tasks, { consumerName: "task-run-transition", workerId: `c06-exhaustion-${suffix}`, leaseMs: 30_000 }, executor);
    worker = createBullMqInternalEventWorker({
      redisUrl,
      queueName,
      deadLetterQueueName,
      processor: async (message) => consumer.process(message),
      onTerminalFailure: async ({ event_id, workspace_id, task_run_id, reason }) => {
        await consumer.finalizeExecutionFailure({ workspace_id, task_run_id, reason });
        await consumer.deadLetter({ event_id, workspace_id, reason });
      },
    });
    await worker.waitUntilReady();
    const relay = new OutboxRelay(tasks, queue, { relayId: `c06-exhaustion-relay-${suffix}`, leaseMs: 30_000, retryDelayMs: 100, maxAttempts: 3, batchSize: 50, workspaceId });
    await relay.runOnce();
    await waitFor(async () => (await tasks.findTaskRun(workspaceId, taskRunId))?.status === "FAILED", "C06 exhausted task failure", 30_000);

    const failed = await tasks.findTaskRun(workspaceId, taskRunId);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.error?.code, "PROVIDER_UNAVAILABLE");
    assert.equal(failed?.error?.retryable, true);
    const [attempt] = await tasks.listTaskRunAttempts(workspaceId, taskRunId);
    assert.equal(attempt?.status, "DOWNLOAD_FAILED");
    assert.ok(attempt?.providerRequestId);
    assert.equal(provider.submitCount, 1);

    const identity: IdentityPort = { async resolve() { return { userId, workspaceId }; } };
    const app = createApp({ identity, store: control, assetStore: assets, taskStore: tasks, storage });
    const detailResponse = await app.request(`http://localhost/api/v1/task-runs/${taskRunId}`);
    const detail = await detailResponse.json() as { data: { task_run: { status: string; error: { code: string; retryable: boolean } | null } } };
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detail.data.task_run.error, { code: "PROVIDER_UNAVAILABLE", message: "Video execution exhausted its recoverable delivery attempts.", retryable: true });
    assert.equal(detail.data.task_run.status, "FAILED");

    const retryResponse = await app.request(`http://localhost/api/v1/task-runs/${taskRunId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "public-retry-after-exhaustion" },
      body: "{}",
    });
    assert.equal(retryResponse.status, 202);
    await relay.runOnce(new Date(Date.now() + 1_000));
    await waitFor(async () => (await tasks.findTaskRun(workspaceId, taskRunId))?.status === "SUCCEEDED", "C06 public retry download recovery", 30_000);
    const recovered = await tasks.findTaskRun(workspaceId, taskRunId);
    assert.equal(recovered?.status, "SUCCEEDED");
    assert.equal(provider.submitCount, 1);
    assert.ok(recovered?.resultAssetId);
    const asset = await tasks.findTaskRunResultAsset(workspaceId, recovered!.resultAssetId!);
    assert.equal(asset?.status, "READY");
    objectKey = asset?.objectKey;
  } finally {
    if (worker) await worker.close();
    await queue.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    if (objectKey) {
      const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const cleanup = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
      await cleanup.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => undefined);
      cleanup.destroy();
    }
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("C06 startup scan exhausts a no-job recovery into FAILED, then public retry downloads without resubmitting", { skip: !hasC06Infrastructure }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!databaseUrl || !redisUrl || !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseScope = `c06-startup-exhaustion-${suffix}`;
  const queueName = `alchemy-video-c06-startup-exhaustion-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const database = createDatabase(databaseUrl);
  const queue = new BullMqInternalEventQueue(redisUrl, { queueName });
  let worker: ReturnType<typeof createBullMqInternalEventWorker> | undefined;
  let objectKey: string | undefined;

  try {
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C06 Startup Exhaustion" }, workspace: { id: workspaceId, name: "C06 Startup Exhaustion" } });
    assert.equal((await control.createProject({
      scope: `${baseScope}:project`,
      idempotencyKey: "project",
      requestHash: fingerprintRequest({ name: "C06 startup exhaustion project" }),
      workspaceId,
      projectId,
      name: "C06 startup exhaustion project",
    })).kind, "NEW");
    assert.equal((await assets.createShot({
      scope: `${baseScope}:shot`,
      idempotencyKey: "shot",
      requestHash: fingerprintRequest({ position: 0, prompt: "C06 startup exhaustion shot" }),
      workspaceId,
      projectId,
      shotId,
      position: 0,
      prompt: "C06 startup exhaustion shot",
      model: "mock-video-v1",
      generationSettings: {},
      referenceBindings: [],
    })).kind, "NEW");
    assert.equal((await assets.updateShot({
      scope: `${baseScope}:shot-ready`,
      idempotencyKey: "shot-ready",
      requestHash: fingerprintRequest({ status: "READY" }),
      workspaceId,
      shotId,
      status: "READY",
    })).kind, "NEW");

    const taskInput = { model: "mock-video-v1", prompt: "Startup recovery must preserve one Mock request.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] };
    assert.equal((await tasks.createTaskRun({
      scope: `${baseScope}:task`,
      idempotencyKey: "task",
      requestHash: fingerprintRequest(taskInput),
      workspaceId,
      taskRunId,
      shotId,
      kind: "VIDEO_GENERATION",
      inputSnapshot: taskInput,
      event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
    })).kind, "NEW");
    const queued = (await tasks.listWorkspaceEvents({ workspaceId, limit: 10 })).find((event) => event.event_type === "task_run.queued");
    assert.ok(queued && queued.event_type === "task_run.queued");
    if (!queued || queued.event_type !== "task_run.queued") throw new Error("C06 startup queue event missing.");
    const c05Consumer = new TaskRunEventConsumer(tasks, { consumerName: "task-run-transition", workerId: `c05-before-crash-${suffix}`, leaseMs: 30_000 });
    assert.equal(await c05Consumer.process({
      contract_version: "1.0",
      event_id: queued.event_id,
      workspace_id: workspaceId,
      task_run_id: taskRunId,
      attempt_no: 1,
      correlation_id: queued.correlation_id,
      input_snapshot: queued.data.input_snapshot,
    }), "PROCESSED");
    assert.equal((await tasks.findTaskRun(workspaceId, taskRunId))?.status, "RUNNING");

    const fixture = await createMockMp4Fixture();
    const provider = new MockVideoProvider({ fixtureBytes: fixture });
    const storage = new FailFirstWritesStorage(
      createS3StoragePort({ endpoint, region, bucket, accessKeyId, secretAccessKey }),
      3,
    );
    const executor = new MockVideoTaskExecutor(tasks, provider, storage);
    const recoveryConsumer = new TaskRunEventConsumer(tasks, { consumerName: "task-run-transition", workerId: `c06-startup-${suffix}`, leaseMs: 30_000 }, executor);
    worker = createBullMqInternalEventWorker({
      redisUrl,
      queueName,
      deadLetterQueueName,
      autoStart: false,
      processor: async (message) => recoveryConsumer.process(message),
      onTerminalFailure: async ({ event_id, workspace_id, task_run_id, reason }) => {
        await recoveryConsumer.finalizeExecutionFailure({ workspace_id, task_run_id, reason });
        await recoveryConsumer.deadLetter({ event_id, workspace_id, reason });
      },
    });
    await worker.waitUntilReady();
    const scan = await recoverC06TaskRuns(executor, {
      maxAttempts: 3,
      finalizeFailure: ({ workspaceId: failedWorkspaceId, taskRunId: failedTaskRunId, reason }) =>
        recoveryConsumer.finalizeExecutionFailure({ workspace_id: failedWorkspaceId, task_run_id: failedTaskRunId, reason }),
    });
    assert.deepEqual(scan.map((result) => ({ taskRunId: result.taskRunId, attempts: result.attempts, failed: Boolean(result.failure) })), [{ taskRunId, attempts: 3, failed: true }]);
    const failed = await tasks.findTaskRun(workspaceId, taskRunId);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.error?.retryable, true);
    const [attempt] = await tasks.listTaskRunAttempts(workspaceId, taskRunId);
    assert.equal(attempt?.status, "DOWNLOAD_FAILED");
    assert.ok(attempt?.providerRequestId);
    assert.equal(provider.submitCount, 1);

    const identity: IdentityPort = { async resolve() { return { userId, workspaceId }; } };
    const app = createApp({ identity, store: control, assetStore: assets, taskStore: tasks, storage });
    const retryResponse = await app.request(`http://localhost/api/v1/task-runs/${taskRunId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "startup-scan-public-retry" },
      body: "{}",
    });
    assert.equal(retryResponse.status, 202);
    const retried = (await tasks.listWorkspaceEvents({ workspaceId, limit: 30 }))
      .filter((event) => event.event_type === "task_run.queued")
      .at(-1);
    assert.ok(retried && retried.event_type === "task_run.queued");
    if (!retried || retried.event_type !== "task_run.queued") throw new Error("C06 startup retry event missing.");
    assert.equal(await recoveryConsumer.process({
      contract_version: "1.0",
      event_id: retried.event_id,
      workspace_id: workspaceId,
      task_run_id: taskRunId,
      attempt_no: 1,
      correlation_id: retried.correlation_id,
      input_snapshot: retried.data.input_snapshot,
    }), "PROCESSED");
    const recovered = await tasks.findTaskRun(workspaceId, taskRunId);
    assert.equal(recovered?.status, "SUCCEEDED");
    assert.equal(provider.submitCount, 1);
    assert.ok(recovered?.resultAssetId);
    objectKey = (await tasks.findTaskRunResultAsset(workspaceId, recovered!.resultAssetId!))?.objectKey;
  } finally {
    if (worker) await worker.close();
    await queue.close();
    await clearInternalEventQueues({ redisUrl, queueName, deadLetterQueueName });
    if (objectKey) {
      const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const cleanup = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
      await cleanup.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => undefined);
      cleanup.destroy();
    }
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
