import { and, inArray, isNotNull, sql } from "drizzle-orm";

import { providerAttempts } from "./schema.js";

// Only the adapter's source-recognized terminal status, persisted by the
// Worker for this attempt, can release a known request for regeneration.
// An HTTP rejection, local configuration failure, or old ABANDONED label
// does not establish that the upstream request has stopped.
export const hasTerminalProviderResult = (attempt: {
  providerRequestId: string | null;
  status: string;
  responsePayload: Record<string, unknown>;
}) => Boolean(attempt.providerRequestId)
  && ["FAILED", "ABANDONED"].includes(attempt.status)
  && attempt.responsePayload.provider_request_terminal === true;

export const terminalProviderResultScope = () => and(
  isNotNull(providerAttempts.providerRequestId),
  inArray(providerAttempts.status, ["FAILED", "ABANDONED"]),
  sql`coalesce(${providerAttempts.responsePayload}->'provider_request_terminal' = 'true'::jsonb, false)`,
)!;

export const unresolvedProviderRequestScope = () => and(
  isNotNull(providerAttempts.providerRequestId),
  sql`not (${terminalProviderResultScope()})`,
)!;
