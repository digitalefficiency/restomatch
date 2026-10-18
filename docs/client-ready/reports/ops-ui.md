# S5 — ops-ui report (dashboard chrome, suppliers, catalog, products, orders, exports)

Branch `claude/client-ready-ops-ui` → draft PR into `claude/client-ready`.
Screenshots: `docs/client-ready/screenshots/ops-*.png` (he + en, desktop 1440px; mobile 390px for catalog / orders / supplier).
Import fixtures: `docs/client-ready/fixtures/ops/`.

## Works (verified)

Verified by a Playwright run against the seeded demo tenant (owner@kfar-hazeitim.test, `next dev`). All 8 flows pass with no page errors:

| Flow | Result |
|---|---|
| Import `catalog-produce-avi.xlsx` (12 rows, Hebrew headers) from the supplier hub (`?supplierId=`) | Columns auto-mapped. 12 items created; 10 linked to existing products, 2 new products |
| Import `catalog-dairy-meiron-windows1255.csv` (Hebrew Excel "CSV" encoding) | Headers decode correctly; `שם מוצר`→name, `מחיר`→price, `"1,034.50"`→1034.50 |
| Legacy `.xls` / header-less CSV | Rejected with a localized "save as .xlsx / CSV" or "first row must be headers" message (was a 500 with an exceljs stack message) |
| Catalog search `שרי` → add the English name inline | Saved through `products.update`; toast shown; the row updates |
| Global search `cherry` → Enter | Finds the product by its English name and opens it |
| New order from the supplier hub | Supplier pre-selected; picking the same item twice gives qty 2; sent with channel "none"; detail shows ₪29.80 and the English line name with the Hebrew underneath |
| Exports: "This year" → CSV + uniform file | CSV starts with a UTF-8 BOM and has 31 lines; the 1000 file has 30 lines |

Also checked by hand in he and en:
- Every page in my boundary uses `t()`. No hard-coded Hebrew is left in my files, apart from the sample-file content and the Hebrew default unit `יח׳`.
- Dates go through `@/lib/i18n/format` and ₪ through `formatIls(v, { locale })`.
- Directional icons flip under RTL.

## Fixed (problem → fix → test)

**Cross-cutting**
1. **Every English page rendered right-to-left.** `globals.css` sets `html { direction: rtl }`, and that beat `<html dir="ltr">`. → S6 landed the identical `html[dir='ltr']` rule in the base. After merging the base, S5 carries no `globals.css` change.
2. **Global search results could not be clicked.** They were plain `<li>`s. → They are now a proper ARIA combobox (↑/↓, Enter, Esc, click). Groups the role can't open are hidden (a receiver gets no supplier links). Search also matches and shows `name_en`. → `app/dashboard/__tests__/ops-logic.test.ts` ("global search options"); router: `ops-routers.test.ts` ("search.global matches + returns English names").
3. **Entitlement upsells never showed on the client.** The `ENTITLEMENT_REQUIRED` cause isn't serialized over tRPC, so the WhatsApp-gated and guardrail-gated branches were dead code. → `entitlementCauseOf` also reads the `ENTITLEMENT_REQUIRED:<feature>` message. → `lib/components/__tests__/ops-components.test.ts`.
4. **Raw server messages were shown in the UI.** These were Hebrew, or raw zod JSON. → `friendlyError(err, t, overrides)` maps tRPC codes to localized text per screen. → `ops-components.test.ts`.
5. **The mobile bottom bar rendered at the top of the screen.** The header's `backdrop-filter` makes it the containing block for `position: fixed` children. → The drawer and bottom bar are portaled to `<body>`.

**Orders**
6. **Stale total.** `updateOrderLine` / `deleteOrderLine` never recomputed `purchase_orders.total_estimated`, so the header kept the old ₪. → New `recomputePoTotal` in `packages/api/src/orders/totals.ts`. Totals are now agorot-exact (half-up per line, integer sum) instead of a float sum. → `ops-routers.test.ts` (4 tests + `estimateTotal` unit tests).
7. **Closed or already-cancelled POs could be cancelled.** → Now returns `CONFLICT`. → `ops-routers.test.ts`.
8. **An order with every line deleted could still be sent.** The supplier would get a blank document. → `placeOrder` returns `PRECONDITION_FAILED`, and the UI disables deleting the last line. → `ops-routers.test.ts`.
9. **Every retry of a failed send created a new draft.** This happened when the supplier had no email, or WhatsApp was gated. → The wizard keeps the draft id and only re-sends it, with an "open draft" link. → logic in `order-logic.ts`; e2e above.
10. **The `?supplierId=` link from the supplier hub was ignored.** This affected both the new-order wizard and the catalog import. → It now pre-selects the supplier. → e2e above.
11. **Duplicate lines when the same item was added twice.** Qty 0 and empty free-text lines could also reach the server and fail zod validation. → Picking an item again merges into one line, and invalid lines are blocked before review. → `ops-logic.test.ts` ("order logic").
12. **Wrong Hebrew in the cutoff notice.** It said "הוקדם המועד" (the cutoff moved earlier); it means the cutoff has passed. → The text is fixed.
13. The default send channel now follows what the supplier can actually receive. Channels with no contact are disabled.

**Suppliers**
14. **Clearing a field on the details tab didn't save.** This covered email, phone, payment terms and the delivery grid. `undefined` means "untouched" in the patch. → `toUpdatePatch` sends `null`. → `ops-logic.test.ts` ("supplier form").
15. **Removing every order window could never be saved.** The tab fell back to the empty state, so the old schedule stayed in the database. → Added an explicit "Save (delete schedule)" action.
16. **Owners and managers had no edit controls on the supplier catalog tab.** `canEdit` was never passed. → Fixed.
17. Client-side email/name validation, a filter box (for more than 5 suppliers), toasts, and a working ARIA tabs pattern with `?view=scores` deep links.

**Catalog / import**
18. **Hebrew-Excel CSVs (Windows-1255) imported as mojibake.** `File.text()` always reads UTF-8, so no columns were detected. → Strict UTF-8 first, falling back to Windows-1255. → `ops-logic.test.ts`; e2e above.
19. **File problems returned 500 with an exceljs message.** This covered legacy `.xls`, a corrupt workbook, a missing header row, too many rows, and an empty name column. → `CatalogFileError` → `BAD_REQUEST CATALOG_FILE_<code>`, mapped to localized guidance. → `ops-routers.test.ts` (6 tests).
20. **The auto-mapper took "קוד פריט" (item code) as the product name.** → Columns with code hints are skipped for the name. → `catalog-parse.test.ts`.
21. Search is debounced (it used to send a request per keystroke) and includes English names. Added an item count, an empty state that offers "clear filters", Enter/Esc while editing a row, drag & drop, a size/type pre-check, a sample CSV download, and a list of "needs review" (ambiguous) rows after import.

**Products**
22. The price history was fetched but never shown. It is now displayed, plus a "cheapest" badge.
23. Save sends only the changed fields. It used to resend everything, which could overwrite a concurrent edit. → `ops-logic.test.ts` ("product patch").
24. A malformed product id now gives a 404 instead of a 500.

**Exports**
25. **The default "from" date was the last day of the previous month in Israel.** It was computed with `toISOString()` on local midnight. → Israel-time calendar presets (this month / last month / last 30 days / this year), plus from > to validation. → `ops-logic.test.ts` ("export range").
26. **The CSV opened as gibberish in Excel.** It had no BOM. → A BOM is now prepended client-side; the server content is unchanged. → e2e above.
27. **The server's "to" day depended on its timezone.** `setHours` used the process timezone. → Bounds are pinned to UTC. → `ops-routers.test.ts`.
28. A gated `accounting_export` now shows the upsell instead of a raw error.

**English product names (0028)**
- In English, `name_en` is shown with the Hebrew as secondary text across suppliers, catalog, orders, product, search and mapping.
- Editing:
  - `name_en` on product detail and inline in the catalog table, through the existing tenant-guarded `products.update`;
  - supplier `name_en` on create and on the details tab, through `suppliers.create` / `suppliers.update`.
- No new procedures, so no new COVERAGE keys. I added 2 cross-tenant attack tests (foreign product / supplier `nameEn` stays untouched) in `cross-tenant.attack.test.ts`.

**Chrome / UX**
- Responsive app shell:
  - desktop: sticky header plus one row of grouped tabs;
  - below `lg`: a menu drawer (search, grouped links, language, sign-out) and a bottom bar with the role's first 4 destinations plus "More".
- Skip-link, focus rings everywhere, and `aria-current`.
- `LocaleSwitcher` is kept. The worker banner is localized and has an icon. Loading states are localized.
- New shared components: `ToastProvider` / `useToast`, `Breadcrumbs` (detail pages), `LinkButton` (replaces the invalid `<Link><Button/></Link>`), `Select`, `displayName`.
- Number columns are end-aligned with `tabular-nums`. Orders show as stacked cards on phones.
- `ActivityFeed`: timestamps are in Israel time; English rebuilds the stored Hebrew templates ("Invoice 2026-1000 matched · 9 discrepancies · potential loss ₪3,571").

## Still broken / not done

- **The worker banner shows locally** because no worker is running. In the demo, start the worker (`apps/worker`) or it will say the engine is offline. This is S7's area.
- **Catalog tables scroll sideways on phones** (`min-w` + `overflow-x-auto`). Orders use cards. A card layout for the catalog is a follow-up.
- **The seed has no catalog items and no `name_en`.** For screenshots I imported the fixtures through the UI and set 17 English names in the **dev DB only**. See "Needs another area".
- The `activity.feed` cursor is `createdAt` only, so rows that share a timestamp could be skipped. That never happens in practice; a `(createdAt, id)` cursor would fix it.
- Prettier/eslint were not run on web, because web lint is not in the v1 gate (AGENTS.md).

## Feature & improvement proposals (value / effort)

1. **Seed English names + a demo catalog** (high / S, S1): make "Receiver in English" visible without manual setup.
2. **Auto-suggest `name_en`** via the S2 translate package, as a "Suggest" button in the catalog's English-name cell (high / S).
3. **Order from the leak view** (high / M): a "re-order from cheapest supplier" action that uses the product page's cheapest badge.
4. **Catalog card layout on mobile + bulk "edit English names" grid** (medium / M).
5. **Import history** (`catalog_imports` already stores status/errors): a list on the supplier catalog tab (medium / S).

## Immutable files touched

- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: **additive only**, 2 new attack tests for `nameEn`. No assertion was changed and no COVERAGE entry was added or removed (no new procedures).
- Nothing else on the AGENTS.md list was touched. The matching engine, schema, RLS, `leads.ts`, `outbox.ts`, `cron.ts` and `plans.ts` are untouched. The leak-canary is unchanged and green.

## Needs another area

- **S1 (seed):** the merged base now seeds `name_en`. Still worth adding: a supplier price list (`supplier_catalog_items` is empty after seeding). The fixtures in `docs/client-ready/fixtures/ops/` can be reused.
- **S3:**
  - `owner.suppliers` scorecards don't return `nameEn`, so the scorecards tab shows Hebrew supplier names in English.
  - `logActivity` titles are stored as Hebrew sentences. I localize the known templates client-side (`lib/components/activityText.ts`); storing `metadata` (invoice number, counts, ₪) and rendering it would be cleaner.
- **S4:** done in the merge. The header now uses `labelForRole(role, locale)` and keeps `<LocaleSync />`; sign-out is translated (`nav.signOut`).
- **S7:** the full `pnpm test` hits "too many clients already" when a `next dev` server and Playwright sessions share the local Postgres (default max_connections=100). Run the suite with the dev server stopped, or raise `max_connections` in `dev-setup.sh`.

## Gate

```
pnpm --filter @restomatch/api exec vitest run src/__tests__/ops-routers.test.ts   → 21 passed
pnpm --filter @restomatch/api exec vitest run src/__tests__/cross-tenant.attack.test.ts → 82 passed
pnpm --filter @restomatch/web exec vitest run app/dashboard/__tests__/ops-logic.test.ts lib/components/__tests__/ops-components.test.ts lib/__tests__/i18n.test.ts → 59 passed
DATABASE_URL_TEST=… pnpm test   (dev server stopped) → Tasks 12/12 successful (api 410, web 160, matching 76 incl. leak-canary, …)
after merging origin/claude/client-ready (S1+S3+S6, migrations 0029–0032 applied) → Tasks 12/12 successful (api 423, web 165, matching 86, db 43)
after merging origin/claude/client-ready e7ae653 (+S4) → Tasks 12/12 successful (api 436, web 176, db 45); tsc 0; pnpm build green
pnpm --filter @restomatch/web exec tsc --noEmit -p .  → 0 errors
cd apps/web && set -a && . ./.env.local && set +a && pnpm build → green (only pre-existing bullmq / jose dependency warnings)
Playwright e2e (scratchpad driver, real UI) → 8/8 PASS
```
