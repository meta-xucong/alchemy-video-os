import type { ApplicationErrorCode, VideoGenerationInputSnapshot } from "@alchemy-video/contracts";

export type ResolvedVisualInput =
  | { mode: "TEXT" }
  | { mode: "FIRST_FRAME"; url: string }
  | { mode: "REFERENCE_SET"; urls: readonly string[] };

export type VideoGenerationInput = {
  taskRunId: string;
  inputSnapshot: VideoGenerationInputSnapshot;
  // Worker-resolved ephemeral URLs are never persisted in TaskRun or ProviderAttempt records.
  visualInput: ResolvedVisualInput;
};

export type ProviderSubmission = {
  providerRequestId: string;
};

export type ProviderFailureCode = Extract<
  ApplicationErrorCode,
  "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "PROVIDER_PROTOCOL_INVALID" | "DOWNLOAD_INVALID"
>;

export type ProviderStatus =
  | { state: "PROCESSING" }
  | { state: "SUCCEEDED" }
  | { state: "FAILED"; code: ProviderFailureCode; message: string; retryable: boolean };

export type VideoProviderFailureStage = "PROVIDER" | "DOWNLOAD";

export type ProviderDownload = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  contentLength?: number;
};

export interface VideoProviderPort {
  submit(input: VideoGenerationInput): Promise<ProviderSubmission>;
  getStatus(input: { providerRequestId: string }): Promise<ProviderStatus>;
  download(input: { providerRequestId: string }): Promise<ProviderDownload>;
}

export class VideoProviderFailure extends Error {
  constructor(
    readonly code: ProviderFailureCode,
    readonly retryable: boolean,
    readonly stage: VideoProviderFailureStage,
    message: string,
  ) {
    super(message);
    this.name = "VideoProviderFailure";
  }
}

export class VideoProviderProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoProviderProtocolError";
  }
}
