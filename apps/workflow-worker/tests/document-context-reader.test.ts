import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InMemoryStoragePort, type StoragePort } from "@alchemy-video/storage-client";

import {
  BoundedDocumentContextReader,
  DocumentContextReadError,
} from "../src/document-context-reader.js";

const markdownBytes = (content: string) => new TextEncoder().encode(content);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const documentFailure = (code: DocumentContextReadError["code"]) =>
  (error: unknown) => error instanceof DocumentContextReadError && error.code === code;

const context = (bytes: Uint8Array) => ({
  documentId: "doc_story",
  conversionId: "dcv_story",
  sourceAssetId: "ast_document",
  markdownAssetId: "ast_markdown",
  markdownSha256: sha256(bytes),
  markdownObjectKey: "ws_story/prj_story/ast_markdown/document.md",
  sequence: 1,
  maxContentCharacters: 5_000,
});

test("BoundedDocumentContextReader keeps only the frozen Markdown budget", async () => {
  const storage = new InMemoryStoragePort();
  const bytes = markdownBytes("甲".repeat(7_000));
  await storage.putObject({
    objectKey: context(bytes).markdownObjectKey,
    mimeType: "text/markdown",
    bytes,
  });
  const contexts = await new BoundedDocumentContextReader(storage).read([context(bytes)]);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.content.length, 5_000);
  assert.equal(contexts[0]?.markdownAssetId, "ast_markdown");
  assert.equal(contexts[0]?.markdownSha256, context(bytes).markdownSha256);
});

test("BoundedDocumentContextReader truncates without splitting a UTF-16 pair and releases the stream lock", async () => {
  const bytes = markdownBytes("abcd😀tail");
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); },
    cancel() { cancelled = true; },
  });
  const storage: StoragePort = {
    async inspectObject() {
      return { mimeType: "text/markdown", byteSize: bytes.byteLength, sha256: sha256(bytes) };
    },
    async readObject() {
      return { mimeType: "text/markdown", byteSize: bytes.byteLength, stream };
    },
    async createUploadUrl() { throw new Error("not used"); },
    async putObject() { throw new Error("not used"); },
    async createDownloadUrl() { throw new Error("not used"); },
  };

  const [result] = await new BoundedDocumentContextReader(storage).read([
    { ...context(bytes), maxContentCharacters: 5 },
  ]);
  assert.equal(result?.content, "abcd");
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("BoundedDocumentContextReader rejects missing or non-Markdown frozen objects", async () => {
  const storage = new InMemoryStoragePort();
  const bytes = markdownBytes("not markdown");
  await storage.putObject({
    objectKey: context(bytes).markdownObjectKey,
    mimeType: "text/plain",
    bytes,
  });
  await assert.rejects(
    () => new BoundedDocumentContextReader(storage).read([context(bytes)]),
    documentFailure("DOCUMENT_CONTEXT_OBJECT_INVALID"),
  );
});

test("BoundedDocumentContextReader rejects a Markdown object whose frozen SHA-256 no longer matches", async () => {
  const storage = new InMemoryStoragePort();
  const frozenBytes = markdownBytes("品牌承诺：准时交付。");
  await storage.putObject({
    objectKey: context(frozenBytes).markdownObjectKey,
    mimeType: "text/markdown",
    bytes: markdownBytes("被替换的资料内容。"),
  });
  await assert.rejects(
    () => new BoundedDocumentContextReader(storage).read([context(frozenBytes)]),
    documentFailure("DOCUMENT_CONTEXT_OBJECT_INVALID"),
  );
});

test("BoundedDocumentContextReader rejects invalid frozen budgets before reading storage", async () => {
  const storage = new InMemoryStoragePort();
  const bytes = markdownBytes("品牌资料");
  await assert.rejects(
    () => new BoundedDocumentContextReader(storage).read([{ ...context(bytes), maxContentCharacters: 5_001 }]),
    documentFailure("DOCUMENT_CONTEXT_REFERENCE_INVALID"),
  );
});

test("BoundedDocumentContextReader classifies invalid UTF-8 and empty Markdown as deterministic failures", async () => {
  const invalidUtf8Storage = new InMemoryStoragePort();
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  await invalidUtf8Storage.putObject({
    objectKey: context(invalidUtf8).markdownObjectKey,
    mimeType: "text/markdown",
    bytes: invalidUtf8,
  });
  await assert.rejects(
    () => new BoundedDocumentContextReader(invalidUtf8Storage).read([context(invalidUtf8)]),
    documentFailure("DOCUMENT_CONTEXT_ENCODING_INVALID"),
  );

  const emptyStorage = new InMemoryStoragePort();
  const empty = markdownBytes("   \n\t  ");
  await emptyStorage.putObject({
    objectKey: context(empty).markdownObjectKey,
    mimeType: "text/markdown",
    bytes: empty,
  });
  await assert.rejects(
    () => new BoundedDocumentContextReader(emptyStorage).read([context(empty)]),
    documentFailure("DOCUMENT_CONTEXT_EMPTY"),
  );
});
