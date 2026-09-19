import type {
  CreditAccount,
  CreditDebitInput,
  CreditDebitResult,
  VeyraExternalIdentity,
} from "@alchemy-video/contracts";

import type { CreditPort } from "./port.js";
import type { VeyraIdentityPort } from "./identity-port.js";

/**
 * Thin composition boundary for the Video OS handoff.
 *
 * The identity and credit adapters remain independently testable and keep
 * their existing upstream protocol mapping. This facade only fixes the
 * Video-specific intent and prevents callers from accidentally exchanging an
 * Alchemy/Sub2API ticket for a Video session.
 */
export class VideoVeyraBridgeAdapter {
  constructor(
    private readonly identity: VeyraIdentityPort,
    private readonly credit: CreditPort,
  ) {}

  async exchangeVideoTicket(input: { ticket: string }): Promise<VeyraExternalIdentity> {
    return this.identity.exchangeTicket({ ticket: input.ticket, expectedIntent: "video" });
  }

  async getAccount(input: { externalUserId: number }): Promise<CreditAccount> {
    return this.credit.getAccount(input);
  }

  async debit(input: CreditDebitInput): Promise<CreditDebitResult> {
    return this.credit.debit(input);
  }

  async exchangeVideoTicketAndGetAccount(input: { ticket: string }): Promise<{
    identity: VeyraExternalIdentity;
    account: CreditAccount;
  }> {
    const identity = await this.exchangeVideoTicket(input);
    const account = await this.getAccount({ externalUserId: identity.externalUserId });
    if (account.externalUserId !== identity.externalUserId) {
      throw new Error("The Veyra account identity does not match the exchanged Video ticket.");
    }
    return { identity, account };
  }
}
