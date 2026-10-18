#!/usr/bin/env bash
# One-shot local environment for RestoMatch (Linux/macOS, no Docker required).
#
#   ./scripts/dev-setup.sh          # deps + Postgres(pgvector) + Redis + migrate + seed demo data
#   ./scripts/dev-setup.sh --no-seed
#
# Idempotent: safe to re-run. Uses docker compose when Postgres/Redis aren't
# installed locally. Writes apps/web/.env.local (gitignored) for `pnpm dev`.
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=1
[[ "${1:-}" == "--no-seed" ]] && SEED=0
PG_URL_BASE='postgres://postgres:postgres@localhost:5432'

log() { printf '\033[1;32m[dev-setup]\033[0m %s\n' "$*"; }

log "installing workspace dependencies"
pnpm install --frozen-lockfile >/dev/null

if command -v pg_ctlcluster >/dev/null 2>&1 || command -v pg_ctl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1 && ! ls /usr/share/postgresql/*/extension/vector.control >/dev/null 2>&1; then
    log "installing pgvector"
    PGV=$(ls /usr/lib/postgresql | sort -n | tail -1)
    (apt-get install -y "postgresql-${PGV}-pgvector" >/dev/null 2>&1 || (apt-get update >/dev/null && apt-get install -y "postgresql-${PGV}-pgvector" >/dev/null))
  fi
  log "starting local Postgres"
  (service postgresql start >/dev/null 2>&1 || true)
  sleep 2
  su postgres -c "psql -qc \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null 2>&1 || true
  for db in restomatch_test restomatch_dev; do
    su postgres -c "psql -qtc \"SELECT 1 FROM pg_database WHERE datname='${db}'\"" | grep -q 1 \
      || su postgres -c "psql -qc 'CREATE DATABASE ${db};'"
  done
else
  log "no local Postgres — using docker compose"
  docker compose up -d postgres redis
  sleep 5
  for db in restomatch_test restomatch_dev; do
    docker compose exec -T postgres psql -U postgres -qtc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
      || docker compose exec -T postgres psql -U postgres -qc "CREATE DATABASE ${db};"
  done
fi

if command -v redis-server >/dev/null 2>&1; then
  redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null
fi

for db in restomatch_test restomatch_dev; do
  log "migrating ${db}"
  DATABASE_URL="${PG_URL_BASE}/${db}" pnpm --filter @restomatch/db migrate >/dev/null
  DATABASE_URL="${PG_URL_BASE}/${db}" pnpm --filter @restomatch/db provision-rls >/dev/null 2>&1
done

if [[ $SEED == 1 ]]; then
  log "seeding demo data into restomatch_dev"
  DATABASE_URL="${PG_URL_BASE}/restomatch_dev" pnpm --filter @restomatch/db seed >/dev/null
  DATABASE_URL="${PG_URL_BASE}/restomatch_dev" pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts | tail -1
fi

if [[ ! -f apps/web/.env.local ]]; then
  log "writing apps/web/.env.local"
  APP_URL_LINE=$(DATABASE_URL="${PG_URL_BASE}/restomatch_dev" pnpm --filter @restomatch/db provision-rls --print-app-url 2>&1 | grep -o 'postgres://restomatch_app[^ ]*' | tail -1)
  cat > apps/web/.env.local <<ENV
DATABASE_URL=${PG_URL_BASE}/restomatch_dev
DATABASE_URL_APP=${APP_URL_LINE}
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_URL=http://localhost:3000
APP_URL=http://localhost:3000
AUTH_ENC_KEY=$(openssl rand -hex 32)
MAGIC_LINK_FILE=/tmp/restomatch-magic-link.json
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_ENABLE_SCAN_MOCKS=1
ENV
fi

log "done. Run:  pnpm --filter @restomatch/web dev   → http://localhost:3000"
log "tests:      DATABASE_URL_TEST=${PG_URL_BASE}/restomatch_test pnpm test"
