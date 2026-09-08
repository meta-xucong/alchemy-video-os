import assert from "node:assert/strict";
import test from "node:test";

import { InternalDocumentConversionQueueMessageSchema, InternalDocumentKnowledgeQueueMessageSchema } from "@alchemy-video/contracts";

import { DocumentConversionEventConsumer, DocumentKnowledgeOutboxRelay, createDocumentConversionQueueMessage, createDocumentKnowledgeQueueMessage } from "../src/service.js";

const queuedEvent = {
  contract_version: "1.0" as const,
  message_id: "msg_c10_document_service",
  event_id: "evt_c10_document_service",
  event_type: "document_conversion.queued" as const,
  occurred_at: "2026-08-16T00:00:00.000Z",
  trace_id: "trc_c10_document_service",
  correlation_id: "cor_c10_document_service",
  idempotency_key: "internal:evt_c10_document_service",
  producer: "control-api",
  workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  aggregate: { type: "document_conversion" as const, id: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    conversion_id: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    document_id: "doc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    source_asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  },
  version: 1 as const,
};

const queueMessage = () => InternalDocumentConversionQueueMessageSchema.parse({
  contract_version: queuedEvent.contract_version,
  event_id: queuedEvent.event_id,
  workspace_id: queuedEvent.workspace_id,
  project_id: queuedEvent.project_id,
  conversion_id: queuedEvent.data.conversion_id,
  source_asset_id: queuedEvent.data.source_asset_id,
  correlation_id: queuedEvent.correlation_id,
});

test("Document relay refuses an outbox row whose durable scope differs from its internal event", () => {
  assert.throws(() => createDocumentConversionQueueMessage({
    id: queuedEvent.event_id,
    workspaceId: "ws_other_workspace",
    event: queuedEvent,
    publishAttempts: 0,
  }), /scope do not match/);
});

test("Document event consumer executes a duplicate durable delivery and scopes dead-letter cleanup", async () => {
  let executions = 0;
  const releases: Array<Record<string, unknown>> = [];
  const consumer = new DocumentConversionEventConsumer({
    async processDocumentConversionEvent() { return "DUPLICATE" as const; },
    async releaseDocumentConversionEvent(input) { releases.push(input as unknown as Record<string, unknown>); },
  }, {
    async execute() { executions += 1; return undefined; },
  }, {
    consumerName: "c10-document-service",
    workerId: "c10-worker",
    leaseMs: 100,
  });

  assert.equal(await consumer.process(queueMessage()), "DUPLICATE");
  assert.equal(executions, 1);
  await consumer.deadLetter({ eventId: queuedEvent.event_id, workspaceId: queuedEvent.workspace_id, reason: "controlled retry exhaustion" });
  assert.equal(releases[0]?.workspaceId, queuedEvent.workspace_id);
  assert.equal(releases[0]?.eventId, queuedEvent.event_id);
  assert.equal(releases[0]?.deadLetter, true);
});

const knowledgeQueuedEvent = {
  contract_version: "1.0" as const,
  message_id: "msg_c11_knowledge_service",
  event_id: "evt_c11_knowledge_service",
  event_type: "document_knowledge.queued" as const,
  occurred_at: "2026-08-30T00:00:00.000Z",
  trace_id: "trc_c11_knowledge_service",
  correlation_id: "cor_c11_knowledge_service",
  idempotency_key: "internal:evt_c11_knowledge_service",
  producer: "control-api",
  workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  aggregate: { type: "document_knowledge_revision" as const, id: "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
  data: {
    knowledge_revision_id: "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    conversion_id: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  },
  version: 1 as const,
};

test("Knowledge relay validates durable scope and emits the bounded internal queue DTO", () => {
  const message = createDocumentKnowledgeQueueMessage({
    id: knowledgeQueuedEvent.event_id,
    workspaceId: knowledgeQueuedEvent.workspace_id,
    event: knowledgeQueuedEvent,
    publishAttempts: 0,
  });
  assert.deepEqual(message, InternalDocumentKnowledgeQueueMessageSchema.parse({
    contract_version: "1.0",
    event_id: knowledgeQueuedEvent.event_id,
    workspace_id: knowledgeQueuedEvent.workspace_id,
    project_id: knowledgeQueuedEvent.project_id,
    knowledge_revision_id: knowledgeQueuedEvent.data.knowledge_revision_id,
    conversion_id: knowledgeQueuedEvent.data.conversion_id,
    correlation_id: knowledgeQueuedEvent.correlation_id,
  }));
  assert.throws(() => createDocumentKnowledgeQueueMessage({
    id: knowledgeQueuedEvent.event_id,
    workspaceId: "ws_other_workspace",
    event: knowledgeQueuedEvent,
    publishAttempts: 0,
  }), /scope do not match/);
});

test("Knowledge relay marks only successfully enqueued events as published", async () => {
  const published: string[] = [];
  const released: Array<Record<string, unknown>> = [];
  const enqueued: string[] = [];
  const relay = new DocumentKnowledgeOutboxRelay({
    async claimOutboxEvents() {
      return [
        { id: knowledgeQueuedEvent.event_id, workspaceId: knowledgeQueuedEvent.workspace_id, event: knowledgeQueuedEvent, publishAttempts: 0 },
        { id: "evt_c11_knowledge_bad", workspaceId: knowledgeQueuedEvent.workspace_id, event: { ...knowledgeQueuedEvent, event_id: "evt_c11_knowledge_bad", workspace_id: "ws_other_workspace" }, publishAttempts: 0 },
      ];
    },
    async markOutboxPublished(input) { published.push(input.eventId); },
    async releaseOutboxEvent(input) { released.push(input as unknown as Record<string, unknown>); },
  }, {
    async enqueue(message) { enqueued.push(message.event_id); if (message.event_id === "evt_c11_knowledge_bad") throw new Error("queue unavailable"); },
    async close() {},
  }, { relayId: "relay_c11", leaseMs: 1000, retryDelayMs: 50, maxAttempts: 3, batchSize: 10 });

  assert.deepEqual(await relay.runOnce(), { published: 1, retried: 1, deadLettered: 0 });
  assert.deepEqual(enqueued, [knowledgeQueuedEvent.event_id]);
  assert.deepEqual(published, [knowledgeQueuedEvent.event_id]);
  assert.equal(released[0]?.eventId, "evt_c11_knowledge_bad");
});
