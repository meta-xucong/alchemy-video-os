import assert from "node:assert/strict";
import test from "node:test";

import {
  DETERMINISTIC_PLANNER_VERSION,
  DeterministicPlanningModel,
  DeterministicStoryboardCompiler,
  auditCameraCoverage,
} from "../src/index.js";
import { checkOpenMontageSceneVariation, scoreOpenMontageSlideshowRisk } from "../src/openmontage-variation-audit.js";
import { GenerationSegmentMotionPlanSchema } from "@alchemy-video/contracts";

test("C11 deterministic planning groups narrative events into an ordered, capability-valid plan", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "林岚赶到工厂，发现交付延误。团队在车间重新安排生产。货车按新计划驶出厂区。",
    targetDurationSeconds: 24,
    stylePreferences: "纪实电影感",
    sourceAssetIds: ["ast_reference"],
  });

  assert.equal(plan.plannerVersion, DETERMINISTIC_PLANNER_VERSION);
  assert.equal(plan.totalDurationSeconds, 24);
  assert.equal(plan.shotSpecs.reduce((total, shot) => total + shot.durationSeconds, 0), 24);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.sequence), [1, 2]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.dependsOnSequences), [[], [1]]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.referencePolicy), ["REFERENCE_SET", "HANDOFF_FIRST_FRAME"]);
  assert.ok(plan.shotSpecs.every((shot) => shot.durationSeconds >= 8 && shot.durationSeconds <= 15));
  assert.equal(plan.continuityLevel, "REVIEW_REQUIRED");
  assert.ok(plan.shotSpecs.every((shot) => {
    const parsed = GenerationSegmentMotionPlanSchema.parse(shot.motionPlan);
    return parsed.motion_beats.length >= 1 && parsed.motion_beats.length <= 4 && shot.motionPlanHash.length === 64;
  }));
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.motionPlan.motion_beats.length), [1, 2]);
  assert.deepEqual(plan.shotSpecs[0]!.motionPlan.motion_beats.map((beat) => [beat.start_seconds, beat.end_seconds]), [[0, 12]]);
});

test("30-second planning follows upstream 8-15s storyboard paragraphs and preserves all quoted dialogue", async () => {
  const planner = new DeterministicPlanningModel();
  const dialogue = "受够城市雾霾尾气，就来茅山温泉・桃李春风。背靠茅山原生山林，富含高浓度负氧离子。推窗尽揽草木清香，漫步竹海，在家坐拥天然氧吧，畅快呼吸，被绿意滋养身心。";
  const plan = await planner.plan({
    sourceText: `主持人面对镜头口播：“${dialogue}”`,
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: ["ast_subject", "ast_scene"],
  });

  assert.ok(plan.shotSpecs.reduce((total, shot) => total + shot.durationSeconds, 0) <= 30);
  assert.ok(plan.shotSpecs.every((shot) => shot.durationSeconds >= 8 && shot.durationSeconds <= 15));
  const assignedDialogue = plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join("");
  assert.equal(assignedDialogue, dialogue);
  assert.ok(plan.shotSpecs.filter((shot) => shot.dialogueLines.length > 0).length >= 1);
  assert.ok(plan.shotSpecs.every((shot) => (shot.motionPlan.dialogue_duration_seconds ?? 0) <= shot.durationSeconds));
  const generatedCues = plan.shotSpecs.flatMap((shot) => shot.motionPlan.voice_performance?.delivery_cues ?? []);
  assert.ok(generatedCues.length > 0);
  assert.ok(generatedCues.every((cue) => cue.provider_text === cue.text));

  const compiled = await Promise.all(plan.shotSpecs.map((shot) => new DeterministicStoryboardCompiler().compile({
    ...shot,
    generationSegmentSequence: shot.sequence,
    generationSegmentCount: plan.generationSegmentCount,
    stylePreferences: "商业宣传片",
  })));
  for (const [index, compiledPrompt] of compiled.entries()) {
    if (plan.shotSpecs[index]!.dialogueLines.length > 0) {
      assert.match(compiledPrompt.prompt, /PLATFORM NARRATION TIMING CONTRACT/);
      assert.match(compiledPrompt.prompt, /post-production/);
    }
    if (plan.shotSpecs[index]!.dialogueLines.length > 0) {
      assert.match(compiledPrompt.prompt, new RegExp(`segment ${index + 1} of ${plan.generationSegmentCount}`));
    } else {
      assert.doesNotMatch(compiledPrompt.prompt, /VOICEOVER CONTINUITY/);
    }
    if (plan.shotSpecs[index]!.dialogueLines.length > 0) assert.match(compiledPrompt.prompt, /SPOKEN CONTENT BOUNDARY/);
  }
  assert.ok(plan.shotSpecs.every((shot) => !shot.narrativeGoal.includes(dialogue)));
  assert.ok(plan.shotSpecs.some((shot) => shot.motionPlan.prop_locks.some((lock) => lock.includes("声明的 narration window 结束后不得新增可听对白或口播"))));
  assert.ok(plan.shotSpecs.some((shot) => shot.motionPlan.prop_locks.some((lock) => lock.includes("窗口内保留与台词对齐的可见口型和说话动作"))));
  assert.ok(plan.shotSpecs.every((shot) => shot.motionPlan.prop_locks.every((lock) => !/禁止.*(?:口型|说话动作)/u.test(lock))));
  assert.ok(plan.shotSpecs.every((shot) => shot.motionPlan.prop_locks.every((lock) => !lock.includes("禁止新增对白、旁白、发声、口型同步或说话动作"))));
  assert.ok(plan.shotSpecs.some((shot) => shot.motionPlan.prop_locks.some((lock) => lock.includes("SILENCE/AMBIENT-ONLY"))));
  assert.ok(compiled[0]!.prompt.indexOf("AUDIO PRIORITY") < compiled[0]!.prompt.indexOf("Begin with:"));
  assert.match(compiled[0]!.prompt, /Do not insert filler words or vocalizations/);
  assert.match(compiled[0]!.prompt, /keep the visible speaking performance/i);
  assert.match(compiled[0]!.prompt, /do not generate audible dialogue/i);
  assert.doesNotMatch(compiled[0]!.prompt, /EXACT SPOKEN AUDIO SCRIPT/);
  assert.match(compiled[1]!.prompt, /PROP CONTINUITY CONTRACT/);
});

test("native provider owner keeps dialogue audible and does not emit platform narration suppression", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "主持人面对镜头口播：“欢迎来到茅山温泉。”",
    targetDurationSeconds: 15,
    stylePreferences: "商业宣传片",
    sourceAssetIds: [],
  });
  const dialogueShot = plan.shotSpecs.find((shot) => shot.dialogueLines.length > 0);
  assert.ok(dialogueShot);
  if (!dialogueShot) return;
  const compiled = await new DeterministicStoryboardCompiler().compile({
    ...dialogueShot,
    generationSegmentSequence: dialogueShot.sequence,
    generationSegmentCount: plan.generationSegmentCount,
    stylePreferences: "商业宣传片",
    audioOwner: "NATIVE_PROVIDER",
  });
  assert.match(compiled.prompt, /欢迎来到茅山温泉/);
  assert.match(compiled.prompt, /AUDIO PRIORITY: spoken dialogue is mandatory/);
  assert.match(compiled.prompt, /EXACT SPOKEN AUDIO SCRIPT/);
  assert.match(compiled.prompt, /speak every character/);
  assert.match(compiled.prompt, /One speaker per clip\. Character says: "欢迎来到茅山温泉。"/);
  assert.match(compiled.prompt, /Character says: "欢迎来到茅山温泉。"/);
  assert.match(compiled.prompt, /keep that speaker visible throughout the spoken performance/);
  assert.match(compiled.prompt, /SPOKEN CONTENT BOUNDARY/);
  assert.doesNotMatch(compiled.prompt, /声明的 narration window|SILENCE\/AMBIENT-ONLY|must remain silent/u);
  assert.doesNotMatch(compiled.prompt, /PLATFORM NARRATION TIMING CONTRACT/);
  assert.doesNotMatch(compiled.prompt, /do not generate or carry audible dialogue/);
  assert.doesNotMatch(compiled.prompt, /final audible speech is supplied by the platform narration/);
  assert.equal(compiled.capabilitySnapshot.audio_owner, "NATIVE_PROVIDER");
});

test("multiline Chinese quoted dialogue remains private and complete", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "主持人说：\n「第一句口播，\n第二句继续说明。」\n画面描述：办公室内景。",
    targetDurationSeconds: 15,
    stylePreferences: "纪实",
    sourceAssetIds: [],
  });
  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), "第一句口播，\n第二句继续说明。");
  const cues = plan.shotSpecs.flatMap((shot) => shot.motionPlan.voice_performance?.delivery_cues ?? []);
  assert.equal(cues.map((cue) => cue.provider_text ?? cue.text).join(""), "第一句口播，\n第二句继续说明。");
  assert.ok(plan.shotSpecs.every((shot) => !shot.narrativeGoal.includes("第一句口播")));
});

test("native provider prompt keeps authored multiline dialogue boundaries", async () => {
  const dialogue = "第一句口播。\n\n第二句继续说明。";
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: `口播文案：”${dialogue}”`,
    targetDurationSeconds: 15,
    stylePreferences: "纪实",
    sourceAssetIds: [],
  });
  const dialogueShot = plan.shotSpecs.find((shot) => shot.dialogueLines.length > 0);
  assert.ok(dialogueShot);
  if (!dialogueShot) return;
  const compiled = await new DeterministicStoryboardCompiler().compile({
    ...dialogueShot,
    stylePreferences: "纪实",
    audioOwner: "NATIVE_PROVIDER",
  });
  assert.match(compiled.prompt, /第一句口播。\n\n第二句继续说明。/);
});

test("planner adds a dry-land lock for a waterside hot-spring scene unless entering water is explicit", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "主持人在温泉池边面对镜头口播：“欢迎来到这里。”",
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: ["ast_subject", "ast_scene"],
  });
  for (const shot of plan.shotSpecs) {
    assert.ok(shot.motionPlan.character_locks.some((lock) => lock.includes("不进入水体")));
  }
});

test("quoted reference filenames are not treated as spoken dialogue", async () => {
  const model = new DeterministicPlanningModel();
  const plan = await model.plan({
    sourceText: "第1张人物.png和第2张场景.jpg作为参考图。主持人说：“欢迎来到茅山。”",
    targetDurationSeconds: 15,
    visualStyle: "商业宣传片",
    stylePreferences: "",
    sourceAssetIds: [],
  });
  assert.deepEqual(plan.shotSpecs[0]?.dialogueLines, ["欢迎来到茅山。"]);
});

test("authoring instructions and voiceover labels do not become visual motion events", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "录一段包含商业宣传片、口播为一体的短视频，其中以主持人说话为主。口播文案为：“第一段台词。第二段台词。”",
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: ["ast_subject", "ast_scene"],
  });
  assert.ok(plan.shotSpecs.every((shot) => !/录一段|口播为一体|口播文案|为：/u.test(`${shot.narrativeGoal}${shot.motionPlan.motion_beats.map((beat) => beat.action).join(" ")}`)));
  assert.deepEqual(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), "第一段台词。第二段台词。");
});

test("camera planning keeps dense fifteen-second story beats inside one provider segment", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "进入大厅。抬头观察。取出资料。转身交给同伴。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });

  assert.equal(plan.shotSpecs.length, 1);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [15]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.cameraShot.primaryMovement), ["缓慢推近"]);
  assert.equal(plan.shotSpecs[0]!.motionPlan.motion_beats.length, 4);
  assert.equal(new Set(plan.shotSpecs[0]!.motionPlan.motion_beats.map((beat) => beat.camera_movement)).size, 1);
  assert.equal(new Set(plan.shotSpecs[0]!.motionPlan.motion_beats.map((beat) => beat.shot_size)).size, 1);
});

test("visual-only editorial beats stay inside one Huobao paragraph", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "摄影棚内模特从远处走来。随后停下扶腰。重新迈步靠近镜头，构图从全身景变成半身。最后保持微笑。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });

  assert.equal(plan.shotSpecs.length, 1);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [15]);
  assert.ok(plan.shotSpecs[0]!.motionPlan.motion_beats.length >= 2);
});

test("an explicit Grok duration policy keeps every short target in one exact segment", async () => {
  const planner = new DeterministicPlanningModel();
  for (const targetDurationSeconds of [1, 6, 7, 8, 15]) {
    const plan = await planner.plan({
      sourceText: "人物抬手完成一个清晰动作。",
      targetDurationSeconds,
      durationPolicy: { minDurationSeconds: 1, maxDurationSeconds: 15 },
      stylePreferences: "",
      sourceAssetIds: [],
    });
    assert.equal(plan.generationSegmentCount, 1);
    assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [targetDurationSeconds]);
    assert.equal(plan.shotSpecs[0]!.motionPlan.duration_seconds, targetDurationSeconds);
  }
});

test("internal minimum generation segment count reuses the existing semantic planner", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "人物走近。她停下。",
    targetDurationSeconds: 15,
    durationPolicy: { minDurationSeconds: 1, maxDurationSeconds: 15 },
    minimumGenerationSegmentCount: 2,
    stylePreferences: "",
    sourceAssetIds: [],
  });

  assert.equal(plan.generationSegmentCount, 2);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [8, 7]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.dependsOnSequences), [[], [1]]);
  assert.deepEqual(plan.beats.map((beat) => beat.generationSegmentSequence), [1, 2]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.narrativeBeatSequences), [[1], [2]]);
});

test("an explicit Grok duration policy rejects authored dialogue that cannot fit the exact short target", async () => {
  await assert.rejects(() => new DeterministicPlanningModel().plan({
    sourceText: '口播文案："甲乙丙丁戊己"',
    targetDurationSeconds: 1,
    durationPolicy: { minDurationSeconds: 1, maxDurationSeconds: 15 },
    stylePreferences: "",
    sourceAssetIds: [],
  }), (error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === "STORYBOARD_SPEC_INVALID" || code === "VOICEOVER_CAPACITY_EXCEEDED";
  });
});

test("the default Huobao policy remains fail-closed below its eight-second minimum", async () => {
  await assert.rejects(() => new DeterministicPlanningModel().plan({
    sourceText: "人物抬手完成一个清晰动作。",
    targetDurationSeconds: 7,
    stylePreferences: "",
    sourceAssetIds: [],
  }), (error: unknown) => (error as { code?: string }).code === "STORYBOARD_SPEC_INVALID");
});

test("duration above the provider maximum keeps legal Huobao segment boundaries", async () => {
  const planner = new DeterministicPlanningModel();
  const expected: ReadonlyArray<[number, number[]]> = [[16, [8, 8]], [17, [9, 8]], [30, [15, 15]]];
  for (const [targetDurationSeconds, durations] of expected) {
    const plan = await planner.plan({
      sourceText: "人物完成一个连续动作并在结尾停稳。",
      targetDurationSeconds,
      stylePreferences: "",
      sourceAssetIds: [],
    });
    assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), durations);
    assert.equal(plan.shotSpecs.reduce((total, shot) => total + shot.durationSeconds, 0), targetDurationSeconds);
  }
});

test("a simple visible action is not duplicated into synthetic motion beats", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "道家女子手持白色拂尘沿庭院小路缓缓走来。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: ["ast_subject", "ast_scene"],
  });

  const beats = plan.shotSpecs[0]!.motionPlan.motion_beats;
  assert.equal(beats.length, 1);
  assert.equal(new Set(beats.map((beat) => beat.action)).size, 1);
  assert.match(beats[0]!.action, /缓缓走来/);
});

test("camera planning blocks an explicit scene cut when a short target cannot satisfy Huobao minimum", async () => {
  const planner = new DeterministicPlanningModel();
  await assert.rejects(() => planner.plan({
    sourceText: "人物在办公室完成签约。镜头切换到夜晚街头，她走向等候的车辆。",
    targetDurationSeconds: 7,
    stylePreferences: "",
    sourceAssetIds: [],
  }), (error: unknown) => (error as { code?: string }).code === "STORYBOARD_SPEC_INVALID");
});

test("camera planning does not merge a fifteen-second explicit scene cut across Huobao segments", async () => {
  const planner = new DeterministicPlanningModel();
  await assert.rejects(() => planner.plan({
    sourceText: "人物在办公室完成签约。镜头切换到夜晚街头，她走向等候的车辆。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  }), (error: unknown) => (error as { code?: string }).code === "STORYBOARD_SPEC_INVALID");
});

test("camera planning blocks a semantic split when a short target cannot satisfy Huobao minimum", async () => {
  const planner = new DeterministicPlanningModel();
  await assert.rejects(() => planner.plan({
    sourceText: "女子沿庭院小路缓缓走来。沾着露水的枝条碰到她的袖口，却被无形气流轻轻拨开。她发现我，主动靠近两步，开口问道：真巧，你什么时候来的？",
    targetDurationSeconds: 7,
    stylePreferences: "",
    sourceAssetIds: ["ast_subject", "ast_scene"],
  }), (error: unknown) => (error as { code?: string }).code === "STORYBOARD_SPEC_INVALID");
});

test("short narrated stories keep multiple authored lines in one provider segment", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "她蹲下等待小猫靠近。她低声说：\"早啊，小家伙。\"随后起身继续走，并轻声说：\"走啦。\"",
    targetDurationSeconds: 15,
    stylePreferences: "现代都市真人写实",
    sourceAssetIds: [],
  });

  assert.equal(plan.generationSegmentCount, 1);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [15]);
  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), "早啊，小家伙。走啦。");
  assert.ok(plan.shotSpecs[0]!.motionPlan.motion_beats.length >= 1);
});

test("quoted sound effects and continuity prose are not mistaken for authored dialogue", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "树池方向传来一声轻短的\"喵\"。女主低声说：\n\n\"早啊，小家伙。\"随后起身，并轻声说：\"走啦。\"\n严格保持\"猫叫—人物反应—蹲下等待\"的因果顺序。",
    targetDurationSeconds: 15,
    stylePreferences: "现代都市真人写实",
    sourceAssetIds: [],
  });

  assert.deepEqual(plan.shotSpecs.flatMap((shot) => shot.dialogueLines), ["早啊，小家伙。", "走啦。"]);
});

test("huobao dialogue timing is carried as a private motion-plan constraint", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "她走近镜头，开口问道：真巧，你什么时候来的？",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });
  const motion = plan.shotSpecs[0]!.motionPlan;
  assert.ok((motion.dialogue_duration_seconds ?? 0) >= 2);
  const compiled = await new DeterministicStoryboardCompiler().compile({ ...plan.shotSpecs[0]!, stylePreferences: "" });
  assert.match(compiled.prompt, /Reserve approximately .* seconds at the start/);
});

test("openmontage variation audit flags only repeated camera coverage", () => {
  const pass = auditCameraCoverage([
    { sequence: 1, durationSeconds: 7, shotSize: "中景", cameraAngle: "正面", primaryMovement: "推进", movementDirection: "向前", narrativeIntent: "建立", openingState: "开始", closingState: "中段", transition: "切入" },
    { sequence: 2, durationSeconds: 8, shotSize: "近景", cameraAngle: "侧面", primaryMovement: "跟拍", movementDirection: "向前", narrativeIntent: "动作", openingState: "中段", closingState: "结束", transition: "收束" },
  ]);
  assert.equal(pass.status, "PASS");
  const review = auditCameraCoverage([
    { sequence: 1, durationSeconds: 7, shotSize: "中景", cameraAngle: "正面", primaryMovement: "固定停稳", movementDirection: "不变", narrativeIntent: "建立", openingState: "开始", closingState: "中段", transition: "停稳" },
    { sequence: 2, durationSeconds: 8, shotSize: "中景", cameraAngle: "正面", primaryMovement: "固定停稳", movementDirection: "不变", narrativeIntent: "动作", openingState: "中段", closingState: "结束", transition: "停稳" },
  ]);
  assert.equal(review.status, "REVIEW_REQUIRED");
  assert.deepEqual(review.issues, ["CONSECUTIVE_DUPLICATE_COVERAGE", "STATIC_COVERAGE_OVERUSE"]);
});

test("OpenMontage variation thresholds are preserved for a larger private scene plan", () => {
  const result = checkOpenMontageSceneVariation([
    { shot_language: { shot_size: "中景", camera_movement: "static", lighting_key: "昼" }, description: "a beautiful modern room", shot_intent: "建立空间" },
    { shot_language: { shot_size: "中景", camera_movement: "static", lighting_key: "昼" }, description: "a beautiful modern room", shot_intent: "展示人物" },
    { shot_language: { shot_size: "中景", camera_movement: "static", lighting_key: "昼" }, description: "a beautiful modern room", shot_intent: "推进动作" },
    { shot_language: { shot_size: "中景", camera_movement: "static", lighting_key: "昼" }, description: "a beautiful modern room", shot_intent: "收束" },
  ]);
  assert.equal(result.verdict, "fail");
  assert.ok(result.violations.some((issue) => issue.includes("consecutive same-size shots")));
  assert.ok(result.violations.some((issue) => issue.includes("static or unspecified movement")));
  assert.ok(result.violations.some((issue) => issue.includes("unique lighting setup")));
  assert.ok(result.violations.some((issue) => issue.includes("generic language")));
});

test("OpenMontage slideshow-risk dimensions remain private and deterministic", () => {
  const result = scoreOpenMontageSlideshowRisk([
    { type: "video", description: "同一空间", shot_language: { shot_size: "中景", camera_movement: "static" }, narrative_role: "建立", shot_intent: "建立" },
    { type: "video", description: "同一空间", shot_language: { shot_size: "中景", camera_movement: "static" }, narrative_role: "动作", shot_intent: "动作" },
    { type: "video", description: "同一空间", shot_language: { shot_size: "中景", camera_movement: "static" }, narrative_role: "收束", shot_intent: "收束" },
  ]);
  assert.equal(result.verdict, "strong");
  assert.equal(result.dimensions.decorative_visuals?.score, 0);
  assert.ok(result.dimensions.repetition?.score >= 2);
});

test("camera planning does not split ordinary chained actions without an editorial boundary", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "她进入大厅。抬头观察四周。取出资料。转身交给同伴。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: ["ast_reference"],
  });

  assert.equal(plan.shotSpecs.length, 1);
  assert.equal(plan.cameraPlanMode, "SINGLE_TAKE");
  assert.equal(plan.shotSpecs[0]!.motionPlan.motion_beats.length, 4);
});

test("C11 deterministic planning respects the shot capability range without direct character slicing", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "A discovery changes the team's plan.",
    targetDurationSeconds: 31,
    stylePreferences: "",
    sourceAssetIds: [],
  });

  assert.equal(plan.shotSpecs.reduce((total, shot) => total + shot.durationSeconds, 0), 31);
  assert.ok(plan.shotSpecs.every((shot) => shot.durationSeconds <= 15));
  assert.ok(plan.shotSpecs.every((shot) => shot.referencePolicy === "TEXT_TRANSITION"));
});

test("C11 prompt compilation is internal, deterministic, and preserves the declared visual boundary", async () => {
  const compiler = new DeterministicStoryboardCompiler();
  const compiled = await compiler.compile({
    title: "Decision",
    narrativeGoal: "Show the team agreeing on the recovery plan.",
    startState: "Assembly-floor discussion.",
    endState: "The schedule is approved.",
    transitionSummary: "Continue the team gesture.",
    referencePolicy: "REFERENCE_SET",
    continuityNote: "Keep the wardrobe and product palette consistent.",
    stylePreferences: "Warm industrial documentary lighting.",
  });

  assert.match(compiled.prompt, /Show the team agreeing/);
  assert.match(compiled.prompt, /Warm industrial documentary lighting/);
  assert.match(compiled.prompt, /server-side visual analysis identifies each image/);
  assert.match(compiled.prompt, /user describes an image's purpose/);
  assert.match(compiled.prompt, /correctly connected head, neck, shoulders/);
  assert.equal(compiled.visualConstraints.identity_wardrobe_scene_lock, true);
  assert.deepEqual(compiled.referenceMap, { reference_policy: "REFERENCE_SET" });
  assert.equal(compiled.capabilitySnapshot.supports_handoff_first_frame, true);

  const motionCompiled = await compiler.compile({
    title: "Timed action",
    narrativeGoal: "Show a person opening the gate and looking toward the road.",
    startState: "The person stands beside the closed gate.",
    endState: "The gate is open and the person faces the road.",
    transitionSummary: "Hold the final facing direction.",
    referencePolicy: "REFERENCE_SET",
    continuityNote: "Keep the same person and gate.",
    stylePreferences: "Natural documentary camera.",
    motionPlan: {
      version: "c11.3-motion-plan-v1",
      duration_seconds: 10,
      scene_lock: "Same gate and road.",
      character_locks: ["Same person."],
      prop_locks: ["Same gate."],
      motion_beats: [
        { sequence: 1, start_seconds: 0, end_seconds: 5, action: "Walk to and reach for the gate latch.", subject_refs: ["primary_subject"], start_pose: "Standing beside the closed gate.", end_pose: "Hand rests on the latch.", shot_size: "Medium shot", camera_movement: "Slow follow", continuity_locks: ["Same wardrobe."], prohibited_changes: ["No new character."], source_narrative_beat_sequences: [1] },
        { sequence: 2, start_seconds: 5, end_seconds: 10, action: "Open the gate and turn toward the road.", subject_refs: ["primary_subject"], start_pose: "Hand on the latch.", end_pose: "Facing the road beside the open gate.", shot_size: "Medium close-up", camera_movement: "Settle after the turn", continuity_locks: ["Same light."], prohibited_changes: ["No location jump."], source_narrative_beat_sequences: [1] },
      ],
      opening_state: "The person stands beside the closed gate.",
      closing_state: "The gate is open and the person faces the road.",
      transition_in: "Enter naturally.",
      transition_out: "Hold the final facing direction.",
      complexity_score: 24,
      source_narrative_beat_sequences: [1],
    },
  });
  assert.match(motionCompiled.prompt, /Motion timeline/);
  assert.match(motionCompiled.prompt, /0\.000-5\.000s/);
  assert.equal(motionCompiled.motionPlanHash?.length, 64);
  await assert.rejects(() => compiler.compile({
    title: "Mismatched motion hash",
    narrativeGoal: "Keep the same action.",
    startState: "Standing.",
    endState: "Seated.",
    transitionSummary: "Hold.",
    referencePolicy: "REFERENCE_SET",
    continuityNote: "Same room.",
    stylePreferences: "",
    motionPlan: motionCompiled.motionPlan,
    motionPlanHash: "0".repeat(64),
  }), /Motion plan hash does not match/);

  const handoffCompiled = await compiler.compile({
    title: "Continuation",
    narrativeGoal: "Continue the prior scene without changing identity.",
    startState: "The previous segment ends on a close two-shot.",
    endState: "The characters sit down in the same room.",
    transitionSummary: "Continue from the accepted handoff image.",
    referencePolicy: "HANDOFF_FIRST_FRAME",
    continuityNote: "The first reference is the handoff frame and additional references keep wardrobe stable.",
    stylePreferences: "Warm industrial documentary lighting.",
  });
  assert.match(handoffCompiled.prompt, /first supplied reference image/);
  assert.match(handoffCompiled.prompt, /do not replay an action already completed/);
  assert.match(handoffCompiled.prompt, /does not certify literal pixel-perfect/);
  assert.equal(handoffCompiled.capabilitySnapshot.max_reference_images, 7);
  assert.equal(handoffCompiled.capabilitySnapshot.supports_handoff_plus_reference_set, true);
  assert.equal(handoffCompiled.capabilitySnapshot.reference_set_and_handoff_are_mutually_exclusive, false);
});

test("universal planner separates many narrative beats from executable generation segments", async () => {
  const planner = new DeterministicPlanningModel();
  const sourceText = Array.from({ length: 18 }, (_, index) => `叙事事件 ${index + 1} 完成一个清晰的故事动作。`).join(" ");
  const plan = await planner.plan({
    sourceText,
    targetDurationSeconds: 30,
    stylePreferences: "连续、克制、商业级",
    sourceAssetIds: ["ast_reference"],
  });

  assert.equal(plan.narrativeBeatCount, 18);
  assert.equal(plan.generationSegmentCount, 2);
  assert.equal(plan.beats.length, 18);
  assert.equal(plan.shotSpecs.length, 2);
  assert.deepEqual(plan.shotSpecs.map((segment) => segment.durationSeconds), [15, 15]);
  assert.deepEqual(plan.shotSpecs.map((segment) => segment.narrativeBeatSequences.map((sequence) => sequence)), [
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14, 15, 16, 17, 18],
  ]);
  assert.equal(new Set(plan.beats.map((beat) => beat.generationSegmentSequence)).size, 2);
});

test("planner keeps a trailing authoring instruction out of narrative beats", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "苏婉蓉在餐桌旁犹豫。两人转到客厅沙发继续交谈。把以上剧情设计成剧本。",
    targetDurationSeconds: 20,
    stylePreferences: "克制的现实电影感",
    sourceAssetIds: ["ast_reference"],
  });

  assert.equal(plan.narrativeBeatCount, 2);
  assert.ok(plan.beats.every((beat) => !beat.summary.includes("设计成剧本")));
  assert.ok(plan.shotSpecs.every((segment) => !segment.narrativeGoal.includes("设计成剧本")));
});

test("planner chooses two fifteen-second segments when the complete voiceover fits", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "以主持人说话为主。口播文案为：\"受够城市雾霾尾气，就来茅山温泉・桃李春风。背靠茅山原生山林，富含高浓度负氧离子。推窗尽揽草木清香，漫步竹海，在家坐拥天然氧吧，畅快呼吸，被绿意滋养身心。\"",
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: [],
  });

  assert.equal(plan.generationSegmentCount, 2);
  assert.ok(plan.shotSpecs.reduce((total, segment) => total + segment.durationSeconds, 0) <= 30);
  assert.equal(plan.shotSpecs.map((segment) => segment.dialogueLines.join("")).join(""), "受够城市雾霾尾气，就来茅山温泉・桃李春风。背靠茅山原生山林，富含高浓度负氧离子。推窗尽揽草木清香，漫步竹海，在家坐拥天然氧吧，畅快呼吸，被绿意滋养身心。");
  assert.ok(plan.shotSpecs.filter((segment) => segment.dialogueLines.length > 0).length >= 1);
});

test("planner preserves the complete long visual source instead of silently truncating its tail", async () => {
  const visual = `镜头从企业大厅缓慢推进至顾问查看风险分析面板，保持人物、空间与屏幕信息连续，${"画面细节保持清晰并服务于同一视觉动作，".repeat(12)}尾部保留标记`;
  assert.ok(visual.length > 160);
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: visual,
    targetDurationSeconds: 15,
    stylePreferences: "企业宣传片",
    sourceAssetIds: [],
  });

  assert.equal(plan.shotSpecs[0]!.narrativeGoal, visual);
  assert.ok(plan.shotSpecs[0]!.narrativeGoal.endsWith("尾部保留标记"));
});

test("planner fails closed when structured visual locks exceed the existing motion-plan contract", async () => {
  const visualObjectLocks = Array.from({ length: 13 }, (_, index) => ({
    name: `对象${index + 1}`,
    description: "保持来源描述中的外观和可辨识细节。",
    relation: "保持与主体和场景的相对关系。",
    prohibited_changes: ["不得无故消失。", "不得被替换。"],
    instance_count: 1,
  }));

  await assert.rejects(() => new DeterministicPlanningModel().plan({
    sourceText: "顾问查看风险分析面板。",
    targetDurationSeconds: 15,
    stylePreferences: "企业宣传片",
    sourceAssetIds: [],
    visualObjectLocks,
  }));
});

test("planner recognizes an unquoted 口播文案 block and follows source sentence boundaries", async () => {
  const dialogue = "晚上十点四十一分，一条消息被秒回。这就是智险引擎——内容日产四十七条，线索二十六秒应答，面谈零点四秒提词，计划书八秒成稿，合规逐项把关。让每一位代理人，都拥有一支 AI 营销团队。";
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: `口播文案\n${dialogue}\n\n视频生成意图描述\n深夜城市万家灯火航拍缓推至一扇亮窗，随后展开产品界面。`,
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: ["ast_ui"],
  });

  assert.equal(plan.generationSegmentCount, 3);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [8, 14, 8]);
  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), dialogue);
  assert.ok(plan.shotSpecs.some((shot) => shot.narrativeGoal.includes("深夜城市")), "the visual-description block must survive narration extraction");
  assert.equal(plan.shotSpecs[0]!.dialogueLines.join(""), "晚上十点四十一分，一条消息被秒回。");
  assert.equal(plan.shotSpecs[1]!.dialogueLines.join(""), "这就是智险引擎——内容日产四十七条，线索二十六秒应答，面谈零点四秒提词，计划书八秒成稿，合规逐项把关。");
  assert.equal(plan.shotSpecs[2]!.dialogueLines.join(""), "让每一位代理人，都拥有一支 AI 营销团队。");
  assert.ok(plan.shotSpecs.every((shot) => shot.dialogueLines.join("").length > 0));
  assert.ok(plan.shotSpecs.every((shot) => (shot.motionPlan.dialogue_duration_seconds ?? 0) <= shot.durationSeconds));
  assert.ok(plan.shotSpecs.every((shot) => {
    const characters = [...shot.dialogueLines.join("")].filter((character) => !/\s/u.test(character)).length;
    return characters <= Math.floor((shot.durationSeconds - 2) * 4.5);
  }));
});

test("multiline labeled narration with a mismatched boundary quote reaches every native provider segment", async () => {
  const dialogue = "晚上十点四十一分，一条消息被秒回，这，就是智险引擎。\n内容，日产四十七条；线索，二十六秒应答；面谈，零点四秒提词；计划书，八秒成稿；合规，逐项把关。\n让每一位代理人，都拥有一支 AI 营销团队。";
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: `口播文案：”\n晚上十点四十一分，一条消息被秒回，这，就是智险引擎。\n内容，日产四十七条；线索，二十六秒应答；面谈，零点四秒提词；计划书，八秒成稿；合规，逐项把关。\n让每一位代理人，都拥有一支 AI 营销团队。”\n\n视频生成意图描述\n深夜城市万家灯火航拍至一扇亮窗，随后展开产品界面。`,
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: [],
  });

  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), dialogue);
  const compiled = await Promise.all(plan.shotSpecs.map((shot) => new DeterministicStoryboardCompiler().compile({
    ...shot,
    generationSegmentSequence: shot.sequence,
    generationSegmentCount: plan.generationSegmentCount,
    stylePreferences: "商业宣传片",
    audioOwner: "NATIVE_PROVIDER",
  })));
  const nativePrompts = compiled.map((prompt) => prompt.prompt).join(" ");
  for (const [index, shot] of plan.shotSpecs.entries()) {
    const script = shot.dialogueLines.join("");
    assert.ok(compiled[index]!.prompt.includes(script), `native segment ${index + 1} must preserve its own source clause`);
    for (const [otherIndex, otherShot] of plan.shotSpecs.entries()) {
      if (otherIndex === index || otherShot.dialogueLines.length === 0) continue;
      assert.ok(!compiled[index]!.prompt.includes(otherShot.dialogueLines.join("")), `native segment ${index + 1} must not include segment ${otherIndex + 1}'s source clause`);
    }
  }
  assert.match(nativePrompts, /AUDIO PRIORITY: spoken dialogue is mandatory/);
  assert.match(nativePrompts, /EXACT SPOKEN AUDIO SCRIPT/);
  assert.equal(plan.generationSegmentCount, 3);
  assert.equal(plan.shotSpecs[0]!.dialogueLines.join(""), "晚上十点四十一分，一条消息被秒回，这，就是智险引擎。");
  assert.equal(plan.shotSpecs[1]!.dialogueLines.join(""), "\n内容，日产四十七条；线索，二十六秒应答；面谈，零点四秒提词；计划书，八秒成稿；合规，逐项把关。");
  assert.equal(plan.shotSpecs[2]!.dialogueLines.join(""), "\n让每一位代理人，都拥有一支 AI 营销团队。");
  assert.match(nativePrompts, /VOICEOVER CONTINUITY CONTRACT: this is segment 1 of 3/);
  assert.match(nativePrompts, /VOICEOVER CONTINUITY CONTRACT: this is segment 2 of 3/);
  assert.match(nativePrompts, /VOICEOVER CONTINUITY CONTRACT: this is segment 3 of 3/);
  assert.match(nativePrompts, /SPOKEN CONTENT BOUNDARY/);
  assert.doesNotMatch(nativePrompts, /“”/u, "a mismatched source boundary must not create an empty spoken quote");
});

test("planner fails closed when an overlong source line has no legal boundary", async () => {
  const overlong = "甲乙丙丁戊己庚辛壬癸".repeat(8);
  await assert.rejects(() => new DeterministicPlanningModel().plan({
    sourceText: `口播文案："${overlong}"`,
    targetDurationSeconds: 15,
    stylePreferences: "纪实",
    sourceAssetIds: [],
  }), /VOICEOVER_CAPACITY_EXCEEDED/);
});

test("same-direction Chinese quote boundaries remain a single spoken source", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "画面描述：办公室内景。人物说：”第一句。第二句。”",
    targetDurationSeconds: 16,
    stylePreferences: "纪实",
    sourceAssetIds: [],
  });
  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), "第一句。第二句。");
});

test("planner keeps same-line 视频生成意图描述 heading out of a labelled narration block", async () => {
  const dialogue = "保险 AI 让每一次客户沟通都有清晰依据。";
  const visual = "镜头从办公室全景推近到顾问查看风险分析面板。";
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: `口播文案：${dialogue}\n视频生成意图描述：${visual}`,
    targetDurationSeconds: 15,
    stylePreferences: "企业宣传片",
    sourceAssetIds: [],
  });

  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), dialogue);
  assert.ok(plan.shotSpecs.some((shot) => shot.narrativeGoal.includes(visual)), "same-line visual heading must remain visual context");
  assert.ok(plan.shotSpecs.every((shot) => !shot.dialogueLines.join("").includes(visual)));
});

test("voiceover-first planning keeps the spoken budget private and leaves visual tail time", async () => {
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: "主持人说：\"欢迎来到山林温泉，推窗尽揽草木清香。\"",
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: [],
  });
  assert.ok(plan.shotSpecs.reduce((total, shot) => total + shot.durationSeconds, 0) <= 30);
  assert.ok(plan.shotSpecs.filter((shot) => shot.dialogueLines.length > 0).length >= 1);
  const dialogueDuration = plan.shotSpecs.reduce((total, shot) => total + (shot.motionPlan.dialogue_duration_seconds ?? 0), 0);
  assert.ok(dialogueDuration < 30);
  assert.ok(plan.shotSpecs.filter((shot) => shot.dialogueLines.length > 0).length >= 1);
  const dialogueShot = plan.shotSpecs.find((shot) => shot.dialogueLines.length > 0)!;
  const compiled = await new DeterministicStoryboardCompiler().compile({
    ...dialogueShot,
    generationSegmentSequence: dialogueShot.sequence,
    generationSegmentCount: plan.generationSegmentCount,
    stylePreferences: "商业宣传片",
  });
  assert.match(compiled.prompt, /PLATFORM NARRATION SEGMENT CONTRACT/);
  assert.match(compiled.prompt, /POST-DIALOGUE SOUND POLICY/);
  assert.match(compiled.prompt, /do not generate or carry audible dialogue/);
});

test("planner separates reference guidance and exposition from visible motion beats", async () => {
  const planner = new DeterministicPlanningModel();
  const compiler = new DeterministicStoryboardCompiler();
  const plan = await planner.plan({
    sourceText: [
      "小路上缓缓走来一名道家修士打扮的女子。",
      "她神情平静，呼吸绵长，衣袖和裙摆上都没有明显尘土。",
      "行走经过草木时，沾着露水的枝条靠近袖口，被无形气流轻轻拨开。",
      "这便是修士与凡人的区别。",
      "不需要腾云驾雾，也不需要施展惊人的术法。",
      "她看到了我，主动朝你走近两步，开口问到：真巧，你什么时候来的？",
      "第一张图片为人物原型，第二张图片为场景，生成视频。",
    ].join("\n"),
    targetDurationSeconds: 16,
    stylePreferences: "",
    sourceAssetIds: ["ast_subject", "ast_scene"],
  });

  assert.equal(plan.narrativeBeatCount, 3);
  assert.equal(plan.shotSpecs.length, 2);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.durationSeconds), [8, 8]);
  assert.deepEqual(plan.shotSpecs.flatMap((shot) => shot.narrativeBeatSequences), [1, 2, 3]);
  assert.ok(plan.beats.every((beat) => !/第一张图片|第二张图片|生成视频|修士与凡人的区别/.test(beat.summary)));
  assert.ok(plan.shotSpecs[0]!.motionPlan.character_locks.some((lock) => lock.includes("衣袖和裙摆")));
  assert.ok(plan.shotSpecs[0]!.motionPlan.character_locks.some((lock) => lock.includes("不需要腾云驾雾")));

  const compiled = await compiler.compile({ ...plan.shotSpecs[0]!, stylePreferences: "" });
  assert.doesNotMatch(compiled.prompt, /第一张图片|第二张图片|生成视频/);
  assert.match(compiled.prompt, /Global visual locks/);
});

test("planner preserves actions in mixed clauses while locking state and prohibited effects", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "她神情平静，缓缓走来，不需要夸张特效。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });

  assert.equal(plan.narrativeBeatCount, 1);
  assert.match(plan.beats[0]!.summary, /缓缓走来/);
  assert.ok(plan.shotSpecs[0]!.motionPlan.character_locks.some((lock) => lock.includes("神情平静")));
  assert.ok(plan.shotSpecs[0]!.motionPlan.character_locks.some((lock) => lock.includes("不需要夸张特效")));
});

test("planner carries analyzed reference objects into every motion beat", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "女子沿庭院走来。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: ["ast_subject"],
    visualObjectLocks: [{
      name: "白色拂尘",
      description: "白色尘尾和细长手柄",
      relation: "由人物右手持有",
      prohibited_changes: ["不得替换为树枝", "不得消失"],
    }],
  });
  const motion = plan.shotSpecs[0]!.motionPlan;
  assert.equal(motion.key_visual_objects?.[0]?.name, "白色拂尘");
  assert.equal(motion.motion_beats.every((beat) => beat.key_visual_objects?.some((value) => value.includes("白色拂尘"))), true);
  assert.ok(motion.key_visual_objects?.[0]?.prohibited_changes.some((value) => value.includes("树枝")));
  assert.ok(motion.motion_beats.every((beat) => !beat.prohibited_changes.some((value) => value.includes("树枝"))));
});

test("planner gives an explicit user object description precedence over vision details", async () => {
  const planner = new DeterministicPlanningModel();
  const plan = await planner.plan({
    sourceText: "女子手持白色拂尘走来。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: ["ast_subject"],
    visualObjectLocks: [{ name: "白色拂尘", description: "视觉分析误识别为树枝", relation: "错误关系", prohibited_changes: ["视觉默认"] }],
  });
  assert.equal(plan.shotSpecs[0]!.motionPlan.key_visual_objects?.[0]?.description, "保持白色拂尘的名称、外观、颜色、材质和可辨识细节与参考素材及用户描述一致。");
});

test("planner keeps beat-local visual locks within the existing motion contract when analysis returns many objects", async () => {
  const planner = new DeterministicPlanningModel();
  const visualObjectLocks = Array.from({ length: 12 }, (_, index) => ({
    name: `对象${index + 1}`,
    description: "参考图中的稳定对象",
    relation: "位于参考画面中",
    prohibited_changes: ["不得替换", "不得消失"],
  }));
  const plan = await planner.plan({
    sourceText: "顾问走进办公室并抬头。",
    targetDurationSeconds: 30,
    stylePreferences: "",
    sourceAssetIds: ["ast_scene"],
    visualObjectLocks,
  });
  assert.ok(plan.shotSpecs.every((shot) => shot.motionPlan.motion_beats.every((beat) => beat.prohibited_changes.length <= 20)));
  assert.equal(plan.shotSpecs[0]!.motionPlan.key_visual_objects?.length, 12);
  assert.ok(plan.shotSpecs[0]!.motionPlan.key_visual_objects?.every((object) => object.prohibited_changes.length === 2));
});

test("planner creates a single-instance three-phase handoff only for explicit transfer language", async () => {
  const planner = new DeterministicPlanningModel();
  const transferPlan = await planner.plan({
    sourceText: "她左手拿着手机，随后从左手换到右手。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });
  const transferMotion = transferPlan.shotSpecs[0]!.motionPlan;
  assert.equal(transferMotion.motion_beats.length, 3);
  assert.deepEqual(transferMotion.motion_beats.map((beat) => beat.object_states?.find((state) => state.name === "手机")?.phase), ["RELEASE", "CONTACT", "TRANSFERRED"]);
  assert.deepEqual(transferMotion.motion_beats.map((beat) => beat.object_states?.find((state) => state.name === "手机")?.holder), ["LEFT_HAND", "BOTH_HANDS", "RIGHT_HAND"]);
  assert.ok(transferMotion.motion_beats.every((beat) => beat.object_states?.find((state) => state.name === "手机")?.instance_count === 1));

  const stablePlan = await planner.plan({
    sourceText: "她左手拿着手机，沿庭院缓缓走来。",
    targetDurationSeconds: 15,
    stylePreferences: "",
    sourceAssetIds: [],
  });
  const stableState = stablePlan.shotSpecs[0]!.motionPlan.motion_beats[0]!.object_states?.find((state) => state.name === "手机");
  assert.deepEqual(stableState, { name: "手机", instance_count: 1, holder: "LEFT_HAND", phase: "STABLE" });
});

test("MotionBeat schema rejects gaps and timelines that do not cover the segment", () => {
  assert.throws(() => GenerationSegmentMotionPlanSchema.parse({
    version: "c11.3-motion-plan-v1",
    duration_seconds: 10,
    scene_lock: "Same room.",
    character_locks: [],
    prop_locks: [],
    motion_beats: [
      { sequence: 1, start_seconds: 0, end_seconds: 4, action: "Move.", subject_refs: ["primary_subject"], start_pose: "Start.", end_pose: "Middle.", shot_size: "Medium", camera_movement: "Static", continuity_locks: [], prohibited_changes: [], source_narrative_beat_sequences: [1] },
      { sequence: 2, start_seconds: 5, end_seconds: 10, action: "Stop.", subject_refs: ["primary_subject"], start_pose: "Middle.", end_pose: "End.", shot_size: "Medium", camera_movement: "Static", continuity_locks: [], prohibited_changes: [], source_narrative_beat_sequences: [1] },
    ],
    opening_state: "Start.",
    closing_state: "End.",
    transition_in: "Enter.",
    transition_out: "Exit.",
    complexity_score: 1,
    source_narrative_beat_sequences: [1],
  }));
});

test("document context constrains the public plan without replaying Markdown into it", async () => {
  const planner = new DeterministicPlanningModel();
  const privateFact = "PRIVATE_DOCUMENT_FACT_DO_NOT_EXPOSE";
  const plan = await planner.plan({
    sourceText: "团队在黎明前完成客户交付。",
    targetDurationSeconds: 15,
    stylePreferences: "克制纪录片感",
    sourceAssetIds: [],
    documentContexts: [{
      documentId: "doc_story",
      conversionId: "dcv_story",
      sourceAssetId: "ast_source",
      markdownAssetId: "ast_markdown",
      maxContentCharacters: 5_000,
      content: privateFact,
    }],
  });

  assert.match(plan.summary, /已关联 1 份已整理资料/);
  assert.match(plan.continuityNote, /私有创作约束/);
  assert.equal(JSON.stringify(plan).includes(privateFact), false);
});

test("fact contexts compile to bounded private statements without the legacy Markdown block", async () => {
  const compiled = await new DeterministicStoryboardCompiler().compile({
    title: "片段",
    narrativeGoal: "展示产品优势。",
    startState: "开场",
    endState: "结束",
    transitionSummary: "自然推进。",
    referencePolicy: "TEXT_TRANSITION",
    continuityNote: "保持连续。",
    dialogueLines: [],
    factContexts: [{
      creative_brief_revision_id: "cbr_fact_test",
      fact_id: "dft_fact_test",
      sequence: 1,
      fact: {
        fact_id: "dft_fact_test",
        category: "SELLING_POINT",
        statement: "产品支持全天候服务。",
        confidence: "EXPLICIT",
        source: { document_id: "doc_fact_test", conversion_id: "dcv_fact_test", section_sequence: 2, locator: "第 2 节：服务" },
      },
      selection_reason: "确定性选择",
      snapshot_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    }],
    stylePreferences: "简洁",
  });
  assert.match(compiled.prompt, /FROZEN PROJECT FACT/);
  assert.match(compiled.prompt, /全天候服务/);
  assert.doesNotMatch(compiled.prompt, /PROJECT_DOCUMENT_FACTS_1_BEGIN/);
  assert.deepEqual(compiled.referenceMap.fact_refs, ["dft_fact_test"]);
});

test("insurance AI source dialogue stays complete while the generated prompt uses the compact source shape", async () => {
  const sourceDialogue = "晚上十点四十一分，一条消息被秒回，这，就是智险引擎。\n内容，日产四十七条；线索，二十六秒应答；面谈，零点四秒提词；计划书，八秒成稿；合规，逐项把关。\n让每一位代理人，都拥有一支 AI 营销团队。";
  const plan = await new DeterministicPlanningModel().plan({
    sourceText: `口播文案：”${sourceDialogue}”`,
    targetDurationSeconds: 30,
    stylePreferences: "企业宣传片",
    sourceAssetIds: [],
  });
  assert.equal(plan.shotSpecs.flatMap((shot) => shot.dialogueLines).join(""), sourceDialogue);

  const compiled = await Promise.all(plan.shotSpecs.map((shot) => new DeterministicStoryboardCompiler().compile({
    ...shot,
    generationSegmentSequence: shot.sequence,
    generationSegmentCount: plan.generationSegmentCount,
    stylePreferences: "企业宣传片",
    audioOwner: "NATIVE_PROVIDER",
  })));
  for (const [index, packageValue] of compiled.entries()) {
    const script = plan.shotSpecs[index]!.dialogueLines.join("");
    if (script) {
      assert.equal((packageValue.prompt.match(/Character says:/gu) ?? []).length, 1);
      assert.ok(packageValue.prompt.includes(script));
    }
    assert.ok(Buffer.byteLength(packageValue.prompt, "utf8") < 4_096, `segment ${index + 1} prompt should be compact`);
    assert.doesNotMatch(packageValue.prompt, /Object state timeline:|Prohibited changes:/u);
  }
});

test("compact motion text keeps one action/camera/end per beat while structured locks remain intact", async () => {
  const motionPlan = {
    version: "c11.3-motion-plan-v1",
    duration_seconds: 10,
    scene_lock: "Same office.",
    character_locks: ["Same person."],
    prop_locks: ["Same phone."],
    key_visual_objects: [{
      name: "手机",
      description: "黑色手机",
      relation: "由人物左手持有",
      prohibited_changes: ["不得复制"],
      instance_count: 1,
      holder: "LEFT_HAND" as const,
    }],
    motion_beats: [
      { sequence: 1, start_seconds: 0, end_seconds: 5, action: "拿起手机。", subject_refs: ["primary_subject"], start_pose: "站立。", end_pose: "手机举起。", shot_size: "中景", camera_movement: "缓慢推近", continuity_locks: ["同一人物。"], prohibited_changes: ["不得复制手机。"], source_narrative_beat_sequences: [1], object_states: [{ name: "手机", instance_count: 1, holder: "LEFT_HAND" as const, phase: "STABLE" as const }] },
      { sequence: 2, start_seconds: 5, end_seconds: 10, action: "看向屏幕。", subject_refs: ["primary_subject"], start_pose: "手机举起。", end_pose: "人物停稳。", shot_size: "近景", camera_movement: "固定", continuity_locks: ["同一人物。"], prohibited_changes: ["不得改变场景。"], source_narrative_beat_sequences: [1], object_states: [{ name: "手机", instance_count: 1, holder: "LEFT_HAND" as const, phase: "STABLE" as const }] },
    ],
    opening_state: "站立。",
    closing_state: "人物停稳。",
    transition_in: "进入。",
    transition_out: "停稳。",
    complexity_score: 24,
    source_narrative_beat_sequences: [1],
  };
  const compiled = await new DeterministicStoryboardCompiler().compile({
    title: "手机演示",
    narrativeGoal: "人物拿起手机并看向屏幕。",
    startState: "站立。",
    endState: "人物停稳。",
    transitionSummary: "停稳。",
    referencePolicy: "REFERENCE_SET",
    continuityNote: "保持同一人物。",
    stylePreferences: "",
    motionPlan,
    referenceAnchors: ["anchor_subject", "anchor_scene"],
  });
  assert.equal((compiled.prompt.match(/action=/gu) ?? []).length, 2);
  assert.equal((compiled.prompt.match(/camera=/gu) ?? []).length, 2);
  assert.equal((compiled.prompt.match(/end=/gu) ?? []).length, 2);
  assert.doesNotMatch(compiled.prompt, /Object state timeline:|Prohibited changes:/u);
  assert.ok(compiled.prompt.includes("anchor_subject"));
  assert.ok(compiled.prompt.includes("anchor_scene"));
  assert.equal(compiled.motionPlan?.motion_beats[0]?.prohibited_changes[0], "不得复制手机。");
  assert.equal(compiled.motionPlan?.motion_beats[1]?.object_states?.[0]?.phase, "STABLE");
});

test("shotReferencePolicy routes first segment, continuation, transition and no-reference cases", async () => {
  const planner = new DeterministicPlanningModel();

  // 首段：REFERENCE_SET（零变化）
  const first = await planner.plan({
    sourceText: "人物在办公室介绍产品。",
    targetDurationSeconds: 15,
    stylePreferences: "纪实",
    sourceAssetIds: ["ast_subject"],
  });
  assert.equal(first.shotSpecs[0]!.referencePolicy, "REFERENCE_SET");
  assert.equal(first.shotSpecs[0]!.motionPlan.scene_lock, "保持本段建立的单一场景和空间关系");

  // 延续段：sceneId 相同，无转场信号 → HANDOFF_FIRST_FRAME，scene_lock 沿用上一段
  const continuation = await planner.plan({
    sourceText: "人物在办公室介绍产品。团队继续补充细节。",
    targetDurationSeconds: 24,
    stylePreferences: "纪实",
    sourceAssetIds: ["ast_subject"],
    sourceShotBindings: { 1: { sceneId: "office" }, 2: { sceneId: "office" } },
  });
  assert.equal(continuation.shotSpecs[1]!.referencePolicy, "HANDOFF_FIRST_FRAME");
  assert.equal(continuation.shotSpecs[1]!.motionPlan.scene_lock, "沿用上一段验收交接帧中的场景、空间和光线关系");

  // 转场段：sceneId 不同 → REFERENCE_SET，scene_lock 切到新场景
  const transitionBySceneId = await planner.plan({
    sourceText: "人物在办公室介绍产品。团队继续补充细节。",
    targetDurationSeconds: 24,
    stylePreferences: "纪实",
    sourceAssetIds: ["ast_subject"],
    sourceShotBindings: { 1: { sceneId: "office" }, 2: { sceneId: "studio" } },
  });
  assert.equal(transitionBySceneId.shotSpecs[1]!.referencePolicy, "REFERENCE_SET");
  assert.equal(transitionBySceneId.shotSpecs[1]!.motionPlan.scene_lock, "转场到本段声明的新场景，仅保持人物身份、服装和道具连续");

  // 转场段：文本有显式转场信号且 sequence>1 → REFERENCE_SET，scene_lock 切到新场景
  const transitionByText = await planner.plan({
    sourceText: "人物在办公室介绍产品。镜头切换到夜晚街头，她走向等候的车辆。团队继续补充细节。",
    targetDurationSeconds: 30,
    stylePreferences: "纪实",
    sourceAssetIds: ["ast_subject"],
  });
  assert.equal(transitionByText.shotSpecs[1]!.referencePolicy, "REFERENCE_SET");
  assert.equal(transitionByText.shotSpecs[1]!.motionPlan.scene_lock, "转场到本段声明的新场景，仅保持人物身份、服装和道具连续");

  // 真实保险 AI 文案：上游 long-video 的 extreme pull/transition
  // 表达必须让本段从 canonical references 重新起景，而不是复用卧室尾帧。
  const insuranceTransition = await planner.plan({
    sourceText: "深夜城市万家灯火航拍至一扇亮窗。镜头从手机屏幕急速拉远甩镜，墨绿驾驶舱界面在深色空间展开。",
    targetDurationSeconds: 30,
    stylePreferences: "商业宣传片",
    sourceAssetIds: ["ast_ui"],
  });
  assert.equal(insuranceTransition.shotSpecs[1]!.referencePolicy, "REFERENCE_SET");
  assert.doesNotMatch(insuranceTransition.shotSpecs[1]!.motionPlan.scene_lock, /沿用上一段验收交接帧中的场景/u);

  // 按段判定（防回归）：全篇有转场词、但第 3 段自身文本无转场词 → 该段仍为 HANDOFF_FIRST_FRAME
  const perSegmentSignal = await planner.plan({
    sourceText: "人物在办公室介绍产品。团队补充细节。镜头切换到夜晚街头。她走向等候的车辆。司机打开车门。车队驶入高架。",
    targetDurationSeconds: 45,
    stylePreferences: "纪实",
    sourceAssetIds: ["ast_subject"],
  });
  assert.equal(perSegmentSignal.shotSpecs.length, 3);
  // 含「镜头切换」的第 2 段判为转场段
  assert.equal(perSegmentSignal.shotSpecs[1]!.referencePolicy, "REFERENCE_SET");
  // 不含转场词的第 3 段不受全篇信号误伤，仍为延续段
  assert.equal(perSegmentSignal.shotSpecs[2]!.referencePolicy, "HANDOFF_FIRST_FRAME");
  assert.equal(perSegmentSignal.shotSpecs[2]!.motionPlan.scene_lock, "沿用上一段验收交接帧中的场景、空间和光线关系");

  // 无参考图：TEXT_TRANSITION（零变化）
  const noReference = await planner.plan({
    sourceText: "人物在办公室介绍产品。团队继续补充细节。",
    targetDurationSeconds: 24,
    stylePreferences: "纪实",
    sourceAssetIds: [],
  });
  assert.equal(noReference.shotSpecs[1]!.referencePolicy, "TEXT_TRANSITION");
  assert.equal(noReference.shotSpecs[1]!.motionPlan.scene_lock, "保持本段建立的单一场景和空间关系");
});
