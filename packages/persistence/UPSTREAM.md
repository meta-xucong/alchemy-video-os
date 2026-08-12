# C02 source record

- Source repository: `chatfire-AI/huobao-drama`
- Fixed commit: `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`
- Source file: `backend/src/db/schema.ts`
- Reused approach: Drizzle table declarations with explicit primary keys and `createdAt`/`updatedAt` variables.
- Platform implementation: `src/schema.ts` uses PostgreSQL tables, workspace scopes, immutable task data and auditable outbox fields specified by the platform contract.
- Not migrated: MySQL dialect, `dramas`, `episodes`, `storyboards`, `sysTask`, AI configuration/API-key columns, local media paths and short-drama business state.
- Regression commands: `pnpm --filter @alchemy-video/persistence test`, `pnpm --filter @alchemy-video/persistence db:generate`
