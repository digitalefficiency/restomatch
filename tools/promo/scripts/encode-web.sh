#!/usr/bin/env bash
# Encode the web deliverables from the rendered masters in out/ (only the ones that exist):
#   promo-{he,en}-720.mp4 + promo-poster-{he,en}.jpg
#   hero-loop{,-en}.{mp4,webm} + hero-poster{,-en}.jpg + hero-poster{,-en}-{768,1280}.webp
# All H.264 High, yuv420p tv-range, faststart, silent. Frame grabs for review → docs/client-ready/screenshots/promo/.
set -euo pipefail
cd "$(dirname "$0")/.."
M=../../apps/web/public/media
G=../../docs/client-ready/screenshots/promo
mkdir -p "$M" "$G"
q() { ffmpeg -v error -y "$@"; }

for l in he en; do
  src=out/restomatch-promo-$l.mp4
  [ -f "$src" ] || continue
  q -i "$src" -vf scale=1280:720:flags=lanczos -c:v libx264 -profile:v high -preset slow -crf 23 \
    -pix_fmt yuv420p -color_range tv -movflags +faststart -an "$M/promo-$l-720.mp4"
  q -ss 18.7 -i "$src" -frames:v 1 -vf scale=1280:720 -q:v 4 "$M/promo-poster-$l.jpg"
  for t in 5.5 18.7 49; do q -ss "$t" -i "$M/promo-$l-720.mp4" -frames:v 1 "$G/$l-720-${t}s.jpg"; done
  echo "✓ promo $l: $(stat -c %s "$M/promo-$l-720.mp4") B"
done

loop() { # master suffix
  local src=$1 sfx=$2
  [ -f "$src" ] || return 0
  q -i "$src" -c:v libx264 -profile:v high -preset veryslow -crf 21 -pix_fmt yuv420p -color_range tv -movflags +faststart -an "$M/hero-loop$sfx.mp4"
  q -i "$src" -c:v libvpx-vp9 -b:v 0 -crf 33 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p -an "$M/hero-loop$sfx.webm"
  q -i "$src" -vframes 1 -q:v 3 "$M/hero-poster$sfx.jpg"
  for w in 768 1280; do q -i "$M/hero-poster$sfx.jpg" -vf "scale=$w:-1" -c:v libwebp -quality 78 "$M/hero-poster$sfx-$w.webp"; done
  cp "$M/hero-poster$sfx.jpg" "$G/hero-poster$sfx.jpg"
  echo "✓ hero loop$sfx: mp4 $(stat -c %s "$M/hero-loop$sfx.mp4") B, webm $(stat -c %s "$M/hero-loop$sfx.webm") B"
}
loop out/hero-loop-master.mp4 ""
loop out/hero-loop-en-master.mp4 "-en"

if [ -f out/restomatch-promo-he-vertical.mp4 ]; then
  q -ss 9 -i out/restomatch-promo-he-vertical.mp4 -frames:v 1 -vf scale=540:-1 "$G/he-vertical-9s.jpg"
fi
