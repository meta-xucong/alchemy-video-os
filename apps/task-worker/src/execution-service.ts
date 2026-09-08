import { createPrefixedId } from "@alchemy-video/domain";
import { VideoGenerationInputSnapshotSchema } from "@alchemy-video/contracts";
import type { AssetWorkspaceStore, TaskRunStore } from "@alchemy-video/persistence";
import { StorageObjectAlreadyExistsError, createGeneratedVideoObjectKey, type StoragePort } from "@alchemy-video/storage-client";
import type { VideoProviderPort } from "@alchemy-video/provider-video";
import { VideoBillingExecutor } from "./billing-executor.js";
import { VideoProviderFailure, VideoProviderProtocolError, validateMp4Bytes } from "@alchemy-video/provider-video";

import type { ReferenceDeliveryPort } from "./reference-delivery.js";

const readStream = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const providerStageError = (error: unknown) => {
  if (error instanceof VideoProviderFailure) {
    return { code: error.code, message: error.message, retryable: error.retryable } as const;
  }
  if (error instanceof VideoProviderProtocolError) {
    return { code: "PROVIDER_PROTOCOL_INVALID", message: error.message, retryable: false } as const;
  }
  return {
    code: "PROVIDER_UNAVAILABLE",
    message: "The video execution could not complete.",
    retryable: true,
  } as const;
};

const downloadStageError = (error: unknown) => {
  if (error instanceof VideoProviderFailure && error.stage === "DOWNLOAD") {
    return { code: error.code, message: error.message, retryable: error.retryable } as const;
  }
  if (error instanceof VideoProviderProtocolError) {
    return { code: "DOWNLOAD_INVALID", message: error.message, retryable: false } as const;
  }
  return {
    code: "PROVIDER_UNAVAILABLE",
    message: "The video download or result write could not complete.",
    retryable: true,
  } as const;
};

class RetryableTaskExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableTaskExecutionError";
  }
}

export class MockVideoTaskExecutor {
  constructor(
    private readonly store: Pick<
      TaskRunStore,
      "findTaskRun" | "listRecoverableVideoTaskRuns" | "listTaskRunAttempts" | "ensureProviderAttempt" | "recordProviderSubmission" | "recordProviderProcessing" | "beginDownload" | "recordDownloadRetryableFailure" | "findGeneratedAssetDraft" | "ensureGeneratedAsset" | "completeGeneratedTaskRun" | "failTaskRun"
    >,
    private readonly provider: VideoProviderPort,
    private readonly storage: StoragePort,
    private readonly options: Readonly<{
      providerName?: string;
      expectedModel?: string;
      pollIntervalMs?: number;
      maxPollAttempts?: number;
      retryableStatusPolls?: number;
      assetStore?: Pick<AssetWorkspaceStore, "findAsset">;
      referenceDelivery?: ReferenceDeliveryPort;
      allowLegacyReferenceAssets?: boolean;
      billingExecutor?: VideoBillingExecutor;
    }> = {},
  ) {}

  async execute(input: { workspaceId: string; taskRunId: string }) {
    const taskRun = await this.store.findTaskRun(input.workspaceId, input.taskRunId);
    if (!taskRun || ["SUCCEEDED", "FAILED", "ABANDONED"].includes(taskRun.status)) return taskRun;

    const inputSnapshot = VideoGenerationInputSnapshotSchema.parse(taskRun.inputSnapshot);
    if (taskRun.status === "BILLING_PENDING" && inputSnapshot.billing && this.options.billingExecutor) {
      await this.options.billingExecutor.execute({
        workspaceId: input.workspaceId,
        chargeRequest: {
          taskRunId: input.taskRunId,
          externalUserId: inputSnapshot.billing.external_user_id,
          billingRule: inputSnapshot.billing.billing_rule,
        },
      });
      return this.store.findTaskRun(input.workspaceId, input.taskRunId);
    }
    const providerName = this.options.providerName ?? "mock";
    if (this.options.expectedModel && inputSnapshot.model !== this.options.expectedModel) {
      return this.store.failTaskRun({
        workspaceId: input.workspaceId,
        taskRunId: taskRun.id,
        code: "PROVIDER_REJECTED",
        message: "The task generation profile is not compatible with this Worker.",
        retryable: false,
        now: new Date(),
      });
    }
    let providerAttemptId: string | undefined;
    try {
      const visualInput = await this.resolveVisualInput({
        workspaceId: input.workspaceId,
        projectId: taskRun.projectId,
        inputSnapshot,
      });
      const attempt = await this.store.ensureProviderAttempt({
        workspaceId: input.workspaceId,
        taskRunId: input.taskRunId,
        providerAttemptId: createPrefixedId("att"),
        provider: providerName,
        model: inputSnapshot.model,
        now: new Date(),
      });
      if (!attempt) return this.store.findTaskRun(input.workspaceId, input.taskRunId);
      providerAttemptId = attempt.id;
      if (attempt.provider !== providerName || attempt.model !== inputSnapshot.model) {
        return this.store.failTaskRun({
          workspaceId: input.workspaceId,
          taskRunId: taskRun.id,
          providerAttemptId: attempt.id,
          code: "PROVIDER_REJECTED",
          message: "The persisted provider attempt is not compatible with this Worker.",
          retryable: false,
          now: new Date(),
        });
      }
      let providerRequestId = attempt.providerRequestId;
      if (!providerRequestId) {
        const submission = await this.provider.submit({
          taskRunId: taskRun.id,
          inputSnapshot,
          visualInput,
        });
        providerRequestId = submission.providerRequestId;
        await this.store.recordProviderSubmission({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, providerRequestId: submission.providerRequestId, now: new Date() });
      }

      const retryableStatusPolls = this.options.retryableStatusPolls ?? 0;
      const getStatusWithTransientRetry = async () => {
        for (let retry = 0; ; retry += 1) {
          try {
            const next = await this.provider.getStatus({ providerRequestId });
            if (next.state !== "FAILED" || !next.retryable || retry >= retryableStatusPolls) return next;
          } catch (error) {
            if (!(error instanceof VideoProviderFailure) || !error.retryable || retry >= retryableStatusPolls) throw error;
          }
          await this.store.recordProviderProcessing({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
          const delay = this.options.pollIntervalMs ?? 0;
          if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
      };
      let status = await getStatusWithTransientRetry();
      const maxPollAttempts = this.options.maxPollAttempts ?? 2;
      for (let pollAttempt = 1; status.state === "PROCESSING"; pollAttempt += 1) {
        await this.store.recordProviderProcessing({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
        if (pollAttempt >= maxPollAttempts) {
          throw new RetryableTaskExecutionError("The video service is still processing this task.");
        }
        const pollIntervalMs = this.options.pollIntervalMs ?? 0;
        if (pollIntervalMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
        status = await getStatusWithTransientRetry();
      }
      if (status.state === "FAILED") {
        if (status.retryable) {
          await this.store.recordProviderProcessing({
            workspaceId: input.workspaceId,
            taskRunId: taskRun.id,
            providerAttemptId: attempt.id,
            now: new Date(),
          });
          throw new RetryableTaskExecutionError(status.message);
        }
        return this.store.failTaskRun({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, code: status.code, message: status.message, retryable: status.retryable, now: new Date() });
      }
      if (status.state !== "SUCCEEDED") {
        throw new VideoProviderProtocolError("Video provider did not reach a terminal success state.");
      }

      await this.store.recordProviderProcessing({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
      await this.store.beginDownload({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
      return await this.finishDownload({ workspaceId: input.workspaceId, taskRunId: taskRun.id, attemptId: attempt.id, projectId: taskRun.projectId, inputSnapshot });
    } catch (error) {
      if (error instanceof RetryableTaskExecutionError) throw error;
      const failure = providerStageError(error);
      if (failure.retryable) throw new RetryableTaskExecutionError(failure.message);
      return this.store.failTaskRun({ workspaceId: input.workspaceId, taskRunId: taskRun.id, ...(providerAttemptId ? { providerAttemptId } : {}), failureStage: "PROVIDER", ...failure, now: new Date() });
    }
  }

  private async resolveVisualInput(input: Readonly<{
    workspaceId: string;
    projectId: string;
    inputSnapshot: ReturnType<typeof VideoGenerationInputSnapshotSchema.parse>;
  }>) {
    const visualInput = input.inputSnapshot.visual_input;
    if (!visualInput) {
      if (input.inputSnapshot.reference_asset_ids.length === 0 || this.options.allowLegacyReferenceAssets) return { mode: "TEXT" as const };
      throw new VideoProviderProtocolError("A real video task with reference assets is missing an immutable visual-input snapshot.");
    }
    if (visualInput.mode === "TEXT") return { mode: "TEXT" as const };
    const assets = this.options.assetStore;
    const delivery = this.options.referenceDelivery;
    if (!assets || !delivery) {
      throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", false, "PROVIDER", "Reference image delivery is not configured for this Worker.");
    }
    const snapshotIds = visualInput.references.map((reference) => reference.asset_id);
    if (snapshotIds.length !== input.inputSnapshot.reference_asset_ids.length
      || snapshotIds.some((assetId, index) => assetId !== input.inputSnapshot.reference_asset_ids[index])) {
      throw new VideoProviderProtocolError("The task reference asset list does not match its visual-input snapshot.");
    }
    const resolvedAssets = await Promise.all(visualInput.references.map(async (reference) => ({
      reference,
      asset: await assets.findAsset(input.workspaceId, reference.asset_id),
    })));
    if (resolvedAssets.some(({ reference, asset }) => !asset
      || asset.projectId !== input.projectId
      || asset.status !== "READY"
      || asset.kind !== "IMAGE"
      || asset.sha256 !== reference.sha256
      || asset.mimeType !== reference.mime_type
      || !asset.byteSize
      || asset.byteSize > 8 * 1024 * 1024)) {
      throw new VideoProviderProtocolError("A reference image no longer matches the immutable task snapshot.");
    }
    return delivery.createVisualInput({ workspaceId: input.workspaceId, projectId: input.projectId, visualInput });
  }

  private async finishDownload(input: { workspaceId: string; taskRunId: string; attemptId: string; projectId: string; inputSnapshot: ReturnType<typeof VideoGenerationInputSnapshotSchema.parse> }) {
    try {
      const attempt = (await this.store.listTaskRunAttempts(input.workspaceId, input.taskRunId)).find((item) => item.id === input.attemptId);
      if (!attempt?.providerRequestId) throw new VideoProviderProtocolError("Provider request was not persisted before download.");
      const download = await this.provider.download({ providerRequestId: attempt.providerRequestId });
      const bytes = await readStream(download.stream);
      if (download.contentLength !== undefined && download.contentLength !== bytes.byteLength) {
        throw new VideoProviderProtocolError("Downloaded media length does not match Content-Length.");
      }
      const inspection = await validateMp4Bytes(bytes, download.mimeType);
      const existingDraft = await this.store.findGeneratedAssetDraft(input.workspaceId, input.taskRunId);
      const taskRun = await this.store.findTaskRun(input.workspaceId, input.taskRunId);
      if (!taskRun) return undefined;
      const assetId = existingDraft?.id ?? taskRun.resultAssetId ?? createPrefixedId("ast");
      const draft = existingDraft ?? await this.store.ensureGeneratedAsset({
        workspaceId: input.workspaceId,
        taskRunId: input.taskRunId,
        assetId,
        objectKey: createGeneratedVideoObjectKey({ workspaceId: input.workspaceId, projectId: input.projectId, assetId }),
        now: new Date(),
      });
      if (!draft) throw new VideoProviderProtocolError("Generated asset could not be reserved.");

      const existing = await this.storage.inspectObject({ objectKey: draft.objectKey });
      if (existing) {
        if (existing.sha256 !== inspection.sha256 || existing.byteSize !== inspection.byteSize || existing.mimeType !== inspection.mimeType) {
          throw new VideoProviderProtocolError("Generated asset object does not match the validated download.");
        }
      } else {
        try {
          await this.storage.putObject({ objectKey: draft.objectKey, mimeType: inspection.mimeType, bytes, ifNoneMatch: "*" });
        } catch (error) {
          if (!(error instanceof StorageObjectAlreadyExistsError)) throw error;
          const raced = await this.storage.inspectObject({ objectKey: draft.objectKey });
          if (!raced || raced.sha256 !== inspection.sha256 || raced.byteSize !== inspection.byteSize || raced.mimeType !== inspection.mimeType) {
            throw new VideoProviderProtocolError("Generated asset object does not match the validated download.");
          }
        }
      }
      const completed = await this.store.completeGeneratedTaskRun({
        workspaceId: input.workspaceId,
        taskRunId: input.taskRunId,
        providerAttemptId: input.attemptId,
        assetId: draft.id,
        sha256: inspection.sha256,
        byteSize: inspection.byteSize,
        width: inspection.width,
        height: inspection.height,
        durationMs: inspection.durationMs,
        now: new Date(),
      });
      const billing = input.inputSnapshot.billing;
      if (!billing) return completed;
      if (!this.options.billingExecutor) throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "Shared credit billing is not configured for this Worker.");
      const billingResult = await this.options.billingExecutor.execute({
        workspaceId: input.workspaceId,
        chargeRequest: { taskRunId: input.taskRunId, externalUserId: billing.external_user_id, billingRule: billing.billing_rule },
      });
      if (billingResult.kind === "RETRY_SCHEDULED") return this.store.findTaskRun(input.workspaceId, input.taskRunId);
      return this.store.findTaskRun(input.workspaceId, input.taskRunId);
    } catch (error) {
      const failure = downloadStageError(error);
      if (failure.retryable) {
        await this.store.recordDownloadRetryableFailure({
          workspaceId: input.workspaceId,
          taskRunId: input.taskRunId,
          providerAttemptId: input.attemptId,
          code: failure.code,
          now: new Date(),
        });
        throw new RetryableTaskExecutionError(failure.message);
      }
      return this.store.failTaskRun({ workspaceId: input.workspaceId, taskRunId: input.taskRunId, providerAttemptId: input.attemptId, failureStage: "DOWNLOAD", ...failure, now: new Date() });
    }
  }

  async recover(input: { limit: number; maxAttempts?: number }) {
    const recovered: Array<{ workspaceId: string; taskRunId: string; attempts: number; status?: string; failure?: string }> = [];
    for (const taskRun of await this.store.listRecoverableVideoTaskRuns({ limit: input.limit })) {
      const maxAttempts = input.maxAttempts ?? 3;
      for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
        try {
          const result = await this.execute({ workspaceId: taskRun.workspaceId, taskRunId: taskRun.id });
          recovered.push({ workspaceId: taskRun.workspaceId, taskRunId: taskRun.id, attempts: attemptNo, status: result?.status });
          break;
        } catch (error) {
          if (attemptNo === maxAttempts) {
            recovered.push({
              workspaceId: taskRun.workspaceId,
              taskRunId: taskRun.id,
              attempts: attemptNo,
              failure: error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 500) : "Unknown recovery failure.",
            });
          }
        }
      }
    }
    return recovered;
  }
}
