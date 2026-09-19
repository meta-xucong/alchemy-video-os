import type { Asset } from "./useControlApi";

// Thin C04 adaptation of huobao-drama's useMedia thumbnail fallback behavior.
export const thumbFallback = (asset: Pick<Asset, "kind" | "mime_type">) => {
  if (asset.kind === "IMAGE") return "图片资产";
  if (asset.kind === "VIDEO") return "视频资产";
  if (asset.kind === "AUDIO") return "音频资产";
  if (asset.kind === "DOCUMENT") return "文档资产";
  return asset.mime_type ?? "资产";
};

const assetStatusLabel: Record<Asset["status"], string> = {
  PENDING_UPLOAD: "等待上传",
  READY: "已就绪",
  FAILED: "失败",
  DELETED: "已删除",
};

export const mediaLabel = (asset: Pick<Asset, "kind" | "status" | "mime_type">) =>
  `${thumbFallback(asset)} - ${assetStatusLabel[asset.status]}`;
