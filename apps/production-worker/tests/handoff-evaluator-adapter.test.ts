import assert from "node:assert/strict";
import test from "node:test";

import {
  HandoffEvaluatorTransportError,
  OpenAiCompatibleHandoffEvaluator,
  createHandoffEvaluatorFromEnv,
} from "../src/handoff-evaluator.js";

const request = {
  fromTailFrame: new Uint8Array([1, 2, 3]),
  toHeadFrame: new Uint8Array([4, 5, 6]),
  continuityHints: {
    characterCount: 1,
    sceneSummary: "产品展示台",
    wardrobeSummary: "无人物",
    actionDirection: "镜头向右移动",
  },
};

test("vision evaluator sends ordered frames and parses a strict PASS", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  const evaluator = new OpenAiCompatibleHandoffEvaluator({
    baseUrl: "https://vision.example/v1",
    apiKey: "test-key",
    model: "test-vision",
    fetcher: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          result: "PASS",
          reason_codes: [],
          summary: "两帧主体和构图可以自然衔接。\n第二句。",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await evaluator.evaluate(request);
  assert.equal(result.result, "PASS");
  assert.deepEqual(result.reasonCodes, []);
  assert.doesNotMatch(result.safeSummary, /[\\r\\n\\t]/);
  assert.equal(capturedUrl, "https://vision.example/v1/chat/completions");
  assert.equal(capturedBody?.model, "test-vision");
  assert.deepEqual(capturedBody?.response_format, { type: "json_object" });
  const messages = capturedBody?.messages as Array<Record<string, unknown>>;
  const content = messages[1]?.content as Array<Record<string, unknown>>;
  const images = content.filter((item) => item.type === "image_url");
  assert.equal(images.length, 2);
  assert.match(String((images[0]?.image_url as Record<string, unknown>).url), /^data:image\/png;base64,/);
  assert.match(String((images[1]?.image_url as Record<string, unknown>).url), /^data:image\/png;base64,/);
});

test("invalid model JSON becomes a failed evaluation", async () => {
  const evaluator = new OpenAiCompatibleHandoffEvaluator({
    baseUrl: "https://vision.example/v1",
    apiKey: "test-key",
    model: "test-vision",
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not-json" } }],
    }), { status: 200 }),
  });
  const result = await evaluator.evaluate(request);
  assert.equal(result.result, "FAILED");
  assert.deepEqual(result.reasonCodes, ["EVALUATOR_FAILED"]);
});

test("transport failures remain retryable", async () => {
  const evaluator = new OpenAiCompatibleHandoffEvaluator({
    baseUrl: "https://vision.example/v1",
    apiKey: "test-key",
    model: "test-vision",
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(
    evaluator.evaluate(request),
    (error: unknown) => error instanceof HandoffEvaluatorTransportError && error.retryable === true,
  );
});

test("environment construction requires all dedicated evaluator settings", () => {
  assert.equal(createHandoffEvaluatorFromEnv({ HANDOFF_EVALUATOR_BASE_URL: "https://vision.example/v1" }), undefined);
  assert.ok(createHandoffEvaluatorFromEnv({
    HANDOFF_EVALUATOR_BASE_URL: "https://vision.example/v1",
    HANDOFF_EVALUATOR_API_KEY: "test-key",
    HANDOFF_EVALUATOR_MODEL: "test-vision",
  }));
});
