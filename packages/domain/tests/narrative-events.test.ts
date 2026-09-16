import test from "node:test";
import assert from "node:assert/strict";

import { classifyNarrativeSentence, extractNarrativeSentences, extractVisualConstraints } from "../src/narrative-events.js";
import { extractKeyVisualObjectLocks } from "../src/visual-object-locks.js";

test("narrative extraction keeps actions while routing source guidance and exposition away from beats", () => {
  const sentences = extractNarrativeSentences([
    "女子沿庭院小路缓缓走来。",
    "她神情平静，衣袖没有明显尘土。",
    "这便是修士与凡人的区别。",
    "不需要腾云驾雾或夸张术法。",
    "第一张图片为人物原型，第二张图片为场景，生成视频。",
  ].join("\n"));

  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["ACTION", "STATE", "EXPOSITION", "EXPOSITION", "CONTROL"]);
});

test("explicit global labels become shared constraints instead of executable beats", () => {
  const source = [
    "标题/主题：30 秒高端护肤品商业广告、轻奢、祛痘、新加坡制造。",
    "全局风格：明亮、纯净、真实摄影、珍珠白与银色、避免明显 CG。",
    "全局声音/文字政策：无旁白、无字幕、纯音乐 BGM。",
    "视觉动作：",
    "精华液滴落。",
    "肌肤微距。",
    "产品 Hero Shot。",
  ].join("\n");

  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "STATE", "STATE", "ACTION", "ACTION", "ACTION"]);
  assert.deepEqual(sentences.slice(3).map((sentence) => sentence.text), ["精华液滴落。", "肌肤微距。", "产品 Hero Shot。"]);
  assert.deepEqual(extractVisualConstraints(source), [
    "标题/主题：30 秒高端护肤品商业广告、轻奢、祛痘、新加坡制造",
    "全局风格：明亮、纯净、真实摄影、珍珠白与银色、避免明显 CG",
    "全局声音/文字政策：无旁白、无字幕、纯音乐 BGM",
  ]);
});

test("an inline global label stops at the next authored sentence boundary", () => {
  const source = "全局风格：明亮。精华液滴落。";
  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "ACTION"]);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["全局风格：明亮。", "精华液滴落。"]);
  assert.deepEqual(extractVisualConstraints(source), ["全局风格：明亮"]);
});

test("an inline global label stops at an authored semicolon before an action", () => {
  const source = "全局风格：明亮；精华液滴落。";
  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "ACTION"]);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["全局风格：明亮；", "精华液滴落。"]);
  assert.deepEqual(extractVisualConstraints(source), ["全局风格：明亮；"]);
});

test("explicit global blocks end at the next executable heading without a blank line", () => {
  const source = [
    "全局风格",
    "明亮、纯净、真实摄影。",
    "视觉动作：",
    "精华液滴落。",
    "肌肤微距。",
  ].join("\n");

  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "ACTION", "ACTION"]);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["明亮、纯净、真实摄影。", "精华液滴落。", "肌肤微距。"]);
});

test("existing visual-description, notes, and explanation headings end a global block", () => {
  for (const heading of ["视觉描述：", "备注：", "说明："]) {
    const source = [
      "全局风格",
      "明亮、纯净、真实摄影。",
      heading,
      "精华液滴落。",
    ].join("\n");
    const sentences = extractNarrativeSentences(source);
    assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "ACTION"]);
    assert.deepEqual(sentences.map((sentence) => sentence.text), ["明亮、纯净、真实摄影。", "精华液滴落。"]);
  }
});

test("the existing video-intent heading remains a control boundary", () => {
  const source = [
    "视频生成意图描述",
    "精华液滴落。",
    "肌肤微距。",
  ].join("\n");
  assert.equal(classifyNarrativeSentence("视频生成意图描述"), "CONTROL");
  assert.deepEqual(extractNarrativeSentences(source), [
    { text: "精华液滴落。", kind: "ACTION" },
    { text: "肌肤微距。", kind: "ACTION" },
  ]);
});

test("OpenMontage section headings end a global block and keep the section source ordered", () => {
  const source = [
    "Global",
    "bright, clean, photographic look.",
    "Section 1:",
    "Serum droplet falls.",
    "Skin close-up.",
  ].join("\n");
  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "ACTION", "ACTION"]);
  assert.deepEqual(sentences.map((sentence) => sentence.text), [
    "bright, clean, photographic look.",
    "Serum droplet falls.",
    "Skin close-up.",
  ]);
});

test("Seedance global and throughout labels stay outside timestamp actions", () => {
  const source = [
    "Global: bright, clean, photographic look.",
    "look: preserve the photographic material treatment.",
    "locks: preserve the declared product identity.",
    "Throughout: preserve the declared product identity.",
    "0-5s: serum droplet falls.",
  ].join("\n");
  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "STATE", "STATE", "STATE", "ACTION"]);
  assert.deepEqual(extractVisualConstraints(source), [
    "Global: bright, clean, photographic look.",
    "look: preserve the photographic material treatment.",
    "locks: preserve the declared product identity.",
    "Throughout: preserve the declared product identity.",
  ]);
});

test("Huobao atmosphere and Seedance global blocks preserve CRLF order and anchors", () => {
  const source = [
    "Global: @anchor:global-look bright, clean photographic look.",
    "Throughout: @anchor:continuity keep the same product identity.",
    "atmosphere: @anchor:atmosphere quiet room tone and soft daylight.",
    "timestamp script:",
    "0-3s: @anchor:opening consultant walks toward the panel.",
    "3-6s: @anchor:close-up the panel opens and holds.",
  ].join("\r\n");

  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["STATE", "STATE", "STATE", "ACTION", "ACTION"]);
  assert.deepEqual(sentences.map((sentence) => sentence.text), [
    "Global: @anchor:global-look bright, clean photographic look.",
    "Throughout: @anchor:continuity keep the same product identity.",
    "atmosphere: @anchor:atmosphere quiet room tone and soft daylight.",
    "0-3s: @anchor:opening consultant walks toward the panel.",
    "3-6s: @anchor:close-up the panel opens and holds.",
  ]);
  assert.deepEqual(extractVisualConstraints(source), [
    "Global: @anchor:global-look bright, clean photographic look.",
    "Throughout: @anchor:continuity keep the same product identity.",
    "atmosphere: @anchor:atmosphere quiet room tone and soft daylight.",
  ]);
});

test("unlabeled aliases remain source facts instead of becoming global by guess", () => {
  const source = [
    "标题：仅供参考的产品标题。",
    "风格：明亮纯净。",
    "Global style: polished material.",
    "声音：纯音乐。",
  ].join("\n");
  assert.deepEqual(extractNarrativeSentences(source).map((sentence) => sentence.kind), ["ACTION", "ACTION", "ACTION", "ACTION"]);
});

test("unlabeled style-like prose remains an executable source unit", () => {
  const source = "明亮、纯净、真实摄影。精华液滴落。";
  const sentences = extractNarrativeSentences(source);
  assert.deepEqual(sentences.map((sentence) => sentence.kind), ["ACTION", "ACTION"]);
  assert.equal(sentences[0]?.text, "明亮、纯净、真实摄影。");
});

test("mixed action clauses keep the action and expose state and prohibitions as visual constraints", () => {
  const source = "她神情平静，缓缓走来，不需要夸张特效。";
  assert.deepEqual(extractNarrativeSentences(source).map((sentence) => sentence.kind), ["ACTION"]);
  assert.deepEqual(extractVisualConstraints(source), ["她神情平静", "不需要夸张特效"]);
});

test("physical water restrictions are constraints rather than narrative actions", () => {
  const source = "主持人始终站在温泉池边的干燥区域，不进入水体、不踩水、不游泳。";
  assert.deepEqual(extractNarrativeSentences(source).map((sentence) => sentence.kind), ["EXPOSITION"]);
  assert.deepEqual(extractVisualConstraints(source), ["不进入水体、不踩水、不游泳"]);
});

test("key visual object locks are generic, conservative, and forbid semantic substitution", () => {
  const locks = extractKeyVisualObjectLocks("道家女子手持白色拂尘缓缓走来，另一手拿着长剑。不得把拂尘变成树枝。");
  assert.deepEqual(locks.map((lock) => lock.name), ["白色拂尘", "长剑"]);
  assert.match(locks[0]!.description, /白色拂尘/);
  assert.match(locks[0]!.prohibited_changes.join(""), /不得将白色拂尘替换为树枝/);
});

test("UI reference-purpose text does not become a foreground object lock", () => {
  const locks = extractKeyVisualObjectLocks("参考图用途说明（按文件名）：02.png 是产品界面主体参考；16.png 是场景环境参考。所有参考图仅作为视觉锚点。");
  assert.deepEqual(locks, []);
});

test("key visual object locks detect only explicit hand transfers and default to one instance", () => {
  const locks = extractKeyVisualObjectLocks("她左手拿着手机，随后从左手换到右手，右手接过手机。没有换手的书卷继续由左手拿着。" );
  const phone = locks.find((lock) => lock.name === "手机");
  const book = locks.find((lock) => lock.name === "书卷");
  assert.equal(phone?.instance_count, 1);
  assert.deepEqual(phone?.transfer, { from: "LEFT_HAND", to: "RIGHT_HAND" });
  assert.equal(book?.transfer, undefined);
  assert.equal(book?.holder, "LEFT_HAND");
});

test("object holder inference stays local when two objects use different hands", () => {
  const locks = extractKeyVisualObjectLocks("她左手拿着手机，右手拿着长剑，沿庭院走来。" );
  assert.equal(locks.find((lock) => lock.name === "手机")?.holder, "LEFT_HAND");
  assert.equal(locks.find((lock) => lock.name === "长剑")?.holder, "RIGHT_HAND");
});

test("explicit handoff can continue in the next sentence without duplicating the object", () => {
  const phone = extractKeyVisualObjectLocks("她左手拿着手机。随后把它从左手换到右手。")
    .find((lock) => lock.name === "手机");
  assert.deepEqual(phone?.transfer, { from: "LEFT_HAND", to: "RIGHT_HAND" });
});
