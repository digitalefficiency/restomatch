# Area review: Leaks (detective, breakdown, claims, proof, monthly leak report)

**Area key:** `leaks` · **Routes:** `/dashboard/leaks`, `/dashboard/leaks/breakdown`, `/dashboard/leaks/claims`, `/dashboard/leaks/proof`, `/dashboard/leaks/report`
**Reviewed:** 2026-10-25 against `RUBRIC.md` v1, the research pack (`exec-desktop.md`, `fintech.md`, `functional-gaps.md`, `ia-map.md`, `erp-modern.md`, `ainative.md`), 17 screenshots and the code on `main` (`8fef118c`).
**Focus:** desktop analysis for the owner and bookkeeper; explainability and trust of every ₪.
**Crops used in this review:** `scratchpad/ux/review/crops/leaks/*` (phone screenshots split into 1700 px slices, plus desktop crops `bd_desk_*`, `cl_desk_*`).

---

## 0. Verdict in one paragraph

This area holds the North Star, "₪ that one owner believes", and it has strong foundations: a proof page that shows the exact agorot, a month drill-down from the hero, supplier letters built from the same query as the hero, a print-ready A4 report and a slice-and-dice explorer. But the owner gets **three different "claimed from suppliers" figures** (₪464 / ₪463.54 / ₪450.88), **a supplier chart whose rows add up to ₪759 under a ₪760 total**, **report tiles that add up to ₪1,056 under a ₪760 headline**, and **no line anywhere that shows "expected vs charged"**, although the API already returns both values. The claim letter is the one artifact a supplier sees. It is print-only, can carry **another branch's name** (`memberships[0]`), merges nothing (the same supplier gets two letters), and leaves the "send → credited" loop to a different page. On a phone, every money table hides its ₪ column behind a horizontal scroll, and the T1 number sits below a 6-row toolbar. On desktop, 13 invoices take 4,210 px as tall cards, and nothing on the explorer is clickable.

**Scores vs world-class (Stripe / Ramp / Mercury / Pigment):** mobile **3.5**, desktop **5.0**, functionality **4.5**.

---

## 1. What the user actually has today (code-verified)

| Route | Who can open it | Data | Actions | States |
|---|---|---|---|---|
| `/dashboard/leaks` (`leaks/page.tsx`, `explorer.tsx`) | owner, manager, bookkeeper. The price-creep "detective" part is **owner-only** and also plan-gated (`analyticsProcedure` = `ownerProcedure + advanced_analytics`, `owner.ts:43,216`) | Explorer: `leakSummary`, `leakGrouped`, `viewOptions`. Over-contract card (90 days). Detective: `owner.leaks` (p90 trigger, median excess, 30-day paid excess) | Gold pill to the report, link to the breakdown, view toolbar (period, compare, group, 5 filters, chart, density, CSV, saved views (localStorage), TV, reset) | Empty (`EmptyState`), entitlement upsell, role card (warn tone). **No `loading.tsx`, no `error.tsx`** |
| `/dashboard/leaks/breakdown` | finance roles | `leakHero` or `leakSummary`, `leakBreakdown` (limit 100/200) | Month prev/next, report, claim letters, per-invoice "לתור האישורים" + "פתח חשבונית", CSV | Empty "אין דליפה בחודש הזה". No loading or error boundary |
| `/dashboard/leaks/claims` | finance roles | `leakHero`, `leakBreakdown`, `myMemberships`, `recovery.list({status:'claimed'})` | **Print all** (one button). Nothing else | Empty state. No month switcher UI (only `?m=`) |
| `/dashboard/leaks/proof` (flag `leakProof`) | finance roles | `leakHero`, `leakBreakdown` → `buildProof` | Print. Per-finding links to the invoice line | Current month only (no `?m`) |
| `/dashboard/leaks/report` | **owner + manager**. Middleware lets the bookkeeper in, then the page shows a role card | `leakReport(month)` (+ the compare month) | Prev/next month, print/PDF, compare, CSV (by-type table only) | Role card (warn tone). Live data with a `new Date()` "generated" stamp; **no freeze** |

Discovered while reading:
- `LeakBreakdownLine` already carries `expected` and `actual` (`packages/charts/src/leak-hero.ts:168-170`). **No page in this area renders them.**
- `claims/page.tsx:56` and `report/page.tsx:86` take `memberships[0]?.restaurantName`. Every other page uses `memberships.find(m => m.restaurantId === session.user.restaurantId)` (for example `dashboard/page.tsx:60`, `invoices/[invoiceId]/page.tsx:52`). `myMemberships` has **no ORDER BY and no active-restaurant filter** (`packages/api/src/routers/onboarding.ts:10-20`).
- The report's "claimed" bucket = `resolution_status IN ('accepted','resolved')` (`packages/charts/src/leak-report.ts:164`). So "טופל" counts as "claimed from the supplier".
- The report compare (`?cmp=prev`) fetches the **full** previous month (`report/page.tsx:52,67-69`). The explorer compare is day-aligned (`leak-views.ts:101`). The two compares disagree.

---

## 2. Primary tasks, walked end to end

### T1. Owner at the desk: "Why ₪760, is it real, and what do I do?" (1440 px)
1. Home hero → "מה מאחורי" → `/leaks/breakdown` (1 click, 1 page load).
2. Scroll 4,210 px of 13 cards. Each line says only "מחיר גבוה מהמצופה · אנטריקוט ₪100.00". **There is no expected/charged/qty math**, so checking it costs "פתח חשבונית" (another page load), then Back.
3. Six invoices show a red **"₪0.00 · אזהרה · חסר בכמות שהתקבלה"** line. The owner can't tell whether that is money.
4. To act: the hero card's gold "מכתבי זיכוי לספקים" (1 click) → 10 letters, 5,162 px → "הדפס / שמור כ-PDF" prints **all 10** (1 click + the browser dialog). Sending happens **outside the app**.
5. To record that a letter was sent, the note says "סמנו 'מכתב נשלח' במעקב" → `/dashboard/recovery` (another page), one claim at a time.
**Count:** at least 4 page loads + 13 × "open invoice" to verify + N status changes on another page. **Benchmark:** Ramp bill review / Stripe dispute = 0 page loads to see the evidence, 1 submit.

### T2. Bookkeeper at month close: "Give me the leak report and the claims status"
1. Opens `/leaks` (the nav item is visible) → a warn card: "רק לבעלי תפקיד 'בעלים' יש גישה לבלש הדליפות" — on a page titled בלש הדליפות where the explorer **is** working.
2. Clicks the gold "דוח דליפות חודשי" → middleware allows it → a second warn card, "הדוח החודשי זמין לבעלים ולמנהלים בלבד". **Dead end.**
3. Exports CSV from the explorer: one row per supplier. No line detail, no expected/actual, no invoice dates.
**Result:** the bookkeeper can't produce the month pack from this area.

### T3. Owner on the phone at the back door: "Send the butcher the claim now"
1. Bottom bar "בלש דליפות" → the first viewport is the title, 2 links, the explorer heading and 6 rows of controls. ₪760 is at y≈925 CSS px, **below the fold**.
2. Tap "החשבוניות שמאחורי…" → breakdown: 7 rows of controls again, then 13 cards of about 475 px each.
3. Tap "מכתבי זיכוי לספקים" → the letter table scrolls sideways. **The "סכום" column and the "סה״כ לזיכוי" total are off-screen** (only "סו" shows).
4. "הדפס / שמור כ-PDF" → OS print → save PDF → share to WhatsApp manually.
**Count:** 6+ taps and 3 OS sheets. The ₪ is never visible next to its line. **Benchmark:** Choco "Request for supplier" from the delivery check: 2 taps.

---

## 3. Findings

Severity: P0 = misleads, blocks a core task, or loses money or trust · P1 = major friction or below benchmark · P2 = polish · P3 = nit. `humanPR` = needs an immutable-file or governance change (AGENTS.md).

### P0

**leaks-01 · Claim letters and the monthly report can carry another branch's name** · both · functional · S
- *Evidence:* `apps/web/app/dashboard/leaks/claims/page.tsx:48,56` and `report/page.tsx:85-86` use `memberships[0]?.restaurantName`. `onboarding.ts:10-20` returns every membership with no order. The demo owner has 3 branches (switcher badge "3" in `dashboard_leaks_claims__owner__desktop-he.png`). The letter shows "מאת: … / בברכה, …" and the report shows "{restaurant} · {month}".
- *Problem:* after a branch switch, the supplier can receive a letter signed by the wrong branch, with the wrong sender on a legal-ish money document. The report handed to the accountant can carry the wrong entity.
- *Fix:* use the same `memberships.find(m => m.restaurantId === session.user.restaurantId)` pattern as `dashboard/page.tsx:60`. Better: one shared `getActiveRestaurant()` helper in `lib/` that every page uses. Add a test in `claims` that seeds 2 memberships and asserts the active name. Owner: web-feature-engineer (test: test-sentinel).
- *Exemplar:* Stripe and Xero documents always render the *active* legal entity from the account context. Rillet "scope is a switch on the same screen".

**leaks-02 · No line anywhere shows its ₪ basis (expected vs charged), although the API returns it** · both · trust · M
- *Evidence:* breakdown lines `breakdown/page.tsx:216-243` render badge + type + item + `|deltaAmount|`. Proof findings `proof/page.tsx:142-165` render the same. Claim letter lines `claims/page.tsx:151-160` render invoice · item · "מהות ההפרש" · amount. `LeakBreakdownLine.expected/actual` are fetched (`leak-hero.ts:168-170,281-282`) and never shown. Screenshots: `bd_desk_top.png` ("מחיר גבוה מהמצופה · אנטריקוט ₪53.52"), `cl_desk_top.png`.
- *Problem:* rubric H1 S0: "any flag shows a ₪ without its expected and charged basis". The owner can't believe ₪100.00 without opening the invoice. The supplier can't accept a claim that says only "מחיר גבוה מהמצופה". Expected by whom?
- *Fix:* one `<WhyLine>` component (`lib/components/WhyLine.tsx`) used by breakdown, proof and the claim letter. Per type:
  - PRICE_HIGHER: "חויב ₪149.00 ליח׳ · מוסכם ₪139.00 (חוזה · 01.09) · × 10 ק״ג = ₪100.00".
  - QTY_OVER: "חויבו 12 · התקבלו 10 ק״ג (תעודת משלוח 4471) · × ₪38.90 = ₪77.80".
  - VAT_MISMATCH: "מע״מ בחשבונית ₪… · 18% מ-₪… = ₪… · הפרש ₪12.66".
  - The rule and threshold come read-only from `packages/matching/src/tolerances.ts` (never redefined).
  - In compact density it collapses to one line but keeps the math.
  - Owner: web-feature-engineer; the per-type copy goes through the ux-copy pass.
- *Exemplar:* Stripe Radar risk insights (signals + factor values); Brex line-item explanations; Ramp Price Intelligence ("your price vs contract vs benchmark").

**leaks-03 · Three different "claimed from suppliers" totals for the same month** · desktop · trust · M · humanPR
- *Evidence:*
  - Report tile "נדרש זיכוי מהספקים ₪464 · 11 שורות · 7 ספקים" (`dashboard_leaks_report__owner__desktop-he.png`).
  - Proof tile "נדרש מהספקים ₪463.54" (`dashboard_leaks_proof__owner__desktop-he.png`).
  - Claims page "10 פערים (₪450.88) שנרשמו כתביעה… ועדיין לא נשלח עליהם מכתב", with 6 supplier letters (`cl_desk_tracker.png`).
  - The ₪12.66 gap is the `VAT_MISMATCH` on מחלבות הגליל GD-24107 (status "טופל"). The report counts `accepted` + `resolved` as claimed (`leak-report.ts:164-166`), and the proof labels `recoveredIls` as "נדרש מהספקים" (`leakProof/he.ts:32`). No letter claims it.
- *Problem:* rubric A9 S0: the same scope shows a different ₪ on two surfaces. The owner reads "₪464 requested" and the supplier receives letters for ₪450.88. Also, "resolved" (טופל) is not "claimed".
- *Fix:*
  1. Define the recovery taxonomy once: נמצא · נדרש (letter sent) · זוכה · הוחזר, plus ויתור.
  2. `claimedIls` = claims whose letter was sent, from the recovery tracker. "טופל" becomes its own state or folds into ויתור/זוכה by reason.
  3. Render the same component on the report, the proof and the claims header.
  4. Until that ships, show the gap in words: "₪12.66 (אי-התאמת מע״מ, מחלבות הגליל) סומן 'טופל' ולא נכלל במכתב".
  The SQL is ₪-semantics in `packages/charts` (matching-engine-guardian, human PR for ₪ math).
- *Exemplar:* Stripe balance states (Available / Pending / Reserved, each defined once and identical everywhere).

**leaks-04 · Visible totals don't equal their visible rows (explorer bars, breakdown hero)** · both · trust · S
- *Evidence:*
  - Explorer KPI "דליפה בתקופה ₪760". The supplier bars read 231 + 145 + 116 + 104 + 77 + 73 + 13 = **₪759** (`dashboard_leaks__owner__desktop-he.png`). `BreakdownChart.tsx:55` formats each row at 0 dp.
  - Breakdown hero "₪760" (`breakdown/page.tsx:123`, `ils(hero.leakIls, 0)`). Its 13 invoice rows (2 dp) sum to ₪759.54.
  - The proof says ₪759.54 and its title says "760".
- *Problem:* rubric B3 S0 ("a visible total doesn't equal its visible rows"). An owner who adds up the bars finds ₪1 missing on the one page meant to make the number believable.
- *Fix:*
  - Hero/KPI tiles may stay at 0 dp, but must expose the exact figure (`title` + `aria-label` "759.54 ₪") (B3d).
  - Any total shown next to its rows uses the rows' precision: breakdown hero → ₪759.54, explorer bars → 2 dp, or add a total row "סה״כ ₪759.54" under the bars (C3 totals row).
  - Add a Playwright check: Σ visible rows = visible total.
  - Owner: web-feature-engineer. No change to `formatIls`.
- *Exemplar:* Stripe's estimated home charts vs exact Financial Reports; Polaris DataTable totals row.

**leaks-05 · The report's month-over-month compare pits a partial month against a full month** · desktop · trust · S
- *Evidence:* `report/page.tsx:52` `compareMonth = shiftMonth(month, -1)`, and `:67-69` fetch `leakReport({month: compareMonth})`, i.e. **all of September** vs **October 1–25** (DEMO_TODAY 25.10). `DeltaBadge` at `:184-197` then shows ▼. The explorer does it right (`leak-views.ts:101`, day-aligned).
- *Problem:* rubric A2 S0: MTD vs full month gives a misleading direction ("leak fell 20%" when it hasn't).
- *Fix:* for the open month, compare against the same day-span (reuse `leakSummary` with `compare:'prev'`, or pass `asOfDay`). Label it: "1–25 באוק׳ מול 1–25 בספט׳". For closed months, full vs full. Owner: web-feature-engineer, consuming charts SQL.
- *Exemplar:* R365 OPTD/PTD comparisons; Stripe comparison ranges.

**leaks-06 · Claims is a print-only dead end: no send, no per-supplier action, no "sent" state, no deadline** · both · flow · M · humanPR (server send)
- *Evidence:*
  - `claims/page.tsx:202`: one `PrintButton` that prints all 10 letters.
  - `print-button.tsx` supports `scope` (per-element print), but the claims page never uses it.
  - Every letter keeps a solid "לשליחה" badge (`:119-121`).
  - The tracker note tells the user to mark "מכתב נשלח" on another page (`leaks/he.ts:86-87`).
  - Screenshots: `dashboard_leaks_claims__owner__desktop-he.png` (5,162 px, 10 letters, one button).
- *Problem:* this is the ₪-back step of the North Star (FG-31 P0 in `functional-gaps.md`). The owner can't send, can't track and can't see what was already sent. The only output is paper or a PDF.
- *Fix:* a per-letter action bar (sticky on each card):
  - **Now, with no outbox:**
    - "הורד PDF" (per-letter print scope).
    - "שלח בוואטסאפ" as a `wa.me` deep link that pre-fills the text summary and the PDF link, sent by the user's own phone.
    - "שלח במייל" as a `mailto:`.
    - "סמן כנשלח", which calls the existing recovery lifecycle (claimed → letter sent) with a 10 s Undo.
    - After a send: a "נשלח 25.10 · מחכה לתשובה · נותרו 7 ימים" countdown (H8).
  - **Later (human PR, outbox):** a server send plus a supplier token page to accept or dispute per line and upload the credit note (big move 3).
  - Owner: web-feature-engineer; outbox: human.
- *Exemplar:* Stripe Disputes (one submission, `due_by`, a status that moves by itself); Choco "Request for supplier"; Superhuman Undo Send.

### P1

**leaks-07 · The same supplier gets two letters on the same day** · desktop · flow · S
- *Evidence:* month letters and tracker letters are grouped separately (`claims/page.tsx:59-102`). קצביית הכרם gets HK-24108 ₪100.00 **and** HK-24107 ₪131.32. ירקות השרון, משקאות שטיינברג and דגי הים התיכון also appear twice (`dashboard_leaks_claims__owner__desktop-he.png`).
- *Fix:* group by `supplierId` across both sources. One letter per supplier with two sections ("חשבוניות שטרם שולמו — לקיזוז לפני תשלום" / "חשבוניות ששולמו — לזיכוי") and one total. The page header shows "6 ספקים · 14 שורות · ₪746.88 לדרישה" (₪296.00 before payment + ₪450.88 tracker).
- *Exemplar:* BILL vendor statements (one per vendor).

**leaks-08 · The letter lacks what a supplier needs to issue a חשבונית זיכוי** · both · copy/trust · M
- *Evidence:* `claims/page.tsx:114-184`. There are no invoice dates, no delivery-note or PO numbers, no qty × price, no contract reference, no restaurant ח.פ./address/phone/contact person, no reference number and no reply-by date. "מחיר גבוה מהמצופה" is internal vocabulary (`approvals/he.ts:53`). The intro "נבקש זיכוי בסך ₪104.80" uses `formatIls` inside a sentence with no `<bdi>`.
- *Fix:* letter anatomy:
  - A header with restaurant name + ח.פ. + address + contact name and phone.
  - "מס׳ דרישה RM-2026-10-014".
  - A table per line: invoice no. + date, delivery-note no., item, "חויב X × ₪Y", "מוסכם/התקבל", "לזיכוי ₪Z", VAT basis.
  - Plain-Hebrew reason text: "חויבנו מעל המחיר שסוכם בחוזה מ-01.09".
  - "נבקש חשבונית זיכוי עד 01.11.2026", then the signature with a name.
  - A one-line appendix "ראיות: צילום תעודת משלוח, שורת חשבונית".
- *Exemplar:* Stripe dispute evidence packet; Cut+Dry credit request.

**leaks-09 · Phone: every money table hides its ₪ column behind a horizontal scroll** · mobile · visual · M
- *Evidence:*
  - Hub detective table `min-w-[640px]` (`leaks/page.tsx:181`): at 390, "שולם מעל החציון", "שינוי" and "מגמה" are off-screen (`dashboard_leaks__owner__phone-he_03.png`).
  - Claim letter `min-w-[480px]` (`claims/page.tsx:141`): "סכום" and "סה״כ לזיכוי" are cut to "סו" (`dashboard_leaks_claims__owner__phone-he_01.png`).
  - Report by-supplier `min-w-[480px]` (`report/page.tsx:269`): "דליפה" and "% מההוצאה" are hidden; only the neutral spend shows (`dashboard_leaks_report__owner__phone-he_01.png`).
- *Problem:* rubric C3 S1 (claims at 390 is named), escalated for the primary flow. The ₪ is the point of each table.
- *Fix:* below 640 px, rows become cards. Line 1: identity with the ₪ at the line end (`metric-sm`, ink/danger). Line 2: secondary facts. Drop low-value columns (sparkline, median). The letter's mobile card shows "HK-24108 · אנטריקוט · ₪100.00" and a sticky total.
- *Exemplar:* Polaris IndexTable condensed; Primer DataTable responsive.

**leaks-10 · Phone: T1 sits below the fold under a 6–7 row toolbar** · mobile · ia · M
- *Evidence:* `dashboard_leaks__owner__phone-he_00.png`: ₪760 starts at y≈925 CSS px. Breakdown `…breakdown…phone-he_00.png`: 7 rows of controls before the hero. `ViewToolbar.tsx:157` is `flex flex-wrap` with no small-screen collapse.
- *Problem:* rubric A8 S1: controls push T1 below the fold on mobile.
- *Fix:* below `lg`, `ViewToolbar` collapses to **one** "תצוגה · 2" button that opens a bottom sheet (85vh, handle, "סגור"). Active filters show as one chip row with "נקה". Order: hero → act-now → chart → table. Keep the period as a single compact pill ("אוקטובר · עד 25.10 ▾") next to the h1.
- *Exemplar:* Linear's opinionated defaults; Mercury Insights (time-frame selector top-right, everything else in "Display").

**leaks-11 · The hub has four competing ₪ figures, three periods and two definitions** · desktop · ia · M
- *Evidence:* `dashboard_leaks__owner__desktop-he.png`:
  - ₪760 "דליפה בתקופה" (this month, red rail).
  - ₪152.50 "מעל החוזה (90 ימים)" (warn).
  - ₪336 "זחילת מחירים… (30 יום)" in **danger red with the same droplet icon as the leak** (`leaks/page.tsx:142-148`).
  - The report's "מחירים שזחלו למעלה" for the same month sums to ₪413.18 with different % (אנטריקוט +7.2% on the hub vs +4% in the report).
  - The subtitle says "חורג מהאחוזון ה-90" (`leaks/he.ts:9`) while the table shows "מחיר חציוני / שולם מעל החציון". The real rule is `last > p90 AND Δ vs p50 ≥ 5%` (`packages/charts/src/leaks.ts:140-146`).
- *Problem:* rubric A1/A9 S1. The owner can't tell which number is "the leak", and the definitions contradict each other on screen.
- *Fix:*
  - The hub keeps one T1 (this month's leak).
  - Price creep moves to its own tab, "מגמת מחירים", in T4/warn styling (no droplet, no danger), with one definition line: "מסומן כשהמחיר האחרון מעל האחוזון ה-90 ו-5%+ מעל החציון · העודף מחושב מול החציון × הכמות ששולמה ב-30 יום".
  - Align the report's creep to the same definition, or rename it ("ממוצע החודש מול החציון").
  - Over-contract becomes a row in the act-now list.
- *Exemplar:* Mercury Insights (one overview, drill tabs); Ramp Price Intelligence (one benchmark definition).

**leaks-12 · Desktop breakdown is 13 tall cards (4,210 px) with no sort, no grouping and no row actions** · desktop · flow · L
- *Evidence:* `dashboard_leaks_breakdown__owner__desktop-he.png`; `breakdown/page.tsx:184-266`. Supplier and invoice are at the right edge and the ₪ at the left, about 1,000 px apart. The per-card actions are 12 px links (`:248-263`). "לתור האישורים" goes to the unfiltered queue, even on **paid** invoices.
- *Problem:* the owner and bookkeeper scan this weekly. The "₪296 you can still stop" vs "₪463.54 you must claim" split, which drives the action, is invisible.
- *Fix:* a dense table (`<NumCell>`, 48 px rows, compact 32 px) grouped into two sections with subtotals:
  - **"עוד לא שולם — אפשר לעצור (₪296.00)"**, with the row action "עכב בתשלום".
  - **"שולם — לדרוש זיכוי (₪463.54)"**, with the row action "הוסף לדרישה".
  - Columns: supplier · invoice · date · status · findings (count + types) · ₪ leak.
  - Rows expand to their lines with `<WhyLine>` (leaks-02).
  - Sorting by ₪ (default, `aria-sort`), date or supplier.
  - Space or click opens a 520 px peek of the invoice image and line (D6).
  - A batch bar: "3 נבחרו · ₪231.32 · [הוסף לדרישה] [עכב תשלום]".
- *Exemplar:* Linear list + Peek; Ramp bill review; Stripe Payments table.

**leaks-13 · Aggregates aren't clickable: no drill from bar, tile, heatmap or report row** · desktop · flow · M
- *Evidence:*
  - `BreakdownChart.tsx:122-147` bars are `<li>` with no link.
  - The KPI tiles (`explorer.tsx:96-122`) and heatmap tiles (`LeakHeatmap.tsx:66-86`) are `<div>`s.
  - The report rows (`report/page.tsx:242-331`) are plain `<td>`s.
- *Problem:* `exec-desktop.md` P4: "every summary amount is a link to its rows". An explorer you can't drill is a picture.
- *Fix:*
  - Bar or row → `/dashboard/leaks/breakdown?<view>&sup=<id>` (the view state already serialises filters, `state.ts`).
  - Type row → `&type=`.
  - "13 / 35" → breakdown.
  - Heatmap tile → `/dashboard/products/<id>?tab=prices`.
  - Report rows link with `?month=` → breakdown in view mode.
  - The list's sum must equal the clicked number to the agora.
- *Exemplar:* Stripe balance summary drill; Mosaic ("transaction-level detail within a few clicks").

**leaks-14 · Report "What happened to the money" double-counts and has no credited/returned stage** · desktop · trust · M
- *Evidence:* the tiles are נתפס לפני תשלום ₪296 + עדיין ממתין להחלטה ₪296 + נדרש זיכוי ₪464 + ויתור ₪0 = ₪1,056 under a ₪760 headline (`report/page.tsx:211-221`). "Caught" and "still open" are the same 4 lines. There is no זוכה/הוחזר tile, so the report never says how much came back.
- *Problem:* rubric A9 ("נתפס לפני תשלום is a property of נמצא, not a fifth state"). It looks like a partition, but it isn't one.
- *Fix:*
  - One funnel bar with ₪ per stage: נמצא ₪759.54 → נדרש → זוכה → הוחזר, plus ויתור. The stages sum to נמצא.
  - "₪296 עוד אפשר לעצור לפני תשלום" becomes a chip on נמצא.
  - The credited and returned amounts come from the recovery tracker.
- *Exemplar:* Stripe balance states; the fintech.md P22 funnel.

**leaks-15 · Four vocabularies for one lifecycle; "טופל" contradicts a red ₪** · both · copy · S
- *Evidence:*
  - Breakdown resolution labels: פתוח / נדרש מהספק / ויתור / הועבר לבעלים / **טופל** (`approvals/he.ts:44-50`).
  - Report: נתפס / ממתין להחלטה / נדרש / ויתור.
  - Proof: "נדרש מהספקים" for `recoveredIls`.
  - Claims: "לשליחה".
  - HK-24107 lines read "טופל" while the ₪ stays red and counted (`bd_desk_top.png`).
  - Leak labels drift too: "דליפה בתקופה" / "סה״כ דליפה" / "דלף החודש" / "המספר".
- *Fix:* a glossary in `lib/i18n/messages/common` with one label and one tooltip definition per state, used by every surface (A9, E9). The leak label is "דליפה החודש" everywhere, with the eyebrow "אוקטובר · עד 25.10 · פתוח".
- *Exemplar:* Stripe balance states; Intuit content design glossary.

**leaks-16 · The proof doesn't add up on screen and contradicts itself** · desktop · trust · S
- *Evidence:*
  - "5 הממצאים הגדולים" = ₪485.48 of ₪759.54, with no remainder row (`proof/page.tsx:115-171`).
  - The rules text says "לא נספרות … ו״פריט שהגיע בלי הזמנה״" (`leakProof/he.ts:35`), while finding #5 is "פריט בחשבונית ללא הזמנה · חלה ₪72.00", which is counted (`dashboard_leaks_proof__owner__desktop-he.png`).
  - The report's method says "לא כולל … חשבוניות ללא הזמנה" (`leaks/he.ts:142`) next to a ₪72 "פריט בחשבונית ללא הזמנה" row.
  - The proof is current-month only (`proof/page.tsx:30`).
- *Fix:*
  - Add "ועוד 8 חשבוניות · ₪274.06 → לפירוט המלא" so Σ = hero on screen (H3).
  - Name excluded types by their UI label ("ממתינה לשיוך להזמנה"), never a paraphrase.
  - Accept `?m=` / `?month=`.
  - Add the scope sentence at the top: "כל החשבוניות שהותאמו בין 1–25 באוקטובר · לא כולל 2 חשבוניות ממתינות לשיוך (₪3,603.32)".
- *Exemplar:* Pilot / Stripe Financial Reports (the reconciling footer row).

**leaks-17 · The monthly report is live, not a closed document** · desktop · trust · M · humanPR
- *Evidence:* `report/page.tsx:161` prints "הופק ב-{new Date()}". `computeLeakReport` recomputes on every view. There is no open/closed label, no close date and no correction lines. September viewed today shows "generated 25 Oct".
- *Problem:* rubric H3 (S0 if a closed report silently changes). An accountant's printed September can differ from what is on screen later.
- *Fix:*
  - **Now:** label the open month "פתוח · מתעדכן · נכון ל-25.10 14:02", and closed months "חודש סגור".
  - **Then (human PR, a new snapshot table + close job):** freeze on the 5th of the next month; late changes appear as dated "תיקון" lines.
  - Link the report and the live breakdown to each other.
- *Exemplar:* Pilot live dashboards vs formal close; Rillet period locks.

**leaks-18 · Zero, "no data" and "clean" look the same** · both · states · S
- *Evidence:*
  - Breakdown with 0 checked invoices: ₪0 in primary green (`breakdown/page.tsx:122`), then "אין דליפה… כל החשבוניות שהותאמו בחודש זה תואמות" (`leaks/he.ts:45-46`).
  - The report shows the green "אין דליפה בחודש זה — כל החשבוניות שנבדקו תואמות" (`report/page.tsx:224-225`) even when `noSpend` is true.
  - The explorer renders a red "₪0" (`explorer.tsx:96-101`, `tone="danger"`).
- *Problem:* rubric A4 (S0 when ₪0 stands in for "no data"). A new tenant is told it is clean.
- *Fix:* three branches:
  - `matchedInvoiceCount===0` → T4 "עוד לא נבדקו חשבוניות החודש" + "העלה חשבונית".
  - `leak===0 && matched>0` → T3 "₪0 דליפה · 35 חשבוניות נבדקו ✓".
  - Error → "לא זמין · נסה שוב".
- *Exemplar:* Primer blankslate; Stripe/Ramp setup checklists.

**leaks-19 · Over-contract card renders ₪ on the wrong side, and its basis is tooltip-only** · both · rtl · S
- *Evidence:* "152.50₪", "+ 100.00₪", "+ 52.50₪" (`dashboard_leaks__owner__phone-he_02.png`). Cause: `<bdi dir="ltr">{total}</bdi>` around a he-IL string plus a concatenated "+" (`apps/web/app/dashboard/contracts/over-contract.tsx:60,84,172`). "Contract ₪X, billed ₪Y" exists only in `title` (`:76-81`).
- *Problem:* rubric E4 S1. C13: a tooltip is the only home of essential information on touch.
- *Fix:* `<Money>` (a plain `<bdi>`, no `dir`), the word "מעל" instead of "+", and the basis line visible: "חוזה ₪139.00 · חויב ₪149.00". Owner: rtl-design-steward (rendering), with web-feature-engineer.
- *Exemplar:* ICU he-IL output; Intuit content design (sign before the currency).

**leaks-20 · Wayfinding: 5 sibling URLs, inconsistent "back", two "monthly reports"** · desktop · ia · M
- *Evidence:*
  - The hub links only to report + breakdown (`leaks/page.tsx:57-74`). Claims is reachable only from the breakdown hero card. Proof is reachable only from the home hero.
  - Back links: breakdown and proof → "חזרה לחדר הבקרה" `/dashboard` (`breakdown/page.tsx:74`, `proof/page.tsx:47`). Claims → breakdown. Report → hub.
  - The nav carries a separate "דוח חודשי" (`/dashboard/reports/monthly`) and "₪ חוזר".
- *Problem:* rubric D2 ("one leak hub with tabs"), D5. `ia-map.md` #12.
- *Fix:* the tabbed hub (big move 1), plus a breadcrumb "חדר הבקרה › דליפות › פירוק · אוק׳". Old URLs 308 to tabs. Merge or rename the two monthly reports ("דוח דליפות" vs "דוח חודשי למייל").
- *Exemplar:* Mercury Insights tabs; R365 one dashboard with pages.

**leaks-21 · Explorer KPI has no default comparison, freshness or completeness** · desktop · trust · S
- *Evidence:* the default `compare:'off'` (`lib/components/views/state.ts:70`). The tile shows only "דליפה בתקופה ₪760". There is no "עד 25.10 · פתוח", no "עודכן לפני…", and no "2 ממתינות לשיוך" (`dashboard_leaks__owner__desktop-he.png`).
- *Fix:*
  - Default `cmp=prev` (already day-aligned in the SQL) on this page.
  - Hero anatomy per A2: eyebrow, label, ₪, "▲ ₪X (+Y%) מול 1–25 בספט׳", "1.8% מההוצאה על מזון · ₪42,263", "35 נבדקו · 2 ממתינות · עודכן 14:02".
- *Exemplar:* Stripe Apps analytics (comparison badges); Mercury.

**leaks-22 · Role dead ends and an alarm-toned "owner only" card** · both · ia · S
- *Evidence:*
  - Manager and bookkeeper see a warn card, "רק לבעלי תפקיד 'בעלים'…" (`leaks/page.tsx:100-103`; `dashboard_leaks__bookkeeper__desktop-he.png`).
  - The bookkeeper gets the gold "דוח דליפות חודשי" pill, which leads to another warn card (`report/page.tsx:64-81`). `allowedRolesForPath` lets them in via `/dashboard/leaks` (`roles.ts:51`).
- *Problem:* rubric A7 (T4 never cries wolf) and D7 (no silent dead ends). The month-close persona is locked out of the month report.
- *Fix:*
  - Hide links the role can't open (`canSeeRoute` on `/dashboard/leaks/report`).
  - Add an explicit `ROUTE_ROLES['/dashboard/leaks/report']` entry.
  - The card becomes T4 neutral: "טבלת זחילת המחירים זמינה לבעלים · בקשו גישה מ-<owner>".
  - **Decide** whether the bookkeeper should read the report (recommend yes, read-only; that is an API role change on `leakReport`, web-feature-engineer, with the cross-tenant attack coverage entry added).
- *Exemplar:* Notion/Figma "request access" screens.

**leaks-23 · No loading or error boundary on any leaks route** · both · states · S
- *Evidence:* `find apps/web/app/dashboard -name loading.tsx` → only approvals, exports, receiving, settings, suppliers. No `error.tsx` under dashboard. The hub fires 5 server queries (`page.tsx:44`, `explorer.tsx:33-37`, `OverContractCard`). Lab load is about 1.6 s.
- *Fix:* `leaks/loading.tsx` (a layout-true skeleton: hero 240 px, 4 tiles, chart), plus `breakdown/`, `claims/` and `report/` variants. `leaks/error.tsx` with a Hebrew cause, "נסה שוב" and a way back. Stream the T1 first (Suspense around the detective and over-contract).
- *Exemplar:* Polaris SkeletonPage; Next.js loading boundaries.

### P2

**leaks-24 · Zero-₪ QTY_SHORT lines cry wolf** · both · visual · S
- *Evidence:* "חסר בכמות שהתקבלה · ₪0.00" in danger red with a warn "אזהרה" badge on HK-24107, FS-24103, SH-24118, SH-24121, SH-24115 and BR-24116 (`bd_desk_top.png`, `…breakdown…phone-he_01.png`). `breakdown/page.tsx:233-237` colours by `countsAsLeak`, not by amount.
- *Fix:* when |Δ| = 0, render as T4 "סופק פחות מההזמנה — לא חויבת על החסר" (no ₪, info icon), or fold such lines under "ממצאים ללא השפעה כספית (6)".
- *Exemplar:* Carbon ("avoid status indicators when no action is required").

**leaks-25 · Typography and tokens on money** · both · visual · M
- *Evidence:*
  - All ₪ are in `font-mono` (StatCard `:52`; breakdown `:122,210,235`; proof `:66,135,154`; report `:170,248…`), giving a wide mono decimal gap ("759 . 54" on `dashboard_leaks_proof__owner__phone-he_00.png`).
  - Hebrew labels use `uppercase tracking-wider` (`StatCard.tsx:48`, `leaks/page.tsx:183`, `explorer.tsx:126`, `breakdown/page.tsx:119`).
  - `text-[11px]` appears in 7 places (`breakdown:211,240`; `claims:158`; `proof:138`; `report:338,353`; `explorer:141`).
  - Hex in `LeakHeatmap.tsx:24-28,95` and `Sparkline.tsx:22`.
- *Fix:* Heebo `tabular-nums lining-nums` for money (R-2); `tracking-normal` on Hebrew (E6); a 12 px floor (B1); token roles for the heat ramp. Owner: rtl-design-steward.

**leaks-26 · Money column alignment flips by page and locale** · both · visual · S
- *Evidence:* the hub table uses `text-start` (physical right in he, left in en: `dashboard_leaks__owner__desktop-en.png`). Report and claims use `text-end` (physical left in he). R-1 says physically right in both.
- *Fix:* one `<NumCell>` / `.num` (`ltr:text-end rtl:text-start`) with fixed decimals per column; ₪ moves to the header in dense tables.

**leaks-27 · A line chart on categorical groups, mirrored in RTL** · desktop · visual · S
- *Evidence:* the "קו" toggle is offered for group-by supplier (`explorer.tsx:129-140`). `LineFace` mirrors in RTL (`BreakdownChart.tsx:181`, `rtl:-scale-x-100`), which violates R-3.
- *Fix:* offer "קו" only for time groupings (or swap it for a trend from `leakTrend`); remove the mirror; give every chart a table toggle and an `aria-label` sentence (C14).

**leaks-28 · The heatmap duplicates the table, is non-interactive and truncates names** · both · visual · S
- *Evidence:* the same 3 rows appear as tiles and as table rows (`dashboard_leaks__owner__desktop-he.png`). The tiles are `div`s with `title` only (`LeakHeatmap.tsx:66-86`). The phone truncates "בירה מהחבית — חבית 0…", losing "30 ל׳". `hover:scale-[1.03]` motion.
- *Fix:* render the heatmap only above 6 items; tiles become links; wrap names to 2 lines; no scale motion.

**leaks-29 · Breakdown row actions: tiny, generic, wrong for paid invoices** · both · functional · S
- *Evidence:* "לתור האישורים" and "פתח חשבונית" are `text-xs` links (`breakdown/page.tsx:248-263`). The crawl counts 69 targets under 24 px on breakdown desktop and 71 on phone, and 45 and 50 on the hub. "לתור האישורים" opens the whole queue, even for paid invoices.
- *Fix:* the action follows the invoice state: unpaid → "החלט על 2 פערים · ₪131.32" deep-linked to `approvals?inv=<id>`; paid → "הוסף לדרישה מ<supplier>". 44 px on touch, 24 px minimum on desktop (F4).

**leaks-30 · Exports are thin** · desktop · functional · S
- *Evidence:* the report CSV exports only by-type (`report/page.tsx:141-148`). The breakdown CSV has one row per invoice with no lines, types, expected or actual (`breakdown/page.tsx:90-107`). Saved views are localStorage-only (`savedViews.ts:1-5`).
- *Fix:* report CSV/XLSX with 3 sheets (type, supplier, creep); breakdown CSV at line level with the `WhyLine` fields; server-side saved views (ia-map #14).
- *Exemplar:* Stripe (a Download on every section); Sigma scheduled CSV.

**leaks-31 · Report target and threshold copy disagree** · desktop · copy · S
- *Evidence:* "יעד: 1.5% מההוצאה" (`leaks/he.ts:112`) reads as a goal for leak (R-14 default: no target). Supplier % ≥1.5% turns red (`report/page.tsx:288`), but דגי הים התיכון shows "1.5%" un-red (1.4966%). The % column mixes "2%" and "2.1%" (`formatPercent` drops the trailing zero).
- *Fix:* remove the target line (owner decision R-14) or phrase it "בממוצע מסעדות מאבדות 1.5%+"; fix one decimal (`minimumFractionDigits:1`); colour by the displayed value.

**leaks-32 · Ambiguous fraction "13 / 35" in RTL** · both · rtl · S
- *Evidence:* it renders visually as "35 / 13" (`explorer.tsx:119`; `dashboard_leaks__owner__phone-he_01.png`).
- *Fix:* "13 מתוך 35" (copy), as the proof already does.

**leaks-33 · No history on claim lines** · desktop · trust · M
- *Evidence:* breakdown, proof and claims show no who/when for a resolution ("טופל" by whom?). Rubric H7: S1 on claims.
- *Fix:* a "היסטוריה" disclosure per line (latest 3: who + role chip, verb, before → after, `dd.MM.yyyy HH:mm`, source), exported with the letter.
- *Exemplar:* Brex per-expense audit trail.

### P3

**leaks-34 · English locale shows Hebrew categories under English product names** · desktop · copy · S
- *Evidence:* "Draft beer keg 30L / משקאות" (`dashboard_leaks__owner__desktop-en.png`; `leaks/page.tsx:202`).
- *Fix:* translate the category or hide it in `en`.

**leaks-35 · First-visit consent bar covers the bottom bar and the hero region on phones** · mobile · visual · S
- *Evidence:* all phone captures (for example `…claims…phone-he_00.png`). It is a shell issue, but on leaks it hides the T1 and the print CTA.
- *Fix:* a slimmer 2-line bar above `--rm-bottomnav-h` with `scroll-padding-bottom` (F3).

---

## 4. Big moves (benchmark-grade)

### BM-1 · One Leak Hub with tabs and a single funnel ("מרכז הדליפות")
- **Why:** 5 sibling URLs, 4 competing ₪ figures on the hub, 3 "claimed" totals, two monthly reports. The owner should meet one number and one story.
- **What:**
  - `/dashboard/leaks` gets URL tabs `סקירה | פירוק | הוכחה | דוח חודשי | זיכויים (7)`.
  - A sticky header (56 px) holds the T1 "דליפה החודש ₪759.54" (A2 anatomy: eyebrow "אוקטובר · עד 25.10 · פתוח", a delta vs 1–25 Sep, % of food spend with its base, "35 נבדקו · 2 ממתינות").
  - Under it, a **single funnel bar**: נמצא → נדרש → זוכה → הוחזר (+ ויתור), each stage a link.
  - "₪296 עוד אפשר לעצור לפני תשלום" appears as a T2 chip with one CTA.
  - Price creep and over-contract move to an "מגמת מחירים" sub-view in calm warn.
  - Old URLs 308.
- **Device:** both (on mobile the tabs become a horizontal segmented control under the hero).
- **Effort:** L.
- **Exemplar:** Mercury Insights (Overview plus drill tabs); Stripe balance states.

### BM-2 · Desktop "Leak ledger": split pane with evidence beside every ₪
- **Why:** verifying a ₪ costs a page load today; 13 cards take 4,210 px; nothing drills.
- **What:** at ≥1280 px, the breakdown is a 440 px dense list grouped "לעצור לפני תשלום / לדרוש זיכוי", plus a detail pane:
  - The invoice image, auto-scrolled to the highlighted line region.
  - The PO line, the GR (delivery-note) line, the contract price and date.
  - `<WhyLine>` math and line history.
  - Actions: "הוסף לדרישה", "עכב תשלום", "ויתור…" (ConfirmDialog naming the ₪ and the supplier).
  - Keyboard J/K, Space peek, X select, a batch bar "4 נבחרו · ₪296.00".
  - Every aggregate on the hub and report deep-links into this view with filters.
- **Device:** desktop.
- **Effort:** L.
- **Exemplar:** Ramp bill review (image beside the fields); Linear Peek; Stripe Radar insights.

### BM-3 · Claim composer: preview → send → supplier answers → credited (the loop nobody ships)
- **Why:** claims are print-only; the same supplier gets two letters; there is no state after send. `functional-gaps.md` FG-31 calls ₪-back the leapfrog.
- **What:**
  - Per supplier, one draft merges unpaid and paid lines, with evidence (delivery-note photo, invoice crop, contract) auto-attached.
  - A preview of **exactly** what the supplier receives (PDF + WhatsApp text).
  - "שלח לקצביית הכרם בוואטסאפ · ₪231.32", then a 10 s "בטל שליחה".
  - A supplier token page (reusing the `/s/[token]` model) where the supplier accepts or disputes **per line** and uploads the credit note.
  - The status moves נדרש → אושר → זוכה by itself, with a countdown "נותרו 6 ימים · עד 01.11".
  - Chase drafts on day 3, 7 and 14 wait for a human tap.
  - **Now (no outbox):** `wa.me` / `mailto:` hand-off, per-letter PDF, "סמן כנשלח" with Undo.
  - **Server send, reminders and the outbox:** human PR.
- **Device:** both (the phone at the back door is the main sender).
- **Effort:** L.
- **Exemplar:** Stripe Disputes (due_by, one submission); Choco "Request for supplier"; Superhuman Undo Send.

### BM-4 · "Why did it change?": delta drivers in words and ₪
- **Why:** the owner sees ₪760 but not what moved it vs last month; the explorer compare is off by default.
- **What:**
  - Under the T1 delta, up to 3 linked chips: "‎+₪100 קצביית הכרם · אנטריקוט מעל חוזה", "‎+₪72 מאפיית ברנר · חלה ללא הזמנה", "‎−₪20 דגי הים התיכון".
  - Each chip deep-links to the filtered ledger.
  - The same chips appear on the monthly report ("3 הגורמים העיקריים") and in the digest.
  - The driver SQL lives in charts (matching-engine-guardian) and is consumed via tRPC.
- **Device:** both.
- **Effort:** M.
- **Exemplar:** Pigment Insights (ranked drivers + written summary); Runway variance colours.

### BM-5 · Closed-month report + accountant pack
- **Why:** the report is live and restates silently, the bookkeeper is locked out, and the CSV has one table.
- **What:**
  - Each month closes on the 5th with "סגור ב-05.11 · לא ישתנה". Late changes appear as dated correction lines.
  - One click, "חבילה לרו״ח", produces the PDF report, a line-level XLSX, the letters sent and their statuses, and credits received.
  - An optional scheduled email to the accountant on the 6th.
  - The bookkeeper reads it.
- **Snapshot table, close job, email:** human PR.
- **Device:** desktop.
- **Effort:** M.
- **Exemplar:** Pilot formal close; Rillet close checklist; Stripe Sigma scheduled CSV.

### BM-6 · Phone "Leak brief": thumb-first, act-now first
- **Why:** on a phone today, T1 is below the fold, every money table hides its ₪, and the letter total is invisible.
- **What:** `/leaks` at <640 px is a card stack:
  1. The hero ₪ + delta + funnel (one card).
  2. "מחכה לך": up to 3 T2 cards. Examples: "4 דרישות לשלוח · ₪296 [שלח]", "קצביית הכרם חייבה מעל חוזה · ₪100 [הוסף לדרישה]".
  3. Top 5 suppliers as tappable rows with the ₪ at the line end.
  - A full-width 56 px primary in the thumb zone.
  - Every control is behind one "תצוגה" sheet.
  - Letters render as cards with a sticky total.
- **Device:** mobile.
- **Effort:** M.
- **Exemplar:** Brex mobile task inbox; Ramp mobile approvals; Mercury mobile Insights.

---

## 5. Rubric scorecard (key criteria)

| Criterion | Hub | Breakdown | Claims | Proof | Report |
|---|---|---|---|---|---|
| A1 one T1 | Fail (4 ₪ heroes) | Pass | Partial (no page total) | Pass | Pass |
| A2 hero anatomy | Fail (no delta/freshness) | Partial | N/A | Partial (scope sentence missing) | Fail (MTD vs full) |
| A4 zero vs no data | Fail (red ₪0) | Fail | Pass | Pass | Fail |
| A7 T4 calm | Fail (warn role card) | Pass (pending T4) | Fail (10 solid badges) | Pass | Fail (warn role card) |
| A9 one vocabulary | Fail | Fail | Fail | Fail | Fail |
| B2 money face | Fail (mono) | Fail | Fail | Fail | Fail |
| B3 precision | Fail (759 vs 760) | Fail (760 vs 759.54) | Pass | Pass | Partial (mixed % decimals) |
| B4 alignment | Partial | n/a | Partial | n/a | Partial |
| C3 phone tables | Fail | Pass (cards) | Fail | Pass | Fail |
| C8 states | Fail (no loading/error) | Fail | Fail | Fail | Fail |
| C10 outbound send | n/a | n/a | Fail (no preview/send/undo) | n/a | n/a |
| D2/D5 hub, way up | Fail | Partial (back → home) | Partial | Partial | Pass |
| D6 drill/peek | Fail | Fail | n/a | Partial (links) | Fail |
| E4 ₪ in RTL | Fail (over-contract card) | Pass | Pass | Pass | Pass |
| E6 Hebrew tracking | Fail | Fail | Pass | Pass | Pass |
| H1 flag explains itself | Partial (median shown, not p90/threshold) | **Fail** | **Fail** | **Fail** | Partial |
| H3 provable / frozen | n/a | Partial | n/a | Partial (no remainder) | Fail (live) |
| H7 history | n/a | Fail | Fail | Fail | n/a |
| H8 deadlines | n/a | n/a | Fail | n/a | n/a |

**Pilot bar:** not met (6 P0 in the area; claims and the proof are primary flows).

---

## 6. Governance notes
- The `leaks-03` definition change (what "claimed" means) and any change to report SQL are ₪ semantics in `packages/charts`, owned by matching-engine-guardian, human PR for ₪ math.
- `leaks-17` (freeze) and BM-5 need a snapshot table and a close job: schema + `apps/worker/src/cron.ts` are immutable, so a human PR.
- BM-3 server send and chase go through `notifications/outbox.ts`, which is immutable, so a human PR. The `wa.me` / `mailto:` hand-off and "סמן כנשלח" via the existing recovery lifecycle are in scope for web-feature-engineer.
- `leaks-22` (letting the bookkeeper read `leakReport`) changes a router role. The cross-tenant attack COVERAGE manifest needs its entry kept; no assertion may be weakened.
- `<Money>` / `<NumCell>` wrap `formatIls()` and never change its output (money-format-marshal owns the util).
- Nothing in this review edits a repo file.
