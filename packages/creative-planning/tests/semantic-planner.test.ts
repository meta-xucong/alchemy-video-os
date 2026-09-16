import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeterministicPlanningModel,
  buildSemanticSourceEvidence,
  type LlmFreeformPlanningContext,
  LlmFreeformPromptPlanningModel,
  LlmSemanticPlanningError,
  LlmSemanticPlanningModel,
  type PlanningInput,
} from "../src/index.js";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const normalizeDialogue = (value: string) => value
  .replace(/\r\n?/gu, "\n")
  .replace(/[^\S\n]+/gu, " ")
  .replace(/[ \t]+\n/gu, "\n")
  .replace(/\n[ \t]+/gu, "\n")
  .trim();

const input: PlanningInput = {
  sourceText: "林岚走进工厂，查看新的生产安排。团队完成调整，货车按新计划驶出厂区。",
  targetDurationSeconds: 16,
  durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
  stylePreferences: "纪实电影感",
  sourceAssetIds: [],
};

type RawSemanticPlanningResult = {
  draft: {
    title: string;
    summary: string;
    continuityNote: string;
    beats: Array<{
      sequence: number;
      title: string;
      summary: string;
      narrativeGoal: string;
      visibleFacts: string[];
    }>;
    shotSpecs: Array<Record<string, unknown>>;
  };
  sourceCoverage: {
    segments: Array<{
      segmentSequence: number;
      sourceBeatSequences: number[];
      dialogueLineSequences: number[];
    }>;
  };
};

const toRawFixture = (draft: Awaited<ReturnType<DeterministicPlanningModel["plan"]>>): RawSemanticPlanningResult => {
  let dialogueSequence = 0;
  return {
    draft: {
      title: draft.title,
      summary: draft.summary,
      continuityNote: draft.continuityNote,
      beats: draft.beats.map(({ generationSegmentSequence: _generationSegmentSequence, ...beat }) => beat),
      shotSpecs: draft.shotSpecs.map((shot) => {
        const {
          motionPlan,
          motionPlanHash: _motionPlanHash,
          dialogueLines,
          sceneId: _sceneId,
          characterIds: _characterIds,
          propIds: _propIds,
          referenceAnchors: _referenceAnchors,
          ...semanticShot
        } = shot;
        const { version: _version, ...rawMotionPlan } = motionPlan;
        return {
          ...semanticShot,
          motionPlan: rawMotionPlan,
          ...(shot.voicePerformance ? { voicePerformance: shot.voicePerformance } : {}),
          cameraShot: shot.cameraShot,
          // Dialogue and bindings are platform-derived and intentionally
          // omitted from the raw model shape.
          _dialogueCount: dialogueLines.length,
        };
      }).map(({ _dialogueCount, ...shot }) => shot),
    },
    sourceCoverage: {
      segments: draft.shotSpecs.map((shot) => {
        const dialogueLineSequences = shot.dialogueLines.map((_line, index) => dialogueSequence + index + 1);
        dialogueSequence += shot.dialogueLines.length;
        return {
          segmentSequence: shot.sequence,
          sourceBeatSequences: [...shot.narrativeBeatSequences],
          dialogueLineSequences,
        };
      }),
    },
  };
};

const buildFixture = async (fixtureInput: PlanningInput = input): Promise<RawSemanticPlanningResult> => {
  const draft = await new DeterministicPlanningModel().plan(fixtureInput);
  return toRawFixture(draft);
};

const toDirectorFixture = (
  context: LlmFreeformPlanningContext,
  globalSequences: readonly number[] = [],
) => {
  const globalSet = new Set(globalSequences);
  const visualUnits = context.sourceEvidence.sourceUnits.filter((unit) => !globalSet.has(unit.sequence));
  const segmentCount = context.segments.length;
  const visualSegmentForIndex = (index: number) => Math.min(
    segmentCount,
    Math.floor((index * segmentCount) / Math.max(1, visualUnits.length)) + 1,
  );
  return {
    source_ownership: context.sourceEvidence.sourceUnits.map((unit) => {
      if (globalSet.has(unit.sequence)) {
        return { source_unit_sequence: unit.sequence, role: "GLOBAL" as const };
      }
      const visualIndex = visualUnits.findIndex((candidate) => candidate.sequence === unit.sequence);
      return {
        source_unit_sequence: unit.sequence,
        role: "VISUAL" as const,
        source_spans: [{
          start: 0,
          end: unit.text.length,
          segment_sequence: visualSegmentForIndex(visualIndex),
        }],
      };
    }),
    segments: context.segments.map((segment) => ({
      sequence: segment.sequence,
      visual_prompt: `镜头 ${segment.sequence} 的克制构图与自然动作补充。`,
    })),
  };
};

test("LLM semantic fixture preserves ordered source coverage and returns the existing draft", async () => {
  const fixture = await buildFixture();
  let received: PlanningInput | undefined;
  const planner = new LlmSemanticPlanningModel(async (receivedInput) => {
    received = receivedInput;
    return fixture;
  });

  const plan = await planner.plan(input);
  assert.equal(plan.title, fixture.draft.title);
  assert.equal(plan.plannerVersion, "c12.5-voiceover-first-planner-v1");
  assert.equal(plan.totalDurationSeconds, input.targetDurationSeconds);
  assert.equal(plan.narrativeBeatCount, plan.beats.length);
  assert.equal(plan.generationSegmentCount, plan.shotSpecs.length);
  assert.equal(received?.sourceText, input.sourceText);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.narrativeBeatSequences).flat(), [1, 2]);
});

test("raw canonicalizer derives machine facts while preserving semantic motion and binding order", async () => {
  const boundInput: PlanningInput = {
    ...input,
    sourceAssetIds: ["asset-scene", "asset-subject"],
    sourceShotBindings: {
      1: {
        sceneId: "scene-1",
        characterIds: ["character-1"],
        propIds: ["prop-1", "prop-2"],
        referenceAnchors: ["scene-anchor", "subject-anchor"],
      },
      2: {
        sceneId: "scene-2",
        characterIds: ["character-1"],
        propIds: ["prop-2", "prop-1"],
        referenceAnchors: ["subject-anchor", "scene-anchor"],
      },
    },
  };
  const fixture = await buildFixture(boundInput);
  const plan = await new LlmSemanticPlanningModel(() => fixture).plan(boundInput);
  assert.equal(plan.plannerVersion, "c12.5-voiceover-first-planner-v1");
  assert.equal(plan.totalDurationSeconds, boundInput.targetDurationSeconds);
  assert.equal(plan.continuityLevel, "REVIEW_REQUIRED");
  assert.equal(plan.narrativeBeatCount, plan.beats.length);
  assert.equal(plan.generationSegmentCount, plan.shotSpecs.length);
  assert.equal(plan.cameraPlanMode, "MULTI_SHOT");
  assert.deepEqual(plan.shotSpecs[0]!.referenceAnchors, ["scene-anchor", "subject-anchor"]);
  assert.deepEqual(plan.shotSpecs[1]!.propIds, ["prop-2", "prop-1"]);
  assert.equal(plan.shotSpecs[0]!.motionPlan.version, "c11.6-camera-segment-motion-plan-v5");
  assert.equal(
    plan.shotSpecs[0]!.motionPlanHash,
    hash(JSON.stringify(plan.shotSpecs[0]!.motionPlan)),
  );
});

test("raw canonicalizer permits repeated source occurrences when coverage identities are distinct", async () => {
  const repeatedInput: PlanningInput = {
    sourceText: "林岚走进工厂。林岚走进工厂。",
    targetDurationSeconds: 16,
    durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
    stylePreferences: "自然",
    sourceAssetIds: [],
  };
  const fixture = await buildFixture(repeatedInput);
  const plan = await new LlmSemanticPlanningModel(() => fixture).plan(repeatedInput);
  assert.deepEqual(plan.beats.map((beat) => beat.sequence), [1, 2]);
  assert.deepEqual(plan.beats.map((beat) => beat.generationSegmentSequence), [1, 2]);
});

test("semantic planner rejects missing, duplicated, or mismatched source identity", async () => {
  const fixture = await buildFixture();
  const invalid = structuredClone(fixture) as RawSemanticPlanningResult;
  invalid.sourceCoverage.segments[1]!.sourceBeatSequences = [1];
  invalid.draft.shotSpecs[1]!.narrativeBeatSequences = [1];

  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => invalid).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );

  const wrongHash = structuredClone(fixture) as RawSemanticPlanningResult & Record<string, unknown>;
  wrongHash.sourceTextHash = hash("unrelated source");
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => wrongHash).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );

  const repeatedNarrative = structuredClone(fixture) as RawSemanticPlanningResult;
  repeatedNarrative.draft.shotSpecs[1]!.narrativeGoal = `${repeatedNarrative.draft.shotSpecs[1]!.narrativeGoal} ${fixture.draft.beats[0]!.narrativeGoal}`;
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => repeatedNarrative).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );

  const fabricatedBeat = structuredClone(fixture) as RawSemanticPlanningResult;
  fabricatedBeat.draft.beats[0]!.narrativeGoal = "未经作者提供的虚构画面。";
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => fabricatedBeat).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );

  const reversedCoverage = structuredClone(fixture) as RawSemanticPlanningResult;
  reversedCoverage.sourceCoverage.segments.reverse();
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => reversedCoverage).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );

  const changedSource = structuredClone(fixture) as RawSemanticPlanningResult & Record<string, unknown>;
  changedSource.sourceTextHash = hash("另一个已冻结的源文本。");
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => changedSource).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );

  const reorderedAssets = structuredClone(fixture) as RawSemanticPlanningResult;
  (reorderedAssets.draft.shotSpecs[0] as Record<string, unknown>).referenceAnchors = ["scene-anchor", "subject-anchor"];
  const assetInput = { ...input, sourceAssetIds: ["asset-1", "asset-2"] };
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => reorderedAssets).plan(assetInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );

  const missingSourceHash = structuredClone(fixture) as unknown as Record<string, unknown>;
  missingSourceHash.draft = { ...(missingSourceHash.draft as Record<string, unknown>), plannerVersion: "self-reported" };
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => missingSourceHash).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );

  const missingSourceAssets = structuredClone(fixture) as unknown as Record<string, unknown>;
  (missingSourceAssets.draft as Record<string, unknown>).shotSpecs = [];
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => missingSourceAssets).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );
});

test("semantic planner fails closed instead of dropping authored STATE, EXPOSITION, or shot-label source units", async () => {
  const fullSourceInput: PlanningInput = {
    sourceText: "制作企业短片。环境光线保持柔和。\n【镜头1】林岚走进工厂查看生产安排。\n这就是团队效率升级。\n【镜头2】货车按新计划驶出厂区。",
    targetDurationSeconds: 16,
    durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
    stylePreferences: "纪实电影感",
    sourceAssetIds: [],
  };
  const actionOnlyDraft = await buildFixture(fullSourceInput);

  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => actionOnlyDraft).plan(fullSourceInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );
});

test("semantic planner preserves every authored multiline dialogue line by source hash", async () => {
  const dialogueInput: PlanningInput = {
    sourceText: "口播文案：\n第一段完整保留。\n第二段完整保留。\n视频生成意图描述：\n林岚在明亮工厂车间查看生产安排。",
    targetDurationSeconds: 8,
    durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
    stylePreferences: "自然",
    sourceAssetIds: [],
  };
  const fixture = await buildFixture(dialogueInput);
  fixture.sourceCoverage.segments[0]!.dialogueLineSequences = [1, 2];
  const plan = await new LlmSemanticPlanningModel(() => fixture).plan(dialogueInput);
  assert.deepEqual(plan.shotSpecs[0]!.dialogueLines.map(normalizeDialogue), ["第一段完整保留。", "第二段完整保留。"]);

  const changed = structuredClone(fixture) as RawSemanticPlanningResult;
  changed.sourceCoverage.segments[0]!.dialogueLineSequences = [2, 1];
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => changed).plan(dialogueInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );
});

test("long quoted dialogue does not swallow the following visual source", () => {
  const authoredLine = "甲乙丙丁戊己庚辛壬癸".repeat(180);
  const visualTail = "画面描述：顾问打开风险分析面板并停在清晰的正面构图。";
  const evidence = buildSemanticSourceEvidence({
    sourceText: `林岚开口说：“${authoredLine}”\n${visualTail}`,
  });

  assert.equal(evidence.dialogueLines[0]?.text, authoredLine);
  assert.ok(evidence.sourceUnits.some((unit) => unit.text === visualTail));
  assert.equal(evidence.sourceUnits.some((unit) => unit.text.includes(authoredLine)), false);
});

test("unlabelled visual copy, sound effects, and reference filenames keep their quoted source facts", () => {
  const sourceText = "画面文字显示“焕新配方”，音效“叮”响起。读取文件名\"hero.mp4\"作为参考图，画面出现\"CTA\"。";
  const evidence = buildSemanticSourceEvidence({ sourceText });

  assert.ok(evidence.sourceUnits.some((unit) => unit.text.includes("画面文字显示“焕新配方”，音效“叮”响起")));
  assert.ok(evidence.sourceUnits.some((unit) => unit.text.includes("文件名\"hero.mp4\"")));
  assert.ok(evidence.sourceUnits.some((unit) => unit.text.includes("画面出现\"CTA\"")));
  assert.deepEqual(evidence.dialogueLines, []);
});

test("spoken-cue quotes leave the visual source while remaining in the dialogue evidence", () => {
  const sourceText = "林岚开口说：“这句只属于对白。”\n口播：“另一句也只属于口播。”\n画面描述：她抬手展示产品。";
  const evidence = buildSemanticSourceEvidence({ sourceText });

  assert.deepEqual(evidence.dialogueLines, [
    { sequence: 1, text: "这句只属于对白。" },
    { sequence: 2, text: "另一句也只属于口播。" },
  ]);
  assert.ok(evidence.sourceUnits.some((unit) => unit.text.includes("她抬手展示产品")));
  assert.equal(evidence.sourceUnits.some((unit) => unit.text.includes("这句只属于对白")), false);
  assert.equal(evidence.sourceUnits.some((unit) => unit.text.includes("另一句也只属于口播")), false);
});

test("punctuation-free narration labels do not leak into visual source", () => {
  const sourceText = "口播文案为“只属于旁白的一句。”\n视觉描述：顾问抬手展示产品。";
  const evidence = buildSemanticSourceEvidence({ sourceText });

  assert.deepEqual(evidence.dialogueLines, [{ sequence: 1, text: "只属于旁白的一句。" }]);
  assert.ok(evidence.sourceUnits.some((unit) => unit.text.includes("顾问抬手展示产品")));
  assert.equal(evidence.sourceUnits.some((unit) => unit.text.includes("只属于旁白的一句")), false);
  assert.equal(evidence.sourceUnits.some((unit) => unit.text.includes("口播文案为")), false);
});

test("labelled narration keeps repeated authored lines in source order and delivery cues", async () => {
  const repeatedNarrationInput: PlanningInput = {
    sourceText: "口播文案：\n同一句。\n同一句。\n视频生成意图描述：\n林岚走进工厂查看生产安排。",
    targetDurationSeconds: 8,
    durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
    stylePreferences: "自然",
    sourceAssetIds: [],
  };
  const plan = await new DeterministicPlanningModel().plan(repeatedNarrationInput);
  assert.deepEqual(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).map(normalizeDialogue), ["同一句。", "同一句。"]);
  assert.deepEqual(
    plan.shotSpecs.flatMap((shot) => shot.voicePerformance?.delivery_cues ?? []).map((cue) => normalizeDialogue(cue.text)),
    ["同一句。", "同一句。"],
  );
});

test("spoken-cue quotes keep identical authored dialogue at each source occurrence", async () => {
  const repeatedCueInput: PlanningInput = {
    sourceText: "林岚开口说：“同一句。” 她停顿后再次说道：“同一句。”",
    targetDurationSeconds: 16,
    durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
    stylePreferences: "自然",
    sourceAssetIds: [],
  };
  const plan = await new DeterministicPlanningModel().plan(repeatedCueInput);
  assert.deepEqual(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).map(normalizeDialogue), ["同一句。", "同一句。"]);
  assert.deepEqual(
    plan.shotSpecs.flatMap((shot) => shot.voicePerformance?.delivery_cues ?? []).map((cue) => normalizeDialogue(cue.text)),
    ["同一句。", "同一句。"],
  );
});

test("quoted dialogue over 160 characters is retained and reaches the existing capacity gate", async () => {
  const authoredLine = "甲乙丙丁戊己庚辛壬癸".repeat(17);
  await assert.rejects(
    () => new DeterministicPlanningModel().plan({
      sourceText: `林岚开口说：“${authoredLine}”`,
      targetDurationSeconds: 15,
      durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
      stylePreferences: "自然",
      sourceAssetIds: [],
    }),
    /VOICEOVER_CAPACITY_EXCEEDED/,
  );
});

test("unquoted spoken dialogue over 120 characters retains its tail and reaches the existing capacity gate", async () => {
  const authoredLine = [
    "甲".repeat(40),
    "乙".repeat(40),
    `${"丙".repeat(38)}尾部必须保留`,
  ].join("，");
  const preserved = await new DeterministicPlanningModel().plan({
    sourceText: `林岚回答：${authoredLine}。`,
    targetDurationSeconds: 45,
    durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
    stylePreferences: "自然",
    sourceAssetIds: [],
  });
  assert.equal(preserved.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), authoredLine);

  const unsplittable = `${"甲".repeat(118)}尾部必须保留`;
  await assert.rejects(
    () => new DeterministicPlanningModel().plan({
      sourceText: `林岚回答：${unsplittable}。`,
      targetDurationSeconds: 15,
      durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
      stylePreferences: "自然",
      sourceAssetIds: [],
    }),
    /VOICEOVER_CAPACITY_EXCEEDED/,
  );
});

test("semantic planner preserves declared reference-anchor order", async () => {
  const referenceInput: PlanningInput = {
    ...input,
    sourceShotBindings: { 1: { referenceAnchors: ["subject-anchor", "scene-anchor"] } },
  };
  const fixture = await buildFixture(referenceInput);
  const planned = await new LlmSemanticPlanningModel(() => fixture).plan(referenceInput);
  assert.deepEqual(planned.shotSpecs[0]!.referenceAnchors, ["subject-anchor", "scene-anchor"]);

  const reordered = structuredClone(fixture) as RawSemanticPlanningResult;
  (reordered.draft.shotSpecs[0] as Record<string, unknown>).referenceAnchors = ["scene-anchor", "subject-anchor"];
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => reordered).plan(referenceInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
});

test("semantic planner rejects malformed motion, camera, and timeout results without fallback", async () => {
  const fixture = await buildFixture();
  const invalidMotion = structuredClone(fixture) as RawSemanticPlanningResult;
  (invalidMotion.draft.shotSpecs[0]!.motionPlan as Record<string, unknown>).duration_seconds = 7;
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => invalidMotion).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && (error.code === "LLM_SOURCE_COVERAGE_INVALID" || error.code === "LLM_PLANNER_MALFORMED"),
  );

  await assert.rejects(
    () => new LlmSemanticPlanningModel(
      () => new Promise<never>(() => {}),
      { timeoutMs: 5 },
    ).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_UNAVAILABLE",
  );
});

test("semantic planner rejects opaque or unavailable LLM results without deterministic fallback", async () => {
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => ({ prompt: "opaque prose" })).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => { throw new Error("offline"); }).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_UNAVAILABLE",
  );
});

test("semantic planner checks the supplied UTF-8 budget on each compiled segment", async () => {
  const fixture = await buildFixture();
  const compiler = { compile: async () => ({ prompt: "超出预算", compilerVersion: "fixture", visualConstraints: {}, referenceMap: {}, capabilitySnapshot: {} }) };
  await assert.rejects(
    () => new LlmSemanticPlanningModel(() => fixture, { compiler, maxPromptUtf8Bytes: 1 }).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PROMPT_BUDGET",
  );
});

test("freeform planner adds only ordered visual prompts to the deterministic skeleton", async () => {
  let context: LlmFreeformPlanningContext | undefined;
  const planner = new LlmFreeformPromptPlanningModel(async (received) => {
    context = received;
    return toDirectorFixture(received);
  });
  const plan = await planner.plan(input);

  assert.equal(context?.segmentCount, plan.shotSpecs.length);
  assert.deepEqual(context?.segments.map((segment) => segment.sequence), plan.shotSpecs.map((shot) => shot.sequence));
  assert.deepEqual(context?.segments.map((segment) => segment.targetDurationSeconds), plan.shotSpecs.map((shot) => shot.durationSeconds));
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.visualPrompt), plan.shotSpecs.map((_shot, index) => `镜头 ${index + 1} 的克制构图与自然动作补充。`));
  assert.deepEqual(context?.sourceEvidence.sourceUnits.map((unit) => unit.sequence), [1, 2]);
  assert.deepEqual(plan.beats.map((beat) => beat.generationSegmentSequence), [1, 2]);
  assert.ok(plan.shotSpecs.every((shot) => shot.narrativeBeatSequences.length > 0));
});

test("director ownership keeps the unlabelled product story global facts out of nine visual actions", async () => {
  const actions = [
    "精华液滴落",
    "肌肤微距😀",
    "吸收与舒缓",
    "城市掠影",
    "实验室研发与灌装",
    "瓶身棚拍",
    "女性使用",
    "水润肌肤",
    "产品 Hero Shot",
  ];
  const globalFacts = [
    "30 秒高端护肤品商业广告，整体轻奢，强调祛痘与新加坡制造。",
    "明亮、纯净、真实摄影，珍珠白与银色，避免明显 CG。",
    "无旁白、无字幕、纯音乐 BGM。",
  ];
  const productInput: PlanningInput = {
    sourceText: [...globalFacts, `${actions.join("→")}。`].join("\n"),
    targetDurationSeconds: 30,
    stylePreferences: "",
    sourceAssetIds: [],
  };
  let received: LlmFreeformPlanningContext | undefined;
  const planner = new LlmFreeformPromptPlanningModel(async (context) => {
    received = context;
    const globalSequences = context.sourceEvidence.sourceUnits
      .filter((unit) => globalFacts.includes(unit.text))
      .map((unit) => unit.sequence);
    const fixture = toDirectorFixture(context, globalSequences);
    const actionUnit = context.sourceEvidence.sourceUnits.find((unit) => !globalFacts.includes(unit.text));
    const visualEntry = fixture.source_ownership.find((entry) => entry.role === "VISUAL");
    if (!actionUnit || !visualEntry || visualEntry.role !== "VISUAL") {
      throw new Error("The product fixture must expose one visual source unit.");
    }
    let cursor = 0;
    visualEntry.source_spans = actions.map((action, index) => {
      const start = actionUnit.text.indexOf(action, cursor);
      const end = index + 1 < actions.length
        ? actionUnit.text.indexOf(actions[index + 1]!, start + action.length)
        : actionUnit.text.length;
      if (start < 0 || end <= start) throw new Error("The product fixture action spans must be ordered.");
      cursor = end;
      return {
        start,
        end,
        segment_sequence: Math.min(
          context.segments.length,
          Math.floor((index * context.segments.length) / actions.length) + 1,
        ),
      };
    });
    assert.equal(visualEntry.source_spans[0]!.start, 0);
    assert.equal(visualEntry.source_spans.at(-1)!.end, actionUnit.text.length);
    assert.equal(
      visualEntry.source_spans.map((span) => actionUnit.text.slice(span.start, span.end)).join(""),
      actionUnit.text,
    );
    return fixture;
  });
  const plan = await planner.plan(productInput);

  assert.equal(plan.generationSegmentCount, 2);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [15, 15]);
  const visualUnits = received?.sourceEvidence.sourceUnits
    .filter((unit) => !globalFacts.includes(unit.text)) ?? [];
  assert.equal(visualUnits.length, 1);
  assert.equal(plan.beats.length, actions.length);
  assert.deepEqual(
    plan.beats.map((beat) => actions.find((action) => beat.summary.includes(action))),
    actions,
  );
  for (const action of actions) {
    assert.equal(plan.beats.filter((beat) => beat.summary.includes(action)).length, 1);
    assert.equal(plan.shotSpecs.flatMap((shot) => shot.motionPlan.motion_beats)
      .filter((beat) => beat.source_description.includes(action)).length, 1);
  }
  assert.ok(plan.shotSpecs.every((shot) => shot.narrativeBeatSequences.length > 0));
  const sharedLocks = plan.shotSpecs.map((shot) => shot.motionPlan.character_locks.join("|"));
  for (const globalFact of globalFacts) {
    assert.ok(sharedLocks.every((locks) => locks.includes(globalFact)));
  }
  assert.ok(plan.beats.every((beat) => !globalFacts.some((fact) => beat.summary.includes(fact))));
  assert.ok(plan.shotSpecs.every((shot) => !shot.motionPlan.motion_beats.some((beat) =>
    globalFacts.some((fact) => beat.source_description.includes(fact)))));
  assert.ok(plan.shotSpecs.every((shot) => shot.visualPrompt && !shot.visualPrompt.includes(productInput.sourceText)));
});

test("director ownership maps Huobao shot and atmosphere, Seedance phases, and OpenMontage sections", async () => {
  const sourceText = [
    "Global: @anchor:global-look bright, clean photographic look.",
    "Throughout: @anchor:continuity keep the same product identity.",
    "atmosphere: @anchor:atmosphere quiet room tone and soft daylight.",
    "timestamp script:",
    "0-3s: @anchor:opening consultant walks toward the panel.",
    "3-6s: @anchor:close-up the panel opens and holds.",
    "Section 1:",
    "【镜头1】@anchor:section consultant checks the panel.",
    "【镜头2】@anchor:section-close product holds in frame.",
  ].join("\r\n");
  let received: LlmFreeformPlanningContext | undefined;
  const plan = await new LlmFreeformPromptPlanningModel(async (context) => {
    received = context;
    const globalSequences = context.sourceEvidence.sourceUnits
      .filter((unit) => /^(?:Global|Throughout|atmosphere):/u.test(unit.text))
      .map((unit) => unit.sequence);
    return toDirectorFixture(context, globalSequences);
  }).plan({
    sourceText,
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });

  const globalTexts = received?.sourceEvidence.sourceUnits
    .filter((unit) => /^(?:Global|Throughout|atmosphere):/u.test(unit.text))
    .map((unit) => unit.text) ?? [];
  const visualTexts = received?.sourceEvidence.sourceUnits
    .filter((unit) => !globalTexts.includes(unit.text))
    .map((unit) => unit.text) ?? [];
  assert.ok(globalTexts.length >= 3);
  assert.deepEqual(plan.beats.map((beat) => beat.summary), visualTexts);
  assert.ok(plan.beats.every((beat) => !globalTexts.some((text) => beat.summary.includes(text))));
  assert.ok(plan.beats.some((beat) => beat.summary.includes("@anchor:opening")));
  assert.ok(plan.beats.some((beat) => beat.summary.includes("@anchor:section-close")));
  const locks = plan.shotSpecs[0]!.motionPlan.character_locks.join("|");
  assert.ok(globalTexts.every((text) => locks.includes(text)));
});

test("freeform planner preserves reference policy and anchor order from the deterministic skeleton", async () => {
  const referenceInput: PlanningInput = {
    ...input,
    sourceAssetIds: ["asset-scene", "asset-subject"],
    sourceShotBindings: {
      1: { referenceAnchors: ["subject-anchor", "scene-anchor"] },
      2: { referenceAnchors: ["scene-anchor", "subject-anchor"] },
    },
  };
  let received: LlmFreeformPlanningContext | undefined;
  const plan = await new LlmFreeformPromptPlanningModel(async (context) => {
    received = context;
    return toDirectorFixture(context);
  }).plan(referenceInput);

  assert.deepEqual(
    received?.segments.map((segment) => segment.referencePolicy),
    plan.shotSpecs.map((shot) => shot.referencePolicy),
  );
  assert.deepEqual(
    received?.segments.map((segment) => [...segment.referenceAnchors]),
    [["subject-anchor", "scene-anchor"], ["scene-anchor", "subject-anchor"]],
  );
  assert.deepEqual(
    plan.shotSpecs.map((shot) => [...(shot.referenceAnchors ?? [])]),
    [["subject-anchor", "scene-anchor"], ["scene-anchor", "subject-anchor"]],
  );
});

test("freeform planner fails closed instead of fabricating source ownership for a duration-only trailing segment", async () => {
  await assert.rejects(
    () => new LlmFreeformPromptPlanningModel((context) => toDirectorFixture(context)).plan({
      sourceText: "人物完成一个连续动作并在结尾停稳。",
      targetDurationSeconds: 30,
      stylePreferences: "纪实",
      sourceAssetIds: [],
    }),
    (error: unknown) => error instanceof LlmSemanticPlanningError
      && error.code === "LLM_SOURCE_COVERAGE_INVALID"
      && error.message.includes("empty motion source sequence"),
  );
});

test("freeform planner preserves Chinese source spans and rejects a split surrogate pair", async () => {
  const unicodeInput: PlanningInput = {
    sourceText: "中文😀动作继续。",
    targetDurationSeconds: 8,
    stylePreferences: "自然",
    sourceAssetIds: [],
  };
  const validPlan = await new LlmFreeformPromptPlanningModel((context) => toDirectorFixture(context)).plan(unicodeInput);
  assert.equal(validPlan.beats[0]?.summary, unicodeInput.sourceText);

  await assert.rejects(
    () => new LlmFreeformPromptPlanningModel((context) => {
      const fixture = toDirectorFixture(context);
      const entry = fixture.source_ownership.find((candidate) => candidate.role === "VISUAL");
      if (!entry || entry.role !== "VISUAL") throw new Error("The unicode fixture must have a visual owner.");
      const emojiStart = context.sourceEvidence.sourceUnits[0]!.text.indexOf("😀");
      entry.source_spans = [
        { start: 0, end: emojiStart + 1, segment_sequence: 1 },
        { start: emojiStart + 1, end: context.sourceEvidence.sourceUnits[0]!.text.length, segment_sequence: 1 },
      ];
      return fixture;
    }).plan(unicodeInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError
      && error.code === "LLM_SOURCE_COVERAGE_INVALID",
  );
});

test("freeform planner rejects malformed ownership envelopes without deterministic fallback", async () => {
  type DirectorFixture = ReturnType<typeof toDirectorFixture>;
  const cases: Array<{ name: string; mutate: (fixture: DirectorFixture) => unknown; code: string }> = [
    {
      name: "missing source ownership",
      mutate: (fixture) => ({ segments: fixture.segments }),
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "unknown role",
      mutate: (fixture) => {
        (fixture.source_ownership[0] as Record<string, unknown>).role = "UNKNOWN";
        return fixture;
      },
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "missing source unit",
      mutate: (fixture) => ({ ...fixture, source_ownership: fixture.source_ownership.slice(1) }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "duplicate source unit",
      mutate: (fixture) => ({ ...fixture, source_ownership: [...fixture.source_ownership, fixture.source_ownership[0]] }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "reordered source units",
      mutate: (fixture) => ({ ...fixture, source_ownership: [...fixture.source_ownership].reverse() }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "fabricated source unit",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry, index) => index === 0
          ? { ...entry, source_unit_sequence: 99 }
          : entry),
      }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "global with a segment owner",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry, index) => index === 0
          ? { source_unit_sequence: entry.source_unit_sequence, role: "GLOBAL", segment_sequence: 1 }
          : entry),
      }),
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "pure global source",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry) => ({
          source_unit_sequence: entry.source_unit_sequence,
          role: "GLOBAL" as const,
        })),
      }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "leading empty segment",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry) => ({
          ...entry,
          ...(entry.role === "VISUAL"
            ? { source_spans: entry.source_spans.map((span) => ({ ...span, segment_sequence: 2 })) }
            : {}),
        })),
      }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "missing source span",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry, index) => index === 0 && entry.role === "VISUAL"
          ? { ...entry, source_spans: [] }
          : entry),
      }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "source span gap",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry, index) => index === 0 && entry.role === "VISUAL"
          ? { ...entry, source_spans: [{ start: 1, end: entry.source_spans[0]!.end, segment_sequence: 1 }] }
          : entry),
      }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "overlapping source spans",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry, index) => {
          if (index !== 0 || entry.role !== "VISUAL" || entry.source_spans[0]!.end < 2) return entry;
          const midpoint = entry.source_spans[0]!.end - 1;
          return {
            ...entry,
            source_spans: [
              { start: 0, end: midpoint, segment_sequence: 1 },
              { start: midpoint - 1, end: entry.source_spans[0]!.end, segment_sequence: 1 },
            ],
          };
        }),
      }),
      code: "LLM_SOURCE_COVERAGE_INVALID",
    },
    {
      name: "unknown nested source span key",
      mutate: (fixture) => ({
        ...fixture,
        source_ownership: fixture.source_ownership.map((entry, index) => index === 0 && entry.role === "VISUAL"
          ? {
            ...entry,
            source_spans: entry.source_spans.map((span) => ({ ...span, text: "fabricated" })),
          }
          : entry),
      }),
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "missing segment",
      mutate: (fixture) => ({ ...fixture, segments: fixture.segments.slice(0, -1) }),
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "reordered segments",
      mutate: (fixture) => ({ ...fixture, segments: [...fixture.segments].reverse() }),
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "blank prompt",
      mutate: (fixture) => ({
        ...fixture,
        segments: fixture.segments.map((segment, index) => index === 0 ? { ...segment, visual_prompt: "   " } : segment),
      }),
      code: "LLM_PLANNER_MALFORMED",
    },
    {
      name: "extra segment key",
      mutate: (fixture) => ({
        ...fixture,
        segments: fixture.segments.map((segment, index) => index === 0 ? { ...segment, extra: true } : segment),
      }),
      code: "LLM_PLANNER_MALFORMED",
    },
  ];
  for (const current of cases) {
    await assert.rejects(
      () => new LlmFreeformPromptPlanningModel((context) => {
        const fixture = structuredClone(toDirectorFixture(context)) as ReturnType<typeof toDirectorFixture>;
        return current.mutate(fixture);
      }).plan(input),
      (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === current.code,
    );
  }
  await assert.rejects(
    () => new LlmFreeformPromptPlanningModel(() => { throw new Error("offline"); }).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_UNAVAILABLE",
  );
});

test("freeform planner blocks a visual prompt that repeats authored dialogue", async () => {
  const dialogueInput: PlanningInput = {
    ...input,
    sourceText: "林岚走进工厂。林岚说：“必须逐字保留。”",
    targetDurationSeconds: 8,
  };
  const skeleton = await new DeterministicPlanningModel().plan(dialogueInput);
  const authoredLine = skeleton.shotSpecs.flatMap((shot) => shot.dialogueLines)[0];
  assert.ok(authoredLine);
  await assert.rejects(
    () => new LlmFreeformPromptPlanningModel((context) => {
      const fixture = toDirectorFixture(context);
      fixture.segments[0]!.visual_prompt = `人物说：${authoredLine}`;
      return fixture;
    }).plan(dialogueInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
});

test("freeform planner blocks source-wide or foreign-segment prose in a visual supplement", async () => {
  const sourceWide = await assert.rejects(
    () => new LlmFreeformPromptPlanningModel(async (context) => {
      const fixture = toDirectorFixture(context);
      fixture.segments[0]!.visual_prompt = `本段补充：${context.sourceText}`;
      return fixture;
    }).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
  assert.equal(sourceWide, undefined);

  const foreignProjection = await assert.rejects(
    () => new LlmFreeformPromptPlanningModel(async (context) => {
      const fixture = toDirectorFixture(context);
      const foreignUnit = context.sourceEvidence.sourceUnits.find((unit) => unit.sequence !== 1);
      fixture.segments[0]!.visual_prompt = foreignUnit
        ? `本段画面补充：${foreignUnit.text}`
        : "只描述本段的画面动作。";
      return fixture;
    }).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
  assert.equal(foreignProjection, undefined);
});

test("freeform planner reports an injected client timeout as unavailable", async () => {
  await assert.rejects(
    () => new LlmFreeformPromptPlanningModel(
      () => new Promise<never>(() => {}),
      { timeoutMs: 5 },
    ).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_UNAVAILABLE",
  );
});
