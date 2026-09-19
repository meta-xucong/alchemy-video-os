import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import { DrizzleAssetWorkspaceRepository } from "../src/asset-workspace-repository.js";
import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { createDatabase } from "../src/db.js";
import { DrizzleDocumentConversionRepository } from "../src/document-conversion-repository.js";
import { assets, documentConversions, outboxEvents } from "../src/schema.js";

const event = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

test("DocumentConversion persistence serializes transitions, rejects stale completion, and rolls back failed event writes", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `c10-pg-${suffix}`;
  const userA = createPrefixedId("usr");
  const workspaceA = createPrefixedId("ws");
  const projectA = createPrefixedId("prj");
  const userB = createPrefixedId("usr");
  const workspaceB = createPrefixedId("ws");
  const projectB = createPrefixedId("prj");
  const sourceA = createPrefixedId("ast");
  const sourceB = createPrefixedId("ast");
  const documentA = createPrefixedId("doc");
  const conversionA = createPrefixedId("dcv");
  const database = createDatabase(databaseUrl);

  const createSource = async (input: { workspaceId: string; projectId: string; assetId: string; suffix: string }) => {
    const assetsRepository = new DrizzleAssetWorkspaceRepository(database.db);
    const objectKey = `${input.workspaceId}/${input.projectId}/${input.assetId}/source.md`;
    const created = await assetsRepository.createUploadAsset({
      scope: `${scope}:source:${input.suffix}`,
      idempotencyKey: `create-${input.suffix}`,
      requestHash: fingerprintRequest({ filename: `${input.suffix}.md` }),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId: input.assetId,
      kind: "DOCUMENT",
      objectKey,
      filename: `${input.suffix}.md`,
      mimeType: "text/markdown",
      byteSize: 7,
    });
    assert.equal(created.kind, "NEW");
    const confirmed = await assetsRepository.confirmAssetUpload({
      scope: `${scope}:source:${input.suffix}:confirm`,
      idempotencyKey: `confirm-${input.suffix}`,
      requestHash: fingerprintRequest({ sha256: "a".repeat(64), mime_type: "text/markdown", byte_size: 7 }),
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      sha256: "a".repeat(64),
      mimeType: "text/markdown",
      byteSize: 7,
      verifyUpload: async () => true,
    });
    assert.equal(confirmed.kind, "NEW");
    return objectKey;
  };

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userA, displayName: "C10 PostgreSQL A" }, workspace: { id: workspaceA, name: "C10 PostgreSQL A" } });
    await control.ensureDevIdentity({ user: { id: userB, displayName: "C10 PostgreSQL B" }, workspace: { id: workspaceB, name: "C10 PostgreSQL B" } });
    for (const [workspaceId, projectId, name] of [[workspaceA, projectA, "C10 project A"], [workspaceB, projectB, "C10 project B"]] as const) {
      assert.equal((await control.createProject({
        scope: `${scope}:project:${projectId}`,
        idempotencyKey: "create",
        requestHash: fingerprintRequest({ name }),
        workspaceId,
        projectId,
        name,
      })).kind, "NEW");
    }

    const sourceObjectKey = await createSource({ workspaceId: workspaceA, projectId: projectA, assetId: sourceA, suffix: "a" });
    await createSource({ workspaceId: workspaceB, projectId: projectB, assetId: sourceB, suffix: "b" });

    const repository = new DrizzleDocumentConversionRepository(database.db);
    const createEvent = event();
    const createInput = {
      scope: `${scope}:conversion:a`,
      idempotencyKey: "create",
      requestHash: fingerprintRequest({}),
      workspaceId: workspaceA,
      projectId: projectA,
      sourceAssetId: sourceA,
      documentId: documentA,
      conversionId: conversionA,
      event: createEvent,
    };
    const created = await repository.createDocumentConversion(createInput);
    assert.equal(created.kind, "NEW");
    if (created.kind !== "NEW") return;
    assert.equal(created.value.status, "QUEUED");
    assert.equal(created.value.sourceObjectKey, sourceObjectKey);

    const crossWorkspace = await repository.createDocumentConversion({
      ...createInput,
      scope: `${scope}:conversion:cross-workspace`,
      idempotencyKey: "cross-workspace",
      sourceAssetId: sourceB,
      conversionId: createPrefixedId("dcv"),
      documentId: createPrefixedId("doc"),
      event: event(),
    });
    assert.deepEqual(crossWorkspace, { kind: "INVALID_SOURCE" });

    const concurrentStarts = await Promise.all([
      repository.startDocumentConversion({ workspaceId: workspaceA, conversionId: conversionA, event: event() }),
      new DrizzleDocumentConversionRepository(database.db).startDocumentConversion({ workspaceId: workspaceA, conversionId: conversionA, event: event() }),
    ]);
    assert.equal(concurrentStarts.filter(Boolean).length, 1);
    const firstAttempt = concurrentStarts.find(Boolean);
    assert.equal(firstAttempt?.status, "RUNNING");
    assert.equal(firstAttempt?.attemptCount, 1);
    assert.equal((await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceA), eq(outboxEvents.aggregateId, conversionA), eq(outboxEvents.eventType, "document_conversion.started")))).length, 1);

    const failed = await repository.failDocumentConversion({ workspaceId: workspaceA, conversionId: conversionA, attemptNo: 1, code: "DOCUMENT_CONVERSION_FAILED", retryable: true, event: event() });
    assert.equal(failed?.status, "FAILED");

    const retried = await repository.retryDocumentConversion({
      scope: `${scope}:conversion:a:retry`,
      idempotencyKey: "retry",
      requestHash: fingerprintRequest({}),
      workspaceId: workspaceA,
      conversionId: conversionA,
      event: event(),
    });
    assert.equal(retried.kind, "NEW");
    const secondAttempt = await repository.startDocumentConversion({ workspaceId: workspaceA, conversionId: conversionA, event: event() });
    assert.equal(secondAttempt?.attemptCount, 2);

    const staleAsset = createPrefixedId("ast");
    assert.equal(await repository.completeDocumentConversion({
      workspaceId: workspaceA,
      conversionId: conversionA,
      attemptNo: 1,
      markdownAssetId: staleAsset,
      markdownObjectKey: `${workspaceA}/${projectA}/${staleAsset}/result.md`,
      markdownBytes: 8,
      markdownSha256: "b".repeat(64),
      converter: "markitdown",
      converterVersion: "0.1.7",
      warnings: [],
      event: event(),
    }), undefined);
    assert.equal((await database.db.select({ id: assets.id }).from(assets).where(eq(assets.id, staleAsset))).length, 0);

    const resultAsset = createPrefixedId("ast");
    const completed = await repository.completeDocumentConversion({
      workspaceId: workspaceA,
      conversionId: conversionA,
      attemptNo: 2,
      markdownAssetId: resultAsset,
      markdownObjectKey: `${workspaceA}/${projectA}/${resultAsset}/result.md`,
      markdownBytes: 8,
      markdownSha256: "b".repeat(64),
      converter: "markitdown",
      converterVersion: "0.1.7",
      warnings: ["A bounded conversion warning."],
      event: event(),
    });
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(completed?.markdownAssetId, resultAsset);
    assert.equal(completed?.sourceObjectKey, sourceObjectKey);

    const duplicateAsset = createPrefixedId("ast");
    const duplicateCompletion = await repository.completeDocumentConversion({
      workspaceId: workspaceA,
      conversionId: conversionA,
      attemptNo: 2,
      markdownAssetId: duplicateAsset,
      markdownObjectKey: `${workspaceA}/${projectA}/${duplicateAsset}/result.md`,
      markdownBytes: 8,
      markdownSha256: "c".repeat(64),
      converter: "markitdown",
      converterVersion: "0.1.7",
      warnings: [],
      event: event(),
    });
    assert.equal(duplicateCompletion?.markdownAssetId, resultAsset);
    assert.equal((await database.db.select({ id: assets.id }).from(assets).where(eq(assets.id, duplicateAsset))).length, 0);

    const rollbackConversion = createPrefixedId("dcv");
    const rollbackEvent = event();
    assert.equal((await repository.createDocumentConversion({
      ...createInput,
      scope: `${scope}:conversion:rollback`,
      idempotencyKey: "rollback",
      conversionId: rollbackConversion,
      event: rollbackEvent,
    })).kind, "NEW");
    const rollbackStart = await repository.startDocumentConversion({ workspaceId: workspaceA, conversionId: rollbackConversion, event: event() });
    assert.equal(rollbackStart?.attemptCount, 1);
    await assert.rejects(
      repository.failDocumentConversion({
        workspaceId: workspaceA,
        conversionId: rollbackConversion,
        attemptNo: 1,
        code: "DOCUMENT_CONVERSION_FAILED",
        retryable: true,
        event: rollbackEvent,
      }),
      (error: unknown) => {
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code === "23505";
      },
    );
    const [afterRollback] = await database.db.select({ status: documentConversions.status }).from(documentConversions).where(and(eq(documentConversions.workspaceId, workspaceA), eq(documentConversions.id, rollbackConversion)));
    assert.equal(afterRollback?.status, "RUNNING");
    assert.equal((await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceA), eq(outboxEvents.aggregateId, rollbackConversion), eq(outboxEvents.eventType, "document_conversion.failed")))).length, 0);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${scope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [[workspaceA, workspaceB]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[userA, userB]]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
