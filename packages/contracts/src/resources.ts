import { z } from "zod";

import {
  AssetIdSchema,
  DecimalStringSchema,
  JsonObjectSchema,
  ProjectIdSchema,
  ProviderAttemptIdSchema,
  Sha256Schema,
  ShotIdSchema,
  TaskRunIdSchema,
  UsageRecordIdSchema,
  UserIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";
import { CreditProviderSchema } from "./credit.js";

export const UserStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export const WorkspaceRoleSchema = z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
export const ProjectStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const AssetKindSchema = z.enum([
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "POSTER",
  "THUMBNAIL",
]);
export const AssetOriginSchema = z.enum(["USER_UPLOAD", "GENERATED", "DERIVED"]);
export const AssetStatusSchema = z.enum(["PENDING_UPLOAD", "READY", "FAILED", "DELETED"]);
export const ShotStatusSchema = z.enum([
  "DRAFT",
  "READY",
  "GENERATING",
  "GENERATED",
  "FAILED",
  "ARCHIVED",
]);
export const TaskRunKindSchema = z.enum([
  "VIDEO_GENERATION",
  "DOCUMENT_CONVERSION",
  "RENDER",
  "QC",
]);
export const TASK_RUN_STATUSES = [
  "CREATED",
  "QUEUED",
  "RUNNING",
  "PROVIDER_PROCESSING",
  "DOWNLOADING",
  "BILLING_PENDING",
  "SUCCEEDED",
  "BILLING_FAILED",
  "FAILED",
  "RETRY_SCHEDULED",
  "ABANDONED",
] as const;

export const TASK_RUN_TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "ABANDONED"] as const;
export const TaskRunStatusSchema = z.enum(TASK_RUN_STATUSES);
export const PUBLIC_TASK_RUN_STATUSES = [
  "CREATED",
  "QUEUED",
  "RUNNING",
  "PROCESSING",
  "DOWNLOADING",
  "BILLING_PENDING",
  "SUCCEEDED",
  "BILLING_FAILED",
  "FAILED",
  "RETRY_SCHEDULED",
  "ABANDONED",
] as const;
export const PublicTaskRunStatusSchema = z.enum(PUBLIC_TASK_RUN_STATUSES);
export const ProviderAttemptStatusSchema = z.enum([
  "CREATED",
  "SUBMITTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DOWNLOAD_FAILED",
  "ABANDONED",
]);
export const ReferenceRoleSchema = z.enum(["STYLE", "SUBJECT", "FIRST_FRAME", "LAST_FRAME"]);

export const UserSchema = z.object({
  id: UserIdSchema,
  display_name: z.string().min(1).max(255),
  status: UserStatusSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1).max(255),
  created_by: UserIdSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

export const WorkspaceMemberSchema = z.object({
  workspace_id: WorkspaceIdSchema,
  user_id: UserIdSchema,
  role: WorkspaceRoleSchema,
  created_at: UtcTimestampSchema,
});

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  workspace_id: WorkspaceIdSchema,
  name: z.string().min(1).max(255),
  status: ProjectStatusSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

export const AssetRecordSchema = z.object({
  id: AssetIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  kind: AssetKindSchema,
  origin: AssetOriginSchema,
  status: AssetStatusSchema,
  object_key: z.string().min(1),
  sha256: Sha256Schema.nullable(),
  mime_type: z.string().min(1).nullable(),
  byte_size: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  metadata: JsonObjectSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

// object_key is internal storage routing data and must never be a browser DTO.
export const AssetSchema = AssetRecordSchema.omit({ object_key: true });

export const ShotSchema = z.object({
  id: ShotIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  position: z.number().int().nonnegative(),
  prompt: z.string(),
  model: z.string().min(1).nullable(),
  generation_settings: JsonObjectSchema,
  status: ShotStatusSchema,
  selected_asset_id: AssetIdSchema.nullable(),
  revision: z.number().int().positive(),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

export const ReferenceBindingSchema = z.object({
  shot_id: ShotIdSchema,
  asset_id: AssetIdSchema,
  role: ReferenceRoleSchema,
  position: z.number().int().nonnegative(),
  created_at: UtcTimestampSchema,
});

export const ReferenceBindingInputSchema = ReferenceBindingSchema.pick({
  asset_id: true,
  role: true,
  position: true,
});

export const VideoGenerationInputSnapshotSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  duration: z.number().int().positive(),
  resolution: z.string().min(1),
  ratio: z.string().min(1),
  reference_asset_ids: z.array(AssetIdSchema).max(8),
});

export const TaskRunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
}).strict();

export const TaskRunRecordSchema = z.object({
  id: TaskRunIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  shot_id: ShotIdSchema,
  kind: TaskRunKindSchema,
  status: TaskRunStatusSchema,
  input_snapshot: JsonObjectSchema,
  result_asset_id: AssetIdSchema.nullable(),
  error: TaskRunErrorSchema.nullable(),
  retry_at: UtcTimestampSchema.nullable(),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

// The browser sees a normalized lifecycle status, not the internal Provider phase.
export const TaskRunSchema = TaskRunRecordSchema.extend({
  status: PublicTaskRunStatusSchema,
});

export const ProviderAttemptSchema = z.object({
  id: ProviderAttemptIdSchema,
  task_run_id: TaskRunIdSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  provider_request_id: z.string().min(1).nullable(),
  status: ProviderAttemptStatusSchema,
  request_payload: JsonObjectSchema,
  response_payload: JsonObjectSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

// Provider-native payloads and request IDs stay inside the Worker/Persistence boundary.
export const ProviderAttemptSummarySchema = ProviderAttemptSchema.omit({
  provider_request_id: true,
  request_payload: true,
  response_payload: true,
});

// Browser DTOs reveal execution state only, never Provider identity or transport details.
export const TaskRunAttemptSchema = ProviderAttemptSummarySchema.omit({
  provider: true,
  model: true,
});

export const UsageRecordSchema = z.object({
  id: UsageRecordIdSchema,
  credit_provider: CreditProviderSchema,
  task_run_id: TaskRunIdSchema,
  external_user_id: z.string().min(1),
  amount: DecimalStringSchema,
  source: z.string().min(1),
  reference_id: z.string().min(1).nullable(),
  idempotency_key: z.string().min(1),
  balance_after: DecimalStringSchema.nullable(),
  replayed: z.boolean(),
  created_at: UtcTimestampSchema,
});

export const OutboxEventSchema = z.object({
  id: z.string().min(1),
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema.nullable(),
  aggregate_type: z.string().min(1),
  aggregate_id: z.string().min(1),
  event_type: z.string().min(1),
  payload: JsonObjectSchema,
  occurred_at: UtcTimestampSchema,
  published_at: UtcTimestampSchema.nullable(),
  publish_attempts: z.number().int().nonnegative(),
  available_at: UtcTimestampSchema,
  lease_owner: z.string().min(1).nullable(),
  lease_expires_at: UtcTimestampSchema.nullable(),
  last_error: z.string().min(1).nullable(),
  dead_lettered_at: UtcTimestampSchema.nullable(),
  created_at: UtcTimestampSchema,
});

export const EventConsumptionSchema = z.object({
  event_id: z.string().min(1),
  consumer_name: z.string().min(1),
  lease_owner: z.string().min(1).nullable(),
  lease_expires_at: UtcTimestampSchema.nullable(),
  attempts: z.number().int().nonnegative(),
  last_error: z.string().min(1).nullable(),
  dead_lettered_at: UtcTimestampSchema.nullable(),
  completed_at: UtcTimestampSchema.nullable(),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
});

export const CommandDeduplicationSchema = z.object({
  scope: z.string().min(1),
  idempotency_key: z.string().min(1),
  request_hash: Sha256Schema,
  response_snapshot: JsonObjectSchema,
  created_at: UtcTimestampSchema,
});

export const HealthSchema = z.object({
  service: z.literal("control-api"),
  status: z.literal("ok"),
  build_version: z.string().min(1),
  dependencies: z.object({
    database: z.enum(["ok", "unavailable", "not_configured"]),
  }),
});

export const CurrentIdentitySchema = z.object({
  user: UserSchema,
  workspaces: z.array(WorkspaceSchema),
});

export const ProjectDetailSchema = z.object({
  project: ProjectSchema,
  shots: z.array(ShotSchema),
  assets: z.array(AssetSchema),
  reference_bindings: z.array(ReferenceBindingSchema),
  task_runs: z.array(TaskRunSchema),
});

export const UploadRequestSchema = z.object({
  asset_id: AssetIdSchema,
  upload_url: z.string().url().nullable(),
  headers: z.record(z.string()),
  expires_at: UtcTimestampSchema.nullable(),
});

export const AssetDownloadUrlSchema = z.object({
  download_url: z.string().url(),
  expires_at: UtcTimestampSchema,
});

export const TaskRunDetailSchema = z.object({
  task_run: TaskRunSchema,
  attempts: z.array(TaskRunAttemptSchema),
  result_asset: AssetSchema.nullable(),
});

export const CreateProjectCommandSchema = z.object({
  name: z.string().min(1).max(255),
});

export const UpdateProjectCommandSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: ProjectStatusSchema.optional(),
}).refine((command) => Object.keys(command).length > 0, "At least one project field is required.");

export const CreateUploadRequestCommandSchema = z.object({
  kind: z.enum(["IMAGE", "AUDIO", "DOCUMENT"]),
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
  byte_size: z.number().int().positive().max(25 * 1024 * 1024),
}).superRefine((command, context) => {
  const mimeType = command.mime_type.toLowerCase();
  const allowedMimeTypes = {
    IMAGE: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    AUDIO: ["audio/mpeg", "audio/ogg", "audio/wav"],
    DOCUMENT: ["application/pdf", "text/markdown", "text/plain"],
  } as const;

  if (!allowedMimeTypes[command.kind].includes(mimeType as never)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mime_type"],
      message: "mime_type is not allowed for the requested asset kind.",
    });
  }
});

export const ConfirmAssetUploadCommandSchema = z.object({
  sha256: Sha256Schema,
  mime_type: z.string().min(1).max(255),
  byte_size: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});

const ReferenceBindingsInputSchema = z.array(ReferenceBindingInputSchema).max(8).superRefine((bindings, context) => {
  const assetRoleKeys = new Set<string>();
  const rolePositionKeys = new Set<string>();

  bindings.forEach((binding, index) => {
    const assetRoleKey = `${binding.asset_id}:${binding.role}`;
    const rolePositionKey = `${binding.role}:${binding.position}`;
    if (assetRoleKeys.has(assetRoleKey) || rolePositionKeys.has(rolePositionKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "Reference bindings must have unique asset-role and role-position pairs.",
      });
    }
    assetRoleKeys.add(assetRoleKey);
    rolePositionKeys.add(rolePositionKey);
  });
});

export const CreateShotCommandSchema = z.object({
  position: z.number().int().nonnegative(),
  prompt: z.string().default(""),
  model: z.string().min(1).nullable().optional(),
  generation_settings: JsonObjectSchema.default({}),
  reference_bindings: ReferenceBindingsInputSchema.default([]),
});

export const UpdateShotCommandSchema = z
  .object({
    position: z.number().int().nonnegative().optional(),
    prompt: z.string().optional(),
    model: z.string().min(1).nullable().optional(),
    generation_settings: JsonObjectSchema.optional(),
    status: z.enum(["DRAFT", "READY", "ARCHIVED"]).optional(),
    selected_asset_id: AssetIdSchema.nullable().optional(),
    reference_bindings: ReferenceBindingsInputSchema.optional(),
  })
  .refine((command) => Object.keys(command).length > 0, "At least one shot field is required.");

export const CreateTaskRunCommandSchema = VideoGenerationInputSnapshotSchema;
export const RetryTaskRunCommandSchema = z.object({}).strict();

export type TaskRunStatus = z.infer<typeof TaskRunStatusSchema>;
export type TaskRun = z.infer<typeof TaskRunSchema>;
export type VideoGenerationInputSnapshot = z.infer<typeof VideoGenerationInputSnapshotSchema>;
