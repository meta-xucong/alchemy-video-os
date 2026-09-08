import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import type { CreativePlanningStore, DeliveryPreflightStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";

import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const post = (app: ReturnType<typeof createApp>, path: string, idempotencyKey: string, body: Record<string, unknown>) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });

const createScenario = async (mode: "AUTO" | "MANUAL" | "OFF", input: { withPixabay: boolean; seedMusic: boolean }) => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const storage = new InMemoryStoragePort();
  let projectId = "";
  const storyboardRevisionId = createPrefixedId("sbr");
  const deliveryPlanRevisionId = createPrefixedId("dpr");
  const creativeBriefRevisionId = createPrefixedId("cbr");
  const runs = new Map<string, Record<string, unknown>>();
  const planningStore = {
    async findCreativeBriefRevision() {
      return {
        id: creativeBriefRevisionId,
        workspaceId: "ws_dev_default",
        projectId,
        revision: 1,
        sourceText: "企业宣传片画面描述，不含旁白。",
        targetDurationSeconds: 30,
        targetResolution: "480p" as const,
        stylePreferences: "calm corporate",
        sourceAssetIds: [],
        documentContexts: [],
        status: "APPROVED" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async findStoryboardRevision() {
      return {
        id: storyboardRevisionId,
        workspaceId: "ws_dev_default",
        projectId,
        scriptRevisionId: createPrefixedId("scr"),
        revision: 1,
        title: "fixture storyboard",
        summary: "fixture",
        totalDurationSeconds: 30,
        continuityLevel: "STANDARD" as const,
        continuityNote: "fixture",
        status: "APPROVED" as const,
        shotSpecs: [],
        generationSegmentCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async createProductionRun(input: { idempotencyKey: string; productionRunId: string; workspaceId: string; projectId: string; storyboardRevisionId: string; deliveryPlanRevisionId?: string }) {
      const replay = runs.get(input.idempotencyKey);
      if (replay) return { kind: "REPLAY" as const, status: 202 as const, value: replay };
      const timestamp = new Date().toISOString();
      const value = {
        id: input.productionRunId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        storyboardRevisionId: input.storyboardRevisionId,
        ...(input.deliveryPlanRevisionId ? { deliveryPlanRevisionId: input.deliveryPlanRevisionId } : {}),
        status: "CONFIRMED" as const,
        totalShotCount: 1,
        acceptedShotCount: 0,
        totalSegmentCount: 1,
        acceptedSegmentCount: 0,
        totalDurationSeconds: 30,
        continuityStatus: "NOT_CHECKED" as const,
        plannedSegmentCount: 1,
        maxAutoRepairCount: 2,
        autoRepairCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      runs.set(input.idempotencyKey, value);
      return { kind: "NEW" as const, status: 202 as const, value };
    },
  } as unknown as CreativePlanningStore;
  const deliveryPreflightStore = {
    async findDeliveryPlanRevision(workspaceId: string, id: string) {
      return workspaceId === "ws_dev_default" && id === deliveryPlanRevisionId
        ? {
          id,
          workspaceId,
          projectId,
          creativeBriefRevisionId,
          storyboardRevisionId,
          revision: 1,
          status: "APPROVED" as const,
          durationPolicy: "FLEXIBLE" as const,
          flexibleDurationPercent: 20,
          targetDurationSeconds: 30,
          requiresSampleApproval: true,
          captionPolicy: "OFF" as const,
          lipSyncRequirement: "OFF" as const,
          voiceMode: "PLATFORM_GENERIC" as const,
          safeSummary: "fixture",
          blockReasons: [],
          approvedAt: new Date().toISOString(),
          consumedByProductionRunId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        : undefined;
    },
  } as unknown as DeliveryPreflightStore;
  let calls = 0;
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x01, 0x02]);
  const app = createApp({
    store,
    assetStore,
    taskStore,
    storage,
    planningStore,
    deliveryPreflightStore,
    ...(input.withPixabay ? {
      pixabayMusic: {
        async execute(command: { query: string; min_duration?: number; max_duration?: number }) {
          calls += 1;
          assert.equal(command.query, "calm corporate");
          assert.equal(command.min_duration, 30);
          assert.equal(command.max_duration, 300);
          return {
            bytes,
            mimeType: "audio/mpeg" as const,
            filename: "pixabay_music_fixture.mp3",
            query: command.query,
            track: { title: "Fixture Music", artist: "Fixture Artist", audio_url: "", duration: 42, rating: 4.75, download_count: 321, pixabay_id: 7 },
            results_found: 1,
            results_after_filter: 1,
          };
        },
      },
    } : {}),
  });
  const project = await readJson(await post(app, "/api/v1/projects", `pixabay-auto-project-${mode}`, { name: "Fallback project" }));
  projectId = project.data.id as string;

  if (input.seedMusic) {
    const assetId = createPrefixedId("ast");
    const created = await assetStore.createUploadAsset({
      scope: `seed-${mode}`,
      idempotencyKey: `seed-${mode}`,
      requestHash: createHash("sha256").update(`seed-${mode}`).digest("hex"),
      workspaceId: "ws_dev_default",
      projectId,
      assetId,
      kind: "AUDIO",
      objectKey: `ws_dev_default/${projectId}/${assetId}/music.mp3`,
      filename: "background-music.mp3",
      mimeType: "audio/mpeg",
      byteSize: bytes.byteLength,
      audioRole: "MUSIC",
      metadata: { source_title: "Fixture background music" },
    });
    assert.equal(created.kind, "NEW");
    if (created.kind === "NEW") {
      await assetStore.confirmAssetUpload({
        scope: `seed-confirm-${mode}`,
        idempotencyKey: `seed-confirm-${mode}`,
        requestHash: createHash("sha256").update(`seed-confirm-${mode}`).digest("hex"),
        workspaceId: "ws_dev_default",
        assetId,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: "audio/mpeg",
        byteSize: bytes.byteLength,
        durationMs: 42_000,
        verifyUpload: async () => true,
      });
    }
  }

  const command = {
    storyboard_revision_id: storyboardRevisionId,
    delivery_plan_revision_id: deliveryPlanRevisionId,
    music_plan: mode === "MANUAL"
      ? { mode, asset_id: "ast_missing" }
      : { mode },
  };
  const path = `/api/v1/projects/${projectId}/production-runs`;
  const first = await post(app, path, `pixabay-auto-run-${mode}`, command);
  const firstBody = await readJson(first);
  return { app, assetStore, projectId, path, command, first, firstBody, calls };
};

test("AUTO imports one Pixabay MUSIC asset only when the shared candidate selector is empty and replays without another call", async () => {
  const scenario = await createScenario("AUTO", { withPixabay: true, seedMusic: false });
  assert.equal(scenario.first.status, 202);
  assert.equal(scenario.calls, 1);
  const assets = await scenario.assetStore.listWorkspaceMusicAssets("ws_dev_default");
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.metadata.audio_role, "MUSIC");
  assert.equal(assets[0]?.metadata.audio_provider, "pixabay_music");
  assert.equal(assets[0]?.metadata.pixabay_rating, 4.75);
  assert.equal(assets[0]?.metadata.pixabay_download_count, 321);
  const replay = await post(scenario.app, scenario.path, "pixabay-auto-run-AUTO", scenario.command);
  assert.equal(replay.status, 202);
  assert.equal((await readJson(replay)).data.id, scenario.firstBody.data.id);
  assert.equal((await scenario.assetStore.listWorkspaceMusicAssets("ws_dev_default")).length, 1);
  assert.equal(scenario.calls, 1);
});

test("AUTO uses an existing usable MUSIC asset without invoking Pixabay", async () => {
  const scenario = await createScenario("AUTO", { withPixabay: true, seedMusic: true });
  assert.equal(scenario.first.status, 202);
  assert.equal(scenario.calls, 0);
  assert.equal((await scenario.assetStore.listWorkspaceMusicAssets("ws_dev_default")).length, 1);
});

test("MANUAL and OFF never invoke the automatic Pixabay fallback", async () => {
  const manual = await createScenario("MANUAL", { withPixabay: true, seedMusic: false });
  assert.equal(manual.first.status, 202);
  assert.equal(manual.calls, 0);
  const off = await createScenario("OFF", { withPixabay: true, seedMusic: false });
  assert.equal(off.first.status, 202);
  assert.equal(off.calls, 0);
});

test("AUTO remains blocked when no candidate exists and Pixabay is unavailable", async () => {
  const scenario = await createScenario("AUTO", { withPixabay: false, seedMusic: false });
  assert.equal(scenario.first.status, 503);
  assert.equal(scenario.firstBody.error.code, "PROVIDER_UNAVAILABLE");
});
