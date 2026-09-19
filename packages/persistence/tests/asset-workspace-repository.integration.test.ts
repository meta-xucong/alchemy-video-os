import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

import { createDatabase } from "../src/db.js";
import { DrizzleAssetWorkspaceRepository, type CreateShotInput, type UpdateShotInput } from "../src/asset-workspace-repository.js";
import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";

const fingerprintRequest = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");

test("Drizzle AssetWorkspaceRepository replays C04 terminal outcomes and scopes assets by workspace", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userA = `usr_c04_pg_a_${suffix}`;
  const workspaceA = `ws_c04_pg_a_${suffix}`;
  const projectA = `prj_c04_pg_a_${suffix}`;
  const assetA = `ast_c04_pg_a_${suffix}`;
  const shotA = `sht_c04_pg_a_${suffix}`;
  const missingProject = `prj_c04_pg_missing_${suffix}`;
  const missingShot = `sht_c04_pg_missing_${suffix}`;
  const userB = `usr_c04_pg_b_${suffix}`;
  const workspaceB = `ws_c04_pg_b_${suffix}`;
  const projectB = `prj_c04_pg_b_${suffix}`;
  const assetB = `ast_c04_pg_b_${suffix}`;
  const baseScope = `c04-pg-${suffix}`;
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    await control.ensureDevIdentity({
      user: { id: userA, displayName: "C04 PostgreSQL A" },
      workspace: { id: workspaceA, name: "C04 PostgreSQL A" },
    });
    await control.ensureDevIdentity({
      user: { id: userB, displayName: "C04 PostgreSQL B" },
      workspace: { id: workspaceB, name: "C04 PostgreSQL B" },
    });

    for (const [workspaceId, projectId, name] of [
      [workspaceA, projectA, "C04 project A"],
      [workspaceB, projectB, "C04 project B"],
    ] as const) {
      const created = await control.createProject({
        scope: `${baseScope}:seed:${projectId}`,
        idempotencyKey: "create-1",
        requestHash: fingerprintRequest({ name }),
        workspaceId,
        projectId,
        name,
      });
      assert.equal(created.kind, "NEW");
    }

    const firstRepository = new DrizzleAssetWorkspaceRepository(database.db);
    const uploadCommand = { kind: "IMAGE", filename: "brand.png", mime_type: "image/png", byte_size: 3 };
    const uploadInput = {
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/assets/upload-requests`,
      idempotencyKey: "upload-1",
      requestHash: fingerprintRequest(uploadCommand),
      workspaceId: workspaceA,
      projectId: projectA,
      assetId: assetA,
      kind: "IMAGE" as const,
      objectKey: `${workspaceA}/${projectA}/${assetA}/original.png`,
      filename: "brand.png",
      mimeType: "image/png",
      byteSize: 3,
    };
    const createdAsset = await firstRepository.createUploadAsset(uploadInput);
    assert.equal(createdAsset.kind, "NEW");
    if (createdAsset.kind !== "NEW") return;
    assert.equal(createdAsset.value.status, "PENDING_UPLOAD");

    const musicAssetId = `ast_c04_pg_music_${suffix}`;
    const musicCreated = await firstRepository.createUploadAsset({
      ...uploadInput,
      assetId: musicAssetId,
      kind: "AUDIO",
      objectKey: `${workspaceA}/${projectA}/${musicAssetId}/music.mp3`,
      filename: "music.mp3",
      mimeType: "audio/mpeg",
      audioRole: "MUSIC",
      metadata: { audio_role: "PROVIDER_AMBIENCE", source: "fixture" },
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/assets/upload-requests:music`,
      idempotencyKey: "music-upload-1",
      requestHash: fingerprintRequest({ music: true }),
    });
    assert.equal(musicCreated.kind, "NEW");
    if (musicCreated.kind === "NEW") assert.equal(musicCreated.value.metadata.audio_role, "MUSIC");

    const confirmedAsset = await firstRepository.confirmAssetUpload({
      scope: `${baseScope}:POST:/api/v1/assets/${assetA}/confirm-upload`,
      idempotencyKey: "confirm-1",
      requestHash: fingerprintRequest({ sha256: "a".repeat(64), mime_type: "image/png", byte_size: 3 }),
      workspaceId: workspaceA,
      assetId: assetA,
      sha256: "a".repeat(64),
      mimeType: "image/png",
      byteSize: 3,
      verifyUpload: async () => true,
    });
    assert.equal(confirmedAsset.kind, "NEW");
    if (confirmedAsset.kind !== "NEW") return;
    assert.equal(confirmedAsset.value.status, "READY");

    const invalidAssetId = `ast_c04_pg_invalid_upload_${suffix}`;
    const invalidUploadCommand = {
      ...uploadInput,
      assetId: invalidAssetId,
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/assets/upload-requests:invalid-upload`,
      idempotencyKey: "invalid-upload-create-1",
      requestHash: fingerprintRequest({ filename: "invalid.png" }),
      objectKey: `${workspaceA}/${projectA}/${invalidAssetId}/original.png`,
      filename: "invalid.png",
    };
    assert.equal((await firstRepository.createUploadAsset(invalidUploadCommand)).kind, "NEW");
    const invalidConfirmInput = {
      scope: `${baseScope}:POST:/api/v1/assets/${invalidAssetId}/confirm-upload`,
      idempotencyKey: "invalid-upload-confirm-1",
      requestHash: fingerprintRequest({ sha256: "i".repeat(64), mime_type: "image/png", byte_size: 3 }),
      workspaceId: workspaceA,
      assetId: invalidAssetId,
      sha256: "i".repeat(64),
      mimeType: "image/png",
      byteSize: 3,
      verifyUpload: async () => false,
    };
    assert.deepEqual(await firstRepository.confirmAssetUpload(invalidConfirmInput), { kind: "INVALID_UPLOAD" });
    assert.deepEqual(await firstRepository.confirmAssetUpload(invalidConfirmInput), { kind: "INVALID_UPLOAD" });
    assert.deepEqual(await firstRepository.confirmAssetUpload({ ...invalidConfirmInput, requestHash: fingerprintRequest({ changed: true }) }), { kind: "CONFLICT" });

    const unavailableAssetId = `ast_c04_pg_unavailable_${suffix}`;
    const unavailableUploadCommand = {
      ...invalidUploadCommand,
      assetId: unavailableAssetId,
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/assets/upload-requests:unavailable`,
      idempotencyKey: "unavailable-upload-create-1",
      requestHash: fingerprintRequest({ filename: "unavailable.png" }),
      objectKey: `${workspaceA}/${projectA}/${unavailableAssetId}/original.png`,
      filename: "unavailable.png",
    };
    assert.equal((await firstRepository.createUploadAsset(unavailableUploadCommand)).kind, "NEW");
    const unavailableConfirmInput = {
      ...invalidConfirmInput,
      scope: `${baseScope}:POST:/api/v1/assets/${unavailableAssetId}/confirm-upload`,
      idempotencyKey: "unavailable-confirm-1",
      requestHash: fingerprintRequest({ sha256: "c".repeat(64), mime_type: "image/png", byte_size: 3 }),
      assetId: unavailableAssetId,
      sha256: "c".repeat(64),
      verifyUpload: async () => { throw new Error("storage unavailable"); },
    };
    await assert.rejects(firstRepository.confirmAssetUpload(unavailableConfirmInput), /storage unavailable/);
    assert.deepEqual(await firstRepository.confirmAssetUpload({ ...unavailableConfirmInput, verifyUpload: async () => true }), {
      kind: "NEW",
      value: await firstRepository.findAsset(workspaceA, unavailableAssetId),
      status: 200,
    });

    const createShotInput: CreateShotInput = {
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/shots`,
      idempotencyKey: "shot-1",
      requestHash: fingerprintRequest({ position: 0, prompt: "Opening frame", reference_bindings: [{ asset_id: assetA, role: "STYLE", position: 0 }] }),
      workspaceId: workspaceA,
      projectId: projectA,
      shotId: shotA,
      position: 0,
      prompt: "Opening frame",
      model: null,
      generationSettings: {},
      referenceBindings: [{ assetId: assetA, role: "STYLE", position: 0 }],
    };
    const createdShot = await firstRepository.createShot(createShotInput);
    assert.equal(createdShot.kind, "NEW");
    if (createdShot.kind !== "NEW") return;

    // A durable active task snapshot protects its source asset. Once the task
    // is terminal, the normal soft-delete path remains available.
    const guardTaskId = `tsk_c04_pg_asset_guard_${suffix}`;
    const guardClient = new Client({ connectionString: databaseUrl });
    await guardClient.connect();
    try {
      await guardClient.query(
        `INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot)
         VALUES ($1, $2, $3, $4, 'VIDEO_GENERATION', 'QUEUED', $5::jsonb)`,
        [guardTaskId, workspaceA, projectA, shotA, JSON.stringify({ reference_asset_ids: [assetA] })],
      );
    } finally {
      await guardClient.end();
    }
    const guardedDeleteInput = {
      scope: `${baseScope}:DELETE:/api/v1/assets/${assetA}:active-task`,
      idempotencyKey: "delete-active-task-1",
      requestHash: fingerprintRequest({}),
      workspaceId: workspaceA,
      assetId: assetA,
    };
    assert.deepEqual(await firstRepository.deleteAsset(guardedDeleteInput), { kind: "ASSET_IN_USE" });
    assert.deepEqual(await firstRepository.deleteAsset(guardedDeleteInput), { kind: "ASSET_IN_USE" });
    const releaseClient = new Client({ connectionString: databaseUrl });
    await releaseClient.connect();
    try {
      await releaseClient.query("UPDATE task_runs SET status = 'FAILED' WHERE id = $1", [guardTaskId]);
    } finally {
      await releaseClient.end();
    }

    const positionConflictInput: CreateShotInput = {
      ...createShotInput,
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/shots:position-conflict`,
      idempotencyKey: "position-conflict-1",
      requestHash: fingerprintRequest({ position: 0, prompt: "Duplicate position" }),
      shotId: `sht_c04_pg_position_conflict_${suffix}`,
      prompt: "Duplicate position",
    };
    assert.deepEqual(await firstRepository.createShot(positionConflictInput), { kind: "POSITION_CONFLICT" });

    const invalidReferenceInput: CreateShotInput = {
      ...createShotInput,
      scope: `${baseScope}:POST:/api/v1/projects/${projectA}/shots:invalid-reference`,
      idempotencyKey: "invalid-reference-1",
      requestHash: fingerprintRequest({ position: 1, prompt: "Cross-workspace reference", reference_bindings: [{ asset_id: assetB, role: "STYLE", position: 0 }] }),
      shotId: `sht_c04_pg_invalid_${suffix}`,
      position: 1,
      prompt: "Cross-workspace reference",
      referenceBindings: [{ assetId: assetB, role: "STYLE", position: 0 }],
    };
    assert.deepEqual(await firstRepository.createShot(invalidReferenceInput), { kind: "INVALID_REFERENCE" });

    const missingProjectInput: CreateShotInput = {
      ...createShotInput,
      scope: `${baseScope}:POST:/api/v1/projects/${missingProject}/shots`,
      idempotencyKey: "missing-project-1",
      requestHash: fingerprintRequest({ position: 0, prompt: "Missing project" }),
      projectId: missingProject,
      shotId: `sht_c04_pg_missing_project_${suffix}`,
      prompt: "Missing project",
      referenceBindings: [],
    };
    assert.deepEqual(await firstRepository.createShot(missingProjectInput), { kind: "NOT_FOUND", status: 404 });

    const missingAsset = `ast_c04_pg_missing_${suffix}`;
    const missingConfirmInput = {
      scope: `${baseScope}:POST:/api/v1/assets/${missingAsset}/confirm-upload`,
      idempotencyKey: "missing-confirm-1",
      requestHash: fingerprintRequest({ sha256: "b".repeat(64), mime_type: "image/png", byte_size: 3 }),
      workspaceId: workspaceA,
      assetId: missingAsset,
      sha256: "b".repeat(64),
      mimeType: "image/png",
      byteSize: 3,
      verifyUpload: async () => true,
    };
    assert.deepEqual(await firstRepository.confirmAssetUpload(missingConfirmInput), { kind: "NOT_FOUND", status: 404 });

    const missingShotUpdate = {
      scope: `${baseScope}:PATCH:/api/v1/shots/${missingShot}`,
      idempotencyKey: "missing-shot-1",
      requestHash: fingerprintRequest({ prompt: "Missing shot" }),
      workspaceId: workspaceA,
      shotId: missingShot,
      prompt: "Missing shot",
    };
    assert.deepEqual(await firstRepository.updateShot(missingShotUpdate), { kind: "NOT_FOUND", status: 404 });

    const secondDatabase = createDatabase(databaseUrl);
    try {
      const secondRepository = new DrizzleAssetWorkspaceRepository(secondDatabase.db);
      const replayedAsset = await secondRepository.createUploadAsset({ ...uploadInput, assetId: `ast_c04_pg_replayed_${suffix}` });
      assert.equal(replayedAsset.kind, "REPLAY");
      if (replayedAsset.kind === "REPLAY") assert.equal(replayedAsset.value.id, assetA);
      assert.deepEqual(await secondRepository.createUploadAsset({ ...uploadInput, requestHash: fingerprintRequest({ ...uploadCommand, filename: "different.png" }) }), { kind: "CONFLICT" });

      const replayedShot = await secondRepository.createShot({ ...createShotInput, shotId: `sht_c04_pg_replayed_${suffix}` });
      assert.equal(replayedShot.kind, "REPLAY");
      if (replayedShot.kind === "REPLAY") assert.equal(replayedShot.value.id, shotA);
      assert.deepEqual(await secondRepository.createShot(invalidReferenceInput), { kind: "INVALID_REFERENCE" });
      assert.deepEqual(await secondRepository.createShot({ ...invalidReferenceInput, requestHash: fingerprintRequest({ changed: true }) }), { kind: "CONFLICT" });
      assert.deepEqual(await secondRepository.createShot(positionConflictInput), { kind: "POSITION_CONFLICT" });
      assert.deepEqual(await secondRepository.createShot({ ...positionConflictInput, requestHash: fingerprintRequest({ changed: true }) }), { kind: "CONFLICT" });

      const createdMissingAsset = await secondRepository.createUploadAsset({
        ...uploadInput,
        assetId: missingAsset,
        scope: `${baseScope}:seed:${missingAsset}`,
        idempotencyKey: "create-1",
        requestHash: fingerprintRequest({ name: "Appeared after confirm 404" }),
        objectKey: `${workspaceA}/${projectA}/${missingAsset}/original.png`,
      });
      assert.equal(createdMissingAsset.kind, "NEW");
      assert.deepEqual(await secondRepository.confirmAssetUpload(missingConfirmInput), { kind: "NOT_FOUND", status: 404 });
      assert.deepEqual(await secondRepository.confirmAssetUpload({ ...missingConfirmInput, requestHash: fingerprintRequest({ changed: true }) }), { kind: "CONFLICT" });

      const createdMissingProject = await control.createProject({
        scope: `${baseScope}:seed:${missingProject}`,
        idempotencyKey: "create-1",
        requestHash: fingerprintRequest({ name: "Appeared after a 404" }),
        workspaceId: workspaceA,
        projectId: missingProject,
        name: "Appeared after a 404",
      });
      assert.equal(createdMissingProject.kind, "NEW");
      assert.deepEqual(await secondRepository.createShot(missingProjectInput), { kind: "NOT_FOUND", status: 404 });
      assert.deepEqual(await secondRepository.createShot({ ...missingProjectInput, requestHash: fingerprintRequest({ changed: true }) }), { kind: "CONFLICT" });

      const createdMissingShot = await secondRepository.createShot({
        ...createShotInput,
        scope: `${baseScope}:seed:${missingShot}`,
        idempotencyKey: "create-1",
        requestHash: fingerprintRequest({ position: 2, prompt: "Appeared after a 404" }),
        shotId: missingShot,
        position: 2,
        prompt: "Appeared after a 404",
        referenceBindings: [],
      });
      assert.equal(createdMissingShot.kind, "NEW");
      assert.deepEqual(await secondRepository.updateShot(missingShotUpdate), { kind: "NOT_FOUND", status: 404 });
      assert.deepEqual(await secondRepository.updateShot({ ...missingShotUpdate, requestHash: fingerprintRequest({ prompt: "Changed missing shot" }) }), { kind: "CONFLICT" });

      const updatePositionConflict = await secondRepository.updateShot({
        scope: `${baseScope}:PATCH:/api/v1/shots/${missingShot}:position-conflict`,
        idempotencyKey: "position-update-conflict-1",
        requestHash: fingerprintRequest({ position: 0 }),
        workspaceId: workspaceA,
        shotId: missingShot,
        position: 0,
      });
      assert.deepEqual(updatePositionConflict, { kind: "POSITION_CONFLICT" });
      assert.deepEqual(await secondRepository.updateShot({
        scope: `${baseScope}:PATCH:/api/v1/shots/${missingShot}:position-conflict`,
        idempotencyKey: "position-update-conflict-1",
        requestHash: fingerprintRequest({ position: 0 }),
        workspaceId: workspaceA,
        shotId: missingShot,
        position: 0,
      }), { kind: "POSITION_CONFLICT" });
      assert.deepEqual(await secondRepository.updateShot({
        scope: `${baseScope}:PATCH:/api/v1/shots/${missingShot}:position-conflict`,
        idempotencyKey: "position-update-conflict-1",
        requestHash: fingerprintRequest({ position: 0, prompt: "different" }),
        workspaceId: workspaceA,
        shotId: missingShot,
        position: 0,
        prompt: "different",
      }), { kind: "CONFLICT" });

      const concurrentPositionInputs = [0, 1].map((index) => ({
        ...createShotInput,
        scope: `${baseScope}:POST:/api/v1/projects/${projectA}/shots:concurrent-position:${index}`,
        idempotencyKey: `concurrent-position-${index}`,
        requestHash: fingerprintRequest({ position: 3, prompt: `Concurrent ${index}` }),
        shotId: `sht_c04_pg_concurrent_${index}_${suffix}`,
        position: 3,
        prompt: `Concurrent ${index}`,
        referenceBindings: [],
      }));
      const concurrentPositionResults = await Promise.all(concurrentPositionInputs.map((input) => secondRepository.createShot(input)));
      assert.deepEqual(concurrentPositionResults.map((result) => result.kind).sort(), ["NEW", "POSITION_CONFLICT"]);

      const deleteAssetInput = {
        scope: `${baseScope}:DELETE:/api/v1/assets/${assetA}`,
        idempotencyKey: "delete-asset-1",
        requestHash: fingerprintRequest({}),
        workspaceId: workspaceA,
        assetId: assetA,
      };
      const deletedAsset = await secondRepository.deleteAsset(deleteAssetInput);
      assert.equal(deletedAsset.kind, "NEW");
      if (deletedAsset.kind === "NEW") assert.equal(deletedAsset.value.status, "DELETED");
      const replayedDelete = await secondRepository.deleteAsset(deleteAssetInput);
      assert.equal(replayedDelete.kind, "REPLAY");
      const deletedReferenceAttempt = await secondRepository.createShot({
        ...createShotInput,
        scope: `${baseScope}:POST:/api/v1/projects/${projectA}/shots:deleted-reference`,
        idempotencyKey: "deleted-reference-1",
        requestHash: fingerprintRequest({ position: 4, prompt: "Deleted reference" }),
        shotId: `sht_c04_pg_deleted_reference_${suffix}`,
        position: 4,
        prompt: "Deleted reference",
      });
      assert.deepEqual(deletedReferenceAttempt, { kind: "INVALID_REFERENCE" });

      const detail = await secondRepository.findProjectDetail(workspaceA, projectA);
      assert.equal(detail?.assets[0]?.id, assetA);
      assert.equal(detail?.assets[0]?.status, "DELETED");
      assert.equal(detail?.shots[0]?.id, shotA);
      assert.deepEqual(detail?.referenceBindings.map((binding) => binding.assetId), [assetA]);
      assert.equal(await secondRepository.findAsset(workspaceB, assetA), undefined);
      assert.equal(await secondRepository.findProjectDetail(workspaceB, projectA), undefined);
    } finally {
      await secondDatabase.close();
    }

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const snapshots = await client.query<{ response_snapshot: Record<string, unknown> }>(
        "SELECT response_snapshot FROM command_deduplications WHERE scope LIKE $1",
        [`${baseScope}%`],
      );
      for (const row of snapshots.rows) {
        assert.equal(JSON.stringify(row.response_snapshot).includes("object_key"), false);
      }
    } finally {
      await client.end();
    }
  } finally {
    const cleanupClient = new Client({ connectionString: databaseUrl });
    await cleanupClient.connect();
    try {
      await cleanupClient.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${baseScope}%`]);
      await cleanupClient.query("DELETE FROM projects WHERE id = ANY($1::text[])", [[projectA, projectB, missingProject]]);
      await cleanupClient.query("DELETE FROM workspace_members WHERE workspace_id = ANY($1::text[])", [[workspaceA, workspaceB]]);
      await cleanupClient.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [[workspaceA, workspaceB]]);
      await cleanupClient.query("DELETE FROM users WHERE id = ANY($1::text[])", [[userA, userB]]);
    } finally {
      await cleanupClient.end();
      await database.close();
    }
  }
});
