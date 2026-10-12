import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createAsyncOperationFence } from "../app/composables/useCreationProgress.ts";

const page = readFileSync(new URL("../app/pages/projects/[project_id].vue", import.meta.url), "utf8");
const flowSource = page.slice(page.indexOf("const delay ="), page.indexOf("async function retryProductionSegment("));
const entrySource = page.slice(page.indexOf("async function generateVideo()"), page.indexOf("async function retryGeneration()"));
const javascript = ts.transpileModule(`${flowSource}\n${entrySource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(pauseAt) {
  const reached = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  const applied = [];
  const projectId = "prj_a";
  const call = async (stage, args, data) => {
    calls.push([stage, ...args]);
    if (stage === pauseAt) {
      reached.resolve();
      await release.promise;
    }
    return { data };
  };
  const storyboard = { id: "stb_a", project_id: projectId, status: "READY_FOR_REVIEW", created_at: new Date().toISOString() };
  const context = {
    detail: { value: { project: { id: projectId } } },
    selectedProjectId: { value: projectId },
    planningOperationFence: createAsyncOperationFence(),
    canStartGeneration: { value: true },
    creationBusy: { value: false },
    planningBusy: { value: false },
    productionBusy: { value: false },
    creationError: { value: "" },
    planningError: { value: "" },
    productionError: { value: "" },
    planningMessage: { value: "" },
    currentPlanningBrief: { value: undefined },
    planningDraft: { sourceText: "project A story", targetDurationSeconds: 30, targetResolution: "720p", stylePreferences: "A style", sourceAssetIds: ["ast_a"] },
    deliverySettings: { durationPolicy: "EXACT", flexibleDurationPercent: 5, lipSyncRequirement: "OFF", voiceMode: "PLATFORM_GENERIC" },
    captionPolicy: { value: "OFF" },
    musicPlan: { mode: "MANUAL", assetId: "music_a", styleHint: "" },
    audioSelection: { value: "PRESERVE_PROVIDER_AUDIO" },
    selectedMusicAsset: { value: { id: "music_a" } },
    eligiblePlanningSourceIds: (ids) => ids,
    clearRetryCommandFeedback: () => {},
    commandKey: (prefix) => prefix,
    safeErrorMessage: (_error, fallback) => fallback,
    refreshAudioCapabilities: (...args) => call("audio", args),
    createCreativeBriefRevision: (...args) => call("brief", args, { id: "brief_a", project_id: projectId }),
    requestCreativePlan: (...args) => call("request-plan", args, { id: "brief_a", project_id: projectId }),
    storyboardRevisions: (...args) => call("storyboard", args, pauseAt === "refresh" || pauseAt === "delay" ? [] : [storyboard]),
    approveStoryboardRevision: (...args) => call("approve-storyboard", args, { ...storyboard, status: "APPROVED" }),
    createDeliveryPlanRevision: (...args) => call("delivery", args, { id: "delivery_a", status: "AWAITING_APPROVAL" }),
    approveDeliveryPlanRevision: (...args) => call("approve-delivery", args, { id: "delivery_a", status: "APPROVED" }),
    createProductionRun: (...args) => call("production", args, { id: "run_a", project_id: projectId }),
    refreshCurrentProject: (...args) => call("refresh", args),
    setTimeout: (callback) => {
      calls.push(["delay"]);
      reached.resolve();
      void release.promise.then(callback);
    },
    applyCreativeBriefRevision: (value) => applied.push(["brief", value]),
    applyStoryboardRevision: (value) => applied.push(["storyboard", value]),
    applyDeliveryPlan: (value) => applied.push(["delivery", value]),
    applyProductionRun: (value) => applied.push(["production", value]),
  };
  const generate = new Function(...Object.keys(context), `${javascript}\nreturn generateVideo;`)(...Object.values(context));
  return { context, generate, reached: reached.promise, release, calls, applied };
}

for (const stage of ["audio", "brief", "request-plan", "storyboard", "approve-storyboard", "delivery", "approve-delivery", "production", "refresh", "delay"]) {
  test(`navigation during ${stage} stops the old planning flow without clearing the new project's state`, async () => {
    const value = fixture(stage);
    const oldRun = value.generate();
    await value.reached;
    const previousCalls = [...value.calls];
    const previousApplied = [...value.applied];
    value.context.planningOperationFence.invalidate();
    value.context.selectedProjectId.value = "prj_b";
    value.context.planningOperationFence.begin();
    value.context.planningBusy.value = true;
    value.context.creationBusy.value = true;
    value.context.planningMessage.value = "new project is planning";
    value.context.planningError.value = "new project error";
    value.context.creationError.value = "new project error";
    value.release.resolve();
    await oldRun;
    assert.deepEqual(value.calls, previousCalls);
    assert.deepEqual(value.applied, previousApplied);
    assert.equal(value.context.planningBusy.value, true);
    assert.equal(value.context.creationBusy.value, true);
    assert.equal(value.context.planningMessage.value, "new project is planning");
    assert.equal(value.context.planningError.value, "new project error");
    assert.equal(value.context.creationError.value, "new project error");
  });
}

test("A to B to A navigation invalidates the original planning operation even when project ID matches again", async () => {
  const value = fixture("storyboard");
  const pending = value.generate();
  await value.reached;
  value.context.planningOperationFence.invalidate();
  value.context.selectedProjectId.value = "prj_b";
  value.context.planningOperationFence.invalidate();
  value.context.selectedProjectId.value = "prj_a";
  value.release.resolve();
  await pending;
  assert.equal(value.calls.some(([stage]) => stage === "approve-storyboard"), false);
});

test("all planning commands use the project inputs captured before the first await", async () => {
  const value = fixture("audio");
  const pending = value.generate();
  await value.reached;
  Object.assign(value.context.planningDraft, { sourceText: "changed story", targetDurationSeconds: 60, targetResolution: "480p", stylePreferences: "changed style" });
  value.context.planningDraft.sourceAssetIds.push("ast_b");
  Object.assign(value.context.deliverySettings, { durationPolicy: "FLEXIBLE", flexibleDurationPercent: 20, lipSyncRequirement: "REQUIRED", voiceMode: "AUTHORIZED_CLONE" });
  value.context.captionPolicy.value = "REQUIRED";
  value.context.musicPlan.assetId = "music_b";
  value.context.audioSelection.value = "MUSIC_REPLACE_PROVIDER_AUDIO";
  value.release.resolve();
  await pending;
  assert.deepEqual(value.calls.find(([stage]) => stage === "brief").slice(1, 3), ["prj_a", {
    source_text: "project A story", target_duration_seconds: 30, target_resolution: "720p", style_preferences: "A style", source_asset_ids: ["ast_a"],
  }]);
  assert.deepEqual(value.calls.find(([stage]) => stage === "delivery").slice(1, 3), ["prj_a", {
    creative_brief_revision_id: "brief_a", storyboard_revision_id: "stb_a", duration_policy: "EXACT", flexible_duration_percent: 0, caption_policy: "OFF", lip_sync_requirement: "OFF", voice_mode: "PLATFORM_GENERIC",
  }]);
  assert.deepEqual(value.calls.find(([stage]) => stage === "production").slice(1, 3), ["prj_a", {
    storyboard_revision_id: "stb_a", delivery_plan_revision_id: "delivery_a", music_plan: { mode: "MANUAL", asset_id: "music_a" }, audio_selection: "PRESERVE_PROVIDER_AUDIO",
  }]);
  assert.equal(value.context.planningBusy.value, false);
  assert.equal(value.context.creationBusy.value, false);
  assert.equal(value.context.planningError.value, "");
});

test("page navigation and unmount invalidate the planning operation", () => {
  assert.match(page, /watch\(projectId, \(\) => \{[\s\S]*?planningOperationFence\.invalidate\(\)/);
  assert.match(page, /onBeforeUnmount\(\(\) => \{\s*planningOperationFence\.invalidate\(\)/);
});
