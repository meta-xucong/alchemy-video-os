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

## C04 adaptation

`src/asset-repository.ts`, the C04 routes in `src/app.ts`, and `tests/c04-http-e2e.mjs` preserve only Huobao's Hono command-route organization and its frontend-facing upload interaction sequence. The platform owns all object keys, idempotency snapshots, workspace scopes and PostgreSQL transactions. No Huobao short-drama tables, local media paths, process-local polling, provider invocation, API key or request global state was migrated.

The C04 E2E supervisor starts direct, one-shot API `tsx` and Studio Nitro Node processes with explicit local mock environment values, refuses occupied local ports, and removes only its child process trees, test project and test object in `finally`. It never invokes the long-lived `tsx watch` development command. `tests/c04-studio-ui-e2e.py` uses the already installed local Playwright test tool only as an E2E harness: it creates a project through Studio, uploads the inlined valid 1x1 PNG with the browser file-input API, refreshes, and asserts Preview image dimensions. The harness removes its fixture and screenshot in the enclosing Node supervisor's `finally`; neither is a product/runtime dependency. Regression commands: `pnpm --filter @alchemy-video/control-api test`, `pnpm --filter @alchemy-video/control-api test:e2e`, and `pnpm --filter @alchemy-video/control-api test:studio-ui-e2e`.
