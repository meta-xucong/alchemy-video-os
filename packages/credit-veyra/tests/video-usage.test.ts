import assert from "node:assert/strict";
import test from "node:test";

import {
  VideoUsagePortError,
  VeyraSub2ApiVideoUsageAdapter,
  type VeyraCreditTransport,
  type VeyraCreditTransportRequest,
  type VeyraCreditTransportResponse,
} from "../src/index.js";

class FakeTransport implements VeyraCreditTransport {
  readonly calls: VeyraCreditTransportRequest[] = [];
  constructor(private readonly next: VeyraCreditTransportResponse | Error) {}
  async request(input: VeyraCreditTransportRequest): Promise<VeyraCreditTransportResponse> {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

const usage = (transport: VeyraCreditTransport) => new VeyraSub2ApiVideoUsageAdapter({ transport, internalToken: "test-token" });

test("video usage adapter reads the source-backed Veyra fact and preserves the request id", async () => {
  const transport = new FakeTransport({ status: 200, body: { data: {
    user_id: 42, request_id: "grok-video:req-1", model: "grok-imagine-video-1.5", actual_cost: "0.12500000",
  } } });
  const result = await usage(transport).getUsage({ externalUserId: 42, providerRequestId: "req-1" });
  assert.deepEqual(result, { providerRequestId: "req-1", model: "grok-imagine-video-1.5", actualCost: "0.12500000" });
  assert.deepEqual(transport.calls, [{
    method: "GET",
    path: "/api/veyra/internal/users/42/usage/req-1",
    headers: { "X-Veyra-Internal-Token": "test-token" },
  }]);
});

test("usage not settled remains retryable while malformed facts fail closed", async () => {
  await assert.rejects(
    usage(new FakeTransport({ status: 404, body: {} })).getUsage({ externalUserId: 42, providerRequestId: "req-1" }),
    (error: unknown) => error instanceof VideoUsagePortError && error.code === "USAGE_NOT_READY" && error.retryable,
  );
  await assert.rejects(
    usage(new FakeTransport({ status: 200, body: { data: { user_id: 42, request_id: "req-1", model: "grok-imagine-video-1.5", actual_cost: 0.125 } } })).getUsage({ externalUserId: 42, providerRequestId: "req-1" }),
    (error: unknown) => error instanceof VideoUsagePortError && error.code === "USAGE_INVALID" && !error.retryable,
  );
});

test("usage adapter rejects identity and request-key mismatches", async (t) => {
  const cases = [
    { user_id: 43, request_id: "req-1", model: "grok-imagine-video-1.5", actual_cost: "0.1" },
    { user_id: 42, request_id: "other", model: "grok-imagine-video-1.5", actual_cost: "0.1" },
  ];
  for (const data of cases) {
    await t.test(JSON.stringify(data), async () => {
      await assert.rejects(
        usage(new FakeTransport({ status: 200, body: { data } })).getUsage({ externalUserId: 42, providerRequestId: "req-1" }),
        (error: unknown) => error instanceof VideoUsagePortError && error.code === "USAGE_INVALID" && !error.retryable,
      );
    });
  }
});
