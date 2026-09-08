import assert from "node:assert/strict";
import test from "node:test";

import { buildCanonicalNarrationCue, deriveTranscriptScript } from "../src/production-repository.js";

test("transcript context derives explicit quoted dialogue", () => {
  assert.equal(deriveTranscriptScript("庭院里她抬头，说：“你什么时候来的？”"), "你什么时候来的？");
});

test("transcript context does not treat visual narration as spoken dialogue", () => {
  assert.equal(deriveTranscriptScript("雨夜抵达工厂，团队在黎明前完成交付。"), undefined);
});

test("transcript context accepts explicit narration cues", () => {
  assert.equal(deriveTranscriptScript("旁白：夕阳落下，主人公走向庭院。"), "夕阳落下，主人公走向庭院");
});

test("transcript context accepts an unquoted labeled voiceover block", () => {
  assert.equal(
    deriveTranscriptScript("口播文案\n第一句先说完。第二句接着说。\n\n视频生成意图描述\n只描述画面，不应进入口播。"),
    "第一句先说完。第二句接着说。",
  );
});

test("transcript context repairs mismatched labeled narration boundary quotes", () => {
  assert.equal(
    deriveTranscriptScript("口播文案：”\n第一行口播。\n第二行继续说明。\n\n视频生成意图描述\n只描述画面。"),
    "第一行口播。\n第二行继续说明。",
  );
});

test("transcript context accepts the source prompt's explicit English sound cue", () => {
  assert.equal(deriveTranscriptScript("Dialogue: Welcome home."), "Welcome home.");
});

test("canonical explicit script without delivery cues becomes one bounded narration cue", () => {
  assert.deepEqual(buildCanonicalNarrationCue("口播文案：保险 AI 帮企业快速识别风险。\n画面描述：办公楼外景。"), [
    { text: "保险 AI 帮企业快速识别风险。", startMs: 0 },
  ]);
  assert.deepEqual(buildCanonicalNarrationCue("只描述画面，不应进入口播。"), []);
});
