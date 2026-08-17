import type { ContinuityLevel, ReferencePolicy } from "@alchemy-video/contracts";

export const DETERMINISTIC_PLANNER_VERSION = "c11-deterministic-event-planner-v1";
export const DETERMINISTIC_PROMPT_COMPILER_VERSION = "c12-continuity-prompt-compiler-v2";

export type PlanningInput = {
  sourceText: string;
  targetDurationSeconds: number;
  stylePreferences: string;
  sourceAssetIds: string[];
};

export type PlannedScriptBeat = {
  sequence: number;
  title: string;
  summary: string;
  narrativeGoal: string;
  visibleFacts: string[];
  generationSegmentSequence: number;
};

export type PlannedShotSpec = {
  sequence: number;
  title: string;
  durationSeconds: number;
  narrativeGoal: string;
  startState: string;
  endState: string;
  transitionSummary: string;
  referencePolicy: ReferencePolicy;
  dependsOnSequences: number[];
  continuityNote: string;
  narrativeBeatSequences: number[];
};

export type StoryboardPlanDraft = {
  plannerVersion: string;
  beats: PlannedScriptBeat[];
  title: string;
  summary: string;
  totalDurationSeconds: number;
  continuityLevel: ContinuityLevel;
  continuityNote: string;
  shotSpecs: PlannedShotSpec[];
  narrativeBeatCount: number;
  generationSegmentCount: number;
};

export interface PlanningModelPort {
  plan(input: PlanningInput): Promise<StoryboardPlanDraft>;
}

export type ApprovedShotSpecForCompilation = Pick<PlannedShotSpec,
  "title" | "narrativeGoal" | "startState" | "endState" | "transitionSummary" | "referencePolicy" | "continuityNote"
>;

export type CompilationInput = ApprovedShotSpecForCompilation & {
  stylePreferences: string;
};

export type CompiledPromptPackage = {
  compilerVersion: string;
  prompt: string;
  visualConstraints: Record<string, unknown>;
  referenceMap: Record<string, unknown>;
  capabilitySnapshot: Record<string, unknown>;
};

export interface StoryboardCompilerPort {
  compile(input: CompilationInput): Promise<CompiledPromptPackage>;
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const concise = (value: string, fallback: string) => {
  const normalized = normalize(value);
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized || fallback;
};

const authoringInstruction = /^(?:(?:请(?:你)?(?:把|将)?)|把|将).{0,120}(?:改编|设计|整理|写)(?:成|为).{0,30}(?:剧本|分镜|视频|短片|故事计划|脚本)[。！!]?$/u;

const eventSentences = (sourceText: string) => {
  const events = sourceText
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[。！？!?；;])\s*|\n+/u)
    .map((value) => normalize(value))
    .filter(Boolean);
  const narrativeEvents = events.filter((event) => !authoringInstruction.test(event));
  return narrativeEvents.length > 0 ? narrativeEvents : events.length > 0 ? events : [normalize(sourceText)];
};

const chooseGenerationSegmentCount = (targetDurationSeconds: number) => {
  if (targetDurationSeconds <= 15) return 1;
  return Math.min(60, Math.max(1, Math.ceil(targetDurationSeconds / 10)));
};

const distributeDuration = (totalDurationSeconds: number, count: number) => {
  const base = Math.floor(totalDurationSeconds / count);
  const remainder = totalDurationSeconds % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};

const distributeEvents = (events: string[], count: number) => Array.from({ length: count }, (_, index) => {
  const start = Math.floor((index * events.length) / count);
  const end = Math.floor(((index + 1) * events.length) / count);
  return events.slice(start, Math.max(start, end));
});

const shotReferencePolicy = (input: PlanningInput, sequence: number): ReferencePolicy => {
  if (input.sourceAssetIds.length > 0 && sequence === 1) return "REFERENCE_SET";
  if (input.sourceAssetIds.length > 0 && sequence > 1) return "HANDOFF_FIRST_FRAME";
  return "TEXT_TRANSITION";
};

export class DeterministicPlanningModel implements PlanningModelPort {
  async plan(input: PlanningInput): Promise<StoryboardPlanDraft> {
    const sourceText = normalize(input.sourceText);
    if (!sourceText) throw new Error("Planning requires a non-empty source story.");
    if (!Number.isInteger(input.targetDurationSeconds) || input.targetDurationSeconds < 15 || input.targetDurationSeconds > 600) {
      throw new Error("Planning duration must be an integer between 15 and 600 seconds.");
    }

    const events = eventSentences(sourceText);
    const generationSegmentCount = chooseGenerationSegmentCount(input.targetDurationSeconds);
    const durations = distributeDuration(input.targetDurationSeconds, generationSegmentCount);
    const groups = distributeEvents(events, generationSegmentCount);
    const continuityLevel: ContinuityLevel = input.sourceAssetIds.length > 0 && generationSegmentCount > 1 ? "REVIEW_REQUIRED" : "STANDARD";
    const title = concise(events[0] ?? sourceText, "故事计划");
    const beats = events.map((event, index) => {
      const segmentSequence = Math.min(
        generationSegmentCount,
        Math.floor((index * generationSegmentCount) / Math.max(1, events.length)) + 1,
      );
      const primaryEvent = concise(event, "故事推进");
      return {
        sequence: index + 1,
        title: `叙事点 ${index + 1}：${primaryEvent}`,
        summary: primaryEvent,
        narrativeGoal: primaryEvent,
        visibleFacts: [primaryEvent],
        generationSegmentSequence: segmentSequence,
      };
    });
    const shotSpecs = groups.map((group, index) => {
      const sequence = index + 1;
      const referencePolicy = shotReferencePolicy(input, sequence);
      const narrativeBeatSequences = beats
        .filter((beat) => beat.generationSegmentSequence === sequence)
        .map((beat) => beat.sequence);
      const primaryEvent = concise(group[0] ?? events[Math.min(events.length - 1, index)] ?? sourceText, "故事推进");
      const summary = concise(group.join(" "), primaryEvent);
      return {
        sequence,
        title: `生成片段 ${sequence}：${primaryEvent}`,
        durationSeconds: durations[index]!,
        narrativeGoal: summary,
        startState: index === 0 ? "故事开场状态" : `承接第 ${index} 段的结束状态`,
        endState: index === groups.length - 1 ? "完整故事目标完成" : `为第 ${index + 2} 段建立可见过渡`,
        transitionSummary: index === 0 ? "建立故事开场画面与核心人物状态。" : `从第 ${index} 段的结束动作或场景状态继续。`,
        referencePolicy,
        dependsOnSequences: index === 0 ? [] : [index],
        continuityNote: referencePolicy === "HANDOFF_FIRST_FRAME"
          ? "需要 C12 在前一段通过验收后提供交接首帧，并继续携带已选用户参考图稳定人物、服装和场景；当前计划不承诺帧级无缝。"
          : referencePolicy === "REFERENCE_SET"
            ? "优先保持已选参考素材中的人物或品牌风格一致。"
          : "使用明确转场说明承接叙事，不承诺视觉帧级连续。",
        narrativeBeatSequences: narrativeBeatSequences.length > 0
          ? narrativeBeatSequences
          : [Math.max(1, Math.min(beats.length, index + 1))],
      };
    });

    return {
      plannerVersion: DETERMINISTIC_PLANNER_VERSION,
      beats,
      title: `故事计划：${title}`,
      summary: `共 ${beats.length} 个叙事点，自动合并为 ${shotSpecs.length} 个生成片段，总时长 ${input.targetDurationSeconds} 秒。${normalize(input.stylePreferences) ? ` 风格偏好：${concise(input.stylePreferences, "")}` : ""}`,
      totalDurationSeconds: input.targetDurationSeconds,
      continuityLevel,
      continuityNote: continuityLevel === "REVIEW_REQUIRED"
        ? "后续段计划使用前段交接首帧或明确转场；当前能力需要在制作前逐段确认。"
        : "计划采用叙事和转场连续性，不承诺帧级无缝。",
      shotSpecs,
      narrativeBeatCount: beats.length,
      generationSegmentCount: shotSpecs.length,
    };
  }
}

export class DeterministicStoryboardCompiler implements StoryboardCompilerPort {
  async compile(input: CompilationInput): Promise<CompiledPromptPackage> {
    const stylePreferences = concise(input.stylePreferences, "");
    const referenceInstruction = input.referencePolicy === "REFERENCE_SET"
      ? "Treat the approved reference images as the visual source of truth for identity, hairstyle, wardrobe, palette, and scene language."
      : input.referencePolicy === "HANDOFF_FIRST_FRAME"
        ? "Use the first supplied reference image as the approved handoff opening frame. Begin from that image exactly; treat any additional approved reference images as identity, wardrobe, palette, and scene anchors."
        : "Use a deliberate cinematic transition; do not introduce an unexplained change of identity, wardrobe, setting, or time.";
    const prompt = [
      input.narrativeGoal,
      `Begin with: ${input.startState}`,
      `End with: ${input.endState}`,
      `Transition: ${input.transitionSummary}`,
      `Continuity: ${input.continuityNote}`,
      stylePreferences ? `Visual style: ${stylePreferences}` : "",
      referenceInstruction,
      "Keep character count and relative positions stable. Maintain natural human anatomy with correctly connected head, neck, shoulders, torso, arms, hands, and legs.",
    ].map(normalize).filter(Boolean).join(" ");
    return {
      compilerVersion: DETERMINISTIC_PROMPT_COMPILER_VERSION,
      prompt,
      visualConstraints: {
        start_state: input.startState,
        end_state: input.endState,
        continuity_note: input.continuityNote,
        style_preferences: stylePreferences || undefined,
        identity_wardrobe_scene_lock: true,
        stable_character_count_and_positions: true,
        natural_human_anatomy: true,
        boundary_transition: input.referencePolicy === "TEXT_TRANSITION" ? "deliberate" : "handoff_or_reference_locked",
      },
      referenceMap: { reference_policy: input.referencePolicy },
      capabilitySnapshot: {
        max_duration_seconds: 15,
        max_reference_images: 7,
        supports_reference_set: true,
        supports_handoff_first_frame: true,
        supports_handoff_plus_reference_set: true,
        handoff_plus_reference_set_order: "handoff_first_then_user_references",
        reference_set_and_handoff_are_mutually_exclusive: false,
      },
    };
  }
}
