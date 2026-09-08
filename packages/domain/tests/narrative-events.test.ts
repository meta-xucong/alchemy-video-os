import test from "node:test";
import assert from "node:assert/strict";

import { extractNarrativeSentences, extractVisualConstraints } from "../src/narrative-events.js";
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
