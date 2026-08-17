import assert from "node:assert/strict";
import test from "node:test";

import { InternalDocumentConversionQueueMessageSchema } from "@alchemy-video/contracts";

import { DocumentConversionEventConsumer, createDocumentConversionQueueMessage } from "../src/service.js";

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
