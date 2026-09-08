import type { DocumentKnowledgeAnalysisQuality, DocumentKnowledgeRevisionStatus } from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";

export const DOCUMENT_KNOWLEDGE_TRANSITIONS: Readonly<Record<DocumentKnowledgeRevisionStatus, readonly DocumentKnowledgeRevisionStatus[]>> = {
  CREATED: ["QUEUED"],
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["READY", "FAILED"],
  READY: [],
  FAILED: ["QUEUED"],
};

export type DocumentKnowledgeState = {
  id: string;
  documentId: string;
  conversionId: string;
  status: DocumentKnowledgeRevisionStatus;
  analysisQuality: DocumentKnowledgeAnalysisQuality | null;
  sectionCount: number;
  factCount: number;
};

export const isActiveDocumentKnowledgeStatus = (status: DocumentKnowledgeRevisionStatus) =>
  status === "CREATED" || status === "QUEUED" || status === "RUNNING";

export const assertDocumentKnowledgeTransition = (
  from: DocumentKnowledgeRevisionStatus,
  to: DocumentKnowledgeRevisionStatus,
) => {
  if (!DOCUMENT_KNOWLEDGE_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("DOCUMENT_KNOWLEDGE_STATE_INVALID", `Cannot transition DocumentKnowledgeRevision from ${from} to ${to}.`);
  }
};

export const transitionDocumentKnowledge = (
  previous: DocumentKnowledgeState,
  next: Omit<DocumentKnowledgeState, "id" | "documentId" | "conversionId">,
): DocumentKnowledgeState => {
  assertDocumentKnowledgeTransition(previous.status, next.status);
  if (!Number.isInteger(next.sectionCount) || next.sectionCount < 0 || !Number.isInteger(next.factCount) || next.factCount < 0) {
    throw new DomainInvariantError("DOCUMENT_KNOWLEDGE_RESULT_IMMUTABLE", "Knowledge result counts must be non-negative integers.");
  }
  if (next.status === "READY" && next.analysisQuality === null) {
    throw new DomainInvariantError("DOCUMENT_KNOWLEDGE_RESULT_IMMUTABLE", "A ready knowledge revision requires an analysis quality.");
  }
  if (next.status !== "READY" && (next.analysisQuality !== null || next.sectionCount !== 0 || next.factCount !== 0)) {
    throw new DomainInvariantError("DOCUMENT_KNOWLEDGE_RESULT_IMMUTABLE", "Knowledge facts may only be published when the revision is ready.");
  }
  return {
    id: previous.id,
    documentId: previous.documentId,
    conversionId: previous.conversionId,
    ...next,
  };
};
