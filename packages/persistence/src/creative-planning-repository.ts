import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  InternalCreativePlanningQueueMessageSchema,
  InternalEventEnvelopeSchema,
  type ContinuityLevel,
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
  type CreativeBriefFactContext,
  type FrozenDocumentFact,
} from "@alchemy-video/contracts";
import { DeterministicFactSelector } from "@alchemy-video/document-intelligence";
import {
  assertCreativeRevisionTransition,
  assertDeliveryPlanCanCreateProductionRun,
  assertProductionRunCreatable,
  assertProductionRunTransition,
  assertStoryboardPlan,
  inferVisualReferenceLockPolicies,
  inferVisualReferenceRoles,
  parseVisualReferenceAnalysis,
  type StoryboardDurationPolicy,
} from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import {
  assets,
  commandDeduplications,
  creativeBriefDocumentContexts,
  creativeBriefFactContexts,
  creativeBriefRevisions,
  documentFacts,
  documentKnowledgeRevisions,
  documentKnowledgeSections,
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
  startState: string;
  endState: string;
  transitionSummary: string;
  referencePolicy: ReferencePolicy;
  dependsOnSequences: number[];
  continuityNote: string;
  narrativeBeatSequences?: number[];
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
  listProjectProductionRuns(workspaceId: string, projectId: string): Promise<ControlProductionRun[]>;
  createCreativeBriefRevision(input: CreativeBriefCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>>;
  requestCreativePlan(input: PlanningCommandInput): Promise<CreativePlanningCommandOutcome<ControlCreativeBriefRevision>>;
  completeCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; draft: CreativePlanningDraft; event: CreativePlanningEvent }): Promise<ControlStoryboardRevision | undefined>;
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
  startState: value.startState,
  endState: value.endState,
  transitionSummary: value.transitionSummary,
  referencePolicy: value.referencePolicy,
  dependsOnSequences: value.dependsOnSequences,
  continuityNote: value.continuityNote,
  narrativeBeatSequences: value.narrativeBeatSequences,
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

  constructor(
    private readonly sourceAssetResolver?: {
      findAsset(workspaceId: string, assetId: string): Promise<{
        projectId: string;
        status: string;
        origin?: string;
        kind?: string;
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

  async resolveVisualObjectLocks(input: { workspaceId: string; projectId: string; sourceAssetIds: string[]; sourcePrompt?: string }): Promise<KeyVisualObjectLock[]> {
    if (!this.sourceAssetResolver) return [];
    const values = await Promise.all(input.sourceAssetIds.map((assetId) => this.sourceAssetResolver!.findAsset(input.workspaceId, assetId)));
    const roles = inferVisualReferenceRoles({
      sourcePrompt: input.sourcePrompt ?? "",
      count: values.length,
      sourceImageNames: values.map((asset) => typeof asset?.metadata?.filename === "string" ? asset.metadata.filename : undefined),
      visionAnalyses: values.map((asset) => parseVisualReferenceAnalysis(asset?.metadata?.visual_analysis)),
    });
    const lockPolicies = inferVisualReferenceLockPolicies({
      sourcePrompt: input.sourcePrompt ?? "",
      roles,
      sourceImageNames: values.map((asset) => typeof asset?.metadata?.filename === "string" ? asset.metadata.filename : undefined),
    });
    return values.flatMap((asset, position) => {
      if (lockPolicies[position] !== "LOCK_OBJECTS" || !asset || asset.projectId !== input.projectId || asset.status !== "READY") return [];
      return parseVisualReferenceAnalysis(asset.metadata?.visual_analysis)?.objects ?? [];
    });
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

  async completeCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; draft: CreativePlanningDraft; event: CreativePlanningEvent }) {
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
      shotSpecs: input.draft.shotSpecs.map(({ id, narrativeBeatSequences, ...shotSpec }) => ({
        id,
        ...shotSpec,
        narrativeBeatSequences: narrativeBeatSequences?.length ? narrativeBeatSequences : [shotSpec.sequence],
      })),
      narrativeBeatCount: input.draft.narrativeBeatCount ?? input.draft.beats.length,
      generationSegmentCount: input.draft.generationSegmentCount ?? input.draft.shotSpecs.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.storyboards.set(storyboard.id, storyboard);
    for (const promptPackage of compiledPromptPackages) this.promptPackages.set(promptPackage.id, { ...promptPackage });
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

  async releaseCreativePlanningEvent() {
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
  const readyRevisionIds = input.documentContexts.map((context) => byConversion.get(context.conversionId)!.revision.id);
  const factRows = await transaction.select({
    fact: documentFacts,
    sectionSequence: documentKnowledgeSections.sequence,
    locator: documentKnowledgeSections.locator,
    documentId: documentKnowledgeRevisions.documentId,
    conversionId: documentKnowledgeRevisions.conversionId,
  }).from(documentFacts)
    .innerJoin(documentKnowledgeSections, and(
      eq(documentKnowledgeSections.workspaceId, documentFacts.workspaceId),
      eq(documentKnowledgeSections.projectId, documentFacts.projectId),
      eq(documentKnowledgeSections.id, documentFacts.sectionId),
    ))
    .innerJoin(documentKnowledgeRevisions, and(
      eq(documentKnowledgeRevisions.workspaceId, documentFacts.workspaceId),
      eq(documentKnowledgeRevisions.projectId, documentFacts.projectId),
      eq(documentKnowledgeRevisions.id, documentFacts.knowledgeRevisionId),
      eq(documentKnowledgeRevisions.status, "READY"),
    ))
    .where(and(
      eq(documentFacts.workspaceId, input.workspaceId),
      eq(documentFacts.projectId, input.projectId),
      inArray(documentFacts.knowledgeRevisionId, readyRevisionIds),
    ))
    .orderBy(asc(documentKnowledgeRevisions.conversionId), asc(documentKnowledgeSections.sequence), asc(documentFacts.createdAt));
  const frozenRows = factRows.map(({ fact, sectionSequence, locator, documentId, conversionId }) => ({
    knowledgeRevisionId: fact.knowledgeRevisionId,
    fact: {
      fact_id: fact.id,
      category: fact.category,
      statement: fact.statement,
      confidence: fact.confidence,
      source: { document_id: documentId, conversion_id: conversionId, section_sequence: sectionSequence, locator },
    },
  }));
  const selected = new DeterministicFactSelector().selectForBrief({
    creativeBriefRevisionId: input.creativeBriefRevisionId,
    sourceText: input.sourceText,
    stylePreferences: input.stylePreferences,
    facts: frozenRows.map((row) => row.fact),
  });
  const byFactId = new Map(frozenRows.map((row) => [row.fact.fact_id, row]));
  const contexts = selected.map((context) => ({ ...context }));
  if (contexts.some((context) => !byFactId.has(context.fact_id))) return { kind: "DOCUMENT_FACT_CONTEXT_INVALID" };
  return { kind: "READY", contexts, rows: contexts.map((context) => ({ fact: context.fact, knowledgeRevisionId: byFactId.get(context.fact_id)!.knowledgeRevisionId })) };
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

  async resolveVisualObjectLocks(input: { workspaceId: string; projectId: string; sourceAssetIds: string[]; sourcePrompt?: string }): Promise<KeyVisualObjectLock[]> {
    if (input.sourceAssetIds.length === 0) return [];
    const rows = await this.db.select({ id: assets.id, metadata: assets.metadata }).from(assets).where(and(
      eq(assets.workspaceId, input.workspaceId),
      eq(assets.projectId, input.projectId),
      inArray(assets.id, input.sourceAssetIds),
      eq(assets.status, "READY"),
    ));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = input.sourceAssetIds.map((assetId) => byId.get(assetId));
    const roles = inferVisualReferenceRoles({
      sourcePrompt: input.sourcePrompt ?? "",
      count: orderedRows.length,
      sourceImageNames: orderedRows.map((row) => typeof row?.metadata?.filename === "string" ? row.metadata.filename : undefined),
      visionAnalyses: orderedRows.map((row) => parseVisualReferenceAnalysis(row?.metadata?.visual_analysis)),
    });
    const lockPolicies = inferVisualReferenceLockPolicies({
      sourcePrompt: input.sourcePrompt ?? "",
      roles,
      sourceImageNames: orderedRows.map((row) => typeof row?.metadata?.filename === "string" ? row.metadata.filename : undefined),
    });
    return orderedRows.flatMap((row, position) => {
      if (lockPolicies[position] !== "LOCK_OBJECTS") return [];
      return parseVisualReferenceAnalysis(row?.metadata?.visual_analysis)?.objects ?? [];
    });
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

  async completeCreativePlan(input: { workspaceId: string; creativeBriefRevisionId: string; draft: CreativePlanningDraft; event: CreativePlanningEvent }) {
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
        .values(input.draft.shotSpecs.map((shotSpec) => ({
          id: shotSpec.id,
          workspaceId: brief.workspaceId,
          projectId: brief.projectId,
          storyboardRevisionId: storyboard.id,
          sequence: shotSpec.sequence,
          title: shotSpec.title,
          durationSeconds: shotSpec.durationSeconds,
          narrativeGoal: shotSpec.narrativeGoal,
          startState: shotSpec.startState,
          endState: shotSpec.endState,
          transitionSummary: shotSpec.transitionSummary,
          referencePolicy: shotSpec.referencePolicy,
          dependsOnSequences: shotSpec.dependsOnSequences,
          continuityNote: shotSpec.continuityNote,
          narrativeBeatSequences: shotSpec.narrativeBeatSequences?.length ? shotSpec.narrativeBeatSequences : [shotSpec.sequence],
          createdAt: timestamp,
          updatedAt: timestamp,
        })))
        .returning();
      if (compiledPromptPackages.length > 0) {
        await transaction.insert(promptPackages).values(compiledPromptPackages.map((promptPackage) => ({
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
          budgetGuard: { music_plan: input.musicPlan ?? { mode: "AUTO", style_hint: "" } },
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
        eq(eventConsumptions.leaseOwner, input.workerId),
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
