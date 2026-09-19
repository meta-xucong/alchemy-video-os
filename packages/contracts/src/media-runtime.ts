import { z } from "zod";

import {
  MediaOperationIdSchema,
  Sha256Schema,
} from "./primitives.js";
import { TimelineNarrationSectionSchema } from "./narration-quality.js";

// This is an internal, loopback-only tool contract. It intentionally has no URL,
// object key, local path, or browser-visible request shape.  The optional
// source-provider fields below are only honored when a caller explicitly
// selects the matching OpenMontage provider; they are never public video DTOs.
export const MediaRuntimeToolNameSchema = z.enum([
  "INSPECT_VIDEO",
  "EXTRACT_HANDOFF_FRAME",
  "EXTRACT_BOUNDARY_FRAMES",
  "TRANSCRIBE_VIDEO",
  "FINAL_REVIEW_VIDEO",
  "BURN_CAPTIONS",
  "SYNTHESIZE_NARRATION",
  "COMPOSE_VIDEO",
]);

export const MediaRuntimeNarrationSegmentSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  /** Canonical OpenMontage provider_text; optional only for legacy snapshots. */
  provider_text: z.string().trim().min(1).max(2_000).optional(),
  start_ms: z.number().int().min(0).max(600_000),
  /** C12.7B normalized spoken-section controls; private loopback metadata. */
  pronunciation_guides: z.array(z.object({
    source: z.string().min(1).max(120),
    spoken: z.string().min(1).max(240),
    reason: z.string().min(1).max(240),
  }).strict()).max(100).optional(),
  pause_before_ms: z.number().int().min(0).max(10_000).optional(),
  pause_after_ms: z.number().int().min(0).max(10_000).optional(),
  pace: z.enum(["SLOW", "NATURAL", "FAST"]).optional(),
  energy: z.enum(["CALM", "NEUTRAL", "EMPHATIC"]).optional(),
}).strict();
export const MediaRuntimeNarrationRequestSchema = z.object({
  text: z.string().trim().min(1).max(5_000).optional(),
  segments: z.array(MediaRuntimeNarrationSegmentSchema).max(12).optional(),
  target_duration_ms: z.number().int().positive().max(600_000).optional(),
  /** OpenMontage TTSSelector preferred_provider; absent keeps legacy behavior. */
  preferred_provider: z.string().trim().min(1).max(80).optional(),
  /** Provider-specific source fields; consumed only by an explicit provider. */
  voice_id: z.string().trim().min(1).max(160).optional(),
  resource_id: z.string().trim().min(1).max(160).optional(),
  format: z.enum(["mp3", "ogg_opus", "pcm"]).optional(),
  sample_rate: z.number().int().refine((value) => [8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000].includes(value), "Unsupported source sample rate.").optional(),
  speech_rate: z.number().int().min(-50).max(100).optional(),
  enable_timestamp: z.boolean().optional(),
  disable_markdown_filter: z.boolean().optional(),
  return_usage: z.boolean().optional(),
  poll_interval_seconds: z.number().finite().min(0.5).optional(),
  timeout_seconds: z.number().int().min(30).optional(),
}).strict().superRefine((value, context) => {
  if (value.text && value.segments) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments"], message: "Narration text and segments are mutually exclusive." });
  }
  if (!value.text && (!value.segments || value.segments.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "Narration text or segments are required." });
  }
});

export const MediaRuntimeTranscriptWordSchema = z.object({
  word: z.string().max(240),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(),
  probability: z.number().finite().min(0).max(1).optional(),
}).strict();

export const MediaRuntimeTranscriptSchema = z.object({
  status: z.enum(["CHECKED", "UNAVAILABLE"]),
  language: z.string().max(32).optional(),
  duration_seconds: z.number().finite().positive().optional(),
  segments: z.array(z.object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string().max(2_000),
    words: z.array(MediaRuntimeTranscriptWordSchema).max(2_000).optional(),
  }).strict()).max(600).optional(),
  word_timestamps: z.array(MediaRuntimeTranscriptWordSchema).max(20_000).optional(),
  issues: z.array(z.string().max(240)).max(20),
}).strict();

export const MediaRuntimeOperationSchema = z.object({
  operation_id: MediaOperationIdSchema,
  tool: MediaRuntimeToolNameSchema,
  expected_sha256: Sha256Schema.optional(),
}).strict();

export const MediaRuntimeVideoInspectionSchema = z.object({
  mime_type: z.literal("video/mp4"),
  sha256: Sha256Schema,
  byte_size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
  // Source-aligned OpenMontage media review fields. Optional for legacy
  // runtime responses and historical snapshots.
  has_audio: z.boolean().optional(),
  audio_channels: z.number().int().positive().optional(),
  audio_sample_rate: z.number().int().positive().optional(),
  audio_mean_db: z.number().finite().optional(),
  audio_max_db: z.number().finite().optional(),
}).strict();

export const MediaRuntimeAudioInspectionSchema = z.object({
  mime_type: z.enum(["audio/wav", "audio/mpeg", "audio/ogg", "audio/pcm"]),
  sha256: Sha256Schema,
  byte_size: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
}).strict();

/**
 * Private, source-aligned duration facts carried by the narration consumer.
 * OpenMontage's executive-producer records one measured duration per
 * narration file and the aggregate `total_narration_seconds`; the platform
 * keeps those facts in an internal decision log instead of exposing them to
 * the browser or inventing a second timing protocol.
 */
export const MediaRuntimeNarrationDurationMeasurementSchema = z.object({
  section_id: z.string().min(1).max(160).optional(),
  planned_duration_seconds: z.number().finite().positive(),
  actual_duration_seconds: z.number().finite().positive(),
}).strict();

export const MediaRuntimeNarrationDurationFeedbackSchema = z.object({
  narration_durations: z.array(MediaRuntimeNarrationDurationMeasurementSchema).min(1).max(120),
  total_narration_seconds: z.number().finite().positive(),
  decision: z.enum(["MEASURED", "SEND_BACK", "ADJUST_SCENE_PLAN", "SOURCE_DECISION_REQUIRED"]),
  decision_reason: z.enum(["WITHIN_PLAN", "EXCEEDS_ONE_SECOND", "EXCEEDS_115_PERCENT", "WITHIN_25_PERCENT", "SOURCE_OPTIONS_OVERLAP"]),
  source_actions: z.array(z.enum(["SEND_BACK", "ADJUST_SCENE_PLAN"])).min(1).max(2).optional(),
}).strict().superRefine((feedback, context) => {
  const addIssue = (path: (string | number)[], message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (feedback.decision === "MEASURED" && feedback.decision_reason !== "WITHIN_PLAN") {
    addIssue(["decision_reason"], "MEASURED feedback must use WITHIN_PLAN.");
  }
  if (feedback.decision === "SEND_BACK"
    && feedback.decision_reason !== "EXCEEDS_ONE_SECOND"
    && feedback.decision_reason !== "EXCEEDS_115_PERCENT") {
    addIssue(["decision_reason"], "SEND_BACK feedback must use a source overrun reason.");
  }
  if (feedback.decision === "ADJUST_SCENE_PLAN" && feedback.decision_reason !== "WITHIN_25_PERCENT") {
    addIssue(["decision_reason"], "ADJUST_SCENE_PLAN feedback must use WITHIN_25_PERCENT.");
  }
  if (feedback.decision === "SOURCE_DECISION_REQUIRED"
    && (feedback.decision_reason !== "SOURCE_OPTIONS_OVERLAP"
      || feedback.source_actions?.length !== 2
      || feedback.source_actions[0] !== "SEND_BACK"
      || feedback.source_actions[1] !== "ADJUST_SCENE_PLAN")) {
    addIssue(["source_actions"], "Overlapping source options must preserve both source actions in order.");
  }
  if (feedback.decision !== "SOURCE_DECISION_REQUIRED" && feedback.decision_reason === "SOURCE_OPTIONS_OVERLAP") {
    addIssue(["decision_reason"], "SOURCE_OPTIONS_OVERLAP requires SOURCE_DECISION_REQUIRED.");
  }
  if (feedback.decision !== "SOURCE_DECISION_REQUIRED" && feedback.source_actions !== undefined) {
    addIssue(["source_actions"], "source_actions are only valid when source options overlap.");
  }
});

// Internal adaptation of OpenMontage final_review. Semantic checks remain
// explicit when the local runtime has no transcript or visual evaluator.
export const MediaRuntimeFinalReviewSchema = z.object({
  status: z.enum(["PASS", "NEEDS_ATTENTION", "FAILED"]),
  technical_probe: z.object({
    valid_container: z.boolean(),
    duration_seconds: z.number().positive(),
    resolution: z.string().min(3).max(32),
    fps: z.number().positive(),
    has_audio: z.boolean(),
    codec: z.string().min(1).max(32),
    file_size_bytes: z.number().int().positive(),
    captions_present: z.boolean().optional(),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  visual_spotcheck: z.object({
    frames_sampled: z.number().int().min(4),
    black_frames_detected: z.boolean(),
    broken_overlays: z.boolean(),
    missing_assets: z.boolean(),
    unreadable_text: z.boolean(),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  audio_spotcheck: z.object({
    has_audio: z.boolean(),
    audio_channels: z.number().int().positive().optional(),
    audio_sample_rate: z.number().int().positive().optional(),
    unexpected_silence: z.boolean(),
    integrated_lufs: z.number().finite().optional(),
    true_peak_db: z.number().finite().optional(),
    loudness_range_lu: z.number().finite().nonnegative().optional(),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  promise_preservation: z.object({
    status: z.enum(["CHECKED", "UNAVAILABLE"]),
    renderer_family_used: z.string().min(1).max(80),
    render_runtime_used: z.enum(["ffmpeg"]),
    runtime_swap_detected: z.boolean(),
    silent_downgrade_detected: z.boolean(),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  subtitle_check: z.object({
    status: z.enum(["NOT_EXPECTED", "CHECKED", "UNAVAILABLE"]),
    subtitles_expected: z.boolean(),
    subtitles_present: z.boolean(),
    coverage_ratio: z.number().min(0).max(1).optional(),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  transcript_comparison: z.object({
    status: z.enum(["CHECKED", "NOT_EXPECTED", "UNAVAILABLE"]),
    transcript_matches_script: z.boolean().nullable(),
    word_accuracy: z.number().min(0).max(1).nullable(),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  semantic_evaluation: z.object({
    status: z.enum(["CHECKED", "UNAVAILABLE"]),
    issues: z.array(z.string().max(240)).max(20),
  }).strict(),
  issues_found: z.array(z.string().max(240)).max(30),
  recommended_action: z.enum(["PRESENT_WITH_REVIEW", "REVISE", "BLOCK"]),
}).strict();

export const MediaRuntimeImageArtifactSchema = z.object({
  mime_type: z.literal("image/png"),
  sha256: Sha256Schema,
  byte_size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const MediaRuntimeBoundaryFramesSchema = z.object({
  first: MediaRuntimeImageArtifactSchema.extend({ bytes_base64: z.string().min(1) }),
  last: MediaRuntimeImageArtifactSchema.extend({ bytes_base64: z.string().min(1) }),
}).strict();

export const MediaRuntimeCompositionTransitionSchema = z.enum(["PASS", "BLEND", "BRIDGE"]);
export const MediaRuntimeAudioPolicySchema = z.enum(["LEGACY_PRESERVE", "CONTINUOUS_NARRATION"]);
/** Private C12 AudioPlan stitch policy. Legacy bundles do not carry this object. */
// SEGMENT_AUDIO is a source-repository mode, but this Runtime only has a
// verified continuous narration and legacy preservation implementation. Keep
// the wire fail-closed until a segment payload is available.
export const MediaRuntimeStitchPolicySchema = z.enum(["CONTINUOUS_NARRATION", "LEGACY_PRESERVE"]);
/** Private C12 AudioPlan ownership labels; omitted on legacy bundles. */
export const MediaRuntimeAudioOwnershipSchema = z.enum([
  "PLATFORM_NARRATION",
  "PROVIDER_DIALOGUE",
  "PROVIDER_AMBIENCE",
  "USER_SOURCE_AUDIO",
  "MUSIC",
  "SFX",
  "LEGACY_PRESERVE",
]);
export const MediaRuntimeAudioTrackSchema = z.object({
  track_id: z.string().min(1).max(160),
  ownership: MediaRuntimeAudioOwnershipSchema,
  /** Source AudioTrackPlan identity; optional only for ALCHMED1-7 compatibility. */
  asset_id: z.string().min(1).max(160).optional(),
  start_ms: z.number().int().min(0),
  end_ms: z.number().int().positive(),
  /** Source AudioTrackPlan gain is a dB string, retained as-is for FFmpeg mapping. */
  gain_db: z.string().min(1).max(32).regex(/^-?(?:\d+(?:\.\d+)?)$/).optional(),
  duck_under_narration: z.boolean().default(false),
  fade_in_ms: z.number().int().min(0).max(10_000).optional(),
  fade_out_ms: z.number().int().min(0).max(10_000).optional(),
}).strict();
export const MediaRuntimeAudioPlanSchema = z.object({
  version: z.literal(1),
  target_duration_ms: z.number().int().positive(),
  narration_asset_id: z.string().min(1).max(160).optional(),
  /** Absolute section windows from the approved TimelinePlan. One platform
   * track still carries the complete asset; these windows are timing facts,
   * not duplicate audio tracks. */
  narration_sections: z.array(TimelineNarrationSectionSchema).min(1).max(120),
  tracks: z.array(MediaRuntimeAudioTrackSchema).max(64),
  stitch_policy: MediaRuntimeStitchPolicySchema,
  /** Private canonical transcript; never project this into public DTOs. */
  transcript_script: z.string().max(8_000).optional(),
  transcript_timing_asset_id: z.string().min(1).max(160).optional(),
}).strict().superRefine((value, context) => {
  const seenSectionIds = new Set<string>();
  let previousSectionEnd = 0;
  for (const [index, section] of value.narration_sections.entries()) {
    if (seenSectionIds.has(section.section_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["narration_sections", index, "section_id"], message: "Narration section IDs must be unique." });
    }
    if (section.start_ms < previousSectionEnd || section.end_ms > value.target_duration_ms) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["narration_sections", index], message: "Narration section windows must be ordered and fit within the target duration." });
    }
    seenSectionIds.add(section.section_id);
    previousSectionEnd = section.end_ms;
  }
  if (value.narration_sections.at(-1)?.end_ms !== value.target_duration_ms) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["narration_sections"], message: "Narration sections must cover the composition target; declare an explicit HOLD/BROLL tail instead of implicit silence." });
  }
  for (const [index, track] of value.tracks.entries()) {
    if (!track.asset_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks", index, "asset_id"], message: "AudioPlan tracks require an asset_id." });
    }
    if (!track.gain_db) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks", index, "gain_db"], message: "AudioPlan tracks require gain_db." });
    }
  }
});
export const MediaRuntimeMusicMixSchema = z.object({
  enabled: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(0.12),
  fade_in_ms: z.number().int().min(0).max(10_000).default(1_500),
  fade_out_ms: z.number().int().min(0).max(10_000).default(2_500),
  ducking_enabled: z.boolean().default(true),
  ducking_reduction_db: z.number().min(0).max(30).default(8),
  /** OpenMontage sound-design target for social video output. */
  target_lufs: z.number().min(-24).max(-10).default(-14),
  true_peak_db: z.number().min(-6).max(-0.1).default(-1.5),
  voice_enhance: z.boolean().default(true),
  music_eq_cut_db: z.number().min(0).max(12).default(3),
}).strict();
export const MusicSelectionModeSchema = z.enum(["AUTO", "MANUAL", "OFF"]);
export const MusicPlanSchema = z.object({
  mode: MusicSelectionModeSchema.default("AUTO"),
  asset_id: z.string().min(1).max(160).optional(),
  style_hint: z.string().max(500).default(""),
}).strict().superRefine((value, context) => {
  if (value.mode === "MANUAL" && !value.asset_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ["asset_id"], message: "Manual music selection requires an asset." });
  if (value.mode !== "MANUAL" && value.asset_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ["asset_id"], message: "Only manual music selection may specify an asset." });
});
export const MediaRuntimeCompositionPlanSchema = z.object({
  target_duration_ms: z.number().int().positive(),
  transitions: z.array(MediaRuntimeCompositionTransitionSchema).max(11),
  bridge_durations_ms: z.array(z.number().int().min(1_000).max(3_000)).max(11).default([]),
  audio_policy: MediaRuntimeAudioPolicySchema.default("LEGACY_PRESERVE"),
  /** Optional private ownership facts. Legacy ALCHMED bundles omit these. */
  audio_tracks: z.array(MediaRuntimeAudioTrackSchema).max(64).optional(),
  /** Complete private C12 AudioPlan; ALCHMED8 is the only wire version that carries it. */
  audio_plan: MediaRuntimeAudioPlanSchema.optional(),
  music_mix: MediaRuntimeMusicMixSchema.default({}),
  /** Optional absolute windows where the music bed is audible. */
  music_segments_ms: z.array(z.object({
    start_ms: z.number().int().min(0),
    end_ms: z.number().int().positive(),
  }).strict()).max(32).default([]),
}).strict().superRefine((value, context) => {
  if (value.audio_plan && value.audio_tracks) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["audio_tracks"], message: "AudioPlan is the sole source of audio ownership facts; legacy audio_tracks cannot be supplied alongside it." });
  }
  let previousEnd = 0;
  for (const [index, segment] of value.music_segments_ms.entries()) {
    if (segment.start_ms >= segment.end_ms) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["music_segments_ms", index], message: "Music windows must have start_ms < end_ms." });
    }
    if (segment.end_ms > value.target_duration_ms) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["music_segments_ms", index, "end_ms"], message: "Music windows must fit within the target duration." });
    }
    if (segment.start_ms < previousEnd) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["music_segments_ms", index], message: "Music windows must be ordered and non-overlapping." });
    }
    previousEnd = Math.max(previousEnd, segment.end_ms);
  }
  const ownershipTracks = value.audio_plan?.tracks ?? value.audio_tracks ?? [];
  if (value.audio_plan) {
    if (value.audio_plan.target_duration_ms !== value.target_duration_ms) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["audio_plan", "target_duration_ms"], message: "AudioPlan target must match the composition target." });
    }
    const expectedStitchPolicy = value.audio_policy === "CONTINUOUS_NARRATION" ? "CONTINUOUS_NARRATION" : "LEGACY_PRESERVE";
    if (value.audio_plan.stitch_policy !== expectedStitchPolicy) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["audio_plan", "stitch_policy"], message: "AudioPlan stitch policy must match audio_policy." });
    }
  }
  const seenTrackIds = new Set<string>();
  let previousTrackStart = 0;
  for (const [index, track] of ownershipTracks.entries()) {
    if (seenTrackIds.has(track.track_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [value.audio_plan ? "audio_plan" : "audio_tracks", ...(value.audio_plan ? ["tracks"] : []), index, "track_id"], message: "Audio track IDs must be unique." });
    }
    seenTrackIds.add(track.track_id);
    if (index > 0 && track.start_ms < previousTrackStart) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [value.audio_plan ? "audio_plan" : "audio_tracks", ...(value.audio_plan ? ["tracks"] : []), index, "start_ms"], message: "Audio track windows must be ordered by absolute start time." });
    }
    previousTrackStart = track.start_ms;
    if (track.start_ms >= track.end_ms || track.end_ms > value.target_duration_ms) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [value.audio_plan ? "audio_plan" : "audio_tracks", ...(value.audio_plan ? ["tracks"] : []), index], message: "Audio track windows must fit within the target duration." });
    }
  }
  if (value.audio_policy === "CONTINUOUS_NARRATION") {
    const narrationTracks = ownershipTracks.filter((track) => track.ownership === "PLATFORM_NARRATION");
    if (narrationTracks.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: value.audio_plan ? ["audio_plan", "tracks"] : ["audio_tracks"], message: "Continuous narration requires a PLATFORM_NARRATION track." });
    } else if (!narrationTracks.some((track) => track.start_ms === 0 && track.end_ms === value.target_duration_ms)) {
      const primarySections = value.audio_plan?.narration_sections.filter((section) => section.visual_role === "PRIMARY") ?? [];
      const hasIndependentSectionTracks = Boolean(value.audio_plan
        && primarySections.length > 0
        && primarySections.every((section) => typeof section.narration_asset_version_id === "string"
          && narrationTracks.some((track) => track.start_ms === section.start_ms && track.end_ms === section.end_ms)));
      if (!hasIndependentSectionTracks) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: value.audio_plan ? ["audio_plan", "tracks"] : ["audio_tracks"], message: "The PLATFORM_NARRATION track must cover the composition target or each PRIMARY section must carry an independent source asset." });
      }
    }
  }
});

export const MediaRuntimeCompositionInputSchema = z.object({
  operation_id: MediaOperationIdSchema,
  tool: z.literal("COMPOSE_VIDEO"),
  segment_count: z.number().int().min(1).max(12),
  composition_plan: MediaRuntimeCompositionPlanSchema.optional(),
  expected_sha256: Sha256Schema.optional(),
}).strict();

export type MediaRuntimeToolName = z.infer<typeof MediaRuntimeToolNameSchema>;
export type MediaRuntimeNarrationSegment = z.infer<typeof MediaRuntimeNarrationSegmentSchema>;
export type MediaRuntimeNarrationRequest = z.infer<typeof MediaRuntimeNarrationRequestSchema>;
export type MediaRuntimeOperation = z.infer<typeof MediaRuntimeOperationSchema>;
export type MediaRuntimeVideoInspection = z.infer<typeof MediaRuntimeVideoInspectionSchema>;
export type MediaRuntimeAudioInspection = z.infer<typeof MediaRuntimeAudioInspectionSchema>;
export type MediaRuntimeNarrationDurationMeasurement = z.infer<typeof MediaRuntimeNarrationDurationMeasurementSchema>;
export type MediaRuntimeNarrationDurationFeedback = z.infer<typeof MediaRuntimeNarrationDurationFeedbackSchema>;
export type MediaRuntimeFinalReview = z.infer<typeof MediaRuntimeFinalReviewSchema>;
export type MediaRuntimeTranscript = z.infer<typeof MediaRuntimeTranscriptSchema>;
export type MediaRuntimeImageArtifact = z.infer<typeof MediaRuntimeImageArtifactSchema>;
export type MediaRuntimeBoundaryFrames = z.infer<typeof MediaRuntimeBoundaryFramesSchema>;
export type MediaRuntimeCompositionPlan = z.infer<typeof MediaRuntimeCompositionPlanSchema>;
export type MediaRuntimeAudioPolicy = z.infer<typeof MediaRuntimeAudioPolicySchema>;
export type MediaRuntimeAudioOwnership = z.infer<typeof MediaRuntimeAudioOwnershipSchema>;
export type MediaRuntimeAudioTrack = z.infer<typeof MediaRuntimeAudioTrackSchema>;
export type MediaRuntimeAudioPlan = z.infer<typeof MediaRuntimeAudioPlanSchema>;
export type MediaRuntimeStitchPolicy = z.infer<typeof MediaRuntimeStitchPolicySchema>;
export type MediaRuntimeMusicMix = z.infer<typeof MediaRuntimeMusicMixSchema>;
export type MusicPlan = z.infer<typeof MusicPlanSchema>;
export type MusicSelectionMode = z.infer<typeof MusicSelectionModeSchema>;
export type MediaRuntimeCompositionInput = z.infer<typeof MediaRuntimeCompositionInputSchema>;
