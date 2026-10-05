FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app /app

RUN useradd --system --uid 10001 --create-home app \
  && mkdir -p /app/data \
  && chown -R app:app /app
USER app

CMD ["node", "apps/control-api/dist/index.js"]
