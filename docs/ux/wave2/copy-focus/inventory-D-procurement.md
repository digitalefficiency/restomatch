# Copy focus · D-procurement: orders, suppliers, contracts, catalog, products, supplier portal

**Owner request (31.10):** focus the in-app texts. **Clarification:** explanations stay where they are, made efficient (no help centre, no glossary).
**Source of truth:** `rw-release` @ `b5b27bcd` (read-only; line numbers are the he.ts key line from that tree). **Lab:** `http://localhost:3351` (build ab9908c4), tenant "כפר הזיתים", locale he, captured 31.10.2026.
**Inventory:** `docs/ux/wave2/copy-focus/inventory-D-procurement.json` (215 strings). Scripts, innerText dumps and metrics: `docs/ux/wave2/copy-focus/work-D-procurement/`.

## Summary

| | |
|---|---|
| Explanatory strings inventoried | **215** (orders 69 · catalog 41 · suppliers 30 · contracts 29 · supplierConfirm 17 · products 13 · server (packages/api) 8 · ingest 8) |
| Verdicts | SHORTEN 103 · KEEP 59 · MERGE 23 · CUT 22 · FOLD 8 |
| Words in those strings (catalog + server) | 1906 → **1016** (890 removed, 47%) |
| …of which actually render today | 1790 → **1016** (−774); 13 strings never render (7 dead keys, 6 server messages the UI replaces or never maps) |
| Pilot-critical (ציקטי week 1: orders record-only + capture, suppliers setup, schedule, catalog/contract import) | 129 strings, 1088 → 617 words (−471) |
| Lab captures | 57 screens × role × viewport + 18 with explanation holders open = 75 JPEGs; **15,571** visible words, **1,916** explanatory; ≈**14,307** after (−1,264) |

How the numbers were made:
- **Visible words** = letter-led Hebrew/Latin tokens in `document.body.innerText` (numbers, ₪ and % excluded), the same regex as A/B/C. innerText also carries sr-only text, the shell nav and every `<option>` of a closed `<select>` (supplier pickers add ~11 words; the import mapping selects add ~30).
- **Explanatory words** = words of the inventoried strings found in that text (templates matched with placeholders; identical texts counted once). Labels, buttons, statuses and data are not counted.
- **Est. after** = visible − (explanatory now − explanatory after), per verdict: CUT = 0; SHORTEN/MERGE = the proposal; FOLD = the visible line + the toggle label ("למה?" = 1 word); KEEP = unchanged.
- **Lab noise in every dashboard shot:** the worker banner "מנוע העיבוד לא זמין כרגע…" (16 words; shell copy, the lab worker is down). Counted as visible, not as explanatory, not D-procurement copy.
- **Read-only lab run.** Every non-GET request was aborted in the browser except the two read-only file previews (`catalog.parsePreview`, `contracts.importPreview`), so no draft, order, link, answer or edit was written. The supplier portal used the live link minted by the lab seed (`gate/runs/lab-w1/seed.log`; the token is not printed anywhere).
- ¹ The review step shows "שומר את הטיוטה…" + "אין חיבור לשרת…" (9 words) because `orders.createDraft` was blocked on purpose. ² The lab offered no cancel item for sent orders (a receipt exists), so the cancel dialog strings were inventoried from source only.
- **Chef:** in the release `/dashboard/orders*` is owner + manager only (`lib/nav/routes/orders.ts`); the lab answers 403 for the chef. The chef gets the orders strings (with ₪, owner 31.10) when W1-11's chef ordering lands; nothing here adds ₪ for any other chef/receiver screen.

## (a) Per screen

| screen | role | viewport | visible words | explanatory words | est. words after | screenshot |
|---|---|---|---:|---:|---:|---|
| /dashboard/orders · list | owner | 1440×900 | 386 | 16 | 375 (-11) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders--owner--desktop.jpg` |
| /dashboard/orders · list | manager | 390×844 | 521 | 16 | 510 (-11) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders--manager--phone.jpg` |
| /dashboard/orders · list (HTTP 403, shared "forbidden" page) | chef | 390×844 | 67 | 0 | 67 (+0) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders--chef--phone.jpg` |
| new order · step 1 (supplier) | owner | 1440×900 | 126 | 7 | 119 (-7) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new--owner--desktop.jpg` |
| new order · step 1 (supplier) | manager | 390×844 | 65 | 7 | 58 (-7) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new--manager--phone.jpg` |
| new order · step 1 (supplier) (HTTP 403, shared "forbidden" page) | chef | 390×844 | 63 | 0 | 63 (+0) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new--chef--phone.jpg` |
| new order · step 2 (items), ירקות השרון | owner | 1440×900 | 159 | 19 | 140 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new-build--owner--desktop.jpg` |
| new order · step 2 with 3 items added | owner | 1440×900 | 195 | 23 | 175 (-20) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new-build-open--owner--desktop.jpg` |
| new order · step 2 (items), ירקות השרון | manager | 390×844 | 98 | 19 | 79 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new-build--manager--phone.jpg` |
| new order · step 2 with 3 items added | manager | 390×844 | 134 | 23 | 114 (-20) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new-build-open--manager--phone.jpg` |
| new order · step 3 review ¹ | owner | 1440×900 | 159 | 11 | 152 (-7) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new-review--owner--desktop.jpg` |
| new order · step 3 review ¹ | manager | 390×844 | 98 | 11 | 91 (-7) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-new-review--manager--phone.jpg` |
| order from WhatsApp (/orders/capture) | owner | 1440×900 | 118 | 26 | 103 (-15) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-capture--owner--desktop.jpg` |
| order from WhatsApp (/orders/capture) | manager | 390×844 | 57 | 26 | 42 (-15) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-capture--manager--phone.jpg` |
| order detail #098B0EE5 (sent, supplier answered) | owner | 1440×900 | 226 | 47 | 200 (-26) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail--owner--desktop.jpg` |
| order detail #098B0EE5 + supplier document preview open | owner | 1440×900 | 309 | 58 | 276 (-33) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail-open--owner--desktop.jpg` |
| order detail #098B0EE5 (sent, supplier answered) | manager | 390×844 | 167 | 47 | 141 (-26) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail--manager--phone.jpg` |
| order detail #098B0EE5 + supplier document preview open | manager | 390×844 | 250 | 58 | 217 (-33) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail-open--manager--phone.jpg` |
| order detail #098B0EE5 (sent, supplier answered) (HTTP 403, shared "forbidden" page) | chef | 390×844 | 67 | 0 | 67 (+0) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail--chef--phone.jpg` |
| order detail #183452BA (closed) | owner | 1440×900 | 183 | 48 | 150 (-33) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail-closed--owner--desktop.jpg` |
| suppliers · manage | owner | 1440×900 | 263 | 12 | 251 (-12) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers--owner--desktop.jpg` |
| suppliers · manage + new-supplier form open | owner | 1440×900 | 321 | 51 | 279 (-42) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers-open--owner--desktop.jpg` |
| suppliers · manage | manager | 390×844 | 209 | 12 | 197 (-12) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers--manager--phone.jpg` |
| suppliers · manage + new-supplier form open | manager | 390×844 | 267 | 51 | 225 (-42) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers-open--manager--phone.jpg` |
| suppliers · scores | owner | 1440×900 | 211 | 12 | 199 (-12) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers-scores--owner--desktop.jpg` |
| supplier ירקות השרון · details tab | owner | 1440×900 | 167 | 44 | 135 (-32) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-details--owner--desktop.jpg` |
| supplier ירקות השרון · details tab | manager | 390×844 | 112 | 44 | 80 (-32) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-details--manager--phone.jpg` |
| supplier · catalog tab | owner | 1440×900 | 207 | 5 | 205 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-catalog--owner--desktop.jpg` |
| supplier · order-schedule tab (empty) | owner | 1440×900 | 131 | 22 | 119 (-12) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-schedule--owner--desktop.jpg` |
| supplier · order-schedule editor open | owner | 1440×900 | 148 | 15 | 146 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-schedule-open--owner--desktop.jpg` |
| supplier · order-schedule tab (empty) | manager | 390×844 | 76 | 22 | 64 (-12) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-schedule--manager--phone.jpg` |
| supplier · order-schedule editor open | manager | 390×844 | 93 | 15 | 91 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-schedule-open--manager--phone.jpg` |
| supplier · orders tab | owner | 1440×900 | 263 | 5 | 261 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-orders--owner--desktop.jpg` |
| order detail #EAF6FB87 (sent) ² | owner | 1440×900 | 195 | 40 | 170 (-25) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail-cancel--owner--desktop.jpg` |
| order detail #EAF6FB87 (sent) ² | manager | 390×844 | 136 | 40 | 111 (-25) | `docs/ux/wave2/copy-focus/shots/D-procurement--order-detail-cancel--manager--phone.jpg` |
| supplier · leak tab | owner | 1440×900 | 212 | 9 | 210 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-leak--owner--desktop.jpg` |
| supplier · leak tab | manager | 390×844 | 157 | 9 | 155 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-leak--manager--phone.jpg` |
| supplier · ledger tab | owner | 1440×900 | 257 | 19 | 243 (-14) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-ledger--owner--desktop.jpg` |
| supplier · contract tab (empty) | owner | 1440×900 | 130 | 19 | 121 (-9) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-contract--owner--desktop.jpg` |
| supplier · print card (/leak-card) | owner | 1440×900 | 225 | 18 | 223 (-2) | `docs/ux/wave2/copy-focus/shots/D-procurement--supplier-leak-card--owner--desktop.jpg` |
| supplier ledger grid (/suppliers/ledger) | owner | 1440×900 | 233 | 32 | 217 (-16) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers-ledger--owner--desktop.jpg` |
| supplier ledger grid (/suppliers/ledger) | bookkeeper | 1440×900 | 210 | 32 | 194 (-16) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers-ledger--bookkeeper--desktop.jpg` |
| supplier ledger grid (/suppliers/ledger) | manager | 390×844 | 178 | 32 | 162 (-16) | `docs/ux/wave2/copy-focus/shots/D-procurement--suppliers-ledger--manager--phone.jpg` |
| contracts · contract prices + over-contract | owner | 1440×900 | 318 | 24 | 300 (-18) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts--owner--desktop.jpg` |
| contracts · add-price form open | owner | 1440×900 | 373 | 34 | 355 (-18) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-open--owner--desktop.jpg` |
| contracts · contract prices + over-contract | manager | 390×844 | 263 | 24 | 245 (-18) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts--manager--phone.jpg` |
| contracts · add-price form open | manager | 390×844 | 318 | 34 | 300 (-18) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-open--manager--phone.jpg` |
| contracts · contract prices + over-contract | bookkeeper | 1440×900 | 295 | 31 | 272 (-23) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts--bookkeeper--desktop.jpg` |
| contracts · price alerts | owner | 1440×900 | 128 | 17 | 114 (-14) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-alerts--owner--desktop.jpg` |
| contracts · price alerts | manager | 390×844 | 73 | 17 | 59 (-14) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-alerts--manager--phone.jpg` |
| contracts · thresholds | owner | 1440×900 | 192 | 43 | 161 (-31) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-thresholds--owner--desktop.jpg` |
| contract import · step 1 | owner | 1440×900 | 148 | 17 | 139 (-9) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-import--owner--desktop.jpg` |
| contract import · mapping (3-row CSV) | owner | 1440×900 | 197 | 30 | 187 (-10) | `docs/ux/wave2/copy-focus/shots/D-procurement--contracts-import-open--owner--desktop.jpg` |
| catalog browser | owner | 1440×900 | 673 | 24 | 654 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog--owner--desktop.jpg` |
| catalog browser | manager | 390×844 | 958 | 24 | 939 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog--manager--phone.jpg` |
| price-list import · step 1 | owner | 1440×900 | 143 | 14 | 135 (-8) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-import--owner--desktop.jpg` |
| price-list import · mapping + price check (3-row CSV) | owner | 1440×900 | 210 | 52 | 188 (-22) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-import-open--owner--desktop.jpg` |
| price-list import · step 1 | manager | 390×844 | 87 | 14 | 79 (-8) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-import--manager--phone.jpg` |
| price-list import · mapping + price check (3-row CSV) | manager | 390×844 | 152 | 52 | 130 (-22) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-import-open--manager--phone.jpg` |
| SKU mapping (empty queue) | owner | 1440×900 | 119 | 27 | 98 (-21) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-mapping--owner--desktop.jpg` |
| English names grid (/products) | owner | 1440×900 | 448 | 26 | 429 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--products--owner--desktop.jpg` |
| English names grid (/products) | manager | 390×844 | 437 | 26 | 418 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--products--manager--phone.jpg` |
| product עגבניות | owner | 1440×900 | 202 | 41 | 165 (-37) | `docs/ux/wave2/copy-focus/shots/D-procurement--product-detail--owner--desktop.jpg` |
| product עגבניות + delete confirm open | owner | 1440×900 | 215 | 47 | 178 (-37) | `docs/ux/wave2/copy-focus/shots/D-procurement--product-detail-open--owner--desktop.jpg` |
| product עגבניות | manager | 390×844 | 141 | 41 | 104 (-37) | `docs/ux/wave2/copy-focus/shots/D-procurement--product-detail--manager--phone.jpg` |
| product עגבניות + delete confirm open | manager | 390×844 | 154 | 47 | 117 (-37) | `docs/ux/wave2/copy-focus/shots/D-procurement--product-detail-open--manager--phone.jpg` |
| supplier portal /s/<token> | supplier | 390×844 | 184 | 22 | 171 (-13) | `docs/ux/wave2/copy-focus/shots/D-procurement--portal--supplier--phone.jpg` |
| supplier portal · one "אין במלאי" tapped | supplier | 390×844 | 190 | 22 | 177 (-13) | `docs/ux/wave2/copy-focus/shots/D-procurement--portal-open--supplier--phone.jpg` |
| supplier portal /s/<token> | supplier | 1440×900 | 184 | 22 | 171 (-13) | `docs/ux/wave2/copy-focus/shots/D-procurement--portal--supplier--desktop.jpg` |
| supplier portal · one "אין במלאי" tapped | supplier | 1440×900 | 190 | 22 | 177 (-13) | `docs/ux/wave2/copy-focus/shots/D-procurement--portal-open--supplier--desktop.jpg` |
| supplier portal · invalid link (404) | supplier | 390×844 | 29 | 15 | 18 (-11) | `docs/ux/wave2/copy-focus/shots/D-procurement--portal-invalid--supplier--phone.jpg` |
| orders list · filter "טיוטות" (empty state) | owner | 1440×900 | 125 | 23 | 107 (-18) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-filter-empty--owner--desktop.jpg` |
| orders list · search with no result | manager | 390×844 | 72 | 28 | 53 (-19) | `docs/ux/wave2/copy-focus/shots/D-procurement--orders-search-none--manager--phone.jpg` |
| catalog browser · supplier picked | owner | 1440×900 | 251 | 17 | 234 (-17) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-add--owner--desktop.jpg` |
| catalog browser · add-item row open | owner | 1440×900 | 253 | 17 | 236 (-17) | `docs/ux/wave2/copy-focus/shots/D-procurement--catalog-add-open--owner--desktop.jpg` |

Reading the table:
- **Orders (pilot path) is already lean on the list;** the weight sits in the wizard: step 2 opens with 19 explanatory words (subtitle on every step + browse hint + empty-order body) and keeps 23 once items are in (no-schedule line); 0 and 3 after. The order page carries the document card + supplier-confirmation card: 58 explanatory words with both open, 25 after (both cards are flag-off for ציקטי in week 1).
- **Supplier setup screens** carry the longest field hints: English-name label+hint (17 words) and the delivery-time hint (22 words incl. heading, uses "יעד"). 44 → 12 explanatory words on the details tab.
- **Product and names pages** open with 15- and 26-word subtitles; folding/sharing the English-name idea takes product detail from 41 to 4 explanatory words.
- **Catalog browser and names grid** are big because they are data (673/958 and 448 words of rows); their explanatory share is small.

## (b) Repetition: concepts explained in more than one place

| Concept | Where it is explained today (key · screen) | Proposal |
|---|---|---|
| **concept.threeWayMatch** — every invoice is checked against the order | `orders.subtitle` (orders list) · `ingest.orderCapture.subtitle` (capture) · `ingest.orderCapture.confirmed` · `orders.wizard.markedBody` (sent step) · `suppliers.ordersTab.emptyBody` · `suppliers.catalogTab.emptyBody` · `catalog.subtitle` · `products.subtitle` ("מזין את מנוע ההצלבה") · `suppliers.leakCard.cleanBody` · `suppliers.leakCard.printFooter` · outside D: C-receiving | One shared `explain.threeWayMatch` = «כל חשבונית נבדקת מול ההזמנה ומול מה שהתקבל. בלי הזמנה אין מול מה לבדוק.», folded behind «למה?» on the orders list and capture. Cut from catalog/product/supplier-tab copy; the capture "confirmed" toast and the record-only success line keep a 4-word result. |
| **concept.recordOnly** — "ללא שליחה": recorded, the supplier gets nothing (the week-1 default) | `orders.send.cta.none` (button) · `orders.detail.channels.none` = `orders.wizard.channelNone` (identical) · `orders.wizard.markedBody` · `ingest.orderCapture.draftHint` · `orders.detail.notifyNone` · dead `orders.detail.cancelSentWarning` | One vocabulary: option «ללא שליחה · רישום בלבד» (one key), button «סמנו כנשלחה · בלי הודעה לספק», result «לא נשלח דבר לספק. החשבונית תיבדק מול ההזמנה.» Delete the dead key. |
| **concept.englishName** — English names are display-only; matching stays on the Hebrew name | `suppliers.form.nameEn` (label "(לצוות שלא קורא עברית)") + `suppliers.form.nameEnHint` (same field) · `products.form.nameEnHint` · `products.names.subtitle` (26 words) · `products.subtitle` · `products.form.name` ("קנוני") | One `explain.englishName` = «מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.», folded «למה?» next to each English-name field and on the names grid header. Labels become «שם באנגלית» / «שם המוצר בעברית». |
| **concept.poUnchanged** — the supplier's answer does not change the order | `supplierConfirm.portal.subtitle` (supplier sees it) · `supplierConfirm.card.subtitle` · `supplierConfirm.card.poUnchanged` | Said once, where the answer is shown: `card.poUnchanged` «ההזמנה לא שונתה — בדקו את ההבדלים.» Portal and card subtitles drop it. |
| **concept.linkValidity** — the 72 h supplier link | `supplierConfirm.card.subtitle` "(תקף 72 שעות)" · server `SUPPLIER_CONFIRM_DOC_PREVIEW_HE` "(תקף 72 שעות)" · `card.linkExpires` · `portal.expires` · `portal.errors.expired` · `portal.inactiveBody` | Show the date (linkExpires / portal.expires) and nothing else; both dead-link pages end with the same action «בקשו מהמסעדה קישור חדש.» |
| **concept.fileLimits / import errors** — file types, size, row limits, unreadable files | `catalog.import.formats` + `dropHint` + `choose` + `tooBig` + `unsupportedType` + `errors.*` · `contracts.import.formats` + `dropHint` + `tooBig` + `unsupportedType` + `errors.*` · `orders.import.badFile`. `errors.TOO_LARGE/LEGACY_XLS/UNREADABLE/EMPTY` are **word-for-word identical** in both namespaces; "too big" exists in 3 wordings, row limits differ (5,000 vs 20,000) | One set of file errors (canonical `catalog.import.errors.*`, contracts reads it), each ≤8 words; one limits line per wizard («Excel או CSV, גם בעברית · עד 9MB»; contracts adds «ו-5,000 שורות»). |
| **concept.importMapping** — map the columns | `contracts.import.mapRequired` = `contracts.import.errors.MAPPING` (identical) · `catalog.import.mapNameRequired` = `catalog.import.errors.MAPPING_NAME` (identical) · `catalog.import.rowsDetected` ≈ `contracts.import.rowsDetected` · `catalog.import.errors.FLAGGED_PRICES` ≈ `check.flaggedSummary` + `check.confirmFlaggedRequired` | Merge each identical pair into one key; one «זוהו {count} שורות. בדקו את העמודות:» for both wizards; FLAGGED_PRICES reuses the checkbox's required line. |
| **concept.noPriceList** — the supplier has no price list | `orders.wizard.catalogEmpty` · `suppliers.catalogTab.emptyTitle` + `emptyBody` · `catalog.browser.emptyBody` · `catalog.history.empty` | Same line everywhere: «אין מחירון לספק הזה» + the import button. |
| **concept.noSuppliers** | `orders.wizard.noSuppliers` · `ingest.orderCapture.noSuppliers` · `catalog.import.noSuppliers` · `suppliers.manager.emptyBody` | «עוד אין ספקים פעילים.» + the add button (the import wizard keeps its inline field). |
| **concept.readOnly** | `contracts.readOnly` = `products.names.readOnly` (identical) · `products.form.readOnly` | One «צפייה בלבד». |
| **concept.unpricedExcluded** — total excludes unpriced lines | `orders.detail.totalExcludes(One)` = `orders.wizard.totalExcludes(One)` (identical) = `supplierConfirm.portal.unpricedOne/Many` (identical) · server document "שורות ללא מחיר אינן כלולות בסה״כ." | Wizard reads the order-page key; the public portal keeps its own copy (separate bundle), allowlisted. |
| **concept.overContract** — billed above the contract price | `contracts.subtitle` · `contracts.list.emptyBody` · `contracts.over.subtitle` · `contracts.over.emptyBody` · `contracts.order.overContract` · server document basis note · `contracts.over.leaksBody` (inventory-A) | The value is said once, in the empty state («כל חיוב מעל מחיר החוזה יסומן בחשבונית.»); the panel keeps only its rule («לפי החוזה שהיה בתוקף ביום החשבונית.»). |
| **concept.creep / usualPrice / p90** — a price above the supplier's usual | `suppliers.detail.leakLabel` "שולם מעל המחיר החציוני (30 יום)" (supplier header, every tab) · `orders.wizard.aboveMedian` · `orders.wizard.aboveP90` · `contracts.subtitle` "מטפס" · `suppliers.scores.avgPriceDelta` / `leakCard.priceDelta` "סטיית מחיר ממוצעת" · outside D: A `overview.leaks.subtitle`, C `dockPrice.*`, B `approvals.why.sourceP90` | Use the vocabulary: header «מחירים שעלו · 30 יום», wizard «{pct} מעל המחיר הרגיל» / «יקר במיוחד לעומת מחירי העבר». The supplier header no longer reads like a second leak number next to the "דליפה" tab. |
| **concept.priceAlertRule** — when a price alert fires | `contracts.thresholds.intro` · `contracts.thresholds.emptyBody` (same tab, right under it) · `contracts.alerts.emptyBody` · `contracts.alerts.window` (each card) · `contracts.overview.body` (inventory-A) | Intro shows the default rule, precedence folded; thresholds empty body cut; alerts empty body «נתריע כאן כשמחיר יעלה מעל הסף.» |
| **concept.deliveryDate** — how the delivery date is set | `suppliers.schedule.emptyBody` · `orders.wizard.noSchedule` · `orders.wizard.missedCutoff` · `orders.wizard.reasonToday/reasonOn` · dead `wizard.deliveryHint`, `scheduleHint`, `reasonNoSchedule` · plus a second "schedule" on the same supplier: `suppliers.form.deliveryTitle/deliveryHint` (delivery time → late alert) | Schedule tab: one line; wizard: «בחרו תאריך אספקה.» + the evidence line; delete the 3 dead keys. The supplier form's delivery time is a different idea (late alert): rename to «שעה אחרונה» and fold its why. |
| **concept.unlinkedRows / skuLearning** — rows saved without a product; linking once teaches the system | `catalog.import.review.intro` · `catalog.import.review.laterHint` · `catalog.mapping.subtitle` · `catalog.mapping.pending` | Import review: «קשרו כל שורה למוצר.» + fold «למה?»; mapping: count + fold «חיבור אחד מעדכן את כל השורות, וההזמנות הבאות יזוהו לבד.» |
| **concept.savedOnPhone** — the wizard draft lives on this device | `orders.draft.resumeBody` · `leaveConfirm` · `switched` · `staleSent` / `staleCancelled` ("הטיוטה שבמכשיר") · `orders.send.undone` | Say "טיוטה" and the outcome; drop the device mechanics (also inventory-C concept.savedOnPhone). |
| **concept.consolidated** (T4) | `suppliers.ledger.gridSubtitle` "(רגילות ומרכזות)" · `suppliers.ledger.pending` · `suppliers.ledger.proposed` · `catalog.mapping.linkedConsolidated` | Statuses stay calm and say מרכזת; the subtitle drops the parenthesis (the columns say it); the mapping toast says what happens, not what did not. |
| **concept.clean** (T3) | `suppliers.leakCard.cleanBody` · `contracts.over.emptyBody` | One calm line each, no repeated time window. |

## (c) The 10 highest-value changes (before → after)

1. **Record-only order, every week-1 order (pilot) · `orders.send.cta.none`, `orders.detail.channels.none` = `orders.wizard.channelNone`**  
   לפני: כפתור: «סמנו כנשלחה (ירקות השרון לא יקבל הודעה)» · ערוץ: «ללא שליחה (סימון כנשלחה)»  
   אחרי: כפתור: «סמנו כנשלחה · בלי הודעה לספק» · ערוץ: «ללא שליחה · רישום בלבד» (מפתח אחד)
2. **Record-only success screen (pilot) · `orders.wizard.markedBody`**  
   לפני: «לא נשלח דבר לספק. ההזמנה עדיין תוצלב מול החשבונית כשתגיע.»  
   אחרי: «לא נשלח דבר לספק. החשבונית תיבדק מול ההזמנה.»
3. **Why record orders at all, said once (pilot) · `orders.subtitle`, `ingest.orderCapture.subtitle` → `explain.threeWayMatch`; cut from `catalog.subtitle`, `suppliers.*Tab.emptyBody`, `products.subtitle`**  
   לפני: orders: «הזמינו מהספקים — וכל חשבונית תיבדק מול ההזמנה.» · capture: «הדביקו או שתפו את ההזמנה ששלחתם לספק — נהפוך אותה להזמנת רכש, כדי שנוכל לבדוק מולה את החשבונית.» · + 5 more wordings  
   אחרי: orders: ‹כותרת› + «למה?» ← «כל חשבונית נבדקת מול ההזמנה ומול מה שהתקבל. בלי הזמנה אין מול מה לבדוק.» · capture: «הדביקו את ההזמנה ששלחתם לספק» + אותו «למה?»
4. **New-order wizard, step 2 (pilot) · `orders.wizard.subtitle` + `browseHint` + `noSchedule`**  
   לפני: «בנו הזמנה מתוך קטלוג הספק והגישו אותה.» · «הקלידו כדי לחפש, או בחרו מהפריטים הראשונים במחירון:» · «לספק אין לוח הזמנות — בחרו את תאריך האספקה.» (23 מילים לפני הפריט הראשון)  
   אחרי: — · — · «בחרו תאריך אספקה.» (3 מילים)
5. **Supplier delivery time, banned "יעד" (pilot setup) · `suppliers.form.deliveryTitle` + `deliveryHint`**  
   לפני: «לוח אספקה — ימים ושעת יעד» · «שעת היעד = עד מתי הסחורה אמורה להגיע. אם השעה תעבור ולא נקלטה תעודת קבלה — תופיע התראת איחור.»  
   אחרי: «לוח אספקה — ימים ושעה אחרונה» + «למה?» ← «אם השעה עברה ולא נקלטה קבלת סחורה, תופיע התראת איחור.»
6. **Supplier header on every tab (pilot setup) · `suppliers.detail.leakLabel`**  
   לפני: «שולם מעל המחיר החציוני (30 יום)» (ליד הלשונית "דליפה" עם סכום אחר)  
   אחרי: «מחירים שעלו · 30 יום»
7. **VAT on price-list import, wrong source (pilot setup, produce at 0%) · `catalog.import.vat.hint`**  
   לפני: «מחירים שכוללים מע״מ יישמרו ללא מע״מ, לפי שיעור המע״מ של המסעדה (0%).» (השיעור הוא של הספק)  
   אחרי: «מחירים כולל מע״מ יישמרו בלי מע״מ (0%).»
8. **English names, one idea in 5 places · `products.names.subtitle`, `products.form.nameEnHint`, `suppliers.form.nameEn` + `nameEnHint`, `products.subtitle`**  
   לפני: «הזינו שמות באנגלית לכמה מוצרים בבת אחת — כך צוות שלא קורא עברית (למשל מקבל סחורה) רואה את המוצרים באנגלית. ההתאמות והייצוא ממשיכים לעבוד על השם העברי.» (26) + עוד 4 ניסוחים  
   אחרי: «שמות באנגלית לכמה מוצרים בבת אחת» + «למה?» ← «מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.» (explain.englishName, בכל 5 המקומות)
9. **Price-list import review (pilot setup) · `catalog.import.review.intro`**  
   לפני: «השורות האלה נשמרו בלי קישור למוצר, כדי שלא ייווצרו פערים מדומים. אשרו את ההצעה, בחרו מוצר אחר או צרו מוצר חדש.» (21)  
   אחרי: «קשרו כל שורה למוצר.» + «למה?» ← «השורות נשמרו בלי קישור למוצר, כדי שלא ייווצרו פערים מדומים.»
10. **Page subtitles that restate the tabs (58 words) · `suppliers.subtitle`, `contracts.subtitle`, `catalog.subtitle`, `products.subtitle`**  
   לפני: «הקמת ספקים, פרטי קשר ותנאי תשלום — והדירוג שמראה מי מוסיף עלויות סמויות.» · «מחירי החוזה שסיכמתם עם הספקים, כל שורת חשבונית שחויבה מעליהם, ומוצרים שהמחיר שלהם מטפס.» · «חיפוש אחד לרוחב כל הספקים — …» · «שם המוצר מזין את מנוע ההצלבה והדוחות. …»  
   אחרי: — (הכותרת והלשוניות אומרות את זה; "מטפס" יוצא מהשפה)

## (d) Binding terms and house style found on the way

| Key (file:line) | Today | Fix | Note |
|---|---|---|---|
| `suppliers.leakCard.lines (suppliers/he.ts:140)` | {count} שורות חריגה | {count} שורות עם פער | live on the leak tab and the print card (lab: "12 שורות חריגה"); in the JSON |
| `suppliers.leakCard.topTypes (suppliers/he.ts:142)` | שלושת סוגי החריגה הגדולים | שלושת סוגי הפער הגדולים | live; in the JSON |
| `suppliers.leakCard.open / claimsCta (suppliers/he.ts:144,146)` | פתוח לטיפול / לתביעה · למכתבי התביעה | delete | dead keys with "תביעה"; the view already uses leaks.claims.*; in the JSON as CUT |
| `suppliers.form.deliveryTitle / deliveryHint (suppliers/he.ts:63-64)` | שעת יעד · שעת היעד | שעה אחרונה | "יעד" is banned everywhere; in the JSON |
| `contracts.subtitle (contracts/he.ts:8)` | מוצרים שהמחיר שלהם מטפס | cut (or «מחירים שעלו») | price creep has one name |
| `suppliers.detail.leakLabel (suppliers/he.ts:86)` | שולם מעל המחיר החציוני | מחירים שעלו | same |
| `suppliers.scores.emptyBody / runs (suppliers/he.ts:15,17)` | (match runs) · {count} השוואות בתקופה | drop the English; "השוואות" → "בדיקות" | jargon |
| `orders.list.reorder, orders.detail.reorder, orders.list.reorderAria (orders/he.ts:52,53,125)` | הזמן שוב · הזמן שוב מ{supplier} | הזמינו שוב · הזמינו שוב מ{supplier} | masculine singular on a button; plural imperative is the house style (W2-13 copy-gate) |
| `orders.wizard.checkingBaseline, orders.send.saving, orders.reorder.loading, orders.wizard.searching, supplierConfirm.card.creating, catalog.mapping.linking` | בודק… · שומר… · מכין… · מחפש… · יוצר… · מקשר ומעדכן… | בודקים… · שומרים… · מכינים… · מחפשים… · יוצרים… · מקשרים… | masculine singular progress text; first-person plural matches "קוראים את ההזמנה…" already used in capture |
| `catalog.import.check.flaggedSummary, suppliers.leakCard.openLines, catalog.import.check.heldTitle, contracts.import.rowsDetected` | "1 מחירים…", "1 שורות שטרם טופלו", "1 שורות לא ייובאו" | ICU plural / *One variants | seen in the lab (import with 1 flagged row; leak tab; W1-10 e2e asserts "מחיר לא ברור · 1 שורות לא ייובאו", so that test changes with it) |
| `products.form.name (products/he.ts:41)` | שם המוצר (קנוני, עברית) | שם המוצר בעברית | "קנוני" is not owner Hebrew; in the JSON |
| `orders.wizard.guardrailGated (orders/he.ts:226)` | מגן הדליפה בזמן הזמנה | בדיקת מחירים בזמן הזמנה | a coined term used nowhere else |

## (e) Copy that is wrong, not just long (fix with the shortening)

1. **`catalog.import.vat.hint`** says the restaurant's VAT rate; the code uses the supplier's override first (`packages/api/src/routers/catalog.ts:104`). Lab: ירקות השרון shows "(0%)" under "של המסעדה". Pilot setup imports produce price lists at 0%.
2. **`supplierConfirm.card.notSent`** ("אפשר לשלוח קישור לספק רק אחרי שההזמנה נשלחה") renders on **closed** orders (`supplier-confirm-card.tsx:11,111` checks sent/confirmed/partial only). Lab: #183452BA, sent by email and closed.
3. **`SUPPLIER_CONFIRM_DOC_PREVIEW_HE`** ("…יצורף בשליחה") and **`orders.document.previewBody`** ("ההזמנה כפי שתישלח") render on sent and closed orders (`documentExtension.ts:34-36` returns it for every preview). Lab: #098B0EE5, #183452BA.
4. **`products.form.deleteBlocked`** ("מקושר לחשבוניות או הזמנות") is shown for every CONFLICT, including the recipe and stock-count refusals (`product-client.tsx:78` vs `products.ts:212,225`).
5. **`orders.errors.cannotCancel`** ("שנסגרה או בוטלה") misses the server's third reason, "receiving already started" (`orders.ts:782`).
6. **`suppliers.schedule.pickDay`** renders as soon as the editor opens, before any input (lab: schedule editor).
7. **Explanations in `title=`** (invisible on touch): `orders.detail.lastLine` on the disabled delete icon (`detail-client.tsx:552`), `supplierConfirm.card.contractTagTitle`, `contracts.order.overContractTitle`, `contracts.over.badgeTitle` (the last one is in inventory-A).
8. **Two "schedules" on one supplier:** the details tab's "לוח אספקה — ימים ושעת יעד" (delivery time → late alert) and the "לוח הזמנות" tab (order days, cutoff → delivery date). The new titles («שעה אחרונה» vs «ימי הזמנה») keep them apart.

## (f) Not reachable in the lab (inventoried from source)

- Order **cancel dialog** (`detail.confirmCancelNamed`, `cancelFacts`, `notify*`): no cancel item was offered for the lab's sent orders. **Drafts** (resume offer, stale draft, switch supplier, leave confirm), **reorder** choices, the **sent/marked** step, send countdown/undo and send errors: they need a server draft, which this run never created.
- **Capture** parse/draft/confirm states (`ingest.orderCapture.*` after "יצירת טיוטת הזמנה"): `captureFromText` writes a draft.
- **Import** done/review/held/error states (catalog + contracts), mapping with pending SKUs (the lab queue is empty), threshold form errors, alerts empty state (the lab has one open alert), product delete-blocked.
- **Portal** answered / conflict / expired / rate-limited states (submitting would write an answer).
- Chef order screens (403 in lab and release; W1-11 train A).

## (g) Who adopts what, and what can ride Batch P

- **Owners (MECHANISM §6.4):** orders + capture → W2-06; suppliers → W2-11; contracts → W2-12; supplier portal + confirmation card → G-10; catalog, products, mapping → W2-16b (no wave-2 owner). Shared keys `explain.threeWayMatch` and `explain.englishName` → W2-16a.
- **Batch P (values only, pilot paths, train B):** the orders/capture SHORTEN/CUT values marked `pilotCritical` (record-only wording, markedBody, wizard subtitle/browseHint/noSchedule, list empty states) and `catalog.import.vat.hint`. `suppliers/he.ts` belongs to S5 inside the train (MECHANISM §6.2): send S5 the supplier rows (deliveryTitle/deliveryHint "יעד", leakLabel, schedule.emptyBody, manager.emptyBody, subtitle) as a list. Folds and new `explain.*` keys wait for W2-16a.
- **e2e pins that change** (`testRefs` in the JSON): `apps/web/e2e/W1-11.spec.ts` (reads `orders.list.noSearchResults`, `orders.wizard.noSchedule` from the catalog at runtime), `apps/web/e2e/orders-wizard-delivery.spec.ts` (`wizard.noSchedule`, and `send.cta.none.split('{supplier}')` — the new button text has no `{supplier}`, so the regex becomes the whole string: still passes, but re-check), `apps/web/e2e/W1-09.spec.ts:486` (`יש שדות לא תקינים` → portal.fixFields), `packages/api/src/__tests__/order-document-confirm-link.db.test.ts` (imports `SUPPLIER_CONFIRM_DOC_PREVIEW_HE`; the draft-only condition needs a new assertion), `apps/web/e2e/W1-10.spec.ts:121,137` (plural fix for "1 שורות לא ייובאו").
