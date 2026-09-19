import type { ApplicationErrorCode } from "@alchemy-video/contracts";

export class ControlApiError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: ApplicationErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ControlApiError";
  }
}

export const validationError = (message: string) =>
  new ControlApiError(400, "VALIDATION_FAILED", message);
