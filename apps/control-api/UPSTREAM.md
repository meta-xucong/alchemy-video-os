# Upstream Migration Record

Source repository: https://github.com/chatfire-AI/huobao-drama.git
Source commit: f04d705603bd0257bcec6b8f44fd04ea3ea9b795

| Target file | Upstream file and symbol | Preserved structure | Platform adaptation | Regression test |
| --- | --- | --- | --- | --- |
| package.json | backend/package.json | Hono, @hono/node-server, dotenv, tsx scripts | Removed AI SDK, Drizzle, MySQL, FFmpeg, Sharp and provider dependencies; retained only C01 server dependencies | pnpm --filter @alchemy-video/control-api test |
| tsconfig.json | backend/tsconfig.json | ES module TypeScript compiler shape | Extends root base config and limits rootDir to src | pnpm --filter @alchemy-video/control-api typecheck |
| src/app.ts | backend/src/index.ts: app, Hono, cors, /api/v1/health | Hono app setup, local CORS, health route | Removed short-drama routes, static files, database and provider configuration; exposes only platform health | tests/health.test.ts |
| src/middleware/logger.ts | backend/src/middleware/logger.ts: requestLogger, errorHandler | Middleware names and request timing pattern | Does not read or log request bodies; returns a platform-safe error envelope | tests/health.test.ts |
| src/index.ts | backend/src/index.ts: serve, PORT | Node Hono server startup | Uses CONTROL_API_PORT and imports the isolated app module | pnpm --filter @alchemy-video/control-api build |

This C01 migration contains no database schema, business route, provider call, credential handling or external API call.
