import {
  BillingChargeRequestSchema,
  CreditDebitInputSchema,
  CreditDebitResultSchema,
  equalCreditDecimals,
  type BillingChargeRequest,
  type CreditDebitInput,
  type CreditDebitResult,
} from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";
import { calculateUsageCharge, type MediaUsageFact } from "./video-billing.js";

/**
 * Billing failures are the only retryable task errors that may resume from
 * RETRY_SCHEDULED into the already-generated billing phase.  Keeping this
 * list beside the debit-plan semantics prevents a provider retry from being
 * mistaken for a second debit.
 */
export const BILLING_RETRY_ERROR_CODES = [
  "AUTH_FORBIDDEN",
  "AUTH_UNAVAILABLE",
  "CREDIT_INSUFFICIENT",
  "CREDIT_CONFLICT",
  "CREDIT_UNAVAILABLE",
  "CREDIT_REJECTED",
] as const;

export type BillingRetryErrorCode = (typeof BILLING_RETRY_ERROR_CODES)[number];

export const isBillingRetryErrorCode = (value: unknown): value is BillingRetryErrorCode =>
  typeof value === "string" && (BILLING_RETRY_ERROR_CODES as readonly string[]).includes(value);

export type BillingDebitPlan = {
  creditProvider: "veyra_sub2api";
  taskRunId: string;
  debit: CreditDebitInput;
};

export type UsageReceipt = {
  creditProvider: "veyra_sub2api";
  taskRunId: string;
  externalUserId: string;
  amount: string;
  source: string;
  referenceId: string;
  idempotencyKey: string;
  balanceAfter: string;
  replayed: boolean;
};

export const billingIdempotencyKey = (billingRuleKey: string, taskRunId: string): string =>
  `${billingRuleKey}:${taskRunId}`;

export const createBillingDebitPlan = (request: BillingChargeRequest, usage?: MediaUsageFact): BillingDebitPlan => {
  const parsed = BillingChargeRequestSchema.parse(request);
  const amount = parsed.billingRule.chargeAmount
    ?? (parsed.billingRule.usagePricing && usage
      ? calculateUsageCharge({ usage, pricing: parsed.billingRule.usagePricing })
      : undefined);
  if (!amount) {
    throw new DomainInvariantError(
      "BILLING_USAGE_REQUIRED",
      "A provider usage fact is required before this media can be billed.",
    );
  }
  const debit = CreditDebitInputSchema.parse({
    externalUserId: parsed.externalUserId,
    amount,
    idempotencyKey: billingIdempotencyKey(parsed.billingRule.billingRuleKey, parsed.taskRunId),
    source: parsed.billingRule.source,
    referenceId: parsed.taskRunId,
  });

  return {
    creditProvider: parsed.billingRule.creditProvider,
    taskRunId: parsed.taskRunId,
    debit,
  };
};

export const createUsageReceipt = (plan: BillingDebitPlan, result: CreditDebitResult): UsageReceipt => {
  const parsedResult = CreditDebitResultSchema.parse(result);

  if (
    parsedResult.externalUserId !== plan.debit.externalUserId ||
    !equalCreditDecimals(parsedResult.amount, plan.debit.amount) ||
    parsedResult.idempotencyKey !== plan.debit.idempotencyKey
  ) {
    throw new DomainInvariantError(
      "BILLING_RECEIPT_INVALID",
      "Credit debit result does not match the immutable billing input.",
    );
  }

  return {
    creditProvider: plan.creditProvider,
    taskRunId: plan.taskRunId,
    externalUserId: String(parsedResult.externalUserId),
    amount: parsedResult.amount,
    source: plan.debit.source,
    referenceId: plan.debit.referenceId,
    idempotencyKey: plan.debit.idempotencyKey,
    balanceAfter: parsedResult.balanceAfter,
    replayed: parsedResult.replayed,
  };
};

export const assertUsageReceiptReplay = (existing: UsageReceipt, next: UsageReceipt): void => {
  const sameReceipt =
    existing.creditProvider === next.creditProvider &&
    existing.taskRunId === next.taskRunId &&
    existing.externalUserId === next.externalUserId &&
    equalCreditDecimals(existing.amount, next.amount) &&
    existing.source === next.source &&
    existing.referenceId === next.referenceId &&
    existing.idempotencyKey === next.idempotencyKey &&
    equalCreditDecimals(existing.balanceAfter, next.balanceAfter);

  if (!sameReceipt) {
    throw new DomainInvariantError(
      "IDEMPOTENCY_CONFLICT",
      "A credit receipt idempotency key cannot be reused for different debit input.",
    );
  }
};
