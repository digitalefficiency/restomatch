#!/usr/bin/env bash
# RestoMatch wave-2 lab: one local demo per package session.
#
#   bash docs/ux/wave2/lab.sh <ID> [port] [flags]      (run from the repo root)
#   bash docs/ux/wave2/lab.sh W2-09                    -> http://localhost:3409
#
# Default run:
#   start local Postgres if it is down -> pnpm install if node_modules is stale ->
#   re-create the lab DB rm_<id> -> migrate -> provision RLS (local restomatch_app role) ->
#   reseed the demo tenant "כפר הזיתים" at DEMO_TODAY=2026-10-25 -> prepare the test DB
#   rm_<id>_test (migrate + RLS) -> next build -> next start on the port ->
#   write ~/.rm-lab/<id>/{env,shot.cjs} -> print the URL and the demo logins.
#
# Flags:
#   --tests-only     Postgres + install + test DB + env file only (server-only packages)
#   --reseed         re-create and reseed the lab DB only; a running server keeps running
#   --serve          keep the lab DB; rebuild and restart the server
#   --no-build       reuse the last production build when serving (if one exists)
#   --dev            serve with `next dev` (hot reload, no build); never for DoD screenshots
#   --stub           also serve the dev OCR stub on port+50 plus the worker (receiving capture)
#   --fresh-test-db  drop and re-create rm_<id>_test
#   --worktree       run in a detached git worktree of HEAD under ~/.rm-lab/<id>/wt
#   --stop           stop this lab's servers
#   --status         print URL, logins and health
#
# Port: default 3400+N. W2-NN -> N=NN, G-NN -> N=20+NN, H-NN -> N=40+NN
# (W2-09 -> 3409, G-05 -> 3425, H-01 -> 3441). Playwright's own dev server: E2E_PORT = port+100.
#
# SAFETY: local only. Postgres must be on localhost. Every remote or production credential in
# the environment is stripped before any step runs. All keys are throwaway placeholders, no
# e-mail or WhatsApp provider is configured, and nothing is deployed or pushed. This file holds
# no secret: the demo password is read from packages/db/scripts/seed.ts (the public local default).
set -uo pipefail

DEMO_TODAY_LAB="2026-10-25"
PG_PORT="${LAB_PG_PORT:-5432}"
PG_USER=postgres
PG_PASS=postgres
PG_BASE="postgres://$PG_USER:$PG_PASS@localhost:$PG_PORT"

log() { printf '[lab] %s\n' "$*"; }
die() { printf '[lab] ERROR: %s\n' "$*" >&2; exit 1; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }

# ---------- arguments -----------------------------------------------------------------------
ID="" PORT="" MODE=full NO_BUILD=0 DEV=0 STUB=0 FRESH_TEST=0 WORKTREE=0
for a in "$@"; do
  case "$a" in
    -h | --help) usage ;;
    --tests-only) MODE=tests ;;
    --reseed) MODE=reseed ;;
    --serve) MODE=serve ;;
    --stop) MODE=stop ;;
    --status) MODE=status ;;
    --no-build) NO_BUILD=1 ;;
    --dev) DEV=1 ;;
    --stub) STUB=1 ;;
    --fresh-test-db) FRESH_TEST=1 ;;
    --worktree) WORKTREE=1 ;;
    -*) die "unknown flag $a (see --help)" ;;
    *)
      if [[ -z "$ID" ]]; then ID="$a"
      elif [[ -z "$PORT" && "$a" =~ ^[0-9]{4,5}$ ]]; then PORT="$a"
      else die "unexpected argument '$a' (usage: lab.sh <ID> [port] [flags])"; fi ;;
  esac
done
[[ -n "$ID" ]] || usage
[[ "$ID" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,23}$ ]] || die "package id '$ID' must look like W2-09, W2-09a, G-05 or H-01"
ID_UP="$(printf '%s' "$ID" | tr '[:lower:]' '[:upper:]')"
SLUG="$(printf '%s' "$ID" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_')"

default_port() {
  local n
  if [[ "$ID_UP" =~ ^W2-([0-9]{2}) ]]; then n=$((10#${BASH_REMATCH[1]}))
  elif [[ "$ID_UP" =~ ^G-([0-9]{2}) ]]; then n=$((20 + 10#${BASH_REMATCH[1]}))
  elif [[ "$ID_UP" =~ ^H-([0-9]{2}) ]]; then n=$((40 + 10#${BASH_REMATCH[1]}))
  else n=$((60 + $(printf '%s' "$ID_UP" | cksum | cut -d' ' -f1) % 39)); fi
  echo $((3400 + n))
}
PORT="${PORT:-$(default_port)}"
((PORT >= 1024 && PORT <= 65000)) || die "port $PORT is out of range"
URL="http://localhost:$PORT"
STUB_PORT=$((PORT + 50))
E2E_PORT=$((PORT + 100))
DB="rm_$SLUG" TEST_DB="rm_${SLUG}_test" E2E_DB="rm_${SLUG}_e2e"
LAB_DB_URL="$PG_BASE/$DB" TEST_DB_URL="$PG_BASE/$TEST_DB" E2E_DB_URL="$PG_BASE/$E2E_DB"

STATE="${LAB_HOME:-$HOME/.rm-lab}/$SLUG"
LOGS="$STATE/logs"
mkdir -p "$LOGS" "$STATE/shots" || die "cannot create $STATE"

# ---------- strip anything that could reach a real service ---------------------------------
SCRUB=()
while IFS= read -r v; do
  case "$v" in
    DATABASE_URL* | PROVISION_DATABASE_URL | POSTGRES_* | PG* | SUPABASE_* | NEXT_PUBLIC_* | \
      VERCEL* | RESEND_* | EMAIL_* | SMTP_* | ANTHROPIC_* | OPENAI_* | GEMINI_* | GOOGLE_* | \
      MISTRAL_* | AWS_* | TWILIO_* | WHATSAPP_* | GREEN_API_* | META_* | VAPID_* | SENTRY_* | \
      UPSTASH_* | REDIS_* | MARKETMAN_* | ZESTER_* | STRIPE_* | AUTH_* | NEXTAUTH_* | CRON_SECRET | \
      APP_URL | APP_ROLE_PASSWORD | DEMO_* | SEED_ALLOW_REMOTE_HOST | RESEED_PROJECT_REF | E2E_* | \
      FEATURES_OFF | LOCAL_SCAN_DIR | MAGIC_LINK_FILE | NODE_ENV | PORT | PLATFORM_ADMIN_EMAILS | \
      POSTHOG_* | INGEST_* | WORKER_* | BLOB_* | KV_* | \
      PROVISION_STORAGE_RLS) SCRUB+=(-u "$v") ;;
  esac
done < <(compgen -e)
clean() { env ${SCRUB[@]+"${SCRUB[@]}"} "$@"; }

# ---------- repo root (or the opt-in worktree) ---------------------------------------------
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run me from inside the RestoMatch checkout"
[[ -f "$ROOT/pnpm-workspace.yaml" && -f "$ROOT/apps/web/package.json" && -f "$ROOT/packages/db/package.json" ]] ||
  die "$ROOT is not the RestoMatch repo root"
if ((WORKTREE)); then
  WT="$STATE/wt"
  if [[ ! -e "$WT/.git" ]]; then
    log "creating a detached worktree of HEAD at $WT (uncommitted changes are NOT in it)"
    git -C "$ROOT" worktree add --detach "$WT" HEAD >"$LOGS/worktree.log" 2>&1 || die "git worktree add failed ($LOGS/worktree.log)"
  else
    git -C "$WT" checkout --detach "$(git -C "$ROOT" rev-parse HEAD)" >"$LOGS/worktree.log" 2>&1 ||
      die "worktree checkout failed ($LOGS/worktree.log)"
  fi
  ROOT="$WT"
fi
cd "$ROOT" || die "cd $ROOT"
WEB="$ROOT/apps/web"

PASSWORD="$(sed -n "s/^export const DEFAULT_DEMO_PASSWORD = '\(.*\)';.*/\1/p" packages/db/scripts/seed.ts 2>/dev/null | head -1)"
PASSWORD_NOTE="${PASSWORD:-see DEFAULT_DEMO_PASSWORD in packages/db/scripts/seed.ts}"

# ---------- process helpers ----------------------------------------------------------------
pid_alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }
stop_one() { # name
  local f="$STATE/$1.pid" pid
  [[ -f "$f" ]] || return 0
  pid="$(cat "$f" 2>/dev/null)"
  if pid_alive "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 20); do pid_alive "$pid" || break; sleep 0.5; done
    if pid_alive "$pid"; then kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null; fi
  fi
  rm -f "$f"
}
stop_all() { stop_one web; stop_one stub; stop_one worker; }
start_bg() { # name logfile cmd...   (own session + scrubbed env; stop_one stops the whole tree)
  local name="$1" logfile="$2"; shift 2
  setsid env ${SCRUB[@]+"${SCRUB[@]}"} "$@" >"$logfile" 2>&1 </dev/null &
  echo $! >"$STATE/$name.pid"
}
wait_http() { # url seconds
  local i
  for i in $(seq 1 "$2"); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  return 1
}
port_busy() {
  if command -v ss >/dev/null; then ss -Hltn "sport = :$1" 2>/dev/null | grep -q .
  else curl -s -o /dev/null --max-time 2 "http://localhost:$1/" 2>/dev/null; fi
}

print_summary() {
  local health="down"
  curl -sf -o /dev/null --max-time 3 "$URL/api/healthz" && health="up"
  cat <<EOF

[lab] $ID_UP lab: $URL  (server $health; mode: $(cat "$STATE/mode" 2>/dev/null || echo 'not served'))
[lab]   demo restaurant "כפר הזיתים", DEMO_TODAY=$DEMO_TODAY_LAB, every feature flag on
[lab]   logins, password: $PASSWORD_NOTE (local demo only)
[lab]     owner@kfar-hazeitim.test        owner
[lab]     manager@kfar-hazeitim.test      manager
[lab]     receiver@kfar-hazeitim.test     receiver (UI locale en by default)
[lab]     chef@kfar-hazeitim.test         chef
[lab]     bookkeeper@kfar-hazeitim.test   bookkeeper
[lab]   DBs (localhost): lab $DB · tests $TEST_DB · e2e $E2E_DB
[lab]   tests/e2e env:  . $STATE/env   (DATABASE_URL + DATABASE_URL_TEST = $TEST_DB, E2E_PORT=$E2E_PORT)
[lab]   shot + axe:     cd apps/web && node $STATE/shot.cjs <role|public> <path> [he|en] [390|375|1440]
[lab]   logs: $LOGS   stop: bash docs/ux/wave2/lab.sh $ID --stop
EOF
}

case "$MODE" in
  stop) stop_all; log "stopped the $ID_UP servers"; exit 0 ;;
  status) print_summary; exit 0 ;;
esac

# ---------- toolchain ----------------------------------------------------------------------
command -v node >/dev/null || die "node is missing (Node 22, see .nvmrc)"
command -v pnpm >/dev/null || die "pnpm is missing (corepack enable && corepack prepare pnpm@10.33.0 --activate)"
command -v curl >/dev/null || die "curl is missing"
command -v setsid >/dev/null || die "setsid (util-linux) is missing"
command -v psql >/dev/null || die "psql is missing (postgresql-client-16)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" == 22 ]] || log "warning: node $(node -v); the repo pins 22 (.nvmrc)"

# ---------- Postgres (local only) ----------------------------------------------------------
psql_admin() { clean PGPASSWORD="$PG_PASS" psql -h localhost -p "$PG_PORT" -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }
pg_up() {
  if command -v pg_isready >/dev/null; then pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null
  else psql_admin -c 'select 1' >/dev/null 2>&1; fi
}
if ! pg_up; then
  log "postgres is down on localhost:$PG_PORT; starting it"
  SUDO=""; [[ "$(id -u)" == 0 ]] || SUDO="sudo -n"
  if command -v pg_ctlcluster >/dev/null; then $SUDO pg_ctlcluster 16 main start >>"$LOGS/pg.log" 2>&1 || true; fi
  if ! pg_up && command -v service >/dev/null; then $SUDO service postgresql start >>"$LOGS/pg.log" 2>&1 || true; fi
  for _ in $(seq 1 30); do pg_up && break; sleep 1; done
  pg_up || die "postgres did not start (try: pg_ctlcluster 16 main start; log: $LOGS/pg.log)"
fi
psql_admin -c 'select 1' >/dev/null 2>"$LOGS/pg-auth.log" ||
  die "cannot log in as postgres:postgres@localhost:$PG_PORT (see $LOGS/pg-auth.log; the lab expects the container default postgres/postgres)"
[[ "$(psql_admin -c "select count(*) from pg_available_extensions where name = 'vector'")" == 1 ]] ||
  die "pgvector is not installed (apt-get install postgresql-16-pgvector)"

recreate_db() { # name
  psql_admin -c "drop database if exists \"$1\" with (force)" -c "create database \"$1\"" >>"$LOGS/db.log" 2>&1 ||
    die "could not re-create database $1 (see $LOGS/db.log)"
}
db_exists() { [[ "$(psql_admin -c "select 1 from pg_database where datname = '$1'")" == 1 ]]; }
migrate() { # url logfile
  clean DATABASE_URL="$1" pnpm --filter @restomatch/db migrate >>"$2" 2>&1 || { tail -20 "$2"; die "migrate failed ($2)"; }
}
app_role_url() { # url logfile -> prints the restomatch_app URL (local throwaway password)
  clean DATABASE_URL="$1" pnpm --filter @restomatch/db provision-rls --print-app-url 2>>"$2" |
    tee -a "$2" | grep -oE 'DATABASE_URL_APP=\S+' | cut -d= -f2- | tail -1
}

# ---------- dependencies -------------------------------------------------------------------
if [[ ! -f node_modules/.modules.yaml || pnpm-lock.yaml -nt node_modules/.modules.yaml ]]; then
  log "pnpm install (log: $LOGS/install.log)"
  clean pnpm install --frozen-lockfile --prefer-offline >"$LOGS/install.log" 2>&1 ||
    { tail -20 "$LOGS/install.log"; die "pnpm install failed"; }
fi

# ---------- test DB (the vitest suites TRUNCATE it; never point them at the lab DB) --------
if [[ "$MODE" == full || "$MODE" == tests ]]; then
  if ((FRESH_TEST)) || ! db_exists "$TEST_DB"; then recreate_db "$TEST_DB"; fi
  log "test DB $TEST_DB: migrate + RLS (log: $LOGS/test-db.log)"
  : >"$LOGS/test-db.log"
  migrate "$TEST_DB_URL" "$LOGS/test-db.log"
  [[ -n "$(app_role_url "$TEST_DB_URL" "$LOGS/test-db.log")" ]] || die "provision-rls failed on $TEST_DB ($LOGS/test-db.log)"
fi

# ---------- lab DB: a fresh demo at DEMO_TODAY ----------------------------------------------
APP_DB_URL="$(sed -n "s/^export LAB_DATABASE_URL_APP='\(.*\)'$/\1/p" "$STATE/env" 2>/dev/null)"
if [[ "$MODE" == full || "$MODE" == reseed ]]; then
  log "lab DB $DB: re-create, migrate, RLS, reseed the demo at $DEMO_TODAY_LAB (log: $LOGS/seed.log)"
  recreate_db "$DB"
  : >"$LOGS/seed.log"
  migrate "$LAB_DB_URL" "$LOGS/seed.log"
  APP_DB_URL="$(app_role_url "$LAB_DB_URL" "$LOGS/seed.log")"
  [[ -n "$APP_DB_URL" ]] || { tail -20 "$LOGS/seed.log"; die "provision-rls printed no app URL ($LOGS/seed.log)"; }
  clean DATABASE_URL="$LAB_DB_URL" DEMO_TODAY="$DEMO_TODAY_LAB" \
    pnpm --filter @restomatch/worker reseed:demo -- --today "$DEMO_TODAY_LAB" >>"$LOGS/seed.log" 2>&1 ||
    { tail -30 "$LOGS/seed.log"; die "reseed:demo failed ($LOGS/seed.log)"; }
  grep -E 'hero|coherent|done\.' "$LOGS/seed.log" | tail -4 | sed 's/^/[lab]   /'
elif [[ "$MODE" == serve ]]; then
  db_exists "$DB" || die "lab DB $DB does not exist yet: run once without --serve"
  [[ -n "$APP_DB_URL" ]] || APP_DB_URL="$(app_role_url "$LAB_DB_URL" "$LOGS/seed.log")"
fi

# ---------- env file + screenshot helper ----------------------------------------------------
{
  echo "# lab.sh $ID_UP: local throwaway values only. Use: . $STATE/env"
  echo "export LAB_ID='$ID_UP'"
  echo "export LAB_URL='$URL'"
  echo "export LAB_PASSWORD='$PASSWORD'"
  echo "export LAB_DATABASE_URL='$LAB_DB_URL'"
  echo "export LAB_DATABASE_URL_APP='${APP_DB_URL:-}'"
  echo "# vitest suites (they TRUNCATE) use the test DB, exactly like CI"
  echo "export DATABASE_URL='$TEST_DB_URL'"
  echo "export DATABASE_URL_TEST='$TEST_DB_URL'"
  echo "# playwright.config.ts starts its own next dev on E2E_PORT and prepares E2E_DATABASE_URL"
  echo "export E2E_PORT='$E2E_PORT'"
  echo "export E2E_DATABASE_URL='$E2E_DB_URL'"
  [[ -e /opt/pw-browsers/chromium ]] && echo "export PW_CHROMIUM_PATH='/opt/pw-browsers/chromium'"
} >"$STATE/env"

cat >"$STATE/shot.cjs" <<'JS'
// lab.sh screenshot + axe + overflow pre-check. Run from apps/web:
//   node ~/.rm-lab/<id>/shot.cjs <owner|manager|receiver|chef|bookkeeper|public> <path> [he|en] [390|375|1440] [out.png]
// Prints one JSON line. A pre-check for DoD-1/2/4; your committed e2e baselines are the evidence.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, 'env'), 'utf8').split('\n')) {
  const m = /^export (\w+)='(.*)'$/.exec(line);
  if (m) env[m[1]] = m[2];
}
const need = (m) => require(require.resolve(m, { paths: [process.cwd()] }));
const [role = 'owner', route = '/dashboard', locale = 'he', vwArg = '1440', outArg] = process.argv.slice(2);
const BASE = env.LAB_URL;
const vw = Number(vwArg);
const phone = vw < 600;
const viewport = { width: vw, height: phone ? (vw <= 375 ? 667 : 844) : 900 };
const out = outArg || path.join(__dirname, 'shots', `${route.replace(/[^a-z0-9]+/gi, '_')}__${role}__${vw}-${locale}.png`);
(async () => {
  const { chromium } = need('@playwright/test');
  const exe = env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const auth = path.join(__dirname, `auth-${role}.json`);
  const ctx = await browser.newContext({
    viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, bypassCSP: true,
    locale: locale === 'en' ? 'en-US' : 'he-IL',
    storageState: role !== 'public' && fs.existsSync(auth) ? auth : undefined,
  });
  await ctx.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
    { name: 'rm_locale', value: locale, url: BASE },
  ]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const open = async () => {
    const res = await page.goto(BASE + route, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    return res ? res.status() : 0;
  };
  let status = await open();
  if (role !== 'public' && new URL(page.url()).pathname.startsWith('/login')) {
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill(`${role}@kfar-hazeitim.test`);
    await form.locator('input[name="password"]').fill(env.LAB_PASSWORD);
    await form.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
    await ctx.storageState({ path: auth });
    status = await open();
  }
  let axe;
  try {
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js', { paths: [process.cwd()] }) });
    const v = await page.evaluate(async () => (await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    })).violations.map((x) => ({ id: x.id, impact: x.impact })));
    const bad = v.filter((x) => x.impact === 'critical' || x.impact === 'serious');
    axe = { criticalOrSerious: bad.length, ids: [...new Set(bad.map((x) => x.id))] };
  } catch (e) { axe = { error: String(e).slice(0, 120) }; }
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: true });
  console.log(JSON.stringify({ route, role, locale, vw, status, finalPath: new URL(page.url()).pathname, axe, overflowX, consoleErrors: errors.slice(0, 5), shot: out }));
  await browser.close();
})().catch((e) => { console.error('[shot] ' + String(e).slice(0, 300)); process.exit(1); });
JS

if [[ "$MODE" == tests ]]; then
  log "tests-only: test DB ready, no lab DB, no server. Run: . $STATE/env && pnpm --filter <pkg> exec vitest run <file>"
  exit 0
fi
if [[ "$MODE" == reseed ]]; then print_summary; exit 0; fi

# ---------- build + serve ------------------------------------------------------------------
[[ -n "$APP_DB_URL" ]] || die "no app-role URL for $DB (run once without --serve)"
stop_all
port_busy "$PORT" && die "port $PORT is in use by another process: pass another port (lab.sh $ID <port>)"
WEB_ENV=(
  DATABASE_URL="$LAB_DB_URL" DATABASE_URL_APP="$APP_DB_URL"
  AUTH_SECRET="lab-only-secret-not-production-0123456789-$SLUG"
  AUTH_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  NEXT_TELEMETRY_DISABLED=1
  NEXT_PUBLIC_SUPABASE_URL=https://verify-placeholder.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=verify-placeholder
)
PROD_ONLY_ENV=(
  SUPABASE_SERVICE_ROLE_KEY=verify-placeholder RESEND_API_KEY=re_verify_placeholder
  EMAIL_FROM=verify@example.invalid CRON_SECRET=verify-placeholder-cron-secret
)

if ((DEV)); then
  log "next dev on :$PORT (hot reload; it rewrites apps/web/.next, so the next production serve rebuilds)"
  echo dev >"$STATE/mode"
  start_bg web "$LOGS/web.log" bash -c 'cd "$1" && shift && exec "$@"' _ "$WEB" \
    env "${WEB_ENV[@]}" AUTH_URL="$URL" APP_URL="$URL" NODE_ENV=development pnpm exec next dev --turbopack -p "$PORT"
  wait_http "$URL/api/healthz" 180 || { tail -30 "$LOGS/web.log"; die "next dev did not start ($LOGS/web.log)"; }
else
  if ((NO_BUILD)) && [[ -f "$WEB/.next/BUILD_ID" && "$(cat "$STATE/mode" 2>/dev/null)" == prod* ]]; then
    log "reusing the existing production build (--no-build)"
  else
    log "next build (log: $LOGS/build.log; takes a few minutes)"
    (cd "$WEB" && clean "${WEB_ENV[@]}" AUTH_URL="$URL" APP_URL="$URL" pnpm exec next build) >"$LOGS/build.log" 2>&1 ||
      { grep -nE 'Error|error TS|Failed' "$LOGS/build.log" | head -20; die "next build failed ($LOGS/build.log)"; }
  fi
  echo "prod (next start)" >"$STATE/mode"
  start_bg web "$LOGS/web.log" bash -c 'cd "$1" && shift && exec "$@"' _ "$WEB" \
    env "${WEB_ENV[@]}" "${PROD_ONLY_ENV[@]}" AUTH_URL="$URL" APP_URL="$URL" NODE_ENV=production pnpm exec next start -p "$PORT"
  wait_http "$URL/api/healthz" 120 || { tail -30 "$LOGS/web.log"; die "next start did not come up ($LOGS/web.log)"; }
fi
curl -sf -o /dev/null "$URL/login" || log "warning: $URL/login did not answer 200 (see $LOGS/web.log)"

if ((STUB)); then
  if ((DEV)); then log "--stub ignored with --dev (the dev server already runs the OCR stub)"
  elif port_busy "$STUB_PORT"; then log "warning: stub port $STUB_PORT is busy; stub not started"
  else
    mkdir -p "$STATE/scans"
    start_bg stub "$LOGS/stub.log" bash -c 'cd "$1" && shift && exec "$@"' _ "$WEB" \
      env "${WEB_ENV[@]}" AUTH_URL="http://localhost:$STUB_PORT" APP_URL="http://localhost:$STUB_PORT" \
      NODE_ENV=development LOCAL_SCAN_DIR="$STATE/scans" pnpm exec next start -p "$STUB_PORT"
    start_bg worker "$LOGS/worker.log" bash -c 'cd "$1" && shift && exec "$@"' _ "$ROOT/apps/worker" \
      env DATABASE_URL="$LAB_DB_URL" NODE_ENV=development LOCAL_SCAN_DIR="$STATE/scans" PORT=$((PORT + 4600)) pnpm start
    if wait_http "http://localhost:$STUB_PORT/api/healthz" 120; then log "OCR stub (receiver capture): http://localhost:$STUB_PORT"
    else log "warning: the stub did not come up ($LOGS/stub.log)"; fi
  fi
fi

print_summary
