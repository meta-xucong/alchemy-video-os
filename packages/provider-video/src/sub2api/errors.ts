import { VideoProviderFailure, type ProviderFailureCode, type ProviderStatus } from "../port.js";

type FailedProviderStatus = Extract<ProviderStatus, { state: "FAILED" }>;

const sensitiveValuePattern = /\b(?:authorization|bearer|cookie|api[_-]?key|token|object[_-]?key|signature|x-amz-[^=\s]+)\s*(?:=|:)?\s*[^\s,;]+/gi;
const signedUrlPattern = /https?:\/\/[^\s?]+\?[^\s]+/gi;

const sanitizeText = (value: string) => value
  .replace(sensitiveValuePattern, "[redacted]")
  .replace(signedUrlPattern, "[redacted-url]")
  .replace(/[\r\n]+/g, " ")
  .trim()
  .slice(0, 240);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const findFailureMessage = (payload: unknown) => {
  const record = asRecord(payload);
  const error = asRecord(record?.error);
  const candidate = error?.message ?? record?.message ?? record?.detail;
  return typeof candidate === "string" ? sanitizeText(candidate) : undefined;
};

export const normalizeSub2ApiHttpFailure = (status: number, payload?: unknown): FailedProviderStatus => {
  const retryable = status === 408 || status === 429 || status >= 500;
  const code: ProviderFailureCode = retryable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED";
  const fallback = retryable
    ? "The SUB2API video service is temporarily unavailable."
    : "The SUB2API video request was rejected.";

  return {
    state: "FAILED",
    code,
    message: findFailureMessage(payload) || fallback,
    retryable,
  };
};

export const normalizeSub2ApiRejectedStatus = (payload: unknown): FailedProviderStatus => ({
  state: "FAILED",
  code: "PROVIDER_REJECTED",
  message: findFailureMessage(payload) || "The SUB2API video request was rejected.",
  retryable: false,
});

export class Sub2ApiProviderFailure extends VideoProviderFailure {
  constructor(readonly status: FailedProviderStatus) {
    super(status.code, status.retryable, "PROVIDER", status.message);
    this.name = "Sub2ApiProviderFailure";
  }
}

export class Sub2ApiDownloadFailure extends VideoProviderFailure {

  constructor(status: number) {
    const retryable = status === 408 || status === 429 || status >= 500;
    super(
      retryable ? "PROVIDER_UNAVAILABLE" : "DOWNLOAD_INVALID",
      retryable,
      "DOWNLOAD",
      retryable
        ? "The SUB2API video download is temporarily unavailable."
        : "The SUB2API video download was rejected.",
    );
    this.name = "Sub2ApiDownloadFailure";
  }
}

export const sanitizeSub2ApiErrorSummary = (payload: unknown) => findFailureMessage(payload);
