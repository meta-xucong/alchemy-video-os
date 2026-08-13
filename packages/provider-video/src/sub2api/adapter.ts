import type { ProviderDownload, ProviderStatus, VideoGenerationInput, VideoProviderPort } from "../port.js";
import { VideoProviderProtocolError } from "../port.js";
import {
  Sub2ApiDownloadFailure,
  Sub2ApiProviderFailure,
  normalizeSub2ApiHttpFailure,
  normalizeSub2ApiRejectedStatus,
} from "./errors.js";
import { mapSub2ApiGenerationRequest } from "./mapper.js";
import type { Sub2ApiTransport } from "./transport.js";

const isSuccessStatus = (status: number) => status >= 200 && status < 300;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const textField = (record: Record<string, unknown>, field: string) => {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const normalizeExternalState = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const rejectedStates = new Set(["failed", "error", "rejected", "cancelled", "canceled"]);
const processingStates = new Set(["queued", "pending", "processing", "in_progress", "running"]);
const succeededStates = new Set(["succeeded", "completed", "success"]);

const responseState = (payload: unknown) => {
  const record = asRecord(payload);
  if (!record) throw new VideoProviderProtocolError("SUB2API returned a non-object JSON response.");

  const status = textField(record, "status");
  const state = textField(record, "state");
  if (!status && !state) throw new VideoProviderProtocolError("SUB2API response is missing status or state.");
  if (status && state && normalizeExternalState(status) !== normalizeExternalState(state)) {
    throw new VideoProviderProtocolError("SUB2API response has conflicting status and state fields.");
  }
  return normalizeExternalState(status ?? state!);
};

const isRejectedResponse = (payload: unknown) => {
  try {
    return rejectedStates.has(responseState(payload));
  } catch (error) {
    if (error instanceof VideoProviderProtocolError) return false;
    throw error;
  }
};

const mapSubmission = (payload: unknown) => {
  const record = asRecord(payload);
  if (!record) throw new VideoProviderProtocolError("SUB2API returned a non-object submission response.");

  const id = textField(record, "id");
  const requestId = textField(record, "request_id");
  if (id && requestId && id !== requestId) {
    throw new VideoProviderProtocolError("SUB2API submission response has conflicting id fields.");
  }
  const providerRequestId = id ?? requestId;
  if (!providerRequestId) throw new VideoProviderProtocolError("SUB2API submission response is missing id or request_id.");
  return { providerRequestId };
};

const mapStatus = (payload: unknown): ProviderStatus => {
  const state = responseState(payload);
  if (processingStates.has(state)) return { state: "PROCESSING" };
  if (succeededStates.has(state)) return { state: "SUCCEEDED" };
  if (rejectedStates.has(state)) return normalizeSub2ApiRejectedStatus(payload);
  throw new VideoProviderProtocolError("SUB2API returned an unknown video status.");
};

const providerRequestPath = (providerRequestId: string, suffix = "") => {
  const normalized = providerRequestId.trim();
  if (!normalized) throw new VideoProviderProtocolError("The SUB2API provider request ID must not be empty.");
  return `/videos/${encodeURIComponent(normalized)}${suffix}`;
};

export class Sub2ApiVideoProvider implements VideoProviderPort {
  constructor(private readonly transport: Sub2ApiTransport) {
    if (!transport || typeof transport.request !== "function") {
      throw new VideoProviderProtocolError("Sub2ApiVideoProvider requires an injected transport.");
    }
  }

  async submit(input: VideoGenerationInput) {
    const response = await this.transport.request({
      method: "POST",
      path: "/videos/generations",
      body: mapSub2ApiGenerationRequest(input),
    });
    if (!isSuccessStatus(response.status)) {
      throw new Sub2ApiProviderFailure(normalizeSub2ApiHttpFailure(response.status, response.json));
    }
    if (isRejectedResponse(response.json)) {
      throw new Sub2ApiProviderFailure(normalizeSub2ApiRejectedStatus(response.json));
    }
    return mapSubmission(response.json);
  }

  async getStatus(input: { providerRequestId: string }): Promise<ProviderStatus> {
    const response = await this.transport.request({
      method: "GET",
      path: providerRequestPath(input.providerRequestId),
    });
    if (!isSuccessStatus(response.status)) return normalizeSub2ApiHttpFailure(response.status, response.json);
    return mapStatus(response.json);
  }

  async download(input: { providerRequestId: string }): Promise<ProviderDownload> {
    const response = await this.transport.request({
      method: "GET",
      path: providerRequestPath(input.providerRequestId, "/content"),
    });
    if (!isSuccessStatus(response.status)) throw new Sub2ApiDownloadFailure(response.status);
    if (!response.stream) throw new VideoProviderProtocolError("SUB2API download response is missing a video stream.");
    const rawContentType = Object.entries(response.headers ?? {})
      .find(([key]) => key.toLowerCase() === "content-type")?.[1]?.trim();
    const mimeType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (!mimeType) throw new Sub2ApiDownloadFailure(422);
    const rawLength = Object.entries(response.headers ?? {})
      .find(([key]) => key.toLowerCase() === "content-length")?.[1]?.trim();
    if (rawLength === undefined) return { stream: response.stream, mimeType };
    if (!rawLength) throw new Sub2ApiDownloadFailure(422);
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) throw new Sub2ApiDownloadFailure(422);
    return { stream: response.stream, mimeType, contentLength };
  }
}
