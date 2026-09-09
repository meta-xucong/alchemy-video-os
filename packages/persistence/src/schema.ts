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

import {
  CREATIVE_REVISION_STATUSES,
  DOCUMENT_KNOWLEDGE_REVISION_STATUSES,
  PREFLIGHT_REVISION_STATUSES,
  type BudgetReservationStatus,
  type CapabilityProfileStatus,
  type CaptionPolicy,
  HANDOFF_REVIEW_RESULTS,
  type LipSyncRequirement,
  type PolicyRevisionStatus,
  PRODUCTION_RUN_STATUSES,
  PRODUCTION_SEGMENT_STATUSES,
  QC_STATUSES,
  type QualityGateAction,
  TASK_RUN_STATUSES,
  TASK_RUN_TERMINAL_STATUSES,
  TRANSITION_REPAIR_STATUSES,
  TRANSITION_REPAIR_STRATEGIES,
  VIDEO_VERSION_STATUSES,
  type DurationPolicy,
  type VoiceAuthorizationStatus,
  type VoiceMode,
  type CreativeBriefTargetResolution,
} from "@alchemy-video/contracts";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull();
const jsonObject = () => jsonb().$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull();
const taskRunTerminalStatusSql = sql.raw(
  TASK_RUN_TERMINAL_STATUSES.map((status) => `'${status}'`).join(", "),
);

export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const workspaceRole = pgEnum("workspace_role", ["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
export const projectStatus = pgEnum("project_status", ["ACTIVE", "ARCHIVED", "DELETED"]);
export const assetKind = pgEnum("asset_kind", ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "POSTER", "THUMBNAIL"]);
export const assetOrigin = pgEnum("asset_origin", ["USER_UPLOAD", "GENERATED", "DERIVED"]);
export const assetStatus = pgEnum("asset_status", ["PENDING_UPLOAD", "READY", "FAILED", "DELETED"]);
export const documentStatus = pgEnum("document_status", ["READY", "ARCHIVED"]);
export const documentConversionStatus = pgEnum("document_conversion_status", ["CREATED", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
export const documentKnowledgeRevisionStatus = pgEnum("document_knowledge_revision_status", DOCUMENT_KNOWLEDGE_REVISION_STATUSES);
export const documentKnowledgeAnalysisQuality = pgEnum("document_knowledge_analysis_quality", ["COMPLETE", "PARTIAL", "NEEDS_CONFIRMATION"]);
export const documentKnowledgeEvidenceKind = pgEnum("document_knowledge_evidence_kind", ["TEXT", "TABLE", "VISUAL_UNAVAILABLE"]);
export const documentFactCategory = pgEnum("document_fact_category", ["BRAND", "PRODUCT", "LOCATION", "AUDIENCE", "SELLING_POINT", "AMENITY", "STYLE", "CTA", "COMPLIANCE", "NUMERIC_CLAIM", "RISK"]);
export const documentFactConfidence = pgEnum("document_fact_confidence", ["EXPLICIT", "INFERRED", "NEEDS_CONFIRMATION"]);
export const creativeRevisionStatus = pgEnum("creative_revision_status", CREATIVE_REVISION_STATUSES);
export const continuityLevel = pgEnum("continuity_level", ["STANDARD", "REVIEW_REQUIRED"]);
export const referencePolicy = pgEnum("reference_policy", ["REFERENCE_SET", "HANDOFF_FIRST_FRAME", "TEXT_TRANSITION"]);
export const productionRunStatus = pgEnum("production_run_status", PRODUCTION_RUN_STATUSES);
export const preflightRevisionStatus = pgEnum("preflight_revision_status", PREFLIGHT_REVISION_STATUSES);
export const durationPolicy = pgEnum("duration_policy", ["FLEXIBLE", "EXACT"]);
export const captionPolicy = pgEnum("caption_policy", ["REQUIRED", "OPTIONAL", "OFF"]);
export const lipSyncRequirement = pgEnum("lip_sync_requirement", ["OFF", "PREFERRED", "REQUIRED"]);
export const voiceMode = pgEnum("voice_mode", ["PLATFORM_GENERIC", "AUTHORIZED_CLONE", "USER_SOURCE"]);
export const capabilityProfileStatus = pgEnum("capability_profile_status", ["DISABLED", "OFFLINE_CERTIFIED", "LIVE_CERTIFIED", "REVOKED"]);
export const voiceAuthorizationStatus = pgEnum("voice_authorization_status", ["PENDING", "ACTIVE", "REVOKED", "EXPIRED"]);
export const policyRevisionStatus = pgEnum("policy_revision_status", ["DRAFT", "APPROVED", "REVOKED", "SUPERSEDED"]);
export const budgetReservationStatus = pgEnum("budget_reservation_status", ["ESTIMATED", "APPROVED", "REJECTED", "EXCEEDED", "CONSUMED", "RELEASED"]);
export const qualityGateSeverity = pgEnum("quality_gate_severity", ["BLOCK", "REVISE", "REVIEW", "INFO"]);
export const qualityGateAction = pgEnum("quality_gate_action", ["PRESENT", "REVISE_NARRATION", "REVISE_EDIT", "REGENERATE_SEGMENT", "BLOCK", "AWAITING_HUMAN_APPROVAL"]);
export const qualityGateActor = pgEnum("quality_gate_actor", ["RUNTIME", "USER", "AUTHORIZED_REVIEWER"]);
export const continuityStatus = pgEnum("continuity_status", ["NOT_CHECKED", "CHECKING", "GOOD", "AUTO_REPAIRING", "NEEDS_ATTENTION"]);
export const productionSegmentStatus = pgEnum("production_segment_status", PRODUCTION_SEGMENT_STATUSES);
export const qcSubjectType = pgEnum("qc_subject_type", ["PRODUCTION_SEGMENT", "VIDEO_VERSION"]);
export const qcKind = pgEnum("qc_kind", ["TECHNICAL", "COMPOSITION"]);
export const qcStatus = pgEnum("qc_status", QC_STATUSES);
export const assetDerivationType = pgEnum("asset_derivation_type", ["HANDOFF_FRAME"]);
export const videoVersionStatus = pgEnum("video_version_status", VIDEO_VERSION_STATUSES);
export const handoffReviewResult = pgEnum("handoff_review_result", HANDOFF_REVIEW_RESULTS);
export const transitionRepairStrategy = pgEnum("transition_repair_strategy", TRANSITION_REPAIR_STRATEGIES);
export const transitionRepairStatus = pgEnum("transition_repair_status", TRANSITION_REPAIR_STATUSES);
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

export const creativeBriefRevisions = pgTable(
  "creative_brief_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    revision: integer().notNull(),
    sourceText: text("source_text").notNull(),
    targetDurationSeconds: integer("target_duration_seconds").notNull(),
    targetResolution: varchar("target_resolution", { length: 4 }).$type<CreativeBriefTargetResolution>().default("720p").notNull(),
    stylePreferences: text("style_preferences").default("").notNull(),
    sourceAssetIds: jsonb("source_asset_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    status: creativeRevisionStatus().default("DRAFT").notNull(),
    error: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("creative_brief_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("creative_brief_revisions_project_revision_key").on(table.projectId, table.revision),
    index("creative_brief_revisions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "creative_brief_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    check("creative_brief_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("creative_brief_revisions_source_text_nonempty_check", sql`length(trim(${table.sourceText})) > 0`),
    check("creative_brief_revisions_target_duration_check", sql`${table.targetDurationSeconds} between 1 and 600`),
    check("creative_brief_revisions_target_resolution_check", sql`${table.targetResolution} in ('480p', '720p')`),
  ],
);

export const scriptRevisions = pgTable(
  "script_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    creativeBriefRevisionId: text("creative_brief_revision_id").notNull(),
    revision: integer().notNull(),
    beats: jsonb().$type<Record<string, unknown>[]>().default(sql`'[]'::jsonb`).notNull(),
    status: creativeRevisionStatus().default("DRAFT").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("script_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("script_revisions_creative_brief_revision_key").on(table.creativeBriefRevisionId, table.revision),
    index("script_revisions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "script_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.creativeBriefRevisionId],
      foreignColumns: [creativeBriefRevisions.workspaceId, creativeBriefRevisions.projectId, creativeBriefRevisions.id],
      name: "script_revisions_workspace_project_creative_brief_fk",
    }).onDelete("cascade"),
    check("script_revisions_revision_positive_check", sql`${table.revision} > 0`),
  ],
);

export const storyboardRevisions = pgTable(
  "storyboard_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    scriptRevisionId: text("script_revision_id").notNull(),
    revision: integer().notNull(),
    title: varchar({ length: 160 }).notNull(),
    summary: text().notNull(),
    totalDurationSeconds: integer("total_duration_seconds").notNull(),
    continuityLevel: continuityLevel("continuity_level").notNull(),
    continuityNote: text("continuity_note").notNull(),
    status: creativeRevisionStatus().default("DRAFT").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("storyboard_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("storyboard_revisions_script_revision_key").on(table.scriptRevisionId, table.revision),
    index("storyboard_revisions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "storyboard_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.scriptRevisionId],
      foreignColumns: [scriptRevisions.workspaceId, scriptRevisions.projectId, scriptRevisions.id],
      name: "storyboard_revisions_workspace_project_script_fk",
    }).onDelete("cascade"),
    check("storyboard_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("storyboard_revisions_total_duration_positive_check", sql`${table.totalDurationSeconds} > 0`),
  ],
);

export const storyboardShotSpecs = pgTable(
  "storyboard_shot_specs",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    storyboardRevisionId: text("storyboard_revision_id").notNull(),
    sequence: integer().notNull(),
    title: varchar({ length: 160 }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    narrativeGoal: text("narrative_goal").notNull(),
    startState: text("start_state").notNull(),
    endState: text("end_state").notNull(),
    transitionSummary: text("transition_summary").notNull(),
    referencePolicy: referencePolicy("reference_policy").notNull(),
    dependsOnSequences: jsonb("depends_on_sequences").$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
    narrativeBeatSequences: jsonb("narrative_beat_sequences").$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
    continuityNote: text("continuity_note").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("storyboard_shot_specs_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("storyboard_shot_specs_revision_sequence_key").on(table.storyboardRevisionId, table.sequence),
    index("storyboard_shot_specs_workspace_revision_sequence_idx").on(table.workspaceId, table.storyboardRevisionId, table.sequence),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "storyboard_shot_specs_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.storyboardRevisionId],
      foreignColumns: [storyboardRevisions.workspaceId, storyboardRevisions.projectId, storyboardRevisions.id],
      name: "storyboard_shot_specs_workspace_project_storyboard_fk",
    }).onDelete("cascade"),
    check("storyboard_shot_specs_sequence_positive_check", sql`${table.sequence} > 0`),
    check("storyboard_shot_specs_duration_capability_check", sql`${table.durationSeconds} between 1 and 15`),
    check("storyboard_shot_specs_narrative_beats_nonempty_check", sql`jsonb_array_length(${table.narrativeBeatSequences}) > 0`),
  ],
);

export const promptPackages = pgTable(
  "prompt_packages",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    shotSpecId: text("shot_spec_id").notNull(),
    compilerVersion: varchar("compiler_version", { length: 160 }).notNull(),
    prompt: text().notNull(),
    visualConstraints: jsonb("visual_constraints").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    referenceMap: jsonb("reference_map").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    capabilitySnapshot: jsonb("capability_snapshot").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("prompt_packages_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("prompt_packages_workspace_shot_spec_created_at_idx").on(table.workspaceId, table.shotSpecId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "prompt_packages_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.shotSpecId],
      foreignColumns: [storyboardShotSpecs.workspaceId, storyboardShotSpecs.projectId, storyboardShotSpecs.id],
      name: "prompt_packages_workspace_project_shot_spec_fk",
    }).onDelete("cascade"),
    check("prompt_packages_prompt_nonempty_check", sql`length(trim(${table.prompt})) > 0`),
  ],
);

export const productionRuns = pgTable(
  "production_runs",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    storyboardRevisionId: text("storyboard_revision_id").notNull(),
    // Nullable keeps pre-C11.7 production history readable during the forward-only rollout.
    deliveryPlanRevisionId: text("delivery_plan_revision_id"),
    status: productionRunStatus().default("DRAFT").notNull(),
    totalShotCount: integer("total_shot_count").notNull(),
    acceptedShotCount: integer("accepted_shot_count").default(0).notNull(),
    totalDurationSeconds: integer("total_duration_seconds").notNull(),
    continuityStatus: continuityStatus("continuity_status").default("NOT_CHECKED").notNull(),
    maxAutoRepairCount: integer("max_auto_repair_count").default(2).notNull(),
    autoRepairCount: integer("auto_repair_count").default(0).notNull(),
    budgetGuard: jsonb("budget_guard").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    error: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("production_runs_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("production_runs_one_active_project_key")
      .on(table.projectId)
      .where(sql`${table.status} not in ('SUCCEEDED', 'FAILED', 'BLOCKED')`),
    index("production_runs_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "production_runs_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.storyboardRevisionId],
      foreignColumns: [storyboardRevisions.workspaceId, storyboardRevisions.projectId, storyboardRevisions.id],
      name: "production_runs_workspace_project_storyboard_fk",
    }).onDelete("restrict"),
    check("production_runs_total_shot_count_positive_check", sql`${table.totalShotCount} > 0`),
    check("production_runs_accepted_shot_count_check", sql`${table.acceptedShotCount} >= 0 and ${table.acceptedShotCount} <= ${table.totalShotCount}`),
    check("production_runs_total_duration_positive_check", sql`${table.totalDurationSeconds} > 0`),
    check("production_runs_auto_repair_count_check", sql`${table.autoRepairCount} >= 0 and ${table.autoRepairCount} <= ${table.maxAutoRepairCount}`),
    check("production_runs_max_auto_repair_count_check", sql`${table.maxAutoRepairCount} >= 0 and ${table.maxAutoRepairCount} <= 20`),
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

export const documents = pgTable(
  "documents",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    sourceAssetId: text("source_asset_id").notNull(),
    status: documentStatus().default("READY").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("documents_workspace_source_asset_key").on(table.workspaceId, table.sourceAssetId),
    uniqueIndex("documents_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("documents_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "documents_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sourceAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "documents_workspace_project_source_asset_fk",
    }).onDelete("restrict"),
  ],
);

export const documentConversions = pgTable(
  "document_conversions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    sourceAssetId: text("source_asset_id").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    sourceMimeType: varchar("source_mime_type", { length: 255 }).notNull(),
    sourceFilename: varchar("source_filename", { length: 255 }).notNull(),
    sourceByteSize: bigint("source_byte_size", { mode: "number" }).notNull(),
    status: documentConversionStatus().default("CREATED").notNull(),
    markdownAssetId: text("markdown_asset_id"),
    converter: varchar({ length: 128 }),
    converterVersion: varchar("converter_version", { length: 128 }),
    warnings: jsonb().$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    error: jsonb().$type<Record<string, unknown>>(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("document_conversions_workspace_id_key").on(table.workspaceId, table.id),
    uniqueIndex("document_conversions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("document_conversions_one_active_document_key")
      .on(table.documentId)
      .where(sql`${table.status} in ('CREATED', 'QUEUED', 'RUNNING')`),
    index("document_conversions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "document_conversions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.documentId],
      foreignColumns: [documents.workspaceId, documents.projectId, documents.id],
      name: "document_conversions_workspace_project_document_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sourceAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "document_conversions_workspace_project_source_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.markdownAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "document_conversions_workspace_project_markdown_asset_fk",
    }).onDelete("restrict"),
    check("document_conversions_source_sha256_format_check", sql`${table.sourceSha256} ~ '^[a-f0-9]{64}$'`),
    check("document_conversions_source_byte_size_positive_check", sql`${table.sourceByteSize} > 0`),
    check("document_conversions_result_success_check", sql`(${table.status} = 'SUCCEEDED' and ${table.markdownAssetId} is not null) or (${table.status} <> 'SUCCEEDED' and ${table.markdownAssetId} is null)`),
  ],
);

export const creativeBriefDocumentContexts = pgTable(
  "creative_brief_document_contexts",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    creativeBriefRevisionId: text("creative_brief_revision_id").notNull(),
    documentId: text("document_id").notNull(),
    conversionId: text("conversion_id").notNull(),
    sourceAssetId: text("source_asset_id").notNull(),
    markdownAssetId: text("markdown_asset_id").notNull(),
    markdownSha256: varchar("markdown_sha256", { length: 64 }).notNull(),
    sequence: integer().notNull(),
    maxContentCharacters: integer("max_content_characters").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.creativeBriefRevisionId, table.sourceAssetId] }),
    uniqueIndex("creative_brief_document_contexts_workspace_id_key").on(table.workspaceId, table.creativeBriefRevisionId, table.sourceAssetId),
    uniqueIndex("creative_brief_document_contexts_brief_conversion_key").on(table.creativeBriefRevisionId, table.conversionId),
    uniqueIndex("creative_brief_document_contexts_brief_sequence_key").on(table.creativeBriefRevisionId, table.sequence),
    index("creative_brief_document_contexts_workspace_project_idx").on(table.workspaceId, table.projectId, table.creativeBriefRevisionId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "creative_brief_document_contexts_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.creativeBriefRevisionId],
      foreignColumns: [creativeBriefRevisions.workspaceId, creativeBriefRevisions.projectId, creativeBriefRevisions.id],
      name: "creative_brief_document_contexts_workspace_project_brief_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.documentId],
      foreignColumns: [documents.workspaceId, documents.projectId, documents.id],
      name: "creative_brief_document_contexts_workspace_project_document_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.conversionId],
      foreignColumns: [documentConversions.workspaceId, documentConversions.projectId, documentConversions.id],
      name: "creative_brief_document_contexts_workspace_project_conversion_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sourceAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "creative_brief_document_contexts_workspace_project_source_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.markdownAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "creative_brief_document_contexts_workspace_project_markdown_asset_fk",
    }).onDelete("restrict"),
    check("creative_brief_document_contexts_markdown_sha256_check", sql.raw("\"markdown_sha256\" ~ '^[a-f0-9]{64}$'")),
    check("creative_brief_document_contexts_sequence_positive_check", sql.raw("\"sequence\" > 0")),
    check("creative_brief_document_contexts_max_characters_check", sql.raw("\"max_content_characters\" between 1 and 5000")),
  ],
);

export const documentKnowledgeRevisions = pgTable(
  "document_knowledge_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    conversionId: text("conversion_id").notNull(),
    markdownAssetId: text("markdown_asset_id").notNull(),
    markdownSha256: varchar("markdown_sha256", { length: 64 }).notNull(),
    analyzerVersion: varchar("analyzer_version", { length: 160 }).notNull(),
    status: documentKnowledgeRevisionStatus().default("CREATED").notNull(),
    retryable: boolean().default(false).notNull(),
    analysisQuality: documentKnowledgeAnalysisQuality("analysis_quality"),
    sectionCount: integer("section_count").default(0).notNull(),
    factCount: integer("fact_count").default(0).notNull(),
    error: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("document_knowledge_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("document_knowledge_revisions_conversion_fingerprint_key").on(table.workspaceId, table.projectId, table.conversionId, table.markdownSha256, table.analyzerVersion),
    index("document_knowledge_revisions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({ columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id], name: "document_knowledge_revisions_workspace_project_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.documentId], foreignColumns: [documents.workspaceId, documents.projectId, documents.id], name: "document_knowledge_revisions_workspace_project_document_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.conversionId], foreignColumns: [documentConversions.workspaceId, documentConversions.projectId, documentConversions.id], name: "document_knowledge_revisions_workspace_project_conversion_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.markdownAssetId], foreignColumns: [assets.workspaceId, assets.projectId, assets.id], name: "document_knowledge_revisions_workspace_project_markdown_asset_fk" }).onDelete("restrict"),
    check("document_knowledge_revisions_markdown_sha256_check", sql`${table.markdownSha256} ~ '^[a-f0-9]{64}$'`),
    check("document_knowledge_revisions_counts_nonnegative_check", sql`${table.sectionCount} >= 0 and ${table.factCount} >= 0`),
    check("document_knowledge_revisions_ready_quality_check", sql`(${table.status} = 'READY' and ${table.analysisQuality} is not null) or (${table.status} <> 'READY')`),
  ],
);

export const documentKnowledgeSections = pgTable(
  "document_knowledge_sections",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    knowledgeRevisionId: text("knowledge_revision_id").notNull(),
    sequence: integer().notNull(),
    heading: varchar({ length: 240 }).notNull(),
    locator: varchar({ length: 240 }).notNull(),
    evidenceKind: documentKnowledgeEvidenceKind("evidence_kind").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("document_knowledge_sections_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("document_knowledge_sections_revision_sequence_key").on(table.knowledgeRevisionId, table.sequence),
    index("document_knowledge_sections_workspace_project_revision_idx").on(table.workspaceId, table.projectId, table.knowledgeRevisionId),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.knowledgeRevisionId], foreignColumns: [documentKnowledgeRevisions.workspaceId, documentKnowledgeRevisions.projectId, documentKnowledgeRevisions.id], name: "document_knowledge_sections_workspace_project_revision_fk" }).onDelete("cascade"),
    check("document_knowledge_sections_sequence_positive_check", sql`${table.sequence} > 0`),
    check("document_knowledge_sections_content_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const documentFacts = pgTable(
  "document_facts",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    knowledgeRevisionId: text("knowledge_revision_id").notNull(),
    sectionId: text("section_id").notNull(),
    category: documentFactCategory().notNull(),
    statement: varchar({ length: 500 }).notNull(),
    confidence: documentFactConfidence().notNull(),
    statementHash: varchar("statement_hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("document_facts_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("document_facts_revision_statement_key").on(table.knowledgeRevisionId, table.statementHash, table.sectionId),
    index("document_facts_workspace_project_revision_idx").on(table.workspaceId, table.projectId, table.knowledgeRevisionId),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.knowledgeRevisionId], foreignColumns: [documentKnowledgeRevisions.workspaceId, documentKnowledgeRevisions.projectId, documentKnowledgeRevisions.id], name: "document_facts_workspace_project_revision_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.sectionId], foreignColumns: [documentKnowledgeSections.workspaceId, documentKnowledgeSections.projectId, documentKnowledgeSections.id], name: "document_facts_workspace_project_section_fk" }).onDelete("cascade"),
    check("document_facts_statement_nonempty_check", sql`length(trim(${table.statement})) > 0`),
    check("document_facts_statement_hash_check", sql`${table.statementHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

// Immutable, brief-scoped snapshots of selected document facts.  The copied
// statement/source fields make historical planning reproducible even when a
// later knowledge revision is created for the same conversion.
export const creativeBriefFactContexts = pgTable(
  "creative_brief_fact_contexts",
  {
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    creativeBriefRevisionId: text("creative_brief_revision_id").notNull(),
    knowledgeRevisionId: text("knowledge_revision_id").notNull(),
    factId: text("fact_id").notNull(),
    sequence: integer().notNull(),
    category: documentFactCategory().notNull(),
    statement: varchar({ length: 500 }).notNull(),
    confidence: documentFactConfidence().notNull(),
    documentId: text("document_id").notNull(),
    conversionId: text("conversion_id").notNull(),
    sectionSequence: integer("section_sequence").notNull(),
    locator: varchar({ length: 240 }).notNull(),
    selectionReason: varchar("selection_reason", { length: 240 }).notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.creativeBriefRevisionId, table.factId] }),
    uniqueIndex("creative_brief_fact_contexts_workspace_project_id_key").on(table.workspaceId, table.projectId, table.creativeBriefRevisionId, table.factId),
    uniqueIndex("creative_brief_fact_contexts_brief_sequence_key").on(table.creativeBriefRevisionId, table.sequence),
    index("creative_brief_fact_contexts_workspace_project_brief_idx").on(table.workspaceId, table.projectId, table.creativeBriefRevisionId),
    foreignKey({ columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id], name: "creative_brief_fact_contexts_workspace_project_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.creativeBriefRevisionId], foreignColumns: [creativeBriefRevisions.workspaceId, creativeBriefRevisions.projectId, creativeBriefRevisions.id], name: "creative_brief_fact_contexts_workspace_project_brief_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.knowledgeRevisionId], foreignColumns: [documentKnowledgeRevisions.workspaceId, documentKnowledgeRevisions.projectId, documentKnowledgeRevisions.id], name: "creative_brief_fact_contexts_workspace_project_revision_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.factId], foreignColumns: [documentFacts.workspaceId, documentFacts.projectId, documentFacts.id], name: "creative_brief_fact_contexts_workspace_project_fact_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.documentId], foreignColumns: [documents.workspaceId, documents.projectId, documents.id], name: "creative_brief_fact_contexts_workspace_project_document_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.workspaceId, table.projectId, table.conversionId], foreignColumns: [documentConversions.workspaceId, documentConversions.projectId, documentConversions.id], name: "creative_brief_fact_contexts_workspace_project_conversion_fk" }).onDelete("restrict"),
    check("creative_brief_fact_contexts_sequence_positive_check", sql`${table.sequence} between 1 and 24`),
    check("creative_brief_fact_contexts_section_sequence_positive_check", sql`${table.sectionSequence} > 0`),
    check("creative_brief_fact_contexts_statement_nonempty_check", sql`length(trim(${table.statement})) > 0`),
    check("creative_brief_fact_contexts_snapshot_hash_check", sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const deliveryPlanRevisions = pgTable(
  "delivery_plan_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    creativeBriefRevisionId: text("creative_brief_revision_id").notNull(),
    storyboardRevisionId: text("storyboard_revision_id").notNull(),
    revision: integer().notNull(),
    status: preflightRevisionStatus().default("DRAFT").notNull(),
    durationPolicy: durationPolicy("duration_policy").$type<DurationPolicy>().default("FLEXIBLE").notNull(),
    flexibleDurationPercent: integer("flexible_duration_percent").default(20).notNull(),
    targetDurationSeconds: integer("target_duration_seconds").notNull(),
    requiresSampleApproval: boolean("requires_sample_approval").default(true).notNull(),
    captionPolicy: captionPolicy("caption_policy").$type<CaptionPolicy>().default("REQUIRED").notNull(),
    lipSyncRequirement: lipSyncRequirement("lip_sync_requirement").$type<LipSyncRequirement>().default("OFF").notNull(),
    voiceMode: voiceMode("voice_mode").$type<VoiceMode>().default("PLATFORM_GENERIC").notNull(),
    safeSummary: text("safe_summary").notNull(),
    blockReasons: jsonb("block_reasons").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    consumedByProductionRunId: text("consumed_by_production_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("delivery_plan_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("delivery_plan_revisions_project_revision_key").on(table.projectId, table.revision),
    index("delivery_plan_revisions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "delivery_plan_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.creativeBriefRevisionId],
      foreignColumns: [creativeBriefRevisions.workspaceId, creativeBriefRevisions.projectId, creativeBriefRevisions.id],
      name: "delivery_plan_revisions_workspace_project_brief_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.storyboardRevisionId],
      foreignColumns: [storyboardRevisions.workspaceId, storyboardRevisions.projectId, storyboardRevisions.id],
      name: "delivery_plan_revisions_workspace_project_storyboard_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.consumedByProductionRunId],
      foreignColumns: [productionRuns.workspaceId, productionRuns.projectId, productionRuns.id],
      name: "delivery_plan_revisions_workspace_project_consumed_run_fk",
    }).onDelete("restrict"),
    check("delivery_plan_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("delivery_plan_revisions_target_duration_check", sql`${table.targetDurationSeconds} between 1 and 600`),
    check("delivery_plan_revisions_flexible_duration_check", sql`${table.flexibleDurationPercent} between 0 and 50`),
    check("delivery_plan_revisions_exact_duration_check", sql`${table.durationPolicy} <> 'EXACT' or ${table.flexibleDurationPercent} = 0`),
    check("delivery_plan_revisions_block_reason_check", sql`${table.status} <> 'PREFLIGHT_BLOCKED' or jsonb_array_length(${table.blockReasons}) > 0`),
    check("delivery_plan_revisions_approval_check", sql`${table.status} not in ('APPROVED', 'CONSUMED') or ${table.approvedAt} is not null`),
  ],
);

export const voiceAuthorizations = pgTable(
  "voice_authorizations",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    sourceAssetId: text("source_asset_id"),
    consentEvidenceAssetId: text("consent_evidence_asset_id"),
    subjectName: varchar("subject_name", { length: 160 }).notNull(),
    allowedUses: jsonb("allowed_uses").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    status: voiceAuthorizationStatus().$type<VoiceAuthorizationStatus>().default("PENDING").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    safeSummary: text("safe_summary").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("voice_authorizations_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("voice_authorizations_workspace_project_status_idx").on(table.workspaceId, table.projectId, table.status),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "voice_authorizations_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sourceAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "voice_authorizations_workspace_project_source_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.consentEvidenceAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "voice_authorizations_workspace_project_consent_asset_fk",
    }).onDelete("restrict"),
    check("voice_authorizations_subject_nonempty_check", sql`length(trim(${table.subjectName})) > 0`),
    check("voice_authorizations_allowed_uses_nonempty_check", sql`jsonb_array_length(${table.allowedUses}) > 0`),
  ],
);

export const pronunciationGlossaryRevisions = pgTable(
  "pronunciation_glossary_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    revision: integer().notNull(),
    status: policyRevisionStatus().$type<PolicyRevisionStatus>().default("DRAFT").notNull(),
    entries: jsonb().$type<Record<string, unknown>[]>().default(sql`'[]'::jsonb`).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("pronunciation_glossary_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("pronunciation_glossary_revisions_project_revision_key").on(table.projectId, table.revision),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "pronunciation_glossary_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    check("pronunciation_glossary_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("pronunciation_glossary_revisions_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const brandPolicyRevisions = pgTable(
  "brand_policy_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    revision: integer().notNull(),
    status: policyRevisionStatus().$type<PolicyRevisionStatus>().default("DRAFT").notNull(),
    approvedNames: jsonb("approved_names").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    approvedLogoAssetIds: jsonb("approved_logo_asset_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    forbiddenIdentifiers: jsonb("forbidden_identifiers").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    claimsPolicy: text("claims_policy").default("").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("brand_policy_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("brand_policy_revisions_project_revision_key").on(table.projectId, table.revision),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "brand_policy_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    check("brand_policy_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("brand_policy_revisions_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const narrationPlanRevisions = pgTable(
  "narration_plan_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    deliveryPlanRevisionId: text("delivery_plan_revision_id").notNull(),
    revision: integer().notNull(),
    status: preflightRevisionStatus().default("DRAFT").notNull(),
    voiceMode: voiceMode("voice_mode").$type<VoiceMode>().default("PLATFORM_GENERIC").notNull(),
    voiceAuthorizationId: text("voice_authorization_id"),
    pronunciationGlossaryRevisionId: text("pronunciation_glossary_revision_id"),
    requiresSampleApproval: boolean("requires_sample_approval").default(true).notNull(),
    sampleAssetId: text("sample_asset_id"),
    canonicalScriptHash: varchar("canonical_script_hash", { length: 64 }),
    safeSummary: text("safe_summary").notNull(),
    blockReasons: jsonb("block_reasons").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("narration_plan_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("narration_plan_revisions_delivery_revision_key").on(table.deliveryPlanRevisionId, table.revision),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "narration_plan_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.deliveryPlanRevisionId],
      foreignColumns: [deliveryPlanRevisions.workspaceId, deliveryPlanRevisions.projectId, deliveryPlanRevisions.id],
      name: "narration_plan_revisions_workspace_project_delivery_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.voiceAuthorizationId],
      foreignColumns: [voiceAuthorizations.workspaceId, voiceAuthorizations.projectId, voiceAuthorizations.id],
      name: "narration_plan_revisions_workspace_project_voice_auth_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.pronunciationGlossaryRevisionId],
      foreignColumns: [pronunciationGlossaryRevisions.workspaceId, pronunciationGlossaryRevisions.projectId, pronunciationGlossaryRevisions.id],
      name: "narration_plan_revisions_workspace_project_glossary_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sampleAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "narration_plan_revisions_workspace_project_sample_asset_fk",
    }).onDelete("restrict"),
    check("narration_plan_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("narration_plan_revisions_voice_auth_check", sql`${table.voiceMode} = 'PLATFORM_GENERIC' or ${table.voiceAuthorizationId} is not null`),
    check("narration_plan_revisions_sample_approval_check", sql`${table.status} <> 'APPROVED' or ${table.requiresSampleApproval} = false or ${table.sampleAssetId} is not null`),
    check("narration_plan_revisions_script_hash_check", sql`${table.canonicalScriptHash} is null or ${table.canonicalScriptHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const narrationScriptRevisions = pgTable(
  "narration_script_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    deliveryPlanRevisionId: text("delivery_plan_revision_id").notNull(),
    status: varchar({ length: 32 }).notNull(),
    sourceScriptHash: varchar("source_script_hash", { length: 64 }).notNull(),
    displaySections: jsonb("display_sections").$type<Record<string, unknown>[]>().notNull(),
    spokenSections: jsonb("spoken_sections").$type<Record<string, unknown>[]>().notNull(),
    language: varchar({ length: 16 }).default("zh-CN").notNull(),
    normalizationVersion: varchar("normalization_version", { length: 80 }).notNull(),
    decisionReasons: jsonb("decision_reasons").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("narration_script_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("narration_script_revisions_delivery_revision_key").on(table.deliveryPlanRevisionId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "narration_script_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.deliveryPlanRevisionId],
      foreignColumns: [deliveryPlanRevisions.workspaceId, deliveryPlanRevisions.projectId, deliveryPlanRevisions.id],
      name: "narration_script_revisions_workspace_project_delivery_fk",
    }).onDelete("restrict"),
    check("narration_script_revisions_status_check", sql`${table.status} in ('DRAFT', 'NORMALIZED', 'NEEDS_DECISION', 'APPROVED', 'REJECTED')`),
    check("narration_script_revisions_hash_check", sql`${table.sourceScriptHash} ~ '^[a-f0-9]{64}$'`),
    check("narration_script_revisions_language_check", sql`${table.language} = 'zh-CN'`),
  ],
);

export const narrationAssetVersions = pgTable(
  "narration_asset_versions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    narrationScriptRevisionId: text("narration_script_revision_id").notNull(),
    assetId: text("asset_id").notNull(),
    provider: varchar({ length: 80 }).notNull(),
    voiceId: varchar("voice_id", { length: 160 }).notNull(),
    providerSettings: jsonb("provider_settings").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    durationMs: integer("duration_ms").notNull(),
    sampleApproved: boolean("sample_approved").default(false).notNull(),
    wordTimestampsAssetId: text("word_timestamps_asset_id"),
    canonicalTranscriptCheck: jsonb("canonical_transcript_check").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("narration_asset_versions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("narration_asset_versions_script_asset_key").on(table.narrationScriptRevisionId, table.assetId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "narration_asset_versions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.narrationScriptRevisionId],
      foreignColumns: [narrationScriptRevisions.workspaceId, narrationScriptRevisions.projectId, narrationScriptRevisions.id],
      name: "narration_asset_versions_workspace_project_script_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.assetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "narration_asset_versions_workspace_project_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.wordTimestampsAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "narration_asset_versions_workspace_project_timestamps_asset_fk",
    }).onDelete("restrict"),
    check("narration_asset_versions_duration_check", sql`${table.durationMs} > 0`),
  ],
);

export const timelinePlans = pgTable(
  "timeline_plans",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    deliveryPlanRevisionId: text("delivery_plan_revision_id").notNull(),
    narrationScriptRevisionId: text("narration_script_revision_id").notNull(),
    narrationAssetVersionId: text("narration_asset_version_id"),
    effectiveDurationMs: integer("effective_duration_ms").notNull(),
    narrationSections: jsonb("narration_sections").$type<Record<string, unknown>[]>().notNull(),
    visualSegments: jsonb("visual_segments").$type<Record<string, unknown>[]>().notNull(),
    status: varchar({ length: 32 }).notNull(),
    decisionReasons: jsonb("decision_reasons").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("timeline_plans_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("timeline_plans_script_revision_key").on(table.narrationScriptRevisionId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "timeline_plans_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.deliveryPlanRevisionId],
      foreignColumns: [deliveryPlanRevisions.workspaceId, deliveryPlanRevisions.projectId, deliveryPlanRevisions.id],
      name: "timeline_plans_workspace_project_delivery_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.narrationScriptRevisionId],
      foreignColumns: [narrationScriptRevisions.workspaceId, narrationScriptRevisions.projectId, narrationScriptRevisions.id],
      name: "timeline_plans_workspace_project_script_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.narrationAssetVersionId],
      foreignColumns: [narrationAssetVersions.workspaceId, narrationAssetVersions.projectId, narrationAssetVersions.id],
      name: "timeline_plans_workspace_project_asset_version_fk",
    }).onDelete("restrict"),
    check("timeline_plans_status_check", sql`${table.status} in ('DRAFT', 'READY', 'NEEDS_DECISION', 'FAILED')`),
    check("timeline_plans_duration_check", sql`${table.effectiveDurationMs} > 0`),
  ],
);

export const capabilityProfileRevisions = pgTable(
  "capability_profile_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    providerFamily: varchar("provider_family", { length: 64 }).notNull(),
    modelOrTool: varchar("model_or_tool", { length: 160 }).notNull(),
    status: capabilityProfileStatus().$type<CapabilityProfileStatus>().default("DISABLED").notNull(),
    features: jsonb().$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    certificationFixtureVersion: varchar("certification_fixture_version", { length: 160 }).notNull(),
    safeSummary: text("safe_summary").notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("capability_profile_revisions_workspace_model_key").on(table.workspaceId, table.projectId, table.providerFamily, table.modelOrTool, table.certificationFixtureVersion),
    index("capability_profile_revisions_workspace_status_idx").on(table.workspaceId, table.status),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "capability_profile_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    check("capability_profile_revisions_provider_family_check", sql`${table.providerFamily} in ('LOCAL', 'SUB2API', 'SEEDANCE', 'OPENMONTAGE', 'OTHER')`),
    check("capability_profile_revisions_safe_summary_nonempty_check", sql`length(trim(${table.safeSummary})) > 0`),
  ],
);

export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    deliveryPlanRevisionId: text("delivery_plan_revision_id").notNull(),
    status: budgetReservationStatus().$type<BudgetReservationStatus>().default("ESTIMATED").notNull(),
    estimatedAmount: numeric("estimated_amount", { precision: 18, scale: 8 }).notNull(),
    approvedLimit: numeric("approved_limit", { precision: 18, scale: 8 }).notNull(),
    currency: varchar({ length: 16 }).default("CREDIT").notNull(),
    reason: text().default("").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("budget_reservations_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("budget_reservations_delivery_plan_key").on(table.deliveryPlanRevisionId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "budget_reservations_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.deliveryPlanRevisionId],
      foreignColumns: [deliveryPlanRevisions.workspaceId, deliveryPlanRevisions.projectId, deliveryPlanRevisions.id],
      name: "budget_reservations_workspace_project_delivery_fk",
    }).onDelete("cascade"),
    check("budget_reservations_amount_nonnegative_check", sql`${table.estimatedAmount} >= 0 and ${table.approvedLimit} >= 0`),
    check("budget_reservations_limit_check", sql`${table.status} <> 'APPROVED' or ${table.estimatedAmount} <= ${table.approvedLimit}`),
  ],
);

export const creativeDecisionLogs = pgTable(
  "creative_decision_logs",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    actorUserId: text("actor_user_id"),
    decisionType: varchar("decision_type", { length: 80 }).notNull(),
    sourceRevisionType: varchar("source_revision_type", { length: 80 }).notNull(),
    sourceRevisionId: varchar("source_revision_id", { length: 160 }).notNull(),
    safeSummary: text("safe_summary").notNull(),
    metadata: jsonObject(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("creative_decision_logs_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("creative_decision_logs_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "creative_decision_logs_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "creative_decision_logs_actor_user_fk",
    }).onDelete("set null"),
    check("creative_decision_logs_safe_summary_nonempty_check", sql`length(trim(${table.safeSummary})) > 0`),
  ],
);

export const outputProfileRevisions = pgTable(
  "output_profile_revisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    deliveryPlanRevisionId: text("delivery_plan_revision_id").notNull(),
    revision: integer().notNull(),
    status: policyRevisionStatus().$type<PolicyRevisionStatus>().default("DRAFT").notNull(),
    variants: jsonb().$type<Record<string, unknown>[]>().default(sql`'[]'::jsonb`).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("output_profile_revisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("output_profile_revisions_delivery_revision_key").on(table.deliveryPlanRevisionId, table.revision),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "output_profile_revisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.deliveryPlanRevisionId],
      foreignColumns: [deliveryPlanRevisions.workspaceId, deliveryPlanRevisions.projectId, deliveryPlanRevisions.id],
      name: "output_profile_revisions_workspace_project_delivery_fk",
    }).onDelete("cascade"),
    check("output_profile_revisions_revision_positive_check", sql`${table.revision} > 0`),
    check("output_profile_revisions_variants_nonempty_check", sql`jsonb_array_length(${table.variants}) > 0`),
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
    uniqueIndex("task_runs_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
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
    creditProvider: varchar("credit_provider", { length: 64 }).notNull(),
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
    uniqueIndex("usage_records_credit_provider_idempotency_key_key").on(table.creditProvider, table.idempotencyKey),
    index("usage_records_workspace_task_run_idx").on(table.workspaceId, table.taskRunId),
    foreignKey({
      columns: [table.workspaceId, table.taskRunId],
      foreignColumns: [taskRuns.workspaceId, taskRuns.id],
      name: "usage_records_workspace_task_run_fk",
    }).onDelete("restrict"),
  ],
);

// C12 stores deterministic QC outcomes separately from media bytes and provider responses.
export const qcReports = pgTable(
  "qc_reports",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    subjectType: qcSubjectType("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    kind: qcKind().notNull(),
    status: qcStatus().notNull(),
    safeSummary: text("safe_summary").notNull(),
    details: jsonObject(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("qc_reports_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("qc_reports_workspace_project_subject_idx").on(table.workspaceId, table.projectId, table.subjectType, table.subjectId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "qc_reports_workspace_project_fk",
    }).onDelete("cascade"),
    check("qc_reports_safe_summary_nonempty_check", sql`length(trim(${table.safeSummary})) > 0`),
  ],
);

// A handoff frame is a derived Asset. This table records its source video and QC proof without duplicating object keys.
export const assetDerivations = pgTable(
  "asset_derivations",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    derivationType: assetDerivationType("derivation_type").notNull(),
    sourceAssetId: text("source_asset_id").notNull(),
    sourceTaskRunId: text("source_task_run_id").notNull(),
    derivedAssetId: text("derived_asset_id").notNull(),
    qcReportId: text("qc_report_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("asset_derivations_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("asset_derivations_derived_asset_key").on(table.derivedAssetId),
    index("asset_derivations_workspace_project_source_idx").on(table.workspaceId, table.projectId, table.sourceAssetId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "asset_derivations_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sourceAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "asset_derivations_workspace_project_source_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.sourceTaskRunId],
      foreignColumns: [taskRuns.workspaceId, taskRuns.projectId, taskRuns.id],
      name: "asset_derivations_workspace_project_source_task_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.derivedAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "asset_derivations_workspace_project_derived_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.qcReportId],
      foreignColumns: [qcReports.workspaceId, qcReports.projectId, qcReports.id],
      name: "asset_derivations_workspace_project_qc_report_fk",
    }).onDelete("restrict"),
  ],
);

export const productionSegments = pgTable(
  "production_segments",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    productionRunId: text("production_run_id").notNull(),
    shotSpecId: text("shot_spec_id").notNull(),
    sequence: integer().notNull(),
    title: varchar({ length: 160 }).notNull(),
    dependsOnSequences: jsonb("depends_on_sequences").$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
    status: productionSegmentStatus().default("PENDING").notNull(),
    retryable: boolean().default(true).notNull(),
    safeSummary: text("safe_summary").notNull(),
    shotId: text("shot_id"),
    taskRunId: text("task_run_id"),
    handoffAssetId: text("handoff_asset_id"),
    qcReportId: text("qc_report_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("production_segments_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("production_segments_run_sequence_key").on(table.productionRunId, table.sequence),
    index("production_segments_workspace_run_sequence_idx").on(table.workspaceId, table.productionRunId, table.sequence),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "production_segments_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.productionRunId],
      foreignColumns: [productionRuns.workspaceId, productionRuns.projectId, productionRuns.id],
      name: "production_segments_workspace_project_production_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.shotSpecId],
      foreignColumns: [storyboardShotSpecs.workspaceId, storyboardShotSpecs.projectId, storyboardShotSpecs.id],
      name: "production_segments_workspace_project_shot_spec_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.shotId],
      foreignColumns: [shots.workspaceId, shots.projectId, shots.id],
      name: "production_segments_workspace_project_shot_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.taskRunId],
      foreignColumns: [taskRuns.workspaceId, taskRuns.projectId, taskRuns.id],
      name: "production_segments_workspace_project_task_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.handoffAssetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "production_segments_workspace_project_handoff_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.qcReportId],
      foreignColumns: [qcReports.workspaceId, qcReports.projectId, qcReports.id],
      name: "production_segments_workspace_project_qc_report_fk",
    }).onDelete("restrict"),
    check("production_segments_sequence_positive_check", sql`${table.sequence} > 0`),
    check("production_segments_title_nonempty_check", sql`length(trim(${table.title})) > 0`),
    check("production_segments_safe_summary_nonempty_check", sql`length(trim(${table.safeSummary})) > 0`),
  ],
);

export const handoffReviews = pgTable(
  "handoff_reviews",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    productionRunId: text("production_run_id").notNull(),
    fromSequence: integer("from_sequence").notNull(),
    toSequence: integer("to_sequence").notNull(),
    result: handoffReviewResult().notNull(),
    reasonCodes: jsonb("reason_codes").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    safeSummary: text("safe_summary").notNull(),
    evaluatorVersion: varchar("evaluator_version", { length: 128 }).notNull(),
    retryable: boolean().default(false).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("handoff_reviews_workspace_run_boundary_key").on(table.workspaceId, table.productionRunId, table.fromSequence, table.toSequence),
    index("handoff_reviews_workspace_project_run_idx").on(table.workspaceId, table.projectId, table.productionRunId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "handoff_reviews_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.productionRunId],
      foreignColumns: [productionRuns.workspaceId, productionRuns.projectId, productionRuns.id],
      name: "handoff_reviews_workspace_project_run_fk",
    }).onDelete("cascade"),
    check("handoff_reviews_adjacent_boundary_check", sql`${table.toSequence} = ${table.fromSequence} + 1`),
    check("handoff_reviews_safe_summary_nonempty_check", sql`length(trim(${table.safeSummary})) > 0`),
  ],
);

export const transitionRepairs = pgTable(
  "transition_repairs",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    productionRunId: text("production_run_id").notNull(),
    boundarySequence: integer("boundary_sequence").notNull(),
    strategy: transitionRepairStrategy().notNull(),
    status: transitionRepairStatus().notNull(),
    taskRunId: text("task_run_id"),
    assetId: text("asset_id"),
    durationMs: integer("duration_ms").notNull(),
    attemptCount: integer("attempt_count").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("transition_repairs_workspace_run_boundary_key").on(table.workspaceId, table.productionRunId, table.boundarySequence),
    index("transition_repairs_workspace_project_run_idx").on(table.workspaceId, table.projectId, table.productionRunId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "transition_repairs_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.productionRunId],
      foreignColumns: [productionRuns.workspaceId, productionRuns.projectId, productionRuns.id],
      name: "transition_repairs_workspace_project_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.taskRunId],
      foreignColumns: [taskRuns.workspaceId, taskRuns.projectId, taskRuns.id],
      name: "transition_repairs_workspace_project_task_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.assetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "transition_repairs_workspace_project_asset_fk",
    }).onDelete("restrict"),
    check("transition_repairs_boundary_positive_check", sql`${table.boundarySequence} > 0`),
    check("transition_repairs_duration_bounds_check", sql`${table.durationMs} >= 0 and ${table.durationMs} <= 3000`),
    check("transition_repairs_attempt_count_check", sql`${table.attemptCount} >= 1 and ${table.attemptCount} <= 1`),
  ],
);

export const videoVersions = pgTable(
  "video_versions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    productionRunId: text("production_run_id").notNull(),
    storyboardRevisionId: text("storyboard_revision_id").notNull(),
    status: videoVersionStatus().notNull(),
    assetId: text("asset_id"),
    durationMs: integer("duration_ms"),
    qcReportId: text("qc_report_id"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("video_versions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    index("video_versions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "video_versions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.productionRunId],
      foreignColumns: [productionRuns.workspaceId, productionRuns.projectId, productionRuns.id],
      name: "video_versions_workspace_project_production_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.storyboardRevisionId],
      foreignColumns: [storyboardRevisions.workspaceId, storyboardRevisions.projectId, storyboardRevisions.id],
      name: "video_versions_workspace_project_storyboard_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.assetId],
      foreignColumns: [assets.workspaceId, assets.projectId, assets.id],
      name: "video_versions_workspace_project_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.qcReportId],
      foreignColumns: [qcReports.workspaceId, qcReports.projectId, qcReports.id],
      name: "video_versions_workspace_project_qc_report_fk",
    }).onDelete("restrict"),
    check(
      "video_versions_success_payload_check",
      sql`(${table.status} = 'SUCCEEDED' and ${table.assetId} is not null and ${table.durationMs} is not null and ${table.qcReportId} is not null) or (${table.status} = 'FAILED' and ${table.assetId} is null and ${table.durationMs} is null and ${table.qcReportId} is null)`,
    ),
    check("video_versions_duration_positive_check", sql`${table.durationMs} is null or ${table.durationMs} > 0`),
  ],
);

export const qualityGateDecisions = pgTable(
  "quality_gate_decisions",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    videoVersionId: text("video_version_id").notNull(),
    checks: jsonb().$type<Record<string, unknown>[]>().default(sql`'[]'::jsonb`).notNull(),
    finalAction: qualityGateAction("final_action").$type<QualityGateAction>().notNull(),
    decidedBy: qualityGateActor("decided_by").notNull(),
    safeSummary: text("safe_summary").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("quality_gate_decisions_workspace_project_id_key").on(table.workspaceId, table.projectId, table.id),
    uniqueIndex("quality_gate_decisions_video_version_key").on(table.videoVersionId),
    index("quality_gate_decisions_workspace_project_created_at_idx").on(table.workspaceId, table.projectId, table.createdAt),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "quality_gate_decisions_workspace_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.videoVersionId],
      foreignColumns: [videoVersions.workspaceId, videoVersions.projectId, videoVersions.id],
      name: "quality_gate_decisions_workspace_project_video_version_fk",
    }).onDelete("restrict"),
    check("quality_gate_decisions_safe_summary_nonempty_check", sql`length(trim(${table.safeSummary})) > 0`),
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
    availableAt: timestamp("available_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "string" }),
    lastError: text("last_error"),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("outbox_events_pending_idx").on(table.publishedAt, table.deadLetteredAt, table.availableAt),
    index("outbox_events_workspace_occurred_at_idx").on(table.workspaceId, table.occurredAt),
    // This composite key lets dependent ledgers prove their event scope in PostgreSQL.
    uniqueIndex("outbox_events_id_workspace_key").on(table.id, table.workspaceId),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "outbox_events_workspace_project_fk",
    }).onDelete("cascade"),
  ],
);

export const eventConsumptions = pgTable(
  "event_consumptions",
  {
    workspaceId: text("workspace_id").notNull(),
    eventId: text("event_id").notNull(),
    consumerName: varchar("consumer_name", { length: 128 }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "string" }),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.eventId, table.consumerName] }),
    index("event_consumptions_recoverable_idx").on(table.workspaceId, table.consumerName, table.completedAt, table.deadLetteredAt, table.leaseExpiresAt),
    foreignKey({
      columns: [table.eventId, table.workspaceId],
      foreignColumns: [outboxEvents.id, outboxEvents.workspaceId],
      name: "event_consumptions_event_workspace_outbox_fk",
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
