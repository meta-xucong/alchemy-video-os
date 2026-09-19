import { setTimeout as delay } from "node:timers/promises";
import { Buffer } from "node:buffer";

export type RuntimeConversionResult = {
  markdown: string;
  converter: string;
  converterVersion: string;
  warnings: string[];
};

export class DocumentRuntimeClientError extends Error {
  constructor(
    readonly code: "DOCUMENT_UNSUPPORTED" | "DOCUMENT_CONVERSION_FAILED" | "DOCUMENT_RUNTIME_UNAVAILABLE" | "DOCUMENT_OUTPUT_INVALID",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "DocumentRuntimeClientError";
  }
}

const boundedStringArray = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 512)
    ? value
    : undefined;

const encodeSourceFilename = (value: string) => Buffer.from(value, "utf8").toString("base64url");

const isLoopbackRuntimeHost = (hostname: string) => hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

export const validateDocumentRuntimeUrl = (runtimeUrl: string): string => {
  let endpoint: URL;
  try {
    endpoint = new URL(runtimeUrl);
  } catch {
    throw new Error("DOCUMENT_RUNTIME_URL must be a loopback http endpoint.");
  }

  if (
    endpoint.protocol !== "http:" ||
    !isLoopbackRuntimeHost(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  ) {
    throw new Error("DOCUMENT_RUNTIME_URL must be a loopback http endpoint.");
  }

  return endpoint.toString();
};

export class HttpDocumentRuntimeClient {
  private readonly runtimeUrl: string;

  constructor(private readonly input: { runtimeUrl: string; token: string; timeoutMs?: number; fetcher?: typeof fetch }) {
    this.runtimeUrl = validateDocumentRuntimeUrl(input.runtimeUrl);
  }

  async convert(input: {
    conversionId: string;
    sourceFilename: string;
    sourceMimeType: string;
    sourceSha256: string;
    bytes: Uint8Array;
  }): Promise<RuntimeConversionResult> {
    const fetcher = this.input.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 30_000);
    try {
      const response = await fetcher(new URL("/internal/v1/document-conversions", this.runtimeUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.input.token}`,
          "Content-Type": input.sourceMimeType,
          "X-Document-Conversion-Id": input.conversionId,
          "X-Source-Filename-Base64": encodeSourceFilename(input.sourceFilename),
          "X-Source-Sha256": input.sourceSha256,
        },
        body: Buffer.from(input.bytes),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
      if (!response.ok) {
        const error = typeof payload?.error === "object" && payload.error !== null ? payload.error as Record<string, unknown> : undefined;
        const code = error?.code;
        if (response.status >= 500) throw new DocumentRuntimeClientError("DOCUMENT_RUNTIME_UNAVAILABLE", true);
        if (code === "DOCUMENT_OUTPUT_INVALID") throw new DocumentRuntimeClientError("DOCUMENT_OUTPUT_INVALID", false);
        if (code === "DOCUMENT_CONVERSION_FAILED") throw new DocumentRuntimeClientError("DOCUMENT_CONVERSION_FAILED", false);
        throw new DocumentRuntimeClientError("DOCUMENT_UNSUPPORTED", false);
      }
      const warnings = boundedStringArray(payload?.warnings);
      if (typeof payload?.markdown !== "string" || typeof payload?.converter !== "string" || !payload.converter || payload.converter.length > 128 || typeof payload?.converter_version !== "string" || !payload.converter_version || payload.converter_version.length > 128 || !warnings) {
        throw new DocumentRuntimeClientError("DOCUMENT_OUTPUT_INVALID", false);
      }
      return {
        markdown: payload.markdown,
        converter: payload.converter,
        converterVersion: payload.converter_version,
        warnings,
      };
    } catch (error) {
      if (error instanceof DocumentRuntimeClientError) throw error;
      throw new DocumentRuntimeClientError("DOCUMENT_RUNTIME_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
      await delay(0);
    }
  }
}
