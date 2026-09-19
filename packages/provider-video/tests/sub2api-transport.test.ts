import assert from "node:assert/strict";
import test from "node:test";

import type { Sub2ApiTransport } from "../src/sub2api/transport.js";
import { FakeSub2ApiTransport } from "./support/fake-sub2api-transport.js";

test("the C07 transport boundary is injectable and records no implicit network configuration", async () => {
  const transport: Sub2ApiTransport = new FakeSub2ApiTransport([{
    status: 202,
    json: { id: "req_fixture_001", status: "processing" },
  }]);

  const response = await transport.request({
    method: "POST",
    path: "/videos/generations",
    body: { model: "grok-imagine-video-1.5" },
  });

  assert.equal(response.status, 202);
  assert.deepEqual(response.json, { id: "req_fixture_001", status: "processing" });
  assert.deepEqual((transport as FakeSub2ApiTransport).requests, [{
    method: "POST",
    path: "/videos/generations",
    body: { model: "grok-imagine-video-1.5" },
  }]);
});
