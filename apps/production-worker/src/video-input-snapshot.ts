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
    generation_segment_sequence: input.generationSegmentSequence,
    narrative_beat_sequences: input.narrativeBeatSequences,
    visual_input: input.visualInput,
  });

/**
 * Production planning owns the narrative duration. The Mock provider accepts
 * those values for orchestration tests even though its fixture media is fixed.
 * A real profile is validated against its concrete provider limits.
 */
export const createProductionTaskRunInputSnapshotFactory = (
  videoProvider: string | undefined,
): ProductionTaskRunInputFactory => {
  const profile = resolveVideoProviderRuntimeProfile(videoProvider);
  if (profile.mode === "mock") return createMockProductionSnapshot;

  return (input) => createRuntimeVideoInputSnapshot({
    prompt: input.prompt,
    visualInput: input.visualInput,
    profile,
    settings: {
      duration: input.duration,
      resolution: input.resolution,
      ratio: input.ratio,
    },
    generationSegmentSequence: input.generationSegmentSequence,
    narrativeBeatSequences: input.narrativeBeatSequences,
  });
};
