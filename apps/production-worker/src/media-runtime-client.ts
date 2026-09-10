import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  MediaRuntimeImageArtifactSchema,
  MediaRuntimeBoundaryFramesSchema,
  MediaRuntimeFinalReviewSchema,
  MediaRuntimeAudioInspectionSchema,
  MediaRuntimeNarrationRequestSchema,
  type MediaRuntimeNarrationRequest,
  MediaRuntimeAudioPlanSchema,
  MediaRuntimeCompositionPlanSchema,
  type MediaRuntimeAudioPlan,
  MediaRuntimeTranscriptSchema,
  type MediaRuntimeCompositionPlan,
  MediaRuntimeVideoInspectionSchema,
  type MediaRuntimeBoundaryFrames,
  type MediaRuntimeImageArtifact,
  type MediaRuntimeVideoInspection,
  type MediaRuntimeFinalReview,
  type MediaRuntimeAudioInspection,
  type MediaRuntimeTranscript,
} from "@alchemy-video/contracts";

const COMPOSITION_MAGIC = Buffer.from("ALCHMED1", "ascii");
const COMPOSITION_PLAN_MAGIC = Buffer.from("ALCHMED2", "ascii");
const COMPOSITION_AUDIO_PLAN_MAGIC = Buffer.from("ALCHMED3", "ascii");
const COMPOSITION_MUSIC_PLAN_MAGIC = Buffer.from("ALCHMED4", "ascii");
const COMPOSITION_NARRATION_PLAN_MAGIC = Buffer.from("ALCHMED5", "ascii");
const COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC = Buffer.from("ALCHMED6", "ascii");
// Private C12 extension: ALCHMED7 carries the AudioPlan ownership windows.
// Legacy ALCHMED1-6 remain byte-compatible and are never decoded as if they
// contained ownership facts.
const COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC = Buffer.from("ALCHMED7", "ascii");
// ALCHMED8 carries the source-faithful AudioPlan identity/mix metadata.  The
// ALCHMED7 ownership wire remains unchanged for historical snapshots.
const COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC = Buffer.from("ALCHMED8", "ascii");
const MAX_SINGLE_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_COMPOSITION_SEGMENTS = 12;
const MAX_COMPOSITION_INPUT_BYTES = 160 * 1024 * 1024;

const AUDIO_OWNERSHIP_CODES = {
  PLATFORM_NARRATION: 0,
  PROVIDER_DIALOGUE: 1,
  PROVIDER_AMBIENCE: 2,
  USER_SOURCE_AUDIO: 3,
  MUSIC: 4,
  SFX: 5,
  LEGACY_PRESERVE: 6,
} as const;

const MEDIA_RUNTIME_INTERNAL_HOSTS = new Set(["media-runtime", "control-media-runtime"]);
const isLoopbackRuntimeHost = (hostname: string) => hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
const isInternalRuntimeHost = (endpoint: URL) => MEDIA_RUNTIME_INTERNAL_HOSTS.has(endpoint.hostname) && endpoint.port === "3433";
const hasUnsafeRawRuntimeUrlSyntax = (runtimeUrl: string): boolean => {
  if (runtimeUrl.trim() !== runtimeUrl || !runtimeUrl.startsWith("http://")) return true;
  if (runtimeUrl.includes("?") || runtimeUrl.includes("#") || runtimeUrl.includes("@") || runtimeUrl.includes("\\")) return true;
  const authorityAndPath = runtimeUrl.slice("http://".length);
  const pathStart = authorityAndPath.indexOf("/");
  const rawPath = pathStart === -1 ? "" : authorityAndPath.slice(pathStart);
  return rawPath !== "" && rawPath !== "/";
};

export const validateMediaRuntimeUrl = (runtimeUrl: string): string => {
  if (hasUnsafeRawRuntimeUrlSyntax(runtimeUrl)) {
    throw new Error("MEDIA_RUNTIME_URL must use an allowlisted internal service or loopback http endpoint.");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(runtimeUrl);
  } catch {
    throw new Error("MEDIA_RUNTIME_URL must use an allowlisted internal service or loopback http endpoint.");
  }
  if (
    endpoint.protocol !== "http:"
    || (!isLoopbackRuntimeHost(endpoint.hostname) && !isInternalRuntimeHost(endpoint))
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || endpoint.pathname !== "/"
  ) {
    throw new Error("MEDIA_RUNTIME_URL must use an allowlisted internal service or loopback http endpoint.");
  }
  return endpoint.toString();
};

export class MediaRuntimeClientError extends Error {
  constructor(
    readonly code: "MEDIA_RUNTIME_UNAVAILABLE" | "MEDIA_RENDER_FAILED" | "QC_FAILED",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "MediaRuntimeClientError";
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const boundedHeaderNumber = (headers: Headers, name: string) => {
  const raw = headers.get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const responseError = async (response: Response): Promise<MediaRuntimeClientError> => {
  const payload = await response.json().catch(() => undefined) as { error?: { code?: unknown; retryable?: unknown } } | undefined;
  const code = payload?.error?.code;
  const retryable = payload?.error?.retryable === true || response.status >= 500;
  if (code === "QC_FAILED") return new MediaRuntimeClientError("QC_FAILED", retryable);
  if (code === "MEDIA_RENDER_FAILED") return new MediaRuntimeClientError("MEDIA_RENDER_FAILED", retryable);
  return new MediaRuntimeClientError("MEDIA_RUNTIME_UNAVAILABLE", retryable);
};

export type MediaRuntimeNarrationTrackBytes = {
  track_id: string;
  bytes: Uint8Array;
};

export const encodeMediaCompositionBundle = (
  segments: readonly Uint8Array[],
  plan?: MediaRuntimeCompositionPlan,
  musicBytes?: Uint8Array,
  narrationBytes?: Uint8Array,
  narrationTrackBytes?: readonly MediaRuntimeNarrationTrackBytes[],
) => {
  if (segments.length < 1 || segments.length > MAX_COMPOSITION_SEGMENTS || segments.some((segment) => segment.byteLength === 0 || segment.byteLength > MAX_SINGLE_VIDEO_BYTES)) {
    throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  }
  if (!plan) {
    const length = COMPOSITION_MAGIC.byteLength + 1 + segments.reduce((total, segment) => total + 4 + segment.byteLength, 0);
    if (length > MAX_COMPOSITION_INPUT_BYTES) throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    const bundle = new Uint8Array(length);
    bundle.set(COMPOSITION_MAGIC, 0);
    bundle[COMPOSITION_MAGIC.byteLength] = segments.length;
    let cursor = COMPOSITION_MAGIC.byteLength + 1;
    for (const segment of segments) {
      new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, segment.byteLength, false);
      cursor += 4;
      bundle.set(segment, cursor);
      cursor += segment.byteLength;
    }
    return bundle;
  }
  const parsedPlan = MediaRuntimeCompositionPlanSchema.safeParse(plan);
  if (!parsedPlan.success) throw new MediaRuntimeClientError("QC_FAILED", false);
  plan = parsedPlan.data;
  if (
    plan.transitions.length !== segments.length - 1
    || plan.bridge_durations_ms.length !== plan.transitions.filter((transition) => transition === "BRIDGE").length
  ) {
    throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  }
  const advancedPlan = plan as MediaRuntimeCompositionPlan & {
    music_segments_ms?: Array<{ start_ms: number; end_ms: number }>;
    music_mix: MediaRuntimeCompositionPlan["music_mix"] & {
      target_lufs?: number;
      true_peak_db?: number;
      voice_enhance?: boolean;
      music_eq_cut_db?: number;
      ducking_enabled?: boolean;
    };
  };
  const audioPlan = advancedPlan.audio_plan as MediaRuntimeAudioPlan | undefined;
  if (audioPlan) {
    if (advancedPlan.audio_tracks) throw new MediaRuntimeClientError("QC_FAILED", false);
    const parsedAudioPlan = MediaRuntimeAudioPlanSchema.safeParse(audioPlan);
    if (!parsedAudioPlan.success
      || parsedAudioPlan.data.target_duration_ms !== plan.target_duration_ms
      || parsedAudioPlan.data.stitch_policy !== (plan.audio_policy === "CONTINUOUS_NARRATION" ? "CONTINUOUS_NARRATION" : "LEGACY_PRESERVE")) {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }
  const rawMix = advancedPlan.music_mix;
  // Callers may provide the contract's partial/defaulted input (for example
  // `{ enabled: true }`) before it has passed through Zod output parsing.  Do
  // not let undefined numeric fields become NaN/zero bytes in the private
  // binary mapper; apply the same source defaults field by field.
  const mix = {
    enabled: rawMix?.enabled ?? false,
    volume: rawMix?.volume ?? 0.12,
    fade_in_ms: rawMix?.fade_in_ms ?? 1_500,
    fade_out_ms: rawMix?.fade_out_ms ?? 2_500,
    ducking_enabled: rawMix?.ducking_enabled ?? true,
    ducking_reduction_db: rawMix?.ducking_reduction_db ?? 8,
    target_lufs: rawMix?.target_lufs ?? -14,
    true_peak_db: rawMix?.true_peak_db ?? -1.5,
    voice_enhance: rawMix?.voice_enhance ?? true,
    music_eq_cut_db: rawMix?.music_eq_cut_db ?? 3,
  };
  if (!Number.isFinite(mix.volume) || mix.volume < 0 || mix.volume > 1
    || !Number.isFinite(mix.fade_in_ms) || mix.fade_in_ms < 0 || mix.fade_in_ms > 10_000
    || !Number.isFinite(mix.fade_out_ms) || mix.fade_out_ms < 0 || mix.fade_out_ms > 10_000
    || !Number.isFinite(mix.ducking_reduction_db) || mix.ducking_reduction_db < 0 || mix.ducking_reduction_db > 30
    || !Number.isFinite(mix.target_lufs) || mix.target_lufs < -24 || mix.target_lufs > -10
    || !Number.isFinite(mix.true_peak_db) || mix.true_peak_db < -6 || mix.true_peak_db > -0.1
    || !Number.isFinite(mix.music_eq_cut_db) || mix.music_eq_cut_db < 0 || mix.music_eq_cut_db > 12) {
    throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  }
  const musicSegments = advancedPlan.music_segments_ms ?? [];
  const audioTracks = audioPlan?.tracks ?? advancedPlan.audio_tracks ?? [];
  const platformNarrationTracks = audioTracks.filter((track) => track.ownership === "PLATFORM_NARRATION");
  const hasFullNarrationTrack = platformNarrationTracks.some((track) => track.start_ms === 0 && track.end_ms === plan.target_duration_ms);
  const hasSectionNarrationTracks = Boolean(audioPlan
    && !hasFullNarrationTrack
    && platformNarrationTracks.length > 0
    && audioPlan.narration_sections.filter((section) => section.visual_role === "PRIMARY").every((section) =>
      typeof section.narration_asset_version_id === "string"
      && platformNarrationTracks.some((track) => track.start_ms === section.start_ms && track.end_ms === section.end_ms)));
  if (audioTracks.length > 64 || (plan.audio_policy === "CONTINUOUS_NARRATION" && !hasFullNarrationTrack && !hasSectionNarrationTracks)) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  const providedNarrationTracks = narrationTrackBytes ?? [];
  const includeNarrationTracks = providedNarrationTracks.length > 0;
  if (includeNarrationTracks) {
    if (!audioPlan || plan.audio_policy !== "CONTINUOUS_NARRATION" || narrationBytes?.byteLength
      || providedNarrationTracks.length !== platformNarrationTracks.length
      || new Set(providedNarrationTracks.map((track) => track.track_id)).size !== providedNarrationTracks.length) {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
    const platformTrackIds = new Set(platformNarrationTracks.map((track) => track.track_id));
    for (const payload of providedNarrationTracks) {
      const idBytes = Buffer.from(payload.track_id, "utf8");
      if (!platformTrackIds.has(payload.track_id) || idBytes.byteLength === 0 || idBytes.byteLength > 160
        || payload.bytes.byteLength === 0 || payload.bytes.byteLength > MAX_SINGLE_VIDEO_BYTES) {
        throw new MediaRuntimeClientError("QC_FAILED", false);
      }
    }
  }
  const ownershipTrackBytes = audioTracks.reduce((total, track) => {
    const idBytes = Buffer.from(track.track_id, "utf8");
    if (idBytes.byteLength === 0 || idBytes.byteLength > 64) throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    return total + 1 + idBytes.byteLength + 1 + 4 + 4 + 1;
  }, 1);
  const utf8FieldBytes = (value: string | undefined, maxBytes: number, lengthBytes: 1 | 2): number => {
    if (value === undefined) return lengthBytes;
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes || (lengthBytes === 1 && bytes.byteLength > 255) || (lengthBytes === 2 && bytes.byteLength > 65_535)) {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
    return lengthBytes + bytes.byteLength;
  };
  const completeAudioPlanBytes = audioPlan
    ? 1 + 1
      + utf8FieldBytes(audioPlan.narration_asset_id, 160, 1)
      + utf8FieldBytes(audioPlan.transcript_timing_asset_id, 160, 1)
      + utf8FieldBytes(audioPlan.transcript_script, 8_000, 2)
      + 1
      + audioPlan.narration_sections.reduce((total, section) => total + utf8FieldBytes(section.section_id, 160, 1) + 1 + 4 + 4, 0)
      + 1
      + audioPlan.tracks.reduce((total, track) => {
        return total
          + utf8FieldBytes(track.track_id, 160, 1)
          + 1 + 4 + 4 + 1
          + utf8FieldBytes(track.asset_id, 160, 1)
          + utf8FieldBytes(track.gain_db, 32, 1)
          + 2 + 2;
      }, 0)
    : 0;
  const transitionBytes = Buffer.from(plan.transitions.map((value) => value === "PASS" ? 0 : value === "BLEND" ? 1 : 2));
  const includeMusic = Boolean(musicBytes?.byteLength && mix.enabled);
  if (includeMusic && plan.audio_policy === "CONTINUOUS_NARRATION" && !audioPlan) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  const includeNarration = Boolean(narrationBytes?.byteLength && plan.audio_policy === "CONTINUOUS_NARRATION");
  if (includeNarration && includeNarrationTracks) throw new MediaRuntimeClientError("QC_FAILED", false);
  if (includeNarration && audioPlan) {
    // ALCHMED8 carries one opaque narration byte payload.  OpenMontage's
    // source full_mix can consume that payload only as one complete speech
    // track; choosing one track from a multi-track plan would silently drop
    // an authored section.
    const sections = audioPlan.narration_sections;
    if (platformNarrationTracks.length !== 1
      || !hasFullNarrationTrack
      || sections.length !== 1
      || sections[0]!.start_ms !== 0
      || sections[0]!.end_ms !== plan.target_duration_ms
      || sections[0]!.visual_role !== "PRIMARY") {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }
  if (audioPlan?.tracks.some((track) => track.ownership === "SFX")) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  const completeMusicTracks = audioPlan?.tracks.filter((track) => track.ownership === "MUSIC") ?? [];
  if (audioPlan && musicBytes?.byteLength && completeMusicTracks.length === 0) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  if (completeMusicTracks.length > 1 || completeMusicTracks.length > 0 && (!includeMusic || musicSegments.length === 0
    || completeMusicTracks.some((track) => !musicSegments.some((window) => window.start_ms <= track.start_ms && window.end_ms >= track.end_ms)))) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  if (audioPlan && completeMusicTracks.length > 0) {
    const targetMs = plan.target_duration_ms;
    if (musicSegments.length !== 1
      || musicSegments[0]!.start_ms !== completeMusicTracks[0]!.start_ms
      || musicSegments[0]!.end_ms !== targetMs
      || completeMusicTracks[0]!.end_ms !== targetMs) {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }
  if (audioPlan?.tracks.some((track) => (track.ownership === "SFX"
    || ["PROVIDER_DIALOGUE", "PROVIDER_AMBIENCE", "USER_SOURCE_AUDIO", "LEGACY_PRESERVE"].includes(track.ownership)
      && !track.track_id.startsWith("segment-")))) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  if (audioPlan?.narration_asset_id && audioPlan.tracks.some((track) =>
    track.ownership === "PLATFORM_NARRATION" && track.asset_id !== audioPlan.narration_asset_id)) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  if (plan.audio_policy === "CONTINUOUS_NARRATION" && !includeNarration && !includeNarrationTracks) {
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  if (plan.audio_policy === "CONTINUOUS_NARRATION" && audioTracks.length === 0) {
    // A continuous plan must carry a private AudioPlan so Runtime can mute
    // only declared provider dialogue and retain ambience/user source audio.
    throw new MediaRuntimeClientError("QC_FAILED", false);
  }
  for (const track of audioTracks) {
    if (!(track.ownership in AUDIO_OWNERSHIP_CODES)) throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  }
  const narrationTrackPayloadBytes = includeNarrationTracks
    ? 1 + providedNarrationTracks.reduce((total, payload) => total + 1 + Buffer.byteLength(payload.track_id, "utf8") + 4 + payload.bytes.byteLength, 0)
    : 0;
  const advancedAudio = Boolean(musicSegments.length || audioTracks.length > 0 || rawMix && (
    (rawMix.volume !== undefined && rawMix.volume !== 0.12)
    || (rawMix.ducking_reduction_db !== undefined && rawMix.ducking_reduction_db !== 8)
    || rawMix.target_lufs !== undefined
    || rawMix.true_peak_db !== undefined
    || rawMix.voice_enhance !== undefined
    || rawMix.music_eq_cut_db !== undefined
    || rawMix.fade_in_ms !== undefined
    || rawMix.fade_out_ms !== undefined
    || rawMix.ducking_enabled !== undefined
  ));
  const magic = audioPlan
    ? COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC
    : audioTracks.length > 0
    ? COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC
    : advancedAudio
    ? COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC
    : includeMusic
    ? (includeNarration ? COMPOSITION_NARRATION_PLAN_MAGIC : COMPOSITION_MUSIC_PLAN_MAGIC)
    : includeNarration ? COMPOSITION_NARRATION_PLAN_MAGIC
    : plan.audio_policy === "CONTINUOUS_NARRATION" ? COMPOSITION_AUDIO_PLAN_MAGIC : COMPOSITION_PLAN_MAGIC;
  const advancedBytes = (advancedAudio || audioTracks.length > 0 || audioPlan) ? 2 + 1 + 1 + 2 + 1 + 1 + 2 + 2 + 1 + 1 + musicSegments.length * 8 : 0;
  const ownershipBytes = audioTracks.length > 0 && !audioPlan ? ownershipTrackBytes : 0;
  const length = magic.byteLength + 1 + 1 + transitionBytes.byteLength + 4 + 1 + ((plan.audio_policy === "CONTINUOUS_NARRATION" || advancedAudio || audioTracks.length > 0 || audioPlan) ? 1 : 0) + ((magic === COMPOSITION_NARRATION_PLAN_MAGIC || advancedAudio || audioTracks.length > 0 || audioPlan) ? 1 : 0) + advancedBytes + ownershipBytes + completeAudioPlanBytes + narrationTrackPayloadBytes + (includeNarration ? 4 + narrationBytes!.byteLength : 0) + (includeMusic ? 4 + musicBytes!.byteLength : 0) + plan.bridge_durations_ms.length * 4
    + segments.reduce((total, segment) => total + 4 + segment.byteLength, 0);
  if (length > MAX_COMPOSITION_INPUT_BYTES) throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
  const bundle = new Uint8Array(length);
  bundle.set(magic, 0);
  bundle[magic.byteLength] = segments.length;
  bundle[magic.byteLength + 1] = transitionBytes.byteLength;
  let cursor = magic.byteLength + 2;
  bundle.set(transitionBytes, cursor);
  cursor += transitionBytes.byteLength;
  new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, plan.target_duration_ms, false);
  cursor += 4;
  bundle[cursor] = plan.bridge_durations_ms.length;
  cursor += 1;
  if (plan.audio_policy === "CONTINUOUS_NARRATION" || advancedAudio || audioTracks.length > 0 || audioPlan) {
    bundle[cursor] = plan.audio_policy === "CONTINUOUS_NARRATION" ? 1 : 0;
    cursor += 1;
  }
  if (magic === COMPOSITION_NARRATION_PLAN_MAGIC || advancedAudio || audioTracks.length > 0 || audioPlan) {
    bundle[cursor] = (includeNarration ? 1 : 0) | (includeMusic ? 2 : 0) | (includeNarrationTracks ? 4 : 0);
    cursor += 1;
  }
  if (advancedAudio || audioTracks.length > 0 || audioPlan) {
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 2).setUint16(0, Math.round(mix.volume * 1000), false);
    cursor += 2;
    bundle[cursor] = Math.round(mix.ducking_reduction_db);
    cursor += 1;
    bundle[cursor] = Math.max(0, Math.min(255, Math.round((mix.target_lufs ?? -14) + 100)));
    cursor += 1;
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 2).setInt16(0, Math.round((mix.true_peak_db ?? -1.5) * 10), false);
    cursor += 2;
    bundle[cursor] = Math.round(mix.music_eq_cut_db ?? 3);
    cursor += 1;
    bundle[cursor] = (mix.voice_enhance ?? true) ? 1 : 0;
    cursor += 1;
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 2).setUint16(0, Math.min(10_000, Math.round(mix.fade_in_ms ?? 1_500)), false);
    cursor += 2;
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 2).setUint16(0, Math.min(10_000, Math.round(mix.fade_out_ms ?? 2_500)), false);
    cursor += 2;
    bundle[cursor] = mix.ducking_enabled === false ? 0 : 1;
    cursor += 1;
    bundle[cursor] = musicSegments.length;
    cursor += 1;
    for (const segment of musicSegments) {
      new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, segment.start_ms, false);
      cursor += 4;
      new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, segment.end_ms, false);
      cursor += 4;
    }
  }
  if (audioPlan) {
    const stitchCodes = { CONTINUOUS_NARRATION: 0, LEGACY_PRESERVE: 2 } as const;
    const narrationRoleCodes = { PRIMARY: 0, BROLL: 1, HOLD: 2 } as const;
    const writeU8 = (value: number) => { bundle[cursor] = value; cursor += 1; };
    const writeU16 = (value: number) => { new DataView(bundle.buffer, bundle.byteOffset + cursor, 2).setUint16(0, value, false); cursor += 2; };
    const writeU32 = (value: number) => { new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, value, false); cursor += 4; };
    const writeUtf8 = (value: string | undefined, lengthBytes: 1 | 2) => {
      const bytes = value === undefined ? Buffer.alloc(0) : Buffer.from(value, "utf8");
      if (lengthBytes === 1) writeU8(bytes.byteLength); else writeU16(bytes.byteLength);
      bundle.set(bytes, cursor); cursor += bytes.byteLength;
    };
    writeU8(audioPlan.version);
    writeU8(stitchCodes[audioPlan.stitch_policy]);
    writeUtf8(audioPlan.narration_asset_id, 1);
    writeUtf8(audioPlan.transcript_timing_asset_id, 1);
    writeUtf8(audioPlan.transcript_script, 2);
    writeU8(audioPlan.narration_sections.length);
    for (const section of audioPlan.narration_sections) {
      writeUtf8(section.section_id, 1);
      writeU8(narrationRoleCodes[section.visual_role]);
      writeU32(section.start_ms);
      writeU32(section.end_ms);
    }
    writeU8(audioPlan.tracks.length);
    for (const track of audioPlan.tracks) {
      writeUtf8(track.track_id, 1);
      writeU8(AUDIO_OWNERSHIP_CODES[track.ownership]);
      writeU32(track.start_ms);
      writeU32(track.end_ms);
      writeU8(track.duck_under_narration ? 1 : 0);
      writeUtf8(track.asset_id, 1);
      writeUtf8(track.gain_db, 1);
      writeU16(track.fade_in_ms ?? 0xffff);
      writeU16(track.fade_out_ms ?? 0xffff);
    }
  } else if (audioTracks.length > 0) {
    bundle[cursor] = audioTracks.length;
    cursor += 1;
    for (const track of audioTracks) {
      const idBytes = Buffer.from(track.track_id, "utf8");
      bundle[cursor] = idBytes.byteLength;
      cursor += 1;
      bundle.set(idBytes, cursor);
      cursor += idBytes.byteLength;
      bundle[cursor] = AUDIO_OWNERSHIP_CODES[track.ownership];
      cursor += 1;
      new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, track.start_ms, false);
      cursor += 4;
      new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, track.end_ms, false);
      cursor += 4;
      bundle[cursor] = track.duck_under_narration ? 1 : 0;
      cursor += 1;
    }
  }
  if (includeNarrationTracks) {
    bundle[cursor] = providedNarrationTracks.length;
    cursor += 1;
    for (const payload of providedNarrationTracks) {
      const idBytes = Buffer.from(payload.track_id, "utf8");
      bundle[cursor] = idBytes.byteLength;
      cursor += 1;
      bundle.set(idBytes, cursor);
      cursor += idBytes.byteLength;
      new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, payload.bytes.byteLength, false);
      cursor += 4;
      bundle.set(payload.bytes, cursor);
      cursor += payload.bytes.byteLength;
    }
  }
  if (includeNarration) {
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, narrationBytes!.byteLength, false);
    cursor += 4;
    bundle.set(narrationBytes!, cursor);
    cursor += narrationBytes!.byteLength;
  }
  if (includeMusic) {
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, musicBytes!.byteLength, false);
    cursor += 4;
    bundle.set(musicBytes!, cursor);
    cursor += musicBytes!.byteLength;
  }
  for (const duration of plan.bridge_durations_ms) {
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, duration, false);
    cursor += 4;
  }
  for (const segment of segments) {
    new DataView(bundle.buffer, bundle.byteOffset + cursor, 4).setUint32(0, segment.byteLength, false);
    cursor += 4;
    bundle.set(segment, cursor);
    cursor += segment.byteLength;
  }
  return bundle;
};

export class HttpMediaRuntimeClient {
  private readonly runtimeUrl: string;
  readonly narrationProvider?: string;

  constructor(private readonly input: { runtimeUrl: string; token: string; timeoutMs?: number; fetcher?: typeof fetch; narrationProvider?: string }) {
    this.runtimeUrl = validateMediaRuntimeUrl(input.runtimeUrl);
    this.narrationProvider = input.narrationProvider;
  }

  async inspect(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeVideoInspection> {
    const response = await this.request({
      path: "/internal/v1/media/inspect",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json().catch(() => undefined);
    try {
      return MediaRuntimeVideoInspectionSchema.parse(payload);
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async extractHandoffFrame(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeImageArtifact & { bytes: Uint8Array }> {
    const response = await this.request({
      path: "/internal/v1/media/handoff-frame",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      const artifact = MediaRuntimeImageArtifactSchema.parse({
        mime_type: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase(),
        sha256: response.headers.get("x-media-sha256"),
        byte_size: boundedHeaderNumber(response.headers, "x-media-byte-size"),
        width: boundedHeaderNumber(response.headers, "x-media-width"),
        height: boundedHeaderNumber(response.headers, "x-media-height"),
      });
      if (artifact.byte_size !== bytes.byteLength || artifact.sha256 !== sha256(bytes)) throw new Error("invalid handoff bytes");
      return { ...artifact, bytes };
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async inspectAudio(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeAudioInspection> {
    const response = await this.request({
      path: "/internal/v1/media/audio-inspect",
      operationId: input.operationId,
      contentType: "audio/wav",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    try {
      return MediaRuntimeAudioInspectionSchema.parse(await response.json());
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async finalReview(input: { operationId: string; bytes: Uint8Array; expectedSha256: string; scriptText?: string; captionPolicy?: "REQUIRED" | "OPTIONAL" | "OFF" }): Promise<MediaRuntimeFinalReview> {
    const response = await this.request({
      path: "/internal/v1/media/final-review",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
      extraHeaders: input.scriptText || input.captionPolicy ? {
        ...(input.scriptText ? { "X-Media-Script-Text-Base64": Buffer.from(input.scriptText, "utf8").toString("base64url") } : {}),
        ...(input.captionPolicy ? { "X-Media-Caption-Policy": input.captionPolicy } : {}),
      } : undefined,
    });
    if (!response.ok) throw await responseError(response);
    try {
      return MediaRuntimeFinalReviewSchema.parse(await response.json());
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async burnCaptions(input: { operationId: string; bytes: Uint8Array; expectedSha256: string; transcript?: Record<string, unknown> }): Promise<{ inspection: MediaRuntimeVideoInspection; bytes: Uint8Array }> {
    // Word timestamps can exceed normal 8–16 KiB HTTP header limits.  Keep
    // the approved snapshot in the bounded JSON body alongside the video,
    // never in a large custom header.
    const requestBody = JSON.stringify({
      video_base64: Buffer.from(input.bytes).toString("base64"),
      ...(input.transcript ? { transcript: input.transcript } : {}),
    });
    const response = await this.request({
      path: "/internal/v1/media/captions",
      operationId: input.operationId,
      contentType: "application/json",
      body: requestBody,
      bytes: new Uint8Array(),
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      if (response.headers.get("x-media-captions-present") !== "true") throw new Error("captions marker missing");
      const inspection = MediaRuntimeVideoInspectionSchema.parse({
        mime_type: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase(),
        sha256: response.headers.get("x-media-sha256"),
        byte_size: boundedHeaderNumber(response.headers, "x-media-byte-size"),
        width: boundedHeaderNumber(response.headers, "x-media-width"),
        height: boundedHeaderNumber(response.headers, "x-media-height"),
        duration_ms: boundedHeaderNumber(response.headers, "x-media-duration-ms"),
        has_audio: response.headers.get("x-media-has-audio") === "true",
      });
      if (inspection.byte_size !== bytes.byteLength || inspection.sha256 !== sha256(bytes)) throw new Error("invalid captioned bytes");
      return { inspection, bytes };
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    }
  }

  async synthesizeNarration(input: { operationId: string; scriptText?: string; segments?: Array<{
    text: string;
    provider_text?: string;
    start_ms: number;
    pronunciation_guides?: Array<{ source: string; spoken: string; reason: string }>;
    pause_before_ms?: number;
    pause_after_ms?: number;
    pace?: "SLOW" | "NATURAL" | "FAST";
    energy?: "CALM" | "NEUTRAL" | "EMPHATIC";
  }>; targetDurationMs?: number; preferredProvider?: string; voiceId?: string; resourceId?: string; format?: "mp3" | "ogg_opus" | "pcm"; sampleRate?: number; speechRate?: number; enableTimestamp?: boolean; disableMarkdownFilter?: boolean; returnUsage?: boolean; pollIntervalSeconds?: number; timeoutSeconds?: number }): Promise<{ bytes: Uint8Array; mime_type: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm"; sha256: string; byte_size: number; duration_ms: number }> {
    const selectedProvider = input.preferredProvider ?? this.narrationProvider;
    let parsed: MediaRuntimeNarrationRequest;
    let requestBody: {
      text?: string;
      segments?: Array<{
        text: string;
        provider_text?: string;
        start_ms: number;
        pronunciation_guides?: Array<{ source: string; spoken: string; reason: string }>;
        pause_before_ms?: number;
        pause_after_ms?: number;
        pace?: "SLOW" | "NATURAL" | "FAST";
        energy?: "CALM" | "NEUTRAL" | "EMPHATIC";
      }>;
      target_duration_ms?: number;
      preferred_provider?: string;
      voice_id?: string;
      resource_id?: string;
      format?: "mp3" | "ogg_opus" | "pcm";
      sample_rate?: number;
      speech_rate?: number;
      enable_timestamp?: boolean;
      disable_markdown_filter?: boolean;
      return_usage?: boolean;
      poll_interval_seconds?: number;
      timeout_seconds?: number;
    };
    try {
      parsed = MediaRuntimeNarrationRequestSchema.parse({
        ...(input.scriptText ? { text: input.scriptText } : {}),
        ...(!input.scriptText && input.segments ? { segments: input.segments } : {}),
        ...(!input.scriptText && input.targetDurationMs !== undefined ? { target_duration_ms: input.targetDurationMs } : {}),
        ...(selectedProvider ? { preferred_provider: selectedProvider } : {}),
        ...(input.voiceId ? { voice_id: input.voiceId } : {}),
        ...(input.resourceId ? { resource_id: input.resourceId } : {}),
        ...(input.format ? { format: input.format } : {}),
        ...(input.sampleRate !== undefined ? { sample_rate: input.sampleRate } : {}),
        ...(input.speechRate !== undefined ? { speech_rate: input.speechRate } : {}),
        ...(input.enableTimestamp !== undefined ? { enable_timestamp: input.enableTimestamp } : {}),
        ...(input.disableMarkdownFilter !== undefined ? { disable_markdown_filter: input.disableMarkdownFilter } : {}),
        ...(input.returnUsage !== undefined ? { return_usage: input.returnUsage } : {}),
        ...(input.pollIntervalSeconds !== undefined ? { poll_interval_seconds: input.pollIntervalSeconds } : {}),
        ...(input.timeoutSeconds !== undefined ? { timeout_seconds: input.timeoutSeconds } : {}),
      });
      requestBody = {
        ...(parsed.text ? { text: parsed.text } : {}),
        ...(!parsed.text && parsed.segments ? {
          segments: parsed.segments.map((segment) => ({
            text: segment.text,
            provider_text: segment.provider_text ?? segment.text,
            start_ms: segment.start_ms,
            ...(segment.pronunciation_guides ? { pronunciation_guides: segment.pronunciation_guides } : {}),
            ...(segment.pause_before_ms !== undefined ? { pause_before_ms: segment.pause_before_ms } : {}),
            ...(segment.pause_after_ms !== undefined ? { pause_after_ms: segment.pause_after_ms } : {}),
            ...(segment.pace ? { pace: segment.pace } : {}),
            ...(segment.energy ? { energy: segment.energy } : {}),
          })),
        } : {}),
        ...(!parsed.text && parsed.target_duration_ms !== undefined ? { target_duration_ms: parsed.target_duration_ms } : {}),
        ...(parsed.preferred_provider ? { preferred_provider: parsed.preferred_provider } : {}),
        ...(parsed.voice_id ? { voice_id: parsed.voice_id } : {}),
        ...(parsed.resource_id ? { resource_id: parsed.resource_id } : {}),
        ...(parsed.format ? { format: parsed.format } : {}),
        ...(parsed.sample_rate !== undefined ? { sample_rate: parsed.sample_rate } : {}),
        ...(parsed.speech_rate !== undefined ? { speech_rate: parsed.speech_rate } : {}),
        ...(parsed.enable_timestamp !== undefined ? { enable_timestamp: parsed.enable_timestamp } : {}),
        ...(parsed.disable_markdown_filter !== undefined ? { disable_markdown_filter: parsed.disable_markdown_filter } : {}),
        ...(parsed.return_usage !== undefined ? { return_usage: parsed.return_usage } : {}),
        ...(parsed.poll_interval_seconds !== undefined ? { poll_interval_seconds: parsed.poll_interval_seconds } : {}),
        ...(parsed.timeout_seconds !== undefined ? { timeout_seconds: parsed.timeout_seconds } : {}),
      };
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    }
    const fetcher = this.input.fetcher ?? fetch;
    const controller = new AbortController();
    // OpenMontage's source TTS tools use a 300-second execution boundary
    // (Doubao polling and Piper subprocess). Respect an explicit
    // timeout_seconds override while keeping unknown/unselected providers on
    // the generic client deadline.
    const isDoubao = parsed.preferred_provider === "doubao" || parsed.preferred_provider === "doubao_tts";
    const isPiper = parsed.preferred_provider === "piper" || parsed.preferred_provider === "piper_tts";
    const sourceTimeoutMs = isDoubao || isPiper ? (parsed.timeout_seconds ?? 300) * 1_000 : 90_000;
    // A generic client timeout may remain a lower bound for other operations,
    // but must not truncate an explicitly selected source provider.
    const timeoutMs = isDoubao || isPiper
      ? Math.max(this.input.timeoutMs ?? 0, sourceTimeoutMs)
      : this.input.timeoutMs ?? sourceTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(new URL("/internal/v1/media/narration", this.runtimeUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.input.token}`,
          "Content-Type": "application/json",
          "X-Media-Operation-Id": input.operationId,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RUNTIME_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw await responseError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const byteSize = boundedHeaderNumber(response.headers, "x-media-byte-size");
    const durationMs = boundedHeaderNumber(response.headers, "x-media-duration-ms");
    const digest = response.headers.get("x-media-sha256");
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
    if (!(["audio/wav", "audio/mpeg", "audio/ogg", "audio/pcm"] as const).includes(mimeType as "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm") || !byteSize || !durationMs || !digest || byteSize !== bytes.byteLength || digest !== sha256(bytes)) {
      throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    }
    return { bytes, mime_type: mimeType as "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm", sha256: digest, byte_size: byteSize, duration_ms: durationMs };
  }

  async transcribe(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeTranscript> {
    const response = await this.request({
      path: "/internal/v1/media/transcribe",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    try {
      return MediaRuntimeTranscriptSchema.parse(await response.json());
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async extractBoundaryFrames(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<MediaRuntimeBoundaryFrames & { first: MediaRuntimeBoundaryFrames["first"] & { bytes: Uint8Array }; last: MediaRuntimeBoundaryFrames["last"] & { bytes: Uint8Array } }> {
    const response = await this.request({
      path: "/internal/v1/media/boundary-frames",
      operationId: input.operationId,
      contentType: "video/mp4",
      bytes: input.bytes,
      expectedSha256: input.expectedSha256,
    });
    if (!response.ok) throw await responseError(response);
    try {
      const payload = MediaRuntimeBoundaryFramesSchema.parse(await response.json());
      const decode = (artifact: typeof payload.first) => {
        const bytes = new Uint8Array(Buffer.from(artifact.bytes_base64, "base64"));
        if (bytes.byteLength !== artifact.byte_size || sha256(bytes) !== artifact.sha256) throw new Error("invalid boundary bytes");
        return { ...artifact, bytes };
      };
      return { first: decode(payload.first), last: decode(payload.last) };
    } catch {
      throw new MediaRuntimeClientError("QC_FAILED", false);
    }
  }

  async compose(input: { operationId: string; segments: readonly Uint8Array[]; compositionPlan?: MediaRuntimeCompositionPlan; musicBytes?: Uint8Array; narrationBytes?: Uint8Array; narrationTrackBytes?: readonly MediaRuntimeNarrationTrackBytes[] }): Promise<{ inspection: MediaRuntimeVideoInspection; bytes: Uint8Array }> {
    const bundle = encodeMediaCompositionBundle(input.segments, input.compositionPlan, input.musicBytes, input.narrationBytes, input.narrationTrackBytes);
    const response = await this.request({
      path: "/internal/v1/media/compose",
      operationId: input.operationId,
      contentType: "application/vnd.alchemy-media-bundle",
      bytes: bundle,
      expectedSha256: sha256(bundle),
    });
    if (!response.ok) throw await responseError(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      const inspection = MediaRuntimeVideoInspectionSchema.parse({
        mime_type: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase(),
        sha256: response.headers.get("x-media-sha256"),
        byte_size: boundedHeaderNumber(response.headers, "x-media-byte-size"),
        width: boundedHeaderNumber(response.headers, "x-media-width"),
        height: boundedHeaderNumber(response.headers, "x-media-height"),
      duration_ms: boundedHeaderNumber(response.headers, "x-media-duration-ms"),
      has_audio: response.headers.get("x-media-has-audio") === "true",
      audio_channels: boundedHeaderNumber(response.headers, "x-media-audio-channels"),
      audio_sample_rate: boundedHeaderNumber(response.headers, "x-media-audio-sample-rate"),
    });
      if (inspection.byte_size !== bytes.byteLength || inspection.sha256 !== sha256(bytes)) throw new Error("invalid composed bytes");
      return { inspection, bytes };
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RENDER_FAILED", false);
    }
  }

  private async request(input: { path: string; operationId: string; contentType: string; bytes: Uint8Array; expectedSha256: string; body?: BodyInit; extraHeaders?: Record<string, string> }) {
    const fetcher = this.input.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 90_000);
    try {
      return await fetcher(new URL(input.path, this.runtimeUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.input.token}`,
          "Content-Type": input.contentType,
          "X-Media-Operation-Id": input.operationId,
          "X-Media-Expected-Sha256": input.expectedSha256,
          ...input.extraHeaders,
        },
        body: input.body ?? Buffer.from(input.bytes),
        signal: controller.signal,
      });
    } catch {
      throw new MediaRuntimeClientError("MEDIA_RUNTIME_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
