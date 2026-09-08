CREATE TYPE "public"."document_fact_category" AS ENUM('BRAND', 'PRODUCT', 'LOCATION', 'AUDIENCE', 'SELLING_POINT', 'AMENITY', 'STYLE', 'CTA', 'COMPLIANCE', 'NUMERIC_CLAIM', 'RISK');--> statement-breakpoint
CREATE TYPE "public"."document_fact_confidence" AS ENUM('EXPLICIT', 'INFERRED', 'NEEDS_CONFIRMATION');--> statement-breakpoint
CREATE TYPE "public"."document_knowledge_analysis_quality" AS ENUM('COMPLETE', 'PARTIAL', 'NEEDS_CONFIRMATION');--> statement-breakpoint
CREATE TYPE "public"."document_knowledge_evidence_kind" AS ENUM('TEXT', 'TABLE', 'VISUAL_UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."document_knowledge_revision_status" AS ENUM('CREATED', 'QUEUED', 'RUNNING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "document_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"knowledge_revision_id" text NOT NULL,
	"section_id" text NOT NULL,
	"category" "document_fact_category" NOT NULL,
	"statement" varchar(500) NOT NULL,
	"confidence" "document_fact_confidence" NOT NULL,
	"statement_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_facts_statement_nonempty_check" CHECK (length(trim("document_facts"."statement")) > 0),
	CONSTRAINT "document_facts_statement_hash_check" CHECK ("document_facts"."statement_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "document_knowledge_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"conversion_id" text NOT NULL,
	"markdown_asset_id" text NOT NULL,
	"markdown_sha256" varchar(64) NOT NULL,
	"analyzer_version" varchar(160) NOT NULL,
	"status" "document_knowledge_revision_status" DEFAULT 'CREATED' NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"analysis_quality" "document_knowledge_analysis_quality",
	"section_count" integer DEFAULT 0 NOT NULL,
	"fact_count" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_knowledge_revisions_markdown_sha256_check" CHECK ("document_knowledge_revisions"."markdown_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "document_knowledge_revisions_counts_nonnegative_check" CHECK ("document_knowledge_revisions"."section_count" >= 0 and "document_knowledge_revisions"."fact_count" >= 0),
	CONSTRAINT "document_knowledge_revisions_ready_quality_check" CHECK (("document_knowledge_revisions"."status" = 'READY' and "document_knowledge_revisions"."analysis_quality" is not null) or ("document_knowledge_revisions"."status" <> 'READY'))
);
--> statement-breakpoint
CREATE TABLE "document_knowledge_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"knowledge_revision_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"heading" varchar(240) NOT NULL,
	"locator" varchar(240) NOT NULL,
	"evidence_kind" "document_knowledge_evidence_kind" NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_knowledge_sections_sequence_positive_check" CHECK ("document_knowledge_sections"."sequence" > 0),
	CONSTRAINT "document_knowledge_sections_content_hash_check" CHECK ("document_knowledge_sections"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
-- The facts and sections below use workspace-scoped composite references;
-- create their parent keys before adding the foreign keys.
CREATE UNIQUE INDEX "document_knowledge_revisions_workspace_project_id_key" ON "document_knowledge_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_knowledge_sections_workspace_project_id_key" ON "document_knowledge_sections" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
ALTER TABLE "document_facts" ADD CONSTRAINT "document_facts_workspace_project_revision_fk" FOREIGN KEY ("workspace_id","project_id","knowledge_revision_id") REFERENCES "public"."document_knowledge_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_facts" ADD CONSTRAINT "document_facts_workspace_project_section_fk" FOREIGN KEY ("workspace_id","project_id","section_id") REFERENCES "public"."document_knowledge_sections"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_revisions" ADD CONSTRAINT "document_knowledge_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_revisions" ADD CONSTRAINT "document_knowledge_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_revisions" ADD CONSTRAINT "document_knowledge_revisions_workspace_project_document_fk" FOREIGN KEY ("workspace_id","project_id","document_id") REFERENCES "public"."documents"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_revisions" ADD CONSTRAINT "document_knowledge_revisions_workspace_project_conversion_fk" FOREIGN KEY ("workspace_id","project_id","conversion_id") REFERENCES "public"."document_conversions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_revisions" ADD CONSTRAINT "document_knowledge_revisions_workspace_project_markdown_asset_fk" FOREIGN KEY ("workspace_id","project_id","markdown_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_sections" ADD CONSTRAINT "document_knowledge_sections_workspace_project_revision_fk" FOREIGN KEY ("workspace_id","project_id","knowledge_revision_id") REFERENCES "public"."document_knowledge_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_facts_workspace_project_id_key" ON "document_facts" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_facts_revision_statement_key" ON "document_facts" USING btree ("knowledge_revision_id","statement_hash","section_id");--> statement-breakpoint
CREATE INDEX "document_facts_workspace_project_revision_idx" ON "document_facts" USING btree ("workspace_id","project_id","knowledge_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_knowledge_revisions_conversion_fingerprint_key" ON "document_knowledge_revisions" USING btree ("workspace_id","project_id","conversion_id","markdown_sha256","analyzer_version");--> statement-breakpoint
CREATE INDEX "document_knowledge_revisions_workspace_project_created_at_idx" ON "document_knowledge_revisions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_knowledge_sections_revision_sequence_key" ON "document_knowledge_sections" USING btree ("knowledge_revision_id","sequence");--> statement-breakpoint
CREATE INDEX "document_knowledge_sections_workspace_project_revision_idx" ON "document_knowledge_sections" USING btree ("workspace_id","project_id","knowledge_revision_id");
