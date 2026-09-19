ALTER TABLE "outbox_events" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "outbox_events_pending_idx";--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("published_at","dead_lettered_at","available_at");--> statement-breakpoint
CREATE TABLE "event_consumptions" (
  "event_id" text NOT NULL,
  "consumer_name" varchar(128) NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "dead_lettered_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_consumptions_event_id_consumer_name_pk" PRIMARY KEY("event_id","consumer_name"),
  CONSTRAINT "event_consumptions_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX "event_consumptions_recoverable_idx" ON "event_consumptions" USING btree ("consumer_name","completed_at","dead_lettered_at","lease_expires_at");
