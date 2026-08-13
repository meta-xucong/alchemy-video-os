import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { ApiErrorSchema, ApiFailureEnvelopeSchema, successEnvelope } from "./errors.js";
import { InternalEventEnvelopeSchema, InternalTaskRunQueueMessageSchema, PublicWorkspaceEventEnvelopeSchema } from "./events.js";
import {
  AssetSchema,
  AssetDownloadUrlSchema,
  ConfirmAssetUploadCommandSchema,
  CreateProjectCommandSchema,
  CreateShotCommandSchema,
  CreateTaskRunCommandSchema,
  CreateUploadRequestCommandSchema,
  CurrentIdentitySchema,
  HealthSchema,
  ProjectDetailSchema,
  ProjectSchema,
  RetryTaskRunCommandSchema,
  ShotSchema,
  ReferenceBindingInputSchema,
  ReferenceBindingSchema,
  TaskRunSchema,
  TaskRunDetailSchema,
  UploadRequestSchema,
  UpdateProjectCommandSchema,
  UpdateShotCommandSchema,
  WorkspaceSchema,
  TaskRunAttemptSchema,
} from "./resources.js";

type JsonSchema = Record<string, unknown>;

const toSchema = (
  name: string,
  schema: Parameters<typeof zodToJsonSchema>[0],
  target: "openApi3" | "jsonSchema7",
): JsonSchema => {
  const document = zodToJsonSchema(schema, { name, target }) as JsonSchema & {
    definitions?: Record<string, JsonSchema>;
  };
  return document.definitions?.[name] ?? document;
};

export const publicContractSchemas = {
  ApiError: ApiErrorSchema,
  ApiFailure: ApiFailureEnvelopeSchema,
  Project: ProjectSchema,
  ProjectSuccess: successEnvelope(ProjectSchema),
  ProjectListSuccess: successEnvelope(z.array(ProjectSchema)),
  Asset: AssetSchema,
  AssetSuccess: successEnvelope(AssetSchema),
  AssetDownloadUrlSuccess: successEnvelope(AssetDownloadUrlSchema),
  ReferenceBinding: ReferenceBindingSchema,
  CurrentIdentitySuccess: successEnvelope(CurrentIdentitySchema),
  HealthSuccess: successEnvelope(HealthSchema),
  Shot: ShotSchema,
  ShotSuccess: successEnvelope(ShotSchema),
  TaskRun: TaskRunSchema,
  TaskRunSuccess: successEnvelope(TaskRunSchema),
  TaskRunDetailSuccess: successEnvelope(TaskRunDetailSchema),
  TaskRunAttempt: TaskRunAttemptSchema,
  UploadRequestSuccess: successEnvelope(UploadRequestSchema),
  WorkspaceListSuccess: successEnvelope(z.array(WorkspaceSchema)),
  CreateProjectCommand: CreateProjectCommandSchema,
  UpdateProjectCommand: UpdateProjectCommandSchema,
  CreateUploadRequestCommand: CreateUploadRequestCommandSchema,
  ConfirmAssetUploadCommand: ConfirmAssetUploadCommandSchema,
  ReferenceBindingInput: ReferenceBindingInputSchema,
  CreateShotCommand: CreateShotCommandSchema,
  UpdateShotCommand: UpdateShotCommandSchema,
  CreateTaskRunCommand: CreateTaskRunCommandSchema,
  RetryTaskRunCommand: RetryTaskRunCommandSchema,
  ProjectDetailSuccess: successEnvelope(ProjectDetailSchema),
  PublicWorkspaceEventEnvelope: PublicWorkspaceEventEnvelopeSchema,
};

export const internalContractSchemas = {
  InternalEventEnvelope: InternalEventEnvelopeSchema,
  InternalTaskRunQueueMessage: InternalTaskRunQueueMessageSchema,
};

export const openApiSchemas = Object.fromEntries(
  Object.entries(publicContractSchemas).map(([name, schema]) => [name, toSchema(name, schema, "openApi3")]),
);

export const asyncApiSchemas = Object.fromEntries(
  Object.entries(internalContractSchemas).map(([name, schema]) => [name, toSchema(name, schema, "openApi3")]),
);

export const publicJsonSchemas = Object.fromEntries(
  Object.entries(publicContractSchemas).map(([name, schema]) => [name, toSchema(name, schema, "jsonSchema7")]),
);

const response = (schemaName: string, description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaName}` },
    },
  },
});

export const createOpenApiDocument = (): JsonSchema => ({
  openapi: "3.1.0",
  info: {
    title: "AI Enterprise Content Platform Control API",
    version: "1.0.0",
    description: "C02 contract export. C03 implements the HTTP handlers.",
  },
  paths: {
    "/api/v1/health": {
      get: {
        operationId: "getHealth",
        responses: { "200": response("HealthSuccess", "Control API health"), },
      },
    },
    "/api/v1/me": {
      get: {
        operationId: "getCurrentIdentity",
        responses: {
          "200": response("CurrentIdentitySuccess", "Current identity and workspaces"),
          "403": response("ApiFailure", "Workspace access denied"),
          "503": response("ApiFailure", "Identity unavailable"),
        },
      },
    },
    "/api/v1/workspaces": {
      get: {
        operationId: "listWorkspaces",
        responses: {
          "200": response("WorkspaceListSuccess", "Accessible workspaces"),
          "403": response("ApiFailure", "Workspace access denied"),
        },
      },
    },
    "/api/v1/projects": {
      get: {
        operationId: "listProjects",
        responses: {
          "200": response("ProjectListSuccess", "Projects in the current workspace"),
          "403": response("ApiFailure", "Workspace access denied"),
        },
      },
      post: {
        operationId: "createProject",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProjectCommand" },
            },
          },
        },
        responses: {
          "201": response("ProjectSuccess", "Project created"),
          "400": response("ApiFailure", "Validation failed"),
          "403": response("ApiFailure", "Workspace access denied"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/projects/{project_id}": {
      get: {
        operationId: "getProject",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": response("ProjectDetailSuccess", "Project, shots, and assets"),
          "403": response("ApiFailure", "Workspace access denied"),
          "404": response("ApiFailure", "Project not found"),
        },
      },
      patch: {
        operationId: "updateProject",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          { $ref: "#/components/parameters/ProjectId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UpdateProjectCommand" } },
          },
        },
        responses: {
          "200": response("ProjectSuccess", "Project updated"),
          "400": response("ApiFailure", "Validation failed"),
          "403": response("ApiFailure", "Workspace access denied"),
          "404": response("ApiFailure", "Project not found"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/projects/{project_id}/assets/upload-requests": {
      post: {
        operationId: "createAssetUploadRequest",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          { $ref: "#/components/parameters/ProjectId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateUploadRequestCommand" } },
          },
        },
        responses: {
          "201": response("UploadRequestSuccess", "Upload request created"),
          "400": response("ApiFailure", "Validation failed"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/assets/{asset_id}/confirm-upload": {
      post: {
        operationId: "confirmAssetUpload",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          { $ref: "#/components/parameters/AssetId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ConfirmAssetUploadCommand" } },
          },
        },
        responses: {
          "200": response("AssetSuccess", "Asset upload confirmed"),
          "400": response("ApiFailure", "Validation failed"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/assets/{asset_id}/download-url": {
      get: {
        operationId: "getAssetDownloadUrl",
        parameters: [{ $ref: "#/components/parameters/AssetId" }],
        responses: {
          "200": response("AssetDownloadUrlSuccess", "Short-lived asset download URL"),
          "404": response("ApiFailure", "Asset not found"),
        },
      },
    },
    "/api/v1/projects/{project_id}/shots": {
      post: {
        operationId: "createShot",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          { $ref: "#/components/parameters/ProjectId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateShotCommand" } },
          },
        },
        responses: {
          "201": response("ShotSuccess", "Shot created"),
          "400": response("ApiFailure", "Validation failed"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/shots/{shot_id}": {
      patch: {
        operationId: "updateShot",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          { $ref: "#/components/parameters/ShotId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UpdateShotCommand" } },
          },
        },
        responses: {
          "200": response("ShotSuccess", "Shot updated"),
          "400": response("ApiFailure", "Validation failed"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/shots/{shot_id}/generations": {
      post: {
        operationId: "createTaskRun",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          {
            name: "shot_id",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^sht_" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateTaskRunCommand" },
            },
          },
        },
        responses: {
          "202": response("TaskRunSuccess", "Task run queued"),
          "400": response("ApiFailure", "Validation failed"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/task-runs/{task_run_id}/retry": {
      post: {
        operationId: "retryTaskRun",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
          { $ref: "#/components/parameters/TaskRunId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RetryTaskRunCommand" } },
          },
        },
        responses: {
          "202": response("TaskRunSuccess", "Task run retry accepted"),
          "400": response("ApiFailure", "Validation failed"),
          "409": response("ApiFailure", "Idempotency conflict"),
        },
      },
    },
    "/api/v1/task-runs/{task_run_id}": {
      get: {
        operationId: "getTaskRun",
        parameters: [{ $ref: "#/components/parameters/TaskRunId" }],
        responses: {
          "200": response("TaskRunDetailSuccess", "Task run and execution attempts"),
          "404": response("ApiFailure", "Task run not found"),
        },
      },
    },
    "/api/v1/events": {
      get: {
        operationId: "streamWorkspaceEvents",
        parameters: [
          {
            name: "workspace_id",
            in: "query",
            required: true,
            schema: { type: "string", pattern: "^ws_" },
          },
        ],
        responses: {
          "200": {
            description: "Workspace-scoped server-sent event stream",
            content: {
              "text/event-stream": {
                schema: { $ref: "#/components/schemas/PublicWorkspaceEventEnvelope" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 255 },
      },
      ProjectId: {
        name: "project_id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^prj_" },
      },
      AssetId: {
        name: "asset_id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^ast_" },
      },
      ShotId: {
        name: "shot_id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^sht_" },
      },
      TaskRunId: {
        name: "task_run_id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^tsk_" },
      },
    },
    schemas: openApiSchemas,
  },
});

export const createAsyncApiDocument = (): JsonSchema => ({
  asyncapi: "3.0.0",
  info: {
    title: "AI Enterprise Content Platform Internal Events",
    version: "1.0.0",
  },
  channels: {
    "workspace/{workspace_id}": {
      address: "workspace/{workspace_id}",
      parameters: {
        workspace_id: { description: "Workspace isolation boundary" },
      },
      messages: {
        internalEvent: {
          name: "InternalEventEnvelope",
          payload: { $ref: "#/components/schemas/InternalEventEnvelope" },
        },
        taskRunQueued: {
          name: "InternalTaskRunQueueMessage",
          payload: { $ref: "#/components/schemas/InternalTaskRunQueueMessage" },
        },
      },
    },
  },
  components: {
    schemas: asyncApiSchemas,
  },
});

export const createJsonSchemaDocument = (): JsonSchema => ({
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://contracts.alchemy-video.local/platform-contracts.schema.json",
  title: "AI Enterprise Content Platform Contracts",
  type: "object",
  definitions: publicJsonSchemas,
});

export const createContractDocuments = () => ({
  openApi: createOpenApiDocument(),
  asyncApi: createAsyncApiDocument(),
  jsonSchema: createJsonSchemaDocument(),
});

export const ProjectSuccessEnvelopeSchema = successEnvelope(ProjectSchema);
export const TaskRunSuccessEnvelopeSchema = successEnvelope(TaskRunSchema);
export const HealthSuccessEnvelopeSchema = successEnvelope(HealthSchema);
