import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import { InMemoryDocumentConversionStore } from "@alchemy-video/persistence";
import { InMemoryStoragePort, createDocumentMarkdownObjectKey } from "@alchemy-video/storage-client";
import type { ControlAsset } from "../../../packages/persistence/src/asset-workspace-repository.js";

import { DocumentConversionExecutor, type DocumentRuntimePort } from "../src/execution-service.js";
import { DocumentRuntimeClientError } from "../src/runtime-client.js";
import { HttpDocumentRuntimeClient } from "../src/runtime-client.js";

const event = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDirectory = join(projectRoot, "services", "document-runtime");
const runtimePython = join(projectRoot, ".codex-longrun", "c10-document-runtime-venv", "Scripts", "python.exe");

const waitForRuntime = async (endpoint: string, process: ChildProcess) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`C10 document runtime exited during startup with code ${process.exitCode}.`);
    try {
      const response = await fetch(`${endpoint}/internal/v1/document-conversions`);
      if (response.status === 405) return;
    } catch {
      // The loopback server has not begun accepting requests yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("C10 document runtime did not become ready on loopback.");
};

const stopRuntime = async (process: ChildProcess) => {
  if (process.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
  process.kill();
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("C10 document runtime did not stop.")), 5_000))]);
};

const prepareConversion = async (input: { sourceFilename?: string } = {}) => {
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const sourceAssetId = createPrefixedId("ast");
  const conversionId = createPrefixedId("dcv");
  const sourceBytes = new TextEncoder().encode("# Local company brief\n\nA bounded source document.");
  const sourceObjectKey = `${workspaceId}/${projectId}/${sourceAssetId}/source.md`;
  const storage = new InMemoryStoragePort();
  const source: ControlAsset = {
    id: sourceAssetId,
    workspaceId,
    projectId,
    kind: "DOCUMENT",
    origin: "USER_UPLOAD",
    status: "READY",
    objectKey: sourceObjectKey,
    mimeType: "text/markdown",
    byteSize: sourceBytes.byteLength,
    sha256: sha256(sourceBytes),
    width: null,
    height: null,
    durationMs: null,
    metadata: { filename: input.sourceFilename ?? "brief.md" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storage.putObject({ objectKey: sourceObjectKey, mimeType: "text/markdown", bytes: sourceBytes });

  const store = new InMemoryDocumentConversionStore({
    async findAsset(candidateWorkspaceId, candidateAssetId) {
      return candidateWorkspaceId === workspaceId && candidateAssetId === sourceAssetId ? source : undefined;
    },
  });
  const created = await store.createDocumentConversion({
    scope: `c10-executor:${conversionId}:conversion`,
    idempotencyKey: "conversion",
    requestHash: fingerprintRequest({}),
    workspaceId,
    projectId,
    sourceAssetId,
    documentId: createPrefixedId("doc"),
    conversionId,
    event: event(),
  });
  assert.equal(created.kind, "NEW");

  return { workspaceId, projectId, conversionId, storage, store };
};

test("Document executor validates its source, persists one immutable Markdown object, and skips a completed retry", async () => {
  const fixture = await prepareConversion();
  let conversions = 0;
  const runtime: DocumentRuntimePort = {
    async convert(input) {
      conversions += 1;
      assert.equal(input.conversionId, fixture.conversionId);
      assert.equal(input.sourceMimeType, "text/markdown");
      return { markdown: "# Converted brief\n\nReady for review.", converter: "markitdown", converterVersion: "0.1.7", warnings: [] };
    },
  };
  const executor = new DocumentConversionExecutor(fixture.store, fixture.storage, runtime);

  const completed = await executor.execute({ workspaceId: fixture.workspaceId, conversionId: fixture.conversionId });
  const assetId = `ast_${fixture.conversionId.slice("dcv_".length)}`;
  const objectKey = createDocumentMarkdownObjectKey({ workspaceId: fixture.workspaceId, projectId: fixture.projectId, assetId });
  assert.equal(completed?.status, "SUCCEEDED");
  assert.equal(completed?.markdownAssetId, assetId);
  assert.equal(conversions, 1);
  assert.deepEqual(await fixture.storage.inspectObject({ objectKey }), {
    mimeType: "text/markdown",
    byteSize: new TextEncoder().encode("# Converted brief\n\nReady for review.").byteLength,
    sha256: sha256(new TextEncoder().encode("# Converted brief\n\nReady for review.")),
  });

  const replay = await executor.execute({ workspaceId: fixture.workspaceId, conversionId: fixture.conversionId });
  assert.equal(replay?.status, "SUCCEEDED");
  assert.equal(conversions, 1);
});

test("Document executor maps an unsupported Runtime rejection to a retryable public conversion state without a Markdown result", async () => {
  const fixture = await prepareConversion();
  const executor = new DocumentConversionExecutor(fixture.store, fixture.storage, {
    async convert() {
      throw new DocumentRuntimeClientError("DOCUMENT_UNSUPPORTED", false);
    },
  });

  const failed = await executor.execute({ workspaceId: fixture.workspaceId, conversionId: fixture.conversionId });
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.retryable, false);
  assert.equal(failed?.markdownAssetId, null);
  assert.equal(failed?.attemptCount, 1);
  assert.deepEqual(await fixture.store.retryDocumentConversion({
    scope: `c10-executor:${fixture.conversionId}:unsupported-retry`,
    idempotencyKey: "unsupported-retry",
    requestHash: fingerprintRequest({}),
    workspaceId: fixture.workspaceId,
    conversionId: fixture.conversionId,
    event: event(),
  }), { kind: "STATE_INVALID" });
});

test("Document executor completes a real loopback Runtime conversion and persists the immutable Markdown asset", { skip: !existsSync(runtimePython) }, async () => {
  const fixture = await prepareConversion({ sourceFilename: "镇江茅山项目资料.md" });
  const port = 42000 + Math.floor(Math.random() * 1000);
  const endpoint = `http://127.0.0.1:${port}`;
  const runtime = spawn(runtimePython, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"], {
    cwd: runtimeDirectory,
    env: { ...process.env, DOCUMENT_RUNTIME_TOKEN: "c10-local-fixture-token" },
    stdio: "ignore",
  });

  try {
    await waitForRuntime(endpoint, runtime);
    const executor = new DocumentConversionExecutor(
      fixture.store,
      fixture.storage,
      new HttpDocumentRuntimeClient({ runtimeUrl: endpoint, token: "c10-local-fixture-token" }),
    );

    const completed = await executor.execute({ workspaceId: fixture.workspaceId, conversionId: fixture.conversionId });
    const assetId = `ast_${fixture.conversionId.slice("dcv_".length)}`;
    const objectKey = createDocumentMarkdownObjectKey({ workspaceId: fixture.workspaceId, projectId: fixture.projectId, assetId });
    const stored = await fixture.storage.readObject({ objectKey });
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(completed?.markdownAssetId, assetId);
    assert.ok(stored);
    const reader = stored.stream.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();
    assert.equal(done, false);
    assert.match(new TextDecoder().decode(value), /Local company brief/);
    assert.deepEqual(await fixture.storage.inspectObject({ objectKey }), {
      mimeType: "text/markdown",
      byteSize: value!.byteLength,
      sha256: sha256(value!),
    });
  } finally {
    await stopRuntime(runtime);
  }
});
