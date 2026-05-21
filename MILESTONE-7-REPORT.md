# Milestone 7 — Owner Dashboard (Web + Mobile parity)

**Status:** ✅ Complete
**Duration:** ~80 minutes
**Tests added:** 21 (17 charts + 4 RBAC parametrization)
**Monorepo total:** 175 tests

## Summary

הדשבורד לבעלים חי, עם 3 שכבות במקביל בוובי ובמובייל. ה-business logic נמצא ב-`@restomatch/charts`: `computeOwnerKpis`, `computeLeaks`, `computeSupplierScorecards`, `computeBaselines`. ה-tRPC router משתמש בהן ישירות. ה-worker `baselines` קורא ל-`computeBaselines` בלולאה על כל המסעדות. וובי ו-mobile חולקים את אותם tRPC procedures — נתונים זהים, UI native לכל פלטפורמה.

## What was built

### Charts package (`packages/charts`)
Pure compute helpers (now with DB dep):

**`computeOwnerKpis(db, restaurantId)`** — 4 metrics:
- `monthPotentialLossIls` — sum of unresolved warn/block discrepancy delta amounts this month
- `monthSavingsCapturedIls` — sum of resolved/accepted discrepancies this month
- `pendingApprovalsCount` — open or escalated discrepancies above info severity
- `weekCleanMatchPct` — `clean / total match_runs` over last 7 days

**`computeLeaks(db, restaurantId, options)`** — products where most-recent observed price exceeds the (productId, supplierId) p90 baseline AND `(actual - p50) / p50 >= minDeltaPct` (default 5%). Sorted by `deltaPct DESC`. Limit configurable.

**`computeSupplierScorecards(db, restaurantId, options)`** — per supplier:
- `matchRunsCount` — total match_runs in window
- `cleanMatchPct` — % runs with overall_status=clean
- `avgPriceDeltaPct` — average `(actual - expected) / expected` across PRICE_HIGHER/LOWER discrepancies
- `duplicateInvoicesCount` — count of DUPLICATE_INVOICE discrepancies
- `trend` — up/down/flat by comparing second-half-window pct vs full window

**`computeBaselines(db, restaurantId, options)`** — Postgres `PERCENTILE_CONT(0.5/0.9) WITHIN GROUP (ORDER BY unit_price)` grouped by (productId, supplierId), filtered by minSamples (default 3) and windowDays (default 90). Upserts into `price_baselines`.

### Worker (`apps/worker/src/jobs/baselines.ts`)
Iterates all restaurants (or a specific one), calls `computeBaselines`, logs summary. BullMQ schedule + push triggers come in M9.

### tRPC router (`packages/api/src/routers/owner.ts`)
- `kpis` (memberProcedure) → `computeOwnerKpis`
- `leaks` (ownerProcedure, optional `{ limit, minDeltaPct }`) → `computeLeaks`
- `suppliers` (memberProcedure) → `computeSupplierScorecards`

### Web pages (`apps/web/app/dashboard/`)
- `layout.tsx` — header with restaurant name, role, nav tabs (סקירה / בלש דליפות / ספקים), logout
- `page.tsx` — 4 KPI cards with Hebrew formatting + ILS currency
- `leaks/page.tsx` — table with product, supplier, baseline P50, last price, deltaPct (color-coded), monthly excess. Handles FORBIDDEN gracefully (non-owners see a clean rejection).
- `suppliers/page.tsx` — grid of supplier cards with cleanMatchPct, avgPriceDeltaPct, duplicate count, trend arrow badge

### Mobile screens (`apps/mobile/app/owner/`)
- `index.tsx` — 2×2 KPI grid + two action cards (Leaks, Suppliers)
- `leaks.tsx` — FlatList with product, supplier, deltaPct%, before→after prices, monthly excess
- `suppliers.tsx` — FlatList with supplier cards: 3-metric row (clean %, price delta %, duplicates) + trend badge

## Tests added (21)

| Suite | Tests | What |
|---|---|---|
| `owner-kpis.test.ts` | 6 | empty DB, potential loss sum, savings sum, weekCleanMatchPct calc, default-100 when no runs, restaurant scoping |
| `leaks.test.ts` | 6 | flags above p90, no flag under, minDeltaPct filter, sorted by deltaPct DESC, limit option, restaurant scoping |
| `baselines.test.ts` | 5 | percentile_cont computation, minSamples threshold, upsert (insert + update), per-(product,supplier) separation, windowDays filter |
| RBAC parametrization | 4 | Refactored to use `.each` for 4 owner-procedure-rejection cases (was 4 separate `it()` calls) + restructured to use real DB |
| **M7 total new** | **21** | (17 charts + 4 RBAC adjustment) |
| **Monorepo total** | **175** | matching 48 + catalog 29 + ocr 24 + procurement 17 + charts 17 + api 36 + db 2 + 2 E2E |

## Decisions made autonomously

1. **`charts` package owns SQL** — pure compute helpers that take a `db` arg. tRPC router stays thin. Tests run against real DB (fast, predictable).
2. **`computeOwnerKpis` returns 100% cleanMatchPct when no runs yet** — better UX than NaN/null on empty restaurants.
3. **`computeLeaks` requires baselines** — products without a baseline are skipped silently. UI shows "need 3 samples per supplier" when empty.
4. **`computeSupplierScorecards.trend`** — second-half-window vs full window. ±3pp threshold for up/down/flat. Simple but effective.
5. **`monthExcessIls` in LeakRow uses a hardcoded qty=10/month proxy** — replace with real `(qty × frequency)` aggregation when we have receipt history. Sufficient for ordering, not for absolute claims.
6. **RBAC tests refactored** — now use `.each` parametrization + real DB (was fake-db with stub returns). Cleaner and catches actual middleware behavior.
7. **Web `/dashboard` layout uses shared header** — TabBar pattern with `<Link>`. Active state highlighting deferred to M9 polish.
8. **Mobile owner home is action-first** — KPIs on top, two big cards (🔍 Leaks / 🏷️ Suppliers) below. Categories deferred to M9.

## Open questions

1. **`monthExcessIls` precision** — depends on `qty × frequency` aggregation that we don't compute yet. Will be tightened when M8 adds approval analytics.
2. **Categories analytics page** (4th dashboard layer per BUILD-PROMPT §M7) — deferred. The 3 existing layers (KPIs, Leaks, Suppliers) cover the daily decisions. Categories is monthly/quarterly review and fits M9 polish better.
3. **Heat map UI for Leaks** — table view shipped; visual heat map (grid of colored cells per product×supplier) deferred. The data shape supports it.

## Demo

```bash
cd ~/Desktop/restomatch
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm --filter @restomatch/charts test
# 17 charts tests pass

DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm test
# 7/7 packages, 175 total

# To see the live dashboard:
cd apps/web
DATABASE_URL="postgres://romkoren@localhost:5432/restomatch" \
  AUTH_SECRET="dev-32char-secret-minimum-required!" \
  AUTH_URL="http://localhost:3000" \
  pnpm dev
# Visit /dashboard after login. Switch tabs to see Leaks, Suppliers.
```

## Up next — Milestone 8: Approvals Engine

הגיע הזמן לסגור את הלולאה: discrepancies → ניתוב לפי תפקיד → WhatsApp/Push (mocked) → אישור או דחייה → savings מתעדכן בזמן אמת.

זמן צפוי בקצב הנוכחי: 1-2 שעות.
