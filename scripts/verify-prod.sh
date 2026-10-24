#!/usr/bin/env bash
# Read-only smoke of a deployed RestoMatch web app (layer 2 against a live URL).
#
#   scripts/verify-prod.sh https://restomatch.example.com
#
# Only GET requests, no login, no writes — safe against production. Checks:
#   1. /api/healthz → 200 and "status":"ok"
#   2. landing in Hebrew and English → 200 with the right <html lang/dir>
#   3. the hero video + poster referenced by the landing → 200/206 with a media type
#   4. /login → 200 and renders the product name
#   5. public paths → no 5xx (and no 404 for pages that must exist)
#   6. an unknown path → 404, or (anonymous) the auth redirect to /login — never a 5xx
# Prints a PASS/FAIL table; exits 1 if anything failed, 2 on bad usage.
set -uo pipefail

ORIGIN="${1:-}"
if [[ -z "$ORIGIN" || "$ORIGIN" == -* ]]; then
  echo "usage: $0 <origin>   e.g. $0 https://app.example.com" >&2
  exit 2
fi
ORIGIN="${ORIGIN%/}"
TIMEOUT="${VERIFY_TIMEOUT:-20}"
UA="restomatch-verify-prod/1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ROWS=()
row() { # status name detail
  ROWS+=("$(printf '%-4s  %-34s  %s' "$1" "$2" "$3")")
  if [[ "$1" == PASS ]]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
}

# fetch <path> <outfile> [extra curl args…] → prints "<status> <content-type>"
fetch() {
  local path="$1" out="$2"
  shift 2
  curl -sS -o "$out" -A "$UA" --max-time "$TIMEOUT" -w '%{http_code} %{content_type}' "$@" "$ORIGIN$path" 2>"$TMP/curl.err" ||
    echo "000 curl:$(head -c 120 "$TMP/curl.err" | tr '\n' ' ')"
}

# 1. Liveness
read -r code _ < <(fetch /api/healthz "$TMP/healthz")
if [[ "$code" == 200 ]] && grep -q '"status":"ok"' "$TMP/healthz"; then
  row PASS "healthz" "200 $(grep -o '"commit":[^,]*' "$TMP/healthz" || true)"
else
  row FAIL "healthz" "status $code"
fi

# 2. Landing he/en — locale comes from the rm_locale cookie (or ?lang=)
landing() { # locale expected-dir
  local loc="$1" dir="$2" out="$TMP/landing-$1.html" code html
  read -r code _ < <(fetch "/?lang=$loc" "$out" -H "Cookie: rm_locale=$loc")
  html="$(grep -o '<html[^>]*>' "$out" 2>/dev/null | head -1)"
  if [[ "$code" != 200 ]]; then
    row FAIL "landing ($loc)" "status $code"
  elif [[ "$html" != *"lang=\"$loc\""* || "$html" != *"dir=\"$dir\""* ]]; then
    row FAIL "landing ($loc)" "expected lang=$loc dir=$dir, got: ${html:0:80}"
  else
    row PASS "landing ($loc)" "200 lang=$loc dir=$dir"
  fi
}
landing he rtl
landing en ltr

# 3. Hero media referenced by the landing page in either language (the English landing has
#    its own loop/poster/promo cut) — fails if a page stops pointing at its media.
mapfile -t MEDIA < <(cat "$TMP/landing-he.html" "$TMP/landing-en.html" 2>/dev/null | grep -oE '/media/[A-Za-z0-9._-]+\.(webm|mp4|jpg|jpeg|png|webp)' | sort -u)
if [[ ${#MEDIA[@]} -eq 0 ]]; then
  row FAIL "hero media" "landing references no /media/* asset"
else
  for m in "${MEDIA[@]}"; do
    read -r code ctype < <(fetch "$m" "$TMP/media" -r 0-1023)
    if [[ ("$code" == 200 || "$code" == 206) && "$ctype" =~ ^(video|image)/ ]]; then
      row PASS "asset $m" "$code $ctype"
    else
      row FAIL "asset $m" "status $code type ${ctype:-?}"
    fi
  done
fi

# 4. Login page
read -r code _ < <(fetch /login "$TMP/login")
if [[ "$code" == 200 ]] && grep -q 'RestoMatch' "$TMP/login"; then
  row PASS "/login" "200"
else
  row FAIL "/login" "status $code"
fi

# 5. Public paths: must exist (2xx/3xx). Any 4xx/5xx here is a broken deploy.
PUBLIC=(/ /pricing /about /privacy /terms /cookies /login /reset /showcase /robots.txt /sitemap.xml /icon.svg)
for p in "${PUBLIC[@]}"; do
  read -r code _ < <(fetch "$p" "$TMP/page")
  if [[ "$code" =~ ^[23] ]]; then
    row PASS "GET $p" "$code"
  else
    row FAIL "GET $p" "status $code"
  fi
done

# 6. Not-found handling. Anonymous requests to non-public paths are redirected to
#    /login by the middleware; anything else must be the 404 page.
read -r code _ < <(fetch /verify-prod-definitely-missing "$TMP/missing")
loc="$(curl -sS -o /dev/null -A "$UA" --max-time "$TIMEOUT" -w '%{redirect_url}' "$ORIGIN/verify-prod-definitely-missing" 2>/dev/null || true)"
if [[ "$code" == 404 ]]; then
  row PASS "unknown path" "404"
elif [[ "$code" =~ ^30[1278]$ && "$loc" == *"/login"* ]]; then
  row PASS "unknown path" "$code → /login (anonymous)"
else
  row FAIL "unknown path" "status $code ${loc:+→ $loc}"
fi

echo "verify-prod: $ORIGIN"
printf '%s\n' "${ROWS[@]}"
echo "---- $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
