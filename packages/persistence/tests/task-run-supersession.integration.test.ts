import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { InternalEventEnvelopeSchema, InternalTaskRunQueueMessageSchema } from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";
import { DrizzleTaskRunRepository } from "../src/task-run-repository.js";
import { assertLoopbackTestDatabaseUrl } from "./helpers/legacy-fence-test-database.js";

const databaseUrl = process.env.LEGACY_FENCE_TEST_DATABASE_URL;
const snapshot = { model: "mock-video-v1", prompt: "Offline recovery lineage fixture.", duration: 5, resolution: "720p", ratio: "16:9", reference_asset_ids: [] };
const metadata = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });

const isolated = async (run: (client: Client) => Promise<void>) => {
  assert.ok(databaseUrl);
  const base = new URL(assertLoopbackTestDatabaseUrl(databaseUrl));
  const name = `recovery_lineage_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  let client: Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    base.pathname = `/${name}`;
    client = new Client({ connectionString: base.toString() });
    assert.equal(client.database, name);
    await client.connect();
    await migrate(drizzle({ client }), { migrationsFolder: resolve(import.meta.dirname, "../drizzle") });
    await run(client);
  } finally {
    await client?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
};

const seed = async (client: Client, suffix: string) => {
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const taskIds: string[] = [];
  const shotIds: string[] = [];
  await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [userId, `Recovery ${suffix}`]);
  await client.query("INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)", [workspaceId, `Recovery ${suffix}`, userId]);
  await client.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)", [projectId, workspaceId, `Recovery ${suffix}`]);
  for (let position = 0; position < 3; position += 1) {
    const shotId = createPrefixedId("sht");
    const taskId = createPrefixedId("tsk");
    await client.query("INSERT INTO shots (id, workspace_id, project_id, position) VALUES ($1, $2, $3, $4)", [shotId, workspaceId, projectId, position]);
    await client.query("INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot) VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', 'FAILED', $5)", [taskId, workspaceId, projectId, shotId, snapshot]);
    taskIds.push(taskId);
    shotIds.push(shotId);
  }
  return { userId, workspaceId, projectId, taskIds, shotIds };
};

test("recovery lineage constraints reject invalid links and old reactivation while preserving project/workspace cleanup", { skip: !databaseUrl }, async () => {
  await isolated(async (client) => {
    const first = await seed(client, "project cleanup");
    const other = await seed(client, "workspace cleanup");
    const [a, b, c] = first.taskIds;
    const link = (source: string, target: string) => client.query("UPDATE task_runs SET superseded_by_task_run_id = $2 WHERE id = $1", [source, target]);
    assert.equal((await client.query("SELECT superseded_by_task_run_id FROM task_runs WHERE id = $1", [a])).rows[0].superseded_by_task_run_id, null);
    await assert.rejects(link(a!, a!), { code: "23514" });
    await assert.rejects(link(a!, createPrefixedId("tsk")), { code: "23503" });
    await assert.rejects(link(a!, other.taskIds[0]!), { code: "23503" });
    const otherProject = createPrefixedId("prj");
    const otherShot = createPrefixedId("sht");
    const otherTask = createPrefixedId("tsk");
    await client.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, 'Other project')", [otherProject, first.workspaceId]);
    await client.query("INSERT INTO shots (id, workspace_id, project_id, position) VALUES ($1, $2, $3, 0)", [otherShot, first.workspaceId, otherProject]);
    await client.query("INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot) VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', 'FAILED', $5)", [otherTask, first.workspaceId, otherProject, otherShot, snapshot]);
    await assert.rejects(link(a!, otherTask), { code: "23503" });
    await link(a!, b!);
    await assert.rejects(link(c!, b!), { code: "23505" });
    for (const status of ["QUEUED", "RUNNING", "PROVIDER_PROCESSING", "DOWNLOADING", "BILLING_PENDING", "BILLING_FAILED", "RETRY_SCHEDULED", "ABANDONED"]) {
      await assert.rejects(client.query("UPDATE task_runs SET status = $2 WHERE id = $1", [a, status]), { code: "23514" });
    }
    await assert.rejects(client.query("UPDATE task_runs SET kind = 'RENDER' WHERE id = $1", [a]), { code: "23514" });
    await assert.rejects(client.query("DELETE FROM task_runs WHERE id = $1", [b]), { code: "23503" });
    await link(b!, c!);
    await client.query("DELETE FROM projects WHERE id = $1", [first.projectId]);
    assert.equal((await client.query("SELECT count(*)::integer AS count FROM task_runs WHERE project_id = $1", [first.projectId])).rows[0].count, 0);
    await link(other.taskIds[0]!, other.taskIds[1]!);
    await link(other.taskIds[1]!, other.taskIds[2]!);
    await client.query("DELETE FROM workspaces WHERE id = $1", [other.workspaceId]);
    assert.equal((await client.query("SELECT count(*)::integer AS count FROM task_runs WHERE workspace_id = $1", [other.workspaceId])).rows[0].count, 0);
    const constraint = await client.query("SELECT confdeltype FROM pg_constraint WHERE conname = 'task_runs_superseded_successor_fk'");
    assert.equal(constraint.rows[0].confdeltype, "a", "NO ACTION checks the completed cascading statement while refusing standalone successor deletion");
  });
});

test("superseded PostgreSQL task rejects recovery and stale mutations but records a late accepted request ID", { skip: !databaseUrl }, async () => {
  await isolated(async (client) => {
    const context = await seed(client, "task guards");
    const [taskRunId, successorId] = context.taskIds as [string, string, string];
    const { workspaceId, projectId } = context;
    const attemptId = createPrefixedId("att");
    const assetId = createPrefixedId("ast");
    const now = new Date();
    await client.query("INSERT INTO provider_attempts (id, workspace_id, task_run_id, provider, model, status, response_payload) VALUES ($1, $2, $3, 'mock', 'mock-video-v1', 'FAILED', $4)", [attemptId, workspaceId, taskRunId, { code: "PROVIDER_REJECTED" }]);
    await client.query("INSERT INTO assets (id, workspace_id, project_id, kind, origin, status, object_key, metadata) VALUES ($1, $2, $3, 'VIDEO', 'GENERATED', 'PENDING_UPLOAD', $4, $5)", [assetId, workspaceId, projectId, `${workspaceId}/${projectId}/${assetId}/generated.mp4`, { task_run_id: taskRunId }]);
    const tasks = new DrizzleTaskRunRepository(drizzle({ client }));
    const command = { scope: `${workspaceId}:recovery`, idempotencyKey: "ordinary-before-replacement", requestHash: "a".repeat(64), workspaceId, taskRunId, event: metadata() };
    const accepted = await tasks.retryTaskRun(command);
    assert.equal(accepted.kind, "NEW");
    await client.query("UPDATE task_runs SET status = 'FAILED', superseded_by_task_run_id = $2 WHERE id = $1", [taskRunId, successorId]);
    const before = await tasks.findTaskRun(workspaceId, taskRunId);
    const attemptBefore = await tasks.listTaskRunAttempts(workspaceId, taskRunId);
    const assetBefore = (await client.query("SELECT to_jsonb(a) AS row FROM assets a WHERE id = $1", [assetId])).rows[0].row;
    const eventCount = async () => (await client.query("SELECT count(*)::integer AS count FROM outbox_events WHERE workspace_id = $1", [workspaceId])).rows[0].count;
    const countBefore = await eventCount();
    const oldReplay = await tasks.retryTaskRun(command);
    assert.equal(oldReplay.kind, "REPLAY");
    if (oldReplay.kind === "REPLAY") assert.equal(oldReplay.value.status, "QUEUED");
    const rejectedCommand = { ...command, idempotencyKey: "ordinary-after-replacement", event: metadata() };
    assert.equal((await tasks.retryTaskRun(rejectedCommand)).kind, "STATE_INVALID");
    assert.equal((await tasks.retryTaskRun(rejectedCommand)).kind, "STATE_INVALID");
    assert.equal((await tasks.retryTaskRun({ ...rejectedCommand, requestHash: "b".repeat(64) })).kind, "CONFLICT");
    assert.equal((await tasks.retryTaskRun({ ...command, scope: "other-workspace", workspaceId: createPrefixedId("ws"), idempotencyKey: "other" })).kind, "NOT_FOUND");
    const rebuilt = new DrizzleTaskRunRepository(drizzle({ client }));
    assert.equal((await rebuilt.retryTaskRun({ ...command, idempotencyKey: "new-repository" })).kind, "STATE_INVALID");
    assert.equal((await tasks.listRecoverableVideoTaskRuns({ limit: 100, statuses: ["FAILED"] })).some((task) => task.id === taskRunId), false);
    assert.equal(await tasks.ensureProviderAttempt({ workspaceId, taskRunId, providerAttemptId: createPrefixedId("att"), provider: "mock", model: "mock-video-v1", now }), undefined);
    assert.equal(await tasks.reserveProviderSubmission({ workspaceId, taskRunId, providerAttemptId: attemptId, now }), false);
    assert.deepEqual(await tasks.recordProviderProcessing({ workspaceId, taskRunId, providerAttemptId: attemptId, now }), before);
    assert.deepEqual(await tasks.beginDownload({ workspaceId, taskRunId, providerAttemptId: attemptId, now }), before);
    await tasks.recordDownloadRetryableFailure({ workspaceId, taskRunId, providerAttemptId: attemptId, code: "PROVIDER_UNAVAILABLE", now });
    assert.equal(await tasks.ensureGeneratedAsset({ workspaceId, taskRunId, assetId: createPrefixedId("ast"), objectKey: "offline/no-new-asset", provider: "mock", now }), undefined);
    assert.deepEqual(await tasks.completeGeneratedTaskRun({ workspaceId, taskRunId, providerAttemptId: attemptId, assetId, sha256: "b".repeat(64), byteSize: 100, width: 16, height: 16, durationMs: 5000, now }), before);
    await tasks.markBillingSucceeded({ workspaceId, taskRunId, usageRecordId: createPrefixedId("use"), now });
    await tasks.markBillingFailed({ workspaceId, taskRunId, code: "CREDIT_UNAVAILABLE", safeMessage: "Offline", now });
    await tasks.scheduleBillingRetry({ workspaceId, taskRunId, code: "CREDIT_UNAVAILABLE", safeMessage: "Offline", retryAt: now, now });
    assert.deepEqual(await tasks.resumeBillingRetry({ workspaceId, taskRunId, now }), before);
    assert.deepEqual(await tasks.finalizeTaskRunExecutionFailure({ workspaceId, taskRunId, code: "PROVIDER_UNAVAILABLE", message: "Offline", now }), before);
    assert.deepEqual(await tasks.failTaskRun({ workspaceId, taskRunId, providerAttemptId: attemptId, code: "PROVIDER_UNAVAILABLE", message: "Offline", retryable: true, now }), before);
    const queuedRow = (await client.query("SELECT payload FROM outbox_events WHERE workspace_id = $1 AND event_type = 'task_run.queued'", [workspaceId])).rows[0];
    const queued = InternalEventEnvelopeSchema.parse(queuedRow.payload);
    assert.equal(queued.event_type, "task_run.queued");
    if (queued.event_type !== "task_run.queued") throw new Error("Missing queue fixture");
    const message = InternalTaskRunQueueMessageSchema.parse({ contract_version: queued.contract_version, event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, correlation_id: queued.correlation_id, attempt_no: 1, input_snapshot: queued.data.input_snapshot });
    assert.equal(await tasks.processEvent({ message, consumerName: "lineage-stale", workerId: "offline", now, leaseMs: 1000 }), "DUPLICATE");
    assert.equal(await tasks.processEvent({ message, consumerName: "lineage-stale", workerId: "offline", now, leaseMs: 1000 }), "DUPLICATE");
    assert.deepEqual(await tasks.findTaskRun(workspaceId, taskRunId), before);
    assert.deepEqual(await tasks.listTaskRunAttempts(workspaceId, taskRunId), attemptBefore);
    assert.deepEqual((await client.query("SELECT to_jsonb(a) AS row FROM assets a WHERE id = $1", [assetId])).rows[0].row, assetBefore);
    assert.equal(await eventCount(), countBefore);
    assert.deepEqual(await tasks.recordProviderSubmission({ workspaceId, taskRunId, providerAttemptId: attemptId, providerRequestId: "offline-late-accepted-id", now }), before);
    const late = (await tasks.listTaskRunAttempts(workspaceId, taskRunId))[0]!;
    assert.equal(late.providerRequestId, "offline-late-accepted-id");
    assert.equal(late.status, attemptBefore[0]!.status);
    assert.deepEqual(late.responsePayload, attemptBefore[0]!.responsePayload);
    assert.equal(late.submissionReservedAt, attemptBefore[0]!.submissionReservedAt);
    await assert.rejects(tasks.recordProviderSubmission({ workspaceId, taskRunId, providerAttemptId: attemptId, providerRequestId: "offline-conflicting-id", now }), /PROVIDER_RESUBMIT_FORBIDDEN/);
    assert.deepEqual(await tasks.findTaskRun(workspaceId, taskRunId), before);
    assert.equal(await eventCount(), countBefore);
  });
});
