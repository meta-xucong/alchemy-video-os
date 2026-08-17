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
  FAILED: [],
};

export type PlannedShotSpec = {
  sequence: number;
  durationSeconds: number;
  dependsOnSequences: number[];
};

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

export const assertStoryboardPlan = (input: { totalDurationSeconds: number; specs: PlannedShotSpec[] }) => {
  if (!Number.isInteger(input.totalDurationSeconds) || input.totalDurationSeconds < 1 || input.specs.length < 1) {
    throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "A storyboard requires a positive total duration and at least one ordered shot.");
  }

  let total = 0;
  for (const [index, spec] of input.specs.entries()) {
    if (!Number.isInteger(spec.sequence) || spec.sequence !== index + 1) {
      throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "Storyboard shot sequences must start at one and remain contiguous.");
    }
    if (!Number.isInteger(spec.durationSeconds) || spec.durationSeconds < 1 || spec.durationSeconds > 15) {
      throw new DomainInvariantError("STORYBOARD_SPEC_INVALID", "Storyboard shot durations must stay within the certified local capability range.");
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
