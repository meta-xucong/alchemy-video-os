import { PositiveCreditAmountSchema } from "@alchemy-video/contracts";

import { VideoUsagePortError } from "./errors.js";
import type { VeyraCreditTransport, VeyraCreditTransportResponse } from "./transport.js";

/** Read-only source of the provider's settled video usage. */
export type VideoUsageFact = {
  providerRequestId: string;
  model: string;
  actualCost: string;
};

export interface VideoUsagePort {
  getUsage(input: { externalUserId: number; providerRequestId: string }): Promise<VideoUsageFact>;
}

export type VeyraSub2ApiVideoUsageAdapterOptions = {
  transport: VeyraCreditTransport;
  internalToken: string;
};

type JsonObject = Record<string, unknown>;

const invalidUsage = () => new VideoUsagePortError("USAGE_INVALID", false, "The video usage service returned an invalid fact.");

const requireObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidUsage();
  return value as JsonObject;
};

const settledData = (response: VeyraCreditTransportResponse): JsonObject => {
  if (response.status === 404) throw new VideoUsagePortError("USAGE_NOT_READY", true, "The provider usage has not settled yet.");
  if (response.status === 401 || response.status === 403) throw new VideoUsagePortError("USAGE_FORBIDDEN", false, "The usage service rejected the service credential.");
  if (response.status >= 500) throw new VideoUsagePortError("USAGE_UNAVAILABLE", true, "The usage service is temporarily unavailable.");
  if (response.status < 200 || response.status >= 300) throw invalidUsage();
  return requireObject(requireObject(response.body).data);
};

/**
 * Thin adapter for the existing Veyra internal envelope. It never estimates
 * usage and never debits; it only reads the settled Sub2API usage row.
 */
export class VeyraSub2ApiVideoUsageAdapter implements VideoUsagePort {
  private readonly headers: Readonly<Record<string, string>>;

  constructor(private readonly options: VeyraSub2ApiVideoUsageAdapterOptions) {
    if (!options.internalToken.trim()) throw new VideoUsagePortError("USAGE_FORBIDDEN", false, "The usage service credential is not configured.");
    this.headers = { "X-Veyra-Internal-Token": options.internalToken };
  }

  async getUsage(input: { externalUserId: number; providerRequestId: string }): Promise<VideoUsageFact> {
    if (!Number.isSafeInteger(input.externalUserId) || input.externalUserId <= 0 || !input.providerRequestId.trim() || input.providerRequestId.length > 255) {
      throw invalidUsage();
    }
    let response: VeyraCreditTransportResponse;
    try {
      response = await this.options.transport.request({
        method: "GET",
        path: `/api/veyra/internal/users/${input.externalUserId}/usage/${encodeURIComponent(input.providerRequestId)}`,
        headers: this.headers,
      });
    } catch {
      throw new VideoUsagePortError("USAGE_UNAVAILABLE", true, "The usage service is temporarily unavailable.");
    }
    const data = settledData(response);
    if (data.user_id !== input.externalUserId || typeof data.request_id !== "string" || !data.request_id.trim()) throw invalidUsage();
    const requested = input.providerRequestId.trim();
    const stored = data.request_id.trim();
    if (stored !== requested && stored !== `grok-video:${requested}`) throw invalidUsage();
    if (typeof data.model !== "string" || !data.model.trim() || typeof data.actual_cost !== "string") throw invalidUsage();
    let actualCost: string;
    try {
      actualCost = PositiveCreditAmountSchema.parse(data.actual_cost);
    } catch {
      throw invalidUsage();
    }
    return { providerRequestId: requested, model: data.model, actualCost };
  }
}
