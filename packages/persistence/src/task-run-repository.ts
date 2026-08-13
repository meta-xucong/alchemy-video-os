import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  InternalEventEnvelopeSchema,
  InternalTaskRunQueueMessageSchema,
  TASK_RUN_TERMINAL_STATUSES,
  type InternalEventEnvelope,
  type InternalTaskRunQueueMessage,
  type TaskRunStatus,
  type VideoGenerationInputSnapshot,
} from "@alchemy-video/contracts";
import { assertTaskRunTransition, createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import { assets, commandDeduplications, eventConsumptions, outboxEvents, shots, taskRuns } from "./schema.js";
import { shotScope, taskRunScope } from "./workspace-repositories.js";

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

export type TaskRunEventResult = "PROCESSED" | "DUPLICATE" | "IGNORED" | "BUSY" | "RETRY";

export type TaskRunEventProcessingInput = {
  message: InternalTaskRunQueueMessage;
  consumerName: string;
  workerId: string;
  now: Date;
  leaseMs: number;
};

export interface TaskRunStore {
  createTaskRun(input: CreateTaskRunInput): Promise<TaskRunCommandExecution>;
  retryTaskRun(input: RetryTaskRunInput): Promise<TaskRunCommandExecution>;
  findTaskRun(workspaceId: string, taskRunId: string): Promise<ControlTaskRun | undefined>;
  listTaskRunAttempts(workspaceId: string, taskRunId: string): Promise<[]>;
  listWorkspaceEvents(input: { workspaceId: string; afterEventId?: string; limit: number }): Promise<InternalEventEnvelope[]>;
  claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string }): Promise<PersistedOutboxEvent[]>;
  markOutboxPublished(input: { eventId: string; workspaceId: string; relayId: string; now: Date }): Promise<void>;
  releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }): Promise<void>;
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
    });
  }

  async findTaskRun(workspaceId: string, taskRunId: string) {
    const [taskRun] = await this.db.select().from(taskRuns).where(taskRunScope(workspaceId, taskRunId)).limit(1);
    return taskRun ? toControlTaskRun(taskRun) : undefined;
  }

  async listTaskRunAttempts(_workspaceId: string, _taskRunId: string): Promise<[]> {
    return [];
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

  async claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string }) {
    const now = input.now.toISOString();
    const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const workspaceCondition = input.workspaceId ? sql`and workspace_id = ${input.workspaceId}` : sql``;
    const result = await this.db.execute(sql`
      with candidates as (
        select id
        from outbox_events
        where published_at is null
          and dead_lettered_at is null
          and available_at <= ${now}::timestamptz
          and (lease_expires_at is null or lease_expires_at <= ${now}::timestamptz)
          ${workspaceCondition}
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
      if (taskRun.status !== "QUEUED") {
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

      assertTaskRunTransition(taskRun.status, "RUNNING");
      await transaction
        .update(taskRuns)
        .set({ status: "RUNNING", updatedAt: input.now.toISOString() })
        .where(taskRunScope(message.workspace_id, taskRun.id));
      const started = startedEvent({ source: parsed.data, attemptNo: attemptNo ?? 1, occurredAt: afterEvent(parsed.data.occurred_at, input.now) });
      await insertOutboxEvent(transaction, started);
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
