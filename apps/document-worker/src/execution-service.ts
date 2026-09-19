import { createHash } from "node:crypto";

import { createPrefixedId } from "@alchemy-video/domain";
import type { DocumentConversionSource, DocumentConversionStore } from "@alchemy-video/persistence";
import { StorageObjectAlreadyExistsError, StorageUnavailableError, createDocumentMarkdownObjectKey, type StoragePort } from "@alchemy-video/storage-client";

import { DocumentRuntimeClientError, type RuntimeConversionResult } from "./runtime-client.js";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;

export interface DocumentRuntimePort {
  convert(input: {
    conversionId: string;
    sourceFilename: string;
    sourceMimeType: string;
    sourceSha256: string;
    bytes: Uint8Array;
  }): Promise<RuntimeConversionResult>;
}

type DocumentExecutionFailure = {
  code: "DOCUMENT_UNSUPPORTED" | "DOCUMENT_CONVERSION_FAILED" | "DOCUMENT_RUNTIME_UNAVAILABLE" | "DOCUMENT_OUTPUT_INVALID" | "STORAGE_UNAVAILABLE";
  retryable: boolean;
};

class DocumentExecutionError extends Error {
  constructor(readonly failure: DocumentExecutionFailure) {
    super(failure.code);
    this.name = "DocumentExecutionError";
  }
}

const event = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const documentAssetId = (conversionId: string) => `ast_${conversionId.slice("dcv_".length)}`;

const readBoundedStream = async (stream: ReadableStream<Uint8Array>, maximumBytes: number) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new DocumentExecutionError({ code: "DOCUMENT_UNSUPPORTED", retryable: false });
      chunks.push(value);
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
  return bytes;
};

const sourceFrom = (value: Awaited<ReturnType<DocumentConversionStore["findDocumentConversion"]>>): DocumentConversionSource | undefined => {
  if (!value || (value.status !== "QUEUED" && value.status !== "RUNNING")) return undefined;
  return value;
};

const failureFor = (error: unknown): DocumentExecutionFailure => {
  if (error instanceof DocumentExecutionError) return error.failure;
  if (error instanceof DocumentRuntimeClientError) return { code: error.code, retryable: error.retryable };
  if (error instanceof StorageUnavailableError) return { code: "STORAGE_UNAVAILABLE", retryable: true };
  return { code: "DOCUMENT_CONVERSION_FAILED", retryable: true };
};

export class DocumentConversionExecutor {
  constructor(
    private readonly store: Pick<DocumentConversionStore, "findDocumentConversion" | "listRecoverableDocumentConversions" | "startDocumentConversion" | "failDocumentConversion" | "completeDocumentConversion">,
    private readonly storage: StoragePort,
    private readonly runtime: DocumentRuntimePort,
  ) {}

  async execute(input: { workspaceId: string; conversionId: string }) {
    const current = await this.store.findDocumentConversion(input.workspaceId, input.conversionId);
    if (!current || current.status === "SUCCEEDED" || current.status === "FAILED") return current;

    let source = sourceFrom(current);
    if (current.status === "QUEUED") {
      source = await this.store.startDocumentConversion({ workspaceId: input.workspaceId, conversionId: input.conversionId, event: event() });
    }
    if (!source || source.status !== "RUNNING" || source.attemptCount < 1) return this.store.findDocumentConversion(input.workspaceId, input.conversionId);

    try {
      const bytes = await this.readSource(source);
      const converted = await this.runtime.convert({
        conversionId: source.id,
        sourceFilename: source.sourceFilename,
        sourceMimeType: source.sourceMimeType,
        sourceSha256: source.sourceSha256,
        bytes,
      });
      const markdown = this.validateMarkdown(converted);
      const assetId = documentAssetId(source.id);
      const objectKey = createDocumentMarkdownObjectKey({ workspaceId: source.workspaceId, projectId: source.projectId, assetId });
      await this.writeMarkdown({ objectKey, bytes: markdown.bytes, sha256: markdown.sha256 });
      return this.store.completeDocumentConversion({
        workspaceId: source.workspaceId,
        conversionId: source.id,
        attemptNo: source.attemptCount,
        markdownAssetId: assetId,
        markdownObjectKey: objectKey,
        markdownBytes: markdown.bytes.byteLength,
        markdownSha256: markdown.sha256,
        converter: converted.converter,
        converterVersion: converted.converterVersion,
        warnings: converted.warnings,
        event: event(),
      });
    } catch (error) {
      const failure = failureFor(error);
      return this.store.failDocumentConversion({
        workspaceId: source.workspaceId,
        conversionId: source.id,
        attemptNo: source.attemptCount,
        ...failure,
        event: event(),
      });
    }
  }

  async recover(input: { limit: number }) {
    const conversions = await this.store.listRecoverableDocumentConversions({ limit: input.limit });
    return Promise.all(conversions.map((conversion) => this.execute({ workspaceId: conversion.workspaceId, conversionId: conversion.id })));
  }

  private async readSource(source: DocumentConversionSource) {
    if (source.sourceByteSize < 1 || source.sourceByteSize > MAX_DOCUMENT_BYTES) {
      throw new DocumentExecutionError({ code: "DOCUMENT_UNSUPPORTED", retryable: false });
    }
    const object = await this.storage.readObject({ objectKey: source.sourceObjectKey });
    if (!object || object.mimeType !== source.sourceMimeType || (object.byteSize !== undefined && object.byteSize !== source.sourceByteSize)) {
      throw new DocumentExecutionError({ code: "DOCUMENT_UNSUPPORTED", retryable: false });
    }
    const bytes = await readBoundedStream(object.stream, source.sourceByteSize);
    if (bytes.byteLength !== source.sourceByteSize || createHash("sha256").update(bytes).digest("hex") !== source.sourceSha256) {
      throw new DocumentExecutionError({ code: "DOCUMENT_UNSUPPORTED", retryable: false });
    }
    return bytes;
  }

  private validateMarkdown(result: RuntimeConversionResult) {
    const markdown = result.markdown;
    const bytes = new TextEncoder().encode(markdown);
    if (!markdown.trim() || bytes.byteLength > MAX_MARKDOWN_BYTES) {
      throw new DocumentExecutionError({ code: "DOCUMENT_OUTPUT_INVALID", retryable: false });
    }
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  private async writeMarkdown(input: { objectKey: string; bytes: Uint8Array; sha256: string }) {
    try {
      await this.storage.putObject({ objectKey: input.objectKey, mimeType: "text/markdown", bytes: input.bytes, ifNoneMatch: "*" });
    } catch (error) {
      if (!(error instanceof StorageObjectAlreadyExistsError)) throw error;
      const existing = await this.storage.inspectObject({ objectKey: input.objectKey });
      if (!existing || existing.mimeType !== "text/markdown" || existing.byteSize !== input.bytes.byteLength || existing.sha256 !== input.sha256) {
        throw new DocumentExecutionError({ code: "DOCUMENT_OUTPUT_INVALID", retryable: false });
      }
    }
  }
}
