import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainInvariantError,
  assertNoActiveTaskRun,
  assertProviderSubmitAllowed,
  assertResultAssetNotReplaced,
  assertTaskRunTransition,
  fingerprintRequest,
  isTerminalTaskRunStatus,
  resolveIdempotency,
  TASK_RUN_TRANSITIONS,
  transitionTaskRun,
} from "../src/index.js";

const inputSnapshot = {
  model: "mock-video-v1",
  prompt: "A close-up product shot.",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  reference_asset_ids: ["ast_01J4N8QZ8PCW2N2G6D2XJXJXJX"],
} as const;

const state = {
  id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  status: "DOWNLOADING" as const,
  inputSnapshot,
  resultAssetId: null,
  providerRequestId: "mock_tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
};

test("allows only declared TaskRun transitions", () => {
  const succeeded = transitionTaskRun(state, {
    status: "SUCCEEDED",
    inputSnapshot,
    resultAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJY",
    providerRequestId: state.providerRequestId,
  });

  assert.equal(succeeded.status, "SUCCEEDED");
  assert.throws(
    () => transitionTaskRun(state, { ...state, status: "RUNNING" }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "TASK_STATE_INVALID",
  );
});

test("ADR-0014 preserves Mock success, explicit retry, and submit-safe cancellation", () => {
  assert.doesNotThrow(() => assertTaskRunTransition("DOWNLOADING", "SUCCEEDED"));
  assert.doesNotThrow(() => assertTaskRunTransition("FAILED", "QUEUED"));
  assert.doesNotThrow(() => assertTaskRunTransition("QUEUED", "ABANDONED"));
  assert.throws(
    () => assertTaskRunTransition("RUNNING", "ABANDONED"),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "TASK_STATE_INVALID",
  );
  assert.equal(isTerminalTaskRunStatus("ABANDONED"), true);
  assert.equal(isTerminalTaskRunStatus("BILLING_FAILED"), false);
});

test("the complete transition matrix accepts every legal edge and rejects every other edge", () => {
  const statuses = Object.keys(TASK_RUN_TRANSITIONS) as Array<keyof typeof TASK_RUN_TRANSITIONS>;

  for (const from of statuses) {
    for (const to of statuses) {
      if (TASK_RUN_TRANSITIONS[from].includes(to)) {
        assert.doesNotThrow(() => assertTaskRunTransition(from, to));
      } else {
        assert.throws(
          () => assertTaskRunTransition(from, to),
          (error: unknown) => error instanceof DomainInvariantError && error.code === "TASK_STATE_INVALID",
          `${from} -> ${to} must be rejected`,
        );
      }
    }
  }
});

test("input snapshots and successful assets are immutable", () => {
  assert.throws(
    () =>
      transitionTaskRun(state, {
        ...state,
        status: "SUCCEEDED",
        resultAssetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJY",
        inputSnapshot: { ...inputSnapshot, prompt: "Changed" },
      }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "INPUT_SNAPSHOT_IMMUTABLE",
  );

  assert.throws(
    () =>
      transitionTaskRun(state, {
        ...state,
        status: "SUCCEEDED",
        resultAssetId: null,
      }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "RESULT_ASSET_IMMUTABLE",
  );

  assert.throws(
    () => assertResultAssetNotReplaced("ast_01J4N8QZ8PCW2N2G6D2XJXJXJY", "ast_01J4N8QZ8PCW2N2G6D2XJXJXJZ"),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "RESULT_ASSET_IMMUTABLE",
  );
});

test("provider submits cannot be repeated after a request ID is durable", () => {
  assert.throws(
    () => assertProviderSubmitAllowed(state.providerRequestId),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "PROVIDER_RESUBMIT_FORBIDDEN",
  );
});

test("a Shot has at most one non-terminal TaskRun", () => {
  assert.doesNotThrow(() => assertNoActiveTaskRun(["SUCCEEDED", "FAILED", "ABANDONED"]));
  assert.throws(
    () => assertNoActiveTaskRun(["SUCCEEDED", "BILLING_FAILED"]),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "ACTIVE_TASK_RUN_EXISTS",
  );
});

test("the same idempotency request replays and a changed body conflicts", () => {
  const requestHash = fingerprintRequest({ name: "Campaign" });
  const deduplication = {
    scope: "usr_dev_owner:/api/v1/projects",
    idempotencyKey: "idem_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    requestHash,
    responseSnapshot: { project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  };

  assert.deepEqual(resolveIdempotency(deduplication, requestHash), {
    kind: "REPLAY",
    responseSnapshot: deduplication.responseSnapshot,
  });
  assert.throws(
    () => resolveIdempotency(deduplication, fingerprintRequest({ name: "Different campaign" })),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});
