import { DeterministicStoryboardCompiler } from "@alchemy-video/creative-planning/mock";
import type { VideoProviderRuntimeProfile } from "@alchemy-video/provider-video";

import { CreativePlanningExecutor, resolvePlanningDurationPolicy } from "./execution-service.js";
import { createPlanningModelFromEnv } from "./semantic-planning-client.js";

type MockPlanningStore = ConstructorParameters<typeof CreativePlanningExecutor>[0];
type MockDocumentReader = NonNullable<ConstructorParameters<typeof CreativePlanningExecutor>[3]>;

/**
 * MOCK_ONLY composition root.
 *
 * The real Worker imports this module only after the resolved runtime profile
 * is explicitly `mock`. Keeping every deterministic symbol here prevents the
 * production composition root from importing or naming legacy creative logic.
 */
export const createMockCreativePlanningExecutor = (input: Readonly<{
  store: MockPlanningStore;
  runtimeProfile: VideoProviderRuntimeProfile;
  providerPromptMaxUtf8Bytes: number;
  documentReader: MockDocumentReader;
}>) => new CreativePlanningExecutor(
  input.store,
  createPlanningModelFromEnv({
    runtimeProfile: input.runtimeProfile,
    maxPromptUtf8Bytes: input.providerPromptMaxUtf8Bytes,
  }),
  new DeterministicStoryboardCompiler(),
  input.documentReader,
  undefined,
  input.runtimeProfile.audioOwner,
  resolvePlanningDurationPolicy(input.runtimeProfile),
  input.runtimeProfile,
  input.providerPromptMaxUtf8Bytes,
);
