import { z } from "zod";

import {
  AssetIdSchema,
  BrandPolicyRevisionIdSchema,
  BudgetReservationIdSchema,
  CapabilityProfileRevisionIdSchema,
  CreativeBriefRevisionIdSchema,
  CreativeDecisionLogIdSchema,
  DecimalStringSchema,
  DeliveryPlanRevisionIdSchema,
  JsonObjectSchema,
  NarrationPlanRevisionIdSchema,
  OutputProfileRevisionIdSchema,
  ProductionRunIdSchema,
  ProjectIdSchema,
  PronunciationGlossaryRevisionIdSchema,
  QualityGateDecisionIdSchema,
  StoryboardRevisionIdSchema,
  UserIdSchema,
  UtcTimestampSchema,
  VideoVersionIdSchema,
  VoiceAuthorizationIdSchema,
  WorkspaceIdSchema,
} from "./primitives.js";

export const PREFLIGHT_REVISION_STATUSES = [
  "DRAFT",
  "PREFLIGHT_BLOCKED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "CONSUMED",
  "SUPERSEDED",
] as const;
export const PreflightRevisionStatusSchema = z.enum(PREFLIGHT_REVISION_STATUSES);
export const DurationPolicySchema = z.enum(["FLEXIBLE", "EXACT"]);
export const CaptionPolicySchema = z.enum(["REQUIRED", "OPTIONAL", "OFF"]);
export const LipSyncRequirementSchema = z.enum(["OFF", "PREFERRED", "REQUIRED"]);
export const VoiceModeSchema = z.enum(["PLATFORM_GENERIC", "AUTHORIZED_CLONE", "USER_SOURCE"]);
export const CapabilityProfileStatusSchema = z.enum(["DISABLED", "OFFLINE_CERTIFIED", "LIVE_CERTIFIED", "REVOKED"]);
export const VoiceAuthorizationStatusSchema = z.enum(["PENDING", "ACTIVE", "REVOKED", "EXPIRED"]);
export const PolicyRevisionStatusSchema = z.enum(["DRAFT", "APPROVED", "REVOKED", "SUPERSEDED"]);
export const BudgetReservationStatusSchema = z.enum(["ESTIMATED", "APPROVED", "REJECTED", "EXCEEDED", "CONSUMED", "RELEASED"]);
export const QualityGateSeveritySchema = z.enum(["BLOCK", "REVISE", "REVIEW", "INFO"]);
export const QualityGateActionSchema = z.enum([
  "PRESENT",
  "REVISE_NARRATION",
  "REVISE_EDIT",
  "REGENERATE_SEGMENT",
  "BLOCK",
  "AWAITING_HUMAN_APPROVAL",
]);
export const QualityGateActorSchema = z.enum(["RUNTIME", "USER", "AUTHORIZED_REVIEWER"]);

export const DeliveryPlanRevisionSchema = z.object({
  id: DeliveryPlanRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  creative_brief_revision_id: CreativeBriefRevisionIdSchema,
  storyboard_revision_id: StoryboardRevisionIdSchema,
  revision: z.number().int().positive(),
  status: PreflightRevisionStatusSchema,
  duration_policy: DurationPolicySchema.default("FLEXIBLE"),
  flexible_duration_percent: z.number().int().min(0).max(50).default(20),
  target_duration_seconds: z.number().int().min(15).max(600),
  requires_sample_approval: z.boolean().default(true),
  caption_policy: CaptionPolicySchema.default("REQUIRED"),
  lip_sync_requirement: LipSyncRequirementSchema.default("OFF"),
  voice_mode: VoiceModeSchema.default("PLATFORM_GENERIC"),
  safe_summary: z.string().min(1).max(1_000),
  block_reasons: z.array(z.string().min(1).max(160)).max(20).default([]),
  approved_at: UtcTimestampSchema.nullable().default(null),
  consumed_by_production_run_id: ProductionRunIdSchema.nullable().default(null),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict().superRefine((plan, context) => {
  if (plan.duration_policy === "EXACT" && plan.flexible_duration_percent !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["flexible_duration_percent"], message: "EXACT duration policy cannot allow a flexible duration window." });
  }
  if (plan.status === "PREFLIGHT_BLOCKED" && plan.block_reasons.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["block_reasons"], message: "Blocked delivery plans require at least one safe reason." });
  }
  if ((plan.status === "APPROVED" || plan.status === "CONSUMED") && !plan.approved_at) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["approved_at"], message: "Approved delivery plans must record approval time." });
  }
  if (plan.status === "CONSUMED" && !plan.consumed_by_production_run_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["consumed_by_production_run_id"], message: "Consumed delivery plans must reference the production run snapshot." });
  }
});

export const NarrationPlanRevisionSchema = z.object({
  id: NarrationPlanRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
  revision: z.number().int().positive(),
  status: PreflightRevisionStatusSchema,
  voice_mode: VoiceModeSchema.default("PLATFORM_GENERIC"),
  voice_authorization_id: VoiceAuthorizationIdSchema.nullable().default(null),
  pronunciation_glossary_revision_id: PronunciationGlossaryRevisionIdSchema.nullable().default(null),
  requires_sample_approval: z.boolean().default(true),
  sample_asset_id: AssetIdSchema.nullable().default(null),
  canonical_script_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  safe_summary: z.string().min(1).max(1_000),
  block_reasons: z.array(z.string().min(1).max(160)).max(20).default([]),
  approved_at: UtcTimestampSchema.nullable().default(null),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict().superRefine((plan, context) => {
  if (plan.voice_mode !== "PLATFORM_GENERIC" && !plan.voice_authorization_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["voice_authorization_id"], message: "Non-generic voices require an active authorization." });
  }
  if (plan.requires_sample_approval && plan.status === "APPROVED" && !plan.sample_asset_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sample_asset_id"], message: "Approved narration plans that require sample review must reference the approved sample." });
  }
});

export const CapabilityFeatureSchema = z.object({
  certified: z.boolean(),
  limits: z.record(z.union([z.string(), z.number(), z.boolean()])),
}).strict();

export const CapabilityProfileRevisionSchema = z.object({
  id: CapabilityProfileRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema.nullable(),
  provider_family: z.enum(["LOCAL", "SUB2API", "SEEDANCE", "OPENMONTAGE", "OTHER"]),
  model_or_tool: z.string().min(1).max(160),
  status: CapabilityProfileStatusSchema,
  features: z.record(CapabilityFeatureSchema),
  certification_fixture_version: z.string().min(1).max(160),
  safe_summary: z.string().min(1).max(1_000),
  last_verified_at: UtcTimestampSchema.nullable().default(null),
  created_at: UtcTimestampSchema,
}).strict();

export const VoiceAuthorizationSchema = z.object({
  id: VoiceAuthorizationIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  source_asset_id: AssetIdSchema.nullable().default(null),
  consent_evidence_asset_id: AssetIdSchema.nullable().default(null),
  subject_name: z.string().min(1).max(160),
  allowed_uses: z.array(z.enum(["NARRATION", "VOICE_CLONE", "AVATAR_LIP_SYNC"])).min(1).max(8),
  status: VoiceAuthorizationStatusSchema,
  expires_at: UtcTimestampSchema.nullable().default(null),
  safe_summary: z.string().min(1).max(1_000),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const PronunciationGlossaryEntrySchema = z.object({
  term: z.string().min(1).max(120),
  spoken_form: z.string().min(1).max(240),
  language: z.string().min(2).max(32),
  source: z.enum(["USER", "BRAND_POLICY", "SAMPLE_APPROVAL"]),
}).strict();

export const PronunciationGlossaryRevisionSchema = z.object({
  id: PronunciationGlossaryRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  revision: z.number().int().positive(),
  status: PolicyRevisionStatusSchema,
  entries: z.array(PronunciationGlossaryEntrySchema).max(500),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  approved_at: UtcTimestampSchema.nullable().default(null),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const BrandPolicyRevisionSchema = z.object({
  id: BrandPolicyRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  revision: z.number().int().positive(),
  status: PolicyRevisionStatusSchema,
  approved_names: z.array(z.string().min(1).max(160)).max(200),
  approved_logo_asset_ids: z.array(AssetIdSchema).max(40),
  forbidden_identifiers: z.array(z.string().min(1).max(160)).max(200),
  claims_policy: z.string().max(2_000).default(""),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  approved_at: UtcTimestampSchema.nullable().default(null),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const CreativeDecisionLogSchema = z.object({
  id: CreativeDecisionLogIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  actor_user_id: UserIdSchema.nullable().default(null),
  decision_type: z.enum(["DURATION_POLICY", "SAMPLE_APPROVAL", "PRONUNCIATION", "CAPABILITY_DOWNGRADE", "BUDGET_APPROVAL", "QUALITY_GATE"]),
  source_revision_type: z.string().min(1).max(80),
  source_revision_id: z.string().min(1).max(160),
  safe_summary: z.string().min(1).max(1_000),
  metadata: JsonObjectSchema.default({}),
  created_at: UtcTimestampSchema,
}).strict();

export const BudgetReservationSchema = z.object({
  id: BudgetReservationIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
  status: BudgetReservationStatusSchema,
  estimated_amount: DecimalStringSchema,
  approved_limit: DecimalStringSchema,
  currency: z.string().min(1).max(16).default("CREDIT"),
  reason: z.string().max(500).default(""),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const OutputVariantSchema = z.object({
  id: z.string().min(1).max(80),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1", "custom"]),
  resolution: z.string().min(3).max(32),
  codec: z.string().min(1).max(32),
  caption_mode: z.enum(["BURNED", "SIDECAR", "OFF"]),
  reframe_policy: z.enum(["NONE", "APPROVED_AUTO", "MANUAL"]),
}).strict();

export const OutputProfileRevisionSchema = z.object({
  id: OutputProfileRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
  revision: z.number().int().positive(),
  status: PolicyRevisionStatusSchema,
  variants: z.array(OutputVariantSchema).min(1).max(12),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const QualityGateCheckSchema = z.object({
  code: z.string().min(1).max(120),
  severity: QualityGateSeveritySchema,
  confidence: z.number().min(0).max(1),
  action: QualityGateActionSchema,
}).strict();

export const QualityGateDecisionSchema = z.object({
  id: QualityGateDecisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  video_version_id: VideoVersionIdSchema,
  checks: z.array(QualityGateCheckSchema).max(100),
  final_action: QualityGateActionSchema,
  decided_by: QualityGateActorSchema,
  safe_summary: z.string().min(1).max(1_000),
  created_at: UtcTimestampSchema,
}).strict();

export const CreateDeliveryPlanRevisionCommandSchema = z.object({
  creative_brief_revision_id: CreativeBriefRevisionIdSchema,
  storyboard_revision_id: StoryboardRevisionIdSchema,
  duration_policy: DurationPolicySchema.default("FLEXIBLE"),
  flexible_duration_percent: z.number().int().min(0).max(50).default(20),
  caption_policy: CaptionPolicySchema.default("REQUIRED"),
  lip_sync_requirement: LipSyncRequirementSchema.default("OFF"),
  voice_mode: VoiceModeSchema.default("PLATFORM_GENERIC"),
  budget_limit: DecimalStringSchema.default("0"),
}).strict();

export const ApproveDeliveryPlanRevisionCommandSchema = z.object({}).strict();

export type PreflightRevisionStatus = z.infer<typeof PreflightRevisionStatusSchema>;
export type DurationPolicy = z.infer<typeof DurationPolicySchema>;
export type CaptionPolicy = z.infer<typeof CaptionPolicySchema>;
export type LipSyncRequirement = z.infer<typeof LipSyncRequirementSchema>;
export type VoiceMode = z.infer<typeof VoiceModeSchema>;
export type CapabilityProfileStatus = z.infer<typeof CapabilityProfileStatusSchema>;
export type VoiceAuthorizationStatus = z.infer<typeof VoiceAuthorizationStatusSchema>;
export type PolicyRevisionStatus = z.infer<typeof PolicyRevisionStatusSchema>;
export type BudgetReservationStatus = z.infer<typeof BudgetReservationStatusSchema>;
export type QualityGateSeverity = z.infer<typeof QualityGateSeveritySchema>;
export type QualityGateAction = z.infer<typeof QualityGateActionSchema>;
export type DeliveryPlanRevision = z.infer<typeof DeliveryPlanRevisionSchema>;
export type NarrationPlanRevision = z.infer<typeof NarrationPlanRevisionSchema>;
export type CapabilityProfileRevision = z.infer<typeof CapabilityProfileRevisionSchema>;
export type VoiceAuthorization = z.infer<typeof VoiceAuthorizationSchema>;
export type PronunciationGlossaryRevision = z.infer<typeof PronunciationGlossaryRevisionSchema>;
export type BrandPolicyRevision = z.infer<typeof BrandPolicyRevisionSchema>;
export type CreativeDecisionLog = z.infer<typeof CreativeDecisionLogSchema>;
export type BudgetReservation = z.infer<typeof BudgetReservationSchema>;
export type OutputProfileRevision = z.infer<typeof OutputProfileRevisionSchema>;
export type QualityGateDecision = z.infer<typeof QualityGateDecisionSchema>;
