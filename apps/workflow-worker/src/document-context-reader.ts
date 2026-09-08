import type { PlanningDocumentContext } from "@alchemy-video/creative-planning";
import type { ControlPlanningDocumentContext } from "@alchemy-video/persistence";
import type { StoragePort } from "@alchemy-video/storage-client";

import { MAX_DOCUMENT_CONTEXT_CHARACTERS, MAX_DOCUMENT_CONTEXTS_PER_BRIEF, MAX_DOCUMENT_CONTEXT_TOTAL_CHARACTERS } from "@alchemy-video/persistence";

const MAX_DOCUMENT_CONTEXT_MARKDOWN_BYTES = 10 * 1024 * 1024;

export class BoundedDocumentContextReader {
  constructor(private readonly storage: StoragePort) {}

  async read(contexts: ControlPlanningDocumentContext[]): Promise<PlanningDocumentContext[]> {
    if (contexts.length === 0) return [];
    if (contexts.length > MAX_DOCUMENT_CONTEXTS_PER_BRIEF) throw new Error("Document context reference count exceeds the planning budget.");
    let remaining = MAX_DOCUMENT_CONTEXT_TOTAL_CHARACTERS;
    const results: PlanningDocumentContext[] = [];
    for (const [index, context] of contexts.entries()) {
      if (!Number.isInteger(context.sequence)
        || context.sequence !== index + 1
        || !Number.isInteger(context.maxContentCharacters)
        || context.maxContentCharacters < 1
        || context.maxContentCharacters > MAX_DOCUMENT_CONTEXT_CHARACTERS
        || !/^[a-f0-9]{64}$/.test(context.markdownSha256)) {
        throw new Error("Frozen Markdown context reference is invalid.");
      }
      const limit = Math.min(context.maxContentCharacters, remaining);
      if (limit < 1) throw new Error("Document context character budget is exhausted.");
      const content = await this.readMarkdown(context.markdownObjectKey, limit, context.markdownSha256);
      results.push({
        documentId: context.documentId,
        conversionId: context.conversionId,
        sourceAssetId: context.sourceAssetId,
        markdownAssetId: context.markdownAssetId,
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
      throw new Error("Frozen Markdown context is unavailable.");
    }
    const object = await this.storage.readObject({ objectKey });
    if (!object
      || object.mimeType !== "text/markdown"
      || (object.byteSize !== undefined && object.byteSize !== inspection.byteSize)) {
      throw new Error("Frozen Markdown context is unavailable.");
    }
    const reader = object.stream.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let content = "";
    let cancelled = false;
    try {
      while (content.length < limit) {
        const next = await reader.read();
        if (next.done) {
          content += decoder.decode();
          break;
        }
        content += decoder.decode(next.value, { stream: true });
      }
      if (content.length >= limit) {
        content = content.slice(0, limit);
        await reader.cancel();
        cancelled = true;
      }
    } finally {
      if (!cancelled) reader.releaseLock();
    }
    const normalized = content.trim();
    if (!normalized) throw new Error("Frozen Markdown context is empty.");
    return normalized;
  }
}
