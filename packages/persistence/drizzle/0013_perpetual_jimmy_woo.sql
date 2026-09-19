CREATE TYPE "public"."continuity_status" AS ENUM('NOT_CHECKED', 'CHECKING', 'GOOD', 'AUTO_REPAIRING', 'NEEDS_ATTENTION');--> statement-breakpoint
CREATE TYPE "public"."handoff_review_result" AS ENUM('PASS', 'BLEND', 'BRIDGE_REQUIRED', 'UNAVAILABLE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."transition_repair_status" AS ENUM('PENDING', 'GENERATING', 'CHECKING', 'ACCEPTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."transition_repair_strategy" AS ENUM('BLEND', 'BRIDGE');--> statement-breakpoint
CREATE TABLE "handoff_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"production_run_id" text NOT NULL,
	"from_sequence" integer NOT NULL,
	"to_sequence" integer NOT NULL,
	"result" "handoff_review_result" NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"safe_summary" text NOT NULL,
	"evaluator_version" varchar(128) NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_reviews_adjacent_boundary_check" CHECK ("handoff_reviews"."to_sequence" = "handoff_reviews"."from_sequence" + 1),
	CONSTRAINT "handoff_reviews_safe_summary_nonempty_check" CHECK (length(trim("handoff_reviews"."safe_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "transition_repairs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"production_run_id" text NOT NULL,
	"boundary_sequence" integer NOT NULL,
	"strategy" "transition_repair_strategy" NOT NULL,
	"status" "transition_repair_status" NOT NULL,
	"task_run_id" text,
	"asset_id" text,
	"duration_ms" integer NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transition_repairs_boundary_positive_check" CHECK ("transition_repairs"."boundary_sequence" > 0),
	CONSTRAINT "transition_repairs_duration_bounds_check" CHECK ("transition_repairs"."duration_ms" >= 0 and "transition_repairs"."duration_ms" <= 3000),
	CONSTRAINT "transition_repairs_attempt_count_check" CHECK ("transition_repairs"."attempt_count" >= 1 and "transition_repairs"."attempt_count" <= 1)
);
--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "continuity_status" "continuity_status" DEFAULT 'NOT_CHECKED' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "max_auto_repair_count" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "auto_repair_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "handoff_reviews" ADD CONSTRAINT "handoff_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_reviews" ADD CONSTRAINT "handoff_reviews_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_reviews" ADD CONSTRAINT "handoff_reviews_workspace_project_run_fk" FOREIGN KEY ("workspace_id","project_id","production_run_id") REFERENCES "public"."production_runs"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_repairs" ADD CONSTRAINT "transition_repairs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_repairs" ADD CONSTRAINT "transition_repairs_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_repairs" ADD CONSTRAINT "transition_repairs_workspace_project_run_fk" FOREIGN KEY ("workspace_id","project_id","production_run_id") REFERENCES "public"."production_runs"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_repairs" ADD CONSTRAINT "transition_repairs_workspace_project_task_run_fk" FOREIGN KEY ("workspace_id","project_id","task_run_id") REFERENCES "public"."task_runs"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_repairs" ADD CONSTRAINT "transition_repairs_workspace_project_asset_fk" FOREIGN KEY ("workspace_id","project_id","asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_reviews_workspace_run_boundary_key" ON "handoff_reviews" USING btree ("workspace_id","production_run_id","from_sequence","to_sequence");--> statement-breakpoint
CREATE INDEX "handoff_reviews_workspace_project_run_idx" ON "handoff_reviews" USING btree ("workspace_id","project_id","production_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transition_repairs_workspace_run_boundary_key" ON "transition_repairs" USING btree ("workspace_id","production_run_id","boundary_sequence");--> statement-breakpoint
CREATE INDEX "transition_repairs_workspace_project_run_idx" ON "transition_repairs" USING btree ("workspace_id","project_id","production_run_id");--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_auto_repair_count_check" CHECK ("production_runs"."auto_repair_count" >= 0 and "production_runs"."auto_repair_count" <= "production_runs"."max_auto_repair_count");--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_max_auto_repair_count_check" CHECK ("production_runs"."max_auto_repair_count" >= 0 and "production_runs"."max_auto_repair_count" <= 20);