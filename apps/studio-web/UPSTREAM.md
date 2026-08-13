# Upstream Migration Record

Source repository: https://github.com/chatfire-AI/huobao-drama.git
Source commit: f04d705603bd0257bcec6b8f44fd04ea3ea9b795

| Target file | Upstream file and symbol | Preserved structure | Platform adaptation | Regression test |
| --- | --- | --- | --- | --- |
| package.json | frontend/package.json | Nuxt 3, Vue, Vue Router, lucide-vue-next, Nuxt scripts | Removed short-drama name and unused toast dependency; changed package identity and local port; added vue-tsc because Nuxt typecheck requires it, and direct `h3` because the platform's Nitro route handler uses its stable server API. C01 `dev` invokes the platform local Nitro launcher because this Windows/Node 24 runtime leaves `nuxt dev` HTTP requests hanging after it listens. | pnpm --filter @alchemy-video/studio-web test; pnpm --filter @alchemy-video/studio-web typecheck; pnpm dev + curl --noproxy "*" |
| scripts/serve-local.mjs | None; platform C01 runtime adapter | None | Rebuilds the existing Nuxt project, then starts the Nuxt/Nitro Node server at the documented `127.0.0.1:3031`. It replaces only the unusable local dev process contract; it does not alter Nuxt pages, the `/api/v1` proxy configuration, routes or upstream business state. | pnpm dev + curl --noproxy "*" |
| nuxt.config.ts, app/server/routes/api/v1/[...path].ts, app/server/utils/control-api-proxy.mjs | frontend/nuxt.config.ts: defineNuxtConfig, srcDir, ssr, vite.server.proxy | app source directory, SPA mode, dev proxy structure | Vite uses the startup origin for development; Nitro uses a platform runtime-only `/api/v1/**` handler under the configured `app/` source directory. The handler reads `CONTROL_API_ORIGIN` from the Studio process at request time, then falls back to Nuxt runtime config and the local default. It never exposes the origin to the browser. Removed short-drama dynamic routes and static build-time proxy. | tests/base.test.mjs; tests/runtime-proxy.test.mjs; pnpm --filter @alchemy-video/studio-web build |
| app/app.vue | frontend/app/app.vue | NuxtLayout and NuxtPage composition | Removed upstream toast runtime and imports not needed for the C01 health surface | pnpm --filter @alchemy-video/studio-web typecheck |
| app/composables/useControlApi.ts | frontend/app/composables/useApi.ts: req, api | A single composable owns browser-to-API calls | Uses Nuxt $fetch for the C03 public health, identity, workspace, and project endpoints; no short-drama endpoint groups, credentials or provider fields | tests/base.test.mjs |
| app/layouts/default.vue, app/pages/index.vue, app/assets/studio.css | frontend/app/layouts/default.vue, frontend/app/assets/studio.css | Compact application shell, local status surface, lucide icon usage | Replaced branding, configuration banner, short-drama navigation and business UI with a C03 public identity and project surface | tests/base.test.mjs |

No upstream image, media binary, provider setting, local static path or AI key management screen was copied.
