import {
  MediaRuntimeNarrationDurationFeedbackSchema,
  type MediaRuntimeNarrationDurationMeasurement,
  type MediaRuntimeNarrationDurationFeedback,
} from "@alchemy-video/contracts";

/**
 * Maps the fixed OpenMontage explainer feedback loop to a private platform
 * fact.  The two source documents do not define precedence for the overlap
 * between the compose-director `>1s` check and the executive-producer
 * `1.15`/`25%` options.  That overlap is therefore recorded as
 * SOURCE_DECISION_REQUIRED and remains fail-closed.  No automatic rewrite or
 * duration mutation happens here.
 */
export const evaluateNarrationDurationFeedback = (input: {
  measurements: readonly MediaRuntimeNarrationDurationMeasurement[];
}): MediaRuntimeNarrationDurationFeedback => {
  const measurements = input.measurements.map((measurement) => ({ ...measurement }));
  if (measurements.length === 0) throw new Error("Narration duration measurements are required.");

  let decision: MediaRuntimeNarrationDurationFeedback["decision"] = "MEASURED";
  let decisionReason: MediaRuntimeNarrationDurationFeedback["decision_reason"] = "WITHIN_PLAN";
  let sourceActions: MediaRuntimeNarrationDurationFeedback["source_actions"];
  for (const measurement of measurements) {
    const actual = measurement.actual_duration_seconds;
    const planned = measurement.planned_duration_seconds;
    const exceedsOneSecond = actual > planned + 1;
    const exceeds115Percent = actual > planned * 1.15;
    const within25Percent = actual <= planned * 1.25;
    if (exceeds115Percent && within25Percent) {
      decision = "SOURCE_DECISION_REQUIRED";
      decisionReason = "SOURCE_OPTIONS_OVERLAP";
      sourceActions = ["SEND_BACK", "ADJUST_SCENE_PLAN"];
      break;
    }
    if (exceedsOneSecond) {
      decision = "SEND_BACK";
      decisionReason = "EXCEEDS_ONE_SECOND";
      break;
    }
    if (exceeds115Percent) {
      decision = "SEND_BACK";
      decisionReason = "EXCEEDS_115_PERCENT";
      break;
    }
    if (actual > planned && within25Percent && decision === "MEASURED") {
      decision = "ADJUST_SCENE_PLAN";
      decisionReason = "WITHIN_25_PERCENT";
    }
  }

  const totalNarrationSeconds = measurements.reduce((total, measurement) => total + measurement.actual_duration_seconds, 0);
  return MediaRuntimeNarrationDurationFeedbackSchema.parse({
    narration_durations: measurements,
    total_narration_seconds: totalNarrationSeconds,
    decision,
    decision_reason: decisionReason,
    ...(sourceActions ? { source_actions: sourceActions } : {}),
  });
};
