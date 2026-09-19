import type { CreditAccount, CreditDebitInput, CreditDebitResult } from "@alchemy-video/contracts";

import { CreditPortError } from "./errors.js";
import type { CreditPort } from "./port.js";

export class NoopCreditAdapter implements CreditPort {
  async getAccount(_input: { externalUserId: number }): Promise<CreditAccount> {
    throw this.disabled();
  }

  async debit(_input: CreditDebitInput): Promise<CreditDebitResult> {
    throw this.disabled();
  }

  private disabled(): CreditPortError {
    return new CreditPortError("CREDIT_UNAVAILABLE", false, "Credit billing is disabled in local mock mode.");
  }
}
