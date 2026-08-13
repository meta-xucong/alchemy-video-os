# Upstream Migration Record

Source repository: https://github.com/chatfire-AI/huobao-drama.git
Source commit: f04d705603bd0257bcec6b8f44fd04ea3ea9b795

| Target file | Upstream file and symbol | Preserved structure | Platform adaptation | Regression test |
| --- | --- | --- | --- | --- |
| package.json | backend/package.json | Hono, @hono/node-server, dotenv, tsx scripts | Removed AI SDK, MySQL, FFmpeg, Sharp and provider dependencies; added the platform's C02 contracts/domain/persistence workspace packages and Zod | pnpm --filter @alchemy-video/control-api test |
| tsconfig.json | backend/tsconfig.json | ES module TypeScript compiler shape | Extends root base config and limits rootDir to src | pnpm --filter @alchemy-video/control-api typecheck |
| src/app.ts | backend/src/index.ts: app, Hono, cors, /api/v1/health | Hono app setup, local CORS, health route | C03 adds only public identity/workspace/project routes; short-drama routes, static files, Provider configuration and global business state remain excluded | tests/health.test.ts; tests/control-api.test.ts |
| src/middleware/logger.ts | backend/src/middleware/logger.ts: requestLogger, errorHandler | Middleware names and request timing pattern | Generates platform request IDs, logs no request body or credentials, and returns the platform-safe error envelope | tests/health.test.ts; tests/control-api.test.ts |
| src/index.ts | backend/src/index.ts: serve, PORT | Node Hono server startup | Uses CONTROL_API_PORT, loads the local database configuration, and constructs the isolated Drizzle-backed app | pnpm --filter @alchemy-video/control-api build |

## C03 adaptation

`src/identity.ts`, `src/repository.ts`, `src/serializers.ts` and `src/errors.ts` are thin platform adapters around the C02 contracts and persistence interfaces. Huobao's Hono route registration and middleware composition guided the route layout; no Huobao identity, MySQL query, short-drama model, mock state, Provider call, credential handling or external API call was migrated. The server runtime requires `DATABASE_URL` and imports the Drizzle ControlPlaneRepository; route tests use the same interface's in-memory implementation.
