import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicPlanningModel,
  LlmFreeformPromptPlanningModel,
  LlmSemanticPlanningError,
  type LlmFreeformPlanningContext,
  type PlanningInput,
} from "@alchemy-video/creative-planning";

const input: PlanningInput = {
  sourceText: [
    "夜幕下，团队在办公室完成交付。",
    "口播文案：”保障要逐字写清。\n每一项都要有人负责。”",
    "视频生成意图描述",
    "镜头最后停在桌面上的成品与窗外的晨光。",
  ].join("\n"),
  targetDurationSeconds: 30,
  durationPolicy: { minDurationSeconds: 8, maxDurationSeconds: 15 },
  stylePreferences: "克制的纪实感",
  sourceAssetIds: ["ast_subject", "ast_scene"],
  sourceShotBindings: {
    1: { referenceAnchors: ["@subject", "@scene"] },
  },
};

const validDecisions = [
  { duration_seconds: 15, visual_prompt: "人物整理桌面文件，动作完成后停在明确终点。", dialogue_line_sequences: [1] },
  { duration_seconds: 15, visual_prompt: "晨光照亮桌面成品，镜头平稳收束。", dialogue_line_sequences: [2] },
];

const planner = (
  respond: (context: LlmFreeformPlanningContext) => unknown | Promise<unknown>,
  received: LlmFreeformPlanningContext[] = [],
) => ({
  model: new LlmFreeformPromptPlanningModel(async (context) => {
    received.push(context);
    return respond(context);
  }),
  received,
});

const errorCode = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof LlmSemanticPlanningError);
    return error.code;
  }
  assert.fail("expected the planner to fail closed");
};

test("LLM decides segment count, duration and ordered dialogue ownership", async () => {
  const { model, received } = planner(() => validDecisions);
  const draft = await model.plan(input);

  assert.equal(received.length, 1);
  assert.equal(received[0]!.sourceText, input.sourceText);
  assert.deepEqual(received[0]!.durationBounds, { minDurationSeconds: 8, maxDurationSeconds: 15 });
  assert.equal("segmentCount" in received[0]!, false);
  assert.equal("segments" in received[0]!, false);
  assert.deepEqual(received[0]!.dialogueLines.map((line) => line.replace(/^\n/u, "")), ["保障要逐字写清。", "每一项都要有人负责。"]);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.durationSeconds), [15, 15]);
  assert.equal(draft.shotSpecs[0]!.dialogueLines[0], "保障要逐字写清。");
  assert.equal(draft.shotSpecs[1]!.dialogueLines[0]?.replace(/^\n/u, ""), "每一项都要有人负责。");
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.visualPrompt), validDecisions.map((item) => item.visual_prompt));
  assert.deepEqual(draft.shotSpecs.flatMap((shot) => shot.narrativeBeatSequences), [1, 2]);
});

test("dialogue-free visual segments keep their natural-language goal without duplicate visual injection", async () => {
  const visualInput: PlanningInput = {
    ...input,
    sourceText: "办公室灯光亮起，桌面上的文件整齐摆放。镜头缓慢移向窗外的晨光。",
    targetDurationSeconds: 16,
    sourceAssetIds: [],
  };
  const decisions = [
    { duration_seconds: 8, visual_prompt: "办公室灯光亮起，文件保持整齐。", dialogue_line_sequences: [] },
    { duration_seconds: 8, visual_prompt: "镜头移向窗外的晨光并停稳。", dialogue_line_sequences: [] },
  ];
  const draft = await new LlmFreeformPromptPlanningModel(() => decisions).plan(visualInput);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.dialogueLines), [[], []]);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.visualPrompt), [undefined, undefined]);
  assert.ok(draft.shotSpecs[0]!.narrativeGoal.includes("办公室灯光亮起"));
  assert.equal(draft.generationSegmentCount, 2);
});

test("minimumSegments is passed to the director and enforced without mechanical fallback", async () => {
  const received: LlmFreeformPlanningContext[] = [];
  const { model } = planner(() => [validDecisions[0]!], received);
  const retryInput = { ...input, minimumGenerationSegmentCount: 2 };
  assert.equal(await errorCode(() => model.plan(retryInput)), "LLM_PLANNER_MALFORMED");
  assert.equal(received[0]!.minimumSegments, 2);
});

test("exact three-key response and duration sum are required", async () => {
  const cases: unknown[] = [
    { duration_seconds: 15, visual_prompt: "对象", dialogue_line_sequences: [] },
    [{ duration_seconds: 15, visual_prompt: "第一段", dialogue_line_sequences: [1], extra: true }, validDecisions[1]],
    [{ duration_seconds: 15, visual_prompt: "第一段", dialogue_line_sequences: [1] }, { duration_seconds: 14, visual_prompt: "第二段", dialogue_line_sequences: [2] }],
    [{ duration_seconds: 7, visual_prompt: "太短", dialogue_line_sequences: [1] }, { duration_seconds: 23, visual_prompt: "太长", dialogue_line_sequences: [2] }],
  ];
  for (const value of cases) {
    assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => value).plan(input)), "LLM_PLANNER_MALFORMED");
  }
});

test("dialogue references must be one-based, complete, unique and source ordered", async () => {
  for (const [firstReferences, secondReferences] of [
    [[2], [1]],
    [[1], [1]],
    [[1], []],
    [[0], [2]],
  ] as const) {
    const value = [
      { duration_seconds: 15, visual_prompt: "第一段画面。", dialogue_line_sequences: firstReferences },
      { duration_seconds: 15, visual_prompt: "第二段画面。", dialogue_line_sequences: secondReferences },
    ];
    assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => value).plan(input)), "LLM_PLANNER_MALFORMED");
  }
});

test("visual prompt cannot copy authored dialogue or the complete source", async () => {
  const repeatsDialogue = [
    { duration_seconds: 15, visual_prompt: "人物说：保障要逐字写清。", dialogue_line_sequences: [1] },
    { duration_seconds: 15, visual_prompt: "晨光照亮桌面。", dialogue_line_sequences: [2] },
  ];
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => repeatsDialogue).plan(input)), "LLM_PLANNER_MALFORMED");

  const noDialogueInput: PlanningInput = {
    ...input,
    sourceText: "办公室灯光亮起，桌面上的文件整齐摆放。",
    targetDurationSeconds: 15,
    sourceAssetIds: [],
  };
  const sourceEcho = [{ duration_seconds: 15, visual_prompt: noDialogueInput.sourceText, dialogue_line_sequences: [] }];
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => sourceEcho).plan(noDialogueInput)), "LLM_PLANNER_MALFORMED");
});

test("a segment fails when its assigned speech cannot fit its duration", async () => {
  const longLineInput: PlanningInput = {
    ...input,
    sourceText: `口播文案：\"${"这是需要完整播出的长文案。".repeat(12)}\"`,
    targetDurationSeconds: 30,
    sourceAssetIds: [],
  };
  const decisions = [
    { duration_seconds: 15, visual_prompt: "人物在画面中保持稳定表演。", dialogue_line_sequences: [1] },
    { duration_seconds: 15, visual_prompt: "画面停在收束状态。", dialogue_line_sequences: [] },
  ];
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => decisions).plan(longLineInput)), "LLM_PLANNER_MALFORMED");
});

test("malformed, unavailable, timeout and old string responses fail closed", async () => {
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => []).plan(input)), "LLM_PLANNER_MALFORMED");
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => ["第一段", "第二段"]).plan(input)), "LLM_PLANNER_MALFORMED");
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => { throw new Error("offline"); }).plan(input)), "LLM_PLANNER_UNAVAILABLE");
  assert.equal(await errorCode(() => new LlmFreeformPromptPlanningModel(() => new Promise<never>(() => {}), { timeoutMs: 5 }).plan(input)), "LLM_PLANNER_UNAVAILABLE");
});

test("complete long source is passed intact and no legacy ownership envelope is introduced", async () => {
  const longSource = `${"同一场景中的连续动作，保持人物与光线一致。\n".repeat(80)}SOURCE_TAIL_KEEP`;
  let received: LlmFreeformPlanningContext | undefined;
  const longInput: PlanningInput = { ...input, sourceText: longSource, sourceAssetIds: [] };
  await new LlmFreeformPromptPlanningModel(async (context) => {
    received = context;
    return [{ duration_seconds: 15, visual_prompt: "人物保持动作连续并停稳。", dialogue_line_sequences: [] }, { duration_seconds: 15, visual_prompt: "光线保持一致并收束。", dialogue_line_sequences: [] }];
  }).plan(longInput);
  assert.equal(received?.sourceText, longSource);
  assert.ok(received?.sourceText.endsWith("SOURCE_TAIL_KEEP"));
  assert.equal("sourceEvidence" in (received ?? {}), false);
  assert.equal("source_ownership" in (received ?? {}), false);
  assert.equal("source_spans" in (received ?? {}), false);
});

test("an active provider policy is carried without forcing the default eight-second floor", async () => {
  const shortInput: PlanningInput = {
    ...input,
    sourceText: "一个人物在窗边停下。",
    targetDurationSeconds: 6,
    durationPolicy: { minDurationSeconds: 1, maxDurationSeconds: 15 },
    sourceAssetIds: [],
  };
  const draft = await new LlmFreeformPromptPlanningModel(() => [
    { duration_seconds: 6, visual_prompt: "人物在窗边停下并保持稳定构图。", dialogue_line_sequences: [] },
  ]).plan(shortInput);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.durationSeconds), [6]);
});

test("LLM may choose more legal segments than the provider minimum when the source calls for it", async () => {
  const segmentedInput: PlanningInput = {
    ...input,
    sourceText: "开场建立空间。触发动作发生。高潮动作完成。",
    targetDurationSeconds: 24,
    sourceAssetIds: [],
    minimumGenerationSegmentCount: 2,
  };
  const draft = await new LlmFreeformPromptPlanningModel(() => [
    { duration_seconds: 8, visual_prompt: "开场建立空间并停稳。", dialogue_line_sequences: [] },
    { duration_seconds: 8, visual_prompt: "触发动作发生并推进。", dialogue_line_sequences: [] },
    { duration_seconds: 8, visual_prompt: "高潮动作完成并收束。", dialogue_line_sequences: [] },
  ]).plan(segmentedInput);
  assert.equal(draft.generationSegmentCount, 3);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.durationSeconds), [8, 8, 8]);
});

test("mock mode retains the deterministic planner as its separate fixture path", async () => {
  const draft = await new DeterministicPlanningModel().plan({ ...input, sourceAssetIds: [] });
  assert.ok(draft.generationSegmentCount >= 1);
  assert.ok(draft.shotSpecs.every((shot) => shot.visualPrompt === undefined));
});
