import assert from "node:assert/strict";
import test from "node:test";

import {
  DETERMINISTIC_PLANNER_VERSION,
  DeterministicPlanningModel,
  DeterministicStoryboardCompiler,
} from "../src/index.js";

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
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.sequence), [1, 2, 3]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.dependsOnSequences), [[], [1], [2]]);
  assert.deepEqual(plan.shotSpecs.map((shot) => shot.referencePolicy), ["REFERENCE_SET", "HANDOFF_FIRST_FRAME", "HANDOFF_FIRST_FRAME"]);
  assert.ok(plan.shotSpecs.every((shot) => shot.durationSeconds >= 1 && shot.durationSeconds <= 15));
  assert.equal(plan.continuityLevel, "REVIEW_REQUIRED");
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
  assert.match(compiled.prompt, /correctly connected head, neck, shoulders/);
  assert.equal(compiled.visualConstraints.identity_wardrobe_scene_lock, true);
  assert.deepEqual(compiled.referenceMap, { reference_policy: "REFERENCE_SET" });
  assert.equal(compiled.capabilitySnapshot.supports_handoff_first_frame, true);
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
  assert.equal(plan.generationSegmentCount, 3);
  assert.equal(plan.beats.length, 18);
  assert.equal(plan.shotSpecs.length, 3);
  assert.deepEqual(plan.shotSpecs.map((segment) => segment.durationSeconds), [10, 10, 10]);
  assert.deepEqual(plan.shotSpecs.map((segment) => segment.narrativeBeatSequences.map((sequence) => sequence)), [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
    [13, 14, 15, 16, 17, 18],
  ]);
  assert.equal(new Set(plan.beats.map((beat) => beat.generationSegmentSequence)).size, 3);
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
