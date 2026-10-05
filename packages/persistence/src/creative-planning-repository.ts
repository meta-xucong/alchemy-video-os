import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  InternalCreativePlanningQueueMessageSchema,
  InternalEventEnvelopeSchema,
  type ContinuityLevel,
  type CanonicalReferenceSource,
  type CanonicalVisualEntityContext,
  type SemanticVisualEntityCandidate,
  type CreativeBriefTargetResolution,
  type CreativeRevisionStatus,
  type DeliveryPlanRevisionId,
  type GenerationSegmentMotionPlan,
  type InternalEventEnvelope,
  type InternalCreativePlanningQueueMessage,
  type KeyVisualObjectLock,
  type ProductionRunStatus,
  type ReferencePolicy,
  type MusicPlan,
  type ProductionRunAudioSelection,
  type CreativeBriefFactContext,
  type FrozenDocumentFact,
  type VideoGenerationInputSnapshot,
  SemanticDialogueProjectionSchema,
  SemanticEntityReferenceProjectionSchema,
  SemanticNarrativeBeatProjectionSchema,
  SemanticReferenceProjectionSchema,
  SemanticVisualEntityCandidateSchema,
  VideoAudioOwnerSchema,
  type SemanticDialogueProjection,
  type SemanticEntityReferenceProjection,
  type FixedVideoBillingPolicySnapshot,
  semanticPromptPackageIntegrityPayload,
  parseG02ApprovedBeatMarkers,
  findExactEntityAnchor,
  hasExactEntityNameMention,
} from "@alchemy-video/contracts";
import {
  assertCreativeRevisionTransition,
  assertDeliveryPlanCanCreateProductionRun,
  assertProductionRunCreatable,
  assertProductionRunTransition,
  assertStoryboardPlan,
  canonicalJson,
  createPrefixedId,
  type StoryboardDurationPolicy,
} from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import { findApprovedNarrationTimeline, freezeDoubaoAudioSourceIdentity } from "./approved-narration-timeline.js";
import {
  assets,
  commandDeduplications,
  creativeBriefDocumentContexts,
  creativeBriefFactContexts,
  creativeBriefRevisions,
  documentKnowledgeRevisions,
  documentConversions,
  documents,
  deliveryPlanRevisions,
  eventConsumptions,
  outboxEvents,
  promptPackages,
  productionRuns,
  projects,
  scriptRevisions,
  storyboardRevisions,
  storyboardShotSpecs,
  canonicalVisualEntities,
  canonicalVisualEntityRevisionAssets,
  canonicalVisualEntityRevisions,
} from "./schema.js";

export type CreativePlanningEvent = {
  eventId: string;
  messageId: string;
  traceId: string;
  correlationId: string;
};

export const MAX_DOCUMENT_CONTEXTS_PER_BRIEF = 4;
export const MAX_DOCUMENT_CONTEXT_CHARACTERS = 5_000;
export const MAX_DOCUMENT_CONTEXT_TOTAL_CHARACTERS = 18_000;


export type ControlPlanningDocumentContext = {
  documentId: string;
  conversionId: string;
  sourceAssetId: string;
  markdownAssetId: string;
  markdownSha256: string;
  markdownObjectKey: string;
  sequence: number;
  maxContentCharacters: number;
};

export type PlanningDocumentContextResolver = {
  resolveDocumentContexts(input: { workspaceId: string; projectId: string; sourceAssetIds: string[] }): Promise<ControlPlanningDocumentContext[] | undefined>;
};
export type PlanningFactContextResolver = {
  resolveFactContexts(input: { workspaceId: string; projectId: string; creativeBriefRevisionId: string; sourceAssetIds: string[]; sourceText: string; stylePreferences: string }): Promise<CreativeBriefFactContext[] | undefined>;
};

export type ControlCreativeBriefSourceAssetRole = {
  assetId: string;
  role: NonNullable<CanonicalReferenceSource["provider_role"]>;
  usage?: string;
};

export type ControlCreativeBriefRevision = {
  id: string;
  workspaceId: string;
  projectId: string;
  revision: number;
  sourceText: string;
  targetDurationSeconds: number;
  targetResolution: CreativeBriefTargetResolution;
  stylePreferences: string;
  sourceAssetIds: string[];
  sourceAssetRoles?: ControlCreativeBriefSourceAssetRole[];
  documentContexts: ControlPlanningDocumentContext[];
  /** Internal frozen fact snapshot consumed by Workflow Worker; omitted by public serializer. */
  factContexts?: CreativeBriefFactContext[];
  status: CreativeRevisionStatus;
  createdAt: string;
  updatedAt: string;
};

export type ControlStoryboardShotSpec = {
  id: string;
  sequence: number;
  title: string;
  durationSeconds: number;
  narrativeGoal: string;
  startState?: string;
  endState?: string;
  transitionSummary?: string;
  referencePolicy: ReferencePolicy;
  dependsOnSequences: number[];
  continuityNote?: string;
  narrativeBeatSequences?: number[];
  sceneId?: string;
  characterIds?: string[];
  propIds?: string[];
  referenceAnchors?: string[];
};

export type ControlStoryboardRevision = {
  id: string;
  workspaceId: string;
  projectId: string;
  scriptRevisionId: string;
  revision: number;
  title: string;
  summary: string;
  totalDurationSeconds: number;
  continuityLevel: ContinuityLevel;
  continuityNote: string;
  status: CreativeRevisionStatus;
  shotSpecs: ControlStoryboardShotSpec[];
  narrativeBeatCount?: number;
  generationSegmentCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type ControlProductionRun = {
  id: string;
  workspaceId: string;
  projectId: string;
  storyboardRevisionId: string;
  deliveryPlanRevisionId?: DeliveryPlanRevisionId;
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

export type StoryboardShotSpecDraft = Omit<ControlStoryboardShotSpec, "id">;

export type PromptPackageDraft = {
  id: string;
  shotSpecId: string;
  compilerVersion: string;
  prompt: string;
  visualConstraints: Record<string, unknown>;
  referenceMap: Record<string, unknown>;
  capabilitySnapshot: Record<string, unknown>;
  motionPlan?: GenerationSegmentMotionPlan;
  motionPlanHash?: string;
  /** Internal raw source-backed entity candidates, consumed before package persistence. */
  semanticEntityCandidates?: SemanticVisualEntityCandidate[];
  /** Internal segment-local candidate keys; never persisted as canonical IDs. */
  semanticEntityCandidateBindings?: {
    scene?: string;
    characters: string[];
    props: string[];
  };
  /** Frozen server-owned REFERENCE_ASSET facts, stripped after projection construction. */
  semanticReferenceSourceAssets?: Array<{
    assetId: string;
    assetSha256: string;
    usage: string;
    evidenceId: string;
  }>;
};

export type SemanticVisualEntityPersistenceSemantics = Readonly<{
  normalizeName: (name: string) => string;
  normalizeLocation: (location: string) => string;
  semanticValueHash: (value: unknown) => string;
}>;

type SemanticVisualEntityRevisionFields = Readonly<{
  exactName: string;
  normalizedIdentity: string;
  contentHash: string;
  role: string | null;
  description: string | null;
  appearance: string | null;
  styling: string | null;
  location: string | null;
  time: string | null;
  prompt: string | null;
  lighting: string | null;
  type: string | null;
}>;

const mergeSemanticVisualCandidate = (
  candidate: SemanticVisualEntityCandidate,
  existing: CanonicalVisualEntityContext | undefined,
  semantics: SemanticVisualEntityPersistenceSemantics,
): SemanticVisualEntityRevisionFields => {
  const exactName = existing?.exact_name ?? candidate.exact_name;
  if (candidate.kind === "CHARACTER") {
    const role = candidate.role || existing?.role || "";
    const description = candidate.description || existing?.description || "";
    const appearance = candidate.appearance || existing?.appearance || "";
    const styling = candidate.styling || candidate.description || existing?.styling || "";
    const normalizedIdentity = semantics.normalizeName(candidate.exact_name);
    const contentHash = semantics.semanticValueHash(["CHARACTER", role, description, appearance, styling]);
    if (!normalizedIdentity || !/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error("G02 character identity or content hash is invalid.");
    return { exactName, normalizedIdentity, contentHash, role, description, appearance, styling, location: null, time: null, prompt: null, lighting: null, type: null };
  }
  if (candidate.kind === "SCENE") {
    const location = existing ? existing.location ?? "" : candidate.location || "";
    const time = existing ? existing.time ?? "" : candidate.time || "";
    const prompt = existing
      ? candidate.prompt || candidate.description || existing.prompt || ""
      : candidate.prompt || candidate.description || candidate.location || "";
    const lighting = candidate.lighting || existing?.lighting || "";
    const normalizedLocation = semantics.normalizeLocation(candidate.location ?? "");
    const normalizedIdentity = JSON.stringify([normalizedLocation, candidate.time || ""]);
    const contentHash = semantics.semanticValueHash(["SCENE", prompt, lighting]);
    if (!normalizedLocation || !/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error("G02 scene identity or content hash is invalid.");
    return { exactName, normalizedIdentity, contentHash, role: null, description: existing ? existing.description ?? null : candidate.description || null, appearance: null, styling: null, location, time, prompt, lighting, type: null };
  }
  const type = candidate.type || existing?.type || "";
  const description = candidate.description || existing?.description || "";
  const normalizedIdentity = semantics.normalizeName(candidate.exact_name);
  const contentHash = semantics.semanticValueHash(["PROP", type, description]);
  if (!normalizedIdentity || !/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error("G02 prop identity or content hash is invalid.");
  return { exactName, normalizedIdentity, contentHash, role: null, description, appearance: null, styling: null, location: null, time: null, prompt: null, lighting: null, type };
};

export type CreativePlanningDraft = {
  scriptRevisionId: string;
  storyboardRevisionId: string;
  beats: Record<string, unknown>[];
  title: string;
  summary: string;
  totalDurationSeconds: number;
  continuityLevel: ContinuityLevel;
  continuityNote: string;
  shotSpecs: Array<StoryboardShotSpecDraft & { id: string }>;
  narrativeBeatCount?: number;
  generationSegmentCount?: number;
  promptPackages?: PromptPackageDraft[];
  /** Internal provider-derived policy used when validating the final draft. */
  durationPolicy?: StoryboardDurationPolicy;
};

export type CreativeBriefCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  creativeBriefRevisionId: string;
  sourceText: string;
  targetDurationSeconds: number;
  targetResolution: CreativeBriefTargetResolution;
  stylePreferences: string;
  sourceAssetIds: string[];
  sourceAssetRoles?: ControlCreativeBriefSourceAssetRole[];
  event: CreativePlanningEvent;
};

export type PlanningCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  creativeBriefRevisionId: string;
  event: CreativePlanningEvent;
};

export type ApproveStoryboardCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  storyboardRevisionId: string;
  event: CreativePlanningEvent;
};

export type ProductionRunCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  productionRunId: string;
  storyboardRevisionId: string;
  // Optional only for direct repository callers replaying pre-C11.7 history.
  deliveryPlanRevisionId?: DeliveryPlanRevisionId;
  musicPlan?: MusicPlan;
  /** Private, immutable output audio choice for this ProductionRun. */
  audioSelection?: ProductionRunAudioSelection;
  /** Private identity of the Pixabay fallback already accepted by Control API preflight. */
  pixabayFallbackMusicAssetId?: string;
  /** Private billing fact; persisted only inside production_runs.budget_guard. */
  billing?: VideoGenerationInputSnapshot["billing"];
  /** Private fixed-tier policy snapshot for per-segment resolution. */
  fixedBillingPolicy?: FixedVideoBillingPolicySnapshot;
  event: CreativePlanningEvent;
};

export type CreativePlanningCommandOutcome<T> =
  | { kind: "NEW" | "REPLAY"; value: T; status: 201 | 202 }
  | { kind: "CONFLICT" | "NOT_FOUND" | "INVALID_SOURCE" | "DOCUMENT_CONTEXT_INVALID" | "DOCUMENT_KNOWLEDGE_NOT_READY" | "DOCUMENT_FACT_CONTEXT_INVALID" | "ACTIVE_CONFLICT" | "STATE_INVALID" | "PREFLIGHT_BLOCKED" };

export type CreativePlanningEventClaim =
  | { kind: "CLAIMED"; brief: ControlCreativeBriefRevision }
  | { kind: "DUPLICATE" | "BUSY" | "RETRY" };

export interface CreativePlanningStore {
  listProjectCreativeBriefRevisions(workspaceId: string, projectId: string): Promise<ControlCreativeBriefRevision[]>;
  findCreativeBriefRevision(workspaceId: string, creativeBriefRevisionId: string): Promise<ControlCreativeBriefRevision | undefined>;
  listProjectStoryboardRevisions(workspaceId: string, projectId: string): Promise<ControlStoryboardRevision[]>;
  findStoryboardRevision(workspaceId: string, storyboardRevisionId: string): Promise<ControlStoryboardRevision | undefined>;
  listStoryboardDialogueProjections?(workspaceId: string, storyboardRevisionId: string): Promise<SemanticDialogueProjection[]>;
  /** Private, read-only music intent projection for AUTO preflight. */
  listStoryboardMusicIntentHints?(workspaceId: string, storyboardRevisionId: string): Promise<string[]>;
  resolveCanonicalReferenceSources?(workspaceId: string, projectId: string, sourceAssetIds: string[], sourceAssetRoles?: ControlCreativeBriefSourceAssetRole[]): Promise<CanonicalReferenceSource[] | undefined>;
  resolveCanonicalVisualEntityContext?(workspaceId: string, projectId: string): Promise<CanonicalVisualEntityContext[]>;
  listProjectProductionRuns(workspaceId: string, projectId: string): Promise<ControlProductionRun[]>;
  createCreativeBriefRevision(input: CreativeBriefCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>>;
  requestCreativePlan(input: PlanningCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>>;
  completeCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; draft: CreativePlanningDraft; event: CreativePlanningEvent; semanticVisualEntitySemantics?: SemanticVisualEntityPersistenceSemantics }): Promise<ControlStoryboardRevision | undefined>;
  resolveVisualObjectLocks(input: { workspaceId: string; projectId: string; sourceAssetIds: string[]; sourcePrompt?: string }): Promise<KeyVisualObjectLock[]>;
  failCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; code: string; event: CreativePlanningEvent }): Promise<ControlCreativeBriefRevision | undefined>;
  approveStoryboardRevision(input: ApproveStoryboardCommandInput): Promise<CreativePlanningCommandOutcome<ControlStoryboardRevision>>;
  createProductionRun(input: ProductionRunCommandInput): Promise<CreativePlanningCommandOutcome<ControlProductionRun>>;
  claimCreativePlanningEvent(input: { message: InternalCreativePlanningQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<CreativePlanningEventClaim>;
  completeCreativePlanningEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }): Promise<void>;
  releaseCreativePlanningEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }): Promise<void>;
}

type StoredSnapshot =
  | { kind: "CREATIVE_BRIEF"; creativeBriefRevisionId: string }
  | { kind: "STORYBOARD"; storyboardRevisionId: string }
  | { kind: "PRODUCTION_RUN"; productionRunId: string }
  | { kind: "NOT_FOUND" | "INVALID_SOURCE" | "DOCUMENT_CONTEXT_INVALID" | "DOCUMENT_KNOWLEDGE_NOT_READY" | "DOCUMENT_FACT_CONTEXT_INVALID" | "ACTIVE_CONFLICT" | "STATE_INVALID" | "PREFLIGHT_BLOCKED" };

type StoredCommand = { requestHash: string; snapshot: StoredSnapshot; status: 201 | 202 };

const now = () => new Date().toISOString();

const readDialogueProjection = (snapshot: unknown): SemanticDialogueProjection | undefined => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  const record = snapshot as Record<string, unknown>;
  const parsed = SemanticDialogueProjectionSchema.safeParse(
    record.semantic_dialogue_projection,
  );
  if (!parsed.success
    || record.prompt_source_kind !== "SEMANTIC_VISUAL_PROJECTION"
    || record.authored_source_hash !== parsed.data.source_hash
    || record.semantic_decision_hash !== parsed.data.decision_hash
    || record.semantic_segment_id !== parsed.data.segment_id) return undefined;
  return parsed.data;
};

const readMusicIntentHint = (snapshot: unknown): string | undefined => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  const value = (snapshot as Record<string, unknown>).bgm_prompt;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const objectiveReferenceDescription = (metadata: Record<string, unknown> | undefined) => {
  const analysis = metadata?.visual_analysis;
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return undefined;
  const summary = (analysis as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim().slice(0, 5_000) : undefined;
};

const objectiveReferenceRole = (metadata: Record<string, unknown> | undefined): CanonicalReferenceSource["provider_role"] => {
  const analysis = metadata?.visual_analysis;
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return undefined;
  const role = (analysis as Record<string, unknown>).role;
  return role === "SUBJECT" || role === "SCENE" || role === "STYLE" ? role : undefined;
};

const isCanonicalReferenceMime = (value: unknown): value is CanonicalReferenceSource["mime_type"] =>
  value === "image/jpeg" || value === "image/png" || value === "image/webp";

const serializeCreativeBrief = (value: typeof creativeBriefRevisions.$inferSelect, documentContexts: ControlPlanningDocumentContext[] = [], factContexts: CreativeBriefFactContext[] = []): ControlCreativeBriefRevision => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  revision: value.revision,
  sourceText: value.sourceText,
  targetDurationSeconds: value.targetDurationSeconds,
  targetResolution: value.targetResolution,
  stylePreferences: value.stylePreferences,
  sourceAssetIds: value.sourceAssetIds,
  sourceAssetRoles: (value.sourceAssetRoles ?? []).map((reference) => ({
    assetId: reference.asset_id,
    role: reference.role,
    ...(reference.usage ? { usage: reference.usage } : {}),
  })),
  documentContexts,
  factContexts,
  status: value.status,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});

const serializeShotSpec = (value: typeof storyboardShotSpecs.$inferSelect): ControlStoryboardShotSpec => ({
  id: value.id,
  sequence: value.sequence,
  title: value.title,
  durationSeconds: value.durationSeconds,
  narrativeGoal: value.narrativeGoal,
  ...(value.startState.trim() ? { startState: value.startState } : {}),
  ...(value.endState.trim() ? { endState: value.endState } : {}),
  ...(value.transitionSummary.trim() ? { transitionSummary: value.transitionSummary } : {}),
  referencePolicy: value.referencePolicy,
  dependsOnSequences: value.dependsOnSequences,
  ...(value.continuityNote.trim() ? { continuityNote: value.continuityNote } : {}),
  narrativeBeatSequences: value.narrativeBeatSequences,
  ...(value.sceneId ? { sceneId: value.sceneId } : {}),
  characterIds: value.characterIds,
  propIds: value.propIds,
  referenceAnchors: value.referenceAnchors,
});

const serializeStoryboard = (
  value: typeof storyboardRevisions.$inferSelect,
  shotSpecs: Array<typeof storyboardShotSpecs.$inferSelect>,
  narrativeBeatCount = 0,
): ControlStoryboardRevision => ({
  id: value.id,
  workspaceId: value.workspaceId,
  projectId: value.projectId,
  scriptRevisionId: value.scriptRevisionId,
  revision: value.revision,
  title: value.title,
  summary: value.summary,
  totalDurationSeconds: value.totalDurationSeconds,
  continuityLevel: value.continuityLevel,
  continuityNote: value.continuityNote,
  status: value.status,
  shotSpecs: shotSpecs.sort((left, right) => left.sequence - right.sequence).map(serializeShotSpec),
  narrativeBeatCount,
  generationSegmentCount: shotSpecs.length,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});

const serializeProductionRun = (value: typeof productionRuns.$inferSelect): ControlProductionRun => ({
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
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});

const commandKey = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;
const hasG02SourceMarker = (sourceText: string) => parseG02ApprovedBeatMarkers(sourceText) !== undefined;
const promptPackageHasG02Fields = (promptPackage: PromptPackageDraft) =>
  promptPackage.semanticEntityCandidates !== undefined
  || promptPackage.semanticEntityCandidateBindings !== undefined
  || promptPackage.semanticReferenceSourceAssets !== undefined
  || Object.hasOwn(promptPackage.capabilitySnapshot, "semantic_narrative_beat_lineage")
  || Object.hasOwn(promptPackage.capabilitySnapshot, "semantic_narrative_beat_lineage_hash")
  || Object.hasOwn(promptPackage.capabilitySnapshot, "semantic_entity_reference_projection_hash")
  || Object.hasOwn(promptPackage.referenceMap, "semantic_entity_reference_projection");
// BLOCKED is a historical run that is waiting for an explicit segment retry or a new version.
// It must not prevent a revised storyboard from starting a separate production run.
const activeProductionStatuses: ProductionRunStatus[] = ["DRAFT", "PLAN_READY", "CONFIRMED", "GENERATING", "REVIEWING", "RENDERING"];

const planIsValid = (input: Pick<CreativePlanningDraft, "totalDurationSeconds" | "shotSpecs" | "durationPolicy">) => {
  assertStoryboardPlan({
    totalDurationSeconds: input.totalDurationSeconds,
    ...(input.durationPolicy ? { durationPolicy: input.durationPolicy } : {}),
    specs: input.shotSpecs.map((shotSpec) => ({
      sequence: shotSpec.sequence,
      durationSeconds: shotSpec.durationSeconds,
      dependsOnSequences: shotSpec.dependsOnSequences,
    })),
  });
};

const validatePromptPackages = (input: Pick<CreativePlanningDraft, "shotSpecs" | "promptPackages">) => {
  if (!input.promptPackages) return [];
  if (input.promptPackages.length !== input.shotSpecs.length) {
    throw new Error("Each storyboard shot spec must have exactly one compiled prompt package.");
  }
  const shotSpecIds = new Set(input.shotSpecs.map((shotSpec) => shotSpec.id));
  const compiledShotSpecIds = new Set(input.promptPackages.map((promptPackage) => promptPackage.shotSpecId));
  if (compiledShotSpecIds.size !== input.promptPackages.length || compiledShotSpecIds.size !== shotSpecIds.size || [...compiledShotSpecIds].some((id) => !shotSpecIds.has(id))) {
    throw new Error("Compiled prompt packages must map one-to-one to storyboard shot specs.");
  }
  for (const promptPackage of input.promptPackages) {
    if (!promptPackage.id || !promptPackage.compilerVersion.trim() || !promptPackage.prompt.trim()) {
      throw new Error("Compiled prompt packages must have an id, compiler version, and non-empty prompt.");
    }
  }
  return input.promptPackages;
};

const completeG02PlanningDraft = async (input: {
  brief: ControlCreativeBriefRevision;
  draft: CreativePlanningDraft;
  promptPackages: PromptPackageDraft[];
  semantics: SemanticVisualEntityPersistenceSemantics;
  resolveEntity: (candidate: SemanticVisualEntityCandidate) => Promise<CanonicalVisualEntityContext>;
  resolveAsset: (assetId: string) => Promise<{ sha256: string } | undefined>;
  resolveMapping: (input: {
    entity: CanonicalVisualEntityContext;
    assetId: string;
    assetSha256: string;
    referenceEvidenceId: string;
    usage: string;
  }) => Promise<string>;
}): Promise<{ shotSpecs: CreativePlanningDraft["shotSpecs"]; promptPackages: PromptPackageDraft[] }> => {
  if (input.promptPackages.length !== input.draft.shotSpecs.length || input.promptPackages.length !== 3) {
    throw new Error("G02 requires one complete PromptPackage for each of the three source-bound ShotSpecs.");
  }
  const candidatesByKey = new Map<string, SemanticVisualEntityCandidate>();
  for (const promptPackage of input.promptPackages) {
    const parsedCandidates = (promptPackage.semanticEntityCandidates ?? []).map((candidate) => SemanticVisualEntityCandidateSchema.parse(candidate));
    for (const candidate of parsedCandidates) {
      const previous = candidatesByKey.get(candidate.candidate_key);
      if (previous && canonicalJson(previous) !== canonicalJson(candidate)) {
        throw new Error("G02 PromptPackages disagree on a source-backed candidate definition.");
      }
      candidatesByKey.set(candidate.candidate_key, candidate);
    }
  }
  if (candidatesByKey.size === 0) throw new Error("G02 requires source-backed visual entity candidates.");
  if ([...candidatesByKey.values()].some((candidate) => candidate.reference_asset_ids.length === 0)) {
    throw new Error("Every used G02 visual entity candidate must map to at least one approved reference asset.");
  }

  const entitiesByCandidateKey = new Map<string, CanonicalVisualEntityContext>();
  for (const candidate of candidatesByKey.values()) {
    entitiesByCandidateKey.set(candidate.candidate_key, await input.resolveEntity(candidate));
  }

  const seenAssetOwners = new Map<string, string>();
  const usedCandidateKeys = new Set<string>();
  const shotSpecs = input.draft.shotSpecs.map((shotSpec) => ({ ...shotSpec }));
  const shotSpecIndex = new Map(shotSpecs.map((shotSpec, index) => [shotSpec.id, index]));
  const promptPackages: PromptPackageDraft[] = [];
  for (const promptPackage of input.promptPackages) {
    const rawBindings = promptPackage.semanticEntityCandidateBindings;
    if (!rawBindings || !Array.isArray(rawBindings.characters) || !Array.isArray(rawBindings.props)) {
      throw new Error("G02 PromptPackage is missing its segment-local candidate-key binding.");
    }
    if (rawBindings.scene) {
      const sceneCandidate = candidatesByKey.get(rawBindings.scene);
      const sceneEntity = entitiesByCandidateKey.get(rawBindings.scene);
      if (!sceneCandidate || sceneCandidate.kind !== "SCENE" || !sceneEntity || sceneEntity.entity_kind !== "SCENE") {
        throw new Error("G02 scene binding must resolve to a SCENE candidate and canonical entity.");
      }
    }
    const candidateKeys = [
      ...(rawBindings.scene ? [rawBindings.scene] : []),
      ...rawBindings.characters,
      ...rawBindings.props,
    ];
    if (candidateKeys.length === 0 || new Set(candidateKeys).size !== candidateKeys.length) {
      throw new Error("Each G02 segment requires unique entity bindings and at least one reference anchor.");
    }
    for (const key of candidateKeys) {
      if (!candidatesByKey.has(key)) throw new Error("G02 PromptPackage references an unknown candidate key.");
      usedCandidateKeys.add(key);
    }
    const referenceMap = promptPackage.referenceMap;
    const referenceProjection = SemanticReferenceProjectionSchema.parse(referenceMap.semantic_reference_projection);
    const visualConstraints = promptPackage.visualConstraints;
    const segmentId = visualConstraints.semantic_segment_id;
    const decisionHash = visualConstraints.semantic_decision_hash;
    if (typeof segmentId !== "string" || referenceProjection.segment_id !== segmentId
      || typeof decisionHash !== "string" || referenceProjection.decision_hash !== decisionHash
      || referenceProjection.source_hash.length !== 64) {
      throw new Error("G02 PromptPackage reference evidence is not bound to its semantic segment.");
    }
    const candidatesForSegment = candidateKeys.map((key) => candidatesByKey.get(key)!);
    const mappedAssets = candidatesForSegment.flatMap((candidate) => candidate.reference_asset_ids);
    if (mappedAssets.length !== referenceProjection.references.length
      || new Set(mappedAssets).size !== mappedAssets.length
      || referenceProjection.references.some((reference) => !mappedAssets.includes(reference.asset_id))) {
      throw new Error("Every G02 Provider reference position must map to exactly one candidate entity.");
    }
    const referenceBindings: SemanticEntityReferenceProjection["bindings"] = [];
    const frozenReferenceAssets = promptPackage.semanticReferenceSourceAssets ?? [];
    if (frozenReferenceAssets.length !== referenceProjection.references.length) {
      throw new Error("G02 PromptPackage lacks the frozen canonical image evidence for its reference positions.");
    }
    for (const [providerPosition, reference] of referenceProjection.references.entries()) {
      const owningCandidates = candidatesForSegment.filter((candidate) => candidate.reference_asset_ids.includes(reference.asset_id));
      if (owningCandidates.length !== 1 || reference.evidence_ids.length !== 1) {
        throw new Error("A G02 reference asset must resolve to one logical entity and one canonical REFERENCE_ASSET evidence.");
      }
      const candidate = owningCandidates[0]!;
      const entity = entitiesByCandidateKey.get(candidate.candidate_key)!;
      const declaredRole = input.brief.sourceAssetRoles?.find((role) => role.assetId === reference.asset_id);
      if (!declaredRole?.usage || reference.usage !== declaredRole.usage || !hasExactEntityNameMention(declaredRole.usage, candidate.exact_name)) {
        throw new Error("G02 visual entity mapping must use the exact frozen Brief usage for the same named entity.");
      }
      const sourceReference = frozenReferenceAssets[providerPosition];
      if (!sourceReference
        || sourceReference.assetId !== reference.asset_id
        || sourceReference.usage !== reference.usage
        || reference.evidence_ids.length !== 1
        || sourceReference.evidenceId !== reference.evidence_ids[0]
        || !Array.isArray(visualConstraints.evidence_ids)
        || !visualConstraints.evidence_ids.includes(sourceReference.evidenceId)) {
        throw new Error("G02 reference projection is not bound to the same canonical REFERENCE_ASSET evidence and order.");
      }
      const previousOwner = seenAssetOwners.get(reference.asset_id);
      if (previousOwner && previousOwner !== entity.entity_id) {
        throw new Error("One Brief image cannot map to different logical visual entities.");
      }
      seenAssetOwners.set(reference.asset_id, entity.entity_id);
      const asset = await input.resolveAsset(reference.asset_id);
      if (!asset || !/^[a-f0-9]{64}$/u.test(asset.sha256)
        || !/^[a-f0-9]{64}$/u.test(sourceReference.assetSha256)
        || asset.sha256 !== sourceReference.assetSha256) {
        throw new Error("G02 visual entity mapping asset is missing or has no verified SHA-256.");
      }
      const mappingEvidenceId = await input.resolveMapping({
        entity,
        assetId: reference.asset_id,
        assetSha256: asset.sha256,
        referenceEvidenceId: sourceReference.evidenceId,
        usage: declaredRole.usage,
      });
      referenceBindings.push({
        entity_kind: entity.entity_kind,
        entity_id: entity.entity_id,
        entity_revision_id: entity.revision_id,
        exact_name: entity.exact_name,
        asset_id: reference.asset_id,
        asset_sha256: asset.sha256,
        provider_position: providerPosition,
        mapping_evidence_id: mappingEvidenceId,
      });
    }
    const projection = SemanticEntityReferenceProjectionSchema.parse({
      version: 1,
      brief_revision_id: input.brief.id,
      source_hash: referenceProjection.source_hash,
      decision_hash: referenceProjection.decision_hash,
      segment_id: referenceProjection.segment_id,
      prompt_package_id: promptPackage.id,
      bindings: referenceBindings,
    });
    const projectionHash = input.semantics.semanticValueHash(projection);
    if (!/^[a-f0-9]{64}$/u.test(projectionHash)) throw new Error("G02 entity projection hash is invalid.");

    const capabilitySnapshot = promptPackage.capabilitySnapshot;
    const dialogueProjection = SemanticDialogueProjectionSchema.parse(capabilitySnapshot.semantic_dialogue_projection);
    const audioOwner = VideoAudioOwnerSchema.parse(capabilitySnapshot.audio_owner);
    const sourcePrompt = capabilitySnapshot.source_prompt;
    const generatedPromptParts = capabilitySnapshot.generated_prompt_parts;
    const evidenceIds = visualConstraints.evidence_ids;
    const maxDurationSeconds = capabilitySnapshot.max_duration_seconds;
    const maxReferenceImages = capabilitySnapshot.max_reference_images;
    const beatLineage = SemanticNarrativeBeatProjectionSchema.parse(capabilitySnapshot.semantic_narrative_beat_lineage);
    const beatLineageHash = capabilitySnapshot.semantic_narrative_beat_lineage_hash;
    if (beatLineage.brief_revision_id !== input.brief.id
      || beatLineage.source_hash !== referenceProjection.source_hash
      || !Array.isArray(generatedPromptParts)
      || generatedPromptParts.some((part) => typeof part !== "string")
      || !Array.isArray(evidenceIds)
      || evidenceIds.some((id) => typeof id !== "string")
      || typeof sourcePrompt !== "string"
      || !Number.isSafeInteger(maxDurationSeconds)
      || !Number.isSafeInteger(maxReferenceImages)
      || typeof beatLineageHash !== "string"
      || beatLineageHash !== input.semantics.semanticValueHash(beatLineage)) {
      throw new Error("G02 PromptPackage beat lineage or integrity inputs are invalid.");
    }
    const referencePolicy = referenceMap.reference_policy;
    if (typeof referencePolicy !== "string") throw new Error("G02 PromptPackage reference policy is missing.");
    const packageIntegrityHash = input.semantics.semanticValueHash(semanticPromptPackageIntegrityPayload({
      shotSpecId: promptPackage.shotSpecId,
      prompt: promptPackage.prompt,
      referencePolicy,
      sourcePrompt,
      generatedPromptParts,
      evidenceIds,
      dialogueProjection,
      referenceProjection,
      audioOwner,
      maxDurationSeconds: maxDurationSeconds as number,
      maxReferenceImages: maxReferenceImages as number,
      promptPackageId: promptPackage.id,
      semanticEntityReferenceProjection: projection,
      semanticEntityReferenceProjectionHash: projectionHash,
      semanticNarrativeBeatLineage: beatLineage,
      semanticNarrativeBeatLineageHash: beatLineageHash,
      ...(typeof capabilitySnapshot.bgm_prompt === "string" ? { bgmPrompt: capabilitySnapshot.bgm_prompt } : {}),
    }));

    const resolveIds = (keys: string[], kind: "CHARACTER" | "PROP") => keys.map((key) => {
      const candidate = candidatesByKey.get(key);
      const entity = entitiesByCandidateKey.get(key);
      if (!candidate || candidate.kind !== kind || !entity || findExactEntityAnchor(promptPackage.prompt, entity.exact_name) < 0) {
        throw new Error("G02 PromptPackage prompt and canonical entity binding disagree.");
      }
      return entity.entity_id;
    });
    const anchorEntities = candidateKeys.map((key) => {
      const entity = entitiesByCandidateKey.get(key)!;
      const promptIndex = findExactEntityAnchor(promptPackage.prompt, entity.exact_name);
      if (promptIndex < 0) throw new Error("A bound G02 entity is missing its exact @ reference in the Provider-neutral prompt.");
      return { entity, promptIndex };
    }).sort((left, right) => left.promptIndex - right.promptIndex);
    const referenceAnchors = [...new Set(anchorEntities.map(({ entity }) => `@${entity.exact_name}`))];
    const shotIndex = shotSpecIndex.get(promptPackage.shotSpecId);
    if (shotIndex === undefined) throw new Error("G02 PromptPackage is detached from its frozen ShotSpec.");
    shotSpecs[shotIndex] = {
      ...shotSpecs[shotIndex]!,
      ...(rawBindings.scene ? { sceneId: entitiesByCandidateKey.get(rawBindings.scene)!.entity_id } : {}),
      characterIds: resolveIds(rawBindings.characters, "CHARACTER"),
      propIds: resolveIds(rawBindings.props, "PROP"),
      referenceAnchors,
    };
    const { semanticEntityCandidates: _candidates, semanticEntityCandidateBindings: _bindings, ...persistablePackage } = promptPackage;
    const { semanticReferenceSourceAssets: _referenceAssets, ...persistablePackageWithoutSourceRefs } = persistablePackage;
      promptPackages.push({
        ...persistablePackageWithoutSourceRefs,
        referenceMap: { ...referenceMap, semantic_entity_reference_projection: projection },
        capabilitySnapshot: {
          ...capabilitySnapshot,
          semantic_entity_reference_projection_hash: projectionHash,
          semantic_prompt_package_integrity_hash: packageIntegrityHash,
        },
      });
  }
  if (usedCandidateKeys.size !== candidatesByKey.size) throw new Error("G02 contains an unused visual entity candidate.");
  return { shotSpecs, promptPackages };
};

const eventRow = (input: {
  event: CreativePlanningEvent;
  producer: string;
  workspaceId: string;
  projectId: string;
  aggregateType: "creative_brief_revision" | "storyboard_revision" | "production_run";
  aggregateId: string;
  eventType: "creative_brief.planning_requested" | "creative_brief.planning_failed" | "storyboard_revision.ready_for_review" | "storyboard_revision.approved" | "production_run.confirmed";
  data: Record<string, unknown>;
}) => {
  const occurredAt = now();
  const payload = InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: input.event.messageId,
    event_id: input.event.eventId,
    event_type: input.eventType,
    occurred_at: occurredAt,
    trace_id: input.event.traceId,
    correlation_id: input.event.correlationId,
    idempotency_key: `internal:${input.event.eventId}`,
    producer: input.producer,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    aggregate: { type: input.aggregateType, id: input.aggregateId },
    data: input.data,
    version: 1,
  });
  return {
    id: input.event.eventId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload,
    occurredAt,
  };
};

export class InMemoryCreativePlanningStore implements CreativePlanningStore {
  private readonly creativeBriefs = new Map<string, ControlCreativeBriefRevision>();
  private readonly storyboards = new Map<string, ControlStoryboardRevision>();
  private readonly productionRuns = new Map<string, ControlProductionRun>();
  private readonly scripts = new Map<string, { id: string; creativeBriefRevisionId: string; status: CreativeRevisionStatus }>();
  private readonly promptPackages = new Map<string, PromptPackageDraft>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly consumedEvents = new Set<string>();
  private readonly visualEntityContexts = new Map<string, CanonicalVisualEntityContext>();
  private readonly visualEntityRevisionHistory = new Map<string, CanonicalVisualEntityContext[]>();
  private readonly visualEntityMappings = new Map<string, {
    workspaceId: string;
    projectId: string;
    briefRevisionId: string;
    assetId: string;
    entityId: string;
    revisionId: string;
    assetSha256: string;
    referenceEvidenceId: string;
    usage: string;
    mappingEvidenceId: string;
  }>();

  constructor(
    private readonly sourceAssetResolver?: {
      findAsset(workspaceId: string, assetId: string): Promise<{
        id?: string;
        projectId: string;
        status: string;
        origin?: string;
        kind?: string;
        sha256?: string | null;
        mimeType?: string | null;
        metadata?: Record<string, unknown>;
      } | undefined>;
    },
    private readonly documentContextResolver?: PlanningDocumentContextResolver,
    private readonly factContextResolver?: PlanningFactContextResolver,
    private deliveryPlanResolver?: {
      findDeliveryPlanRevision(workspaceId: string, deliveryPlanRevisionId: string): Promise<{
        projectId: string;
        storyboardRevisionId: string;
        status: "DRAFT" | "PREFLIGHT_BLOCKED" | "AWAITING_APPROVAL" | "APPROVED" | "CONSUMED" | "SUPERSEDED";
        blockReasons: string[];
        consumedByProductionRunId: string | null;
      } | undefined>;
      consumeDeliveryPlanRevision(input: { workspaceId: string; deliveryPlanRevisionId: string; productionRunId: string }): Promise<{ kind: "CONSUMED" | "ALREADY_CONSUMED" | "NOT_FOUND" | "STATE_INVALID" }>;
    },
  ) {}

  setDeliveryPlanResolver(resolver: NonNullable<InMemoryCreativePlanningStore["deliveryPlanResolver"]>) {
    this.deliveryPlanResolver = resolver;
  }

  async listProjectCreativeBriefRevisions(workspaceId: string, projectId: string) {
    return [...this.creativeBriefs.values()]
      .filter((value) => value.workspaceId === workspaceId && value.projectId === projectId)
      .sort((left, right) => left.revision - right.revision);
  }

  async findCreativeBriefRevision(workspaceId: string, creativeBriefRevisionId: string) {
    const value = this.creativeBriefs.get(creativeBriefRevisionId);
    return value?.workspaceId === workspaceId ? value : undefined;
  }

  async listProjectStoryboardRevisions(workspaceId: string, projectId: string) {
    return [...this.storyboards.values()]
      .filter((value) => value.workspaceId === workspaceId && value.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async findStoryboardRevision(workspaceId: string, storyboardRevisionId: string) {
    const value = this.storyboards.get(storyboardRevisionId);
    return value?.workspaceId === workspaceId ? value : undefined;
  }

  async listStoryboardDialogueProjections(workspaceId: string, storyboardRevisionId: string) {
    const storyboard = await this.findStoryboardRevision(workspaceId, storyboardRevisionId);
    if (!storyboard) return [];
    const packageByShot = new Map(
      [...this.promptPackages.values()].map((promptPackage) => [promptPackage.shotSpecId, promptPackage]),
    );
    return [...storyboard.shotSpecs]
      .sort((left, right) => left.sequence - right.sequence)
      .flatMap((shotSpec) => {
        const projection = readDialogueProjection(packageByShot.get(shotSpec.id)?.capabilitySnapshot);
        return projection ? [projection] : [];
      });
  }

  async listStoryboardMusicIntentHints(workspaceId: string, storyboardRevisionId: string) {
    const storyboard = await this.findStoryboardRevision(workspaceId, storyboardRevisionId);
    if (!storyboard) return [];
    const packageByShot = new Map(
      [...this.promptPackages.values()].map((promptPackage) => [promptPackage.shotSpecId, promptPackage]),
    );
    return [...storyboard.shotSpecs]
      .sort((left, right) => left.sequence - right.sequence)
      .flatMap((shotSpec) => {
        const hint = readMusicIntentHint(packageByShot.get(shotSpec.id)?.capabilitySnapshot);
        return hint ? [hint] : [];
      });
  }

  async resolveCanonicalReferenceSources(workspaceId: string, projectId: string, sourceAssetIds: string[], sourceAssetRoles: ControlCreativeBriefSourceAssetRole[] = []) {
    if (!this.sourceAssetResolver) return sourceAssetIds.length === 0 ? [] : undefined;
    const roleByAssetId = new Map(sourceAssetRoles.map((reference) => [reference.assetId, reference]));
    const results: CanonicalReferenceSource[] = [];
    for (const assetId of sourceAssetIds) {
      const asset = await this.sourceAssetResolver.findAsset(workspaceId, assetId);
      if (!asset
        || asset.projectId !== projectId
        || asset.status !== "READY"
        || asset.origin !== "USER_UPLOAD"
        || (asset.id !== undefined && asset.id !== assetId)) return undefined;
      if (asset.kind === "DOCUMENT") continue;
      if (asset.kind !== "IMAGE" || results.length >= 7) return undefined;
      if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !isCanonicalReferenceMime(asset.mimeType)) return undefined;
      const objectiveDescription = objectiveReferenceDescription(asset.metadata);
      const declaredRole = roleByAssetId.get(asset.id ?? assetId);
      const providerRole = declaredRole?.role ?? objectiveReferenceRole(asset.metadata);
      results.push({
        asset_id: asset.id ?? assetId,
        asset_sha256: asset.sha256,
        mime_type: asset.mimeType,
        position: results.length,
        ...(providerRole ? { provider_role: providerRole } : {}),
        ...(typeof declaredRole?.usage === "string" ? { user_declared_usage: declaredRole.usage } : {}),
        ...(objectiveDescription ? { objective_description: objectiveDescription } : {}),
      });
    }
    return results;
  }

  async resolveCanonicalVisualEntityContext(workspaceId: string, projectId: string) {
    const prefix = `${workspaceId}\u0000${projectId}\u0000`;
    return [...this.visualEntityContexts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entity]) => entity);
  }

  async listProjectProductionRuns(workspaceId: string, projectId: string) {
    return [...this.productionRuns.values()]
      .filter((value) => value.workspaceId === workspaceId && value.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createCreativeBriefRevision(input: CreativeBriefCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>> {
    const replay = await this.replayBrief(input);
    if (replay) return replay;
    if (!(await this.sourcesAreReady(input.workspaceId, input.projectId, input.sourceAssetIds))) return this.store(input, { kind: "INVALID_SOURCE" });
    const documentContexts = await this.resolveDocumentContexts(input);
    if (!documentContexts) return this.store(input, { kind: "DOCUMENT_CONTEXT_INVALID" });
    const factContexts = this.factContextResolver
      ? await this.factContextResolver.resolveFactContexts({ workspaceId: input.workspaceId, projectId: input.projectId, creativeBriefRevisionId: input.creativeBriefRevisionId, sourceAssetIds: input.sourceAssetIds, sourceText: input.sourceText, stylePreferences: input.stylePreferences })
      : [];
    if (factContexts === undefined) return this.store(input, { kind: "DOCUMENT_KNOWLEDGE_NOT_READY" });
    const revision = (await this.listProjectCreativeBriefRevisions(input.workspaceId, input.projectId)).length + 1;
    const timestamp = now();
    const value: ControlCreativeBriefRevision = {
      id: input.creativeBriefRevisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      revision,
      sourceText: input.sourceText,
      targetDurationSeconds: input.targetDurationSeconds,
      targetResolution: input.targetResolution,
      stylePreferences: input.stylePreferences,
      sourceAssetIds: [...input.sourceAssetIds],
      sourceAssetRoles: [...(input.sourceAssetRoles ?? [])],
      documentContexts,
      factContexts,
      status: "DRAFT",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.creativeBriefs.set(value.id, value);
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "CREATIVE_BRIEF", creativeBriefRevisionId: value.id }, status: 201 });
    return { kind: "NEW", value, status: 201 };
  }

  async resolveVisualObjectLocks(_input: { workspaceId: string; projectId: string; sourceAssetIds: string[]; sourcePrompt?: string }): Promise<KeyVisualObjectLock[]> {
    // Objective image observations are not semantic continuity decisions.
    // Verified Semantic Director locks are projected explicitly by the semantic planning path.
    return [];
  }

  async requestCreativePlan(input: PlanningCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>> {
    const replay = await this.replayBrief(input);
    if (replay) return replay;
    const current = await this.findCreativeBriefRevision(input.workspaceId, input.creativeBriefRevisionId);
    if (!current) return this.store(input, { kind: "NOT_FOUND" });
    if (current.status === "PLANNING") return this.store(input, { kind: "ACTIVE_CONFLICT" });
    if (current.status !== "DRAFT" && current.status !== "FAILED") return this.store(input, { kind: "STATE_INVALID" });
    assertCreativeRevisionTransition(current.status, "PLANNING");
    const value = { ...current, status: "PLANNING" as const, updatedAt: now() };
    this.creativeBriefs.set(value.id, value);
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "CREATIVE_BRIEF", creativeBriefRevisionId: value.id }, status: 202 });
    return { kind: "NEW", value, status: 202 };
  }

  async completeCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; draft: CreativePlanningDraft; event: CreativePlanningEvent; semanticVisualEntitySemantics?: SemanticVisualEntityPersistenceSemantics }) {
    const current = await this.findCreativeBriefRevision(input.workspaceId, input.creativeBriefRevisionId);
    if (!current) return undefined;
    const existingScript = [...this.scripts.values()].find((value) => value.creativeBriefRevisionId === current.id);
    const existing = existingScript
      ? [...this.storyboards.values()].find((value) => value.workspaceId === input.workspaceId && value.scriptRevisionId === existingScript.id)
      : undefined;
    if (existing) return existing;
    if (current.status !== "PLANNING" || current.targetDurationSeconds !== input.draft.totalDurationSeconds) return undefined;
    planIsValid(input.draft);
    const compiledPromptPackages = validatePromptPackages(input.draft);
    let persistedShotSpecs = input.draft.shotSpecs;
    let persistedPromptPackages = compiledPromptPackages;
    let stagedVisualEntityContexts: Map<string, CanonicalVisualEntityContext> | undefined;
    let stagedVisualEntityRevisionHistory: Map<string, CanonicalVisualEntityContext[]> | undefined;
    let stagedVisualEntityMappings: Map<string, (typeof this.visualEntityMappings extends Map<string, infer T> ? T : never)> | undefined;
    const isG02Source = hasG02SourceMarker(current.sourceText);
    const hasG02Draft = compiledPromptPackages.some(promptPackageHasG02Fields);
    if (!isG02Source && (hasG02Draft || input.semanticVisualEntitySemantics)) {
      throw new Error("G02 private planning fields or callbacks cannot be applied without a locked Brief source marker.");
    }
    if (isG02Source) {
      const semantics = input.semanticVisualEntitySemantics;
      if (!semantics || !this.sourceAssetResolver) throw new Error("G02 persistence requires server-owned source semantics and scoped asset verification.");
      stagedVisualEntityContexts = new Map(this.visualEntityContexts);
      stagedVisualEntityRevisionHistory = new Map([...this.visualEntityRevisionHistory.entries()]
        .map(([key, revisions]) => [key, [...revisions]]));
      stagedVisualEntityMappings = new Map(this.visualEntityMappings);
      const scopePrefix = `${current.workspaceId}\u0000${current.projectId}\u0000`;
      const mappingPrefix = `${current.workspaceId}\u0000${current.projectId}\u0000${current.id}\u0000`;
      const prepared = await completeG02PlanningDraft({
        brief: current,
        draft: input.draft,
        promptPackages: compiledPromptPackages,
        semantics,
        resolveEntity: async (candidate) => {
          const seed = mergeSemanticVisualCandidate(candidate, undefined, semantics);
          const entityKey = `${scopePrefix}${candidate.kind}\u0000${seed.normalizedIdentity}`;
          const existing = stagedVisualEntityContexts!.get(entityKey);
          const merged = mergeSemanticVisualCandidate(candidate, existing, semantics);
          const revisions = stagedVisualEntityRevisionHistory!.get(entityKey) ?? (existing ? [existing] : []);
          stagedVisualEntityRevisionHistory!.set(entityKey, revisions);
          const matchingRevision = revisions.find((revision) => revision.content_hash === merged.contentHash);
          if (matchingRevision) return matchingRevision;
          const context: CanonicalVisualEntityContext = {
            entity_id: existing?.entity_id ?? createPrefixedId("cve"),
            entity_kind: candidate.kind,
            normalized_identity: merged.normalizedIdentity,
            revision_id: createPrefixedId("cvr"),
            revision_number: (revisions.at(-1)?.revision_number ?? existing?.revision_number ?? 0) + 1,
            content_hash: merged.contentHash,
            exact_name: merged.exactName,
            ...(merged.role !== null ? { role: merged.role } : {}),
            ...(merged.description !== null ? { description: merged.description } : {}),
            ...(merged.appearance !== null ? { appearance: merged.appearance } : {}),
            ...(merged.styling !== null ? { styling: merged.styling } : {}),
            ...(merged.location !== null ? { location: merged.location } : {}),
            ...(merged.time !== null ? { time: merged.time } : {}),
            ...(merged.prompt !== null ? { prompt: merged.prompt } : {}),
            ...(merged.lighting !== null ? { lighting: merged.lighting } : {}),
            ...(merged.type !== null ? { type: merged.type } : {}),
          };
          stagedVisualEntityContexts!.set(entityKey, context);
          revisions.push(context);
          return context;
        },
        resolveAsset: async (assetId) => {
          const asset = await this.sourceAssetResolver!.findAsset(current.workspaceId, assetId);
          return asset
            && asset.projectId === current.projectId
            && asset.status === "READY"
            && asset.origin === "USER_UPLOAD"
            && asset.kind === "IMAGE"
            && typeof asset.sha256 === "string"
            ? { sha256: asset.sha256 }
            : undefined;
        },
        resolveMapping: async ({ entity, assetId, assetSha256, referenceEvidenceId, usage }) => {
          const existing = [...stagedVisualEntityMappings!.values()].find((mapping) => mapping.workspaceId === current.workspaceId
            && mapping.projectId === current.projectId
            && mapping.briefRevisionId === current.id
            && mapping.assetId === assetId
            && mapping.entityId === entity.entity_id
            && mapping.revisionId === entity.revision_id
            && mapping.assetSha256 === assetSha256
            && mapping.referenceEvidenceId === referenceEvidenceId);
          if (existing) return existing.mappingEvidenceId;
          const activeForAsset = [...stagedVisualEntityMappings!.values()].filter((mapping) => mapping.workspaceId === current.workspaceId
            && mapping.projectId === current.projectId
            && mapping.briefRevisionId === current.id
            && mapping.assetId === assetId);
          if (activeForAsset.length > 1 || activeForAsset.some((mapping) => mapping.entityId !== entity.entity_id
            || mapping.revisionId !== entity.revision_id
            || mapping.assetSha256 !== assetSha256
            || mapping.referenceEvidenceId !== referenceEvidenceId
            || mapping.usage !== usage)) {
            throw new Error("A G02 approved image is already mapped to different entity revision or evidence in this Brief revision.");
          }
          const mappingEvidenceId = createPrefixedId("mpe");
          const mappingKey = `${mappingPrefix}${mappingEvidenceId}`;
          stagedVisualEntityMappings!.set(mappingKey, {
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            briefRevisionId: current.id,
            assetId,
            entityId: entity.entity_id,
            revisionId: entity.revision_id,
            assetSha256,
            referenceEvidenceId,
            usage,
            mappingEvidenceId,
          });
          return mappingEvidenceId;
        },
      });
      persistedShotSpecs = prepared.shotSpecs;
      persistedPromptPackages = prepared.promptPackages;
    }
    assertCreativeRevisionTransition(current.status, "READY_FOR_REVIEW");
    const timestamp = now();
    this.scripts.set(input.draft.scriptRevisionId, { id: input.draft.scriptRevisionId, creativeBriefRevisionId: current.id, status: "READY_FOR_REVIEW" });
    const storyboard: ControlStoryboardRevision = {
      id: input.draft.storyboardRevisionId,
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      scriptRevisionId: input.draft.scriptRevisionId,
      revision: 1,
      title: input.draft.title,
      summary: input.draft.summary,
      totalDurationSeconds: input.draft.totalDurationSeconds,
      continuityLevel: input.draft.continuityLevel,
      continuityNote: input.draft.continuityNote,
      status: "READY_FOR_REVIEW",
      shotSpecs: persistedShotSpecs.map(({ id, narrativeBeatSequences, ...shotSpec }) => ({
        id,
        ...shotSpec,
        narrativeBeatSequences: narrativeBeatSequences?.length ? narrativeBeatSequences : [shotSpec.sequence],
      })),
      narrativeBeatCount: input.draft.narrativeBeatCount ?? input.draft.beats.length,
      generationSegmentCount: input.draft.generationSegmentCount ?? input.draft.shotSpecs.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (stagedVisualEntityContexts) {
      this.visualEntityContexts.clear();
      for (const [key, context] of stagedVisualEntityContexts) this.visualEntityContexts.set(key, context);
    }
    if (stagedVisualEntityRevisionHistory) {
      this.visualEntityRevisionHistory.clear();
      for (const [key, revisions] of stagedVisualEntityRevisionHistory) this.visualEntityRevisionHistory.set(key, revisions);
    }
    if (stagedVisualEntityMappings) {
      this.visualEntityMappings.clear();
      for (const [key, mapping] of stagedVisualEntityMappings) this.visualEntityMappings.set(key, mapping);
    }
    this.storyboards.set(storyboard.id, storyboard);
    for (const promptPackage of persistedPromptPackages) this.promptPackages.set(promptPackage.id, { ...promptPackage });
    this.creativeBriefs.set(current.id, { ...current, status: "READY_FOR_REVIEW", updatedAt: timestamp });
    return storyboard;
  }

  async failCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; code: string; event: CreativePlanningEvent }) {
    const current = await this.findCreativeBriefRevision(input.workspaceId, input.creativeBriefRevisionId);
    if (!current || current.status !== "PLANNING") return current;
    assertCreativeRevisionTransition(current.status, "FAILED");
    const value = { ...current, status: "FAILED" as const, updatedAt: now() };
    this.creativeBriefs.set(value.id, value);
    return value;
  }

  async approveStoryboardRevision(input: ApproveStoryboardCommandInput): Promise<CreativePlanningCommandOutcome<ControlStoryboardRevision>> {
    const replay = await this.replayStoryboard(input);
    if (replay) return replay;
    const current = await this.findStoryboardRevision(input.workspaceId, input.storyboardRevisionId);
    if (!current) return this.store(input, { kind: "NOT_FOUND" });
    if (current.status !== "READY_FOR_REVIEW") return this.store(input, { kind: "STATE_INVALID" });
    const script = this.scripts.get(current.scriptRevisionId);
    const brief = script ? await this.findCreativeBriefRevision(input.workspaceId, script.creativeBriefRevisionId) : undefined;
    if (!script || !brief || script.status !== "READY_FOR_REVIEW" || brief.status !== "READY_FOR_REVIEW") return this.store(input, { kind: "STATE_INVALID" });
    assertCreativeRevisionTransition(current.status, "APPROVED");
    assertCreativeRevisionTransition(script.status, "APPROVED");
    assertCreativeRevisionTransition(brief.status, "APPROVED");
    const timestamp = now();
    const value = { ...current, status: "APPROVED" as const, updatedAt: timestamp };
    this.storyboards.set(value.id, value);
    this.scripts.set(script.id, { ...script, status: "APPROVED" });
    this.creativeBriefs.set(brief.id, { ...brief, status: "APPROVED", updatedAt: timestamp });
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "STORYBOARD", storyboardRevisionId: value.id }, status: 202 });
    return { kind: "NEW", value, status: 202 };
  }

  async createProductionRun(input: ProductionRunCommandInput): Promise<CreativePlanningCommandOutcome<ControlProductionRun>> {
    const replay = await this.replayProductionRun(input);
    if (replay) return replay;
    // This adapter has no durable narration timeline or asset snapshot, so it
    // cannot prove either replacement source. Keep both capabilities closed
    // rather than accepting a request that PostgreSQL would validate/freeze.
    if (input.audioSelection === "DOUBAO_TTS_REPLACE" || input.audioSelection === "MUSIC_REPLACE_PROVIDER_AUDIO") {
      return this.store(input, { kind: "PREFLIGHT_BLOCKED" });
    }
    const storyboard = await this.findStoryboardRevision(input.workspaceId, input.storyboardRevisionId);
    if (!storyboard || storyboard.projectId !== input.projectId) return this.store(input, { kind: "NOT_FOUND" });
    if (input.deliveryPlanRevisionId && this.deliveryPlanResolver) {
      const deliveryPlan = await this.deliveryPlanResolver.findDeliveryPlanRevision(input.workspaceId, input.deliveryPlanRevisionId);
      if (!deliveryPlan || deliveryPlan.projectId !== input.projectId || deliveryPlan.storyboardRevisionId !== storyboard.id) {
        return this.store(input, { kind: "NOT_FOUND" });
      }
      try {
        assertDeliveryPlanCanCreateProductionRun({
          status: deliveryPlan.status,
          block_reasons: deliveryPlan.blockReasons,
        });
      } catch {
        return this.store(input, { kind: "PREFLIGHT_BLOCKED" });
      }
    }
    if (this.activeProductionRun(input.workspaceId, input.projectId)) return this.store(input, { kind: "ACTIVE_CONFLICT" });
    try {
      assertProductionRunCreatable(storyboard.status);
      assertProductionRunTransition("DRAFT", "PLAN_READY");
      assertProductionRunTransition("PLAN_READY", "CONFIRMED");
    } catch {
      return this.store(input, { kind: "STATE_INVALID" });
    }
    const timestamp = now();
    const value: ControlProductionRun = {
      id: input.productionRunId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      storyboardRevisionId: storyboard.id,
      ...(input.deliveryPlanRevisionId ? { deliveryPlanRevisionId: input.deliveryPlanRevisionId } : {}),
      status: "CONFIRMED",
      totalShotCount: storyboard.shotSpecs.length,
      acceptedShotCount: 0,
      totalSegmentCount: storyboard.generationSegmentCount ?? storyboard.shotSpecs.length,
      acceptedSegmentCount: 0,
      totalDurationSeconds: storyboard.totalDurationSeconds,
      continuityStatus: "NOT_CHECKED",
      plannedSegmentCount: storyboard.generationSegmentCount ?? storyboard.shotSpecs.length,
      maxAutoRepairCount: 2,
      autoRepairCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.productionRuns.set(value.id, value);
    if (input.deliveryPlanRevisionId && this.deliveryPlanResolver) {
      const consumed = await this.deliveryPlanResolver.consumeDeliveryPlanRevision({
        workspaceId: input.workspaceId,
        deliveryPlanRevisionId: input.deliveryPlanRevisionId,
        productionRunId: value.id,
      });
      if (consumed.kind !== "CONSUMED") {
        this.productionRuns.delete(value.id);
        return this.store(input, { kind: consumed.kind === "NOT_FOUND" ? "NOT_FOUND" : "PREFLIGHT_BLOCKED" });
      }
    }
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "PRODUCTION_RUN", productionRunId: value.id }, status: 202 });
    return { kind: "NEW", value, status: 202 };
  }

  async claimCreativePlanningEvent(input: { message: InternalCreativePlanningQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<CreativePlanningEventClaim> {
    const message = InternalCreativePlanningQueueMessageSchema.parse(input.message);
    const brief = await this.findCreativeBriefRevision(message.workspace_id, message.creative_brief_revision_id);
    if (!brief || brief.projectId !== message.project_id) return { kind: "RETRY" };
    const key = `${message.workspace_id}:${message.event_id}:${input.consumerName}`;
    if (this.consumedEvents.has(key) || brief.status !== "PLANNING") return { kind: "DUPLICATE" };
    this.consumedEvents.add(key);
    return { kind: "CLAIMED", brief };
  }

  async completeCreativePlanningEvent() {
    return undefined;
  }

  async releaseCreativePlanningEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    const key = `${input.workspaceId}:${input.eventId}:${input.consumerName}`;
    if (input.deadLetter) this.consumedEvents.add(key);
    else this.consumedEvents.delete(key);
    return undefined;
  }

  private async sourcesAreReady(workspaceId: string, projectId: string, sourceAssetIds: string[]) {
    if (!this.sourceAssetResolver) return true;
    const assetsToCheck = await Promise.all(sourceAssetIds.map((assetId) => this.sourceAssetResolver!.findAsset(workspaceId, assetId)));
    return assetsToCheck.every((asset) => asset
      && asset.projectId === projectId
      && asset.status === "READY"
      && asset.origin === "USER_UPLOAD"
      && (asset.kind === "IMAGE" || asset.kind === "DOCUMENT"));
  }

  private async resolveDocumentContexts(input: Pick<CreativeBriefCommandInput, "workspaceId" | "projectId" | "sourceAssetIds">) {
    if (!this.sourceAssetResolver) return [];
    const selectedDocumentIds: string[] = [];
    for (const sourceAssetId of input.sourceAssetIds) {
      const asset = await this.sourceAssetResolver.findAsset(input.workspaceId, sourceAssetId);
      if (asset?.kind === "DOCUMENT") selectedDocumentIds.push(sourceAssetId);
    }
    if (selectedDocumentIds.length === 0) return [];
    if (!this.documentContextResolver || selectedDocumentIds.length > MAX_DOCUMENT_CONTEXTS_PER_BRIEF) return undefined;
    const contexts = await this.documentContextResolver.resolveDocumentContexts(input);
    if (!contexts || contexts.length !== selectedDocumentIds.length) return undefined;
    for (let index = 0; index < contexts.length; index += 1) {
      const context = contexts[index];
      if (!context || context.sourceAssetId !== selectedDocumentIds[index] || context.sequence !== index + 1 || context.maxContentCharacters < 1 || context.maxContentCharacters > MAX_DOCUMENT_CONTEXT_CHARACTERS) return undefined;
    }
    return contexts.map((context) => ({ ...context }));
  }

  private activeProductionRun(workspaceId: string, projectId: string) {
    return [...this.productionRuns.values()].some((value) => value.workspaceId === workspaceId && value.projectId === projectId && activeProductionStatuses.includes(value.status));
  }

  private async replayBrief(input: Pick<CreativeBriefCommandInput | PlanningCommandInput, "scope" | "idempotencyKey" | "requestHash">): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision> | undefined> {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.snapshot.kind === "CREATIVE_BRIEF") {
      const value = this.creativeBriefs.get(stored.snapshot.creativeBriefRevisionId);
      return value ? { kind: "REPLAY", value, status: stored.status } : { kind: "CONFLICT" };
    }
    return stored.snapshot.kind === "NOT_FOUND" || stored.snapshot.kind === "INVALID_SOURCE" || stored.snapshot.kind === "DOCUMENT_CONTEXT_INVALID" || stored.snapshot.kind === "DOCUMENT_KNOWLEDGE_NOT_READY" || stored.snapshot.kind === "DOCUMENT_FACT_CONTEXT_INVALID" || stored.snapshot.kind === "ACTIVE_CONFLICT" || stored.snapshot.kind === "STATE_INVALID" || stored.snapshot.kind === "PREFLIGHT_BLOCKED" ? stored.snapshot : { kind: "CONFLICT" };
  }

  private async replayStoryboard(input: Pick<ApproveStoryboardCommandInput, "scope" | "idempotencyKey" | "requestHash">): Promise<CreativePlanningCommandOutcome<ControlStoryboardRevision> | undefined> {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.snapshot.kind === "STORYBOARD") {
      const value = this.storyboards.get(stored.snapshot.storyboardRevisionId);
      return value ? { kind: "REPLAY", value, status: stored.status } : { kind: "CONFLICT" };
    }
    return stored.snapshot.kind === "NOT_FOUND" || stored.snapshot.kind === "INVALID_SOURCE" || stored.snapshot.kind === "DOCUMENT_KNOWLEDGE_NOT_READY" || stored.snapshot.kind === "DOCUMENT_FACT_CONTEXT_INVALID" || stored.snapshot.kind === "ACTIVE_CONFLICT" || stored.snapshot.kind === "STATE_INVALID" || stored.snapshot.kind === "PREFLIGHT_BLOCKED" ? stored.snapshot : { kind: "CONFLICT" };
  }

  private async replayProductionRun(input: Pick<ProductionRunCommandInput, "scope" | "idempotencyKey" | "requestHash">): Promise<CreativePlanningCommandOutcome<ControlProductionRun> | undefined> {
    const stored = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (!stored) return undefined;
    if (stored.requestHash !== input.requestHash) return { kind: "CONFLICT" };
    if (stored.snapshot.kind === "PRODUCTION_RUN") {
      const value = this.productionRuns.get(stored.snapshot.productionRunId);
      return value ? { kind: "REPLAY", value, status: stored.status } : { kind: "CONFLICT" };
    }
    return stored.snapshot.kind === "NOT_FOUND" || stored.snapshot.kind === "INVALID_SOURCE" || stored.snapshot.kind === "DOCUMENT_KNOWLEDGE_NOT_READY" || stored.snapshot.kind === "DOCUMENT_FACT_CONTEXT_INVALID" || stored.snapshot.kind === "ACTIVE_CONFLICT" || stored.snapshot.kind === "STATE_INVALID" || stored.snapshot.kind === "PREFLIGHT_BLOCKED" ? stored.snapshot : { kind: "CONFLICT" };
  }

  private store<T>(input: Pick<CreativeBriefCommandInput | PlanningCommandInput | ApproveStoryboardCommandInput | ProductionRunCommandInput, "scope" | "idempotencyKey" | "requestHash">, snapshot: Exclude<StoredSnapshot, { kind: "CREATIVE_BRIEF" | "STORYBOARD" | "PRODUCTION_RUN" }>): CreativePlanningCommandOutcome<T> {
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot, status: 202 });
    return snapshot;
  }
}

type Transaction = Pick<PlatformDatabase, "execute" | "select" | "insert" | "update">;

const commandScope = (scope: string, idempotencyKey: string) => and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const reserveCommand = async (transaction: Transaction, input: { scope: string; idempotencyKey: string; requestHash: string }) => {
  const [inserted] = await transaction
    .insert(commandDeduplications)
    .values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} })
    .onConflictDoNothing()
    .returning({ scope: commandDeduplications.scope });
  if (inserted) return undefined;
  const [existing] = await transaction
    .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
    .from(commandDeduplications)
    .where(commandScope(input.scope, input.idempotencyKey))
    .limit(1);
  if (!existing || existing.requestHash !== input.requestHash) return "CONFLICT" as const;
  return existing.responseSnapshot as StoredSnapshot;
};

const storeSnapshot = (transaction: Transaction, input: { scope: string; idempotencyKey: string }, snapshot: StoredSnapshot) =>
  transaction.update(commandDeduplications).set({ responseSnapshot: snapshot }).where(commandScope(input.scope, input.idempotencyKey));

const advisoryProjectLock = (transaction: Transaction, workspaceId: string, projectId: string) =>
  transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${projectId}))`);

const sourceAssetsAreReady = async (transaction: Transaction, workspaceId: string, projectId: string, sourceAssetIds: string[]) => {
  if (sourceAssetIds.length === 0) return true;
  if (new Set(sourceAssetIds).size !== sourceAssetIds.length) return false;
  const rows = await transaction
    .select({ id: assets.id, status: assets.status, origin: assets.origin, kind: assets.kind })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.projectId, projectId), inArray(assets.id, sourceAssetIds)));
  return rows.length === sourceAssetIds.length && rows.every((asset) =>
    asset.status === "READY"
    && asset.origin === "USER_UPLOAD"
    && (asset.kind === "IMAGE" || asset.kind === "DOCUMENT"));
};

const resolveDocumentContexts = async (transaction: Transaction, workspaceId: string, projectId: string, sourceAssetIds: string[]): Promise<ControlPlanningDocumentContext[] | undefined> => {
  if (new Set(sourceAssetIds).size !== sourceAssetIds.length) return undefined;
  if (sourceAssetIds.length === 0) return [];
  const sourceRows = await transaction
    .select({ id: assets.id, status: assets.status, origin: assets.origin, kind: assets.kind })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.projectId, projectId), inArray(assets.id, sourceAssetIds)));
  if (sourceRows.length !== sourceAssetIds.length || sourceRows.some((asset) =>
    asset.status !== "READY"
    || asset.origin !== "USER_UPLOAD"
    || (asset.kind !== "IMAGE" && asset.kind !== "DOCUMENT"))) return undefined;
  const sourceKinds = new Map(sourceRows.map((asset) => [asset.id, asset.kind]));
  const documentSourceIds = sourceAssetIds.filter((assetId) => sourceKinds.get(assetId) === "DOCUMENT");
  if (documentSourceIds.length === 0) return [];
  if (documentSourceIds.length > MAX_DOCUMENT_CONTEXTS_PER_BRIEF) return undefined;
  const rows = await transaction
    .select({
      documentId: documents.id,
      documentStatus: documents.status,
      conversionId: documentConversions.id,
      sourceAssetId: documents.sourceAssetId,
      markdownAssetId: assets.id,
      markdownSha256: assets.sha256,
      markdownObjectKey: assets.objectKey,
      markdownStatus: assets.status,
      markdownOrigin: assets.origin,
      markdownKind: assets.kind,
      markdownMimeType: assets.mimeType,
    })
    .from(documents)
    .innerJoin(documentConversions, and(
      eq(documentConversions.workspaceId, documents.workspaceId),
      eq(documentConversions.projectId, documents.projectId),
      eq(documentConversions.documentId, documents.id),
      eq(documentConversions.sourceAssetId, documents.sourceAssetId),
      eq(documentConversions.status, "SUCCEEDED"),
    ))
    .innerJoin(assets, and(
      eq(assets.workspaceId, documentConversions.workspaceId),
      eq(assets.projectId, documentConversions.projectId),
      eq(assets.id, documentConversions.markdownAssetId),
    ))
    .where(and(
      eq(documents.workspaceId, workspaceId),
      eq(documents.projectId, projectId),
      inArray(documents.sourceAssetId, documentSourceIds),
    ));
  if (rows.length !== documentSourceIds.length || rows.some((row) =>
    row.documentStatus !== "READY"
    || !row.markdownSha256
    || row.markdownStatus !== "READY"
    || row.markdownOrigin !== "DERIVED"
    || row.markdownKind !== "DOCUMENT"
    || row.markdownMimeType !== "text/markdown")) return undefined;
  const bySource = new Map(rows.map((row) => [row.sourceAssetId, row]));
  return documentSourceIds.map((sourceAssetId, index) => {
    const row = bySource.get(sourceAssetId);
    if (!row || !row.markdownSha256) throw new Error("Document context resolution lost a selected source asset.");
    return {
      documentId: row.documentId,
      conversionId: row.conversionId,
      sourceAssetId: row.sourceAssetId,
      markdownAssetId: row.markdownAssetId,
      markdownSha256: row.markdownSha256,
      markdownObjectKey: row.markdownObjectKey,
      sequence: index + 1,
      maxContentCharacters: MAX_DOCUMENT_CONTEXT_CHARACTERS,
    };
  });
};

const loadDocumentContexts = async (transaction: Pick<PlatformDatabase, "select">, workspaceId: string, creativeBriefRevisionId: string): Promise<ControlPlanningDocumentContext[]> => {
  const rows = await transaction
    .select({ context: creativeBriefDocumentContexts, markdownObjectKey: assets.objectKey })
    .from(creativeBriefDocumentContexts)
    .innerJoin(assets, and(
      eq(assets.workspaceId, creativeBriefDocumentContexts.workspaceId),
      eq(assets.projectId, creativeBriefDocumentContexts.projectId),
      eq(assets.id, creativeBriefDocumentContexts.markdownAssetId),
    ))
    .where(and(
      eq(creativeBriefDocumentContexts.workspaceId, workspaceId),
      eq(creativeBriefDocumentContexts.creativeBriefRevisionId, creativeBriefRevisionId),
    ))
    .orderBy(asc(creativeBriefDocumentContexts.sequence));
  return rows.map(({ context, markdownObjectKey }) => ({
    documentId: context.documentId,
    conversionId: context.conversionId,
    sourceAssetId: context.sourceAssetId,
    markdownAssetId: context.markdownAssetId,
    markdownSha256: context.markdownSha256,
    markdownObjectKey,
    sequence: context.sequence,
    maxContentCharacters: context.maxContentCharacters,
  }));
};

type FactContextResolution =
  | { kind: "READY"; contexts: CreativeBriefFactContext[]; rows: Array<{ fact: FrozenDocumentFact; knowledgeRevisionId: string }> }
  | { kind: "DOCUMENT_KNOWLEDGE_NOT_READY" | "DOCUMENT_FACT_CONTEXT_INVALID" };

const resolveFactContexts = async (
  transaction: Pick<PlatformDatabase, "select">,
  input: { workspaceId: string; projectId: string; creativeBriefRevisionId: string; sourceText: string; stylePreferences: string; documentContexts: ControlPlanningDocumentContext[] },
): Promise<FactContextResolution> => {
  if (input.documentContexts.length === 0) return { kind: "READY", contexts: [], rows: [] };
  const conversionIds = input.documentContexts.map((context) => context.conversionId);
  const revisions = await transaction.select({
    revision: documentKnowledgeRevisions,
    assetSha256: assets.sha256,
  }).from(documentKnowledgeRevisions).innerJoin(assets, and(
    eq(assets.workspaceId, documentKnowledgeRevisions.workspaceId),
    eq(assets.projectId, documentKnowledgeRevisions.projectId),
    eq(assets.id, documentKnowledgeRevisions.markdownAssetId),
  )).where(and(
    eq(documentKnowledgeRevisions.workspaceId, input.workspaceId),
    eq(documentKnowledgeRevisions.projectId, input.projectId),
    inArray(documentKnowledgeRevisions.conversionId, conversionIds),
  ));
  const byConversion = new Map(revisions.map((row) => [row.revision.conversionId, row]));
  for (const context of input.documentContexts) {
    const row = byConversion.get(context.conversionId);
    if (!row || row.revision.status !== "READY") return { kind: "DOCUMENT_KNOWLEDGE_NOT_READY" };
    if (row.revision.markdownSha256 !== context.markdownSha256 || row.assetSha256 !== context.markdownSha256) return { kind: "DOCUMENT_FACT_CONTEXT_INVALID" };
  }
  // New real briefs retain frozen Markdown contexts and do not persist a
  // keyword-ranked subset of legacy document facts. Historical contexts stay
  // readable through loadFactContexts, while new rows remain empty.
  return { kind: "READY", contexts: [], rows: [] };
};

const loadFactContexts = async (transaction: Pick<PlatformDatabase, "select">, workspaceId: string, creativeBriefRevisionId: string): Promise<CreativeBriefFactContext[]> => {
  const rows = await transaction.select().from(creativeBriefFactContexts).where(and(
    eq(creativeBriefFactContexts.workspaceId, workspaceId),
    eq(creativeBriefFactContexts.creativeBriefRevisionId, creativeBriefRevisionId),
  )).orderBy(asc(creativeBriefFactContexts.sequence));
  return rows.map((row) => ({
    creative_brief_revision_id: row.creativeBriefRevisionId,
    fact_id: row.factId,
    sequence: row.sequence,
    fact: {
      fact_id: row.factId,
      category: row.category,
      statement: row.statement,
      confidence: row.confidence,
      source: { document_id: row.documentId, conversion_id: row.conversionId, section_sequence: row.sectionSequence, locator: row.locator },
    },
    selection_reason: row.selectionReason,
    snapshot_hash: row.snapshotHash,
  }));
};

const loadStoryboard = async (transaction: Pick<PlatformDatabase, "select">, workspaceId: string, storyboardRevisionId: string, forUpdate = false) => {
  const query = transaction
    .select()
    .from(storyboardRevisions)
    .where(and(eq(storyboardRevisions.workspaceId, workspaceId), eq(storyboardRevisions.id, storyboardRevisionId)))
    .limit(1);
  const [storyboard] = forUpdate ? await query.for("update") : await query;
  if (!storyboard) return undefined;
  const [script] = await transaction
    .select({ beats: scriptRevisions.beats })
    .from(scriptRevisions)
    .where(and(eq(scriptRevisions.workspaceId, workspaceId), eq(scriptRevisions.id, storyboard.scriptRevisionId)))
    .limit(1);
  const specs = await transaction
    .select()
    .from(storyboardShotSpecs)
    .where(and(eq(storyboardShotSpecs.workspaceId, workspaceId), eq(storyboardShotSpecs.storyboardRevisionId, storyboardRevisionId)))
    .orderBy(asc(storyboardShotSpecs.sequence));
  return { storyboard, script, specs };
};

export class DrizzleCreativePlanningRepository implements CreativePlanningStore {
  constructor(private readonly db: PlatformDatabase) {}

  async listProjectCreativeBriefRevisions(workspaceId: string, projectId: string) {
    const values = await this.db
      .select()
      .from(creativeBriefRevisions)
      .where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.projectId, projectId)))
      .orderBy(asc(creativeBriefRevisions.revision));
    return Promise.all(values.map(async (value) => serializeCreativeBrief(value, await loadDocumentContexts(this.db, workspaceId, value.id), await loadFactContexts(this.db, workspaceId, value.id))));
  }

  async findCreativeBriefRevision(workspaceId: string, creativeBriefRevisionId: string) {
    const [value] = await this.db
      .select()
      .from(creativeBriefRevisions)
      .where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, creativeBriefRevisionId)))
      .limit(1);
    return value ? serializeCreativeBrief(value, await loadDocumentContexts(this.db, workspaceId, value.id), await loadFactContexts(this.db, workspaceId, value.id)) : undefined;
  }

  async listProjectStoryboardRevisions(workspaceId: string, projectId: string) {
    const values = await this.db
      .select()
      .from(storyboardRevisions)
      .where(and(eq(storyboardRevisions.workspaceId, workspaceId), eq(storyboardRevisions.projectId, projectId)))
      .orderBy(asc(storyboardRevisions.createdAt));
    return Promise.all(values.map(async (value) => {
      const loaded = await loadStoryboard(this.db, workspaceId, value.id);
      return loaded ? serializeStoryboard(loaded.storyboard, loaded.specs, loaded.script?.beats.length ?? 0) : undefined;
    })).then((rows) => rows.filter((row): row is ControlStoryboardRevision => Boolean(row)));
  }

  async findStoryboardRevision(workspaceId: string, storyboardRevisionId: string) {
    const loaded = await loadStoryboard(this.db, workspaceId, storyboardRevisionId);
    return loaded ? serializeStoryboard(loaded.storyboard, loaded.specs, loaded.script?.beats.length ?? 0) : undefined;
  }

  async listStoryboardDialogueProjections(workspaceId: string, storyboardRevisionId: string) {
    const specs = await this.db
      .select({ id: storyboardShotSpecs.id, sequence: storyboardShotSpecs.sequence })
      .from(storyboardShotSpecs)
      .where(and(
        eq(storyboardShotSpecs.workspaceId, workspaceId),
        eq(storyboardShotSpecs.storyboardRevisionId, storyboardRevisionId),
      ))
      .orderBy(asc(storyboardShotSpecs.sequence));
    if (specs.length === 0) return [];
    const rows = await this.db
      .select({
        shotSpecId: promptPackages.shotSpecId,
        capabilitySnapshot: promptPackages.capabilitySnapshot,
        createdAt: promptPackages.createdAt,
      })
      .from(promptPackages)
      .where(and(
        eq(promptPackages.workspaceId, workspaceId),
        inArray(promptPackages.shotSpecId, specs.map((spec) => spec.id)),
      ))
      .orderBy(desc(promptPackages.createdAt));
    const latestByShot = new Map<string, SemanticDialogueProjection>();
    for (const row of rows) {
      if (latestByShot.has(row.shotSpecId)) continue;
      const projection = readDialogueProjection(row.capabilitySnapshot);
      if (projection) latestByShot.set(row.shotSpecId, projection);
    }
    return specs.flatMap((spec) => {
      const projection = latestByShot.get(spec.id);
      return projection ? [projection] : [];
    });
  }

  async listStoryboardMusicIntentHints(workspaceId: string, storyboardRevisionId: string) {
    const specs = await this.db
      .select({ id: storyboardShotSpecs.id, sequence: storyboardShotSpecs.sequence })
      .from(storyboardShotSpecs)
      .where(and(
        eq(storyboardShotSpecs.workspaceId, workspaceId),
        eq(storyboardShotSpecs.storyboardRevisionId, storyboardRevisionId),
      ))
      .orderBy(asc(storyboardShotSpecs.sequence));
    if (specs.length === 0) return [];
    const rows = await this.db
      .select({
        shotSpecId: promptPackages.shotSpecId,
        capabilitySnapshot: promptPackages.capabilitySnapshot,
        createdAt: promptPackages.createdAt,
      })
      .from(promptPackages)
      .where(and(
        eq(promptPackages.workspaceId, workspaceId),
        inArray(promptPackages.shotSpecId, specs.map((spec) => spec.id)),
      ))
      .orderBy(desc(promptPackages.createdAt));
    const latestByShot = new Map<string, string>();
    const seenShots = new Set<string>();
    for (const row of rows) {
      if (seenShots.has(row.shotSpecId)) continue;
      seenShots.add(row.shotSpecId);
      const hint = readMusicIntentHint(row.capabilitySnapshot);
      if (hint) latestByShot.set(row.shotSpecId, hint);
    }
    return specs.flatMap((spec) => {
      const hint = latestByShot.get(spec.id);
      return hint ? [hint] : [];
    });
  }

  async resolveCanonicalReferenceSources(workspaceId: string, projectId: string, sourceAssetIds: string[], sourceAssetRoles: ControlCreativeBriefSourceAssetRole[] = []) {
    const orderedIds = [...new Set(sourceAssetIds)];
    if (orderedIds.length === 0) return [];
    const roleByAssetId = new Map(sourceAssetRoles.map((reference) => [reference.assetId, reference]));
    const rows = await this.db
      .select({
        id: assets.id,
        projectId: assets.projectId,
        status: assets.status,
        origin: assets.origin,
        kind: assets.kind,
        sha256: assets.sha256,
        mimeType: assets.mimeType,
        metadata: assets.metadata,
      })
      .from(assets)
      .where(and(
        eq(assets.workspaceId, workspaceId),
        inArray(assets.id, orderedIds),
      ));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const results: CanonicalReferenceSource[] = [];
    for (const assetId of orderedIds) {
      const asset = byId.get(assetId);
      if (!asset
        || asset.projectId !== projectId
        || asset.status !== "READY"
        || asset.origin !== "USER_UPLOAD") return undefined;
      if (asset.kind === "DOCUMENT") continue;
      if (asset.kind !== "IMAGE" || results.length >= 7) return undefined;
      if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !isCanonicalReferenceMime(asset.mimeType)) return undefined;
      const objectiveDescription = objectiveReferenceDescription(asset.metadata ?? undefined);
      const declaredRole = roleByAssetId.get(asset.id);
      const providerRole = declaredRole?.role ?? objectiveReferenceRole(asset.metadata ?? undefined);
      results.push({
        asset_id: asset.id,
        asset_sha256: asset.sha256,
        mime_type: asset.mimeType,
        position: results.length,
        ...(providerRole ? { provider_role: providerRole } : {}),
        ...(typeof declaredRole?.usage === "string" ? { user_declared_usage: declaredRole.usage } : {}),
        ...(objectiveDescription ? { objective_description: objectiveDescription } : {}),
      });
    }
    return results;
  }

  async resolveCanonicalVisualEntityContext(workspaceId: string, projectId: string) {
    const rows = await this.db
      .select({
        entityId: canonicalVisualEntities.id,
        entityKind: canonicalVisualEntities.entityKind,
        normalizedIdentity: canonicalVisualEntities.normalizedIdentity,
        revisionId: canonicalVisualEntityRevisions.id,
        revisionNumber: canonicalVisualEntityRevisions.revisionNumber,
        contentHash: canonicalVisualEntityRevisions.contentHash,
        exactName: canonicalVisualEntityRevisions.exactName,
        role: canonicalVisualEntityRevisions.role,
        description: canonicalVisualEntityRevisions.description,
        appearance: canonicalVisualEntityRevisions.appearance,
        styling: canonicalVisualEntityRevisions.styling,
        location: canonicalVisualEntityRevisions.location,
        time: canonicalVisualEntityRevisions.time,
        prompt: canonicalVisualEntityRevisions.prompt,
        lighting: canonicalVisualEntityRevisions.lighting,
        type: canonicalVisualEntityRevisions.type,
      })
      .from(canonicalVisualEntities)
      .innerJoin(canonicalVisualEntityRevisions, and(
        eq(canonicalVisualEntityRevisions.workspaceId, canonicalVisualEntities.workspaceId),
        eq(canonicalVisualEntityRevisions.projectId, canonicalVisualEntities.projectId),
        eq(canonicalVisualEntityRevisions.entityId, canonicalVisualEntities.id),
      ))
      .where(and(
        eq(canonicalVisualEntities.workspaceId, workspaceId),
        eq(canonicalVisualEntities.projectId, projectId),
      ))
      .orderBy(
        asc(canonicalVisualEntities.entityKind),
        asc(canonicalVisualEntities.normalizedIdentity),
        desc(canonicalVisualEntityRevisions.revisionNumber),
      );
    const latestByEntity = new Map<string, CanonicalVisualEntityContext>();
    for (const row of rows) {
      if (latestByEntity.has(row.entityId)) continue;
      latestByEntity.set(row.entityId, {
        entity_id: row.entityId,
        entity_kind: row.entityKind,
        normalized_identity: row.normalizedIdentity,
        revision_id: row.revisionId,
        revision_number: row.revisionNumber,
        content_hash: row.contentHash,
        exact_name: row.exactName,
        ...(row.role !== null ? { role: row.role } : {}),
        ...(row.description !== null ? { description: row.description } : {}),
        ...(row.appearance !== null ? { appearance: row.appearance } : {}),
        ...(row.styling !== null ? { styling: row.styling } : {}),
        ...(row.location !== null ? { location: row.location } : {}),
        ...(row.time !== null ? { time: row.time } : {}),
        ...(row.prompt !== null ? { prompt: row.prompt } : {}),
        ...(row.lighting !== null ? { lighting: row.lighting } : {}),
        ...(row.type !== null ? { type: row.type } : {}),
      });
    }
    return [...latestByEntity.values()];
  }

  async listProjectProductionRuns(workspaceId: string, projectId: string) {
    const values = await this.db
      .select()
      .from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.projectId, projectId)))
      .orderBy(asc(productionRuns.createdAt));
    return values.map(serializeProductionRun);
  }

  async createCreativeBriefRevision(input: CreativeBriefCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>> {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveCommand(transaction, input);
      if (reservation) return this.replayCreativeBrief(transaction, input.workspaceId, reservation, 201);
      await advisoryProjectLock(transaction, input.workspaceId, input.projectId);
      const [project] = await transaction
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.id, input.projectId)))
        .limit(1);
      if (!project) return this.storeOutcome(transaction, input, { kind: "NOT_FOUND" });
      if (!(await sourceAssetsAreReady(transaction, input.workspaceId, input.projectId, input.sourceAssetIds))) {
        return this.storeOutcome(transaction, input, { kind: "INVALID_SOURCE" });
      }
      const documentContexts = await resolveDocumentContexts(transaction, input.workspaceId, input.projectId, input.sourceAssetIds);
      if (!documentContexts) return this.storeOutcome(transaction, input, { kind: "DOCUMENT_CONTEXT_INVALID" });
      const factResolution = await resolveFactContexts(transaction, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        creativeBriefRevisionId: input.creativeBriefRevisionId,
        sourceText: input.sourceText,
        stylePreferences: input.stylePreferences,
        documentContexts,
      });
      if (factResolution.kind !== "READY") return this.storeOutcome(transaction, input, { kind: factResolution.kind });
      const [previous] = await transaction
        .select({ revision: creativeBriefRevisions.revision })
        .from(creativeBriefRevisions)
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.projectId, input.projectId)))
        .orderBy(desc(creativeBriefRevisions.revision))
        .limit(1);
      const [value] = await transaction
        .insert(creativeBriefRevisions)
        .values({
          id: input.creativeBriefRevisionId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          revision: (previous?.revision ?? 0) + 1,
          sourceText: input.sourceText,
          targetDurationSeconds: input.targetDurationSeconds,
          targetResolution: input.targetResolution,
          stylePreferences: input.stylePreferences,
          sourceAssetIds: input.sourceAssetIds,
          sourceAssetRoles: (input.sourceAssetRoles ?? []).map((reference) => ({
            asset_id: reference.assetId,
            role: reference.role,
            ...(reference.usage ? { usage: reference.usage } : {}),
          })),
          status: "DRAFT",
        })
        .returning();
      if (documentContexts.length > 0) {
        await transaction.insert(creativeBriefDocumentContexts).values(documentContexts.map((context) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          creativeBriefRevisionId: value.id,
          documentId: context.documentId,
          conversionId: context.conversionId,
          sourceAssetId: context.sourceAssetId,
          markdownAssetId: context.markdownAssetId,
          markdownSha256: context.markdownSha256,
          sequence: context.sequence,
          maxContentCharacters: context.maxContentCharacters,
        })));
      }
      if (factResolution.rows.length > 0) {
        await transaction.insert(creativeBriefFactContexts).values(factResolution.rows.map(({ fact, knowledgeRevisionId }, index) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          creativeBriefRevisionId: value!.id,
          knowledgeRevisionId,
          factId: fact.fact_id,
          sequence: index + 1,
          category: fact.category,
          statement: fact.statement,
          confidence: fact.confidence,
          documentId: fact.source.document_id,
          conversionId: fact.source.conversion_id,
          sectionSequence: fact.source.section_sequence,
          locator: fact.source.locator,
          selectionReason: factResolution.contexts[index]!.selection_reason,
          snapshotHash: factResolution.contexts[index]!.snapshot_hash,
        })));
      }
      await storeSnapshot(transaction, input, { kind: "CREATIVE_BRIEF", creativeBriefRevisionId: value.id });
      return { kind: "NEW", value: serializeCreativeBrief(value, documentContexts, factResolution.contexts), status: 201 };
    });
  }

  async resolveVisualObjectLocks(_input: { workspaceId: string; projectId: string; sourceAssetIds: string[]; sourcePrompt?: string }): Promise<KeyVisualObjectLock[]> {
    // Objective image observations are not semantic continuity decisions.
    // Verified Semantic Director locks are projected explicitly by the semantic planning path.
    return [];
  }

  async requestCreativePlan(input: PlanningCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>> {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveCommand(transaction, input);
      if (reservation) return this.replayCreativeBrief(transaction, input.workspaceId, reservation, 202);
      const [current] = await transaction
        .select()
        .from(creativeBriefRevisions)
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, input.creativeBriefRevisionId)))
        .limit(1)
        .for("update");
      if (!current) return this.storeOutcome(transaction, input, { kind: "NOT_FOUND" });
      if (current.status === "PLANNING") return this.storeOutcome(transaction, input, { kind: "ACTIVE_CONFLICT" });
      if (current.status !== "DRAFT" && current.status !== "FAILED") return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      assertCreativeRevisionTransition(current.status, "PLANNING");
      const [value] = await transaction
        .update(creativeBriefRevisions)
        .set({ status: "PLANNING", error: null, updatedAt: now() })
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, input.creativeBriefRevisionId), eq(creativeBriefRevisions.status, current.status)))
        .returning();
      if (!value) return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      await transaction.insert(outboxEvents).values(eventRow({
        event: input.event,
        producer: "control-api",
        workspaceId: value.workspaceId,
        projectId: value.projectId,
        aggregateType: "creative_brief_revision",
        aggregateId: value.id,
        eventType: "creative_brief.planning_requested",
        data: { creative_brief_revision_id: value.id },
      }));
      await storeSnapshot(transaction, input, { kind: "CREATIVE_BRIEF", creativeBriefRevisionId: value.id });
      return { kind: "NEW", value: serializeCreativeBrief(value, await loadDocumentContexts(transaction, input.workspaceId, value.id), await loadFactContexts(transaction, input.workspaceId, value.id)), status: 202 };
    });
  }

  async completeCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; draft: CreativePlanningDraft; event: CreativePlanningEvent; semanticVisualEntitySemantics?: SemanticVisualEntityPersistenceSemantics }) {
    return this.db.transaction(async (transaction) => {
      const [brief] = await transaction
        .select()
        .from(creativeBriefRevisions)
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, input.creativeBriefRevisionId)))
        .limit(1)
        .for("update");
      if (!brief) return undefined;
      const [existingScript] = await transaction
        .select()
        .from(scriptRevisions)
        .where(and(eq(scriptRevisions.workspaceId, input.workspaceId), eq(scriptRevisions.creativeBriefRevisionId, brief.id)))
        .orderBy(desc(scriptRevisions.revision))
        .limit(1);
      if (existingScript) {
        const [existingStoryboard] = await transaction
          .select({ id: storyboardRevisions.id })
          .from(storyboardRevisions)
          .where(and(eq(storyboardRevisions.workspaceId, input.workspaceId), eq(storyboardRevisions.scriptRevisionId, existingScript.id)))
          .orderBy(desc(storyboardRevisions.revision))
          .limit(1);
        const existing = existingStoryboard ? await loadStoryboard(transaction, input.workspaceId, existingStoryboard.id) : undefined;
        return existing ? serializeStoryboard(existing.storyboard, existing.specs, existing.script?.beats.length ?? 0) : undefined;
      }
      if (brief.status !== "PLANNING" || brief.targetDurationSeconds !== input.draft.totalDurationSeconds) return undefined;
      planIsValid(input.draft);
      const compiledPromptPackages = validatePromptPackages(input.draft);
      let persistedShotSpecs = input.draft.shotSpecs;
      let persistedPromptPackages = compiledPromptPackages;
      const isG02Source = hasG02SourceMarker(brief.sourceText);
      const hasG02Draft = compiledPromptPackages.some(promptPackageHasG02Fields);
      if (isG02Source && (!hasG02Draft || !input.semanticVisualEntitySemantics)) {
        throw new Error("G02 persistence requires the validated source semantic callbacks.");
      }
      if (!isG02Source && (hasG02Draft || input.semanticVisualEntitySemantics)) {
        throw new Error("G02 private planning fields or callbacks cannot be applied without a locked Brief source marker.");
      }
      if (input.semanticVisualEntitySemantics) {
        if (!hasG02Draft) throw new Error("G02 semantic callbacks cannot be applied to a legacy planning draft.");
        const prepared = await completeG02PlanningDraft({
          brief: serializeCreativeBrief(brief),
          draft: input.draft,
          promptPackages: compiledPromptPackages,
          semantics: input.semanticVisualEntitySemantics,
          resolveEntity: async (candidate) => {
            const seed = mergeSemanticVisualCandidate(candidate, undefined, input.semanticVisualEntitySemantics!);
            const [claimedEntity] = await transaction
              .insert(canonicalVisualEntities)
              .values({
                id: createPrefixedId("cve"),
                workspaceId: brief.workspaceId,
                projectId: brief.projectId,
                entityKind: candidate.kind,
                normalizedIdentity: seed.normalizedIdentity,
              })
              .onConflictDoNothing({ target: [
                canonicalVisualEntities.workspaceId,
                canonicalVisualEntities.projectId,
                canonicalVisualEntities.entityKind,
                canonicalVisualEntities.normalizedIdentity,
              ] })
              .returning();
            const [entity] = claimedEntity
              ? [claimedEntity]
              : await transaction
                .select()
                .from(canonicalVisualEntities)
                .where(and(
                  eq(canonicalVisualEntities.workspaceId, brief.workspaceId),
                  eq(canonicalVisualEntities.projectId, brief.projectId),
                  eq(canonicalVisualEntities.entityKind, candidate.kind),
                  eq(canonicalVisualEntities.normalizedIdentity, seed.normalizedIdentity),
                ))
                .limit(1)
                .for("update");
            if (!entity
              || entity.workspaceId !== brief.workspaceId
              || entity.projectId !== brief.projectId
              || entity.entityKind !== candidate.kind
              || entity.normalizedIdentity !== seed.normalizedIdentity) {
              throw new Error("G02 canonical entity identity claim could not be resolved in the frozen project scope.");
            }
            const [latestRevision] = await transaction
              .select()
              .from(canonicalVisualEntityRevisions)
              .where(and(
                eq(canonicalVisualEntityRevisions.workspaceId, brief.workspaceId),
                eq(canonicalVisualEntityRevisions.projectId, brief.projectId),
                eq(canonicalVisualEntityRevisions.entityId, entity.id),
              ))
              .orderBy(desc(canonicalVisualEntityRevisions.revisionNumber))
              .limit(1)
              .for("update");
            const existingContext: CanonicalVisualEntityContext | undefined = latestRevision ? {
              entity_id: entity.id,
              entity_kind: entity.entityKind,
              normalized_identity: entity.normalizedIdentity,
              revision_id: latestRevision.id,
              revision_number: latestRevision.revisionNumber,
              content_hash: latestRevision.contentHash,
              exact_name: latestRevision.exactName,
              ...(latestRevision.role !== null ? { role: latestRevision.role } : {}),
              ...(latestRevision.description !== null ? { description: latestRevision.description } : {}),
              ...(latestRevision.appearance !== null ? { appearance: latestRevision.appearance } : {}),
              ...(latestRevision.styling !== null ? { styling: latestRevision.styling } : {}),
              ...(latestRevision.location !== null ? { location: latestRevision.location } : {}),
              ...(latestRevision.time !== null ? { time: latestRevision.time } : {}),
              ...(latestRevision.prompt !== null ? { prompt: latestRevision.prompt } : {}),
              ...(latestRevision.lighting !== null ? { lighting: latestRevision.lighting } : {}),
              ...(latestRevision.type !== null ? { type: latestRevision.type } : {}),
            } : undefined;
            const merged = mergeSemanticVisualCandidate(candidate, existingContext, input.semanticVisualEntitySemantics!);
            if (!/^[a-f0-9]{64}$/u.test(merged.contentHash)) throw new Error("G02 canonical entity content hash is invalid.");
            if (latestRevision?.contentHash === merged.contentHash && existingContext) return existingContext;
            const [matchingRevision] = await transaction
              .select()
              .from(canonicalVisualEntityRevisions)
              .where(and(
                eq(canonicalVisualEntityRevisions.workspaceId, brief.workspaceId),
                eq(canonicalVisualEntityRevisions.projectId, brief.projectId),
                eq(canonicalVisualEntityRevisions.entityId, entity.id),
                eq(canonicalVisualEntityRevisions.contentHash, merged.contentHash),
              ))
              .limit(1)
              .for("update");
            if (matchingRevision) {
              return {
                entity_id: entity.id,
                entity_kind: entity.entityKind,
                normalized_identity: entity.normalizedIdentity,
                revision_id: matchingRevision.id,
                revision_number: matchingRevision.revisionNumber,
                content_hash: matchingRevision.contentHash,
                exact_name: matchingRevision.exactName,
                ...(matchingRevision.role !== null ? { role: matchingRevision.role } : {}),
                ...(matchingRevision.description !== null ? { description: matchingRevision.description } : {}),
                ...(matchingRevision.appearance !== null ? { appearance: matchingRevision.appearance } : {}),
                ...(matchingRevision.styling !== null ? { styling: matchingRevision.styling } : {}),
                ...(matchingRevision.location !== null ? { location: matchingRevision.location } : {}),
                ...(matchingRevision.time !== null ? { time: matchingRevision.time } : {}),
                ...(matchingRevision.prompt !== null ? { prompt: matchingRevision.prompt } : {}),
                ...(matchingRevision.lighting !== null ? { lighting: matchingRevision.lighting } : {}),
                ...(matchingRevision.type !== null ? { type: matchingRevision.type } : {}),
              };
            }
            const [revision] = await transaction
              .insert(canonicalVisualEntityRevisions)
              .values({
                id: createPrefixedId("cvr"),
                workspaceId: brief.workspaceId,
                projectId: brief.projectId,
                entityId: entity.id,
                revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
                exactName: merged.exactName,
                contentHash: merged.contentHash,
                role: merged.role,
                description: merged.description,
                appearance: merged.appearance,
                styling: merged.styling,
                location: merged.location,
                time: merged.time,
                prompt: merged.prompt,
                lighting: merged.lighting,
                type: merged.type,
              })
              .returning();
            if (!revision) throw new Error("G02 canonical entity revision append did not return a row.");
            return {
              entity_id: entity.id,
              entity_kind: entity.entityKind,
              normalized_identity: entity.normalizedIdentity,
              revision_id: revision.id,
              revision_number: revision.revisionNumber,
              content_hash: revision.contentHash,
              exact_name: revision.exactName,
              ...(revision.role !== null ? { role: revision.role } : {}),
              ...(revision.description !== null ? { description: revision.description } : {}),
              ...(revision.appearance !== null ? { appearance: revision.appearance } : {}),
              ...(revision.styling !== null ? { styling: revision.styling } : {}),
              ...(revision.location !== null ? { location: revision.location } : {}),
              ...(revision.time !== null ? { time: revision.time } : {}),
              ...(revision.prompt !== null ? { prompt: revision.prompt } : {}),
              ...(revision.lighting !== null ? { lighting: revision.lighting } : {}),
              ...(revision.type !== null ? { type: revision.type } : {}),
            };
          },
          resolveAsset: async (assetId) => {
            const [asset] = await transaction
              .select({ id: assets.id, sha256: assets.sha256, status: assets.status, origin: assets.origin, kind: assets.kind })
              .from(assets)
              .where(and(
                eq(assets.workspaceId, brief.workspaceId),
                eq(assets.projectId, brief.projectId),
                eq(assets.id, assetId),
              ))
              .limit(1)
              .for("update");
            return asset?.status === "READY"
              && asset.origin === "USER_UPLOAD"
              && asset.kind === "IMAGE"
              && typeof asset.sha256 === "string"
              ? { sha256: asset.sha256 }
              : undefined;
          },
          resolveMapping: async ({ entity, assetId, assetSha256, referenceEvidenceId, usage }) => {
            const mappingRows = await transaction
              .select()
              .from(canonicalVisualEntityRevisionAssets)
              .where(and(
                eq(canonicalVisualEntityRevisionAssets.workspaceId, brief.workspaceId),
                eq(canonicalVisualEntityRevisionAssets.projectId, brief.projectId),
                eq(canonicalVisualEntityRevisionAssets.briefRevisionId, brief.id),
                eq(canonicalVisualEntityRevisionAssets.assetId, assetId),
              ))
              .orderBy(asc(canonicalVisualEntityRevisionAssets.createdAt), asc(canonicalVisualEntityRevisionAssets.id))
              .for("update");
            const revokedAddIds = new Set<string>();
            for (const mapping of mappingRows) {
              if (mapping.changeKind === "REVOKE" && typeof mapping.revokedAddId === "string") revokedAddIds.add(mapping.revokedAddId);
            }
            const activeAdds = mappingRows.filter((mapping) => mapping.changeKind === "ADD" && !revokedAddIds.has(mapping.id as string));
            if (activeAdds.some((mapping) => (mapping.entityId as string) !== entity.entity_id
              || (mapping.revisionNumber as number) !== entity.revision_number
              || (mapping.assetSha256 as string) !== assetSha256
              || (mapping.referenceEvidenceId as string) !== referenceEvidenceId
              || (mapping.usage as string) !== usage)) {
              throw new Error("A G02 Brief image is already actively mapped to different entity revision or evidence.");
            }
            if (activeAdds.length > 1) throw new Error("G02 Brief image has multiple active entity mapping ADD rows.");
            const existing = activeAdds[0];
            if (existing) return existing.mappingEvidenceId as string;
            const mappingEvidenceId = createPrefixedId("mpe");
            const [mapping] = await transaction
              .insert(canonicalVisualEntityRevisionAssets)
              .values({
                id: mappingEvidenceId,
                workspaceId: brief.workspaceId,
                projectId: brief.projectId,
                changeKind: "ADD",
                entityId: entity.entity_id,
                revisionNumber: entity.revision_number,
                assetId,
                assetSha256,
                mappingEvidenceId,
                referenceEvidenceId,
                briefRevisionId: brief.id,
                usage,
                revokedAddId: null,
              })
              .returning({ id: canonicalVisualEntityRevisionAssets.id, mappingEvidenceId: canonicalVisualEntityRevisionAssets.mappingEvidenceId });
            if (!mapping || (mapping.id as string) !== mappingEvidenceId || (mapping.mappingEvidenceId as string) !== mappingEvidenceId) {
              throw new Error("G02 mapping ADD evidence append did not return the bound evidence row.");
            }
            return mapping.mappingEvidenceId as string;
          },
        });
        persistedShotSpecs = prepared.shotSpecs;
        persistedPromptPackages = prepared.promptPackages;
      }
      assertCreativeRevisionTransition(brief.status, "READY_FOR_REVIEW");
      const timestamp = now();
      const [script] = await transaction
        .insert(scriptRevisions)
        .values({
          id: input.draft.scriptRevisionId,
          workspaceId: brief.workspaceId,
          projectId: brief.projectId,
          creativeBriefRevisionId: brief.id,
          revision: 1,
          beats: input.draft.beats,
          status: "READY_FOR_REVIEW",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      const [storyboard] = await transaction
        .insert(storyboardRevisions)
        .values({
          id: input.draft.storyboardRevisionId,
          workspaceId: brief.workspaceId,
          projectId: brief.projectId,
          scriptRevisionId: script.id,
          revision: 1,
          title: input.draft.title,
          summary: input.draft.summary,
          totalDurationSeconds: input.draft.totalDurationSeconds,
          continuityLevel: input.draft.continuityLevel,
          continuityNote: input.draft.continuityNote,
          status: "READY_FOR_REVIEW",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      const specs = await transaction
        .insert(storyboardShotSpecs)
        .values(persistedShotSpecs.map((shotSpec) => ({
          id: shotSpec.id,
          workspaceId: brief.workspaceId,
          projectId: brief.projectId,
          storyboardRevisionId: storyboard.id,
          sequence: shotSpec.sequence,
          title: shotSpec.title,
          durationSeconds: shotSpec.durationSeconds,
          narrativeGoal: shotSpec.narrativeGoal,
          startState: shotSpec.startState ?? "",
          endState: shotSpec.endState ?? "",
          transitionSummary: shotSpec.transitionSummary ?? "",
          referencePolicy: shotSpec.referencePolicy,
          dependsOnSequences: shotSpec.dependsOnSequences,
          continuityNote: shotSpec.continuityNote ?? "",
          narrativeBeatSequences: shotSpec.narrativeBeatSequences?.length ? shotSpec.narrativeBeatSequences : [shotSpec.sequence],
          sceneId: shotSpec.sceneId ?? null,
          characterIds: shotSpec.characterIds ?? [],
          propIds: shotSpec.propIds ?? [],
          referenceAnchors: shotSpec.referenceAnchors ?? [],
          createdAt: timestamp,
          updatedAt: timestamp,
        })))
        .returning();
      if (persistedPromptPackages.length > 0) {
        await transaction.insert(promptPackages).values(persistedPromptPackages.map((promptPackage) => ({
          id: promptPackage.id,
          workspaceId: brief.workspaceId,
          projectId: brief.projectId,
          shotSpecId: promptPackage.shotSpecId,
          compilerVersion: promptPackage.compilerVersion,
          prompt: promptPackage.prompt,
          visualConstraints: promptPackage.visualConstraints,
          referenceMap: promptPackage.referenceMap,
          capabilitySnapshot: {
            ...promptPackage.capabilitySnapshot,
            ...(promptPackage.motionPlan ? { motion_plan: promptPackage.motionPlan } : {}),
            ...(promptPackage.motionPlanHash ? { motion_plan_hash: promptPackage.motionPlanHash } : {}),
          },
          createdAt: timestamp,
        })));
      }
      const [updatedBrief] = await transaction
        .update(creativeBriefRevisions)
        .set({ status: "READY_FOR_REVIEW", updatedAt: timestamp })
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, brief.id), eq(creativeBriefRevisions.status, "PLANNING")))
        .returning();
      if (!updatedBrief) return undefined;
      await transaction.insert(outboxEvents).values(eventRow({
        event: input.event,
        producer: "creative-planning-worker",
        workspaceId: brief.workspaceId,
        projectId: brief.projectId,
        aggregateType: "storyboard_revision",
        aggregateId: storyboard.id,
        eventType: "storyboard_revision.ready_for_review",
        data: {
          storyboard_revision_id: storyboard.id,
          shot_count: specs.length,
          total_duration_seconds: storyboard.totalDurationSeconds,
          continuity_level: storyboard.continuityLevel,
        },
      }));
      return serializeStoryboard(storyboard, specs, script.beats.length);
    });
  }

  async appendG02EntityMappingRevoke(input: {
    workspaceId: string;
    projectId: string;
    briefRevisionId: string;
    addMappingEvidenceId: string;
    entityId: string;
    revisionNumber: number;
    assetId: string;
    assetSha256: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const [brief] = await transaction
        .select({ id: creativeBriefRevisions.id, sourceText: creativeBriefRevisions.sourceText })
        .from(creativeBriefRevisions)
        .where(and(
          eq(creativeBriefRevisions.workspaceId, input.workspaceId),
          eq(creativeBriefRevisions.projectId, input.projectId),
          eq(creativeBriefRevisions.id, input.briefRevisionId),
        ))
        .limit(1)
        .for("update");
      if (!brief || !hasG02SourceMarker(brief.sourceText)) {
        throw new Error("G02 mapping REVOKE requires its locked source-marked Brief revision.");
      }
      const [add] = await transaction
        .select()
        .from(canonicalVisualEntityRevisionAssets)
        .where(and(
          eq(canonicalVisualEntityRevisionAssets.workspaceId, input.workspaceId),
          eq(canonicalVisualEntityRevisionAssets.projectId, input.projectId),
          eq(canonicalVisualEntityRevisionAssets.briefRevisionId, input.briefRevisionId),
          eq(canonicalVisualEntityRevisionAssets.id, input.addMappingEvidenceId),
          eq(canonicalVisualEntityRevisionAssets.changeKind, "ADD"),
        ))
        .limit(1)
        .for("update");
      if (!add
        || typeof add.id !== "string"
        || add.entityId !== input.entityId
        || add.revisionNumber !== input.revisionNumber
        || add.assetId !== input.assetId
        || add.assetSha256 !== input.assetSha256
        || add.briefRevisionId !== brief.id
        || !add.referenceEvidenceId) {
        throw new Error("G02 mapping REVOKE must exactly bind an existing same-scope ADD row and asset SHA.");
      }
      const rows = await transaction
        .select()
        .from(canonicalVisualEntityRevisionAssets)
        .where(and(
          eq(canonicalVisualEntityRevisionAssets.workspaceId, input.workspaceId),
          eq(canonicalVisualEntityRevisionAssets.projectId, input.projectId),
          eq(canonicalVisualEntityRevisionAssets.briefRevisionId, input.briefRevisionId),
          eq(canonicalVisualEntityRevisionAssets.assetId, input.assetId),
        ))
        .for("update");
      const revokedAddIds = new Set<string>(rows
        .filter((row) => row.changeKind === "REVOKE" && row.revokedAddId)
        .map((row) => row.revokedAddId as string));
      const activeAdds = rows.filter((row) => row.changeKind === "ADD" && !revokedAddIds.has(row.id as string));
      if (revokedAddIds.has(add.id) || activeAdds.length !== 1 || activeAdds[0]?.id !== add.id) {
        throw new Error("G02 mapping REVOKE target must be the unique active ADD and cannot be revoked twice.");
      }
      const revokeId = createPrefixedId("mpe");
      const [revoke] = await transaction
        .insert(canonicalVisualEntityRevisionAssets)
        .values({
          id: revokeId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          changeKind: "REVOKE",
          entityId: add.entityId,
          revisionNumber: add.revisionNumber,
          assetId: add.assetId,
          assetSha256: add.assetSha256,
          mappingEvidenceId: revokeId,
          referenceEvidenceId: null,
          briefRevisionId: add.briefRevisionId,
          usage: add.usage,
          revokedAddId: add.id,
        })
        .returning({ id: canonicalVisualEntityRevisionAssets.id, revokedAddId: canonicalVisualEntityRevisionAssets.revokedAddId });
      if (!revoke || revoke.id !== revokeId || revoke.revokedAddId !== add.id) {
        throw new Error("G02 mapping REVOKE append did not return the exact revocation row.");
      }
      return revoke.id;
    });
  }

  async failCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; code: string; event: CreativePlanningEvent }) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(creativeBriefRevisions)
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, input.creativeBriefRevisionId)))
        .limit(1)
        .for("update");
      if (!current) return undefined;
      if (current.status === "FAILED") return serializeCreativeBrief(current, await loadDocumentContexts(transaction, input.workspaceId, current.id), await loadFactContexts(transaction, input.workspaceId, current.id));
      if (current.status !== "PLANNING") return undefined;
      assertCreativeRevisionTransition(current.status, "FAILED");
      const [value] = await transaction
        .update(creativeBriefRevisions)
        .set({ status: "FAILED", error: { code: input.code }, updatedAt: now() })
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, input.creativeBriefRevisionId), eq(creativeBriefRevisions.status, "PLANNING")))
        .returning();
      if (value) {
        await transaction.insert(outboxEvents).values(eventRow({
          event: input.event,
          producer: "creative-planning-worker",
          workspaceId: value.workspaceId,
          projectId: value.projectId,
          aggregateType: "creative_brief_revision",
          aggregateId: value.id,
          eventType: "creative_brief.planning_failed",
          data: { creative_brief_revision_id: value.id, error_code: input.code },
        }));
      }
      return value ? serializeCreativeBrief(value, await loadDocumentContexts(transaction, input.workspaceId, value.id), await loadFactContexts(transaction, input.workspaceId, value.id)) : undefined;
    });
  }

  async approveStoryboardRevision(input: ApproveStoryboardCommandInput): Promise<CreativePlanningCommandOutcome<ControlStoryboardRevision>> {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveCommand(transaction, input);
      if (reservation) return this.replayStoryboard(transaction, input.workspaceId, reservation);
      const loaded = await loadStoryboard(transaction, input.workspaceId, input.storyboardRevisionId, true);
      if (!loaded) return this.storeOutcome(transaction, input, { kind: "NOT_FOUND" });
      const { storyboard } = loaded;
      if (storyboard.status !== "READY_FOR_REVIEW") return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      const [script] = await transaction
        .select()
        .from(scriptRevisions)
        .where(and(eq(scriptRevisions.workspaceId, input.workspaceId), eq(scriptRevisions.id, storyboard.scriptRevisionId)))
        .limit(1)
        .for("update");
      if (!script || script.status !== "READY_FOR_REVIEW") return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      const [brief] = await transaction
        .select()
        .from(creativeBriefRevisions)
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, script.creativeBriefRevisionId)))
        .limit(1)
        .for("update");
      if (!brief || brief.status !== "READY_FOR_REVIEW") return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      assertCreativeRevisionTransition(storyboard.status, "APPROVED");
      assertCreativeRevisionTransition(script.status, "APPROVED");
      assertCreativeRevisionTransition(brief.status, "APPROVED");
      const timestamp = now();
      const [updatedStoryboard] = await transaction
        .update(storyboardRevisions)
        .set({ status: "APPROVED", updatedAt: timestamp })
        .where(and(eq(storyboardRevisions.workspaceId, input.workspaceId), eq(storyboardRevisions.id, storyboard.id), eq(storyboardRevisions.status, "READY_FOR_REVIEW")))
        .returning();
      if (!updatedStoryboard) return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      await transaction
        .update(scriptRevisions)
        .set({ status: "APPROVED", updatedAt: timestamp })
        .where(and(eq(scriptRevisions.workspaceId, input.workspaceId), eq(scriptRevisions.id, script.id), eq(scriptRevisions.status, "READY_FOR_REVIEW")));
      await transaction
        .update(creativeBriefRevisions)
        .set({ status: "APPROVED", updatedAt: timestamp })
        .where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, brief.id), eq(creativeBriefRevisions.status, "READY_FOR_REVIEW")));
      await transaction.insert(outboxEvents).values(eventRow({
        event: input.event,
        producer: "control-api",
        workspaceId: updatedStoryboard.workspaceId,
        projectId: updatedStoryboard.projectId,
        aggregateType: "storyboard_revision",
        aggregateId: updatedStoryboard.id,
        eventType: "storyboard_revision.approved",
        data: { storyboard_revision_id: updatedStoryboard.id },
      }));
      await storeSnapshot(transaction, input, { kind: "STORYBOARD", storyboardRevisionId: updatedStoryboard.id });
      return { kind: "NEW", value: serializeStoryboard(updatedStoryboard, loaded.specs, loaded.script?.beats.length ?? 0), status: 202 };
    });
  }

  async createProductionRun(input: ProductionRunCommandInput): Promise<CreativePlanningCommandOutcome<ControlProductionRun>> {
    return this.db.transaction(async (transaction) => {
      const reservation = await reserveCommand(transaction, input);
      if (reservation) return this.replayProductionRun(transaction, input.workspaceId, reservation);
      await advisoryProjectLock(transaction, input.workspaceId, input.projectId);
      const loaded = await loadStoryboard(transaction, input.workspaceId, input.storyboardRevisionId, true);
      if (!loaded || loaded.storyboard.projectId !== input.projectId) return this.storeOutcome(transaction, input, { kind: "NOT_FOUND" });
      if (input.deliveryPlanRevisionId) {
        const [deliveryPlan] = await transaction
          .select()
          .from(deliveryPlanRevisions)
          .where(and(
            eq(deliveryPlanRevisions.workspaceId, input.workspaceId),
            eq(deliveryPlanRevisions.projectId, input.projectId),
            eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId),
          ))
          .limit(1)
          .for("update");
        if (!deliveryPlan || deliveryPlan.storyboardRevisionId !== loaded.storyboard.id) {
          return this.storeOutcome(transaction, input, { kind: "NOT_FOUND" });
        }
        try {
          assertDeliveryPlanCanCreateProductionRun({
            status: deliveryPlan.status,
            block_reasons: deliveryPlan.blockReasons,
          });
        } catch {
          return this.storeOutcome(transaction, input, { kind: "PREFLIGHT_BLOCKED" });
        }
      }
      let audioSelectionSource: ReturnType<typeof freezeDoubaoAudioSourceIdentity>;
      let musicReplacementSource: {
        version: 1;
        assetId: string;
        workspaceId: string;
        projectId: string;
        sha256: string;
        byteSize: number;
        mimeType: string;
        durationMs: number;
      } | undefined;
      if ((input.audioSelection ?? "PRESERVE_PROVIDER_AUDIO") === "DOUBAO_TTS_REPLACE") {
        const approvedTimeline = input.deliveryPlanRevisionId
          ? await findApprovedNarrationTimeline(
            transaction as unknown as PlatformDatabase,
            input.workspaceId,
            input.projectId,
            input.deliveryPlanRevisionId,
            undefined,
            true,
          )
          : undefined;
        audioSelectionSource = approvedTimeline ? freezeDoubaoAudioSourceIdentity({
          timeline: approvedTimeline,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          storyboardRevisionId: loaded.storyboard.id,
        }) : undefined;
        if (!audioSelectionSource
          || audioSelectionSource.deliveryPlanRevisionId !== input.deliveryPlanRevisionId
          || audioSelectionSource.storyboardRevisionId !== loaded.storyboard.id) {
          return this.storeOutcome(transaction, input, { kind: "PREFLIGHT_BLOCKED" });
        }
      }
      if (input.audioSelection === "MUSIC_REPLACE_PROVIDER_AUDIO") {
        const manualAssetId = input.musicPlan?.mode === "MANUAL" ? input.musicPlan.asset_id : undefined;
        const targetDurationMs = loaded.storyboard.totalDurationSeconds * 1_000;
        if (!manualAssetId || !Number.isSafeInteger(targetDurationMs) || targetDurationMs <= 0) {
          return this.storeOutcome(transaction, input, { kind: "PREFLIGHT_BLOCKED" });
        }
        const [musicAsset] = await transaction
          .select()
          .from(assets)
          .where(and(
            eq(assets.workspaceId, input.workspaceId),
            eq(assets.projectId, input.projectId),
            eq(assets.id, manualAssetId),
            eq(assets.kind, "AUDIO"),
            eq(assets.status, "READY"),
          ))
          .limit(1)
          .for("update");
        const metadata = musicAsset?.metadata && typeof musicAsset.metadata === "object"
          ? musicAsset.metadata
          : undefined;
        if (!musicAsset
          || metadata?.audio_role !== "MUSIC"
          || typeof musicAsset.sha256 !== "string"
          || !/^[a-f0-9]{64}$/u.test(musicAsset.sha256)
          || typeof musicAsset.byteSize !== "number"
          || !Number.isSafeInteger(musicAsset.byteSize)
          || musicAsset.byteSize <= 0
          || typeof musicAsset.mimeType !== "string"
          || !musicAsset.mimeType.toLowerCase().startsWith("audio/")
          || typeof musicAsset.durationMs !== "number"
          || !Number.isSafeInteger(musicAsset.durationMs)
          || musicAsset.durationMs < targetDurationMs
          || !musicAsset.objectKey.startsWith(`${musicAsset.workspaceId}/${musicAsset.projectId}/${musicAsset.id}/`)) {
          return this.storeOutcome(transaction, input, { kind: "PREFLIGHT_BLOCKED" });
        }
        musicReplacementSource = {
          version: 1,
          assetId: musicAsset.id,
          workspaceId: musicAsset.workspaceId,
          projectId: musicAsset.projectId,
          sha256: musicAsset.sha256,
          byteSize: musicAsset.byteSize,
          mimeType: musicAsset.mimeType,
          durationMs: musicAsset.durationMs,
        };
      }
      const [active] = await transaction
        .select({ id: productionRuns.id })
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, input.workspaceId), eq(productionRuns.projectId, input.projectId), inArray(productionRuns.status, activeProductionStatuses)))
        .limit(1);
      if (active) return this.storeOutcome(transaction, input, { kind: "ACTIVE_CONFLICT" });
      try {
        assertProductionRunCreatable(loaded.storyboard.status);
        assertProductionRunTransition("DRAFT", "PLAN_READY");
        assertProductionRunTransition("PLAN_READY", "CONFIRMED");
      } catch {
        return this.storeOutcome(transaction, input, { kind: "STATE_INVALID" });
      }
      const [value] = await transaction
        .insert(productionRuns)
        .values({
          id: input.productionRunId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          storyboardRevisionId: loaded.storyboard.id,
          ...(input.deliveryPlanRevisionId ? { deliveryPlanRevisionId: input.deliveryPlanRevisionId } : {}),
          status: "CONFIRMED",
          totalShotCount: loaded.specs.length,
          acceptedShotCount: 0,
          totalDurationSeconds: loaded.storyboard.totalDurationSeconds,
          continuityStatus: "NOT_CHECKED",
          maxAutoRepairCount: 2,
          autoRepairCount: 0,
          budgetGuard: {
            music_plan: input.musicPlan ?? { mode: "OFF", style_hint: "" },
            audio_selection: input.audioSelection ?? "PRESERVE_PROVIDER_AUDIO",
            ...(audioSelectionSource ? { audio_selection_source: audioSelectionSource } : {}),
            ...(musicReplacementSource ? { music_replacement_source: musicReplacementSource } : {}),
            ...(input.pixabayFallbackMusicAssetId ? { pixabay_fallback_music_asset_id: input.pixabayFallbackMusicAssetId } : {}),
            ...(input.billing ? { billing: input.billing } : {}),
            ...(input.fixedBillingPolicy ? { fixed_billing_policy: input.fixedBillingPolicy } : {}),
          },
        })
        .returning();
      if (input.deliveryPlanRevisionId) {
        const [consumedPlan] = await transaction
          .update(deliveryPlanRevisions)
          .set({
            status: "CONSUMED",
            consumedByProductionRunId: value.id,
            updatedAt: new Date().toISOString(),
          })
          .where(and(
            eq(deliveryPlanRevisions.workspaceId, input.workspaceId),
            eq(deliveryPlanRevisions.projectId, input.projectId),
            eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId),
            eq(deliveryPlanRevisions.status, "APPROVED"),
          ))
          .returning();
        if (!consumedPlan) return this.storeOutcome(transaction, input, { kind: "PREFLIGHT_BLOCKED" });
      }
      await transaction.insert(outboxEvents).values(eventRow({
        event: input.event,
        producer: "control-api",
        workspaceId: value.workspaceId,
        projectId: value.projectId,
        aggregateType: "production_run",
        aggregateId: value.id,
        eventType: "production_run.confirmed",
        data: {
          production_run_id: value.id,
          storyboard_revision_id: value.storyboardRevisionId,
          ...(value.deliveryPlanRevisionId ? { delivery_plan_revision_id: value.deliveryPlanRevisionId } : {}),
          total_shot_count: value.totalShotCount,
        },
      }));
      await storeSnapshot(transaction, input, { kind: "PRODUCTION_RUN", productionRunId: value.id });
      return { kind: "NEW", value: serializeProductionRun(value), status: 202 };
    });
  }

  async claimOutboxEvents(input: { relayId: string; now: Date; leaseMs: number; limit: number; workspaceId?: string; eventTypes?: readonly InternalEventEnvelope["event_type"][] }) {
    const now = input.now.toISOString();
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
    await this.db
      .update(outboxEvents)
      .set({ publishedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, lastError: null })
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  async releaseOutboxEvent(input: { eventId: string; workspaceId: string; relayId: string; now: Date; retryDelayMs: number; maxAttempts: number; reason: string }) {
    const [current] = await this.db
      .select({ publishAttempts: outboxEvents.publishAttempts })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)))
      .limit(1);
    if (!current) return;
    const deadLetteredAt = current.publishAttempts >= input.maxAttempts ? input.now.toISOString() : null;
    await this.db
      .update(outboxEvents)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: input.reason.replace(/[\r\n]+/g, " ").slice(0, 500),
        ...(deadLetteredAt ? { deadLetteredAt } : { availableAt: new Date(input.now.getTime() + input.retryDelayMs).toISOString() }),
      })
      .where(and(eq(outboxEvents.id, input.eventId), eq(outboxEvents.workspaceId, input.workspaceId), eq(outboxEvents.leaseOwner, input.relayId)));
  }

  async claimCreativePlanningEvent(input: { message: InternalCreativePlanningQueueMessage; consumerName: string; workerId: string; now: Date; leaseMs: number }): Promise<CreativePlanningEventClaim> {
    return this.db.transaction(async (transaction) => {
      const message = InternalCreativePlanningQueueMessageSchema.parse(input.message);
      const [outbox] = await transaction
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.id, message.event_id), eq(outboxEvents.workspaceId, message.workspace_id)))
        .limit(1);
      if (!outbox) return { kind: "RETRY" };
      const event = InternalEventEnvelopeSchema.safeParse(outbox.payload);
      if (!event.success
        || event.data.event_type !== "creative_brief.planning_requested"
        || outbox.id !== message.event_id
        || outbox.workspaceId !== message.workspace_id
        || event.data.event_id !== message.event_id
        || event.data.workspace_id !== message.workspace_id
        || event.data.project_id !== message.project_id
        || event.data.correlation_id !== message.correlation_id
        || event.data.data.creative_brief_revision_id !== message.creative_brief_revision_id) return { kind: "RETRY" };

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
          .set({ leaseOwner: input.workerId, leaseExpiresAt: expiresAt, attempts: existing.attempts + 1, updatedAt: input.now.toISOString() })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            isNull(eventConsumptions.completedAt),
            isNull(eventConsumptions.deadLetteredAt),
            or(
              eq(eventConsumptions.leaseOwner, input.workerId),
              isNull(eventConsumptions.leaseExpiresAt),
              lte(eventConsumptions.leaseExpiresAt, input.now.toISOString()),
            ),
          ))
          .returning();
        if (!reclaimed) return { kind: "BUSY" };
      }
      const [brief] = await transaction
        .select()
        .from(creativeBriefRevisions)
        .where(and(
          eq(creativeBriefRevisions.workspaceId, message.workspace_id),
          eq(creativeBriefRevisions.id, message.creative_brief_revision_id),
          eq(creativeBriefRevisions.projectId, message.project_id),
        ))
        .limit(1);
      if (!brief) return { kind: "RETRY" };
      if (brief.status !== "PLANNING") {
        await transaction
          .update(eventConsumptions)
          .set({ completedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now.toISOString() })
          .where(and(
            eq(eventConsumptions.workspaceId, message.workspace_id),
            eq(eventConsumptions.eventId, message.event_id),
            eq(eventConsumptions.consumerName, input.consumerName),
            eq(eventConsumptions.leaseOwner, input.workerId),
          ));
        return { kind: "DUPLICATE" };
      }
      return { kind: "CLAIMED", brief: serializeCreativeBrief(brief, await loadDocumentContexts(transaction, message.workspace_id, brief.id), await loadFactContexts(transaction, message.workspace_id, brief.id)) };
    });
  }

  async completeCreativePlanningEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; now: Date }) {
    await this.db
      .update(eventConsumptions)
      .set({ completedAt: input.now.toISOString(), leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now.toISOString() })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        eq(eventConsumptions.leaseOwner, input.workerId),
      ));
  }

  async releaseCreativePlanningEvent(input: { eventId: string; workspaceId: string; consumerName: string; workerId: string; reason: string; deadLetter: boolean; now: Date }) {
    const leaseOwnerMatches = input.deadLetter
      ? or(
        eq(eventConsumptions.leaseOwner, input.workerId),
        and(isNull(eventConsumptions.leaseOwner), isNull(eventConsumptions.leaseExpiresAt)),
      )
      : eq(eventConsumptions.leaseOwner, input.workerId);
    await this.db
      .update(eventConsumptions)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: input.reason.replace(/[\r\n]+/g, " ").slice(0, 500),
        ...(input.deadLetter ? { deadLetteredAt: input.now.toISOString() } : {}),
        updatedAt: input.now.toISOString(),
      })
      .where(and(
        eq(eventConsumptions.workspaceId, input.workspaceId),
        eq(eventConsumptions.eventId, input.eventId),
        eq(eventConsumptions.consumerName, input.consumerName),
        leaseOwnerMatches,
      ));
  }

  private async replayCreativeBrief(transaction: Pick<PlatformDatabase, "select">, workspaceId: string, snapshot: StoredSnapshot | "CONFLICT", status: 201 | 202): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "CREATIVE_BRIEF") {
      const [value] = await transaction
        .select()
        .from(creativeBriefRevisions)
        .where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, snapshot.creativeBriefRevisionId)))
        .limit(1);
      return value ? { kind: "REPLAY", value: serializeCreativeBrief(value, await loadDocumentContexts(transaction, workspaceId, value.id), await loadFactContexts(transaction, workspaceId, value.id)), status } : { kind: "CONFLICT" };
    }
    return snapshot.kind === "NOT_FOUND" || snapshot.kind === "INVALID_SOURCE" || snapshot.kind === "DOCUMENT_CONTEXT_INVALID" || snapshot.kind === "DOCUMENT_KNOWLEDGE_NOT_READY" || snapshot.kind === "DOCUMENT_FACT_CONTEXT_INVALID" || snapshot.kind === "ACTIVE_CONFLICT" || snapshot.kind === "STATE_INVALID" ? snapshot : { kind: "CONFLICT" };
  }

  private async replayStoryboard(transaction: Pick<PlatformDatabase, "select">, workspaceId: string, snapshot: StoredSnapshot | "CONFLICT"): Promise<CreativePlanningCommandOutcome<ControlStoryboardRevision>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "STORYBOARD") {
      const loaded = await loadStoryboard(transaction, workspaceId, snapshot.storyboardRevisionId);
      return loaded ? { kind: "REPLAY", value: serializeStoryboard(loaded.storyboard, loaded.specs, loaded.script?.beats.length ?? 0), status: 202 } : { kind: "CONFLICT" };
    }
    return snapshot.kind === "NOT_FOUND" || snapshot.kind === "INVALID_SOURCE" || snapshot.kind === "ACTIVE_CONFLICT" || snapshot.kind === "STATE_INVALID" ? snapshot : { kind: "CONFLICT" };
  }

  private async replayProductionRun(transaction: Pick<PlatformDatabase, "select">, workspaceId: string, snapshot: StoredSnapshot | "CONFLICT"): Promise<CreativePlanningCommandOutcome<ControlProductionRun>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "PRODUCTION_RUN") {
      const [value] = await transaction
        .select()
        .from(productionRuns)
        .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, snapshot.productionRunId)))
        .limit(1);
      return value ? { kind: "REPLAY", value: serializeProductionRun(value), status: 202 } : { kind: "CONFLICT" };
    }
    return snapshot.kind === "NOT_FOUND" || snapshot.kind === "INVALID_SOURCE" || snapshot.kind === "ACTIVE_CONFLICT" || snapshot.kind === "STATE_INVALID" ? snapshot : { kind: "CONFLICT" };
  }

  private async storeOutcome(
    transaction: Transaction,
    input: { scope: string; idempotencyKey: string },
    outcome: { kind: "NOT_FOUND" | "INVALID_SOURCE" | "DOCUMENT_CONTEXT_INVALID" | "DOCUMENT_KNOWLEDGE_NOT_READY" | "DOCUMENT_FACT_CONTEXT_INVALID" | "ACTIVE_CONFLICT" | "STATE_INVALID" | "PREFLIGHT_BLOCKED" },
  ) {
    await storeSnapshot(transaction, input, outcome);
    return outcome;
  }
}
