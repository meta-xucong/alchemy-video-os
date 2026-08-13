import type { VideoGenerationInputSnapshot } from "@alchemy-video/contracts";

export type VideoGenerationInput = {
  taskRunId: string;
  inputSnapshot: VideoGenerationInputSnapshot;
};

export type ProviderSubmission = {
  providerRequestId: string;
};

export type ProviderStatus =
  | { state: "PROCESSING" }
  | { state: "SUCCEEDED" }
  | { state: "FAILED"; code: string; message: string; retryable: boolean };

export interface VideoProviderPort {
  submit(input: VideoGenerationInput): Promise<ProviderSubmission>;
  getStatus(input: { providerRequestId: string }): Promise<ProviderStatus>;
  download(input: { providerRequestId: string }): Promise<ReadableStream<Uint8Array>>;
}

export class VideoProviderProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoProviderProtocolError";
  }
}
