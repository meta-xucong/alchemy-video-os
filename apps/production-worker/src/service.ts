import {
  InternalProductionQueueMessageSchema,
  type InternalProductionQueueMessage,
} from "@alchemy-video/contracts";
import type {
  OutboxRelayStore,
  PersistedOutboxEvent,
  ProductionStore,
} from "@alchemy-video/persistence";
import type { ProductionQueuePort } from "@alchemy-video/task-queue";

const productionEventTypes = [
  "production_run.confirmed",
  "task_run.succeeded",
  "task_run.failed",
  "handoff_asset.accepted",
] as const;

type ProductionQueueEvent = Extract<
  PersistedOutboxEvent["event"],
  { event_type: (typeof productionEventTypes)[number] }
>;

const isProductionQueueEvent = (event: PersistedOutboxEvent["event"]): event is ProductionQueueEvent =>
  productionEventTypes.includes(event.event_type as (typeof productionEventTypes)[number]);

const failureReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);

export const createProductionQueueMessage = (outbox: PersistedOutboxEvent): InternalProductionQueueMessage | undefined => {
  if (!isProductionQueueEvent(outbox.event)) return undefined;
  if (outbox.id !== outbox.event.event_id || outbox.workspaceId !== outbox.event.workspace_id || !outbox.event.project_id) {
    throw new Error("Production outbox row and event envelope scope do not match.");
  }
  const base = {
    contract_version: outbox.event.contract_version,
    event_type: outbox.event.event_type,
    event_id: outbox.id,
    workspace_id: outbox.workspaceId,
    project_id: outbox.event.project_id,
    correlation_id: outbox.event.correlation_id,
  };
  if (outbox.event.event_type === "production_run.confirmed") {
    return InternalProductionQueueMessageSchema.parse({
      ...base,
      event_type: outbox.event.event_type,
      production_run_id: outbox.event.data.production_run_id,
    });
  }
  if (outbox.event.event_type === "handoff_asset.accepted") {
    return InternalProductionQueueMessageSchema.parse({
      ...base,
      event_type: outbox.event.event_type,
      production_run_id: outbox.event.data.production_run_id,
    });
  }
  return InternalProductionQueueMessageSchema.parse({
    ...base,
    event_type: outbox.event.event_type,
    task_run_id: outbox.event.data.task_run_id,
  });
};

export class ProductionOutboxRelay {
  constructor(
    private readonly store: OutboxRelayStore,
    private readonly queue: ProductionQueuePort,
    private readonly input: { relayId: string; leaseMs: number; retryDelayMs: number; maxAttempts: number; batchSize: number },
  ) {}

  async runOnce(now = new Date()) {
    const claimed = await this.store.claimOutboxEvents({
      relayId: this.input.relayId,
      now,
      leaseMs: this.input.leaseMs,
      limit: this.input.batchSize,
      eventTypes: productionEventTypes,
    });
    const result = { published: 0, retried: 0, deadLettered: 0 };
    for (const outbox of claimed) {
      try {
        const message = createProductionQueueMessage(outbox);
        if (message) await this.queue.enqueue(message);
        await this.store.markOutboxPublished({
          eventId: outbox.id,
          workspaceId: outbox.workspaceId,
          relayId: this.input.relayId,
          now,
        });
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

export class ProductionEventConsumer {
  constructor(
    private readonly store: Pick<
      ProductionStore,
      "claimProductionEvent" | "completeProductionEvent" | "releaseProductionEvent" | "initializeProductionRun" | "recordProductionTaskSucceeded" | "recordProductionTaskFailed"
      | "resumeProductionRun"
    >,
    private readonly input: { consumerName: string; workerId: string; leaseMs: number },
  ) {}

  async process(message: InternalProductionQueueMessage) {
    const claim = await this.store.claimProductionEvent({
      message,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      leaseMs: this.input.leaseMs,
      now: new Date(),
    });
    if (claim.kind === "RETRY" || claim.kind === "BUSY") {
      throw new Error(`Production event ${message.event_id} requires another delivery attempt.`);
    }
    if (claim.kind === "DUPLICATE") return claim.kind;
    if (claim.kind !== "CLAIMED") return claim.kind;

    const now = new Date();
    if (claim.event.event_type === "production_run.confirmed") {
      await this.store.initializeProductionRun({ event: claim.event, now });
    } else if (claim.event.event_type === "task_run.succeeded") {
      await this.store.recordProductionTaskSucceeded({ event: claim.event, now });
    } else if (claim.event.event_type === "task_run.failed") {
      await this.store.recordProductionTaskFailed({ event: claim.event, now });
    } else {
      await this.store.resumeProductionRun({ event: claim.event, now });
    }
    await this.store.completeProductionEvent({
      eventId: message.event_id,
      workspaceId: message.workspace_id,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      now,
    });
    return claim.kind;
  }

  async deadLetter(input: { eventId: string; workspaceId: string; reason: string }) {
    await this.store.releaseProductionEvent({
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
