-- ADR-0014: terminal statuses allow a later TaskRun for the same Shot.
DROP INDEX "task_runs_one_active_shot_key";--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_one_active_shot_key" ON "task_runs" USING btree ("shot_id") WHERE "task_runs"."status" NOT IN ('SUCCEEDED', 'FAILED', 'ABANDONED');
