import type { VisualInputSnapshot } from "@alchemy-video/contracts";
import { ReferenceDeliveryTokenCodec, createReferenceDeliveryUrl } from "@alchemy-video/reference-delivery";
import { VideoProviderFailure, VideoProviderProtocolError, type ResolvedVisualInput, type VideoProviderRuntimeProfile } from "@alchemy-video/provider-video";

export interface ReferenceDeliveryPort {
  createVisualInput(input: Readonly<{
    workspaceId: string;
    projectId: string;
    visualInput: Exclude<VisualInputSnapshot, { mode: "TEXT" }>;
  }>): Promise<ResolvedVisualInput>;
}

const createSignedReferenceDeliveryPort = (input: Readonly<{
  origin: string;
  signingKey: string;
  ttlMs?: number;
}>): ReferenceDeliveryPort => {
  const codec = new ReferenceDeliveryTokenCodec(input.signingKey);
  const ttlMs = input.ttlMs ?? 5 * 60_000;
  return {
    async createVisualInput({ workspaceId, projectId, visualInput }) {
      const urls = visualInput.references.map((reference) => createReferenceDeliveryUrl({
        origin: input.origin,
        token: codec.issue({
          workspaceId,
          projectId,
          assetId: reference.asset_id,
          sha256: reference.sha256,
          mimeType: reference.mime_type,
          expiresAt: new Date(Date.now() + ttlMs),
        }),
      }));
      if (visualInput.mode === "FIRST_FRAME") {
        if (urls.length !== 1) throw new VideoProviderProtocolError("A first-frame video input must resolve exactly one image.");
        return { mode: "FIRST_FRAME", url: urls[0]! };
      }
      if (urls.length < 1 || urls.length > 7) {
        throw new VideoProviderProtocolError("A reference-set video input must resolve one to seven images.");
      }
      return { mode: "REFERENCE_SET", urls };
    },
  };
};

const unavailableReferenceDeliveryPort = (): ReferenceDeliveryPort => ({
  async createVisualInput() {
    throw new VideoProviderFailure(
      "PROVIDER_UNAVAILABLE",
      false,
      "PROVIDER",
      "Reference image delivery is not configured for the real video provider.",
    );
  },
});

export const createWorkerReferenceDeliveryPort = (input: Readonly<{
  profile: VideoProviderRuntimeProfile;
  environment: Readonly<{
    REFERENCE_DELIVERY_ORIGIN?: string;
    REFERENCE_DELIVERY_SIGNING_KEY?: string;
  }>;
}>): ReferenceDeliveryPort => {
  if (input.profile.mode === "mock") {
    return createSignedReferenceDeliveryPort({
      origin: "https://provider-input.invalid",
      signingKey: "local-mock-reference-delivery-key-with-at-least-32-characters",
    });
  }
  const origin = input.environment.REFERENCE_DELIVERY_ORIGIN?.trim();
  const signingKey = input.environment.REFERENCE_DELIVERY_SIGNING_KEY;
  if (!origin || !signingKey) return unavailableReferenceDeliveryPort();
  return createSignedReferenceDeliveryPort({ origin, signingKey });
};
