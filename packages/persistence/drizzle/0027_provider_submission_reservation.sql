ALTER TABLE "provider_attempts" ADD COLUMN "submission_reserved_at" timestamp with time zone;
--> statement-breakpoint
-- Legacy attempts without a persisted request ID cannot prove that no POST
-- reached the provider. Preserve uncertainty instead of automatically retrying.
-- Stop old workers before applying this migration; do not run mixed versions.
UPDATE "provider_attempts"
SET "submission_reserved_at" = "created_at"
WHERE "provider_request_id" IS NULL;
