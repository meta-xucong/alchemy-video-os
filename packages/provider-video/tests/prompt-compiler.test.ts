import assert from "node:assert/strict";
import test from "node:test";

import {
  VideoPromptCompilationError,
  compileVideoPrompt,
  resolveVideoProviderRuntimeProfile,
} from "../src/index.js";

const profile = resolveVideoProviderRuntimeProfile("sub2api");

test("the compiler preserves the saved creative description and uses the real-profile defaults", () => {
  const sourcePrompt = "  A new product is revealed on a quiet desk.  ";
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
  });

  assert.deepEqual(compiled.settings, { duration: 5, resolution: "720p", ratio: "16:9" });
  assert.equal(compiled.prompt, sourcePrompt.trim());
});

test("the compiler uses explicit saved video settings instead of extracting values from the description", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "A fast demonstration video, 15S, rendered in 480P.",
    generationSettings: {
      video_settings: { duration_seconds: 8, resolution: "480p", ratio: "16:9" },
    },
    profile,
  });

  assert.deepEqual(compiled.settings, { duration: 8, resolution: "480p", ratio: "16:9" });
  assert.equal(compiled.prompt, "A fast demonstration video, 15S, rendered in 480P.");
});

test("the compiler rejects malformed saved settings without a local prompt-length gate", () => {
  assert.throws(() => compileVideoPrompt({
    sourcePrompt: "A product film.",
    generationSettings: { video_settings: { duration_seconds: 16, resolution: "720p", ratio: "16:9" } },
    profile,
  }), VideoPromptCompilationError);
  const longBrief = "x".repeat(5_000);
  const compiled = compileVideoPrompt({ sourcePrompt: longBrief, generationSettings: {}, profile });
  assert.equal(compiled.prompt.length, longBrief.length);
});
