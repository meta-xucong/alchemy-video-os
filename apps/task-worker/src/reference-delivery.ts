import type { VisualInputSnapshot } from "@alchemy-video/contracts";
import { ReferenceDeliveryTokenCodec, createReferenceDeliveryUrl } from "@alchemy-video/reference-delivery";
import { VideoProviderFailure, VideoProviderProtocolError, type ResolvedVisualInput, type VideoProviderRuntimeProfile } from "@alchemy-video/provider-video";

const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REFERENCE_DELIVERY_TTL_MS = 15 * 60_000;
const MIN_REFERENCE_DELIVERY_TTL_MS = 60_000;
const MAX_REFERENCE_DELIVERY_TTL_MS = 60 * 60_000;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 5_000;
const MIN_PREFLIGHT_TIMEOUT_MS = 500;
const MAX_PREFLIGHT_TIMEOUT_MS = 30_000;
const DEFAULT_PREFLIGHT_RETRIES = 2;
const MAX_PREFLIGHT_RETRIES = 3;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ReferenceDeliveryFetchResponse = Readonly<{
  status: number;
  headers: Readonly<{
    get?: (name: string) => string | null;
    forEach?: (callback: (value: string, key: string) => void) => void;
  }>;
  body?: ReadableStream<Uint8Array> | null;
}>;

export type ReferenceDeliveryFetch = (input: string, init: Readonly<{
  method: "HEAD" | "GET";
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  redirect: "manual";
}>) => Promise<ReferenceDeliveryFetchResponse>;

type PreflightFailure = Readonly<{
  retryable: boolean;
  protocol: boolean;
}>;

const responseHeader = (headers: ReferenceDeliveryFetchResponse["headers"], name: string) => {
  const direct = headers.get?.(name);
  if (direct !== undefined && direct !== null) return direct;
  let value: string | undefined;
  headers.forEach?.((candidate, key) => {
    if (key.toLowerCase() === name.toLowerCase()) value = candidate;
  });
  return value;
};

const responseMimeType = (response: ReferenceDeliveryFetchResponse) =>
  responseHeader(response.headers, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();

const responseContentLength = (response: ReferenceDeliveryFetchResponse) => {
  const raw = responseHeader(response.headers, "content-length")?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : Number.NaN;
};

const isTransientStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

const preflightFailure = (failure: PreflightFailure): PreflightFailure => failure;

const validateResponseMetadata = (response: ReferenceDeliveryFetchResponse): PreflightFailure | undefined => {
  if (response.status < 200 || response.status >= 300) {
    return preflightFailure({ retryable: isTransientStatus(response.status), protocol: true });
  }
  const mimeType = responseMimeType(response);
  if (!mimeType || !SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    return preflightFailure({ retryable: false, protocol: true });
  }
  const contentLength = responseContentLength(response);
  if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > MAX_REFERENCE_IMAGE_BYTES)) {
    return preflightFailure({ retryable: false, protocol: true });
  }
  return undefined;
};

const readBoundedBody = async (body: ReadableStream<Uint8Array>, maximumBytes: number, signal?: AbortSignal) => {
  const reader = body.getReader();
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return size;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return size;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
};

const readBoundedBodyWithTimeout = async (body: ReadableStream<Uint8Array>, maximumBytes: number, timeoutMs: number) => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readBoundedBody(body, maximumBytes, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Reference delivery body read timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const cancelResponseBody = async (response: ReferenceDeliveryFetchResponse) => {
  if (!response.body) return;
  await response.body.cancel().catch(() => undefined);
};

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const requestWithTimeout = async (fetcher: ReferenceDeliveryFetch, url: string, method: "HEAD" | "GET", timeoutMs: number) => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Reference delivery preflight timed out."));
      }, timeoutMs);
    });
    return await Promise.race([
      fetcher(url, {
        method,
        headers: { accept: "image/jpeg, image/png, image/webp" },
        signal: controller.signal,
        redirect: "manual",
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const parseBoundedInteger = (name: string, raw: string | undefined, fallback: number, minimum: number, maximum: number) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new VideoProviderProtocolError(`${name} must be an integer.`);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new VideoProviderProtocolError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
};

const isPreflightEnabled = (raw: string | undefined) => raw?.trim().toLowerCase() !== "false";

const originPathPrefix = (origin: string) => {
  const parsed = new URL(origin);
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${path === "/" ? "" : path}/provider-input/`;
};

const assertSafeDeliveryUrl = (origin: string, url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VideoProviderProtocolError("Reference delivery produced an invalid HTTPS URL.");
  }
  const configured = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== configured.origin || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.pathname.startsWith(originPathPrefix(origin))) {
    throw new VideoProviderProtocolError("Reference delivery produced an unsafe URL.");
  }
};

const preflightReferenceUrl = async (input: Readonly<{
  origin: string;
  url: string;
  fetcher: ReferenceDeliveryFetch;
  timeoutMs: number;
  retries: number;
}>) => {
  assertSafeDeliveryUrl(input.origin, input.url);
  let lastFailure: PreflightFailure = { retryable: true, protocol: false };
  for (let attempt = 0; attempt <= input.retries; attempt += 1) {
    try {
      const head = await requestWithTimeout(input.fetcher, input.url, "HEAD", input.timeoutMs);
      let failure = validateResponseMetadata(head);
      const headLength = responseContentLength(head);
      const needsGetFallback = head.status === 405 || head.status === 501 || (!failure && headLength === undefined);
      await cancelResponseBody(head);
      if (needsGetFallback) {
        const get = await requestWithTimeout(input.fetcher, input.url, "GET", input.timeoutMs);
        try {
          failure = validateResponseMetadata(get);
          if (!failure && responseContentLength(get) === undefined) {
            if (!get.body) failure = { retryable: false, protocol: true };
            else if ((await readBoundedBodyWithTimeout(get.body, MAX_REFERENCE_IMAGE_BYTES, input.timeoutMs)) > MAX_REFERENCE_IMAGE_BYTES) failure = { retryable: false, protocol: true };
          }
        } finally {
          await cancelResponseBody(get);
        }
      }
      if (!failure) return;
      lastFailure = failure;
    } catch {
      lastFailure = { retryable: true, protocol: false };
    }
    if (!lastFailure.retryable || attempt >= input.retries) break;
    await delay(attempt === 0 ? 250 : 750);
  }
  if (lastFailure.protocol && !lastFailure.retryable) {
    throw new VideoProviderFailure("PROVIDER_PROTOCOL_INVALID", false, "PROVIDER", "Reference image delivery returned an invalid response.");
  }
  throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "Reference image delivery is temporarily unavailable.");
};

export interface ReferenceDeliveryPort {
  createVisualInput(input: Readonly<{
    workspaceId: string;
    projectId: string;
    visualInput: Exclude<VisualInputSnapshot, { mode: "TEXT" }>;
  }>): Promise<ResolvedVisualInput>;
}

const createSignedReferenceDeliveryPort = (input: Readonly<{
  origin: string;
  signingKey: string;
  ttlMs?: number;
  preflight?: Readonly<{
    enabled: boolean;
    fetcher: ReferenceDeliveryFetch;
    timeoutMs: number;
    retries: number;
  }>;
}>): ReferenceDeliveryPort => {
  const codec = new ReferenceDeliveryTokenCodec(input.signingKey);
  const ttlMs = input.ttlMs ?? DEFAULT_REFERENCE_DELIVERY_TTL_MS;
  return {
    async createVisualInput({ workspaceId, projectId, visualInput }) {
      const orderedReferences = [...visualInput.references].sort((left, right) => {
        const priority = (role: string | undefined) => role === "HANDOFF" ? 0 : role === "SCENE" ? 1 : role === "SUBJECT" ? 2 : 3;
        return priority(left.role) - priority(right.role) || left.position - right.position;
      });
      if (visualInput.mode === "FIRST_FRAME" && orderedReferences.length !== 1) {
        throw new VideoProviderProtocolError("A first-frame video input must resolve exactly one image.");
      }
      if (visualInput.mode === "REFERENCE_SET" && (orderedReferences.length < 1 || orderedReferences.length > 7)) {
        throw new VideoProviderProtocolError("A reference-set video input must resolve one to seven images.");
      }
      const urls = orderedReferences.map((reference) => createReferenceDeliveryUrl({
        origin: input.origin,
        token: codec.issue({
          workspaceId,
          projectId,
          assetId: reference.asset_id,
          sha256: reference.sha256,
          mimeType: reference.mime_type,
          expiresAt: new Date(Date.now() + ttlMs),
        }),
      }));
      if (input.preflight?.enabled) {
        await Promise.all(urls.map((url) => preflightReferenceUrl({
          origin: input.origin,
          url,
          fetcher: input.preflight!.fetcher,
          timeoutMs: input.preflight!.timeoutMs,
          retries: input.preflight!.retries,
        })));
      }
      if (visualInput.mode === "FIRST_FRAME") {
        return { mode: "FIRST_FRAME", url: urls[0]! };
      }
      return { mode: "REFERENCE_SET", urls, roles: orderedReferences.map((reference) => reference.role ?? "STYLE") };
    },
  };
};

const unavailableReferenceDeliveryPort = (): ReferenceDeliveryPort => ({
  async createVisualInput() {
    throw new VideoProviderFailure(
      "PROVIDER_UNAVAILABLE",
      false,
      "PROVIDER",
      "Reference image delivery is not configured for the real video provider.",
    );
  },
});

export const createWorkerReferenceDeliveryPort = (input: Readonly<{
  profile: VideoProviderRuntimeProfile;
  environment: Readonly<{
    REFERENCE_DELIVERY_ORIGIN?: string;
    REFERENCE_DELIVERY_SIGNING_KEY?: string;
    REFERENCE_DELIVERY_TTL_MS?: string;
    REFERENCE_DELIVERY_PREFLIGHT_ENABLED?: string;
    REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS?: string;
    REFERENCE_DELIVERY_PREFLIGHT_RETRIES?: string;
  }>;
  fetcher?: ReferenceDeliveryFetch;
}>): ReferenceDeliveryPort => {
  if (input.profile.mode === "mock") {
    return createSignedReferenceDeliveryPort({
      origin: "https://provider-input.invalid",
      signingKey: "local-mock-reference-delivery-key-with-at-least-32-characters",
    });
  }
  const origin = input.environment.REFERENCE_DELIVERY_ORIGIN?.trim();
  const signingKey = input.environment.REFERENCE_DELIVERY_SIGNING_KEY;
  if (!origin || !signingKey) return unavailableReferenceDeliveryPort();
  const ttlMs = parseBoundedInteger("REFERENCE_DELIVERY_TTL_MS", input.environment.REFERENCE_DELIVERY_TTL_MS, DEFAULT_REFERENCE_DELIVERY_TTL_MS, MIN_REFERENCE_DELIVERY_TTL_MS, MAX_REFERENCE_DELIVERY_TTL_MS);
  const timeoutMs = parseBoundedInteger("REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS", input.environment.REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS, DEFAULT_PREFLIGHT_TIMEOUT_MS, MIN_PREFLIGHT_TIMEOUT_MS, MAX_PREFLIGHT_TIMEOUT_MS);
  const retries = parseBoundedInteger("REFERENCE_DELIVERY_PREFLIGHT_RETRIES", input.environment.REFERENCE_DELIVERY_PREFLIGHT_RETRIES, DEFAULT_PREFLIGHT_RETRIES, 0, MAX_PREFLIGHT_RETRIES);
  if (!isPreflightEnabled(input.environment.REFERENCE_DELIVERY_PREFLIGHT_ENABLED)) {
    return createSignedReferenceDeliveryPort({ origin, signingKey, ttlMs });
  }
  const fetcher = input.fetcher ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) as unknown as ReferenceDeliveryFetch : undefined);
  if (!fetcher) return unavailableReferenceDeliveryPort();
  return createSignedReferenceDeliveryPort({
    origin,
    signingKey,
    ttlMs,
    preflight: { enabled: true, fetcher, timeoutMs, retries },
  });
};
