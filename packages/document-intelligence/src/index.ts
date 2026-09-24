import type {
  DocumentFactCategory,
  DocumentFactConfidence,
  DocumentKnowledgeAnalysisQuality,
  DocumentKnowledgeEvidenceKind,
} from "@alchemy-video/contracts";

export const MAX_DOCUMENT_MARKDOWN_BYTES = 2_000_000;
export const STRUCTURAL_DOCUMENT_INDEX_VERSION = "structural-document-index-v1";

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
        throw new Error("Document Markdown exceeds the structural index input limit.");
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
      current = {
        heading: boundedStatement(normalizeLine(heading)) || "未命名章节",
        lines: [],
        hasVisualOnlyEvidence: false,
      };
      continue;
    }
    current.lines.push(rawLine);
    if (visualMarker.test(rawLine)) current.hasVisualOnlyEvidence = true;
  }
  pushCurrent();
  return sections.length > 0 ? sections : [{ heading: "文档内容", lines: [], hasVisualOnlyEvidence: true }];
};

/**
 * Production-safe boundary: preserve only source structure and locators.
 * Semantic categories, relevance, ranking, conflicts, and task-specific facts
 * belong to the verified Semantic Director with the complete task context.
 */
export class StructuralDocumentIndexAdapter implements DocumentUnderstandingPort {
  async analyze(input: {
    conversion: FrozenConversionReference;
    markdown: ReadableStream<Uint8Array>;
    analyzerVersion: string;
  }): Promise<DocumentKnowledgeDraft> {
    if (input.analyzerVersion !== STRUCTURAL_DOCUMENT_INDEX_VERSION) {
      throw new Error("Unsupported structural document index version.");
    }
    if (!input.conversion.documentId
      || !input.conversion.conversionId
      || !/^[a-f0-9]{64}$/u.test(input.conversion.markdownSha256)) {
      throw new Error("A frozen conversion reference is required for document indexing.");
    }
    const sections = splitSections(await readBoundedUtf8(input.markdown));
    const indexedSections = sections.map((section, index) => {
      const usableTextLineCount = section.lines.filter((line) => {
        const normalized = normalizeLine(line);
        return normalized.length > 0 && !visualMarker.test(normalized) && !tableDivider.test(line);
      }).length;
      return {
        sequence: index + 1,
        heading: section.heading,
        locator: `第 ${index + 1} 节：${section.heading}`,
        evidenceKind: section.hasVisualOnlyEvidence && usableTextLineCount === 0
          ? "VISUAL_UNAVAILABLE" as const
          : section.lines.some((line) => /^\s*\|/u.test(line))
            ? "TABLE" as const
            : "TEXT" as const,
      };
    });
    return {
      analyzerVersion: input.analyzerVersion,
      analysisQuality: indexedSections.some((section) => section.evidenceKind === "VISUAL_UNAVAILABLE")
        ? "PARTIAL"
        : "COMPLETE",
      sections: indexedSections,
      facts: [],
    };
  }
}
