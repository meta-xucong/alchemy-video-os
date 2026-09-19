import assert from "node:assert/strict";
import test from "node:test";

import { ProductionRunProgressSchema, VideoVersionSchema } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import { InMemoryCreativePlanningStore, type ControlProductionRunProgress, type ControlVideoVersion } from "@alchemy-video/persistence";

import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const post = (app: ReturnType<typeof createApp>, path: string, idempotencyKey: string, body: Record<string, unknown> = {}) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });

test("C12 public readers expose progress and completed video versions without storage or execution internals", async () => {
  const app = createApp({
    productionStore: {
      async listProjectProductionProgress(workspaceId, projectId) {
        const progress: ControlProductionRunProgress = {
          productionRun: {
            id: createPrefixedId("prd"),
            workspaceId,
            projectId,
            storyboardRevisionId: createPrefixedId("sbr"),
            status: "GENERATING",
            totalShotCount: 2,
            acceptedShotCount: 1,
            totalDurationSeconds: 30,
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:01:00.000Z",
          },
          segments: [{
            id: createPrefixedId("psg"),
            productionRunId: createPrefixedId("prd"),
            sequence: 2,
            title: "黎明交付",
            status: "WAITING",
            retryable: true,
            safeSummary: "等待前一段完成检查。",
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:01:00.000Z",
          }],
        };
        return [progress];
      },
      async listProjectVideoVersions(workspaceId, projectId) {
        const version: ControlVideoVersion = {
          id: createPrefixedId("vvr"),
          workspaceId,
          projectId,
          productionRunId: createPrefixedId("prd"),
          storyboardRevisionId: createPrefixedId("sbr"),
          assetId: createPrefixedId("ast"),
          status: "SUCCEEDED",
          durationMs: 30_000,
          qcReport: {
            id: createPrefixedId("qcr"),
            workspaceId,
            projectId,
            subjectType: "VIDEO_VERSION",
            subjectId: createPrefixedId("vvr"),
            kind: "COMPOSITION",
            status: "PASS",
            safeSummary: "完整成片已通过基础检查。",
            createdAt: "2026-08-16T00:01:00.000Z",
          },
          createdAt: "2026-08-16T00:01:00.000Z",
        };
        return [version];
      },
      async retryProductionSegment() {
        return { kind: "STATE_INVALID" as const };
      },
      async retryProductionComposition() {
        return { kind: "STATE_INVALID" as const };
      },
    },
  });
  const created = await readJson(await post(app, "/api/v1/projects", "c12-public-read-project", { name: "C12 public review" }));
  const projectId = created.data.id as string;

  const progressResponse = await app.request(`http://localhost/api/v1/projects/${projectId}/production-runs`);
  const progress = await readJson(progressResponse);
  assert.equal(progressResponse.status, 200);
  assert.equal(progress.data.length, 1);
  assert.doesNotThrow(() => ProductionRunProgressSchema.parse(progress.data[0]));
  assert.equal(progress.data[0].segments[0].safe_summary, "等待前一段完成检查。");

  const versionsResponse = await app.request(`http://localhost/api/v1/projects/${projectId}/video-versions`);
  const versions = await readJson(versionsResponse);
  assert.equal(versionsResponse.status, 200);
  assert.equal(versions.data.length, 1);
  assert.doesNotThrow(() => VideoVersionSchema.parse(versions.data[0]));
  const retryResponse = await post(app, `/api/v1/production-runs/${createPrefixedId("prd")}/segments/1/retry`, "c12-retry-invalid");
  const retry = await readJson(retryResponse);
  assert.equal(retryResponse.status, 400);
  assert.equal(retry.error.code, "PRODUCTION_SEGMENT_STATE_INVALID");
  const compositionRetryResponse = await post(app, `/api/v1/production-runs/${createPrefixedId("prd")}/composition/retry`, "c12-composition-retry-invalid");
  const compositionRetry = await readJson(compositionRetryResponse);
  assert.equal(compositionRetryResponse.status, 400);
  assert.equal(compositionRetry.error.code, "PRODUCTION_RUN_STATE_INVALID");
  const serialized = JSON.stringify({ progress, versions });
  for (const forbidden of ["object_key", "download_url", "provider_request_id", "task_run_id", "prompt", "Authorization"]) {
    assert.equal(serialized.includes(forbidden), false, `C12 public reader leaked ${forbidden}.`);
  }
});

test("C12 public progress reader keeps its declared shape before the durable media store is attached", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const planningStore = new InMemoryCreativePlanningStore(assetStore);
  const app = createApp({ store, assetStore, taskStore, planningStore });
  const project = await readJson(await post(app, "/api/v1/projects", "c12-fallback-project", { name: "C12 fallback progress" }));
  const projectId = project.data.id as string;
  const briefId = createPrefixedId("cbr");
  await planningStore.createCreativeBriefRevision({
    scope: "c12-fallback:brief",
    idempotencyKey: "create-brief",
    requestHash: fingerprintRequest({}),
    workspaceId: "ws_dev_default",
    projectId,
    creativeBriefRevisionId: briefId,
    sourceText: "团队在雨夜完成交付。",
    targetDurationSeconds: 15,
    targetResolution: "720p",
    stylePreferences: "",
    sourceAssetIds: [],
    event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });
  await planningStore.requestCreativePlan({
    scope: "c12-fallback:plan",
    idempotencyKey: "request-plan",
    requestHash: fingerprintRequest({}),
    workspaceId: "ws_dev_default",
    creativeBriefRevisionId: briefId,
    event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });
  const storyboard = await planningStore.completeCreativePlan({
    workspaceId: "ws_dev_default",
    creativeBriefRevisionId: briefId,
    draft: {
      scriptRevisionId: createPrefixedId("scr"),
      storyboardRevisionId: createPrefixedId("sbr"),
      beats: [{ sequence: 1, title: "交付", summary: "团队完成交付", narrative_goal: "兑现承诺", visible_facts: ["雨夜"] }],
      title: "雨夜交付",
      summary: "团队完成交付。",
      totalDurationSeconds: 15,
      continuityLevel: "STANDARD",
      continuityNote: "单段计划。",
      shotSpecs: [{ id: createPrefixedId("ssp"), sequence: 1, title: "交付", durationSeconds: 15, narrativeGoal: "兑现承诺", startState: "雨夜", endState: "交付完成", transitionSummary: "淡入", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "单段计划" }],
    },
    event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });
  assert.ok(storyboard);
  if (!storyboard) return;
  await planningStore.approveStoryboardRevision({
    scope: "c12-fallback:approve",
    idempotencyKey: "approve",
    requestHash: fingerprintRequest({}),
    workspaceId: "ws_dev_default",
    storyboardRevisionId: storyboard.id,
    event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });
  await planningStore.createProductionRun({
    scope: "c12-fallback:production",
    idempotencyKey: "create-production",
    requestHash: fingerprintRequest({}),
    workspaceId: "ws_dev_default",
    projectId,
    productionRunId: createPrefixedId("prd"),
    storyboardRevisionId: storyboard.id,
    event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });

  const response = await app.request(`http://localhost/api/v1/projects/${projectId}/production-runs`);
  const body = await readJson(response);
  assert.equal(response.status, 200);
  assert.equal(body.data.length, 1);
  assert.deepEqual(body.data[0].segments, []);
  assert.doesNotThrow(() => ProductionRunProgressSchema.parse(body.data[0]));
});
