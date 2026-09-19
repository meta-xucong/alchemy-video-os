import { and, asc, desc, eq } from "drizzle-orm";
import { InternalEventEnvelopeSchema } from "@alchemy-video/contracts";
import type {
  CaptionPolicy,
  DeliveryPlanRevision,
  DurationPolicy,
  InternalEventEnvelope,
  LipSyncRequirement,
  PreflightRevisionStatus,
  VoiceMode,
} from "@alchemy-video/contracts";
import { assertPreflightRevisionTransition, assertBudgetWithinApprovedLimit, createPrefixedId } from "@alchemy-video/domain";

import type { PlatformDatabase } from "./db.js";
import { commandDeduplications, creativeBriefRevisions, deliveryPlanRevisions, outboxEvents, storyboardRevisions } from "./schema.js";

export type ControlDeliveryPlanRevision = {
  id: string;
  workspaceId: string;
  projectId: string;
  creativeBriefRevisionId: string;
  storyboardRevisionId: string;
  revision: number;
  status: PreflightRevisionStatus;
  durationPolicy: DurationPolicy;
  flexibleDurationPercent: number;
  targetDurationSeconds: number;
  requiresSampleApproval: boolean;
  captionPolicy: CaptionPolicy;
  lipSyncRequirement: LipSyncRequirement;
  voiceMode: VoiceMode;
  safeSummary: string;
  blockReasons: string[];
  approvedAt: string | null;
  consumedByProductionRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryPreflightEvent = {
  eventId: string;
  messageId: string;
  traceId: string;
  correlationId: string;
};

export type CreateDeliveryPlanRevisionInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  deliveryPlanRevisionId: string;
  creativeBriefRevisionId: string;
  storyboardRevisionId: string;
  targetDurationSeconds: number;
  durationPolicy: DurationPolicy;
  flexibleDurationPercent: number;
  captionPolicy: CaptionPolicy;
  lipSyncRequirement: LipSyncRequirement;
  voiceMode: VoiceMode;
  budgetLimit: string;
  event: DeliveryPreflightEvent;
};

export type ApproveDeliveryPlanRevisionInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  deliveryPlanRevisionId: string;
  event: DeliveryPreflightEvent;
};

export type DeliveryPreflightOutcome<T> =
  | { kind: "NEW" | "REPLAY"; value: T; status: 202 }
  | { kind: "CONFLICT" | "NOT_FOUND" | "STATE_INVALID" };

export type DeliveryPlanConsumptionOutcome =
  | { kind: "CONSUMED" | "ALREADY_CONSUMED"; value: ControlDeliveryPlanRevision }
  | { kind: "NOT_FOUND" | "STATE_INVALID" };

type StoredSnapshot =
  | { kind: "DELIVERY_PLAN"; deliveryPlanRevisionId: string }
  | { kind: "NOT_FOUND" | "STATE_INVALID" };

type StoredCommand = { requestHash: string; snapshot: StoredSnapshot };

const commandKey = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;
const now = () => new Date().toISOString();

const toContract = (plan: ControlDeliveryPlanRevision): DeliveryPlanRevision => ({
  id: plan.id,
  workspace_id: plan.workspaceId,
  project_id: plan.projectId,
  creative_brief_revision_id: plan.creativeBriefRevisionId,
  storyboard_revision_id: plan.storyboardRevisionId,
  revision: plan.revision,
  status: plan.status,
  duration_policy: plan.durationPolicy,
  flexible_duration_percent: plan.flexibleDurationPercent,
  target_duration_seconds: plan.targetDurationSeconds,
  requires_sample_approval: plan.requiresSampleApproval,
  caption_policy: plan.captionPolicy,
  lip_sync_requirement: plan.lipSyncRequirement,
  voice_mode: plan.voiceMode,
  safe_summary: plan.safeSummary,
  block_reasons: plan.blockReasons,
  approved_at: plan.approvedAt,
  consumed_by_production_run_id: plan.consumedByProductionRunId,
  created_at: new Date(plan.createdAt).toISOString(),
  updated_at: new Date(plan.updatedAt).toISOString(),
});

export interface DeliveryPreflightStore {
  listProjectDeliveryPlanRevisions(workspaceId: string, projectId: string): Promise<ControlDeliveryPlanRevision[]>;
  findDeliveryPlanRevision(workspaceId: string, deliveryPlanRevisionId: string): Promise<ControlDeliveryPlanRevision | undefined>;
  createDeliveryPlanRevision(input: CreateDeliveryPlanRevisionInput): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>>;
  approveDeliveryPlanRevision(input: ApproveDeliveryPlanRevisionInput): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>>;
  consumeDeliveryPlanRevision(input: { workspaceId: string; deliveryPlanRevisionId: string; productionRunId: string }): Promise<DeliveryPlanConsumptionOutcome>;
  listDeliveryPreflightEvents(workspaceId: string, projectId: string): Promise<InternalEventEnvelope[]>;
}

export class InMemoryDeliveryPreflightStore implements DeliveryPreflightStore {
  private readonly deliveryPlans = new Map<string, ControlDeliveryPlanRevision>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly events: InternalEventEnvelope[] = [];

  constructor(
    private readonly revisionResolver: {
      findCreativeBriefRevision(workspaceId: string, creativeBriefRevisionId: string): Promise<{ projectId: string; status: string; targetDurationSeconds: number } | undefined>;
      findStoryboardRevision(workspaceId: string, storyboardRevisionId: string): Promise<{ projectId: string; status: string; totalDurationSeconds: number } | undefined>;
    },
  ) {}

  async listProjectDeliveryPlanRevisions(workspaceId: string, projectId: string) {
    return [...this.deliveryPlans.values()]
      .filter((plan) => plan.workspaceId === workspaceId && plan.projectId === projectId)
      .sort((left, right) => left.revision - right.revision || left.createdAt.localeCompare(right.createdAt));
  }

  async findDeliveryPlanRevision(workspaceId: string, deliveryPlanRevisionId: string) {
    const plan = this.deliveryPlans.get(deliveryPlanRevisionId);
    return plan?.workspaceId === workspaceId ? plan : undefined;
  }

  async listDeliveryPreflightEvents(workspaceId: string, projectId: string) {
    return this.events.filter((event) => event.workspace_id === workspaceId && event.project_id === projectId);
  }

  async createDeliveryPlanRevision(input: CreateDeliveryPlanRevisionInput): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>> {
    const replay = this.replay(input.scope, input.idempotencyKey, input.requestHash);
    if (replay) return replay;

    const [brief, storyboard] = await Promise.all([
      this.revisionResolver.findCreativeBriefRevision(input.workspaceId, input.creativeBriefRevisionId),
      this.revisionResolver.findStoryboardRevision(input.workspaceId, input.storyboardRevisionId),
    ]);
    if (!brief || !storyboard || brief.projectId !== input.projectId || storyboard.projectId !== input.projectId) {
      return this.storeSnapshot(input, { kind: "NOT_FOUND" });
    }
    if (brief.status !== "APPROVED" || storyboard.status !== "APPROVED") {
      return this.storeSnapshot(input, { kind: "STATE_INVALID" });
    }

    const blockReasons = this.blockReasons(input);
    const status: PreflightRevisionStatus = blockReasons.length > 0 ? "PREFLIGHT_BLOCKED" : "AWAITING_APPROVAL";
    assertPreflightRevisionTransition("DRAFT", status);
    const timestamp = now();
    const revision = (await this.listProjectDeliveryPlanRevisions(input.workspaceId, input.projectId)).length + 1;
    const plan: ControlDeliveryPlanRevision = {
      id: input.deliveryPlanRevisionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      creativeBriefRevisionId: input.creativeBriefRevisionId,
      storyboardRevisionId: input.storyboardRevisionId,
      revision,
      status,
      durationPolicy: input.durationPolicy,
      flexibleDurationPercent: input.flexibleDurationPercent,
      targetDurationSeconds: input.targetDurationSeconds,
      requiresSampleApproval: true,
      captionPolicy: input.captionPolicy,
      lipSyncRequirement: input.lipSyncRequirement,
      voiceMode: input.voiceMode,
      safeSummary: blockReasons.length > 0 ? "交付预检被阻断，需先处理授权、能力或预算。" : "交付预检已创建，等待样音和人工批准。",
      blockReasons,
      approvedAt: null,
      consumedByProductionRunId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.deliveryPlans.set(plan.id, plan);
    this.events.push(this.createEvent({
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      deliveryPlanRevisionId: plan.id,
      eventType: "delivery_plan.preflight_requested",
      data: {
        delivery_plan_revision_id: plan.id,
        creative_brief_revision_id: plan.creativeBriefRevisionId,
        storyboard_revision_id: plan.storyboardRevisionId,
        status: plan.status,
      },
    }));
    if (plan.status === "PREFLIGHT_BLOCKED") {
      this.events.push(this.createEvent({
        event: {
          ...input.event,
          eventId: createPrefixedId("evt"),
          messageId: createPrefixedId("msg"),
        },
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        deliveryPlanRevisionId: plan.id,
        eventType: "delivery_plan.blocked",
        data: {
          delivery_plan_revision_id: plan.id,
          status: "PREFLIGHT_BLOCKED",
          reason_codes: plan.blockReasons,
        },
      }));
    }
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "DELIVERY_PLAN", deliveryPlanRevisionId: plan.id } });
    return { kind: "NEW", value: plan, status: 202 };
  }

  async approveDeliveryPlanRevision(input: ApproveDeliveryPlanRevisionInput): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>> {
    const replay = this.replay(input.scope, input.idempotencyKey, input.requestHash);
    if (replay) return replay;

    const current = await this.findDeliveryPlanRevision(input.workspaceId, input.deliveryPlanRevisionId);
    if (!current) return this.storeSnapshot(input, { kind: "NOT_FOUND" });
    if (current.status !== "AWAITING_APPROVAL") return this.storeSnapshot(input, { kind: "STATE_INVALID" });
    assertPreflightRevisionTransition(current.status, "APPROVED");
    const timestamp = now();
    const plan = { ...current, status: "APPROVED" as const, approvedAt: timestamp, updatedAt: timestamp };
    this.deliveryPlans.set(plan.id, plan);
    this.events.push(this.createEvent({
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      workspaceId: input.workspaceId,
      projectId: current.projectId,
      deliveryPlanRevisionId: plan.id,
      eventType: "delivery_plan.approved",
      data: {
        delivery_plan_revision_id: plan.id,
        status: "APPROVED",
      },
    }));
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot: { kind: "DELIVERY_PLAN", deliveryPlanRevisionId: plan.id } });
    return { kind: "NEW", value: plan, status: 202 };
  }

  async consumeDeliveryPlanRevision(input: { workspaceId: string; deliveryPlanRevisionId: string; productionRunId: string }): Promise<DeliveryPlanConsumptionOutcome> {
    const current = await this.findDeliveryPlanRevision(input.workspaceId, input.deliveryPlanRevisionId);
    if (!current) return { kind: "NOT_FOUND" };
    if (current.status === "CONSUMED" && current.consumedByProductionRunId === input.productionRunId) {
      return { kind: "ALREADY_CONSUMED", value: current };
    }
    if (current.status !== "APPROVED" || current.blockReasons.length > 0) return { kind: "STATE_INVALID" };
    assertPreflightRevisionTransition(current.status, "CONSUMED");
    const timestamp = now();
    const plan = {
      ...current,
      status: "CONSUMED" as const,
      consumedByProductionRunId: input.productionRunId,
      updatedAt: timestamp,
    };
    this.deliveryPlans.set(plan.id, plan);
    return { kind: "CONSUMED", value: plan };
  }

  private createEvent(input: {
    event: DeliveryPreflightEvent;
    idempotencyKey: string;
    workspaceId: string;
    projectId: string;
    deliveryPlanRevisionId: string;
    eventType: "delivery_plan.preflight_requested" | "delivery_plan.blocked" | "delivery_plan.approved";
    data: Record<string, unknown>;
  }): InternalEventEnvelope {
    return InternalEventEnvelopeSchema.parse({
      contract_version: "1.0",
      event_type: input.eventType,
      message_id: input.event.messageId,
      event_id: input.event.eventId,
      occurred_at: now(),
      trace_id: input.event.traceId,
      correlation_id: input.event.correlationId,
      idempotency_key: input.idempotencyKey,
      producer: "control-api",
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      aggregate: { type: "delivery_plan_revision", id: input.deliveryPlanRevisionId },
      version: 1,
      data: input.data,
    });
  }

  private blockReasons(input: CreateDeliveryPlanRevisionInput) {
    const reasons: string[] = [];
    if (input.voiceMode !== "PLATFORM_GENERIC") reasons.push("VOICE_AUTHORIZATION_REQUIRED");
    if (input.lipSyncRequirement === "REQUIRED") reasons.push("CAPABILITY_NOT_CERTIFIED");
    try {
      assertBudgetWithinApprovedLimit({ estimatedAmount: "0", approvedLimit: input.budgetLimit });
    } catch {
      reasons.push("BUDGET_LIMIT_EXCEEDED");
    }
    return reasons;
  }

  private storeSnapshot(input: { scope: string; idempotencyKey: string; requestHash: string }, snapshot: StoredSnapshot): DeliveryPreflightOutcome<ControlDeliveryPlanRevision> {
    this.commands.set(commandKey(input.scope, input.idempotencyKey), { requestHash: input.requestHash, snapshot });
    if (snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID") return snapshot;
    if (snapshot.kind !== "DELIVERY_PLAN") return { kind: "CONFLICT" };
    const value = this.deliveryPlans.get(snapshot.deliveryPlanRevisionId);
    return value ? { kind: "REPLAY", value, status: 202 } : { kind: "CONFLICT" };
  }

  private replay(scope: string, idempotencyKey: string, requestHash: string): DeliveryPreflightOutcome<ControlDeliveryPlanRevision> | undefined {
    const existing = this.commands.get(commandKey(scope, idempotencyKey));
    if (!existing) return undefined;
    if (existing.requestHash !== requestHash) return { kind: "CONFLICT" };
    if (existing.snapshot.kind !== "DELIVERY_PLAN") return existing.snapshot;
    const value = this.deliveryPlans.get(existing.snapshot.deliveryPlanRevisionId);
    return value ? { kind: "REPLAY", value, status: 202 } : { kind: "CONFLICT" };
  }
}

const serializePersistedDeliveryPlan = (plan: typeof deliveryPlanRevisions.$inferSelect): ControlDeliveryPlanRevision => ({
  id: plan.id,
  workspaceId: plan.workspaceId,
  projectId: plan.projectId,
  creativeBriefRevisionId: plan.creativeBriefRevisionId,
  storyboardRevisionId: plan.storyboardRevisionId,
  revision: plan.revision,
  status: plan.status,
  durationPolicy: plan.durationPolicy,
  flexibleDurationPercent: plan.flexibleDurationPercent,
  targetDurationSeconds: plan.targetDurationSeconds,
  requiresSampleApproval: plan.requiresSampleApproval,
  captionPolicy: plan.captionPolicy,
  lipSyncRequirement: plan.lipSyncRequirement,
  voiceMode: plan.voiceMode,
  safeSummary: plan.safeSummary,
  blockReasons: plan.blockReasons,
  approvedAt: plan.approvedAt,
  consumedByProductionRunId: plan.consumedByProductionRunId,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

const persistedCommandScope = (scope: string, idempotencyKey: string) =>
  and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));

const persistedEvent = (input: {
  event: DeliveryPreflightEvent;
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  planId: string;
  eventType: "delivery_plan.preflight_requested" | "delivery_plan.blocked" | "delivery_plan.approved";
  data: Record<string, unknown>;
}) => InternalEventEnvelopeSchema.parse({
  contract_version: "1.0",
  event_type: input.eventType,
  message_id: input.event.messageId,
  event_id: input.event.eventId,
  occurred_at: new Date().toISOString(),
  trace_id: input.event.traceId,
  correlation_id: input.event.correlationId,
  idempotency_key: input.idempotencyKey,
  producer: "control-api",
  workspace_id: input.workspaceId,
  project_id: input.projectId,
  aggregate: { type: "delivery_plan_revision", id: input.planId },
  version: 1,
  data: input.data,
});

const insertPersistedEvent = async (transaction: Pick<PlatformDatabase, "insert">, event: InternalEventEnvelope) =>
  transaction.insert(outboxEvents).values({
    id: event.event_id,
    workspaceId: event.workspace_id,
    projectId: event.project_id ?? null,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    eventType: event.event_type,
    payload: event,
    occurredAt: event.occurred_at,
    availableAt: event.occurred_at,
  });

export class DrizzleDeliveryPreflightStore implements DeliveryPreflightStore {
  constructor(private readonly db: PlatformDatabase) {}

  async listProjectDeliveryPlanRevisions(workspaceId: string, projectId: string) {
    const plans = await this.db.select().from(deliveryPlanRevisions)
      .where(and(eq(deliveryPlanRevisions.workspaceId, workspaceId), eq(deliveryPlanRevisions.projectId, projectId)))
      .orderBy(asc(deliveryPlanRevisions.revision), asc(deliveryPlanRevisions.createdAt));
    return plans.map(serializePersistedDeliveryPlan);
  }

  async findDeliveryPlanRevision(workspaceId: string, deliveryPlanRevisionId: string) {
    const [plan] = await this.db.select().from(deliveryPlanRevisions)
      .where(and(eq(deliveryPlanRevisions.workspaceId, workspaceId), eq(deliveryPlanRevisions.id, deliveryPlanRevisionId)))
      .limit(1);
    return plan ? serializePersistedDeliveryPlan(plan) : undefined;
  }

  async listDeliveryPreflightEvents(workspaceId: string, projectId: string) {
    const rows = await this.db.select({ payload: outboxEvents.payload }).from(outboxEvents)
      .where(and(
        eq(outboxEvents.workspaceId, workspaceId),
        eq(outboxEvents.projectId, projectId),
        eq(outboxEvents.aggregateType, "delivery_plan_revision"),
      ))
      .orderBy(asc(outboxEvents.occurredAt));
    return rows.flatMap((row) => {
      const event = InternalEventEnvelopeSchema.safeParse(row.payload);
      return event.success ? [event.data] : [];
    });
  }

  async createDeliveryPlanRevision(input: CreateDeliveryPlanRevisionInput): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>> {
    return this.db.transaction(async (transaction) => {
      const existing = await this.reserveOrReplay(transaction, input);
      if (existing) return this.replay(transaction, input.workspaceId, existing);
      const [brief] = await transaction.select().from(creativeBriefRevisions).where(and(eq(creativeBriefRevisions.workspaceId, input.workspaceId), eq(creativeBriefRevisions.id, input.creativeBriefRevisionId))).limit(1);
      const [storyboard] = await transaction.select().from(storyboardRevisions).where(and(eq(storyboardRevisions.workspaceId, input.workspaceId), eq(storyboardRevisions.id, input.storyboardRevisionId))).limit(1);
      if (!brief || !storyboard || brief.projectId !== input.projectId || storyboard.projectId !== input.projectId || brief.status !== "APPROVED" || storyboard.status !== "APPROVED") {
        await this.storeSnapshot(transaction, input, { kind: "NOT_FOUND" });
        return { kind: "NOT_FOUND" };
      }
      const [latest] = await transaction.select({ revision: deliveryPlanRevisions.revision }).from(deliveryPlanRevisions)
        .where(and(eq(deliveryPlanRevisions.workspaceId, input.workspaceId), eq(deliveryPlanRevisions.projectId, input.projectId)))
        .orderBy(desc(deliveryPlanRevisions.revision)).limit(1);
      const blockReasons = this.blockReasons(input);
      const status = blockReasons.length > 0 ? "PREFLIGHT_BLOCKED" : "AWAITING_APPROVAL";
      const timestamp = new Date().toISOString();
      const [plan] = await transaction.insert(deliveryPlanRevisions).values({
        id: input.deliveryPlanRevisionId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        creativeBriefRevisionId: input.creativeBriefRevisionId,
        storyboardRevisionId: input.storyboardRevisionId,
        revision: (latest?.revision ?? 0) + 1,
        status,
        durationPolicy: input.durationPolicy,
        flexibleDurationPercent: input.flexibleDurationPercent,
        targetDurationSeconds: input.targetDurationSeconds,
        requiresSampleApproval: true,
        captionPolicy: input.captionPolicy,
        lipSyncRequirement: input.lipSyncRequirement,
        voiceMode: input.voiceMode,
        safeSummary: blockReasons.length > 0 ? "交付预检被阻断，需先处理授权、能力或预算。" : "交付预检已创建，等待样音和人工批准。",
        blockReasons,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).returning();
      await insertPersistedEvent(transaction, persistedEvent({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planId: plan.id,
        eventType: "delivery_plan.preflight_requested",
        data: {
          delivery_plan_revision_id: plan.id,
          creative_brief_revision_id: plan.creativeBriefRevisionId,
          storyboard_revision_id: plan.storyboardRevisionId,
          status: plan.status,
        },
      }));
      if (status === "PREFLIGHT_BLOCKED") {
        await insertPersistedEvent(transaction, persistedEvent({
          event: { ...input.event, eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg") },
          idempotencyKey: input.idempotencyKey,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          planId: plan.id,
          eventType: "delivery_plan.blocked",
          data: { delivery_plan_revision_id: plan.id, status, reason_codes: blockReasons },
        }));
      }
      await this.storeSnapshot(transaction, input, { kind: "DELIVERY_PLAN", deliveryPlanRevisionId: plan.id });
      return { kind: "NEW", value: serializePersistedDeliveryPlan(plan), status: 202 };
    });
  }

  async approveDeliveryPlanRevision(input: ApproveDeliveryPlanRevisionInput): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>> {
    return this.db.transaction(async (transaction) => {
      const existing = await this.reserveOrReplay(transaction, input);
      if (existing) return this.replay(transaction, input.workspaceId, existing);
      const [current] = await transaction.select().from(deliveryPlanRevisions)
        .where(and(eq(deliveryPlanRevisions.workspaceId, input.workspaceId), eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId)))
        .limit(1).for("update");
      if (!current) {
        await this.storeSnapshot(transaction, input, { kind: "NOT_FOUND" });
        return { kind: "NOT_FOUND" };
      }
      if (current.status !== "AWAITING_APPROVAL") {
        await this.storeSnapshot(transaction, input, { kind: "STATE_INVALID" });
        return { kind: "STATE_INVALID" };
      }
      assertPreflightRevisionTransition(current.status, "APPROVED");
      const [plan] = await transaction.update(deliveryPlanRevisions).set({ status: "APPROVED", approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(and(eq(deliveryPlanRevisions.workspaceId, input.workspaceId), eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId), eq(deliveryPlanRevisions.status, "AWAITING_APPROVAL"))).returning();
      await insertPersistedEvent(transaction, persistedEvent({
        event: input.event,
        idempotencyKey: input.idempotencyKey,
        workspaceId: plan.workspaceId,
        projectId: plan.projectId,
        planId: plan.id,
        eventType: "delivery_plan.approved",
        data: { delivery_plan_revision_id: plan.id, status: "APPROVED" },
      }));
      await this.storeSnapshot(transaction, input, { kind: "DELIVERY_PLAN", deliveryPlanRevisionId: plan.id });
      return { kind: "NEW", value: serializePersistedDeliveryPlan(plan), status: 202 };
    });
  }

  async consumeDeliveryPlanRevision(input: { workspaceId: string; deliveryPlanRevisionId: string; productionRunId: string }): Promise<DeliveryPlanConsumptionOutcome> {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(deliveryPlanRevisions)
        .where(and(eq(deliveryPlanRevisions.workspaceId, input.workspaceId), eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId))).limit(1).for("update");
      if (!current) return { kind: "NOT_FOUND" };
      if (current.status === "CONSUMED" && current.consumedByProductionRunId === input.productionRunId) return { kind: "ALREADY_CONSUMED", value: serializePersistedDeliveryPlan(current) };
      if (current.status !== "APPROVED" || current.blockReasons.length > 0) return { kind: "STATE_INVALID" };
      assertPreflightRevisionTransition(current.status, "CONSUMED");
      const [plan] = await transaction.update(deliveryPlanRevisions).set({ status: "CONSUMED", consumedByProductionRunId: input.productionRunId, updatedAt: new Date().toISOString() })
        .where(and(eq(deliveryPlanRevisions.workspaceId, input.workspaceId), eq(deliveryPlanRevisions.id, input.deliveryPlanRevisionId), eq(deliveryPlanRevisions.status, "APPROVED"))).returning();
      return plan ? { kind: "CONSUMED", value: serializePersistedDeliveryPlan(plan) } : { kind: "STATE_INVALID" };
    });
  }

  private async reserveOrReplay(transaction: Pick<PlatformDatabase, "insert" | "select">, input: { scope: string; idempotencyKey: string; requestHash: string }) {
    const [inserted] = await transaction.insert(commandDeduplications).values({ scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: {} }).onConflictDoNothing().returning({ scope: commandDeduplications.scope });
    if (inserted) return undefined;
    const [existing] = await transaction.select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot }).from(commandDeduplications).where(persistedCommandScope(input.scope, input.idempotencyKey)).limit(1);
    if (!existing || existing.requestHash !== input.requestHash) return "CONFLICT" as const;
    return existing.responseSnapshot as { kind: string; deliveryPlanRevisionId?: string };
  }

  private async replay(transaction: Pick<PlatformDatabase, "select">, workspaceId: string, snapshot: { kind: string; deliveryPlanRevisionId?: string } | "CONFLICT"): Promise<DeliveryPreflightOutcome<ControlDeliveryPlanRevision>> {
    if (snapshot === "CONFLICT") return { kind: "CONFLICT" };
    if (snapshot.kind === "DELIVERY_PLAN" && snapshot.deliveryPlanRevisionId) {
      const [plan] = await transaction.select().from(deliveryPlanRevisions).where(and(eq(deliveryPlanRevisions.workspaceId, workspaceId), eq(deliveryPlanRevisions.id, snapshot.deliveryPlanRevisionId))).limit(1);
      return plan ? { kind: "REPLAY", value: serializePersistedDeliveryPlan(plan), status: 202 } : { kind: "CONFLICT" };
    }
    return snapshot.kind === "NOT_FOUND" || snapshot.kind === "STATE_INVALID" ? { kind: snapshot.kind } : { kind: "CONFLICT" };
  }

  private async storeSnapshot(transaction: Pick<PlatformDatabase, "update">, input: { scope: string; idempotencyKey: string }, snapshot: Record<string, unknown>) {
    await transaction.update(commandDeduplications).set({ responseSnapshot: snapshot }).where(persistedCommandScope(input.scope, input.idempotencyKey));
  }

  private blockReasons(input: CreateDeliveryPlanRevisionInput) {
    const reasons: string[] = [];
    if (input.voiceMode !== "PLATFORM_GENERIC") reasons.push("VOICE_AUTHORIZATION_REQUIRED");
    if (input.lipSyncRequirement === "REQUIRED") reasons.push("CAPABILITY_NOT_CERTIFIED");
    try { assertBudgetWithinApprovedLimit({ estimatedAmount: "0", approvedLimit: input.budgetLimit }); } catch { reasons.push("BUDGET_LIMIT_EXCEEDED"); }
    return reasons;
  }
}
