import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InternalTaskRunQueueMessageSchema } from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";

import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const command = {};

const createReadyShot = async (app: ReturnType<typeof createApp>, input: Readonly<{
  prompt?: string;
  generationSettings?: Record<string, unknown>;
  referenceBindings?: Array<{ asset_id: string; role: "STYLE" | "SUBJECT" | "FIRST_FRAME" | "LAST_FRAME"; position: number }>;
  keySuffix?: string;
}> = {}) => {
  const keySuffix = input.keySuffix ?? "default";
  const project = await readJson(await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `c06-project-${keySuffix}` },
    body: JSON.stringify({ name: `C06 route project ${keySuffix}` }),
  }));
  const projectId = project.data.id as string;
  const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `c06-shot-${keySuffix}` },
    body: JSON.stringify({
      position: 0,
      prompt: input.prompt ?? "C06 route shot",
      generation_settings: input.generationSettings,
      reference_bindings: input.referenceBindings ?? [],
    }),
  }));
  const shotId = shot.data.id as string;
  const ready = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `c06-shot-ready-${keySuffix}` },
    body: JSON.stringify({ status: "READY" }),
  });
  assert.equal(ready.status, 200);
  return { projectId, shotId };
};

const createReadyReference = async (input: Readonly<{
  app: ReturnType<typeof createApp>;
  assetStore: ReturnType<typeof createInMemoryAssetWorkspaceStore>;
  storage: InMemoryStoragePort;
  projectId: string;
  keySuffix: string;
  filename?: string;
}>) => {
  const bytes = new Uint8Array([1, 2, 3, input.keySuffix.length]);
  const upload = await readJson(await input.app.request(`http://localhost/api/v1/projects/${input.projectId}/assets/upload-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `c09-c-reference-upload-${input.keySuffix}` },
    body: JSON.stringify({ kind: "IMAGE", filename: input.filename ?? `reference-${input.keySuffix}.png`, mime_type: "image/png", byte_size: bytes.byteLength }),
  }));
  const assetId = upload.data.asset_id as string;
  const asset = await input.assetStore.findAsset("ws_dev_default", assetId);
  assert.ok(asset);
  input.storage.putObject({ objectKey: asset.objectKey, mimeType: "image/png", bytes });
  const confirmed = await input.app.request(`http://localhost/api/v1/assets/${assetId}/confirm-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `c09-c-reference-confirm-${input.keySuffix}` },
    body: JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), mime_type: "image/png", byte_size: bytes.byteLength }),
  });
  assert.equal(confirmed.status, 200);
  return assetId;
};

test("C09-C keeps UI reference analysis out of direct-generation object locks", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage });
  const { projectId, shotId } = await createReadyShot(app, {
    keySuffix: "ui-analysis-lock-filter",
    prompt: "ui-dashboard.png 是产品界面参考，只作为视觉锚点。",
  });
  const assetId = await createReadyReference({
    app,
    assetStore: assets,
    storage,
    projectId,
    keySuffix: "ui-analysis-lock-filter",
    filename: "ui-dashboard.png",
  });
  await assets.updateVisualReferenceAnalysis({
    workspaceId: "ws_dev_default",
    projectId,
    assetId,
    visualAnalysis: {
      role: "SUBJECT",
      confidence: 0.98,
      objects: [{ name: "界面模块", description: "屏幕中的模块", relation: "位于界面布局中", prohibited_changes: ["保持原样"] }],
    },
    visualAnalysisStatus: "READY",
  });
  const binding = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-ui-analysis-lock-binding" },
    body: JSON.stringify({ reference_bindings: [{ asset_id: assetId, role: "STYLE", position: 0 }] }),
  });
  assert.equal(binding.status, 200);
  const generation = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-ui-analysis-lock-generation" },
    body: JSON.stringify(command),
  });
  assert.equal(generation.status, 202);
  const created = await readJson(generation);
  const internal = await tasks.findTaskRun("ws_dev_default", created.data.id);
  assert.deepEqual(internal?.inputSnapshot.visual_input?.references.map((reference) => reference.asset_id), [assetId]);
  assert.equal(internal?.inputSnapshot.prompt.includes("界面模块"), false);
});

test("C06 generation routes are workspace-scoped, idempotent, and expose only public TaskRun fields", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks });
  const { projectId, shotId } = await createReadyShot(app);
  const request = (key: string, body = command) => app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

  const createdResponse = await request("c06-generation");
  const created = await readJson(createdResponse);
  assert.equal(createdResponse.status, 202);
  assert.equal(created.data.status, "QUEUED");
  assert.match(created.data.id, /^tsk_/);
  assert.equal((await request("c06-generation")).status, 202);
  assert.equal((await request("c06-active-generation")).status, 409);

  const detailResponse = await app.request(`http://localhost/api/v1/task-runs/${created.data.id}`);
  const detail = await readJson(detailResponse);
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(detail.data.attempts, []);
  assert.equal(detail.data.result_asset, null);
  for (const forbidden of ["input_snapshot", "provider_request_id", "request_payload", "response_payload", "object_key"]) {
    assert.equal(JSON.stringify(detail).includes(forbidden), false, `${forbidden} must not be public`);
  }

  const projectDetail = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}`));
  assert.equal(projectDetail.data.task_runs.length, 1);
  assert.equal(projectDetail.data.task_runs[0].id, created.data.id);
  for (const forbidden of ["input_snapshot", "provider", "model", "provider_request_id", "request_payload", "response_payload", "object_key"]) {
    assert.equal(Object.hasOwn(projectDetail.data.task_runs[0], forbidden), false, `${forbidden} must not be a public TaskRun field`);
  }
});

test("C09-C blocks deletion of a reference asset while its generation task is active", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage });
  const { projectId, shotId } = await createReadyShot(app, { keySuffix: "asset-delete-guard", prompt: "第一张是人物参考图，用于保持人物一致。" });
  const assetId = await createReadyReference({ app, assetStore: assets, storage, projectId, keySuffix: "asset-delete-guard" });
  const binding = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-asset-delete-binding" },
    body: JSON.stringify({ reference_bindings: [{ asset_id: assetId, role: "STYLE", position: 0 }] }),
  });
  assert.equal(binding.status, 200);
  const generation = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-asset-delete-generation" },
    body: JSON.stringify(command),
  });
  assert.equal(generation.status, 202);

  const deleteRequest = () => app.request(`http://localhost/api/v1/assets/${assetId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": "c09-c-asset-delete-command" },
  });
  const blocked = await deleteRequest();
  const blockedBody = await readJson(blocked);
  assert.equal(blocked.status, 409);
  assert.equal(blockedBody.error.code, "ASSET_IN_USE");
  const replayed = await deleteRequest();
  assert.equal(replayed.status, 409);
  assert.equal((await readJson(replayed)).error.code, "ASSET_IN_USE");

  await assets.setShotGenerationState({ workspaceId: "ws_dev_default", shotId, status: "FAILED" });
  const afterFailure = await app.request(`http://localhost/api/v1/assets/${assetId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": "c09-c-asset-delete-after-failure" },
  });
  assert.equal(afterFailure.status, 200);
  assert.equal((await readJson(afterFailure)).data.status, "DELETED");
});

test("C09-C creates real-provider I2V and R2V snapshots only from saved Shot bindings", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({
    store: control,
    assetStore: assets,
    taskStore: tasks,
    storage,
    videoProviderMode: "sub2api",
    referenceDeliveryTokenCodec: new ReferenceDeliveryTokenCodec("real-provider-reference-delivery-test-secret-32"),
  });
  const firstFrameShot = await createReadyShot(app, { prompt: "An opening-frame product film.", keySuffix: "first-frame" });
  const firstFrameId = await createReadyReference({ app, assetStore: assets, storage, projectId: firstFrameShot.projectId, keySuffix: "first-frame" });
  const firstBinding = await app.request(`http://localhost/api/v1/shots/${firstFrameShot.shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-first-frame-binding" },
    body: JSON.stringify({ reference_bindings: [{ asset_id: firstFrameId, role: "FIRST_FRAME", position: 0 }] }),
  });
  assert.equal(firstBinding.status, 200);
  const createdResponse = await app.request(`http://localhost/api/v1/shots/${firstFrameShot.shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-text-only" },
    body: JSON.stringify(command),
  });
  const created = await readJson(createdResponse);
  assert.equal(createdResponse.status, 202);
  assert.equal(JSON.stringify(created).includes("grok-imagine-video-1.5"), false);
  assert.equal(JSON.stringify(created).includes("input_snapshot"), false);
  const internal = await tasks.findTaskRun("ws_dev_default", created.data.id);
  assert.equal(internal?.inputSnapshot.visual_input?.mode, "FIRST_FRAME");
  assert.deepEqual(internal?.inputSnapshot.reference_asset_ids, [firstFrameId]);
  assert.equal(internal?.inputSnapshot.duration, 5);
  assert.equal(internal?.inputSnapshot.resolution, "720p");

  const referenceSetShot = await createReadyShot(app, { prompt: "第一张是人物图，第二张是场景图。保持两者一致。", keySuffix: "reference-set" });
  const referenceAssetIds = await Promise.all(["one", "two"].map((keySuffix) => createReadyReference({ app, assetStore: assets, storage, projectId: referenceSetShot.projectId, keySuffix })));
  const referenceBinding = await app.request(`http://localhost/api/v1/shots/${referenceSetShot.shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-reference-set-binding" },
    body: JSON.stringify({ reference_bindings: referenceAssetIds.map((asset_id, position) => ({ asset_id, role: "STYLE", position })) }),
  });
  assert.equal(referenceBinding.status, 200);
  const referenceSetResponse = await app.request(`http://localhost/api/v1/shots/${referenceSetShot.shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-reference-set" },
    body: JSON.stringify(command),
  });
  assert.equal(referenceSetResponse.status, 202);
  const referenceSet = await readJson(referenceSetResponse);
  const referenceSnapshot = await tasks.findTaskRun("ws_dev_default", referenceSet.data.id);
  assert.equal(referenceSnapshot?.inputSnapshot.visual_input?.mode, "REFERENCE_SET");
  assert.deepEqual(referenceSnapshot?.inputSnapshot.reference_asset_ids, referenceAssetIds);
  assert.deepEqual(referenceSnapshot?.inputSnapshot.visual_input?.references.map((reference) => reference.role), ["SUBJECT", "SCENE"]);
  assert.match(referenceSnapshot?.inputSnapshot.prompt ?? "", /do not substitute a generic environment/);
  assert.equal(JSON.stringify(referenceSet).includes("reference_images"), false);
});

test("C09-C freezes saved visible video settings without rewriting the creative description", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, videoProviderMode: "sub2api" });
  const { shotId } = await createReadyShot(app, {
    keySuffix: "compiled-prompt",
    prompt: "A product demonstration with clear actions, 15S, 480P.",
    generationSettings: { video_settings: { duration_seconds: 15, resolution: "480p", ratio: "16:9" } },
  });
  const response = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-compiled-generation" },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 202);
  const created = await readJson(response);
  const internal = await tasks.findTaskRun("ws_dev_default", created.data.id);
  assert.equal(internal?.inputSnapshot.duration, 15);
  assert.equal(internal?.inputSnapshot.resolution, "480p");
  assert.equal(internal?.inputSnapshot.ratio, "16:9");
  assert.equal(internal?.inputSnapshot.prompt, "A product demonstration with clear actions, 15S, 480P.");
  assert.equal(JSON.stringify(created).includes("A product demonstration"), false);
});

test("C09-C rejects malformed visible video settings before creating a real task", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, videoProviderMode: "sub2api" });
  const project = await readJson(await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-invalid-settings-project" },
    body: JSON.stringify({ name: "Invalid video settings" }),
  }));
  const projectId = project.data.id as string;
  const response = await app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-unsupported-duration" },
    body: JSON.stringify({
      position: 0,
      prompt: "A product video.",
      generation_settings: { video_settings: { duration_seconds: 16, resolution: "720p", ratio: "16:9" } },
      reference_bindings: [],
    }),
  });
  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.equal(payload.error.code, "VALIDATION_FAILED");
  assert.equal((await tasks.listProjectTaskRuns("ws_dev_default", projectId)).length, 0);
});

test("C09-C rejects real visual tasks before queuing when the API relay key is unavailable", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage, videoProviderMode: "sub2api" });
  const { projectId, shotId } = await createReadyShot(app, { keySuffix: "missing-relay-key" });
  const referenceId = await createReadyReference({ app, assetStore: assets, storage, projectId, keySuffix: "missing-relay-key" });
  const binding = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-missing-relay-binding" },
    body: JSON.stringify({ reference_bindings: [{ asset_id: referenceId, role: "FIRST_FRAME", position: 0 }] }),
  });
  assert.equal(binding.status, 200);
  const response = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-missing-relay-generation" },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.equal(payload.error.code, "VALIDATION_FAILED");
  assert.equal((await tasks.listProjectTaskRuns("ws_dev_default", projectId)).length, 0);
});

test("C09-C keeps ready reference images available to the local Mock task flow", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage, videoProviderMode: "mock" });
  const { projectId, shotId } = await createReadyShot(app, { prompt: "第一张是场景图，第二张是人物图。" });
  const referenceAssetIds = await Promise.all(["one", "two"].map((keySuffix) => createReadyReference({ app, assetStore: assets, storage, projectId, keySuffix })));
  const binding = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-mock-reference-bindings" },
    body: JSON.stringify({ reference_bindings: referenceAssetIds.map((asset_id, position) => ({ asset_id, role: position === 0 ? "STYLE" : "SUBJECT", position })) }),
  });
  assert.equal(binding.status, 200);

  const createdResponse = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-mock-references" },
    body: JSON.stringify(command),
  });
  assert.equal(createdResponse.status, 202);
  const created = await readJson(createdResponse);
  const internal = await tasks.findTaskRun("ws_dev_default", created.data.id);
  assert.deepEqual(internal?.inputSnapshot.reference_asset_ids, referenceAssetIds);
  assert.equal(internal?.inputSnapshot.visual_input?.mode, "REFERENCE_SET");
});

test("generation blocks unresolved reference images instead of guessing STYLE", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage, videoProviderMode: "mock" });
  const project = await readJson(await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-fallback-project" },
    body: JSON.stringify({ name: "Reference fallback" }),
  }));
  const projectId = project.data.id as string;
  const referenceAssetIds = await Promise.all(["one", "two"].map((keySuffix) => createReadyReference({ app, assetStore: assets, storage, projectId, keySuffix })));
  const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-fallback-shot" },
    body: JSON.stringify({
      position: 0,
      prompt: "Create a product video using the supplied reference images.",
      reference_bindings: referenceAssetIds.map((asset_id, position) => ({ asset_id, role: "STYLE", position })),
    }),
  }));
  const shotId = shot.data.id as string;
  await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-fallback-ready" },
    body: JSON.stringify({ status: "READY" }),
  });
  const response = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-fallback-generation" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.equal(payload.error.code, "VALIDATION_FAILED");
  assert.equal((await tasks.listProjectTaskRuns("ws_dev_default", projectId)).length, 0);
});

test("reference vision analysis is persisted at confirmation and user text remains authoritative", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const app = createApp({
    store: control,
    assetStore: assets,
    taskStore: tasks,
    storage,
    referenceVisionAnalyzer: {
      analyze: async () => ({ role: "SUBJECT" as const, confidence: 0.96, summary: "视觉识别为人物主体" }),
    },
  });
  const { projectId, shotId } = await createReadyShot(app, { prompt: "第一张是场景图，第二张是人物图。", keySuffix: "vision-analysis" });
  const referenceAssetIds = await Promise.all(["scene", "subject"].map((keySuffix) => createReadyReference({ app, assetStore: assets, storage, projectId, keySuffix })));
  const detail = await assets.findProjectDetail("ws_dev_default", projectId);
  assert.ok(detail?.assets.every((asset) => asset.metadata.visual_analysis_status === "READY"));
  const binding = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-vision-binding" },
    body: JSON.stringify({ reference_bindings: referenceAssetIds.map((asset_id, position) => ({ asset_id, role: "STYLE", position })) }),
  });
  assert.equal(binding.status, 200);
  const response = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c09-c-vision-generation" },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 202);
  const created = await readJson(response);
  const internal = await tasks.findTaskRun("ws_dev_default", created.data.id);
  assert.deepEqual(internal?.inputSnapshot.visual_input?.references.map((reference) => reference.role), ["SCENE", "SUBJECT"]);
});

test("C09-C provider-input only streams its encrypted token's scoped image without exposing storage paths", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const storage = new InMemoryStoragePort();
  const key = "reference-delivery-test-secret-with-at-least-32-characters";
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage, referenceDeliveryTokenCodec: new ReferenceDeliveryTokenCodec(key) });
  const { projectId } = await createReadyShot(app, { keySuffix: "provider-input" });
  const assetId = await createReadyReference({ app, assetStore: assets, storage, projectId, keySuffix: "provider-input" });
  const asset = await assets.findAsset("ws_dev_default", assetId);
  assert.ok(asset?.sha256 && asset.mimeType && asset.byteSize);
  const codec = new ReferenceDeliveryTokenCodec(key);
  const token = codec.issue({
    workspaceId: "ws_dev_default",
    projectId,
    assetId,
    sha256: asset!.sha256!,
    mimeType: asset!.mimeType!,
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.doesNotMatch(token, /ast_|ws_|prj_|original\.png/);
  const fullInspection = storage.inspectObject.bind(storage);
  let fullInspectionCalls = 0;
  storage.inspectObject = async (input) => {
    fullInspectionCalls += 1;
    return fullInspection(input);
  };
  const response = await app.request(`http://localhost/provider-input/${encodeURIComponent(token)}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, "provider-input".length]));
  const head = await app.request(`http://localhost/provider-input/${encodeURIComponent(token)}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(asset!.byteSize));
  assert.equal(fullInspectionCalls, 0, "provider-input HEAD must use metadata-only storage inspection");
  // A legacy/custom storage port without the metadata-only capability must
  // fail closed rather than fall back to a full object download and hash.
  (storage as unknown as { inspectObjectMetadata?: unknown }).inspectObjectMetadata = undefined;
  const unsupportedHead = await app.request(`http://localhost/provider-input/${encodeURIComponent(token)}`, { method: "HEAD" });
  assert.equal(unsupportedHead.status, 404);
  assert.equal(fullInspectionCalls, 0, "provider-input HEAD must not fall back to full inspection");
  const invalidTokenResponse = await app.request(`http://localhost/provider-input/${encodeURIComponent(`${token}x`)}`);
  assert.equal(invalidTokenResponse.status, 404);
  assert.equal(invalidTokenResponse.headers.get("content-length"), "0");
  const wrongProjectToken = codec.issue({ ...codec.verify(token)!, projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXY" as string, expiresAt: new Date(Date.now() + 60_000) });
  assert.equal((await app.request(`http://localhost/provider-input/${encodeURIComponent(wrongProjectToken)}`)).status, 404);
});

test("C06 retries only failed runs and queues the original immutable snapshot", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks });
  const { shotId } = await createReadyShot(app);
  const created = await readJson(await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry-create" },
    body: JSON.stringify(command),
  }));
  const queued = (await tasks.listWorkspaceEvents({ workspaceId: "ws_dev_default", limit: 10 })).find((event) => event.event_type === "task_run.queued");
  assert.ok(queued && queued.event_type === "task_run.queued");
  if (!queued || queued.event_type !== "task_run.queued") return;
  await tasks.processEvent({
    message: InternalTaskRunQueueMessageSchema.parse({ contract_version: "1.0", event_id: queued.event_id, workspace_id: queued.workspace_id, task_run_id: queued.data.task_run_id, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot }),
    consumerName: "c06-retry-transition",
    workerId: "c06-retry-worker",
    now: new Date(),
    leaseMs: 1_000,
  });
  await tasks.failTaskRun({ workspaceId: "ws_dev_default", taskRunId: created.data.id, code: "PROVIDER_REJECTED", message: "Controlled C06 failure.", retryable: false, now: new Date() });

  const retry = await app.request(`http://localhost/api/v1/task-runs/${created.data.id}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry" },
    body: "{}",
  });
  const retried = await readJson(retry);
  assert.equal(retry.status, 202);
  assert.equal(retried.data.status, "QUEUED");
  assert.equal(retried.data.id, created.data.id);
  assert.equal((await app.request(`http://localhost/api/v1/task-runs/${created.data.id}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry" },
    body: "{}",
  })).status, 202);
  assert.equal((await app.request(`http://localhost/api/v1/task-runs/${createPrefixedId("tsk")}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry-missing" },
    body: "{}",
  })).status, 404);
});
