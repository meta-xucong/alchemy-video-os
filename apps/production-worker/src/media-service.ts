import { createHash } from "node:crypto";

import {
  InternalMediaRuntimeQueueMessageSchema,
  type InternalMediaRuntimeQueueMessage,
  type MediaRuntimeNarrationDurationMeasurement,
} from "@alchemy-video/contracts";
import type { MediaRuntimeCompositionPlan, MediaRuntimeNarrationSegment } from "@alchemy-video/contracts";
import type { MediaRuntimeNarrationTrackBytes } from "./media-runtime-client.js";
import {
  NARRATION_MEASURED_DURATION_TOLERANCE_MS,
  type OutboxRelayStore,
  type PersistedOutboxEvent,
  type ProductionStore,
  type NarrationAudioGenerationEvent,
  type NarrationAudioGenerationInput,
  type NarrationQualityStore,
} from "@alchemy-video/persistence";
import { evaluateNarrationDurationFeedback, type HandoffEvaluatorPort } from "@alchemy-video/domain";
import type { MediaRuntimeQueuePort } from "@alchemy-video/task-queue";
import {
  StorageObjectAlreadyExistsError,
  createComposedVideoObjectKey,
  createHandoffFrameObjectKey,
  type StoragePort,
} from "@alchemy-video/storage-client";
import { createFixtureHandoffEvaluator } from "./handoff-evaluator.js";

const mediaRuntimeEventTypes = [
  "narration_audio.generation_requested",
  "production_segment.qc_requested",
  "handoff_review.requested",
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

const NATIVE_PROVIDER_ZERO_WORD_QC_FAILURE = "QC_FAILED: native provider speech transcript returned zero words.";

const terminalFailure = (reason: string) => {
  if (reason.includes("MEDIA_RENDER_FAILED")) return { errorCode: "MEDIA_RENDER_FAILED" as const, retryable: false };
  if (reason === NATIVE_PROVIDER_ZERO_WORD_QC_FAILURE) return { errorCode: "QC_FAILED" as const, retryable: true };
  if (reason.includes("QC_FAILED")) return { errorCode: "QC_FAILED" as const, retryable: false };
  return { errorCode: "MEDIA_RUNTIME_UNAVAILABLE" as const, retryable: true };
};

const MAX_SINGLE_VIDEO_BYTES = 50 * 1024 * 1024;

type TimelineWindow = { start_ms: number; end_ms: number };

// Mirrors the existing source-tail coverage check.  A shorter measured
// speech track may only reach its authored window through declared audio or
// HOLD/BROLL windows; no implicit silence is inferred here.
const coversDeclaredTail = (
  actualEndMs: number,
  targetEndMs: number,
  windows: readonly TimelineWindow[],
): boolean => {
  let coveredUntil = actualEndMs;
  for (const window of [...windows].sort((left, right) => left.start_ms - right.start_ms)) {
    if (window.start_ms > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, window.end_ms);
  }
  return coveredUntil >= targetEndMs;
};

// OpenMontage compose 6c treats a checked transcript with zero spoken words
// as a silent/missing narration result and stops.  Keep this check limited to
// explicit native-provider speech expectations; visual/BGM-only clips have
// no provider_text fact and must not be mistaken for missing speech.
const hasTranscriptWords = (value: unknown): boolean => Array.isArray(value)
  && value.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const word = (item as { word?: unknown }).word;
    return typeof word === "string" && word.trim().length > 0;
  });

type MediaRuntimeClient = {
  /** Explicit OpenMontage TTSSelector preferred_provider, if configured. */
  narrationProvider?: string;
  inspect(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<unknown>;
  inspectAudio?(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<{
    mime_type: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm";
    sha256: string;
    byte_size: number;
    duration_ms: number;
  }>;
  finalReview?(input: {
    operationId: string;
    bytes: Uint8Array;
    expectedSha256: string;
    scriptText?: string;
    captionPolicy?: "REQUIRED" | "OPTIONAL" | "OFF";
  }): Promise<{
    status: "PASS" | "NEEDS_ATTENTION" | "FAILED";
    issues_found: string[];
    recommended_action: "PRESENT_WITH_REVIEW" | "REVISE" | "BLOCK";
    audio_spotcheck?: {
      has_audio: boolean;
      audio_sample_rate?: number;
      integrated_lufs?: number;
      true_peak_db?: number;
      loudness_range_lu?: number;
      unexpected_silence: boolean;
    };
  }>;
  burnCaptions?(input: { operationId: string; bytes: Uint8Array; expectedSha256: string; transcript?: Record<string, unknown> }): Promise<{
    bytes: Uint8Array;
    inspection: { sha256: string; byte_size: number; duration_ms: number; has_audio?: boolean; audio_sample_rate?: number };
  }>;
  synthesizeNarration?(input: { operationId: string; scriptText?: string; segments?: MediaRuntimeNarrationSegment[]; targetDurationMs?: number; preferredProvider?: string; voiceId?: string; resourceId?: string; format?: "mp3" | "ogg_opus" | "pcm"; sampleRate?: number; speechRate?: number; enableTimestamp?: boolean; disableMarkdownFilter?: boolean; returnUsage?: boolean; pollIntervalSeconds?: number; timeoutSeconds?: number }): Promise<{
    bytes: Uint8Array;
    mime_type: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm";
    sha256: string;
    byte_size: number;
    duration_ms: number;
  }>;
  extractHandoffFrame(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<{
    bytes: Uint8Array;
    sha256: string;
    byte_size: number;
    width: number;
    height: number;
  }>;
  compose(input: { operationId: string; segments: readonly Uint8Array[]; compositionPlan?: MediaRuntimeCompositionPlan; musicBytes?: Uint8Array; narrationBytes?: Uint8Array; narrationTrackBytes?: readonly MediaRuntimeNarrationTrackBytes[] }): Promise<{
    bytes: Uint8Array;
    inspection: { sha256: string; byte_size: number; duration_ms: number; has_audio?: boolean; audio_sample_rate?: number };
  }>;
  extractBoundaryFrames?(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<{
    first: { bytes: Uint8Array; sha256: string; byte_size: number; width: number; height: number };
    last: { bytes: Uint8Array; sha256: string; byte_size: number; width: number; height: number };
  }>;
  transcribe?(input: { operationId: string; bytes: Uint8Array; expectedSha256: string }): Promise<{
    status: "CHECKED" | "UNAVAILABLE";
    language?: string;
    duration_seconds?: number;
    segments?: unknown[];
    word_timestamps?: unknown[];
    issues: string[];
  }>;
};

const mediaOperationId = (eventId: string, suffix: string) => `mop_${eventId.slice(4)}_${suffix}`;
const derivedAssetId = (eventId: string) => `ast_${eventId.slice(4)}`;

const readStorageBytes = async (storage: StoragePort, input: {
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  expectedObjectKeyPrefix?: string;
}) => {
  const allowedMime = input.mimeType === "video/mp4" || input.mimeType.startsWith("audio/");
  if (input.byteSize < 1 || input.byteSize > MAX_SINGLE_VIDEO_BYTES || !allowedMime
    || !/^[a-f0-9]{64}$/u.test(input.sha256)
    || (input.expectedObjectKeyPrefix !== undefined
      && (!input.objectKey.startsWith(input.expectedObjectKeyPrefix) || input.objectKey.length <= input.expectedObjectKeyPrefix.length))) {
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

const storeAudioArtifact = async (storage: StoragePort, input: {
  objectKey: string;
  mimeType: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm";
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
    throw new Error("Generated narration object conflicts with persisted media bytes.");
  }
};

export const createMediaRuntimeQueueMessage = (outbox: PersistedOutboxEvent): InternalMediaRuntimeQueueMessage | undefined => {
  if (!isMediaRuntimeQueueEvent(outbox.event)) return undefined;
  if (outbox.id !== outbox.event.event_id || outbox.workspaceId !== outbox.event.workspace_id || !outbox.event.project_id) {
    throw new Error("Media Runtime outbox row and event envelope scope do not match.");
  }
  if (outbox.event.event_type === "narration_audio.generation_requested") {
    return InternalMediaRuntimeQueueMessageSchema.parse({
      contract_version: outbox.event.contract_version,
      event_type: outbox.event.event_type,
      event_id: outbox.id,
      workspace_id: outbox.workspaceId,
      project_id: outbox.event.project_id,
      narration_script_revision_id: outbox.event.data.narration_script_revision_id,
      generation_kind: outbox.event.data.generation_kind,
      section_id: outbox.event.data.section_id,
      asset_id: outbox.event.data.asset_id,
      ...(outbox.event.data.narration_asset_version_id ? { narration_asset_version_id: outbox.event.data.narration_asset_version_id } : {}),
      ...(outbox.event.data.sample_asset_id ? { sample_asset_id: outbox.event.data.sample_asset_id } : {}),
      provider: outbox.event.data.provider,
      voice_id: outbox.event.data.voice_id,
      provider_settings: outbox.event.data.provider_settings,
      canonical_script_hash: outbox.event.data.canonical_script_hash,
      object_key: outbox.event.data.object_key,
      correlation_id: outbox.event.correlation_id,
    });
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
  if (outbox.event.event_type === "handoff_review.requested") {
    return InternalMediaRuntimeQueueMessageSchema.parse({
      ...base,
      handoff_review_id: outbox.event.data.handoff_review_id,
      from_sequence: outbox.event.data.from_sequence,
      to_sequence: outbox.event.data.to_sequence,
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
    > & Partial<Pick<ProductionStore, "findHandoffReviewInput" | "completeHandoffReview" | "recordNarrationDurationFeedback">>,
    private readonly storage: StoragePort,
    private readonly runtime: MediaRuntimeClient,
    private readonly input: { consumerName: string; workerId: string; leaseMs: number },
    private readonly evaluator: HandoffEvaluatorPort = createFixtureHandoffEvaluator(),
    private readonly narrationStore?: Pick<NarrationQualityStore, "findNarrationAudioGenerationInput" | "ensureGeneratedNarrationAsset" | "completeNarrationAudioGeneration">,
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

    try {
      const now = new Date();
      if (claim.event.event_type === "narration_audio.generation_requested") {
        await this.processNarrationAudioGeneration(claim.event);
      } else if (claim.event.event_type === "production_segment.qc_requested") {
      const source = await this.store.findProductionSegmentQcInput({ event: claim.event });
      if (source) {
        const bytes = await readStorageBytes(this.storage, {
          ...source.sourceAsset,
          expectedObjectKeyPrefix: `${source.workspaceId}/${source.projectId}/${source.sourceAsset.id}/`,
        });
        await this.runtime.inspect({
          operationId: mediaOperationId(claim.event.event_id, "inspect"),
          bytes,
          expectedSha256: source.sourceAsset.sha256,
        });
        if (source.audioOwner === "NATIVE_PROVIDER" && source.providerText) {
          if (!this.runtime.transcribe) {
            throw new Error("MEDIA_RUNTIME_UNAVAILABLE: native provider speech transcription is unavailable.");
          }
          const transcript = await this.runtime.transcribe({
            operationId: mediaOperationId(claim.event.event_id, "transcribe"),
            bytes,
            expectedSha256: source.sourceAsset.sha256,
          });
          if (transcript.status !== "CHECKED") {
            throw new Error("MEDIA_RUNTIME_UNAVAILABLE: native provider speech transcription is unavailable.");
          }
          if (!hasTranscriptWords(transcript.word_timestamps)) {
            throw new Error(NATIVE_PROVIDER_ZERO_WORD_QC_FAILURE);
          }
        }
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
      } else if (claim.event.event_type === "handoff_review.requested") {
      if (!this.store.findHandoffReviewInput || !this.store.completeHandoffReview) throw new Error("Handoff review persistence is unavailable.");
      const source = await this.store.findHandoffReviewInput({ event: claim.event });
      if (!source) throw new Error("Handoff review source assets are not ready for evaluation.");
      if (!this.runtime.extractBoundaryFrames) throw new Error("Media Runtime boundary-frame extraction is unavailable.");
      const [fromBytes, toBytes] = await Promise.all([
        readStorageBytes(this.storage, {
          ...source.fromSourceAsset,
          expectedObjectKeyPrefix: `${source.workspaceId}/${source.projectId}/${source.fromSourceAsset.id}/`,
        }),
        readStorageBytes(this.storage, {
          ...source.toSourceAsset,
          expectedObjectKeyPrefix: `${source.workspaceId}/${source.projectId}/${source.toSourceAsset.id}/`,
        }),
      ]);
      const [fromFrames, toFrames] = await Promise.all([
        this.runtime.extractBoundaryFrames({
          operationId: mediaOperationId(claim.event.event_id, "from-boundary"),
          bytes: fromBytes,
          expectedSha256: source.fromSourceAsset.sha256,
        }),
        this.runtime.extractBoundaryFrames({
          operationId: mediaOperationId(claim.event.event_id, "to-boundary"),
          bytes: toBytes,
          expectedSha256: source.toSourceAsset.sha256,
        }),
      ]);
      const evaluation = await this.evaluator.evaluate({
        fromTailFrame: fromFrames.last.bytes,
        toHeadFrame: toFrames.first.bytes,
        continuityHints: {
          characterCount: 1,
          sceneSummary: `${source.continuityHints.fromTitle} → ${source.continuityHints.toTitle}`,
        },
      });
      await this.store.completeHandoffReview({ event: claim.event, evaluation, now });
      } else {
      const source = await this.store.findProductionCompositionInput({ event: claim.event });
      if (!source) {
        // The repository reserves undefined for a stale request whose run is
        // already gone or no longer REVIEWING.  A live REVIEWING run with
        // missing narration/visual facts throws ProductionCompositionInput
        // UnavailableError in persistence, reaches this catch, and is
        // released for retry/dead-letter instead of being acknowledged.
      } else {
        const compositionTracks = source.compositionPlan?.audio_plan?.tracks ?? source.compositionPlan?.audio_tracks ?? [];
        const narrationDurationMeasurements: MediaRuntimeNarrationDurationMeasurement[] = [];
        let sectionNarrationWindowMismatch = false;
        const narrationAssetsById = new Map((source.narrationAssets ?? []).map((asset) => [asset.id, asset]));
        for (const track of compositionTracks) {
          if (!track.asset_id) continue;
          if (track.ownership === "PLATFORM_NARRATION") {
            const isFullTrack = source.narrationAsset?.id === track.asset_id;
            const isSectionTrack = narrationAssetsById.has(track.asset_id);
            if (!isFullTrack && !isSectionTrack) {
              throw new Error("QC_FAILED: platform narration track asset does not match an approved narration asset.");
            }
          }
          if (track.ownership === "MUSIC" && (!source.musicAsset || track.asset_id !== source.musicAsset.id)) {
            throw new Error("QC_FAILED: music track asset does not match the selected music asset.");
          }
          if (track.track_id.startsWith("segment-")) {
            const sequence = Number(track.track_id.slice("segment-".length));
            const segment = Number.isSafeInteger(sequence) && sequence > 0 ? source.segments[sequence - 1] : undefined;
            if (!segment || track.asset_id !== segment.sourceAsset.id) {
              throw new Error("QC_FAILED: source audio track asset does not match the accepted video segment.");
            }
          }
        }
        const segments = await Promise.all(source.segments.map((segment) => readStorageBytes(this.storage, {
          ...segment.sourceAsset,
          expectedObjectKeyPrefix: `${source.workspaceId}/${source.projectId}/${segment.sourceAsset.id}/`,
        })));
        // A platform narration does not prove that an input video's audio is
        // dialogue.  When the persisted delivery/ownership fact is missing,
        // preserving the source track could double-speak and replacing it
        // could discard ambience or user audio.  Stop before synthesis and
        // composition until the source clip is explicitly classified.
        if (source.compositionPlan?.audio_policy === "CONTINUOUS_NARRATION"
          && compositionTracks.some((track) =>
            track.track_id.startsWith("segment-") && track.ownership === "LEGACY_PRESERVE")) {
          throw new Error("QC_FAILED: continuous narration requires explicit source audio ownership for every segment.");
        }
        const musicBytes = source.musicAsset
          ? source.musicAsset.workspaceId !== source.workspaceId
            ? (() => { throw new Error("QC_FAILED: music asset workspace scope does not match the production run."); })()
            : await readStorageBytes(this.storage, {
              ...source.musicAsset,
              expectedObjectKeyPrefix: `${source.musicAsset.workspaceId}/${source.musicAsset.projectId}/${source.musicAsset.id}/`,
            })
          : undefined;
        const approvedNarrationBytes = source.narrationAsset
          ? source.narrationAsset.workspaceId !== source.workspaceId || source.narrationAsset.projectId !== source.projectId
            ? (() => { throw new Error("QC_FAILED: narration asset workspace/project scope does not match the production run."); })()
            : await readStorageBytes(this.storage, {
              ...source.narrationAsset,
              expectedObjectKeyPrefix: `${source.narrationAsset.workspaceId}/${source.narrationAsset.projectId}/${source.narrationAsset.id}/`,
            })
          : undefined;
        const approvedNarrationTrackBytes: MediaRuntimeNarrationTrackBytes[] = [];
        if (source.narrationAssets?.length) {
          if (source.narrationAsset || !source.compositionPlan?.audio_plan || !this.runtime.inspectAudio) {
            throw new Error("QC_FAILED: section narration requires an AudioPlan and independent measured assets.");
          }
          const planNarrationTracks = source.compositionPlan.audio_plan.tracks.filter((track) => track.ownership === "PLATFORM_NARRATION");
          if (planNarrationTracks.length !== source.narrationAssets.length) {
            throw new Error("QC_FAILED: section narration assets do not match the AudioPlan tracks.");
          }
          if (new Set(source.narrationAssets.map((asset) => asset.sectionId)).size !== source.narrationAssets.length) {
            throw new Error("QC_FAILED: section narration assets must map one-to-one to AudioPlan sections.");
          }
          const audioPlan = source.compositionPlan.audio_plan;
          const visualTailWindows: TimelineWindow[] = audioPlan.narration_sections
            .filter((section) => section.visual_role === "HOLD" || section.visual_role === "BROLL")
            .map((section) => ({ start_ms: section.start_ms, end_ms: section.end_ms }));
          const musicTrack = compositionTracks.find((track) => track.ownership === "MUSIC");
          const completeMusicWindows: readonly TimelineWindow[] = musicBytes && musicTrack
            && musicTrack.end_ms === source.compositionPlan.target_duration_ms
            && source.compositionPlan.music_segments_ms.length === 1
            && source.compositionPlan.music_segments_ms[0]?.start_ms === musicTrack.start_ms
            && source.compositionPlan.music_segments_ms[0]?.end_ms === source.compositionPlan.target_duration_ms
            ? source.compositionPlan.music_segments_ms
            : [];
          for (const asset of source.narrationAssets) {
            if (asset.workspaceId !== source.workspaceId || asset.projectId !== source.projectId) {
              throw new Error("QC_FAILED: section narration asset workspace/project scope does not match the production run.");
            }
            const section = source.compositionPlan.audio_plan.narration_sections.find((candidate) => candidate.section_id === asset.sectionId);
            const track = planNarrationTracks.find((candidate) => candidate.asset_id === asset.id);
            if (!section
              || section.visual_role !== "PRIMARY"
              || section.narration_asset_version_id !== asset.assetVersionId
              || !track
              || track.track_id !== `narration-${asset.id}`
              || track.start_ms !== section.start_ms
              || track.end_ms !== section.end_ms) {
              throw new Error("QC_FAILED: section narration asset does not match its source AudioPlan section and track.");
            }
            const bytes = await readStorageBytes(this.storage, {
              ...asset,
              expectedObjectKeyPrefix: `${asset.workspaceId}/${asset.projectId}/${asset.id}/`,
            });
            const measured = await this.runtime.inspectAudio({
              operationId: mediaOperationId(claim.event.event_id, `narration-${asset.id}`),
              bytes,
              expectedSha256: asset.sha256,
            });
            const windowDurationMs = track.end_ms - track.start_ms;
            if (measured.mime_type !== asset.mimeType
              || measured.byte_size !== bytes.byteLength
              || measured.sha256 !== asset.sha256
              || !Number.isInteger(measured.duration_ms)
              || measured.duration_ms <= 0
              || Math.abs(measured.duration_ms - asset.durationMs) > NARRATION_MEASURED_DURATION_TOLERANCE_MS) {
              throw new Error("QC_FAILED: section narration duration does not match its measured AudioPlan window.");
            }
            narrationDurationMeasurements.push({
              section_id: asset.sectionId,
              planned_duration_seconds: windowDurationMs / 1_000,
              actual_duration_seconds: measured.duration_ms / 1_000,
            });
            if (measured.duration_ms > windowDurationMs
              || (measured.duration_ms < windowDurationMs
                && !coversDeclaredTail(
                  track.start_ms + measured.duration_ms,
                  track.end_ms,
                  [...completeMusicWindows, ...visualTailWindows],
                ))) {
              sectionNarrationWindowMismatch = true;
            }
            approvedNarrationTrackBytes.push({ track_id: track.track_id, bytes });
          }
        }
        let authoritativeNarrationDurationMs: number | undefined;
        if (approvedNarrationBytes && source.narrationAsset && source.compositionPlan) {
          if (!this.runtime.inspectAudio) {
            throw new Error("MEDIA_RUNTIME_UNAVAILABLE: approved narration duration probe is unavailable.");
          }
          const measured = await this.runtime.inspectAudio({
            operationId: mediaOperationId(claim.event.event_id, "narration-inspect"),
            bytes: approvedNarrationBytes,
            expectedSha256: source.narrationAsset.sha256,
          });
          if (measured.mime_type !== source.narrationAsset.mimeType
            || measured.byte_size !== approvedNarrationBytes.byteLength
            || measured.sha256 !== source.narrationAsset.sha256
            || !Number.isInteger(measured.duration_ms)
            || measured.duration_ms <= 0
            || Math.abs(measured.duration_ms - source.narrationAsset.durationMs) > NARRATION_MEASURED_DURATION_TOLERANCE_MS) {
            throw new Error("QC_FAILED: approved narration duration does not match the measured audio asset.");
          }
          narrationDurationMeasurements.push({
            planned_duration_seconds: source.compositionPlan.target_duration_ms / 1_000,
            actual_duration_seconds: measured.duration_ms / 1_000,
          });
          authoritativeNarrationDurationMs = measured.duration_ms;
        }
        // ALCHMED8 carries the canonical transcript that belongs to this
        // AudioPlan.  Prefer that existing private fact for the source
        // final-review comparison, and only fall back to the legacy snapshot
        // fields when an older bundle has no AudioPlan transcript.  When both
        // canonical fields are present they must agree; otherwise the plan
        // would be mixed with a different script revision.
        const audioPlanTranscriptText = source.compositionPlan?.audio_plan?.transcript_script?.trim() || undefined;
        const approvedNarrationText = source.narrationScriptText?.trim() || undefined;
        if (audioPlanTranscriptText && approvedNarrationText && audioPlanTranscriptText !== approvedNarrationText) {
          throw new Error("QC_FAILED: AudioPlan transcript does not match the approved narration script.");
        }
        const authoritativeNarrationText = audioPlanTranscriptText || approvedNarrationText || source.scriptText?.trim();
        // Final review must always compare against the same canonical text
        // that drove narration.  Cue-only snapshots may intentionally omit a
        // top-level script field, so reconstruct the transcript from their
        // persisted provider text instead of silently disabling ASR/script
        // comparison.  Empty cue text is not a valid authoritative track.
        const cueNarrationText = source.narrationSegments
          ?.map((segment) => segment.text.trim())
          .filter(Boolean)
          .join(" ")
          .trim();
        const finalReviewNarrationText = authoritativeNarrationText?.trim() || cueNarrationText || undefined;
        if (source.narrationSegments?.length && !finalReviewNarrationText) {
          throw new Error("QC_FAILED: narration cues have no canonical provider text for final review.");
        }
        if (!approvedNarrationBytes
          && !source.narrationAsset
          && !source.narrationAssets?.length
          && (source.narrationSegments?.length ?? 0) > 1) {
          // Absolute multi-cue placement is not a supported formal fallback.
          // Keep it closed until the source OpenMontage full_mix speech-track
          // adapter consumes measured cue windows.
          throw new Error("QC_FAILED: multi-cue narration requires an approved full narration asset or OpenMontage full_mix.");
        }
        // The loopback narration request has no owner/provider field.  A
        // continuous plan with only script/cue text therefore cannot
        // authorize an implicit Piper call.  Keep approved formal narration
        // assets (and source-preserving/native plans) on their existing paths,
        // but fail closed before synthesis when ownership is unresolved.
        if (source.compositionPlan?.audio_policy === "CONTINUOUS_NARRATION"
          && !approvedNarrationBytes
          && approvedNarrationTrackBytes.length === 0
          && (Boolean(authoritativeNarrationText?.trim()) || (source.narrationSegments?.length ?? 0) > 0)
          && !this.runtime.narrationProvider) {
          throw new Error("QC_FAILED: continuous narration requires explicit source audio ownership for every segment.");
        }
        const singleNarrationSegment = !approvedNarrationBytes
          && approvedNarrationTrackBytes.length === 0
          && source.narrationSegments?.length === 1
          ? source.narrationSegments[0]
          : undefined;
        const piperNarrationProvider = this.runtime.narrationProvider === "piper"
          || this.runtime.narrationProvider === "piper_tts";
        const singleCueHasNonDefaultDelivery = singleNarrationSegment !== undefined && (
          singleNarrationSegment.startMs !== 0
          || (singleNarrationSegment.pronunciationGuides?.length ?? 0) > 0
          || (singleNarrationSegment.pauseBeforeMs ?? 0) !== 0
          || (singleNarrationSegment.pauseAfterMs ?? 0) !== 0
          || (singleNarrationSegment.pace !== undefined && singleNarrationSegment.pace !== "NATURAL")
          || (singleNarrationSegment.energy !== undefined && singleNarrationSegment.energy !== "NEUTRAL")
        );
        if (singleCueHasNonDefaultDelivery && !piperNarrationProvider) {
          throw new Error("MEDIA_RUNTIME_UNAVAILABLE: selected narration provider cannot consume structured cue delivery metadata.");
        }
        const narration = !approvedNarrationBytes
          && approvedNarrationTrackBytes.length === 0
          && (Boolean(authoritativeNarrationText?.trim()) || singleNarrationSegment !== undefined)
          && source.compositionPlan?.audio_policy === "CONTINUOUS_NARRATION"
          ? this.runtime.synthesizeNarration
            ? await this.runtime.synthesizeNarration({
              operationId: mediaOperationId(claim.event.event_id, "narration"),
              // OpenMontage's compose flow generates the canonical narration
              // once.  Section cues remain review/timing facts; they are not
              // independent Piper jobs that would reset prosody at every
              // visual cut.
              ...(singleNarrationSegment && piperNarrationProvider
                ? {
                  segments: [{
                    text: singleNarrationSegment.text,
                    // The private composition snapshot stores the canonical
                    // provider_text in `text`; preserve it explicitly on the
                    // existing Runtime segment carrier.
                    provider_text: singleNarrationSegment.text,
                    start_ms: singleNarrationSegment.startMs,
                    ...(singleNarrationSegment.pronunciationGuides
                      ? { pronunciation_guides: singleNarrationSegment.pronunciationGuides }
                      : {}),
                    ...(singleNarrationSegment.pauseBeforeMs !== undefined
                      ? { pause_before_ms: singleNarrationSegment.pauseBeforeMs }
                      : {}),
                    ...(singleNarrationSegment.pauseAfterMs !== undefined
                      ? { pause_after_ms: singleNarrationSegment.pauseAfterMs }
                      : {}),
                    ...(singleNarrationSegment.pace !== undefined
                      ? { pace: singleNarrationSegment.pace }
                      : {}),
                    ...(singleNarrationSegment.energy !== undefined
                      ? { energy: singleNarrationSegment.energy }
                      : {}),
                  }],
                }
                : { scriptText: singleNarrationSegment?.text.trim() ?? authoritativeNarrationText!.trim() }),
              targetDurationMs: source.compositionPlan.target_duration_ms,
              ...(this.runtime.narrationProvider ? { preferredProvider: this.runtime.narrationProvider } : {}),
            })
            : undefined
          : undefined;
        if (!approvedNarrationBytes
          && source.compositionPlan?.audio_policy === "CONTINUOUS_NARRATION"
          && source.narrationSegments?.length
          && source.narrationSegments.length !== 1
          && !authoritativeNarrationText?.trim()) {
          // A cue-only snapshot has no source-proven full script.  The
          // multi-cue fallback is intentionally closed until OpenMontage
          // full_mix is wired with measured absolute speech tracks.
          throw new Error("QC_FAILED: canonical narration text is required before continuous narration synthesis.");
        }
        if (!approvedNarrationBytes
          && approvedNarrationTrackBytes.length === 0
          && (Boolean(source.narrationScriptText) || Boolean(source.scriptText) || Boolean(source.narrationSegments?.length))
          && source.compositionPlan?.audio_policy === "CONTINUOUS_NARRATION"
          && !narration) {
          throw new Error("MEDIA_RUNTIME_UNAVAILABLE: authoritative narration synthesis is unavailable.");
        }
        if (narration && source.compositionPlan) {
          const target = source.compositionPlan.target_duration_ms;
          authoritativeNarrationDurationMs = narration.duration_ms;
          narrationDurationMeasurements.push({
            planned_duration_seconds: target / 1_000,
            actual_duration_seconds: narration.duration_ms / 1_000,
          });
        }
        if (narrationDurationMeasurements.length > 0) {
          const durationFeedback = evaluateNarrationDurationFeedback({ measurements: narrationDurationMeasurements });
          if (this.store.recordNarrationDurationFeedback) {
            await this.store.recordNarrationDurationFeedback({
              eventId: claim.event.event_id,
              workspaceId: source.workspaceId,
              projectId: source.projectId,
              productionRunId: source.productionRunId,
              feedback: durationFeedback,
              now,
            });
          } else if (durationFeedback.decision !== "MEASURED") {
            throw new Error("MEDIA_RUNTIME_UNAVAILABLE: narration duration feedback persistence is unavailable.");
          }
          if (durationFeedback.decision === "SEND_BACK") {
            throw new Error("QC_FAILED: narration duration requires source SEND_BACK; revise the script and regenerate.");
          }
          if (durationFeedback.decision === "ADJUST_SCENE_PLAN") {
            throw new Error("QC_FAILED: narration duration requires source ADJUST_SCENE_PLAN before composition.");
          }
          if (durationFeedback.decision === "SOURCE_DECISION_REQUIRED") {
            throw new Error("QC_FAILED: narration duration matches overlapping source rules; an explicit SEND_BACK or ADJUST_SCENE_PLAN decision is required before composition.");
          }
        }
        if (sectionNarrationWindowMismatch) {
          throw new Error("QC_FAILED: section narration duration does not match its measured AudioPlan window.");
        }
        if (approvedNarrationTrackBytes.length === 0 && authoritativeNarrationDurationMs !== undefined && source.compositionPlan
          && authoritativeNarrationDurationMs < source.compositionPlan.target_duration_ms) {
          const windows = source.compositionPlan.music_segments_ms;
          const visualTailWindows = source.compositionPlan.audio_plan?.narration_sections
            .filter((section) => section.visual_role === "HOLD" || section.visual_role === "BROLL")
            .map((section) => ({ start_ms: section.start_ms, end_ms: section.end_ms })) ?? [];
          if (!coversDeclaredTail(
            authoritativeNarrationDurationMs,
            source.compositionPlan.target_duration_ms,
            [...windows, ...visualTailWindows],
          )
            || (!musicBytes && visualTailWindows.length === 0)) {
            throw new Error("QC_FAILED: short narration has no declared music or approved HOLD/BROLL visual tail coverage.");
          }
        }
        let composed = await this.runtime.compose({
          operationId: mediaOperationId(claim.event.event_id, "compose"),
          segments,
          compositionPlan: source.compositionPlan,
          musicBytes,
          narrationBytes: approvedNarrationBytes ?? narration?.bytes,
          ...(approvedNarrationTrackBytes.length > 0 ? { narrationTrackBytes: approvedNarrationTrackBytes } : {}),
        });
        // Persisted delivery plans carry an explicit caption policy.  Older
        // in-memory fixtures may omit it; keep those legacy snapshots on the
        // existing final-review path rather than requiring a method their
        // test/runtime port never advertised.
        if (source.captionPolicy === "REQUIRED") {
          if (!this.runtime.burnCaptions) {
            throw new Error("MEDIA_RUNTIME_UNAVAILABLE: required caption burn is unavailable.");
          }
          composed = await this.runtime.burnCaptions({
            operationId: mediaOperationId(claim.event.event_id, "captions"),
            bytes: composed.bytes,
            expectedSha256: composed.inspection.sha256,
          });
        }
        const finalReview = this.runtime.finalReview
          ? await this.runtime.finalReview({
            operationId: mediaOperationId(claim.event.event_id, "final-review"),
            bytes: composed.bytes,
            expectedSha256: composed.inspection.sha256,
            scriptText: finalReviewNarrationText,
            // Legacy/private snapshots without a persisted delivery policy
            // must not be upgraded to REQUIRED implicitly. Only an explicit
            // persisted policy can trigger caption burning and its hard gate.
            captionPolicy: source.captionPolicy ?? "OFF",
          })
          : { status: "NEEDS_ATTENTION" as const, issues_found: ["成片终检工具不可用。"], recommended_action: "PRESENT_WITH_REVIEW" as const };
        if (finalReview.status === "FAILED" || finalReview.recommended_action === "BLOCK") {
          throw new Error(`QC_FAILED: ${finalReview.issues_found.join(" ")}`);
        }
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
          finalReview: {
            ...finalReview,
            audio_summary: {
              has_audio: finalReview.audio_spotcheck?.has_audio ?? composed.inspection.has_audio,
              music_applied: Boolean(source.musicAsset),
              ...(source.musicMetadata?.title ? { music_title: source.musicMetadata.title } : {}),
              ...(source.musicMetadata?.artist ? { music_artist: source.musicMetadata.artist } : {}),
              ...(source.musicMetadata?.tags ? { music_tags: source.musicMetadata.tags } : {}),
              ...(finalReview.audio_spotcheck?.audio_sample_rate ? { sample_rate: finalReview.audio_spotcheck.audio_sample_rate } : {}),
              ...(finalReview.audio_spotcheck?.integrated_lufs !== undefined ? { integrated_lufs: finalReview.audio_spotcheck.integrated_lufs } : {}),
              ...(finalReview.audio_spotcheck?.true_peak_db !== undefined ? { true_peak_db: finalReview.audio_spotcheck.true_peak_db } : {}),
              ...(finalReview.audio_spotcheck?.loudness_range_lu !== undefined ? { loudness_range_lu: finalReview.audio_spotcheck.loudness_range_lu } : {}),
              ...(finalReview.audio_spotcheck?.unexpected_silence !== undefined ? { unexpected_silence: finalReview.audio_spotcheck.unexpected_silence } : {}),
            },
          },
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
    } catch (error) {
      // Release the durable lease before BullMQ retries. Without this, the
      // short retry backoff sees BUSY and masks the original QC/runtime error.
      await this.store.releaseMediaRuntimeEvent({
        eventId: message.event_id,
        workspaceId: message.workspace_id,
        consumerName: this.input.consumerName,
        workerId: this.input.workerId,
        reason: failureReason(error),
        deadLetter: false,
        now: new Date(),
      }).catch(() => undefined);
      throw error;
    }
  }

  private async processNarrationAudioGeneration(event: NarrationAudioGenerationEvent) {
    if (!this.narrationStore) throw new Error("Narration audio generation persistence is unavailable.");
    const source: NarrationAudioGenerationInput | undefined = await this.narrationStore.findNarrationAudioGenerationInput({ event });
    if (!source) throw new Error("Narration audio generation source is no longer valid.");
    const draft = await this.narrationStore.ensureGeneratedNarrationAsset({ event });
    if (!draft) throw new Error("Narration audio generated asset could not be reserved.");
    let facts: {
      mimeType: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm";
      sha256: string;
      byteSize: number;
      durationMs: number;
    };
    if (draft.status === "READY") {
      if (!draft.mimeType || !draft.sha256 || !draft.byteSize || !draft.durationMs
        || !["audio/wav", "audio/mpeg", "audio/ogg", "audio/pcm"].includes(draft.mimeType)) {
        throw new Error("Persisted narration asset is missing measured media facts.");
      }
      const persisted = await this.storage.inspectObject({ objectKey: draft.objectKey });
      if (!persisted || persisted.mimeType !== draft.mimeType || persisted.sha256 !== draft.sha256 || persisted.byteSize !== draft.byteSize) {
        throw new Error("Persisted narration object does not match its measured asset facts.");
      }
      facts = { mimeType: draft.mimeType as typeof facts.mimeType, sha256: draft.sha256, byteSize: draft.byteSize, durationMs: draft.durationMs };
    } else {
      if (!this.runtime.inspectAudio) throw new Error("Media Runtime narration audio inspection is unavailable.");
      // A worker may restart after the immutable object write but before the
      // completion transaction. Recover that object first so the source
      // submit/poll/download path is not repeated for the same event.
      const persisted = await this.storage.inspectObject({ objectKey: draft.objectKey });
      if (persisted) {
        const persistedMimeType = persisted.mimeType.toLowerCase();
        if (!["audio/wav", "audio/mpeg", "audio/ogg", "audio/pcm"].includes(persistedMimeType)) {
          throw new Error("Persisted narration object has unsupported measured media facts.");
        }
        const persistedBytes = await readStorageBytes(this.storage, {
          objectKey: draft.objectKey,
          mimeType: persistedMimeType,
          byteSize: persisted.byteSize,
          sha256: persisted.sha256,
          expectedObjectKeyPrefix: `${source.workspaceId}/${source.projectId}/${source.assetId}/`,
        });
        const inspected = await this.runtime.inspectAudio({ operationId: mediaOperationId(event.event_id, "inspect-audio"), bytes: persistedBytes, expectedSha256: persisted.sha256 });
        if (inspected.mime_type !== persistedMimeType || inspected.sha256 !== persisted.sha256 || inspected.byte_size !== persisted.byteSize) {
          throw new Error("Persisted narration object inspection does not match measured facts.");
        }
        facts = { mimeType: inspected.mime_type, sha256: inspected.sha256, byteSize: inspected.byte_size, durationMs: inspected.duration_ms };
      } else {
        if (!this.runtime.synthesizeNarration) throw new Error("Media Runtime narration synthesis is unavailable.");
        const settings = source.providerSettings;
        const generated = await this.runtime.synthesizeNarration({
          operationId: mediaOperationId(event.event_id, "narration"),
          scriptText: source.scriptText,
          preferredProvider: source.provider,
          voiceId: source.voiceId,
          ...(settings.resource_id ? { resourceId: settings.resource_id } : {}),
          ...(settings.format ? { format: settings.format } : {}),
          ...(settings.sample_rate !== undefined ? { sampleRate: settings.sample_rate } : {}),
          ...(settings.speech_rate !== undefined ? { speechRate: settings.speech_rate } : {}),
          ...(settings.enable_timestamp !== undefined ? { enableTimestamp: settings.enable_timestamp } : {}),
          ...(settings.disable_markdown_filter !== undefined ? { disableMarkdownFilter: settings.disable_markdown_filter } : {}),
          ...(settings.return_usage !== undefined ? { returnUsage: settings.return_usage } : {}),
          ...(settings.poll_interval_seconds !== undefined ? { pollIntervalSeconds: settings.poll_interval_seconds } : {}),
          ...(settings.timeout_seconds !== undefined ? { timeoutSeconds: settings.timeout_seconds } : {}),
        });
        if (generated.byte_size !== generated.bytes.byteLength || generated.sha256 !== createHash("sha256").update(generated.bytes).digest("hex") || !["audio/wav", "audio/mpeg", "audio/ogg", "audio/pcm"].includes(generated.mime_type)) {
          throw new Error("Media Runtime narration response has invalid measured facts.");
        }
        await storeAudioArtifact(this.storage, {
          objectKey: source.objectKey,
          mimeType: generated.mime_type,
          bytes: generated.bytes,
          sha256: generated.sha256,
        });
        const inspected = await this.runtime.inspectAudio({ operationId: mediaOperationId(event.event_id, "inspect-audio"), bytes: generated.bytes, expectedSha256: generated.sha256 });
        if (inspected.mime_type !== generated.mime_type || inspected.sha256 !== generated.sha256 || inspected.byte_size !== generated.byte_size) {
          throw new Error("Media Runtime narration inspection does not match generated facts.");
        }
        facts = { mimeType: inspected.mime_type, sha256: inspected.sha256, byteSize: inspected.byte_size, durationMs: inspected.duration_ms };
      }
    }
    await this.narrationStore.completeNarrationAudioGeneration({ event, facts });
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
