import type { ProductionRunProgress, TaskRun } from "./useControlApi";

export function createAsyncOperationFence() {
  let revision = 0;
  return {
    begin: () => ++revision,
    invalidate: () => ++revision,
    isCurrent: (token: number) => token === revision,
  };
}

export type RetryReconciliationTarget = { projectId: string; updatedAt: string } & (
  | { kind: "task"; taskRunId: string }
  | { kind: "segment"; productionRunId: string; segmentId: string; sequence: number }
  | { kind: "composition"; productionRunId: string }
);

/** Only explicit Control API rejections prove that this command was not accepted. */
export function isDefinitiveRetryRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const response = error as { statusCode?: unknown; status?: unknown; data?: { error?: { code?: unknown } } };
  const status = response.statusCode ?? response.status;
  if (typeof status !== "number" || status < 400 || status >= 500 || status === 408) return false;
  const code = response.data?.error?.code;
  return typeof code === "string" && [
    "VALIDATION_FAILED", "NOT_FOUND", "WORKSPACE_FORBIDDEN", "AUTH_FORBIDDEN",
    "IDEMPOTENCY_CONFLICT", "TASK_STATE_INVALID", "TASK_RUN_ACTIVE_CONFLICT",
    "PRODUCTION_SEGMENT_STATE_INVALID", "PRODUCTION_RUN_STATE_INVALID",
  ].includes(code);
}

/** A newer state must belong to the exact retry target, never a historical result. */
export function retryTargetHasAdvanced(
  target: RetryReconciliationTarget,
  tasks: TaskRun[],
  production: ProductionRunProgress[],
  currentAuthoritativeRead = false,
  confirmedReceipt = false,
): boolean {
  const newer = (updatedAt: string) => {
    const before = Date.parse(target.updatedAt);
    const after = Date.parse(updatedAt);
    return Number.isFinite(before) && Number.isFinite(after)
      && (after > before || (currentAuthoritativeRead && after === before));
  };
  if (target.kind === "task") {
    const task = tasks.find((item) => item.id === target.taskRunId && item.project_id === target.projectId);
    return Boolean(task && newer(task.updated_at) && (confirmedReceipt || [
      "QUEUED", "RUNNING", "PROCESSING", "DOWNLOADING", "BILLING_PENDING", "RETRY_SCHEDULED", "SUCCEEDED",
    ].includes(task.status)));
  }
  const progress = production.find((item) => item.production_run.id === target.productionRunId
    && item.production_run.project_id === target.projectId);
  if (!progress) return false;
  if (target.kind === "composition") {
    return newer(progress.production_run.updated_at) && (confirmedReceipt || ["REVIEWING", "RENDERING", "SUCCEEDED"].includes(progress.production_run.status));
  }
  const segment = progress.segments.find((item) => item.id === target.segmentId
    && item.production_run_id === target.productionRunId && item.sequence === target.sequence);
  return Boolean(segment && newer(segment.updated_at) && (confirmedReceipt || ["PENDING", "WAITING", "GENERATING", "CHECKING", "ACCEPTED"].includes(segment.status)));
}

/** Retain newer command/worker snapshots when overlapping refreshes return out of order. */
export function mergeProductionProgressSnapshots(previous: ProductionRunProgress | undefined, incoming: ProductionRunProgress, currentAuthoritativeRead = false): ProductionRunProgress {
  if (!previous || previous.production_run.id !== incoming.production_run.id) return incoming;
  const preservePrevious = (before: string, after: string) => before.localeCompare(after) > 0
    || (!currentAuthoritativeRead && before === after);
  const productionRun = preservePrevious(previous.production_run.updated_at, incoming.production_run.updated_at)
    ? previous.production_run
    : incoming.production_run;
  const previousSegments = new Map(previous.segments.map((segment) => [segment.sequence, segment]));
  const segments = incoming.segments.map((segment) => {
    const current = previousSegments.get(segment.sequence);
    return current && preservePrevious(current.updated_at, segment.updated_at) ? current : segment;
  });
  return { ...incoming, production_run: productionRun, segments };
}

export function mergeProductionProgressLists(previous: ProductionRunProgress[], incoming: ProductionRunProgress[], currentAuthoritativeRead = false): ProductionRunProgress[] {
  const previousById = new Map(previous.map((item) => [item.production_run.id, item]));
  return incoming.map((item) => mergeProductionProgressSnapshots(previousById.get(item.production_run.id), item, currentAuthoritativeRead));
}

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
      return progress("整理成片", "正在整理这次创作结果，完成后会保存到当前项目。", "active", 3);
    case "BILLING_PENDING":
      return progress("等待费用结算", "视频已经生成，正在等待费用结算；确认后会保存到当前项目。", "active", 3);
    case "SUCCEEDED":
      return progress("视频已生成", "结果已保存到当前项目。你可以预览，或调整后生成新版本。", "success", undefined, "success");
    case "FAILED":
    case "BILLING_FAILED":
    case "ABANDONED":
      return progress("本次创作未完成", "本次创作尚未完成。你可以调整想法，或重试当前运行。", "error", undefined, "failure");
  }
}

export function isRecoverableWaitingProduction(progressView: ProductionRunProgress | undefined): boolean {
  const run = progressView?.production_run;
  if (!run || run.status !== "BLOCKED") return false;
  const segments = progressView?.segments ?? [];
  return segments.some((segment) => segment.status === "WAITING" && segment.retryable)
    && !segments.some((segment) => segment.status === "FAILED");
}

export function productionProgressFor(
  progressView: ProductionRunProgress | undefined,
  hasInput: boolean,
  localBusy: boolean,
  billingPending = false,
  retrySubmitting = false,
  retryOutcomeUnknown = false,
  retryProjectionPending = false,
): CreationProgress {
  if (retrySubmitting) {
    return progress("正在提交重试", "正在提交本次重试请求；服务确认后会继续制作。", "active", 2);
  }
  if (retryOutcomeUnknown) {
    return progress("重试结果待确认", "服务可能已接受重试，请刷新项目核对；确认前不要再次提交。", "active", 2);
  }
  if (retryProjectionPending) {
    return progress("正在核对重试状态", "原请求已受理，正在核对最新状态；确认前不要再次提交。", "active", 2);
  }
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
  if (isRecoverableWaitingProduction(progressView)) {
    const waitingSegment = progressView?.segments.find((segment) => segment.status === "WAITING" && segment.retryable);
    return progress("等待继续制作", waitingSegment?.safe_summary ?? "正在等待必要准备完成，完成后会继续制作。", "active", 1);
  }
  if (run.status === "FAILED" || run.status === "BLOCKED") {
    return progress("本次制作未完成", "这次没有完整完成。可以查看制作细节，或调整描述后生成新版本。", "error", undefined, "failure");
  }
  if (run.status === "CONFIRMED") {
    return progress("正在准备视频内容", "AI 正在把你的描述整理成可制作的视频。", "active", 1);
  }
  if (billingPending && ["GENERATING", "REVIEWING", "RENDERING"].includes(run.status)) {
    return progress("等待费用结算", "本段视频已经生成，正在等待费用结算；确认后会继续整理成片。", "active", 3);
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
