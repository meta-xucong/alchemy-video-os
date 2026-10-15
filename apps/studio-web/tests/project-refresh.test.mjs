import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Exercise the actual page handlers with deferred API responses, following
// the existing MUSIC upload handler tests without copying their control flow.
const page = readFileSync(new URL("../app/pages/projects/[project_id].vue", import.meta.url), "utf8");
const start = page.indexOf("async function refreshCurrentProject()");
const end = page.indexOf("function clearRetryCommandFeedback()", start);
assert.ok(start >= 0 && end > start);
const refreshSource = page.slice(start, end);

function fixture(overrides = {}) {
  const calls = [];
  const context = {
    selectedProjectId: { value: "prj_a" },
    projectError: { value: "" },
    project: async (id) => { calls.push(["project", id]); return { data: { id } }; },
    replaceProjectDetail: (detail) => calls.push(["detail", detail]),
    syncProjectResultPreview: () => calls.push(["preview"]),
    reconcileRetryCommand: () => {},
    refreshDocuments: async (id) => { calls.push(["documents", id]); },
    refreshProductionViews: async (id, epoch) => { calls.push(["production", id, epoch]); },
    refreshAudioCapabilities: async (id) => { calls.push(["audio", id]); },
    safeErrorMessage: (_error, fallback) => fallback,
    ...overrides,
  };
  const handlers = new Function(...Object.keys(context), `
    let projectRefreshInFlight;
    let projectRefreshEpoch = 0;
    let projectReadRevision = 0;
    ${refreshSource}
    return {
      refresh: refreshCurrentProject,
      invalidate: invalidateProjectRefresh,
      inFlight: () => projectRefreshInFlight,
    };
  `)(...Object.values(context));
  return { ...handlers, context, calls };
}

test("project refresh does nothing when no project is selected", async () => {
  const value = fixture({ selectedProjectId: { value: "" } });
  await value.refresh();
  assert.deepEqual(value.calls, []);
  assert.equal(value.inFlight(), undefined);
});

test("project refresh shares one flight until dependent projections finish", async () => {
  const response = Promise.withResolvers();
  const documents = Promise.withResolvers();
  let requests = 0;
  const value = fixture({
    project: () => { requests += 1; return response.promise; },
    refreshDocuments: () => documents.promise,
  });
  const first = value.refresh();
  const flight = value.inFlight();
  const second = value.refresh();
  assert.equal(requests, 1);
  assert.equal(value.inFlight(), flight);

  response.resolve({ data: { id: "prj_a" } });
  await Promise.resolve();
  const third = value.refresh();
  assert.equal(requests, 1);
  assert.equal(value.inFlight(), flight);
  assert.deepEqual(value.calls, [
    ["detail", { id: "prj_a" }], ["preview"], ["production", "prj_a", 0], ["audio", "prj_a"],
  ]);

  documents.resolve();
  await Promise.all([first, second, third]);
  assert.equal(value.inFlight(), undefined);
  await value.refresh();
  assert.equal(requests, 2);
});

for (const failure of ["synchronous throw", "rejected response", "rejected projection"]) {
  test(`project refresh clears its flight after ${failure} and allows another request`, async () => {
    let requests = 0;
    const value = fixture({
      project: () => {
        requests += 1;
        if (requests === 1 && failure === "synchronous throw") throw new Error("offline");
        if (requests === 1 && failure === "rejected response") return Promise.reject(new Error("offline"));
        return Promise.resolve({ data: { id: "prj_a" } });
      },
      refreshDocuments: async () => {
        if (requests === 1 && failure === "rejected projection") throw new Error("offline");
      },
    });
    await value.refresh();
    assert.equal(value.context.projectError.value, "项目暂时无法刷新，请稍后重试。");
    assert.equal(value.inFlight(), undefined);
    await value.refresh();
    assert.equal(requests, 2);
    assert.equal(value.inFlight(), undefined);
  });
}

for (const invalidate of ["retry epoch", "project navigation"]) {
  for (const oldOutcome of ["resolve", "reject"]) {
    test(`old ${oldOutcome} after ${invalidate} cannot change the current view or release its flight`, async () => {
      const oldResponse = Promise.withResolvers();
      const currentResponse = Promise.withResolvers();
      let requests = 0;
      const value = fixture({
        project: () => (++requests === 1 ? oldResponse.promise : currentResponse.promise),
      });
      const oldRefresh = value.refresh();
      value.invalidate();
      if (invalidate === "project navigation") value.context.selectedProjectId.value = "prj_b";
      const currentRefresh = value.refresh();
      const currentFlight = value.inFlight();
      if (oldOutcome === "resolve") oldResponse.resolve({ data: { id: "prj_a", stale: true } });
      else oldResponse.reject(new Error("stale failure"));
      await oldRefresh;

      assert.equal(value.inFlight(), currentFlight);
      assert.equal(value.context.projectError.value, "");
      assert.deepEqual(value.calls, []);
      const duplicate = value.refresh();
      assert.equal(requests, 2);
      const id = value.context.selectedProjectId.value;
      currentResponse.resolve({ data: { id, current: true } });
      await Promise.all([currentRefresh, duplicate]);
      assert.equal(value.inFlight(), undefined);
      assert.deepEqual(value.calls, [
        ["detail", { id, current: true }], ["preview"], ["documents", id], ["production", id, 1], ["audio", id],
      ]);
    });
  }
}

test("late old project refresh cannot overwrite a completed replacement", async () => {
  const oldResponse = Promise.withResolvers();
  let requests = 0;
  const value = fixture({
    project: () => (++requests === 1 ? oldResponse.promise : Promise.resolve({ data: { id: "prj_a", current: true } })),
  });
  const oldRefresh = value.refresh();
  value.invalidate();
  await value.refresh();
  const currentCalls = [...value.calls];
  oldResponse.resolve({ data: { id: "prj_a", stale: true } });
  await oldRefresh;
  assert.deepEqual(value.calls, currentCalls);
  assert.equal(value.inFlight(), undefined);
});
