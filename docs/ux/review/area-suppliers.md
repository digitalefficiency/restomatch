# Area review: Suppliers, supplier hub and leak card, ledger, contracts and price alerts

**Area key:** `suppliers` · **Reviewer date:** 2026-10-25 · **Checkout:** `main` @ `8fef118c` (`.../scratchpad/ux/wt`)
**Routes:** `/dashboard/suppliers` (+ `?view=scores`), `/dashboard/suppliers/[id]` (+ `?tab=details|catalog|schedule|orders|contract|leak|ledger`), `/dashboard/suppliers/[id]/leak-card`, `/dashboard/suppliers/ledger`, `/dashboard/contracts` (+ `?tab=contracts|alerts|thresholds`), `/dashboard/contracts/import`
**Personas:** owner and bookkeeper at a desk (vendor management, month close); manager on a phone (quick lookups: call, cut-off, "what should this cost?").
**Screenshots read (17):** every file listed for this area in `areas-slim.json`, plus crops in `review/crops/` (`sup-list-phone.png`, `sup-phone-top.png`, `sup-phone-mid.png`, `supid-phone-top.png`, `supid-desk-hdr.png`, `ledger-cells.png`, `ledger-foot.png`, `contracts-row.png`, `contracts-over.png`, `contracts-phone-table.png`, `contracts-phone-over.png`).
**Crawl metrics:** all 17 captures 200, no console errors, no axe violations, no page-level overflow. Small targets (<24 px): suppliers 3, supplier hub 11, ledger 14 (desktop) / 5 (phone), contracts 5, import 4. Load 1.4–1.8 s in the lab.
**Not captured, reviewed from code only:** the scorecards tab, the hub's catalog / schedule / orders / contract / leak / ledger tabs, the A4 leak card, the price-alerts and thresholds tabs, and every empty / error / loading state.

---

## 1. Verdict

Behind these screens sits a lot of real machinery: a delivery-note-vs-invoice ledger that understands consolidated invoices, a 90-day leak card per supplier, contract prices with an over-contract detector, price-trend alerts that name a cheaper supplier, order windows with cut-offs, and an import wizard that reports skipped rows. **The presentation and the information architecture hide almost all of it.**

- The **suppliers page is a contact-card CRUD list** with no ₪ on it at all: no spend, no leak, no open credits, no next delivery. The page that should answer "who is costing me money?" puts that answer in a second tab. That tab shows percentages only, sorted by match-run count.
- The **supplier hub opens on an edit form**. The money tabs ("דליפה", "כרטסת") are positions 6 and 7 of 7, off-screen on a phone. The header shows a ₪ figure ("שולם מעל המחיר החציוני") computed on a different basis from the "דליפה" tab and the ledger on the same page.
- The **ledger is the bookkeeper's tool, but the bookkeeper cannot get to it.** Their nav has no link to it. Its breadcrumb and every row link point to pages the bookkeeper is not allowed to open, so the middleware silently bounces them to `/dashboard`. Meanwhile the **receiver** can see every supplier's spend and leak there.
- **Contracts and price alerts** lead with the static reference table. The act-now money (₪152.50 billed over contract, price rises) sits below it or in a second tab, with **no action to resolve it**: no "add to the credit claim", no "update the contract", no "order from the cheaper supplier". Dismiss (✕) is the only verb.
- **Mobile is read-only and not thumb-first.** Phone numbers are plain text (and render as "972521110104+"). There is no tap-to-call or WhatsApp. Contract and over-contract tables scroll sideways and hide the ₪ column and the row actions.

**Scores vs world-class** (Ramp vendor pages and Price Intelligence, Rillet/Linear-grade dense tables, Rekki supplier profiles, xtraCHEF Price Tracker, MarginEdge statement reconciliation):

| | Score | Why |
|---|---|---|
| Mobile | **3.5 / 10** | No quick actions; the hub is a form; tables scroll sideways and hide the ₪; the money tabs are off-screen; contact data isn't tappable |
| Desktop | **4.5 / 10** | No vendor table, sort, totals or drill-down; the hub has no overview; contracts bury the act-now ₪; tables are left/start-aligned in mono |
| Functionality | **5.5 / 10** | Strong data model (ledger, leak card, contracts, alerts, order windows), but dead ends: no resolution actions, no statement upload, no PDF price lists, no sending to the supplier, and the bookkeeper is locked out |

Pilot bar: **not met.** There are three P0s: the bookkeeper/receiver ledger dead end, the unexplained ₪ lines on the supplier-facing leak card, and the conflicting ₪ definitions in the supplier header.

---

## 2. Primary tasks walked end to end

| # | Persona / device | Task | Today | World-class target |
|---|---|---|---|---|
| T1 | Manager · phone | WhatsApp the fish supplier about today's delivery | ≡ → ספקים (not in the bottom bar) → scroll to the card → the number is plain text → tap "עריכה" → long-press the number inside the form input → copy → open WhatsApp → paste. **≈8 actions plus a copy-paste.** | Search "דג" → [WhatsApp] on the result, or [WhatsApp] on the supplier card: **2 taps** (Rekki supplier profile; iOS contact card) |
| T2 | Manager · phone | "When is HaKerem's cut-off?" | ≡ → ספקים → HaKerem → scroll the tab strip → "לוח הזמנות" → read form controls (checkboxes, a time input, a select). **5 taps, no plain sentence.** | The supplier row says "הזמנה עד ב׳ 12:00 · משלוח ג׳ 09:30" and a "נסגר בעוד 2:10" chip: **0 taps** (Rekki, Ordermentum) |
| T3 | Owner · desktop | "Which supplier costs me the most?" | ספקים → "דירוג ספקים" tab → % only, sorted by match-run count, first 9 (load more) → no ₪ → leave for /leaks and group by supplier. **Not answerable in this area.** | Supplier table sorted by דליפה ₪ desc on load: **0 clicks** (Ramp Vendors list; systems.md P12) |
| T4 | Bookkeeper · desktop | Close October for חלבות הגליל (notes vs invoices vs statement) | No nav entry → type the URL → grid → click the supplier → **silently bounced to /dashboard** (the hub is owner/manager only). The per-supplier ledger with "זיכוי שנדרש / שולם / יתרה פתוחה" is unreachable. No statement upload. **Dead end.** | כסף › כרטסת ספקים (1 click) → cell → per-supplier drawer with notes / invoices / credits / payments / statement lines in four reconciliation tabs (QuickBooks bank feed; MarginEdge statements) |
| T5 | Owner · desktop | Act on "₪152.50 billed over contract" | חוזים → scroll past every contract row → the over-contract table → click HK-24108 → invoice page → no claim action here either → navigate to leaks/claims. **4+ clicks and 2 page loads, with no single "claim it" action.** | Over-contract row → [הוסף לדרישת זיכוי · ₪100] or [עדכן מחיר חוזה ל-₪149]: **1 click, optimistic + Undo** (Ottimate Contract Pricing → Needs Attention) |
| T6 | Owner · desktop | Respond to "סלמון +18% in 3 weeks" | חוזים → "התראות מחיר" tab → read the card → the only action is ✕ (dismiss, no reason, no undo). The "cheaper at X" hint has no action. | The card shows ₪/month impact with [בקש מהספק להחזיר מחיר] [עבור ל-X] [קבע כמחיר חוזה] [דחה ▾ reason chips] (Ramp Price Intelligence; xtraCHEF Price Tracker) |
| T7 | Owner · desktop | Load a new supplier's price list (they sent a PDF on WhatsApp) | Import accepts **XLSX/CSV only**. Fallback: add contract prices one by one (supplier select → product select over the whole catalog → `type=number` price → dates → save) **≈7 interactions per product**. | Drop a PDF or photo → OCR → mapped rows → a **diff vs current contract and last invoice** (old → new, ₪/month) → commit (Rekki Connect reads PDF price lists; Choco) |

---

## 3. Findings

Severity is the review scale (P0 blocks or misleads a core task, money or trust; P1 major friction or below benchmark; P2 polish; P3 nit). Rubric IDs are in brackets. "humanPR" means the fix touches an AGENTS.md immutable file.

### P0

**SUP-01 · P0 · flow/ia · `/dashboard/suppliers/ledger` · bookkeeper, receiver · desktop+phone**
*Problem.* The ledger is the bookkeeper's month-close tool, yet:
- (a) no nav item links to it. The only link is a button inside the supplier hub's ledger tab (`suppliers/[id]/tab-ledger.tsx:16`), and the hub is owner/manager only (`lib/roles.ts:64`).
- (b) The breadcrumb points to `/dashboard/suppliers` (`ledger/page.tsx:30-33`).
- (c) Every supplier link goes to `/dashboard/suppliers/{id}?tab=ledger` (`ledger-ui.tsx:292`).

For bookkeeper and receiver, (b) and (c) are silent middleware bounces to `/dashboard` [D7, D5]. The per-supplier ledger (`SupplierLedgerTable`, `ledger-ui.tsx:95-226`) holds the bookkeeper's real columns: זיכוי שנדרש, שולם, יתרה פתוחה, and the note-to-invoice drill-down. It is therefore unreachable for the persona it was built for. Screens: `dashboard_suppliers_ledger__receiver__desktop-he.png` shows the receiver nav (סקירה · קליטת סחורה · הגדרות) with no path, plus the breadcrumb "ספקים".
*Fix.*
- Add "כרטסת ספקים" to the nav for owner/manager/bookkeeper (the "כסף" group per exec-desktop.md §IA).
- Make each grid cell and each supplier name open the per-supplier ledger in a **520 px inline-end drawer** (`?sup=<id>&m=YYYY-MM`) inside the ledger route, reusing `SupplierLedgerTable`, so no route change and no role bounce.
- Breadcrumbs render a non-link label when `canSeeRoute` is false.

*Exemplar:* QuickBooks Online vendor ledger drill (report → transaction) and Stripe balance → itemised transactions [exec-desktop P4/P13].

**SUP-02 · P0 · trust · `/dashboard/suppliers/[id]?tab=leak` and `/leak-card` (A4 card handed to the supplier) · owner, manager · both**
*Problem.* The "5 השורות הגדולות" list shows only the item, the discrepancy type, the invoice # and a red ₪ (`leak-card-view.tsx:133-153`). There is no expected price/qty, no charged price/qty and no rule. The card is a **client-facing negotiation artifact** (`leak-card/page.tsx`), so the supplier cannot verify a single line, and the owner cannot defend one. Rubric H1 rates any flag with a ₪ but no expected-vs-charged basis as S0. The escalator applies because this is a client-facing artifact.
*Fix.* Each line renders the ₪ math in one line: `מחיר הזמנה ₪89.00 · חויב ₪96.00 × 7.5 ק״ג = ₪52.50`, from the discrepancy's expected/actual fields (already on the breakdown rows used by `topLeakLines`). Add one footer line naming the rule source ("מחיר חוזה מ-19.10" / "מחיר בהזמנה"). Keep the agorot integer path. Display only, so no engine change.
*Exemplar:* Stripe Radar risk insights (signals beside the score); Brex line-item explanations [H1].

**SUP-03 · P0 · trust · `/dashboard/suppliers/[id]` header · owner (and manager) · both**
*Problem.* One page shows three "leak" numbers with three different definitions:
- The header: "שולם מעל המחיר החציוני (30 יום)" ₪73, built from `owner.leaks` price-history rows (≥5% above baseline, top 100 rows by Δ%, then filtered to the supplier) (`[id]/layout.tsx:46-66`).
- The "דליפה" tab: 90-day engine discrepancies (`leak-card-data.ts:233-261`).
- The ledger tab: engine leak per calendar month, with the footnote "הדליפה זהה לסייר הדליפות".

The header comes from a different engine. Its `limit: 100` cut can **under-count or blank** a supplier in a larger restaurant. It is warn-orange and clickable to nothing. For managers it prints "אין מספיק נתונים" even when data exists, because the figure is owner-only (`layout.tsx:57`) [A9, A4, A1]. Screens: `dashboard_suppliers_ID__owner__desktop-he.png` (header ₪73), `supid-desk-hdr.png`.
*Fix.*
- The header shows **the same figure as the Leak tab** ("דליפה · 90 יום" from `leakGrouped` by supplier, agorot-exact), with a tertiary link "איך הגענו ל-₪X?" to the leak tab.
- Move the median-based "שולם מעל המחיר הרגיל" into the price section as a separate, explicitly labelled insight.
- For managers, show the figure (it is finance data they already see in /leaks), or render a T4 "זמין לבעלים" with a lock icon. Never "אין מספיק נתונים" for a permission gap.

*Exemplar:* Stripe balance states (each number defined once) [A9].

### P1

**SUP-04 · P1 · ia/flow · `/dashboard/suppliers/[id]` · owner, manager · both**
*Problem.* The hub defaults to `?tab=details`, an edit form (`[id]/page.tsx:150-154`). From search, an order breadcrumb or the list, the first screen is a form with seven inputs and seven day checkboxes. There is no answer to "what do I do with this supplier now?": no open ₪ to claim, no invoices awaiting approval, no over-contract lines, no next delivery or cut-off, no last order, no spend trend, and no header actions (call, WhatsApp, new order, print card). The demo's own mock profile (`app/showcase/dashboard/suppliers/[supplierId]/page.tsx:150-260`: actions, KPIs, price trends, recent invoices, activity) promises more than the product delivers. Screens: `dashboard_suppliers_ID__owner__desktop-he.png`, `..._phone-he.png`.
*Fix.*
- Add a default **"סקירה"** tab (see Big move 1). Header: name · status · one T1 ₪ (per SUP-03) · [WhatsApp] [התקשר] [הזמנה חדשה] (the primary is the new order).
- An act-now row with up to 3 items: "₪X פתוח לדרישה" → claims filtered by supplier; "₪Y מעל חוזה" → contracts filtered; "N חשבוניות ממתינות לאישור · ₪Z" → approvals `?sup=`.
- Then "המשלוח הבא: ג׳ 09:30 · הזמנה עד ב׳ 12:00", a spend sparkline for 6 months, the last 5 invoices, and the price movers.
- Details become the last tab.

*Exemplar:* Ramp vendor detail (spend, bills, contracts, owner on one page); Rekki supplier profile (cut-off up front); restaurant.md "Supplier hub act-now row".

**SUP-05 · P1 · ia/visual · `/dashboard/suppliers` · owner · desktop**
*Problem.* The page lists 11 contact cards about 100 px tall (`manager.tsx:161-175`, `SupplierRow` 180-261) with ח.פ., email, WhatsApp, terms and delivery, and **no ₪ anywhere**. There is no sort or column structure, and rows with long delivery text wrap their actions onto a second line, so button positions jump (`dashboard_suppliers__owner__desktop-en.png`: HaSharon, Brenner). The insight ("who adds hidden costs") lives in the second tab, which is not the default (`page.tsx:50-54`). An owner managing 10–40 suppliers cannot compare them [C1, C3, B6, A5].
*Fix.* Replace the card list at ≥1024 px with a dense sortable table, 48 px rows (owner) or 36 px (bookkeeper):

ספק · רכש החודש ₪ · דליפה 90 יום ₪ (default sort desc, `aria-sort`) · מעל חוזה ₪ · פתוח לדרישה ₪ · משלוח הבא / סגירת הזמנה · תנאי תשלום · סטטוס

- Totals row.
- Row click → split detail (Big move 2).
- Keep the cards below `md` (SUP-07).
- Fold the scorecards into columns and drop the separate tab.

*Exemplar:* Ramp Vendors table; Linear list + peek; systems.md P12 ("suppliers: leak ₪ descending").

**SUP-06 · P1 · functional · `/dashboard/suppliers?view=scores` · owner · desktop**
*Problem.* The scorecards show runs, clean-match %, average price Δ % and duplicates. That is **% only, no ₪** (`list.tsx:222-238`). They are sorted by match-run count (`packages/charts/src/suppliers.ts:150`) and paged at 9 with "load more" for an 11-supplier tenant (`list.tsx:170`). Tone thresholds are hard-coded (clean ≥80, Δ >3%) with no ₪ materiality [A5, North Star]. The jargon "השוואות (match runs)" is in the Hebrew empty state (`messages/suppliers/he.ts:16`).
*Fix.* Each scorecard metric gets its ₪ ("סטיית מחיר +4.2% · ₪380 ב-90 יום"). Sort by leak ₪ desc. Page at 20. Replace "match runs" with "בדיקות חשבונית". Better still, merge into the SUP-05 table. FG-32 adds fill rate, on-time % and days-to-credit; that charts SQL is owned by `matching-engine-guardian`.
*Exemplar:* xtraCHEF Price Tracker (% and $ impact per vendor); Choco Deliveries report.

**SUP-07 · P1 · functional · `/dashboard/suppliers`, `/dashboard/suppliers/[id]` · manager · phone**
*Problem.* No contact data is actionable. WhatsApp and email are plain spans (`manager.tsx:223-226`); in the hub they sit inside `<input>`s. There is no `tel:`, `https://wa.me/` or `mailto:` anywhere in the area. Cards show no next delivery, cut-off or "delivers today". The list is alphabetical (`routers/suppliers.ts` `orderBy(asc(name))`). Only one supplier fits above the fold at 390×844 (`sup-phone-top.png`) [G10, D1].
*Fix.*
- Phone card anatomy:
  - Line 1: name, plus a status chip ("מגיע היום 09:30" / "הזמנה נסגרת בעוד 1:40").
  - Line 2: "פתוח לדרישה ₪X" (when > 0).
  - A bottom row of 48 px icon+label buttons: [WhatsApp] [חיוג] [הזמנה].
- Sort: delivering today → cut-off soonest → rest.
- Name/row tap opens a bottom-sheet peek (85vh) with the overview, not the edit form.

*Exemplar:* Rekki supplier list and profile; iOS Contacts quick actions; ordering-mobile.md P4 (suppliers sorted by cut-off).

**SUP-08 · P1 · ia · `/dashboard/contracts` · owner, manager, bookkeeper · both**
*Problem.* The page opens on "מחירי חוזה", the static reference table (`contracts/page.tsx:71-75`). The act-now money, "מעל החוזה — 90 הימים האחרונים ₪152.50", renders **below the whole contract table** (mt-10). With 10 rows it is already at y≈1330 on desktop and y≈2660 on a phone; with a real 200-row price list it is effectively invisible. Price alerts (the badge "1") sit in tab 2 [A5, A8]. Screens: `dashboard_contracts__owner__desktop-he.png`, `..._phone-he.png`.
*Fix.* Restructure into one first tab "לטיפול" that leads with the act-now queue:
- over-contract lines and open price alerts as unified cards, ranked by ₪;
- header "₪152.50 חויבו מעל החוזה · 2 שורות · 1 התראת מחיר";
- then the tabs "מחירי חוזה" · "ספי התראה".

When the queue is empty, show a T3 line: "כל החשבוניות ב-90 יום תאמו את החוזה ✓".

*Exemplar:* Ottimate Contract Pricing "Needs Attention"; Ramp Inbox (act-now first).

**SUP-09 · P1 · functional · `/dashboard/contracts` over-contract table · owner, manager · desktop**
*Problem.* Each over-contract line (`over-contract.tsx:322-351`) is a dead end. Its only link is the invoice number. There is no action to add it to a credit claim, accept the new price as the contract, or mark it "approved exception". Columns show the unit prices, but qty has no unit ("10", "7.5") and the "חויב" column doesn't say it is per unit, so `(149−139)×10=₪100` must be inferred [H1, C2, E9].
*Fix.*
- Per row: a primary [הוסף לדרישת זיכוי · ₪100.00], plus "⋯" holding [עדכן מחיר חוזה ל-₪149.00] and [אשר כחריגה (סיבה)]. Optimistic, with a 10 s Undo (R-7/R-8).
- Multi-select batch bar: "3 נבחרו · ₪212.50 · [הוסף לדרישה]".
- Column labels: "מחיר חוזה ליח׳", "חויב ליח׳", "כמות (ק״ג)".
- A row line "₪149.00 − ₪139.00 = ₪10.00 × 10 ק״ג".

*Exemplar:* Ottimate contract-pricing exceptions; Ramp Price Intelligence; Cut+Dry "Request a credit".

**SUP-10 · P1 · functional · `/dashboard/contracts?tab=alerts` · owner, manager · both**
*Problem.* An alert card has a headline (product, %, period, supplier), a start → end unit price in danger mono, and a "זול יותר אצל X" hint (`alerts-panel.tsx:105-171`). It is missing:
- the **₪ impact per month** at current volume;
- the contract price and the 90-day median;
- any action except ✕ dismiss (`:139-148`), which has no reason and no undo;
- an action on the cheaper-supplier hint.

Every alert is danger-toned regardless of size, and the overview teaser is danger-bordered (`overview-card.tsx:147`). That contradicts the materiality rule (T2 only at ≥3% and ≥₪50/month) and invites alarm fatigue [A5, H1, H6, R-8]. The "בדיקה עכשיו" technical action is a visible secondary button [E9].
*Fix.*
- Card anatomy:
  - Claim: "סלמון התייקר 18% ב-3 שבועות".
  - Math: "₪6.20 ← ₪7.32 · חוזה ₪6.40 · חציון 90 יום ₪6.25".
  - Impact: "≈₪212 בחודש בכמות הנוכחית (הערכה)".
  - Actions: primary [בקש מהספק את המחיר הקודם] (WhatsApp template, deferred send); "⋯": [קבע כמחיר חוזה] [הזמן מ-X (₪6.05)] [דחה ▾ chips: עליית מחיר מוסכמת / עונתי / אחר].
- Tone by materiality: below the floor, neutral T4.
- Move "בדיקה עכשיו" into overflow.

*Exemplar:* Ramp Price Intelligence (benchmarks + renewal context); xtraCHEF Price Tracker ($ impact); Ramp "policy is wrong" learning loop.

**SUP-11 · P1 · rtl · `/dashboard/contracts` (all tables), price alerts, thresholds · all · both**
*Problem.* Money is wrapped as `<bdi dir="ltr">{formatIls(...)}</bdi>`, which renders the he-IL string as "62.00₪" with the ₪ on the wrong side and no gap. Sites:
- `contracts-panel.tsx:266`;
- `over-contract.tsx:237, 261, 290, 343, 346, 349`.

Signs are concatenated as `+{formatIls}` (`over-contract.tsx:261, 349`; `alerts-panel.tsx:110`; `thresholds-panel.tsx:160`). Confirmed on screen in `contracts-row.png` ("62.00₪") and `contracts-over.png` ("+ 100.00₪") [E4 S1, rule 6]. Everywhere else in the app shows "₪ 62.00".
*Fix.* Replace these with `<Money>` (a plain `<bdi className="tabular-nums">`) and take signs from Intl `signDisplay:'exceptZero'`. Adding that option to `formatIls()` is a **human PR** (money-format util, immutable); until then render the sign as a separate word chip ("מעל ₪100.00"), not "+".
*Exemplar:* ICU he-IL output; Intuit content design for signed currency.

**SUP-12 · P1 · functional · `/dashboard/contracts` add/edit, thresholds · owner, manager · both**
*Problem.* Contract-price entry uses `type="number"` (`contract-form.tsx:144-153`; inline edit `contracts-panel.tsx:254-264`; thresholds `thresholds-panel.tsx:219-244`). A scroll wheel changes the price, and on many Hebrew/Android keyboards the decimal comma is rejected before `parsePrice()` (which correctly accepts "12,5") ever sees it [C7 S1, explicitly "contracts"]. The product picker is a native `<select>` over the whole catalog with no search (`contract-form.tsx:110-141`). Nothing shows what you pay today (last invoice price) while you type the contract price.
*Fix.*
- `type="text" inputMode="decimal" dir="ltr" autocomplete="off"`, formatted on blur, with the ₪ adornment outside.
- Product: a combobox with Hebrew normalisation (D4 `normalizeHe`).
- Under the price field: "מחיר אחרון בחשבונית: ₪96.00 (20.10) · חציון 90 יום ₪91.40".
- Add a one-click **"נעל מחירים נוכחיים כחוזה"** per supplier (last invoice price per product → draft contract rows to confirm).

*Exemplar:* Stripe CurrencyField; Ramp intake prefill.

**SUP-13 · P1 · trust · `/dashboard/contracts/import` · owner, manager · desktop**
*Problem.* The map step shows the column mapping and 6 raw sample rows, then commits "ייבוא N שורות" (`import/wizard.tsx:263-358`). It shows no **diff against the current contract prices**: how many prices rise or fall, by how much, the ₪/month effect, or which rows replace existing contracts. Only after commit does it say "updated: N". Contract prices define what counts as leak, so a silently wrong import changes the North-Star number. Formats are XLSX/CSV only (`:237`), but Israeli suppliers mostly send PDF or WhatsApp photo price lists.
*Fix.*
- Insert a "בדיקה" step: a table of `מוצר · חוזה נוכחי · חדש · Δ% · ₪/חודש` with filter chips (עליות 12 · ירידות 3 · חדשים 5 · לא זוהו 2), per-row exclude, and a commit button that names the effect: "עדכן 15 מחירים · +₪340/חודש".
- Accept PDF and images through the existing OCR pipeline (owner `ocr-procurement-engineer`).

*Exemplar:* Rekki Connect (reads PDF/CSV/SMS price lists); Ramp Price Intelligence renewal diff.

**SUP-14 · P1 · trust · `/dashboard/suppliers/ledger` · receiver · both**
*Problem.* `ROUTE_ROLES['/dashboard/suppliers/ledger']` includes `receiver` (`lib/roles.ts:65`), and `suppliers.ledgerGrid` is `invoiceReaderProcedure`. The door worker therefore sees every supplier's monthly spend and leak ₪, and can export the CSV (`dashboard_suppliers_ledger__receiver__desktop-he.png`). The same role is denied `/dashboard/leaks` and the supplier header ₪. That contradicts roles.ts's own comment ("A receiver sees only the overview + receiving inbox — least privilege") [D1, D7].
*Fix.* Remove `receiver` from the ledger route and from `ledgerGrid`/`ledger` (move them to `financeProcedure`). If receivers need "delivery notes still waiting for an invoice", give them a ₪-free list on `/dashboard/receiving`. Needs `tenant-security-warden` review; add a coverage assertion in the attack suite (append-only).
*Exemplar:* Ramp role-scoped visibility; Notion/Figma explicit access screens.

**SUP-15 · P1 · visual/functional · `/dashboard/suppliers/ledger` · owner, bookkeeper · desktop**
*Problem.* The grid (`ledger-ui.tsx:229-319`) has:
- no sort, no totals row or column (Σ per month, Σ per supplier), and a fixed 6 months (`ledger/page.tsx:23`);
- no cell drill-down (cells aren't links);
- no "פתוח" marker on the current month;
- "—" fillers for empty months (`:299`);
- uneven column widths driven by chip text;
- amounts in `font-mono`, start-aligned (left in English, so decimals don't align);
- a "מותאם" green chip on every single cell, even next to a red "דליפה ₪152.04". "Matched" reads as "all good" when it only means "all delivery notes were invoiced".

The CSV omits זיכוי שנדרש and שולם, which exist in the per-supplier ledger (`:246-254`) [C1 S1 ledgers, C3, B4, A4, C11]. Screens: `dashboard_suppliers_ledger__owner__desktop-he.png`, `ledger-cells.png`, `..._desktop-en.png`.
*Fix.*
- Compact 36 px density for the bookkeeper. Totals row and column. Sortable supplier column and per-month ₪.
- A period picker (`?from=&to=`, up to 24 months, allowed by the router).
- Cells: invoiced ₪ (Heebo tabular, physically right-aligned, decimals aligned), leak as a small danger number only when > 0, and the status chip **only when it is not clean** ("3 תעודות ללא חשבונית", "הפרש ₪X"). Clean months stay plain.
- Rename "מותאם" to "כל התעודות חויבו".
- Blank cells for no activity.
- Click a cell → the drawer from SUP-01.
- The CSV includes every per-supplier column.

*Exemplar:* Rillet/Linear dense tables; Primer DataTable; QuickBooks bank-feed states.

**SUP-16 · P1 · visual · `/dashboard/contracts`, `/dashboard/suppliers/ledger` · owner · phone**
*Problem.* Contract, over-contract and ledger tables keep `min-w-[760px]` and scroll sideways inside a card (`contracts-panel.tsx:194-195`, `over-contract.tsx:306-307`, `ledger-ui.tsx:277-278`). On a 390 px phone:
- the contracts table shows supplier · product · a clipped price (`contracts-phone-table.png`); unit, validity and edit/delete are off-screen with no affordance;
- the over-contract table shows invoice · date · supplier · a clipped product, and **the ₪ over-contract column is not visible at all** (`contracts-phone-over.png`);
- the ledger shows 2 of 6 months [C3, A8 "never push ₪ off-screen"].

*Fix.* Below `md`, render cards:
- Contract: line 1 product + "₪62.00 / ק״ג" at the end; line 2 supplier · "מ-19.10" · status chip; "⋯" menu (48 px).
- Over-contract: line 1 product + "מעל ₪100.00" (danger); line 2 "חוזה ₪139 · חויב ₪149 × 10 ק״ג"; [הוסף לדרישה].
- Ledger: one card per supplier showing the latest 2 months and a "6 חודשים ←" sheet.

*Exemplar:* Polaris IndexTable condensed; BILL mobile cards.

**SUP-17 · P1 · functional · `/dashboard/suppliers/[id]?tab=leak`, `/leak-card` · owner · both**
*Problem.* The leak card's T2 CTA "למכתבי התביעה" links to `/dashboard/leaks/claims` **unfiltered** (`leak-card-view.tsx:102`), so the user lands on every supplier's letters. The only output is print/"save as PDF" (`leak-card/page.tsx:411-419`). Nothing shares or sends it to the supplier: no WhatsApp, no email, no tokened link, no record that it was sent. The words "תביעה / לתביעה" mean lawsuit to an owner. The glossary term is "דרישה" (`messages/suppliers/he.ts:144,146`) [E9, C10, FG-31].
*Fix.*
- The CTA goes to `/dashboard/leaks/claims?sup=<id>`, labelled "פתח דרישת זיכוי · ₪X".
- Add [שלח לספק ב-WhatsApp] with a preview of exactly what the supplier receives, then a deferred send with "בטל שליחה" (R-8). It produces a PDF link or a tokened `/s/[token]` view and logs "נשלח ב-…" on the hub.
- Sending goes through the outbox/cron, which is immutable, so the channel is a **human PR**. The UI and preview are in scope.
- Rename the copy to "פתוח לדרישת זיכוי".

*Exemplar:* Choco "Request for Supplier"; Superhuman Undo Send.

**SUP-18 · P1 · ia · `/dashboard/suppliers` and hub · bookkeeper · desktop**
*Problem.* `/dashboard/suppliers` is owner/manager only (`lib/roles.ts:64`). The bookkeeper, who pays suppliers and closes VAT, has **no read view of the vendor master**: ח״פ, payment terms, contact for statements, bank details (not modelled). The search box drops supplier results for them [D7, FG-26, FG-30].
*Fix.* Give the bookkeeper a read-only supplier table and hub (the overview + ledger + documents tabs). Writes stay manager+ (`managerProcedure` already guards them). Show "תנאי תשלום: שוטף + 30 → החשבונית הבאה לתשלום 30.11" using the existing `parsePaymentTerms()` (`suppliers/form-logic.ts`), which today is used only to translate English labels.
*Exemplar:* Ramp vendor records shared across AP and approvers; Bill.com vendor directory.

### P2

**SUP-19 · P2 · rtl · `/dashboard/suppliers` · all · both** — The WhatsApp number renders as "972521110104+". It is interpolated into Hebrew text with no isolation (`manager.tsx:224-226`, `t('manager.whatsapp',{phone})`). Crop `sup-list-phone.png`. The ח״פ is spelled "ח.פ." (`messages/suppliers/he.ts:35,58`) [E3, E7]. *Fix:* wrap phone, ח״פ and email in `<bdi dir="ltr">` as the `<Token>` primitive, link them (`tel:`/`wa.me`), and use "ח״פ". *Exemplar:* Gmail address isolation.

**SUP-20 · P2 · ia · `/dashboard/suppliers/[id]` details vs "לוח הזמנות" · owner, manager · both** — Two schedules for one supplier edited in two places. The "לוח אספקה — ימים ושעת יעד" grid is in the details form (`manager.tsx:383-419`, it drives late-delivery alerts). The "לוח הזמנות" windows (`tab-schedule.tsx`: order days, cut-off, lead days or named day) drive the order wizard. They can contradict each other, and neither shows a plain-language summary. Lead days uses `type=number` (`tab-schedule.tsx:221-231`). Save is disabled with no reason (`:256`) [C6, C12]. *Fix:* one "ימים ושעות" section. Order windows derive the expected delivery, the delivery target time is a field of each window, and a live sentence reads "מזמינים עד ב׳ 12:00 → מגיע ג׳ עד 09:30". The disabled reason is visible text. *Exemplar:* Ordermentum per-supplier cut-off settings; Rekki profile cut-off.

**SUP-21 · P2 · flow · `/dashboard/suppliers/[id]` tab bar · manager · phone** — 7 tabs scroll horizontally; on 390 px "חוזה", "דליפה" and "כרטסת" (the money) are off-screen and unlabeled as scrollable (`tab-bar.tsx:209-236`, `supid-phone-top.png`). *Fix:* reduce to 4–5 tabs (סקירה · מחירים · הזמנות · כרטסת · פרטים) per Big move 1; on phones use a segmented control plus "עוד ▾". *Exemplar:* Material 3 scrollable tabs guidance; iOS segmented controls.

**SUP-22 · P2 · states · `/dashboard/suppliers/[id]?tab=details` · owner, manager · both** — No unsaved-changes guard. Edit the payment terms, tap another tab (a `<Link>`) and the edits vanish silently (`tab-details.tsx`, `manager.tsx:282`). The Save button is `size="sm"` at the bottom of a long form, not sticky on a phone [C5]. *Fix:* a dirty-state guard on tab change and unload ("יש שינויים שלא נשמרו · שמור / בטל"), and a sticky save bar on mobile. *Exemplar:* Primer forms saving pattern; Polaris contextual save bar.

**SUP-23 · P2 · copy · `/dashboard/suppliers/[id]` time inputs · owner, manager · phone** — The native `<input type="time">` rendered "11:00 AM" in the he-IL phone capture (`dashboard_suppliers_ID__owner__phone-he.png`, `manager.tsx:406-412`, `tab-schedule.tsx:199-204`). Native controls follow the device region, not the page locale, so Israeli users on English-region phones see 12-hour time on delivery deadlines [E8]. *Fix:* a custom 24-hour picker: chips 06:00–14:00 in 30-minute steps plus "אחר", or a masked `HH:MM` text input with `inputMode="numeric"`. *Exemplar:* Israeli bank apps (24 h); Apple HIG pickers.

**SUP-24 · P2 · functional · `/dashboard/suppliers` create/edit · owner, manager · desktop** — No validation of ח״פ/עוסק (`maxLength 32`, no 9-digit check-digit test, `manager.tsx:337-347`), no duplicate-supplier detection by ח״פ or name, no phone normalisation ("052-111…" → "+97252111…"), free-text payment terms (the parser exists but isn't used to structure them), a single contact, and no bank details [C6, FG-26, FG-30]. *Fix:* validate the ח״פ check digit ("ח״פ צריך 9 ספרות"); warn "ספק עם ח״פ זה כבר קיים — פתח אותו?"; terms as a structured picker (מזומן / שוטף / שוטף+30/45/60/90 / אחר); a contacts list (הזמנות, הנה״ח, נהג). Bank details are a schema change (human PR). *Exemplar:* Ramp vendor onboarding; Priority vendor master.

**SUP-25 · P2 · states · `/dashboard/suppliers` deactivate · owner, manager · both** — "השבתה" is a ghost button next to "עריכה" on every card. It fires immediately with no confirm and no Undo; the toast has no action (`manager.tsx:75-82, 253-256`). Deactivated cards drop to `opacity-70`, which lowers text contrast (`:201`) [C10/R-8, C12, F2]. *Fix:* move it into a "⋯" menu, apply it optimistically with a 10 s "בטל" toast, and show inactive suppliers as a filtered group with a neutral "לא פעיל" chip at full contrast. *Exemplar:* Superhuman undo; Polaris destructive placement.

**SUP-26 · P2 · copy · area-wide · all · both** — Vocabulary drift:
- "בסייר הדליפות" and "הדליפה זהה לסייר הדליפות" (`messages/suppliers/he.ts:141,203`) vs the nav's "בלש דליפות";
- "תביעה" vs "דרישת זיכוי";
- "שולם מעל המחיר החציוני" vs "דליפה";
- "התאמות נקיות / סטיית מחיר ממוצעת / הרצות התאמה" jargon;
- "השוואות (match runs)" [E9, A9].

*Fix:* one glossary: דליפה · פער · מעל חוזה · דרישת זיכוי · כרטסת. Use the nav name for the leak hub everywhere and drop English jargon from Hebrew. *Exemplar:* Polaris voice and tone; Stripe balance-state glossary.

**SUP-27 · P2 · visual · area-wide money typography · all · both** — Money is set in `font-mono`:
- `[id]/layout.tsx:100`;
- `leak-card-view.tsx:75,94,119,152` (including the T1 hero);
- `ledger-ui.tsx:133-140,182,204,302,304`;
- `contracts-panel.tsx:252`;
- `over-contract.tsx:236,289,339-348`;
- `alerts-panel.tsx:127`;
- `list.tsx:267`.

The ₪ glyph falls back to another font, which shows as a wide gap in `ledger-cells.png`. Money columns are `text-start` (left-aligned in English: `dashboard_contracts__owner__desktop-en.png`, `..._ledger__owner__desktop-en.png`). Hebrew table heads use ungated `uppercase tracking-wider` (`contracts-panel.tsx:197`, `over-contract.tsx:309`, `thresholds-panel.tsx:129`) [B2, B4/R-1, E6]. *Fix:* Heebo `tabular-nums lining-nums` through `<Money>`; a `.num` cell aligned physically right in both locales; `ltr:` gating on tracking and uppercase. Owner: `rtl-design-steward`.

**SUP-28 · P2 · perf/states · `/dashboard/suppliers*` loading · all · both** — `suppliers/loading.tsx:300-303` renders a 3-column grid of 192 px card skeletons for every route under `/dashboard/suppliers`: the CRUD list, the hub form and the ledger table. None of them looks like that. The list then shows a second client spinner, "טוען ספקים…" (`manager.tsx:90-96`). The page always computes the scorecards even when the manage tab is shown (`page.tsx:30`). The hub layout runs `owner.leaks` over the whole restaurant just to read one supplier (`[id]/layout.tsx:58`) [I4]. *Fix:* layout-true skeletons per route (`[id]/loading.tsx`, `ledger/loading.tsx`); server-prefetch `suppliers.list` with `initialData`; fetch scorecards lazily; a per-supplier leak query.

**SUP-29 · P2 · a11y · area-wide · all · both** — The focus ring is `focus-visible:ring-primary/60` on every tab, link and input in the area (`tabs.tsx:147`, `tab-bar.tsx:261`, `manager.tsx:207,249,411`, `contracts/page.tsx:57`, …), measured at 2.7–2.8:1 [F3 S1]. Native `window.confirm` is used to delete a contract price and a threshold rule (`contracts-panel.tsx:121`, `thresholds-panel.tsx:81`) [C10]. Delivery-day checkboxes are 16 px (`manager.tsx:400`, `tab-schedule.tsx:188`), which accounts for most of the 11 small targets on the hub. *Fix:* the `--c-focus` token (R-5); a ConfirmDialog that names the party ("מחק את מחיר החוזה של סלמון אצל דגי הים התיכון"); 24 px checkbox hit areas (44 on touch). *Exemplar:* Primer focus; Stripe Apps confirm.

**SUP-30 · P2 · functional · `/dashboard/contracts` list · owner, bookkeeper · desktop** — The contract list has no sort, no product search, and no grouping by supplier (the supplier name repeats on every row). It has no "פג תוקף בעוד N ימים" warning or expiry sort, although `validTo` exists (`contracts-panel.tsx:283-309`). "בתוקף" plus "ייבוא" chips on every row are noise, and the note "מחירון מוסכם — רבעון 4/2026" repeats on every row. The empty state has no CTA (`:187-192`) [C1, C8, C11]. *Fix:* group by supplier with a collapsible header ("דגי הים התיכון · 4 מחירים · בתוקף עד 31.12"); show chips only for exceptions (upcoming, expired, expiring ≤30 days); product search; sort by expiry; the empty state's primary [ייבא מחירון].

**SUP-31 · P2 · functional · `/dashboard/contracts?tab=thresholds` · owner · desktop** — Thresholds are percentage-only. There is no ₪ materiality floor (rubric A5: ≥3% **and** ≥₪50/month) and no preview of "with this rule, N alerts in the last 90 days". Rules cannot be edited, only replaced by saving the same scope (`thresholds-panel.tsx:196`). Inputs are `type=number` [A5, C7]. *Fix:* add "ורק אם ההשפעה ≥ ₪50 בחודש", a live preview count, and inline edit. *Exemplar:* COGS-Well 3% default alert; Ramp policy simulation.

**SUP-32 · P2 · flow · `/dashboard/contracts/import` · owner, manager · both** — Step 1 is a page with one `<select>` and a disabled "המשך" that gives no reason (`import/wizard.tsx:191-209`, `dashboard_contracts_import__owner__desktop-he.png`). The column-chip label is `text-[10px]` (`:315`). The container is `max-w-3xl`, so the h1 and breadcrumb don't align with other pages (title edge at x=1104 vs 1272) [C6, C12, B1, B9]. *Fix:* merge supplier and file into one step (supplier combobox above the drop zone, auto-suggested from the file name or header); the button stays enabled and errors name the missing field; 12 px floor; the shared page container.

**SUP-33 · P2 · functional · chain · `/dashboard/suppliers`, `/contracts`, `/ledger` · chain owner · desktop** — Every page in the area is single-branch. There is no "all branches" scope to compare the same supplier's prices, leak or ledger across branches, and no chain contract pushed to branches. Switching branch reloads to `/dashboard` and loses the page (ia-map #11) [D8, FG-37]. *Fix:* a branch scope chip (`?b=all`) on the supplier table and ledger, with a "סניף" column; a chain contract price list that branches inherit. Each query stays inside `withRestaurant` (tenant-security-warden review). *Exemplar:* Choco Deliveries report across locations; Toast Location Overview.

### P3

**SUP-34 · P3 · copy · area-wide** — Tenant units typed with ASCII quotes display as-is ("ק"ג" in `contracts-row.png`). The current month in the ledger has no "פתוח · עד 25.10" eyebrow. The hub `h1` truncates long supplier names with no `title` (`[id]/layout.tsx:83`) [E7, A2, C1]. *Fix:* normalise ״/׳ at display (`normalizeHe`), add the month-state eyebrow, and add `title` and wrapping on the h1.

**SUP-35 · P3 · states · area-wide errors** — There is no `error.tsx` for `/dashboard/suppliers` or `/dashboard/contracts`. A failing tab bubbles up to the root error page and loses the hub chrome. A panel load error renders a bare red `role="alert"` paragraph at load time (`contracts-panel.tsx:183-186`, `alerts-panel.tsx:93-96`) [C8, F7]. *Fix:* segment error boundaries with "נסה שוב" and a way back; no assertive role on load-time errors.

---

## 4. Big moves (benchmark-grade)

### BM-1 · Supplier 360 ("כרטיס ספק"): the hub opens on what to do now (both)
The default tab becomes **סקירה**, with the rest restructured as follows.

- **Header:**
  - name · status;
  - **one** T1 ₪ "דליפה · 90 יום" (the same figure as the leak tab and ledger);
  - quick actions [WhatsApp] [חיוג] [הזמנה חדשה ●primary] [⋯ הדפס כרטיס / שלח לספק].
- **Act-now row** (T2, up to 3 cards, ₪-ranked): "₪184 פתוח לדרישת זיכוי · 3 שורות", "₪100 מעל חוזה · אנטריקוט", "2 חשבוניות ממתינות לאישור · ₪3,420". Each has one verb and lands in a pre-filtered queue.
- **Rhythm:** "הזמנה עד ב׳ 12:00 (בעוד 2:10) · משלוח ג׳ 09:30 · ההזמנה האחרונה 21.10 ₪2,140".
- **Money:** a 6-month spend sparkline with the leak overlay; a price movers list ("3 מוצרים התייקרו מאז ההזמנה הקודמת · ₪212/חודש"); the last 5 invoices with match chips.
- **Tabs:** סקירה · מחירים וחוזה · הזמנות ומשלוחים · כרטסת · פרטים. Bookkeeper read-only.
- Mobile gets the same content as a single scroll with 56 px quick actions in the thumb zone.
- *Exemplar:* Ramp vendor page; Rekki supplier profile; xtraCHEF Price Tracker; the product's own showcase mock (`showcase/dashboard/suppliers/[supplierId]`).
- *Effort:* M. Composes existing procedures: `leakGrouped`, `contracts.overContract`, `approvals` filtered by supplier, `orders.list`, `previewDelivery`.

### BM-2 · Vendor table + split pane for the desk (desktop)
`/dashboard/suppliers` at ≥1024 px becomes a **400 px list | detail** split:
- Selection lives in the URL (`?sel=`); J/K move through suppliers; Space opens a peek.
- **List columns** (sortable, column chooser): ספק · רכש החודש ₪ · דליפה ₪ · מעל חוזה ₪ · פתוח לדרישה ₪ · יתרה פתוחה ₪ · הזמנה נסגרת · תנאי תשלום · מגמה.
- Default sort is דליפה ₪ desc, with a totals row.
- **Saved views:** "ספקים עם דליפה", "מגיעים היום", "תנאי תשלום ≥ שוטף+60". Views are server-side and shareable.
- Scorecards dissolve into columns.
- *Exemplar:* Linear list + peek; Ramp Vendors; Superhuman J/K.
- *Effort:* M–L.

### BM-3 · כרטסת ספק as a reconciliation workspace for the bookkeeper (desktop)
The ledger moves into the **כסף** nav group and becomes a month-close tool:
- **Grid:** supplier × month with totals, an open-month eyebrow, and exception-only chips.
- **Cell → drawer:** four tabs **לבדיקה · הותאם · ממתין · הוחרג** (rubric C4) over delivery notes, invoices, credit notes and payments.
- **Statement upload:** the supplier's own statement (PDF/XLSX → OCR) is matched line-by-line. Flags: "זיכוי שהובטח וחסר", "חשבונית שלא קיבלנו", "תשלום שלא נרשם". A running remainder "הפרש מול כרטסת הספק ₪X" turns ✓ within `TOTAL_TOLERANCE_ILS` (read from the engine, never redefined).
- **Close:** "סגור חודש לספק" → the month freezes, and later changes show as dated corrections.
- **Export:** "חבילה לרו״ח".
- *Exemplar:* MarginEdge statement tool; Ottimate statement reconciliation; QuickBooks bank feed; Rillet close checklist.
- *Effort:* L. OCR ingest is owned by `ocr-procurement-engineer`; new tables are a schema human PR.

### BM-4 · Price & contract intelligence as one ₪ queue (both)
`/dashboard/contracts` becomes **"מחירים"**, with the first tab **לטיפול**: over-contract lines and price-rise alerts merged into one ₪-ranked queue.
- **Each card:** claim · ₪ math (contract / charged / 90-day median) · ₪/month impact · one primary verb. Resolutions: [הוסף לדרישה] · [קבע כמחיר חוזה] · [הזמן מספק זול יותר] · [דחה ▾ reason chips].
- **Learning:** after 5 consistent overrides, suggest "לעדכן את מחיר החוזה ל-₪X?" (H6).
- **Setup shortcuts:** "נעל מחירים נוכחיים כחוזה" per supplier, and PDF/photo price-list import with a diff-before-commit.
- Materiality-tiered tones (T2 only at ≥3% and ≥₪50/month) and keyboard triage (1/2/3, J/K).
- *Exemplar:* Ramp Price Intelligence; Ottimate Contract Pricing "Needs Attention"; xtraCHEF Price Tracker; Linear Triage.
- *Effort:* M.

### BM-5 · "ספק בכיס": a thumb-first mobile supplier list (phone)
A phone list sorted by **today**:
- "מגיע היום 09:30", "הזמנה נסגרת בעוד 1:40" countdown chips, then the rest.
- Each row: name · next event · open ₪ to claim, with 48 px [WhatsApp] [חיוג] [הזמנה].
- **Peek:** tap → an 85vh bottom-sheet with the last order, the last delivery issues, the contract-price lookup ("כמה אמור לעלות סלמון? ₪89.00/ק״ג · מחיר אחרון ₪96.00") and the open claim.
- **Push:** a cut-off reminder at T-60 deep-links here. The channel and cron are a human PR.
- *Exemplar:* Rekki; Ordermentum cut-off reminders; Choco.
- *Effort:* M.

### BM-6 · Send-and-track negotiation from the leak card (both)
The leak card becomes a **sendable, tracked artifact**:
- Preview what the supplier will see (line-level expected vs charged, per SUP-02), then a deferred send by WhatsApp or email with "בטל שליחה".
- A tokened `/s/[token]` view (reusing the `supplierConfirm` token model) where the supplier accepts or disputes per line and attaches a credit note.
- The status moves claimed → acknowledged → credited, and the hub shows "נשלח 21.10 · נפתח · ממתין לתגובה 3 ימים".
- *Exemplar:* Choco "Request for Supplier"; Stripe Disputes; Superhuman Undo Send.
- *Effort:* M–L. Outbox and cron are immutable, so the send channel is a **human PR**; UI, preview and portal page are in scope.

---

## 5. Rubric scorecard for the area (applicable criteria)

| Criterion | Suppliers list | Supplier hub | Leak card | Ledger | Contracts | Import |
|---|---|---|---|---|---|---|
| A1 one T1 + action | Fail (no ₪) | Fail (3 defs, no action) | Partial | Fail (no T1/totals) | Fail (T2 buried) | N/A |
| A4 zero/unknown | Pass | Fail ("אין מספיק נתונים" for a permission gap) | Pass (T3 clean) | Fail ("—" fillers) | Pass | N/A |
| A5 act-now first, materiality | Fail | Fail | Partial | Fail | Fail | N/A |
| A9 one number | — | **Fail (S0)** | Pass | Partial | Partial | N/A |
| B2 money font | Fail | Fail | Fail | Fail | Fail | — |
| B4 alignment | — | — | Partial | Fail | Fail (en) | — |
| C1 sort/stick/wrap | Fail | — | — | Fail | Fail | — |
| C3 phone cards/totals | Partial (cards, no ₪) | — | Pass | Fail | Fail | — |
| C5/C6 forms | Partial | Fail (no dirty guard) | — | — | Partial | Fail (disabled w/o reason) |
| C7 money inputs | — | Fail (`type=number`) | — | — | **Fail (S1)** | — |
| C10 confirm/undo | Fail (no undo) | — | — | — | Fail (`window.confirm`) | — |
| D5/D7 wayfinding, reachability | Pass | Pass | Pass | **Fail (bounce)** | Pass | Pass |
| E3/E4 bidi, ₪ | Fail (phone "+") | Pass | Pass | Pass | **Fail (S1)** | — |
| E8 dates/time | — | Fail (12 h native) | Pass | Pass | Pass | Pass |
| E9 copy | Partial | Partial | Fail ("תביעה") | Partial ("סייר") | Partial | Pass |
| F3 focus | Fail | Fail | Fail | Fail | Fail | Fail |
| G10 phone desk | Fail | Fail | Partial | Partial | Fail | — |
| H1 explain every flag | — | — | **Fail (S0)** | Partial | Fail (alerts: no ₪ impact) | — |
| H6 disagree / teach | — | — | — | — | Fail (✕ only) | — |
| I4 skeletons | Fail | Fail | — | Fail | Partial | — |

---

## 6. Governance notes (AGENTS.md)

- **Human PR required:**
  - SUP-11: `formatIls()` `signDisplay` option (money-format util).
  - SUP-17 / BM-6: the outbound send channel (`packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts`).
  - BM-5: cut-off reminders (cron).
  - BM-3: statement tables and close state (`packages/db/src/schema.ts` + new migrations).
  - SUP-24: bank-details columns (schema).
  - SUP-14: if it adds an attack-suite coverage entry, that is append-only and goes through `test-sentinel`; changing `invoiceReaderProcedure` usage is a router change for `web-feature-engineer` with `tenant-security-warden` review.
- **Charts SQL** (scorecard ₪ columns, fill rate, on-time) is owned by `matching-engine-guardian`; `web-feature-engineer` consumes it.
- **Engine values** (`TOTAL_TOLERANCE_ILS`, discrepancy types) are only read, never redefined, in BM-3 and BM-4.

---

## 7. Evidence index

- **Code** (repo-relative):
  - `apps/web/app/dashboard/suppliers/{page.tsx,tabs.tsx,list.tsx,manager.tsx,form-logic.ts,loading.tsx,ledger-ui.tsx,ledger/page.tsx}`
  - `apps/web/app/dashboard/suppliers/[id]/{layout.tsx,page.tsx,tab-bar.tsx,tab-details.tsx,tab-schedule.tsx,tab-catalog.tsx,tab-orders.tsx,tab-contract.tsx,tab-leak.tsx,tab-ledger.tsx,leak-card-view.tsx,leak-card-data.ts,leak-card-logic.ts,leak-card/page.tsx}`
  - `apps/web/app/dashboard/contracts/{page.tsx,access.ts,logic.ts,contracts-panel.tsx,contract-form.tsx,over-contract.tsx,alerts-panel.tsx,thresholds-panel.tsx,overview-card.tsx,import/page.tsx,import/wizard.tsx}`
  - `apps/web/lib/roles.ts`
  - `packages/api/src/routers/suppliers.ts`, `packages/api/src/routers/owner.ts`
  - `packages/charts/src/{leaks.ts,suppliers.ts}`
  - `apps/web/lib/i18n/messages/{suppliers,contracts}/he.ts`
  - `apps/web/app/showcase/dashboard/suppliers/[supplierId]/page.tsx`
- **Screenshots:** `.../scratchpad/ux/shots/dashboard_suppliers*`, `dashboard_contracts*`; crops in `.../scratchpad/ux/review/crops/`.
