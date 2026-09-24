export type ReferenceVisionObject = {
  name: string;
  description: string;
  relation: string;
};

export type ReferenceVisionCandidate = {
  /** Objective description only; it never declares how the user intends to use the image. */
  summary: string;
  objects?: ReferenceVisionObject[];
};

export type ReferenceVisionAnalysisInput = {
  assetId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
};

export interface ReferenceVisionAnalyzerPort {
  analyze(input: ReferenceVisionAnalysisInput): Promise<ReferenceVisionCandidate>;
}

export class ReferenceVisionAnalysisError extends Error {
  constructor(readonly retryable: boolean, message: string) {
    super(message);
    this.name = "ReferenceVisionAnalysisError";
  }
}

const jsonFromContent = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ReferenceVisionAnalysisError(false, "Visual analysis returned invalid JSON.");
  }
};

const parseCandidate = (value: unknown): ReferenceVisionCandidate => {
  if (!value || typeof value !== "object") throw new ReferenceVisionAnalysisError(false, "Visual analysis returned no objective observation.");
  const candidate = value as { summary?: unknown; objects?: unknown };
  const summary = typeof candidate.summary === "string" ? candidate.summary.trim().slice(0, 2_000) : "";
  if (!summary) throw new ReferenceVisionAnalysisError(false, "Visual analysis returned no objective summary.");
  const objects = Array.isArray(candidate.objects)
    ? candidate.objects.flatMap((object) => {
      if (!object || typeof object !== "object") return [];
      const item = object as Record<string, unknown>;
      if (typeof item.name !== "string" || typeof item.description !== "string" || typeof item.relation !== "string") return [];
      return [{
        name: item.name.trim().slice(0, 80),
        description: item.description.trim().slice(0, 300),
        relation: item.relation.trim().slice(0, 200),
      }];
    }).filter((object) => object.name && object.description && object.relation).slice(0, 12)
    : undefined;
  return { summary, ...(objects && objects.length > 0 ? { objects } : {}) };
};

const endpointFor = (baseUrl: string) => {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (url.username || url.password || url.search || url.hash) throw new ReferenceVisionAnalysisError(false, "Reference vision base URL is invalid.");
  return new URL("chat/completions", url).toString();
};

/** OpenAI-compatible multimodal adapter. It is opt-in and never used without an explicit endpoint and key. */
export class OpenAiCompatibleReferenceVisionAnalyzer implements ReferenceVisionAnalyzerPort {
  private readonly endpoint: string;

  constructor(private readonly input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
  }) {
    if (!input.apiKey.trim() || !input.model.trim()) throw new ReferenceVisionAnalysisError(false, "Reference vision credentials are incomplete.");
    this.endpoint = endpointFor(input.baseUrl);
  }

  async analyze(input: ReferenceVisionAnalysisInput): Promise<ReferenceVisionCandidate> {
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
          // Keep the provider's structured object complete. OpenMontage's
          // source LLM configuration uses the same 4096-token response
          // budget for visual analysis.
          max_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "你是参考素材的客观视觉观察单元。只返回 JSON：{\"summary\":\"不超过2000字的可见内容描述\",\"objects\":[{\"name\":\"可见对象名称\",\"description\":\"可直接观察到的外观、颜色、材质与细节\",\"relation\":\"可直接观察到的空间或持有关系\"}]}。不要判断图片用途、SUBJECT/SCENE/STYLE 角色、用户意图、控制维度、创作重要性、产品功效或连续性策略；不要补充看不见的身份和关系。",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "仅描述这张图中可以直接观察到的内容。" },
                { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}` } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ReferenceVisionAnalysisError(response.status >= 500 || response.status === 429, "Reference vision service rejected the analysis request.");
      const payload = await response.json().catch(() => undefined) as { choices?: Array<{ message?: { content?: unknown } }> } | undefined;
      const content = payload?.choices?.[0]?.message?.content;
      return parseCandidate(jsonFromContent(content));
    } catch (error) {
      if (error instanceof ReferenceVisionAnalysisError) throw error;
      throw new ReferenceVisionAnalysisError(true, "Reference vision service is unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const createReferenceVisionAnalyzerFromEnv = (env: NodeJS.ProcessEnv = process.env): ReferenceVisionAnalyzerPort | undefined => {
  const baseUrl = env.REFERENCE_VISION_BASE_URL?.trim();
  const apiKey = env.REFERENCE_VISION_API_KEY?.trim();
  const model = env.REFERENCE_VISION_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return new OpenAiCompatibleReferenceVisionAnalyzer({ baseUrl, apiKey, model });
};
