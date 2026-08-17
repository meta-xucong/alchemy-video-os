import { VisualInputSnapshotSchema, type VideoGenerationInputSnapshot, type VisualInputMode, type VisualInputSnapshot } from "@alchemy-video/contracts";

export type VideoProviderRuntimeMode = "mock" | "sub2api";

export type VideoProviderRuntimeProfile = Readonly<{
  mode: VideoProviderRuntimeMode;
  provider: "mock" | "sub2api";
  model: string;
  duration: number;
  resolution: string;
  ratio: string;
  inputMode: "mock" | "multi_modal_video";
  supportedVisualInputModes: readonly VisualInputMode[];
  pollIntervalMs: number;
  maxPollAttempts: number;
}>;

export class UnsupportedVideoGenerationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVideoGenerationInputError";
  }
}

export type RuntimeVideoSettings = Readonly<{
  duration: number;
  resolution: string;
  ratio: string;
}>;

const profiles: Readonly<Record<VideoProviderRuntimeMode, VideoProviderRuntimeProfile>> = Object.freeze({
  mock: Object.freeze({
    mode: "mock",
    provider: "mock",
    model: "mock-video-v1",
    duration: 1,
    resolution: "160x90",
    ratio: "16:9",
    inputMode: "mock",
    supportedVisualInputModes: ["TEXT", "FIRST_FRAME", "REFERENCE_SET"] as const,
    pollIntervalMs: 0,
    maxPollAttempts: 2,
  }),
  sub2api: Object.freeze({
    mode: "sub2api",
    provider: "sub2api",
    model: "grok-imagine-video-1.5",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
    inputMode: "multi_modal_video",
    supportedVisualInputModes: ["TEXT", "FIRST_FRAME", "REFERENCE_SET"] as const,
    pollIntervalMs: 5_000,
    maxPollAttempts: 120,
  }),
});

export const resolveVideoProviderRuntimeProfile = (value: string | undefined): VideoProviderRuntimeProfile => {
  const mode = (value ?? "mock").trim().toLowerCase();
  if (mode === "mock" || mode === "sub2api") return profiles[mode];
  throw new Error("VIDEO_PROVIDER must be mock or sub2api.");
};

export const createRuntimeVideoInputSnapshot = (input: Readonly<{
  prompt: string;
  visualInput: VisualInputSnapshot;
  profile: VideoProviderRuntimeProfile;
  settings?: RuntimeVideoSettings;
  generationSegmentSequence?: number;
  narrativeBeatSequences?: number[];
}>): VideoGenerationInputSnapshot => {
  const visualInput = VisualInputSnapshotSchema.safeParse(input.visualInput);
  if (!visualInput.success) {
    throw new UnsupportedVideoGenerationInputError("The saved reference images do not form a supported video input.");
  }
  if (!input.profile.supportedVisualInputModes.includes(visualInput.data.mode)) {
    throw new UnsupportedVideoGenerationInputError("The configured video capability does not support this image input.");
  }
  const settings = input.settings ?? input.profile;
  if (input.profile.mode === "sub2api" && (
    !Number.isInteger(settings.duration)
    || settings.duration < 1
    || settings.duration > 15
    || !["480p", "720p"].includes(settings.resolution)
    || settings.ratio !== "16:9"
  )) {
    throw new UnsupportedVideoGenerationInputError("The requested video settings are not supported by this video profile.");
  }
  if (input.profile.mode === "mock" && (
    settings.duration !== input.profile.duration
    || settings.resolution !== input.profile.resolution
    || settings.ratio !== input.profile.ratio
  )) {
    throw new UnsupportedVideoGenerationInputError("The local Mock profile uses its fixed fixture settings.");
  }
  const snapshot: VideoGenerationInputSnapshot = {
    model: input.profile.model,
    prompt: input.prompt,
    duration: settings.duration,
    resolution: settings.resolution,
    ratio: settings.ratio,
    reference_asset_ids: visualInput.data.references.map((reference) => reference.asset_id),
    visual_input: visualInput.data,
  };
  if (input.generationSegmentSequence !== undefined) {
    snapshot.generation_segment_sequence = input.generationSegmentSequence;
  }
  if (input.narrativeBeatSequences !== undefined) {
    snapshot.narrative_beat_sequences = input.narrativeBeatSequences;
  }
  return snapshot;
};
