import { createHash } from "node:crypto";

import { DomainInvariantError } from "./errors.js";

export type CommandDeduplication = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  responseSnapshot: Record<string, unknown>;
};

export const fingerprintRequest = (request: unknown): string =>
  createHash("sha256").update(canonicalJson(request)).digest("hex");

export const resolveIdempotency = (
  existing: CommandDeduplication | undefined,
  requestHash: string,
): { kind: "NEW" } | { kind: "REPLAY"; responseSnapshot: Record<string, unknown> } => {
  if (!existing) {
    return { kind: "NEW" };
  }

  if (existing.requestHash === requestHash) {
    return { kind: "REPLAY", responseSnapshot: existing.responseSnapshot };
  }

  throw new DomainInvariantError(
    "IDEMPOTENCY_CONFLICT",
    "The idempotency key was already used for a different command.",
  );
};

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
};
