import {
  VeyraExternalIdentitySchema,
  VeyraLoginTicketExchangeInputSchema,
  type VeyraExternalIdentity,
  type VeyraLoginTicketExchangeInput,
} from "@alchemy-video/contracts";

import { VeyraIdentityError } from "./errors.js";
import type { VeyraCreditTransport, VeyraCreditTransportResponse } from "./transport.js";

type JsonObject = Record<string, unknown>;

export type VeyraSub2ApiIdentityAdapterOptions = {
  transport: VeyraCreditTransport;
  internalToken: string;
  now?: () => Date;
};

const invalidIdentityResponse = (): VeyraIdentityError =>
  new VeyraIdentityError("AUTH_UNAVAILABLE", false, "The identity service returned an invalid response.");

const requireObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidIdentityResponse();
  }
  return value as JsonObject;
};

const positiveSafeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidIdentityResponse();
  }
  return value;
};

const optionalString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw invalidIdentityResponse();
  }
  return value;
};

const requiredString = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidIdentityResponse();
  }
  return value;
};

const responseData = (response: VeyraCreditTransportResponse): JsonObject => {
  switch (response.status) {
    case 401:
    case 403:
      throw new VeyraIdentityError("AUTH_FORBIDDEN", true, "The identity service rejected the service credential.");
    case 400:
    case 404:
    case 409:
      throw new VeyraIdentityError("AUTH_FORBIDDEN", false, "The login ticket is invalid, expired, or already used.");
    default:
      if (response.status >= 500) {
        throw new VeyraIdentityError("AUTH_UNAVAILABLE", true, "The identity service is temporarily unavailable.");
      }
      if (response.status < 200 || response.status >= 300) {
        throw new VeyraIdentityError("AUTH_FORBIDDEN", false, "The identity service rejected the login ticket.");
      }
  }

  return requireObject(requireObject(response.body).data);
};

const assertNotExpired = (expiresAt: string, now: Date) => {
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration) || expiration <= now.getTime()) {
    throw new VeyraIdentityError("AUTH_FORBIDDEN", false, "The login ticket is invalid, expired, or already used.");
  }
};

export class VeyraSub2ApiIdentityAdapter {
  private readonly headers: Readonly<Record<string, string>>;
  private readonly now: () => Date;

  constructor(private readonly options: VeyraSub2ApiIdentityAdapterOptions) {
    if (!options.internalToken.trim()) {
      throw new VeyraIdentityError("AUTH_FORBIDDEN", false, "The identity service credential is not configured.");
    }
    this.headers = { "X-Veyra-Internal-Token": options.internalToken };
    this.now = options.now ?? (() => new Date());
  }

  async exchangeTicket(input: VeyraLoginTicketExchangeInput): Promise<VeyraExternalIdentity> {
    const parsed = VeyraLoginTicketExchangeInputSchema.parse(input);
    const response = await this.request({
      method: "POST",
      path: "/api/veyra/internal/login-ticket/exchange",
      headers: this.headers,
      body: { ticket: parsed.ticket },
    });
    const data = responseData(response);
    const intent = requiredString(data.intent);
    if (intent !== parsed.expectedIntent) {
      throw new VeyraIdentityError("AUTH_FORBIDDEN", false, "The login ticket is not valid for this application.");
    }
    const expiresAt = requiredString(data.expires_at);
    assertNotExpired(expiresAt, this.now());

    return VeyraExternalIdentitySchema.parse({
      externalUserId: positiveSafeInteger(data.user_id),
      intent,
      email: optionalString(data.email),
      role: optionalString(data.role),
      expiresAt,
    });
  }

  private async request(input: Parameters<VeyraCreditTransport["request"]>[0]): Promise<VeyraCreditTransportResponse> {
    try {
      return await this.options.transport.request(input);
    } catch (error) {
      if (error instanceof VeyraIdentityError) {
        throw error;
      }
      throw new VeyraIdentityError("AUTH_UNAVAILABLE", true, "The identity service is temporarily unavailable.");
    }
  }
}
