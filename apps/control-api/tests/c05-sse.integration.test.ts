import assert from "node:assert/strict";
import test from "node:test";

import { InternalTaskRunQueueMessageSchema } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import {
  DrizzleAssetWorkspaceRepository,
  DrizzleControlPlaneRepository,
  DrizzleTaskRunRepository,
  createDatabase,
} from "@alchemy-video/persistence";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";

import { createApp } from "../src/app.js";
import type { IdentityPort } from "../src/identity.js";

const taskCommand = {
  model: "c05-sse-only",
  prompt: "Public SSE must never include this private task prompt.",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  reference_asset_ids: [],
};

const readFirstChunk = async (response: Response) => {
  const reader = response.body?.getReader();
  assert.ok(reader);
  const result = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(result.value);
};

test("C05 SSE replays PostgreSQL events by Last-Event-ID without exposing internal task data", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `c05-sse-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const queuedEventId = createPrefixedId("evt");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const assets = new DrizzleAssetWorkspaceRepository(database.db);
    const tasks = new DrizzleTaskRunRepository(database.db);
    await control.ensureDevIdentity({
      user: { id: userId, displayName: "C05 SSE Test" },
      workspace: { id: workspaceId, name: "C05 SSE Test" },
    });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "project-create",
      requestHash: fingerprintRequest({ name: "C05 SSE project" }),
      workspaceId,
      projectId,
      name: "C05 SSE project",
    })).kind, "NEW");
    assert.equal((await assets.createShot({
      scope: `${scope}:shot`,
      idempotencyKey: "shot-create",
      requestHash: fingerprintRequest({ position: 0, prompt: "C05 SSE shot" }),
      workspaceId,
      projectId,
      shotId,
      position: 0,
      prompt: "C05 SSE shot",
      model: null,
      generationSettings: {},
      referenceBindings: [],
    })).kind, "NEW");
    assert.equal((await assets.updateShot({
      scope: `${scope}:shot-ready`,
      idempotencyKey: "shot-ready",
      requestHash: fingerprintRequest({ status: "READY" }),
      workspaceId,
      shotId,
      status: "READY",
    })).kind, "NEW");
    const created = await tasks.createTaskRun({
      scope: `${scope}:task`,
      idempotencyKey: "task-create",
      requestHash: fingerprintRequest(taskCommand),
      workspaceId,
      taskRunId,
      shotId,
      kind: "VIDEO_GENERATION",
      inputSnapshot: taskCommand,
      event: {
        eventId: queuedEventId,
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    assert.equal(created.kind, "NEW");
    const queued = (await tasks.listWorkspaceEvents({ workspaceId, limit: 10 })).find((event) => event.event_id === queuedEventId);
    assert.ok(queued && queued.event_type === "task_run.queued");
    if (!queued || queued.event_type !== "task_run.queued") return;
    assert.equal(await tasks.processEvent({
      message: InternalTaskRunQueueMessageSchema.parse({
        contract_version: queued.contract_version,
        event_id: queued.event_id,
        workspace_id: queued.workspace_id,
        task_run_id: queued.data.task_run_id,
        attempt_no: 1,
        correlation_id: queued.correlation_id,
        input_snapshot: queued.data.input_snapshot,
      }),
      consumerName: "c05-sse-test",
      workerId: "c05-sse-worker",
      now: new Date(),
      leaseMs: 100,
    }), "PROCESSED");

    const identity: IdentityPort = {
      async resolve() {
        return { userId, workspaceId };
      },
    };
    const app = createApp({ identity, store: control, assetStore: assets, taskStore: tasks, storage: new InMemoryStoragePort() });
    const first = await app.request(`http://localhost/api/v1/events?workspace_id=${workspaceId}`);
    assert.equal(first.status, 200);
    const firstChunk = await readFirstChunk(first);
    assert.match(firstChunk, new RegExp(`id: ${queuedEventId}`));
    assert.match(firstChunk, /event: task_run\.queued/);
    for (const forbidden of ["input_snapshot", "prompt", "model", "trace_id", "correlation_id", "idempotency_key", "provider", "object_key"]) {
      assert.equal(firstChunk.includes(forbidden), false, `${forbidden} must not reach public SSE`);
    }

    const replay = await app.request(`http://localhost/api/v1/events?workspace_id=${workspaceId}`, {
      headers: { "Last-Event-ID": queuedEventId },
    });
    const replayChunk = await readFirstChunk(replay);
    assert.match(replayChunk, /event: task_run\.started/);
    assert.equal(replayChunk.includes(queuedEventId), false);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${scope}%`]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
