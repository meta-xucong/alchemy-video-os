import assert from "node:assert/strict";
import test from "node:test";
import { assertCommercialWorkerConfig, isCommercialWorkerModeEnabled } from "../src/production-config.js";

test("commercial worker rejects an uncertified or mock provider", () => {
  assert.throws(() => assertCommercialWorkerConfig({ COMMERCIAL_MODE: "true", VIDEO_PROVIDER: "mock" }), /commercial mode/);
  assert.doesNotThrow(() => assertCommercialWorkerConfig({ COMMERCIAL_MODE: "false", VIDEO_PROVIDER: "mock" }));
});

test("commercial worker requires provider credentials only in the worker", () => {
  const base = { COMMERCIAL_MODE: "true", VIDEO_PROVIDER: "sub2api", VIDEO_PROVIDER_CERTIFIED: "true", SUB2API_VIDEO_BASE_URL: "https://provider.example" };
  assert.throws(() => assertCommercialWorkerConfig(base), /API_KEY/);
  assert.throws(() => assertCommercialWorkerConfig({ ...base, SUB2API_VIDEO_API_KEY: "k".repeat(40) }), /VEYRA_CREDIT_ENABLED/);
  assert.doesNotThrow(() => assertCommercialWorkerConfig({ ...base, SUB2API_VIDEO_API_KEY: "k".repeat(40), VEYRA_CREDIT_ENABLED: "true" }));
});

test("commercial worker mode uses normalized boolean semantics", () => {
  assert.equal(isCommercialWorkerModeEnabled(" TRUE "), true);
  assert.throws(() => assertCommercialWorkerConfig({ COMMERCIAL_MODE: " TRUE ", VIDEO_PROVIDER: "mock" }), /commercial mode/);
  assert.doesNotThrow(() => assertCommercialWorkerConfig({ COMMERCIAL_MODE: " false ", VIDEO_PROVIDER: "mock" }));
});
