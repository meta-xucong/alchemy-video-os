import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  AssetIdSchema,
  ConfirmAssetUploadCommandSchema,
  CreateShotCommandSchema,
  CreateUploadRequestCommandSchema,
  CreateProjectCommandSchema,
  IdempotencyKeySchema,
  ProjectIdSchema,
  ShotIdSchema,
  UpdateProjectCommandSchema,
  UpdateShotCommandSchema,
} from "@alchemy-video/contracts";
import { fingerprintRequest } from "@alchemy-video/domain";
import type { AssetWorkspaceStore, ControlPlaneStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort, StorageUnavailableError, createAssetObjectKey, type StoragePort } from "@alchemy-video/storage-client";
import type { z } from "zod";

import { ControlApiError, validationError } from "./errors.js";
import { DevIdentityAdapter, DEV_IDENTITY_SEED, type CurrentIdentity, type IdentityPort } from "./identity.js";
import { createPrefixedId } from "./ids.js";
import { errorHandler, requestLogger } from "./middleware/logger.js";
import { createInMemoryControlPlaneStore } from "./repository.js";
import { createInMemoryAssetWorkspaceStore } from "./asset-repository.js";
import { serializeAsset, serializeProject, serializeProjectDetail, serializeShot, serializeUser, serializeWorkspace } from "./serializers.js";

type CreateAppOptions = {
  identity?: IdentityPort;
  store?: ControlPlaneStore;
  assetStore?: AssetWorkspaceStore;
  storage?: StoragePort;
  buildVersion?: string;
};

const response = <T>(context: HonoContext, data: T, status: 200 | 201 = 200) =>
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

const parseAssetId = (context: HonoContext) => {
  const parsed = AssetIdSchema.safeParse(context.req.param("asset_id"));
  if (!parsed.success) throw validationError("asset_id is invalid.");
  return parsed.data;
};

const parseShotId = (context: HonoContext) => {
  const parsed = ShotIdSchema.safeParse(context.req.param("shot_id"));
  if (!parsed.success) throw validationError("shot_id is invalid.");
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
  await store.ensureDevIdentity(DEV_IDENTITY_SEED);

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
const storageUnavailable = () => new ControlApiError(503, "STORAGE_UNAVAILABLE", "Object storage is unavailable.", true);
const invalidUpload = () => new ControlApiError(400, "DOWNLOAD_INVALID", "Uploaded object metadata does not match the confirmed asset.");
const shotPositionConflict = () => new ControlApiError(409, "SHOT_POSITION_CONFLICT", "Another shot already uses this project position.");

const requestedMetadataMatches = (asset: { metadata: Record<string, unknown> }, input: { mimeType: string; byteSize: number }) =>
  asset.metadata.requested_mime_type === input.mimeType && asset.metadata.requested_byte_size === input.byteSize;

export function createApp(options: CreateAppOptions = {}) {
  const identityPort = options.identity ?? new DevIdentityAdapter();
  const store = options.store ?? createInMemoryControlPlaneStore();
  const assetStore = options.assetStore ?? createInMemoryAssetWorkspaceStore(store);
  const storage = options.storage ?? new InMemoryStoragePort();
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
    const detail = await assetStore.findProjectDetail(identity.workspaceId, parseProjectId(context));
    if (!detail) throw notFound("Project not found.");
    return response(context, serializeProjectDetail(detail));
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

  return app;
}

export const app = createApp();
