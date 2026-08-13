import { InternalTaskRunQueueMessageSchema, type InternalTaskRunQueueMessage } from "@alchemy-video/contracts";
import type { InternalEventQueuePort } from "@alchemy-video/task-queue";
import type { PersistedOutboxEvent, TaskRunEventResult, TaskRunStore } from "@alchemy-video/persistence";
import type { MockVideoTaskExecutor } from "./execution-service.js";

const failureReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);

export class OutboxRelay {
  constructor(
    private readonly store: Pick<TaskRunStore, "claimOutboxEvents" | "markOutboxPublished" | "releaseOutboxEvent">,
    private readonly queue: InternalEventQueuePort,
    private readonly input: { relayId: string; leaseMs: number; retryDelayMs: number; maxAttempts: number; batchSize: number; workspaceId?: string },
  ) {}

  async runOnce(now = new Date()) {
    const claimed = await this.store.claimOutboxEvents({
      relayId: this.input.relayId,
      now,
      leaseMs: this.input.leaseMs,
      limit: this.input.batchSize,
      workspaceId: this.input.workspaceId,
    });
    const result = { published: 0, retried: 0, deadLettered: 0 };
    for (const outbox of claimed) {
      try {
        const message = createTaskRunQueueMessage(outbox);
        if (message) await this.queue.enqueue(message);
        await this.store.markOutboxPublished({ eventId: outbox.id, workspaceId: outbox.workspaceId, relayId: this.input.relayId, now });
        result.published += 1;
      } catch (error) {
        await this.store.releaseOutboxEvent({
          eventId: outbox.id,
          workspaceId: outbox.workspaceId,
          relayId: this.input.relayId,
          now,
          retryDelayMs: this.input.retryDelayMs,
          maxAttempts: this.input.maxAttempts,
          reason: failureReason(error),
        });
        if (outbox.publishAttempts >= this.input.maxAttempts) result.deadLettered += 1;
        else result.retried += 1;
      }
    }
    return result;
  }
}

export const createTaskRunQueueMessage = (outbox: PersistedOutboxEvent): InternalTaskRunQueueMessage | undefined => {
  if (outbox.event.event_type !== "task_run.queued") return undefined;
  if (outbox.id !== outbox.event.event_id || outbox.workspaceId !== outbox.event.workspace_id) {
    throw new Error("Outbox row and event envelope scope do not match.");
  }
  return InternalTaskRunQueueMessageSchema.parse({
    contract_version: outbox.event.contract_version,
    event_id: outbox.id,
    workspace_id: outbox.workspaceId,
    task_run_id: outbox.event.data.task_run_id,
    attempt_no: 1,
    correlation_id: outbox.event.correlation_id,
    input_snapshot: outbox.event.data.input_snapshot,
  });
};

export class TaskRunEventConsumer {
  constructor(
    private readonly store: Pick<TaskRunStore, "processEvent" | "releaseConsumerEvent" | "finalizeTaskRunExecutionFailure">,
    private readonly input: { consumerName: string; workerId: string; leaseMs: number },
    private readonly executor?: Pick<MockVideoTaskExecutor, "execute">,
  ) {}

  async process(input: InternalTaskRunQueueMessage): Promise<TaskRunEventResult> {
    const result = await this.store.processEvent({
      message: input,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      now: new Date(),
      leaseMs: this.input.leaseMs,
    });
    if (result === "RETRY" || result === "BUSY") {
      throw new Error(`Internal event ${input.event_id} requires another delivery attempt.`);
    }
    if ((result === "PROCESSED" || result === "DUPLICATE") && this.executor) {
      await this.executor.execute({ workspaceId: input.workspace_id, taskRunId: input.task_run_id });
    }
    return result;
  }

  async deadLetter(input: { event_id: string; workspace_id: string; reason: string }) {
    await this.store.releaseConsumerEvent({
      eventId: input.event_id,
      workspaceId: input.workspace_id,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      reason: input.reason,
      deadLetter: true,
      now: new Date(),
    });
  }

  async finalizeExecutionFailure(input: { workspace_id: string; task_run_id: string; reason: string }) {
    await this.store.finalizeTaskRunExecutionFailure({
      workspaceId: input.workspace_id,
      taskRunId: input.task_run_id,
      code: "PROVIDER_UNAVAILABLE",
      message: "Mock video execution exhausted its recoverable delivery attempts.",
      now: new Date(),
    });
  }
}

export const recoverC06TaskRuns = async (executor: Pick<MockVideoTaskExecutor, "recover">, input: {
  limit?: number;
  maxAttempts?: number;
  onFailure?: (failure: { workspaceId: string; taskRunId: string; reason: string }) => void;
  finalizeFailure?: (failure: { workspaceId: string; taskRunId: string; reason: string }) => Promise<void>;
} = {}) => {
  const results = await executor.recover({ limit: input.limit ?? 100, maxAttempts: input.maxAttempts ?? 3 });
  for (const result of results) {
    if (result.failure) {
      const failure = { workspaceId: result.workspaceId, taskRunId: result.taskRunId, reason: result.failure };
      input.onFailure?.(failure);
      await input.finalizeFailure?.(failure);
    }
  }
  return results;
};
