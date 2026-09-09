import {
  BillingUsagePricingSchema,
  NonNegativeCreditAmountSchema,
  PositiveCreditAmountSchema,
  canonicalCreditDecimal,
  decimalToScaledUnits,
  type BillingUsagePricing,
} from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";

const CREDIT_SCALE = 100000000n;

export type VideoUsageFact = {
  model: string;
  actualCost: string;
  providerRequestId: string;
};

// The usage fact is provider-neutral at the billing boundary. The existing
// name remains exported for compatibility with the video worker; image
// workers can pass the same shape without introducing another pricing path.
export type MediaUsageFact = VideoUsageFact;

export const parseVideoBillingModelRates = (raw: string | undefined): Readonly<Record<string, string>> => {
  if (!raw?.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DomainInvariantError("BILLING_USAGE_INVALID", "VIDEO_BILLING_MODEL_RATES_JSON must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError("BILLING_USAGE_INVALID", "VIDEO_BILLING_MODEL_RATES_JSON must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [model, multiplier] of Object.entries(value as Record<string, unknown>)) {
    if (!model.trim()) throw new DomainInvariantError("BILLING_USAGE_INVALID", "A video billing model name must not be empty.");
    try {
      result[model] = PositiveCreditAmountSchema.parse(multiplier);
    } catch {
      throw new DomainInvariantError("BILLING_USAGE_INVALID", "A video billing multiplier must be a positive credit decimal string.");
    }
  }
  return result;
};

const scaledUnitsToDecimal = (value: bigint): string => {
  const whole = value / CREDIT_SCALE;
  const fraction = (value % CREDIT_SCALE).toString().padStart(8, "0").replace(/0+$/u, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
};

/**
 * Reuses the credit package's 8-decimal representation and performs the
 * service-fee calculation with integers. `multiplier` and `fixedFee` are the
 * Video OS addition; the Sub2API/provider actual cost is not charged again by
 * this function. The variable portion is rounded half-up to the same scale
 * accepted by Veyra; no binary floating-point amount is sent to the debit
 * adapter.
 */
export const calculateUsageCharge = (input: {
  usage: MediaUsageFact;
  pricing: BillingUsagePricing;
}): string => {
  const pricing = BillingUsagePricingSchema.parse(input.pricing);
  if (input.usage.model !== pricing.model) {
    throw new DomainInvariantError(
      "BILLING_USAGE_MISMATCH",
      "The provider usage model does not match the frozen billing rule.",
    );
  }

  let actualUnits: bigint;
  let multiplierUnits: bigint;
  let fixedFeeUnits: bigint;
  try {
    actualUnits = decimalToScaledUnits(PositiveCreditAmountSchema.parse(input.usage.actualCost));
    multiplierUnits = decimalToScaledUnits(pricing.multiplier);
    fixedFeeUnits = decimalToScaledUnits(NonNegativeCreditAmountSchema.parse(pricing.fixedFee ?? "0"));
  } catch {
    throw new DomainInvariantError(
      "BILLING_USAGE_INVALID",
      "The provider usage amount is not a positive credit decimal.",
    );
  }

  const product = actualUnits * multiplierUnits;
  const quotient = product / CREDIT_SCALE;
  const remainder = product % CREDIT_SCALE;
  const roundedVariable = remainder * 2n >= CREDIT_SCALE ? quotient + 1n : quotient;
  const total = roundedVariable + fixedFeeUnits;
  if (total <= 0n) {
    throw new DomainInvariantError("BILLING_USAGE_INVALID", "The calculated service charge must be positive.");
  }
  return canonicalCreditDecimal(scaledUnitsToDecimal(total));
};

// Keep the video-named entry point for persisted snapshots and existing
// callers. New media types should use calculateUsageCharge directly.
export const calculateVideoUsageCharge = calculateUsageCharge;

export const parseVideoBillingSurchargeMultiplier = (raw: string | undefined): string | undefined => {
  if (!raw?.trim()) return undefined;
  try {
    return PositiveCreditAmountSchema.parse(raw.trim());
  } catch {
    throw new DomainInvariantError(
      "BILLING_USAGE_INVALID",
      "VIDEO_BILLING_SURCHARGE_MULTIPLIER must be a positive credit decimal string.",
    );
  }
};

export const parseVideoBillingFixedFee = (raw: string | undefined): string | undefined => {
  if (!raw?.trim()) return undefined;
  try {
    return NonNegativeCreditAmountSchema.parse(raw.trim());
  } catch {
    throw new DomainInvariantError(
      "BILLING_USAGE_INVALID",
      "VIDEO_BILLING_FIXED_FEE must be a non-negative credit decimal string.",
    );
  }
};
