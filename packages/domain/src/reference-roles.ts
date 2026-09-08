import type { VisualReferenceRole } from "@alchemy-video/contracts";

const chineseOrdinals: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  七: 6,
};

const roleTerms: Readonly<Record<Exclude<VisualReferenceRole, "HANDOFF">, readonly string[]>> = {
  SCENE: ["场景", "环境", "背景", "建筑", "空间", "地点", "房间", "庭院", "别墅", "街道", "室内", "室外", "scene", "background", "location", "environment", "architecture", "building"],
  SUBJECT: ["主体", "人物", "角色", "人像", "男人", "女人", "男生", "女生", "模特", "产品", "商品", "物品", "character", "person", "subject", "product", "model"],
  STYLE: ["风格", "色调", "配色", "氛围", "视觉效果", "视觉", "材质", "纹理", "服装", "穿搭", "style", "palette", "mood", "texture", "wardrobe", "outfit"],
};

const referenceRoleTerms = Object.values(roleTerms).flat();
const referenceImageMarker = /(?:第\s*(?:\d+|[一二三四五六七])\s*张|(?:图片|图|照片|image|photo)\s*(?:\d+|[一二三四五六七])?|这张|该张|上传的|参考图)/i;
const referenceOnlyTerms = /(?:ui|界面|屏幕|面板|页面|按钮|仪表盘|软件|应用|网页|后台|控制台|背景|场景|环境|风格|配色|版式|布局|视觉锚点|参考素材|仅作参考|仅作为参考)/iu;
const explicitForegroundTerms = /(?:人物|角色|人像|模特|道具|实物|实体(?:产品|商品)?|产品(?:包装|本体|实物|实体|主体)|商品(?:包装|本体|主体)|车辆|汽车|轿车|设备|徽标|包装|手持|拿着|握着|佩戴|携带|换手|转交|持有|连续性)/u;

const parsePosition = (value: string | undefined) => {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) - 1;
  return chineseOrdinals[value];
};

const roleFromText = (value: string): Exclude<VisualReferenceRole, "HANDOFF"> | undefined => {
  const text = value.toLowerCase();
  const matches = (Object.entries(roleTerms) as Array<[Exclude<VisualReferenceRole, "HANDOFF">, readonly string[]]>).map(([role, terms]) => ({
    role,
    score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0),
  })).sort((left, right) => right.score - left.score);
  if (!matches[0] || matches[0].score === 0 || matches[0].score === matches[1]?.score) return undefined;
  return matches[0].role;
};

/**
 * Image-role instructions remain available to reference-role resolution, but
 * are not story events. This deliberately uses content rather than position.
 */
export const isVisualReferenceRoleInstruction = (value: string) => {
  const text = value.trim().toLowerCase();
  return Boolean(text)
    && referenceImageMarker.test(text)
    && referenceRoleTerms.some((term) => text.includes(term));
};

/**
 * Detect an explicitly authored UI/background/style reference clause.
 * This is a boundary predicate only; it does not infer a role from position
 * or from a visual model response.
 */
export const isVisualReferenceOnlyInstruction = (value: string) => {
  const text = value.trim();
  return Boolean(text) && referenceImageMarker.test(text) && referenceOnlyTerms.test(text);
};

export type VisualReferenceLockPolicy = "LOCK_OBJECTS" | "REFERENCE_ONLY";

const imageInstructionClause = (input: Readonly<{
  sourcePrompt: string;
  position: number;
  sourceImageNames?: ReadonlyArray<string | undefined>;
}>) => {
  const prompt = input.sourcePrompt;
  const markers = [...prompt.matchAll(/(?:第\s*(\d+|[一二三四五六七])\s*张|(?:图片|图|照片|image|photo)\s*(\d+|[一二三四五六七]))/gi)];
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const marker = markers[markerIndex]!;
    const markerPosition = parsePosition(marker[1] ?? marker[2]);
    if (markerPosition !== input.position) continue;
    const start = marker.index ?? 0;
    const nextMarker = markers[markerIndex + 1]?.index ?? prompt.length;
    return prompt.slice(start, Math.min(nextMarker, start + 160));
  }

  const filename = input.sourceImageNames?.[input.position]?.trim();
  if (!filename) return "";
  const filenameIndex = prompt.toLowerCase().indexOf(filename.toLowerCase());
  if (filenameIndex < 0) return "";
  const before = prompt.slice(0, filenameIndex).split(/[，,。；;\n]/u).at(-1) ?? "";
  const after = prompt.slice(filenameIndex + filename.length).split(/[，,。；;\n]/u, 1)[0] ?? "";
  return `${before}${filename}${after}`;
};

/**
 * Keep reference delivery and object-lock eligibility separate. A visual
 * analysis role is not, by itself, proof that its objects are continuity
 * locks; only an explicit foreground instruction opts into the existing lock
 * path. Unknown cases remain reference-only (no lock is invented).
 */
export const inferVisualReferenceLockPolicies = (input: Readonly<{
  sourcePrompt: string;
  roles: ReadonlyArray<VisualReferenceRole | undefined>;
  sourceImageNames?: ReadonlyArray<string | undefined>;
}>): VisualReferenceLockPolicy[] => input.roles.map((role, position) => {
  const clause = imageInstructionClause({ sourcePrompt: input.sourcePrompt, position, sourceImageNames: input.sourceImageNames });
  if (isVisualReferenceOnlyInstruction(clause)) return "REFERENCE_ONLY";
  if (explicitForegroundTerms.test(clause)) return "LOCK_OBJECTS";
  if (role === "SCENE" || role === "STYLE") return "REFERENCE_ONLY";
  return "REFERENCE_ONLY";
});

export type VisualReferenceAnalysis = {
  role: Exclude<VisualReferenceRole, "HANDOFF">;
  confidence: number;
  summary?: string;
  objects?: Array<{
    name: string;
    description: string;
    relation: string;
    prohibited_changes: string[];
  }>;
};

const validAnalysisRole = (value: unknown): value is VisualReferenceAnalysis["role"] =>
  value === "SUBJECT" || value === "SCENE" || value === "STYLE";

/** Read the internal, server-produced visual analysis stored on an asset. */
export const parseVisualReferenceAnalysis = (value: unknown): VisualReferenceAnalysis | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { role?: unknown; confidence?: unknown; summary?: unknown; objects?: unknown };
  if (!validAnalysisRole(candidate.role) || typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0.7) return undefined;
  const objects = Array.isArray(candidate.objects)
    ? candidate.objects.flatMap((object) => {
      if (!object || typeof object !== "object") return [];
      const item = object as Record<string, unknown>;
      if (typeof item.name !== "string" || typeof item.description !== "string" || typeof item.relation !== "string") return [];
      const prohibited = Array.isArray(item.prohibited_changes) ? item.prohibited_changes.filter((entry): entry is string => typeof entry === "string").slice(0, 4) : [];
      return [{ name: item.name.trim().slice(0, 80), description: item.description.trim().slice(0, 300), relation: item.relation.trim().slice(0, 200), prohibited_changes: prohibited.map((entry) => entry.slice(0, 240)) }];
    }).filter((object) => object.name && object.description && object.relation).slice(0, 12)
    : undefined;
  return {
    role: candidate.role,
    confidence: candidate.confidence,
    ...(typeof candidate.summary === "string" && candidate.summary.trim() ? { summary: candidate.summary.trim().slice(0, 240) } : {}),
    ...(objects && objects.length > 0 ? { objects } : {}),
  };
};

/** Resolve user instructions first, then server-produced visual analysis. Never infer by position. */
export const inferVisualReferenceRoles = (input: Readonly<{
  sourcePrompt: string;
  count: number;
  visionAnalyses?: ReadonlyArray<VisualReferenceAnalysis | undefined>;
  /** User-visible source filenames let explicit instructions target a file without relying on upload order. */
  sourceImageNames?: ReadonlyArray<string | undefined>;
}>): Array<VisualReferenceRole | undefined> => {
  const roles: Array<VisualReferenceRole | undefined> = Array.from({ length: input.count }, (_, position) => input.visionAnalyses?.[position]?.role);
  const prompt = input.sourcePrompt.trim();
  if (!prompt || input.count === 0) return roles;

  const markers = [...prompt.matchAll(/(?:第\s*(\d+|[一二三四五六七])\s*张|(?:图片|图|照片|image|photo)\s*(\d+|[一二三四五六七]))/gi)];
  markers.forEach((marker, markerIndex) => {
    const position = parsePosition(marker[1] ?? marker[2]);
    if (position === undefined || position < 0 || position >= input.count) return;
    const start = marker.index ?? 0;
    const nextMarker = markers[markerIndex + 1]?.index ?? prompt.length;
    const clause = prompt.slice(start, Math.min(nextMarker, start + 100)).split(/[，,。；;\n]/, 1)[0] ?? "";
    const role = roleFromText(clause);
    if (role) roles[position] = role;
  });

  // A filename is a semantic identifier when the user explicitly mentions it,
  // e.g. "人物.png 为人物原型". This is not an upload-order fallback.
  (input.sourceImageNames ?? []).forEach((name, position) => {
    if (!name?.trim()) return;
    const filename = name.trim().toLowerCase();
    const filenameIndex = prompt.toLowerCase().indexOf(filename);
    if (filenameIndex < 0) return;
    const before = prompt.slice(0, filenameIndex).split(/[，,。；;\n]/).at(-1) ?? "";
    const after = prompt.slice(filenameIndex + filename.length).split(/[，,。；;\n]/, 1)[0] ?? "";
    const clause = `${before} ${after}`;
    const role = roleFromText(clause);
    if (role) roles[position] = role;
  });

  // "Other/remaining images are scene/style references" explicitly covers
  // every still-unresolved selected image. It is a user instruction, not a
  // positional guess, so it is applied only to roles left unresolved above.
  const remainderClauses = [...prompt.matchAll(/(?:其他|其余|剩余)[^。；;\n]{0,100}(?:图片|图|照片|参考图)[^。；;\n]{0,100}/gi)];
  const remainderRole = remainderClauses
    .map((match) => roleFromText(match[0] ?? ""))
    .find((role): role is Exclude<VisualReferenceRole, "HANDOFF"> => Boolean(role));
  if (remainderRole) {
    roles.forEach((role, position) => {
      if (!role) roles[position] = remainderRole;
    });
  }
  // A single uploaded image can be described without a numbered marker.
  // Never apply this shortcut when multiple images exist, where it would be an order guess.
  if (input.count === 1 && !roles[0]) {
    const marker = prompt.match(/(?:这张|该张|上传的|参考图|图片|照片|image|photo)/i);
    if (marker?.index !== undefined) {
      const clause = prompt.slice(marker.index, marker.index + 120).split(/[，,。；;\n]/, 1)[0] ?? "";
      const role = roleFromText(clause);
      if (role) roles[0] = role;
    }
  }
  return roles;
};
