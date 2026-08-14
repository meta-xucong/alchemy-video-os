import { assertUsageReceiptReplay, DomainInvariantError, type UsageReceipt } from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import { usageRecords } from "./schema.js";
import { usageReceiptScope } from "./workspace-repositories.js";

export type RecordUsageReceiptInput = UsageReceipt & {
  id: string;
  workspaceId: string;
};

export type UsageReceiptWriteResult = {
  kind: "RECORDED" | "REPLAYED";
  record: typeof usageRecords.$inferSelect;
};

const toUsageReceipt = (record: typeof usageRecords.$inferSelect): UsageReceipt => ({
  creditProvider: record.creditProvider as UsageReceipt["creditProvider"],
  taskRunId: record.taskRunId,
  externalUserId: record.externalUserId,
  amount: record.amount,
  source: record.source,
  referenceId: record.referenceId ?? "",
  idempotencyKey: record.idempotencyKey,
  balanceAfter: record.balanceAfter ?? "0",
  replayed: record.replayed,
});

export class DrizzleBillingRepository {
  constructor(private readonly db: PlatformDatabase) {}

  async recordUsageReceipt(input: RecordUsageReceiptInput): Promise<UsageReceiptWriteResult> {
    return this.db.transaction(async (transaction) => {
      const existing = (
        await transaction
          .select()
          .from(usageRecords)
          .where(usageReceiptScope(input.workspaceId, input.creditProvider, input.idempotencyKey))
          .limit(1)
      )[0];
      if (existing) {
        assertUsageReceiptReplay(toUsageReceipt(existing), input);
        return { kind: "REPLAYED", record: existing };
      }

      const record = (
        await transaction
          .insert(usageRecords)
          .values({
            id: input.id,
            workspaceId: input.workspaceId,
            taskRunId: input.taskRunId,
            creditProvider: input.creditProvider,
            externalUserId: input.externalUserId,
            amount: input.amount,
            source: input.source,
            referenceId: input.referenceId,
            idempotencyKey: input.idempotencyKey,
            balanceAfter: input.balanceAfter,
            replayed: input.replayed,
          })
          .onConflictDoNothing({ target: [usageRecords.creditProvider, usageRecords.idempotencyKey] })
          .returning()
      )[0];
      if (record) {
        return { kind: "RECORDED", record };
      }

      const replay = (
        await transaction
          .select()
          .from(usageRecords)
          .where(usageReceiptScope(input.workspaceId, input.creditProvider, input.idempotencyKey))
          .limit(1)
      )[0];
      if (!replay) {
        // Do not read another workspace's receipt to diagnose a conflicting global key.
        throw new DomainInvariantError(
          "IDEMPOTENCY_CONFLICT",
          "A usage receipt idempotency key is already assigned outside this workspace.",
        );
      }
      assertUsageReceiptReplay(toUsageReceipt(replay), input);
      return { kind: "REPLAYED", record: replay };
    });
  }

  async findUsageReceipt(workspaceId: string, creditProvider: string, idempotencyKey: string) {
    return (
      await this.db
        .select()
        .from(usageRecords)
        .where(usageReceiptScope(workspaceId, creditProvider, idempotencyKey))
        .limit(1)
    )[0];
  }
}
