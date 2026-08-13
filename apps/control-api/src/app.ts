import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  CreateProjectCommandSchema,
  IdempotencyKeySchema,
  ProjectIdSchema,
  UpdateProjectCommandSchema,
} from "@alchemy-video/contracts";
import { fingerprintRequest } from "@alchemy-video/domain";
import type { ControlPlaneStore } from "@alchemy-video/persistence";
import type { z } from "zod";

import { ControlApiError, validationError } from "./errors.js";
import { DevIdentityAdapter, DEV_IDENTITY_SEED, type CurrentIdentity, type IdentityPort } from "./identity.js";
import { createPrefixedId } from "./ids.js";
import { errorHandler, requestLogger } from "./middleware/logger.js";
import { createInMemoryControlPlaneStore } from "./repository.js";
import { serializeProject, serializeUser, serializeWorkspace } from "./serializers.js";

type CreateAppOptions = {
  identity?: IdentityPort;
  store?: ControlPlaneStore;
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

export function createApp(options: CreateAppOptions = {}) {
  const identityPort = options.identity ?? new DevIdentityAdapter();
  const store = options.store ?? createInMemoryControlPlaneStore();
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
    const project = await store.findProject(identity.workspaceId, parseProjectId(context));
    if (!project) {
      throw new ControlApiError(404, "NOT_FOUND", "Project not found.");
    }
    return response(context, { project: serializeProject(project), shots: [], assets: [] });
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

  return app;
}

export const app = createApp();
