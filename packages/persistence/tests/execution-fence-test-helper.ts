import type { TaskRunStore } from "../src/task-run-repository.js";

const fencedMethods = new Set<PropertyKey>([
  "ensureProviderAttempt",
  "reserveProviderSubmission",
  "recordProviderSubmission",
  "recordProviderProcessing",
  "beginDownload",
  "recordDownloadRetryableFailure",
  "ensureGeneratedAsset",
  "completeGeneratedTaskRun",
  "markBillingSucceeded",
  "markBillingFailed",
  "scheduleBillingRetry",
  "resumeBillingRetry",
  "failTaskRun",
]);

/**
 * Gives existing repository behavior tests an explicit short-lived test owner
 * for each direct mutation. Production code must pass the lease received from
 * withTaskRunExecution; stale-owner tests intentionally use the raw store.
 */
export const withTestExecutionFence = <T extends TaskRunStore>(store: T): T => new Proxy(store, {
  get(target, property) {
    const value = Reflect.get(target, property, target) as unknown;
    if (typeof value !== "function") return value;
    if (!fencedMethods.has(property)) return value.bind(target);
    return (input: Record<string, unknown>) => {
      if (typeof input.executionFenceToken === "string") return value.call(target, input);
      if (typeof input.workspaceId !== "string" || typeof input.taskRunId !== "string") {
        throw new Error("Fenced test mutation requires a workspace and TaskRun scope.");
      }
      return target.withTaskRunExecution({ workspaceId: input.workspaceId, taskRunId: input.taskRunId }, (lease) =>
        value.call(target, { ...input, executionFenceToken: lease.fenceToken }));
    };
  },
});
