/**
 * Thin Control API transport for the OpenMontage Pixabay source adapter.
 *
 * Source: calesthio/OpenMontage @ 4eab34c5cfcccaa4f1970554928feccce73ee930.
 * Search and download stay in the Media Runtime; this module only crosses
 * the protected internal boundary and decodes its private response metadata.
 */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

export type PixabayMusicInput = {
  query: string;
  min_duration?: number;
  max_duration?: number;
};

export type PixabayMusicTrack = {
  title: string;
  audio_url: string;
  duration: number | null;
  artist: string;
  rating?: number | null;
  download_count?: number | null;
  pixabay_id?: number | string | null;
};

export type PixabayMusicDownload = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
  filename: string;
  track: PixabayMusicTrack;
  query: string;
  results_found: number;
  results_after_filter: number;
};

export interface PixabayMusicPort {
  execute(input: PixabayMusicInput): Promise<PixabayMusicDownload>;
}

export class PixabayMusicError extends Error {
  constructor(
    message: string,
    readonly kind: "UNAVAILABLE" | "NO_RESULTS" | "INVALID" = "UNAVAILABLE",
    readonly retryable = kind === "UNAVAILABLE",
  ) {
    super(message);
    this.name = "PixabayMusicError";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

const hasUnsafeRawRuntimeUrlSyntax = (runtimeUrl: string): boolean => {
  if (runtimeUrl.trim() !== runtimeUrl || !runtimeUrl.startsWith("http://")) return true;
  if (runtimeUrl.includes("?") || runtimeUrl.includes("#") || runtimeUrl.includes("@") || runtimeUrl.includes("\\")) return true;
  const authorityAndPath = runtimeUrl.slice("http://".length);
  const pathStart = authorityAndPath.indexOf("/");
  const rawPath = pathStart === -1 ? "" : authorityAndPath.slice(pathStart);
  return rawPath !== "" && rawPath !== "/";
};

const responseBody = async (response: Response, limit: number) => {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "audio/mpeg") {
    throw new PixabayMusicError("Pixabay audio response is not audio/mpeg.", "INVALID", false);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new PixabayMusicError("Pixabay audio is larger than the supported limit.", "INVALID");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > limit) {
    throw new PixabayMusicError("Pixabay audio is empty or larger than the supported limit.", "INVALID");
  }
  return bytes;
};

/**
 * Source-runtime transport. Local runs use loopback; the deployed Compose
 * stack uses one of the two fixed internal Media Runtime service names. No
 * caller-controlled or public hostname is accepted at this boundary.
 */
export class HttpPixabayMusicClient implements PixabayMusicPort {
  private readonly runtimeUrl: URL;
  private readonly fetcher: Fetcher;
  private readonly token: string;

  constructor(input: { runtimeUrl: string; token: string; fetcher?: Fetcher }) {
    if (hasUnsafeRawRuntimeUrlSyntax(input.runtimeUrl)) {
      throw new Error("MEDIA_RUNTIME_URL must use an allowlisted internal service or loopback http endpoint.");
    }
    let runtimeUrl: URL;
    try {
      runtimeUrl = new URL(input.runtimeUrl);
    } catch {
      throw new Error("MEDIA_RUNTIME_URL must use an allowlisted internal service or loopback http endpoint.");
    }
    const isLoopback = ["127.0.0.1", "[::1]", "::1"].includes(runtimeUrl.hostname);
    const isInternalService = ["media-runtime", "control-media-runtime"].includes(runtimeUrl.hostname)
      && runtimeUrl.port === "3433";
    if (
      runtimeUrl.protocol !== "http:"
      || (!isLoopback && !isInternalService)
      || runtimeUrl.username
      || runtimeUrl.password
      || runtimeUrl.search
      || runtimeUrl.hash
      || runtimeUrl.pathname !== "/"
      || !input.token
    ) {
      throw new Error("MEDIA_RUNTIME_URL must use an allowlisted internal service or loopback http endpoint and MEDIA_RUNTIME_TOKEN is required.");
    }
    this.runtimeUrl = runtimeUrl;
    this.token = input.token;
    this.fetcher = input.fetcher ?? fetch;
  }

  async execute(input: PixabayMusicInput): Promise<PixabayMusicDownload> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await this.fetcher(new URL("internal/v1/media/pixabay-music", this.runtimeUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-Media-Operation-Id": `mop_${randomUUID().replaceAll("-", "")}`,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      throw new PixabayMusicError(`Pixabay Music runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { error?: { code?: unknown } } | undefined;
      if (body?.error?.code === "MEDIA_RENDER_FAILED") {
        throw new PixabayMusicError("Pixabay returned no matching music track.", "NO_RESULTS", false);
      }
      throw new PixabayMusicError("Pixabay Music runtime is unavailable.");
    }
    const bytes = await responseBody(response, MAX_AUDIO_BYTES);
    const decode = (name: string, fallback: string) => {
      const value = response.headers.get(name);
      if (!value) return fallback;
      if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
        throw new PixabayMusicError("Pixabay Music runtime returned invalid metadata.", "INVALID", false);
      }
      try {
        return Buffer.from(value, "base64url").toString("utf8") || fallback;
      } catch {
        throw new PixabayMusicError("Pixabay Music runtime returned invalid metadata.", "INVALID", false);
      }
    };
    const durationRaw = response.headers.get("x-pixabay-duration");
    const duration = durationRaw ? Number(durationRaw) : null;
    const parseOptionalNumber = (name: string) => {
      const value = response.headers.get(name);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const rating = parseOptionalNumber("x-pixabay-rating");
    const downloadCount = parseOptionalNumber("x-pixabay-download-count");
    return {
      bytes,
      mimeType: "audio/mpeg",
      filename: decode("x-pixabay-filename-base64", "pixabay_music.mp3"),
      query: decode("x-pixabay-query-base64", input.query),
      track: {
        title: decode("x-pixabay-track-title-base64", "Unknown"),
        artist: decode("x-pixabay-artist-base64", "Unknown"),
        audio_url: "",
        duration: Number.isFinite(duration) ? duration : null,
        rating,
        download_count: downloadCount,
        pixabay_id: response.headers.get("x-pixabay-id") || null,
      },
      results_found: parseOptionalNumber("x-pixabay-results-found") ?? 0,
      results_after_filter: parseOptionalNumber("x-pixabay-results-after-filter") ?? 0,
    };
  }
}

export { MAX_AUDIO_BYTES as PIXABAY_MAX_AUDIO_BYTES };
