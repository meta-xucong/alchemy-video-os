import type { CreditFailureCode } from "./port.js";
import type { VeyraIdentityFailureCode } from "./identity-port.js";

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

export class VeyraIdentityError extends Error {
  constructor(
    readonly code: VeyraIdentityFailureCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "VeyraIdentityError";
  }
}
