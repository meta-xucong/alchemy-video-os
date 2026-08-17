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
  reference_images?: Array<{
    url: string;
  }>;
};

const providerReadableUrl = (value: string) => {
  const normalized = value.trim();
  if (!normalized) throw new VideoProviderProtocolError("The resolved reference URL must not be empty.");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new VideoProviderProtocolError("The resolved reference URL must be an HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new VideoProviderProtocolError("The resolved reference URL must be an HTTPS URL without credentials or fragment.");
  }
  return url.toString();
};

export const mapSub2ApiGenerationRequest = (input: VideoGenerationInput): Sub2ApiGenerationRequest => {
  const { model, prompt, duration, resolution, ratio } = input.inputSnapshot;
  const visualFields = input.visualInput.mode === "TEXT"
    ? {}
    : input.visualInput.mode === "FIRST_FRAME"
      ? { image: { image_url: providerReadableUrl(input.visualInput.url) } }
      : (() => {
          if (input.visualInput.urls.length < 1 || input.visualInput.urls.length > 7) {
            throw new VideoProviderProtocolError("Reference-to-video requires one to seven resolved reference URLs.");
          }
          return { reference_images: input.visualInput.urls.map(providerReadableUrl).map((url) => ({ url })) };
        })();

  return {
    model,
    prompt,
    duration,
    resolution,
    ratio,
    ...visualFields,
  };
};
