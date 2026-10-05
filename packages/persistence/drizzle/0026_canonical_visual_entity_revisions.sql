CREATE TABLE "canonical_visual_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"entity_kind" varchar(16) NOT NULL,
	"normalized_identity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_visual_entities_kind_check" CHECK ("canonical_visual_entities"."entity_kind" in ('CHARACTER', 'SCENE', 'PROP')),
	CONSTRAINT "canonical_visual_entities_identity_nonempty_check" CHECK (length("canonical_visual_entities"."normalized_identity") > 0)
);
--> statement-breakpoint
CREATE TABLE "canonical_visual_entity_revision_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"change_kind" varchar(8) NOT NULL,
	"entity_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"asset_id" text NOT NULL,
	"asset_sha256" varchar(64) NOT NULL,
	"mapping_evidence_id" text NOT NULL,
	"reference_evidence_id" text,
	"brief_revision_id" text NOT NULL,
	"usage" text NOT NULL,
	"revoked_add_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_visual_entity_revision_assets_kind_check" CHECK ("canonical_visual_entity_revision_assets"."change_kind" in ('ADD', 'REVOKE')),
	CONSTRAINT "canonical_visual_entity_revision_assets_revoke_shape_check" CHECK (("canonical_visual_entity_revision_assets"."change_kind" = 'ADD' and "canonical_visual_entity_revision_assets"."revoked_add_id" is null and "canonical_visual_entity_revision_assets"."reference_evidence_id" is not null) or ("canonical_visual_entity_revision_assets"."change_kind" = 'REVOKE' and "canonical_visual_entity_revision_assets"."revoked_add_id" is not null and "canonical_visual_entity_revision_assets"."reference_evidence_id" is null)),
	CONSTRAINT "canonical_visual_entity_revision_assets_hash_format_check" CHECK ("canonical_visual_entity_revision_assets"."asset_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "canonical_visual_entity_revision_assets_usage_nonempty_check" CHECK (length(trim("canonical_visual_entity_revision_assets"."usage")) > 0)
);
--> statement-breakpoint
CREATE TABLE "canonical_visual_entity_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"exact_name" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"role" text,
	"description" text,
	"appearance" text,
	"styling" text,
	"location" text,
	"time" text,
	"prompt" text,
	"lighting" text,
	"type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_visual_entity_revisions_number_positive_check" CHECK ("canonical_visual_entity_revisions"."revision_number" > 0),
	CONSTRAINT "canonical_visual_entity_revisions_hash_format_check" CHECK ("canonical_visual_entity_revisions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD COLUMN "character_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD COLUMN "prop_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD COLUMN "reference_anchors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entities_scope_id_key" ON "canonical_visual_entities" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entities_identity_key" ON "canonical_visual_entities" USING btree ("workspace_id","project_id","entity_kind","normalized_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entity_revision_assets_scope_id_key" ON "canonical_visual_entity_revision_assets" USING btree ("id","workspace_id","project_id","entity_id","revision_number","asset_id","asset_sha256","brief_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entity_revision_assets_mapping_evidence_key" ON "canonical_visual_entity_revision_assets" USING btree ("mapping_evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entity_revision_assets_revoked_add_key" ON "canonical_visual_entity_revision_assets" USING btree ("revoked_add_id") WHERE "canonical_visual_entity_revision_assets"."change_kind" = 'REVOKE';--> statement-breakpoint
CREATE INDEX "canonical_visual_entity_revision_assets_brief_asset_idx" ON "canonical_visual_entity_revision_assets" USING btree ("workspace_id","project_id","brief_revision_id","asset_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entity_revisions_scope_id_key" ON "canonical_visual_entity_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entity_revisions_number_key" ON "canonical_visual_entity_revisions" USING btree ("workspace_id","project_id","entity_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_visual_entity_revisions_hash_key" ON "canonical_visual_entity_revisions" USING btree ("workspace_id","project_id","entity_id","content_hash");
--> statement-breakpoint
ALTER TABLE "canonical_visual_entities" ADD CONSTRAINT "canonical_visual_entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_visual_entities" ADD CONSTRAINT "canonical_visual_entities_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_visual_entity_revisions" ADD CONSTRAINT "canonical_visual_entity_revisions_entity_fk" FOREIGN KEY ("workspace_id","project_id","entity_id") REFERENCES "public"."canonical_visual_entities"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_visual_entity_revision_assets" ADD CONSTRAINT "canonical_visual_entity_revision_assets_revision_fk" FOREIGN KEY ("workspace_id","project_id","entity_id","revision_number") REFERENCES "public"."canonical_visual_entity_revisions"("workspace_id","project_id","entity_id","revision_number") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_visual_entity_revision_assets" ADD CONSTRAINT "canonical_visual_entity_revision_assets_asset_fk" FOREIGN KEY ("workspace_id","project_id","asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_visual_entity_revision_assets" ADD CONSTRAINT "canonical_visual_entity_revision_assets_brief_fk" FOREIGN KEY ("workspace_id","project_id","brief_revision_id") REFERENCES "public"."creative_brief_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_visual_entity_revision_assets" ADD CONSTRAINT "canonical_visual_entity_revision_assets_revoke_scope_fk" FOREIGN KEY ("revoked_add_id","workspace_id","project_id","entity_id","revision_number","asset_id","asset_sha256","brief_revision_id") REFERENCES "public"."canonical_visual_entity_revision_assets"("id","workspace_id","project_id","entity_id","revision_number","asset_id","asset_sha256","brief_revision_id") ON DELETE restrict ON UPDATE no action;
