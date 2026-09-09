import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainInvariantError,
  calculateUsageCharge,
  calculateVideoUsageCharge,
  createBillingDebitPlan,
  parseVideoBillingFixedFee,
  parseVideoBillingModelRates,
  parseVideoBillingSurchargeMultiplier,
} from "../src/index.js";

const taskRunId = "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX";

test("video usage billing multiplies actual cost by the frozen model ratio", () => {
  assert.equal(calculateVideoUsageCharge({
    usage: { providerRequestId: "req_grok_001", model: "grok-imagine-video-1.5", actualCost: "0.25" },
    pricing: { model: "grok-imagine-video-1.5", multiplier: "1.20" },
  }), "0.3");
  assert.equal(calculateVideoUsageCharge({
    usage: { providerRequestId: "req_seedance_001", model: "seedance-2.5", actualCost: "0.12345678" },
    pricing: { model: "seedance-2.5", multiplier: "1.25" },
  }), "0.15432098");
});

test("media usage billing adds the Video OS surcharge and fixed service fee", () => {
  assert.equal(calculateUsageCharge({
    usage: { providerRequestId: "req_grok_001", model: "grok-imagine-video-1.5", actualCost: "0.084" },
    pricing: { model: "grok-imagine-video-1.5", multiplier: "0.20", fixedFee: "1" },
  }), "1.0168");
  assert.equal(calculateVideoUsageCharge({
    usage: { providerRequestId: "req_chatgpt_001", model: "chatgpt-image", actualCost: "0.125" },
    pricing: { model: "chatgpt-image", multiplier: "0.20", fixedFee: "1" },
  }), "1.025");
});

test("usage billing rejects missing or mismatched usage instead of estimating", () => {
  assert.throws(
    () => createBillingDebitPlan({
      taskRunId,
      externalUserId: 42,
      billingRule: {
        creditProvider: "veyra_sub2api",
        billingRuleKey: "video:usage-ratio:grok",
        usagePricing: { model: "grok", multiplier: "1.2" },
        source: "video:aiself-actual-cost-ratio",
      },
    }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "BILLING_USAGE_REQUIRED",
  );
  assert.throws(
    () => calculateVideoUsageCharge({
      usage: { providerRequestId: "req_001", model: "seedance-2.5", actualCost: "0.2" },
      pricing: { model: "grok", multiplier: "1.2" },
    }),
    (error: unknown) => error instanceof DomainInvariantError && error.code === "BILLING_USAGE_MISMATCH",
  );
});

test("video billing model rates are explicit and fail closed", () => {
  assert.deepEqual(parseVideoBillingModelRates('{"grok-imagine-video-1.5":"1.20","seedance-2.5":"1.35"}'), {
    "grok-imagine-video-1.5": "1.20",
    "seedance-2.5": "1.35",
  });
  assert.deepEqual(parseVideoBillingModelRates(undefined), {});
  assert.throws(() => parseVideoBillingModelRates('{"grok-imagine-video-1.5":0}'));
});

test("Video OS service-fee environment values use the shared decimal boundary", () => {
  assert.equal(parseVideoBillingSurchargeMultiplier(" 0.20 "), "0.20");
  assert.equal(parseVideoBillingFixedFee("1"), "1");
  assert.equal(parseVideoBillingFixedFee("0"), "0");
  assert.equal(parseVideoBillingSurchargeMultiplier(undefined), undefined);
  assert.equal(parseVideoBillingFixedFee(undefined), undefined);
  assert.throws(() => parseVideoBillingSurchargeMultiplier("0"));
  assert.throws(() => parseVideoBillingFixedFee("-1"));
});
