import assert from "node:assert/strict";
import test from "node:test";

import {
  MockVideoProvider,
  VideoProviderProtocolError,
  createMockMp4Fixture,
  validateMp4Bytes,
  verifyBundledMediaTools,
} from "../src/index.js";

const snapshot = {
  model: "mock-video-v1",
  prompt: "A local mock video.",
  duration: 1,
  resolution: "160x90",
  ratio: "16:9",
  reference_asset_ids: [],
} as const;

test("the local Mock provider has deterministic submit, poll, and download behavior", async () => {
  await verifyBundledMediaTools();
  const fixture = await createMockMp4Fixture();
  const provider = new MockVideoProvider({ fixtureBytes: fixture });
  const submission = await provider.submit({ taskRunId: "tsk_01J00000000000000000000000", inputSnapshot: snapshot });

  assert.equal(submission.providerRequestId, "mock_tsk_01J00000000000000000000000");
  assert.deepEqual(await provider.getStatus(submission), { state: "PROCESSING" });
  assert.deepEqual(await provider.getStatus(submission), { state: "SUCCEEDED" });

  const response = await provider.download(submission);
  const chunks: Uint8Array[] = [];
  const reader = response.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual(bytes, fixture);
  const inspection = await validateMp4Bytes(bytes, "video/mp4");
  assert.equal(inspection.mimeType, "video/mp4");
  assert.equal(inspection.width, 160);
  assert.equal(inspection.height, 90);
  assert.ok(inspection.durationMs > 0);
  assert.match(inspection.sha256, /^[a-f0-9]{64}$/);
});

test("the Mock provider has a deterministic failure mode and validates request IDs", async () => {
  const fixture = await createMockMp4Fixture();
  const provider = new MockVideoProvider({ fixtureBytes: fixture, outcome: "failed" });
  const submission = await provider.submit({ taskRunId: "tsk_01J00000000000000000000001", inputSnapshot: snapshot });

  assert.deepEqual(await provider.getStatus(submission), {
    state: "FAILED",
    code: "PROVIDER_REJECTED",
    message: "Mock video generation was configured to fail.",
    retryable: false,
  });
  await assert.rejects(
    () => provider.getStatus({ providerRequestId: "untrusted" }),
    VideoProviderProtocolError,
  );
  await assert.rejects(
    () => validateMp4Bytes(new Uint8Array([0, 1]), "video/mp4"),
    VideoProviderProtocolError,
  );
});
