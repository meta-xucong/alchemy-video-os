import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  Sub2ApiDownloadFailure,
  Sub2ApiProviderFailure,
  Sub2ApiVideoProvider,
  VideoProviderProtocolError,
  createMockMp4Fixture,
  validateMp4Bytes,
} from "../src/index.js";
import { FakeSub2ApiTransport } from "./support/fake-sub2api-transport.js";

const fixtureRootUrl = new URL("../../../fixtures/providers/sub2api/grok-imagine-video-1.5/", import.meta.url);
const fixtureRoot = fileURLToPath(fixtureRootUrl);
const fixtureParentUrl = new URL("../../../fixtures/providers/sub2api/", import.meta.url);
const readJson = async (name: string) => JSON.parse(await readFile(new URL(name, fixtureRootUrl), "utf8"));

const input = {
  taskRunId: "tsk_01J00000000000000000000000",
  inputSnapshot: {
    model: "grok-imagine-video-1.5",
    prompt: "A paper kite moving gently above a green field.",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
    reference_asset_ids: [],
    visual_input: { mode: "TEXT", references: [] },
  },
  visualInput: { mode: "TEXT" },
} as const;

const streamFromBytes = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(bytes);
    controller.close();
  },
});

const readStream = async (stream: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
};

test("CONTRACT-003 maps a synthetic submission response to a provider request ID", async () => {
  const transport = new FakeSub2ApiTransport([{
    status: 202,
    json: await readJson("submit.response.json"),
  }]);
  const provider = new Sub2ApiVideoProvider(transport);

  assert.deepEqual(await provider.submit(input), { providerRequestId: "req_fixture_001" });
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0]?.path, "/videos/generations");
});

test("the adapter accepts the documented request_id compatibility branch", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 202,
    json: { request_id: "req_fixture_compat_001" },
  }]));

  assert.deepEqual(await provider.submit(input), { providerRequestId: "req_fixture_compat_001" });
});

test("the adapter accepts a KIE-compatible nested taskId submission envelope", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    json: { code: 200, msg: "success", data: { taskId: "task_grok_fixture_001" } },
  }]));

  assert.deepEqual(await provider.submit(input), { providerRequestId: "task_grok_fixture_001" });
});

test("the adapter accepts a compatible nested video.task_id envelope", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    json: { status: "queued", video: { task_id: "task_grok_fixture_video_001" } },
  }]));

  assert.deepEqual(await provider.submit(input), { providerRequestId: "task_grok_fixture_video_001" });
});

test("the adapter reads nested status and msg fields without changing the wire path", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    json: { code: 200, data: { taskId: "task_grok_fixture_001", status: "completed" } },
  }]));

  assert.deepEqual(await provider.getStatus({ providerRequestId: "task_grok_fixture_001" }), { state: "SUCCEEDED" });
});

test("the adapter exposes a nested KIE rejection as a non-retryable provider failure", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    json: { code: 422, msg: "invalid input" },
  }]));

  await assert.rejects(
    () => provider.submit(input),
    (error: unknown) => error instanceof Sub2ApiProviderFailure
      && error.status.code === "PROVIDER_REJECTED"
      && error.status.message === "invalid input"
      && !error.status.retryable,
  );
});

test("the adapter requires an explicitly injected transport", () => {
  assert.throws(
    () => new Sub2ApiVideoProvider(undefined as never),
    VideoProviderProtocolError,
  );
});

test("the injected adapter path cannot fall back to global fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("C07 must not call global fetch.");
  }) as typeof fetch;
  try {
    const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
      status: 202,
      json: { id: "req_fixture_001" },
    }]));
    assert.deepEqual(await provider.submit(input), { providerRequestId: "req_fixture_001" });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CONTRACT-004 maps processing state and never downloads while polling", async () => {
  const transport = new FakeSub2ApiTransport([{
    status: 200,
    json: await readJson("status.processing.json"),
  }]);
  const provider = new Sub2ApiVideoProvider(transport);

  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "PROCESSING" });
  assert.deepEqual(transport.requests, [{ method: "GET", path: "/videos/req_fixture_001" }]);
});

test("the adapter accepts the documented state compatibility branch", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    json: { state: "running" },
  }]));

  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "PROCESSING" });
});

test("CONTRACT-005 maps successful status and returns a stream C06 can validate", async () => {
  const fixture = await createMockMp4Fixture();
  const transport = new FakeSub2ApiTransport([
    { status: 200, json: await readJson("status.succeeded.json") },
    {
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": String(fixture.byteLength) },
      json: await readJson("content.metadata.json"),
      stream: streamFromBytes(fixture),
    },
  ]);
  const provider = new Sub2ApiVideoProvider(transport);

  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "SUCCEEDED" });
  const download = await provider.download({ providerRequestId: "req_fixture_001" });
  assert.equal(download.mimeType, "video/mp4");
  assert.equal(download.contentLength, fixture.byteLength);
  const bytes = await readStream(download.stream);
  const inspection = await validateMp4Bytes(bytes, download.mimeType);
  assert.equal(inspection.mimeType, "video/mp4");
  assert.equal(inspection.width, 160);
  assert.equal(inspection.height, 90);
  assert.deepEqual(transport.requests.map((request) => request.path), [
    "/videos/req_fixture_001",
    "/videos/req_fixture_001/content",
  ]);
});

test("the adapter accepts the documented complete and done terminal statuses", async () => {
  for (const fixture of ["status.complete.json", "status.done.json"]) {
    const transport = new FakeSub2ApiTransport([{
      status: 200,
      json: await readJson(fixture),
    }]);
    const provider = new Sub2ApiVideoProvider(transport);

    assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "SUCCEEDED" });
    assert.deepEqual(transport.requests, [{ method: "GET", path: "/videos/req_fixture_001" }]);
  }
});

test("the adapter treats the observed unknown status as transient before queued and terminal states", async () => {
  const transport = new FakeSub2ApiTransport([
    { status: 200, json: await readJson("status.unknown.json") },
    { status: 200, json: await readJson("status.queued.json") },
    { status: 200, json: await readJson("status.succeeded.json") },
  ]);
  const provider = new Sub2ApiVideoProvider(transport);

  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "PROCESSING" });
  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "PROCESSING" });
  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), { state: "SUCCEEDED" });
  assert.deepEqual(transport.requests, [
    { method: "GET", path: "/videos/req_fixture_001" },
    { method: "GET", path: "/videos/req_fixture_001" },
    { method: "GET", path: "/videos/req_fixture_001" },
  ]);
});

test("the adapter keeps incomplete or arbitrary unknown statuses fail-closed", async () => {
  for (const json of [
    { status: "unknown", progress: 0 },
    { id: "req_fixture_001", status: "unknown" },
    { id: "req_fixture_001", status: "unknown", progress: "0" },
    { id: "req_fixture_001", status: "unknown", progress: 100 },
    { id: "req_fixture_001", status: "unknown", progress: -1 },
    { id: "req_fixture_001", status: "unknown", progress: Number.NaN },
    { id: "req_fixture_001", status: "mystery", progress: 0 },
  ]) {
    await assert.rejects(
      () => new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{ status: 200, json }]))
        .getStatus({ providerRequestId: "req_fixture_001" }),
      VideoProviderProtocolError,
    );
  }
});

test("CONTRACT-005 preserves the MIME type while accepting standard Content-Type parameters", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    headers: { "content-type": "Video/MP4; charset=binary" },
    stream: streamFromBytes(new Uint8Array([0, 1, 2])),
  }]));

  const download = await provider.download({ providerRequestId: "req_fixture_001" });
  assert.equal(download.mimeType, "video/mp4");
});

test("CONTRACT-006 maps a synthetic provider rejection to a safe failed status", async () => {
  const transport = new FakeSub2ApiTransport([{
    status: 200,
    json: await readJson("status.failed.json"),
  }]);
  const provider = new Sub2ApiVideoProvider(transport);

  assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), {
    state: "FAILED",
    code: "PROVIDER_REJECTED",
    message: "Synthetic fixture rejection.",
    retryable: false,
  });
});

test("CONTRACT-006 normalizes polling 429 and 503 as retryable provider status failures", async () => {
  for (const status of [429, 503]) {
    const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
      status,
    }]));

    assert.deepEqual(await provider.getStatus({ providerRequestId: "req_fixture_001" }), {
      state: "FAILED",
      code: "PROVIDER_UNAVAILABLE",
      message: "The SUB2API video service is temporarily unavailable.",
      retryable: true,
    });
  }
});

test("CONTRACT-006 normalizes submit and download transport failures without raw payloads", async () => {
  const submitProvider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 503,
    json: { message: "Upstream unavailable" },
  }]));
  await assert.rejects(
    () => submitProvider.submit(input),
    (error: unknown) => error instanceof Sub2ApiProviderFailure
      && error.status.state === "FAILED"
      && error.status.code === "PROVIDER_UNAVAILABLE"
      && error.status.retryable,
  );

  const downloadProvider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{ status: 404 }]));
  await assert.rejects(
    () => downloadProvider.download({ providerRequestId: "req_fixture_001" }),
    (error: unknown) => error instanceof Sub2ApiDownloadFailure
      && error.code === "DOWNLOAD_INVALID"
      && error.stage === "DOWNLOAD"
      && !error.retryable,
  );
});

test("CONTRACT-005 rejects a download without MIME metadata", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    stream: streamFromBytes(new Uint8Array([0, 1, 2])),
  }]));

  await assert.rejects(
    () => provider.download({ providerRequestId: "req_fixture_001" }),
    (error: unknown) => error instanceof Sub2ApiDownloadFailure
      && error.code === "DOWNLOAD_INVALID"
      && error.stage === "DOWNLOAD"
      && !error.retryable,
  );
});

test("CONTRACT-005 rejects an invalid or empty download Content-Length", async () => {
  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    headers: { "content-type": "video/mp4", "content-length": "not-a-length" },
    stream: streamFromBytes(new Uint8Array([0, 1, 2])),
  }]));

  await assert.rejects(
    () => provider.download({ providerRequestId: "req_fixture_001" }),
    (error: unknown) => error instanceof Sub2ApiDownloadFailure
      && error.code === "DOWNLOAD_INVALID"
      && error.stage === "DOWNLOAD"
      && !error.retryable,
  );

  const emptyLengthProvider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 200,
    headers: { "content-type": "video/mp4", "content-length": "  " },
    stream: streamFromBytes(new Uint8Array([0, 1, 2])),
  }]));
  await assert.rejects(
    () => emptyLengthProvider.download({ providerRequestId: "req_fixture_001" }),
    (error: unknown) => error instanceof Sub2ApiDownloadFailure
      && error.code === "DOWNLOAD_INVALID"
      && error.stage === "DOWNLOAD"
      && !error.retryable,
  );
});

test("CONTRACT-007 rejects malformed payloads without retrying submission", async () => {
  const missingId = new FakeSub2ApiTransport([{ status: 202, json: await readJson("malformed.missing-id.json") }]);
  await assert.rejects(
    () => new Sub2ApiVideoProvider(missingId).submit(input),
    VideoProviderProtocolError,
  );
  assert.equal(missingId.requests.length, 1);

  const missingStatus = new FakeSub2ApiTransport([{ status: 200, json: await readJson("malformed.missing-status.json") }]);
  await assert.rejects(
    () => new Sub2ApiVideoProvider(missingStatus).getStatus({ providerRequestId: "req_fixture_001" }),
    VideoProviderProtocolError,
  );

  const nonJson = new FakeSub2ApiTransport([{
    status: 200,
    json: await readFile(new URL("malformed.non-json.txt", fixtureRootUrl), "utf8"),
  }]);
  await assert.rejects(
    () => new Sub2ApiVideoProvider(nonJson).getStatus({ providerRequestId: "req_fixture_001" }),
    VideoProviderProtocolError,
  );

  const conflictingState = new FakeSub2ApiTransport([{
    status: 200,
    json: { status: "processing", state: "succeeded" },
  }]);
  await assert.rejects(
    () => new Sub2ApiVideoProvider(conflictingState).getStatus({ providerRequestId: "req_fixture_001" }),
    VideoProviderProtocolError,
  );
});

test("CONTRACT-008 keeps fixtures and derived failure summaries free of sensitive values", async () => {
  const files = [
    new URL("schema-version.json", fixtureParentUrl),
    ...(await readdir(fixtureRoot)).map((file) => new URL(file, fixtureRootUrl)),
  ];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /authorization|bearer|cookie|object_key|x-amz-signature|signature=|api[_-]?key|token/i);
  }

  const provider = new Sub2ApiVideoProvider(new FakeSub2ApiTransport([{
    status: 400,
    json: { message: "Rejected Authorization: fixture-secret https://example.invalid/video?X-Amz-Signature=fixture" },
  }]));
  await assert.rejects(
    () => provider.submit(input),
    (error: unknown) => error instanceof Sub2ApiProviderFailure
      && !/authorization|fixture-secret|signature|example\.invalid/i.test(error.status.message),
  );
});
