import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Client } from "pg";

import { createPrefixedId } from "@alchemy-video/domain";

import { createDatabase } from "../src/db.js";
import { DrizzleDocumentKnowledgeRepository } from "../src/drizzle-document-knowledge-repository.js";

const databaseUrl = process.env.DATABASE_URL;

test("Drizzle DocumentKnowledgeRepository persists conversion/SHA facts, recovers retries, and enforces workspace scope", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;

  const database = createDatabase(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const otherWorkspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const sourceAssetId = createPrefixedId("ast");
  const markdownAssetId = createPrefixedId("ast");
  const documentId = createPrefixedId("doc");
  const conversionId = createPrefixedId("dcv");
  const knowledgeRevisionId = createPrefixedId("dkr");
  const secondMarkdownAssetId = createPrefixedId("ast");
  const secondConversionId = createPrefixedId("dcv");
  const secondKnowledgeRevisionId = createPrefixedId("dkr");
  const sourceBytes = Buffer.from(`# C11.2 fixture ${suffix}\n\n品牌资料标记：后半段事实仍可追溯。`, "utf8");
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const markdownBytes = Buffer.from("# 已转换资料\n\n品牌资料标记：后半段事实仍可追溯。", "utf8");
  const markdownSha256 = createHash("sha256").update(markdownBytes).digest("hex");

  const event = (label: string) => ({
    eventId: createPrefixedId("evt"),
    messageId: createPrefixedId("msg"),
    traceId: createPrefixedId("trc"),
    correlationId: `${label}-${createPrefixedId("cor")}`,
  });

  try {
    await client.connect();
    await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [userId, `C11.2 ${suffix}`]);
    await client.query("INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3), ($4, $5, $3)", [workspaceId, `C11.2 ${suffix}`, userId, otherWorkspaceId, `C11.2 other ${suffix}`]);
    await client.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)", [projectId, workspaceId, `C11.2 project ${suffix}`]);
    await client.query(
      `INSERT INTO assets (id, workspace_id, project_id, kind, origin, status, object_key, sha256, mime_type, byte_size)
       VALUES ($1, $2, $3, 'DOCUMENT', 'USER_UPLOAD', 'READY', $4, $5, 'text/markdown', $6),
              ($7, $2, $3, 'DOCUMENT', 'DERIVED', 'READY', $8, $9, 'text/markdown', $10),
              ($11, $2, $3, 'DOCUMENT', 'DERIVED', 'READY', $12, $9, 'text/markdown', $10)`,
      [sourceAssetId, workspaceId, projectId, `${workspaceId}/${projectId}/${sourceAssetId}/source.md`, sourceSha256, sourceBytes.byteLength, markdownAssetId, `${workspaceId}/${projectId}/${markdownAssetId}/converted.md`, markdownSha256, markdownBytes.byteLength, secondMarkdownAssetId, `${workspaceId}/${projectId}/${secondMarkdownAssetId}/converted-2.md`],
    );
    await client.query("INSERT INTO documents (id, workspace_id, project_id, source_asset_id) VALUES ($1, $2, $3, $4)", [documentId, workspaceId, projectId, sourceAssetId]);
    await client.query(
      `INSERT INTO document_conversions (id, workspace_id, project_id, document_id, source_asset_id, source_sha256, source_mime_type, source_filename, source_byte_size, status, markdown_asset_id, converter, converter_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'text/markdown', 'source.md', $7, 'SUCCEEDED', $8, 'fixture', 'c11.2-test'),
              ($9, $2, $3, $4, $5, $6, 'text/markdown', 'source.md', $7, 'SUCCEEDED', $10, 'fixture', 'c11.2-test')`,
      [conversionId, workspaceId, projectId, documentId, sourceAssetId, sourceSha256, sourceBytes.byteLength, markdownAssetId, secondConversionId, secondMarkdownAssetId],
    );

    const repository = new DrizzleDocumentKnowledgeRepository(database.db);
    const created = await repository.createKnowledgeRevision({
      scope: `c11.2:${suffix}:create`, idempotencyKey: "create", requestHash: "a".repeat(64),
      workspaceId, projectId, knowledgeRevisionId, documentId, conversionId, markdownAssetId, markdownSha256,
      analyzerVersion: "deterministic-document-understanding-v1", event: event("create"),
    });
    assert.equal(created.kind, "NEW");
    if (created.kind !== "NEW") return;
    assert.equal((await repository.createKnowledgeRevision({
      scope: `c11.2:${suffix}:create`, idempotencyKey: "create", requestHash: "a".repeat(64),
      workspaceId, projectId, knowledgeRevisionId, documentId, conversionId, markdownAssetId, markdownSha256,
      analyzerVersion: "deterministic-document-understanding-v1", event: event("replay"),
    })).kind, "REPLAY");
    assert.equal((await repository.createKnowledgeRevision({
      scope: `c11.2:${suffix}:create`, idempotencyKey: "create", requestHash: "b".repeat(64),
      workspaceId, projectId, knowledgeRevisionId, documentId, conversionId, markdownAssetId, markdownSha256,
      analyzerVersion: "deterministic-document-understanding-v1", event: event("conflict"),
    })).kind, "CONFLICT");
    assert.equal(await repository.findKnowledgeRevision(otherWorkspaceId, knowledgeRevisionId), undefined);
    assert.equal((await repository.listSections(otherWorkspaceId, knowledgeRevisionId)).length, 0);

    const running = await repository.startKnowledgeRevision({ workspaceId, knowledgeRevisionId, event: event("started") });
    assert.equal(running?.status, "RUNNING");
    assert.ok((await repository.listRecoverableKnowledgeRevisions({ limit: 10 })).some((revision) => revision.id === knowledgeRevisionId && revision.status === "RUNNING"));
    const ready = await repository.completeKnowledgeRevision({
      workspaceId, knowledgeRevisionId, analysisQuality: "COMPLETE",
      sections: [{ id: createPrefixedId("dks"), sequence: 1, heading: "后半段事实", locator: "第 1 节：后半段事实", evidenceKind: "TEXT", contentHash: "c".repeat(64) }],
      facts: [{ id: createPrefixedId("dft"), sectionSequence: 1, category: "BRAND", statement: "品牌资料标记：后半段事实仍可追溯。", confidence: "EXPLICIT", statementHash: "d".repeat(64) }],
      event: event("succeeded"),
    });
    assert.equal(ready?.status, "READY");
    assert.equal((await repository.listSections(workspaceId, knowledgeRevisionId)).length, 1);
    assert.equal((await repository.listFacts(workspaceId, knowledgeRevisionId)).length, 1);
    assert.equal(await repository.completeKnowledgeRevision({
      workspaceId, knowledgeRevisionId, analysisQuality: "COMPLETE", sections: [], facts: [], event: event("overwrite"),
    }), undefined, "READY knowledge revision was overwritten by a second completion");

    const failed = await repository.createKnowledgeRevision({
      scope: `c11.2:${suffix}:retry`, idempotencyKey: "retry", requestHash: "e".repeat(64),
      workspaceId, projectId, knowledgeRevisionId: secondKnowledgeRevisionId, documentId, conversionId: secondConversionId, markdownAssetId: secondMarkdownAssetId, markdownSha256,
      analyzerVersion: "deterministic-document-understanding-v1", event: event("retry-create"),
    });
    assert.equal(failed.kind, "NEW");
    assert.equal((await repository.failKnowledgeRevision({ workspaceId, knowledgeRevisionId: secondKnowledgeRevisionId, retryable: true, errorCode: "DOCUMENT_KNOWLEDGE_INVALID", event: event("failed") }))?.status, "FAILED");
    const retried = await repository.retryKnowledgeRevision({ scope: `c11.2:${suffix}:retry`, idempotencyKey: "retry-again", requestHash: "f".repeat(64), workspaceId, projectId, knowledgeRevisionId: secondKnowledgeRevisionId, event: event("retry") });
    assert.equal(retried.kind, "NEW");
    if (retried.kind === "NEW") assert.equal(retried.value.status, "QUEUED");
    assert.ok((await repository.listRecoverableKnowledgeRevisions({ limit: 10 })).some((revision) => revision.id === secondKnowledgeRevisionId && revision.status === "QUEUED"));

    const invalidSha = await repository.createKnowledgeRevision({
      scope: `c11.2:${suffix}:invalid`, idempotencyKey: "invalid", requestHash: "1".repeat(64),
      workspaceId, projectId, knowledgeRevisionId: createPrefixedId("dkr"), documentId, conversionId, markdownAssetId, markdownSha256: "0".repeat(64),
      analyzerVersion: "deterministic-document-understanding-v1", event: event("invalid"),
    });
    assert.equal(invalidSha.kind, "INVALID_SOURCE");

    const persistedEvents = await client.query("SELECT event_type FROM outbox_events WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY occurred_at", [workspaceId, knowledgeRevisionId]);
    assert.deepEqual(persistedEvents.rows.map((row) => row.event_type), ["document_knowledge.queued", "document_knowledge.started", "document_knowledge.succeeded"]);
  } finally {
    await database.close();
    await client.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [[workspaceId, otherWorkspaceId]]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.end();
  }
});
