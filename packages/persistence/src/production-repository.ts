import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import {
  InternalEventEnvelopeSchema,
  InternalMediaRuntimeQueueMessageSchema,
  InternalProductionQueueMessageSchema,
  GenerationSegmentMotionPlanSchema,
  BillingRuleSnapshotSchema,
  VideoGenerationInputSnapshotSchema,
  type InternalEventEnvelope,
  type InternalMediaRuntimeQueueMessage,
  type InternalProductionQueueMessage,
  type MotionBeat,
  type VideoAudioOwner,
  type VideoGenerationInputSnapshot,
  type VisualInputSnapshot,
  type VisualReferenceRole,
  type ProductionRunStatus,
  type ProductionSegmentStatus,
  type QcStatus,
  type MediaRuntimeCompositionPlan,
  MediaRuntimeCompositionPlanSchema,
  MusicPlanSchema,
  type HandoffReviewResult,
  type HandoffReviewReasonCode,
  MediaRuntimeNarrationDurationFeedbackSchema,
  type MediaRuntimeNarrationDurationFeedback,
} from "@alchemy-video/contracts";
import {
  assertProductionRunTransition,
  assertProductionAcceptanceCount,
  assertProductionSegmentDependencies,
  assertProductionSegmentTransition,
  createPrefixedId,
  decideContinuityRepair,
  inferVisualReferenceRoles,
  parseVisualReferenceAnalysis,
} from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import type { OutboxRelayStore, PersistedOutboxEvent } from "./task-run-repository.js";
import {
  assets,
  assetDerivations,
  commandDeduplications,
  creativeBriefRevisions,
  creativeDecisionLogs,
  deliveryPlanRevisions,
  eventConsumptions,
  handoffReviews,
  outboxEvents,
  productionRuns,
  productionSegments,
  qcReports,
  promptPackages,
  referenceBindings,
  scriptRevisions,
  shots,
  storyboardRevisions,
  storyboardShotSpecs,
  taskRuns,
  transitionRepairs,
  videoVersions,
} from "./schema.js";
import { findApprovedNarrationTimeline, type ApprovedNarrationTimeline } from "./approved-narration-timeline.js";
import { NARRATION_MEASURED_DURATION_TOLERANCE_MS } from "./narration-quality-repository.js";

type QueryExecutor = Pick<PlatformDatabase, "select" | "insert" | "update" | "execute">;

/**
 * Source-aligned transcript expectation: only explicit spoken content is
 * eligible for audio comparison. A visual story description is not a script.
 * Mirrors Huobao storyboard-breaker dialogue cues and Seedance sound intent.
 */
const repairDialogueBoundaryQuotes = (value: string) => {
  const text = value.trim();
  const first = text[0];
  const last = text.at(-1);
  const balanced = (first === "“" && last === "”")
    || (first === "「" && last === "」")
    || (first === "『" && last === "』")
    || (first === '"' && last === '"')
    || (first === "'" && last === "'");
  if (balanced) return text;
  return text
    .replace(/^[“”「」『』"']+\s*/u, "")
    .replace(/\s*[“”「」『』"']+$/u, "")
    .trim();
};

export const deriveTranscriptScript = (sourceText: string): string | undefined => {
  const labelled = sourceText.match(/(?:^|\n)\s*(?:口播文案|旁白文案|配音文案|对白文案)\s*(?:为)?\s*[:：]?\s*([\s\S]*?)(?=\n\s*(?:视频生成意图描述|视频生成意图|画面描述|镜头描述|视觉描述|备注|说明)(?:\s*[:：][^\n]*)?(?:\n|$)|$)/u)?.[1];
  const labelledText = labelled
    ? repairDialogueBoundaryQuotes(labelled)
      .replace(/^(?:口播文案|旁白文案|配音文案|对白文案)\s*(?:为)?\s*[:：]?/u, "")
      .trim()
    : undefined;
  const labelledQuoted = labelledText
    ? [...labelledText.matchAll(/[“「『"']([^”」』"']{1,1200})[”」』"']/gu)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value))
    : [];
  const quoted = [...sourceText.matchAll(/[“「『"']([^”」』"']{1,240})[”」』"']/gu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const cued = [...sourceText.matchAll(/(?:旁白|配音|对白|台词|说道|说|问道|回答|喊道|低声道|大声道|dialogue|voiceover|narration|narrator)[:：]?\s*[“「『]?([^。！？!？\n”」』]{1,240})[”」』]?/giu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const lines = [...new Set(
    labelledText && labelledQuoted.length > 0
      ? labelledQuoted
      : labelledText
        ? [labelledText]
        : quoted.length > 0
          ? quoted
          : cued,
  )].slice(0, 4);
  return lines.length > 0 ? lines.join(" ").slice(0, 1_200) : undefined;
};

/**
 * Map an authored audio gain to the source AudioPlan dB field. OpenMontage's
 * track filter defaults an omitted volume to 1.0, which is the equivalent of
 * an explicit 0 dB gain. Missing metadata therefore uses that source default;
 * malformed authored metadata remains fail-closed.
 */
export const resolveAudioTrackGainDb = (metadata: Record<string, unknown> | null | undefined): string => {
  const raw = metadata?.audio_gain_db;
  if (raw === undefined) return "0";
  if (typeof raw !== "string" || !/^-?(?:\d+(?:\.\d+)?)$/u.test(raw)) {
    throw new ProductionCompositionInputUnavailableError("audio gain metadata is invalid");
  }
  return raw;
};

/**
 * `provider_duration_seconds` is the provider request ceiling, not a rounded
 * measurement of the encoded video.  OpenMontage measures the returned media
 * and permits a small container/encoder overrun; reject only when the measured
 * segment exceeds that ceiling beyond the existing shared 250 ms tolerance.
 */
export const measuredVisualSegmentMatchesRequest = (input: {
  measuredDurationMs: number;
  providerDurationSeconds: number;
}) => input.measuredDurationMs <= input.providerDurationSeconds * 1_000 + NARRATION_MEASURED_DURATION_TOLERANCE_MS;

const narrationTextForSynthesis = (text: string) => text
  .trim();

/**
 * Builds the only no-delivery-cue fallback permitted by the source rules:
 * one cue from an explicitly labelled/canonical transcript. Visual prose
 * produces no transcript and therefore no cue.
 */
export const buildCanonicalNarrationCue = (sourceText: string) => {
  const scriptText = deriveTranscriptScript(sourceText);
  return scriptText ? [{ text: narrationTextForSynthesis(scriptText), startMs: 0 }] : [];
};

/**
 * The storage schema has the same server-owned key check, but composition
 * snapshots cross a process boundary. Re-assert the invariant before a row
 * is handed to Worker so a malformed/legacy row cannot point at another
 * project while still passing the database scope predicates.
 */
type ScopedAssetMetadata = {
  id?: unknown;
  workspaceId?: unknown;
  projectId?: unknown;
  objectKey?: unknown;
  sha256?: unknown;
  byteSize?: unknown;
  mimeType?: unknown;
  durationMs?: unknown;
};

const hasScopedAssetMetadata = (asset: ScopedAssetMetadata, input: { workspaceId: string; projectId: string; kind: "VIDEO" | "AUDIO"; requireDuration: boolean; expectedDurationMs?: number }) => {
  if (typeof asset.id !== "string" || asset.id.length === 0) return false;
  const prefix = `${input.workspaceId}/${input.projectId}/${asset.id}/`;
  const durationValid = input.requireDuration
    ? typeof asset.durationMs === "number" && Number.isInteger(asset.durationMs) && asset.durationMs > 0
    : asset.durationMs === null || asset.durationMs === undefined
      || (typeof asset.durationMs === "number" && Number.isInteger(asset.durationMs) && asset.durationMs > 0);
  return asset.workspaceId === input.workspaceId
    && asset.projectId === input.projectId
    && typeof asset.objectKey === "string" && asset.objectKey.startsWith(prefix) && asset.objectKey.length > prefix.length
    && typeof asset.sha256 === "string" && /^[a-f0-9]{64}$/u.test(asset.sha256)
    && typeof asset.byteSize === "number" && Number.isInteger(asset.byteSize) && asset.byteSize > 0
    && typeof asset.mimeType === "string" && (input.kind === "VIDEO" ? asset.mimeType === "video/mp4" : /^audio\/[a-z0-9.+-]+$/iu.test(asset.mimeType))
    && durationValid
    && (input.expectedDurationMs === undefined || asset.durationMs === input.expectedDurationMs);
};

/**
 * Source-aligned music exclusion predicate shared by composition and the
 * Control API AUTO preflight.  Metadata is descriptive only: a track whose
 * name identifies speech, effects, or field recordings is not a music bed
 * unless it is explicitly labelled as music/background/instrumental.
 */
export const isLikelyMusicAsset = (asset: { metadata?: Record<string, unknown> | null }) => {
  const metadata = asset.metadata ?? {};
  const text = [metadata.source_title, metadata.filename, metadata.genre, ...(Array.isArray(metadata.tags) ? metadata.tags : [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/(white noise|field recording|sound effect|\bsfx\b|foley|footsteps|rain|rainfall|birds?|birdsong|waves?|ocean|voice|speech|dialogue|conversation|whoosh|impact)/u.test(text)
    && !/(music|instrumental|soundtrack|background|loop|bpm|corporate|cinematic)/u.test(text)) return false;
  return true;
};

/**
 * A single composition candidate predicate.  The Control API uses this
 * against its workspace asset view before AUTO fallback; the Drizzle
 * composition path uses it after its role/status query.  Keeping the scope,
 * role, media facts, and source exclusion checks together prevents a second
 * selector from drifting from the Worker fact.
 */
export const isUsableMusicAsset = (asset: ScopedAssetMetadata & {
  kind?: unknown;
  status?: unknown;
  metadata?: Record<string, unknown> | null;
}) => {
  if (asset.kind !== "AUDIO" || asset.status !== "READY" || asset.metadata?.audio_role !== "MUSIC") return false;
  if (typeof asset.workspaceId !== "string" || typeof asset.projectId !== "string") return false;
  return hasScopedAssetMetadata(asset, {
    workspaceId: asset.workspaceId,
    projectId: asset.projectId,
    kind: "AUDIO",
    requireDuration: false,
  }) && isLikelyMusicAsset(asset);
};

export type ProductionTaskRunInput = Readonly<{
  prompt: string;
  /** Private PromptPackage sidecar used for source-first provider compaction. */
  sourcePrompt?: string;
  generatedPromptParts?: readonly string[];
  duration: number;
  resolution: string;
  ratio: string;
  referenceAssetIds: string[];
  visualInput: VisualInputSnapshot;
  generationSegmentSequence: number;
  narrativeBeatSequences: number[];
  motionPlanVersion?: string;
  motionPlanHash?: string;
  motionTimeline?: MotionBeat[];
  deliveryPlanRevisionId?: string;
  /** Private billing fact frozen when the production run is created. */
  billing?: VideoGenerationInputSnapshot["billing"];
}>;

export type ProductionTaskRunInputFactory = (input: ProductionTaskRunInput) => VideoGenerationInputSnapshot;

const productionEventTypes = ["production_run.confirmed", "task_run.succeeded", "task_run.failed", "handoff_asset.accepted"] as const;
type ProductionTriggerEvent = Extract<InternalEventEnvelope, { event_type: (typeof productionEventTypes)[number] }>;

const isProductionTriggerEvent = (event: InternalEventEnvelope): event is ProductionTriggerEvent =>
  productionEventTypes.includes(event.event_type as (typeof productionEventTypes)[number]);

const mediaRuntimeEventTypes = ["narration_audio.generation_requested", "production_segment.qc_requested", "handoff_review.requested", "video_version.composition_requested"] as const;
type MediaRuntimeTriggerEvent = Extract<InternalEventEnvelope, { event_type: (typeof mediaRuntimeEventTypes)[number] }>;

const isMediaRuntimeTriggerEvent = (event: InternalEventEnvelope): event is MediaRuntimeTriggerEvent =>
  mediaRuntimeEventTypes.includes(event.event_type as (typeof mediaRuntimeEventTypes)[number]);

export type ControlProductionRunProgress = {
  productionRun: {
    id: string;
    workspaceId: string;
    projectId: string;
    storyboardRevisionId: string;
    deliveryPlanRevisionId?: string;
    status: ProductionRunStatus;
    totalShotCount: number;
    acceptedShotCount: number;
    totalSegmentCount: number;
    acceptedSegmentCount: number;
    totalDurationSeconds: number;
    continuityStatus: "NOT_CHECKED" | "CHECKING" | "GOOD" | "AUTO_REPAIRING" | "NEEDS_ATTENTION";
    plannedSegmentCount: number;
    maxAutoRepairCount: number;
    autoRepairCount: number;
    createdAt: string;
    updatedAt: string;
  };
  segments: Array<{
    id: string;
    productionRunId: string;
    sequence: number;
    title: string;
    status: ProductionSegmentStatus;
    retryable: boolean;
    safeSummary: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ControlQcReport = {
  id: string;
  workspaceId: string;
  projectId: string;
  subjectType: "PRODUCTION_SEGMENT" | "VIDEO_VERSION";
  subjectId: string;
  kind: "TECHNICAL" | "COMPOSITION";
  status: QcStatus;
  safeSummary: string;
  audioSummary?: {
    hasAudio: boolean;
    musicApplied: boolean;
    musicTitle?: string;
    musicArtist?: string;
    musicTags?: string[];
    sampleRate?: number;
    integratedLufs?: number;
    truePeakDb?: number;
    loudnessRangeLu?: number;
    unexpectedSilence?: boolean;
  };
  createdAt: string;
};

// Public readers receive only completed, playable versions. Failed render facts remain on production progress.
export type ControlVideoVersion = {
  id: string;
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  storyboardRevisionId: string;
  assetId: string;
  status: "SUCCEEDED";
  durationMs: number;
  qcReport: ControlQcReport;
  createdAt: string;
};

export type ProductionEventClaim =
  | { kind: "CLAIMED"; event: ProductionTriggerEvent }
  | { kind: "DUPLICATE" | "BUSY" | "RETRY" };

export type MediaRuntimeEventClaim =
  | { kind: "CLAIMED"; event: MediaRuntimeTriggerEvent }
  | { kind: "DUPLICATE" | "BUSY" | "RETRY" };

export type ProductionSegmentQcInput = {
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  productionSegmentId: string;
  taskRunId: string;
  /** Private native-provider speech expectation; never serialized to events/browser. */
  audioOwner?: VideoAudioOwner;
  /** Persisted PromptPackage delivery_cues.provider_text, for native speech QC only. */
  providerText?: string;
  sourceAsset: {
    id: string;
    objectKey: string;
    sha256: string;
    byteSize: number;
    mimeType: string;
  };
};

export type ProductionCompositionInput = {
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  storyboardRevisionId: string;
  /** Derived privately from the approved creative brief for automatic transcript QC. */
  scriptText?: string;
  narrationScriptText?: string;
  narrationSegments?: Array<{
    text: string;
    startMs: number;
    pronunciationGuides?: Array<{ source: string; spoken: string; reason: string }>;
    pauseBeforeMs?: number;
    pauseAfterMs?: number;
    pace?: "SLOW" | "NATURAL" | "FAST";
    energy?: "CALM" | "NEUTRAL" | "EMPHATIC";
  }>;
  /** Private delivery-plan policy forwarded to Runtime final review. */
  captionPolicy?: "REQUIRED" | "OPTIONAL" | "OFF";
  /** Private approved C12.7B audio asset metadata; never public. */
  narrationAsset?: { id: string; workspaceId: string; projectId: string; objectKey: string; sha256: string; byteSize: number; mimeType: string; durationMs: number };
  /** Independently measured formal narration assets mapped one-to-one to PRIMARY windows. */
  narrationAssets?: Array<{ sectionId: string; assetVersionId: string; id: string; workspaceId: string; projectId: string; objectKey: string; sha256: string; byteSize: number; mimeType: string; durationMs: number }>;
  compositionPlan?: MediaRuntimeCompositionPlan;
  /** Internal scope metadata is required because workspace music is shared across projects. */
  musicAsset?: { id: string; workspaceId: string; projectId: string; objectKey: string; sha256: string; byteSize: number; mimeType: string; durationMs?: number };
  musicMetadata?: { title?: string; artist?: string; tags?: string[] };
  segments: Array<{
    sequence: number;
    taskRunId: string;
    sourceAsset: {
      id: string;
      objectKey: string;
      sha256: string;
      byteSize: number;
      mimeType: string;
      durationMs: number;
    };
  }>;
};

/**
 * A composition event can legitimately outlive its production run (for
 * example after a retry races a completed run), but a still-reviewing run
 * whose inputs are not ready must not be acknowledged.  The repository uses
 * this typed error for the latter case so the worker releases the lease and
 * lets the queue retry/dead-letter path persist FAILED/QC_FAILED state.
 */
export class ProductionCompositionInputUnavailableError extends Error {
  readonly code = "QC_FAILED" as const;
  readonly retryable = true;

  constructor(reason: string) {
    super(`QC_FAILED: ${reason}`);
    this.name = "ProductionCompositionInputUnavailableError";
  }
}

/**
 * Resolve the owner for a composition without guessing across segments. A
 * legacy run with no owner facts keeps its historical behavior; once any
 * owner is declared, every accepted segment must declare the same owner.
 */
export const resolveAudioOwnerForComposition = (facts: readonly AudioOwnerFact[]): VideoAudioOwner | undefined => {
  if (facts.some((fact) => fact.kind === "INVALID")) {
    throw new ProductionCompositionInputUnavailableError("accepted segment audio owner fact is invalid");
  }
  const known = facts.filter((fact): fact is Extract<AudioOwnerFact, { kind: "KNOWN" }> => fact.kind === "KNOWN");
  if (known.length === 0) return undefined;
  const owner = known[0]!.owner;
  if (known.length !== facts.length || known.some((fact) => fact.owner !== owner)) {
    throw new ProductionCompositionInputUnavailableError("accepted segments have mixed or unknown audio owners");
  }
  return owner;
};

export type HandoffReviewInput = {
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  handoffReviewId: string;
  fromSequence: number;
  toSequence: number;
  fromSourceAsset: ProductionSegmentQcInput["sourceAsset"];
  toSourceAsset: ProductionSegmentQcInput["sourceAsset"];
  continuityHints: { fromTitle: string; toTitle: string };
};

export type MediaRuntimeFailureCode = "MEDIA_RUNTIME_UNAVAILABLE" | "MEDIA_RENDER_FAILED" | "QC_FAILED";

export type NarrationDurationFeedbackInput = {
  eventId: string;
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  feedback: MediaRuntimeNarrationDurationFeedback;
  now: Date;
};

/** Event-derived id keeps the source EP_STATE feedback idempotent across
 * queue retries and worker restarts without adding a second persistence key. */
export const narrationDurationFeedbackLogId = (eventId: string) =>
  `cdl_${eventId.startsWith("evt_") ? eventId.slice(4) : eventId}`;

export type ProductionSegmentRetryExecution =
  | { kind: "NEW"; value: ControlProductionRunProgress; status: 202 }
  | { kind: "REPLAY"; value: ControlProductionRunProgress; status: 202 }
  | { kind: "CONFLICT" }
  | { kind: "NOT_FOUND" }
  | { kind: "STATE_INVALID" };

export type RetryProductionSegmentInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  productionRunId: string;
  sequence: number;
  event: {
    messageId: string;
    traceId: string;
    correlationId: string;
  };
};

export interface ProductionStore extends OutboxRelayStore {
  listProjectProductionProgress(workspaceId: string, projectId: string): Promise<ControlProductionRunProgress[]>;
  listProjectVideoVersions(workspaceId: string, projectId: string): Promise<ControlVideoVersion[]>;
  findProductionRunProgress(workspaceId: string, productionRunId: string): Promise<ControlProductionRunProgress | undefined>;
  retryProductionSegment(input: RetryProductionSegmentInput): Promise<ProductionSegmentRetryExecution>;
  retryProductionComposition(input: RetryProductionCompositionInput): Promise<ProductionCompositionRetryExecution>;
  claimProductionEvent(input: { message: InternalProductionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<ProductionEventClaim>;
  completeProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }): Promise<void>;
  releaseProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
  initializeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "production_run.confirmed" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  recoverActiveProductionRuns(input: { now: Date; workspaceId?: string }): Promise<ControlProductionRunProgress[]>;
  recordProductionTaskSucceeded(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  recordProductionTaskFailed(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.failed" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  resumeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "handoff_asset.accepted" }>; now: Date }): Promise<ControlProductionRunProgress | undefined>;
  claimMediaRuntimeEvent(input: { message: InternalMediaRuntimeQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<MediaRuntimeEventClaim>;
  completeMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }): Promise<void>;
  releaseMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
  findProductionSegmentQcInput(input: { event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }> }): Promise<ProductionSegmentQcInput | undefined>;
  findHandoffReviewInput(input: { event: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }> }): Promise<HandoffReviewInput | undefined>;
  findProductionCompositionInput(input: { event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> }): Promise<ProductionCompositionInput | undefined>;
  completeHandoffReview(input: {
    event: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }>;
    evaluation: {
      result: HandoffReviewResult;
      reasonCodes: HandoffReviewReasonCode[];
      safeSummary: string;
      evaluatorVersion: string;
      retryable: boolean;
    };
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
  acceptProductionSegmentQc(input: {
    event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>;
    handoffAsset: { id: string; objectKey: string; sha256: string; byteSize: number; width: number; height: number };
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
  completeProductionComposition(input: {
    event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>;
    videoAsset: { id: string; objectKey: string; sha256: string; byteSize: number; durationMs: number };
    finalReview?: { status: "PASS" | "NEEDS_ATTENTION" | "FAILED"; issues_found: string[]; recommended_action: "PRESENT_WITH_REVIEW" | "REVISE" | "BLOCK"; audio_summary?: Record<string, unknown> };
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
  recordNarrationDurationFeedback?(input: NarrationDurationFeedbackInput): Promise<void>;
  failMediaRuntimeEvent(input: {
    eventId: string;
    workspaceId: string;
    errorCode: MediaRuntimeFailureCode;
    retryable: boolean;
    now: Date;
  }): Promise<ControlProductionRunProgress | undefined>;
}

const timestamp = (value: Date | string) => new Date(value).toISOString();
const safeReason = (reason: string) => reason.replace(/[\r\n]+/g, " ").slice(0, 500);
const isPromptBudgetFailure = (error: unknown) => error instanceof Error
  && error.name === "UnsupportedVideoGenerationInputError"
  && (error as { code?: unknown }).code === "PROMPT_BUDGET";
const promptBudgetFailureSummary = "本段提示词压缩后仍超过当前视频 Provider 的 4096 字节上限，未提交生成。请缩短本段描述后重新生成。";
const readPromptCompactionSidecar = (capabilitySnapshot: Record<string, unknown>) => {
  const sourcePrompt = capabilitySnapshot.source_prompt;
  const generatedPromptParts = capabilitySnapshot.generated_prompt_parts;
  if (typeof sourcePrompt !== "string" || !Array.isArray(generatedPromptParts)
    || !generatedPromptParts.every((part): part is string => typeof part === "string")) return {};
  return { sourcePrompt, generatedPromptParts };
};
const readProductionBilling = (budgetGuard: unknown): ProductionTaskRunInput["billing"] => {
  if (!budgetGuard || typeof budgetGuard !== "object") return undefined;
  const candidate = (budgetGuard as Record<string, unknown>).billing;
  if (!candidate || typeof candidate !== "object") return undefined;
  const externalUserId = (candidate as Record<string, unknown>).external_user_id;
  const billingRule = BillingRuleSnapshotSchema.safeParse((candidate as Record<string, unknown>).billing_rule);
  if (!Number.isInteger(externalUserId) || Number(externalUserId) <= 0 || !billingRule.success) return undefined;
  return { external_user_id: externalUserId as number, billing_rule: billingRule.data };
};
const retryCommandScope = (scope: string, idempotencyKey: string) =>
  and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const serializeProductionRun = (value: typeof productionRuns.$inferSelect): ControlProductionRunProgress["productionRun"] => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  storyboardRevisionId: value.storyboardRevisionId,
  ...(value.deliveryPlanRevisionId ? { deliveryPlanRevisionId: value.deliveryPlanRevisionId } : {}),
  status: value.status,
  totalShotCount: value.totalShotCount,
  acceptedShotCount: value.acceptedShotCount,
  totalSegmentCount: value.totalShotCount,
  acceptedSegmentCount: value.acceptedShotCount,
  totalDurationSeconds: value.totalDurationSeconds,
  continuityStatus: value.continuityStatus,
  plannedSegmentCount: value.totalShotCount,
  maxAutoRepairCount: value.maxAutoRepairCount,
  autoRepairCount: value.autoRepairCount,
  createdAt: timestamp(value.createdAt),
  updatedAt: timestamp(value.updatedAt),
});

const serializeSegment = (value: typeof productionSegments.$inferSelect): ControlProductionRunProgress["segments"][number] => ({
  id: value.id,
  productionRunId: value.productionRunId,
  sequence: value.sequence,
  title: value.title,
  status: value.status,
  retryable: value.retryable,
  safeSummary: value.safeSummary,
  createdAt: timestamp(value.createdAt),
  updatedAt: timestamp(value.updatedAt),
});

const serializeQcReport = (value: typeof qcReports.$inferSelect): ControlQcReport => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  subjectType: value.subjectType,
  subjectId: value.subjectId,
  kind: value.kind,
  status: value.status,
  safeSummary: value.safeSummary,
  ...(() => {
    const details = value.details as Record<string, unknown> | null | undefined;
    const audio = details?.audio_summary;
    if (!audio || typeof audio !== "object") return {};
    const item = audio as Record<string, unknown>;
    return {
      audioSummary: {
        hasAudio: item.has_audio === true,
        musicApplied: item.music_applied === true,
        ...(typeof item.music_title === "string" ? { musicTitle: item.music_title.slice(0, 240) } : {}),
        ...(typeof item.music_artist === "string" ? { musicArtist: item.music_artist.slice(0, 160) } : {}),
        ...(Array.isArray(item.music_tags) ? { musicTags: item.music_tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12) } : {}),
        ...(typeof item.sample_rate === "number" ? { sampleRate: item.sample_rate } : {}),
        ...(typeof item.integrated_lufs === "number" ? { integratedLufs: item.integrated_lufs } : {}),
        ...(typeof item.true_peak_db === "number" ? { truePeakDb: item.true_peak_db } : {}),
        ...(typeof item.loudness_range_lu === "number" ? { loudnessRangeLu: item.loudness_range_lu } : {}),
        ...(typeof item.unexpected_silence === "boolean" ? { unexpectedSilence: item.unexpected_silence } : {}),
      },
    };
  })(),
  createdAt: timestamp(value.createdAt),
});

const serializeVideoVersion = (value: typeof videoVersions.$inferSelect, qcReport: typeof qcReports.$inferSelect): ControlVideoVersion => {
  if (value.status !== "SUCCEEDED" || !value.assetId || !value.durationMs || !value.qcReportId) {
    throw new Error("Only completed video versions can be exposed to the public reader.");
  }
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    productionRunId: value.productionRunId,
    storyboardRevisionId: value.storyboardRevisionId,
    assetId: value.assetId,
    status: "SUCCEEDED",
    durationMs: value.durationMs,
    qcReport: serializeQcReport(qcReport),
    createdAt: timestamp(value.createdAt),
  };
};

const insertOutboxEvent = async (executor: QueryExecutor, event: InternalEventEnvelope) =>
  executor.insert(outboxEvents).values({
    id: event.event_id,
    workspaceId: event.workspace_id,
    projectId: event.project_id ?? null,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    eventType: event.event_type,
    payload: event,
    occurredAt: event.occurred_at,
  });

const lockProductionRun = (executor: QueryExecutor, workspaceId: string, productionRunId: string) =>
  executor.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${productionRunId}))`);

const lockProject = (executor: QueryExecutor, workspaceId: string, projectId: string) =>
  executor.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${projectId}))`);

type EventSource = Pick<InternalEventEnvelope, "message_id" | "trace_id" | "correlation_id" | "idempotency_key" | "workspace_id" | "project_id">;

const nextEventBase = (
  source: EventSource,
  now: Date,
  aggregate: InternalEventEnvelope["aggregate"],
  producer = "production-worker",
) => ({
  contract_version: "1.0" as const,
  message_id: createPrefixedId("msg"),
  event_id: createPrefixedId("evt"),
  occurred_at: timestamp(now),
  trace_id: source.trace_id,
  correlation_id: source.correlation_id,
  causation_id: source.message_id,
  idempotency_key: source.idempotency_key,
  producer,
  workspace_id: source.workspace_id,
  ...(source.project_id === undefined ? {} : { project_id: source.project_id }),
  aggregate,
  version: 1 as const,
});

const progressEvent = (source: EventSource, input: {
  now: Date;
  productionRun: typeof productionRuns.$inferSelect;
  currentSequence: number | null;
  producer?: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRun.id }, input.producer),
  event_type: "production_run.progressed",
  data: {
    production_run_id: input.productionRun.id,
    status: input.productionRun.status,
    accepted_shot_count: input.productionRun.acceptedShotCount,
    total_shot_count: input.productionRun.totalShotCount,
    current_sequence: input.currentSequence,
    continuity_status: input.productionRun.continuityStatus,
    max_auto_repair_count: input.productionRun.maxAutoRepairCount,
    auto_repair_count: input.productionRun.autoRepairCount,
  },
});

const blockedEvent = (source: EventSource, input: {
  now: Date;
  productionRun: typeof productionRuns.$inferSelect;
  sequence: number;
  reasonCode: "DEPENDENCY_PENDING" | "SEGMENT_NEEDS_ATTENTION" | "REFERENCE_POLICY_UNSATISFIED";
  retryable: boolean;
  producer?: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRun.id }, input.producer),
  event_type: "production_run.blocked",
  data: {
    production_run_id: input.productionRun.id,
    sequence: input.sequence,
    reason_code: input.reasonCode,
    retryable: input.retryable,
  },
});

const queuedTaskEvent = (source: EventSource, input: {
  now: Date;
  taskRun: typeof taskRuns.$inferSelect;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "task_run", id: input.taskRun.id }),
  event_type: "task_run.queued",
  data: {
    task_run_id: input.taskRun.id,
    kind: input.taskRun.kind,
    input_snapshot: input.taskRun.inputSnapshot,
  },
});

const qcRequestedEvent = (source: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }>, input: {
  now: Date;
  segment: typeof productionSegments.$inferSelect;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_segment", id: input.segment.id }),
  event_type: "production_segment.qc_requested",
  data: {
    production_run_id: input.segment.productionRunId,
    production_segment_id: input.segment.id,
    task_run_id: input.segment.taskRunId,
  },
});

const qcCompletedEvent = (source: MediaRuntimeTriggerEvent, input: {
  now: Date;
  qcReportId: string;
  subjectType: "PRODUCTION_SEGMENT" | "VIDEO_VERSION";
  subjectId: string;
  status?: "PASS" | "FAILED";
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "qc_report", id: input.qcReportId }, "media-worker"),
  event_type: "qc_report.completed",
  data: {
    qc_report_id: input.qcReportId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    status: input.status ?? "PASS",
  },
});

const handoffAcceptedEvent = (source: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>, input: {
  now: Date;
  productionRunId: string;
  sequence: number;
  handoffAssetId: string;
  assetDerivationId: string;
  qcReportId: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "asset_derivation", id: input.assetDerivationId }, "media-worker"),
  event_type: "handoff_asset.accepted",
  data: {
    production_run_id: input.productionRunId,
    sequence: input.sequence,
    handoff_asset_id: input.handoffAssetId,
    asset_derivation_id: input.assetDerivationId,
    qc_report_id: input.qcReportId,
  },
});

const compositionRequestedEvent = (source: EventSource, input: {
  now: Date;
  productionRunId: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRunId }, "media-worker"),
  event_type: "video_version.composition_requested",
  data: {
    production_run_id: input.productionRunId,
  },
});

const handoffReviewRequestedEvent = (source: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" | "handoff_review.requested" }>, input: {
  now: Date;
  productionRunId: string;
  handoffReviewId: string;
  fromSequence: number;
  toSequence: number;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "handoff_review", id: input.handoffReviewId }, "media-worker"),
  event_type: "handoff_review.requested",
  data: {
    production_run_id: input.productionRunId,
    handoff_review_id: input.handoffReviewId,
    from_sequence: input.fromSequence,
    to_sequence: input.toSequence,
  },
});

const handoffReviewCompletedEvent = (source: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }>, input: {
  now: Date;
  result: HandoffReviewResult;
  reasonCodes: HandoffReviewReasonCode[];
  retryable: boolean;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "handoff_review", id: source.data.handoff_review_id }, "media-worker"),
  event_type: "handoff_review.completed",
  data: {
    production_run_id: source.data.production_run_id,
    handoff_review_id: source.data.handoff_review_id,
    from_sequence: source.data.from_sequence,
    to_sequence: source.data.to_sequence,
    result: input.result,
    reason_codes: input.reasonCodes,
    retryable: input.retryable,
  },
});

const transitionRepairEvent = (source: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }>, input: {
  eventType: "transition_repair.requested" | "transition_repair.succeeded";
  now: Date;
  transitionRepairId: string;
  productionRunId: string;
  boundarySequence: number;
  strategy: "BLEND" | "BRIDGE";
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "transition_repair", id: input.transitionRepairId }, "media-worker"),
  event_type: input.eventType,
  data: {
    production_run_id: input.productionRunId,
    transition_repair_id: input.transitionRepairId,
    boundary_sequence: input.boundarySequence,
    strategy: input.strategy,
  },
});

const videoVersionSucceededEvent = (source: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>, input: {
  now: Date;
  videoVersionId: string;
  productionRunId: string;
  assetId: string;
  durationMs: number;
  qcReportId: string;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "video_version", id: input.videoVersionId }, "media-worker"),
  event_type: "video_version.succeeded",
  data: {
    video_version_id: input.videoVersionId,
    production_run_id: input.productionRunId,
    asset_id: input.assetId,
    duration_ms: input.durationMs,
    qc_report_id: input.qcReportId,
  },
});

const videoVersionFailedEvent = (source: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>, input: {
  now: Date;
  productionRunId: string;
  errorCode: MediaRuntimeFailureCode;
  retryable: boolean;
}) => InternalEventEnvelopeSchema.parse({
  ...nextEventBase(source, input.now, { type: "production_run", id: input.productionRunId }, "media-worker"),
  event_type: "video_version.failed",
  data: {
    production_run_id: input.productionRunId,
    error_code: input.errorCode,
    retryable: input.retryable,
  },
});

const messageMatchesEvent = (message: InternalProductionQueueMessage, event: InternalEventEnvelope) => {
  if (event.event_id !== message.event_id
    || event.workspace_id !== message.workspace_id
    || event.project_id !== message.project_id
    || event.correlation_id !== message.correlation_id
    || event.event_type !== message.event_type) return false;
  if (message.event_type === "production_run.confirmed") {
    return event.event_type === "production_run.confirmed" && event.data.production_run_id === message.production_run_id;
  }
  if (message.event_type === "handoff_asset.accepted") {
    return event.event_type === "handoff_asset.accepted" && event.data.production_run_id === message.production_run_id;
  }
  return (event.event_type === "task_run.succeeded" || event.event_type === "task_run.failed")
    && event.data.task_run_id === message.task_run_id;
};

const mediaMessageMatchesEvent = (message: InternalMediaRuntimeQueueMessage, event: InternalEventEnvelope) => {
  if (event.event_id !== message.event_id
    || event.workspace_id !== message.workspace_id
    || event.project_id !== message.project_id
    || event.correlation_id !== message.correlation_id
    || event.event_type !== message.event_type) return false;
  if (message.event_type === "narration_audio.generation_requested") {
    return event.event_type === "narration_audio.generation_requested"
      && event.data.narration_script_revision_id === message.narration_script_revision_id
      && event.data.generation_kind === message.generation_kind
      && event.data.section_id === message.section_id
      && event.data.asset_id === message.asset_id
      && event.data.narration_asset_version_id === message.narration_asset_version_id
      && event.data.sample_asset_id === message.sample_asset_id
      && event.data.provider === message.provider
      && event.data.voice_id === message.voice_id
      && event.data.canonical_script_hash === message.canonical_script_hash
      && JSON.stringify(event.data.provider_settings) === JSON.stringify(message.provider_settings)
      && event.data.object_key === message.object_key;
  }
  if (message.event_type === "production_segment.qc_requested") {
    return event.event_type === "production_segment.qc_requested"
      && event.data.production_run_id === message.production_run_id
      && event.data.production_segment_id === message.production_segment_id
      && event.data.task_run_id === message.task_run_id;
  }
  if (message.event_type === "handoff_review.requested") {
    return event.event_type === "handoff_review.requested"
      && event.data.production_run_id === message.production_run_id
      && event.data.handoff_review_id === message.handoff_review_id
      && event.data.from_sequence === message.from_sequence
      && event.data.to_sequence === message.to_sequence;
  }
  return event.event_type === "video_version.composition_requested"
    && event.data.production_run_id === message.production_run_id;
};

const referenceImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
type ReferenceImageMimeType = (typeof referenceImageMimeTypes)[number];
type ReadyReferenceImageAsset = typeof assets.$inferSelect & { sha256: string; mimeType: ReferenceImageMimeType };

const isReferenceImageMimeType = (value: string | null): value is ReferenceImageMimeType =>
  referenceImageMimeTypes.includes(value as ReferenceImageMimeType);

const uniqueIds = (ids: string[]) => [...new Set(ids)];

export type AudioOwnerFact =
  | { kind: "ABSENT" }
  | { kind: "KNOWN"; owner: VideoAudioOwner }
  | { kind: "INVALID" };

/**
 * Read the private owner fact without changing historical snapshots.  A
 * malformed value is distinct from an absent value so a partially migrated
 * native run cannot silently fall back to the platform narration route.
 */
const readAudioOwnerFact = (snapshot: unknown): AudioOwnerFact => {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return { kind: "ABSENT" };
  if (!Object.prototype.hasOwnProperty.call(snapshot, "audio_owner")) return { kind: "ABSENT" };
  const parsed = VideoGenerationInputSnapshotSchema.safeParse(snapshot);
  return parsed.success && parsed.data.audio_owner
    ? { kind: "KNOWN", owner: parsed.data.audio_owner }
    : { kind: "INVALID" };
};

/**
 * Read the authored provider text from the existing PromptPackage snapshot.
 * This is a private fact lookup for native speech QC; it does not infer text
 * from visual prose or add a second transcript contract.
 */
const readProviderTextFact = (snapshot: unknown): string | undefined => {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  const motionPlan = (snapshot as { motion_plan?: unknown }).motion_plan;
  if (motionPlan === null || typeof motionPlan !== "object" || Array.isArray(motionPlan)) return undefined;
  const voicePerformance = (motionPlan as { voice_performance?: unknown }).voice_performance;
  if (voicePerformance === null || typeof voicePerformance !== "object" || Array.isArray(voicePerformance)) return undefined;
  const deliveryCues = (voicePerformance as { delivery_cues?: unknown }).delivery_cues;
  if (!Array.isArray(deliveryCues)) return undefined;
  const text = deliveryCues
    .map((cue) => {
      if (cue === null || typeof cue !== "object" || Array.isArray(cue)) return "";
      const providerText = (cue as { provider_text?: unknown }).provider_text;
      return typeof providerText === "string" ? providerText.trim() : "";
    })
    .filter(Boolean)
    .join("");
  return text || undefined;
};

const readyReferenceImageAssets = async (transaction: QueryExecutor, input: {
  workspaceId: string;
  projectId: string;
  assetIds: string[];
  origin: "USER_UPLOAD" | "DERIVED";
}) => {
  const orderedIds = uniqueIds(input.assetIds);
  if (orderedIds.length === 0) return [] as ReadyReferenceImageAsset[];
  const rows = await transaction
    .select()
    .from(assets)
    .where(and(
      eq(assets.workspaceId, input.workspaceId),
      eq(assets.projectId, input.projectId),
      eq(assets.status, "READY"),
      eq(assets.kind, "IMAGE"),
      eq(assets.origin, input.origin),
      inArray(assets.id, orderedIds),
    ));
  const byId = new Map(rows.map((asset) => [asset.id, asset]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((asset): asset is ReadyReferenceImageAsset =>
      Boolean(asset?.sha256 && isReferenceImageMimeType(asset.mimeType)));
};

const visualReference = (asset: ReadyReferenceImageAsset, position: number, role: VisualReferenceRole) => ({
  asset_id: asset.id,
  sha256: asset.sha256,
  mime_type: asset.mimeType,
  position,
  role,
});

const initialVisualInput = async (transaction: QueryExecutor, input: {
  workspaceId: string;
  projectId: string;
  productionRun: typeof productionRuns.$inferSelect;
  shotSpec: typeof storyboardShotSpecs.$inferSelect;
  sourceAssetIds: string[];
  sourcePrompt: string;
  dependencySegments: Array<typeof productionSegments.$inferSelect>;
}) => {
  if (input.shotSpec.referencePolicy === "TEXT_TRANSITION") {
    return { kind: "READY" as const, references: [] as Array<{ assetId: string; role: "STYLE" | "FIRST_FRAME"; position: number }>, visualInput: { mode: "TEXT" as const, references: [] as [] } };
  }
  const sourceImages = (await readyReferenceImageAssets(transaction, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    assetIds: input.sourceAssetIds,
    origin: "USER_UPLOAD",
  })).slice(0, 7);
  const sourceRoles = inferVisualReferenceRoles({
    sourcePrompt: input.sourcePrompt,
    count: sourceImages.length,
    sourceImageNames: sourceImages.map((asset) => typeof asset.metadata?.filename === "string" ? asset.metadata.filename : undefined),
    visionAnalyses: sourceImages.map((asset) => parseVisualReferenceAnalysis(asset.metadata.visual_analysis)),
  });
  const sourceRoleByAssetId = new Map(sourceImages.map((asset, index) => [asset.id, sourceRoles[index]]));
  if (input.shotSpec.referencePolicy === "REFERENCE_SET") {
    if (sourceImages.length === 0) {
      return { kind: "WAITING" as const, reasonCode: "REFERENCE_POLICY_UNSATISFIED" as const, safeSummary: "等待可用的参考素材后继续制作。" };
    }
    if (sourceImages.some((asset) => sourceRoleByAssetId.get(asset.id) === undefined)) {
      return { kind: "WAITING" as const, reasonCode: "REFERENCE_POLICY_UNSATISFIED" as const, safeSummary: "等待补充参考图用途说明或内容识别完成后继续制作。" };
    }
    return {
      kind: "READY" as const,
      references: sourceImages.map((asset, position) => ({ assetId: asset.id, role: "STYLE" as const, position })),
      visualInput: {
        mode: "REFERENCE_SET" as const,
        references: sourceImages.map((asset, position) => visualReference(asset, position, sourceRoleByAssetId.get(asset.id)!)),
      },
    };
  }

  const handoffAssetIds = input.dependencySegments
    .filter((segment) => input.shotSpec.dependsOnSequences.includes(segment.sequence))
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, 1)
    .map((segment) => segment.handoffAssetId)
    .filter((assetId): assetId is string => Boolean(assetId));
  const [handoffAsset] = await readyReferenceImageAssets(transaction, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    assetIds: handoffAssetIds,
    origin: "DERIVED",
  });
  if (!handoffAsset) {
    return { kind: "WAITING" as const, reasonCode: "REFERENCE_POLICY_UNSATISFIED" as const, safeSummary: "等待前一段交接帧通过检查后继续制作。" };
  }
  const ordered = [handoffAsset, ...sourceImages.filter((asset) => asset.id !== handoffAsset.id).slice(0, 6)];
  const nonHandoffSourceImages = sourceImages.filter((asset) => asset.id !== handoffAsset.id).slice(0, 6);
  if (nonHandoffSourceImages.some((asset) => sourceRoleByAssetId.get(asset.id) === undefined)) {
    return { kind: "WAITING" as const, reasonCode: "REFERENCE_POLICY_UNSATISFIED" as const, safeSummary: "等待补充参考图用途说明或内容识别完成后继续制作。" };
  }
  if (ordered.length === 1) {
    return {
      kind: "READY" as const,
      references: [{ assetId: handoffAsset.id, role: "FIRST_FRAME" as const, position: 0 }],
      visualInput: {
        mode: "FIRST_FRAME" as const,
        references: [visualReference(handoffAsset, 0, "HANDOFF")] as [{
          asset_id: string;
          sha256: string;
          mime_type: "image/jpeg" | "image/png" | "image/webp";
          position: number;
          role: "HANDOFF";
        }],
      },
    };
  }
  return {
    kind: "READY" as const,
    references: ordered.map((asset, position) => ({
      assetId: asset.id,
      role: position === 0 ? "FIRST_FRAME" as const : "STYLE" as const,
      position,
    })),
        visualInput: {
      mode: "REFERENCE_SET" as const,
      references: [
        visualReference(handoffAsset, 0, "HANDOFF"),
        ...nonHandoffSourceImages.map((asset, index) => visualReference(asset, index + 1, sourceRoleByAssetId.get(asset.id)!)),
      ],
    },
  };
};

export type ProductionCompositionRetryExecution =
  | { kind: "NEW"; value: ControlProductionRunProgress; status: 202 }
  | { kind: "REPLAY"; value: ControlProductionRunProgress; status: 202 }
  | { kind: "CONFLICT" }
  | { kind: "NOT_FOUND" }
  | { kind: "STATE_INVALID" };

export type RetryProductionCompositionInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  productionRunId: string;
  event: {
    messageId: string;
    traceId: string;
    correlationId: string;
  };
};

const createDefaultProductionTaskRunInputSnapshot: ProductionTaskRunInputFactory = (input) =>
  VideoGenerationInputSnapshotSchema.parse({
    model: "mock-video-v1",
    prompt: input.prompt,
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio,
    reference_asset_ids: input.referenceAssetIds,
    visual_input: input.visualInput,
    ...(input.deliveryPlanRevisionId ? { delivery_plan_revision_id: input.deliveryPlanRevisionId } : {}),
    ...(input.motionPlanVersion ? { motion_plan_version: input.motionPlanVersion } : {}),
    ...(input.motionPlanHash ? { motion_plan_hash: input.motionPlanHash } : {}),
    ...(input.motionTimeline ? { motion_timeline: input.motionTimeline } : {}),
    ...(input.billing ? { billing: input.billing } : {}),
  });

export class DrizzleProductionRepository implements ProductionStore {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly createTaskRunInputSnapshot: ProductionTaskRunInputFactory = createDefaultProductionTaskRunInputSnapshot,
  ) {}

  async listProjectProductionProgress(workspaceId: string, projectId: string) {
    const runs = await this.db
      .select()
      .from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.projectId, projectId)))
      .orderBy(desc(productionRuns.createdAt));
    return Promise.all(runs.map((run) => this.findProductionRunProgress(workspaceId, run.id))).then((values) => values.filter((value): value is ControlProductionRunProgress => Boolean(value)));
  }

  async findProductionRunProgress(workspaceId: string, productionRunId: string) {
    const [run] = await this.db
      .select()
      .from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, productionRunId)))
      .limit(1);
    if (!run) return undefined;
    const segments = await this.db
      .select()
      .from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, run.id), eq(productionSegments.projectId, run.projectId)))
      .orderBy(asc(productionSegments.sequence));
    return { productionRun: serializeProductionRun(run), segments: segments.map(serializeSegment) };
  }

  async retryProductionSegment(input: RetryProductionSegmentInput): Promise<ProductionSegmentRetryExecution> {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .insert(commandDeduplications)
        .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
        .onConflictDoNothing()
        .returning({ scope: commandDeduplications.scope });
      if (!reservation) return this.replayProductionSegmentRetry(transaction, input);

      await lockProductionRun(transaction, input.workspaceId, input.productionRunId);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.id, input.productionRunId)))
        .limit(1);
      if (!run) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "NOT_FOUND" });
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.workspaceId),
          eq(productionSegments.projectId, run.projectId),
          eq(productionSegments.productionRunId, run.id),
          eq(productionSegments.sequence, input.sequence),
        ))
        .limit(1);
      if (!segment) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "NOT_FOUND" });
      if (run.status !== "BLOCKED" || segment.status !== "FAILED" || !segment.retryable || !segment.taskRunId || !segment.shotId) {
        return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });
      }

      const [previousTaskRun] = await transaction
        .select()
        .from(taskRuns)
        .where(and(eq(taskRuns.workspaceId, input.workspaceId), eq(taskRuns.projectId, run.projectId), eq(taskRuns.id, segment.taskRunId)))
        .limit(1);
      const [previousShot] = await transaction
        .select()
        .from(shots)
        .where(and(eq(shots.workspaceId, input.workspaceId), eq(shots.projectId, run.projectId), eq(shots.id, segment.shotId)))
        .limit(1);
      if (!previousTaskRun || !previousShot) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });

      const snapshot = VideoGenerationInputSnapshotSchema.safeParse(previousTaskRun.inputSnapshot);
      if (!snapshot.success) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });
      await lockProject(transaction, input.workspaceId, run.projectId);
      const [positionRow] = await transaction
        .select({ position: sql<number>`coalesce(max(${shots.position}), -1)` })
        .from(shots)
        .where(and(eq(shots.workspaceId, input.workspaceId), eq(shots.projectId, run.projectId)));
      const previousBindings = await transaction
        .select()
        .from(referenceBindings)
        .where(and(eq(referenceBindings.workspaceId, input.workspaceId), eq(referenceBindings.projectId, run.projectId), eq(referenceBindings.shotId, previousShot.id)))
        .orderBy(asc(referenceBindings.position));
      const shotId = createPrefixedId("sht");
      const taskRunId = createPrefixedId("tsk");
      const now = timestamp(new Date());
      await transaction.insert(shots).values({
        id: shotId,
        workspaceId: input.workspaceId,
        projectId: run.projectId,
        position: (positionRow?.position ?? -1) + 1,
        prompt: previousShot.prompt,
        model: previousShot.model,
        generationSettings: previousShot.generationSettings,
        status: "GENERATING",
        selectedAssetId: previousShot.selectedAssetId,
        createdAt: now,
        updatedAt: now,
      });
      if (previousBindings.length > 0) {
        await transaction.insert(referenceBindings).values(previousBindings.map((binding) => ({
          workspaceId: input.workspaceId,
          projectId: run.projectId,
          shotId,
          assetId: binding.assetId,
          role: binding.role,
          position: binding.position,
          createdAt: now,
        })));
      }
      const [taskRun] = await transaction.insert(taskRuns).values({
        id: taskRunId,
        workspaceId: input.workspaceId,
        projectId: run.projectId,
        shotId,
        kind: "VIDEO_GENERATION",
        status: "QUEUED",
        inputSnapshot: snapshot.data,
        createdAt: now,
        updatedAt: now,
      }).returning();

      assertProductionSegmentTransition(segment.status, "GENERATING");
      await transaction
        .update(productionSegments)
        .set({
          status: "GENERATING",
          retryable: false,
          safeSummary: "正在重新生成本段视频。",
          shotId,
          taskRunId,
          handoffAssetId: null,
          qcReportId: null,
          updatedAt: now,
        })
        .where(and(eq(productionSegments.workspaceId, input.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "FAILED")));
      assertProductionRunTransition(run.status, "GENERATING");
      const [running] = await transaction
        .update(productionRuns)
        .set({ status: "GENERATING", updatedAt: now })
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "BLOCKED")))
        .returning();
      if (!running) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "STATE_INVALID" });

      const source: EventSource = {
        message_id: input.event.messageId,
        trace_id: input.event.traceId,
        correlation_id: input.event.correlationId,
        idempotency_key: input.idempotencyKey,
        workspace_id: input.workspaceId,
        project_id: run.projectId,
      };
      await insertOutboxEvent(transaction, queuedTaskEvent(source, { now: new Date(now), taskRun }));
      await insertOutboxEvent(transaction, progressEvent(source, { now: new Date(now), productionRun: running, currentSequence: segment.sequence, producer: "control-api" }));
      const progress = await this.progressWithinTransaction(transaction, input.workspaceId, run.id);
      if (!progress) return this.storeProductionSegmentRetryOutcome(transaction, input, { kind: "NOT_FOUND" });
      await this.storeProductionSegmentRetrySnapshot(transaction, input, run.id);
      return { kind: "NEW", value: progress, status: 202 };
    });
  }

  async listProjectVideoVersions(workspaceId: string, projectId: string) {
    const rows = await this.db
      .select({ version: videoVersions, qcReport: qcReports })
      .from(videoVersions)
      .innerJoin(qcReports, and(
        eq(qcReports.workspaceId, videoVersions.workspaceId),
        eq(qcReports.projectId, videoVersions.projectId),
        eq(qcReports.id, videoVersions.qcReportId),
      ))
      .where(and(
        eq(videoVersions.workspaceId, workspaceId),
        eq(videoVersions.projectId, projectId),
        eq(videoVersions.status, "SUCCEEDED"),
      ))
      .orderBy(desc(videoVersions.createdAt));
    return rows.map(({ version, qcReport }) => serializeVideoVersion(version, qcReport));
  }

  async initializeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "production_run.confirmed" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.event.workspace_id),
          eq(productionRuns.projectId, input.event.project_id!),
          eq(productionRuns.id, input.event.data.production_run_id),
        ))
        .limit(1);
      if (!run || run.storyboardRevisionId !== input.event.data.storyboard_revision_id || run.totalShotCount !== input.event.data.total_shot_count) return undefined;
      const existing = await transaction
        .select()
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, run.workspaceId), eq(productionSegments.productionRunId, run.id)))
        .orderBy(asc(productionSegments.sequence));
      if (existing.length === 0) {
        const specs = await transaction
          .select()
          .from(storyboardShotSpecs)
          .where(and(
            eq(storyboardShotSpecs.workspaceId, run.workspaceId),
            eq(storyboardShotSpecs.projectId, run.projectId),
            eq(storyboardShotSpecs.storyboardRevisionId, run.storyboardRevisionId),
          ))
          .orderBy(asc(storyboardShotSpecs.sequence));
        if (specs.length !== run.totalShotCount) return undefined;
        await transaction.insert(productionSegments).values(specs.map((spec) => ({
          id: createPrefixedId("psg"),
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          productionRunId: run.id,
          shotSpecId: spec.id,
          sequence: spec.sequence,
          title: spec.title,
          dependsOnSequences: spec.dependsOnSequences,
          status: "PENDING" as const,
          retryable: true,
          safeSummary: "等待制作准备。",
          createdAt: timestamp(input.now),
          updatedAt: timestamp(input.now),
        })));
      }
      const [current] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id)))
        .limit(1);
      if (!current) return undefined;
      let running = current;
      if (current.status === "CONFIRMED") {
        assertProductionRunTransition(current.status, "GENERATING");
        [running] = await transaction
          .update(productionRuns)
          .set({ status: "GENERATING", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, current.workspaceId), eq(productionRuns.id, current.id), eq(productionRuns.status, "CONFIRMED")))
          .returning();
        if (!running) return undefined;
        await insertOutboxEvent(transaction, progressEvent(input.event, { now: input.now, productionRun: running, currentSequence: null }));
      }
      await this.scheduleEligibleSegments(transaction, { source: input.event, productionRun: running, now: input.now });
      const [latest] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, running.workspaceId), eq(productionRuns.id, running.id)))
        .limit(1);
      if (!latest) return undefined;
      const segments = await transaction
        .select()
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, latest.workspaceId), eq(productionSegments.productionRunId, latest.id)))
        .orderBy(asc(productionSegments.sequence));
      return { productionRun: serializeProductionRun(latest), segments: segments.map(serializeSegment) };
    });
  }

  async retryProductionComposition(input: RetryProductionCompositionInput): Promise<ProductionCompositionRetryExecution> {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction.insert(commandDeduplications)
        .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
        .onConflictDoNothing()
        .returning({ scope: commandDeduplications.scope });
      if (!reservation) {
        const [existing] = await transaction.select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
          .from(commandDeduplications).where(retryCommandScope(input.scope, input.idempotencyKey)).limit(1);
        if (!existing || existing.requestHash !== input.requestHash) return { kind: "CONFLICT" };
        const snapshot = existing.responseSnapshot as { kind?: unknown; productionRunId?: unknown };
        if (snapshot.kind === "PRODUCTION_COMPOSITION_RETRY" && snapshot.productionRunId === input.productionRunId) {
          const value = await this.progressWithinTransaction(transaction, input.workspaceId, input.productionRunId);
          return value ? { kind: "REPLAY", value, status: 202 } : { kind: "CONFLICT" };
        }
        return { kind: "CONFLICT" };
      }
      await lockProductionRun(transaction, input.workspaceId, input.productionRunId);
      const [run] = await transaction.select().from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.id, input.productionRunId))).limit(1);
      if (!run) {
        await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "NOT_FOUND" } }).where(retryCommandScope(input.scope, input.idempotencyKey));
        return { kind: "NOT_FOUND" };
      }
      const segments = await transaction.select().from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, input.workspaceId), eq(productionSegments.projectId, run.projectId), eq(productionSegments.productionRunId, run.id)))
        .orderBy(asc(productionSegments.sequence));
      if (run.status !== "FAILED" || segments.length !== run.totalShotCount || segments.some((segment) => segment.status !== "ACCEPTED" || !segment.taskRunId)) {
        await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "STATE_INVALID" } }).where(retryCommandScope(input.scope, input.idempotencyKey));
        return { kind: "STATE_INVALID" };
      }
      assertProductionRunTransition(run.status, "REVIEWING");
      const [reviewing] = await transaction.update(productionRuns)
        .set({ status: "REVIEWING", updatedAt: timestamp(new Date()) })
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "FAILED")))
        .returning();
      if (!reviewing) return { kind: "STATE_INVALID" };
      const source: EventSource = {
        message_id: input.event.messageId,
        trace_id: input.event.traceId,
        correlation_id: input.event.correlationId,
        idempotency_key: input.idempotencyKey,
        workspace_id: input.workspaceId,
        project_id: run.projectId,
      };
      await transaction.update(commandDeduplications).set({ responseSnapshot: { kind: "PRODUCTION_COMPOSITION_RETRY", productionRunId: run.id } }).where(retryCommandScope(input.scope, input.idempotencyKey));
      await insertOutboxEvent(transaction, compositionRequestedEvent(source, { now: new Date(), productionRunId: run.id }));
      const progress = await this.progressWithinTransaction(transaction, input.workspaceId, run.id);
      return progress ? { kind: "NEW", value: progress, status: 202 } : { kind: "NOT_FOUND" };
    });
  }

  async recoverActiveProductionRuns(input: { now: Date; workspaceId?: string }) {
    const runs = await this.db
      .select()
      .from(productionRuns)
      .where(and(
        eq(productionRuns.status, "GENERATING"),
        ...(input.workspaceId ? [eq(productionRuns.workspaceId, input.workspaceId)] : []),
      ))
      .orderBy(asc(productionRuns.createdAt));
    const recovered: ControlProductionRunProgress[] = [];

    for (const run of runs) {
      const confirmations = await this.db
        .select({ payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(and(
          eq(outboxEvents.workspaceId, run.workspaceId),
          eq(outboxEvents.projectId, run.projectId),
          eq(outboxEvents.aggregateType, "production_run"),
          eq(outboxEvents.aggregateId, run.id),
          eq(outboxEvents.eventType, "production_run.confirmed"),
        ))
        .orderBy(desc(outboxEvents.occurredAt));
      const confirmation = confirmations
        .map((row) => InternalEventEnvelopeSchema.safeParse(row.payload).data)
        .find((event): event is Extract<InternalEventEnvelope, { event_type: "production_run.confirmed" }> =>
          event?.event_type === "production_run.confirmed"
          && event.data.production_run_id === run.id
          && event.project_id === run.projectId,
        );
      if (!confirmation) continue;

      const progress = await this.initializeProductionRun({ event: confirmation, now: input.now });
      if (progress) recovered.push(progress);
    }
    return recovered;
  }

  async recordProductionTaskSucceeded(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.succeeded" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.event.workspace_id),
          eq(productionSegments.projectId, input.event.project_id!),
          eq(productionSegments.taskRunId, input.event.data.task_run_id),
        ))
        .limit(1);
      if (!segment) return undefined;
      await lockProductionRun(transaction, segment.workspaceId, segment.productionRunId);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, segment.workspaceId),
          eq(productionRuns.id, segment.productionRunId),
        ))
        .limit(1);
      if (!run) return undefined;

      let currentSegment = segment;
      if (segment.status === "FAILED") {
        // A legacy/stale UI may retry the underlying TaskRun directly. Reconcile
        // only when the same persisted task has already succeeded; never attach
        // an unrelated result to a production segment.
        const [taskRun] = await transaction
          .select({ status: taskRuns.status, resultAssetId: taskRuns.resultAssetId })
          .from(taskRuns)
          .where(and(
            eq(taskRuns.workspaceId, segment.workspaceId),
            eq(taskRuns.projectId, segment.projectId),
            eq(taskRuns.id, input.event.data.task_run_id),
          ))
          .limit(1);
        if (taskRun?.status !== "SUCCEEDED"
          || taskRun.resultAssetId !== input.event.data.result_asset_id
          || (run.status !== "BLOCKED" && run.status !== "GENERATING")) {
          return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
        }

        let running = run;
        if (run.status === "BLOCKED") {
          assertProductionRunTransition(run.status, "GENERATING");
          [running] = await transaction
            .update(productionRuns)
            .set({ status: "GENERATING", updatedAt: timestamp(input.now) })
            .where(and(
              eq(productionRuns.workspaceId, run.workspaceId),
              eq(productionRuns.id, run.id),
              eq(productionRuns.status, "BLOCKED"),
            ))
            .returning();
          if (!running) return undefined;
          await insertOutboxEvent(transaction, progressEvent(input.event, {
            now: input.now,
            productionRun: running,
            currentSequence: segment.sequence,
          }));
        }

        assertProductionSegmentTransition(segment.status, "GENERATING");
        const [generating] = await transaction
          .update(productionSegments)
          .set({ status: "GENERATING", retryable: false, safeSummary: "正在检查本段画面。", updatedAt: timestamp(input.now) })
          .where(and(
            eq(productionSegments.workspaceId, segment.workspaceId),
            eq(productionSegments.id, segment.id),
            eq(productionSegments.status, "FAILED"),
          ))
          .returning();
        if (!generating) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
        currentSegment = generating;
      }

      if (currentSegment.status === "GENERATING") {
        assertProductionSegmentTransition(currentSegment.status, "CHECKING");
        const [checking] = await transaction
          .update(productionSegments)
          .set({ status: "CHECKING", safeSummary: "正在检查本段画面。", updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, currentSegment.workspaceId), eq(productionSegments.id, currentSegment.id), eq(productionSegments.status, "GENERATING")))
          .returning();
        if (checking) await insertOutboxEvent(transaction, qcRequestedEvent(input.event, { now: input.now, segment: checking }));
      }
      return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
    });
  }

  async recordProductionTaskFailed(input: { event: Extract<InternalEventEnvelope, { event_type: "task_run.failed" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.event.workspace_id),
          eq(productionSegments.projectId, input.event.project_id!),
          eq(productionSegments.taskRunId, input.event.data.task_run_id),
        ))
        .limit(1);
      if (!segment) return undefined;
      await lockProductionRun(transaction, segment.workspaceId, segment.productionRunId);
      if (segment.status === "GENERATING" || segment.status === "CHECKING") {
        assertProductionSegmentTransition(segment.status, "FAILED");
        // A missing/expired upstream request is terminal for the persisted
        // request, but remains explicitly retryable because the production
        // segment retry path creates a fresh Provider task.
        const retryable = input.event.data.retryable || input.event.data.error_code === "PROVIDER_REJECTED";
        await transaction
          .update(productionSegments)
          .set({ status: "FAILED", retryable, safeSummary: "本段制作未完成，可重新提交本段。", updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["GENERATING", "CHECKING"])));
      }
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, segment.workspaceId), eq(productionRuns.id, segment.productionRunId)))
        .limit(1);
      if (run && run.status === "GENERATING") {
        assertProductionRunTransition(run.status, "BLOCKED");
        const [blocked] = await transaction
          .update(productionRuns)
          .set({ status: "BLOCKED", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "GENERATING")))
          .returning();
        if (blocked) await insertOutboxEvent(transaction, blockedEvent(input.event, {
          now: input.now,
          productionRun: blocked,
          sequence: segment.sequence,
          reasonCode: "SEGMENT_NEEDS_ATTENTION",
            retryable: input.event.data.retryable || input.event.data.error_code === "PROVIDER_REJECTED",
        }));
      }
      return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
    });
  }

  async resumeProductionRun(input: { event: Extract<InternalEventEnvelope, { event_type: "handoff_asset.accepted" }>; now: Date }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [current] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.event.workspace_id),
          eq(productionRuns.projectId, input.event.project_id!),
          eq(productionRuns.id, input.event.data.production_run_id),
        ))
        .limit(1);
      if (!current) return undefined;
      let running = current;
      if (current.status === "BLOCKED") {
        assertProductionRunTransition(current.status, "GENERATING");
        [running] = await transaction
          .update(productionRuns)
          .set({ status: "GENERATING", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, current.workspaceId), eq(productionRuns.id, current.id), eq(productionRuns.status, "BLOCKED")))
          .returning();
        if (!running) return undefined;
      }
      if (running.status !== "GENERATING") return this.progressWithinTransaction(transaction, running.workspaceId, running.id);
      await this.scheduleEligibleSegments(transaction, { source: input.event, productionRun: running, now: input.now });
      return this.progressWithinTransaction(transaction, running.workspaceId, running.id);
    });
  }

  async findProductionSegmentQcInput(input: { event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }> }) {
    const [segment] = await this.db
      .select()
      .from(productionSegments)
      .where(and(
        eq(productionSegments.workspaceId, input.event.workspace_id),
        eq(productionSegments.projectId, input.event.project_id!),
        eq(productionSegments.productionRunId, input.event.data.production_run_id),
        eq(productionSegments.id, input.event.data.production_segment_id),
        eq(productionSegments.taskRunId, input.event.data.task_run_id),
      ))
      .limit(1);
    if (!segment || segment.status !== "CHECKING") return undefined;
    const [taskRun] = await this.db
      .select()
      .from(taskRuns)
      .where(and(
        eq(taskRuns.workspaceId, segment.workspaceId),
        eq(taskRuns.projectId, segment.projectId),
        eq(taskRuns.id, input.event.data.task_run_id),
      ))
      .limit(1);
    if (!taskRun || taskRun.status !== "SUCCEEDED" || !taskRun.resultAssetId) return undefined;
    const audioOwnerFact = readAudioOwnerFact(taskRun.inputSnapshot);
    if (audioOwnerFact.kind === "INVALID") {
      throw new ProductionCompositionInputUnavailableError("production segment audio owner fact is invalid");
    }
    let providerText: string | undefined;
    if (audioOwnerFact.kind === "KNOWN" && audioOwnerFact.owner === "NATIVE_PROVIDER") {
      const [promptPackage] = await this.db
        .select({ capabilitySnapshot: promptPackages.capabilitySnapshot })
        .from(promptPackages)
        .where(and(
          eq(promptPackages.workspaceId, segment.workspaceId),
          eq(promptPackages.projectId, segment.projectId),
          eq(promptPackages.shotSpecId, segment.shotSpecId),
        ))
        .orderBy(desc(promptPackages.createdAt))
        .limit(1);
      providerText = readProviderTextFact(promptPackage?.capabilitySnapshot);
    }
    const [sourceAsset] = await this.db
      .select()
      .from(assets)
      .where(and(
        eq(assets.workspaceId, segment.workspaceId),
        eq(assets.projectId, segment.projectId),
        eq(assets.id, taskRun.resultAssetId),
      ))
      .limit(1);
    if (!sourceAsset
      || sourceAsset.status !== "READY"
      || sourceAsset.kind !== "VIDEO"
      || sourceAsset.mimeType !== "video/mp4"
      || !sourceAsset.sha256
      || !sourceAsset.byteSize
      || sourceAsset.byteSize < 1) return undefined;
    return {
      workspaceId: segment.workspaceId,
      projectId: segment.projectId,
      productionRunId: segment.productionRunId,
      productionSegmentId: segment.id,
      taskRunId: taskRun.id,
      ...(audioOwnerFact.kind === "KNOWN" ? { audioOwner: audioOwnerFact.owner } : {}),
      ...(providerText ? { providerText } : {}),
      sourceAsset: {
        id: sourceAsset.id,
        objectKey: sourceAsset.objectKey,
        sha256: sourceAsset.sha256,
        byteSize: sourceAsset.byteSize,
        mimeType: sourceAsset.mimeType,
      },
    } satisfies ProductionSegmentQcInput;
  }

  async findHandoffReviewInput(input: { event: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }> }) {
    const [run] = await this.db
      .select()
      .from(productionRuns)
      .where(and(
        eq(productionRuns.workspaceId, input.event.workspace_id),
        eq(productionRuns.projectId, input.event.project_id!),
        eq(productionRuns.id, input.event.data.production_run_id),
      ))
      .limit(1);
    if (!run || run.status !== "REVIEWING") return undefined;
    const [fromSegment] = await this.db.select().from(productionSegments).where(and(
      eq(productionSegments.workspaceId, run.workspaceId),
      eq(productionSegments.projectId, run.projectId),
      eq(productionSegments.productionRunId, run.id),
      eq(productionSegments.sequence, input.event.data.from_sequence),
      eq(productionSegments.status, "ACCEPTED"),
    )).limit(1);
    const [toSegment] = await this.db.select().from(productionSegments).where(and(
      eq(productionSegments.workspaceId, run.workspaceId),
      eq(productionSegments.projectId, run.projectId),
      eq(productionSegments.productionRunId, run.id),
      eq(productionSegments.sequence, input.event.data.to_sequence),
      eq(productionSegments.status, "ACCEPTED"),
    )).limit(1);
    if (!fromSegment?.taskRunId || !toSegment?.taskRunId) return undefined;
    const loadSource = async (taskRunId: string) => {
      const [taskRun] = await this.db.select().from(taskRuns).where(and(
        eq(taskRuns.workspaceId, run.workspaceId),
        eq(taskRuns.projectId, run.projectId),
        eq(taskRuns.id, taskRunId),
        eq(taskRuns.status, "SUCCEEDED"),
      )).limit(1);
      if (!taskRun?.resultAssetId) return undefined;
      const [asset] = await this.db.select().from(assets).where(and(
        eq(assets.workspaceId, run.workspaceId),
        eq(assets.projectId, run.projectId),
        eq(assets.id, taskRun.resultAssetId),
        eq(assets.status, "READY"),
        eq(assets.kind, "VIDEO"),
        eq(assets.mimeType, "video/mp4"),
      )).limit(1);
      if (!asset?.sha256 || !asset.byteSize || asset.byteSize < 1 || asset.mimeType !== "video/mp4") return undefined;
      return {
        id: asset.id,
        objectKey: asset.objectKey,
        sha256: asset.sha256,
        byteSize: asset.byteSize,
        mimeType: "video/mp4",
      } satisfies ProductionSegmentQcInput["sourceAsset"];
    };
    const [fromSourceAsset, toSourceAsset] = await Promise.all([loadSource(fromSegment.taskRunId), loadSource(toSegment.taskRunId)]);
    if (!fromSourceAsset || !toSourceAsset) return undefined;
    return {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      productionRunId: run.id,
      handoffReviewId: input.event.data.handoff_review_id,
      fromSequence: input.event.data.from_sequence,
      toSequence: input.event.data.to_sequence,
      fromSourceAsset,
      toSourceAsset,
      continuityHints: { fromTitle: fromSegment.title, toTitle: toSegment.title },
    } satisfies HandoffReviewInput;
  }

  async findProductionCompositionInput(input: { event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }> }) {
    const [run] = await this.db
      .select()
      .from(productionRuns)
      .where(and(
        eq(productionRuns.workspaceId, input.event.workspace_id),
        eq(productionRuns.projectId, input.event.project_id!),
        eq(productionRuns.id, input.event.data.production_run_id),
      ))
      .limit(1);
    // `undefined` is reserved for an event whose run is gone or already left
    // REVIEWING (a stale/duplicate composition request).  A live REVIEWING
    // run must surface an auditable QC failure instead of being acknowledged
    // with no composition input.
    if (!run || run.status !== "REVIEWING") return undefined;
    const unavailable = (reason: string): never => {
      throw new ProductionCompositionInputUnavailableError(reason);
    };
    if (run.acceptedShotCount !== run.totalShotCount) unavailable("accepted visual segments are not complete");
    const [storyboard] = await this.db
      .select({ scriptRevisionId: storyboardRevisions.scriptRevisionId })
      .from(storyboardRevisions)
      .where(and(
        eq(storyboardRevisions.workspaceId, run.workspaceId),
        eq(storyboardRevisions.projectId, run.projectId),
        eq(storyboardRevisions.id, run.storyboardRevisionId),
      ))
      .limit(1);
    const [script] = storyboard
      ? await this.db.select({ creativeBriefRevisionId: scriptRevisions.creativeBriefRevisionId })
        .from(scriptRevisions)
        .where(and(
          eq(scriptRevisions.workspaceId, run.workspaceId),
          eq(scriptRevisions.projectId, run.projectId),
          eq(scriptRevisions.id, storyboard.scriptRevisionId),
        ))
        .limit(1)
      : [];
    const [brief] = script
      ? await this.db.select({ sourceText: creativeBriefRevisions.sourceText, stylePreferences: creativeBriefRevisions.stylePreferences })
        .from(creativeBriefRevisions)
        .where(and(
          eq(creativeBriefRevisions.workspaceId, run.workspaceId),
          eq(creativeBriefRevisions.projectId, run.projectId),
          eq(creativeBriefRevisions.id, script.creativeBriefRevisionId),
        ))
        .limit(1)
      : [];
    const reviews = await this.db
      .select()
      .from(handoffReviews)
      .where(and(
        eq(handoffReviews.workspaceId, run.workspaceId),
        eq(handoffReviews.projectId, run.projectId),
        eq(handoffReviews.productionRunId, run.id),
      ));
    const expectedReviewCount = Math.max(0, run.totalShotCount - 1);
    if (reviews.length !== expectedReviewCount) unavailable("handoff reviews are not complete");
    const repairs = await this.db
      .select()
      .from(transitionRepairs)
      .where(and(
        eq(transitionRepairs.workspaceId, run.workspaceId),
        eq(transitionRepairs.projectId, run.projectId),
        eq(transitionRepairs.productionRunId, run.id),
        eq(transitionRepairs.status, "ACCEPTED"),
      ));
    const segments = await this.db
      .select()
      .from(productionSegments)
      .where(and(
        eq(productionSegments.workspaceId, run.workspaceId),
        eq(productionSegments.projectId, run.projectId),
        eq(productionSegments.productionRunId, run.id),
        eq(productionSegments.status, "ACCEPTED"),
      ))
      .orderBy(asc(productionSegments.sequence));
    if (segments.length !== run.totalShotCount) unavailable("accepted production segments are not ready");
    const assembled: ProductionCompositionInput["segments"] = [];
    const narrationSegments: NonNullable<ProductionCompositionInput["narrationSegments"]> = [];
    const sourceAudioTracks: NonNullable<MediaRuntimeCompositionPlan["audio_tracks"]> = [];
    const audioOwnerFacts: AudioOwnerFact[] = [];
  const approvedNarration = run.deliveryPlanRevisionId
      ? await findApprovedNarrationTimeline(this.db, run.workspaceId, run.projectId, run.deliveryPlanRevisionId)
      : undefined;
    const [deliveryPlan] = run.deliveryPlanRevisionId
      ? await this.db.select({ captionPolicy: deliveryPlanRevisions.captionPolicy }).from(deliveryPlanRevisions).where(and(
        eq(deliveryPlanRevisions.workspaceId, run.workspaceId),
        eq(deliveryPlanRevisions.projectId, run.projectId),
        eq(deliveryPlanRevisions.id, run.deliveryPlanRevisionId),
      )).limit(1)
      : [];
    let narrationCursorMs = 0;
    for (const segment of segments) {
      const taskRunId = segment.taskRunId;
      if (!taskRunId) throw new ProductionCompositionInputUnavailableError("accepted production segment has no task run");
      const [taskRun] = await this.db
        .select()
        .from(taskRuns)
        .where(and(
          eq(taskRuns.workspaceId, run.workspaceId),
          eq(taskRuns.projectId, run.projectId),
          eq(taskRuns.id, taskRunId),
        ))
        .limit(1);
      if (!taskRun || taskRun.status !== "SUCCEEDED" || !taskRun.resultAssetId) throw new ProductionCompositionInputUnavailableError("accepted segment result is not ready");
      const audioOwnerFact = readAudioOwnerFact(taskRun.inputSnapshot);
      if (audioOwnerFact.kind === "INVALID") unavailable("accepted segment audio owner fact is invalid");
      audioOwnerFacts.push(audioOwnerFact);
      const resultAssetId = taskRun.resultAssetId;
      const [sourceAsset] = await this.db
        .select()
        .from(assets)
        .where(and(
          eq(assets.workspaceId, run.workspaceId),
          eq(assets.projectId, run.projectId),
          eq(assets.id, resultAssetId),
        ))
        .limit(1);
      if (!sourceAsset || sourceAsset.status !== "READY" || sourceAsset.kind !== "VIDEO"
        || !hasScopedAssetMetadata(sourceAsset, {
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          kind: "VIDEO",
          requireDuration: true,
        })) {
        throw new ProductionCompositionInputUnavailableError("accepted segment asset metadata is invalid");
      }
      // Drizzle's nullable metadata must be narrowed explicitly before it is
      // copied into the private composition snapshot. The helper above is a
      // runtime guard, but TypeScript cannot infer its predicate across rows.
      const sourceObjectKey = sourceAsset.objectKey;
      const sourceSha256 = sourceAsset.sha256;
      const sourceByteSize = sourceAsset.byteSize;
      const sourceMimeType = sourceAsset.mimeType;
      const sourceDurationMs = sourceAsset.durationMs;
      if (typeof sourceObjectKey !== "string" || typeof sourceSha256 !== "string"
        || typeof sourceByteSize !== "number" || typeof sourceMimeType !== "string"
        || typeof sourceDurationMs !== "number") {
        throw new ProductionCompositionInputUnavailableError("accepted segment asset metadata is incomplete");
      }
      const [promptPackage] = await this.db
        .select({ capabilitySnapshot: promptPackages.capabilitySnapshot })
        .from(promptPackages)
        .where(and(
          eq(promptPackages.workspaceId, run.workspaceId),
          eq(promptPackages.projectId, run.projectId),
          eq(promptPackages.shotSpecId, segment.shotSpecId),
        ))
        .orderBy(desc(promptPackages.createdAt))
        .limit(1);
      const motionPlan = promptPackage?.capabilitySnapshot?.motion_plan;
      const voicePerformance = motionPlan && typeof motionPlan === "object"
        ? (motionPlan as { voice_performance?: unknown }).voice_performance
        : undefined;
      const deliveryCues = voicePerformance && typeof voicePerformance === "object"
        ? (voicePerformance as { delivery_cues?: unknown }).delivery_cues
        : undefined;
      const segmentScript = Array.isArray(deliveryCues)
        ? deliveryCues
          .map((cue) => {
            if (!cue || typeof cue !== "object") return "";
            const value = cue as { provider_text?: unknown; text?: unknown };
            const providerText = typeof value.provider_text === "string" ? value.provider_text : value.text;
            return typeof providerText === "string" ? providerText.trim() : "";
          })
          .filter(Boolean)
          .join("")
        : "";
      if (segmentScript && !approvedNarration && audioOwnerFact.kind === "KNOWN"
        && audioOwnerFact.owner !== "NATIVE_PROVIDER" && audioOwnerFact.owner !== "LEGACY_PRESERVE") {
        narrationSegments.push({ text: narrationTextForSynthesis(segmentScript), startMs: narrationCursorMs });
      } else if (segmentScript && !approvedNarration && audioOwnerFact.kind === "ABSENT") {
        // Historical snapshots retain their existing cue-derived behavior.
        narrationSegments.push({ text: narrationTextForSynthesis(segmentScript), startMs: narrationCursorMs });
      }
      sourceAudioTracks.push({
        track_id: `segment-${assembled.length + 1}`,
        // A segment with an explicit provider delivery cue owns provider
        // dialogue; segments without that fact retain their source audio.
        // This is the existing prompt-package ownership fact, not a guess
        // based on the presence of an audio stream alone.
        // An authoritative platform narration is not evidence about the
        // ownership of every source clip.  Only a segment's persisted
        // delivery_cues classify its provider dialogue; unknown clips remain
        // preserved so ambience/user audio is never silently discarded.
        ownership: audioOwnerFact.kind === "KNOWN" && (audioOwnerFact.owner === "NATIVE_PROVIDER" || audioOwnerFact.owner === "LEGACY_PRESERVE")
          ? "LEGACY_PRESERVE"
          : segmentScript ? "PROVIDER_DIALOGUE" : "LEGACY_PRESERVE",
        start_ms: narrationCursorMs,
        end_ms: narrationCursorMs + sourceDurationMs,
        duck_under_narration: audioOwnerFact.kind === "KNOWN" && (audioOwnerFact.owner === "NATIVE_PROVIDER" || audioOwnerFact.owner === "LEGACY_PRESERVE")
          ? false
          : segmentScript.length > 0,
        ...(typeof sourceAsset.metadata?.audio_gain_db === "string" ? { gain_db: sourceAsset.metadata.audio_gain_db } : {}),
        ...(typeof sourceAsset.metadata?.audio_fade_in_ms === "number" && Number.isInteger(sourceAsset.metadata.audio_fade_in_ms) ? { fade_in_ms: sourceAsset.metadata.audio_fade_in_ms } : {}),
        ...(typeof sourceAsset.metadata?.audio_fade_out_ms === "number" && Number.isInteger(sourceAsset.metadata.audio_fade_out_ms) ? { fade_out_ms: sourceAsset.metadata.audio_fade_out_ms } : {}),
        asset_id: sourceAsset.id,
      });
      assembled.push({
        sequence: segment.sequence,
        taskRunId: taskRun.id,
        sourceAsset: {
          id: sourceAsset.id,
          objectKey: sourceObjectKey,
          sha256: sourceSha256,
          byteSize: sourceByteSize,
          mimeType: sourceMimeType,
          durationMs: sourceDurationMs,
        },
      });
      narrationCursorMs += sourceDurationMs;
    }
    const resolvedAudioOwner = resolveAudioOwnerForComposition(audioOwnerFacts);
    const preserveProviderAudio = resolvedAudioOwner === "NATIVE_PROVIDER" || resolvedAudioOwner === "LEGACY_PRESERVE";
    if (preserveProviderAudio && approvedNarration) {
      unavailable("provider-owned segment audio conflicts with an approved platform narration timeline");
    }
    if (preserveProviderAudio) narrationSegments.length = 0;
    if (approvedNarration) {
      if (approvedNarration.visualSegments.length !== assembled.length || approvedNarration.visualSegments.some((visual, index) => {
        const actual = assembled[index]!;
        const startMs = assembled.slice(0, index).reduce((sum, item) => sum + item.sourceAsset.durationMs, 0);
        const measuredStartDeltaMs = Math.abs(visual.start_ms - startMs);
        const measuredEndDeltaMs = Math.abs(visual.end_ms - (startMs + actual.sourceAsset.durationMs));
        return visual.sequence !== actual.sequence
          // Provider containers commonly carry a small measured-duration
          // drift (for example 15.042s for a requested 15s shot). Reconcile
          // the approved request with measured media within the existing
          // C12.7B tolerance instead of rejecting a valid accepted segment.
          || measuredStartDeltaMs > NARRATION_MEASURED_DURATION_TOLERANCE_MS
          || measuredEndDeltaMs > NARRATION_MEASURED_DURATION_TOLERANCE_MS
          || !measuredVisualSegmentMatchesRequest({
            measuredDurationMs: actual.sourceAsset.durationMs,
            providerDurationSeconds: visual.provider_duration_seconds,
          });
      })) unavailable("approved timeline visual coverage does not match accepted segments");
      const lastVisualEndMs = approvedNarration.visualSegments.reduce((end, segment) => Math.max(end, segment.end_ms), 0);
      const assembledDurationMs = assembled.reduce((total, segment) => total + segment.sourceAsset.durationMs, 0);
      // The current production snapshot has no private HOLD/BROLL asset slot
      // beyond the accepted video segments.  Do not let an approved plan's
      // longer effective duration extend audio over an already-ended video;
      // such a plan must be rebuilt with an accepted visual tail first.
      if (approvedNarration.effectiveDurationMs !== lastVisualEndMs
        || Math.abs(lastVisualEndMs - assembledDurationMs) > NARRATION_MEASURED_DURATION_TOLERANCE_MS) {
        unavailable("approved narration duration extends beyond accepted visual coverage");
      }
      // The local Runtime intentionally does not perform cue-wise Piper
      // synthesis with independent acoustic context.  Without a consumed,
      // approved full narration asset, more than one absolute cue would
      // otherwise look supported while the Runtime rejects/reshapes it. Keep
      // this a preflight failure instead of generating all video segments and
      // discovering the unsupported path during composition.
      if (!approvedNarration.narrationAsset && !(approvedNarration.narrationAssets?.length) && approvedNarration.narrationSegments.length > 1) {
        unavailable("approved narration without a standalone asset requires a single continuous cue or approved timing asset");
      }
    }
    const reviewByBoundary = new Map<number, (typeof reviews)[number]>();
    for (const review of reviews) {
      // The database has the same adjacent/unique constraints, but this
      // snapshot crosses a process boundary and test/legacy rows may not.
      // Never let a missing or misaligned boundary fall through to PASS.
      if (!Number.isSafeInteger(review.fromSequence)
        || !Number.isSafeInteger(review.toSequence)
        || review.toSequence !== review.fromSequence + 1
        || review.fromSequence < 1
        || review.toSequence > run.totalShotCount
        || reviewByBoundary.has(review.toSequence)
        || (review.result !== "PASS"
          && review.result !== "BLEND"
          && review.result !== "BRIDGE_REQUIRED"
          && review.result !== "UNAVAILABLE"
          && review.result !== "FAILED")) {
        unavailable("handoff reviews are not complete");
      }
      reviewByBoundary.set(review.toSequence, review);
    }
    if (reviews.length !== expectedReviewCount || reviewByBoundary.size !== expectedReviewCount) {
      unavailable("handoff reviews are not complete");
    }
    const repairByBoundary = new Map<number, (typeof repairs)[number]>();
    for (const repair of repairs) {
      // Repairs identify the handoff boundary by its to-sequence.  Accepted
      // repairs outside the expected run boundaries, duplicates, or unknown
      // strategies must not be silently ignored by composition planning.
      if (!Number.isSafeInteger(repair.boundarySequence)
        || repair.boundarySequence < 2
        || repair.boundarySequence > run.totalShotCount
        || repairByBoundary.has(repair.boundarySequence)
        || (repair.strategy !== "BLEND" && repair.strategy !== "BRIDGE")) {
        unavailable("transition repairs are not complete");
      }
      repairByBoundary.set(repair.boundarySequence, repair);
    }
    const transitions: Array<"PASS" | "BLEND" | "BRIDGE"> = [];
    for (let index = 0; index < expectedReviewCount; index += 1) {
      const boundary = index + 1;
      const toSequence = boundary + 1;
      const review = reviewByBoundary.get(toSequence);
      if (!review) {
        throw new ProductionCompositionInputUnavailableError("handoff reviews are not complete");
      }
      const repair = repairByBoundary.get(toSequence);
      if (review.result === "PASS") {
        if (repair) unavailable("transition repair does not match handoff review");
        transitions.push("PASS");
      } else if (review.result === "BLEND") {
        if (!repair || repair.strategy !== "BLEND") {
          unavailable("accepted BLEND repair is missing or does not match handoff review");
        }
        transitions.push("BLEND");
      } else if (review.result === "BRIDGE_REQUIRED") {
        if (!repair || repair.strategy !== "BRIDGE") {
          unavailable("accepted BRIDGE repair is missing or does not match handoff review");
        }
        transitions.push("BRIDGE");
      } else if (review.result === "UNAVAILABLE" || review.result === "FAILED") {
        // Continuity evaluation deliberately degrades these source results to
        // a direct cut while preserving NEEDS_ATTENTION on the run.  A repair
        // must not be attached to that decision, but the review itself is not
        // missing and therefore must not block composition input.
        if (repair) unavailable("transition repair does not match handoff review");
        transitions.push("PASS");
      } else {
        unavailable("handoff reviews are not complete");
      }
    }
    const bridgeDurations: number[] = [];
    for (let index = 0; index < transitions.length; index += 1) {
      if (transitions[index] !== "BRIDGE") continue;
      const repair = repairByBoundary.get(index + 2);
      if (!repair || repair.strategy !== "BRIDGE" || repair.durationMs < 1_000 || repair.durationMs > 3_000) {
        throw new ProductionCompositionInputUnavailableError("accepted transition repair is missing or invalid");
      }
      bridgeDurations.push(repair.durationMs);
    }
    const musicPlan = MusicPlanSchema.parse((run.budgetGuard as Record<string, unknown> | undefined)?.music_plan ?? {});
    const musicCandidates = musicPlan.mode === "OFF" ? [] : await this.db.select().from(assets).where(and(
      eq(assets.workspaceId, run.workspaceId),
      eq(assets.kind, "AUDIO"),
      eq(assets.status, "READY"),
      sql`${assets.metadata}->>'audio_role' = 'MUSIC'`,
    )).orderBy(desc(assets.createdAt));
    // Music is shared across projects inside one workspace, so validate the
    // candidate against its own server-owned key scope before selecting it.
    // A row that merely passed the workspace query must not be allowed to
    // direct Worker to another object's key or malformed audio bytes.
    const filteredMusicCandidates = musicCandidates.filter(isUsableMusicAsset);
    // Once an approved C12.7B snapshot exists, its canonical provider text is
    // authoritative; never reintroduce an older brief transcript into the
    // composition input or final-review comparison.
    const scriptText = approvedNarration || preserveProviderAudio
      ? undefined
      : (brief?.sourceText ? deriveTranscriptScript(brief.sourceText) : undefined);
    const hasAuthoritativeNarration = !preserveProviderAudio && Boolean(approvedNarration || scriptText);
    if (approvedNarration) narrationSegments.push(...approvedNarration.narrationSegments);
    // A canonical, explicitly labelled transcript is safe to synthesize as a
    // single bounded cue when an older prompt snapshot has no delivery_cues.
    // This never derives speech from visual description; it only prevents a
    // continuous plan from reaching Worker with an empty narration request.
    if (!approvedNarration && scriptText && narrationSegments.length === 0) {
      narrationSegments.push(...buildCanonicalNarrationCue(brief?.sourceText ?? ""));
    }
    // ALCHMED8 is reserved for a complete source-faithful AudioPlan.  Keep
    // the legacy single full-track mapping, and add the source OpenMontage
    // section-track mapping only when every PRIMARY section names an
    // independently measured formal asset.
    const sectionNarrationAssets = approvedNarration?.narrationAssets ?? [];
    const completeAudioPlanBase = approvedNarration
      && (approvedNarration.narrationAsset || sectionNarrationAssets.length > 0)
      && sourceAudioTracks.every((track) => typeof track.asset_id === "string")
      ? {
        version: 1 as const,
        target_duration_ms: approvedNarration.effectiveDurationMs,
        ...(approvedNarration.narrationAsset ? { narration_asset_id: approvedNarration.narrationAsset.id } : {}),
        narration_sections: approvedNarration.narrationSections.map((section) => ({
          section_id: section.sectionId,
          start_ms: section.startMs,
          end_ms: section.endMs,
          visual_role: section.visualRole,
          ...(section.narrationAssetVersionId ? { narration_asset_version_id: section.narrationAssetVersionId } : {}),
        })),
        stitch_policy: "CONTINUOUS_NARRATION" as const,
        transcript_script: approvedNarration.narrationScriptText,
        ...(approvedNarration.transcriptTimingAssetId ? { transcript_timing_asset_id: approvedNarration.transcriptTimingAssetId } : {}),
        tracks: [
          ...(approvedNarration.narrationAsset ? [{
            track_id: "platform-narration",
            ownership: "PLATFORM_NARRATION" as const,
            asset_id: approvedNarration.narrationAsset.id,
            start_ms: 0,
            end_ms: approvedNarration.effectiveDurationMs,
            // OpenMontage audio_mixer._track_filters uses volume=1.0 when
            // the source edit decision omits volume; encode that source
            // default as the equivalent, explicit 0 dB value.
            gain_db: approvedNarration.narrationAsset.gainDb ?? "0",
            duck_under_narration: false,
            ...(approvedNarration.narrationAsset.fadeInMs !== undefined ? { fade_in_ms: approvedNarration.narrationAsset.fadeInMs } : {}),
            ...(approvedNarration.narrationAsset.fadeOutMs !== undefined ? { fade_out_ms: approvedNarration.narrationAsset.fadeOutMs } : {}),
          }] : sectionNarrationAssets.map((asset) => {
            const section = approvedNarration.narrationSections.find((candidate) => candidate.sectionId === asset.sectionId);
            if (!section || section.visualRole !== "PRIMARY" || section.narrationAssetVersionId !== asset.assetVersionId) {
              throw new ProductionCompositionInputUnavailableError("approved section narration asset does not match its TimelinePlan window");
            }
            return {
              track_id: `narration-${asset.id}`,
              ownership: "PLATFORM_NARRATION" as const,
              asset_id: asset.id,
              start_ms: section.startMs,
              end_ms: section.endMs,
              gain_db: asset.gainDb ?? "0",
              duck_under_narration: false,
              ...(asset.fadeInMs !== undefined ? { fade_in_ms: asset.fadeInMs } : {}),
              ...(asset.fadeOutMs !== undefined ? { fade_out_ms: asset.fadeOutMs } : {}),
            };
          })),
          ...sourceAudioTracks.map((track) => ({
            ...track,
            // The same upstream mapper default is 1.0 (0 dB); this is not a
            // platform-selected loudness value or a guessed mix level.
            gain_db: track.gain_db ?? "0",
          })),
        ].sort((left, right) => left.start_ms - right.start_ms || left.track_id.localeCompare(right.track_id)),
      }
      : undefined;
    const targetDurationMs = approvedNarration?.effectiveDurationMs
      ?? assembled.reduce((total, segment) => total + segment.sourceAsset.durationMs, 0);
    const briefText = `${brief?.sourceText ?? ""} ${brief?.stylePreferences ?? ""} ${musicPlan.style_hint}`.toLowerCase();
    const scoreMusic = (asset: typeof assets.$inferSelect) => {
      const metadata = asset.metadata ?? {};
      const tags = [metadata.mood, metadata.style, metadata.genre, metadata.selection_hint, metadata.bpm, metadata.filename].filter(Boolean).join(" ").toLowerCase();
      const tagMatches = tags.split(/[^\p{L}\p{N}]+/u).filter((tag) => tag.length > 1 && briefText.includes(tag)).length;
      const durationFit = asset.durationMs && asset.durationMs >= targetDurationMs ? 2 : 0;
      return tagMatches * 10 + durationFit;
    };
    const [musicAsset] = musicPlan.mode === "MANUAL"
      ? filteredMusicCandidates.filter((asset) => asset.id === musicPlan.asset_id)
      : filteredMusicCandidates.sort((left, right) => scoreMusic(right) - scoreMusic(left) || right.createdAt.localeCompare(left.createdAt)).slice(0, 1);
    if (musicPlan.mode === "MANUAL" && !musicAsset) {
      unavailable("the explicitly selected music asset is not available or failed scope validation");
    }
    if (musicPlan.mode === "AUTO" && !musicAsset) {
      // AUTO is an authored request for a MUSIC bed.  Do not silently turn a
      // missing/role-less catalog into a silent result; only explicit OFF may
      // omit music.  Candidates remain restricted to server-owned READY AUDIO
      // rows carrying audio_role=MUSIC above, so narration samples and user
      // source audio cannot satisfy this gate.
      unavailable("AUTO music selection requires a READY AUDIO asset with audio_role=MUSIC");
    }
    // A selected MUSIC asset must be represented by the same AudioPlan fact
    // that the Runtime consumes; a free-floating music_mix flag is not an
    // asset identity. OpenMontage's track filter defaults an omitted volume
    // to 1.0 (0 dB), so the mapper supplies that source-faithful default when
    // an uploaded MUSIC asset has no authored gain metadata.
    const completeAudioPlan = completeAudioPlanBase
      ? musicAsset
        ? (() => {
          const gainDb = resolveAudioTrackGainDb(musicAsset.metadata);
          return {
            ...completeAudioPlanBase,
            tracks: [...completeAudioPlanBase.tracks, {
              track_id: "music",
              ownership: "MUSIC" as const,
              asset_id: musicAsset.id,
              start_ms: 0,
              end_ms: targetDurationMs,
              gain_db: gainDb,
              duck_under_narration: true,
            }],
          };
        })()
        : completeAudioPlanBase
      : undefined;
    if (approvedNarration && !completeAudioPlan) {
      unavailable("approved narration requires a complete consumable AudioPlan (approved asset and mix facts)");
    }
    const compositionPlan = MediaRuntimeCompositionPlanSchema.parse({
      target_duration_ms: targetDurationMs,
      transitions,
      bridge_durations_ms: bridgeDurations,
      // OpenMontage treats a complete source script as one authoritative
      // narration track even when the visual plan has a single segment.
      audio_policy: hasAuthoritativeNarration ? "CONTINUOUS_NARRATION" : "LEGACY_PRESERVE",
      ...(completeAudioPlan ? {
        audio_plan: completeAudioPlan,
      } : hasAuthoritativeNarration ? {
        audio_tracks: [
          { track_id: "platform-narration", ownership: "PLATFORM_NARRATION", start_ms: 0, end_ms: targetDurationMs, duck_under_narration: false },
          ...sourceAudioTracks,
        ],
      } : {}),
      music_mix: {
        enabled: Boolean(musicAsset?.sha256 && musicAsset.byteSize && musicAsset.mimeType),
        volume: 0.08,
        fade_in_ms: 1_500,
        fade_out_ms: 2_500,
        ducking_enabled: true,
        ducking_reduction_db: 18,
        target_lufs: -14,
        true_peak_db: -1.5,
        voice_enhance: true,
        music_eq_cut_db: 3,
      },
      music_segments_ms: musicAsset ? [{ start_ms: 0, end_ms: targetDurationMs }] : [],
    });
    return {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      productionRunId: run.id,
      storyboardRevisionId: run.storyboardRevisionId,
      ...(deliveryPlan?.captionPolicy ? { captionPolicy: deliveryPlan.captionPolicy } : {}),
      ...(scriptText ? { scriptText } : {}),
      ...(approvedNarration ? { narrationScriptText: approvedNarration.narrationScriptText } : {}),
      ...(approvedNarration ? { narrationAsset: approvedNarration.narrationAsset } : {}),
      ...(approvedNarration?.narrationAssets?.length ? { narrationAssets: approvedNarration.narrationAssets } : {}),
      ...(narrationSegments.length > 0 ? { narrationSegments } : {}),
      compositionPlan,
      ...(musicAsset?.sha256 && musicAsset.byteSize && musicAsset.mimeType ? {
        musicAsset: {
          id: musicAsset.id,
          workspaceId: musicAsset.workspaceId,
          projectId: musicAsset.projectId,
          objectKey: musicAsset.objectKey,
          sha256: musicAsset.sha256,
          byteSize: musicAsset.byteSize,
          mimeType: musicAsset.mimeType,
          ...(musicAsset.durationMs !== null && musicAsset.durationMs !== undefined ? { durationMs: musicAsset.durationMs } : {}),
        },
        musicMetadata: {
          ...(typeof musicAsset.metadata?.source_title === "string" ? { title: musicAsset.metadata.source_title } : typeof musicAsset.metadata?.filename === "string" ? { title: musicAsset.metadata.filename } : {}),
          ...(typeof musicAsset.metadata?.source_artist === "string" ? { artist: musicAsset.metadata.source_artist } : {}),
          ...(Array.isArray(musicAsset.metadata?.tags) ? { tags: musicAsset.metadata.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12) } : {}),
        },
      } : {}),
      segments: assembled,
    } satisfies ProductionCompositionInput;
  }

  async recordNarrationDurationFeedback(input: NarrationDurationFeedbackInput) {
    const feedback = MediaRuntimeNarrationDurationFeedbackSchema.parse(input.feedback);
    const id = narrationDurationFeedbackLogId(input.eventId);
    const [inserted] = await this.db
      .insert(creativeDecisionLogs)
      .values({
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        decisionType: "NARRATION_DURATION_FEEDBACK",
        sourceRevisionType: "PRODUCTION_RUN",
        sourceRevisionId: input.productionRunId,
        safeSummary: feedback.decision === "SEND_BACK"
          ? "旁白实测时长超出来源规则，需要退回文案或重新生成。"
          : feedback.decision === "ADJUST_SCENE_PLAN"
            ? "旁白实测时长在来源调整范围内，需要调整场景计划。"
            : feedback.decision === "SOURCE_DECISION_REQUIRED"
              ? "旁白实测时长同时落入来源的退回与场景调整选项，需上层明确决策。"
            : "旁白实测时长已记录。",
        metadata: feedback,
        createdAt: timestamp(input.now),
      })
      .onConflictDoNothing()
      .returning({ id: creativeDecisionLogs.id });
    if (inserted) return;

    // A retry for the same composition event must replay the same immutable
    // source measurement, not silently replace it with a new decision.
    const [existing] = await this.db
      .select({ workspaceId: creativeDecisionLogs.workspaceId, projectId: creativeDecisionLogs.projectId, sourceRevisionId: creativeDecisionLogs.sourceRevisionId, metadata: creativeDecisionLogs.metadata })
      .from(creativeDecisionLogs)
      .where(eq(creativeDecisionLogs.id, id))
      .limit(1);
    if (!existing
      || existing.workspaceId !== input.workspaceId
      || existing.projectId !== input.projectId
      || existing.sourceRevisionId !== input.productionRunId
      || !isDeepStrictEqual(existing.metadata, feedback)) {
      throw new Error("Narration duration feedback idempotency conflict.");
    }
  }

  async completeHandoffReview(input: {
    event: Extract<InternalEventEnvelope, { event_type: "handoff_review.requested" }>;
    evaluation: {
      result: HandoffReviewResult;
      reasonCodes: HandoffReviewReasonCode[];
      safeSummary: string;
      evaluatorVersion: string;
      retryable: boolean;
    };
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction.select().from(productionRuns).where(and(
        eq(productionRuns.workspaceId, input.event.workspace_id),
        eq(productionRuns.projectId, input.event.project_id!),
        eq(productionRuns.id, input.event.data.production_run_id),
      )).limit(1);
      if (!run || run.status !== "REVIEWING") return undefined;
      const [existing] = await transaction.select().from(handoffReviews).where(and(
        eq(handoffReviews.workspaceId, run.workspaceId),
        eq(handoffReviews.productionRunId, run.id),
        eq(handoffReviews.fromSequence, input.event.data.from_sequence),
        eq(handoffReviews.toSequence, input.event.data.to_sequence),
      )).limit(1);
      if (existing) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      const reviewsBefore = await transaction.select().from(handoffReviews).where(and(
        eq(handoffReviews.workspaceId, run.workspaceId),
        eq(handoffReviews.productionRunId, run.id),
      ));
      const decision = decideContinuityRepair({
        evaluation: input.evaluation,
        repairCount: run.autoRepairCount,
        maxRepairCount: run.maxAutoRepairCount,
      });
      await transaction.insert(handoffReviews).values({
        id: input.event.data.handoff_review_id,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        productionRunId: run.id,
        fromSequence: input.event.data.from_sequence,
        toSequence: input.event.data.to_sequence,
        result: input.evaluation.result,
        reasonCodes: input.evaluation.reasonCodes,
        safeSummary: input.evaluation.safeSummary.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240) || "衔接检查已完成。",
        evaluatorVersion: input.evaluation.evaluatorVersion.slice(0, 128),
        retryable: input.evaluation.retryable,
        createdAt: timestamp(input.now),
      });
      let currentRun = run;
      if (decision.shouldCreateRepair && decision.strategy !== "PASS") {
        const repairId = createPrefixedId("trp");
        const [repair] = await transaction.insert(transitionRepairs).values({
          id: repairId,
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          productionRunId: run.id,
          boundarySequence: input.event.data.to_sequence,
          strategy: decision.strategy,
          status: "ACCEPTED",
          taskRunId: null,
          assetId: null,
          durationMs: decision.durationMs,
          attemptCount: 1,
          createdAt: timestamp(input.now),
          updatedAt: timestamp(input.now),
        }).onConflictDoNothing().returning();
        if (repair) {
          await insertOutboxEvent(transaction, transitionRepairEvent(input.event, {
            eventType: "transition_repair.requested",
            now: input.now,
            transitionRepairId: repair.id,
            productionRunId: run.id,
            boundarySequence: repair.boundarySequence,
            strategy: repair.strategy,
          }));
          await insertOutboxEvent(transaction, transitionRepairEvent(input.event, {
            eventType: "transition_repair.succeeded",
            now: input.now,
            transitionRepairId: repair.id,
            productionRunId: run.id,
            boundarySequence: repair.boundarySequence,
            strategy: repair.strategy,
          }));
        }
      }
      const repairIncrement = decision.strategy === "BRIDGE" && decision.shouldCreateRepair ? 1 : 0;
      if (repairIncrement > 0) {
        const [updated] = await transaction.update(productionRuns)
          .set({
            continuityStatus: decision.continuityStatus,
            autoRepairCount: Math.min(run.maxAutoRepairCount, run.autoRepairCount + repairIncrement),
            updatedAt: timestamp(input.now),
          })
          .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id)))
          .returning();
        if (updated) currentRun = updated;
      } else {
        const [updated] = await transaction.update(productionRuns)
          .set({ continuityStatus: decision.continuityStatus, updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id)))
          .returning();
        if (updated) currentRun = updated;
      }
      const completedReviews = reviewsBefore.length + 1;
      const expectedReviews = Math.max(0, run.totalShotCount - 1);
      const allReviewed = completedReviews >= expectedReviews;
      if (allReviewed && expectedReviews > 0) {
        const allReviews = [...reviewsBefore, {
          result: input.evaluation.result,
        } as typeof reviewsBefore[number]];
        const needsAttention = allReviews.some((review) => review.result === "UNAVAILABLE" || review.result === "FAILED");
        const [finalRun] = await transaction.update(productionRuns)
          .set({ continuityStatus: needsAttention ? "NEEDS_ATTENTION" : "GOOD", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id)))
          .returning();
        if (finalRun) currentRun = finalRun;
        await insertOutboxEvent(transaction, compositionRequestedEvent(input.event, {
          now: input.now,
          productionRunId: run.id,
        }));
      }
      await insertOutboxEvent(transaction, handoffReviewCompletedEvent(input.event, {
        now: input.now,
        result: input.evaluation.result,
        reasonCodes: input.evaluation.reasonCodes,
        retryable: input.evaluation.retryable,
      }));
      await insertOutboxEvent(transaction, progressEvent(input.event, {
        now: input.now,
        productionRun: currentRun,
        currentSequence: input.event.data.to_sequence,
        producer: "media-worker",
      }));
      return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
    });
  }

  async acceptProductionSegmentQc(input: {
    event: Extract<InternalEventEnvelope, { event_type: "production_segment.qc_requested" }>;
    handoffAsset: { id: string; objectKey: string; sha256: string; byteSize: number; width: number; height: number };
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [segment] = await transaction
        .select()
        .from(productionSegments)
        .where(and(
          eq(productionSegments.workspaceId, input.event.workspace_id),
          eq(productionSegments.projectId, input.event.project_id!),
          eq(productionSegments.productionRunId, input.event.data.production_run_id),
          eq(productionSegments.id, input.event.data.production_segment_id),
          eq(productionSegments.taskRunId, input.event.data.task_run_id),
        ))
        .limit(1);
      if (!segment || segment.status !== "CHECKING") return this.progressWithinTransaction(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, segment.workspaceId), eq(productionRuns.id, segment.productionRunId)))
        .limit(1);
      if (!run) return undefined;
      const [taskRun] = await transaction
        .select()
        .from(taskRuns)
        .where(and(eq(taskRuns.workspaceId, segment.workspaceId), eq(taskRuns.projectId, segment.projectId), eq(taskRuns.id, input.event.data.task_run_id)))
        .limit(1);
      if (!taskRun || taskRun.status !== "SUCCEEDED" || !taskRun.resultAssetId) return undefined;
      const [sourceAsset] = await transaction
        .select()
        .from(assets)
        .where(and(eq(assets.workspaceId, segment.workspaceId), eq(assets.projectId, segment.projectId), eq(assets.id, taskRun.resultAssetId)))
        .limit(1);
      if (!sourceAsset || sourceAsset.status !== "READY" || sourceAsset.kind !== "VIDEO") return undefined;

      const qcReportId = createPrefixedId("qcr");
      const assetDerivationId = createPrefixedId("drv");
      await transaction.insert(qcReports).values({
        id: qcReportId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        subjectType: "PRODUCTION_SEGMENT",
        subjectId: segment.id,
        kind: "TECHNICAL",
        status: "PASS",
        safeSummary: "本段画面检查通过。",
        createdAt: timestamp(input.now),
      });
      await transaction.insert(assets).values({
        id: input.handoffAsset.id,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        kind: "IMAGE",
        origin: "DERIVED",
        status: "READY",
        objectKey: input.handoffAsset.objectKey,
        sha256: input.handoffAsset.sha256,
        mimeType: "image/png",
        byteSize: input.handoffAsset.byteSize,
        width: input.handoffAsset.width,
        height: input.handoffAsset.height,
        durationMs: null,
        metadata: { purpose: "handoff_frame" },
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      });
      await transaction.insert(assetDerivations).values({
        id: assetDerivationId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        derivationType: "HANDOFF_FRAME",
        sourceAssetId: sourceAsset.id,
        sourceTaskRunId: taskRun.id,
        derivedAssetId: input.handoffAsset.id,
        qcReportId,
        createdAt: timestamp(input.now),
      });
      assertProductionSegmentTransition(segment.status, "ACCEPTED");
      const [acceptedSegment] = await transaction
        .update(productionSegments)
        .set({
          status: "ACCEPTED",
          retryable: false,
          safeSummary: "本段已检查完成。",
          handoffAssetId: input.handoffAsset.id,
          qcReportId,
          updatedAt: timestamp(input.now),
        })
        .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "CHECKING")))
        .returning();
      if (!acceptedSegment) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
      assertProductionAcceptanceCount({ acceptedShotCount: run.acceptedShotCount + 1, totalShotCount: run.totalShotCount });
      const [acceptedRun] = await transaction
        .update(productionRuns)
        .set({ acceptedShotCount: run.acceptedShotCount + 1, updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.acceptedShotCount, run.acceptedShotCount)))
        .returning();
      if (!acceptedRun) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
      let currentRun = acceptedRun;
      const allAccepted = acceptedRun.acceptedShotCount === acceptedRun.totalShotCount;
      if (allAccepted && (acceptedRun.status === "GENERATING" || acceptedRun.status === "BLOCKED")) {
        assertProductionRunTransition(acceptedRun.status, "REVIEWING");
        const [reviewing] = await transaction
          .update(productionRuns)
          .set({ status: "REVIEWING", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, acceptedRun.workspaceId), eq(productionRuns.id, acceptedRun.id), eq(productionRuns.status, acceptedRun.status)))
          .returning();
        if (!reviewing) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
        currentRun = reviewing;
      }
      await insertOutboxEvent(transaction, qcCompletedEvent(input.event, { now: input.now, qcReportId, subjectType: "PRODUCTION_SEGMENT", subjectId: acceptedSegment.id }));
      await insertOutboxEvent(transaction, handoffAcceptedEvent(input.event, {
        now: input.now,
        productionRunId: acceptedSegment.productionRunId,
        sequence: acceptedSegment.sequence,
        handoffAssetId: input.handoffAsset.id,
        assetDerivationId,
        qcReportId,
      }));
      if (allAccepted && currentRun.status === "REVIEWING") {
        const acceptedSegments = await transaction
          .select({ sequence: productionSegments.sequence })
          .from(productionSegments)
          .where(and(
            eq(productionSegments.workspaceId, currentRun.workspaceId),
            eq(productionSegments.projectId, currentRun.projectId),
            eq(productionSegments.productionRunId, currentRun.id),
            eq(productionSegments.status, "ACCEPTED"),
          ))
          .orderBy(asc(productionSegments.sequence));
        if (acceptedSegments.length <= 1) {
          await insertOutboxEvent(transaction, compositionRequestedEvent(input.event, { now: input.now, productionRunId: currentRun.id }));
        } else {
          const [checkingRun] = await transaction.update(productionRuns)
            .set({ continuityStatus: "CHECKING", updatedAt: timestamp(input.now) })
            .where(and(eq(productionRuns.workspaceId, currentRun.workspaceId), eq(productionRuns.id, currentRun.id)))
            .returning();
          if (checkingRun) currentRun = checkingRun;
          for (let index = 0; index < acceptedSegments.length - 1; index += 1) {
            const fromSequence = acceptedSegments[index]!.sequence;
            const toSequence = acceptedSegments[index + 1]!.sequence;
            const reviewId = createPrefixedId("hrv");
            await insertOutboxEvent(transaction, handoffReviewRequestedEvent(input.event, {
              now: input.now,
              productionRunId: currentRun.id,
              handoffReviewId: reviewId,
              fromSequence,
              toSequence,
            }));
          }
        }
      }
      await insertOutboxEvent(transaction, progressEvent(input.event, { now: input.now, productionRun: currentRun, currentSequence: acceptedSegment.sequence }));
      return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
    });
  }

  async completeProductionComposition(input: {
    event: Extract<InternalEventEnvelope, { event_type: "video_version.composition_requested" }>;
    videoAsset: { id: string; objectKey: string; sha256: string; byteSize: number; durationMs: number };
    finalReview?: { status: "PASS" | "NEEDS_ATTENTION" | "FAILED"; issues_found: string[]; recommended_action: "PRESENT_WITH_REVIEW" | "REVISE" | "BLOCK" };
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      await lockProductionRun(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.event.workspace_id),
          eq(productionRuns.projectId, input.event.project_id!),
          eq(productionRuns.id, input.event.data.production_run_id),
        ))
        .limit(1);
      if (!run || run.status !== "REVIEWING" || run.acceptedShotCount !== run.totalShotCount) return this.progressWithinTransaction(transaction, input.event.workspace_id, input.event.data.production_run_id);
      const segments = await transaction
        .select({ id: productionSegments.id })
        .from(productionSegments)
        .where(and(eq(productionSegments.workspaceId, run.workspaceId), eq(productionSegments.productionRunId, run.id), eq(productionSegments.status, "ACCEPTED")));
      if (segments.length !== run.totalShotCount) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      assertProductionRunTransition(run.status, "RENDERING");
      const [rendering] = await transaction
        .update(productionRuns)
        .set({ status: "RENDERING", updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "REVIEWING")))
        .returning();
      if (!rendering) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      const qcReportId = createPrefixedId("qcr");
      const videoVersionId = createPrefixedId("vvr");
      await transaction.insert(qcReports).values({
        id: qcReportId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        subjectType: "VIDEO_VERSION",
        subjectId: videoVersionId,
        kind: "COMPOSITION",
        status: input.finalReview?.status === "NEEDS_ATTENTION" ? "NEEDS_ATTENTION" : "PASS",
        safeSummary: input.finalReview?.status === "NEEDS_ATTENTION" ? "成片已完成，但仍有质量项需要人工复核。" : "成片检查通过。",
        details: { ...(input.finalReview ?? { status: "PASS", issues_found: [], recommended_action: "PRESENT_WITH_REVIEW" }), },
        createdAt: timestamp(input.now),
      });
      await transaction.insert(assets).values({
        id: input.videoAsset.id,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        kind: "VIDEO",
        origin: "DERIVED",
        status: "READY",
        objectKey: input.videoAsset.objectKey,
        sha256: input.videoAsset.sha256,
        mimeType: "video/mp4",
        byteSize: input.videoAsset.byteSize,
        durationMs: input.videoAsset.durationMs,
        metadata: { purpose: "composed_video" },
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      });
      await transaction.insert(videoVersions).values({
        id: videoVersionId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        productionRunId: run.id,
        storyboardRevisionId: run.storyboardRevisionId,
        status: "SUCCEEDED",
        assetId: input.videoAsset.id,
        durationMs: input.videoAsset.durationMs,
        qcReportId,
        createdAt: timestamp(input.now),
      });
      assertProductionRunTransition(rendering.status, "SUCCEEDED");
      const [succeeded] = await transaction
        .update(productionRuns)
        .set({ status: "SUCCEEDED", updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, rendering.workspaceId), eq(productionRuns.id, rendering.id), eq(productionRuns.status, "RENDERING")))
        .returning();
      if (!succeeded) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      await insertOutboxEvent(transaction, qcCompletedEvent(input.event, { now: input.now, qcReportId, subjectType: "VIDEO_VERSION", subjectId: videoVersionId }));
      await insertOutboxEvent(transaction, videoVersionSucceededEvent(input.event, {
        now: input.now,
        videoVersionId,
        productionRunId: succeeded.id,
        assetId: input.videoAsset.id,
        durationMs: input.videoAsset.durationMs,
        qcReportId,
      }));
      await insertOutboxEvent(transaction, progressEvent(input.event, { now: input.now, productionRun: succeeded, currentSequence: null }));
      return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
    });
  }

  async failMediaRuntimeEvent(input: {
    eventId: string;
    workspaceId: string;
    errorCode: MediaRuntimeFailureCode;
    retryable: boolean;
    now: Date;
  }) {
    return this.db.transaction(async (transaction) => {
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId)))
        .limit(1);
      const parsed = outbox ? InternalEventEnvelopeSchema.safeParse(outbox.payload) : undefined;
      if (!parsed?.success || !isMediaRuntimeTriggerEvent(parsed.data) || parsed.data.workspace_id !== input.workspaceId) return undefined;
      const event = parsed.data;
      const projectId = event.project_id;
      if (!projectId) return undefined;
      if (event.event_type === "narration_audio.generation_requested") return undefined;
      await lockProductionRun(transaction, event.workspace_id, event.data.production_run_id);
      if (event.event_type === "production_segment.qc_requested") {
        const [segment] = await transaction
          .select()
          .from(productionSegments)
          .where(and(
            eq(productionSegments.workspaceId, event.workspace_id),
            eq(productionSegments.projectId, projectId),
            eq(productionSegments.productionRunId, event.data.production_run_id),
            eq(productionSegments.id, event.data.production_segment_id),
            eq(productionSegments.taskRunId, event.data.task_run_id),
          ))
          .limit(1);
        if (!segment || segment.status !== "CHECKING") return this.progressWithinTransaction(transaction, event.workspace_id, event.data.production_run_id);
        const [run] = await transaction
          .select()
          .from(productionRuns)
          .where(and(eq(productionRuns.workspaceId, segment.workspaceId), eq(productionRuns.id, segment.productionRunId)))
          .limit(1);
        if (!run) return undefined;
        const qcReportId = createPrefixedId("qcr");
        await transaction.insert(qcReports).values({
          id: qcReportId,
          workspaceId: segment.workspaceId,
          projectId: segment.projectId,
          subjectType: "PRODUCTION_SEGMENT",
          subjectId: segment.id,
          kind: "TECHNICAL",
          status: "FAILED",
          safeSummary: "本段画面检查未通过。",
          createdAt: timestamp(input.now),
        });
        assertProductionSegmentTransition(segment.status, "FAILED");
        const [failedSegment] = await transaction
          .update(productionSegments)
          .set({ status: "FAILED", retryable: input.retryable, safeSummary: "本段检查未完成，可调整后重试。", qcReportId, updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "CHECKING")))
          .returning();
        if (!failedSegment) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
        let currentRun = run;
        if (run.status === "GENERATING") {
          assertProductionRunTransition(run.status, "BLOCKED");
          const [blocked] = await transaction
            .update(productionRuns)
            .set({ status: "BLOCKED", updatedAt: timestamp(input.now) })
            .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "GENERATING")))
            .returning();
          if (!blocked) return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
          currentRun = blocked;
          await insertOutboxEvent(transaction, blockedEvent(event, {
            now: input.now,
            productionRun: blocked,
            sequence: failedSegment.sequence,
            reasonCode: "SEGMENT_NEEDS_ATTENTION",
            retryable: input.retryable,
            producer: "media-worker",
          }));
        }
        await insertOutboxEvent(transaction, qcCompletedEvent(event, {
          now: input.now,
          qcReportId,
          subjectType: "PRODUCTION_SEGMENT",
          subjectId: failedSegment.id,
          status: "FAILED",
        }));
        await insertOutboxEvent(transaction, progressEvent(event, {
          now: input.now,
          productionRun: currentRun,
          currentSequence: failedSegment.sequence,
          producer: "media-worker",
        }));
        return this.progressWithinTransaction(transaction, segment.workspaceId, segment.productionRunId);
      }

      if (event.event_type === "handoff_review.requested") {
        const [run] = await transaction.select().from(productionRuns).where(and(
          eq(productionRuns.workspaceId, event.workspace_id),
          eq(productionRuns.projectId, projectId),
          eq(productionRuns.id, event.data.production_run_id),
        )).limit(1);
        if (!run || run.status !== "REVIEWING") return this.progressWithinTransaction(transaction, event.workspace_id, event.data.production_run_id);
        const [existing] = await transaction.select().from(handoffReviews).where(and(
          eq(handoffReviews.workspaceId, run.workspaceId),
          eq(handoffReviews.productionRunId, run.id),
          eq(handoffReviews.fromSequence, event.data.from_sequence),
          eq(handoffReviews.toSequence, event.data.to_sequence),
        )).limit(1);
        if (!existing) {
          await transaction.insert(handoffReviews).values({
            id: event.data.handoff_review_id,
            workspaceId: run.workspaceId,
            projectId: run.projectId,
            productionRunId: run.id,
            fromSequence: event.data.from_sequence,
            toSequence: event.data.to_sequence,
            result: "FAILED",
            reasonCodes: ["EVALUATOR_FAILED"],
            safeSummary: "衔接检查未完成，已使用安全转场。",
            evaluatorVersion: "runtime-failure",
            retryable: input.retryable,
            createdAt: timestamp(input.now),
          });
        }
        await transaction.update(productionRuns).set({ continuityStatus: "NEEDS_ATTENTION", updatedAt: timestamp(input.now) })
          .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id)));
        const reviews = await transaction.select({ id: handoffReviews.id }).from(handoffReviews).where(and(
          eq(handoffReviews.workspaceId, run.workspaceId),
          eq(handoffReviews.productionRunId, run.id),
        ));
        if (reviews.length >= Math.max(0, run.totalShotCount - 1)) {
          await insertOutboxEvent(transaction, compositionRequestedEvent(event, { now: input.now, productionRunId: run.id }));
        }
        return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      }

      if (event.event_type !== "video_version.composition_requested") return undefined;
      const [run] = await transaction
        .select()
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, event.workspace_id),
          eq(productionRuns.projectId, projectId),
          eq(productionRuns.id, event.data.production_run_id),
        ))
        .limit(1);
      if (!run || run.status !== "REVIEWING") return this.progressWithinTransaction(transaction, event.workspace_id, event.data.production_run_id);
      const videoVersionId = createPrefixedId("vvr");
      const qcReportId = createPrefixedId("qcr");
      await transaction.insert(qcReports).values({
        id: qcReportId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        subjectType: "VIDEO_VERSION",
        subjectId: videoVersionId,
        kind: "COMPOSITION",
        status: "FAILED",
        safeSummary: "成片合成未完成。",
        createdAt: timestamp(input.now),
      });
      await transaction.insert(videoVersions).values({
        id: videoVersionId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        productionRunId: run.id,
        storyboardRevisionId: run.storyboardRevisionId,
        status: "FAILED",
        assetId: null,
        durationMs: null,
        qcReportId: null,
        createdAt: timestamp(input.now),
      });
      assertProductionRunTransition(run.status, "FAILED");
      const [failedRun] = await transaction
        .update(productionRuns)
        .set({ status: "FAILED", updatedAt: timestamp(input.now) })
        .where(and(eq(productionRuns.workspaceId, run.workspaceId), eq(productionRuns.id, run.id), eq(productionRuns.status, "REVIEWING")))
        .returning();
      if (!failedRun) return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
      await insertOutboxEvent(transaction, qcCompletedEvent(event, {
        now: input.now,
        qcReportId,
        subjectType: "VIDEO_VERSION",
        subjectId: videoVersionId,
        status: "FAILED",
      }));
      await insertOutboxEvent(transaction, videoVersionFailedEvent(event, {
        now: input.now,
        productionRunId: failedRun.id,
        errorCode: input.errorCode,
        retryable: input.retryable,
      }));
      await insertOutboxEvent(transaction, progressEvent(event, {
        now: input.now,
        productionRun: failedRun,
        currentSequence: null,
        producer: "media-worker",
      }));
      return this.progressWithinTransaction(transaction, run.workspaceId, run.id);
    });
  }

  async claimProductionEvent(input: { message: InternalProductionQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<ProductionEventClaim> {
    return this.db.transaction(async (transaction) => {
      const message = InternalProductionQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id)))
        .limit(1);
      if (!outbox) return { kind: "RETRY" };
      const event = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!event.success || !isProductionTriggerEvent(event.data) || !messageMatchesEvent(message, event.data)) return { kind: "RETRY" };

      const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      const [inserted] = await transaction
        .insert(eventConsumptions)
        .values({ workspaceId: message.workspace_id, eventId: message.event_id, consumerName: input.consumerName, leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: 1 })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await transaction
          .select()
          .from(eventConsumptions)
          .where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName)))
          .limit(1);
        if (!existing || existing.completedAt || existing.deadLetteredAt) return { kind: "DUPLICATE" };
        const [reclaimed] = await transaction
          .update(eventConsumptions)
          .set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: timestamp(input.now) })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            isNull(eventConsumptions.completedAt),
            isNull(eventConsumptions.deadLetteredAt),
            or(isNull(eventConsumptions.leaseExpiresAt), lte(eventConsumptions.leaseExpiresAt, timestamp(input.now))),
          ))
          .returning();
        if (!reclaimed) return { kind: "BUSY" };
      }
      return { kind: "CLAIMED", event: event.data };
    });
  }

  async claimMediaRuntimeEvent(input: { message: InternalMediaRuntimeQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<MediaRuntimeEventClaim> {
    return this.db.transaction(async (transaction) => {
      const message = InternalMediaRuntimeQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id)))
        .limit(1);
      if (!outbox) return { kind: "RETRY" };
      const event = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!event.success || !isMediaRuntimeTriggerEvent(event.data) || !mediaMessageMatchesEvent(message, event.data)) return { kind: "RETRY" };

      const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      const [inserted] = await transaction
        .insert(eventConsumptions)
        .values({ workspaceId: message.workspace_id, eventId: message.event_id, consumerName: input.consumerName, leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: 1 })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await transaction
          .select()
          .from(eventConsumptions)
          .where(and(eq(eventConsumptions.workspaceId, message.workspace_id), eq(eventConsumptions.eventId, message.event_id), eq(eventConsumptions.consumerName, input.consumerName)))
          .limit(1);
        if (!existing || existing.completedAt || existing.deadLetteredAt) return { kind: "DUPLICATE" };
        const [reclaimed] = await transaction
          .update(eventConsumptions)
          .set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: timestamp(input.now) })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            isNull(eventConsumptions.completedAt),
            isNull(eventConsumptions.deadLetteredAt),
            or(isNull(eventConsumptions.leaseExpiresAt), lte(eventConsumptions.leaseExpiresAt, timestamp(input.now))),
          ))
          .returning();
        if (!reclaimed) return { kind: "BUSY" };
      }
      return { kind: "CLAIMED", event: event.data };
    });
  }

  async completeMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }) {
    await this.completeProductionEvent(input);
  }

  async releaseMediaRuntimeEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    await this.releaseProductionEvent(input);
  }

  async completeProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }) {
    await this.db
      .update(eventConsumptions)
      .set({ completedAt: timestamp(input.now), leaseOwner: null, leaseExpiresAt: null, updatedAt: timestamp(input.now) })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
  }

  async releaseProductionEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    await this.db
      .update(eventConsumptions)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: safeReason(input.reason),
        ...(input.deadLetter ? { deadLetteredAt: timestamp(input.now) } : {}),
        updatedAt: timestamp(input.now),
      })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
  }

  async claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string; eventTypes?: readonly InternalEventEnvelope["event_type"][] }) {
    const now = timestamp(input.now);
    const expiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const workspaceCondition = input.workspaceId ? sql`and workspace_id = ${input.workspaceId}` : sql``;
    const eventTypeCondition = input.eventTypes?.length
      ? sql`and event_type in (${sql.join(input.eventTypes.map((eventType) => sql`${eventType}`), sql`, `)})`
      : sql``;
    const result = await this.db.execute(sql`
      with candidates as (
        select id
        from outbox_events
        where published_at is null
          and dead_lettered_at is null
          and available_at <= ${now}::timestamptz
          and (lease_expires_at is null or lease_expires_at <= ${now}::timestamptz)
          ${workspaceCondition}
          ${eventTypeCondition}
        order by available_at asc, id asc
        for update skip locked
        limit ${input.limit}
      )
      update outbox_events as event
      set lease_owner = ${input.relayId},
          lease_expires_at = ${expiresAt}::timestamptz,
          publish_attempts = event.publish_attempts + 1
      from candidates
      where event.id = candidates.id
      returning event.id, event.workspace_id, event.payload, event.publish_attempts
    `);
    const rows = (result as unknown as { rows: Array<{ id: string; workspace_id: string; payload: Record<string, unknown>; publish_attempts: number }> }).rows;
    return rows.flatMap((row) => {
      const event = InternalEventEnvelopeSchema.safeParse(row.payload);
      return event.success ? [{ id: row.id, workspaceId: row.workspace_id, event: event.data, publishAttempts: row.publish_attempts }] : [];
    });
  }

  async markOutboxPublished(input: { eventId: string; workspaceId: string; relayId: string; now: Date }) {
    await this.db.update(outboxEvents).set({ publishedAt: timestamp(input.now), leaseOwner: null, leaseExpiresAt: null, lastError: null })
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  async releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }) {
    const [current] = await this.db.select({ publishAttempts: outboxEvents.publishAttempts }).from(outboxEvents)
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId))).limit(1);
    if (!current) return;
    const deadLetteredAt = current.publishAttempts >= input.maxAttempts ? timestamp(input.now) : null;
    await this.db.update(outboxEvents).set({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: safeReason(input.reason),
      ...(deadLetteredAt ? { deadLetteredAt } : { availableAt: new Date(input.now.getTime() + input.retryDelayMs).toISOString() }),
    }).where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  private async replayProductionSegmentRetry(transaction: QueryExecutor, input: RetryProductionSegmentInput): Promise<ProductionSegmentRetryExecution> {
    const [existing] = await transaction
      .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
      .from(commandDeduplications)
      .where(retryCommandScope(input.scope, input.idempotencyKey))
      .limit(1);
    if (!existing || existing.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    const snapshot = existing.responseSnapshot as { kind?: unknown; productionRunId?: unknown };
    if (snapshot.kind === "PRODUCTION_SEGMENT_RETRY" && typeof snapshot.productionRunId === "string") {
      const value = await this.progressWithinTransaction(transaction, input.workspaceId, snapshot.productionRunId);
      return value ? { kind: "REPLAY", value, status: 202 } : { kind: "CONFLICT" };
    }
    if (snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID") return { kind: snapshot.kind };
    return { kind: "CONFLICT" };
  }

  private async storeProductionSegmentRetryOutcome(
    transaction: QueryExecutor,
    input: RetryProductionSegmentInput,
    outcome: { kind: "NOT_FOUND" } | { kind: "STATE_INVALID" },
  ) {
    await transaction
      .update(commandDeduplications)
      .set({ responseSnapshot: { kind: outcome.kind } })
      .where(retryCommandScope(input.scope, input.idempotencyKey));
    return outcome;
  }

  private async storeProductionSegmentRetrySnapshot(transaction: QueryExecutor, input: RetryProductionSegmentInput, productionRunId: string) {
    await transaction
      .update(commandDeduplications)
      .set({ responseSnapshot: { kind: "PRODUCTION_SEGMENT_RETRY", productionRunId } })
      .where(retryCommandScope(input.scope, input.idempotencyKey));
  }

  private async progressWithinTransaction(transaction: QueryExecutor, workspaceId: string, productionRunId: string) {
    const [run] = await transaction.select().from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, productionRunId))).limit(1);
    if (!run) return undefined;
    const segments = await transaction.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, workspaceId), eq(productionSegments.productionRunId, productionRunId))).orderBy(asc(productionSegments.sequence));
    return { productionRun: serializeProductionRun(run), segments: segments.map(serializeSegment) };
  }

  private async scheduleEligibleSegments(transaction: QueryExecutor, input: { source: InternalEventEnvelope; productionRun: typeof productionRuns.$inferSelect; now: Date }) {
    const [storyboard] = await transaction.select().from(storyboardRevisions)
      .where(and(eq(storyboardRevisions.workspaceId, input.productionRun.workspaceId), eq(storyboardRevisions.projectId, input.productionRun.projectId), eq(storyboardRevisions.id, input.productionRun.storyboardRevisionId))).limit(1);
    if (!storyboard) return;
    const [script] = await transaction.select().from(scriptRevisions)
      .where(and(eq(scriptRevisions.workspaceId, input.productionRun.workspaceId), eq(scriptRevisions.projectId, input.productionRun.projectId), eq(scriptRevisions.id, storyboard.scriptRevisionId))).limit(1);
    const [brief] = script
      ? await transaction.select().from(creativeBriefRevisions).where(and(eq(creativeBriefRevisions.workspaceId, input.productionRun.workspaceId), eq(creativeBriefRevisions.projectId, input.productionRun.projectId), eq(creativeBriefRevisions.id, script.creativeBriefRevisionId))).limit(1)
      : [];
    if (!brief) return;
    const segments = await transaction.select().from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, input.productionRun.workspaceId), eq(productionSegments.productionRunId, input.productionRun.id))).orderBy(asc(productionSegments.sequence));
    const acceptedSequences = segments.filter((segment) => segment.status === "ACCEPTED").map((segment) => segment.sequence);
    let firstBlockedSegment: {
      sequence: number;
      reasonCode: "DEPENDENCY_PENDING" | "SEGMENT_NEEDS_ATTENTION" | "REFERENCE_POLICY_UNSATISFIED";
      retryable: boolean;
    } | undefined;
    for (const segment of segments) {
      if (segment.status !== "PENDING" && segment.status !== "WAITING") continue;
      try {
        assertProductionSegmentDependencies({ sequence: segment.sequence, dependencySequences: segment.dependsOnSequences, acceptedSequences });
      } catch {
        if (segment.status === "PENDING") {
          assertProductionSegmentTransition(segment.status, "WAITING");
          await transaction.update(productionSegments).set({ status: "WAITING", safeSummary: "等待前一段完成检查。", updatedAt: timestamp(input.now) })
            .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), eq(productionSegments.status, "PENDING")));
        }
        firstBlockedSegment ??= { sequence: segment.sequence, reasonCode: "DEPENDENCY_PENDING", retryable: true };
        continue;
      }
      const [spec] = await transaction.select().from(storyboardShotSpecs)
        .where(and(eq(storyboardShotSpecs.workspaceId, segment.workspaceId), eq(storyboardShotSpecs.projectId, segment.projectId), eq(storyboardShotSpecs.id, segment.shotSpecId))).limit(1);
      const [promptPackage] = spec
        ? await transaction.select().from(promptPackages).where(and(eq(promptPackages.workspaceId, segment.workspaceId), eq(promptPackages.projectId, segment.projectId), eq(promptPackages.shotSpecId, spec.id))).orderBy(desc(promptPackages.createdAt)).limit(1)
        : [];
      if (!spec || !promptPackage) {
        await transaction.update(productionSegments).set({ status: "WAITING", retryable: false, safeSummary: "本段制作资料尚未准备完成。", updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["PENDING", "WAITING"])));
        firstBlockedSegment ??= { sequence: segment.sequence, reasonCode: "SEGMENT_NEEDS_ATTENTION", retryable: false };
        continue;
      }
      const motionPlanResult = promptPackage
        ? GenerationSegmentMotionPlanSchema.safeParse(promptPackage.capabilitySnapshot.motion_plan)
        : undefined;
      const motionPlan = motionPlanResult?.success ? motionPlanResult.data : undefined;
      const motionPlanHash = typeof promptPackage?.capabilitySnapshot.motion_plan_hash === "string"
        ? promptPackage.capabilitySnapshot.motion_plan_hash
        : undefined;
      const visual = await initialVisualInput(transaction, {
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        productionRun: input.productionRun,
        shotSpec: spec,
        sourceAssetIds: brief.sourceAssetIds,
        sourcePrompt: brief.sourceText,
        dependencySegments: segments,
      });
      if (visual.kind === "WAITING") {
        await transaction.update(productionSegments).set({ status: "WAITING", safeSummary: visual.safeSummary, updatedAt: timestamp(input.now) })
          .where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["PENDING", "WAITING"])));
        firstBlockedSegment ??= { sequence: segment.sequence, reasonCode: visual.reasonCode, retryable: true };
        continue;
      }
      await lockProject(transaction, segment.workspaceId, segment.projectId);
      const [positionRow] = await transaction.select({ position: sql<number>`coalesce(max(${shots.position}), -1)` }).from(shots)
        .where(and(eq(shots.workspaceId, segment.workspaceId), eq(shots.projectId, segment.projectId)));
      const shotId = createPrefixedId("sht");
      const taskRunId = createPrefixedId("tsk");
      const productionBilling = readProductionBilling(input.productionRun.budgetGuard);
      let snapshot: VideoGenerationInputSnapshot;
      try {
        snapshot = this.createTaskRunInputSnapshot({
          prompt: promptPackage.prompt,
          ...readPromptCompactionSidecar(promptPackage.capabilitySnapshot),
          duration: spec.durationSeconds,
          resolution: brief.targetResolution,
          ratio: "16:9",
          referenceAssetIds: visual.references.map((reference) => reference.assetId),
          visualInput: visual.visualInput,
          generationSegmentSequence: segment.sequence,
          narrativeBeatSequences: spec.narrativeBeatSequences,
          motionPlanVersion: motionPlan?.version,
          motionPlanHash,
          motionTimeline: motionPlan?.motion_beats,
          ...(productionBilling ? { billing: productionBilling } : {}),
          ...(input.productionRun.deliveryPlanRevisionId ? { deliveryPlanRevisionId: input.productionRun.deliveryPlanRevisionId } : {}),
        });
      } catch (error) {
        if (!isPromptBudgetFailure(error)) throw error;
        assertProductionSegmentTransition(segment.status, "FAILED");
        await transaction.update(productionSegments).set({
          status: "FAILED",
          retryable: false,
          safeSummary: promptBudgetFailureSummary,
          updatedAt: timestamp(input.now),
        }).where(and(
          eq(productionSegments.workspaceId, segment.workspaceId),
          eq(productionSegments.id, segment.id),
          inArray(productionSegments.status, ["PENDING", "WAITING"]),
        ));
        firstBlockedSegment ??= { sequence: segment.sequence, reasonCode: "SEGMENT_NEEDS_ATTENTION", retryable: false };
        continue;
      }
      await transaction.insert(shots).values({
        id: shotId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        position: (positionRow?.position ?? -1) + 1,
        prompt: promptPackage.prompt,
        model: snapshot.model,
        generationSettings: { video_settings: { duration_seconds: snapshot.duration, resolution: snapshot.resolution, ratio: snapshot.ratio } },
        status: "GENERATING",
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      });
      if (visual.references.length > 0) {
        await transaction.insert(referenceBindings).values(visual.references.map((reference) => ({
          workspaceId: segment.workspaceId,
          projectId: segment.projectId,
          shotId,
          assetId: reference.assetId,
          role: reference.role,
          position: reference.position,
          createdAt: timestamp(input.now),
        })));
      }
      const [taskRun] = await transaction.insert(taskRuns).values({
        id: taskRunId,
        workspaceId: segment.workspaceId,
        projectId: segment.projectId,
        shotId,
        kind: "VIDEO_GENERATION",
        status: "QUEUED",
        inputSnapshot: snapshot,
        createdAt: timestamp(input.now),
        updatedAt: timestamp(input.now),
      }).returning();
      assertProductionSegmentTransition(segment.status, "GENERATING");
      await transaction.update(productionSegments).set({
        status: "GENERATING",
        safeSummary: "正在生成本段视频。",
        shotId,
        taskRunId,
        updatedAt: timestamp(input.now),
      }).where(and(eq(productionSegments.workspaceId, segment.workspaceId), eq(productionSegments.id, segment.id), inArray(productionSegments.status, ["PENDING", "WAITING"])));
      await insertOutboxEvent(transaction, queuedTaskEvent(input.source, { now: input.now, taskRun }));
      await insertOutboxEvent(transaction, progressEvent(input.source, { now: input.now, productionRun: input.productionRun, currentSequence: segment.sequence }));
    }

    // A production run may enter GENERATING before the scheduler can create a
    // TaskRun. If every unresolved segment is waiting (for example, because a
    // reference image has not been analyzed), keeping the run GENERATING makes
    // it look active forever and blocks harmless source-asset cleanup. Persist
    // the truthful BLOCKED state in the same transaction as the scheduler pass.
    const [latest] = await transaction
      .select()
      .from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, input.productionRun.workspaceId), eq(productionRuns.id, input.productionRun.id)))
      .limit(1);
    if (!latest || latest.status !== "GENERATING") return;
    const latestSegments = await transaction
      .select()
      .from(productionSegments)
      .where(and(eq(productionSegments.workspaceId, latest.workspaceId), eq(productionSegments.productionRunId, latest.id)))
      .orderBy(asc(productionSegments.sequence));
    const hasRunnableSegment = latestSegments.some((segment) => (
      Boolean(segment.taskRunId) && ["GENERATING", "CHECKING"].includes(segment.status)
    ));
    const hasPromptBudgetFailure = latestSegments.some((segment) => (
      segment.status === "FAILED" && !segment.taskRunId && !segment.retryable
    ));
    const unresolved = latestSegments.find((segment) => (
      ["PENDING", "WAITING", "GENERATING", "CHECKING", "FAILED"].includes(segment.status) && !segment.taskRunId
    ));
    if ((!hasPromptBudgetFailure && hasRunnableSegment) || !unresolved) return;

    const block = firstBlockedSegment ?? {
      sequence: unresolved.sequence,
      reasonCode: "SEGMENT_NEEDS_ATTENTION" as const,
      retryable: true,
    };
    assertProductionRunTransition(latest.status, "BLOCKED");
    const [blocked] = await transaction
      .update(productionRuns)
      .set({ status: "BLOCKED", updatedAt: timestamp(input.now) })
      .where(and(eq(productionRuns.workspaceId, latest.workspaceId), eq(productionRuns.id, latest.id), eq(productionRuns.status, "GENERATING")))
      .returning();
    if (blocked) {
      await insertOutboxEvent(transaction, blockedEvent(input.source, {
        now: input.now,
        productionRun: blocked,
        sequence: block.sequence,
        reasonCode: block.reasonCode,
        retryable: block.retryable,
      }));
    }
  }
}
