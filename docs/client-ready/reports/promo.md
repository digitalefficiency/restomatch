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
- **v2 (owner feedback):**
  - **Caption safe-zone.** `src/layout.ts` puts captions, headlines and callouts in the right 38% (RTL;
    the left 38% in English, a top band in the vertical cut). Devices, screenshots and camera moves render
    inside a clip of the other zone. `scripts/check-layout.mjs` asserts the two zones are disjoint.
  - **AE-style spotlight on the one thing each beat is about:**
    - dashboard: the ₪760 hero;
    - leak detective: the beer row (520 → 575 ₪, +10.6%);
    - approvals: the blocked card with its buttons;
    - claim letter: the total;
    - receiver: the "Cherry tomatoes / עגבניות שרי" card on the phone;
    - chain: the leakiest-branch row.

    The outside is dimmed to about 33% with a blur and a vignette. The focus rect is lifted (+exposure,
    accent glow, ×1.04), and a mask opens it from the centre line. The camera pushes in, holds about
    1.5 s, and a callout chip appears in the caption zone. All ramps are 12 frames and use the same
    easing family.
  - **Real chain beat.** I merged `claude/client-ready` (S8 PR #38) and ran `seed:chain-demo`. The beat
    now uses the real `/dashboard/chain` capture instead of the design mock.
- **Honesty rules:**
  - No ROI or savings-rate claims, and no customers.
  - "Real screen · demo data" is labelled on the product beat.
  - "₪464" is shown as *claimed from suppliers* (the dashboard's label), not "recovered".
  - The chains view is the real chain dashboard on the chain demo seed. The base branch is unchanged at
    760 ₪ = 1.8% of 42,263 ₪.
  - The paper invoices in the problem beat are props, but their math adds up: each line total is
    qty × price, the invoice total is the sum of the lines, and each supplier sells what it really sells.
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

- **S3 / approvals:** two problems in the Hebrew approvals card, both visible in the film:
  - it shows the raw English rule string "price: ±2% or ₪5";
  - its "expected 522.6" disagrees with the leak detective's median of 520.00. Same product, two
    "expected" prices on two screens.
- **S3 / leak detective:** the tiles round to "+11%" while the table says "+10.6%".
- **Demo hygiene:** my first receiver captures added test receipts to the **local** dev DB, and the
  hero moved to ₪1,481. Re-running `./scripts/dev-setup.sh` restores the clean demo (₪760 with `DEMO_TODAY=2026-10-25`). Anyone who
  clicks through the receiving demo before a live presentation should reseed afterwards.

- **S2 / receiving:** in the wizard, *"Use a demo invoice (no upload)"* → *Process invoice* on a real
  PO ends in **"Matched 0 · Missing on invoice 7"**. The client-side demo invoice doesn't match the
  PO's lines, so a demo click-through looks like a total failure. The upload path (dev OCR stub)
  works. Proposed fix: build the demo invoice from the PO lines, as the server stub does, or hide the
  button on real POs.
- **S4 / auth:** the login limiter (email + IP) locks a demo user after a handful of logins within a
  few minutes. That's right for production, but during a live demo a presenter who logs in and out a few
  times will see "CredentialsSignin" with no hint. Proposed fix: a clearer "too many attempts — try
  again in N minutes" message.

## Light version (2026-10-24)

The owner decided that the whole product goes light (#77), so the film follows:
- **Stage:** soft light stage, silver laptop and phone, the app's own light screens. Accents use the light
  product's AA tokens (primary `#066B4A`, danger `#B80F2A`, gold `#755C00`).
- **Spotlight:** on a light stage, dimming the outside reads as a grey cast. The outside is now blurred and
  washed toward the stage colour (a light fog) with a faint vignette. The lifted card keeps the same
  accent outline and glow as the dark cut.
- **No hand-measured rects any more.** `scripts/capture.mjs` measures every spotlight rect and every e-mail
  redaction from the live DOM while it captures (`src/rects.generated.json`), and reads the receiver's
  invoice lines off the real reconciliation (`src/receiver.generated.json`). A re-theme or a layout change
  is one command: `BASE_URL=… RECEIVER_PO=<uuid> tools/promo/scripts/rebuild.sh`.
- Same numbers as the dark cut: the fresh `DEMO_TODAY=2026-10-25` seed (after #79's VAT-0 produce) still
  gives ₪760 = 1.8% of ₪42,263, ₪296 caught, ₪464 claimed, 13 of 35 invoices; chain Jerusalem ₪975 · 2.9%.
- The dark stage is still one flag away (`STAGE=dark`).

## Immutable files touched

None. Outside `tools/promo`, only `apps/web/public/media/*` (the rendered deliverables) and, in #81, the
landing's per-locale media selection (`apps/web/lib/heroMedia.ts`) plus S9's pause-chip size.

## Gate

<!-- GATE -->
