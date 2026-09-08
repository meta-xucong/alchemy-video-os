import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiCompatibleReferenceVisionAnalyzer } from "../src/index.js";

test("multimodal adapter maps a structured role response without leaking credentials", async () => {
  const calls: RequestInit[] = [];
  const analyzer = new OpenAiCompatibleReferenceVisionAnalyzer({
    baseUrl: "https://vision.example/v1",
    apiKey: "secret-key",
    model: "vision-model",
    fetcher: async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"role":"SCENE","confidence":0.94,"summary":"建筑环境","objects":[{"name":"白色拂尘","description":"白色尘尾和细长手柄","relation":"由人物手持","prohibited_changes":["不得替换或消失"]}]}' } }] }), { status: 200 });
    },
  });
  const result = await analyzer.analyze({ assetId: "ast_test", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(result, { role: "SCENE", confidence: 0.94, summary: "建筑环境", objects: [{ name: "白色拂尘", description: "白色尘尾和细长手柄", relation: "由人物手持", prohibited_changes: ["不得替换或消失"] }] });
  assert.equal(calls.length, 1);
  assert.equal((calls[0]?.headers as Record<string, string>).Authorization, "Bearer secret-key");
  const requestBody = JSON.parse(String(calls[0]?.body)) as { max_tokens?: number };
  assert.equal(requestBody.max_tokens, 4096);
  assert.match(String(calls[0]?.body), /data:image\/png;base64/);
});

test("invalid visual response is rejected instead of guessed", async () => {
  const analyzer = new OpenAiCompatibleReferenceVisionAnalyzer({
    baseUrl: "https://vision.example/v1",
    apiKey: "secret-key",
    model: "vision-model",
    fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"role":"unknown","confidence":0.99}' } }] }), { status: 200 }),
  });
  await assert.rejects(() => analyzer.analyze({ assetId: "ast_test", mimeType: "image/png", bytes: new Uint8Array([1]) }), /invalid role candidate/);
});
