import assert from "node:assert/strict";
import test from "node:test";

import { StructuralDocumentIndexAdapter, STRUCTURAL_DOCUMENT_INDEX_VERSION } from "@alchemy-video/document-intelligence";
import { InMemoryDocumentKnowledgeStore } from "@alchemy-video/persistence";
import { DocumentKnowledgeExecutor } from "../src/knowledge-execution-service.js";

const streamFor = (value: string) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } });

const analyzer = new StructuralDocumentIndexAdapter();

test("knowledge worker indexes frozen document structure without manufacturing semantic facts", async () => {
  const store = new InMemoryDocumentKnowledgeStore();
  const ids = { workspaceId: "ws_docs", projectId: "prj_docs", documentId: "doc_abc", conversionId: "dcv_abc", markdownAssetId: "ast_md", markdownSha256: "a".repeat(64) };
  store.seedConversion({ ...ids, status: "SUCCEEDED" });
  await store.createKnowledgeRevision({ ...ids, knowledgeRevisionId: "dkr_abc", analyzerVersion: STRUCTURAL_DOCUMENT_INDEX_VERSION, scope: "seed", idempotencyKey: "seed", requestHash: "b".repeat(64), event: { eventId: "evt_abc", messageId: "msg_abc", traceId: "trc_abc", correlationId: "cor_abc" } });
  const executor = new DocumentKnowledgeExecutor(store, async () => ({ stream: streamFor("# 前段\n品牌定位清晰。\n\n# 后段\n距高铁站 18 公里，提供全天候温泉服务。"), markdownSha256: ids.markdownSha256 }), analyzer);
  const result = await executor.execute({ workspaceId: ids.workspaceId, knowledgeRevisionId: "dkr_abc" });
  assert.equal(result?.status, "READY");
  assert.equal(store.listFacts(ids.workspaceId, "dkr_abc").length, 0);
  assert.deepEqual(store.listSections(ids.workspaceId, "dkr_abc").map((section) => section.heading), ["前段", "后段"]);
  const replay = await executor.execute({ workspaceId: ids.workspaceId, knowledgeRevisionId: "dkr_abc" });
  assert.equal(replay?.status, "READY");
  assert.equal(store.listSections(ids.workspaceId, "dkr_abc").length, 2);
});

test("knowledge worker recovery resumes structural indexing after restart", async () => {
  const store = new InMemoryDocumentKnowledgeStore();
  const base = { workspaceId: "ws_recovery", projectId: "prj_recovery", documentId: "doc_recovery", markdownAssetId: "ast_recovery", markdownSha256: "c".repeat(64) };
  store.seedConversion({ ...base, conversionId: "dcv_recovery", status: "SUCCEEDED" });
  await store.createKnowledgeRevision({ ...base, conversionId: "dcv_recovery", knowledgeRevisionId: "dkr_recovery", analyzerVersion: STRUCTURAL_DOCUMENT_INDEX_VERSION, scope: "recovery", idempotencyKey: "recovery", requestHash: "d".repeat(64), event: { eventId: "evt_recovery", messageId: "msg_recovery", traceId: "trc_recovery", correlationId: "cor_recovery" } });
  const running = await store.startKnowledgeRevision({ workspaceId: base.workspaceId, knowledgeRevisionId: "dkr_recovery" });
  assert.equal(running?.status, "RUNNING");
  const executor = new DocumentKnowledgeExecutor(store, async () => ({ stream: streamFor("# 恢复段\n恢复后仍可索引原文结构。"), markdownSha256: base.markdownSha256 }), analyzer);
  const recovered = await executor.recover({ limit: 10 });
  assert.equal(recovered[0]?.status, "READY");
  assert.equal(store.listFacts(base.workspaceId, "dkr_recovery").length, 0);
  assert.equal(store.listSections(base.workspaceId, "dkr_recovery").length, 1);
  assert.equal(store.listRecoverableKnowledgeRevisions({ limit: 10 }).length, 0);
});
