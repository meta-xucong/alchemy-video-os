import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiCompatibleReferenceVisionAnalyzer } from "../src/index.js";

test("multimodal adapter returns objective observations without assigning image usage", async () => {
  const calls: RequestInit[] = [];
  const analyzer = new OpenAiCompatibleReferenceVisionAnalyzer({
    baseUrl: "https://vision.example/v1",
    apiKey: "secret-key",
    model: "vision-model",
    fetcher: async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"一座旧式站台，暖色吊灯照亮砖墙。","objects":[{"name":"站台吊灯","description":"黄铜色灯罩和暖黄色光源","relation":"悬挂在砖墙前方"}]}' } }] }), { status: 200 });
    },
  });
  const result = await analyzer.analyze({ assetId: "ast_test", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(result, { summary: "一座旧式站台，暖色吊灯照亮砖墙。", objects: [{ name: "站台吊灯", description: "黄铜色灯罩和暖黄色光源", relation: "悬挂在砖墙前方" }] });
  assert.equal(Object.hasOwn(result, "role"), false);
  assert.equal(Object.hasOwn(result, "confidence"), false);
  const requestBody = JSON.parse(String(calls[0]?.body)) as { max_tokens?: number; messages?: Array<{ content?: unknown }> };
  assert.equal(requestBody.max_tokens, 4096);
  assert.equal(String(calls[0]?.body).includes("SUBJECT|SCENE|STYLE"), false);
  assert.match(String(calls[0]?.body), /data:image\/png;base64/);
});

test("a response without an objective summary is rejected instead of guessed", async () => {
  const analyzer = new OpenAiCompatibleReferenceVisionAnalyzer({
    baseUrl: "https://vision.example/v1",
    apiKey: "secret-key",
    model: "vision-model",
    fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"role":"SCENE","confidence":0.99}' } }] }), { status: 200 }),
  });
  await assert.rejects(() => analyzer.analyze({ assetId: "ast_test", mimeType: "image/png", bytes: new Uint8Array([1]) }), /no objective summary/);
});
