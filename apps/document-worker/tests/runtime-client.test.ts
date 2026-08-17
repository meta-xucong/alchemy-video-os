import assert from "node:assert/strict";
import test from "node:test";

import { HttpDocumentRuntimeClient, validateDocumentRuntimeUrl } from "../src/runtime-client.js";

const validEndpoints = [
  "http://127.0.0.1:3040",
  "http://[::1]:3040",
];

const invalidEndpoints = [
  "https://127.0.0.1:3040",
  "http://localhost:3040",
  "http://127.0.0.2:3040",
  "http://192.168.1.10:3040",
  "http://runtime.internal:3040",
  "http://user:password@127.0.0.1:3040",
  "http://127.0.0.1:3040/internal",
  "http://127.0.0.1:3040?target=remote",
  "http://127.0.0.1:3040#fragment",
];

test("Document Runtime endpoint accepts only root loopback http endpoints", () => {
  for (const endpoint of validEndpoints) {
    assert.match(validateDocumentRuntimeUrl(endpoint), /^http:\/\/(127\.0\.0\.1|\[::1\])/);
  }
  for (const endpoint of invalidEndpoints) {
    assert.throws(() => validateDocumentRuntimeUrl(endpoint), /loopback http endpoint/);
  }
});

test("Document Runtime client rejects an unsafe endpoint before fetching source bytes", async () => {
  let called = false;
  assert.throws(
    () => new HttpDocumentRuntimeClient({
      runtimeUrl: "http://runtime.internal:3040",
      token: "test-token",
      fetcher: async () => {
        called = true;
        return new Response();
      },
    }),
    /loopback http endpoint/,
  );
  assert.equal(called, false);
});

test("Document Runtime client uses the fixed internal conversion path", async () => {
  let requestUrl = "";
  const client = new HttpDocumentRuntimeClient({
    runtimeUrl: "http://127.0.0.1:3040",
    token: "test-token",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({
        markdown: "# Converted",
        converter: "markitdown",
        converter_version: "0.1.7",
        warnings: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await client.convert({
    conversionId: "dcv_01J00000000000000000000000",
    sourceFilename: "brief.pdf",
    sourceMimeType: "application/pdf",
    sourceSha256: "a".repeat(64),
    bytes: new Uint8Array([1, 2, 3]),
  });

  assert.equal(requestUrl, "http://127.0.0.1:3040/internal/v1/document-conversions");
  assert.equal(result.markdown, "# Converted");
});
