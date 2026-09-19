import {
  CreditDebitInputSchema,
  type CreditAccount,
  type CreditDebitInput,
  type CreditDebitResult,
} from "@alchemy-video/contracts";

import { CreditPortError } from "./errors.js";
import { mapVeyraAccountResponse, mapVeyraDebitRequest, mapVeyraDebitResponse } from "./mapper.js";
import type { CreditPort } from "./port.js";
import type { VeyraCreditTransport, VeyraCreditTransportResponse } from "./transport.js";

export type VeyraSub2ApiCreditAdapterOptions = {
  transport: VeyraCreditTransport;
  internalToken: string;
};

export class VeyraSub2ApiCreditAdapter implements CreditPort {
  private readonly headers: Readonly<Record<string, string>>;

  constructor(private readonly options: VeyraSub2ApiCreditAdapterOptions) {
    if (!options.internalToken.trim()) {
      throw new CreditPortError("AUTH_FORBIDDEN", false, "The credit service credential is not configured.");
    }
    this.headers = { "X-Veyra-Internal-Token": options.internalToken };
  }

  async getAccount(input: { externalUserId: number }): Promise<CreditAccount> {
    if (!Number.isSafeInteger(input.externalUserId) || input.externalUserId <= 0) {
      throw new CreditPortError("CREDIT_REJECTED", false, "The external user ID is invalid.");
    }

    const response = await this.request({
      method: "GET",
      path: `/api/veyra/internal/users/${input.externalUserId}/account`,
      headers: this.headers,
    });
    return mapVeyraAccountResponse(response);
  }

  async debit(input: CreditDebitInput): Promise<CreditDebitResult> {
    const parsed = CreditDebitInputSchema.parse(input);
    const response = await this.request({
      method: "POST",
      path: "/api/veyra/internal/billing/debit",
      headers: this.headers,
      body: mapVeyraDebitRequest(parsed),
    });
    return mapVeyraDebitResponse(response, parsed);
  }

  private async request(input: Parameters<VeyraCreditTransport["request"]>[0]): Promise<VeyraCreditTransportResponse> {
    try {
      return await this.options.transport.request(input);
    } catch (error) {
      if (error instanceof CreditPortError) {
        throw error;
      }
      throw new CreditPortError("CREDIT_UNAVAILABLE", true, "The credit service is temporarily unavailable.");
    }
  }
}
