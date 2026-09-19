CREATE UNIQUE INDEX "document_conversions_workspace_project_id_key" ON "document_conversions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE TABLE "creative_brief_document_contexts" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"creative_brief_revision_id" text NOT NULL,
	"document_id" text NOT NULL,
	"conversion_id" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"markdown_asset_id" text NOT NULL,
	"markdown_sha256" varchar(64) NOT NULL,
	"sequence" integer NOT NULL,
	"max_content_characters" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_brief_document_contexts_creative_brief_revision_id_source_asset_id_pk" PRIMARY KEY("creative_brief_revision_id","source_asset_id"),
	CONSTRAINT "creative_brief_document_contexts_markdown_sha256_check" CHECK ("markdown_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "creative_brief_document_contexts_sequence_positive_check" CHECK ("sequence" > 0),
	CONSTRAINT "creative_brief_document_contexts_max_characters_check" CHECK ("max_content_characters" between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_project_brief_fk" FOREIGN KEY ("workspace_id","project_id","creative_brief_revision_id") REFERENCES "public"."creative_brief_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_project_document_fk" FOREIGN KEY ("workspace_id","project_id","document_id") REFERENCES "public"."documents"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_project_conversion_fk" FOREIGN KEY ("workspace_id","project_id","conversion_id") REFERENCES "public"."document_conversions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_project_source_asset_fk" FOREIGN KEY ("workspace_id","project_id","source_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_brief_document_contexts" ADD CONSTRAINT "creative_brief_document_contexts_workspace_project_markdown_asset_fk" FOREIGN KEY ("workspace_id","project_id","markdown_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_document_contexts_workspace_id_key" ON "creative_brief_document_contexts" USING btree ("workspace_id","creative_brief_revision_id","source_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_document_contexts_brief_conversion_key" ON "creative_brief_document_contexts" USING btree ("creative_brief_revision_id","conversion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_brief_document_contexts_brief_sequence_key" ON "creative_brief_document_contexts" USING btree ("creative_brief_revision_id","sequence");--> statement-breakpoint
CREATE INDEX "creative_brief_document_contexts_workspace_project_idx" ON "creative_brief_document_contexts" USING btree ("workspace_id","project_id","creative_brief_revision_id");
