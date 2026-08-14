import {
  canonicalCreditDecimal,
  CreditAccountSchema,
  CreditDebitInputSchema,
  CreditDebitResultSchema,
  decimalToScaledUnits,
  equalCreditDecimals,
  type CreditAccount,
  type CreditDebitInput,
  type CreditDebitResult,
} from "@alchemy-video/contracts";

import { CreditPortError } from "./errors.js";
import type { VeyraCreditTransportResponse } from "./transport.js";

const MAX_SAFE_SCALED_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

type JsonObject = Record<string, unknown>;

const invalidResponse = (): CreditPortError =>
  new CreditPortError("CREDIT_UNAVAILABLE", false, "The credit service returned an invalid response.");

const requireObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as JsonObject;
};

const positiveSafeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidResponse();
  }
  return value;
};

const nonNegativeSafeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse();
  }
  return value;
};

const nonEmptyString = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidResponse();
  }
  return value;
};

const decimalFromVeyraNumber = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidResponse();
  }

  const candidate = canonicalCreditDecimal(value.toFixed(8));
  if (Number(candidate) !== value || decimalToScaledUnits(candidate) > MAX_SAFE_SCALED_UNITS) {
    throw invalidResponse();
  }
  return candidate;
};

const responseData = (response: VeyraCreditTransportResponse): JsonObject => {
  switch (response.status) {
    case 401:
    case 403:
      throw new CreditPortError("AUTH_FORBIDDEN", true, "The credit service rejected the service credential.");
    case 402:
      throw new CreditPortError("CREDIT_INSUFFICIENT", false, "The credit account has insufficient balance.");
    case 409:
      throw new CreditPortError("CREDIT_CONFLICT", false, "The credit debit conflicted with its idempotency key.");
    default:
      if (response.status >= 500) {
        throw new CreditPortError("CREDIT_UNAVAILABLE", true, "The credit service is temporarily unavailable.");
      }
      if (response.status < 200 || response.status >= 300) {
        throw new CreditPortError("CREDIT_REJECTED", false, "The credit service rejected the request.");
      }
  }

  const body = requireObject(response.body);
  return requireObject(body.data);
};

export const creditDecimalToVeyraNumber = (value: string): number => {
  const canonical = canonicalCreditDecimal(value);
  if (decimalToScaledUnits(canonical) > MAX_SAFE_SCALED_UNITS) {
    throw new CreditPortError("CREDIT_REJECTED", false, "The credit amount cannot be represented safely upstream.");
  }

  const numeric = Number(canonical);
  if (!Number.isFinite(numeric) || !equalCreditDecimals(canonical, decimalFromVeyraNumber(numeric))) {
    throw new CreditPortError("CREDIT_REJECTED", false, "The credit amount cannot be represented safely upstream.");
  }
  return numeric;
};

export const mapVeyraAccountResponse = (response: VeyraCreditTransportResponse): CreditAccount => {
  const data = responseData(response);
  return CreditAccountSchema.parse({
    externalUserId: positiveSafeInteger(data.user_id),
    email: nonEmptyString(data.email),
    role: nonEmptyString(data.role),
    balance: decimalFromVeyraNumber(data.balance),
    status: nonEmptyString(data.status),
    concurrency: nonNegativeSafeInteger(data.concurrency),
  });
};

export const mapVeyraDebitResponse = (
  response: VeyraCreditTransportResponse,
  input: CreditDebitInput,
): CreditDebitResult => {
  const data = responseData(response);
  const result = CreditDebitResultSchema.parse({
    externalUserId: positiveSafeInteger(data.user_id),
    amount: decimalFromVeyraNumber(data.amount),
    balanceAfter: decimalFromVeyraNumber(data.balance_after),
    idempotencyKey: nonEmptyString(data.idempotency_key),
    replayed: data.replayed,
  });

  if (
    result.externalUserId !== input.externalUserId ||
    result.idempotencyKey !== input.idempotencyKey ||
    !equalCreditDecimals(result.amount, input.amount)
  ) {
    throw invalidResponse();
  }
  return result;
};

export const mapVeyraDebitRequest = (input: CreditDebitInput): JsonObject => {
  const parsed = CreditDebitInputSchema.parse(input);
  return {
    user_id: parsed.externalUserId,
    amount: creditDecimalToVeyraNumber(parsed.amount),
    idempotency_key: parsed.idempotencyKey,
    source: parsed.source,
    reference_id: parsed.referenceId,
  };
};
