import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  encodeMediaCompositionBundle,
  HttpMediaRuntimeClient,
  MediaRuntimeClientError,
  validateMediaRuntimeUrl,
} from "../src/media-runtime-client.js";

const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

test("C12 media runtime client accepts fixed internal services and loopback only", () => {
  assert.equal(validateMediaRuntimeUrl("http://127.0.0.1:4033/"), "http://127.0.0.1:4033/");
  assert.equal(validateMediaRuntimeUrl("http://media-runtime:3433/"), "http://media-runtime:3433/");
  assert.equal(validateMediaRuntimeUrl("http://control-media-runtime:3433/"), "http://control-media-runtime:3433/");
  for (const value of [
    "https://127.0.0.1:4033/",
    "http://localhost:4033/",
    "http://10.0.0.1:4033/",
    "http://media-runtime:3434/",
    "http://media-runtime.example:3433/",
    "http://127.0.0.1:4033/path",
    "http://token@127.0.0.1:4033/",
    "http://127.0.0.1:4033/?",
    "http://127.0.0.1:4033/#",
    "http://@127.0.0.1:4033/",
    "http://127.0.0.1:4033/%2e",
    "http://127.0.0.1:4033/./",
    "http://127.0.0.1:4033/%2e%2e/",
  ]) {
    assert.throws(() => validateMediaRuntimeUrl(value));
  }
});

test("C12 media composition bundle is binary, ordered, bounded, and path-free", () => {
  const bundle = encodeMediaCompositionBundle([new Uint8Array([1, 2]), new Uint8Array([3])]);
  assert.deepEqual([...bundle.slice(0, 9)], [...Buffer.from("ALCHMED1"), 2]);
  assert.equal(new DataView(bundle.buffer, bundle.byteOffset + 9, 4).getUint32(0, false), 2);
  assert.throws(() => encodeMediaCompositionBundle([]), MediaRuntimeClientError);
  assert.throws(() => encodeMediaCompositionBundle(Array.from({ length: 13 }, () => new Uint8Array([1]))), MediaRuntimeClientError);
});

test("C12.1 composition plan is encoded as bounded transition metadata", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
    { target_duration_ms: 30000, transitions: ["PASS", "BRIDGE"], bridge_durations_ms: [2000] },
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED6")]);
  assert.equal(bundle[8], 3);
  assert.equal(bundle[9], 2);
  assert.deepEqual([...bundle.slice(10, 12)], [0, 2]);
  assert.throws(() => encodeMediaCompositionBundle([new Uint8Array([1]), new Uint8Array([2])], {
    target_duration_ms: 1000,
    transitions: [],
    bridge_durations_ms: [],
  }), MediaRuntimeClientError);
});

test("C12.4 continuous narration cannot be encoded without an authoritative track", () => {
  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([1]), new Uint8Array([2])],
    { target_duration_ms: 20000, transitions: ["PASS"], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION" },
  ), MediaRuntimeClientError);
});

test("C12.4 music plan carries a bounded music asset without exposing a path", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1]), new Uint8Array([2])],
    { target_duration_ms: 20000, transitions: ["PASS"], bridge_durations_ms: [], audio_policy: "LEGACY_PRESERVE", music_mix: { enabled: true } },
    new Uint8Array([0x49, 0x44, 0x33]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED6")]);
  assert.equal(bundle[8], 2);
  assert.equal(bundle.includes(0x5c), false);
});

test("C12.4 narration plan carries the authoritative audio bytes", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1]), new Uint8Array([2])],
    { target_duration_ms: 20000, transitions: ["PASS"], bridge_durations_ms: [], audio_policy: "CONTINUOUS_NARRATION", audio_tracks: [
      { track_id: "platform-narration", ownership: "PLATFORM_NARRATION", start_ms: 0, end_ms: 20000 },
      { track_id: "segment-1", ownership: "PROVIDER_DIALOGUE", start_ms: 0, end_ms: 10000 },
      { track_id: "segment-2", ownership: "PROVIDER_DIALOGUE", start_ms: 10000, end_ms: 20000 },
    ] },
    undefined,
    new Uint8Array([0x66, 0x61, 0x6b, 0x65]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED7")]);
  assert.equal(bundle[17], 1);
  assert.equal(bundle.includes(0x66), true);
});

test("C12.4 ownership bundle carries platform and source track windows", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1]), new Uint8Array([2])],
    {
      target_duration_ms: 2_000,
      transitions: ["PASS"],
      bridge_durations_ms: [],
      audio_policy: "CONTINUOUS_NARRATION",
      audio_tracks: [
        { track_id: "platform-narration", ownership: "PLATFORM_NARRATION", start_ms: 0, end_ms: 2_000 },
        { track_id: "segment-1", ownership: "PROVIDER_DIALOGUE", start_ms: 0, end_ms: 1_000 },
        { track_id: "segment-2", ownership: "PROVIDER_AMBIENCE", start_ms: 1_000, end_ms: 2_000, duck_under_narration: true },
      ],
    },
    undefined,
    new Uint8Array([0x76, 0x6f, 0x69, 0x63, 0x65]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED7")]);
  assert.ok(Buffer.from(bundle).includes(Buffer.from("platform-narration")));
  assert.equal(Buffer.from(bundle).includes(Buffer.from("PROVIDER_AMBIENCE")), false, "ownership is encoded as bounded enum bytes, never text");
});

test("C12.4 ALCHMED8 carries the complete AudioPlan metadata block", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    {
      target_duration_ms: 2_000,
      transitions: [],
      bridge_durations_ms: [],
      audio_policy: "CONTINUOUS_NARRATION",
      audio_plan: {
        version: 1,
        target_duration_ms: 2_000,
        narration_asset_id: "ast-narration",
        narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 2_000, visual_role: "PRIMARY" }],
        stitch_policy: "CONTINUOUS_NARRATION",
        transcript_script: "第一句。第二句。",
        transcript_timing_asset_id: "ast-timing",
        tracks: [
          {
            track_id: "platform-narration",
            ownership: "PLATFORM_NARRATION",
            asset_id: "ast-narration",
            start_ms: 0,
            end_ms: 2_000,
            gain_db: "0",
            duck_under_narration: false,
            fade_in_ms: 100,
            fade_out_ms: 200,
          },
        ],
      },
    },
    undefined,
    new Uint8Array([0x76, 0x6f, 0x69, 0x63, 0x65]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED8")]);
  assert.ok(Buffer.from(bundle).includes(Buffer.from("ast-narration")));
  assert.ok(Buffer.from(bundle).includes(Buffer.from("第一句。第二句。")));
  assert.equal(bundle.at(-1), 1, "the encoded AudioPlan must leave room for the trailing video payload");
  assert.throws(() => encodeMediaCompositionBundle([new Uint8Array([1])], {
    target_duration_ms: 2_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION",
    audio_plan: {
      version: 1,
      target_duration_ms: 2_000,
      narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 2_000, visual_role: "PRIMARY" }],
      stitch_policy: "CONTINUOUS_NARRATION",
      tracks: [{
        track_id: "platform-narration",
        ownership: "PLATFORM_NARRATION",
        asset_id: "ast-narration",
        start_ms: 0,
        end_ms: 2_000,
        duck_under_narration: false,
      }],
    },
  }), MediaRuntimeClientError);

  const multiPlatformTrackPlan = {
    target_duration_ms: 2_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION" as const,
    audio_plan: {
      version: 1 as const,
      target_duration_ms: 2_000,
      narration_asset_id: "ast-narration",
      narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 2_000, visual_role: "PRIMARY" as const }],
      stitch_policy: "CONTINUOUS_NARRATION" as const,
      tracks: [
        { track_id: "platform-narration", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast-narration", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false },
        { track_id: "platform-narration-duplicate", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast-narration", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false },
      ],
    },
  };
  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    multiPlatformTrackPlan,
    undefined,
    new Uint8Array([2]),
  ), MediaRuntimeClientError);

  const sectionWindowPlan = {
    target_duration_ms: 2_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION" as const,
    audio_plan: {
      version: 1 as const,
      target_duration_ms: 2_000,
      narration_asset_id: "ast-narration",
      narration_sections: [
        { section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY" as const },
        { section_id: "sec_tail", start_ms: 1_000, end_ms: 2_000, visual_role: "HOLD" as const },
      ],
      stitch_policy: "CONTINUOUS_NARRATION" as const,
      tracks: [{ track_id: "platform-narration", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast-narration", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false }],
    },
  };
  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    sectionWindowPlan,
    undefined,
    new Uint8Array([2]),
  ), MediaRuntimeClientError);

  const musicBundle = encodeMediaCompositionBundle([new Uint8Array([1])], {
    target_duration_ms: 2_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION",
    audio_plan: {
      version: 1,
      target_duration_ms: 2_000,
      narration_asset_id: "ast-narration",
      narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 2_000, visual_role: "PRIMARY" }],
      stitch_policy: "CONTINUOUS_NARRATION",
      tracks: [
        { track_id: "platform-narration", ownership: "PLATFORM_NARRATION", asset_id: "ast-narration", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false },
        { track_id: "music", ownership: "MUSIC", asset_id: "ast-music", start_ms: 0, end_ms: 2_000, gain_db: "-6", duck_under_narration: true },
      ],
    },
    music_mix: { enabled: true },
    music_segments_ms: [{ start_ms: 0, end_ms: 2_000 }],
  }, new Uint8Array([0x6d, 0x75, 0x73, 0x69, 0x63]), new Uint8Array([0x76, 0x6f, 0x69, 0x63, 0x65]));
  assert.ok(Buffer.from(musicBundle).includes(Buffer.from("ast-music")));
  assert.equal(musicBundle.at(-1), 1, "the encoded AudioPlan must leave room for the trailing video payload");
});

test("C12.4 ALCHMED8 music-only plans retain the source full_mix path", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    {
      target_duration_ms: 2_000,
      transitions: [],
      bridge_durations_ms: [],
      audio_policy: "LEGACY_PRESERVE",
      audio_plan: {
        version: 1,
        target_duration_ms: 2_000,
        narration_sections: [{ section_id: "tail", start_ms: 0, end_ms: 2_000, visual_role: "HOLD" }],
        stitch_policy: "LEGACY_PRESERVE",
        tracks: [{
          track_id: "music",
          ownership: "MUSIC",
          asset_id: "ast-music",
          start_ms: 0,
          end_ms: 2_000,
          gain_db: "-6",
          duck_under_narration: true,
          fade_in_ms: 100,
          fade_out_ms: 200,
        }],
      },
      music_mix: { enabled: true },
      music_segments_ms: [{ start_ms: 0, end_ms: 2_000 }],
    },
    new Uint8Array([0x6d, 0x75, 0x73, 0x69, 0x63]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED8")]);
  assert.ok(Buffer.from(bundle).includes(Buffer.from("ast-music")));
  assert.ok(Buffer.from(bundle).includes(Buffer.from("music")));
});

test("C12.4 ALCHMED8 carries independently measured speech payloads by absolute track identity", () => {
  const plan = {
    target_duration_ms: 4_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION" as const,
    audio_plan: {
      version: 1 as const,
      target_duration_ms: 4_000,
      narration_sections: [
        { section_id: "sec_1", start_ms: 0, end_ms: 2_000, visual_role: "PRIMARY" as const, narration_asset_version_id: "nav_speech_one" },
        { section_id: "sec_2", start_ms: 2_000, end_ms: 4_000, visual_role: "PRIMARY" as const, narration_asset_version_id: "nav_speech_two" },
      ],
      stitch_policy: "CONTINUOUS_NARRATION" as const,
      tracks: [
        { track_id: "narration-ast_speech_one", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast_speech_one", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false, fade_in_ms: 100, fade_out_ms: 100 },
        { track_id: "segment-1", ownership: "LEGACY_PRESERVE" as const, asset_id: "ast_source_one", start_ms: 0, end_ms: 4_000, gain_db: "0", duck_under_narration: false },
        { track_id: "narration-ast_speech_two", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast_speech_two", start_ms: 2_000, end_ms: 4_000, gain_db: "0", duck_under_narration: false, fade_in_ms: 100, fade_out_ms: 100 },
      ],
    },
  };
  const first = new Uint8Array([1, 2, 3]);
  const second = new Uint8Array([4, 5, 6]);
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([9])],
    plan,
    undefined,
    undefined,
    [
      { track_id: "narration-ast_speech_one", bytes: first },
      { track_id: "narration-ast_speech_two", bytes: second },
    ],
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED8")]);
  assert.ok(Buffer.from(bundle).includes(Buffer.from("narration-ast_speech_one")));
  assert.ok(Buffer.from(bundle).includes(Buffer.from("narration-ast_speech_two")));
  assert.ok(Buffer.from(bundle).includes(Buffer.from(first)));
  assert.ok(Buffer.from(bundle).includes(Buffer.from(second)));

  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([9])],
    plan,
    undefined,
    undefined,
    [{ track_id: "narration-ast_speech_one", bytes: first }],
  ), MediaRuntimeClientError);
  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([9])],
    plan,
    undefined,
    new Uint8Array([7]),
    [
      { track_id: "narration-ast_speech_one", bytes: first },
      { track_id: "narration-ast_speech_two", bytes: second },
    ],
  ), MediaRuntimeClientError);
});

test("C12.4 ALCHMED8 rejects music bytes without ownership and unsupported music windows", () => {
  const basePlan = {
    target_duration_ms: 2_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION" as const,
    audio_plan: {
      version: 1 as const,
      target_duration_ms: 2_000,
      narration_asset_id: "ast-narration",
      narration_sections: [{ section_id: "sec_1", start_ms: 0, end_ms: 2_000, visual_role: "PRIMARY" as const }],
      stitch_policy: "CONTINUOUS_NARRATION" as const,
      tracks: [{ track_id: "platform-narration", ownership: "PLATFORM_NARRATION" as const, asset_id: "ast-narration", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: false }],
    },
    music_mix: { enabled: true },
    music_segments_ms: [{ start_ms: 0, end_ms: 2_000 }],
  };
  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    basePlan,
    new Uint8Array([2]),
    new Uint8Array([3]),
  ), MediaRuntimeClientError);

  const musicPlan = {
    ...basePlan,
    audio_plan: {
      ...basePlan.audio_plan,
      tracks: [
        ...basePlan.audio_plan.tracks,
        { track_id: "music", ownership: "MUSIC" as const, asset_id: "ast-music", start_ms: 0, end_ms: 2_000, gain_db: "0", duck_under_narration: true },
      ],
    },
    music_segments_ms: [{ start_ms: 0, end_ms: 1_000 }],
  } as const;
  assert.throws(() => encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    musicPlan,
    new Uint8Array([2]),
    new Uint8Array([3]),
  ), MediaRuntimeClientError);
});

test("C12.4 advanced audio plan carries bounded mix settings and absolute music windows", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1]), new Uint8Array([2])],
    {
      target_duration_ms: 30000,
      transitions: ["PASS"],
      bridge_durations_ms: [],
      audio_policy: "LEGACY_PRESERVE",
      music_mix: {
        enabled: true,
        volume: 0.08,
        ducking_reduction_db: 18,
        target_lufs: -14,
        true_peak_db: -1.5,
        voice_enhance: true,
        music_eq_cut_db: 3,
      },
      music_segments_ms: [{ start_ms: 0, end_ms: 12000 }, { start_ms: 18000, end_ms: 30000 }],
    },
    new Uint8Array([0x49, 0x44, 0x33]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED6")]);
  assert.equal(bundle.includes(0x5c), false);
  assert.ok(bundle.byteLength > 8 + 2 + 1 + 1 + 2 + 1 + 1 + 1 + 16);
});

test("C12.4 rejects music payload without an AudioPlan MUSIC ownership fact", () => {
  assert.throws(() => encodeMediaCompositionBundle([new Uint8Array([1])], {
    target_duration_ms: 1_000,
    transitions: [],
    bridge_durations_ms: [],
    audio_policy: "CONTINUOUS_NARRATION",
    music_mix: { enabled: true },
    music_segments_ms: [{ start_ms: 0, end_ms: 1_000 }],
  }, new Uint8Array([0x6d])), MediaRuntimeClientError);
});

test("C12.4 partial music_mix uses source defaults instead of zero/NaN bytes", () => {
  const bundle = encodeMediaCompositionBundle(
    [new Uint8Array([1])],
    {
      target_duration_ms: 2_000,
      transitions: [],
      bridge_durations_ms: [],
      audio_policy: "LEGACY_PRESERVE",
      music_mix: { enabled: true },
      music_segments_ms: [{ start_ms: 0, end_ms: 2_000 }],
    },
    new Uint8Array([0x49]),
  );
  assert.deepEqual([...bundle.slice(0, 8)], [...Buffer.from("ALCHMED6")]);
  // ALCHMED6: magic(8), count/transition(2), target(4), bridge/policy/flags(3).
  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  assert.equal(view.getUint16(17, false), 120); // volume=0.12
  assert.equal(bundle[19], 8); // ducking_reduction_db=8
  assert.equal(view.getInt16(21, false), -15); // true_peak_db=-1.5
});

test("C12 media runtime client sends only byte payload and validates handoff metadata", async () => {
  const image = new Uint8Array([137, 80, 78, 71]);
  const calls: Array<{ url: string; headers: Headers; body: Uint8Array }> = [];
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (url, init) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: new Uint8Array(init?.body as Buffer),
      });
      return new Response(image, {
        headers: {
          "Content-Type": "image/png",
          "X-Media-Sha256": sha256(image),
          "X-Media-Byte-Size": String(image.byteLength),
          "X-Media-Width": "2",
          "X-Media-Height": "2",
        },
      });
    },
  });
  const source = new Uint8Array([1, 2, 3]);
  const result = await client.extractHandoffFrame({
    operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    bytes: source,
    expectedSha256: sha256(source),
  });
  assert.equal(result.mime_type, "image/png");
  assert.equal(calls[0]?.url, "http://127.0.0.1:4033/internal/v1/media/handoff-frame");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer test-token");
  assert.equal(calls[0]?.headers.has("x-media-object-key"), false);
  assert.deepEqual([...calls[0]!.body], [...source]);
});

test("C12.1 media runtime client validates both bounded boundary frames", async () => {
  const image = new Uint8Array([137, 80, 78, 71]);
  const source = new Uint8Array([4, 5, 6]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async () => new Response(JSON.stringify({
      first: { mime_type: "image/png", sha256: sha256(image), byte_size: image.byteLength, width: 2, height: 2, bytes_base64: Buffer.from(image).toString("base64") },
      last: { mime_type: "image/png", sha256: sha256(image), byte_size: image.byteLength, width: 2, height: 2, bytes_base64: Buffer.from(image).toString("base64") },
    }), { headers: { "Content-Type": "application/json" } }),
  });
  const result = await client.extractBoundaryFrames({
    operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    bytes: source,
    expectedSha256: sha256(source),
  });
  assert.deepEqual([...result.first.bytes], [...image]);
  assert.deepEqual([...result.last.bytes], [...image]);
});

test("C12.3 media runtime client preserves source-aligned unavailable transcription", async () => {
  const source = new Uint8Array([7, 8, 9]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("content-type"), "video/mp4");
      return new Response(JSON.stringify({ status: "UNAVAILABLE", issues: ["faster-whisper is not installed."] }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const result = await client.transcribe({
    operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    bytes: source,
    expectedSha256: sha256(source),
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.issues[0] ?? "", /faster-whisper/);
});

test("C12.4 media runtime client verifies the authoritative narration WAV", async () => {
  const narration = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (url, init) => {
      assert.match(String(url), /\/internal\/v1\/media\/narration$/);
      const body = JSON.parse(String(init?.body)) as { text?: string };
      assert.equal(body.text, "你好。");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer test-token");
      return new Response(narration, {
        headers: {
          "Content-Type": "audio/wav",
          "X-Media-Sha256": sha256(narration),
          "X-Media-Byte-Size": String(narration.byteLength),
          "X-Media-Duration-Ms": "1000",
        },
      });
    },
  });
  const result = await client.synthesizeNarration({ operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX", scriptText: "你好。" });
  assert.deepEqual([...result.bytes], [...narration]);
  assert.equal(result.duration_ms, 1000);
});

test("C12.4 media runtime client forwards the explicit OpenMontage Doubao fields", async () => {
  const narration = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    narrationProvider: "doubao",
    fetcher: async (url, init) => {
      assert.match(String(url), /\/internal\/v1\/media\/narration$/);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.text, "保险AI介绍。");
      assert.equal(body.preferred_provider, "doubao");
      assert.equal(body.voice_id, "zh_female_vv_uranus_bigtts");
      assert.equal(body.resource_id, "seed-tts-2.0");
      assert.equal(body.format, "mp3");
      assert.equal(body.sample_rate, 24_000);
      assert.equal(body.speech_rate, 0);
      assert.equal(body.enable_timestamp, true);
      assert.equal(body.return_usage, true);
      assert.equal(body.poll_interval_seconds, 0.5);
      assert.equal(body.timeout_seconds, 30);
      return new Response(narration, {
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Media-Sha256": sha256(narration),
          "X-Media-Byte-Size": String(narration.byteLength),
          "X-Media-Duration-Ms": "1250",
        },
      });
    },
  });
  const result = await client.synthesizeNarration({
    operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    scriptText: "保险AI介绍。",
    voiceId: "zh_female_vv_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    format: "mp3",
    sampleRate: 24_000,
    speechRate: 0,
    enableTimestamp: true,
    returnUsage: true,
    pollIntervalSeconds: 0.5,
    timeoutSeconds: 30,
  });
  assert.equal(result.mime_type, "audio/mpeg");
  assert.equal(result.duration_ms, 1250);
});

test("C12.4 Doubao narration is not truncated by the generic 90-second client timeout", async () => {
  const narration = new Uint8Array([0x49, 0x44, 0x33, 0x05]);
  let observedTimeoutMs: number | undefined;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    observedTimeoutMs = timeout;
    return originalSetTimeout(handler, 0, ...args);
  }) as typeof globalThis.setTimeout;
  try {
    const client = new HttpMediaRuntimeClient({
      runtimeUrl: "http://127.0.0.1:4033/",
      token: "test-token",
      timeoutMs: 90_000,
      fetcher: async () => new Response(narration, {
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Media-Sha256": sha256(narration),
          "X-Media-Byte-Size": String(narration.byteLength),
          "X-Media-Duration-Ms": "1250",
        },
      }),
    });
    const result = await client.synthesizeNarration({ operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX", scriptText: "茅山温泉。", preferredProvider: "doubao" });
    assert.equal(result.mime_type, "audio/mpeg");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(observedTimeoutMs, 300_000);
});

test("C12.4 explicit Piper narration keeps the OpenMontage 300-second execution boundary", async () => {
  const narration = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x06]);
  let observedTimeoutMs: number | undefined;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    observedTimeoutMs = timeout;
    return originalSetTimeout(handler, 0, ...args);
  }) as typeof globalThis.setTimeout;
  try {
    const client = new HttpMediaRuntimeClient({
      runtimeUrl: "http://127.0.0.1:4033/",
      token: "test-token",
      timeoutMs: 90_000,
      fetcher: async () => new Response(narration, {
        headers: {
          "Content-Type": "audio/wav",
          "X-Media-Sha256": sha256(narration),
          "X-Media-Byte-Size": String(narration.byteLength),
          "X-Media-Duration-Ms": "1250",
        },
      }),
    });
    const result = await client.synthesizeNarration({ operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX", scriptText: "茅山温泉。", preferredProvider: "piper" });
    assert.equal(result.mime_type, "audio/wav");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(observedTimeoutMs, 300_000);
});

test("C12.7B media runtime client preserves delivery metadata in segment requests", async () => {
  const narration = new Uint8Array([82, 73, 70, 70, 9]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body.segments, [{
        text: "AI方案。",
        provider_text: "AI方案。",
        start_ms: 0,
        pronunciation_guides: [{ source: "AI", spoken: "人工智能", reason: "approved" }],
        pause_before_ms: 0,
        pause_after_ms: 600,
        pace: "NATURAL",
        energy: "NEUTRAL",
      }]);
      return new Response(narration, {
        headers: {
          "Content-Type": "audio/wav",
          "X-Media-Sha256": sha256(narration),
          "X-Media-Byte-Size": String(narration.byteLength),
          "X-Media-Duration-Ms": "1000",
        },
      });
    },
  });
  await client.synthesizeNarration({
    operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    segments: [{
      text: "AI方案。",
      start_ms: 0,
      pronunciation_guides: [{ source: "AI", spoken: "人工智能", reason: "approved" }],
      pause_before_ms: 0,
      pause_after_ms: 600,
      pace: "NATURAL",
      energy: "NEUTRAL",
    }],
  });
});

test("C12.2 media runtime client preserves OpenMontage final-review statuses", async () => {
  const source = new Uint8Array([4, 5, 6]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (url, init) => {
      assert.match(String(url), /\/internal\/v1\/media\/final-review$/);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Media-Script-Text-Base64"), null);
      assert.equal(headers.get("X-Media-Caption-Policy"), "REQUIRED");
      return new Response(JSON.stringify({
        status: "NEEDS_ATTENTION",
        technical_probe: { valid_container: true, duration_seconds: 15, resolution: "848x480", fps: 24, has_audio: true, codec: "h264", file_size_bytes: 3, issues: [] },
        visual_spotcheck: { frames_sampled: 4, black_frames_detected: false, broken_overlays: false, missing_assets: false, unreadable_text: false, issues: [] },
        audio_spotcheck: { has_audio: true, unexpected_silence: false, issues: [] },
        promise_preservation: { status: "UNAVAILABLE", renderer_family_used: "source-aligned video composition", render_runtime_used: "ffmpeg", runtime_swap_detected: false, silent_downgrade_detected: false, issues: [] },
        subtitle_check: { status: "NOT_EXPECTED", subtitles_expected: false, subtitles_present: false, issues: [] },
        transcript_comparison: { status: "UNAVAILABLE", transcript_matches_script: null, word_accuracy: null, issues: [] },
        semantic_evaluation: { status: "UNAVAILABLE", issues: [] },
        issues_found: ["语义评估器未配置"],
        recommended_action: "PRESENT_WITH_REVIEW",
      }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.finalReview({ operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX", bytes: source, expectedSha256: sha256(source), captionPolicy: "REQUIRED" });
  assert.equal(result.status, "NEEDS_ATTENTION");
  assert.equal(result.semantic_evaluation.status, "UNAVAILABLE");
});

test("C12.4 media runtime client sends approved transcript timing to the caption burner", async () => {
  const source = new Uint8Array([4, 5, 6]);
  const captioned = new Uint8Array([7, 8, 9]);
  const transcript = {
    status: "CHECKED",
    // Deliberately exceed ordinary 8–16 KiB header limits; this must remain
    // intact in the bounded JSON body transport.
    word_timestamps: Array.from({ length: 2_000 }, (_, index) => ({
      word: index === 0 ? "你好" : `词${index}`,
      start: index * 0.01,
      end: index * 0.01 + 0.005,
    })),
  };
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (url, init) => {
      assert.match(String(url), /\/internal\/v1\/media\/captions$/);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Media-Transcript-Base64"), null);
      assert.equal(headers.get("Content-Type"), "application/json");
      const payload = JSON.parse(String(init?.body));
      assert.equal(Buffer.from(payload.video_base64, "base64").toString("hex"), Buffer.from(source).toString("hex"));
      assert.equal(payload.transcript.word_timestamps[0].word, "你好");
      assert.equal(payload.transcript.word_timestamps.length, 2_000);
      return new Response(captioned, { headers: {
        "Content-Type": "video/mp4",
        "X-Media-Sha256": sha256(captioned),
        "X-Media-Byte-Size": String(captioned.byteLength),
        "X-Media-Width": "160",
        "X-Media-Height": "90",
        "X-Media-Duration-Ms": "1000",
        "X-Media-Has-Audio": "true",
        "X-Media-Captions-Present": "true",
      } });
    },
  });
  const result = await client.burnCaptions({ operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX", bytes: source, expectedSha256: sha256(source), transcript });
  assert.deepEqual([...result.bytes], [...captioned]);
  assert.equal(result.inspection.duration_ms, 1000);
});

test("C12.3 media runtime client sends bounded script context as UTF-8 base64", async () => {
  const source = new Uint8Array([4, 5, 6]);
  const client = new HttpMediaRuntimeClient({
    runtimeUrl: "http://127.0.0.1:4033/",
    token: "test-token",
    fetcher: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(Buffer.from(headers.get("X-Media-Script-Text-Base64") ?? "", "base64url").toString("utf8"), "你好");
      return new Response(JSON.stringify({
        status: "NEEDS_ATTENTION", technical_probe: { valid_container: true, duration_seconds: 15, resolution: "848x480", fps: 24, has_audio: true, codec: "h264", file_size_bytes: 3, issues: [] },
        visual_spotcheck: { frames_sampled: 4, black_frames_detected: false, broken_overlays: false, missing_assets: false, unreadable_text: false, issues: [] }, audio_spotcheck: { has_audio: true, unexpected_silence: false, issues: [] },
        promise_preservation: { status: "UNAVAILABLE", renderer_family_used: "source-aligned video composition", render_runtime_used: "ffmpeg", runtime_swap_detected: false, silent_downgrade_detected: false, issues: [] }, subtitle_check: { status: "NOT_EXPECTED", subtitles_expected: false, subtitles_present: false, issues: [] }, transcript_comparison: { status: "CHECKED", transcript_matches_script: true, word_accuracy: 1, issues: [] }, semantic_evaluation: { status: "CHECKED", issues: [] }, issues_found: [], recommended_action: "PRESENT_WITH_REVIEW",
      }), { headers: { "Content-Type": "application/json" } });
    },
  });
  await client.finalReview({ operationId: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX", bytes: source, expectedSha256: sha256(source), scriptText: "你好" });
});
