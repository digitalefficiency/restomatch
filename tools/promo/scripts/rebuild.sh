#!/usr/bin/env bash
# ONE command: re-capture the live app → render every cut → encode the web media → commit.
#
#   BASE_URL=http://localhost:3000 RECEIVER_PO=<uuid> tools/promo/scripts/rebuild.sh [--no-commit]
#
# Needs the app running on BASE_URL against the demo seed (DEMO_TODAY=… ./scripts/dev-setup.sh +
# seed:chain-demo) and the worker (receiver OCR). Spotlight rects are measured from the DOM during
# capture (src/rects.generated.json), so a re-theme or layout change needs no hand edits.
# The receiver capture uploads an invoice to RECEIVER_PO (a PO expected on the demo's "today"),
# which changes the demo DB — reseed after running this.
set -euo pipefail
cd "$(dirname "$0")/.."
COMMIT=1
[ "${1:-}" = "--no-commit" ] && COMMIT=0

echo "== capture (${BASE_URL:-http://localhost:3000})"
ONLY=desktop node scripts/capture.mjs
ONLY=chain node scripts/capture.mjs
LOCALES=en ONLY=receiver node scripts/capture.mjs # last: it writes a receipt into the demo DB

echo "== checks"
npx tsc -p .
node --experimental-strip-types scripts/check-layout.mjs

echo "== render"
for job in he en vertical loop loop-en; do CONCURRENCY=${CONCURRENCY:-4} node render.mjs "$job"; done

echo "== encode web media"
bash scripts/encode-web.sh

if [ "$COMMIT" = 1 ]; then
  cd ../..
  git add tools/promo/public/shots tools/promo/src/rects.generated.json tools/promo/out/*.mp4 \
    apps/web/public/media docs/client-ready/screenshots/promo
  git commit -m "chore(promo): re-capture + re-render all cuts from the live app ($(date -u +%FT%RZ))"
fi
echo "done."
