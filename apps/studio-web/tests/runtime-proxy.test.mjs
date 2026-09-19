import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApp, defineEventHandler, toNodeListener } from "h3";

import { proxyControlApiRequest, resolveControlApiOrigin } from "../app/server/utils/control-api-proxy.mjs";

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });

const close = (server) => new Promise((resolve) => server.close(resolve));

test("runtime proxy honors CONTROL_API_ORIGIN without reading .env.local", async () => {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, "/api/v1/health?probe=runtime");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ upstream: "control-api" }));
  });
  const upstreamAddress = await listen(upstream);
  const configuredOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
  const proxyApp = createApp();
  const proxyServer = createServer(toNodeListener(proxyApp));

  proxyApp.use(
    "/api/v1",
    defineEventHandler((event) =>
      proxyControlApiRequest(
        event,
        resolveControlApiOrigin("http://127.0.0.1:65535", { CONTROL_API_ORIGIN: configuredOrigin }),
      ),
    ),
  );

  try {
    const proxyAddress = await listen(proxyServer);
    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/v1/health?probe=runtime`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { upstream: "control-api" });
  } finally {
    await Promise.all([close(proxyServer), close(upstream)]);
  }
});
