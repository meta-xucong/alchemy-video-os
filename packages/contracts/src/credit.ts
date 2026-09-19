import { z } from "zod";

import { DecimalStringSchema, TaskRunIdSchema, UtcTimestampSchema } from "./primitives.js";

export const CreditProviderSchema = z.literal("veyra_sub2api");

export const VeyraLoginIntentSchema = z.literal("video");

export const VeyraLoginTicketExchangeInputSchema = z.object({
  ticket: z.string().min(16).max(512),
  expectedIntent: VeyraLoginIntentSchema.default("video"),
}).strict();

export const VeyraExternalIdentitySchema = z.object({
  externalUserId: z.number().int().positive(),
  intent: VeyraLoginIntentSchema,
  email: z.string().min(1).nullable(),
  role: z.string().min(1).nullable(),
  expiresAt: UtcTimestampSchema,
}).strict();

export const CreditDecimalSchema = DecimalStringSchema;
export const PositiveCreditAmountSchema = CreditDecimalSchema.refine(
  (value) => decimalToScaledUnits(value) > 0n,
  "Credit debit amounts must be greater than zero.",
);
// Fixed service fees may be explicitly disabled with zero while still using
// the same decimal representation as actual provider usage.
export const NonNegativeCreditAmountSchema = CreditDecimalSchema;

export const CreditAccountSchema = z.object({
  externalUserId: z.number().int().positive(),
  email: z.string().min(1),
  role: z.string().min(1),
  balance: CreditDecimalSchema,
  status: z.string().min(1),
  concurrency: z.number().int().nonnegative(),
}).strict();

export const PublicCreditRoleSchema = z.string().trim().min(1).max(64);

// The Control API account panel exposes only the provider-neutral account
// summary.  The external numeric identity remains an internal adapter fact.
export const PublicCreditAccountSchema = CreditAccountSchema
  .omit({ externalUserId: true })
  .extend({ role: PublicCreditRoleSchema });

/**
 * Public, read-only view of the effective Video OS billing policy.  The
 * policy is loaded from the server environment; no credential or account
 * identifier is exposed and the browser cannot mutate it.
 */
export const BillingPolicySourceSchema = z.enum(["SERVER_ENVIRONMENT", "SERVER_SETTINGS", "DISABLED"]);
export const BillingPolicyModeSchema = z.enum(["DISABLED", "FIXED_AMOUNT", "FIXED_TIERS", "USAGE_PLUS_SERVICE_FEE"]);

/**
 * A server-owned fixed price row.  The generation request must match all
 * three provider dimensions exactly; no range or nearest-tier semantics are
 * implied by this shape.
 */
export const FixedVideoBillingTierSchema = z.object({
  key: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(128),
  resolution: z.string().trim().min(1).max(32),
  duration_seconds: z.number().int().positive(),
  charge_amount: PositiveCreditAmountSchema,
  enabled: z.boolean(),
}).strict();

const validateFixedTierIdentity = (value: { tiers: readonly z.infer<typeof FixedVideoBillingTierSchema>[] }, context: z.RefinementCtx) => {
  const tiers = value.tiers;
  const keys = new Set<string>();
  const identities = new Set<string>();
  tiers.forEach((tier, index) => {
    if (keys.has(tier.key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers", index, "key"], message: "Fixed billing tier keys must be unique." });
    }
    keys.add(tier.key);
    if (!tier.enabled) return;
    const identity = `${tier.model}\u0000${tier.resolution}\u0000${tier.duration_seconds}`;
    if (identities.has(identity)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers", index], message: "Enabled fixed billing tiers must not share the same model, resolution, and duration." });
    }
    identities.add(identity);
  });
};

const fixedVideoBillingSettingsShape = {
  enabled: z.boolean(),
  tiers: z.array(FixedVideoBillingTierSchema),
} as const;

export const FixedVideoBillingSettingsSchema = z.object(fixedVideoBillingSettingsShape).strict().superRefine(validateFixedTierIdentity);

export const FixedVideoBillingSettingsUpdateSchema = FixedVideoBillingSettingsSchema;

/** Private immutable copy carried by a ProductionRun budget guard. */
export const FixedVideoBillingPolicySnapshotSchema = z.object({
  ...fixedVideoBillingSettingsShape,
  provider_model: z.string().trim().min(1).max(128),
  external_user_id: z.number().int().positive(),
}).strict().superRefine(validateFixedTierIdentity);

export const BillingPolicySummarySchema = z.object({
  enabled: z.boolean(),
  mode: BillingPolicyModeSchema,
  surcharge_multiplier: NonNegativeCreditAmountSchema.nullable(),
  fixed_fee: NonNegativeCreditAmountSchema.nullable(),
  charge_amount: PositiveCreditAmountSchema.nullable(),
  model_multipliers: z.record(z.string().min(1).max(128), PositiveCreditAmountSchema),
  source: BillingPolicySourceSchema,
  fixed_tiers: z.array(FixedVideoBillingTierSchema).optional(),
}).strict();
export type BillingPolicySummary = z.infer<typeof BillingPolicySummarySchema>;

export const CreditDebitInputSchema = z.object({
  externalUserId: z.number().int().positive(),
  amount: PositiveCreditAmountSchema,
  idempotencyKey: z.string().min(1).max(255),
  source: z.string().min(1).max(128),
  referenceId: z.string().min(1).max(255),
}).strict();

export const CreditDebitResultSchema = z.object({
  externalUserId: z.number().int().positive(),
  amount: PositiveCreditAmountSchema,
  balanceAfter: CreditDecimalSchema,
  idempotencyKey: z.string().min(1).max(255),
  replayed: z.boolean(),
}).strict();

/**
 * A usage-based rule freezes the model and Video OS service-fee parameters at
 * task creation. The provider's actual usage is deliberately resolved after
 * the artifact has passed validation; persisting an estimate here would turn
 * a usage charge into a fixed-price charge.
 *
 * `multiplier` and `fixedFee` describe the Video OS addition, not the
 * Sub2API/provider base charge. Existing snapshots without `fixedFee` remain
 * valid and retain their historical pure-multiplier behavior.
 */
export const BillingUsagePricingSchema = z.object({
  model: z.string().min(1).max(128),
  multiplier: PositiveCreditAmountSchema,
  fixedFee: NonNegativeCreditAmountSchema.optional(),
}).strict();

export const BillingRuleSnapshotSchema = z.object({
  creditProvider: CreditProviderSchema,
  billingRuleKey: z.string().min(1).max(128),
  // Existing fixed-price snapshots remain readable. New usage-based snapshots
  // omit this field and carry only usage_pricing.
  chargeAmount: PositiveCreditAmountSchema.optional(),
  usagePricing: BillingUsagePricingSchema.optional(),
  source: z.string().min(1).max(128),
}).strict().superRefine((rule, context) => {
  if (rule.chargeAmount === undefined && rule.usagePricing === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["chargeAmount"], message: "A billing rule requires a fixed amount or usage pricing." });
  }
  if (rule.chargeAmount !== undefined && rule.usagePricing !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["usagePricing"], message: "A billing rule cannot mix fixed amount and usage pricing." });
  }
});

export const BillingChargeRequestSchema = z.object({
  taskRunId: TaskRunIdSchema,
  externalUserId: z.number().int().positive(),
  billingRule: BillingRuleSnapshotSchema,
}).strict();

export type CreditProvider = z.infer<typeof CreditProviderSchema>;
export type VeyraLoginIntent = z.infer<typeof VeyraLoginIntentSchema>;
export type VeyraLoginTicketExchangeInput = z.infer<typeof VeyraLoginTicketExchangeInputSchema>;
export type VeyraExternalIdentity = z.infer<typeof VeyraExternalIdentitySchema>;
export type CreditAccount = z.infer<typeof CreditAccountSchema>;
export type PublicCreditAccount = z.infer<typeof PublicCreditAccountSchema>;
export type CreditDebitInput = z.infer<typeof CreditDebitInputSchema>;
export type CreditDebitResult = z.infer<typeof CreditDebitResultSchema>;
export type BillingUsagePricing = z.infer<typeof BillingUsagePricingSchema>;
export type BillingRuleSnapshot = z.infer<typeof BillingRuleSnapshotSchema>;
export type BillingChargeRequest = z.infer<typeof BillingChargeRequestSchema>;
export type FixedVideoBillingTier = z.infer<typeof FixedVideoBillingTierSchema>;
export type FixedVideoBillingSettings = z.infer<typeof FixedVideoBillingSettingsSchema>;
export type FixedVideoBillingSettingsUpdate = z.infer<typeof FixedVideoBillingSettingsUpdateSchema>;
export type FixedVideoBillingPolicySnapshot = z.infer<typeof FixedVideoBillingPolicySnapshotSchema>;

export const decimalToScaledUnits = (value: string): bigint => {
  const parsed = CreditDecimalSchema.parse(value);
  const [whole, fraction = ""] = parsed.split(".");
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
};

export const canonicalCreditDecimal = (value: string): string => {
  const parsed = CreditDecimalSchema.parse(value);
  const [whole, fraction = ""] = parsed.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
};

export const equalCreditDecimals = (left: string, right: string): boolean =>
  decimalToScaledUnits(left) === decimalToScaledUnits(right);
