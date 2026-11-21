#!/usr/bin/env bash
# Pilot lab — Stage A of docs/PILOT-QA.md: a brand-new, EMPTY restaurant on a local
# production build, walked end to end by apps/web/e2e/pilot/pilot-journey.spec.ts.
#
#   scripts/pilot-lab.sh            # fresh DB + build + serve + cron + run the journey, then stop
#   scripts/pilot-lab.sh up         # same, but keep serving (Ctrl-C stops server + cron)
#   PILOT_LAB_SKIP_BUILD=1 …        # reuse apps/web/.next (only if it was built from this tree)
#   scripts/pilot-lab.sh -- --project=pilot-phone   # extra args go to playwright
#
# 1. drops + creates the LOCAL database restomatch_pilotlab (Postgres 16 + pgvector);
# 2. migrate → provision-rls → check-rls;
# 3. seed + seed-demo: the demo tenant lives next door, so the journey can prove isolation;
# 4. pilot-setup v2 on a config made from packages/db/scripts/pilot.qa.example.json
#    (5 roles, no suppliers/products): dry-run, then --apply with the printed plan hash;
# 5. lab passwords (e2e/pilot/lab.ts — refuses any non-localhost DATABASE_URL);
# 6. `next build` + `next start` with the CI placeholder env (as scripts/verify.sh layer2);
# 7. cron emulation: GET /api/cron/jobs every 60 s with a lab CRON_SECRET;
# 8. playwright -c apps/web/e2e/pilot/playwright.pilot.config.ts.
#
# Never touches Supabase, Vercel, email or WhatsApp: the host guard below refuses any
# non-local database, and every outbound key is a placeholder or unset.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/apps/web"
MODE="test"
if [[ "${1:-}" == up || "${1:-}" == test ]]; then MODE="$1"; shift; fi
[[ "${1:-}" == -- ]] && shift

PG_BASE="${PILOT_LAB_PG_BASE:-postgres://postgres:postgres@localhost:5432}"
DB_NAME="${PILOT_LAB_DB:-restomatch_pilotlab}"
DB_URL="$PG_BASE/$DB_NAME"
PORT="${PILOT_LAB_PORT:-3400}"
OUT="$WEB/test-results/pilot"
LAB="$OUT/lab"
export PILOT_LAB_PASSWORD="${PILOT_LAB_PASSWORD:-Pilot-Lab-Only-2026!}"
CRON_SECRET="pilot-lab-cron-secret-not-production"
mkdir -p "$LAB"

log() { printf '[pilot-lab] %s\n' "$*"; }
die() { log "$*"; exit 1; }

curl -s -o /dev/null "http://localhost:$PORT" && die "port $PORT is already serving — stop that server first (or set PILOT_LAB_PORT)"
host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$DB_URL")"
[[ "$host" == localhost || "$host" == 127.0.0.1 ]] || die "refusing non-local DB host $host"
pg_isready -h "$host" -q || die "Postgres is not running on $host (service postgresql start)"

PGIDS=()
cleanup() { for g in "${PGIDS[@]}"; do kill -TERM -- "-$g" 2>/dev/null; done; }
trap cleanup EXIT
trap 'exit 130' INT TERM
start_bg() { # logfile cmd… — own process group, so cleanup stops the whole tree
  local logfile="$1"; shift
  set -m; "$@" >"$logfile" 2>&1 </dev/null & PGIDS+=("$!"); set +m
}

db_pnpm() { (cd "$ROOT" && DATABASE_URL="$DB_URL" pnpm --filter @restomatch/db "$@"); }
lab_ts() { (cd "$ROOT" && DATABASE_URL="$DB_URL" pnpm --filter @restomatch/db exec tsx "$WEB/e2e/pilot/lab.ts" "$@"); }

# ── 1–2. database ────────────────────────────────────────────────────────────
log "fresh database $DB_NAME"
(cd "$ROOT/packages/db" && node -e '
  const postgres = require("postgres");
  const u = new URL(process.argv[1]); const name = u.pathname.slice(1); u.pathname = "/postgres";
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
  (async () => {
    await sql.unsafe(`drop database if exists "${name}" with (force)`);
    await sql.unsafe(`create database "${name}"`);
    await sql.end();
  })().catch((e) => { console.error(e.message); process.exit(1); });
' "$DB_URL") || die "could not create $DB_NAME"
db_pnpm migrate >"$LAB/db.log" 2>&1 || die "migrate failed ($LAB/db.log)"
APP_DB_URL="$(db_pnpm provision-rls --print-app-url 2>>"$LAB/db.log" | grep -oE 'DATABASE_URL_APP=\S+' | cut -d= -f2-)"
[[ -n "$APP_DB_URL" ]] || die "provision-rls printed no app URL ($LAB/db.log)"
db_pnpm check-rls >>"$LAB/db.log" 2>&1 || die "check-rls failed ($LAB/db.log)"

# ── 3. the demo tenant next door (isolation evidence only) ───────────────────
log "demo tenant (for the isolation step)"
{ db_pnpm seed && (cd "$ROOT" && DATABASE_URL="$DB_URL" pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts); } \
  >>"$LAB/db.log" 2>&1 || die "demo seed failed ($LAB/db.log)"

# ── 4–5. the QA tenant via pilot-setup v2 ────────────────────────────────────
CFG="$LAB/qa-lab.json"
lab_ts config "$CFG" >>"$LAB/db.log" 2>&1 || die "lab config failed ($LAB/db.log)"
BIZ="$(node -e 'console.log(require(process.argv[1]).restaurant.businessId)' "$CFG")"
log "pilot-setup dry-run → apply ($BIZ)"
DRY="$(cd "$ROOT" && DATABASE_URL="$DB_URL" PILOT_CONFIG="$CFG" pnpm --filter @restomatch/db pilot:setup -- --expect-project local 2>&1)"
echo "$DRY" >"$LAB/pilot-setup-dry-run.log"
HASH="$(grep -oE '^PLAN-HASH=\S+' <<<"$DRY" | tail -1 | cut -d= -f2-)"
[[ -n "$HASH" ]] || die "pilot-setup dry-run printed no PLAN-HASH ($LAB/pilot-setup-dry-run.log) — is pilot-setup v2 (#172) on this tree?"
(cd "$ROOT" && DATABASE_URL="$DB_URL" PILOT_CONFIG="$CFG" pnpm --filter @restomatch/db pilot:setup -- \
  --expect-project local --apply --plan-hash "$HASH" --confirm "$BIZ") >"$LAB/pilot-setup-apply.log" 2>&1 \
  || die "pilot-setup --apply failed ($LAB/pilot-setup-apply.log)"
lab_ts passwords "$CFG" >>"$LAB/db.log" 2>&1 || die "lab passwords failed ($LAB/db.log)"
lab_ts facts "$CFG" "$LAB/facts.json" >>"$LAB/db.log" 2>&1 || die "lab facts failed ($LAB/db.log)"
log "QA tenant ready: $(node -e 'const f=require(process.argv[1]);console.log(f.restaurantName, f.restaurantId)' "$LAB/facts.json")"

# ── 6. production build + server (CI placeholder env, as verify.sh layer2) ───
web_env() {
  env -u ANTHROPIC_API_KEY -u SENTRY_DSN -u REDIS_URL \
    DATABASE_URL="$DB_URL" DATABASE_URL_APP="$APP_DB_URL" \
    AUTH_SECRET=pilot-lab-only-secret-not-production-0123456789 \
    AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    AUTH_URL="http://localhost:$PORT" APP_URL="http://localhost:$PORT" \
    NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder \
    NEXT_TELEMETRY_DISABLED=1 "$@"
}
if [[ "${PILOT_LAB_SKIP_BUILD:-0}" != 1 || ! -f "$WEB/.next/BUILD_ID" ]]; then
  log "next build (log: $LAB/build.log)"
  (cd "$WEB" && web_env pnpm exec next build) >"$LAB/build.log" 2>&1 || die "build failed ($LAB/build.log)"
fi
start_bg "$LAB/next-start.log" bash -c "cd '$WEB' && exec env -u ANTHROPIC_API_KEY -u SENTRY_DSN -u REDIS_URL \
  NODE_ENV=production DATABASE_URL='$DB_URL' DATABASE_URL_APP='$APP_DB_URL' \
  AUTH_SECRET=pilot-lab-only-secret-not-production-0123456789 \
  AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  AUTH_URL=http://localhost:$PORT APP_URL=http://localhost:$PORT \
  NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder \
  RESEND_API_KEY=re_verify_placeholder EMAIL_FROM=verify@example.invalid \
  SUPABASE_SERVICE_ROLE_KEY=verify-placeholder CRON_SECRET=$CRON_SECRET NEXT_TELEMETRY_DISABLED=1 \
  ./node_modules/.bin/next start -p $PORT"
for _ in $(seq 1 90); do curl -sf "http://localhost:$PORT/api/healthz" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$PORT/api/healthz" >/dev/null || die "server did not start ($LAB/next-start.log)"

# ── 7. cron emulation (Vercel Cron runs /api/cron/jobs every minute) ─────────
start_bg "$LAB/cron.log" bash -c "while true; do
  printf '%s ' \"\$(date -u +%FT%TZ)\"; curl -s -o /dev/null -w '%{http_code}\n' \
    -H 'Authorization: Bearer $CRON_SECRET' http://localhost:$PORT/api/cron/jobs; sleep 60; done"
log "serving http://localhost:$PORT · cron every 60 s · QA logins: qa-<role>@example.invalid / \$PILOT_LAB_PASSWORD"

# ── 8. the journey ───────────────────────────────────────────────────────────
if [[ "$MODE" == up ]]; then
  log "up: Ctrl-C stops the server and the cron loop"
  wait
  exit 0
fi
cd "$WEB" || exit 2
PILOT_BASE_URL="http://localhost:$PORT" PILOT_FACTS="$LAB/facts.json" PILOT_LAB_DATABASE_URL="$DB_URL" \
  pnpm exec playwright test -c e2e/pilot/playwright.pilot.config.ts "$@"
