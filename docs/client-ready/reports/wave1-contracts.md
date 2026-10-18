# Wave 1 — S11: supplier contract prices (`contracts`) + price-trend alerts (`priceAlerts`)

Branch `claude/wave1-contracts` → draft PR into `claude/client-ready`. Migrations **0046–0047** (`when`
1782010000000 / 1782020000000). Both features are behind `featureEnabled(restaurant.settings, …)`; the seeded
demo tenant has `features.all = true`; `FEATURES_OFF=contracts,priceAlerts` kills them fleet-wide.

> **תקציר לבעלים:** אפשר להזין/לייבא (CSV/XLSX) מחירון חוזי לכל ספק עם תאריכי תוקף. כל שורת חשבונית נבדקת מול
> מחיר החוזה שבתוקף בתאריך החשבונית; חריגה מופיעה כפער "מחיר גבוה" שהמחיר הצפוי בו הוא מחיר החוזה, ותג "מעל החוזה"
> בחשבונית ובדף הדליפות. בנוסף: התראות מגמת מחיר ("עגבניות +18% ב-3 שבועות") עם הצעת ספק זול יותר, ספים לפי ספק
> ולפי קטגוריה, תצוגה בדאשבורד ומייל דרך תור ההתראות (לא נשלח בפועל מקומית). מספרי הדמו הקיימים לא זזו.

## What was built

### 1. Contract price lists (`contracts`)
- **Table** `supplier_contract_prices` (0046): `(supplier, product, unit, contract_price NUMERIC(12,4), valid_from,
  valid_to, source manual|import, note)`. Same-tenant **composite FKs** `(supplier_id, restaurant_id)` and
  `(product_id, restaurant_id)` (adds `UNIQUE(id, restaurant_id)` on `products`, additive — `id` is the PK), CHECKs
  (price ≥ 0, `valid_to ≥ valid_from`, source enum), unique `(supplier, product, valid_from)`, `updated_at` trigger.
  **RLS is enabled inside the migration** (same policy shape as `rls/0002`; `rls/*.sql` untouched per the
  integrator), so `check-rls` passes without the 0002 list — the integrator may also list the 3 tables there.
- **The rule** (`packages/api/src/contracts/core.ts`, documented in code):
  1. A row covers `[valid_from, valid_to]` — restaurant-local calendar dates, inclusive, `valid_to` NULL = open.
  2. In force on the invoice's **local date** = covering row with the latest `valid_from` (renegotiation supersedes).
  3. **Contract beats PO, as a ceiling**: when the PO price is above the contract (or missing), `buildMatchInput`
     replaces the PO line's `unitPriceExpected` with the contract price, so an over-contract line is a **PRICE_HIGHER
     whose expected value is the contract price**. A PO priced *at or below* the contract stands — otherwise a
     supplier billing the lower PO price would surface as a PRICE_LOWER that the engine adds to the leak.
  4. A contract without a unit is quoted in the product's default unit; prices convert with the engine's own
     kg↔g / l↔ml table; no unit anywhere or an unconvertible unit ⇒ the contract is not applied (never guess).
  5. "Over contract" badge = billed price above contract **outside the restaurant's price tolerance band** — exactly
     when the engine would emit PRICE_HIGHER against it. Computed read-side for every invoice line (with or without a
     PO); it never adds to the leak figure (invoices without a PO are already counted whole by UNORDERED_ARRIVAL).
- **Engine changes: none.** `packages/matching/**` untouched; the 12-type union and the leak-canary are unchanged.
  The only match-path change is `packages/api/src/match/buildMatchInput.ts` (+14 lines, feature-gated: flag off ⇒
  byte-identical input).
- **Import**: CSV/XLSX through the catalog parser (`parseCatalogFile` — same size/zip-bomb/legacy-xls guards and
  `CATALOG_FILE_<code>` errors), Hebrew+English header auto-mapping incl. "בתוקף מ / עד", ISO and Israeli D/M/YYYY
  dates. Products resolve by the supplier's catalog SKU → exact canonical name → catalog raw name; unknown products
  are **reported, never created**; unusable cells (impossible date, `1e3`/`(5)` prices, >32-char or formula units)
  skip the row with a reason instead of being guessed; upsert on `(supplier, product, valid_from)`.
- **tRPC** `contracts.*`: `access` (member, never throws — flags for the UI), `list, productOptions, create, update,
  delete, importPreview, importCommit, overContractForInvoice, overContract` — reads finance-tier
  (owner/manager/bookkeeper), writes manager-tier.

### 2. Price-trend alerts + thresholds (`priceAlerts`)
- **Tables** (0047): `price_alert_thresholds` (scope supplier and/or category, `threshold_pct` 0–5, `window_days`
  7–120, one rule per scope incl. NULL scopes via an expression unique index) and `price_alerts` (start/end price,
  pct, window, observations, cheaper supplier + price, open/dismissed, dedupe key per last-observation day).
- **Detection** (`priceAlerts/detect.ts`, pure): observations collapsed to one per day (two lines on one invoice are
  one point); ≥ 3 days in the window, latest ≥ first × (1+threshold), the later half all ≥ first × (1+threshold/2)
  (a one-off spike is not "sustained"), and the latest point in the newer half of the window (no stale alerts). A
  (product, supplier) with an open alert, or one dismissed within its window, is not re-alerted (no repeat emails). Threshold
  resolution: supplier+category > supplier > category > restaurant default > built-in (10% / 21 days).
- **Cheaper supplier**: the same `product_id`'s latest observed price at another supplier (≤ 90 days) or an active
  catalog list price converted to the product's unit (pack prices and unconvertible units are ignored), when
  strictly lower.
- **Delivery**: `runPriceAlertSweep` writes the in-app rows; with `notify` it enqueues one email per owner/manager
  through `enqueueNotification` (dedupe `price-alert:<id>:<email>`). New worker job `price-alerts`, scheduled daily
  07:00 IL. Nothing is sent locally (outbox only; dispatch is the existing worker + provider config).
- **tRPC** `priceAlerts.*`: `list, dismiss, refresh, thresholds, setThreshold, deleteThreshold, openCount`.

### 3. UI (`apps/web`, namespace `contracts` he/en)
- `/dashboard/contracts` — tabs *Contract prices* (table + supplier filter, add/edit/delete for owner/manager,
  read-only for bookkeeper, "Over contract — last 90 days" table + total), *Price alerts* (cards "Tomatoes +18% over
  3 weeks at HaSharon", ₪6.20 → ₪7.32, cheaper-supplier hint, dismiss, "check now", show dismissed), *Alert
  thresholds* (rules per supplier/category/default). `/dashboard/contracts/import` — CSV/XLSX wizard (preview →
  column mapping → default dates → summary with translated skip reasons).
- Supplier page: a **Contract** tab. Invoice view: an **"over contract"** badge per line (tooltip: contract vs
  billed). Leaks page: a compact over-contract card. Overview: price-alert teaser. Nav: "Contracts & alerts" with the
  open-alert count.
- Gating: one non-throwing `contracts.access` call per request (flags + open count; finance roles only); everything
  hides when the flag is off; the route renders the 404 page (HTTP 200 because the dashboard `loading.tsx` streams —
  same for every dashboard `notFound()`); `/dashboard/contracts` is finance-only in `lib/roles.ts` (receiver/chef are
  redirected).
- Screenshots: `docs/client-ready/screenshots/wave1-*-{he,en}[-manager].png`.

### 4. Demo data — `apps/worker/scripts/seed-wave1-contracts-demo.ts` (new, idempotent; `seed.ts` untouched)
- HaKerem Butchery + Mediterranean Fish Co.: a price list in force from **2026-10-10** (10 rows) at the PO prices of
  the invoices it covers. **Hero-number guarantee is analytic**: a product is kept only if every matched PO line of it
  on an invoice dated ≥ 2026-10-10 carries exactly the contract price, so the contract override leaves every engine
  input byte-identical. Over-contract lines: salmon ₪96 vs ₪89 (+₪52.50), entrecôte ₪149 vs ₪139 (+₪100.00).
- Tomatoes at HaSharon Produce ₪6.20 → ₪7.32 over 3 weeks (**+18%**), cheaper offer ₪6.40 at new supplier
  "חקלאי העמק" → 1 open alert.
- Leak total before/after: **₪1,859.62 = ₪1,859.62** (the script aborts if it moves). Wired into
  `scripts/dev-setup.sh` (non-fatal).

## Fixed on the way
- **Outbox dedupe never worked against real Postgres** (`packages/api/src/notifications/outbox.ts`):
  `ON CONFLICT (dedupe_key)` cannot infer the **partial** unique index `WHERE dedupe_key IS NOT NULL`, so every
  enqueue with a `dedupeKey` (supplier-delays, order-reminders, end-of-day, …) raised *"no unique or exclusion
  constraint matching the ON CONFLICT specification"*. Only a mocked test covered it. Fix: repeat the predicate as
  the conflict target `where`. Test: `contracts.test.ts` › "outbox dedupe against real Postgres".

## Immutable files touched (owner review)
| File | Change | Why |
|---|---|---|
| `packages/db/src/schema.ts` | +3 tables appended, `date` import | new migrations 0046–0047 |
| `packages/db/drizzle/meta/_journal.json` | +2 entries | 0046, 0047 |
| `packages/api/src/notifications/outbox.ts` | conflict-target `where` (5 lines) | bug above — every deduped enqueue failed |
| `apps/worker/src/cron.ts` | +1 scheduler `price-alerts-07` (+remove) | daily trend sweep |
| `packages/api/src/__tests__/cross-tenant.attack.test.ts` | +17 COVERAGE entries + attack/isolation block | required for new procedures (additive) |
| `packages/api/src/__tests__/rls.attack.test.ts` | + raw RLS probes for the 3 tables | additive |
Not touched: `packages/matching/**` (engine, union, canary), `rls.ts`, `plans.ts`, billing, approvals, leads, rate limit.

Shared files (additive): `packages/api/src/index.ts` (routers/exports), `packages/api/src/errors.ts`
(`FEATURE_DISABLED` appCode) + `apps/web/lib/serverErrors.ts` (its translation key), `packages/db/src/doctor.ts`
(0046/0047 preconditions), `scripts/dev-setup.sh`, `apps/worker/src/index.ts`, `supabase/**` (generated by
`pnpm db:supabase-sync`, append-only).

## Needs another area / owner
- **Orchestrator**: other wave-1 sessions will also add `FEATURE_DISABLED`-style codes — keep one entry. Migrations
  0046/0047 are numbered per MASTER-PLAN §4 and carry their own RLS; optionally list
  `supplier_contract_prices, price_alert_thresholds, price_alerts` in `rls/0002` when you regenerate it.
- **PO picker (pre-existing, S3 area)**: re-matching the demo invoice HK-24108 with contracts *off* picks a different
  open PO than the stored run (₪93 vs stored ₪100); with contracts on it reproduces the stored ₪100. Stored numbers
  never move (the script persists no re-match), but `buildMatchInput`'s PO choice for already-received POs deserves a
  look.
- **Known limits (documented, not bugs)**: the over-contract badge also covers lines without a PO (the engine then
  counts the whole invoice as UNORDERED_ARRIVAL, so badge ≠ leak delta there); the over-contract table returns the
  newest 500 lines but the total covers all.
- **Owner**: switching the flags on for real tenants is your call. Real email delivery needs the existing Resend setup;
  nothing new to configure.

## Verification (2 layers)

All on the head merged with `origin/claude/client-ready` @ 39e077d (dashviews/chain/landing v2), fresh DBs rebuilt
by `./scripts/dev-setup.sh` (migrations 0000→0047, base seed, seed-demo, chain demo, this demo).

**Layer 1 — full gate** (all exit 0):
| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `DATABASE_URL_TEST=…/restomatch_test pnpm turbo run test --concurrency=1` | 13/13 tasks · api 576 · web 248 · db 71 · matching 86 · charts 64 · catalog 50 · ocr 44 · translate 69 · procurement 17 · crypto 12 · worker 11 (+1 skipped) · billing 5 |
| `pnpm turbo run typecheck` | 17/17 |
| `pnpm --filter @restomatch/web exec tsc --noEmit -p .` | 0 errors |
| `pnpm --filter @restomatch/web lint` | 0 errors (9 warnings, none in wave-1 files) |
| `pnpm db:supabase-sync --check` | up to date (44 files) |
| `DATABASE_URL=…/restomatch_test pnpm --filter @restomatch/db check-rls` | OK |
| `cd apps/web && pnpm build` | ok (`/dashboard/contracts`, `/dashboard/contracts/import`) |
| `tsx apps/worker/scripts/seed-wave1-contracts-demo.ts` (run twice) | 10 contracts · 2 over-contract lines · 1 open alert · leak ₪1,859.62 → ₪1,859.62 |

**Layer 2a — production build clicked through** (`next build && next start -p 3100`, `NODE_ENV=production`,
`DATABASE_URL_APP` = RLS app role, password login; local placeholder values for `RESEND_API_KEY` / `EMAIL_FROM` /
`SUPABASE_SERVICE_ROLE_KEY` only to pass the boot guard — no email sent). Script: `apps/web/e2e-wave1-contracts.mjs`.
- owner, manager (8 pages each) and bookkeeper (5 pages) × he/en: **44 page loads, all HTTP 200, `<html lang/dir>`
  he/rtl and en/ltr, 0 console errors, 0 server 5xx**; expected ₪ content present (contract ₪139, alert "18%",
  default threshold "10%"); "over contract" visible on the contracts, invoice and leaks pages.
- receiver × he/en → redirected to `/dashboard` (no access).
- Flags off on the demo tenant: nav entry, supplier Contract tab and leaks badge gone; `/dashboard/contracts` renders
  the 404 page.
- Visual check of screenshots: Hebrew price pair was bidi-scrambled → fixed (Unicode isolates, `←` in he); English
  over-contract table showed Hebrew supplier names → fixed (`supplierNameEn`).

**Layer 2b — independent refuter** (subagent that did not write the code; read-only on dev data). Confirmed 7
defects, **all fixed with regression tests** in `packages/api/src/__tests__/contracts.test.ts`:
1. Unit-less contract applied in the line's unit (₪9/kg as ₪9/g → +₪89,900 fake leak) → unit defaults to the product
   unit; no unit anywhere ⇒ not applied.
2. Contract above the PO price created a PRICE_LOWER leak → contract is a ceiling.
3. Cheaper-supplier compared raw per-g / per-pack list prices → converted or ignored.
4. Dismissed alert re-raised + re-emailed on every new observation → open/recently-dismissed pairs suppressed.
5. Two lines on one invoice counted as a "sustained" trend; stale spikes alerted → per-day collapse + recency rule.
6. Over-long unit cell crashed the import with a 500 → row skipped as `BAD_UNIT`.
7. `31/02` silently replaced by the default date; `1e3` → ₪13; `(5)` → +5; formula units stored → skipped with
   `NO_DATE` / `NO_PRICE` / `BAD_UNIT`.
Held up: tenant isolation (tRPC + RLS + composite FKs), role/flag gating on the live server, agorot math, inclusive
local-date validity, contract precedence. Governance note from the refuter (immutable files) is covered by the table
above. After the fixes, layers 1 and 2a were re-run (results above are the final run).
