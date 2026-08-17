import assert from "node:assert/strict";
import test from "node:test";

import { ReferenceDeliveryTokenCodec, createReferenceDeliveryUrl } from "../src/index.js";

const secret = "reference-delivery-test-secret-with-at-least-32-characters";
const now = new Date("2026-08-15T12:00:00.000Z");
const input = {
  workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  assetId: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  sha256: "a".repeat(64),
  mimeType: "image/png",
  expiresAt: new Date(now.getTime() + 60_000),
};

test("reference delivery issues opaque encrypted tokens scoped to one ready image", () => {
  const codec = new ReferenceDeliveryTokenCodec(secret);
  const token = codec.issue(input);
  assert.doesNotMatch(token, /ws_|prj_|ast_|image\/png|a{20}/);
  assert.deepEqual(codec.verify(token, now), {
    ...input,
    sha256: input.sha256,
    expiresAt: input.expiresAt.toISOString(),
  });
});

test("reference delivery rejects tampered, expired, or non-image claims", () => {
  const codec = new ReferenceDeliveryTokenCodec(secret);
  const token = codec.issue(input);
  assert.equal(codec.verify(`${token}x`, now), undefined);
  assert.equal(codec.verify(token, new Date(input.expiresAt.getTime())), undefined);
  assert.throws(() => codec.issue({ ...input, mimeType: "image/gif" }));
});

test("reference delivery only creates HTTPS provider-input URLs", () => {
  const url = createReferenceDeliveryUrl({ origin: "https://video.example.test/", token: "v1.opaque" });
  assert.equal(url, "https://video.example.test/provider-input/v1.opaque");
  assert.throws(() => createReferenceDeliveryUrl({ origin: "http://video.example.test", token: "v1.opaque" }));
});
