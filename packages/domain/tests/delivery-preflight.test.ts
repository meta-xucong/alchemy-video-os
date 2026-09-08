import test from "node:test";
import assert from "node:assert/strict";

import {
  assertBudgetWithinApprovedLimit,
  assertCapabilityFeatureUsable,
  assertDeliveryPlanCanCreateProductionRun,
  assertPreflightRevisionTransition,
  assertVoiceAuthorizationUsable,
  compareDecimalStrings,
  decideQualityGateAction,
} from "../src/delivery-preflight.js";
import { DomainInvariantError } from "../src/errors.js";

test("delivery preflight transitions are explicit and terminal states stay terminal", () => {
  assert.doesNotThrow(() => assertPreflightRevisionTransition("DRAFT", "AWAITING_APPROVAL"));
  assert.doesNotThrow(() => assertPreflightRevisionTransition("AWAITING_APPROVAL", "APPROVED"));
  assert.doesNotThrow(() => assertPreflightRevisionTransition("APPROVED", "CONSUMED"));
  assert.throws(() => assertPreflightRevisionTransition("CONSUMED", "APPROVED"), DomainInvariantError);
});

test("production cannot start until delivery preflight is approved and unblocked", () => {
  assert.doesNotThrow(() => assertDeliveryPlanCanCreateProductionRun({ status: "APPROVED", block_reasons: [] }));
  assert.throws(() => assertDeliveryPlanCanCreateProductionRun({ status: "AWAITING_APPROVAL", block_reasons: [] }), /approved delivery preflight/);
  assert.throws(() => assertDeliveryPlanCanCreateProductionRun({ status: "APPROVED", block_reasons: ["VOICE_AUTHORIZATION_REQUIRED"] }), /resolved/);
});

test("non-generic voices require active non-expired authorization", () => {
  assert.doesNotThrow(() => assertVoiceAuthorizationUsable({ status: "ACTIVE", expires_at: "2026-09-01T00:00:00.000Z" }, "2026-08-29T00:00:00.000Z"));
  assert.throws(() => assertVoiceAuthorizationUsable(undefined, "2026-08-29T00:00:00.000Z"), /active authorization/);
  assert.throws(() => assertVoiceAuthorizationUsable({ status: "REVOKED", expires_at: null }, "2026-08-29T00:00:00.000Z"), /active authorization/);
  assert.throws(() => assertVoiceAuthorizationUsable({ status: "ACTIVE", expires_at: "2026-08-01T00:00:00.000Z" }, "2026-08-29T00:00:00.000Z"), /expired/);
});

test("capability visibility is per-feature and fail-closed", () => {
  const profile = { status: "OFFLINE_CERTIFIED" as const, features: { piper_preview: { certified: true, limits: { free: true } } } };
  assert.doesNotThrow(() => assertCapabilityFeatureUsable(profile, "piper_preview"));
  assert.throws(() => assertCapabilityFeatureUsable(profile, "avatar_lip_sync"), /not certified/);
  assert.throws(() => assertCapabilityFeatureUsable(profile, "piper_preview", true), /not certified/);
});

test("budget comparison uses decimal strings rather than floating point", () => {
  assert.equal(compareDecimalStrings("0.30000000", "0.3"), 0);
  assert.equal(compareDecimalStrings("10.00000001", "10.00000000"), 1);
  assert.doesNotThrow(() => assertBudgetWithinApprovedLimit({ estimatedAmount: "2.50000000", approvedLimit: "2.5" }));
  assert.throws(() => assertBudgetWithinApprovedLimit({ estimatedAmount: "2.50000001", approvedLimit: "2.5" }), /exceeds/);
});

test("quality gate review never masquerades as present", () => {
  assert.equal(decideQualityGateAction([]), "PRESENT");
  assert.equal(decideQualityGateAction([{ severity: "REVIEW", action: "AWAITING_HUMAN_APPROVAL" }]), "AWAITING_HUMAN_APPROVAL");
  assert.equal(decideQualityGateAction([{ severity: "REVISE", action: "REVISE_NARRATION" }]), "REVISE_NARRATION");
  assert.equal(decideQualityGateAction([{ severity: "BLOCK", action: "PRESENT" }]), "BLOCK");
});
