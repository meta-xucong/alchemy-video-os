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
  ControlAsset,
  ControlProviderAttempt,
  ControlTaskRun,
  CreateTaskRunInput,
  PersistedOutboxEvent,
  RetryTaskRunInput,
  TaskRunCommandExecution,
  TaskRunEventResult,
  TaskRunStore,
  GeneratedAssetDraft,
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

const executionEvent = (
  source: Extract<InternalEventEnvelope, { event_type: "task_run.queued" }>,
  input:
    | { type: "provider_attempt.submitted"; now: string; providerAttemptId: string; providerRequestId: string; provider: string; model: string }
    | { type: "task_run.progressed"; now: string; status: ControlTaskRun["status"]; progress: number; message: string }
    | { type: "task_run.succeeded"; now: string; assetId: string; sha256: string }
    | { type: "task_run.failed"; now: string; code: string; retryable: boolean; providerAttemptId?: string },
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
    ? { task_run_id: source.data.task_run_id, provider_attempt_id: input.providerAttemptId, provider_request_id: input.providerRequestId, provider: input.provider, model: input.model }
    : input.type === "task_run.progressed"
      ? { task_run_id: source.data.task_run_id, status: input.status, progress: input.progress, message: input.message }
      : input.type === "task_run.succeeded"
        ? { task_run_id: source.data.task_run_id, result_asset_id: input.assetId, sha256: input.sha256 }
        : { task_run_id: source.data.task_run_id, error_code: input.code, retryable: input.retryable, ...(input.providerAttemptId ? { provider_attempt_id: input.providerAttemptId } : {}) },
});

export class InMemoryTaskRunStore implements TaskRunStore {
  private readonly commands = new Map<string, StoredCommand>();
  private readonly taskRuns = new Map<string, ControlTaskRun>();
  private readonly attempts = new Map<string, ControlProviderAttempt>();
  private readonly generatedAssets = new Map<string, ControlAsset>();
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
    if (!["READY", "GENERATED", "FAILED"].includes(shot.status)) {
      return this.store(input, { kind: "STATE_INVALID" });
    }
    const now = new Date().toISOString();
    const created = taskRun({ id: input.taskRunId, workspaceId: input.workspaceId, projectId: shot.projectId, shotId: shot.id, inputSnapshot: input.inputSnapshot, now });
    this.taskRuns.set(created.id, created);
    await this.assets.setShotGenerationState({ workspaceId: input.workspaceId, shotId: shot.id, status: "GENERATING" });
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
    for (const [attemptId, attempt] of this.attempts.entries()) {
      if (attempt.taskRunId === retried.id && !attempt.providerRequestId && !["FAILED", "DOWNLOAD_FAILED", "ABANDONED"].includes(attempt.status)) {
        this.attempts.set(attemptId, { ...attempt, status: "ABANDONED", updatedAt: now });
      }
    }
    await this.assets.setShotGenerationState({ workspaceId: input.workspaceId, shotId: retried.shotId, status: "GENERATING" });
    this.addEvent(queuedEvent({ command: input, taskRun: retried, now }));
    return this.store(input, { kind: "NEW", value: retried, status: 202 });
  }

  async findTaskRun(workspaceId: string, taskRunId: string) {
    const found = this.taskRuns.get(taskRunId);
    return found?.workspaceId === workspaceId ? found : undefined;
  }

  async listProjectTaskRuns(workspaceId: string, projectId: string) {
    return [...this.taskRuns.values()]
      .filter((taskRun) => taskRun.workspaceId === workspaceId && taskRun.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listRecoverableVideoTaskRuns(input: { limit: number }) {
    return [...this.taskRuns.values()]
      .filter((taskRun) => taskRun.kind === "VIDEO_GENERATION" && ["RUNNING", "PROVIDER_PROCESSING", "DOWNLOADING"].includes(taskRun.status))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, input.limit);
  }

  async findTaskRunResultAsset(workspaceId: string, assetId: string) {
    const generated = this.generatedAssets.get(assetId);
    if (generated?.workspaceId === workspaceId) return generated;
    return this.assets.findAsset(workspaceId, assetId);
  }

  async findGeneratedAssetDraft(workspaceId: string, taskRunId: string) {
    const generated = [...this.generatedAssets.values()].find((asset) =>
      asset.workspaceId === workspaceId
      && asset.status === "PENDING_UPLOAD"
      && asset.metadata.task_run_id === taskRunId,
    );
    return generated ? { id: generated.id, objectKey: generated.objectKey, taskRunId } : undefined;
  }

  async listTaskRunAttempts(workspaceId: string, taskRunId: string) {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.taskRunId === taskRunId && this.taskRuns.get(taskRunId)?.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async ensureProviderAttempt(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; provider: string; model: string; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    if (!current || ["SUCCEEDED", "FAILED", "ABANDONED"].includes(current.status)) return undefined;
    const attempts = await this.listTaskRunAttempts(input.workspaceId, input.taskRunId);
    // A persisted Provider request is a durable submit boundary. Prefer it over
    // any later unsubmitted row, which may have been left by an interrupted run.
    const submitted = [...attempts].reverse().find((attempt) => Boolean(attempt.providerRequestId));
    if (submitted) return submitted;
    const existing = attempts.at(-1);
    if (existing && !["FAILED", "DOWNLOAD_FAILED", "ABANDONED"].includes(existing.status)) return existing;
    const now = input.now.toISOString();
    const attempt: ControlProviderAttempt = { id: input.providerAttemptId, taskRunId: input.taskRunId, provider: input.provider, model: input.model, providerRequestId: null, status: "CREATED", requestPayload: {}, responsePayload: {}, createdAt: now, updatedAt: now };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async recordProviderSubmission(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; providerRequestId: string; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    const attempt = this.attempts.get(input.providerAttemptId);
    if (!current || !attempt || attempt.taskRunId !== current.id) return undefined;
    if (attempt.providerRequestId && attempt.providerRequestId !== input.providerRequestId) throw new Error("PROVIDER_RESUBMIT_FORBIDDEN");
    const now = input.now.toISOString();
    if (!attempt.providerRequestId) {
      this.attempts.set(attempt.id, { ...attempt, providerRequestId: input.providerRequestId, status: "SUBMITTED", updatedAt: now });
      if (current.status === "RUNNING") {
        assertTaskRunTransition(current.status, "PROVIDER_PROCESSING");
        const updated = { ...current, status: "PROVIDER_PROCESSING" as const, updatedAt: now };
        this.taskRuns.set(updated.id, updated);
        const source = this.queuedSource(current.id);
        if (source) this.addEvent(executionEvent(source, { type: "provider_attempt.submitted", now, providerAttemptId: attempt.id, providerRequestId: input.providerRequestId, provider: attempt.provider, model: attempt.model }));
        return updated;
      }
    }
    return this.findTaskRun(input.workspaceId, input.taskRunId);
  }

  async recordProviderProcessing(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    const attempt = this.attempts.get(input.providerAttemptId);
    if (!current || !attempt || attempt.taskRunId !== current.id) return undefined;
    const now = input.now.toISOString();
    let updated = current;
    if (current.status === "RUNNING") {
      assertTaskRunTransition(current.status, "PROVIDER_PROCESSING");
      updated = { ...current, status: "PROVIDER_PROCESSING" as const, updatedAt: now };
      this.taskRuns.set(updated.id, updated);
    }
    this.attempts.set(attempt.id, { ...attempt, status: "PROCESSING", updatedAt: now });
    const source = this.queuedSource(current.id);
    if (source && current.status === "RUNNING") this.addEvent(executionEvent(source, { type: "task_run.progressed", now, status: "PROVIDER_PROCESSING", progress: 45, message: "Mock video is processing." }));
    return updated;
  }

  async beginDownload(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    const attempt = this.attempts.get(input.providerAttemptId);
    if (!current || !attempt || attempt.taskRunId !== current.id) return undefined;
    const now = input.now.toISOString();
    const updated = current.status === "DOWNLOADING" ? current : (() => {
      assertTaskRunTransition(current.status, "DOWNLOADING");
      const next = { ...current, status: "DOWNLOADING" as const, updatedAt: now };
      this.taskRuns.set(next.id, next);
      return next;
    })();
    this.attempts.set(attempt.id, { ...attempt, status: "SUCCEEDED", updatedAt: now });
    const source = this.queuedSource(current.id);
    if (source) this.addEvent(executionEvent(source, { type: "task_run.progressed", now, status: "DOWNLOADING", progress: 75, message: "Mock video is downloading." }));
    return updated;
  }

  async recordDownloadRetryableFailure(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; code: string; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    const attempt = this.attempts.get(input.providerAttemptId);
    if (!current || current.status !== "DOWNLOADING" || !attempt?.providerRequestId || attempt.taskRunId !== current.id) return;
    this.attempts.set(attempt.id, {
      ...attempt,
      status: "DOWNLOAD_FAILED",
      responsePayload: { code: input.code },
      updatedAt: input.now.toISOString(),
    });
  }

  async ensureGeneratedAsset(input: { workspaceId: string; taskRunId: string; assetId: string; objectKey: string; now: Date }): Promise<GeneratedAssetDraft | undefined> {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    if (!current) return undefined;
    const existing = this.generatedAssets.get(input.assetId);
    if (existing) {
      if (existing.kind !== "VIDEO" || existing.origin !== "GENERATED" || existing.metadata.task_run_id !== input.taskRunId) return undefined;
      return { id: existing.id, objectKey: existing.objectKey, taskRunId: input.taskRunId };
    }
    const now = input.now.toISOString();
    this.generatedAssets.set(input.assetId, { id: input.assetId, workspaceId: input.workspaceId, projectId: current.projectId, kind: "VIDEO", origin: "GENERATED", status: "PENDING_UPLOAD", objectKey: input.objectKey, sha256: null, mimeType: null, byteSize: null, width: null, height: null, durationMs: null, metadata: { task_run_id: input.taskRunId, generated_by: "mock" }, createdAt: now, updatedAt: now });
    return { id: input.assetId, objectKey: input.objectKey, taskRunId: input.taskRunId };
  }

  async completeGeneratedTaskRun(input: { workspaceId: string; taskRunId: string; providerAttemptId: string; assetId: string; sha256: string; byteSize: number; width: number; height: number; durationMs: number; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    const draft = this.generatedAssets.get(input.assetId);
    if (!current || !draft) return undefined;
    if (current.status === "SUCCEEDED") return current;
    assertTaskRunTransition(current.status, "SUCCEEDED");
    const now = input.now.toISOString();
    const ready = { ...draft, status: "READY" as const, sha256: input.sha256, mimeType: "video/mp4", byteSize: input.byteSize, width: input.width, height: input.height, durationMs: input.durationMs, updatedAt: now };
    this.generatedAssets.set(ready.id, ready);
    const completed = { ...current, status: "SUCCEEDED" as const, resultAssetId: ready.id, error: null, updatedAt: now };
    this.taskRuns.set(completed.id, completed);
    await this.assets.setShotGenerationState({ workspaceId: input.workspaceId, shotId: current.shotId, status: "GENERATED", selectedAssetId: ready.id });
    const source = this.queuedSource(current.id);
    if (source) this.addEvent(executionEvent(source, { type: "task_run.succeeded", now, assetId: ready.id, sha256: input.sha256 }));
    return completed;
  }

  async finalizeTaskRunExecutionFailure(input: { workspaceId: string; taskRunId: string; code: string; message: string; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    if (!current || current.kind !== "VIDEO_GENERATION" || ["SUCCEEDED", "FAILED", "ABANDONED"].includes(current.status)) return current;
    assertTaskRunTransition(current.status, "FAILED");
    const now = input.now.toISOString();
    const attempts = await this.listTaskRunAttempts(input.workspaceId, input.taskRunId);
    const attempt = [...attempts].reverse().find((item) => Boolean(item.providerRequestId)) ?? attempts.at(-1);
    if (attempt) {
      this.attempts.set(attempt.id, {
        ...attempt,
          status: current.status === "DOWNLOADING" && attempt.providerRequestId ? "DOWNLOAD_FAILED" : "FAILED",
        responsePayload: { code: input.code },
        updatedAt: now,
      });
    }
    const failed = { ...current, status: "FAILED" as const, error: { code: input.code, message: input.message, retryable: true }, updatedAt: now };
    this.taskRuns.set(failed.id, failed);
    await this.assets.setShotGenerationState({ workspaceId: input.workspaceId, shotId: current.shotId, status: "FAILED" });
    const source = this.queuedSource(current.id);
    if (source) this.addEvent(executionEvent(source, { type: "task_run.failed", now, code: input.code, retryable: true, ...(attempt ? { providerAttemptId: attempt.id } : {}) }));
    return failed;
  }

  async failTaskRun(input: { workspaceId: string; taskRunId: string; providerAttemptId?: string; failureStage?: "PROVIDER" | "DOWNLOAD"; code: string; message: string; retryable: boolean; now: Date }) {
    const current = await this.findTaskRun(input.workspaceId, input.taskRunId);
    if (!current || current.status === "SUCCEEDED" || current.status === "FAILED") return current;
    assertTaskRunTransition(current.status, "FAILED");
    const now = input.now.toISOString();
    if (input.providerAttemptId) {
      const attempt = this.attempts.get(input.providerAttemptId);
      if (attempt && attempt.taskRunId === current.id) {
        this.attempts.set(attempt.id, {
          ...attempt,
          status: input.failureStage === "DOWNLOAD" && attempt.providerRequestId ? "DOWNLOAD_FAILED" : "FAILED",
          responsePayload: { code: input.code },
          updatedAt: now,
        });
      }
    }
    const failed = { ...current, status: "FAILED" as const, error: { code: input.code, message: input.message, retryable: input.retryable }, updatedAt: now };
    this.taskRuns.set(failed.id, failed);
    await this.assets.setShotGenerationState({ workspaceId: input.workspaceId, shotId: current.shotId, status: "FAILED" });
    const source = this.queuedSource(current.id);
    if (source) this.addEvent(executionEvent(source, { type: "task_run.failed", now, code: input.code, retryable: input.retryable, ...(input.providerAttemptId ? { providerAttemptId: input.providerAttemptId } : {}) }));
    return failed;
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

  private queuedSource(taskRunId: string) {
    return [...this.events.values()]
      .map((row) => row.event)
      .find((event): event is Extract<InternalEventEnvelope, { event_type: "task_run.queued" }> => event.event_type === "task_run.queued" && event.data.task_run_id === taskRunId);
  }
}

export const createInMemoryTaskRunStore = (assets: AssetWorkspaceStore) => new InMemoryTaskRunStore(assets);
