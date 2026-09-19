CREATE TYPE "public"."continuity_level" AS ENUM('STANDARD', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."creative_revision_status" AS ENUM('DRAFT', 'PLANNING', 'READY_FOR_REVIEW', 'APPROVED', 'FAILED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."production_run_status" AS ENUM('DRAFT', 'PLAN_READY', 'CONFIRMED', 'GENERATING', 'REVIEWING', 'RENDERING', 'SUCCEEDED', 'BLOCKED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."reference_policy" AS ENUM('REFERENCE_SET', 'HANDOFF_FIRST_FRAME', 'TEXT_TRANSITION');--> statement-breakpoint
CREATE TABLE "creative_brief_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"revision" integer NOT NULL,
	"source_text" text NOT NULL,
	"target_duration_seconds" integer NOT NULL,
	"style_preferences" text DEFAULT '' NOT NULL,
	"source_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "creative_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_brief_revisions_revision_positive_check" CHECK ("creative_brief_revisions"."revision" > 0),
	CONSTRAINT "creative_brief_revisions_source_text_nonempty_check" CHECK (length(trim("creative_brief_revisions"."source_text")) > 0),
	CONSTRAINT "creative_brief_revisions_target_duration_check" CHECK ("creative_brief_revisions"."target_duration_seconds" between 15 and 600)
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"storyboard_revision_id" text NOT NULL,
	"status" "production_run_status" DEFAULT 'DRAFT' NOT NULL,
	"total_shot_count" integer NOT NULL,
	"accepted_shot_count" integer DEFAULT 0 NOT NULL,
	"total_duration_seconds" integer NOT NULL,
	"budget_guard" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_runs_total_shot_count_positive_check" CHECK ("production_runs"."total_shot_count" > 0),
	CONSTRAINT "production_runs_accepted_shot_count_check" CHECK ("production_runs"."accepted_shot_count" >= 0 and "production_runs"."accepted_shot_count" <= "production_runs"."total_shot_count"),
	CONSTRAINT "production_runs_total_duration_positive_check" CHECK ("production_runs"."total_duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "prompt_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"shot_spec_id" text NOT NULL,
	"compiler_version" varchar(160) NOT NULL,
	"prompt" text NOT NULL,
	"visual_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reference_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capability_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_packages_prompt_nonempty_check" CHECK (length(trim("prompt_packages"."prompt")) > 0)
);
--> statement-breakpoint
CREATE TABLE "script_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"creative_brief_revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "creative_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_revisions_revision_positive_check" CHECK ("script_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "storyboard_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"script_revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" text NOT NULL,
	"total_duration_seconds" integer NOT NULL,
	"continuity_level" "continuity_level" NOT NULL,
	"continuity_note" text NOT NULL,
	"status" "creative_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storyboard_revisions_revision_positive_check" CHECK ("storyboard_revisions"."revision" > 0),
	CONSTRAINT "storyboard_revisions_total_duration_positive_check" CHECK ("storyboard_revisions"."total_duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "storyboard_shot_specs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"storyboard_revision_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"narrative_goal" text NOT NULL,
	"start_state" text NOT NULL,
	"end_state" text NOT NULL,
	"transition_summary" text NOT NULL,
	"reference_policy" "reference_policy" NOT NULL,
	"depends_on_sequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"continuity_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storyboard_shot_specs_sequence_positive_check" CHECK ("storyboard_shot_specs"."sequence" > 0),
	CONSTRAINT "storyboard_shot_specs_duration_capability_check" CHECK ("storyboard_shot_specs"."duration_seconds" between 1 and 15)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_revisions_workspace_project_id_key" ON "creative_brief_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_revisions_project_revision_key" ON "creative_brief_revisions" USING btree ("project_id","revision");--> statement-breakpoint
CREATE INDEX "creative_brief_revisions_workspace_project_created_at_idx" ON "creative_brief_revisions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_workspace_project_id_key" ON "production_runs" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_one_active_project_key" ON "production_runs" USING btree ("project_id") WHERE "production_runs"."status" not in ('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE INDEX "production_runs_workspace_project_created_at_idx" ON "production_runs" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_packages_workspace_project_id_key" ON "prompt_packages" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE INDEX "prompt_packages_workspace_shot_spec_created_at_idx" ON "prompt_packages" USING btree ("workspace_id","shot_spec_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "script_revisions_workspace_project_id_key" ON "script_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_revisions_creative_brief_revision_key" ON "script_revisions" USING btree ("creative_brief_revision_id","revision");--> statement-breakpoint
CREATE INDEX "script_revisions_workspace_project_created_at_idx" ON "script_revisions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_revisions_workspace_project_id_key" ON "storyboard_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_revisions_script_revision_key" ON "storyboard_revisions" USING btree ("script_revision_id","revision");--> statement-breakpoint
CREATE INDEX "storyboard_revisions_workspace_project_created_at_idx" ON "storyboard_revisions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_shot_specs_workspace_project_id_key" ON "storyboard_shot_specs" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_shot_specs_revision_sequence_key" ON "storyboard_shot_specs" USING btree ("storyboard_revision_id","sequence");--> statement-breakpoint
CREATE INDEX "storyboard_shot_specs_workspace_revision_sequence_idx" ON "storyboard_shot_specs" USING btree ("workspace_id","storyboard_revision_id","sequence");--> statement-breakpoint
ALTER TABLE "creative_brief_revisions" ADD CONSTRAINT "creative_brief_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_revisions" ADD CONSTRAINT "creative_brief_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_workspace_project_storyboard_fk" FOREIGN KEY ("workspace_id","project_id","storyboard_revision_id") REFERENCES "public"."storyboard_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_packages" ADD CONSTRAINT "prompt_packages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_packages" ADD CONSTRAINT "prompt_packages_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_packages" ADD CONSTRAINT "prompt_packages_workspace_project_shot_spec_fk" FOREIGN KEY ("workspace_id","project_id","shot_spec_id") REFERENCES "public"."storyboard_shot_specs"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_revisions" ADD CONSTRAINT "script_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_revisions" ADD CONSTRAINT "script_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_revisions" ADD CONSTRAINT "script_revisions_workspace_project_creative_brief_fk" FOREIGN KEY ("workspace_id","project_id","creative_brief_revision_id") REFERENCES "public"."creative_brief_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_revisions" ADD CONSTRAINT "storyboard_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_revisions" ADD CONSTRAINT "storyboard_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_revisions" ADD CONSTRAINT "storyboard_revisions_workspace_project_script_fk" FOREIGN KEY ("workspace_id","project_id","script_revision_id") REFERENCES "public"."script_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD CONSTRAINT "storyboard_shot_specs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD CONSTRAINT "storyboard_shot_specs_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD CONSTRAINT "storyboard_shot_specs_workspace_project_storyboard_fk" FOREIGN KEY ("workspace_id","project_id","storyboard_revision_id") REFERENCES "public"."storyboard_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;
