FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build

FROM build AS production-dependencies

ENV NODE_ENV=production

# Remove build-stage links and pnpm's virtual store from the image layer before
# recreating the production-only workspace tree. The pnpm package store lives
# outside /app, so the locked install can reuse downloaded packages offline.
# Skip workspace hooks such as Studio's Nuxt prepare, then rebuild only the
# provider-video ffmpeg binary required at runtime.
RUN find /app -type d -name node_modules -prune -exec rm -rf {} + \
  && CI=true pnpm install --prod --offline --frozen-lockfile --ignore-scripts \
  && pnpm --filter @alchemy-video/provider-video rebuild ffmpeg-static

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app /app

RUN node tools/ci/verify-production-image.mjs

RUN useradd --system --uid 10001 --create-home app \
  && mkdir -p /app/data \
  && chown -R app:app /app
USER app

CMD ["node", "apps/control-api/dist/index.js"]
