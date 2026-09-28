import {
  VideoProviderFailure,
  VideoProviderProtocolError,
  type Sub2ApiTransport,
  type Sub2ApiTransportRequest,
  type Sub2ApiTransportResponse,
  sanitizeSub2ApiErrorSummary,
} from "@alchemy-video/provider-video";

export type WorkerProviderEnvironment = Readonly<{
  SUB2API_VIDEO_BASE_URL?: string;
  SUB2API_VIDEO_API_KEY?: string;
  SUB2API_VIDEO_DEBUG?: string;
}>;

export type WorkerFetchResponse = Readonly<{
  status: number;
  headers: Readonly<{ forEach(callback: (value: string, key: string) => void): void }>;
  body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}>;

export type WorkerFetch = (input: string, init: Readonly<{
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
}>) => Promise<WorkerFetchResponse>;

const safeConfiguration = (environment: WorkerProviderEnvironment) => {
  if (!environment.SUB2API_VIDEO_API_KEY?.trim()) {
    throw new VideoProviderProtocolError("SUB2API video credentials are unavailable.");
  }
  try {
    const url = new URL(environment.SUB2API_VIDEO_BASE_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new VideoProviderProtocolError("SUB2API video requires an HTTPS base URL.");
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url;
  } catch (error) {
    if (error instanceof VideoProviderProtocolError) throw error;
    throw new VideoProviderProtocolError("SUB2API video requires an HTTPS base URL.");
  }
};

const responseHeaders = (response: WorkerFetchResponse) => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return headers;
};

const safeResponseFieldNames = (payload: unknown) => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const names = new Set(Object.keys(record));
  for (const child of [record.data, record.error]) {
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      for (const key of Object.keys(child as Record<string, unknown>)) names.add(key);
    }
  }
  return [...names].filter((key) => /^[a-zA-Z0-9_]{1,40}$/.test(key)).sort();
};

const debugTransport = (
  environment: WorkerProviderEnvironment,
  event: string,
  fields: Readonly<Record<string, unknown>>,
) => {
  if (environment.SUB2API_VIDEO_DEBUG?.trim().toLowerCase() !== "true") return;
  console.warn(JSON.stringify({ event, ...fields }));
};

const safeTarget = (baseUrl: URL, path: string) => {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) {
    throw new VideoProviderProtocolError("The Worker received an invalid SUB2API path.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === "." || decoded === "..";
    } catch {
      return true;
    }
  })) {
    throw new VideoProviderProtocolError("The Worker received an invalid SUB2API path.");
  }
  const prefix = baseUrl.pathname === "/" ? "" : baseUrl.pathname;
  const target = new URL(`${prefix}${path}`, baseUrl.origin);
  if (target.origin !== baseUrl.origin || (prefix && !target.pathname.startsWith(`${prefix}/`))) {
    throw new VideoProviderProtocolError("The Worker received an invalid SUB2API path.");
  }
  return target;
};

export const createSub2ApiHttpsTransport = (input: Readonly<{
  environment: WorkerProviderEnvironment;
  fetcher?: WorkerFetch;
}>): Sub2ApiTransport => {
  const baseUrl = safeConfiguration(input.environment);
  const fetcher = input.fetcher ?? globalThis.fetch as unknown as WorkerFetch;

  return {
    async request(request: Sub2ApiTransportRequest): Promise<Sub2ApiTransportResponse> {
      const target = safeTarget(baseUrl, request.path);
      const headers: Record<string, string> = {
        authorization: `Bearer ${input.environment.SUB2API_VIDEO_API_KEY!.trim()}`,
      };
      if (request.body !== undefined) headers["content-type"] = "application/json";
      let response: WorkerFetchResponse;
      try {
        response = await fetcher(target.toString(), {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
      } catch (error) {
        debugTransport(input.environment, "sub2api.transport.fetch_failed", {
          method: request.method,
          path: request.path,
          error_name: error instanceof Error ? error.name : "unknown",
        });
        throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "The video service is temporarily unavailable.");
      }
      debugTransport(input.environment, "sub2api.transport.response", {
        method: request.method,
        path: request.path,
        status: response.status,
      });
      if (request.path.endsWith("/content")) {
        return { status: response.status, headers: responseHeaders(response), stream: response.body ?? undefined };
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        // Status polling can briefly receive an HTML gateway page or an empty
        // body while the upstream task is still available. Treat that as a
        // recoverable provider outage; the persisted request ID prevents a
        // second submission on the next delivery. Submission responses remain
        // strict so a malformed 2xx cannot be mistaken for an accepted task.
        if (request.method === "GET" && request.path.startsWith("/videos/") && !request.path.endsWith("/content")) {
          const retryable = response.status < 400 || response.status === 408 || response.status === 429 || response.status >= 500;
          throw new VideoProviderFailure(
            retryable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED",
            retryable,
            "PROVIDER",
            retryable
              ? "The SUB2API video status response was temporarily unavailable."
              : "The SUB2API video status response was invalid.",
          );
        }
        throw new VideoProviderProtocolError("SUB2API returned an invalid JSON response.");
      }
      if (response.status >= 400) {
        debugTransport(input.environment, "sub2api.transport.http_failure", {
          method: request.method,
          path: request.path,
          status: response.status,
          response_fields: safeResponseFieldNames(json),
          error_summary: sanitizeSub2ApiErrorSummary(json),
        });
      }
      return { status: response.status, headers: responseHeaders(response), json };
    },
  };
};
