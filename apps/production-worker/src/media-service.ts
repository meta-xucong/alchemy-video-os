import { createHash } from "node:crypto";

import {
  InternalMediaRuntimeQueueMessageSchema,
  type InternalMediaRuntimeQueueMessage,
} from "@alchemy-video/contracts";
import type {
  OutboxRelayStore,
  PersistedOutboxEvent,
  ProductionStore,
} from "@alchemy-video/persistence";
import type { MediaRuntimeQueuePort } from "@alchemy-video/task-queue";
import {
  StorageObjectAlreadyExistsError,
  createComposedVideoObjectKey,
  createHandoffFrameObjectKey,
  type StoragePort,
} from "@alchemy-video/storage-client";

const mediaRuntimeEventTypes = [
  "production_segment.qc_requested",
  "video_version.composition_requested",
] as const;

type MediaRuntimeQueueEvent = Extract<
  PersistedOutboxEvent["event"],
  { event_type: (typeof mediaRuntimeEventTypes)[number] }
>;

const isMediaRuntimeQueueEvent = (event: PersistedOutboxEvent["event"]): event is MediaRuntimeQueueEvent =>
  mediaRuntimeEventTypes.includes(event.event_type as (typeof mediaRuntimeEventTypes)[number]);

const failureReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);

const terminalFailure = (reason: string) => {
  if (reason.includes("MEDIA_RENDER_FAILED")) return { errorCode: "MEDIA_RENDER_FAILED" as const, retryable: false };
  if (reason.includes("QC_FAILED")) return { errorCode: "QC_FAILED" as const, retryable: false };
  return { errorCode: "MEDIA_RUNTIME_UNAVAILABLE" as const, retryable: true };
};

const MAX_SINGLE_VIDEO_BYTES = 50 * 1024 * 1024;

type MediaRuntimeClient = {
  inspect(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<unknown>;
  extractHandoffFrame(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<{
    bytes: Uint8Array;
    sha256: string;
    byte_size: number;
    width: number;
    height: number;
  }>;
  compose(input: { operationId: string; segments: readonly Uint8Array[] }): Promise<{
    bytes: Uint8Array;
    inspection: { sha256: string; byte_size: number; duration_ms: number };
  }>;
};

const mediaOperationId = (eventId: string, suffix: string) => `mop_${eventId.slice(4)}_${suffix}`;
const derivedAssetId = (eventId: string) => `ast_${eventId.slice(4)}`;

const readStorageBytes = async (storage: StoragePort, input: {
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}) => {
  if (input.byteSize < 1 || input.byteSize > MAX_SINGLE_VIDEO_BYTES || input.mimeType !== "video/mp4") {
    throw new Error("Media Runtime source asset is outside the bounded MP4 contract.");
  }
  const object = await storage.readObject({ objectKey: input.objectKey });
  if (!object || object.mimeType.toLowerCase() !== input.mimeType || object.byteSize !== undefined && object.byteSize !== input.byteSize) {
    throw new Error("Media Runtime source asset is not available.");
  }
  const reader = object.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > input.byteSize || total > MAX_SINGLE_VIDEO_BYTES) {
        await reader.cancel("media source exceeds bounded contract");
        throw new Error("Media Runtime source asset exceeds the bounded MP4 contract.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== input.byteSize || sha256 !== input.sha256) {
    throw new Error("Media Runtime source asset metadata does not match its stored bytes.");
  }
  return bytes;
};

const storeArtifact = async (storage: StoragePort, input: {
  objectKey: string;
  mimeType: "image/png" | "video/mp4";
  bytes: Uint8Array;
  sha256: string;
}) => {
  try {
    await storage.putObject({ objectKey: input.objectKey, mimeType: input.mimeType, bytes: input.bytes, ifNoneMatch: "*" });
    return;
  } catch (error) {
    if (!(error instanceof StorageObjectAlreadyExistsError)) throw error;
  }
  const existing = await storage.inspectObject({ objectKey: input.objectKey });
  if (!existing || existing.mimeType !== input.mimeType || existing.byteSize !== input.bytes.byteLength || existing.sha256 !== input.sha256) {
    throw new Error("Media Runtime derived object conflicts with persisted media bytes.");
  }
};

export const createMediaRuntimeQueueMessage = (outbox: PersistedOutboxEvent): InternalMediaRuntimeQueueMessage | undefined => {
  if (!isMediaRuntimeQueueEvent(outbox.event)) return undefined;
  if (outbox.id !== outbox.event.event_id || outbox.workspaceId !== outbox.event.workspace_id || !outbox.event.project_id) {
    throw new Error("Media Runtime outbox row and event envelope scope do not match.");
  }
  const base = {
    contract_version: outbox.event.contract_version,
    event_type: outbox.event.event_type,
    event_id: outbox.id,
    workspace_id: outbox.workspaceId,
    project_id: outbox.event.project_id,
    production_run_id: outbox.event.data.production_run_id,
    correlation_id: outbox.event.correlation_id,
  };
  if (outbox.event.event_type === "production_segment.qc_requested") {
    return InternalMediaRuntimeQueueMessageSchema.parse({
      ...base,
      production_segment_id: outbox.event.data.production_segment_id,
      task_run_id: outbox.event.data.task_run_id,
    });
  }
  return InternalMediaRuntimeQueueMessageSchema.parse(base);
};

export class MediaRuntimeOutboxRelay {
  constructor(
    private readonly store: OutboxRelayStore,
    private readonly queue: MediaRuntimeQueuePort,
    private readonly input: { relayId: string; leaseMs: number; retryDelayMs: number; maxAttempts: number; batchSize: number },
  ) {}

  async runOnce(now = new Date()) {
    const claimed = await this.store.claimOutboxEvents({
      relayId: this.input.relayId,
      now,
      leaseMs: this.input.leaseMs,
      limit: this.input.batchSize,
      eventTypes: mediaRuntimeEventTypes,
    });
    const result = { published: 0, retried: 0, deadLettered: 0 };
    for (const outbox of claimed) {
      try {
        const message = createMediaRuntimeQueueMessage(outbox);
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

export class MediaRuntimeEventConsumer {
  constructor(
    private readonly store: Pick<
      ProductionStore,
      "claimMediaRuntimeEvent" | "completeMediaRuntimeEvent" | "releaseMediaRuntimeEvent"
      | "findProductionSegmentQcInput" | "findProductionCompositionInput"
      | "acceptProductionSegmentQc" | "completeProductionComposition" | "failMediaRuntimeEvent"
    >,
    private readonly storage: StoragePort,
    private readonly runtime: MediaRuntimeClient,
    private readonly input: { consumerName: string; workerId: string; leaseMs: number },
  ) {}

  async process(message: InternalMediaRuntimeQueueMessage) {
    const claim = await this.store.claimMediaRuntimeEvent({
      message,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      leaseMs: this.input.leaseMs,
      now: new Date(),
    });
    if (claim.kind === "RETRY" || claim.kind === "BUSY") {
      throw new Error(`Media Runtime event ${message.event_id} requires another delivery attempt.`);
    }
    if (claim.kind === "DUPLICATE") return claim.kind;
    if (claim.kind !== "CLAIMED") return claim.kind;

    const now = new Date();
    if (claim.event.event_type === "production_segment.qc_requested") {
      const source = await this.store.findProductionSegmentQcInput({ event: claim.event });
      if (source) {
        const bytes = await readStorageBytes(this.storage, source.sourceAsset);
        await this.runtime.inspect({
          operationId: mediaOperationId(claim.event.event_id, "inspect"),
          bytes,
          expectedSha256: source.sourceAsset.sha256,
        });
        const handoff = await this.runtime.extractHandoffFrame({
          operationId: mediaOperationId(claim.event.event_id, "handoff"),
          bytes,
          expectedSha256: source.sourceAsset.sha256,
        });
        const assetId = derivedAssetId(claim.event.event_id);
        const objectKey = createHandoffFrameObjectKey({ workspaceId: source.workspaceId, projectId: source.projectId, assetId });
        await storeArtifact(this.storage, { objectKey, mimeType: "image/png", bytes: handoff.bytes, sha256: handoff.sha256 });
        await this.store.acceptProductionSegmentQc({
          event: claim.event,
          handoffAsset: {
            id: assetId,
            objectKey,
            sha256: handoff.sha256,
            byteSize: handoff.byte_size,
            width: handoff.width,
            height: handoff.height,
          },
          now,
        });
      }
    } else {
      const source = await this.store.findProductionCompositionInput({ event: claim.event });
      if (source) {
        const segments = await Promise.all(source.segments.map((segment) => readStorageBytes(this.storage, segment.sourceAsset)));
        const composed = await this.runtime.compose({
          operationId: mediaOperationId(claim.event.event_id, "compose"),
          segments,
        });
        const assetId = derivedAssetId(claim.event.event_id);
        const objectKey = createComposedVideoObjectKey({ workspaceId: source.workspaceId, projectId: source.projectId, assetId });
        await storeArtifact(this.storage, { objectKey, mimeType: "video/mp4", bytes: composed.bytes, sha256: composed.inspection.sha256 });
        await this.store.completeProductionComposition({
          event: claim.event,
          videoAsset: {
            id: assetId,
            objectKey,
            sha256: composed.inspection.sha256,
            byteSize: composed.inspection.byte_size,
            durationMs: composed.inspection.duration_ms,
          },
          now,
        });
      }
    }
    await this.store.completeMediaRuntimeEvent({
      eventId: message.event_id,
      workspaceId: message.workspace_id,
      consumerName: this.input.consumerName,
      workerId: this.input.workerId,
      now,
    });
    return claim.kind;
  }

  async deadLetter(input: { eventId: string; workspaceId: string; reason: string }) {
    const failure = terminalFailure(input.reason);
    await this.store.failMediaRuntimeEvent({
      eventId: input.eventId,
      workspaceId: input.workspaceId,
      errorCode: failure.errorCode,
      retryable: failure.retryable,
      now: new Date(),
    });
    await this.store.releaseMediaRuntimeEvent({
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
