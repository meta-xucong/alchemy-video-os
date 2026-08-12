import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";

import { createApp } from "../src/app.js";
import { errorHandler } from "../src/middleware/logger.js";

test("health endpoint returns the local control API identity", async () => {
  const response = await createApp().request("http://localhost/api/v1/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      service: "control-api",
      status: "ok"
    },
    request_id: "local"
  });
});

test("error middleware returns the platform error envelope", async () => {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/boom", () => {
    throw new Error("test failure");
  });

  const response = await app.request("http://localhost/boom");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected control API error.",
      retryable: false,
      details: {}
    },
    request_id: "local"
  });
});
