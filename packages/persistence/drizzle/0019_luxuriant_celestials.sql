CREATE TABLE "narration_asset_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"narration_script_revision_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"provider" varchar(80) NOT NULL,
	"voice_id" varchar(160) NOT NULL,
	"provider_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"sample_approved" boolean DEFAULT false NOT NULL,
	"word_timestamps_asset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narration_asset_versions_duration_check" CHECK ("narration_asset_versions"."duration_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "narration_script_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"delivery_plan_revision_id" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"source_script_hash" varchar(64) NOT NULL,
	"display_sections" jsonb NOT NULL,
	"spoken_sections" jsonb NOT NULL,
	"language" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"normalization_version" varchar(80) NOT NULL,
	"decision_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narration_script_revisions_status_check" CHECK ("narration_script_revisions"."status" in ('DRAFT', 'NORMALIZED', 'NEEDS_DECISION', 'APPROVED', 'REJECTED')),
	CONSTRAINT "narration_script_revisions_hash_check" CHECK ("narration_script_revisions"."source_script_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "narration_script_revisions_language_check" CHECK ("narration_script_revisions"."language" = 'zh-CN')
);
--> statement-breakpoint
CREATE TABLE "timeline_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"delivery_plan_revision_id" text NOT NULL,
	"narration_script_revision_id" text NOT NULL,
	"narration_asset_version_id" text,
	"effective_duration_ms" integer NOT NULL,
	"narration_sections" jsonb NOT NULL,
	"visual_segments" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"decision_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeline_plans_status_check" CHECK ("timeline_plans"."status" in ('DRAFT', 'READY', 'NEEDS_DECISION', 'FAILED')),
	CONSTRAINT "timeline_plans_duration_check" CHECK ("timeline_plans"."effective_duration_ms" > 0)
);
--> statement-breakpoint
-- Child foreign keys below reference these workspace-scoped identities.  Keep
-- the parent uniqueness available before ALTER TABLE (PostgreSQL requires a
-- unique/primary key at FK creation time).
CREATE UNIQUE INDEX "narration_asset_versions_workspace_project_id_key" ON "narration_asset_versions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "narration_script_revisions_workspace_project_id_key" ON "narration_script_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
ALTER TABLE "narration_asset_versions" ADD CONSTRAINT "narration_asset_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_asset_versions" ADD CONSTRAINT "narration_asset_versions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_asset_versions" ADD CONSTRAINT "narration_asset_versions_workspace_project_script_fk" FOREIGN KEY ("workspace_id","project_id","narration_script_revision_id") REFERENCES "public"."narration_script_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_asset_versions" ADD CONSTRAINT "narration_asset_versions_workspace_project_asset_fk" FOREIGN KEY ("workspace_id","project_id","asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_asset_versions" ADD CONSTRAINT "narration_asset_versions_workspace_project_timestamps_asset_fk" FOREIGN KEY ("workspace_id","project_id","word_timestamps_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_script_revisions" ADD CONSTRAINT "narration_script_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_script_revisions" ADD CONSTRAINT "narration_script_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_script_revisions" ADD CONSTRAINT "narration_script_revisions_workspace_project_delivery_fk" FOREIGN KEY ("workspace_id","project_id","delivery_plan_revision_id") REFERENCES "public"."delivery_plan_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_plans" ADD CONSTRAINT "timeline_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_plans" ADD CONSTRAINT "timeline_plans_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_plans" ADD CONSTRAINT "timeline_plans_workspace_project_delivery_fk" FOREIGN KEY ("workspace_id","project_id","delivery_plan_revision_id") REFERENCES "public"."delivery_plan_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_plans" ADD CONSTRAINT "timeline_plans_workspace_project_script_fk" FOREIGN KEY ("workspace_id","project_id","narration_script_revision_id") REFERENCES "public"."narration_script_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_plans" ADD CONSTRAINT "timeline_plans_workspace_project_asset_version_fk" FOREIGN KEY ("workspace_id","project_id","narration_asset_version_id") REFERENCES "public"."narration_asset_versions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "narration_asset_versions_script_asset_key" ON "narration_asset_versions" USING btree ("narration_script_revision_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "narration_script_revisions_delivery_revision_key" ON "narration_script_revisions" USING btree ("delivery_plan_revision_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_plans_workspace_project_id_key" ON "timeline_plans" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_plans_script_revision_key" ON "timeline_plans" USING btree ("narration_script_revision_id");
