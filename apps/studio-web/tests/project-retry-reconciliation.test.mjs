import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  createAsyncOperationFence,
  isDefinitiveRetryRejection,
  mergeProductionProgressLists,
  mergeProductionProgressSnapshots,
  productionProgressFor,
  retryTargetHasAdvanced,
} from "../app/composables/useCreationProgress.ts";

const before = "2026-10-12T10:00:00.000Z";
const after = "2026-10-12T10:00:01.000Z";
const snapshot = (runStatus = "BLOCKED", segmentStatus = "FAILED", updatedAt = before) => ({
  production_run: { id: "run_a", project_id: "prj_a", status: runStatus, updated_at: updatedAt },
  segments: [{ id: "seg_a", production_run_id: "run_a", sequence: 1, status: segmentStatus, retryable: true, updated_at: updatedAt }],
});
const task = (status = "FAILED", updatedAt = before) => ({ id: "task_a", project_id: "prj_a", status, updated_at: updatedAt });

test("only explicit Control API 4xx rejections prove non-acceptance", () => {
  assert.equal(isDefinitiveRetryRejection({ statusCode: 400, data: { error: { code: "TASK_STATE_INVALID" } } }), true);
  assert.equal(isDefinitiveRetryRejection({ status: 409, data: { error: { code: "IDEMPOTENCY_CONFLICT" } } }), true);
  for (const error of [
    new Error("network failed"), { statusCode: 503 },
    { statusCode: 503, data: { error: { code: "TASK_STATE_INVALID" } } },
    { statusCode: 408, data: { error: { code: "TASK_STATE_INVALID" } } },
    { data: { error: { code: "TASK_STATE_INVALID" } } },
    { statusCode: 400, data: { error: { code: "UNKNOWN" } } },
    { statusCode: 400, data: null }, null,
  ]) assert.equal(isDefinitiveRetryRejection(error), false);
});

test("unknown retry receipts have neutral waiting progress rather than an old failure", () => {
  const progress = productionProgressFor(snapshot(), true, false, false, false, true);
  assert.equal(progress.statusLabel, "重试结果待确认");
  assert.equal(progress.tone, "active");
  assert.doesNotMatch(progress.message, /未提交|失败/);
});

test("segment reconciliation needs the exact project, run and segment target", () => {
  const target = { kind: "segment", projectId: "prj_a", productionRunId: "run_a", segmentId: "seg_a", sequence: 1, updatedAt: before };
  assert.equal(retryTargetHasAdvanced(target, [], [snapshot("GENERATING", "GENERATING", after)]), true);
  for (const invalid of [
    snapshot("SUCCEEDED", "ACCEPTED", before),
    snapshot("BLOCKED", "FAILED", after),
    { ...snapshot("SUCCEEDED", "ACCEPTED", after), production_run: { ...snapshot().production_run, id: "old_run", status: "SUCCEEDED", updated_at: after } },
    { ...snapshot("SUCCEEDED", "ACCEPTED", after), production_run: { ...snapshot().production_run, project_id: "prj_b", status: "SUCCEEDED", updated_at: after } },
    { ...snapshot("GENERATING", "GENERATING", after), segments: [{ ...snapshot().segments[0], id: "other_segment", status: "GENERATING", updated_at: after }] },
    { ...snapshot("GENERATING", "GENERATING", after), segments: [{ ...snapshot().segments[0], sequence: 2, status: "GENERATING", updated_at: after }] },
  ]) assert.equal(retryTargetHasAdvanced(target, [], [invalid]), false);
  assert.equal(retryTargetHasAdvanced(target, [], [snapshot("SUCCEEDED", "ACCEPTED", before)], true), true);
  assert.equal(retryTargetHasAdvanced(target, [], [snapshot("SUCCEEDED", "ACCEPTED", "invalid")], true), false);
});

test("task and composition reconciliation cannot use a historical success or another target", () => {
  const taskTarget = { kind: "task", projectId: "prj_a", taskRunId: "task_a", updatedAt: before };
  assert.equal(retryTargetHasAdvanced(taskTarget, [task("SUCCEEDED", after)], []), true);
  assert.equal(retryTargetHasAdvanced(taskTarget, [{ ...task("SUCCEEDED", after), id: "old_task" }], []), false);
  assert.equal(retryTargetHasAdvanced(taskTarget, [task("SUCCEEDED")], []), false);
  assert.equal(retryTargetHasAdvanced(taskTarget, [task("QUEUED")], [], true), true);
  const compositionTarget = { kind: "composition", projectId: "prj_a", productionRunId: "run_a", updatedAt: before };
  assert.equal(retryTargetHasAdvanced(compositionTarget, [], [snapshot("REVIEWING", "ACCEPTED", after)]), true);
  assert.equal(retryTargetHasAdvanced(compositionTarget, [], [snapshot("GENERATING", "ACCEPTED", after)]), false);
  assert.equal(retryTargetHasAdvanced(compositionTarget, [], [snapshot("SUCCEEDED", "ACCEPTED")], true), true);
});

test("fenced authoritative snapshots converge equal timestamps without inventing status ranking", () => {
  const active = snapshot("GENERATING", "GENERATING");
  const success = snapshot("SUCCEEDED", "ACCEPTED");
  assert.equal(mergeProductionProgressSnapshots(active, success).production_run.status, "GENERATING");
  assert.equal(mergeProductionProgressSnapshots(active, success, true).production_run.status, "SUCCEEDED");
  assert.equal(mergeProductionProgressSnapshots(snapshot(), active, true).segments[0].status, "GENERATING");
  assert.equal(mergeProductionProgressSnapshots(active, snapshot(), true).segments[0].status, "FAILED");
  assert.equal(mergeProductionProgressSnapshots(snapshot("GENERATING", "GENERATING", after), success, true).production_run.status, "GENERATING");
});

const page = readFileSync(new URL("../app/pages/projects/[project_id].vue", import.meta.url), "utf8");
const source = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
const handlersSource = [
  source("function clearRetryCommandFeedback()", "async function refreshProjectAndRelay()"),
  source("async function refreshProductionViews(", "function applyTaskRun("),
  source("async function retryProductionSegment(", "function startEditingName()"),
  source("async function retryGeneration()", "function selectReferenceFiles("),
  source("async function retryProductionComposition()", "async function uploadMusic("),
].join("\n");
const javascript = ts.transpileModule(handlersSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(kind = "segment", overrides = {}) {
  const response = Promise.withResolvers();
  const calls = [];
  const initial = snapshot(kind === "composition" ? "FAILED" : "BLOCKED", kind === "composition" ? "ACCEPTED" : "FAILED");
  const context = {
    selectedProjectId: { value: "prj_a" },
    detail: { value: { task_runs: [task()] } },
    productionProgress: { value: kind === "task" ? [] : [initial] },
    currentProductionProgress: { value: kind === "task" ? undefined : initial },
    failedProductionSegment: { value: kind === "task" ? undefined : initial.segments[0] },
    latestTask: { value: task() },
    canRetry: { value: true },
    creationBusy: { value: false },
    productionBusy: { value: false },
    retrySubmitting: { value: false },
    retryOutcomeUnknown: { value: false },
    retryProjectionPending: { value: false },
    retryingSegmentSequence: { value: undefined },
    retryCommandError: { value: "" },
    creationError: { value: "" },
    productionError: { value: "" },
    lastSubmittedTaskRunId: { value: "" },
    projectDeliveryPlans: { value: [] },
    projectVideoVersions: { value: [] },
    resultPreviewError: { value: "" },
    retryOperationFence: createAsyncOperationFence(),
    isDefinitiveRetryRejection, retryTargetHasAdvanced, mergeProductionProgressSnapshots, mergeProductionProgressLists,
    commandKey: (prefix) => `${prefix}-${calls.length}`,
    safeErrorMessage: () => "明确拒绝",
    retryProductionSegmentCommand: (...args) => { calls.push(["segment", ...args]); return response.promise; },
    retryTaskRun: (...args) => { calls.push(["task", ...args]); return response.promise; },
    retryProductionCompositionCommand: (...args) => { calls.push(["composition", ...args]); return response.promise; },
    refreshCurrentProject: async () => { calls.push(["refresh"]); },
    applyTaskRun: (current) => { context.detail.value.task_runs = [current]; },
    deliveryPlanRevisions: async () => ({ data: [] }),
    productionRuns: async () => ({ data: context.productionProgress.value }),
    videoVersions: async () => ({ data: [] }),
    syncProjectResultPreview: () => {},
    ...overrides,
  };
  const handlers = new Function(...Object.keys(context), `
    let projectRefreshEpoch = 0;
    let productionRefreshRequest = 0;
    let productionReadRevision = 0;
    let projectReadRevision = 0;
    let retryReconciliationTarget;
    let retryCommandRequest;
    function invalidateProjectRefresh() { projectRefreshEpoch += 1; }
    ${javascript}
    return { segment: retryProductionSegment, task: retryGeneration, composition: retryProductionComposition, continue: continueRetryRequest, reconcile: reconcileRetryCommand, refresh: refreshProductionViews, invalidate: invalidateProjectRefresh, projectRead: () => { projectReadRevision += 1; } };
  `)(...Object.values(context));
  return { context, handlers, calls, response };
}

for (const kind of ["segment", "task", "composition"]) {
  test(`actual ${kind} retry keeps a lost receipt unknown, prevents another POST, and reconciles only the matching fresh state`, async () => {
    const value = fixture(kind);
    const pending = value.handlers[kind](1);
    value.response.reject(new Error("response lost"));
    await pending;
    assert.equal(value.context.retryOutcomeUnknown.value, true);
    assert.match(value.context.retryCommandError.value, /结果待确认/);
    assert.doesNotMatch(value.context.retryCommandError.value, /未提交/);
    await value.handlers[kind](1);
    assert.equal(value.calls.filter(([name]) => name === kind).length, 1);

    value.context.detail.value.task_runs.push({ ...task("SUCCEEDED", after), id: "historical_task" });
    value.handlers.reconcile("task");
    assert.equal(value.context.retryOutcomeUnknown.value, true);

    if (kind === "task") {
      value.context.detail.value.task_runs = [task("SUCCEEDED")];
      value.handlers.reconcile("production");
      assert.equal(value.context.retryOutcomeUnknown.value, true);
      value.handlers.reconcile("task");
      assert.equal(value.context.lastSubmittedTaskRunId.value, "task_a");
    } else {
      value.context.productionProgress.value = [snapshot("SUCCEEDED", "ACCEPTED")];
      value.handlers.reconcile("task");
      assert.equal(value.context.retryOutcomeUnknown.value, true);
      value.handlers.reconcile("production");
    }
    assert.equal(value.context.retryOutcomeUnknown.value, false);
    assert.equal(value.context.retryCommandError.value, "");
  });
}

test("actual explicit rejection is distinct from unknown, and newer exact-target state supersedes it", async () => {
  const value = fixture();
  const pending = value.handlers.segment(1);
  value.response.reject({ statusCode: 400, data: { error: { code: "PRODUCTION_SEGMENT_STATE_INVALID" } } });
  await pending;
  assert.equal(value.context.retryOutcomeUnknown.value, false);
  assert.equal(value.context.retryCommandError.value, "明确拒绝");
  value.context.productionProgress.value = [snapshot("GENERATING", "GENERATING", after)];
  value.handlers.reconcile();
  assert.equal(value.context.retryCommandError.value, "");
});

test("actual current command response can advance an equal timestamp after retry", async () => {
  const value = fixture();
  const pending = value.handlers.segment(1);
  value.response.resolve({ data: snapshot("GENERATING", "GENERATING") });
  await pending;
  assert.equal(value.context.productionProgress.value[0].segments[0].status, "GENERATING");
  assert.equal(value.context.retryProjectionPending.value, true);
  await value.handlers.refresh();
  assert.equal(value.context.retryProjectionPending.value, false);
  assert.equal(value.calls.filter(([name]) => name === "refresh").length, 1);
});

for (const oldOutcome of ["resolve", "reject"]) {
  test(`actual production refresh ignores an older request ${oldOutcome} after equal-timestamp success`, async () => {
    const old = Promise.withResolvers();
    const current = Promise.withResolvers();
    let requests = 0;
    const value = fixture("segment", { productionRuns: () => ++requests === 1 ? old.promise : current.promise });
    const previous = value.handlers.refresh();
    const latest = value.handlers.refresh();
    current.resolve({ data: [snapshot("SUCCEEDED", "ACCEPTED")] });
    await latest;
    if (oldOutcome === "resolve") old.resolve({ data: [snapshot()] });
    else old.reject(new Error("old read failed"));
    await previous;
    assert.equal(value.context.productionProgress.value[0].production_run.status, "SUCCEEDED");
    assert.equal(value.context.productionProgress.value[0].segments[0].status, "ACCEPTED");
    assert.equal(value.context.resultPreviewError.value, "");
  });
}

test("a pre-command GET cannot reconcile a lost retry receipt but a fresh exact-target GET can", async () => {
  const old = Promise.withResolvers();
  const current = Promise.withResolvers();
  let requests = 0;
  const value = fixture("segment", { productionRuns: () => ++requests === 1 ? old.promise : current.promise });
  const staleRead = value.handlers.refresh();
  const retry = value.handlers.segment(1);
  value.response.reject(new Error("response lost"));
  await retry;
  old.resolve({ data: [snapshot("SUCCEEDED", "ACCEPTED")] });
  await staleRead;
  assert.equal(value.context.retryOutcomeUnknown.value, true);
  assert.equal(value.context.productionProgress.value[0].segments[0].status, "FAILED");
  const freshRead = value.handlers.refresh();
  current.resolve({ data: [snapshot("SUCCEEDED", "ACCEPTED")] });
  await freshRead;
  assert.equal(value.context.retryCommandError.value, "");
  assert.equal(value.context.retryOutcomeUnknown.value, false);
  assert.equal(value.context.productionProgress.value[0].segments[0].status, "ACCEPTED");
});

test("production refresh remains project-scoped and no-store reads back reconciliation", async () => {
  const response = Promise.withResolvers();
  const value = fixture("segment", { productionRuns: () => response.promise });
  const pending = value.handlers.refresh();
  value.context.selectedProjectId.value = "prj_b";
  response.resolve({ data: [snapshot("SUCCEEDED", "ACCEPTED")] });
  await pending;
  assert.equal(value.context.productionProgress.value[0].segments[0].status, "FAILED");
  const api = readFileSync(new URL("../app/composables/useControlApi.ts", import.meta.url), "utf8");
  assert.match(api, /\/projects\/\$\{projectId\}`,[^\n]*cache: "no-store"/);
  assert.match(api, /\/production-runs`, \{ cache: "no-store" \}/);
  assert.match(page, /canStartGeneration = computed\([\s\S]*?!retryOutcomeUnknown\.value/);
  assert.match(page, /async function generateVideo\(\)[\s\S]*?clearRetryCommandFeedback\(\)/);
});

for (const kind of ["segment", "composition", "task"]) {
  test(`late ${kind} command receipt cannot roll back equal-timestamp success observed by a post-start GET`, async () => {
    const value = fixture(kind, { productionRuns: async () => ({ data: [snapshot("SUCCEEDED", "ACCEPTED")] }) });
    const pending = value.handlers[kind](1);
    if (kind === "task") {
      value.context.detail.value.task_runs = [task("SUCCEEDED")];
      value.handlers.projectRead();
      value.response.resolve({ data: task("QUEUED") });
    } else {
      await value.handlers.refresh();
      value.response.resolve({ data: snapshot(kind === "composition" ? "REVIEWING" : "GENERATING", kind === "composition" ? "ACCEPTED" : "GENERATING") });
    }
    await pending;
    assert.equal(kind === "task" ? value.context.detail.value.task_runs[0].status : value.context.productionProgress.value[0].production_run.status, "SUCCEEDED");
    assert.equal(value.calls.filter(([name]) => name === "refresh").length, 1);
  });
}

for (const kind of ["segment", "composition", "task"]) {
  test(`lost ${kind} receipt followed by new FAILED is recoverable through explicit continuation of the exact original request`, async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    const requests = [];
    const api = { segment: "retryProductionSegmentCommand", composition: "retryProductionCompositionCommand", task: "retryTaskRun" }[kind];
    const value = fixture(kind, {
      [api]: (...args) => { requests.push(args); return requests.length === 1 ? first.promise : second.promise; },
      productionRuns: async () => ({ data: [snapshot("FAILED", "FAILED", after)] }),
    });
    const pending = value.handlers[kind](1);
    first.reject(new Error("lost receipt after server commit"));
    await pending;
    if (kind === "task") {
      value.context.detail.value.task_runs = [task("FAILED", after)];
      value.handlers.reconcile("task");
    } else {
      await value.handlers.refresh();
    }
    assert.equal(value.context.retryOutcomeUnknown.value, true);
    assert.equal(requests.length, 1, "unknown outcomes must never trigger an automatic replay");
    value.context.latestTask.value = { ...task(), id: "unrelated_task" };
    value.context.currentProductionProgress.value = { ...snapshot(), production_run: { ...snapshot().production_run, id: "unrelated_run" } };
    const continued = value.handlers.continue();
    assert.deepEqual(requests[1], requests[0], "target, sequence and idempotency key must remain identical");
    await value.handlers.continue();
    assert.equal(requests.length, 2, "repeated clicks must share the pending continuation");
    second.resolve({ data: kind === "task" ? task("QUEUED") : snapshot("GENERATING", "GENERATING") });
    await continued;
    assert.equal(value.context.retryOutcomeUnknown.value, false);
    assert.equal(value.context.retryProjectionPending.value, true);
    assert.match(value.context.retryCommandError.value, /已受理/);
    assert.equal(kind === "task" ? value.context.detail.value.task_runs[0].status : value.context.productionProgress.value[0].segments[0].status, "FAILED", "replayed receipts must not replace the current failed projection with historical active state");
    if (kind === "task") {
      value.context.detail.value.task_runs = [task("FAILED", after)];
      value.handlers.reconcile("task");
    }
    else await value.handlers.refresh();
    assert.equal(value.context.retryProjectionPending.value, false);
    assert.equal(value.context.retryCommandError.value, "");
    assert.equal(kind === "task" ? value.context.detail.value.task_runs[0].status : value.context.productionProgress.value[0].segments[0].status, "FAILED");
  });
}

test("continuation describes possible first execution and uses the existing empty-body retry contract", () => {
  assert.match(page, /按原请求继续/);
  assert.match(page, /上次请求未到达服务[\s\S]*?可能首次提交执行/);
  const api = readFileSync(new URL("../app/composables/useControlApi.ts", import.meta.url), "utf8");
  for (const symbol of ["retryTaskRun", "retryProductionSegment", "retryProductionComposition"]) {
    const body = api.slice(api.indexOf(`const ${symbol} =`), api.indexOf("});", api.indexOf(`const ${symbol} =`)));
    assert.match(body, /headers: commandHeaders\(idempotencyKey\)/);
    assert.match(body, /body: \{\}/);
  }
});

test("explicit task continuation never replaces current SUCCEEDED with its historical QUEUED receipt", async () => {
  const original = Promise.withResolvers();
  const replay = Promise.withResolvers();
  let requests = 0;
  const value = fixture("task", { retryTaskRun: () => ++requests === 1 ? original.promise : replay.promise });
  const first = value.handlers.task();
  original.reject(new Error("receipt lost"));
  await first;
  const continued = value.handlers.continue();
  value.context.detail.value.task_runs = [task("SUCCEEDED")];
  replay.resolve({ data: task("QUEUED") });
  await continued;
  assert.equal(value.context.detail.value.task_runs[0].status, "SUCCEEDED");
  assert.equal(value.context.retryOutcomeUnknown.value, false);
  assert.equal(value.context.retryProjectionPending.value, true);
  value.handlers.reconcile("task");
  assert.equal(value.context.retryProjectionPending.value, false);
  assert.equal(value.calls.filter(([name]) => name === "refresh").length, 2);
});

test("accepted receipt keeps new commands disabled until the exact-target fresh GET succeeds, including after read failure", async () => {
  let failRead = true;
  const value = fixture("segment", { productionRuns: async () => {
    if (failRead) throw new Error("read unavailable");
    return { data: [snapshot("FAILED", "FAILED", after)] };
  } });
  const pending = value.handlers.segment(1);
  value.response.resolve({ data: snapshot("GENERATING", "GENERATING") });
  await pending;
  assert.equal(value.context.retryProjectionPending.value, true);
  await value.handlers.refresh();
  assert.equal(value.context.retryProjectionPending.value, true);
  assert.match(value.context.retryCommandError.value, /已受理.*核对/);
  await value.handlers.segment(1);
  await value.handlers.task();
  await value.handlers.composition();
  await value.handlers.continue();
  assert.equal(value.calls.filter(([name]) => ["segment", "task", "composition"].includes(name)).length, 1);
  value.handlers.reconcile("task");
  assert.equal(value.context.retryProjectionPending.value, true);
  failRead = false;
  await value.handlers.refresh();
  assert.equal(value.context.retryProjectionPending.value, false);
  assert.equal(value.context.retryCommandError.value, "");
  assert.equal(value.context.productionProgress.value[0].segments[0].status, "FAILED");
});

for (const kind of ["task", "segment", "composition"]) {
  test(`${kind} continuation keeps its target when an in-flight GET succeeds before the replay receipt`, async () => {
    const original = Promise.withResolvers();
    const replay = Promise.withResolvers();
    const api = { segment: "retryProductionSegmentCommand", composition: "retryProductionCompositionCommand", task: "retryTaskRun" }[kind];
    let requests = 0;
    const value = fixture(kind, {
      [api]: () => ++requests === 1 ? original.promise : replay.promise,
      productionRuns: async () => ({ data: [snapshot("SUCCEEDED", "ACCEPTED")] }),
    });
    const first = value.handlers[kind](1);
    original.reject(new Error("receipt lost"));
    await first;
    const continued = value.handlers.continue();
    if (kind === "task") {
      value.context.detail.value.task_runs = [task("SUCCEEDED")];
      value.handlers.projectRead();
      value.handlers.reconcile("task");
    } else await value.handlers.refresh();
    assert.equal(value.context.retryOutcomeUnknown.value, true);
    replay.resolve({ data: kind === "task" ? task("QUEUED") : snapshot("GENERATING", "GENERATING") });
    await continued;
    assert.equal(value.context.retryProjectionPending.value, true);
    if (kind === "task") value.handlers.reconcile("task");
    else await value.handlers.refresh();
    assert.equal(value.context.retryProjectionPending.value, false);
    assert.equal(value.context.retryOutcomeUnknown.value, false);
    assert.equal(kind === "task" ? value.context.detail.value.task_runs[0].status : value.context.productionProgress.value[0].production_run.status, "SUCCEEDED");
  });
}

for (const kind of ["task", "segment", "composition"]) {
  test(`${kind} continuation retains its request after an in-flight GET succeeds and the replay receipt is lost`, async () => {
    const original = Promise.withResolvers();
    const replay = Promise.withResolvers();
    const api = { segment: "retryProductionSegmentCommand", composition: "retryProductionCompositionCommand", task: "retryTaskRun" }[kind];
    const requests = [];
    const value = fixture(kind, {
      [api]: (...args) => { requests.push(args); return requests.length === 1 ? original.promise : replay.promise; },
      productionRuns: async () => ({ data: [snapshot("SUCCEEDED", "ACCEPTED")] }),
    });
    const first = value.handlers[kind](1);
    original.reject(new Error("receipt lost"));
    await first;
    const continued = value.handlers.continue();
    if (kind === "task") {
      value.context.detail.value.task_runs = [task("SUCCEEDED")];
      value.handlers.reconcile("task");
    } else await value.handlers.refresh();
    assert.equal(value.context.retryOutcomeUnknown.value, true);
    replay.reject(new Error("replay receipt also lost"));
    await continued;
    assert.equal(value.context.retryOutcomeUnknown.value, true);
    assert.equal(value.context.retryProjectionPending.value, false);
    assert.deepEqual(requests[1], requests[0]);
    if (kind === "task") value.handlers.reconcile("task");
    else await value.handlers.refresh();
    assert.equal(value.context.retryOutcomeUnknown.value, false);
    assert.equal(value.context.retryProjectionPending.value, false);
    assert.equal(value.context.retryCommandError.value, "");
  });
}
