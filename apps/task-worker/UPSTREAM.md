# Upstream Migration Record

## C05 Worker Boundary

Source reviewed: `huobao-drama` at `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`, `backend/src/services/generation.ts`.

Retained idea: task work must leave the HTTP command path.

Not migrated: `processTask`, Provider adapters, polling, local media handling, MySQL records, global configuration, API keys and short-drama state. C05's Worker only consumes durable internal events and atomically advances `TaskRun` from `QUEUED` to `RUNNING`; C06 owns ProviderAttempt and MockVideoProvider work.

The platform adaptation accepts only the versioned `InternalTaskRunQueueMessage` from `@alchemy-video/contracts` (`contract_version`, `event_id`, `workspace_id`, `task_run_id`, `attempt_no`, `correlation_id`, and frozen `input_snapshot`). `OutboxRelay` constructs it from a schema-validated `task_run.queued` row, BullMQ parses it at the worker boundary, and the persistence consumer treats the outbox/database workspace as authoritative. Its consumption ledger is keyed by `(workspace_id, event_id, consumer_name)` and database-enforced against the same outbox workspace. A job or payload workspace mismatch is retried without reading, completing or progressing another workspace's ledger or TaskRun.

## C06 Provider boundary

C06 adds `src/execution-service.ts`, which calls only `@alchemy-video/provider-video` and `@alchemy-video/storage-client`. The worker creates a temporary deterministic fixture at startup, persists ProviderAttempt before submit, and on repeated delivery uses the stored `provider_request_id` for status/download recovery. It never imports Huobao adapters or writes a browser-facing object key.

## C09-C SUB2API runtime composition

Source reviewed: C08's local `tools/sub2api-video-certifier/src/live-transport.ts`, which is a platform-owned, injected HTTPS transport built on the C07 `Sub2ApiTransport` boundary. No external source code was copied in this subphase.

`src/sub2api-https-transport.ts` retains only its safe base-URL, path-prefix and stream/JSON transport structure. `src/provider-runtime.ts` selects Mock by default and composes `Sub2ApiVideoProvider` only when the Worker process explicitly uses `VIDEO_PROVIDER=sub2api`. The Worker is the sole application process allowed to read `SUB2API_VIDEO_BASE_URL` and `SUB2API_VIDEO_API_KEY`; Control API and Studio never load those values. The runtime profile is limited to the C08-certified text-only input and is covered by injected-fake transport tests, so no real Provider call is made during normal test runs.
## Durable submission reservation (2026-10-10)

- Existing platform source: commit `44da8428d2c1b73648eb1616cd0350dac798eba8`, `tools/sub2api-video-certifier/src/recovery-state.ts::reserveSubmission` and `src/certifier.ts::runCertification`.
- Preserved order: atomically reserve before POST; keep the reservation after a lost response, interrupted process, or failed request-ID write; resume known request IDs with GET only.
- Thin-shell adaptation: the Worker uses a workspace-scoped TaskRun transaction and nullable `provider_attempts.submission_reserved_at` instead of the certifier's exclusive local file. Unknown submissions fail closed, including explicit task/production-segment retry; projection cannot turn an unknown rejection into a fresh generation. No Provider idempotency field/header, lookup protocol, or guessed upstream outcome is added.
- Migration safety: existing attempts without request IDs are conservatively reserved because the old CREATED/FAILED status cannot prove that POST was never sent. Deploy the migration with old Workers stopped; mixed-version Workers are unsupported.
- A late submit response still records its request ID even if a duplicate delivery already failed closed. Learning that ID does not enable a fresh segment generation; recover the original TaskRun through its existing explicit retry/poll path. No automated reconciliation or new public reconciliation endpoint is introduced.
- Regression coverage: `tests/submission-reservation.test.ts` exercises the real executor, SUB2API adapter and HTTPS transport with an injected offline fetcher, response loss, request-ID persistence failure, restart, interruption, duplicate execution, terminal/cancelled tasks, and known-ID recovery. Persistence integration tests cover transaction exclusivity and retry blocking.

## Execution ownership and retry closure (2026-10-12)

- Platform source: `2c614c508de4b597fa9f69b21ace2499ee38f231`, C05 consumer, C06 executor and both TaskRun repositories. No media/creative/Provider algorithm is changed.
- A dedicated PostgreSQL connection holds a two-integer session advisory lock for workspace/TaskRun execution and finalization. Its key space is separate from the existing one-bigint transaction lock. This is private execution exclusion, not a time-based lease or a Provider idempotency protocol.
- BullMQ 6.1.0's `Job.moveToDelayed(..., token)` and `DelayedError` preserve busy deliveries without exhausting normal failure attempts. Terminal persistence is awaited before ordinary job failure; BullMQ's processor-bypassing stalled failure retains guarded finalization and durable job recovery. Shutdown awaits outstanding terminal handlers.
- Historical terminal attempts remain unchanged when a new attempt has not been created. Migrated abandoned no-ID reservations still produce `PROVIDER_SUBMISSION_UNKNOWN` without rewriting their history.
- Sources: [PostgreSQL advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS), installed `pg@8.23.0` Client connection/query timeout behavior, and installed `bullmq@6.1.0` Job/Worker implementation. No upstream code is copied.
- Regression: `execution-closure.integration.test.ts` uses PostgreSQL, Redis/BullMQ, the actual consumer/repositories/executor and MockProvider. It covers held POST, repeated busy delivery followed by owner failure, terminal-history retries, guard disconnect, query-pool capacity, bounded unlock cleanup and startup reacquisition. This does not authorize old-worker mixing, production scaling, deployment, or real Provider calls.
