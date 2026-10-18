# S10 — Promo video (client-ready sprint)

Branch `claude/client-ready-promo` → draft PR into `claude/client-ready`.

**Headline:** a 60-second Hebrew promo plus an English version from the same composition, a vertical
social cut, and the landing hero loop for S6. It is all code-driven motion design (Remotion 4 + React)
rendered here with the preinstalled Chromium. The product footage is **real**: the app ran locally on
the seeded demo tenant "כפר הזיתים", and Playwright captured the screens at 2× DPR. Every ₪ number on
screen comes from that seed and its dashboard (sources in `tools/promo/STORYBOARD.md`).

## Deliverables

<!-- DELIVERABLES -->

## How it was made

- **Standalone package** `tools/promo/` with its own `package.json` and `package-lock.json` (npm). It is
  outside the `apps/*` / `packages/*` workspace globs, so the root lockfile and pnpm workspace are
  untouched.
- **Fonts:** Heebo (variable, Hebrew + Latin subsets) and JetBrains Mono, copied from
  `apps/web/public/fonts`. They load via `FontFace` + `delayRender`, so no frame renders in a fallback
  font. Hebrew is real RTL text (`dir="rtl"`), and English layouts mirror automatically from the
  `locale` prop.
- **Motion language:**
  - One easing family: expo-out for entrances, in-out for camera moves.
  - Three accents from `ui-tokens`: primary green, danger rose, gold.
  - Effects: masked kinetic type, a slot-machine ₪ reel with vertical motion blur (an SVG directional
    blur driven by reel velocity), speed-blur on flying invoices, and 3D device mockups with a
    keyframed virtual camera.
  - Also: focus pulls (blurred and dimmed everything outside a radial window), light-wipe screen
    transitions, specular sweeps, a periodic "ledger room" background (perspective grid, light pools,
    particles), and the Hebrew→English line morph (a scan beam re-typesets each invoice line).
- **Real screens:** `tools/promo/scripts/capture.mjs` captures the dashboard, leak detective, approvals
  and claims letters (he + en, 1440×900 @2×). It also captures the receiver flow in English on a phone
  viewport. To do that it uploads a 1×1 PNG, and the local dev OCR stub returns a real "Check result"
  reconciliation with English lines and the Hebrew originals.
- **Honesty rules:**
  - No ROI or savings-rate claims, and no customers.
  - "Real screen · demo data" is labelled on the product beat.
  - "₪276" is shown as *claimed from suppliers* (the dashboard's label), not "recovered".
  - The chains view is a designed card labelled "Design concept · in development". It shows relative
    bars only, no ₪ figures and no fake screenshot.
  - The URL `restomatch.co.il` is a placeholder (`SITE` in `copy.ts`).

## Iteration (stills reviewed before rendering)

I rendered stills across the whole timeline and reviewed each one. Fixes made from that review:
- The specular sweep rendered as a grey box (screen blend). It now uses an overlay blend.
- The ₪ glyph in the reel was oversized.
- The problem copy wrapped mid-phrase and collided with the invoice pile.
- The receiver title wrapped ("…לא קורא / עברית?").
- A duplicate caption overlapped the phone.
- A "worker down" banner and the cookie banner appeared in the first captures. The worker is now
  started for real, and the consent cookie is set.

## Found while capturing (needs another area)

- **S2 / receiving:** in the wizard, *"Use a demo invoice (no upload)"* → *Process invoice* on a real
  PO ends in **"Matched 0 · Missing on invoice 7"**. The client-side demo invoice doesn't match the
  PO's lines, so a demo click-through looks like a total failure. The upload path (dev OCR stub)
  works. Proposed fix: build the demo invoice from the PO lines, as the server stub does, or hide the
  button on real POs.
- **S4 / auth:** the login limiter (email + IP) locks a demo user after a handful of logins within a
  few minutes. That's right for production, but during a live demo a presenter who logs in and out a few
  times will see "CredentialsSignin" with no hint. Proposed fix: a clearer "too many attempts — try
  again in N minutes" message.

## Immutable files touched

None. Nothing under `apps/web` was changed except the three new media files S6 asked for
(`apps/web/public/media/hero-loop.{mp4,webm}`, `hero-poster.jpg`).

## Gate

<!-- GATE -->
