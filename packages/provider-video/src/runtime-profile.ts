import { VisualInputSnapshotSchema, type MotionBeat, type VideoAudioOwner, type VideoGenerationInputSnapshot, type VisualInputMode, type VisualInputSnapshot } from "@alchemy-video/contracts";

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
  /**
   * Source-backed owner of the generated clip's audible track.  This is an
   * internal profile fact; it is intentionally absent from the Mock profile.
   */
  audioOwner?: VideoAudioOwner;
  /**
   * Effective outbound prompt budget learned from this provider profile. This
   * is a compression ceiling, never a public input rejection.
   */
  providerPromptMaxUtf8Bytes?: number;
}>;

/** xAI does not publish a prompt-byte limit for video generation; this is our configurable platform safety ceiling. */
export const DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES = 20_000;
export const VIDEO_PROMPT_MAX_UTF8_BYTES_ENV = "VIDEO_PROMPT_MAX_UTF8_BYTES";
/** The aiself-grok profile has explicitly rejected prompts over 4096 UTF-8 bytes. */
export const SUB2API_GROK_PROFILE_PROMPT_MAX_UTF8_BYTES = 4_096;
const textEncoder = new TextEncoder();

export const utf8ByteLength = (value: string) => textEncoder.encode(value).byteLength;

export const resolveVideoPromptMaxUtf8Bytes = (value: string | number | undefined) => {
  if (value === undefined || value === "") return DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${VIDEO_PROMPT_MAX_UTF8_BYTES_ENV} must be a positive integer.`);
  }
  return parsed;
};

export const resolveEffectiveVideoPromptMaxUtf8Bytes = (
  profile: Pick<VideoProviderRuntimeProfile, "providerPromptMaxUtf8Bytes">,
  configured: string | number | undefined,
) => {
  const configuredMax = resolveVideoPromptMaxUtf8Bytes(configured);
  const providerMax = profile.providerPromptMaxUtf8Bytes;
  return providerMax === undefined ? configuredMax : Math.min(configuredMax, providerMax);
};

export type RuntimePromptCompactionOptions = Readonly<{
  /**
   * The immutable prompt prefix already identified by the caller. A string-only
   * compactor cannot decide whether that prefix is authored source or an LLM
   * projection, so it never interprets or rewrites it.
   */
  sourcePrompt?: string;
  /**
   * Derived compiler parts in their original order. Only complete parts whose
   * provenance is supplied by the caller may be omitted. The caller-designated
   * source prefix is immutable here; in the real semantic path that prefix is
   * an LLM visual projection, while the authored brief is frozen separately.
   */
  generatedPromptParts?: readonly string[];
}>;

/**
 * Internal reason carried across the production-worker boundary.  It is not
 * part of the public generation contract; the scheduler uses it to avoid
 * turning unrelated unsupported-input failures into prompt-budget failures.
 */
export type UnsupportedVideoGenerationInputCode = "PROMPT_BUDGET" | "UNSUPPORTED_INPUT";

/**
 * Preserve the caller-designated immutable prompt prefix byte-for-byte and fit
 * only caller-identified generated parts around it. This function does not
 * claim that the prefix is the complete authored brief: in the real semantic
 * path it is the LLM visual projection, while the brief is frozen and hashed
 * separately. Without an exact sidecar match, fail closed rather than infer
 * which text may be removed.
 */
export const compactRuntimePrompt = (
  prompt: string,
  mode: VideoProviderRuntimeMode,
  maxUtf8Bytes = DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES,
  options: RuntimePromptCompactionOptions = {},
) => {
  // The local Mock path and all under-ceiling prompts are immutable. In
  // particular, do not trim caller-supplied whitespace before deciding
  // whether to send the prompt unchanged.
  if (mode !== "sub2api") return prompt;
  const resolvedMaxUtf8Bytes = resolveVideoPromptMaxUtf8Bytes(maxUtf8Bytes);
  // A prompt already within the provider ceiling is sent unchanged.  An
  // oversized prompt may only use the explicit source/parts sidecar.
  if (utf8ByteLength(prompt) <= resolvedMaxUtf8Bytes) return prompt;

  const sourcePrompt = options.sourcePrompt;
  const generatedPromptParts = options.generatedPromptParts;
  if (!sourcePrompt || generatedPromptParts === undefined || !prompt.startsWith(sourcePrompt)) {
    throw new UnsupportedVideoGenerationInputError("The video prompt cannot fit the configured provider prompt limit without deleting source content.", "PROMPT_BUDGET");
  }
  const expectedPrompt = [sourcePrompt, ...generatedPromptParts].join(" ");
  if (expectedPrompt !== prompt) {
    throw new UnsupportedVideoGenerationInputError("The generated prompt parts do not match the authored source prompt.", "PROMPT_BUDGET");
  }

  // Walk only the caller-provided complete parts in their original order. No
  // marker or prefix shape is evidence that an arbitrary prompt substring is
  // generated; a part that does not fit is simply omitted.
  const selected = new Set<number>();
  let candidate = sourcePrompt;
  for (const [index, part] of generatedPromptParts.entries()) {
    const next = `${candidate} ${part}`;
    if (utf8ByteLength(next) <= resolvedMaxUtf8Bytes) {
      candidate = next;
      selected.add(index);
    }
  }
  const retainedGeneratedPromptParts = generatedPromptParts.filter((_part, index) => selected.has(index));
  const compacted = [sourcePrompt, ...retainedGeneratedPromptParts].join(" ");
  if (utf8ByteLength(compacted) <= resolvedMaxUtf8Bytes) return compacted;

  throw new UnsupportedVideoGenerationInputError("The video prompt cannot fit the configured provider prompt limit without deleting authored source content.", "PROMPT_BUDGET");
};

export class UnsupportedVideoGenerationInputError extends Error {
  readonly code: UnsupportedVideoGenerationInputCode;

  constructor(message: string, code: UnsupportedVideoGenerationInputCode = "UNSUPPORTED_INPUT") {
    super(message);
    this.name = "UnsupportedVideoGenerationInputError";
    this.code = code;
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
    providerPromptMaxUtf8Bytes: SUB2API_GROK_PROFILE_PROMPT_MAX_UTF8_BYTES,
    // OpenMontage GrokVideo.supports.native_audio: the generated MP4 is the
    // final provider-owned audio source and must not be replaced by TTS.
    audioOwner: "NATIVE_PROVIDER" as const,
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
  promptMaxUtf8Bytes?: number;
  sourcePrompt?: string;
  generatedPromptParts?: readonly string[];
  settings?: RuntimeVideoSettings;
  generationSegmentSequence?: number;
  narrativeBeatSequences?: number[];
  motionPlanVersion?: string;
  motionPlanHash?: string;
  motionTimeline?: MotionBeat[];
  deliveryPlanRevisionId?: string;
  billing?: VideoGenerationInputSnapshot["billing"];
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
    prompt: compactRuntimePrompt(
      input.prompt,
      input.profile.mode,
      resolveEffectiveVideoPromptMaxUtf8Bytes(input.profile, input.promptMaxUtf8Bytes),
      {
        ...(input.sourcePrompt ? { sourcePrompt: input.sourcePrompt } : {}),
        ...(input.generatedPromptParts ? { generatedPromptParts: input.generatedPromptParts } : {}),
      },
    ),
    duration: settings.duration,
    resolution: settings.resolution,
    ratio: settings.ratio,
    reference_asset_ids: visualInput.data.references.map((reference) => reference.asset_id),
    ...(input.profile.audioOwner ? { audio_owner: input.profile.audioOwner } : {}),
    visual_input: visualInput.data,
    ...(input.deliveryPlanRevisionId ? { delivery_plan_revision_id: input.deliveryPlanRevisionId } : {}),
  };
  if (input.generationSegmentSequence !== undefined) {
    snapshot.generation_segment_sequence = input.generationSegmentSequence;
  }
  if (input.narrativeBeatSequences !== undefined) {
    snapshot.narrative_beat_sequences = input.narrativeBeatSequences;
  }
  if (input.motionPlanVersion !== undefined) {
    snapshot.motion_plan_version = input.motionPlanVersion;
  }
  if (input.motionPlanHash !== undefined) {
    snapshot.motion_plan_hash = input.motionPlanHash;
  }
  if (input.motionTimeline !== undefined) {
    snapshot.motion_timeline = input.motionTimeline;
  }
  if (input.billing !== undefined) {
    snapshot.billing = input.billing;
  }
  return snapshot;
};
