# TaskRun execution fencing — implementation contract (2026-10-13)

## Purpose and frozen scope

Close the stale-writer gap identified during independent review of `29af838cd436ba6a944d6d14e33e270d9ba2cf73`: a PostgreSQL session advisory-lock check can succeed, the connection can then be lost, and an ordinary repository transaction can still commit after a different worker has become the execution owner.

This change is limited to transaction-bound fencing for TaskRun execution. It does not change creative behavior, Provider protocol, billing policy, API shape, UI, or deployment. Existing local audit changes remain in scope and must be preserved.

## Contract

1. The session advisory lock remains the fast mutual-exclusion mechanism; it is not by itself write authorization.
2. `task_runs.execution_fence_token` is the current execution capability. A successful owner claim generates a fresh, non-reused UUID and stores it on the TaskRun row.
3. Every execution-owned database mutation transaction must first lock that TaskRun row with `SELECT ... FOR UPDATE` and validate the exact workspace, TaskRun ID, and expected token. Validation and all TaskRun/Attempt/Asset/Shot/Outbox writes must remain in the same transaction. Missing, null, or mismatched tokens fail closed before child-row writes.
4. New owner claim, explicit retry, and successful segment supersession revoke the previous token atomically with their TaskRun state change. First claim happens only after acquiring the advisory lock.
5. Preserve two narrowly scoped immutable-evidence exceptions for already-crossed external boundaries:
   - If a Provider POST was accepted and the old executor receives its request ID late, it may append that ID to the exact reserved Attempt only when the ID is currently absent. It must not change Attempt status/payload, TaskRun, Shot/Asset, or Outbox. Same-ID replay is idempotent; a different ID is rejected.
   - If a credit debit was accepted but its response arrives after ownership changes, `recordUsageReceipt` may persist/replay the immutable, globally idempotent receipt. It must not transition TaskRun state; only the fenced billing completion methods may do that.
   Both are evidence recovery, not owner authorization. No other stale writes are allowed.
6. External effects (Provider HTTP, credit debit, object storage) cannot be atomically fenced by PostgreSQL. Existing submission reservation/no-blind-resubmit and credit idempotency-key rules remain mandatory. The guarantee is stale database-state-write prevention after token replacement, not cancellation of in-flight external calls or exactly-once execution. A stale object PUT can leave an unpublished deterministic-key object; the fenced completion transaction controls publication.
7. The additive nullable migration is compatible for reads but old binaries do not enforce the token. Mixed old/new Workers remain unsupported; downgrade/rollback must not remove the column or imply fencing is preserved.

## Required implementation inventory

Execution-context token must be threaded through every guarded write path, including billing completion:

- `ensureProviderAttempt`, `reserveProviderSubmission`, `recordProviderSubmission`, `recordProviderProcessing`;
- `beginDownload`, `recordDownloadRetryableFailure`, `ensureGeneratedAsset`, `completeGeneratedTaskRun`;
- `markBillingSucceeded`, `markBillingFailed`, `scheduleBillingRetry`, `resumeBillingRetry`, `failTaskRun`;
- `finalizeTaskRunExecutionFailure` (which claims its own execution token).

Retry and segment-supersession code must revoke the old TaskRun token in the same transaction. Audit every TaskRun mutation path and document whether it is owner-fenced, a lifecycle transition that revokes the token, or a read/non-execution operation. No optional token bypass is allowed on the listed execution-owned writes.

`processEvent` has one separate pre-execution admission transition: it atomically claims a durable queued event and moves only the matching `QUEUED` TaskRun to `RUNNING` before an executor owner token exists. It is not an execution-owned mutation API; it is scoped to the current queued event/consumer lease in one transaction. Duplicate or obsolete event generations do not perform this transition. All subsequent Attempt/asset/task execution writes are token-fenced. New TaskRun insertion, owner-token claim/replacement, consumer event lease bookkeeping, retry/supersede, and controlled recovery are separately scoped lifecycle operations rather than bypasses for execution mutation methods.

## Verification and release gates

Required focused real-PostgreSQL tests:

1. Stale owner A loses its advisory session; owner B claims a new token. Every A execution write fails before mutation; TaskRun, Attempt, Shot, Asset, and Outbox remain unchanged.
2. If A already holds the TaskRun row lock in a valid mutation, B's token claim waits; A commits first, then B claims. This proves the row-locked transaction is the ownership handoff linearization point.
3. Retry and segment supersession revoke predecessor tokens; stale predecessor writes fail, while the new run proceeds.
4. Late accepted Provider ID is appended as evidence only; same ID is idempotent, conflicting ID fails, and no stale status/outbox mutation occurs.
5. Missing/wrong/workspace-mismatched tokens fail closed; injected failure after fence validation rolls back all child writes.
6. A held Mock Provider POST demonstrates the stated external-effect boundary: a previously reserved in-flight POST may finish after owner loss, its late ID is retained, and no duplicate POST or stale publish occurs.

Then run persistence and task-worker suites, whole-workspace typecheck/build, and `git diff --check`. Tests must use local PostgreSQL and Mock Provider only. No real Provider, billing debit, VPS, merge, push, or deployment is in scope.

## Acceptance boundary

Passing these gates closes the specific cooperative-lock check-to-write database race for upgraded binaries. It does not validate real Provider behavior, production rollout, old-process drain, real billing, UI, VPS, or deployment. Those remain separately gated. An independent read-only audit must review the frozen implementation and test evidence before calling this design contract satisfied.

## Implementation and local verification evidence (2026-10-13)

Implementation is present in this isolated checkout, layered on the preserved prior audit changes. The schema adds nullable `task_runs.execution_fence_token` with forward migration `0030_cooing_starfox.sql`; the generated journal/snapshot are updated. A fresh UUID is installed while the session advisory lock is held. Every listed execution write now takes a required token, obtains the existing transaction advisory lock, locks the scoped TaskRun row `FOR UPDATE`, and validates the token before changing Attempt, Asset, Shot, TaskRun, or Outbox rows. Retry, successful segment supersession, and terminal transitions revoke the prior token in their own transaction.

The two evidence-only exceptions are implemented as written above: late Provider request-ID persistence updates only the exact reserved Attempt if its ID is absent; usage receipts remain immutable/idempotent evidence, while billing state changes require the execution token. These exceptions do not authorize any other stale-owner state mutation.

## Unresolved submission recovery/finalization addendum (2026-10-13)

An additional safety gap was closed after the first fencing pass: a reservation without a persisted Provider request ID can mean the original HTTP POST is still in flight, not that the Provider rejected it. Recovery previously could fail the TaskRun, and queue exhaustion finalization could classify the uncertain reservation as terminal. Both paths now defer without changing TaskRun or Attempt state. The original owner may still append a late request ID as evidence; a later recovery then polls that ID without issuing a second POST.

Implementation:

- `apps/task-worker/src/execution-service.ts`: recovery encountering `submissionReservedAt` with no `providerRequestId` throws a retryable defer in every mode; it does not call `failTaskRun`, including when reference delivery also errors.
- PostgreSQL and in-memory `finalizeTaskRunExecutionFailure` return the unchanged `RUNNING` TaskRun if an unresolved reservation exists; no `PROVIDER_SUBMISSION_UNKNOWN` terminal state is written.
- A dedicated typed `ProviderSubmissionReconciliationPendingError` distinguishes this fail-closed unknown outcome from ordinary retryable Provider failures. Recovery reports it as `deferred` rather than `failure`; `recoverC06TaskRuns` invokes a separate `onDeferred` callback and never finalizes it. Deferred results carry a kind: only `PROVIDER_SUBMISSION_UNKNOWN` emits `operator_reconciliation_required`; normal `EXECUTION_BUSY` emits `retry_after_owner_release`.
- Unit regressions verify in-memory queue exhaustion leaves RUNNING/error-null, recovery reports deferred, explicit retry cannot duplicate the submission, and the deferred callback does not call the failure finalizer.
- PostgreSQL/Redis integration regression adds queue finalization while a held POST is in flight, then late request-ID persistence and recovery polling; the finalizer must leave RUNNING and submit count remains one.
- PostgreSQL migrated abandoned no-ID reservation regression now expects safe deferral and immutable attempt history.

Latest verification in this session:

- `submission-reservation.test.ts` + `execution-service.test.ts` + `service.test.ts`: **60 passed / 0 failed / 0 skipped** via direct local `tsx` invocation.
- TypeScript `tsc --noEmit` for task-worker, control-api, and persistence: **exit 0**.
- `execution-closure.integration.test.ts` was invoked but **13/13 skipped** because this session has no `DATABASE_URL`; Docker is also unavailable (`docker compose ps` denied access to Docker engine). Do not reuse the earlier 13/13 integration result as proof for this newest finalizer change. The changed PostgreSQL integration assertion remains to be run with isolated PostgreSQL 16 + Redis before acceptance.
- `git diff --check`: exit 0, with the existing `_journal.json` LF-to-CRLF warning only.

The finalizer behavior is implemented and unit-covered for the in-memory store, but the latest PostgreSQL held-POST + finalizer sequence is **NOT VERIFIED in this environment**. Keep the overall status pending independent review and that integration run. If an accepted POST has no persisted ID after the original process is gone, the system intentionally leaves the TaskRun RUNNING and requires an operator to reconcile with Provider-side evidence before any repair; there is no safe automatic retry or automatic reset. No Provider, billing debit, VPS, GitHub write, merge, or deployment was used.

Independent read-only follow-up (2026-10-13) confirmed the deferred-kind distinction, operator-vs-owner action labels, and corrected recovery-polling documentation. It found no additional P1/P2 in this scoped fix and did not run tests. The PostgreSQL integration gate remains pending as stated above.

Local isolated PostgreSQL 16 + Redis + Mock Provider verification on 2026-10-13:

- `apps/task-worker/tests/execution-closure.integration.test.ts`: **13/13 passed, 0 skipped**. Includes all stale writer categories, missing and cross-workspace token rejection, atomic rollback injected after Attempt/TaskRun writes but before Shot completion, row-lock handoff ordering, late-ID evidence-only behavior, and the held-POST/recovery behavior.
- `packages/persistence/tests/production-repository.integration.test.ts`: **7 passed, 0 failed, 1 skipped**; includes a stale-token assertion after successful segment supersession. The skipped nested recovery-lineage test requires a separate explicitly named disposable recovery database.
- `pnpm --filter @alchemy-video/persistence test`: **139 passed, 0 failed, 5 skipped**. Existing skips cover special PostgreSQL migration/recovery databases; none are the new focused execution-fence tests.
- `pnpm --filter @alchemy-video/task-worker test`: **113 passed, 0 failed, 6 skipped**. Four existing MinIO/BullMQ integration cases need their separate MinIO environment; two legacy-worker cases need a separate legacy fence database.
- `pnpm --filter @alchemy-video/control-api test`: **154 passed, 0 failed, 4 skipped**.
- `pnpm --filter @alchemy-video/workflow-worker test`: **116 passed, 0 failed, 0 skipped**.
- Whole-workspace `pnpm typecheck`: exit 0. Whole-workspace `pnpm build`: exit 0, including Nuxt production build and Worker/package builds.
- `git diff --check`: exit 0; Git emits only the existing `_journal.json` LF-to-CRLF working-copy warning.

These suite totals overlap and must not be summed. No real Provider, credit debit, VPS, GitHub write, merge, production migration, or deployment was used. The migration was applied only to the local disposable `video_fence_20261013` database.

Remaining boundaries: old binaries do not enforce this fence, so a full inventory/stop/drain/upgrade of every old process is still a production prerequisite. The fence prevents stale database state writes after token replacement; it cannot cancel or atomically fence an in-flight Provider POST, debit, or object PUT. Do not claim exactly-once external effects, mixed-version safety, horizontal-scale readiness, or production acceptance from these local tests.

### Independent review follow-up (2026-10-13)

The first read-only implementation review found two P2 gaps and no P0/P1: the control-api in-memory `TaskRunStore` did not validate/retain execution tokens, and owner entry could install a new token on a missing, terminal, or superseded run. Both have been addressed in this checkout:

- `InMemoryTaskRunStore` now installs/replaces a per-run token only for eligible active rows; execution mutators validate the exact token, retry/finalization clear or pass the token consistently, and the finalizer uses the same fenced path. Its regression proves an old token cannot write after a new owner replaces it.
- `withTaskRunExecution` no longer claims a token for missing, superseded, or terminal rows. A regression checks a superseded PostgreSQL row remains tokenless after callback entry; terminal/superseded execution remains fail-closed without state mutation.
- Test wrappers provide explicit short-lived owners only for ordinary direct-mutation tests. Stale-owner tests exercise the raw token boundary; supersession assertions allow either typed ownership-loss rejection or a safe no-op for already-ineligible operations, then verify TaskRun/Attempt/Asset/Shot/Outbox remain unchanged.

After these corrections: full control-api suite **153 passed / 0 failed / 6 skipped**; focused execution-closure PostgreSQL/Redis suite **13/13, 0 skipped**; production repository integration **7 passed / 0 failed / 1 skipped**. Whole-workspace `pnpm typecheck` and `pnpm build` both exit 0. Totals overlap and must not be summed. The six control-api skips are environment/platform-dependent and are not passes. Independent read-only follow-up by `/root/fencing_design` reviewed exactly the two P2 fixes and concluded **both closed, no residual issue within scope**. The reviewer did not rerun tests; verification counts above are the main agent's local execution evidence, not reviewer-run evidence.

### Final Docker-restored verification (2026-10-13)

The user reopened upgraded local Docker. The current finalizer/recovery changes were then verified against isolated PostgreSQL 16 + Redis + Mock Provider; this supersedes earlier “Docker unavailable / integration pending” notes for this checkout:

- `apps/task-worker/tests/execution-closure.integration.test.ts`: **13/13 passed, 0 skipped**, including held Provider POST, unresolved-reservation finalization, late request-ID persistence, and subsequent recovery polling with no duplicate submit.
- Task Worker: **115 passed / 0 failed / 6 skipped**. The legacy-fence tests were separately run on a disposable legacy DB: **3/3 passed**. Remaining skips require MinIO/S3 setup and are not passes.
- Persistence: **139 passed / 0 failed / 5 skipped**. Control API: **155 passed / 0 failed / 4 skipped**. Skips are existing conditional/special-environment cases.
- Focused submission/execution/service unit suites: **60/60 passed**. Targeted TypeScript noEmit checks for task-worker, control-api and persistence exited 0. Whole-workspace typecheck reached its final package without diagnostics, but its process exit code was not captured in this final run; do not report a fresh whole-workspace typecheck PASS from that run.
- Post-test read-only check: the disposable DB had 0 nonterminal TaskRuns, 0 pending outbox rows and 0 test-workspace rows. Generic `video_local` was read-only inspected and not modified.
- Current `git diff --check` passed with only the existing `_journal.json` line-ending warning. A final root `pnpm build` could not be rerun because the execution tool denied canonicalizing the isolated worktree as the package-manager working directory; earlier build evidence applies to an earlier snapshot.

No real Provider submission, billing debit, production migration, GitHub write, merge, VPS or deployment was performed. A true orphan reservation without a verifiable request ID remains intentionally RUNNING and requires operator reconciliation against Provider-side evidence; it must not be cleared or retried blindly. No-mixed-version/stop-and-drain and external side-effect limits remain production prerequisites.
