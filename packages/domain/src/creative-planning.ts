import type { CreativeRevisionStatus, ProductionRunStatus } from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";

export const CREATIVE_REVISION_TRANSITIONS: Readonly<Record<CreativeRevisionStatus, readonly CreativeRevisionStatus[]>> = {
  DRAFT: ["PLANNING", "FAILED"],
  PLANNING: ["READY_FOR_REVIEW", "FAILED"],
  READY_FOR_REVIEW: ["APPROVED", "FAILED"],
  APPROVED: ["SUPERSEDED"],
  FAILED: ["PLANNING"],
  SUPERSEDED: [],
};

export const PRODUCTION_RUN_TRANSITIONS: Readonly<Record<ProductionRunStatus, readonly ProductionRunStatus[]>> = {
  DRAFT: ["PLAN_READY", "FAILED"],
  PLAN_READY: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["GENERATING", "BLOCKED", "FAILED"],
  GENERATING: ["REVIEWING", "BLOCKED", "FAILED"],
  REVIEWING: ["RENDERING", "BLOCKED", "FAILED"],
  RENDERING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  BLOCKED: ["GENERATING", "REVIEWING", "FAILED"],
  // A failed final composition may be retried from the already accepted
  // source segments. This recovery never returns to Provider submission.
  FAILED: ["REVIEWING"],
};

export type PlannedShotSpec = {
  sequence: number;
  durationSeconds: number;
  dependsOnSequences: number[];
};

export type StoryboardDurationPolicy = Readonly<{
  minDurationSeconds: number;
  maxDurationSeconds: number;
}>;

// Huobao's storyboard-breaker remains the default source policy. A known
// profile may explicitly pass a narrower, source-backed policy at the
// internal planner boundary (for example, Grok's 1..15s duration range).
export const DEFAULT_STORYBOARD_DURATION_POLICY: StoryboardDurationPolicy = Object.freeze({
  minDurationSeconds: 8,
  maxDurationSeconds: 15,
});

export const assertCreativeRevisionTransition = (from: CreativeRevisionStatus, to: CreativeRevisionStatus) => {
  if (!CREATIVE_REVISION_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("CREATIVE_PLAN_STATE_INVALID", `Cannot transition a creative revision from ${from} to ${to}.`);
  }
};

export const assertProductionRunTransition = (from: ProductionRunStatus, to: ProductionRunStatus) => {
  if (!PRODUCTION_RUN_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("PRODUCTION_RUN_STATE_INVALID", `Cannot transition a production run from ${from} to ${to}.`);
  }
};

export const assertStoryboardPlan = (input: {
  totalDurationSeconds: number;
  specs: PlannedShotSpec[];
  durationPolicy?: StoryboardDurationPolicy;
}) => {
  const durationPolicy = input.durationPolicy ?? DEFAULT_STORYBOARD_DURATION_POLICY;
  if (!Number.isInteger(durationPolicy.minDurationSeconds)
    || !Number.isInteger(durationPolicy.maxDurationSeconds)
    || durationPolicy.minDurationSeconds < 1
    || durationPolicy.maxDurationSeconds < durationPolicy.minDurationSeconds) {
    throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "Storyboard duration policy must define an ordered positive integer range.");
  }
  if (!Number.isInteger(input.totalDurationSeconds)
    || input.totalDurationSeconds < durationPolicy.minDurationSeconds
    || input.specs.length < 1) {
    throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", `A storyboard requires a total duration of at least ${durationPolicy.minDurationSeconds} seconds and at least one ordered shot.`);
  }

  let total = 0;
  for (const [index, spec] of input.specs.entries()) {
    if (!Number.isInteger(spec.sequence) || spec.sequence !== index + 1) {
      throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "Storyboard shot sequences must start at one and remain contiguous.");
    }
    if (!Number.isInteger(spec.durationSeconds)
      || spec.durationSeconds < durationPolicy.minDurationSeconds
      || spec.durationSeconds > durationPolicy.maxDurationSeconds) {
      throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", `Storyboard shot durations must stay within the active source range of ${durationPolicy.minDurationSeconds} to ${durationPolicy.maxDurationSeconds} seconds.`);
    }
    const dependencies = new Set(spec.dependsOnSequences);
    if (dependencies.size !== spec.dependsOnSequences.length || [...dependencies].some((dependency) => !Number.isInteger(dependency) || dependency < 1 || dependency >= spec.sequence)) {
      throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "Storyboard dependencies must be unique accepted earlier sequences.");
    }
    total += spec.durationSeconds;
  }

  if (total !== input.totalDurationSeconds) {
    throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "Storyboard shot durations must match the planned total duration.");
  }
};

export const assertProductionRunCreatable = (storyboardStatus: CreativeRevisionStatus) => {
  if (storyboardStatus !== "APPROVED") {
    throw new DomainInvariantError("PRODUCTION_RUN_STATE_INVALID", "A production run requires an approved storyboard revision.");
  }
};
