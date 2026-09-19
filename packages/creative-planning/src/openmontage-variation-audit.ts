/*
 * Thin TypeScript adaptation of upstream OpenMontage's
 * lib/variation_checker.py (commit 4eab34c5cfcccaa4f1970554928feccce73ee930).
 * The checks and thresholds intentionally stay source-aligned; this adapter
 * only accepts the platform's private scene projection and returns the source
 * result without importing OpenMontage's filesystem or Agent state.
 */

type OpenMontageScene = Readonly<{
  shot_language?: Readonly<{
    shot_size?: string;
    camera_movement?: string;
    lighting_key?: string;
  }>;
  description?: string;
  hero_moment?: boolean;
  texture_keywords?: readonly string[];
  shot_intent?: string;
}>;

export type OpenMontageVariationResult = Readonly<{
  score: number;
  verdict: "strong" | "acceptable" | "revise" | "fail";
  violations: readonly string[];
  suggestions: readonly string[];
}>;

export type OpenMontageSlideshowRiskResult = Readonly<{
  average: number;
  verdict: "strong" | "acceptable" | "revise" | "fail";
  dimensions: Readonly<Record<string, { score: number; reason: string }>>;
}>;

const GENERIC_PHRASES = [
  "a person", "a beautiful", "modern", "futuristic", "cutting-edge",
  "in today's world", "sleek design", "innovative", "state-of-the-art",
  "next-generation", "revolutionary", "a professional", "dynamic",
  "vibrant", "stunning", "breathtaking", "amazing", "incredible",
  "powerful", "seamless", "elegant solution",
];

export const checkOpenMontageSceneVariation = (
  scenes: readonly OpenMontageScene[],
): OpenMontageVariationResult => {
  if (scenes.length === 0) {
    return { score: 5, verdict: "fail", violations: ["No scenes to check"], suggestions: [] };
  }
  const violations: string[] = [];
  const suggestions: string[] = [];
  const shotSizes = scenes.map((scene) => scene.shot_language?.shot_size ?? "unspecified");
  const sizeCounts = new Map<string, number>();
  for (const size of shotSizes) sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1);
  if (scenes.length >= 4) {
    const [mostCommonSize, mostCommonCount] = [...sizeCounts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (mostCommonCount / scenes.length > 0.5) {
      violations.push(`Shot size '${mostCommonSize}' used in ${mostCommonCount}/${scenes.length} scenes (${Math.round(mostCommonCount / scenes.length * 100)}%). Vary shot sizes for visual interest.`);
      suggestions.push("Mix wide establishing shots with close-ups for visual rhythm.");
    }
  }
  let longestRun = shotSizes.length > 0 ? 1 : 0;
  let currentRun = 1;
  for (let index = 1; index < shotSizes.length; index += 1) {
    if (shotSizes[index] === shotSizes[index - 1] && shotSizes[index] !== "unspecified") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else currentRun = 1;
  }
  if (longestRun >= 3) violations.push(`${longestRun} consecutive same-size shots. Vary shot sizes between scenes for editorial rhythm.`);
  const movements = scenes.map((scene) => scene.shot_language?.camera_movement ?? "unspecified");
  const staticCount = movements.filter((movement) => movement === "static" || movement === "unspecified").length;
  if (scenes.length >= 4 && staticCount / scenes.length > 0.6) {
    violations.push(`${staticCount}/${scenes.length} scenes are static or unspecified movement. Add intentional camera movement to at least 40% of scenes.`);
    suggestions.push("Consider dolly_in for emphasis, tracking for energy, or crane for scale.");
  }
  const lightings = new Set(scenes.map((scene) => scene.shot_language?.lighting_key).filter(Boolean));
  if (scenes.length >= 4 && lightings.size <= 1) {
    violations.push(`Only ${lightings.size} unique lighting setup(s) across ${scenes.length} scenes. Vary lighting to create mood shifts.`);
  }
  const heroScenes = scenes.filter((scene) => scene.hero_moment);
  if (scenes.length >= 4 && heroScenes.length === 0) {
    violations.push("No hero_moment flagged. Every video should have at least one visual peak.");
    suggestions.push("Mark the most impactful scene as hero_moment=true.");
  }
  for (const hero of heroScenes) {
    const heroIndex = scenes.indexOf(hero);
    const heroSize = hero.shot_language?.shot_size;
    for (const offset of [-1, 1]) {
      const neighbor = scenes[heroIndex + offset];
      const neighborSize = neighbor?.shot_language?.shot_size;
      if (heroSize && neighborSize && heroSize === neighborSize) {
        violations.push(`Hero scene '${heroIndex + 1}' has same shot size as neighbor. Hero moments should be visually distinct from surrounding scenes.`);
      }
    }
  }
  let genericCount = 0;
  for (const scene of scenes) {
    const description = (scene.description ?? "").toLowerCase();
    if (GENERIC_PHRASES.some((phrase) => description.includes(phrase))) genericCount += 1;
  }
  if (genericCount >= scenes.length * 0.3) {
    violations.push(`${genericCount}/${scenes.length} scenes use generic language. Replace vague descriptions with specific visual details.`);
    suggestions.push("Replace vague descriptions with specific visual details.");
  }
  const textured = scenes.filter((scene) => Boolean(scene.texture_keywords?.length)).length;
  if (scenes.length >= 4 && textured < scenes.length * 0.3) {
    violations.push(`Only ${textured}/${scenes.length} scenes have texture_keywords. Add texture descriptors to visual scenes for richer generation prompts.`);
  }
  const intented = scenes.filter((scene) => Boolean(scene.shot_intent)).length;
  if (scenes.length >= 4 && intented < scenes.length * 0.5) {
    violations.push(`Only ${intented}/${scenes.length} scenes have shot_intent. Every scene should explain WHY it exists in the video.`);
  }
  const score = Math.min(5, violations.length * 0.6);
  const verdict = score < 2 ? "strong" : score < 3 ? "acceptable" : score < 4 ? "revise" : "fail";
  return { score: Math.round(score * 10) / 10, verdict, violations, suggestions };
};

// Faithful adaptation of OpenMontage lib/slideshow_risk.py. The platform
// supplies only private scene metadata; renderer and filesystem state stay out.
export const scoreOpenMontageSlideshowRisk = (
  scenes: readonly (OpenMontageScene & Readonly<{
    type?: string;
    information_role?: string;
    narrative_role?: string;
  }>)[],
  rendererFamily?: string,
): OpenMontageSlideshowRiskResult => {
  if (scenes.length === 0) return { average: 5, verdict: "fail", dimensions: {} };
  const descriptions = scenes.map((scene) => (scene.description ?? "").toLowerCase().slice(0, 50));
  const types = scenes.map((scene) => scene.type ?? "unknown");
  const sizes = scenes.map((scene) => scene.shot_language?.shot_size ?? "none");
  const repeatedType = Math.max(...types.map((type) => types.filter((value) => value === type).length)) / scenes.length;
  const repeatedSize = Math.max(...sizes.map((size) => sizes.filter((value) => value === size).length)) / scenes.length;
  const uniqueDescriptionRatio = new Set(descriptions).size / descriptions.length;
  const dimensions: Record<string, { score: number; reason: string }> = {};
  const repetitionScore = Math.min(5, (repeatedType > 0.7 ? 2 : 0) + (uniqueDescriptionRatio < 0.6 ? 1.5 : 0) + (repeatedSize > 0.6 ? 1.5 : 0));
  dimensions.repetition = { score: repetitionScore, reason: repetitionScore > 0 ? "Repeated scene grammar or descriptions detected" : "Good variety" };
  const decorative = scenes.filter((scene) => !scene.information_role && !scene.narrative_role && !scene.shot_intent).length;
  dimensions.decorative_visuals = { score: Math.min(5, decorative / scenes.length * 5), reason: decorative ? `${decorative}/${scenes.length} scenes lack a stated purpose` : "Most scenes have clear communicative purpose" };
  const moving = scenes.filter((scene) => {
    const movement = scene.shot_language?.camera_movement ?? "static";
    return movement !== "static" && movement !== "unspecified";
  });
  const purposeless = moving.filter((scene) => !scene.shot_intent).length;
  dimensions.weak_motion = { score: moving.length === 0 ? 1.5 : Math.min(5, purposeless / moving.length * 4), reason: moving.length === 0 ? "No camera movement defined" : purposeless ? `${purposeless}/${moving.length} moving shots lack shot_intent` : "Camera movement appears purposeful" };
  const intentRatio = scenes.filter((scene) => Boolean(scene.shot_intent)).length / scenes.length;
  dimensions.weak_shot_intent = { score: Math.min(5, (1 - intentRatio) * 5), reason: intentRatio >= 0.6 ? "Strong shot intent coverage" : "Several shots lack explicit intent" };
  const textRatio = scenes.filter((scene) => ["text_card", "stat_card", "kpi_grid"].includes(scene.type ?? "")).length / scenes.length;
  dimensions.typography_overreliance = { score: textRatio > 0.6 ? 4 : textRatio > 0.4 ? 2.5 : textRatio > 0.2 ? 1 : 0, reason: textRatio > 0.6 ? "Text-based scenes dominate" : "Visual-first approach" };
  const cinematic = rendererFamily?.toLowerCase().includes("cinematic") ?? false;
  const cinematicIssues = cinematic ? [
    scenes.some((scene) => scene.hero_moment) ? "" : "no hero_moment",
    scenes.filter((scene) => (scene.shot_language?.camera_movement ?? "static") !== "static").length >= scenes.length * 0.3 ? "" : "insufficient camera movement",
    scenes.filter((scene) => Boolean(scene.shot_language?.lighting_key)).length >= scenes.length * 0.3 ? "" : "insufficient lighting structure",
  ].filter(Boolean) : [];
  dimensions.unsupported_cinematic_claims = { score: Math.min(5, cinematicIssues.length * 1.8), reason: cinematicIssues.length ? `Cinematic claim gaps: ${cinematicIssues.join(", ")}` : "Cinematic claims supported or not asserted" };
  const scores = Object.values(dimensions).map((dimension) => dimension.score);
  const average = scores.reduce((total, score) => total + score, 0) / scores.length;
  const verdict = average < 2 ? "strong" : average < 3 ? "acceptable" : average < 4 ? "revise" : "fail";
  return { average: Math.round(average * 100) / 100, verdict, dimensions };
};
