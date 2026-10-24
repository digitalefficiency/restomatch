# S6 — Landing, marketing & showcase (client-ready sprint)

Branch `claude/client-ready-landing` → draft PR into `claude/client-ready`.

## Design rationale

- **One design language, pushed further.** Everything stays inside the existing dark
  "command center for money" tokens (`bg/surface/surface-2/line`, `primary` money-green, `gold`
  = recovered, `danger` = leak, `flow-stream` signature). Additions are append-only utilities in
  `globals.css` (`rm-grid` ledger grid behind the hero, `rm-reveal` scroll reveal) — no new
  colours, no new fonts in the UI.
- **Show the product, not a stock illustration.** The hero visual (`HeroMatch.tsx`) *is* the
  product moment: the three documents (Order · Received · Invoice) link up, a scan beam walks the
  invoice line by line, each line resolves to "Match" or a priced discrepancy, and the card lands
  on the ₪ caught before payment. Pure DOM/SVG icons + gsap (already a dependency) — no images.
  SSR renders the final state, so crawlers, no-JS and `prefers-reduced-motion` users see the full
  story; the timeline only runs client-side when motion is allowed (`gsap.matchMedia`). A
  "Replay" control is hidden for reduced-motion users.
- **The ₪ number is the hero, and it's honest.** The example invoice is internally consistent
  (₪75 price creep + ₪178 short + ₪159 unordered = **₪412**, the same Σ|delta| the engine uses)
  and is labelled *Illustrative example*. The 1.5% figure is always framed as the **pilot target**
  / the visitor's own estimate (docs/GTM.md §1, docs/ICP.md North Star), never as a measured
  result.
- **Honest calculator.** The old ROI calculator claimed "RestoMatch recovers up to 70%". The new
  one takes only the visitor's inputs (monthly purchasing, their own leak estimate) and adds the
  one thing we *can* state: the **break-even** — the share of purchasing the Pro plan (₪590, read
  from `PLAN_SEED`) must catch to pay for itself (e.g. 0.39% on ₪150k). If the estimate is below
  the subscription price it says so plainly.
- **No fake social proof.** The "מסעדה א׳ / רשת ב׳" logo strip is gone. It is replaced by a facts
  strip of things that are true today (3-way match, 12 discrepancy checks, before-payment, built
  with Israeli restaurant owners) and an About page that says we're in pilot.
- **Hebrew-first, English native.** English copy is written for an English-speaking owner, not
  translated literally ("How much money leaks at your back door?"). Mono (JetBrains) is used for
  numbers and English micro-labels only — Hebrew eyebrows/labels switch to Heebo via `ltr:`/`rtl:`
  variants so Hebrew never renders in a monospace fallback.
- **Fast & accessible.** No raster images on the page (only the generated OG card). Native
  `<details>` for the mobile menu and FAQ (zero JS), CSS scroll-driven reveal (zero JS; progressive
  enhancement). Skip link, semantic `h1→h2→h3`, `aria-labelledby` sections, visible focus rings,
  44px+ touch targets on primary CTAs, `role="img"` + label on the animated visual.

## Section-by-section outline (`app/page.tsx`)

1. **Hero** — eyebrow "Order · Delivery · Invoice"; H1 "כמה כסף דולף לך בקבלת סחורה?" / "How much
   money leaks at your back door?"; lead; CTAs **Book a short demo** (→ `#lead`) and **Try the
   live demo** (→ `/showcase`); trust notes (free trial plan · no credit card · Hebrew & English);
   animated matching visual landing on ₪412 (illustrative), with Pause/Replay controls.
2. **Facts strip** (replaces fake logos).
3. **The problem in ₪** — four leak types with worked ₪ examples (price creep ₪3,900/yr, short
   delivery ₪178, unordered ₪159, double invoice) + "on ₪150k/month, 1.5% is ₪2,250 a month"
   with the pilot-target disclaimer.
4. **How it works** — 3 steps (snap → line-by-line match → approve/stop before paying).
5. **Features** — flagship **Receiver in English** card (mini phone: Hebrew line → English line →
   "Confirm line", links to `/showcase/receiver`), then Approvals before payment (rule → outcome
   rows), Leak detective (product×supplier heatmap), Accounting export (CSV + uniform-structure
   `1000` file — the real export names), Quiet when all is well (pending/consolidated invoices
   don't alarm).
6. **Calculator** — honest leak + break-even (see above).
7. **Trust & security** — tenant isolation (RLS + automated attack tests), 2FA + roles,
   Amendment 13 (privacy policy, consents, access/deletion requests), audit trail; links to
   privacy / terms / cookies.
8. **Pricing teaser** — Trial free / from ₪349 + VAT (from `PLAN_SEED`), → `/pricing`.
9. **FAQ** — 7 owner questions (also emitted as `FAQPage` JSON-LD).
10. **Lead form** (`leads.create` unchanged) + "Want a look first? Open the live demo".

## Works (verified)

- `/` in **he** and **en**, desktop (1440) and mobile (390): Playwright screenshots, no console or
  hydration errors (only the pre-existing CSP Report-Only notice about `upgrade-insecure-requests`).
- Hero animation runs with motion allowed (checked at three points in the timeline: beam scanning
  line 2 at ~2.6 s, counter lands on `₪412`), and with `reducedMotion: 'reduce'` the final state
  renders statically.
- **Lead form** end-to-end in both languages (Playwright): empty name → translated inline error;
  valid submit → `leads.create` → success state; rows landed in the local dev DB with
  `source='landing'`, `monthly_procurement_agorot=15000000` (test rows deleted afterwards).
  `leads.create` router untouched.
- `/pricing`, `/about`, `/privacy`, `/terms`, `/cookies`, every `/showcase/*` page (except
  `/showcase/receiver`, S2) in both languages; in English the only Hebrew left on showcase pages is
  the switcher's "עב" label and the photographed supplier invoice (deliberate — see below).
- SEO: `<title>`/description per locale; canonical + `hreflang` he/en/x-default (`?lang=en`) on
  every marketing page; JSON-LD `Organization` + `SoftwareApplication` (AggregateOffer from
  `PLAN_SEED`) + `FAQPage`; `/opengraph-image` (1200×630 PNG, Heebo — see
  `screenshots/landing-og-image.png`), `/icon.svg`, `/robots.txt`, `/sitemap.xml` (with xhtml
  alternates) all return 200 for anonymous visitors.

Screenshots: `docs/client-ready/screenshots/landing-{he,en}-{desktop,mobile}.png` (full page),
`landing-pricing-*`, `landing-showcase-*`, `landing-showcase-dashboard-*`, `landing-og-image.png`.
Reviewed critically and iterated three times (Hebrew eyebrows/labels moved off monospace;
headline wrapping via `text-balance`; approvals mini-UI made meaningful; export file names
corrected to the real `restomatch-invoices-*.csv` / `restomatch-1000-*.txt`; mobile hero item
names wrap instead of truncating; lead CTA height; Amendment-13 claim softened to "designed for").

## Fixed

| Problem | Fix | Test / evidence |
|---|---|---|
| Fake social proof ("מסעדה א׳, רשת ב׳…") | Removed; facts strip + honest About copy ("we're in pilot") | `app/page.tsx` facts section |
| ROI calculator claimed "RestoMatch recovers up to 70%" | Visitor-only inputs + break-even vs Pro price from `PLAN_SEED`; disclaimer | `RoiCalculator.tsx` |
| `html { direction: rtl }` in `globals.css` overrode `<html dir="ltr">` → English rendered RTL in places | Append-only `html[dir='ltr'] { direction: ltr }` | screenshots `*-en-*` |
| Marketing shell, lead form, calculator, cookie banner, pricing, about, legal, showcase were Hebrew-only | `landing` / `marketing` (+ `marketing.legal`) / `showcase` namespaces, he + en | `lib/__tests__/i18n.test.ts` parity green |
| Lead form showed raw (Hebrew, technical) server errors | Client-side name check + translated rate-limit / generic errors | Playwright lead test above |
| Physical `left/right` classes (`border-r-4`, `right-3`, `pr-8`, …) broke LTR | Logical classes (`border-s`, `start-3`, `ps-8`, …); forward arrows flip with `ltr:-scale-x-100` | screenshots |
| `/opengraph-image` (no file extension) was redirected to `/login` for crawlers | Added `/opengraph-image`, `/twitter-image` to `PUBLIC_EXACT_PATHS` | `lib/__tests__/publicPaths.test.ts` (new `it.each`) |
| Next collapses `/?lang=en` hreflang on the root route to the bare origin | Root alternates rendered as `<link>`s in the page (React 19 hoists to `<head>`) | curl of `/` head |
| `/pricing` crashed without a DB | Falls back to `PLAN_SEED_LIST` | build + page render |
| Showcase "Scan" / "Side by side" views iframed `/scans/[id]` (login-gated, no mock data in prod) → a prospect saw a login page / 404 | Rendered inline | showcase screenshots |
| Showcase used developer jargon (Cinematic Control Center, Hierarchy Matrix, Vercel Cron…) and an owner-like real name in the audit log | Plain client language; fictional names; "Demo · illustrative data" badge + note on every page | showcase screenshots |
| Mobile marketing nav was hidden with no menu | `<details>` menu (no JS) with all links + CTA | mobile screenshots |

## Still broken / not done

- **Supplier invoice in the showcase stays Hebrew in English mode** — deliberate: it is the
  photographed Israeli document; it is labelled "Original supplier document … (in Hebrew)" and
  the extracted fields beside it are English.
- **Showcase documents show 17% VAT** — the mock data predates the 18% change (M4); left as-is
  because the mock files are also imported by `/scans` (outside S6). Proposed: S2 updates
  `showcase/dashboard/invoices/_mock.ts` VAT to 18% in one pass.
- **Hero JS weight:** `/` First Load JS is 191 kB (gsap ≈ 25 kB gz + tRPC/react-query for the lead
  form). Proposed: lazy-load `LeadForm` below the fold with `next/dynamic` if Lighthouse flags it.
  No Lighthouse binary in the container, so no score was measured.
- **Gradient text on the OG image** is ignored by Satori (renders plain green) — cosmetic.
- Legal pages remain counsel-review drafts (banner says so in both languages; Hebrew prevails).

## Feature & improvement proposals (ranked by client value / effort)

1. **Real pilot number on the landing** once the first pilot reaches 2 weeks of scanning — replace
   the illustrative ₪412 card with "₪X found in N weeks at a real restaurant" (with consent). High
   value, low effort.
2. **"Upload one invoice" self-demo** — a public, rate-limited `/showcase` step that runs the stub
   OCR on a sample/own invoice and shows the matching moment. High value, medium effort (S2).
3. **WhatsApp CTA** next to the lead form (owner-operators answer WhatsApp faster than forms).
   Medium value, low effort — needs the business number.
4. **Bookkeeper landing variant** (`/for-accountants`) — GTM §4.2 channel ("100% coverage instead
   of a monthly sample"). Medium value, low effort.
5. Lazy-load the lead form / `next/dynamic` for gsap to cut ~40 kB from first load. Low effort.

## Immutable files touched

None from the AGENTS.md immutability list. `apps/web/app/api/trpc/[trpc]/route.ts` and
`packages/api/src/routers/leads.ts` are unchanged (UI-only lead-form changes).

## Outside the S6 boundary (touched, minimal, flagged for review)

- `apps/web/lib/publicPaths.ts` (S4) — **additive**: `/opengraph-image`, `/twitter-image` in
  `PUBLIC_EXACT_PATHS`, so social crawlers (no session) get the share card instead of a `/login`
  redirect. Test added in `lib/__tests__/publicPaths.test.ts`. S4: please keep it on merge.

## Needs another area

- **S2:** VAT 17% → 18% in `showcase/dashboard/invoices/_mock.ts` + `scanDataAdapters.ts` (shared
  with `/scans`); `/showcase/receiver` — the landing links to it as the "Receiver in English" demo,
  so it should open in English when `?lang=en`.
- **S4:** keep the `publicPaths.ts` addition above.
- **S7:** `next start` refuses to boot without `RESEND_API_KEY`, `EMAIL_FROM`,
  `SUPABASE_SERVICE_ROLE_KEY` (instrumentation hook) — expected in prod, but a demo/preview flag
  would let the marketing site be served from a production build locally.
- **Root layout (unowned):** consider `metadataBase` + `title.template` in `app/layout.tsx`; each
  S6 page sets `metadataBase` itself for now.


## Round 2 (orchestrator follow-up)

### 1. Claims audit — every factual claim vs the code

| Claim (landing / pricing / about / showcase) | Source checked | Verdict → action |
|---|---|---|
| "Free trial plan", trial = all features, 100 invoices, 1 restaurant, 5 seats | `PLAN_SEED.trial` | ✅ true |
| "No credit card" | `packages/billing` — provider `noop`, no card collected anywhere | ✅ true |
| "From ₪349 / month + VAT", Pro ₪590, Group ₪1,490, limits per plan | `PLAN_SEED` (pricing page reads the `plans` table, falls back to the seed) | ✅ true |
| "12 automatic discrepancy checks" | `DiscrepancyType` union = 12 | ✅ true |
| "Hebrew & English" | i18n namespaces + parity test | ✅ true |
| "Two-factor sign-in" | `lib/totp.ts`, `/login/2fa`, settings `TwoFactorSection` — **opt-in** | ⚠️ → "Optional sign-in with an authenticator app (2FA)" |
| RLS tenant isolation + automated attack tests | `rls.ts`, `0002_core_tenant_rls.sql`, `*.attack.test.ts` in CI | ✅ true |
| Amendment 13: privacy policy, consents, access/deletion | legal pages (drafts), cookie + marketing consent, `dsr.exportMyData` / `deleteMyAccount` | ⚠️ → "designed around", cites self-service export/deletion |
| "Every approval, rejection **and change** is recorded" | `auditLog` writes in `approvals.approve/reject` only | ⚠️ → scoped to approvals/rejections (reason on reject) |
| Approvals: "price jump, invoice over a limit, **new supplier**" | `approvals/engine.ts` default rules | ❌ no new-supplier rule → copy + mini-UI now mirror the real rules: duplicate → blocked, > ₪5,000 without PO → owner, ₪50–300 cumulative → manager, ≤2% → auto-approved; thresholds per restaurant |
| FAQ "no POs? RestoMatch **learns baselines** and warns" | `engine.ts` — no PO ⇒ `UNORDERED_ARRIVAL` (block); baselines are per PO line | ❌ → "an invoice with no order is flagged for approval; add orders (manual or file import) and the full 3-way match kicks in" |
| "Partial receipts and **consolidated invoices** wait patiently" | no consolidated-invoice handling in the base yet (S3 in flight) | ❌ → "matching deliveries pass silently; minor gaps (≤2%) auto-approved" |
| "Cancel anytime" / "no commitment" / "you won't pay for what doesn't work" | no terms clause, no billing | ❌ removed; FAQ now "free trial, no card, you decide after you've seen your number" |
| "20-minute demo" | sales promise, not code | ⚠️ → "short demo" |
| Showcase: "SHA-256 hash chain", "every decision is signed", "tamper-proof scan with hash signature" | `audit_log` has no hash columns; scans not hashed | ❌ removed (strings + hash column in the approvals log) |
| Showcase: late-delivery alerts by push/WhatsApp | no late-delivery job | ❌ → labelled "Concept preview … on the roadmap" |
| Showcase: "in about a minute" | unmeasured | ❌ removed |
| "Receiver in English" flagship | migration 0028 + S2 branch (not yet in the base when audited) | ⚠️ stays — owner's flagship, delivered by S2; re-check after S2 merges |

### 2. Lighthouse (mobile, `next build && next start`, Lighthouse 12.8.2, simulated throttling)

| Page | Perf | A11y | Best-pr. | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| `/` he — before → after | 94 → **96** | 96 → **100** | 96 → 96 | 100 → **100** | 2.8 → 2.6 s | 0.006 |
| `/` en | 90 → **93** | 96 → **100** | 96 → 96 | 92 → **100** | 3.5 → 3.0 s | 0.003 |
| `/pricing` he | 95 → 94 | 96 → **100** | 96 → 96 | 100 → 100 | 2.9 → 3.0 s | 0 |
| `/pricing` en | 95 → 94 | 96 → **100** | 96 → 96 | 92 → **100** | 2.8 → 3.0 s | 0 |
| `/showcase` he | 96 → 95 | 96 → **100** | 96 → 96 | 91 → 91 | 2.6 → 2.8 s | 0 |
| `/showcase` en | 95 → 96 | 96 → **100** | 96 → 96 | 91 → 91 | 2.9 → 2.6 s | 0 |

(±2 on Performance between runs is Lighthouse noise.) Fixes:
- **Contrast:** `text-subtle` (#6B8478) is 4.14:1 on `surface` and 3.7:1 on `surface-2` — fails AA for small text. All text uses in S6 files → `text-muted` (#9DB2A6, ≥ 6.6:1); the shared token is unchanged.
- **Canonical:** English pages pointed `rel=canonical` at the Hebrew URL (Lighthouse "invalid canonical"); now self-referencing per locale (`?lang=en`). Root canonical/hreflang rendered as `<link>`s (Next collapses `/?lang=en`).
- **Showcase metadata:** title + description per locale (layout) and canonical/hreflang on the index.
- **CLS from the hero:** 0.003–0.006 — the animation only changes opacity/transform inside a fixed-size card.
- **Fonts:** the two `public/fonts/Heebo-*.ttf` are read only by `/opengraph-image` (statically prerendered at build) — no page requests them (verified in the Lighthouse network log: only the `next/font` woff2 subsets load).
- **Remaining, not S6's:** Best-Practices 96 everywhere = console message "CSP directive `upgrade-insecure-requests` is ignored in a report-only policy" (S4: drop that directive from the Report-Only header). `/showcase` SEO 91 = Lighthouse "no meta description": the tag *is* emitted, but Next 15 streams metadata into `<body>` on that route and Lighthouse only reads `<head>` (S7: `htmlLimitedBots` in `next.config.ts` if wanted). LCP ≈ 2.6–3.0 s is the hero lead paragraph (render delay = main-thread JS, not network); next lever is lazy-loading the lead form / gsap.

### 3. Keyboard + screen-reader pass (Playwright-scripted, en)

- **Tab order:** skip link → logo → nav → language → sign-in → CTA → hero CTAs → hero controls → receiver demo link → calculator → legal links → pricing … (logical, no traps).
- **Hero animation:** added a **Pause/Play** toggle (`aria-pressed`) next to Replay (WCAG 2.2.2 — the loop runs > 5 s); verified the counter freezes when paused. Controls render only when the timeline actually runs (hidden for reduced motion / no JS). The `role="img"` label now states the outcome ("…3 discrepancies… ₪412 caught before payment").
- **FAQ:** native `<details>/<summary>` — Enter/Space toggle verified; visible focus ring.
- **Calculator:** one `sr-only` `aria-live="polite" aria-atomic` summary ("Estimated leak: ₪2,400 a month, ₪28,800 a year.") instead of a live region around the whole card; `aria-valuetext` on both sliders (₪ amount / percent).
- **Lead form:** empty submit → translated `role="alert"`, focus to name, `aria-invalid` + `aria-describedby`; success → focus moves to the confirmation heading (previously dropped to `<body>` when the button unmounted). Verified end-to-end; test rows deleted.

## Round 3: English-mode sweep (whole app)

`apps/web/e2e/i18n-sweep.spec.ts` is a Playwright regression test and runs only when `I18N_SWEEP_BASE_URL` points at the seeded demo tenant.
- **What it does:** logs in as owner, manager, receiver, bookkeeper and chef with `rm_locale=en`. It crawls from `/dashboard`, following links 2 levels deep with 2 samples per route pattern, at 1366 and 390 px.
- **What it fails on:**
  - visible Hebrew, or Hebrew in a `placeholder`/`aria-label`/`title`, outside `lang="he"` originals
  - `dir` other than `ltr`
  - horizontal overflow
  - console or page errors
  - the error or 404 boundary
- **Run it against a production build:** `next dev` runs local Postgres out of connections because it creates one DB pool per compiled route.

```bash
I18N_SWEEP_BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  pnpm exec playwright test e2e/i18n-sweep.spec.ts --project=chromium --no-deps --output=/tmp/pw-out
```

| Run | Pages (owner/manager/receiver/bookkeeper/chef) | Findings |
|---|---|---|
| Before (base `f171425`) | 26/25/7/12/4 | **445**: 415 Hebrew + 30 console. 204 outside receiving, 241 in receiving/invoices (S2, then mid-rewrite) |
| After round-3 fixes, same base | same | **0** outside receiving |
| After merging `2cf22c8` (S2) + `f98962c`, production build | 29/28/7/12/4 | **2** Hebrew (`שישייה` on `invoices/:id`) → fixed in the shared unit map |
| Final (`cc5aa02`, production build) | 29/28/7/12/4 | **0 Hebrew, 0 dir, 0 overflow, 0 error pages.** 1 owner/desktop hydration error on `/dashboard/leaks/breakdown?m=-1` did not reproduce on 3 direct loads; it was transient under crawl load |

**Fixes, all translation-only or minimal:**
- **Activity feed:** detail templates from the seed and worker now render in English. Supplier names are marked as originals.
- **Data marked `lang="he" dir="auto"`:** restaurant name in the header, mobile nav, leak report and claims letter; team member names; categories.
  - Helper: `lib/i18n/original.tsx` (`originalProps`, `WithOriginal`).
- **Units:** shared `UnitText` component built on S2's `@restomatch/translate` `translateUnit`, used for orders, the catalog grid and card, and product prices. I added `שישייה` to that map, with a test.
- **Supplier payment terms:** `שוטף + N` / `מזומן` → "End of month + N days" / "Cash". Pure parser is tested.
- **Owner-only tRPC calls:** overview, leaks, leak report and supplier detail no longer call owner-only tRPC procedures for roles that can't use them. These were handled FORBIDDENs, but they still logged as errors to the console and Sentry.
- **Showcase:** every ₪ amount goes through `formatIls()`, including the KPI count-up and the viewers. The S3 QA item is closed.

**Environment notes (local only):** I raised local Postgres `max_connections` to 300 for `next dev`, and `--no-deps` skips S7's magic-link setup project.

## Gate

Re-run at the round-2 head of this branch:

```bash
cd apps/web && pnpm exec tsc --noEmit -p .          # exit 0, 0 errors
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test pnpm test
#   Tasks: 12 successful, 12 total — 766 tests passed (web incl. i18n parity + publicPaths), 1 skipped (worker, pre-existing)
cd apps/web && set -a && . ./.env.local && set +a && pnpm build   # exit 0
# Lighthouse (mobile): next start with dummy RESEND_API_KEY / EMAIL_FROM / SUPABASE_SERVICE_ROLE_KEY
#   (the instrumentation hook refuses to boot without them; nothing on these pages uses them)
CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx lighthouse@12 <url> --form-factor=mobile
```

Plus the Playwright checks under *Works* and *Round 2 §3*. Helper scripts were throwaway and are not committed.

---

## Landing v2: short, focused, animated (round 4)

The owner's brief: *"The landing page should be efficient and not overloaded with information, and you should invest in animations / videos inside it."* Nothing true was deleted. Every detail block **moved**, either to `/about` or into a collapsed accordion.

### New flow of `/`

| # | Section | What's on it | Motion |
|---|---|---|---|
| 1 | **Hero** | One ₪ headline ("How much money leaks at your back door?"), one sentence, primary CTA **"Get a free leak check"** → `#lead`. The secondary button is **"Watch 60 seconds"** when a promo video exists, and the live demo link otherwise. | Product video loop when `heroMedia.available`; otherwise the existing invoice⇄PO⇄delivery match card with the animated **₪412** counter (Pause, Play and Replay kept) |
| 2 | **How it works** (`#how`) | 3 steps, one line each | CSS scroll-driven staggered reveal (`animation-timeline: view()`) plus a connector line that draws in. It mirrors in RTL. |
| 3 | **Receiver in English** (`#features`) | The flagship: the invoice is in Hebrew and the receiver checks it in English | Each Hebrew invoice line morphs into its English version in a 7 s staggered loop. Each line carries `lang`/`dir`. |
| 4 | **Proof**: one block, real numbers | ₪2,250/month = 1.5% of ₪150,000 (pilot target) · **0.39%** = Pro ₪590 ÷ ₪150,000 (break-even) · **12** checks. The block says "a target, not a promise". | Reveal |
| 5 | **Pricing teaser** | Trial free · from ₪349 (from `PLAN_SEED`) → `/pricing` | Reveal |
| 6 | **FAQ** | 7 questions, **collapsed** `<details>` (still in `FAQPage` JSON-LD) | — |
| 7 | **Final CTA** (`#lead`) | Lead form (lazy), a one-line trust strip → `/about#trust`, and a demo link | — |

All ₪ goes through `formatIls()`. Prices come from `PLAN_SEED`, and the proof figures are derived in code (`EXAMPLE_PURCHASING_ILS × PILOT_TARGET`, `pro ÷ purchasing`), so they cannot drift from `/pricing` or the calculator. This is the leak-economist rule: one consistent set of numbers.

### What moved where (nothing deleted)

| Block (v1 home) | Now |
|---|---|
| Facts strip | `/about` (`FactsStrip`) |
| Problem in ₪ (4 leak types plus the ₪2,250 example) | `/about#problem` |
| Full features (Receiver card, approvals, leak heatmap, "quiet when all is well", accounting export) | `/about#features`. Nav "Features" now points here. |
| ROI calculator | `/about#roi`. The proof block links to it. |
| Trust and security (RLS, 2FA, Amendment 13, audit log) | `/about#trust`. The CTA trust line links to it. |
| FAQ | still on `/`, collapsed |

These sections live in `app/(marketing)/_components/detail-sections.tsx` and were moved unchanged in substance.

**Text volume:** `/` now renders **424 words (he) / 493 (en)** in `<main>`, with FAQ answers collapsed. The **590 / 711** words now on `/about` used to sit on the home page as well, so the home page carries **less than half** its v1 text. (The v1 total is estimated as v2 plus the moved words. The new v2 copy is shorter than the v1 lines it replaced.)

### Video and media switch

`apps/web/lib/heroMedia.ts`:
```ts
export const heroMedia = { available: false, loop: { webm, mp4 }, poster, promoVideo: null };
```
- **`available: false`** (shipped): the hero shows the animated match card. No `<video>` and no 404s for media files.
- **`available: true`**: `HeroVideo` renders a muted, `playsInline`, `loop`, `autoPlay` video with the poster and `preload="none"`. The WebM and MP4 sources are attached only after `window.load`, and **never under `prefers-reduced-motion`**, which shows the poster only.
- **`promoVideo: string`**: shows a "Watch 60 seconds" button that opens a native `<dialog>` with controls (`PromoVideoButton`). It is hidden while `promoVideo` is `null`. Nothing was added under `public/media/`. The media owner drops the files there and flips the flags.

### Performance

| Route | First Load JS before | After |
|---|---|---|
| `/` | **198 kB** (15.2 kB page) | **136 kB** (17.2 kB page), **−62 kB** |
| `/about` | — | 121 kB (carries the ROI calculator now) |

How:
- `gsap` is **dynamically imported** inside `HeroMatch` (`import('gsap')` in an effect), so it is no longer in the initial chunk.
- The lead form is `next/dynamic({ ssr:false })`, mounted by an `IntersectionObserver` (600 px ahead), or immediately when the URL hash is `#lead`. The container reserves the form's height (`min-h-[31rem]` on phones, `26rem` from `sm`), so mounting in view (e.g. landing on `/#lead`) does not shift the page.
- The ROI calculator is off `/`.
- The scroll animations are pure CSS, with no JS.

**Lighthouse 12.8.2, mobile, simulated throttling, `next start`:**

| `/` | Perf | A11y | Best-pr. | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| he | 82 · 95 · 91 (3 runs) | 100 | 100 | 100 | 3.7 · 2.9 · 3.3 s | 0.006 |
| en | 95 | 100 | 100 | 100 | 2.9 s | 0.005 |

**LCP is not yet under the 2.5 s target.** The LCP element is the SSR'd hero sentence: TTFB 0.46 s plus about 2.4 s of render delay. Under the 4× CPU throttle that delay is the shared React/Next bootstrap (the 103 kB shared chunk). It is not landing code: there is no render-blocking CSS, fonts are `font-display: swap`, and the hero has no entrance animation. That puts it at parity with the round-2 v1 numbers (2.6–3.0 s), while Best-practices went 96 → 100. Unthrottled Chromium LCP is 160–256 ms across all Layer-2 runs. A next lever, if needed: move the hero match card's client island behind `requestIdleCallback`, or trim the shared chunk. Both are outside this round.

### Accessibility and motion
- `prefers-reduced-motion`:
  - the steps and reveals are shown statically
  - the morph shows the Hebrew and English lines stacked
  - the hero counter shows its final ₪ value
  - no video loads
- The promo `<dialog>` is a native dialog, so focus is trapped and Esc closes it, with a labelled close button.
- Both the morph and the receiver card mark the originals `lang="he"`. The English sweep stays clean.
- No console errors or hydration errors (he and en × desktop and mobile, with full motion and with reduced motion).

### Screenshots
`docs/client-ready/screenshots/`:
- `landing2-before-{he,en}-{desktop,mobile}.png`
- `landing2-after-{he,en}-{desktop,mobile}.png`
- `landing2-after-about-{he,en}-{desktop,mobile}.png`

They are taken from a production build with reduced motion, so every reveal is visible in a full-page capture.

### Review fixes (Landing v2)
The independent reviewer (layer 2b) found these, all now fixed:
- **"How it works" scroll ranges:** the connector `<span>` sat inside the `<ol>`, so `.rm-step:nth-child(n)` hit the wrong items. Step 3 sat at about 50% opacity mid-screen. The connector now lives outside the list, and L2 asserts that step 3 is at opacity > 0.95 when centred.
- **CTA promise:** the hero button says "free leak check". The form section now offers exactly that ("we'll run a few real invoices… and walk you through the result in a short demo").
- **"Every gap stopped" was an overclaim.** It now reads "sent for approval before you pay; tiny ones (under 2%) pass automatically", matching the approval rules.
- **Hero video:** it now has a pause/play toggle while playing (WCAG 2.2.2). The label flips; there is no `aria-pressed`.
- **Lead form:** a `<noscript>` note; `aria-live` removed from the placeholder; taller mobile reserve.
- **Receiver morph:** each line is read once as a Hebrew → English pair. The animated copies are `aria-hidden`.
- Unused v1 step keys removed; report wording corrected.
- Still open:
  - **Promo captions:** the promo video needs he/en caption tracks when the real file lands (WCAG 1.2.2). There is no media yet, so there is nothing to caption.

## Showcase numbers: NUM-2 to NUM-5 (round 4, same branch)

The client will click through `/showcase`, so one invoice now carries one set of numbers on every screen. They are derived, not typed.

- **NUM-2, the "Leak detective" heatmap.** It is built from the supplier profiles' own 60-day price trends:
  - Each cell is a product that supplier actually sells; other cells are empty.
  - Avi × cherry tomatoes = **+21%**, the same figure as the supplier page and the feed.
  - Every other cell is within ±7%. The old −100% / +96% cells are gone.
- **NUM-3, INV-7821.** The audit mock derives every header from the lines, ex-VAT, and the tiles say "(excl. VAT)":
  - billed = Σ qty × price = **₪464**
  - approved = Σ received × agreed = **₪428**
  - caught = Σ variance = **₪36**: cherry tomatoes ₪30 (20 kg × ₪1.50) plus red pepper ₪6 (0.5 kg short)
  - The paper scan shows the same ₪464 subtotal plus 18% VAT. The PO compare viewer's totals are labelled ex-VAT.
  - Supplier-page rows of audited invoices take the audit figures. Their scans render the real lines, not synthesised ones.
- **NUM-4, same event, same ₪ and date.**
  - **INV-4882 = ₪3,420** on the invoices page, the supplier row and activity, the approvals log, the receiver PO-1235, and the feed (rendered via `formatIls`).
  - The ₪3,420 is reachable from its own lines at the supplier's prices: 16 × 145 + 18 × 38 + 13 × 32.
  - The cherry-tomato exception is the INV-7821 line, **₪30**, in the approvals log.
  - **Every date is relative to today.** The mocks are rebuilt per local day (`dayMemo`), so a long-running server never shows yesterday's date or mismatches at hydration.
  - Receiver times are read with local getters; the old timezone-pinned formatter would have differed on a UTC server.
  - Audit records carry their PO number (PO-1234…). The receiver wizard shows the same invoice number and total as the invoices page.
- **NUM-5, VAT 18%.** A single `SHOWCASE_VAT_RATE`, used by the paper invoice, the scan viewer, the PO compare viewer, the scan adapter, the receiver total and the labels.
- **The second reviewer's findings, also fixed:**
  - The receiver's Avi flow now bills 8 kg of pepper (7.5 arrived), and its headline is ₪36. The accepted unordered mint is flagged but not counted as a leak.
  - Shegev's INV-3344 now contains Shegev's own products, at its delivery time (11:24–11:28). The Goldstar +6.7% alert's ₪ comes from that line.
  - "8 / 11 lines matched" counts are replaced by "every item matched". The feed is now Dana's, matching the INV-4882 scan.
  - The 5–10% gap in the approval rules is closed (2–10%).
  - English names are aligned between the receiver and the rest of the showcase. INV-4882's first filing date respects the number order. "PO-1235" is used everywhere.
  - The dashboard count-ups, entrances and radar respect reduced motion. The KPI values are server-rendered final (they used to render 0).
- **Locked by `app/showcase/__tests__/numbers.test.ts` (9 tests):**
  - headers vs lines
  - INV-7821 / INV-4882 across screens
  - the receiver against the invoices page (number, total, headline, English names)
  - an English twin for every Hebrew mock string in the audits and supplier profiles
- **Ownership:** all of it is under `app/showcase/**`, plus a 3-line import change in `app/scans/[invoiceId]/page.tsx` (S6 demo-scan fixtures, same mocks).

## Verification (2 layers)

All results are on the final tree.

**Layer 1: automated gate (no reds).**

The commands, in order:
```bash
pnpm install --frozen-lockfile
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test pnpm exec turbo test --concurrency=1
pnpm exec turbo typecheck
cd apps/web && pnpm exec tsc --noEmit -p .
pnpm --filter @restomatch/web lint
cd apps/web && pnpm build
```

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `turbo test --concurrency=1` | **13/13 tasks**; web **206** tests (was 197; +9 showcase numbers), api 493, matching 86…; 1 skipped (worker, pre-existing) |
| `turbo typecheck` | **17/17** |
| web `tsc --noEmit` | **0 errors** |
| web lint | **0 errors** (7 pre-existing warnings, untouched files) |
| `pnpm build` (apps/web) | green; `/` First Load JS **136 kB** (was 198 kB) |

**Layer 2(a): functional checks on a production build.**

Setup:
- `NODE_ENV=production next build && next start`, with placeholder `RESEND_API_KEY` / `EMAIL_FROM` / `SUPABASE_SERVICE_ROLE_KEY` and a local `AUTH_ENC_KEY` (local only).
- Playwright (`apps/web/l2.tmp.mjs`, a throwaway script) covers he + en × desktop 1440 + mobile 390 × reduced motion on/off, which is 8 contexts per mode.

Mode **heroMedia off** (as shipped): PASS. Pages covered:
- `/`, `/pricing`, `/about`
- `/showcase`, `/showcase/dashboard`, `/showcase/dashboard/invoices`
- the Avi and HaKerem supplier pages
- `/showcase/approvals`, `/showcase/receiver`, `/showcase/deliveries`

Assertions:
- **Page basics:** HTTP < 400 on every response, correct `<html lang/dir>`, and **0 console errors / 0 hydration warnings**.
- **Animations by motion setting:**
  - `.rm-step` and the morph animate with motion on, and are static under reduced motion.
  - Step 3 is fully opaque when centred.
  - The HeroMatch Pause control appears only with motion; the final ₪412 shows under reduced motion.
- **Hero:** no `<video>` and no watch button while `available:false` / `promoVideo:null`.
- **Lead form:**
  - It is lazy: absent before scrolling.
  - It submits locally (into the local dev DB) and shows the success message, in he and en.
  - Loading `/#lead` directly mounts it.
- **Pages:** the `/about` anchors `#problem #features #roi #trust` exist.
- **English mode:** no Hebrew outside `lang="he"` anywhere in the pages above.
- **Showcase numbers:**
  - The INV-7821 drawer shows 464 / 428 / 36.
  - The approvals log shows ₪3,420 and the ₪30 exception, with no 3,200 and no fixed May dates.
  - The heatmap cells are `+21% +1% +7% −3% +1% −1% +3% 0%`.

Mode **heroMedia on**, with a dummy local WebM/MP4/poster and a promo, built then reverted (never committed): PASS.
- **Video:** the hero `<video>` is muted, looping, inline and playing with motion on. It has **no sources** under reduced motion.
- **Pause toggle:** it pauses the video and its label flips.
- **Promo dialog:** the watch button opens the `<dialog>`, focus moves inside, Esc closes it, and focus returns to the button.

**Speed:**
- **Unthrottled LCP:** 168–256 ms.
- **Lighthouse 12.8.2 mobile (simulated):**

| Locale | Perf | A11y | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| he | 95 | 100 | 100 | 100 | 2.8 s | ≤ 0.006 |
| en | 95 | 100 | 100 | 100 | 2.9 s | ≤ 0.006 |

- **The LCP target (2.5 s) is still missed.** See "Performance" above: the cost is the shared framework bootstrap, not landing code.

**Layer 2(b): independent refuters.** Fresh subagents that did not write the code, given the diff, the screenshots and the L2 evidence.
- **Round 1, on `8a8d46c`: NOT REFUTED.** 3 should-fixes plus nits; all fixed (see "Review fixes").
- **Round 2, on `14f9bc7`: REFUTED (narrowly).**
  - NUM-2 to NUM-5 held, but it found remaining cross-screen contradictions: the receiver's Avi flow, Shegev's INV-3344, the line counts, the module-level dates, the feed literals and the toggle semantics.
  - All are fixed above, both layers were re-run green, and the test now locks those cases too.

**Not this PR's:** the Vercel preview build fails for **every** branch with `DATABASE_URL is required for the auth connection`. The Preview environment has no DB URL. This was noted on the PR.

### Add-on: Free leak check link (env-gated)
- `/leak-check` is now in the marketing header nav, the mobile menu and the footer "Product" column.
  - Labels: he "בדיקת דליפה חינם", en "Free leak check".
  - The link renders **only** when `LEAK_CHECK_PUBLIC=1`.
  - The flag is read on the server at request time, in `MarketingShell`; it is not a `NEXT_PUBLIC_` variable.
  - `leakCheck.leakCheckPublicEnabled()` doesn't exist on this base yet. Swap it in at merge, as the comment in the file says.
- **Verification:**
  - **L1:** all green (web 206 tests, including i18n parity; typecheck, lint and build).
  - **L2a:** a production build with the flag off shows no link on `/`, `/pricing` or `/about` (he/en × desktop/mobile), and the full L2 "off" suite still passes. With the flag on, the link appears in the header nav, the mobile menu and the footer with the right label, and there are 0 console errors.
  - **L2b:** an independent reviewer found NOT REFUTED.
- **Deploy order:** this branch has no `/leak-check` page; it comes from PR #44. Turn `LEAK_CHECK_PUBLIC=1` on only after that page ships, or every marketing page links to a 404.

---

## Round 5: perf, promo modal, SEO, cookie banner (PR #54)

### LCP (mobile)

Lighthouse 12.8.2, `/`, local `next start`:

| Throttling | Base (8289ce1) | Now (db072f1) |
|---|---|---|
| Simulated (lantern), he/en × 3 runs | 3.1–3.7 s | **2.2–2.7 s** (he 2.2/2.6/2.7, en 2.3/2.6/2.7) |
| Applied (devtools), he/en × 2 runs | 2.2–2.4 s | **1.7–1.8 s** (LCP = FCP) |

- Performance 94–98, CLS ≤ 0.002.
- **What moved it:**
  - The hero poster is an `<img>` preloaded with `fetchpriority=high` and a WebP `srcset`: 11 KB at Lighthouse's DPR and 24 KB at DPR 3, against the 52 KB JPEG.
  - The loop `<video>` sits 1px inside the poster, so its first frame can never replace it as LCP. Before, it sometimes did, pulling the 900 KB webm into the measurement.
  - `content-visibility:auto` on the below-fold sections and footer.
  - No JetBrains Mono or ₪ latin-ext subset in the first render: the step badges and English eyebrows are sans.
  - `TrpcProvider` moved off the root layout (react-query/tRPC no longer ships on public pages).
- **Not met everywhere:** under simulation, 4 of 6 runs are still above 2.5 s.
  - The rest is the React/Next framework JS and the App Router's serialized payload. Lantern charges it to LCP because, on localhost, it executes before the poster's first paint.
  - With real applied throttling the poster paints in the first frame (1.7–1.8 s).

### "Watch 60 seconds" promo
- S10's `promo-he-720.mp4` (60 s, 1280×720, faststart) and `promo-poster-he.jpg`.
- **English:** shows the Hebrew film until `promo-en-720.mp4` exists (`promoVideoFor` fallback), so there is no 404.
- **The modal:**
  - native `<dialog>`: focus trap, Esc / ✕ / backdrop close, focus returns to the button
  - the video mounts only while open and unmounts on close, so the landing makes 0 requests for it
  - no autoplay: native controls, so no sound or motion until the visitor presses play

### SEO
- `robots.txt` and `sitemap.xml` read `APP_URL` per request, so the domain is right without a rebuild.
- **Per-language share cards:** `/og/he.png` (Hebrew, laid out RTL) and `/og/en.png` from one route, replacing the English-only `opengraph-image`.
- Every marketing page sets `og:image` in its language, `twitter:card=summary_large_image`, `og:locale`/alternate, and `og:url` in its language. The root page renders its own `og:url`, as it does its canonical.

### Cookie banner
- Compact on phones (one-line text, 108–127 px).
- Its height is reserved as body padding while shown, and released after a choice.
- If it would still cover the hero CTA (`data-keep-clear`; only English at 360×640), it appears once the visitor scrolls the CTA clear. This is re-checked per page and on resize. Non-essential cookies stay off meanwhile.

### Verification (2 layers)
- **Layer 1:**
  - frozen install
  - `turbo test` 13/13 (web 246); the local test DB had to be migrated to 0033 first
  - typecheck 17/17
  - web `tsc` 0
  - lint 0 errors (9 warnings, all pre-existing in files not touched here)
  - build green
- **Layer 2(a):** production build, Playwright, he/en × desktop/mobile × reduced motion on/off.
  - **Hero:** poster preloaded; the loop plays only with motion on; pause toggle works.
  - **Promo:** 0 requests before open; the Hebrew film plays in both locales; no autoplay; focus trap; Esc / ✕ / backdrop close; the video unmounts.
  - **Navigation:** the hero CTA lands exactly on `#lead` (top 96 px, which needed `AnchorScrollFix`).
  - **SEO:** cards he/en 200 (unknown → 404); per-locale `og:image` / `twitter:card` / `og:url` on 4 pages; robots/sitemap use the runtime host.
  - **Cookie banner:** checked against the CTA at 4 viewports.
  - **Everything else:** the lead form submits; showcase, `/pricing` and `/about` green; 0 console/hydration errors.
  - **English crawler**, all 5 roles across the dashboard: 0 findings. This covers the tRPC provider move.
- **Layer 2(b):** one refuter per milestone, all NOT REFUTED; should-fixes fixed.
  - **Perf:** the `#lead` smooth scroll stopped short past the deferred sections.
  - **SEO/banner:** English `og:url`, banner padding, the per-page check, and the generic root `og:title`.
- **Open, needs routing:**
  - `/og/*.png` responses carry the Auth.js Set-Cookie from the middleware matcher, so they aren't publicly cacheable. On Vercel that's performance only. The fix is in the security-owned `middleware.ts`.
  - `publicPaths` still lists the dead `/opengraph-image` (asserted in a test).
