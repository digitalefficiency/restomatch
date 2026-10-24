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

## Follow-up round (orchestrator request)

1. **Catalog card layout on phones.** Below `md`, every catalog item is a card: description, supplier, price, product link, an inline English-name editor, SKU and unit, plus edit/toggle/delete. There is no sideways scrolling, and adding/editing items works the same as in the desktop table. The shared `SectionHeader` now stacks its actions under the title on phones, so wide button rows wrap instead of overflowing. Screenshots: `ops-catalog-{he,en}-mobile.png`.
2. **Bulk "English names" grid** (`/dashboard/products`, linked from the catalog header "English names" button). It is a spreadsheet-like editor:
   - one English input per product;
   - Enter / ↓ moves to the next row, ↑ to the previous one, Esc reverts a cell;
   - Ctrl/⌘+S saves; unsaved cells are highlighted, with a sticky "Save N changes" bar and a warning before leaving the page;
   - a "missing only" filter, search in Hebrew or English, and an overall progress bar.

   Saves go through the new `products.setNamesEn`. It is all-or-nothing: every product id must belong to the caller's restaurant, otherwise it returns NOT_FOUND and writes nothing. It is manager-only, rejects duplicate ids, and accepts at most 200 rows. Reads use the new `products.list`. I verified it end-to-end in English: of 8 missing names I typed 2 with Enter navigation and saved with Ctrl+S; the progress went from 56/64 to 58/64. Screenshots: `ops-products-names-{he,en}[-mobile].png`.
3. **Import history** on the supplier catalog tab, from `catalog_imports` via the new `catalog.imports`. It lists file, time, status, rows / new / updated, and the error for failed imports. It refreshes every 5 s while an import is still processing. Screenshots: `ops-suppliers-detail-tab-catalog-{he,en}.png`.

Tests:
- `ops-routers.test.ts` (+4): list filters, batch save/trim/clear, manager-only + duplicate ids, import history order + counts.
- `cross-tenant.attack.test.ts` (+3; COVERAGE adds `catalog.imports` isolation, `products.list` isolation, `products.setNamesEn` attack). A mixed batch with a foreign product writes nothing.
- `ops-logic.test.ts` (+1): `namesBatch`.

## Round 3 (S3 money QA + S6 English sweep)

1. **Supplier header leak matched the dashboard's basis.** It used `monthExcessIls`, a projection that re-prices past purchases at the latest price: HaKerem showed ₪328. It now sums `paidExcessIls`, what was actually paid above the 90-day median in 30 days. That gives ₪144, matching the leaks page's ₪144.15. The label is now "Paid above median (30 days)" / "שולם מעל המחיר החציוני (30 יום)". Sum is in integer agorot. File: `suppliers/[id]/layout.tsx`.
2. **Accounting export: which invoices, and which day.**
   - Decision (`packages/api/src/exports/period.ts`, `EXPORTABLE_INVOICE_STATUSES`): every checked invoice, which means `matched`, `disputed`, `approved` and `paid`.
     - Disputed invoices are real purchases and tax documents; the status column flags them.
     - `ocr_pending` / `parsed` stay out: unverified, or consolidated invoices waiting for delivery notes.
   - Day bounds and the printed invoice date now use the restaurant's timezone (default Asia/Jerusalem) via `startOfDayInTz`/`endOfDayInTz`. It used UTC, which moved invoices dated 00:00–03:00 IL on the 1st into the previous month.
   - The note on the exports page now states the rule in he/en.
   - Tests: `ops-routers.test.ts` (22:30 IL on the last day included; 00:30 IL on the 1st belongs to that month with the IL date printed; disputed included in CSV + 1000; parsed excluded).
3. **Supplier Details tab stuck on "Loading supplier…".**
   - I couldn't reproduce it locally: direct loads, tab switches and coming from the list all rendered.
   - The likely cause is the first client tRPC call stalling while the dev server compiles.
   - Hardened anyway: the server page passes the supplier it already loads as `initialData` to the Details and Schedule tabs. They render immediately, with no client round trip before the form appears. Verified in he and en.
4. **Restaurant name in the header / mobile drawer** is wrapped in `<span lang="he" dir="auto">`. It is tenant data, usually Hebrew, shown inside the English UI. It is isolated without changing the header's alignment.
5. **appCode mapping (not done; not cheap within my boundary).** Mapping my routers' errors to stable codes would mean adding new entries to S4's `APP_ERROR_CODES` list in `packages/api/src/errors.ts`. My screens already localize by tRPC code (`friendlyError`) and by the `CATALOG_FILE_<code>` token. Proposal for S4: add `catalog.duplicateSku`, `catalog.file.*`, `orders.notDraft`, `orders.cannotCancel`, `orders.noLines`, `orders.noContact` and `products.linked`. I'd then switch the overrides to `data.appCode`.

## Round 4: EXP-DUP-1 + full ops QA on the release candidate (b5334f6)

### Fixed (problem → fix → test)

1. **EXP-DUP-1: a flagged duplicate was booked twice in the accounting exports.**
   - **Problem:** since 3b70d7a the CSV and the uniform-1000 file include `disputed` invoices. The second copy that the engine flags DUPLICATE_INVOICE stays `disputed` forever, so it was exported next to the original.
   - **Fix:** `packages/api/src/routers/exports.ts` `unacceptedDuplicate()`. Exclude an invoice whose **latest** match run has a DUPLICATE_INVOICE discrepancy that is not `rejected`. The restaurant is pinned on both `match_runs` and `discrepancies`.
   - **Semantics:** in approvals, Approve = `accepted` = "Claimed", meaning the duplicate is confirmed. Reject = `rejected` = "Waived", meaning it's not a duplicate.
     - My first cut excluded "not accepted". The independent refuter caught that this is backwards: approving a duplicate exported it, and waiving one dropped a real invoice.
     - The brief's wording ("not resolved as accepted") has the same inversion.
   - **Why the latest run only:** a re-match that clears the flag, for example after a misread invoice number is fixed, brings the invoice back. Earlier runs are never closed.
   - **Tests** (`ops-routers.test.ts`):
     - Open and claimed duplicates are excluded from CSV and 1000.
     - A waived duplicate and a normal `PRICE_HIGHER` dispute are included.
     - A clean re-match after a duplicate flag puts the invoice back into the export.
2. **Undated checked invoices were silently missing from every export.**
   - **Fix:** both export procedures return `undatedCount`, the number of checked invoices created in the period with a NULL `invoice_date`. Duplicates are not counted.
   - The exports page shows a warning that the file doesn't carry them and the date can be added on the invoice page. Any change to the range clears the warning.
   - **Test:** `ops-routers.test.ts`.
3. **Double-click created duplicates.**
   - **Observed on the production build:** 2 suppliers, and 2 *sent* POs from the wizard. Both clicks fire before `isPending` disables the button.
   - **Fix:** `lib/components/singleFlight.ts` (`useSingleFlight`) drops re-entrant submits while one is in flight. Applied to supplier create, catalog item create, catalog import commit, wizard send and PO-detail send.
   - **Tests:** `ops-components.test.ts` (3 cases), plus the Playwright dblclick checks below.
4. **`/dashboard/products` had no route rule.** Receiver, bookkeeper and chef could open product pages (prices, names grid) by URL.
   - **Fix:** `ROUTE_ROLES['/dashboard/products'] = owner, manager`, the same as the catalog.
   - **Test:** `roles.test.ts`.
5. **Phones (390px) hid the ₪ columns.**
   - On the PO detail, unit price and line total sat behind a horizontal scroll inside the card. Same for the list price on the product page.
   - **Fix:** secondary columns fold under the name on phones. Editing a line restores the full table.
   - PO line totals now use the agorot-rounded `lineTotalIls`.
   - **Test:** Playwright asserts that no PO-lines table is clipped at 390px.
6. **English-names grid lost edits.**
   - An edit made before searching or filtering was dropped on save, because pending edits came from the visible rows only.
   - Edits now carry their original value. Saves go out in batches of at most 200 (the procedure's cap), and anything not saved is kept.
   - **Tests:** `ops-logic.test.ts` (`pendingNames`, `chunk`).
7. **Supplier schedule:** a cleared cutoff time got through to a generic "invalid fields" error. It is now validated in the client with its own message (`scheduleRowProblem`, tested).
8. **Copy:** "1 changes" / "1 checked invoices" plurals reworded, since there's no plural support in i18n.

### QA (production build, `next start`, local DB only)

- **Sweep:** 5 roles × he/en × 1440/390 × 19 ops routes = 380 page loads. Covered: suppliers list, scores, new and 4 detail tabs; catalog, import and mapping; products and product detail; orders list, new, import and detail (sent and closed); exports.
  - Owner and manager: every page 200, `dir` correct, no horizontal page overflow, no stuck "Loading…", no 5xx.
  - Receiver, bookkeeper, chef: redirected from every area they can't see, products included now. The bookkeeper reaches exports, and the manager doesn't.
  - **React #418 (hydration), also seen once by S4 on /dashboard/catalog/import.** I saw it once on /dashboard/catalog (manager, en, 390), during a sweep right after QA data was created.
    - **Not reproduced** in 360 further production loads, covering he/en, 390/1440, the catalog, import (with and without `?supplierId`), mapping, products, suppliers, orders and exports, with seed data and with imported catalogs. Also clean under `next dev`, which logs nesting and hydration diffs.
    - **Audited and ruled out:**
      - Render-time `Date`, `Math.random`, `window`/`document`/`localStorage` reads: none in these client trees.
      - Dates: all go through `formatDate`, which uses a fixed `Asia/Jerusalem` timezone.
      - QueryClient: created per mount.
      - CookieConsent and the mobile drawer/bottom bar: decide after mount.
      - LocaleSync: works in an effect.
      - Worker banner: server-only.
    - No speculative fix shipped. S6's opt-in `e2e/i18n-sweep.spec.ts` already fails on any page or console error, so it catches a recurrence.
    - **Lead if it recurs:** grab the dev-mode diff. Note that running `next dev` against the same `apps/web/.next` overwrites a production build: I hit this, and it broke the prod server until a rebuild.
- **Flows**, owner, run in he/en × 1440/390, all PASS on the final build:
  - Create a supplier with a 120+ character Hebrew name, double-clicking Save: exactly one row, no overflow.
  - Details save, checked in the DB.
  - Import XLSX (12 rows, double-click) and Windows-1255 CSV (6 rows, auto-mapped).
  - `.xls` and headerless CSV rejected with guidance.
  - Names grid bulk save, double-click: 2 rows saved.
  - Wizard send, double-click: exactly 1 PO.
  - Draft line edit: DB total = Σ agorot-rounded lines; cancel works.
  - Global search by English name navigates.
  - CSV + uniform-1000 for the month.
- **Exports vs the hero (this month):**
  - CSV: 24 rows (12 paid, 10 matched, 2 disputed).
  - Σ excl. VAT ₪28,388.97 = the hero's ₪28,389 spend. Σ incl. VAT ₪33,486.34.
  - Every row passes VAT = 18% (or 17% for older rows) and excl + VAT = incl to the agora.
  - Uniform-1000: 24 C100 lines, each exactly 136 characters.
- **Independent refuter subagent** (≈60 min on the same build): found the inverted `accepted` semantics, the stale-run exclusion, grid edits lost on filter, the stale warning and plurals, and the empty cutoff. All fixed above.
  - **Could not refute:** tenant pinning of the export subquery; disputed invoices still exported; layout in he/en at 390/1440 including long Hebrew names; catalog import error paths; the products route gate.
- The demo DB was reset with `dev-setup.sh` afterwards: hero ₪572 / ₪28,389, no QA rows left.

### Verification (2 layers)

- **Layer 1, full gate:** see "Gate" (round 4 line).
- **Layer 2:**
  - `pnpm --filter @restomatch/web build` and `next start` (placeholder email/Supabase keys, nothing sent).
  - Playwright sweep and flow drivers (`executablePath /opt/pw-browsers/chromium`).
  - An independent refuter subagent. Its findings were fixed, then the build was redone and the flows re-run: 4/4 runs green.

## Round 5: flag `orderPricesOut` + ops QA at DEMO_TODAY=2026-10-25

**Feature (flag `orderPricesOut`; off = today's "item — quantity" text, byte for byte).**
- Module `packages/api/src/orders/document`:
  - `build.ts`: integer-agorot money; `qty × price` is rounded half-up once.
  - `text.ts`: email and compact WhatsApp texts.
  - `pdf.ts`: RTL Hebrew PDF with Heebo embedded. Bidi uses visual reordering; Hebrew glyphs are drawn one at a time because fontkit reverses Hebrew-first runs.
  - `load.ts`: SKU falls back to the supplier catalog number for the line's product.
- placeOrder:
  - email: text body + `order-XXXXXXXX.pdf` in `payload.__attachments`;
  - WhatsApp: the compact priced text.
- Settings: `orders.documentSettings` / `setDocumentSettings` (hide prices, default show; owner/manager; atomic `jsonb_set`). Toggle on `/dashboard/orders`.
- Preview: `orders.documentPreview` and the "What the supplier receives" card on the PO page (email / WhatsApp text and a PDF download).
- Extension hook: `ORDER_DOCUMENT_EXTENSIONS` — `(doc, ctx{db, restaurantId, poId, userId, mode}) => string[] | Promise<string[]>`.
  - With the flag on, placeOrder marks the PO `sent` before building the document (same transaction).
  - S11's `supplierConfirmDocumentExtension` is registered with one line at integration.
- Delivery: the worker's `outboxDispatch.ts` and the Resend sender pass attachments through. `outbox.ts` and `cron.ts` are untouched.

**QA on `next start`, demo DB seeded with DEMO_TODAY=2026-10-25.**
- **New UI:** owner, manager and receiver × he/en × 1366/390, 12/12 OK, 0 console errors, no horizontal scroll.
- **Sweep:** suppliers (list, details, catalog, schedule, orders tabs), catalog, products, orders list/detail/new, exports, integrations; owner × he/en × desktop/mobile and receiver on mobile: 56 screens, 0 console errors.
- **Functional:**
  - New-order wizard → send by email (he/390, en/1366): the outbox row carries SKUs, agreed prices, the agorot total and the PDF.
  - All 5 exports download in he and en: CSV, uniform 1000, Hashavshevet, Priority, Rivhit.
- **Fixed:** on phones, the wizard's "send via" option `אימייל (orders@…)` rendered bidi-scrambled with the bracket cut off. The address is now wrapped in Unicode isolates (`ltrIsolate`), with a test.
- **Sent to the orchestrator (seed, not S5):** `packages/db/scripts/seed.ts:476` seeds the drinks PO for today+2 with `createdAt = delivery − 24h`, so the orders list shows "created 26/10" when DEMO_TODAY is 25/10.

## Still broken / not done

- **Round 4 notes, not fixed:**
  - **Uniform-1000 encoding:** records are 136 *characters* but written as UTF-8. Byte-oriented tax-software readers expect ISO-8859-8 / Windows-1255 and CRLF, so Hebrew names would shift columns. This predates the change; it's the export format owner's call.
  - **CSV status column:** the Hebrew CSV prints raw `paid/matched/disputed`.
  - **Products data access:** `products.list` / `search.global` are member-readable over tRPC. The new restriction is route-level, matching how the catalog is gated.

- **The worker banner shows locally** because no worker is running. In the demo, start the worker (`apps/worker`) or it will say the engine is offline. This is S7's area.
- **The seed has no catalog items and no `name_en`.** For screenshots I imported the fixtures through the UI and set 17 English names in the **dev DB only**. See "Needs another area".
- The `activity.feed` cursor is `createdAt` only, so rows that share a timestamp could be skipped. That never happens in practice; a `(createdAt, id)` cursor would fix it.
- Prettier/eslint were not run on web, because web lint is not in the v1 gate (AGENTS.md).

## Feature & improvement proposals (value / effort)

1. **Seed English names + a demo catalog** (high / S, S1): make "Receiver in English" visible without manual setup.
2. **Auto-suggest `name_en`** via the S2 translate package, as a "Suggest" button in the catalog's English-name cell (high / S).
3. **Order from the leak view** (high / M): a "re-order from cheapest supplier" action that uses the product page's cheapest badge.
4. ~~Catalog card layout on mobile + bulk English-names grid~~ (done in the follow-up round).
5. ~~Import history~~ (done in the follow-up round).
6. **"Suggest translations" in the English-names grid** via the S2 translate package (high / S).

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
round 3: pnpm test 13/13 (api 488, web 183); tsc 0; pnpm build green (one retry: Google Fonts fetch timed out); he/en checks of supplier header (₪144 = leaks page), details tab, restaurant-name markup
round 4 (final code): web lint 0 errors (3 pre-existing warnings, none in S5 files); pnpm -r typecheck 0 errors; pnpm test Tasks 13/13 (api 496, web 204, matching 86 incl. leak-canary); pnpm build green; Playwright flows 4/4 green on the rebuilt next start
follow-up round: pnpm test 12/12 (api 443, web 177); tsc 0; pnpm build green; English-names grid e2e (Enter navigation + Ctrl+S, 56→58 of 64) PASS
```
