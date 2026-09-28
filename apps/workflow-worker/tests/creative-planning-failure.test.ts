import assert from "node:assert/strict";
import test from "node:test";

import { StorageUnavailableError } from "@alchemy-video/storage-client";

import {
  CreativePlanningProcessingError,
  SemanticPlanningExecutionError,
  normalizeCreativePlanningFailure,
} from "../src/creative-planning-failure.js";
import { DocumentContextReadError } from "../src/document-context-reader.js";

test("planning failure normalization separates deterministic document facts from transient storage", () => {
  const deterministic = normalizeCreativePlanningFailure(
    new DocumentContextReadError("DOCUMENT_CONTEXT_OBJECT_INVALID"),
  );
  assert.equal(deterministic.code, "DOCUMENT_CONTEXT_OBJECT_INVALID");
  assert.equal(deterministic.retryable, false);

  const storage = normalizeCreativePlanningFailure(
    new StorageUnavailableError("private storage endpoint detail"),
  );
  assert.equal(storage.code, "DOCUMENT_STORAGE_UNAVAILABLE");
  assert.equal(storage.retryable, true);
  assert.doesNotMatch(storage.message, /endpoint|private storage/u);
});

test("planning failure normalization never exposes arbitrary internal messages", () => {
  const deterministic = normalizeCreativePlanningFailure(
    new SemanticPlanningExecutionError("CANONICAL_SOURCE_BUNDLE_INVALID"),
  );
  assert.equal(deterministic.code, "CANONICAL_SOURCE_BUNDLE_INVALID");
  assert.equal(deterministic.retryable, false);

  const unknown = normalizeCreativePlanningFailure(
    new Error("secret object key and upstream response body"),
  );
  assert.ok(unknown instanceof CreativePlanningProcessingError);
  assert.equal(unknown.code, "PLANNING_EXECUTION_UNAVAILABLE");
  assert.equal(unknown.retryable, true);
  assert.doesNotMatch(unknown.message, /secret|object key|response body/u);
});
