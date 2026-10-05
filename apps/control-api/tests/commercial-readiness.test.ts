import assert from "node:assert/strict";
import test from "node:test";
import { isCommercialFlagEnabled, validateCommercialConfig } from "../src/production-config.js";

const safe = {
  COMMERCIAL_MODE: "true",
  NODE_ENV: "production",
  LOCAL_AUTH_MODE: "veyra",
  VEYRA_AUTH_ENABLED: "true",
  VEYRA_CREDIT_ENABLED: "true",
  VIDEO_PROVIDER: "sub2api",
  SUB2API_VIDEO_BASE_URL: "https://provider.example",
  VIDEO_PROVIDER_CERTIFIED: "true",
  EDGE_NGINX_CONFIG: "./nginx/video.aiself.vip.veyra.conf",
  VIDEO_SESSION_SECRET: "s".repeat(40),
  VIDEO_SESSION_MAX_AGE_SECONDS: "3600",
  REFERENCE_DELIVERY_SIGNING_KEY: "r".repeat(40),
  MEDIA_RUNTIME_TOKEN: "m".repeat(40),
  DOCUMENT_RUNTIME_TOKEN: "d".repeat(40),
  VIDEO_VEYRA_INTERNAL_TOKEN: "v".repeat(40),
  VIDEO_VEYRA_INTERNAL_BASE_URL: "https://aiself.example",
  VIDEO_VEYRA_PORTAL_BASE_URL: "https://aiself.example",
  REFERENCE_DELIVERY_ORIGIN: "https://video.example",
  CONTROL_API_CORS_ORIGINS: "https://video.example",
};

test("commercial mode rejects local/mock and placeholder deployment values", () => {
  assert.deepEqual(validateCommercialConfig({}), []);
  const errors = validateCommercialConfig({ ...safe, VIDEO_PROVIDER: "mock", VEYRA_AUTH_ENABLED: "false" });
  assert.ok(errors.some((error) => error.includes("certified real provider")));
  assert.ok(errors.some((error) => error.includes("VEYRA_AUTH_ENABLED")));
});

test("commercial mode requires an explicit HTTPS origin allowlist", () => {
  const errors = validateCommercialConfig({ ...safe, CONTROL_API_CORS_ORIGINS: "http://localhost:3031" });
  assert.ok(errors.some((error) => error.includes("CONTROL_API_CORS_ORIGINS")));
  assert.deepEqual(validateCommercialConfig(safe), []);
});

test("commercial flags use the same normalization for validation and runtime", () => {
  assert.equal(isCommercialFlagEnabled(" TRUE "), true);
  assert.equal(isCommercialFlagEnabled(" true "), true);
  assert.equal(isCommercialFlagEnabled("false"), false);
  assert.deepEqual(validateCommercialConfig({
    ...safe,
    COMMERCIAL_MODE: " TRUE ",
    VEYRA_AUTH_ENABLED: " TRUE ",
    VEYRA_CREDIT_ENABLED: " TRUE ",
  }), []);
});
