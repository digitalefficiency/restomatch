#!/usr/bin/env bash
# ONE command: render the promo films from the site's sample month → encode the web media.
#
#   tools/promo/scripts/rebuild.sh
#
# Every screen in the films is DRAWN from components on the sample month (src/sample.ts =
# apps/web/app/(marketing)/_components/sampleMonth.ts) — no live-app capture, no demo seed.
# The hero loops are pinned bytes (apps/web/lib/heroMedia.ts APPROVED_MEDIA_FILES) and are NOT
# re-rendered here; render them explicitly (node render.mjs loop | loop-en | loop-9x16).
# After encoding: update the SHA-256 pins in heroMedia.ts, add the replaced bytes to
# REJECTED_PROMO_SHA256, and run scripts/frame-check.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== checks"
npx tsc -p .
node --experimental-strip-types scripts/check-layout.mjs
node --experimental-strip-types scripts/check-sample.mjs

echo "== render"
for job in he en; do CONCURRENCY=${CONCURRENCY:-4} node render.mjs "$job"; done

echo "== encode web media"
bash scripts/encode-web.sh
echo "done."
