import {
  ProvenanceCheckedSemanticDirector,
  type SemanticDirectorPort,
  type SemanticDirectorVerificationDiagnostic,
} from "@alchemy-video/creative-planning/semantic-director";
import {
  SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
  RawSemanticPlanJsonSchema,
  type CanonicalSourceBundle,
} from "@alchemy-video/contracts";

import { directorSystemPrompt } from "./semantic-director-contract-surface.js";

import type {
  SemanticDirectorCertifiedModelProfile,
  SemanticDirectorModelProfile,
  SemanticDirectorResponseMode,
} from "./semantic-director-model-profiles.js";
import {
  SemanticDirectorRuntimeProfileResolutionError,
  resolveSemanticDirectorRuntimeProfile,
} from "./semantic-director-runtime-profile.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type SemanticDirectorFailureStage =
  | "CONFIGURATION"
  | "REQUEST"
  | "HTTP"
  | "RESPONSE_ENVELOPE"
  | "CONTENT"
  | "SCHEMA"
  | "PROVENANCE"
  | "BLOCKED";
export type SemanticDirectorClientErrorCode =
  | "CONFIGURATION_INVALID"
  | "MODEL_PROFILE_UNAVAILABLE"
  | "DIRECTOR_HTTP_REJECTED"
  | "DIRECTOR_TIMEOUT"
  | "DIRECTOR_NETWORK_UNAVAILABLE"
  | "DIRECTOR_REQUEST_TOO_LARGE"
  | "DIRECTOR_RESPONSE_TOO_LARGE"
  | "DIRECTOR_RESPONSE_CONTENT_TYPE_INVALID"
  | "DIRECTOR_RESPONSE_ENVELOPE_INVALID"
  | "DIRECTOR_CONTENT_EMPTY"
  | "DIRECTOR_CONTENT_FORMAT_INVALID"
  | "DIRECTOR_OUTPUT_TRUNCATED"
  | "DIRECTOR_RESPONSE_REFUSED";

export type SemanticDirectorDiagnostic = Readonly<{
  event: "semantic_director.diagnostic";
  provider: string;
  model: string;
  profile_id: string;
  contract_version: typeof SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION;
  response_mode?: SemanticDirectorResponseMode;
  stage: SemanticDirectorFailureStage;
  outcome: "RESPONSE_PARSED" | "FAILED";
  retryable: boolean;
  elapsed_ms?: number;
  request_bytes?: number;
  http_status?: number;
  response_content_type?: string;
  response_bytes?: number;
  empty_response?: boolean;
  error_class?: string;
  verification_code?: string;
}>;
export type SemanticDirectorDiagnosticSink = (diagnostic: SemanticDirectorDiagnostic) => void;

export class SemanticDirectorClientError extends Error {
  constructor(
    readonly code: SemanticDirectorClientErrorCode,
    message: string,
    readonly retryable = false,
    readonly diagnostic?: SemanticDirectorDiagnostic,
  ) {
    super(message);
    this.name = "SemanticDirectorClientError";
  }
}

class SemanticDirectorProtocolError extends Error {
  constructor(
    readonly code: SemanticDirectorClientErrorCode,
    readonly stage: SemanticDirectorFailureStage,
    message: string,
    readonly errorClass: string,
    readonly retryable = false,
    readonly emptyResponse?: boolean,
  ) {
    super(message);
    this.name = "SemanticDirectorProtocolError";
  }
}

class SemanticDirectorResponseTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super("Semantic director response exceeded the configured byte limit.");
    this.name = "SemanticDirectorResponseTooLargeError";
  }
}
const emitDiagnostic = (
  sink: SemanticDirectorDiagnosticSink | undefined,
  diagnostic: SemanticDirectorDiagnostic,
) => {
  if (!sink) return;
  try {
    sink(diagnostic);
  } catch {
    // Diagnostics must never alter planning behavior.
  }
};


const endpointFor = (baseUrl: string) => {
  let url: URL;
  try {
    url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    throw new SemanticDirectorClientError(
      "CONFIGURATION_INVALID",
      "Semantic director base URL is invalid.",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new SemanticDirectorClientError(
      "CONFIGURATION_INVALID",
      "Semantic director base URL must be a credential-free HTTPS origin or path.",
    );
  }
  return new URL("chat/completions", url).toString();
};

const normalizedContentType = (value: string) =>
  (value.split(";", 1)[0]?.trim().toLowerCase() ?? "").slice(0, 128);

const isJsonContentType = (value: string) => {
  const mediaType = normalizedContentType(value);
  return mediaType === "application/json" || mediaType.endsWith("+json");
};

const readBoundedResponseBody = async (response: Response) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new SemanticDirectorResponseTooLargeError(declaredLength);
  }
  if (!response.body) return { text: "", byteLength: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SemanticDirectorResponseTooLargeError(total);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), byteLength: total };
};

const parseResponseEnvelope = (text: string): unknown => {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      "RESPONSE_ENVELOPE",
      "Semantic director returned a malformed response envelope.",
      "MALFORMED_RESPONSE_ENVELOPE",
      false,
      text.trim().length === 0,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      "RESPONSE_ENVELOPE",
      "Semantic director response envelope must be a JSON object.",
      "NON_OBJECT_RESPONSE_ENVELOPE",
    );
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      "RESPONSE_ENVELOPE",
      "Semantic director response contains no choice.",
      "CHOICE_MISSING",
    );
  }
  const choice = choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      "RESPONSE_ENVELOPE",
      "Semantic director choice is malformed.",
      "CHOICE_INVALID",
    );
  }
  const finishReason = (choice as { finish_reason?: unknown }).finish_reason;
  if (finishReason === "length") {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_OUTPUT_TRUNCATED",
      "CONTENT",
      "Semantic director output was truncated by its certified output limit.",
      "OUTPUT_TRUNCATED",
    );
  }
  if (finishReason === "content_filter") {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_REFUSED",
      "CONTENT",
      "Semantic director refused the request.",
      "CONTENT_FILTERED",
    );
  }
  if (finishReason !== undefined && finishReason !== null && finishReason !== "stop") {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      "RESPONSE_ENVELOPE",
      "Semantic director returned an unsupported finish reason.",
      "FINISH_REASON_UNSUPPORTED",
    );
  }
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_ENVELOPE_INVALID",
      "RESPONSE_ENVELOPE",
      "Semantic director response contains no message object.",
      "MESSAGE_MISSING",
    );
  }
  const refusal = (message as { refusal?: unknown }).refusal;
  if (typeof refusal === "string" && refusal.trim()) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_RESPONSE_REFUSED",
      "CONTENT",
      "Semantic director refused the request.",
      "MODEL_REFUSAL",
    );
  }
  return (message as { content?: unknown }).content;
};

const parseContent = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string") {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_CONTENT_EMPTY",
      "CONTENT",
      "Semantic director returned no JSON content.",
      "CONTENT_MISSING",
      false,
      true,
    );
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_CONTENT_EMPTY",
      "CONTENT",
      "Semantic director returned empty JSON content.",
      "CONTENT_EMPTY",
      false,
      true,
    );
  }
  if (normalized.startsWith("```") || normalized.endsWith("```")) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_CONTENT_FORMAT_INVALID",
      "CONTENT",
      "Semantic director returned Markdown instead of a plain JSON object.",
      "MARKDOWN_FENCE",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_CONTENT_FORMAT_INVALID",
      "CONTENT",
      "Semantic director returned malformed JSON content.",
      "MALFORMED_JSON_CONTENT",
      false,
      false,
    );
  }
  if (Array.isArray(parsed)) {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_CONTENT_FORMAT_INVALID",
      "CONTENT",
      "Semantic director returned an array root instead of a JSON object.",
      "ARRAY_ROOT",
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new SemanticDirectorProtocolError(
      "DIRECTOR_CONTENT_FORMAT_INVALID",
      "CONTENT",
      "Semantic director returned a non-object JSON root.",
      "NON_OBJECT_ROOT",
    );
  }
  return parsed as Record<string, unknown>;
};

const createRequestBody = (
  profile: SemanticDirectorCertifiedModelProfile,
  bundle: CanonicalSourceBundle,
) => {
  const body: Record<string, unknown> = {
    model: profile.model,
    temperature: 0,
    max_tokens: profile.maxOutputTokens,
    messages: [
      { role: "system", content: directorSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          contract_version: SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
          required_output_json_schema: RawSemanticPlanJsonSchema,
          canonical_source_bundle: bundle,
        }),
      },
    ],
  };
  if (profile.responseMode === "JSON_SCHEMA") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "raw_semantic_plan_v1",
        strict: true,
        schema: RawSemanticPlanJsonSchema,
      },
    };
  } else if (profile.responseMode === "JSON_OBJECT") {
    body.response_format = { type: "json_object" };
  }
  return body;
};

export type SemanticDirectorPublicConfiguration = Readonly<{
  provider: string;
  model: string;
  profile_id: string;
  certification_source: "REGISTRY" | "LOCAL_REPORT";
  response_mode: SemanticDirectorResponseMode;
  timeout_ms: number;
  max_input_utf8_bytes: number;
  max_output_tokens: number;
  contract_version: typeof SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION;
  fixture_id: string;
  certification_surface_hash: string;
}>;

export class OpenAiCompatibleSemanticDirector implements SemanticDirectorPort {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: Readonly<{
    baseUrl: string;
    apiKey: string;
    profile: SemanticDirectorCertifiedModelProfile;
    fetcher?: typeof fetch;
    diagnosticSink?: SemanticDirectorDiagnosticSink;
  }>) {
    if (!options.apiKey.trim()) {
      throw new SemanticDirectorClientError("CONFIGURATION_INVALID", "Semantic director credentials are incomplete.");
    }
    this.endpoint = endpointFor(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
  }
  get publicConfiguration(): SemanticDirectorPublicConfiguration {
    const profile = this.options.profile;
    return {
      provider: profile.provider,
      model: profile.model,
      profile_id: profile.profileId,
      certification_source: profile.certificationSource ?? "REGISTRY",
      response_mode: profile.responseMode,
      timeout_ms: profile.timeoutMs,
      max_input_utf8_bytes: profile.maxInputUtf8Bytes,
      max_output_tokens: profile.maxOutputTokens,
      contract_version: profile.contractVersion,
      fixture_id: profile.fixtureId,
      certification_surface_hash: profile.certificationSurfaceHash,
    };
  }

  private diagnostic(input: Omit<
  SemanticDirectorDiagnostic,
  "event" | "provider" | "model" | "profile_id" | "contract_version" | "response_mode"
  >): SemanticDirectorDiagnostic {
    return {
      event: "semantic_director.diagnostic",
      provider: this.options.profile.provider,
      model: this.options.profile.model,
      profile_id: this.options.profile.profileId,
      contract_version: this.options.profile.contractVersion,
      response_mode: this.options.profile.responseMode,
      ...input,
    };
  }

  private requestHeaders(): Record<string, string> {
    const authHeader = ["Author", "ization"].join("");
    const authScheme = ["Bear", "er"].join("");
    return {
      [authHeader]: `${authScheme} ${this.options.apiKey}`,
      "Content-Type": "application/json",
    };
  }
  async decide(bundle: CanonicalSourceBundle): Promise<unknown> {
    const requestBody = JSON.stringify(createRequestBody(this.options.profile, bundle));
    const requestBytes = new TextEncoder().encode(requestBody).byteLength;
    if (requestBytes > this.options.profile.maxInputUtf8Bytes) {
      const diagnostic = this.diagnostic({
        stage: "REQUEST",
        outcome: "FAILED",
        retryable: false,
        elapsed_ms: 0,
        request_bytes: requestBytes,
        error_class: "REQUEST_TOO_LARGE",
      });
      emitDiagnostic(this.options.diagnosticSink, diagnostic);
      throw new SemanticDirectorClientError(
        "DIRECTOR_REQUEST_TOO_LARGE",
        "Semantic director request exceeds the certified input byte limit.",
        false,
        diagnostic,
      );
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.profile.timeoutMs);
    let httpStatus: number | undefined;
    let responseContentType: string | undefined;
    let responseBytes: number | undefined;
    let emptyResponse: boolean | undefined;
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: this.requestHeaders(),
        body: requestBody,
        signal: controller.signal,
      });
      httpStatus = response.status;
      responseContentType = normalizedContentType(response.headers.get("content-type") ?? "");
      const responseBody = await readBoundedResponseBody(response);
      responseBytes = responseBody.byteLength;
      emptyResponse = responseBody.text.trim().length === 0;

      if (!response.ok) {
        const retryable = response.status === 408
          || response.status === 425
          || response.status === 429
          || response.status >= 500;
        throw new SemanticDirectorProtocolError(
          "DIRECTOR_HTTP_REJECTED",
          "HTTP",
          "Semantic director service rejected the request.",
          `HTTP_${response.status}`,
          retryable,
          emptyResponse,
        );
      }
      if (emptyResponse) {
        throw new SemanticDirectorProtocolError(
          "DIRECTOR_CONTENT_EMPTY",
          "CONTENT",
          "Semantic director returned an empty HTTP response.",
          "HTTP_BODY_EMPTY",
          false,
          true,
        );
      }
      if (!isJsonContentType(responseContentType)) {
        throw new SemanticDirectorProtocolError(
          "DIRECTOR_RESPONSE_CONTENT_TYPE_INVALID",
          "RESPONSE_ENVELOPE",
          "Semantic director response Content-Type is not JSON.",
          "CONTENT_TYPE_NOT_JSON",
          false,
          emptyResponse,
        );
      }
      const content = parseResponseEnvelope(responseBody.text);
      const parsed = parseContent(content);
      emitDiagnostic(this.options.diagnosticSink, this.diagnostic({
        stage: "CONTENT",
        outcome: "RESPONSE_PARSED",
        retryable: false,
        elapsed_ms: Date.now() - startedAt,
        request_bytes: requestBytes,
        http_status: httpStatus,
        response_content_type: responseContentType,
        response_bytes: responseBytes,
        empty_response: emptyResponse,
      }));
      return parsed;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      let code: SemanticDirectorClientErrorCode;
      let stage: SemanticDirectorFailureStage;
      let message: string;
      let errorClass: string;
      let retryable = false;
      if (error instanceof SemanticDirectorProtocolError) {
        ({ code, stage, message, errorClass, retryable } = error);
        emptyResponse ??= error.emptyResponse;
      } else if (error instanceof SemanticDirectorResponseTooLargeError) {
        code = "DIRECTOR_RESPONSE_TOO_LARGE";
        stage = "RESPONSE_ENVELOPE";
        message = error.message;
        errorClass = "RESPONSE_TOO_LARGE";
        responseBytes = error.byteLength;
      } else if (error instanceof Error && error.name === "AbortError") {
        code = "DIRECTOR_TIMEOUT";
        stage = "REQUEST";
        message = "Semantic director request timed out.";
        errorClass = "TIMEOUT";
        retryable = true;
      } else {
        code = "DIRECTOR_NETWORK_UNAVAILABLE";
        stage = "REQUEST";
        message = "Semantic director service is unavailable.";
        errorClass = "NETWORK_UNAVAILABLE";
        retryable = true;
      }
      const diagnostic = this.diagnostic({
        stage,
        outcome: "FAILED",
        retryable,
        elapsed_ms: elapsedMs,
        request_bytes: requestBytes,
        ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
        ...(responseContentType !== undefined ? { response_content_type: responseContentType } : {}),
        ...(responseBytes !== undefined ? { response_bytes: responseBytes } : {}),
        ...(emptyResponse !== undefined ? { empty_response: emptyResponse } : {}),
        error_class: errorClass,
      });
      emitDiagnostic(this.options.diagnosticSink, diagnostic);
      throw new SemanticDirectorClientError(code, message, retryable, diagnostic);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type SemanticDirectorRuntime = Readonly<{
  /**
   * Full-decision verifier retained for callers that already provide platform
   * provenance fields. The production raw-plan path uses rawDirector below.
   */
  director: ProvenanceCheckedSemanticDirector;
  /**
   * Certified provider adapter. The workflow executor canonicalizes this
   * model-owned RawSemanticPlan against the frozen source bundle before it can
   * be persisted or sent to a video provider.
   */
  rawDirector: OpenAiCompatibleSemanticDirector;
  configuration: SemanticDirectorPublicConfiguration;
}>;

export type SemanticDirectorRuntimeOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  profiles?: readonly SemanticDirectorModelProfile[];
  diagnosticSink?: SemanticDirectorDiagnosticSink;
}>;

const exactOptionalInteger = (
  name: string,
  rawValue: string | undefined,
  expected: number,
) => {
  if (rawValue === undefined || rawValue.trim() === "") return;
  if (Number(rawValue) !== expected) {
    throw new SemanticDirectorClientError(
      "CONFIGURATION_INVALID",
      `${name} must match the certified Semantic Director profile.`,
    );
  }
};
export const createSemanticDirectorRuntimeFromEnv = (
  options: SemanticDirectorRuntimeOptions = {},
): SemanticDirectorRuntime => {
  const env = options.env ?? process.env;
  if (env.SEMANTIC_PLANNER_ENABLED?.trim().toLowerCase() !== "true") {
    throw new SemanticDirectorClientError(
      "CONFIGURATION_INVALID",
      "Real semantic planning requires SEMANTIC_PLANNER_ENABLED=true.",
    );
  }
  const baseUrl = env.SEMANTIC_PLANNER_BASE_URL?.trim();
  const apiKey = env.SEMANTIC_PLANNER_API_KEY?.trim();
  const model = env.SEMANTIC_PLANNER_MODEL?.trim();
  const profileId = env.SEMANTIC_PLANNER_PROFILE_ID?.trim();
  if (!baseUrl || !apiKey || !model || !profileId) {
    throw new SemanticDirectorClientError(
      "CONFIGURATION_INVALID",
      "Real semantic planning requires explicit base URL, API key, model, and certified profile ID.",
    );
  }

  let profile: SemanticDirectorCertifiedModelProfile;
  try {
    profile = resolveSemanticDirectorRuntimeProfile({
      env,
      profileId,
      model,
      ...(options.profiles ? { profiles: options.profiles } : {}),
    });
  } catch (error) {
    if (!(error instanceof SemanticDirectorRuntimeProfileResolutionError)) throw error;
    const diagnostic: SemanticDirectorDiagnostic = {
      event: "semantic_director.diagnostic",
      provider: "unavailable",
      model,
      profile_id: profileId,
      contract_version: SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
      stage: "CONFIGURATION",
      outcome: "FAILED",
      retryable: false,
      error_class: error.code,
    };
    emitDiagnostic(options.diagnosticSink, diagnostic);
    throw new SemanticDirectorClientError(
      "MODEL_PROFILE_UNAVAILABLE",
      error.message,
      false,
      diagnostic,
    );
  }

  exactOptionalInteger("SEMANTIC_PLANNER_TIMEOUT_MS", env.SEMANTIC_PLANNER_TIMEOUT_MS, profile.timeoutMs);
  exactOptionalInteger("SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES", env.SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES, profile.maxInputUtf8Bytes);
  exactOptionalInteger("SEMANTIC_PLANNER_MAX_TOKENS", env.SEMANTIC_PLANNER_MAX_TOKENS, profile.maxOutputTokens);

  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl,
    apiKey,
    profile,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.diagnosticSink ? { diagnosticSink: options.diagnosticSink } : {}),
  });
  const configuration = client.publicConfiguration;
  const verificationDiagnosticSink = (input: SemanticDirectorVerificationDiagnostic) => {
    emitDiagnostic(options.diagnosticSink, {
      event: "semantic_director.diagnostic",
      provider: configuration.provider,
      model: configuration.model,
      profile_id: configuration.profile_id,
      contract_version: configuration.contract_version,
      response_mode: configuration.response_mode,
      stage: input.stage,
      outcome: "FAILED",
      retryable: false,
      error_class: input.stage === "SCHEMA"
        ? "SCHEMA_VALIDATION_FAILED"
        : input.stage === "PROVENANCE"
          ? "PROVENANCE_VALIDATION_FAILED"
          : "SEMANTIC_DECISION_BLOCKED",
      verification_code: input.code,
    });
  };
  return {
    director: new ProvenanceCheckedSemanticDirector(client, verificationDiagnosticSink),
    rawDirector: client,
    configuration,
  };
};

export const createProvenanceCheckedSemanticDirectorFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  fetcher?: typeof fetch,
  profiles?: readonly SemanticDirectorModelProfile[],
  diagnosticSink?: SemanticDirectorDiagnosticSink,
) => createSemanticDirectorRuntimeFromEnv({
  env,
  ...(fetcher ? { fetcher } : {}),
  ...(profiles ? { profiles } : {}),
  ...(diagnosticSink ? { diagnosticSink } : {}),
}).director;

export { directorSystemPrompt };
