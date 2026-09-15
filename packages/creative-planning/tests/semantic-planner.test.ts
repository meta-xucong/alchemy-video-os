import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeterministicPlanningModel,
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
  let context: { segmentCount: number; segments: readonly { sequence: number; targetDurationSeconds: number; sourceNarrativeProjection: string; dialogueLines: readonly string[]; referencePolicy: string; referenceAnchors: readonly string[] }[] } | undefined;
  const planner = new LlmFreeformPromptPlanningModel(async (received) => {
    context = received;
    return {
      segments: received.segments.map((segment) => ({
        sequence: segment.sequence,
        visual_prompt: `自由画面 ${segment.sequence}`,
      })),
    };
  });
  const plan = await planner.plan(input);

  assert.equal(context?.segmentCount, plan.shotSpecs.length);
  assert.deepEqual(context?.segments.map((segment) => segment.sequence), plan.shotSpecs.map((shot) => shot.sequence));
  assert.deepEqual(context?.segments.map((segment) => segment.targetDurationSeconds), plan.shotSpecs.map((shot) => shot.durationSeconds));
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.visualPrompt), plan.shotSpecs.map((_shot, index) => `自由画面 ${index + 1}`));
  assert.deepEqual(context?.segments.map((segment) => segment.dialogueLines), plan.shotSpecs.map((shot) => shot.dialogueLines));
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
    return {
      segments: context.segments.map((segment) => ({
        sequence: segment.sequence,
        visual_prompt: `自由画面 ${segment.sequence}`,
      })),
    };
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

test("freeform planner rejects malformed segment envelopes without deterministic fallback", async () => {
  const draft = await new DeterministicPlanningModel().plan(input);
  const cases: unknown[] = [
    { segments: draft.shotSpecs.slice(0, -1).map((shot) => ({ sequence: shot.sequence, visual_prompt: "画面" })) },
    { segments: draft.shotSpecs.map((shot) => ({ sequence: shot.sequence + 1, visual_prompt: "画面" })) },
    { segments: [...draft.shotSpecs].reverse().map((shot) => ({ sequence: shot.sequence, visual_prompt: "画面" })) },
    { segments: draft.shotSpecs.map((shot) => ({ sequence: shot.sequence, visual_prompt: "   " })) },
    { segments: draft.shotSpecs.map((shot) => ({ sequence: shot.sequence, visual_prompt: "画面", extra: true })) },
  ];
  for (const result of cases) {
    await assert.rejects(
      () => new LlmFreeformPromptPlanningModel(() => result).plan(input),
      (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
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
    () => new LlmFreeformPromptPlanningModel(() => ({
      segments: skeleton.shotSpecs.map((shot, index) => ({
        sequence: shot.sequence,
        visual_prompt: index === 0 ? `人物说：${authoredLine}` : "只写画面动作",
      })),
    })).plan(dialogueInput),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
});

test("freeform planner blocks source-wide or foreign-segment prose in a visual supplement", async () => {
  const sourceWide = await assert.rejects(
    () => new LlmFreeformPromptPlanningModel(async (context) => ({
      segments: context.segments.map((segment) => ({
        sequence: segment.sequence,
        visual_prompt: `${segment.sequence === 1 ? "本段补充" : "继续"}：${context.sourceText}`,
      })),
    })).plan(input),
    (error: unknown) => error instanceof LlmSemanticPlanningError && error.code === "LLM_PLANNER_MALFORMED",
  );
  assert.equal(sourceWide, undefined);

  const foreignProjection = await assert.rejects(
    () => new LlmFreeformPromptPlanningModel(async (context) => ({
      segments: context.segments.map((segment, index) => ({
        sequence: segment.sequence,
        visual_prompt: index === 0 && context.segments[1]
          ? `本段画面补充：${context.segments[1].sourceNarrativeProjection}`
          : "只描述本段的画面动作。",
      })),
    })).plan(input),
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
