import {
  VerifiedSemanticDirector,
  type SemanticDirectorPort,
} from "@alchemy-video/creative-planning/semantic-director";
import type { CanonicalSourceBundle } from "@alchemy-video/contracts";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 8_192;

export class SemanticDirectorClientError extends Error {
  constructor(
    readonly code: "CONFIGURATION_INVALID" | "DIRECTOR_UNAVAILABLE" | "DIRECTOR_RESPONSE_INVALID",
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SemanticDirectorClientError";
  }
}

const directorSystemPrompt = [
  "You are the sole semantic director for a general-purpose video production system.",
  "Read the complete CanonicalSourceBundle. Do not use keyword matching, fixed industry assumptions, default creative categories, or hidden fallback rules.",
  "Return exactly one JSON object matching SemanticDirectorDecision version 1. Do not return Markdown, commentary, or extra keys.",
  "Every semantic statement must cite immutable evidence from the bundle.",
  "SOURCE_TEXT evidence uses JavaScript UTF-16 start/end offsets and an exact quote; source_text.slice(start,end) must equal quote.",
  "DOCUMENT evidence must copy an exact quote and its supplied document_id, conversion_id, markdown_sha256, and locator.",
  "REFERENCE_ASSET evidence must use the exact asset_id and asset_sha256. Preserve canonical reference order everywhere.",
  "USER_DECISION evidence must use the exact decision_id, field, and value_hash.",
  "Extract spoken dialogue exactly, without rewriting, translating, normalizing, summarizing, or adding text. Order dialogues by source span.",
  "Choose semantic video segments from the complete context. Segment durations must stay inside provider_capability bounds and sum exactly to target_duration_seconds.",
  "visual_decision is compact natural-language direction for that segment only. It may include a motivated camera decision when useful, but must not invent unsupported people, products, actions, claims, effects, or endpoints.",
  "Do not emit pose, camera, transition, scene-category, object-state, holder, transfer, score, or confidence fields outside the declared schema.",
  "If evidence is insufficient or a required user decision is missing, return execution_status BLOCKED, at least one blocking unresolved item, and no invented segment.",
  "READY is allowed only when every dialogue, reference use, source fact, duration, and required decision is evidence-backed and executable.",
].join("\n");

const endpointFor = (baseUrl: string) => {
  let url: URL;
  try {
    url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch (error) {
    throw new SemanticDirectorClientError("CONFIGURATION_INVALID", "Semantic director base URL is invalid.", false, error);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new SemanticDirectorClientError("CONFIGURATION_INVALID", "Semantic director base URL must be a credential-free HTTPS origin or path.");
  }
  return new URL("chat/completions", url).toString();
};

const parseContent = (value: unknown): unknown => {
  if (typeof value !== "string") {
    throw new SemanticDirectorClientError("DIRECTOR_RESPONSE_INVALID", "Semantic director returned no JSON content.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.startsWith("```") || normalized.endsWith("```")) {
    throw new SemanticDirectorClientError("DIRECTOR_RESPONSE_INVALID", "Semantic director must return a plain JSON object.");
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response is not an object");
    }
    return parsed;
  } catch (error) {
    throw new SemanticDirectorClientError("DIRECTOR_RESPONSE_INVALID", "Semantic director returned malformed JSON.", false, error);
  }
};

export class OpenAiCompatibleSemanticDirector implements SemanticDirectorPort {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(private readonly options: Readonly<{
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
    maxTokens?: number;
    fetcher?: typeof fetch;
  }>) {
    if (!options.apiKey.trim() || !options.model.trim()) {
      throw new SemanticDirectorClientError("CONFIGURATION_INVALID", "Semantic director credentials are incomplete.");
    }
    this.endpoint = endpointFor(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 180_000
      || !Number.isInteger(this.maxTokens) || this.maxTokens < 1 || this.maxTokens > 65_536) {
      throw new SemanticDirectorClientError("CONFIGURATION_INVALID", "Semantic director limits are invalid.");
    }
  }

  async decide(bundle: CanonicalSourceBundle): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          max_tokens: this.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: directorSystemPrompt },
            { role: "user", content: JSON.stringify(bundle) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SemanticDirectorClientError(
          "DIRECTOR_UNAVAILABLE",
          "Semantic director service rejected the request.",
          response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
        );
      }
      const payload = await response.json().catch(() => undefined) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | undefined;
      return parseContent(payload?.choices?.[0]?.message?.content);
    } catch (error) {
      if (error instanceof SemanticDirectorClientError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new SemanticDirectorClientError(
        "DIRECTOR_UNAVAILABLE",
        aborted ? "Semantic director request timed out." : "Semantic director service is unavailable.",
        true,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const createVerifiedSemanticDirectorFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  fetcher?: typeof fetch,
) => {
  const baseUrl = env.SEMANTIC_PLANNER_BASE_URL?.trim();
  const apiKey = env.SEMANTIC_PLANNER_API_KEY?.trim();
  const model = env.SEMANTIC_PLANNER_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    throw new SemanticDirectorClientError("CONFIGURATION_INVALID", "Real semantic planning requires an explicitly configured Semantic Director.");
  }
  const timeout = env.SEMANTIC_PLANNER_TIMEOUT_MS?.trim();
  const maxTokens = env.SEMANTIC_PLANNER_MAX_TOKENS?.trim();
  return new VerifiedSemanticDirector(new OpenAiCompatibleSemanticDirector({
    baseUrl,
    apiKey,
    model,
    ...(timeout ? { timeoutMs: Number(timeout) } : {}),
    ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
    ...(fetcher ? { fetcher } : {}),
  }));
};

export { directorSystemPrompt };
