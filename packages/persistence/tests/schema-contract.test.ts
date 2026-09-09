import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assetDerivations,
  assets,
  brandPolicyRevisions,
  budgetReservations,
  commandDeduplications,
  creativeBriefDocumentContexts,
  creativeBriefFactContexts,
  creativeBriefRevisions,
  creativeDecisionLogs,
  capabilityProfileRevisions,
  deliveryPlanRevisions,
  eventConsumptions,
  handoffReviews,
  narrationPlanRevisions,
  narrationAssetVersions,
  narrationScriptRevisions,
  timelinePlans,
  outboxEvents,
  outputProfileRevisions,
  productionSegments,
  productionRuns,
  projects,
  pronunciationGlossaryRevisions,
  providerAttempts,
  qcReports,
  qualityGateDecisions,
  referenceBindings,
  shots,
  taskRuns,
  transitionRepairs,
  usageRecords,
  users,
  videoVersions,
  voiceAuthorizations,
  workspaceMembers,
  workspaces,
  documentKnowledgeRevisions,
  documentKnowledgeSections,
  documentFacts,
} from "../src/schema.js";
import { budgetReservationStatus, capabilityProfileStatus, captionPolicy, continuityStatus, durationPolicy, handoffReviewResult, lipSyncRequirement, policyRevisionStatus, preflightRevisionStatus, productionSegmentStatus, qcStatus, qualityGateAction, qualityGateSeverity, taskRunStatus, transitionRepairStatus, transitionRepairStrategy, videoVersionStatus, voiceAuthorizationStatus, voiceMode } from "../src/schema.js";
import {
  PRODUCTION_SEGMENT_STATUSES,
  QC_STATUSES,
  TASK_RUN_STATUSES,
  TASK_RUN_TERMINAL_STATUSES,
  VIDEO_VERSION_STATUSES,
} from "@alchemy-video/contracts";

test("the C02 schema contains every contract table", () => {
  assert.deepEqual(
    [
      users,
      workspaces,
      workspaceMembers,
      projects,
      assets,
      shots,
      referenceBindings,
      taskRuns,
      providerAttempts,
      usageRecords,
      outboxEvents,
      commandDeduplications,
      eventConsumptions,
    ].map((table) => table[Symbol.for("drizzle:Name")]),
    [
      "users",
      "workspaces",
      "workspace_members",
      "projects",
      "assets",
      "shots",
      "reference_bindings",
      "task_runs",
      "provider_attempts",
      "usage_records",
      "outbox_events",
      "command_deduplications",
      "event_consumptions",
    ],
  );
});

test("the C05 forward migration adds durable outbox and consumption leases", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0004_outbox_delivery_leases.sql"),
    "utf8",
  );

  for (const field of ["available_at", "lease_owner", "lease_expires_at", "dead_lettered_at", "event_consumptions"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.equal(eventConsumptions.attempts.dataType, "number");
  assert.equal(eventConsumptions.eventId.notNull, true);
});

test("the C05 consumption ledger persists workspace scope and matches its outbox row", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0006_overjoyed_captain_cross.sql"),
    "utf8",
  );

  assert.equal(eventConsumptions.workspaceId.notNull, true);
  assert.match(migration, /UPDATE "event_consumptions" AS consumption/);
  assert.match(migration, /"workspace_id" = event\."workspace_id"/);
  assert.match(migration, /event_consumptions_workspace_id_event_id_consumer_name_pk/);
  assert.match(migration, /event_consumptions_event_workspace_outbox_fk/);
  assert.match(migration, /FOREIGN KEY \("event_id","workspace_id"\)/);
  assert.match(migration, /REFERENCES "public"\."outbox_events"\("id","workspace_id"\)/);
  assert.match(migration, /outbox_events_id_workspace_key/);
});

test("the C05 generated snapshot baseline has no duplicate outbox DDL", async () => {
  const baseline = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0005_nervous_miek.sql"),
    "utf8",
  );

  assert.match(baseline, /SELECT 1/);
  assert.doesNotMatch(baseline, /CREATE TABLE|ALTER TABLE|DROP INDEX/i);
});

test("the C11 migration creates composite unique targets before adding their foreign keys", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0009_sad_magma.sql"),
    "utf8",
  );
  const orderedPairs = [
    ["creative_brief_revisions_workspace_project_id_key", "script_revisions_workspace_project_creative_brief_fk"],
    ["script_revisions_workspace_project_id_key", "storyboard_revisions_workspace_project_script_fk"],
    ["storyboard_revisions_workspace_project_id_key", "production_runs_workspace_project_storyboard_fk"],
    ["storyboard_revisions_workspace_project_id_key", "storyboard_shot_specs_workspace_project_storyboard_fk"],
    ["storyboard_shot_specs_workspace_project_id_key", "prompt_packages_workspace_project_shot_spec_fk"],
  ];
  for (const [uniqueTarget, foreignKey] of orderedPairs) {
    assert.ok(migration.indexOf(uniqueTarget) >= 0, `${uniqueTarget} is missing from C11 migration.`);
    assert.ok(migration.indexOf(foreignKey) >= 0, `${foreignKey} is missing from C11 migration.`);
    assert.ok(migration.indexOf(uniqueTarget) < migration.indexOf(foreignKey), `${uniqueTarget} must precede ${foreignKey}.`);
  }
});

test("the C12 schema keeps production rows project-scoped and persists only public-safe media references", () => {
  assert.equal(productionSegments.dependsOnSequences.columnType, "PgJsonb");
  assert.equal(productionSegments.safeSummary.notNull, true);
  assert.equal(assetDerivations.derivedAssetId.notNull, true);
  assert.equal(qcReports.safeSummary.notNull, true);
  assert.equal(qcReports.details.columnType, "PgJsonb");
  assert.equal(videoVersions.assetId.notNull, false);
  assert.equal(videoVersions.durationMs.notNull, false);
  assert.deepEqual(productionSegmentStatus.enumValues, PRODUCTION_SEGMENT_STATUSES);
  assert.deepEqual(qcStatus.enumValues, QC_STATUSES);
  assert.deepEqual(videoVersionStatus.enumValues, VIDEO_VERSION_STATUSES);
});

test("the C12.1 schema persists scoped continuity reviews and bounded local repairs", async () => {
  assert.equal(handoffReviews.safeSummary.notNull, true);
  assert.equal(handoffReviews.reasonCodes.columnType, "PgJsonb");
  assert.equal(transitionRepairs.taskRunId.notNull, false);
  assert.equal(transitionRepairs.durationMs.notNull, true);
  assert.deepEqual(continuityStatus.enumValues, ["NOT_CHECKED", "CHECKING", "GOOD", "AUTO_REPAIRING", "NEEDS_ATTENTION"]);
  assert.deepEqual(handoffReviewResult.enumValues, ["PASS", "BLEND", "BRIDGE_REQUIRED", "UNAVAILABLE", "FAILED"]);
  assert.deepEqual(transitionRepairStrategy.enumValues, ["BLEND", "BRIDGE"]);
  assert.deepEqual(transitionRepairStatus.enumValues, ["PENDING", "GENERATING", "CHECKING", "ACCEPTED", "FAILED"]);
  const migration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0013_perpetual_jimmy_woo.sql"), "utf8");
  for (const token of ["handoff_reviews", "transition_repairs", "continuity_status", "production_runs_auto_repair_count_check"]) {
    assert.match(migration, new RegExp(token));
  }
});

test("the C11.7/C12.7A schema persists provider-preflight facts outside ProductionRun locks", () => {
  assert.equal(deliveryPlanRevisions.consumedByProductionRunId.notNull, false);
  assert.equal(narrationPlanRevisions.voiceAuthorizationId.notNull, false);
  assert.equal(voiceAuthorizations.allowedUses.columnType, "PgJsonb");
  assert.equal(pronunciationGlossaryRevisions.entries.columnType, "PgJsonb");
  assert.equal(brandPolicyRevisions.approvedLogoAssetIds.columnType, "PgJsonb");
  assert.equal(capabilityProfileRevisions.features.columnType, "PgJsonb");
  assert.equal(budgetReservations.estimatedAmount.columnType, "PgNumeric");
  assert.equal(creativeDecisionLogs.safeSummary.notNull, true);
  assert.equal(outputProfileRevisions.variants.columnType, "PgJsonb");
  assert.equal(qualityGateDecisions.videoVersionId.notNull, true);
  assert.equal(productionRuns.deliveryPlanRevisionId.notNull, false);
  assert.deepEqual(preflightRevisionStatus.enumValues, ["DRAFT", "PREFLIGHT_BLOCKED", "AWAITING_APPROVAL", "APPROVED", "CONSUMED", "SUPERSEDED"]);
  assert.deepEqual(durationPolicy.enumValues, ["FLEXIBLE", "EXACT"]);
  assert.deepEqual(captionPolicy.enumValues, ["REQUIRED", "OPTIONAL", "OFF"]);
  assert.deepEqual(lipSyncRequirement.enumValues, ["OFF", "PREFERRED", "REQUIRED"]);
  assert.deepEqual(voiceMode.enumValues, ["PLATFORM_GENERIC", "AUTHORIZED_CLONE", "USER_SOURCE"]);
  assert.deepEqual(capabilityProfileStatus.enumValues, ["DISABLED", "OFFLINE_CERTIFIED", "LIVE_CERTIFIED", "REVOKED"]);
  assert.deepEqual(voiceAuthorizationStatus.enumValues, ["PENDING", "ACTIVE", "REVOKED", "EXPIRED"]);
  assert.deepEqual(policyRevisionStatus.enumValues, ["DRAFT", "APPROVED", "REVOKED", "SUPERSEDED"]);
  assert.deepEqual(budgetReservationStatus.enumValues, ["ESTIMATED", "APPROVED", "REJECTED", "EXCEEDED", "CONSUMED", "RELEASED"]);
  assert.deepEqual(qualityGateSeverity.enumValues, ["BLOCK", "REVISE", "REVIEW", "INFO"]);
  assert.deepEqual(qualityGateAction.enumValues, ["PRESENT", "REVISE_NARRATION", "REVISE_EDIT", "REGENERATE_SEGMENT", "BLOCK", "AWAITING_HUMAN_APPROVAL"]);
});

test("C11.7/C12.7A adds only a nullable delivery-plan link for historical ProductionRun rows", async () => {
  const migration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0018_shiny_scrambler.sql"), "utf8");
  assert.match(migration, /production_runs/);
  assert.match(migration, /delivery_plan_revision_id/);
  assert.equal(migration.includes("NOT NULL"), false);
});

test("C12.7B schema persists measured narration and private transcript quality facts", async () => {
  assert.equal(narrationScriptRevisions.sourceScriptHash.notNull, true);
  assert.equal(narrationAssetVersions.durationMs.notNull, true);
  assert.equal(narrationAssetVersions.canonicalTranscriptCheck.notNull, true);
  assert.equal(timelinePlans.narrationAssetVersionId.notNull, false);
  const migration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0019_luxuriant_celestials.sql"), "utf8");
  const qualityMigration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0020_perpetual_donald_blake.sql"), "utf8");
  for (const token of ["narration_script_revisions", "narration_asset_versions", "timeline_plans", "timeline_plans_workspace_project_asset_version_fk"]) {
    assert.match(migration, new RegExp(token));
  }
  assert.match(qualityMigration, /canonical_transcript_check/);
  assert.match(qualityMigration, /DEFAULT.*UNAVAILABLE/s);
  assert.match(qualityMigration, /DROP DEFAULT/);
  assert.doesNotMatch(migration, /provider_settings.*public/i);
});

test("C12.7B/C12.7C migrations create every composite FK target before its constraint", async () => {
  const migration0017 = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0017_absurd_reptil.sql"), "utf8");
  const migration0019 = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0019_luxuriant_celestials.sql"), "utf8");
  const migration0021 = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0021_groovy_gorgon.sql"), "utf8");
  const orderedPairs = [
    [migration0017, "delivery_plan_revisions_workspace_project_id_key", "budget_reservations_workspace_project_delivery_fk"],
    [migration0017, "delivery_plan_revisions_workspace_project_id_key", "narration_plan_revisions_workspace_project_delivery_fk"],
    [migration0017, "delivery_plan_revisions_workspace_project_id_key", "output_profile_revisions_workspace_project_delivery_fk"],
    [migration0017, "voice_authorizations_workspace_project_id_key", "narration_plan_revisions_workspace_project_voice_auth_fk"],
    [migration0017, "pronunciation_glossary_revisions_workspace_project_id_key", "narration_plan_revisions_workspace_project_glossary_fk"],
    [migration0019, "narration_script_revisions_workspace_project_id_key", "narration_asset_versions_workspace_project_script_fk"],
    [migration0019, "narration_script_revisions_workspace_project_id_key", "timeline_plans_workspace_project_script_fk"],
    [migration0019, "narration_asset_versions_workspace_project_id_key", "timeline_plans_workspace_project_asset_version_fk"],
    [migration0021, "document_knowledge_revisions_workspace_project_id_key", "document_facts_workspace_project_revision_fk"],
    [migration0021, "document_knowledge_revisions_workspace_project_id_key", "document_knowledge_sections_workspace_project_revision_fk"],
    [migration0021, "document_knowledge_sections_workspace_project_id_key", "document_facts_workspace_project_section_fk"],
  ] as const;
  for (const [migration, uniqueTarget, foreignKey] of orderedPairs) {
    assert.ok(migration.indexOf(uniqueTarget) >= 0, `${uniqueTarget} is missing from its migration.`);
    assert.ok(migration.indexOf(foreignKey) >= 0, `${foreignKey} is missing from its migration.`);
    assert.ok(migration.indexOf(uniqueTarget) < migration.indexOf(foreignKey), `${uniqueTarget} must precede ${foreignKey}.`);
  }
});

test("the C12 migration creates composite unique targets before adding their foreign keys", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0010_brown_toad_men.sql"),
    "utf8",
  );
  const orderedPairs = [
    ["task_runs_workspace_project_id_key", "asset_derivations_workspace_project_source_task_run_fk"],
    ["task_runs_workspace_project_id_key", "production_segments_workspace_project_task_run_fk"],
    ["qc_reports_workspace_project_id_key", "asset_derivations_workspace_project_qc_report_fk"],
    ["qc_reports_workspace_project_id_key", "production_segments_workspace_project_qc_report_fk"],
    ["qc_reports_workspace_project_id_key", "video_versions_workspace_project_qc_report_fk"],
  ];
  for (const [uniqueTarget, foreignKey] of orderedPairs) {
    assert.ok(migration.indexOf(uniqueTarget) >= 0, `${uniqueTarget} is missing from C12 migration.`);
    assert.ok(migration.indexOf(foreignKey) >= 0, `${foreignKey} is missing from C12 migration.`);
    assert.ok(migration.indexOf(uniqueTarget) < migration.indexOf(foreignKey), `${uniqueTarget} must precede ${foreignKey}.`);
  }
});

test("creative briefs persist a bounded target resolution with a migration-safe default", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0011_daily_lord_tyger.sql"),
    "utf8",
  );

  assert.equal(creativeBriefRevisions.targetResolution.notNull, true);
  assert.equal(creativeBriefRevisions.targetResolution.columnType, "PgVarchar");
  assert.match(migration, /ADD COLUMN "target_resolution" varchar\(4\) DEFAULT '720p' NOT NULL/);
  assert.match(migration, /creative_brief_revisions_target_resolution_check/);
  assert.match(migration, /'480p', '720p'/);
});

test("usage amounts use exact numeric columns and task runs persist JSON snapshots", () => {
  assert.equal(usageRecords.amount.dataType, "string");
  assert.equal(usageRecords.amount.columnType, "PgNumeric");
  assert.equal(usageRecords.creditProvider.notNull, true);
  assert.equal(taskRuns.inputSnapshot.columnType, "PgJsonb");
  assert.equal(commandDeduplications.responseSnapshot.columnType, "PgJsonb");
});

test("C09 receipt identity is provider-scoped and migration-safe", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0007_sleepy_jubilee.sql"),
    "utf8",
  );
  assert.equal(usageRecords.creditProvider.name, "credit_provider");
  assert.match(migration, /ADD COLUMN "credit_provider" varchar\(64\) DEFAULT 'veyra_sub2api'/);
  assert.match(migration, /UPDATE "usage_records" SET "credit_provider" = 'veyra_sub2api'/);
  assert.match(migration, /ALTER COLUMN "credit_provider" SET NOT NULL/);
  assert.match(migration, /ALTER COLUMN "credit_provider" DROP DEFAULT/);
  assert.match(migration, /usage_records_credit_provider_idempotency_key_key/);
  assert.doesNotMatch(migration, /ADD COLUMN "credit_provider" varchar\(64\) NOT NULL/);
});

test("TaskRun enum follows the ADR-0014 contract", () => {
  assert.deepEqual(taskRunStatus.enumValues, TASK_RUN_STATUSES);
});

test("the ADR-0014 forward migration fixes the active-run index predicate", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0003_task_run_state_machine_contract.sql"),
    "utf8",
  );

  assert.match(migration, /DROP INDEX "task_runs_one_active_shot_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX "task_runs_one_active_shot_key"/);
  assert.match(migration, /NOT IN/i);
  for (const status of TASK_RUN_TERMINAL_STATUSES) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
});

test("the active-run index allows terminal history but rejects a second active TaskRun", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  const workspaceId = "ws_c02_state_machine_test";
  const projectId = "prj_c02_state_machine_test";
  const shotId = "sht_c02_state_machine_test";
  const assetId = "ast_c02_state_machine_test";

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO users (id, display_name) VALUES ($1, $2)",
      ["usr_c02_state_machine_test", "C02 State Machine Test"],
    );
    await client.query(
      "INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)",
      [workspaceId, "C02 State Machine", "usr_c02_state_machine_test"],
    );
    await client.query(
      "INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)",
      [projectId, workspaceId, "C02 State Machine"],
    );
    await client.query(
      "INSERT INTO shots (id, workspace_id, project_id, position) VALUES ($1, $2, $3, $4)",
      [shotId, workspaceId, projectId, 0],
    );
    await client.query(
      "INSERT INTO assets (id, workspace_id, project_id, kind, origin, object_key) VALUES ($1, $2, $3, 'VIDEO', 'GENERATED', $4)",
      [assetId, workspaceId, projectId, `${workspaceId}/${projectId}/${assetId}/result.mp4`],
    );

    for (const status of TASK_RUN_TERMINAL_STATUSES) {
      await client.query(
        "INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot, result_asset_id) VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', $5, '{}'::jsonb, $6)",
        [
          `tsk_c02_terminal_${status.toLowerCase()}`,
          workspaceId,
          projectId,
          shotId,
          status,
          status === "SUCCEEDED" ? assetId : null,
        ],
      );
    }

    await client.query(
      "INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot) VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', 'QUEUED', '{}'::jsonb)",
      ["tsk_c02_active_first", workspaceId, projectId, shotId],
    );
    await assert.rejects(
      client.query(
        "INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot) VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', 'RUNNING', '{}'::jsonb)",
        ["tsk_c02_active_second", workspaceId, projectId, shotId],
      ),
      /task_runs_one_active_shot_key/,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});


test("C11.1 schema freezes project-scoped successful Markdown references", async () => {
  assert.equal(creativeBriefDocumentContexts.markdownSha256.notNull, true);
  assert.equal(creativeBriefDocumentContexts.maxContentCharacters.notNull, true);
  assert.equal(creativeBriefDocumentContexts.sequence.notNull, true);
  const migration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0014_lively_namora.sql"), "utf8");
  for (const token of ["document_conversions_workspace_project_id_key", "creative_brief_document_contexts", "markdown_asset_id", "max_content_characters", "creative_brief_document_contexts_workspace_project_conversion_fk"]) {
    assert.match(migration, new RegExp(token));
  }
  assert.ok(
    migration.indexOf("document_conversions_workspace_project_id_key") < migration.indexOf("creative_brief_document_contexts_workspace_project_conversion_fk"),
    "The composite DocumentConversion target must exist before the frozen-context foreign key.",
  );
});

test("C11.2 schema freezes project-scoped knowledge and brief fact snapshots", async () => {
  assert.equal(documentKnowledgeRevisions.markdownSha256.notNull, true);
  assert.equal(documentKnowledgeRevisions.analyzerVersion.notNull, true);
  assert.equal(documentKnowledgeSections.locator.notNull, true);
  assert.equal(documentFacts.statement.notNull, true);
  assert.equal(creativeBriefFactContexts.snapshotHash.notNull, true);
  assert.equal(creativeBriefFactContexts.selectionReason.notNull, true);
  const migration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0022_nifty_alice.sql"), "utf8");
  const knowledgeMigration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0021_groovy_gorgon.sql"), "utf8");
  const migrations = `${knowledgeMigration}\n${migration}`;
  for (const token of [
    "document_knowledge_revisions",
    "document_knowledge_sections",
    "document_facts",
    "creative_brief_fact_contexts",
    "creative_brief_fact_contexts_workspace_project_revision_fk",
    "creative_brief_fact_contexts_workspace_project_fact_fk",
    "creative_brief_fact_contexts_snapshot_hash_check",
  ]) {
    assert.match(migrations, new RegExp(token));
  }
  assert.ok(
    migrations.indexOf("document_knowledge_revisions_workspace_project_id_key") < migrations.indexOf("creative_brief_fact_contexts_workspace_project_revision_fk"),
    "The knowledge revision target must exist before the frozen fact context foreign key.",
  );
});

test("short-duration migration widens only creative brief and delivery target checks", async () => {
  const migration = await readFile(resolve(import.meta.dirname, "..", "drizzle", "0024_romantic_reaper.sql"), "utf8");
  assert.match(migration, /creative_brief_revisions_target_duration_check/);
  assert.match(migration, /delivery_plan_revisions_target_duration_check/);
  assert.match(migration, /target_duration_seconds\" between 1 and 600/g);
  assert.equal((migration.match(/DROP CONSTRAINT/g) ?? []).length, 2);
  assert.equal((migration.match(/ADD CONSTRAINT/g) ?? []).length, 2);
});

test("a blocked production run does not retain the project active-run lock", async () => {
  const migration = await readFile(
    resolve(import.meta.dirname, "..", "drizzle", "0015_vengeful_gargoyle.sql"),
    "utf8",
  );
  assert.match(migration, /DROP INDEX "production_runs_one_active_project_key"/);
  assert.match(migration, /status.*not in.*'SUCCEEDED'.*'FAILED'.*'BLOCKED'/s);
});
