import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  InternalEventEnvelopeSchema,
  InternalMediaRuntimeQueueMessageSchema,
  InternalProductionQueueMessageSchema,
  VideoGenerationInputSnapshotSchema,
  type InternalEventEnvelope,
  type InternalMediaRuntimeQueueMessage,
  type InternalProductionQueueMessage,
  type VideoGenerationInputSnapshot,
  type VisualInputSnapshot,
  type ProductionRunStatus,
  type ProductionSegmentStatus,
  type QcStatus,
} from "@alchemy-video/contracts";
import {
  assertProductionRunTransition,
  assertProductionAcceptanceCount,
  assertProductionSegmentDependencies,
  assertProductionSegmentTransition,
  createPrefixedId,
} from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import type { OutboxRelayStore, PersistedOutboxEvent } from "./task-run-repository.js";
import {
  assets,
  assetDerivations,
  commandDeduplications,
  creativeBriefRevisions,
  eventConsumptions,
  outboxEvents,
  productionRuns,
  productionSegments,
  qcReports,
  promptPackages,
  referenceBindings,
  scriptRevisions,
  shots,
  storyboardRevisions,
  storyboardShotSpecs,
  taskRuns,
  videoVersions,
} from "./schema.js";

type QueryExecutor = Pick<PlatformDatabase, "select" | "insert" | "update" | "execute">;

export type ProductionTaskRunInput = Readonly<{
  prompt: string;
  duration: number;
  resolution: string;
  ratio: string;
  referenceAssetIds: string[];
  visualInput: VisualInputSnapshot;
  generationSegmentSequence: number;
  narrativeBeatSequences: number[];
}>;

export type ProductionTaskRunInputFactory = (input: ProductionTaskRunInput) => VideoGenerationInputSnapshot;

const productionEventTypes = ["production_run.confirmed", "task_run.succeeded", "task_run.failed", "handoff_asset.accepted"] as const;
type ProductionTriggerEvent = Extract<InternalEventEnvelope, { event_type: (typeof productionEventTypes)[number] }>;

const isProductionTriggerEvent = (event: InternalEventEnvelope): event is ProductionTriggerEvent =>
  productionEventTypes.includes(event.event_type as (typeof productionEventTypes)[number]);

const mediaRuntimeEventTypes = ["production_segment.qc_requested", "video_version.composition_requested"] as const;
type MediaRuntimeTriggerEvent = Extract<InternalEventEnvelope, { event_type: (typeof mediaRuntimeEventTypes)[number] }>;

const isMediaRuntimeTriggerEvent = (event: InternalEventEnvelope): event is MediaRuntimeTriggerEvent =>
  mediaRuntimeEventTypes.includes(event.event_type as (typeof mediaRuntimeEventTypes)[number]);

export type ControlProductionRunProgress = {
  productionRun: {
    id: string;
    workspaceId: string;
    projectId: string;
    storyboardRevisionId: string;
    status: ProductionRunStatus;
    totalShotCount: number;
    acceptedShotCount: number;
    totalSegmentCount: number;
    acceptedSegmentCount: number;
    totalDurationSeconds: number;
    createdAt: string;
    updatedAt: string;
  };
  segments: Array<{
    id: string;
    productionRunId: string;
    sequence: number;
    title: string;
    status: ProductionSegmentStatus;
    retryable: boolean;
    safeSummary: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ControlQcReport = {
  id: string;
  workspaceId: string;
  projectId: string;
  subjectType: "PRODUCTION_SEGMENT" | "VIDEO_VERSION";
  subjectId: string;
  kind: "TECHNICAL" | "COMPOSITION";
  status: QcStatus;
  safeSummary: string;
  createdAt: string;
};

// Public readers receive only completed, playable versions. Failed render facts remain on production progress.
export type ControlVideoVersion = {
  id: string;
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  storyboardRevisionId: string;
  assetId: string;
  status: "SUCCEEDED";
  durationMs: number;
  qcReport: ControlQcReport;
  createdAt: string;
};

export type ProductionEventClaim =
  | { kind: "CLAIMED"; event: ProductionTriggerEvent }
  | { kind: "DUPLICATE" | "BUSY" | "RETRY" };

export type MediaRuntimeEventClaim =
  | { kind: "CLAIMED"; event: MediaRuntimeTriggerEvent }
  | { kind: "DUPLICATE" | "BUSY" | "RETRY" };

export type ProductionSegmentQcInput = {
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  productionSegmentId: string;
  taskRunId: string;
  sourceAsset: {
    id: string;
    objectKey: string;
    sha256: string;
    byteSize: number;
    mimeType: string;
  };
};

export type ProductionCompositionInput = {
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  storyboardRevisionId: string;
  segments: Array<{
    sequence: number;
    taskRunId: string;
    sourceAsset: {
      id: string;
      objectKey: string;
      sha256: string;
      byteSize: number;
      mimeType: string;
    };
  }>;
};

export type MediaRuntimeFailureCode = "MEDIA_RUNTIME_UNAVAILABLE" | "MEDIA_RENDER_FAILED" | "QC_FAILED";

export type ProductionSegmentRetryExecution =
  | { kind: "NEW"; value: ControlProductionRunProgress; status: 202 }
  | { kind: "REPLAY"; value: ControlProductionRunProgress; status: 202 }
  | { kind: "CONFLICT" }
  | { kind: "NOT_FOUND" }
  | { kind: "STATE_INVALID" };

export type RetryProductionSegmentInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  productionRunId: string;
  sequence: number;
  event: {
    messageId: string;
    traceId: string;
    correlationId: string;
  };
};

export interface ProductionStore extends OutboxRelayStore {
  listProjectProductionProgress(workspaceId: string, projectId: string): Promise<ControlProductionRunProgress[]>;
  listProjectVideoVersions(workspaceId: string, projectId: string): Promise<ControlVideoVersion[]>;
  findProductionRunProgress(workspaceId: string, productionRunId: string): Promise<ControlProductionRunProgress | undefined>;
  retryProductionSegment(input: RetryProductionSegmentInput): Promise<ProductionSegmentRetryExecution>;
  claimProductionEvent(input: { message: InternalProductionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<ProductionEventClaim>;
  completeProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }): Promise<void>;
  releaseProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
  initializeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "production_run.confirmed" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  recordProductionTaskSucceeded(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  recordProductionTaskFailed(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.failed" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  resumeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "handoff_asset.accepted" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  claimMediaRuntimeEvent(input: { message: InternalMediaRuntimeQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<MediaRuntimeEventClaim>;
  completeMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }): Promise<void>;
  releaseMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
  findProductionSegmentQcInput(input: { event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }> }): Promise<ProductionSegmentQcInput | undefined>;
  findProductionCompositionInput(input: { event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> }): Promise<ProductionCompositionInput | undefined>;
  acceptProductionSegmentQc(input: {
    event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>;
    handoffAsset: { id: string; objectKey: string; sha256: string; byteSize: number; width: number; height: number };
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
  completeProductionComposition(input: {
    event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>;
    videoAsset: { id: string; objectKey: string; sha256: string; byteSize: number; durationMs: number };
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
  failMediaRuntimeEvent(input: {
    eventId: string;
    workspaceId: string;
    errorCode: MediaRuntimeFailureCode;
    retryable: boolean;
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
}

const timestamp = (value: Date | string) => new Date(value).toISOString();
const safeReason = (reason: string) => reason.replace(/[\r\n]+/g, " ").slice(0, 500);
const retryCommandScope = (scope: string, idempotencyKey: string) =>
  and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const serializeProductionRun = (value: typeof productionRuns.$inferSelect): ControlProductionRunProgress["productionRun"] => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  storyboardRevisionId: value.storyboardRevisionId,
  status: value.status,
  totalShotCount: value.totalShotCount,
  acceptedShotCount: value.acceptedShotCount,
  totalSegmentCount: value.totalShotCount,
  acceptedSegmentCount: value.acceptedShotCount,
  totalDurationSeconds: value.totalDurationSeconds,
  createdAt: timestamp(value.createdAt),
  updatedAt: timestamp(value.updatedAt),
});

const serializeSegment = (value: typeof productionSegments.$inferSelect): ControlProductionRunProgress["segments"][number] => ({
  id: value.id,
  productionRunId: value.productionRunId,
  sequence: value.sequence,
  title: value.title,
  status: value.status,
  retryable: value.retryable,
  safeSummary: value.safeSummary,
  createdAt: timestamp(value.createdAt),
  updatedAt: timestamp(value.updatedAt),
});

const serializeQcReport = (value: typeof qcReports.$inferSelect): ControlQcReport => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  subjectType: value.subjectType,
  subjectId: value.subjectId,
  kind: value.kind,
  status: value.status,
  safeSummary: value.safeSummary,
  createdAt: timestamp(value.createdAt),
});

const serializeVideoVersion = (value: typeof videoVersions.$inferSelect, qcReport: typeof qcReports.$inferSelect): ControlVideoVersion => {
  if (value.status !== "SUCCEEDED" || !value.assetId || !value.durationMs || !value.qcReportId) {
    throw new Error("Only completed video versions can be exposed to the public reader.");
  }
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    productionRunId: value.productionRunId,
    storyboardRevisionId: value.storyboardRevisionId,
    assetId: value.assetId,
    status: "SUCCEEDED",
    durationMs: value.durationMs,
    qcReport: serializeQcReport(qcReport),
    createdAt: timestamp(value.createdAt),
  };
};

const insertOutboxEvent = async (executor: QueryExecutor, event: InternalEventEnvelope) =>
  executor.insert(outboxEvents).values({
    id: event.event_id,
    workspaceId: event.workspace_id,
    projectId: event.project_id ?? null,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    eventType: event.event_type,
    payload: event,
    occurredAt: event.occurred_at,
  });

const lockProductionRun = (executor: QueryExecutor, workspaceId: string, productionRunId: string) =>
  executor.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${productionRunId}))`);

const lockProject = (executor: QueryExecutor, workspaceId: string, projectId: string) =>
  executor.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${projectId}))`);

type EventSource = Pick<InternalEventEnvelope, "message_id" | "trace_id" | "correlation_id" | "idempotency_key" | "workspace_id" | "project_id">;

const nextEventBase = (
  source: EventSource,
  now: Date,
  aggregate: InternalEventEnvelope["aggregate"],
  producer = "production-worker",
) => ({
  contract_version: "1.0" as const,
  message_id: createPrefixedId("msg"),
  event_id: createPrefixedId("evt"),
  occurred_at: timestamp(now),
  trace_id: source.trace_id,
  correlation_id: source.correlation_id,
  causation_id: source.message_id,
  idempotency_key: source.idempotency_key,
  producer,
  workspace_id: source.workspace_id,
  ...(source.project_id === undefined ? {} : { project_id: source.project_id }),
  aggregate,
  version: 1 as const,
});

const progressEvent = (source: EventSource, input: {
  now: Date;
  productionRun: typeof productionRuns.$inferSelect;
  currentSequence: number | null;
  producer?: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRun.id }, input.producer),
  event_type: "production_run.progressed",
  data: {
    production_run_id: input.productionRun.id,
    status: input.productionRun.status,
    accepted_shot_count: input.productionRun.acceptedShotCount,
    total_shot_count: input.productionRun.totalShotCount,
    current_sequence: input.currentSequence,
  },
});

const blockedEvent = (source: EventSource, input: {
  now: Date;
  productionRun: typeof productionRuns.$inferSelect;
  sequence: number;
  reasonCode: "DEPENDENCY_PENDING" | "SEGMENT_NEEDS_ATTENTION" | "REFERENCE_POLICY_UNSATISFIED";
  retryable: boolean;
  producer?: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRun.id }, input.producer),
  event_type: "production_run.blocked",
  data: {
    production_run_id: input.productionRun.id,
    sequence: input.sequence,
    reason_code: input.reasonCode,
    retryable: input.retryable,
  },
});

const queuedTaskEvent = (source: EventSource, input: {
  now: Date;
  taskRun: typeof taskRuns.$inferSelect;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "task_run", id: input.taskRun.id }),
  event_type: "task_run.queued",
  data: {
    task_run_id: input.taskRun.id,
    kind: input.taskRun.kind,
    input_snapshot: input.taskRun.inputSnapshot,
  },
});

const qcRequestedEvent = (source: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }>, input: {
  now: Date;
  segment: typeof productionSegments.$inferSelect;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_segment", id: input.segment.id }),
  event_type: "production_segment.qc_requested",
  data: {
    production_run_id: input.segment.productionRunId,
    production_segment_id: input.segment.id,
    task_run_id: input.segment.taskRunId,
  },
});

const qcCompletedEvent = (source: MediaRuntimeTriggerEvent, input: {
  now: Date;
  qcReportId: string;
  subjectType: "PRODUCTION_SEGMENT" | "VIDEO_VERSION";
  subjectId: string;
  status?: "PASS" | "FAILED";
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "qc_report", id: input.qcReportId }, "media-worker"),
  event_type: "qc_report.completed",
  data: {
    qc_report_id: input.qcReportId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    status: input.status ?? "PASS",
  },
});

const handoffAcceptedEvent = (source: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>, input: {
  now: Date;
  productionRunId: string;
  sequence: number;
  handoffAssetId: string;
  assetDerivationId: string;
  qcReportId: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "asset_derivation", id: input.assetDerivationId }, "media-worker"),
  event_type: "handoff_asset.accepted",
  data: {
    production_run_id: input.productionRunId,
    sequence: input.sequence,
    handoff_asset_id: input.handoffAssetId,
    asset_derivation_id: input.assetDerivationId,
    qc_report_id: input.qcReportId,
  },
});

const compositionRequestedEvent = (source: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>, input: {
  now: Date;
  productionRunId: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRunId }, "media-worker"),
  event_type: "video_version.composition_requested",
  data: {
    production_run_id: input.productionRunId,
  },
});

const videoVersionSucceededEvent = (source: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>, input: {
  now: Date;
  videoVersionId: string;
  productionRunId: string;
  assetId: string;
  durationMs: number;
  qcReportId: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "video_version", id: input.videoVersionId }, "media-worker"),
  event_type: "video_version.succeeded",
  data: {
    video_version_id: input.videoVersionId,
    production_run_id: input.productionRunId,
    asset_id: input.assetId,
    duration_ms: input.durationMs,
    qc_report_id: input.qcReportId,
  },
});

const videoVersionFailedEvent = (source: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>, input: {
  now: Date;
  productionRunId: string;
  errorCode: MediaRuntimeFailureCode;
  retryable: boolean;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRunId }, "media-worker"),
  event_type: "video_version.failed",
  data: {
    production_run_id: input.productionRunId,
    error_code: input.errorCode,
    retryable: input.retryable,
  },
});

const messageMatchesEvent = (message: InternalProductionQueueMessage, event: InternalEventEnvelope) => {
  if (event.event_id !== message.event_id
    || event.workspace_id !== message.workspace_id
    || event.project_id !== message.project_id
    || event.correlation_id !== message.correlation_id
    || event.event_type !== message.event_type) return false;
  if (message.event_type === "production_run.confirmed") {
    return event.event_type === "production_run.confirmed" && event.data.production_run_id === message.production_run_id;
  }
  if (message.event_type === "handoff_asset.accepted") {
    return event.event_type === "handoff_asset.accepted" && event.data.production_run_id === message.production_run_id;
  }
  return (event.event_type === "task_run.succeeded" || event.event_type === "task_run.failed")
    && event.data.task_run_id === message.task_run_id;
};

const mediaMessageMatchesEvent = (message: InternalMediaRuntimeQueueMessage, event: InternalEventEnvelope) => {
  if (event.event_id !== message.event_id
    || event.workspace_id !== message.workspace_id
    || event.project_id !== message.project_id
    || event.correlation_id !== message.correlation_id
    || event.event_type !== message.event_type) return false;
  if (message.event_type === "production_segment.qc_requested") {
    return event.event_type === "production_segment.qc_requested"
      && event.data.production_run_id === message.production_run_id
      && event.data.production_segment_id === message.production_segment_id
      && event.data.task_run_id === message.task_run_id;
  }
  return event.event_type === "video_version.composition_requested"
    && event.data.production_run_id === message.production_run_id;
};

const initialVisualInput = async (transaction: QueryExecutor, input: {
  workspaceId: string;
  projectId: string;
  productionRun: typeof productionRuns.$inferSelect;
  shotSpec: typeof storyboardShotSpecs.$inferSelect;
  sourceAssetIds: string[];
  dependencySegments: Array<typeof productionSegments.$inferSelect>;
}) => {
  if (input.shotSpec.referencePolicy === "TEXT_TRANSITION") {
    return { kind: "READY" as const, references: [] as Array<{ assetId: string; role: "STYLE" | "FIRST_FRAME"; position: number }>, visualInput: { mode: "TEXT" as const, references: [] as [] } };
  }
  const referenceIds = input.shotSpec.referencePolicy === "REFERENCE_SET"
    ? input.sourceAssetIds
    : input.dependencySegments
      .filter((segment) => input.shotSpec.dependsOnSequences.includes(segment.sequence))
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, 1)
      .map((segment) => segment.handoffAssetId)
      .filter((assetId): assetId is string => Boolean(assetId));
  if (referenceIds.length === 0 || referenceIds.length > 7) {
    return { kind: "WAITING" as const, reasonCode: "REFERENCE_POLICY_UNSATISFIED" as const, safeSummary: "等待可用的参考素材后继续制作。" };
  }
  const found = await transaction
    .select()
    .from(assets)
    .where(and(
      eq(assets.workspaceId, input.workspaceId),
      eq(assets.projectId, input.projectId),
      eq(assets.status, "READY"),
      eq(assets.kind, "IMAGE"),
      inArray(assets.id, referenceIds),
    ));
  if (found.length !== new Set(referenceIds).size || found.some((asset) => !asset.sha256 || !asset.mimeType || !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType))) {
    return { kind: "WAITING" as const, reasonCode: "REFERENCE_POLICY_UNSATISFIED" as const, safeSummary: "参考素材尚未满足本段制作条件。" };
  }
  const ordered = referenceIds.map((id) => found.find((asset) => asset.id === id)!);
  if (input.shotSpec.referencePolicy === "HANDOFF_FIRST_FRAME") {
    const asset = ordered[0]!;
    return {
      kind: "READY" as const,
      references: [{ assetId: asset.id, role: "FIRST_FRAME" as const, position: 0 }],
      visualInput: {
        mode: "FIRST_FRAME" as const,
        references: [{ asset_id: asset.id, sha256: asset.sha256!, mime_type: asset.mimeType as "image/jpeg" | "image/png" | "image/webp", position: 0 }] as [{
          asset_id: string;
          sha256: string;
          mime_type: "image/jpeg" | "image/png" | "image/webp";
          position: number;
        }],
      },
    };
  }
  return {
    kind: "READY" as const,
    references: ordered.map((asset, position) => ({ assetId: asset.id, role: "STYLE" as const, position })),
    visualInput: {
      mode: "REFERENCE_SET" as const,
      references: ordered.map((asset, position) => ({ asset_id: asset.id, sha256: asset.sha256!, mime_type: asset.mimeType as "image/jpeg" | "image/png" | "image/webp", position })),
    },
  };
};

const createDefaultProductionTaskRunInputSnapshot: ProductionTaskRunInputFactory = (input) =>
  VideoGenerationInputSnapshotSchema.parse({
    model: "mock-video-v1",
    prompt: input.prompt,
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio,
    reference_asset_ids: input.referenceAssetIds,
    visual_input: input.visualInput,
  });

export class DrizzleProductionRepository implements ProductionStore {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly createTaskRunInputSnapshot: ProductionTaskRunInputFactory = createDefaultProductionTaskRunInputSnapshot,
  ) {}

  async listProjectProductionProgress(workspaceId: string, projectId: string) {
    const runs = await this.db
      .select()
      .from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.projectId, projectId)))
      .orderBy(desc(productionRuns.createdAt));
    return Promise.all(runs.map((run) => this.findProductionRunProgress(workspaceId, run.id))).then((values) => values.filter((value): value is ControlProductionRunProgress => Boolean(value)));
  }

  async findProductionRunProgress(workspaceId: string, productionRunId: string) {
    const [run] = await this.db
      .select()
      .from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, productionRunId)))
      .limit(1);
    if (!run) return undefined;
    const segments = await this.db
      .select()
      .from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, run.id), eq(productionSegments.projectId, run.projectId)))
      .orderBy(asc(productionSegments.sequence));
    return { productionRun: serializeProductionRun(run), segments: segments.map(serializeSegment) };
  }

  async retryProductionSegment(input: RetryProductionSegmentInput): Promise<ProductionSegmentRetryExecution> {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .insert(commandDeduplications)
        .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
        .onConflictDoNothing()
        .returning({ scope: commandDeduplications.scope });
      if (!reservation) return this.replayProductionSegmentRetry(transaction, input);

      await lockProductionRun(transaction, input.workspaceId, input.productionRunId);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.id, input.productionRunId)))
        .limit(1);
      if (!run) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "NOT_FOUND" });
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.workspaceId),
          eq(productionSegments.projectId, run.projectId),
          eq(productionSegments.productionRunId, run.id),
          eq(productionSegments.sequence, input.sequence),
        ))
        .limit(1);
      if (!segment) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "NOT_FOUND" });
      if (run.status !== "BLOCKED" || segment.status !== "FAILED" || !segment.retryable || !segment.taskRunId || !segment.shotId) {
        return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });
      }

      const [previousTaskRun] = await transaction
        .select()
        .from(taskRuns)
        .where(and(eq(taskRuns.workspaceId, input.workspaceId), eq(taskRuns.projectId, run.projectId), eq(taskRuns.id, segment.taskRunId)))
        .limit(1);
      const [previousShot] = await transaction
        .select()
        .from(shots)
        .where(and(eq(shots.workspaceId, input.workspaceId), eq(shots.projectId, run.projectId), eq(shots.id, segment.shotId)))
        .limit(1);
      if (!previousTaskRun || !previousShot) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });

      const snapshot = VideoGenerationInputSnapshotSchema.safeParse(previousTaskRun.inputSnapshot);
      if (!snapshot.success) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });
      await lockProject(transaction, input.workspaceId, run.projectId);
      const [positionRow] = await transaction
        .select({ position: sql<number>`coalesce(max(${shots.position}), -1)` })
        .from(shots)
        .where(and(eq(shots.workspaceId, input.workspaceId), eq(shots.projectId, run.projectId)));
      const previousBindings = await transaction
        .select()
        .from(referenceBindings)
        .where(and(eq(referenceBindings.workspaceId, input.workspaceId), eq(referenceBindings.projectId, run.projectId), eq(referenceBindings.shotId, previousShot.id)))
        .orderBy(asc(referenceBindings.position));
      const shotId = createPrefixedId("sht");
      const taskRunId = createPrefixedId("tsk");
      const now = timestamp(new Date());
      await transaction.insert(shots).values({
        id: shotId,
        workspaceId: input.workspaceId,
        projectId: run.projectId,
        position: (positionRow?.position ?? -1) + 1,
        prompt: previousShot.prompt,
        model: previousShot.model,
        generationSettings: previousShot.generationSettings,
        status: "GENERATING",
        selectedAssetId: previousShot.selectedAssetId,
        createdAt: now,
        updatedAt: now,
      });
      if (previousBindings.length > 0) {
        await transaction.insert(referenceBindings).values(previousBindings.map((binding) => ({
          workspaceId: input.workspaceId,
          projectId: run.projectId,
          shotId,
          assetId: binding.assetId,
          role: binding.role,
          position: binding.position,
          createdAt: now,
        })));
      }
      const [taskRun] = await transaction.insert(taskRuns).values({
        id: taskRunId,
        workspaceId: input.workspaceId,
        projectId: run.projectId,
        shotId,
        kind: "VIDEO_GENERATION",
        status: "QUEUED",
        inputSnapshot: snapshot.data,
        createdAt: now,
        updatedAt: now,
      }).returning();

      assertProductionSegmentTransition(segment.status, "GENERATING");
      await transaction
        .update(productionSegments)
        .set({
          status: "GENERATING",
          retryable: false,
          safeSummary: "正在重新生成本段视频。",
          shotId,
          taskRunId,
          handoffAssetId: null,
          qcReportId: null,
          updatedAt: now,
        })
        .where(and(eq(productionSegments.workspaceId, input.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "FAILED")));
      assertProductionRunTransition(run.status, "GENERATING");
      const [running] = await transaction
        .update(productionRuns)
        .set({ status: "GENERATING", updatedAt: now })
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "BLOCKED")))
        .returning();
      if (!running) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });

      const source: EventSource = {
        message_id: input.event.messageId,
        trace_id: input.event.traceId,
        correlation_id: input.event.correlationId,
        idempotency_key: input.idempotencyKey,
        workspace_id: input.workspaceId,
        project_id: run.projectId,
      };
      await insertOutboxEvent(transaction, queuedTaskEvent(source, { now: new Date(now), taskRun }));
      await insertOutboxEvent(transaction, progressEvent(source, { now: new Date(now), productionRun: running, currentSequence: segment.sequence, producer: "control-api" }));
      const progress = await this.progressWithinTransaction(transaction, input.workspaceId, run.id);
      if (!progress) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "NOT_FOUND" });
      await this.storeProductionSegmentRetrySnapshot(transaction, input, run.id);
      return { kind: "NEW", value: progress, status: 202 };
    });
  }

  async listProjectVideoVersions(workspaceId: string, projectId: string) {
    const rows = await this.db
      .select({ version: videoVersions, qcReport: qcReports })
      .from(videoVersions)
      .innerJoin(qcReports, and(
        eq(qcReports.workspaceId, videoVersions.workspaceId),
        eq(qcReports.projectId, videoVersions.projectId),
        eq(qcReports.id, videoVersions.qcReportId),
      ))
      .where(and(
        eq(videoVersions.workspaceId, workspaceId),
        eq(videoVersions.projectId, projectId),
        eq(videoVersions.status, "SUCCEEDED"),
      ))
      .orderBy(desc(videoVersions.createdAt));
    return rows.map(({ version, qcReport }) => serializeVideoVersion(version, qcReport));
  }

  async initializeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "production_run.confirmed" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.event.workspace_id),
          eq(productionRuns.projectId, input.event.project_id!),
          eq(productionRuns.id, input.event.data.production_run_id),
        ))
        .limit(1);
      if (!run || run.storyboardRevisionId !== input.event.data.storyboard_revision_id || run.totalShotCount !== input.event.data.total_shot_count) return undefined;
      const existing = await transaction
        .select()
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, run.workspaceId), eq(productionSegments.productionRunId, run.id)))
        .orderBy(asc(productionSegments.sequence));
      if (existing.length === 0) {
        const specs = await transaction
          .select()
          .from(storyboardShotSpecs)
          .where(and(
            eq(storyboardShotSpecs.workspaceId, run.workspaceId),
            eq(storyboardShotSpecs.projectId, run.projectId),
            eq(storyboardShotSpecs.storyboardRevisionId, run.storyboardRevisionId),
          ))
          .orderBy(asc(storyboardShotSpecs.sequence));
        if (specs.length !== run.totalShotCount) return undefined;
        await transaction.insert(productionSegments).values(specs.map((spec) => ({
          id: createPrefixedId("psg"),
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          productionRunId: run.id,
          shotSpecId: spec.id,
          sequence: spec.sequence,
          title: spec.title,
          dependsOnSequences: spec.dependsOnSequences,
          status: "PENDING" as const,
          retryable: true,
          safeSummary: "等待制作准备。",
          createdAt: timestamp(input.now),
          updatedAt: timestamp(input.now),
        })));
      }
      const [current] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id)))
        .limit(1);
      if (!current) return undefined;
      let running = current;
      if (current.status === "CONFIRMED") {
        assertProductionRunTransition(current.status, "GENERATING");
        [running] = await transaction
          .update(productionRuns)
          .set({ status: "GENERATING", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, current.workspaceId), eq(productionRuns.id, current.id), eq(productionRuns.status, "CONFIRMED")))
          .returning();
        if (!running) return undefined;
        await insertOutboxEvent(transaction, progressEvent(input.event, { now: input.now, productionRun: running, currentSequence: null }));
      }
      await this.scheduleEligibleSegments(transaction, { source: input.event, productionRun: running, now: input.now });
      const segments = await transaction
        .select()
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, running.workspaceId), eq(productionSegments.productionRunId, running.id)))
        .orderBy(asc(productionSegments.sequence));
      return { productionRun: serializeProductionRun(running), segments: segments.map(serializeSegment) };
    });
  }

  async recordProductionTaskSucceeded(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.event.workspace_id),
          eq(productionSegments.projectId, input.event.project_id!),
          eq(productionSegments.taskRunId, input.event.data.task_run_id),
        ))
        .limit(1);
      if (!segment) return undefined;
      await lockProductionRun(transaction, segment.workspaceId, segment.productionRunId);
      if (segment.status === "GENERATING") {
        assertProductionSegmentTransition(segment.status, "CHECKING");
        const [checking] = await transaction
          .update(productionSegments)
          .set({ status: "CHECKING", safeSummary: "正在检查本段画面。", updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "GENERATING")))
          .returning();
        if (checking) await insertOutboxEvent(transaction, qcRequestedEvent(input.event, { now: input.now, segment: checking }));
      }
      return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
    });
  }

  async recordProductionTaskFailed(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.failed" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.event.workspace_id),
          eq(productionSegments.projectId, input.event.project_id!),
          eq(productionSegments.taskRunId, input.event.data.task_run_id),
        ))
        .limit(1);
      if (!segment) return undefined;
      await lockProductionRun(transaction, segment.workspaceId, segment.productionRunId);
      if (segment.status === "GENERATING" || segment.status === "CHECKING") {
        assertProductionSegmentTransition(segment.status, "FAILED");
        await transaction
          .update(productionSegments)
          .set({ status: "FAILED", retryable: input.event.data.retryable, safeSummary: "本段制作未完成，可调整后重试。", updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["GENERATING", "CHECKING"])));
      }
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, segment.workspaceId), eq(productionRuns.id, segment.productionRunId)))
        .limit(1);
      if (run && run.status === "GENERATING") {
        assertProductionRunTransition(run.status, "BLOCKED");
        const [blocked] = await transaction
          .update(productionRuns)
          .set({ status: "BLOCKED", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "GENERATING")))
          .returning();
        if (blocked) await insertOutboxEvent(transaction, blockedEvent(input.event, {
          now: input.now,
          productionRun: blocked,
          sequence: segment.sequence,
          reasonCode: "SEGMENT_NEEDS_ATTENTION",
          retryable: input.event.data.retryable,
        }));
      }
      return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
    });
  }

  async resumeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "handoff_asset.accepted" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [current] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.event.workspace_id),
          eq(productionRuns.projectId, input.event.project_id!),
          eq(productionRuns.id, input.event.data.production_run_id),
        ))
        .limit(1);
      if (!current) return undefined;
      let running = current;
      if (current.status === "BLOCKED") {
        assertProductionRunTransition(current.status, "GENERATING");
        [running] = await transaction
          .update(productionRuns)
          .set({ status: "GENERATING", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, current.workspaceId), eq(productionRuns.id, current.id), eq(productionRuns.status, "BLOCKED")))
          .returning();
        if (!running) return undefined;
      }
      if (running.status !== "GENERATING") return this.progressWithinTransaction(transaction, running.workspaceId, running.id);
      await this.scheduleEligibleSegments(transaction, { source: input.event, productionRun: running, now: input.now });
      return this.progressWithinTransaction(transaction, running.workspaceId, running.id);
    });
  }

  async findProductionSegmentQcInput(input: { event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }> }) {
    const [segment] = await this.db
      .select()
      .from(productionSegments)
      .where(and(
        eq(productionSegments.workspaceId, input.event.workspace_id),
        eq(productionSegments.projectId, input.event.project_id!),
        eq(productionSegments.productionRunId, input.event.data.production_run_id),
        eq(productionSegments.id, input.event.data.production_segment_id),
        eq(productionSegments.taskRunId, input.event.data.task_run_id),
      ))
      .limit(1);
    if (!segment || segment.status !== "CHECKING") return undefined;
    const [taskRun] = await this.db
      .select()
      .from(taskRuns)
      .where(and(
        eq(taskRuns.workspaceId, segment.workspaceId),
        eq(taskRuns.projectId, segment.projectId),
        eq(taskRuns.id, input.event.data.task_run_id),
      ))
      .limit(1);
    if (!taskRun || taskRun.status !== "SUCCEEDED" || !taskRun.resultAssetId) return undefined;
    const [sourceAsset] = await this.db
      .select()
      .from(assets)
      .where(and(
        eq(assets.workspaceId, segment.workspaceId),
        eq(assets.projectId, segment.projectId),
        eq(assets.id, taskRun.resultAssetId),
      ))
      .limit(1);
    if (!sourceAsset
      || sourceAsset.status !== "READY"
      || sourceAsset.kind !== "VIDEO"
      || sourceAsset.mimeType !== "video/mp4"
      || !sourceAsset.sha256
      || !sourceAsset.byteSize
      || sourceAsset.byteSize < 1) return undefined;
    return {
      workspaceId: segment.workspaceId,
      projectId: segment.projectId,
      productionRunId: segment.productionRunId,
      productionSegmentId: segment.id,
      taskRunId: taskRun.id,
      sourceAsset: {
        id: sourceAsset.id,
        objectKey: sourceAsset.objectKey,
        sha256: sourceAsset.sha256,
        byteSize: sourceAsset.byteSize,
        mimeType: sourceAsset.mimeType,
      },
    } satisfies ProductionSegmentQcInput;
  }

  async findProductionCompositionInput(input: { event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> }) {
    const [run] = await this.db
      .select()
      .from(productionRuns)
      .where(and(
        eq(productionRuns.workspaceId, input.event.workspace_id),
        eq(productionRuns.projectId, input.event.project_id!),
        eq(productionRuns.id, input.event.data.production_run_id),
      ))
      .limit(1);
    if (!run || run.status !== "REVIEWING" || run.acceptedShotCount !== run.totalShotCount) return undefined;
    const segments = await this.db
      .select()
      .from(productionSegments)
      .where(and(
        eq(productionSegments.workspaceId, run.workspaceId),
        eq(productionSegments.projectId, run.projectId),
        eq(productionSegments.productionRunId, run.id),
        eq(productionSegments.status, "ACCEPTED"),
      ))
      .orderBy(asc(productionSegments.sequence));
    if (segments.length !== run.totalShotCount) return undefined;
    const assembled: ProductionCompositionInput["segments"] = [];
    for (const segment of segments) {
      if (!segment.taskRunId) return undefined;
      const [taskRun] = await this.db
        .select()
        .from(taskRuns)
        .where(and(
          eq(taskRuns.workspaceId, run.workspaceId),
          eq(taskRuns.projectId, run.projectId),
          eq(taskRuns.id, segment.taskRunId),
        ))
        .limit(1);
      if (!taskRun || taskRun.status !== "SUCCEEDED" || !taskRun.resultAssetId) return undefined;
      const [sourceAsset] = await this.db
        .select()
        .from(assets)
        .where(and(
          eq(assets.workspaceId, run.workspaceId),
          eq(assets.projectId, run.projectId),
          eq(assets.id, taskRun.resultAssetId),
        ))
        .limit(1);
      if (!sourceAsset
        || sourceAsset.status !== "READY"
        || sourceAsset.kind !== "VIDEO"
        || sourceAsset.mimeType !== "video/mp4"
        || !sourceAsset.sha256
        || !sourceAsset.byteSize
        || sourceAsset.byteSize < 1) return undefined;
      assembled.push({
        sequence: segment.sequence,
        taskRunId: taskRun.id,
        sourceAsset: {
          id: sourceAsset.id,
          objectKey: sourceAsset.objectKey,
          sha256: sourceAsset.sha256,
          byteSize: sourceAsset.byteSize,
          mimeType: sourceAsset.mimeType,
        },
      });
    }
    return {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      productionRunId: run.id,
      storyboardRevisionId: run.storyboardRevisionId,
      segments: assembled,
    } satisfies ProductionCompositionInput;
  }

  async acceptProductionSegmentQc(input: {
    event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>;
    handoffAsset: { id: string; objectKey: string; sha256: string; byteSize: number; width: number; height: number };
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.event.workspace_id),
          eq(productionSegments.projectId, input.event.project_id!),
          eq(productionSegments.productionRunId, input.event.data.production_run_id),
          eq(productionSegments.id, input.event.data.production_segment_id),
          eq(productionSegments.taskRunId, input.event.data.task_run_id),
        ))
        .limit(1);
      if (!segment || segment.status !== "CHECKING") return this.progressWithinTransaction(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, segment.workspaceId), eq(productionRuns.id, segment.productionRunId)))
        .limit(1);
      if (!run) return undefined;
      const [taskRun] = await transaction
        .select()
        .from(taskRuns)
        .where(and(eq(taskRuns.workspaceId, segment.workspaceId), eq(taskRuns.projectId, segment.projectId), eq(taskRuns.id, input.event.data.task_run_id)))
        .limit(1);
      if (!taskRun || taskRun.status !== "SUCCEEDED" || !taskRun.resultAssetId) return undefined;
      const [sourceAsset] = await transaction
        .select()
        .from(assets)
        .where(and(eq(assets.workspaceId, segment.workspaceId), eq(assets.projectId, segment.projectId), eq(assets.id, taskRun.resultAssetId)))
        .limit(1);
      if (!sourceAsset || sourceAsset.status !== "READY" || sourceAsset.kind !== "VIDEO") return undefined;

      const qcReportId = createPrefixedId("qcr");
      const assetDerivationId = createPrefixedId("drv");
      await transaction.insert(qcReports).values({
        id: qcReportId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        subjectType: "PRODUCTION_SEGMENT",
        subjectId: segment.id,
        kind: "TECHNICAL",
        status: "PASS",
        safeSummary: "本段画面检查通过。",
        createdAt: timestamp(input.now),
      });
      await transaction.insert(assets).values({
        id: input.handoffAsset.id,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        kind: "IMAGE",
        origin: "DERIVED",
        status: "READY",
        objectKey: input.handoffAsset.objectKey,
        sha256: input.handoffAsset.sha256,
        mimeType: "image/png",
        byteSize: input.handoffAsset.byteSize,
        width: input.handoffAsset.width,
        height: input.handoffAsset.height,
        durationMs: null,
        metadata: { purpose: "handoff_frame" },
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      });
      await transaction.insert(assetDerivations).values({
        id: assetDerivationId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        derivationType: "HANDOFF_FRAME",
        sourceAssetId: sourceAsset.id,
        sourceTaskRunId: taskRun.id,
        derivedAssetId: input.handoffAsset.id,
        qcReportId,
        createdAt: timestamp(input.now),
      });
      assertProductionSegmentTransition(segment.status, "ACCEPTED");
      const [acceptedSegment] = await transaction
        .update(productionSegments)
        .set({
          status: "ACCEPTED",
          retryable: false,
          safeSummary: "本段已检查完成。",
          handoffAssetId: input.handoffAsset.id,
          qcReportId,
          updatedAt: timestamp(input.now),
        })
        .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "CHECKING")))
        .returning();
      if (!acceptedSegment) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
      assertProductionAcceptanceCount({ acceptedShotCount: run.acceptedShotCount + 1, totalShotCount: run.totalShotCount });
      const [acceptedRun] = await transaction
        .update(productionRuns)
        .set({ acceptedShotCount: run.acceptedShotCount + 1, updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.acceptedShotCount, run.acceptedShotCount)))
        .returning();
      if (!acceptedRun) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
      let currentRun = acceptedRun;
      const allAccepted = acceptedRun.acceptedShotCount === acceptedRun.totalShotCount;
      if (allAccepted && (acceptedRun.status === "GENERATING" || acceptedRun.status === "BLOCKED")) {
        assertProductionRunTransition(acceptedRun.status, "REVIEWING");
        const [reviewing] = await transaction
          .update(productionRuns)
          .set({ status: "REVIEWING", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, acceptedRun.workspaceId), eq(productionRuns.id, acceptedRun.id), eq(productionRuns.status, acceptedRun.status)))
          .returning();
        if (!reviewing) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
        currentRun = reviewing;
      }
      await insertOutboxEvent(transaction, qcCompletedEvent(input.event, { now: input.now, qcReportId, subjectType: "PRODUCTION_SEGMENT", subjectId: acceptedSegment.id }));
      await insertOutboxEvent(transaction, handoffAcceptedEvent(input.event, {
        now: input.now,
        productionRunId: acceptedSegment.productionRunId,
        sequence: acceptedSegment.sequence,
        handoffAssetId: input.handoffAsset.id,
        assetDerivationId,
        qcReportId,
      }));
      if (allAccepted && currentRun.status === "REVIEWING") {
        await insertOutboxEvent(transaction, compositionRequestedEvent(input.event, { now: input.now, productionRunId: currentRun.id }));
      }
      await insertOutboxEvent(transaction, progressEvent(input.event, { now: input.now, productionRun: currentRun, currentSequence: acceptedSegment.sequence }));
      return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
    });
  }

  async completeProductionComposition(input: {
    event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>;
    videoAsset: { id: string; objectKey: string; sha256: string; byteSize: number; durationMs: number };
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.event.workspace_id),
          eq(productionRuns.projectId, input.event.project_id!),
          eq(productionRuns.id, input.event.data.production_run_id),
        ))
        .limit(1);
      if (!run || run.status !== "REVIEWING" || run.acceptedShotCount !== run.totalShotCount) return this.progressWithinTransaction(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const segments = await transaction
        .select({ id: productionSegments.id })
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, run.workspaceId), eq(productionSegments.productionRunId, run.id), eq(productionSegments.status, "ACCEPTED")));
      if (segments.length !== run.totalShotCount) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      assertProductionRunTransition(run.status, "RENDERING");
      const [rendering] = await transaction
        .update(productionRuns)
        .set({ status: "RENDERING", updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "REVIEWING")))
        .returning();
      if (!rendering) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      const qcReportId = createPrefixedId("qcr");
      const videoVersionId = createPrefixedId("vvr");
      await transaction.insert(qcReports).values({
        id: qcReportId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        subjectType: "VIDEO_VERSION",
        subjectId: videoVersionId,
        kind: "COMPOSITION",
        status: "PASS",
        safeSummary: "成片检查通过。",
        createdAt: timestamp(input.now),
      });
      await transaction.insert(assets).values({
        id: input.videoAsset.id,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        kind: "VIDEO",
        origin: "DERIVED",
        status: "READY",
        objectKey: input.videoAsset.objectKey,
        sha256: input.videoAsset.sha256,
        mimeType: "video/mp4",
        byteSize: input.videoAsset.byteSize,
        durationMs: input.videoAsset.durationMs,
        metadata: { purpose: "composed_video" },
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      });
      await transaction.insert(videoVersions).values({
        id: videoVersionId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        productionRunId: run.id,
        storyboardRevisionId: run.storyboardRevisionId,
        status: "SUCCEEDED",
        assetId: input.videoAsset.id,
        durationMs: input.videoAsset.durationMs,
        qcReportId,
        createdAt: timestamp(input.now),
      });
      assertProductionRunTransition(rendering.status, "SUCCEEDED");
      const [succeeded] = await transaction
        .update(productionRuns)
        .set({ status: "SUCCEEDED", updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, rendering.workspaceId), eq(productionRuns.id, rendering.id), eq(productionRuns.status, "RENDERING")))
        .returning();
      if (!succeeded) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      await insertOutboxEvent(transaction, qcCompletedEvent(input.event, { now: input.now, qcReportId, subjectType: "VIDEO_VERSION", subjectId: videoVersionId }));
      await insertOutboxEvent(transaction, videoVersionSucceededEvent(input.event, {
        now: input.now,
        videoVersionId,
        productionRunId: succeeded.id,
        assetId: input.videoAsset.id,
        durationMs: input.videoAsset.durationMs,
        qcReportId,
      }));
      await insertOutboxEvent(transaction, progressEvent(input.event, { now: input.now, productionRun: succeeded, currentSequence: null }));
      return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
    });
  }

  async failMediaRuntimeEvent(input: {
    eventId: string;
    workspaceId: string;
    errorCode: MediaRuntimeFailureCode;
    retryable: boolean;
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId)))
        .limit(1);
      const parsed = outbox ? InternalEventEnvelopeSchema.safeParse(outbox.payload) : undefined;
      if (!parsed?.success || !isMediaRuntimeTriggerEvent(parsed.data) || parsed.data.workspace_id !== input.workspaceId) return undefined;
      const event = parsed.data;
      const projectId = event.project_id;
      if (!projectId) return undefined;
      await lockProductionRun(transaction, event.workspace_id, event.data.production_run_id);
      if (event.event_type === "production_segment.qc_requested") {
        const [segment] = await transaction
          .select()
          .from(productionSegments)
          .where(and(
            eq(productionSegments.workspaceId, event.workspace_id),
            eq(productionSegments.projectId, projectId),
            eq(productionSegments.productionRunId, event.data.production_run_id),
            eq(productionSegments.id, event.data.production_segment_id),
            eq(productionSegments.taskRunId, event.data.task_run_id),
          ))
          .limit(1);
        if (!segment || segment.status !== "CHECKING") return this.progressWithinTransaction(transaction, event.workspace_id, event.data.production_run_id);
        const [run] = await transaction
          .select()
          .from(productionRuns)
          .where(and(eq(productionRuns.workspaceId, segment.workspaceId), eq(productionRuns.id, segment.productionRunId)))
          .limit(1);
        if (!run) return undefined;
        const qcReportId = createPrefixedId("qcr");
        await transaction.insert(qcReports).values({
          id: qcReportId,
          workspaceId: segment.workspaceId,
          projectId: segment.projectId,
          subjectType: "PRODUCTION_SEGMENT",
          subjectId: segment.id,
          kind: "TECHNICAL",
          status: "FAILED",
          safeSummary: "本段画面检查未通过。",
          createdAt: timestamp(input.now),
        });
        assertProductionSegmentTransition(segment.status, "FAILED");
        const [failedSegment] = await transaction
          .update(productionSegments)
          .set({ status: "FAILED", retryable: input.retryable, safeSummary: "本段检查未完成，可调整后重试。", qcReportId, updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "CHECKING")))
          .returning();
        if (!failedSegment) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
        let currentRun = run;
        if (run.status === "GENERATING") {
          assertProductionRunTransition(run.status, "BLOCKED");
          const [blocked] = await transaction
            .update(productionRuns)
            .set({ status: "BLOCKED", updatedAt: timestamp(input.now) })
            .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "GENERATING")))
            .returning();
          if (!blocked) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
          currentRun = blocked;
          await insertOutboxEvent(transaction, blockedEvent(event, {
            now: input.now,
            productionRun: blocked,
            sequence: failedSegment.sequence,
            reasonCode: "SEGMENT_NEEDS_ATTENTION",
            retryable: input.retryable,
            producer: "media-worker",
          }));
        }
        await insertOutboxEvent(transaction, qcCompletedEvent(event, {
          now: input.now,
          qcReportId,
          subjectType: "PRODUCTION_SEGMENT",
          subjectId: failedSegment.id,
          status: "FAILED",
        }));
        await insertOutboxEvent(transaction, progressEvent(event, {
          now: input.now,
          productionRun: currentRun,
          currentSequence: failedSegment.sequence,
          producer: "media-worker",
        }));
        return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
      }

      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, event.workspace_id),
          eq(productionRuns.projectId, projectId),
          eq(productionRuns.id, event.data.production_run_id),
        ))
        .limit(1);
      if (!run || run.status !== "REVIEWING") return this.progressWithinTransaction(transaction, event.workspace_id, event.data.production_run_id);
      const videoVersionId = createPrefixedId("vvr");
      const qcReportId = createPrefixedId("qcr");
      await transaction.insert(qcReports).values({
        id: qcReportId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        subjectType: "VIDEO_VERSION",
        subjectId: videoVersionId,
        kind: "COMPOSITION",
        status: "FAILED",
        safeSummary: "成片合成未完成。",
        createdAt: timestamp(input.now),
      });
      await transaction.insert(videoVersions).values({
        id: videoVersionId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        productionRunId: run.id,
        storyboardRevisionId: run.storyboardRevisionId,
        status: "FAILED",
        assetId: null,
        durationMs: null,
        qcReportId: null,
        createdAt: timestamp(input.now),
      });
      assertProductionRunTransition(run.status, "FAILED");
      const [failedRun] = await transaction
        .update(productionRuns)
        .set({ status: "FAILED", updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "REVIEWING")))
        .returning();
      if (!failedRun) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      await insertOutboxEvent(transaction, qcCompletedEvent(event, {
        now: input.now,
        qcReportId,
        subjectType: "VIDEO_VERSION",
        subjectId: videoVersionId,
        status: "FAILED",
      }));
      await insertOutboxEvent(transaction, videoVersionFailedEvent(event, {
        now: input.now,
        productionRunId: failedRun.id,
        errorCode: input.errorCode,
        retryable: input.retryable,
      }));
      await insertOutboxEvent(transaction, progressEvent(event, {
        now: input.now,
        productionRun: failedRun,
        currentSequence: null,
        producer: "media-worker",
      }));
      return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
    });
  }

  async claimProductionEvent(input: { message: InternalProductionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<ProductionEventClaim> {
    return this.db.transaction(async (transaction) => {
      const message = InternalProductionQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id)))
        .limit(1);
      if (!outbox) return { kind: "RETRY" };
      const event = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!event.success || !isProductionTriggerEvent(event.data) || !messageMatchesEvent(message, event.data)) return { kind: "RETRY" };

      const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      const [inserted] = await transaction
        .insert(eventConsumptions)
        .values({ workspaceId: message.workspace_id, eventId: message.event_id, consumerName: input.consumerName, leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: 1 })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await transaction
          .select()
          .from(eventConsumptions)
          .where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName)))
          .limit(1);
        if (!existing || existing.completedAt || existing.deadLetteredAt) return { kind: "DUPLICATE" };
        const [reclaimed] = await transaction
          .update(eventConsumptions)
          .set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: timestamp(input.now) })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            isNull(eventConsumptions.completedAt),
            isNull(eventConsumptions.deadLetteredAt),
            or(eq(eventConsumptions.leaseOwner, input.workerId), isNull(eventConsumptions.leaseExpiresAt), lte(eventConsumptions.leaseExpiresAt, timestamp(input.now))),
          ))
          .returning();
        if (!reclaimed) return { kind: "BUSY" };
      }
      return { kind: "CLAIMED", event: event.data };
    });
  }

  async claimMediaRuntimeEvent(input: { message: InternalMediaRuntimeQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<MediaRuntimeEventClaim> {
    return this.db.transaction(async (transaction) => {
      const message = InternalMediaRuntimeQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id)))
        .limit(1);
      if (!outbox) return { kind: "RETRY" };
      const event = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!event.success || !isMediaRuntimeTriggerEvent(event.data) || !mediaMessageMatchesEvent(message, event.data)) return { kind: "RETRY" };

      const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      const [inserted] = await transaction
        .insert(eventConsumptions)
        .values({ workspaceId: message.workspace_id, eventId: message.event_id, consumerName: input.consumerName, leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: 1 })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await transaction
          .select()
          .from(eventConsumptions)
          .where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName)))
          .limit(1);
        if (!existing || existing.completedAt || existing.deadLetteredAt) return { kind: "DUPLICATE" };
        const [reclaimed] = await transaction
          .update(eventConsumptions)
          .set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: timestamp(input.now) })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            isNull(eventConsumptions.completedAt),
            isNull(eventConsumptions.deadLetteredAt),
            or(eq(eventConsumptions.leaseOwner, input.workerId), isNull(eventConsumptions.leaseExpiresAt), lte(eventConsumptions.leaseExpiresAt, timestamp(input.now))),
          ))
          .returning();
        if (!reclaimed) return { kind: "BUSY" };
      }
      return { kind: "CLAIMED", event: event.data };
    });
  }

  async completeMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }) {
    await this.completeProductionEvent(input);
  }

  async releaseMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    await this.releaseProductionEvent(input);
  }

  async completeProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }) {
    await this.db
      .update(eventConsumptions)
      .set({ completedAt: timestamp(input.now), leaseOwner: null, leaseExpiresAt: null, updatedAt: timestamp(input.now) })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
  }

  async releaseProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    await this.db
      .update(eventConsumptions)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: safeReason(input.reason),
        ...(input.deadLetter ? { deadLetteredAt: timestamp(input.now) } : {}),
        updatedAt: timestamp(input.now),
      })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
  }

  async claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string; eventTypes?: readonly InternalEventEnvelope["event_type"][] }) {
    const now = timestamp(input.now);
    const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const workspaceCondition = input.workspaceId ? sql`and workspace_id = ${input.workspaceId}` : sql``;
    const eventTypeCondition = input.eventTypes?.length
      ? sql`and event_type in (${sql.join(input.eventTypes.map((eventType) => sql`${eventType}`), sql`, `)})`
      : sql``;
    const result = await this.db.execute(sql`
      with candidates as (
        select id
        from outbox_events
        where published_at is null
          and dead_lettered_at is null
          and available_at <= ${now}::timestamptz
          and (lease_expires_at is null or lease_expires_at <= ${now}::timestamptz)
          ${workspaceCondition}
          ${eventTypeCondition}
        order by available_at asc, id asc
        for update skip locked
        limit ${input.limit}
      )
      update outbox_events as event
      set lease_owner = ${input.relayId},
          lease_expires_at = ${expiresAt}::timestamptz,
          publish_attempts = event.publish_attempts + 1
      from candidates
      where event.id = candidates.id
      returning event.id, event.workspace_id, event.payload, event.publish_attempts
    `);
    const rows = (result as unknown as { rows: Array<{ id: string; workspace_id: string; payload: Record<string, unknown>; publish_attempts: number }> }).rows;
    return rows.flatMap((row) => {
      const event = InternalEventEnvelopeSchema.safeParse(row.payload);
      return event.success ? [{ id: row.id, workspaceId: row.workspace_id, event: event.data, publishAttempts: row.publish_attempts }] : [];
    });
  }

  async markOutboxPublished(input: { eventId: string; workspaceId: string; relayId: string; now: Date }) {
    await this.db.update(outboxEvents).set({ publishedAt: timestamp(input.now), leaseOwner: null, leaseExpiresAt: null, lastError: null })
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  async releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }) {
    const [current] = await this.db.select({ publishAttempts: outboxEvents.publishAttempts }).from(outboxEvents)
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId))).limit(1);
    if (!current) return;
    const deadLetteredAt = current.publishAttempts >= input.maxAttempts ? timestamp(input.now) : null;
    await this.db.update(outboxEvents).set({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: safeReason(input.reason),
      ...(deadLetteredAt ? { deadLetteredAt } : { availableAt: new Date(input.now.getTime() + input.retryDelayMs).toISOString() }),
    }).where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  private async replayProductionSegmentRetry(transaction: QueryExecutor, input: RetryProductionSegmentInput): Promise<ProductionSegmentRetryExecution> {
    const [existing] = await transaction
      .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
      .from(commandDeduplications)
      .where(retryCommandScope(input.scope, input.idempotencyKey))
      .limit(1);
    if (!existing || existing.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    const snapshot = existing.responseSnapshot as { kind?: unknown; productionRunId?: unknown };
    if (snapshot.kind === "PRODUCTION_SEGMENT_RETRY" && typeof snapshot.productionRunId === "string") {
      const value = await this.progressWithinTransaction(transaction, input.workspaceId, snapshot.productionRunId);
      return value ? { kind: "REPLAY", value, status: 202 } : { kind: "CONFLICT" };
    }
    if (snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID") return { kind: snapshot.kind };
    return { kind: "CONFLICT" };
  }

  private async storeProductionSegmentRetryOutcome(
    transaction: QueryExecutor,
    input: RetryProductionSegmentInput,
    outcome: { kind: "NOT_FOUND" } | { kind: "STATE_INVALID" },
  ) {
    await transaction
      .update(commandDeduplications)
      .set({ responseSnapshot: { kind: outcome.kind } })
      .where(retryCommandScope(input.scope, input.idempotencyKey));
    return outcome;
  }

  private async storeProductionSegmentRetrySnapshot(transaction: QueryExecutor, input: RetryProductionSegmentInput, productionRunId: string) {
    await transaction
      .update(commandDeduplications)
      .set({ responseSnapshot: { kind: "PRODUCTION_SEGMENT_RETRY", productionRunId } })
      .where(retryCommandScope(input.scope, input.idempotencyKey));
  }

  private async progressWithinTransaction(transaction: QueryExecutor, workspaceId: string, productionRunId: string) {
    const [run] = await transaction.select().from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, productionRunId))).limit(1);
    if (!run) return undefined;
    const segments = await transaction.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, productionRunId))).orderBy(asc(productionSegments.sequence));
    return { productionRun: serializeProductionRun(run), segments: segments.map(serializeSegment) };
  }

  private async scheduleEligibleSegments(transaction: QueryExecutor, input: { source: InternalEventEnvelope; productionRun: typeof productionRuns.$inferSelect; now: Date }) {
    const [storyboard] = await transaction.select().from(storyboardRevisions)
      .where(and(eq(storyboardRevisions.workspaceId, input.productionRun.workspaceId), eq(storyboardRevisions.projectId, input.productionRun.projectId), eq(storyboardRevisions.id, input.productionRun.storyboardRevisionId))).limit(1);
    if (!storyboard) return;
    const [script] = await transaction.select().from(scriptRevisions)
      .where(and(eq(scriptRevisions.workspaceId, input.productionRun.workspaceId), eq(scriptRevisions.projectId, input.productionRun.projectId), eq(scriptRevisions.id, storyboard.scriptRevisionId))).limit(1);
    const [brief] = script
      ? await transaction.select().from(creativeBriefRevisions).where(and(eq(creativeBriefRevisions.workspaceId, input.productionRun.workspaceId), eq(creativeBriefRevisions.projectId, input.productionRun.projectId), eq(creativeBriefRevisions.id, script.creativeBriefRevisionId))).limit(1)
      : [];
    if (!brief) return;
    const segments = await transaction.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, input.productionRun.workspaceId), eq(productionSegments.productionRunId, input.productionRun.id))).orderBy(asc(productionSegments.sequence));
    const acceptedSequences = segments.filter((segment) => segment.status === "ACCEPTED").map((segment) => segment.sequence);
    for (const segment of segments) {
      if (segment.status !== "PENDING" && segment.status !== "WAITING") continue;
      try {
        assertProductionSegmentDependencies({ sequence: segment.sequence, dependencySequences: segment.dependsOnSequences, acceptedSequences });
      } catch {
        if (segment.status === "PENDING") {
          assertProductionSegmentTransition(segment.status, "WAITING");
          await transaction.update(productionSegments).set({ status: "WAITING", safeSummary: "等待前一段完成检查。", updatedAt: timestamp(input.now) })
            .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "PENDING")));
        }
        continue;
      }
      const [spec] = await transaction.select().from(storyboardShotSpecs)
        .where(and(eq(storyboardShotSpecs.workspaceId, segment.workspaceId), eq(storyboardShotSpecs.projectId, segment.projectId), eq(storyboardShotSpecs.id, segment.shotSpecId))).limit(1);
      const [promptPackage] = spec
        ? await transaction.select().from(promptPackages).where(and(eq(promptPackages.workspaceId, segment.workspaceId), eq(promptPackages.projectId, segment.projectId), eq(promptPackages.shotSpecId, spec.id))).orderBy(desc(promptPackages.createdAt)).limit(1)
        : [];
      if (!spec || !promptPackage) {
        await transaction.update(productionSegments).set({ status: "WAITING", retryable: false, safeSummary: "本段制作资料尚未准备完成。", updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["PENDING", "WAITING"])));
        continue;
      }
      const visual = await initialVisualInput(transaction, {
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        productionRun: input.productionRun,
        shotSpec: spec,
        sourceAssetIds: brief.sourceAssetIds,
        dependencySegments: segments,
      });
      if (visual.kind === "WAITING") {
        await transaction.update(productionSegments).set({ status: "WAITING", safeSummary: visual.safeSummary, updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["PENDING", "WAITING"])));
        continue;
      }
      await lockProject(transaction, segment.workspaceId, segment.projectId);
      const [positionRow] = await transaction.select({ position: sql<number>`coalesce(max(${shots.position}), -1)` }).from(shots)
        .where(and(eq(shots.workspaceId, segment.workspaceId), eq(shots.projectId, segment.projectId)));
      const shotId = createPrefixedId("sht");
      const taskRunId = createPrefixedId("tsk");
      const snapshot = this.createTaskRunInputSnapshot({
        prompt: promptPackage.prompt,
        duration: spec.durationSeconds,
        resolution: brief.targetResolution,
        ratio: "16:9",
        referenceAssetIds: visual.references.map((reference) => reference.assetId),
        visualInput: visual.visualInput,
        generationSegmentSequence: segment.sequence,
        narrativeBeatSequences: spec.narrativeBeatSequences,
      });
      await transaction.insert(shots).values({
        id: shotId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        position: (positionRow?.position ?? -1) + 1,
        prompt: promptPackage.prompt,
        model: snapshot.model,
        generationSettings: { video_settings: { duration_seconds: snapshot.duration, resolution: snapshot.resolution, ratio: snapshot.ratio } },
        status: "GENERATING",
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      });
      if (visual.references.length > 0) {
        await transaction.insert(referenceBindings).values(visual.references.map((reference) => ({
          workspaceId: segment.workspaceId,
          projectId: segment.projectId,
          shotId,
          assetId: reference.assetId,
          role: reference.role,
          position: reference.position,
          createdAt: timestamp(input.now),
        })));
      }
      const [taskRun] = await transaction.insert(taskRuns).values({
        id: taskRunId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        shotId,
        kind: "VIDEO_GENERATION",
        status: "QUEUED",
        inputSnapshot: snapshot,
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      }).returning();
      assertProductionSegmentTransition(segment.status, "GENERATING");
      await transaction.update(productionSegments).set({
        status: "GENERATING",
        safeSummary: "正在生成本段视频。",
        shotId,
        taskRunId,
        updatedAt: timestamp(input.now),
      }).where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["PENDING", "WAITING"])));
      await insertOutboxEvent(transaction, queuedTaskEvent(input.source, { now: input.now, taskRun }));
      await insertOutboxEvent(transaction, progressEvent(input.source, { now: input.now, productionRun: input.productionRun, currentSequence: segment.sequence }));
    }
  }
}
