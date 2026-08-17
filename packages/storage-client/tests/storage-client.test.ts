import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  StorageObjectAlreadyExistsError,
  createAssetObjectKey,
  createComposedVideoObjectKey,
  createGeneratedVideoObjectKey,
  createHandoffFrameObjectKey,
  createInMemoryStoragePort,
  storageDiagnostic,
} from "../src/index.js";

const readStream = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
};

test("storage diagnostics retain only stable S3 error metadata", () => {
  assert.deepEqual(
    storageDiagnostic({ name: "NotImplemented", Code: "NotImplemented", $metadata: { httpStatusCode: 501 }, authorization: "never exposed" }),
    { name: "NotImplemented", code: "NotImplemented", httpStatusCode: 501 },
  );
});

test("S3 storage source keeps private I/O and public URL signing endpoints separate", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /private readonly client: S3Client,/);
  assert.match(source, /private readonly signingClient: S3Client,/);
  assert.match(source, /this\.client\.send\(new HeadObjectCommand/);
  assert.match(source, /getSignedUrl\(\s*this\.signingClient,/);
  assert.match(source, /ResponseContentDisposition:\s*"attachment"/);
  assert.match(source, /endpoint: config\.publicEndpoint \?\? config\.endpoint/);
});

test("server-owned object keys ignore unsafe filename paths and use the MIME extension", () => {
  assert.equal(
    createAssetObjectKey({
      workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      assetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      filename: "../../private.pdf",
      mimeType: "image/png",
    }),
    "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/original.png",
  );
  assert.equal(
    createGeneratedVideoObjectKey({
      workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      assetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    }),
    "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/generated.mp4",
  );
  assert.equal(
    createHandoffFrameObjectKey({
      workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      assetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    }),
    "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/handoff.png",
  );
  assert.equal(
    createComposedVideoObjectKey({
      workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      assetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    }),
    "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/ast_01J4N8QZ8PCW2N2G6D2XJXJXJX/composed.mp4",
  );
});

test("in-memory storage returns signed surfaces only when an object exists and inspects bytes server-side", async () => {
  const storage = createInMemoryStoragePort();
  const objectKey = "ws_test/prj_test/ast_test/original.png";
  const bytes = new TextEncoder().encode("local-asset-content");

  const upload = await storage.createUploadUrl({ objectKey, mimeType: "image/png" });
  assert.match(upload.uploadUrl, /^http:\/\/storage\.invalid\/upload\//);
  assert.deepEqual(upload.headers, { "Content-Type": "image/png", "If-None-Match": "*" });
  assert.equal(await storage.inspectObject({ objectKey }), undefined);

  await storage.putObject({ objectKey, mimeType: "image/png", bytes, ifNoneMatch: "*" });
  await assert.rejects(
    () => storage.putObject({ objectKey, mimeType: "image/png", bytes: new TextEncoder().encode("replacement"), ifNoneMatch: "*" }),
    StorageObjectAlreadyExistsError,
  );
  assert.deepEqual(await storage.inspectObject({ objectKey }), {
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  assert.match((await storage.createDownloadUrl({ objectKey })).downloadUrl, /^http:\/\/storage\.invalid\/download\//);
  const object = await storage.readObject({ objectKey });
  assert.equal(object?.mimeType, "image/png");
  assert.equal(object?.byteSize, bytes.byteLength);
  assert.deepEqual(new Uint8Array(await readStream(object!.stream)), bytes);
  assert.equal(await storage.readObject({ objectKey: "missing" }), undefined);
});
