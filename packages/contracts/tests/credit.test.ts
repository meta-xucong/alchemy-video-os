import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationErrorCodeSchema,
  BillingChargeRequestSchema,
  CreditDebitInputSchema,
  CreditProviderSchema,
  VeyraExternalIdentitySchema,
  VeyraLoginTicketExchangeInputSchema,
  decimalToScaledUnits,
  equalCreditDecimals,
} from "../src/index.js";

const taskRunId = "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX";

test("credit contracts preserve provider and decimal receipt boundaries", () => {
  assert.equal(CreditProviderSchema.parse("veyra_sub2api"), "veyra_sub2api");
  assert.equal(decimalToScaledUnits("1.25000000"), 125000000n);
  assert.equal(equalCreditDecimals("1.25", "1.25000000"), true);

  assert.deepEqual(
    CreditDebitInputSchema.parse({
      externalUserId: 42,
      amount: "0.00000001",
      idempotencyKey: `video:mock:${taskRunId}`,
      source: "video:mock",
      referenceId: taskRunId,
    }),
    {
      externalUserId: 42,
      amount: "0.00000001",
      idempotencyKey: `video:mock:${taskRunId}`,
      source: "video:mock",
      referenceId: taskRunId,
    },
  );
  assert.throws(() => CreditDebitInputSchema.parse({ externalUserId: 42, amount: "0", idempotencyKey: "key", source: "video", referenceId: taskRunId }));
  assert.throws(() => CreditDebitInputSchema.parse({ externalUserId: 42, amount: "1.000000001", idempotencyKey: "key", source: "video", referenceId: taskRunId }));
});

test("billing charge contracts remain internal and exact", () => {
  assert.deepEqual(
    BillingChargeRequestSchema.parse({
      taskRunId,
      externalUserId: 42,
      billingRule: {
        creditProvider: "veyra_sub2api",
        billingRuleKey: "video:mock-v1",
        chargeAmount: "1.25000000",
        source: "video:mock-v1",
      },
    }).billingRule.chargeAmount,
    "1.25000000",
  );
  assert.equal(ApplicationErrorCodeSchema.parse("CREDIT_REJECTED"), "CREDIT_REJECTED");
});

test("Veyra login ticket contracts are video-intent only and internal", () => {
  assert.deepEqual(
    VeyraLoginTicketExchangeInputSchema.parse({ ticket: "0123456789abcdef0123456789abcdef" }),
    { ticket: "0123456789abcdef0123456789abcdef", expectedIntent: "video" },
  );
  assert.throws(() => VeyraLoginTicketExchangeInputSchema.parse({ ticket: "short" }));
  assert.throws(() =>
    VeyraLoginTicketExchangeInputSchema.parse({ ticket: "0123456789abcdef0123456789abcdef", expectedIntent: "alchemy" }),
  );

  assert.deepEqual(
    VeyraExternalIdentitySchema.parse({
      externalUserId: 42,
      intent: "video",
      email: "video-canary@example.test",
      role: "owner",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }).intent,
    "video",
  );
  assert.throws(() =>
    VeyraExternalIdentitySchema.parse({
      externalUserId: 42,
      intent: "alchemy",
      email: "video-canary@example.test",
      role: "owner",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
  );
});
