import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createCanonicalSourceBundle } from "@alchemy-video/creative-planning";
import {
  OpenAiCompatibleSemanticDirector,
  SemanticDirectorClientError,
  createVerifiedSemanticDirectorFromEnv,
  directorSystemPrompt,
} from "../src/semantic-director-client.js";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
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
  }],
  providerCapability: {
    profile_id: "test-profile",
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
    provider_role: "SCENE" as const,
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
    evidence_refs: [{
      evidence_id: "evd_segment_001",
      kind: "SOURCE_TEXT",
      source_hash: bundle.source_hash,
      span: { start: visualStart, end: visualStart + visualQuote.length, quote: visualQuote },
    }],
    dialogue_ids: ["dlg_hello_001"],
    reference_asset_ids: ["ast_reference_001"],
  }],
  unresolved_items: [],
};

const jsonResponse = (content: unknown, status = 200) => new Response(JSON.stringify({
  choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
}), { status, headers: { "content-type": "application/json" } });

test("verified semantic director sends the complete canonical bundle and accepts only evidence-backed output", async () => {
  const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const director = createVerifiedSemanticDirectorFromEnv({
    SEMANTIC_PLANNER_BASE_URL: "https://director.example.invalid/v1",
    SEMANTIC_PLANNER_API_KEY: "test-key",
    SEMANTIC_PLANNER_MODEL: "test-director",
  }, async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), init: init ?? {}, body });
    return jsonResponse(decision);
  });

  const verified = await director.requireExecutable(bundle);
  assert.equal(verified.segments[0]?.visual_decision, visualQuote);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://director.example.invalid/v1/chat/completions");
  assert.equal((requests[0]?.init.headers as Record<string, string>).Authorization, "Bearer test-key");
  const messages = requests[0]?.body.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(JSON.parse(messages[1]!.content), bundle);
  assert.equal(requests[0]?.body.response_format && (requests[0]?.body.response_format as { type: string }).type, "json_object");
});

test("semantic director configuration is explicit and unsafe endpoints are rejected", () => {
  assert.throws(() => createVerifiedSemanticDirectorFromEnv({}),
    (error) => error instanceof SemanticDirectorClientError && error.code === "CONFIGURATION_INVALID");
  assert.throws(() => new OpenAiCompatibleSemanticDirector({
    baseUrl: "http://director.example.invalid/v1",
    apiKey: "key",
    model: "model",
  }), (error) => error instanceof SemanticDirectorClientError && error.code === "CONFIGURATION_INVALID");
});

test("old arrays, fenced JSON, malformed responses, and provider rejection never fall back", async () => {
  for (const content of [JSON.stringify([decision]), "```json\n{}\n```", "not-json"]) {
    const client = new OpenAiCompatibleSemanticDirector({
      baseUrl: "https://director.example.invalid/v1",
      apiKey: "key",
      model: "model",
      fetcher: async () => jsonResponse(content),
    });
    await assert.rejects(() => client.decide(bundle),
      (error) => error instanceof SemanticDirectorClientError && error.code === "DIRECTOR_RESPONSE_INVALID");
  }
  const unavailable = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "key",
    model: "model",
    fetcher: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(() => unavailable.decide(bundle),
    (error) => error instanceof SemanticDirectorClientError && error.code === "DIRECTOR_UNAVAILABLE" && error.retryable);
});

test("semantic director timeout is surfaced as retryable unavailability", async () => {
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: "https://director.example.invalid/v1",
    apiKey: "key",
    model: "model",
    timeoutMs: 1_000,
    fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  await assert.rejects(() => client.decide(bundle),
    (error) => error instanceof SemanticDirectorClientError && error.code === "DIRECTOR_UNAVAILABLE" && error.retryable);
});

test("semantic director prompt contains only cross-domain evidence rules", () => {
  assert.match(directorSystemPrompt, /sole semantic director/);
  assert.match(directorSystemPrompt, /evidence/);
  for (const forbidden of ["泛红", "护肤", "保险", "房地产", "温泉", "拂尘"]) {
    assert.equal(directorSystemPrompt.includes(forbidden), false);
  }
});
