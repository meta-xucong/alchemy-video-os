# Upstream Migration Record

## C05 Queue Transport

No specified upstream repository provides a BullMQ relay, persistent outbox lease or consumer-dedup implementation that is safe to migrate. This package is platform-owned infrastructure around BullMQ `6.1.0`.

`huobao-drama` contributes only the high-level separation between HTTP task creation and background execution, reviewed at `backend/src/services/generation.ts`. Its direct `processTask` invocation, Provider calls, in-process polling, MySQL state and global config are explicitly not migrated.

Each job carries the versioned `InternalTaskRunQueueMessage` from `@alchemy-video/contracts`: `event_id`, `workspace_id`, `task_run_id`, `attempt_no`, `correlation_id`, and the frozen `input_snapshot`. `event_id` is the BullMQ job id, while PostgreSQL remains the source of delivery and deduplication truth; the consuming ledger scopes that fact by `(workspace_id, event_id, consumer_name)`, not by Redis state or global event ID alone. The package never imports persistence, Provider, storage, browser, Veyra or credentials.
