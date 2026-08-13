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
