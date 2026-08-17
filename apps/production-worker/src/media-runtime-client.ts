import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  MediaRuntimeImageArtifactSchema,
  MediaRuntimeVideoInspectionSchema,
  type MediaRuntimeImageArtifact,
  type MediaRuntimeVideoInspection,
} from "@alchemy-video/contracts";

const COMPOSITION_MAGIC = Buffer.from("ALCHMED1", "ascii");
const MAX_SINGLE_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_COMPOSITION_SEGMENTS = 12;
const MAX_COMPOSITION_INPUT_BYTES = 160 * 1024 * 1024;

const isLoopbackRuntimeHost = (hostname: string) => hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

export const validateMediaRuntimeUrl = (runtimeUrl: string): string => {
  let endpoint: URL;
  try {
    endpoint = new URL(runtimeUrl);
  } catch {
    throw new Error("MEDIA_RUNTIME_URL must be a loopback http endpoint.");
  }
  if (
    endpoint.protocol !== "http:"
    || !isLoopbackRuntimeHost(endpoint.hostname)
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || endpoint.pathname !== "/"
  ) {
    throw new Error("MEDIA_RUNTIME_URL must be a loopback http endpoint.");
  }
  return endpoint.toString();
};

export class MediaRuntimeClientError extends Error {
  constructor(
    readonly code: "MEDIA_RUNTIME_UNAVAILABLE" | "MEDIA_RENDER_FAILED" | "QC_FAILED",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "MediaRuntimeClientError";
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const boundedHeaderNumber = (headers: Headers, name: string) => {
  const raw = headers.get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const responseError = async (response: Response): Promise<MediaRuntimeClientError> => {
  const payload = await response.json().catch(() => undefined) as { error?: { code?: unknown; retryable?: unknown } } | undefined;
  const code = payload?.error?.code;
  const retryable = payload?.error?.retryable === true || response.status >= 500;
  if (code === "QC_FAILED") return new MediaRuntimeClientError("QC_FAILED", retryable);
  if (code === "MEDIA_RENDER_FAILED") return new MediaRuntimeClientError("MEDIA_RENDER_FAILED", retryable);
  return new MediaRuntimeClientError("MEDIA_RUNTIME_UNAVAILABLE", retryable);
};

export const encodeMediaCompositionBundle = (segments: readonly Uint8Array[]) => {
  if (segments.length < 1 || segments.length > MAX_COMPOSITION_SEGMENTS || segments.some((segment) => segment.byteLength === 0 || segment.byteLength > MAX_SINGLE_VIDEO_BYTES)) {
    throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  }
  const length = COMPOSITION_MAGIC.byteLength + 1 + segments.reduce((total, segment) => total + 4 + segment.byteLength, 0);
  if (length > MAX_COMPOSITION_INPUT_BYTES) throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  const bundle = new Uint8Array(length);
  bundle.set(COMPOSITION_MAGIC, 0);
  bundle[COMPOSITION_MAGIC.byteLength] = segments.length;
  let cursor = COMPOSITION_MAGIC.byteLength + 1;
  for (const segment of segments) {
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, segment.byteLength, false);
    cursor += 4;
    bundle.set(segment, cursor);
    cursor += segment.byteLength;
  }
  return bundle;
};

export class HttpMediaRuntimeClient {
  private readonly runtimeUrl: string;

  constructor(private readonly input: { runtimeUrl: string; token: string; timeoutMs?: number; fetcher?: typeof fetch }) {
    this.runtimeUrl = validateMediaRuntimeUrl(input.runtimeUrl);
  }

  async inspect(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeVideoInspection> {
    const response = await this.request({
      path: "/internal/v1/media/inspect",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json().catch(() => undefined);
    try {
      return MediaRuntimeVideoInspectionSchema.parse(payload);
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async extractHandoffFrame(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeImageArtifact & { bytes: Uint8Array }> {
    const response = await this.request({
      path: "/internal/v1/media/handoff-frame",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      const artifact = MediaRuntimeImageArtifactSchema.parse({
        mime_type: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase(),
        sha256: response.headers.get("x-media-sha256"),
        byte_size: boundedHeaderNumber(response.headers, "x-media-byte-size"),
        width: boundedHeaderNumber(response.headers, "x-media-width"),
        height: boundedHeaderNumber(response.headers, "x-media-height"),
      });
      if (artifact.byte_size !== bytes.byteLength || artifact.sha256 !== sha256(bytes)) throw new Error("invalid handoff bytes");
      return { ...artifact, bytes };
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async compose(input: { operationId: string; segments: readonly Uint8Array[] }): Promise<{ inspection: MediaRuntimeVideoInspection; bytes: Uint8Array }> {
    const bundle = encodeMediaCompositionBundle(input.segments);
    const response = await this.request({
      path: "/internal/v1/media/compose",
      operationId: input.operationId,
      contentType: "application/vnd.alchemy-media-bundle",
      bytes: bundle,
      expectedSha256: sha256(bundle),
    });
    if (!response.ok) throw await responseError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      const inspection = MediaRuntimeVideoInspectionSchema.parse({
        mime_type: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase(),
        sha256: response.headers.get("x-media-sha256"),
        byte_size: boundedHeaderNumber(response.headers, "x-media-byte-size"),
        width: boundedHeaderNumber(response.headers, "x-media-width"),
        height: boundedHeaderNumber(response.headers, "x-media-height"),
        duration_ms: boundedHeaderNumber(response.headers, "x-media-duration-ms"),
      });
      if (inspection.byte_size !== bytes.byteLength || inspection.sha256 !== sha256(bytes)) throw new Error("invalid composed bytes");
      return { inspection, bytes };
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    }
  }

  private async request(input: { path: string; operationId: string; contentType: string; bytes: Uint8Array; expectedSha256: string }) {
    const fetcher = this.input.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 90_000);
    try {
      return await fetcher(new URL(input.path, this.runtimeUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.input.token}`,
          "Content-Type": input.contentType,
          "X-Media-Operation-Id": input.operationId,
          "X-Media-Expected-Sha256": input.expectedSha256,
        },
        body: Buffer.from(input.bytes),
        signal: controller.signal,
      });
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RUNTIME_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
