import { z } from "zod";

import {
  AssetIdSchema,
  AssetDerivationIdSchema,
  CreativeBriefRevisionIdSchema,
  DocumentConversionIdSchema,
  DocumentIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  JsonObjectSchema,
  ProjectIdSchema,
  ProductionSegmentIdSchema,
  ProductionRunIdSchema,
  QcReportIdSchema,
  ProviderAttemptIdSchema,
  Sha256Schema,
  ShotIdSchema,
  StoryboardRevisionIdSchema,
  TaskRunIdSchema,
  UsageRecordIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
  VideoVersionIdSchema,
} from "./primitives.js";
import { ContinuityLevelSchema, ProductionRunStatusSchema } from "./creative-planning.js";
import { DocumentConversionStatusSchema } from "./documents.js";
import { ProductionSegmentStatusSchema, QcStatusSchema } from "./production.js";
import {
  AssetKindSchema,
  PublicTaskRunStatusSchema,
  ShotStatusSchema,
  TaskRunKindSchema,
  TaskRunStatusSchema,
} from "./resources.js";

const AggregateSchema = z.object({
  type: z.enum([
    "project",
    "shot",
    "task_run",
    "asset",
    "document",
    "document_conversion",
    "creative_brief_revision",
    "script_revision",
    "storyboard_revision",
    "production_run",
    "production_segment",
    "asset_derivation",
    "qc_report",
    "video_version",
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
  CreativeBriefPlanningRequestedEventSchema,
  CreativeBriefPlanningFailedEventSchema,
  StoryboardRevisionReadyForReviewEventSchema,
  StoryboardRevisionApprovedEventSchema,
  ProductionRunConfirmedEventSchema,
  ProductionRunProgressedEventSchema,
  ProductionRunBlockedEventSchema,
  ProductionSegmentQcRequestedEventSchema,
  HandoffAssetAcceptedEventSchema,
  QcReportCompletedEventSchema,
  VideoVersionCompositionRequestedEventSchema,
  VideoVersionSucceededEventSchema,
  VideoVersionFailedEventSchema,
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
    status: z.literal("CONFIRMED"),
    total_shot_count: z.number().int().positive(),
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
  PublicCreativeBriefPlanningRequestedEventSchema,
  PublicCreativeBriefPlanningFailedEventSchema,
  PublicStoryboardRevisionReadyForReviewEventSchema,
  PublicStoryboardRevisionApprovedEventSchema,
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
    case "production_run.confirmed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          production_run_id: event.data.production_run_id,
          storyboard_revision_id: event.data.storyboard_revision_id,
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
export type InternalCreativePlanningQueueMessage = z.infer<typeof InternalCreativePlanningQueueMessageSchema>;
export type InternalProductionQueueMessage = z.infer<typeof InternalProductionQueueMessageSchema>;
export type InternalMediaRuntimeQueueMessage = z.infer<typeof InternalMediaRuntimeQueueMessageSchema>;
export type PublicWorkspaceEventEnvelope = z.infer<typeof PublicWorkspaceEventEnvelopeSchema>;
