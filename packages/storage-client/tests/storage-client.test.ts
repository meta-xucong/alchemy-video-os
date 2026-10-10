import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { S3Client } from "@aws-sdk/client-s3";

import {
  S3StoragePort,
  StorageObjectAlreadyExistsError,
  StorageObjectInvalidError,
  StorageUnavailableError,
  createAssetObjectKey,
  createComposedVideoObjectKey,
  createGeneratedVideoObjectKey,
  createHandoffFrameObjectKey,
  createInMemoryStoragePort,
  createS3StoragePort,
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
  assert.match(source, /abortSignal: signal/);
  assert.match(source, /getSignedUrl\(\s*this\.signingClient,/);
  assert.match(source, /ResponseContentDisposition:\s*"attachment"/);
  assert.match(source, /endpoint: config\.publicEndpoint \?\? config\.endpoint/);
});

test("S3 inspection forwards the caller abort signal to both metadata and body requests", async () => {
  const calls: Array<{ name: string; signal?: AbortSignal }> = [];
  const body = {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("abort-aware-object");
    },
  };
  const client = {
    async send(command: { constructor: { name: string } }, options?: { abortSignal?: AbortSignal }) {
      calls.push({ name: command.constructor.name, signal: options?.abortSignal });
      if (command.constructor.name === "HeadObjectCommand") return { ContentType: "image/png", ContentLength: 18 };
      if (command.constructor.name === "GetObjectCommand") return { Body: body, ContentType: "image/png" };
      return {};
    },
  };
  const controller = new AbortController();
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);

  const inspection = await storage.inspectObject({ objectKey: "asset.png", signal: controller.signal });

  assert.equal(inspection?.mimeType, "image/png");
  assert.equal(inspection?.byteSize, 18);
  assert.equal(inspection?.sha256, createHash("sha256").update("abort-aware-object").digest("hex"));
  const signals = calls.filter(({ name }) => name === "HeadObjectCommand" || name === "GetObjectCommand").map(({ signal }) => signal);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  controller.abort();
  assert.ok(signals.every((signal) => signal?.aborted));
});

test("real SDK presigning binds reserved length, MIME and no-overwrite without an empty CRC32", async () => {
  const originalSend = S3Client.prototype.send;
  S3Client.prototype.send = (async () => ({})) as typeof originalSend;
  try {
    const storage = createS3StoragePort({ endpoint: "http://private.invalid", publicEndpoint: "http://browser.invalid", region: "us-east-1", bucket: "test", accessKeyId: "test", secretAccessKey: "test" });
    const upload = await storage.createUploadUrl({ objectKey: "asset.png", mimeType: "image/png", byteSize: 17 });
    const url = new URL(upload.uploadUrl);
    assert.equal(url.hostname, "browser.invalid");
    assert.deepEqual(url.searchParams.get("X-Amz-SignedHeaders")?.split(";"), ["content-length", "content-type", "host", "if-none-match"]);
    assert.equal(url.searchParams.has("x-amz-checksum-crc32"), false);
    assert.equal(url.searchParams.has("x-amz-sdk-checksum-algorithm"), false);
    // Browsers set Content-Length from the File/Blob themselves; JS must not
    // attempt to set a forbidden request header.
    assert.deepEqual(upload.headers, { "Content-Type": "image/png", "If-None-Match": "*" });
  } finally {
    S3Client.prototype.send = originalSend;
  }
});

test("inspection rejects a known oversize or wrong-MIME HEAD without GET", async () => {
  for (const head of [{ ContentLength: 4, ContentType: "image/png" }, { ContentLength: 3, ContentType: "text/plain" }]) {
    let gets = 0;
    const client = { async send(command: { constructor: { name: string } }) {
      if (command.constructor.name === "HeadObjectCommand") return { ...head, ETag: "rejected-version" };
      if (command.constructor.name === "GetObjectCommand") gets += 1;
      return {};
    } };
    const storage = new S3StoragePort(client as never, client as never, "bucket", []);
    await assert.rejects(storage.inspectObject({ objectKey: "asset.png", maxByteSize: 3, expectedMimeType: "image/png" }), StorageObjectInvalidError);
    assert.equal(gets, 0);
  }
});

test("inspection stops a size-lying stream before further reads and closes it", async () => {
  let reads = 0;
  let destroyed = false;
  const body = { async *[Symbol.asyncIterator]() { reads += 1; yield new Uint8Array(4); reads += 1; yield new Uint8Array(4); }, destroy() { destroyed = true; } };
  const client = { async send(command: { constructor: { name: string }; input?: Record<string, unknown> }) {
    if (command.constructor.name === "HeadObjectCommand") return { ContentLength: 3, ContentType: "image/png", ETag: "rejected-version" };
    if (command.constructor.name === "GetObjectCommand") {
      assert.equal(command.input?.IfMatch, "rejected-version");
      return { Body: body, ContentType: "image/png" };
    }
    return {};
  } };
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);
  await assert.rejects(storage.inspectObject({ objectKey: "asset.png", maxByteSize: 3 }), StorageObjectInvalidError);
  assert.equal(reads, 1);
  assert.equal(destroyed, true);
});

test("inspection deadlines abort stalled metadata and stalled streams", async () => {
  for (const stallAt of ["HEAD", "BODY"]) {
    let destroyed = false;
    let signal: AbortSignal | undefined;
    const body = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined) }; }, destroy() { destroyed = true; } };
    const client = { async send(command: { constructor: { name: string } }, options?: { abortSignal?: AbortSignal }) {
      if (command.constructor.name === "HeadObjectCommand") {
        signal = options?.abortSignal;
        if (stallAt === "HEAD") return new Promise(() => undefined);
        return { ContentLength: 3, ContentType: "image/png" };
      }
      if (command.constructor.name === "GetObjectCommand") return { Body: body, ContentType: "image/png" };
      return {};
    } };
    const storage = new S3StoragePort(client as never, client as never, "bucket", []);
    await assert.rejects(storage.inspectObject({ objectKey: "asset.png", maxByteSize: 3, timeoutMs: 15 }), StorageUnavailableError);
    assert.equal(signal?.aborted, true);
    assert.equal(destroyed, stallAt === "BODY");
  }
});

test("oversize inspection does not wait for a stalled iterator cleanup", { timeout: 1_000 }, async () => {
  let returned = false;
  const body = { [Symbol.asyncIterator]() { return {
    next: async () => ({ done: false as const, value: new Uint8Array(4) }),
    return: () => { returned = true; return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
  }; } };
  const client = { async send(command: { constructor: { name: string } }) {
    if (command.constructor.name === "HeadObjectCommand") return { ContentType: "image/png" };
    if (command.constructor.name === "GetObjectCommand") return { Body: body, ContentType: "image/png" };
    return {};
  } };
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);
  await assert.rejects(storage.inspectObject({ objectKey: "asset.png", maxByteSize: 3 }), StorageObjectInvalidError);
  assert.equal(returned, true);
});

test("inspection returns measured bytes and rejects inconsistent metadata lengths", async () => {
  for (const declared of [undefined, 99]) {
    const client = { async send(command: { constructor: { name: string } }) {
      if (command.constructor.name === "HeadObjectCommand") return { ContentLength: declared, ContentType: "image/png" };
      if (command.constructor.name === "GetObjectCommand") return { Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1, 2, 3]); } } };
      return {};
    } };
    const storage = new S3StoragePort(client as never, client as never, "bucket", []);
    if (declared === undefined) assert.equal((await storage.inspectObject({ objectKey: "asset.png", maxByteSize: 3 }))?.byteSize, 3);
    else await assert.rejects(storage.inspectObject({ objectKey: "asset.png" }), StorageUnavailableError);
  }
});

test("S3 metadata inspection for relay HEAD does not download or hash the object", async () => {
  const calls: Array<{ name: string; signal?: AbortSignal }> = [];
  const client = {
    async send(command: { constructor: { name: string } }, options?: { abortSignal?: AbortSignal }) {
      calls.push({ name: command.constructor.name, signal: options?.abortSignal });
      if (command.constructor.name === "HeadObjectCommand") return { ContentType: "image/png", ContentLength: 18 };
      if (command.constructor.name === "GetObjectCommand") throw new Error("provider-input HEAD must not issue GetObject");
      return {};
    },
  };
  const controller = new AbortController();
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);

  assert.deepEqual(
    await storage.inspectObjectMetadata({ objectKey: "asset.png", signal: controller.signal }),
    { mimeType: "image/png", byteSize: 18 },
  );
  assert.deepEqual(
    calls.filter(({ name }) => name === "HeadObjectCommand" || name === "GetObjectCommand"),
    [{ name: "HeadObjectCommand", signal: controller.signal }],
  );
});

test("S3 object reads forward analysis cancellation and memory reads reject aborted callers", async () => {
  const controller = new AbortController();
  let readSignal: AbortSignal | undefined;
  const client = { async send(command: { constructor: { name: string } }, options?: { abortSignal?: AbortSignal }) {
    if (command.constructor.name === "GetObjectCommand") {
      readSignal = options?.abortSignal;
      return { Body: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); } }, ContentType: "image/png" };
    }
    return {};
  } };
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);
  const result = await storage.readObject({ objectKey: "asset.png", signal: controller.signal });
  assert.equal(readSignal, controller.signal);
  await result?.stream.cancel();
  controller.abort();
  await assert.rejects(createInMemoryStoragePort().readObject({ objectKey: "asset.png", signal: controller.signal }), StorageUnavailableError);
});

test("already-aborted inspection does not start storage requests", async () => {
  let calls = 0;
  const client = { async send() { calls += 1; return {}; } };
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(storage.inspectObject({ objectKey: "asset.png", signal: controller.signal }), StorageUnavailableError);
  assert.equal(calls, 0);
});

test("S3 inspection destroys an unreadable body after a failed hash read", async () => {
  let destroyed = false;
  const body = {
    async *[Symbol.asyncIterator]() {
      yield new Uint8Array([1]);
      throw new Error("body read failed");
    },
    destroy() { destroyed = true; },
  };
  const client = {
    async send(command: { constructor: { name: string } }) {
      if (command.constructor.name === "HeadObjectCommand") return { ContentType: "image/png", ContentLength: 1 };
      if (command.constructor.name === "GetObjectCommand") return { Body: body, ContentType: "image/png" };
      return {};
    },
  };
  const storage = new S3StoragePort(client as never, client as never, "bucket", []);

  await assert.rejects(() => storage.inspectObject({ objectKey: "asset.png" }), StorageUnavailableError);
  assert.equal(destroyed, true);
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

  const upload = await storage.createUploadUrl({ objectKey, mimeType: "image/png", byteSize: bytes.byteLength });
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

test("in-memory inspection enforces reservation bounds without deleting objects", async () => {
  const storage = createInMemoryStoragePort();
  await storage.putObject({ objectKey: "asset.png", mimeType: "image/png", bytes: new Uint8Array(4) });
  await assert.rejects(storage.inspectObject({ objectKey: "asset.png", maxByteSize: 3 }), (error: unknown) => {
    if (!(error instanceof StorageObjectInvalidError)) return false;
    return error.reason === "SIZE";
  });
  assert.equal((await storage.readObject({ objectKey: "asset.png" }))?.byteSize, 4);
  await storage.putObject({ objectKey: "asset.png", mimeType: "image/png", bytes: new Uint8Array(3) });
  assert.equal((await storage.inspectObject({ objectKey: "asset.png" }))?.byteSize, 3);
  await assert.rejects(storage.inspectObject({ objectKey: "asset.png", expectedMimeType: "text/plain" }), StorageObjectInvalidError);
});
