import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import {
  InternalEventEnvelopeSchema,
  InternalTaskRunQueueMessageSchema,
  TASK_RUN_TERMINAL_STATUSES,
  VideoGenerationInputSnapshotSchema,
  type InternalEventEnvelope,
  type InternalTaskRunQueueMessage,
  type TaskRunStatus,
  type VideoGenerationInputSnapshot,
} from "@alchemy-video/contracts";
import { assertTaskRunTransition, BILLING_RETRY_ERROR_CODES, createPrefixedId, fingerprintRequest, isBillingRetryErrorCode } from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import type { ControlAsset } from "./asset-workspace-repository.js";
import { assets, commandDeduplications, eventConsumptions, outboxEvents, providerAttempts, shots, taskRuns } from "./schema.js";
import { assetScope, shotScope, taskRunScope } from "./workspace-repositories.js";

export type ControlTaskRun = {
  id: string;
  workspaceId: string;
  projectId: string;
  shotId: string;
  kind: "VIDEO_GENERATION" | "DOCUMENT_CONVERSION" | "RENDER" | "QC";
  status: TaskRunStatus;
  inputSnapshot: Record<string, unknown>;
  resultAssetId: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  retryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskRunEventMetadata = {
  eventId: string;
  messageId: string;
  traceId: string;
  correlationId: string;
};

export type CreateTaskRunInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  taskRunId: string;
  shotId: string;
  kind: "VIDEO_GENERATION";
  inputSnapshot: VideoGenerationInputSnapshot;
  event: TaskRunEventMetadata;
};

export type RetryTaskRunInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  taskRunId: string;
  event: TaskRunEventMetadata;
};

export type TaskRunCommandExecution =
  | { kind: "NEW" | "REPLAY"; value: ControlTaskRun; status: 202 }
  | { kind: "CONFLICT" }
  | { kind: "NOT_FOUND"; status: 404 }
  | { kind: "INVALID_REFERENCE" }
  | { kind: "ACTIVE_CONFLICT" }
  | { kind: "STATE_INVALID" };

export type PersistedOutboxEvent = {
  id: string;
  workspaceId: string;
  event: InternalEventEnvelope;
  publishAttempts: number;
};

export interface OutboxRelayStore {
  claimOutboxEvents(input: {
    relayId: string;
    now: Date;
    leaseMs: number;
    limit: number;
    workspaceId?: string;
    eventTypes?: readonly InternalEventEnvelope["event_type"][];
  }): Promise<PersistedOutboxEvent[]>;
  markOutboxPublished(input: { eventId: string; workspaceId: string; relayId: string; now: Date }): Promise<void>;
  releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }): Promise<void>;
}

export type TaskRunEventResult = "PROCESSED" | "DUPLICATE" | "IGNORED" | "BUSY" | "RETRY";

export type TaskRunEventProcessingInput = {
  message: InternalTaskRunQueueMessage;
  consumerName: string;
  workerId: string;
  now: Date;
  leaseMs: number;
};

export type ControlProviderAttempt = {
  id: string;
  taskRunId: string;
  provider: string;
  model: string;
  providerRequestId: string | null;
  status: "CREATED" | "SUBMITTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "DOWNLOAD_FAILED" | "ABANDONED";
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedAssetDraft = {
  id: string;
  objectKey: string;
  taskRunId: string;
};

export interface TaskRunStore extends OutboxRelayStore {
  createTaskRun(input: CreateTaskRunInput): Promise<TaskRunCommandExecution>;
  retryTaskRun(input: RetryTaskRunInput): Promise<TaskRunCommandExecution>;
  findTaskRun(workspaceId: string, taskRunId: string): Promise<ControlTaskRun | undefined>;
  listProjectTaskRuns(workspaceId: string, projectId: string): Promise<ControlTaskRun[]>;
  listRecoverableVideoTaskRuns(input: { limit: number; statuses?: readonly TaskRunStatus[] }): Promise<ControlTaskRun[]>;
  findTaskRunResultAsset(workspaceId: string, assetId: string): Promise<ControlAsset | undefined>;
  findGeneratedAssetDraft(workspaceId: string, taskRunId: string): Promise<GeneratedAssetDraft | undefined>;
  listTaskRunAttempts(workspaceId: string, taskRunId: string): Promise<ControlProviderAttempt[]>;
  ensureProviderAttempt(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; provider: string; model: string; now: Date }): Promise<ControlProviderAttempt | undefined>;
  recordProviderSubmission(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; providerRequestId: string; now: Date }): Promise<ControlTaskRun | undefined>;
  recordProviderProcessing(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; now: Date }): Promise<ControlTaskRun | undefined>;
  beginDownload(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; now: Date }): Promise<ControlTaskRun | undefined>;
  recordDownloadRetryableFailure(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; code: string; now: Date }): Promise<void>;
  ensureGeneratedAsset(input: { workspaceId: string; taskRunId: string; assetId: string; objectKey: string; now: Date }): Promise<GeneratedAssetDraft | undefined>;
  completeGeneratedTaskRun(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; assetId: string; sha256: string; byteSize: number; width: number; height: number; durationMs: number; now: Date }): Promise<ControlTaskRun | undefined>;
  markBillingSucceeded(input: { workspaceId: string; taskRunId: string; usageRecordId: string; now: Date }): Promise<void>;
  markBillingFailed(input: { workspaceId: string; taskRunId: string; code: string; safeMessage: string; now: Date }): Promise<void>;
  scheduleBillingRetry(input: { workspaceId: string; taskRunId: string; code: string; safeMessage: string; retryAt: Date; now: Date }): Promise<void>;
  resumeBillingRetry(input: { workspaceId: string; taskRunId: string; now: Date }): Promise<ControlTaskRun | undefined>;
  finalizeTaskRunExecutionFailure(input: { workspaceId: string; taskRunId: string; code: string; message: string; now: Date }): Promise<ControlTaskRun | undefined>;
  failTaskRun(input: { workspaceId: string; taskRunId: string; providerAttemptId?: string; failureStage?: "PROVIDER" | "DOWNLOAD"; code: string; message: string; retryable: boolean; now: Date }): Promise<ControlTaskRun | undefined>;
  listWorkspaceEvents(input: { workspaceId: string; afterEventId?: string; limit: number }): Promise<InternalEventEnvelope[]>;
  processEvent(input: TaskRunEventProcessingInput): Promise<TaskRunEventResult>;
  releaseConsumerEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
}

type CommandSnapshot =
  | { kind: "TASK_RUN"; task_run: ControlTaskRun }
  | { kind: "NOT_FOUND"; status: 404 }
  | { kind: "INVALID_REFERENCE" }
  | { kind: "ACTIVE_CONFLICT" }
  | { kind: "STATE_INVALID" };

type QueryExecutor = Pick<PlatformDatabase, "select" | "insert" | "update" | "execute">;

const timestamp = (value: Date | string) => new Date(value).toISOString();
const terminalStatusSql = sql.raw(TASK_RUN_TERMINAL_STATUSES.map((status) => `'${status}'`).join(", "));

const commandScope = (scope: string, idempotencyKey: string) =>
  and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const isTaskRunSnapshot = (snapshot: Record<string, unknown>): snapshot is Extract<CommandSnapshot, { kind: "TASK_RUN" }> =>
  snapshot.kind === "TASK_RUN" && typeof snapshot.task_run === "object" && snapshot.task_run !== null;

const toControlTaskRun = (value: typeof taskRuns.$inferSelect): ControlTaskRun => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  shotId: value.shotId,
  kind: value.kind,
  status: value.status,
  inputSnapshot: value.inputSnapshot,
  resultAssetId: value.resultAssetId,
  error: value.error as ControlTaskRun["error"],
  retryAt: value.retryAt,
  createdAt: timestamp(value.createdAt),
  updatedAt: timestamp(value.updatedAt),
});

const toControlProviderAttempt = (value: typeof providerAttempts.$inferSelect): ControlProviderAttempt => ({
  id: value.id,
  taskRunId: value.taskRunId,
  provider: value.provider,
  model: value.model,
  providerRequestId: value.providerRequestId,
  status: value.status,
  requestPayload: value.requestPayload,
  responsePayload: value.responsePayload,
  createdAt: timestamp(value.createdAt),
  updatedAt: timestamp(value.updatedAt),
});

const sanitizeReason = (reason: string) => reason.replace(/[\r\n]+/g, " ").slice(0, 500);
const afterEvent = (sourceOccurredAt: string, now: Date) =>
  new Date(Math.max(now.getTime(), new Date(sourceOccurredAt).getTime() + 1)).toISOString();

const queuedEvent = (input: {
  event: TaskRunEventMetadata;
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  taskRun: ControlTaskRun;
  occurredAt: string;
  producer: string;
}) =>
  InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: input.event.messageId,
    event_id: input.event.eventId,
    event_type: "task_run.queued",
    occurred_at: input.occurredAt,
    trace_id: input.event.traceId,
    correlation_id: input.event.correlationId,
    idempotency_key: input.idempotencyKey,
    producer: input.producer,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    aggregate: { type: "task_run", id: input.taskRun.id },
    version: 1,
    data: {
      task_run_id: input.taskRun.id,
      kind: input.taskRun.kind,
      input_snapshot: input.taskRun.inputSnapshot,
    },
  });

const startedEvent = (input: { source: Extract<InternalEventEnvelope, { event_type: "task_run.queued" }>; attemptNo: number; occurredAt: string }) =>
  InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: createPrefixedId("msg"),
    event_id: createPrefixedId("evt"),
    event_type: "task_run.started",
    occurred_at: input.occurredAt,
    trace_id: input.source.trace_id,
    correlation_id: input.source.correlation_id,
    causation_id: input.source.message_id,
    idempotency_key: input.source.idempotency_key,
    producer: "task-worker",
    workspace_id: input.source.workspace_id,
    ...(input.source.project_id === undefined ? {} : { project_id: input.source.project_id }),
    aggregate: input.source.aggregate,
    version: 1,
    data: { task_run_id: input.source.data.task_run_id, attempt_no: input.attemptNo },
  });

type QueuedTaskRunEvent = Extract<InternalEventEnvelope, { event_type: "task_run.queued" }>;

const executionEvent = (
  source: QueuedTaskRunEvent,
  input:
    | { type: "provider_attempt.submitted"; now: string; taskRunId: string; providerAttemptId: string; providerRequestId: string; provider: string; model: string }
    | { type: "task_run.progressed"; now: string; taskRunId: string; status: TaskRunStatus; progress: number; message: string }
    | { type: "task_run.succeeded"; now: string; taskRunId: string; resultAssetId: string; sha256: string }
    | { type: "task_run.failed"; now: string; taskRunId: string; errorCode: string; retryable: boolean; providerAttemptId?: string },
) => InternalEventEnvelopeSchema.parse({
  contract_version: "1.0",
  message_id: createPrefixedId("msg"),
  event_id: createPrefixedId("evt"),
  event_type: input.type,
  occurred_at: input.now,
  trace_id: source.trace_id,
  correlation_id: source.correlation_id,
  causation_id: source.message_id,
  idempotency_key: source.idempotency_key,
  producer: "provider-worker",
  workspace_id: source.workspace_id,
  ...(source.project_id === undefined ? {} : { project_id: source.project_id }),
  aggregate: source.aggregate,
  version: 1,
  data: input.type === "provider_attempt.submitted"
    ? { task_run_id: input.taskRunId, provider_attempt_id: input.providerAttemptId, provider_request_id: input.providerRequestId, provider: input.provider, model: input.model }
    : input.type === "task_run.progressed"
      ? { task_run_id: input.taskRunId, status: input.status, progress: input.progress, message: input.message }
      : input.type === "task_run.succeeded"
        ? { task_run_id: input.taskRunId, result_asset_id: input.resultAssetId, sha256: input.sha256 }
        : { task_run_id: input.taskRunId, error_code: input.errorCode, retryable: input.retryable, ...(input.providerAttemptId ? { provider_attempt_id: input.providerAttemptId } : {}) },
});

const insertOutboxEvent = async (
  transaction: QueryExecutor,
  event: InternalEventEnvelope,
) =>
  transaction.insert(outboxEvents).values({
    id: event.event_id,
    workspaceId: event.workspace_id,
    projectId: event.project_id ?? null,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    eventType: event.event_type,
    payload: event,
    occurredAt: event.occurred_at,
  });

const queuedSourceForTaskRun = async (executor: QueryExecutor, workspaceId: string, taskRunId: string): Promise<QueuedTaskRunEvent | undefined> => {
  const rows = await executor
    .select({ payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.aggregateType, "task_run"), eq(outboxEvents.aggregateId, taskRunId)));
  return rows
    .map((row) => InternalEventEnvelopeSchema.safeParse(row.payload))
    .find((parsed): parsed is { success: true; data: QueuedTaskRunEvent } => parsed.success && parsed.data.event_type === "task_run.queued")?.data;
};

const lockTaskRun = (executor: QueryExecutor, workspaceId: string, taskRunId: string) =>
  executor.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${taskRunId}))`);

export class DrizzleTaskRunRepository implements TaskRunStore {
  constructor(private readonly db: PlatformDatabase) {}

  async createTaskRun(input: CreateTaskRunInput): Promise<TaskRunCommandExecution> {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .insert(commandDeduplications)
        .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
        .onConflictDoNothing()
        .returning({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot });

      if (!reservation) return this.replayCommand(transaction, input.scope, input.idempotencyKey, input.requestHash);

      const [shot] = await transaction.select().from(shots).where(shotScope(input.workspaceId, input.shotId)).limit(1);
      if (!shot) return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "NOT_FOUND", status: 404 });

      const referenceIds = [...new Set(input.inputSnapshot.reference_asset_ids)];
      if (referenceIds.length > 0) {
        const found = await transaction
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.projectId, shot.projectId), eq(assets.status, "READY"), inArray(assets.id, referenceIds)));
        if (found.length !== referenceIds.length) {
          return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "INVALID_REFERENCE" });
        }
      }

      const [active] = await transaction
        .select({ id: taskRuns.id })
        .from(taskRuns)
        .where(and(eq(taskRuns.workspaceId, input.workspaceId), eq(taskRuns.shotId, input.shotId), sql`${taskRuns.status} not in (${terminalStatusSql})`))
        .limit(1);
      if (active) return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "ACTIVE_CONFLICT" });
      if (!["READY", "GENERATED", "FAILED"].includes(shot.status)) {
        return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "STATE_INVALID" });
      }

      const now = new Date().toISOString();
      let created: typeof taskRuns.$inferSelect | undefined;
      try {
        [created] = await transaction
          .insert(taskRuns)
          .values({
            id: input.taskRunId,
            workspaceId: input.workspaceId,
            projectId: shot.projectId,
            shotId: shot.id,
            kind: input.kind,
            status: "QUEUED",
            inputSnapshot: input.inputSnapshot,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      } catch (error) {
        if (this.isActiveTaskRunViolation(error)) {
          return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "ACTIVE_CONFLICT" });
        }
        throw error;
      }

      const taskRun = toControlTaskRun(created!);
      await transaction
        .update(shots)
        .set({ status: "GENERATING", revision: shot.revision + 1, updatedAt: now })
        .where(shotScope(input.workspaceId, shot.id));
      const event = queuedEvent({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        projectId: shot.projectId,
        taskRun,
        occurredAt: now,
        producer: "control-api",
      });
      await insertOutboxEvent(transaction, event);
      await this.storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "TASK_RUN", task_run: taskRun });
      return { kind: "NEW", value: taskRun, status: 202 };
    });
  }

  async retryTaskRun(input: RetryTaskRunInput): Promise<TaskRunCommandExecution> {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .insert(commandDeduplications)
        .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
        .onConflictDoNothing()
        .returning({ requestHash: commandDeduplications.requestHash });
      if (!reservation) return this.replayCommand(transaction, input.scope, input.idempotencyKey, input.requestHash);

      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current) return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "NOT_FOUND", status: 404 });
      if (current.status === "BILLING_FAILED") {
        const parsed = VideoGenerationInputSnapshotSchema.safeParse(current.inputSnapshot);
        if (!parsed.success || !parsed.data.billing) {
          return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "STATE_INVALID" });
        }
        assertTaskRunTransition(current.status, "BILLING_PENDING");
        const now = new Date().toISOString();
        const [retried] = await transaction
          .update(taskRuns)
          .set({ status: "BILLING_PENDING", error: null, retryAt: null, updatedAt: now })
          .where(taskRunScope(input.workspaceId, input.taskRunId))
          .returning();
        if (!retried) return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "STATE_INVALID" });
        const taskRun = toControlTaskRun(retried);
        const event = queuedEvent({
          event: input.event,
          idempotencyKey: input.idempotencyKey,
          workspaceId: input.workspaceId,
          projectId: taskRun.projectId,
          taskRun,
          occurredAt: now,
          producer: "control-api",
        });
        await insertOutboxEvent(transaction, event);
        await this.storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "TASK_RUN", task_run: taskRun });
        return { kind: "NEW", value: taskRun, status: 202 };
      }
      if (current.status !== "FAILED") {
        return this.storeCommandOutcome(transaction, input.scope, input.idempotencyKey, { kind: "STATE_INVALID" });
      }

      assertTaskRunTransition(current.status, "QUEUED");
      const now = new Date().toISOString();
      const [retried] = await transaction
        .update(taskRuns)
        .set({ status: "QUEUED", error: null, retryAt: null, updatedAt: now })
        .where(taskRunScope(input.workspaceId, input.taskRunId))
        .returning();
      await transaction
        .update(providerAttempts)
        .set({ status: "ABANDONED", updatedAt: now })
        .where(and(
          eq(providerAttempts.workspaceId, input.workspaceId),
          eq(providerAttempts.taskRunId, input.taskRunId),
          isNull(providerAttempts.providerRequestId),
          sql`${providerAttempts.status} not in ('FAILED', 'DOWNLOAD_FAILED', 'ABANDONED')`,
        ));
      // A terminal provider rejection such as "request not found" means the
      // upstream task no longer exists. An explicit user retry must submit a
      // fresh provider task; transient polling/download failures still retain
      // the persisted request id for recovery without duplicate submission.
      if (current.error?.code === "PROVIDER_REJECTED") {
        await transaction
          .update(providerAttempts)
          .set({ status: "ABANDONED", updatedAt: now })
          .where(and(
            eq(providerAttempts.workspaceId, input.workspaceId),
            eq(providerAttempts.taskRunId, input.taskRunId),
            isNotNull(providerAttempts.providerRequestId),
            sql`${providerAttempts.status} not in ('SUCCEEDED', 'ABANDONED')`,
          ));
      }
      const taskRun = toControlTaskRun(retried);
      const [shot] = await transaction.select().from(shots).where(shotScope(input.workspaceId, taskRun.shotId)).limit(1);
      if (shot) {
        await transaction
          .update(shots)
          .set({ status: "GENERATING", revision: shot.revision + 1, updatedAt: now })
          .where(shotScope(input.workspaceId, shot.id));
      }
      const event = queuedEvent({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        projectId: taskRun.projectId,
        taskRun,
        occurredAt: now,
        producer: "control-api",
      });
      await insertOutboxEvent(transaction, event);
      await this.storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "TASK_RUN", task_run: taskRun });
      return { kind: "NEW", value: taskRun, status: 202 };
    });
  }

  async findTaskRun(workspaceId: string, taskRunId: string) {
    const [taskRun] = await this.db.select().from(taskRuns).where(taskRunScope(workspaceId, taskRunId)).limit(1);
    return taskRun ? toControlTaskRun(taskRun) : undefined;
  }

  async listProjectTaskRuns(workspaceId: string, projectId: string) {
    const rows = await this.db.select().from(taskRuns).where(and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.projectId, projectId))).orderBy(asc(taskRuns.createdAt));
    return rows.map(toControlTaskRun);
  }

  async listRecoverableVideoTaskRuns(input: { limit: number; statuses?: readonly TaskRunStatus[] }) {
    const now = new Date().toISOString();
    const billingRetryScheduled = and(
      eq(taskRuns.status, "RETRY_SCHEDULED"),
      lte(taskRuns.retryAt, now),
      sql`(${taskRuns.error}->>'code') in (${sql.join(BILLING_RETRY_ERROR_CODES.map((code) => sql`${code}`), sql`, `)})`,
    );
    const statusFilter = input.statuses
      ? (input.statuses.length > 0
        ? or(
          input.statuses.includes("RETRY_SCHEDULED") ? billingRetryScheduled : sql`false`,
          input.statuses.some((status) => status !== "RETRY_SCHEDULED")
            ? inArray(taskRuns.status, input.statuses.filter((status) => status !== "RETRY_SCHEDULED"))
            : sql`false`,
        )
        : sql`false`)
      : or(
        inArray(taskRuns.status, ["RUNNING", "PROVIDER_PROCESSING", "DOWNLOADING", "BILLING_PENDING"]),
        billingRetryScheduled,
      );
    const rows = await this.db
      .select()
      .from(taskRuns)
      .where(and(
        eq(taskRuns.kind, "VIDEO_GENERATION"),
        statusFilter,
      ))
      .orderBy(asc(taskRuns.updatedAt), asc(taskRuns.id))
      .limit(input.limit);
    return rows.map(toControlTaskRun);
  }

  async findTaskRunResultAsset(workspaceId: string, assetId: string) {
    const [asset] = await this.db.select().from(assets).where(assetScope(workspaceId, assetId)).limit(1);
    if (!asset) return undefined;
    return {
      id: asset.id,
      workspaceId: asset.workspaceId,
      projectId: asset.projectId,
      kind: asset.kind,
      origin: asset.origin,
      status: asset.status,
      objectKey: asset.objectKey,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      metadata: asset.metadata,
      createdAt: timestamp(asset.createdAt),
      updatedAt: timestamp(asset.updatedAt),
    };
  }

  async findGeneratedAssetDraft(workspaceId: string, taskRunId: string) {
    const [taskRun] = await this.db
      .select({ projectId: taskRuns.projectId })
      .from(taskRuns)
      .where(taskRunScope(workspaceId, taskRunId))
      .limit(1);
    if (!taskRun) return undefined;
    const [asset] = await this.db
      .select({ id: assets.id, objectKey: assets.objectKey })
      .from(assets)
      .where(and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, taskRun.projectId),
        eq(assets.kind, "VIDEO"),
        eq(assets.origin, "GENERATED"),
        eq(assets.status, "PENDING_UPLOAD"),
        sql`${assets.metadata} ->> 'task_run_id' = ${taskRunId}`,
      ))
      .limit(1);
    return asset ? { id: asset.id, objectKey: asset.objectKey, taskRunId } : undefined;
  }

  async listTaskRunAttempts(workspaceId: string, taskRunId: string) {
    const rows = await this.db.select().from(providerAttempts).where(and(eq(providerAttempts.workspaceId, workspaceId), eq(providerAttempts.taskRunId, taskRunId))).orderBy(asc(providerAttempts.createdAt));
    return rows.map(toControlProviderAttempt);
  }

  async ensureProviderAttempt(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; provider: string; model: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [taskRun] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!taskRun || ["SUCCEEDED", "FAILED", "ABANDONED"].includes(taskRun.status)) return undefined;
      // A persisted Provider request is a durable submit boundary. Prefer it over
      // any later unsubmitted row, which may have been left by an interrupted run.
      const [submitted] = await transaction
        .select()
        .from(providerAttempts)
        .where(and(
          eq(providerAttempts.workspaceId, input.workspaceId),
          eq(providerAttempts.taskRunId, input.taskRunId),
          isNotNull(providerAttempts.providerRequestId),
          sql`${providerAttempts.status} <> 'ABANDONED'`,
        ))
        .orderBy(sql`${providerAttempts.createdAt} desc`)
        .limit(1);
      if (submitted) return toControlProviderAttempt(submitted);
      const [existing] = await transaction.select().from(providerAttempts).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.taskRunId, input.taskRunId))).orderBy(sql`${providerAttempts.createdAt} desc`).limit(1);
      if (existing && !["FAILED", "DOWNLOAD_FAILED", "ABANDONED"].includes(existing.status)) return toControlProviderAttempt(existing);
      const [created] = await transaction.insert(providerAttempts).values({
        id: input.providerAttemptId,
        workspaceId: input.workspaceId,
        taskRunId: input.taskRunId,
        provider: input.provider,
        model: input.model,
        status: "CREATED",
        requestPayload: {},
        responsePayload: {},
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      }).returning();
      return created ? toControlProviderAttempt(created) : undefined;
    });
  }

  async recordProviderSubmission(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; providerRequestId: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      const [attempt] = await transaction.select().from(providerAttempts).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId), eq(providerAttempts.taskRunId, input.taskRunId))).limit(1);
      if (!current || !attempt) return undefined;
      if (attempt.providerRequestId && attempt.providerRequestId !== input.providerRequestId) throw new Error("PROVIDER_RESUBMIT_FORBIDDEN");
      if (!attempt.providerRequestId) {
        await transaction.update(providerAttempts).set({ providerRequestId: input.providerRequestId, status: "SUBMITTED", updatedAt: input.now.toISOString() }).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId)));
        if (current.status === "RUNNING") {
          assertTaskRunTransition(current.status, "PROVIDER_PROCESSING");
          await transaction.update(taskRuns).set({ status: "PROVIDER_PROCESSING", updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId));
          const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
          if (source) {
            await insertOutboxEvent(transaction, executionEvent(source, { type: "provider_attempt.submitted", now: input.now.toISOString(), taskRunId: input.taskRunId, providerAttemptId: input.providerAttemptId, providerRequestId: input.providerRequestId, provider: attempt.provider, model: attempt.model }));
          }
        }
      }
      const [updated] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      return updated ? toControlTaskRun(updated) : undefined;
    });
  }

  async recordProviderProcessing(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      const [attempt] = await transaction.select().from(providerAttempts).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId), eq(providerAttempts.taskRunId, input.taskRunId))).limit(1);
      if (!current || !attempt) return undefined;
      let updatedTaskRun = current;
      if (current.status === "RUNNING") {
        assertTaskRunTransition(current.status, "PROVIDER_PROCESSING");
        const [transitioned] = await transaction
          .update(taskRuns)
          .set({ status: "PROVIDER_PROCESSING", updatedAt: input.now.toISOString() })
          .where(taskRunScope(input.workspaceId, input.taskRunId))
          .returning();
        if (transitioned) updatedTaskRun = transitioned;
      }
      await transaction.update(providerAttempts).set({ status: "PROCESSING", updatedAt: input.now.toISOString() }).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId)));
      const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
      if (source && current.status === "RUNNING") {
        await insertOutboxEvent(transaction, executionEvent(source, { type: "task_run.progressed", now: input.now.toISOString(), taskRunId: input.taskRunId, status: "PROVIDER_PROCESSING", progress: 45, message: "Mock video is processing." }));
      }
      return toControlTaskRun(updatedTaskRun);
    });
  }

  async beginDownload(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      const [attempt] = await transaction.select().from(providerAttempts).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId), eq(providerAttempts.taskRunId, input.taskRunId))).limit(1);
      if (!current || !attempt) return undefined;
      if (current.status !== "DOWNLOADING") {
        assertTaskRunTransition(current.status, "DOWNLOADING");
        await transaction.update(taskRuns).set({ status: "DOWNLOADING", updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId));
      }
      await transaction.update(providerAttempts).set({ status: "SUCCEEDED", updatedAt: input.now.toISOString() }).where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId)));
      const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
      if (source) await insertOutboxEvent(transaction, executionEvent(source, { type: "task_run.progressed", now: input.now.toISOString(), taskRunId: input.taskRunId, status: "DOWNLOADING", progress: 75, message: "Mock video is downloading." }));
      const [updated] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      return updated ? toControlTaskRun(updated) : undefined;
    });
  }

  async recordDownloadRetryableFailure(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; code: string; now: Date }) {
    await this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select({ status: taskRuns.status }).from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      const [attempt] = await transaction
        .select({ providerRequestId: providerAttempts.providerRequestId })
        .from(providerAttempts)
        .where(and(
          eq(providerAttempts.workspaceId, input.workspaceId),
          eq(providerAttempts.id, input.providerAttemptId),
          eq(providerAttempts.taskRunId, input.taskRunId),
        ))
        .limit(1);
      if (!current || current.status !== "DOWNLOADING" || !attempt?.providerRequestId) return;
      await transaction
        .update(providerAttempts)
        .set({ status: "DOWNLOAD_FAILED", responsePayload: { code: input.code }, updatedAt: input.now.toISOString() })
        .where(and(
          eq(providerAttempts.workspaceId, input.workspaceId),
          eq(providerAttempts.id, input.providerAttemptId),
          eq(providerAttempts.taskRunId, input.taskRunId),
        ));
    });
  }

  async ensureGeneratedAsset(input: { workspaceId: string; taskRunId: string; assetId: string; objectKey: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [taskRun] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!taskRun) return undefined;
      const [existing] = await transaction
        .select({ id: assets.id, objectKey: assets.objectKey, kind: assets.kind, origin: assets.origin, metadata: assets.metadata })
        .from(assets)
        .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.projectId, taskRun.projectId), eq(assets.id, input.assetId)))
        .limit(1);
      if (existing) {
        if (existing.kind !== "VIDEO" || existing.origin !== "GENERATED" || existing.metadata.task_run_id !== input.taskRunId) return undefined;
        return { id: existing.id, objectKey: existing.objectKey, taskRunId: input.taskRunId };
      }
      const [created] = await transaction.insert(assets).values({ id: input.assetId, workspaceId: input.workspaceId, projectId: taskRun.projectId, kind: "VIDEO", origin: "GENERATED", status: "PENDING_UPLOAD", objectKey: input.objectKey, metadata: { task_run_id: input.taskRunId, generated_by: "mock" }, createdAt: input.now.toISOString(), updatedAt: input.now.toISOString() }).returning({ id: assets.id, objectKey: assets.objectKey });
      return created ? { id: created.id, objectKey: created.objectKey, taskRunId: input.taskRunId } : undefined;
    });
  }

  async completeGeneratedTaskRun(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; assetId: string; sha256: string; byteSize: number; width: number; height: number; durationMs: number; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, input.assetId)).limit(1);
      if (!current || !asset) return undefined;
      if (current.status === "SUCCEEDED") return toControlTaskRun(current);
      assertTaskRunTransition(current.status, "SUCCEEDED");
      const [updated] = await transaction.update(assets).set({ status: "READY", sha256: input.sha256, mimeType: "video/mp4", byteSize: input.byteSize, width: input.width, height: input.height, durationMs: input.durationMs, updatedAt: input.now.toISOString() }).where(and(assetScope(input.workspaceId, input.assetId), eq(assets.status, "PENDING_UPLOAD"))).returning();
      if (!updated && asset.status !== "READY") return undefined;
      const needsBilling = Boolean((current.inputSnapshot as { billing?: unknown }).billing);
      const [task] = await transaction.update(taskRuns).set({ status: needsBilling ? "BILLING_PENDING" : "SUCCEEDED", resultAssetId: needsBilling ? null : input.assetId, error: null, updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId)).returning();
      if (!needsBilling) await transaction.update(shots).set({ status: "GENERATED", selectedAssetId: input.assetId, revision: sql`${shots.revision} + 1`, updatedAt: input.now.toISOString() }).where(shotScope(input.workspaceId, current.shotId));
      const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
      if (source && task && !needsBilling) await insertOutboxEvent(transaction, executionEvent(source, { type: "task_run.succeeded", now: input.now.toISOString(), taskRunId: input.taskRunId, resultAssetId: input.assetId, sha256: input.sha256 }));
      return task ? toControlTaskRun(task) : undefined;
    });
  }

  async markBillingSucceeded(input: { workspaceId: string; taskRunId: string; usageRecordId: string; now: Date }) {
    await this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current || current.status === "SUCCEEDED") return;
      assertTaskRunTransition(current.status, "SUCCEEDED");
      const [generated] = await transaction.select({ id: assets.id, sha256: assets.sha256 }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), sql`${assets.metadata}->>'task_run_id' = ${input.taskRunId}`)).limit(1);
      if (!generated) throw new Error("Generated asset is missing before billing completion.");
      const [task] = await transaction.update(taskRuns).set({ status: "SUCCEEDED", resultAssetId: generated.id, error: null, updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId)).returning();
      await transaction.update(shots).set({ status: "GENERATED", selectedAssetId: generated.id, revision: sql`${shots.revision} + 1`, updatedAt: input.now.toISOString() }).where(shotScope(input.workspaceId, current.shotId));
      const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
      if (source && task) await insertOutboxEvent(transaction, executionEvent(source, { type: "task_run.succeeded", now: input.now.toISOString(), taskRunId: input.taskRunId, resultAssetId: generated.id, sha256: generated.sha256 ?? "" }));
    });
  }

  async markBillingFailed(input: { workspaceId: string; taskRunId: string; code: string; safeMessage: string; now: Date }) {
    await this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current || current.status === "BILLING_FAILED") return;
      assertTaskRunTransition(current.status, "BILLING_FAILED");
      await transaction.update(taskRuns).set({ status: "BILLING_FAILED", error: { code: input.code, message: input.safeMessage, retryable: false }, updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId));
    });
  }

  async scheduleBillingRetry(input: { workspaceId: string; taskRunId: string; code: string; safeMessage: string; retryAt: Date; now: Date }) {
    await this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current || current.status === "RETRY_SCHEDULED") return;
      assertTaskRunTransition(current.status, "RETRY_SCHEDULED");
      await transaction.update(taskRuns).set({ status: "RETRY_SCHEDULED", retryAt: input.retryAt.toISOString(), error: { code: input.code, message: input.safeMessage, retryable: true }, updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId));
    });
  }

  async resumeBillingRetry(input: { workspaceId: string; taskRunId: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current || current.status !== "RETRY_SCHEDULED") return current ? toControlTaskRun(current) : undefined;
      if (current.retryAt && current.retryAt > input.now.toISOString()) return toControlTaskRun(current);
      const parsed = VideoGenerationInputSnapshotSchema.safeParse(current.inputSnapshot);
      if (!parsed.success || !parsed.data.billing || !isBillingRetryErrorCode(current.error?.code)) return toControlTaskRun(current);
      assertTaskRunTransition(current.status, "BILLING_PENDING");
      const [resumed] = await transaction.update(taskRuns)
        .set({ status: "BILLING_PENDING", error: null, retryAt: null, updatedAt: input.now.toISOString() })
        .where(taskRunScope(input.workspaceId, input.taskRunId))
        .returning();
      return resumed ? toControlTaskRun(resumed) : undefined;
    });
  }

  async finalizeTaskRunExecutionFailure(input: { workspaceId: string; taskRunId: string; code: string; message: string; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current || current.kind !== "VIDEO_GENERATION" || ["SUCCEEDED", "FAILED", "ABANDONED"].includes(current.status)) return current ? toControlTaskRun(current) : undefined;
      const billingSnapshot = VideoGenerationInputSnapshotSchema.safeParse(current.inputSnapshot);
      if (current.status === "BILLING_PENDING" && billingSnapshot.success && billingSnapshot.data.billing) {
        assertTaskRunTransition(current.status, "BILLING_FAILED");
        const [failedBilling] = await transaction.update(taskRuns)
          .set({ status: "BILLING_FAILED", error: { code: "CREDIT_UNAVAILABLE", message: "The credit service is unavailable; retry billing after restoring the credit bridge.", retryable: false }, updatedAt: input.now.toISOString() })
          .where(taskRunScope(input.workspaceId, input.taskRunId))
          .returning();
        return failedBilling ? toControlTaskRun(failedBilling) : undefined;
      }
      assertTaskRunTransition(current.status, "FAILED");
      const [submittedAttempt] = await transaction
        .select({ id: providerAttempts.id, providerRequestId: providerAttempts.providerRequestId })
        .from(providerAttempts)
        .where(and(
          eq(providerAttempts.workspaceId, input.workspaceId),
          eq(providerAttempts.taskRunId, input.taskRunId),
          isNotNull(providerAttempts.providerRequestId),
        ))
        .orderBy(sql`${providerAttempts.createdAt} desc`)
        .limit(1);
      const [latestAttempt] = submittedAttempt
        ? [undefined]
        : await transaction
          .select({ id: providerAttempts.id, providerRequestId: providerAttempts.providerRequestId })
          .from(providerAttempts)
          .where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.taskRunId, input.taskRunId)))
          .orderBy(sql`${providerAttempts.createdAt} desc`)
          .limit(1);
      const attempt = submittedAttempt ?? latestAttempt;
      if (attempt) {
        await transaction
          .update(providerAttempts)
          .set({
            status: current.status === "DOWNLOADING" && attempt.providerRequestId ? "DOWNLOAD_FAILED" : "FAILED",
            responsePayload: { code: input.code },
            updatedAt: input.now.toISOString(),
          })
          .where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, attempt.id), eq(providerAttempts.taskRunId, input.taskRunId)));
      }
      const [failed] = await transaction
        .update(taskRuns)
        .set({ status: "FAILED", error: { code: input.code, message: input.message, retryable: true }, updatedAt: input.now.toISOString() })
        .where(taskRunScope(input.workspaceId, input.taskRunId))
        .returning();
      await transaction
        .update(shots)
        .set({ status: "FAILED", revision: sql`${shots.revision} + 1`, updatedAt: input.now.toISOString() })
        .where(shotScope(input.workspaceId, current.shotId));
      const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
      if (source) {
        await insertOutboxEvent(transaction, executionEvent(source, {
          type: "task_run.failed",
          now: input.now.toISOString(),
          taskRunId: input.taskRunId,
          errorCode: input.code,
          retryable: true,
          ...(attempt ? { providerAttemptId: attempt.id } : {}),
        }));
      }
      return failed ? toControlTaskRun(failed) : undefined;
    });
  }

  async failTaskRun(input: { workspaceId: string; taskRunId: string; providerAttemptId?: string; failureStage?: "PROVIDER" | "DOWNLOAD"; code: string; message: string; retryable: boolean; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockTaskRun(transaction, input.workspaceId, input.taskRunId);
      const [current] = await transaction.select().from(taskRuns).where(taskRunScope(input.workspaceId, input.taskRunId)).limit(1);
      if (!current) return undefined;
      if (current.status === "FAILED") return toControlTaskRun(current);
      if (current.status === "SUCCEEDED") return toControlTaskRun(current);
      assertTaskRunTransition(current.status, "FAILED");
      if (input.providerAttemptId) {
        const [attempt] = await transaction
          .select({ providerRequestId: providerAttempts.providerRequestId })
          .from(providerAttempts)
          .where(and(
            eq(providerAttempts.workspaceId, input.workspaceId),
            eq(providerAttempts.id, input.providerAttemptId),
            eq(providerAttempts.taskRunId, input.taskRunId),
          ))
          .limit(1);
        await transaction
          .update(providerAttempts)
          .set({
            status: input.failureStage === "DOWNLOAD" && attempt?.providerRequestId ? "DOWNLOAD_FAILED" : "FAILED",
            responsePayload: { code: input.code },
            updatedAt: input.now.toISOString(),
          })
          .where(and(eq(providerAttempts.workspaceId, input.workspaceId), eq(providerAttempts.id, input.providerAttemptId), eq(providerAttempts.taskRunId, input.taskRunId)));
      }
      const [failed] = await transaction.update(taskRuns).set({ status: "FAILED", error: { code: input.code, message: input.message, retryable: input.retryable }, updatedAt: input.now.toISOString() }).where(taskRunScope(input.workspaceId, input.taskRunId)).returning();
      await transaction.update(shots).set({ status: "FAILED", revision: sql`${shots.revision} + 1`, updatedAt: input.now.toISOString() }).where(shotScope(input.workspaceId, current.shotId));
      const source = await queuedSourceForTaskRun(transaction, input.workspaceId, input.taskRunId);
      if (source) await insertOutboxEvent(transaction, executionEvent(source, { type: "task_run.failed", now: input.now.toISOString(), taskRunId: input.taskRunId, errorCode: input.code, retryable: input.retryable, ...(input.providerAttemptId ? { providerAttemptId: input.providerAttemptId } : {}) }));
      return failed ? toControlTaskRun(failed) : undefined;
    });
  }

  async listWorkspaceEvents(input: { workspaceId: string; afterEventId?: string; limit: number }) {
    let cursor: { id: string; occurredAt: string } | undefined;
    if (input.afterEventId) {
      cursor = (
        await this.db
          .select({ id: outboxEvents.id, occurredAt: outboxEvents.occurredAt })
          .from(outboxEvents)
          .where(and(eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.id, input.afterEventId)))
          .limit(1)
      )[0];
    }
    const conditions = [eq(outboxEvents.workspaceId, input.workspaceId)];
    if (cursor) {
      conditions.push(or(gt(outboxEvents.occurredAt, cursor.occurredAt), and(eq(outboxEvents.occurredAt, cursor.occurredAt), gt(outboxEvents.id, cursor.id)))!);
    }
    const rows = await this.db
      .select({ workspaceId: outboxEvents.workspaceId, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(and(...conditions))
      .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
      .limit(input.limit);
    return rows.flatMap((row) => {
      const event = InternalEventEnvelopeSchema.safeParse(row.payload);
      return event.success && event.data.workspace_id === row.workspaceId ? [event.data] : [];
    });
  }

  async claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string; eventTypes?: readonly InternalEventEnvelope["event_type"][] }) {
    const now = input.now.toISOString();
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
    await this.db
      .update(outboxEvents)
      .set({ publishedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, lastError: null })
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  async releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }) {
    const [current] = await this.db
      .select({ publishAttempts: outboxEvents.publishAttempts })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)))
      .limit(1);
    if (!current) return;
    const deadLetteredAt = current.publishAttempts >= input.maxAttempts ? input.now.toISOString() : null;
    await this.db
      .update(outboxEvents)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: sanitizeReason(input.reason),
        ...(deadLetteredAt ? { deadLetteredAt } : { availableAt: new Date(input.now.getTime() + input.retryDelayMs).toISOString() }),
      })
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  async processEvent(input: TaskRunEventProcessingInput): Promise<TaskRunEventResult> {
    return this.db.transaction(async (transaction) => {
      const message = InternalTaskRunQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id)))
        .limit(1);
      if (!outbox) return "RETRY";
      const parsed = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!parsed.success) return "RETRY";
      if (
        parsed.data.event_type !== "task_run.queued" ||
        outbox.id !== message.event_id ||
        outbox.workspaceId !== message.workspace_id ||
        parsed.data.event_id !== message.event_id ||
        parsed.data.workspace_id !== message.workspace_id ||
        parsed.data.correlation_id !== message.correlation_id ||
        parsed.data.data.task_run_id !== message.task_run_id ||
        fingerprintRequest(parsed.data.data.input_snapshot) !== fingerprintRequest(message.input_snapshot)
      ) return "RETRY";

      const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      const [inserted] = await transaction
        .insert(eventConsumptions)
        .values({ workspaceId: message.workspace_id, eventId: message.event_id, consumerName: input.consumerName, leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: 1 })
        .onConflictDoNothing()
        .returning();
      let attemptNo = inserted?.attempts;
      if (!inserted) {
        const [existing] = await transaction
          .select()
          .from(eventConsumptions)
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
          ))
          .limit(1);
        if (!existing || existing.completedAt || existing.deadLetteredAt) return "DUPLICATE";
        const [reclaimed] = await transaction
          .update(eventConsumptions)
          .set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: input.now.toISOString() })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            isNull(eventConsumptions.completedAt),
            isNull(eventConsumptions.deadLetteredAt),
            or(isNull(eventConsumptions.leaseExpiresAt), lte(eventConsumptions.leaseExpiresAt, input.now.toISOString())),
          ))
          .returning();
        if (!reclaimed) return "BUSY";
        attemptNo = reclaimed.attempts;
      }

      const [taskRun] = await transaction
        .select()
        .from(taskRuns)
        .where(taskRunScope(message.workspace_id, message.task_run_id))
        .limit(1);
      if (!taskRun) return "RETRY";
      const billingWakeSnapshot = VideoGenerationInputSnapshotSchema.safeParse(taskRun.inputSnapshot);
      const isBillingWake = taskRun.status === "BILLING_PENDING"
        && billingWakeSnapshot.success
        && Boolean(billingWakeSnapshot.data.billing);
      if (taskRun.status !== "QUEUED" && !isBillingWake) {
        await transaction
          .update(eventConsumptions)
          .set({ completedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now.toISOString() })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            eq(eventConsumptions.leaseOwner, input.workerId),
          ));
        return "DUPLICATE";
      }

      if (taskRun.status === "QUEUED") {
        assertTaskRunTransition(taskRun.status, "RUNNING");
        await transaction
          .update(taskRuns)
          .set({ status: "RUNNING", updatedAt: input.now.toISOString() })
          .where(taskRunScope(message.workspace_id, taskRun.id));
        const started = startedEvent({ source: parsed.data, attemptNo: attemptNo ?? 1, occurredAt: afterEvent(parsed.data.occurred_at, input.now) });
        await insertOutboxEvent(transaction, started);
      }
      await transaction
        .update(eventConsumptions)
      .set({ completedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now.toISOString() })
      .where(and(
        eq(eventConsumptions.workspaceId, message.workspace_id),
        eq(eventConsumptions.eventId, message.event_id),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
      return "PROCESSED";
    });
  }

  async releaseConsumerEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    const [outbox] = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId)))
      .limit(1);
    if (!outbox) return;
    await this.db
      .update(eventConsumptions)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: sanitizeReason(input.reason),
        ...(input.deadLetter ? { deadLetteredAt: input.now.toISOString() } : {}),
        updatedAt: input.now.toISOString(),
      })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
  }

  private async replayCommand(
    transaction: QueryExecutor,
    scope: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<TaskRunCommandExecution> {
    const [existing] = await transaction
      .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
      .from(commandDeduplications)
      .where(commandScope(scope, idempotencyKey))
      .limit(1);
    if (!existing || existing.requestHash !== requestHash) return { kind: "CONFLICT" };
    const snapshot = existing.responseSnapshot as CommandSnapshot;
    if (isTaskRunSnapshot(snapshot)) return { kind: "REPLAY", value: snapshot.task_run, status: 202 };
    if (snapshot.kind === "NOT_FOUND") return snapshot;
    if (snapshot.kind === "INVALID_REFERENCE") return snapshot;
    if (snapshot.kind === "ACTIVE_CONFLICT") return snapshot;
    return { kind: "STATE_INVALID" };
  }

  private async storeCommandOutcome(
    transaction: QueryExecutor,
    scope: string,
    idempotencyKey: string,
    outcome: Exclude<CommandSnapshot, { kind: "TASK_RUN" }>,
  ): Promise<TaskRunCommandExecution> {
    await this.storeSnapshot(transaction, scope, idempotencyKey, outcome);
    return outcome;
  }

  private async storeSnapshot(transaction: QueryExecutor, scope: string, idempotencyKey: string, snapshot: CommandSnapshot) {
    await transaction.update(commandDeduplications).set({ responseSnapshot: snapshot }).where(commandScope(scope, idempotencyKey));
  }

  private isActiveTaskRunViolation(error: unknown) {
    const source = error as { code?: unknown; constraint?: unknown };
    return source?.code === "23505" && source?.constraint === "task_runs_one_active_shot_key";
  }
}
