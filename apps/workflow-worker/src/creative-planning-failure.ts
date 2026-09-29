import { SemanticDecisionVerificationError } from "@alchemy-video/creative-planning/semantic-director";
import {
  UnsupportedVideoGenerationInputError,
  VideoPromptCompilationError,
} from "@alchemy-video/provider-video";
import { StorageUnavailableError } from "@alchemy-video/storage-client";

import { DocumentContextReadError } from "./document-context-reader.js";
import { SemanticDirectorCanonicalizationError } from "./semantic-director-canonicalizer.js";
import { SemanticDirectorClientError } from "./semantic-director-client.js";

export type SemanticPlanningExecutionErrorCode =
  | "CANONICAL_REFERENCE_FACTS_INVALID"
  | "CANONICAL_SOURCE_BUNDLE_INVALID"
  | "DOCUMENT_CONTEXT_READER_MISSING"
  | "SEMANTIC_DRAFT_INVALID"
  | "PLANNING_PERSISTENCE_STATE_INVALID";

export class SemanticPlanningExecutionError extends Error {
  constructor(readonly code: SemanticPlanningExecutionErrorCode) {
    super("Semantic planning failed a deterministic execution gate.");
    this.name = "SemanticPlanningExecutionError";
  }
}

export type CreativePlanningFailureCode =
  | SemanticDirectorClientError["code"]
  | SemanticDecisionVerificationError["code"]
  | SemanticDirectorCanonicalizationError["code"]
  | SemanticPlanningExecutionErrorCode
  | DocumentContextReadError["code"]
  | "DOCUMENT_STORAGE_UNAVAILABLE"
  | "PROMPT_COMPILATION_INVALID"
  | "VIDEO_INPUT_INVALID"
  | "PLANNING_COMPLETION_MISSING"
  | "PLANNING_EVENT_NOT_READY"
  | "PLANNING_EVENT_RELEASE_FAILED"
  | "PLANNING_EXECUTION_UNAVAILABLE";

/**
 * Safe queue-facing planning error. It intentionally carries no cause, source
 * text, endpoint, response body, object key, or user-authored content.
 */
export class CreativePlanningProcessingError extends Error {
  constructor(
    readonly code: CreativePlanningFailureCode,
    readonly retryable: boolean,
  ) {
    super(retryable
      ? "Creative planning could not complete because a retryable dependency failed."
      : "Creative planning failed a deterministic validation gate.");
    this.name = "CreativePlanningProcessingError";
  }

  get safeReason() {
    return this.code;
  }
}

export const normalizeCreativePlanningFailure = (
  error: unknown,
): CreativePlanningProcessingError => {
  if (error instanceof CreativePlanningProcessingError) return error;
  if (error instanceof SemanticDirectorClientError) {
    return new CreativePlanningProcessingError(error.code, error.retryable);
  }
  if (error instanceof SemanticDecisionVerificationError) {
    return new CreativePlanningProcessingError(error.code, false);
  }
  if (error instanceof SemanticDirectorCanonicalizationError) {
    return new CreativePlanningProcessingError(error.code, false);
  }
  if (error instanceof SemanticPlanningExecutionError) {
    return new CreativePlanningProcessingError(error.code, false);
  }
  if (error instanceof DocumentContextReadError) {
    return new CreativePlanningProcessingError(error.code, false);
  }
  if (error instanceof StorageUnavailableError) {
    return new CreativePlanningProcessingError("DOCUMENT_STORAGE_UNAVAILABLE", true);
  }
  if (error instanceof VideoPromptCompilationError) {
    return new CreativePlanningProcessingError("PROMPT_COMPILATION_INVALID", false);
  }
  if (error instanceof UnsupportedVideoGenerationInputError) {
    return new CreativePlanningProcessingError("VIDEO_INPUT_INVALID", false);
  }
  return new CreativePlanningProcessingError("PLANNING_EXECUTION_UNAVAILABLE", true);
};

export const isRetryableCreativePlanningFailure = (error: unknown) =>
  normalizeCreativePlanningFailure(error).retryable;
