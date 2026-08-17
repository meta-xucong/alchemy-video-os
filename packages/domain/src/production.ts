import type { ProductionSegmentStatus } from "@alchemy-video/contracts";

import { DomainInvariantError } from "./errors.js";

export const PRODUCTION_SEGMENT_TRANSITIONS: Readonly<Record<ProductionSegmentStatus, readonly ProductionSegmentStatus[]>> = {
  PENDING: ["WAITING", "GENERATING", "FAILED"],
  WAITING: ["GENERATING", "FAILED"],
  GENERATING: ["CHECKING", "FAILED"],
  CHECKING: ["ACCEPTED", "FAILED"],
  ACCEPTED: [],
  FAILED: ["GENERATING"],
};

export const assertProductionSegmentTransition = (from: ProductionSegmentStatus, to: ProductionSegmentStatus) => {
  if (!PRODUCTION_SEGMENT_TRANSITIONS[from].includes(to)) {
    throw new DomainInvariantError("PRODUCTION_SEGMENT_STATE_INVALID", `Cannot transition a production segment from ${from} to ${to}.`);
  }
};

export const assertProductionSegmentDependencies = (input: {
  sequence: number;
  dependencySequences: readonly number[];
  acceptedSequences: readonly number[];
}) => {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new DomainInvariantError("PRODUCTION_SEGMENT_STATE_INVALID", "A production segment sequence must be positive.");
  }
  const accepted = new Set(input.acceptedSequences);
  const dependencies = new Set(input.dependencySequences);
  if (dependencies.size !== input.dependencySequences.length
    || [...dependencies].some((sequence) => !Number.isInteger(sequence) || sequence < 1 || sequence >= input.sequence)
    || [...dependencies].some((sequence) => !accepted.has(sequence))) {
    throw new DomainInvariantError("PRODUCTION_SEGMENT_STATE_INVALID", "A production segment cannot start until every earlier dependency is accepted.");
  }
};

export const assertProductionAcceptanceCount = (input: { acceptedShotCount: number; totalShotCount: number }) => {
  if (!Number.isInteger(input.totalShotCount) || input.totalShotCount < 1
    || !Number.isInteger(input.acceptedShotCount)
    || input.acceptedShotCount < 0
    || input.acceptedShotCount > input.totalShotCount) {
    throw new DomainInvariantError("PRODUCTION_SEGMENT_STATE_INVALID", "Production acceptance counts must remain within the frozen plan.");
  }
};
