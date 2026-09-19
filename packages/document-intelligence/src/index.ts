import type {
  DocumentFactCategory,
  DocumentFactConfidence,
  DocumentKnowledgeAnalysisQuality,
  DocumentKnowledgeEvidenceKind,
} from "@alchemy-video/contracts";
import { createHash } from "node:crypto";
import {
  CreativeBriefFactContextSchema,
  SegmentFactPackSchema,
  type CreativeBriefFactContext,
  type FrozenDocumentFact,
  type SegmentFactPack,
} from "@alchemy-video/contracts";

export const DETERMINISTIC_DOCUMENT_UNDERSTANDING_VERSION = "deterministic-document-understanding-v1";
export const MAX_DOCUMENT_MARKDOWN_BYTES = 2_000_000;

export type FrozenConversionReference = {
  documentId: string;
  conversionId: string;
  markdownSha256: string;
};

export type DocumentKnowledgeDraftSection = {
  sequence: number;
  heading: string;
  locator: string;
  evidenceKind: DocumentKnowledgeEvidenceKind;
};

export type DocumentKnowledgeDraftFact = {
  category: DocumentFactCategory;
  statement: string;
  confidence: DocumentFactConfidence;
  sectionSequence: number;
  locator: string;
};

export type DocumentKnowledgeDraft = {
  analyzerVersion: string;
  analysisQuality: DocumentKnowledgeAnalysisQuality;
  sections: readonly DocumentKnowledgeDraftSection[];
  facts: readonly DocumentKnowledgeDraftFact[];
};

export interface DocumentUnderstandingPort {
  analyze(input: {
    conversion: FrozenConversionReference;
    markdown: ReadableStream<Uint8Array>;
    analyzerVersion: string;
  }): Promise<DocumentKnowledgeDraft>;
}

type MutableSection = {
  heading: string;
  lines: string[];
  hasVisualOnlyEvidence: boolean;
};

const categoryRules: readonly [DocumentFactCategory, RegExp][] = [
  ["COMPLIANCE", /合规|合法|资质|许可|备案|法律|医疗|金融|保证/u],
  ["CTA", /咨询|预约|联系|扫码|立即|欢迎到访|报名/u],
  ["AUDIENCE", /客群|人群|客户|适合|面向/u],
  ["LOCATION", /地址|位于|坐落|地处|区域|交通|公里|分钟/u],
  ["AMENITY", /配套|温泉|泳池|会所|车位|园林|服务/u],
  ["STYLE", /风格|调性|设计|美学|质感/u],
  ["BRAND", /品牌|定位|理念|愿景/u],
  ["PRODUCT", /产品|户型|项目|房源|方案/u],
  ["SELLING_POINT", /卖点|优势|核心|特色|亮点/u],
];

const injectionLike = /ignore\s+(all\s+)?previous|system\s+prompt|developer\s+message|忽略.{0,12}(指令|要求)|系统提示|开发者消息/iu;
const visualMarker = /!\[[^\]]*\]\([^)]*\)|<img\b|\[图[片表]\]|图表|平面图|流程图/u;
const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u;
const markdownDecoration = /[*_`>#]/gu;

const normalizeLine = (line: string) => line
  .replace(/^\s*(?:[-*+] |\d+[.)] )/u, "")
  .replace(/\|/gu, " ")
  .replace(markdownDecoration, "")
  .replace(/\s+/gu, " ")
  .trim();

const boundedStatement = (value: string) => Array.from(value).slice(0, 500).join("");

const categoryFor = (statement: string): DocumentFactCategory => {
  if (/\d/u.test(statement) && /(元|万|亿|㎡|平方|亩|年|月|日|分钟|公里|%|％|套|席|户|层|m²)/u.test(statement)) {
    return "NUMERIC_CLAIM";
  }
  return categoryRules.find(([, pattern]) => pattern.test(statement))?.[0] ?? "PRODUCT";
};

const readBoundedUtf8 = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_DOCUMENT_MARKDOWN_BYTES) {
        throw new Error("Document Markdown exceeds the deterministic analyzer input limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

const splitSections = (markdown: string): readonly MutableSection[] => {
  const sections: MutableSection[] = [];
  let current: MutableSection = { heading: "文档开始", lines: [], hasVisualOnlyEvidence: false };
  const pushCurrent = () => {
    if (current.lines.length > 0 || current.hasVisualOnlyEvidence) sections.push(current);
  };
  for (const rawLine of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)?.[1]
      ?? rawLine.match(/^\s*(?:slide|幻灯片)\s*\d+\s*[:：-]\s*(.+)$/iu)?.[1];
    if (heading) {
      pushCurrent();
      current = { heading: boundedStatement(normalizeLine(heading)) || "未命名章节", lines: [], hasVisualOnlyEvidence: false };
      continue;
    }
    current.lines.push(rawLine);
    if (visualMarker.test(rawLine)) current.hasVisualOnlyEvidence = true;
  }
  pushCurrent();
  return sections.length > 0 ? sections : [{ heading: "文档内容", lines: [], hasVisualOnlyEvidence: true }];
};

const extractFacts = (section: MutableSection, sequence: number): readonly DocumentKnowledgeDraftFact[] => {
  const locator = `第 ${sequence} 节：${section.heading}`;
  const facts: DocumentKnowledgeDraftFact[] = [];
  let recordedInjectionRisk = false;
  for (const rawLine of section.lines) {
    const statement = boundedStatement(normalizeLine(rawLine));
    if (statement.length < 3 || tableDivider.test(rawLine)) continue;
    if (injectionLike.test(statement)) {
      if (!recordedInjectionRisk) {
        facts.push({ category: "RISK", statement: "资料包含不可执行指令，需人工确认后再使用。", confidence: "NEEDS_CONFIRMATION", sectionSequence: sequence, locator });
        recordedInjectionRisk = true;
      }
      continue;
    }
    if (visualMarker.test(statement)) continue;
    facts.push({
      category: categoryFor(statement),
      statement,
      confidence: "EXPLICIT",
      sectionSequence: sequence,
      locator,
    });
  }
  return facts;
};

export class DeterministicDocumentUnderstandingAdapter implements DocumentUnderstandingPort {
  async analyze(input: {
    conversion: FrozenConversionReference;
    markdown: ReadableStream<Uint8Array>;
    analyzerVersion: string;
  }): Promise<DocumentKnowledgeDraft> {
    if (input.analyzerVersion !== DETERMINISTIC_DOCUMENT_UNDERSTANDING_VERSION) {
      throw new Error("Unsupported deterministic document analyzer version.");
    }
    if (!input.conversion.documentId || !input.conversion.conversionId || !/^[a-f0-9]{64}$/u.test(input.conversion.markdownSha256)) {
      throw new Error("A frozen conversion reference is required for document understanding.");
    }

    const sections = splitSections(await readBoundedUtf8(input.markdown));
    const publicSections = sections.map((section, index) => {
      const usableTextLineCount = section.lines.filter((line) => {
        const normalized = normalizeLine(line);
        return normalized.length > 0 && !visualMarker.test(normalized) && !injectionLike.test(normalized) && !tableDivider.test(line);
      }).length;
      return {
      sequence: index + 1,
      heading: section.heading,
      locator: `第 ${index + 1} 节：${section.heading}`,
      evidenceKind: section.hasVisualOnlyEvidence && usableTextLineCount === 0
        ? "VISUAL_UNAVAILABLE" as const
        : section.lines.some((line) => /^\s*\|/u.test(line)) ? "TABLE" as const : "TEXT" as const,
      };
    });
    const facts = sections.flatMap((section, index) => extractFacts(section, index + 1));
    const deduplicatedFacts = facts.filter((fact, index) => facts.findIndex((candidate) =>
      candidate.category === fact.category && candidate.statement === fact.statement && candidate.sectionSequence === fact.sectionSequence,
    ) === index).slice(0, 120);
    const conflictingIndexes = new Set<number>();
    const conflictGroups = new Map<string, Array<{ index: number; fact: DocumentKnowledgeDraftFact }>>();
    deduplicatedFacts.forEach((fact, index) => {
      const key = `${fact.category}:${normalizeFactText(fact.statement).replace(/\d+(?:\.\d+)?/gu, "#")}`;
      conflictGroups.set(key, [...(conflictGroups.get(key) ?? []), { index, fact }]);
    });
    for (const group of conflictGroups.values()) {
      const distinctStatements = new Set(group.map(({ fact }) => normalizeFactText(fact.statement)));
      if (distinctStatements.size > 1 && group.some(({ fact }) => fact.category === "NUMERIC_CLAIM")) {
        group.forEach(({ index }) => conflictingIndexes.add(index));
      }
    }
    const factsWithConflictFlags = deduplicatedFacts.map((fact, index) => conflictingIndexes.has(index)
      ? { ...fact, confidence: "NEEDS_CONFIRMATION" as const }
      : fact);
    const hasRisk = factsWithConflictFlags.some((fact) => fact.confidence === "NEEDS_CONFIRMATION");
    const hasVisualGap = publicSections.some((section) => section.evidenceKind === "VISUAL_UNAVAILABLE") || sections.some((section) => section.hasVisualOnlyEvidence);

    return {
      analyzerVersion: input.analyzerVersion,
      analysisQuality: hasRisk ? "NEEDS_CONFIRMATION" : hasVisualGap ? "PARTIAL" : "COMPLETE",
      sections: publicSections,
      facts: factsWithConflictFlags,
    };
  }
}

export type FactSelectionInput = {
  creativeBriefRevisionId: string;
  sourceText: string;
  stylePreferences: string;
  facts: readonly FrozenDocumentFact[];
};

export type FactSelectionPort = {
  selectForBrief(input: FactSelectionInput): readonly CreativeBriefFactContext[];
  selectForSegment(input: { segmentSequence: number; narrativeText: string; contexts: readonly CreativeBriefFactContext[] }): SegmentFactPack;
};

const normalizeFactText = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/gu, " ").trim();
const tokens = (value: string) => {
  const normalized = normalizeFactText(value);
  const chars = [...normalized];
  const han: string[] = [];
  for (let index = 0; index + 1 < chars.length; index += 1) {
    if (/\p{Script=Han}/u.test(chars[index]!) && /\p{Script=Han}/u.test(chars[index + 1]!)) han.push(`${chars[index]}${chars[index + 1]}`);
  }
  const latin = normalized.match(/[a-z0-9]{2,}/gu) ?? [];
  return new Set([...han, ...latin]);
};
const hashSnapshot = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflictKey = (fact: FrozenDocumentFact) => `${fact.category}:${normalizeFactText(fact.statement).replace(/\d+(?:\.\d+)?/gu, "#")}`;

const conflictedFactIds = (facts: readonly FrozenDocumentFact[]) => {
  const groups = new Map<string, FrozenDocumentFact[]>();
  for (const fact of facts) {
    const key = conflictKey(fact);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const conflicted = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((fact) => normalizeFactText(fact.statement))).size > 1 && group.some((fact) => fact.category === "NUMERIC_CLAIM")) {
      for (const fact of group) conflicted.add(fact.fact_id);
    }
  }
  return conflicted;
};

const rankFact = (fact: FrozenDocumentFact, queryTokens: Set<string>) => {
  const overlap = [...tokens(fact.statement)].filter((token) => queryTokens.has(token)).length;
  const categoryWeight = fact.category === "BRAND" || fact.category === "COMPLIANCE" ? 40 : fact.category === "SELLING_POINT" ? 30 : 10;
  const confidenceWeight = fact.confidence === "EXPLICIT" ? 20 : fact.confidence === "INFERRED" ? 5 : 0;
  return categoryWeight + confidenceWeight + overlap * 3 - fact.source.section_sequence / 1000;
};

export class DeterministicFactSelector implements FactSelectionPort {
  selectForBrief(input: FactSelectionInput): readonly CreativeBriefFactContext[] {
    const conflicts = conflictedFactIds(input.facts);
    const query = tokens(`${input.sourceText} ${input.stylePreferences}`);
    const candidates = input.facts
      .filter((fact) => fact.confidence !== "NEEDS_CONFIRMATION" && !conflicts.has(fact.fact_id))
      .sort((left, right) => rankFact(right, query) - rankFact(left, query) || left.source.section_sequence - right.source.section_sequence || left.fact_id.localeCompare(right.fact_id))
      .slice(0, 24);
    return candidates.map((fact, index) => CreativeBriefFactContextSchema.parse({
      creative_brief_revision_id: input.creativeBriefRevisionId,
      fact_id: fact.fact_id,
      sequence: index + 1,
      fact,
      selection_reason: conflicts.size > 0 ? "按类别、关键词和来源位置排序；冲突候选已排除。" : "按类别、关键词、置信等级和来源位置确定性排序。",
      snapshot_hash: hashSnapshot({ creative_brief_revision_id: input.creativeBriefRevisionId, sequence: index + 1, fact }),
    }));
  }

  selectForSegment(input: { segmentSequence: number; narrativeText: string; contexts: readonly CreativeBriefFactContext[] }): SegmentFactPack {
    const query = tokens(input.narrativeText);
    const global = input.contexts.filter((context) => ["BRAND", "COMPLIANCE", "STYLE"].includes(context.fact.category)).slice(0, 12);
    const relevant = input.contexts
      .filter((context) => !global.some((item) => item.fact_id === context.fact_id))
      .filter((context) => [...tokens(context.fact.statement)].some((token) => query.has(token)))
      .sort((left, right) => rankFact(right.fact, query) - rankFact(left.fact, query) || left.sequence - right.sequence)
      .slice(0, 8);
    return SegmentFactPackSchema.parse({
      segment_sequence: input.segmentSequence,
      global_brand_locks: global.map((context) => context.fact),
      segment_facts: relevant.map((context) => context.fact),
      fact_refs: [...global, ...relevant].map((context) => context.fact_id),
      selection_reason: "仅选择全局品牌/合规锁及与本段文本关键词相关的事实；未匹配事实不会跨段复制。",
    });
  }
}
