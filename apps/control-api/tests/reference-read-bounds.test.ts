import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InMemoryStoragePort, type StoragePort } from "@alchemy-video/storage-client";
import { createApp } from "../src/app.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

const bytes = new Uint8Array([1, 2, 3]);
const command = { sha256: createHash("sha256").update(bytes).digest("hex"), mime_type: "image/png", byte_size: bytes.byteLength };
const post = (app: ReturnType<typeof createApp>, path: string, key: string, body: unknown, signal?: AbortSignal) => app.request(`http://localhost/api/v1${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": key },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});
const json = (response: Response) => response.json() as Promise<Record<string, any>>;

const setup = async (readObject: StoragePort["readObject"]) => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const storage = new InMemoryStoragePort();
  storage.readObject = readObject as typeof storage.readObject;
  let analyzerCalls = 0;
  const app = createApp({ store, assetStore, storage, referenceVisionAnalyzer: { async analyze() {
    analyzerCalls += 1;
    throw new Error("An unbounded, interrupted or mismatched stream must never reach the analyzer.");
  } } });
  const projectId = (await json(await post(app, "/projects", "reference-bound-project", { name: "Reference stream bounds" }))).data.id as string;
  const assetId = (await json(await post(app, `/projects/${projectId}/assets/upload-requests`, "reference-bound-upload", { kind: "IMAGE", filename: "image.png", mime_type: "image/png", byte_size: bytes.byteLength }))).data.asset_id as string;
  const asset = await assetStore.findAsset("ws_dev_default", assetId);
  assert.ok(asset);
  await storage.putObject({ objectKey: asset.objectKey, mimeType: "image/png", bytes });
  return { app, assetStore, assetId, path: `/assets/${assetId}/confirm-upload`, analyzerCalls: () => analyzerCalls };
};

test("reference-analysis overflow cancels its second read without awaiting stalled cancellation", { timeout: 2_000 }, async () => {
  let cancellations = 0;
  const value = await setup(async (input) => {
    assert.ok(input.signal);
    return { mimeType: "image/png", byteSize: 3, stream: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
      cancel() { cancellations += 1; return new Promise<void>(() => undefined); },
    }) };
  });
  const result = await post(value.app, value.path, "reference-overflow-confirm", command);
  assert.equal(result.status, 200);
  assert.equal(cancellations, 1);
  assert.equal(value.analyzerCalls(), 0);
  assert.equal((await value.assetStore.findAsset("ws_dev_default", value.assetId))?.metadata.visual_analysis_status, "FAILED");
});

test("caller abort interrupts a stalled reference stream and does not await its cancel promise", { timeout: 2_000 }, async () => {
  const controller = new AbortController();
  let cancellations = 0;
  let started: () => void = () => undefined;
  const readStarted = new Promise<void>((resolve) => { started = resolve; });
  let storageSignal: AbortSignal | undefined;
  const value = await setup(async (input) => {
    storageSignal = input.signal;
    return { mimeType: "image/png", byteSize: 3, stream: new ReadableStream<Uint8Array>({
      pull() { started(); return new Promise<void>(() => undefined); },
      cancel() { cancellations += 1; return new Promise<void>(() => undefined); },
    }) };
  });
  const pending = post(value.app, value.path, "reference-abort-confirm", command, controller.signal);
  await readStarted;
  controller.abort();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(storageSignal?.aborted, true);
  assert.equal(cancellations, 1);
  assert.equal(value.analyzerCalls(), 0);
  assert.equal((await value.assetStore.findAsset("ws_dev_default", value.assetId))?.metadata.visual_analysis_status, "FAILED");
});

test("second-read MIME mismatch cancels the unread object without awaiting cancellation", { timeout: 2_000 }, async () => {
  let cancellations = 0;
  const value = await setup(async () => ({ mimeType: "text/plain", byteSize: 3, stream: new ReadableStream<Uint8Array>({
    cancel() { cancellations += 1; return new Promise<void>(() => undefined); },
  }) }));
  assert.equal((await post(value.app, value.path, "reference-mime-confirm", command)).status, 200);
  assert.equal(cancellations, 1);
  assert.equal(value.analyzerCalls(), 0);
});
