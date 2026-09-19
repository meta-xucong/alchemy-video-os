import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase, DrizzleBillingRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const suffix = `${process.pid}_${Date.now()}`;
const userId = `usr_c09_${suffix}`;
const workspaceId = `ws_c09_${suffix}`;
const projectId = `prj_c09_${suffix}`;
const shotId = `sht_c09_${suffix}`;
const taskRunId = `tsk_c09_${suffix}`;
const otherWorkspaceId = `ws_c09_other_${suffix}`;
const otherProjectId = `prj_c09_other_${suffix}`;
const otherShotId = `sht_c09_other_${suffix}`;
const otherTaskRunId = `tsk_c09_other_${suffix}`;
const idempotencyKey = `video:mock-v1:${taskRunId}`;

test("C09 receipt persistence replays safely and never reads another workspace", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) {
    return;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  const database = createDatabase(databaseUrl);
  const repository = new DrizzleBillingRepository(database.db);

  await client.connect();
  try {
    await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [userId, "C09 Receipt Test"]);
    for (const [targetWorkspaceId, targetProjectId, targetShotId, targetTaskRunId] of [
      [workspaceId, projectId, shotId, taskRunId],
      [otherWorkspaceId, otherProjectId, otherShotId, otherTaskRunId],
    ]) {
      await client.query("INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)", [targetWorkspaceId, targetWorkspaceId, userId]);
      await client.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)", [targetProjectId, targetWorkspaceId, targetProjectId]);
      await client.query("INSERT INTO shots (id, workspace_id, project_id, position) VALUES ($1, $2, $3, 0)", [targetShotId, targetWorkspaceId, targetProjectId]);
      await client.query(
        "INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot) VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', 'BILLING_PENDING', '{}'::jsonb)",
        [targetTaskRunId, targetWorkspaceId, targetProjectId, targetShotId],
      );
    }

    const receipt = {
      id: `use_c09_${suffix}`,
      workspaceId,
      creditProvider: "veyra_sub2api" as const,
      taskRunId,
      externalUserId: "42",
      amount: "1.25000000",
      source: "video:mock-v1",
      referenceId: taskRunId,
      idempotencyKey,
      balanceAfter: "8.75000000",
      replayed: false,
    };
    const first = await repository.recordUsageReceipt(receipt);
    const replay = await repository.recordUsageReceipt({ ...receipt, id: `use_c09_replay_${suffix}`, replayed: true });

    assert.equal(first.kind, "RECORDED");
    assert.equal(replay.kind, "REPLAYED");
    assert.equal(replay.record.id, receipt.id);
    assert.equal(replay.record.replayed, false);
    assert.equal((await repository.findUsageReceipt(workspaceId, "veyra_sub2api", idempotencyKey))?.id, receipt.id);
    assert.equal(await repository.findUsageReceipt(otherWorkspaceId, "veyra_sub2api", idempotencyKey), undefined);

    await assert.rejects(
      repository.recordUsageReceipt({ ...receipt, id: `use_c09_conflict_${suffix}`, source: "video:other" }),
      /idempotency key cannot be reused/,
    );
    await assert.rejects(
      repository.recordUsageReceipt({
        ...receipt,
        id: `use_c09_cross_workspace_${suffix}`,
        workspaceId: otherWorkspaceId,
        taskRunId: otherTaskRunId,
        referenceId: otherTaskRunId,
      }),
      /already assigned outside this workspace/,
    );
  } finally {
    await database.close();
    await client.query("DELETE FROM usage_records WHERE workspace_id = ANY($1)", [[workspaceId, otherWorkspaceId]]);
    await client.query("DELETE FROM task_runs WHERE workspace_id = ANY($1)", [[workspaceId, otherWorkspaceId]]);
    await client.query("DELETE FROM shots WHERE workspace_id = ANY($1)", [[workspaceId, otherWorkspaceId]]);
    await client.query("DELETE FROM projects WHERE workspace_id = ANY($1)", [[workspaceId, otherWorkspaceId]]);
    await client.query("DELETE FROM workspaces WHERE id = ANY($1)", [[workspaceId, otherWorkspaceId]]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.end();
  }
});
