import {
  InternalEventEnvelopeSchema,
  InternalTaskRunQueueMessageSchema,
  type InternalEventEnvelope,
  type InternalTaskRunQueueMessage,
  type VideoGenerationInputSnapshot,
} from "@alchemy-video/contracts";
import { assertTaskRunTransition, createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import type {
  AssetWorkspaceStore,
  ControlTaskRun,
  CreateTaskRunInput,
  PersistedOutboxEvent,
  RetryTaskRunInput,
  TaskRunCommandExecution,
  TaskRunEventResult,
  TaskRunStore,
} from "@alchemy-video/persistence";

type StoredCommand = { requestHash: string; outcome: TaskRunCommandExecution };
type InMemoryConsumption = {
  workspaceId: string;
  attempts: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
};

const eventKey = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;
const consumptionKey = (workspaceId: string, eventId: string, consumerName: string) => `${workspaceId}:${eventId}:${consumerName}`;
const timestamp = (value: Date | string) => new Date(value).toISOString();
const safeReason = (reason: string) => reason.replace(/[\r\n]+/g, " ").slice(0, 500);
const afterEvent = (sourceOccurredAt: string, now: Date) =>
  new Date(Math.max(now.getTime(), new Date(sourceOccurredAt).getTime() + 1)).toISOString();

const taskRun = (input: {
  id: string;
  workspaceId: string;
  projectId: string;
  shotId: string;
  inputSnapshot: VideoGenerationInputSnapshot;
  status?: ControlTaskRun["status"];
  now?: string;
}): ControlTaskRun => ({
  id: input.id,
  workspaceId: input.workspaceId,
  projectId: input.projectId,
  shotId: input.shotId,
  kind: "VIDEO_GENERATION",
  status: input.status ?? "QUEUED",
  inputSnapshot: input.inputSnapshot,
  resultAssetId: null,
  error: null,
  retryAt: null,
  createdAt: input.now ?? new Date().toISOString(),
  updatedAt: input.now ?? new Date().toISOString(),
});

const queuedEvent = (input: { command: CreateTaskRunInput | RetryTaskRunInput; taskRun: ControlTaskRun; now: string }) =>
  InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: input.command.event.messageId,
    event_id: input.command.event.eventId,
    event_type: "task_run.queued",
    occurred_at: input.now,
    trace_id: input.command.event.traceId,
    correlation_id: input.command.event.correlationId,
    idempotency_key: input.command.idempotencyKey,
    producer: "control-api",
    workspace_id: input.command.workspaceId,
    project_id: input.taskRun.projectId,
    aggregate: { type: "task_run", id: input.taskRun.id },
    version: 1,
    data: {
      task_run_id: input.taskRun.id,
      kind: input.taskRun.kind,
      input_snapshot: input.taskRun.inputSnapshot,
    },
  });

const startedEvent = (event: Extract<InternalEventEnvelope, { event_type: "task_run.queued" }>, attemptNo: number, now: string) =>
  InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: createPrefixedId("msg"),
    event_id: createPrefixedId("evt"),
    event_type: "task_run.started",
    occurred_at: now,
    trace_id: event.trace_id,
    correlation_id: event.correlation_id,
    causation_id: event.message_id,
    idempotency_key: event.idempotency_key,
    producer: "task-worker",
    workspace_id: event.workspace_id,
    ...(event.project_id === undefined ? {} : { project_id: event.project_id }),
    aggregate: event.aggregate,
    version: 1,
    data: { task_run_id: event.data.task_run_id, attempt_no: attemptNo },
  });

export class InMemoryTaskRunStore implements TaskRunStore {
  private readonly commands = new Map<string, StoredCommand>();
  private readonly taskRuns = new Map<string, ControlTaskRun>();
  private readonly events = new Map<string, { workspaceId: string; event: InternalEventEnvelope; publishAttempts: number; availableAt: string; leaseOwner?: string; leaseExpiresAt?: string; publishedAt?: string; deadLetteredAt?: string; lastError?: string }>();
  private readonly consumptions = new Map<string, InMemoryConsumption>();

  constructor(private readonly assets: AssetWorkspaceStore) {}

  async createTaskRun(input: CreateTaskRunInput): Promise<TaskRunCommandExecution> {
    const prior = this.commands.get(eventKey(input.scope, input.idempotencyKey));
    if (prior) return prior.requestHash === input.requestHash ? prior.outcome : { kind: "CONFLICT" };
    const shot = await this.assets.findShot(input.workspaceId, input.shotId);
    if (!shot) return this.store(input, { kind: "NOT_FOUND", status: 404 });
    const references = await Promise.all(input.inputSnapshot.reference_asset_ids.map((assetId) => this.assets.findAsset(input.workspaceId, assetId)));
    if (references.some((asset) => !asset || asset.projectId !== shot.projectId || asset.status !== "READY")) {
      return this.store(input, { kind: "INVALID_REFERENCE" });
    }
    if ([...this.taskRuns.values()].some((value) => value.workspaceId === input.workspaceId && value.shotId === shot.id && !["SUCCEEDED", "FAILED", "ABANDONED"].includes(value.status))) {
      return this.store(input, { kind: "ACTIVE_CONFLICT" });
    }
    const now = new Date().toISOString();
    const created = taskRun({ id: input.taskRunId, workspaceId: input.workspaceId, projectId: shot.projectId, shotId: shot.id, inputSnapshot: input.inputSnapshot, now });
    this.taskRuns.set(created.id, created);
    this.addEvent(queuedEvent({ command: input, taskRun: created, now }));
    return this.store(input, { kind: "NEW", value: created, status: 202 });
  }

  async retryTaskRun(input: RetryTaskRunInput): Promise<TaskRunCommandExecution> {
    const prior = this.commands.get(eventKey(input.scope, input.idempotencyKey));
    if (prior) return prior.requestHash === input.requestHash ? prior.outcome : { kind: "CONFLICT" };
    const current = this.taskRuns.get(input.taskRunId);
    if (!current || current.workspaceId !== input.workspaceId) return this.store(input, { kind: "NOT_FOUND", status: 404 });
    if (current.status !== "FAILED") return this.store(input, { kind: "STATE_INVALID" });
    assertTaskRunTransition(current.status, "QUEUED");
    const now = new Date().toISOString();
    const retried = { ...current, status: "QUEUED" as const, error: null, retryAt: null, updatedAt: now };
    this.taskRuns.set(retried.id, retried);
    this.addEvent(queuedEvent({ command: input, taskRun: retried, now }));
    return this.store(input, { kind: "NEW", value: retried, status: 202 });
  }

  async findTaskRun(workspaceId: string, taskRunId: string) {
    const found = this.taskRuns.get(taskRunId);
    return found?.workspaceId === workspaceId ? found : undefined;
  }

  async listTaskRunAttempts(_workspaceId: string, _taskRunId: string): Promise<[]> {
    return [];
  }

  async listWorkspaceEvents(input: { workspaceId: string; afterEventId?: string; limit: number }) {
    const events = [...this.events.values()]
      .filter((value) => value.workspaceId === input.workspaceId && value.event.workspace_id === value.workspaceId)
      .map((value) => value.event)
      .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) || left.event_id.localeCompare(right.event_id));
    const cursor = input.afterEventId ? events.findIndex((event) => event.event_id === input.afterEventId) : -1;
    return events.slice(cursor + 1, cursor + 1 + input.limit);
  }

  async claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string }): Promise<PersistedOutboxEvent[]> {
    const now = input.now.toISOString();
    const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    return [...this.events.entries()]
      .filter(([, row]) => !row.publishedAt && !row.deadLetteredAt && row.availableAt <= now && (!row.leaseExpiresAt || row.leaseExpiresAt <= now) && (input.workspaceId === undefined || row.workspaceId === input.workspaceId))
      .sort(([, left], [, right]) => left.availableAt.localeCompare(right.availableAt) || left.event.event_id.localeCompare(right.event.event_id))
      .slice(0, input.limit)
      .map(([id, row]) => {
        row.leaseOwner = input.relayId;
        row.leaseExpiresAt = expiresAt;
        row.publishAttempts += 1;
        this.events.set(id, row);
        return { id, workspaceId: row.workspaceId, event: row.event, publishAttempts: row.publishAttempts };
      });
  }

  async markOutboxPublished(input: { eventId: string; workspaceId: string; relayId: string; now: Date }) {
    const row = this.events.get(input.eventId);
    if (!row || row.workspaceId !== input.workspaceId || row.leaseOwner !== input.relayId) return;
    row.publishedAt = input.now.toISOString();
    row.leaseOwner = undefined;
    row.leaseExpiresAt = undefined;
    row.lastError = undefined;
  }

  async releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }) {
    const row = this.events.get(input.eventId);
    if (!row || row.workspaceId !== input.workspaceId || row.leaseOwner !== input.relayId) return;
    row.leaseOwner = undefined;
    row.leaseExpiresAt = undefined;
    row.lastError = safeReason(input.reason);
    if (row.publishAttempts >= input.maxAttempts) row.deadLetteredAt = input.now.toISOString();
    else row.availableAt = new Date(input.now.getTime() + input.retryDelayMs).toISOString();
  }

  async processEvent(input: { message: InternalTaskRunQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<TaskRunEventResult> {
    const message = InternalTaskRunQueueMessageSchema.parse(input.message);
    const row = this.events.get(message.event_id);
    if (!row || row.workspaceId !== message.workspace_id) return "RETRY";
    const parsed = InternalEventEnvelopeSchema.safeParse(row.event);
    if (!parsed.success || parsed.data.event_type !== "task_run.queued" || parsed.data.event_id !== message.event_id || parsed.data.workspace_id !== message.workspace_id || parsed.data.correlation_id !== message.correlation_id || parsed.data.data.task_run_id !== message.task_run_id || fingerprintRequest(parsed.data.data.input_snapshot) !== fingerprintRequest(message.input_snapshot)) return "RETRY";
    const key = consumptionKey(message.workspace_id, message.event_id, input.consumerName);
    const prior = this.consumptions.get(key);
    const now = input.now.toISOString();
    if (prior?.completedAt || prior?.deadLetteredAt) return "DUPLICATE";
    if (prior?.leaseExpiresAt && prior.leaseExpiresAt > now && prior.leaseOwner !== input.workerId) return "BUSY";
    const consumption: InMemoryConsumption = {
      workspaceId: message.workspace_id,
      attempts: (prior?.attempts ?? 0) + 1,
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString(),
    };
    this.consumptions.set(key, consumption);
    const current = await this.findTaskRun(message.workspace_id, message.task_run_id);
    if (!current) return "RETRY";
    if (current.status !== "QUEUED") {
      consumption.completedAt = now;
      consumption.leaseOwner = undefined;
      consumption.leaseExpiresAt = undefined;
      return "DUPLICATE";
    }
    assertTaskRunTransition(current.status, "RUNNING");
    this.taskRuns.set(current.id, { ...current, status: "RUNNING", updatedAt: now });
    this.addEvent(startedEvent(parsed.data, consumption.attempts, afterEvent(parsed.data.occurred_at, input.now)));
    consumption.completedAt = now;
    consumption.leaseOwner = undefined;
    consumption.leaseExpiresAt = undefined;
    return "PROCESSED";
  }

  async releaseConsumerEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    const event = this.events.get(input.eventId);
    if (!event || event.workspaceId !== input.workspaceId) return;
    const row = this.consumptions.get(consumptionKey(input.workspaceId, input.eventId, input.consumerName));
    if (!row || row.workspaceId !== input.workspaceId || row.leaseOwner !== input.workerId) return;
    row.leaseOwner = undefined;
    row.leaseExpiresAt = undefined;
    row.lastError = safeReason(input.reason);
    if (input.deadLetter) row.deadLetteredAt = input.now.toISOString();
  }

  private store(input: { scope: string; idempotencyKey: string; requestHash: string }, outcome: TaskRunCommandExecution) {
    this.commands.set(eventKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, outcome });
    return outcome;
  }

  private addEvent(event: InternalEventEnvelope) {
    this.events.set(event.event_id, { workspaceId: event.workspace_id, event, publishAttempts: 0, availableAt: timestamp(event.occurred_at) });
  }
}

export const createInMemoryTaskRunStore = (assets: AssetWorkspaceStore) => new InMemoryTaskRunStore(assets);
