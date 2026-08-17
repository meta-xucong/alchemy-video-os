import {
  MockVideoProvider,
  Sub2ApiVideoProvider,
  createMockMp4Fixture,
  resolveVideoProviderRuntimeProfile,
  type VideoProviderPort,
  type VideoProviderRuntimeProfile,
} from "@alchemy-video/provider-video";

import { createSub2ApiHttpsTransport, type WorkerFetch, type WorkerProviderEnvironment } from "./sub2api-https-transport.js";

export type WorkerVideoProviderRuntime = Readonly<{
  profile: VideoProviderRuntimeProfile;
  provider: VideoProviderPort;
}>;

export const createWorkerVideoProviderRuntime = async (input: Readonly<{
  environment: WorkerProviderEnvironment & Readonly<{ VIDEO_PROVIDER?: string; MOCK_VIDEO_OUTCOME?: string }>;
  fetcher?: WorkerFetch;
}>): Promise<WorkerVideoProviderRuntime> => {
  const profile = resolveVideoProviderRuntimeProfile(input.environment.VIDEO_PROVIDER);
  if (profile.mode === "mock") {
    const fixtureBytes = await createMockMp4Fixture();
    return {
      profile,
      provider: new MockVideoProvider({
        fixtureBytes,
        outcome: input.environment.MOCK_VIDEO_OUTCOME === "failed" ? "failed" : "succeeded",
      }),
    };
  }
  return {
    profile,
    provider: new Sub2ApiVideoProvider(createSub2ApiHttpsTransport({
      environment: input.environment,
      fetcher: input.fetcher,
    })),
  };
};
