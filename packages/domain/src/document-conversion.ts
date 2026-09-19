import type { DocumentConversionStatus } from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";

export const DOCUMENT_CONVERSION_TRANSITIONS: Readonly<Record<DocumentConversionStatus, readonly DocumentConversionStatus[]>> = {
  CREATED: ["QUEUED"],
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: ["QUEUED"],
};

export type DocumentConversionState = {
  id: string;
  status: DocumentConversionStatus;
  sourceAssetId: string;
  markdownAssetId: string | null;
};

export const isActiveDocumentConversionStatus = (status: DocumentConversionStatus) =>
  status === "CREATED" || status === "QUEUED" || status === "RUNNING";

export const assertDocumentConversionTransition = (from: DocumentConversionStatus, to: DocumentConversionStatus) => {
  if (!DOCUMENT_CONVERSION_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("DOCUMENT_CONVERSION_STATE_INVALID", `Cannot transition DocumentConversion from ${from} to ${to}.`);
  }
};

export const transitionDocumentConversion = (
  previous: DocumentConversionState,
  next: Omit<DocumentConversionState, "id" | "sourceAssetId">,
): DocumentConversionState => {
  assertDocumentConversionTransition(previous.status, next.status);
  if (next.markdownAssetId && next.status !== "SUCCEEDED") {
    throw new DomainInvariantError("DOCUMENT_RESULT_IMMUTABLE", "Markdown result cannot be published before conversion succeeds.");
  }
  if (next.status === "SUCCEEDED" && !next.markdownAssetId) {
    throw new DomainInvariantError("DOCUMENT_RESULT_IMMUTABLE", "A successful conversion requires its Markdown asset.");
  }
  if (previous.markdownAssetId && next.markdownAssetId !== previous.markdownAssetId) {
    throw new DomainInvariantError("DOCUMENT_RESULT_IMMUTABLE", "A successful conversion result cannot be replaced.");
  }
  return { id: previous.id, sourceAssetId: previous.sourceAssetId, ...next };
};
