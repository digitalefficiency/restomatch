#!/usr/bin/env bash
# Pilot probe against PRODUCTION — Stage B/C of docs/PILOT-QA.md. Rom's machine only for
# readonly/write (OPERATING.md: no agent logs in to production). Copy-paste, no secrets inline:
# credentials come from the environment, or are prompted for (passwords hidden, never echoed).
#
#   apps/web/e2e/pilot/run-prod.sh public   [EXPECTED_SHA]   # GETs only, no login — anyone
#   apps/web/e2e/pilot/run-prod.sh readonly [EXPECTED_SHA]   # + one login per QA role — Rom
#   apps/web/e2e/pilot/run-prod.sh write                     # the journey on the QA tenant — Rom
#
# Env (all optional — prompted if missing): PILOT_BASE_URL (default production), EXPECTED_SHA,
# PILOT_<ROLE>_EMAIL / PILOT_<ROLE>_PASSWORD for OWNER MANAGER RECEIVER [CHEF BOOKKEEPER],
# PILOT_TENANT_CONFIRM (the QA restaurant id; required for write).
set -euo pipefail
set +x

MODE="${1:-}"
case "$MODE" in public | readonly | write) ;; *)
  echo "usage: $0 public|readonly|write [EXPECTED_SHA]" >&2; exit 2 ;;
esac
[[ -n "${2:-}" ]] && export EXPECTED_SHA="$2"
export PILOT_BASE_URL="${PILOT_BASE_URL:-https://restomatchrrr.vercel.app}"
export PILOT_PROBE="$MODE"
QA_TENANT_NAME='RestoMatch QA (פנימי)'

ask() { # var prompt [secret] — fill an unset env var from the terminal
  local var="$1" prompt="$2" secret="${3:-}" value
  [[ -n "${!var:-}" ]] && return 0
  [[ -t 0 ]] || { echo "[pilot] $var is not set and there is no terminal to ask" >&2; exit 2; }
  if [[ -n "$secret" ]]; then read -rsp "$prompt: " value; echo; else read -rp "$prompt: " value; fi
  export "$var=$value"
}

# A local lab's healthz reports no commit; production must report the promoted one.
if [[ "$MODE" != write && ! "$PILOT_BASE_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$ ]]; then
  ask EXPECTED_SHA "Promoted commit SHA (healthz must report it)"
fi

if [[ "$MODE" != public ]]; then
  echo "[pilot] $MODE against $PILOT_BASE_URL — QA tenant users only (\"$QA_TENANT_NAME\")."
  for role in OWNER MANAGER RECEIVER; do
    name="$(printf '%s' "$role" | tr 'A-Z' 'a-z')" # bash 3.2 (macOS) has no ${var,,}
    ask "PILOT_${role}_EMAIL" "QA $name email"
    ask "PILOT_${role}_PASSWORD" "QA $name password" secret
  done
  for role in CHEF BOOKKEEPER; do # optional: an empty email skips that role
    name="$(printf '%s' "$role" | tr 'A-Z' 'a-z')"
    [[ -t 0 ]] && ask "PILOT_${role}_EMAIL" "QA $name email (Enter to skip)"
    if [[ -n "$(printenv "PILOT_${role}_EMAIL" || true)" ]]; then
      ask "PILOT_${role}_PASSWORD" "QA $name password" secret
    else
      unset "PILOT_${role}_EMAIL"
    fi
  done
fi

if [[ "$MODE" == write ]]; then
  ask PILOT_TENANT_CONFIRM "QA restaurant id (PILOT_TENANT_CONFIRM)"
  echo "[pilot] Stage C WRITES to production's QA tenant (suppliers, catalog, record-only orders, one receipt)."
  if [[ -t 0 ]]; then
    read -rp "Type the tenant name to continue ($QA_TENANT_NAME): " typed
    [[ "$typed" == "$QA_TENANT_NAME" ]] || { echo "[pilot] tenant name mismatch — stopped" >&2; exit 2; }
  fi
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec pnpm exec playwright test -c e2e/pilot/playwright.pilot.config.ts
