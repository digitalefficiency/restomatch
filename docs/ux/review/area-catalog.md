# Area review: Catalog, price-list import, SKU mapping, products and product detail (`catalog`)

**Reviewer:** UX review team, catalog area · **Date:** 2026-10-25 · **Build:** `main` @ `8fef118c` (lab checkout `ux/wt`)
**Routes:** `/dashboard/catalog` · `/dashboard/catalog/import` · `/dashboard/catalog/mapping` · `/dashboard/products` · `/dashboard/products/[productId]` (plus the shared `CatalogBrowser` and `ImportHistory`, which also render in the supplier hub's catalog tab)
**Roles with access:** owner and manager only (`apps/web/lib/roles.ts:66-69`). Chef, bookkeeper and receiver are bounced.
**Rubric archetypes:** catalog = List · import = Form · mapping = Queue · products = List/Form (bulk editor) · product detail = Detail.

## Scores against the world-class benchmark (0–10)

| Lens | Score | One-line reason |
|---|---|---|
| **Mobile** | **3.5** | The phone catalog is a 50-card, 11,759 px scroll of 215 px cards with no quick price check, no "order this" and no barcode. The product page opens on an edit form. Import and mapping are desktop flows squeezed onto a phone. |
| **Desktop** | **4.5** | Inline row edit with Enter/Esc works, and the English-names grid is a good bulk editor. But the table can't be sorted or bulk-edited, has duplicate columns and wrapping SKUs, and has no price-change or health signal. The owner can't answer "what went up?" here. |
| **Functionality** | **4.0** | Strong plumbing: Windows-1255 CSV, typed file errors, an import history that polls, and mapping that backfills and learns. But import can silently mis-link products and mis-parse "1,250". There is no diff, undo or merge, no cross-supplier compare, and the mapping queue is partial, unannounced and has no suggestions. |

**Verdict in one paragraph.** Setup and maintenance is where the North Star number is made or broken. Every wrong product link, unmapped SKU and wrong list price shows up later as a false or missed ₪ leak. The area has the right building blocks: supplier-scoped matching, alias learning, mapping backfill and import history. It runs them as **blind batch jobs with no review moment**. The import commits without showing what changed and auto-confirms medium-confidence guesses as permanent aliases. The mapping queue needs typing for every row, only sees SKU-bearing lines, never re-runs the match, and is not announced anywhere. The "products" route is really a translation tool, and the product page is an edit form, not an answer. World-class AP and item-master tools (Ottimate, MarginEdge, xtraCHEF Price Tracker, Restaurant365 item master, Shopify product admin) put a **review/diff step and a suggestion-first triage queue** at exactly these two points. That is the gap to close.

## Lab caveats specific to this area
- The demo tenant is fully mapped. The lab DB has 0 invoice or PO lines with `product_id IS NULL`, so `/catalog/mapping` only rendered its empty state. The populated queue was reviewed from code (`mapper.tsx`, `routers/mapping.ts`).
- Import steps 2–4 (file, mapping, done) were not captured; only step 1 was. They were reviewed from `catalog/import/wizard.tsx` and `packages/api/src/catalog/*`.
- The demo has 0 products sold by more than one supplier (lab query over `supplier_catalog_items`). The product page's "הזול ביותר" badge and any supplier comparison never render in the demo.
- The red worker banner and the cookie bar are lab artefacts. The cookie bar does cover the names-grid sticky save bar and table rows on desktop (noted once, globally).

---

## 1. Page-by-page review

### 1.1 `/dashboard/catalog`: "חיפוש מאוחד בקטלוג"
Shots: `dashboard_catalog__owner__desktop-he.png`, `…__phone-he.png`, `…__desktop-en.png`. Crawl: 200, loadMs 1795 (desktop) / 1556 (phone). Page height: 3,754 px desktop, **11,759 px phone**. Small targets: 98 / 101. axe: **target-size ×52 (serious) on phone**.

**What it is.** One flat table of `supplier_catalog_items`. Columns: ספק · תיאור הספק · מוצר · שם באנגלית · מק״ט · יחידה · מחיר מחירון, plus 3 icon actions per row. There is a supplier `<select>`, a search box, a "show inactive" checkbox, and "Load more" in pages of 50. Phones get a card per item.

**What works**
- Inline edit with Enter = save and Esc = cancel (`browser.tsx:200-207`). The add row autofocuses.
- Typed empty states: first-use vs no-results with "ניקוי סינון" (`browser.tsx:306-327`).
- A phone card layout exists, so there is no sideways scroll (`overflowX 0`).
- `useSingleFlight` guards double-create (`browser.tsx:189`).

**What is wrong (desktop)**
- **No "so-what".** The page can't answer the owner's only catalog question, "which prices moved, and what does it cost me?" There is no last-invoiced price, no Δ vs list or contract, no Δ 30/90 days, no ₪ impact, and no freshness ("price list from 26.08"). xtraCHEF Price Tracker leads with average % change and $ impact per item.
- **Columns waste width.** "תיאור הספק" and "מוצר" are the same text on 50 of 50 visible rows (desktop-he crops 0–3). "שם באנגלית" takes about 25% of the width in the Hebrew view. `packSize` is fetched (`routers/catalog.ts:148`) but never shown. Because of the pack size, "קולה זירו (ארגז 24)" at ₪62 and the same can at a per-unit price can't be told apart.
- **Identifiers wrap.** "BA-\n1001" breaks at the hyphen in every row (desktop-he crop 0). Supplier names wrap too ("עמית חומרי\nניקוי", "משקאות\nשטיינברג"). The SKU cell has no `whitespace-nowrap` and no `<bdi dir="ltr">` (`browser.tsx:488-499`).
- **Row actions shout.** Each of 50 rows has a pencil, a power icon and a **red trash**: 150 icon targets and 50 red marks on a page with nothing urgent (`browser.tsx:549-586`). This breaks C2 (max 2 inline) and the T2 emphasis budget (red only for act-now).
- **No sort, no sticky header, no total.** The table is fixed alphabetical by raw name (`routers/catalog.ts:153`). The headers are plain `<th>`. The count reads "50+ פריטים" (`browser.tsx:286-289`) because the API returns no total.
- **No bulk.** You can't select rows to deactivate, re-categorise, change unit or export. Deactivating the 12 items a supplier dropped takes 12 clicks, 12 refetches and 12 toasts.
- **Money in mono** (`browser.tsx:514`) and headers in `uppercase tracking-wide` (`browser.tsx:358`).
- **Header crowding.** Four buttons: אינטגרציות · שמות באנגלית · מיפוי מק״טים · ייבוא (`page.tsx:38-53`). Integrations doesn't belong in a catalog header (it is an orphan route parked here, per ia-map #7). Mapping carries no count, so nobody knows there is work to do.
- **h1 ≠ nav.** The nav says "קטלוג" and the h1 says "חיפוש מאוחד בקטלוג" (crawl h1). That describes a feature, not a place (D5, E9).

**What is wrong (phone)**
- Each card is about 215 CSS px: name, supplier, price, then a 4-row `dl` (מוצר duplicate · English · SKU · unit), then an action bar (`browser.tsx:717-793`). That gives about 3.5 items per screen and an 11,759 px page. The first item starts about 595 CSS px down, after the banner, 4 header buttons in 2 rows, the supplier select, search and a checkbox (phone crop 0).
- The search placeholder is truncated ("שם מוצר / מק״ט / שם בא…").
- Edit fields are `text-sm` (14 px) (`browser.tsx:674-697`), so iOS zooms on focus. Price is `type="number"` (`:689`).
- The English name is visibly mis-indented, because an invisible (`opacity-0`) pencil icon reserves space (`browser.tsx:848`; phone crops 1, 3).
- There is no barcode scan, no "+ להזמנה", and no tap-to-peek. The floor manager who opens the catalog to check a price or reorder has no next action.

**States and functions**
- Errors from a row edit go to **one alert box above the table** (`browser.tsx:294-298`), far from the row (C9 S1). Successes also toast after the UI already shows the result (`:128, 138, 145, 152`; C9 redundant).
- Native `confirm()` for delete (`browser.tsx:350, 579`; C10).
- There is no `loading.tsx` or `error.tsx` for `/catalog` or `/products`. The server page awaits 6 calls, including `integrations.status`, before first paint (`page.tsx:12-19`).
- Filters (supplier, query, inactive) live in `useState` (`browser.tsx:82-86`). Opening a product and pressing Back loses them, along with every "Load more" page (D8).
- "הוספת פריט" only appears after a supplier is picked. The hint is 12 px muted text (`browser.tsx:267, 291`). In a new tenant with no suppliers, the empty state says "add an item manually", and that is impossible: a dead end.
- Search is plain `ILIKE` (`routers/catalog.ts:124-128`). It does no Hebrew normalisation (״ vs ", final letters, wrong keyboard layout).

### 1.2 `/dashboard/catalog/import`: "ייבוא מחירון"
Shots: `dashboard_catalog_import__owner__{desktop-he,phone-he,desktop-en}.png` (step 1 only). Crawl: 200, about 1.5 s.

**What it is.** A four-step wizard: supplier → file → column mapping → done. It auto-detects columns from Hebrew and English keywords (`parse.ts` `autoDetectMapping`). CSV decoding falls back from UTF-8 to Windows-1255 (`file-logic.ts:18-25`). Typed file errors (legacy `.xls`, unreadable, no header, too many rows) map to Hebrew fixes. There is a sample CSV. Files over 1,500 rows go to a background job.

**What works**
- The error copy is concrete and fixable: "זה קובץ Excel ישן (.xls). פתחו אותו ב-Excel ושמרו בשם כ-.xlsx…". That is a model for the product.
- Drag-and-drop has a button alternative (F4 2.5.7 pass).
- `?supplierId=` skips step 1 when you arrive from the supplier hub (`page.tsx`).

**What is wrong**
1. **It commits blind.** Step 3 shows 6 raw sample rows and the column selects, then "ייבוא N שורות" (`wizard.tsx:320, 343-347`). Nobody sees which prices went up or down, which items are new, or which items in the catalog are missing from the new list. For the North Star this is the most valuable moment in setup: a new price list *is* a price-increase notice.
2. **Medium-confidence guesses become permanent truth.** Rows that match an existing product at 0.6–0.9 are linked to it (`commit.ts:125-134`). Then `recordConfirmedMatch` is called **without** a confidence for non-new products (`commit.ts:185-191`), so the alias is stored at **1.000** (`learning.ts:67`). From then on every invoice line with that raw name auto-resolves to the guessed product. The done screen lists up to 10 of these as plain text: "'{raw}' ← {product} (78%)" (`wizard.tsx:380-395`). There is no accept, change or unlink. This breaks H5 ("only high confidence is pre-checked; a medium suggestion waits for a yes") on the path that feeds the ₪ engine.
3. **"1,250" imports as ₪1.25.** `parseNumeric` treats a lone comma as a decimal point (`parse.ts:237-238`). Reproduced: "1,250" → 1.25, "₪1,250" → 1.25, "2,400" → 2.4. Excel "Save as CSV" writes the displayed format, so any formatted price of ₪1,000 or more (kegs, meat cases, oil drums) loses three orders of magnitude. The preview shows **raw strings**, not parsed values (`wizard.tsx:320-328`), so nobody can catch it.
4. **Real price lists don't fit.** The header must be row 1 (`parse.ts:129`), and only the first sheet is read (`parse.ts:125`). Israeli supplier lists often open with a logo and title block and split categories across sheets. Many arrive as **PDF or WhatsApp photo**: the file input only accepts xlsx/csv (`wizard.tsx:239`). There is no paste-from-clipboard.
5. **No VAT basis or effective date.** The wizard never asks "המחירים כוללים מע״מ?" or "בתוקף מ-". List prices then feed order totals (`routers/orders.ts:493-503`) and "cheaper supplier" offers in price alerts (`priceAlerts/sweep.ts:204-235`).
6. **No undo.** `commitCatalogRows` overwrites `list_price` in place (`commit.ts:172-177`) and keeps no previous value. Mapping the wrong column (say, carton price into unit price) corrupts every price for that supplier, and there is no rollback.
7. **Wizard overhead.** Step 1 is a whole step for one `<select>`, and "המשך" is disabled with no reason (`wizard.tsx:206`; C6). The step chips are not a progress bar and not clickable (`wizard.tsx:176-191`). The buttons are `size="sm"` (`text-xs`). "המשך ←" uses a raw `ArrowRight` with `rtl:-scale-x-100` (`wizard.tsx:65`; E2 wants `<DirIcon>`). The mapped-column badge is `text-[10px]` (B1). On a phone, step 1 is a near-empty screen (phone shot).
8. **Inline commit with no progress.** Files up to 1,500 rows commit inside the request (`routers/catalog.ts:30, 265`). The loop does about 4 sequential queries per row (`commit.ts:76-192`) behind a button spinner. That is well past 10 s with no determinate progress (I3).
9. **The done screen is a dead end.** "ייבוא נוסף" resets to step 1 even when you came from a supplier (`wizard.tsx:159-167`). There is no link to review the ambiguous rows and no "see what changed". Import history lives only on the supplier hub tab (`suppliers/[id]/tab-catalog.tsx:46, 59`).
10. **Two wizards for one file.** `contracts/import/wizard.tsx` is a 412-line near-copy with `validFrom`/`validTo`. The owner gets one Excel from the supplier and has to know whether it is a "מחירון" (catalog) or a "חוזה" (contract).
11. **Branches.** A chain owner must switch branch and import the same file once per branch. The catalog is copied only once, when a branch is created (`routers/chain.ts:606-624`).

### 1.3 `/dashboard/catalog/mapping`: "מיפוי מק״טים"
Shots: `dashboard_catalog_mapping__owner__{desktop-he,phone-he,desktop-en}.png` (empty state only). Crawl: 200, about 1.5 s.

**What it is.** Distinct (supplier, SKU) pairs from PO and invoice lines that have a SKU but no product, sorted by occurrences (`routers/mapping.ts:41-110`). Per row: "מיפוי" → type to search → tap a product, or "צור מוצר חדש". Confirming learns the alias, backfills PO and invoice lines, and links the catalog row (`mapping.ts:136-239`).

**What is wrong**
1. **It doesn't re-match.** Matching pairs PO and invoice lines by `productId` (`packages/matching/src/engine.ts:203, 228`). Mapping backfills `product_id` but never enqueues `match-invoice` (`mapping.ts:187-231`; `match-invoice` exists in `apps/web/lib/jobKick.ts:31`). Discrepancies computed while the line was unmapped stay in the leak hero and the approvals queue until something else triggers a re-match. The toast promises "{count} שורות עודכנו" and the leak number doesn't move.
2. **It only sees half the problem.** Lines without a SKU are excluded (`mapping.ts:63, 84`). OCR'd invoice lines often have no SKU, and when they have no product either they are unmappable anywhere in the product. Import "ambiguous" rows and catalog items with `product_id IS NULL` are not in the queue either.
3. **Nobody is told.** There is no count on the nav item, the catalog header button (`catalog/page.tsx:47`), the home Needs-you stack or the invoice page. The queue is reachable only from a secondary button.
4. **No suggestion.** The row starts closed. Results load only after typing at least 1 character, behind a 250 ms debounce (`mapper.tsx:82`), although `matchProductTopN` already ranks candidates (`packages/catalog/src/matcher.ts:405-478`). This is the textbook case in `ainative.md` pattern 7 / rubric H5.
5. **No evidence, no ₪.** A row shows a supplier chip, "מק״ט X", "N שורות" and one sample description (`mapper.tsx:110-124`). It doesn't show unit, unit price, last date, a link to the source invoice, or the ₪ at stake. It is ranked by count, not money (`mapping.ts:109`).
6. **No escape hatches.** You can't mark a line "לא מוצר" (deposit, delivery fee, discount), skip it, unlink after confirming, filter by supplier (the API supports it at `mapping.ts:42`; the UI has no filter), or bulk-accept.
7. **Not optimistic.** It invalidates and refetches the whole list (`mapper.tsx:58`; I2). Every row has a solid primary "מיפוי" (`mapper.tsx:127`), so a queue of 20 shows 20 green buttons. There are no keys (I6).
8. **Inbox-zero is bare.** "הכול ממופה" doesn't say what was handled automatically ("112 מק״טים מקושרים · 56 נלמדו אוטומטית"; C8).

### 1.4 `/dashboard/products`: "שמות באנגלית"
Shots: `dashboard_products__owner__{desktop-he,phone-he,desktop-en}.png`. Crawl: h1 **"שמות באנגלית"** on route `/products`. Page height: 4,441 px desktop / 7,712 px phone. Small targets: 62.

**What works.** This is the best page in the area. It is a spreadsheet-like editor: Enter/↓ for the next row, ↑ for the previous, Esc reverts a cell, Ctrl+S saves. Dirty cells are highlighted. Saves are chunked and all-or-nothing, and edits are kept across filters (`product-logic.ts` `pendingNames`). It has a "missing only" filter, a progress bar ("57 מתוך 57") and a `beforeunload` guard.

**What is wrong**
1. **IA: the "products" route is a translation tool.** There is no product list (item master) anywhere in the app. You reach a product page only through the green link in a catalog row, global search, or a **14 px icon with `tabIndex={-1}`** in this grid (`names-grid.tsx:217-225`). That icon is unreachable by keyboard and below 24 px on touch.
2. **Ctrl+S is bound by `e.key`** (`names-grid.tsx:107`). On the Hebrew SI-1452 layout the key reports "ד", so the shortcut silently fails (F8).
3. **Unsaved edits are only guarded on reload or tab close** (`names-grid.tsx:116`). A click on the breadcrumb or any nav link drops them silently (C5).
4. **The sticky save bar is always shown**, with a disabled primary "אין שינויים" and a disabled "ביטול שינויים" (`names-grid.tsx:284-292`). It costs a 64 px band of a phone screen for nothing. On desktop the cookie bar covers it.
5. **No help with the actual work.** A restaurant with 300 products types 300 translations by hand, although the repo already has a translation glossary and cache for the receiver languages (`packages/api/src/receiving/localize.ts` → `@restomatch/translate`, `translation_cache`).
6. **English view shows Hebrew categories** ("Ben-Ami Dry Goods · יבשים"), and the headers are `uppercase tracking-wide` (`names-grid.tsx:198`).

### 1.5 `/dashboard/products/[productId]`: product detail
Shots: `dashboard_products_ID__owner__{desktop-he,phone-he,desktop-en}.png`. Crawl: 200, about 1.4 s.

**What it is.** h1 = product name, plus a subtitle about the matching engine. Then an **edit form** (name, English name, category, default unit, barcode, "ספק בלעדי") with Save and Delete. Then "מחירוני ספקים" (supplier list prices, with a "הזול ביותר" badge), then "מחירים שנצפו בחשבוניות" (the last 24 observed unit prices, as a table).

**What is wrong**
1. **It opens on an editor, not an answer.** On a phone the first ₪ figure is about two screens down (phone crops 0–1). Desktop is the same: the form fills the first viewport. The page never states the current price per unit, the trend, the contract price, ₪ spent (90 days), which recipes use the product, open price alerts, or the last invoice.
2. **"הזול ביותר" can be wrong.** It is `Math.min` over raw `listPrice` across suppliers, ignoring `unit` and `packSize` (`product-client.tsx:90, 240`). The price-alert sweep normalises to the product unit and refuses pack prices (`priceAlerts/sweep.ts:40-55`). The product page can crown a 1 kg bag "cheapest" against a 25 kg sack. The same fact is computed two ways.
3. **The history is raw.** Eight near-identical rows (₪9.75–9.85) with no chart, no Δ, no unit in the header ("מחיר ליחידה" — per what?), no link to the invoice each price came from, and a hard limit of 24 (`routers/catalog.ts:214`). One sparkline and a range ("יציב · 9.75–9.85 ₪ ב-90 יום") would replace the whole table.
4. **No supplier compare and no "add an alternative supplier".** Matching is supplier-scoped by design (the false-leak guard, `commit.ts:99-121`). Two suppliers' jasmine rice become two products, and the UI has no way to link an item to an existing product: `ItemPatchSchema` accepts `productId` (`routers/catalog.ts:51`), but the browser draft omits it (`browser.tsx:40-45`). In the demo, 0 products have more than one supplier.
5. **Delete is a dead end and sits next to Save.** The ghost "מחיקת המוצר" sits beside the primary "שמירת המוצר" (`product-client.tsx:182-196`; C12) and uses native `confirm()` (`:191`). For any product in use it then fails with "לא ניתן למחוק… השביתו אותו בקטלוג במקום" (`products/he.ts:55`). The real job is "these two are the same product: merge", and nothing offers it.
6. **Taxonomy drifts.** Category and default unit are free-text inputs (`product-client.tsx:132-145`). Category drives food-cost groupings, and "יבשים" vs "מוצרי יבש" splits them. "ספק בלעדי" and "ריק = ללא בלעדיות" are engineering vocabulary.
7. **Save with no changes** shows the danger alert "אין שינויים לשמור." (`product-client.tsx:83`). That scolds the user instead of being a no-op.
8. **Chef has no access**, although ingredient prices are the chef's job: recipes and food cost are chef routes (`roles.ts`). Recipe ingredient rows don't link here.

---

## 2. Task walkthroughs (real user, counted)

| # | Who · device | Task | Today | Benchmark |
|---|---|---|---|---|
| T1 | Owner · desktop | "The supplier sent a new price list. Load it and see what went up." | קטלוג → ייבוא → supplier select (2) → המשך → choose file (OS dialog) → ניתוח → ייבוא = **8 clicks**. Then **dead end**: "what changed" is not shown anywhere, and wrong guesses are already committed. | Drop file → review diff (↑6 · ↓2 · 4 new · 3 missing → disable?) → apply, **3 actions**, with Undo (Shopify CSV import preview; xtraCHEF Price Tracker). |
| T2 | Floor manager · phone | "What do we pay for jasmine rice, and is anyone cheaper?" | ☰ → קטלוג → scroll past about 595 px of chrome → type "אורז" → card ₪9.80 → tap the 12 px green product link → **form first**, scroll 2 screens → 1 supplier row; history table. **Cheaper? No answer** (no cross-supplier link exists). About 4 taps, typing and 2 long scrolls. | Search → compact result "אורז יסמין · ₪9.80/ק״ג · יציב" → bottom sheet with sparkline, compare and "+ להזמנה" (Choco, Rekki, Sysco Shop), **2 taps**. |
| T3 | Owner · desktop | "Unknown SKUs arrived on invoices. Map them." | **Discovery: none.** If you know where to look: קטלוג → מיפוי מק״טים → per row: מיפוי → type → wait → pick = **3 clicks + a typed search per SKU**. 20 SKUs ≈ 60 clicks + 20 searches. The leak isn't recomputed. | Pre-filled top candidate with its reason; `1` accepts and `J` moves on; "אשר 12 ודאיות" in bulk ≈ **20 keystrokes**; the toast says "הדליפה עודכנה" (Linear Triage, Ottimate, Xero). |
| T4 | Owner · desktop | "The supplier dropped 12 items. Deactivate them." | Filter by supplier → 12× power icon (each refetches and toasts) = **13+ clicks**. The import doesn't flag "not in the new list". | The import diff offers "השבת 12 פריטים שלא מופיעים במחירון" (**1 click**), or select-all → "השבתה" (Shopify bulk actions). |
| T5 | Owner · desktop | "These two products are the same. Merge them." | **Impossible.** Delete is blocked: "השביתו אותו בקטלוג במקום". | "מיזוג לתוך…" with a preview of what moves (R365 merge items; MarginEdge combine products). |
| T6 | Manager · desktop / phone | "Fix one wrong price." | Desktop: search → pencil → type → Enter = **2 clicks** ✓. Phone: עריכת פריט → 14 px inputs (iOS zoom) → `type=number` rejects "7,5" → שמירה = 2 taps plus friction. | Tap the price cell → `inputMode=decimal` → Enter, with Undo. |
| T7 | Owner · desktop | "Give 57 products English names." | Type → Enter → … → Ctrl+S ✓ (Ctrl+S fails on the Hebrew layout). | Same grid plus "הצע תרגום לכולם" with review (machine suggestion, human yes). |

---

## 3. Rubric scorecard (applicable criteria, Pass / Partial / Fail)

| Criterion | catalog | import | mapping | products (names) | product detail |
|---|---|---|---|---|---|
| A4 zero vs unknown | Partial ("—" fillers) | n/a | Partial | Pass | Partial ("—") |
| A5 T2 act-now with ₪ | n/a | Fail (no diff) | **Fail** (no ₪, no badge) | n/a | Fail (no alert link) |
| B1 type scale | Partial | **Fail** (`text-[10px]`) | Pass | Pass | Pass |
| B2 money not mono | **Fail** | n/a | n/a | n/a | **Fail** |
| B4 numeric alignment | Partial | n/a | n/a | n/a | Partial |
| C1 sort / stick / wrap | **Fail** | n/a | n/a | Partial | Partial |
| C2 row actions / batch | **Fail** | n/a | **Fail** | Pass | n/a |
| C3 cards on phone | Partial (215 px cards) | n/a | Pass | Pass | Partial |
| C5 forms / save model | Partial | Partial | n/a | Partial (in-app leave) | Partial |
| C6 validation | Partial | **Fail** (disabled w/o reason) | n/a | Pass | Partial (scolding) |
| C7 amount inputs | **Fail** (`type=number`) | n/a | n/a | n/a | n/a |
| C8 loading / empty / error | Partial (no loading/error files) | Partial | Partial | Partial | Partial |
| C9 message type | **Fail** (row error at top) | Pass | Pass | Pass | Partial |
| C10 confirm / undo | **Fail** (native confirm) | **Fail** (no undo) | Fail (no undo) | Pass | **Fail** |
| C12 action hierarchy | Partial | Partial | Fail (N primaries) | Partial | **Fail** (delete beside save) |
| C14 charts | n/a | n/a | n/a | n/a | **Fail** (table only) |
| D4 search normalisation | Fail | n/a | Fail | Fail | n/a |
| D5 where am I | Partial (h1 ≠ nav) | Pass | Pass | Partial (route ≠ content) | Pass |
| D7 reachability | Partial | Pass | **Fail** (undiscoverable) | Fail (no item master) | Partial (chef) |
| D8 state in URL | **Fail** | Partial | Fail | Fail | n/a |
| E2 direction icons | n/a | Fail (raw `ArrowRight`) | n/a | n/a | n/a |
| E3 isolate identifiers | Fail (SKU wraps, no bdi) | n/a | Partial | Pass | Partial |
| E6 no tracking on Hebrew | **Fail** | n/a | n/a | **Fail** | **Fail** |
| F4 target size | **Fail** (axe ×52) | Pass | Pass | Fail (14 px icon) | Pass |
| F8 keyboard / shortcuts | Partial | Pass | Fail (no keys) | **Fail** (`e.key`) | Pass |
| H4 machine numbers labelled | n/a | **Fail** (% on mock-bigram score) | n/a | n/a | n/a |
| H5 suggestions wait for yes | n/a | **Fail** (silent apply) | **Fail** (no suggestion) | n/a | n/a |
| H7 readable history | Fail (no price provenance) | Partial (history elsewhere) | Fail | n/a | Fail |
| I2 optimistic + rollback | Fail (refetch) | n/a | **Fail** | Pass | Partial |
| I3 wait ladder | Pass | **Fail** (≤1,500-row inline commit) | Pass | Pass | Pass |
| I4 skeletons | Fail | Fail | Fail | Fail | Fail |
| I6 triage keys | n/a | n/a | **Fail** | Partial | n/a |

---

## 4. Findings (ranked)

Format: **ID · severity · kind · route · device**, then problem, evidence, fix, exemplar, effort, and a human-PR flag. Fix owners follow AGENTS.md: `web-feature-engineer` for apps/web and routers, `ocr-procurement-engineer` for `packages/catalog` and import parsing, `rtl-design-steward` for visual ₪ and tokens, `tenant-security-warden` for anything that re-points `product_id` across rows.

### P0
- **catalog-01 · P0 · trust · import · both.** Import auto-links 0.6–0.9 matches **and records them as confidence-1 aliases**, so a guess becomes permanent truth for all future invoices. The done screen lists them as text with no fix. *Evidence:* `packages/api/src/catalog/commit.ts:123-134, 184-191`; `packages/catalog/src/learning.ts:67`; `apps/web/app/dashboard/catalog/import/wizard.tsx:374-395`. *Fix:* leave medium rows **unlinked** (`productId` null) and route them into the unified mapping queue with the top candidate pre-filled. Call `recordConfirmedMatch` only on a human accept, passing the real confidence. Add an in-wizard "בדיקה" step: "4 התאמות דורשות אישור" with Accept / choose another / new product. The done CTA deep-links to `/dashboard/catalog/mapping?import=<id>`. A one-off human-run script downgrades existing auto-aliases that came from `ambiguous` rows. *Exemplar:* Xero suggested matches (suggest, then the user accepts); Ottimate "Needs Attention". *Effort:* M.
- **catalog-02 · P0 · functional (money) · import · both.** `parseNumeric("1,250") → 1.25`, verified by running a copy of the function. CSV and text-cell prices of ₪1,000 or more are stored 1000× too low, and the preview shows raw strings, so nobody notices. *Evidence:* `packages/api/src/catalog/parse.ts:230-243`; `wizard.tsx:320-328`. *Fix:* treat `^\d{1,3}(,\d{3})+(\.\d+)?$` as thousands. Treat a comma as a decimal only when it is followed by 1–2 digits and there is no other separator. Otherwise mark the row "מחיר לא ברור". Add a parsed "₪ שיובא" preview column. Flag 0, negative and outlier rows (more than 5× or less than 0.2× the current list price) and block them unless the user confirms. Add unit tests for "1,250", "12,90", "1,250.00" and "₪ 2,400". *Exemplar:* Flatfile/OneSchema validation; Stripe CurrencyField. *Effort:* S.

### P1
- **catalog-03 · P1 · trust · mapping · both.** Mapping backfills `product_id` but never re-runs the match, so stale MISSING/EXTRA/price findings stay in the leak and approvals. *Evidence:* `packages/api/src/routers/mapping.ts:187-231`; `packages/matching/src/engine.ts:203, 228`; `apps/web/lib/jobKick.ts:31`. *Fix:* collect the affected `invoiceId`s from the backfill `returning` and enqueue `match-invoice` for each (no engine change). The toast reads "קושר · 6 שורות · 3 חשבוניות נבדקות מחדש · בטל". *Exemplar:* QuickBooks bank-feed rules re-apply on change. *Effort:* S.
- **catalog-04 · P1 · flow · mapping · both.** The queue is partial and silent. It skips lines without a SKU, import "ambiguous" rows and unlinked catalog items, and it has no count anywhere. *Evidence:* `mapping.ts:63, 84`; `catalog/page.tsx:47`; `nav.tsx:103`. *Fix:* one queue with three sources: SKU lines; no-SKU lines grouped by normalised raw description per supplier; import suggestions. Show a count badge on the nav "קטלוג" and on "מיפוי מק״טים · 7", plus a Needs-you row on the home: "7 פריטים לא מקושרים · ₪1,240 לא נבדקו". *Exemplar:* MarginEdge product setup queue; Ottimate Needs Attention. *Effort:* M.
- **catalog-05 · P1 · flow · mapping · both.** There is no pre-filled suggestion: each row needs a typed search. *Evidence:* `mapper.tsx:82`; `packages/catalog/src/matcher.ts:405-478`. *Fix:* the row opens with the top candidate selected and a reason line: "שם דומה 92% · אותו ספק · אותה יחידה". Use a confidence word (גבוהה/בינונית), not a raw %. Keys: `1` accept, `2` other candidates, `3` new product, `J/K` move. The only bulk action is "אשר את כל הוודאיות (12)". *Exemplar:* Linear Triage Intelligence; Xero. *Effort:* M.
- **catalog-06 · P1 · trust · mapping · both.** A row has no evidence and no ₪, and is ranked by count. *Evidence:* `mapper.tsx:110-124`; `mapping.ts:109`. *Fix:* rank by unmapped ₪ (Σ line totals) descending. Per row show unit, unit price, last date, "חשבונית INV-…" (opening a peek, D6) and "₪1,240 · 6 שורות". *Exemplar:* Ramp's missing-items queue (amount first). *Effort:* S.
- **catalog-07 · P1 · flow · mapping · both.** No escape hatches, no undo, not optimistic. *Evidence:* `mapper.tsx:58, 127`; `mapping.ts:42`. *Fix:* add "לא מוצר" (deposit, delivery fee, discount; remembered per supplier and raw name), "דלג", a supplier filter chip row, an optimistic row exit (150 ms) with the 10 s toast "קושר · בטל (Z)", and one primary per screen (the focused row). *Exemplar:* Superhuman Undo; QuickBooks "Exclude". *Effort:* M.
- **catalog-08 · P1 · ia · products · both.** `/dashboard/products` is "English names". There is no product list, and product detail is reachable only by a green link, search, or a `tabIndex=-1` 14 px icon. *Evidence:* crawl h1 "שמות באנגלית"; `products/page.tsx`; `names-grid.tsx:217-225`. *Fix:* make `/products` an item master (name, category, supplier count, latest ₪ per normalised unit, Δ 90 d, ₪ bought in 90 d, used in N recipes). Make "שמות באנגלית" a mode or tab of it. Turn the catalog into tabs: מוצרים · מחירוני ספקים · לקישור (N) · ייבוא והיסטוריה. *Exemplar:* Shopify Products index; Restaurant365 item master. *Effort:* M.
- **catalog-09 · P1 · functional · catalog · desktop.** The catalog doesn't answer "what changed / what costs me". *Evidence:* desktop-he crops 0–3; `routers/catalog.ts:107-155` (list price only). *Fix:* columns "מחיר אחרון בחשבונית", "Δ מול מחירון", "Δ 90 יום", "₪ השפעה לחודש" (volume × Δ), "עודכן" (`observedAt` + import filename from `sourceImportId`). Filter chips: עלו החודש · ללא מחיר · לא מקושר · מחירון ישן (>90 יום) · לא פעיל. *Exemplar:* xtraCHEF Price Tracker. *Effort:* M.
- **catalog-10 · P1 · flow · import · both.** The import commits blind: no diff before apply. *Evidence:* `wizard.tsx:300-350`. *Fix:* add a review step, "מה ישתנה": new items, ↑ and ↓ with ₪ and %, unchanged (collapsed), and catalog items missing from the file ("להשבית 12?"). Add the effective date and the VAT basis. The commit label names the effect: "עדכון 42 מחירים · 6 עליות (ממוצע +4.2%)". *Exemplar:* Shopify product CSV preview; xtraCHEF. *Effort:* M.
- **catalog-11 · P1 · functional · import · both.** Real price lists don't parse: header fixed to row 1, first sheet only, no PDF, photo or paste. *Evidence:* `parse.ts:125, 129`; `wizard.tsx:239`. *Fix:* auto-detect the header row (the first row with 2 or more keyword hits) with "זו שורת הכותרות" override. Add a sheet picker. Accept PDF and photo through the existing OCR pipeline as "מחירון", plus paste from clipboard. Detect the supplier from the filename or header (demo files are named "מחירון ירקות השרון 2026.xlsx"). *Exemplar:* Flatfile, OneSchema; Airtable CSV import. *Effort:* L.
- **catalog-12 · P1 · functional · import · both.** There is no undo or rollback for an import, and prices are overwritten in place. *Evidence:* `commit.ts:172-177`. *Fix:* snapshot previous values per import and add "בטל ייבוא" on the import history row, plus a 10 s Undo toast after apply. *Exemplar:* Shopify import revert; Notion page history. *Effort:* M. **humanPR: yes** (it needs a new `catalog_import_changes` table or column, which is a schema migration).
- **catalog-13 · P1 · trust · product detail · both.** "הזול ביותר" compares raw prices across units and pack sizes, while price alerts normalise. *Evidence:* `product-client.tsx:90, 240`; `priceAlerts/sweep.ts:40-55`. *Fix:* extract one shared `catalogUnitPrice()` (the API already has it) and return `unitPricePerDefaultUnit` from `productDetail`. Show a "₪ לק״ג" column, and give the badge only when the prices are comparable. Otherwise show "יחידות שונות — לא ניתן להשוות". *Exemplar:* supermarket shelf-price per kg (Israeli consumer-protection unit price); MarketMan price comparison. *Effort:* S.
- **catalog-14 · P1 · ia · product detail · both.** The page opens on an edit form, and the price is 2 screens down on a phone. *Evidence:* `dashboard_products_ID__owner__phone-he.png` crops 0–1; `product-client.tsx:97`. *Fix:* an object header: "₪9.80 לק״ג · יבשים בן-עמי · יציב 90 יום (9.75–9.85)", sparkline, contract price, ₪ bought in 90 days, used in N recipes, open alert chip. Then the price-by-supplier comparison, then history. Editing moves to an "עריכה" sheet. *Exemplar:* Shopify product page; Stripe object pages. *Effort:* M.
- **catalog-15 · P1 · functional · catalog + product detail · both.** There is no way to link a second supplier's item to an existing product, so supplier comparison can't exist (demo: 0 multi-supplier products). *Evidence:* `browser.tsx:40-45` (draft has no productId); `routers/catalog.ts:51`; `commit.ts:99-121`. *Fix:* "קשר למוצר קיים…" in the catalog row menu and "הוסף ספק חלופי" on product detail. Linking stays a human confirm, which keeps the false-leak guard. *Exemplar:* Choco and MarketMan price comparison. *Effort:* M.
- **catalog-16 · P1 · functional · product detail · desktop.** There is no merge for duplicates, and delete is a dead end. *Evidence:* `product-client.tsx:191`; `products/he.ts:55`. *Fix:* "מיזוג לתוך…" with a preview ("ימוזגו: 3 פריטי מחירון, 41 שורות חשבונית, 2 מתכונים"). One transaction re-points `product_id` and aliases, plus an audit entry. Needs `tenant-security-warden` review. *Exemplar:* Restaurant365 merge items; MarginEdge combine products. *Effort:* M.
- **catalog-17 · P1 · flow · catalog · desktop.** No bulk actions or batch bar. *Evidence:* `browser.tsx:549-586`. *Fix:* row checkboxes plus a sticky batch bar: "12 נבחרו · השבתה · קטגוריה… · ייצוא · נקה". Deactivate is optimistic with Undo. *Exemplar:* Shopify bulk actions; Polaris IndexTable. *Effort:* M.
- **catalog-18 · P1 · flow · import · both.** The ≤1,500-row commit runs inline behind a button spinner (about 4 queries per row). *Evidence:* `routers/catalog.ts:30, 265`; `commit.ts:76-192`. *Fix:* send anything over 200 rows to the job. The done step becomes a live import card with a determinate bar ("312/840 שורות") and "אפשר לעזוב — נודיע כשמוכן". *Exemplar:* Primer loading pattern; Shopify import email. *Effort:* S.
- **catalog-19 · P1 · flow · catalog · phone.** The phone catalog is an 11,759 px scroll of 215 px cards. There is no quick look and no next action. *Evidence:* crawl height; `dashboard_catalog__owner__phone-he.png`; `browser.tsx:717-793`. *Fix:* a 2-line row ("אורז יסמין · ₪9.80/ק״ג ↗" / "יבשים בן-עמי · BA-1001") at about 72 px. Tapping opens a bottom sheet with a sparkline, suppliers, Edit and "+ להזמנה". Filters collapse behind one "סינון" chip; the header actions go into "⋯". *Exemplar:* Choco and Rekki ordering apps. *Effort:* M.
- **catalog-20 · P1 · a11y · catalog · desktop.** `type="number"` for price (C7, which lists catalog price as S1). *Evidence:* `browser.tsx:412, 517, 689`. *Fix:* `type="text" inputMode="decimal" dir="ltr"`, accept "7,5" and "7.5", format on blur, ₪ adornment outside the value, 16 px on phone. *Exemplar:* `inventory/count/count-screen.tsx` (in-repo model); Stripe CurrencyField. *Effort:* S.
- **catalog-21 · P1 · copy/ia · import + contracts · both.** Two near-duplicate import wizards for one supplier file (מחירון vs חוזה). *Evidence:* `catalog/import/wizard.tsx`; `contracts/import/wizard.tsx` (412 lines, adds validFrom/validTo). *Fix:* one "ייבוא מחירון" with "אלה מחירים מוסכמים (חוזה)" plus validity dates. That decides the destination tables and keeps one parser and one review. *Exemplar:* Ottimate Contract Pricing set inside the vendor price list. *Effort:* M.
- **catalog-22 · P1 · states · import · both.** A new tenant hits dead ends: no supplier means no import (empty `<select>`) and no "add item". *Evidence:* `wizard.tsx:193-210`; `browser.tsx:267, 291`. *Fix:* inline "ספק חדש: [שם]" in the import, defaulting to the name detected from the file. "הוספת פריט" is always visible and asks for the supplier in its sheet. *Exemplar:* Stripe and Ramp setup checklists (create inline). *Effort:* S.
- **catalog-23 · P1 · a11y · catalog · phone.** axe target-size ×52 on phone: the product links (`text-xs`), the English-name button, and links outside the coarse-pointer 44 px rule. *Evidence:* `crawl-results.json` (catalog phone); `browser.tsx:746-766, 836-860`. *Fix:* make the whole compact row the target (see catalog-19). Put any inline link in a 44 px row, or move it into the sheet. *Exemplar:* Apple HIG 44 pt. *Effort:* S.

### P2
- **catalog-24 · P2 · visual · catalog · desktop.** Duplicate and low-value columns; `packSize` hidden. *Evidence:* desktop-he crops 0–3; `browser.tsx:359-365`. *Fix:* one "פריט" column (product name bold, with the supplier's raw name muted only when it differs), "אריזה" ("ארגז · 24 × 330 מ״ל"), and English hidden by default in `he` (column chooser). *Effort:* S.
- **catalog-25 · P2 · rtl · catalog · desktop.** SKUs and supplier names wrap. *Evidence:* desktop-he crop 0 ("BA-\n1001"). *Fix:* `<Token kind="sku">` = `<bdi dir="ltr" class="font-mono whitespace-nowrap">`, and the supplier column gets `min-w` with a truncation that keeps the full name in a title. *Effort:* S.
- **catalog-26 · P2 · visual · catalog · desktop.** 3 inline icon actions per row with a red trash on every row. *Evidence:* `browser.tsx:549-586`. *Fix:* click a cell to edit (price, unit). "⋯" holds השבתה / קישור למוצר / מחיקה; there is no red until the menu opens. *Exemplar:* Linear row menus; Polaris. *Effort:* S.
- **catalog-27 · P2 · functional · catalog · desktop.** No sort, no sticky header, no real count. *Evidence:* `routers/catalog.ts:153`; `browser.tsx:283-290, 357-371`. *Fix:* sortable headers as `<button>` with `aria-sort` (₪ sorts descending first), a sticky thead, "57 פריטים · 11 ספקים" from a `total` in the API. *Exemplar:* Primer DataTable. *Effort:* S.
- **catalog-28 · P2 · states · catalog · both.** A row-edit error renders as one alert above the table, and redundant success toasts appear. *Evidence:* `browser.tsx:128, 138, 294-298`. *Fix:* inline error on the row (`aria-describedby`). No toast when the row visibly updates; keep toasts only for Undo. *Effort:* S.
- **catalog-29 · P2 · flow · catalog + product · both.** Native `confirm()` for deletes. *Evidence:* `browser.tsx:350, 579`; `product-client.tsx:191`. *Fix:* make deactivate (reversible, with Undo) the default path. Delete goes through `ConfirmDialog` that names the item and the consequence ("מחיקת 'אורז יסמין' מהמחירון של יבשים בן-עמי"). *Effort:* S.
- **catalog-30 · P2 · states · catalog/products · both.** No `loading.tsx` or `error.tsx` for `/catalog*` and `/products*`. 6 server awaits come before paint. *Evidence:* `catalog/page.tsx:12-19`; `find apps/web/app/dashboard -name loading.tsx` (5 files, none here). *Fix:* layout-true skeletons (the table and card list); `error.tsx` with "טעינת הקטלוג נכשלה · נסה שוב". Stream `integrations.status` instead of awaiting it. *Effort:* S.
- **catalog-31 · P2 · ia · catalog · both.** Filters are not in the URL and are lost on Back. *Evidence:* `browser.tsx:82-86`. *Fix:* `?supplier=&q=&inactive=&sort=`, and restore scroll on Back. *Exemplar:* Stripe Dashboard filters. *Effort:* S.
- **catalog-32 · P2 · copy · catalog · both.** The h1 "חיפוש מאוחד בקטלוג" names a feature, not the place, and the header has 4 equal actions including Integrations. *Evidence:* `catalog/he.ts:6-11`; `page.tsx:38-53`. *Fix:* h1 "קטלוג" with the context line "57 פריטים · 11 ספקים · מחירון אחרון 26.08". One primary "ייבוא מחירון"; the sub-areas become tabs; Integrations moves to the ניהול nav group. *Effort:* S.
- **catalog-33 · P2 · functional · catalog · phone.** No add-to-order from the catalog, although the subtitle calls it "the basis for building orders". *Evidence:* `catalog/he.ts:7-8`; `browser.tsx` (no order action). *Fix:* "+ להזמנה" stepper adds to that supplier's draft PO (orders router), and a sticky "טיוטה: 4 פריטים · ₪312 · המשך" chip. *Exemplar:* Choco, Rekki, Sysco Shop. *Effort:* M.
- **catalog-34 · P2 · functional · catalog · both.** Search has no Hebrew normalisation and no barcode. *Evidence:* `routers/catalog.ts:124-128`. *Fix:* a shared `normalizeHe()` (״/", final letters, wrong layout, niqqud) on both sides, and a phone barcode button (BarcodeDetector → `barcodeEan`). *Exemplar:* Raycast/Linear fuzzy search; R365 barcode add. *Effort:* M.
- **catalog-35 · P2 · flow · import · both.** Wizard overhead: a separate supplier step, Continue disabled with no reason, non-interactive step chips, `size="sm"` buttons, a raw `ArrowRight` flip, a 10 px badge, and "ייבוא נוסף" resetting to step 1. *Evidence:* `wizard.tsx:65, 159-167, 176-210, 310`. *Fix:* one page: drop zone first, with the supplier inferred or picked inline. Submit is never disabled for invalidity; it shows the reason. `<DirIcon kind="forward">`; 12 px caption badge; "ייבוא נוסף לאותו ספק". *Effort:* S.
- **catalog-36 · P2 · functional · import · both.** Column mapping happens in 6 separate selects, far from the data, and invalid rows aren't flagged. *Evidence:* `wizard.tsx:280-330`. *Fix:* column-first mapping: each preview column header holds a field dropdown plus 3 sample values. Flagged rows show reasons ("אין מחיר", "מחיר לא ברור"), with "דלג על 3 שורות לא תקינות". *Exemplar:* Flatfile. *Effort:* M.
- **catalog-37 · P2 · functional · import · both.** The wizard never asks the price list's VAT basis or effective date. *Evidence:* `wizard.tsx` (no field); `MappingSchema` (`routers/catalog.ts:65-74`). *Fix:* a required toggle "המחירים: לא כולל מע״מ / כולל מע״מ", pre-set when a header says "כולל מע״מ", converting to ex-VAT at import with the engine's VAT rate (read only, never redefined), plus "בתוקף מ-". Store the choice in `catalog_imports.column_mapping` (jsonb, no schema change). *Effort:* S.
- **catalog-38 · P2 · flow · import · desktop.** A chain owner imports the same list once per branch. *Evidence:* `routers/chain.ts:606-624` (copy only at branch creation). *Fix:* "להחיל גם על: ☑ חיפה ☑ ירושלים" when the same supplier exists in sibling branches (matched by supplier tax id/name), with a per-branch diff summary. *Exemplar:* R365 multi-location item updates. *Effort:* M.
- **catalog-39 · P2 · functional · products · desktop.** No machine-suggested English names, so 300 products mean 300 typed translations. *Evidence:* `names-grid.tsx`; `packages/api/src/receiving/localize.ts` (glossary and cache exist). *Fix:* "הצע תרגום ל-N מוצרים חסרים" fills dirty cells with suggestions, marked "הצעה", and nothing saves without Ctrl+S. *Exemplar:* Shopify Translate & Adapt. *Effort:* S.
- **catalog-40 · P2 · a11y · products · desktop.** Ctrl+S is bound to `e.key`, which fails on the Hebrew layout. Unsaved edits are lost on in-app navigation. *Evidence:* `names-grid.tsx:107, 116`. *Fix:* `e.code === 'KeyS'`. Intercept Next link navigation while dirty with a ConfirmDialog ("יש 4 שינויים שלא נשמרו · שמור / צא בלי לשמור"). *Effort:* S.
- **catalog-41 · P2 · a11y · products · both.** The link to the product is a 14 px icon with `tabIndex=-1`. *Evidence:* `names-grid.tsx:217-225`. *Fix:* make the Hebrew name itself the link (keyboard reachable). The input keeps its label through `aria-labelledby`. *Effort:* S.
- **catalog-42 · P2 · visual · products · phone.** The sticky save bar is always visible with disabled buttons. *Evidence:* `names-grid.tsx:284-292`; phone shot. *Fix:* show the bar only when dirty: "4 שינויים · שמירה" (primary), with discard in "⋯". *Effort:* S.
- **catalog-43 · P2 · functional · product detail · both.** The price history is a raw 24-row table with no unit, Δ, chart or invoice link. *Evidence:* `product-client.tsx:261-298`; `routers/catalog.ts:214`. *Fix:* a line chart (left = oldest, R-3) per supplier with a table toggle; the header "מחיר ל-ק״ג"; a Δ column; each point links to its invoice (peek). *Exemplar:* xtraCHEF item price history; Stripe sparkline. *Effort:* M.
- **catalog-44 · P2 · functional · product detail · both.** Category and unit are free text, and "ספק בלעדי" is jargon. *Evidence:* `product-client.tsx:132-160`; `products/he.ts:45-47`. *Fix:* a combobox of existing categories plus "חדשה…"; a canonical unit list (the same one `UnitText` uses). Rename to "שייך לספק" with the hint "המערכת לא תקשר אוטומטית מוצר זה לספקים אחרים". *Effort:* S.
- **catalog-45 · P2 · flow · product detail · both.** Delete sits beside Save, and "no changes" shows as a danger alert. *Evidence:* `product-client.tsx:83, 182-196`. *Fix:* delete and merge go in "⋯". Save is a no-op (or a quiet hint) when nothing changed. *Effort:* S.
- **catalog-46 · P2 · ia · product detail · both.** The chef can't see ingredient prices, and recipes don't link to products. *Evidence:* `apps/web/lib/roles.ts:66-69`. *Fix:* a read-only product view for the chef (price, trend, suppliers; no edit or cost of other modules), linked from recipe ingredient rows. `catalog.productDetail` is already `memberProcedure`. *Effort:* S.
- **catalog-47 · P2 · trust · catalog · desktop.** A list price has no provenance ("who or what set ₪9.80, when?"). *Evidence:* `schema.ts:654-657` (`sourceImportId`, `observedAt` exist, unused in UI). *Fix:* the "עודכן" cell reads "26.08 · מחירון ירקות השרון 2026.xlsx" or "ידני · דנה · 14.10", with a hover/peek history. *Exemplar:* Brex/BILL audit trail. *Effort:* S.
- **catalog-48 · P2 · visual · all · both.** Money is set in mono, and Hebrew table headers carry `uppercase tracking-wide`. *Evidence:* `browser.tsx:358, 514, 744`; `product-client.tsx:208, 236, 273, 290`; `names-grid.tsx:198`. *Fix:* `<Money>` (Heebo tabular) for ₪; `ltr:uppercase ltr:tracking-wide` only. *Effort:* S.
- **catalog-49 · P2 · states · mapping · both.** Inbox-zero doesn't say what was handled automatically, and the supplier name is a Badge (non-status chip). *Evidence:* `mapper.tsx:110-114`; mapping desktop-he shot. *Fix:* "הכל מקושר ✓ · 112 מק״טים · 56 נלמדו אוטומטית החודש · הייבוא הבא: …". The supplier is plain text. *Effort:* S.
- **catalog-50 · P2 · trust · import · both.** The ambiguous list shows a % confidence that comes from the lexical "mock-bigram" embedder (`MockEmbeddingProvider` in all prod paths), with false precision. *Evidence:* `routers/catalog.ts:75`; `apps/worker/src/jobs/importCatalog.ts:16`; `packages/catalog/src/embeddings.ts:13-14`. *Fix:* show the confidence word and the basis ("שם דומה · אותו ספק") instead of "78%". Track the switch to a real embedder as an engineering follow-up. *Effort:* S.

### P3
- **catalog-51 · P3 · rtl · catalog · phone.** The invisible pencil (`opacity-0`) mis-indents English names in cards. *Evidence:* `browser.tsx:848`; phone crops. *Fix:* render the icon only on hover or focus (`hidden group-hover:inline`). *Effort:* S.
- **catalog-52 · P3 · copy · products · both.** English mode shows Hebrew categories and units; the "allDone" message has an emoji 🎉. *Evidence:* `dashboard_products__owner__desktop-en.png`; `products/he.ts:29`. *Fix:* translate the category via the glossary and render units via `UnitText` in `en`. Use the calm T3 copy "לכל 57 המוצרים יש שם באנגלית ✓". *Effort:* S.

---

## 5. Big moves (benchmark-grade)

### BM-1 · "Price-list inbox": every supplier file becomes a reviewed diff
**Why.** A new price list is the cheapest moment to catch a leak: the price went up *before* any invoice arrives. Today it is applied blind and overwrites history (catalog-01/02/10/11/12/21/37/38).
**What.**
- **Any channel:** drop, paste, forward by email or WhatsApp, PDF, photo or xlsx. The supplier is auto-detected from the filename, header or tax id; the header row and sheet are auto-detected.
- **One review screen**, "מה ישתנה ב-מחירון ירקות השרון":
  - ↑ 6 (ממוצע +4.2% · ≈ ₪380 לחודש בכמויות שלכם)
  - ↓ 2 · 4 new · 3 missing ("להשבית?") · 1 unclear price
  - 4 links to approve
- **Per-row actions:** accept, change, or skip.
- **Toggles:** "מחירים מוסכמים (חוזה)" with validity, VAT basis, and "להחיל גם על סניפי חיפה/ירושלים".
- **Apply:** "עדכון 42 מחירים" with a 10 s Undo, then a history row with "בטל ייבוא".
- **Feeds alerts:** the ↑ rows create price alerts immediately, with the ₪-per-month impact.

**Device:** both (review on desktop; a phone can forward a photo of the list and approve the summary). **Exemplar:** Flatfile import review; Shopify CSV preview; xtraCHEF Price Tracker; Ottimate Contract Pricing; Choco/Rekki supplier price updates. **Effort:** L (the snapshot table is a human PR).

### BM-2 · "לקשר" triage queue: AP-grade mapping with suggestions, ₪ ranking and keyboard
**Why.** Unmapped lines are invisible to contract, price-history and three-way checks. The queue today is partial, silent and typed by hand (catalog-03…07, 49, 50).
**What.**
- **One queue, three sources:** SKU lines, no-SKU lines and import suggestions.
- **Ranked by unmapped ₪.**
- **Desktop split view:**
  - The start pane shows the evidence: an invoice-line crop, raw name, unit, unit price, date and supplier.
  - The end pane shows candidates, the top one pre-selected with "למה: שם דומה · אותו ספק · אותה יחידה · מחיר קרוב (9.80 מול 9.75)".
- **Keys:** `1` accept · `2` other · `3` new product · `4` לא מוצר · `J/K` move · `Z` undo.
- **Bulk:** "אשר 12 ודאיות".
- **Optimistic:** rows exit optimistically; each accept re-runs the match and the toast says "₪ הדליפה עודכנה".
- **Phone:** one card at a time with full-width "זה המוצר" / "מוצר אחר" buttons.
- **Visibility:** a nav and Needs-you badge, "7 לקישור · ₪1,240".

**Device:** both. **Exemplar:** Linear Triage (+ Triage Intelligence "why"); Superhuman auto-advance + Undo; Xero suggested matches; MarginEdge product setup. **Effort:** M.

### BM-3 · Item master + product "object page" with a normalised supplier compare
**Why.** The owner and the chain owner think in products, not supplier rows. There is no product list, the product page is a form, and "cheapest" is computed wrong (catalog-08, 13–16, 43–46).
**What.**
- **Products index** at `/products`, with saved views (עלו החודש · הכי הרבה ₪ · בלי ספק חלופי · כפולים חשודים). Columns:
  - category
  - suppliers
  - latest ₪ per normalised unit
  - Δ 90 d
  - ₪ bought in 90 d
  - recipes
  - open alert
- **Product object page:**
  - **Header:** ₪/unit, trend sparkline, contract vs actual, ₪ in 90 d, used in N dishes (food-cost impact of +₪1/ק״ג).
  - **Compare table:** supplier × normalised ₪/unit × last delivery × reliability, with "הוסף ספק חלופי".
  - **Price chart:** per supplier (left = oldest).
  - **Merge duplicates:** "מיזוג לתוך…" with a preview of what moves.
  - **Edit:** in a sheet.
  - **Chef:** a read-only view.

**Device:** desktop first (bosses); the phone gets the header and compare as a sheet. **Exemplar:** Restaurant365 item master; Shopify product admin; MarketMan/Choco price comparison; Stripe object pages. **Effort:** M–L.

### BM-4 · Phone "price check & quick order": search-first, thumb-first catalog
**Why.** Most catalog use on the floor is "how much is X / who has it / order it". Today that is an 11,759 px scroll with no next action (catalog-19, 23, 33, 34).
**What.**
- **Search:** a pinned search bar (Hebrew-normalised, with a barcode button) at the top of the phone catalog. Filters sit behind one chip.
- **Rows:** 72 px, "אורז יסמין · ₪9.80/ק״ג ↗3%" / "יבשים בן-עמי · BA-1001".
- **Sheet:** tap opens an 85vh bottom sheet with sparkline, suppliers compared, last order qty, and a 56 px "+ להזמנה" stepper.
- **Draft chip:** a sticky draft chip, "טיוטה ליבשים בן-עמי · 4 פריטים · ₪312 · המשך", hands off to `orders/new` at Review.
- **Recently ordered:** "הוזמן לאחרונה" sits above search results.

**Device:** mobile. **Exemplar:** Choco app; Rekki; Sysco Shop (order guides with last qty); Shopify POS product search. **Effort:** M.

### BM-5 · Catalog health strip + guided data-quality fixes
**Why.** The catalog's job is to make the ₪ engine trustworthy, but it never says how healthy it is (catalog-09, 22, 39, 47).
**What.**
- **Health strip:** a one-line strip under the h1, where each item is a filter that opens a focused fix flow:
  - "מחירונים ישנים: 3 ספקים (>90 יום)"
  - "לקישור: 7 · ₪1,240"
  - "בלי מחיר: 4"
  - "כפולים חשודים: 2"
  - "בלי שם באנגלית: 12"
- **Fix flows:**
  - "בקש מחירון מעודכן" drafts the supplier message.
  - Duplicates open the merge preview.
  - English names open with machine suggestions.
- **Inbox-zero:** when everything is clean, a calm T3 line: "הקטלוג תקין ✓ · עודכן לפני 3 ימים".

**Device:** both. **Exemplar:** Shopify admin setup guide; Stripe/Ramp data-quality checklists; Linear inbox-zero. **Effort:** S–M.

---

## 6. Governance notes
- Nothing here edits the immutable list. catalog-03 only **enqueues** the existing `match-invoice` job; the engine is untouched. catalog-37 reads the engine VAT rate and never redefines it.
- **Human PR required:** catalog-12 / BM-1 undo snapshots need a new table or column (schema migration). Any change to `products.supplier_id` exclusivity semantics would be a proposal to `matching-engine-guardian`. The cross-supplier link stays a human confirm, so the false-leak guard is preserved.
- **Needs `tenant-security-warden` review (not immutable):** product merge (catalog-16) and the cross-supplier link (catalog-15), because they re-point `product_id` across many tenant tables. Add their tRPC procedures to the cross-tenant COVERAGE manifest (add an entry; never weaken one).
- **Fix owners:**
  - `ocr-procurement-engineer`: catalog-01, 02, 11, 18, 50 (`packages/catalog`, `packages/api/src/catalog`).
  - `web-feature-engineer`: UI and routers.
  - `rtl-design-steward`: catalog-25, 48 (₪ rendering, tracking).
  - `money-format-marshal`: `<Money>` wrapper only.
