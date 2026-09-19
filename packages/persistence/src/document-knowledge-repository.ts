import type { DocumentKnowledgeAnalysisQuality } from "@alchemy-video/contracts";
import { transitionDocumentKnowledge } from "@alchemy-video/domain";

export type ControlDocumentKnowledgeRevision = {
  id: string;
  workspaceId: string;
  projectId: string;
  documentId: string;
  conversionId: string;
  /** Internal worker-only source identity; serializers intentionally omit it. */
  markdownAssetId: string;
  markdownSha256: string;
  analyzerVersion: string;
  status: "CREATED" | "QUEUED" | "RUNNING" | "READY" | "FAILED";
  retryable: boolean;
  analysisQuality: DocumentKnowledgeAnalysisQuality | null;
  sectionCount: number;
  factCount: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSectionInput = {
  id: string;
  sequence: number;
  heading: string;
  locator: string;
  evidenceKind: "TEXT" | "TABLE" | "VISUAL_UNAVAILABLE";
  contentHash: string;
};

export type KnowledgeFactInput = {
  id: string;
  sectionSequence: number;
  category: "BRAND" | "PRODUCT" | "LOCATION" | "AUDIENCE" | "SELLING_POINT" | "AMENITY" | "STYLE" | "CTA" | "COMPLIANCE" | "NUMERIC_CLAIM" | "RISK";
  statement: string;
  confidence: "EXPLICIT" | "INFERRED" | "NEEDS_CONFIRMATION";
  statementHash: string;
};

type Source = {
  workspaceId: string;
  projectId: string;
  documentId: string;
  conversionId: string;
  markdownAssetId: string;
  markdownSha256: string;
  status: "SUCCEEDED" | "OTHER";
};

type CommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  knowledgeRevisionId: string;
  event: { eventId: string; messageId: string; traceId: string; correlationId: string };
};

export type DocumentKnowledgeCommandOutcome = { kind: "NEW" | "REPLAY"; value: ControlDocumentKnowledgeRevision; status: 201 | 202 } | {
  kind: "CONFLICT" | "NOT_FOUND" | "INVALID_SOURCE" | "ACTIVE_CONFLICT" | "STATE_INVALID";
};

type StoredCommand = { hash: string; result: { kind: "KNOWLEDGE"; knowledgeRevisionId: string } | Exclude<DocumentKnowledgeCommandOutcome, { kind: "NEW" | "REPLAY"; value: ControlDocumentKnowledgeRevision; status: 201 | 202 }> };
type KnowledgeEventType = "document_knowledge.queued" | "document_knowledge.started" | "document_knowledge.succeeded" | "document_knowledge.failed";
type EventSink = (event: { eventType: KnowledgeEventType; revision: ControlDocumentKnowledgeRevision }) => void;

export interface DocumentKnowledgeStore {
  listProjectKnowledgeRevisions(workspaceId: string, projectId: string): Promise<ControlDocumentKnowledgeRevision[]> | ControlDocumentKnowledgeRevision[];
  findKnowledgeRevision(workspaceId: string, knowledgeRevisionId: string): Promise<ControlDocumentKnowledgeRevision | undefined> | ControlDocumentKnowledgeRevision | undefined;
  listSections(workspaceId: string, knowledgeRevisionId: string): KnowledgeSectionInput[] | Promise<KnowledgeSectionInput[]>;
  listFacts(workspaceId: string, knowledgeRevisionId: string): KnowledgeFactInput[] | Promise<KnowledgeFactInput[]>;
  createKnowledgeRevision(input: CommandInput & { documentId: string; conversionId: string; markdownAssetId: string; markdownSha256: string; analyzerVersion: string }): Promise<DocumentKnowledgeCommandOutcome>;
  retryKnowledgeRevision(input: CommandInput): Promise<DocumentKnowledgeCommandOutcome>;
}

export interface DocumentKnowledgeExecutionStore extends DocumentKnowledgeStore {
  listRecoverableKnowledgeRevisions(input: { limit: number }): Promise<ControlDocumentKnowledgeRevision[]> | ControlDocumentKnowledgeRevision[];
  startKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; event?: CommandInput["event"] }): Promise<ControlDocumentKnowledgeRevision | undefined> | ControlDocumentKnowledgeRevision | undefined;
  failKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; retryable: boolean; errorCode?: string; event?: CommandInput["event"] }): Promise<ControlDocumentKnowledgeRevision | undefined> | ControlDocumentKnowledgeRevision | undefined;
  completeKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; analysisQuality: DocumentKnowledgeAnalysisQuality; sections: KnowledgeSectionInput[]; facts: KnowledgeFactInput[]; event?: CommandInput["event"] }): Promise<ControlDocumentKnowledgeRevision | undefined> | ControlDocumentKnowledgeRevision | undefined;
}

const keyOf = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;
const now = () => new Date().toISOString();

export class InMemoryDocumentKnowledgeStore implements DocumentKnowledgeExecutionStore {
  private readonly revisions = new Map<string, ControlDocumentKnowledgeRevision>();
  private readonly sources = new Map<string, Source>();
  private readonly sections = new Map<string, KnowledgeSectionInput[]>();
  private readonly facts = new Map<string, KnowledgeFactInput[]>();
  private readonly commands = new Map<string, StoredCommand>();

  constructor(private readonly eventSink?: EventSink) {}

  seedConversion(source: Source) {
    this.sources.set(`${source.workspaceId}:${source.conversionId}`, source);
  }

  listProjectKnowledgeRevisions(workspaceId: string, projectId: string) {
    return [...this.revisions.values()]
      .filter((revision) => revision.workspaceId === workspaceId && revision.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  findKnowledgeRevision(workspaceId: string, knowledgeRevisionId: string) {
    const revision = this.revisions.get(knowledgeRevisionId);
    return revision?.workspaceId === workspaceId ? revision : undefined;
  }

  listSections(workspaceId: string, knowledgeRevisionId: string) {
    const revision = this.findKnowledgeRevision(workspaceId, knowledgeRevisionId);
    return revision ? [...(this.sections.get(knowledgeRevisionId) ?? [])] : [];
  }

  listFacts(workspaceId: string, knowledgeRevisionId: string) {
    const revision = this.findKnowledgeRevision(workspaceId, knowledgeRevisionId);
    return revision ? [...(this.facts.get(knowledgeRevisionId) ?? [])] : [];
  }

  listRecoverableKnowledgeRevisions(input: { limit: number }) {
    return [...this.revisions.values()]
      .filter((revision) => revision.status === "QUEUED" || revision.status === "RUNNING")
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, input.limit);
  }

  async createKnowledgeRevision(input: CommandInput & { documentId: string; conversionId: string; markdownAssetId: string; markdownSha256: string; analyzerVersion: string }): Promise<DocumentKnowledgeCommandOutcome> {
    const replay = this.replay(input, 202);
    if (replay) return replay;
    const source = this.sources.get(`${input.workspaceId}:${input.conversionId}`);
    if (!source || source.projectId !== input.projectId || source.documentId !== input.documentId || source.status !== "SUCCEEDED" || source.markdownAssetId !== input.markdownAssetId || source.markdownSha256 !== input.markdownSha256) {
      return this.storeOutcome(input, { kind: "INVALID_SOURCE" });
    }
    const duplicate = [...this.revisions.values()].find((revision) => revision.workspaceId === input.workspaceId && revision.projectId === input.projectId && revision.conversionId === input.conversionId && revision.status !== "FAILED");
    if (duplicate) return this.storeOutcome(input, { kind: "ACTIVE_CONFLICT" });
    const time = now();
    const revision: ControlDocumentKnowledgeRevision = {
      id: input.knowledgeRevisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      documentId: input.documentId,
      conversionId: input.conversionId,
      markdownAssetId: input.markdownAssetId,
      markdownSha256: input.markdownSha256,
      analyzerVersion: input.analyzerVersion,
      status: "QUEUED",
      retryable: false,
      analysisQuality: null,
      sectionCount: 0,
      factCount: 0,
      createdAt: time,
      updatedAt: time,
    };
    this.revisions.set(revision.id, revision);
    this.commands.set(keyOf(input.scope, input.idempotencyKey), { hash: input.requestHash, result: { kind: "KNOWLEDGE", knowledgeRevisionId: revision.id } });
    this.emit("document_knowledge.queued", revision);
    return { kind: "NEW", value: revision, status: 202 };
  }

  async retryKnowledgeRevision(input: CommandInput): Promise<DocumentKnowledgeCommandOutcome> {
    const replay = this.replay(input, 202);
    if (replay) return replay;
    const current = this.findKnowledgeRevision(input.workspaceId, input.knowledgeRevisionId);
    if (!current) return this.storeOutcome(input, { kind: "NOT_FOUND" });
    if (current.status !== "FAILED" || !current.retryable) return this.storeOutcome(input, { kind: "STATE_INVALID" });
    // A failed attempt must not leave a partial/previous result visible while
    // the same immutable revision is being retried. Successful completion is
    // all-or-nothing, but clearing these maps also keeps the in-memory adapter
    // fail-closed if a caller supplied stale fixtures.
    this.sections.delete(current.id);
    this.facts.delete(current.id);
    const updated = { ...current, status: "QUEUED" as const, retryable: false, analysisQuality: null, sectionCount: 0, factCount: 0, updatedAt: now() };
    this.revisions.set(updated.id, updated);
    this.commands.set(keyOf(input.scope, input.idempotencyKey), { hash: input.requestHash, result: { kind: "KNOWLEDGE", knowledgeRevisionId: updated.id } });
    this.emit("document_knowledge.queued", updated);
    return { kind: "NEW", value: updated, status: 202 };
  }

  startKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string }) {
    const current = this.findKnowledgeRevision(input.workspaceId, input.knowledgeRevisionId);
    if (!current || current.status !== "QUEUED") return undefined;
    const updated = { ...current, status: "RUNNING" as const, updatedAt: now() };
    this.revisions.set(updated.id, updated);
    this.emit("document_knowledge.started", updated);
    return updated;
  }

  failKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; retryable: boolean }) {
    const current = this.findKnowledgeRevision(input.workspaceId, input.knowledgeRevisionId);
    if (!current || !["QUEUED", "RUNNING"].includes(current.status)) return undefined;
    const updated = { ...current, status: "FAILED" as const, retryable: input.retryable, updatedAt: now() };
    this.revisions.set(updated.id, updated);
    this.emit("document_knowledge.failed", updated);
    return updated;
  }

  completeKnowledgeRevision(input: { workspaceId: string; knowledgeRevisionId: string; analysisQuality: DocumentKnowledgeAnalysisQuality; sections: KnowledgeSectionInput[]; facts: KnowledgeFactInput[] }) {
    const current = this.findKnowledgeRevision(input.workspaceId, input.knowledgeRevisionId);
    if (!current || current.status !== "RUNNING") return undefined;
    const sections = [...input.sections].sort((left, right) => left.sequence - right.sequence);
    if (sections.length === 0 || sections.some((section, index) => section.sequence !== index + 1)) return undefined;
    if (input.facts.some((fact) => !sections.some((section) => section.sequence === fact.sectionSequence))) return undefined;
    const next = transitionDocumentKnowledge({ id: current.id, documentId: current.documentId, conversionId: current.conversionId, status: current.status, analysisQuality: current.analysisQuality, sectionCount: current.sectionCount, factCount: current.factCount }, {
      status: "READY",
      analysisQuality: input.analysisQuality,
      sectionCount: sections.length,
      factCount: input.facts.length,
    });
    const updated: ControlDocumentKnowledgeRevision = { ...current, status: next.status, retryable: false, analysisQuality: next.analysisQuality, sectionCount: next.sectionCount, factCount: next.factCount, updatedAt: now() };
    this.revisions.set(updated.id, updated);
    this.sections.set(updated.id, sections);
    this.facts.set(updated.id, [...input.facts]);
    this.emit("document_knowledge.succeeded", updated);
    return updated;
  }

  private emit(eventType: KnowledgeEventType, revision: ControlDocumentKnowledgeRevision) {
    this.eventSink?.({ eventType, revision });
  }

  private storeOutcome(input: CommandInput, result: Exclude<DocumentKnowledgeCommandOutcome, { kind: "NEW" | "REPLAY"; value: ControlDocumentKnowledgeRevision; status: 201 | 202 }>): Exclude<DocumentKnowledgeCommandOutcome, { kind: "NEW" | "REPLAY"; value: ControlDocumentKnowledgeRevision; status: 201 | 202 }> {
    this.commands.set(keyOf(input.scope, input.idempotencyKey), { hash: input.requestHash, result });
    return result;
  }

  private replay(input: CommandInput, status: 201 | 202): DocumentKnowledgeCommandOutcome | undefined {
    const stored = this.commands.get(keyOf(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.hash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.result.kind !== "KNOWLEDGE") return stored.result;
    const value = this.findKnowledgeRevision(input.workspaceId, stored.result.knowledgeRevisionId);
    return value ? { kind: "REPLAY", value, status } : { kind: "CONFLICT" };
  }
}
