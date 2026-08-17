import { InternalDocumentConversionQueueMessageSchema, type InternalDocumentConversionQueueMessage } from "@alchemy-video/contracts";
import type { DocumentConversionEventResult, DocumentConversionStore, OutboxRelayStore, PersistedOutboxEvent } from "@alchemy-video/persistence";
import type { DocumentConversionQueuePort } from "@alchemy-video/task-queue";

import type { DocumentConversionExecutor } from "./execution-service.js";

const failureReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);

const documentEventTypes = [
  "document_conversion.queued",
  "document_conversion.started",
  "document_conversion.succeeded",
  "document_conversion.failed",
] as const;

export const createDocumentConversionQueueMessage = (outbox: PersistedOutboxEvent): InternalDocumentConversionQueueMessage | undefined => {
  if (outbox.event.event_type !== "document_conversion.queued") return undefined;
  if (outbox.id !== outbox.event.event_id || outbox.workspaceId !== outbox.event.workspace_id || !outbox.event.project_id) {
    throw new Error("Document outbox row and event envelope scope do not match.");
  }
  return InternalDocumentConversionQueueMessageSchema.parse({
    contract_version: outbox.event.contract_version,
    event_id: outbox.id,
    workspace_id: outbox.workspaceId,
    project_id: outbox.event.project_id,
    conversion_id: outbox.event.data.conversion_id,
    source_asset_id: outbox.event.data.source_asset_id,
    correlation_id: outbox.event.correlation_id,
  });
};

export class DocumentOutboxRelay {
  constructor(
    private readonly store: OutboxRelayStore,
    private readonly queue: DocumentConversionQueuePort,
    private readonly input: { relayId: string; leaseMs: number; retryDelayMs: number; maxAttempts: number; batchSize: number },
  ) {}

  async runOnce(now = new Date()) {
    const claimed = await this.store.claimOutboxEvents({
      relayId: this.input.relayId,
      now,
      leaseMs: this.input.leaseMs,
      limit: this.input.batchSize,
      eventTypes: documentEventTypes,
    });
    const result = { published: 0, retried: 0, deadLettered: 0 };
    for (const outbox of claimed) {
      try {
        const message = createDocumentConversionQueueMessage(outbox);
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

export class DocumentConversionEventConsumer {
  constructor(
    private readonly store: Pick<DocumentConversionStore, "processDocumentConversionEvent" | "releaseDocumentConversionEvent">,
    private readonly executor: Pick<DocumentConversionExecutor, "execute">,
    private readonly input: { consumerName: string; workerId: string; leaseMs: number },
  ) {}

  async process(message: InternalDocumentConversionQueueMessage): Promise<DocumentConversionEventResult> {
    const result = await this.store.processDocumentConversionEvent({
      message,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      leaseMs: this.input.leaseMs,
      now: new Date(),
    });
    if (result === "RETRY" || result === "BUSY") throw new Error(`Document conversion event ${message.event_id} requires another delivery attempt.`);
    await this.executor.execute({ workspaceId: message.workspace_id, conversionId: message.conversion_id });
    return result;
  }

  async deadLetter(input: { eventId: string; workspaceId: string; reason: string }) {
    await this.store.releaseDocumentConversionEvent({
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
