ALTER TABLE "usage_records" ADD COLUMN "credit_provider" varchar(64) DEFAULT 'veyra_sub2api';--> statement-breakpoint
UPDATE "usage_records" SET "credit_provider" = 'veyra_sub2api' WHERE "credit_provider" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ALTER COLUMN "credit_provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ALTER COLUMN "credit_provider" DROP DEFAULT;--> statement-breakpoint
DROP INDEX "usage_records_idempotency_key_key";--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_credit_provider_idempotency_key_key" ON "usage_records" USING btree ("credit_provider","idempotency_key");
