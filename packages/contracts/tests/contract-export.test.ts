import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  ApplicationErrorCodeSchema,
  ApiFailureEnvelopeSchema,
  AssetSchema,
  CreateCreativeBriefRevisionCommandSchema,
  CreateProductionRunCommandSchema,
  CreateShotCommandSchema,
  CreateUploadRequestCommandSchema,
  DocumentConversionSchema,
  InternalCreativePlanningQueueMessageSchema,
  InternalMediaRuntimeQueueMessageSchema,
  InternalProductionQueueMessageSchema,
  CreateTaskRunCommandSchema,
  HealthSuccessEnvelopeSchema,
  InternalEventEnvelopeSchema,
  InternalTaskRunQueueMessageSchema,
  PublicWorkspaceEventEnvelopeSchema,
  ProductionSegmentSchema,
  RetryProductionSegmentCommandSchema,
  VideoVersionSchema,
  projectPublicWorkspaceEvent,
  RequestIdSchema,
  TaskRunAttemptSchema,
  TaskRunDetailSchema,
  TASK_RUN_STATUSES,
  TASK_RUN_TERMINAL_STATUSES,
  MediaRuntimeCompositionInputSchema,
  MediaRuntimeOperationSchema,
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
  assert.equal(ApplicationErrorCodeSchema.parse("SHOT_POSITION_CONFLICT"), "SHOT_POSITION_CONFLICT");
  assert.equal(ApplicationErrorCodeSchema.parse("CREDIT_REJECTED"), "CREDIT_REJECTED");
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
    "credit_provider",
    "external_user_id",
    "balance_after",
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

test("video generation keeps prompt, references, and provider configuration inside the saved Shot", () => {
  assert.deepEqual(CreateTaskRunCommandSchema.parse({}), {});
  assert.throws(() => CreateTaskRunCommandSchema.parse({ prompt: "browser must not override the saved Shot" }));
  assert.throws(() => CreateTaskRunCommandSchema.parse({ reference_asset_ids: ["ast_01J4N8QZ8PCW2N2G6D2XJXJXJX"] }));
  assert.throws(() => CreateTaskRunCommandSchema.parse({ model: "provider-internal-model" }));
});

test("C04 upload and shot commands restrict public media inputs and reference bindings", () => {
  assert.doesNotThrow(() =>
    CreateShotCommandSchema.parse({
      position: 0,
      generation_settings: {
        video_settings: { duration_seconds: 8, resolution: "480p", ratio: "16:9" },
      },
      reference_bindings: [
        { asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX", role: "STYLE", position: 0 },
      ],
    }),
  );
  assert.doesNotThrow(() =>
    CreateUploadRequestCommandSchema.parse({
      kind: "DOCUMENT",
      filename: "company.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byte_size: 1024,
    }),
  );
  assert.throws(() =>
    CreateShotCommandSchema.parse({
      position: 0,
      generation_settings: {
        video_settings: { duration_seconds: 16, resolution: "720p", ratio: "16:9" },
      },
    }),
  );
  assert.throws(() =>
    CreateUploadRequestCommandSchema.parse({
      kind: "IMAGE",
      filename: "not-an-image.pdf",
      mime_type: "application/pdf",
      byte_size: 1024,
    }),
  );
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

test("C10 conversion DTOs expose only safe traceability fields", () => {
  const conversion = DocumentConversionSchema.parse({
    id: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    document_id: "doc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    source_asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    status: "SUCCEEDED",
    retryable: false,
    markdown_asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJJ",
    warnings: [],
    attempt_count: 1,
    created_at: "2026-08-16T00:00:00.000Z",
    updated_at: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(conversion, "object_key"), false);
  assert.equal(Object.hasOwn(conversion, "runtime_url"), false);
});

test("C11 creative planning commands and public DTOs preserve user intent without provider fields", () => {
  const brief = CreateCreativeBriefRevisionCommandSchema.parse({
    source_text: "雨夜的旧车站，两位多年未见的朋友重新相遇。",
    target_duration_seconds: 30,
    target_resolution: "480p",
    style_preferences: "电影感，克制而温暖",
    source_asset_ids: ["ast_01J4N8QZ8PCW2N2G6D2XJXJXJX"],
  });
  assert.equal(brief.target_duration_seconds, 30);
  assert.equal(brief.target_resolution, "480p");
  assert.equal(CreateCreativeBriefRevisionCommandSchema.parse({
    source_text: "使用默认清晰度的短故事。",
    target_duration_seconds: 15,
  }).target_resolution, "720p");
  assert.throws(() => CreateCreativeBriefRevisionCommandSchema.parse({ ...brief, target_resolution: "1080p" }));
  assert.throws(() => CreateCreativeBriefRevisionCommandSchema.parse({ ...brief, provider: "internal" }));
  assert.throws(() => CreateProductionRunCommandSchema.parse({ storyboard_revision_id: "sbr_01J4N8QZ8PCW2N2G6D2XJXJXJX", prompt: "not public" }));
});

test("C11 planning queue messages carry only persisted revision identities", () => {
  const message = {
    contract_version: "1.0" as const,
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    creative_brief_revision_id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  };
  assert.deepEqual(InternalCreativePlanningQueueMessageSchema.parse(message), message);
  assert.throws(() => InternalCreativePlanningQueueMessageSchema.parse({ ...message, source_text: "must stay in persistence" }));
});

test("C12 production queue messages carry only the durable scheduling identities", () => {
  const confirmed = {
    contract_version: "1.0" as const,
    event_type: "production_run.confirmed" as const,
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    production_run_id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  };
  assert.deepEqual(InternalProductionQueueMessageSchema.parse(confirmed), confirmed);
  assert.throws(() => InternalProductionQueueMessageSchema.parse({ ...confirmed, prompt: "must stay in persistence" }));
  assert.throws(() => InternalProductionQueueMessageSchema.parse({
    ...confirmed,
    event_type: "task_run.succeeded",
    task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  }));
});

test("C12 Media Runtime accepts only fixed local tools and durable scheduling identities", () => {
  const operation = MediaRuntimeOperationSchema.parse({
    operation_id: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    tool: "EXTRACT_HANDOFF_FRAME",
    expected_sha256: "a".repeat(64),
  });
  assert.equal(operation.tool, "EXTRACT_HANDOFF_FRAME");
  assert.throws(() => MediaRuntimeOperationSchema.parse({ ...operation, tool: "shell" }));
  assert.throws(() => MediaRuntimeOperationSchema.parse({ ...operation, object_key: "must-not-cross-runtime-boundary" }));
  assert.deepEqual(MediaRuntimeCompositionInputSchema.parse({
    operation_id: "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    tool: "COMPOSE_VIDEO",
    segment_count: 2,
  }).segment_count, 2);

  const qcMessage = {
    contract_version: "1.0" as const,
    event_type: "production_segment.qc_requested" as const,
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    production_run_id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    production_segment_id: "psg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  };
  assert.deepEqual(InternalMediaRuntimeQueueMessageSchema.parse(qcMessage), qcMessage);
  assert.throws(() => InternalMediaRuntimeQueueMessageSchema.parse({ ...qcMessage, prompt: "must stay in persistence" }));
});

test("C11 planning failure is publicly actionable without exposing the story source", () => {
  const failed = InternalEventEnvelopeSchema.parse({
    contract_version: "1.0",
    message_id: "msg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJZ",
    event_type: "creative_brief.planning_failed",
    occurred_at: "2026-08-16T00:00:00.000Z",
    trace_id: "trc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    idempotency_key: "internal:evt_01J4N8QZ8PCW2N2G6D2XJXJXJZ",
    producer: "creative-planning-worker",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    aggregate: { type: "creative_brief_revision", id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
    data: { creative_brief_revision_id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX", error_code: "PLANNING_FAILED" },
    version: 1,
  });
  const projected = projectPublicWorkspaceEvent(failed);
  assert.deepEqual(projected?.data, {
    creative_brief_revision_id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    status: "FAILED",
    error_code: "PLANNING_FAILED",
  });
  assert.equal(JSON.stringify(projected).includes("source_text"), false);
});

test("C12 production progress remains actionable without exposing task or storage internals", () => {
  const segment = ProductionSegmentSchema.parse({
    id: "psg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    production_run_id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    sequence: 2,
    title: "雨夜重逢",
    status: "WAITING",
    retryable: false,
    safe_summary: "等待上一段确认。",
    created_at: "2026-08-16T00:00:00.000Z",
    updated_at: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(segment, "task_run_id"), false);
  assert.throws(() => ProductionSegmentSchema.parse({ ...segment, task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" }));
  assert.deepEqual(RetryProductionSegmentCommandSchema.parse({}), {});
  assert.throws(() => RetryProductionSegmentCommandSchema.parse({ provider: "not-public" }));

  const version = VideoVersionSchema.parse({
    id: "vvr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    production_run_id: "prd_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    storyboard_revision_id: "sbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    asset_id: "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    status: "SUCCEEDED",
    duration_ms: 3_000,
    qc_report: {
      id: "qcr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      subject_type: "VIDEO_VERSION",
      subject_id: "vvr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      kind: "COMPOSITION",
      status: "PASS",
      safe_summary: "成片技术检查通过。",
      created_at: "2026-08-16T00:00:00.000Z",
    },
    created_at: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(version).includes("object_key"), false);
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

test("the internal TaskRun queue message is versioned and carries the frozen execution snapshot", () => {
  const message = {
    contract_version: "1.0" as const,
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    workspace_id: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    attempt_no: 1,
    correlation_id: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    input_snapshot: { model: "mock-video-v1", prompt: "frozen" },
  };
  assert.deepEqual(InternalTaskRunQueueMessageSchema.parse(message), message);
  assert.throws(() => InternalTaskRunQueueMessageSchema.parse({ ...message, workspace_id: "ws_tampered", extra: true }));
  assert.throws(() => InternalTaskRunQueueMessageSchema.parse({ ...message, input_snapshot: undefined }));
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

test("the public SSE projector removes internal payloads and excludes internal-only events", () => {
  const queued = InternalEventEnvelopeSchema.parse({
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
    project_id: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    aggregate: { type: "task_run", id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX" },
    version: 1,
    data: {
      task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      kind: "VIDEO_GENERATION",
      input_snapshot: {
        model: "provider-internal-model",
        prompt: "Internal prompt must not reach SSE.",
        object_key: "internal/object/key",
      },
    },
  });
  const publicEvent = projectPublicWorkspaceEvent(queued);
  assert.ok(publicEvent);
  const serialized = JSON.stringify(publicEvent);
  assert.equal(publicEvent?.event_id, queued.event_id);
  assert.equal(publicEvent?.event_type, "task_run.queued");
  for (const forbidden of ["input_snapshot", "prompt", "model", "object_key", "trace_id", "correlation_id", "idempotency_key", "producer"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not reach the browser projection`);
  }

  const providerOnly = InternalEventEnvelopeSchema.parse({
    ...queued,
    event_id: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJY",
    event_type: "provider_attempt.submitted",
    data: {
      task_run_id: "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      provider_attempt_id: "att_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      provider_request_id: "provider_request_internal",
      provider: "seedance",
      model: "seedance-v1",
    },
  });
  assert.equal(projectPublicWorkspaceEvent(providerOnly), undefined);
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
  assert.ok(asyncApiSchemas.schemas.InternalTaskRunQueueMessage);
  assert.equal(openApiSchemas.schemas.InternalTaskRunQueueMessage, undefined);
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
    "credit_provider",
    "external_user_id",
    "balance_after",
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

test("AsyncAPI exports the versioned TaskRun queue message without exposing it publicly", () => {
  const documents = createContractDocuments();
  const asyncApi = documents.asyncApi as { components: { schemas: Record<string, unknown> } };
  const publicDocuments = `${JSON.stringify(documents.openApi)}${JSON.stringify(documents.jsonSchema)}`;

  for (const field of ["attempt_no", "correlation_id", "input_snapshot"]) {
    assert.match(JSON.stringify(asyncApi.components.schemas.InternalTaskRunQueueMessage), new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(publicDocuments, /InternalTaskRunQueueMessage/);
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
    "/api/v1/creative-brief-revisions/{creative_brief_revision_id}/plan",
    "/api/v1/document-conversions/{conversion_id}",
    "/api/v1/document-conversions/{conversion_id}/retry",
    "/api/v1/events",
    "/api/v1/health",
    "/api/v1/me",
    "/api/v1/production-runs/{production_run_id}/segments/{sequence}/retry",
    "/api/v1/projects",
    "/api/v1/projects/{project_id}",
    "/api/v1/projects/{project_id}/assets/upload-requests",
    "/api/v1/projects/{project_id}/creative-brief-revisions",
    "/api/v1/projects/{project_id}/documents",
    "/api/v1/projects/{project_id}/documents/{source_asset_id}/conversions",
    "/api/v1/projects/{project_id}/production-runs",
    "/api/v1/projects/{project_id}/shots",
    "/api/v1/projects/{project_id}/storyboard-revisions",
    "/api/v1/projects/{project_id}/video-versions",
    "/api/v1/shots/{shot_id}",
    "/api/v1/shots/{shot_id}/generations",
    "/api/v1/storyboard-revisions/{storyboard_revision_id}/approve",
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
