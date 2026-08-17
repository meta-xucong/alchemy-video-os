import {
  VideoProviderFailure,
  VideoProviderProtocolError,
  type Sub2ApiTransport,
  type Sub2ApiTransportRequest,
  type Sub2ApiTransportResponse,
} from "@alchemy-video/provider-video";

export type WorkerProviderEnvironment = Readonly<{
  SUB2API_VIDEO_BASE_URL?: string;
  SUB2API_VIDEO_API_KEY?: string;
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
      } catch {
        throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "The video service is temporarily unavailable.");
      }
      if (request.path.endsWith("/content")) {
        return { status: response.status, headers: responseHeaders(response), stream: response.body ?? undefined };
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new VideoProviderProtocolError("SUB2API returned an invalid JSON response.");
      }
      return { status: response.status, headers: responseHeaders(response), json };
    },
  };
};
