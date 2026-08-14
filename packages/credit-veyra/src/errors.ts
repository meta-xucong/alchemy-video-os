import type { CreditFailureCode } from "./port.js";

export class CreditPortError extends Error {
  constructor(
    readonly code: CreditFailureCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "CreditPortError";
  }
}
