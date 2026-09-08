import { z } from "zod";

import {
  AssetIdSchema,
  AssetDerivationIdSchema,
  CreativeBriefRevisionIdSchema,
  DocumentConversionIdSchema,
  DocumentKnowledgeRevisionIdSchema,
  DocumentIdSchema,
  DeliveryPlanRevisionIdSchema,
  EventIdSchema,
  HandoffReviewIdSchema,
  IdempotencyKeySchema,
  JsonObjectSchema,
  NarrationAssetVersionIdSchema,
  NarrationScriptRevisionIdSchema,
  TimelinePlanIdSchema,
  ProjectIdSchema,
  ProductionSegmentIdSchema,
  ProductionRunIdSchema,
  QcReportIdSchema,
  ProviderAttemptIdSchema,
  Sha256Schema,
  ShotIdSchema,
  StoryboardRevisionIdSchema,
  TaskRunIdSchema,
  TransitionRepairIdSchema,
  UsageRecordIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
  VideoVersionIdSchema,
} from "./primitives.js";
import { ContinuityLevelSchema, ContinuityStatusSchema, ProductionRunStatusSchema } from "./creative-planning.js";
import { DocumentConversionStatusSchema } from "./documents.js";
import { DocumentKnowledgeAnalysisQualitySchema, DocumentKnowledgeRevisionStatusSchema } from "./document-knowledge.js";
import { PreflightRevisionStatusSchema } from "./delivery-preflight.js";
import {
  HandoffReviewReasonCodeSchema,
  HandoffReviewResultSchema,
  ProductionSegmentStatusSchema,
  QcStatusSchema,
  TransitionRepairStrategySchema,
} from "./production.js";
import {
  AssetKindSchema,
  PublicTaskRunStatusSchema,
  ShotStatusSchema,
  TaskRunKindSchema,
  TaskRunStatusSchema,
} from "./resources.js";
import {
  NarrationAudioGenerationKindSchema,
  NarrationAudioProviderSchema,
  NarrationAudioProviderSettingsSchema,
} from "./narration-quality.js";

const AggregateSchema = z.object({
  type: z.enum([
    "project",
    "shot",
    "task_run",
    "asset",
    "document",
    "document_conversion",
    "document_knowledge_revision",
    "creative_brief_revision",
    "script_revision",
    "storyboard_revision",
    "production_run",
    "production_segment",
    "asset_derivation",
    "qc_report",
    "video_version",
    "handoff_review",
    "transition_repair",
    "delivery_plan_revision",
    "timeline_plan",
    "narration_plan_revision",
    "capability_profile_revision",
    "voice_authorization",
    "pronunciation_glossary_revision",
    "brand_policy_revision",
    "budget_reservation",
    "output_profile_revision",
    "quality_gate_decision",
  ]),
  id: z.string().min(1),
}).strict();

const InternalEventBaseSchema = z.object({
  contract_version: z.literal("1.0"),
  message_id: z.string().min(1),
  event_id: EventIdSchema,
  occurred_at: UtcTimestampSchema,
  trace_id: z.string().min(1),
  correlation_id: z.string().min(1),
  causation_id: z.string().min(1).optional(),
  idempotency_key: IdempotencyKeySchema,
  producer: z.string().min(1),
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema.optional(),
  aggregate: AggregateSchema,
  version: z.literal(1),
});

const PublicWorkspaceEventBaseSchema = z.object({
  event_id: EventIdSchema,
  occurred_at: UtcTimestampSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema.optional(),
  aggregate: AggregateSchema,
  version: z.literal(1),
}).strict();

export const AssetUploadConfirmedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("asset.upload.confirmed"),
  data: z.object({
    asset_id: AssetIdSchema,
    project_id: ProjectIdSchema,
    kind: AssetKindSchema,
    sha256: Sha256Schema,
  }),
});

export const ShotUpdatedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("shot.updated"),
  data: z.object({
    shot_id: ShotIdSchema,
    status: z.string().min(1),
    revision: z.number().int().positive(),
  }),
});

export const TaskRunQueuedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.queued"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    kind: TaskRunKindSchema,
    input_snapshot: JsonObjectSchema,
  }),
});

export const InternalTaskRunQueueMessageSchema = z.object({
  contract_version: z.literal("1.0"),
  event_id: EventIdSchema,
  workspace_id: WorkspaceIdSchema,
  task_run_id: TaskRunIdSchema,
  attempt_no: z.number().int().positive(),
  correlation_id: z.string().min(1),
  input_snapshot: JsonObjectSchema,
}).strict();

export const InternalDocumentConversionQueueMessageSchema = z.object({
  contract_version: z.literal("1.0"),
  event_id: EventIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  conversion_id: DocumentConversionIdSchema,
  source_asset_id: AssetIdSchema,
  correlation_id: z.string().min(1),
}).strict();

export const InternalDocumentKnowledgeQueueMessageSchema = z.object({
  contract_version: z.literal("1.0"),
  event_id: EventIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
  conversion_id: DocumentConversionIdSchema,
  correlation_id: z.string().min(1),
}).strict();

export const InternalCreativePlanningQueueMessageSchema = z.object({
  contract_version: z.literal("1.0"),
  event_id: EventIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  creative_brief_revision_id: CreativeBriefRevisionIdSchema,
  correlation_id: z.string().min(1),
}).strict();

export const InternalProductionQueueMessageSchema = z.discriminatedUnion("event_type", [
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("production_run.confirmed"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    production_run_id: ProductionRunIdSchema,
    correlation_id: z.string().min(1),
  }).strict(),
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("task_run.succeeded"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    task_run_id: TaskRunIdSchema,
    correlation_id: z.string().min(1),
  }).strict(),
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("task_run.failed"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    task_run_id: TaskRunIdSchema,
    correlation_id: z.string().min(1),
  }).strict(),
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("handoff_asset.accepted"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    production_run_id: ProductionRunIdSchema,
    correlation_id: z.string().min(1),
  }).strict(),
]);

export const InternalMediaRuntimeQueueMessageSchema = z.discriminatedUnion("event_type", [
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("narration_audio.generation_requested"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    generation_kind: NarrationAudioGenerationKindSchema,
    section_id: z.string().min(1).max(160),
    asset_id: AssetIdSchema,
    narration_asset_version_id: NarrationAssetVersionIdSchema.optional(),
    sample_asset_id: AssetIdSchema.optional(),
    provider: NarrationAudioProviderSchema,
    voice_id: z.string().min(1).max(160),
    provider_settings: NarrationAudioProviderSettingsSchema,
    canonical_script_hash: Sha256Schema,
    object_key: z.string().min(1).max(1024),
    correlation_id: z.string().min(1),
  }).strict(),
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("production_segment.qc_requested"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    production_run_id: ProductionRunIdSchema,
    production_segment_id: ProductionSegmentIdSchema,
    task_run_id: TaskRunIdSchema,
    correlation_id: z.string().min(1),
  }).strict(),
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("video_version.composition_requested"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    production_run_id: ProductionRunIdSchema,
    correlation_id: z.string().min(1),
  }).strict(),
  z.object({
    contract_version: z.literal("1.0"),
    event_type: z.literal("handoff_review.requested"),
    event_id: EventIdSchema,
    workspace_id: WorkspaceIdSchema,
    project_id: ProjectIdSchema,
    production_run_id: ProductionRunIdSchema,
    handoff_review_id: HandoffReviewIdSchema,
    from_sequence: z.number().int().positive(),
    to_sequence: z.number().int().positive(),
    correlation_id: z.string().min(1),
  }).strict(),
]);

export const TaskRunStartedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.started"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    attempt_no: z.number().int().positive(),
  }),
});

export const ProviderAttemptSubmittedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("provider_attempt.submitted"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    provider_attempt_id: ProviderAttemptIdSchema,
    provider_request_id: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
});

export const TaskRunProgressedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.progressed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    status: TaskRunStatusSchema,
    progress: z.number().min(0).max(100),
    message: z.string().min(1),
  }),
});

export const TaskRunSucceededEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.succeeded"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    result_asset_id: AssetIdSchema,
    sha256: Sha256Schema,
  }),
});

export const TaskRunFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.failed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    error_code: z.string().min(1),
    retryable: z.boolean(),
    provider_attempt_id: ProviderAttemptIdSchema.optional(),
  }),
});

export const UsageDebitedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("usage.debited"),
  data: z.object({
    usage_record_id: UsageRecordIdSchema,
    task_run_id: TaskRunIdSchema,
    amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
    source: z.string().min(1),
    replayed: z.boolean(),
  }),
});

export const DocumentConversionQueuedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_conversion.queued"),
  data: z.object({
    conversion_id: DocumentConversionIdSchema,
    document_id: DocumentIdSchema,
    source_asset_id: AssetIdSchema,
  }).strict(),
});

export const DocumentConversionStartedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_conversion.started"),
  data: z.object({ conversion_id: DocumentConversionIdSchema, source_asset_id: AssetIdSchema }).strict(),
});

export const DocumentConversionSucceededEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_conversion.succeeded"),
  data: z.object({ conversion_id: DocumentConversionIdSchema, source_asset_id: AssetIdSchema, markdown_asset_id: AssetIdSchema }).strict(),
});

export const DocumentConversionFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_conversion.failed"),
  data: z.object({ conversion_id: DocumentConversionIdSchema, source_asset_id: AssetIdSchema, retryable: z.boolean() }).strict(),
});

export const CreativeBriefPlanningRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("creative_brief.planning_requested"),
  data: z.object({ creative_brief_revision_id: CreativeBriefRevisionIdSchema }).strict(),
});

export const CreativeBriefPlanningFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("creative_brief.planning_failed"),
  data: z.object({
    creative_brief_revision_id: CreativeBriefRevisionIdSchema,
    error_code: z.string().min(1).max(128),
  }).strict(),
});

export const StoryboardRevisionReadyForReviewEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("storyboard_revision.ready_for_review"),
  data: z.object({
    storyboard_revision_id: StoryboardRevisionIdSchema,
    shot_count: z.number().int().positive(),
    total_duration_seconds: z.number().int().positive(),
    continuity_level: ContinuityLevelSchema,
  }).strict(),
});

export const StoryboardRevisionApprovedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("storyboard_revision.approved"),
  data: z.object({ storyboard_revision_id: StoryboardRevisionIdSchema }).strict(),
});

export const ProductionRunConfirmedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("production_run.confirmed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    storyboard_revision_id: StoryboardRevisionIdSchema,
    // Optional for recovery of confirmation events written before the plan gate.
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema.optional(),
    total_shot_count: z.number().int().positive(),
  }).strict(),
});

export const ProductionRunProgressedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("production_run.progressed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    status: ProductionRunStatusSchema,
    accepted_shot_count: z.number().int().nonnegative(),
    total_shot_count: z.number().int().positive(),
    current_sequence: z.number().int().positive().nullable(),
    continuity_status: ContinuityStatusSchema.optional(),
    max_auto_repair_count: z.number().int().min(0).max(20).optional(),
    auto_repair_count: z.number().int().nonnegative().optional(),
  }).strict(),
});

export const ProductionRunBlockedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("production_run.blocked"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    sequence: z.number().int().positive(),
    reason_code: z.enum(["DEPENDENCY_PENDING", "SEGMENT_NEEDS_ATTENTION", "REFERENCE_POLICY_UNSATISFIED"]),
    retryable: z.boolean(),
  }).strict(),
});

export const ProductionSegmentQcRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("production_segment.qc_requested"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    production_segment_id: ProductionSegmentIdSchema,
    task_run_id: TaskRunIdSchema,
  }).strict(),
});

export const HandoffAssetAcceptedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("handoff_asset.accepted"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    sequence: z.number().int().positive(),
    handoff_asset_id: AssetIdSchema,
    asset_derivation_id: AssetDerivationIdSchema,
    qc_report_id: QcReportIdSchema,
  }).strict(),
});

export const QcReportCompletedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("qc_report.completed"),
  data: z.object({
    qc_report_id: QcReportIdSchema,
    subject_type: z.enum(["PRODUCTION_SEGMENT", "VIDEO_VERSION"]),
    subject_id: z.string().min(1),
    status: QcStatusSchema,
  }).strict(),
});

export const VideoVersionSucceededEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("video_version.succeeded"),
  data: z.object({
    video_version_id: VideoVersionIdSchema,
    production_run_id: ProductionRunIdSchema,
    asset_id: AssetIdSchema,
    duration_ms: z.number().int().positive(),
    qc_report_id: QcReportIdSchema,
  }).strict(),
});

export const VideoVersionCompositionRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("video_version.composition_requested"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
  }).strict(),
});

export const VideoVersionFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("video_version.failed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    error_code: z.enum(["MEDIA_RUNTIME_UNAVAILABLE", "MEDIA_RENDER_FAILED", "QC_FAILED"]),
    retryable: z.boolean(),
  }).strict(),
});

export const DocumentKnowledgeQueuedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_knowledge.queued"),
  data: z.object({
    knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
    conversion_id: DocumentConversionIdSchema,
    document_id: DocumentIdSchema,
  }).strict(),
});

export const DocumentKnowledgeStartedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_knowledge.started"),
  data: z.object({
    knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
    conversion_id: DocumentConversionIdSchema,
  }).strict(),
});

export const DocumentKnowledgeSucceededEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_knowledge.succeeded"),
  data: z.object({
    knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
    conversion_id: DocumentConversionIdSchema,
    analysis_quality: DocumentKnowledgeAnalysisQualitySchema,
  }).strict(),
});

export const DocumentKnowledgeFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("document_knowledge.failed"),
  data: z.object({
    knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
    conversion_id: DocumentConversionIdSchema,
    error_code: z.enum(["DOCUMENT_KNOWLEDGE_INVALID", "DOCUMENT_RUNTIME_UNAVAILABLE", "DOCUMENT_OUTPUT_INVALID"]),
    retryable: z.boolean(),
  }).strict(),
});

export const DeliveryPlanPreflightRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("delivery_plan.preflight_requested"),
  data: z.object({
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    creative_brief_revision_id: CreativeBriefRevisionIdSchema,
    storyboard_revision_id: StoryboardRevisionIdSchema,
    status: PreflightRevisionStatusSchema,
  }).strict(),
});

export const DeliveryPlanBlockedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("delivery_plan.blocked"),
  data: z.object({
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.literal("PREFLIGHT_BLOCKED"),
    reason_codes: z.array(z.string().min(1).max(120)).min(1).max(20),
  }).strict(),
});

export const DeliveryPlanApprovedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("delivery_plan.approved"),
  data: z.object({
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.literal("APPROVED"),
  }).strict(),
});

export const NarrationScriptNormalizedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("narration_script.normalized"),
  data: z.object({
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.enum(["NORMALIZED", "NEEDS_DECISION"]),
    decision_reasons: z.array(z.string().min(1).max(240)).max(50),
  }).strict(),
});

export const NarrationScriptApprovedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("narration_script.approved"),
  data: z.object({
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    sample_asset_id: AssetIdSchema,
    canonical_script_hash: Sha256Schema,
    status: z.literal("APPROVED"),
  }).strict(),
});

/** Internal-only request; public event projection deliberately omits it. */
export const NarrationAudioGenerationRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("narration_audio.generation_requested"),
  project_id: ProjectIdSchema,
  data: z.object({
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    generation_kind: NarrationAudioGenerationKindSchema,
    section_id: z.string().min(1).max(160),
    asset_id: AssetIdSchema,
    narration_asset_version_id: NarrationAssetVersionIdSchema.optional(),
    sample_asset_id: AssetIdSchema.optional(),
    provider: NarrationAudioProviderSchema,
    voice_id: z.string().min(1).max(160),
    provider_settings: NarrationAudioProviderSettingsSchema,
    canonical_script_hash: Sha256Schema,
    object_key: z.string().min(1).max(1024),
  }).strict().superRefine((value, context) => {
    if (value.generation_kind === "FORMAL" && (!value.narration_asset_version_id || !value.sample_asset_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["narration_asset_version_id"], message: "Formal generation requires version and approved sample identities." });
    }
    if (value.generation_kind === "SAMPLE" && (value.narration_asset_version_id || value.sample_asset_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["generation_kind"], message: "Sample generation cannot carry formal asset identities." });
    }
  }),
});

export const NarrationAssetVersionReadyEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("narration_asset_version.ready"),
  data: z.object({
    narration_asset_version_id: NarrationAssetVersionIdSchema,
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    asset_id: AssetIdSchema,
    duration_ms: z.number().int().positive(),
    sample_approved: z.boolean(),
  }).strict(),
});

export const TimelinePlanCreatedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("timeline_plan.created"),
  data: z.object({
    timeline_plan_id: TimelinePlanIdSchema,
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.enum(["READY", "NEEDS_DECISION", "FAILED"]),
    effective_duration_ms: z.number().int().positive(),
  }).strict(),
});

export const HandoffReviewRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("handoff_review.requested"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    handoff_review_id: HandoffReviewIdSchema,
    from_sequence: z.number().int().positive(),
    to_sequence: z.number().int().positive(),
  }).strict(),
});

export const HandoffReviewCompletedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("handoff_review.completed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    handoff_review_id: HandoffReviewIdSchema,
    from_sequence: z.number().int().positive(),
    to_sequence: z.number().int().positive(),
    result: HandoffReviewResultSchema,
    reason_codes: z.array(HandoffReviewReasonCodeSchema).max(8),
    retryable: z.boolean(),
  }).strict(),
});

export const TransitionRepairRequestedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("transition_repair.requested"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    transition_repair_id: TransitionRepairIdSchema,
    boundary_sequence: z.number().int().positive(),
    strategy: TransitionRepairStrategySchema,
  }).strict(),
});

export const TransitionRepairSucceededEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("transition_repair.succeeded"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    transition_repair_id: TransitionRepairIdSchema,
    boundary_sequence: z.number().int().positive(),
    strategy: TransitionRepairStrategySchema,
  }).strict(),
});

export const TransitionRepairFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("transition_repair.failed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    transition_repair_id: TransitionRepairIdSchema,
    boundary_sequence: z.number().int().positive(),
    error_code: z.enum(["MEDIA_RUNTIME_UNAVAILABLE", "MEDIA_RENDER_FAILED", "QC_FAILED"]),
    retryable: z.boolean(),
  }).strict(),
});

export const InternalEventEnvelopeSchema = z.discriminatedUnion("event_type", [
  AssetUploadConfirmedEventSchema,
  ShotUpdatedEventSchema,
  TaskRunQueuedEventSchema,
  TaskRunStartedEventSchema,
  ProviderAttemptSubmittedEventSchema,
  TaskRunProgressedEventSchema,
  TaskRunSucceededEventSchema,
  TaskRunFailedEventSchema,
  UsageDebitedEventSchema,
  DocumentConversionQueuedEventSchema,
  DocumentConversionStartedEventSchema,
  DocumentConversionSucceededEventSchema,
  DocumentConversionFailedEventSchema,
  DocumentKnowledgeQueuedEventSchema,
  DocumentKnowledgeStartedEventSchema,
  DocumentKnowledgeSucceededEventSchema,
  DocumentKnowledgeFailedEventSchema,
  CreativeBriefPlanningRequestedEventSchema,
  CreativeBriefPlanningFailedEventSchema,
  StoryboardRevisionReadyForReviewEventSchema,
  StoryboardRevisionApprovedEventSchema,
  DeliveryPlanPreflightRequestedEventSchema,
  DeliveryPlanBlockedEventSchema,
  DeliveryPlanApprovedEventSchema,
  NarrationScriptNormalizedEventSchema,
  NarrationScriptApprovedEventSchema,
  NarrationAudioGenerationRequestedEventSchema,
  NarrationAssetVersionReadyEventSchema,
  TimelinePlanCreatedEventSchema,
  ProductionRunConfirmedEventSchema,
  ProductionRunProgressedEventSchema,
  ProductionRunBlockedEventSchema,
  ProductionSegmentQcRequestedEventSchema,
  HandoffAssetAcceptedEventSchema,
  QcReportCompletedEventSchema,
  VideoVersionCompositionRequestedEventSchema,
  VideoVersionSucceededEventSchema,
  VideoVersionFailedEventSchema,
  HandoffReviewRequestedEventSchema,
  HandoffReviewCompletedEventSchema,
  TransitionRepairRequestedEventSchema,
  TransitionRepairSucceededEventSchema,
  TransitionRepairFailedEventSchema,
]);

const PublicAssetUploadConfirmedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("asset.upload.confirmed"),
  data: z.object({
    asset_id: AssetIdSchema,
    project_id: ProjectIdSchema,
    kind: AssetKindSchema,
  }).strict(),
});

const PublicShotUpdatedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("shot.updated"),
  data: z.object({
    shot_id: ShotIdSchema,
    status: ShotStatusSchema,
    revision: z.number().int().positive(),
  }).strict(),
});

const PublicTaskRunQueuedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.queued"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    kind: TaskRunKindSchema,
  }).strict(),
});

const PublicTaskRunStartedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.started"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
  }).strict(),
});

const PublicTaskRunProgressedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.progressed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    status: PublicTaskRunStatusSchema,
    progress: z.number().min(0).max(100),
  }).strict(),
});

const PublicTaskRunSucceededEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.succeeded"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    result_asset_id: AssetIdSchema,
  }).strict(),
});

const PublicTaskRunFailedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.failed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    error_code: z.string().min(1),
    retryable: z.boolean(),
  }).strict(),
});

const PublicDocumentConversionEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.enum([
    "document_conversion.queued",
    "document_conversion.started",
    "document_conversion.succeeded",
    "document_conversion.failed",
  ]),
  data: z.object({
    conversion_id: DocumentConversionIdSchema,
    source_asset_id: AssetIdSchema,
    status: DocumentConversionStatusSchema,
    retryable: z.boolean(),
    markdown_asset_id: AssetIdSchema.nullable(),
  }).strict(),
});

const PublicCreativeBriefPlanningRequestedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("creative_brief.planning_requested"),
  data: z.object({
    creative_brief_revision_id: CreativeBriefRevisionIdSchema,
    status: z.literal("PLANNING"),
  }).strict(),
});

const PublicCreativeBriefPlanningFailedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("creative_brief.planning_failed"),
  data: z.object({
    creative_brief_revision_id: CreativeBriefRevisionIdSchema,
    status: z.literal("FAILED"),
    error_code: z.string().min(1).max(128),
  }).strict(),
});

const PublicStoryboardRevisionReadyForReviewEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("storyboard_revision.ready_for_review"),
  data: z.object({
    storyboard_revision_id: StoryboardRevisionIdSchema,
    status: z.literal("READY_FOR_REVIEW"),
    shot_count: z.number().int().positive(),
    total_duration_seconds: z.number().int().positive(),
    continuity_level: ContinuityLevelSchema,
  }).strict(),
});

const PublicStoryboardRevisionApprovedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("storyboard_revision.approved"),
  data: z.object({
    storyboard_revision_id: StoryboardRevisionIdSchema,
    status: z.literal("APPROVED"),
  }).strict(),
});

const PublicProductionRunConfirmedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("production_run.confirmed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    storyboard_revision_id: StoryboardRevisionIdSchema,
    // Historical public events remain parseable during the forward-only rollout.
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema.optional(),
    status: z.literal("CONFIRMED"),
    total_shot_count: z.number().int().positive(),
  }).strict(),
});

export const PublicDocumentKnowledgeEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.enum([
    "document_knowledge.queued",
    "document_knowledge.started",
    "document_knowledge.succeeded",
    "document_knowledge.failed",
  ]),
  data: z.object({
    knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
    conversion_id: DocumentConversionIdSchema,
    status: DocumentKnowledgeRevisionStatusSchema,
    retryable: z.boolean(),
    analysis_quality: DocumentKnowledgeAnalysisQualitySchema.nullable(),
  }).strict(),
});

const PublicDeliveryPlanPreflightRequestedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("delivery_plan.preflight_requested"),
  data: z.object({
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: PreflightRevisionStatusSchema,
  }).strict(),
});

const PublicDeliveryPlanBlockedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("delivery_plan.blocked"),
  data: z.object({
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.literal("PREFLIGHT_BLOCKED"),
    reason_codes: z.array(z.string().min(1).max(120)).min(1).max(20),
  }).strict(),
});

const PublicDeliveryPlanApprovedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("delivery_plan.approved"),
  data: z.object({
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.literal("APPROVED"),
  }).strict(),
});

const PublicNarrationScriptNormalizedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("narration_script.normalized"),
  data: z.object({
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    delivery_plan_revision_id: DeliveryPlanRevisionIdSchema,
    status: z.enum(["NORMALIZED", "NEEDS_DECISION"]),
    decision_reasons: z.array(z.string().min(1).max(240)).max(50),
  }).strict(),
});

const PublicNarrationScriptApprovedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("narration_script.approved"),
  data: z.object({
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    status: z.literal("APPROVED"),
  }).strict(),
});

const PublicNarrationAssetVersionReadyEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("narration_asset_version.ready"),
  data: z.object({
    narration_asset_version_id: NarrationAssetVersionIdSchema,
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    duration_ms: z.number().int().positive(),
    sample_approved: z.boolean(),
  }).strict(),
});

const PublicTimelinePlanCreatedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("timeline_plan.created"),
  data: z.object({
    timeline_plan_id: TimelinePlanIdSchema,
    narration_script_revision_id: NarrationScriptRevisionIdSchema,
    status: z.enum(["READY", "NEEDS_DECISION", "FAILED"]),
    effective_duration_ms: z.number().int().positive(),
  }).strict(),
});

const PublicProductionRunProgressedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("production_run.progressed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    status: ProductionRunStatusSchema,
    accepted_shot_count: z.number().int().nonnegative(),
    total_shot_count: z.number().int().positive(),
    current_sequence: z.number().int().positive().nullable(),
    continuity_status: ContinuityStatusSchema.optional(),
    max_auto_repair_count: z.number().int().min(0).max(20).optional(),
    auto_repair_count: z.number().int().nonnegative().optional(),
  }).strict(),
});

const PublicProductionRunBlockedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("production_run.blocked"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    sequence: z.number().int().positive(),
    reason_code: z.enum(["DEPENDENCY_PENDING", "SEGMENT_NEEDS_ATTENTION", "REFERENCE_POLICY_UNSATISFIED"]),
    retryable: z.boolean(),
  }).strict(),
});

const PublicQcReportCompletedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("qc_report.completed"),
  data: z.object({
    qc_report_id: QcReportIdSchema,
    subject_type: z.enum(["PRODUCTION_SEGMENT", "VIDEO_VERSION"]),
    subject_id: z.string().min(1),
    status: QcStatusSchema,
  }).strict(),
});

const PublicVideoVersionSucceededEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("video_version.succeeded"),
  data: z.object({
    video_version_id: VideoVersionIdSchema,
    production_run_id: ProductionRunIdSchema,
    asset_id: AssetIdSchema,
    duration_ms: z.number().int().positive(),
    qc_report_id: QcReportIdSchema,
  }).strict(),
});

const PublicVideoVersionFailedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("video_version.failed"),
  data: z.object({
    production_run_id: ProductionRunIdSchema,
    error_code: z.enum(["MEDIA_RUNTIME_UNAVAILABLE", "MEDIA_RENDER_FAILED", "QC_FAILED"]),
    retryable: z.boolean(),
  }).strict(),
});

export const PublicWorkspaceEventEnvelopeSchema = z.discriminatedUnion("event_type", [
  PublicAssetUploadConfirmedEventSchema,
  PublicShotUpdatedEventSchema,
  PublicTaskRunQueuedEventSchema,
  PublicTaskRunStartedEventSchema,
  PublicTaskRunProgressedEventSchema,
  PublicTaskRunSucceededEventSchema,
  PublicTaskRunFailedEventSchema,
  PublicDocumentConversionEventSchema,
  PublicDocumentKnowledgeEventSchema,
  PublicCreativeBriefPlanningRequestedEventSchema,
  PublicCreativeBriefPlanningFailedEventSchema,
  PublicStoryboardRevisionReadyForReviewEventSchema,
  PublicStoryboardRevisionApprovedEventSchema,
  PublicDeliveryPlanPreflightRequestedEventSchema,
  PublicDeliveryPlanBlockedEventSchema,
  PublicDeliveryPlanApprovedEventSchema,
  PublicNarrationScriptNormalizedEventSchema,
  PublicNarrationScriptApprovedEventSchema,
  PublicNarrationAssetVersionReadyEventSchema,
  PublicTimelinePlanCreatedEventSchema,
  PublicProductionRunConfirmedEventSchema,
  PublicProductionRunProgressedEventSchema,
  PublicProductionRunBlockedEventSchema,
  PublicQcReportCompletedEventSchema,
  PublicVideoVersionSucceededEventSchema,
  PublicVideoVersionFailedEventSchema,
]);

export const projectPublicWorkspaceEvent = (
  event: InternalEventEnvelope,
): PublicWorkspaceEventEnvelope | undefined => {
  const project = (value: unknown) => {
    const parsed = PublicWorkspaceEventEnvelopeSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };
  const base = {
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    workspace_id: event.workspace_id,
    ...(event.project_id === undefined ? {} : { project_id: event.project_id }),
    aggregate: event.aggregate,
    version: event.version,
  };

  switch (event.event_type) {
    case "asset.upload.confirmed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          asset_id: event.data.asset_id,
          project_id: event.data.project_id,
          kind: event.data.kind,
        },
      });
    case "shot.updated":
      return project({
        ...base,
        event_type: event.event_type,
        data: event.data,
      });
    case "task_run.queued":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          kind: event.data.kind,
        },
      });
    case "task_run.started":
      return project({
        ...base,
        event_type: event.event_type,
        data: { task_run_id: event.data.task_run_id },
      });
    case "task_run.progressed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          status: event.data.status === "PROVIDER_PROCESSING" ? "PROCESSING" : event.data.status,
          progress: event.data.progress,
        },
      });
    case "task_run.succeeded":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          result_asset_id: event.data.result_asset_id,
        },
      });
    case "task_run.failed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          error_code: event.data.error_code,
          retryable: event.data.retryable,
        },
      });
    case "document_conversion.queued":
      return project({ ...base, event_type: event.event_type, data: { conversion_id: event.data.conversion_id, source_asset_id: event.data.source_asset_id, status: "QUEUED", retryable: false, markdown_asset_id: null } });
    case "document_conversion.started":
      return project({ ...base, event_type: event.event_type, data: { conversion_id: event.data.conversion_id, source_asset_id: event.data.source_asset_id, status: "RUNNING", retryable: false, markdown_asset_id: null } });
    case "document_conversion.succeeded":
      return project({ ...base, event_type: event.event_type, data: { conversion_id: event.data.conversion_id, source_asset_id: event.data.source_asset_id, status: "SUCCEEDED", retryable: false, markdown_asset_id: event.data.markdown_asset_id } });
    case "document_conversion.failed":
      return project({ ...base, event_type: event.event_type, data: { conversion_id: event.data.conversion_id, source_asset_id: event.data.source_asset_id, status: "FAILED", retryable: event.data.retryable, markdown_asset_id: null } });
    case "document_knowledge.queued":
      return project({ ...base, event_type: event.event_type, data: { knowledge_revision_id: event.data.knowledge_revision_id, conversion_id: event.data.conversion_id, status: "QUEUED", retryable: false, analysis_quality: null } });
    case "document_knowledge.started":
      return project({ ...base, event_type: event.event_type, data: { knowledge_revision_id: event.data.knowledge_revision_id, conversion_id: event.data.conversion_id, status: "RUNNING", retryable: false, analysis_quality: null } });
    case "document_knowledge.succeeded":
      return project({ ...base, event_type: event.event_type, data: { knowledge_revision_id: event.data.knowledge_revision_id, conversion_id: event.data.conversion_id, status: "READY", retryable: false, analysis_quality: event.data.analysis_quality } });
    case "document_knowledge.failed":
      return project({ ...base, event_type: event.event_type, data: { knowledge_revision_id: event.data.knowledge_revision_id, conversion_id: event.data.conversion_id, status: "FAILED", retryable: event.data.retryable, analysis_quality: null } });
    case "creative_brief.planning_requested":
      return project({ ...base, event_type: event.event_type, data: { creative_brief_revision_id: event.data.creative_brief_revision_id, status: "PLANNING" } });
    case "creative_brief.planning_failed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          creative_brief_revision_id: event.data.creative_brief_revision_id,
          status: "FAILED",
          error_code: event.data.error_code,
        },
      });
    case "storyboard_revision.ready_for_review":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          storyboard_revision_id: event.data.storyboard_revision_id,
          status: "READY_FOR_REVIEW",
          shot_count: event.data.shot_count,
          total_duration_seconds: event.data.total_duration_seconds,
          continuity_level: event.data.continuity_level,
        },
      });
    case "storyboard_revision.approved":
      return project({ ...base, event_type: event.event_type, data: { storyboard_revision_id: event.data.storyboard_revision_id, status: "APPROVED" } });
    case "delivery_plan.preflight_requested":
      return project({ ...base, event_type: event.event_type, data: { delivery_plan_revision_id: event.data.delivery_plan_revision_id, status: event.data.status } });
    case "delivery_plan.blocked":
      return project({ ...base, event_type: event.event_type, data: { delivery_plan_revision_id: event.data.delivery_plan_revision_id, status: event.data.status, reason_codes: event.data.reason_codes } });
    case "delivery_plan.approved":
      return project({ ...base, event_type: event.event_type, data: { delivery_plan_revision_id: event.data.delivery_plan_revision_id, status: event.data.status } });
    case "narration_script.normalized":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          narration_script_revision_id: event.data.narration_script_revision_id,
          delivery_plan_revision_id: event.data.delivery_plan_revision_id,
          status: event.data.status,
          decision_reasons: event.data.decision_reasons,
        },
      });
    case "narration_script.approved":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          narration_script_revision_id: event.data.narration_script_revision_id,
          status: event.data.status,
        },
      });
    case "narration_audio.generation_requested":
      // Provider, voice, settings and object identity are internal queue facts.
      return undefined;
    case "narration_asset_version.ready":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          narration_asset_version_id: event.data.narration_asset_version_id,
          narration_script_revision_id: event.data.narration_script_revision_id,
          duration_ms: event.data.duration_ms,
          sample_approved: event.data.sample_approved,
        },
      });
    case "timeline_plan.created":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          timeline_plan_id: event.data.timeline_plan_id,
          narration_script_revision_id: event.data.narration_script_revision_id,
          status: event.data.status,
          effective_duration_ms: event.data.effective_duration_ms,
        },
      });
    case "production_run.confirmed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          production_run_id: event.data.production_run_id,
          storyboard_revision_id: event.data.storyboard_revision_id,
          ...(event.data.delivery_plan_revision_id ? { delivery_plan_revision_id: event.data.delivery_plan_revision_id } : {}),
          status: "CONFIRMED",
          total_shot_count: event.data.total_shot_count,
        },
      });
    case "production_run.progressed":
      return project({ ...base, event_type: event.event_type, data: event.data });
    case "production_run.blocked":
      return project({ ...base, event_type: event.event_type, data: event.data });
    case "qc_report.completed":
      return project({ ...base, event_type: event.event_type, data: event.data });
    case "video_version.succeeded":
      return project({ ...base, event_type: event.event_type, data: event.data });
    case "video_version.failed":
      return project({ ...base, event_type: event.event_type, data: event.data });
    case "handoff_review.requested":
    case "handoff_review.completed":
    case "transition_repair.requested":
    case "transition_repair.succeeded":
    case "transition_repair.failed":
    case "handoff_asset.accepted":
    case "production_segment.qc_requested":
    case "video_version.composition_requested":
    case "provider_attempt.submitted":
    case "usage.debited":
      return undefined;
  }
};

export type InternalEventEnvelope = z.infer<typeof InternalEventEnvelopeSchema>;
export type InternalTaskRunQueueMessage = z.infer<typeof InternalTaskRunQueueMessageSchema>;
export type InternalDocumentConversionQueueMessage = z.infer<typeof InternalDocumentConversionQueueMessageSchema>;
export type InternalDocumentKnowledgeQueueMessage = z.infer<typeof InternalDocumentKnowledgeQueueMessageSchema>;
export type InternalCreativePlanningQueueMessage = z.infer<typeof InternalCreativePlanningQueueMessageSchema>;
export type InternalProductionQueueMessage = z.infer<typeof InternalProductionQueueMessageSchema>;
export type InternalMediaRuntimeQueueMessage = z.infer<typeof InternalMediaRuntimeQueueMessageSchema>;
export type PublicWorkspaceEventEnvelope = z.infer<typeof PublicWorkspaceEventEnvelopeSchema>;
