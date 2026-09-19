import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";

import { createDatabase } from "../src/db.js";
import {
  DrizzleControlPlaneRepository,
  type ProjectCommandInput,
} from "../src/control-plane-repository.js";

const fingerprintRequest = (body: { name: string }) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");

test("Drizzle ControlPlaneRepository persists command replay, conflicts, and workspace scopes", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userA = `usr_c03_pg_a_${suffix}`;
  const workspaceA = `ws_c03_pg_a_${suffix}`;
  const projectA = `prj_c03_pg_a_${suffix}`;
  const missingProject = `prj_c03_missing_${suffix}`;
  const userB = `usr_c03_pg_b_${suffix}`;
  const workspaceB = `ws_c03_pg_b_${suffix}`;
  const projectB = `prj_c03_pg_b_${suffix}`;
  const scope = `c03-pg-${suffix}:POST:/api/v1/projects`;
  const updateScope = `c03-pg-${suffix}:PATCH:/api/v1/projects/${projectA}`;
  const createInput: ProjectCommandInput = {
    scope,
    idempotencyKey: "create-1",
    requestHash: fingerprintRequest({ name: "Postgres project" }),
    workspaceId: workspaceA,
    projectId: projectA,
    name: "Postgres project",
  };
  const database = createDatabase(databaseUrl);

  try {
    const firstRepository = new DrizzleControlPlaneRepository(database.db);
    await firstRepository.ensureDevIdentity({
      user: { id: userA, displayName: "C03 PostgreSQL A" },
      workspace: { id: workspaceA, name: "C03 PostgreSQL A" },
    });
    await firstRepository.ensureDevIdentity({
      user: { id: userB, displayName: "C03 PostgreSQL B" },
      workspace: { id: workspaceB, name: "C03 PostgreSQL B" },
    });

    const created = await firstRepository.createProject(createInput);
    assert.equal(created.kind, "NEW");
    if (created.kind !== "NEW") return;

    const firstMissingUpdate = await firstRepository.updateProject({
      scope: updateScope,
      idempotencyKey: "missing-update-1",
      requestHash: fingerprintRequest({ name: "Reserved missing project" }),
      workspaceId: workspaceA,
      projectId: missingProject,
      name: "Reserved missing project",
    });
    assert.deepEqual(firstMissingUpdate, { kind: "NOT_FOUND", status: 404 });

    const secondDatabase = createDatabase(databaseUrl);
    try {
      const secondRepository = new DrizzleControlPlaneRepository(secondDatabase.db);
      const replayed = await secondRepository.createProject({
        ...createInput,
        projectId: `prj_c03_different_input_${suffix}`,
      });
      assert.equal(replayed.kind, "REPLAY");
      if (replayed.kind !== "REPLAY") return;
      assert.equal(replayed.value.id, projectA);

      const conflict = await secondRepository.createProject({
        ...createInput,
        requestHash: fingerprintRequest({ name: "Different command" }),
        projectId: `prj_c03_conflict_${suffix}`,
      });
      assert.deepEqual(conflict, { kind: "CONFLICT" });

      const createdAfterMissing = await secondRepository.createProject({
        scope: `${scope}:after-missing`,
        idempotencyKey: "create-after-missing-1",
        requestHash: fingerprintRequest({ name: "Created after missing update" }),
        workspaceId: workspaceA,
        projectId: missingProject,
        name: "Created after missing update",
      });
      assert.equal(createdAfterMissing.kind, "NEW");

      const missingReplay = await secondRepository.updateProject({
        scope: updateScope,
        idempotencyKey: "missing-update-1",
        requestHash: fingerprintRequest({ name: "Reserved missing project" }),
        workspaceId: workspaceA,
        projectId: missingProject,
        name: "Reserved missing project",
      });
      assert.deepEqual(missingReplay, { kind: "NOT_FOUND", status: 404 });
      assert.equal((await secondRepository.findProject(workspaceA, missingProject))?.name, "Created after missing update");

      const missingConflict = await secondRepository.updateProject({
        scope: updateScope,
        idempotencyKey: "missing-update-1",
        requestHash: fingerprintRequest({ name: "Different missing command" }),
        workspaceId: workspaceA,
        projectId: missingProject,
        name: "Different missing command",
      });
      assert.deepEqual(missingConflict, { kind: "CONFLICT" });

      const otherProject = await secondRepository.createProject({
        scope: `${scope}:other`,
        idempotencyKey: "create-2",
        requestHash: fingerprintRequest({ name: "Other workspace project" }),
        workspaceId: workspaceB,
        projectId: projectB,
        name: "Other workspace project",
      });
      assert.equal(otherProject.kind, "NEW");
      assert.deepEqual(
        (await secondRepository.listProjects(workspaceA)).map((project) => project.id),
        [projectA, missingProject],
      );
      assert.deepEqual((await secondRepository.listProjects(workspaceB)).map((project) => project.id), [projectB]);
      assert.equal((await secondRepository.findProject(workspaceA, projectB)), undefined);
      assert.equal((await secondRepository.findProject(workspaceB, projectB))?.id, projectB);
      assert.equal(await secondRepository.hasWorkspaceMembership(workspaceA, userB), false);

      const deleteInput = {
        scope: `c03-pg-${suffix}:DELETE:/api/v1/projects/${projectA}`,
        idempotencyKey: "delete-1",
        requestHash: createHash("sha256").update("{}").digest("hex"),
        workspaceId: workspaceA,
        projectId: projectA,
      };
      const deleted = await secondRepository.deleteProject(deleteInput);
      assert.equal(deleted.kind, "NEW");
      if (deleted.kind !== "NEW") return;
      assert.equal(deleted.value.status, "DELETED");
      assert.equal((await secondRepository.findProject(workspaceA, projectA)), undefined);
      assert.equal((await secondRepository.listProjects(workspaceA)).some((project) => project.id === projectA), false);
      const deleteReplay = await secondRepository.deleteProject(deleteInput);
      assert.deepEqual(deleteReplay, { kind: "REPLAY", value: deleted.value, status: 200 });
    } finally {
      await secondDatabase.close();
    }
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`c03-pg-${suffix}%`]);
      await client.query("DELETE FROM projects WHERE id = ANY($1::text[])", [[projectA, projectB, missingProject]]);
      await client.query("DELETE FROM workspace_members WHERE workspace_id = ANY($1::text[])", [[workspaceA, workspaceB]]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [[workspaceA, workspaceB]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[userA, userB]]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
