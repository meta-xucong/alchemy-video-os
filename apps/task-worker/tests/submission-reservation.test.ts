import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import { Sub2ApiVideoProvider } from "@alchemy-video/provider-video";
import { createInMemoryStoragePort } from "@alchemy-video/storage-client";
import type { TaskRunStore } from "@alchemy-video/persistence";

import { InMemoryTaskRunStore } from "../../control-api/src/task-run-repository.js";
import { InMemoryAssetWorkspaceStore } from "../../control-api/src/asset-repository.js";
import { InMemoryControlPlaneStore } from "../../control-api/src/repository.js";
import { MockVideoTaskExecutor } from "../src/execution-service.js";
import { createSub2ApiHttpsTransport, type WorkerFetch, type WorkerFetchResponse } from "../src/sub2api-https-transport.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });
const startedEvents = new WeakMap<TaskRunStore, Set<string>>();

const startQueued = async (store: TaskRunStore, workspaceId: string, taskRunId: string) => {
  const started = startedEvents.get(store) ?? new Set<string>();
  startedEvents.set(store, started);
  const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 100 }))
    .filter((item) => item.event_type === "task_run.queued" && !started.has(item.event_id)).at(-1);
  assert.ok(queued?.event_type === "task_run.queued");
  assert.equal(await store.processEvent({
    message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
    consumerName: "submission-reservation-test",
    workerId: "offline-worker",
    now: new Date(),
    leaseMs: 100,
  }), "PROCESSED");
  started.add(queued.event_id);
};

const prepareTask = async (start = true) => {
  const control = new InMemoryControlPlaneStore();
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  await control.ensureDevIdentity({ user: { id: createPrefixedId("usr"), displayName: "Offline reservation test" }, workspace: { id: workspaceId, name: "Offline reservation test" } });
  await control.createProject({ scope: "reservation:project", idempotencyKey: "project", requestHash: "a".repeat(64), workspaceId, projectId, name: "Offline project" });
  const assets = new InMemoryAssetWorkspaceStore(control);
  await assets.createShot({ scope: "reservation:shot", idempotencyKey: "shot", requestHash: "b".repeat(64), workspaceId, projectId, shotId, position: 0, prompt: "Offline request.", model: "grok-imagine-video-1.5", generationSettings: {}, referenceBindings: [] });
  await assets.setShotGenerationState({ workspaceId, shotId, status: "READY" });
  const store = new InMemoryTaskRunStore(assets);
  const taskRunId = createPrefixedId("tsk");
  assert.equal((await store.createTaskRun({
    scope: "reservation:task", idempotencyKey: "task", requestHash: "c".repeat(64), workspaceId, taskRunId, shotId,
    kind: "VIDEO_GENERATION",
    inputSnapshot: { model: "grok-imagine-video-1.5", prompt: "Offline request.", duration: 1, resolution: "480p", ratio: "16:9", reference_asset_ids: [] },
    event: event(),
  })).kind, "NEW");
  if (start) await startQueued(store, workspaceId, taskRunId);
  return { store, workspaceId, taskRunId };
};

const response = (json: unknown): WorkerFetchResponse => ({ status: 200, headers: { forEach() {} }, body: null, json: async () => json });

const runtime = (store: TaskRunStore, fetcher: WorkerFetch) => new MockVideoTaskExecutor(
  store,
  new Sub2ApiVideoProvider(createSub2ApiHttpsTransport({ environment: { SUB2API_VIDEO_BASE_URL: "https://offline.invalid/v1", SUB2API_VIDEO_API_KEY: "synthetic-offline-token" }, fetcher })),
  createInMemoryStoragePort(),
  { providerName: "sub2api", maxPollAttempts: 1 },
);

const retry = (context: Awaited<ReturnType<typeof prepareTask>>) => context.store.retryTaskRun({
  scope: `reservation:retry:${context.taskRunId}`, idempotencyKey: "retry", requestHash: "d".repeat(64), workspaceId: context.workspaceId, taskRunId: context.taskRunId, event: event(),
});

const ensureAttempt = (context: Awaited<ReturnType<typeof prepareTask>>) => context.store.ensureProviderAttempt({
  workspaceId: context.workspaceId, taskRunId: context.taskRunId, providerAttemptId: createPrefixedId("att"), provider: "sub2api", model: "grok-imagine-video-1.5", now: new Date(),
});

test("an accepted POST with a lost response cannot be repeated by delivery, restart, or explicit retry", async () => {
  const context = await prepareTask();
  let accepted = 0;
  const fetcher: WorkerFetch = async (_url, init) => {
    assert.equal(init.method, "POST");
    accepted += 1;
    throw new Error("Synthetic response loss after upstream acceptance.");
  };
  const failed = await runtime(context.store, fetcher).execute(context);
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.error?.retryable, false);
  assert.match(failed?.error?.message ?? "", /outcome is unknown/);
  await runtime(context.store, fetcher).execute(context);
  assert.equal((await retry(context)).kind, "STATE_INVALID");
  assert.equal(accepted, 1);
  const attempts = await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId);
  assert.equal(attempts.length, 1);
  assert.ok(attempts[0]?.submissionReservedAt);
  assert.equal(attempts[0]?.providerRequestId, null);
});

for (const failure of ["throw", "missing"] as const) {
  test(`a ${failure} request-ID persistence result fails closed after one accepted POST`, async () => {
    const context = await prepareTask();
    let accepted = 0;
    const fetcher: WorkerFetch = async (_url, init) => {
      assert.equal(init.method, "POST");
      accepted += 1;
      return response({ id: "accepted-id" });
    };
    context.store.recordProviderSubmission = async () => {
      if (failure === "throw") throw new Error("Synthetic database failure.");
      return undefined;
    };
    const failed = await runtime(context.store, fetcher).execute(context);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.error?.retryable, false);
    await runtime(context.store, fetcher).execute(context);
    assert.equal((await retry(context)).kind, "STATE_INVALID");
    assert.equal(accepted, 1);
    assert.ok((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0]?.submissionReservedAt);
  });
}

test("a crash after reservation and before POST remains uncertain on restart", async () => {
  const context = await prepareTask();
  const attempt = await ensureAttempt(context);
  assert.ok(attempt);
  assert.equal(await context.store.reserveProviderSubmission({ ...context, providerAttemptId: attempt.id, now: new Date() }), true);
  let calls = 0;
  const failed = await runtime(context.store, async () => { calls += 1; throw new Error("No request is allowed."); }).execute(context);
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.error?.retryable, false);
  assert.equal((await retry(context)).kind, "STATE_INVALID");
  assert.equal(calls, 0);
});

for (const commit of [false, true]) {
  test(`reservation persistence exception (committed=${commit}) never permits an unreserved POST`, async () => {
    const context = await prepareTask();
    const reserve = context.store.reserveProviderSubmission.bind(context.store);
    context.store.reserveProviderSubmission = async (input) => {
      if (commit) await reserve(input);
      throw new Error("Synthetic reservation persistence exception.");
    };
    let posts = 0;
    const fetcher: WorkerFetch = async (_url, init) => {
      if (init.method === "POST") { posts += 1; return response({ id: "accepted-id" }); }
      return response({ status: "processing" });
    };
    await assert.rejects(runtime(context.store, fetcher).execute(context), /could not complete/);
    assert.equal(posts, 0);
    context.store.reserveProviderSubmission = reserve;
    if (commit) {
      assert.equal((await runtime(context.store, fetcher).execute(context))?.status, "FAILED");
      assert.equal((await retry(context)).kind, "STATE_INVALID");
      assert.equal(posts, 0);
    } else {
      await assert.rejects(runtime(context.store, fetcher).execute(context), /still processing/);
      assert.equal(posts, 1);
    }
  });
}

test("a persisted request ID survives a lost commit response and explicit retry polls only", async () => {
  const context = await prepareTask();
  const record = context.store.recordProviderSubmission.bind(context.store);
  context.store.recordProviderSubmission = async (input) => { await record(input); throw new Error("Synthetic commit response loss."); };
  const methods: string[] = [];
  const fetcher: WorkerFetch = async (_url, init) => {
    methods.push(init.method);
    return response(init.method === "POST" ? { id: "durable-id" } : { status: "processing" });
  };
  assert.equal((await runtime(context.store, fetcher).execute(context))?.status, "FAILED");
  assert.equal((await retry(context)).kind, "NEW");
  await startQueued(context.store, context.workspaceId, context.taskRunId);
  await assert.rejects(runtime(context.store, fetcher).execute(context), /still processing/);
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0]?.providerRequestId, "durable-id");
});

test("duplicate execution during a slow POST cannot resubmit or discard the late request ID", async () => {
  const context = await prepareTask();
  let announceAcceptance!: () => void;
  const accepted = new Promise<void>((resolve) => { announceAcceptance = resolve; });
  let deliverResponse!: (value: WorkerFetchResponse) => void;
  const pendingResponse = new Promise<WorkerFetchResponse>((resolve) => { deliverResponse = resolve; });
  const methods: string[] = [];
  const fetcher: WorkerFetch = async (_url, init) => {
    methods.push(init.method);
    if (init.method === "GET") return response({ status: "processing" });
    announceAcceptance();
    return pendingResponse;
  };
  const first = runtime(context.store, fetcher).execute(context);
  await accepted;
  assert.equal((await runtime(context.store, fetcher).execute(context))?.status, "FAILED");
  deliverResponse(response({ id: "late-durable-id" }));
  assert.equal((await first)?.status, "FAILED");
  assert.equal((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0]?.providerRequestId, "late-durable-id");
  assert.equal((await retry(context)).kind, "NEW");
  await startQueued(context.store, context.workspaceId, context.taskRunId);
  await assert.rejects(runtime(context.store, fetcher).execute(context), /still processing/);
  assert.deepEqual(methods, ["POST", "GET"]);
});

test("submission reservation is exclusive, scoped, and unavailable for queued or cancelled tasks", async () => {
  const context = await prepareTask(false);
  const attempt = await ensureAttempt(context);
  assert.ok(attempt);
  const input = { workspaceId: context.workspaceId, taskRunId: context.taskRunId, providerAttemptId: attempt.id, now: new Date() };
  assert.equal(await context.store.reserveProviderSubmission(input), false);
  assert.equal(await context.store.reserveProviderSubmission({ ...input, workspaceId: createPrefixedId("ws") }), false);
  const task = await context.store.findTaskRun(context.workspaceId, context.taskRunId);
  assert.ok(task);
  // Seed the existing cancellation terminal state; no public cancellation API
  // exists in this repository. The executor and reservation must both refuse it.
  task.status = "ABANDONED";
  assert.equal(await context.store.reserveProviderSubmission(input), false);
  let calls = 0;
  assert.equal((await runtime(context.store, async () => { calls += 1; throw new Error("No request is allowed."); }).execute(context))?.status, "ABANDONED");
  assert.equal(calls, 0);

  const running = await prepareTask();
  const active = await ensureAttempt(running);
  assert.ok(active);
  const reservations = await Promise.all([0, 1].map(() => running.store.reserveProviderSubmission({ ...running, providerAttemptId: active.id, now: new Date() })));
  assert.deepEqual(reservations, [true, false]);
});

test("queue exception finalization preserves an unknown submission and rejects explicit retry", async () => {
  const context = await prepareTask();
  const attempt = await ensureAttempt(context);
  assert.ok(attempt);
  await context.store.reserveProviderSubmission({ ...context, providerAttemptId: attempt.id, now: new Date() });
  const failed = await context.store.finalizeTaskRunExecutionFailure({ ...context, code: "PROVIDER_UNAVAILABLE", message: "Synthetic exhausted delivery.", now: new Date() });
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.error?.retryable, false);
  assert.equal((await retry(context)).kind, "STATE_INVALID");
  assert.ok((await context.store.listTaskRunAttempts(context.workspaceId, context.taskRunId))[0]?.submissionReservedAt);
});
