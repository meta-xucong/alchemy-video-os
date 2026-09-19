ALTER TABLE "event_consumptions" DROP CONSTRAINT "event_consumptions_event_id_outbox_events_id_fk";
--> statement-breakpoint
DROP INDEX "event_consumptions_recoverable_idx";--> statement-breakpoint
ALTER TABLE "event_consumptions" DROP CONSTRAINT "event_consumptions_event_id_consumer_name_pk";--> statement-breakpoint
ALTER TABLE "event_consumptions" ADD COLUMN "workspace_id" text;--> statement-breakpoint
UPDATE "event_consumptions" AS consumption
SET "workspace_id" = event."workspace_id"
FROM "outbox_events" AS event
WHERE event."id" = consumption."event_id";--> statement-breakpoint
ALTER TABLE "event_consumptions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_id_workspace_key" ON "outbox_events" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "event_consumptions" ADD CONSTRAINT "event_consumptions_workspace_id_event_id_consumer_name_pk" PRIMARY KEY("workspace_id","event_id","consumer_name");--> statement-breakpoint
ALTER TABLE "event_consumptions" ADD CONSTRAINT "event_consumptions_event_workspace_outbox_fk" FOREIGN KEY ("event_id","workspace_id") REFERENCES "public"."outbox_events"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_consumptions_recoverable_idx" ON "event_consumptions" USING btree ("workspace_id","consumer_name","completed_at","dead_lettered_at","lease_expires_at");
