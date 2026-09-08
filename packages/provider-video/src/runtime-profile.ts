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
   * The authored source portion that the caller has already identified.  A
   * string-only caller cannot safely distinguish source from derived prose.
   */
  sourcePrompt?: string;
  /**
   * Derived compiler parts in their original order.  Only these parts may be
   * omitted in the first compaction pass; the second pass has its own fixed,
   * source-clause allowlist below.
   */
  generatedPromptParts?: readonly string[];
}>;

/**
 * These are the only authored-source clauses that the second pass is allowed
 * to remove.  They are redundant presentation/safety prose already carried by
 * the structured motion/audio snapshot; arbitrary user sentences are never
 * selected by this pass.  The rules are intentionally narrow and ordered so a
 * source that does not match them remains fail-closed.
 */
const sourceCompactionPatterns: readonly RegExp[] = [
  /^风格：[\s\S]*?(?=##\s*人物与场景)/u,
  /\s*\*\*声音：\*\*[^。]*。/u,
  /\s*\*\*表演重点：\*\*[^；]*；/u,
  /\s*-\s*保留真实[^。]*。/u,
  /\s*-\s*不添加[^。]*。/u,
  /\s*-\s*斜挎包[^。]*。/u,
  /\s*-\s*人物移动方向[^。]*。/u,
  /\s*-\s*不让女主[^。]*。/u,
  /\s*-\s*不让小猫[^。]*。/u,
];

const sourceCompactionCandidates = (sourcePrompt: string) => {
  const candidates: string[] = [];
  let remaining = sourcePrompt;
  while (remaining) {
    let matchStart = Number.POSITIVE_INFINITY;
    let matchText: string | undefined;
    for (const pattern of sourceCompactionPatterns) {
      const match = remaining.match(pattern);
      if (!match || match[0].length === 0) continue;
      const start = match.index ?? -1;
      if (start >= 0 && start < matchStart) {
        matchStart = start;
        matchText = match[0];
      }
    }
    if (matchText === undefined || !Number.isFinite(matchStart)) break;
    candidates.push(matchText);
    remaining = remaining.slice(matchStart + matchText.length);
  }
  return candidates;
};

const removeFirstExactSourceClause = (sourcePrompt: string, clause: string) => {
  const index = sourcePrompt.indexOf(clause);
  if (index < 0) return undefined;
  return `${sourcePrompt.slice(0, index)}${sourcePrompt.slice(index + clause.length)}`;
};

/**
 * Internal reason carried across the production-worker boundary.  It is not
 * part of the public generation contract; the scheduler uses it to avoid
 * turning unrelated unsupported-input failures into prompt-budget failures.
 */
export type UnsupportedVideoGenerationInputCode = "PROMPT_BUDGET" | "UNSUPPORTED_INPUT";

/**
 * Keep the authored source and fit caller-identified generated parts first;
 * only then use the fixed source-clause allowlist above. This is the
 * intentionally small platform adapter: the fixed upstream sources provide
 * prompt shape and source/lock priorities, but no generic compressor or
 * provenance marker. Without the sidecar parts a caller gets the existing
 * fail-closed error instead of a string-level guess.
 */
export const compactRuntimePrompt = (
  prompt: string,
  mode: VideoProviderRuntimeMode,
  maxUtf8Bytes = DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES,
  options: RuntimePromptCompactionOptions = {},
) => {
  // The local Mock path and all under-ceiling prompts are immutable.  In
  // particular, do not trim authored whitespace before deciding whether to
  // send the source unchanged.
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
  const compose = (source: string) => [source, ...retainedGeneratedPromptParts].join(" ");
  let compacted = compose(sourcePrompt);
  if (utf8ByteLength(compacted) <= resolvedMaxUtf8Bytes) return compacted;

  // Second pass: remove only complete, explicitly-recognised optional source
  // clauses. This is still fail-closed: if the authored text has no such
  // clause, or the remaining text cannot fit, no arbitrary sentence is cut.
  let compactedSource = sourcePrompt;
  for (const clause of sourceCompactionCandidates(sourcePrompt)) {
    const nextSource = removeFirstExactSourceClause(compactedSource, clause);
    if (nextSource === undefined) continue;
    compactedSource = nextSource;
    compacted = compose(nextSource);
    if (utf8ByteLength(compacted) <= resolvedMaxUtf8Bytes) return compacted;
  }

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
  return snapshot;
};
