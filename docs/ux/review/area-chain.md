# Area review: ₪-back recovery, chain view, branches

**Area key:** `chain` · **Routes:** `/dashboard/recovery`, `/dashboard/chain`, `/dashboard/branches`
**Reviewed:** 2026-10-25 against `RUBRIC.md` v1, the research pack (`exec-desktop.md`, `functional-gaps.md` FG-31/FG-37, `fintech.md`, `erp-modern.md`, `ia-map.md`, `rtl.md`, `ainative.md`), 9 screenshots and the code on `main` (`8fef118c`).
**Focus:** the multi-branch owner at the desk (roll-up, comparison, drill to a branch) and the recovery follow-up loop (claim → letter → chase → credit note → money back).
**Crops used:** `scratchpad/ux/review/crops/chain/*`. Desktop slices are 1000 px tall and phone slices are 1700 px tall (@2x, so 850 CSS px). Evidence crops: `heatmap_desk_he.png`, `heatmap_desk_en.png`, `heatmap_phone_he.png` and `recovery_phone_claims.png`.
**Lab caveats applied:** the red worker banner and the cookie bar are lab artefacts and are not scored. Where the cookie bar overlaps a mobile hero or CTA, that overlap is noted.

---

## 0. Verdict in one paragraph

Both pages have good bones. The ₪-back tracker is the only place in the product that follows money **after** the leak: claims, ageing, per-supplier recovery rate, credit notes split oldest-first with idempotency, and suggestions from negative invoice lines. The chain page has a real roll-up: a ranking, a branch × month heatmap, a price-gap finder with invoice-line drill and a weekly "branch to look at" card. Both are computed per branch under RLS, and whole-₪ rows add up to the printed total (`chain/display.ts`).

What lets the owner down is everything **after reading**:
- **Recovery decisions go through a native `<select>`** that fires on change: write off, "money back" (terminal) and dispute. There is no confirm, no reason and no undo.
- **On a phone, the claims table cuts off** the amount, status, age and action columns.
- **The follow-up loop is split across pages.** Letters are print-only on another page. Marking them sent is one row at a time. "Overdue" chases nobody: the reminder e-mails the restaurant, not the supplier. The claim history API exists but nothing calls it.
- **The chain view is read-only.** "Drill" means switching the whole session and reloading onto the other branch's home. There is no chain-wide queue, no chain-wide recovery, no completeness and no default comparison.
- **The heatmap runs time backwards in Hebrew**, so on the same page it contradicts the sparkline.

**Scores vs world-class** (Toast Location Overview / Rillet consolidation / Stripe Disputes / Upflow-style collections / Ramp): **mobile 3.0, desktop 5.0, functionality 4.0.**

---

## 1. What the user actually has today (code-verified)

| Route | Who | Data | Actions | States |
|---|---|---|---|---|
| `/dashboard/recovery` (`recovery/page.tsx`, `tracker-client.tsx`), flag `recovery` (404 when off) | owner, manager, bookkeeper (`roles.ts:55`), **active branch only** | `recovery.summary` (totals, ageing, by supplier, plus `byStatus`, `writtenOffAgorot` and `disputedAgorot`, which are **never rendered**), `recovery.list()` (**default limit 200**, `service.ts:275`), `creditLineSuggestions` | Header link to `/leaks/claims` letters. Per-supplier "רישום תעודת זיכוי" opens an inline form. Per-row `<select>` status change (`tracker-client.tsx:278-298`). Tabs: open / all / closed (`useState`, not in the URL) | Empty state (no CTA). **No `loading.tsx`, no `error.tsx`.** Success and error share one status line at the top of the tracker |
| `/dashboard/chain` (`chain/page.tsx`) | **owner only** (`roles.ts:94`), plan `chain` | `chain.overview` (per-branch snapshot under each branch's RLS; it has `invoiceCount`, `pendingLinkCount` and `pendingApprovals`, but **completeness is never shown**), `chain.alerts` (flag) | ViewToolbar (period, **compare off by default**, `chain.ts:335`, CSV, saved views in localStorage). "מעבר לסניף" / "כניסה" = session switch + `window.location.assign('/dashboard')` (`switch-button.tsx:50-51`). Price-gap rows expand (`<details>`) | Upsell, owner-only, empty. **No loading or error boundary.** No-data still renders ₪0 rows and a "👏" clean message |
| `/dashboard/branches` (`branches/page.tsx`, `branch-forms.tsx`) | owner | `chain.branches` | Rename (pencil), switch, open a new branch (copy suppliers, catalog, settings) → full reload with `?created=` | Upsell, not-payer and limit cards |

APIs that exist with no UI:
- `recovery.history` (`routers/recovery.ts:65-67`, `service.ts:887`) has no caller.
- `recovery.transition` accepts **`claimIds[]` (≤200) and `note`** (`recovery.ts:70-92`). The UI sends one id and no note (`tracker-client.tsx:287`).
- `recovery.list` accepts `status` and `supplierId` filters. The tracker uses neither.
- The chain snapshot carries `invoiceCount`, `pendingLinkCount` and `pendingApprovals` per branch (`packages/charts/src/chain.ts:48-71`). Only the summed `pendingApprovals` appears, as a count in a KPI subtitle.

Definitions found while reading:
- **Overdue** = waiting on the supplier more than 14 days since `COALESCE(letter_sent_at, claimed_at)` (`service.ts:262,290`). The "ימים" column shows days since **claim**, so the two clocks differ.
- **Reminders** go to the restaurant's managers by e-mail, one per day (`reminders.ts:18-24`), not to the supplier.
- **"הסניף הכי דולף"** = highest **leak %** (`charts/chain.ts:333-335`). The ranking sorts by **leak ₪** (`chain.ts:317-319`).
- **Chain "נדרש בחזרה מספקים"** = `claimedIls = current.recoveredIls` = discrepancies `accepted|resolved` in the period (`charts/chain.ts:172`, `leak-hero.ts:90-92`). This is not the tracker's "נדרש מהספקים".

Demo counts on 25.10, read off the screenshots: the open list has **48** claims: 11 credited (₪0 still owed), 11 acknowledged, 15 letter sent, 10 claimed (never sent) and 1 disputed. The banner says "32 באיחור · ₪1,522", and **6 of the 32 never went to the supplier.**

---

## 2. Primary tasks, walked end to end

### T1. Owner at the desk: "Chase what suppliers still owe me" (1440 px, recovery)
1. Open "₪ חוזר" (1 click). Four equal tiles. The banner "32 באיחור · ₪1,522 … נשלחת תזכורת במייל" has **no button**.
2. Scroll to the claims (y≈1,520 px). The "פתוחות" tab opens on **11 fully-credited rows** (owe ₪0, aged 75→60 days) before any row that needs the supplier.
3. There is no supplier filter, no "overdue" filter and no sort. Finding Brenner's 5 open claims means reading 48 rows.
4. To chase: the supplier's phone or WhatsApp is not on this page. Suppliers (1) → supplier (1) → copy the number → WhatsApp outside the app → back (1) → find the row again.
5. Record the call: the `<select>` → "הספק אישר" (2). The page refetches, and the confirmation appears ~1,000 px above the row.
6. Nothing records **what the supplier said or when**: `note` is never sent and the history is never shown.

**Count:** about 6 clicks and 2 page loads per supplier, 9 suppliers → **≈54 clicks**, and no trail.
**Benchmark:** collections tools (Upflow/Chaser [K]) and Stripe Disputes: one queue sorted by due date, a one-click reminder from a template, and a timeline per case.

### T2. Owner: "I printed the letters, mark them sent" (desktop)
1. "מכתבי דרישת זיכוי" (1) → `/leaks/claims` → print all (1 + OS dialog). Printing does **not** change any status.
2. Back to the tracker (1). For each of the 10 "נדרש" claims: open the select (1), choose "סימון: מכתב נשלח" (1), then `router.refresh()`.

**Count: 20 interactions + 10 full refetches.** The API would take all 10 ids in one call.
**Benchmark:** Linear / Gmail multi-select → one bulk action → Undo = **3 interactions**.

### T3. Supplier rep: "We issued credit note 4471 for ₪374.59 incl. VAT"
1. "רישום תעודת זיכוי" next to Brenner (1). The form opens with all of Brenner's claims **pre-checked** and the amount **pre-filled with what we expect** (₪320.16).
2. The label says "סכום (₪, לפני מע״מ)". The paper says ₪374.59 incl. 17/18% VAT, so the owner divides by hand.
3. Number, date (native picker, defaults to today), Save (1). If the note ≠ the selected claims, "נשארו ₪X שלא הוחלו" flashes once in the status line. After that the remainder is visible nowhere.
4. Weeks later the credit is offset on a payment. Someone must find each credited row and choose "הכסף חזר" (2 per claim). That state is **terminal**: `recovered → []` (`lifecycle.ts:19`).

**Count:** 3 clicks + typing + mental VAT math, then 2 × N claims later.
**Benchmark:** Xero "Allocate credit" / QuickBooks vendor credit applied in Pay Bills [K] (the credit is consumed by the payment, and no "money back" click is needed).

### T4. Owner on the phone: "Did the butcher credit me?"
1. Bottom bar → "עוד" → "₪ חוזר" (2 taps). The tiles are readable.
2. The per-supplier table shows **ספק / נדרש / זוכה** only. "פתוח" and "שיעור" are cut off to the left, with no scroll cue (`recovery_phone_claims.png`, `page.tsx:110`).
3. The claims table shows **supplier / invoice / item** only. **Amount, status, age and the action are off-screen.** Invoice numbers break mid-token ("BR-" / "24092").

**Result:** the task cannot be finished without discovering a sideways scroll inside a 5,614 px page. **Dead end.**

### T5. Chain owner, Sunday 08:00: "Which branch is worst, why, and fix it" (1440 px, chain)
1. Open "רשת" (1). The worst card names ירושלים (₪975 · 2.9%). The alerts card names ירושלים again ("מחיר גבוה מהמצופה · ₪319"). Good: **0 clicks** to the answer.
2. "Why": the driver is a type and a ₪, with no lines. "מעבר לסניף" (1) → session switch and **full reload onto ירושלים's home**. Chain context and period are lost.
3. בלש דליפות (1) → breakdown (1) → the item. Back to the chain: switcher (1) → own branch (reload) → רשת (1).

**Count: 4 clicks + 1 reload to the item, and 2 clicks + 1 reload to return** (matches `exec-desktop.md` §8 row 3).
**Benchmark target:** roll-up cell → filtered list `?b=jer` → peek = **2 clicks, 0 reloads**, 1 crumb back (Toast Location Overview, Runway drill).

### T6. Chain owner: "How much do suppliers owe us across all branches?"
**Impossible on one screen.** Recovery is per active branch. Per branch: switch (reload) → "עוד" → ₪ חוזר. **3 branches = 9 clicks + 3 reloads**, and you add the numbers up yourself.

### T7. Chain owner: "Jerusalem pays 7% more than Haifa for salmon fillet: fix it"
The price-gap row shows ₪189 impact. **No action**: no contract price, no supplier request, and invoice numbers are plain text. The owner switches branch → contracts → edits by hand: **≥5 clicks + reload, with no evidence pack.**
**Benchmark:** Ramp Price Intelligence (benchmark → negotiate), Ottimate.

### T8. Owner: "Open a 4th branch and get its manager started" (branches)
Name + 3 checkboxes + "פתיחת הסניף" (2 clicks + typing) → full reload → "מעבר לסניף החדש" (another reload) → צוות → invite. **≥5 clicks + 2 reloads.** Nothing on the page says what is still missing (team, POS, first invoice).

---

## 3. Findings

IDs match the structured result. Severities: P0 = blocks or misleads a core task, or risks money or trust. P1 = major friction, or below par vs the benchmark. P2 = polish. P3 = nit.

### 3.1 ₪-back recovery (`/dashboard/recovery`)

**chain-01 · P0 · functional · both.** Money state changes fire from a native `<select>` on change (`tracker-client.tsx:278-298`). That includes "מחיקה" (written off) and "הכסף חזר", which is **terminal** (`lifecycle.ts:19` `recovered: []`).
- **Problem:**
  - There is no confirm, no reason and no undo.
  - In Chromium on Windows, arrow keys on a focused closed select fire `change`, so a keyboard user browsing the options commits the first one.
  - The row then leaves "פתוחות" with a generic "נשמר" far above it.
  - The API's `note` is never sent, so a write-off or dispute carries no reason (H6, H7).
- **Fix:**
  - **Row actions:** one primary "next step" button by status (claimed → "סמנו שהמכתב נשלח"; letter_sent/acknowledged → "רשמו זיכוי"; credited → "אשרו קיזוז/החזר"). The rest go in a ⋯ menu (`menuitem`, arrow keys).
  - **Reversible moves:** optimistic. The mutation is **deferred 10 s** behind an Undo toast ("סומן כנשלח · בטל"), so no reverse lifecycle edge is needed (R-7).
  - **"ויתור" (written_off) and "הכסף חזר":** a ConfirmDialog naming the ₪ and the supplier ("לוותר על ₪12.66 ממחלבות הגליל?") with reason chips ("הספק סירב", "סכום זניח", "טעות שלנו", "אחר"), sent as `note`.
- **Exemplar:** Stripe Disputes (one deliberate submission), Superhuman Undo Send. **Rubric:** C10, C12, H6, F8.

**chain-02 · P0 · functional · mobile.** On a phone, the claims table (`min-w-[640px]`, `tracker-client.tsx:234-235`) and the supplier table (`min-w-[440px]`, `page.tsx:109-110`) cut off **amount, status, age and action** (and "פתוח" + "שיעור"). There is no scroll cue. Invoice numbers wrap as "BR-" / "24092" (`recovery__owner__phone-he_02/_04/_06`, `recovery_phone_claims.png`).
- **Fix:**
  - Below `md`, render **claim cards grouped by supplier** with a sticky group header: "מאפיית ברנר · 5 · ‎₪320.16 פתוח".
  - **Card line 1:** item + **outstanding ₪ at the end** (24 px, 700).
  - **Card line 2:** `<Token>` invoice number (`bdi dir=ltr whitespace-nowrap`) · status chip · countdown chip.
  - **Action:** one full-width 48 px next-step button; ⋯ opens a bottom sheet.
  - **The supplier table becomes cards** with "פתוח ₪" first.
- **Exemplar:** Polaris IndexTable condensed, BILL mobile approvals. **Rubric:** C3, G10, B9, E3.

**chain-03 · P1 · flow · both.** The follow-up loop is split and has no batch:
- Letters are print-only on `/leaks/claims` (`print-button.tsx`), and printing never changes a status.
- Marking sent is one row at a time. **10 claims = 20 interactions + 10 refetches**, although `transition` takes `claimIds[≤200]` (`recovery.ts:70-92`, `tracker-client.tsx:287`).
- **Fix:**
  - **Per-supplier "שלח דרישה" side sheet inside the tracker:** reuse the letter renderer, then "הדפס / PDF" and "העתק לוואטסאפ" (a user-initiated `wa.me` link with the text and PDF link; no outbox). On close, ask "לסמן 5 דרישות של מאפיית ברנר כנשלחו?" and make one `transition` call.
  - **Row checkboxes + sticky batch bar:** "N נבחרו · ‎₪X · [סמנו נשלח] [הספק אישר] [⋯]".
- **Exemplar:** Linear multi-select, Choco "Request for supplier". **Rubric:** C2, I2.

**chain-04 · P1 · trust · both.** Deadlines and chasing are not honest:
- A bare red **"!"** badge and a raw "ימים" since the claim (`tracker-client.tsx:270-276`), while overdue counts from the letter (`service.ts:290`).
- Claims **never sent** are counted "באיחור" (6 of the 32).
- The banner "ללא תעודת זיכוי יותר מ-14 יום — נשלחת תזכורת במייל" (`he.ts:16-17`) reads as if the supplier is chased. The reminder goes to the restaurant's managers (`reminders.ts:18-24`).
- The banner has **no CTA** (`page.tsx:71-79`).
- **Fix:**
  - A countdown chip from `COALESCE(letterSentAt, claimedAt)+14`: "נותרו 4 ימים · עד 29.10" (neutral above 7 days, warn at 7 or fewer, danger "באיחור 9 ימים").
  - Split the banner into two T2 lines: "10 דרישות עוד לא נשלחו לספק · ‎₪612 [שלחו דרישות]" and "26 ממתינות לתשובת ספק מעל 14 יום · ‎₪910 [תזכרו ספקים]".
  - Reminder copy: "תזכורת נשלחת אליכם במייל (לא לספק)".
- **Exemplar:** Stripe Disputes `due_by` / `past_due`. **Rubric:** H8, A5, E9.

**chain-05 · P1 · functional · desktop.** No evidence and no history:
- Rows link nowhere, although `invoiceId` is in the payload (`tracker-client.tsx:253-276`).
- `recovery.history` (`recovery.ts:65-67`) has no UI.
- The credit note number is text, and the letter can't be reached from the row.
- **Fix:** a row click or Space opens a **480 px peek** (inline-end) with:
  - the claim math (expected / charged / Δ, from the discrepancy)
  - links to the invoice line and the dock-slip photo
  - a timeline from `recovery.history` (who, role, from→to, note, `dd.MM.yyyy HH:mm`)
  - the credit-note allocation
  - the next-step button
- **Exemplar:** Brex per-expense audit trail, Linear Peek. **Rubric:** H7, H2, D6.

**chain-06 · P1 · ia · both.** The open list is ordered by claim date (`service.ts:300-304`), so 11 fully-credited rows that owe ₪0 lead. There is no supplier, status or overdue filter and no sort, although the API filters by `status` and `supplierId`. Tabs have no counts and live in `useState` (`tracker-client.tsx:49,79-85,217-232`).
- **Fix:** default tab **"לטיפול"**, grouped by next action, with counts and ₪:
  - "לשליחה (10 · ‎₪…)"
  - "ממתין לספק (26 · ‎₪…)"
  - "במחלוקת (1)"
  - "זוכה — לאשר קיזוז (11)"
  
  Add a supplier filter chip, sortable headers (₪ descending on the first click) and `?tab=&s=` in the URL.
- **Exemplar:** Shopify saved-view tabs with counts, Superhuman split inbox. **Rubric:** C1, D8, C4.

**chain-07 · P1 · trust · both.** The numbers don't reconcile and there is no funnel:
- Tile "נדרש" **₪3,672**, while the supplier rows add up to **₪3,671**.
- "זוכה" ₪1,914 + "עדיין חייבים" ₪1,759 = **₪3,673**. Row קצביית הכרם: 551 + 402 ≠ 952 (each value rounded to whole ₪ separately, `page.tsx:29,121-128`).
- Written-off, disputed and `byStatus` are computed (`service.ts:356-372`) but hidden.
- The recovery-rate hint sits on the "owed" tile.
- The status words drift: נדרש מהספקים / התקבל זיכוי / זוכה / חזר בפועל / הכסף חזר (`he.ts:9-12,51-58`).
- **Fix:**
  - One **funnel bar**, "נמצא → נדרש → זוכה → הוחזר", with side states "ויתרנו ‎₪X · במחלוקת ‎₪Y".
  - Whole-₪ figures that add up exactly: reuse `chain/display.ts` `wholeShekelRows`, or show 2 dp in the supplier table to match the claim rows.
  - Each stage filters the list. One definition per stage (tooltip + glossary).
- **Exemplar:** Stripe balance states (each defined once). **Rubric:** A9, B3, H3.

**chain-08 · P1 · visual · desktop.** No T1 and no single action:
- Four equal `StatCard`s (`page.tsx:54-69`).
- The card titled "תעודת זיכוי" holds **nine identical gold-solid buttons**, with each ₪ amount about 900 px away from its supplier name (`tracker-client.tsx:159-212`, `recovery__owner__desktop-he_01`).
- **Fix:**
  - Hero: "עדיין חייבים לך ‎₪1,759" (metric-hero), with the funnel and **one** primary "תזכרו 9 ספקים · ‎₪1,522".
  - Merge "by supplier" and "credit note" into one per-supplier table (₪ next to the name) with an outline "רשמו זיכוי" in the row's ⋯.
- **Exemplar:** Stripe home (one KPI, one action). **Rubric:** A1, A8, C12.

**chain-09 · P1 · functional · both.** The credit-note form fights the paper:
- The amount is "לפני מע״מ" (`he.ts:75`), but a חשבונית זיכוי prints incl. VAT.
- It is **pre-filled with the amount we expect** (`tracker-client.tsx:344`), and all claims come pre-checked.
- There is no running remainder while selecting.
- The unallocated remainder is shown once in a status line (`:72`) and then disappears.
- There is no photo attachment.
- **Fix:**
  - A "כולל מע״מ / לפני מע״מ" segmented control, defaulting to *incl.* The server converts using the restaurant's VAT setting, never an engine constant.
  - An empty amount with placeholder "כפי שמופיע בתעודה".
  - A sticky footer: "נבחר ‎₪X מתוך ‎₪Y · הפרש ‎₪Z", turning ✓ at 0.
  - A photo attachment ("צלמו את התעודה") with OCR prefill.
  - A persistent "יתרת זיכוי לא משויכת ‎₪X [שייכו]" on the supplier row.
- **Exemplar:** Xero allocate credit [K], xtraCHEF credit memos [K]. **Rubric:** C4, C7, H5.

**chain-10 · P1 · functional · both.** "הכסף חזר" is a manual, undefined, terminal step. 11 credited rows wait for someone to pick it per row (`lifecycle.ts:14-22`), with no link to the pay-run offset (קיזוז) or the ledger.
- **Fix:**
  - Define הוחזר = offset in a payment, or a refund received.
  - Auto-advance credited → recovered when the pay run or supplier ledger records the offset, and show "קוזז בתשלום 12.11".
  - Add a bulk "אשרו קיזוז" for the credited group.
  - Confirm before the terminal state.
- **Exemplar:** BILL vendor credits applied to bills [K]. **Rubric:** A9, C10.

**chain-26 · P2 · states · both.** Every action calls `router.refresh()`. That re-runs `syncClaims` twice: `summary` and `list` both sync (`recovery.ts:49,61`). The result shows in one status line at the top of the tracker (`tracker-client.tsx:57-77,107-119`), often 1,000+ px from the row. Recovery, chain and branches have **no `loading.tsx`/`error.tsx`** (only 5 dashboard segments have one).
- **Fix:** `useOptimistic` row updates, an inline row error + "נסו שוב", an Undo toast, layout-true skeletons and per-segment error cards.
- **Rubric:** I2, C8, C9, I4.

**chain-27 · P2 · functional · desktop.** There is no period, no export and no supplier statement:
- You can't ask "כמה חזר בספטמבר?".
- There is no CSV or XLSX for the accountant.
- There is no per-supplier "דף דרישות" for the monthly statement call.
- `list()` silently caps at 200 rows (`service.ts:275`) while the tiles count all claims.
- **Fix:** a ViewToolbar (period on claimed, credited and recovered dates), CSV/XLSX including the history, a supplier PDF, and pagination with "200 מתוך 340".
- **Exemplar:** Stripe per-section export. **Rubric:** D8, C3, B3.

**chain-28 · P2 · copy · both.** The labels don't name the money:
- "סימון: מכתב נשלח" (label with a colon).
- "מחיקה" for a write-off reads as deleting data.
- "פעולות" as both placeholder and label.
- "תעודת זיכוי" as the heading of a list of suppliers.
- "ימים" is an ambiguous column.
- "שיעור החזר" is defined as credited ÷ claimed.
- The empty state has no CTA (`he.ts:39,43-46,61,66`; `page.tsx:50-51`).
- **Fix:** "סמנו שהמכתב נשלח", "ויתור על ‎₪X", "רשמו זיכוי שהתקבל", "זיכויים לרישום לפי ספק", "ממתין (ימים)" → countdown, "שיעור זיכוי", and an empty-state CTA "לתור האישורים".
- **Rubric:** E9, C8.

**chain-25 · P2 · a11y · both.**
- Every row's select is named just "פעולות".
- The "!" has no text.
- The tabs are `role=tab` with no tabpanel and no arrow keys, and are about 24 px tall (`tracker-client.tsx:217-232,271,280`).
- **Fix:** "פעולות לדרישה BR-24092 · חלה", a countdown sentence, and a radio-group segmented control (44 px on touch).
- **Rubric:** F6, F4, C13.

**chain-33 · P2 · functional · mobile.** Credit notes can't be captured where they arrive: paper, with the next delivery, at the back door. The only automatic route is negative lines on later invoices (`tracker-client.tsx:121-157`).
- **Fix:** see Big move 5.
- **Exemplar:** xtraCHEF / MarginEdge credit tracking [K]. **Rubric:** G8.

**chain-37 · P3 · visual · desktop.**
- The ageing bars use **gold** (the "good news" tone) for money still owed and red from 61 days (`page.tsx:96`).
- The "owed" tile is solid red text with the recovery rate as its hint.
- **Fix:** neutral ink bars with warn and danger only past the deadline; move the rate under "זוכה".
- **Rubric:** A6, B8.

### 3.2 Chain view (`/dashboard/chain`)

**chain-11 · P1 · functional · desktop.** Drilling to a branch is a **session switch + full reload to that branch's home** (`switch-button.tsx:50-51`, `branch-actions.ts:43`). It is used by the worst card, the alerts card and every ranking row (`chain/page.tsx:289-291,332-334,391-395,423-427`).
- **Problem:** the chain context, the period and a way back are all lost. Worst branch → item takes 4 clicks + 1 reload, and returning takes 2 clicks + 1 reload.
- **Fix:**
  - Every ranking cell and KPI links to the target list scoped `?b=<branchId>` (approvals, breakdown, recovery), read through the chain router's per-branch `inBranch` RLS.
  - A breadcrumb "רשת › ירושלים › אישורים".
  - A row click or Space opens a **520 px branch peek**: KPIs, the top 5 open items with ₪, the driver and Δ, and "פתחו את תור הסניף".
  - "עבדו כסניף הזה" (the session switch) moves into ⋯.
- **Exemplar:** Toast Location Overview → location reports, Runway drill, Linear Peek.
- **Rubric:** D6, D8, D5. **Governance:** tenant-security-warden review + COVERAGE entries.

**chain-12 · P1 · functional · desktop.** The chain view is read-only and has no money pipeline:
- The only "act" signal is the count "פתוחים בתקופה 25" (`chain/page.tsx:243-249`).
- Per branch there is no ₪ awaiting approval, no open claims, no recovered ₪, no completeness (invoices checked / pending link: already in the snapshot, `charts/chain.ts:48-71`) and no food cost.
- **There is no chain-wide recovery** (recovery is the active branch only, `recovery.ts:48-56`).
- **Fix:** a roll-up matrix (PT10):
  - **Columns:** דליפה ₪ · % · נתפס לפני תשלום ₪ · ממתין לאישור ₪ · דרישות פתוחות ₪ · הוחזר ₪ · שלמות ("42 נבדקו · 3 ממתינות") · Δ.
  - **A total row pinned on top** that equals the KPIs.
  - **A column chooser.**
  - **A "החזרים ברשת" tab** summing the per-branch recovery summaries, each computed in its own `inBranch` transaction.
- **Exemplar:** Toast Location Overview (15 columns, % of total), Rillet consolidated ↔ entity.
- **Rubric:** A5, H3, C3.

**chain-13 · P1 · rtl · both.** **The heatmap runs time right→left in Hebrew:** מאי sits next to the branch names and אוק׳ is far left (`heatmap_desk_he.png` vs `heatmap_desk_en.png`). The KPI sparkline on the same page runs left→right (`KpiCard.tsx:102-104`), so the page contradicts itself (R-3).
- **Code:** `chain/page.tsx:446-450,461-476` render months in DOM order inside an RTL table.
- **Fix:** keep the name column at the start (right), and lay the month cells out in an `dir="ltr"` grid (oldest left, newest right), with the selected period's end at the right edge. Apply the same to the phone's 3-month slice.
- **Exemplar:** Apple RTL guidance (graphs are not mirrored). **Rubric:** C14.

**chain-14 · P1 · rtl · mobile.** The phone heatmap truncates branch names (`max-w-[7rem] truncate`, `chain/page.tsx:458`) to the **shared prefix**. Rows "כפר הזיתים — …" (ירושלים) and "כפר הזיתים — …" (חיפה) are **indistinguishable**, and there is no `title` (`heatmap_phone_he.png`).
- **Fix:** a `shortBranchName()` that drops the common chain prefix ("ירושלים", "חיפה", "ראשי"). Wrap instead of truncating, and keep the full name as the accessible name.
- **Exemplar:** Polaris "wrap instead of truncate". **Rubric:** C1.

**chain-15 · P1 · trust · both.** No data, pending and clean are the same thing on this page:
- With zero invoices, the worst card shows "אף סניף לא דלף בתקופה הזו. 👏" with a PartyPopper (`chain/page.tsx:284-286`, `he.ts:47`) **next to** "עוד אין נתונים" (`:359-361`).
- The ranking and heatmap still render ₪0 rows.
- A branch with no checked spend ranks as the cleanest. The alerts card says "שבוע רגוע" in the same case.
- **Fix:** three states:
  - **No data (T4):** "ירושלים: אין חשבוניות שנבדקו בתקופה", with a CTA.
  - **Pending (T4):** "3 ממתינות להתאמה".
  - **Clean (T3):** "‎₪0 · 42 נבדקו ✓".
  
  Exclude no-data branches from the worst card and the rank, and drop the emoji.
- **Exemplar:** Primer `unavailable` cells. **Rubric:** A4, A7, H3.

**chain-16 · P1 · flow · desktop.** The hero has no delta and no completeness:
- Compare defaults to `off` (`chain.ts:335`), so "דליפה ברשת ₪2,090" has no Δ.
- With compare on, the delta is "+12%" with an icon only (`KpiCard.tsx:79-87`): no word and no ₪.
- There is no "N נבדקו · M ממתינות".
- **Fix:** default to `prev`, day-aligned (MTD vs the same days last month). Use `DeltaBadge` with an arrow, a word and a signed ₪: "▲ עלייה ‎₪320 (+18%) לעומת 1–25.09". Add a completeness line from Σ `invoiceCount` / `pendingLinkCount`.
- **Exemplar:** Stripe Apps period badges. **Rubric:** A2, A3.

**chain-17 · P1 · functional · desktop.** Price-gap rows are dead ends (`chain/page.tsx:496-582`). ₪189 and ₪180 of impact come with no action, and their invoice numbers are plain text.
- **Fix:**
  - **"בקשו מהספק מחיר אחיד":** a letter preview with both branches' invoice lines as evidence, then print or `wa.me`.
  - **"קבעו מחיר חוזה ‎₪89.00 לכל הסניפים":** write contract prices per branch under each branch's RLS, after a ConfirmDialog that names the ₪ and the branches.
  - **Invoice-line links** open a peek.
  - **An annualised estimate** labelled "הערכה".
- **Exemplar:** Ramp Price Intelligence (benchmark → negotiate), Ottimate. **Rubric:** A5, H1.

**chain-18 · P1 · functional · desktop.** The chain view is **owner-only** (`roles.ts:94`, owner memberships in `resolveScope`). A chain's bookkeeper or CFO, one of the "big bosses", has no cross-branch view at all.
- **Fix:** a read-only chain scope for users who are bookkeeper (or owner) on 2+ branches of the same billing account, with finance KPIs and the recovery roll-up. Add, rename and the plan stay owner-only.
- **Exemplar:** R365 Location Groups per user. **Rubric:** D1, D7.

**chain-19 · P1 · visual · mobile.** On a phone:
- The first viewport is the title plus a **3-row toolbar**. The hero ₪ sits at y≈535–660 CSS px, half covered by the cookie bar on a first visit.
- 4 KPI cards stack for about 860 px.
- The worst-branch CTA is at **y≈1,530**, and the ranking at about **2,070** (`chain__owner__phone-he_00/_01/_02`, `chain/page.tsx:168-250`).
- **Fix:**
  - Below `lg`, collapse the ViewToolbar into one "תצוגה · החודש" chip.
  - One hero card with a 3-up mini row for the other KPIs.
  - The worst branch as the first row under the hero, with "פתחו את התור".
  - Ranking as swipeable branch cards (see Big move 6).
- **Rubric:** A8, G10.

**chain-20 · P1 · copy · both.** Money words drift across surfaces:
- Chain: "נדרש בחזרה מספקים ₪1,271" = discrepancies accepted/resolved in the period across branches (`charts/chain.ts:172`).
- Tracker: "נדרש מהספקים ₪3,672" = all-time claims of the active branch.
- Home: "חזר החודש".
- None of them states its scope.
- **Fix:** the 4 states with one definition each. Rename the chain line "אושר לדרישה · אוקטובר · כל הסניפים", give every tile a scope eyebrow, and add a glossary tooltip.
- **Rubric:** A9, E9.

**chain-21 · P2 · ia · desktop.** "הסניף הכי דולף" (by **%**) and "הסניף לבדוק השבוע" (7 days) name the same branch, with two CTAs (danger-solid + outline) before the ranking (`chain/page.tsx:253-357`). The worst card's basis (`leakPct`, `charts/chain.ts:333-335`) differs from the ranking order (₪, `:317-319`), and the page doesn't say so.
- **Fix:** one "דורש תשומת לב" strip: "ירושלים · 2.9% מהרכש (הגבוה ברשת) · ‎₪975 · השבוע ‎₪343, בעיקר מחיר גבוה ‎₪319 · [פתחו את תור הסניף]".
- **Rubric:** A1, A8.

**chain-22 · P2 · functional · desktop.** The ranking and supplier tables can't be sorted (no `aria-sort`) and have no totals row, no "% מהסך" and no clickable rows. Top suppliers show branch chips but **no per-branch ₪ split** and no supplier link (`chain/page.tsx:367-433,590-643`).
- **Fix:** a DataTable with sortable headers (₪ descending first) and a pinned total. A supplier row expands to its per-branch ₪ and links to the supplier leak card.
- **Exemplar:** Toast, Primer DataTable. **Rubric:** C1, C3.

**chain-23 · P2 · rtl · both.** Signs are concatenated by hand:
- Price gap: `+{formatPercent}` renders **"7%+"** in Hebrew (`chain/page.tsx:540`; crop `chain__owner__phone-he_03`).
- The thin-base delta: `'+'/'−' + ils` (`:412`).
- The KPI delta: `+{delta}%` (`KpiCard.tsx:82-85`).
- **Fix:**
  - Take signs from Intl (`signDisplay:'exceptZero'`) inside `<bdi>`.
  - Add the word ("יקר ב-7%").
  - `formatPercent` can take the option now. **`formatIls` signDisplay is a human PR** (money-format-marshal).
- **Rubric:** E4, A3.

**chain-24 · P2 · visual · both.** Money is set in `font-mono`. Hebrew labels are `uppercase tracking-wider`:
- `KpiCard.tsx:90,93` and `StatCard` labels and values.
- Chain headers, the period label, the worst/alerts eyebrows and the disparity labels (`chain/page.tsx:199,271,303,369,529-548,593`).
- The recovery tables (`page.tsx:92,124-127`).
- The heatmap legend is `text-[11px]` (`:485`).
- **Fix:** `<Money>` in Heebo `tabular-nums`, `ltr:uppercase ltr:tracking-wider` only, and a 12 px floor.
- **Rubric:** B2, E6, B1.

**chain-25b** (folded into chain-25): the heatmap cell's only explanation is `title` (`chain/page.tsx:462-469`), and the legend is `aria-hidden`. Each "כניסה" button lacks the branch name.
- **Fix:** make cells buttons with an `aria-label` sentence that opens the branch-month peek, and label buttons "כניסה לסניף ירושלים".

**chain-31 · P2 · copy · both.** One action, five labels and four variants:
- "כניסה" / "Open" (ghost)
- "מעבר לסניף" / "Go to branch" (danger-solid and outline)
- "Switch to branch" (secondary)
- "מעבר לסניף החדש" (primary)

In Hebrew, "כניסה" reads as "log in" (`chain he.ts:41,46,61,123,142`).
- **Fix:** two verbs: "פתחו את תור הסניף" (drill, link) and "עבדו כסניף הזה" (session switch, ⋯). Never use danger-solid for navigation.
- **Rubric:** C12, E9.

**chain-32 · P2 · perf · both.** There is no `loading.tsx`. Branch snapshots run at concurrency 3 plus alerts, taking 1.55–1.8 s in the lab with 3 branches (`chain.ts:59-60,351-366`). At 5 branches, the page blocks for longer. A non-entitlement error throws to the root boundary.
- **Fix:** stream the KPIs first with Suspense, use layout-true skeletons, and show per-branch error cards ("נתוני ירושלים לא נטענו · נסו שוב").
- **Rubric:** I4, C8, I1.

**chain-39 · P3 · visual · desktop.** Each of the 4 KPI cards carries a glow blob, a `flow-stream` line and an icon chip (`KpiCard.tsx:66-113`), so decoration competes with the ₪.
- **Fix:** at most one accent per view.
- **Rubric:** J4.

### 3.3 Branches (`/dashboard/branches`)

**chain-29 · P2 · functional · desktop.** The page is a bare name list (`branches/page.tsx:73-90`):
- No manager or team, no address or ח.פ, and no health (last invoice, leak this month, ₪ awaiting approval).
- No integrations and no plan usage (1,500 invoices a month shared, `plans.ts:52-58`).
- No invite-to-branch and no deactivate.
- After creating a branch, the only next step is a full switch (`branch-forms.tsx:218-220,272-296`).
- **Fix:**
  - A branch table with these columns: סניף · מנהל/ת · צוות · דליפה החודש · ממתין לאישור ‎₪ · חשבונית אחרונה · אינטגרציות.
  - A row ⋯ menu: שינוי שם, הזמנת מנהל, השבתה.
  - A **launch checklist** on the success card: ספקים הועתקו ✓ · הזמינו מנהל · חברו קופה · חשבונית ראשונה.
  - A plan usage meter.
- **Exemplar:** Shopify Settings › Locations [K], Square locations [K].
- **Rubric:** D1, C8.

**chain-30 · P3 · a11y · both.**
- The rename pencil is a 14 px icon with `p-1` (≈22 px target). The crawl counts 9 small targets on this page.
- Rename has no Esc, and its errors and success show only as toasts.
- The add-branch placeholder "למשל: כפר הזיתים — חיפה" names a branch that already exists, and there is no duplicate-name check.
- Checkboxes are 16 px (`branch-forms.tsx:142-149,153-187,227-237,252-258`).
- **Fix:**
  - A 32 px icon button (44 px on touch) with a tooltip.
  - Enter/Esc inline edit with an inline error.
  - A neutral placeholder.
  - "כבר יש סניף בשם הזה".
- **Rubric:** F4, C5, C9.

**chain-38 · P3 · a11y · both.** The `<title>` is "RestoMatch" on all three routes (crawl `title`).
- **Fix:** "מעקב ₪ חוזר · RestoMatch", "דאשבורד רשתי · RestoMatch", "ניהול סניפים · RestoMatch".
- **Rubric:** F5, J4.

---

## 4. Rubric scorecard (applicable criteria)

| Criterion | Recovery | Chain | Branches |
|---|---|---|---|
| A1 one T1 + one action | **Fail** (4 equal tiles, 9 solid buttons) | Partial (emphasis KPI, 3 CTAs above the fold) | N/A |
| A2 hero story | Fail (no delta, no completeness) | **Fail** (compare off, no completeness) | N/A |
| A4 zero vs no-data | Partial | **Fail** (👏 on no data) | N/A |
| A5 act-now ₪ + verb | **Fail** (overdue banner without CTA) | Partial (count only) | N/A |
| A9 one vocabulary | **Fail** | **Fail** | N/A |
| B2 / E6 Heebo, no tracking | Fail | Fail | Pass |
| B3 precision / totals | **Fail** (3,671 vs 3,672) | Pass (`wholeShekelRows`) | N/A |
| C1 sort / truncate | Fail | **Fail** (shared-prefix truncation) | Pass |
| C2 batch | **Fail** | N/A | N/A |
| C3 phone cards | **Fail** | Partial (columns hidden, readable) | Pass |
| C8 loading / error / empty | Fail | Fail | Partial |
| C10 confirm / undo | **Fail (P0)** | N/A | Pass |
| C12 buttons | Fail | Fail (5 labels) | Partial |
| C14 time axis | N/A | **Fail** | N/A |
| D5 / D6 / D8 wayfinding, peek, URL state | Fail | Partial (URL view yes, drill = reload) | Partial |
| E4 signs | Pass | Fail | N/A |
| F4 targets | Partial | Partial | Fail (9 small) |
| H7 history | **Fail** (API unused) | N/A | N/A |
| H8 countdowns | **Fail** | N/A | N/A |
| I2 optimistic | Fail | N/A | Partial (rename local state) |

---

## 5. Big moves (benchmark-grade)

### BM-1 · "שולחן ההחזרים": a money-back desk that runs like a collections tool (desktop + phone)
- **Why:** the North Star says "₪ that one owner believes". A leak only becomes money when it comes **back**, and FG-31 notes that no restaurant product chases credits through to the money. Today the loop is a print page, a dropdown and an e-mail to yourself.
- **What:**
  - **Layout:** a split view. Start pane: suppliers sorted by `owed ₪ × days overdue`, each with a funnel mini-bar and its next-due date. End pane: the **supplier dossier**:
    - open claims grouped by next action (לשליחה / ממתין / במחלוקת / לאשר קיזוז)
    - the evidence peek per claim
    - a chase timeline (calls, letters, replies, notes)
    - an unallocated credit balance
    - one primary next action ("שלחו דרישה ל-5 שורות · ‎₪320.16", "רשמו זיכוי", "אשרו קיזוז")
  - **Header:** the funnel hero "נמצא → נדרש → זוכה → הוחזר", with ₪ per stage that adds up exactly.
  - **Keyboard:** the triage grammar (J/K, X, 1/2/3, Z, ?).
  - **Phone:** the same dossier as a full-screen sheet.
- **Exemplar:** Upflow / Chaser AR collections (dunning sequences, promise-to-pay, one-click reminder) [K]; Stripe Disputes (due_by, evidence, one submission); Linear triage.
- **Effort:** L. **Governance:** UI + recovery router/service (not immutable). Sends stay user-initiated (print / `wa.me`) until BM-2.

### BM-2 · Supplier claim portal + human-approved auto-chase (FG-31)
- **Why:** follow-up is the bottleneck. 26 claims wait on suppliers, and the only reminder goes to the restaurant.
- **What:**
  - **Send:** the claim goes out by WhatsApp/e-mail with a 72 h token link, reusing the `supplierConfirm` token model. Preview first, then a deferred send with "בטל שליחה".
  - **Supplier side:** the supplier **accepts or disputes per line** and uploads the credit note. Status moves on its own (claimed → acknowledged → credited), and every reply lands in the timeline.
  - **Chase:** a cadence on day 3 / 7 / 14, queued for the owner's one-tap approval.
  - **Copy:** the banner becomes true: "נשלחה תזכורת לספק ב-22.10".
- **Exemplar:** Choco "Request for supplier"; SAP Joule Dispute Resolution Agent (beta); Superhuman Undo Send.
- **Effort:** L. **humanPR: yes.** It touches `notifications/outbox.ts` and cron scheduling (immutable), plus a public token surface (warden review).

### BM-3 · "כל הסניפים" scope + roll-up matrix with in-place drill (P19, P20, PT10)
- **Why:** today the chain owner reads one page, then switches the whole session to act. "5 logins" instead of one queue (FG-37).
- **What:**
  - **Scope chip:** "מוצג: כל הסניפים ▾" (all / each branch / user groups "צפון"), stored in the URL as `?b=`. No reload.
  - **Matrix:** rows are branches with a **pinned total row**. Columns: leak ₪, %, caught, ₪ awaiting approval, open claims ₪, recovered ₪, completeness, Δ, and a 60 px sparkline. Sortable, with a column chooser and "% מהסך".
  - **Drill:** every cell opens the filtered list for that branch, or a 520 px peek, with a breadcrumb back. Approvals, recovery and the pay run gain a "סניף" column under the all scope. Writes run in the row's own tenant context.
- **Exemplar:** Toast "You are viewing" + Location Overview; R365 Location Groups; Rillet consolidated ↔ entity switch.
- **Effort:** L. **Governance:** per-branch `inBranch` reads only. Never widen `applyCoreTenantRls`. Add COVERAGE entries for new procedures (allowed).

### BM-4 · Chain action layer: turn price gaps and drivers into one-click fixes
- **What:**
  - **Each disparity row offers:**
    - "קבעו מחיר חוזה אחיד" (pushes the cheapest price as the contract price to every branch, after a ConfirmDialog naming the ₪ and the branches)
    - "בקשו מהספק מחיר אחיד" (a letter with both branches' invoice lines as evidence)
    - "התראה אם המחיר חוזר" (a watch on the contract)
  - **Each branch driver chip** ("מחיר גבוה מהמצופה ‎₪319") opens that branch's breakdown filtered to the driver.
  - **A weekly "חיסכון שנפתח"** line totals the ₪/year (labelled הערכה) unlocked by the actions taken.
- **Exemplar:** Ramp Price Intelligence (benchmark → negotiate → track); Ottimate cross-location splits.
- **Effort:** M. **Governance:** contracts are data, written per branch under RLS. Not immutable.

### BM-5 · "צלמו תעודת זיכוי" at the back door (mobile)
- **Why:** credit notes arrive on paper with the next truck. The receiver is already there with a phone, and the money is lost when the paper is.
- **What:**
  - A 56 px button in the receiving flow and in recovery mobile opens the rear camera, multi-page.
  - OCR reads the number, date and amount **incl. VAT**, then auto-matches to that supplier's open claims (same allocation, oldest first).
  - The receiver sees the T4 "נקלט, ממתין לאישור". The owner gets a T3 card: "‎₪184 חזרו ממאפיית ברנר · אשרו".
  - Unmatched remainders become a visible supplier credit balance.
- **Exemplar:** xtraCHEF / MarginEdge credit-memo capture [K]; Choco delivery-check credits.
- **Effort:** M. **Governance:** owned by `ocr-procurement-engineer` for capture and the recovery service for allocation. No immutable files.

### BM-6 · "דופק הרשת": a thumb-first chain pulse for the owner's phone
- **What:**
  - **Hero:** the chain ₪ with a delta, at most 40 px.
  - **Below:** a horizontal pager of **branch cards**: name suffix, leak ₪ + %, Δ word, "‎₪X ממתין לאישורך", "N זיכויים באיחור".
  - **Action:** one full-width "פתחו את התור" opens a branch-scoped approvals list in a sheet. Swipe only moves between branches, with buttons twinned.
  - **Below the fold:** the heatmap as a 3-month mini-grid with suffix names, left → right in time.
- **Exemplar:** Brex mobile task inbox; Toast mobile location switcher; Material 3 carousel.
- **Effort:** M.

---

## 6. Sequencing and governance

1. **Safety first (S, no immutable touch):**
   - chain-01: row buttons + ConfirmDialog + deferred-commit Undo + reason → `note`.
   - chain-04: countdown chip + honest banner copy.
   - chain-13 / chain-14: heatmap time direction and suffix names.
   - chain-15: no-data states.
2. **Recovery loop (M):** chain-02 phone cards, chain-03 batch + per-supplier send sheet, chain-05 peek with history, chain-06 action tabs, chain-07 funnel, chain-09 credit form, chain-10 auto-offset. Owner: `web-feature-engineer` (+ the recovery service).
3. **Chain (L, warden-gated):** chain-11 / 12 / 18, then BM-3 and BM-4. Every new cross-branch read goes through `inBranch`, with COVERAGE entries **added** in `cross-tenant.attack.test.ts`.
4. **Human PRs:**
   - `formatIls` `signDisplay` (chain-23, money-format-marshal).
   - BM-2 outbox/cron sends and chase cadence.
   - Any new claim deadline column (not needed: the countdown derives from `letter_sent_at` + `OVERDUE_DAYS`).
   - Server-side saved views (schema).

**North Star check:** every finding either **delivers** recovered ₪ (the follow-up loop, credit capture, chain recovery roll-up) or **protects** belief in the ₪ (reconciling tiles, no false 👏, an honest overdue, a single vocabulary, a non-contradicting time axis).
