import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InMemoryStoragePort } from "@alchemy-video/storage-client";

import { BoundedDocumentContextReader } from "../src/document-context-reader.js";

const markdownBytes = (content: string) => new TextEncoder().encode(content);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

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
});

test("BoundedDocumentContextReader rejects missing or non-Markdown frozen objects", async () => {
  const storage = new InMemoryStoragePort();
  const bytes = markdownBytes("not markdown");
  await storage.putObject({
    objectKey: context(bytes).markdownObjectKey,
    mimeType: "text/plain",
    bytes,
  });
  await assert.rejects(() => new BoundedDocumentContextReader(storage).read([context(bytes)]), /Frozen Markdown context is unavailable/);
});

test("BoundedDocumentContextReader rejects a Markdown object whose frozen SHA-256 no longer matches", async () => {
  const storage = new InMemoryStoragePort();
  const frozenBytes = markdownBytes("品牌承诺：准时交付。");
  await storage.putObject({
    objectKey: context(frozenBytes).markdownObjectKey,
    mimeType: "text/markdown",
    bytes: markdownBytes("被替换的资料内容。"),
  });
  await assert.rejects(() => new BoundedDocumentContextReader(storage).read([context(frozenBytes)]), /Frozen Markdown context is unavailable/);
});

test("BoundedDocumentContextReader rejects invalid frozen budgets before reading storage", async () => {
  const storage = new InMemoryStoragePort();
  const bytes = markdownBytes("品牌资料");
  await assert.rejects(
    () => new BoundedDocumentContextReader(storage).read([{ ...context(bytes), maxContentCharacters: 5_001 }]),
    /Frozen Markdown context reference is invalid/,
  );
});
