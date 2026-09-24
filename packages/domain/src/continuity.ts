import type {
  HandoffReviewReasonCode,
  HandoffReviewResult,
  TransitionRepairStrategy,
} from "@alchemy-video/contracts";

export type HandoffEvaluation = {
  result: HandoffReviewResult;
  reasonCodes: HandoffReviewReasonCode[];
  safeSummary: string;
  evaluatorVersion: string;
  retryable: boolean;
};

export type HandoffEvaluatorPort = {
  evaluate(input: {
    fromTailFrame: Uint8Array;
    toHeadFrame: Uint8Array;
    continuityHints: {
      characterCount?: number;
      sceneSummary: string;
      wardrobeSummary?: string;
      actionDirection?: string;
    };
  }): Promise<HandoffEvaluation>;
};

export type ContinuityDecision = {
  strategy: TransitionRepairStrategy | "PASS";
  continuityStatus: "GOOD" | "AUTO_REPAIRING" | "NEEDS_ATTENTION";
  durationMs: number;
  shouldCreateRepair: boolean;
};

export const decideContinuityRepair = (input: {
  evaluation: HandoffEvaluation;
  repairCount: number;
  maxRepairCount: number;
  defaultBlendDurationMs?: number;
  bridgeDurationMs?: number;
}): ContinuityDecision => {
  // A semantic review may recommend a blend or bridge, but a recommendation
  // is not a repair task or media artifact. Until a real executor persists an
  // output and QC receipt, the platform must keep the run reviewable instead
  // of inventing a duration and auto-accepting a transition.
  switch (input.evaluation.result) {
    case "PASS":
      return { strategy: "PASS", continuityStatus: "GOOD", durationMs: 0, shouldCreateRepair: false };
    case "BLEND":
      return { strategy: "BLEND", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false };
    case "BRIDGE_REQUIRED":
      return { strategy: "BRIDGE", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false };
    case "UNAVAILABLE":
    case "FAILED":
      return { strategy: "PASS", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false };
  }
};

export const normalizeContinuitySummary = (summary: string, fallback: string) => {
  const normalized = summary.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  return normalized || fallback;
};
