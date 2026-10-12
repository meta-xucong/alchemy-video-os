export const productionTaskFailureSummary = (errorCode: string, attemptStatus?: string) => {
  if (attemptStatus === "DOWNLOAD_FAILED") {
    if (errorCode === "DOWNLOAD_INVALID") return "视频服务已经返回结果，但结果文件校验未通过；请重新提交本段。";
    return "视频已经生成，但结果下载或入库未完成；请重新提交本段。";
  }
  if (errorCode === "PROVIDER_REJECTED") return "视频服务拒绝了本段请求，请调整描述或参考素材后重新提交。";
  if (errorCode === "PROVIDER_SUBMISSION_UNKNOWN") return "视频提交结果暂时无法确认；为避免重复扣费，本段已暂停，请先核对服务记录再继续。";
  if (errorCode === "PROVIDER_PROTOCOL_INVALID") return "视频服务返回的数据无法识别，本段未完成；请重新提交本段。";
  if (errorCode === "DOWNLOAD_INVALID") return "视频已生成，但结果文件校验未通过；请重新提交本段。";
  if (errorCode === "PROVIDER_UNAVAILABLE") return "视频服务暂时不可用，本段未完成；请稍后重新提交本段。";
  if (errorCode === "STORAGE_UNAVAILABLE") return "参考素材暂时无法交付；本段尚未提交视频生成，请检查素材或存储服务后再试。";
  return "本段制作未完成，可重新提交本段。";
};
