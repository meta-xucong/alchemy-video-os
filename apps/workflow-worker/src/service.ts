import { InternalCreativePlanningQueueMessageSchema, type InternalCreativePlanningQueueMessage } from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";
import type { ControlCreativeBriefRevision, CreativePlanningEvent, CreativePlanningStore, OutboxRelayStore, PersistedOutboxEvent } from "@alchemy-video/persistence";
import type { CreativePlanningQueuePort } from "@alchemy-video/task-queue";

import {
  CreativePlanningProcessingError,
  normalizeCreativePlanningFailure,
} from "./creative-planning-failure.js";

type CreativePlanningExecutorPort = {
  execute(input: {
    brief: ControlCreativeBriefRevision;
    event: CreativePlanningEvent;
  }): Promise<unknown>;
};

const failureReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);

const planningEventTypes = ["creative_brief.planning_requested"] as const;

export const createCreativePlanningQueueMessage = (outbox: PersistedOutboxEvent): InternalCreativePlanningQueueMessage | undefined => {
  if (outbox.event.event_type !== "creative_brief.planning_requested") return undefined;
  if (outbox.id !== outbox.event.event_id || outbox.workspaceId !== outbox.event.workspace_id || !outbox.event.project_id) {
    throw new Error("Creative planning outbox row and event envelope scope do not match.");
  }
  return InternalCreativePlanningQueueMessageSchema.parse({
    contract_version: outbox.event.contract_version,
    event_id: outbox.id,
    workspace_id: outbox.workspaceId,
    project_id: outbox.event.project_id,
    creative_brief_revision_id: outbox.event.data.creative_brief_revision_id,
    correlation_id: outbox.event.correlation_id,
  });
};

export class CreativePlanningOutboxRelay {
  constructor(
    private readonly store: OutboxRelayStore,
    private readonly queue: CreativePlanningQueuePort,
    private readonly input: { relayId: string; leaseMs: number; retryDelayMs: number; maxAttempts: number; batchSize: number },
  ) {}

  async runOnce(now = new Date()) {
    const claimed = await this.store.claimOutboxEvents({
      relayId: this.input.relayId,
      now,
      leaseMs: this.input.leaseMs,
      limit: this.input.batchSize,
      eventTypes: planningEventTypes,
    });
    const result = { published: 0, retried: 0, deadLettered: 0 };
    for (const outbox of claimed) {
      try {
        const message = createCreativePlanningQueueMessage(outbox);
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

export class CreativePlanningEventConsumer {
  constructor(
    private readonly store: Pick<CreativePlanningStore, "claimCreativePlanningEvent" | "completeCreativePlanningEvent" | "releaseCreativePlanningEvent" | "failCreativePlan">,
    private readonly executor: CreativePlanningExecutorPort,
    private readonly input: { consumerName: string; workerId: string; leaseMs: number },
  ) {}

  async process(message: InternalCreativePlanningQueueMessage) {
    const claim = await this.store.claimCreativePlanningEvent({
      message,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      leaseMs: this.input.leaseMs,
      now: new Date(),
    });
    if (claim.kind === "RETRY" || claim.kind === "BUSY") {
      throw new CreativePlanningProcessingError("PLANNING_EVENT_NOT_READY", true);
    }
    if (claim.kind === "DUPLICATE") return claim.kind;
    if (claim.kind !== "CLAIMED") return claim.kind;
    try {
      const completed = await this.executor.execute({
        brief: claim.brief,
        event: {
          eventId: createPrefixedId("evt"),
          messageId: createPrefixedId("msg"),
          traceId: createPrefixedId("trc"),
          correlationId: message.correlation_id,
        },
      });
      if (!completed) {
        throw new CreativePlanningProcessingError("PLANNING_COMPLETION_MISSING", false);
      }
      await this.store.completeCreativePlanningEvent({
        eventId: message.event_id,
        workspaceId: message.workspace_id,
        consumerName: this.input.consumerName,
        workerId: this.input.workerId,
        now: new Date(),
      });
      return claim.kind;
    } catch (error) {
      const failure = normalizeCreativePlanningFailure(error);
      const safeDiagnostics = error && typeof error === "object"
        ? (error as { issues?: unknown; code?: unknown }).issues
        : undefined;
      console.error(JSON.stringify({
        event: "creative_planning.execution_failed",
        failure_code: failure.safeReason,
        retryable: failure.retryable,
        error_name: error instanceof Error ? error.name : typeof error,
        error_constructor: error && typeof error === "object" && "constructor" in error
          ? String((error as { constructor?: { name?: unknown } }).constructor?.name ?? "unknown")
          : undefined,
        error_code: error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "unknown")
          : undefined,
        validation_issue_codes: Array.isArray(safeDiagnostics)
          ? safeDiagnostics.map((issue) => issue && typeof issue === "object" && "code" in issue
            ? String((issue as { code?: unknown }).code ?? "unknown")
            : "unknown").slice(0, 20)
          : undefined,
      }));
      if (failure.retryable) {
        try {
          await this.store.releaseCreativePlanningEvent({
            eventId: message.event_id,
            workspaceId: message.workspace_id,
            consumerName: this.input.consumerName,
            workerId: this.input.workerId,
            reason: failure.safeReason,
            deadLetter: false,
            now: new Date(),
          });
        } catch {
          throw new CreativePlanningProcessingError("PLANNING_EVENT_RELEASE_FAILED", true);
        }
      }
      throw failure;
    }
  }

  async deadLetter(input: { eventId: string; workspaceId: string; creativeBriefRevisionId: string; reason: string }) {
    await this.store.failCreativePlan({
      workspaceId: input.workspaceId,
      creativeBriefRevisionId: input.creativeBriefRevisionId,
      code: "PLANNING_FAILED",
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: input.eventId,
      },
    });
    await this.store.releaseCreativePlanningEvent({
      eventId: input.eventId,
      workspaceId: input.workspaceId,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      reason: input.reason,
      deadLetter: true,
      now: new Date(),
    });
  }
}
