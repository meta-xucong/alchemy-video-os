import { z } from "zod";

import {
  AssetIdSchema,
  CreativeBriefRevisionIdSchema,
  ProductionRunIdSchema,
  ProjectIdSchema,
  PromptPackageIdSchema,
  ScriptRevisionIdSchema,
  StoryboardRevisionIdSchema,
  StoryboardShotSpecIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";

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

export const CreativeBriefRevisionSchema = z.object({
  id: CreativeBriefRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  revision: z.number().int().positive(),
  source_text: z.string().min(1).max(50_000),
  target_duration_seconds: z.number().int().min(15).max(600),
  target_resolution: CreativeBriefTargetResolutionSchema,
  style_preferences: z.string().max(1_000),
  source_asset_ids: z.array(AssetIdSchema).max(20),
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
}).strict();

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
  status: ProductionRunStatusSchema,
  total_shot_count: z.number().int().positive(),
  accepted_shot_count: z.number().int().nonnegative(),
  total_segment_count: z.number().int().positive().default(1),
  accepted_segment_count: z.number().int().nonnegative().default(0),
  total_duration_seconds: z.number().int().positive(),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const CreateCreativeBriefRevisionCommandSchema = z.object({
  source_text: z.string().min(1).max(50_000),
  target_duration_seconds: z.number().int().min(15).max(600),
  target_resolution: CreativeBriefTargetResolutionSchema.default("720p"),
  style_preferences: z.string().max(1_000).default(""),
  source_asset_ids: z.array(AssetIdSchema).max(20).default([]),
}).strict();
export const RequestCreativePlanCommandSchema = z.object({}).strict();
export const ApproveStoryboardRevisionCommandSchema = z.object({}).strict();
export const CreateProductionRunCommandSchema = z.object({
  storyboard_revision_id: StoryboardRevisionIdSchema,
}).strict();

export type CreativeRevisionStatus = z.infer<typeof CreativeRevisionStatusSchema>;
export type ContinuityLevel = z.infer<typeof ContinuityLevelSchema>;
export type ReferencePolicy = z.infer<typeof ReferencePolicySchema>;
export type ProductionRunStatus = z.infer<typeof ProductionRunStatusSchema>;
export type CreativeBriefTargetResolution = z.infer<typeof CreativeBriefTargetResolutionSchema>;
export type CreativeBriefRevision = z.infer<typeof CreativeBriefRevisionSchema>;
export type ScriptRevision = z.infer<typeof ScriptRevisionSchema>;
export type StoryboardRevision = z.infer<typeof StoryboardRevisionSchema>;
export type StoryboardShotSpec = z.infer<typeof StoryboardShotSpecSchema>;
export type ProductionRun = z.infer<typeof ProductionRunSchema>;
