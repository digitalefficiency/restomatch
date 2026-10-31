# Area review: Purchase orders (`orders`)

**Routes:** `/dashboard/orders` (list) · `/dashboard/orders/new` (wizard) · `/dashboard/orders/capture` (WhatsApp → PO) · `/dashboard/orders/[poId]` (detail + supplier document + supplier confirmation)
**Roles captured:** owner (he/en, desktop/phone), manager (he, desktop/phone). Manager captures are pixel-identical to owner except the header identity line (image diff bbox confined to the header).
**Benchmarks:** Choco (order guides, Order again, Team order), Rekki (cut-off per supplier, message receipts), Ordermentum (cut-off reminders, top-ups, standing orders), Restaurant365 (Autofill to Par, Last Order / Last-4 Avg / In-Transit per item, multi-vendor), xtraCHEF (order guides with normal qty, vendor Confirm Order), US Foods MOXē ("Did you forget"), Sysco Shop (shelf sequence, edit until cut-off, substitutes).
**Code read:** every file in `apps/web/app/dashboard/orders/**`, `packages/api/src/routers/orders.ts`, `packages/api/src/orders/**` (document, supplierMessage), `packages/api/src/supplierConfirm/documentExtension.ts`, `apps/web/lib/roles.ts`, `apps/web/app/dashboard/nav.tsx`, `apps/web/public/pwa/manifest.webmanifest`, `apps/web/app/dashboard/receiving/share/route.ts`, `apps/worker/src/jobs/orderReminders.ts`, `apps/web/lib/components/Button.tsx`, `apps/web/app/globals.css` (coarse-pointer floor), i18n `orders/he.ts` and `ingest/he.ts`.
**Crawl metrics:** all 14 captures 200, no console errors, no axe violations, no horizontal overflow. Desktop list: **104 targets under 24 px** (two text links per row). Load 1.3–1.8 s in the lab.

---

## 1. Verdict and scores (vs world-class)

| Lens | Score | One line |
|---|---|---|
| **Mobile** | **3.0 / 10** | A routine 10-line order from the phone costs ~40 taps + ~20 keyboard bursts (3–5 min). No guide, no usual quantities, no repeat, no cut-off, wizard not in focus mode, CTAs mid-screen, bottom nav live inside the task. |
| **Desktop** | **3.5 / 10** | The list is a flat 50-row chronological log in a 1152 px column: no search, sort, counts, totals, bulk, attention states, or cross-branch scope. The detail page is an island (no receipt, invoice, leak, PO ref or timeline). |
| **Functionality** | **4.0 / 10** | Solid foundations (draft/send/edit/cancel, supplier document + PDF + WhatsApp text, contract-price badge, price guardrail, delivery derivation from `order_schedule`, WhatsApp capture, supplier confirmation link). Missing every "speed" feature the leaders compete on, and the supplier-confirmation loop dead-ends. |

**Why this area matters to the North Star:** every order placed outside RestoMatch (a phone call, a voice note) is a PO the three-way match never sees, so QTY_SHORT leak is invisible. Ordering speed on the phone *is* leak coverage. Today the app makes ordering slower than WhatsApp, so the manager keeps using WhatsApp.

**Bars:** fails the pilot bar on primary-flow S1s (G2, G9, C10, H7) and has two P0 functional blocks (no guide/usual qty; chef cannot order) plus a P0 for "no repeat order".

---

## 2. Task walk-throughs (tap counts, derived from code + screenshots)

### T1 · Manager, phone: routine order to a known supplier (10 lines)
| Step | Today | Taps |
|---|---|---|
| Reach orders | Bottom bar has no Orders (`nav.tsx:275-278` → סקירה · קליטת סחורה · תור אישורים · בלש דליפות · עוד) → עוד → scroll drawer → הזמנות | 2 + scroll |
| Start | "הזמנה חדשה" at the **top** of the page (`page.tsx:49`) | 1 |
| Supplier | Native `<select>` (`wizard.tsx:262`) → pick → (iOS Done) → "המשך" (`:291`, 12 px `size="sm"`) | 3–4 |
| Per line ×10 | Focus search → type 3–5 chars → tap result (adds **qty 1**, `:358`) → focus qty `type="number"` (`:446`) → type | 3 taps + 2 typing bursts each = **30 + 20 bursts** |
| Review | "המשך לסקירה" (`:510`) → date + channel defaults → "שליחת ההזמנה" (`:663`) | 2 |
| **Total** | | **≈ 40 taps + ~20 keyboard bursts, 3–5 min** |
| Benchmark | R365 ⋮ → Autofill to Par → Submit ≈ 6–7 taps independent of line count; Choco N + 6 | **Target ≤ 9 taps, ≤ 45 s, no keyboard** |

### T2 · Repeat yesterday's order
Not possible anywhere (no reorder/clone in `orders/**` or `routers/orders.ts`). Same ~40 taps as T1. The seeded data shows exactly this pattern: ירקות השרון 11 lines every 2–3 days, מאפיית ברנר 4 lines, מחלבות הגליל 2–7 lines (`dashboard_orders__owner__desktop-he.png`).

### T3 · WhatsApp order already sent → PO (capture)
Copy message (2) → open app → עוד → הזמנות → "הדבקת הזמנה מוואטסאפ" (3 + scroll) → long-press/paste (2–3) → "יצירת טיוטת הזמנה" (1) → [pick supplier + המשך (2)] → "אישור ההזמנה" (1) ≈ **10–12 taps**. With the Android share target ≈ 4–5 taps, but the share target lives in the **receiver** PWA scope and redirects to a page that 404s for the receiver role (see orders-17).

### T4 · Supplier answers "only 6 of 10"
The answer shows as a diff table on the order page, then "ההזמנה לא משתנה" (`supplier-confirm-card.tsx:250`). No accept action; receiving still expects 10 → a QTY_SHORT flag everyone already knew about (T4 noise). The list row never shows that the supplier answered.

### T5 · Sent order, delivery day: "is it here, did we get what we ordered, what did it cost us?"
Order page offers only "ביטול הזמנה" (`detail-client.tsx:238-246`). No link to the goods receipt, no invoice, no ordered/received/billed comparison, no leak ₪, no history. The manager has to leave for קליטת סחורה and find the PO again.

### T6 · Owner, desktop: "what did we buy this week, from whom, and what's late?"
Scroll a 50-row log sorted by creation date; no search, supplier filter, date range, totals or late state. Not answerable in one screen.

---

## 3. Page-by-page

### 3.1 `/dashboard/orders` — list
*Screens:* `dashboard_orders__owner__desktop-he.png`, `…__owner__phone-he.png`, `…__owner__desktop-en.png`, `…__manager__desktop-he.png`, `…__manager__phone-he.png`.
- **Header** (`page.tsx:35-55`): h1 + 2-line subtitle + two creation CTAs ("הדבקת הזמנה מוואטסאפ" secondary, "הזמנה חדשה" primary; Zestt import hidden in lab). Fine on desktop; on phone the CTAs sit at the top (outside thumb zone) and push the list down.
- **Tenant-wide setting on a list page** (`page.tsx:56`, `supplier-document.tsx:206-233`): "מחירים בהזמנה לספק" checkbox saves instantly on change. A stray tap changes every future supplier document.
- **Filters** (`list-client.tsx:78-155`): הכל/טיוטות/נשלחו/חלקיות/התקבלו/נסגרו/בוטלו, no counts; "נשלחו" actually means "awaiting delivery" (`queryOf`); `confirmed` is not offered; no "מגיע היום" / "באיחור" / "דורש טיפול". On phone the chip row is clipped ("נסגו…").
- **Table** (`orders-table.tsx:250-291`): identity column is the *creation date* (the link), supplier is a `tabIndex={-1}` link; no sort, no `aria-sort`, no sticky header, no totals row, no PO ref, no confirmation/receipt/invoice columns. Headers `uppercase tracking-wide` on Hebrew. Money in `font-mono`; in Hebrew the money/lines columns are physically left and left-aligned, so decimals do not line up (`₪ 2,030.01` over `₪ 875.53`).
- **Phone cards** (`orders-table.tsx:293-322`): supplier + ₪ (mono, the loudest thing) + status + two absolute dates + line count. ~110 px per card → 50 cards ≈ 5,500 px of scroll, no grouping, no inline action. Delivery "today" is indistinguishable from any other date.
- **States:** loading = inline spinner text (no `loading.tsx`); error = `ErrorNotice` (good); empty first-use and filtered-empty exist with one CTA (good).
- **Container:** `max-w-6xl` leaves ~290 px unused at 1440; 11 rows above the fold.

### 3.2 `/dashboard/orders/new` — wizard
*Screens:* `dashboard_orders_new__owner__desktop-he.png`, `…__phone-he.png`, `…__desktop-en.png` (only the SUPPLIER step was capturable).
- **SUPPLIER step:** one native select + disabled "המשך". No cut-off, no "order day today", no last-order context, no repeat. Half the phone screen is empty while the bottom nav and consent bar are live.
- **BUILD:** search-first catalog list, browse = first **8 alphabetical** items (`wizard.tsx:101-104`; `catalog.ts` orders by `supplierNameRaw`), tap adds qty 1; lines are a 5-column grid of `type="number"` inputs on phone (`:417`, `:446`, `:467`); delete is a 24 px icon (44 only via the coarse-pointer floor). Good: contract-price "₪x מעל החוזה" solid-warn badge, merge-on-re-add, live total, `aria-live` add announcement.
- **REVIEW:** line list + guardrail badges ("מעל אחוזון 90" — jargon) + DeliveryPanel (duplicated from step 1) + channel select. When the priced-document flag is ON (the lab default) **no preview of the outgoing document is shown** (`:593`). Send is immediate, no undo, CTA "שליחת ההזמנה" doesn't name channel or supplier.
- **SENT:** "ההזמנה הוגשה בהצלחה" even when the email is only queued; doesn't say to whom/when.
- **Not a task mode:** global header + bottom nav remain; the order lives only in React state (no autosave, no leave guard); changing supplier silently wipes lines (`:265-270`). Steps are `size="sm"` (12 px) in-flow buttons with "חזרה" beside the primary.
- **No up-link/breadcrumb** (ia-map: orders/new has neither).

### 3.3 `/dashboard/orders/capture` — WhatsApp → PO
*Screens:* `dashboard_orders_capture__owner__desktop-he.png`, `…__phone-he.png`, `…__desktop-en.png`.
- Strong concept (Choco OrderAgent analogue), 56 px CTAs, supplier recognition by phone/name, idempotent "already captured" badge.
- Friction: manual paste only; Hebrew in `font-mono` (`capture-client.tsx:258`); the example placeholder reads like content; on 390 the primary sits under the bottom nav + consent bar; `?text=` prefill still needs a tap to parse; "פריט חדש" lines can't be mapped inline and the "עריכה" escape goes to a detail page that can't map them either; no contract-price badge on parsed lines; no voice/photo.

### 3.4 `/dashboard/orders/[poId]` — detail
*Screens:* `dashboard_orders_ID__owner__desktop-he.png`, `…__phone-he.png`, `…__desktop-en.png`.
- **Header card:** status chip + Created / Sent via / Expected delivery / Est. total (mono). Times "9:00 ,25.10.2026" (no leading zero). Only action on a sent order is **"ביטול הזמנה"** (danger icon) — the most prominent control on the phone card. No PO ref although the supplier's copy says "מס׳ הזמנה: F8E05686" (`supplierMessage.ts:54,67`, `document/build.ts:73`).
- **Breadcrumb** mixes hierarchies (הזמנות › supplier hub › "הזמנה").
- **Lines table:** alphabetical (`PO_LINE_ORDER`), mono money, inline edit with `type="number"`; no add-line, no product mapping; delete line is a ConfirmDialog (reversible draft edit → should be Undo).
- **"מה הספק מקבל":** collapsed preview with email/WhatsApp tabs + PDF — good, but only reachable on the draft/detail page, which the wizard skips.
- **"אישור ספק":** SectionHeader level 2 renders ~30 px, louder than the order itself; solid primary "יצירת קישור לספק" even though `placeOrder` already appended a link (`documentExtension.ts`); supplier changes shown read-only, PO "never changes".
- **Missing:** receipt link, invoice link, 3-way comparison, leak ₪ for this PO, history, order again, cancel-notifies-supplier.
- **Error state:** any `orders.get` failure → `notFound()` (`page.tsx:18-22`), so an outage reads as "this order does not exist".

---

## 4. Findings (ranked)

Severity: P0 blocks/misleads a core task · P1 major friction or below benchmark · P2 polish · P3 nit. Rubric IDs in brackets. "humanPR" = needs a human-authored PR under AGENTS.md.

| ID | Sev | Kind | Device | Finding (short) | Effort | humanPR |
|---|---|---|---|---|---|---|
| orders-01 | P0 | flow | mobile | No order guide / usual quantities; BUILD is search-first, qty 1, typed inputs (~40 taps) [G9, G5, G3] | L | no |
| orders-02 | P0 | functional | both | No "Order again" anywhere [G9, P6] | S | no |
| orders-03 | P0 | functional | mobile | Chef (and receiver) cannot draft an order; route + procedures manager-only [D1, FG-02] | M | no |
| orders-04 | P1 | flow | mobile | Cut-off never shown before it's missed; supplier picker is a bare select [H8, G9] | M | no |
| orders-05 | P1 | functional | both | Order-reminder email deep link uses `?supplier=` but page reads `?supplierId=` → supplier dropped [D9] | S | no |
| orders-06 | P1 | flow | mobile | Wizard isn't a focused thumb-first task: bottom nav live, 12 px in-flow CTAs mid-screen, no cart bar [G1, G2, G3] | M | no |
| orders-07 | P1 | states | both | Order lost on navigation/refresh; supplier change silently wipes lines [C5, G7] | M | no |
| orders-08 | P1 | trust | both | With priced document ON, review shows no preview; send is immediate, no undo; CTA doesn't name channel [C10, G9] | M | no |
| orders-09 | P1 | functional | mobile | No "send from my WhatsApp" (wa.me) path; platform WhatsApp is plan-gated [G9] | S | no |
| orders-10 | P1 | functional | both | Supplier confirmation dead-ends: no accept-changes, list never shows confirmation, redundant link CTA [H7, C4, A7] | M | yes |
| orders-11 | P1 | ia | both | Order detail is an island: no receipt/invoice/3-way/leak/timeline; primary action doesn't follow state [H2, H7, D6] | M | no |
| orders-12 | P1 | trust | both | PO reference the supplier receives (F8E05686) is never shown or searchable in the app [E3, D4] | S | no |
| orders-13 | P1 | functional | both | Cancelling a sent order doesn't notify the supplier; generic confirm; cancel is the main action [C10, C12] | M | no |
| orders-14 | P1 | functional | both | No add-line / product mapping on drafts; sent orders frozen (no edit until cut-off) | M | no |
| orders-15 | P1 | ia | desktop | List is a chronological log, not a work queue (no search/sort/counts/totals/bulk/attention views, 1152 px) [C1, C2, C3, D8] | L | no |
| orders-16 | P1 | ia | mobile | Orders missing from the owner/manager bottom bar (3 taps + scroll) [D3] | S | no |
| orders-17 | P1 | functional | mobile | Capture: share target 404s for receiver; manual paste; no inline mapping; CTA below fold [G9, H5] | M | no |
| orders-18 | P1 | flow | mobile | Phone list: low-density cards, absolute dates, no grouping, no inline action, settings in the header [C3, A8] | M | no |
| orders-19 | P1 | functional | mobile | One supplier per session; ordering 5 suppliers = 5 wizard runs [G9, P18] | L | no |
| orders-20 | P1 | a11y | both | Focus rings at 2.7:1 (`ring-primary/60`) and 1.39:1 (ghost `ring-line`) on chips, rows, Back, Cancel [F3] | S | no |
| orders-21 | P2 | visual | both | Money in mono; he money columns left-aligned so decimals don't line up [B2, B4] | S | no |
| orders-22 | P2 | rtl | both | `<bdi dir="ltr">` around he-IL ₪ (review line, supplier-confirm table); tracking/uppercase on Hebrew headers [E4, E6] | S | no |
| orders-23 | P2 | a11y | both | Qty/price inputs `type="number"`; no select-on-focus / enterKeyHint [C7] | S | no |
| orders-24 | P2 | trust | both | Est. total silently excludes unpriced lines (counts them as ₪0) [A4, B3] | S | no |
| orders-25 | P2 | ia | both | Tenant-wide "prices on supplier order" checkbox saves on change from the list page | S | no |
| orders-26 | P2 | states | both | No loading.tsx for orders routes; detail turns any error into 404 [C8, I4] | S | no |
| orders-27 | P2 | flow | both | Delivery date is a free native date input (any day), duplicated on two steps; missed cut-off is 12 px warn text [E8, H8, A7] | S | no |
| orders-28 | P2 | copy | both | "הוגשה בהצלחה" for a queued email; "אחוזון 90" jargon; success screen omits who/when [E9, H1] | S | no |
| orders-29 | P2 | a11y | desktop | 104 sub-24 px targets on the list (two text links per row) [F4] | S | no |
| orders-30 | P2 | visual | both | Detail hierarchy: no object header, sibling card headings 16 px vs 30 px, cancel is the loudest action [B1, C12, J4] | S | no |
| orders-31 | P2 | ia | both | Breadcrumb mixes hierarchies; new/capture have no up-link [D5] | S | no |
| orders-32 | P2 | functional | desktop | No cross-branch purchasing scope for chain owners | M | no |
| orders-33 | P2 | functional | both | No supplier minimum-order / delivery-fee awareness (needs schema) | M | yes |
| orders-34 | P2 | visual | both | Status chips without icons; cancelled shown as danger [C11, A7] | S | no |
| orders-35 | P3 | rtl | both | Times "9:00 ,25.10.2026": no leading zero, comma bidi; prefer "25.10.2026 · 09:00" [E8] | S | no |

### Detail per finding

**orders-01 · P0 · No order guide / usual quantities.**
*Evidence:* `wizard.tsx:101-104` (browse = 8 items, alphabetical via `catalog.ts` `orderBy(supplierNameRaw)`), `:344-362` (tap adds `qty: 1`), `:417-480` (5-column typed grid, `type="number"`); `dashboard_orders_new__owner__phone-he.png`; recurring orders in `dashboard_orders__owner__desktop-he.png`.
*Fix:* new `orders.orderGuide({ supplierId })` (memberProcedure, COVERAGE entry) derived from the last 8 POs' `po_lines`: item appears in ≥2 of 8, `usualQty` = median of last 4, `lastQty`, `lastOrderedAt`, price = contract (`contracts.orderPrices`) else last/list. BUILD renders guide rows grouped by category/shelf (PT1): name 16/600, context line "אחרון 6 · בד״כ 5 · ₪12.40/ק״ג", 48 px stepper, qty starts at 0 with a ghost "בד״כ 5"; ⋮ menu "מלא כמו בפעם הקודמת" / "מלא כמות רגילה" / "אפס" with a 10 s Undo toast; tapping the number opens a keypad sheet (3-dec for kg). Search + free line move to "+ פריט אחר" at the bottom. Desktop: same data as a dense grid where Tab moves between qty cells. *Exemplar:* Choco order guides; xtraCHEF "normal quantity"; R365 Last Order / Last-4 Avg / Autofill.

**orders-02 · P0 · No "Order again".**
*Evidence:* no reorder/clone symbol in `apps/web/app/dashboard/orders/**` or `routers/orders.ts`; `detail-client.tsx:211-247` (send/cancel only); `orders-table.tsx` rows are plain links.
*Fix:* "הזמן שוב" on the detail header (secondary), list row overflow / phone card action, and supplier hub orders tab → `/dashboard/orders/new?supplierId=X&from=<poId>` that pre-fills lines (current contract price) and the next valid delivery date; if a draft for that supplier exists, PT5 sheet "צרף לטיוטה / החלף את הטיוטה". Target ≤4 taps. *Exemplar:* Choco Order again (replace/combine).

**orders-03 · P0 · Chef cannot order.**
*Evidence:* `lib/roles.ts` `'/dashboard/orders': ['owner','manager']`; `routers/orders.ts:447,734,868` managerProcedure; capture `page.tsx:93` 404s other roles.
*Fix:* chef (optionally receiver) gets `/dashboard/orders/new` in request mode: new `orders.createDraftRequest` (memberProcedure gated to owner/manager/chef + COVERAGE entry), status draft + requester; chef's primary "שלח למנהל לאישור" + optional note. Manager list gets a top section "ממתינות לשליחה (2)" with rows "שף דני · ירקות השרון · 9 פריטים · ₪640 · נסגר בעוד 1:40" → one-tap "שלח לספק". `tenant-security-warden` review. *Exemplar:* Choco Team Order (contributors edit, admins submit).

**orders-04 · P1 · Cut-off invisible until missed.**
*Evidence:* `previewDelivery` returns `nextOrderCutoffAt` (`orders.ts:573-596`) but `grep nextOrderCutoffAt apps/web` = 0; SUPPLIER step = native select (`wizard.tsx:261-278`); `missedCutoff` only as `text-xs text-warn` (`:741-743`).
*Fix:* supplier board (PT3) replacing the select: 72 px rows sorted by next cut-off, chip "נסגר ב-16:00" (neutral) → "נסגר בעוד 2:15" (warn ≤3 h) → "נסגר בעוד 25 ד׳" (danger-solid ≤30 min, T2) → "המשלוח הבא: ג׳ 07:00"; second line "הזמנה אחרונה: לפני 3 ימים · ₪875"; top group "להזמין היום" = order day today and no PO yet. One batched `orders.supplierBoard` query. *Exemplar:* Rekki cut-off on every supplier; Ordermentum reminders.

**orders-05 · P1 · Broken reminder deep link.**
*Evidence:* `apps/worker/src/jobs/orderReminders.ts:101` builds `/dashboard/orders/new?supplier=${s.id}`; `apps/web/app/dashboard/orders/new/page.tsx:10-13` reads only `supplierId`.
*Fix:* accept `supplier` as an alias in `new/page.tsx` (`supplierId ?? supplier`) + a unit test. No change to `cron.ts` (immutable); the job file itself can stay as is. *Exemplar:* Apple HIG / Linear notifications deep-link to the exact object.

**orders-06 · P1 · Wizard not thumb-first.**
*Evidence:* `wizard.tsx:291,510-516,656-668` (`size="sm"` = `text-xs px-3 py-1.5` in `Button.tsx`), MobileNav still rendered; `dashboard_orders_new__owner__phone-he.png` (CTA ≈ 48% of viewport height, nav + consent below).
*Fix:* `data-mode="field"` on `/orders/new` and `/orders/capture`: hide MobileNav, top bar "× ביטול" at start + "2/3"; sticky bottom cart bar (PT2) 64 px + safe area: "7 פריטים · ₪1,240 · אספקה ג׳ 07:00" + 56 px primary ("המשך" → "שלח ל{ספק} ב-WhatsApp"); "חזרה" becomes a text button above it. *Exemplar:* Choco basket bottom-end; Odoo full-screen task mode.

**orders-07 · P1 · Order lost on navigation.**
*Evidence:* lines only in `useState` (`wizard.tsx:74`); no `beforeunload`/route guard (only `products/names-grid.tsx` has one); supplier change resets lines (`:265-270`).
*Fix:* persist `{supplierId, lines, deliveryDate}` to `sessionStorage` (try/catch) on every change and restore with "המשך מהטיוטה (7 פריטים)"; better, create the server draft on the first added line and autosave via `updateOrderLine`; guard leave while unsent; supplier change with lines → sheet "להחליף ספק? 7 פריטים יימחקו" + Undo. *Exemplar:* R365 Save keeps the order In Progress.

**orders-08 · P1 · Blind send with the priced document.**
*Evidence:* `wizard.tsx:593` renders `OrderDocumentPreview` only when `docSettings.enabled === false`; the lab has the flag on (toggle visible in `dashboard_orders__owner__desktop-he.png`); `submit()` calls `placeOrder` immediately (`:160-189`).
*Fix:* REVIEW always shows the literal document (WhatsApp bubble / email + PDF thumb) via `orders.documentPreview` extended to accept unsaved lines; CTA names the effect ("שלח לירקות השרון בוואטסאפ"); after the tap a 10 s "נשלח בעוד 10 שנ׳ · בטל שליחה" (R-8) before `placeOrder` is called (client-side; no `outbox.ts` change). *Exemplar:* Superhuman Undo Send; US Foods MOXē review.

**orders-09 · P1 · No send-from-my-WhatsApp.**
*Evidence:* channel `whatsapp` goes through the platform outbox and is plan-gated (`errors.whatsappGated`, `wizard.tsx:193-194`); `supplier-link-button.tsx:105` already builds `wa.me` links.
*Fix:* channel "מהוואטסאפ שלי": opens `https://wa.me/<supplier.contactWhatsapp>?text=<whatsappText>` and marks the PO sent (`placeOrder` channel `none`, note "נשלח ידנית בוואטסאפ"). Default when the supplier has a WhatsApp number and platform WhatsApp isn't in the plan. *Exemplar:* Choco chat-native ordering.

**orders-10 · P1 · Supplier confirmation dead-ends (humanPR for the storage part).**
*Evidence:* `supplier-confirm-card.tsx:250` "ההזמנה לא משתנה", no action; `list-client.tsx:78` has no `confirmed`; list rows have no confirmation column; solid "יצירת קישור לספק" (`supplier-link-button.tsx:97`) although `placeOrder` appends a link (`documentExtension.ts`).
*Fix:* (agent) list chip "אושר" / "אושר עם 2 שינויים" (warn) / "ממתין לספק"; detail timeline "נשלח 09:00 · נפתח 09:12 · ענה 09:40"; "שלח קישור שוב" as secondary. (human PR, schema) store a revised expectation per line ("כמות מאושרת") so "קבל את השינויים (−₪184)" updates what receiving expects while the original stays for audit. *Exemplar:* Rekki message receipts; xtraCHEF Confirm Order; Sysco substitutes.

**orders-11 · P1 · Detail is an island.**
*Evidence:* `detail-client.tsx:164-250` (no receipt/invoice links); `goods_receipts.po_id`, `match_runs.po_id` exist (`schema.ts:754,951`); `dashboard_orders_ID__owner__desktop-he.png`.
*Fix:* object header + state-driven primary: draft → "שלח"; sent and due today → "קבל סחורה" (`/dashboard/receiving/[poId]`); received with discrepancies → "ראה פערים · ₪184"; add a 3-way table (הוזמן · התקבל · חויב · פער ₪) from the receipt and match run, and "היסטוריה" (H7). Evidence chips open a peek (D6). *Exemplar:* Ramp bill (Not received / Partially received); Stripe object page.

**orders-12 · P1 · PO ref invisible.**
*Evidence:* supplier copy "מס׳ הזמנה: {poRef}" (`supplierMessage.ts:54,67`; `document/build.ts:73`); `grep poRef apps/web/app/dashboard/orders` = 0; dock slip uses a *different* format "PO-xxxxxxxx" (`receiving/[poId]/dock-slip.tsx:99`).
*Fix:* show `#F8E05686` as a `<Token>` with copy in the detail header, list column and phone card; one format everywhere (drop the "PO-" variant); index it in ⌘K search. *Exemplar:* Stripe object IDs with copy.

**orders-13 · P1 · Cancel doesn't reach the supplier.**
*Evidence:* `orders/he.ts:80` "ביטול כאן לא מודיע לספק — עדכנו אותו בעצמכם"; `detail-client.tsx:420-429` generic confirm; cancel ghost next to Send (`:211-247`); phone header card shows only cancel.
*Fix:* move cancel into "⋯"; ConfirmDialog names party + ₪ + date ("לבטל את ההזמנה לשטיינברג · ₪2,030.01 · אספקה ג׳ 27.10?") with "שלח הודעת ביטול לספק" (default on; WhatsApp deep link or email via the document path). *Exemplar:* Stripe "confirm costly actions"; Sysco/Ordermentum edit-until-cut-off.

**orders-14 · P1 · No add-line, no mapping, no edit-until-cut-off.**
*Evidence:* `updateOrderLine` patch has no `productId` (`orders.ts:799-843`); no add-line procedure; non-draft lines frozen (`:829`); capture marks lines "פריט חדש" with no fix path.
*Fix:* draft detail "+ הוסף פריט" (catalog sheet) and per-line "שייך למוצר" with a pre-suggested top candidate and its basis (H5); new `orders.addOrderLine` + `productId` in the patch (COVERAGE entries). Sent orders before the next cut-off: "ערוך עד 16:00" → amend and re-send a diff ("תיקון להזמנה #F8E05686"). *Exemplar:* Ordermentum one-off edits until cut-off.

**orders-15 · P1 · Desktop list is a log.**
*Evidence:* `list-client.tsx:78-155`; `orders-table.tsx:250-291`; `orders.list` already accepts `supplierId` with no UI; `dashboard_orders__owner__desktop-he.png` (11 rows above the fold, 50-row flat list, ~290 px unused).
*Fix:* saved-view tabs with counts ("דורש טיפול 3 · מגיע היום 3 · באיחור 1 · טיוטות · השבוע · הכל", in the URL); search (supplier / PO ref / product), supplier multi-select, date range; sortable headers with `aria-sort`, sticky header; columns ספק (identity link) · # · סטטוס + אישור ספק · אספקה (relative) · קבלה · חשבונית / פער ₪ · סכום; footer "18 הזמנות · ₪12,483.30"; bulk "שלח טיוטות", "ייצוא CSV"; `max-w-[1600px]`; row click opens a 480 px peek (D6); keyboard j/k/Enter. *Exemplar:* Linear views; Shopify order views; Polaris IndexTable.

**orders-16 · P1 · Orders not in the bottom bar.**
*Evidence:* `nav.tsx:275-278` (first 4 items); phone captures show סקירה · קליטת סחורה · תור אישורים · בלש דליפות · עוד.
*Fix:* role-chosen bar: manager [בית · הזמנות · קבלה · אישורים · עוד]; chef [בית · הזמנה · ספירה · מתכונים · עוד]. *Exemplar:* Rekki Market tab; R365 app Orders.

**orders-17 · P1 · Capture friction and the receiver 404.**
*Evidence:* `manifest.webmanifest` share_target (scope `/dashboard/receiving`) → `receiving/share/route.ts` → `/dashboard/orders/capture`, which 404s for non-owner/manager (`capture/page.tsx:93`); `capture-client.tsx:258` `font-mono`; manual paste; `dashboard_orders_capture__owner__phone-he.png` (CTA under nav + consent).
*Fix:* "הדבק מהלוח" (`navigator.clipboard.readText`, fallback focus); auto-parse when `?text=` is present; Heebo; inline product picker for "פריט חדש" with a suggested match and basis; contract-price badges on parsed lines; sticky confirm bar; for receiver/chef, a share becomes a "בקשת הזמנה" (orders-03) instead of a 404; later a 🎙 voice note into the same `captureFromText`. *Exemplar:* Choco OrderAgent; Rekki Connect.

**orders-18 · P1 · Phone list.**
*Evidence:* `orders-table.tsx:293-322`; `dashboard_orders__owner__phone-he.png` (first viewport: banner, title, subtitle, 2 CTAs, settings checkbox, chips, 1.5 cards).
*Fix:* compact header; one 56 px "הזמנה חדשה" FAB above the nav at bottom-end; sections היום / מחר / השבוע / קודם; card line 1 supplier + status chip, line 2 "אספקה: היום · 11 פריטים · ₪875.53" (relative dates), one inline action by state (שלח / קבל / הזמן שוב). *Exemplar:* Sysco "today's delivery"; Choco orders tab.

**orders-19 · P1 · One supplier per session.**
*Evidence:* `wizard.tsx:61-62` (single-supplier steps), `:265-270`.
*Fix:* see Big move 2 ("הזמנות היום" multi-cart that splits into N POs, one "שלח הכל (3 ספקים)"). *Exemplar:* R365 multi-vendor orders; xtraCHEF "repeat for each vendor" is the anti-pattern.

**orders-20 · P1 · Weak focus rings.**
*Evidence:* `list-client.tsx:146`, `orders-table.tsx:268,298`, `wizard.tsx:490`, `supplier-document.tsx:293` (`ring-primary/60` ≈ 2.7:1); `Button.tsx` ghost `focus-visible:ring-line` (1.39:1) used by "חזרה", "ביטול הזמנה", line edit/delete.
*Fix:* the single `--c-focus` token (R-5), 2 px + 2 px offset. *Exemplar:* Primer focus ring.

**orders-21 · P2 · Money typography and alignment.** `font-mono` on ₪ in `orders-table.tsx:286,305`, `detail-client.tsx:201,303,310,339,355`, `wizard.tsx:373,481,502,561,572`; he columns `text-end` = physically left and left-aligned. Fix: `<Money>` (Heebo tabular) + `NumCell` aligned physically right in both locales (R-1), ₪ in the header ("סכום משוער (₪)"). *Exemplar:* Polaris DataTable numeric columns.

**orders-22 · P2 · Bidi and Hebrew typesetting.** `<bdi dir="ltr">{money(…)}</bdi>` at `wizard.tsx:557`, `supplier-confirm-card.tsx:228,236` puts ₪ on the wrong side next to correctly rendered totals; `uppercase tracking-wide` on Hebrew headers (`orders-table.tsx:253`, `detail-client.tsx:264`). Fix: `<Money>`; gate tracking/uppercase behind `ltr:`.

**orders-23 · P2 · Number inputs.** `type="number"` at `wizard.tsx:446,467`, `detail-client.tsx:313,342`. Fix: `type="text" inputMode="decimal"` with the existing `parsePositive`/`parsePrice` (`order-logic.ts:15-28`), select-all on focus, `enterKeyHint="next"`. *Exemplar:* `inventory/count/count-screen.tsx` (house model); Stripe CurrencyField.

**orders-24 · P2 · Silent partial total.** `lineTotalIls` returns 0 for a missing price (`order-logic.ts:84-87`), so "סה״כ משוער" (`wizard.tsx:500-503,570-573`) excludes unpriced rows with no note. Fix: "₪1,240.00 · לא כולל 2 שורות ללא מחיר" (T4), and the same on the detail header.

**orders-25 · P2 · Setting on the list page.** `page.tsx:56`, `supplier-document.tsx:206-233` save on change. Fix: move to Settings → "מסמך ההזמנה לספק" with the preview; in REVIEW show a read-only chip "המחירים יופיעו בהזמנה · שינוי".

**orders-26 · P2 · States.** No `loading.tsx` under `dashboard/orders/**` (only approvals/exports/receiving/settings/suppliers have one); `[poId]/page.tsx:18-22` maps every error to `notFound()`. Fix: layout-true skeletons (list rows, detail header + 5 lines); `error.tsx` "לא הצלחנו לטעון את ההזמנה · נסה שוב"; 404 only on NOT_FOUND. *Exemplar:* Polaris SkeletonPage.

**orders-27 · P2 · Delivery date picker.** `wizard.tsx:753-764` native date input (`min=today` only); DeliveryPanel rendered on both SUPPLIER (`:281`) and REVIEW (`:575`); missed cut-off as 12 px warn. Fix: chips of the next 3 valid delivery days from `order_schedule` with the reasoning line "הזמנה עד 16:00 היום → אספקה מחר 07:00", shown once (REVIEW + cart bar); missed cut-off as a neutral T4 line with the next date; holidays/ערב חג later. *Exemplar:* Ordermentum delivery days; Choco "Add delivery date".

**orders-28 · P2 · Copy.** `orders/he.ts:7,160` "בנו והגישו", "ההזמנה הוגשה בהצלחה" (shown even when queued); `:148` "מעל אחוזון 90". Fix: subtitle "הזמינו מהספקים — וכל חשבונית תיבדק מול ההזמנה"; success "נשלח לירקות השרון בוואטסאפ · אספקה: יום ג׳ 27.10" / queued "בתור לשליחה באימייל — נעדכן כשיצא"; guardrail "יקר ב-18% מהרגיל אצל הספק (חציון 90 יום: ₪12.40)".

**orders-29 · P2 · Desktop target size.** Crawl: 104 small targets on `/dashboard/orders` desktop; each row has a date link and a `tabIndex=-1` supplier link (`orders-table.tsx:265-279`). Fix: one stretched row link (accessible name = supplier · date · ₪), hover/focus row state.

**orders-30 · P2 · Detail hierarchy.** `supplier-confirm-card.tsx:185` `SectionHeader level={2}` (≈30 px) vs `supplier-document.tsx:263` (16 px); total in mono inside a 4-col `dl`. Fix: object header (supplier · #ref · status · timeline), facts row, one primary per state, sibling cards at heading-sm.

**orders-31 · P2 · Wayfinding.** `[poId]/page.tsx:40-47` crumb "הזמנות › {supplier hub} › הזמנה"; new/capture have none. Fix: "הזמנות › #F8E05686" with the supplier as a header link; "× / חזרה להזמנות" in field mode.

**orders-32 · P2 · Chain scope.** `orders.list` is per `ctx.session.restaurantId`; the chain owner switches branches to compare. Fix: "כל הסניפים" scope for chain owners (branch column + filter) and a branch × supplier weekly spend matrix in `/dashboard/chain` (with `tenant-security-warden`). *Exemplar:* Choco restaurant groups; Supy multi-site.

**orders-33 · P2 · No minimum-order awareness (humanPR).** No MOV/delivery-fee field on suppliers (`schema.ts` suppliers). Fix (schema → human PR): `min_order_ils` + fee; cart bar "עוד ₪160 למינימום" and a warning before send. *Exemplar:* Ordermentum MOV at checkout.

**orders-34 · P2 · Status chips.** `orders-table.tsx:214-222` cancelled = danger, no icons. Fix: icon + word + tone; cancelled neutral ⊘; partial warn only with an open claim.

**orders-35 · P3 · Date-time format.** `formatDateTime` renders "9:00 ,25.10.2026". Fix: "25.10.2026 · 09:00" inside `<time datetime>`.

---

## 5. Big moves

1. **"רשימת ההזמנה" — order guide + one-tap fill (mobile, PT1/PT2/PT4).** BUILD opens on the supplier's guide derived from the last 8 POs, grouped by shelf/category, each row with "אחרון 6 · בד״כ 5 · ₪12.40/ק״ג" and a 48 px stepper; ⋮ "כמו בפעם הקודמת / כמות רגילה" with Undo; "שכחת משהו?" card at review for items in ≥3 of the last 4 POs; keypad sheet for kg. Sticky cart bar, bottom nav hidden. Target: 10-line routine order in ≤9 taps / ≤45 s with no keyboard. No schema (par storage later is a human PR). *Exemplar:* Choco order guides, R365 Autofill, US Foods "Did you forget".
2. **"להזמין היום" — cut-off board and multi-supplier session (manager + chef home and `/orders/new`).** Suppliers due today sorted by cut-off with countdown chips (warn ≤3 h, danger ≤30 min), "הזמנה אחרונה" context, one cart across suppliers that splits into N POs on "שלח הכל (3 ספקים)", each group with its delivery-day chips and reasoning line. Reminder deep links land on the supplier's guide. *Exemplar:* Rekki cut-offs, Ordermentum reminders, R365 multi-vendor.
3. **Team ordering + WhatsApp-native send.** Chef/receiver build a "בקשת הזמנה"; the manager gets "ממתינות לשליחה (2)" with one-tap send; sending offers "מהוואטסאפ שלי" (wa.me prefilled with the exact document) next to platform email/WhatsApp, always after the literal preview, with a 10 s "בטל שליחה". Shares from WhatsApp by any role land as a request, not a 404. *Exemplar:* Choco Team Order, Superhuman Undo Send.
4. **The PO as a living object (closes the loop to the ₪).** Detail = object header (#ref, supplier, state-driven primary) + timeline (נשלח → נפתח → אושר עם שינויים → התקבל → חשבונית הותאמה) + 3-way table (הוזמן · אושר · התקבל · חויב · פער ₪) + "נתפס ₪184 בהזמנה הזו" (T3) + history. Supplier changes get "קבל שינויים" (revised expectation = human PR), edit-until-cut-off, cancel-notifies-supplier, "הזמן שוב". *Exemplar:* Ramp bill 3-way states, Rekki receipts, Sysco substitutes.
5. **Desktop purchasing cockpit (owner, multi-branch).** 1600 px master-detail: saved views with counts in the URL, search by supplier/#ref/product, sortable sticky table with confirmation/receipt/invoice/leak columns, Σ footer, bulk send/export, peek on row, j/k/Enter, branch scope "כל הסניפים", and a branch × supplier weekly spend/accuracy matrix. *Exemplar:* Linear views, Shopify order views, Choco Web Deliveries report.
6. **Capture 2.0 — any message in, a structured PO out.** Clipboard one-tap, auto-parse from share, inline mapping with suggested match and basis, contract-price badges per parsed line, hold-to-talk Hebrew voice note and photo of a handwritten sheet into the same `captureFromText` pipeline; always confirm before write. Hebrew-first parsing is a moat the English-first leaders lack. *Exemplar:* Choco OrderAgent / VoiceAgent, Rekki Connect.

---

## 6. Quick wins (≤1 day each, no immutable files)
1. `new/page.tsx`: accept `?supplier=` alias (orders-05).
2. Show `#poRef` on the detail header, list and phone card; one format with the dock slip (orders-12).
3. "הזמן שוב" on the detail page via `?from=<poId>` prefill (orders-02 v1).
4. Always render the outgoing-document preview in REVIEW; CTA names supplier + channel (orders-08 v1).
5. Move "ביטול הזמנה" into overflow; confirm names supplier + ₪ + date (orders-13 v1).
6. Add Orders to the manager bottom bar (orders-16).
7. `type="text" inputMode="decimal"` + select-on-focus on qty/price (orders-23).
8. "לא כולל N שורות ללא מחיר" next to the estimated total (orders-24).
9. `loading.tsx` for the three orders segments; detail 404 only on NOT_FOUND (orders-26).
10. Swap `ring-primary/60` / ghost `ring-line` for `--c-focus` (orders-20).

## 7. Governance notes (AGENTS.md)
- **Human PR:** revised supplier-confirmed quantities per line (orders-10 storage), supplier MOV/fee (orders-33), par levels (future guide v2), any change to reminder scheduling in `apps/worker/src/cron.ts` or delivery in `notifications/outbox.ts` (the orders-05 fix avoids both).
- **Agent-safe with review:** new procedures `orders.orderGuide`, `orders.supplierBoard`, `orders.createDraftRequest`, `orders.addOrderLine`, `productId` in `updateOrderLine` — each needs an **added** COVERAGE entry in `cross-tenant.attack.test.ts` and a `tenant-security-warden` pass; `lib/roles.ts` change for the chef.
- **Money:** all ₪ via `formatIls()` wrapped in `<Money>`; agorot-exact totals already in `order-logic.ts` — no engine change anywhere in this area.
