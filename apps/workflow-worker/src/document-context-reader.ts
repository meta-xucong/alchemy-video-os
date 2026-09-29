import type { PlanningDocumentContext } from "@alchemy-video/creative-planning";
import type { ControlPlanningDocumentContext } from "@alchemy-video/persistence";
import type { StoragePort } from "@alchemy-video/storage-client";

import { MAX_DOCUMENT_CONTEXT_CHARACTERS, MAX_DOCUMENT_CONTEXTS_PER_BRIEF, MAX_DOCUMENT_CONTEXT_TOTAL_CHARACTERS } from "@alchemy-video/persistence";

const MAX_DOCUMENT_CONTEXT_MARKDOWN_BYTES = 10 * 1024 * 1024;

const truncateUtf16Safely = (value: string, limit: number) => {
  if (value.length <= limit) return value;
  let end = limit;
  const previous = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff) {
    end -= 1;
  }
  return value.slice(0, end);
};

export type DocumentContextReadErrorCode =
  | "DOCUMENT_CONTEXT_REFERENCE_INVALID"
  | "DOCUMENT_CONTEXT_BUDGET_INVALID"
  | "DOCUMENT_CONTEXT_OBJECT_INVALID"
  | "DOCUMENT_CONTEXT_ENCODING_INVALID"
  | "DOCUMENT_CONTEXT_EMPTY";

export class DocumentContextReadError extends Error {
  constructor(readonly code: DocumentContextReadErrorCode) {
    super("Frozen document context failed a deterministic validation gate.");
    this.name = "DocumentContextReadError";
  }
}

export class BoundedDocumentContextReader {
  constructor(private readonly storage: StoragePort) {}

  async read(contexts: ControlPlanningDocumentContext[]): Promise<PlanningDocumentContext[]> {
    if (contexts.length === 0) return [];
    if (contexts.length > MAX_DOCUMENT_CONTEXTS_PER_BRIEF) {
      throw new DocumentContextReadError("DOCUMENT_CONTEXT_BUDGET_INVALID");
    }
    let remaining = MAX_DOCUMENT_CONTEXT_TOTAL_CHARACTERS;
    const results: PlanningDocumentContext[] = [];
    for (const [index, context] of contexts.entries()) {
      if (!Number.isInteger(context.sequence)
        || context.sequence !== index + 1
        || !Number.isInteger(context.maxContentCharacters)
        || context.maxContentCharacters < 1
        || context.maxContentCharacters > MAX_DOCUMENT_CONTEXT_CHARACTERS
        || !/^[a-f0-9]{64}$/.test(context.markdownSha256)) {
        throw new DocumentContextReadError("DOCUMENT_CONTEXT_REFERENCE_INVALID");
      }
      const limit = Math.min(context.maxContentCharacters, remaining);
      if (limit < 1) {
        throw new DocumentContextReadError("DOCUMENT_CONTEXT_BUDGET_INVALID");
      }
      const content = await this.readMarkdown(context.markdownObjectKey, limit, context.markdownSha256);
      results.push({
        documentId: context.documentId,
        conversionId: context.conversionId,
        sourceAssetId: context.sourceAssetId,
        markdownAssetId: context.markdownAssetId,
        markdownSha256: context.markdownSha256,
        maxContentCharacters: limit,
        content,
      });
      remaining -= content.length;
    }
    return results;
  }

  private async readMarkdown(objectKey: string, limit: number, expectedSha256: string) {
    const inspection = await this.storage.inspectObject({ objectKey });
    if (!inspection
      || inspection.mimeType !== "text/markdown"
      || inspection.byteSize < 1
      || inspection.byteSize > MAX_DOCUMENT_CONTEXT_MARKDOWN_BYTES
      || inspection.sha256 !== expectedSha256) {
      throw new DocumentContextReadError("DOCUMENT_CONTEXT_OBJECT_INVALID");
    }
    const object = await this.storage.readObject({ objectKey });
    if (!object
      || object.mimeType !== "text/markdown"
      || (object.byteSize !== undefined && object.byteSize !== inspection.byteSize)) {
      throw new DocumentContextReadError("DOCUMENT_CONTEXT_OBJECT_INVALID");
    }
    const reader = object.stream.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const decode = (value?: Uint8Array, stream = false) => {
      try {
        return decoder.decode(value, stream ? { stream: true } : undefined);
      } catch {
        throw new DocumentContextReadError("DOCUMENT_CONTEXT_ENCODING_INVALID");
      }
    };
    let content = "";
    try {
      while (content.length < limit) {
        const next = await reader.read();
        if (next.done) {
          content += decode();
          break;
        }
        content += decode(next.value, true);
      }
      if (content.length >= limit) {
        content = truncateUtf16Safely(content, limit);
        await reader.cancel();
      }
    } finally {
      reader.releaseLock();
    }
    const normalized = content.trim();
    if (!normalized) {
      throw new DocumentContextReadError("DOCUMENT_CONTEXT_EMPTY");
    }
    return normalized;
  }
}
