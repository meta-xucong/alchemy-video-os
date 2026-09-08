import type {
  BudgetReservationStatus,
  CapabilityProfileRevision,
  DeliveryPlanRevision,
  PreflightRevisionStatus,
  QualityGateAction,
  QualityGateSeverity,
  VoiceAuthorization,
} from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";

export const PREFLIGHT_REVISION_TRANSITIONS: Readonly<Record<PreflightRevisionStatus, readonly PreflightRevisionStatus[]>> = {
  DRAFT: ["PREFLIGHT_BLOCKED", "AWAITING_APPROVAL", "APPROVED", "SUPERSEDED"],
  PREFLIGHT_BLOCKED: ["DRAFT", "SUPERSEDED"],
  AWAITING_APPROVAL: ["APPROVED", "PREFLIGHT_BLOCKED", "SUPERSEDED"],
  APPROVED: ["CONSUMED", "SUPERSEDED"],
  CONSUMED: [],
  SUPERSEDED: [],
};

export const BUDGET_RESERVATION_TRANSITIONS: Readonly<Record<BudgetReservationStatus, readonly BudgetReservationStatus[]>> = {
  ESTIMATED: ["APPROVED", "REJECTED", "EXCEEDED", "RELEASED"],
  APPROVED: ["CONSUMED", "RELEASED", "EXCEEDED"],
  REJECTED: [],
  EXCEEDED: [],
  CONSUMED: [],
  RELEASED: [],
};

export const assertPreflightRevisionTransition = (from: PreflightRevisionStatus, to: PreflightRevisionStatus) => {
  if (!PREFLIGHT_REVISION_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("DELIVERY_PLAN_STATE_INVALID", `Cannot transition a preflight revision from ${from} to ${to}.`);
  }
};

export const assertBudgetReservationTransition = (from: BudgetReservationStatus, to: BudgetReservationStatus) => {
  if (!BUDGET_RESERVATION_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("BUDGET_LIMIT_EXCEEDED", `Cannot transition a budget reservation from ${from} to ${to}.`);
  }
};

export const assertDeliveryPlanCanCreateProductionRun = (plan: Pick<DeliveryPlanRevision, "status" | "block_reasons">) => {
  if (plan.status !== "APPROVED") {
    throw new DomainInvariantError("DELIVERY_PREFLIGHT_BLOCKED", "A production run requires an approved delivery preflight.");
  }
  if (plan.block_reasons.length > 0) {
    throw new DomainInvariantError("DELIVERY_PREFLIGHT_BLOCKED", "Blocked delivery reasons must be resolved before production.");
  }
};

export const assertVoiceAuthorizationUsable = (
  authorization: Pick<VoiceAuthorization, "status" | "expires_at"> | undefined,
  nowIso: string,
) => {
  if (!authorization || authorization.status !== "ACTIVE") {
    throw new DomainInvariantError("VOICE_AUTHORIZATION_REQUIRED", "A non-generic voice requires an active authorization.");
  }
  if (authorization.expires_at && authorization.expires_at <= nowIso) {
    throw new DomainInvariantError("VOICE_AUTHORIZATION_REQUIRED", "The voice authorization has expired.");
  }
};

export const assertCapabilityFeatureUsable = (
  profile: Pick<CapabilityProfileRevision, "status" | "features">,
  feature: string,
  requireLive = false,
) => {
  const usableStatus = requireLive ? profile.status === "LIVE_CERTIFIED" : profile.status === "LIVE_CERTIFIED" || profile.status === "OFFLINE_CERTIFIED";
  if (!usableStatus || profile.features[feature]?.certified !== true) {
    throw new DomainInvariantError("CAPABILITY_NOT_CERTIFIED", `Capability feature ${feature} is not certified.`);
  }
};

export const compareDecimalStrings = (left: string, right: string) => {
  const normalize = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return { whole: whole!.replace(/^0+(?=\d)/, ""), fraction: fraction.padEnd(8, "0").slice(0, 8) };
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft.whole.length !== normalizedRight.whole.length) return normalizedLeft.whole.length > normalizedRight.whole.length ? 1 : -1;
  const whole = normalizedLeft.whole.localeCompare(normalizedRight.whole);
  if (whole !== 0) return whole > 0 ? 1 : -1;
  const fraction = normalizedLeft.fraction.localeCompare(normalizedRight.fraction);
  return fraction === 0 ? 0 : fraction > 0 ? 1 : -1;
};

export const assertBudgetWithinApprovedLimit = (input: { estimatedAmount: string; approvedLimit: string }) => {
  if (compareDecimalStrings(input.estimatedAmount, input.approvedLimit) > 0) {
    throw new DomainInvariantError("BUDGET_LIMIT_EXCEEDED", "Estimated production budget exceeds the approved limit.");
  }
};

export const decideQualityGateAction = (checks: readonly { severity: QualityGateSeverity; action: QualityGateAction }[]): QualityGateAction => {
  if (checks.some((check) => check.severity === "BLOCK" || check.action === "BLOCK")) return "BLOCK";
  if (checks.some((check) => check.action === "REGENERATE_SEGMENT")) return "REGENERATE_SEGMENT";
  if (checks.some((check) => check.action === "REVISE_NARRATION")) return "REVISE_NARRATION";
  if (checks.some((check) => check.action === "REVISE_EDIT")) return "REVISE_EDIT";
  if (checks.some((check) => check.severity === "REVIEW" || check.action === "AWAITING_HUMAN_APPROVAL")) return "AWAITING_HUMAN_APPROVAL";
  return "PRESENT";
};
