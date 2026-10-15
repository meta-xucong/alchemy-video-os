# C06 runtime recovery blocker closure — 2026-10-14

## Scope and baseline

- Isolated worktree: `D:\AI\alchemy_video_OS\audit-29af838`.
- Code baseline: `29af838cd436ba6a944d6d14e33e270d9ba2cf73` plus the existing uncommitted work already present in this handoff worktree. No unrelated work was reset or replaced.
- Scope: close the two P2 findings from the latest execution-fence audit (`BILLING_FAILED` duplicate delivery and late known-request recovery), plus repair stale migration/supersession regression expectations.
- Explicitly out of scope: real Provider calls, debit, production/VPS operations, GitHub writes, merge, deployment, or any claim that the whole product is accepted/releasable.

## Changes

1. **`BILLING_FAILED` queue replay is now inert.** The executor returns the persisted `BILLING_FAILED` TaskRun before touching Provider status, Attempt, asset, or billing paths. Queue-exhaustion finalization treats the state as already settled and does not attempt an illegal transition. Explicit billing retry remains valid: the public retry command transitions it to `BILLING_PENDING`, where normal billing-only recovery resumes the validated asset.
2. **Late request-ID recovery is now continuous and bounded.** The Worker starts a 30-second C06 reconciliation timer by default (`C06_RECOVERY_INTERVAL_MS=30000`; `0` disables; values 1–4999 are rejected). Each tick has an in-process overlap guard and scans at most 25 active video TaskRuns.
3. **The recovery selector is fail-closed.** It returns only active video TaskRuns that already have an unresolved persisted Provider request ID. A reservation without a request ID is excluded; recovery cannot treat it as permission to POST again. Both startup recovery and periodic scans defer retryable status/download errors instead of finalizing them as permanent failure. Per-task finalization failures are logged and do not abort the remainder of a batch.
4. **Migration regression expectations match the frozen schema.** The migration test now checks the nullable execution-fence field and the actual 31-entry migration journal. Superseded stale writes assert the fencing behavior; the late-ID fixture now includes the required durable submission reservation.

## Verification

Local isolated Docker services only: PostgreSQL 16 (`video_fence_20261013`), Redis DB 15, dedicated MinIO bucket `alchemy-audit-20261014`; `VIDEO_PROVIDER=mock`, `VEYRA_CREDIT_ENABLED=false`.

- `pnpm test`: final run completed with exit code 0. Relevant suites: Persistence **143 passed / 1 existing conditional skip**; Control API **155 passed / 4 existing conditional skips**; Task Worker **122/122**, including all DB/Redis/MinIO integration tests; Workflow Worker **116/116**; storage-client **31/31**. The root run had 7 conditional/special-environment skips overall; they are not counted as passes. Package totals are not summed as a single coverage metric.
- `apps/task-worker/tests/execution-closure.integration.test.ts`: **13/13 passed, 0 skipped** on PostgreSQL/Redis/Mock. Includes unknown-reservation exclusion, late request-ID selector inclusion, subsequent polling/download recovery, and a single Provider submission.
- Targeted `packages/persistence/tests/task-run-supersession.integration.test.ts`: **2/2 passed**.
- Task Worker typecheck: exit 0. Whole-workspace `pnpm typecheck` was running at the time this document was first written; its final process exit must be recorded in the append-only verification update below.
- `git diff --check`: exit 0; Git emitted only the existing `_journal.json` LF→CRLF working-copy notice.

## Limits and operational boundary

- Unknown Provider submission (durable reservation but no request ID) remains intentionally unresolved and requires operator reconciliation against upstream evidence. Do not clear the reservation or retry blindly.
- The periodic scanner may perform Provider status GET/download and object-store writes for persisted known request IDs; it is not enabled/validated against a real Provider in this work. No Provider POST is possible from its candidate selection.
- This is not proof of horizontal-scale readiness, exactly-once external side effects, mixed-version safety, real-provider behavior, production migration, or product release acceptance. The existing stop/drain/upgrade requirement for old Worker/API binaries remains.
- Independent read-only review of the final diff is pending. Do not mark this scoped repair accepted until that reviewer returns.

## Append-only final checks

### 2026-10-14 final verification addendum

- Independent read-only re-review of the two held P2 items: **PASS**. The reviewer inspected the final scheduler/shutdown and retryable Provider status paths; the reviewer did not run tests.
- `pnpm --filter @alchemy-video/task-worker test` with isolated PostgreSQL 16 + Redis DB 15 + MinIO and Mock Provider: **124 passed, 0 failed, 0 skipped**.
- Specifically, actual interval trigger/single-flight/stop-drain test passed; retryable Provider status outage retained the persisted request ID, stayed `PROVIDER_PROCESSING`, returned `PROVIDER_RETRY_PENDING`, and kept Provider submit count at one.
- `pnpm --filter @alchemy-video/task-worker exec tsx --test tests/worker.integration.test.ts` with local Postgres/Redis/MinIO: **5/5 passed, 0 skipped**, including all four C06 BullMQ/startup recovery integration cases.
- `pnpm --filter @alchemy-video/task-worker exec tsx --test tests/legacy-worker-fence.integration.test.ts` with PostgreSQL 16 loopback random disposable DBs: **3/3 passed, 0 skipped**. The tests create and drop only their uniquely named local databases.
- Final root `pnpm test`: **exit 0** across all workspace projects. Conditional skips remain visible and are not counted as passes; notable package summaries: persistence **143 passed / 1 skipped**, control-api **155 passed / 4 skipped**, document-worker **11 passed / 1 skipped**. The one persistence skip requires a separately configured production-recovery fixture; the one document-worker skip requires the optional real loopback Runtime. The four control-api skips remain the suite's explicitly conditional cases. All worker tests ran with their required local dependencies in this final root run.
- Root `pnpm typecheck`: **exit 0**. `pnpm --filter @alchemy-video/task-worker build`: **exit 0**.
- `git diff --check`: **exit 0**; only the existing `_journal.json` LF→CRLF working-copy warning was reported.

### Final scoped disposition

The previously held C06 runtime-recovery issues are closed in this isolated worktree: safe candidate selection, no duplicate submission after a persisted request ID, retryable status failures deferred, `BILLING_FAILED` duplicates inert, and graceful shutdown drains an in-flight C06 tick before closing its dependencies. Independent code re-review passed and relevant tests executed without skips.

This is a scoped code/test acceptance for the isolated worktree only, **not** an overall product/release acceptance. No real Provider, debit, VPS, GitHub, merge, or deployment was performed. Historical QC, real-provider behavior, complete browser flow, production migration/capacity, the optional production-recovery fixture and real loopback Document Runtime remain outside this verification. Unknown Provider outcomes without a durable request ID still require operator reconciliation; do not blindly resubmit them. Existing old-process stop/drain/upgrade constraints remain in force.

### GitHub/VPS follow-up verification — 2026-10-14

The user subsequently authorized publishing this worktree to the existing GitHub PR branch and updating the VPS/bridge. Two additional P2 findings from an independent audit were corrected before publication:

- `recoverC06TaskRuns()` now defaults `deferRetryableErrors` to `true`, so startup recovery follows the same safe transient-error policy as periodic recovery unless a caller explicitly overrides it.
- Both PostgreSQL and in-memory task-run repositories now treat `BILLING_FAILED` as terminal for execution-fence acquisition; replaying that delivery cannot persist a new owner token.

Regression coverage was added for the startup default and for PostgreSQL/in-memory token stability. Current local checks: Task Worker suite **105 passed / 0 failed / 20 conditional skips**; Control API billing-release focused suite **2 passed / 0 failed / 1 conditional PostgreSQL skip**; Persistence supersession suite **3 conditional skips** because `LEGACY_FENCE_TEST_DATABASE_URL` is not configured in this isolated shell. These counts describe distinct focused runs and must not be added to earlier suite totals. Whole-workspace `pnpm typecheck` is being rerun after these changes; its final result is recorded at publication time.

Independent read-only re-review of both P2 fixes: **PASS (code-level; reviewer did not run tests)**. Whole-workspace `pnpm typecheck`: **exit 0** after the P2 changes. `git diff --check` passes, with only the previously noted `_journal.json` line-ending warning. GitHub Actions must validate the final uploaded commit, including database-backed regression and secret scanning.

VPS deployment and bridge remain **not performed**: the SSH wrapper reached a private-key passphrase prompt and was cancelled before any remote command; the supplied passphrase is not available through the configured secure environment. DNS/HTTPS probes for `video.aiself.vip` and `assets.video.aiself.vip` also failed locally, so edge/TLS readiness is not established. No Provider call, charge, migration, service restart, merge, or deployment has occurred. Do not enable billing credit or a real Provider until SSH access is unlocked and the documented identity-canary and deployment gates pass.

### 2026-10-14 GitHub CI follow-up

- First uploaded commit `509c69ed03c119bdf9c0ded427be251e8ffde880` triggered workflow run `38440962084`. All jobs except `validate` passed; `validate` reported 4 failures and 0 skips among 161 reported tests, all rooted in the production-repository integration suite's stale expectations for execution-fence rejection. The database-backed assertions were not executed in the local shell because its PostgreSQL fixture is unavailable.
- Updated only the integration-test expectations: stale fenced mutations now explicitly expect `TaskRunExecutionOwnershipLostError`; the C12 failure helper avoids re-writing a TaskRun already made `FAILED` by the mock Worker while retaining the production failure-event call. This changes test expectations/setup only; production code is unchanged by this follow-up.
- The independent read-only reviewer rechecked these test changes and returned **PASS**; they were judged consistent with execution-fence semantics and not a weakening of the production audit.
- After this test-only follow-up, local execution could not be repeated: the shell rejected canonicalizing the isolated worktree path with Windows access denied (OS error 5). Thus these changes still require the exact-head GitHub CI run, particularly the database-backed validation suite. Do not treat the first CI failure as resolved until a new exact-head run passes.
- VPS remains not updated and the bridge remains incomplete. No SSH command reached the VPS; first unlock/load the existing key through the secure local SSH agent, then resume the documented identity-only canary and deployment gates. No real Provider or billing was enabled.

### 2026-10-14 C06 startup-recovery CI follow-up

- Exact-head CI run `38442338990` validated the integration fixture and P2 behavior, and all six non-validate jobs passed. Workspace typecheck and isolated PostgreSQL migrations passed. Unit/contract tests reported **123 passed / 2 failed / 0 skipped**; C06/C12 browser steps were skipped after the unit failure.
- The two failures are in older C06 integration cases that intentionally assert retry/exhaustion behavior for transient storage errors. They called `recoverC06TaskRuns()` without options, so they inherited the newly tightened safe default `deferRetryableErrors: true`; observed attempts stayed at 1 rather than the fixtures' explicit retry expectations of 3. The service default itself is intentional and has separate default-policy coverage.
- Corrected those two test invocations to explicitly opt into `deferRetryableErrors: false`, keeping production startup behavior unchanged while making the fixtures request the retry policy they assert. This is test-only; the exact-head CI must confirm it. No local rerun is claimed because isolated-worktree execution remains blocked by Windows OS error 5.
- The previous exact-head follow-up remains unaccepted until a fresh CI run passes all jobs. VPS deployment and bridge are still not performed; SSH agent has no loaded identity, and no remote command has been run.
