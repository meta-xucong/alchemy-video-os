import type { VideoGenerationInput } from "../port.js";
import { VideoProviderProtocolError } from "../port.js";

export type Sub2ApiGenerationRequest = {
  model: string;
  prompt: string;
  duration: number;
  resolution: string;
  ratio: string;
  image?: {
    image_url: string;
  };
};

export const mapSub2ApiGenerationRequest = (input: VideoGenerationInput): Sub2ApiGenerationRequest => {
  const { model, prompt, duration, resolution, ratio } = input.inputSnapshot;
  const referenceImageUrl = input.referenceImageUrl?.trim();

  if (input.referenceImageUrl !== undefined && !referenceImageUrl) {
    throw new VideoProviderProtocolError("The reference image URL must not be empty when supplied to the provider.");
  }

  return {
    model,
    prompt,
    duration,
    resolution,
    ratio,
    ...(referenceImageUrl ? { image: { image_url: referenceImageUrl } } : {}),
  };
};
