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
    reference_asset_ids: ["ast_01J00000000000000000000000"],
  },
} as const;

const fixtureRoot = new URL("../../../fixtures/providers/sub2api/grok-imagine-video-1.5/", import.meta.url);
const readFixture = async (name: string) => JSON.parse(await readFile(new URL(name, fixtureRoot), "utf8"));

test("CONTRACT-001 maps a minimal text-to-video request without platform fields", async () => {
  assert.deepEqual(mapSub2ApiGenerationRequest(input), await readFixture("text-to-video.request.json"));
});

test("CONTRACT-002 maps one resolved reference image only to image.image_url", async () => {
  assert.deepEqual(mapSub2ApiGenerationRequest({
    ...input,
    referenceImageUrl: "https://example.invalid/reference.png",
  }), await readFixture("image-to-video.request.json"));
});

test("the mapper rejects an explicitly empty execution-only reference URL", () => {
  assert.throws(
    () => mapSub2ApiGenerationRequest({ ...input, referenceImageUrl: "  " }),
    VideoProviderProtocolError,
  );
});
