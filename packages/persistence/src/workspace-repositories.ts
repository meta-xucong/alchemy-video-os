import { and, asc, eq } from "drizzle-orm";

import type { PlatformDatabase } from "./db.js";
import {
  assets,
  outboxEvents,
  projects,
  providerAttempts,
  referenceBindings,
  shots,
  taskRuns,
  usageRecords,
  workspaceMembers,
} from "./schema.js";

export const workspaceMemberScope = (workspaceId: string, userId: string) =>
  and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));
export const projectScope = (workspaceId: string, projectId: string) =>
  and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId));
export const assetScope = (workspaceId: string, assetId: string) =>
  and(eq(assets.workspaceId, workspaceId), eq(assets.id, assetId));
export const shotScope = (workspaceId: string, shotId: string) =>
  and(eq(shots.workspaceId, workspaceId), eq(shots.id, shotId));
export const referenceBindingScope = (workspaceId: string, shotId: string) =>
  and(eq(referenceBindings.workspaceId, workspaceId), eq(referenceBindings.shotId, shotId));
export const taskRunScope = (workspaceId: string, taskRunId: string) =>
  and(eq(taskRuns.workspaceId, workspaceId), eq(taskRuns.id, taskRunId));
export const providerAttemptScope = (workspaceId: string, providerAttemptId: string) =>
  and(eq(providerAttempts.workspaceId, workspaceId), eq(providerAttempts.id, providerAttemptId));
export const usageRecordScope = (workspaceId: string, usageRecordId: string) =>
  and(eq(usageRecords.workspaceId, workspaceId), eq(usageRecords.id, usageRecordId));
export const usageReceiptScope = (workspaceId: string, creditProvider: string, idempotencyKey: string) =>
  and(
    eq(usageRecords.workspaceId, workspaceId),
    eq(usageRecords.creditProvider, creditProvider),
    eq(usageRecords.idempotencyKey, idempotencyKey),
  );
export const outboxEventScope = (workspaceId: string, outboxEventId: string) =>
  and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.id, outboxEventId));

export class WorkspaceRepositories {
  constructor(private readonly db: PlatformDatabase) {}

  async findMembership(workspaceId: string, userId: string) {
    return (await this.db.select().from(workspaceMembers).where(workspaceMemberScope(workspaceId, userId)).limit(1))[0];
  }

  async listProjects(workspaceId: string) {
    return this.db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).orderBy(asc(projects.createdAt));
  }

  async findProject(workspaceId: string, projectId: string) {
    return (await this.db.select().from(projects).where(projectScope(workspaceId, projectId)).limit(1))[0];
  }

  async findAsset(workspaceId: string, assetId: string) {
    return (await this.db.select().from(assets).where(assetScope(workspaceId, assetId)).limit(1))[0];
  }

  async listShots(workspaceId: string, projectId: string) {
    return this.db
      .select()
      .from(shots)
      .where(and(eq(shots.workspaceId, workspaceId), eq(shots.projectId, projectId)))
      .orderBy(asc(shots.position));
  }

  async findShot(workspaceId: string, shotId: string) {
    return (await this.db.select().from(shots).where(shotScope(workspaceId, shotId)).limit(1))[0];
  }

  async listReferenceBindings(workspaceId: string, shotId: string) {
    return this.db
      .select()
      .from(referenceBindings)
      .where(referenceBindingScope(workspaceId, shotId))
      .orderBy(asc(referenceBindings.position));
  }

  async findTaskRun(workspaceId: string, taskRunId: string) {
    return (await this.db.select().from(taskRuns).where(taskRunScope(workspaceId, taskRunId)).limit(1))[0];
  }

  async findProviderAttempt(workspaceId: string, providerAttemptId: string) {
    return (
      await this.db.select().from(providerAttempts).where(providerAttemptScope(workspaceId, providerAttemptId)).limit(1)
    )[0];
  }

  async findUsageRecord(workspaceId: string, usageRecordId: string) {
    return (await this.db.select().from(usageRecords).where(usageRecordScope(workspaceId, usageRecordId)).limit(1))[0];
  }

  async findOutboxEvent(workspaceId: string, outboxEventId: string) {
    return (await this.db.select().from(outboxEvents).where(outboxEventScope(workspaceId, outboxEventId)).limit(1))[0];
  }
}
