import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeterministicPlanningModel,
  LlmFreeformPromptPlanningModel,
  type LlmFreeformPlanningContext,
  type PlanningInput,
} from "@alchemy-video/creative-planning";
import { resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";

import {
  LegacyOpenAiCompatibleSemanticPlanningClient,
  OpenAiCompatibleSemanticPlanningClient,
  createPlanningModelFromEnv,
  createSemanticPlanningClientFromEnv,
} from "../src/semantic-planning-client.js";

const planningInput: PlanningInput = {
  sourceText: "夜幕下，团队完成交付。",
  targetDurationSeconds: 8,
  durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
  stylePreferences: "克制的纪实感",
  sourceAssetIds: ["ast_scene", "ast_subject"],
};

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

test("legacy semantic client posts the frozen input to the OpenAI-compatible JSON endpoint", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = new LegacyOpenAiCompatibleSemanticPlanningClient({
    baseUrl: "https://llm.example.test/v1",
    apiKey: "test-key",
    model: "planner-test",
    fetcher: (async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] });
    }) as typeof fetch,
  });

  assert.deepEqual(await client.plan(planningInput), { ok: true });
  assert.equal(requestUrl, "https://llm.example.test/v1/chat/completions");
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(requestInit?.body)) as {
    model: string;
    temperature: number;
    max_tokens: number;
    response_format: { type: string };
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.model, "planner-test");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0]?.role, "system");
  assert.equal(body.messages[1]?.role, "user");
  assert.ok(body.messages[0]?.content.includes("exact {draft,sourceCoverage}"));
  assert.ok(body.messages[0]?.content.includes("合法 JSON"));
  assert.ok(body.messages[0]?.content.includes("plannerVersion"));
  assert.ok(body.messages[0]?.content.includes("省略 version"));
  assert.ok(body.messages[0]?.content.includes("continuityNote"));
  assert.ok(body.messages[0]?.content.includes("sourceCoverage"));
  assert.ok(body.messages[0]?.content.includes("一一对应"));
  assert.ok(body.messages[0]?.content.includes("[1,2]"));
  assert.ok(body.messages[0]?.content.includes("提交 JSON 前先自检"));
  assert.ok(body.messages[0]?.content.includes("motion_beats"));
  assert.ok(body.messages[0]?.content.includes("character_locks、prop_locks"));
  assert.ok(body.messages[0]?.content.includes("返回 {}"));
  assert.ok(body.messages[1]?.content.includes(planningInput.sourceText));
  assert.ok(body.messages[1]?.content.includes("ast_scene"));
  assert.ok(body.messages[1]?.content.includes("sourceManifest"));
  assert.ok(body.messages[1]?.content.includes("sourceEvidence"));
  assert.ok(body.messages[1]?.content.includes("one coverage segment for each shot"));
  assert.ok(body.messages[1]?.content.includes("夜幕下，团队完成交付。"));
  assert.ok(body.messages[1]?.content.includes(createHash("sha256").update(planningInput.sourceText, "utf8").digest("hex")));
  assert.ok(body.messages[1]?.content.includes("\"sourceUnits\""));
});

test("semantic client sends a minimal freeform segment context without the historical raw schema", async () => {
  const context: LlmFreeformPlanningContext = {
    sourceText: "夜幕下，团队完成交付。",
    targetDurationSeconds: 8,
    stylePreferences: "克制的纪实感",
    sourceAssetIds: ["ast_scene"],
    segmentCount: 1,
    segments: [{
      sequence: 1,
      targetDurationSeconds: 8,
      sourceNarrativeProjection: "夜幕下，团队完成交付。",
      dialogueLines: [],
      referencePolicy: "REFERENCE_SET",
      referenceAnchors: ["scene-anchor"],
    }],
    sourceManifest: {
      sourceTextHash: createHash("sha256").update("夜幕下，团队完成交付。", "utf8").digest("hex"),
      sourceAssetIds: ["ast_scene"],
      sourceUnits: [{ sequence: 1, textHash: "source-hash" }],
      dialogueLines: [],
    },
    sourceEvidence: {
      sourceUnits: [{ sequence: 1, text: "夜幕下，团队完成交付。" }],
      dialogueLines: [],
    },
  };
  let requestInit: RequestInit | undefined;
  const client = new OpenAiCompatibleSemanticPlanningClient({
    baseUrl: "https://llm.example.test/v1",
    apiKey: "test-key",
    model: "planner-test",
    fetcher: (async (_url, init) => {
      requestInit = init;
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ segments: [{ sequence: 1, visual_prompt: "夜色中的交付现场，克制的电影构图。" }] }) } }] });
    }) as typeof fetch,
  });

  assert.deepEqual(await client.plan(context), { segments: [{ sequence: 1, visual_prompt: "夜色中的交付现场，克制的电影构图。" }] });
  const body = JSON.parse(String(requestInit?.body)) as { messages: Array<{ role: string; content: string }> };
  assert.ok(body.messages[0]?.content.includes("visual_prompt"));
  assert.ok(body.messages[0]?.content.includes("segment"));
  assert.ok(!body.messages[0]?.content.includes("sourceCoverage"));
  assert.ok(!body.messages[0]?.content.includes("motionPlan"));
  assert.ok(!body.messages[0]?.content.includes("cameraShot"));
  assert.ok(body.messages[1]?.content.includes("segmentCount"));
  assert.ok(body.messages[1]?.content.includes("sourceNarrativeProjection"));
  assert.ok(body.messages[1]?.content.includes("referenceAnchors"));
  assert.ok(body.messages[1]?.content.includes("夜幕下，团队完成交付。"));
});

test("semantic client rejects unsafe URL forms and malformed provider responses", async () => {
  for (const baseUrl of [
    "https://user:password@llm.example.test/v1",
    "https://llm.example.test/v1?token=secret",
    "https://llm.example.test/v1#fragment",
  ]) {
    assert.throws(
      () => new OpenAiCompatibleSemanticPlanningClient({ baseUrl, apiKey: "key", model: "model" }),
      /userinfo, query, or hash/,
    );
  }

  const cases: Array<{ value: unknown; message: RegExp }> = [
    { value: { choices: [] }, message: /did not contain message content/ },
    { value: { choices: [{ message: { content: "not json" } }] }, message: /invalid JSON/ },
    { value: { choices: [{ message: { content: "```json\n{\"segments\":[]}\n```" } }] }, message: /invalid JSON/ },
  ];
  for (const current of cases) {
    const client = new LegacyOpenAiCompatibleSemanticPlanningClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "key",
      model: "model",
      fetcher: (async () => jsonResponse(current.value)) as typeof fetch,
    });
    await assert.rejects(() => client.plan(planningInput), current.message);
  }

  const rejected = new LegacyOpenAiCompatibleSemanticPlanningClient({
    baseUrl: "https://llm.example.test/v1",
    apiKey: "key",
    model: "model",
    fetcher: (async () => jsonResponse({ error: "rejected" }, 503)) as typeof fetch,
  });
  await assert.rejects(() => rejected.plan(planningInput), /status 503/);
});

test("semantic client aborts a request at the configured timeout", async () => {
  let aborted = false;
  const client = new LegacyOpenAiCompatibleSemanticPlanningClient({
    baseUrl: "https://llm.example.test/v1",
    apiKey: "key",
    model: "model",
    timeoutMs: 5,
    fetcher: (async (_url, init) => new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      }, { once: true });
    })) as typeof fetch,
  });
  await assert.rejects(() => client.plan(planningInput), /aborted/);
  assert.equal(aborted, true);
});

test("semantic planner requires explicit opt-in and never falls back in real mode", async () => {
  assert.equal(createSemanticPlanningClientFromEnv({
    REFERENCE_VISION_BASE_URL: "https://llm.example.test/v1",
    REFERENCE_VISION_API_KEY: "key",
    REFERENCE_VISION_MODEL: "model",
  }), undefined);

  const configured = createSemanticPlanningClientFromEnv({
    SEMANTIC_PLANNER_ENABLED: "true",
    REFERENCE_VISION_BASE_URL: "https://llm.example.test/v1",
    REFERENCE_VISION_API_KEY: "key",
    REFERENCE_VISION_MODEL: "model",
  });
  assert.ok(configured instanceof OpenAiCompatibleSemanticPlanningClient);

  const configuredModel = createPlanningModelFromEnv({
    runtimeProfile: resolveVideoProviderRuntimeProfile("sub2api"),
    env: {
      SEMANTIC_PLANNER_ENABLED: "true",
      REFERENCE_VISION_BASE_URL: "https://llm.example.test/v1",
      REFERENCE_VISION_API_KEY: "key",
      REFERENCE_VISION_MODEL: "model",
    },
  });
  assert.ok(configuredModel instanceof LlmFreeformPromptPlanningModel);

  const unavailable = createPlanningModelFromEnv({
    runtimeProfile: resolveVideoProviderRuntimeProfile("sub2api"),
    env: {},
  });
  await assert.rejects(
    () => unavailable.plan(planningInput),
    (error: unknown) => (error as { code?: string }).code === "LLM_PLANNER_UNAVAILABLE",
  );

  const mock = createPlanningModelFromEnv({
    runtimeProfile: resolveVideoProviderRuntimeProfile("mock"),
    env: {
      SEMANTIC_PLANNER_ENABLED: "true",
      SEMANTIC_PLANNER_BASE_URL: "https://llm.example.test/v1",
      SEMANTIC_PLANNER_API_KEY: "key",
      SEMANTIC_PLANNER_MODEL: "model",
    },
  });
  assert.ok(mock instanceof DeterministicPlanningModel);
  const draft = await mock.plan(planningInput);
  assert.equal(draft.totalDurationSeconds, planningInput.targetDurationSeconds);
});
