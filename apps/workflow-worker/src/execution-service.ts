import {
  DeterministicStoryboardCompiler,
  type PlanningModelPort,
  type StoryboardCompilerPort,
} from "@alchemy-video/creative-planning";
import { createPrefixedId } from "@alchemy-video/domain";
import type { ControlCreativeBriefRevision, CreativePlanningEvent, CreativePlanningStore } from "@alchemy-video/persistence";

export class CreativePlanningExecutor {
  constructor(
    private readonly store: Pick<CreativePlanningStore, "completeCreativePlan">,
    private readonly planner: PlanningModelPort,
    private readonly compiler: StoryboardCompilerPort = new DeterministicStoryboardCompiler(),
  ) {}

  async execute(input: { brief: ControlCreativeBriefRevision; event: CreativePlanningEvent }) {
    const planned = await this.planner.plan({
      sourceText: input.brief.sourceText,
      targetDurationSeconds: input.brief.targetDurationSeconds,
      stylePreferences: input.brief.stylePreferences,
      sourceAssetIds: input.brief.sourceAssetIds,
    });
    const shotSpecs = planned.shotSpecs.map((shotSpec) => ({
      id: createPrefixedId("ssp"),
      sequence: shotSpec.sequence,
      title: shotSpec.title,
      durationSeconds: shotSpec.durationSeconds,
      narrativeGoal: shotSpec.narrativeGoal,
      startState: shotSpec.startState,
      endState: shotSpec.endState,
      transitionSummary: shotSpec.transitionSummary,
      referencePolicy: shotSpec.referencePolicy,
      dependsOnSequences: shotSpec.dependsOnSequences,
      continuityNote: shotSpec.continuityNote,
      narrativeBeatSequences: shotSpec.narrativeBeatSequences,
    }));
    const promptPackages = await Promise.all(shotSpecs.map(async (shotSpec) => {
      const compiled = await this.compiler.compile({
        ...shotSpec,
        stylePreferences: input.brief.stylePreferences,
      });
      return {
        id: createPrefixedId("ppk"),
        shotSpecId: shotSpec.id,
        compilerVersion: compiled.compilerVersion,
        prompt: compiled.prompt,
        visualConstraints: compiled.visualConstraints,
        referenceMap: compiled.referenceMap,
        capabilitySnapshot: compiled.capabilitySnapshot,
      };
    }));
    return this.store.completeCreativePlan({
      workspaceId: input.brief.workspaceId,
      creativeBriefRevisionId: input.brief.id,
      draft: {
        scriptRevisionId: createPrefixedId("scr"),
        storyboardRevisionId: createPrefixedId("sbr"),
        beats: planned.beats.map((beat) => ({
          sequence: beat.sequence,
          title: beat.title,
          summary: beat.summary,
          narrative_goal: beat.narrativeGoal,
          visible_facts: beat.visibleFacts,
          generation_segment_sequence: beat.generationSegmentSequence,
        })),
        title: planned.title,
        summary: planned.summary,
        totalDurationSeconds: planned.totalDurationSeconds,
        continuityLevel: planned.continuityLevel,
        continuityNote: planned.continuityNote,
        shotSpecs,
        narrativeBeatCount: planned.narrativeBeatCount,
        generationSegmentCount: planned.generationSegmentCount,
        promptPackages,
      },
      event: input.event,
    });
  }
}
