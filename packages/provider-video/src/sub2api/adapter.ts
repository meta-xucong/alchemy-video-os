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

const responseRecords = (payload: unknown): Record<string, unknown>[] => {
  const record = asRecord(payload);
  if (!record) return [];
  const records: Record<string, unknown>[] = [record];
  const nested = [asRecord(record.data), asRecord(record.video)].filter(
    (value): value is Record<string, unknown> => Boolean(value),
  );
  for (const value of nested) {
    records.push(value);
    const nestedVideo = asRecord(value.video);
    if (nestedVideo) records.push(nestedVideo);
  }
  return records;
};

const taskIdField = (record: Record<string, unknown>) =>
  textField(record, "id")
  ?? textField(record, "request_id")
  ?? textField(record, "task_id")
  ?? textField(record, "taskId");

const numericCode = (record: Record<string, unknown>) => {
  const value = record.code;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
};

const normalizeExternalState = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const rejectedStates = new Set(["failed", "error", "rejected", "cancelled", "canceled"]);
const processingStates = new Set(["queued", "pending", "processing", "in_progress", "running"]);
// The SUB2API compatibility note (doc/AI企业内容生产平台_VPS与SUB2API视频接入补充方案.md)
// documents all of these terminal success spellings. The observed transient
// `status: "unknown"` response is handled separately below; other unknown
// values remain protocol errors.
const succeededStates = new Set(["succeeded", "completed", "complete", "success", "done"]);

const isObservedTransientUnknown = (payload: unknown, providerRequestId: string) => {
  return responseRecords(payload).some((record) => {
    if (textField(record, "status")?.toLowerCase() !== "unknown") return false;
    if (taskIdField(record) !== providerRequestId) return false;
    const progress = record.progress;
    return typeof progress === "number"
      && Number.isFinite(progress)
      && progress >= 0
      && progress < 100;
  });
};

const responseState = (payload: unknown) => {
  const records = responseRecords(payload);
  if (records.length === 0) throw new VideoProviderProtocolError("SUB2API returned a non-object JSON response.");

  const statuses = records
    .flatMap((record) => [textField(record, "status"), textField(record, "state")].filter((value): value is string => Boolean(value)))
    .map(normalizeExternalState);
  if (statuses.length === 0) throw new VideoProviderProtocolError("SUB2API response is missing status or state.");
  if (new Set(statuses).size > 1) {
    throw new VideoProviderProtocolError("SUB2API response has conflicting status and state fields.");
  }
  return statuses[0]!;
};

const isRejectedResponse = (payload: unknown) => {
  if (responseRecords(payload).some((record) => {
    const code = numericCode(record);
    return code !== undefined && code >= 400;
  })) return true;
  try {
    return rejectedStates.has(responseState(payload));
  } catch (error) {
    if (error instanceof VideoProviderProtocolError) return false;
    throw error;
  }
};

const mapSubmission = (payload: unknown) => {
  const records = responseRecords(payload);
  if (records.length === 0) throw new VideoProviderProtocolError("SUB2API returned a non-object submission response.");

  const ids = records.map(taskIdField).filter((value): value is string => Boolean(value));
  if (new Set(ids).size > 1) {
    throw new VideoProviderProtocolError("SUB2API submission response has conflicting task ID fields.");
  }
  const providerRequestId = ids[0];
  if (!providerRequestId) throw new VideoProviderProtocolError("SUB2API submission response is missing id or request_id.");
  return { providerRequestId };
};

const mapStatus = (payload: unknown, providerRequestId: string): ProviderStatus => {
  const state = responseState(payload);
  if (processingStates.has(state)) return { state: "PROCESSING" };
  if (state === "unknown" && isObservedTransientUnknown(payload, providerRequestId)) return { state: "PROCESSING" };
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
    return mapStatus(response.json, input.providerRequestId.trim());
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
