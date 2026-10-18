#!/usr/bin/env bash
# One-command verification of a checkout (docs/VERIFICATION.md).
#
#   scripts/verify.sh            # layer 1 (the full CI gate, locally)
#   scripts/verify.sh layer2     # production build + `next start` + verify-prod.sh (+ e2e with VERIFY_E2E=1)
#   scripts/verify.sh all        # both
#
# Needs local Postgres 16 + pgvector (DATABASE_URL, default the local test DB) and,
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

export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/restomatch_test}"
export DATABASE_URL_TEST="${DATABASE_URL_TEST:-$DATABASE_URL}"
export NEXT_TELEMETRY_DISABLED=1
VERIFY_DB_URL="${VERIFY_DATABASE_URL:-${DATABASE_URL%/*}/restomatch_verify}"
PORT="${VERIFY_PORT:-3310}"

for u in "$DATABASE_URL" "$VERIFY_DB_URL"; do
  host="$(node -e 'try{console.log(new URL(process.argv[1]).hostname)}catch{console.log("?")}' "$u")"
  if [[ "$host" != localhost && "$host" != 127.0.0.1 && "$host" != "::1" ]]; then
    echo "verify.sh: refusing non-local database host '$host' (local Postgres only)" >&2
    exit 2
  fi
done

ROWS=()
FAILED=0
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
web_env() {
  env DATABASE_URL_APP="${DATABASE_URL_APP:-$DATABASE_URL}" \
    AUTH_SECRET=verify-only-secret-not-production-0123456789 \
    AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    AUTH_URL="http://localhost:$PORT" APP_URL="http://localhost:$PORT" \
    NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder \
    "$@"
}

layer1() {
  step install pnpm install --frozen-lockfile
  step migrate pnpm --filter @restomatch/db migrate
  step provision-rls pnpm --filter @restomatch/db provision-rls
  step check-rls pnpm --filter @restomatch/db check-rls
  step db-doctor pnpm --filter @restomatch/db run doctor --strict
  step supabase-sync pnpm --filter @restomatch/db run supabase-sync --check
  step typecheck pnpm turbo run typecheck --concurrency=1 --filter='!@restomatch/web'
  step test env -u REDIS_URL pnpm turbo run test --concurrency=1 --filter='!@restomatch/worker'
  if [[ -n "${REDIS_URL:-}" ]]; then
    step worker-test pnpm --filter @restomatch/worker test
  else
    skip worker-test "set REDIS_URL=redis://localhost:6379 to run"
  fi
  step web-lint pnpm --filter @restomatch/web lint
  step web-build web_env pnpm --filter @restomatch/web build
  step web-tsc pnpm --filter @restomatch/web typecheck # after build: needs .next/types
  step audit pnpm audit --prod --audit-level=high
}

SERVER_PID=""
stop_server() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }
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
  (cd apps/web && DATABASE_URL="$VERIFY_DB_URL" DATABASE_URL_APP="$APP_URL_DB" NODE_ENV=production \
    RESEND_API_KEY=re_verify_placeholder EMAIL_FROM=verify@example.invalid \
    SUPABASE_SERVICE_ROLE_KEY=verify-placeholder CRON_SECRET=verify-placeholder-cron-secret \
    web_env pnpm exec next start -p "$PORT") >"$LOGS/next-start.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 90); do
    curl -sf "http://localhost:$PORT/api/healthz" >/dev/null && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}

layer2() {
  APP_URL_DB=""
  step verify-db prepare_verify_db
  if [[ ! -f apps/web/.next/BUILD_ID ]]; then
    step web-build web_env pnpm --filter @restomatch/web build
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
