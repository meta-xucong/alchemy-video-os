import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { readMusicDurationMs } from "../app/composables/musicUploadMetadata.ts";

const fixture = (duration = 30) => {
  const audio = new EventTarget();
  let timeout;
  const revoked = [];
  const counts = { pause: 0, load: 0, cleared: 0, listeners: 0 };
  const add = audio.addEventListener.bind(audio);
  const remove = audio.removeEventListener.bind(audio);
  Object.assign(audio, {
    duration,
    src: "",
    pause: () => { counts.pause += 1; },
    load: () => { counts.load += 1; },
    removeAttribute: (name) => { assert.equal(name, "src"); audio.src = ""; },
    addEventListener: (...args) => { counts.listeners += 1; add(...args); },
    removeEventListener: (...args) => { counts.listeners -= 1; remove(...args); },
  });
  const environment = {
    createAudio: () => audio,
    createObjectURL: () => "blob:owned-music-fixture",
    revokeObjectURL: (url) => revoked.push(url),
    setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 10_000); timeout = callback; return 1; },
    clearTimeout: () => { counts.cleared += 1; },
  };
  return {
    audio, counts, revoked, environment,
    expire: () => timeout(),
    emit: (name) => audio.dispatchEvent(new Event(name)),
    assertReleased: () => {
      assert.equal(audio.src, "");
      assert.equal(counts.listeners, 0);
      assert.equal(counts.pause, 1);
      assert.equal(counts.cleared, 1);
      assert.deepEqual(revoked, ["blob:owned-music-fixture"]);
    },
  };
};

test("MUSIC metadata maps browser seconds to existing integer milliseconds and releases the object URL", async () => {
  const media = fixture(30.125);
  const pending = readMusicDurationMs(new Blob(["music"]), media.environment);
  assert.equal(media.audio.preload, "metadata");
  media.emit("loadedmetadata");
  assert.equal(await pending, 30_125);
  media.assertReleased();
  media.emit("error");
  media.expire();
  media.assertReleased();
});

for (const duration of [NaN, Infinity, -Infinity, 0, -1, 0.0001, Number.MAX_SAFE_INTEGER, 2_147_483.648]) {
  test(`MUSIC metadata rejects invalid or out-of-storage-range duration ${duration}`, async () => {
    const media = fixture(duration);
    const pending = readMusicDurationMs(new Blob(), media.environment);
    media.emit("loadedmetadata");
    await assert.rejects(pending, /无法读取音乐时长/);
    media.assertReleased();
  });
}

for (const failure of ["error", "timeout", "load throws"]) {
  test(`MUSIC metadata rejects ${failure} and releases its URL`, async () => {
    const media = fixture();
    if (failure === "load throws") media.audio.load = () => { throw new Error("unavailable media loader"); };
    const pending = readMusicDurationMs(new Blob(), media.environment);
    if (failure === "timeout") media.expire();
    if (failure === "error") media.emit("error");
    await assert.rejects(pending, /无法读取音乐时长/);
    media.assertReleased();
  });
}

// Execute the actual page upload handler with its boundary ports replaced.
// This catches missing/incorrect duration forwarding without inventing a
// second upload implementation or counting a source-string match as behavior.
const page = readFileSync(new URL("../app/pages/projects/[project_id].vue", import.meta.url), "utf8");
const uploadSource = page.slice(page.indexOf("async function uploadMusic("), page.indexOf("async function importPixabayMusicAsset("));
const uploadJavascript = ts.transpileModule(uploadSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const safeErrorSource = page.slice(page.indexOf("function safeErrorMessage("), page.indexOf("function uniqueReferenceIds("));
const safeErrorJavascript = ts.transpileModule(safeErrorSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const safeErrorMessage = new Function(`${safeErrorJavascript}\nreturn safeErrorMessage;`)();
const handlerFixture = (overrides = {}) => {
  const calls = [];
  const context = {
    selectedProjectId: { value: "prj_source" },
    productionBusy: { value: false },
    productionError: { value: "" },
    readMusicDurationMs: async () => 30_000,
    sha256: async () => "a".repeat(64),
    createUploadRequest: async (...args) => { calls.push(["reserve", ...args]); return { data: { asset_id: "ast_music", upload_url: "http://storage.invalid/owned-music", headers: {} } }; },
    fetch: async (...args) => { calls.push(["put", ...args]); return { ok: true }; },
    confirmAssetUpload: async (...args) => { calls.push(["confirm", ...args]); },
    commandKey: (prefix) => prefix,
    musicPlan: { mode: "OFF", assetId: "" },
    refreshCurrentProject: async () => { calls.push(["refresh"]); },
    safeErrorMessage,
    ...overrides,
  };
  const upload = new Function(...Object.keys(context), `${uploadJavascript}\nreturn uploadMusic;`)(...Object.values(context));
  return { upload, context, calls };
};
const file = new File(["music"], "c12-music.wav", { type: "audio/wav" });

test("actual MUSIC upload handler forwards metadata in the public confirmation body", async () => {
  const { upload, context, calls } = handlerFixture();
  await upload(file);
  assert.deepEqual(calls.map(([action]) => action), ["reserve", "put", "confirm", "refresh"]);
  assert.deepEqual(calls[2].slice(1), ["ast_music", { sha256: "a".repeat(64), mime_type: file.type, byte_size: file.size, duration_ms: 30_000 }, "studio-music-confirm"]);
  assert.deepEqual(context.musicPlan, { mode: "MANUAL", assetId: "ast_music" });
  assert.equal(context.productionBusy.value, false);
});

test("actual MUSIC upload handler performs no network operation when metadata is unavailable", async () => {
  const media = fixture(NaN);
  const value = handlerFixture({ readMusicDurationMs: (file) => readMusicDurationMs(file, media.environment) });
  const pending = value.upload(file);
  media.emit("loadedmetadata");
  await pending;
  assert.deepEqual(value.calls, []);
  assert.equal(value.context.productionError.value, "音乐暂时无法添加，请稍后重试。");
  assert.equal(value.context.productionBusy.value, false);
  media.assertReleased();
});

test("actual MUSIC upload handler does not reserve an asset after project navigation during metadata loading", async () => {
  let finish;
  const value = handlerFixture({ readMusicDurationMs: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = value.upload(file);
  value.context.selectedProjectId.value = "prj_other";
  finish(30_000);
  await pending;
  assert.deepEqual(value.calls, []);
  assert.deepEqual(value.context.musicPlan, { mode: "OFF", assetId: "" });
});

test("actual MUSIC upload handler does not apply an old project's completed confirmation to a new project", async () => {
  const selectedProjectId = { value: "prj_source" };
  const value = handlerFixture({
    selectedProjectId,
    confirmAssetUpload: async () => { selectedProjectId.value = "prj_other"; },
  });
  await value.upload(file);
  assert.deepEqual(value.calls.map(([action]) => action), ["reserve", "put"]);
  assert.deepEqual(value.context.musicPlan, { mode: "OFF", assetId: "" });
});
