import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import { InMemoryNarrationQualityStore, type AssetWorkspaceStore, type DeliveryPreflightStore } from "@alchemy-video/persistence";

import { createApp } from "../src/app.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

test("C12.7B exposes normalized narration review while keeping sample approval separate from formal timeline persistence", async () => {
  const deliveryPlanRevisionId = createPrefixedId("dpr");
  const sampleAssetId = createPrefixedId("ast");
  const projectId = createPrefixedId("prj");
  const deliveryPlan = {
    id: deliveryPlanRevisionId,
    workspaceId: "ws_dev_default",
    projectId,
    creativeBriefRevisionId: createPrefixedId("cbr"),
    storyboardRevisionId: createPrefixedId("sbr"),
    revision: 1,
    status: "APPROVED" as const,
    durationPolicy: "FLEXIBLE" as const,
    flexibleDurationPercent: 20,
    targetDurationSeconds: 30,
    requiresSampleApproval: true,
    captionPolicy: "REQUIRED" as const,
    lipSyncRequirement: "OFF" as const,
    voiceMode: "PLATFORM_GENERIC" as const,
    safeSummary: "local",
    blockReasons: [],
    approvedAt: new Date().toISOString(),
    consumedByProductionRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const deliveryPreflightStore = {
    async listProjectDeliveryPlanRevisions() { return [deliveryPlan]; },
    async findDeliveryPlanRevision(workspaceId: string, id: string) {
      return workspaceId === deliveryPlan.workspaceId && id === deliveryPlan.id ? deliveryPlan : undefined;
    },
    async createDeliveryPlanRevision() { throw new Error("unused"); },
    async approveDeliveryPlanRevision() { throw new Error("unused"); },
    async consumeDeliveryPlanRevision() { throw new Error("unused"); },
    async listDeliveryPreflightEvents() { return []; },
  } as unknown as DeliveryPreflightStore;
  let generatedSampleScriptHash: string | undefined;
  const generatedAssetStore = {
    async findAsset(workspaceId, assetId) {
      if (workspaceId !== "ws_dev_default" || assetId !== sampleAssetId) return undefined;
      return {
        projectId,
        kind: "AUDIO",
        status: "READY",
        origin: "GENERATED",
        durationMs: 2_450,
        metadata: {
          narration_generation: {
            generation_kind: "SAMPLE",
            provider: "piper",
            voice_id: "platform-generic-zh",
            provider_settings: {},
            canonical_script_hash: generatedSampleScriptHash,
          },
        },
      };
    },
  } as unknown as AssetWorkspaceStore;
  const narrationStore = new InMemoryNarrationQualityStore(deliveryPreflightStore, generatedAssetStore);
  const app = createApp({ deliveryPreflightStore, assetStore: generatedAssetStore, narrationQualityStore: narrationStore });
  const scriptPath = `/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/narration-scripts`;
  const scriptCommand = {
    display_sections: [
      { id: "intro", text: "在10点41分完成第2条检查。"},
      { id: "close", text: "请联系AI团队。"},
    ],
    pronunciation_glossary: [{ source: "AI", spoken: "人工智能", reason: "本地术语表" }],
  };
  const post = (path: string, key: string, body: unknown) => app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

  const createdResponse = await post(scriptPath, "c127b-script", scriptCommand);
  const created = await readJson(createdResponse);
  assert.equal(createdResponse.status, 201);
  assert.equal(created.data.status, "NORMALIZED");
  assert.equal(created.data.display_sections[0].text, "在10点41分完成第2条检查。");
  assert.equal(created.data.spoken_sections[0].provider_text, "在十点四十一分完成第二条检查。");
  assert.equal(JSON.stringify(created).includes("provider"), true);
  assert.equal(JSON.stringify(created).includes("provider_request_id"), false);
  generatedSampleScriptHash = created.data.source_script_hash;

  const replay = await readJson(await post(scriptPath, "c127b-script", scriptCommand));
  assert.equal(replay.data.id, created.data.id);
  const conflict = await post(scriptPath, "c127b-script", { ...scriptCommand, display_sections: [{ id: "other", text: "不同稿件" }] });
  assert.equal(conflict.status, 409);

  const list = await readJson(await app.request(`http://localhost${scriptPath}`));
  assert.deepEqual(list.data.map((value: { id: string }) => value.id), [created.data.id]);

  const approvePath = `/api/v1/narration-script-revisions/${created.data.id}/approve`;
  const approveCommand = {
    sample_asset_id: sampleAssetId,
    sample_duration_ms: 2_450,
    canonical_script_hash: created.data.source_script_hash,
    word_timestamps_asset_id: null,
  };
  const approvedResponse = await post(approvePath, "c127b-approve", approveCommand);
  const approved = await readJson(approvedResponse);
  assert.equal(approvedResponse.status, 202);
  assert.equal(approved.data.status, "APPROVED");
  assert.equal(JSON.stringify(approved).includes("piper-local"), false);

  const timelinePath = `/api/v1/narration-script-revisions/${created.data.id}/timeline-plans`;
  const timelineResponse = await post(timelinePath, "c127b-timeline", {
    section_durations_ms: [
      { section_id: "intro", duration_ms: 1_250 },
      { section_id: "close", duration_ms: 1_200 },
    ],
    target_duration_ms: 30_000,
  });
  assert.equal(timelineResponse.status, 400);
  assert.equal((await readJson(timelineResponse)).error.code, "VALIDATION_FAILED");
});

test("C12.7B fails closed when the normalized narration still needs a glossary decision", async () => {
  const deliveryPlanRevisionId = createPrefixedId("dpr");
  const scriptId = createPrefixedId("nsr");
  const deliveryPreflightStore = {
    async findDeliveryPlanRevision() {
      return { projectId: createPrefixedId("prj"), targetDurationSeconds: 15 };
    },
  } as never;
  const app = createApp({
    deliveryPreflightStore,
    narrationQualityStore: new InMemoryNarrationQualityStore(deliveryPreflightStore),
  });
  const response = await app.request(`http://localhost/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/narration-scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c127b-ambiguous" },
    body: JSON.stringify({ display_sections: [{ id: scriptId, text: "请让AI完成交付。" }] }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 201);
  assert.equal(body.data.status, "NEEDS_DECISION");
  const approval = await app.request(`/api/v1/narration-script-revisions/${body.data.id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c127b-ambiguous-approve" },
    body: JSON.stringify({
      sample_asset_id: createPrefixedId("ast"),
      sample_duration_ms: 1_000,
      canonical_script_hash: body.data.source_script_hash,
    }),
  });
  assert.equal(approval.status, 400);
  assert.equal((await readJson(approval)).error.code, "DELIVERY_PLAN_STATE_INVALID");
});
