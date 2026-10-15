import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createServer, connect, type Socket } from "node:net";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";

import type { InternalTaskRunQueueMessage } from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";
import { createDatabase, DrizzleAssetWorkspaceRepository, DrizzleControlPlaneRepository, DrizzleTaskRunRepository, eventConsumptions, outboxEvents, PostgresTaskRunExecutionGuard, providerAttempts, TaskRunExecutionBusyError, TaskRunExecutionOwnershipLostError, users, workspaces } from "@alchemy-video/persistence";
import { createMockMp4Fixture, MockVideoProvider, type VideoProviderPort } from "@alchemy-video/provider-video";
import { createInMemoryStoragePort, createS3StoragePort } from "@alchemy-video/storage-client";
import { BullMqInternalEventQueue, clearInternalEventQueues, createBullMqInternalEventWorker, InternalEventDeferredError, InternalEventRequiresRecoveryError } from "@alchemy-video/task-queue";

import { MockVideoTaskExecutor } from "../src/execution-service.js";
import { ReferenceDeliveryUnavailableError } from "../src/reference-delivery.js";
import { recoverC06TaskRuns, TaskRunEventConsumer } from "../src/service.js";
import { acquireC06E2EIsolation } from "../../../packages/persistence/tests/support/c06-e2e-isolation.mjs";
import { withTestExecutionFence } from "../../../packages/persistence/tests/execution-fence-test-helper.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const WallClock = Date;
let isolation: Awaited<ReturnType<typeof acquireC06E2EIsolation>> | undefined;
before(async () => { if (databaseUrl) isolation = await acquireC06E2EIsolation(databaseUrl, { timeoutMs: 120_000, verifyIdle: false }); });
after(async () => { await isolation?.release(); });
const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });
const timeout = { skip: !databaseUrl, timeout: 30_000 };
const waitFor = async (predicate: () => Promise<boolean> | boolean) => {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Controlled integration condition was not reached.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const prepare = async (reference = false, firstEventId?: string) => {
  assert.ok(databaseUrl);
  const database = createDatabase(databaseUrl);
  const otherDatabase = createDatabase(databaseUrl);
  const store = withTestExecutionFence(new DrizzleTaskRunRepository(database.db));
  const otherStore = withTestExecutionFence(new DrizzleTaskRunRepository(otherDatabase.db));
  const assets = new DrizzleAssetWorkspaceRepository(database.db);
  const control = new DrizzleControlPlaneRepository(database.db);
  const workspaceId = createPrefixedId("ws");
  const userId = createPrefixedId("usr");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const command = (suffix: string) => ({ scope: `${taskRunId}:${suffix}`, idempotencyKey: suffix, requestHash: "a".repeat(64) });
  await control.ensureDevIdentity({ user: { id: userId, displayName: "Execution closure" }, workspace: { id: workspaceId, name: "Execution closure" } });
  await control.createProject({ ...command("project"), workspaceId, projectId, name: "Offline execution closure" });
  const assetId = createPrefixedId("ast");
  if (reference) {
    await assets.createUploadAsset({ ...command("reference"), workspaceId, projectId, assetId, kind: "IMAGE", objectKey: `${workspaceId}/${projectId}/${assetId}/original.png`, filename: "fixture.png", mimeType: "image/png", byteSize: 3 });
    await assets.confirmAssetUpload({ ...command("confirm"), workspaceId, assetId, sha256: "a".repeat(64), mimeType: "image/png", byteSize: 3, verifyUpload: async () => true });
  }
  await assets.createShot({ ...command("shot"), workspaceId, projectId, shotId, position: 0, prompt: "Offline closure fixture.", model: "mock-video-v1", generationSettings: {}, referenceBindings: reference ? [{ assetId, role: "STYLE", position: 0 }] : [] });
  await assets.updateShot({ ...command("ready"), workspaceId, shotId, status: "READY" });
  await store.createTaskRun({ ...command("task"), workspaceId, taskRunId, shotId, kind: "VIDEO_GENERATION", inputSnapshot: { model: "mock-video-v1", prompt: "Offline closure fixture.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: reference ? [assetId] : [], ...(reference ? { visual_input: { mode: "REFERENCE_SET" as const, references: [{ asset_id: assetId, sha256: "a".repeat(64), mime_type: "image/png" as const, position: 0 }] } } : {}) }, event: { ...event(), ...(firstEventId ? { eventId: firstEventId } : {}) } });
  const message = async (): Promise<InternalTaskRunQueueMessage> => {
    const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 100 })).filter((item) => item.event_type === "task_run.queued").at(-1);
    assert.ok(queued?.event_type === "task_run.queued");
    return { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot };
  };
  const storage = process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? createS3StoragePort({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", bucket: process.env.S3_BUCKET ?? "video-local", accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY })
    : createInMemoryStoragePort();
  const consumer = (executor: MockVideoTaskExecutor, alternate = false) => new TaskRunEventConsumer(alternate ? otherStore : store, { consumerName: "execution-closure", workerId: alternate ? "second" : "first", leaseMs: 100 }, executor);
  const retry = async (suffix: string) => {
    assert.equal((await store.retryTaskRun({ ...command(suffix), workspaceId, taskRunId, event: event() })).kind, "NEW");
    return message();
  };
  return { database, store, otherStore, assets, workspaceId, taskRunId, storage, consumer, message, retry, async close() {
    await database.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await database.db.delete(users).where(eq(users.id, userId));
    await otherDatabase.close();
    await database.close();
  } };
};

test("PostgreSQL consumer, duplicate BullMQ delivery and executor preserve a slow POST through more than three busy deliveries", { ...timeout, skip: !databaseUrl || !redisUrl }, async () => {
  const context = await prepare();
  const base = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const accepted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fourDeferrals = Promise.withResolvers<void>();
  let deferrals = 0;
  let terminalCalls = 0;
  const provider: VideoProviderPort = {
    async submit(input) { accepted.resolve(); await release.promise; return base.submit(input); },
    getStatus: (input) => base.getStatus(input),
    download: (input) => base.download(input),
  };
  const firstExecutor = new MockVideoTaskExecutor(context.store, provider, context.storage, { maxPollAttempts: 1 });
  const secondExecutor = new MockVideoTaskExecutor(context.otherStore, provider, context.storage);
  const firstConsumer = context.consumer(firstExecutor);
  const secondConsumer = context.consumer(secondExecutor, true);
  const message = await context.message();
  const queueName = `closure-${context.taskRunId}`;
  const deadLetterQueueName = `${queueName}-dead`;
  const queue = new BullMqInternalEventQueue(redisUrl!, { queueName });
  const worker = createBullMqInternalEventWorker({ redisUrl: redisUrl!, queueName, deadLetterQueueName, autoStart: false,
    processor: async (value) => {
      try { await secondConsumer.process(value); }
      catch (error) {
        if (error instanceof InternalEventDeferredError && ++deferrals >= 4) fourDeferrals.resolve();
        throw error;
      }
    },
    onTerminalFailure: async (value) => { terminalCalls += 1; await secondConsumer.finalizeExecutionFailure(value); },
  });
  let first: Promise<void> | undefined;
  try {
    first = assert.rejects(firstConsumer.process(message), /still processing/);
    await accepted.promise;
    assert.equal((await secondExecutor.recover({ limit: 100, maxAttempts: 3 })).find((item) => item.taskRunId === context.taskRunId)?.deferred, true);
    await assert.rejects(secondConsumer.finalizeExecutionFailure({ ...message, reason: "stale exhausted callback" }), TaskRunExecutionBusyError);
    await worker.waitUntilReady();
    await queue.enqueue(message);
    worker.start();
    await fourDeferrals.promise;
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "RUNNING");
    assert.equal(terminalCalls, 0);
    release.resolve();
    await first;
    await waitFor(async () => (await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status === "SUCCEEDED");
    await secondConsumer.process(message);
    assert.equal(base.submitCount, 1);
    assert.equal(terminalCalls, 0);
    assert.equal((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId)).length, 1);
    const consumptions = await context.database.db.select().from(eventConsumptions).where(and(eq(eventConsumptions.workspaceId, context.workspaceId), eq(eventConsumptions.eventId, message.event_id)));
    assert.equal(consumptions.length, 1);
    assert.ok(consumptions[0]?.completedAt);
  } finally {
    release.resolve();
    await first?.catch(() => undefined);
    await worker.close();
    await queue.close();
    await clearInternalEventQueues({ redisUrl: redisUrl!, queueName, deadLetterQueueName });
    await context.close();
  }
});

test("PostgreSQL consumer exhaustion and reference preflight preserve terminal history then permit one fresh attempt", timeout, async () => {
  const context = await prepare(true);
  const fixtureBytes = await createMockMp4Fixture();
  const failedProvider = new MockVideoProvider({ fixtureBytes, outcome: "failed" });
  const delivery = { async createVisualInput() { return { mode: "REFERENCE_SET" as const, urls: ["https://offline.invalid/reference"] }; } };
  try {
    const initial = context.consumer(new MockVideoTaskExecutor(context.store, failedProvider, context.storage, { assetStore: context.assets, referenceDelivery: delivery }));
    const originalMessage = await context.message();
    await initial.process(originalMessage);
    const retried = await context.retry("retry-read-outage");
    const before = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
    assert.equal(before[0]?.status, "ABANDONED");
    assert.equal(before[0]?.responsePayload.provider_request_terminal, true);
    const newProvider = new MockVideoProvider({ fixtureBytes });
    const outage = context.consumer(new MockVideoTaskExecutor(context.store, newProvider, context.storage, { assetStore: { async findAsset() { throw new Error("Controlled read outage."); } }, referenceDelivery: delivery }));
    for (let index = 0; index < 3; index += 1) await assert.rejects(outage.process(retried), /could not complete/);
    await outage.finalizeExecutionFailure({ ...retried, reason: "controlled exhaustion" });
    assert.deepEqual(await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId), before);
    assert.equal(newProvider.submitCount, 0);
    const retryRelay = await context.retry("retry-relay-outage");
    await outage.finalizeExecutionFailure({ ...originalMessage, reason: "late callback from the old event" });
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "QUEUED");
    const relayOutage = context.consumer(new MockVideoTaskExecutor(context.store, newProvider, context.storage, { assetStore: context.assets, referenceDelivery: { async createVisualInput() { throw new ReferenceDeliveryUnavailableError("", true, "HTTP_STATUS"); } } }));
    await relayOutage.process(retryRelay);
    const failed = await context.store.findTaskRun(context.workspaceId, context.taskRunId);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.error?.code, "STORAGE_UNAVAILABLE");
    assert.deepEqual(await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId), before);
    const finalMessage = await context.retry("retry-success");
    await context.consumer(new MockVideoTaskExecutor(context.otherStore, newProvider, context.storage, { assetStore: context.assets, referenceDelivery: delivery }), true).process(finalMessage);
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "SUCCEEDED");
    const finalAttempts = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
    assert.equal(finalAttempts.length, 2);
    assert.deepEqual(finalAttempts[0], before[0]);
    assert.equal(newProvider.submitCount, 1);
  } finally { await context.close(); }
});

test("PostgreSQL execution guards use independent sessions, release on errors, and do not consume the repository pool", timeout, async () => {
  const context = await prepare();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const guard = new PostgresTaskRunExecutionGuard({ connectionString: databaseUrl });
  const otherGuard = new PostgresTaskRunExecutionGuard({ connectionString: databaseUrl });
  const owner = guard.withTaskRunExecution(context, async () => { entered.resolve(); await release.promise; throw new Error("original callback failure"); });
  const rejected = assert.rejects(owner, /original callback failure/);
  try {
    await entered.promise;
    await assert.rejects(otherGuard.withTaskRunExecution(context, async () => undefined), TaskRunExecutionBusyError);
    await otherGuard.withTaskRunExecution({ ...context, workspaceId: createPrefixedId("ws") }, async () => undefined);
    await Promise.all(Array.from({ length: 12 }, (_, index) => otherGuard.withTaskRunExecution({ ...context, taskRunId: `${context.taskRunId}-${index}` }, async () => {
      assert.ok(await context.store.findTaskRun(context.workspaceId, context.taskRunId));
    })));
    release.resolve();
    await rejected;
    await otherGuard.withTaskRunExecution(context, async () => undefined);
  } finally { release.resolve(); await rejected; await context.close(); }
});

test("PostgreSQL guard disconnect invalidates the owner and makes its session lock recoverable", timeout, async () => {
  const applicationName = `closure-${createPrefixedId("tsk")}`;
  const guard = new PostgresTaskRunExecutionGuard({ connectionString: databaseUrl, application_name: applicationName });
  const other = new PostgresTaskRunExecutionGuard({ connectionString: databaseUrl });
  const admin = new Pool({ connectionString: databaseUrl });
  const scope = { workspaceId: createPrefixedId("ws"), taskRunId: createPrefixedId("tsk") };
  try {
    await assert.rejects(guard.withTaskRunExecution(scope, async (assertActive) => {
      const result = await admin.query<{ pid: number }>("select pid from pg_stat_activity where application_name = $1", [applicationName]);
      assert.equal(result.rows.length, 1);
      await admin.query("select pg_terminate_backend($1)", [result.rows[0]!.pid]);
      await waitFor(() => { try { assertActive(); return false; } catch { return true; } });
      assertActive();
    }), TaskRunExecutionOwnershipLostError);
    await other.withTaskRunExecution(scope, async () => undefined);
  } finally { await admin.end(); }
});

test("PostgreSQL execution fence rejects every stale state writer and limits late Provider IDs to evidence-only", timeout, async () => {
  const context = await prepare();
  try {
    await new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "fence-test", leaseMs: 100 }).process(await context.message());
    const rawStore = new DrizzleTaskRunRepository(context.database.db);
    let staleToken = "";
    await rawStore.withTaskRunExecution(context, async (lease) => { staleToken = lease.fenceToken; });
    let freshToken = "";
    await rawStore.withTaskRunExecution(context, async (lease) => {
      freshToken = lease.fenceToken;
      assert.notEqual(freshToken, staleToken);
      const beforeTask = await rawStore.findTaskRun(context.workspaceId, context.taskRunId);
      const beforeAttempts = await rawStore.listTaskRunAttempts(context.workspaceId, context.taskRunId);
      const beforeEvents = await rawStore.listWorkspaceEvents({ workspaceId: context.workspaceId, limit: 100 });
      const attemptId = createPrefixedId("att");

      await assert.rejects(rawStore.ensureProviderAttempt({ ...context, executionFenceToken: staleToken, providerAttemptId: createPrefixedId("att"), provider: "mock", model: "mock-video-v1", now: new Date() }), TaskRunExecutionOwnershipLostError);
      const attempt = await rawStore.ensureProviderAttempt({ ...context, executionFenceToken: freshToken, providerAttemptId: attemptId, provider: "mock", model: "mock-video-v1", now: new Date() });
      assert.ok(attempt);
      assert.equal(await rawStore.reserveProviderSubmission({ ...context, executionFenceToken: freshToken, providerAttemptId: attemptId, now: new Date() }), true);

      const staleWrites = [
        () => rawStore.reserveProviderSubmission({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, now: new Date() }),
        () => rawStore.recordProviderProcessing({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, now: new Date() }),
        () => rawStore.beginDownload({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, now: new Date() }),
        () => rawStore.recordDownloadRetryableFailure({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, code: "DOWNLOAD_INVALID", now: new Date() }),
        () => rawStore.ensureGeneratedAsset({ ...context, executionFenceToken: staleToken, assetId: createPrefixedId("ast"), objectKey: "stale/fenced.mp4", provider: "mock", now: new Date() }),
        () => rawStore.completeGeneratedTaskRun({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, assetId: createPrefixedId("ast"), sha256: "a".repeat(64), byteSize: 1, width: 16, height: 9, durationMs: 1000, now: new Date() }),
        () => rawStore.markBillingSucceeded({ ...context, executionFenceToken: staleToken, usageRecordId: createPrefixedId("use"), now: new Date() }),
        () => rawStore.markBillingFailed({ ...context, executionFenceToken: staleToken, code: "CREDIT_UNAVAILABLE", safeMessage: "stale", now: new Date() }),
        () => rawStore.scheduleBillingRetry({ ...context, executionFenceToken: staleToken, code: "CREDIT_UNAVAILABLE", safeMessage: "stale", retryAt: new Date(), now: new Date() }),
        () => rawStore.resumeBillingRetry({ ...context, executionFenceToken: staleToken, now: new Date() }),
        () => rawStore.failTaskRun({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, code: "PROVIDER_UNAVAILABLE", message: "stale", retryable: true, now: new Date() }),
      ];
      for (const write of staleWrites) await assert.rejects(write(), TaskRunExecutionOwnershipLostError);
      await assert.rejects(rawStore.failTaskRun({ ...context, executionFenceToken: "", code: "MISSING_OWNER", message: "missing owner", retryable: true, now: new Date() }), TaskRunExecutionOwnershipLostError);
      await assert.rejects(rawStore.failTaskRun({ ...context, workspaceId: createPrefixedId("ws"), executionFenceToken: freshToken, code: "WRONG_WORKSPACE", message: "wrong workspace", retryable: true, now: new Date() }), TaskRunExecutionOwnershipLostError);

      const staleAcceptedId = await rawStore.recordProviderSubmission({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, providerRequestId: "late-accepted-request", now: new Date() });
      assert.equal(staleAcceptedId?.status, "RUNNING");
      const lateAttempt = (await rawStore.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0];
      assert.equal(lateAttempt?.providerRequestId, "late-accepted-request");
      assert.equal(lateAttempt?.status, "CREATED", "late evidence must not rewrite attempt state");
      await assert.rejects(rawStore.recordProviderSubmission({ ...context, executionFenceToken: staleToken, providerAttemptId: attemptId, providerRequestId: "conflicting-request", now: new Date() }), /PROVIDER_RESUBMIT_FORBIDDEN/u);

      const afterTask = await rawStore.findTaskRun(context.workspaceId, context.taskRunId);
      assert.equal(afterTask?.status, beforeTask?.status);
      assert.equal(afterTask?.error, beforeTask?.error);
      const afterEvents = await rawStore.listWorkspaceEvents({ workspaceId: context.workspaceId, limit: 100 });
      assert.equal(afterEvents.length, beforeEvents.length, "stale paths must not emit outbox events");
      assert.equal((await rawStore.listTaskRunAttempts(context.workspaceId, context.taskRunId)).length, beforeAttempts.length + 1);

      const failureAdmin = new Pool({ connectionString: databaseUrl });
      const suffix = randomUUID().replaceAll("-", "");
      const triggerName = `fence_rollback_${suffix}`;
      const functionName = `fence_rollback_fn_${suffix}`;
      const workspaceLiteral = context.workspaceId.replaceAll("'", "''");
      try {
        await failureAdmin.query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id::text = TG_ARGV[0] THEN RAISE EXCEPTION 'injected fenced transaction failure'; END IF; RETURN NEW; END $$`);
        await failureAdmin.query(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON shots FOR EACH ROW EXECUTE FUNCTION public.${functionName}('${workspaceLiteral}')`);
        const beforeRollbackTask = await rawStore.findTaskRun(context.workspaceId, context.taskRunId);
        const beforeRollbackAttempts = await rawStore.listTaskRunAttempts(context.workspaceId, context.taskRunId);
        const beforeRollbackEvents = await rawStore.listWorkspaceEvents({ workspaceId: context.workspaceId, limit: 100 });
        await assert.rejects(
          rawStore.failTaskRun({ ...context, executionFenceToken: freshToken, providerAttemptId: attemptId, code: "INJECTED", message: "rollback probe", retryable: true, now: new Date() }),
          (error: Error & { cause?: Error }) => error.cause?.message === "injected fenced transaction failure",
        );
        assert.deepEqual(await rawStore.findTaskRun(context.workspaceId, context.taskRunId), beforeRollbackTask, "TaskRun transition must roll back with the failed transaction");
        assert.deepEqual(await rawStore.listTaskRunAttempts(context.workspaceId, context.taskRunId), beforeRollbackAttempts, "Attempt write must roll back with the failed transaction");
        assert.deepEqual(await rawStore.listWorkspaceEvents({ workspaceId: context.workspaceId, limit: 100 }), beforeRollbackEvents, "Outbox must remain unchanged after rollback");
      } finally {
        await failureAdmin.query(`DROP TRIGGER IF EXISTS ${triggerName} ON shots`).catch(() => undefined);
        await failureAdmin.query(`DROP FUNCTION IF EXISTS public.${functionName}()`).catch(() => undefined);
        await failureAdmin.end();
      }

      const failed = await rawStore.failTaskRun({ ...context, executionFenceToken: freshToken, code: "PROVIDER_UNAVAILABLE", message: "Controlled fence revocation.", retryable: true, now: new Date() });
      assert.equal(failed?.status, "FAILED");
      assert.equal((await rawStore.retryTaskRun({ scope: `fence-retry:${context.taskRunId}`, idempotencyKey: "retry", requestHash: "c".repeat(64), ...context, event: event() })).kind, "NEW");
      await assert.rejects(rawStore.failTaskRun({ ...context, executionFenceToken: freshToken, code: "PROVIDER_UNAVAILABLE", message: "stale after retry", retryable: true, now: new Date() }), TaskRunExecutionOwnershipLostError);
      assert.equal((await rawStore.findTaskRun(context.workspaceId, context.taskRunId))?.status, "QUEUED");
    });
  } finally { await context.close(); }
});

test("PostgreSQL fence claim waits for an already-authorized row transaction, then replaces its token", timeout, async () => {
  const context = await prepare();
  const admin = new Pool({ connectionString: databaseUrl });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let rowClient: Awaited<ReturnType<Pool["connect"]>> | undefined;
  let oldToken = "";
  let newToken = "";
  const rawStore = new DrizzleTaskRunRepository(context.database.db);
  let oldOwner: Promise<unknown> | undefined;
  let newOwner: Promise<unknown> | undefined;
  try {
    await new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "fence-handoff", leaseMs: 100 }).process(await context.message());
    oldOwner = rawStore.withTaskRunExecution(context, async (lease) => {
      oldToken = lease.fenceToken;
      rowClient = await admin.connect();
      await rowClient.query("begin");
      const locked = await rowClient.query("select id from task_runs where workspace_id = $1 and id = $2 and execution_fence_token = $3 for update", [context.workspaceId, context.taskRunId, oldToken]);
      assert.equal(locked.rowCount, 1);
      const updated = await rowClient.query("update task_runs set updated_at = updated_at where workspace_id = $1 and id = $2 and execution_fence_token = $3 returning id", [context.workspaceId, context.taskRunId, oldToken]);
      assert.equal(updated.rowCount, 1, "the row transaction is authorized by its expected token");
      entered.resolve();
      await release.promise;
      await rowClient.query("commit");
      rowClient.release();
      rowClient = undefined;
      lease.assertActive();
    });
    const oldOwnerRejected = assert.rejects(oldOwner, TaskRunExecutionOwnershipLostError);
    await entered.promise;

    const digest = createHash("sha256").update(JSON.stringify(["video-execution-v1", context.workspaceId, context.taskRunId])).digest();
    const key = [digest.readInt32BE(0) >>> 0, digest.readInt32BE(4) >>> 0];
    const lock = await admin.query<{ pid: number }>("select pid from pg_locks where locktype = 'advisory' and classid = $1 and objid = $2 and objsubid = 2 and granted", key);
    assert.equal(lock.rows.length, 1);
    await admin.query("select pg_terminate_backend($1)", [lock.rows[0]!.pid]);

    let replacementEntered = false;
    newOwner = context.otherStore.withTaskRunExecution(context, async (lease) => { replacementEntered = true; newToken = lease.fenceToken; });
    await waitFor(async () => {
      const blocked = await admin.query<{ count: string }>("select count(*)::text as count from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%task_runs%'");
      return Number(blocked.rows[0]?.count ?? 0) > 0;
    });
    assert.equal(replacementEntered, false, "replacement claim must wait for the older authorized transaction to commit");

    release.resolve();
    await Promise.all([oldOwnerRejected, newOwner]);
    assert.ok(newToken);
    assert.notEqual(newToken, oldToken);
    const rows = await admin.query<{ execution_fence_token: string }>("select execution_fence_token from task_runs where workspace_id = $1 and id = $2", [context.workspaceId, context.taskRunId]);
    assert.equal(rows.rows[0]?.execution_fence_token, newToken);
    await assert.rejects(rawStore.failTaskRun({ ...context, executionFenceToken: oldToken, code: "PROVIDER_UNAVAILABLE", message: "stale after replacement", retryable: true, now: new Date() }), TaskRunExecutionOwnershipLostError);
    assert.equal((await rawStore.findTaskRun(context.workspaceId, context.taskRunId))?.status, "RUNNING");
  } finally {
    release.resolve();
    if (rowClient) { await rowClient.query("rollback").catch(() => undefined); rowClient.release(); }
    await Promise.allSettled([...(oldOwner ? [oldOwner] : []), ...(newOwner ? [newOwner] : [])]);
    await admin.end();
    await context.close();
  }
});

test("a recovered owner preserves a late Provider ID after the execution guard connection is lost", { ...timeout, skip: !databaseUrl }, async () => {
  const context = await prepare();
  const admin = new Pool({ connectionString: databaseUrl });
  const base = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let submitCalls = 0;
  let first: Promise<unknown> | undefined;
  try {
    const message = await context.message();
    const provider: VideoProviderPort = {
      async submit(input) { submitCalls += 1; entered.resolve(); await release.promise; return base.submit(input); },
      getStatus: (input) => base.getStatus(input),
      download: (input) => base.download(input),
    };
    first = context.consumer(new MockVideoTaskExecutor(context.store, provider, context.storage)).process(message);
    await entered.promise;
    assert.deepEqual(await context.store.listRecoverableKnownProviderTaskRuns!({ limit: 10 }), [], "a reserved but unknown submission must never enter automatic polling recovery");

    const digest = createHash("sha256").update(JSON.stringify(["video-execution-v1", context.workspaceId, context.taskRunId])).digest();
    const key = [digest.readInt32BE(0) >>> 0, digest.readInt32BE(4) >>> 0];
    const lock = await admin.query<{ pid: number }>("select pid from pg_locks where locktype = 'advisory' and classid = $1 and objid = $2 and objsubid = 2 and granted", key);
    assert.equal(lock.rows.length, 1, "the held Provider request must own its PostgreSQL session lock");
    const terminated = await admin.query<{ terminated: boolean }>("select pg_terminate_backend($1) as terminated", [lock.rows[0]!.pid]);
    assert.equal(terminated.rows[0]?.terminated, true);

    await assert.rejects(
      new MockVideoTaskExecutor(context.otherStore, provider, context.storage).execute({ workspaceId: context.workspaceId, taskRunId: context.taskRunId, recovery: true }),
      /video submission is already reserved/u,
    );
    const deferredFinalization = await context.store.finalizeTaskRunExecutionFailure({ ...context, expectedQueuedEventId: message.event_id, code: "PROVIDER_UNAVAILABLE", message: "Duplicate delivery exhausted while the original POST is still unresolved.", now: new Date() });
    assert.equal(deferredFinalization?.status, "RUNNING", "queue exhaustion must not terminalize an unresolved submission owned by the in-flight POST");
    assert.equal(deferredFinalization?.error, null);
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "RUNNING", "recovery must not terminalize an in-flight POST reservation");

    release.resolve();
    await assert.rejects(first, InternalEventDeferredError);
    const lateAttempt = (await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0];
    assert.ok(lateAttempt?.providerRequestId);
    assert.equal(submitCalls, 1);
    assert.equal(base.submitCount, 1);
    assert.deepEqual((await context.store.listRecoverableKnownProviderTaskRuns!({ limit: 10 })).map((task) => task.id), [context.taskRunId]);

    const resumed = await recoverC06TaskRuns(new MockVideoTaskExecutor(context.otherStore, provider, context.storage), {
      limit: 25,
      maxAttempts: 1,
      knownProviderRequestOnly: true,
      deferRetryableErrors: true,
    });
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0]?.status, "SUCCEEDED", "periodic recovery must poll the late persisted request ID");
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "SUCCEEDED");
    assert.equal(submitCalls, 1, "reconciliation of the late persisted Provider ID must not POST again");
    assert.equal(base.submitCount, 1);
  } finally {
    release.resolve();
    if (first) await Promise.allSettled([first]);
    await admin.end();
    await context.close();
  }
});

test("PostgreSQL finalization defers a migrated abandoned no-ID reservation without rewriting history", timeout, async () => {
  const context = await prepare();
  try {
    const message = await context.message();
    await new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "first", leaseMs: 100 }).process(message);
    const attempt = await context.store.ensureProviderAttempt({ ...context, providerAttemptId: createPrefixedId("att"), provider: "mock", model: "mock-video-v1", now: new Date() });
    assert.ok(attempt);
    await context.store.reserveProviderSubmission({ ...context, providerAttemptId: attempt.id, now: new Date() });
    await context.database.db.update(providerAttempts).set({ status: "ABANDONED" }).where(and(eq(providerAttempts.workspaceId, context.workspaceId), eq(providerAttempts.id, attempt.id)));
    const before = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
    const result = await context.store.finalizeTaskRunExecutionFailure({ ...context, expectedQueuedEventId: message.event_id, code: "PROVIDER_UNAVAILABLE", message: "Controlled exhaustion.", now: new Date() });
    assert.equal(result?.status, "RUNNING");
    assert.equal(result?.error, null);
    assert.deepEqual(await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId), before);
  } finally { await context.close(); }
});

test("PostgreSQL startup recovery preserves a migrated abandoned no-ID reservation row", timeout, async () => {
  const context = await prepare();
  try {
    const message = await context.message();
    await new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "first", leaseMs: 100 }).process(message);
    const attempt = await context.store.ensureProviderAttempt({ ...context, providerAttemptId: createPrefixedId("att"), provider: "mock", model: "mock-video-v1", now: new Date() });
    assert.ok(attempt);
    assert.equal(await context.store.reserveProviderSubmission({ ...context, providerAttemptId: attempt.id, now: new Date() }), true);
    await context.database.db.update(providerAttempts).set({ status: "ABANDONED", responsePayload: { legacy_marker: "must-remain" } }).where(and(eq(providerAttempts.workspaceId, context.workspaceId), eq(providerAttempts.id, attempt.id)));
    const before = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);

    const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
    await assert.rejects(
      new MockVideoTaskExecutor(context.store, provider, context.storage).execute({ workspaceId: context.workspaceId, taskRunId: context.taskRunId, recovery: true }),
      /video submission is already reserved/u,
    );
    const result = await context.store.findTaskRun(context.workspaceId, context.taskRunId);
    assert.equal(result?.status, "RUNNING");
    assert.equal(provider.submitCount, 0);
    assert.deepEqual(await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId), before);
  } finally { await context.close(); }
});

test("PostgreSQL unlock blackhole has bounded cleanup and preserves the original callback error", timeout, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  const backendPort = Number(target.port || 5432);
  let blackhole = false;
  const sockets = new Set<Socket>();
  const proxy = createServer((client) => {
    const backend = connect({ host: target.hostname, port: backendPort });
    sockets.add(client); sockets.add(backend);
    client.on("data", (bytes) => { if (!blackhole) backend.write(bytes); });
    backend.on("data", (bytes) => { if (!blackhole) client.write(bytes); });
    client.on("error", () => backend.destroy());
    backend.on("error", () => client.destroy());
    client.on("close", () => { sockets.delete(client); backend.destroy(); });
    backend.on("close", () => { sockets.delete(backend); client.destroy(); });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  target.port = String(address.port);
  const scope = { workspaceId: createPrefixedId("ws"), taskRunId: createPrefixedId("tsk") };
  const original = new Error("Original callback must survive cleanup.");
  const began = Date.now();
  try {
    await assert.rejects(new PostgresTaskRunExecutionGuard({ connectionString: target.href }).withTaskRunExecution(scope, async () => {
      blackhole = true;
      throw original;
    }), (error) => error === original);
    assert.ok(Date.now() - began < 8_000);
    await waitFor(() => sockets.size === 0);
    await new PostgresTaskRunExecutionGuard({ connectionString: databaseUrl }).withTaskRunExecution(scope, async () => undefined);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("startup recovery reacquires a lost guard and resumes the recorded request without a second POST", timeout, async () => {
  const context = await prepare();
  const base = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const withExecution = context.store.withTaskRunExecution.bind(context.store);
  let lost = false;
  context.store.withTaskRunExecution = (scope, execute) => withExecution(scope, (lease) => {
    lost = false;
    const assertActive = () => { lease.assertActive(); if (lost) throw new TaskRunExecutionOwnershipLostError(); };
    return execute(Object.assign(assertActive, { fenceToken: lease.fenceToken, assertActive }));
  });
  try {
    await new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "first", leaseMs: 100 }).process(await context.message());
    const provider: VideoProviderPort = {
      async submit(input) { const result = await base.submit(input); lost = true; return result; },
      getStatus: (input) => base.getStatus(input),
      download: (input) => base.download(input),
    };
    const result = (await new MockVideoTaskExecutor(context.store, provider, context.storage).recover({ limit: 100, maxAttempts: 3 })).find((item) => item.taskRunId === context.taskRunId);
    assert.equal(result?.status, "SUCCEEDED");
    assert.equal(result?.attempts, 2);
    assert.equal(result?.deferred, undefined);
    assert.equal(base.submitCount, 1);
    assert.ok((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0]?.providerRequestId);
  } finally { await context.close(); }
});

test("PostgreSQL retry generation remains ordered under a frozen/backward clock and reverse event IDs", timeout, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T18:00:00.000Z") });
  const oldEventId = "evt_7ZZZZZZZZZZZZZZZZZZZZZZZZZ";
  const newEventId = "evt_00000000000000000000000000";
  const context = await prepare(false, oldEventId);
  try {
    await new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "first", leaseMs: 100 }).process(await context.message());
    await context.store.failTaskRun({ ...context, code: "PROVIDER_UNAVAILABLE", message: "Controlled pre-submit failure.", retryable: true, now: new Date() });
    t.mock.timers.setTime(new Date("2026-10-12T17:59:59.000Z").getTime());
    assert.equal((await context.store.retryTaskRun({ scope: `clock:${context.taskRunId}`, idempotencyKey: "retry", requestHash: "a".repeat(64), ...context, event: { ...event(), eventId: newEventId } })).kind, "NEW");
    assert.ok((await context.store.claimOutboxEvents({ relayId: "clock-test", now: new WallClock(), leaseMs: 100, limit: 100, workspaceId: context.workspaceId })).some((item) => item.id === newEventId));
    await context.store.finalizeTaskRunExecutionFailure({ ...context, expectedQueuedEventId: oldEventId, code: "PROVIDER_UNAVAILABLE", message: "Stale callback.", now: new Date() });
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "QUEUED");
    await context.store.finalizeTaskRunExecutionFailure({ ...context, expectedQueuedEventId: newEventId, code: "PROVIDER_UNAVAILABLE", message: "Current callback.", now: new Date() });
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "FAILED");
  } finally { await context.close(); }
});

test("ambiguous legacy queued generations request controlled recovery without guessing an event order", timeout, async () => {
  const context = await prepare();
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  try {
    const initialMessage = await context.message();
    const transition = new TaskRunEventConsumer(context.store, { consumerName: "execution-closure", workerId: "first", leaseMs: 100 });
    await transition.process(initialMessage);
    await context.store.failTaskRun({ ...context, code: "PROVIDER_UNAVAILABLE", message: "Controlled pre-submit failure.", retryable: true, now: new Date() });
    const newMessage = await context.retry("legacy-equal-time");
    const [oldEvent] = await context.database.db.select().from(outboxEvents).where(eq(outboxEvents.id, initialMessage.event_id));
    const [newEvent] = await context.database.db.select().from(outboxEvents).where(eq(outboxEvents.id, newMessage.event_id));
    assert.ok(oldEvent && newEvent);
    await context.database.db.update(outboxEvents).set({ occurredAt: oldEvent.occurredAt, payload: { ...newEvent.payload, occurred_at: new Date(oldEvent.occurredAt).toISOString() } }).where(eq(outboxEvents.id, newMessage.event_id));
    await transition.process(newMessage);
    await assert.rejects(transition.finalizeExecutionFailure({ ...newMessage, reason: "Legacy callback exhaustion." }), InternalEventRequiresRecoveryError);
    assert.equal((await context.store.findTaskRun(context.workspaceId, context.taskRunId))?.status, "RUNNING");
    const recovered = await new MockVideoTaskExecutor(context.store, provider, context.storage).recover({ limit: 100, maxAttempts: 3 });
    assert.equal(recovered.find((item) => item.taskRunId === context.taskRunId)?.status, "SUCCEEDED");
    assert.equal(provider.submitCount, 1);
  } finally { await context.close(); }
});
