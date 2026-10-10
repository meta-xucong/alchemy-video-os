import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { InternalCreativePlanningQueueMessageSchema, InternalEventEnvelopeSchema, type InternalEventEnvelope } from "@alchemy-video/contracts";
import { createPrefixedId, fingerprintRequest } from "@alchemy-video/domain";
import { createSemanticNarrativeBeatLineage, normalizeLocation, normalizeName, semanticValueHash } from "../../creative-planning/src/semantic-director.js";

import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { DrizzleCreativePlanningRepository } from "../src/creative-planning-repository.js";
import { DrizzleDeliveryPreflightStore } from "../src/delivery-preflight-repository.js";
import { createDatabase } from "../src/db.js";
import { DrizzleNarrationQualityStore, type NarrationAudioGenerationEvent } from "../src/narration-quality-repository.js";
import { findApprovedNarrationTimeline } from "../src/approved-narration-timeline.js";
import {
  assets,
  canonicalVisualEntities,
  canonicalVisualEntityRevisionAssets,
  canonicalVisualEntityRevisions,
  creativeBriefRevisions,
  deliveryPlanRevisions,
  eventConsumptions,
  narrationAssetVersions,
  narrationScriptRevisions,
  outboxEvents,
  promptPackages,
  productionRuns,
  scriptRevisions,
  storyboardRevisions,
  storyboardShotSpecs,
  taskRuns,
  timelinePlans,
} from "../src/schema.js";

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

const g02Source = (label: string) => [
  `G02_APPROVED_BEAT_1:${label} @林女士 @研发灌装空间 @面霜罐 第一节拍。`,
  `G02_APPROVED_BEAT_2:${label} @林女士 @研发灌装空间 @面霜罐 第二节拍。`,
  `G02_APPROVED_BEAT_3:${label} @林女士 @研发灌装空间 @面霜罐 第三节拍。`,
].join("\n");

const g02Draft = (input: {
  briefRevisionId: string;
  sourceText: string;
  suffix: string;
  revisionFlavor?: string;
  assetBindings?: Array<{ assetId: string; sha256: string; usage: string; evidenceId: string }>;
}) => {
  const lineage = createSemanticNarrativeBeatLineage({ briefRevisionId: input.briefRevisionId, sourceText: input.sourceText });
  assert.ok(lineage);
  const assetBindings = input.assetBindings ?? [];
  const candidateDefs = [
    { candidate_key: "entity-woman", kind: "CHARACTER" as const, exact_name: "林女士", role: "使用者", description: `人物描述${input.revisionFlavor ?? "稳定"}`, appearance: "自然状态", styling: "日常造型", reference_asset_ids: assetBindings[1] ? [assetBindings[1].assetId] : [] },
    { candidate_key: "entity-lab", kind: "SCENE" as const, exact_name: "研发灌装空间", location: "研发灌装空间", prompt: `单一研发场景${input.revisionFlavor ?? "稳定"}`, lighting: "柔和日光", reference_asset_ids: assetBindings[0] ? [assetBindings[0].assetId] : [] },
    { candidate_key: "entity-jar", kind: "PROP" as const, exact_name: "面霜罐", type: "护肤品容器", description: `白色面霜罐${input.revisionFlavor ?? "稳定"}`, reference_asset_ids: assetBindings[2] ? [assetBindings[2].assetId] : [] },
  ];
  const sourceHash = createHash("sha256").update(input.sourceText, "utf8").digest("hex");
  const decisionHash = createHash("sha256").update(`decision:${input.suffix}`, "utf8").digest("hex");
  const candidates = candidateDefs.map((candidate) => ({
    ...candidate,
    source_evidence_refs: [input.sourceText.split("\n")[0]!],
  }));
  const promptPackages = [1, 2, 3].map((sequence) => {
    const shotSpecId = createPrefixedId("ssp");
    const id = createPrefixedId("ppk");
    const segmentId = `seg_g02_${input.suffix}_${sequence}`;
    const refs = assetBindings.map((binding, index) => ({
      asset_id: binding.assetId,
      provider_role: (index === 0 ? "SCENE" : "SUBJECT") as "SCENE" | "SUBJECT",
      usage: binding.usage,
      evidence_ids: [binding.evidenceId],
    }));
    const beatProjection = { version: 1 as const, brief_revision_id: input.briefRevisionId, source_hash: sourceHash, beat: lineage.beats[sequence - 1]! };
    const prompt = "@林女士 @研发灌装空间 @面霜罐 在同一段中展示。";
    return {
      id,
      shotSpecId,
      compilerVersion: "g02-persistence-integration",
      prompt,
      visualConstraints: { semantic_segment_id: segmentId, semantic_decision_hash: decisionHash, evidence_ids: assetBindings.map((binding) => binding.evidenceId) },
      referenceMap: { reference_policy: "REFERENCE_SET", semantic_reference_projection: { version: 1 as const, source_hash: sourceHash, decision_hash: decisionHash, segment_id: segmentId, references: refs } },
      capabilitySnapshot: {
        semantic_dialogue_projection: { version: 1 as const, source_hash: sourceHash, decision_hash: decisionHash, segment_id: segmentId, dialogues: [] },
        audio_owner: "NATIVE_PROVIDER",
        source_prompt: input.sourceText,
        generated_prompt_parts: [prompt],
        evidence_ids: assetBindings.map((binding) => binding.evidenceId),
        max_duration_seconds: 15,
        max_reference_images: 7,
        semantic_narrative_beat_lineage: beatProjection,
        semantic_narrative_beat_lineage_hash: semanticValueHash(beatProjection),
      },
      semanticEntityCandidates: candidates,
      semanticEntityCandidateBindings: { scene: "entity-lab", characters: ["entity-woman"], props: ["entity-jar"] },
      semanticReferenceSourceAssets: assetBindings.map((binding) => ({
        assetId: binding.assetId,
        assetSha256: binding.sha256,
        usage: binding.usage,
        evidenceId: binding.evidenceId,
      })),
    };
  });
  return {
    scriptRevisionId: createPrefixedId("scr"),
    storyboardRevisionId: createPrefixedId("sbr"),
    beats: input.sourceText.split("\n").map((line, index) => ({ sequence: index + 1, title: `Beat ${index + 1}`, summary: line, narrative_goal: line, visible_facts: ["面霜罐"], generation_segment_sequence: index + 1 })),
    title: `G02 ${input.suffix}`,
    summary: "Persistence-only three-beat fixture.",
    totalDurationSeconds: 30,
    continuityLevel: "STANDARD" as const,
    continuityNote: "Preserve the three source segments.",
    shotSpecs: promptPackages.map((promptPackage, index) => ({
      id: promptPackage.shotSpecId,
      sequence: index + 1,
      title: `Shot ${index + 1}`,
      durationSeconds: 10,
      narrativeGoal: `Persist beat ${index + 1}`,
      startState: "Start",
      endState: "End",
      transitionSummary: "Continue.",
      referencePolicy: "REFERENCE_SET" as const,
      dependsOnSequences: index === 0 ? [] : [index],
      continuityNote: "Fixture.",
      narrativeBeatSequences: [index + 1],
    })),
    narrativeBeatCount: 3,
    generationSegmentCount: 3,
    promptPackages,
  };
};

const g02Semantics = { normalizeName, normalizeLocation, semanticValueHash };
const storyboardEntityId = (entities: Array<{ id: string; entityKind: string }>, kind: string) => {
  const entity = entities.find((row) => row.entityKind === kind);
  assert.ok(entity, `expected the persisted ${kind} entity claim`);
  return entity.id;
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
    const beforeBlockedDoubao = await database.db.select({ id: productionRuns.id }).from(productionRuns).where(eq(productionRuns.projectId, projectId));
    const blockedDoubao = await planning.createProductionRun({
      scope: `${scope}:doubao-preflight`,
      idempotencyKey: "confirm-production-without-formal-doubao-timeline",
      requestHash: fingerprintRequest({ storyboard_revision_id: completed.id, audio_selection: "DOUBAO_TTS_REPLACE" }),
      workspaceId,
      projectId,
      productionRunId: createPrefixedId("prd"),
      storyboardRevisionId: completed.id,
      audioSelection: "DOUBAO_TTS_REPLACE",
      event: event(),
    });
    assert.equal(blockedDoubao.kind, "PREFLIGHT_BLOCKED");
    const afterBlockedDoubao = await database.db.select({ id: productionRuns.id }).from(productionRuns).where(eq(productionRuns.projectId, projectId));
    assert.equal(afterBlockedDoubao.length, beforeBlockedDoubao.length);
    const blockedRunEvents = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.eventType, "production_run.confirmed"));
    assert.equal(blockedRunEvents.length, 0);
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

test("Drizzle planning binds G02 mode to the Brief marker and fails closed on missing/mismatched projections", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `g02-mode-pg-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const database = createDatabase(databaseUrl);
  const planning = new DrizzleCreativePlanningRepository(database.db);

  const readyDraft = (g02PackageFields: boolean) => {
    const shotIds = [1, 2, 3].map(() => createPrefixedId("ssp"));
    return {
      scriptRevisionId: createPrefixedId("scr"),
      storyboardRevisionId: createPrefixedId("sbr"),
      beats: [1, 2, 3].map((sequence) => ({
        sequence,
        title: `Beat ${sequence}`,
        summary: `Source beat ${sequence}`,
        narrative_goal: `Show beat ${sequence}`,
        visible_facts: [`fact-${sequence}`],
        generation_segment_sequence: sequence,
      })),
      title: "G02 marker gate test",
      summary: "Three source beats, no provider execution.",
      totalDurationSeconds: 30,
      continuityLevel: "STANDARD" as const,
      continuityNote: "Keep adjacent segment transitions explicit.",
      shotSpecs: shotIds.map((id, index) => ({
        id,
        sequence: index + 1,
        title: `Segment ${index + 1}`,
        durationSeconds: 10,
        narrativeGoal: `Render source beat ${index + 1}`,
        startState: "Starting state",
        endState: "Ending state",
        transitionSummary: "Continuous transition",
        referencePolicy: "TEXT_TRANSITION" as const,
        dependsOnSequences: index === 0 ? [] : [index],
        continuityNote: "No new scene boundary.",
        narrativeBeatSequences: [index + 1],
      })),
      promptPackages: shotIds.map((shotSpecId, index) => ({
        id: createPrefixedId("ppk"),
        shotSpecId,
        compilerVersion: "g02-mode-test",
        prompt: `Segment ${index + 1}`,
        visualConstraints: {},
        referenceMap: {},
        capabilitySnapshot: g02PackageFields ? { semantic_narrative_beat_lineage: { fixture: true } } : {},
      })),
    };
  };

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "G02 marker gate" }, workspace: { id: workspaceId, name: "G02 marker gate" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "G02 marker gate" }),
      workspaceId,
      projectId,
      name: "G02 marker gate",
    })).kind, "NEW");

    const markedBriefId = createPrefixedId("cbr");
    const sourceText = [
      "G02_APPROVED_BEAT_1:批准节拍一。",
      "G02_APPROVED_BEAT_2:批准节拍二。",
      "G02_APPROVED_BEAT_3:批准节拍三。",
    ].join("\n");
    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:marked-brief`,
      idempotencyKey: "create-marked-brief",
      requestHash: fingerprintRequest({ sourceText }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: markedBriefId,
      sourceText,
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "克制",
      sourceAssetIds: [],
      event: event(),
    })).kind, "NEW");
    assert.equal((await planning.requestCreativePlan({
      scope: `${scope}:marked-plan`,
      idempotencyKey: "request-marked-plan",
      requestHash: fingerprintRequest({}),
      workspaceId,
      creativeBriefRevisionId: markedBriefId,
      event: event(),
    })).kind, "NEW");
    await assert.rejects(() => planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: markedBriefId,
      draft: readyDraft(false),
      event: event(),
    }), /G02 persistence requires the validated source semantic callbacks/u);

    const legacyBriefId = createPrefixedId("cbr");
    const legacySource = "Ordinary source without G02 markers.";
    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:legacy-brief`,
      idempotencyKey: "create-legacy-brief",
      requestHash: fingerprintRequest({ legacySource }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: legacyBriefId,
      sourceText: legacySource,
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "克制",
      sourceAssetIds: [],
      event: event(),
    })).kind, "NEW");
    assert.equal((await planning.requestCreativePlan({
      scope: `${scope}:legacy-plan`,
      idempotencyKey: "request-legacy-plan",
      requestHash: fingerprintRequest({}),
      workspaceId,
      creativeBriefRevisionId: legacyBriefId,
      event: event(),
    })).kind, "NEW");
    await assert.rejects(() => planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: legacyBriefId,
      draft: readyDraft(true),
      event: event(),
    }), /without a locked Brief source marker/u);
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

test("G02 Drizzle planning persists entity revisions, mappings, ShotSpec bindings, PromptPackages, and legacy loader values", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `g02-persistence-roundtrip-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const sourceText = g02Source("实体绑定闭环");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "G02 persistence roundtrip" }, workspace: { id: workspaceId, name: "G02 persistence roundtrip" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "G02 persistence roundtrip" }),
      workspaceId,
      projectId,
      name: "G02 persistence roundtrip",
    })).kind, "NEW");

    const bindings = [
      { entity: "研发灌装空间", role: "SCENE" as const, providerRole: "SCENE" as const },
      { entity: "林女士", role: "SUBJECT" as const, providerRole: "SUBJECT" as const },
      { entity: "面霜罐", role: "SUBJECT" as const, providerRole: "SUBJECT" as const },
    ].map((item) => ({
      ...item,
      assetId: createPrefixedId("ast"),
      sha256: createHash("sha256").update(`${scope}:${item.entity}`, "utf8").digest("hex"),
      evidenceId: createPrefixedId("evd"),
      usage: `${item.entity}的单体参考图，用于该实体身份和画面用途。`,
    }));
    await database.db.insert(assets).values(bindings.map((binding) => ({
      id: binding.assetId,
      workspaceId,
      projectId,
      kind: "IMAGE" as const,
      origin: "USER_UPLOAD" as const,
      status: "READY" as const,
      objectKey: `${workspaceId}/${projectId}/${binding.assetId}/fixture.png`,
      sha256: binding.sha256,
      mimeType: "image/png",
      byteSize: 128,
      metadata: {},
    })));

    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ sourceText }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText,
      targetDurationSeconds: 30,
      targetResolution: "480p",
      stylePreferences: "Persistence fixture only",
      sourceAssetIds: bindings.map((binding) => binding.assetId),
      sourceAssetRoles: bindings.map((binding) => ({ assetId: binding.assetId, role: binding.role, usage: binding.usage })),
      event: event(),
    })).kind, "NEW");
    assert.equal((await planning.requestCreativePlan({
      scope: `${scope}:plan`,
      idempotencyKey: "request-plan",
      requestHash: fingerprintRequest({}),
      workspaceId,
      creativeBriefRevisionId: briefId,
      event: event(),
    })).kind, "NEW");

    const draft = g02Draft({ briefRevisionId: briefId, sourceText, suffix: "roundtrip", assetBindings: bindings.map(({ assetId, sha256, usage, evidenceId }) => ({ assetId, sha256, usage, evidenceId })) });
    const storyboard = await planning.completeCreativePlan({ workspaceId, creativeBriefRevisionId: briefId, draft, semanticVisualEntitySemantics: g02Semantics, event: event() });
    assert.ok(storyboard);
    const loadedStoryboard = await planning.findStoryboardRevision(workspaceId, storyboard.id);
    assert.ok(loadedStoryboard, "the persisted G02 storyboard must be readable through the repository loader");
    assert.deepEqual(storyboard.shotSpecs.map((shot) => ({ sceneId: shot.sceneId, characterIds: shot.characterIds, propIds: shot.propIds, referenceAnchors: shot.referenceAnchors })), Array.from({ length: 3 }, () => ({
      sceneId: storyboard.shotSpecs[0]?.sceneId,
      characterIds: storyboard.shotSpecs[0]?.characterIds,
      propIds: storyboard.shotSpecs[0]?.propIds,
      referenceAnchors: ["@林女士", "@研发灌装空间", "@面霜罐"],
    })));
    assert.ok(storyboard.shotSpecs[0]?.sceneId);
    assert.equal(storyboard.shotSpecs[0]?.characterIds.length, 1);
    assert.equal(storyboard.shotSpecs[0]?.propIds.length, 1);

    const persistedShotRows = await database.db.select().from(storyboardShotSpecs).where(eq(storyboardShotSpecs.storyboardRevisionId, storyboard.id));
    assert.equal(persistedShotRows.length, 3);
    const orderedShotRows = persistedShotRows.sort((left, right) => left.sequence - right.sequence);
    assert.deepEqual(loadedStoryboard.shotSpecs.map(({ sequence, sceneId, characterIds, propIds, referenceAnchors }) => ({ sequence, sceneId, characterIds, propIds, referenceAnchors })), orderedShotRows.map(({ sequence, sceneId, characterIds, propIds, referenceAnchors }) => ({ sequence, sceneId: sceneId ?? undefined, characterIds, propIds, referenceAnchors })));
    assert.deepEqual(loadedStoryboard.shotSpecs.map(({ sequence, referenceAnchors }) => ({ sequence, referenceAnchors })), [1, 2, 3].map((sequence) => ({ sequence, referenceAnchors: ["@林女士", "@研发灌装空间", "@面霜罐"] })));
    assert.ok(loadedStoryboard.shotSpecs.every((shot) => shot.sceneId === storyboard.shotSpecs[0]?.sceneId));
    assert.ok(loadedStoryboard.shotSpecs.every((shot) => JSON.stringify(shot.characterIds) === JSON.stringify(storyboard.shotSpecs[0]?.characterIds)));
    assert.ok(loadedStoryboard.shotSpecs.every((shot) => JSON.stringify(shot.propIds) === JSON.stringify(storyboard.shotSpecs[0]?.propIds)));

    const entities = await database.db.select().from(canonicalVisualEntities).where(and(eq(canonicalVisualEntities.workspaceId, workspaceId), eq(canonicalVisualEntities.projectId, projectId)));
    const revisions = await database.db.select().from(canonicalVisualEntityRevisions).where(and(eq(canonicalVisualEntityRevisions.workspaceId, workspaceId), eq(canonicalVisualEntityRevisions.projectId, projectId)));
    const mappings = await database.db.select().from(canonicalVisualEntityRevisionAssets).where(and(eq(canonicalVisualEntityRevisionAssets.workspaceId, workspaceId), eq(canonicalVisualEntityRevisionAssets.projectId, projectId)));
    const packages = await database.db.select().from(promptPackages).where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.projectId, projectId)));
    const successEvents = await database.db.select().from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "storyboard_revision.ready_for_review")));
    assert.deepEqual(entities.map((row) => row.entityKind).sort(), ["CHARACTER", "PROP", "SCENE"]);
    assert.equal(revisions.length, 3);
    assert.equal(mappings.length, 3);
    assert.equal(packages.length, 3);
    assert.equal(successEvents.length, 1);
    assert.ok(mappings.every((mapping) => mapping.changeKind === "ADD" && mapping.referenceEvidenceId && mapping.mappingEvidenceId));
    const projection = packages[0]?.referenceMap as { semantic_entity_reference_projection?: { bindings?: Array<{ entity_id: string; asset_id: string; provider_position: number }> } };
    assert.equal(projection.semantic_entity_reference_projection?.bindings?.length, 3);
    assert.deepEqual(projection.semantic_entity_reference_projection?.bindings?.map((binding) => binding.provider_position), [0, 1, 2]);

    const legacyBriefId = createPrefixedId("cbr");
    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:legacy-brief`, idempotencyKey: "create-legacy-brief", requestHash: fingerprintRequest({ legacy: true }),
      workspaceId, projectId, creativeBriefRevisionId: legacyBriefId, sourceText: "Historical storyboard fixture.", targetDurationSeconds: 30,
      targetResolution: "480p", stylePreferences: "Legacy", sourceAssetIds: [], event: event(),
    })).kind, "NEW");
    const legacyScriptId = createPrefixedId("scr");
    const legacyStoryboardId = createPrefixedId("sbr");
    const legacyShotId = createPrefixedId("ssp");
    await database.db.insert(scriptRevisions).values({ id: legacyScriptId, workspaceId, projectId, creativeBriefRevisionId: legacyBriefId, revision: 1, beats: [], status: "READY_FOR_REVIEW" });
    await database.db.insert(storyboardRevisions).values({ id: legacyStoryboardId, workspaceId, projectId, scriptRevisionId: legacyScriptId, revision: 1, title: "Legacy", summary: "Migrated historical row", totalDurationSeconds: 10, continuityLevel: "STANDARD", continuityNote: "Legacy fixture", status: "READY_FOR_REVIEW" });
    await database.db.insert(storyboardShotSpecs).values({
      id: legacyShotId, workspaceId, projectId, storyboardRevisionId: legacyStoryboardId, sequence: 1, title: "Legacy row", durationSeconds: 10,
      narrativeGoal: "Preserve historical fields", startState: "", endState: "", transitionSummary: "", referencePolicy: "TEXT_TRANSITION",
      dependsOnSequences: [], narrativeBeatSequences: [1], continuityNote: "", referenceAnchors: ["legacy-anchor-kept-verbatim", "@旧实体 原样"],
    });
    const legacyLoaded = await planning.findStoryboardRevision(workspaceId, legacyStoryboardId);
    assert.equal(legacyLoaded?.shotSpecs[0]?.sceneId, undefined);
    assert.deepEqual(legacyLoaded?.shotSpecs[0]?.characterIds, []);
    assert.deepEqual(legacyLoaded?.shotSpecs[0]?.propIds, []);
    assert.deepEqual(legacyLoaded?.shotSpecs[0]?.referenceAnchors, ["legacy-anchor-kept-verbatim", "@旧实体 原样"]);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM event_consumptions WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM canonical_visual_entity_revision_assets WHERE workspace_id = $1 AND project_id = $2", [workspaceId, projectId]);
      await client.query("DELETE FROM outbox_events WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("G02 Drizzle planning rejects an unapproved candidate reference and rolls back all planning facts", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `g02-persistence-unapproved-ref-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const sourceText = g02Source("引用批准门负例");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "G02 unapproved reference" }, workspace: { id: workspaceId, name: "G02 unapproved reference" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`, idempotencyKey: "create-project", requestHash: fingerprintRequest({ name: "G02 unapproved reference" }),
      workspaceId, projectId, name: "G02 unapproved reference",
    })).kind, "NEW");

    const bindings = [
      { entity: "研发灌装空间", role: "SCENE" as const },
      { entity: "林女士", role: "SUBJECT" as const, status: "READY" as const },
      { entity: "面霜罐", role: "SUBJECT" as const, status: "READY" as const },
    ].map((binding) => ({
      ...binding,
      status: "READY" as const,
      assetId: createPrefixedId("ast"),
      sha256: createHash("sha256").update(`${scope}:${binding.entity}`, "utf8").digest("hex"),
      evidenceId: createPrefixedId("evd"),
      usage: `${binding.entity}单体参考图，用于该实体身份和段内引用。`,
    }));
    await database.db.insert(assets).values(bindings.map((binding) => ({
      id: binding.assetId,
      workspaceId,
      projectId,
      kind: "IMAGE" as const,
      origin: "USER_UPLOAD" as const,
      status: binding.status,
      objectKey: `${workspaceId}/${projectId}/${binding.assetId}/fixture.png`,
      sha256: binding.sha256,
      mimeType: "image/png",
      byteSize: 128,
      metadata: {},
    })));
    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`, idempotencyKey: "create-brief", requestHash: fingerprintRequest({ sourceText }),
      workspaceId, projectId, creativeBriefRevisionId: briefId, sourceText, targetDurationSeconds: 30,
      targetResolution: "480p", stylePreferences: "Unapproved reference fixture only",
      sourceAssetIds: bindings.map((binding) => binding.assetId),
      sourceAssetRoles: bindings.map((binding) => ({ assetId: binding.assetId, role: binding.role, usage: binding.usage })),
      event: event(),
    })).kind, "NEW");
    assert.equal((await planning.requestCreativePlan({
      scope: `${scope}:plan`, idempotencyKey: "request-plan", requestHash: fingerprintRequest({}),
      workspaceId, creativeBriefRevisionId: briefId, event: event(),
    })).kind, "NEW");
    const [deapprovedSceneAsset] = await database.db.update(assets).set({ status: "PENDING_UPLOAD" }).where(and(
      eq(assets.workspaceId, workspaceId),
      eq(assets.projectId, projectId),
      eq(assets.id, bindings[0]!.assetId),
      eq(assets.status, "READY"),
    )).returning({ id: assets.id });
    assert.equal(deapprovedSceneAsset?.id, bindings[0]!.assetId, "the brief is frozen while every source image is approved, then its scene image is revoked before planning");

    const draft = g02Draft({
      briefRevisionId: briefId,
      sourceText,
      suffix: "unapproved-reference",
      assetBindings: bindings.map(({ assetId, sha256, usage, evidenceId }) => ({ assetId, sha256, usage, evidenceId })),
    });
    assert.ok(draft.promptPackages.every((promptPackage) => promptPackage.semanticEntityCandidates?.every((candidate) => candidate.reference_asset_ids.length === 1)));
    const outboxBefore = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.workspaceId, workspaceId));
    const wrongSceneKindDraft = structuredClone(draft);
    for (const promptPackage of wrongSceneKindDraft.promptPackages ?? []) {
      if (promptPackage.semanticEntityCandidateBindings) {
        promptPackage.semanticEntityCandidateBindings.scene = "entity-jar";
        promptPackage.semanticEntityCandidateBindings.props = [];
      }
    }
    await assert.rejects(() => planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: briefId,
      draft: wrongSceneKindDraft,
      semanticVisualEntitySemantics: g02Semantics,
      event: event(),
    }), /scene binding must resolve to a SCENE candidate/u);
    assert.equal((await database.db.select().from(canonicalVisualEntities).where(and(eq(canonicalVisualEntities.workspaceId, workspaceId), eq(canonicalVisualEntities.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(canonicalVisualEntityRevisions).where(and(eq(canonicalVisualEntityRevisions.workspaceId, workspaceId), eq(canonicalVisualEntityRevisions.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(canonicalVisualEntityRevisionAssets).where(and(eq(canonicalVisualEntityRevisionAssets.workspaceId, workspaceId), eq(canonicalVisualEntityRevisionAssets.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(scriptRevisions).where(and(eq(scriptRevisions.workspaceId, workspaceId), eq(scriptRevisions.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(storyboardRevisions).where(and(eq(storyboardRevisions.workspaceId, workspaceId), eq(storyboardRevisions.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(storyboardShotSpecs).where(and(eq(storyboardShotSpecs.workspaceId, workspaceId), eq(storyboardShotSpecs.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(promptPackages).where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.projectId, projectId)))).length, 0);
    const outboxAfterWrongKind = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.workspaceId, workspaceId));
    assert.deepEqual(outboxAfterWrongKind.map(({ id }) => id).sort(), outboxBefore.map(({ id }) => id).sort());
    const [briefAfterWrongKind] = await database.db.select({ status: creativeBriefRevisions.status }).from(creativeBriefRevisions).where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, briefId)));
    assert.equal(briefAfterWrongKind?.status, "PLANNING");

    await assert.rejects(() => planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: briefId,
      draft,
      semanticVisualEntitySemantics: g02Semantics,
      event: event(),
    }), /G02 visual entity mapping asset is missing or has no verified SHA-256/u);

    assert.equal((await database.db.select().from(canonicalVisualEntities).where(and(eq(canonicalVisualEntities.workspaceId, workspaceId), eq(canonicalVisualEntities.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(canonicalVisualEntityRevisions).where(and(eq(canonicalVisualEntityRevisions.workspaceId, workspaceId), eq(canonicalVisualEntityRevisions.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(canonicalVisualEntityRevisionAssets).where(and(eq(canonicalVisualEntityRevisionAssets.workspaceId, workspaceId), eq(canonicalVisualEntityRevisionAssets.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(scriptRevisions).where(and(eq(scriptRevisions.workspaceId, workspaceId), eq(scriptRevisions.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(storyboardRevisions).where(and(eq(storyboardRevisions.workspaceId, workspaceId), eq(storyboardRevisions.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(storyboardShotSpecs).where(and(eq(storyboardShotSpecs.workspaceId, workspaceId), eq(storyboardShotSpecs.projectId, projectId)))).length, 0);
    assert.equal((await database.db.select().from(promptPackages).where(and(eq(promptPackages.workspaceId, workspaceId), eq(promptPackages.projectId, projectId)))).length, 0);
    const outboxAfter = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.workspaceId, workspaceId));
    assert.deepEqual(outboxAfter.map(({ id }) => id).sort(), outboxBefore.map(({ id }) => id).sort());
    const [briefAfter] = await database.db.select({ status: creativeBriefRevisions.status }).from(creativeBriefRevisions).where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, briefId)));
    assert.equal(briefAfter?.status, "PLANNING");
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM event_consumptions WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM canonical_visual_entity_revision_assets WHERE workspace_id = $1 AND project_id = $2", [workspaceId, projectId]);
      await client.query("DELETE FROM outbox_events WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("G02 PostgreSQL serializes identity claims and revisions, reuses hashes, and rolls back unrelated unique conflicts", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `g02-persistence-race-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "G02 identity concurrency" }, workspace: { id: workspaceId, name: "G02 identity concurrency" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`, idempotencyKey: "create-project", requestHash: fingerprintRequest({ name: "G02 identity concurrency" }),
      workspaceId, projectId, name: "G02 identity concurrency",
    })).kind, "NEW");

    const createPlanningBrief = async (suffixName: string) => {
      const briefRevisionId = createPrefixedId("cbr");
      const sourceText = g02Source(`并发${suffixName}`);
      const assetBindings = [
        { entity: "研发灌装空间", role: "SCENE" as const },
        { entity: "林女士", role: "SUBJECT" as const },
        { entity: "面霜罐", role: "SUBJECT" as const },
      ].map((binding) => ({
        ...binding,
        assetId: createPrefixedId("ast"),
        sha256: createHash("sha256").update(`${scope}:${suffixName}:${binding.entity}`, "utf8").digest("hex"),
        evidenceId: createPrefixedId("evd"),
        usage: `${binding.entity}单体参考图，用于该实体身份和段内引用。`,
      }));
      await database.db.insert(assets).values(assetBindings.map((binding) => ({
        id: binding.assetId,
        workspaceId,
        projectId,
        kind: "IMAGE" as const,
        origin: "USER_UPLOAD" as const,
        status: "READY" as const,
        objectKey: `${workspaceId}/${projectId}/${binding.assetId}/fixture.png`,
        sha256: binding.sha256,
        mimeType: "image/png",
        byteSize: 128,
        metadata: {},
      })));
      assert.equal((await planning.createCreativeBriefRevision({
        scope: `${scope}:${suffixName}:brief`, idempotencyKey: "create-brief", requestHash: fingerprintRequest({ suffixName }),
        workspaceId, projectId, creativeBriefRevisionId: briefRevisionId, sourceText, targetDurationSeconds: 30,
        targetResolution: "480p", stylePreferences: "Concurrency fixture", sourceAssetIds: assetBindings.map((binding) => binding.assetId),
        sourceAssetRoles: assetBindings.map((binding) => ({ assetId: binding.assetId, role: binding.role, usage: binding.usage })), event: event(),
      })).kind, "NEW");
      assert.equal((await planning.requestCreativePlan({
        scope: `${scope}:${suffixName}:plan`, idempotencyKey: "request-plan", requestHash: fingerprintRequest({ suffixName }),
        workspaceId, creativeBriefRevisionId: briefRevisionId, event: event(),
      })).kind, "NEW");
      return { briefRevisionId, sourceText, assetBindings: assetBindings.map(({ assetId, sha256, usage, evidenceId }) => ({ assetId, sha256, usage, evidenceId })) };
    };
    const semantics = g02Semantics;
    const first = await createPlanningBrief("first");
    const second = await createPlanningBrief("second");
    const [firstResult, secondResult] = await Promise.all([
      planning.completeCreativePlan({ workspaceId, creativeBriefRevisionId: first.briefRevisionId, draft: g02Draft({ ...first, suffix: "race-first", revisionFlavor: "并发版本甲" }), semanticVisualEntitySemantics: semantics, event: event() }),
      planning.completeCreativePlan({ workspaceId, creativeBriefRevisionId: second.briefRevisionId, draft: g02Draft({ ...second, suffix: "race-second", revisionFlavor: "并发版本乙" }), semanticVisualEntitySemantics: semantics, event: event() }),
    ]);
    assert.ok(firstResult && secondResult);

    const entityRows = await database.db.select().from(canonicalVisualEntities).where(and(eq(canonicalVisualEntities.workspaceId, workspaceId), eq(canonicalVisualEntities.projectId, projectId)));
    const revisionRows = await database.db.select().from(canonicalVisualEntityRevisions).where(and(eq(canonicalVisualEntityRevisions.workspaceId, workspaceId), eq(canonicalVisualEntityRevisions.projectId, projectId)));
    assert.equal(entityRows.length, 3, "same identity claims must resolve to one logical entity ID per kind");
    assert.deepEqual(entityRows.map((row) => row.entityKind).sort(), ["CHARACTER", "PROP", "SCENE"]);
    for (const entity of entityRows) {
      const revisions = revisionRows.filter((row) => row.entityId === entity.id).sort((left, right) => left.revisionNumber - right.revisionNumber);
      assert.deepEqual(revisions.map((row) => row.revisionNumber), [1, 2], `${entity.entityKind} receives one unique monotonic revision for each concurrent distinct content`);
      assert.equal(new Set(revisions.map((row) => row.contentHash)).size, 2, `${entity.entityKind} retains both distinct content hashes`);
      const expectedValues = entity.entityKind === "CHARACTER"
        ? ["人物描述并发版本甲", "人物描述并发版本乙"]
        : entity.entityKind === "SCENE"
          ? ["单一研发场景并发版本甲", "单一研发场景并发版本乙"]
          : ["白色面霜罐并发版本甲", "白色面霜罐并发版本乙"];
      const persistedValues = revisions.map((row) => entity.entityKind === "CHARACTER" ? row.description : entity.entityKind === "SCENE" ? row.prompt : row.description);
      assert.deepEqual(new Set(persistedValues), new Set(expectedValues), `${entity.entityKind} preserves both candidate contents instead of overwriting either`);
    }

    const sameContent = await createPlanningBrief("same-content");
    const revisionCountBeforeReuse = revisionRows.length;
    const reusedStoryboard = await planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: sameContent.briefRevisionId,
      draft: g02Draft({ ...sameContent, suffix: "same-content", revisionFlavor: "并发版本甲" }),
      semanticVisualEntitySemantics: semantics,
      event: event(),
    });
    assert.ok(reusedStoryboard);
    const reusedPackage = await database.db.select().from(promptPackages).where(and(
      eq(promptPackages.workspaceId, workspaceId),
      eq(promptPackages.shotSpecId, reusedStoryboard.shotSpecs[0]!.id),
    ));
    const reusedProjection = reusedPackage[0]?.referenceMap as { semantic_entity_reference_projection?: { bindings?: Array<{ entity_kind: string; entity_id: string; entity_revision_id: string; asset_id: string; provider_position: number }> } };
    const reusedBindings = reusedProjection.semantic_entity_reference_projection?.bindings ?? [];
    assert.equal(reusedBindings.length, 3);
    const revisionForFlavor = (kind: "CHARACTER" | "SCENE" | "PROP") => {
      const entityId = storyboardEntityId(entityRows, kind);
      const revision = revisionRows.find((row) => row.entityId === entityId && (
        kind === "CHARACTER" ? row.description === "人物描述并发版本甲"
          : kind === "SCENE" ? row.prompt === "单一研发场景并发版本甲"
            : row.description === "白色面霜罐并发版本甲"
      ));
      assert.ok(revision, `expected the persisted ${kind} revision for identical content`);
      return { entityId, revisionId: revision.id };
    };
    const sameContentScene = revisionForFlavor("SCENE");
    const sameContentCharacter = revisionForFlavor("CHARACTER");
    const sameContentProp = revisionForFlavor("PROP");
    assert.deepEqual(reusedBindings.map(({ entity_kind, entity_id, entity_revision_id, asset_id, provider_position }) => ({ entity_kind, entity_id, entity_revision_id, asset_id, provider_position })), [
      { entity_kind: "SCENE", entity_id: sameContentScene.entityId, entity_revision_id: sameContentScene.revisionId, asset_id: sameContent.assetBindings[0]!.assetId, provider_position: 0 },
      { entity_kind: "CHARACTER", entity_id: sameContentCharacter.entityId, entity_revision_id: sameContentCharacter.revisionId, asset_id: sameContent.assetBindings[1]!.assetId, provider_position: 1 },
      { entity_kind: "PROP", entity_id: sameContentProp.entityId, entity_revision_id: sameContentProp.revisionId, asset_id: sameContent.assetBindings[2]!.assetId, provider_position: 2 },
    ]);
    const currentEntityRevisions = await database.db.select().from(canonicalVisualEntityRevisions).where(and(eq(canonicalVisualEntityRevisions.workspaceId, workspaceId), eq(canonicalVisualEntityRevisions.projectId, projectId)));
    assert.equal(currentEntityRevisions.length, revisionCountBeforeReuse, "identical historical hashes are reused without adding duplicate revisions");
    const reusedShot = reusedStoryboard.shotSpecs[0]!;
    assert.equal(reusedShot.sceneId, storyboardEntityId(entityRows, "SCENE"));
    assert.deepEqual(reusedShot.characterIds, [storyboardEntityId(entityRows, "CHARACTER")]);
    assert.deepEqual(reusedShot.propIds, [storyboardEntityId(entityRows, "PROP")]);

    const rollback = await createPlanningBrief("rollback");
    const rollbackDraft = g02Draft({ ...rollback, suffix: "rollback", revisionFlavor: "事务必须回滚" });
    const rollbackEvent = event();
    await database.db.insert(outboxEvents).values({
      id: rollbackEvent.eventId,
      workspaceId,
      projectId,
      aggregateType: "fixture",
      aggregateId: rollback.briefRevisionId,
      eventType: "fixture.unique_conflict",
      payload: {},
      occurredAt: new Date().toISOString(),
    });
    const revisionCountBefore = currentEntityRevisions.length;
    const entityCountBefore = entityRows.length;
    const mappingCountBefore = (await database.db.select().from(canonicalVisualEntityRevisionAssets).where(and(eq(canonicalVisualEntityRevisionAssets.workspaceId, workspaceId), eq(canonicalVisualEntityRevisionAssets.projectId, projectId)))).length;
    const scriptCountBefore = (await database.db.select().from(scriptRevisions).where(and(eq(scriptRevisions.workspaceId, workspaceId), eq(scriptRevisions.projectId, projectId)))).length;
    const packageCountBefore = (await database.db.select({ id: promptPackages.id }).from(promptPackages).where(eq(promptPackages.workspaceId, workspaceId))).length;
    await assert.rejects(() => planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: rollback.briefRevisionId,
      draft: rollbackDraft,
      semanticVisualEntitySemantics: semantics,
      event: rollbackEvent,
    }));
    assert.equal((await database.db.select().from(canonicalVisualEntityRevisions).where(and(eq(canonicalVisualEntityRevisions.workspaceId, workspaceId), eq(canonicalVisualEntityRevisions.projectId, projectId)))).length, revisionCountBefore);
    assert.equal((await database.db.select().from(canonicalVisualEntities).where(and(eq(canonicalVisualEntities.workspaceId, workspaceId), eq(canonicalVisualEntities.projectId, projectId)))).length, entityCountBefore);
    assert.equal((await database.db.select().from(canonicalVisualEntityRevisionAssets).where(and(eq(canonicalVisualEntityRevisionAssets.workspaceId, workspaceId), eq(canonicalVisualEntityRevisionAssets.projectId, projectId)))).length, mappingCountBefore);
    assert.equal((await database.db.select().from(scriptRevisions).where(and(eq(scriptRevisions.workspaceId, workspaceId), eq(scriptRevisions.projectId, projectId)))).length, scriptCountBefore);
    assert.equal((await database.db.select({ id: promptPackages.id }).from(promptPackages).where(eq(promptPackages.workspaceId, workspaceId))).length, packageCountBefore);
    assert.equal((await database.db.select().from(storyboardRevisions).where(and(eq(storyboardRevisions.workspaceId, workspaceId), eq(storyboardRevisions.id, rollbackDraft.storyboardRevisionId)))).length, 0);
    assert.equal((await database.db.select().from(storyboardShotSpecs).where(and(eq(storyboardShotSpecs.workspaceId, workspaceId), eq(storyboardShotSpecs.projectId, projectId), eq(storyboardShotSpecs.id, rollbackDraft.shotSpecs[0]!.id)))).length, 0);
    assert.equal((await database.db.select().from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "storyboard_revision.ready_for_review"), eq(outboxEvents.aggregateId, rollbackDraft.storyboardRevisionId)))).length, 0);
    assert.equal((await database.db.select().from(creativeBriefRevisions).where(and(eq(creativeBriefRevisions.workspaceId, workspaceId), eq(creativeBriefRevisions.id, rollback.briefRevisionId))).then((rows) => rows[0]?.status)), "PLANNING");
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM event_consumptions WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM canonical_visual_entity_revision_assets WHERE workspace_id = $1 AND project_id = $2", [workspaceId, projectId]);
      await client.query("DELETE FROM outbox_events WHERE workspace_id = $1", [workspaceId]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("PostgreSQL freezes manual BGM replacement asset identity and rejects a short source before run creation", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `music-replacement-freeze-pg-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const storyboardRevisionId = createPrefixedId("sbr");
  const tooShortAssetId = createPrefixedId("ast");
  const wrongRoleAssetId = createPrefixedId("ast");
  const missingHashAssetId = createPrefixedId("ast");
  const wrongProjectAssetId = createPrefixedId("ast");
  const wrongWorkspaceAssetId = createPrefixedId("ast");
  const otherUserId = createPrefixedId("usr");
  const otherWorkspaceId = createPrefixedId("ws");
  const otherWorkspaceProjectId = createPrefixedId("prj");
  const musicAssetId = createPrefixedId("ast");
  const productionRunId = createPrefixedId("prd");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "Music replacement integration" }, workspace: { id: workspaceId, name: "Music replacement integration" } });
    await control.ensureDevIdentity({ user: { id: otherUserId, displayName: "Wrong-workspace music integration" }, workspace: { id: otherWorkspaceId, name: "Wrong-workspace music integration" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`, idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "Music replacement integration" }),
      workspaceId, projectId, name: "Music replacement integration",
    })).kind, "NEW");
    assert.equal((await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`, idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ target_duration_seconds: 10 }),
      workspaceId, projectId, creativeBriefRevisionId: briefId,
      sourceText: "展示护肤产品并以包装特写收尾。", targetDurationSeconds: 10,
      targetResolution: "480p", stylePreferences: "珍珠白银色调。", sourceAssetIds: [], event: event(),
    })).kind, "NEW");
    assert.equal((await planning.requestCreativePlan({
      scope: `${scope}:plan`, idempotencyKey: "request-plan", requestHash: fingerprintRequest({}),
      workspaceId, creativeBriefRevisionId: briefId, event: event(),
    })).kind, "NEW");
    const shotSpecId = createPrefixedId("ssp");
    assert.ok(await planning.completeCreativePlan({
      workspaceId, creativeBriefRevisionId: briefId,
      draft: {
        scriptRevisionId: createPrefixedId("scr"), storyboardRevisionId,
        beats: [{ sequence: 1, title: "产品镜头", summary: "展示产品。", narrative_goal: "展示产品。", visible_facts: ["护肤产品"], generation_segment_sequence: 1 }],
        title: "产品片", summary: "单镜头。", totalDurationSeconds: 10,
        continuityLevel: "STANDARD", continuityNote: "单镜头。",
        shotSpecs: [{ id: shotSpecId, sequence: 1, title: "产品展示", durationSeconds: 10, narrativeGoal: "展示产品。", startState: "开始", endState: "结束", transitionSummary: "单镜头", referencePolicy: "TEXT_TRANSITION", dependsOnSequences: [], continuityNote: "单镜头", narrativeBeatSequences: [1] }],
        narrativeBeatCount: 1, generationSegmentCount: 1,
        promptPackages: [{ id: createPrefixedId("ppk"), shotSpecId, compilerVersion: "music-replacement-freeze", prompt: "展示护肤产品。", visualConstraints: {}, referenceMap: {}, capabilitySnapshot: {} }],
      },
      event: event(),
    }));
    assert.equal((await planning.approveStoryboardRevision({
      scope: `${scope}:approve`, idempotencyKey: "approve-storyboard",
      requestHash: fingerprintRequest({ storyboard_revision_id: storyboardRevisionId }),
      workspaceId, storyboardRevisionId, event: event(),
    })).kind, "NEW");

    const insertMusic = async (
      assetId: string,
      durationMs: number,
      options: { targetProjectId?: string; role?: string; sha256?: string | null } = {},
    ) => {
      const targetProjectId = options.targetProjectId ?? projectId;
      return database.db.insert(assets).values({
        id: assetId, workspaceId, projectId: targetProjectId, kind: "AUDIO", origin: "GENERATED", status: "READY",
        objectKey: `${workspaceId}/${targetProjectId}/${assetId}/music.wav`, sha256: options.sha256 === undefined ? "c".repeat(64) : options.sha256,
        mimeType: "audio/wav", byteSize: 48_000, durationMs, metadata: { audio_role: options.role ?? "MUSIC" },
      });
    };
    await insertMusic(tooShortAssetId, 9_999);
    await insertMusic(wrongRoleAssetId, 10_000, { role: "SFX" });
    await insertMusic(missingHashAssetId, 10_000, { sha256: null });
    const otherProjectId = createPrefixedId("prj");
    assert.equal((await control.createProject({
      scope: `${scope}:other-project`, idempotencyKey: "create-other-project",
      requestHash: fingerprintRequest({ name: "Wrong-scope music asset" }),
      workspaceId, projectId: otherProjectId, name: "Wrong-scope music asset",
    })).kind, "NEW");
    assert.equal((await control.createProject({
      scope: `${scope}:other-workspace-project`, idempotencyKey: "create-other-workspace-project",
      requestHash: fingerprintRequest({ name: "Wrong-workspace music asset" }),
      workspaceId: otherWorkspaceId, projectId: otherWorkspaceProjectId, name: "Wrong-workspace music asset",
    })).kind, "NEW");
    await insertMusic(wrongProjectAssetId, 10_000, { targetProjectId: otherProjectId });
    await database.db.insert(assets).values({
      id: wrongWorkspaceAssetId, workspaceId: otherWorkspaceId, projectId: otherWorkspaceProjectId,
      kind: "AUDIO", origin: "GENERATED", status: "READY",
      objectKey: `${otherWorkspaceId}/${otherWorkspaceProjectId}/${wrongWorkspaceAssetId}/music.wav`,
      sha256: "c".repeat(64), mimeType: "audio/wav", byteSize: 48_000, durationMs: 10_000,
      metadata: { audio_role: "MUSIC" },
    });
    const assertBlockedWithoutRunOrOutbox = async (assetId: string, key: string) => {
      const blocked = await planning.createProductionRun({
        scope: `${scope}:blocked:${key}`, idempotencyKey: key,
        requestHash: fingerprintRequest({ audio_selection: "MUSIC_REPLACE_PROVIDER_AUDIO", asset_id: assetId }),
        workspaceId, projectId, productionRunId: createPrefixedId("prd"), storyboardRevisionId,
        audioSelection: "MUSIC_REPLACE_PROVIDER_AUDIO", musicPlan: { mode: "MANUAL", asset_id: assetId, style_hint: "" }, event: event(),
      });
      assert.deepEqual(blocked, { kind: "PREFLIGHT_BLOCKED" }, `asset ${assetId} must fail closed`);
    };
    await assertBlockedWithoutRunOrOutbox(tooShortAssetId, "short-music");
    await assertBlockedWithoutRunOrOutbox(wrongRoleAssetId, "wrong-role-music");
    await assertBlockedWithoutRunOrOutbox(missingHashAssetId, "missing-hash-music");
    await assertBlockedWithoutRunOrOutbox(wrongProjectAssetId, "wrong-project-music");
    await assertBlockedWithoutRunOrOutbox(wrongWorkspaceAssetId, "wrong-workspace-music");
    await assertBlockedWithoutRunOrOutbox(createPrefixedId("ast"), "missing-music");
    assert.equal((await database.db.select({ id: productionRuns.id }).from(productionRuns).where(eq(productionRuns.workspaceId, workspaceId))).length, 0);
    assert.equal((await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "production_run.confirmed")))).length, 0);

    await insertMusic(musicAssetId, 10_000);
    const input = {
      scope: `${scope}:valid`, idempotencyKey: "valid-music",
      requestHash: fingerprintRequest({ audio_selection: "MUSIC_REPLACE_PROVIDER_AUDIO", asset_id: musicAssetId }),
      workspaceId, projectId, productionRunId, storyboardRevisionId,
      audioSelection: "MUSIC_REPLACE_PROVIDER_AUDIO" as const,
      musicPlan: { mode: "MANUAL" as const, asset_id: musicAssetId, style_hint: "" }, event: event(),
    };
    assert.equal((await planning.createProductionRun(input)).kind, "NEW");
    const [run] = await database.db.select().from(productionRuns).where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.id, productionRunId))).limit(1);
    assert.ok(run);
    const guard = run.budgetGuard as Record<string, unknown>;
    assert.equal(guard.audio_selection, "MUSIC_REPLACE_PROVIDER_AUDIO");
    assert.deepEqual(guard.music_replacement_source, {
      version: 1, assetId: musicAssetId, workspaceId, projectId,
      sha256: "c".repeat(64), byteSize: 48_000, mimeType: "audio/wav", durationMs: 10_000,
    });
    assert.equal((await planning.createProductionRun({ ...input, event: event() })).kind, "REPLAY");
    assert.deepEqual(await planning.createProductionRun({
      ...input,
      requestHash: fingerprintRequest({ audio_selection: "MUSIC_REPLACE_PROVIDER_AUDIO", asset_id: wrongRoleAssetId }),
      musicPlan: { mode: "MANUAL", asset_id: wrongRoleAssetId, style_hint: "" },
      event: event(),
    }), { kind: "CONFLICT" }, "same idempotency key cannot select a different asset");
    assert.deepEqual(await planning.createProductionRun({
      ...input,
      requestHash: fingerprintRequest({ audio_selection: "PRESERVE_PROVIDER_AUDIO", music_plan: { mode: "OFF", style_hint: "" } }),
      audioSelection: "PRESERVE_PROVIDER_AUDIO",
      musicPlan: { mode: "OFF", style_hint: "" },
      event: event(),
    }), { kind: "CONFLICT" }, "same idempotency key cannot change audio selection");
    assert.equal((await database.db.select({ id: productionRuns.id }).from(productionRuns).where(eq(productionRuns.workspaceId, workspaceId))).length, 1);
    assert.equal((await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(eq(outboxEvents.workspaceId, workspaceId), eq(outboxEvents.eventType, "production_run.confirmed")))).length, 1);
  } finally {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [otherWorkspaceId]);
      await client.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    } finally {
      await client.end();
      await database.close();
    }
  }
});

test("PostgreSQL freezes approved Doubao narration identity in the ProductionRun transaction", { skip: !process.env.DATABASE_URL }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scope = `doubao-freeze-pg-${suffix}`;
  const userId = createPrefixedId("usr");
  const workspaceId = createPrefixedId("ws");
  const projectId = createPrefixedId("prj");
  const briefId = createPrefixedId("cbr");
  const storyboardRevisionId = createPrefixedId("sbr");
  const deliveryPlanRevisionId = createPrefixedId("dpr");
  const narrationAssetId = createPrefixedId("ast");
  const narrationAssetVersionId = createPrefixedId("nav");
  const sampleAssetId = createPrefixedId("ast");
  const productionRunId = createPrefixedId("prd");
  const database = createDatabase(databaseUrl);

  try {
    const control = new DrizzleControlPlaneRepository(database.db);
    const planning = new DrizzleCreativePlanningRepository(database.db);
    const delivery = new DrizzleDeliveryPreflightStore(database.db);
    const narration = new DrizzleNarrationQualityStore(database.db);
    await control.ensureDevIdentity({ user: { id: userId, displayName: "Doubao freeze integration" }, workspace: { id: workspaceId, name: "Doubao freeze integration" } });
    assert.equal((await control.createProject({
      scope: `${scope}:project`,
      idempotencyKey: "create-project",
      requestHash: fingerprintRequest({ name: "Doubao freeze integration" }),
      workspaceId,
      projectId,
      name: "Doubao freeze integration",
    })).kind, "NEW");

    const brief = await planning.createCreativeBriefRevision({
      scope: `${scope}:brief`,
      idempotencyKey: "create-brief",
      requestHash: fingerprintRequest({ target_duration_seconds: 10 }),
      workspaceId,
      projectId,
      creativeBriefRevisionId: briefId,
      sourceText: "展示产品并清楚说明核心卖点。",
      targetDurationSeconds: 10,
      targetResolution: "480p",
      stylePreferences: "简洁、真实。",
      sourceAssetIds: [],
      event: event(),
    });
    assert.equal(brief.kind, "NEW");
    const planningRequest = await planning.requestCreativePlan({
      scope: `${scope}:planning`,
      idempotencyKey: "request-plan",
      requestHash: fingerprintRequest({}),
      workspaceId,
      creativeBriefRevisionId: briefId,
      event: event(),
    });
    assert.equal(planningRequest.kind, "NEW");
    const shotSpecId = createPrefixedId("ssp");
    const complete = await planning.completeCreativePlan({
      workspaceId,
      creativeBriefRevisionId: briefId,
      draft: {
        scriptRevisionId: createPrefixedId("scr"),
        storyboardRevisionId,
        beats: [{ sequence: 1, title: "产品展示", summary: "展示产品并说明卖点。", narrative_goal: "清楚介绍产品。", visible_facts: ["产品"], generation_segment_sequence: 1 }],
        title: "产品介绍",
        summary: "单镜头产品介绍。",
        totalDurationSeconds: 10,
        continuityLevel: "STANDARD",
        continuityNote: "单镜头连续呈现。",
        shotSpecs: [{
          id: shotSpecId,
          sequence: 1,
          title: "产品与旁白",
          durationSeconds: 10,
          narrativeGoal: "介绍产品卖点。",
          startState: "产品入镜",
          endState: "产品定格",
          transitionSummary: "保持单镜头。",
          referencePolicy: "TEXT_TRANSITION",
          dependsOnSequences: [],
          continuityNote: "无需跨镜头衔接。",
          narrativeBeatSequences: [1],
        }],
        narrativeBeatCount: 1,
        generationSegmentCount: 1,
        promptPackages: [{
          id: createPrefixedId("ppk"),
          shotSpecId,
          compilerVersion: "doubao-freeze-integration",
          prompt: "展示产品并说明卖点。",
          visualConstraints: {},
          referenceMap: {},
          capabilitySnapshot: { audio_owner: "NATIVE_PROVIDER" },
        }],
      },
      event: event(),
    });
    assert.ok(complete);
    const approvedStoryboard = await planning.approveStoryboardRevision({
      scope: `${scope}:storyboard-approval`,
      idempotencyKey: "approve-storyboard",
      requestHash: fingerprintRequest({ storyboard_revision_id: storyboardRevisionId }),
      workspaceId,
      storyboardRevisionId,
      event: event(),
    });
    assert.equal(approvedStoryboard.kind, "NEW");

    const createdDelivery = await delivery.createDeliveryPlanRevision({
      scope: `${scope}:delivery`,
      idempotencyKey: "create-delivery",
      requestHash: fingerprintRequest({ storyboard_revision_id: storyboardRevisionId, target_duration_seconds: 10 }),
      workspaceId,
      projectId,
      deliveryPlanRevisionId,
      creativeBriefRevisionId: briefId,
      storyboardRevisionId,
      targetDurationSeconds: 10,
      durationPolicy: "EXACT",
      flexibleDurationPercent: 0,
      captionPolicy: "OFF",
      lipSyncRequirement: "OFF",
      voiceMode: "PLATFORM_GENERIC",
      event: event(),
    });
    assert.equal(createdDelivery.kind, "NEW");
    const approvedDelivery = await delivery.approveDeliveryPlanRevision({
      scope: `${scope}:delivery-approval`,
      idempotencyKey: "approve-delivery",
      requestHash: fingerprintRequest({ delivery_plan_revision_id: deliveryPlanRevisionId }),
      workspaceId,
      deliveryPlanRevisionId,
      event: event(),
    });
    assert.equal(approvedDelivery.kind, "NEW");

    const script = await narration.createNarrationScriptRevision({
      scope: `${scope}:narration-script`,
      idempotencyKey: "create-script",
      requestHash: fingerprintRequest({ text: "这是一段经过批准的产品旁白。" }),
      workspaceId,
      deliveryPlanRevisionId,
      command: { display_sections: [{ id: "main", text: "这是一段经过批准的产品旁白。" }], pronunciation_glossary: [], normalization_version: "integration-v1" },
      event: event(),
    });
    assert.equal(script.kind, "NEW");
    if (script.kind !== "NEW") return;
    const sampleHash = "a".repeat(64);
    const voiceId = "doubao-test-voice";
    const providerSettings = { format: "mp3" };
    const sampleObjectKey = `${workspaceId}/${projectId}/${sampleAssetId}/approved-sample.mp3`;
    await database.db.insert(assets).values({
      id: sampleAssetId,
      workspaceId,
      projectId,
      kind: "AUDIO",
      origin: "GENERATED",
      status: "READY",
      objectKey: sampleObjectKey,
      sha256: sampleHash,
      mimeType: "audio/mpeg",
      byteSize: 2_048,
      durationMs: 2_000,
      metadata: { narration_generation: {
        event_id: createPrefixedId("evt"),
        narration_script_revision_id: script.value.id,
        generation_kind: "SAMPLE",
        section_id: "main",
        provider: "doubao",
        voice_id: voiceId,
        provider_settings: providerSettings,
        canonical_script_hash: script.value.source_script_hash,
      } },
    });
    const approvedScript = await narration.approveNarrationScriptRevision({
      scope: `${scope}:narration-approval`,
      idempotencyKey: "approve-script",
      requestHash: fingerprintRequest({ sample_asset_id: sampleAssetId, canonical_script_hash: script.value.source_script_hash }),
      workspaceId,
      narrationScriptRevisionId: script.value.id,
      command: {
        sample_asset_id: sampleAssetId,
        sample_provider: "doubao",
        sample_voice_id: voiceId,
        sample_provider_settings: providerSettings,
        sample_duration_ms: 2_000,
        canonical_script_hash: script.value.source_script_hash,
        word_timestamps_asset_id: null,
      },
      event: event(),
    });
    assert.equal(approvedScript.kind, "NEW");

    const formalGeneration = await narration.requestNarrationAudioGeneration({
      scope: `${scope}:formal-audio`,
      idempotencyKey: "request-formal",
      requestHash: fingerprintRequest({ generation_kind: "FORMAL", asset_id: narrationAssetId }),
      workspaceId,
      narrationScriptRevisionId: script.value.id,
      assetId: narrationAssetId,
      narrationAssetVersionId,
      objectKey: `${workspaceId}/${projectId}/${narrationAssetId}/formal.wav`,
      command: {
        generation_kind: "FORMAL",
        section_id: "main",
        provider: "doubao",
        voice_id: voiceId,
        provider_settings: providerSettings,
        canonical_script_hash: script.value.source_script_hash,
        sample_asset_id: sampleAssetId,
      },
      event: event(),
    });
    assert.equal(formalGeneration.kind, "NEW");
    if (formalGeneration.kind !== "NEW") return;
    const [generationRow] = await database.db.select({ payload: outboxEvents.payload }).from(outboxEvents)
      .where(eq(outboxEvents.id, formalGeneration.value.event_id)).limit(1);
    const generationEvent = generationRow ? InternalEventEnvelopeSchema.parse(generationRow.payload) : undefined;
    assert.ok(generationEvent?.event_type === "narration_audio.generation_requested");
    if (!generationEvent || generationEvent.event_type !== "narration_audio.generation_requested") return;
    const typedGenerationEvent = generationEvent as NarrationAudioGenerationEvent;
    assert.ok(await narration.findNarrationAudioGenerationInput({ event: typedGenerationEvent }));
    assert.ok(await narration.ensureGeneratedNarrationAsset({ event: typedGenerationEvent }));
    const formalVersion = await narration.completeNarrationAudioGeneration({
      event: typedGenerationEvent,
      facts: { mimeType: "audio/wav", sha256: "b".repeat(64), byteSize: 48_000, durationMs: 10_000 },
    });
    assert.equal(formalVersion?.id, narrationAssetVersionId);

    const timeline = await narration.createTimelinePlan({
      scope: `${scope}:timeline`,
      idempotencyKey: "create-timeline",
      requestHash: fingerprintRequest({ narration_asset_version_id: narrationAssetVersionId, target_duration_ms: 10_000 }),
      workspaceId,
      narrationScriptRevisionId: script.value.id,
      command: {
        section_durations_ms: [{ section_id: "main", duration_ms: 10_000 }],
        target_duration_ms: 10_000,
        flexible_percent: 0,
        max_provider_duration_seconds: 10,
        narration_asset_version_id: narrationAssetVersionId,
      },
      event: event(),
    });
    assert.equal(timeline.kind, "NEW");
    if (timeline.kind !== "NEW") return;
    assert.equal(timeline.value.status, "READY");

    const createRunInput = {
      scope: `${scope}:production-run`,
      idempotencyKey: "create-doubao-run",
      requestHash: fingerprintRequest({
        storyboard_revision_id: storyboardRevisionId,
        delivery_plan_revision_id: deliveryPlanRevisionId,
        audio_selection: "DOUBAO_TTS_REPLACE",
      }),
      workspaceId,
      projectId,
      productionRunId,
      storyboardRevisionId,
      deliveryPlanRevisionId,
      audioSelection: "DOUBAO_TTS_REPLACE" as const,
      event: event(),
    };
    const createdRun = await planning.createProductionRun(createRunInput);
    assert.equal(createdRun.kind, "NEW");
    if (createdRun.kind !== "NEW") return;

    const [persistedRun] = await database.db.select().from(productionRuns).where(and(
      eq(productionRuns.workspaceId, workspaceId),
      eq(productionRuns.projectId, projectId),
      eq(productionRuns.id, productionRunId),
    )).limit(1);
    assert.ok(persistedRun);
    const guard = persistedRun.budgetGuard as Record<string, unknown>;
    assert.equal(guard.audio_selection, "DOUBAO_TTS_REPLACE");
    const frozen = guard.audio_selection_source as Record<string, unknown>;
    assert.equal(frozen.workspaceId, workspaceId);
    assert.equal(frozen.projectId, projectId);
    assert.equal(frozen.deliveryPlanRevisionId, deliveryPlanRevisionId);
    assert.equal(frozen.storyboardRevisionId, storyboardRevisionId);
    assert.equal(frozen.timelinePlanId, timeline.value.id);
    assert.equal(frozen.narrationScriptRevisionId, script.value.id);
    assert.equal(frozen.sourceScriptHash, script.value.source_script_hash);
    assert.deepEqual(frozen.assetVersions, [{
      sectionId: "main",
      assetVersionId: narrationAssetVersionId,
      narrationScriptRevisionId: script.value.id,
      sourceScriptHash: script.value.source_script_hash,
      assetId: narrationAssetId,
      sha256: "b".repeat(64),
      byteSize: 48_000,
      mimeType: "audio/wav",
      durationMs: 10_000,
      provider: "doubao",
      voiceId,
      providerSettings,
    }]);
    const [timelineRow] = await database.db.select().from(timelinePlans).where(eq(timelinePlans.id, timeline.value.id)).limit(1);
    const [scriptRow] = await database.db.select().from(narrationScriptRevisions).where(eq(narrationScriptRevisions.id, script.value.id)).limit(1);
    const [assetVersionRow] = await database.db.select().from(narrationAssetVersions).where(eq(narrationAssetVersions.id, narrationAssetVersionId)).limit(1);
    assert.equal(timelineRow?.id, frozen.timelinePlanId);
    assert.equal(scriptRow?.sourceScriptHash, frozen.sourceScriptHash);
    assert.equal(assetVersionRow?.assetId, narrationAssetId);
    const compositionTimeline = await findApprovedNarrationTimeline(database.db, workspaceId, projectId, deliveryPlanRevisionId, String(frozen.timelinePlanId), true);
    assert.equal(compositionTimeline?.timelinePlanId, timeline.value.id, "composition reread is pinned to the frozen timeline ID");
    assert.deepEqual(compositionTimeline?.narrationSections, [{
      sectionId: "main",
      startMs: 0,
      endMs: 10_000,
      visualRole: "PRIMARY",
    }], "the persisted TimelinePlan window and formal asset version must survive the composition read");
    assert.deepEqual(compositionTimeline?.narrationAsset && {
      assetVersionId: compositionTimeline.narrationAsset.assetVersionId,
      id: compositionTimeline.narrationAsset.id,
      durationMs: compositionTimeline.narrationAsset.durationMs,
      sha256: compositionTimeline.narrationAsset.sha256,
    }, {
      assetVersionId: narrationAssetVersionId,
      id: narrationAssetId,
      durationMs: 10_000,
      sha256: "b".repeat(64),
    }, "the persisted formal narration asset must remain the authoritative composition input");

    const confirmedEvents = await database.db.select({ id: outboxEvents.id, aggregateId: outboxEvents.aggregateId }).from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.eventType, "production_run.confirmed"),
      eq(outboxEvents.aggregateId, productionRunId),
    ));
    assert.equal(confirmedEvents.length, 1, "the confirmed event is committed with the run");
    const consumedDelivery = await database.db.select({ status: deliveryPlanRevisions.status, consumedByProductionRunId: deliveryPlanRevisions.consumedByProductionRunId })
      .from(deliveryPlanRevisions).where(eq(deliveryPlanRevisions.id, deliveryPlanRevisionId)).limit(1);
    assert.equal(consumedDelivery[0]?.status, "CONSUMED");
    assert.equal(consumedDelivery[0]?.consumedByProductionRunId, productionRunId);

    const replay = await planning.createProductionRun({ ...createRunInput, event: event() });
    assert.equal(replay.kind, "REPLAY");
    const conflict = await planning.createProductionRun({
      ...createRunInput,
      productionRunId: createPrefixedId("prd"),
      audioSelection: "PRESERVE_PROVIDER_AUDIO",
      requestHash: fingerprintRequest({
        storyboard_revision_id: storyboardRevisionId,
        delivery_plan_revision_id: deliveryPlanRevisionId,
        audio_selection: "PRESERVE_PROVIDER_AUDIO",
      }),
      event: event(),
    });
    assert.deepEqual(conflict, { kind: "CONFLICT" });
    const runsAfterReplay = await database.db.select({ id: productionRuns.id }).from(productionRuns)
      .where(and(eq(productionRuns.workspaceId, workspaceId), eq(productionRuns.projectId, projectId)));
    assert.equal(runsAfterReplay.length, 1);
    const confirmedEventsAfterReplay = await database.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
      eq(outboxEvents.workspaceId, workspaceId),
      eq(outboxEvents.projectId, projectId),
      eq(outboxEvents.eventType, "production_run.confirmed"),
      eq(outboxEvents.aggregateId, productionRunId),
    ));
    assert.equal(confirmedEventsAfterReplay.length, 1);
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
