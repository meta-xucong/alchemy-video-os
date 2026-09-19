import {
  type ApplicationErrorCode,
  type BillingChargeRequest,
} from "@alchemy-video/contracts";
import {
  createBillingDebitPlan,
  createPrefixedId,
  createUsageReceipt,
  type MediaUsageFact,
  type UsageReceipt,
} from "@alchemy-video/domain";
import type { CreditPort } from "@alchemy-video/credit-veyra";

type BillingErrorCode = Extract<
  ApplicationErrorCode,
  | "AUTH_FORBIDDEN"
  | "AUTH_UNAVAILABLE"
  | "CREDIT_INSUFFICIENT"
  | "CREDIT_CONFLICT"
  | "CREDIT_UNAVAILABLE"
  | "CREDIT_REJECTED"
>;

export type BillingAttemptStore = {
  recordUsageReceipt(input: UsageReceipt & { id: string; workspaceId: string }): Promise<{
    kind: "RECORDED" | "REPLAYED";
    record: { id: string };
  }>;
  markBillingSucceeded(input: { workspaceId: string; taskRunId: string; usageRecordId: string; now: Date }): Promise<void>;
  markBillingFailed(input: {
    workspaceId: string;
    taskRunId: string;
    code: BillingErrorCode;
    retryable: false;
    safeMessage: string;
    now: Date;
  }): Promise<void>;
  scheduleBillingRetry(input: {
    workspaceId: string;
    taskRunId: string;
    code: BillingErrorCode;
    retryable: true;
    safeMessage: string;
    retryAt: Date;
    now: Date;
  }): Promise<void>;
};

export type BillingExecutionResult =
  | { kind: "SUCCEEDED"; usageRecordId: string; receiptKind: "RECORDED" | "REPLAYED" }
  | { kind: "FAILED"; code: BillingErrorCode }
  | { kind: "RETRY_SCHEDULED"; code: BillingErrorCode; retryAt: Date };

const billingErrorCodes = new Set<BillingErrorCode>([
  "AUTH_FORBIDDEN",
  "AUTH_UNAVAILABLE",
  "CREDIT_INSUFFICIENT",
  "CREDIT_CONFLICT",
  "CREDIT_UNAVAILABLE",
  "CREDIT_REJECTED",
]);

const retryableBillingCodes = new Set<BillingErrorCode>([
  "AUTH_FORBIDDEN",
  "AUTH_UNAVAILABLE",
  "CREDIT_UNAVAILABLE",
]);

const safeBillingMessage = (code: BillingErrorCode): string => {
  switch (code) {
    case "CREDIT_INSUFFICIENT":
      return "The credit account has insufficient balance.";
    case "CREDIT_CONFLICT":
      return "The credit debit conflicted with its idempotency key.";
    case "CREDIT_REJECTED":
      return "The credit service rejected this billing request.";
    case "AUTH_FORBIDDEN":
      return "The credit service rejected the service credential.";
    case "AUTH_UNAVAILABLE":
    case "CREDIT_UNAVAILABLE":
      return "The credit service is temporarily unavailable.";
  }
};

const normalizeBillingError = (error: unknown): { code: BillingErrorCode; retryable: boolean } => {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; retryable?: unknown };
    if (typeof candidate.code === "string" && billingErrorCodes.has(candidate.code as BillingErrorCode)) {
      return {
        code: candidate.code as BillingErrorCode,
        retryable: candidate.retryable === true && retryableBillingCodes.has(candidate.code as BillingErrorCode),
      };
    }
  }
  return { code: "CREDIT_UNAVAILABLE", retryable: true };
};

export class VideoBillingExecutor {
  constructor(
    private readonly credit: CreditPort,
    private readonly store: BillingAttemptStore,
    private readonly options: {
      createUsageRecordId?: () => string;
      retryDelayMs?: number;
      now?: () => Date;
    } = {},
  ) {}

  async execute(input: { workspaceId: string; chargeRequest: BillingChargeRequest; usage?: MediaUsageFact }): Promise<BillingExecutionResult> {
    const now = this.options.now ?? (() => new Date());
    const plan = createBillingDebitPlan(input.chargeRequest, input.usage);
    try {
      const debit = await this.credit.debit(plan.debit);
      const receipt = createUsageReceipt(plan, debit);
      const record = await this.store.recordUsageReceipt({
        id: this.options.createUsageRecordId?.() ?? createPrefixedId("use"),
        workspaceId: input.workspaceId,
        ...receipt,
      });
      await this.store.markBillingSucceeded({
        workspaceId: input.workspaceId,
        taskRunId: plan.taskRunId,
        usageRecordId: record.record.id,
        now: now(),
      });
      return { kind: "SUCCEEDED", usageRecordId: record.record.id, receiptKind: record.kind };
    } catch (error) {
      const failure = normalizeBillingError(error);
      if (failure.retryable) {
        const scheduledAt = now();
        const retryAt = new Date(scheduledAt.getTime() + (this.options.retryDelayMs ?? 30_000));
        await this.store.scheduleBillingRetry({
          workspaceId: input.workspaceId,
          taskRunId: plan.taskRunId,
          code: failure.code,
          retryable: true,
          safeMessage: safeBillingMessage(failure.code),
          retryAt,
          now: scheduledAt,
        });
        return { kind: "RETRY_SCHEDULED", code: failure.code, retryAt };
      }
      await this.store.markBillingFailed({
        workspaceId: input.workspaceId,
        taskRunId: plan.taskRunId,
        code: failure.code,
        retryable: false,
        safeMessage: safeBillingMessage(failure.code),
        now: now(),
      });
      return { kind: "FAILED", code: failure.code };
    }
  }
}
