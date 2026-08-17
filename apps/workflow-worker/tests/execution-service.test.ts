import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicPlanningModel } from "@alchemy-video/creative-planning";
import type { ControlCreativeBriefRevision, CreativePlanningDraft } from "@alchemy-video/persistence";

import { CreativePlanningExecutor } from "../src/execution-service.js";

const brief: ControlCreativeBriefRevision = {
  id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  workspaceId: "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  projectId: "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  revision: 1,
  sourceText: "雨夜抵达工厂。团队在黎明前完成交付。",
  targetDurationSeconds: 30,
  stylePreferences: "克制的纪实感",
  sourceAssetIds: [],
  status: "PLANNING",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

test("CreativePlanningExecutor persists one internal prompt package for every immutable shot spec", async () => {
  let captured: CreativePlanningDraft | undefined;
  const executor = new CreativePlanningExecutor({
    async completeCreativePlan(input) {
      captured = input.draft;
      return undefined;
    },
  }, new DeterministicPlanningModel());

  await executor.execute({
    brief,
    event: {
      eventId: "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      messageId: "msg_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      traceId: "trc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
      correlationId: "cor_01J4N8QZ8PCW2N2G6D2XJXJXJX",
    },
  });

  assert.ok(captured);
  if (!captured) return;
  assert.equal(captured.promptPackages?.length, captured.shotSpecs.length);
  assert.deepEqual(
    captured.promptPackages?.map((promptPackage) => promptPackage.shotSpecId).sort(),
    captured.shotSpecs.map((shotSpec) => shotSpec.id).sort(),
  );
  assert.ok(captured.promptPackages?.every((promptPackage) => promptPackage.prompt.length > 0));
  assert.ok(captured.promptPackages?.every((promptPackage) => promptPackage.capabilitySnapshot.max_duration_seconds === 15));
  assert.ok(captured.promptPackages?.every((promptPackage) => promptPackage.prompt.includes("克制的纪实感")));
  assert.ok(captured.promptPackages?.every((promptPackage) => promptPackage.visualConstraints.natural_human_anatomy === true));
});

test("CreativePlanningExecutor persists many narrative beats as fewer executable generation segments", async () => {
  let captured: CreativePlanningDraft | undefined;
  const executor = new CreativePlanningExecutor({
    async completeCreativePlan(input) {
      captured = input.draft;
      return undefined;
    },
  }, new DeterministicPlanningModel());

  await executor.execute({
    brief: {
      ...brief,
      id: "cbr_01J4N8QZ8PCW2N2G6D2XJXJA0",
      sourceText: Array.from({ length: 18 }, (_, index) => `叙事事件 ${index + 1} 推动故事向前。`).join(" "),
      targetDurationSeconds: 30,
      sourceAssetIds: ["ast_reference"],
    },
    event: {
      eventId: "evt_01J4N8QZ8PCW2N2G6D2XJXJA0",
      messageId: "msg_01J4N8QZ8PCW2N2G6D2XJXJA0",
      traceId: "trc_01J4N8QZ8PCW2N2G6D2XJXJA0",
      correlationId: "cor_01J4N8QZ8PCW2N2G6D2XJXJA0",
    },
  });

  assert.ok(captured);
  if (!captured) return;
  assert.equal(captured.narrativeBeatCount, 18);
  assert.equal(captured.generationSegmentCount, 3);
  assert.equal(captured.beats.length, 18);
  assert.equal(captured.shotSpecs.length, 3);
  assert.deepEqual(captured.shotSpecs.map((segment) => segment.durationSeconds), [10, 10, 10]);
  assert.deepEqual(captured.shotSpecs.map((segment) => segment.narrativeBeatSequences), [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
    [13, 14, 15, 16, 17, 18],
  ]);
  assert.equal(captured.promptPackages?.length, 3);
});
