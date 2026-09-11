import {
  DeterministicStoryboardCompiler,
  type PlanningModelPort,
  type StoryboardPlanDraft,
  type StoryboardCompilerPort,
} from "@alchemy-video/creative-planning";
import { DeterministicFactSelector, type FactSelectionPort } from "@alchemy-video/document-intelligence";
import { createPrefixedId, DEFAULT_STORYBOARD_DURATION_POLICY, type StoryboardDurationPolicy } from "@alchemy-video/domain";
import {
  compactRuntimePrompt,
  UnsupportedVideoGenerationInputError,
  type VideoProviderRuntimeProfile,
} from "@alchemy-video/provider-video";
import type { ControlCreativeBriefRevision, CreativePlanningDraft, CreativePlanningEvent, CreativePlanningStore } from "@alchemy-video/persistence";
import type { VideoAudioOwner } from "@alchemy-video/contracts";

import type { BoundedDocumentContextReader } from "./document-context-reader.js";

/**
 * Keep provider capability adaptation at the Worker boundary. The runtime
 * profile is the only source of provider identity; Mock and absent profiles
 * retain the default Huobao policy rather than being treated as Grok.
 */
export const resolvePlanningDurationPolicy = (
  runtimeProfile: Pick<VideoProviderRuntimeProfile, "mode"> | undefined,
): StoryboardDurationPolicy | undefined => runtimeProfile?.mode === "sub2api"
  ? { ...DEFAULT_STORYBOARD_DURATION_POLICY, minDurationSeconds: 1 }
  : undefined;

const isPromptBudgetError = (error: unknown): error is UnsupportedVideoGenerationInputError =>
  error instanceof UnsupportedVideoGenerationInputError && error.code === "PROMPT_BUDGET";

const isValidPromptCeiling = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0;

export class CreativePlanningExecutor {
  constructor(
    private readonly store: Pick<CreativePlanningStore, "completeCreativePlan"> & Partial<Pick<CreativePlanningStore, "resolveVisualObjectLocks">>,
    private readonly planner: PlanningModelPort,
    private readonly compiler: StoryboardCompilerPort = new DeterministicStoryboardCompiler(),
    private readonly documentContextReader?: Pick<BoundedDocumentContextReader, "read">,
    private readonly factSelector: Pick<FactSelectionPort, "selectForSegment"> = new DeterministicFactSelector(),
    private readonly audioOwner?: VideoAudioOwner,
    private readonly durationPolicy?: StoryboardDurationPolicy,
    private readonly runtimeProfile?: Pick<VideoProviderRuntimeProfile, "mode">,
    private readonly providerPromptMaxUtf8Bytes?: number,
  ) {}

  async execute(input: { brief: ControlCreativeBriefRevision; event: CreativePlanningEvent }) {
    const factContexts = input.brief.factContexts ?? [];
    const hasFrozenFacts = factContexts.length > 0;
    if (input.brief.documentContexts.length > 0 && !hasFrozenFacts && !this.documentContextReader) {
      throw new Error("Workflow Worker has no bounded Markdown reader for frozen document context.");
    }
    const documentContexts = !hasFrozenFacts && input.brief.documentContexts.length > 0
      ? await this.documentContextReader!.read(input.brief.documentContexts)
      : [];
    const visualObjectLocks = this.store.resolveVisualObjectLocks
      ? await this.store.resolveVisualObjectLocks({ workspaceId: input.brief.workspaceId, projectId: input.brief.projectId, sourceAssetIds: input.brief.sourceAssetIds, sourcePrompt: input.brief.sourceText })
      : [];
    const planningInput = {
      sourceText: input.brief.sourceText,
      targetDurationSeconds: input.brief.targetDurationSeconds,
      ...(this.durationPolicy ? { durationPolicy: this.durationPolicy } : {}),
      stylePreferences: input.brief.stylePreferences,
      sourceAssetIds: input.brief.sourceAssetIds,
      documentContexts,
      factContexts,
      visualObjectLocks,
    };
    const buildDraft = async (planned: StoryboardPlanDraft): Promise<CreativePlanningDraft> => {
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
      const promptPackages = await Promise.all(shotSpecs.map(async (shotSpec, index) => {
        const segmentFactPack = hasFrozenFacts
          ? this.factSelector.selectForSegment({
            segmentSequence: shotSpec.sequence,
            narrativeText: shotSpec.narrativeGoal,
            contexts: factContexts,
          })
          : undefined;
        const compiled = await this.compiler.compile({
          ...shotSpec,
          generationSegmentSequence: shotSpec.sequence,
          generationSegmentCount: planned.generationSegmentCount,
          motionPlan: planned.shotSpecs[index]!.motionPlan,
          motionPlanHash: planned.shotSpecs[index]!.motionPlanHash,
          cameraShot: planned.shotSpecs[index]!.cameraShot,
          dialogueLines: planned.shotSpecs[index]!.dialogueLines,
          voicePerformance: planned.shotSpecs[index]!.voicePerformance,
          referenceAnchors: planned.shotSpecs[index]!.referenceAnchors,
          stylePreferences: input.brief.stylePreferences,
          documentContexts,
          ...(segmentFactPack ? { segmentFactPack } : {}),
          visualObjectLocks,
          ...(this.audioOwner ? { audioOwner: this.audioOwner } : {}),
        });
        if (this.runtimeProfile?.mode === "sub2api" && isValidPromptCeiling(this.providerPromptMaxUtf8Bytes)) {
          const sourcePrompt = compiled.capabilitySnapshot.source_prompt;
          const generatedPromptParts = compiled.capabilitySnapshot.generated_prompt_parts;
          compactRuntimePrompt(compiled.prompt, this.runtimeProfile.mode, this.providerPromptMaxUtf8Bytes, {
            ...(typeof sourcePrompt === "string" ? { sourcePrompt } : {}),
            ...(Array.isArray(generatedPromptParts) && generatedPromptParts.every((part): part is string => typeof part === "string")
              ? { generatedPromptParts }
              : {}),
          });
        }
        return {
          id: createPrefixedId("ppk"),
          shotSpecId: shotSpec.id,
          compilerVersion: compiled.compilerVersion,
          prompt: compiled.prompt,
          visualConstraints: compiled.visualConstraints,
          referenceMap: compiled.referenceMap,
          capabilitySnapshot: compiled.capabilitySnapshot,
          motionPlan: compiled.motionPlan,
          motionPlanHash: compiled.motionPlanHash,
        };
      }));
      return {
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
        ...(this.durationPolicy ? { durationPolicy: this.durationPolicy } : {}),
        narrativeBeatCount: planned.narrativeBeatCount,
        generationSegmentCount: planned.generationSegmentCount,
        promptPackages,
      };
    };

    let planned = await this.planner.plan(planningInput);
    let draft: CreativePlanningDraft;
    try {
      draft = await buildDraft(planned);
    } catch (error) {
      if (!isPromptBudgetError(error)) throw error;
      planned = await this.planner.plan({
        ...planningInput,
        minimumGenerationSegmentCount: planned.generationSegmentCount + 1,
      });
      draft = await buildDraft(planned);
    }
    return this.store.completeCreativePlan({
      workspaceId: input.brief.workspaceId,
      creativeBriefRevisionId: input.brief.id,
      draft,
      event: input.event,
    });
  }
}
