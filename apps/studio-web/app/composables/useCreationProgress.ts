import type { ProductionRunProgress, TaskRun } from "./useControlApi";

type CreationProgressTone = "idle" | "active" | "success" | "error";
type CreationStageState = "pending" | "active" | "complete";

export type CreationProgress = {
  statusLabel: string;
  message: string;
  tone: CreationProgressTone;
  stages: Array<{
    id: "requirements" | "preparation" | "generation" | "inspection";
    label: string;
    state: CreationStageState;
  }>;
};

const creationStages = [
  { id: "requirements", label: "理解创作需求" },
  { id: "preparation", label: "准备视频内容" },
  { id: "generation", label: "生成视频" },
  { id: "inspection", label: "整理成片" },
] as const;

function stagesFor(activeIndex: number | undefined, terminal: "success" | "failure" | undefined) {
  return creationStages.map((stage, index) => {
    const state: CreationStageState = terminal === "success"
      ? "complete"
      : activeIndex === undefined
        ? "pending"
        : index < activeIndex
          ? "complete"
          : index === activeIndex
            ? "active"
            : "pending";
    return { ...stage, state };
  });
}

function progress(
  statusLabel: string,
  message: string,
  tone: CreationProgressTone,
  activeIndex: number | undefined,
  terminal?: "success" | "failure",
): CreationProgress {
  return { statusLabel, message, tone, stages: stagesFor(activeIndex, terminal) };
}

export function creationProgressFor(status: TaskRun["status"] | undefined, hasCurrentShot: boolean): CreationProgress {
  if (!status) {
    return hasCurrentShot
      ? progress("已保存，等待开始", "创作需求已经保存。请在这里开始生成视频。", "idle", 0)
      : progress("理解创作需求", "先写下想法、故事或情节，再一键生成视频。", "idle", 0);
  }

  switch (status) {
    case "CREATED":
    case "QUEUED":
    case "RUNNING":
    case "RETRY_SCHEDULED":
      return progress("准备视频内容", "创作需求已经提交，正在为这次视频做准备。", "active", 1);
    case "PROCESSING":
      return progress("正在生成视频", "正在生成视频。你可以留在当前页面，也可以稍后回到这个项目查看。", "active", 2);
    case "DOWNLOADING":
    case "BILLING_PENDING":
      return progress("整理成片", "正在整理这次创作结果，完成后会保存到当前项目。", "active", 3);
    case "SUCCEEDED":
      return progress("视频已生成", "结果已保存到当前项目。你可以预览，或调整后生成新版本。", "success", undefined, "success");
    case "FAILED":
    case "BILLING_FAILED":
    case "ABANDONED":
      return progress("本次创作未完成", "本次创作尚未完成。你可以调整想法，或重试当前运行。", "error", undefined, "failure");
  }
}

export function productionProgressFor(progressView: ProductionRunProgress | undefined, hasInput: boolean, localBusy: boolean): CreationProgress {
  if (localBusy) {
    return progress("AI 正在理解内容", "正在后台准备这次视频创作。", "active", 0);
  }
  const run = progressView?.production_run;
  if (!run) {
    return hasInput
      ? progress("准备开始", "点击生成后，AI 会自动完成准备、制作和成片整理。", "idle", 0)
      : progress("理解创作需求", "先写下想法、故事或情节，再一键生成视频。", "idle", 0);
  }
  if (run.status === "SUCCEEDED") {
    return progress("完整成片已生成", "成片已保存到当前项目。你可以查看，或调整描述后生成新版本。", "success", undefined, "success");
  }
  if (run.status === "FAILED" || run.status === "BLOCKED") {
    return progress("本次制作未完成", "这次没有完整完成。可以查看制作细节，或调整描述后生成新版本。", "error", undefined, "failure");
  }
  if (run.status === "CONFIRMED") {
    return progress("正在准备视频内容", "AI 正在把你的描述整理成可制作的视频。", "active", 1);
  }
  if (run.status === "GENERATING") {
    return progress("正在生成视频", "AI 正在制作这次视频。", "active", 2);
  }
  if (run.continuity_status === "CHECKING") {
    return progress("正在检查片段衔接", "AI 正在检查相邻片段的人物、场景和动作是否自然衔接。", "active", 3);
  }
  if (run.continuity_status === "AUTO_REPAIRING") {
    return progress("正在优化片段衔接", "发现一处需要修复的衔接，正在自动整理过渡画面。", "active", 3);
  }
  if (run.continuity_status === "NEEDS_ATTENTION") {
    return progress("衔接检查需要留意", "成片会保留已完成内容，并使用安全转场完成整理。", "active", 3);
  }
  if (run.status === "REVIEWING" || run.status === "RENDERING") {
    return progress("正在整理成片", "视频已经生成，正在整理为可查看的成片。", "active", 3);
  }
  if (progressView?.segments.some((segment) => segment.status === "GENERATING" || segment.status === "CHECKING")) {
    return progress("正在生成视频", "AI 正在制作这次视频。", "active", 2);
  }
  return progress("正在准备视频内容", "AI 正在把你的描述整理成可制作的视频。", "active", 1);
}
