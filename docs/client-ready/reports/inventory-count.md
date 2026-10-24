# Inventory counting → actual food cost (`inventoryCount`) — S17 report

Branch `claude/inventory-count` (cut from `claude/wave1-recipes`; needs recipes + the POS seam). Flag key
`inventoryCount` (off by default; on for the demo tenant through `features.all`; `FEATURES_OFF=inventoryCount`
kills it). **Contains an additive schema change (migration 0070 + `schema.ts`) that is on the immutability list —
it merges only with the owner's explicit approval.**

**Owner approval for additive schema: 2026-10-24, via the orchestrator session** ("מאשר כל מה שאתה צריך"). It covers migration 0070, its `schema.ts` tables and the journal entry (idx 70), under the 0057 pattern. It covers nothing else on the immutable list.

> **לבעלים:**
> - **מה זה:** "ספירת מלאי" בטלפון. סופרים לפי מקרר / מקפיא / ירקות / יבשים / בר.
> - **שמירה:** כל מספר נשמר מיד, וספירה שנקטעה ממשיכה מאותה נקודה.
> - **בסוף:** "סיים ספירה" נותן את שווי המלאי בש״ח, נעול לפי המחירים ששולמו באותו יום.
> - **עלות מזון בפועל:** בין שתי ספירות מקבלים מלאי פתיחה + קניות − זיכויים שהתקבלו − מלאי סגירה, כאחוז מהמכירות. זה כרטיס נפרד, ולא חלק ממספר הדליפה.
> - **שימוש לא מוסבר:** עם מתכונים וקופה רואים גם את ההפרש מול העלות התאורטית.
> - **בדמו:** אוקטובר 30.2% (₪41,135 מתוך מכירות מזון של ₪136,400, שהוזנו ידנית).

## What was built

| Area | What |
|---|---|
| Data | `0070_inventory_counts.sql`, the 0057 pattern exactly. Two tables, `inventory_counts` and `inventory_count_lines`. Same-tenant composite FKs; RLS enabled in the migration with the `<table>_tenant` policy; `updated_at` triggers; FK indexes; CHECKs (status, completed ⇔ completed_at ⇔ total, qty ≥ 0, storage-area enum). **One draft per restaurant** is a partial unique index. Journal idx 70, `when` 1782300000000. supabase-sync entries appended. |
| Valuation (`inventory/valuation.ts`, pure) | Value = qty × the last **paid** unit price (`price_history`) on or before the count's **local** date, ex-VAT. Units convert through the recipes engine's `unitFactorRational`, which wraps `@restomatch/matching` units; nothing is re-implemented. Integer agorot, **half-up once per line**. A line with no price, or with a unit that can't convert, is excluded from the value and counted visibly ("אין מחיר"). |
| Snapshot | "Finish" writes each line's unit cost and value plus the count total. A closed count never drifts: a retro-dated price after closing doesn't move it (tested). |
| Purchases (`inventory/data.ts`) | **Invoices only:** Σ `total_excl_vat` by local invoice date in (opening, closing]. A consolidated invoice is one row and counts once; delivery notes are not invoices. **Leak-engine rules are reused, not copied** (`LIVE_DUPLICATE` and `LEAK_FILTER` are re-exported from `@restomatch/charts`): a live duplicate copy is out, because its goods are on the original. Non-food lines (חד״פ, ניקיון, by pattern) are out. Invoices still waiting for a PO link (consolidated חשבוניות ריכוז) **are** purchases. |
| Credits | **"זיכויים שהתקבלו" (credits received) are their own term**: recovered claims (accepted/resolved, the hero's "recovered") on food lines, capped per invoice. The card shows the math: opening + purchases − credits − closing. |
| Delivery notes (info) | Notes that arrived in the period but no invoice covers yet are shown as a calm FYI line at PO prices ("לידיעה: 8 תעודות משלוח…"). They are **not** added to the math; they count when the consolidated invoice arrives. A note is matched only to its own supplier's invoice, on a normalised number. |
| Period | Actual = opening + purchases − credits − closing; % of food sales. Sales source: <ul><li>POS (`pos_sales`, when the integration is on and has rows);</li><li>otherwise the manual figure on the closing count.</li></ul> With recipes + POS: theoretical cost (recipes × POS quantities) and **"שימוש לא מוסבר" (unexplained usage) = actual − theoretical**. That is T2 (solid badge + ₪ + one CTA) only above 2 points of sales, calm otherwise. It is **never** part of the leak hero. |
| API | `inventory.*`: enabled, current, start, saveLines (autosave, adds a product by hand), searchProducts, setMeta (date / notes / manual sales), complete, discard, get, history, period. Roles: owner / manager / chef. Flag off ⇒ FORBIDDEN `FEATURE_DISABLED`. Writes take a per-restaurant advisory lock. A product on a count can't be deleted (friendly CONFLICT, like recipes). |
| UI | <ul><li>`/dashboard/inventory`: start/continue, the actual-food-cost card, past counts with ₪.</li><li>`/dashboard/inventory/count` (mobile-first): grouped by storage area (editable), one compact row per product, numeric keypad (`inputMode=decimal`, "2,5" accepted), debounced autosave plus a flush when the phone locks or the tab hides, retry on failure. Progress, value so far and save state are pinned to the finish bar. The finish summary shows not-counted and no-price items.</li><li>`/dashboard/inventory/<id>`: read-only snapshot.</li><li>The card also sits on `/dashboard/recipes` (next to food cost per dish).</li></ul> Hebrew RTL first, en too; light theme; ₪ via `formatIls`. Nav: "ספירת מלאי" (flag-gated). |
| Demo | `apps/worker/scripts/seed-inventory-demo.ts` (idempotent; runs the real router as the owner; writes only the two new tables). Opening count 2026-09-30 ₪11,134.46 and closing count 2026-10-24 ₪13,474.46, 51 items across 5 areas. October: purchases ₪43,938.90 (37 invoices ₪45,320.41 − non-food ₪1,381.51) − credits ₪463.54. Actual food cost **₪41,135.36 = 30.2%** of food sales ₪136,400 (entered by hand, labelled "הוזנו ידנית"). FYI line: 8 Galilee delivery notes ₪3,109.99 not billed yet. `check:demo` still ✔ (hero ₪760 of ₪42,263). |

## Security

- **Tenant isolation:**
  - every query filters `restaurant_id` and runs in the member RLS transaction;
  - the composite FKs reject a line that points at another restaurant's count or product, even as owner;
  - RLS app-role attack suite (`inventory-rls.attack.test.ts`): GUC isolation, a cross-tenant INSERT is blocked, cross-tenant UPDATE/DELETE match nothing, and the router works end to end through `restomatch_app`.
- **COVERAGE:** add-only entries for all 11 procedures.

## Immutable / shared files touched

- `packages/db/drizzle/0070_*.sql`, `meta/_journal.json`, `src/schema.ts`: additive. **Owner approval required** (requested by the orchestrator).
- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: COVERAGE entries added only.
- `packages/charts/src/index.ts`: one additive re-export line (`LEAK_FILTER`, `LIVE_DUPLICATE`), so the purchase rules are the leak engine's own.
- `packages/api/src/routers/products.ts`: a counted product can't be deleted (friendly CONFLICT).
- `apps/web/app/dashboard/{layout,nav}.tsx`, `lib/roles.ts`, `test/appRouterShape.test.ts`: nav item, route roles, router list.

## Verification (2 layers)

### Layer 1: automated gate
`scripts/verify.sh` **PASS**:
- install, fresh-db, migrate, provision-rls, check-rls, db-doctor, supabase-sync, typecheck, test, web-lint, web-build, web-tsc, audit;
- new suites: `inventory-valuation` 10, `inventory-router` 12, `inventory-rls.attack` 4;
- COVERAGE and cross-tenant suites green; web vitest 377.

### Layer 2: production build, he + en, 1366 and 390
- `VERIFY_E2E=1 VERIFY_SOFTNAV=1 … verify.sh layer2`, including the new `e2e/inventory.spec.ts`: at 390 px in he/en it runs start → count → reload resumes → finish → summary ₪ → food-cost card → type sales → %, with axe 0, no sideways scroll, 44 px targets and no console errors on every screen.
- `inv-layer2.mjs` on `next start` with the seeded dev DB:
  - the card shows 30.2% with the formula ₪11,134 + ₪43,939 − credits ₪464 − ₪13,474;
  - ₪136,400 manual sales;
  - the unbilled delivery notes appear as an FYI line;
  - history and detail show the ₪ values;
  - the card also appears on recipes;
  - the draft count screen works;
  - 0 console errors and 0 5xx.
- 64/72: the 8 misses are the shared header's branch switcher (`label-content-name-mismatch`, desktop). Reported to the orchestrator with a fix; not in this PR's files.

### Independent refuter
See the section below.

### Independent refuter (a subagent that did not write the code)

**Confirmed and fixed:**

| Finding | Fix | Test |
|---|---|---|
| **High:** false "unexplained usage" alert when only part of the menu has recipes (theory covered only the matched dishes; sales covered all) | Theory is compared only when recipes cover **≥ 90% of POS sales** and every matched recipe is fully costed; it is scaled to all sales. Otherwise the card shows a calm "partial" note, never an alarm. | `inventory-fixes.test.ts` |
| A claim accepted on a non-food line was subtracted from food purchases a second time | Credits count only claims on food lines | `inventory-fixes.test.ts` |
| Delivery-note coverage matched the number alone (another supplier's "100"; "07001" vs "7001"; plain-string elements) | Matched per supplier, on a number normalised like invoice numbers (alphanumerics, upper-case, no leading zeros) | `inventory-fixes.test.ts` |
| Autosave/finish race (the last qty could be lost; an older save could land after a newer one); the retry loop never stopped | Saves are serialised and Finish waits for them; CONFLICT/NOT_FOUND stops retrying with a message; timers are cleared on unmount | — |
| A completed count's `progress` was recomputed from live prices | Tallies come from the snapshot | `inventory-fixes.test.ts` |

**Smaller items, also fixed:**
- The date field now saves on blur, never per keystroke.
- Dates before 2000 are rejected with BAD_REQUEST, not a Postgres error.
- The sales input reads "12345,50" as a decimal comma, and manual sales can be edited after saving.
- The non-food check is a case-insensitive pattern covering the usual spellings (חד״פ / חד פעמי / ניקיון / ניקוי / disposables / cleaning).

**Acknowledged, not changed:**
- Only `seed-demo` writes delivery notes (`ת.מ.` receipts plus `ocr_payload.raw.deliveryNotes`) today, so the FYI line appears on demo data only.
- Purchases are invoices only (orchestrator decision). A month whose consolidated invoice arrives after the closing count therefore runs low by the unbilled notes, which the FYI line shows.
- POS sales that cover only part of the period understate sales. The manual figure remains available.
- A product's default unit changing after prices were recorded would misprice it, the same assumption as the recipes engine.

## Phase 2 (not today)

**Par levels → suggested order quantity = par − on hand − open PO qty**, prefilled in the order wizard. The last
completed count is the "on hand".

## Notes / limits

- The theoretical cost uses current recipe costs at the closing date's prices.
- With POS rows the sales come from the POS. The demo has none on this branch, so the manual figure is used.
