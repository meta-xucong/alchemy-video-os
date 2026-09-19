import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import { InMemoryDocumentConversionStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";

import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { serializeDocumentConversion } from "../src/serializers.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;
const event = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const request = (app: ReturnType<typeof createApp>, path: string, idempotencyKey: string, body: Record<string, unknown> = {}) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });

test("C10 document commands use confirmed project assets, replay safely, hide storage data, and allow only explicit retry", async () => {
  const store = createInMemoryControlPlaneStore();
  const assetStore = createInMemoryAssetWorkspaceStore(store);
  const documentStore = new InMemoryDocumentConversionStore(assetStore);
  const storage = new InMemoryStoragePort();
  const app = createApp({ store, assetStore, documentStore, storage });
  const project = await readJson(await request(app, "/api/v1/projects", "c10-project", { name: "C10 document routes" }));
  const projectId = project.data.id as string;

  const upload = await readJson(await request(app, `/api/v1/projects/${projectId}/assets/upload-requests`, "c10-upload", {
    kind: "DOCUMENT",
    filename: "brief.md",
    mime_type: "text/markdown",
    byte_size: 20,
  }));
  const sourceAssetId = upload.data.asset_id as string;
  const asset = await assetStore.findAsset("ws_dev_default", sourceAssetId);
  assert.ok(asset);
  const sourceBytes = new TextEncoder().encode("# C10 local document");
  await storage.putObject({ objectKey: asset.objectKey, mimeType: "text/markdown", bytes: sourceBytes });
  const confirmed = await request(app, `/api/v1/assets/${sourceAssetId}/confirm-upload`, "c10-confirm", {
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    mime_type: "text/markdown",
    byte_size: sourceBytes.byteLength,
  });
  assert.equal(confirmed.status, 200);

  const createPath = `/api/v1/projects/${projectId}/documents/${sourceAssetId}/conversions`;
  const createdResponse = await request(app, createPath, "c10-convert");
  const created = await readJson(createdResponse);
  assert.equal(createdResponse.status, 202);
  assert.equal(created.data.status, "QUEUED");
  assert.equal(created.data.source_asset_id, sourceAssetId);
  assert.equal(created.data.markdown_asset_id, null);
  for (const internal of ["object_key", "runtime_url", "DOCUMENT_RUNTIME_TOKEN", "source_sha256", "source_mime_type"]) {
    assert.equal(JSON.stringify(created).includes(internal), false, `public conversion response leaked ${internal}`);
  }

  const replay = await readJson(await request(app, createPath, "c10-convert"));
  assert.equal(replay.data.id, created.data.id);
  const activeConflict = await request(app, createPath, "c10-convert-conflict");
  assert.equal(activeConflict.status, 409);
  assert.equal((await readJson(activeConflict)).error.code, "DOCUMENT_CONVERSION_ACTIVE_CONFLICT");

  const listed = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}/documents`));
  assert.deepEqual(listed.data.map((conversion: { id: string }) => conversion.id), [created.data.id]);

  await documentStore.failDocumentConversion({
    workspaceId: "ws_dev_default",
    conversionId: created.data.id,
    code: "DOCUMENT_CONVERSION_FAILED",
    retryable: true,
    event: event(),
  });
  const retryPath = `/api/v1/document-conversions/${created.data.id}/retry`;
  const retriedResponse = await request(app, retryPath, "c10-retry");
  const retried = await readJson(retriedResponse);
  assert.equal(retriedResponse.status, 202);
  assert.equal(retried.data.id, created.data.id);
  assert.equal(retried.data.status, "QUEUED");
  assert.equal(retried.data.retryable, false);
  assert.equal((await readJson(await request(app, retryPath, "c10-retry"))).data.status, "QUEUED");
  assert.equal((await request(app, retryPath, "c10-retry-after-queued")).status, 400);
});

test("C10 serializer does not advertise a non-retryable conversion failure as actionable", () => {
  const serialized = serializeDocumentConversion({
    id: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    documentId: "doc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    sourceAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    sourceSha256: "a".repeat(64),
    sourceMimeType: "text/plain",
    sourceFilename: "brief.txt",
    sourceByteSize: 4,
    sourceObjectKey: "private/object/key",
    status: "FAILED",
    retryable: false,
    markdownAssetId: null,
    warnings: [],
    attemptCount: 1,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:01.000Z",
  });
  assert.equal(serialized.retryable, false);
  assert.equal(JSON.stringify(serialized).includes("private/object/key"), false);
});
