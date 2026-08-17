import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { VideoProviderProtocolError } from "../src/port.js";
import { mapSub2ApiGenerationRequest } from "../src/sub2api/mapper.js";

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

const fixtureRoot = new URL("../../../fixtures/providers/sub2api/grok-imagine-video-1.5/", import.meta.url);
const readFixture = async (name: string) => JSON.parse(await readFile(new URL(name, fixtureRoot), "utf8"));

test("CONTRACT-001 maps a minimal text-to-video request without platform fields", async () => {
  assert.deepEqual(mapSub2ApiGenerationRequest(input), await readFixture("text-to-video.request.json"));
});

test("CONTRACT-002 maps one resolved opening image only to image.image_url", async () => {
  assert.deepEqual(mapSub2ApiGenerationRequest({
    ...input,
    visualInput: { mode: "FIRST_FRAME", url: "https://example.invalid/reference.png" },
  }), await readFixture("image-to-video.request.json"));
});

test("the mapper maps one to seven ordered reference images without a local prompt-length gate", () => {
  const urls = Array.from({ length: 7 }, (_, index) => `https://example.invalid/reference-${index + 1}.png`);
  const request = mapSub2ApiGenerationRequest({
    ...input,
    inputSnapshot: { ...input.inputSnapshot, prompt: "x".repeat(8_192) },
    visualInput: { mode: "REFERENCE_SET", urls },
  });
  assert.deepEqual(request.reference_images, urls.map((url) => ({ url })));
  assert.equal(request.image, undefined);
});

test("the mapper rejects empty, non-HTTPS, or oversized resolved reference inputs", () => {
  assert.throws(
    () => mapSub2ApiGenerationRequest({ ...input, visualInput: { mode: "FIRST_FRAME", url: "  " } }),
    VideoProviderProtocolError,
  );
  assert.throws(
    () => mapSub2ApiGenerationRequest({ ...input, visualInput: { mode: "REFERENCE_SET", urls: ["http://example.invalid/reference.png"] } }),
    VideoProviderProtocolError,
  );
  assert.throws(
    () => mapSub2ApiGenerationRequest({ ...input, visualInput: { mode: "REFERENCE_SET", urls: Array.from({ length: 8 }, () => "https://example.invalid/reference.png") } }),
    VideoProviderProtocolError,
  );
});
