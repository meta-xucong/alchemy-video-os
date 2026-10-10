import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import { Sub2ApiVideoProvider, type Sub2ApiTransport } from "@alchemy-video/provider-video";
import { createInMemoryStoragePort } from "@alchemy-video/storage-client";
import { hasTerminalProviderResult, type ControlTaskRun } from "@alchemy-video/persistence";
import { InMemoryTaskRunStore } from "../../control-api/src/task-run-repository.js";
import { InMemoryAssetWorkspaceStore } from "../../control-api/src/asset-repository.js";
import { InMemoryControlPlaneStore } from "../../control-api/src/repository.js";
import { MockVideoTaskExecutor } from "../src/execution-service.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });

const prepare = async () => {
  const control = new InMemoryControlPlaneStore();
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  await control.ensureDevIdentity({ user: { id: createPrefixedId("usr"), displayName: "Offline retry test" }, workspace: { id: workspaceId, name: "Offline retry test" } });
  await control.createProject({ scope: "known:project", idempotencyKey: "project", requestHash: "a".repeat(64), workspaceId, projectId, name: "Offline retry" });
  const assets = new InMemoryAssetWorkspaceStore(control);
  await assets.createShot({ scope: "known:shot", idempotencyKey: "shot", requestHash: "b".repeat(64), workspaceId, projectId, shotId, position: 0, prompt: "Offline request.", model: "grok-imagine-video-1.5", generationSettings: {}, referenceBindings: [] });
  await assets.setShotGenerationState({ workspaceId, shotId, status: "READY" });
  const store = new InMemoryTaskRunStore(assets);
  const taskRunId = createPrefixedId("tsk");
  assert.equal((await store.createTaskRun({ scope: "known:task", idempotencyKey: "task", requestHash: "c".repeat(64), workspaceId, taskRunId, shotId, kind: "VIDEO_GENERATION", inputSnapshot: { model: "grok-imagine-video-1.5", prompt: "Offline request.", duration: 1, resolution: "480p", ratio: "16:9", reference_asset_ids: [] }, event: event() })).kind, "NEW");
  const started = new Set<string>();
  const start = async () => {
    const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 100 })).find((item) => item.event_type === "task_run.queued" && !started.has(item.event_id));
    assert.ok(queued?.event_type === "task_run.queued");
    assert.equal(await store.processEvent({ message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot }, consumerName: "known-retry", workerId: "offline", now: new Date(), leaseMs: 100 }), "PROCESSED");
    started.add(queued.event_id);
  };
  const retry = async () => {
    assert.equal((await store.retryTaskRun({ scope: "known:retry", idempotencyKey: createPrefixedId("cmd"), requestHash: "d".repeat(64), workspaceId, taskRunId, event: event() })).kind, "NEW");
    await start();
  };
  await start();
  return { store, workspaceId, taskRunId, start, retry };
};

for (const status of [401, 403, 404]) {
  test(`status HTTP ${status} cannot authorize a second submission of a known request`, async () => {
    const context = await prepare();
    const methods: string[] = [];
    let posts = 0;
    let reads = 0;
    const transport: Sub2ApiTransport = { async request(request) {
      methods.push(request.method);
      if (request.method === "POST") return { status: 202, json: { id: `known-${++posts}` } };
      return ++reads === 1 ? { status, json: { message: "Synthetic access/routing failure.", provider_request_terminal: true } } : { status: 200, json: { status: "processing" } };
    } };
    const executor = new MockVideoTaskExecutor(context.store, new Sub2ApiVideoProvider(transport), createInMemoryStoragePort(), { providerName: "sub2api", maxPollAttempts: 1 });
    assert.equal((await executor.execute(context))?.error?.code, "PROVIDER_REJECTED");
    await context.retry();
    await assert.rejects(executor.execute(context), /still processing/);
    assert.deepEqual(methods, ["POST", "GET", "GET"]);
    assert.equal((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId)).length, 1);
  });
}

test("an incompatible recovery Worker cannot authorize discarding the known request", async () => {
  const context = await prepare();
  const methods: string[] = [];
  const transport: Sub2ApiTransport = { async request(request) {
    methods.push(request.method);
    return { status: 200, json: request.method === "POST" ? { id: `known-${methods.length}` } : { status: "processing" } };
  } };
  const provider = new Sub2ApiVideoProvider(transport);
  const executor = new MockVideoTaskExecutor(context.store, provider, createInMemoryStoragePort(), { providerName: "sub2api", maxPollAttempts: 1 });
  await assert.rejects(executor.execute(context), /still processing/);
  const wrongWorker = new MockVideoTaskExecutor(context.store, provider, createInMemoryStoragePort(), { providerName: "sub2api", expectedModel: "different-model", maxPollAttempts: 1 });
  assert.equal((await wrongWorker.execute(context))?.error?.code, "PROVIDER_REJECTED");
  await context.retry();
  await assert.rejects(executor.execute(context), /still processing/);
  assert.deepEqual(methods, ["POST", "GET", "GET"]);
});

test("a source-recognized terminal status permits one explicit new attempt", async () => {
  const context = await prepare();
  let posts = 0;
  const transport: Sub2ApiTransport = { async request(request) {
    return { status: 200, json: request.method === "POST" ? { id: `known-${++posts}` } : { status: posts === 1 ? "failed" : "processing" } };
  } };
  const executor = new MockVideoTaskExecutor(context.store, new Sub2ApiVideoProvider(transport), createInMemoryStoragePort(), { providerName: "sub2api", maxPollAttempts: 1 });
  assert.equal((await executor.execute(context))?.error?.code, "PROVIDER_REJECTED");
  await context.retry();
  await assert.rejects(executor.execute(context), /still processing/);
  assert.equal(posts, 2);
  const attempts = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.status, "ABANDONED");
});

test("historical abandoned requests and malformed private flags remain recoverable without another POST", async () => {
  for (const flag of [undefined, false, "true", [true], 1, { terminal: true }]) {
    const context = await prepare();
    let posts = 0;
    const provider = new Sub2ApiVideoProvider({ async request(request) {
      return { status: 200, json: request.method === "POST" ? { id: `known-${++posts}` } : { status: "processing" } };
    } });
    const executor = new MockVideoTaskExecutor(context.store, provider, createInMemoryStoragePort(), { providerName: "sub2api", maxPollAttempts: 1 });
    await assert.rejects(executor.execute(context), /still processing/);
    const [known] = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
    assert.ok(known);
    await context.store.failTaskRun({ ...context, providerAttemptId: known.id, code: "PROVIDER_REJECTED", message: "Historical generic rejection.", retryable: false, now: new Date() });
    const [historical] = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
    assert.ok(historical);
    historical.status = "ABANDONED";
    historical.responsePayload = { provider_request_terminal: flag };
    assert.equal(hasTerminalProviderResult(historical), false);
    await context.retry();
    assert.equal(await context.store.reserveProviderSubmission({ ...context, providerAttemptId: known.id, now: new Date() }), false);
    await assert.rejects(executor.execute(context), /still processing/);
    assert.equal(posts, 1);
  }
});

test("a superseded historical task is a no-op before any Provider call", async () => {
  const context = await prepare();
  const current = await context.store.findTaskRun(context.workspaceId, context.taskRunId);
  assert.ok(current);
  // Private fixture only: no memory ProductionStore or supersession API exists.
  const rows = (context.store as unknown as { taskRuns: Map<string, ControlTaskRun> }).taskRuns;
  rows.set(current.id, { ...current, status: "FAILED", supersededByTaskRunId: createPrefixedId("tsk") });
  let calls = 0;
  const provider = new Sub2ApiVideoProvider({ async request() { calls += 1; throw new Error("No provider request is allowed."); } });
  const executor = new MockVideoTaskExecutor(context.store, provider, createInMemoryStoragePort(), { providerName: "sub2api" });
  assert.equal((await executor.execute(context))?.status, "FAILED");
  assert.equal(calls, 0);
  assert.equal((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId)).length, 0);
});

for (const status of ["processing", "completed", "transient"] as const) {
  test(`a stale ${status} response cannot continue polling or download after supersession`, async () => {
    const context = await prepare();
    const attempt = await context.store.ensureProviderAttempt({ ...context, providerAttemptId: createPrefixedId("att"), provider: "sub2api", model: "grok-imagine-video-1.5", now: new Date() });
    assert.ok(attempt);
    assert.equal(await context.store.reserveProviderSubmission({ ...context, providerAttemptId: attempt.id, now: new Date() }), true);
    await context.store.recordProviderSubmission({ ...context, providerAttemptId: attempt.id, providerRequestId: "offline-stale-known", now: new Date() });
    const calls: string[] = [];
    const provider = new Sub2ApiVideoProvider({ async request(request) {
      calls.push(request.method);
      assert.equal(request.method, "GET");
      assert.equal(calls.length, 1, "supersession must stop subsequent poll/download calls");
      const current = await context.store.findTaskRun(context.workspaceId, context.taskRunId);
      assert.ok(current);
      // Model an already in-flight response arriving after the durable ancestor
      // was closed and replaced elsewhere; this fixture does not authorize it.
      const rows = (context.store as unknown as { taskRuns: Map<string, ControlTaskRun> }).taskRuns;
      rows.set(current.id, { ...current, status: "FAILED", supersededByTaskRunId: createPrefixedId("tsk") });
      return status === "transient" ? { status: 503, json: { message: "Offline transient failure." } } : { status: 200, json: { status } };
    } });
    const executor = new MockVideoTaskExecutor(context.store, provider, createInMemoryStoragePort(), { providerName: "sub2api", maxPollAttempts: 3, retryableStatusPolls: 3 });
    assert.equal((await executor.execute(context))?.status, "FAILED");
    assert.deepEqual(calls, ["GET"]);
    assert.equal((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0]?.status, "SUBMITTED");
    assert.equal(await context.store.findGeneratedAssetDraft(context.workspaceId, context.taskRunId), undefined);
  });
}
