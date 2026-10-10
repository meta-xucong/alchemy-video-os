import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import type { VideoGenerationInput, VideoProviderPort } from "@alchemy-video/provider-video";
import type { StoragePort } from "@alchemy-video/storage-client";

import { MockVideoTaskExecutor as LegacyExecutor } from "./fixtures/legacy-worker-44da842/apps/task-worker/src/execution-service.js";
import { createTaskRunQueueMessage, recoverC06TaskRuns, TaskRunEventConsumer as LegacyConsumer } from "./fixtures/legacy-worker-44da842/apps/task-worker/src/service.js";
import { DrizzleTaskRunRepository as LegacyRepository } from "./fixtures/legacy-worker-44da842/packages/persistence/src/task-run-repository.js";
import * as legacySchema from "./fixtures/legacy-worker-44da842/packages/persistence/src/schema.js";
import { MockVideoProvider } from "./fixtures/legacy-worker-44da842/packages/provider-video/src/mock-video-provider.js";

const fixtureRoot = new URL("./fixtures/legacy-worker-44da842/", import.meta.url);
const migrationsRoot = new URL("../../../packages/persistence/drizzle/", import.meta.url);
const legacyCommit = "44da8428d2c1b73648eb1616cd0350dac798eba8";
const fenceMigration = "0028_fence_legacy_task_workers.sql";

test("pinned legacy Worker fixtures match their original commit and SHA-256 manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtureRoot), "utf8")) as {
    commit: string;
    files: Array<{ source: string; sha256: string }>;
  };
  assert.equal(manifest.commit, legacyCommit);
  assert.deepEqual(manifest.files.map((file) => file.source).sort(), [
    "apps/task-worker/src/billing-executor.ts",
    "apps/task-worker/src/execution-service.ts",
    "apps/task-worker/src/service.ts",
    "packages/persistence/src/schema.ts",
    "packages/persistence/src/task-run-repository.ts",
    "packages/persistence/src/workspace-repositories.ts",
    "packages/provider-video/src/mock-video-provider.ts",
    "packages/provider-video/src/port.ts",
  ]);
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.source, fixtureRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.source);
  }
});

const applyMigration = async (pool: Pool, filename: string) => {
  const sql = await readFile(new URL(filename, migrationsRoot), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of sql.split("--> statement-breakpoint").filter((part) => part.trim())) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const createIsolatedDatabase = async () => {
  const connection = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname), "Legacy regression requires a loopback-only test PostgreSQL server.");
  const admin = new Pool({ connectionString: connection.toString(), max: 1 });
  const databaseName = `legacy_worker_fence_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool | undefined;
  let created = false;
  const close = async () => {
    await pool?.end();
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  };
  try {
    const version = Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "Run this regression on PostgreSQL 16, as CI does.");
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    connection.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: connection.toString(), max: 4 });
    const migrations = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 27).sort();
    assert.equal(migrations.length, 28);
    for (const filename of migrations) await applyMigration(pool, filename);
    return { pool, close };
  } catch (error) {
    await close();
    throw error;
  }
};

const seedQueuedTask = async (pool: Pool, store: LegacyRepository) => {
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const eventId = createPrefixedId("evt");
  await pool.query("INSERT INTO users (id, display_name) VALUES ($1, 'Legacy fence test')", [userId]);
  await pool.query("INSERT INTO workspaces (id, name, created_by) VALUES ($1, 'Legacy fence test', $2)", [workspaceId, userId]);
  await pool.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, 'Legacy fence test')", [projectId, workspaceId]);
  await pool.query("INSERT INTO shots (id, workspace_id, project_id, position, prompt, status) VALUES ($1, $2, $3, 0, 'Mock only', 'READY')", [shotId, workspaceId, projectId]);
  const inputSnapshot = { model: "mock-v1", prompt: "Mock only: old Worker migration boundary", duration: 5, resolution: "720p", ratio: "16:9", reference_asset_ids: [] };
  const created = await store.createTaskRun({
    scope: `legacy-fence:${taskRunId}`,
    idempotencyKey: taskRunId,
    requestHash: fingerprintRequest(inputSnapshot),
    workspaceId,
    taskRunId,
    shotId,
    kind: "VIDEO_GENERATION",
    inputSnapshot,
    event: { eventId, messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });
  assert.equal(created.kind, "NEW");
  const outbox = (await store.claimOutboxEvents({ relayId: "legacy-fence", now: new Date(), leaseMs: 60_000, limit: 10, workspaceId })).find((row) => row.id === eventId);
  assert.ok(outbox);
  const message = createTaskRunQueueMessage(outbox);
  assert.ok(message);
  return { workspaceId, taskRunId, eventId, message };
};

// Observe the original repository calls, including their unnormalized SQLSTATE;
// the proxy neither substitutes SQL nor changes the old execution ordering.
const observeRepository = (repository: LegacyRepository) => {
  const errors: Array<{ method: string; error: unknown }> = [];
  const processResults: unknown[] = [];
  const store = new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          const result = await Reflect.apply(value, target, args);
          if (property === "processEvent") processResults.push(result);
          return result;
        } catch (error) {
          errors.push({ method: String(property), error });
          throw error;
        }
      };
    },
  });
  return { store, errors, processResults };
};

const isMissingLegacyColumn = (error: unknown): boolean => {
  const candidate = error as { code?: string; message?: string; cause?: unknown } | undefined;
  return Boolean(candidate && ((candidate.code === "42703" && /provider_request_id/.test(candidate.message ?? "")) || (candidate.cause && isMissingLegacyColumn(candidate.cause))));
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const createLoopbackMock = async (holdAcceptance = false) => {
  const entered = deferred();
  const release = deferred();
  const mock = new MockVideoProvider({ fixtureBytes: new Uint8Array([1]) });
  const acceptedIds: string[] = [];
  let videoPostCount = 0;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/videos/generations");
      videoPostCount += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as VideoGenerationInput;
      entered.resolve();
      if (holdAcceptance) await release.promise;
      const submission = await mock.submit(input);
      acceptedIds.push(submission.providerRequestId);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(submission));
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider: VideoProviderPort = {
    async submit(input) {
      const response = await fetch(`http://127.0.0.1:${address.port}/videos/generations`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      return response.json();
    },
    async getStatus() { assert.fail("Legacy request ID write must fail before polling."); },
    async download() { assert.fail("Legacy request ID write must fail before downloading."); },
  };
  return {
    provider, entered: entered.promise, release: release.resolve, acceptedIds,
    get videoPostCount() { return videoPostCount; },
    get acceptedCount() { return mock.submitCount; },
    async close() {
      release.resolve();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
};

const forbiddenStorage = new Proxy({} as StoragePort, {
  get() { return () => assert.fail("Fenced old Worker must not reach storage."); },
});
const retryableExecutionError = { name: "RetryableTaskExecutionError", message: "The video execution could not complete." };
const integrationOptions = { skip: !process.env.DATABASE_URL, timeout: 60_000 };

test("0028 rejects the pinned old Worker before video POST; duplicate delivery and recovery stay fenced", integrationOptions, async (t) => {
  const database = await createIsolatedDatabase();
  t.after(() => database.close());
  const observed = observeRepository(new LegacyRepository(drizzle({ client: database.pool, schema: legacySchema })));
  const task = await seedQueuedTask(database.pool, observed.store);
  const mock = await createLoopbackMock();
  t.after(() => mock.close());
  const executor = new LegacyExecutor(observed.store, mock.provider, forbiddenStorage);
  const consumer = new LegacyConsumer(observed.store, { consumerName: "legacy-fence", workerId: "old-worker", leaseMs: 1000 }, executor);

  await applyMigration(database.pool, fenceMigration);
  await assert.rejects(consumer.process(task.message), retryableExecutionError);
  assert.deepEqual(observed.processResults, ["PROCESSED"]);
  assert.equal(observed.errors[0]?.method, "ensureProviderAttempt");
  assert.ok(isMissingLegacyColumn(observed.errors[0]?.error), "The actual old repository must fail with PostgreSQL 42703.");
  assert.equal(mock.videoPostCount, 0);
  assert.equal(mock.acceptedCount, 0);
  assert.equal((await observed.store.findTaskRun(task.workspaceId, task.taskRunId))?.status, "RUNNING");
  assert.equal((await database.pool.query("SELECT count(*)::int AS count FROM provider_attempts")).rows[0].count, 0);

  await assert.rejects(consumer.process(task.message), retryableExecutionError);
  assert.deepEqual(observed.processResults, ["PROCESSED", "DUPLICATE"]);
  const recovered = await recoverC06TaskRuns(executor, { maxAttempts: 2 });
  assert.deepEqual(recovered, [{ workspaceId: task.workspaceId, taskRunId: task.taskRunId, attempts: 2, failure: retryableExecutionError.message }]);
  assert.equal(observed.errors.filter((entry) => entry.method === "ensureProviderAttempt" && isMissingLegacyColumn(entry.error)).length, 4);
  // Match the old entrypoint's finalization wiring: recovery rejects rather
  // than allowing startup to continue after its retries are exhausted.
  await assert.rejects(recoverC06TaskRuns(executor, {
    maxAttempts: 1,
    finalizeFailure: ({ workspaceId, taskRunId, reason }) =>
      consumer.finalizeExecutionFailure({ workspace_id: workspaceId, task_run_id: taskRunId, reason }),
  }), isMissingLegacyColumn);
  await assert.rejects(consumer.finalizeExecutionFailure({ workspace_id: task.workspaceId, task_run_id: task.taskRunId, reason: "delivery attempts exhausted" }), isMissingLegacyColumn);
  await consumer.deadLetter({ workspace_id: task.workspaceId, event_id: task.eventId, reason: "delivery attempts exhausted" });
  const consumption = (await database.pool.query("SELECT completed_at, dead_lettered_at, lease_owner FROM event_consumptions WHERE event_id = $1", [task.eventId])).rows[0];
  assert.ok(consumption.completed_at, "The old consumer commits consumption before executing the video task.");
  assert.equal(consumption.dead_lettered_at, null, "Old deadLetter cannot reacquire the already-cleared consumer lease.");
  assert.equal(consumption.lease_owner, null);
  assert.equal((await observed.store.findTaskRun(task.workspaceId, task.taskRunId))?.status, "RUNNING");
  assert.equal((await database.pool.query("SELECT count(*)::int AS count FROM outbox_events WHERE event_type IN ('provider_attempt.submitted', 'task_run.failed')")).rows[0].count, 0);
  assert.equal(mock.videoPostCount, 0);
});

test("an old Worker already past ensureProviderAttempt can be accepted after 0028, then lose the local request ID", integrationOptions, async (t) => {
  const database = await createIsolatedDatabase();
  t.after(() => database.close());
  const observed = observeRepository(new LegacyRepository(drizzle({ client: database.pool, schema: legacySchema })));
  const task = await seedQueuedTask(database.pool, observed.store);
  const mock = await createLoopbackMock(true);
  t.after(() => mock.close());
  const executor = new LegacyExecutor(observed.store, mock.provider, forbiddenStorage);
  const consumer = new LegacyConsumer(observed.store, { consumerName: "legacy-fence", workerId: "old-worker", leaseMs: 1000 }, executor);
  const execution = consumer.process(task.message);
  // Register rejection handling before releasing the response barrier.
  const failedExecution = assert.rejects(execution, retryableExecutionError);
  await mock.entered;
  assert.equal(mock.videoPostCount, 1);
  assert.equal(mock.acceptedCount, 0);
  assert.equal(observed.errors.length, 0);
  const before = (await database.pool.query("SELECT id, status, provider_request_id, submission_reserved_at FROM provider_attempts")).rows;
  assert.equal(before.length, 1);
  assert.equal(before[0].status, "CREATED");
  assert.equal(before[0].provider_request_id, null);
  assert.equal(before[0].submission_reserved_at, null, "Pinned Worker predates submission reservations.");

  await applyMigration(database.pool, fenceMigration);
  mock.release();
  await failedExecution;
  assert.equal(mock.videoPostCount, 1);
  assert.equal(mock.acceptedCount, 1, "Mock acceptance occurs after migration COMMIT.");
  assert.equal(mock.acceptedIds.length, 1);
  assert.equal(observed.errors[0]?.method, "recordProviderSubmission");
  assert.ok(isMissingLegacyColumn(observed.errors[0]?.error));
  const after = (await database.pool.query("SELECT id, status, provider_request_id_v2, submission_reserved_at FROM provider_attempts")).rows;
  assert.deepEqual(after, [{ id: before[0].id, status: "CREATED", provider_request_id_v2: null, submission_reserved_at: null }]);
  assert.equal((await observed.store.findTaskRun(task.workspaceId, task.taskRunId))?.status, "RUNNING");
  assert.equal((await database.pool.query("SELECT count(*)::int AS count FROM outbox_events WHERE event_type = 'provider_attempt.submitted'")).rows[0].count, 0);

  await assert.rejects(consumer.process(task.message), retryableExecutionError);
  assert.deepEqual(observed.processResults, ["PROCESSED", "DUPLICATE"]);
  const recovered = await recoverC06TaskRuns(executor, { maxAttempts: 2 });
  assert.equal(recovered[0]?.attempts, 2);
  assert.equal(recovered[0]?.failure, retryableExecutionError.message);
  await assert.rejects(consumer.finalizeExecutionFailure({ workspace_id: task.workspaceId, task_run_id: task.taskRunId, reason: "delivery attempts exhausted" }), isMissingLegacyColumn);
  assert.equal(mock.videoPostCount, 1, "Later old retries are fenced, but cannot undo the accepted request.");
  assert.equal(mock.acceptedCount, 1);
  assert.equal((await database.pool.query("SELECT provider_request_id_v2 FROM provider_attempts WHERE id = $1", [before[0].id])).rows[0].provider_request_id_v2, null);
});
