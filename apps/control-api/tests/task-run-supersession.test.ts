import assert from "node:assert/strict";
import test from "node:test";

import { InternalTaskRunQueueMessageSchema, type InternalEventEnvelope, type VideoGenerationInputSnapshot } from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";
import type { ControlAsset, ControlProviderAttempt, ControlTaskRun, RetryTaskRunInput, TaskRunCommandExecution } from "@alchemy-video/persistence";

import { InMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { InMemoryControlPlaneStore } from "../src/repository.js";
import { serializeTaskRun } from "../src/serializers.js";
import { InMemoryTaskRunStore } from "../src/task-run-repository.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });
const now = new Date("2026-10-10T12:00:00.000Z");
const snapshot: VideoGenerationInputSnapshot = {
  model: "mock-video-v1", prompt: "Offline recovery fixture", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [],
  billing: { external_user_id: 42, billing_rule: { creditProvider: "veyra_sub2api", billingRuleKey: "video:recovery-fixture", chargeAmount: "1", source: "video:recovery-fixture" } },
};

// The memory store deliberately has no ProductionStore or public supersede API.
// Seed private rows here to exercise the same task-level guards as PostgreSQL.
type FixtureState = {
  taskRuns: Map<string, ControlTaskRun>;
  attempts: Map<string, ControlProviderAttempt>;
  generatedAssets: Map<string, ControlAsset>;
  commands: Map<string, { requestHash: string; outcome: TaskRunCommandExecution }>;
};

const fixture = async () => {
  const control = new InMemoryControlPlaneStore();
  const assets = new InMemoryAssetWorkspaceStore(control);
  const tasks = new InMemoryTaskRunStore(assets);
  const state = tasks as unknown as FixtureState;
  const workspaceId = createPrefixedId("ws");
  const userId = createPrefixedId("usr");
  const projectId = createPrefixedId("prj");
  const command = (name: string) => ({ scope: `${workspaceId}:${name}`, idempotencyKey: name, requestHash: "a".repeat(64), workspaceId });
  await control.ensureDevIdentity({ user: { id: userId, displayName: "Recovery fixture" }, workspace: { id: workspaceId, name: "Recovery fixture" } });
  await control.createProject({ ...command("project"), projectId, name: "Recovery fixture" });
  let position = 0;
  const createRun = async (name: string) => {
    const shotId = createPrefixedId("sht");
    const taskRunId = createPrefixedId("tsk");
    await assets.createShot({ ...command(`shot-${name}`), shotId, projectId, position: position++, prompt: snapshot.prompt, model: null, generationSettings: {}, referenceBindings: [] });
    await assets.updateShot({ ...command(`ready-${name}`), shotId, status: "READY" });
    const result = await tasks.createTaskRun({ ...command(`create-${name}`), shotId, taskRunId, kind: "VIDEO_GENERATION", inputSnapshot: structuredClone(snapshot), event: event() });
    assert.equal(result.kind, "NEW");
    const created = await tasks.findTaskRun(workspaceId, taskRunId);
    assert.ok(created);
    return created;
  };
  const ancestor = await createRun("ancestor");
  const successor = await createRun("successor");
  const replace = (task: ControlTaskRun, patch: Partial<ControlTaskRun>) => {
    const updated = { ...task, ...patch };
    state.taskRuns.set(task.id, updated);
    return updated;
  };
  const supersede = (status: ControlTaskRun["status"] = "FAILED") => replace(ancestor, {
    status, supersededByTaskRunId: successor.id,
    error: status === "SUCCEEDED" ? null : { code: "PROVIDER_REJECTED", message: "Fixture failure", retryable: false },
  });
  const retry = (key: string, taskRunId = ancestor.id): RetryTaskRunInput => ({ ...command(key), taskRunId, event: event() });
  const queued = async (taskRunId = ancestor.id) => {
    const found = (await tasks.listWorkspaceEvents({ workspaceId, limit: 100 })).find((item) => item.event_type === "task_run.queued" && item.data.task_run_id === taskRunId);
    assert.ok(found?.event_type === "task_run.queued");
    return found;
  };
  const process = async (source: Extract<InternalEventEnvelope, { event_type: "task_run.queued" }>, consumerName = "recovery-fixture") => tasks.processEvent({
    message: InternalTaskRunQueueMessageSchema.parse({ contract_version: "1.0", event_id: source.event_id, workspace_id: source.workspace_id, task_run_id: source.data.task_run_id, attempt_no: 1, correlation_id: source.correlation_id, input_snapshot: source.data.input_snapshot }),
    consumerName, workerId: "fixture-worker", now, leaseMs: 1000,
  });
  const seedAttempt = (patch: Partial<ControlProviderAttempt> = {}) => {
    const attempt: ControlProviderAttempt = {
      id: createPrefixedId("att"), taskRunId: ancestor.id, provider: "mock", model: snapshot.model, providerRequestId: null, submissionReservedAt: null,
      status: "CREATED", requestPayload: {}, responsePayload: {}, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...patch,
    };
    state.attempts.set(attempt.id, attempt);
    return attempt;
  };
  return { tasks, assets, state, workspaceId, projectId, ancestor, successor, createRun, replace, supersede, retry, queued, process, seedAttempt };
};

test("memory recovery relation is private and preserves immutable snapshots and historical successful assets", async () => {
  const f = await fixture();
  assert.equal(f.ancestor.supersededByTaskRunId, null);
  const assetId = createPrefixedId("ast");
  await f.tasks.ensureGeneratedAsset({ workspaceId: f.workspaceId, taskRunId: f.ancestor.id, assetId, objectKey: `${f.workspaceId}/${f.projectId}/${assetId}/generated.mp4`, provider: "mock", now });
  const asset = f.state.generatedAssets.get(assetId)!;
  f.state.generatedAssets.set(assetId, { ...asset, status: "READY", sha256: "a".repeat(64), mimeType: "video/mp4" });
  const superseded = f.replace(f.supersede("SUCCEEDED"), { resultAssetId: assetId });
  assert.deepEqual(superseded.inputSnapshot, snapshot);
  assert.deepEqual((await f.queued()).data.input_snapshot, snapshot);
  assert.equal((await f.tasks.findTaskRunResultAsset(f.workspaceId, assetId))?.id, assetId);
  assert.equal(await f.tasks.findTaskRunResultAsset(createPrefixedId("ws"), assetId), undefined);
  const publicJson = JSON.stringify(serializeTaskRun(superseded));
  for (const forbidden of ["supersededByTaskRunId", "superseded_by_task_run_id", f.successor.id, "input_snapshot", "object_key"]) {
    assert.equal(publicJson.includes(forbidden), false, forbidden);
  }
});

test("memory superseded retries preserve workspace privacy, successful legacy replay and failed replay", async () => {
  const f = await fixture();
  f.replace(f.ancestor, { status: "FAILED" });
  const original = f.retry("original-retry");
  const accepted = await f.tasks.retryTaskRun(original);
  assert.equal(accepted.kind, "NEW");
  const saved = structuredClone(f.state.commands.get(`${original.scope}:${original.idempotencyKey}`)!);
  assert.ok(saved.outcome.kind === "NEW" || saved.outcome.kind === "REPLAY");
  delete saved.outcome.value.supersededByTaskRunId;
  f.state.commands.set(`${original.scope}:${original.idempotencyKey}`, saved);
  const superseded = f.supersede();
  const before = await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 });
  const replay = await f.tasks.retryTaskRun(original);
  assert.deepEqual(replay, saved.outcome);
  assert.ok(replay.kind === "NEW" || replay.kind === "REPLAY");
  assert.equal(replay.value.status, "QUEUED");
  assert.equal(replay.value.supersededByTaskRunId, undefined);
  assert.deepEqual(await f.tasks.retryTaskRun({ ...original, requestHash: "b".repeat(64) }), { kind: "CONFLICT" });
  const rejected = f.retry("superseded-retry");
  assert.deepEqual(await f.tasks.retryTaskRun(rejected), { kind: "STATE_INVALID" });
  f.replace(f.successor, { status: "SUCCEEDED" });
  assert.deepEqual(await f.tasks.retryTaskRun(rejected), { kind: "STATE_INVALID" });
  assert.deepEqual(await f.tasks.retryTaskRun({ ...f.retry("wrong-workspace"), workspaceId: createPrefixedId("ws") }), { kind: "NOT_FOUND", status: 404 });
  assert.deepEqual(await f.tasks.findTaskRun(f.workspaceId, f.ancestor.id), superseded);
  assert.deepEqual(await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 }), before);
  assert.deepEqual(await f.tasks.listTaskRunAttempts(f.workspaceId, f.ancestor.id), []);
});

test("memory recovery chain keeps both ancestors blocked while the current successor can run and reserve", async () => {
  const f = await fixture();
  const latest = await f.createRun("latest");
  f.supersede();
  f.replace(f.successor, { status: "FAILED", supersededByTaskRunId: latest.id });
  for (const task of [f.ancestor, f.successor]) assert.deepEqual(await f.tasks.retryTaskRun(f.retry(`retry-${task.id}`, task.id)), { kind: "STATE_INVALID" });
  assert.equal(await f.process(await f.queued(latest.id)), "PROCESSED");
  const execution = { workspaceId: f.workspaceId, taskRunId: latest.id, providerAttemptId: createPrefixedId("att"), now };
  assert.ok(await f.tasks.ensureProviderAttempt({ ...execution, provider: "mock", model: snapshot.model }));
  assert.equal(await f.tasks.reserveProviderSubmission(execution), true);
  assert.equal(await f.tasks.reserveProviderSubmission(execution), false);
  assert.equal((await f.tasks.findTaskRun(f.workspaceId, f.ancestor.id))?.supersededByTaskRunId, f.successor.id);
  assert.equal((await f.tasks.findTaskRun(f.workspaceId, f.successor.id))?.supersededByTaskRunId, latest.id);
});

test("memory guards reject superseded retry, recovery scan, ensure and reserve even for inconsistent active history", async () => {
  const f = await fixture();
  const attempt = f.seedAttempt();
  const execution = { workspaceId: f.workspaceId, taskRunId: f.ancestor.id, providerAttemptId: attempt.id, now };
  for (const status of ["FAILED", "SUCCEEDED", "QUEUED", "RUNNING", "PROVIDER_PROCESSING", "DOWNLOADING", "BILLING_PENDING", "BILLING_FAILED", "RETRY_SCHEDULED"] as const) {
    f.replace(f.supersede(status), { retryAt: new Date(0).toISOString(), error: { code: "CREDIT_UNAVAILABLE", message: "Fixture failure", retryable: true } });
    assert.deepEqual(await f.tasks.retryTaskRun(f.retry(`retry-${status}`)), { kind: "STATE_INVALID" }, status);
    assert.equal((await f.tasks.listRecoverableVideoTaskRuns({ limit: 100 })).some((task) => task.id === f.ancestor.id), false, status);
    assert.equal((await f.tasks.listRecoverableVideoTaskRuns({ limit: 100, statuses: [status] })).some((task) => task.id === f.ancestor.id), false, status);
    assert.equal(await f.tasks.ensureProviderAttempt({ ...execution, provider: "mock", model: snapshot.model }), undefined, status);
    assert.equal(await f.tasks.reserveProviderSubmission(execution), false, status);
    assert.deepEqual(f.state.attempts.get(attempt.id), attempt, status);
  }
  f.replace(f.successor, { status: "RUNNING" });
  assert.deepEqual((await f.tasks.listRecoverableVideoTaskRuns({ limit: 100 })).map((task) => task.id), [f.successor.id]);
});

test("memory stale queued events finish as duplicates without starting superseded history", async () => {
  const f = await fixture();
  const queued = await f.queued();
  const before = await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 });
  for (const status of ["FAILED", "SUCCEEDED", "QUEUED", "BILLING_PENDING"] as const) {
    const superseded = f.supersede(status);
    assert.equal(await f.process(queued, `stale-${status}`), "DUPLICATE");
    assert.equal(await f.process(queued, `stale-${status}`), "DUPLICATE");
    assert.deepEqual(await f.tasks.findTaskRun(f.workspaceId, f.ancestor.id), superseded);
  }
  assert.equal(await f.process({ ...queued, correlation_id: createPrefixedId("cor") }, "invalid-envelope"), "RETRY");
  assert.equal(await f.process({ ...queued, workspace_id: createPrefixedId("ws") }, "foreign-envelope"), "RETRY");
  assert.deepEqual(await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 }), before);
});

test("memory legacy missing markers remain compatible while non-null empty markers fail closed", async () => {
  const f = await fixture();
  const legacy = { ...f.ancestor, status: "FAILED" as const };
  delete legacy.supersededByTaskRunId;
  f.state.taskRuns.set(legacy.id, legacy);
  assert.equal((await f.tasks.retryTaskRun(f.retry("legacy-retry"))).kind, "NEW");
  const queued = await f.queued();
  const marked = f.replace(legacy, { status: "RUNNING", supersededByTaskRunId: "" });
  const attempt = f.seedAttempt();
  const execution = { workspaceId: f.workspaceId, taskRunId: f.ancestor.id, providerAttemptId: attempt.id, now };
  assert.deepEqual(await f.tasks.retryTaskRun(f.retry("empty-marker-retry")), { kind: "STATE_INVALID" });
  assert.equal(await f.tasks.ensureProviderAttempt({ ...execution, provider: "mock", model: snapshot.model }), undefined);
  assert.equal(await f.tasks.reserveProviderSubmission(execution), false);
  assert.equal((await f.tasks.listRecoverableVideoTaskRuns({ limit: 100 })).some((task) => task.id === f.ancestor.id), false);
  assert.equal(await f.process(queued), "DUPLICATE");
  assert.deepEqual(await f.tasks.recordProviderProcessing(execution), marked);
  assert.deepEqual(f.state.attempts.get(attempt.id), attempt);
});

test("memory task activation cannot overwrite a relation with an object captured before an await", async () => {
  const f = await fixture();
  const queued = await f.queued();
  const processing = f.process(queued);
  const superseded = f.supersede();
  await processing;
  assert.deepEqual(await f.tasks.findTaskRun(f.workspaceId, f.ancestor.id), superseded);
  assert.equal(await f.process(queued, "after-supersession"), "DUPLICATE");
});

test("memory late processing, download, asset, billing and failure writes preserve superseded history", async () => {
  const f = await fixture();
  const attempt = f.seedAttempt({ status: "SUCCEEDED", providerRequestId: "mock-accepted-request", responsePayload: { provider_request_terminal: true } });
  const assetId = createPrefixedId("ast");
  const execution = { workspaceId: f.workspaceId, taskRunId: f.ancestor.id, providerAttemptId: attempt.id, now };
  const generated = { ...execution, assetId, objectKey: `${f.workspaceId}/${f.projectId}/${assetId}/generated.mp4`, provider: "mock" };
  await f.tasks.ensureGeneratedAsset(generated);
  const asset = f.state.generatedAssets.get(assetId)!;
  const beforeEvents = await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 });
  const beforeShot = await f.assets.findShot(f.workspaceId, f.ancestor.shotId);
  const callbacks = [
    () => f.tasks.recordProviderProcessing(execution),
    () => f.tasks.beginDownload(execution),
    () => f.tasks.recordDownloadRetryableFailure({ ...execution, code: "DOWNLOAD_INVALID" }),
    () => f.tasks.ensureGeneratedAsset(generated),
    () => f.tasks.ensureGeneratedAsset({ ...generated, assetId: createPrefixedId("ast") }),
    () => f.tasks.completeGeneratedTaskRun({ ...execution, assetId, sha256: "b".repeat(64), byteSize: 1, width: 16, height: 9, durationMs: 1000 }),
    () => f.tasks.markBillingSucceeded({ ...execution, usageRecordId: createPrefixedId("use") }),
    () => f.tasks.markBillingFailed({ ...execution, code: "CREDIT_INSUFFICIENT", safeMessage: "Late billing failure" }),
    () => f.tasks.scheduleBillingRetry({ ...execution, code: "CREDIT_UNAVAILABLE", safeMessage: "Late billing retry", retryAt: now }),
    () => f.tasks.resumeBillingRetry(execution),
    () => f.tasks.finalizeTaskRunExecutionFailure({ ...execution, code: "PROVIDER_UNAVAILABLE", message: "Late execution failure" }),
    () => f.tasks.failTaskRun({ ...execution, code: "PROVIDER_REJECTED", message: "Late provider failure", retryable: false, failureStage: "PROVIDER" as const, providerRequestTerminal: true as const }),
  ];
  for (const status of ["FAILED", "SUCCEEDED", "RUNNING", "DOWNLOADING", "BILLING_PENDING", "BILLING_FAILED", "RETRY_SCHEDULED"] as const) {
    const superseded = f.replace(f.supersede(status), { resultAssetId: status === "SUCCEEDED" ? assetId : null, retryAt: new Date(0).toISOString(), error: { code: "CREDIT_UNAVAILABLE", message: "Fixture failure", retryable: true } });
    for (const callback of callbacks) {
      await callback();
      assert.deepEqual(await f.tasks.findTaskRun(f.workspaceId, f.ancestor.id), superseded, status);
      assert.deepEqual(f.state.attempts.get(attempt.id), attempt, status);
      assert.deepEqual([...f.state.generatedAssets.values()], [asset], status);
      assert.deepEqual(await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 }), beforeEvents, status);
      assert.deepEqual(await f.assets.findShot(f.workspaceId, f.ancestor.shotId), beforeShot, status);
    }
  }
});

test("memory late accepted request IDs remain evidence without changing superseded status or accepting another ID", async () => {
  const f = await fixture();
  const attempt = f.seedAttempt({ status: "FAILED", submissionReservedAt: now.toISOString(), responsePayload: { code: "PROVIDER_UNAVAILABLE" } });
  const superseded = f.supersede();
  const execution = { workspaceId: f.workspaceId, taskRunId: f.ancestor.id, providerAttemptId: attempt.id, providerRequestId: "mock-late-accepted-request", now: new Date(now.getTime() + 1000) };
  const beforeEvents = await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 });
  assert.equal(await f.tasks.recordProviderSubmission({ ...execution, workspaceId: createPrefixedId("ws") }), undefined);
  assert.deepEqual(f.state.attempts.get(attempt.id), attempt);
  assert.deepEqual(await f.tasks.recordProviderSubmission(execution), superseded);
  const recorded = { ...attempt, providerRequestId: execution.providerRequestId, updatedAt: execution.now.toISOString() };
  assert.deepEqual(f.state.attempts.get(attempt.id), recorded);
  await f.tasks.recordProviderSubmission({ ...execution, now: new Date(execution.now.getTime() + 1000) });
  assert.deepEqual(f.state.attempts.get(attempt.id), recorded);
  await assert.rejects(f.tasks.recordProviderSubmission({ ...execution, providerRequestId: "another-request" }), /PROVIDER_RESUBMIT_FORBIDDEN/u);
  assert.deepEqual(await f.tasks.findTaskRun(f.workspaceId, f.ancestor.id), superseded);
  assert.deepEqual(await f.tasks.listWorkspaceEvents({ workspaceId: f.workspaceId, limit: 100 }), beforeEvents);
});
