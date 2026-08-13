import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getInternalC07Sub2ApiCapabilitySnapshot } from "../src/sub2api/capabilities.js";

test("the C07 capability snapshot is immutable and every candidate is disabled", () => {
  const snapshot = getInternalC07Sub2ApiCapabilitySnapshot();
  assert.equal(snapshot.version, 1);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.profiles));
  assert.ok(snapshot.profiles.length > 0);
  for (const profile of snapshot.profiles) {
    assert.equal(profile.enabled, false);
    assert.equal(profile.provider, "sub2api");
    assert.deepEqual(profile.inputModes, []);
    assert.deepEqual(profile.durations, []);
    assert.deepEqual(profile.resolutions, []);
    assert.deepEqual(profile.ratios, []);
    assert.ok(Object.isFrozen(profile));
    assert.ok(Object.isFrozen(profile.inputModes));
    assert.ok(Object.isFrozen(profile.durations));
    assert.ok(Object.isFrozen(profile.resolutions));
    assert.ok(Object.isFrozen(profile.ratios));
  }
});

test("the internal C07 snapshot is not exported through package or public contracts", async () => {
  const [packageIndex, openApi, contractsSource, studioComposable, studioPage] = await Promise.all([
    readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../contracts/openapi.json", import.meta.url), "utf8"),
    readFile(new URL("../../contracts/src/specifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/studio-web/app/composables/useControlApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/studio-web/app/pages/index.vue", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(packageIndex, /capabilities/);
  assert.doesNotMatch(openApi, /grok-imagine-video|sub2api/i);
  assert.doesNotMatch(contractsSource, /capabilit|sub2api/i);
  assert.doesNotMatch(studioComposable, /grok-imagine-video|sub2api|capabilities/i);
  assert.doesNotMatch(studioPage, /grok-imagine-video|sub2api|capabilities/i);
});
