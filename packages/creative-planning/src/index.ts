/**
 * Production-safe creative-planning surface.
 *
 * Real-provider code imports the provenance checker through the dedicated
 * semantic-director subpath. Legacy deterministic planning, prose parsing,
 * and compatibility compilers live only under the explicit ./mock export.
 */
export { buildNarrationTimeline, normalizeNarrationSections } from "./narration-quality.js";
export * from "./semantic-director.js";

export type PlanningDocumentContext = {
  documentId: string;
  conversionId: string;
  sourceAssetId: string;
  markdownAssetId: string;
  maxContentCharacters: number;
  content: string;
};
