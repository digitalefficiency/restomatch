#!/usr/bin/env bash
# Layer-1 automated verification of every rendered promo file.
#   bash scripts/verify.sh            (from tools/promo)
# Checks: ffprobe (duration / resolution / fps / codec / no audio / size budget),
# hero-loop seamlessness (SSIM first vs last frame), key frames not blank, tsc.
set -u
cd "$(dirname "$0")/.."
WEB=../../apps/web/public/media
fail=0
ok() { echo "  PASS  $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

probe() { # file  w  h  fps  codec  min_s  max_s  max_bytes
  local f=$1 w=$2 h=$3 fps=$4 codec=$5 min=$6 max=$7 budget=$8
  [ -f "$f" ] || { bad "$f missing"; return; }
  local v a size dur
  v=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,profile -of csv=p=0 "$f")
  a=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | tr -d ,)
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | tr -d ,)
  size=$(stat -c %s "$f")
  echo "$f → [$v] ${dur}s $((size / 1024)) KB"
  [[ "$v" == "$codec,"* ]] && ok "codec $codec" || bad "codec ($v) != $codec"
  [[ "$v" == *",$w,$h,"* ]] && ok "${w}×${h}" || bad "resolution ($v) != ${w}×${h}"
  [[ "$v" == *",$fps/1"* ]] && ok "${fps} fps" || bad "fps ($v) != $fps"
  [ -z "$a" ] && ok "no audio stream" || bad "unexpected audio stream"
  awk -v d="$dur" -v lo="$min" -v hi="$max" 'BEGIN{exit !(d>=lo && d<=hi)}' && ok "duration in [$min,$max]" || bad "duration $dur not in [$min,$max]"
  [ "$size" -le "$budget" ] && ok "size ≤ $((budget / 1024)) KB" || bad "size $size > $budget"
}

echo "== ffprobe"
probe out/restomatch-promo-he.mp4 1920 1080 30 h264 59 61 $((30 * 1024 * 1024))
probe out/restomatch-promo-en.mp4 1920 1080 30 h264 59 61 $((30 * 1024 * 1024))
probe out/restomatch-promo-he-vertical.mp4 1080 1920 30 h264 20 35 $((30 * 1024 * 1024))
probe $WEB/hero-loop.mp4 1280 720 30 h264 10 14 $((2560 * 1024))
probe $WEB/hero-loop.webm 1280 720 30 vp9 10 14 $((2560 * 1024))
p=$WEB/hero-poster.jpg
[ -f $p ] && [ "$(stat -c %s $p)" -le $((150 * 1024)) ] && ok "poster $(($(stat -c %s $p) / 1024)) KB ≤ 150 KB" || bad "poster missing or > 150 KB"

echo "== hero loop seamless: the wrap step (last→first) must look like any ordinary frame step"
tmp=$(mktemp -d)
ssim() { ffmpeg -i "$1" -i "$2" -lavfi ssim -f null - 2>&1 | grep -o "All:[0-9.]*" | cut -d: -f2; }
grab() { ffmpeg -v error -y -i "$1" -vf "select=eq(n\,$2)" -vframes 1 "$3"; }
for f in $WEB/hero-loop.mp4 $WEB/hero-loop.webm; do
  n=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$f" | tr -d ,)
  grab "$f" 0 "$tmp/a.png"; grab "$f" $((n - 1)) "$tmp/b.png"
  grab "$f" 120 "$tmp/c.png"; grab "$f" 121 "$tmp/d.png"
  seam=$(ssim "$tmp/a.png" "$tmp/b.png"); base=$(ssim "$tmp/c.png" "$tmp/d.png")
  awk -v s="$seam" -v b="$base" 'BEGIN{exit !(s>=0.95 && s>=b-0.02)}' \
    && ok "$f seam SSIM=$seam vs ordinary step SSIM=$base ($n frames)" \
    || bad "$f seam SSIM=$seam vs ordinary step $base — visible jump at the loop point"
done
rm -rf "$tmp"

echo "== key frames not blank (mean luma + stddev)"
for k in out/keyframes/*.png; do
  stats=$(python3 -c "
from PIL import Image, ImageStat
im = Image.open('$k').convert('L'); s = ImageStat.Stat(im)
print(f'{s.mean[0]:.1f} {s.stddev[0]:.1f}')")
  mean=${stats% *}; sd=${stats#* }
  awk -v m="$mean" -v d="$sd" 'BEGIN{exit !(m>6 && d>8)}' && ok "$k mean=$mean sd=$sd" || bad "$k looks blank (mean=$mean sd=$sd)"
done

echo "== caption zone ∩ device zone = ∅ (all sizes, both locales)"
node --experimental-strip-types scripts/check-layout.mjs 2>/dev/null && ok "layout zones disjoint" || bad "caption/device zones intersect"

echo "== typecheck"
npx tsc -p . && ok "tsc 0 errors" || bad "tsc errors"

[ $fail -eq 0 ] && echo "LAYER 1: ALL PASS" || echo "LAYER 1: FAILURES"
exit $fail
