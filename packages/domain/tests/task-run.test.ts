import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainInvariantError,
  assertNoActiveTaskRun,
  assertProviderSubmitAllowed,
  assertResultAssetNotReplaced,
  assertTaskRunTransition,
  assertUsageReceiptReplay,
  createBillingDebitPlan,
  createUsageReceipt,
  fingerprintRequest,
  isTerminalTaskRunStatus,
  resolveIdempotency,
  TASK_RUN_TRANSITIONS,
  transitionTaskRun,
} from "../src/index.js";
import { assertDocumentConversionTransition, transitionDocumentConversion } from "../src/index.js";
import {
  assertCreativeRevisionTransition,
  assertProductionRunCreatable,
  assertProductionRunTransition,
  assertStoryboardPlan,
} from "../src/index.js";
import {
  assertProductionAcceptanceCount,
  assertProductionSegmentDependencies,
  assertProductionSegmentTransition,
} from "../src/index.js";

test("C11 creative revisions require review before approval and remain immutable after approval", () => {
  assert.doesNotThrow(() => assertCreativeRevisionTransition("DRAFT", "PLANNING"));
  assert.doesNotThrow(() => assertCreativeRevisionTransition("PLANNING", "READY_FOR_REVIEW"));
  assert.doesNotThrow(() => assertCreativeRevisionTransition("READY_FOR_REVIEW", "APPROVED"));
  assert.doesNotThrow(() => assertCreativeRevisionTransition("APPROVED", "SUPERSEDED"));
  assert.throws(
    () => assertCreativeRevisionTransition("APPROVED", "PLANNING"),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "CREATIVE_PLAN_STATE_INVALID",
  );
});

test("C11 storyboard plans use ordered event boundaries rather than length slicing", () => {
  assert.doesNotThrow(() => assertStoryboardPlan({
    totalDurationSeconds: 24,
    specs: [
      { sequence: 1, durationSeconds: 8, dependsOnSequences: [] },
      { sequence: 2, durationSeconds: 8, dependsOnSequences: [1] },
      { sequence: 3, durationSeconds: 8, dependsOnSequences: [2] },
    ],
  }));
  assert.throws(
    () => assertStoryboardPlan({ totalDurationSeconds: 16, specs: [{ sequence: 2, durationSeconds: 16, dependsOnSequences: [] }] }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "STORYBOARD_SPEC_INVALID",
  );
  assert.throws(
    () => assertStoryboardPlan({ totalDurationSeconds: 8, specs: [{ sequence: 1, durationSeconds: 8, dependsOnSequences: [1] }] }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "STORYBOARD_SPEC_INVALID",
  );
});

test("C11 production confirmation requires an approved plan and does not imply execution", () => {
  assert.doesNotThrow(() => assertProductionRunCreatable("APPROVED"));
  assert.throws(
    () => assertProductionRunCreatable("READY_FOR_REVIEW"),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "PRODUCTION_RUN_STATE_INVALID",
  );
  assert.doesNotThrow(() => assertProductionRunTransition("DRAFT", "PLAN_READY"));
  assert.doesNotThrow(() => assertProductionRunTransition("PLAN_READY", "CONFIRMED"));
  assert.throws(
    () => assertProductionRunTransition("PLAN_READY", "GENERATING"),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "PRODUCTION_RUN_STATE_INVALID",
  );
});

test("C12 segment state and dependency invariants preserve accepted work", () => {
  assert.doesNotThrow(() => assertProductionSegmentTransition("PENDING", "GENERATING"));
  assert.doesNotThrow(() => assertProductionSegmentTransition("GENERATING", "CHECKING"));
  assert.doesNotThrow(() => assertProductionSegmentTransition("CHECKING", "ACCEPTED"));
  assert.doesNotThrow(() => assertProductionSegmentTransition("FAILED", "GENERATING"));
  assert.throws(
    () => assertProductionSegmentTransition("ACCEPTED", "GENERATING"),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "PRODUCTION_SEGMENT_STATE_INVALID",
  );
  assert.doesNotThrow(() => assertProductionSegmentDependencies({ sequence: 3, dependencySequences: [1, 2], acceptedSequences: [1, 2] }));
  assert.throws(
    () => assertProductionSegmentDependencies({ sequence: 3, dependencySequences: [2], acceptedSequences: [1] }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "PRODUCTION_SEGMENT_STATE_INVALID",
  );
  assert.doesNotThrow(() => assertProductionAcceptanceCount({ acceptedShotCount: 2, totalShotCount: 3 }));
  assert.throws(
    () => assertProductionAcceptanceCount({ acceptedShotCount: 4, totalShotCount: 3 }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "PRODUCTION_SEGMENT_STATE_INVALID",
  );
});

test("DocumentConversion has a separate retryable state machine", () => {
  assert.doesNotThrow(() => assertDocumentConversionTransition("FAILED", "QUEUED"));
  assert.throws(() => assertDocumentConversionTransition("SUCCEEDED", "QUEUED"));
  assert.throws(() => transitionDocumentConversion(
    { id: "dcv_1", status: "RUNNING", sourceAssetId: "ast_1", markdownAssetId: null },
    { status: "SUCCEEDED", markdownAssetId: null },
  ));
});

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

test("billing plans freeze debit inputs and receipt replay rejects a changed charge", () => {
  const plan = createBillingDebitPlan({
    taskRunId: state.id,
    externalUserId: 42,
    billingRule: {
      creditProvider: "veyra_sub2api",
      billingRuleKey: "video:mock-v1",
      chargeAmount: "1.25000000",
      source: "video:mock-v1",
    },
  });
  assert.deepEqual(plan.debit, {
    externalUserId: 42,
    amount: "1.25000000",
    idempotencyKey: `video:mock-v1:${state.id}`,
    source: "video:mock-v1",
    referenceId: state.id,
  });

  const receipt = createUsageReceipt(plan, {
    externalUserId: 42,
    amount: "1.25",
    balanceAfter: "8.75",
    idempotencyKey: plan.debit.idempotencyKey,
    replayed: false,
  });
  assert.doesNotThrow(() => assertUsageReceiptReplay(receipt, { ...receipt, replayed: true }));
  assert.throws(
    () => assertUsageReceiptReplay(receipt, { ...receipt, source: "video:other" }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.throws(
    () =>
      createUsageReceipt(plan, {
        externalUserId: plan.debit.externalUserId,
        amount: "1.5",
        balanceAfter: "8.5",
        idempotencyKey: plan.debit.idempotencyKey,
        replayed: false,
      }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "BILLING_RECEIPT_INVALID",
  );
});
