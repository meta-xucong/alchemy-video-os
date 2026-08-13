import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import { StorageUnavailableError, createInMemoryStoragePort, type StoragePort } from "@alchemy-video/storage-client";
import { MockVideoProvider, createMockMp4Fixture } from "@alchemy-video/provider-video";
import type { VideoProviderPort } from "@alchemy-video/provider-video";

import { InMemoryTaskRunStore } from "../../control-api/src/task-run-repository.js";
import { InMemoryAssetWorkspaceStore } from "../../control-api/src/asset-repository.js";
import { InMemoryControlPlaneStore } from "../../control-api/src/repository.js";
import { MockVideoTaskExecutor } from "../src/execution-service.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });

const streamFromBytes = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(bytes);
    controller.close();
  },
});

class FailFirstDownloadProvider implements VideoProviderPort {
  private failedDownload = false;

  constructor(private readonly provider: MockVideoProvider) {}

  get submitCount() {
    return this.provider.submitCount;
  }

  submit(input: Parameters<VideoProviderPort["submit"]>[0]) {
    return this.provider.submit(input);
  }

  getStatus(input: Parameters<VideoProviderPort["getStatus"]>[0]) {
    return this.provider.getStatus(input);
  }

  download(input: Parameters<VideoProviderPort["download"]>[0]) {
    if (!this.failedDownload) {
      this.failedDownload = true;
      return Promise.resolve(streamFromBytes(new Uint8Array([0, 1, 2])));
    }
    return this.provider.download(input);
  }
}

class FailFirstWriteStorage implements StoragePort {
  private failed = false;

  constructor(private readonly storage: StoragePort) {}

  createUploadUrl(input: Parameters<StoragePort["createUploadUrl"]>[0]) {
    return this.storage.createUploadUrl(input);
  }

  inspectObject(input: Parameters<StoragePort["inspectObject"]>[0]) {
    return this.storage.inspectObject(input);
  }

  async putObject(input: Parameters<StoragePort["putObject"]>[0]) {
    if (!this.failed) {
      this.failed = true;
      throw new StorageUnavailableError("Controlled C06 result write failure.");
    }
    return this.storage.putObject(input);
  }

  createDownloadUrl(input: Parameters<StoragePort["createDownloadUrl"]>[0]) {
    return this.storage.createDownloadUrl(input);
  }
}

class NeverTerminalProvider implements VideoProviderPort {
  private readonly provider: MockVideoProvider;

  constructor(fixtureBytes: Uint8Array) {
    this.provider = new MockVideoProvider({ fixtureBytes });
  }

  get submitCount() {
    return this.provider.submitCount;
  }

  submit(input: Parameters<VideoProviderPort["submit"]>[0]) {
    return this.provider.submit(input);
  }

  async getStatus() {
    return { state: "PROCESSING" as const, progress: 50 };
  }

  download(input: Parameters<VideoProviderPort["download"]>[0]) {
    return this.provider.download(input);
  }
}

const prepareTask = async () => {
  const control = new InMemoryControlPlaneStore();
  const workspaceId = createPrefixedId("ws");
  const userId = createPrefixedId("usr");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  await control.ensureDevIdentity({ user: { id: userId, displayName: "C06 Worker" }, workspace: { id: workspaceId, name: "C06 Worker" } });
  await control.createProject({ scope: "c06:project", idempotencyKey: "project", requestHash: "a".repeat(64), workspaceId, projectId, name: "C06 project" });
  const assets = new InMemoryAssetWorkspaceStore(control);
  await assets.createShot({ scope: "c06:shot", idempotencyKey: "shot", requestHash: "b".repeat(64), workspaceId, projectId, shotId, position: 0, prompt: "Generate an offline mock video.", model: "mock-video-v1", generationSettings: {}, referenceBindings: [] });
  await assets.setShotGenerationState({ workspaceId, shotId, status: "READY" });
  const store = new InMemoryTaskRunStore(assets);
  const taskRunId = createPrefixedId("tsk");
  const created = await store.createTaskRun({
    scope: "c06:task",
    idempotencyKey: "task",
    requestHash: "c".repeat(64),
    workspaceId,
    taskRunId,
    shotId,
    kind: "VIDEO_GENERATION",
    inputSnapshot: { model: "mock-video-v1", prompt: "Generate an offline mock video.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] },
    event: event(),
  });
  assert.equal(created.kind, "NEW");
  const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 10 })).find((item) => item.event_type === "task_run.queued");
  assert.ok(queued && queued.event_type === "task_run.queued");
  if (!queued || queued.event_type !== "task_run.queued") throw new Error("queued event missing");
  await store.processEvent({
    message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
    consumerName: "task-run-transition",
    workerId: "c06-worker-test",
    now: new Date(),
    leaseMs: 100,
  });
  return { assets, store, workspaceId, taskRunId };
};

test("C06 executor produces one immutable playable video asset and does not resubmit after recovery", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const provider = new MockVideoProvider({ fixtureBytes: fixture });
  const storage = createInMemoryStoragePort();
  const executor = new MockVideoTaskExecutor(store, provider, storage);

  const result = await executor.execute({ workspaceId, taskRunId });
  assert.equal(result?.status, "SUCCEEDED");
  assert.equal(provider.submitCount, 1);
  assert.ok(result?.resultAssetId);
  const asset = await store.findTaskRunResultAsset(workspaceId, result!.resultAssetId!);
  assert.equal(asset?.status, "READY");
  assert.equal(asset?.mimeType, "video/mp4");
  assert.ok(asset?.sha256);
  assert.equal((await store.listTaskRunAttempts(workspaceId, taskRunId)).length, 1);

  const replay = await executor.execute({ workspaceId, taskRunId });
  assert.equal(replay?.status, "SUCCEEDED");
  assert.equal(provider.submitCount, 1);
});

test("C06 executor persists the configured Mock provider failure without an asset", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture(), outcome: "failed" });
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort());

  const result = await executor.execute({ workspaceId, taskRunId });
  assert.equal(result?.status, "FAILED");
  assert.equal(result?.error?.code, "PROVIDER_REJECTED");
  assert.equal(result?.resultAssetId, null);
});

test("C06 executor resumes an uploaded draft without a second submission or replacement", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const provider = new MockVideoProvider({ fixtureBytes: fixture });
  const storage = createInMemoryStoragePort();

  const attempt = await store.ensureProviderAttempt({ workspaceId, taskRunId, providerAttemptId: createPrefixedId("att"), provider: "mock", model: "mock-video-v1", now: new Date() });
  assert.ok(attempt);
  const submission = await provider.submit({ taskRunId, inputSnapshot: { model: "mock-video-v1", prompt: "Generate an offline mock video.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] } });
  await store.recordProviderSubmission({ workspaceId, taskRunId, providerAttemptId: attempt!.id, providerRequestId: submission.providerRequestId, now: new Date() });
  await provider.getStatus({ providerRequestId: submission.providerRequestId });
  await provider.getStatus({ providerRequestId: submission.providerRequestId });
  await store.beginDownload({ workspaceId, taskRunId, providerAttemptId: attempt!.id, now: new Date() });
  const assetId = createPrefixedId("ast");
  const draft = await store.ensureGeneratedAsset({ workspaceId, taskRunId, assetId, objectKey: `${workspaceId}/resume/${assetId}/generated.mp4`, now: new Date() });
  assert.ok(draft);
  await storage.putObject({ objectKey: draft!.objectKey, mimeType: "video/mp4", bytes: fixture, ifNoneMatch: "*" });

  const restartedProvider = new MockVideoProvider({ fixtureBytes: fixture });
  const recovered = await new MockVideoTaskExecutor(store, restartedProvider, storage).execute({ workspaceId, taskRunId });
  assert.equal(recovered?.status, "SUCCEEDED");
  assert.equal(recovered?.resultAssetId, assetId);
  assert.equal(restartedProvider.submitCount, 0);
});

test("C06 explicit retry preserves a submitted request and resumes RUNNING through download without a second submit", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const provider = new FailFirstDownloadProvider(new MockVideoProvider({ fixtureBytes: fixture }));
  const storage = createInMemoryStoragePort();
  const executor = new MockVideoTaskExecutor(store, provider, storage);

  const failed = await executor.execute({ workspaceId, taskRunId });
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.error?.code, "DOWNLOAD_INVALID");
  assert.equal(provider.submitCount, 1);
  const [failedAttempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(failedAttempt?.status, "DOWNLOAD_FAILED");
  assert.ok(failedAttempt?.providerRequestId);

  const retry = await store.retryTaskRun({
    scope: "c06:retry-after-download-failure",
    idempotencyKey: "retry-after-download-failure",
    requestHash: "d".repeat(64),
    workspaceId,
    taskRunId,
    event: event(),
  });
  assert.equal(retry.kind, "NEW");
  const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 30 }))
    .filter((item) => item.event_type === "task_run.queued")
    .at(-1);
  assert.ok(queued && queued.event_type === "task_run.queued");
  if (!queued || queued.event_type !== "task_run.queued") throw new Error("retry event missing");
  assert.equal(await store.processEvent({
    message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
    consumerName: "task-run-transition-retry",
    workerId: "c06-worker-retry",
    now: new Date(),
    leaseMs: 100,
  }), "PROCESSED");
  assert.equal((await store.findTaskRun(workspaceId, taskRunId))?.status, "RUNNING");

  const succeeded = await executor.execute({ workspaceId, taskRunId });
  assert.equal(succeeded?.status, "SUCCEEDED");
  assert.equal(provider.submitCount, 1);
  assert.equal((await store.listTaskRunAttempts(workspaceId, taskRunId)).length, 1);
  const timeline = await store.listWorkspaceEvents({ workspaceId, limit: 50 });
  assert.ok(timeline.some((item) => item.event_type === "task_run.progressed" && item.data.status === "PROVIDER_PROCESSING"));
  assert.ok(timeline.some((item) => item.event_type === "task_run.progressed" && item.data.status === "DOWNLOADING"));
  const asset = await store.findTaskRunResultAsset(workspaceId, succeeded!.resultAssetId!);
  assert.equal(asset?.status, "READY");
  assert.equal((await storage.inspectObject({ objectKey: asset!.objectKey }))?.sha256, asset?.sha256);
});

test("C06 transient result storage failure preserves the submitted request for queue retry without replacement", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const provider = new MockVideoProvider({ fixtureBytes: fixture });
  const storage = new FailFirstWriteStorage(createInMemoryStoragePort());
  const executor = new MockVideoTaskExecutor(store, provider, storage);

  await assert.rejects(executor.execute({ workspaceId, taskRunId }), /local Mock video download or result write/);
  assert.equal(provider.submitCount, 1);
  const [interruptedAttempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(interruptedAttempt?.status, "DOWNLOAD_FAILED");
  assert.ok(interruptedAttempt?.providerRequestId);
  const drafts = await store.findGeneratedAssetDraft(workspaceId, taskRunId);
  assert.ok(drafts);
  const succeeded = await executor.execute({ workspaceId, taskRunId });
  assert.equal(succeeded?.status, "SUCCEEDED");
  assert.equal(provider.submitCount, 1);
  assert.equal((await store.listTaskRunAttempts(workspaceId, taskRunId)).length, 1);
  assert.equal(succeeded?.resultAssetId, drafts!.id);
  const asset = await store.findTaskRunResultAsset(workspaceId, drafts!.id);
  assert.equal(asset?.status, "READY");
  assert.equal((await storage.inspectObject({ objectKey: drafts!.objectKey }))?.sha256, asset?.sha256);
});

test("C06 keeps a pre-download provider protocol error out of the download recovery path", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const provider = new NeverTerminalProvider(await createMockMp4Fixture());
  const result = await new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort()).execute({ workspaceId, taskRunId });

  assert.equal(result?.status, "FAILED");
  assert.equal(result?.error?.code, "PROVIDER_PROTOCOL_INVALID");
  assert.equal(provider.submitCount, 1);
  const [attempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(attempt?.status, "FAILED");
  assert.ok(attempt?.providerRequestId);
});
