import { createPrefixedId } from "@alchemy-video/domain";
import { VideoGenerationInputSnapshotSchema } from "@alchemy-video/contracts";
import type { TaskRunStore } from "@alchemy-video/persistence";
import { StorageObjectAlreadyExistsError, createGeneratedVideoObjectKey, type StoragePort } from "@alchemy-video/storage-client";
import type { VideoProviderPort } from "@alchemy-video/provider-video";
import { VideoProviderFailure, VideoProviderProtocolError, validateMp4Bytes } from "@alchemy-video/provider-video";

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
    message: "The local Mock video execution could not complete.",
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
    message: "The local Mock video download or result write could not complete.",
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
  ) {}

  async execute(input: { workspaceId: string; taskRunId: string }) {
    const taskRun = await this.store.findTaskRun(input.workspaceId, input.taskRunId);
    if (!taskRun || ["SUCCEEDED", "FAILED", "ABANDONED"].includes(taskRun.status)) return taskRun;

    const attempt = await this.store.ensureProviderAttempt({
      workspaceId: input.workspaceId,
      taskRunId: input.taskRunId,
      providerAttemptId: createPrefixedId("att"),
      provider: "mock",
      model: String(taskRun.inputSnapshot.model ?? "mock-video-v1"),
      now: new Date(),
    });
    if (!attempt) return this.store.findTaskRun(input.workspaceId, input.taskRunId);

    try {
      let providerRequestId = attempt.providerRequestId;
      if (!providerRequestId) {
        const submission = await this.provider.submit({
          taskRunId: taskRun.id,
          inputSnapshot: VideoGenerationInputSnapshotSchema.parse(taskRun.inputSnapshot),
        });
        providerRequestId = submission.providerRequestId;
        await this.store.recordProviderSubmission({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, providerRequestId: submission.providerRequestId, now: new Date() });
      }

      const firstStatus = await this.provider.getStatus({ providerRequestId });
      if (firstStatus.state === "FAILED") {
        if (firstStatus.retryable) {
          await this.store.recordProviderProcessing({
            workspaceId: input.workspaceId,
            taskRunId: taskRun.id,
            providerAttemptId: attempt.id,
            now: new Date(),
          });
          throw new RetryableTaskExecutionError(firstStatus.message);
        }
        return this.store.failTaskRun({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, code: firstStatus.code, message: firstStatus.message, retryable: firstStatus.retryable, now: new Date() });
      }
      if (firstStatus.state === "PROCESSING") {
        await this.store.recordProviderProcessing({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
      }

      const finalStatus = firstStatus.state === "SUCCEEDED"
        ? firstStatus
        : await this.provider.getStatus({ providerRequestId });
      if (finalStatus.state === "FAILED") {
        if (finalStatus.retryable) {
          await this.store.recordProviderProcessing({
            workspaceId: input.workspaceId,
            taskRunId: taskRun.id,
            providerAttemptId: attempt.id,
            now: new Date(),
          });
          throw new RetryableTaskExecutionError(finalStatus.message);
        }
        return this.store.failTaskRun({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, code: finalStatus.code, message: finalStatus.message, retryable: finalStatus.retryable, now: new Date() });
      }
      if (finalStatus.state !== "SUCCEEDED") {
        throw new VideoProviderProtocolError("Mock provider did not reach a terminal success state.");
      }

      await this.store.recordProviderProcessing({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
      await this.store.beginDownload({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, now: new Date() });
      return await this.finishDownload({ workspaceId: input.workspaceId, taskRunId: taskRun.id, attemptId: attempt.id, projectId: taskRun.projectId });
    } catch (error) {
      if (error instanceof RetryableTaskExecutionError) throw error;
      const failure = providerStageError(error);
      if (failure.retryable) throw new RetryableTaskExecutionError(failure.message);
      return this.store.failTaskRun({ workspaceId: input.workspaceId, taskRunId: taskRun.id, providerAttemptId: attempt.id, failureStage: "PROVIDER", ...failure, now: new Date() });
    }
  }

  private async finishDownload(input: { workspaceId: string; taskRunId: string; attemptId: string; projectId: string }) {
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
      return this.store.completeGeneratedTaskRun({
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
