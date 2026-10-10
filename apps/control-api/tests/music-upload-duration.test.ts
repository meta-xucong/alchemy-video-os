import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InternalEventEnvelopeSchema, type InternalEventEnvelope } from "@alchemy-video/contracts";
import { DrizzleProductionRepository, isUsableMusicAsset, type ControlAsset } from "@alchemy-video/persistence";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";
import { createApp } from "../src/app.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

// These bytes test upload metadata transport, not server media inspection.
const bytes = new Uint8Array([82, 73, 70, 70]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const confirmation = { sha256, mime_type: "audio/wav", byte_size: bytes.byteLength };

// Reuse the existing persistence tests' read-only Drizzle-shaped fixture.
// Only the row transport is synthetic; the composition loader and its exact
// missing-duration failure run unchanged against the API-confirmed MUSIC row.
const compositionForMusic = (music: ControlAsset) => {
  const scope = { workspaceId: music.workspaceId, projectId: music.projectId };
  const sources = [1, 2].map((sequence) => ({
    ...music, ...scope, id: `ast_mock_${sequence}`, kind: "VIDEO", mimeType: "video/mp4", durationMs: 1_000,
    objectKey: `${music.workspaceId}/${music.projectId}/ast_mock_${sequence}/generated.mp4`, metadata: {},
  }));
  const rows: Record<string, unknown[]> = {
    production_runs: [{ ...scope, id: "prd_music_fixture", storyboardRevisionId: "sbr_music_fixture", deliveryPlanRevisionId: "dpr_music_fixture", status: "REVIEWING", acceptedShotCount: 2, totalShotCount: 2, budgetGuard: { music_plan: { mode: "MANUAL", asset_id: music.id } } }],
    storyboard_revisions: [{ scriptRevisionId: "scr_music_fixture" }],
    script_revisions: [{ creativeBriefRevisionId: "cbr_music_fixture" }],
    creative_brief_revisions: [{ sourceText: "A visual-only Mock story." }],
    production_segments: [1, 2].map((sequence) => ({ sequence, taskRunId: `tsk_mock_${sequence}`, shotSpecId: `sss_mock_${sequence}` })),
    storyboard_shot_specs: [{ referencePolicy: "TEXT_TRANSITION" }],
    prompt_packages: [{ capabilitySnapshot: {}, referenceMap: {}, visualConstraints: {} }],
    delivery_plan_revisions: [{ captionPolicy: "OFF" }],
  };
  const sequences: Record<string, unknown[][]> = {
    assets: [[sources[0]], [sources[1]], [music]],
    task_runs: [1, 2].map((sequence) => [{ id: `tsk_mock_${sequence}`, status: "SUCCEEDED", resultAssetId: `ast_mock_${sequence}`, inputSnapshot: { model: "mock-video-v1" } }]),
  };
  const calls = new Map<string, number>();
  const next = (table: string) => {
    if (!sequences[table]) return rows[table] ?? [];
    const index = calls.get(table) ?? 0;
    calls.set(table, index + 1);
    return sequences[table][index] ?? [];
  };
  const db = { select() { return { from(table: Record<symbol, unknown>) {
    const name = table[Symbol.for("drizzle:Name")] as string;
    const query = {
      where() { return query; }, orderBy() { return query; },
      limit: async () => next(name).slice(0, 1),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(next(name)).then(resolve, reject),
    };
    return query;
  } }; } };
  const repository = new DrizzleProductionRepository(db as unknown as ConstructorParameters<typeof DrizzleProductionRepository>[0]);
  const event = InternalEventEnvelopeSchema.parse({
    contract_version: "1.0", message_id: "msg_music_fixture", event_id: "evt_music_fixture", event_type: "video_version.composition_requested",
    occurred_at: new Date().toISOString(), trace_id: "trc_music_fixture", correlation_id: "cor_music_fixture", idempotency_key: "music-fixture-composition", producer: "test",
    workspace_id: music.workspaceId, project_id: music.projectId, aggregate: { type: "production_run", id: "prd_music_fixture" },
    data: { production_run_id: "prd_music_fixture" }, version: 1,
  }) as Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>;
  return repository.findProductionCompositionInput({ event });
};

const setup = async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store, assetStore, storage });
  const post = (path: string, key: string, body: unknown) => app.request(`http://localhost/api/v1${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
  });
  const project = await (await post("/projects", "music-duration-project", { name: "Music metadata transport" })).json() as { data: { id: string } };
  const upload = await (await post(`/projects/${project.data.id}/assets/upload-requests`, "music-duration-upload", {
    kind: "AUDIO", purpose: "MUSIC", filename: "c12-music.wav", mime_type: "audio/wav", byte_size: bytes.byteLength,
  })).json() as { data: { asset_id: string } };
  const asset = await assetStore.findAsset("ws_dev_default", upload.data.asset_id);
  assert.ok(asset);
  await storage.putObject({ objectKey: asset.objectKey, mimeType: "audio/wav", bytes });
  return { post, assetStore, asset, path: `/assets/${asset.id}/confirm-upload` };
};

test("MUSIC confirmation persists reported duration and the current composition eligibility gate consumes it", async () => {
  const value = await setup();
  const response = await value.post(value.path, "music-duration-confirm", { ...confirmation, duration_ms: 30_000 });
  assert.equal(response.status, 200);
  const publicAsset = (await response.json() as { data: { duration_ms: number; status: string } }).data;
  assert.equal(publicAsset.duration_ms, 30_000);
  assert.equal(publicAsset.status, "READY");
  const persisted = await value.assetStore.findAsset("ws_dev_default", value.asset.id);
  assert.ok(persisted);
  assert.equal(persisted.durationMs, 30_000);
  assert.equal(isUsableMusicAsset(persisted, { minimumDurationMs: 2_000 }), true);
  assert.equal(isUsableMusicAsset(persisted, { minimumDurationMs: 30_001 }), false);
  const composition = await compositionForMusic(persisted);
  assert.equal(composition?.musicAsset?.id, persisted.id);
  assert.equal(composition?.musicAsset?.durationMs, 30_000);
  assert.equal(composition?.compositionPlan?.target_duration_ms, 2_000);
  assert.deepEqual(composition?.compositionPlan?.transitions, ["PASS"]);
});

test("legacy missing-duration MUSIC is still ineligible and cannot be silently repaired by reconfirmation", async () => {
  const value = await setup();
  assert.equal((await value.post(value.path, "music-duration-missing", confirmation)).status, 200);
  let persisted = await value.assetStore.findAsset("ws_dev_default", value.asset.id);
  assert.ok(persisted);
  assert.equal(persisted.durationMs, null);
  assert.equal(isUsableMusicAsset(persisted, { minimumDurationMs: 2_000 }), false);
  await assert.rejects(compositionForMusic(persisted), /QC_FAILED: the explicitly selected music asset is not available or failed scope validation/);
  await value.post(value.path, "music-duration-reconfirm", { ...confirmation, duration_ms: 30_000 });
  persisted = await value.assetStore.findAsset("ws_dev_default", value.asset.id);
  assert.equal(persisted?.durationMs, null);
});

test("invalid reported duration remains rejected at the existing public contract boundary", async () => {
  const value = await setup();
  for (const duration of [-1, 1.5, "30000"]) {
    assert.equal((await value.post(value.path, `music-duration-invalid-${duration}`, { ...confirmation, duration_ms: duration })).status, 400);
  }
  assert.equal((await value.assetStore.findAsset("ws_dev_default", value.asset.id))?.status, "PENDING_UPLOAD");
});
