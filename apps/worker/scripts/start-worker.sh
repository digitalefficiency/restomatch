#!/usr/bin/env bash
# RestoMatch pilot worker launcher (owner's Mac). Plan v2, Wave 0.
#
# Loads the production secrets from an env file that is NEVER committed, then
# runs the BullMQ worker in production mode. Used directly (`bash start-worker.sh`)
# and by the launchd job in ./launchd/com.restomatch.worker.plist (which keeps it
# alive across crashes and re-launches it at login).
#
# Env file search order (first hit wins):
#   $RESTOMATCH_WORKER_ENV
#   $HOME/.restomatch/worker.env
#   <repo>/apps/worker/.env.production.local   (gitignored via .env.*.local)
#
# Required keys (see docs/ENV-PRODUCTION.md "Worker"): DATABASE_URL, REDIS_URL,
# ANTHROPIC_API_KEY, RESEND_API_KEY, EMAIL_FROM, APP_URL. Optional: SENTRY_DSN,
# OCR_CLAUDE_MODEL, PORT (health server, default 8080).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${RESTOMATCH_WORKER_ENV:-}"
if [[ -z "$ENV_FILE" ]]; then
  for candidate in "$HOME/.restomatch/worker.env" "$REPO_DIR/apps/worker/.env.production.local"; do
    if [[ -f "$candidate" ]]; then ENV_FILE="$candidate"; break; fi
  done
fi
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "[start-worker] no env file found (RESTOMATCH_WORKER_ENV, ~/.restomatch/worker.env, apps/worker/.env.production.local)" >&2
  exit 2
fi

# Refuse world-readable secret files.
if [[ "$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")" =~ [0-9][0-9][1-7] ]]; then
  echo "[start-worker] $ENV_FILE is readable by others — run: chmod 600 $ENV_FILE" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export NODE_ENV=production

# Node via nvm/fnm/volta if the launchd environment lacks it.
if ! command -v pnpm >/dev/null 2>&1; then
  export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

cd "$REPO_DIR"
echo "[start-worker] $(date -u +%FT%TZ) starting worker from $REPO_DIR (env: $ENV_FILE)"
exec pnpm --filter @restomatch/worker start
