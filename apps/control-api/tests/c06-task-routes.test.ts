import assert from "node:assert/strict";
import test from "node:test";

import { InternalTaskRunQueueMessageSchema } from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";

import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const command = {
  model: "mock-video-v1",
  prompt: "A local video task must use the C06 mock provider.",
  duration: 1,
  resolution: "160x90",
  ratio: "16:9",
  reference_asset_ids: [],
};

const createReadyShot = async (app: ReturnType<typeof createApp>) => {
  const project = await readJson(await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-project" },
    body: JSON.stringify({ name: "C06 route project" }),
  }));
  const projectId = project.data.id as string;
  const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-shot" },
    body: JSON.stringify({ position: 0, prompt: "C06 route shot" }),
  }));
  const shotId = shot.data.id as string;
  const ready = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-shot-ready" },
    body: JSON.stringify({ status: "READY" }),
  });
  assert.equal(ready.status, 200);
  return { projectId, shotId };
};

test("C06 generation routes are workspace-scoped, idempotent, and expose only public TaskRun fields", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks });
  const { projectId, shotId } = await createReadyShot(app);
  const request = (key: string, body = command) => app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

  const createdResponse = await request("c06-generation");
  const created = await readJson(createdResponse);
  assert.equal(createdResponse.status, 202);
  assert.equal(created.data.status, "QUEUED");
  assert.match(created.data.id, /^tsk_/);
  assert.equal((await request("c06-generation")).status, 202);
  assert.equal((await request("c06-generation", { ...command, prompt: "different" })).status, 409);
  assert.equal((await request("c06-active-generation")).status, 409);

  const detailResponse = await app.request(`http://localhost/api/v1/task-runs/${created.data.id}`);
  const detail = await readJson(detailResponse);
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(detail.data.attempts, []);
  assert.equal(detail.data.result_asset, null);
  for (const forbidden of ["provider_request_id", "request_payload", "response_payload", "object_key"]) {
    assert.equal(JSON.stringify(detail).includes(forbidden), false, `${forbidden} must not be public`);
  }

  const projectDetail = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}`));
  assert.equal(projectDetail.data.task_runs.length, 1);
  assert.equal(projectDetail.data.task_runs[0].id, created.data.id);
  for (const forbidden of ["provider", "model", "provider_request_id", "request_payload", "response_payload", "object_key"]) {
    assert.equal(Object.hasOwn(projectDetail.data.task_runs[0], forbidden), false, `${forbidden} must not be a public TaskRun field`);
  }
});

test("C06 retries only failed runs and queues the original immutable snapshot", async () => {
  const control = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(control);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks });
  const { shotId } = await createReadyShot(app);
  const created = await readJson(await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry-create" },
    body: JSON.stringify(command),
  }));
  const queued = (await tasks.listWorkspaceEvents({ workspaceId: "ws_dev_default", limit: 10 })).find((event) => event.event_type === "task_run.queued");
  assert.ok(queued && queued.event_type === "task_run.queued");
  if (!queued || queued.event_type !== "task_run.queued") return;
  await tasks.processEvent({
    message: InternalTaskRunQueueMessageSchema.parse({ contract_version: "1.0", event_id: queued.event_id, workspace_id: queued.workspace_id, task_run_id: queued.data.task_run_id, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot }),
    consumerName: "c06-retry-transition",
    workerId: "c06-retry-worker",
    now: new Date(),
    leaseMs: 1_000,
  });
  await tasks.failTaskRun({ workspaceId: "ws_dev_default", taskRunId: created.data.id, code: "PROVIDER_REJECTED", message: "Controlled C06 failure.", retryable: false, now: new Date() });

  const retry = await app.request(`http://localhost/api/v1/task-runs/${created.data.id}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry" },
    body: "{}",
  });
  const retried = await readJson(retry);
  assert.equal(retry.status, 202);
  assert.equal(retried.data.status, "QUEUED");
  assert.equal(retried.data.id, created.data.id);
  assert.equal((await app.request(`http://localhost/api/v1/task-runs/${created.data.id}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry" },
    body: "{}",
  })).status, 202);
  assert.equal((await app.request(`http://localhost/api/v1/task-runs/${createPrefixedId("tsk")}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c06-retry-missing" },
    body: "{}",
  })).status, 404);
});
