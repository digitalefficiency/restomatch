#!/usr/bin/env bash
# Demo-path QA (e2e/demo-path.spec.ts) against a PRODUCTION build, end to end:
#
#   apps/web/e2e/run-demo-path.sh                 # seed + (build) + serve + run all 4 projects
#   DEMO_REBUILD=1 apps/web/e2e/run-demo-path.sh  # force a fresh `next build`
#   apps/web/e2e/run-demo-path.sh --project=phone-en   # extra args go to playwright
#
# 1. re-creates the LOCAL database restomatch_demoqa and seeds it like the demo
#    (docs/SUPABASE-GITHUB-DEPLOY.md §7): migrate, provision-rls, seed, seed-demo,
#    seed:chain-demo — all with DEMO_TODAY (default 2026-10-25);
# 2. `next build` (skipped when .next/BUILD_ID exists, unless DEMO_REBUILD=1);
# 3. two `next start` servers on the same build:
#      :3320  NODE_ENV=production (boot guards on)  — landing, owner, bookkeeper
#      :3321  NODE_ENV=development at runtime       — receiver (the dev OCR stub and
#             local scan storage refuse NODE_ENV=production by design)
#    plus the worker (it runs the OCR job and beats the heartbeat);
# 4. playwright -c playwright.demo.config.ts. Screenshots of every step land in
#    test-results/demo-path/**/demo-path-shots/<project>/.
#
# Local only: refuses a non-local database host. Never touches Supabase/Vercel,
# never sends email (placeholder keys; the worker has no provider credentials).
set -uo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$WEB/../.." && pwd)"
PG_BASE="${DEMO_PG_BASE:-postgres://postgres:postgres@localhost:5432}"
DB_NAME="${DEMO_DB_NAME:-restomatch_demoqa}"
DB_URL="$PG_BASE/$DB_NAME"
export DEMO_TODAY="${DEMO_TODAY:-2026-10-25}"
PROD_PORT="${DEMO_PORT:-3320}"
STUB_PORT="${DEMO_STUB_PORT:-3321}"
LOGS="$WEB/test-results/demo-path/logs"
mkdir -p "$LOGS"

host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$DB_URL")"
[[ "$host" == localhost || "$host" == 127.0.0.1 ]] || { echo "refusing non-local DB host $host" >&2; exit 2; }

PGIDS=()
cleanup() { for g in "${PGIDS[@]}"; do kill -TERM -- "-$g" 2>/dev/null; done; }
trap cleanup EXIT

log() { printf '[demo-path] %s\n' "$*"; }

# ── 1. seed ──────────────────────────────────────────────────────────────────
log "seeding $DB_NAME with DEMO_TODAY=$DEMO_TODAY"
(cd "$ROOT/packages/db" && node -e '
  const postgres = require("postgres");
  const u = new URL(process.argv[1]); const name = u.pathname.slice(1); u.pathname = "/postgres";
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
  (async () => {
    await sql.unsafe(`drop database if exists "${name}" with (force)`);
    await sql.unsafe(`create database "${name}"`);
    await sql.end();
  })().catch((e) => { console.error(e.message); process.exit(1); });
' "$DB_URL") || exit 1
cd "$ROOT" || exit 2
export DATABASE_URL="$DB_URL"
pnpm --filter @restomatch/db migrate >"$LOGS/seed.log" 2>&1 || { log "migrate failed ($LOGS/seed.log)"; exit 1; }
APP_DB_URL="$(pnpm --filter @restomatch/db provision-rls --print-app-url 2>>"$LOGS/seed.log" | grep -oE 'DATABASE_URL_APP=\S+' | cut -d= -f2-)"
[[ -n "$APP_DB_URL" ]] || { log "provision-rls printed no app URL"; exit 1; }
{ pnpm --filter @restomatch/db seed &&
  pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts &&
  pnpm --filter @restomatch/worker seed:chain-demo; } >>"$LOGS/seed.log" 2>&1 || { log "seed failed ($LOGS/seed.log)"; exit 1; }
grep -E '^\[seed-demo\] dashboard hero|^\[seed-chain-demo\]' "$LOGS/seed.log" | sed 's/^/[demo-path]   /'

# ── 2. build ─────────────────────────────────────────────────────────────────
web_env() {
  env DATABASE_URL="$DB_URL" DATABASE_URL_APP="$APP_DB_URL" \
    AUTH_SECRET=demo-qa-only-secret-not-production-0123456789 \
    AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    NEXT_TELEMETRY_DISABLED=1 "$@"
}
if [[ "${DEMO_REBUILD:-0}" == 1 || ! -f "$WEB/.next/BUILD_ID" ]]; then
  log "next build (log: $LOGS/build.log)"
  (cd "$WEB" && web_env AUTH_URL="http://localhost:$PROD_PORT" APP_URL="http://localhost:$PROD_PORT" \
    NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder \
    pnpm exec next build) >"$LOGS/build.log" 2>&1 || { log "build failed"; exit 1; }
fi

# ── 3. serve ─────────────────────────────────────────────────────────────────
start_bg() { # logfile cmd… — own process group so cleanup can stop the whole tree
  local logfile="$1"; shift
  set -m
  "$@" >"$logfile" 2>&1 </dev/null &
  PGIDS+=("$!")
  set +m
}
wait_http() {
  for _ in $(seq 1 90); do curl -sf "$1" >/dev/null && return 0; sleep 1; done
  return 1
}

start_bg "$LOGS/next-prod.log" bash -c "cd '$WEB' && exec env NODE_ENV=production \
  AUTH_URL=http://localhost:$PROD_PORT APP_URL=http://localhost:$PROD_PORT \
  NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder \
  SUPABASE_SERVICE_ROLE_KEY=verify-placeholder RESEND_API_KEY=re_verify_placeholder EMAIL_FROM=verify@example.invalid \
  CRON_SECRET=verify-placeholder-cron-secret \
  DATABASE_URL='$DB_URL' DATABASE_URL_APP='$APP_DB_URL' AUTH_SECRET=demo-qa-only-secret-not-production-0123456789 \
  AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef NEXT_TELEMETRY_DISABLED=1 \
  pnpm exec next start -p $PROD_PORT"
SCANS="$WEB/test-results/demo-path/scans"
start_bg "$LOGS/next-stub.log" bash -c "cd '$WEB' && exec env NODE_ENV=development LOCAL_SCAN_DIR='$SCANS' \
  AUTH_URL=http://localhost:$STUB_PORT APP_URL=http://localhost:$STUB_PORT \
  DATABASE_URL='$DB_URL' DATABASE_URL_APP='$APP_DB_URL' AUTH_SECRET=demo-qa-only-secret-not-production-0123456789 \
  AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef NEXT_TELEMETRY_DISABLED=1 \
  pnpm exec next start -p $STUB_PORT"
start_bg "$LOGS/worker.log" bash -c "cd '$ROOT/apps/worker' && exec env NODE_ENV=development LOCAL_SCAN_DIR='$SCANS' \
  DATABASE_URL='$DB_URL' PORT=\${DEMO_WORKER_PORT:-8080} pnpm start"

wait_http "http://localhost:$PROD_PORT/api/healthz" || { log "prod server did not start ($LOGS/next-prod.log)"; exit 1; }
wait_http "http://localhost:$STUB_PORT/api/healthz" || { log "stub server did not start ($LOGS/next-stub.log)"; exit 1; }
sleep 5 # first worker heartbeat
log "serving: prod :$PROD_PORT · stub :$STUB_PORT · worker"

# ── 4. run ───────────────────────────────────────────────────────────────────
# Each run signs in ~13 times from 127.0.0.1; the login limiter (30/IP/15 min)
# keeps its counters in Postgres (0061 rate_limit_counters) — in $DB_NAME, which
# step 1 re-creates, so back-to-back runs start from zero. Clear them anyway
# (local DB only, checked above) in case the servers were left running.
(cd "$ROOT/packages/db" && node -e '
  const postgres = require("postgres");
  const sql = postgres(process.argv[1], { max: 1, onnotice: () => {} });
  sql`DELETE FROM rate_limit_counters WHERE key LIKE ${"login:%"}`.then(() => sql.end(), () => sql.end());
' "$DB_URL") || true
cd "$WEB" || exit 2
rm -f test-results/demo-path/demo-path-numbers.json
DEMO_BASE_URL="http://localhost:$PROD_PORT" DEMO_STUB_URL="http://localhost:$STUB_PORT" DEMO_DATABASE_URL="$DB_URL" \
  pnpm exec playwright test -c playwright.demo.config.ts "$@"
