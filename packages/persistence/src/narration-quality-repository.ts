import { and, asc, desc, eq } from "drizzle-orm";

import {
  InternalEventEnvelopeSchema,
  type CanonicalTranscriptCheck,
  NarrationAssetVersionSchema,
  NarrationScriptRevisionSchema,
  TimelinePlanSchema,
  type CreateNarrationScriptRevisionCommand,
  type CreateTimelinePlanCommand,
  type InternalEventEnvelope,
  type NarrationAssetVersion,
  type NarrationAudioGenerationKind,
  type NarrationAudioProviderSettings,
  type RequestNarrationAudioGenerationCommand,
  type NarrationScriptRevision,
  type TimelinePlan,
} from "@alchemy-video/contracts";
import {
  NarrationAudioProviderSettingsSchema,
  RequestNarrationAudioGenerationCommandSchema,
} from "@alchemy-video/contracts";
import { assertNarrationRevisionTransition, buildNarrationTimeline, normalizeNarrationSections, createPrefixedId } from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import {
  assets,
  commandDeduplications,
  deliveryPlanRevisions,
  narrationAssetVersions,
  narrationScriptRevisions,
  outboxEvents,
  timelinePlans,
} from "./schema.js";

export type NarrationQualityCommandEvent = {
  eventId: string;
  messageId: string;
  traceId: string;
  correlationId: string;
};

export type NarrationQualityCommandOutcome<T> =
  | { kind: "NEW" | "REPLAY"; value: T; status: 201 | 202 }
  | { kind: "CONFLICT" | "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE" | "INVALID_TIMELINE" };

export type NarrationAudioGenerationResult = {
  event_id: string;
  asset_id: string;
  narration_asset_version_id?: string;
  generation_kind: NarrationAudioGenerationKind;
  object_key: string;
  status: "QUEUED";
};

export type NarrationAudioGenerationEvent = Extract<InternalEventEnvelope, { event_type: "narration_audio.generation_requested" }>;

export type NarrationAudioGenerationInput = {
  event: NarrationAudioGenerationEvent;
  workspaceId: string;
  projectId: string;
  narrationScriptRevisionId: string;
  sectionId: string;
  scriptText: string;
  provider: string;
  voiceId: string;
  providerSettings: NarrationAudioProviderSettings;
  generationKind: NarrationAudioGenerationKind;
  assetId: string;
  narrationAssetVersionId?: string;
  sampleAssetId?: string;
  objectKey: string;
};

export type NarrationAudioMeasuredFacts = {
  mimeType: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm";
  sha256: string;
  byteSize: number;
  durationMs: number;
};

const measuredNarrationMimeTypes = ["audio/wav", "audio/mpeg", "audio/ogg", "audio/pcm"] as const;
const isMeasuredNarrationMimeType = (value: string): value is NarrationAudioMeasuredFacts["mimeType"] =>
  measuredNarrationMimeTypes.includes(value as NarrationAudioMeasuredFacts["mimeType"]);

export type NarrationGeneratedAssetState = {
  workspaceId: string;
  projectId: string;
  assetId: string;
  objectKey: string;
  status: "PENDING_UPLOAD" | "READY";
  sha256?: string;
  mimeType?: string;
  byteSize?: number;
  durationMs?: number;
};

export interface NarrationQualityStore {
  listNarrationScriptRevisions(workspaceId: string, deliveryPlanRevisionId: string): Promise<NarrationScriptRevision[]>;
  findNarrationScriptRevision(workspaceId: string, narrationScriptRevisionId: string): Promise<NarrationScriptRevision | undefined>;
  /** Internal production preflight; never exposed as a public DTO. */
  hasReadyTimelinePlan?(workspaceId: string, projectId: string, deliveryPlanRevisionId: string): Promise<boolean>;
  createNarrationScriptRevision(input: {
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    workspaceId: string;
    deliveryPlanRevisionId: string;
    command: CreateNarrationScriptRevisionCommand;
    event: NarrationQualityCommandEvent;
  }): Promise<NarrationQualityCommandOutcome<NarrationScriptRevision>>;
  approveNarrationScriptRevision(input: {
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    workspaceId: string;
    narrationScriptRevisionId: string;
    command: {
      sample_asset_id: string;
      sample_provider: string;
      sample_voice_id: string;
      sample_provider_settings: Record<string, unknown>;
      sample_duration_ms: number;
      canonical_script_hash: string;
      word_timestamps_asset_id: string | null;
      canonical_transcript_check?: CanonicalTranscriptCheck;
    };
    event: NarrationQualityCommandEvent;
  }): Promise<NarrationQualityCommandOutcome<NarrationScriptRevision>>;
  createTimelinePlan(input: {
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    workspaceId: string;
    narrationScriptRevisionId: string;
    command: CreateTimelinePlanCommand;
    event: NarrationQualityCommandEvent;
  }): Promise<NarrationQualityCommandOutcome<TimelinePlan>>;
  requestNarrationAudioGeneration(input: {
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    workspaceId: string;
    narrationScriptRevisionId: string;
    assetId: string;
    narrationAssetVersionId?: string;
    objectKey: string;
    command: RequestNarrationAudioGenerationCommand;
    event: NarrationQualityCommandEvent;
  }): Promise<NarrationQualityCommandOutcome<NarrationAudioGenerationResult>>;
  findNarrationAudioGenerationInput(input: { event: NarrationAudioGenerationEvent }): Promise<NarrationAudioGenerationInput | undefined>;
  ensureGeneratedNarrationAsset(input: { event: NarrationAudioGenerationEvent }): Promise<NarrationGeneratedAssetState | undefined>;
  completeNarrationAudioGeneration(input: { event: NarrationAudioGenerationEvent; facts: NarrationAudioMeasuredFacts }): Promise<NarrationAssetVersion | undefined>;
}

/** Shared tolerance for comparing independently measured narration durations. */
export const NARRATION_MEASURED_DURATION_TOLERANCE_MS = 250;
const MEASURED_DURATION_TOLERANCE_MS = NARRATION_MEASURED_DURATION_TOLERANCE_MS;

type StoredCommand = {
  requestHash: string;
  snapshot:
    | { kind: "SCRIPT"; id: string }
    | { kind: "TIMELINE"; id: string }
    | { kind: "GENERATION"; value: NarrationAudioGenerationResult }
    | { kind: "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE" | "INVALID_TIMELINE" };
  status: 201 | 202;
};

const commandKey = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;
const now = () => new Date().toISOString();

/**
 * The generated AUDIO asset is an immutable projection of the request that
 * created it.  Replays may carry a new event id, but must not reuse an asset
 * reserved for a different script/provider/voice/settings identity.
 */
const generatedNarrationIdentityMatches = (metadata: unknown, event: NarrationAudioGenerationEvent) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const generation = (metadata as Record<string, unknown>).narration_generation;
  if (!generation || typeof generation !== "object" || Array.isArray(generation)) return false;
  const facts = generation as Record<string, unknown>;
  return facts.narration_script_revision_id === event.data.narration_script_revision_id
    && facts.generation_kind === event.data.generation_kind
    && facts.section_id === event.data.section_id
    && facts.provider === event.data.provider
    && facts.voice_id === event.data.voice_id
    && facts.canonical_script_hash === event.data.canonical_script_hash
    && JSON.stringify(facts.provider_settings) === JSON.stringify(event.data.provider_settings)
    && (event.data.sample_asset_id === undefined || facts.sample_asset_id === event.data.sample_asset_id);
};

const eventEnvelope = (input: {
  event: NarrationQualityCommandEvent;
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  aggregateType: "narration_plan_revision" | "timeline_plan";
  aggregateId: string;
  eventType: "narration_script.normalized" | "narration_script.approved" | "narration_audio.generation_requested" | "narration_asset_version.ready" | "timeline_plan.created";
  producer?: string;
  data: Record<string, unknown>;
}) => InternalEventEnvelopeSchema.parse({
  contract_version: "1.0",
  event_type: input.eventType,
  message_id: input.event.messageId,
  event_id: input.event.eventId,
  occurred_at: now(),
  trace_id: input.event.traceId,
  correlation_id: input.event.correlationId,
  idempotency_key: input.idempotencyKey,
  producer: input.producer ?? "control-api",
  workspace_id: input.workspaceId,
  project_id: input.projectId,
  aggregate: { type: input.aggregateType, id: input.aggregateId },
  version: 1,
  data: input.data,
});

const toScript = (value: NarrationScriptRevision): NarrationScriptRevision => NarrationScriptRevisionSchema.parse(value);
const toAssetVersion = (value: NarrationAssetVersion): NarrationAssetVersion => NarrationAssetVersionSchema.parse(value);
const toTimeline = (value: TimelinePlan): TimelinePlan => TimelinePlanSchema.parse(value);
const durationsMatch = (leftMs: number, rightMs: number) => Math.abs(leftMs - rightMs) <= MEASURED_DURATION_TOLERANCE_MS;
const sectionDurationTotal = (sections: ReadonlyArray<{ duration_ms: number }>) => sections.reduce((total, section) => total + section.duration_ms, 0);
const unavailableCanonicalTranscriptCheck = (): CanonicalTranscriptCheck => ({
  status: "UNAVAILABLE",
  transcript_asset_id: null,
  matches: null,
  accuracy: null,
  issues: ["未附加可比较的 canonical transcript。"],
});

const sampleAssetIdFromApprovalPayload = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const sampleAssetId = (data as { sample_asset_id?: unknown }).sample_asset_id;
  return typeof sampleAssetId === "string" && sampleAssetId.length > 0 ? sampleAssetId : undefined;
};

export class InMemoryNarrationQualityStore implements NarrationQualityStore {
  private readonly scripts = new Map<string, NarrationScriptRevision>();
  private readonly assets = new Map<string, NarrationAssetVersion>();
  private readonly timelines = new Map<string, TimelinePlan>();
  private readonly generatedAssets = new Map<string, { workspaceId: string; projectId: string; assetId: string; objectKey: string; status: "PENDING_UPLOAD" | "READY"; metadata: Record<string, unknown>; facts?: NarrationAudioMeasuredFacts }>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly events: InternalEventEnvelope[] = [];

  constructor(
    private readonly deliveryResolver: {
      findDeliveryPlanRevision(workspaceId: string, deliveryPlanRevisionId: string): Promise<{ projectId: string; targetDurationSeconds: number } | undefined>;
    },
    private readonly assetResolver?: {
      findAsset(workspaceId: string, assetId: string): Promise<{ projectId: string; kind: string; status: string; durationMs?: number | null; origin?: string; mimeType?: string | null; metadata?: Record<string, unknown> } | undefined>;
      ensureGeneratedAudioAsset?(input: { workspaceId: string; projectId: string; assetId: string; objectKey: string; metadata: Record<string, unknown> }): Promise<unknown | undefined>;
      completeGeneratedAudioAsset?(input: { workspaceId: string; assetId: string; sha256: string; mimeType: string; byteSize: number; durationMs: number; metadata?: Record<string, unknown> }): Promise<unknown | undefined>;
    },
    private readonly eventSink?: (event: InternalEventEnvelope) => void,
  ) {}

  async listNarrationScriptRevisions(workspaceId: string, deliveryPlanRevisionId: string) {
    return [...this.scripts.values()]
      .filter((script) => script.workspace_id === workspaceId && script.delivery_plan_revision_id === deliveryPlanRevisionId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map(toScript);
  }

  async findNarrationScriptRevision(workspaceId: string, narrationScriptRevisionId: string) {
    const script = this.scripts.get(narrationScriptRevisionId);
    return script?.workspace_id === workspaceId ? toScript(script) : undefined;
  }

  async hasReadyTimelinePlan(workspaceId: string, projectId: string, deliveryPlanRevisionId: string) {
    const timeline = [...this.timelines.values()].find((value) => value.workspace_id === workspaceId
      && value.project_id === projectId
      && value.delivery_plan_revision_id === deliveryPlanRevisionId
      && value.status === "READY");
    if (!timeline) return false;
    const script = this.scripts.get(timeline.narration_script_revision_id);
    if (!script || script.workspace_id !== workspaceId || script.project_id !== projectId
      || script.delivery_plan_revision_id !== deliveryPlanRevisionId || script.status !== "APPROVED") return false;
    const approvedSampleAssetId = [...this.events].reverse().find((value) =>
      value.event_type === "narration_script.approved"
        && value.aggregate.id === script.id,
    );
    const primarySections = timeline.narration_sections.filter((section) => section.visual_role === "PRIMARY");
    const sectionAssetIds = primarySections
      .map((section) => section.narration_asset_version_id)
      .filter((value): value is string => typeof value === "string");
    if (sectionAssetIds.length > 0) {
      if (timeline.narration_asset_version_id || sectionAssetIds.length !== primarySections.length
        || new Set(sectionAssetIds).size !== sectionAssetIds.length) return false;
      for (const section of primarySections) {
        const versionId = section.narration_asset_version_id;
        const version = versionId ? this.assets.get(versionId) : undefined;
        if (!version || version.workspace_id !== workspaceId || version.project_id !== projectId
          || version.narration_script_revision_id !== script.id || version.sample_approved
          || sampleAssetIdFromApprovalPayload(approvedSampleAssetId) === version.asset_id
          || Math.abs(version.duration_ms - (section.end_ms - section.start_ms)) > Math.max(1, Math.round((section.end_ms - section.start_ms) * 0.15))) return false;
        const asset = this.assetResolver
          ? await this.assetResolver.findAsset(workspaceId, version.asset_id)
          : undefined;
        if (!asset || asset.projectId !== projectId || asset.kind !== "AUDIO" || asset.status !== "READY") return false;
      }
      return true;
    }
    if (!timeline.narration_asset_version_id) return false;
    const version = this.assets.get(timeline.narration_asset_version_id);
    // `sample_approved` is a fact about a preview/sample row, not proof that
    // the full canonical narration exists.  Only a formal version (the
    // existing row shape with the sample flag unset) may satisfy production
    // readiness.  Historical sample rows remain readable for audit but are
    // never promoted implicitly.
    if (!version || version.workspace_id !== workspaceId || version.project_id !== projectId
      || version.narration_script_revision_id !== script.id || version.sample_approved) return false;
    if (sampleAssetIdFromApprovalPayload(approvedSampleAssetId) === version.asset_id) return false;
    const asset = this.assetResolver
      ? await this.assetResolver.findAsset(workspaceId, version.asset_id)
      : undefined;
    return Boolean(asset && asset.projectId === projectId && asset.kind === "AUDIO" && asset.status === "READY");
  }

  async createNarrationScriptRevision(
    input: Parameters<NarrationQualityStore["createNarrationScriptRevision"]>[0],
  ): Promise<NarrationQualityCommandOutcome<NarrationScriptRevision>> {
    const replay = this.replayScript(input);
    if (replay) return replay;
    const delivery = await this.deliveryResolver.findDeliveryPlanRevision(input.workspaceId, input.deliveryPlanRevisionId);
    if (!delivery) return this.storeScript(input, { kind: "NOT_FOUND" }, 201);
    const normalized = normalizeNarrationSections({
      sections: input.command.display_sections,
      glossary: new Map(input.command.pronunciation_glossary.map((guide) => [guide.source, guide.spoken])),
    });
    const timestamp = now();
    const script = toScript({
      id: createPrefixedId("nsr"),
      workspace_id: input.workspaceId,
      project_id: delivery.projectId,
      delivery_plan_revision_id: input.deliveryPlanRevisionId,
      status: normalized.status,
      source_script_hash: normalized.sourceScriptHash,
      display_sections: normalized.displaySections,
      spoken_sections: normalized.spokenSections,
      language: "zh-CN",
      normalization_version: input.command.normalization_version,
      decision_reasons: normalized.decisionReasons,
      created_at: timestamp,
      updated_at: timestamp,
    });
    this.scripts.set(script.id, script);
    this.appendEvent(eventEnvelope({
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      workspaceId: input.workspaceId,
      projectId: script.project_id,
      aggregateType: "narration_plan_revision",
      aggregateId: script.id,
      eventType: "narration_script.normalized",
      data: {
        narration_script_revision_id: script.id,
        delivery_plan_revision_id: script.delivery_plan_revision_id,
        status: script.status,
        decision_reasons: script.decision_reasons,
      },
    }));
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "SCRIPT", id: script.id }, status: 201 });
    return { kind: "NEW", value: script, status: 201 } as const;
  }

  async approveNarrationScriptRevision(input: Parameters<NarrationQualityStore["approveNarrationScriptRevision"]>[0]) {
    const replay = this.replayScript(input);
    if (replay) return replay;
    const script = await this.findNarrationScriptRevision(input.workspaceId, input.narrationScriptRevisionId);
    if (!script) return this.storeScript(input, { kind: "NOT_FOUND" }, 202);
    if (script.status !== "NORMALIZED" || script.source_script_hash !== input.command.canonical_script_hash) return this.storeScript(input, { kind: "STATE_INVALID" }, 202);
    if (this.assetResolver) {
      const sample = await this.assetResolver.findAsset(input.workspaceId, input.command.sample_asset_id);
      if (!sample || sample.projectId !== script.project_id || sample.kind !== "AUDIO" || sample.status !== "READY") return this.storeScript(input, { kind: "INVALID_SAMPLE" }, 202);
      const generation = sample.metadata?.narration_generation;
      if (sample.origin !== "GENERATED" || !generation || typeof generation !== "object" || Array.isArray(generation)) return this.storeScript(input, { kind: "INVALID_SAMPLE" }, 202);
      const generationFacts = generation as Record<string, unknown>;
      const generationSettings = NarrationAudioProviderSettingsSchema.safeParse(generationFacts.provider_settings);
      if (generationFacts.generation_kind !== "SAMPLE"
        || generationFacts.provider !== input.command.sample_provider
        || generationFacts.voice_id !== input.command.sample_voice_id
        || generationFacts.canonical_script_hash !== input.command.canonical_script_hash
        || !generationSettings.success
        || JSON.stringify(generationSettings.data) !== JSON.stringify(input.command.sample_provider_settings)) return this.storeScript(input, { kind: "INVALID_SAMPLE" }, 202);
      if (typeof sample.durationMs === "number" && !durationsMatch(sample.durationMs, input.command.sample_duration_ms)) return this.storeScript(input, { kind: "INVALID_SAMPLE" }, 202);
      if (input.command.word_timestamps_asset_id) {
        const timestamps = await this.assetResolver.findAsset(input.workspaceId, input.command.word_timestamps_asset_id);
        if (!timestamps || timestamps.projectId !== script.project_id || timestamps.kind !== "DOCUMENT" || timestamps.status !== "READY") return this.storeScript(input, { kind: "INVALID_SAMPLE" }, 202);
      }
    }
    assertNarrationRevisionTransition(script.status, "APPROVED");
    const timestamp = now();
    // Approval is deliberately only an approval fact.  The sample bytes are
    // not a formal NarrationAssetVersion: a full canonical narration must be
    // generated, measured and registered by its own source-aligned path
    // before a TimelinePlan can consume it.
    const approved = toScript({ ...script, status: "APPROVED", updated_at: timestamp });
    this.scripts.set(approved.id, approved);
    this.appendEvent(eventEnvelope({
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      workspaceId: script.workspace_id,
      projectId: script.project_id,
      aggregateType: "narration_plan_revision",
      aggregateId: script.id,
      eventType: "narration_script.approved",
      data: {
        narration_script_revision_id: script.id,
        sample_asset_id: input.command.sample_asset_id,
        canonical_script_hash: script.source_script_hash,
        status: "APPROVED",
      },
    }));
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "SCRIPT", id: approved.id }, status: 202 });
    return { kind: "NEW", value: approved, status: 202 } as const;
  }

  async createTimelinePlan(input: Parameters<NarrationQualityStore["createTimelinePlan"]>[0]) {
    const replay = this.replayTimeline(input);
    if (replay) return replay;
    const script = await this.findNarrationScriptRevision(input.workspaceId, input.narrationScriptRevisionId);
    if (!script || script.status !== "APPROVED") return this.storeTimeline(input, { kind: "STATE_INVALID" }, 201);
    const delivery = await this.deliveryResolver.findDeliveryPlanRevision(input.workspaceId, script.delivery_plan_revision_id);
    if (!delivery || delivery.projectId !== script.project_id) return this.storeTimeline(input, { kind: "NOT_FOUND" }, 201);
    const expectedIds = script.spoken_sections.map((section) => section.id);
    if (input.command.section_durations_ms.length !== expectedIds.length || input.command.section_durations_ms.some((section, index) => section.section_id !== expectedIds[index])) {
      return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
    }
    const primarySections = input.command.section_durations_ms;
    const sectionAssetIds = primarySections
      .map((section) => section.narration_asset_version_id)
      .filter((value): value is string => typeof value === "string");
    const hasSectionAssets = sectionAssetIds.length > 0;
    if (hasSectionAssets && (sectionAssetIds.length !== primarySections.length
      || input.command.narration_asset_version_id
      || new Set(sectionAssetIds).size !== sectionAssetIds.length)) {
      return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
    }
    // A timeline must name either one measured full narration asset or one
    // measured formal asset for every PRIMARY section.  Never auto-select the
    // approved sample as if it were a final track.
    if (!hasSectionAssets && !input.command.narration_asset_version_id) return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
    const measuredAsset = input.command.narration_asset_version_id
      ? this.assets.get(input.command.narration_asset_version_id)
      : undefined;
    if (!hasSectionAssets && (!measuredAsset || measuredAsset.narration_script_revision_id !== script.id || measuredAsset.sample_approved)) {
      return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
    }
    const approvedSampleAssetId = [...this.events].reverse().find((value) =>
      value.event_type === "narration_script.approved"
        && value.aggregate.id === script.id,
    );
    if (measuredAsset && sampleAssetIdFromApprovalPayload(approvedSampleAssetId) === measuredAsset.asset_id) {
      return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
    }
    if (hasSectionAssets) {
      for (const section of primarySections) {
        const versionId = section.narration_asset_version_id;
        const version = versionId ? this.assets.get(versionId) : undefined;
        if (!version || version.narration_script_revision_id !== script.id || version.sample_approved
          || sampleAssetIdFromApprovalPayload(approvedSampleAssetId) === version.asset_id
          || !durationsMatch(version.duration_ms, section.duration_ms)
          || Math.abs(version.duration_ms - section.duration_ms) > Math.max(1, Math.round(section.duration_ms * 0.15))) {
          return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
        }
        if (this.assetResolver) {
          const asset = await this.assetResolver.findAsset(input.workspaceId, version.asset_id);
          if (!asset || asset.projectId !== script.project_id || asset.kind !== "AUDIO" || asset.status !== "READY"
            || (typeof asset.durationMs === "number" && !durationsMatch(asset.durationMs, version.duration_ms))) {
            return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
          }
        }
      }
    } else if (this.assetResolver && measuredAsset) {
      const asset = await this.assetResolver.findAsset(input.workspaceId, measuredAsset.asset_id);
      if (!asset || asset.projectId !== script.project_id || asset.kind !== "AUDIO" || asset.status !== "READY"
        || (typeof asset.durationMs === "number" && !durationsMatch(asset.durationMs, measuredAsset.duration_ms))) {
        return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
      }
    }
    if (measuredAsset && !durationsMatch(sectionDurationTotal(input.command.section_durations_ms), measuredAsset.duration_ms)) return this.storeTimeline(input, { kind: "INVALID_TIMELINE" }, 201);
    const compiled = buildNarrationTimeline({
      sectionDurationsMs: input.command.section_durations_ms.map((section) => ({ sectionId: section.section_id, durationMs: section.duration_ms, ...(section.narration_asset_version_id ? { narrationAssetVersionId: section.narration_asset_version_id } : {}) })),
      targetDurationMs: input.command.target_duration_ms || delivery.targetDurationSeconds * 1000,
      flexiblePercent: input.command.flexible_percent,
      maxProviderDurationSeconds: input.command.max_provider_duration_seconds,
    });
    const timeline = toTimeline({
      id: createPrefixedId("tlp"),
      workspace_id: script.workspace_id,
      project_id: script.project_id,
      delivery_plan_revision_id: script.delivery_plan_revision_id,
      narration_script_revision_id: script.id,
      narration_asset_version_id: measuredAsset?.id ?? null,
      effective_duration_ms: compiled.effectiveDurationMs,
      narration_sections: compiled.narrationSections,
      visual_segments: compiled.visualSegments,
      status: compiled.status,
      decision_reasons: compiled.decisionReasons,
      created_at: now(),
    });
    this.timelines.set(timeline.id, timeline);
    this.appendEvent(eventEnvelope({
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      workspaceId: script.workspace_id,
      projectId: script.project_id,
      aggregateType: "timeline_plan",
      aggregateId: timeline.id,
      eventType: "timeline_plan.created",
      data: {
        timeline_plan_id: timeline.id,
        narration_script_revision_id: script.id,
        delivery_plan_revision_id: script.delivery_plan_revision_id,
        status: timeline.status,
        effective_duration_ms: timeline.effective_duration_ms,
      },
    }));
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "TIMELINE", id: timeline.id }, status: 201 });
    return { kind: "NEW", value: timeline, status: 201 } as const;
  }

  async requestNarrationAudioGeneration(input: Parameters<NarrationQualityStore["requestNarrationAudioGeneration"]>[0]) {
    const replay = this.replayGeneration(input);
    if (replay) return replay;
    const command = RequestNarrationAudioGenerationCommandSchema.parse(input.command);
    const script = await this.findNarrationScriptRevision(input.workspaceId, input.narrationScriptRevisionId);
    if (!script || script.source_script_hash !== command.canonical_script_hash) return this.storeGenerationFailure(input, "NOT_FOUND");
    const expectedStatus = command.generation_kind === "SAMPLE" ? "NORMALIZED" : "APPROVED";
    if (script.status !== expectedStatus || !script.spoken_sections.some((section) => section.id === command.section_id)) {
      return this.storeGenerationFailure(input, "STATE_INVALID");
    }
    const versionId = command.generation_kind === "FORMAL"
      ? input.narrationAssetVersionId ?? createPrefixedId("nav")
      : undefined;
    if (command.generation_kind === "FORMAL") {
      const approved = [...this.events].reverse().find((event): event is Extract<InternalEventEnvelope, { event_type: "narration_script.approved" }> => event.event_type === "narration_script.approved" && event.aggregate.id === script.id);
      if (!approved || approved.data.sample_asset_id !== command.sample_asset_id) return this.storeGenerationFailure(input, "INVALID_SAMPLE");
      if (this.assetResolver) {
        const sample = await this.assetResolver.findAsset(input.workspaceId, command.sample_asset_id!);
        if (!sample || sample.projectId !== script.project_id || sample.kind !== "AUDIO" || sample.status !== "READY") return this.storeGenerationFailure(input, "INVALID_SAMPLE");
      }
    }
    const providerSettings = NarrationAudioProviderSettingsSchema.parse(command.provider_settings);
    if (!input.objectKey.startsWith(`${input.workspaceId}/${script.project_id}/${input.assetId}/`)) return this.storeGenerationFailure(input, "STATE_INVALID");
    const event = eventEnvelope({
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      workspaceId: input.workspaceId,
      projectId: script.project_id,
      aggregateType: "narration_plan_revision",
      aggregateId: script.id,
      eventType: "narration_audio.generation_requested",
      data: {
        narration_script_revision_id: script.id,
        generation_kind: command.generation_kind,
        section_id: command.section_id,
        asset_id: input.assetId,
        ...(versionId ? { narration_asset_version_id: versionId } : {}),
        ...(command.sample_asset_id ? { sample_asset_id: command.sample_asset_id } : {}),
        provider: command.provider,
        voice_id: command.voice_id,
        provider_settings: providerSettings,
        canonical_script_hash: script.source_script_hash,
        object_key: input.objectKey,
      },
    });
    this.appendEvent(event);
    const value: NarrationAudioGenerationResult = {
      event_id: event.event_id,
      asset_id: input.assetId,
      ...(versionId ? { narration_asset_version_id: versionId } : {}),
      generation_kind: command.generation_kind,
      object_key: input.objectKey,
      status: "QUEUED",
    };
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "GENERATION", value }, status: 202 });
    return { kind: "NEW", value, status: 202 } as const;
  }

  async findNarrationAudioGenerationInput(input: { event: NarrationAudioGenerationEvent }) {
    const { event } = input;
    const script = await this.findNarrationScriptRevision(event.workspace_id, event.data.narration_script_revision_id);
    if (!script || script.project_id !== event.project_id || script.source_script_hash !== event.data.canonical_script_hash) return undefined;
    const section = script.spoken_sections.find((candidate) => candidate.id === event.data.section_id);
    if (!section) return undefined;
    if (event.data.generation_kind === "SAMPLE" && script.status !== "NORMALIZED") return undefined;
    if (event.data.generation_kind === "FORMAL" && script.status !== "APPROVED") return undefined;
    if (event.data.generation_kind === "FORMAL") {
      const approved = [...this.events].reverse().find((candidate): candidate is Extract<InternalEventEnvelope, { event_type: "narration_script.approved" }> => candidate.event_type === "narration_script.approved" && candidate.aggregate.id === script.id);
      if (!approved || approved.data.sample_asset_id !== event.data.sample_asset_id) return undefined;
    }
    return {
      event,
      workspaceId: event.workspace_id,
      projectId: event.project_id,
      narrationScriptRevisionId: script.id,
      sectionId: section.id,
      scriptText: section.provider_text,
      provider: event.data.provider,
      voiceId: event.data.voice_id,
      providerSettings: event.data.provider_settings,
      generationKind: event.data.generation_kind,
      assetId: event.data.asset_id,
      ...(event.data.narration_asset_version_id ? { narrationAssetVersionId: event.data.narration_asset_version_id } : {}),
      ...(event.data.sample_asset_id ? { sampleAssetId: event.data.sample_asset_id } : {}),
      objectKey: event.data.object_key,
    } satisfies NarrationAudioGenerationInput;
  }

  async ensureGeneratedNarrationAsset(input: { event: NarrationAudioGenerationEvent }) {
    const event = input.event;
    const existing = this.generatedAssets.get(event.data.asset_id);
    if (existing) {
      if (existing.workspaceId !== event.workspace_id || existing.projectId !== event.project_id || existing.objectKey !== event.data.object_key || !generatedNarrationIdentityMatches(existing.metadata, event)) throw new Error("Generated narration asset identity conflicts with the generation request.");
      return existing;
    }
    const metadata = {
      narration_generation: {
        event_id: event.event_id,
        narration_script_revision_id: event.data.narration_script_revision_id,
        generation_kind: event.data.generation_kind,
        section_id: event.data.section_id,
        provider: event.data.provider,
        voice_id: event.data.voice_id,
        provider_settings: event.data.provider_settings,
        canonical_script_hash: event.data.canonical_script_hash,
        ...(event.data.sample_asset_id ? { sample_asset_id: event.data.sample_asset_id } : {}),
      },
    };
    if (this.assetResolver?.ensureGeneratedAudioAsset) {
      const persisted = await this.assetResolver.ensureGeneratedAudioAsset({ workspaceId: event.workspace_id, projectId: event.project_id, assetId: event.data.asset_id, objectKey: event.data.object_key, metadata });
      if (!persisted) return undefined;
    }
    const draft = { workspaceId: event.workspace_id, projectId: event.project_id, assetId: event.data.asset_id, objectKey: event.data.object_key, status: "PENDING_UPLOAD" as const, metadata };
    this.generatedAssets.set(event.data.asset_id, draft);
    return draft;
  }

  async completeNarrationAudioGeneration(input: { event: NarrationAudioGenerationEvent; facts: NarrationAudioMeasuredFacts }) {
    const event = input.event;
    const draft = this.generatedAssets.get(event.data.asset_id) ?? await this.ensureGeneratedNarrationAsset({ event });
    if (!draft) return undefined;
    if (draft.workspaceId !== event.workspace_id || draft.projectId !== event.project_id || draft.objectKey !== event.data.object_key || !generatedNarrationIdentityMatches(draft.metadata, event)) throw new Error("Generated narration asset identity conflicts with the generation request.");
    if (!/^[a-f0-9]{64}$/u.test(input.facts.sha256) || input.facts.byteSize < 1 || input.facts.durationMs < 1 || !isMeasuredNarrationMimeType(input.facts.mimeType)) throw new Error("Measured generated narration facts are invalid.");
    if (this.assetResolver?.completeGeneratedAudioAsset) {
      const persisted = await this.assetResolver.completeGeneratedAudioAsset({ workspaceId: event.workspace_id, assetId: event.data.asset_id, sha256: input.facts.sha256, mimeType: input.facts.mimeType, byteSize: input.facts.byteSize, durationMs: input.facts.durationMs });
      if (!persisted) return undefined;
    }
    const completed = { ...draft, status: "READY" as const, facts: input.facts };
    this.generatedAssets.set(event.data.asset_id, completed);
    if (event.data.generation_kind !== "FORMAL" || !event.data.narration_asset_version_id) return undefined;
    const existing = this.assets.get(event.data.narration_asset_version_id);
    if (existing) {
      if (existing.asset_id !== event.data.asset_id
        || existing.narration_script_revision_id !== event.data.narration_script_revision_id
        || existing.provider !== event.data.provider
        || existing.voice_id !== event.data.voice_id
        || JSON.stringify(existing.provider_settings) !== JSON.stringify(event.data.provider_settings)
        || existing.duration_ms !== input.facts.durationMs
        || existing.sample_approved !== false) throw new Error("Narration asset version facts conflict with the generation request.");
      return toAssetVersion(existing);
    }
    const timestamp = now();
    const version = toAssetVersion({
      id: event.data.narration_asset_version_id,
      workspace_id: event.workspace_id,
      project_id: event.project_id,
      narration_script_revision_id: event.data.narration_script_revision_id,
      asset_id: event.data.asset_id,
      provider: event.data.provider,
      voice_id: event.data.voice_id,
      provider_settings: event.data.provider_settings,
      duration_ms: input.facts.durationMs,
      sample_approved: false,
      word_timestamps_asset_id: null,
      canonical_transcript_check: unavailableCanonicalTranscriptCheck(),
      created_at: timestamp,
      updated_at: timestamp,
    });
    this.assets.set(version.id, version);
    const readyEvent = InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      event_type: "narration_asset_version.ready",
      message_id: createPrefixedId("msg"),
      event_id: createPrefixedId("evt"),
      occurred_at: timestamp,
      trace_id: event.trace_id,
      correlation_id: event.correlation_id,
      causation_id: event.event_id,
      idempotency_key: `${event.idempotency_key}:ready`,
      producer: "media-runtime-worker",
      workspace_id: event.workspace_id,
      project_id: event.project_id,
      aggregate: { type: "narration_plan_revision", id: event.data.narration_script_revision_id },
      version: 1,
      data: {
        narration_asset_version_id: version.id,
        narration_script_revision_id: version.narration_script_revision_id,
        asset_id: version.asset_id,
        duration_ms: version.duration_ms,
        sample_approved: false,
      },
    });
    this.appendEvent(readyEvent);
    return version;
  }

  listEvents(workspaceId: string) {
    return this.events.filter((event) => event.workspace_id === workspaceId);
  }

  private appendEvent(event: InternalEventEnvelope) {
    this.events.push(event);
    this.eventSink?.(event);
  }

  private storeScript(
    input: { scope: string; idempotencyKey: string; requestHash: string },
    snapshot: Extract<StoredCommand["snapshot"], { kind: "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE" | "INVALID_TIMELINE" }>,
    status: 201 | 202,
  ): NarrationQualityCommandOutcome<NarrationScriptRevision> {
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot, status });
    return { kind: snapshot.kind };
  }

  private storeTimeline(
    input: { scope: string; idempotencyKey: string; requestHash: string },
    snapshot: Extract<StoredCommand["snapshot"], { kind: "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE" | "INVALID_TIMELINE" }>,
    status: 201 | 202,
  ): NarrationQualityCommandOutcome<TimelinePlan> {
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot, status });
    return { kind: snapshot.kind };
  }

  private replayScript(input: { scope: string; idempotencyKey: string; requestHash: string }): NarrationQualityCommandOutcome<NarrationScriptRevision> | undefined {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.snapshot.kind === "SCRIPT") {
      const script = this.scripts.get(stored.snapshot.id);
      return script ? { kind: "REPLAY", value: toScript(script), status: stored.status } : { kind: "CONFLICT" };
    }
    if (stored.snapshot.kind === "NOT_FOUND" || stored.snapshot.kind === "STATE_INVALID" || stored.snapshot.kind === "INVALID_SAMPLE" || stored.snapshot.kind === "INVALID_TIMELINE") {
      return stored.snapshot;
    }
    return { kind: "CONFLICT" };
  }

  private replayTimeline(input: { scope: string; idempotencyKey: string; requestHash: string }): NarrationQualityCommandOutcome<TimelinePlan> | undefined {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.snapshot.kind === "TIMELINE") {
      const timeline = this.timelines.get(stored.snapshot.id);
      return timeline ? { kind: "REPLAY", value: toTimeline(timeline), status: stored.status } : { kind: "CONFLICT" };
    }
    if (stored.snapshot.kind === "NOT_FOUND" || stored.snapshot.kind === "STATE_INVALID" || stored.snapshot.kind === "INVALID_SAMPLE" || stored.snapshot.kind === "INVALID_TIMELINE") {
      return stored.snapshot;
    }
    return { kind: "CONFLICT" };
  }

  private replayGeneration(input: { scope: string; idempotencyKey: string; requestHash: string }): NarrationQualityCommandOutcome<NarrationAudioGenerationResult> | undefined {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.snapshot.kind === "GENERATION") return { kind: "REPLAY", value: stored.snapshot.value, status: stored.status };
    if (stored.snapshot.kind === "NOT_FOUND" || stored.snapshot.kind === "STATE_INVALID" || stored.snapshot.kind === "INVALID_SAMPLE" || stored.snapshot.kind === "INVALID_TIMELINE") return stored.snapshot;
    return { kind: "CONFLICT" };
  }

  private storeGenerationFailure(input: { scope: string; idempotencyKey: string; requestHash: string }, kind: "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE"): NarrationQualityCommandOutcome<NarrationAudioGenerationResult> {
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind }, status: 202 });
    return { kind };
  }
}

const serializeScriptRow = (row: typeof narrationScriptRevisions.$inferSelect): NarrationScriptRevision => toScript({
  id: row.id,
  workspace_id: row.workspaceId,
  project_id: row.projectId,
  delivery_plan_revision_id: row.deliveryPlanRevisionId,
  status: row.status as NarrationScriptRevision["status"],
  source_script_hash: row.sourceScriptHash,
  display_sections: row.displaySections as NarrationScriptRevision["display_sections"],
  spoken_sections: row.spokenSections as NarrationScriptRevision["spoken_sections"],
  language: "zh-CN",
  normalization_version: row.normalizationVersion,
  decision_reasons: row.decisionReasons,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const serializeAssetVersionRow = (row: typeof narrationAssetVersions.$inferSelect): NarrationAssetVersion => toAssetVersion({
  id: row.id,
  workspace_id: row.workspaceId,
  project_id: row.projectId,
  narration_script_revision_id: row.narrationScriptRevisionId,
  asset_id: row.assetId,
  provider: row.provider,
  voice_id: row.voiceId,
  provider_settings: row.providerSettings as Record<string, unknown>,
  duration_ms: row.durationMs,
  sample_approved: row.sampleApproved,
  word_timestamps_asset_id: row.wordTimestampsAssetId,
  canonical_transcript_check: row.canonicalTranscriptCheck as CanonicalTranscriptCheck,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const serializeTimelineRow = (row: typeof timelinePlans.$inferSelect): TimelinePlan => toTimeline({
  id: row.id,
  workspace_id: row.workspaceId,
  project_id: row.projectId,
  delivery_plan_revision_id: row.deliveryPlanRevisionId,
  narration_script_revision_id: row.narrationScriptRevisionId,
  narration_asset_version_id: row.narrationAssetVersionId,
  effective_duration_ms: row.effectiveDurationMs,
  narration_sections: row.narrationSections as TimelinePlan["narration_sections"],
  visual_segments: row.visualSegments as TimelinePlan["visual_segments"],
  status: row.status as TimelinePlan["status"],
  decision_reasons: row.decisionReasons,
  created_at: row.createdAt,
});

type NarrationTransaction = Pick<PlatformDatabase, "select" | "insert" | "update">;
type NarrationStoredSnapshot =
  | { kind: "SCRIPT"; id: string }
  | { kind: "TIMELINE"; id: string }
  | { kind: "GENERATION"; value: NarrationAudioGenerationResult }
  | { kind: "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE" | "INVALID_TIMELINE" };

const narrationCommandScope = (scope: string, idempotencyKey: string) =>
  and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const reserveNarrationCommand = async (
  transaction: NarrationTransaction,
  input: Pick<NarrationQualityCommandEvent, never> & { scope: string; idempotencyKey: string; requestHash: string },
) => {
  const [inserted] = await transaction.insert(commandDeduplications)
    .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
    .onConflictDoNothing()
    .returning({ scope: commandDeduplications.scope });
  if (inserted) return undefined;
  const [existing] = await transaction.select({
    requestHash: commandDeduplications.requestHash,
    responseSnapshot: commandDeduplications.responseSnapshot,
  }).from(commandDeduplications).where(narrationCommandScope(input.scope, input.idempotencyKey)).limit(1);
  if (!existing || existing.requestHash !== input.requestHash) return "CONFLICT" as const;
  return existing.responseSnapshot as NarrationStoredSnapshot;
};

const storeNarrationSnapshot = async (
  transaction: NarrationTransaction,
  input: { scope: string; idempotencyKey: string },
  snapshot: NarrationStoredSnapshot,
) => {
  await transaction.update(commandDeduplications)
    .set({ responseSnapshot: snapshot })
    .where(narrationCommandScope(input.scope, input.idempotencyKey));
  return snapshot;
};

export class DrizzleNarrationQualityStore implements NarrationQualityStore {
  constructor(private readonly db: PlatformDatabase) {}

  async hasReadyTimelinePlan(workspaceId: string, projectId: string, deliveryPlanRevisionId: string) {
    const [timeline] = await this.db.select().from(timelinePlans).where(and(
      eq(timelinePlans.workspaceId, workspaceId),
      eq(timelinePlans.projectId, projectId),
      eq(timelinePlans.deliveryPlanRevisionId, deliveryPlanRevisionId),
      eq(timelinePlans.status, "READY"),
    )).orderBy(desc(timelinePlans.createdAt)).limit(1);
    if (!timeline) return false;
    const [script] = await this.db.select().from(narrationScriptRevisions).where(and(
      eq(narrationScriptRevisions.workspaceId, workspaceId),
      eq(narrationScriptRevisions.projectId, projectId),
      eq(narrationScriptRevisions.id, timeline.narrationScriptRevisionId),
      eq(narrationScriptRevisions.deliveryPlanRevisionId, deliveryPlanRevisionId),
      eq(narrationScriptRevisions.status, "APPROVED"),
    )).limit(1);
    if (!script) return false;
    const [approvalEvent] = await this.db.select({ payload: outboxEvents.payload }).from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.aggregateType, "narration_plan_revision"),
      eq(outboxEvents.aggregateId, script.id),
      eq(outboxEvents.eventType, "narration_script.approved"),
    )).orderBy(desc(outboxEvents.occurredAt)).limit(1);
    const primarySections = (timeline.narrationSections as Array<{ visual_role?: unknown; narration_asset_version_id?: unknown }>).filter((section) => section.visual_role === "PRIMARY");
    const sectionAssetIds = primarySections
      .map((section) => section.narration_asset_version_id)
      .filter((value): value is string => typeof value === "string");
    if (sectionAssetIds.length > 0) {
      if (timeline.narrationAssetVersionId || sectionAssetIds.length !== primarySections.length
        || new Set(sectionAssetIds).size !== sectionAssetIds.length) return false;
      for (const versionId of sectionAssetIds) {
        const [version] = await this.db.select().from(narrationAssetVersions).where(and(
          eq(narrationAssetVersions.workspaceId, workspaceId),
          eq(narrationAssetVersions.projectId, projectId),
          eq(narrationAssetVersions.id, versionId),
          eq(narrationAssetVersions.narrationScriptRevisionId, script.id),
          eq(narrationAssetVersions.sampleApproved, false),
        )).limit(1);
        if (!version || sampleAssetIdFromApprovalPayload(approvalEvent?.payload) === version.assetId) return false;
        const [asset] = await this.db.select().from(assets).where(and(
          eq(assets.workspaceId, workspaceId),
          eq(assets.projectId, projectId),
          eq(assets.id, version.assetId),
          eq(assets.status, "READY"),
          eq(assets.kind, "AUDIO"),
        )).limit(1);
        if (!asset || !asset.byteSize || asset.byteSize <= 0 || !asset.sha256 || !asset.objectKey || !asset.mimeType?.startsWith("audio/")) return false;
      }
      return true;
    }
    if (!timeline.narrationAssetVersionId) return false;
    const [version] = await this.db.select().from(narrationAssetVersions).where(and(
      eq(narrationAssetVersions.workspaceId, workspaceId),
      eq(narrationAssetVersions.projectId, projectId),
      eq(narrationAssetVersions.id, timeline.narrationAssetVersionId),
      eq(narrationAssetVersions.narrationScriptRevisionId, script.id),
      eq(narrationAssetVersions.sampleApproved, false),
    )).limit(1);
    if (!version || sampleAssetIdFromApprovalPayload(approvalEvent?.payload) === version.assetId) return false;
    const [asset] = await this.db.select().from(assets).where(and(
      eq(assets.workspaceId, workspaceId),
      eq(assets.projectId, projectId),
      eq(assets.id, version.assetId),
      eq(assets.status, "READY"),
      eq(assets.kind, "AUDIO"),
    )).limit(1);
    return Boolean(asset && asset.byteSize && asset.byteSize > 0 && asset.sha256 && asset.objectKey && asset.mimeType?.startsWith("audio/"));
  }

  async listNarrationScriptRevisions(workspaceId: string, deliveryPlanRevisionId: string) {
    const rows = await this.db.select().from(narrationScriptRevisions)
      .where(and(eq(narrationScriptRevisions.workspaceId, workspaceId), eq(narrationScriptRevisions.deliveryPlanRevisionId, deliveryPlanRevisionId)))
      .orderBy(asc(narrationScriptRevisions.createdAt));
    return rows.map(serializeScriptRow);
  }

  async findNarrationScriptRevision(workspaceId: string, narrationScriptRevisionId: string) {
    const [row] = await this.db.select().from(narrationScriptRevisions)
      .where(and(eq(narrationScriptRevisions.workspaceId, workspaceId), eq(narrationScriptRevisions.id, narrationScriptRevisionId)))
      .limit(1);
    return row ? serializeScriptRow(row) : undefined;
  }

  async createNarrationScriptRevision(input: Parameters<NarrationQualityStore["createNarrationScriptRevision"]>[0]) {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveNarrationCommand(transaction, input);
      if (reservation) return this.replayScript(transaction, input.workspaceId, reservation, 201);
      const [delivery] = await transaction.select().from(deliveryPlanRevisions)
        .where(and(eq(deliveryPlanRevisions.workspaceId, input.workspaceId), eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId))).limit(1);
      if (!delivery) return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "NOT_FOUND" });
      const normalized = normalizeNarrationSections({
        sections: input.command.display_sections,
        glossary: new Map(input.command.pronunciation_glossary.map((guide) => [guide.source, guide.spoken])),
      });
      const timestamp = now();
      const value = toScript({
        id: createPrefixedId("nsr"),
        workspace_id: input.workspaceId,
        project_id: delivery.projectId,
        delivery_plan_revision_id: input.deliveryPlanRevisionId,
        status: normalized.status,
        source_script_hash: normalized.sourceScriptHash,
        display_sections: normalized.displaySections,
        spoken_sections: normalized.spokenSections,
        language: "zh-CN",
        normalization_version: input.command.normalization_version,
        decision_reasons: normalized.decisionReasons,
        created_at: timestamp,
        updated_at: timestamp,
      });
      await transaction.insert(narrationScriptRevisions).values({
        id: value.id,
        workspaceId: value.workspace_id,
        projectId: value.project_id,
        deliveryPlanRevisionId: value.delivery_plan_revision_id,
        status: value.status,
        sourceScriptHash: value.source_script_hash,
        displaySections: value.display_sections,
        spokenSections: value.spoken_sections,
        language: value.language,
        normalizationVersion: value.normalization_version,
        decisionReasons: value.decision_reasons,
        createdAt: value.created_at,
        updatedAt: value.updated_at,
      });
      await transaction.insert(outboxEvents).values({
        id: input.event.eventId,
        workspaceId: value.workspace_id,
        projectId: value.project_id,
        aggregateType: "narration_plan_revision",
        aggregateId: value.id,
        eventType: "narration_script.normalized",
        payload: eventEnvelope({
          event: input.event,
          idempotencyKey: input.idempotencyKey,
          workspaceId: value.workspace_id,
          projectId: value.project_id,
          aggregateType: "narration_plan_revision",
          aggregateId: value.id,
          eventType: "narration_script.normalized",
          data: {
            narration_script_revision_id: value.id,
            delivery_plan_revision_id: value.delivery_plan_revision_id,
            status: value.status,
            decision_reasons: value.decision_reasons,
          },
        }),
        occurredAt: value.created_at,
        availableAt: value.created_at,
      });
      await storeNarrationSnapshot(transaction, input, { kind: "SCRIPT", id: value.id });
      return { kind: "NEW", value, status: 201 } as const;
    });
  }

  async approveNarrationScriptRevision(
    input: Parameters<NarrationQualityStore["approveNarrationScriptRevision"]>[0],
  ): Promise<NarrationQualityCommandOutcome<NarrationScriptRevision>> {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveNarrationCommand(transaction, input);
      if (reservation) return this.replayScript(transaction, input.workspaceId, reservation, 202);
      const [scriptRow] = await transaction.select().from(narrationScriptRevisions)
        .where(and(eq(narrationScriptRevisions.workspaceId, input.workspaceId), eq(narrationScriptRevisions.id, input.narrationScriptRevisionId)))
        .limit(1)
        .for("update");
      if (!scriptRow) return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "NOT_FOUND" });
      if (scriptRow.status !== "NORMALIZED" || scriptRow.sourceScriptHash !== input.command.canonical_script_hash) {
        return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "STATE_INVALID" });
      }
      const [sample] = await transaction.select({
        projectId: assets.projectId,
        kind: assets.kind,
        status: assets.status,
        durationMs: assets.durationMs,
        origin: assets.origin,
        metadata: assets.metadata,
      }).from(assets).where(and(
        eq(assets.workspaceId, input.workspaceId),
        eq(assets.projectId, scriptRow.projectId),
        eq(assets.id, input.command.sample_asset_id),
      )).limit(1);
      if (!sample || sample.kind !== "AUDIO" || sample.status !== "READY") {
        return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "INVALID_SAMPLE" });
      }
      const generation = sample.metadata?.narration_generation;
      const generationFacts = generation && typeof generation === "object" && !Array.isArray(generation)
        ? generation as Record<string, unknown>
        : undefined;
      const generationSettings = NarrationAudioProviderSettingsSchema.safeParse(generationFacts?.provider_settings);
      if (sample.origin !== "GENERATED"
        || generationFacts?.generation_kind !== "SAMPLE"
        || generationFacts.provider !== input.command.sample_provider
        || generationFacts.voice_id !== input.command.sample_voice_id
        || generationFacts.canonical_script_hash !== input.command.canonical_script_hash
        || !generationSettings.success
        || JSON.stringify(generationSettings.data) !== JSON.stringify(input.command.sample_provider_settings)) {
        return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "INVALID_SAMPLE" });
      }
      if (typeof sample.durationMs !== "number" || !durationsMatch(sample.durationMs, input.command.sample_duration_ms)) {
        return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "INVALID_SAMPLE" });
      }
      if (input.command.word_timestamps_asset_id) {
        const [timestamps] = await transaction.select({
          projectId: assets.projectId,
          kind: assets.kind,
          status: assets.status,
        }).from(assets).where(and(
          eq(assets.workspaceId, input.workspaceId),
          eq(assets.projectId, scriptRow.projectId),
          eq(assets.id, input.command.word_timestamps_asset_id),
        )).limit(1);
        if (!timestamps || timestamps.kind !== "DOCUMENT" || timestamps.status !== "READY") {
          return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "INVALID_SAMPLE" });
        }
      }
      assertNarrationRevisionTransition(scriptRow.status, "APPROVED");
      const timestamp = now();
      // The sample is an approval input only.  Do not insert it into
      // narration_asset_versions or emit a ready event: that event is
      // reserved for a measured full narration asset produced by the
      // dedicated formal-asset path.
      const [updatedRow] = await transaction.update(narrationScriptRevisions)
        .set({ status: "APPROVED", updatedAt: timestamp })
        .where(and(
          eq(narrationScriptRevisions.workspaceId, input.workspaceId),
          eq(narrationScriptRevisions.id, scriptRow.id),
          eq(narrationScriptRevisions.status, "NORMALIZED"),
        ))
        .returning();
      if (!updatedRow) return this.storeFailure<NarrationScriptRevision>(transaction, input, { kind: "STATE_INVALID" });
      const approved = serializeScriptRow(updatedRow);
      const approvedEvent = eventEnvelope({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: approved.workspace_id,
        projectId: approved.project_id,
        aggregateType: "narration_plan_revision",
        aggregateId: approved.id,
        eventType: "narration_script.approved",
        data: {
          narration_script_revision_id: approved.id,
          sample_asset_id: input.command.sample_asset_id,
          canonical_script_hash: approved.source_script_hash,
          status: "APPROVED",
        },
      });
      await transaction.insert(outboxEvents).values({
        id: approvedEvent.event_id,
        workspaceId: approved.workspace_id,
        projectId: approved.project_id,
        aggregateType: "narration_plan_revision",
        aggregateId: approved.id,
        eventType: "narration_script.approved",
        payload: approvedEvent,
        occurredAt: approvedEvent.occurred_at,
        availableAt: approvedEvent.occurred_at,
      });
      await storeNarrationSnapshot(transaction, input, { kind: "SCRIPT", id: approved.id });
      return { kind: "NEW", value: approved, status: 202 } as const;
    });
  }

  async requestNarrationAudioGeneration(input: Parameters<NarrationQualityStore["requestNarrationAudioGeneration"]>[0]) {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveNarrationCommand(transaction, input);
      if (reservation) return this.replayGeneration(transaction, input.workspaceId, reservation);
      const command = RequestNarrationAudioGenerationCommandSchema.parse(input.command);
      const [scriptRow] = await transaction.select().from(narrationScriptRevisions).where(and(
        eq(narrationScriptRevisions.workspaceId, input.workspaceId),
        eq(narrationScriptRevisions.id, input.narrationScriptRevisionId),
      )).limit(1).for("update");
      if (!scriptRow || scriptRow.sourceScriptHash !== command.canonical_script_hash) return this.storeFailure<NarrationAudioGenerationResult>(transaction, input, { kind: "NOT_FOUND" });
      const spokenSections = scriptRow.spokenSections as NarrationScriptRevision["spoken_sections"];
      const expectedStatus = command.generation_kind === "SAMPLE" ? "NORMALIZED" : "APPROVED";
      if (scriptRow.status !== expectedStatus || !spokenSections.some((section) => section.id === command.section_id)) {
        return this.storeFailure<NarrationAudioGenerationResult>(transaction, input, { kind: "STATE_INVALID" });
      }
      const versionId = command.generation_kind === "FORMAL"
        ? input.narrationAssetVersionId ?? createPrefixedId("nav")
        : undefined;
      if (command.generation_kind === "FORMAL") {
        const [approvalEvent] = await transaction.select({ payload: outboxEvents.payload }).from(outboxEvents).where(and(
          eq(outboxEvents.workspaceId, input.workspaceId),
          eq(outboxEvents.projectId, scriptRow.projectId),
          eq(outboxEvents.aggregateType, "narration_plan_revision"),
          eq(outboxEvents.aggregateId, scriptRow.id),
          eq(outboxEvents.eventType, "narration_script.approved"),
        )).orderBy(desc(outboxEvents.occurredAt)).limit(1);
        if (!approvalEvent || sampleAssetIdFromApprovalPayload(approvalEvent.payload) !== command.sample_asset_id) return this.storeFailure<NarrationAudioGenerationResult>(transaction, input, { kind: "INVALID_SAMPLE" });
        const [sample] = await transaction.select({ projectId: assets.projectId, kind: assets.kind, status: assets.status }).from(assets).where(and(
          eq(assets.workspaceId, input.workspaceId),
          eq(assets.projectId, scriptRow.projectId),
          eq(assets.id, command.sample_asset_id!),
        )).limit(1);
        if (!sample || sample.kind !== "AUDIO" || sample.status !== "READY") return this.storeFailure<NarrationAudioGenerationResult>(transaction, input, { kind: "INVALID_SAMPLE" });
      }
      const providerSettings = NarrationAudioProviderSettingsSchema.parse(command.provider_settings);
      if (!input.objectKey.startsWith(`${input.workspaceId}/${scriptRow.projectId}/${input.assetId}/`)) return this.storeFailure<NarrationAudioGenerationResult>(transaction, input, { kind: "STATE_INVALID" });
      const requestedEvent = eventEnvelope({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        projectId: scriptRow.projectId,
        aggregateType: "narration_plan_revision",
        aggregateId: scriptRow.id,
        eventType: "narration_audio.generation_requested",
        data: {
          narration_script_revision_id: scriptRow.id,
          generation_kind: command.generation_kind,
          section_id: command.section_id,
          asset_id: input.assetId,
          ...(versionId ? { narration_asset_version_id: versionId } : {}),
          ...(command.sample_asset_id ? { sample_asset_id: command.sample_asset_id } : {}),
          provider: command.provider,
          voice_id: command.voice_id,
          provider_settings: providerSettings,
          canonical_script_hash: scriptRow.sourceScriptHash,
          object_key: input.objectKey,
        },
      });
      await transaction.insert(outboxEvents).values({
        id: requestedEvent.event_id,
        workspaceId: requestedEvent.workspace_id,
        projectId: requestedEvent.project_id,
        aggregateType: "narration_plan_revision",
        aggregateId: scriptRow.id,
        eventType: requestedEvent.event_type,
        payload: requestedEvent,
        occurredAt: requestedEvent.occurred_at,
        availableAt: requestedEvent.occurred_at,
      });
      const value: NarrationAudioGenerationResult = {
        event_id: requestedEvent.event_id,
        asset_id: input.assetId,
        ...(versionId ? { narration_asset_version_id: versionId } : {}),
        generation_kind: command.generation_kind,
        object_key: input.objectKey,
        status: "QUEUED",
      };
      await storeNarrationSnapshot(transaction, input, { kind: "GENERATION", value });
      return { kind: "NEW", value, status: 202 } as const;
    });
  }

  async findNarrationAudioGenerationInput(input: { event: NarrationAudioGenerationEvent }) {
    const event = input.event;
    const [scriptRow] = await this.db.select().from(narrationScriptRevisions).where(and(
      eq(narrationScriptRevisions.workspaceId, event.workspace_id),
      eq(narrationScriptRevisions.projectId, event.project_id),
      eq(narrationScriptRevisions.id, event.data.narration_script_revision_id),
    )).limit(1);
    if (!scriptRow || scriptRow.sourceScriptHash !== event.data.canonical_script_hash) return undefined;
    const section = (scriptRow.spokenSections as NarrationScriptRevision["spoken_sections"]).find((candidate) => candidate.id === event.data.section_id);
    if (!section) return undefined;
    if (event.data.generation_kind === "SAMPLE" && scriptRow.status !== "NORMALIZED") return undefined;
    if (event.data.generation_kind === "FORMAL" && scriptRow.status !== "APPROVED") return undefined;
    if (event.data.generation_kind === "FORMAL") {
      const [approvalEvent] = await this.db.select({ payload: outboxEvents.payload }).from(outboxEvents).where(and(
        eq(outboxEvents.workspaceId, event.workspace_id),
        eq(outboxEvents.projectId, event.project_id),
        eq(outboxEvents.aggregateType, "narration_plan_revision"),
        eq(outboxEvents.aggregateId, scriptRow.id),
        eq(outboxEvents.eventType, "narration_script.approved"),
      )).orderBy(desc(outboxEvents.occurredAt)).limit(1);
      if (!approvalEvent || sampleAssetIdFromApprovalPayload(approvalEvent.payload) !== event.data.sample_asset_id) return undefined;
    }
    return {
      event,
      workspaceId: event.workspace_id,
      projectId: event.project_id,
      narrationScriptRevisionId: scriptRow.id,
      sectionId: section.id,
      scriptText: section.provider_text,
      provider: event.data.provider,
      voiceId: event.data.voice_id,
      providerSettings: event.data.provider_settings,
      generationKind: event.data.generation_kind,
      assetId: event.data.asset_id,
      ...(event.data.narration_asset_version_id ? { narrationAssetVersionId: event.data.narration_asset_version_id } : {}),
      ...(event.data.sample_asset_id ? { sampleAssetId: event.data.sample_asset_id } : {}),
      objectKey: event.data.object_key,
    } satisfies NarrationAudioGenerationInput;
  }

  async ensureGeneratedNarrationAsset(input: { event: NarrationAudioGenerationEvent }) {
    const event = input.event;
    if (!event.data.object_key.startsWith(`${event.workspace_id}/${event.project_id}/${event.data.asset_id}/`)) throw new Error("Generated audio object key is outside the asset scope.");
    const metadata = {
      narration_generation: {
        event_id: event.event_id,
        narration_script_revision_id: event.data.narration_script_revision_id,
        generation_kind: event.data.generation_kind,
        section_id: event.data.section_id,
        provider: event.data.provider,
        voice_id: event.data.voice_id,
        provider_settings: event.data.provider_settings,
        canonical_script_hash: event.data.canonical_script_hash,
        ...(event.data.sample_asset_id ? { sample_asset_id: event.data.sample_asset_id } : {}),
      },
    };
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(assets).where(and(
        eq(assets.workspaceId, event.workspace_id),
        eq(assets.projectId, event.project_id),
        eq(assets.id, event.data.asset_id),
      )).limit(1);
      if (existing) {
        if (existing.kind !== "AUDIO" || existing.origin !== "GENERATED" || existing.objectKey !== event.data.object_key || !generatedNarrationIdentityMatches(existing.metadata, event)) throw new Error("Generated narration asset identity conflicts with the generation request.");
        return {
          workspaceId: existing.workspaceId,
          projectId: existing.projectId,
          assetId: existing.id,
          objectKey: existing.objectKey,
          status: existing.status === "READY" ? "READY" : "PENDING_UPLOAD",
          ...(existing.sha256 ? { sha256: existing.sha256 } : {}),
          ...(existing.mimeType ? { mimeType: existing.mimeType } : {}),
          ...(existing.byteSize ? { byteSize: existing.byteSize } : {}),
          ...(existing.durationMs ? { durationMs: existing.durationMs } : {}),
        } satisfies NarrationGeneratedAssetState;
      }
      await transaction.insert(assets).values({
        id: event.data.asset_id,
        workspaceId: event.workspace_id,
        projectId: event.project_id,
        kind: "AUDIO",
        origin: "GENERATED",
        status: "PENDING_UPLOAD",
        objectKey: event.data.object_key,
        metadata,
      });
      const [created] = await transaction.select().from(assets).where(and(eq(assets.workspaceId, event.workspace_id), eq(assets.id, event.data.asset_id))).limit(1);
      return created ? {
        workspaceId: created.workspaceId,
        projectId: created.projectId,
        assetId: created.id,
        objectKey: created.objectKey,
        status: created.status === "READY" ? "READY" : "PENDING_UPLOAD",
        ...(created.sha256 ? { sha256: created.sha256 } : {}),
        ...(created.mimeType ? { mimeType: created.mimeType } : {}),
        ...(created.byteSize ? { byteSize: created.byteSize } : {}),
        ...(created.durationMs ? { durationMs: created.durationMs } : {}),
      } satisfies NarrationGeneratedAssetState : undefined;
    });
  }

  async completeNarrationAudioGeneration(input: { event: NarrationAudioGenerationEvent; facts: NarrationAudioMeasuredFacts }) {
    const event = input.event;
    if (!/^[a-f0-9]{64}$/u.test(input.facts.sha256) || input.facts.byteSize < 1 || input.facts.durationMs < 1 || !isMeasuredNarrationMimeType(input.facts.mimeType)) throw new Error("Measured generated narration facts are invalid.");
    return this.db.transaction(async (transaction) => {
      const [asset] = await transaction.select().from(assets).where(and(eq(assets.workspaceId, event.workspace_id), eq(assets.projectId, event.project_id), eq(assets.id, event.data.asset_id))).limit(1);
      if (!asset || asset.kind !== "AUDIO" || asset.origin !== "GENERATED") return undefined;
      if (asset.objectKey !== event.data.object_key || !generatedNarrationIdentityMatches(asset.metadata, event)) throw new Error("Generated narration asset identity conflicts with the generation request.");
      if (asset.status === "READY") {
        if (asset.sha256 !== input.facts.sha256 || asset.mimeType !== input.facts.mimeType || asset.byteSize !== input.facts.byteSize || asset.durationMs !== input.facts.durationMs) throw new Error("Generated narration facts conflict with the persisted asset.");
      } else {
        if (asset.status !== "PENDING_UPLOAD") throw new Error("Generated narration asset is not pending completion.");
        await transaction.update(assets).set({ status: "READY", sha256: input.facts.sha256, mimeType: input.facts.mimeType, byteSize: input.facts.byteSize, durationMs: input.facts.durationMs, updatedAt: now() }).where(and(eq(assets.workspaceId, event.workspace_id), eq(assets.projectId, event.project_id), eq(assets.id, event.data.asset_id)));
      }
      if (event.data.generation_kind !== "FORMAL" || !event.data.narration_asset_version_id) return undefined;
      const [existing] = await transaction.select().from(narrationAssetVersions).where(and(eq(narrationAssetVersions.workspaceId, event.workspace_id), eq(narrationAssetVersions.projectId, event.project_id), eq(narrationAssetVersions.id, event.data.narration_asset_version_id))).limit(1);
      if (existing) {
        if (existing.assetId !== event.data.asset_id
          || existing.narrationScriptRevisionId !== event.data.narration_script_revision_id
          || existing.provider !== event.data.provider
          || existing.voiceId !== event.data.voice_id
          || JSON.stringify(existing.providerSettings) !== JSON.stringify(event.data.provider_settings)
          || existing.durationMs !== input.facts.durationMs
          || existing.sampleApproved !== false) throw new Error("Narration asset version facts conflict with the generation request.");
        return serializeAssetVersionRow(existing);
      }
      const timestamp = now();
      const value = toAssetVersion({
        id: event.data.narration_asset_version_id,
        workspace_id: event.workspace_id,
        project_id: event.project_id,
        narration_script_revision_id: event.data.narration_script_revision_id,
        asset_id: event.data.asset_id,
        provider: event.data.provider,
        voice_id: event.data.voice_id,
        provider_settings: event.data.provider_settings,
        duration_ms: input.facts.durationMs,
        sample_approved: false,
        word_timestamps_asset_id: null,
        canonical_transcript_check: unavailableCanonicalTranscriptCheck(),
        created_at: timestamp,
        updated_at: timestamp,
      });
      await transaction.insert(narrationAssetVersions).values({
        id: value.id,
        workspaceId: value.workspace_id,
        projectId: value.project_id,
        narrationScriptRevisionId: value.narration_script_revision_id,
        assetId: value.asset_id,
        provider: value.provider,
        voiceId: value.voice_id,
        providerSettings: value.provider_settings,
        durationMs: value.duration_ms,
        sampleApproved: false,
        wordTimestampsAssetId: null,
        canonicalTranscriptCheck: value.canonical_transcript_check,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const readyEvent = eventEnvelope({
        event: { eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: event.trace_id, correlationId: event.correlation_id },
        idempotencyKey: `${event.idempotency_key}:ready`,
        workspaceId: event.workspace_id,
        projectId: event.project_id,
        aggregateType: "narration_plan_revision",
        aggregateId: event.data.narration_script_revision_id,
        eventType: "narration_asset_version.ready",
        producer: "media-runtime-worker",
        data: {
          narration_asset_version_id: value.id,
          narration_script_revision_id: value.narration_script_revision_id,
          asset_id: value.asset_id,
          duration_ms: value.duration_ms,
          sample_approved: false,
        },
      });
      await transaction.insert(outboxEvents).values({
        id: readyEvent.event_id,
        workspaceId: event.workspace_id,
        projectId: event.project_id,
        aggregateType: "narration_plan_revision",
        aggregateId: event.data.narration_script_revision_id,
        eventType: readyEvent.event_type,
        payload: readyEvent,
        occurredAt: readyEvent.occurred_at,
        availableAt: readyEvent.occurred_at,
      });
      return value;
    });
  }

  async createTimelinePlan(
    input: Parameters<NarrationQualityStore["createTimelinePlan"]>[0],
  ): Promise<NarrationQualityCommandOutcome<TimelinePlan>> {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveNarrationCommand(transaction, input);
      if (reservation) return this.replayTimeline(transaction, input.workspaceId, reservation);
      const [scriptRow] = await transaction.select().from(narrationScriptRevisions)
        .where(and(eq(narrationScriptRevisions.workspaceId, input.workspaceId), eq(narrationScriptRevisions.id, input.narrationScriptRevisionId)))
        .limit(1);
      if (!scriptRow || scriptRow.status !== "APPROVED") {
        return this.storeFailure<TimelinePlan>(transaction, input, { kind: "STATE_INVALID" });
      }
      const expectedIds = (scriptRow.spokenSections as NarrationScriptRevision["spoken_sections"]).map((section) => section.id);
      if (input.command.section_durations_ms.length !== expectedIds.length || input.command.section_durations_ms.some((section, index) => section.section_id !== expectedIds[index])) {
        return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
      }
      const sectionAssetIds = input.command.section_durations_ms
        .map((section) => section.narration_asset_version_id)
        .filter((value): value is string => typeof value === "string");
      const hasSectionAssets = sectionAssetIds.length > 0;
      if (hasSectionAssets && (sectionAssetIds.length !== input.command.section_durations_ms.length
        || input.command.narration_asset_version_id
        || new Set(sectionAssetIds).size !== sectionAssetIds.length)) {
        return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
      }
      if (!hasSectionAssets && !input.command.narration_asset_version_id) {
        return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
      }
      const measuredAsset = input.command.narration_asset_version_id
        ? (await transaction.select().from(narrationAssetVersions).where(and(
          eq(narrationAssetVersions.workspaceId, input.workspaceId),
          eq(narrationAssetVersions.projectId, scriptRow.projectId),
          eq(narrationAssetVersions.id, input.command.narration_asset_version_id),
          eq(narrationAssetVersions.narrationScriptRevisionId, scriptRow.id),
          eq(narrationAssetVersions.sampleApproved, false),
        )).orderBy(asc(narrationAssetVersions.createdAt)).limit(1))[0]
        : undefined;
      if (!hasSectionAssets && !measuredAsset) return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
      const [approvalEvent] = await transaction.select({ payload: outboxEvents.payload }).from(outboxEvents).where(and(
        eq(outboxEvents.workspaceId, input.workspaceId),
        eq(outboxEvents.projectId, scriptRow.projectId),
        eq(outboxEvents.aggregateType, "narration_plan_revision"),
        eq(outboxEvents.aggregateId, scriptRow.id),
        eq(outboxEvents.eventType, "narration_script.approved"),
      )).orderBy(desc(outboxEvents.occurredAt)).limit(1);
      if (measuredAsset && sampleAssetIdFromApprovalPayload(approvalEvent?.payload) === measuredAsset.assetId) {
        return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
      }
      if (hasSectionAssets) {
        for (const section of input.command.section_durations_ms) {
          const versionId = section.narration_asset_version_id;
          const [sectionVersion] = await transaction.select().from(narrationAssetVersions).where(and(
            eq(narrationAssetVersions.workspaceId, input.workspaceId),
            eq(narrationAssetVersions.projectId, scriptRow.projectId),
            eq(narrationAssetVersions.id, versionId!),
            eq(narrationAssetVersions.narrationScriptRevisionId, scriptRow.id),
            eq(narrationAssetVersions.sampleApproved, false),
          )).limit(1);
          if (!sectionVersion
            || sampleAssetIdFromApprovalPayload(approvalEvent?.payload) === sectionVersion.assetId
            || !durationsMatch(sectionVersion.durationMs, section.duration_ms)
            || Math.abs(sectionVersion.durationMs - section.duration_ms) > Math.max(1, Math.round(section.duration_ms * 0.15))) {
            return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
          }
          const [formalAsset] = await transaction.select({
            projectId: assets.projectId,
            kind: assets.kind,
            status: assets.status,
            durationMs: assets.durationMs,
          }).from(assets).where(and(
            eq(assets.workspaceId, input.workspaceId),
            eq(assets.projectId, scriptRow.projectId),
            eq(assets.id, sectionVersion.assetId),
          )).limit(1);
          if (!formalAsset || formalAsset.kind !== "AUDIO" || formalAsset.status !== "READY"
            || (typeof formalAsset.durationMs === "number" && !durationsMatch(formalAsset.durationMs, sectionVersion.durationMs))) {
            return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
          }
        }
      } else if (measuredAsset) {
        const [formalAsset] = await transaction.select({
          projectId: assets.projectId,
          kind: assets.kind,
          status: assets.status,
          durationMs: assets.durationMs,
        }).from(assets).where(and(
          eq(assets.workspaceId, input.workspaceId),
          eq(assets.projectId, scriptRow.projectId),
          eq(assets.id, measuredAsset.assetId),
        )).limit(1);
        if (!formalAsset || formalAsset.kind !== "AUDIO" || formalAsset.status !== "READY"
          || (typeof formalAsset.durationMs === "number" && !durationsMatch(formalAsset.durationMs, measuredAsset.durationMs))) {
          return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
        }
        if (!durationsMatch(sectionDurationTotal(input.command.section_durations_ms), measuredAsset.durationMs)) {
          return this.storeFailure<TimelinePlan>(transaction, input, { kind: "INVALID_TIMELINE" });
        }
      }
      const [delivery] = await transaction.select({ targetDurationSeconds: deliveryPlanRevisions.targetDurationSeconds })
        .from(deliveryPlanRevisions)
        .where(and(
          eq(deliveryPlanRevisions.workspaceId, input.workspaceId),
          eq(deliveryPlanRevisions.projectId, scriptRow.projectId),
          eq(deliveryPlanRevisions.id, scriptRow.deliveryPlanRevisionId),
        ))
        .limit(1);
      if (!delivery) return this.storeFailure<TimelinePlan>(transaction, input, { kind: "NOT_FOUND" });
      const compiled = buildNarrationTimeline({
        sectionDurationsMs: input.command.section_durations_ms.map((section) => ({ sectionId: section.section_id, durationMs: section.duration_ms, ...(section.narration_asset_version_id ? { narrationAssetVersionId: section.narration_asset_version_id } : {}) })),
        targetDurationMs: input.command.target_duration_ms || delivery.targetDurationSeconds * 1000,
        flexiblePercent: input.command.flexible_percent,
        maxProviderDurationSeconds: input.command.max_provider_duration_seconds,
      });
      const value = toTimeline({
        id: createPrefixedId("tlp"),
        workspace_id: scriptRow.workspaceId,
        project_id: scriptRow.projectId,
        delivery_plan_revision_id: scriptRow.deliveryPlanRevisionId,
        narration_script_revision_id: scriptRow.id,
        narration_asset_version_id: measuredAsset?.id ?? null,
        effective_duration_ms: compiled.effectiveDurationMs,
        narration_sections: compiled.narrationSections,
        visual_segments: compiled.visualSegments,
        status: compiled.status,
        decision_reasons: compiled.decisionReasons,
        created_at: now(),
      });
      await transaction.insert(timelinePlans).values({
        id: value.id,
        workspaceId: value.workspace_id,
        projectId: value.project_id,
        deliveryPlanRevisionId: value.delivery_plan_revision_id,
        narrationScriptRevisionId: value.narration_script_revision_id,
        narrationAssetVersionId: value.narration_asset_version_id,
        effectiveDurationMs: value.effective_duration_ms,
        narrationSections: value.narration_sections,
        visualSegments: value.visual_segments,
        status: value.status,
        decisionReasons: value.decision_reasons,
        createdAt: value.created_at,
      });
      const createdEvent = eventEnvelope({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: value.workspace_id,
        projectId: value.project_id,
        aggregateType: "timeline_plan",
        aggregateId: value.id,
        eventType: "timeline_plan.created",
        data: {
          timeline_plan_id: value.id,
          narration_script_revision_id: value.narration_script_revision_id,
          delivery_plan_revision_id: value.delivery_plan_revision_id,
          status: value.status,
          effective_duration_ms: value.effective_duration_ms,
        },
      });
      await transaction.insert(outboxEvents).values({
        id: createdEvent.event_id,
        workspaceId: value.workspace_id,
        projectId: value.project_id,
        aggregateType: "timeline_plan",
        aggregateId: value.id,
        eventType: "timeline_plan.created",
        payload: createdEvent,
        occurredAt: createdEvent.occurred_at,
        availableAt: createdEvent.occurred_at,
      });
      await storeNarrationSnapshot(transaction, input, { kind: "TIMELINE", id: value.id });
      return { kind: "NEW", value, status: 201 } as const;
    });
  }

  private async storeFailure<T>(
    transaction: NarrationTransaction,
    input: { scope: string; idempotencyKey: string },
    snapshot: Extract<NarrationStoredSnapshot, { kind: "NOT_FOUND" | "STATE_INVALID" | "INVALID_SAMPLE" | "INVALID_TIMELINE" }>,
  ): Promise<NarrationQualityCommandOutcome<T>> {
    await storeNarrationSnapshot(transaction, input, snapshot);
    return { kind: snapshot.kind };
  }

  private async replayScript(
    transaction: Pick<PlatformDatabase, "select">,
    workspaceId: string,
    snapshot: NarrationStoredSnapshot | "CONFLICT",
    status: 201 | 202,
  ): Promise<NarrationQualityCommandOutcome<NarrationScriptRevision>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "SCRIPT") {
      const [row] = await transaction.select().from(narrationScriptRevisions)
        .where(and(eq(narrationScriptRevisions.workspaceId, workspaceId), eq(narrationScriptRevisions.id, snapshot.id)))
        .limit(1);
      return row ? { kind: "REPLAY", value: serializeScriptRow(row), status } : { kind: "CONFLICT" };
    }
    if (snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID" || snapshot.kind === "INVALID_SAMPLE" || snapshot.kind === "INVALID_TIMELINE") {
      return snapshot;
    }
    return { kind: "CONFLICT" };
  }

  private async replayTimeline(
    transaction: Pick<PlatformDatabase, "select">,
    workspaceId: string,
    snapshot: NarrationStoredSnapshot | "CONFLICT",
  ): Promise<NarrationQualityCommandOutcome<TimelinePlan>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "TIMELINE") {
      const [row] = await transaction.select().from(timelinePlans)
        .where(and(eq(timelinePlans.workspaceId, workspaceId), eq(timelinePlans.id, snapshot.id)))
        .limit(1);
      return row ? { kind: "REPLAY", value: serializeTimelineRow(row), status: 201 } : { kind: "CONFLICT" };
    }
    if (snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID" || snapshot.kind === "INVALID_SAMPLE" || snapshot.kind === "INVALID_TIMELINE") {
      return snapshot;
    }
    return { kind: "CONFLICT" };
  }

  private async replayGeneration(
    transaction: Pick<PlatformDatabase, "select">,
    workspaceId: string,
    snapshot: NarrationStoredSnapshot | "CONFLICT",
  ): Promise<NarrationQualityCommandOutcome<NarrationAudioGenerationResult>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "GENERATION") return { kind: "REPLAY", value: snapshot.value, status: 202 };
    if (snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID" || snapshot.kind === "INVALID_SAMPLE" || snapshot.kind === "INVALID_TIMELINE") return snapshot;
    return { kind: "CONFLICT" };
  }
}
