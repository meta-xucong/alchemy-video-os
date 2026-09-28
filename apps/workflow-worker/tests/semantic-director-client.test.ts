import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  SemanticDecisionVerificationError,
  createCanonicalSourceBundle,
} from "@alchemy-video/creative-planning/semantic-director";
import {
  SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
} from "@alchemy-video/contracts";

import {
  OpenAiCompatibleSemanticDirector,
  SemanticDirectorClientError,
  createSemanticDirectorRuntimeFromEnv,
  directorSystemPrompt,
  type SemanticDirectorDiagnostic,
} from "../src/semantic-director-client.js";
import {
  SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH,
} from "../src/semantic-director-certification.js";
import {
  semanticDirectorModelProfiles,
  type SemanticDirectorCertifiedModelProfile,
  type SemanticDirectorModelProfile,
} from "../src/semantic-director-model-profiles.js";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const certifiedProfile: SemanticDirectorCertifiedModelProfile = {
  profileId: "test-semantic-director-json-v1",
  provider: "test-openai-compatible",
  model: "test-director-json",
  status: "CERTIFIED",
  responseMode: "JSON_OBJECT",
  strictJson: true,
  contractVersion: SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
  timeoutMs: 1_000,
  maxInputUtf8Bytes: 1_000_000,
  maxOutputTokens: 8_192,
  fixtureId: "semantic-decision-v1-fixture",
  certificationSurfaceHash: SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH,
};

const schemaProfile: SemanticDirectorCertifiedModelProfile = {
  ...certifiedProfile,
  profileId: "test-semantic-director-json-schema-v1",
  model: "test-director-json-schema",
  responseMode: "JSON_SCHEMA",
};

const promptOnlyProfile: SemanticDirectorCertifiedModelProfile = {
  ...certifiedProfile,
  profileId: "test-semantic-director-prompt-only-v1",
  model: "test-director-prompt-only",
  responseMode: "PROMPT_ONLY",
};

const profiles: readonly SemanticDirectorModelProfile[] = [
  certifiedProfile,
  schemaProfile,
  promptOnlyProfile,
  {
    profileId: "unavailable-director-v1",
    provider: "test-openai-compatible",
    model: "unavailable-director",
    status: "UNAVAILABLE",
    reasonCode: "SEMANTIC_DECISION_V1_FIXTURE_FAILED",
  },
];
const sourceText = "Ava says: hello. Ava opens the station door.";
const dialogue = "hello";
const dialogueStart = sourceText.indexOf(dialogue);
const visualQuote = "Ava opens the station door.";
const visualStart = sourceText.indexOf(visualQuote);
const bundle = createCanonicalSourceBundle({
  sourceText,
  stylePreferences: "restrained realism",
  targetDurationSeconds: 5,
  references: [{
    asset_id: "ast_reference_001",
    asset_sha256: sha("image"),
    mime_type: "image/png",
    position: 0,
    provider_role: "SCENE",
  }],
  userDecisions: [{
    decisionId: "dec_style_preferences_001",
    field: "style_preferences",
    value: "restrained realism",
  }],
  providerCapability: {
    profile_id: "test-video-profile",
    min_duration_seconds: 1,
    max_duration_seconds: 15,
    max_prompt_utf8_bytes: 4096,
    max_reference_images: 7,
    audio_owner: "NATIVE_PROVIDER",
  },
});

const decision = {
  version: 1,
  source_hash: bundle.source_hash,
  target_duration_seconds: 5,
  execution_status: "READY",
  dialogues: [{
    dialogue_id: "dlg_hello_001",
    exact_text: dialogue,
    evidence: {
      evidence_id: "evd_dialogue_001",
      kind: "SOURCE_TEXT",
      source_hash: bundle.source_hash,
      span: { start: dialogueStart, end: dialogueStart + dialogue.length, quote: dialogue },
    },
  }],
  reference_usages: [{
    asset_id: "ast_reference_001",
    provider_role: "SCENE",
    usage: "Keep the visible station-door geometry.",
    evidence_refs: [{
      evidence_id: "evd_reference_001",
      kind: "REFERENCE_ASSET",
      asset_id: "ast_reference_001",
      asset_sha256: sha("image"),
    }],
  }],
  segments: [{
    segment_id: "seg_station_001",
    sequence: 1,
    duration_seconds: 5,
    visual_decision: visualQuote,
    evidence_refs: [
      {
        evidence_id: "evd_segment_001",
        kind: "SOURCE_TEXT",
        source_hash: bundle.source_hash,
        span: { start: visualStart, end: visualStart + visualQuote.length, quote: visualQuote },
      },
      {
        evidence_id: "evd_style_preferences_001",
        kind: "USER_DECISION",
        decision_id: "dec_style_preferences_001",
        field: "style_preferences",
        value_hash: bundle.user_decisions[0]!.value_hash,
      },
    ],
    dialogue_ids: ["dlg_hello_001"],
    reference_asset_ids: ["ast_reference_001"],
  }],
  unresolved_items: [],
};

const responseEnvelope = (
  content: unknown,
  input: Readonly<{ status?: number; contentType?: string; rawBody?: string }> = {},
) => new Response(
  input.rawBody ?? JSON.stringify({ choices: [{ message: { content } }] }),
  {
    status: input.status ?? 200,
    headers: { "content-type": input.contentType ?? "application/json" },
  },
);

const envFor = (
  profile: SemanticDirectorCertifiedModelProfile = certifiedProfile,
): NodeJS.ProcessEnv => ({
  SEMANTIC_PLANNER_ENABLED: "true",
  SEMANTIC_PLANNER_BASE_URL: "https://director.example.invalid/v1",
  SEMANTIC_PLANNER_API_KEY: "test-secret-key",
  SEMANTIC_PLANNER_MODEL: profile.model,
  SEMANTIC_PLANNER_PROFILE_ID: profile.profileId,
  SEMANTIC_PLANNER_TIMEOUT_MS: String(profile.timeoutMs),
  SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES: String(profile.maxInputUtf8Bytes),
  SEMANTIC_PLANNER_MAX_TOKENS: String(profile.maxOutputTokens),
});
test("certified JSON-object profile sends the exact bundle and machine-readable contract", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const diagnostics: SemanticDirectorDiagnostic[] = [];
  const runtime = createSemanticDirectorRuntimeFromEnv({
    env: envFor(),
    profiles,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return responseEnvelope(JSON.stringify(decision));
    },
  });

  const verified = await runtime.director.requireExecutable(bundle);
  assert.equal(verified.segments[0]?.visual_decision, visualQuote);
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.equal(request.model, certifiedProfile.model);
  assert.equal(request.max_tokens, certifiedProfile.maxOutputTokens);
  const messages = request.messages as Array<{ role: string; content: string }>;
  const userPayload = JSON.parse(messages[1]!.content) as Record<string, unknown>;
  assert.equal(userPayload.contract_version, SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION);
  assert.deepEqual(userPayload.canonical_source_bundle, bundle);
  assert.equal(typeof userPayload.required_output_json_schema, "object");
  assert.equal(diagnostics.at(-1)?.outcome, "RESPONSE_PARSED");
});
test("prompt-only certified profile omits unsupported response_format without weakening parsing", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "test-secret-key",
    profile: promptOnlyProfile,
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return responseEnvelope(JSON.stringify(decision));
    },
  });

  const raw = await client.decide(bundle);
  assert.deepEqual(raw, decision);
  assert.equal(requestBody?.response_format, undefined);
  const messages = requestBody?.messages as Array<{ content: string }>;
  const userPayload = JSON.parse(messages[1]!.content) as Record<string, unknown>;
  assert.equal(typeof userPayload.required_output_json_schema, "object");
});

test("real runtime requires explicit enablement, profile identity, and exact certified limits", () => {
  const missingProfile = envFor();
  delete missingProfile.SEMANTIC_PLANNER_PROFILE_ID;
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({ env: missingProfile, profiles }),
    (error) => error instanceof SemanticDirectorClientError && error.code === "CONFIGURATION_INVALID");

  const wrongLimit = envFor();
  wrongLimit.SEMANTIC_PLANNER_MAX_TOKENS = "4096";
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({ env: wrongLimit, profiles }),
    (error) => error instanceof SemanticDirectorClientError && error.code === "CONFIGURATION_INVALID");

  const wrongInputLimit = envFor();
  wrongInputLimit.SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES = "4096";
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({ env: wrongInputLimit, profiles }),
    (error) => error instanceof SemanticDirectorClientError && error.code === "CONFIGURATION_INVALID");
});

test("request body exceeding the certified input byte limit fails before network", async () => {
  let fetchCalls = 0;
  const diagnostics: SemanticDirectorDiagnostic[] = [];
  const tinyInputProfile: SemanticDirectorCertifiedModelProfile = {
    ...certifiedProfile,
    profileId: "test-semantic-director-tiny-input-v1",
    model: "test-director-tiny-input",
    maxInputUtf8Bytes: 128,
  };
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "test-secret-key",
    profile: tinyInputProfile,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    fetcher: async () => {
      fetchCalls += 1;
      return responseEnvelope(JSON.stringify(decision));
    },
  });

  await assert.rejects(() => client.decide(bundle),
    (error) => error instanceof SemanticDirectorClientError
      && error.code === "DIRECTOR_REQUEST_TOO_LARGE"
      && error.retryable === false);
  assert.equal(fetchCalls, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.stage, "REQUEST");
  assert.equal(diagnostics[0]?.error_class, "REQUEST_TOO_LARGE");
  assert.ok((diagnostics[0]?.request_bytes ?? 0) > tinyInputProfile.maxInputUtf8Bytes);
  assert.equal(JSON.stringify(diagnostics).includes(sourceText), false);
  assert.equal(JSON.stringify(diagnostics).includes("test-secret-key"), false);
});

test("unavailable or mismatched model profile fails before any network request", () => {
  let fetchCalls = 0;
  const unavailableEnv: NodeJS.ProcessEnv = {
    ...envFor(),
    SEMANTIC_PLANNER_MODEL: "unavailable-director",
    SEMANTIC_PLANNER_PROFILE_ID: "unavailable-director-v1",
  };
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({
    env: unavailableEnv,
    profiles,
    fetcher: async () => {
      fetchCalls += 1;
      return responseEnvelope(JSON.stringify(decision));
    },
  }), (error) => error instanceof SemanticDirectorClientError
    && error.code === "MODEL_PROFILE_UNAVAILABLE");

  const mismatchEnv = envFor();
  mismatchEnv.SEMANTIC_PLANNER_MODEL = "another-model";
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({ env: mismatchEnv, profiles }),
    (error) => error instanceof SemanticDirectorClientError
      && error.code === "MODEL_PROFILE_UNAVAILABLE");
  assert.equal(fetchCalls, 0);
});

test("duplicate or malformed certified profiles fail before any network request", () => {
  let fetchCalls = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return responseEnvelope(JSON.stringify(decision));
  };
  const duplicateProfiles: readonly SemanticDirectorModelProfile[] = [
    certifiedProfile,
    { ...certifiedProfile },
  ];
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({
    env: envFor(),
    profiles: duplicateProfiles,
    fetcher,
  }), (error) => error instanceof SemanticDirectorClientError
    && error.code === "MODEL_PROFILE_UNAVAILABLE"
    && error.diagnostic?.error_class === "PROFILE_ID_CONFLICT");

  const malformedProfile = {
    ...certifiedProfile,
    timeoutMs: 0,
  } as SemanticDirectorModelProfile;
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({
    env: envFor(),
    profiles: [malformedProfile],
    fetcher,
  }), (error) => error instanceof SemanticDirectorClientError
    && error.code === "MODEL_PROFILE_UNAVAILABLE"
    && error.diagnostic?.error_class === "PROFILE_INVALID");

  const staleSurfaceProfile: SemanticDirectorCertifiedModelProfile = {
    ...certifiedProfile,
    certificationSurfaceHash: "0".repeat(64),
  };
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({
    env: envFor(staleSurfaceProfile),
    profiles: [staleSurfaceProfile],
    fetcher,
  }), (error) => error instanceof SemanticDirectorClientError
    && error.code === "MODEL_PROFILE_UNAVAILABLE"
    && error.diagnostic?.error_class === "CERTIFICATION_SURFACE_MISMATCH");
  assert.equal(fetchCalls, 0);
});

test("reference-vision credentials are never accepted as semantic-planner configuration", () => {
  assert.throws(() => createSemanticDirectorRuntimeFromEnv({
    env: {
      SEMANTIC_PLANNER_ENABLED: "true",
      REFERENCE_VISION_BASE_URL: "https://vision.example.invalid/v1",
      REFERENCE_VISION_API_KEY: "vision-only-key",
      REFERENCE_VISION_MODEL: "vision-only-model",
    },
    profiles,
  }), (error) => error instanceof SemanticDirectorClientError
    && error.code === "CONFIGURATION_INVALID");
});
test("Markdown, array roots, malformed JSON, and empty content stay fail-closed", async (context) => {
  const cases: Array<Readonly<{
    name: string;
    content: unknown;
    code: string;
    errorClass: string;
  }>> = [
    { name: "markdown", content: "```json\n{}\n```", code: "DIRECTOR_CONTENT_FORMAT_INVALID", errorClass: "MARKDOWN_FENCE" },
    { name: "array root", content: JSON.stringify([decision]), code: "DIRECTOR_CONTENT_FORMAT_INVALID", errorClass: "ARRAY_ROOT" },
    { name: "malformed", content: "{", code: "DIRECTOR_CONTENT_FORMAT_INVALID", errorClass: "MALFORMED_JSON_CONTENT" },
    { name: "empty", content: "   ", code: "DIRECTOR_CONTENT_EMPTY", errorClass: "CONTENT_EMPTY" },
    { name: "missing", content: undefined, code: "DIRECTOR_CONTENT_EMPTY", errorClass: "CONTENT_MISSING" },
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      const diagnostics: SemanticDirectorDiagnostic[] = [];
      const client = new OpenAiCompatibleSemanticDirector({
        baseUrl: "https://director.example.invalid/v1",
        apiKey: "test-secret-key",
        profile: certifiedProfile,
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        fetcher: async () => responseEnvelope(item.content),
      });
      await assert.rejects(() => client.decide(bundle),
        (error) => error instanceof SemanticDirectorClientError && error.code === item.code);
      assert.equal(diagnostics.at(-1)?.error_class, item.errorClass);
    });
  }
});
test("HTTP, Content-Type, and response-envelope failures are classified without body logging", async (context) => {
  const bodyMarker = "DO_NOT_LOG_RESPONSE_BODY";
  const cases = [
    {
      name: "HTTP rejection",
      response: () => responseEnvelope(bodyMarker, { status: 503 }),
      code: "DIRECTOR_HTTP_REJECTED",
      errorClass: "HTTP_503",
      retryable: true,
    },
    {
      name: "empty successful HTTP body",
      response: () => responseEnvelope(undefined, { rawBody: "", contentType: "text/plain" }),
      code: "DIRECTOR_CONTENT_EMPTY",
      errorClass: "HTTP_BODY_EMPTY",
      retryable: false,
    },
    {
      name: "non-JSON Content-Type",
      response: () => responseEnvelope(JSON.stringify(decision), { contentType: "text/plain" }),
      code: "DIRECTOR_RESPONSE_CONTENT_TYPE_INVALID",
      errorClass: "CONTENT_TYPE_NOT_JSON",
      retryable: false,
    },
    {
      name: "malformed envelope",
      response: () => responseEnvelope(undefined, { rawBody: "{" }),
      code: "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      errorClass: "MALFORMED_RESPONSE_ENVELOPE",
      retryable: false,
    },
  ] as const;

  for (const item of cases) {
    await context.test(item.name, async () => {
      const diagnostics: SemanticDirectorDiagnostic[] = [];
      const client = new OpenAiCompatibleSemanticDirector({
        baseUrl: "https://director.example.invalid/v1",
        apiKey: "test-secret-key",
        profile: certifiedProfile,
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        fetcher: async () => item.response(),
      });
      await assert.rejects(() => client.decide(bundle),
        (error) => error instanceof SemanticDirectorClientError
          && error.code === item.code
          && error.retryable === item.retryable);
      assert.equal(diagnostics.at(-1)?.error_class, item.errorClass);
      assert.equal(JSON.stringify(diagnostics).includes(bodyMarker), false);
      assert.equal(JSON.stringify(diagnostics).includes("test-secret-key"), false);
      assert.equal(JSON.stringify(diagnostics).includes(sourceText), false);
    });
  }
});

test("timeout is retryable and emits only safe metadata", async () => {
  const diagnostics: SemanticDirectorDiagnostic[] = [];
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "test-secret-key",
    profile: certifiedProfile,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    }),
  });
  await assert.rejects(() => client.decide(bundle),
    (error) => error instanceof SemanticDirectorClientError
      && error.code === "DIRECTOR_TIMEOUT"
      && error.retryable);
  assert.equal(diagnostics.at(-1)?.error_class, "TIMEOUT");
  assert.equal(JSON.stringify(diagnostics).includes("test-secret-key"), false);
});
test("schema and provenance failures emit classified diagnostics without auto-repair", async () => {
  const diagnostics: SemanticDirectorDiagnostic[] = [];
  const runtime = createSemanticDirectorRuntimeFromEnv({
    env: envFor(),
    profiles,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    fetcher: async () => responseEnvelope(JSON.stringify({ execution_status: "READY" })),
  });

  await assert.rejects(() => runtime.director.requireExecutable(bundle),
    (error) => error instanceof SemanticDecisionVerificationError
      && error.code === "SEMANTIC_DECISION_MALFORMED");
  assert.equal(diagnostics.at(-1)?.stage, "SCHEMA");
  assert.equal(diagnostics.at(-1)?.error_class, "SCHEMA_VALIDATION_FAILED");
  assert.equal(diagnostics.at(-1)?.verification_code, "SEMANTIC_DECISION_MALFORMED");
});

test("client public configuration contains no endpoint or credential", () => {
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "test-secret-key",
    profile: certifiedProfile,
  });
  const serialized = JSON.stringify(client.publicConfiguration);
  assert.match(serialized, /test-semantic-director-json-v1/);
  assert.match(serialized, /test-director-json/);
  assert.equal(serialized.includes("director.example.invalid"), false);
  assert.equal(serialized.includes("test-secret-key"), false);
});

test("semantic director prompt is cross-domain and forbids output repair semantics", () => {
  assert.match(directorSystemPrompt, /sole semantic director/);
  assert.match(directorSystemPrompt, /plain JSON object/);
  assert.match(directorSystemPrompt, /raw semantic plan/i);
  assert.match(directorSystemPrompt, /reference_asset_ids/);
  assert.match(directorSystemPrompt, /exact supplied canonical order; do not reverse or reorder them/);
  assert.match(directorSystemPrompt, /one-based physical source_text line number/);
  assert.match(directorSystemPrompt, /Do not renumber spoken lines densely/);
  assert.match(directorSystemPrompt, /one storyboard paragraph is exactly one Provider task/);
  assert.match(directorSystemPrompt, /default paragraph duration is 8-15 seconds/);
  assert.match(directorSystemPrompt, /2-4 in-segment sub-shots and every sub-shot is 2-6 seconds/);
  assert.match(directorSystemPrompt, /narrative beats first.*beat, scene, and causal boundaries/);
  assert.match(directorSystemPrompt, /dialogue character count divided by 4\.5 plus 2 seconds/);
  assert.match(directorSystemPrompt, /3-second timeline rows.*same segment prompt.*never become additional Provider tasks/);
  assert.match(directorSystemPrompt, /Do not use ceil\(target_duration_seconds \/ 12\), equal-duration splitting, or one Provider segment per sentence/);
  for (const forbidden of ["泛红", "护肤", "保险", "房地产", "温泉", "拂尘"]) {
    assert.equal(directorSystemPrompt.includes(forbidden), false);
  }
});

test("JSON-schema profile sends the certified strict schema mode", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "test-secret-key",
    profile: schemaProfile,
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return responseEnvelope(JSON.stringify(decision));
    },
  });
  await client.decide(bundle);
  const responseFormat = requestBody?.response_format as {
    type?: string;
    json_schema?: { strict?: boolean; schema?: unknown };
  };
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema?.strict, true);
  const schema = responseFormat.json_schema?.schema as Record<string, unknown>;
  assert.equal(typeof schema.$ref, "string");
  const definitions = schema.definitions as Record<string, Record<string, unknown>>;
  const rawPlanSchema = definitions.RawSemanticPlan;
  assert.equal(rawPlanSchema?.type, "object");
  assert.equal(rawPlanSchema?.additionalProperties, false);
  assert.equal(typeof rawPlanSchema?.properties, "object");
  assert.equal(JSON.stringify(schema).includes("_def"), false);

  const messages = requestBody?.messages as Array<{ role?: string; content?: string }>;
  const contractMessage = JSON.parse(messages[1]?.content ?? "{}") as {
    required_output_json_schema?: Record<string, unknown>;
  };
  assert.deepEqual(contractMessage.required_output_json_schema, schema);
});

test("observed real models expose only the independently certified profile", () => {
  assert.deepEqual(
    semanticDirectorModelProfiles.map((profile) => ({
      model: profile.model,
      status: profile.status,
      reason: profile.status === "UNAVAILABLE" ? profile.reasonCode : undefined,
    })),
    [
      { model: "claude-sonnet-5", status: "CERTIFIED", reason: undefined },
      { model: "deepseek-v4-pro", status: "UNAVAILABLE", reason: "TIMEOUT_OR_EMPTY_CONTENT" },
      { model: "doubao-seed-2.0-pro", status: "UNAVAILABLE", reason: "SEMANTIC_DECISION_V1_FIXTURE_FAILED" },
      { model: "doubao-seed-2-0-lite-260428", status: "UNAVAILABLE", reason: "REFERENCE_VISION_ONLY" },
    ],
  );
});


test("finish-reason truncation and model refusal are classified without content repair or leakage", async (context) => {
  const cases = [
    {
      name: "truncated",
      envelope: { choices: [{ finish_reason: "length", message: { content: "{\"partial\":" } }] },
      code: "DIRECTOR_OUTPUT_TRUNCATED",
      errorClass: "OUTPUT_TRUNCATED",
      secret: "partial",
    },
    {
      name: "refused",
      envelope: { choices: [{ finish_reason: "stop", message: { content: "", refusal: "private refusal detail" } }] },
      code: "DIRECTOR_RESPONSE_REFUSED",
      errorClass: "MODEL_REFUSAL",
      secret: "private refusal detail",
    },
  ] as const;
  for (const item of cases) {
    await context.test(item.name, async () => {
      const diagnostics: SemanticDirectorDiagnostic[] = [];
      const client = new OpenAiCompatibleSemanticDirector({
        baseUrl: "https://director.example.invalid/v1",
        apiKey: "test-secret",
        profile: certifiedProfile,
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        fetcher: async () => new Response(JSON.stringify(item.envelope), {
          headers: { "content-type": "application/json" },
        }),
      });
      await assert.rejects(() => client.decide(bundle), (error) =>
        error instanceof SemanticDirectorClientError
        && error.code === item.code
        && error.retryable === false);
      assert.equal(diagnostics.at(-1)?.error_class, item.errorClass);
      assert.equal(JSON.stringify(diagnostics).includes(item.secret), false);
    });
  }
});
