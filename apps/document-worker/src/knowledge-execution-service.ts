import { createHash } from "node:crypto";

import { createPrefixedId } from "@alchemy-video/domain";
import { DeterministicDocumentUnderstandingAdapter, type DocumentUnderstandingPort } from "@alchemy-video/document-intelligence";
import type { DocumentKnowledgeExecutionStore } from "@alchemy-video/persistence";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export type KnowledgeMarkdownSource = {
  stream: ReadableStream<Uint8Array>;
  markdownSha256: string;
};

export class DocumentKnowledgeExecutor {
  constructor(
    private readonly store: DocumentKnowledgeExecutionStore,
    private readonly readMarkdown: (input: { workspaceId: string; knowledgeRevisionId: string; markdownAssetId?: string }) => Promise<KnowledgeMarkdownSource | undefined>,
    private readonly analyzer: DocumentUnderstandingPort = new DeterministicDocumentUnderstandingAdapter(),
  ) {}

  async execute(input: { workspaceId: string; knowledgeRevisionId: string }) {
    const current = await this.store.findKnowledgeRevision(input.workspaceId, input.knowledgeRevisionId);
    if (!current || current.status === "READY" || current.status === "FAILED") return current;
    const running = current.status === "RUNNING"
      ? current
      : await this.store.startKnowledgeRevision({ workspaceId: input.workspaceId, knowledgeRevisionId: input.knowledgeRevisionId, event: this.event() });
    if (!running) return this.store.findKnowledgeRevision(input.workspaceId, input.knowledgeRevisionId);
    try {
      const markdown = await this.readMarkdown({ workspaceId: input.workspaceId, knowledgeRevisionId: running.id });
      if (!markdown || markdown.markdownSha256 !== current.markdownSha256) throw new Error("Knowledge Markdown source is unavailable or changed.");
      const draft = await this.analyzer.analyze({ conversion: { documentId: running.documentId, conversionId: running.conversionId, markdownSha256: markdown.markdownSha256 }, markdown: markdown.stream, analyzerVersion: current.analyzerVersion });
      const sections = draft.sections.map((section) => ({ id: createPrefixedId("dks"), sequence: section.sequence, heading: section.heading, locator: section.locator, evidenceKind: section.evidenceKind, contentHash: hash(`${section.heading}\n${section.locator}\n${section.evidenceKind}`) }));
      const facts = draft.facts.map((fact) => ({ id: createPrefixedId("dft"), sectionSequence: fact.sectionSequence, category: fact.category, statement: fact.statement, confidence: fact.confidence, statementHash: hash(`${fact.category}\n${fact.statement}\n${fact.sectionSequence}`) }));
      return await this.store.completeKnowledgeRevision({ workspaceId: input.workspaceId, knowledgeRevisionId: running.id, analysisQuality: draft.analysisQuality, sections, facts, event: this.event() });
    } catch {
      return this.store.failKnowledgeRevision({ workspaceId: input.workspaceId, knowledgeRevisionId: running.id, retryable: true, errorCode: "DOCUMENT_KNOWLEDGE_INVALID", event: this.event() });
    }
  }

  async recover(input: { limit: number }) {
    const revisions = await this.store.listRecoverableKnowledgeRevisions({ limit: input.limit });
    return Promise.all(revisions.map((revision) => this.execute({ workspaceId: revision.workspaceId, knowledgeRevisionId: revision.id })));
  }

  private event() {
    return { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") };
  }
}
