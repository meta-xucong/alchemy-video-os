import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  AssetIdSchema,
  ApproveStoryboardRevisionCommandSchema,
  ConfirmAssetUploadCommandSchema,
  CreateCreativeBriefRevisionCommandSchema,
  CreateDocumentConversionCommandSchema,
  CreateProductionRunCommandSchema,
  CreateShotCommandSchema,
  CreateTaskRunCommandSchema,
  CreateUploadRequestCommandSchema,
  CreativeBriefRevisionIdSchema,
  CreateProjectCommandSchema,
  EventIdSchema,
  DocumentConversionIdSchema,
  IdempotencyKeySchema,
  ProjectIdSchema,
  ProductionRunIdSchema,
  ShotIdSchema,
  TaskRunIdSchema,
  RetryTaskRunCommandSchema,
  RetryProductionSegmentCommandSchema,
  RetryDocumentConversionCommandSchema,
  RequestCreativePlanCommandSchema,
  StoryboardRevisionIdSchema,
  UpdateProjectCommandSchema,
  UpdateShotCommandSchema,
  WorkspaceIdSchema,
  projectPublicWorkspaceEvent,
} from "@alchemy-video/contracts";
import { fingerprintRequest } from "@alchemy-video/domain";
import {
  UnsupportedVideoGenerationInputError,
  VideoPromptCompilationError,
  compileVideoPrompt,
  createRuntimeVideoInputSnapshot,
  resolveVideoProviderRuntimeProfile,
  type VideoProviderRuntimeMode,
} from "@alchemy-video/provider-video";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";
import { InMemoryCreativePlanningStore, InMemoryDocumentConversionStore, type AssetWorkspaceStore, type ControlPlaneStore, type CreativePlanningStore, type DocumentConversionStore, type ProductionStore, type TaskRunStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort, StorageUnavailableError, createAssetObjectKey, type StoragePort } from "@alchemy-video/storage-client";
import type { z } from "zod";

import { ControlApiError, validationError } from "./errors.js";
import { DevIdentityAdapter, DEV_IDENTITY_SEED, type CurrentIdentity, type IdentityPort } from "./identity.js";
import { createPrefixedId } from "./ids.js";
import { errorHandler, requestLogger } from "./middleware/logger.js";
import { createInMemoryControlPlaneStore } from "./repository.js";
import { createInMemoryAssetWorkspaceStore } from "./asset-repository.js";
import { createInMemoryTaskRunStore } from "./task-run-repository.js";
import { serializeAsset, serializeCreativeBriefRevision, serializeDocumentConversion, serializeProductionRun, serializeProductionRunProgress, serializeProject, serializeProjectDetail, serializeShot, serializeStoryboardRevision, serializeTaskRun, serializeTaskRunAttempt, serializeUser, serializeVideoVersion, serializeWorkspace } from "./serializers.js";

type CreateAppOptions = {
  identity?: IdentityPort;
  store?: ControlPlaneStore;
  assetStore?: AssetWorkspaceStore;
  taskStore?: TaskRunStore;
  documentStore?: DocumentConversionStore;
  planningStore?: CreativePlanningStore;
  productionStore?: Pick<ProductionStore, "listProjectProductionProgress" | "listProjectVideoVersions" | "retryProductionSegment">;
  storage?: StoragePort;
  buildVersion?: string;
  videoProviderMode?: VideoProviderRuntimeMode;
  referenceDeliveryTokenCodec?: ReferenceDeliveryTokenCodec;
};

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
  const identity = await identityPort.resolve(context.req.raw);
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

const idempotencyConflict = () =>
  new ControlApiError(
    409,
    "IDEMPOTENCY_CONFLICT",
    "The idempotency key was already used for a different command.",
  );

const notFound = (message: string) => new ControlApiError(404, "NOT_FOUND", message);
const invalidReference = () => new ControlApiError(400, "VALIDATION_FAILED", "Reference assets must be READY assets in the same project.");
const invalidCreativeSource = () => new ControlApiError(400, "VALIDATION_FAILED", "Creative source materials must be READY assets in the same project.");
const storageUnavailable = () => new ControlApiError(503, "STORAGE_UNAVAILABLE", "Object storage is unavailable.", true);
const invalidUpload = () => new ControlApiError(400, "DOWNLOAD_INVALID", "Uploaded object metadata does not match the confirmed asset.");
const shotPositionConflict = () => new ControlApiError(409, "SHOT_POSITION_CONFLICT", "Another shot already uses this project position.");
const taskRunActiveConflict = () => new ControlApiError(409, "TASK_RUN_ACTIVE_CONFLICT", "The shot already has an active task run.");
const taskStateInvalid = () => new ControlApiError(400, "TASK_STATE_INVALID", "The task run cannot be retried from its current state.");
const invalidDocumentSource = () => new ControlApiError(400, "DOCUMENT_UNSUPPORTED", "The selected project material cannot be converted.");
const documentConversionConflict = () => new ControlApiError(409, "DOCUMENT_CONVERSION_ACTIVE_CONFLICT", "This project material is already being organized.");
const documentConversionStateInvalid = () => new ControlApiError(400, "DOCUMENT_CONVERSION_FAILED", "This project material cannot be organized from its current state.");
const creativePlanConflict = () => new ControlApiError(409, "CREATIVE_PLAN_ACTIVE_CONFLICT", "This creative brief is already being planned.");
const creativePlanStateInvalid = () => new ControlApiError(400, "CREATIVE_PLAN_STATE_INVALID", "This creative brief cannot be planned from its current state.");
const storyboardStateInvalid = () => new ControlApiError(400, "STORYBOARD_SPEC_INVALID", "This storyboard cannot be approved from its current state.");
const productionRunConflict = () => new ControlApiError(409, "PRODUCTION_RUN_ACTIVE_CONFLICT", "This project already has an active production plan.");
const productionRunStateInvalid = () => new ControlApiError(400, "PRODUCTION_RUN_STATE_INVALID", "This storyboard must be approved before creating a production plan.");
const productionSegmentStateInvalid = () => new ControlApiError(400, "PRODUCTION_SEGMENT_STATE_INVALID", "This production segment cannot be retried from its current state.");

const requestedMetadataMatches = (asset: { metadata: Record<string, unknown> }, input: { mimeType: string; byteSize: number }) =>
  asset.metadata.requested_mime_type === input.mimeType && asset.metadata.requested_byte_size === input.byteSize;

const referenceImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxReferenceImageBytes = 8 * 1024 * 1024;

export function createApp(options: CreateAppOptions = {}) {
  const identityPort = options.identity ?? new DevIdentityAdapter();
  const store = options.store ?? createInMemoryControlPlaneStore();
  const assetStore = options.assetStore ?? createInMemoryAssetWorkspaceStore(store);
  const taskStore = options.taskStore ?? createInMemoryTaskRunStore(assetStore);
  const documentStore = options.documentStore ?? new InMemoryDocumentConversionStore(assetStore);
  const planningStore = options.planningStore ?? new InMemoryCreativePlanningStore(assetStore);
  const productionStore = options.productionStore;
  const storage = options.storage ?? new InMemoryStoragePort();
  const videoProfile = resolveVideoProviderRuntimeProfile(options.videoProviderMode ?? "mock");
  const referenceDeliveryTokenCodec = options.referenceDeliveryTokenCodec;
  const buildVersion = options.buildVersion ?? process.env.BUILD_VERSION ?? "local";
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: ["http://localhost:3031", "http://127.0.0.1:3031"],
      credentials: true
    })
  );
  app.use("*", requestLogger);
  app.onError(errorHandler);

  const providerInputResponse = async (context: HonoContext, includeBody: boolean) => {
    const token = context.req.param("token") ?? "";
    const claim = referenceDeliveryTokenCodec?.verify(token);
    if (!claim) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
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
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    try {
      if (!includeBody) {
        const object = await storage.inspectObject({ objectKey: asset.objectKey });
        if (!object || object.mimeType !== claim.mimeType || object.sha256 !== claim.sha256 || object.byteSize !== asset.byteSize) {
          return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
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
        return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
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
        return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
  };

  app.get("/provider-input/:token", (context) => providerInputResponse(context, true));
  app.on("HEAD", "/provider-input/:token", (context) => providerInputResponse(context, false));

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
    const detail = await assetStore.findProjectDetail(identity.workspaceId, projectId);
    if (!detail) throw notFound("Project not found.");
    const taskRuns = await taskStore.listProjectTaskRuns(identity.workspaceId, projectId);
    const generatedAssets = (await Promise.all(
      taskRuns.flatMap((taskRun) => taskRun.resultAssetId
        ? [taskStore.findTaskRunResultAsset(identity.workspaceId, taskRun.resultAssetId)]
        : []),
    )).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    const assetIds = new Set(detail.assets.map((asset) => asset.id));
    const [creativeBriefRevisions, storyboardRevisions, productionRuns] = await Promise.all([
      planningStore.listProjectCreativeBriefRevisions(identity.workspaceId, projectId),
      planningStore.listProjectStoryboardRevisions(identity.workspaceId, projectId),
      planningStore.listProjectProductionRuns(identity.workspaceId, projectId),
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
    return response(context, conversions.map(serializeDocumentConversion));
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

  app.post("/api/v1/projects/:project_id/production-runs", async (context) => {
    const identity = await resolveWorkspaceAccess(context, identityPort, store);
    const projectId = parseProjectId(context);
    const command = await parseBody(context, CreateProductionRunCommandSchema);
    const idempotencyKey = readIdempotencyKey(context);
    if (!(await assetStore.findProjectDetail(identity.workspaceId, projectId))) throw notFound("Project not found.");
    const execution = await planningStore.createProductionRun({
      scope: `${identity.userId}:POST:/api/v1/projects/${projectId}/production-runs`,
      idempotencyKey,
      requestHash: fingerprintRequest(command),
      workspaceId: identity.workspaceId,
      projectId,
      productionRunId: createPrefixedId("prd"),
      storyboardRevisionId: command.storyboard_revision_id,
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
            })) as [{ asset_id: string; sha256: string; mime_type: "image/jpeg" | "image/png" | "image/webp"; position: number }],
          }
        : {
            mode: "REFERENCE_SET" as const,
            references: references.map(({ binding, asset }) => ({
              asset_id: binding.assetId,
              sha256: asset!.sha256!,
              mime_type: asset!.mimeType! as "image/jpeg" | "image/png" | "image/webp",
              position: binding.position,
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
      });
      inputSnapshot = createRuntimeVideoInputSnapshot({
        prompt: compiledPrompt.prompt,
        visualInput,
        profile: videoProfile,
        settings: compiledPrompt.settings,
      });
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
