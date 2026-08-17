import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  VeyraIdentityError,
  VeyraSub2ApiIdentityAdapter,
  type VeyraCreditTransport,
  type VeyraCreditTransportRequest,
  type VeyraCreditTransportResponse,
} from "../src/index.js";

const ticket = "0123456789abcdef0123456789abcdef";

class FakeVeyraTransport implements VeyraCreditTransport {
  readonly calls: VeyraCreditTransportRequest[] = [];

  constructor(private readonly next: VeyraCreditTransportResponse | Error) {}

  async request(input: VeyraCreditTransportRequest): Promise<VeyraCreditTransportResponse> {
    this.calls.push(input);
    if (this.next instanceof Error) {
      throw this.next;
    }
    return this.next;
  }
}

const adapter = (transport: VeyraCreditTransport) =>
  new VeyraSub2ApiIdentityAdapter({
    transport,
    internalToken: "test-only-injected-token",
    now: () => new Date("2026-08-16T00:00:00.000Z"),
  });

test("the injected transport receives the documented video login-ticket exchange protocol", async () => {
  const transport = new FakeVeyraTransport({
    status: 200,
    body: {
      data: {
        user_id: 42,
        email: "video-canary@example.test",
        role: "owner",
        intent: "video",
        expires_at: "2026-08-16T00:02:00.000Z",
      },
    },
  });

  const identity = await adapter(transport).exchangeTicket({ ticket });

  assert.deepEqual(identity, {
    externalUserId: 42,
    email: "video-canary@example.test",
    role: "owner",
    intent: "video",
    expiresAt: "2026-08-16T00:02:00.000Z",
  });
  assert.deepEqual(transport.calls, [{
    method: "POST",
    path: "/api/veyra/internal/login-ticket/exchange",
    headers: { "X-Veyra-Internal-Token": "test-only-injected-token" },
    body: { ticket },
  }]);
});

test("login tickets fail closed when reused, forged, expired, or scoped to another intent", async () => {
  const statusCases: Array<[number, string, boolean]> = [
    [400, "AUTH_FORBIDDEN", false],
    [404, "AUTH_FORBIDDEN", false],
    [409, "AUTH_FORBIDDEN", false],
    [401, "AUTH_FORBIDDEN", true],
    [403, "AUTH_FORBIDDEN", true],
    [503, "AUTH_UNAVAILABLE", true],
  ];

  for (const [status, code, retryable] of statusCases) {
    await assert.rejects(
      adapter(new FakeVeyraTransport({ status, body: { error: { message: `upstream leaked ${ticket}` } } })).exchangeTicket({ ticket }),
      (error: unknown) =>
        error instanceof VeyraIdentityError &&
        error.code === code &&
        error.retryable === retryable &&
        !error.message.includes(ticket) &&
        !error.message.includes("upstream leaked"),
    );
  }

  await assert.rejects(
    adapter(new FakeVeyraTransport({
      status: 200,
      body: { data: { user_id: 42, intent: "alchemy", expires_at: "2026-08-16T00:02:00.000Z" } },
    })).exchangeTicket({ ticket }),
    (error: unknown) => error instanceof VeyraIdentityError && error.code === "AUTH_FORBIDDEN" && error.retryable === false,
  );

  await assert.rejects(
    adapter(new FakeVeyraTransport({
      status: 200,
      body: { data: { user_id: 42, intent: "video", expires_at: "2026-08-15T23:59:59.000Z" } },
    })).exchangeTicket({ ticket }),
    (error: unknown) => error instanceof VeyraIdentityError && error.code === "AUTH_FORBIDDEN" && error.retryable === false,
  );
});

test("invalid identity envelopes and transport failures fail closed without exposing ticket material", async () => {
  await assert.rejects(
    adapter(new FakeVeyraTransport({ status: 200, body: { data: { user_id: 42, intent: "video" } } })).exchangeTicket({ ticket }),
    (error: unknown) => error instanceof VeyraIdentityError && error.code === "AUTH_UNAVAILABLE" && error.retryable === false,
  );

  await assert.rejects(
    adapter(new FakeVeyraTransport(new Error(`transport contains ${ticket}`))).exchangeTicket({ ticket }),
    (error: unknown) =>
      error instanceof VeyraIdentityError &&
      error.code === "AUTH_UNAVAILABLE" &&
      error.retryable === true &&
      !error.message.includes(ticket),
  );
});

test("identity adapter sources have no default network, environment, or URL-ticket wiring", async () => {
  const sources = await Promise.all([
    "identity-adapter.ts",
    "identity-port.ts",
    "transport.ts",
  ].map((name) => readFile(resolve(import.meta.dirname, "..", "src", name), "utf8")));
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /fetch\s*\(/);
  assert.doesNotMatch(combined, /process\.env/);
  assert.doesNotMatch(combined, /https?:\/\//);
  assert.doesNotMatch(combined, /ticket[^\n]{0,40}(?:url|query)/i);
});
