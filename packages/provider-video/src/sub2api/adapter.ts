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

const findString = (value: unknown, names: readonly string[]): string | undefined => {
  const record = asRecord(value);
  if (record) {
    for (const name of names) {
      const candidate = textField(record, name);
      if (candidate) return candidate;
    }
    for (const child of Object.values(record)) {
      const candidate = findString(child, names);
      if (candidate) return candidate;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const candidate = findString(child, names);
      if (candidate) return candidate;
    }
  }
  return undefined;
};

const rejectedStates = new Set(["failed", "error", "rejected", "cancelled", "canceled"]);
const succeededStates = new Set(["succeeded", "completed", "complete", "success", "done"]);

const responseState = (payload: unknown) => {
  const record = asRecord(payload);
  if (!record) throw new VideoProviderProtocolError("SUB2API returned a non-object JSON response.");
  const data = asRecord(record.data);
  const sourcePayload = data ?? record;
  return findString(sourcePayload, ["status", "state"])?.toLowerCase() ?? "unknown";
};

const mapSubmission = (payload: unknown) => {
  if (!asRecord(payload)) throw new VideoProviderProtocolError("SUB2API returned a non-object submission response.");
  const providerRequestId = findString(payload, ["request_id", "id"]);
  if (!providerRequestId) throw new VideoProviderProtocolError("SUB2API submission response is missing id or request_id.");
  return { providerRequestId };
};

const mapStatus = (payload: unknown): ProviderStatus => {
  const state = responseState(payload);
  if (succeededStates.has(state)) return { state: "SUCCEEDED" };
  if (rejectedStates.has(state)) return normalizeSub2ApiRejectedStatus(payload);
  return { state: "PROCESSING" };
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
