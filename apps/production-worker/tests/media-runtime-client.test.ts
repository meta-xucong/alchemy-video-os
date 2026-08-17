import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  encodeMediaCompositionBundle,
  HttpMediaRuntimeClient,
  MediaRuntimeClientError,
  validateMediaRuntimeUrl,
} from "../src/media-runtime-client.js";

const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

test("C12 media runtime client rejects every non-loopback endpoint", () => {
  assert.equal(validateMediaRuntimeUrl("http://127.0.0.1:4033/"), "http://127.0.0.1:4033/");
  for (const value of ["https://127.0.0.1:4033/", "http://localhost:4033/", "http://10.0.0.1:4033/", "http://127.0.0.1:4033/path", "http://token@127.0.0.1:4033/"]) {
    assert.throws(() => validateMediaRuntimeUrl(value));
  }
});

test("C12 media composition bundle is binary, ordered, bounded, and path-free", () => {
  const bundle = encodeMediaCompositionBundle([new Uint8Array([1, 2]), new Uint8Array([3])]);
  assert.deepEqual([...bundle.slice(0, 9)], [...Buffer.from("ALCHMED1"), 2]);
  assert.equal(new DataView(bundle.buffer, bundle.byteOffset + 9, 4).getUint32(0, false), 2);
  assert.throws(() => encodeMediaCompositionBundle([]), MediaRuntimeClientError);
  assert.throws(() => encodeMediaCompositionBundle(Array.from({ length: 13 }, () => new Uint8Array([1]))), MediaRuntimeClientError);
});

test("C12 media runtime client sends only byte payload and validates handoff metadata", async () => {
  const image = new Uint8Array([137, 80, 78, 71]);
  const calls: Array<{ url: string; headers: Headers; body: Uint8Array }> = [];
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (url, init) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: new Uint8Array(init?.body as Buffer),
      });
      return new Response(image, {
        headers: {
          "Content-Type": "image/png",
          "X-Media-Sha256": sha256(image),
          "X-Media-Byte-Size": String(image.byteLength),
          "X-Media-Width": "2",
          "X-Media-Height": "2",
        },
      });
    },
  });
  const source = new Uint8Array([1, 2, 3]);
  const result = await client.extractHandoffFrame({
    operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    bytes: source,
    expectedSha256: sha256(source),
  });
  assert.equal(result.mime_type, "image/png");
  assert.equal(calls[0]?.url, "http://127.0.0.1:4033/internal/v1/media/handoff-frame");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer test-token");
  assert.equal(calls[0]?.headers.has("x-media-object-key"), false);
  assert.deepEqual([...calls[0]!.body], [...source]);
});
