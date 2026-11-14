# tools/promo — RestoMatch promo video (Remotion)

Code-driven motion design: React + [Remotion](https://www.remotion.dev) 4, rendered to H.264 MP4.
Standalone package — **own `package.json` + `package-lock.json`, not part of the pnpm workspace** (it is
outside `apps/*` / `packages/*`, so `pnpm install` at the root never touches it).

```
src/
  Root.tsx          compositions + the beat timeline (TIMELINE)
  sample.ts         the site's ONE sample month (= sampleMonth.ts) + the film's reconciled breakdown (FILM)
  copy.ts           every on-screen string (he + en), the receiver's invoice LINES (no ₪)
  transcript.ts     the per-locale text alternative of the film (→ scripts/transcript.mjs → apps/web)
  theme.ts          stage palettes (LIGHT default, DARK via STAGE=dark), fonts, the one easing family
  fonts.ts          self-hosted Heebo + JetBrains Mono (copied from apps/web/public/fonts)
  components/       Background, Devices, primitives, and the DRAWN product screens: ProductScreens
                    (owner screens), SampleCards (T1/T2/T3 cards), ReceiverScreen (receiver phone, no ₪)
  scenes/           Hook, Problem, Match, Product, Receiver, Value, Cta, HeroLoop, HeroLoopVertical
scripts/rebuild.sh  ONE command: checks → render both films → encode web media
scripts/frame-check.mjs  frame gate: every 2 s of both films + posters (Sample tag on, no ₪ in the receiver beat)
scripts/check-sample.mjs pins SAMPLE to sampleMonth.ts and reconciles every FILM figure
scripts/encode-web.sh  web deliverables in apps/web/public/media from the masters in out/
render.mjs          renders stills / videos with the preinstalled Chromium
out/                deliverables (MP4s, key frames); out/frames/ is scratch (git-ignored)
STORYBOARD.md       beats, timings, copy, sources of every number
```

## Render

```bash
cd tools/promo
npm ci
node render.mjs he          # out/restomatch-promo-he.mp4       (1920×1080, 60 s)
node render.mjs en          # out/restomatch-promo-en.mp4
node render.mjs loop        # out/hero-loop-master.mp4  → see "Hero loop" below
node render.mjs loop-en     # out/hero-loop-en-master.mp4
node render.mjs loop-9x16   # out/hero-loop-9x16-master.mp4 — portrait phone loop (he, light): two real cards at native phone scale
STAGE=dark node render.mjs he   # the original dark stage (default is light)
node render.mjs stills he 150,600,1100   # check frames → out/frames/*.png
npm run studio              # interactive preview/scrubbing (Remotion Studio)
```

Chromium: `render.mjs` points Remotion at the container's preinstalled headless shell
(the newest `/opt/pw-browsers/chromium_headless_shell-*`) — override with
`REMOTION_BROWSER=/path/to/chrome`. On a Mac with no such path, unset it and Remotion downloads its own.
`CONCURRENCY=3` (default) controls parallel frame rendering. ~10–15 min per 60 s film on 4 cores.

Encoding: H.264 High, yuv420p, CRF 18, preset slow, no audio track (`muted`).

## Change copy / locale

- All text is in `src/copy.ts` (`COPY.he` / `COPY.en`, typed — `en` must have every `he` key).
- The locale is an input prop: `{ "locale": "en" }`. RTL/LTR flips automatically (layouts mirror).
- Numbers live in `src/sample.ts` only: `SAMPLE` (= the site's sampleMonth.ts) and `FILM` (the film's
  breakdown, reconciled to SAMPLE by `scripts/check-sample.mjs`). **No other number on screen.**
- Words follow `apps/web/lib/i18n/glossary.ts` (an undecided ₪ is a "פער", never "הפסד"); the w3-06
  vitest scans `src/` for retired terms.
- No URL on screen until the domain is final; the site's dialog carries the real CTA.
- After changing copy, run `node --experimental-strip-types scripts/transcript.mjs` (the site's
  text alternative of the film is generated from COPY + SAMPLE).

## Swap in music

The film is silent by design (owner adds music). Two options:

1. **Remotion:** add `<Audio src={staticFile('audio/track.mp3')} volume={0.8} />` inside `Film` in
   `src/Root.tsx`, drop the file in `public/audio/`, remove `muted: true` in `render.mjs`, re-render.
   Beat changes for cutting music: 0:06 (problem), 0:12.5 (match), 0:15 (product), 0:33 (receiver),
   0:44 (value), 0:55 (CTA).
2. **ffmpeg, no re-render:**
   `ffmpeg -i out/restomatch-promo-he.mp4 -i track.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -af "afade=t=out:st=57:d=3" out/restomatch-promo-he-music.mp4`

Use only music you own or that is licensed for commercial use.

## Hero loop (landing, session S6)

`node render.mjs loop` renders a high-quality master; the web files are encoded from it:

```bash
ffmpeg -y -i out/hero-loop-master.mp4 -c:v libx264 -profile:v high -preset veryslow -crf 26 -pix_fmt yuv420p -movflags +faststart -an ../../apps/web/public/media/hero-loop.mp4
ffmpeg -y -i out/hero-loop-master.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -an ../../apps/web/public/media/hero-loop.webm
ffmpeg -y -i out/hero-loop-master.mp4 -vframes 1 -q:v 4 ../../apps/web/public/media/hero-poster.jpg
```

Use it as `<video autoplay muted loop playsinline poster="/media/hero-poster.jpg">` with the webm first.
The loop is Hebrew (`locale=he`); an English master is `HeroLoop` with `{ "locale": "en" }`.
