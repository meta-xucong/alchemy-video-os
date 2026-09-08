FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
# Keep the focused runtime rebuild sensitive to source files that are updated
# during a live provider/continuity rollout, even when the broad workspace
# COPY layer remains cached on the VPS.
COPY packages/creative-planning/src/index.ts ./packages/creative-planning/src/index.ts
COPY apps/workflow-worker/src/execution-service.ts ./apps/workflow-worker/src/execution-service.ts

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app /app

CMD ["node", "apps/control-api/dist/index.js"]
