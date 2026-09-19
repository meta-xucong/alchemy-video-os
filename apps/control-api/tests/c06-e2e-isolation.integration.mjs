import assert from "node:assert/strict";

import { acquireC06E2EIsolation } from "../../../packages/persistence/tests/support/c06-e2e-isolation.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the C06 E2E isolation regression.");

const first = await acquireC06E2EIsolation(databaseUrl);
try {
  await assert.rejects(
    () => acquireC06E2EIsolation(databaseUrl, { timeoutMs: 100, pollIntervalMs: 20 }),
    /test isolation lock timed out/,
  );
} finally {
  await first.release();
}

const second = await acquireC06E2EIsolation(databaseUrl, { timeoutMs: 1_000, pollIntervalMs: 20 });
await second.release();
console.log("C06 E2E isolation regression passed: contention times out and release permits the next supervisor.");
