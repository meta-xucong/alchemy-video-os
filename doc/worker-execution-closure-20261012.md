# Worker execution closure, 2026-10-12

Status: READY_FOR_AUDIT. No deployment, real Provider, billing, or VPS validation is authorized by this record. This is a code-level repair record, not a change to the project's chapter/production acceptance gates.

## Frozen scope and source

- Input: `2c614c508de4b597fa9f69b21ace2499ee38f231`.
- Recent review: `145099b6b67e969db0ea8bcb7039a85f8af84415..2c614c508de4b597fa9f69b21ace2499ee38f231`, 25 files. The complete PR from `3d89042576d93fabc64d5369ab21102a3d660614` is 146 files; this review does not claim a new line-by-line audit of all historical changes.
- Existing platform sources: `apps/task-worker/src/execution-service.ts`, `service.ts`, `packages/persistence/src/task-run-repository.ts`, and the equivalent in-memory store at the input SHA. Preserve the existing submission reservation, known-request recovery, terminal Provider evidence, immutable snapshots, and workspace boundaries. No creative planning, content algorithm, Provider wire protocol, or business state is added.

## Reproduced boundaries and implemented minimal changes

1. Concurrent delivery can enter reference preflight before another execution reserves and sends POST. The first execution's preflight failure must not declare that active reservation terminal.
2. A new explicit retry can fail before creating its own attempt. Exhaustion must not rewrite the historical terminal attempt and erase its `provider_request_terminal` fact.
3. Event consumption is not an execution lock. All upgraded executors and exception finalizers share a private workspace/task-run execution guard. Ordinary busy delivery remains pending in BullMQ with its attempt budget intact; startup recovery reports deferred and does not finalize another owner.
4. BullMQ can exhaust stalled work before calling the application processor. The failed-event fallback still performs guarded finalization; a blocked finalizer requeues the same durable job for idempotent recovery. Shutdown waits for pending terminal handlers. An ordinary processor failure awaits terminal persistence while the job is active, so a busy/database-failed finalizer cannot silently acknowledge its only wake-up.
5. Finalizers bound to a queued event reject stale callbacks from an earlier explicit retry. Attempt updates exclude abandoned/succeeded and proven-terminal history. Unknown no-ID reservations are detected separately, including the conservative abandoned shapes produced by migration 0027; their historical rows remain unchanged.
   Retry generations use the already-established `afterEvent` causal-time helper while holding the existing TaskRun transaction lock. The new queued event is strictly after both the TaskRun's current timestamp and all its prior events, including started/failed events. A random event ID is never evidence of a newer generation. This is an internal causal ordering timestamp, not a promise of exact physical wall-clock time. Outbox availability/backoff remains wall-clock based; in-memory storage now matches PostgreSQL's independent immediate availability.
6. The frozen input added `PROVIDER_SUBMISSION_UNKNOWN` without regenerating its checked-in exports. The existing generator now updates OpenAPI JSON/YAML and the standalone schema; the export-drift test passes.
7. Studio's TS2454, project-navigation command continuation, stale/equal-timestamp responses and ambiguous retry receipts are handled separately in `studio-project-refresh-typecheck-fix-20261012.md`. No planning algorithm is replaced.

## Private execution guard contract

- PostgreSQL uses a session advisory lock on a namespaced hash of both workspace ID and TaskRun ID. This is execution exclusion, not a TTL lease. It is distinct from the repository's short transaction advisory lock.
- A dedicated physical PostgreSQL connection owns the lock for the complete execute/finalize call. It is not returned to the query pool, and work transactions continue to commit reservations and request IDs independently. No database transaction spans the external POST.
- A failed try-lock performs no TaskRun/Attempt mutation. Queue execution defers the same durable job rather than acknowledging it or consuming a failure attempt. Startup recovery skips the busy item, leaving the owner/queue responsible. A stale terminal callback cannot finalize while another execution owns the guard.
- Connection error/end invalidates ownership. The executor checks ownership before additional side effects and does not classify a lost guard as a business failure. A returned Provider ID may still be recorded as evidence; no additional POST is permitted by the durable reservation. Startup ownership loss re-enters its existing bounded recovery attempts instead of incorrectly reporting another owner. Connection setup and lock queries have 5-second bounds; shutdown force-destroys the dedicated socket after a 1-second close bound. Cleanup cannot replace the original callback exception. The connection is closed after release, including an uncertain unlock.
- A dead process releases the session lock through PostgreSQL. Existing no-ID reservations remain fail-closed on recovery. This does not prove arbitrary network-partition exactly-once behavior, Provider cancellation, or mixed-version safety. Old workers do not honor the new guard and must not be mixed. Production horizontal scaling and deployment remain unaccepted.
- In-memory tests use the same fail-fast ownership semantics per store. Real PostgreSQL tests must use independent store/connection instances and the actual consumer plus executor.

## Verification

Environment: dot cloud checkout, Node 24.19.0, lockfile-pinned pnpm 10.33.0, official PostgreSQL 16.10 and Redis 7.2.10 built in an isolated temporary directory. Each integration run creates fresh loopback databases and Redis data, starts services and runs migrations/tests in one shell namespace, then stops services. No user computer, external database, Provider, VPS, or billing service was used. `pnpm-lock.yaml` is unchanged.

### Failure-to-pass evidence

- Two added consumer/executor regressions were run against the unchanged input implementation: **0 passed / 2 failed**. The in-flight POST was prematurely finalized, and retry exhaustion rewrote the abandoned terminal attempt's status and removed `provider_request_terminal`. Both pass after the repair.
- `apps/task-worker/tests/execution-closure.integration.test.ts`: **9 passed / 0 failed / 0 skipped** on real PostgreSQL/Redis. The consumer/real repository/executor combination proves more than three busy BullMQ deliveries do not terminate a held POST; after the original owner then encounters a recoverable processing result, the durable queue resumes and succeeds with exactly one submit. The same suite exercises generic pre-attempt read failure, terminal historical evidence, relay failure classification, a later fresh attempt, independent connection ownership, 12 concurrent different-task guards without query-pool starvation, backend termination, migrated unknown reservations, startup ownership reacquisition, backward-clock event generations and ambiguous legacy-generation recovery.
- The unlock blackhole case uses a real TCP proxy in front of PostgreSQL. Cleanup returned after approximately 5 seconds, retained the original callback Error, closed both proxy sockets and allowed another owner to acquire the same lock.
- `packages/task-queue/tests/bullmq.integration.test.ts`: **5/5**, including the exact persisted `defa`/attempt shape produced by BullMQ 6.1.0's stalled-job script. The processor is initially bypassed, the first guarded finalizer is busy, and the original durable job is retried and finalized without losing its wake-up. Ambiguous legacy generations produce one explicit recovery-required result and reach the existing dead-letter queue rather than looping every 250 ms.
- The first event-bound finalizer draft failed an additional frozen-clock, reverse-ID regression (`FAILED` instead of expected `QUEUED`). The final causal-time implementation passes both the in-memory same-millisecond test and PostgreSQL backward-clock test. Both also check that the new queued event can immediately be claimed by the outbox relay store despite its logical ordering timestamp.
- Studio's independent final review ran **84/84** targeted tests against frozen page SHA-256 `bbcfbbf32cbefef47a1e2969eee853d3810028a7258c7e20f74dcb3688390a34`. Those tests overlap the full Studio suite below and are not added to its count.

### Final workspace test counts

Equivalent workspace test entrypoints were run package-by-package. Node's supported `node --import tsx --test` entrypoint was used because this cloud sandbox does not allow the tsx CLI's Unix IPC socket; no test assertion or environment guard was removed. Persistence used `--test-concurrency=1`. The following are test-runner counts, including their nested tests, counted once per final package suite:

| Package | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| contracts | 51 | 0 | 0 |
| creative-planning | 114 | 0 | 0 |
| credit-veyra | 21 | 0 | 0 |
| document-intelligence | 2 | 0 | 0 |
| domain | 72 | 0 | 0 |
| persistence | 160 | 0 | 0 |
| provider-video | 81 | 0 | 0 |
| reference-analysis | 2 | 0 | 0 |
| reference-delivery | 3 | 0 | 0 |
| storage-client | 30 | 0 | 1 |
| task-queue | 5 | 0 | 0 |
| control-api | 158 | 0 | 0 |
| task-worker | 111 | 0 | 4 |
| document-worker | 12 | 0 | 0 |
| production-worker | 86 | 0 | 0 |
| workflow-worker | 116 | 0 | 0 |
| sub2api-video-certifier | 15 | 0 | 0 |
| studio-web | 123 | 0 | 0 |
| Node workspace total | 1162 | 0 | 5 |

- Root `pnpm typecheck` and `pnpm build` with pnpm 10.33.0: both passed across the workspace, exit 0. The build includes all TypeScript packages/apps and the Studio production Nuxt build; it is not a production Docker image or deployment test. The final frozen Studio also independently passed `nuxt typecheck` and `nuxt build` after its last edit.
- Contract generation: `cd packages/contracts && node --import tsx src/generate.ts`; all three generated changes contain only the missing error-code entries. Full contracts suite passed, including tracked export equality.
- Database migrations applied to fresh main and isolated recovery databases. Legacy-fence tests used their separate loopback test database. No migration/schema was added by this repair.
- `git diff --check`: passed.

### Reproduction commands and evidence locations

Run from the isolated checkout. The temporary service wrapper is a cloud test harness, not a deployment script; it starts fresh loopback services for one command and cleans them up on exit. It is intentionally outside the repository. A different machine can supply equivalent isolated PostgreSQL/Redis databases through the same environment variables.

```sh
npm_config_cache=/tmp/video-closure-npm-cache npx --yes pnpm@10.33.0 typecheck
npm_config_cache=/tmp/video-closure-npm-cache npx --yes pnpm@10.33.0 build
/tmp/video-worker-services/with-services.sh --without-minio bash -c '
  set -euo pipefail
  root=/workspace/scratch/79ebac196883/video-worker-closure
  createdb -h 127.0.0.1 -p 15432 -U video_local alchemy_recovery_test_closure
  export PRODUCTION_RECOVERY_TEST_DATABASE_URL=postgres://video_local@127.0.0.1:15432/alchemy_recovery_test_closure
  cd "$root/packages/persistence"
  node --import tsx src/migrate.ts
  DATABASE_URL="$PRODUCTION_RECOVERY_TEST_DATABASE_URL" node --import tsx src/migrate.ts
  node --import tsx --test --test-concurrency=1 tests/*.test.ts
  cd "$root/packages/task-queue"
  node --import tsx --test tests/*.test.ts
  cd "$root/apps/task-worker"
  node --import tsx --test tests/*.test.ts
  cd "$root/apps/control-api"
  node --import tsx --test tests/*.test.ts
'
(cd apps/studio-web && node --test tests/*.test.mjs)
git diff --check
```

Local evidence: `/tmp/video-closure-baseline-regressions.log` records the two expected original-implementation failures; `/tmp/video-closure-final-affected.log` records the final persistence/queue/Worker/API suites; `/tmp/video-closure-typecheck-final.log` and `/tmp/video-closure-build-final.log` record the final whole-workspace typecheck/build, both exit 0. The earlier broad package runs are in `/tmp/video-closure-packages-api.log`, `/tmp/video-closure-packages-api2.log` and `/tmp/video-closure-workers-final.log`; the first includes an intermediate persistence failure fixed before the latter/final runs and is not itself a blanket PASS. These local test outputs are not staged or repository artifacts.

Independent review of the frozen Worker scope passed after reading the final affected-suite evidence and matching source fingerprints. The independent Studio code/behavior review also passed. Neither review accepts an entire development chapter or production release. Status remains `READY_FOR_AUDIT`. On 2026-10-12 the user explicitly approved the narrowly stated exception to commit/push this reviewed audit revision to PR #4 as Draft so GitHub CI can verify the remaining cloud gates; that exception does not authorize merging, deployment, or changing a chapter to `ACCEPTED`.

### Additional cloud verification after dependency authorization

- Both Python runtimes were installed with their existing `uv.lock`, `uv sync --locked --no-dev`, Python 3.12.14. The document runtime passed **8/8** and the document Worker passed **12/12**, including its previously skipped real loopback conversion. No lockfile changed.
- The media runtime's original test helper sorted every bundled ffprobe platform and selected `darwin/arm64` on Linux. Its first run was **150 passed / 9 errors** (`Exec format error`), not a production Runtime failure. Test-only selection now follows `ffprobe-static@3.1.0/index.js`'s `bin/<platform>/<arch>` layout. The helper is shared by the three adapter fixtures that previously hard-coded Windows executables; production Runtime/media algorithms are unchanged.
- Final media runtime: **161/161**. Final four OpenMontage adapter test modules: **38/38**, including actual Linux FFmpeg/ffprobe media fixtures. Two added tests exercise eight platform/architecture path combinations and ensure a foreign bundled binary is never selected instead of the existing system-tool fallback. Windows/macOS paths are simulated, not claims of execution on those operating systems.
- Independent review passed for the six Python test/fixture files; the reviewer independently ran the two path tests plus all 38 adapter tests, verified missing tools fail in CI, and confirmed production media code and assertions were not weakened. These repeat runs are not added to the totals.
- These **207 Python tests** are separate from the Node table: combined local evidence is **1369 passed / 0 failed / 5 skipped**. The five remaining Node skips are MinIO-dependent, not Python runtime skips.

```sh
uv sync --project services/document-runtime --locked --no-dev
uv sync --project services/media-runtime --locked --no-dev
(cd services/document-runtime && .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v)
DOCUMENT_RUNTIME_PYTHON="$PWD/services/document-runtime/.venv/bin/python" \
  sh -c 'cd apps/document-worker && node --import tsx --test tests/*.test.ts'
(cd services/media-runtime && .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v)
(cd services/media-runtime && .venv/bin/python -m unittest \
  adapters.openmontage_audio.test_adapters adapters.openmontage_audio.test_doubao \
  adapters.openmontage_audio.test_hyperframes_audio adapters.openmontage_audio.test_segmented_music -v)
```

Logs: `/tmp/video-closure-document-runtime.log`, `/tmp/video-closure-document-worker-complete.log`, `/tmp/video-closure-media-runtime.log` (original failure), `/tmp/video-closure-media-runtime-final.log`, `/tmp/video-closure-media-adapters-final.log`.

Official Go 1.24.8 was checksum-verified and the repository's CI MinIO tag `RELEASE.2025-10-15T17-29-55Z` successfully built from source commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`. The locally built binary SHA-256 is `e6490f6521d480847e785c53c8f8b4830edc0813f8e10edec77758e18f6eb0a8`; it is not an upstream release-binary checksum. Running even `minio --version` exits 1 because its package initialization calls `net.Interfaces()` and this sandbox denies netlink (`netlinkrib: operation not permitted`). The identical supported `require_escalated` retry failed the same way. No server started, source was not patched, and no permission workaround was used. Full preparation evidence is in `/tmp/video-worker-services/MINIO_STATUS.txt`.

Playwright 1.62.0 was installed and actual Chromium 154.0.8037.57 startup attempted. Both ordinary execution and the identical supported elevated-tool retry failed at Chromium's local process singleton socket with `socket() failed: Operation not permitted`. Official BuildKit v0.34.0 also encountered a local UNIX-socket permission failure during ordinary rootless startup; that separate attempt was not repeated with elevated tool permissions. No daemon/system settings were changed. These are current cloud sandbox limits, not evidence that the user must run the tests on a local computer. The existing GitHub CI jobs remain the supported cloud route for MinIO, Chromium C06/C12, and the Docker image gates; they must run against the exact published audit commit before being reported as passed.

A separate production-only directory was rebuilt using pnpm 10.33.0's frozen/offline install (195 reused packages, no dependency downloads), followed by the Dockerfile's ffmpeg-static rebuild. The unchanged `/app` image verifier passed dependency/standalone import/forbidden-package checks but stopped on a media subprocess `EACCES` in the supported bwrap mapping; it is **not** a complete verifier or image PASS. The same media binaries directly reported FFmpeg 7.0.2 and ffprobe 4.0.2 in the ordinary allowed directory. Independently, the standalone Studio `.output` tree ran without workspace `node_modules`: its loopback homepage, emitted JavaScript and CSS each returned HTTP 200, and the owned server was stopped. This does not replace the Docker build and image smoke in CI.

### Still not accepted or run

- Four C06 Worker/MinIO integration tests and one MinIO browser CORS test remain skipped because the built MinIO cannot start under this sandbox's netlink restrictions. These **5 skips are not passes**. The new Worker combination uses actual PostgreSQL/Redis and an in-memory StoragePort for output objects. The earlier document-runtime skip is now closed by the actual loopback conversion.
- Full C06/C12 browser E2E, real signed-reference HEAD and browser upload/CORS, production Docker build, target-deployment MinIO version/least-privilege policy, VPS image/configuration, true Provider/usage/debit and end-to-end production generation were not revalidated.
- The documented deployment MinIO binary `RELEASE.2025-04-22T22-12-26Z` and its official checksum returned HTTP 410. The different fixed CI release was built as described above, but could not start. Neither version has been substituted into deployment or represented as runtime-tested here.
- A single configured worker is not a deployment-wide exclusivity proof. Before any authorized cutover, inventory every release/Compose/manual worker and in-flight POST, and enforce no old/new worker mixing. The new guard reduces concurrent execution races among upgraded workers; it is not approval for production horizontal scaling and does not guarantee exactly-once execution during arbitrary partitions.
- Legacy queued events with the same highest timestamp have no trustworthy order. The event-bound finalizer makes no mutation, emits `queue.controlled_recovery.required`, and retains the job in the existing dead-letter queue. Do not repeatedly replay that historical job or guess a random-ID order. Under the existing operational authorization, stop overlapping/old workers and run the controlled startup recovery path against the current TaskRun facts; it acquires execution ownership and resumes known IDs or fails closed on unknown reservations without choosing a historical callback generation. An active TaskRun cannot be repaired by the public explicit-retry route before this recovery establishes a terminal state. The PostgreSQL regression proves the supported no-ID/no-reservation case recovers once, and the existing reservation/restart tests prove unknown submissions remain blocked. No historical timestamps are backfilled.
- Final publication and chapter acceptance decisions remain separate from these scoped implementation reviews and test results. No merge/deploy/real Provider action is authorized by this record.
