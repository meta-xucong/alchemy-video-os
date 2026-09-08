import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDocumentKnowledgeStore } from "@alchemy-video/persistence";
import { createPrefixedId } from "@alchemy-video/domain";

import { createApp } from "../src/app.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;
const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });

test("C11.2 knowledge detail and retry routes expose only safe facts", async () => {
  const knowledgeStore = new InMemoryDocumentKnowledgeStore();
  const controlStore = createInMemoryControlPlaneStore();
  const app = createApp({ store: controlStore, assetStore: createInMemoryAssetWorkspaceStore(controlStore), documentKnowledgeStore: knowledgeStore });
  const projectResponse = await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "knowledge-project" },
    body: JSON.stringify({ name: "Knowledge routes" }),
  });
  const project = (await readJson(projectResponse)).data;
  const revisionId = "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const documentId = "doc_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const conversionId = "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  knowledgeStore.seedConversion({ workspaceId: "ws_dev_default", projectId: project.id, documentId, conversionId, markdownAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX", markdownSha256: "a".repeat(64), status: "SUCCEEDED" });
  await knowledgeStore.createKnowledgeRevision({ scope: "seed", idempotencyKey: "seed", requestHash: "b".repeat(64), workspaceId: "ws_dev_default", projectId: project.id, knowledgeRevisionId: revisionId, documentId, conversionId, markdownAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX", markdownSha256: "a".repeat(64), analyzerVersion: "deterministic-document-understanding-v1", event: event() });
  knowledgeStore.startKnowledgeRevision({ workspaceId: "ws_dev_default", knowledgeRevisionId: revisionId });
  knowledgeStore.failKnowledgeRevision({ workspaceId: "ws_dev_default", knowledgeRevisionId: revisionId, retryable: true });

  const detail = await readJson(await app.request(`http://localhost/api/v1/document-knowledge-revisions/${revisionId}`));
  assert.equal(detail.data.revision.status, "FAILED");
  for (const privateField of ["markdown_sha256", "analyzer_version", "object_key", "statement_hash"]) assert.equal(JSON.stringify(detail).includes(privateField), false);
  const retry = await app.request(`http://localhost/api/v1/document-knowledge-revisions/${revisionId}/retry`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "knowledge-retry" }, body: "{}" });
  assert.equal(retry.status, 202);
  assert.equal((await readJson(retry)).data.status, "QUEUED");
});

test("C11.2 document list projects safe understanding readiness without storage fields", async () => {
  const knowledgeStore = new InMemoryDocumentKnowledgeStore();
  const controlStore = createInMemoryControlPlaneStore();
  const projectResponse = await createApp({ store: controlStore }).request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "knowledge-list-project" },
    body: JSON.stringify({ name: "Knowledge list" }),
  });
  const project = (await readJson(projectResponse)).data;
  const assetStore = createInMemoryAssetWorkspaceStore(controlStore);
  const revisionId = "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJY";
  const documentId = "doc_01J4N8QZ8PCW2N2G6D2XJXJXJY";
  const conversionId = "dcv_01J4N8QZ8PCW2N2G6D2XJXJY";
  const markdownAssetId = "ast_01J4N8QZ8PCW2N2G6D2XJXJY";
  knowledgeStore.seedConversion({ workspaceId: "ws_dev_default", projectId: project.id, documentId, conversionId, markdownAssetId, markdownSha256: "c".repeat(64), status: "SUCCEEDED" });
  await knowledgeStore.createKnowledgeRevision({ scope: "list-seed", idempotencyKey: "list-seed", requestHash: "d".repeat(64), workspaceId: "ws_dev_default", projectId: project.id, knowledgeRevisionId: revisionId, documentId, conversionId, markdownAssetId, markdownSha256: "c".repeat(64), analyzerVersion: "deterministic-document-understanding-v1", event: event() });
  knowledgeStore.startKnowledgeRevision({ workspaceId: "ws_dev_default", knowledgeRevisionId: revisionId });
  knowledgeStore.completeKnowledgeRevision({
    workspaceId: "ws_dev_default",
    knowledgeRevisionId: revisionId,
    analysisQuality: "PARTIAL",
    sections: [{ id: "dks_01J4N8QZ8PCW2N2G6D2XJXJY", sequence: 1, heading: "项目概览", locator: "第 1 页", evidenceKind: "VISUAL_UNAVAILABLE", contentHash: "e".repeat(64) }],
    facts: [{ id: "dft_01J4N8QZ8PCW2N2G6D2XJXJY", sectionSequence: 1, category: "SELLING_POINT", statement: "可定位的卖点", confidence: "NEEDS_CONFIRMATION", statementHash: "f".repeat(64) }],
  });
  const conversion = {
    id: conversionId,
    documentId,
    workspaceId: "ws_dev_default",
    projectId: project.id,
    sourceAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJZ",
    status: "SUCCEEDED",
    retryable: false,
    markdownAssetId,
    warnings: [],
    attemptCount: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    sourceSha256: "a".repeat(64),
    sourceMimeType: "text/markdown",
    sourceFilename: "brief.md",
    sourceByteSize: 10,
    sourceObjectKey: "private/should-not-leak",
  } as const;
  const documentStore = { listProjectDocumentConversions: async () => [conversion] } as any;
  const app = createApp({ store: controlStore, assetStore, documentStore, documentKnowledgeStore: knowledgeStore });
  const listed = await readJson(await app.request(`http://localhost/api/v1/projects/${project.id}/documents`));
  assert.equal(listed.data[0].understanding.status, "READY");
  assert.equal(listed.data[0].understanding.analysis_quality, "PARTIAL");
  assert.equal(listed.data[0].understanding.fact_count, 1);
  assert.equal(listed.data[0].understanding.has_confirmation, true);
  assert.equal(listed.data[0].understanding.has_visual_gaps, true);
  for (const privateField of ["private/should-not-leak", "source_sha256", "source_object_key", "analyzer_version", "statement_hash"]) assert.equal(JSON.stringify(listed).includes(privateField), false);
});
