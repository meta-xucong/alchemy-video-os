import assert from "node:assert/strict";
import test from "node:test";

import { CreditPortError, type CreditPort } from "@alchemy-video/credit-veyra";
import type { CreditDebitInput, CreditDebitResult } from "@alchemy-video/contracts";

import { VideoBillingExecutor, type BillingAttemptStore } from "../src/billing-executor.js";

const workspaceId = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX";
const taskRunId = "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX";
const chargeRequest = {
  taskRunId,
  externalUserId: 20260816,
  billingRule: {
    creditProvider: "veyra_sub2api" as const,
    billingRuleKey: "video:grok-imagine-video-1.5",
    chargeAmount: "0.10000000",
    source: "video:grok-imagine-video-1.5",
  },
};

class FakeCreditPort implements CreditPort {
  readonly debits: CreditDebitInput[] = [];

  constructor(private readonly responses: Array<CreditDebitResult | Error>) {}

  async getAccount() {
    throw new CreditPortError("CREDIT_UNAVAILABLE", false, "not used by this focused executor test");
  }

  async debit(input: CreditDebitInput): Promise<CreditDebitResult> {
    this.debits.push(input);
    const response = this.responses.shift();
    if (!response) throw new CreditPortError("CREDIT_UNAVAILABLE", true, "missing fake response");
    if (response instanceof Error) throw response;
    return response;
  }
}

class FakeBillingStore implements BillingAttemptStore {
  readonly receipts = new Map<string, { id: string; input: Parameters<BillingAttemptStore["recordUsageReceipt"]>[0] }>();
  readonly succeeded: Array<Parameters<BillingAttemptStore["markBillingSucceeded"]>[0]> = [];
  readonly failed: Array<Parameters<BillingAttemptStore["markBillingFailed"]>[0]> = [];
  readonly retried: Array<Parameters<BillingAttemptStore["scheduleBillingRetry"]>[0]> = [];

  throwBeforeFirstReceipt = false;

  async recordUsageReceipt(input: Parameters<BillingAttemptStore["recordUsageReceipt"]>[0]) {
    if (this.throwBeforeFirstReceipt) {
      this.throwBeforeFirstReceipt = false;
      throw new Error("local receipt database temporarily unavailable with sensitive upstream context");
    }
    const existing = this.receipts.get(input.idempotencyKey);
    if (existing) {
      return { kind: "REPLAYED" as const, record: { id: existing.id } };
    }
    this.receipts.set(input.idempotencyKey, { id: input.id, input });
    return { kind: "RECORDED" as const, record: { id: input.id } };
  }

  async markBillingSucceeded(input: Parameters<BillingAttemptStore["markBillingSucceeded"]>[0]) {
    this.succeeded.push(input);
  }

  async markBillingFailed(input: Parameters<BillingAttemptStore["markBillingFailed"]>[0]) {
    this.failed.push(input);
  }

  async scheduleBillingRetry(input: Parameters<BillingAttemptStore["scheduleBillingRetry"]>[0]) {
    this.retried.push(input);
  }
}

const debitResult = (replayed: boolean): CreditDebitResult => ({
  externalUserId: 20260816,
  amount: "0.1",
  balanceAfter: "9.9",
  idempotencyKey: `${chargeRequest.billingRule.billingRuleKey}:${taskRunId}`,
  replayed,
});

test("C13-A billing executor writes one receipt and marks billing succeeded after debit success", async () => {
  const credit = new FakeCreditPort([debitResult(false)]);
  const store = new FakeBillingStore();
  const executor = new VideoBillingExecutor(credit, store, {
    createUsageRecordId: () => "use_c13a_success",
    now: () => new Date("2026-08-16T00:00:00.000Z"),
  });

  const result = await executor.execute({ workspaceId, chargeRequest });

  assert.deepEqual(result, { kind: "SUCCEEDED", usageRecordId: "use_c13a_success", receiptKind: "RECORDED" });
  assert.equal(credit.debits.length, 1);
  assert.deepEqual(credit.debits[0], {
    externalUserId: 20260816,
    amount: "0.10000000",
    idempotencyKey: `${chargeRequest.billingRule.billingRuleKey}:${taskRunId}`,
    source: chargeRequest.billingRule.source,
    referenceId: taskRunId,
  });
  assert.equal(store.receipts.size, 1);
  assert.equal(store.succeeded[0]?.usageRecordId, "use_c13a_success");
});

test("C13-A billing recovery replays the same debit after local receipt crash and never changes the key", async () => {
  const credit = new FakeCreditPort([debitResult(false), debitResult(true)]);
  const store = new FakeBillingStore();
  store.throwBeforeFirstReceipt = true;
  const executor = new VideoBillingExecutor(credit, store, {
    createUsageRecordId: () => "use_c13a_recovered",
    now: () => new Date("2026-08-16T00:00:00.000Z"),
    retryDelayMs: 1_000,
  });

  const interrupted = await executor.execute({ workspaceId, chargeRequest });
  const recovered = await executor.execute({ workspaceId, chargeRequest });

  assert.equal(interrupted.kind, "RETRY_SCHEDULED");
  assert.deepEqual(recovered, { kind: "SUCCEEDED", usageRecordId: "use_c13a_recovered", receiptKind: "RECORDED" });
  assert.equal(credit.debits.length, 2);
  assert.equal(credit.debits[0]?.idempotencyKey, credit.debits[1]?.idempotencyKey);
  assert.equal(store.receipts.size, 1);
  assert.equal(store.succeeded.length, 1);
});

test("C13-A billing maps insufficient balance and idempotency conflict to terminal billing failure", async () => {
  for (const [error, expectedCode] of [
    [new CreditPortError("CREDIT_INSUFFICIENT", false, "upstream says balance secret"), "CREDIT_INSUFFICIENT"],
    [new CreditPortError("CREDIT_CONFLICT", false, "upstream says request fingerprint secret"), "CREDIT_CONFLICT"],
  ] as const) {
    const store = new FakeBillingStore();
    const result = await new VideoBillingExecutor(new FakeCreditPort([error]), store, {
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    }).execute({ workspaceId, chargeRequest });

    assert.deepEqual(result, { kind: "FAILED", code: expectedCode });
    assert.equal(store.failed[0]?.code, expectedCode);
    assert.equal(store.failed[0]?.retryable, false);
    assert.equal(JSON.stringify(store.failed).includes("secret"), false);
  }
});

test("C13-A billing schedules retry for temporary credit outages without fabricating a receipt", async () => {
  const store = new FakeBillingStore();
  const result = await new VideoBillingExecutor(
    new FakeCreditPort([new CreditPortError("CREDIT_UNAVAILABLE", true, "upstream temporary outage secret")]),
    store,
    { now: () => new Date("2026-08-16T00:00:00.000Z"), retryDelayMs: 1_000 },
  ).execute({ workspaceId, chargeRequest });

  assert.equal(result.kind, "RETRY_SCHEDULED");
  assert.equal(result.code, "CREDIT_UNAVAILABLE");
  assert.equal(store.receipts.size, 0);
  assert.equal(store.retried[0]?.retryAt.toISOString(), "2026-08-16T00:00:01.000Z");
  assert.equal(JSON.stringify(store.retried).includes("secret"), false);
});
