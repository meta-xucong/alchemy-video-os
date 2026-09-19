import assert from "node:assert/strict";
import test from "node:test";

import { evaluateNarrationDurationFeedback } from "../src/narration-duration.js";

test("OpenMontage duration feedback records measured narration without an action", () => {
  assert.deepEqual(evaluateNarrationDurationFeedback({
    measurements: [{ section_id: "section-1", planned_duration_seconds: 10, actual_duration_seconds: 9.5 }],
  }), {
    narration_durations: [{ section_id: "section-1", planned_duration_seconds: 10, actual_duration_seconds: 9.5 }],
    total_narration_seconds: 9.5,
    decision: "MEASURED",
    decision_reason: "WITHIN_PLAN",
  });
});

test("the source compose-director one-second overrun is sent back before the producer ratio rule", () => {
  assert.equal(evaluateNarrationDurationFeedback({
    measurements: [{ planned_duration_seconds: 30, actual_duration_seconds: 31.1 }],
  }).decision, "SEND_BACK");
  assert.equal(evaluateNarrationDurationFeedback({
    measurements: [{ planned_duration_seconds: 10, actual_duration_seconds: 11.1 }],
  }).decision_reason, "EXCEEDS_ONE_SECOND");
});

test("the overlapping source gates remain an explicit decision requirement", () => {
  assert.deepEqual(evaluateNarrationDurationFeedback({
    measurements: [{ planned_duration_seconds: 5, actual_duration_seconds: 5.8 }],
  }), {
    narration_durations: [{ planned_duration_seconds: 5, actual_duration_seconds: 5.8 }],
    total_narration_seconds: 5.8,
    decision: "SOURCE_DECISION_REQUIRED",
    decision_reason: "SOURCE_OPTIONS_OVERLAP",
    source_actions: ["SEND_BACK", "ADJUST_SCENE_PLAN"],
  });
});

test("a smaller overrun stays an explicit scene-plan adjustment", () => {
  assert.deepEqual(evaluateNarrationDurationFeedback({
    measurements: [{ planned_duration_seconds: 20, actual_duration_seconds: 20.5 }],
  }).decision, "ADJUST_SCENE_PLAN");
  assert.equal(evaluateNarrationDurationFeedback({
    measurements: [{ planned_duration_seconds: 20, actual_duration_seconds: 20.5 }],
  }).decision_reason, "WITHIN_25_PERCENT");
});

test("all measured files contribute to the source total and an overlap stays unresolved", () => {
  const feedback = evaluateNarrationDurationFeedback({
    measurements: [
      { section_id: "first", planned_duration_seconds: 10, actual_duration_seconds: 10.2 },
      { section_id: "second", planned_duration_seconds: 10, actual_duration_seconds: 12 },
    ],
  });
  assert.equal(feedback.total_narration_seconds, 22.2);
  assert.equal(feedback.decision, "SOURCE_DECISION_REQUIRED");
  assert.deepEqual(feedback.source_actions, ["SEND_BACK", "ADJUST_SCENE_PLAN"]);
});
