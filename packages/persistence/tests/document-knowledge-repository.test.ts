import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDocumentConversionStore } from "../src/document-conversion-repository.js";
import { InMemoryDocumentKnowledgeStore } from "../src/document-knowledge-repository.js";

const base = {
  scope: "usr_dev_owner:/api/v1/projects/prj_docs/document-knowledge",
  idempotencyKey: "idem-1",
  requestHash: "a".repeat(64),
  workspaceId: "ws_docs",
  projectId: "prj_docs",
  knowledgeRevisionId: "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  documentId: "doc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  conversionId: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  markdownAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  markdownSha256: "b".repeat(64),
  analyzerVersion: "deterministic-document-understanding-v1",
  event: { eventId: "evt_knowledge", messageId: "msg_knowledge", traceId: "trace_knowledge", correlationId: "cor_knowledge" },
};

test("knowledge repository is workspace scoped, idempotent and persists immutable facts", async () => {
  const events: string[] = [];
  const store = new InMemoryDocumentKnowledgeStore((event) => events.push(event.eventType));
  store.seedConversion({ workspaceId: "ws_docs", projectId: "prj_docs", documentId: base.documentId, conversionId: base.conversionId, markdownAssetId: base.markdownAssetId, markdownSha256: base.markdownSha256, status: "SUCCEEDED" });
  const created = await store.createKnowledgeRevision(base);
  assert.equal(created.kind, "NEW");
  const replay = await store.createKnowledgeRevision(base);
  assert.equal(replay.kind, "REPLAY");
  assert.deepEqual(await store.createKnowledgeRevision({ ...base, requestHash: "c".repeat(64) }), { kind: "CONFLICT" });

  assert.equal(store.startKnowledgeRevision({ workspaceId: "ws_other", knowledgeRevisionId: base.knowledgeRevisionId }), undefined);
  assert.ok(store.startKnowledgeRevision({ workspaceId: "ws_docs", knowledgeRevisionId: base.knowledgeRevisionId }));
  const ready = store.completeKnowledgeRevision({
    workspaceId: "ws_docs",
    knowledgeRevisionId: base.knowledgeRevisionId,
    analysisQuality: "COMPLETE",
    sections: [{ id: "dks_01J4N8QZ8PCW2N2G6D2XJXJXJX", sequence: 1, heading: "卖点", locator: "第 1 节：卖点", evidenceKind: "TEXT", contentHash: "d".repeat(64) }],
    facts: [{ id: "dft_01J4N8QZ8PCW2N2G6D2XJXJXJX", sectionSequence: 1, category: "SELLING_POINT", statement: "距高铁站 18 公里。", confidence: "EXPLICIT", statementHash: "e".repeat(64) }],
  });
  assert.equal(ready?.status, "READY");
  assert.equal(store.listFacts("ws_other", base.knowledgeRevisionId).length, 0);
  assert.deepEqual(events, ["document_knowledge.queued", "document_knowledge.started", "document_knowledge.succeeded"]);
});

test("failed knowledge revision retries without overwriting the previous result", async () => {
  const store = new InMemoryDocumentKnowledgeStore();
  store.seedConversion({ workspaceId: "ws_docs", projectId: "prj_docs", documentId: base.documentId, conversionId: base.conversionId, markdownAssetId: base.markdownAssetId, markdownSha256: base.markdownSha256, status: "SUCCEEDED" });
  const created = await store.createKnowledgeRevision({ ...base, knowledgeRevisionId: "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJY", scope: "scope-2", idempotencyKey: "idem-2", requestHash: "f".repeat(64) });
  assert.equal(created.kind, "NEW");
  const id = "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJY";
  store.startKnowledgeRevision({ workspaceId: "ws_docs", knowledgeRevisionId: id });
  assert.equal(store.failKnowledgeRevision({ workspaceId: "ws_docs", knowledgeRevisionId: id, retryable: true })?.status, "FAILED");
  assert.equal((await store.retryKnowledgeRevision({ ...base, knowledgeRevisionId: id, scope: "retry-2", idempotencyKey: "idem-retry", requestHash: "1".repeat(64) })).kind, "NEW");
  assert.equal(store.findKnowledgeRevision("ws_docs", id)?.status, "QUEUED");
});

test("in-memory conversion bridge runs only after a successful Markdown completion", async () => {
  const completed: Array<{ conversionId: string; markdownAssetId: string; markdownSha256: string }> = [];
  const conversionStore = new InMemoryDocumentConversionStore({
    findAsset: async () => ({
      id: "ast_source",
      workspaceId: "ws_docs",
      projectId: "prj_docs",
      kind: "DOCUMENT",
      origin: "USER_UPLOAD",
      status: "READY",
      objectKey: "ws_docs/prj_docs/ast_source",
      mimeType: "text/markdown",
      byteSize: 20,
      sha256: "a".repeat(64),
      metadata: { filename: "brief.md" },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    }),
  }, (input) => {
    completed.push({ conversionId: input.conversionId, markdownAssetId: input.markdownAssetId, markdownSha256: input.markdownSha256 });
  });
  const conversionId = "dcv_01J4N8QZ8PCW2N2G6D2XJXJXZ";
  const created = await conversionStore.createDocumentConversion({
    scope: "conversion-bridge",
    idempotencyKey: "create",
    requestHash: "b".repeat(64),
    workspaceId: "ws_docs",
    projectId: "prj_docs",
    sourceAssetId: "ast_source",
    documentId: "doc_01J4N8QZ8PCW2N2G6D2XJXJXZ",
    conversionId,
    event: { eventId: "evt_conversion", messageId: "msg_conversion", traceId: "trc_conversion", correlationId: "cor_conversion" },
  });
  assert.equal(created.kind, "NEW");
  assert.equal(completed.length, 0);
  assert.ok(await conversionStore.startDocumentConversion({
    workspaceId: "ws_docs",
    conversionId,
    event: { eventId: "evt_start", messageId: "msg_start", traceId: "trc_start", correlationId: "cor_start" },
  }));
  assert.equal(completed.length, 0);
  await conversionStore.completeDocumentConversion({
    workspaceId: "ws_docs",
    conversionId,
    attemptNo: 1,
    markdownAssetId: "ast_markdown",
    markdownObjectKey: "ws_docs/prj_docs/ast_markdown",
    markdownBytes: 32,
    markdownSha256: "c".repeat(64),
    converter: "markitdown",
    converterVersion: "1.0.0",
    warnings: [],
    event: { eventId: "evt_complete", messageId: "msg_complete", traceId: "trc_complete", correlationId: "cor_complete" },
  });
  assert.deepEqual(completed, [{ conversionId, markdownAssetId: "ast_markdown", markdownSha256: "c".repeat(64) }]);
});
