import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { StorageObjectAlreadyExistsError, createAssetObjectKey, createInMemoryStoragePort, storageDiagnostic } from "../src/index.js";

test("storage diagnostics retain only stable S3 error metadata", () => {
  assert.deepEqual(
    storageDiagnostic({ name: "NotImplemented", Code: "NotImplemented", $metadata: { httpStatusCode: 501 }, authorization: "never exposed" }),
    { name: "NotImplemented", code: "NotImplemented", httpStatusCode: 501 },
  );
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
});

test("in-memory storage returns signed surfaces only when an object exists and inspects bytes server-side", async () => {
  const storage = createInMemoryStoragePort();
  const objectKey = "ws_test/prj_test/ast_test/original.png";
  const bytes = new TextEncoder().encode("local-asset-content");

  const upload = await storage.createUploadUrl({ objectKey, mimeType: "image/png" });
  assert.match(upload.uploadUrl, /^http:\/\/storage\.invalid\/upload\//);
  assert.deepEqual(upload.headers, { "Content-Type": "image/png", "If-None-Match": "*" });
  assert.equal(await storage.inspectObject({ objectKey }), undefined);

  storage.putObject({ objectKey, mimeType: "image/png", bytes, ifNoneMatch: "*" });
  assert.throws(
    () => storage.putObject({ objectKey, mimeType: "image/png", bytes: new TextEncoder().encode("replacement"), ifNoneMatch: "*" }),
    StorageObjectAlreadyExistsError,
  );
  assert.deepEqual(await storage.inspectObject({ objectKey }), {
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  assert.match((await storage.createDownloadUrl({ objectKey })).downloadUrl, /^http:\/\/storage\.invalid\/download\//);
});
