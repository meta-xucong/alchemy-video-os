import { VideoGenerationInputSnapshotSchema, type VideoGenerationInputSnapshot } from "@alchemy-video/contracts";
import type { ProductionTaskRunInput, ProductionTaskRunInputFactory } from "@alchemy-video/persistence";
import {
  createRuntimeVideoInputSnapshot,
  resolveVideoPromptMaxUtf8Bytes,
  resolveVideoProviderRuntimeProfile,
} from "@alchemy-video/provider-video";

/**
 * Control-plane production snapshot factory.
 *
 * Mirrors apps/production-worker/src/video-input-snapshot.ts so the Control API
 * and the production worker agree on the task generation profile. Previously the
 * Control API used the persistence default (hard-coded mock), which produced
 * mock tasks that a sub2api worker then rejects (PROVIDER_REJECTED).
 */

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
    ...(input.billing ? { billing: input.billing } : {}),
    visual_input: input.visualInput,
  });

export const createControlProductionTaskRunInputSnapshotFactory = (
  videoProvider: string | undefined,
  promptMaxUtf8Bytes?: string | number,
): ProductionTaskRunInputFactory => {
  const profile = resolveVideoProviderRuntimeProfile(videoProvider);
  const resolvedPromptMaxUtf8Bytes = resolveVideoPromptMaxUtf8Bytes(promptMaxUtf8Bytes);
  if (profile.mode === "mock") return createMockProductionSnapshot;

  return (input) =>
    createRuntimeVideoInputSnapshot({
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
      billing: input.billing,
    });
};
