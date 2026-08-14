import type {
  ApplicationErrorCode,
  CreditAccount,
  CreditDebitInput,
  CreditDebitResult,
} from "@alchemy-video/contracts";

export type CreditFailureCode = Extract<
  ApplicationErrorCode,
  "AUTH_FORBIDDEN" | "CREDIT_INSUFFICIENT" | "CREDIT_CONFLICT" | "CREDIT_UNAVAILABLE" | "CREDIT_REJECTED"
>;

export interface CreditPort {
  getAccount(input: { externalUserId: number }): Promise<CreditAccount>;
  debit(input: CreditDebitInput): Promise<CreditDebitResult>;
}
