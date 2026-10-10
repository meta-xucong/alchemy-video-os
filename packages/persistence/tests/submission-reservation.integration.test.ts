import assert from "node:assert/strict";
import test from "node:test";
import { eq, like } from "drizzle-orm";

import { createPrefixedId } from "@alchemy-video/domain";
import { createDatabase } from "../src/db.js";
import { DrizzleControlPlaneRepository } from "../src/control-plane-repository.js";
import { DrizzleAssetWorkspaceRepository } from "../src/asset-workspace-repository.js";
import { DrizzleTaskRunRepository } from "../src/task-run-repository.js";
import { commandDeduplications, providerAttempts, taskRuns, users, workspaces } from "../src/schema.js";

const event = () => ({ eventId: createPrefixedId("evt"), messageId: createPrefixedId("msg"), traceId: createPrefixedId("trc"), correlationId: createPrefixedId("cor") });

test("PostgreSQL submission reservation is exclusive and survives restart, failure, retry, and a late request ID", { skip: !process.env.DATABASE_URL }, async () => {
  const database = createDatabase(process.env.DATABASE_URL!);
  const workspaceId = createPrefixedId("ws");
  const userId = createPrefixedId("usr");
  const projectId = createPrefixedId("prj");
  const shotId = createPrefixedId("sht");
  const taskRunId = createPrefixedId("tsk");
  const scope = `submission-reservation:${taskRunId}`;
  const control = new DrizzleControlPlaneRepository(database.db);
  const assets = new DrizzleAssetWorkspaceRepository(database.db);
  const tasks = new DrizzleTaskRunRepository(database.db);
  const startedEvents = new Set<string>();
  const start = async (repository: DrizzleTaskRunRepository) => {
    const queued = (await repository.listWorkspaceEvents({ workspaceId, limit: 100 }))
      .filter((item) => item.event_type === "task_run.queued" && !startedEvents.has(item.event_id)).at(-1);
    assert.ok(queued?.event_type === "task_run.queued");
    assert.equal(await repository.processEvent({
      message: { contract_version: "1.0", event_id: queued.event_id, workspace_id: workspaceId, task_run_id: taskRunId, attempt_no: 1, correlation_id: queued.correlation_id, input_snapshot: queued.data.input_snapshot },
      consumerName: "submission-reservation-integration", workerId: "offline-worker", now: new Date(), leaseMs: 100,
    }), "PROCESSED");
    startedEvents.add(queued.event_id);
  };
  try {
    await control.ensureDevIdentity({ user: { id: userId, displayName: "Offline reservation" }, workspace: { id: workspaceId, name: "Offline reservation" } });
    assert.equal((await control.createProject({ scope: `${scope}:project`, idempotencyKey: "project", requestHash: "a".repeat(64), workspaceId, projectId, name: "Offline project" })).kind, "NEW");
    assert.equal((await assets.createShot({ scope: `${scope}:shot`, idempotencyKey: "shot", requestHash: "b".repeat(64), workspaceId, projectId, shotId, position: 0, prompt: "Offline request.", model: null, generationSettings: {}, referenceBindings: [] })).kind, "NEW");
    assert.equal((await assets.updateShot({ scope: `${scope}:ready`, idempotencyKey: "ready", requestHash: "c".repeat(64), workspaceId, shotId, status: "READY" })).kind, "NEW");
    assert.equal((await tasks.createTaskRun({
      scope: `${scope}:create`, idempotencyKey: "create", requestHash: "d".repeat(64), workspaceId, taskRunId, shotId,
      kind: "VIDEO_GENERATION", inputSnapshot: { model: "mock-video-v1", prompt: "Offline request.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: [] }, event: event(),
    })).kind, "NEW");
    const ensure = () => tasks.ensureProviderAttempt({ workspaceId, taskRunId, providerAttemptId: createPrefixedId("att"), provider: "mock", model: "mock-video-v1", now: new Date() });
    const [first, second] = await Promise.all([ensure(), ensure()]);
    assert.ok(first);
    assert.equal(second?.id, first.id);
    const reserveInput = { workspaceId, taskRunId, providerAttemptId: first.id, now: new Date() };
    assert.equal(await tasks.reserveProviderSubmission(reserveInput), false, "QUEUED is not a submit authorization");
    assert.equal(await tasks.reserveProviderSubmission({ ...reserveInput, workspaceId: createPrefixedId("ws") }), false);
    await start(tasks);
    const reservations = await Promise.all([tasks.reserveProviderSubmission(reserveInput), tasks.reserveProviderSubmission(reserveInput)]);
    assert.equal(reservations.filter(Boolean).length, 1);

    const restarted = new DrizzleTaskRunRepository(database.db);
    assert.equal(await restarted.reserveProviderSubmission(reserveInput), false);
    const failed = await restarted.finalizeTaskRunExecutionFailure({ workspaceId, taskRunId, code: "PROVIDER_UNAVAILABLE", message: "Synthetic delivery exhaustion.", now: new Date() });
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.error?.retryable, false);
    const retry = (idempotencyKey: string) => restarted.retryTaskRun({ scope: `${scope}:retry`, idempotencyKey, requestHash: "e".repeat(64), workspaceId, taskRunId, event: event() });
    assert.equal((await retry("unknown")).kind, "STATE_INVALID");
    const [uncertain] = await restarted.listTaskRunAttempts(workspaceId, taskRunId);
    assert.equal(uncertain?.id, first.id);
    assert.ok(uncertain?.submissionReservedAt);
    assert.equal(uncertain?.providerRequestId, null);

    // A slow first submit may finish after another delivery has failed closed.
    // Persist its real ID even in FAILED, then explicit retry resumes GET only.
    const providerRequestId = `offline-${taskRunId}`;
    await restarted.recordProviderSubmission({ ...reserveInput, providerRequestId, now: new Date() });
    assert.equal((await restarted.listTaskRunAttempts(workspaceId, taskRunId))[0]?.providerRequestId, providerRequestId);
    assert.equal((await retry("known")).kind, "NEW");
    await start(restarted);
    assert.equal((await ensure())?.providerRequestId, providerRequestId);
    assert.equal(await restarted.reserveProviderSubmission(reserveInput), false);
    await assert.rejects(restarted.recordProviderSubmission({ ...reserveInput, providerRequestId: "different-offline-id", now: new Date() }), /PROVIDER_RESUBMIT_FORBIDDEN/);
    assert.equal((await restarted.listTaskRunAttempts(workspaceId, taskRunId)).length, 1);

    // Generic status/auth/routing failures and historical unclassified rows
    // retain the durable ID. A JSON string is not trusted terminal evidence.
    for (const [index, flag] of [null, false, "true", [true], 1, { terminal: true }].entries()) {
      const legacyStatus = index % 2 === 0 ? "FAILED" : "ABANDONED";
      await restarted.failTaskRun({ ...reserveInput, failureStage: "PROVIDER", code: "PROVIDER_REJECTED", message: "Synthetic HTTP access failure.", retryable: false, now: new Date() });
      await database.db.update(providerAttempts).set({ status: legacyStatus, responsePayload: { code: "PROVIDER_REJECTED", provider_request_terminal: flag } }).where(eq(providerAttempts.id, first.id));
      assert.equal((await retry(`unproven-${index}`)).kind, "NEW");
      await start(restarted);
      assert.equal((await ensure())?.providerRequestId, providerRequestId);
      assert.equal(await restarted.reserveProviderSubmission(reserveInput), false);
    }

    // Only a status result classified by the Provider permits a new attempt.
    await restarted.failTaskRun({ ...reserveInput, failureStage: "PROVIDER", providerRequestTerminal: true, code: "PROVIDER_REJECTED", message: "Synthetic completed failure status.", retryable: false, now: new Date() });
    assert.equal((await retry("proven-terminal")).kind, "NEW");
    await start(restarted);
    const next = await ensure();
    assert.ok(next);
    assert.notEqual(next.id, first.id);
    assert.equal(await restarted.reserveProviderSubmission({ ...reserveInput, providerAttemptId: next.id }), true);
    const uncertainAfterTerminal = await restarted.finalizeTaskRunExecutionFailure({ workspaceId, taskRunId, code: "PROVIDER_UNAVAILABLE", message: "Synthetic failure after reservation.", now: new Date() });
    assert.equal(uncertainAfterTerminal?.error?.retryable, false, "old known terminal IDs must not hide a newer uncertain submission");
    assert.equal((await retry("new-unknown")).kind, "STATE_INVALID");

    // Repository-level terminal guard covers cancellation without invoking any
    // external Provider or inventing a public cancellation endpoint.
    await database.db.update(taskRuns).set({ status: "ABANDONED" }).where(eq(taskRuns.id, taskRunId));
    assert.equal(await restarted.reserveProviderSubmission(reserveInput), false);
    assert.ok((await restarted.listTaskRunAttempts(workspaceId, taskRunId))[0]?.submissionReservedAt);
  } finally {
    await database.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await database.db.delete(users).where(eq(users.id, userId));
    await database.db.delete(commandDeduplications).where(like(commandDeduplications.scope, `${scope}%`));
    await database.close();
  }
});
