import assert from "node:assert/strict";
import test from "node:test";

import { VideoProviderFailure, VideoProviderProtocolError } from "@alchemy-video/provider-video";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";

import { createWorkerVideoProviderRuntime } from "../src/provider-runtime.js";
import { createWorkerReferenceDeliveryPort } from "../src/reference-delivery.js";
import { createSub2ApiHttpsTransport, type WorkerFetchResponse } from "../src/sub2api-https-transport.js";

const deliveryHeaders = (values: Record<string, string> = {}) => ({
  get(name: string) {
    return values[name.toLowerCase()] ?? null;
  },
});

const deliveryResponse = (status: number, values: Record<string, string> = {}, body: ReadableStream<Uint8Array> | null = null) => ({
  status,
  headers: deliveryHeaders(values),
  body,
});

const referenceInput = (count = 1) => ({
  mode: "REFERENCE_SET" as const,
  references: Array.from({ length: count }, (_, position) => ({
    asset_id: `ast_01J4N8QZ8PCW2N2G6D2XJXJXJ${position}`,
    sha256: `${String.fromCharCode(97 + position)}`.repeat(64),
    mime_type: "image/png" as const,
    position,
  })),
});

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
     environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key, REFERENCE_DELIVERY_PREFLIGHT_ENABLED: "false" },
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

test("the Worker treats a transient non-JSON status response as retryable without changing the request ID", async () => {
  const requests: string[] = [];
  const runtime = await createWorkerVideoProviderRuntime({
    environment: {
      VIDEO_PROVIDER: "sub2api",
      SUB2API_VIDEO_BASE_URL: "https://gateway.example.invalid/v1",
      SUB2API_VIDEO_API_KEY: "test-worker-key",
    },
    fetcher: async (url, init) => {
      requests.push(`${init.method} ${url}`);
      return {
        status: 200,
        headers: headers({ "content-type": "text/html" }),
        body: null,
        async json() { throw new Error("gateway returned HTML"); },
      } satisfies WorkerFetchResponse;
    },
  });

  await assert.rejects(
    () => runtime.provider.getStatus({ providerRequestId: "video_existing_request" }),
    (error: unknown) => error instanceof VideoProviderFailure
      && error.code === "PROVIDER_UNAVAILABLE"
      && error.retryable
      && error.stage === "PROVIDER",
  );
  assert.deepEqual(requests, ["GET https://gateway.example.invalid/v1/videos/video_existing_request"]);
});

test("reference delivery prioritizes a scene anchor before a subject for R2V", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const references = [
    {
      asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJ0",
      sha256: "a".repeat(64),
      mime_type: "image/png" as const,
      position: 0,
      role: "SUBJECT" as const,
    },
    {
      asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJ1",
      sha256: "b".repeat(64),
      mime_type: "image/png" as const,
      position: 1,
      role: "SCENE" as const,
    },
  ];
  const key = "reference-delivery-role-test-secret-with-at-least-32-characters";
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
     environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key, REFERENCE_DELIVERY_PREFLIGHT_ENABLED: "false" },
  });
  const resolved = await port.createVisualInput({
    workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    visualInput: { mode: "REFERENCE_SET", references },
  });
  assert.equal(resolved.mode, "REFERENCE_SET");
  if (resolved.mode !== "REFERENCE_SET") return;
  const codec = new ReferenceDeliveryTokenCodec(key);
  assert.deepEqual(resolved.urls.map((url) => codec.verify(decodeURIComponent(new URL(url).pathname.split("/").at(-1)!))?.assetId), [references[1]!.asset_id, references[0]!.asset_id]);
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

test("reference delivery preflight retries a transient relay response before returning URLs", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const key = "reference-delivery-preflight-retry-secret-with-at-least-32-characters";
  const methods: string[] = [];
  let calls = 0;
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
    environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key, REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS: "500", REFERENCE_DELIVERY_PREFLIGHT_RETRIES: "1" },
    fetcher: async (_url, init) => {
      methods.push(init.method);
      calls += 1;
      return calls === 1
        ? deliveryResponse(503, { "content-type": "text/plain" })
        : deliveryResponse(200, { "content-type": "image/png", "content-length": "4" });
    },
  });
  const resolved = await port.createVisualInput({ workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX", projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX", visualInput: referenceInput() });
  assert.equal(resolved.mode, "REFERENCE_SET");
  assert.deepEqual(methods, ["HEAD", "HEAD"]);
});

test("reference delivery preflight falls back from HEAD to a bounded GET", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const key = "reference-delivery-preflight-get-secret-with-at-least-32-characters";
  const methods: string[] = [];
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
    environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key, REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS: "500", REFERENCE_DELIVERY_PREFLIGHT_RETRIES: "0" },
    fetcher: async (_url, init) => {
      methods.push(init.method);
      if (init.method === "HEAD") return deliveryResponse(405, { "content-type": "image/png" });
      return deliveryResponse(200, { "content-type": "image/png" }, new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close(); },
      }));
    },
  });
  const resolved = await port.createVisualInput({ workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX", projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX", visualInput: referenceInput() });
  assert.equal(resolved.mode, "REFERENCE_SET");
  assert.deepEqual(methods, ["HEAD", "GET"]);
});

test("reference delivery preflight cancels a GET body when HEAD fallback already supplied a length", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const key = "reference-delivery-preflight-cancel-secret-with-at-least-32-characters";
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); },
    cancel() { cancelled = true; },
  });
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
    environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key, REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS: "500", REFERENCE_DELIVERY_PREFLIGHT_RETRIES: "0" },
    fetcher: async (_url, init) => init.method === "HEAD"
      ? deliveryResponse(405, { "content-type": "image/png" })
      : deliveryResponse(200, { "content-type": "image/png", "content-length": "4" }, body),
  });
  const resolved = await port.createVisualInput({ workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX", projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX", visualInput: referenceInput() });
  assert.equal(resolved.mode, "REFERENCE_SET");
  assert.equal(cancelled, true);
});

test("reference delivery preflight rejects invalid MIME without retrying or exposing the URL", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const key = "reference-delivery-preflight-mime-secret-with-at-least-32-characters";
  const urls: string[] = [];
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
    environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key },
    fetcher: async (url) => {
      urls.push(url);
      return deliveryResponse(200, { "content-type": "text/html", "content-length": "4" });
    },
  });
  await assert.rejects(
    () => port.createVisualInput({ workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX", projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX", visualInput: referenceInput() }),
    (error: unknown) => error instanceof VideoProviderFailure && error.code === "PROVIDER_PROTOCOL_INVALID" && !error.retryable && !error.message.includes("video.example.invalid"),
  );
  assert.equal(urls.length, 1);
});

test("reference delivery preflight turns a timeout into a recoverable provider outage", async () => {
  const profile = (await createWorkerVideoProviderRuntime({ environment: {} })).profile;
  const key = "reference-delivery-preflight-timeout-secret-with-at-least-32-characters";
  const port = createWorkerReferenceDeliveryPort({
    profile: { ...profile, mode: "sub2api", provider: "sub2api", model: "grok-imagine-video-1.5", inputMode: "multi_modal_video" },
    environment: { REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid", REFERENCE_DELIVERY_SIGNING_KEY: key, REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS: "500", REFERENCE_DELIVERY_PREFLIGHT_RETRIES: "0" },
    fetcher: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
  });
  await assert.rejects(
    () => port.createVisualInput({ workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX", projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX", visualInput: referenceInput() }),
    (error: unknown) => error instanceof VideoProviderFailure && error.code === "PROVIDER_UNAVAILABLE" && error.retryable,
  );
});
