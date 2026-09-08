import type { VisualReferenceRole } from "@alchemy-video/contracts";

export type ReferenceVisionObject = {
  name: string;
  description: string;
  relation: string;
  prohibited_changes: string[];
};

export type ReferenceVisionCandidate = {
  role: Exclude<VisualReferenceRole, "HANDOFF">;
  confidence: number;
  summary?: string;
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

const roleMap: Record<string, ReferenceVisionCandidate["role"]> = {
  SUBJECT: "SUBJECT",
  PERSON: "SUBJECT",
  CHARACTER: "SUBJECT",
  PRODUCT: "SUBJECT",
  SCENE: "SCENE",
  ENVIRONMENT: "SCENE",
  LOCATION: "SCENE",
  BACKGROUND: "SCENE",
  STYLE: "STYLE",
  PALETTE: "STYLE",
  WARDROBE: "STYLE",
};

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
  if (!value || typeof value !== "object") throw new ReferenceVisionAnalysisError(false, "Visual analysis returned no candidate.");
  const candidate = value as { role?: unknown; confidence?: unknown; summary?: unknown; objects?: unknown };
  const role = typeof candidate.role === "string" ? roleMap[candidate.role.trim().toUpperCase()] : undefined;
  const confidence = typeof candidate.confidence === "number" ? candidate.confidence : Number(candidate.confidence);
  if (!role || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ReferenceVisionAnalysisError(false, "Visual analysis returned an invalid role candidate.");
  }
  const objects = Array.isArray(candidate.objects)
    ? candidate.objects.flatMap((object) => {
      if (!object || typeof object !== "object") return [];
      const value = object as Record<string, unknown>;
      if (typeof value.name !== "string" || typeof value.description !== "string" || typeof value.relation !== "string") return [];
      const prohibited = Array.isArray(value.prohibited_changes) ? value.prohibited_changes.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
      return [{ name: value.name.trim().slice(0, 80), description: value.description.trim().slice(0, 300), relation: value.relation.trim().slice(0, 200), prohibited_changes: prohibited.map((item) => item.slice(0, 240)) }];
    }).filter((object) => object.name && object.description && object.relation).slice(0, 12)
    : undefined;
  return {
    role,
    confidence,
    ...(typeof candidate.summary === "string" && candidate.summary.trim() ? { summary: candidate.summary.trim().slice(0, 240) } : {}),
    ...(objects && objects.length > 0 ? { objects } : {}),
  };
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
              content: "你是参考素材视觉分析单元。只返回 JSON：{\"role\":\"SUBJECT|SCENE|STYLE\",\"confidence\":0到1,\"summary\":\"不超过240字\",\"objects\":[{\"name\":\"关键对象名称\",\"description\":\"外观和可辨识细节\",\"relation\":\"与人物或空间的关系\",\"prohibited_changes\":[\"不得替换或消失的变化\"]}]}。objects 只列最多12个清晰可辨识且对连续性重要的对象。不要按图片顺序猜测。",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "识别这张参考图的主要用途。" },
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
