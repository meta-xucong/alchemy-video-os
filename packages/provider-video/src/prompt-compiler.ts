import type { KeyVisualObjectLock, VisualReferenceRole } from "@alchemy-video/contracts";

import {
  DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES,
  compactRuntimePrompt,
  type VideoProviderRuntimeProfile,
} from "./runtime-profile.js";

const extractObjectNames = (sourcePrompt: string) => {
  const matches = [
    ...sourcePrompt.matchAll(/(?:手持|拿着|拿住|握着|带着|携带|佩戴|戴着|背着|抱着|举着|放着|摆着)([^，。；;\n]{1,32})/gu),
    ...sourcePrompt.matchAll(/(?:拂尘|长剑|宝剑|书卷|画卷|茶杯|手机|相机|麦克风|汽车|产品|包装盒|徽标|项链|耳环|手镯|公文包|雨伞|扇子|灯笼|设备)/gu),
  ].map((match) => (match[1] ?? match[0] ?? "").replace(/\s+/gu, " ").trim().split(/(?:缓缓|慢慢|快速|走来|走向|走过|进入|来到|然后|并)/u, 1)[0]!.replace(/[的地]$/u, ""));
  return [...new Set(matches)].filter((value) => value.length >= 2);
};

const extractDialogueLines = (sourcePrompt: string) => {
  const matches = [
    // Keep the source quote complete, including authored line breaks. The
    // provider boundary is not a licence to slice a user's script.
    ...sourcePrompt.matchAll(/“([\s\S]*?)”|「([\s\S]*?)」|『([\s\S]*?)』|"([\s\S]*?)"/gu),
  ]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "")
      .replace(/\r\n?/gu, "\n")
      .replace(/[^\S\n]+/gu, " ")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n[ \t]+/gu, "\n")
      .trim())
    .filter(Boolean);
  if (matches.length > 0) return [...new Set(matches)];
  return [...sourcePrompt.matchAll(/(?:开口(?:问到|说道)?|说道|说|问道|回答)[:：]?\s*([^。！？!?\n]+)/gu)]
    .map((match) => (match[1] ?? "").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    ;
};

const buildDialogueDirective = (sourcePrompt: string, audioOwner?: VideoProviderRuntimeProfile["audioOwner"]) => {
  // OpenMontage's prompting guide uses the literal `Character says: "..."`
  // form and keeps one speaker per clip so native provider audio is explicit
  // without applying the platform-narration suppression contract.
  if (audioOwner === "NATIVE_PROVIDER") {
    // Workflow PromptPackages already carry the source-native dialogue
    // contract.  Do not extract its quotes again: the contract contains the
    // exact script and may also quote the intentionally forbidden filler list.
    if (/(?:EXACT SPOKEN AUDIO SCRIPT|AUDIO PRIORITY:)/u.test(sourcePrompt)) return "";
    const lines = extractDialogueLines(sourcePrompt);
    if (lines.length === 0) return "";
    return `One speaker per clip. Character says: "${lines.join("\n")}"`;
  }
  // Workflow PromptPackages may already contain the exact source-aligned
  // dialogue contract. Re-compiling that immutable prompt at the Control API
  // boundary duplicates speech and can push a real provider over its budget.
  if (/(?:EXACT SPOKEN AUDIO SCRIPT|SPOKEN CONTENT BOUNDARY|AUDIO PRIORITY:)/u.test(sourcePrompt)) return "";
  const lines = extractDialogueLines(sourcePrompt);
  if (lines.length === 0) return "";
  return `Dialogue visual contract: preserve the following original dialogue in its original language as visible speaking performance, mouth movement, and lip-sync reference during the assigned narration window; the platform narration supplies the final audible speech and the provider must not generate or carry audible dialogue: ${lines.map((line) => `“${line}”`).join(" ")}. Keep the visible performance aligned to the source text, finish the window at a natural consistent pace, and use any remaining shot time for a no-dialogue visual hold or source-described non-speaking action with SILENCE/AMBIENT-ONLY sound. After the final narration window, do not continue an additional talking performance, lip-sync, vocalization, or new gesture; keep the mouth neutral and the end pose stable. Do not slow, stretch, repeat, or add filler words.`;
};

const detectTransfer = (sourcePrompt: string, object: string) => {
  const sentence = sourcePrompt.split(/[。；;\n]/u).find((value) => value.includes(object)) ?? sourcePrompt;
  const parse = (value: string) => value.match(/(?:从)?(左手|右手)[^，。；;\n]{0,18}(?:换到|交给|递给|转到|移到|接过)[^，。；;\n]{0,12}(左手|右手)/u)
    ?? value.match(/(?:从)?(左手|右手)[^，。；;\n]{0,18}(?:将|把)[^，。；;\n]{0,30}(?:换到|交给|递给|转到|移到)[^，。；;\n]{0,12}(左手|右手)/u);
  const sentences = sourcePrompt.split(/[。！？!?]/u);
  const sentenceIndex = sentences.findIndex((value) => value.includes(object));
  const follow = sentenceIndex >= 0 ? sentences[sentenceIndex + 1] ?? "" : "";
  const match = parse(sentence) ?? (/(?:它|该物体|物品|随后)/u.test(follow) ? parse(`${sentence}。${follow}`) : undefined);
  if (!match || match[1] === match[2]) return undefined;
  return { from: match[1]!, to: match[2]! };
};

const buildObjectContinuityDirective = (sourcePrompt: string, visualObjectLocks: readonly KeyVisualObjectLock[] = []) => {
  const named = extractObjectNames(sourcePrompt);
  const described = visualObjectLocks.map((object) => object.name.trim()).filter(Boolean);
  const objects = [...new Set([...named, ...described])].filter((value, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.length > value.length && other.includes(value)));
  if (objects.length === 0) return "";
  const locks = objects.map((object) => {
    const analyzed = visualObjectLocks.find((candidate) => candidate.name.trim() === object);
    const details = analyzed ? `${analyzed.description} ${analyzed.relation}` : "保持其名称、外观及与人物/空间的关系";
    const prohibited = analyzed?.prohibited_changes?.length ? `；禁止：${analyzed.prohibited_changes.join("、")}` : "";
    const transfer = analyzed?.transfer ?? detectTransfer(sourcePrompt, object);
    const transferText = transfer ? `；明确换手：这是同一个${object}，先由${transfer.from === "LEFT_HAND" ? "左手" : transfer.from === "RIGHT_HAND" ? "右手" : transfer.from}释放，再双手接触交接，最后由${transfer.to === "LEFT_HAND" ? "左手" : transfer.to === "RIGHT_HAND" ? "右手" : transfer.to}持有且原手为空` : "";
    return `关键对象“${object}”：全片仅一个实例；${details}${transferText}；禁止复制、分裂、残影${prohibited}`;
  }).join("；");
  return `关键对象连续性锁：${locks}。每个动作节拍只改变对象姿态或位置，不改变对象身份。`;
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
}>): CompiledVideoPrompt => {
  const sourcePrompt = input.sourcePrompt.trim();
  if (!sourcePrompt) throw new VideoPromptCompilationError("A video idea is required before generation.");
  const referenceDirective = buildReferenceRoleDirective(input.referenceRoles ?? []);
  const objectDirective = buildObjectContinuityDirective(sourcePrompt, input.visualObjectLocks);
  const dialogueDirective = buildDialogueDirective(sourcePrompt, input.profile.audioOwner);
  const generatedPromptParts = [objectDirective, referenceDirective, dialogueDirective].filter(Boolean);
  const prompt = [sourcePrompt, ...generatedPromptParts].filter(Boolean).join(" ");
  const compactedPrompt = compactRuntimePrompt(
    prompt,
    input.profile.mode,
    input.profile.providerPromptMaxUtf8Bytes ?? DEFAULT_VIDEO_PROMPT_MAX_UTF8_BYTES,
    { sourcePrompt, generatedPromptParts },
  );
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
  return {
    prompt: compactedPrompt,
    sourcePrompt,
    generatedPromptParts: retainedGeneratedPromptParts,
    settings: configuredSettings(input.generationSettings, input.profile),
  };
};
