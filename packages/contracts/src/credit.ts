import { z } from "zod";

import { DecimalStringSchema, TaskRunIdSchema } from "./primitives.js";

export const CreditProviderSchema = z.literal("veyra_sub2api");

export const CreditDecimalSchema = DecimalStringSchema;
export const PositiveCreditAmountSchema = CreditDecimalSchema.refine(
  (value) => decimalToScaledUnits(value) > 0n,
  "Credit debit amounts must be greater than zero.",
);

export const CreditAccountSchema = z.object({
  externalUserId: z.number().int().positive(),
  email: z.string().min(1),
  role: z.string().min(1),
  balance: CreditDecimalSchema,
  status: z.string().min(1),
  concurrency: z.number().int().nonnegative(),
}).strict();

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

export const BillingRuleSnapshotSchema = z.object({
  creditProvider: CreditProviderSchema,
  billingRuleKey: z.string().min(1).max(128),
  chargeAmount: PositiveCreditAmountSchema,
  source: z.string().min(1).max(128),
}).strict();

export const BillingChargeRequestSchema = z.object({
  taskRunId: TaskRunIdSchema,
  externalUserId: z.number().int().positive(),
  billingRule: BillingRuleSnapshotSchema,
}).strict();

export type CreditProvider = z.infer<typeof CreditProviderSchema>;
export type CreditAccount = z.infer<typeof CreditAccountSchema>;
export type CreditDebitInput = z.infer<typeof CreditDebitInputSchema>;
export type CreditDebitResult = z.infer<typeof CreditDebitResultSchema>;
export type BillingRuleSnapshot = z.infer<typeof BillingRuleSnapshotSchema>;
export type BillingChargeRequest = z.infer<typeof BillingChargeRequestSchema>;

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
