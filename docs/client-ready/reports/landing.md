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
   money leaks at your back door?"; lead; CTAs **Book a 20-minute demo** (→ `#lead`) and **Try the
   live demo** (→ `/showcase`); trust notes (free trial plan · no credit card · Hebrew & English);
   animated matching visual landing on ₪412 (illustrative).
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

## Gate

Run at the final commit of this branch:

```bash
cd apps/web && pnpm exec tsc --noEmit -p .          # exit 0, 0 errors
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test pnpm test
#   Tasks: 12 successful, 12 total — 766 tests passed (web: 137, incl. i18n parity for
#   landing / marketing / showcase and the new publicPaths case), 1 skipped (worker, pre-existing)
cd apps/web && set -a && . ./.env.local && set +a && pnpm build   # exit 0; / = 13.8 kB, 191 kB first load
```

Plus the Playwright checks described under *Works* (screenshots, animation timeline, lead form in
he + en). Helper scripts were throwaway and are not committed.
