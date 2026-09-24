import type { KeyVisualObjectLock, VisualReferenceRole } from "@alchemy-video/contracts";

import {
  DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES,
  compactRuntimePrompt,
  UnsupportedVideoGenerationInputError,
  type VideoProviderRuntimeProfile,
} from "./runtime-profile.js";

// Source: Seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7
// skill/seedance-25/references/prompting.md (sound policy) and
// references/prompt-recipes.md ("无字幕"); OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930
// skills/creative/prompting/veo-prompting.md (subtitle prevention). Keep
// this generated part narrow: post-production owns captions, while scene/UI
// text remains part of the authored source.
const PROVIDER_CAPTION_SUPPRESSION_DIRECTIVE = "全程无字幕；no subtitles, no captions。字幕只在后期统一添加。";

const hasProviderCaptionSuppressionDirective = (value: string) =>
  value.includes(PROVIDER_CAPTION_SUPPRESSION_DIRECTIVE);

const buildDialogueDirective = (
  dialogueLines: readonly string[] = [],
  audioOwner?: VideoProviderRuntimeProfile["audioOwner"],
) => {
  const lines = dialogueLines.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  if (new Set(lines).size !== lines.length) {
    throw new VideoPromptCompilationError("Verified dialogue lines must be unique and source ordered.");
  }
  // OpenMontage's prompting guide uses the literal `Character says: "..."`
  // form.  The compiler receives exact dialogue facts; it never reparses prose.
  if (audioOwner === "NATIVE_PROVIDER") {
    return `One speaker per clip. Character says: "${lines.join("\n")}"`;
  }
  return `Dialogue visual contract: preserve the following exact dialogue in its original language as visible speaking performance, mouth movement, and lip-sync reference during the assigned narration window; the platform narration supplies the final audible speech and the provider must not generate or carry audible dialogue: ${lines.map((line) => `“${line}”`).join(" ")}. Keep the visible performance aligned to the exact text, finish the window at a natural consistent pace, and use any remaining shot time for a no-dialogue visual hold or source-described non-speaking action with SILENCE/AMBIENT-ONLY sound. After the final narration window, do not continue an additional talking performance, lip-sync, vocalization, or new gesture; keep the mouth neutral and the end pose stable. Do not slow, stretch, repeat, or add filler words.`;
};

const buildObjectContinuityDirective = (visualObjectLocks: readonly KeyVisualObjectLock[] = []) => {
  const objects = [...new Map(visualObjectLocks
    .map((object) => [object.name.trim(), object] as const)
    .filter(([name]) => Boolean(name))).values()];
  if (objects.length === 0) return "";
  const locks = objects.map((object) => {
    const details = `${object.description} ${object.relation}`.trim();
    const prohibited = object.prohibited_changes?.length ? `；禁止：${object.prohibited_changes.join("、")}` : "";
    const transfer = object.transfer;
    const transferText = transfer
      ? `；明确换手：这是同一个${object.name}，先由${transfer.from === "LEFT_HAND" ? "左手" : transfer.from === "RIGHT_HAND" ? "右手" : transfer.from}释放，再双手接触交接，最后由${transfer.to === "LEFT_HAND" ? "左手" : transfer.to === "RIGHT_HAND" ? "右手" : transfer.to}持有且原手为空`
      : "";
    return `关键对象“${object.name}”：${details}${transferText}${prohibited}`;
  }).join("；");
  return `已验证关键对象约束：${locks}。只执行这些显式约束，不从提示文本推断其它对象关系。`;
};

export class VideoPromptCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoPromptCompilationError";
  }
}

export type CompiledVideoPrompt = Readonly<{
  prompt: string;
  /** The authored source passed to the compiler, before generated directives. */
  sourcePrompt: string;
  /** Generated directives retained as a sidecar for source-first compaction. */
  generatedPromptParts: readonly string[];
  settings: Readonly<{
    duration: number;
    resolution: string;
    ratio: string;
  }>;
}>;

/**
 * Keep semantic reference handling in the immutable prompt as well as the
 * ordered URL list. This is provider-neutral and gives R2V models a clear
 * reason not to replace a submitted location with a generic background.
 */
export const buildReferenceRoleDirective = (roles: readonly VisualReferenceRole[]) => {
  // Keep the caller's role-to-image mapping intact. Role descriptions may be
  // deduplicated independently, but semantic labels must never reorder the
  // provider input positions.
  const present = roles.filter((role, index) => roles.indexOf(role) === index);
  if (present.length === 0) return "";
  const descriptions = present.map((role) => {
    if (role === "SCENE") return "scene reference: scene/location anchor";
    if (role === "SUBJECT") return "subject reference: subject identity and wardrobe";
    if (role === "STYLE") return "style reference: palette or product detail";
    return "handoff reference: approved opening endpoint";
  }).join("; ");
  const inputOrder = roles.map((role, index) => `image ${index + 1} = ${role.toLowerCase()} reference`).join(", ");
  return `Reference image roles are explicit: ${descriptions}. Provider input order is semantic: ${inputOrder}. Do not infer roles from the original upload order. Preserve the scene anchor and subject identity/wardrobe; do not substitute a generic environment.`;
};

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
  referenceRoles?: readonly VisualReferenceRole[];
  visualObjectLocks?: readonly KeyVisualObjectLock[];
  /** Exact, verified dialogue for this segment. Source prose is never reparsed here. */
  dialogueLines?: readonly string[];
}>): CompiledVideoPrompt => {
  const sourcePrompt = input.sourcePrompt.trim();
  if (!sourcePrompt) throw new VideoPromptCompilationError("A video idea is required before generation.");
  const referenceDirective = buildReferenceRoleDirective(input.referenceRoles ?? []);
  const objectDirective = buildObjectContinuityDirective(input.visualObjectLocks);
  const dialogueDirective = buildDialogueDirective(input.dialogueLines, input.profile.audioOwner);
  const captionSuppressionDirective = input.profile.mode === "sub2api"
    && !hasProviderCaptionSuppressionDirective(sourcePrompt)
    ? PROVIDER_CAPTION_SUPPRESSION_DIRECTIVE
    : "";
  const generatedPromptParts = [captionSuppressionDirective, objectDirective, referenceDirective, dialogueDirective].filter(Boolean);
  const prompt = [sourcePrompt, ...generatedPromptParts].filter(Boolean).join(" ");
  const compactedPrompt = compactRuntimePrompt(
    prompt,
    input.profile.mode,
    input.profile.providerPromptMaxUtf8Bytes ?? DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES,
    { sourcePrompt, generatedPromptParts },
  );
  if (input.profile.mode === "sub2api" && !hasProviderCaptionSuppressionDirective(compactedPrompt)) {
    throw new UnsupportedVideoGenerationInputError(
      "The real video prompt cannot fit the provider ceiling while retaining the required caption-suppression directive.",
      "PROMPT_BUDGET",
    );
  }
  // Keep the sidecar aligned with the prompt actually returned.  This lets a
  // later, lower configured platform budget omit another whole generated part
  // without treating the already compacted string as a provenance mismatch.
  const retainedGeneratedPromptParts: string[] = [];
  let cursor = sourcePrompt.length;
  for (const part of generatedPromptParts) {
    const prefix = ` ${part}`;
    if (compactedPrompt.slice(cursor).startsWith(prefix)) {
      retainedGeneratedPromptParts.push(part);
      cursor += prefix.length;
    }
  }
  const requiredGeneratedParts = [captionSuppressionDirective, referenceDirective, dialogueDirective].filter(Boolean);
  if (requiredGeneratedParts.some((part) => !retainedGeneratedPromptParts.includes(part))) {
    throw new UnsupportedVideoGenerationInputError(
      "The real video prompt cannot fit the provider ceiling while retaining exact dialogue and reference semantics.",
      "PROMPT_BUDGET",
    );
  }
  return {
    prompt: compactedPrompt,
    sourcePrompt,
    generatedPromptParts: retainedGeneratedPromptParts,
    settings: configuredSettings(input.generationSettings, input.profile),
  };
};
