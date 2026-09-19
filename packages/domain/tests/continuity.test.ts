import test from "node:test";
import assert from "node:assert/strict";

import { decideContinuityRepair, normalizeContinuitySummary } from "../src/continuity.js";

const evaluation = (result: "PASS" | "BLEND" | "BRIDGE_REQUIRED" | "UNAVAILABLE" | "FAILED") => ({
  result,
  reasonCodes: [],
  safeSummary: "safe",
  evaluatorVersion: "fixture-v1",
  retryable: result === "UNAVAILABLE",
});

test("continuity policy keeps PASS direct and uses bounded blend", () => {
  assert.deepEqual(decideContinuityRepair({ evaluation: evaluation("PASS"), repairCount: 0, maxRepairCount: 2 }), {
    strategy: "PASS",
    continuityStatus: "GOOD",
    durationMs: 0,
    shouldCreateRepair: false,
  });
  assert.equal(decideContinuityRepair({ evaluation: evaluation("BLEND"), repairCount: 0, maxRepairCount: 2 }).durationMs, 600);
});

test("bridge is bounded and stops after the run repair cap", () => {
  assert.equal(decideContinuityRepair({ evaluation: evaluation("BRIDGE_REQUIRED"), repairCount: 0, maxRepairCount: 1 }).strategy, "BRIDGE");
  const capped = decideContinuityRepair({ evaluation: evaluation("BRIDGE_REQUIRED"), repairCount: 1, maxRepairCount: 1 });
  assert.deepEqual(capped, { strategy: "PASS", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false });
});

test("unavailable evaluation never masquerades as semantic PASS", () => {
  const decision = decideContinuityRepair({ evaluation: evaluation("UNAVAILABLE"), repairCount: 0, maxRepairCount: 2 });
  assert.equal(decision.continuityStatus, "NEEDS_ATTENTION");
  assert.equal(decision.strategy, "PASS");
  assert.equal(decision.shouldCreateRepair, false);
});

test("failed evaluation records attention without creating another repair", () => {
  const decision = decideContinuityRepair({ evaluation: evaluation("FAILED"), repairCount: 0, maxRepairCount: 2 });
  assert.deepEqual(decision, {
    strategy: "PASS",
    continuityStatus: "NEEDS_ATTENTION",
    durationMs: 0,
    shouldCreateRepair: false,
  });
});

test("safe summaries are bounded and single-line", () => {
  assert.equal(normalizeContinuitySummary(" a\nb\tc ".repeat(100), "fallback").length, 240);
  assert.equal(normalizeContinuitySummary(" \n\t ", "fallback"), "fallback");
});
