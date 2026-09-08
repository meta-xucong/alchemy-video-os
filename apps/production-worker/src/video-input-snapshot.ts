import {
  VideoGenerationInputSnapshotSchema,
  type VideoGenerationInputSnapshot,
} from "@alchemy-video/contracts";
import type {
  ProductionTaskRunInput,
  ProductionTaskRunInputFactory,
} from "@alchemy-video/persistence";
import {
  createRuntimeVideoInputSnapshot,
  resolveVideoPromptMaxUtf8Bytes,
  resolveVideoProviderRuntimeProfile,
} from "@alchemy-video/provider-video";

const createMockProductionSnapshot = (input: ProductionTaskRunInput): VideoGenerationInputSnapshot =>
  VideoGenerationInputSnapshotSchema.parse({
    model: "mock-video-v1",
    prompt: input.prompt,
    duration: input.duration,
    resolution: input.resolution,
    ratio: input.ratio,
    reference_asset_ids: input.referenceAssetIds,
    ...(input.deliveryPlanRevisionId ? { delivery_plan_revision_id: input.deliveryPlanRevisionId } : {}),
    generation_segment_sequence: input.generationSegmentSequence,
    narrative_beat_sequences: input.narrativeBeatSequences,
    ...(input.motionPlanVersion ? { motion_plan_version: input.motionPlanVersion } : {}),
    ...(input.motionPlanHash ? { motion_plan_hash: input.motionPlanHash } : {}),
    ...(input.motionTimeline ? { motion_timeline: input.motionTimeline } : {}),
    visual_input: input.visualInput,
  });

/**
 * Production planning owns the narrative duration. The Mock provider accepts
 * those values for orchestration tests even though its fixture media is fixed.
 * A real profile is validated against its concrete provider limits.
 */
export const createProductionTaskRunInputSnapshotFactory = (
  videoProvider: string | undefined,
  promptMaxUtf8Bytes?: string | number,
): ProductionTaskRunInputFactory => {
  const profile = resolveVideoProviderRuntimeProfile(videoProvider);
  const resolvedPromptMaxUtf8Bytes = resolveVideoPromptMaxUtf8Bytes(promptMaxUtf8Bytes);
  if (profile.mode === "mock") return createMockProductionSnapshot;

  return (input) => createRuntimeVideoInputSnapshot({
    prompt: input.prompt,
    sourcePrompt: input.sourcePrompt,
    generatedPromptParts: input.generatedPromptParts,
    visualInput: input.visualInput,
    profile,
    promptMaxUtf8Bytes: resolvedPromptMaxUtf8Bytes,
    settings: {
      duration: input.duration,
      resolution: input.resolution,
      ratio: input.ratio,
    },
    generationSegmentSequence: input.generationSegmentSequence,
    narrativeBeatSequences: input.narrativeBeatSequences,
    motionPlanVersion: input.motionPlanVersion,
    motionPlanHash: input.motionPlanHash,
    motionTimeline: input.motionTimeline,
    deliveryPlanRevisionId: input.deliveryPlanRevisionId,
  });
};
