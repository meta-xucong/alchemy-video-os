CREATE TABLE "creative_brief_fact_contexts" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"creative_brief_revision_id" text NOT NULL,
	"knowledge_revision_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"category" "document_fact_category" NOT NULL,
	"statement" varchar(500) NOT NULL,
	"confidence" "document_fact_confidence" NOT NULL,
	"document_id" text NOT NULL,
	"conversion_id" text NOT NULL,
	"section_sequence" integer NOT NULL,
	"locator" varchar(240) NOT NULL,
	"selection_reason" varchar(240) NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_brief_fact_contexts_creative_brief_revision_id_fact_id_pk" PRIMARY KEY("creative_brief_revision_id","fact_id"),
	CONSTRAINT "creative_brief_fact_contexts_sequence_positive_check" CHECK ("creative_brief_fact_contexts"."sequence" between 1 and 24),
	CONSTRAINT "creative_brief_fact_contexts_section_sequence_positive_check" CHECK ("creative_brief_fact_contexts"."section_sequence" > 0),
	CONSTRAINT "creative_brief_fact_contexts_statement_nonempty_check" CHECK (length(trim("creative_brief_fact_contexts"."statement")) > 0),
	CONSTRAINT "creative_brief_fact_contexts_snapshot_hash_check" CHECK ("creative_brief_fact_contexts"."snapshot_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "creative_brief_fact_contexts" ADD CONSTRAINT "creative_brief_fact_contexts_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_fact_contexts" ADD CONSTRAINT "creative_brief_fact_contexts_workspace_project_brief_fk" FOREIGN KEY ("workspace_id","project_id","creative_brief_revision_id") REFERENCES "public"."creative_brief_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_fact_contexts" ADD CONSTRAINT "creative_brief_fact_contexts_workspace_project_revision_fk" FOREIGN KEY ("workspace_id","project_id","knowledge_revision_id") REFERENCES "public"."document_knowledge_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_fact_contexts" ADD CONSTRAINT "creative_brief_fact_contexts_workspace_project_fact_fk" FOREIGN KEY ("workspace_id","project_id","fact_id") REFERENCES "public"."document_facts"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_fact_contexts" ADD CONSTRAINT "creative_brief_fact_contexts_workspace_project_document_fk" FOREIGN KEY ("workspace_id","project_id","document_id") REFERENCES "public"."documents"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_fact_contexts" ADD CONSTRAINT "creative_brief_fact_contexts_workspace_project_conversion_fk" FOREIGN KEY ("workspace_id","project_id","conversion_id") REFERENCES "public"."document_conversions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_fact_contexts_workspace_project_id_key" ON "creative_brief_fact_contexts" USING btree ("workspace_id","project_id","creative_brief_revision_id","fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_fact_contexts_brief_sequence_key" ON "creative_brief_fact_contexts" USING btree ("creative_brief_revision_id","sequence");--> statement-breakpoint
CREATE INDEX "creative_brief_fact_contexts_workspace_project_brief_idx" ON "creative_brief_fact_contexts" USING btree ("workspace_id","project_id","creative_brief_revision_id");