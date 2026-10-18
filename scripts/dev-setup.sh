#!/usr/bin/env bash
# One-shot local environment for RestoMatch (Linux + macOS; Docker as fallback).
#
#   ./scripts/dev-setup.sh              # deps + Postgres(pgvector) + Redis + migrate + RLS + seed demo data
#   ./scripts/dev-setup.sh --no-seed    # everything except the demo data
#   ./scripts/dev-setup.sh --docker     # force the docker compose Postgres/Redis
#   DEMO_TODAY=2026-10-19 ./scripts/dev-setup.sh   # seed "today's" deliveries for another date
#
# Idempotent: safe to re-run (existing databases are migrated forward, the demo
# data is re-seeded, apps/web/.env.local is only written when missing).
#
# Postgres resolution order:
#   1. something already answers on localhost:5432 with postgres/postgres → use it
#   2. Linux with a local PostgreSQL install (apt) → start it, add pgvector
#   3. macOS with Homebrew PostgreSQL → brew services start, add pgvector
#   4. docker compose (pgvector/pgvector:pg16 + redis:7)
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=1
FORCE_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --no-seed) SEED=0 ;;
    --docker) FORCE_DOCKER=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PG_URL_BASE='postgres://postgres:postgres@localhost:5432'
DBS=(restomatch_test restomatch_dev)
OS="$(uname -s)"
PG_MODE=""

log()  { printf '\033[1;32m[dev-setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dev-setup]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[dev-setup]\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Run psql as the postgres superuser against the maintenance DB, whatever the mode.
psql_admin() {
  if [[ $PG_MODE == docker ]]; then
    docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
  else
    PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
  fi
}

pg_answers() {
  have psql && PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d postgres -qAtc 'select 1' >/dev/null 2>&1
}

wait_for_pg() {
  for _ in $(seq 1 30); do
    if [[ $PG_MODE == docker ]]; then
      docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && return 0
    else
      pg_answers && return 0
    fi
    sleep 1
  done
  die "Postgres did not become ready on localhost:5432 within 30s"
}

# Run a command as the OS 'postgres' user (Linux package installs use peer auth).
as_postgres() {
  if [[ $(id -u) -eq 0 ]]; then su postgres -c "$*"; else sudo -n -u postgres sh -c "$*"; fi
}

# ── 0. toolchain ────────────────────────────────────────────────────────────
have node || die "Node.js is required (>= 20; see .nvmrc)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
(( NODE_MAJOR >= 20 )) || die "Node.js >= 20 required (found $(node -v))"
if ! have pnpm; then
  log "enabling pnpm via corepack"
  corepack enable >/dev/null 2>&1 || npm i -g pnpm@10.33.0 >/dev/null
fi

log "installing workspace dependencies"
pnpm install --frozen-lockfile >/dev/null

# ── 1. Postgres ─────────────────────────────────────────────────────────────
if [[ $FORCE_DOCKER == 0 ]] && pg_answers; then
  PG_MODE=existing
  log "using the Postgres already running on localhost:5432"
elif [[ $FORCE_DOCKER == 0 && $OS == Linux ]] && { have pg_ctlcluster || ls /usr/lib/postgresql/*/bin/postgres >/dev/null 2>&1; }; then
  PG_MODE=linux
  PGV=$(ls /usr/lib/postgresql | sort -n | tail -1)
  if ! ls /usr/share/postgresql/*/extension/vector.control >/dev/null 2>&1 && have apt-get; then
    log "installing pgvector for PostgreSQL ${PGV}"
    (apt-get install -y "postgresql-${PGV}-pgvector" >/dev/null 2>&1 \
      || (apt-get update >/dev/null 2>&1 && apt-get install -y "postgresql-${PGV}-pgvector" >/dev/null 2>&1)) \
      || warn "could not install postgresql-${PGV}-pgvector (run it with sudo, then re-run this script)"
  fi
  log "starting local PostgreSQL ${PGV}"
  service postgresql start >/dev/null 2>&1 || pg_ctlcluster "${PGV}" main start >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do as_postgres "psql -qAtc 'select 1'" >/dev/null 2>&1 && break; sleep 1; done
  as_postgres "psql -qc \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null 2>&1 \
    || warn "could not set the postgres password (need root or passwordless sudo)"
elif [[ $FORCE_DOCKER == 0 && $OS == Darwin ]] && have brew && brew list --formula 2>/dev/null | grep -q '^postgresql@'; then
  PG_MODE=brew
  FORMULA=$(brew list --formula | grep '^postgresql@' | sort -V | tail -1)
  log "starting Homebrew ${FORMULA}"
  brew services start "${FORMULA}" >/dev/null 2>&1 || true
  brew list --formula | grep -q '^pgvector$' || { log "installing pgvector (brew)"; brew install pgvector >/dev/null; }
  for _ in $(seq 1 15); do psql -d postgres -qAtc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
  # Homebrew's superuser is the macOS user; add the postgres/postgres role the repo expects.
  psql -d postgres -qAtc "select 1 from pg_roles where rolname='postgres'" | grep -q 1 \
    || psql -d postgres -qc "CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres';"
  psql -d postgres -qc "ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';" >/dev/null
elif have docker; then
  PG_MODE=docker
  log "using docker compose (pgvector/pgvector:pg16 + redis:7)"
  docker compose up -d postgres redis >/dev/null
else
  die "no PostgreSQL found. Install one of: PostgreSQL 16 + pgvector (apt / brew), or Docker — then re-run."
fi
wait_for_pg

# `next dev` hot reloads (each keeps a postgres-js pool) + the serial test suite
# exhaust the default 100 connections ("sorry, too many clients already").
# max_connections needs a server restart; only done when the value is too low.
WANT_CONN=${PG_MAX_CONNECTIONS:-300}
HAVE_CONN=$(psql_admin -c "show max_connections")
if (( HAVE_CONN < WANT_CONN )); then
  log "raising Postgres max_connections ${HAVE_CONN} → ${WANT_CONN} (restart)"
  psql_admin -c "ALTER SYSTEM SET max_connections = ${WANT_CONN};"
  case "$PG_MODE" in
    docker) docker compose restart postgres >/dev/null ;;
    brew)   brew services restart "${FORMULA}" >/dev/null 2>&1 ;;
    *)
      if [[ $OS == Darwin ]] && have brew; then
        brew services restart "$(brew list --formula | grep '^postgresql@' | sort -V | tail -1)" >/dev/null 2>&1 || true
      else
        service postgresql restart >/dev/null 2>&1 \
          || pg_ctlcluster "$(ls /usr/lib/postgresql | sort -n | tail -1)" main restart >/dev/null 2>&1 \
          || warn "could not restart Postgres — restart it yourself for max_connections=${WANT_CONN} to apply"
      fi ;;
  esac
  wait_for_pg
fi

psql_admin -c "select 1 from pg_available_extensions where name = 'vector'" | grep -q 1 \
  || die "the pgvector extension is not installed for this PostgreSQL (apt: postgresql-16-pgvector, brew: pgvector) — or re-run with --docker"

for db in "${DBS[@]}"; do
  psql_admin -c "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
    || { log "creating database ${db}"; psql_admin -c "CREATE DATABASE ${db};"; }
done

# ── 2. Redis (optional for the web app; the worker and queue need it) ───────
if have redis-cli && redis-cli ping >/dev/null 2>&1; then
  :
elif have redis-server; then
  redis-server --daemonize yes >/dev/null
elif have docker && [[ $PG_MODE != docker ]]; then
  docker compose up -d redis >/dev/null 2>&1 || warn "redis not started (worker/queue features need it)"
elif [[ $PG_MODE != docker ]]; then
  warn "redis not found — the web app runs without it; the worker needs REDIS_URL"
fi

# ── 3. schema + RLS ─────────────────────────────────────────────────────────
for db in "${DBS[@]}"; do
  log "migrating ${db}"
  DATABASE_URL="${PG_URL_BASE}/${db}" pnpm --filter @restomatch/db migrate >/dev/null
  DATABASE_URL="${PG_URL_BASE}/${db}" pnpm --filter @restomatch/db provision-rls >/dev/null 2>&1 \
    || die "provision-rls failed on ${db} (run: DATABASE_URL=${PG_URL_BASE}/${db} pnpm --filter @restomatch/db provision-rls)"
done

# ── 4. demo data ────────────────────────────────────────────────────────────
if [[ $SEED == 1 ]]; then
  log "seeding demo data into restomatch_dev${DEMO_TODAY:+ (today = ${DEMO_TODAY})}"
  DATABASE_URL="${PG_URL_BASE}/restomatch_dev" pnpm --filter @restomatch/db seed | tail -3
  DATABASE_URL="${PG_URL_BASE}/restomatch_dev" pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts | tail -2
fi

# ── 5. apps/web/.env.local ──────────────────────────────────────────────────
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

# ── 6. health ───────────────────────────────────────────────────────────────
DATABASE_URL="${PG_URL_BASE}/restomatch_dev" pnpm --filter @restomatch/db run doctor >/dev/null 2>&1 \
  && log "db:doctor (restomatch_dev): no blocking problems" \
  || warn "db:doctor reports problems — run: DATABASE_URL=${PG_URL_BASE}/restomatch_dev pnpm db:doctor"

log "done. Run:  pnpm --filter @restomatch/web dev   → http://localhost:3000"
if [[ $SEED == 1 ]]; then
  log "demo logins: owner@ / manager@ / receiver@ (English) / bookkeeper@ / chef@kfar-hazeitim.test"
  log "password:    ${DEMO_PASSWORD:-RestoMatch-Demo-2026!}"
fi
log "tests:      DATABASE_URL_TEST=${PG_URL_BASE}/restomatch_test pnpm test"
