# Upstream Migration Record

## C05 Worker Boundary

Source reviewed: `huobao-drama` at `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`, `backend/src/services/generation.ts`.

Retained idea: task work must leave the HTTP command path.

Not migrated: `processTask`, Provider adapters, polling, local media handling, MySQL records, global configuration, API keys and short-drama state. C05's Worker only consumes durable internal events and atomically advances `TaskRun` from `QUEUED` to `RUNNING`; C06 owns ProviderAttempt and MockVideoProvider work.

The platform adaptation accepts only the versioned `InternalTaskRunQueueMessage` from `@alchemy-video/contracts` (`contract_version`, `event_id`, `workspace_id`, `task_run_id`, `attempt_no`, `correlation_id`, and frozen `input_snapshot`). `OutboxRelay` constructs it from a schema-validated `task_run.queued` row, BullMQ parses it at the worker boundary, and the persistence consumer treats the outbox/database workspace as authoritative. Its consumption ledger is keyed by `(workspace_id, event_id, consumer_name)` and database-enforced against the same outbox workspace. A job or payload workspace mismatch is retried without reading, completing or progressing another workspace's ledger or TaskRun.

## C06 Provider boundary

C06 adds `src/execution-service.ts`, which calls only `@alchemy-video/provider-video` and `@alchemy-video/storage-client`. The worker creates a temporary deterministic fixture at startup, persists ProviderAttempt before submit, and on repeated delivery uses the stored `provider_request_id` for status/download recovery. It never imports Huobao adapters, reads a Provider key, calls an external URL, or writes a browser-facing object key.
