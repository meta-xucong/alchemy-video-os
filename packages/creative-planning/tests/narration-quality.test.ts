import assert from "node:assert/strict";
import test from "node:test";

import { buildNarrationTimeline, evaluateCanonicalTranscript, normalizeNarrationSections } from "../src/narration-quality.js";

test("narration normalization preserves display text and maps safe numeric forms", () => {
  const result = normalizeNarrationSections({
    sections: [{ id: "section-1", text: "“10点41分，0.4秒内完成47条记录。”" }],
  });
  assert.equal(result.status, "NORMALIZED");
  assert.equal(result.displaySections[0]?.text, "“10点41分，0.4秒内完成47条记录。”");
  assert.equal(result.spokenSections[0]?.provider_text, "十点四十一分，零点四秒内完成四十七条记录。");
  assert.equal(result.sourceScriptHash.length, 64);
});

test("narration normalization preserves authored line boundaries for provider text", () => {
  const result = normalizeNarrationSections({
    sections: [{ id: "section-1", text: "第一句。\r\n\r\n  第二句，继续说明。" }],
  });
  assert.equal(result.status, "NORMALIZED");
  assert.equal(result.spokenSections[0]?.provider_text, "第一句。\n\n第二句，继续说明。");
  assert.equal(result.spokenSections[0]?.delivery.pace, "NATURAL");
  assert.equal(result.spokenSections[0]?.delivery.pause_before_ms, 0);
  assert.equal(result.spokenSections[0]?.delivery.pause_after_ms, 0);
});

test("unmapped abbreviations require a glossary decision", () => {
  const result = normalizeNarrationSections({
    sections: [{ id: "section-1", text: "AI 平台完成交付。" }],
  });
  assert.equal(result.status, "NEEDS_DECISION");
  assert.match(result.decisionReasons[0]!, /AI/);

  const approved = normalizeNarrationSections({
    sections: [{ id: "section-1", text: "AI 平台完成交付。" }],
    glossary: new Map([["AI", "人工智能"]]),
  });
  assert.equal(approved.status, "NORMALIZED");
  assert.equal(approved.spokenSections[0]?.pronunciation_guides[0]?.spoken, "人工智能");
});

test("timeline uses measured narration duration and the provider ceiling", () => {
  const result = buildNarrationTimeline({
    sectionDurationsMs: [{ sectionId: "section-1", durationMs: 9_000 }, { sectionId: "section-2", durationMs: 8_000 }],
    targetDurationMs: 30_000,
    flexiblePercent: 20,
  });
  assert.equal(result.status, "READY");
  assert.equal(result.effectiveDurationMs, 30_000);
  assert.deepEqual(result.narrationSections.at(-1), { section_id: "section-2-tail-hold", start_ms: 17_000, end_ms: 30_000, visual_role: "HOLD" });
  assert.deepEqual(result.visualSegments.map((segment) => segment.provider_duration_seconds), [15, 15]);
});

test("timeline blocks overlong narration instead of slowing audio", () => {
  const result = buildNarrationTimeline({
    sectionDurationsMs: [{ sectionId: "section-1", durationMs: 34_000 }],
    targetDurationMs: 30_000,
    flexiblePercent: 10,
  });
  assert.equal(result.status, "NEEDS_DECISION");
  assert.match(result.decisionReasons[0]!, /修订播音稿/);
});

test("timeline preserves three measured ten-second section boundaries for accepted shots", () => {
  const result = buildNarrationTimeline({
    sectionDurationsMs: [
      { sectionId: "shot-1", durationMs: 10_000 },
      { sectionId: "shot-2", durationMs: 10_000 },
      { sectionId: "shot-3", durationMs: 10_000 },
    ],
    targetDurationMs: 30_000,
    flexiblePercent: 20,
  });
  assert.deepEqual(result.visualSegments, [
    { sequence: 1, start_ms: 0, end_ms: 10_000, provider_duration_seconds: 10 },
    { sequence: 2, start_ms: 10_000, end_ms: 20_000, provider_duration_seconds: 10 },
    { sequence: 3, start_ms: 20_000, end_ms: 30_000, provider_duration_seconds: 10 },
  ]);
});

test("canonical transcript is unavailable without a transcript and checks comparable text", () => {
  const unavailable = evaluateCanonicalTranscript({ expectedText: "十点四十一分完成交付。" });
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.matches, null);
  assert.equal(unavailable.accuracy, null);

  const checked = evaluateCanonicalTranscript({
    expectedText: "十点四十一分完成交付。",
    transcriptText: "十点四十一分，完成交付！",
    transcriptAssetId: "ast_transcript_fixture",
  });
  assert.equal(checked.status, "CHECKED");
  assert.equal(checked.matches, true);
  assert.equal(checked.transcript_asset_id, "ast_transcript_fixture");
  assert.equal(checked.accuracy, 1);
});

test("canonical transcript mismatches require review instead of passing", () => {
  const result = evaluateCanonicalTranscript({
    expectedText: "人工智能平台完成交付。",
    transcriptText: "保险平台暂未完成。",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.matches, false);
  assert.ok((result.accuracy ?? 1) < 0.85);
  assert.match(result.issues[0]!, /匹配度/);
});
