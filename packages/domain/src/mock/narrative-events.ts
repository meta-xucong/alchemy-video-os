import { isVisualReferenceRoleInstruction } from "./reference-roles.js";

export type NarrativeSentenceKind = "ACTION" | "STATE" | "EXPOSITION" | "CONTROL";

export type NarrativeSentence = Readonly<{
  text: string;
  kind: NarrativeSentenceKind;
}>;

const authoringInstruction = /^(?:(?:请(?:你)?(?:把|将)?)|把|将).{0,120}(?:改编|设计|整理|写)(?:成|为).{0,30}(?:剧本|分镜|视频|短片|故事计划|脚本)[。！!]?$/u;
const directGenerationInstruction = /^(?:请(?:你)?|帮我|我要|我想)?(?:生成|制作|输出|创作)(?:一条|一个|这段|这个)?(?:视频|短片|分镜)?[。！!]?$/u;
const expositionMarker = /(?:这便是|这就是|意味着|象征|说明了|区别|不需要|无需|不用|并非|不是|没有必要|无需展现)/u;
const actionMarker = /(?:走|行走|来到|经过|靠近|接近|转身|转向|抬头|低头|看(?:到|向|见)?|望(?:向|见)?|拿|取|放|递|交|开|关|推|拉|坐|站|起身|停(?:下|步)?|伸|抬|拨|碰|触|躲|开口|说|问|回答|微笑|点头|挥|跑|进入|离开|出现|消失)/u;
const stateMarker = /(?:神情|呼吸|衣袖|裙摆|服装|发型|姿态|表情|没有明显|保持|显得|看起来|坐落|位于|环境|氛围|光线)/u;
const negativeConstraintMarker = /(?:不需要|无需|不用|并非|不是|没有必要|禁止|不得|不要|不能|不可|不进入|不踩|不游泳|不下水)/u;
const dynamicActionMarker = /(?:走|行走|来到|经过|靠近|接近|转身|转向|抬头|低头|拿|取|放|递|交|开|关|推|拉|起身|伸|抬|拨|碰|触|躲|开口|说|问|回答|微笑|点头|挥|跑|进入|离开|出现|消失)/u;

// These are source labels, not content keywords. Huobao's storyboard
// contract separates `atmosphere` from visible `description`; Seedance's
// long-video template uses `Global`/`Throughout` (including look/locks) and
// timestamp phases. The English forms are the fixed-source labels. The
// Chinese forms are a pre-existing platform-input compatibility spelling;
// they are deliberately kept out of the source-migration claim and must not
// be extended into a new classifier. Unlabelled prose remains on the
// existing classifier.
const globalContextLabel = /^(?:标题[\/／]主题|全局(?:风格|氛围|声音[\/／]文字政策|连续性锁)|atmosphere|sound(?:\s+policy)?|look|locks?|global(?:\s+(?:setting|look|locks?|continuity\s+locks|sound\s+policy))?|throughout)\s*[:：]/iu;

const globalContextHeading = /^(?:标题[\/／]主题|全局(?:风格|氛围|声音[\/／]文字政策|连续性锁)|atmosphere|sound(?:\s+policy)?|look|locks?|global(?:\s+(?:setting|look|locks?|continuity\s+locks|sound\s+policy))?|throughout)\s*[:：]?\s*$/iu;
const sourceInstructionHeading = /^(?:(?:AI\s*)?创意视频(?:呈现方向|口播文案)?|视频生成意图(?:描述)?)\s*[:：]?\s*$/iu;

// A standalone source heading establishes the next labelled block.  The
// action headings terminate that block without assigning their label to an
// executable sentence.  This mirrors the source's explicit section shape;
// it is deliberately not a generic keyword/score-based role detector.
const executableContextHeading = /^(?:视觉动作|可执行视觉(?:节拍|动作)?|有序视觉动作|叙事(?:节拍|点)|画面描述|镜头描述|视觉描述|备注|说明|时间轴(?:脚本)?|timestamp\s+script|phases?|(?:script\s+)?section(?:\s+\d+)?|scene(?:\s+\d+)?)\s*[:：]?\s*$/iu;
const sourceFormattingPrefix = /^(?:[-*+•]\s+|#{1,6}\s*)/u;
const stripSourceFormatting = (value: string) => value.replace(sourceFormattingPrefix, "").trim();
const unwrapSourceHeading = (value: string) => stripSourceFormatting(value).replace(/^【\s*|\s*】$/gu, "").trim();
const explicitShotPrefix = /^【\s*镜头\s*\d+\s*】/u;
const timestampSourcePrefix = /^\d+(?:\.\d+)?\s*(?:[-–—]\s*\d+(?:\.\d+)?\s*(?:秒|s)?|秒)\s*[:：]/iu;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

type NarrativeSourcePiece = Readonly<{
  text: string;
  globalContext: boolean;
}>;

const splitSourceLine = (value: string, globalContext: boolean, inlineGlobal = false): NarrativeSourcePiece[] => {
  const normalized = normalize(value);
  if (!normalized) return [];
  const pieces = normalized
    .split(/(?<=[。！？!?；;])\s*/u)
    .map((text) => normalize(text))
    .filter(Boolean);
  let inlineGlobalActive = inlineGlobal;
  return pieces.map((text) => {
    const pieceGlobalContext = globalContext
      || globalContextLabel.test(stripSourceFormatting(text))
      || inlineGlobalActive;
    // An inline label owns only its explicitly labelled source piece. The
    // existing punctuation split treats semicolons as authored boundaries;
    // do not carry a global role into an unlabeled action after `；`/`;`.
    inlineGlobalActive = false;
    return { text, globalContext: pieceGlobalContext };
  });
};

const narrativeSourcePieces = (sourceText: string): NarrativeSourcePiece[] => {
  const lines = sourceText.replace(/\r\n?/g, "\n").split("\n");
  const pieces: NarrativeSourcePiece[] = [];
  let globalBlock = false;
  for (const line of lines) {
    const normalized = normalize(line);
    if (!normalized) {
      // A blank line is an explicit block boundary.  Do not let a global
      // setting heading claim an unrelated action section below it.
      globalBlock = false;
      continue;
    }
    const heading = unwrapSourceHeading(normalized);
    if (globalContextHeading.test(heading)) {
      globalBlock = true;
      continue;
    }
    if (sourceInstructionHeading.test(heading)) {
      globalBlock = false;
      continue;
    }
    if (executableContextHeading.test(heading)) {
      globalBlock = false;
      continue;
    }
    const sourceLine = stripSourceFormatting(normalized);
    if (explicitShotPrefix.test(sourceLine) || timestampSourcePrefix.test(sourceLine)) {
      globalBlock = false;
    }
    const inlineGlobal = globalContextLabel.test(stripSourceFormatting(normalized));
    pieces.push(...splitSourceLine(normalized, globalBlock, inlineGlobal));
  }
  return pieces;
};

export const classifyNarrativeSentence = (value: string): NarrativeSentenceKind => {
  const text = normalize(value);
  if (!text || authoringInstruction.test(text) || directGenerationInstruction.test(text)) return "CONTROL";
  if (isVisualReferenceRoleInstruction(text) && !actionMarker.test(text)) return "CONTROL";
  if (globalContextHeading.test(unwrapSourceHeading(text))) return "CONTROL";
  if (sourceInstructionHeading.test(unwrapSourceHeading(text))) return "CONTROL";
  // An explicit source label is the only role evidence used here.  It keeps
  // title/style/atmosphere/sound policy in the existing STATE constraint
  // channel even when the value happens to contain an action-like word.
  if (globalContextLabel.test(stripSourceFormatting(text))) return "STATE";
  // Negative physical constraints are visual locks, not executable story
  // beats. Check them before the broad action marker (which also matches
  // words such as "站" and "进入").
  if (negativeConstraintMarker.test(text)) {
    const withoutNegativeClause = text.replace(/(?:不需要|无需|不用|并非|不是|没有必要|禁止|不得|不要|不能|不可|不进入|不踩|不游泳|不下水)[^，。；;]*/gu, " ");
    if (!dynamicActionMarker.test(withoutNegativeClause)) return "EXPOSITION";
  }
  // Mixed clauses still need to produce an executable event. Their state and
  // exposition clauses are extracted separately as visual constraints.
  if (actionMarker.test(text)) return "ACTION";
  if (expositionMarker.test(text)) return "EXPOSITION";
  if (stateMarker.test(text)) return "STATE";
  // Preserve unfamiliar verbs and non-Chinese story prose as events by default.
  return "ACTION";
};

export const extractNarrativeSentences = (sourceText: string): NarrativeSentence[] => narrativeSourcePieces(sourceText)
  .map(({ text, globalContext }) => ({
    text,
    kind: globalContext ? "STATE" : classifyNarrativeSentence(text),
  }));

const splitConstraintClauses = (text: string) => text
  .split(/[，,；;]/u)
  .map((value) => normalize(value).replace(/[。！？!?]+$/u, ""))
  .filter(Boolean);

/** Pull static constraints out of mixed sentences without dropping their actions. */
export const extractVisualConstraints = (sourceText: string): string[] => extractNarrativeSentences(sourceText)
  .flatMap((sentence) => {
    if (sentence.kind === "STATE") return [sentence.text.replace(/[。！？!?]+$/u, "")];
    const clauses = splitConstraintClauses(sentence.text);
    const selected = clauses.filter((clause) => stateMarker.test(clause) || negativeConstraintMarker.test(clause));
    if (selected.length > 0) return selected;
    return sentence.kind === "EXPOSITION" && negativeConstraintMarker.test(sentence.text)
      ? [sentence.text.replace(/[。！？!?]+$/u, "")]
      : [];
  });
