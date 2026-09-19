import { z } from "zod";

import {
  AssetIdSchema,
  CreativeBriefRevisionIdSchema,
  DeliveryPlanRevisionIdSchema,
  ProductionRunIdSchema,
  ProjectIdSchema,
  PromptPackageIdSchema,
  ScriptRevisionIdSchema,
  StoryboardRevisionIdSchema,
  StoryboardShotSpecIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";
import { MusicPlanSchema } from "./media-runtime.js";

export const CREATIVE_REVISION_STATUSES = [
  "DRAFT",
  "PLANNING",
  "READY_FOR_REVIEW",
  "APPROVED",
  "FAILED",
  "SUPERSEDED",
 ] as const;
export const CreativeRevisionStatusSchema = z.enum(CREATIVE_REVISION_STATUSES);
export const ContinuityLevelSchema = z.enum(["STANDARD", "REVIEW_REQUIRED"]);
export const ReferencePolicySchema = z.enum(["REFERENCE_SET", "HANDOFF_FIRST_FRAME", "TEXT_TRANSITION"]);
export const PRODUCTION_RUN_STATUSES = [
  "DRAFT",
  "PLAN_READY",
  "CONFIRMED",
  "GENERATING",
  "REVIEWING",
  "RENDERING",
  "SUCCEEDED",
  "BLOCKED",
  "FAILED",
] as const;
export const ProductionRunStatusSchema = z.enum(PRODUCTION_RUN_STATUSES);
export const CreativeBriefTargetResolutionSchema = z.enum(["480p", "720p"]);

export const DocumentContextReferenceSchema = z.object({
  document_id: z.string().min(1),
  conversion_id: z.string().min(1),
  source_asset_id: AssetIdSchema,
  markdown_asset_id: AssetIdSchema,
  max_content_characters: z.number().int().min(1).max(5_000),
}).strict();
export const ContinuityStatusSchema = z.enum([
  "NOT_CHECKED",
  "CHECKING",
  "GOOD",
  "AUTO_REPAIRING",
  "NEEDS_ATTENTION",
]);

export const CreativeBriefRevisionSchema = z.object({
  id: CreativeBriefRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  revision: z.number().int().positive(),
  source_text: z.string().min(1).max(50_000),
  target_duration_seconds: z.number().int().min(1).max(600),
  target_resolution: CreativeBriefTargetResolutionSchema,
  style_preferences: z.string().max(1_000),
  source_asset_ids: z.array(AssetIdSchema).max(20),
  document_contexts: z.array(DocumentContextReferenceSchema).max(4).default([]),
  status: CreativeRevisionStatusSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const ScriptBeatSchema = z.object({
  sequence: z.number().int().positive(),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2_000),
  narrative_goal: z.string().min(1).max(1_000),
  visible_facts: z.array(z.string().min(1).max(512)).max(20),
  generation_segment_sequence: z.number().int().positive().optional(),
}).strict();

export const ScriptRevisionSchema = z.object({
  id: ScriptRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  creative_brief_revision_id: CreativeBriefRevisionIdSchema,
  revision: z.number().int().positive(),
  beats: z.array(ScriptBeatSchema).min(1).max(60),
  status: CreativeRevisionStatusSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const StoryboardShotSpecSchema = z.object({
  id: StoryboardShotSpecIdSchema,
  sequence: z.number().int().positive(),
  title: z.string().min(1).max(160),
  duration_seconds: z.number().int().min(1).max(15),
  narrative_goal: z.string().min(1).max(1_000),
  start_state: z.string().min(1).max(1_000),
  end_state: z.string().min(1).max(1_000),
  transition_summary: z.string().min(1).max(1_000),
  reference_policy: ReferencePolicySchema,
  depends_on_sequences: z.array(z.number().int().positive()).max(20),
  continuity_note: z.string().min(1).max(1_000),
  narrative_beat_sequences: z.array(z.number().int().positive()).max(60).default([]),
  // Source-aligned bindings from huobao storyboard-breaker. Optional for old
  // revisions; new revisions must not invent IDs that are absent from context.
  scene_id: z.string().min(1).max(160).optional(),
  character_ids: z.array(z.string().min(1).max(160)).max(20).optional(),
  prop_ids: z.array(z.string().min(1).max(160)).max(20).optional(),
  reference_anchors: z.array(z.string().min(1).max(160)).max(20).optional(),
}).strict();

export const DeliveryCueSchema = z.object({
  cue_id: z.string().min(1).max(160),
  text: z.string().min(1).max(2_000),
  // OpenMontage voice-performance contract: provider_text is the exact
  // provider-facing utterance (including supported punctuation/break tags),
  // while text remains the source/display copy for legacy snapshots.
  provider_text: z.string().min(1).max(2_000).optional(),
  pace: z.enum(["SLOW", "NATURAL", "BRISK"]).default("NATURAL"),
  energy: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  emphasis_words: z.array(z.string().min(1).max(80)).max(20).default([]),
  pause_before_seconds: z.number().finite().nonnegative().max(10).default(0),
  pause_after_seconds: z.number().finite().nonnegative().max(10).default(0),
  delivery_note: z.string().max(500).default(""),
  pronunciation_guides: z.array(z.string().min(1).max(160)).max(20).default([]),
}).strict();

export const VoicePerformanceSchema = z.object({
  performance_intent: z.string().min(1).max(500),
  pacing_profile: z.enum(["NATURAL", "CONVERSATIONAL", "BRISK", "MEASURED"]),
  energy_curve: z.string().min(1).max(500),
  pause_policy: z.string().min(1).max(500),
  delivery_cues: z.array(DeliveryCueSchema).max(120).default([]),
  sample_section_id: z.string().min(1).max(160).optional(),
  provider_notes: z.string().max(1_000).default(""),
}).strict();

export const NarrationCueSchema = z.object({
  cue_id: z.string().min(1).max(160),
  start_seconds: z.number().finite().nonnegative().max(600),
  end_seconds: z.number().finite().positive().max(600),
  source_ref: z.string().min(1).max(300),
}).strict().superRefine((cue, context) => {
  if (cue.end_seconds <= cue.start_seconds) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end_seconds"], message: "Narration cue must have positive duration." });
  }
});

export const MotionBeatSchema = z.object({
  sequence: z.number().int().positive(),
  start_seconds: z.number().finite().min(0).max(600),
  end_seconds: z.number().finite().positive().max(600),
  action: z.string().min(1).max(1_000),
  subject_refs: z.array(z.string().min(1).max(160)).min(1).max(12),
  start_pose: z.string().min(1).max(500),
  end_pose: z.string().min(1).max(500),
  shot_size: z.string().min(1).max(120),
  camera_movement: z.string().min(1).max(240),
  continuity_locks: z.array(z.string().min(1).max(300)).max(20),
  prohibited_changes: z.array(z.string().min(1).max(300)).max(20),
  source_narrative_beat_sequences: z.array(z.number().int().positive()).min(1).max(60),
  key_visual_objects: z.array(z.string().min(1).max(300)).max(12).optional(),
  object_states: z.array(z.object({
    name: z.string().min(1).max(80),
    instance_count: z.number().int().min(1).max(4),
    holder: z.enum(["LEFT_HAND", "RIGHT_HAND", "BOTH_HANDS", "WORLD", "NOT_VISIBLE"]),
    phase: z.enum(["STABLE", "RELEASE", "CONTACT", "TRANSFERRED"]),
  }).strict()).max(12).optional(),
  source_description: z.string().min(1).max(2_000).optional(),
  reference_anchors: z.array(z.string().min(1).max(160)).max(20).optional(),
  narration_cue_ids: z.array(z.string().min(1).max(160)).max(40).optional(),
}).strict();

export const KeyVisualObjectHolderSchema = z.enum(["LEFT_HAND", "RIGHT_HAND", "BOTH_HANDS", "WORLD", "NOT_VISIBLE"]);
export const KeyVisualObjectTransferSchema = z.object({
  from: KeyVisualObjectHolderSchema,
  to: KeyVisualObjectHolderSchema,
}).strict().superRefine((transfer, context) => {
  if (transfer.from === transfer.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Object transfer must change the holder." });
  }
});
export const KeyVisualObjectLockSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  relation: z.string().min(1).max(200),
  prohibited_changes: z.array(z.string().min(1).max(240)).max(8),
  instance_count: z.number().int().min(1).max(4).optional(),
  holder: KeyVisualObjectHolderSchema.optional(),
  transfer: KeyVisualObjectTransferSchema.optional(),
}).strict();

export const GenerationSegmentMotionPlanSchema = z.object({
  version: z.string().min(1).max(160),
  duration_seconds: z.number().int().min(1).max(15),
  scene_lock: z.string().min(1).max(500),
  character_locks: z.array(z.string().min(1).max(500)).max(20),
  prop_locks: z.array(z.string().min(1).max(500)).max(20),
  key_visual_objects: z.array(KeyVisualObjectLockSchema).max(12).optional(),
  motion_beats: z.array(MotionBeatSchema).min(1).max(8),
  opening_state: z.string().min(1).max(1_000),
  closing_state: z.string().min(1).max(1_000),
  transition_in: z.string().min(1).max(500),
  transition_out: z.string().min(1).max(500),
  complexity_score: z.number().int().min(0).max(100),
  source_narrative_beat_sequences: z.array(z.number().int().positive()).min(1).max(60),
  // Huobao storyboard-breaker rule: reserve enough time for audible dialogue
  // and a small performance tail. Optional to keep old snapshots readable.
  dialogue_duration_seconds: z.number().finite().nonnegative().max(600).optional(),
  voice_performance: VoicePerformanceSchema.optional(),
}).strict().superRefine((plan, context) => {
  const beats = [...plan.motion_beats].sort((left, right) => left.sequence - right.sequence);
  const objectLocks = plan.key_visual_objects ?? [];
  const singletonNames = new Set(objectLocks.filter((object) => (object.instance_count ?? 1) === 1).map((object) => object.name));
  objectLocks.forEach((object, objectIndex) => {
    if (object.transfer && object.transfer.from === object.transfer.to) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["key_visual_objects", objectIndex, "transfer"], message: "Object transfer must change the holder." });
    }
  });
  if (beats.some((beat, index) => beat.sequence !== index + 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats"], message: "Motion beat sequences must be contiguous." });
  }
  if (Math.abs(beats[0]!.start_seconds) > 0.001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats", 0, "start_seconds"], message: "Motion timeline must start at 0 seconds." });
  }
  beats.forEach((beat, index) => {
    if (beat.end_seconds <= beat.start_seconds) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats", index], message: "Motion beat must have positive duration." });
    }
    const next = beats[index + 1];
    if (next && Math.abs(next.start_seconds - beat.end_seconds) > 0.001) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats", index], message: "Motion timeline must not contain gaps or overlaps." });
    }
    const states = beat.object_states ?? [];
    const stateNames = states.map((state) => state.name);
    if (new Set(stateNames).size !== stateNames.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats", index, "object_states"], message: "Each object may have only one state per motion beat." });
    }
    states.forEach((state, stateIndex) => {
      if (singletonNames.has(state.name) && state.instance_count !== 1) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats", index, "object_states", stateIndex, "instance_count"], message: "Singleton visual objects may not be duplicated." });
      }
    });
  });
  objectLocks.forEach((object) => {
    if (!object.transfer) return;
    const states = beats.flatMap((beat) => (beat.object_states ?? []).filter((state) => state.name === object.name));
    if (states.length === 0) return;
    const first = states[0]!;
    const last = states.at(-1)!;
    if (first.holder !== object.transfer.from || first.phase !== "RELEASE" || last.holder !== object.transfer.to || last.phase !== "TRANSFERRED") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats"], message: "Explicit object transfers must start with release and end with the declared holder." });
    }
    if (states.length >= 3 && !states.slice(1, -1).some((state) => state.holder === "BOTH_HANDS" && state.phase === "CONTACT")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats"], message: "Explicit object transfers require a contact handoff state." });
    }
  });
  const last = beats.at(-1);
  if (last && Math.abs(last.end_seconds - plan.duration_seconds) > 0.001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion_beats", beats.length - 1, "end_seconds"], message: "Motion timeline must cover the full segment duration." });
  }
});

export const StoryboardRevisionSchema = z.object({
  id: StoryboardRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  script_revision_id: ScriptRevisionIdSchema,
  revision: z.number().int().positive(),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2_000),
  total_duration_seconds: z.number().int().min(1).max(600),
  continuity_level: ContinuityLevelSchema,
  continuity_note: z.string().min(1).max(1_000),
  status: CreativeRevisionStatusSchema,
  shot_specs: z.array(StoryboardShotSpecSchema).min(1).max(60),
  narrative_beat_count: z.number().int().nonnegative().default(0),
  generation_segment_count: z.number().int().positive().default(1),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

// The compiled prompt and capability routing stay within the Worker/Persistence boundary.
export const PromptPackageSummarySchema = z.object({
  id: PromptPackageIdSchema,
  shot_spec_id: StoryboardShotSpecIdSchema,
  compiler_version: z.string().min(1).max(160),
  created_at: UtcTimestampSchema,
}).strict();

export const ProductionRunSchema = z.object({
  id: ProductionRunIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  storyboard_revision_id: StoryboardRevisionIdSchema,
  // Historical runs created before C11.7/C12.7A may not have a delivery plan.
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema.optional(),
  status: ProductionRunStatusSchema,
  total_shot_count: z.number().int().positive(),
  accepted_shot_count: z.number().int().nonnegative(),
  total_segment_count: z.number().int().positive().default(1),
  accepted_segment_count: z.number().int().nonnegative().default(0),
  total_duration_seconds: z.number().int().positive(),
  continuity_status: ContinuityStatusSchema.default("NOT_CHECKED"),
  planned_segment_count: z.number().int().positive().default(1),
  max_auto_repair_count: z.number().int().min(0).max(20).default(2),
  auto_repair_count: z.number().int().nonnegative().default(0),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const CreateCreativeBriefRevisionCommandSchema = z.object({
  source_text: z.string().min(1).max(50_000),
  target_duration_seconds: z.number().int().min(1).max(600),
  target_resolution: CreativeBriefTargetResolutionSchema.default("720p"),
  style_preferences: z.string().max(1_000).default(""),
  source_asset_ids: z.array(AssetIdSchema).max(20).default([]),
}).strict();
export const RequestCreativePlanCommandSchema = z.object({}).strict();
export const ApproveStoryboardRevisionCommandSchema = z.object({}).strict();
export const CreateProductionRunCommandSchema = z.object({
  storyboard_revision_id: StoryboardRevisionIdSchema,
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
  music_plan: MusicPlanSchema.default({}),
}).strict();

export type CreativeRevisionStatus = z.infer<typeof CreativeRevisionStatusSchema>;
export type ContinuityLevel = z.infer<typeof ContinuityLevelSchema>;
export type ReferencePolicy = z.infer<typeof ReferencePolicySchema>;
export type ProductionRunStatus = z.infer<typeof ProductionRunStatusSchema>;
export type ContinuityStatus = z.infer<typeof ContinuityStatusSchema>;
export type CreativeBriefTargetResolution = z.infer<typeof CreativeBriefTargetResolutionSchema>;
export type DocumentContextReference = z.infer<typeof DocumentContextReferenceSchema>;
export type CreativeBriefRevision = z.infer<typeof CreativeBriefRevisionSchema>;
export type ScriptRevision = z.infer<typeof ScriptRevisionSchema>;
export type StoryboardRevision = z.infer<typeof StoryboardRevisionSchema>;
export type StoryboardShotSpec = z.infer<typeof StoryboardShotSpecSchema>;
export type DeliveryCue = z.infer<typeof DeliveryCueSchema>;
export type VoicePerformance = z.infer<typeof VoicePerformanceSchema>;
export type NarrationCue = z.infer<typeof NarrationCueSchema>;
export type MotionBeat = z.infer<typeof MotionBeatSchema>;
export type KeyVisualObjectHolder = z.infer<typeof KeyVisualObjectHolderSchema>;
export type KeyVisualObjectTransfer = z.infer<typeof KeyVisualObjectTransferSchema>;
export type KeyVisualObjectLock = z.infer<typeof KeyVisualObjectLockSchema>;
export type GenerationSegmentMotionPlan = z.infer<typeof GenerationSegmentMotionPlanSchema>;
export type ProductionRun = z.infer<typeof ProductionRunSchema>;
