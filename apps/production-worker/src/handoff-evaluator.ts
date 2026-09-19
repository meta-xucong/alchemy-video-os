import type { HandoffEvaluation, HandoffEvaluatorPort } from "@alchemy-video/domain";

const safeSummary = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);

export const createFixtureHandoffEvaluator = (input: {
  result?: HandoffEvaluation["result"];
  reasonCodes?: HandoffEvaluation["reasonCodes"];
  safeSummary?: string;
} = {}): HandoffEvaluatorPort => ({
  async evaluate(value) {
    if (value.fromTailFrame.byteLength === 0 || value.toHeadFrame.byteLength === 0) {
      return {
        result: "FAILED",
        reasonCodes: ["EVALUATOR_FAILED"],
        safeSummary: "衔接检查输入不完整。",
        evaluatorVersion: "fixture-v1",
        retryable: false,
      };
    }
    const result = input.result ?? "UNAVAILABLE";
    return {
      result,
      reasonCodes: input.reasonCodes ?? (result === "UNAVAILABLE" ? ["EVALUATOR_UNAVAILABLE"] : []),
      safeSummary: safeSummary(input.safeSummary ?? (result === "UNAVAILABLE" ? "语义评估器暂不可用，使用安全转场。" : "衔接检查已完成。")),
      evaluatorVersion: "fixture-v1",
      retryable: result === "UNAVAILABLE",
    };
  },
});
