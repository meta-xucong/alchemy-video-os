import { z } from "zod";

import {
  AssetIdSchema,
  DeliveryPlanRevisionIdSchema,
  JsonObjectSchema,
  NarrationScriptRevisionIdSchema,
  ProjectIdSchema,
  NarrationAssetVersionIdSchema,
  Sha256Schema,
  TimelinePlanIdSchema,
  WorkspaceIdSchema,
} from "./primitives.js";

export const NarrationRevisionStatusSchema = z.enum(["DRAFT", "NORMALIZED", "NEEDS_DECISION", "APPROVED", "REJECTED"]);
export const NarrationVisualRoleSchema = z.enum(["PRIMARY", "BROLL", "HOLD"]);
export const CanonicalTranscriptStatusSchema = z.enum(["CHECKED", "NEEDS_REVIEW", "UNAVAILABLE"]);

export const PronunciationGuideSchema = z.object({
  source: z.string().min(1).max(120),
  spoken: z.string().min(1).max(240),
  reason: z.string().min(1).max(240),
}).strict();

export const NarrationDeliverySchema = z.object({
  pace: z.enum(["SLOW", "NATURAL", "FAST"]).default("NATURAL"),
  energy: z.enum(["CALM", "NEUTRAL", "EMPHATIC"]).default("NEUTRAL"),
  emphasis: z.array(z.string().min(1).max(120)).max(20).default([]),
  pause_before_ms: z.number().int().min(0).max(10_000).default(0),
  pause_after_ms: z.number().int().min(0).max(10_000).default(0),
}).strict();

export const NarrationDisplaySectionSchema = z.object({
  id: z.string().min(1).max(160),
  text: z.string().min(1).max(5_000),
}).strict();

export const NarrationSpokenSectionSchema = z.object({
  id: z.string().min(1).max(160),
  display_text: z.string().min(1).max(5_000),
  provider_text: z.string().min(1).max(5_000),
  pronunciation_guides: z.array(PronunciationGuideSchema).max(100).default([]),
  delivery: NarrationDeliverySchema.default({}),
}).strict();

export const CanonicalTranscriptCheckSchema = z.object({
  status: CanonicalTranscriptStatusSchema,
  transcript_asset_id: AssetIdSchema.nullable().default(null),
  matches: z.boolean().nullable(),
  accuracy: z.number().min(0).max(1).nullable(),
  issues: z.array(z.string().min(1).max(240)).max(20).default([]),
}).strict();

export const NarrationScriptRevisionSchema = z.object({
  id: NarrationScriptRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
  status: NarrationRevisionStatusSchema,
  source_script_hash: Sha256Schema,
  display_sections: z.array(NarrationDisplaySectionSchema).min(1).max(120),
  spoken_sections: z.array(NarrationSpokenSectionSchema).min(1).max(120),
  language: z.literal("zh-CN"),
  normalization_version: z.string().min(1).max(80),
  decision_reasons: z.array(z.string().min(1).max(240)).max(50).default([]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export const NarrationAssetVersionSchema = z.object({
  id: NarrationAssetVersionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  narration_script_revision_id: NarrationScriptRevisionIdSchema,
  asset_id: AssetIdSchema,
  provider: z.string().min(1).max(80),
  voice_id: z.string().min(1).max(160),
  provider_settings: JsonObjectSchema.default({}),
  duration_ms: z.number().int().positive(),
  sample_approved: z.boolean(),
  word_timestamps_asset_id: AssetIdSchema.nullable().default(null),
  canonical_transcript_check: CanonicalTranscriptCheckSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

/**
 * Server-side narration generation is intentionally an explicit command.  The
 * fields mirror the already versioned Media Runtime request and the
 * OpenMontage voice-performance/asset-director records; they are not a
 * selector or a second audio protocol.
 */
export const NarrationAudioGenerationKindSchema = z.enum(["SAMPLE", "FORMAL"]);
export const NarrationAudioProviderSchema = z.string().trim().min(1).max(80).refine(
  (value) => value.toLowerCase() !== "auto",
  "Narration provider must be selected explicitly.",
);
export const NarrationAudioProviderSettingsSchema = z.object({
  resource_id: z.string().trim().min(1).max(160).optional(),
  format: z.enum(["mp3", "ogg_opus", "pcm"]).optional(),
  sample_rate: z.number().int().refine((value) => [8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000].includes(value), "Unsupported source sample rate.").optional(),
  speech_rate: z.number().int().min(-50).max(100).optional(),
  enable_timestamp: z.boolean().optional(),
  disable_markdown_filter: z.boolean().optional(),
  return_usage: z.boolean().optional(),
  poll_interval_seconds: z.number().finite().min(0.5).optional(),
  timeout_seconds: z.number().int().min(30).optional(),
}).strict();

export const RequestNarrationAudioGenerationCommandSchema = z.object({
  generation_kind: NarrationAudioGenerationKindSchema,
  section_id: z.string().trim().min(1).max(160),
  provider: NarrationAudioProviderSchema,
  voice_id: z.string().trim().min(1).max(160),
  provider_settings: NarrationAudioProviderSettingsSchema.default({}),
  canonical_script_hash: Sha256Schema,
  /** Required only when requesting the formal asset after sample approval. */
  sample_asset_id: AssetIdSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.generation_kind === "FORMAL" && !value.sample_asset_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sample_asset_id"], message: "Formal narration requires the approved sample asset." });
  }
  if (value.generation_kind === "SAMPLE" && value.sample_asset_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sample_asset_id"], message: "Sample narration must not carry a formal approval asset." });
  }
});

export const PublicNarrationAssetVersionSchema = z.object({
  id: NarrationAssetVersionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  narration_script_revision_id: NarrationScriptRevisionIdSchema,
  asset_id: AssetIdSchema,
  duration_ms: z.number().int().positive(),
  sample_approved: z.boolean(),
  word_timestamps_asset_id: AssetIdSchema.nullable().default(null),
  canonical_transcript_status: CanonicalTranscriptStatusSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export const TimelineNarrationSectionSchema = z.object({
  section_id: z.string().min(1).max(160),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  visual_role: NarrationVisualRoleSchema,
  /** OpenMontage section narration asset identity; omitted for legacy full-track plans. */
  narration_asset_version_id: NarrationAssetVersionIdSchema.optional(),
}).strict().refine((section) => section.end_ms > section.start_ms, "Narration sections must have positive duration.");

export const TimelineVisualSegmentSchema = z.object({
  sequence: z.number().int().positive(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  provider_duration_seconds: z.number().int().min(1).max(15),
}).strict().refine((segment) => segment.end_ms > segment.start_ms, "Visual segments must have positive duration.");

export const TimelinePlanSchema = z.object({
  id: TimelinePlanIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
  narration_script_revision_id: NarrationScriptRevisionIdSchema,
  narration_asset_version_id: NarrationAssetVersionIdSchema.nullable().default(null),
  effective_duration_ms: z.number().int().positive(),
  narration_sections: z.array(TimelineNarrationSectionSchema).min(1).max(120),
  visual_segments: z.array(TimelineVisualSegmentSchema).min(1).max(120),
  status: z.enum(["DRAFT", "READY", "NEEDS_DECISION", "FAILED"]),
  decision_reasons: z.array(z.string().min(1).max(240)).max(50).default([]),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export const CreateNarrationScriptRevisionCommandSchema = z.object({
  display_sections: z.array(NarrationDisplaySectionSchema).min(1).max(120),
  pronunciation_glossary: z.array(PronunciationGuideSchema).max(120).default([]),
  normalization_version: z.string().min(1).max(80).default("c12.7b-local-v1"),
}).strict();

export const ApproveNarrationScriptRevisionCommandSchema = z.object({
  sample_asset_id: AssetIdSchema,
  sample_duration_ms: z.number().int().positive(),
  canonical_script_hash: Sha256Schema,
  word_timestamps_asset_id: AssetIdSchema.nullable().default(null),
}).strict();

export const CreateTimelinePlanCommandSchema = z.object({
  section_durations_ms: z.array(z.object({
    section_id: z.string().min(1).max(160),
    duration_ms: z.number().int().positive(),
    /** Optional independently measured formal narration asset for this section. */
    narration_asset_version_id: NarrationAssetVersionIdSchema.optional(),
  }).strict()).min(1).max(120),
  target_duration_ms: z.number().int().positive(),
  flexible_percent: z.number().int().min(0).max(50).default(20),
  max_provider_duration_seconds: z.number().int().min(1).max(60).default(15),
  narration_asset_version_id: NarrationAssetVersionIdSchema.optional(),
}).strict();

export type NarrationScriptRevision = z.infer<typeof NarrationScriptRevisionSchema>;
export type NarrationAssetVersion = z.infer<typeof NarrationAssetVersionSchema>;
export type NarrationAudioGenerationKind = z.infer<typeof NarrationAudioGenerationKindSchema>;
export type NarrationAudioProviderSettings = z.infer<typeof NarrationAudioProviderSettingsSchema>;
export type RequestNarrationAudioGenerationCommand = z.infer<typeof RequestNarrationAudioGenerationCommandSchema>;
export type NarrationSpokenSection = z.infer<typeof NarrationSpokenSectionSchema>;
export type NarrationDisplaySection = z.infer<typeof NarrationDisplaySectionSchema>;
export type NarrationDelivery = z.infer<typeof NarrationDeliverySchema>;
export type PronunciationGuide = z.infer<typeof PronunciationGuideSchema>;
export type CanonicalTranscriptCheck = z.infer<typeof CanonicalTranscriptCheckSchema>;
export type TimelinePlan = z.infer<typeof TimelinePlanSchema>;
export type CreateNarrationScriptRevisionCommand = z.infer<typeof CreateNarrationScriptRevisionCommandSchema>;
export type ApproveNarrationScriptRevisionCommand = z.infer<typeof ApproveNarrationScriptRevisionCommandSchema>;
export type CreateTimelinePlanCommand = z.infer<typeof CreateTimelinePlanCommandSchema>;
