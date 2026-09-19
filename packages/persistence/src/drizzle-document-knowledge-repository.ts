import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { DocumentKnowledgeAnalysisQuality } from "@alchemy-video/contracts";
import type { PlatformDatabase } from "./db.js";
import { assets, commandDeduplications, documentConversions, documentFacts, documentKnowledgeRevisions, documentKnowledgeSections, outboxEvents } from "./schema.js";
import type { ControlDocumentKnowledgeRevision, DocumentKnowledgeCommandOutcome, DocumentKnowledgeExecutionStore, KnowledgeFactInput, KnowledgeSectionInput } from "./document-knowledge-repository.js";

type EventInput = { eventId: string; messageId: string; traceId: string; correlationId: string };
type CreateInput = { scope: string; idempotencyKey: string; requestHash: string; workspaceId: string; projectId: string; knowledgeRevisionId: string; documentId: string; conversionId: string; markdownAssetId: string; markdownSha256: string; analyzerVersion: string; event: EventInput };
type RetryInput = { scope: string; idempotencyKey: string; requestHash: string; workspaceId: string; projectId: string; knowledgeRevisionId: string; event: EventInput };

const now = () => new Date().toISOString();
const serializeRevision = (row: typeof documentKnowledgeRevisions.$inferSelect): ControlDocumentKnowledgeRevision => ({
  id: row.id, workspaceId: row.workspaceId, projectId: row.projectId, documentId: row.documentId, conversionId: row.conversionId,
  markdownAssetId: row.markdownAssetId, markdownSha256: row.markdownSha256, analyzerVersion: row.analyzerVersion,
  status: row.status, retryable: row.retryable, analysisQuality: row.analysisQuality as DocumentKnowledgeAnalysisQuality | null,
  sectionCount: row.sectionCount, factCount: row.factCount, createdAt: row.createdAt, updatedAt: row.updatedAt,
});
const commandWhere = (input: { scope: string; idempotencyKey: string }) => and(eq(commandDeduplications.scope, input.scope), eq(commandDeduplications.idempotencyKey, input.idempotencyKey));

const writeEvent = (transaction: any, input: EventInput, revision: ControlDocumentKnowledgeRevision, eventType: string) => transaction.insert(outboxEvents).values({
  id: input.eventId,
  workspaceId: revision.workspaceId,
  projectId: revision.projectId,
  aggregateType: "document_knowledge_revision",
  aggregateId: revision.id,
  eventType,
  occurredAt: now(),
  payload: {
    contract_version: "1.0", message_id: input.messageId, event_id: input.eventId, event_type: eventType,
    occurred_at: now(), trace_id: input.traceId, correlation_id: input.correlationId,
    idempotency_key: `internal:${input.eventId}`, producer: "document-knowledge-worker", workspace_id: revision.workspaceId,
    project_id: revision.projectId, aggregate: { type: "document_knowledge_revision", id: revision.id },
    data: eventType === "document_knowledge.queued"
      ? { document_id: revision.documentId, conversion_id: revision.conversionId, knowledge_revision_id: revision.id }
      : eventType === "document_knowledge.started"
        ? { conversion_id: revision.conversionId, knowledge_revision_id: revision.id }
        : eventType === "document_knowledge.succeeded"
          ? { conversion_id: revision.conversionId, knowledge_revision_id: revision.id, analysis_quality: revision.analysisQuality }
          : { conversion_id: revision.conversionId, knowledge_revision_id: revision.id, error_code: "DOCUMENT_KNOWLEDGE_INVALID", retryable: revision.retryable }, version: 1,
  },
});

export class DrizzleDocumentKnowledgeRepository implements DocumentKnowledgeExecutionStore {
  constructor(private readonly db: PlatformDatabase) {}

  /** Resolve the server-side Markdown object without exposing its key through Control API DTOs. */
  async findMarkdownSource(workspaceId: string, knowledgeRevisionId: string) {
    const [row] = await this.db.select({
      objectKey: assets.objectKey,
      mimeType: assets.mimeType,
      markdownSha256: documentKnowledgeRevisions.markdownSha256,
    }).from(documentKnowledgeRevisions).innerJoin(assets, and(
      eq(assets.workspaceId, documentKnowledgeRevisions.workspaceId),
      eq(assets.projectId, documentKnowledgeRevisions.projectId),
      eq(assets.id, documentKnowledgeRevisions.markdownAssetId),
    )).where(and(
      eq(documentKnowledgeRevisions.workspaceId, workspaceId),
      eq(documentKnowledgeRevisions.id, knowledgeRevisionId),
    )).limit(1);
    return row;
  }

  async listProjectKnowledgeRevisions(workspaceId: string, projectId: string) {
    const rows = await this.db.select().from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, workspaceId), eq(documentKnowledgeRevisions.projectId, projectId))).orderBy(asc(documentKnowledgeRevisions.createdAt));
    return rows.map(serializeRevision);
  }

  async findKnowledgeRevision(workspaceId: string, knowledgeRevisionId: string) {
    const [row] = await this.db.select().from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, workspaceId), eq(documentKnowledgeRevisions.id, knowledgeRevisionId))).limit(1);
    return row ? serializeRevision(row) : undefined;
  }

  async listSections(workspaceId: string, knowledgeRevisionId: string): Promise<KnowledgeSectionInput[]> {
    const rows = await this.db.select().from(documentKnowledgeSections).where(and(eq(documentKnowledgeSections.workspaceId, workspaceId), eq(documentKnowledgeSections.knowledgeRevisionId, knowledgeRevisionId))).orderBy(asc(documentKnowledgeSections.sequence));
    return rows.map((row) => ({ id: row.id, sequence: row.sequence, heading: row.heading, locator: row.locator, evidenceKind: row.evidenceKind, contentHash: row.contentHash }));
  }

  async listFacts(workspaceId: string, knowledgeRevisionId: string): Promise<KnowledgeFactInput[]> {
    const rows = await this.db.select({ fact: documentFacts, sectionSequence: documentKnowledgeSections.sequence }).from(documentFacts).innerJoin(documentKnowledgeSections, and(eq(documentKnowledgeSections.workspaceId, documentFacts.workspaceId), eq(documentKnowledgeSections.projectId, documentFacts.projectId), eq(documentKnowledgeSections.id, documentFacts.sectionId))).where(and(eq(documentFacts.workspaceId, workspaceId), eq(documentFacts.knowledgeRevisionId, knowledgeRevisionId))).orderBy(asc(documentKnowledgeSections.sequence), asc(documentFacts.createdAt));
    return rows.map(({ fact, sectionSequence }) => ({ id: fact.id, sectionSequence, category: fact.category, statement: fact.statement, confidence: fact.confidence, statementHash: fact.statementHash }));
  }

  async listRecoverableKnowledgeRevisions(input: { limit: number }) {
    const rows = await this.db.select().from(documentKnowledgeRevisions)
      .where(inArray(documentKnowledgeRevisions.status, ["QUEUED", "RUNNING"]))
      .orderBy(asc(documentKnowledgeRevisions.updatedAt))
      .limit(input.limit);
    return rows.map(serializeRevision);
  }

  async createKnowledgeRevision(input: CreateInput): Promise<DocumentKnowledgeCommandOutcome> {
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(commandDeduplications).where(commandWhere(input)).limit(1);
      if (existing) {
        if (existing.requestHash !== input.requestHash) return { kind: "CONFLICT" };
        const snapshot = existing.responseSnapshot as { kind?: string; knowledge_revision_id?: string };
        if (snapshot.kind === "KNOWLEDGE" && snapshot.knowledge_revision_id) {
          const [row] = await transaction.select().from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, snapshot.knowledge_revision_id))).limit(1);
          return row ? { kind: "REPLAY", value: serializeRevision(row), status: 202 } : { kind: "CONFLICT" };
        }
        return snapshot.kind === "INVALID_SOURCE" || snapshot.kind === "ACTIVE_CONFLICT" ? { kind: snapshot.kind } : { kind: "CONFLICT" };
      }
      await transaction.insert(commandDeduplications).values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} });
      const [conversionRow] = await transaction.select({ conversion: documentConversions, markdownSha256: assets.sha256 }).from(documentConversions).leftJoin(assets, and(eq(assets.workspaceId, documentConversions.workspaceId), eq(assets.projectId, documentConversions.projectId), eq(assets.id, documentConversions.markdownAssetId))).where(and(eq(documentConversions.workspaceId, input.workspaceId), eq(documentConversions.projectId, input.projectId), eq(documentConversions.id, input.conversionId))).limit(1);
      const conversion = conversionRow?.conversion;
      if (!conversion || conversion.status !== "SUCCEEDED" || conversion.documentId !== input.documentId || conversion.markdownAssetId !== input.markdownAssetId || conversionRow?.markdownSha256 !== input.markdownSha256) {
        await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "INVALID_SOURCE" } }).where(commandWhere(input));
        return { kind: "INVALID_SOURCE" };
      }
      const [duplicate] = await transaction.select({ id: documentKnowledgeRevisions.id }).from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.projectId, input.projectId), eq(documentKnowledgeRevisions.conversionId, input.conversionId), ne(documentKnowledgeRevisions.status, "FAILED"))).limit(1);
      if (duplicate) {
        await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "ACTIVE_CONFLICT" } }).where(commandWhere(input));
        return { kind: "ACTIVE_CONFLICT" };
      }
      const timestamp = now();
      const [row] = await transaction.insert(documentKnowledgeRevisions).values({ id: input.knowledgeRevisionId, workspaceId: input.workspaceId, projectId: input.projectId, documentId: input.documentId, conversionId: input.conversionId, markdownAssetId: input.markdownAssetId, markdownSha256: input.markdownSha256, analyzerVersion: input.analyzerVersion, status: "QUEUED", retryable: false, sectionCount: 0, factCount: 0, createdAt: timestamp, updatedAt: timestamp }).returning();
      const revision = serializeRevision(row!);
      await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "KNOWLEDGE", knowledge_revision_id: revision.id } }).where(commandWhere(input));
      await writeEvent(transaction, input.event, revision, "document_knowledge.queued");
      return { kind: "NEW", value: revision, status: 202 };
    });
  }

  async retryKnowledgeRevision(input: RetryInput): Promise<DocumentKnowledgeCommandOutcome> {
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(commandDeduplications).where(commandWhere(input)).limit(1);
      if (existing) {
        if (existing.requestHash !== input.requestHash) return { kind: "CONFLICT" };
        const snapshot = existing.responseSnapshot as { kind?: string; knowledge_revision_id?: string };
        if (snapshot.kind === "KNOWLEDGE" && snapshot.knowledge_revision_id) {
          const [row] = await transaction.select().from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, snapshot.knowledge_revision_id))).limit(1);
          return row ? { kind: "REPLAY", value: serializeRevision(row), status: 202 } : { kind: "CONFLICT" };
        }
        return snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID" ? { kind: snapshot.kind } : { kind: "CONFLICT" };
      }
      await transaction.insert(commandDeduplications).values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} });
      const [current] = await transaction.select().from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, input.knowledgeRevisionId))).limit(1);
      if (!current) { await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "NOT_FOUND" } }).where(commandWhere(input)); return { kind: "NOT_FOUND" }; }
      if (current.status !== "FAILED" || !current.retryable) { await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "STATE_INVALID" } }).where(commandWhere(input)); return { kind: "STATE_INVALID" }; }
      // Retry the same immutable revision only after removing any stale
      // section/fact rows from a previously interrupted attempt. The normal
      // completion transaction is atomic, but this keeps a partial fixture or
      // legacy row from being exposed while the revision is QUEUED/RUNNING.
      await transaction.delete(documentFacts).where(and(
        eq(documentFacts.workspaceId, input.workspaceId),
        eq(documentFacts.projectId, current.projectId),
        eq(documentFacts.knowledgeRevisionId, current.id),
      ));
      await transaction.delete(documentKnowledgeSections).where(and(
        eq(documentKnowledgeSections.workspaceId, input.workspaceId),
        eq(documentKnowledgeSections.projectId, current.projectId),
        eq(documentKnowledgeSections.knowledgeRevisionId, current.id),
      ));
      const [row] = await transaction.update(documentKnowledgeRevisions).set({ status: "QUEUED", retryable: false, analysisQuality: null, sectionCount: 0, factCount: 0, error: null, updatedAt: now() }).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, input.knowledgeRevisionId), eq(documentKnowledgeRevisions.status, "FAILED"))).returning();
      if (!row) return { kind: "STATE_INVALID" };
      const revision = serializeRevision(row);
      await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "KNOWLEDGE", knowledge_revision_id: revision.id } }).where(commandWhere(input));
      await writeEvent(transaction, input.event, revision, "document_knowledge.queued");
      return { kind: "NEW", value: revision, status: 202 };
    });
  }

  async startKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; event?: EventInput }) {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction.update(documentKnowledgeRevisions).set({ status: "RUNNING", updatedAt: now() }).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, input.knowledgeRevisionId), eq(documentKnowledgeRevisions.status, "QUEUED"))).returning();
      if (!row) return undefined;
      const revision = serializeRevision(row);
      if (input.event) await writeEvent(transaction, input.event, revision, "document_knowledge.started");
      return revision;
    });
  }

  async failKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; retryable: boolean; errorCode?: string; event?: EventInput }) {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction.update(documentKnowledgeRevisions).set({ status: "FAILED", retryable: input.retryable, error: { code: input.errorCode ?? "DOCUMENT_KNOWLEDGE_INVALID", retryable: input.retryable }, updatedAt: now() }).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, input.knowledgeRevisionId), inArray(documentKnowledgeRevisions.status, ["QUEUED", "RUNNING"]))).returning();
      if (!row) return undefined;
      const revision = serializeRevision(row);
      if (input.event) await writeEvent(transaction, input.event, revision, "document_knowledge.failed");
      return revision;
    });
  }

  async completeKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; analysisQuality: DocumentKnowledgeAnalysisQuality; sections: KnowledgeSectionInput[]; facts: KnowledgeFactInput[]; event?: EventInput }) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(documentKnowledgeRevisions).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, input.knowledgeRevisionId))).limit(1);
      if (!current || current.status !== "RUNNING") return undefined;
      const sections = [...input.sections].sort((left, right) => left.sequence - right.sequence);
      if (sections.length === 0 || sections.some((section, index) => section.sequence !== index + 1) || input.facts.some((fact) => !sections.some((section) => section.sequence === fact.sectionSequence))) return undefined;
      const [updated] = await transaction.update(documentKnowledgeRevisions).set({ status: "READY", retryable: false, analysisQuality: input.analysisQuality, sectionCount: sections.length, factCount: input.facts.length, error: null, updatedAt: now() }).where(and(eq(documentKnowledgeRevisions.workspaceId, input.workspaceId), eq(documentKnowledgeRevisions.id, input.knowledgeRevisionId), eq(documentKnowledgeRevisions.status, "RUNNING"))).returning();
      if (!updated) return undefined;
      await transaction.insert(documentKnowledgeSections).values(sections.map((section) => ({ id: section.id, workspaceId: current.workspaceId, projectId: current.projectId, knowledgeRevisionId: current.id, sequence: section.sequence, heading: section.heading, locator: section.locator, evidenceKind: section.evidenceKind, contentHash: section.contentHash })));
      const sectionIds = new Map(sections.map((section) => [section.sequence, section.id]));
      await transaction.insert(documentFacts).values(input.facts.map((fact) => ({ id: fact.id, workspaceId: current.workspaceId, projectId: current.projectId, knowledgeRevisionId: current.id, sectionId: sectionIds.get(fact.sectionSequence)!, category: fact.category, statement: fact.statement, confidence: fact.confidence, statementHash: fact.statementHash })));
      const revision = serializeRevision(updated);
      if (input.event) await writeEvent(transaction, input.event, revision, "document_knowledge.succeeded");
      return revision;
    });
  }
}
