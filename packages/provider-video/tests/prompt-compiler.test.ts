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
const legacyNarrationProfile = { ...profile, audioOwner: undefined };

test("the compiler preserves the saved creative description and uses the real-profile defaults", () => {
  const sourcePrompt = "  A new product is revealed on a quiet desk.  ";
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
  });

  assert.deepEqual(compiled.settings, { duration: 5, resolution: "720p", ratio: "16:9" });
  assert.equal(compiled.prompt, sourcePrompt.trim());
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
  assert.equal(compiled.prompt, "A fast demonstration video, 15S, rendered in 480P.");
});

test("the compiler makes scene and subject reference semantics explicit to the provider", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "A woman walks through the resort entrance.",
    generationSettings: {},
    profile,
    referenceRoles: ["SUBJECT", "SCENE"],
  });

  assert.match(compiled.prompt, /scene\/location anchor/);
  assert.match(compiled.prompt, /subject identity/);
  assert.match(compiled.prompt, /do not substitute a generic environment/);
  assert.match(compiled.prompt, /Provider input order is semantic: image 1 = subject reference, image 2 = scene reference/);
  assert.ok(compiled.prompt.indexOf("image 1 = subject reference") < compiled.prompt.indexOf("image 2 = scene reference"));
  assert.match(compiled.prompt, /Do not infer roles from the original upload order/);
});

test("the compiler adds generic key-object locks before reference semantics", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "道家女子手持白色拂尘走过庭院，保持拂尘清晰可见。",
    generationSettings: {},
    profile,
    referenceRoles: ["SUBJECT", "SCENE"],
  });

  assert.match(compiled.prompt, /关键对象连续性锁/);
  assert.match(compiled.prompt, /白色拂尘/);
  assert.match(compiled.prompt, /全片仅一个实例/);
  assert.doesNotMatch(compiled.prompt, /树枝|木棍/u, "an unanalysed source object must not receive an invented replacement rule");
  assert.ok(compiled.prompt.indexOf("关键对象连续性锁") < compiled.prompt.indexOf("Reference image roles"));
});

test("the compiler enforces one instance and atomic handoff without adding a UI setting", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "她左手拿着手机，随后从左手换到右手。",
    generationSettings: {},
    profile,
  });
  assert.match(compiled.prompt, /全片仅一个实例/);
  assert.match(compiled.prompt, /释放，再双手接触交接，最后由右手持有/);
  assert.match(compiled.prompt, /禁止复制、分裂、残影/);
});

test("the compiler preserves explicit dialogue as a visible performance while platform narration owns final audio", () => {
  const compiled = compileVideoPrompt({
    sourcePrompt: "她走近镜头，开口问到：“真巧，你什么时候来的？”",
    generationSettings: {},
    profile: legacyNarrationProfile,
  });
  assert.match(compiled.prompt, /Dialogue visual contract/);
  assert.match(compiled.prompt, /真巧，你什么时候来的/);
  assert.match(compiled.prompt, /mouth movement, and lip-sync reference/);
  assert.match(compiled.prompt, /platform narration supplies the final audible speech/);
  assert.match(compiled.prompt, /natural consistent pace/);
  assert.match(compiled.prompt, /SILENCE\/AMBIENT-ONLY/);
  assert.match(compiled.prompt, /do not continue an additional talking performance/);
  assert.match(compiled.prompt, /Do not slow, stretch, repeat, or add filler words/);
});

test("the native provider owner emits the source dialogue syntax for native audio", () => {
  const script = "真巧，你什么时候来的？";
  const compiled = compileVideoPrompt({
    sourcePrompt: `她走近镜头，开口问到：“${script}”`,
    generationSettings: {},
    profile,
  });
  assert.ok(compiled.prompt.includes(`One speaker per clip. Character says: "${script}"`));
  assert.doesNotMatch(compiled.prompt, /platform narration supplies the final audible speech/);
  assert.doesNotMatch(compiled.prompt, /provider must not generate or carry audible dialogue/);
});

test("the native compiler keeps multiline source dialogue complete in its provider contract", () => {
  const script = "第一句口播。\n\n第二句继续说明。";
  const compiled = compileVideoPrompt({
    sourcePrompt: `画面中的人物口播：“${script}”`,
    generationSettings: {},
    profile,
  });
  assert.ok(compiled.prompt.includes(`Character says: "${script}"`));
  assert.ok(compiled.prompt.includes(script));
});

test("the native compiler does not duplicate an already compiled exact dialogue contract or filler quotes", () => {
  const source = "AUDIO PRIORITY: spoken dialogue is mandatory. Character says: \"第一句。第二句。\". EXACT SPOKEN AUDIO SCRIPT: speak every character of the quoted script above exactly once. Do not insert filler words such as “嗯、啊”. SPOKEN CONTENT BOUNDARY: no extra words.";
  const compiled = compileVideoPrompt({ sourcePrompt: source, generationSettings: {}, profile });
  assert.equal((compiled.prompt.match(/第一句。第二句。/gu) ?? []).length, 1);
  assert.equal((compiled.prompt.match(/Character says:/gu) ?? []).length, 1);
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

test("the compiler keeps the authored source and omits only generated directives when they exceed the provider ceiling", () => {
  const sourcePrompt = "A".repeat(3_600);
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
    referenceRoles: ["SUBJECT", "SCENE", "STYLE"],
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
});

test("the compiler can use the bounded second source pass without generated directives", () => {
  const sourcePrompt = [
    "风格：现代写实、自然光；人物整体从左向右移动 ## 人物与场景",
    "核心事实：人物在街道边与橘白猫互动，先停步、蹲下等待，小猫靠近后轻抚，最后起身离开。",
    "**声音：**玻璃门回弹声、脚步声和环境底噪。",
    "- 不添加手机提示音、背景音乐、字幕、品牌标识或平台水印。",
    "补充事实：" + "湿润街道与橘白猫保持可辨识关系。".repeat(80),
  ].join(" ");
  const compiled = compileVideoPrompt({
    sourcePrompt,
    generationSettings: {},
    profile,
  });

  assert.ok(utf8ByteLength(sourcePrompt) > 4_096);
  assert.ok(utf8ByteLength(compiled.prompt) <= 4_096);
  assert.match(compiled.prompt, /核心事实/);
  assert.doesNotMatch(compiled.prompt, /\*\*声音：\*\*/u);
  assert.deepEqual(compiled.generatedPromptParts, []);
});
