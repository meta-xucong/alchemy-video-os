import { Hono, type Context } from "hono";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import {
  AssetIdSchema,
  ApproveStoryboardRevisionCommandSchema,
  ConfirmAssetUploadCommandSchema,
  CreateCreativeBriefRevisionCommandSchema,
  ApproveDeliveryPlanRevisionCommandSchema,
  ApproveNarrationScriptRevisionCommandSchema,
  CreateDocumentConversionCommandSchema,
  CreateDeliveryPlanRevisionCommandSchema,
  CreateNarrationScriptRevisionCommandSchema,
  NarrationAudioProviderSettingsSchema,
  CreateTimelinePlanCommandSchema,
  CreateProductionRunCommandSchema,
  CreateShotCommandSchema,
  CreateTaskRunCommandSchema,
  CreateUploadRequestCommandSchema,
  CreativeBriefRevisionIdSchema,
  CreateProjectCommandSchema,
  EventIdSchema,
  DocumentConversionIdSchema,
  DocumentKnowledgeRevisionIdSchema,
  DeliveryPlanRevisionIdSchema,
  NarrationScriptRevisionIdSchema,
  IdempotencyKeySchema,
  ProjectIdSchema,
  ProductionRunIdSchema,
  ShotIdSchema,
  TaskRunIdSchema,
  RetryTaskRunCommandSchema,
  RetryProductionSegmentCommandSchema,
  RetryProductionCompositionCommandSchema,
  RetryDocumentConversionCommandSchema,
  RetryDocumentKnowledgeRevisionCommandSchema,
  RequestCreativePlanCommandSchema,
  StoryboardRevisionIdSchema,
  UpdateProjectCommandSchema,
  UpdateShotCommandSchema,
  WorkspaceIdSchema,
  projectPublicWorkspaceEvent,
  type VisualReferenceRole,
  AudioCapabilitiesSchema,
  PixabayMusicImportCommandSchema,
  PRODUCTION_RUN_STATUSES,
  TASK_RUN_TERMINAL_STATUSES,
  type PixabayMusicImportCommand,
  type InternalEventEnvelope,
  type DocumentUnderstandingSummary,
} from "@alchemy-video/contracts";
import { fingerprintRequest, inferVisualReferenceLockPolicies, inferVisualReferenceRoles, parseVideoBillingFixedFee, parseVideoBillingModelRates, parseVideoBillingSurchargeMultiplier, parseVisualReferenceAnalysis } from "@alchemy-video/domain";
import { DeterministicFactSelector } from "@alchemy-video/document-intelligence";
import {
  UnsupportedVideoGenerationInputError,
  VideoPromptCompilationError,
  compileVideoPrompt,
  createRuntimeVideoInputSnapshot,
  resolveVideoPromptMaxUtf8Bytes,
  resolveVideoProviderRuntimeProfile,
  type VideoProviderRuntimeMode,
} from "@alchemy-video/provider-video";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";
import { ReferenceVisionAnalysisError, type ReferenceVisionAnalyzerPort } from "@alchemy-video/reference-analysis";
import { deriveTranscriptScript, InMemoryCreativePlanningStore, InMemoryDeliveryPreflightStore, InMemoryDocumentConversionStore, InMemoryDocumentKnowledgeStore, InMemoryNarrationQualityStore, isUsableMusicAsset, MAX_DOCUMENT_CONTEXT_CHARACTERS, MAX_DOCUMENT_CONTEXTS_PER_BRIEF, type AssetWorkspaceStore, type ControlAsset, type ControlPlaneStore, type CreativePlanningStore, type DeliveryPreflightStore, type DocumentConversionStore, type DocumentKnowledgeStore, type NarrationQualityStore, type ProductionStore, type TaskRunStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort, StorageObjectAlreadyExistsError, StorageUnavailableError, createAssetObjectKey, type ObjectMetadataInspection, type StoragePort } from "@alchemy-video/storage-client";
import type { z } from "zod";
import { CreditPortError, VeyraIdentityError, type VideoVeyraBridgeAdapter } from "@alchemy-video/credit-veyra";
import type { CreditAccount, VeyraExternalIdentity, VideoGenerationInputSnapshot } from "@alchemy-video/contracts";

import { ControlApiError, validationError } from "./errors.js";
import { DevIdentityAdapter, DEV_IDENTITY_SEED, isVerifiedVeyraAdminRole, normalizeVeyraRole, type CurrentIdentity, type IdentityPort } from "./identity.js";
import { VideoSessionCodec } from "./veyra-session.js";
import { createPrefixedId } from "./ids.js";
import { errorHandler, requestLogger } from "./middleware/logger.js";
import { createInMemoryControlPlaneStore } from "./repository.js";
import { createInMemoryAssetWorkspaceStore } from "./asset-repository.js";
import { createInMemoryTaskRunStore } from "./task-run-repository.js";
import { serializeAsset, serializeCreativeBriefRevision, serializeDeliveryPlanRevision, serializeDocumentConversion, serializeDocumentKnowledgeDetail, serializeDocumentKnowledgeRevision, serializeProductionRun, serializeProductionRunProgress, serializeProject, serializeProjectDetail, serializeShot, serializeStoryboardRevision, serializeTaskRun, serializeTaskRunAttempt, serializeUser, serializeVideoVersion, serializeWorkspace } from "./serializers.js";
import { PixabayMusicError, type PixabayMusicDownload, type PixabayMusicPort } from "./pixabay-music.js";

type CreateAppOptions = {
  identity?: IdentityPort;
  store?: ControlPlaneStore;
  assetStore?: AssetWorkspaceStore;
  taskStore?: TaskRunStore;
  documentStore?: DocumentConversionStore;
  documentKnowledgeStore?: DocumentKnowledgeStore;
  planningStore?: CreativePlanningStore;
  deliveryPreflightStore?: DeliveryPreflightStore;
  narrationQualityStore?: NarrationQualityStore;
  productionStore?: Pick<ProductionStore, "listProjectProductionProgress" | "listProjectVideoVersions" | "retryProductionSegment"> & Partial<Pick<ProductionStore, "retryProductionComposition">>;
  storage?: StoragePort;
  buildVersion?: string;
  videoProviderMode?: VideoProviderRuntimeMode;
  videoPromptMaxUtf8Bytes?: number;
  referenceDeliveryTokenCodec?: ReferenceDeliveryTokenCodec;
  referenceVisionAnalyzer?: ReferenceVisionAnalyzerPort;
  videoVeyraBridge?: VideoVeyraBridgeAdapter;
  videoSessionCodec?: VideoSessionCodec;
  videoVeyraPortalBaseUrl?: string;
  videoBillingChargeAmount?: string;
  videoBillingModelRates?: Readonly<Record<string, string>>;
  videoBillingSurchargeMultiplier?: string;
  videoBillingFixedFee?: string;
  audioFreeOnly?: boolean;
  /** Inject the protected Media Runtime client; omit or pass null to disable. */
  pixabayMusic?: PixabayMusicPort | null;
  pixabayMusicEnabled?: boolean;
};

type ExternalEventAppender = (event: InternalEventEnvelope) => void;

const response = <T>(context: HonoContext, data: T, status: 200 | 201 | 202 = 200) =>
  context.json({ data, request_id: context.get("requestId") }, status);

type HonoContext = Context;

const parseBody = async <TSchema extends z.ZodTypeAny>(context: HonoContext, schema: TSchema): Promise<z.infer<TSchema>> => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw validationError("Request body must be valid JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationError("Request body does not match the command contract.");
  }
  return parsed.data;
};

const parseProjectId = (context: HonoContext) => {
  const parsed = ProjectIdSchema.safeParse(context.req.param("project_id"));
  if (!parsed.success) {
    throw validationError("project_id is invalid.");
  }
  return parsed.data;
};

const parseAssetId = (context: HonoContext, parameterName = "asset_id") => {
  const parsed = AssetIdSchema.safeParse(context.req.param(parameterName));
  if (!parsed.success) throw validationError(`${parameterName} is invalid.`);
  return parsed.data;
};

const parseShotId = (context: HonoContext) => {
  const parsed = ShotIdSchema.safeParse(context.req.param("shot_id"));
  if (!parsed.success) throw validationError("shot_id is invalid.");
  return parsed.data;
};

const parseTaskRunId = (context: HonoContext) => {
  const parsed = TaskRunIdSchema.safeParse(context.req.param("task_run_id"));
  if (!parsed.success) throw validationError("task_run_id is invalid.");
  return parsed.data;
};

const parseProductionRunId = (context: HonoContext) => {
  const parsed = ProductionRunIdSchema.safeParse(context.req.param("production_run_id"));
  if (!parsed.success) throw validationError("production_run_id is invalid.");
  return parsed.data;
};

const parseProductionSegmentSequence = (context: HonoContext) => {
  const value = context.req.param("sequence") ?? "";
  if (!/^[1-9]\d*$/.test(value)) throw validationError("sequence is invalid.");
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) throw validationError("sequence is invalid.");
  return sequence;
};

const parseDocumentConversionId = (context: HonoContext) => {
  const parsed = DocumentConversionIdSchema.safeParse(context.req.param("conversion_id"));
  if (!parsed.success) throw validationError("conversion_id is invalid.");
  return parsed.data;
};

const parseCreativeBriefRevisionId = (context: HonoContext) => {
  const parsed = CreativeBriefRevisionIdSchema.safeParse(context.req.param("creative_brief_revision_id"));
  if (!parsed.success) throw validationError("creative_brief_revision_id is invalid.");
  return parsed.data;
};

const parseStoryboardRevisionId = (context: HonoContext) => {
  const parsed = StoryboardRevisionIdSchema.safeParse(context.req.param("storyboard_revision_id"));
  if (!parsed.success) throw validationError("storyboard_revision_id is invalid.");
  return parsed.data;
};

const parseWorkspaceId = (context: HonoContext) => {
  const parsed = WorkspaceIdSchema.safeParse(context.req.query("workspace_id"));
  if (!parsed.success) throw validationError("workspace_id is invalid.");
  return parsed.data;
};

const readLastEventId = (context: HonoContext) => {
  const value = context.req.header("Last-Event-ID");
  if (!value) return undefined;
  const parsed = EventIdSchema.safeParse(value);
  if (!parsed.success) throw validationError("Last-Event-ID is invalid.");
  return parsed.data;
};

const readIdempotencyKey = (context: HonoContext) => {
  const parsed = IdempotencyKeySchema.safeParse(context.req.header("Idempotency-Key"));
  if (!parsed.success) {
    throw validationError("Idempotency-Key is required for commands.");
  }
  return parsed.data;
};

const resolveWorkspaceAccess = async (
  context: HonoContext,
  identityPort: IdentityPort,
  store: ControlPlaneStore,
): Promise<CurrentIdentity> => {
  let identity: CurrentIdentity;
  try {
    identity = await identityPort.resolve(context.req.raw);
  } catch (error) {
    if (error instanceof Error && error.message === "Video session is missing or expired.") {
      throw new ControlApiError(503, "AUTH_FORBIDDEN", "Video account sign-in is required.");
    }
    throw error;
  }
  if (identity.bootstrap && (
    identity.bootstrap.user.id !== identity.userId || identity.bootstrap.workspace.id !== identity.workspaceId
  )) {
    throw new ControlApiError(503, "AUTH_UNAVAILABLE", "The identity mapping is unavailable.", true);
  }
  await (identity.bootstrap ? store.ensureIdentity(identity.bootstrap) : store.ensureDevIdentity(DEV_IDENTITY_SEED));

  const user = await store.findUser(identity.userId);
  if (!user) {
    throw new ControlApiError(503, "AUTH_UNAVAILABLE", "The local development identity is unavailable.", true);
  }
  if (!(await store.hasWorkspaceMembership(identity.workspaceId, identity.userId))) {
    throw new ControlApiError(403, "WORKSPACE_FORBIDDEN", "The current identity cannot access this workspace.");
  }
  return identity;
};

/**
 * A signed session role is a display/cached hint only.  Cross-workspace
 * reads require a fresh, active Veyra account lookup on every request so a
 * stale or tampered bootstrap can never grant administrator visibility.
 */
const resolveVerifiedAdminAccess = async (
  identity: CurrentIdentity,
  bridge: VideoVeyraBridgeAdapter | undefined,
) => {
  if (identity.isAdmin !== true || !identity.externalUserId || !bridge) return false;
  try {
    const account = await bridge.getAccount({ externalUserId: identity.externalUserId });
    return account.externalUserId === identity.externalUserId
      && account.status.trim().toLowerCase() === "active"
      && isVerifiedVeyraAdminRole(normalizeVeyraRole(account.role));
  } catch {
    // An unavailable authority must never widen visibility.  The caller may
    // continue with the normal workspace-scoped read.
    return false;
  }
};

const listProjectsForRead = async (
  identity: CurrentIdentity,
  store: ControlPlaneStore,
  isAdmin: boolean,
) => {
  // Even for administrators, every project lookup is made through the
  // workspace-scoped repository method.  The explicit workspace target list
  // is obtained only after the live Veyra capability check above.
  const workspaces = isAdmin
    ? await store.listWorkspacesForAdmin()
    : [{ id: identity.workspaceId }];
  const projectLists = await Promise.all(workspaces.map((workspace) => store.listProjects(workspace.id)));
  return projectLists
    .flat()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const findProjectForRead = async (
  identity: CurrentIdentity,
  store: ControlPlaneStore,
  projectId: string,
  isAdmin: boolean,
) => {
  if (!isAdmin) return store.findProject(identity.workspaceId, projectId);
  const workspaces = await store.listWorkspacesForAdmin();
  for (const workspace of workspaces) {
    const project = await store.findProject(workspace.id, projectId);
    if (project) return project;
  }
  return undefined;
};

const idempotencyConflict = () =>
  new ControlApiError(
    409,
    "IDEMPOTENCY_CONFLICT",
    "The idempotency key was already used for a different command.",
  );

const notFound = (message: string) => new ControlApiError(404, "NOT_FOUND", message);
const invalidReference = () => new ControlApiError(400, "VALIDATION_FAILED", "Reference assets must be READY assets in the same project.");
const invalidCreativeSource = () => new ControlApiError(400, "VALIDATION_FAILED", "Creative source materials must be READY assets in the same project.");
const documentContextInvalid = () => new ControlApiError(422, "DOCUMENT_CONTEXT_INVALID", "项目资料整理完成后才能参与故事规划。");
const documentKnowledgeNotReady = () => new ControlApiError(422, "DOCUMENT_KNOWLEDGE_NOT_READY", "项目资料的事实理解尚未就绪，请稍后重试。", true);
const documentFactContextInvalid = () => new ControlApiError(422, "DOCUMENT_FACT_CONTEXT_INVALID", "项目资料事实快照校验失败，请重新生成资料理解。", false);
const storageUnavailable = () => new ControlApiError(503, "STORAGE_UNAVAILABLE", "Object storage is unavailable.", true);
const invalidUpload = () => new ControlApiError(400, "DOWNLOAD_INVALID", "Uploaded object metadata does not match the confirmed asset.");
const shotPositionConflict = () => new ControlApiError(409, "SHOT_POSITION_CONFLICT", "Another shot already uses this project position.");
const taskRunActiveConflict = () => new ControlApiError(409, "TASK_RUN_ACTIVE_CONFLICT", "The shot already has an active task run.");
const taskStateInvalid = () => new ControlApiError(400, "TASK_STATE_INVALID", "The task run cannot be retried from its current state.");
const projectInUse = () => new ControlApiError(409, "PROJECT_IN_USE", "项目仍有进行中的任务或制作批次，请完成或停止后再删除。", false);
const invalidDocumentSource = () => new ControlApiError(400, "DOCUMENT_UNSUPPORTED", "The selected project material cannot be converted.");

const activeProductionRunStatuses = new Set(PRODUCTION_RUN_STATUSES.filter((status) => !["SUCCEEDED", "BLOCKED", "FAILED"].includes(status)));
const projectHasActiveWork = async (workspaceId: string, projectId: string, taskStore: TaskRunStore, planningStore: CreativePlanningStore) => {
  const [taskRuns, productionRuns] = await Promise.all([
    taskStore.listProjectTaskRuns(workspaceId, projectId),
    planningStore.listProjectProductionRuns(workspaceId, projectId),
  ]);
  return taskRuns.some((taskRun) => !(TASK_RUN_TERMINAL_STATUSES as readonly string[]).includes(taskRun.status))
    || productionRuns.some((productionRun) => activeProductionRunStatuses.has(productionRun.status));
};

const parseDocumentKnowledgeRevisionId = (context: HonoContext) => {
  const parsed = DocumentKnowledgeRevisionIdSchema.safeParse(context.req.param("knowledge_revision_id"));
  if (!parsed.success) throw validationError("knowledge_revision_id is invalid.");
  return parsed.data;
};

const parseDeliveryPlanRevisionId = (context: HonoContext) => {
  const parsed = DeliveryPlanRevisionIdSchema.safeParse(context.req.param("delivery_plan_revision_id"));
  if (!parsed.success) throw validationError("delivery_plan_revision_id is invalid.");
  return parsed.data;
};

const parseNarrationScriptRevisionId = (context: HonoContext) => {
  const parsed = NarrationScriptRevisionIdSchema.safeParse(context.req.param("narration_script_revision_id"));
  if (!parsed.success) throw validationError("narration_script_revision_id is invalid.");
  return parsed.data;
};
const documentConversionConflict = () => new ControlApiError(409, "DOCUMENT_CONVERSION_ACTIVE_CONFLICT", "This project material is already being organized.");
const documentConversionStateInvalid = () => new ControlApiError(400, "DOCUMENT_CONVERSION_FAILED", "This project material cannot be organized from its current state.");
const creativePlanConflict = () => new ControlApiError(409, "CREATIVE_PLAN_ACTIVE_CONFLICT", "This creative brief is already being planned.");
const creativePlanStateInvalid = () => new ControlApiError(400, "CREATIVE_PLAN_STATE_INVALID", "This creative brief cannot be planned from its current state.");
const storyboardStateInvalid = () => new ControlApiError(400, "STORYBOARD_SPEC_INVALID", "This storyboard cannot be approved from its current state.");
const productionRunConflict = () => new ControlApiError(409, "PRODUCTION_RUN_ACTIVE_CONFLICT", "This project already has an active production plan.");
const productionRunStateInvalid = () => new ControlApiError(400, "PRODUCTION_RUN_STATE_INVALID", "This storyboard must be approved before creating a production plan.");
const deliveryPreflightBlocked = () => new ControlApiError(400, "DELIVERY_PREFLIGHT_BLOCKED", "This delivery plan is not approved for production.");
const productionSegmentStateInvalid = () => new ControlApiError(400, "PRODUCTION_SEGMENT_STATE_INVALID", "This production segment cannot be retried from its current state.");
const deliveryPlanStateInvalid = () => new ControlApiError(400, "DELIVERY_PLAN_STATE_INVALID", "This delivery preflight cannot be changed from its current state.");
const narrationApprovalRequired = () => new ControlApiError(
  422,
  "DELIVERY_PLAN_STATE_INVALID",
  "旁白脚本必须先完成样音审批并生成 READY 时间线；请先调用旁白脚本、批准和时间线接口，再开始制作。",
  true,
);
const mapVeyraError = (error: unknown): never => {
  if (error instanceof VeyraIdentityError) throw new ControlApiError(error.code === "AUTH_FORBIDDEN" ? 403 : 503, error.code, error.message, error.retryable);
  if (error instanceof CreditPortError) throw new ControlApiError(error.code === "CREDIT_INSUFFICIENT" ? 409 : (error.code === "AUTH_FORBIDDEN" ? 403 : 503), error.code, error.message, error.retryable);
  throw error;
};

const requestedMetadataMatches = (asset: { metadata: Record<string, unknown> }, input: { mimeType: string; byteSize: number }) =>
  asset.metadata.requested_mime_type === input.mimeType && asset.metadata.requested_byte_size === input.byteSize;

const referenceImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxReferenceImageBytes = 8 * 1024 * 1024;

const inferVisualReferenceRole = (input: { bindingRole: string; promptRole?: VisualReferenceRole }): VisualReferenceRole | undefined => {
  if (input.bindingRole === "FIRST_FRAME") return "HANDOFF";
  return input.promptRole;
};

const readReferenceBytes = async (stream: ReadableStream<Uint8Array>, maximumBytes: number) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) throw new Error("Reference image exceeds analysis limit.");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/** Use one existing authored value as the source query; do not synthesize or
 * rewrite keywords for the automatic fallback. */
const firstValidPixabayQuery = (values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const parsed = PixabayMusicImportCommandSchema.safeParse({ query: value });
    if (parsed.success) return parsed.data.query;
  }
  return undefined;
};

/**
 * Retry the existing reference-vision adapter for READY images that predate
 * visual analysis. Role ownership still comes only from explicit user text or
 * the analyzer; sourceAssetIds are used solely to locate the selected assets.
 */
const analyzeMissingReferenceImages = async (input: {
  workspaceId: string;
  projectId: string;
  sourcePrompt: string;
  sourceAssetIds: string[];
  assetStore: AssetWorkspaceStore;
  storage: StoragePort;
  analyzer: ReferenceVisionAnalyzerPort;
}) => {
  const update = input.assetStore.updateVisualReferenceAnalysis;
  if (!update) return;
  const persist = update.bind(input.assetStore);
  const images = [] as Array<NonNullable<Awaited<ReturnType<AssetWorkspaceStore["findAsset"]>>>>;
  for (const assetId of input.sourceAssetIds) {
    const asset = await input.assetStore.findAsset(input.workspaceId, assetId);
    if (!asset
      || asset.projectId !== input.projectId
      || asset.status !== "READY"
      || asset.origin !== "USER_UPLOAD"
      || asset.kind !== "IMAGE"
      || !asset.sha256
      || !asset.byteSize
      || asset.byteSize > maxReferenceImageBytes
      || !referenceImageMimeTypes.has(asset.mimeType ?? "")) continue;
    images.push(asset);
  }
  if (images.length === 0) return;

  const roles = inferVisualReferenceRoles({
    sourcePrompt: input.sourcePrompt,
    count: images.length,
    sourceImageNames: images.map((asset) => typeof asset.metadata.filename === "string" ? asset.metadata.filename : undefined),
    visionAnalyses: images.map((asset) => parseVisualReferenceAnalysis(asset.metadata.visual_analysis)),
  });
  for (const [position, asset] of images.entries()) {
    if (roles[position] !== undefined) continue;
    try {
      const inspection = await input.storage.inspectObject({ objectKey: asset.objectKey });
      if (!inspection
        || inspection.mimeType !== asset.mimeType
        || inspection.byteSize !== asset.byteSize
        || inspection.sha256 !== asset.sha256) continue;
      const object = await input.storage.readObject({ objectKey: asset.objectKey });
      if (!object
        || object.mimeType !== asset.mimeType
        || (object.byteSize !== undefined && object.byteSize !== asset.byteSize)) {
        await persist({ workspaceId: input.workspaceId, projectId: input.projectId, assetId: asset.id, visualAnalysisStatus: "FAILED" });
        continue;
      }
      const visualAnalysis = await input.analyzer.analyze({
        assetId: asset.id,
        mimeType: asset.mimeType as "image/jpeg" | "image/png" | "image/webp",
        bytes: await readReferenceBytes(object.stream, maxReferenceImageBytes),
      });
      await persist({ workspaceId: input.workspaceId, projectId: input.projectId, assetId: asset.id, visualAnalysis, visualAnalysisStatus: "READY" });
    } catch (error) {
      if (error instanceof StorageUnavailableError) continue;
      await persist({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        assetId: asset.id,
        visualAnalysisStatus: error instanceof ReferenceVisionAnalysisError && error.retryable ? "UNAVAILABLE" : "FAILED",
      });
    }
  }
};

export function createApp(options: CreateAppOptions = {}) {
  const identityPort = options.identity ?? new DevIdentityAdapter();
  const store = options.store ?? createInMemoryControlPlaneStore();
  const assetStore = options.assetStore ?? createInMemoryAssetWorkspaceStore(store);
  const taskStore = options.taskStore ?? createInMemoryTaskRunStore(assetStore);
  const documentKnowledgeStore = options.documentKnowledgeStore ?? new InMemoryDocumentKnowledgeStore();
  const documentStore = options.documentStore ?? new InMemoryDocumentConversionStore(
    assetStore,
    documentKnowledgeStore instanceof InMemoryDocumentKnowledgeStore
      ? async (completion) => {
        documentKnowledgeStore.seedConversion({
          workspaceId: completion.workspaceId,
          projectId: completion.projectId,
          documentId: completion.documentId,
          conversionId: completion.conversionId,
          markdownAssetId: completion.markdownAssetId,
          markdownSha256: completion.markdownSha256,
          status: "SUCCEEDED",
        });
        const result = await documentKnowledgeStore.createKnowledgeRevision({
          scope: `internal:document-conversion:${completion.workspaceId}:${completion.conversionId}`,
          idempotencyKey: `knowledge:${completion.conversionId}`,
          requestHash: completion.markdownSha256,
          workspaceId: completion.workspaceId,
          projectId: completion.projectId,
          knowledgeRevisionId: `dkr_${completion.conversionId.slice("dcv_".length)}`,
          documentId: completion.documentId,
          conversionId: completion.conversionId,
          markdownAssetId: completion.markdownAssetId,
          markdownSha256: completion.markdownSha256,
          analyzerVersion: "deterministic-document-understanding-v1",
          event: {
            eventId: createPrefixedId("evt"),
            messageId: createPrefixedId("msg"),
            traceId: completion.event.traceId,
            correlationId: completion.event.correlationId,
          },
        });
        if (result.kind === "INVALID_SOURCE" || result.kind === "CONFLICT") {
          throw new Error(`Document knowledge bridge rejected conversion ${completion.conversionId}: ${result.kind}`);
        }
      }
      : undefined,
  );
  const documentUnderstandingSummary = async (conversion: { id: string; documentId: string; workspaceId: string; projectId: string }): Promise<DocumentUnderstandingSummary> => {
    const revisions = (await documentKnowledgeStore.listProjectKnowledgeRevisions(conversion.workspaceId, conversion.projectId))
      .filter((revision) => revision.conversionId === conversion.id && revision.documentId === conversion.documentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt));
    const revision = revisions[0];
    if (!revision) {
      return {
        knowledge_revision_id: null,
        status: null,
        retryable: false,
        analysis_quality: null,
        fact_count: 0,
        has_confirmation: false,
        has_visual_gaps: false,
      };
    }
    const [sections, facts] = await Promise.all([
      documentKnowledgeStore.listSections(conversion.workspaceId, revision.id),
      documentKnowledgeStore.listFacts(conversion.workspaceId, revision.id),
    ]);
    return {
      knowledge_revision_id: revision.id,
      status: revision.status,
      retryable: revision.retryable,
      analysis_quality: revision.analysisQuality,
      fact_count: revision.factCount,
      has_confirmation: revision.analysisQuality === "NEEDS_CONFIRMATION" || facts.some((fact) => fact.confidence === "NEEDS_CONFIRMATION"),
      has_visual_gaps: sections.some((section) => section.evidenceKind === "VISUAL_UNAVAILABLE"),
    };
  };
  const documentContextResolver = {
    resolveDocumentContexts: async (input: { workspaceId: string; projectId: string; sourceAssetIds: string[] }) => {
      const conversions = await documentStore.listProjectDocumentConversions(input.workspaceId, input.projectId);
      const contexts: Array<{
        documentId: string;
        conversionId: string;
        sourceAssetId: string;
        markdownAssetId: string;
        markdownSha256: string;
        markdownObjectKey: string;
        sequence: number;
        maxContentCharacters: number;
      }> = [];
      for (const sourceAssetId of input.sourceAssetIds) {
        const source = await assetStore.findAsset(input.workspaceId, sourceAssetId);
        if (!source || source.projectId !== input.projectId || source.kind !== "DOCUMENT") continue;
        const matches = conversions.filter((conversion) => conversion.sourceAssetId === sourceAssetId && conversion.status === "SUCCEEDED" && Boolean(conversion.markdownAssetId));
        if (matches.length !== 1 || contexts.length >= MAX_DOCUMENT_CONTEXTS_PER_BRIEF) return undefined;
        const conversion = matches[0]!;
        const markdown = await assetStore.findAsset(input.workspaceId, conversion.markdownAssetId!);
        if (!markdown
          || markdown.projectId !== input.projectId
          || markdown.kind !== "DOCUMENT"
          || markdown.origin !== "DERIVED"
          || markdown.status !== "READY"
          || markdown.mimeType !== "text/markdown"
          || !markdown.sha256) return undefined;
        contexts.push({
          documentId: conversion.documentId,
          conversionId: conversion.id,
          sourceAssetId,
          markdownAssetId: markdown.id,
          markdownSha256: markdown.sha256,
          markdownObjectKey: markdown.objectKey,
          sequence: contexts.length + 1,
          maxContentCharacters: MAX_DOCUMENT_CONTEXT_CHARACTERS,
        });
      }
      return contexts;
    },
  };
  const factSelector = new DeterministicFactSelector();
  const factContextResolver = {
    resolveFactContexts: async (input: { workspaceId: string; projectId: string; creativeBriefRevisionId: string; sourceAssetIds: string[]; sourceText: string; stylePreferences: string }) => {
      const facts = [] as Array<{
        fact_id: string;
        category: "BRAND" | "PRODUCT" | "LOCATION" | "AUDIENCE" | "SELLING_POINT" | "AMENITY" | "STYLE" | "CTA" | "COMPLIANCE" | "NUMERIC_CLAIM" | "RISK";
        statement: string;
        confidence: "EXPLICIT" | "INFERRED" | "NEEDS_CONFIRMATION";
        source: { document_id: string; conversion_id: string; section_sequence: number; locator: string };
      }>;
      let selectedDocumentCount = 0;
      const conversions = await documentStore.listProjectDocumentConversions(input.workspaceId, input.projectId);
      for (const sourceAssetId of input.sourceAssetIds) {
        const source = await assetStore.findAsset(input.workspaceId, sourceAssetId);
        if (!source || source.kind !== "DOCUMENT") continue;
        selectedDocumentCount += 1;
        const conversion = conversions.find((item) => item.sourceAssetId === sourceAssetId && item.status === "SUCCEEDED" && item.markdownAssetId);
        if (!conversion || !conversion.markdownAssetId) return undefined;
        const markdown = await assetStore.findAsset(input.workspaceId, conversion.markdownAssetId);
        const knowledge = (await documentKnowledgeStore.listProjectKnowledgeRevisions(input.workspaceId, input.projectId)).find((item) => item.conversionId === conversion.id && item.status === "READY" && item.markdownSha256 === markdown?.sha256);
        if (!knowledge) return undefined;
        const sections = await documentKnowledgeStore.listSections(input.workspaceId, knowledge.id);
        const sectionLocators = new Map(sections.map((section) => [section.sequence, section.locator]));
        const documentFacts = await documentKnowledgeStore.listFacts(input.workspaceId, knowledge.id);
        facts.push(...documentFacts.map((fact) => ({
          fact_id: fact.id,
          category: fact.category,
          statement: fact.statement,
          confidence: fact.confidence,
          source: { document_id: knowledge.documentId, conversion_id: knowledge.conversionId, section_sequence: fact.sectionSequence, locator: sectionLocators.get(fact.sectionSequence) ?? `第 ${fact.sectionSequence} 节` },
        })));
      }
      if (selectedDocumentCount === 0) return [];
      return [...factSelector.selectForBrief({ creativeBriefRevisionId: input.creativeBriefRevisionId, sourceText: input.sourceText, stylePreferences: input.stylePreferences, facts })];
    },
  };
  const planningStore = options.planningStore ?? new InMemoryCreativePlanningStore(assetStore, documentContextResolver, factContextResolver);
  const deliveryPreflightStore = options.deliveryPreflightStore ?? new InMemoryDeliveryPreflightStore(planningStore);
  const appendExternalEvent: ExternalEventAppender | undefined =
    typeof (taskStore as { appendExternalEvent?: unknown }).appendExternalEvent === "function"
      ? (event) => (taskStore as unknown as { appendExternalEvent: ExternalEventAppender }).appendExternalEvent(event)
      : undefined;
  const narrationQualityStore = options.narrationQualityStore ?? new InMemoryNarrationQualityStore(
    deliveryPreflightStore,
    assetStore,
    appendExternalEvent,
  );
  if (planningStore instanceof InMemoryCreativePlanningStore) {
    planningStore.setDeliveryPlanResolver(deliveryPreflightStore);
  }
  const productionStore = options.productionStore;
  const storage = options.storage ?? new InMemoryStoragePort();
  const videoProfile = resolveVideoProviderRuntimeProfile(options.videoProviderMode ?? "mock");
  const videoPromptMaxUtf8Bytes = resolveVideoPromptMaxUtf8Bytes(options.videoPromptMaxUtf8Bytes);
  const referenceDeliveryTokenCodec = options.referenceDeliveryTokenCodec;
  const referenceVisionAnalyzer = options.referenceVisionAnalyzer;
  // Environment billing values are active only with the explicit credit
  // switch. Identity-only AISelf mode must not freeze a billing snapshot just
  // because deployment secrets happen to contain the fee policy. Tests and
  // embedded callers may still inject an explicit option.
  const environmentBillingEnabled = process.env.VEYRA_CREDIT_ENABLED === "true";
  const videoBillingChargeAmount = options.videoBillingChargeAmount
    ?? (environmentBillingEnabled ? process.env.VIDEO_BILLING_CHARGE_AMOUNT : undefined)
    ?? "0";
  const videoBillingModelRates = options.videoBillingModelRates
    ?? (environmentBillingEnabled ? parseVideoBillingModelRates(process.env.VIDEO_BILLING_MODEL_RATES_JSON) : {});
  const videoBillingSurchargeMultiplier = parseVideoBillingSurchargeMultiplier(
    options.videoBillingSurchargeMultiplier
      ?? (environmentBillingEnabled ? process.env.VIDEO_BILLING_SURCHARGE_MULTIPLIER : undefined),
  );
  const videoBillingFixedFee = parseVideoBillingFixedFee(
    options.videoBillingFixedFee
      ?? (environmentBillingEnabled ? process.env.VIDEO_BILLING_FIXED_FEE : undefined),
  );
  const resolveVideoBillingConfig = () => {
    const usageMultiplier = videoBillingSurchargeMultiplier ?? videoBillingModelRates[videoProfile.model];
    const usagePricingConfigured = usageMultiplier !== undefined;
    const legacyChargeConfigured = videoBillingChargeAmount !== "0";
    if (usagePricingConfigured && videoBillingFixedFee === undefined) {
      throw new ControlApiError(503, "CREDIT_UNAVAILABLE", "Video billing usage pricing requires an explicit fixed service fee.", false);
    }
    if (videoBillingFixedFee !== undefined && !usagePricingConfigured) {
      throw new ControlApiError(503, "CREDIT_UNAVAILABLE", "Video billing fixed fee requires a usage surcharge multiplier.", false);
    }
    if (usagePricingConfigured && legacyChargeConfigured) {
      throw new ControlApiError(503, "CREDIT_UNAVAILABLE", "Video billing usage pricing cannot be combined with the legacy fixed charge.", false);
    }
    return {
      usageMultiplier,
      usagePricingConfigured,
      billingConfigured: legacyChargeConfigured || usagePricingConfigured,
    };
  };
  const createFrozenVideoBilling = async (identity: CurrentIdentity): Promise<VideoGenerationInputSnapshot["billing"]> => {
    const { usageMultiplier, usagePricingConfigured, billingConfigured } = resolveVideoBillingConfig();
    if (!billingConfigured) return undefined;
    if (!options.videoVeyraBridge) {
      throw new ControlApiError(503, "CREDIT_UNAVAILABLE", "Shared credit billing is configured but its server bridge is unavailable.", true);
    }
    if (!identity.externalUserId) {
      throw new ControlApiError(503, "AUTH_UNAVAILABLE", "Shared credit billing requires a verified AISelf account.", true);
    }
    const account = await options.videoVeyraBridge.getAccount({ externalUserId: identity.externalUserId });
    if (account.status.toLowerCase() !== "active") {
      throw new ControlApiError(403, "AUTH_FORBIDDEN", "The shared credit account is not active.");
    }
    return {
      external_user_id: identity.externalUserId,
      billing_rule: {
        creditProvider: "veyra_sub2api" as const,
        billingRuleKey: usagePricingConfigured ? `video:usage-surcharge-v1:${videoProfile.model}` : "video:sub2api-v1",
        ...(usagePricingConfigured
          ? {
              usagePricing: {
                model: videoProfile.model,
                multiplier: usageMultiplier,
                ...(videoBillingFixedFee !== undefined ? { fixedFee: videoBillingFixedFee } : {}),
              },
            }
          : { chargeAmount: videoBillingChargeAmount }),
        source: usagePricingConfigured ? "video:aiself-actual-cost-plus-service-fee" : "video:sub2api-v1",
      },
    };
  };
  const audioFreeOnly = options.audioFreeOnly ?? process.env.AUDIO_FREE_ONLY !== "false";
  const pixabayMusicEnabled = options.pixabayMusicEnabled ?? process.env.PIXABAY_MUSIC_ENABLED !== "false";
  // Direct Node-side Pixabay fetching is not a production path.  The runtime
  // client is injected by index.ts; absent an explicit port, keep the
  // capability disabled rather than constructing a second fetcher here.
  const pixabayMusic = options.pixabayMusic === undefined ? null : options.pixabayMusic;
  const buildVersion = options.buildVersion ?? process.env.BUILD_VERSION ?? "local";
  const app = new Hono();

  type PixabayMusicImportResult = {
    asset: ControlAsset;
    status: 200 | 201;
    track: {
      title: string;
      artist: string;
      duration_seconds: number | null;
      pixabay_id: string | number | null;
      results_found: number;
      results_after_filter: number;
    };
  };

  const trackFromAsset = (asset: ControlAsset): PixabayMusicImportResult["track"] => {
    const metadata = asset.metadata;
    return {
      title: typeof metadata.pixabay_title === "string" ? metadata.pixabay_title : "Unknown",
      artist: typeof metadata.pixabay_artist === "string" ? metadata.pixabay_artist : "Unknown",
      duration_seconds: asset.durationMs === null ? null : asset.durationMs / 1000,
      pixabay_id: typeof metadata.pixabay_id === "string" || typeof metadata.pixabay_id === "number" ? metadata.pixabay_id : null,
      results_found: typeof metadata.pixabay_results_found === "number" ? metadata.pixabay_results_found : 0,
      results_after_filter: typeof metadata.pixabay_results_after_filter === "number" ? metadata.pixabay_results_after_filter : 0,
    };
  };

  const mapPixabayMusicError = (error: unknown): never => {
    if (error instanceof PixabayMusicError) {
      if (error.kind === "NO_RESULTS") throw new ControlApiError(400, "PROVIDER_REJECTED", error.message);
      if (error.kind === "INVALID") throw new ControlApiError(503, "PROVIDER_PROTOCOL_INVALID", error.message, false);
      throw new ControlApiError(503, "PROVIDER_UNAVAILABLE", error.message, error.retryable);
    }
    throw error;
  };

  /**
   * Shared server-side Pixabay import path.  The public route and the AUTO
   * fallback both reserve/confirm the same Asset facts; only their scope and
   * idempotency key differ.  The scraper remains exclusively in Media
   * Runtime, behind the injected loopback port.
   */
  const importPixabayMusicAsset = async (input: {
    workspaceId: string;
    projectId: string;
    command: PixabayMusicImportCommand;
    scope: string;
    idempotencyKey: string;
  }): Promise<PixabayMusicImportResult> => {
    if (!pixabayMusicEnabled || !pixabayMusic) {
      throw new ControlApiError(503, "PROVIDER_UNAVAILABLE", "Pixabay Music is disabled or not configured.", true);
    }

    const requestHash = fingerprintRequest(input.command);
    const assetId = createPrefixedId("ast");
    const filename = "pixabay_music.mp3";
    const execution = await assetStore.createUploadAsset({
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId,
      kind: "AUDIO",
      objectKey: createAssetObjectKey({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        assetId,
        filename,
        mimeType: "audio/mpeg",
      }),
      filename,
      mimeType: "audio/mpeg",
      // Import size is unknown until the source download completes.  The
      // internal confirmation below replaces this reservation metadata with
      // the measured byte size; the public upload command remains unchanged.
      byteSize: 1,
      audioRole: "MUSIC",
      metadata: {
        audio_provider: "pixabay_music",
        pixabay_query: input.command.query,
      },
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Project not found.");
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") throw new Error("Unexpected Pixabay import command outcome.");

    const existing = execution.value;
    if (existing.status === "READY") return { asset: existing, status: 200, track: trackFromAsset(existing) };

    let download: PixabayMusicDownload;
    try {
      download = await pixabayMusic.execute(input.command);
    } catch (error) {
      return mapPixabayMusicError(error);
    }

    const digest = createHash("sha256").update(download.bytes).digest("hex");
    try {
      await storage.putObject({ objectKey: existing.objectKey, mimeType: download.mimeType, bytes: download.bytes, ifNoneMatch: "*" });
    } catch (error) {
      if (!(error instanceof StorageObjectAlreadyExistsError)) {
        if (error instanceof StorageUnavailableError) throw storageUnavailable();
        throw error;
      }
      const object = await storage.inspectObject({ objectKey: existing.objectKey });
      if (!object || object.mimeType !== download.mimeType || object.byteSize !== download.bytes.byteLength || object.sha256 !== digest) {
        throw invalidUpload();
      }
    }

    const durationMs = download.track.duration === null ? undefined : Math.max(0, Math.round(download.track.duration * 1000));
    const confirmation = await assetStore.confirmAssetUpload({
      scope: `${input.scope}:confirm-upload`,
      idempotencyKey: `${input.idempotencyKey}:confirm`,
      requestHash: fingerprintRequest({ command: input.command, sha256: digest }),
      workspaceId: input.workspaceId,
      assetId: existing.id,
      sha256: digest,
      mimeType: download.mimeType,
      byteSize: download.bytes.byteLength,
      ...(durationMs === undefined ? {} : { durationMs }),
      metadata: {
        filename: download.filename,
        requested_byte_size: download.bytes.byteLength,
        audio_provider: "pixabay_music",
        pixabay_query: download.query,
        pixabay_title: download.track.title,
        pixabay_artist: download.track.artist,
        source_title: download.track.title,
        source_artist: download.track.artist,
        pixabay_results_found: download.results_found,
        pixabay_results_after_filter: download.results_after_filter,
        ...(download.track.pixabay_id === undefined ? {} : { pixabay_id: download.track.pixabay_id }),
        ...(typeof download.track.rating === "number" && Number.isFinite(download.track.rating)
          ? { pixabay_rating: download.track.rating }
          : {}),
        ...(typeof download.track.download_count === "number" && Number.isFinite(download.track.download_count)
          ? { pixabay_download_count: download.track.download_count }
          : {}),
      },
      verifyUpload: async (asset) => {
        let object;
        try {
          object = await storage.inspectObject({ objectKey: asset.objectKey });
        } catch (error) {
          if (error instanceof StorageUnavailableError) throw storageUnavailable();
          throw error;
        }
        return Boolean(
          object
          && object.mimeType === download.mimeType
          && object.byteSize === download.bytes.byteLength
          && object.sha256 === digest,
        );
      },
    });
    if (confirmation.kind === "CONFLICT") throw idempotencyConflict();
    if (confirmation.kind === "NOT_FOUND") throw notFound("Asset not found.");
    if (confirmation.kind === "INVALID_UPLOAD") throw invalidUpload();
    return {
      asset: confirmation.value,
      status: confirmation.kind === "NEW" ? 201 : confirmation.status,
      track: {
        title: download.track.title,
        artist: download.track.artist,
        duration_seconds: download.track.duration,
        pixabay_id: download.track.pixabay_id ?? null,
        results_found: download.results_found,
        results_after_filter: download.results_after_filter,
      },
    };
  };

  app.use(
    "*",
    cors({
      origin: ["http://localhost:3031", "http://127.0.0.1:3031"],
      credentials: true
    })
  );
  app.use("*", requestLogger);
  app.onError(errorHandler);

  const providerInputEmptyResponse = (status: 404 | 503) => new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Length": "0" },
  });

  // The verified asset/claim SHA-256 binding above is immutable after upload
  // confirmation.  Relay HEAD only needs the object's current MIME and size;
  // recomputing a full object hash here would turn a metadata probe into a
  // potentially slow GET before the Provider request.
  const inspectStorageMetadata = async (input: { objectKey: string; signal?: AbortSignal }): Promise<ObjectMetadataInspection | undefined> => {
    const metadataReader = (storage as StoragePort & {
      inspectObjectMetadata?: (input: { objectKey: string; signal?: AbortSignal }) => Promise<ObjectMetadataInspection | undefined>;
    }).inspectObjectMetadata;
    // The provider-input HEAD relay must remain metadata-only.  A legacy
    // storage implementation that cannot provide that capability is not
    // allowed to fall back to inspectObject(), which downloads and hashes the
    // object and can exhaust the relay preflight window.
    if (typeof metadataReader !== "function") return undefined;
    return metadataReader.call(storage, input);
  };

  const providerInputResponse = async (context: HonoContext, includeBody: boolean) => {
    const token = context.req.param("token") ?? "";
    const claim = referenceDeliveryTokenCodec?.verify(token);
    if (!claim) return providerInputEmptyResponse(404);
    const asset = await assetStore.findAsset(claim.workspaceId, claim.assetId);
    if (!asset
      || asset.projectId !== claim.projectId
      || asset.status !== "READY"
      || asset.kind !== "IMAGE"
      || asset.sha256 !== claim.sha256
      || asset.mimeType !== claim.mimeType
      || !referenceImageMimeTypes.has(asset.mimeType)
      || !asset.byteSize
      || asset.byteSize > maxReferenceImageBytes) {
      return providerInputEmptyResponse(404);
    }
    try {
      if (!includeBody) {
        const object = await inspectStorageMetadata({ objectKey: asset.objectKey, signal: context.req.raw.signal });
        if (!object || object.mimeType !== claim.mimeType || object.byteSize !== asset.byteSize) {
          return providerInputEmptyResponse(404);
        }
        return new Response(null, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Content-Length": String(object.byteSize),
            "Content-Type": object.mimeType,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const object = await storage.readObject({ objectKey: asset.objectKey });
      if (!object || object.mimeType !== claim.mimeType || (object.byteSize !== undefined && object.byteSize !== asset.byteSize)) {
        if (object) await object.stream.cancel().catch(() => undefined);
        return providerInputEmptyResponse(404);
      }
      return new Response(object.stream, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          ...(object.byteSize === undefined ? {} : { "Content-Length": String(object.byteSize) }),
          "Content-Type": object.mimeType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        return providerInputEmptyResponse(503);
      }
      throw error;
    }
  };

  // Hono dispatches HEAD through the GET router while preserving the request
  // method. Branch here so relay HEAD remains metadata-only in the actual
  // server, rather than relying on a separate HEAD route that is never hit.
  app.get("/provider-input/:token", (context) => providerInputResponse(context, context.req.method !== "HEAD"));

  const redirectToVideoPortal = (context: Context) => {
    if (!options.videoSessionCodec || !options.videoVeyraBridge) {
      throw new ControlApiError(503, "AUTH_UNAVAILABLE", "Video account sign-in is not configured.", true);
    }
    const baseUrl = options.videoVeyraPortalBaseUrl ?? "https://aiself.vip";
    let portalUrl: URL;
    try {
      portalUrl = new URL(baseUrl);
      if (portalUrl.protocol !== "https:" || portalUrl.username || portalUrl.password || portalUrl.search || portalUrl.hash) {
        throw new Error("invalid portal URL");
      }
      portalUrl.pathname = "/_veyra/return";
      portalUrl.search = "?target=video";
    } catch {
      throw new ControlApiError(503, "AUTH_UNAVAILABLE", "Video account sign-in is not configured.", true);
    }
    return context.redirect(portalUrl.toString(), 303);
  };
  // Keep the provider-specific path as a compatibility alias; the browser uses
  // the provider-neutral public entry point below.
  app.get("/auth/login", redirectToVideoPortal);
  app.get("/auth/veyra/login", redirectToVideoPortal);

  app.post("/auth/veyra/callback", async (context) => {
    if (!options.videoVeyraBridge || !options.videoSessionCodec) {
      throw new ControlApiError(503, "AUTH_UNAVAILABLE", "Video account sign-in is not configured.", true);
    }
    const form = await context.req.raw.formData().catch(() => undefined);
    const ticket = form?.get("ticket");
    if (typeof ticket !== "string" || ticket.length < 16) throw validationError("The video login ticket is invalid.");
    let identity: VeyraExternalIdentity | undefined;
    try {
      const exchanged = await options.videoVeyraBridge.exchangeVideoTicketAndGetAccount({ ticket });
      if (exchanged.account.status.toLowerCase() !== "active") {
        throw new VeyraIdentityError("AUTH_FORBIDDEN", false, "The shared credit account is not active.");
      }
      identity = exchanged.identity;
    } catch (error) {
      mapVeyraError(error);
    }
    if (!identity) throw new ControlApiError(503, "AUTH_UNAVAILABLE", "The identity service is unavailable.", true);
    setCookie(context, options.videoSessionCodec.cookieName(), options.videoSessionCodec.issue(identity), {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return context.redirect("/projects", 303);
  });

  app.post("/auth/logout", (context) => {
    if (options.videoSessionCodec) deleteCookie(context, options.videoSessionCodec.cookieName(), { path: "/" });
    return response(context, { logged_out: true });
  });

  app.get("/api/v1/health", async (context) =>
    response(context, {
      service: "control-api" as const,
      status: "ok" as const,
      build_version: buildVersion,
      dependencies: {
        database: await store.getDatabaseStatus(),
      },
    }),
  );

  app.get("/api/v1/projects/:project_id/audio-capabilities", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const detail = await assetStore.findProjectDetail(identity.workspaceId, projectId);
    if (!detail) throw notFound("Project not found.");
    const workspaceMusicAssets = await assetStore.listWorkspaceMusicAssets(identity.workspaceId);
    const musicCount = workspaceMusicAssets.length;
    const piperModel = process.env.PIPER_MODEL_PATH;
    const piperConfig = process.env.PIPER_MODEL_CONFIG_PATH;
    // OpenMontage's PiperTTS status is dependency-backed (`cmd:piper`).
    // The Control API cannot inspect a separate Runtime process, so it only
    // reports AVAILABLE when the configured model, sidecar, and the same
    // Runtime venv's launcher are all visible here.  Missing runtime evidence
    // stays NOT_CONFIGURED instead of becoming a static success claim.
    const piperPython = process.env.PIPER_PYTHON_PATH?.trim();
    const piperLauncherReady = Boolean(
      piperPython
      && existsSync(piperPython)
      && [join(dirname(piperPython), "piper.exe"), join(dirname(piperPython), "piper")].some((path) => existsSync(path)),
    );
    const piperReady = Boolean(piperModel && piperConfig && existsSync(piperModel) && existsSync(piperConfig) && piperLauncherReady);
    const ffmpegPath = process.env.MEDIA_RUNTIME_FFMPEG_PATH?.trim();
    const ffprobePath = process.env.MEDIA_RUNTIME_FFPROBE_PATH?.trim();
    const ffmpegReady = Boolean(ffmpegPath && ffprobePath && existsSync(ffmpegPath) && existsSync(ffprobePath));
    const payload = AudioCapabilitiesSchema.parse({
      free_only: audioFreeOnly,
      music_assets: workspaceMusicAssets.map(serializeAsset),
      capabilities: [
        {
          id: "provider_native_audio",
          label: "Provider 原生旁白音轨",
          status: videoProfile.audioOwner === "NATIVE_PROVIDER" ? "AVAILABLE" : "BLOCKED",
          free: true,
          key_required: false,
          reason: videoProfile.audioOwner === "NATIVE_PROVIDER"
            ? "当前视频 profile 声明由 Provider 生成并保留原生音轨；不调用平台 TTS。"
            : "当前视频 profile 未声明可验证的 Provider 原生音轨。",
        },
        { id: "project_music_library", label: "工作区共享音乐库", status: musicCount > 0 ? "AVAILABLE" : "NOT_CONFIGURED", free: true, key_required: false, reason: musicCount > 0 ? `${musicCount} 首已授权音乐可供本工作区所有项目使用。` : "上传已授权音乐后，本工作区所有项目均可使用。" },
        {
          id: "pixabay_music",
          label: "Pixabay 免费音乐",
          status: pixabayMusicEnabled && pixabayMusic ? "AVAILABLE" : "BLOCKED",
          free: true,
          key_required: false,
          reason: !pixabayMusicEnabled
            ? "PIXABAY_MUSIC_ENABLED=false，已禁用外部曲库访问。"
            : !pixabayMusic
              ? "Media Runtime 未配置，无法调用原仓库 Pixabay 适配器。"
              : "按 OpenMontage pixabay_music 逻辑搜索并导入 MP3；无需 API Key，但需要外部网络。",
        },
        { id: "ffmpeg_audio_mixer", label: "FFmpeg 混音与响度处理", status: ffmpegReady ? "AVAILABLE" : "NOT_CONFIGURED", free: true, key_required: false, reason: ffmpegReady ? "受控 Media Runtime 已配置 FFmpeg/ffprobe，本地处理不调用付费服务。" : "需要在受控 Media Runtime 配置 FFmpeg 与 ffprobe 路径。" },
        { id: "piper_tts", label: "Piper 本地中文旁白", status: piperReady ? "AVAILABLE" : "NOT_CONFIGURED", free: true, key_required: false, reason: piperReady ? "受控 Media Runtime 已配置模型、sidecar 与 Piper 启动器，可用于本地旁白资产任务。" : "需要在受控 Media Runtime 配置模型、sidecar 与 Piper 启动器。" },
        {
          id: "faster_whisper",
          label: "faster-whisper 本地转写",
          status: "NOT_CONFIGURED",
          free: true,
          key_required: false,
          reason: "必须由受控 Media Runtime 使用同一解释器完成能力探测；Control API 不凭静态依赖声明为可用。",
        },
        {
          id: "clip_visual_review",
          label: "参考素材视觉分析",
          status: referenceVisionAnalyzer ? "AVAILABLE" : "NOT_CONFIGURED",
          free: true,
          key_required: false,
          reason: referenceVisionAnalyzer
            ? "已配置受控参考素材视觉分析适配器。"
            : "未配置受控参考素材视觉分析适配器。",
        },
        { id: "paid_music_and_tts", label: "付费音乐与云端 TTS", status: audioFreeOnly ? "BLOCKED" : "NOT_CONFIGURED", free: false, key_required: true, reason: audioFreeOnly ? "AUDIO_FREE_ONLY=true，已硬禁用。" : "未配置。" },
      ],
    });
    return response(context, payload);
  });

  app.post("/api/v1/projects/:project_id/audio/pixabay/import", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, PixabayMusicImportCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    const scope = `${identity.userId}:POST:/api/v1/projects/${projectId}/audio/pixabay/import`;
    const imported = await importPixabayMusicAsset({
      workspaceId: identity.workspaceId,
      projectId,
      command,
      scope,
      idempotencyKey,
    });
    return response(context, {
      asset: serializeAsset(imported.asset),
      track: imported.track,
    }, imported.status);
  });

  app.get("/api/v1/me", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const user = await store.findUser(identity.userId);
    if (!user) {
      throw new ControlApiError(503, "AUTH_UNAVAILABLE", "The local development identity is unavailable.", true);
    }
    const workspaces = await store.listWorkspaces(identity.userId);
    return response(context, {
      user: serializeUser(user),
      workspaces: workspaces.map(serializeWorkspace),
    });
  });

  app.get("/api/v1/me/history", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const isAdmin = await resolveVerifiedAdminAccess(identity, options.videoVeyraBridge);
    const projects = await listProjectsForRead(identity, store, isAdmin);
    return response(context, {
      scope: isAdmin ? "ALL_WORKSPACES" as const : "WORKSPACE" as const,
      is_admin: isAdmin,
      projects: projects.map(serializeProject),
    });
  });

  app.get("/api/v1/workspaces", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const workspaces = await store.listWorkspaces(identity.userId);
    return response(context, workspaces.map(serializeWorkspace));
  });

  app.get("/api/v1/projects", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projects = await store.listProjects(identity.workspaceId);
    return response(context, projects.map(serializeProject));
  });

  app.post("/api/v1/projects", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const command = await parseBody(context, CreateProjectCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await store.createProject({
      scope: `${identity.userId}:POST:/api/v1/projects`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId: createPrefixedId("prj"),
      name: command.name,
    });
    if (execution.kind === "CONFLICT") {
      throw idempotencyConflict();
    }
    return response(context, serializeProject(execution.value), execution.status);
  });

  app.get("/api/v1/projects/:project_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    // Administrators receive a read-only cross-workspace view from the
    // trusted Veyra capability.  Resolve the owning workspace first, then
    // keep every detail repository query scoped to that workspace.
    const isAdmin = await resolveVerifiedAdminAccess(identity, options.videoVeyraBridge);
    const project = await findProjectForRead(identity, store, projectId, isAdmin);
    if (!project) throw notFound("Project not found.");
    const projectWorkspaceId = project.workspaceId;
    const detail = await assetStore.findProjectDetail(projectWorkspaceId, projectId);
    if (!detail) throw notFound("Project not found.");
    const taskRuns = await taskStore.listProjectTaskRuns(projectWorkspaceId, projectId);
    const generatedAssets = (await Promise.all(
      taskRuns.flatMap((taskRun) => taskRun.resultAssetId
        ? [taskStore.findTaskRunResultAsset(projectWorkspaceId, taskRun.resultAssetId)]
        : []),
    )).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    const assetIds = new Set(detail.assets.map((asset) => asset.id));
    const [creativeBriefRevisions, storyboardRevisions, productionRuns] = await Promise.all([
      planningStore.listProjectCreativeBriefRevisions(projectWorkspaceId, projectId),
      planningStore.listProjectStoryboardRevisions(projectWorkspaceId, projectId),
      planningStore.listProjectProductionRuns(projectWorkspaceId, projectId),
    ]);
    return response(context, serializeProjectDetail({
      ...detail,
      assets: [...detail.assets, ...generatedAssets.filter((asset) => !assetIds.has(asset.id))],
    }, taskRuns, { creativeBriefRevisions, storyboardRevisions, productionRuns }));
  });

  app.patch("/api/v1/projects/:project_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, UpdateProjectCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await store.updateProject({
      scope: `${identity.userId}:PATCH:/api/v1/projects/${projectId}`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      ...command,
    });
    if (execution.kind === "CONFLICT") {
      throw idempotencyConflict();
    }
    if (execution.kind === "NOT_FOUND") {
      throw new ControlApiError(404, "NOT_FOUND", "Project not found.");
    }
    return response(context, serializeProject(execution.value), execution.status);
  });

  app.delete("/api/v1/projects/:project_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const idempotencyKey = readIdempotencyKey(context);
    const project = await store.findProject(identity.workspaceId, projectId);
    const activeWork = project
      ? await projectHasActiveWork(identity.workspaceId, projectId, taskStore, planningStore)
      : false;
    const execution = await store.deleteProject({
      scope: `${identity.userId}:DELETE:/api/v1/projects/${projectId}`,
      idempotencyKey,
      requestHash: fingerprintRequest({}),
      workspaceId: identity.workspaceId,
      projectId,
      activeWork,
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Project not found.");
    if (execution.kind === "IN_USE") throw projectInUse();
    return response(context, serializeProject(execution.value), execution.status);
  });

  app.post("/api/v1/projects/:project_id/assets/upload-requests", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, CreateUploadRequestCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const assetId = createPrefixedId("ast");
    const execution = await assetStore.createUploadAsset({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/assets/upload-requests`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      assetId,
      kind: command.kind,
      objectKey: createAssetObjectKey({ workspaceId: identity.workspaceId, projectId, assetId, filename: command.filename, mimeType: command.mime_type }),
      filename: command.filename,
      mimeType: command.mime_type,
      byteSize: command.byte_size,
      // The public purpose is a closed command field; the repository stores
      // only this server-derived role and ignores arbitrary metadata.
      ...(command.kind === "AUDIO" && command.purpose ? { audioRole: command.purpose } : {}),
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Project not found.");
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") throw new Error("Unexpected upload command outcome.");

    if (execution.value.status !== "PENDING_UPLOAD") {
      return response(context, { asset_id: execution.value.id, upload_url: null, headers: {}, expires_at: null }, execution.status);
    }
    try {
      const upload = await storage.createUploadUrl({ objectKey: execution.value.objectKey, mimeType: command.mime_type });
      return response(context, { asset_id: execution.value.id, upload_url: upload.uploadUrl, headers: upload.headers, expires_at: upload.expiresAt }, execution.status);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
  });

  app.post("/api/v1/assets/:asset_id/confirm-upload", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const assetId = parseAssetId(context);
    const command = await parseBody(context, ConfirmAssetUploadCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const pendingAsset = await assetStore.findAsset(identity.workspaceId, assetId);
    const analyzeReferenceUpload = async () => {
      if (!pendingAsset
        || pendingAsset.status !== "PENDING_UPLOAD"
        || pendingAsset.kind !== "IMAGE"
        || !referenceImageMimeTypes.has(command.mime_type)) return undefined;
      if (!referenceVisionAnalyzer) return { visualAnalysisStatus: "UNAVAILABLE" as const };
      try {
        const inspection = await storage.inspectObject({ objectKey: pendingAsset.objectKey });
        if (!inspection
          || !requestedMetadataMatches(pendingAsset, { mimeType: command.mime_type, byteSize: command.byte_size })
          || inspection.mimeType !== command.mime_type
          || inspection.byteSize !== command.byte_size
          || inspection.sha256 !== command.sha256) return undefined;
        const object = await storage.readObject({ objectKey: pendingAsset.objectKey });
        if (!object || object.mimeType !== command.mime_type) return { visualAnalysisStatus: "FAILED" as const };
        const visualAnalysis = await referenceVisionAnalyzer.analyze({
          assetId,
          mimeType: command.mime_type as "image/jpeg" | "image/png" | "image/webp",
          bytes: await readReferenceBytes(object.stream, maxReferenceImageBytes),
        });
        return { visualAnalysis, visualAnalysisStatus: "READY" as const };
      } catch (error) {
        return { visualAnalysisStatus: error instanceof ReferenceVisionAnalysisError && error.retryable ? "UNAVAILABLE" as const : "FAILED" as const };
      }
    };
    const visualAnalysis = await analyzeReferenceUpload();
    const execution = await assetStore.confirmAssetUpload({
      scope: `${identity.userId}:POST:/api/v1/assets/${assetId}/confirm-upload`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      assetId,
      sha256: command.sha256,
      mimeType: command.mime_type,
      byteSize: command.byte_size,
      width: command.width,
      height: command.height,
      durationMs: command.duration_ms,
      ...(visualAnalysis ?? {}),
      verifyUpload: async (asset) => {
        let object;
        try {
          object = await storage.inspectObject({ objectKey: asset.objectKey });
        } catch (error) {
          if (error instanceof StorageUnavailableError) throw storageUnavailable();
          throw error;
        }
        return Boolean(
          object
          && requestedMetadataMatches(asset, { mimeType: command.mime_type, byteSize: command.byte_size })
          && object.mimeType === command.mime_type
          && object.byteSize === command.byte_size
          && object.sha256 === command.sha256,
        );
      },
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Asset not found.");
    if (execution.kind === "INVALID_UPLOAD") throw invalidUpload();
    return response(context, serializeAsset(execution.value), execution.status);
  });

  app.get("/api/v1/me/credits", async (context) => {
    if (!options.videoVeyraBridge) throw new ControlApiError(503, "CREDIT_UNAVAILABLE", "Shared credits are not configured.", true);
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    if (!identity.externalUserId) throw new ControlApiError(503, "AUTH_UNAVAILABLE", "The external video account is unavailable.", true);
    let account: CreditAccount | undefined;
    try {
      account = await options.videoVeyraBridge.getAccount({ externalUserId: identity.externalUserId });
    } catch (error) {
      mapVeyraError(error);
    }
    if (!account) throw new ControlApiError(503, "CREDIT_UNAVAILABLE", "The credit service is unavailable.", true);
    return response(context, {
      email: account.email,
      role: normalizeVeyraRole(account.role) ?? "unknown",
      balance: account.balance,
      status: account.status,
      concurrency: account.concurrency,
    });
  });

  app.get("/api/v1/me/billing-policy", async (context) => {
    await resolveWorkspaceAccess(context, identityPort, store);
    const { usagePricingConfigured: hasUsagePricing, billingConfigured: hasConfiguredBilling } = resolveVideoBillingConfig();
    const hasFixedAmount = videoBillingChargeAmount !== "0";
    const enabled = Boolean(options.videoVeyraBridge && hasConfiguredBilling);
    return response(context, {
      enabled,
      mode: !enabled
        ? "DISABLED" as const
        : hasUsagePricing
          ? "USAGE_PLUS_SERVICE_FEE" as const
          : "FIXED_AMOUNT" as const,
      surcharge_multiplier: videoBillingSurchargeMultiplier ?? null,
      fixed_fee: videoBillingFixedFee ?? null,
      charge_amount: hasFixedAmount ? videoBillingChargeAmount : null,
      model_multipliers: videoBillingModelRates,
      source: enabled ? "SERVER_ENVIRONMENT" as const : "DISABLED" as const,
    });
  });

  app.delete("/api/v1/assets/:asset_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const assetId = parseAssetId(context);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await assetStore.deleteAsset({
      scope: `${identity.userId}:DELETE:/api/v1/assets/${assetId}`,
      idempotencyKey,
      requestHash: fingerprintRequest({}),
      workspaceId: identity.workspaceId,
      assetId,
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Asset not found.");
    if (execution.kind === "INVALID_DELETE") {
      throw new ControlApiError(409, "VALIDATION_FAILED", "Only user-uploaded source materials can be removed.");
    }
    if (execution.kind === "ASSET_IN_USE") {
      throw new ControlApiError(409, "ASSET_IN_USE", "This source material is still used by an active task or production plan.");
    }
    return response(context, serializeAsset(execution.value), execution.status);
  });

  app.get("/api/v1/assets/:asset_id/download-url", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const asset = await assetStore.findAsset(identity.workspaceId, parseAssetId(context));
    if (!asset || asset.status !== "READY") throw notFound("Asset not found.");
    try {
      const download = await storage.createDownloadUrl({ objectKey: asset.objectKey });
      return response(context, { download_url: download.downloadUrl, expires_at: download.expiresAt });
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
  });

  app.get("/api/v1/projects/:project_id/documents", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    const conversions = await documentStore.listProjectDocumentConversions(identity.workspaceId, projectId);
    return response(context, await Promise.all(conversions.map(async (conversion) => serializeDocumentConversion(conversion, await documentUnderstandingSummary(conversion)))));
  });

  app.post("/api/v1/projects/:project_id/documents/:source_asset_id/conversions", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const sourceAssetId = parseAssetId(context, "source_asset_id");
    const command = await parseBody(context, CreateDocumentConversionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await documentStore.createDocumentConversion({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/documents/${sourceAssetId}/conversions`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      sourceAssetId,
      documentId: createPrefixedId("doc"),
      conversionId: createPrefixedId("dcv"),
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Project or source document not found.");
      if (execution.kind === "INVALID_SOURCE") throw invalidDocumentSource();
      if (execution.kind === "ACTIVE_CONFLICT") throw documentConversionConflict();
      throw documentConversionStateInvalid();
    }
    return response(context, serializeDocumentConversion(execution.value), execution.status);
  });

  app.get("/api/v1/document-conversions/:conversion_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const conversion = await documentStore.findDocumentConversion(identity.workspaceId, parseDocumentConversionId(context));
    if (!conversion) throw notFound("Document conversion not found.");
    return response(context, serializeDocumentConversion(conversion));
  });

  app.post("/api/v1/document-conversions/:conversion_id/retry", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const conversionId = parseDocumentConversionId(context);
    const command = await parseBody(context, RetryDocumentConversionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await documentStore.retryDocumentConversion({
      scope: `${identity.userId}:POST:/api/v1/document-conversions/${conversionId}/retry`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      conversionId,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Document conversion not found.");
      throw documentConversionStateInvalid();
    }
    return response(context, serializeDocumentConversion(execution.value), execution.status);
  });

  app.get("/api/v1/document-knowledge-revisions/:knowledge_revision_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const knowledgeRevisionId = parseDocumentKnowledgeRevisionId(context);
    const revision = await documentKnowledgeStore.findKnowledgeRevision(identity.workspaceId, knowledgeRevisionId);
    if (!revision) throw notFound("Document understanding revision not found.");
    if (!(await assetStore.findProjectDetail(identity.workspaceId, revision.projectId))) throw notFound("Document understanding revision not found.");
    return response(context, serializeDocumentKnowledgeDetail(
      revision,
      await documentKnowledgeStore.listSections(identity.workspaceId, knowledgeRevisionId),
      await documentKnowledgeStore.listFacts(identity.workspaceId, knowledgeRevisionId),
    ));
  });

  app.post("/api/v1/document-knowledge-revisions/:knowledge_revision_id/retry", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const knowledgeRevisionId = parseDocumentKnowledgeRevisionId(context);
    const revision = await documentKnowledgeStore.findKnowledgeRevision(identity.workspaceId, knowledgeRevisionId);
    if (!revision || !(await assetStore.findProjectDetail(identity.workspaceId, revision.projectId))) throw notFound("Document understanding revision not found.");
    const command = await parseBody(context, RetryDocumentKnowledgeRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await documentKnowledgeStore.retryKnowledgeRevision({
      scope: `${identity.userId}:POST:/api/v1/document-knowledge-revisions/${knowledgeRevisionId}/retry`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId: revision.projectId,
      knowledgeRevisionId,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Document understanding revision not found.");
      if (execution.kind === "ACTIVE_CONFLICT") throw new ControlApiError(409, "DOCUMENT_KNOWLEDGE_ACTIVE_CONFLICT", "This document is already being understood.");
      if (execution.kind === "INVALID_SOURCE") throw new ControlApiError(422, "DOCUMENT_KNOWLEDGE_INVALID", "The source conversion is no longer valid.");
      throw new ControlApiError(422, "DOCUMENT_KNOWLEDGE_NOT_READY", "This document understanding revision cannot be retried yet.");
    }
    return response(context, serializeDocumentKnowledgeRevision(execution.value), execution.status);
  });

  app.post("/api/v1/projects/:project_id/creative-brief-revisions", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, CreateCreativeBriefRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    const execution = await planningStore.createCreativeBriefRevision({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/creative-brief-revisions`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      creativeBriefRevisionId: createPrefixedId("cbr"),
      sourceText: command.source_text,
      targetDurationSeconds: command.target_duration_seconds,
      targetResolution: command.target_resolution,
      stylePreferences: command.style_preferences,
      sourceAssetIds: command.source_asset_ids,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Project not found.");
      if (execution.kind === "INVALID_SOURCE") throw invalidCreativeSource();
      if (execution.kind === "DOCUMENT_CONTEXT_INVALID") throw documentContextInvalid();
      if (execution.kind === "DOCUMENT_KNOWLEDGE_NOT_READY") throw documentKnowledgeNotReady();
      if (execution.kind === "DOCUMENT_FACT_CONTEXT_INVALID") throw documentFactContextInvalid();
      if (execution.kind === "ACTIVE_CONFLICT") throw creativePlanConflict();
      throw creativePlanStateInvalid();
    }
    return response(context, serializeCreativeBriefRevision(execution.value), execution.status);
  });

  app.post("/api/v1/creative-brief-revisions/:creative_brief_revision_id/plan", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const creativeBriefRevisionId = parseCreativeBriefRevisionId(context);
    const command = await parseBody(context, RequestCreativePlanCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const briefForReferenceAnalysis = referenceVisionAnalyzer
      ? await planningStore.findCreativeBriefRevision(identity.workspaceId, creativeBriefRevisionId)
      : undefined;
    if (referenceVisionAnalyzer
      && briefForReferenceAnalysis
      && (briefForReferenceAnalysis.status === "DRAFT" || briefForReferenceAnalysis.status === "FAILED")
      && Array.isArray(briefForReferenceAnalysis.sourceAssetIds)) {
      await analyzeMissingReferenceImages({
        workspaceId: identity.workspaceId,
        projectId: briefForReferenceAnalysis.projectId,
        sourcePrompt: briefForReferenceAnalysis.sourceText,
        sourceAssetIds: briefForReferenceAnalysis.sourceAssetIds,
        assetStore,
        storage,
        analyzer: referenceVisionAnalyzer,
      });
    }
    const execution = await planningStore.requestCreativePlan({
      scope: `${identity.userId}:POST:/api/v1/creative-brief-revisions/${creativeBriefRevisionId}/plan`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      creativeBriefRevisionId,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Creative brief revision not found.");
      if (execution.kind === "ACTIVE_CONFLICT") throw creativePlanConflict();
      throw creativePlanStateInvalid();
    }
    return response(context, serializeCreativeBriefRevision(execution.value), execution.status);
  });

  app.get("/api/v1/projects/:project_id/storyboard-revisions", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    return response(context, (await planningStore.listProjectStoryboardRevisions(identity.workspaceId, projectId)).map(serializeStoryboardRevision));
  });

  app.post("/api/v1/storyboard-revisions/:storyboard_revision_id/approve", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const storyboardRevisionId = parseStoryboardRevisionId(context);
    const command = await parseBody(context, ApproveStoryboardRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await planningStore.approveStoryboardRevision({
      scope: `${identity.userId}:POST:/api/v1/storyboard-revisions/${storyboardRevisionId}/approve`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      storyboardRevisionId,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Storyboard revision not found.");
      throw storyboardStateInvalid();
    }
    return response(context, serializeStoryboardRevision(execution.value), execution.status);
  });

  app.get("/api/v1/projects/:project_id/delivery-plan-revisions", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    const plans = await deliveryPreflightStore.listProjectDeliveryPlanRevisions(identity.workspaceId, projectId);
    return response(context, plans.map(serializeDeliveryPlanRevision));
  });

  app.post("/api/v1/projects/:project_id/delivery-plan-revisions", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, CreateDeliveryPlanRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    const storyboard = await planningStore.findStoryboardRevision(identity.workspaceId, command.storyboard_revision_id);
    const targetDurationSeconds = storyboard?.totalDurationSeconds ?? 15;
    const execution = await deliveryPreflightStore.createDeliveryPlanRevision({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/delivery-plan-revisions`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      deliveryPlanRevisionId: createPrefixedId("dpr"),
      creativeBriefRevisionId: command.creative_brief_revision_id,
      storyboardRevisionId: command.storyboard_revision_id,
      targetDurationSeconds,
      durationPolicy: command.duration_policy,
      flexibleDurationPercent: command.flexible_duration_percent,
      captionPolicy: command.caption_policy,
      lipSyncRequirement: command.lip_sync_requirement,
      voiceMode: command.voice_mode,
      budgetLimit: command.budget_limit,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (!("value" in execution)) {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Project, creative brief, or storyboard revision not found.");
      throw deliveryPlanStateInvalid();
    }
    return response(context, serializeDeliveryPlanRevision(execution.value), execution.status);
  });

  app.post("/api/v1/delivery-plan-revisions/:delivery_plan_revision_id/approve", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const deliveryPlanRevisionId = parseDeliveryPlanRevisionId(context);
    const command = await parseBody(context, ApproveDeliveryPlanRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await deliveryPreflightStore.approveDeliveryPlanRevision({
      scope: `${identity.userId}:POST:/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/approve`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      deliveryPlanRevisionId,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (!("value" in execution)) {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Delivery preflight not found.");
      throw deliveryPlanStateInvalid();
    }
    return response(context, serializeDeliveryPlanRevision(execution.value), execution.status);
  });

  app.get("/api/v1/delivery-plan-revisions/:delivery_plan_revision_id/narration-scripts", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const deliveryPlanRevisionId = parseDeliveryPlanRevisionId(context);
    const deliveryPlan = await deliveryPreflightStore.findDeliveryPlanRevision(identity.workspaceId, deliveryPlanRevisionId);
    if (!deliveryPlan) throw notFound("Delivery plan not found.");
    return response(context, await narrationQualityStore.listNarrationScriptRevisions(identity.workspaceId, deliveryPlanRevisionId));
  });

  app.post("/api/v1/delivery-plan-revisions/:delivery_plan_revision_id/narration-scripts", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const deliveryPlanRevisionId = parseDeliveryPlanRevisionId(context);
    const command = await parseBody(context, CreateNarrationScriptRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await narrationQualityStore.createNarrationScriptRevision({
      scope: `${identity.userId}:POST:/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/narration-scripts`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      deliveryPlanRevisionId,
      command,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (!("value" in execution)) {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Delivery plan not found.");
      throw validationError("Narration script cannot be normalized.");
    }
    return response(context, execution.value, execution.status);
  });

  app.post("/api/v1/narration-script-revisions/:narration_script_revision_id/approve", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const narrationScriptRevisionId = parseNarrationScriptRevisionId(context);
    const command = await parseBody(context, ApproveNarrationScriptRevisionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const script = await narrationQualityStore.findNarrationScriptRevision(identity.workspaceId, narrationScriptRevisionId);
    if (!script) throw notFound("Narration script not found.");
    if (script.status !== "NORMALIZED") {
      throw new ControlApiError(400, "DELIVERY_PLAN_STATE_INVALID", "The narration script cannot be approved from its current state.");
    }
    const sampleAsset = await assetStore.findAsset(identity.workspaceId, command.sample_asset_id);
    const generationMetadata = sampleAsset?.metadata?.narration_generation;
    if (!sampleAsset || sampleAsset.origin !== "GENERATED" || sampleAsset.kind !== "AUDIO" || sampleAsset.status !== "READY"
      || !generationMetadata || typeof generationMetadata !== "object" || Array.isArray(generationMetadata)) {
      throw validationError("A server-generated narration sample is required before approval.");
    }
    const generated = generationMetadata as Record<string, unknown>;
    const provider = typeof generated.provider === "string" ? generated.provider : undefined;
    const voiceId = typeof generated.voice_id === "string" ? generated.voice_id : undefined;
    const providerSettings = NarrationAudioProviderSettingsSchema.safeParse(generated.provider_settings);
    if (!provider || !voiceId || !providerSettings.success || generated.generation_kind !== "SAMPLE" || generated.canonical_script_hash !== command.canonical_script_hash) {
      throw validationError("The narration sample metadata is not a valid server-generated source fact.");
    }
    const execution = await narrationQualityStore.approveNarrationScriptRevision({
      scope: `${identity.userId}:POST:/api/v1/narration-script-revisions/${narrationScriptRevisionId}/approve`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      narrationScriptRevisionId,
      command: {
        ...command,
        sample_provider: provider,
        sample_voice_id: voiceId,
        sample_provider_settings: providerSettings.data,
      },
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (!("value" in execution)) {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Narration script not found.");
      if (execution.kind === "INVALID_SAMPLE") throw validationError("The narration sample or timestamps asset is not ready.");
      throw new ControlApiError(400, "DELIVERY_PLAN_STATE_INVALID", "The narration script cannot be approved from its current state.");
    }
    return response(context, execution.value, execution.status);
  });

  app.post("/api/v1/narration-script-revisions/:narration_script_revision_id/timeline-plans", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const narrationScriptRevisionId = parseNarrationScriptRevisionId(context);
    const command = await parseBody(context, CreateTimelinePlanCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await narrationQualityStore.createTimelinePlan({
      scope: `${identity.userId}:POST:/api/v1/narration-script-revisions/${narrationScriptRevisionId}/timeline-plans`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      narrationScriptRevisionId,
      command,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (!("value" in execution)) {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Narration delivery plan not found.");
      if (execution.kind === "INVALID_TIMELINE") throw validationError("Narration section timings do not match the approved script.");
      throw new ControlApiError(400, "DELIVERY_PLAN_STATE_INVALID", "The narration script must be approved before creating a timeline.");
    }
    return response(context, execution.value, execution.status);
  });

  app.get("/api/v1/projects/:project_id/production-runs", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    if (productionStore) {
      return response(context, (await productionStore.listProjectProductionProgress(identity.workspaceId, projectId)).map(serializeProductionRunProgress));
    }
    return response(context, (await planningStore.listProjectProductionRuns(identity.workspaceId, projectId)).map((productionRun) =>
      serializeProductionRunProgress({ productionRun, segments: [] })));
  });

  app.get("/api/v1/projects/:project_id/video-versions", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    if (!productionStore) return response(context, []);
    return response(context, (await productionStore.listProjectVideoVersions(identity.workspaceId, projectId)).map(serializeVideoVersion));
  });

  app.post("/api/v1/production-runs/:production_run_id/segments/:sequence/retry", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const productionRunId = parseProductionRunId(context);
    const sequence = parseProductionSegmentSequence(context);
    const command = await parseBody(context, RetryProductionSegmentCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    if (!productionStore) throw notFound("Production run not found.");
    const execution = await productionStore.retryProductionSegment({
      scope: `${identity.userId}:POST:/api/v1/production-runs/${productionRunId}/segments/${sequence}/retry`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      productionRunId,
      sequence,
      event: {
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Production run or segment not found.");
    if (execution.kind === "STATE_INVALID") throw productionSegmentStateInvalid();
    return response(context, serializeProductionRunProgress(execution.value), execution.status);
  });

  app.post("/api/v1/production-runs/:production_run_id/composition/retry", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const productionRunId = parseProductionRunId(context);
    const command = await parseBody(context, RetryProductionCompositionCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    if (!productionStore?.retryProductionComposition) throw notFound("Production run not found.");
    const execution = await productionStore.retryProductionComposition({
      scope: `${identity.userId}:POST:/api/v1/production-runs/${productionRunId}/composition/retry`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      productionRunId,
      event: {
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Production run not found.");
    if (execution.kind === "STATE_INVALID") throw productionRunStateInvalid();
    return response(context, serializeProductionRunProgress(execution.value), execution.status);
  });

  app.post("/api/v1/projects/:project_id/production-runs", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, CreateProductionRunCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const projectDetail = await assetStore.findProjectDetail(identity.workspaceId, projectId);
    if (!projectDetail) throw notFound("Project not found.");

    // A brief can remain approved after an earlier vision service outage.  Reuse
    // the existing source-aligned analyzer retry before the scheduler evaluates
    // REFERENCE_SET, so an approved production request can recover that same
    // persisted image analysis without inventing a role or changing the
    // reference contract.  If the analyzer is still unavailable, the existing
    // production gate remains fail-closed and reports its waiting state.
    if (referenceVisionAnalyzer && command.delivery_plan_revision_id) {
      const deliveryPlanForReferenceAnalysis = await deliveryPreflightStore.findDeliveryPlanRevision(
        identity.workspaceId,
        command.delivery_plan_revision_id,
      );
      if (deliveryPlanForReferenceAnalysis?.projectId === projectId && deliveryPlanForReferenceAnalysis.status === "APPROVED") {
        const briefForReferenceAnalysis = await planningStore.findCreativeBriefRevision(
          identity.workspaceId,
          deliveryPlanForReferenceAnalysis.creativeBriefRevisionId,
        );
        if (briefForReferenceAnalysis?.projectId === projectId && briefForReferenceAnalysis.sourceAssetIds.length > 0) {
          await analyzeMissingReferenceImages({
            workspaceId: identity.workspaceId,
            projectId,
            sourcePrompt: briefForReferenceAnalysis.sourceText,
            sourceAssetIds: briefForReferenceAnalysis.sourceAssetIds,
            assetStore,
            storage,
            analyzer: referenceVisionAnalyzer,
          });
        }
      }
    }

    // Platform narration remains approval-gated for explicit speech.  A
    // source-backed native provider owner is the one exception: its generated
    // MP4 already owns the audible track and must not wait for a platform
    // narration TimelinePlan or trigger a second TTS path.
    if (videoProfile.audioOwner !== "NATIVE_PROVIDER"
      && command.delivery_plan_revision_id
      && narrationQualityStore.hasReadyTimelinePlan) {
      const deliveryPlan = await deliveryPreflightStore.findDeliveryPlanRevision(identity.workspaceId, command.delivery_plan_revision_id);
      if (deliveryPlan?.projectId === projectId && deliveryPlan.status === "APPROVED") {
        const brief = await planningStore.findCreativeBriefRevision(identity.workspaceId, deliveryPlan.creativeBriefRevisionId);
        if (brief && deriveTranscriptScript(brief.sourceText)
          && !(await narrationQualityStore.hasReadyTimelinePlan(identity.workspaceId, projectId, command.delivery_plan_revision_id))) {
          throw narrationApprovalRequired();
        }
      }
    }

    // Freeze the same account/rule fact used by direct shot generation before
    // the production run is persisted.  The existing worker settles it only
    // after each validated artifact; this is a preflight, never a debit.
    const billing = await createFrozenVideoBilling(identity);

    // AUTO is local-first.  Only when the same source-aligned candidate
    // predicate finds no usable workspace MUSIC asset do we perform one
    // server-side Pixabay import before creating the production run.  The
    // public command shape stays unchanged; MANUAL and OFF never enter this
    // branch.
    if (command.music_plan.mode === "AUTO") {
      const existingMusic = (await assetStore.listWorkspaceMusicAssets(identity.workspaceId)).filter(isUsableMusicAsset);
      if (existingMusic.length === 0) {
        if (!pixabayMusicEnabled || !pixabayMusic) {
          throw new ControlApiError(503, "PROVIDER_UNAVAILABLE", "AUTO music needs a configured Pixabay Music capability when the workspace catalog is empty.", true);
        }
        const deliveryPlan = await deliveryPreflightStore.findDeliveryPlanRevision(identity.workspaceId, command.delivery_plan_revision_id);
        if (!deliveryPlan || deliveryPlan.projectId !== projectId) throw notFound("Delivery plan not found.");
        if (deliveryPlan.status !== "APPROVED") throw deliveryPreflightBlocked();
        const brief = await planningStore.findCreativeBriefRevision(identity.workspaceId, deliveryPlan.creativeBriefRevisionId);
        const storyboard = await planningStore.findStoryboardRevision(identity.workspaceId, command.storyboard_revision_id);
        if (!storyboard || storyboard.projectId !== projectId || storyboard.id !== deliveryPlan.storyboardRevisionId) {
          throw notFound("Storyboard revision not found.");
        }
        const query = firstValidPixabayQuery([
          command.music_plan.style_hint,
          brief?.stylePreferences,
          projectDetail.project.name,
        ]);
        if (!query) throw validationError("AUTO music needs a non-empty style hint, creative preference, or project name before Pixabay can be searched.");
        const sourceCommand = PixabayMusicImportCommandSchema.safeParse({
          query,
          min_duration: deliveryPlan.targetDurationSeconds ?? storyboard.totalDurationSeconds,
          max_duration: 300,
        });
        if (!sourceCommand.success) throw validationError("AUTO music search parameters are invalid.");
        const productionScope = `${identity.userId}:POST:/api/v1/projects/${projectId}/production-runs`;
        const fallbackFingerprint = `${productionScope}:${idempotencyKey}:${fingerprintRequest(sourceCommand.data)}`;
        const fallbackKey = `auto-${createHash("sha256").update(fallbackFingerprint).digest("hex")}`;
        await importPixabayMusicAsset({
          workspaceId: identity.workspaceId,
          projectId,
          command: sourceCommand.data,
          scope: `${productionScope}:pixabay-import`,
          idempotencyKey: fallbackKey,
        });
        const importedMusic = (await assetStore.listWorkspaceMusicAssets(identity.workspaceId)).filter(isUsableMusicAsset);
        if (importedMusic.length === 0) {
          throw new ControlApiError(503, "PROVIDER_PROTOCOL_INVALID", "Pixabay did not produce a usable MUSIC asset.", false);
        }
      }
    }
    const execution = await planningStore.createProductionRun({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/production-runs`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      productionRunId: createPrefixedId("prd"),
      storyboardRevisionId: command.storyboard_revision_id,
      deliveryPlanRevisionId: command.delivery_plan_revision_id,
      musicPlan: command.music_plan,
      ...(billing ? { billing } : {}),
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind !== "NEW" && execution.kind !== "REPLAY") {
      if (execution.kind === "CONFLICT") throw idempotencyConflict();
      if (execution.kind === "NOT_FOUND") throw notFound("Project or storyboard revision not found.");
      if (execution.kind === "ACTIVE_CONFLICT") throw productionRunConflict();
      if (execution.kind === "PREFLIGHT_BLOCKED") throw deliveryPreflightBlocked();
      throw productionRunStateInvalid();
    }
    return response(context, serializeProductionRun(execution.value), execution.status);
  });

  app.post("/api/v1/projects/:project_id/shots", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, CreateShotCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await assetStore.createShot({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/shots`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      shotId: createPrefixedId("sht"),
      position: command.position,
      prompt: command.prompt,
      model: command.model ?? null,
      generationSettings: command.generation_settings,
      referenceBindings: command.reference_bindings.map((binding) => ({ assetId: binding.asset_id, role: binding.role, position: binding.position })),
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Project not found.");
    if (execution.kind === "INVALID_REFERENCE") throw invalidReference();
    if (execution.kind === "POSITION_CONFLICT") throw shotPositionConflict();
    return response(context, serializeShot(execution.value), execution.status);
  });

  app.patch("/api/v1/shots/:shot_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const shotId = parseShotId(context);
    const command = await parseBody(context, UpdateShotCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await assetStore.updateShot({
      scope: `${identity.userId}:PATCH:/api/v1/shots/${shotId}`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      shotId,
      ...(command.position === undefined ? {} : { position: command.position }),
      ...(command.prompt === undefined ? {} : { prompt: command.prompt }),
      ...(command.model === undefined ? {} : { model: command.model }),
      ...(command.generation_settings === undefined ? {} : { generationSettings: command.generation_settings }),
      ...(command.status === undefined ? {} : { status: command.status }),
      ...(command.selected_asset_id === undefined ? {} : { selectedAssetId: command.selected_asset_id }),
      ...(command.reference_bindings === undefined ? {} : { referenceBindings: command.reference_bindings.map((binding) => ({ assetId: binding.asset_id, role: binding.role, position: binding.position })) }),
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Shot not found.");
    if (execution.kind === "INVALID_REFERENCE") throw invalidReference();
    if (execution.kind === "POSITION_CONFLICT") throw shotPositionConflict();
    return response(context, serializeShot(execution.value), execution.status);
  });

  app.post("/api/v1/shots/:shot_id/generations", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const shotId = parseShotId(context);
    const command = await parseBody(context, CreateTaskRunCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const shot = await assetStore.findShot(identity.workspaceId, shotId);
    if (!shot) throw notFound("Shot not found.");
    const detail = await assetStore.findProjectDetail(identity.workspaceId, shot.projectId);
    if (!detail) throw notFound("Project not found.");
    const bindings = detail.referenceBindings
      .filter((binding) => binding.shotId === shot.id)
      .sort((left, right) => left.position - right.position || left.assetId.localeCompare(right.assetId));
    const references = await Promise.all(bindings.map(async (binding) => ({ binding, asset: await assetStore.findAsset(identity.workspaceId, binding.assetId) })));
    if (references.some(({ asset }) => !asset
      || asset.projectId !== shot.projectId
      || asset.status !== "READY"
      || asset.kind !== "IMAGE"
      || !asset.sha256
      || !asset.mimeType
      || !referenceImageMimeTypes.has(asset.mimeType)
      || !asset.byteSize
      || asset.byteSize > maxReferenceImageBytes)) {
      throw invalidReference();
    }
    const hasFirstFrame = bindings.some((binding) => binding.role === "FIRST_FRAME");
    const hasUnsupportedRole = bindings.some((binding) => binding.role === "LAST_FRAME");
    if (hasUnsupportedRole || (hasFirstFrame && bindings.length !== 1)) {
      throw validationError("Choose either one opening image or one to seven reference images.");
    }
    if (!hasFirstFrame && bindings.some((binding) => binding.role !== "STYLE" && binding.role !== "SUBJECT")) {
      throw validationError("The saved reference images do not form a supported video input.");
    }
    const promptReferenceRoles = inferVisualReferenceRoles({
      sourcePrompt: shot.prompt,
      count: bindings.length,
      sourceImageNames: references.map(({ asset }) => typeof asset?.metadata?.filename === "string" ? asset.metadata.filename : undefined),
    });
    const resolvedReferenceRoles = inferVisualReferenceRoles({
      sourcePrompt: shot.prompt,
      count: bindings.length,
      sourceImageNames: references.map(({ asset }) => typeof asset?.metadata?.filename === "string" ? asset.metadata.filename : undefined),
      visionAnalyses: references.map(({ asset }) => parseVisualReferenceAnalysis(asset?.metadata.visual_analysis)),
    });
    const referenceLockPolicies = inferVisualReferenceLockPolicies({
      sourcePrompt: shot.prompt,
      roles: resolvedReferenceRoles,
      sourceImageNames: references.map(({ asset }) => typeof asset?.metadata?.filename === "string" ? asset.metadata.filename : undefined),
    });
    const resolvedReferenceInputs = references.map(({ binding, asset }, index) => ({
      binding,
      asset,
      role: inferVisualReferenceRole({
        bindingRole: binding.role,
        promptRole: promptReferenceRoles[index],
      }) ?? (binding.role === "SUBJECT" ? "SUBJECT" : resolvedReferenceRoles[index]),
    }));
    // A generic STYLE binding is only a selection mode, not a semantic claim.
    // Do not turn an unresolved image into STYLE by upload order: the user must
    // name its role or the server must have a sufficiently confident analysis.
    if (!hasFirstFrame && resolvedReferenceInputs.some(({ role }) => role === undefined)) {
      throw invalidReference();
    }
    const visualInput = bindings.length === 0
      ? { mode: "TEXT" as const, references: [] as [] }
      : hasFirstFrame
        ? {
            mode: "FIRST_FRAME" as const,
            references: references.map(({ binding, asset }) => ({
              asset_id: binding.assetId,
              sha256: asset!.sha256!,
              mime_type: asset!.mimeType! as "image/jpeg" | "image/png" | "image/webp",
              position: 0,
              role: "HANDOFF" as const,
            })) as [{ asset_id: string; sha256: string; mime_type: "image/jpeg" | "image/png" | "image/webp"; position: number; role: "HANDOFF" }],
          }
        : {
            mode: "REFERENCE_SET" as const,
            references: resolvedReferenceInputs.map(({ binding, asset, role }) => ({
              asset_id: binding.assetId,
              sha256: asset!.sha256!,
              mime_type: asset!.mimeType! as "image/jpeg" | "image/png" | "image/webp",
              position: binding.position,
              role: role!,
            })),
          };
    if (videoProfile.mode === "sub2api" && visualInput.mode !== "TEXT" && !referenceDeliveryTokenCodec) {
      throw validationError("Reference image delivery is not configured for the real video provider.");
    }
    let inputSnapshot;
    try {
      const compiledPrompt = compileVideoPrompt({
        sourcePrompt: shot.prompt,
        generationSettings: shot.generationSettings,
        profile: videoProfile,
        referenceRoles: visualInput.mode === "REFERENCE_SET"
          ? visualInput.references.map((reference) => reference.role ?? "STYLE")
          : [],
        visualObjectLocks: references.flatMap(({ asset }, index) => referenceLockPolicies[index] === "LOCK_OBJECTS"
          ? parseVisualReferenceAnalysis(asset?.metadata.visual_analysis)?.objects ?? []
          : []),
      });
      inputSnapshot = createRuntimeVideoInputSnapshot({
        prompt: compiledPrompt.prompt,
        visualInput,
        profile: videoProfile,
        promptMaxUtf8Bytes: videoPromptMaxUtf8Bytes,
        sourcePrompt: compiledPrompt.sourcePrompt,
        generatedPromptParts: compiledPrompt.generatedPromptParts,
        settings: compiledPrompt.settings,
      });
      // A global surcharge is the product policy for every provider. The
      // legacy model map remains a fallback for older snapshots or an
      // explicitly model-specific override when no global value is set.
      const billing = await createFrozenVideoBilling(identity);
      if (billing) {
        inputSnapshot = {
          ...inputSnapshot,
          billing,
        };
      }
    } catch (error) {
      if (error instanceof UnsupportedVideoGenerationInputError || error instanceof VideoPromptCompilationError) {
        throw validationError(error.message);
      }
      throw error;
    }
    const execution = await taskStore.createTaskRun({
      scope: `${identity.userId}:POST:/api/v1/shots/${shotId}/generations`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      taskRunId: createPrefixedId("tsk"),
      shotId,
      kind: "VIDEO_GENERATION",
      inputSnapshot,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Shot not found.");
    if (execution.kind === "INVALID_REFERENCE") throw invalidReference();
    if (execution.kind === "ACTIVE_CONFLICT") throw taskRunActiveConflict();
    if (execution.kind === "STATE_INVALID") throw taskStateInvalid();
    return response(context, serializeTaskRun(execution.value), execution.status);
  });

  app.get("/api/v1/task-runs/:task_run_id", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const taskRun = await taskStore.findTaskRun(identity.workspaceId, parseTaskRunId(context));
    if (!taskRun) throw notFound("Task run not found.");
    const [attempts, resultAsset] = await Promise.all([
      taskStore.listTaskRunAttempts(identity.workspaceId, taskRun.id),
      taskRun.resultAssetId ? taskStore.findTaskRunResultAsset(identity.workspaceId, taskRun.resultAssetId) : Promise.resolve(undefined),
    ]);
    return response(context, {
      task_run: serializeTaskRun(taskRun),
      attempts: attempts.map(serializeTaskRunAttempt),
      result_asset: resultAsset ? serializeAsset(resultAsset) : null,
    });
  });

  app.post("/api/v1/task-runs/:task_run_id/retry", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const taskRunId = parseTaskRunId(context);
    const command = await parseBody(context, RetryTaskRunCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    const execution = await taskStore.retryTaskRun({
      scope: `${identity.userId}:POST:/api/v1/task-runs/${taskRunId}/retry`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      taskRunId,
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    if (execution.kind === "CONFLICT") throw idempotencyConflict();
    if (execution.kind === "NOT_FOUND") throw notFound("Task run not found.");
    if (execution.kind === "STATE_INVALID") throw taskStateInvalid();
    if (execution.kind === "INVALID_REFERENCE") throw invalidReference();
    if (execution.kind === "ACTIVE_CONFLICT") throw taskRunActiveConflict();
    return response(context, serializeTaskRun(execution.value), execution.status);
  });

  app.get("/api/v1/events", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const workspaceId = parseWorkspaceId(context);
    if (workspaceId !== identity.workspaceId) {
      throw new ControlApiError(403, "WORKSPACE_FORBIDDEN", "The current identity cannot access this workspace.");
    }
    const afterEventId = readLastEventId(context);
    const encoder = new TextEncoder();
    let stopStream: () => void = () => undefined;
    const requestId = context.req.header("X-Request-ID") ?? "sse";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let cursor = afterEventId;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastHeartbeatAt = 0;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          context.req.raw.signal.removeEventListener("abort", close);
        };
        const close = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // The fetch runtime may already close a stream during reader cancellation.
          }
        };
        stopStream = cleanup;
        context.req.raw.signal.addEventListener("abort", close, { once: true });
        const poll = async () => {
          if (closed) return;
          try {
            const events = await taskStore.listWorkspaceEvents({ workspaceId, afterEventId: cursor, limit: 100 });
            for (const event of events) {
              cursor = event.event_id;
              const publicEvent = projectPublicWorkspaceEvent(event);
              if (!publicEvent) continue;
              controller.enqueue(encoder.encode(`id: ${publicEvent.event_id}\nevent: ${publicEvent.event_type}\ndata: ${JSON.stringify(publicEvent)}\n\n`));
            }
            const now = Date.now();
            if (events.length === 0 && now - lastHeartbeatAt >= 15_000) {
              lastHeartbeatAt = now;
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }
            timer = setTimeout(() => void poll(), 250);
          } catch (error) {
            console.error(JSON.stringify({ event: "sse.read.failed", request_id: requestId, reason: error instanceof Error ? error.message : String(error) }));
            close();
          }
        };
        void poll();
      },
      cancel() {
        stopStream();
        stopStream = () => undefined;
      },
    });
    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  });

  return app;
}

export const app = createApp();
