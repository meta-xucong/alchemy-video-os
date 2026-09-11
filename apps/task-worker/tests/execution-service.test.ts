import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPrefixedId } from "@alchemy-video/domain";
import { StorageUnavailableError, createInMemoryStoragePort, type StoragePort } from "@alchemy-video/storage-client";
import { MockVideoProvider, Sub2ApiVideoProvider, VideoProviderFailure, createMockMp4Fixture, resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";
import type { VideoProviderPort } from "@alchemy-video/provider-video";
import type { Sub2ApiTransport, Sub2ApiTransportResponse } from "@alchemy-video/provider-video";

import { InMemoryTaskRunStore } from "../../control-api/src/task-run-repository.js";
import { InMemoryAssetWorkspaceStore } from "../../control-api/src/asset-repository.js";
import { InMemoryControlPlaneStore } from "../../control-api/src/repository.js";
import { MockVideoTaskExecutor } from "../src/execution-service.js";
import { VideoBillingExecutor, type BillingAttemptStore } from "../src/billing-executor.js";
import type { CreditPort } from "@alchemy-video/credit-veyra";
import { createWorkerReferenceDeliveryPort, type ReferenceDeliveryPort } from "../src/reference-delivery.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });

const streamFromBytes = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(bytes);
    controller.close();
  },
});

class C07FakeTransport implements Sub2ApiTransport {
  readonly requests: Array<{ method: "GET" | "POST"; path: string; body?: unknown }> = [];

  constructor(private readonly responses: Sub2ApiTransportResponse[]) {}

  async request(input: Parameters<Sub2ApiTransport["request"]>[0]) {
    this.requests.push(structuredClone(input));
    const response = this.responses.shift();
    if (!response) throw new Error("C07 fake transport received an unexpected request.");
    return response;
  }
}

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
      const bytes = new Uint8Array([0, 1, 2]);
      return Promise.resolve({ stream: streamFromBytes(bytes), mimeType: "video/mp4", contentLength: bytes.byteLength });
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

  readObject(input: Parameters<StoragePort["readObject"]>[0]) {
    return this.storage.readObject(input);
  }
}

class CapturingProvider implements VideoProviderPort {
  readonly submittedVisualInputs: Parameters<VideoProviderPort["submit"]>[0]["visualInput"][] = [];

  constructor(private readonly provider: MockVideoProvider) {}

  get submitCount() {
    return this.provider.submitCount;
  }

  submit(input: Parameters<VideoProviderPort["submit"]>[0]) {
    this.submittedVisualInputs.push(input.visualInput);
    return this.provider.submit(input);
  }

  getStatus(input: Parameters<VideoProviderPort["getStatus"]>[0]) {
    return this.provider.getStatus(input);
  }

  download(input: Parameters<VideoProviderPort["download"]>[0]) {
    return this.provider.download(input);
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

class MustNotDebitCreditPort implements CreditPort {
  async getAccount() {
    throw new Error("The failed generation must not query or debit credit.");
  }

  async debit() {
    throw new Error("The failed generation must not debit credit.");
  }
}

class NoopBillingAttemptStore implements BillingAttemptStore {
  async recordUsageReceipt() {
    throw new Error("The failed generation must not record a usage receipt.");
  }

  async markBillingSucceeded() {
    throw new Error("The failed generation must not mark billing succeeded.");
  }

  async markBillingFailed() {
    throw new Error("The failed generation must not mark billing failed.");
  }

  async scheduleBillingRetry() {
    throw new Error("The failed generation must not schedule billing.");
  }
}

class RetryOnceCreditPort implements CreditPort {
  debitCalls = 0;

  constructor(private readonly firstRetryable = false) {}

  async getAccount() {
    throw new Error("The billing executor should use the debit path only.");
  }

  async debit(input: Parameters<CreditPort["debit"]>[0]) {
    this.debitCalls += 1;
    if (this.debitCalls === 1) {
      throw { code: this.firstRetryable ? "CREDIT_UNAVAILABLE" : "CREDIT_INSUFFICIENT", retryable: this.firstRetryable };
    }
    return {
      externalUserId: input.externalUserId,
      amount: input.amount,
      balanceAfter: "98",
      idempotencyKey: input.idempotencyKey,
      replayed: false,
    };
  }
}

class InMemoryBillingAttemptStore implements BillingAttemptStore {
  constructor(private readonly tasks: InMemoryTaskRunStore) {}

  async recordUsageReceipt(input: Parameters<BillingAttemptStore["recordUsageReceipt"]>[0]) {
    return { kind: "RECORDED" as const, record: { id: input.id } };
  }

  markBillingSucceeded(input: Parameters<BillingAttemptStore["markBillingSucceeded"]>[0]) {
    return this.tasks.markBillingSucceeded(input);
  }

  markBillingFailed(input: Parameters<BillingAttemptStore["markBillingFailed"]>[0]) {
    return this.tasks.markBillingFailed(input);
  }

  scheduleBillingRetry(input: Parameters<BillingAttemptStore["scheduleBillingRetry"]>[0]) {
    return this.tasks.scheduleBillingRetry(input);
  }
}

const prepareTask = async (withBilling = false) => {
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
    inputSnapshot: {
      model: "mock-video-v1",
      prompt: "Generate an offline mock video.",
      duration: 1,
      resolution: "160x90",
      ratio: "16:9",
      reference_asset_ids: [],
      ...(withBilling
        ? {
            billing: {
              external_user_id: 20260909,
              billing_rule: {
                creditProvider: "veyra_sub2api" as const,
                billingRuleKey: "media:usage-surcharge-v1:mock-video-v1",
                usagePricing: { model: "mock-video-v1", multiplier: "0.20", fixedFee: "1" },
                source: "media:aiself-actual-cost-plus-service-fee",
              },
            },
          }
        : {}),
    },
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

const prepareReferenceTask = async () => {
  const control = new InMemoryControlPlaneStore();
  const workspaceId = createPrefixedId("ws");
  const userId = createPrefixedId("usr");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  await control.ensureDevIdentity({ user: { id: userId, displayName: "C09-C Worker" }, workspace: { id: workspaceId, name: "C09-C Worker" } });
  await control.createProject({ scope: "c09-c:project", idempotencyKey: "project", requestHash: "a".repeat(64), workspaceId, projectId, name: "C09-C project" });
  const assets = new InMemoryAssetWorkspaceStore(control);
  const references = await Promise.all([0, 1].map(async (position) => {
    const assetId = createPrefixedId("ast");
    const bytes = new Uint8Array([position + 1, 7, 9]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await assets.createUploadAsset({
      scope: `c09-c:asset:${position}`,
      idempotencyKey: `asset-${position}`,
      requestHash: `${position}`.repeat(64),
      workspaceId,
      projectId,
      assetId,
      kind: "IMAGE",
      objectKey: `${workspaceId}/${projectId}/${assetId}/original.png`,
      filename: `reference-${position}.png`,
      mimeType: "image/png",
      byteSize: bytes.byteLength,
    });
    await assets.confirmAssetUpload({
      scope: `c09-c:asset-confirm:${position}`,
      idempotencyKey: `asset-confirm-${position}`,
      requestHash: `${position + 2}`.repeat(64),
      workspaceId,
      assetId,
      sha256,
      mimeType: "image/png",
      byteSize: bytes.byteLength,
      verifyUpload: async () => true,
    });
    return { assetId, sha256, position };
  }));
  await assets.createShot({
    scope: "c09-c:shot",
    idempotencyKey: "shot",
    requestHash: "b".repeat(64),
    workspaceId,
    projectId,
    shotId,
    position: 0,
    prompt: "Generate a reference-set Mock video.",
    model: "mock-video-v1",
    generationSettings: {},
    referenceBindings: references.map((reference) => ({ assetId: reference.assetId, role: reference.position === 0 ? "STYLE" : "SUBJECT", position: reference.position })),
  });
  await assets.setShotGenerationState({ workspaceId, shotId, status: "READY" });
  const store = new InMemoryTaskRunStore(assets);
  const taskRunId = createPrefixedId("tsk");
  const created = await store.createTaskRun({
    scope: "c09-c:task",
    idempotencyKey: "task",
    requestHash: "c".repeat(64),
    workspaceId,
    taskRunId,
    shotId,
    kind: "VIDEO_GENERATION",
    inputSnapshot: {
      model: "mock-video-v1",
      prompt: "Generate a reference-set Mock video.",
      duration: 1,
      resolution: "160x90",
      ratio: "16:9",
      reference_asset_ids: references.map((reference) => reference.assetId),
      visual_input: {
        mode: "REFERENCE_SET",
        references: references.map((reference) => ({ asset_id: reference.assetId, sha256: reference.sha256, mime_type: "image/png" as const, position: reference.position })),
      },
    },
    event: event(),
  });
  assert.equal(created.kind, "NEW");
  const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 10 })).find((item) => item.event_type === "task_run.queued");
  assert.ok(queued && queued.event_type === "task_run.queued");
  if (!queued || queued.event_type !== "task_run.queued") throw new Error("queued reference task missing");
  await store.processEvent({
    message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
    consumerName: "c09-c-task-transition",
    workerId: "c09-c-worker-test",
    now: new Date(),
    leaseMs: 100,
  });
  return { assets, store, workspaceId, projectId, taskRunId, references };
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

test("failed video generation never enters billing even when a service-fee rule is frozen", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask(true);
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture(), outcome: "failed" });
  const billingExecutor = new VideoBillingExecutor(
    new MustNotDebitCreditPort(),
    new NoopBillingAttemptStore(),
  );
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), { billingExecutor });

  const result = await executor.execute({ workspaceId, taskRunId });

  assert.equal(result?.status, "FAILED");
  assert.equal(result?.resultAssetId, null);
  assert.equal((await store.findTaskRun(workspaceId, taskRunId))?.status, "FAILED");
});

test("invalid video output never enters billing even when a service-fee rule is frozen", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask(true);
  const provider = new FailFirstDownloadProvider(new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() }));
  const billingExecutor = new VideoBillingExecutor(
    new MustNotDebitCreditPort(),
    new NoopBillingAttemptStore(),
  );
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), { billingExecutor });

  const result = await executor.execute({ workspaceId, taskRunId });

  assert.equal(result?.status, "FAILED");
  assert.equal(result?.error?.code, "DOWNLOAD_INVALID");
  assert.equal(result?.resultAssetId, null);
});

test("billing failure retry resumes the validated artifact without resubmitting the Provider", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask(true);
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const credit = new RetryOnceCreditPort();
  const billingExecutor = new VideoBillingExecutor(credit, new InMemoryBillingAttemptStore(store), {
    createUsageRecordId: () => createPrefixedId("use"),
  });
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), {
    billingExecutor,
    videoUsage: {
      async getUsage(input) {
        return { providerRequestId: input.providerRequestId, model: "mock-video-v1", actualCost: "1" };
      },
    },
  });

  const failedBilling = await executor.execute({ workspaceId, taskRunId });
  assert.equal(failedBilling?.status, "BILLING_FAILED");
  assert.equal(provider.submitCount, 1);

  const retried = await store.retryTaskRun({
    scope: "c13:billing-retry",
    idempotencyKey: "billing-retry",
    requestHash: "billing-retry".padEnd(64, "0"),
    workspaceId,
    taskRunId,
    event: event(),
  });
  assert.equal(retried.kind, "NEW");
  assert.equal(retried.kind === "NEW" ? retried.value.status : "STATE_INVALID", "BILLING_PENDING");
  const wake = (await store.listWorkspaceEvents({ workspaceId, limit: 30 }))
    .filter((item) => item.event_type === "task_run.queued")
    .at(-1);
  assert.ok(wake && wake.event_type === "task_run.queued");
  if (!wake || wake.event_type !== "task_run.queued") throw new Error("billing retry wake event missing");
  assert.equal(await store.processEvent({
    message: { contract_version: "1.0", event_id: wake.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: wake.correlation_id, input_snapshot: wake.data.input_snapshot },
    consumerName: "c13-billing-retry",
    workerId: "c13-worker",
    now: new Date(),
    leaseMs: 100,
  }), "PROCESSED");

  const recovered = await executor.execute({ workspaceId, taskRunId });
  assert.equal(recovered?.status, "SUCCEEDED");
  assert.equal(credit.debitCalls, 2);
  assert.equal(provider.submitCount, 1);
});

test("a scheduled credit retry is recovered after restart without a second Provider submission", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask(true);
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const credit = new RetryOnceCreditPort(true);
  const billingExecutor = new VideoBillingExecutor(credit, new InMemoryBillingAttemptStore(store), {
    createUsageRecordId: () => createPrefixedId("use"),
    now: () => new Date(0),
  });
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), {
    billingExecutor,
    videoUsage: {
      async getUsage(input) {
        return { providerRequestId: input.providerRequestId, model: "mock-video-v1", actualCost: "1" };
      },
    },
  });

  const scheduled = await executor.execute({ workspaceId, taskRunId });
  assert.equal(scheduled?.status, "RETRY_SCHEDULED");
  assert.equal(provider.submitCount, 1);
  assert.equal((await store.listRecoverableVideoTaskRuns({ limit: 10 })).some((task) => task.id === taskRunId), true);

  const recovered = await executor.recover({ limit: 10, maxAttempts: 1 });
  assert.equal(recovered[0]?.failure, undefined);
  assert.equal((await store.findTaskRun(workspaceId, taskRunId))?.status, "SUCCEEDED");
  assert.equal(credit.debitCalls, 2);
  assert.equal(provider.submitCount, 1);
});

test("a billing bridge outage during recovery becomes an explicit billing failure", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask(true);
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), {
    videoUsage: {
      async getUsage(input) {
        return { providerRequestId: input.providerRequestId, model: "mock-video-v1", actualCost: "1" };
      },
    },
  });

  await assert.rejects(executor.execute({ workspaceId, taskRunId }), /video download or result write/);
  assert.equal((await store.findTaskRun(workspaceId, taskRunId))?.status, "BILLING_PENDING");
  const recovery = await executor.recover({ limit: 10, maxAttempts: 1 });
  assert.equal(recovery[0]?.failure, "Shared credit billing is not configured for this Worker.");
  await store.finalizeTaskRunExecutionFailure({
    workspaceId,
    taskRunId,
    code: "PROVIDER_UNAVAILABLE",
    message: "Video execution exhausted its recoverable delivery attempts.",
    now: new Date(),
  });
  assert.equal((await store.findTaskRun(workspaceId, taskRunId))?.status, "BILLING_FAILED");
  assert.equal(provider.submitCount, 1);
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

  await assert.rejects(executor.execute({ workspaceId, taskRunId }), /video download or result write/);
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

test("C09-C keeps a still-processing Provider task out of the download path for later recovery", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const provider = new NeverTerminalProvider(await createMockMp4Fixture());
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort());

  await assert.rejects(executor.execute({ workspaceId, taskRunId }), /still processing/);
  const taskRun = await store.findTaskRun(workspaceId, taskRunId);
  assert.equal(taskRun?.status, "PROVIDER_PROCESSING");
  assert.equal(taskRun?.error, null);
  assert.equal(provider.submitCount, 1);
  const [attempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(attempt?.status, "PROCESSING");
  assert.ok(attempt?.providerRequestId);
});

test("C07 rejected submit is preserved as non-retryable PROVIDER_REJECTED by C06", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const transport = new C07FakeTransport([{
    status: 400,
    json: { message: "Synthetic provider rejection." },
  }]);
  const provider = new Sub2ApiVideoProvider(transport);
  const result = await new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort()).execute({ workspaceId, taskRunId });

  assert.equal(result?.status, "FAILED");
  assert.deepEqual(result?.error, {
    code: "PROVIDER_REJECTED",
    message: "Synthetic provider rejection.",
    retryable: false,
  });
  assert.deepEqual(transport.requests.map((request) => request.method), ["POST"]);
});

test("C09 explicit retry after a missing provider task creates a fresh provider attempt", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const transport = new C07FakeTransport([
    { status: 202, json: { id: "req_c09_missing" } },
    { status: 404, json: { message: "Video request not found" } },
    { status: 202, json: { id: "req_c09_fresh" } },
    { status: 200, json: { status: "succeeded" } },
    { status: 200, headers: { "content-type": "video/mp4", "content-length": String(fixture.byteLength) }, stream: streamFromBytes(fixture) },
  ]);
  const executor = new MockVideoTaskExecutor(store, new Sub2ApiVideoProvider(transport), createInMemoryStoragePort());

  const failed = await executor.execute({ workspaceId, taskRunId });
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.error?.code, "PROVIDER_REJECTED");
  const [oldAttempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(oldAttempt?.providerRequestId, "req_c09_missing");
  assert.equal(oldAttempt?.status, "FAILED");

  const retry = await store.retryTaskRun({
    scope: "c09:missing-provider-retry",
    idempotencyKey: "missing-provider-retry",
    requestHash: "f".repeat(64),
    workspaceId,
    taskRunId,
    event: event(),
  });
  assert.equal(retry.kind, "NEW");
  const queued = (await store.listWorkspaceEvents({ workspaceId, limit: 30 })).filter((item) => item.event_type === "task_run.queued").at(-1);
  assert.ok(queued && queued.event_type === "task_run.queued");
  if (!queued || queued.event_type !== "task_run.queued") throw new Error("retry event missing");
  await store.processEvent({
    message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
    consumerName: "c09-missing-provider-retry",
    workerId: "c09-worker",
    now: new Date(),
    leaseMs: 100,
  });
  const succeeded = await executor.execute({ workspaceId, taskRunId });
  assert.equal(succeeded?.status, "SUCCEEDED");
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 2);
  const attempts = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.status, "ABANDONED");
  assert.equal(attempts[1]?.providerRequestId, "req_c09_fresh");
});

test("C07 temporary polling 429 and 503 stay processing and recover without resubmission", async () => {
  const fixture = await createMockMp4Fixture();
  const cases = [
    { temporaryStatus: 429, responsesBeforeRecovery: [{ status: 429 }] },
    { temporaryStatus: 503, responsesBeforeRecovery: [{ status: 200, json: { status: "processing" } }, { status: 503 }] },
  ];
  for (const { temporaryStatus, responsesBeforeRecovery } of cases) {
    const { store, workspaceId, taskRunId } = await prepareTask();
    const providerRequestId = `req_c07_poll_${temporaryStatus}`;
    const transport = new C07FakeTransport([
      { status: 202, json: { id: providerRequestId } },
      ...responsesBeforeRecovery,
      { status: 200, json: { status: "succeeded" } },
      { status: 200, headers: { "content-type": "video/mp4", "content-length": String(fixture.byteLength) }, stream: streamFromBytes(fixture) },
    ]);
    const executor = new MockVideoTaskExecutor(store, new Sub2ApiVideoProvider(transport), createInMemoryStoragePort());

    await assert.rejects(executor.execute({ workspaceId, taskRunId }), /temporarily unavailable/);
    const afterTemporaryFailure = await store.findTaskRun(workspaceId, taskRunId);
    assert.equal(afterTemporaryFailure?.status, "PROVIDER_PROCESSING");
    assert.equal(afterTemporaryFailure?.error, null);
    const [attempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
    assert.equal(attempt?.providerRequestId, providerRequestId);
    assert.equal(attempt?.status, "PROCESSING");
    assert.equal(
      (await store.listWorkspaceEvents({ workspaceId, limit: 30 })).some((item) => item.event_type === "task_run.failed"),
      false,
    );

    const recovered = await executor.execute({ workspaceId, taskRunId });
    assert.equal(recovered?.status, "SUCCEEDED");
    assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);
  }
});

test("C07 download 404 becomes DOWNLOAD_INVALID and retry reuses the persisted request", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const transport = new C07FakeTransport([
    { status: 202, json: { id: "req_c07_download_404" } },
    { status: 200, json: { status: "succeeded" } },
    { status: 404 },
    { status: 200, json: { status: "succeeded" } },
    { status: 200, headers: { "content-type": "video/mp4", "content-length": String(fixture.byteLength) }, stream: streamFromBytes(fixture) },
  ]);
  const provider = new Sub2ApiVideoProvider(transport);
  const storage = createInMemoryStoragePort();
  const executor = new MockVideoTaskExecutor(store, provider, storage);

  const failed = await executor.execute({ workspaceId, taskRunId });
  assert.equal(failed?.status, "FAILED");
  assert.deepEqual(failed?.error, {
    code: "DOWNLOAD_INVALID",
    message: "The SUB2API video download was rejected.",
    retryable: false,
  });
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);

  const retry = await store.retryTaskRun({
    scope: "c07:download-404-retry",
    idempotencyKey: "download-404-retry",
    requestHash: "e".repeat(64),
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
  await store.processEvent({
    message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
    consumerName: "c07-download-404-retry",
    workerId: "c07-worker",
    now: new Date(),
    leaseMs: 100,
  });
  const recovered = await executor.execute({ workspaceId, taskRunId });
  assert.equal(recovered?.status, "SUCCEEDED");
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);
});

test("C07 wrong download MIME is non-retryable and cannot be mistaken for MP4", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const transport = new C07FakeTransport([
    { status: 202, json: { id: "req_c07_wrong_mime" } },
    { status: 200, json: { status: "succeeded" } },
    { status: 200, headers: { "content-type": "application/octet-stream" }, stream: streamFromBytes(new Uint8Array([0, 1, 2])) },
  ]);
  const result = await new MockVideoTaskExecutor(store, new Sub2ApiVideoProvider(transport), createInMemoryStoragePort()).execute({ workspaceId, taskRunId });

  assert.equal(result?.status, "FAILED");
  assert.equal(result?.error?.code, "DOWNLOAD_INVALID");
  assert.equal(result?.error?.retryable, false);
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);
});

test("C07 download length mismatch is DOWNLOAD_INVALID before media persistence", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const transport = new C07FakeTransport([
    { status: 202, json: { id: "req_c07_length_mismatch" } },
    { status: 200, json: { status: "succeeded" } },
    {
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": String(fixture.byteLength + 1) },
      stream: streamFromBytes(fixture),
    },
  ]);
  const storage = createInMemoryStoragePort();
  const result = await new MockVideoTaskExecutor(store, new Sub2ApiVideoProvider(transport), storage).execute({ workspaceId, taskRunId });

  assert.equal(result?.status, "FAILED");
  assert.equal(result?.error?.code, "DOWNLOAD_INVALID");
  assert.equal(result?.error?.retryable, false);
  assert.equal(await store.findGeneratedAssetDraft(workspaceId, taskRunId), undefined);
});

test("C07 temporary download 503 remains recoverable without resubmission", async () => {
  const { store, workspaceId, taskRunId } = await prepareTask();
  const fixture = await createMockMp4Fixture();
  const transport = new C07FakeTransport([
    { status: 202, json: { id: "req_c07_download_503" } },
    { status: 200, json: { status: "processing" } },
    { status: 200, json: { status: "succeeded" } },
    { status: 503, json: { message: "Synthetic temporary outage." } },
    { status: 200, json: { status: "succeeded" } },
    { status: 200, headers: { "content-type": "video/mp4", "content-length": String(fixture.byteLength) }, stream: streamFromBytes(fixture) },
  ]);
  const provider = new Sub2ApiVideoProvider(transport);
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort());

  await assert.rejects(executor.execute({ workspaceId, taskRunId }), /temporarily unavailable/);
  const [attempt] = await store.listTaskRunAttempts(workspaceId, taskRunId);
  assert.equal(attempt?.providerRequestId, "req_c07_download_503");
  assert.equal(attempt?.status, "DOWNLOAD_FAILED");

  const recovered = await executor.execute({ workspaceId, taskRunId });
  assert.equal(recovered?.status, "SUCCEEDED");
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);
});

test("C09-C resolves ordered reference images before exactly one Provider submission", async () => {
  const { assets, store, workspaceId, projectId, taskRunId, references } = await prepareReferenceTask();
  const provider = new CapturingProvider(new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() }));
  const deliveryCalls: Parameters<ReferenceDeliveryPort["createVisualInput"]>[0][] = [];
  const delivery: ReferenceDeliveryPort = {
    async createVisualInput(input) {
      deliveryCalls.push(input);
      return { mode: "REFERENCE_SET", urls: input.visualInput.references.map((reference) => `https://provider-input.invalid/${reference.asset_id}`) };
    },
  };
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), {
    assetStore: assets,
    referenceDelivery: delivery,
  });

  const result = await executor.execute({ workspaceId, taskRunId });
  assert.equal(result?.status, "SUCCEEDED");
  assert.equal(provider.submitCount, 1);
  assert.deepEqual(deliveryCalls[0]?.visualInput.references.map((reference) => reference.asset_id), references.map((reference) => reference.assetId));
  assert.deepEqual(provider.submittedVisualInputs, [{ mode: "REFERENCE_SET", urls: references.map((reference) => `https://provider-input.invalid/${reference.assetId}`) }]);
  assert.equal(deliveryCalls[0]?.workspaceId, workspaceId);
  assert.equal(deliveryCalls[0]?.projectId, projectId);
});

test("C09-C fails before submission when reference delivery is unavailable", async () => {
  const { assets, store, workspaceId, taskRunId } = await prepareReferenceTask();
  const provider = new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() });
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), {
    assetStore: assets,
    referenceDelivery: {
      async createVisualInput() {
        throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", false, "PROVIDER", "Controlled reference delivery outage.");
      },
    },
  });

  const result = await executor.execute({ workspaceId, taskRunId });
  assert.equal(result?.status, "FAILED");
  assert.equal(result?.error?.code, "PROVIDER_UNAVAILABLE");
  assert.equal(provider.submitCount, 0);
  assert.deepEqual(await store.listTaskRunAttempts(workspaceId, taskRunId), []);
});

test("C09-C relay preflight fails before creating an attempt or submitting the Provider", async () => {
  const { assets, store, workspaceId, taskRunId } = await prepareReferenceTask();
  const provider = new CapturingProvider(new MockVideoProvider({ fixtureBytes: await createMockMp4Fixture() }));
  const key = "execution-preflight-secret-with-at-least-32-characters";
  const delivery = createWorkerReferenceDeliveryPort({
    profile: resolveVideoProviderRuntimeProfile("sub2api"),
    environment: {
      REFERENCE_DELIVERY_ORIGIN: "https://video.example.invalid",
      REFERENCE_DELIVERY_SIGNING_KEY: key,
      REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS: "500",
      REFERENCE_DELIVERY_PREFLIGHT_RETRIES: "0",
    },
    fetcher: async () => ({
      status: 503,
      headers: { get: () => "text/plain" },
      body: null,
    }),
  });
  const executor = new MockVideoTaskExecutor(store, provider, createInMemoryStoragePort(), {
    assetStore: assets,
    referenceDelivery: delivery,
  });
  await assert.rejects(() => executor.execute({ workspaceId, taskRunId }), /temporarily unavailable/);
  assert.equal(provider.submitCount, 0);
  assert.deepEqual(await store.listTaskRunAttempts(workspaceId, taskRunId), []);
});
