import assert from "node:assert/strict";
import test from "node:test";

import {
  UnsupportedVideoGenerationInputError,
  VideoPromptCompilationError,
  compileVideoPrompt,
  resolveVideoProviderRuntimeProfile,
  utf8ByteLength,
} from "../src/index.js";

const profile = resolveVideoProviderRuntimeProfile("sub2api");
const captionSuppressionDirective = "全程无字幕；no subtitles, no captions。字幕只在后期统一添加。";
const legacyNarrationProfile = { ...profile, audioOwner: undefined };

test("the compiler preserves the saved creative description and uses the real-profile defaults", () => {
  const sourcePrompt = "  A new product is revealed on a quiet desk.  ";
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
  });

  assert.deepEqual(compiled.settings, { duration: 5, resolution: "720p", ratio: "16:9" });
  assert.ok(compiled.prompt.startsWith(sourcePrompt.trim()));
  assert.equal((compiled.prompt.match(new RegExp(captionSuppressionDirective, "gu")) ?? []).length, 1);
});

test("the compiler uses explicit saved video settings instead of extracting values from the description", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "A fast demonstration video, 15S, rendered in 480P.",
    generationSettings: {
      video_settings: { duration_seconds: 8, resolution: "480p", ratio: "16:9" },
    },
    profile,
  });

  assert.deepEqual(compiled.settings, { duration: 8, resolution: "480p", ratio: "16:9" });
  assert.ok(compiled.prompt.startsWith("A fast demonstration video, 15S, rendered in 480P."));
  assert.equal((compiled.prompt.match(new RegExp(captionSuppressionDirective, "gu")) ?? []).length, 1);
});

test("the compiler makes scene and subject reference semantics explicit to the provider", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "A woman walks through the resort entrance.",
    generationSettings: {},
    profile,
    referenceRoles: ["SUBJECT", "SCENE"],
  });

  assert.match(compiled.prompt, /Reference images \(input order\): image 1 = SUBJECT; image 2 = SCENE/);
  assert.ok(compiled.prompt.indexOf("image 1 = SUBJECT") < compiled.prompt.indexOf("image 2 = SCENE"));
  assert.match(compiled.prompt, /Preserve the supplied reference roles and order/);
});

test("the compiler preserves ordered semantic reference usage without emitting asset IDs", () => {
  const sourcePrompt = "A woman walks through the resort entrance.";
  const references = [
    { asset_id: "ast_private_scene_001", provider_role: "SCENE" as const, usage: "仅作为旧式站台的场景锚点。" },
    { asset_id: "ast_private_style_002", provider_role: "STYLE" as const, usage: "保持第二张参考图的照明风格。" },
  ];
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
    semanticReferences: references,
  });

  assert.equal(compiled.sourcePrompt, sourcePrompt);
  assert.ok(compiled.prompt.includes("image 1 = SCENE; usage: 仅作为旧式站台的场景锚点。"));
  assert.ok(compiled.prompt.includes("image 2 = STYLE; usage: 保持第二张参考图的照明风格。"));
  assert.ok(compiled.prompt.indexOf(references[0]!.usage) < compiled.prompt.indexOf(references[1]!.usage));
  assert.equal(compiled.prompt.includes(references[0]!.asset_id), false);
  assert.equal(compiled.prompt.includes(references[1]!.asset_id), false);
});

test("the compiler never infers object locks from authored source prose", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "道家女子手持白色拂尘走过庭院，保持拂尘清晰可见。",
    generationSettings: {},
    profile,
    referenceRoles: ["SUBJECT", "SCENE"],
  });

  assert.equal(compiled.generatedPromptParts.some((part) => part.includes("关键对象")), false);
  assert.doesNotMatch(compiled.prompt, /已验证关键对象约束/);
  assert.match(compiled.prompt, /Reference images \(input order\)/);
});

test("the compiler does not invent an object-continuity wrapper", () => {
  const sourcePrompt = "她左手拿着手机，随后从左手换到右手。";
  const withoutLock = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
  });
  assert.doesNotMatch(withoutLock.prompt, /已验证关键对象约束/);

  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
    visualObjectLocks: [{
      name: "手机",
      description: "黑色手机，外观与已确认参考保持一致。",
      relation: "初始由左手持有。",
      prohibited_changes: ["不得替换为其它物体。"],
      instance_count: 1,
      holder: "LEFT_HAND",
      transfer: { from: "LEFT_HAND", to: "RIGHT_HAND" },
    }],
  });
  assert.doesNotMatch(compiled.prompt, /已验证关键对象约束|明确换手|不得替换为其它物体/);
  assert.equal(compiled.generatedPromptParts.some((part) => part.includes("关键对象")), false);
});

test("the compiler leaves non-native narration to the AudioPlan owner", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "她走近镜头，开口问到：“真巧，你什么时候来的？”",
    generationSettings: {},
    profile: legacyNarrationProfile,
    dialogueLines: ["真巧，你什么时候来的？"],
  });
  assert.doesNotMatch(compiled.prompt, /Dialogue visual contract|platform narration supplies the final audible speech/);
  assert.match(compiled.prompt, /真巧，你什么时候来的/);
});

test("the native provider owner emits the source dialogue syntax for native audio", () => {
  const script = "真巧，你什么时候来的？";
  const compiled = compileVideoPrompt({
    sourcePrompt: `她走近镜头，开口问到：“${script}”`,
    generationSettings: {},
    profile,
    dialogueLines: [script],
  });
  assert.ok(compiled.prompt.includes(`One speaker per clip. Character says: "${script}"`));
  assert.equal((compiled.prompt.match(new RegExp(captionSuppressionDirective, "gu")) ?? []).length, 1);
  assert.doesNotMatch(compiled.prompt, /platform narration supplies the final audible speech/);
  assert.doesNotMatch(compiled.prompt, /provider must not generate or carry audible dialogue/);
});

test("the sub2api compiler suppresses captions once for native dialogue and no-dialogue prompts", () => {
  const sources = [
    `人物面对镜头说：“原始台词仍需完整保留。”`,
    "产品在安静的桌面上被展示，画面保持稳定。",
  ];
  for (const sourcePrompt of sources) {
    const compiled = compileVideoPrompt({ sourcePrompt, generationSettings: {}, profile });
    assert.equal((compiled.prompt.match(new RegExp(captionSuppressionDirective, "gu")) ?? []).length, 1);
    assert.ok(compiled.prompt.includes(sourcePrompt));
  }
  const dialogue = compileVideoPrompt({ sourcePrompt: sources[0]!, generationSettings: {}, profile });
  assert.ok(dialogue.prompt.includes("原始台词仍需完整保留。"));
});

test("the native compiler keeps multiline source dialogue complete in its provider contract", () => {
  const script = "第一句口播。\n\n第二句继续说明。";
  const compiled = compileVideoPrompt({
    sourcePrompt: `画面中的人物口播：“${script}”`,
    generationSettings: {},
    profile,
    dialogueLines: [script],
  });
  assert.ok(compiled.prompt.includes(`Character says: "${script}"`));
  assert.ok(compiled.prompt.includes(script));
});

test("the compiler never derives dialogue from quoted source prose", () => {
  const sourcePrompt = "人物面对镜头说：“这只是原始提示中的引号。”";
  const compiled = compileVideoPrompt({ sourcePrompt, generationSettings: {}, profile });
  assert.ok(compiled.prompt.includes(sourcePrompt));
  assert.doesNotMatch(compiled.prompt, /One speaker per clip|Dialogue visual contract/);
});

test("the native compiler does not duplicate an already compiled exact dialogue contract or filler quotes", () => {
  const source = `${captionSuppressionDirective} AUDIO PRIORITY: spoken dialogue is mandatory. Character says: \"第一句。第二句。\". EXACT SPOKEN AUDIO SCRIPT: speak every character of the quoted script above exactly once. Do not insert filler words such as “嗯、啊”. SPOKEN CONTENT BOUNDARY: no extra words.`;
  const compiled = compileVideoPrompt({ sourcePrompt: source, generationSettings: {}, profile });
  assert.equal((compiled.prompt.match(/第一句。第二句。/gu) ?? []).length, 1);
  assert.equal((compiled.prompt.match(/Character says:/gu) ?? []).length, 1);
  assert.equal((compiled.prompt.match(new RegExp(captionSuppressionDirective, "gu")) ?? []).length, 1);
  assert.equal(compiled.generatedPromptParts.includes(captionSuppressionDirective), false);
});

test("the Mock compiler does not add the provider caption directive", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "A product film with authored scene text.",
    generationSettings: {},
    profile: resolveVideoProviderRuntimeProfile("mock"),
  });
  assert.doesNotMatch(compiled.prompt, /no subtitles, no captions/u);
  assert.doesNotMatch(compiled.prompt, /字幕只在后期统一添加/u);
});

test("the compiler rejects malformed saved settings and source text that cannot fit the provider ceiling", () => {
  assert.throws(() => compileVideoPrompt({
    sourcePrompt: "A product film.",
    generationSettings: { video_settings: { duration_seconds: 16, resolution: "720p", ratio: "16:9" } },
    profile,
  }), VideoPromptCompilationError);
  const longBrief = "x".repeat(5_000);
  assert.throws(
    () => compileVideoPrompt({ sourcePrompt: longBrief, generationSettings: {}, profile }),
    UnsupportedVideoGenerationInputError,
  );
});

test("the compiler keeps authored source and may omit only non-critical verified object prose", () => {
  const sourcePrompt = "A".repeat(3_600);
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
    visualObjectLocks: [{
      name: "产品包装盒",
      description: "同一包装盒保持清晰可见",
      relation: "位于人物手中",
      prohibited_changes: ["不得替换"],
    }],
  });
  assert.equal(compiled.sourcePrompt, sourcePrompt);
  assert.equal(compiled.prompt.startsWith(sourcePrompt), true);
  assert.ok(utf8ByteLength(compiled.prompt) <= 4_096);
  assert.ok(compiled.prompt.length >= sourcePrompt.length);
  assert.equal(compiled.generatedPromptParts[0], captionSuppressionDirective);
});

test("the compiler fails closed when a near-ceiling source cannot retain caption suppression", () => {
  const sourcePrompt = "x".repeat(4_040);
  assert.equal(utf8ByteLength(sourcePrompt), 4_040);
  assert.throws(
    () => compileVideoPrompt({ sourcePrompt, generationSettings: {}, profile }),
    (error) => error instanceof UnsupportedVideoGenerationInputError && error.code === "PROMPT_BUDGET",
  );
});

test("the compiler fails closed instead of deleting source-looking clauses", () => {
  const sourcePrompt = [
    "风格：现代写实、自然光；人物整体从左向右移动 ## 人物与场景",
    "核心事实：人物在街道边与橘白猫互动，先停步、蹲下等待，小猫靠近后轻抚，最后起身离开。",
    "**声音：**玻璃门回弹声、脚步声和环境底噪。",
    "- 不添加手机提示音、背景音乐、字幕、品牌标识或平台水印。",
    captionSuppressionDirective,
    "补充事实：" + "湿润街道与橘白猫保持可辨识关系。".repeat(80),
  ].join(" ");
  assert.ok(utf8ByteLength(sourcePrompt) > 4_096);
  assert.throws(
    () => compileVideoPrompt({ sourcePrompt, generationSettings: {}, profile }),
    (error) => error instanceof UnsupportedVideoGenerationInputError && error.code === "PROMPT_BUDGET",
  );
});


test("prompt budget fails closed instead of dropping exact dialogue or reference roles", () => {
  assert.throws(
    () => compileVideoPrompt({
      sourcePrompt: "场".repeat(3_700),
      generationSettings: {},
      profile,
      referenceRoles: ["SCENE"],
      dialogueLines: ["这句台词必须逐字保留，不能为了提示词预算被删除。"],
    }),
    (error: unknown) => error instanceof UnsupportedVideoGenerationInputError
      && error.code === "PROMPT_BUDGET",
  );
});

test("prompt budget fails closed instead of dropping exact semantic reference usage", () => {
  assert.throws(
    () => compileVideoPrompt({
      sourcePrompt: "x".repeat(3_900),
      generationSettings: {},
      profile,
      referenceRoles: ["SCENE"],
      semanticReferences: [{
        asset_id: "ast_private_scene_001",
        provider_role: "SCENE",
        usage: "必须逐字保留的参考图用途。".repeat(30),
      }],
    }),
    (error: unknown) => error instanceof UnsupportedVideoGenerationInputError && error.code === "PROMPT_BUDGET",
  );
});
