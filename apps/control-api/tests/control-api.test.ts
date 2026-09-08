import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InternalTaskRunQueueMessageSchema } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";
import { InMemoryStoragePort, StorageUnavailableError, type StoragePort } from "@alchemy-video/storage-client";

import { createApp } from "../src/app.js";
import type { IdentityPort } from "../src/identity.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const createProject = (app: ReturnType<typeof createApp>, name: string, idempotencyKey: string) =>
  app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ name }),
  });

test("DevIdentityAdapter exposes only the fixed local identity and accessible workspace", async () => {
  const app = createApp();

  const [meResponse, workspacesResponse] = await Promise.all([
    app.request("http://localhost/api/v1/me"),
    app.request("http://localhost/api/v1/workspaces"),
  ]);
  const me = await readJson(meResponse);
  const workspaces = await readJson(workspacesResponse);

  assert.equal(meResponse.status, 200);
  assert.equal(me.data.user.id, "usr_dev_owner");
  assert.equal(me.data.workspaces[0].id, "ws_dev_default");
  assert.equal(workspacesResponse.status, 200);
  assert.deepEqual(workspaces.data.map((workspace: { id: string }) => workspace.id), ["ws_dev_default"]);
  assert.match(me.request_id, /^req_[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("free audio capability surface blocks paid providers without changing video settings", async () => {
  const app = createApp({ audioFreeOnly: true });
  const projectResponse = await createProject(app, "Audio capabilities", "audio-capabilities-project");
  const project = await readJson(projectResponse);
  const response = await app.request(`http://localhost/api/v1/projects/${project.data.id}/audio-capabilities`);
  const payload = await readJson(response);
  assert.equal(response.status, 200);
  assert.equal(payload.data.free_only, true);
  assert.deepEqual(payload.data.music_assets, []);
  assert.equal(payload.data.capabilities.find((item: { id: string }) => item.id === "pixabay_music")?.status, "BLOCKED");
  assert.equal(payload.data.capabilities.find((item: { id: string }) => item.id === "paid_music_and_tts")?.status, "BLOCKED");
  const ffmpegCapability = payload.data.capabilities.find((item: { id: string }) => item.id === "ffmpeg_audio_mixer");
  if (!process.env.MEDIA_RUNTIME_FFMPEG_PATH || !process.env.MEDIA_RUNTIME_FFPROBE_PATH) {
    assert.equal(ffmpegCapability?.status, "NOT_CONFIGURED");
  }
  const piperCapability = payload.data.capabilities.find((item: { id: string }) => item.id === "piper_tts");
  if (!process.env.PIPER_MODEL_PATH || !process.env.PIPER_MODEL_CONFIG_PATH || !process.env.PIPER_PYTHON_PATH) {
    assert.equal(piperCapability?.status, "NOT_CONFIGURED");
  }
  assert.equal(payload.data.capabilities.find((item: { id: string }) => item.id === "faster_whisper")?.status, "NOT_CONFIGURED");
  assert.equal(payload.data.capabilities.find((item: { id: string }) => item.id === "clip_visual_review")?.status, "NOT_CONFIGURED");
});

test("provider native audio capability follows the selected video profile while Mock remains blocked", async () => {
  const mockApp = createApp({ videoProviderMode: "mock" });
  const mockProject = await readJson(await createProject(mockApp, "Mock native audio capability", "native-audio-capability-mock"));
  const mockResponse = await mockApp.request(`http://localhost/api/v1/projects/${mockProject.data.id}/audio-capabilities`);
  const mockPayload = await readJson(mockResponse);
  const mockCapability = mockPayload.data.capabilities.find((item: { id: string }) => item.id === "provider_native_audio");
  assert.equal(mockResponse.status, 200);
  assert.equal(mockCapability?.status, "BLOCKED");

  const nativeApp = createApp({ videoProviderMode: "sub2api" });
  const nativeProject = await readJson(await createProject(nativeApp, "Native audio capability", "native-audio-capability-sub2api"));
  const nativeResponse = await nativeApp.request(`http://localhost/api/v1/projects/${nativeProject.data.id}/audio-capabilities`);
  const nativePayload = await readJson(nativeResponse);
  const nativeCapability = nativePayload.data.capabilities.find((item: { id: string }) => item.id === "provider_native_audio");
  assert.equal(nativeResponse.status, 200);
  assert.equal(nativeCapability?.status, "AVAILABLE");
  assert.equal(nativeCapability?.key_required, false);
});

test("reference vision capability is AVAILABLE only when an analyzer is injected", async () => {
  const app = createApp({
    referenceVisionAnalyzer: {
      async analyze() {
        return { role: "SCENE", confidence: 1 };
      },
    },
  });
  const projectResponse = await createProject(app, "Vision capabilities", "vision-capabilities-project");
  const project = await readJson(projectResponse);
  const response = await app.request(`http://localhost/api/v1/projects/${project.data.id}/audio-capabilities`);
  const payload = await readJson(response);
  assert.equal(payload.data.capabilities.find((item: { id: string }) => item.id === "clip_visual_review")?.status, "AVAILABLE");
});

test("audio capabilities expose the shared workspace MUSIC library to every project", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const app = createApp({ store, assetStore });
  const sourceProject = await readJson(await createProject(app, "Shared music source", "shared-music-source-project"));
  const targetProject = await readJson(await createProject(app, "Shared music target", "shared-music-target-project"));
  const workspaceId = "ws_dev_default";
  const sourceProjectId = sourceProject.data.id as string;
  const targetProjectId = targetProject.data.id as string;
  const musicAssetId = createPrefixedId("ast");
  const musicBytes = new Uint8Array([0x49, 0x44, 0x33, 0x01]);
  const musicHash = createHash("sha256").update(musicBytes).digest("hex");
  const created = await assetStore.createUploadAsset({
    scope: "shared-music-upload",
    idempotencyKey: "shared-music-upload",
    requestHash: fingerprintRequest({ musicAssetId }),
    workspaceId,
    projectId: sourceProjectId,
    assetId: musicAssetId,
    kind: "AUDIO",
    objectKey: `${workspaceId}/${sourceProjectId}/${musicAssetId}/music.mp3`,
    filename: "shared-background.mp3",
    mimeType: "audio/mpeg",
    byteSize: musicBytes.byteLength,
    audioRole: "MUSIC",
    metadata: { source_title: "Shared background" },
  });
  assert.equal(created.kind, "NEW");
  const confirmed = await assetStore.confirmAssetUpload({
    scope: "shared-music-confirm",
    idempotencyKey: "shared-music-confirm",
    requestHash: fingerprintRequest({ musicHash }),
    workspaceId,
    assetId: musicAssetId,
    sha256: musicHash,
    mimeType: "audio/mpeg",
    byteSize: musicBytes.byteLength,
    durationMs: 42_000,
    verifyUpload: async () => true,
  });
  assert.equal(confirmed.kind, "NEW");

  const response = await app.request(`http://localhost/api/v1/projects/${targetProjectId}/audio-capabilities`);
  const payload = await readJson(response);
  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.music_assets.map((asset: { id: string; project_id: string; metadata: Record<string, unknown> }) => ({
    id: asset.id,
    project_id: asset.project_id,
    role: asset.metadata.audio_role,
  })), [{ id: musicAssetId, project_id: sourceProjectId, role: "MUSIC" }]);
});

test("project commands are idempotent and project reads stay in the current workspace", async () => {
  const app = createApp();
  const firstResponse = await createProject(app, "Launch film", "project-create-1");
  const first = await readJson(firstResponse);
  const replayResponse = await createProject(app, "Launch film", "project-create-1");
  const replay = await readJson(replayResponse);

  assert.equal(firstResponse.status, 201);
  assert.equal(replayResponse.status, 201);
  assert.equal(first.data.id, replay.data.id);
  assert.match(first.data.id, /^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(first.data.workspace_id, "ws_dev_default");

  const listResponse = await app.request("http://localhost/api/v1/projects");
  const list = await readJson(listResponse);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(list.data.map((project: { id: string }) => project.id), [first.data.id]);

  const detailResponse = await app.request(`http://localhost/api/v1/projects/${first.data.id}`);
  const detail = await readJson(detailResponse);
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.project.id, first.data.id);
  assert.deepEqual(detail.data.shots, []);
  assert.deepEqual(detail.data.assets, []);

  const updateResponse = await app.request(`http://localhost/api/v1/projects/${first.data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "project-update-1" },
    body: JSON.stringify({ name: "Launch film revised", status: "ARCHIVED" }),
  });
  const update = await readJson(updateResponse);
  assert.equal(updateResponse.status, 200);
  assert.equal(update.data.name, "Launch film revised");
  assert.equal(update.data.status, "ARCHIVED");

  const updateReplayResponse = await app.request(`http://localhost/api/v1/projects/${first.data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "project-update-1" },
    body: JSON.stringify({ status: "ARCHIVED", name: "Launch film revised" }),
  });
  const updateReplay = await readJson(updateReplayResponse);
  assert.equal(updateReplayResponse.status, 200);
  assert.deepEqual(updateReplay.data, update.data);
});

test("project deletion is a confirmed, replayable soft delete", async () => {
  const store = createInMemoryControlPlaneStore();
  const app = createApp({ store });
  const created = await readJson(await createProject(app, "Delete me", "delete-create-1"));
  const projectId = created.data.id as string;
  const request = () => app.request(`http://localhost/api/v1/projects/${projectId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": "delete-project-1" },
  });

  const deletedResponse = await request();
  const deleted = await readJson(deletedResponse);
  assert.equal(deletedResponse.status, 200);
  assert.equal(deleted.data.id, projectId);
  assert.equal(deleted.data.status, "DELETED");

  const replayResponse = await request();
  assert.equal(replayResponse.status, 200);
  assert.deepEqual((await readJson(replayResponse)).data, deleted.data);
  assert.equal((await readJson(await app.request("http://localhost/api/v1/projects"))).data.some((project: { id: string }) => project.id === projectId), false);
  assert.equal((await app.request(`http://localhost/api/v1/projects/${projectId}`)).status, 404);

  const secondDelete = await app.request(`http://localhost/api/v1/projects/${projectId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": "delete-project-2" },
  });
  assert.equal(secondDelete.status, 404);

  const blockedStore = createInMemoryControlPlaneStore();
  await blockedStore.createProject({
    scope: "delete-active-create",
    idempotencyKey: "delete-active-create",
    requestHash: fingerprintRequest({ name: "Active" }),
    workspaceId: "ws_dev_default",
    projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    name: "Active",
  });
  const blocked = await blockedStore.deleteProject({
    scope: "usr_dev_owner:DELETE:/api/v1/projects/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    idempotencyKey: "delete-active-1",
    requestHash: fingerprintRequest({}),
    workspaceId: "ws_dev_default",
    projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    activeWork: true,
  });
  assert.deepEqual(blocked, { kind: "IN_USE", status: 409 });

  const activeStore = createInMemoryControlPlaneStore();
  const activeAssets = createInMemoryAssetWorkspaceStore(activeStore);
  const activeTasks = createInMemoryTaskRunStore(activeAssets);
  const activeApp = createApp({ store: activeStore, assetStore: activeAssets, taskStore: activeTasks });
  const activeProject = await readJson(await createProject(activeApp, "Active work", "delete-active-project"));
  const activeProjectId = activeProject.data.id as string;
  const activeShotId = createPrefixedId("sht");
  await activeAssets.createShot({
    scope: "delete-active-shot",
    idempotencyKey: "delete-active-shot",
    requestHash: fingerprintRequest({ position: 0, prompt: "Active" }),
    workspaceId: "ws_dev_default",
    projectId: activeProjectId,
    shotId: activeShotId,
    position: 0,
    prompt: "Active",
    model: null,
    generationSettings: {},
    referenceBindings: [],
  });
  await activeAssets.updateShot({
    scope: "delete-active-shot-ready",
    idempotencyKey: "delete-active-shot-ready",
    requestHash: fingerprintRequest({ status: "READY" }),
    workspaceId: "ws_dev_default",
    shotId: activeShotId,
    status: "READY",
  });
  const activeTaskInput = { model: "mock-video-v1", prompt: "Active", duration: 5, resolution: "720p", ratio: "16:9", reference_asset_ids: [] };
  await activeTasks.createTaskRun({
    scope: "delete-active-task",
    idempotencyKey: "delete-active-task",
    requestHash: fingerprintRequest(activeTaskInput),
    workspaceId: "ws_dev_default",
    taskRunId: createPrefixedId("tsk"),
    shotId: activeShotId,
    kind: "VIDEO_GENERATION",
    inputSnapshot: activeTaskInput,
    event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") },
  });
  const activeDelete = await activeApp.request(`http://localhost/api/v1/projects/${activeProjectId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": "delete-active-api" },
  });
  assert.equal(activeDelete.status, 409);
  assert.equal((await readJson(activeDelete)).error.code, "PROJECT_IN_USE");
});

test("the API rejects an idempotency key reused with a different command", async () => {
  const app = createApp();
  await createProject(app, "First command", "project-conflict-1");
  const response = await createProject(app, "Different command", "project-conflict-1");
  const body = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepEqual(body.error, {
    code: "IDEMPOTENCY_CONFLICT",
    message: "The idempotency key was already used for a different command.",
    retryable: false,
    details: {},
  });
});

test("a missing project update is a replayable 404 command result", async () => {
  const store = createInMemoryControlPlaneStore();
  const app = createApp({ store });
  const projectId = "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const command = { name: "Reserved missing project" };
  const request = () =>
    app.request(`http://localhost/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "missing-update-1" },
      body: JSON.stringify(command),
    });

  const first = await request();
  assert.equal(first.status, 404);

  await store.createProject({
    scope: "seed-project",
    idempotencyKey: "seed-1",
    requestHash: fingerprintRequest({ name: "Seeded project" }),
    workspaceId: "ws_dev_default",
    projectId,
    name: "Seeded project",
  });

  const replay = await request();
  assert.equal(replay.status, 404);
  const unchanged = await app.request(`http://localhost/api/v1/projects/${projectId}`);
  assert.equal((await readJson(unchanged)).data.project.name, "Seeded project");

  const conflict = await app.request(`http://localhost/api/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "missing-update-1" },
    body: JSON.stringify({ name: "Different command" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await readJson(conflict)).error.code, "IDEMPOTENCY_CONFLICT");
});

test("workspace authorization and command validation use public error envelopes", async () => {
  const forbiddenIdentity: IdentityPort = {
    async resolve() {
      return { userId: "usr_dev_owner", workspaceId: "ws_not_a_member" };
    },
  };
  const forbiddenApp = createApp({ identity: forbiddenIdentity, store: createInMemoryControlPlaneStore() });
  const forbiddenResponse = await createProject(forbiddenApp, "Blocked project", "project-forbidden-1");
  const forbidden = await readJson(forbiddenResponse);

  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbidden.error.code, "WORKSPACE_FORBIDDEN");
  assert.deepEqual(forbidden.error.details, {});

  const app = createApp();
  const missingKeyResponse = await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Missing key" }),
  });
  const missingKey = await readJson(missingKeyResponse);
  assert.equal(missingKeyResponse.status, 400);
  assert.equal(missingKey.error.code, "VALIDATION_FAILED");

  const shotsRoute = await app.request("http://localhost/api/v1/projects/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/shots", {
    method: "POST",
  });
  assert.equal(shotsRoute.status, 400);
  assert.equal((await readJson(shotsRoute)).error.code, "VALIDATION_FAILED");
});

test("C04 upload, shot, invalid-reference, and missing-project commands have replayable public behavior", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store, assetStore, storage });
  const createdProject = await createProject(app, "Reference board", "c04-project-1");
  const project = await readJson(createdProject);
  const projectId = project.data.id as string;

  const uploadCommand = { kind: "IMAGE", filename: "brand.png", mime_type: "image/png", byte_size: 3, object_key: "browser-must-not-control-this" };
  const uploadRequest = () =>
    app.request(`http://localhost/api/v1/projects/${projectId}/assets/upload-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-upload-1" },
      body: JSON.stringify(uploadCommand),
    });
  const firstUpload = await uploadRequest();
  const firstUploadBody = await readJson(firstUpload);
  const replayUpload = await uploadRequest();
  const replayUploadBody = await readJson(replayUpload);
  assert.equal(firstUpload.status, 201);
  assert.equal(replayUpload.status, 201);
  assert.equal(firstUploadBody.data.asset_id, replayUploadBody.data.asset_id);
  assert.equal("object_key" in firstUploadBody.data, false);
  assert.match(firstUploadBody.data.upload_url, /^http:\/\/storage\.invalid\/upload\//);

  const assetId = firstUploadBody.data.asset_id as string;
  const detailBeforeConfirm = await assetStore.findProjectDetail("ws_dev_default", projectId);
  const asset = detailBeforeConfirm?.assets.find((value) => value.id === assetId);
  assert.ok(asset);
  assert.match(asset.objectKey, new RegExp(`^ws_dev_default/${projectId}/${assetId}/original\\.png$`));
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  storage.putObject({ objectKey: asset.objectKey, mimeType: "image/png", bytes });

  const confirmCommand = { sha256, mime_type: "image/png", byte_size: 3 };
  const confirm = () =>
    app.request(`http://localhost/api/v1/assets/${assetId}/confirm-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-confirm-1" },
      body: JSON.stringify(confirmCommand),
    });
  const firstConfirm = await confirm();
  const replayConfirm = await confirm();
  assert.equal(firstConfirm.status, 200);
  assert.equal(replayConfirm.status, 200);
  assert.equal((await readJson(firstConfirm)).data.status, "READY");
  assert.equal("object_key" in (await readJson(replayConfirm)).data, false);

  const shotCommand = {
    position: 0,
    prompt: "A calm product opening frame",
    reference_bindings: [{ asset_id: assetId, role: "STYLE", position: 0 }],
  };
  const createShot = (body = shotCommand, key = "c04-shot-1") =>
    app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  const firstShot = await createShot();
  const firstShotBody = await readJson(firstShot);
  const replayShot = await createShot();
  const replayShotBody = await readJson(replayShot);
  assert.equal(firstShot.status, 201);
  assert.equal(replayShot.status, 201);
  assert.equal(firstShotBody.data.id, replayShotBody.data.id);
  const shotConflict = await createShot({ ...shotCommand, prompt: "Different prompt" });
  assert.equal(shotConflict.status, 409);

  const missingAssetId = "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const invalidReferenceCommand = {
    position: 1,
    prompt: "Cannot bind a missing asset",
    reference_bindings: [{ asset_id: missingAssetId, role: "STYLE", position: 0 }],
  };
  const invalidReference = () => createShot(invalidReferenceCommand, "c04-invalid-reference-1");
  assert.equal((await invalidReference()).status, 400);
  assert.equal((await invalidReference()).status, 400);
  assert.equal((await createShot({ ...invalidReferenceCommand, prompt: "Different invalid reference" }, "c04-invalid-reference-1")).status, 409);

  const missingProjectId = "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const missingProjectCommand = { position: 0, prompt: "Missing project" };
  const missingProjectShot = (body = missingProjectCommand) =>
    app.request(`http://localhost/api/v1/projects/${missingProjectId}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-missing-project-1" },
      body: JSON.stringify(body),
    });
  assert.equal((await missingProjectShot()).status, 404);
  await store.createProject({
    scope: "c04-seed-missing-project",
    idempotencyKey: "c04-seed-missing-project-1",
    requestHash: fingerprintRequest({ name: "Now present" }),
    workspaceId: "ws_dev_default",
    projectId: missingProjectId,
    name: "Now present",
  });
  assert.equal((await missingProjectShot()).status, 404);
  assert.equal((await missingProjectShot({ ...missingProjectCommand, prompt: "Different missing project command" })).status, 409);

  assert.equal(await assetStore.findAsset("ws_other_workspace", assetId), undefined);
  assert.equal(await assetStore.findProjectDetail("ws_other_workspace", projectId), undefined);
});

test("user-uploaded assets can be soft-deleted with an idempotent public command", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store, assetStore, storage });
  const projectResponse = await createProject(app, "Delete material", "delete-material-project");
  const projectId = (await readJson(projectResponse)).data.id as string;
  const uploadResponse = await app.request(`http://localhost/api/v1/projects/${projectId}/assets/upload-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "delete-material-upload" },
    body: JSON.stringify({ kind: "IMAGE", filename: "wrong.png", mime_type: "image/png", byte_size: 3 }),
  });
  const upload = await readJson(uploadResponse);
  const assetId = upload.data.asset_id as string;
  const asset = (await assetStore.findProjectDetail("ws_dev_default", projectId))?.assets.find((item) => item.id === assetId);
  assert.ok(asset);
  storage.putObject({ objectKey: asset!.objectKey, mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  const checksum = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");
  await app.request(`http://localhost/api/v1/assets/${assetId}/confirm-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "delete-material-confirm" },
    body: JSON.stringify({ sha256: checksum, mime_type: "image/png", byte_size: 3 }),
  });

  const remove = () => app.request(`http://localhost/api/v1/assets/${assetId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": "delete-material-command" },
  });
  const first = await remove();
  const replay = await remove();
  assert.equal(first.status, 200);
  assert.equal((await readJson(first)).data.status, "DELETED");
  assert.equal(replay.status, 200);
  assert.equal((await readJson(replay)).data.status, "DELETED");
  assert.equal((await app.request(`http://localhost/api/v1/assets/${assetId}/download-url`)).status, 404);
});

test("missing asset confirmation is repository-first and shot positions have a public conflict code", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store, assetStore, storage });
  const projectResponse = await createProject(app, "Conflict contract", "c04-conflict-project-1");
  const projectId = (await readJson(projectResponse)).data.id as string;
  const assetId = "ast_01J4N8QZ8PCW2N2G6D2XJXJXJZ";
  const confirmBody = { sha256: "c".repeat(64), mime_type: "image/png", byte_size: 3 };
  const confirm = (body = confirmBody) =>
    app.request(`http://localhost/api/v1/assets/${assetId}/confirm-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-missing-confirm-1" },
      body: JSON.stringify(body),
    });
  assert.equal((await confirm()).status, 404);
  await assetStore.createUploadAsset({
    scope: "c04-seed-asset",
    idempotencyKey: "seed-asset-1",
    requestHash: fingerprintRequest({ filename: "appeared.png" }),
    workspaceId: "ws_dev_default",
    projectId,
    assetId,
    kind: "IMAGE",
    objectKey: `ws_dev_default/${projectId}/${assetId}/original.png`,
    filename: "appeared.png",
    mimeType: "image/png",
    byteSize: 3,
  });
  assert.equal((await confirm()).status, 404);
  assert.equal((await confirm({ ...confirmBody, sha256: "d".repeat(64) })).status, 409);

  const invalidUploadResponse = await app.request(`http://localhost/api/v1/projects/${projectId}/assets/upload-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-invalid-upload-request-1" },
    body: JSON.stringify({ kind: "IMAGE", filename: "missing.png", mime_type: "image/png", byte_size: 3 }),
  });
  const invalidUploadAssetId = (await readJson(invalidUploadResponse)).data.asset_id as string;
  const invalidUploadBody = { sha256: "e".repeat(64), mime_type: "image/png", byte_size: 3 };
  const invalidUploadConfirm = (body = invalidUploadBody) =>
    app.request(`http://localhost/api/v1/assets/${invalidUploadAssetId}/confirm-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-invalid-upload-confirm-1" },
      body: JSON.stringify(body),
    });
  assert.equal((await invalidUploadConfirm()).status, 400);
  assert.equal((await invalidUploadConfirm()).status, 400);
  assert.equal((await invalidUploadConfirm({ ...invalidUploadBody, sha256: "f".repeat(64) })).status, 409);

  const createShot = (position: number, key: string, prompt: string) =>
    app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ position, prompt }),
    });
  assert.equal((await createShot(0, "c04-position-1", "First shot")).status, 201);
  const positionConflict = await createShot(0, "c04-position-2", "Duplicate shot");
  const positionConflictBody = await readJson(positionConflict);
  assert.equal(positionConflict.status, 409);
  assert.equal(positionConflictBody.error.code, "SHOT_POSITION_CONFLICT");
  const positionReplay = await createShot(0, "c04-position-2", "Duplicate shot");
  assert.equal(positionReplay.status, 409);
  assert.equal((await readJson(positionReplay)).error.code, "SHOT_POSITION_CONFLICT");
  const positionConflictBodyMismatch = await createShot(0, "c04-position-2", "Different duplicate shot");
  assert.equal(positionConflictBodyMismatch.status, 409);
  assert.equal((await readJson(positionConflictBodyMismatch)).error.code, "IDEMPOTENCY_CONFLICT");

  const secondShot = await createShot(1, "c04-position-3", "Second shot");
  const secondShotId = (await readJson(secondShot)).data.id as string;
  const patchPosition = (body: Record<string, unknown>) => app.request(`http://localhost/api/v1/shots/${secondShotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-position-update-conflict-1" },
    body: JSON.stringify(body),
  });
  const firstPatchConflict = await patchPosition({ position: 0 });
  assert.equal(firstPatchConflict.status, 409);
  assert.equal((await readJson(firstPatchConflict)).error.code, "SHOT_POSITION_CONFLICT");
  const replayPatchConflict = await patchPosition({ position: 0 });
  assert.equal(replayPatchConflict.status, 409);
  assert.equal((await readJson(replayPatchConflict)).error.code, "SHOT_POSITION_CONFLICT");
  const changedPatchConflict = await patchPosition({ position: 0, prompt: "Different conflict body" });
  assert.equal(changedPatchConflict.status, 409);
  assert.equal((await readJson(changedPatchConflict)).error.code, "IDEMPOTENCY_CONFLICT");
});

test("music-purpose AUDIO uploads are server-owned MUSIC assets even when caller metadata attempts to override the role", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const projectResponse = await createProject(createApp({ store, assetStore }), "Music role", "music-role-project");
  const projectId = (await readJson(projectResponse)).data.id as string;
  const assetId = "ast_01J4N8QZ8PCW2N2G6D2XJXJXY";
  const result = await assetStore.createUploadAsset({
    scope: "music-role-seed",
    idempotencyKey: "music-role-upload",
    requestHash: fingerprintRequest({ music: true }),
    workspaceId: "ws_dev_default",
    projectId,
    assetId,
    kind: "AUDIO",
    objectKey: `ws_dev_default/${projectId}/${assetId}/music.mp3`,
    filename: "music.mp3",
    mimeType: "audio/mpeg",
    byteSize: 4,
    audioRole: "MUSIC",
    metadata: { audio_role: "PROVIDER_AMBIENCE" },
  });
  assert.equal(result.kind, "NEW");
  if (result.kind === "NEW") assert.equal(result.value.metadata.audio_role, "MUSIC");
});

test("narration sample purpose is server-owned and excluded from AUTO music assets", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const app = createApp({ store, assetStore });
  const projectId = (await readJson(await createProject(app, "Audio roles", "audio-role-project"))).data.id as string;
  const workspaceId = "ws_dev_default";
  const sampleId = "ast_01J4N8QZ8PCW2N2G6D2XJXJXZ";
  const sample = await assetStore.createUploadAsset({
    scope: "audio-role-sample",
    idempotencyKey: "sample-upload",
    requestHash: fingerprintRequest({ sample: true }),
    workspaceId,
    projectId,
    assetId: sampleId,
    kind: "AUDIO",
    objectKey: `${workspaceId}/${projectId}/${sampleId}/sample.wav`,
    filename: "sample.wav",
    mimeType: "audio/wav",
    byteSize: 4,
    audioRole: "NARRATION_SAMPLE",
    metadata: { audio_role: "MUSIC" },
  });
  assert.equal(sample.kind, "NEW");
  if (sample.kind !== "NEW") return;
  assert.equal(sample.value.metadata.audio_role, "NARRATION_SAMPLE");
  await assetStore.confirmAssetUpload({
    scope: "audio-role-sample-confirm",
    idempotencyKey: "sample-confirm",
    requestHash: fingerprintRequest({ sample: "confirm" }),
    workspaceId,
    assetId: sampleId,
    sha256: "a".repeat(64),
    mimeType: "audio/wav",
    byteSize: 4,
    durationMs: 1_000,
    verifyUpload: async () => true,
  });
  assert.deepEqual(await assetStore.listWorkspaceMusicAssets(workspaceId), []);
});

test("AUTO music candidates include only server-owned MUSIC across every audio role", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const app = createApp({ store, assetStore });
  const projectId = (await readJson(await createProject(app, "Audio role isolation", "audio-role-isolation-project"))).data.id as string;
  const workspaceId = "ws_dev_default";
  const roles: Array<"MUSIC" | "NARRATION_SAMPLE" | "USER_SOURCE_AUDIO" | undefined> = [
    "MUSIC",
    "NARRATION_SAMPLE",
    "USER_SOURCE_AUDIO",
    undefined,
  ];

  for (const [index, role] of roles.entries()) {
    const assetId = `ast_01J4N8QZ8PCW2N2G6D2XJXJX${String(index + 1).padStart(2, "0")}`;
    const created = await assetStore.createUploadAsset({
      scope: `audio-role-isolation-${index}`,
      idempotencyKey: `audio-role-isolation-${index}`,
      requestHash: fingerprintRequest({ role, index }),
      workspaceId,
      projectId,
      assetId,
      kind: "AUDIO",
      objectKey: `${workspaceId}/${projectId}/${assetId}/audio.mp3`,
      filename: `audio-${index}.mp3`,
      mimeType: "audio/mpeg",
      byteSize: 4,
      ...(role ? { audioRole: role } : {}),
      metadata: { audio_role: "MUSIC" },
    });
    assert.equal(created.kind, "NEW");
    if (created.kind !== "NEW") continue;
    const confirmed = await assetStore.confirmAssetUpload({
      scope: `audio-role-isolation-confirm-${index}`,
      idempotencyKey: `audio-role-isolation-confirm-${index}`,
      requestHash: fingerprintRequest({ confirm: index }),
      workspaceId,
      assetId,
      sha256: String(index).repeat(64),
      mimeType: "audio/mpeg",
      byteSize: 4,
      verifyUpload: async () => true,
    });
    assert.equal(confirmed.kind, "NEW");
  }

  const candidates = await assetStore.listWorkspaceMusicAssets(workspaceId);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.metadata.audio_role, "MUSIC");
  assert.equal(candidates[0]?.metadata.filename, "audio-0.mp3");
});

test("Pixabay source flow imports the first filtered track as a server-owned MUSIC asset and replays idempotently", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const storage = new InMemoryStoragePort();
  let calls = 0;
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  const app = createApp({
    store,
    assetStore,
    storage,
    pixabayMusic: {
      async execute(input) {
        calls += 1;
        assert.equal(input.query, "corporate background");
        return {
          bytes,
          mimeType: "audio/mpeg" as const,
          filename: "pixabay_music_Corporate Theme.mp3",
          query: input.query,
          track: {
            title: "Corporate Theme",
            artist: "Pixabay Artist",
            audio_url: "https://cdn.pixabay.com/audio/test.mp3",
            duration: 42.5,
            pixabay_id: 123,
          },
          results_found: 3,
          results_after_filter: 1,
        };
      },
    },
  });
  const projectId = (await readJson(await createProject(app, "Pixabay import", "pixabay-project"))).data.id as string;
  const request = () => app.request(`http://localhost/api/v1/projects/${projectId}/audio/pixabay/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "pixabay-import-1" },
    body: JSON.stringify({ query: "corporate background", min_duration: 30, max_duration: 60 }),
  });
  const first = await request();
  assert.equal(first.status, 201);
  const firstBody = await readJson(first);
  assert.equal(firstBody.data.track.title, "Corporate Theme");
  assert.equal(firstBody.data.track.artist, "Pixabay Artist");
  assert.equal(firstBody.data.asset.metadata.audio_role, "MUSIC");
  assert.equal(firstBody.data.asset.metadata.audio_provider, "pixabay_music");
  assert.equal(firstBody.data.asset.metadata.filename, "pixabay_music_Corporate Theme.mp3");
  assert.equal(firstBody.data.asset.metadata.source_title, "Corporate Theme");
  assert.equal(firstBody.data.asset.metadata.source_artist, "Pixabay Artist");
  const assetId = firstBody.data.asset.id as string;
  const asset = await assetStore.findAsset("ws_dev_default", assetId);
  assert.ok(asset);
  assert.equal(asset.status, "READY");
  assert.equal(asset.mimeType, "audio/mpeg");
  assert.equal(asset.byteSize, bytes.byteLength);
  const object = await storage.inspectObject({ objectKey: asset.objectKey });
  assert.deepEqual(object, {
    mimeType: "audio/mpeg",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });

  const replay = await request();
  assert.equal(replay.status, 200);
  const replayBody = await readJson(replay);
  assert.equal(replayBody.data.asset.id, assetId);
  assert.equal(replayBody.data.track.title, "Corporate Theme");
  assert.equal(calls, 1);
});

test("upload purpose maps only the closed server-owned audio roles", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const app = createApp({ store, assetStore });
  const projectId = (await readJson(await createProject(app, "Audio upload purpose", "audio-purpose-project"))).data.id as string;
  const upload = async (purpose: "MUSIC" | "NARRATION_SAMPLE" | "USER_SOURCE_AUDIO" | undefined, key: string) => {
    const response = await app.request(`http://localhost/api/v1/projects/${projectId}/assets/upload-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ kind: "AUDIO", purpose, filename: `${key}.wav`, mime_type: "audio/wav", byte_size: 4, metadata: { audio_role: "MUSIC" } }),
    });
    assert.equal(response.status, 201);
    const body = await readJson(response);
    const asset = await assetStore.findAsset("ws_dev_default", body.data.asset_id as string);
    assert.ok(asset);
    return asset;
  };
  assert.equal((await upload("MUSIC", "music-purpose")).metadata.audio_role, "MUSIC");
  assert.equal((await upload("NARRATION_SAMPLE", "sample-purpose")).metadata.audio_role, "NARRATION_SAMPLE");
  assert.equal((await upload("USER_SOURCE_AUDIO", "user-source-purpose")).metadata.audio_role, "USER_SOURCE_AUDIO");
  assert.equal((await upload(undefined, "unclassified-purpose")).metadata.audio_role, undefined);
});

test("storage unavailability does not persist a confirm command", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const healthyStorage = new InMemoryStoragePort();
  const unavailableStorage: StoragePort = {
    createUploadUrl: (input) => healthyStorage.createUploadUrl(input),
    createDownloadUrl: (input) => healthyStorage.createDownloadUrl(input),
    async inspectObject() { throw new StorageUnavailableError(); },
  };
  const unavailableApp = createApp({ store, assetStore, storage: unavailableStorage });
  const projectId = (await readJson(await createProject(unavailableApp, "Storage unavailable", "c04-storage-project-1"))).data.id as string;
  const assetId = (await readJson(await unavailableApp.request(`http://localhost/api/v1/projects/${projectId}/assets/upload-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-storage-upload-1" },
    body: JSON.stringify({ kind: "IMAGE", filename: "available.png", mime_type: "image/png", byte_size: 3 }),
  }))).data.asset_id as string;
  const asset = await assetStore.findAsset("ws_dev_default", assetId);
  assert.ok(asset);
  const bytes = new Uint8Array([9, 8, 7]);
  const body = { sha256: createHash("sha256").update(bytes).digest("hex"), mime_type: "image/png", byte_size: 3 };
  const request = (app: ReturnType<typeof createApp>) => app.request(`http://localhost/api/v1/assets/${assetId}/confirm-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c04-storage-confirm-1" },
    body: JSON.stringify(body),
  });
  assert.equal((await request(unavailableApp)).status, 503);
  healthyStorage.putObject({ objectKey: asset.objectKey, mimeType: "image/png", bytes });
  const healthyApp = createApp({ store, assetStore, storage: healthyStorage });
  assert.equal((await request(healthyApp)).status, 200);
});

test("C05 SSE replays only persisted safe public workspace events", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const taskStore = createInMemoryTaskRunStore(assetStore);
  const app = createApp({ store, assetStore, taskStore });
  const projectId = (await readJson(await createProject(app, "C05 queue project", "c05-project-1"))).data.id as string;
  const shotResponse = await app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c05-shot-1" },
    body: JSON.stringify({ position: 0, prompt: "Queue only, no Provider." }),
  });
  const shotId = (await readJson(shotResponse)).data.id as string;
  await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c05-shot-ready-1" },
    body: JSON.stringify({ status: "READY" }),
  });
  const command = {
    model: "mock-video-v1",
    prompt: "A local C05 task is only queued.",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
    reference_asset_ids: [],
  };
  const taskRun = await taskStore.createTaskRun({
    scope: "c05:sse-seed",
    idempotencyKey: "c05-task-1",
    requestHash: fingerprintRequest(command),
    workspaceId: "ws_dev_default",
    taskRunId: createPrefixedId("tsk"),
    shotId,
    kind: "VIDEO_GENERATION",
    inputSnapshot: command,
    event: {
      eventId: createPrefixedId("evt"),
      messageId: createPrefixedId("msg"),
      traceId: createPrefixedId("trc"),
      correlationId: createPrefixedId("cor"),
    },
  });
  assert.equal(taskRun.kind, "NEW");

  const queued = await taskStore.listWorkspaceEvents({ workspaceId: "ws_dev_default", limit: 10 });
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.event_type, "task_run.queued");
  if (!queued[0] || queued[0].event_type !== "task_run.queued") return;
  assert.equal(await taskStore.processEvent({
    message: InternalTaskRunQueueMessageSchema.parse({
      contract_version: queued[0].contract_version,
      event_id: queued[0].event_id,
      workspace_id: queued[0].workspace_id,
      task_run_id: queued[0].data.task_run_id,
      attempt_no: 1,
      correlation_id: queued[0].correlation_id,
      input_snapshot: queued[0].data.input_snapshot,
    }),
    consumerName: "test-task-run-transition",
    workerId: "worker-c05-test",
    now: new Date(),
    leaseMs: 1_000,
  }), "PROCESSED");
  assert.equal(await taskStore.processEvent({
    message: InternalTaskRunQueueMessageSchema.parse({
      contract_version: queued[0].contract_version,
      event_id: queued[0].event_id,
      workspace_id: "ws_other_workspace",
      task_run_id: queued[0].data.task_run_id,
      attempt_no: 1,
      correlation_id: queued[0].correlation_id,
      input_snapshot: queued[0].data.input_snapshot,
    }),
    consumerName: "test-task-run-transition",
    workerId: "worker-c05-tampered",
    now: new Date(),
    leaseMs: 1_000,
  }), "RETRY");

  const readFirstChunk = async (response: Response) => {
    const reader = response.body?.getReader();
    assert.ok(reader);
    const result = await reader.read();
    await reader.cancel();
    return new TextDecoder().decode(result.value);
  };
  const stream = await app.request("http://localhost/api/v1/events?workspace_id=ws_dev_default");
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("Content-Type") ?? "", /^text\/event-stream/);
  const firstChunk = await readFirstChunk(stream);
  assert.match(firstChunk, /^id: evt_/m);
  assert.match(firstChunk, /event: task_run\.queued/);
  for (const forbidden of ["input_snapshot", "provider", "object_key", "trace_id", "correlation_id", "idempotency_key", "prompt"]) {
    assert.equal(firstChunk.includes(forbidden), false, `${forbidden} must not appear in public SSE`);
  }

  const queuedId = queued[0]!.event_id;
  const replayStream = await app.request("http://localhost/api/v1/events?workspace_id=ws_dev_default", {
    headers: { "Last-Event-ID": queuedId },
  });
  const replayChunk = await readFirstChunk(replayStream);
  assert.match(replayChunk, /event: task_run\.started/);
  assert.equal(replayChunk.includes(queuedId), false);

  const persistedEvents = await taskStore.listWorkspaceEvents({ workspaceId: "ws_dev_default", limit: 10 });
  const empty = await app.request("http://localhost/api/v1/events?workspace_id=ws_dev_default", {
    headers: { "Last-Event-ID": persistedEvents.at(-1)!.event_id },
  });
  assert.match(await readFirstChunk(empty), /^: keep-alive/m);
  const forbidden = await app.request("http://localhost/api/v1/events?workspace_id=ws_other_workspace");
  assert.equal(forbidden.status, 403);
  assert.equal((await readJson(forbidden)).error.code, "WORKSPACE_FORBIDDEN");
});
