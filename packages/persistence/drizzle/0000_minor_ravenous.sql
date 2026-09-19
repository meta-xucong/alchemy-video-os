CREATE TYPE "public"."asset_kind" AS ENUM('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'POSTER', 'THUMBNAIL');--> statement-breakpoint
CREATE TYPE "public"."asset_origin" AS ENUM('USER_UPLOAD', 'GENERATED', 'DERIVED');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('PENDING_UPLOAD', 'READY', 'FAILED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."provider_attempt_status" AS ENUM('CREATED', 'SUBMITTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DOWNLOAD_FAILED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."reference_role" AS ENUM('STYLE', 'SUBJECT', 'FIRST_FRAME', 'LAST_FRAME');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('DRAFT', 'READY', 'GENERATING', 'GENERATED', 'FAILED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."task_run_kind" AS ENUM('VIDEO_GENERATION', 'DOCUMENT_CONVERSION', 'RENDER', 'QC');--> statement-breakpoint
CREATE TYPE "public"."task_run_status" AS ENUM('CREATED', 'QUEUED', 'RUNNING', 'PROVIDER_PROCESSING', 'DOWNLOADING', 'BILLING_PENDING', 'SUCCEEDED', 'BILLING_FAILED', 'FAILED', 'RETRY_SCHEDULED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"origin" "asset_origin" NOT NULL,
	"status" "asset_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"object_key" text NOT NULL,
	"sha256" varchar(64),
	"mime_type" varchar(255),
	"byte_size" bigint,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_object_key_scope_check" CHECK ("assets"."object_key" like "assets"."workspace_id" || '/' || "assets"."project_id" || '/' || "assets"."id" || '/%'),
	CONSTRAINT "assets_sha256_format_check" CHECK ("assets"."sha256" is null or "assets"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "command_deduplications" (
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_deduplications_scope_idempotency_key_pk" PRIMARY KEY("scope","idempotency_key"),
	CONSTRAINT "command_deduplications_request_hash_format_check" CHECK ("command_deduplications"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "project_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_run_id" text NOT NULL,
	"provider" varchar(128) NOT NULL,
	"model" varchar(255) NOT NULL,
	"provider_request_id" text,
	"status" "provider_attempt_status" DEFAULT 'CREATED' NOT NULL,
	"request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_bindings" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"role" "reference_role" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_bindings_shot_id_asset_id_role_pk" PRIMARY KEY("shot_id","asset_id","role"),
	CONSTRAINT "reference_bindings_position_nonnegative_check" CHECK ("reference_bindings"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"position" integer NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"model" varchar(255),
	"generation_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "shot_status" DEFAULT 'DRAFT' NOT NULL,
	"selected_asset_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shots_position_nonnegative_check" CHECK ("shots"."position" >= 0),
	CONSTRAINT "shots_revision_positive_check" CHECK ("shots"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text NOT NULL,
	"kind" "task_run_kind" NOT NULL,
	"status" "task_run_status" DEFAULT 'CREATED' NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result_asset_id" text,
	"error" jsonb,
	"retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_runs_result_asset_success_check" CHECK (("task_runs"."status" = 'SUCCEEDED' and "task_runs"."result_asset_id" is not null) or ("task_runs"."status" <> 'SUCCEEDED' and "task_runs"."result_asset_id" is null))
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_run_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"source" varchar(128) NOT NULL,
	"reference_id" text,
	"idempotency_key" text NOT NULL,
	"balance_after" numeric(18, 8),
	"replayed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_selected_asset_id_assets_id_fk" FOREIGN KEY ("selected_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_result_asset_id_assets_id_fk" FOREIGN KEY ("result_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_object_key_key" ON "assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "assets_workspace_project_created_at_idx" ON "assets" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_workspace_occurred_at_idx" ON "outbox_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "projects_workspace_created_at_idx" ON "projects" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_attempts_workspace_task_run_idx" ON "provider_attempts" USING btree ("workspace_id","task_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempts_provider_request_key" ON "provider_attempts" USING btree ("provider","provider_request_id") WHERE "provider_attempts"."provider_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reference_bindings_shot_role_position_key" ON "reference_bindings" USING btree ("shot_id","role","position");--> statement-breakpoint
CREATE INDEX "reference_bindings_workspace_project_idx" ON "reference_bindings" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_project_position_key" ON "shots" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "shots_workspace_project_idx" ON "shots" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "task_runs_workspace_project_created_at_idx" ON "task_runs" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_one_active_shot_key" ON "task_runs" USING btree ("shot_id") WHERE "task_runs"."status" not in ('SUCCEEDED', 'FAILED', 'ABANDONED');--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_idempotency_key_key" ON "usage_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_records_workspace_task_run_idx" ON "usage_records" USING btree ("workspace_id","task_run_id");