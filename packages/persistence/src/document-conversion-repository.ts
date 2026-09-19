import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  InternalDocumentConversionQueueMessageSchema,
  InternalEventEnvelopeSchema,
  type InternalDocumentConversionQueueMessage,
} from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import type { ControlAsset } from "./asset-workspace-repository.js";
import { assets, commandDeduplications, documentConversions, documentKnowledgeRevisions, documents, eventConsumptions, outboxEvents, projects } from "./schema.js";

export type DocumentConversionStatus = "CREATED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ControlDocumentConversion = {
  id: string;
  documentId: string;
  workspaceId: string;
  projectId: string;
  sourceAssetId: string;
  sourceSha256: string;
  sourceMimeType: string;
  sourceFilename: string;
  sourceByteSize: number;
  sourceObjectKey: string;
  status: DocumentConversionStatus;
  retryable: boolean;
  markdownAssetId: string | null;
  warnings: string[];
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentConversionCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  sourceAssetId: string;
  documentId: string;
  conversionId: string;
  event: { eventId: string; messageId: string; traceId: string; correlationId: string };
};

export type DocumentConversionTransitionEvent = DocumentConversionCommandInput["event"];

/**
 * Optional bridge used by the in-memory local composition to mirror the
 * Drizzle conversion-success transaction.  Production uses the database
 * transaction below, while the bridge keeps the no-database Control API from
 * reporting a conversion as complete without creating its knowledge queue
 * fact.
 */
export type DocumentConversionKnowledgeBridgeInput = {
  workspaceId: string;
  projectId: string;
  documentId: string;
  conversionId: string;
  markdownAssetId: string;
  markdownSha256: string;
  event: DocumentConversionTransitionEvent;
};
export type DocumentConversionKnowledgeBridge = (input: DocumentConversionKnowledgeBridgeInput) => Promise<void> | void;

type CommandOutcome<T> = { kind: "NEW" | "REPLAY"; value: T; status: 202 } | { kind: "CONFLICT" | "NOT_FOUND" | "INVALID_SOURCE" | "ACTIVE_CONFLICT" | "STATE_INVALID" };
export type DocumentConversionSource = Pick<ControlDocumentConversion, "id" | "workspaceId" | "projectId" | "sourceAssetId" | "sourceObjectKey" | "sourceMimeType" | "sourceFilename" | "sourceSha256" | "sourceByteSize" | "status" | "attemptCount">;
export type DocumentConversionEventResult = "PROCESSED" | "DUPLICATE" | "BUSY" | "RETRY";

const activeStatuses: DocumentConversionStatus[] = ["CREATED", "QUEUED", "RUNNING"];
const documentMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/plain",
]);

const commandKey = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;
const now = () => new Date().toISOString();
const sourceFilename = (metadata: Record<string, unknown>) => typeof metadata.filename === "string" ? metadata.filename : "document";

const serialize = (conversion: typeof documentConversions.$inferSelect, sourceObjectKey: string): ControlDocumentConversion => ({
  id: conversion.id,
  documentId: conversion.documentId,
  workspaceId: conversion.workspaceId,
  projectId: conversion.projectId,
  sourceAssetId: conversion.sourceAssetId,
  sourceSha256: conversion.sourceSha256,
  sourceMimeType: conversion.sourceMimeType,
  sourceFilename: conversion.sourceFilename,
  sourceByteSize: conversion.sourceByteSize,
  sourceObjectKey,
  status: conversion.status,
  retryable: typeof conversion.error?.retryable === "boolean" ? conversion.error.retryable : false,
  markdownAssetId: conversion.markdownAssetId,
  warnings: conversion.warnings,
  attemptCount: conversion.attemptCount,
  createdAt: conversion.createdAt,
  updatedAt: conversion.updatedAt,
});

const isConvertibleSource = (asset: typeof assets.$inferSelect) =>
  asset.kind === "DOCUMENT"
  && asset.origin === "USER_UPLOAD"
  && asset.status === "READY"
  && Boolean(asset.sha256)
  && Boolean(asset.mimeType)
  && Boolean(asset.byteSize)
  && documentMimeTypes.has(asset.mimeType ?? "");

export interface DocumentConversionStore {
  listProjectDocumentConversions(workspaceId: string, projectId: string): Promise<ControlDocumentConversion[]>;
  findDocumentConversion(workspaceId: string, conversionId: string): Promise<ControlDocumentConversion | undefined>;
  listRecoverableDocumentConversions(input: { limit: number }): Promise<DocumentConversionSource[]>;
  createDocumentConversion(input: DocumentConversionCommandInput): Promise<CommandOutcome<ControlDocumentConversion>>;
  retryDocumentConversion(input: Omit<DocumentConversionCommandInput, "projectId" | "sourceAssetId" | "documentId" | "conversionId"> & { conversionId: string }): Promise<CommandOutcome<ControlDocumentConversion>>;
  startDocumentConversion(input: { workspaceId: string; conversionId: string; event: DocumentConversionTransitionEvent }): Promise<DocumentConversionSource | undefined>;
  failDocumentConversion(input: { workspaceId: string; conversionId: string; attemptNo?: number; code: string; retryable: boolean; event: DocumentConversionTransitionEvent }): Promise<ControlDocumentConversion | undefined>;
  completeDocumentConversion(input: { workspaceId: string; conversionId: string; attemptNo: number; markdownAssetId: string; markdownObjectKey: string; markdownBytes: number; markdownSha256: string; converter: string; converterVersion: string; warnings: string[]; event: DocumentConversionTransitionEvent }): Promise<ControlDocumentConversion | undefined>;
  processDocumentConversionEvent(input: { message: InternalDocumentConversionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<DocumentConversionEventResult>;
  releaseDocumentConversionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
}

type StoredCommand = { hash: string; result: { kind: "CONVERSION"; conversionId: string } | { kind: "NOT_FOUND" } | { kind: "INVALID_SOURCE" } | { kind: "ACTIVE_CONFLICT" } | { kind: "STATE_INVALID" } };

export class InMemoryDocumentConversionStore implements DocumentConversionStore {
  private readonly conversions = new Map<string, ControlDocumentConversion>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly consumedEvents = new Set<string>();

  constructor(
    private readonly sourceResolver?: Pick<{ findAsset(workspaceId: string, assetId: string): Promise<ControlAsset | undefined> }, "findAsset">,
    private readonly knowledgeBridge?: DocumentConversionKnowledgeBridge,
  ) {}

  async listProjectDocumentConversions(workspaceId: string, projectId: string) {
    return [...this.conversions.values()].filter((value) => value.workspaceId === workspaceId && value.projectId === projectId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async findDocumentConversion(workspaceId: string, conversionId: string) {
    const value = this.conversions.get(conversionId);
    return value?.workspaceId === workspaceId ? value : undefined;
  }

  async listRecoverableDocumentConversions(input: { limit: number }) {
    return [...this.conversions.values()]
      .filter((value) => value.status === "QUEUED" || value.status === "RUNNING")
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, input.limit);
  }

  async createDocumentConversion(input: DocumentConversionCommandInput): Promise<CommandOutcome<ControlDocumentConversion>> {
    const replay = this.replay(input);
    if (replay) return replay;
    const source = await this.sourceResolver?.findAsset(input.workspaceId, input.sourceAssetId);
    if (!source || source.projectId !== input.projectId || !isConvertibleSource(source as typeof assets.$inferSelect)) {
      return this.store(input, { kind: "INVALID_SOURCE" });
    }
    if ([...this.conversions.values()].some((value) => value.workspaceId === input.workspaceId && value.sourceAssetId === input.sourceAssetId && activeStatuses.includes(value.status))) {
      return this.store(input, { kind: "ACTIVE_CONFLICT" });
    }
    const time = now();
    const conversion: ControlDocumentConversion = {
      id: input.conversionId, documentId: input.documentId, workspaceId: input.workspaceId, projectId: input.projectId,
      sourceAssetId: input.sourceAssetId, sourceSha256: source.sha256!, sourceMimeType: source.mimeType!, sourceFilename: sourceFilename(source.metadata), sourceByteSize: source.byteSize!, sourceObjectKey: source.objectKey,
      status: "QUEUED", retryable: false, markdownAssetId: null, warnings: [], attemptCount: 0, createdAt: time, updatedAt: time,
    };
    this.conversions.set(conversion.id, conversion);
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { hash: input.requestHash, result: { kind: "CONVERSION", conversionId: conversion.id } });
    return { kind: "NEW", value: conversion, status: 202 };
  }

  async retryDocumentConversion(input: Omit<DocumentConversionCommandInput, "projectId" | "sourceAssetId" | "documentId" | "conversionId"> & { conversionId: string }): Promise<CommandOutcome<ControlDocumentConversion>> {
    const replay = this.replay(input);
    if (replay) return replay;
    const current = await this.findDocumentConversion(input.workspaceId, input.conversionId);
    if (!current) return this.store(input, { kind: "NOT_FOUND" });
    if (current.status !== "FAILED" || !current.retryable) return this.store(input, { kind: "STATE_INVALID" });
    const updated = { ...current, status: "QUEUED" as const, retryable: false, updatedAt: now() };
    this.conversions.set(updated.id, updated);
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { hash: input.requestHash, result: { kind: "CONVERSION", conversionId: updated.id } });
    return { kind: "NEW", value: updated, status: 202 };
  }

  async startDocumentConversion(input: { workspaceId: string; conversionId: string; event: DocumentConversionTransitionEvent }) {
    const current = await this.findDocumentConversion(input.workspaceId, input.conversionId);
    if (!current || current.status !== "QUEUED") return undefined;
    const updated = { ...current, status: "RUNNING" as const, attemptCount: current.attemptCount + 1, updatedAt: now() };
    this.conversions.set(updated.id, updated);
    return updated;
  }

  async failDocumentConversion(input: { workspaceId: string; conversionId: string; attemptNo?: number; code: string; retryable: boolean; event: DocumentConversionTransitionEvent }) {
    const current = await this.findDocumentConversion(input.workspaceId, input.conversionId);
    if (!current || !["QUEUED", "RUNNING"].includes(current.status) || (input.attemptNo !== undefined && input.attemptNo !== current.attemptCount)) return undefined;
    const updated = { ...current, status: "FAILED" as const, retryable: input.retryable, updatedAt: now() };
    this.conversions.set(updated.id, updated);
    return updated;
  }

  async completeDocumentConversion(input: { workspaceId: string; conversionId: string; attemptNo: number; markdownAssetId: string; markdownObjectKey: string; markdownBytes: number; markdownSha256: string; converter: string; converterVersion: string; warnings: string[]; event: DocumentConversionTransitionEvent }) {
    const current = await this.findDocumentConversion(input.workspaceId, input.conversionId);
    if (!current || current.status === "SUCCEEDED") return current;
    if (current.status !== "RUNNING" || current.attemptCount !== input.attemptNo) return undefined;
    const updated = { ...current, status: "SUCCEEDED" as const, retryable: false, markdownAssetId: input.markdownAssetId, warnings: input.warnings, updatedAt: now() };
    await this.knowledgeBridge?.({
      workspaceId: updated.workspaceId,
      projectId: updated.projectId,
      documentId: updated.documentId,
      conversionId: updated.id,
      markdownAssetId: input.markdownAssetId,
      markdownSha256: input.markdownSha256,
      event: input.event,
    });
    this.conversions.set(updated.id, updated);
    return updated;
  }

  async processDocumentConversionEvent(input: { message: InternalDocumentConversionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }) {
    const message = InternalDocumentConversionQueueMessageSchema.parse(input.message);
    const conversion = await this.findDocumentConversion(message.workspace_id, message.conversion_id);
    if (!conversion || conversion.projectId !== message.project_id || conversion.sourceAssetId !== message.source_asset_id) return "RETRY";
    const key = `${message.workspace_id}:${message.event_id}:${input.consumerName}`;
    if (this.consumedEvents.has(key)) return "DUPLICATE";
    this.consumedEvents.add(key);
    return "PROCESSED";
  }

  async releaseDocumentConversionEvent() {
    return undefined;
  }

  private replay(input: { scope: string; idempotencyKey: string; requestHash: string }): CommandOutcome<ControlDocumentConversion> | undefined {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.hash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.result.kind === "CONVERSION") {
      const conversion = this.conversions.get(stored.result.conversionId);
      return conversion ? { kind: "REPLAY", value: conversion, status: 202 } : { kind: "CONFLICT" };
    }
    return stored.result.kind === "NOT_FOUND" || stored.result.kind === "INVALID_SOURCE" || stored.result.kind === "ACTIVE_CONFLICT" || stored.result.kind === "STATE_INVALID"
      ? stored.result
      : { kind: "CONFLICT" };
  }

  private store(input: { scope: string; idempotencyKey: string; requestHash: string }, result: Exclude<StoredCommand["result"], { kind: "CONVERSION" }>): Exclude<CommandOutcome<ControlDocumentConversion>, { kind: "NEW" | "REPLAY"; value: ControlDocumentConversion; status: 202 }> {
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { hash: input.requestHash, result });
    return result;
  }
}

export class DrizzleDocumentConversionRepository implements DocumentConversionStore {
  constructor(private readonly db: PlatformDatabase) {}

  async listProjectDocumentConversions(workspaceId: string, projectId: string) {
    const rows = await this.db
      .select({ conversion: documentConversions, objectKey: assets.objectKey })
      .from(documentConversions)
      .innerJoin(assets, and(eq(assets.workspaceId, documentConversions.workspaceId), eq(assets.id, documentConversions.sourceAssetId)))
      .where(and(eq(documentConversions.workspaceId, workspaceId), eq(documentConversions.projectId, projectId)))
      .orderBy(asc(documentConversions.createdAt));
    return rows.map((row) => serialize(row.conversion, row.objectKey));
  }

  async findDocumentConversion(workspaceId: string, conversionId: string) {
    const [row] = await this.db
      .select({ conversion: documentConversions, objectKey: assets.objectKey })
      .from(documentConversions)
      .innerJoin(assets, and(eq(assets.workspaceId, documentConversions.workspaceId), eq(assets.id, documentConversions.sourceAssetId)))
      .where(and(eq(documentConversions.workspaceId, workspaceId), eq(documentConversions.id, conversionId)))
      .limit(1);
    return row ? serialize(row.conversion, row.objectKey) : undefined;
  }

  async listRecoverableDocumentConversions(input: { limit: number }) {
    const rows = await this.db
      .select({ conversion: documentConversions, objectKey: assets.objectKey })
      .from(documentConversions)
      .innerJoin(assets, and(eq(assets.workspaceId, documentConversions.workspaceId), eq(assets.id, documentConversions.sourceAssetId)))
      .where(inArray(documentConversions.status, ["QUEUED", "RUNNING"]))
      .orderBy(asc(documentConversions.updatedAt), asc(documentConversions.id))
      .limit(input.limit);
    return rows.map((row) => serialize(row.conversion, row.objectKey));
  }

  async createDocumentConversion(input: DocumentConversionCommandInput): Promise<CommandOutcome<ControlDocumentConversion>> {
    return this.db.transaction(async (transaction) => {
      const existing = await reserve(transaction, input);
      if (existing) return this.replayReserved(transaction, input.workspaceId, existing);
      const [source] = await transaction.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.projectId, input.projectId), eq(assets.id, input.sourceAssetId))).limit(1);
      if (!source || !isConvertibleSource(source)) return storeOutcome(transaction, input, { kind: "INVALID_SOURCE" });
      await serializeDocumentSource(transaction, input.workspaceId, input.sourceAssetId);
      const [project] = await transaction.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.id, input.projectId))).limit(1);
      if (!project) return storeOutcome(transaction, input, { kind: "NOT_FOUND" });
      const [active] = await transaction.select({ id: documentConversions.id }).from(documentConversions).where(and(eq(documentConversions.workspaceId, input.workspaceId), eq(documentConversions.sourceAssetId, input.sourceAssetId), inArray(documentConversions.status, activeStatuses))).limit(1);
      if (active) return storeOutcome(transaction, input, { kind: "ACTIVE_CONFLICT" });
      let [document] = await transaction.select().from(documents).where(and(eq(documents.workspaceId, input.workspaceId), eq(documents.sourceAssetId, input.sourceAssetId))).limit(1);
      if (!document) {
        [document] = await transaction.insert(documents).values({ id: input.documentId, workspaceId: input.workspaceId, projectId: input.projectId, sourceAssetId: input.sourceAssetId, status: "READY" }).returning();
      }
      const [conversion] = await transaction.insert(documentConversions).values({
        id: input.conversionId, workspaceId: input.workspaceId, projectId: input.projectId, documentId: document.id,
        sourceAssetId: source.id, sourceSha256: source.sha256!, sourceMimeType: source.mimeType!, sourceFilename: sourceFilename(source.metadata), sourceByteSize: source.byteSize!, status: "QUEUED",
      }).returning();
      await writeEvent(transaction, input, conversion, "document_conversion.queued");
      await storeSnapshot(transaction, input, { kind: "CONVERSION", conversionId: conversion.id });
      return { kind: "NEW", value: serialize(conversion, source.objectKey), status: 202 };
    });
  }

  async retryDocumentConversion(input: Omit<DocumentConversionCommandInput, "projectId" | "sourceAssetId" | "documentId" | "conversionId"> & { conversionId: string }): Promise<CommandOutcome<ControlDocumentConversion>> {
    return this.db.transaction(async (transaction) => {
      const existing = await reserve(transaction, input);
      if (existing) return this.replayReserved(transaction, input.workspaceId, existing);
      const current = await loadConversionForUpdate(transaction, input.workspaceId, input.conversionId);
      if (!current) return storeOutcome(transaction, input, { kind: "NOT_FOUND" });
      if (current.conversion.status !== "FAILED" || current.conversion.error?.retryable !== true) return storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      const [conversion] = await transaction.update(documentConversions).set({ status: "QUEUED", error: null, updatedAt: now() }).where(and(eq(documentConversions.workspaceId, input.workspaceId), eq(documentConversions.id, input.conversionId), eq(documentConversions.status, "FAILED"))).returning();
      if (!conversion) return storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      await writeEvent(transaction, { ...input, projectId: conversion.projectId, sourceAssetId: conversion.sourceAssetId, documentId: conversion.documentId, conversionId: conversion.id }, conversion, "document_conversion.queued");
      await storeSnapshot(transaction, input, { kind: "CONVERSION", conversionId: conversion.id });
      return { kind: "NEW", value: serialize(conversion, current.sourceObjectKey), status: 202 };
    });
  }

  async startDocumentConversion(input: { workspaceId: string; conversionId: string; event: DocumentConversionTransitionEvent }) {
    return this.db.transaction(async (transaction) => {
      const current = await loadConversionForUpdate(transaction, input.workspaceId, input.conversionId);
      if (!current || current.conversion.status !== "QUEUED") return undefined;
      const [conversion] = await transaction.update(documentConversions).set({ status: "RUNNING", attemptCount: sql`${documentConversions.attemptCount} + 1`, updatedAt: now() }).where(and(eq(documentConversions.workspaceId, input.workspaceId), eq(documentConversions.id, input.conversionId), eq(documentConversions.status, "QUEUED"))).returning();
      if (!conversion) return undefined;
      await transaction.insert(outboxEvents).values(eventRow({ ...input.event, workspaceId: conversion.workspaceId, projectId: conversion.projectId, aggregateId: conversion.id, eventType: "document_conversion.started", data: { conversion_id: conversion.id, source_asset_id: conversion.sourceAssetId } }));
      return serialize(conversion, current.sourceObjectKey);
    });
  }

  async failDocumentConversion(input: { workspaceId: string; conversionId: string; attemptNo?: number; code: string; retryable: boolean; event: DocumentConversionTransitionEvent }) {
    return this.db.transaction(async (transaction) => {
      const current = await loadConversionForUpdate(transaction, input.workspaceId, input.conversionId);
      if (!current || !["QUEUED", "RUNNING"].includes(current.conversion.status) || (input.attemptNo !== undefined && current.conversion.attemptCount !== input.attemptNo)) return undefined;
      const [conversion] = await transaction.update(documentConversions).set({ status: "FAILED", error: { code: input.code, retryable: input.retryable }, updatedAt: now() }).where(and(eq(documentConversions.workspaceId, input.workspaceId), eq(documentConversions.id, input.conversionId), inArray(documentConversions.status, ["QUEUED", "RUNNING"]), ...(input.attemptNo === undefined ? [] : [eq(documentConversions.attemptCount, input.attemptNo)]))).returning();
      if (!conversion) return undefined;
      await transaction.insert(outboxEvents).values(eventRow({ ...input.event, workspaceId: conversion.workspaceId, projectId: conversion.projectId, aggregateId: conversion.id, eventType: "document_conversion.failed", data: { conversion_id: conversion.id, source_asset_id: conversion.sourceAssetId, retryable: input.retryable } }));
      return serialize(conversion, current.sourceObjectKey);
    });
  }

  async completeDocumentConversion(input: { workspaceId: string; conversionId: string; attemptNo: number; markdownAssetId: string; markdownObjectKey: string; markdownBytes: number; markdownSha256: string; converter: string; converterVersion: string; warnings: string[]; event: DocumentConversionTransitionEvent }) {
    return this.db.transaction(async (transaction) => {
      const current = await loadConversionForUpdate(transaction, input.workspaceId, input.conversionId);
      if (!current) return undefined;
      if (current.conversion.status === "SUCCEEDED") return serialize(current.conversion, current.sourceObjectKey);
      if (current.conversion.status !== "RUNNING" || current.conversion.attemptCount !== input.attemptNo) return undefined;
      const [asset] = await transaction.insert(assets).values({ id: input.markdownAssetId, workspaceId: current.conversion.workspaceId, projectId: current.conversion.projectId, kind: "DOCUMENT", origin: "DERIVED", status: "READY", objectKey: input.markdownObjectKey, sha256: input.markdownSha256, mimeType: "text/markdown", byteSize: input.markdownBytes, metadata: { source_asset_id: current.conversion.sourceAssetId, conversion_id: current.conversion.id, converter: input.converter, converter_version: input.converterVersion } }).returning();
      const [conversion] = await transaction.update(documentConversions).set({ status: "SUCCEEDED", markdownAssetId: asset.id, converter: input.converter, converterVersion: input.converterVersion, warnings: input.warnings, error: null, updatedAt: now() }).where(and(eq(documentConversions.workspaceId, current.conversion.workspaceId), eq(documentConversions.id, current.conversion.id), eq(documentConversions.status, "RUNNING"), eq(documentConversions.attemptCount, input.attemptNo))).returning();
      if (!conversion) throw new Error("Document conversion completion lost its locked state transition.");
      await transaction.insert(outboxEvents).values(eventRow({ ...input.event, workspaceId: conversion.workspaceId, projectId: conversion.projectId, aggregateId: conversion.id, eventType: "document_conversion.succeeded", data: { conversion_id: conversion.id, source_asset_id: conversion.sourceAssetId, markdown_asset_id: asset.id } }));
      const knowledgeRevisionId = `dkr_${conversion.id.slice("dcv_".length)}`;
      const [knowledge] = await transaction.insert(documentKnowledgeRevisions).values({
        id: knowledgeRevisionId,
        workspaceId: conversion.workspaceId,
        projectId: conversion.projectId,
        documentId: conversion.documentId,
        conversionId: conversion.id,
        markdownAssetId: asset.id,
        markdownSha256: input.markdownSha256,
        analyzerVersion: "deterministic-document-understanding-v1",
        status: "QUEUED",
        retryable: false,
        sectionCount: 0,
        factCount: 0,
      }).onConflictDoNothing().returning();
      if (knowledge) {
        const occurredAt = now();
        const knowledgeEventId = createPrefixedId("evt");
        await transaction.insert(outboxEvents).values({
          id: knowledgeEventId, workspaceId: conversion.workspaceId, projectId: conversion.projectId,
          aggregateType: "document_knowledge_revision", aggregateId: knowledge.id,
          eventType: "document_knowledge.queued", occurredAt,
          payload: {
            contract_version: "1.0", message_id: createPrefixedId("msg"), event_id: knowledgeEventId, event_type: "document_knowledge.queued",
            occurred_at: occurredAt, trace_id: createPrefixedId("trc"), correlation_id: input.event.correlationId,
            idempotency_key: `internal:${knowledge.id}`, producer: "document-worker", workspace_id: conversion.workspaceId,
            project_id: conversion.projectId, aggregate: { type: "document_knowledge_revision", id: knowledge.id },
            data: { document_id: conversion.documentId, conversion_id: conversion.id, knowledge_revision_id: knowledge.id }, version: 1,
          },
        });
      }
      return serialize(conversion, current.sourceObjectKey);
    });
  }

  async processDocumentConversionEvent(input: { message: InternalDocumentConversionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<DocumentConversionEventResult> {
    return this.db.transaction(async (transaction) => {
      const message = InternalDocumentConversionQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction.select().from(outboxEvents).where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id))).limit(1);
      if (!outbox) return "RETRY";
      const event = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!event.success
        || event.data.event_type !== "document_conversion.queued"
        || outbox.id !== message.event_id
        || outbox.workspaceId !== message.workspace_id
        || event.data.event_id !== message.event_id
        || event.data.workspace_id !== message.workspace_id
        || event.data.project_id !== message.project_id
        || event.data.correlation_id !== message.correlation_id
        || event.data.data.conversion_id !== message.conversion_id
        || event.data.data.source_asset_id !== message.source_asset_id) return "RETRY";

      const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      const [inserted] = await transaction.insert(eventConsumptions).values({ workspaceId: message.workspace_id, eventId: message.event_id, consumerName: input.consumerName, leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: 1 }).onConflictDoNothing().returning();
      if (!inserted) {
        const [existing] = await transaction.select().from(eventConsumptions).where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName))).limit(1);
        if (!existing || existing.completedAt || existing.deadLetteredAt) return "DUPLICATE";
        const [reclaimed] = await transaction.update(eventConsumptions).set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: input.now.toISOString() }).where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName), isNull(eventConsumptions.completedAt), isNull(eventConsumptions.deadLetteredAt), or(isNull(eventConsumptions.leaseExpiresAt), lte(eventConsumptions.leaseExpiresAt, input.now.toISOString())))).returning();
        if (!reclaimed) return "BUSY";
      }
      const [conversion] = await transaction.select({ id: documentConversions.id }).from(documentConversions).where(and(eq(documentConversions.workspaceId, message.workspace_id), eq(documentConversions.id, message.conversion_id), eq(documentConversions.projectId, message.project_id), eq(documentConversions.sourceAssetId, message.source_asset_id))).limit(1);
      if (!conversion) return "RETRY";
      await transaction.update(eventConsumptions).set({ completedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now.toISOString() }).where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName), eq(eventConsumptions.leaseOwner, input.workerId)));
      return "PROCESSED";
    });
  }

  async releaseDocumentConversionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    await this.db.update(eventConsumptions).set({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: input.reason.replace(/[\r\n]+/g, " ").slice(0, 500),
      ...(input.deadLetter ? { deadLetteredAt: input.now.toISOString() } : {}),
      updatedAt: input.now.toISOString(),
    }).where(and(eq(eventConsumptions.workspaceId, input.workspaceId), eq(eventConsumptions.eventId, input.eventId), eq(eventConsumptions.consumerName, input.consumerName), eq(eventConsumptions.leaseOwner, input.workerId)));
  }

  private async replayReserved(transaction: Pick<PlatformDatabase, "select">, workspaceId: string, snapshot: Record<string, unknown>): Promise<CommandOutcome<ControlDocumentConversion>> {
    if (snapshot.kind !== "CONVERSION" || typeof snapshot.conversion_id !== "string") return snapshotToOutcome(snapshot);
    const [row] = await transaction.select({ conversion: documentConversions, objectKey: assets.objectKey }).from(documentConversions).innerJoin(assets, and(eq(assets.workspaceId, documentConversions.workspaceId), eq(assets.id, documentConversions.sourceAssetId))).where(and(eq(documentConversions.workspaceId, workspaceId), eq(documentConversions.id, snapshot.conversion_id))).limit(1);
    return row ? { kind: "REPLAY", value: serialize(row.conversion, row.objectKey), status: 202 } : { kind: "CONFLICT" };
  }
}

type Transaction = Pick<PlatformDatabase, "execute" | "select" | "insert" | "update">;

const serializeDocumentSource = (transaction: Transaction, workspaceId: string, sourceAssetId: string) =>
  transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${sourceAssetId}))`);

const loadConversionForUpdate = async (transaction: Transaction, workspaceId: string, conversionId: string) => {
  const [row] = await transaction
    .select({ conversion: documentConversions, sourceObjectKey: assets.objectKey })
    .from(documentConversions)
    .innerJoin(assets, and(eq(assets.workspaceId, documentConversions.workspaceId), eq(assets.id, documentConversions.sourceAssetId)))
    .where(and(eq(documentConversions.workspaceId, workspaceId), eq(documentConversions.id, conversionId)))
    .limit(1)
    .for("update");
  return row;
};
const reservationScope = (scope: string, idempotencyKey: string) => and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const reserve = async (transaction: Transaction, input: { scope: string; idempotencyKey: string; requestHash: string }) => {
  const [inserted] = await transaction.insert(commandDeduplications).values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} }).onConflictDoNothing().returning({ scope: commandDeduplications.scope });
  if (inserted) return undefined;
  const [existing] = await transaction.select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot }).from(commandDeduplications).where(reservationScope(input.scope, input.idempotencyKey)).limit(1);
  if (!existing || existing.requestHash !== input.requestHash) return { kind: "CONFLICT" } as const;
  return existing.responseSnapshot;
};

const storeSnapshot = (transaction: Transaction, input: { scope: string; idempotencyKey: string }, outcome: { kind: string; conversionId?: string }) =>
  transaction.update(commandDeduplications).set({ responseSnapshot: outcome.conversionId ? { kind: "CONVERSION", conversion_id: outcome.conversionId } : { kind: outcome.kind } }).where(reservationScope(input.scope, input.idempotencyKey));

const storeOutcome = async <T>(transaction: Transaction, input: { scope: string; idempotencyKey: string }, outcome: Exclude<CommandOutcome<T>, { kind: "NEW" | "REPLAY"; value: T; status: 202 }>) => {
  await storeSnapshot(transaction, input, outcome);
  return outcome;
};

const snapshotToOutcome = (snapshot: Record<string, unknown>): Exclude<CommandOutcome<ControlDocumentConversion>, { kind: "NEW" | "REPLAY"; value: ControlDocumentConversion; status: 202 }> => {
  const kind = snapshot.kind;
  return kind === "NOT_FOUND" || kind === "INVALID_SOURCE" || kind === "ACTIVE_CONFLICT" || kind === "STATE_INVALID" ? { kind } : { kind: "CONFLICT" };
};

const eventRow = (input: { eventId: string; messageId: string; traceId: string; correlationId: string; workspaceId: string; projectId: string; aggregateId: string; eventType: string; data: Record<string, unknown> }) => ({
  id: input.eventId, workspaceId: input.workspaceId, projectId: input.projectId, aggregateType: "document_conversion", aggregateId: input.aggregateId, eventType: input.eventType,
  payload: { contract_version: "1.0", message_id: input.messageId, event_id: input.eventId, event_type: input.eventType, occurred_at: now(), trace_id: input.traceId, correlation_id: input.correlationId, idempotency_key: `internal:${input.eventId}`, producer: "document-worker", workspace_id: input.workspaceId, project_id: input.projectId, aggregate: { type: "document_conversion", id: input.aggregateId }, data: input.data, version: 1 },
  occurredAt: now(),
});

const writeEvent = async (transaction: Transaction, input: DocumentConversionCommandInput, conversion: typeof documentConversions.$inferSelect, eventType: "document_conversion.queued") => {
  await transaction.insert(outboxEvents).values(eventRow({ ...input.event, workspaceId: input.workspaceId, projectId: input.projectId, aggregateId: conversion.id, eventType, data: { conversion_id: conversion.id, document_id: conversion.documentId, source_asset_id: conversion.sourceAssetId } }));
};
