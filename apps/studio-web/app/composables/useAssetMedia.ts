import type { Asset } from "./useControlApi";

// Thin C04 adaptation of huobao-drama's useMedia thumbnail fallback behavior.
export const thumbFallback = (asset: Pick<Asset, "kind" | "mime_type">) => {
  if (asset.kind === "IMAGE") return "Image asset";
  if (asset.kind === "AUDIO") return "Audio asset";
  if (asset.kind === "DOCUMENT") return "Document asset";
  return asset.mime_type ?? "Asset";
};

export const mediaLabel = (asset: Pick<Asset, "kind" | "status" | "mime_type">) =>
  `${thumbFallback(asset)} - ${asset.status}`;
