import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  ApplicationErrorCodeSchema,
  ApiFailureEnvelopeSchema,
  AssetSchema,
  CreateTaskRunCommandSchema,
  HealthSuccessEnvelopeSchema,
  InternalEventEnvelopeSchema,
  PublicWorkspaceEventEnvelopeSchema,
  RequestIdSchema,
  TaskRunAttemptSchema,
  TaskRunDetailSchema,
  TASK_RUN_STATUSES,
  TASK_RUN_TERMINAL_STATUSES,
  createContractDocuments,
} from "../src/index.js";
import { CONTRACT_ARTIFACT_NAMES, writeContractDocuments } from "../src/write-contract-documents.js";

test("failure envelopes always include details", () => {
  const result = ApiFailureEnvelopeSchema.parse({
    error: {
      code: "IDEMPOTENCY_CONFLICT",
      message: "The idempotency key was already used for another command.",
      retryable: false,
    },
    request_id: "req_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  });

  assert.deepEqual(result.error.details, {});
});

test("the exported application error code set includes internal failures", () => {
  assert.equal(ApplicationErrorCodeSchema.parse("INTERNAL_ERROR"), "INTERNAL_ERROR");
});

test("the C03 health response distinguishes the API process and database dependency", () => {
  assert.equal(RequestIdSchema.parse("req_01J4N8QZ8PCW2N2G6D2XJXJXJX"), "req_01J4N8QZ8PCW2N2G6D2XJXJXJX");
  assert.throws(() => RequestIdSchema.parse("local"));
  assert.deepEqual(
    HealthSuccessEnvelopeSchema.parse({
      data: {
        service: "control-api",
        status: "ok",
        build_version: "local",
        dependencies: { database: "not_configured" },
      },
      request_id: "req_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    }),
    {
      data: {
        service: "control-api",
        status: "ok",
        build_version: "local",
        dependencies: { database: "not_configured" },
      },
      request_id: "req_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    },
  );
});

test("public DTO exports omit internal storage and Provider transport fields", () => {
  const documents = createContractDocuments();
  const publicDocuments = [documents.openApi, documents.jsonSchema];
  const forbiddenFields = [
    "provider_request_id",
    "provider",
    "request_payload",
    "response_payload",
    "object_key",
    "X-Veyra-Internal-Token",
    "veyra",
  ];

  for (const document of publicDocuments) {
    const serialized = JSON.stringify(document).toLowerCase();
    for (const field of forbiddenFields) {
      assert.equal(
        new RegExp(`"${field.toLowerCase()}"\\s*:`).test(serialized),
        false,
        `${field} must stay internal.`,
      );
    }
    assert.equal(/[?&](?:x-amz-|signature=|token=|expires=)/i.test(serialized), false);
  }
  assert.equal(AssetSchema.shape.object_key, undefined);
});

test("TaskRun detail exposes only Provider-safe execution attempts", () => {
  const hiddenAttemptFields = [
    "provider",
    "model",
    "provider_request_id",
    "request_payload",
    "response_payload",
  ];

  assert.deepEqual(Object.keys(TaskRunDetailSchema.shape).sort(), ["attempts", "result_asset", "task_run"]);
  for (const field of hiddenAttemptFields) {
    assert.equal(TaskRunAttemptSchema.shape[field as keyof typeof TaskRunAttemptSchema.shape], undefined);
  }
});

test("video generation retains the provider-facing field names", () => {
  const command = CreateTaskRunCommandSchema.parse({
    model: "mock-video-v1",
    prompt: "A close-up product shot with slow camera movement.",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
    reference_asset_ids: ["ast_01J4N8QZ8PCW2N2G6D2XJXJXJX"],
  });

  assert.equal(command.reference_asset_ids[0], "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX");
});

test("TaskRun contracts expose the ADR-0014 status and terminal sets", () => {
  assert.deepEqual(TASK_RUN_STATUSES, [
    "CREATED",
    "QUEUED",
    "RUNNING",
    "PROVIDER_PROCESSING",
    "DOWNLOADING",
    "BILLING_PENDING",
    "SUCCEEDED",
    "BILLING_FAILED",
    "FAILED",
    "RETRY_SCHEDULED",
    "ABANDONED",
  ]);
  assert.deepEqual(TASK_RUN_TERMINAL_STATUSES, ["SUCCEEDED", "FAILED", "ABANDONED"]);
});

test("internal events reject a mismatched event payload", () => {
  assert.throws(() =>
    InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      message_id: "msg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      event_type: "task_run.queued",
      occurred_at: "2026-08-13T00:00:00.000Z",
      trace_id: "trc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      idempotency_key: "idem_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      producer: "control-api",
      workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
      version: 1,
      data: { task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
    }),
  );
});

test("public SSE uses a strict safe projection while internal events retain Provider diagnostics", () => {
  const publicProgressEvent = {
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    occurred_at: "2026-08-13T00:00:00.000Z",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
    version: 1,
    event_type: "task_run.progressed",
    data: {
      task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      status: "PROCESSING",
      progress: 40,
    },
  };

  assert.deepEqual(PublicWorkspaceEventEnvelopeSchema.parse(publicProgressEvent), publicProgressEvent);
  assert.throws(() =>
    PublicWorkspaceEventEnvelopeSchema.parse({
      ...publicProgressEvent,
      data: { ...publicProgressEvent.data, status: "PROVIDER_PROCESSING" },
    }),
  );
  assert.throws(() =>
    PublicWorkspaceEventEnvelopeSchema.parse({
      ...publicProgressEvent,
      provider_request_id: "provider_123",
    }),
  );
  assert.throws(() =>
    PublicWorkspaceEventEnvelopeSchema.parse({
      ...publicProgressEvent,
      data: { ...publicProgressEvent.data, provider: "seedance" },
    }),
  );

  const internalProviderEvent = InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: "msg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJY",
    occurred_at: "2026-08-13T00:00:00.000Z",
    trace_id: "trc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    idempotency_key: "idem_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    producer: "provider-worker",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
    version: 1,
    event_type: "provider_attempt.submitted",
    data: {
      task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      provider_attempt_id: "att_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      provider_request_id: "provider_123",
      provider: "seedance",
      model: "seedance-v1",
    },
  });

  assert.equal(internalProviderEvent.data.provider_request_id, "provider_123");

  const internalProgressEvent = InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: "msg_01J4N8QZ8PCW2N2G6D2XJXJXJY",
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJZ",
    occurred_at: "2026-08-13T00:00:00.000Z",
    trace_id: "trc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    idempotency_key: "idem_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    producer: "provider-worker",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
    version: 1,
    event_type: "task_run.progressed",
    data: {
      task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      status: "PROVIDER_PROCESSING",
      progress: 40,
      message: "Provider is processing the video.",
    },
  });

  assert.equal(internalProgressEvent.data.status, "PROVIDER_PROCESSING");
});

test("OpenAPI exports only public components and AsyncAPI exports the internal envelope", () => {
  const documents = createContractDocuments();
  const openApiSchemas = documents.openApi.components as { schemas: Record<string, unknown> };
  const asyncApiSchemas = documents.asyncApi.components as { schemas: Record<string, unknown> };
  const jsonSchemaDefinitions = documents.jsonSchema.definitions as Record<string, unknown>;

  assert.deepEqual(Object.keys(openApiSchemas.schemas).sort(), Object.keys(jsonSchemaDefinitions).sort());
  assert.ok(openApiSchemas.schemas.PublicWorkspaceEventEnvelope);
  assert.equal(openApiSchemas.schemas.InternalEventEnvelope, undefined);
  assert.ok(asyncApiSchemas.schemas.InternalEventEnvelope);
  assert.equal(asyncApiSchemas.schemas.PublicWorkspaceEventEnvelope, undefined);
  assert.ok(openApiSchemas.schemas.ProjectSuccess);
  assert.ok(openApiSchemas.schemas.TaskRunSuccess);
});

test("every public OpenAPI path is free of internal event references and fields", () => {
  const openApi = createContractDocuments().openApi as {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };
  const forbiddenFields = [
    "provider_request_id",
    "provider",
    "request_payload",
    "response_payload",
    "object_key",
    "veyra",
  ];

  assert.deepEqual(
    (openApi.paths["/api/v1/events"] as { get: { responses: { 200: { content: { "text/event-stream": { schema: { $ref: string } } } } } } }).get.responses[200].content[
      "text/event-stream"
    ].schema,
    { $ref: "#/components/schemas/PublicWorkspaceEventEnvelope" },
  );
  const publicSurface = JSON.stringify({ paths: openApi.paths, components: openApi.components });
  for (const field of forbiddenFields) {
    assert.equal(
      new RegExp(`"${field}"\\s*:`).test(publicSurface),
      false,
      `${field} must not be reachable from an OpenAPI path.`,
    );
  }
  assert.doesNotMatch(publicSurface, /InternalEventEnvelope/);
});

test("AsyncAPI retains internal Provider request IDs for Worker and outbox consumers", () => {
  const asyncApi = createContractDocuments().asyncApi as {
    components: { schemas: Record<string, unknown> };
  };

  assert.match(JSON.stringify(asyncApi.components.schemas.InternalEventEnvelope), /provider_request_id/);
});

test("the standalone JSON Schema export does not use OpenAPI nullable extensions", () => {
  const document = createContractDocuments().jsonSchema;

  assert.doesNotMatch(JSON.stringify(document), /"nullable"\s*:/);
});

test("OpenAPI declares the C03 control-plane surface before later route implementation begins", () => {
  const openApi = createContractDocuments().openApi as { paths: Record<string, unknown> };

  assert.deepEqual(Object.keys(openApi.paths).sort(), [
    "/api/v1/assets/{asset_id}/confirm-upload",
    "/api/v1/assets/{asset_id}/download-url",
    "/api/v1/events",
    "/api/v1/health",
    "/api/v1/me",
    "/api/v1/projects",
    "/api/v1/projects/{project_id}",
    "/api/v1/projects/{project_id}/assets/upload-requests",
    "/api/v1/projects/{project_id}/shots",
    "/api/v1/shots/{shot_id}",
    "/api/v1/shots/{shot_id}/generations",
    "/api/v1/task-runs/{task_run_id}",
    "/api/v1/task-runs/{task_run_id}/retry",
    "/api/v1/workspaces",
  ]);
});

test("tracked contract exports have no drift from Zod sources", async () => {
  const documents = createContractDocuments();
  const contractDirectory = resolve(import.meta.dirname, "..", "..", "..", "contracts");
  const [openApi, asyncApi, jsonSchema] = await Promise.all([
    readFile(resolve(contractDirectory, "openapi.json"), "utf8"),
    readFile(resolve(contractDirectory, "asyncapi.json"), "utf8"),
    readFile(resolve(contractDirectory, "platform-contracts.schema.json"), "utf8"),
  ]);

  assert.deepEqual(JSON.parse(openApi), documents.openApi);
  assert.deepEqual(JSON.parse(asyncApi), documents.asyncApi);
  assert.deepEqual(JSON.parse(jsonSchema), documents.jsonSchema);
});

test("contract generation atomically replaces artifacts during concurrent reads", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "alchemy-video-contracts-"));
  const jsonArtifacts = ["openapi.json", "asyncapi.json", "platform-contracts.schema.json"] as const;

  const readJsonArtifacts = async () => {
    await Promise.all(
      jsonArtifacts.map(async (name) => {
        const contents = await readFile(resolve(outputDirectory, name), "utf8");
        assert.doesNotThrow(() => JSON.parse(contents), `${name} must never be partially written`);
      }),
    );
  };

  try {
    await writeContractDocuments(outputDirectory);
    await Promise.all([
      ...Array.from({ length: 12 }, () => writeContractDocuments(outputDirectory)),
      ...Array.from({ length: 120 }, () => readJsonArtifacts()),
    ]);

    await readJsonArtifacts();
    assert.deepEqual((await readdir(outputDirectory)).sort(), [...CONTRACT_ARTIFACT_NAMES].sort());
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
