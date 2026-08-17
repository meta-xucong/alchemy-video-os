import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assetDerivations,
  assets,
  commandDeduplications,
  creativeBriefRevisions,
  eventConsumptions,
  outboxEvents,
  productionSegments,
  projects,
  providerAttempts,
  qcReports,
  referenceBindings,
  shots,
  taskRuns,
  usageRecords,
  users,
  videoVersions,
  workspaceMembers,
  workspaces,
} from "../src/schema.js";
import { productionSegmentStatus, qcStatus, taskRunStatus, videoVersionStatus } from "../src/schema.js";
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
  assert.equal(videoVersions.assetId.notNull, false);
  assert.equal(videoVersions.durationMs.notNull, false);
  assert.deepEqual(productionSegmentStatus.enumValues, PRODUCTION_SEGMENT_STATUSES);
  assert.deepEqual(qcStatus.enumValues, QC_STATUSES);
  assert.deepEqual(videoVersionStatus.enumValues, VIDEO_VERSION_STATUSES);
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
