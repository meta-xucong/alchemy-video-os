import { createHash } from "node:crypto";

import type {
  CanonicalTranscriptCheck,
  NarrationDelivery,
  NarrationDisplaySection,
  NarrationSpokenSection,
  PronunciationGuide,
} from "@alchemy-video/contracts";
import { DomainInvariantError } from "./errors.js";

const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

const integerToChinese = (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 9999) return undefined;
  if (number === 0) return "零";
  const units = ["", "十", "百", "千"];
  const digits = String(number).split("").map(Number);
  const result: string[] = [];
  digits.forEach((digit, index) => {
    const position = digits.length - index - 1;
    if (digit === 0) {
      if (result.length > 0 && !result.at(-1)?.endsWith("零")) result.push("零");
      return;
    }
    if (position === 1 && digit === 1 && digits.length === 2) result.push(units[position]!);
    else result.push(chineseDigits[digit]!, units[position]!);
  });
  return result.join("").replace(/零+$/u, "").replace(/零+/gu, "零");
};

const normalizeNumbers = (text: string) => text
  .replace(/(\d{1,4})点(\d{1,4})分/gu, (_, hour: string, minute: string) => `${integerToChinese(hour)}点${integerToChinese(minute)}分`)
  .replace(/(\d+(?:\.\d+)?)秒/gu, (_, value: string) => {
    const [whole, fraction] = value.split(".");
    return `${integerToChinese(whole!)}${fraction ? `点${[...fraction].map((digit) => chineseDigits[Number(digit)]).join("")}` : ""}秒`;
  })
  .replace(/(\d{1,4})条/gu, (_, value: string) => `${integerToChinese(value)}条`);

/**
 * Keep the source line/paragraph boundaries in provider_text.
 *
 * OpenMontage treats provider_text as the provider-facing utterance rather
 * than a prose summary.  Collapsing all whitespace here erased authored
 * paragraph boundaries before the provider could apply its own punctuation /
 * pause handling.  Horizontal formatting whitespace is still normalized,
 * but newlines remain source facts (no pause duration is invented here).
 */
const cleanDisplayText = (text: string) => text
  .replace(/[\u0060*_~]/gu, "")
  .replace(/\r\n?/gu, "\n")
  .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/gu, "")
  .replace(/[^\S\n]+/gu, " ")
  .replace(/[ \t]+\n/gu, "\n")
  .replace(/\n[ \t]+/gu, "\n")
  .trim();

const guideForToken = (token: string, glossary: ReadonlyMap<string, string>): PronunciationGuide => ({
  source: token,
  spoken: glossary.get(token) ?? token,
  reason: glossary.has(token) ? "使用已批准术语表读法。" : "英文缩写或专名需确认读法。",
});

export const NARRATION_REVISION_TRANSITIONS = {
  DRAFT: ["NORMALIZED", "NEEDS_DECISION", "REJECTED"],
  NORMALIZED: ["NEEDS_DECISION", "APPROVED", "REJECTED"],
  NEEDS_DECISION: ["NORMALIZED", "APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
} as const;

export const assertNarrationRevisionTransition = (
  from: "DRAFT" | "NORMALIZED" | "NEEDS_DECISION" | "APPROVED" | "REJECTED",
  to: "DRAFT" | "NORMALIZED" | "NEEDS_DECISION" | "APPROVED" | "REJECTED",
) => {
  if (!NARRATION_REVISION_TRANSITIONS[from].includes(to as never)) {
    throw new DomainInvariantError("DELIVERY_PLAN_STATE_INVALID", `Cannot transition a narration revision from ${from} to ${to}.`);
  }
};

export type NarrationNormalizationResult = {
  status: "NORMALIZED" | "NEEDS_DECISION";
  sourceScriptHash: string;
  displaySections: NarrationDisplaySection[];
  spokenSections: NarrationSpokenSection[];
  decisionReasons: string[];
};

export const normalizeNarrationSections = (input: {
  sections: ReadonlyArray<{ id: string; text: string }>;
  glossary?: ReadonlyMap<string, string>;
}): NarrationNormalizationResult => {
  const glossary = input.glossary ?? new Map<string, string>();
  const displaySections = input.sections.map((section) => ({ id: section.id, text: section.text.trim() }));
  const decisionReasons: string[] = [];
  const spokenSections = displaySections.map((section) => {
    const providerText = normalizeNumbers(cleanDisplayText(section.text));
    if (!providerText) decisionReasons.push(`${section.id}: 播音稿为空。`);
    const tokens = providerText.match(/\b[A-Z][A-Z0-9_-]{1,15}\b/gu) ?? [];
    const pronunciationGuides = [...new Set(tokens)].map((token) => {
      const guide = guideForToken(token, glossary);
      if (!glossary.has(token)) decisionReasons.push(`${section.id}: ${token} 的读法未在术语表中确认。`);
      return guide;
    });
    const delivery: NarrationDelivery = {
      pace: "NATURAL",
      energy: "NEUTRAL",
      emphasis: [],
      pause_before_ms: 0,
      pause_after_ms: 0,
    };
    return {
      id: section.id,
      display_text: section.text,
      provider_text: providerText,
      pronunciation_guides: pronunciationGuides,
      delivery,
    };
  });
  return {
    status: decisionReasons.length > 0 ? "NEEDS_DECISION" : "NORMALIZED",
    sourceScriptHash: createHash("sha256").update(displaySections.map((section) => `${section.id}:${section.text}`).join("\n"), "utf8").digest("hex"),
    displaySections,
    spokenSections,
    decisionReasons,
  };
};

export const buildNarrationTimeline = (input: {
  sectionDurationsMs: ReadonlyArray<{ sectionId: string; durationMs: number; narrationAssetVersionId?: string }>;
  targetDurationMs: number;
  flexiblePercent: number;
  maxProviderDurationSeconds?: number;
}) => {
  const maxProviderDurationMs = (input.maxProviderDurationSeconds ?? 15) * 1000;
  const narrationDurationMs = input.sectionDurationsMs.reduce((total, section) => total + section.durationMs, 0);
  const upperBound = Math.floor(input.targetDurationMs * (1 + input.flexiblePercent / 100));
  const decisionReasons: string[] = [];
  if (narrationDurationMs > upperBound) decisionReasons.push("旁白实际时长超过目标时长弹性上限，需要修订播音稿或确认延长。");
  const effectiveDurationMs = Math.max(input.targetDurationMs, narrationDurationMs);
  const narrationSections: Array<{ section_id: string; start_ms: number; end_ms: number; visual_role: "PRIMARY" | "HOLD"; narration_asset_version_id?: string }> = [];
  let cursor = 0;
  for (const section of input.sectionDurationsMs) {
    const end = cursor + Math.max(1, section.durationMs);
    narrationSections.push({
      section_id: section.sectionId,
      start_ms: cursor,
      end_ms: end,
      visual_role: "PRIMARY",
      ...(section.narrationAssetVersionId ? { narration_asset_version_id: section.narrationAssetVersionId } : {}),
    });
    cursor = end;
  }
  if (narrationDurationMs < input.targetDurationMs) {
    // Keep the requested visual duration as an explicit, reviewable tail
    // window. This is a TimelinePlan fact (not silent audio padding), so a
    // selected music/ambient asset or visible hold can cover it.
    narrationSections.push({
      section_id: `${input.sectionDurationsMs.at(-1)?.sectionId ?? "narration"}-tail-hold`,
      start_ms: narrationDurationMs,
      end_ms: input.targetDurationMs,
      visual_role: "HOLD",
    });
  }
  const visualSegments: Array<{ sequence: number; start_ms: number; end_ms: number; provider_duration_seconds: number }> = [];
  let segmentStart = 0;
  let sequence = 1;
  if (narrationDurationMs === input.targetDurationMs) {
    // When measured speech exactly fills the requested target, retain the
    // existing section/shot boundaries.  Production composition can then
    // match a storyboard such as three accepted 10-second segments instead
    // of re-chunking the whole plan into 15-second windows.
    for (const section of input.sectionDurationsMs) {
      let remaining = section.durationMs;
      while (remaining > 0) {
        const duration = Math.min(remaining, maxProviderDurationMs);
        const end = segmentStart + duration;
        visualSegments.push({
          sequence,
          start_ms: segmentStart,
          end_ms: end,
          provider_duration_seconds: Math.max(1, Math.ceil(duration / 1000)),
        });
        segmentStart = end;
        remaining -= duration;
        sequence += 1;
      }
    }
  } else {
    while (segmentStart < effectiveDurationMs) {
      const end = Math.min(effectiveDurationMs, segmentStart + maxProviderDurationMs);
      visualSegments.push({
        sequence,
        start_ms: segmentStart,
        end_ms: end,
        provider_duration_seconds: Math.max(1, Math.ceil((end - segmentStart) / 1000)),
      });
      segmentStart = end;
      sequence += 1;
    }
  }
  return {
    status: decisionReasons.length > 0 ? "NEEDS_DECISION" as const : "READY" as const,
    effectiveDurationMs,
    narrationSections,
    visualSegments,
    decisionReasons,
  };
};

const canonicalTranscriptText = (text: string) => text
  .normalize("NFKC")
  .toLocaleLowerCase("zh-CN")
  .replace(/[\p{P}\p{S}\s]+/gu, "");

const levenshteinDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal + 1, previous[rightIndex]! + 1, previous[rightIndex - 1]! + 1);
      diagonal = above;
    }
  }
  return previous[right.length]!;
};

export const evaluateCanonicalTranscript = (input: {
  expectedText: string;
  transcriptText?: string | null;
  transcriptAssetId?: string | null;
  minimumAccuracy?: number;
}): CanonicalTranscriptCheck => {
  const expected = canonicalTranscriptText(input.expectedText);
  const transcript = canonicalTranscriptText(input.transcriptText ?? "");
  if (!transcript) {
    return {
      status: "UNAVAILABLE",
      transcript_asset_id: input.transcriptAssetId ?? null,
      matches: null,
      accuracy: null,
      issues: ["未附加可比较的 canonical transcript。"],
    };
  }
  const denominator = Math.max(expected.length, transcript.length, 1);
  const accuracy = Math.max(0, 1 - levenshteinDistance(expected, transcript) / denominator);
  const matches = accuracy >= (input.minimumAccuracy ?? 0.85);
  return {
    status: matches ? "CHECKED" : "NEEDS_REVIEW",
    transcript_asset_id: input.transcriptAssetId ?? null,
    matches,
    accuracy: Number(accuracy.toFixed(4)),
    issues: matches ? [] : [`canonical transcript 与播音稿匹配度为 ${(accuracy * 100).toFixed(1)}%。`],
  };
};
