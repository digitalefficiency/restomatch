#!/usr/bin/env bash
# One-command verification of a checkout (docs/VERIFICATION.md).
#
#   scripts/verify.sh            # layer 1 (the full CI gate, locally)
#   scripts/verify.sh layer2     # production build + `next start` + verify-prod.sh (+ e2e with VERIFY_E2E=1)
#   scripts/verify.sh all        # both
#
# Needs local Postgres 16 + pgvector (layer 1 re-creates its own DB `restomatch_gate`,
# layer 2 seeds `restomatch_verify`; base URL VERIFY_PG_BASE) and,
# for the worker tests, Redis (REDIS_URL; skipped with a FAIL-free "SKIP" if unset).
# Never touches anything remote: it refuses a non-local DATABASE_URL.
# Per-step logs go to .verify/<step>.log (gitignored). Exit 1 if any step failed.
set -uo pipefail

MODE="${1:-layer1}"
case "$MODE" in layer1 | layer2 | all) ;; *)
  echo "usage: $0 [layer1|layer2|all]" >&2
  exit 2
  ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
LOGS="$ROOT/.verify"
mkdir -p "$LOGS"

# Layer 1 runs on its own database, dropped and re-created each run (like CI's
# fresh service container) so leftovers from earlier local runs can't fail it.
PG_BASE="${VERIFY_PG_BASE:-postgres://postgres:postgres@localhost:5432}"
export DATABASE_URL="${VERIFY_GATE_DATABASE_URL:-$PG_BASE/restomatch_gate}"
export DATABASE_URL_TEST="$DATABASE_URL"
export NEXT_TELEMETRY_DISABLED=1
VERIFY_DB_URL="${VERIFY_DATABASE_URL:-$PG_BASE/restomatch_verify}"
PORT="${VERIFY_PORT:-3310}"
VERIFY_REDIS_URL="${VERIFY_REDIS_URL:-redis://localhost:6379}"

for f in apps/web/.env.local apps/web/.env.production apps/web/.env.production.local; do
  if [[ -f "$f" ]] && grep -qE '^[[:space:]]*(export[[:space:]]+)?(ANTHROPIC_API_KEY|SENTRY_DSN)=.+' "$f"; then
    echo "verify.sh: $f sets ANTHROPIC_API_KEY or SENTRY_DSN — a verify build would use it. Move it out first." >&2
    exit 2
  fi
done

for u in "$DATABASE_URL" "$VERIFY_DB_URL" "$VERIFY_REDIS_URL"; do
  host="$(node -e 'try{console.log(new URL(process.argv[1]).hostname)}catch{console.log("?")}' "$u")"
  if [[ "$host" != localhost && "$host" != 127.0.0.1 && "$host" != "[::1]" && "$host" != "::1" ]]; then
    echo "verify.sh: refusing non-local database host '$host' (local Postgres only)" >&2
    exit 2
  fi
done

ROWS=()
FAILED=0
BUILT_THIS_RUN=0
step() { # name cmd… — runs cmd, logs to .verify/name.log, records PASS/FAIL + duration
  local name="$1"
  shift
  local t0=$SECONDS
  printf '… %s\n' "$name"
  if "$@" >"$LOGS/$name.log" 2>&1; then
    ROWS+=("$(printf 'PASS  %-24s %4ss' "$name" $((SECONDS - t0)))")
  else
    ROWS+=("$(printf 'FAIL  %-24s %4ss  → .verify/%s.log' "$name" $((SECONDS - t0)) "$name")")
    FAILED=1
  fi
}
skip() { ROWS+=("$(printf 'SKIP  %-24s       %s' "$1" "$2")"); }

# Build-time env: the same placeholders CI uses (no real keys anywhere).
# External services are pinned for every verify build/server. Next also reads
# apps/web/.env*.local, but process env wins: REDIS_URL is forced to a LOCAL Redis
# (VERIFY_REDIS_URL), and the paid/outbound keys are removed (env -u); the
# preflight below refuses to run if a local env file would supply them instead.
web_env() {
  env -u ANTHROPIC_API_KEY -u SENTRY_DSN \
    DATABASE_URL_APP="${DATABASE_URL_APP:-$DATABASE_URL}" \
    REDIS_URL="$VERIFY_REDIS_URL" \
    AUTH_SECRET=verify-only-secret-not-production-0123456789 \
    AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    AUTH_URL="http://localhost:$PORT" APP_URL="http://localhost:$PORT" \
    NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder \
    "$@"
}

fresh_gate_db() { # drop + create the layer-1 database (local only — checked above)
  (cd packages/db && node -e '
    const postgres = require("postgres");
    const u = new URL(process.argv[1]); const name = u.pathname.slice(1); u.pathname = "/postgres";
    const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
    (async () => {
      await sql.unsafe(`drop database if exists "${name}" with (force)`);
      await sql.unsafe(`create database "${name}"`);
      await sql.end();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' "$DATABASE_URL")
}

# --force: never replay cached results — the DB-backed suites must run against
# the fresh database every time (CI has no cache either).
layer1() {
  step install pnpm install --frozen-lockfile
  step fresh-db fresh_gate_db
  step migrate pnpm --filter @restomatch/db migrate
  step provision-rls pnpm --filter @restomatch/db provision-rls
  step check-rls pnpm --filter @restomatch/db check-rls
  step db-doctor pnpm --filter @restomatch/db run doctor --strict
  step supabase-sync pnpm --filter @restomatch/db run supabase-sync --check
  step typecheck pnpm turbo run typecheck --force --concurrency=1 --filter='!@restomatch/web'
  step test env -u REDIS_URL pnpm turbo run test --force --concurrency=1 --filter='!@restomatch/worker'
  if [[ -n "${REDIS_URL:-}" ]]; then
    step worker-test pnpm --filter @restomatch/worker test
  else
    skip worker-test "set REDIS_URL=redis://localhost:6379 to run"
  fi
  step web-lint pnpm --filter @restomatch/web lint
  BUILT_THIS_RUN=1
  step web-build build_layer1
  step web-tsc pnpm --filter @restomatch/web typecheck # after build: needs .next/types
  step audit pnpm audit --prod --audit-level=high
}

SERVER_PID=""
stop_server() { # the server runs in its own process group: stop pnpm + next-server together
  if [[ -n "$SERVER_PID" ]]; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=""
}
trap stop_server EXIT

prepare_verify_db() {
  local out
  out="$(E2E_DATABASE_URL="$VERIFY_DB_URL" pnpm --filter @restomatch/db exec tsx "$ROOT/apps/web/e2e/prepare-db.ts")" || return 1
  echo "$out"
  APP_URL_DB="$(grep -oE 'E2E_APP_URL=\S+' <<<"$out" | tail -1 | cut -d= -f2-)"
  [[ -n "$APP_URL_DB" ]]
}

start_prod_server() {
  # NODE_ENV=production keeps every boot guard on; email/storage keys are
  # placeholders (nothing is sent — no test here triggers an email).
  set -m # own process group, so stop_server can stop the whole tree
  (cd apps/web && DATABASE_URL="$VERIFY_DB_URL" DATABASE_URL_APP="$APP_URL_DB" NODE_ENV=production \
    RESEND_API_KEY=re_verify_placeholder EMAIL_FROM=verify@example.invalid \
    SUPABASE_SERVICE_ROLE_KEY=verify-placeholder CRON_SECRET=verify-placeholder-cron-secret \
    web_env pnpm exec next start -p "$PORT") >"$LOGS/next-start.log" 2>&1 &
  SERVER_PID=$!
  set +m
  for _ in $(seq 1 90); do
    curl -sf "http://localhost:$PORT/api/healthz" >/dev/null && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 1
  done
  stop_server # did not come up: clean up, and let layer2 skip the smoke
  return 1
}

build_layer1() { # never inherit a DATABASE_URL_APP from the caller's shell
  DATABASE_URL_APP="$DATABASE_URL" web_env pnpm --filter @restomatch/web build
}

build_for_verify() { # layer 2 on its own (CI): build against the seeded verify DB
  DATABASE_URL="$VERIFY_DB_URL" DATABASE_URL_APP="$APP_URL_DB" web_env pnpm --filter @restomatch/web build
}

layer2() {
  APP_URL_DB=""
  step verify-db prepare_verify_db
  # Never smoke-test a stale build: rebuild unless layer 1 just built this tree.
  if [[ "$BUILT_THIS_RUN" != 1 ]]; then
    step web-build build_for_verify
  fi
  step prod-start start_prod_server
  if [[ -n "$SERVER_PID" ]]; then
    step verify-prod "$ROOT/scripts/verify-prod.sh" "http://localhost:$PORT"
  else
    skip verify-prod "server did not start (.verify/next-start.log)"
  fi
  stop_server
  if [[ "${VERIFY_E2E:-0}" == 1 ]]; then
    # Logged-in click-through (5 roles × he/en, receiving wizard, malformed ids…).
    step e2e env E2E_DATABASE_URL="$VERIFY_DB_URL" pnpm --filter @restomatch/web exec playwright test --config playwright.config.ts
  else
    skip e2e "VERIFY_E2E=1 to run the Playwright suite"
  fi
}

T0=$SECONDS
[[ "$MODE" == layer1 || "$MODE" == all ]] && layer1
[[ "$MODE" == layer2 || "$MODE" == all ]] && layer2

echo
echo "verify ($MODE) @ $(git rev-parse --short HEAD 2>/dev/null)  —  $((SECONDS - T0))s"
printf '%s\n' "${ROWS[@]}"
if [[ $FAILED -eq 0 ]]; then echo "RESULT: PASS"; else echo "RESULT: FAIL"; fi
exit $FAILED
