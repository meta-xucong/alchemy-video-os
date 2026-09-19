# C02-C03 source record

- Source repository: `chatfire-AI/huobao-drama`
- Fixed commit: `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`
- Source file: `backend/src/db/schema.ts`
- Reused approach: Drizzle table declarations with explicit primary keys and `createdAt`/`updatedAt` variables.
- Platform implementation: `src/schema.ts` uses PostgreSQL tables, workspace scopes, immutable task data and auditable outbox fields specified by the platform contract.
- Not migrated: MySQL dialect, `dramas`, `episodes`, `storyboards`, `sysTask`, AI configuration/API-key columns, local media paths and short-drama business state.
- Regression commands: `pnpm --filter @alchemy-video/persistence test`, `pnpm --filter @alchemy-video/persistence db:generate`

## C03 control-plane repository

- Source repository: `chatfire-AI/huobao-drama`
- Fixed commit: `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`
- Source file and symbols: `backend/src/db/schema.ts`, Drizzle query and transaction conventions.
- Reused approach: typed Drizzle repositories keep database access outside Hono route handlers.
- Platform implementation: `src/control-plane-repository.ts` provides Dev identity seeding, membership-scoped project queries, and transactional `command_deduplications` reservation/replay for C03 project commands.
- Not migrated: Huobao's MySQL tables, short-drama business models, API-key columns, global request state, in-process polling and Provider calls.
- Regression commands: `pnpm --filter @alchemy-video/persistence typecheck`, `pnpm --filter @alchemy-video/control-api test`.

## C04 Asset workspace repository

- Source repositories: `chatfire-AI/huobao-drama` at `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`, and `calesthio/OpenMontage` at `4eab34c5cfcccaa4f1970554928feccce73ee930`.
- Source conventions: Huobao's typed Drizzle repository/transaction separation; OpenMontage's explicit Artifact technical metadata and contract-test gate.
- Platform implementation: `src/asset-workspace-repository.ts` scopes every Asset, Shot and ReferenceBinding query by workspace, uses platform `command_deduplications` snapshots for success and terminal business failures, and serializes same-project shot positions before retaining the PostgreSQL unique index as the final concurrent-write guard.
- Not migrated: Huobao MySQL tables, drama/material globals and local paths; OpenMontage project directories, `events.jsonl`, Backlot, Python tools, provider data and file-system authority.
- Regression commands: `DATABASE_URL=... pnpm --filter @alchemy-video/persistence test`, `pnpm --filter @alchemy-video/control-api test`, and `pnpm --filter @alchemy-video/control-api test:e2e`.

## C05 TaskRun and durable delivery repository

- Source repository: `chatfire-AI/huobao-drama` at `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`.
- Source file and symbol: `backend/src/services/generation.ts`, `createTask` followed by `processTask`.
- Reused approach: only the separation of a request-time task record from later background work.
- Platform implementation: `src/task-run-repository.ts` writes TaskRun, command snapshot and `task_run.queued` outbox facts atomically; it scopes all direct event and TaskRun reads by the database outbox `workspace_id`, persists relay/consumer leases, and appends `task_run.started` as a separate transactionally durable event. `event_consumptions` persists the same `workspace_id` and uses `(workspace_id, event_id, consumer_name)` plus a composite `(event_id, workspace_id)` outbox foreign key; insert, read, stale-lease reclaim, completion and dead-letter all carry that range. Before creating a ledger row, it validates the versioned `InternalTaskRunQueueMessage` against the outbox row and its envelope (`event_id`, `workspace_id`, `task_run_id`, `correlation_id`, and frozen `input_snapshot`); mismatches return `RETRY` without advancing the TaskRun or completing consumption.
- Not migrated: Huobao direct HTTP handler/`processTask`, MySQL rows, Provider adapters, polling, local files, global state, media assets, credentials and short-drama models. No specified upstream supplied a safe reusable outbox, BullMQ, lease or dead-letter implementation.
- Regression commands: `DATABASE_URL=... pnpm --filter @alchemy-video/persistence test`, `DATABASE_URL=... REDIS_URL=... pnpm --filter @alchemy-video/task-worker test`, and `DATABASE_URL=... pnpm --filter @alchemy-video/control-api test`.
