import type { VeyraCreditTransport, VeyraCreditTransportRequest, VeyraCreditTransportResponse } from "./transport.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HttpVeyraCreditTransportOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export class HttpVeyraCreditTransport implements VeyraCreditTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HttpVeyraCreditTransportOptions) {
    const normalized = options.baseUrl.trim().replace(/\/$/, "");
    if (!/^https:\/\//i.test(normalized)) throw new Error("Veyra base URL must use HTTPS.");
    this.baseUrl = normalized;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async request(input: VeyraCreditTransportRequest): Promise<VeyraCreditTransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${input.path}`, {
        method: input.method,
        headers: { Accept: "application/json", ...input.headers, ...(input.body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => undefined);
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}
