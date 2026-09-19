CREATE UNIQUE INDEX "projects_workspace_id_key" ON "projects" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_workspace_project_id_key" ON "assets" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_workspace_project_id_key" ON "shots" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_workspace_id_key" ON "task_runs" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_attempts" DROP CONSTRAINT "provider_attempts_task_run_id_task_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "reference_bindings" DROP CONSTRAINT "reference_bindings_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "reference_bindings" DROP CONSTRAINT "reference_bindings_shot_id_shots_id_fk";
--> statement-breakpoint
ALTER TABLE "reference_bindings" DROP CONSTRAINT "reference_bindings_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "shots" DROP CONSTRAINT "shots_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "task_runs" DROP CONSTRAINT "task_runs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "task_runs" DROP CONSTRAINT "task_runs_shot_id_shots_id_fk";
--> statement-breakpoint
ALTER TABLE "task_runs" DROP CONSTRAINT "task_runs_result_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_task_run_id_task_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_workspace_task_run_fk" FOREIGN KEY ("workspace_id","task_run_id") REFERENCES "public"."task_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_workspace_project_shot_fk" FOREIGN KEY ("workspace_id","project_id","shot_id") REFERENCES "public"."shots"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_workspace_project_asset_fk" FOREIGN KEY ("workspace_id","project_id","asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_workspace_project_shot_fk" FOREIGN KEY ("workspace_id","project_id","shot_id") REFERENCES "public"."shots"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_workspace_project_result_asset_fk" FOREIGN KEY ("workspace_id","project_id","result_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_task_run_fk" FOREIGN KEY ("workspace_id","task_run_id") REFERENCES "public"."task_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
