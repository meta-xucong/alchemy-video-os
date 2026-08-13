import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";

import { createApp } from "../src/app.js";
import { errorHandler } from "../src/middleware/logger.js";

test("health endpoint returns the Control API and dependency status", async () => {
  const response = await createApp().request("http://localhost/api/v1/health");

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, {
    service: "control-api",
    status: "ok",
    build_version: "local",
    dependencies: { database: "not_configured" },
  });
  assert.match(body.request_id, /^req_[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("error middleware returns the platform error envelope", async () => {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/boom", () => {
    throw new Error("test failure");
  });

  const response = await app.request("http://localhost/boom");

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body.error, {
    code: "INTERNAL_ERROR",
    message: "Unexpected control API error.",
    retryable: false,
    details: {},
  });
  assert.match(body.request_id, /^req_[0-9A-HJKMNP-TV-Z]{26}$/);
});
