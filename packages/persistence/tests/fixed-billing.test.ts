import assert from "node:assert/strict";
import test from "node:test";

import { resolveProductionBilling } from "../src/production-repository.js";

const policy = {
  enabled: true,
  provider_model: "grok-imagine-video-1.5",
  external_user_id: 20260916,
  tiers: [{
    key: "video:grok:480p:5",
    label: "Grok 480p 5 秒",
    model: "grok-imagine-video-1.5",
    resolution: "480p",
    duration_seconds: 5,
    charge_amount: "1.2",
    enabled: true,
  }],
};

test("production fixed billing resolves one exact segment tier", () => {
  const resolved = resolveProductionBilling({ fixed_billing_policy: policy }, {
    model: "grok-imagine-video-1.5",
    resolution: "480p",
    duration: 5,
  });
  assert.equal(resolved.kind, "BILLING");
  if (resolved.kind === "BILLING") {
    assert.equal(resolved.billing?.billing_rule.chargeAmount, "1.2");
    assert.equal(resolved.billing?.billing_rule.billingRuleKey, "video:grok:480p:5");
  }
});

test("production fixed billing blocks disabled or unmatched policies", () => {
  const disabled = resolveProductionBilling({ fixed_billing_policy: { ...policy, enabled: false } }, {
    model: policy.provider_model,
    resolution: "480p",
    duration: 5,
  });
  assert.equal(disabled.kind, "BLOCKED");

  const unmatched = resolveProductionBilling({ fixed_billing_policy: policy }, {
    model: policy.provider_model,
    resolution: "720p",
    duration: 5,
  });
  assert.equal(unmatched.kind, "BLOCKED");

  const otherProviderProfile = resolveProductionBilling({ fixed_billing_policy: policy }, {
    model: "seedance-video-v1",
    resolution: "480p",
    duration: 5,
  });
  assert.equal(otherProviderProfile.kind, "BLOCKED");
});

test("malformed fixed policy fails closed instead of falling through without billing", () => {
  const malformed = resolveProductionBilling({ fixed_billing_policy: { ...policy, tiers: "not-an-array" } }, {
    model: policy.provider_model,
    resolution: "480p",
    duration: 5,
  });
  assert.equal(malformed.kind, "BLOCKED");
});
