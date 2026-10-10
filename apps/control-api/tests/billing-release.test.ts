import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import {
  createDatabase, DrizzleAssetWorkspaceRepository, DrizzleControlPlaneRepository, DrizzleTaskRunRepository,
  type AssetWorkspaceStore, type ControlPlaneStore, type TaskRunStore,
} from "@alchemy-video/persistence";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";

import { createApp } from "../src/app.js";
import { InMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { InMemoryControlPlaneStore } from "../src/repository.js";
import { InMemoryTaskRunStore } from "../src/task-run-repository.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });
const json = async (response: Response) => response.json() as Promise<Record<string, any>>;

const exerciseRelease = async (input: {
  control: ControlPlaneStore;
  assets: AssetWorkspaceStore;
  tasks: TaskRunStore;
  userId: string;
  workspaceId: string;
  withBilling?: boolean;
}) => {
  const { control, assets, tasks, userId, workspaceId } = input;
  const withBilling = input.withBilling ?? true;
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const otherShotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const assetId = createPrefixedId("ast");
  const providerAttemptId = createPrefixedId("att");
  const objectKey = `${workspaceId}/${projectId}/${assetId}/generated.mp4`;
  const command = (name: string) => ({ scope: `${userId}:release:${name}`, idempotencyKey: name, requestHash: "a".repeat(64), workspaceId });
  await control.ensureDevIdentity({ user: { id: userId, displayName: "Release fixture" }, workspace: { id: workspaceId, name: "Release fixture" } });
  await control.createProject({ ...command("project"), projectId, name: "Release fixture" });
  for (const [id, position] of [[shotId, 0], [otherShotId, 1]] as const) {
    await assets.createShot({ ...command(`shot-${position}`), projectId, shotId: id, position, prompt: "Offline fixture", model: null, generationSettings: {}, referenceBindings: [] });
    await assets.updateShot({ ...command(`ready-${position}`), shotId: id, status: "READY" });
  }
  const snapshot = {
    model: "mock-video-v1", prompt: "Offline fixture", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [],
    ...(withBilling ? { billing: { external_user_id: 42, billing_rule: {
      creditProvider: "veyra_sub2api" as const, billingRuleKey: "video:release-fixture", chargeAmount: "1", source: "video:release-fixture",
    } } } : {}),
  };
  assert.equal((await tasks.createTaskRun({ ...command("task"), taskRunId, shotId, kind: "VIDEO_GENERATION", inputSnapshot: snapshot, event: event() })).kind, "NEW");
  const queued = (await tasks.listWorkspaceEvents({ workspaceId, limit: 20 })).find((item) => item.event_type === "task_run.queued");
  assert.ok(queued?.event_type === "task_run.queued");
  await tasks.processEvent({ message: {
    contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId,
    attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot,
  }, consumerName: "release-fixture", workerId: "release-fixture", now: new Date(), leaseMs: 1000 });
  const execution = { workspaceId, taskRunId, providerAttemptId, now: new Date() };
  await tasks.ensureProviderAttempt({ ...execution, provider: "mock", model: "mock-video-v1" });
  await tasks.recordProviderProcessing(execution);
  await tasks.beginDownload(execution);
  const generated = { workspaceId, taskRunId, assetId, objectKey, provider: "mock", now: new Date() };
  assert.equal((await tasks.ensureGeneratedAsset(generated))?.id, assetId);
  const storage = new InMemoryStoragePort();
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await storage.putObject({ objectKey, mimeType: "video/mp4", bytes });
  let signedDownloads = 0;
  const signDownload = storage.createDownloadUrl.bind(storage);
  storage.createDownloadUrl = async (request) => { signedDownloads += 1; return signDownload(request); };
  const app = createApp({ store: control, assetStore: assets, taskStore: tasks, storage,
    identity: { async resolve() { return { userId, workspaceId }; } },
  });
  const assertHidden = async (label: string) => {
    assert.equal(await assets.findAsset(workspaceId, assetId), undefined, `${label}: generic repository read`);
    assert.equal(await tasks.findTaskRunResultAsset(workspaceId, assetId), undefined, `${label}: task result read`);
    const project = await json(await app.request(`http://localhost/api/v1/projects/${projectId}`));
    assert.equal(project.data.assets.some((asset: { id: string }) => asset.id === assetId), false, `${label}: project assets`);
    const detail = await json(await app.request(`http://localhost/api/v1/task-runs/${taskRunId}`));
    assert.equal(detail.data.result_asset, null, `${label}: task detail`);
    assert.equal((await app.request(`http://localhost/api/v1/assets/${assetId}/download-url`)).status, 404, `${label}: download`);
    assert.equal(signedDownloads, 0, `${label}: no signing before payment`);
    assert.equal((await assets.createShot({ ...command(`reference-${label}`), projectId, shotId: createPrefixedId("sht"), position: 2,
      prompt: "Reference fixture", model: null, generationSettings: {}, referenceBindings: [{ assetId, role: "STYLE", position: 0 }],
    })).kind, "INVALID_REFERENCE");
    assert.equal((await assets.updateShot({ ...command(`selection-${label}`), shotId: otherShotId, selectedAssetId: assetId })).kind, "INVALID_REFERENCE");
    assert.equal((await assets.updateShot({ ...command(`binding-${label}`), shotId: otherShotId,
      referenceBindings: [{ assetId, role: "STYLE", position: 0 }],
    })).kind, "INVALID_REFERENCE");
    assert.equal((await tasks.createTaskRun({ ...command(`reuse-${label}`), taskRunId: createPrefixedId("tsk"), shotId: otherShotId,
      kind: "VIDEO_GENERATION", inputSnapshot: { ...snapshot, reference_asset_ids: [assetId] }, event: event(),
    })).kind, "INVALID_REFERENCE");
  };
  await assertHidden("DOWNLOADING");
  await tasks.completeGeneratedTaskRun({ ...execution, assetId, sha256, byteSize: bytes.length, width: 16, height: 9, durationMs: 1000 });
  if (withBilling) {
    await assertHidden("BILLING_PENDING");
    // The browser must not turn a server-owned result into an uploaded asset, including on replay.
    for (let replay = 0; replay < 2; replay += 1) {
      const confirmation = await app.request(`http://localhost/api/v1/assets/${assetId}/confirm-upload`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "confirm-generated" },
        body: JSON.stringify({ sha256, mime_type: "video/mp4", byte_size: bytes.length }),
      });
      assert.ok([400, 404].includes(confirmation.status), `generated confirmation: ${confirmation.status}`);
    }
    await tasks.markBillingFailed({ workspaceId, taskRunId, code: "CREDIT_INSUFFICIENT", safeMessage: "Fixture balance insufficient", now: new Date() });
    await assertHidden("BILLING_FAILED");
    assert.equal((await tasks.ensureGeneratedAsset(generated))?.objectKey, objectKey, "internal recovery retains the object");
    assert.equal((await tasks.retryTaskRun({ ...command("billing-retry"), taskRunId, event: event() })).kind, "NEW");
    await tasks.scheduleBillingRetry({ workspaceId, taskRunId, code: "CREDIT_UNAVAILABLE", safeMessage: "Fixture unavailable", retryAt: new Date(0), now: new Date() });
    await assertHidden("RETRY_SCHEDULED");
    assert.equal((await tasks.resumeBillingRetry({ workspaceId, taskRunId, now: new Date() }))?.status, "BILLING_PENDING");
    await tasks.markBillingSucceeded({ workspaceId, taskRunId, usageRecordId: createPrefixedId("use"), now: new Date() });
    await tasks.markBillingSucceeded({ workspaceId, taskRunId, usageRecordId: createPrefixedId("use"), now: new Date() });
  }
  assert.equal((await tasks.findTaskRun(workspaceId, taskRunId))?.status, "SUCCEEDED");
  assert.equal((await tasks.findTaskRunResultAsset(workspaceId, assetId))?.sha256, sha256);
  assert.equal(await tasks.findTaskRunResultAsset(createPrefixedId("ws"), assetId), undefined);
  const project = await json(await app.request(`http://localhost/api/v1/projects/${projectId}`));
  assert.equal(project.data.assets.filter((asset: { id: string }) => asset.id === assetId).length, 1);
  const detail = await json(await app.request(`http://localhost/api/v1/task-runs/${taskRunId}`));
  assert.equal(detail.data.result_asset.id, assetId);
  assert.equal((await app.request(`http://localhost/api/v1/assets/${assetId}/download-url`)).status, 200);
  assert.equal(signedDownloads, 1);
  assert.equal((await tasks.listTaskRunAttempts(workspaceId, taskRunId)).length, 1, "billing retries preserve the original attempt");
  assert.equal((await tasks.listWorkspaceEvents({ workspaceId, limit: 100 })).filter((item) => item.event_type === "task_run.succeeded").length, 1);
};

for (const withBilling of [true, false]) {
  test(`in-memory generated video release ${withBilling ? "waits for billing and survives recovery" : "preserves no-billing success"}`, async () => {
    const control = new InMemoryControlPlaneStore();
    const assets = new InMemoryAssetWorkspaceStore(control);
    await exerciseRelease({ control, assets, tasks: new InMemoryTaskRunStore(assets), userId: createPrefixedId("usr"), workspaceId: createPrefixedId("ws"), withBilling });
  });
}

test("PostgreSQL generated video release gates public reads, reuse and upload confirmation until billing succeeds", { skip: !process.env.DATABASE_URL }, async () => {
  const database = createDatabase(process.env.DATABASE_URL!);
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  try {
    await exerciseRelease({ control: new DrizzleControlPlaneRepository(database.db), assets: new DrizzleAssetWorkspaceRepository(database.db),
      tasks: new DrizzleTaskRunRepository(database.db), userId, workspaceId });
  } finally {
    await database.close();
    try {
      await client.query("DELETE FROM command_deduplications WHERE scope LIKE $1", [`${userId}:%`]);
      await client.query("DELETE FROM task_runs WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM shots WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM assets WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally { await client.end(); }
  }
});
