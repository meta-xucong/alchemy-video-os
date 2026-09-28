import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { InternalCreativePlanningQueueMessageSchema, type InternalEventEnvelope } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";

import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { DrizzleCreativePlanningRepository } from "../src/creative-planning-repository.js";
import { createDatabase } from "../src/db.js";
import { eventConsumptions, outboxEvents, promptPackages, taskRuns } from "../src/schema.js";

const event = () => ({
  eventId: createPrefixedId("evt"),
  messageId: createPrefixedId("msg"),
  traceId: createPrefixedId("trc"),
  correlationId: createPrefixedId("cor"),
});

const planningEvent = (value: InternalEventEnvelope) => {
  if (value.event_type !== "creative_brief.planning_requested") throw new Error("Expected a creative planning request event.");
  return value;
};

test("C11 Drizzle planning persists the durable review path without creating execution work", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `c11-pg-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "C11 PostgreSQL" }, workspace: { id: workspaceId, name: "C11 PostgreSQL" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "C11 persistent planning" }),
      workspaceId,
      projectId,
      name: "C11 persistent planning",
    })).kind, "NEW");

    const created = await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ source_text: "雨夜抵达工厂，团队在黎明前完成交付。", target_duration_seconds: 30, target_resolution: "480p" }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText: "雨夜抵达工厂，团队在黎明前完成交付。",
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "克制的纪实感",
      sourceAssetIds: [],
      event: event(),
    });
    assert.equal(created.kind, "NEW");
    if (created.kind !== "NEW") return;
    assert.equal(created.value.targetResolution, "480p");

    const requested = await planning.requestCreativePlan({
      scope: `${scope}:plan`,
      idempotencyKey: "request-plan",
      requestHash: fingerprintRequest({}),
      workspaceId,
      creativeBriefRevisionId: briefId,
      event: event(),
    });
    assert.equal(requested.kind, "NEW");
    if (requested.kind !== "NEW") return;
    assert.equal(requested.value.status, "PLANNING");

    const [queued] = await planning.claimOutboxEvents({
      relayId: `${scope}:relay`,
      now: new Date(),
      leaseMs: 1_000,
      limit: 5,
      eventTypes: ["creative_brief.planning_requested"],
    });
    assert.ok(queued);
    const durableEvent = planningEvent(queued.event);
    const message = InternalCreativePlanningQueueMessageSchema.parse({
      contract_version: durableEvent.contract_version,
      event_id: durableEvent.event_id,
      workspace_id: durableEvent.workspace_id,
      project_id: durableEvent.project_id,
      creative_brief_revision_id: durableEvent.data.creative_brief_revision_id,
      correlation_id: durableEvent.correlation_id,
    });
    const claim = await planning.claimCreativePlanningEvent({
      message,
      consumerName: "c11-pg-consumer",
      workerId: "c11-pg-worker-first",
      now: new Date(),
      leaseMs: 1_000,
    });
    assert.equal(claim.kind, "CLAIMED");
    const busy = await planning.claimCreativePlanningEvent({
      message,
      consumerName: "c11-pg-consumer",
      workerId: "c11-pg-worker-second",
      now: new Date(),
      leaseMs: 1_000,
    });
    assert.equal(busy.kind, "BUSY");

    const terminalConsumer = "c11-pg-consumer-terminal";
    const terminalClaim = await planning.claimCreativePlanningEvent({
      message,
      consumerName: terminalConsumer,
      workerId: "c11-pg-worker-terminal",
      now: new Date(),
      leaseMs: 1_000,
    });
    assert.equal(terminalClaim.kind, "CLAIMED");
    await planning.releaseCreativePlanningEvent({
      eventId: message.event_id,
      workspaceId,
      consumerName: terminalConsumer,
      workerId: "c11-pg-worker-terminal",
      reason: "DIRECTOR_TIMEOUT",
      deadLetter: false,
      now: new Date(),
    });
    await planning.releaseCreativePlanningEvent({
      eventId: message.event_id,
      workspaceId,
      consumerName: terminalConsumer,
      workerId: "c11-pg-worker-terminal",
      reason: "DIRECTOR_TIMEOUT_EXHAUSTED",
      deadLetter: true,
      now: new Date(),
    });
    const [terminalConsumption] = await database.db
      .select({ deadLetteredAt: eventConsumptions.deadLetteredAt, lastError: eventConsumptions.lastError })
      .from(eventConsumptions)
      .where(and(
        eq(eventConsumptions.workspaceId, workspaceId),
        eq(eventConsumptions.eventId, message.event_id),
        eq(eventConsumptions.consumerName, terminalConsumer),
      ));
    assert.ok(terminalConsumption?.deadLetteredAt);
    assert.equal(terminalConsumption?.lastError, "DIRECTOR_TIMEOUT_EXHAUSTED");
    assert.equal((await planning.claimCreativePlanningEvent({
      message,
      consumerName: terminalConsumer,
      workerId: "c11-pg-worker-after-terminal",
      now: new Date(),
      leaseMs: 1_000,
    })).kind, "DUPLICATE");

    await planning.releaseCreativePlanningEvent({
      eventId: message.event_id,
      workspaceId,
      consumerName: "c11-pg-consumer",
      workerId: "c11-pg-worker-first",
      reason: "DIRECTOR_TIMEOUT",
      deadLetter: false,
      now: new Date(),
    });
    const reclaimed = await planning.claimCreativePlanningEvent({
      message,
      consumerName: "c11-pg-consumer",
      workerId: "c11-pg-worker-second",
      now: new Date(),
      leaseMs: 1_000,
    });
    assert.equal(reclaimed.kind, "CLAIMED");

    const shotOneId = createPrefixedId("ssp");
    const shotTwoId = createPrefixedId("ssp");
    const completed = await planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: briefId,
      draft: {
        scriptRevisionId: createPrefixedId("scr"),
        storyboardRevisionId: createPrefixedId("sbr"),
        beats: [
          { sequence: 1, title: "抵达", summary: "雨夜抵达工厂", narrative_goal: "建立压力", visible_facts: ["雨夜", "工厂"] },
          { sequence: 2, title: "交付", summary: "团队完成交付", narrative_goal: "兑现承诺", visible_facts: ["车间", "黎明"] },
        ],
        title: "雨夜交付",
        summary: "团队在黎明前完成承诺。",
        totalDurationSeconds: 30,
        continuityLevel: "STANDARD",
        continuityNote: "通过明确转场承接两段叙事。",
        shotSpecs: [
          { id: shotOneId, sequence: 1, title: "雨夜抵达", durationSeconds: 15, narrativeGoal: "建立压力", startState: "雨夜街道", endState: "进入车间", transitionSummary: "车间亮灯", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "建立开场状态" },
          { id: shotTwoId, sequence: 2, title: "黎明交付", durationSeconds: 15, narrativeGoal: "兑现承诺", startState: "车间亮灯", endState: "客户收到成果", transitionSummary: "淡入黎明", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [1], continuityNote: "承接前段动作" },
        ],
        promptPackages: [
          { id: createPrefixedId("ppk"), shotSpecId: shotOneId, compilerVersion: "integration", prompt: "雨夜抵达", visualConstraints: {}, referenceMap: {}, capabilitySnapshot: { bgm_prompt: "ambient beauty" } },
          { id: createPrefixedId("ppk"), shotSpecId: shotTwoId, compilerVersion: "integration", prompt: "黎明交付", visualConstraints: {}, referenceMap: {}, capabilitySnapshot: { bgm_prompt: "warm piano" } },
        ],
      },
      event: event(),
    });
    assert.ok(completed);
    if (!completed) return;
    assert.deepEqual(await planning.listStoryboardMusicIntentHints(workspaceId, completed.id), ["ambient beauty", "warm piano"]);
    await database.db.insert(promptPackages).values({
      id: createPrefixedId("ppk"),
      workspaceId,
      projectId,
      shotSpecId: shotOneId,
      compilerVersion: "integration-newer",
      prompt: "雨夜抵达（最新）",
      visualConstraints: {},
      referenceMap: {},
      capabilitySnapshot: {},
      createdAt: new Date(Date.now() + 1_000),
    });
    assert.deepEqual(await planning.listStoryboardMusicIntentHints(workspaceId, completed.id), ["warm piano"]);
    await planning.completeCreativePlanningEvent({
      eventId: message.event_id,
      workspaceId,
      consumerName: "c11-pg-consumer",
      workerId: "c11-pg-worker-second",
      now: new Date(),
    });
    const duplicate = await planning.claimCreativePlanningEvent({
      message,
      consumerName: "c11-pg-consumer",
      workerId: "c11-pg-worker-second",
      now: new Date(),
      leaseMs: 1_000,
    });
    assert.equal(duplicate.kind, "DUPLICATE");

    const approved = await planning.approveStoryboardRevision({
      scope: `${scope}:approve`,
      idempotencyKey: "approve",
      requestHash: fingerprintRequest({}),
      workspaceId,
      storyboardRevisionId: completed.id,
      event: event(),
    });
    assert.equal(approved.kind, "NEW");
    if (approved.kind !== "NEW") return;
    assert.equal(approved.value.status, "APPROVED");
    const production = await planning.createProductionRun({
      scope: `${scope}:production`,
      idempotencyKey: "confirm-production",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id }),
      workspaceId,
      projectId,
      productionRunId: createPrefixedId("prd"),
      storyboardRevisionId: completed.id,
      event: event(),
    });
    assert.equal(production.kind, "NEW");
    if (production.kind !== "NEW") return;
    assert.equal(production.value.status, "CONFIRMED");

    const [consumption] = await database.db
      .select({ completedAt: eventConsumptions.completedAt })
      .from(eventConsumptions)
      .where(and(eq(eventConsumptions.workspaceId, workspaceId), eq(eventConsumptions.eventId, message.event_id)));
    assert.ok(consumption?.completedAt);
    const eventTypes = await database.db
      .select({ eventType: outboxEvents.eventType })
      .from(outboxEvents)
      .where(eq(outboxEvents.workspaceId, workspaceId));
    assert.deepEqual(eventTypes.map((row) => row.eventType).sort(), [
      "creative_brief.planning_requested",
      "production_run.confirmed",
      "storyboard_revision.approved",
      "storyboard_revision.ready_for_review",
    ]);
    assert.equal((await database.db.select({ id: taskRuns.id }).from(taskRuns).where(eq(taskRuns.workspaceId, workspaceId))).length, 0);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});
