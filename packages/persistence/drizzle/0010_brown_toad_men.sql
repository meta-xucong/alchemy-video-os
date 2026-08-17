CREATE TYPE "public"."asset_derivation_type" AS ENUM('HANDOFF_FRAME');--> statement-breakpoint
CREATE TYPE "public"."production_segment_status" AS ENUM('PENDING', 'WAITING', 'GENERATING', 'CHECKING', 'ACCEPTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."qc_kind" AS ENUM('TECHNICAL', 'COMPOSITION');--> statement-breakpoint
CREATE TYPE "public"."qc_status" AS ENUM('PASS', 'NEEDS_ATTENTION', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."qc_subject_type" AS ENUM('PRODUCTION_SEGMENT', 'VIDEO_VERSION');--> statement-breakpoint
CREATE TYPE "public"."video_version_status" AS ENUM('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "asset_derivations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"derivation_type" "asset_derivation_type" NOT NULL,
	"source_asset_id" text NOT NULL,
	"source_task_run_id" text NOT NULL,
	"derived_asset_id" text NOT NULL,
	"qc_report_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"production_run_id" text NOT NULL,
	"shot_spec_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"depends_on_sequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "production_segment_status" DEFAULT 'PENDING' NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL,
	"safe_summary" text NOT NULL,
	"shot_id" text,
	"task_run_id" text,
	"handoff_asset_id" text,
	"qc_report_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_segments_sequence_positive_check" CHECK ("production_segments"."sequence" > 0),
	CONSTRAINT "production_segments_title_nonempty_check" CHECK (length(trim("production_segments"."title")) > 0),
	CONSTRAINT "production_segments_safe_summary_nonempty_check" CHECK (length(trim("production_segments"."safe_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "qc_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"subject_type" "qc_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"kind" "qc_kind" NOT NULL,
	"status" "qc_status" NOT NULL,
	"safe_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qc_reports_safe_summary_nonempty_check" CHECK (length(trim("qc_reports"."safe_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "video_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"production_run_id" text NOT NULL,
	"storyboard_revision_id" text NOT NULL,
	"status" "video_version_status" NOT NULL,
	"asset_id" text,
	"duration_ms" integer,
	"qc_report_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_versions_success_payload_check" CHECK (("video_versions"."status" = 'SUCCEEDED' and "video_versions"."asset_id" is not null and "video_versions"."duration_ms" is not null and "video_versions"."qc_report_id" is not null) or ("video_versions"."status" = 'FAILED' and "video_versions"."asset_id" is null and "video_versions"."duration_ms" is null and "video_versions"."qc_report_id" is null)),
	CONSTRAINT "video_versions_duration_positive_check" CHECK ("video_versions"."duration_ms" is null or "video_versions"."duration_ms" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "qc_reports_workspace_project_id_key" ON "qc_reports" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_workspace_project_id_key" ON "task_runs" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
ALTER TABLE "asset_derivations" ADD CONSTRAINT "asset_derivations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivations" ADD CONSTRAINT "asset_derivations_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivations" ADD CONSTRAINT "asset_derivations_workspace_project_source_asset_fk" FOREIGN KEY ("workspace_id","project_id","source_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivations" ADD CONSTRAINT "asset_derivations_workspace_project_source_task_run_fk" FOREIGN KEY ("workspace_id","project_id","source_task_run_id") REFERENCES "public"."task_runs"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivations" ADD CONSTRAINT "asset_derivations_workspace_project_derived_asset_fk" FOREIGN KEY ("workspace_id","project_id","derived_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_derivations" ADD CONSTRAINT "asset_derivations_workspace_project_qc_report_fk" FOREIGN KEY ("workspace_id","project_id","qc_report_id") REFERENCES "public"."qc_reports"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_production_run_fk" FOREIGN KEY ("workspace_id","project_id","production_run_id") REFERENCES "public"."production_runs"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_shot_spec_fk" FOREIGN KEY ("workspace_id","project_id","shot_spec_id") REFERENCES "public"."storyboard_shot_specs"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_shot_fk" FOREIGN KEY ("workspace_id","project_id","shot_id") REFERENCES "public"."shots"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_task_run_fk" FOREIGN KEY ("workspace_id","project_id","task_run_id") REFERENCES "public"."task_runs"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_handoff_asset_fk" FOREIGN KEY ("workspace_id","project_id","handoff_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_segments" ADD CONSTRAINT "production_segments_workspace_project_qc_report_fk" FOREIGN KEY ("workspace_id","project_id","qc_report_id") REFERENCES "public"."qc_reports"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reports" ADD CONSTRAINT "qc_reports_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_workspace_project_production_run_fk" FOREIGN KEY ("workspace_id","project_id","production_run_id") REFERENCES "public"."production_runs"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_workspace_project_storyboard_fk" FOREIGN KEY ("workspace_id","project_id","storyboard_revision_id") REFERENCES "public"."storyboard_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_workspace_project_asset_fk" FOREIGN KEY ("workspace_id","project_id","asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_workspace_project_qc_report_fk" FOREIGN KEY ("workspace_id","project_id","qc_report_id") REFERENCES "public"."qc_reports"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_derivations_workspace_project_id_key" ON "asset_derivations" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_derivations_derived_asset_key" ON "asset_derivations" USING btree ("derived_asset_id");--> statement-breakpoint
CREATE INDEX "asset_derivations_workspace_project_source_idx" ON "asset_derivations" USING btree ("workspace_id","project_id","source_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_segments_workspace_project_id_key" ON "production_segments" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_segments_run_sequence_key" ON "production_segments" USING btree ("production_run_id","sequence");--> statement-breakpoint
CREATE INDEX "production_segments_workspace_run_sequence_idx" ON "production_segments" USING btree ("workspace_id","production_run_id","sequence");--> statement-breakpoint
CREATE INDEX "qc_reports_workspace_project_subject_idx" ON "qc_reports" USING btree ("workspace_id","project_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_versions_workspace_project_id_key" ON "video_versions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE INDEX "video_versions_workspace_project_created_at_idx" ON "video_versions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
