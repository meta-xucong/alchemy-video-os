import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InMemoryStoragePort, StorageUnavailableError, type StoragePort } from "@alchemy-video/storage-client";
import { createApp } from "../src/app.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

const post = (app: ReturnType<typeof createApp>, path: string, key: string, body: unknown) => app.request(`http://localhost/api/v1${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": key },
  body: JSON.stringify(body),
});
const json = (response: Response) => response.json() as Promise<Record<string, any>>;
const bytes = new Uint8Array([1, 2, 3]);
const confirmation = { sha256: createHash("sha256").update(bytes).digest("hex"), mime_type: "image/png", byte_size: 3 };

const setup = async (storage = new InMemoryStoragePort()) => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const app = createApp({ store, assetStore, storage });
  const projectId = (await json(await post(app, "/projects", "bounds-project", { name: "Upload bounds" }))).data.id as string;
  const upload = await post(app, `/projects/${projectId}/assets/upload-requests`, "bounds-upload", { kind: "IMAGE", filename: "image.png", mime_type: "image/png", byte_size: bytes.byteLength });
  assert.equal(upload.status, 201);
  const assetId = (await json(upload)).data.asset_id as string;
  const asset = await assetStore.findAsset("ws_dev_default", assetId);
  assert.ok(asset);
  return { app, store, assetStore, storage, asset, path: `/assets/${assetId}/confirm-upload` };
};

test("upload signing receives the reservation and confirmation hashes once outside its transaction", async () => {
  let signedSize: number | undefined;
  let inTransaction = false;
  let inspections = 0;
  class Storage extends InMemoryStoragePort {
    override async createUploadUrl(input: Parameters<StoragePort["createUploadUrl"]>[0]) {
      signedSize = input.byteSize;
      return super.createUploadUrl(input);
    }
    override async inspectObject(input: Parameters<StoragePort["inspectObject"]>[0]) {
      assert.equal(inTransaction, false);
      assert.equal(input.maxByteSize, bytes.byteLength);
      assert.equal(input.expectedMimeType, "image/png");
      inspections += 1;
      return super.inspectObject(input);
    }
  }
  const value = await setup(new Storage());
  assert.equal(signedSize, bytes.byteLength);
  await value.storage.putObject({ objectKey: value.asset.objectKey, mimeType: "image/png", bytes });
  const confirm = value.assetStore.confirmAssetUpload.bind(value.assetStore);
  value.assetStore.confirmAssetUpload = async (input) => {
    inTransaction = true;
    try { return await confirm(input); } finally { inTransaction = false; }
  };
  assert.equal((await post(value.app, value.path, "valid-confirm", confirmation)).status, 200);
  assert.equal(inspections, 1);
  assert.equal((await post(value.app, value.path, "valid-confirm", confirmation)).status, 200);
  assert.equal(inspections, 1);
});

test("confirmation metadata mismatches fail before object inspection and remain replayable", async () => {
  const value = await setup();
  value.storage.inspectObject = async () => { throw new Error("must not inspect an unreserved size or MIME"); };
  assert.equal((await post(value.app, value.path, "large-command", { ...confirmation, byte_size: 100_000_000 })).status, 400);
  assert.equal((await post(value.app, value.path, "mime-command", { ...confirmation, mime_type: "text/plain" })).status, 400);
  assert.equal((await post(value.app, value.path, "large-command", { ...confirmation, byte_size: 100_000_000 })).status, 400);
  assert.equal((await post(value.app, value.path, "large-command", confirmation)).status, 409);
});

test("proven oversize pending uploads are rejected without deleting stored objects", async () => {
  const value = await setup();
  await value.storage.putObject({ objectKey: value.asset.objectKey, mimeType: "image/png", bytes: new Uint8Array(4) });
  const rejected = await post(value.app, value.path, "oversize-confirm", confirmation);
  assert.equal(rejected.status, 400);
  assert.equal((await json(rejected)).error.code, "DOWNLOAD_INVALID");
  assert.equal((await value.storage.readObject({ objectKey: value.asset.objectKey }))?.byteSize, 4);
  assert.equal((await value.assetStore.findAsset("ws_dev_default", value.asset.id))?.status, "PENDING_UPLOAD");
  // A new command may confirm a separately corrected upload; the rejected
  // command itself still replays its original result during a storage outage.
  await value.storage.putObject({ objectKey: value.asset.objectKey, mimeType: "image/png", bytes });
  const inspect = value.storage.inspectObject.bind(value.storage);
  value.storage.inspectObject = async () => { throw new StorageUnavailableError(); };
  assert.equal((await post(value.app, value.path, "oversize-confirm", confirmation)).status, 400);
  value.storage.inspectObject = inspect;
  assert.equal((await post(value.app, value.path, "corrected-confirm", confirmation)).status, 200);
});

test("bad client hashes never delete otherwise valid bytes, including READY assets", async () => {
  const value = await setup();
  await value.storage.putObject({ objectKey: value.asset.objectKey, mimeType: "image/png", bytes });
  assert.equal((await post(value.app, value.path, "bad-hash", { ...confirmation, sha256: "0".repeat(64) })).status, 400);
  assert.ok(await value.storage.readObject({ objectKey: value.asset.objectKey }));
  assert.equal((await post(value.app, value.path, "good-hash", confirmation)).status, 200);
  assert.equal((await post(value.app, value.path, "ready-bad-hash", { ...confirmation, sha256: "0".repeat(64) })).status, 200);
  assert.equal((await value.storage.readObject({ objectKey: value.asset.objectKey }))?.byteSize, 3);
});

test("a generated pending object cannot be inspected or cleaned through public upload confirmation", async () => {
  const value = await setup();
  const find = value.assetStore.findAsset.bind(value.assetStore);
  value.assetStore.findAsset = async (workspaceId, assetId) => {
    const asset = await find(workspaceId, assetId);
    return asset ? { ...asset, origin: "GENERATED" } : undefined;
  };
  value.storage.inspectObject = async () => { throw new Error("generated object must not be inspected"); };
  assert.equal((await post(value.app, value.path, "generated-confirm", confirmation)).status, 400);
});

test("internal Pixabay pending imports cannot be inspected by public direct-upload confirmation", async () => {
  const value = await setup();
  const find = value.assetStore.findAsset.bind(value.assetStore);
  value.assetStore.findAsset = async (workspaceId, assetId) => {
    const asset = await find(workspaceId, assetId);
    return asset ? { ...asset, metadata: { ...asset.metadata, audio_provider: "pixabay_music" } } : undefined;
  };
  value.storage.inspectObject = async () => { throw new Error("internal import must not be inspected"); };
  assert.equal((await post(value.app, value.path, "internal-import-confirm", confirmation)).status, 400);
});
