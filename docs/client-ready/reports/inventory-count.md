# Inventory counting → actual food cost (`inventoryCount`) — S17 report

Branch `claude/inventory-count` → draft PR #106 into `main` (built on `claude/wave1-recipes`; needs recipes + the
POS seam). Flag `inventoryCount` (off by default; on for the demo tenant through `features.all`;
`FEATURES_OFF=inventoryCount` kills it).

**Owner approval for additive schema: 2026-10-24, via the orchestrator session** ("מאשר כל מה שאתה צריך"). It
covers migration 0070, its `schema.ts` tables and the journal entry (idx 70), under the 0057 pattern. It covers
nothing else on the immutable list.

**Framing:** this is not inventory software. The count **closes the food-cost month and checks that the leak
number holds**. No par levels or suggested orders in this PR.

> **לבעלים:** ספירת מלאי בטלפון שסוגרת את חודש עלות המזון.
> - **בזמן הספירה:**
>   - סופרים לפי מקרר / מקפיא / ירקות / יבשים / בר, וכל מספר נשמר מיד.
>   - שורה ריקה היא "לא נספר", לא אפס, וסגירה איתה דורשת אישור מפורש.
>   - ליד כל פריט רואים מאיפה המחיר: "₪149 לק״ג · חשבונית 4711, 20 באוק׳, קצביית הכרם".
>   - פריט שנספר יותר מהספירה הקודמת ומכל מה שהתקבל מאז מסומן "בדוק".
> - **סגירה:** מנהל או בעלים סוגרים ונועלים. אחר כך רק הבעלים יכולים לתקן, עם סיבה שנרשמת ביומן. אפשר להוריד CSV לרואה החשבון.
> - **עלות מזון בפועל** = מלאי פתיחה + קניות (לפי תאריכי קבלה) − זיכויים **שהתקבלו** − מלאי סגירה. מזון בלבד: משקאות והבר לא נכללים.
>   - "זיכוי לקבל" מוצג בנפרד ולא מקוזז.
>   - ספירה חלקית מקבלת הערה שקטה, ואין התראה על שימוש לא מוסבר.
>   - בחודש הראשון, בלי ספירת פתיחה, מוצג "פוד קוסט רכש".
>   - בדמו: אוקטובר **26.6%** (₪36,248 מתוך ₪136,400 מכירות מזון, שהוזנו ידנית).

## What was built

| Area | What |
|---|---|
| Data | `0070_inventory_counts.sql`, the 0057 pattern exactly. Two tables, `inventory_counts` and `inventory_count_lines`. Same-tenant composite FKs; RLS enabled in the migration (`<table>_tenant`); `updated_at` triggers; FK indexes; CHECKs. **One draft per restaurant** is a partial unique index. The `price_source` jsonb snapshot records the invoice #, date and supplier. Journal idx 70; supabase-sync entries regenerated. |
| Valuation (pure) | qty × the last **paid** price (`price_history`) on or before the count's **local** date, ex-VAT. Units convert through the shared `unitFactorRational`. Integer agorot, half-up once per line. **Snapshot at close:** unit cost, value, price source and the count total; a closed count never drifts. |
| Blank ≠ zero | An empty line is "לא נספר" (not counted): never valued, never 0. Close lists the uncounted items and needs an explicit OK (`acceptUncounted`). No-price and unit-mismatch lines are flagged ("אין מחיר") and stay out of the value. |
| Price source | Every line shows "₪X ל-unit · חשבונית #, date, supplier". It is snapshotted at close and shown on the count, the detail page and in the CSV. |
| Sanity check | A counted qty greater than (last count + goods received since, unit-converted) gets a "בדוק" badge and is listed in the close dialog. |
| Close & lock | **Owner or manager** closes; a chef counts and sees "מנהל או בעלים סוגרים". Close is written to the audit log (`inventory.count_closed`). A closed count can only be corrected by the **owner, with a reason**: the line value and total are recomputed at the snapshot price, and the change is logged (`inventory.line_amended`, before/after/reason). A discarded draft is logged too. |
| Purchases | **Receipt dates** ("לפי תאריכי קבלה"). Starting from invoices ex-VAT in (opening, closing] (no ex-VAT total → incl − VAT; none at all → ₪0 with an FYI; a credit note's negative total lowers purchases): <ul><li>a live duplicate copy is out (the leak engine's own `LIVE_DUPLICATE`, re-exported from `@restomatch/charts`);</li><li>non-food lines (חד״פ / ניקיון, by pattern) are out;</li><li>delivery notes received in the period and not billed yet are **added at PO prices**;</li><li>notes from an earlier period that a consolidated invoice now bills are **taken back**.</li></ul> So every note counts once, in the month its goods arrived, matched per supplier on a normalised number. |
| Credits | **Only credits received** reduce the food cost: goods-line overcharges (`PRICE_HIGHER`, `QTY_OVER`, `UNORDERED_ITEM`, `QTY_SHORT`, Δ ≠ 0) on food lines, claim `resolved`, **dated by `resolved_at`**, capped at the invoice's food value. A VAT, price-lower or missing-on-invoice finding is never a credit. Claims agreed but not yet credited (`accepted`) are shown as **"זיכוי לקבל"** and never subtracted. The formula is shown with its total: opening + purchases − credits received − closing = actual. |
| Food only | Beverages (משקאות, by pattern) and the **bar** shelf are counted but are not food cost. Their purchases, credits and stock (both ends) stay out. Non-food (חד״פ / ניקיון) is out too. |
| Coverage | `period()` returns each end's coverage `{lines, counted, unpriced}` over food lines. Below 95% counted-and-priced, a calm caveat is shown and no variance alarm is computed. |
| Close order | A count dated on or before the latest closed count can't be closed (`NOT_AFTER_LAST:<date>`, with a clear message). |
| Period | Actual food cost as a % of food sales. Sales come from POS (`pos_sales`) when present, else the manual figure on the closing count ("הוזנו ידנית"). With recipes + POS: **"שימוש לא מוסבר" (unexplained usage)** = actual − theoretical. It is compared only when recipes cover ≥ 90% of sales and are fully costed, otherwise shown as a calm "partial" note. It is T2 only above 2 points of sales and **never** part of the leak hero. |
| First month | No opening count ⇒ no actual food cost and no invented opening value. Instead **"פוד קוסט רכש"** (purchases ÷ sales) for the count's month, labelled as such. |
| CSV | `exportCsv`: item, item_en, area, qty, unit, unit cost, value, price invoice / date / supplier, plus a TOTAL row. UTF-8 BOM so it opens in Excel; spreadsheet formulas are neutralised. |
| API | `inventory.*`: enabled, current, start, saveLines, searchProducts, setMeta, complete, amendLine, exportCsv, discard, get, history, period. Writes take a per-restaurant advisory lock. A counted product can't be deleted (friendly CONFLICT). |
| UI | <ul><li>`/dashboard/inventory`: start/continue, the food-cost card, history.</li><li>`/dashboard/inventory/count`, mobile-first: compact rows per storage area, keypad ("2,5" = 2.5, "1,200" = 1200, "2," still typing), serialised autosave that also flushes when the phone locks and when the screen is left. Unsaved edits are kept in the browser per count and replayed on return. A failed save goes back under newer edits field by field. Progress is pinned to the close bar, above the bottom nav.</li><li>`/dashboard/inventory/<id>`: read-only, price sources, CSV, owner correction.</li><li>The card also sits on `/dashboard/recipes`.</li></ul> he/en, light theme, ₪ via `formatIls`. |
| Demo | `apps/worker/scripts/seed-inventory-demo.ts`, on the reseed contract: `DEMO_RESTAURANT_ID` (else the demo business id + name), dates from `DEMO_TODAY`, deletes only its own rows, never touches invoices. **Numbers:** <ul><li>Opening count 2026-09-30 ₪11,134.46, of which food ₪8,279.96. Closing count 2026-10-24 ₪13,474.46, of which food ₪9,490.66. 51 items, 46 of them food, all counted.</li><li>October food purchases ₪37,930.07 on receipt dates = 37 invoices ₪45,320.41 − non-food ₪1,381.51 − beverages ₪7,168.22 + 8 Galilee notes ₪3,109.99 − September notes billed on חשבונית הריכוז GD-M-202609 ₪1,950.60.</li><li>Credits received in October ₪471.38.</li><li>**Actual ₪36,247.99 = 26.6%** of food sales ₪136,400 (fresh reseed, `DEMO_TODAY=2026-10-25`).</li><li>Hero unchanged (₪760 of ₪42,263).</li></ul> |

## Security

- **Tenant isolation:**
  - every query filters `restaurant_id` inside the member RLS transaction;
  - composite FKs reject cross-tenant lines, even as owner;
  - `inventory-rls.attack.test.ts` runs as `restomatch_app`: GUC isolation, cross-tenant INSERT blocked, cross-tenant UPDATE/DELETE match nothing, and the router works end to end.
- **COVERAGE:** add-only entries for all 13 procedures.
- **Roles:**
  - owner / manager / chef count;
  - owner / manager close;
  - the owner alone amends a closed count;
  - receiver / bookkeeper get FORBIDDEN.

## Immutable / shared files touched

- **Owner-approved additive schema:** `packages/db/drizzle/0070_*.sql`, `meta/_journal.json`, `src/schema.ts`.
- **COVERAGE:** `packages/api/src/__tests__/cross-tenant.attack.test.ts`, entries added only.
- **Re-export:** `packages/charts/src/index.ts`, one additive line (`LEAK_FILTER`, `LIVE_DUPLICATE`).
- **Audit actions:** `packages/api/src/audit.ts`, three new values.
- **Delete guard:** `packages/api/src/routers/products.ts`, a counted product can't be deleted.
- **Nav, roles, router list:** `apps/web/app/dashboard/{layout,nav}.tsx`, `lib/roles.ts`, `test/appRouterShape.test.ts`.

## Verification (2 layers)

### Layer 1 — `scripts/verify.sh` PASS
New suites (all green, together with COVERAGE / cross-tenant):

| Suite | Tests |
|---|---|
| `inventory-valuation` | 10 |
| `inventory-router` | 12 |
| `inventory-fixes` | 6 |
| `inventory-must-haves` | 5 |
| `inventory-review` | 12 |
| `inventory-rls.attack` | 7 |
| web `test/inventory-ui` | 6 |

### Layer 2 — production build, he + en, 1366 and 390
- **`VERIFY_E2E=1 VERIFY_SOFTNAV=1 … verify.sh layer2`:** includes `e2e/inventory.spec.ts`, at 390 px in he/en. It runs start → count → reload resumes → close → uncounted list + explicit OK → summary ₪ → food-cost card → type sales → %. Every screen: axe 0, no sideways scroll, 44 px targets, no console errors.
- **`layer2-inventory.mjs`** on `next start` with the seeded dev DB checks the card, formula, credits, receipt-date note, history, detail, the recipes-page card and the count screen.

### Independent refuter
A subagent that did not write the code confirmed 5 bugs; all are fixed with regression tests (`inventory-fixes.test.ts`):
1. A false "unexplained usage" alarm on partial recipe coverage.
2. Credits on non-food lines subtracted twice.
3. Delivery notes matched on the number alone.
4. An autosave/close race.
5. Re-priced tallies on a closed count.

Smaller items were also fixed: the date field, the decimal comma, the non-food pattern.

## Next (not in this PR)

- **Post-demo, from the #106 review:**
  - reopen / void a closed count;
  - a back-dated count vs stored POS sales;
  - unmapped non-food invoice lines (no product) are counted as food today;
  - keyboard next-field order on the count;
  - focus handling in the confirm step;
  - cancel for the sales edit.
  - a negative credit note plus the same finding marked `resolved` can subtract the same credit twice; `resolved` should re-stamp `resolved_at` when the credit is received;
  - food kept on the bar shelf (e.g. lemons) is out of stock but its purchases are in;
  - delivery-note accrual can drift by 1 agora (per-line vs per-note rounding);
  - the seed's `localToday` uses the wall clock, not `DEMO_TODAY`;
  - unbilled delivery notes are an estimate at PO prices. When the invoice arrives at a different price, the difference lands in the month the invoice is booked. A refinement could book it back to the receipt month.

- **Phase 2:** par levels → suggested order quantity = par − on hand − open PO qty, prefilled in the order wizard.
- **Credits:** a real "credit note received" document type, so "received" isn't inferred from the claim status.
- **Close:** a "submit for close" flow so a chef can hand the count to a manager from the phone.
