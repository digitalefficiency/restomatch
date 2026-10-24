# RestoMatch worker image (Postgres job-queue consumers + cron + /health).
#
# Build context MUST be the repo root (the worker depends on many workspace:*
# packages that resolve through the root pnpm workspace + lockfile):
#
#   docker build -f apps/worker/Dockerfile -t restomatch-worker .
#   docker run --rm -p 8080:8080 --env-file worker.env restomatch-worker
#   fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
#
# The worker runs its TypeScript sources directly via tsx (the workspace
# packages export src/*.ts — there is no build step), so tsx is a runtime dep.
#
# Behind a TLS-intercepting proxy, pass its CA as a BuildKit secret:
#   docker build --secret id=ca,src=/path/to/ca.crt --build-arg HTTPS_PROXY ...

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# 1) pnpm itself, pinned to the root packageManager version.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    corepack enable && corepack prepare pnpm@10.33.0 --activate

# 2) Download every package from the lockfile alone — this layer is cached until
#    pnpm-lock.yaml changes, so code-only changes rebuild in seconds.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm fetch --frozen-lockfile

# 3) Sources (node_modules, .next, apps/mobile, apps/web excluded via
#    .dockerignore), then an offline install of ONLY the worker and its
#    workspace dependencies — no Next.js/Expo trees in the image.
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter '@restomatch/worker...' \
    && if find /app -name '.env' -o -name '*.env' -o -name '.env.*' | grep -v '.env.example' | grep -q .; then \
         echo 'refusing to build: an env file is in the build context' >&2; exit 1; fi

# 4) Runtime stage: just /app (sources + the worker's node_modules). The pnpm
#    store and the web/mobile packages fetched above stay in the build stage.
FROM node:22-slim
WORKDIR /app
# Root-owned + read-only for the app user: the process cannot rewrite its own
# code (QA D9). devDependencies stay because tsx (the runtime loader) is one.
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080
USER node
WORKDIR /app/apps/worker

# node is PID 1 (no pnpm wrapper), so SIGTERM from the platform reaches the
# graceful shutdown in src/index.ts (close workers, stop heartbeat).
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
