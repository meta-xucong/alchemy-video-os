import assert from "node:assert/strict";
import test from "node:test";

import { VideoProviderFailure, VideoProviderProtocolError } from "@alchemy-video/provider-video";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";

import { createWorkerVideoProviderRuntime } from "../src/provider-runtime.js";
import { createWorkerReferenceDeliveryPort } from "../src/reference-delivery.js";
import { createSub2ApiHttpsTransport, type WorkerFetchResponse } from "../src/sub2api-https-transport.js";

const headers = (values: Record<string, string> = {}) => ({
  forEach(callback: (value: string, key: string) => void) {
    Object.entries(values).forEach(([key, value]) => callback(value, key));
  },
});

test("the Worker SUB2API runtime preserves the HTTPS base path and only fetches when a provider call occurs", async () => {
  const requests: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];
  const runtime = await createWorkerVideoProviderRuntime({
    environment: {
      VIDEO_PROVIDER: "sub2api",
      SUB2API_VIDEO_BASE_URL: "https://gateway.example.invalid/v1/",
      SUB2API_VIDEO_API_KEY: "test-worker-key",
    },
    fetcher: async (url, init) => {
      requests.push({ url, init: { method: init.method, headers: { ...init.headers }, ...(init.body === undefined ? {} : { body: init.body }) } });
      return {
        status: 202,
        headers: headers(),
        body: null,
        async json() { return { id: "req_fixture_001", status: "processing" }; },
      } satisfies WorkerFetchResponse;
    },
  });
  assert.equal(runtime.profile.provider, "sub2api");
  assert.deepEqual(requests, []);
  const submission = await runtime.provider.submit({
    taskRunId: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    inputSnapshot: {
      model: runtime.profile.model,
      prompt: "A paper kite moving above a green field.",
      duration: runtime.profile.duration,
      resolution: runtime.profile.resolution,
      ratio: runtime.profile.ratio,
      reference_asset_ids: [],
      visual_input: { mode: "TEXT", references: [] },
    },
    visualInput: { mode: "TEXT" },
  });
  assert.equal(submission.providerRequestId, "req_fixture_001");
  assert.equal(requests[0]?.url, "https://gateway.example.invalid/v1/videos/generations");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(requests[0]?.init.headers.authorization, "Bearer test-worker-key");
  assert.match(requests[0]?.init.body ?? "", /grok-imagine-video-1\.5/);
});

test("the Worker transport fails closed for unsafe configuration and normalizes network errors", async () => {
  assert.throws(
    () => createSub2ApiHttpsTransport({ environment: { SUB2API_VIDEO_BASE_URL: "http://gateway.example.invalid/v1", SUB2API_VIDEO_API_KEY: "test-key" } }),
    VideoProviderProtocolError,
  );
  const transport = createSub2ApiHttpsTransport({
    environment: { SUB2API_VIDEO_BASE_URL: "https://gateway.example.invalid/v1", SUB2API_VIDEO_API_KEY: "test-key" },
    fetcher: async () => { throw new Error("offline"); },
  });
  await assert.rejects(
    () => transport.request({ method: "GET", path: "/videos/request/content" }),
    VideoProviderFailure,
  );
  await assert.rejects(
    () => transport.request({ method: "GET", path: "/../escape" }),
    VideoProviderProtocolError,
  );
});

test("the default Worker runtime remains Mock and does not require real-video configuration", async () => {
  const runtime = await createWorkerVideoProviderRuntime({ environment: {} });
  assert.equal(runtime.profile.mode, "mock");
  assert.equal(runtime.profile.model, "mock-video-v1");
});

test("reference delivery preserves one-to-seven image order in opaque HTTPS input URLs", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const references = Array.from({ length: 7 }, (_, position) => ({
    asset_id: `ast_01J4N8QZ8PCW2N2G6D2XJXJXJ${position}`,
    sha256: `${position}`.repeat(64),
    mime_type: "image/png" as const,
    position,
  }));
  const key = "reference-delivery-test-secret-with-at-least-32-characters";
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
    environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key },
  });
  const resolved = await port.createVisualInput({
    workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    visualInput: { mode: "REFERENCE_SET", references },
  });
  assert.equal(resolved.mode, "REFERENCE_SET");
  if (resolved.mode !== "REFERENCE_SET") return;
  assert.equal(resolved.urls.length, 7);
  const codec = new ReferenceDeliveryTokenCodec(key);
  assert.deepEqual(resolved.urls.map((url) => {
    assert.match(url, /^https:\/\/video\.example\.invalid\/provider-input\/v1\./);
    assert.doesNotMatch(url, /ast_|ws_|prj_/);
    return codec.verify(decodeURIComponent(new URL(url).pathname.split("/").at(-1)!))?.assetId;
  }), references.map((reference) => reference.asset_id));
});

test("real reference delivery fails before a Provider request when its HTTPS relay is not configured", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: { VIDEO_PROVIDER: "sub2api", SUB2API_VIDEO_BASE_URL: "https://gateway.example.invalid/v1", SUB2API_VIDEO_API_KEY: "test-worker-key" }, fetcher: async () => { throw new Error("must not fetch"); } })).profile;
  const port = createWorkerReferenceDeliveryPort({ profile, environment: {} });
  await assert.rejects(
    () => port.createVisualInput({
      workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      visualInput: { mode: "FIRST_FRAME", references: [{ asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX", sha256: "a".repeat(64), mime_type: "image/png", position: 0 }] },
    }),
    VideoProviderFailure,
  );
});
