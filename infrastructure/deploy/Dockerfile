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

# Re-link only locked production dependencies after the build has populated the
# pnpm store. Skip workspace hooks such as Studio's Nuxt prepare, then rebuild
# only provider-video's required ffmpeg-static binary dependency.
RUN CI=true pnpm install --prod --offline --frozen-lockfile --ignore-scripts \
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
