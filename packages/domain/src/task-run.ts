import {
  TASK_RUN_TERMINAL_STATUSES,
  type TaskRunStatus,
} from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";
import { canonicalJson } from "./idempotency.js";

export const TASK_RUN_TRANSITIONS: Readonly<Record<TaskRunStatus, readonly TaskRunStatus[]>> = {
  CREATED: ["QUEUED"],
  QUEUED: ["RUNNING", "FAILED", "RETRY_SCHEDULED", "ABANDONED"],
  RUNNING: ["PROVIDER_PROCESSING", "FAILED", "RETRY_SCHEDULED"],
  PROVIDER_PROCESSING: ["DOWNLOADING", "FAILED", "RETRY_SCHEDULED"],
  DOWNLOADING: ["SUCCEEDED", "BILLING_PENDING", "FAILED", "RETRY_SCHEDULED"],
  BILLING_PENDING: ["SUCCEEDED", "BILLING_FAILED", "RETRY_SCHEDULED"],
  SUCCEEDED: [],
  BILLING_FAILED: ["BILLING_PENDING"],
  FAILED: ["QUEUED"],
  RETRY_SCHEDULED: ["QUEUED"],
  ABANDONED: [],
};

const TERMINAL_STATUSES = new Set<TaskRunStatus>(TASK_RUN_TERMINAL_STATUSES);

export type TaskRunState = {
  id: string;
  status: TaskRunStatus;
  inputSnapshot: Record<string, unknown>;
  resultAssetId: string | null;
  providerRequestId: string | null;
};

export const isTerminalTaskRunStatus = (status: TaskRunStatus): boolean => TERMINAL_STATUSES.has(status);

export const assertTaskRunTransition = (from: TaskRunStatus, to: TaskRunStatus): void => {
  if (!TASK_RUN_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("TASK_STATE_INVALID", `Cannot transition TaskRun from ${from} to ${to}.`);
  }
};

export const assertInputSnapshotImmutable = (
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): void => {
  if (canonicalJson(previous) !== canonicalJson(next)) {
    throw new DomainInvariantError(
      "INPUT_SNAPSHOT_IMMUTABLE",
      "TaskRun input_snapshot cannot change after creation.",
    );
  }
};

export const assertResultAssetInvariant = (state: Pick<TaskRunState, "status" | "resultAssetId">): void => {
  if (state.status === "SUCCEEDED" && !state.resultAssetId) {
    throw new DomainInvariantError(
      "RESULT_ASSET_IMMUTABLE",
      "A succeeded TaskRun requires a result_asset_id.",
    );
  }

  if (state.status !== "SUCCEEDED" && state.resultAssetId) {
    throw new DomainInvariantError(
      "RESULT_ASSET_IMMUTABLE",
      "result_asset_id cannot be published before TaskRun succeeds.",
    );
  }
};

export const assertResultAssetNotReplaced = (previous: string | null, next: string | null): void => {
  if (previous && next !== previous) {
    throw new DomainInvariantError(
      "RESULT_ASSET_IMMUTABLE",
      "A successful TaskRun result_asset_id cannot be replaced.",
    );
  }
};

export const assertProviderSubmitAllowed = (providerRequestId: string | null): void => {
  if (providerRequestId) {
    throw new DomainInvariantError(
      "PROVIDER_RESUBMIT_FORBIDDEN",
      "A TaskRun with provider_request_id may be queried or downloaded but not submitted again.",
    );
  }
};

export const assertNoActiveTaskRun = (existingStatuses: readonly TaskRunStatus[]): void => {
  if (existingStatuses.some((status) => !isTerminalTaskRunStatus(status))) {
    throw new DomainInvariantError(
      "ACTIVE_TASK_RUN_EXISTS",
      "A Shot can have at most one non-terminal TaskRun.",
    );
  }
};

export const transitionTaskRun = (
  previous: TaskRunState,
  next: Omit<TaskRunState, "id">,
): TaskRunState => {
  assertTaskRunTransition(previous.status, next.status);
  assertInputSnapshotImmutable(previous.inputSnapshot, next.inputSnapshot);
  assertResultAssetNotReplaced(previous.resultAssetId, next.resultAssetId);
  assertResultAssetInvariant(next);
  return { id: previous.id, ...next };
};
