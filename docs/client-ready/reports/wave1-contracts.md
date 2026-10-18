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
  (price ≥ 0, `valid_to ≥ valid_from`, source enum), unique `(supplier, product, valid_from)`, `updated_at` trigger,
  RLS via the 0002 tenant list.
- **The rule** (`packages/api/src/contracts/core.ts`, documented in code):
  1. A row covers `[valid_from, valid_to]` — restaurant-local calendar dates, inclusive, `valid_to` NULL = open.
  2. In force on the invoice's **local date** = covering row with the latest `valid_from` (renegotiation supersedes).
  3. **Contract beats PO**: when both exist, `buildMatchInput` replaces the PO line's `unitPriceExpected` with the
     contract price, so an over-contract line is a **PRICE_HIGHER whose expected value is the contract price**.
  4. Units convert with the engine's own kg↔g / l↔ml table; an unconvertible unit ⇒ the contract is not applied.
  5. "Over contract" badge = billed price above contract **outside the restaurant's price tolerance band** — exactly
     when the engine would emit PRICE_HIGHER against it. Computed read-side for every invoice line (with or without a
     PO); it never adds to the leak figure (invoices without a PO are already counted whole by UNORDERED_ARRIVAL).
- **Engine changes: none.** `packages/matching/**` untouched; the 12-type union and the leak-canary are unchanged.
  The only match-path change is `packages/api/src/match/buildMatchInput.ts` (+14 lines, feature-gated: flag off ⇒
  byte-identical input).
- **Import**: CSV/XLSX through the catalog parser (`parseCatalogFile` — same size/zip-bomb/legacy-xls guards and
  `CATALOG_FILE_<code>` errors), Hebrew+English header auto-mapping incl. "בתוקף מ / עד", ISO and Israeli D/M/YYYY
  dates. Products resolve by the supplier's catalog SKU → exact canonical name → catalog raw name; unknown products
  are **reported, never created**; upsert on `(supplier, product, valid_from)`.
- **tRPC** `contracts.*`: `list, productOptions, create, update, delete, importPreview, importCommit,
  overContractForInvoice, overContract` — reads finance-tier (owner/manager/bookkeeper), writes manager-tier.

### 2. Price-trend alerts + thresholds (`priceAlerts`)
- **Tables** (0047): `price_alert_thresholds` (scope supplier and/or category, `threshold_pct` 0–5, `window_days`
  7–120, one rule per scope incl. NULL scopes via an expression unique index) and `price_alerts` (start/end price,
  pct, window, observations, cheaper supplier + price, open/dismissed, dedupe key per last-observation day).
- **Detection** (`priceAlerts/detect.ts`, pure): ≥ 3 observations in the window, latest ≥ first × (1+threshold) and
  the later half of the observations all ≥ first × (1+threshold/2) (a one-off spike is not "sustained"). Threshold
  resolution: supplier+category > supplier > category > restaurant default > built-in (10% / 21 days).
- **Cheaper supplier**: the same `product_id`'s latest observed price at another supplier (≤ 90 days) or an active
  catalog list price, when strictly lower.
- **Delivery**: `runPriceAlertSweep` writes the in-app rows; with `notify` it enqueues one email per owner/manager
  through `enqueueNotification` (dedupe `price-alert:<id>:<email>`). New worker job `price-alerts`, scheduled daily
  07:00 IL. Nothing is sent locally (outbox only; dispatch is the existing worker + provider config).
- **tRPC** `priceAlerts.*`: `list, dismiss, refresh, thresholds, setThreshold, deleteThreshold, openCount`.

### 3. UI (`apps/web`, namespace `contracts` he/en)
See "UI" below (filled from the UI work).

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
| `packages/db/drizzle/rls/0002_core_tenant_rls.sql` | +3 names in the tenant list | RLS for the new tables (check-rls) |
| `packages/api/src/notifications/outbox.ts` | conflict-target `where` (5 lines) | bug above — every deduped enqueue failed |
| `apps/worker/src/cron.ts` | +1 scheduler `price-alerts-07` (+remove) | daily trend sweep |
| `packages/api/src/__tests__/cross-tenant.attack.test.ts` | +16 COVERAGE entries + attack/isolation block | required for new procedures (additive) |
| `packages/api/src/__tests__/rls.attack.test.ts` | + raw RLS probes for the 3 tables | additive |
Not touched: `packages/matching/**` (engine, union, canary), `rls.ts`, `plans.ts`, billing, approvals, leads, rate limit.

Shared files (additive): `packages/api/src/index.ts` (routers/exports), `packages/api/src/errors.ts`
(`FEATURE_DISABLED` appCode) + `apps/web/lib/serverErrors.ts` (its translation key), `packages/db/src/doctor.ts`
(0046/0047 preconditions), `scripts/dev-setup.sh`, `apps/worker/src/index.ts`, `supabase/**` (generated by
`pnpm db:supabase-sync`, append-only).

## Needs another area / owner
- **Orchestrator**: other wave-1 sessions will also add `FEATURE_DISABLED`-style codes — keep one entry. Migrations
  0046/0047 are numbered per MASTER-PLAN §4.
- **Owner**: switching the flags on for real tenants is your call. Real email delivery needs the existing Resend setup;
  nothing new to configure.

## Verification (2 layers)
_(filled below)_
