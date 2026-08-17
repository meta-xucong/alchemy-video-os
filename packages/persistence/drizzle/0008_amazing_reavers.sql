CREATE TYPE "public"."document_conversion_status" AS ENUM('CREATED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('READY', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "document_conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"source_mime_type" varchar(255) NOT NULL,
	"source_filename" varchar(255) NOT NULL,
	"source_byte_size" bigint NOT NULL,
	"status" "document_conversion_status" DEFAULT 'CREATED' NOT NULL,
	"markdown_asset_id" text,
	"converter" varchar(128),
	"converter_version" varchar(128),
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_conversions_source_sha256_format_check" CHECK ("document_conversions"."source_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "document_conversions_source_byte_size_positive_check" CHECK ("document_conversions"."source_byte_size" > 0),
	CONSTRAINT "document_conversions_result_success_check" CHECK (("document_conversions"."status" = 'SUCCEEDED' and "document_conversions"."markdown_asset_id" is not null) or ("document_conversions"."status" <> 'SUCCEEDED' and "document_conversions"."markdown_asset_id" is null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"status" "document_status" DEFAULT 'READY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_workspace_project_id_key" ON "documents" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
ALTER TABLE "document_conversions" ADD CONSTRAINT "document_conversions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_conversions" ADD CONSTRAINT "document_conversions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_conversions" ADD CONSTRAINT "document_conversions_workspace_project_document_fk" FOREIGN KEY ("workspace_id","project_id","document_id") REFERENCES "public"."documents"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_conversions" ADD CONSTRAINT "document_conversions_workspace_project_source_asset_fk" FOREIGN KEY ("workspace_id","project_id","source_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_conversions" ADD CONSTRAINT "document_conversions_workspace_project_markdown_asset_fk" FOREIGN KEY ("workspace_id","project_id","markdown_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_project_source_asset_fk" FOREIGN KEY ("workspace_id","project_id","source_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_conversions_workspace_id_key" ON "document_conversions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_conversions_one_active_document_key" ON "document_conversions" USING btree ("document_id") WHERE "document_conversions"."status" in ('CREATED', 'QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "document_conversions_workspace_project_created_at_idx" ON "document_conversions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_workspace_source_asset_key" ON "documents" USING btree ("workspace_id","source_asset_id");--> statement-breakpoint
CREATE INDEX "documents_workspace_project_created_at_idx" ON "documents" USING btree ("workspace_id","project_id","created_at");
