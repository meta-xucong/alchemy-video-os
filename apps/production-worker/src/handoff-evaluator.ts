import type { HandoffReviewReasonCode } from "@alchemy-video/contracts";
import type { HandoffEvaluation, HandoffEvaluatorPort } from "@alchemy-video/domain";

const evaluatorResults = new Set(["PASS", "BLEND", "BRIDGE_REQUIRED"] as const);
const evaluatorReasonCodes = new Set<HandoffReviewReasonCode>([
  "IDENTITY_DRIFT",
  "WARDROBE_DRIFT",
  "SCENE_DRIFT",
  "COMPOSITION_JUMP",
  "ACTION_DIRECTION_BREAK",
]);
type EvaluatorResult = "PASS" | "BLEND" | "BRIDGE_REQUIRED";

type HandoffEvaluatorConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

type HandoffEvaluatorRequest = {
  fromTailFrame: Uint8Array;
  toHeadFrame: Uint8Array;
  continuityHints: {
    characterCount?: number;
    sceneSummary: string;
    wardrobeSummary?: string;
    actionDirection?: string;
  };
};

class HandoffEvaluatorProtocolError extends Error {
  constructor() {
    super("Handoff evaluator returned an invalid decision.");
    this.name = "HandoffEvaluatorProtocolError";
  }
}

export class HandoffEvaluatorTransportError extends Error {
  readonly retryable = true as const;

  constructor() {
    super("Handoff evaluator transport is unavailable.");
    this.name = "HandoffEvaluatorTransportError";
  }
}

const endpointFor = (baseUrl: string) => {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (url.username || url.password || url.search || url.hash) {
    throw new HandoffEvaluatorProtocolError();
  }
  return new URL("chat/completions", url).toString();
};

const isEvaluatorResult = (value: unknown): value is EvaluatorResult =>
  typeof value === "string" && evaluatorResults.has(value as EvaluatorResult);

const isReasonCode = (value: unknown): value is HandoffReviewReasonCode =>
  typeof value === "string" && evaluatorReasonCodes.has(value as HandoffReviewReasonCode);
const parseDecision = (content: unknown, evaluatorVersion: string): HandoffEvaluation => {
  if (typeof content !== "string" || !content.trim()) throw new HandoffEvaluatorProtocolError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HandoffEvaluatorProtocolError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HandoffEvaluatorProtocolError();
  }
  const record = parsed as Record<string, unknown>;
  if (!isEvaluatorResult(record.result)) throw new HandoffEvaluatorProtocolError();
  if (!Array.isArray(record.reason_codes) || record.reason_codes.some((code) => !isReasonCode(code))) {
    throw new HandoffEvaluatorProtocolError();
  }
  const reasonCodes = record.reason_codes as HandoffReviewReasonCode[];
  if (new Set(reasonCodes).size !== reasonCodes.length) throw new HandoffEvaluatorProtocolError();
  const summary = typeof record.summary === "string"
    ? record.summary.replace(/[\\r\\n\\t]+/g, " ").trim().slice(0, 240)
    : "";
  if (!summary) throw new HandoffEvaluatorProtocolError();
  return {
    result: record.result,
    reasonCodes,
    safeSummary: summary,
    evaluatorVersion,
    retryable: false,
  };
};

const failedEvaluation = (evaluatorVersion: string): HandoffEvaluation => ({
  result: "FAILED",
  reasonCodes: ["EVALUATOR_FAILED"],
  safeSummary: "连续性评估器返回了无法验证的结果。",
  evaluatorVersion,
  retryable: false,
});
export class OpenAiCompatibleHandoffEvaluator implements HandoffEvaluatorPort {
  private readonly endpoint: string;
  private readonly evaluatorVersion = "handoff-vision-v1";

  constructor(private readonly input: HandoffEvaluatorConfig) {
    if (!input.apiKey.trim() || !input.model.trim()) throw new HandoffEvaluatorProtocolError();
    this.endpoint = endpointFor(input.baseUrl);
  }

  async evaluate(input: HandoffEvaluatorRequest): Promise<HandoffEvaluation> {
    const fetcher = this.input.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 45_000);
    try {
      const response = await fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.input.model,
          temperature: 0,
          max_tokens: 512,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "你是相邻视频片段的视觉连续性评估器。只返回 JSON：{\"result\":\"PASS|BLEND|BRIDGE_REQUIRED\",\"reason_codes\":[],\"summary\":\"不超过240字\"}。reason_codes 只能使用这五个枚举值：IDENTITY_DRIFT、WARDROBE_DRIFT、SCENE_DRIFT、COMPOSITION_JUMP、ACTION_DIRECTION_BREAK；不可输出自然语言或其他字符串，不可重复。PASS 只表示两帧中的主体、场景、构图和动作方向可以自然直切；BLEND 表示可用受限淡变；BRIDGE_REQUIRED 表示需要人工关注的桥接方案。无法可靠判断时不要返回 PASS。不要编造看不见的内容，不要修改图片，不要输出 JSON 以外的文字。",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    instruction: "比较前段尾帧与后段首帧。以下上下文仅作辅助，不可覆盖图像事实。",
                    scene_summary: input.continuityHints.sceneSummary.slice(0, 1_000),
                    character_count: input.continuityHints.characterCount,
                    wardrobe_summary: input.continuityHints.wardrobeSummary?.slice(0, 500),
                    action_direction: input.continuityHints.actionDirection?.slice(0, 500),
                    frame_order: ["from_tail", "to_head"],
                  }),
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${Buffer.from(input.fromTailFrame).toString("base64")}` },
                },
                {
                  type: "text",
                  text: "上面第一张是前段尾帧，下面第二张是后段首帧。",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${Buffer.from(input.toHeadFrame).toString("base64")}` },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) throw new HandoffEvaluatorTransportError();
        return failedEvaluation(this.evaluatorVersion);
      }
      const payload = await response.json().catch(() => undefined) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | undefined;
      const content = payload?.choices?.[0]?.message?.content;
      try {
        return parseDecision(content, this.evaluatorVersion);
      } catch (error) {
        if (error instanceof HandoffEvaluatorProtocolError) return failedEvaluation(this.evaluatorVersion);
        return failedEvaluation(this.evaluatorVersion);
      }
    } catch (error) {
      if (error instanceof HandoffEvaluatorTransportError) throw error;
      if (error instanceof HandoffEvaluatorProtocolError) return failedEvaluation(this.evaluatorVersion);
      throw new HandoffEvaluatorTransportError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const createHandoffEvaluatorFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): HandoffEvaluatorPort | undefined => {
  const baseUrl = env.HANDOFF_EVALUATOR_BASE_URL?.trim();
  const apiKey = env.HANDOFF_EVALUATOR_API_KEY?.trim();
  const model = env.HANDOFF_EVALUATOR_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return new OpenAiCompatibleHandoffEvaluator({ baseUrl, apiKey, model });
};
