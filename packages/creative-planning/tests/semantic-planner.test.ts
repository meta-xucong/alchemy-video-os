import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicPlanningModel,
  DeterministicStoryboardCompiler,
  LlmFreeformPromptPlanningModel,
  LlmSemanticPlanningError,
  type LlmFreeformPlanningContext,
  type PlanningInput,
} from "../src/mock.js";

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
  assert.deepEqual(draft.shotSpecs[0]!.referenceAnchors, ["@subject", "@scene"]);
  assert.deepEqual(draft.shotSpecs[0]!.motionPlan.motion_beats[0]!.reference_anchors, ["@subject", "@scene"]);
  assert.ok(draft.shotSpecs.every((shot) => !("voicePerformance" in shot)));
  assert.ok(draft.shotSpecs.every((shot) => !("dialogue_duration_seconds" in shot.motionPlan)));
  assert.ok(draft.shotSpecs.every((shot) => !("voice_performance" in shot.motionPlan)));
  assert.equal(draft.title, "故事计划");
  assert.equal(draft.summary, "共 2 个叙事点，自动合并为 2 个生成片段，总时长 30 秒。");
  assert.equal(draft.shotSpecs[0]!.title, "生成片段 1");
  assert.equal(draft.shotSpecs[0]!.continuityNote, "按分段顺序衔接，不承诺帧级无缝。");
  assert.doesNotMatch(JSON.stringify(draft), /__MOCK_UNSPECIFIED_(?:TITLE|LLM_PLAN_TITLE|LLM_PLAN_SUMMARY)/u);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.dependsOnSequences), [[], [1]]);
});

test("optional source-aligned bgm_prompt is preserved without entering visual or dialogue fields", async () => {
  const decisions = [
    { duration_seconds: 15, visual_prompt: "人物在晨光中整理桌面并停稳。", dialogue_line_sequences: [1], bgm_prompt: "温暖克制的钢琴与轻柔弦乐" },
    { duration_seconds: 15, visual_prompt: "成品在窗边光线中收束。", dialogue_line_sequences: [2] },
  ];
  const draft = await new LlmFreeformPromptPlanningModel(() => decisions).plan(input);
  assert.equal(draft.shotSpecs[0]!.bgmPrompt, decisions[0]!.bgm_prompt);
  assert.equal(draft.shotSpecs[1]!.bgmPrompt, undefined);
  assert.equal(draft.shotSpecs[0]!.visualPrompt, decisions[0]!.visual_prompt);
  assert.deepEqual(draft.shotSpecs[0]!.dialogueLines, ["保障要逐字写清。"]);
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

test("same-scene subshots remain one complete LLM storyboard/provider segment", async () => {
  const visualPrompt = "同一办公室场景内依次呈现三个子镜头：人物将文件放到桌面（约4秒），镜头切到手部整理文件（约3秒），再切回人物确认交付并停稳（约5秒）。";
  const draft = await new LlmFreeformPromptPlanningModel(() => [{
    duration_seconds: 12,
    visual_prompt: visualPrompt,
    dialogue_line_sequences: [],
  }]).plan({
    ...input,
    sourceText: "同一办公室内，人物整理文件并确认交付。",
    targetDurationSeconds: 12,
    sourceAssetIds: ["ast_office"],
    sourceShotBindings: { 1: { sceneId: "office", referenceAnchors: ["@office"] } },
  });

  assert.equal(draft.generationSegmentCount, 1);
  assert.equal(draft.shotSpecs.length, 1);
  assert.equal(draft.shotSpecs[0]!.durationSeconds, 12);
  assert.equal(draft.shotSpecs[0]!.narrativeGoal, visualPrompt);
  assert.equal(draft.shotSpecs[0]!.motionPlan.motion_beats.length, 1);
  assert.equal(draft.shotSpecs[0]!.motionPlan.motion_beats[0]!.action, visualPrompt);
  assert.equal(draft.shotSpecs[0]!.referencePolicy, "REFERENCE_SET");
});

test("source-bound explicit scene change refreshes only its mapped LLM destination segment", async () => {
  const decisions = [
    { duration_seconds: 10, visual_prompt: "人物在办公室完成交付准备并停稳。", dialogue_line_sequences: [] },
    { duration_seconds: 10, visual_prompt: "人物在仓库新场景中检查成品并停稳。", dialogue_line_sequences: [] },
    { duration_seconds: 10, visual_prompt: "人物继续在仓库核对清单并停稳。", dialogue_line_sequences: [] },
  ];
  const draft = await new LlmFreeformPromptPlanningModel(() => decisions).plan({
    ...input,
    sourceText: "人物在办公室准备交付。随后画面切至仓库检查成品，并继续核对清单。",
    targetDurationSeconds: 30,
    sourceAssetIds: ["ast_scene"],
    sourceShotBindings: {
      1: { sceneId: "office" },
      2: { sceneId: "warehouse" },
      3: { sceneId: "warehouse" },
    },
  });

  assert.deepEqual(draft.shotSpecs.map((shot) => shot.referencePolicy), ["REFERENCE_SET", "REFERENCE_SET", "HANDOFF_FIRST_FRAME"]);
});

test("explicit source scene change without verifiable scene bindings fails closed in the LLM path", async () => {
  const decisions = [
    { duration_seconds: 10, visual_prompt: "人物在办公室整理文件并停稳。", dialogue_line_sequences: [] },
    { duration_seconds: 10, visual_prompt: "画面切至仓库新场景，人物检查成品并停稳。", dialogue_line_sequences: [] },
  ];
  assert.equal(
    await errorCode(() => new LlmFreeformPromptPlanningModel(() => decisions).plan({
      ...input,
      sourceText: "人物在办公室整理文件。随后画面切至仓库检查成品。",
      targetDurationSeconds: 20,
      sourceAssetIds: ["ast_office"],
      sourceShotBindings: undefined,
    })),
    "LLM_PLANNER_MALFORMED",
  );
});

test("source without an explicit scene change keeps LLM handoff when scene bindings are absent", async () => {
  const decisions = [
    { duration_seconds: 10, visual_prompt: "人物在办公室整理文件并停稳。", dialogue_line_sequences: [] },
    { duration_seconds: 10, visual_prompt: "镜头切换到手部特写，人物继续整理同一份文件并停稳。", dialogue_line_sequences: [] },
  ];
  const draft = await new LlmFreeformPromptPlanningModel(() => decisions).plan({
    ...input,
    sourceText: "同一间办公室里，人物整理文件并确认交付。",
    targetDurationSeconds: 20,
    sourceAssetIds: ["ast_office"],
    sourceShotBindings: undefined,
  });

  assert.deepEqual(draft.shotSpecs.map((shot) => shot.referencePolicy), ["REFERENCE_SET", "HANDOFF_FIRST_FRAME"]);
});

test("same-scene LLM hard cuts with bound scene continuity remain HANDOFF_FIRST_FRAME", async () => {
  const decisions = [
    { duration_seconds: 10, visual_prompt: "人物在办公室整理文件并停稳。", dialogue_line_sequences: [] },
    { duration_seconds: 10, visual_prompt: "镜头切换到手部特写，人物继续整理同一份文件并停稳。", dialogue_line_sequences: [] },
  ];
  const draft = await new LlmFreeformPromptPlanningModel(() => decisions).plan({
    ...input,
    sourceText: "同一间办公室里，人物整理文件并确认交付。",
    targetDurationSeconds: 20,
    sourceAssetIds: ["ast_office"],
    sourceShotBindings: {
      1: { sceneId: "office" },
      2: { sceneId: "office" },
    },
  });

  assert.deepEqual(draft.shotSpecs.map((shot) => shot.referencePolicy), ["REFERENCE_SET", "HANDOFF_FIRST_FRAME"]);
});

test("LLM visual_prompt remains complete in its segment-local natural-language fields", async () => {
  const longVisualPrompt = "连续视觉描述，保持局部动作和明确终点。".repeat(20);
  const draft = await new LlmFreeformPromptPlanningModel(() => [{
    duration_seconds: 15,
    visual_prompt: longVisualPrompt,
    dialogue_line_sequences: [],
  }]).plan({
    ...input,
    sourceText: "一个人物在单一场景中完成连续动作。",
    targetDurationSeconds: 15,
    sourceAssetIds: [],
  });
  const shot = draft.shotSpecs[0]!;
  assert.equal(shot.narrativeGoal, longVisualPrompt);
  assert.equal(shot.motionPlan.motion_beats[0]!.action, longVisualPrompt);
  assert.equal(shot.motionPlan.motion_beats[0]!.source_description, longVisualPrompt);
});

test("real LLM segments compile without platform-owned prompt placeholders", async () => {
  const draft = await new LlmFreeformPromptPlanningModel(() => validDecisions).plan(input);
  const compiler = new DeterministicStoryboardCompiler();
  for (const [index, shot] of draft.shotSpecs.entries()) {
    const compiled = await compiler.compile({
      ...shot,
      stylePreferences: input.stylePreferences,
      generationSegmentSequence: index + 1,
      generationSegmentCount: draft.generationSegmentCount,
      motionPlan: shot.motionPlan,
      motionPlanHash: shot.motionPlanHash,
      cameraShot: shot.cameraShot,
      dialogueLines: shot.dialogueLines,
      visualPrompt: shot.visualPrompt,
    });
    const generatedPromptParts = compiled.capabilitySnapshot.generated_prompt_parts;
    assert.doesNotMatch(compiled.prompt, /__MOCK_UNSPECIFIED_/u);
    assert.doesNotMatch(JSON.stringify(compiled.capabilitySnapshot), /__MOCK_UNSPECIFIED_/u);
    assert.doesNotMatch(JSON.stringify(compiled.visualConstraints), /__MOCK_UNSPECIFIED_/u);
    assert.ok(Array.isArray(generatedPromptParts));
    if (!Array.isArray(generatedPromptParts)) continue;
    assert.ok(generatedPromptParts.every((part) => typeof part === "string"));
    assert.ok(generatedPromptParts.every((part) => !part.includes("__MOCK_UNSPECIFIED_")));
    assert.equal(
      [compiled.capabilitySnapshot.source_prompt, ...generatedPromptParts].join(" "),
      compiled.prompt,
    );
  }
});

test("LLM storyboard boundary defaults stay out of provider prose while authored wording remains", async () => {
  const visualPrompt = "涂抹护肤霜后，泛红逐渐减轻，终点是更均匀平整的肌肤。";
  const draft = await new LlmFreeformPromptPlanningModel(() => [{
    duration_seconds: 15,
    visual_prompt: visualPrompt,
    dialogue_line_sequences: [],
  }]).plan({
    ...input,
    sourceText: "本段开始时先展示泛红肌肤，涂抹后泛红逐渐减轻，本段结束时肌肤更均匀平整。",
    targetDurationSeconds: 15,
    sourceAssetIds: [],
  });
  const shot = draft.shotSpecs[0]!;
  const compiled = await new DeterministicStoryboardCompiler().compile({
    ...shot,
    narrativeGoal: "用户明确要求本段开始时展示泛红肌肤，本段结束时展示均匀平整的肌肤。",
    generationSegmentSequence: 1,
    generationSegmentCount: 1,
    stylePreferences: input.stylePreferences,
    visualPrompt,
    motionPlan: shot.motionPlan,
    motionPlanHash: shot.motionPlanHash,
    cameraShot: shot.cameraShot,
  });
  assert.match(compiled.prompt, /涂抹护肤霜后，泛红逐渐减轻/);
  assert.match(compiled.prompt, /更均匀平整的肌肤/);
  assert.doesNotMatch(compiled.prompt, /Begin with: 本段开始/u);
  assert.doesNotMatch(compiled.prompt, /End with: 本段结束/u);
  assert.doesNotMatch(compiled.prompt, /Transition: 按分段顺序承接/u);
  assert.match(compiled.capabilitySnapshot.source_prompt, /本段开始时/);
  assert.match(compiled.capabilitySnapshot.source_prompt, /本段结束时/);
});

test("LLM planner fails closed when a visual decision contains a platform placeholder", async () => {
  const invalid = [{
    duration_seconds: 15,
    visual_prompt: "__MOCK_UNSPECIFIED_CAMERA_SIZE",
    dialogue_line_sequences: [1],
  }, validDecisions[1]];
  assert.equal(
    await errorCode(() => new LlmFreeformPromptPlanningModel(() => invalid).plan(input)),
    "LLM_PLANNER_MALFORMED",
  );
});

test("LLM dialogue extraction preserves labelled multiline boundaries and the following visual section", async () => {
  const sources = [
    `口播文案：”\n第一句口播。\n第二句继续说明。”\n\n视频生成意图描述\n镜头停在交付现场。`,
    `口播文案："第一句口播。\n第二句继续说明。\n\n视频生成意图描述\n镜头停在交付现场。`,
  ];
  for (const sourceText of sources) {
    let received: LlmFreeformPlanningContext | undefined;
    await new LlmFreeformPromptPlanningModel(async (context) => {
      received = context;
      return [
        { duration_seconds: 15, visual_prompt: "第一段视觉画面。", dialogue_line_sequences: [1] },
        { duration_seconds: 15, visual_prompt: "第二段视觉画面。", dialogue_line_sequences: [2] },
      ];
    }).plan({ ...input, sourceText, sourceAssetIds: [] });
    assert.deepEqual(
      received?.dialogueLines.map((line) => line.replace(/^\n/u, "")),
      ["第一句口播。", "第二句继续说明。"],
    );
    assert.ok(received?.dialogueLines.every((line) => !line.includes("视频生成意图描述")));
  }
});

test("minimumSegments is passed to the director and enforced without mechanical fallback", async () => {
  const received: LlmFreeformPlanningContext[] = [];
  const { model } = planner(() => [validDecisions[0]!], received);
  const retryInput = { ...input, minimumGenerationSegmentCount: 2 };
  assert.equal(await errorCode(() => model.plan(retryInput)), "LLM_PLANNER_MALFORMED");
  assert.equal(received[0]!.minimumSegments, 2);
});

test("required response keys and duration sum are required", async () => {
  const cases: unknown[] = [
    { duration_seconds: 15, visual_prompt: "对象", dialogue_line_sequences: [] },
    [{ duration_seconds: 15, visual_prompt: "第一段", dialogue_line_sequences: [1], extra: true }, validDecisions[1]],
    [{ duration_seconds: 15, visual_prompt: "第一段", dialogue_line_sequences: [1], bgm_prompt: 42 }, validDecisions[1]],
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

test("LLM dialogue ownership does not synthesize local speech timing facts", async () => {
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
  const draft = await new LlmFreeformPromptPlanningModel(() => decisions).plan(longLineInput);
  assert.deepEqual(draft.shotSpecs.map((shot) => shot.durationSeconds), [15, 15]);
  assert.ok(draft.shotSpecs.every((shot) => !("dialogue_duration_seconds" in shot.motionPlan)));
  assert.ok(draft.shotSpecs.every((shot) => !("voice_performance" in shot.motionPlan)));
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
