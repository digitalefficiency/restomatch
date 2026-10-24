#!/usr/bin/env bash
# RestoMatch — the demo on THIS machine, no cloud (docs/client-ready/DEMO-LOCAL.md).
#
#   scripts/demo-local.sh          # set up + seed + build + start → http://localhost:3000
#   scripts/demo-local.sh stop     # stop the web app and the worker
#   scripts/demo-local.sh status   # what is running
#
# What "start" does, in order:
#   1. Postgres 16 + pgvector on localhost:5432 — an already-running one, else
#      Docker (docker-compose.yml), else Homebrew postgresql@16 + pgvector;
#      Redis on localhost:6379 the same way (the worker's job queue);
#   2. (re)creates the database restomatch_demo_local and seeds it exactly like
#      the production demo reseed, with DEMO_TODAY=2026-10-25: migrate,
#      provision-rls, seed, seed-demo, seed:chain-demo (+ any other seed:*-demo);
#   3. builds the web app (only when the code changed since the last build);
#   4. starts `next start` on :3000 and the worker. The local OCR stub reads the
#      photographed invoice from the order, so receiving works offline.
#
# Nothing leaves this machine: no Supabase, no Vercel, no email/WhatsApp/payments
# (none of their keys are set). Login is email + password (printed at the end).
# Works with the macOS system bash (3.2).
set -eo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.demo-local"
WEB="$ROOT/apps/web"
DB_NAME="${DEMO_DB_NAME:-restomatch_demo_local}"
PG_BASE="${DEMO_PG_BASE:-postgres://postgres:postgres@localhost:5432}"
DB_URL="$PG_BASE/$DB_NAME"
REDIS_URL_LOCAL="${DEMO_REDIS_URL:-redis://localhost:6379}"
PORT="${DEMO_PORT:-3000}"
WORKER_PORT="${DEMO_WORKER_PORT:-8787}"
export DEMO_TODAY="${DEMO_TODAY:-2026-10-25}"
DEMO_PASSWORD_SHOWN="${DEMO_PASSWORD:-RestoMatch-Demo-2026!}"
OS="$(uname -s)"
mkdir -p "$STATE"

log()  { printf '\033[1;32m[demo-local]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[demo-local]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[demo-local]\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── stop / status ────────────────────────────────────────────────────────────
stop_all() {
  for name in web worker; do
    f="$STATE/$name.pgid"
    if [ -f "$f" ]; then
      g="$(cat "$f")"
      if kill -0 "$g" 2>/dev/null; then
        kill -TERM -- "-$g" 2>/dev/null || kill -TERM "$g" 2>/dev/null || true
        log "stopped $name"
      fi
      rm -f "$f"
    fi
  done
}
status_all() {
  for name in web worker; do
    f="$STATE/$name.pgid"
    if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then echo "$name: running (log $STATE/$name.log)"; else echo "$name: stopped"; fi
  done
  curl -sf "http://localhost:$PORT/api/healthz" >/dev/null && echo "http://localhost:$PORT is up" || echo "http://localhost:$PORT is not answering"
}
case "${1:-start}" in
  stop) stop_all; exit 0 ;;
  status) status_all; exit 0 ;;
  start) ;;
  *) die "usage: $0 [start|stop|status]" ;;
esac

# ── 0. toolchain ─────────────────────────────────────────────────────────────
have node || die "Node.js 22 is required (brew install node@22)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js >= 20 required (found $(node -v))"
if ! have pnpm; then
  log "enabling pnpm via corepack"
  corepack enable >/dev/null 2>&1 || npm i -g pnpm@10.33.0 >/dev/null
fi
have curl || die "curl is required"
cd "$ROOT"
stop_all # a previous run's web/worker would hold the ports and the DB
log "installing dependencies (pnpm install)"
pnpm install --frozen-lockfile >"$STATE/install.log" 2>&1 || die "pnpm install failed — see $STATE/install.log"

# ── 1. Postgres + Redis ──────────────────────────────────────────────────────
# Node + the repo's postgres driver: works whatever psql is (or isn't) installed.
pg_q() { # <url> <sql> → prints the first column of the first row, exit 1 on error
  (cd "$ROOT/packages/db" && node -e '
    const postgres = require("postgres");
    const sql = postgres(process.argv[1], { max: 1, onnotice: () => {}, connect_timeout: 3 });
    sql.unsafe(process.argv[2]).then((r) => { const row = r[0]; console.log(row ? Object.values(row)[0] : ""); return sql.end(); })
      .catch((e) => { console.error(e.message); sql.end().finally(() => process.exit(1)); });
  ' "$1" "$2")
}
pg_ok() { pg_q "$PG_BASE/postgres" 'select 1' >/dev/null 2>&1; }
docker_ok() { have docker && docker info >/dev/null 2>&1; }
wait_pg() { for _ in $(seq 1 60); do pg_ok && return 0; sleep 1; done; return 1; }

PG_MODE=""
if pg_ok; then
  PG_MODE=existing
  log "Postgres: using the one already running on localhost:5432"
elif docker_ok; then
  PG_MODE=docker
  log "Postgres: starting Docker (pgvector/pgvector:pg16) — first time downloads the image"
  docker compose up -d postgres redis >"$STATE/docker.log" 2>&1 || die "docker compose up failed — see $STATE/docker.log"
  wait_pg || die "Postgres (Docker) did not answer on localhost:5432 within 60 s"
elif [ "$OS" = Darwin ] && have brew; then
  PG_MODE=brew
  if ! brew list --formula 2>/dev/null | grep -q '^postgresql@16$'; then
    log "Postgres: installing postgresql@16 + pgvector with Homebrew (one time, a few minutes)"
    brew install postgresql@16 pgvector >"$STATE/brew.log" 2>&1 || die "brew install failed — see $STATE/brew.log"
  fi
  brew list --formula | grep -q '^pgvector$' || brew install pgvector >>"$STATE/brew.log" 2>&1
  log "Postgres: starting Homebrew postgresql@16"
  brew services start postgresql@16 >/dev/null 2>&1 || true
  PSQL="$(brew --prefix postgresql@16)/bin/psql"
  for _ in $(seq 1 30); do "$PSQL" -d postgres -qAtc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
  # Homebrew's superuser is the macOS user; add the postgres/postgres role the repo expects.
  "$PSQL" -d postgres -qAtc "select 1 from pg_roles where rolname='postgres'" | grep -q 1 \
    || "$PSQL" -d postgres -qc "CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres';"
  "$PSQL" -d postgres -qc "ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';" >/dev/null
  wait_pg || die "Homebrew Postgres did not answer as postgres/postgres on localhost:5432"
else
  die "No Postgres found. Install ONE of these, then re-run:
   • Docker Desktop (https://www.docker.com/products/docker-desktop) — and open it once, or
   • Homebrew (https://brew.sh), then: brew install postgresql@16 pgvector"
fi
[ "$(pg_q "$PG_BASE/postgres" "select count(*) from pg_available_extensions where name = 'vector'")" = "1" ] \
  || die "this Postgres has no pgvector extension (brew install pgvector, or quit it and use Docker)"

redis_ok() { (cd "$ROOT/packages/queue" && node -e '
  const Redis = require("ioredis");
  const r = new Redis(process.argv[1], { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  r.connect().then(() => r.ping()).then(() => { r.disconnect(); process.exit(0); }).catch(() => process.exit(1));
' "$REDIS_URL_LOCAL") >/dev/null 2>&1; }
if redis_ok; then
  log "Redis: using the one on localhost:6379"
elif docker_ok; then
  docker compose up -d redis >>"$STATE/docker.log" 2>&1 || true
elif have redis-server; then
  redis-server --daemonize yes --save "" >/dev/null
elif [ "$OS" = Darwin ] && have brew; then
  log "Redis: installing with Homebrew (one time)"
  brew install redis >>"$STATE/brew.log" 2>&1 && brew services start redis >/dev/null 2>&1 || true
fi
for _ in $(seq 1 20); do redis_ok && break; sleep 1; done
redis_ok || die "Redis is not answering on localhost:6379 (Docker: docker compose up -d redis · Homebrew: brew install redis && brew services start redis)"

# ── 2. database + demo data ──────────────────────────────────────────────────
log "database: (re)creating $DB_NAME and seeding the demo (DEMO_TODAY=$DEMO_TODAY, ~1 min)"
pg_q "$PG_BASE/postgres" "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB_NAME' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
pg_q "$PG_BASE/postgres" "drop database if exists \"$DB_NAME\"" >/dev/null
pg_q "$PG_BASE/postgres" "create database \"$DB_NAME\"" >/dev/null
SEEDLOG="$STATE/seed.log"
: >"$SEEDLOG"
export DATABASE_URL="$DB_URL"
pnpm --filter @restomatch/db migrate >>"$SEEDLOG" 2>&1 || die "migrate failed — see $SEEDLOG"
APP_DB_URL="$(pnpm --filter @restomatch/db provision-rls --print-app-url 2>>"$SEEDLOG" | grep -oE 'DATABASE_URL_APP=[^ ]+' | tail -1 | cut -d= -f2-)"
[ -n "$APP_DB_URL" ] || die "provision-rls did not print the app-role URL — see $SEEDLOG"
pnpm --filter @restomatch/db seed >>"$SEEDLOG" 2>&1 || die "seed failed — see $SEEDLOG"
pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts >>"$SEEDLOG" 2>&1 || die "seed-demo failed — see $SEEDLOG"
pnpm --filter @restomatch/worker seed:chain-demo >>"$SEEDLOG" 2>&1 || die "seed:chain-demo failed — see $SEEDLOG"
# Any further demo seeds (recipes, contracts, …) as they land: seed:<name>-demo in apps/worker or packages/db.
for pkg in apps/worker packages/db; do
  for s in $(node -e 'const p=require(process.argv[1]); console.log(Object.keys(p.scripts||{}).filter(k=>/^seed:.+-demo$/.test(k)&&k!=="seed:chain-demo").join(" "))' "$ROOT/$pkg/package.json"); do
    log "  + $s"
    pnpm --dir "$pkg" run "$s" >>"$SEEDLOG" 2>&1 || die "$s failed — see $SEEDLOG"
  done
done
grep -E '^\[seed-demo\] dashboard hero|^\[seed-chain-demo\]' "$SEEDLOG" | sed 's/^/             /' || true

# ── 3. build (only when the code changed) ────────────────────────────────────
# Secrets for THIS machine only, generated once.
if [ ! -f "$STATE/secrets.env" ]; then
  {
    echo "AUTH_SECRET=$(openssl rand -hex 32)"
    echo "AUTH_ENC_KEY=$(openssl rand -hex 32)"
  } >"$STATE/secrets.env"
fi
# shellcheck disable=SC1091
. "$STATE/secrets.env"
SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)-$(git diff HEAD -- apps packages 2>/dev/null | git hash-object --stdin | cut -c1-12)"
if [ ! -f "$WEB/.next/BUILD_ID" ] || [ "$(cat "$STATE/build.sha" 2>/dev/null)" != "$SHA" ] || [ "${DEMO_REBUILD:-0}" = 1 ]; then
  log "building the web app (3–6 min the first time; skipped next time if the code is unchanged)"
  (cd "$WEB" && env DATABASE_URL="$DB_URL" DATABASE_URL_APP="$APP_DB_URL" AUTH_SECRET="$AUTH_SECRET" AUTH_ENC_KEY="$AUTH_ENC_KEY" \
    AUTH_URL="http://localhost:$PORT" APP_URL="http://localhost:$PORT" REDIS_URL="$REDIS_URL_LOCAL" \
    NEXT_PUBLIC_SUPABASE_URL=https://local-demo-placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-demo-placeholder \
    NEXT_TELEMETRY_DISABLED=1 pnpm exec next build) >"$STATE/build.log" 2>&1 || die "build failed — see $STATE/build.log"
  echo "$SHA" >"$STATE/build.sha"
else
  log "build: up to date"
fi

# ── 4. start ─────────────────────────────────────────────────────────────────
port_busy() { curl -s -o /dev/null "http://localhost:$1" 2>/dev/null; }
port_busy "$PORT" && die "port $PORT is already in use — stop that app (or run with DEMO_PORT=3001)"
SCANS="$STATE/scans"
mkdir -p "$SCANS"
# The production build, served with NODE_ENV=development at runtime: that is what
# switches on the local OCR stub and local scan storage (both refuse production).
start_bg() { # name, then the command
  local name="$1"; shift
  set -m
  nohup "$@" >"$STATE/$name.log" 2>&1 </dev/null &
  echo $! >"$STATE/$name.pgid"
  set +m
}
COMMON_ENV="DATABASE_URL=$DB_URL DATABASE_URL_APP=$APP_DB_URL REDIS_URL=$REDIS_URL_LOCAL NODE_ENV=development LOCAL_SCAN_DIR=$SCANS NEXT_TELEMETRY_DISABLED=1"
start_bg web bash -c "cd '$WEB' && exec env $COMMON_ENV AUTH_SECRET=$AUTH_SECRET AUTH_ENC_KEY=$AUTH_ENC_KEY \
  AUTH_URL=http://localhost:$PORT APP_URL=http://localhost:$PORT pnpm exec next start -p $PORT"
start_bg worker bash -c "cd '$ROOT/apps/worker' && exec env $COMMON_ENV PORT=$WORKER_PORT pnpm start"

log "starting the app on http://localhost:$PORT …"
for _ in $(seq 1 90); do curl -sf "http://localhost:$PORT/api/healthz" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$PORT/api/healthz" >/dev/null || die "the web app did not start — see $STATE/web.log"
for _ in $(seq 1 30); do curl -sf "http://localhost:$WORKER_PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$WORKER_PORT/health" >/dev/null || warn "the worker did not report healthy — see $STATE/worker.log (receiving photos will not be read)"
# Warm every demo page once so the first click in front of the client is fast.
for p in / /login /pricing /about; do curl -s -o /dev/null "http://localhost:$PORT$p" || true; done

cat <<EOF

  ✅  RestoMatch is running locally — http://localhost:$PORT   (Chrome recommended)

  Logins (password for all: $DEMO_PASSWORD_SHOWN)
    owner       owner@kfar-hazeitim.test        → dashboard, leaks, approvals, chain
    receiver    receiver@kfar-hazeitim.test     → http://localhost:$PORT/login?lang=en
    bookkeeper  bookkeeper@kfar-hazeitim.test   → exports

  Check these 5 pages after logging in as the owner:
    http://localhost:$PORT/dashboard
    http://localhost:$PORT/dashboard/leaks
    http://localhost:$PORT/dashboard/approvals
    http://localhost:$PORT/dashboard/chain?p=last_month
    http://localhost:$PORT/dashboard/receiving

  Stop:   scripts/demo-local.sh stop        Logs: $STATE/
EOF
