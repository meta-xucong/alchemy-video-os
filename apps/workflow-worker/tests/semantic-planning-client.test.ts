import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicPlanningModel,
  LlmFreeformPromptPlanningModel,
  type LlmFreeformPlanningContext,
  type PlanningInput,
} from "@alchemy-video/creative-planning";
import { resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";

import {
  OpenAiCompatibleSemanticPlanningClient,
  createPlanningModelFromEnv,
  createSemanticPlanningClientFromEnv,
} from "../src/mock/semantic-planning-client.js";

const planningInput: PlanningInput = {
  sourceText: "夜幕下，团队完成交付。",
  targetDurationSeconds: 8,
  durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
  stylePreferences: "克制的纪实感",
  sourceAssetIds: ["ast_scene", "ast_subject"],
};

const freeformContext: LlmFreeformPlanningContext = {
  sourceText: "夜幕下，团队完成交付。林岚说：\"保障要逐字写清。\"",
  targetDurationSeconds: 30,
  durationBounds: { minDurationSeconds: 8, maxDurationSeconds: 15 },
  minimumSegments: 2,
  dialogueLines: ["保障要逐字写清。"],
  stylePreferences: "克制的纪实感",
  sourceAssetIds: ["ast_scene"],
};

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

const streamingClient = (
  respond: (init: RequestInit) => Response | Promise<Response>,
  options: Partial<ConstructorParameters<typeof OpenAiCompatibleSemanticPlanningClient>[0]> = {},
) => new OpenAiCompatibleSemanticPlanningClient({
  baseUrl: "https://llm.example.test/v1",
  apiKey: "test-key",
  model: "planner-test",
  ...options,
  fetcher: (async (_url, init) => respond(init!)) as typeof fetch,
});

test("semantic client posts the complete LLM segment-decision contract", async () => {
  let requestInit: RequestInit | undefined;
  const response = [
    { duration_seconds: 15, visual_prompt: "第一段自然语言画面。", dialogue_line_sequences: [1] },
    { duration_seconds: 15, visual_prompt: "第二段自然语言画面。", dialogue_line_sequences: [] },
  ];
  const client = new OpenAiCompatibleSemanticPlanningClient({
    baseUrl: "https://llm.example.test/v1",
    apiKey: "test-key",
    model: "planner-test",
    fetcher: (async (_url, init) => {
      requestInit = init;
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(response) } }] });
    }) as typeof fetch,
  });

  assert.deepEqual(await client.plan(freeformContext), response);
  const body = JSON.parse(String(requestInit?.body)) as {
    model: string;
    temperature: number;
    max_tokens: number;
    response_format?: { type: string };
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.model, "planner-test");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.response_format, undefined);
  const system = body.messages[0]?.content ?? "";
  assert.ok(system.includes("顶层 JSON 数组"));
  assert.ok(system.includes("duration_seconds"));
  assert.ok(system.includes("dialogue_line_sequences"));
  assert.ok(system.includes("bgm_prompt"));
  assert.ok(system.includes("每一项对应一个完整 storyboard/provider 片段"));
  assert.ok(system.includes("显式叙事节拍边界必须拆段"));
  assert.ok(system.includes("同一节拍内的子镜头优先合并在同一项"));
  assert.ok(system.includes("起始事实、可见动作和明确终点"));
  assert.ok(system.includes("不能只保留过程而丢掉结果"));
  for (const forbidden of ["泛红", "肤色", "护肤", "保险", "房地产"]) {
    assert.equal(system.includes(forbidden), false);
  }
  assert.ok(system.includes("2-4 个各 2-6 秒"));
  assert.ok(system.includes("duration_seconds 是该完整片段的总时长"));
  assert.ok(system.includes("不得把段内子镜头各自变成独立的短片段"));
  assert.ok(system.includes("返回空数组，不得输出短于下限的片段"));
  assert.ok(system.includes("编号从 1 开始"));
  assert.ok(system.includes("总和必须正好等于"));
  assert.ok(system.includes("不改变输入顺序"));
  assert.ok(system.includes("镜头、运动、主体、光线、风格"));
  assert.ok(system.includes("不输出 Camera:/Movement:/Subject:/Lighting:/Style"));
  assert.ok(!system.includes("source_ownership"));
  assert.ok(!system.includes("source_spans"));
  const user = body.messages[1]?.content ?? "";
  assert.ok(user.includes("夜幕下，团队完成交付。"));
  assert.ok(user.includes("durationBounds"));
  assert.ok(user.includes("minimumSegments"));
  assert.ok(user.includes("保障要逐字写清。"));
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
  for (const current of [
    { value: { choices: [] }, message: /did not contain message content/ },
    { value: { choices: [{ message: { content: "not json" } }] }, message: /invalid JSON/ },
  ]) {
    await assert.rejects(() => streamingClient(() => jsonResponse(current.value)).plan(freeformContext), current.message);
  }
  await assert.rejects(() => streamingClient(() => jsonResponse({ error: "rejected" }, 503)).plan(freeformContext), /status 503/);
});

test("semantic client aborts a request at the configured timeout", async () => {
  let aborted = false;
  const observing = new OpenAiCompatibleSemanticPlanningClient({
    baseUrl: "https://llm.example.test/v1",
    apiKey: "key",
    model: "model",
    timeoutMs: 5,
    fetcher: (async (_url, init) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
      return new Promise<never>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }) as typeof fetch,
  });
  await assert.rejects(() => observing.plan(freeformContext), /aborted/);
  assert.equal(aborted, true);
});

test("semantic planner requires explicit opt-in and mock mode remains deterministic", async () => {
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
  const mock = createPlanningModelFromEnv({
    runtimeProfile: resolveVideoProviderRuntimeProfile("mock"),
    env: { SEMANTIC_PLANNER_ENABLED: "true", SEMANTIC_PLANNER_BASE_URL: "https://llm.example.test/v1", SEMANTIC_PLANNER_API_KEY: "key", SEMANTIC_PLANNER_MODEL: "model" },
  });
  assert.ok(mock instanceof DeterministicPlanningModel);
  const draft = await mock.plan(planningInput);
  assert.equal(draft.totalDurationSeconds, planningInput.targetDurationSeconds);
});
