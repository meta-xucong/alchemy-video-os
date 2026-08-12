import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { TASK_RUN_STATUSES, TASK_RUN_TERMINAL_STATUSES } from "@alchemy-video/contracts";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull();
const jsonObject = () => jsonb().$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull();
const taskRunTerminalStatusSql = sql.raw(
  TASK_RUN_TERMINAL_STATUSES.map((status) => `'${status}'`).join(", "),
);

export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const workspaceRole = pgEnum("workspace_role", ["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
export const projectStatus = pgEnum("project_status", ["ACTIVE", "ARCHIVED"]);
export const assetKind = pgEnum("asset_kind", ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "POSTER", "THUMBNAIL"]);
export const assetOrigin = pgEnum("asset_origin", ["USER_UPLOAD", "GENERATED", "DERIVED"]);
export const assetStatus = pgEnum("asset_status", ["PENDING_UPLOAD", "READY", "FAILED", "DELETED"]);
export const shotStatus = pgEnum("shot_status", ["DRAFT", "READY", "GENERATING", "GENERATED", "FAILED", "ARCHIVED"]);
export const referenceRole = pgEnum("reference_role", ["STYLE", "SUBJECT", "FIRST_FRAME", "LAST_FRAME"]);
export const taskRunKind = pgEnum("task_run_kind", ["VIDEO_GENERATION", "DOCUMENT_CONVERSION", "RENDER", "QC"]);
export const taskRunStatus = pgEnum("task_run_status", TASK_RUN_STATUSES);
export const providerAttemptStatus = pgEnum("provider_attempt_status", [
  "CREATED",
  "SUBMITTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DOWNLOAD_FAILED",
  "ABANDONED",
]);

export const users = pgTable("users", {
  id: text().primaryKey(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  status: userStatus().default("ACTIVE").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable("workspaces", {
  id: text().primaryKey(),
  name: varchar({ length: 255 }).notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole().notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const projects = pgTable(
  "projects",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar({ length: 255 }).notNull(),
    status: projectStatus().default("ACTIVE").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("projects_workspace_id_key").on(table.workspaceId, table.id),
    index("projects_workspace_created_at_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    kind: assetKind().notNull(),
    origin: assetOrigin().notNull(),
    status: assetStatus().default("PENDING_UPLOAD").notNull(),
    objectKey: text("object_key").notNull(),
    sha256: varchar({ length: 64 }),
    mimeType: varchar("mime_type", { length: 255 }),
    byteSize: bigint("byte_size", { mode: "number" }),
    width: integer(),
    height: integer(),
    durationMs: integer("duration_ms"),
    metadata: jsonObject(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("assets_object_key_key").on(table.objectKey),
    uniqueIndex("assets_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("assets_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "assets_workspace_project_fk",
    }).onDelete("cascade"),
    check("assets_object_key_scope_check", sql`${table.objectKey} like ${table.workspaceId} || '/' || ${table.projectId} || '/' || ${table.id} || '/%'`),
    check("assets_sha256_format_check", sql`${table.sha256} is null or ${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const shots = pgTable(
  "shots",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    position: integer().notNull(),
    prompt: text().default("").notNull(),
    model: varchar({ length: 255 }),
    generationSettings: jsonb("generation_settings").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    status: shotStatus().default("DRAFT").notNull(),
    selectedAssetId: text("selected_asset_id"),
    revision: integer().default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("shots_project_position_key").on(table.projectId, table.position),
    uniqueIndex("shots_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("shots_workspace_project_idx").on(table.workspaceId, table.projectId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "shots_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.selectedAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "shots_workspace_project_selected_asset_fk",
    }).onDelete("restrict"),
    check("shots_position_nonnegative_check", sql`${table.position} >= 0`),
    check("shots_revision_positive_check", sql`${table.revision} > 0`),
  ],
);

export const referenceBindings = pgTable(
  "reference_bindings",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    shotId: text("shot_id").notNull(),
    assetId: text("asset_id").notNull(),
    role: referenceRole().notNull(),
    position: integer().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.shotId, table.assetId, table.role] }),
    uniqueIndex("reference_bindings_shot_role_position_key").on(table.shotId, table.role, table.position),
    index("reference_bindings_workspace_project_idx").on(table.workspaceId, table.projectId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "reference_bindings_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.shotId],
      foreignColumns: [shots.workspaceId, shots.projectId, shots.id],
      name: "reference_bindings_workspace_project_shot_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.assetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "reference_bindings_workspace_project_asset_fk",
    }).onDelete("restrict"),
    check("reference_bindings_position_nonnegative_check", sql`${table.position} >= 0`),
  ],
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    shotId: text("shot_id").notNull(),
    kind: taskRunKind().notNull(),
    status: taskRunStatus().default("CREATED").notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    resultAssetId: text("result_asset_id"),
    error: jsonb().$type<Record<string, unknown>>(),
    retryAt: timestamp("retry_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("task_runs_workspace_id_key").on(table.workspaceId, table.id),
    index("task_runs_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    uniqueIndex("task_runs_one_active_shot_key")
      .on(table.shotId)
      .where(sql`${table.status} not in (${taskRunTerminalStatusSql})`),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "task_runs_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.shotId],
      foreignColumns: [shots.workspaceId, shots.projectId, shots.id],
      name: "task_runs_workspace_project_shot_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.resultAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "task_runs_workspace_project_result_asset_fk",
    }).onDelete("restrict"),
    check(
      "task_runs_result_asset_success_check",
      sql`(${table.status} = 'SUCCEEDED' and ${table.resultAssetId} is not null) or (${table.status} <> 'SUCCEEDED' and ${table.resultAssetId} is null)`,
    ),
  ],
);

export const providerAttempts = pgTable(
  "provider_attempts",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    taskRunId: text("task_run_id").notNull(),
    provider: varchar({ length: 128 }).notNull(),
    model: varchar({ length: 255 }).notNull(),
    providerRequestId: text("provider_request_id"),
    status: providerAttemptStatus().default("CREATED").notNull(),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("provider_attempts_workspace_task_run_idx").on(table.workspaceId, table.taskRunId),
    foreignKey({
      columns: [table.workspaceId, table.taskRunId],
      foreignColumns: [taskRuns.workspaceId, taskRuns.id],
      name: "provider_attempts_workspace_task_run_fk",
    }).onDelete("cascade"),
    uniqueIndex("provider_attempts_provider_request_key")
      .on(table.provider, table.providerRequestId)
      .where(sql`${table.providerRequestId} is not null`),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    taskRunId: text("task_run_id").notNull(),
    externalUserId: text("external_user_id").notNull(),
    amount: numeric({ precision: 18, scale: 8 }).notNull(),
    source: varchar({ length: 128 }).notNull(),
    referenceId: text("reference_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    balanceAfter: numeric("balance_after", { precision: 18, scale: 8 }),
    replayed: boolean().default(false).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("usage_records_idempotency_key_key").on(table.idempotencyKey),
    index("usage_records_workspace_task_run_idx").on(table.workspaceId, table.taskRunId),
    foreignKey({
      columns: [table.workspaceId, table.taskRunId],
      foreignColumns: [taskRuns.workspaceId, taskRuns.id],
      name: "usage_records_workspace_task_run_fk",
    }).onDelete("restrict"),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
    publishAttempts: integer("publish_attempts").default(0).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("outbox_events_pending_idx").on(table.publishedAt, table.createdAt),
    index("outbox_events_workspace_occurred_at_idx").on(table.workspaceId, table.occurredAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "outbox_events_workspace_project_fk",
    }).onDelete("cascade"),
  ],
);

export const commandDeduplications = pgTable(
  "command_deduplications",
  {
    scope: text().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.idempotencyKey] }),
    check("command_deduplications_request_hash_format_check", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
