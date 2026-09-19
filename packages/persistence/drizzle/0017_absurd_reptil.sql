CREATE TYPE "public"."budget_reservation_status" AS ENUM('ESTIMATED', 'APPROVED', 'REJECTED', 'EXCEEDED', 'CONSUMED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."capability_profile_status" AS ENUM('DISABLED', 'OFFLINE_CERTIFIED', 'LIVE_CERTIFIED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."caption_policy" AS ENUM('REQUIRED', 'OPTIONAL', 'OFF');--> statement-breakpoint
CREATE TYPE "public"."duration_policy" AS ENUM('FLEXIBLE', 'EXACT');--> statement-breakpoint
CREATE TYPE "public"."lip_sync_requirement" AS ENUM('OFF', 'PREFERRED', 'REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."policy_revision_status" AS ENUM('DRAFT', 'APPROVED', 'REVOKED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."preflight_revision_status" AS ENUM('DRAFT', 'PREFLIGHT_BLOCKED', 'AWAITING_APPROVAL', 'APPROVED', 'CONSUMED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."quality_gate_action" AS ENUM('PRESENT', 'REVISE_NARRATION', 'REVISE_EDIT', 'REGENERATE_SEGMENT', 'BLOCK', 'AWAITING_HUMAN_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."quality_gate_actor" AS ENUM('RUNTIME', 'USER', 'AUTHORIZED_REVIEWER');--> statement-breakpoint
CREATE TYPE "public"."quality_gate_severity" AS ENUM('BLOCK', 'REVISE', 'REVIEW', 'INFO');--> statement-breakpoint
CREATE TYPE "public"."voice_authorization_status" AS ENUM('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."voice_mode" AS ENUM('PLATFORM_GENERIC', 'AUTHORIZED_CLONE', 'USER_SOURCE');--> statement-breakpoint
CREATE TABLE "brand_policy_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "policy_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"approved_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_logo_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forbidden_identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claims_policy" text DEFAULT '' NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_policy_revisions_revision_positive_check" CHECK ("brand_policy_revisions"."revision" > 0),
	CONSTRAINT "brand_policy_revisions_hash_check" CHECK ("brand_policy_revisions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"delivery_plan_revision_id" text NOT NULL,
	"status" "budget_reservation_status" DEFAULT 'ESTIMATED' NOT NULL,
	"estimated_amount" numeric(18, 8) NOT NULL,
	"approved_limit" numeric(18, 8) NOT NULL,
	"currency" varchar(16) DEFAULT 'CREDIT' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_reservations_amount_nonnegative_check" CHECK ("budget_reservations"."estimated_amount" >= 0 and "budget_reservations"."approved_limit" >= 0),
	CONSTRAINT "budget_reservations_limit_check" CHECK ("budget_reservations"."status" <> 'APPROVED' or "budget_reservations"."estimated_amount" <= "budget_reservations"."approved_limit")
);
--> statement-breakpoint
CREATE TABLE "capability_profile_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"provider_family" varchar(64) NOT NULL,
	"model_or_tool" varchar(160) NOT NULL,
	"status" "capability_profile_status" DEFAULT 'DISABLED' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"certification_fixture_version" varchar(160) NOT NULL,
	"safe_summary" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_profile_revisions_provider_family_check" CHECK ("capability_profile_revisions"."provider_family" in ('LOCAL', 'SUB2API', 'SEEDANCE', 'OPENMONTAGE', 'OTHER')),
	CONSTRAINT "capability_profile_revisions_safe_summary_nonempty_check" CHECK (length(trim("capability_profile_revisions"."safe_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "creative_decision_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text,
	"decision_type" varchar(80) NOT NULL,
	"source_revision_type" varchar(80) NOT NULL,
	"source_revision_id" varchar(160) NOT NULL,
	"safe_summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_decision_logs_safe_summary_nonempty_check" CHECK (length(trim("creative_decision_logs"."safe_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_plan_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"creative_brief_revision_id" text NOT NULL,
	"storyboard_revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "preflight_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"duration_policy" "duration_policy" DEFAULT 'FLEXIBLE' NOT NULL,
	"flexible_duration_percent" integer DEFAULT 20 NOT NULL,
	"target_duration_seconds" integer NOT NULL,
	"requires_sample_approval" boolean DEFAULT true NOT NULL,
	"caption_policy" "caption_policy" DEFAULT 'REQUIRED' NOT NULL,
	"lip_sync_requirement" "lip_sync_requirement" DEFAULT 'OFF' NOT NULL,
	"voice_mode" "voice_mode" DEFAULT 'PLATFORM_GENERIC' NOT NULL,
	"safe_summary" text NOT NULL,
	"block_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"consumed_by_production_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_plan_revisions_revision_positive_check" CHECK ("delivery_plan_revisions"."revision" > 0),
	CONSTRAINT "delivery_plan_revisions_target_duration_check" CHECK ("delivery_plan_revisions"."target_duration_seconds" between 15 and 600),
	CONSTRAINT "delivery_plan_revisions_flexible_duration_check" CHECK ("delivery_plan_revisions"."flexible_duration_percent" between 0 and 50),
	CONSTRAINT "delivery_plan_revisions_exact_duration_check" CHECK ("delivery_plan_revisions"."duration_policy" <> 'EXACT' or "delivery_plan_revisions"."flexible_duration_percent" = 0),
	CONSTRAINT "delivery_plan_revisions_block_reason_check" CHECK ("delivery_plan_revisions"."status" <> 'PREFLIGHT_BLOCKED' or jsonb_array_length("delivery_plan_revisions"."block_reasons") > 0),
	CONSTRAINT "delivery_plan_revisions_approval_check" CHECK ("delivery_plan_revisions"."status" not in ('APPROVED', 'CONSUMED') or "delivery_plan_revisions"."approved_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "narration_plan_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"delivery_plan_revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "preflight_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"voice_mode" "voice_mode" DEFAULT 'PLATFORM_GENERIC' NOT NULL,
	"voice_authorization_id" text,
	"pronunciation_glossary_revision_id" text,
	"requires_sample_approval" boolean DEFAULT true NOT NULL,
	"sample_asset_id" text,
	"canonical_script_hash" varchar(64),
	"safe_summary" text NOT NULL,
	"block_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narration_plan_revisions_revision_positive_check" CHECK ("narration_plan_revisions"."revision" > 0),
	CONSTRAINT "narration_plan_revisions_voice_auth_check" CHECK ("narration_plan_revisions"."voice_mode" = 'PLATFORM_GENERIC' or "narration_plan_revisions"."voice_authorization_id" is not null),
	CONSTRAINT "narration_plan_revisions_sample_approval_check" CHECK ("narration_plan_revisions"."status" <> 'APPROVED' or "narration_plan_revisions"."requires_sample_approval" = false or "narration_plan_revisions"."sample_asset_id" is not null),
	CONSTRAINT "narration_plan_revisions_script_hash_check" CHECK ("narration_plan_revisions"."canonical_script_hash" is null or "narration_plan_revisions"."canonical_script_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "output_profile_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"delivery_plan_revision_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "policy_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "output_profile_revisions_revision_positive_check" CHECK ("output_profile_revisions"."revision" > 0),
	CONSTRAINT "output_profile_revisions_variants_nonempty_check" CHECK (jsonb_array_length("output_profile_revisions"."variants") > 0)
);
--> statement-breakpoint
CREATE TABLE "pronunciation_glossary_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "policy_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pronunciation_glossary_revisions_revision_positive_check" CHECK ("pronunciation_glossary_revisions"."revision" > 0),
	CONSTRAINT "pronunciation_glossary_revisions_hash_check" CHECK ("pronunciation_glossary_revisions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "quality_gate_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"video_version_id" text NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_action" "quality_gate_action" NOT NULL,
	"decided_by" "quality_gate_actor" NOT NULL,
	"safe_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_gate_decisions_safe_summary_nonempty_check" CHECK (length(trim("quality_gate_decisions"."safe_summary")) > 0)
);
--> statement-breakpoint
CREATE TABLE "voice_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_asset_id" text,
	"consent_evidence_asset_id" text,
	"subject_name" varchar(160) NOT NULL,
	"allowed_uses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "voice_authorization_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone,
	"safe_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_authorizations_subject_nonempty_check" CHECK (length(trim("voice_authorizations"."subject_name")) > 0),
	CONSTRAINT "voice_authorizations_allowed_uses_nonempty_check" CHECK (jsonb_array_length("voice_authorizations"."allowed_uses") > 0)
);
--> statement-breakpoint
-- Referenced composite keys must exist before PostgreSQL creates the child
-- foreign keys below.  Drizzle emits table constraints before indexes, so
-- keep the parent indexes needed by this migration at the dependency edge.
CREATE UNIQUE INDEX "delivery_plan_revisions_workspace_project_id_key" ON "delivery_plan_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_authorizations_workspace_project_id_key" ON "voice_authorizations" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "pronunciation_glossary_revisions_workspace_project_id_key" ON "pronunciation_glossary_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
ALTER TABLE "brand_policy_revisions" ADD CONSTRAINT "brand_policy_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_policy_revisions" ADD CONSTRAINT "brand_policy_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_workspace_project_delivery_fk" FOREIGN KEY ("workspace_id","project_id","delivery_plan_revision_id") REFERENCES "public"."delivery_plan_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_profile_revisions" ADD CONSTRAINT "capability_profile_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_profile_revisions" ADD CONSTRAINT "capability_profile_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_decision_logs" ADD CONSTRAINT "creative_decision_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_decision_logs" ADD CONSTRAINT "creative_decision_logs_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_decision_logs" ADD CONSTRAINT "creative_decision_logs_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_workspace_project_brief_fk" FOREIGN KEY ("workspace_id","project_id","creative_brief_revision_id") REFERENCES "public"."creative_brief_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_workspace_project_storyboard_fk" FOREIGN KEY ("workspace_id","project_id","storyboard_revision_id") REFERENCES "public"."storyboard_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_plan_revisions" ADD CONSTRAINT "delivery_plan_revisions_workspace_project_consumed_run_fk" FOREIGN KEY ("workspace_id","project_id","consumed_by_production_run_id") REFERENCES "public"."production_runs"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_plan_revisions" ADD CONSTRAINT "narration_plan_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_plan_revisions" ADD CONSTRAINT "narration_plan_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_plan_revisions" ADD CONSTRAINT "narration_plan_revisions_workspace_project_delivery_fk" FOREIGN KEY ("workspace_id","project_id","delivery_plan_revision_id") REFERENCES "public"."delivery_plan_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_plan_revisions" ADD CONSTRAINT "narration_plan_revisions_workspace_project_voice_auth_fk" FOREIGN KEY ("workspace_id","project_id","voice_authorization_id") REFERENCES "public"."voice_authorizations"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_plan_revisions" ADD CONSTRAINT "narration_plan_revisions_workspace_project_glossary_fk" FOREIGN KEY ("workspace_id","project_id","pronunciation_glossary_revision_id") REFERENCES "public"."pronunciation_glossary_revisions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_plan_revisions" ADD CONSTRAINT "narration_plan_revisions_workspace_project_sample_asset_fk" FOREIGN KEY ("workspace_id","project_id","sample_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_profile_revisions" ADD CONSTRAINT "output_profile_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_profile_revisions" ADD CONSTRAINT "output_profile_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_profile_revisions" ADD CONSTRAINT "output_profile_revisions_workspace_project_delivery_fk" FOREIGN KEY ("workspace_id","project_id","delivery_plan_revision_id") REFERENCES "public"."delivery_plan_revisions"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciation_glossary_revisions" ADD CONSTRAINT "pronunciation_glossary_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciation_glossary_revisions" ADD CONSTRAINT "pronunciation_glossary_revisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_decisions" ADD CONSTRAINT "quality_gate_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_decisions" ADD CONSTRAINT "quality_gate_decisions_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_decisions" ADD CONSTRAINT "quality_gate_decisions_workspace_project_video_version_fk" FOREIGN KEY ("workspace_id","project_id","video_version_id") REFERENCES "public"."video_versions"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_authorizations" ADD CONSTRAINT "voice_authorizations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_authorizations" ADD CONSTRAINT "voice_authorizations_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_authorizations" ADD CONSTRAINT "voice_authorizations_workspace_project_source_asset_fk" FOREIGN KEY ("workspace_id","project_id","source_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_authorizations" ADD CONSTRAINT "voice_authorizations_workspace_project_consent_asset_fk" FOREIGN KEY ("workspace_id","project_id","consent_evidence_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_policy_revisions_workspace_project_id_key" ON "brand_policy_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_policy_revisions_project_revision_key" ON "brand_policy_revisions" USING btree ("project_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservations_workspace_project_id_key" ON "budget_reservations" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservations_delivery_plan_key" ON "budget_reservations" USING btree ("delivery_plan_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_profile_revisions_workspace_model_key" ON "capability_profile_revisions" USING btree ("workspace_id","project_id","provider_family","model_or_tool","certification_fixture_version");--> statement-breakpoint
CREATE INDEX "capability_profile_revisions_workspace_status_idx" ON "capability_profile_revisions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_decision_logs_workspace_project_id_key" ON "creative_decision_logs" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE INDEX "creative_decision_logs_workspace_project_created_at_idx" ON "creative_decision_logs" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_plan_revisions_project_revision_key" ON "delivery_plan_revisions" USING btree ("project_id","revision");--> statement-breakpoint
CREATE INDEX "delivery_plan_revisions_workspace_project_created_at_idx" ON "delivery_plan_revisions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "narration_plan_revisions_workspace_project_id_key" ON "narration_plan_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "narration_plan_revisions_delivery_revision_key" ON "narration_plan_revisions" USING btree ("delivery_plan_revision_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "output_profile_revisions_workspace_project_id_key" ON "output_profile_revisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "output_profile_revisions_delivery_revision_key" ON "output_profile_revisions" USING btree ("delivery_plan_revision_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "pronunciation_glossary_revisions_project_revision_key" ON "pronunciation_glossary_revisions" USING btree ("project_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_gate_decisions_workspace_project_id_key" ON "quality_gate_decisions" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_gate_decisions_video_version_key" ON "quality_gate_decisions" USING btree ("video_version_id");--> statement-breakpoint
CREATE INDEX "quality_gate_decisions_workspace_project_created_at_idx" ON "quality_gate_decisions" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "voice_authorizations_workspace_project_status_idx" ON "voice_authorizations" USING btree ("workspace_id","project_id","status");
