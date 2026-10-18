# RestoMatch worker image.
#
# Build context MUST be the repo root (the worker depends on many workspace:*
# packages that resolve through the root pnpm workspace + lockfile). Deploy with:
#
#   fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
#
# The worker runs its TypeScript sources directly via tsx (no separate build
# step — the workspace packages export src/*.ts), so we install all deps
# (including devDeps for tsx) and start with `pnpm --filter @restomatch/worker start`.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="/pnpm:$PATH"
ENV CI=true
RUN corepack enable
WORKDIR /app

# Copy the whole workspace (node_modules excluded via .dockerignore) so pnpm can
# resolve every workspace package the worker imports.
COPY . .

# Frozen install pinned to pnpm@10.33.0 (packageManager field).
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# tsx runs src/index.ts; the health server (apps/worker/src/health.ts) listens on $PORT.
CMD ["pnpm", "--filter", "@restomatch/worker", "start"]
