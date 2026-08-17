import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  CreditPortError,
  NoopCreditAdapter,
  VeyraSub2ApiCreditAdapter,
  creditDecimalToVeyraNumber,
  type VeyraCreditTransport,
  type VeyraCreditTransportRequest,
  type VeyraCreditTransportResponse,
} from "../src/index.js";

const debitInput = {
  externalUserId: 42,
  amount: "1.25000000",
  idempotencyKey: "video:mock-v1:tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  source: "video:mock-v1",
  referenceId: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
};

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
  new VeyraSub2ApiCreditAdapter({ transport, internalToken: "test-only-injected-token" });

test("the injected transport receives the documented account and debit protocol", async () => {
  const accountTransport = new FakeVeyraTransport({
    status: 200,
    body: { data: { user_id: 42, email: "dev@example.test", role: "owner", balance: 12.5, status: "active", concurrency: 2 } },
  });
  const account = await adapter(accountTransport).getAccount({ externalUserId: 42 });

  assert.deepEqual(account, {
    externalUserId: 42,
    email: "dev@example.test",
    role: "owner",
    balance: "12.5",
    status: "active",
    concurrency: 2,
  });
  assert.deepEqual(accountTransport.calls, [{
    method: "GET",
    path: "/api/veyra/internal/users/42/account",
    headers: { "X-Veyra-Internal-Token": "test-only-injected-token" },
  }]);

  const debitTransport = new FakeVeyraTransport({
    status: 200,
    body: { data: { user_id: 42, amount: 1.25, balance_after: 11.25, idempotency_key: debitInput.idempotencyKey, replayed: false } },
  });
  const debit = await adapter(debitTransport).debit(debitInput);

  assert.deepEqual(debit, {
    externalUserId: 42,
    amount: "1.25",
    balanceAfter: "11.25",
    idempotencyKey: debitInput.idempotencyKey,
    replayed: false,
  });
  assert.deepEqual(debitTransport.calls[0], {
    method: "POST",
    path: "/api/veyra/internal/billing/debit",
    headers: { "X-Veyra-Internal-Token": "test-only-injected-token" },
    body: {
      user_id: 42,
      amount: 1.25,
      idempotency_key: debitInput.idempotencyKey,
      source: debitInput.source,
      reference_id: debitInput.referenceId,
    },
  });
});

test("Veyra status failures normalize without leaking upstream payloads", async () => {
  const cases: Array<[number, string, boolean]> = [
    [402, "CREDIT_INSUFFICIENT", false],
    [409, "CREDIT_CONFLICT", false],
    [401, "AUTH_FORBIDDEN", true],
    [403, "AUTH_FORBIDDEN", true],
    [503, "CREDIT_UNAVAILABLE", true],
    [400, "CREDIT_REJECTED", false],
  ];

  for (const [status, code, retryable] of cases) {
    const transport = new FakeVeyraTransport({ status, body: { error: { message: "upstream-secret-message" } } });
    await assert.rejects(
      adapter(transport).debit(debitInput),
      (error: unknown) =>
        error instanceof CreditPortError &&
        error.code === code &&
        error.retryable === retryable &&
        !error.message.includes("upstream-secret-message"),
    );
  }
});

test("decimal conversion rejects unsafe or over-precise debit values before transport", async () => {
  assert.equal(creditDecimalToVeyraNumber("0.00000001"), 0.00000001);
  assert.throws(
    () => creditDecimalToVeyraNumber("90071992.54740992"),
    (error: unknown) => error instanceof CreditPortError && error.code === "CREDIT_REJECTED",
  );

  const transport = new FakeVeyraTransport({ status: 200, body: { data: {} } });
  await assert.rejects(
    adapter(transport).debit({ ...debitInput, amount: "1.000000001" }),
  );
  assert.equal(transport.calls.length, 0);
});

test("invalid Veyra envelopes and transport failures fail closed", async () => {
  await assert.rejects(
    adapter(new FakeVeyraTransport({ status: 200, body: { data: { user_id: 42 } } })).getAccount({ externalUserId: 42 }),
    (error: unknown) => error instanceof CreditPortError && error.code === "CREDIT_UNAVAILABLE" && error.retryable === false,
  );
  await assert.rejects(
    adapter(new FakeVeyraTransport(new Error("transport contains no credential data"))).debit(debitInput),
    (error: unknown) => error instanceof CreditPortError && error.code === "CREDIT_UNAVAILABLE" && error.retryable === true && !error.message.includes("credential"),
  );
});

test("NoopCreditAdapter cannot silently turn local mock billing into success", async () => {
  const noop = new NoopCreditAdapter();
  await assert.rejects(
    noop.getAccount({ externalUserId: 42 }),
    (error: unknown) => error instanceof CreditPortError && error.code === "CREDIT_UNAVAILABLE" && error.retryable === false,
  );
  await assert.rejects(
    noop.debit(debitInput),
    (error: unknown) => error instanceof CreditPortError && error.code === "CREDIT_UNAVAILABLE" && error.retryable === false,
  );
});

test("C09 adapter sources have no default network or environment wiring", async () => {
  const sources = await Promise.all([
    "adapter.ts",
    "mapper.ts",
    "transport.ts",
  ].map((name) => readFile(resolve(import.meta.dirname, "..", "src", name), "utf8")));
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /fetch\s*\(/);
  assert.doesNotMatch(combined, /process\.env/);
  assert.doesNotMatch(combined, /https?:\/\//);
});
