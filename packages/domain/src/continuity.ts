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
      characterCount: number;
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
  const blendDurationMs = input.defaultBlendDurationMs ?? 600;
  const bridgeDurationMs = Math.min(3_000, Math.max(1_000, input.bridgeDurationMs ?? 2_000));

  switch (input.evaluation.result) {
    case "PASS":
      return { strategy: "PASS", continuityStatus: "GOOD", durationMs: 0, shouldCreateRepair: false };
    case "BLEND":
      return { strategy: "BLEND", continuityStatus: "GOOD", durationMs: blendDurationMs, shouldCreateRepair: true };
    case "BRIDGE_REQUIRED":
      if (input.repairCount >= input.maxRepairCount) {
        return { strategy: "PASS", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false };
      }
      return { strategy: "BRIDGE", continuityStatus: "AUTO_REPAIRING", durationMs: bridgeDurationMs, shouldCreateRepair: true };
    case "UNAVAILABLE":
      return { strategy: "PASS", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false };
    case "FAILED":
      return { strategy: "PASS", continuityStatus: "NEEDS_ATTENTION", durationMs: 0, shouldCreateRepair: false };
  }
};

export const normalizeContinuitySummary = (summary: string, fallback: string) => {
  const normalized = summary.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  return normalized || fallback;
};
