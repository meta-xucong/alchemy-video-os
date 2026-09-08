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

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

export const classifyNarrativeSentence = (value: string): NarrativeSentenceKind => {
  const text = normalize(value);
  if (!text || authoringInstruction.test(text) || directGenerationInstruction.test(text)) return "CONTROL";
  if (isVisualReferenceRoleInstruction(text) && !actionMarker.test(text)) return "CONTROL";
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

export const extractNarrativeSentences = (sourceText: string): NarrativeSentence[] => sourceText
  .replace(/\r\n?/g, "\n")
  .split(/(?<=[。！？!?；;])\s*|\n+/u)
  .map((value) => normalize(value))
  .filter(Boolean)
  .map((text) => ({ text, kind: classifyNarrativeSentence(text) }));

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
