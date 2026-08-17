import type { VideoProviderRuntimeProfile } from "./runtime-profile.js";

export class VideoPromptCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoPromptCompilationError";
  }
}

export type CompiledVideoPrompt = Readonly<{
  prompt: string;
  settings: Readonly<{
    duration: number;
    resolution: string;
    ratio: string;
  }>;
}>;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const configuredSettings = (generationSettings: Record<string, unknown>, profile: VideoProviderRuntimeProfile) => {
  if (profile.mode === "mock") {
    return { duration: profile.duration, resolution: profile.resolution, ratio: profile.ratio };
  }
  const values = asRecord(generationSettings.video_settings);
  if (!values) return { duration: profile.duration, resolution: profile.resolution, ratio: profile.ratio };
  const duration = values.duration_seconds;
  const resolution = values.resolution;
  const ratio = values.ratio;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 15 || (resolution !== "480p" && resolution !== "720p") || ratio !== "16:9") {
    throw new VideoPromptCompilationError("The saved video settings are not supported by this video profile.");
  }
  return { duration, resolution, ratio };
};

export const compileVideoPrompt = (input: Readonly<{
  sourcePrompt: string;
  generationSettings: Record<string, unknown>;
  profile: VideoProviderRuntimeProfile;
}>): CompiledVideoPrompt => {
  const sourcePrompt = input.sourcePrompt.trim();
  if (!sourcePrompt) throw new VideoPromptCompilationError("A video idea is required before generation.");
  return {
    prompt: sourcePrompt,
    settings: configuredSettings(input.generationSettings, input.profile),
  };
};
