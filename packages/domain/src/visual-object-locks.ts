import type { KeyVisualObjectLock } from "@alchemy-video/contracts";
import { isVisualReferenceOnlyInstruction } from "./reference-roles.js";

const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
type Holder = "LEFT_HAND" | "RIGHT_HAND" | "BOTH_HANDS" | "WORLD" | "NOT_VISIBLE";
const objectPattern = /(?:手持|拿着|拿住|握着|带着|携带|佩戴|戴着|背着|抱着|举着|放着|摆着|身旁有|旁边有|桌上有|画面中有)([^，。；;\n]{1,32})/gu;
const knownObjectPattern = /(?:拂尘|长剑|宝剑|书卷|画卷|茶杯|手机|相机|麦克风|车辆|汽车|轿车|产品|包装盒|徽标|项链|耳环|手镯|公文包|雨伞|扇子|灯笼|设备)/gu;

const cleanCandidate = (value: string) => normalize(value)
  .split(/(?:缓缓|慢慢|快速|走来|走向|进入|来到|然后|并)/u, 1)[0]!
  .replace(/^(?:一把|一柄|一只|一个|一件|一卷|一枚|一串|一辆|白色的|黑色的|金色的|银色的)/u, "")
  .replace(/[的地]$/u, "")
  .slice(0, 80);

const sentenceForObject = (text: string, name: string) => text
  .split(/[。；;\n]/u)
  .find((sentence) => sentence.includes(name)) ?? text;

const isReferenceOnlyObjectSentence = (text: string, name: string) =>
  isVisualReferenceOnlyInstruction(sentenceForObject(text, name));

const objectContext = (text: string, name: string) => {
  const sentence = sentenceForObject(text, name);
  const index = sentence.indexOf(name);
  return sentence.slice(Math.max(0, index - 24), Math.min(sentence.length, index + name.length + 36));
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const possessionForObject = (text: string, name: string): Holder | undefined => {
  const sentence = sentenceForObject(text, name);
  const escaped = escapeRegExp(name);
  const before = (hand: string) => new RegExp(`${hand}[^，。；;\\n]{0,12}${escaped}`, "u").test(sentence);
  const after = (hand: string) => new RegExp(`${escaped}[^，。；;\\n]{0,12}${hand}`, "u").test(sentence);
  if ((before("双手") || before("两手")) && !before("左手") && !before("右手")) return "BOTH_HANDS";
  if (before("左手") || after("左手")) return "LEFT_HAND";
  if (before("右手") || after("右手")) return "RIGHT_HAND";
  return undefined;
};

const transferForObject = (text: string, name: string): { from: Holder; to: Holder } | undefined => {
  const parse = (value: string) => value.match(/(?:从)?(左手|右手)[^，。；;\n]{0,18}(?:换到|交给|递给|转到|移到|接过)[^，。；;\n]{0,12}(左手|右手)/u)
    ?? value.match(/(?:从)?(左手|右手)[^，。；;\n]{0,18}(?:将|把)[^，。；;\n]{0,30}(?:换到|交给|递给|转到|移到)[^，。；;\n]{0,12}(左手|右手)/u);
  const sentence = sentenceForObject(text, name);
  const sentenceMatch = parse(sentence);
  const sentences = text.split(/[。！？!?]/u);
  const sentenceIndex = sentences.findIndex((value) => value.includes(name));
  const follow = sentenceIndex >= 0 ? sentences[sentenceIndex + 1] ?? "" : "";
  const match = sentenceMatch ?? (/(?:它|该物体|物品|随后)/u.test(follow) ? parse(`${sentence}。${follow}`) : undefined);
  if (!match || match[1] === match[2]) return undefined;
  return {
    from: match[1] === "左手" ? "LEFT_HAND" : "RIGHT_HAND",
    to: match[2] === "左手" ? "LEFT_HAND" : "RIGHT_HAND",
  };
};

/** Extract conservative, user-authored object locks. Never infers from upload position. */
export const extractKeyVisualObjectLocks = (sourceText: string): KeyVisualObjectLock[] => {
  const text = normalize(sourceText);
  const candidates = [
    ...[...text.matchAll(objectPattern)].map((match) => cleanCandidate(match[1] ?? "")),
    ...[...text.matchAll(knownObjectPattern)].map((match) => cleanCandidate(match[0] ?? "")),
  ].filter((value) => value.length >= 2 && value.length <= 80);
  const unique = [...new Set(candidates)]
    .filter((value) => !isReferenceOnlyObjectSentence(text, value))
    .filter((value, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.length > value.length && other.includes(value)))
    .slice(0, 12);
  return unique.map((name) => ({
    name,
    description: `保持${name}的名称、外观、颜色、材质和可辨识细节与参考素材及用户描述一致。`,
    relation: "保持与正确人物、手部或所在空间的持有/相对位置关系一致。",
    prohibited_changes: [`不得将${name}替换为树枝、木棍、其他物体或无关道具。`, `不得让${name}在动作过程中无故消失、合并或变形。`],
    instance_count: 1,
    ...(possessionForObject(text, name) ? { holder: possessionForObject(text, name) } : {}),
    ...(transferForObject(text, name) ? { transfer: transferForObject(text, name) } : {}),
  }));
};
