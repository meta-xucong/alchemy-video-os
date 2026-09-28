// Source-first dialogue extraction shared by mock planning and the
// production-safe Semantic Director canonicalizer. This module owns only
// authored speech recognition; it does not infer scene, action, camera, or
// other director facts.

// Dialogue is an authored provider-facing utterance. Keep its line breaks
// intact while normalizing only horizontal formatting whitespace; the
// selected provider remains responsible for its own punctuation/pauses.
export const normalizeDialogueText = (value: string) => value
  .replace(/\r\n?/gu, "\n")
  .replace(/[^\S\n]+/gu, " ")
  .replace(/[ \t]+\n/gu, "\n")
  .replace(/\n[ \t]+/gu, "\n")
  .trim();

// Huobao's storyboard-breaker receives authored script paragraphs, rather
// than a flat character stream. Preserve every non-empty source line as one
// ordered section and carry the original line break on the following section.
export const splitAuthoredDialogueSections = (value: string) => {
  const normalized = normalizeDialogueText(value);
  if (!normalized) return [] as string[];
  const sections: string[] = [];
  let lineBreaksBefore = 0;
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      lineBreaksBefore += 1;
      continue;
    }
    const prefix = sections.length === 0 ? "" : "\n".repeat(Math.max(1, lineBreaksBefore));
    sections.push(`${prefix}${line}`);
    lineBreaksBefore = 1;
  }
  return sections;
};

const repairDialogueBoundaryQuotes = (value: string) => {
  const text = value.trim();
  const first = text[0];
  const last = text.at(-1);
  const balanced = (first === "“" && last === "”")
    || (first === "「" && last === "」")
    || (first === "『" && last === "』")
    || (first === '"' && last === '"')
    || (first === "'" && last === "'");
  if (balanced) return text;
  return text
    .replace(/^[“”「」『』"']+\s*/u, "")
    .replace(/\s*[“”「」『』"']+$/u, "")
    .trim();
};

const spokenQuoteCue = /(?:口播文案|口播|旁白文案|配音文案|对白文案|对白|台词|说|说道|说着|问|问道|问到|回答|喊道|唱道|开口)\s*(?:为)?\s*[:：]?\s*$/u;
export const quotedDialoguePattern = /“([\s\S]*?)”|”([\s\S]*?)”|「([\s\S]*?)」|『([\s\S]*?)』|"([\s\S]*?)"/gu;
export const isSpokenQuoteAt = (value: string, start: number) =>
  spokenQuoteCue.test(value.slice(Math.max(0, start - 80), start));

export type SourceDialogueRecord = Readonly<{
  text: string;
  source_line: number;
  source_offset: number;
}>;

const sourceLineAt = (value: string, offset: number) =>
  value.slice(0, Math.max(0, offset)).split("\n").length;

const quotedDialogueRecords = (
  value: string,
  requireSpokenCue = false,
  lineOffset = 0,
  sourceOffsetBase = 0,
): SourceDialogueRecord[] => [...value.matchAll(quotedDialoguePattern)]
  .filter((match) => {
    if (!requireSpokenCue) return true;
    const start = match.index ?? 0;
    return isSpokenQuoteAt(value, start);
  })
  .flatMap((match) => {
    const body = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
    const bodyStart = (match.index ?? 0) + match[0].indexOf(body);
    let cursor = 0;
    return splitAuthoredDialogueSections(body).map((text) => {
      const needle = text;
      const relativeOffset = body.indexOf(needle, cursor);
      const sourceOffset = relativeOffset >= 0
        ? sourceOffsetBase + bodyStart + relativeOffset
        : -1;
      if (relativeOffset >= 0) cursor = relativeOffset + needle.length;
      const leadingBreaks = text.match(/^\n+/u)?.[0].length ?? 0;
      return {
        text,
        source_line: sourceOffset >= 0
          ? sourceLineAt(value, bodyStart + relativeOffset + leadingBreaks) + lineOffset
          : sourceLineAt(value, bodyStart) + lineOffset,
        source_offset: sourceOffset,
      };
    });
  })
  .filter((record) => !/\.(?:png|jpe?g|webp|gif|bmp|mp4|mov|pdf|pptx?|docx?)$/iu.test(record.text))
  .filter((record) => Boolean(record.text))
  .filter((record) => !/(?:主持人说|口播文案|话为主|以主持人说话)/u.test(record.text));

const quotedDialogueLines = (value: string, requireSpokenCue = false) =>
  quotedDialogueRecords(value, requireSpokenCue).map((record) => record.text);

// Source-first input parsing only: this protects authored dialogue so the
// director can reference it by order. It is not a scene, action, camera or
// keyword planner and must not be used to manufacture director facts.
export const extractDialogueLines = (value: string) => {
  const labelledMatch = value.match(/(?:^|\n)\s*(?:口播文案|旁白文案|配音文案|对白文案)\s*(?:为)?\s*[:：]?\s*([\s\S]*?)(?=\n\s*(?:视频生成意图描述|视频生成意图|画面描述|镜头描述|视觉描述|备注|说明)(?:\s*[:：][^\n]*)?(?:\n|$)|$)/u);
  const labelled = labelledMatch?.[1];
  if (labelled && labelledMatch) {
    const labelledText = repairDialogueBoundaryQuotes(labelled);
    const labelBodyStart = (labelledMatch.index ?? 0) + labelledMatch[0].indexOf(labelled);
    const labelSourceLine = sourceLineAt(value, labelBodyStart) - 1;
    const labelledTextOffset = labelled.indexOf(labelledText);
    const quoted = quotedDialogueRecords(
      labelledText,
      false,
      labelSourceLine,
      labelledTextOffset >= 0 ? labelBodyStart + labelledTextOffset : -1,
    );
    if (quoted.length > 0) return quoted;
    const plain = normalizeDialogueText(labelledText)
      .replace(/^(?:口播文案|旁白文案|配音文案|对白文案)\s*(?:为)?\s*[:：]?/u, "")
      .trim();
    if (plain) {
      const sourceLine = sourceLineAt(value, labelBodyStart);
      let cursor = 0;
      return splitAuthoredDialogueSections(plain).map((text, index) => {
        const needle = text;
        const relativeOffset = labelled.indexOf(needle, cursor);
        if (relativeOffset >= 0) cursor = relativeOffset + needle.length;
        const sourceOffset = relativeOffset >= 0 ? labelBodyStart + relativeOffset : -1;
        const leadingBreaks = text.match(/^\n+/u)?.[0].length ?? 0;
        return {
          text,
          source_line: sourceOffset >= 0
            ? sourceLineAt(value, sourceOffset + leadingBreaks)
            : sourceLine + index,
          source_offset: sourceOffset,
        };
      });
    }
  }
  const matches = quotedDialogueRecords(value, true);
  if (matches.length > 0) return matches;
  return [...value.matchAll(/(?:开口(?:问到|说道)?|说道|说|问道|回答)[:：]?\s*([^。！？!?\n]+)/gu)]
    .map((match) => {
      const text = normalizeDialogueText(match[1] ?? "");
      const sourceOffset = (match.index ?? 0) + match[0].indexOf(match[1] ?? "");
      return {
        text,
        source_line: sourceLineAt(value, sourceOffset),
        source_offset: sourceOffset,
      };
    })
    .filter((record) => Boolean(record.text))
    .filter((record) => !/(?:主持人说|口播文案|话为主|以主持人说话)/u.test(record.text));
};
