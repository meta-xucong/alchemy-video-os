import type { ProviderStatus, VideoGenerationInput, VideoProviderPort } from "./port.js";
import { VideoProviderProtocolError } from "./port.js";

export type MockVideoOutcome = "succeeded" | "failed";

export type MockVideoProviderOptions = {
  fixtureBytes: Uint8Array;
  outcome?: MockVideoOutcome;
};

const requestIdFor = (taskRunId: string) => `mock_${taskRunId}`;

const streamFromBytes = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

export class MockVideoProvider implements VideoProviderPort {
  private readonly statusReads = new Map<string, number>();
  private readonly submitted = new Set<string>();
  private submitCalls = 0;
  private readonly outcome: MockVideoOutcome;
  private readonly fixtureBytes: Uint8Array;

  constructor(options: MockVideoProviderOptions) {
    if (options.fixtureBytes.byteLength === 0) {
      throw new VideoProviderProtocolError("Mock video fixture must not be empty.");
    }
    this.fixtureBytes = options.fixtureBytes;
    this.outcome = options.outcome ?? "succeeded";
  }

  get submitCount() {
    return this.submitCalls;
  }

  async submit(input: VideoGenerationInput) {
    const providerRequestId = requestIdFor(input.taskRunId);
    this.submitCalls += 1;
    this.submitted.add(providerRequestId);
    return { providerRequestId };
  }

  async getStatus(input: { providerRequestId: string }): Promise<ProviderStatus> {
    this.assertRequestId(input.providerRequestId);
    if (this.outcome === "failed") {
      return {
        state: "FAILED",
        code: "PROVIDER_REJECTED",
        message: "Mock video generation was configured to fail.",
        retryable: false,
      };
    }
    const reads = (this.statusReads.get(input.providerRequestId) ?? 0) + 1;
    this.statusReads.set(input.providerRequestId, reads);
    return reads === 1 ? { state: "PROCESSING" } : { state: "SUCCEEDED" };
  }

  async download(input: { providerRequestId: string }) {
    this.assertRequestId(input.providerRequestId);
    if (this.outcome === "failed") {
      throw new VideoProviderProtocolError("A failed mock request cannot be downloaded.");
    }
    return {
      stream: streamFromBytes(this.fixtureBytes.slice()),
      mimeType: "video/mp4",
      contentLength: this.fixtureBytes.byteLength,
    };
  }

  private assertRequestId(providerRequestId: string) {
    if (!providerRequestId.startsWith("mock_tsk_")) {
      throw new VideoProviderProtocolError("Mock provider request ID is invalid.");
    }
  }
}
