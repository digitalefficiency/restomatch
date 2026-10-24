# tools/promo — RestoMatch promo video (Remotion)

Code-driven motion design: React + [Remotion](https://www.remotion.dev) 4, rendered to H.264 MP4.
Standalone package — **own `package.json` + `package-lock.json`, not part of the pnpm workspace** (it is
outside `apps/*` / `packages/*`, so `pnpm install` at the root never touches it).

```
src/
  Root.tsx          compositions + the beat timeline (TIMELINE / VERTICAL)
  copy.ts           every on-screen string (he + en), demo FACTS, invoice LINES, SITE url
  theme.ts          ui-tokens colours, fonts, the one easing family
  fonts.ts          self-hosted Heebo + JetBrains Mono (copied from apps/web/public/fonts)
  components/       Background (ledger room), Devices (laptop / phone / Screen with focus-pull), primitives
  scenes/           Hook, Problem, Match, Product, Receiver, Chains, Value, Cta, PhoneDash, HeroLoop
public/shots/       REAL screenshots of the app (seeded demo), 2× DPR
scripts/capture.mjs re-captures public/shots from a locally running app
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
node render.mjs vertical    # out/restomatch-promo-he-vertical.mp4 (1080×1920)
node render.mjs loop        # out/hero-loop-master.mp4  → see "Hero loop" below
node render.mjs stills he 150,600,1100   # check frames → out/frames/*.png
npm run studio              # interactive preview/scrubbing (Remotion Studio)
```

Chromium: `render.mjs` points Remotion at the container's preinstalled headless shell
(`/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`) — override with
`REMOTION_BROWSER=/path/to/chrome`. On a Mac with no such path, unset it and Remotion downloads its own.
`CONCURRENCY=3` (default) controls parallel frame rendering. ~10–15 min per 60 s film on 4 cores.

Encoding: H.264 High, yuv420p, CRF 18, preset slow, no audio track (`muted`).

## Change copy / locale

- All text is in `src/copy.ts` (`COPY.he` / `COPY.en`, typed — `en` must have every `he` key).
- The locale is an input prop: `{ "locale": "en" }`. RTL/LTR flips automatically (layouts mirror).
- Numbers live in `FACTS`; each has its source in `STORYBOARD.md`. **Don't type a new number without a
  source** (AGENTS.md North Star: one ₪ number an owner believes).
- Domain placeholder: `SITE` in `copy.ts`.

## Re-capture the product screens

```bash
./scripts/dev-setup.sh                         # repo root: Postgres + Redis + seeded demo "כפר הזיתים"
pnpm --filter @restomatch/web dev &            # http://localhost:3000
(cd apps/worker && set -a && . ../web/.env.local && set +a && pnpm start &)   # worker (else a "worker down" banner shows)
cd tools/promo && node scripts/capture.mjs     # ONLY=desktop | ONLY=receiver to do half
```

It logs in with the seed's demo password (one login per user — the login rate limiter is strict),
sets the locale + cookie-consent cookies, and captures at 1440×900 / 390×844 with deviceScaleFactor 2.
The receiver run uploads a 1×1 PNG so the local dev OCR stub produces a real reconciliation
(`reconcile-en.png`) — it writes one receipt + invoice into your **local** dev DB.

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
