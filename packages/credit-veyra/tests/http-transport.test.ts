import assert from "node:assert/strict";
import test from "node:test";
import { HttpVeyraCreditTransport } from "../src/http-transport.js";

test("HTTP transport sends the Veyra path, token header, JSON body and parses envelope", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const transport = new HttpVeyraCreditTransport({
    baseUrl: "https://aiself.example/",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    },
  });
  const result = await transport.request({ method: "POST", path: "/api/veyra/internal/billing/debit", headers: { "X-Veyra-Internal-Token": "test-token" }, body: { amount: 1 } });
  assert.equal(result.status, 200);
  assert.equal(request?.url, "https://aiself.example/api/veyra/internal/billing/debit");
  assert.equal((request?.init?.headers as Record<string, string>)["X-Veyra-Internal-Token"], "test-token");
  assert.equal(request?.init?.body, JSON.stringify({ amount: 1 }));
});

test("HTTP transport rejects non-HTTPS bases", () => {
  assert.throws(() => new HttpVeyraCreditTransport({ baseUrl: "http://localhost" }));
});
