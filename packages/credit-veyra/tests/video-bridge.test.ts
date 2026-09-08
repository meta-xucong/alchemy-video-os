import assert from "node:assert/strict";
import test from "node:test";

import {
  VideoVeyraBridgeAdapter,
  type CreditPort,
  type VeyraIdentityPort,
} from "../src/index.js";

const identity = {
  externalUserId: 42,
  intent: "video" as const,
  email: "video@example.test",
  role: "owner",
  expiresAt: "2026-08-24T12:00:00.000Z",
};

const account = {
  externalUserId: 42,
  email: "video@example.test",
  role: "owner",
  balance: "12.5",
  status: "active",
  concurrency: 2,
};

test("Video bridge fixes the exchanged intent to video and composes account lookup", async () => {
  const identityCalls: unknown[] = [];
  const creditCalls: unknown[] = [];
  const identityPort: VeyraIdentityPort = {
    async exchangeTicket(input) {
      identityCalls.push(input);
      return identity;
    },
  };
  const creditPort: CreditPort = {
    async getAccount(input) {
      creditCalls.push(input);
      return account;
    },
    async debit() {
      throw new Error("not used");
    },
  };

  const bridge = new VideoVeyraBridgeAdapter(identityPort, creditPort);
  const result = await bridge.exchangeVideoTicketAndGetAccount({ ticket: "ticket-never-logged" });

  assert.deepEqual(identityCalls, [{ ticket: "ticket-never-logged", expectedIntent: "video" }]);
  assert.deepEqual(creditCalls, [{ externalUserId: 42 }]);
  assert.deepEqual(result, { identity, account });
});

test("Video bridge rejects an account response for a different external identity", async () => {
  const bridge = new VideoVeyraBridgeAdapter(
    { exchangeTicket: async () => identity },
    {
      getAccount: async () => ({ ...account, externalUserId: 43 }),
      debit: async () => {
        throw new Error("not used");
      },
    },
  );

  await assert.rejects(
    bridge.exchangeVideoTicketAndGetAccount({ ticket: "ticket" }),
    /identity does not match/,
  );
});

test("Video bridge delegates debit without changing the frozen input", async () => {
  const debit = {
    externalUserId: 42,
    amount: "1.25",
    idempotencyKey: "video:grok-imagine-video-1.5:tsk_01J00000000000000000000000",
    source: "video:grok-imagine-video-1.5",
    referenceId: "tsk_01J00000000000000000000000",
  };
  let received: unknown;
  const bridge = new VideoVeyraBridgeAdapter(
    { exchangeTicket: async () => identity },
    {
      getAccount: async () => account,
      debit: async (input) => {
        received = input;
        return { externalUserId: 42, amount: "1.25", balanceAfter: "11.25", idempotencyKey: input.idempotencyKey, replayed: false };
      },
    },
  );

  const result = await bridge.debit(debit);
  assert.equal(received, debit);
  assert.equal(result.replayed, false);
});
