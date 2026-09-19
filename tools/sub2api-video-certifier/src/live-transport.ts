import {
  VideoProviderFailure,
  VideoProviderProtocolError,
  type Sub2ApiTransport,
  type Sub2ApiTransportRequest,
  type Sub2ApiTransportResponse,
} from "@alchemy-video/provider-video";

export type LiveEnvironment = Readonly<{
  baseUrl: string;
  apiKey: string;
}>;

export type CertifierFetchResponse = Readonly<{
  status: number;
  headers: Readonly<{ forEach(callback: (value: string, key: string) => void): void }>;
  body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}>;

export type CertifierFetch = (input: string, init: Readonly<{
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
}>) => Promise<CertifierFetchResponse>;

const safeLiveConfiguration = (environment: LiveEnvironment) => {
  if (!environment.apiKey.trim()) {
    throw new VideoProviderProtocolError("Live certification credentials are unavailable.");
  }
  try {
    const url = new URL(environment.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new VideoProviderProtocolError("Live certification requires an HTTPS base URL.");
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url;
  } catch (error) {
    if (error instanceof VideoProviderProtocolError) throw error;
    throw new VideoProviderProtocolError("Live certification requires an HTTPS base URL.");
  }
};

const responseHeaders = (response: CertifierFetchResponse) => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return headers;
};

const isContentRequest = (path: string) => path.endsWith("/content");

const safeTarget = (baseUrl: URL, path: string) => {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) {
    throw new VideoProviderProtocolError("The certifier received an invalid SUB2API path.");
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
    throw new VideoProviderProtocolError("The certifier received an invalid SUB2API path.");
  }
  const prefix = baseUrl.pathname === "/" ? "" : baseUrl.pathname;
  const target = new URL(`${prefix}${path}`, baseUrl.origin);
  if (target.origin !== baseUrl.origin || (prefix && !target.pathname.startsWith(`${prefix}/`))) {
    throw new VideoProviderProtocolError("The certifier received an invalid SUB2API path.");
  }
  return target;
};

export const createCertifierHttpsTransport = (input: Readonly<{
  environment: LiveEnvironment;
  fetcher: CertifierFetch;
}>): Sub2ApiTransport => {
  const baseUrl = safeLiveConfiguration(input.environment);

  return {
    async request(request: Sub2ApiTransportRequest): Promise<Sub2ApiTransportResponse> {
      const target = safeTarget(baseUrl, request.path);
      const headers: Record<string, string> = {
        authorization: `Bearer ${input.environment.apiKey}`,
      };
      if (request.body !== undefined) headers["content-type"] = "application/json";
      let response: CertifierFetchResponse;
      try {
        response = await input.fetcher(target.toString(), {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
      } catch {
        throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "The video service is temporarily unavailable.");
      }
      if (isContentRequest(request.path)) {
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
