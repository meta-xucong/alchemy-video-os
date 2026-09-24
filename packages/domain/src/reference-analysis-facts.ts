import type { VisualReferenceRole } from "@alchemy-video/contracts";

/**
 * Objective, persisted observations from the vision adapter.
 * Historical role/confidence fields are accepted for read compatibility only;
 * this parser never assigns a role or infers user intent.
 */
export type VisualReferenceAnalysis = {
  role?: Exclude<VisualReferenceRole, "HANDOFF">;
  confidence?: number;
  summary?: string;
  objects?: Array<{
    name: string;
    description: string;
    relation: string;
    prohibited_changes: string[];
  }>;
};

const validHistoricalRole = (value: unknown): value is Exclude<VisualReferenceRole, "HANDOFF"> =>
  value === "SUBJECT" || value === "SCENE" || value === "STYLE";

/** Structural validation only; no keyword matching, scoring, or role choice. */
export const parseVisualReferenceAnalysis = (value: unknown): VisualReferenceAnalysis | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { role?: unknown; confidence?: unknown; summary?: unknown; objects?: unknown };
  const summary = typeof candidate.summary === "string" && candidate.summary.trim()
    ? candidate.summary.trim().slice(0, 2_000)
    : undefined;
  const objects = Array.isArray(candidate.objects)
    ? candidate.objects.flatMap((object) => {
      if (!object || typeof object !== "object") return [];
      const item = object as Record<string, unknown>;
      if (typeof item.name !== "string"
        || typeof item.description !== "string"
        || typeof item.relation !== "string") return [];
      const prohibited = Array.isArray(item.prohibited_changes)
        ? item.prohibited_changes.filter((entry): entry is string => typeof entry === "string").slice(0, 4)
        : [];
      return [{
        name: item.name.trim().slice(0, 80),
        description: item.description.trim().slice(0, 300),
        relation: item.relation.trim().slice(0, 200),
        prohibited_changes: prohibited.map((entry) => entry.slice(0, 240)),
      }];
    }).filter((object) => object.name && object.description && object.relation).slice(0, 12)
    : undefined;
  const confidence = typeof candidate.confidence === "number"
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0
    && candidate.confidence <= 1
    ? candidate.confidence
    : undefined;
  const role = validHistoricalRole(candidate.role) && confidence !== undefined
    ? candidate.role
    : undefined;
  if (!summary && (!objects || objects.length === 0) && !role) return undefined;
  return {
    ...(role ? { role, confidence } : {}),
    ...(summary ? { summary } : {}),
    ...(objects && objects.length > 0 ? { objects } : {}),
  };
};
