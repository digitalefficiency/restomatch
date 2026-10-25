# Fintech & finance-ops dashboards: UX research for RestoMatch

**Researcher lens:** senior UX researcher, fintech / finance-ops
**Date:** 2026-10-25
**Products studied:** Stripe Dashboard (with Stripe Apps design docs, Radar, Disputes, Reports), Ramp, Brex, Mercury, BILL (Bill.com), Airbase, QuickBooks Online, Xero, Pilot. Two reference systems are added where they state a rule more precisely: SAP Fiori (currency control) and Emburse (approval shortcuts).
**RestoMatch surfaces mapped:** leak hero (`apps/web/app/dashboard/page.tsx`), approvals queue (`dashboard/approvals/*`), invoice detail and correction (`dashboard/invoices/[invoiceId]/*`), consolidated cross-match (`consolidated-panel.tsx`), claim letters (`dashboard/leaks/claims`), the ₪-back tracker (`dashboard/recovery/*`), proof sheet (`dashboard/leaks/proof`), monthly report (`dashboard/reports/monthly`), and VAT-at-risk (`dashboard/vat-at-risk.tsx`).

---

## 0. Method and evidence levels

- **The web was only partly reachable.** `WebSearch` worked and returned page-level excerpts with URLs. Direct page fetches did not work: `WebFetch` to `docs.stripe.com` failed DNS, and `curl` through the agent proxy got `CONNECT 403`. Every **[W]** claim below therefore comes from a search excerpt of the cited page, not a full read. Check the live page before quoting it word for word.
- **[K]** marks a claim from my working knowledge of the product's public UI and design writing that I **could not verify this session**. Treat [K] as a strong hypothesis. It is not a citation.
- **[RM-spec]** marks a value I am prescribing for RestoMatch, such as a pixel size, a duration or a threshold. It is a design decision drawn from the pattern, not something the source states.
- **[Code]** marks something I read in the RestoMatch repo this session, with a file and line.
- **Ownership (AGENTS.md):** `formatIls()` is on the **immutability list**, so any change to it is a human-PR proposal routed via `money-format-marshal`. The approvals engine (`packages/api/src/approvals/engine.ts`) and `TOTAL_TOLERANCE_ILS` (`packages/matching/src/engine.ts:22`, ₪0.10) are also immutable. Recommendations below **consume** them and never redefine them.

---

## 1. Current-state evidence ([Code])

These are the facts the principles respond to. Line numbers are from the working tree on 2026-10-25.

| # | Where | What is there now | Why it matters |
|---|---|---|---|
| C1 | `dashboard/page.tsx:478–520` | The leak hero footer can show **4 actions**: report preview, digest preview, proof ("how did we get to ₪X") and the drill CTA. Three are equal-weight bordered pills. | It breaks the "one hero, one action" rule (P1) and dilutes T1. |
| C2 | `lib/components/views/state.ts:70` | `DEFAULT_VIEW.compare = 'off'`, so by default the hero shows **no delta**. The only context is `חודש קודם: ₪X` in `text-xs text-subtle` (`page.tsx:424`). | The owner sees one number with no "is this better or worse?" signal (P2). The text appears to compare month-to-date with a **full** prior month: `leakHero({monthOffset:-1})`. Verify the bounds in `computeLeakHero`. |
| C3 | `page.tsx:410` | The hero ₪ is set in `font-mono` (JetBrains Mono) at `text-5xl/6xl`. Every other ₪ in the app is mono too. | The studied products all set money in their UI typeface with tabular figures [K]. A monospace face reads as "terminal", not "bank" (P6). |
| C4 | `page.tsx:556` | Hero-stat hints are `text-[11px]`. | Below the 12px floor for any explanatory text [RM-spec] (P20). |
| C5 | `approvals/list.tsx:116, 123` | Rows use 2-decimal ₪, but the "₪ at risk" summary tile uses 0 decimals. | A sum that visibly fails to add up hurts trust (P5). |
| C6 | `approvals/list.tsx:65–75` | After each approve or reject, the list **refetches the whole first page**. There are no bulk actions, no undo and no keyboard shortcuts. The list is ordered by `createdAt`. | Throughput and calm suffer (P9–P12). |
| C7 | `approvals/list.tsx:191` | `WhyFlagged` is **hidden entirely** in compact density. | The explanation is the trust signal and should never disappear (P8). |
| C8 | `invoices/[invoiceId]/correction-client.tsx:238` | The scanned document opens on a **separate page** (`/scans/{id}`) from a ghost button. | Fintech AP tools show the document beside the extracted data (P13). |
| C9 | `recovery/tracker-client.tsx:271` | An overdue claim gets a bare **`!`** danger badge. Age is a raw number column (`ageDays`). | There is no deadline, no absolute date and no accessible text (P18). |
| C10 | `recovery/tracker-client.tsx:278–300` | Claim status changes through a native `<select>` that **fires the mutation on change**. That includes `written_off`, which gives up the money, with no confirmation and no undo. | A destructive money action happens without a confirm (P11). |
| C11 | `page.tsx` hero tiles | "נתפס לפני תשלום" (caught), "הוחזר" (recovered) **and** a separate "returned this month" tile all sit together in gold or green. | Two near-synonyms for money coming back blur the money-state model (P19). |
| C12 | `lib/components/views/DeltaBadge.tsx:22` | `upIsGood` defaults to `false`, and spend can render `neutral`. | **Already right** for the leak (an increase is bad). Keep it and extend it (P3). |

---

## 2. Principles (24)

Each principle has a **Rule**, which is checkable; its **Source**; the **Evidence** behind it; and how it **Applies to** RestoMatch.

### A. Presenting money

**P1. One hero number, one comparison, one action.**
- **Rule:** The leak hero has exactly **one** primary CTA (solid), at most **one** tertiary text link, **one** delta line and **one** sparkline. Every other link moves into a "עוד ▾" overflow or below the hero. Check: the hero DOM holds at most 2 interactive elements in its footer.
- **Source:** Stripe Apps "Chart layout" pattern, which puts the headline value above the chart [W: docs.stripe.com/stripe-apps/patterns/chart-layout]. Stripe Dashboard home leads with one KPI per card [K]. Mercury's home leads with a single balance figure [K].
- **Applies to:** `LeakHero` (C1). Primary = "הצג את החשבוניות" (drill; danger-solid only when leak > 0). Tertiary = "איך הגענו ל-₪X?" (proof). The report and digest previews move to the Reports nav and a hero overflow.

**P2. A comparison is on by default, like-for-like, and honest about a thin base.**
- **Rule:** The default view compares **month-to-date with the same day-span of last month** (Oct 1–25 vs Sep 1–25), never with a full prior month. When the prior base is thin (existing `isThinBase`), show the ₪ difference only and drop the %. Phrase it "לעומת 1–25 בספטמבר".
- **Source:** Stripe Apps analytics shows "badges that summarize the current period with the previous period (if sufficient historical data is available)" [W: docs.stripe.com/stripe-apps/analytics]. Stripe's newer charts support comparison periods natively [W: chart-layout]. A Stripe mobile release note places "past period data on the left and current period data on the right" [W: apkmirror release note, a weak source].
- **Applies to:** C2. Set `DEFAULT_VIEW.compare = 'prev'` for the hero only, or compute a fixed MTD-vs-MTD delta inside `leakHero`. Replace `hero.lastMonth` with a DeltaBadge.

**P3. Delta colour follows the metric's meaning, never its sign.**
- **Rule:** Leak ₪ or leak % going **up** is danger and going **down** is green. Spend changes are neutral (ink, no colour). Caught, recovered and returned going **up** is gold or green. Every delta carries an arrow glyph **and** a word ("עלייה" or "ירידה") so it never relies on colour alone, which is WCAG 1.4.1.
- **Source:** Stripe Apps Badge offers semantic types `positive`, `negative`, `warning`, `urgent`, `info` and `neutral` [W: docs.stripe.com/stripe-apps/components/badge]. A Mercury breakdown reports red and yellow "reserved strictly for errors and warnings" [W: 925studios.co/blog/mercury-design-breakdown, third-party].
- **Applies to:** `DeltaBadge` already defaults `upIsGood=false` (C12). Add `upIsGood` to the caught, recovered and returned `HeroStat` deltas and to the claims dashboard.

**P4. Sparklines show direction. Tables give the precise values.**
- **Rule:** A sparkline has no axes, no labels and no gridlines. Size it at **120×32 px** on desktop and **96×28 px** on mobile [RM-spec]. Draw a 1.5px stroke and mark the last point with a 4px dot. Give it an `aria-label` sentence ("מגמת דליפה ב-30 הימים האחרונים: יורדת, מ-₪1,240 ל-₪860"). It is never the only place a number appears; the BreakdownChart table toggle holds the exact values.
- **Source:** Stripe Apps Sparkline is "compact… no axes or labels, placed inline next to a KPI value", and you should *not* use sparklines "when users need precise values" [W: docs.stripe.com/stripe-apps/components/sparkline; chart-layout].
- **Applies to:** Add one to the hero, beside the ₪ (the `Sparkline` component exists, `lib/components/Sparkline.tsx`). Reuse it in the supplier leak card and in the price-alert rows.

**P5. A precision contract: round the headline, stay exact where users add up or claim.**
- **Rule:**
  - (a) Hero and KPI tiles may round to whole ₪ (0 dp).
  - (b) Any ₪ a user might **add up, claim, pay or type** shows 2 dp: line deltas, claim lines, credit notes, pay-run rows.
  - (c) A total shown **next to its rows** uses the rows' precision.
  - (d) Every rounded figure exposes the exact agorot value on hover or focus (a `title` attribute or a tooltip) and in the proof sheet.
  - (e) Store money as integer minor units and format only at display.
- **Source:** Stripe CurrencyField's value is "a positive integer representing the monetary amount in the smallest currency unit" [W: docs.stripe.com/stripe-apps/components/currencyfield]. SAP Fiori's currency control keeps amounts "aligned on the decimal point" [W: sap.com fiori currency usage]. Stripe's support note says home charts are "estimated" and points to Financial Reports for exact figures [W: support.stripe.com dashboard-home-page-charts].
- **Applies to:** C5. Format the approvals "₪ at risk" tile with `maximumFractionDigits: 2`, or round both. The proof sheet already pairs `round` with `exact`, so make that the house pattern. Any new `formatIls` option is a **human-PR via money-format-marshal**.

**P6. Set money in the UI typeface with tabular lining figures, not in a code font.**
- **Rule:**
  - ₪ amounts use the UI family (Heebo) with `font-variant-numeric: tabular-nums lining-nums`.
  - JetBrains Mono is reserved for **identifiers**: invoice numbers, allocation numbers (מספר הקצאה), credit-note numbers and SKUs.
  - The hero figure gets weight 700–800 with tracking −0.02em.
  - Mono stays only where columns of IDs must align.
  - Check: no `font-mono` on any element whose text comes from `formatIls`.
- **Source:** Stripe, Mercury and Ramp all render balances in proportional brand sans faces with tabular digits; none use monospace for money [K]. A Xero user request asks to "right align the column of numbers… so that the decimal points… are in a line" [W: productideas.xero.com right-align request], which shows that alignment, not monospacing, is the user need.
- **Applies to:** C3, across the dashboard. First verify that Heebo's Latin digits expose `tnum`. They are Roboto-derived, so they should. If not, load a digits-only `unicode-range` subset of a face that does, via `packages/ui-tokens` (rtl-design-steward).

**P7. Signs, direction and bidi are explicit.**
- **Rule:**
  - Deltas use a real minus (U+2212) or plus placed **before** the currency symbol, with `signDisplay: 'exceptZero'`.
  - Each formatted amount is wrapped in `<bdi>`, or a `dir="ltr"` span when it sits inside Hebrew prose, so the sign never detaches in RTL.
  - Owner UI never uses accounting parentheses `(₪120)`.
  - A credit is labelled in words ("זיכוי ₪120") rather than signalled by sign alone.
- **Source:** Intuit Content Design says "For negative amounts, place the minus symbol in front of the currency symbol" and "Include commas in amounts in the thousands and greater" [W: contentdesign.intuit.com/style/numbers]. QuickBooks lets parentheses or a red minus vary by region and settings, which shows how easily sign conventions drift [W: QuickBooks community threads].
- **Applies to:** DeltaBadge, the claims letters (`leaks/claims`) and the recovery credit lines. `signDisplay` support in `formatIls` is a human-PR proposal.

### B. Explaining and proving the number

**P8. Every flag explains itself: expected, actual, difference, and why.**
- **Rule:**
  - Every discrepancy, in **all densities**, shows three numbers: **Expected**, **Charged** and **Difference ₪ (+%)**.
  - It names the **source of "expected"** and its date ("מחיר חוזה 12.3 · עודכן 01.09").
  - It gives the **rule** that fired, with its threshold.
  - Compact density collapses this to one line; it is never removed.
  - Optional: a multiplier chip, "+18% מעל החציון שלך ל-90 יום".
- **Source:** Stripe Radar "risk insights… more details about why we assigned a payment a particular risk level". Signals carry badges with a "fraud factor… a likelihood multiplier compared with the average", for example 3.5x [W: stripe.com/docs/radar/reviews/risk-insights]. Radar uses five named risk levels [W: docs.stripe.com/radar/risk-evaluation].
- **Applies to:** C7. Make `WhyFlagged` mandatory and give it a compact one-line variant. The same block appears on the invoice line (correction-client) and on each claim line.

**P9. The hero number is provable to the agora, one tap away.**
- **Rule:** The hero ₪ itself (or the tertiary link from P1) opens the proof: Σ lines = hero to the agora, with counts. The proof states its scope in one sentence ("כל החשבוניות שהותאמו בין 1–25 באוקטובר; לא כולל 3 חשבוניות ריכוז ממתינות"). Anything that is an estimate (annualised leak, ROI, VAT at risk if unclaimed) carries the word "הערכה".
- **Source:** Stripe home charts give "estimated information about your account activity" and send users to Financial Reports for accurate figures [W: support.stripe.com]. Stripe also warns that "no line item or column in any financial report directly corresponds to the available, pending, or reserved balance" [W: support.stripe.com compare-dashboard-exports]. That is exactly the confusion an explicit scope sentence prevents.
- **Applies to:** `leaks/proof` (exists, behind the `leakProof` flag). Promote it to always-on for finance roles, and add the scope sentence to the hero's `hero.calc` footnote.

**P10. Show freshness and completeness next to the number.**
- **Rule:** Directly under the hero: "עודכן לפני 4 דק׳ · 42 חשבוניות נבדקו · 3 ממתינות להתאמה". The month carries a state chip: **פתוח** (live) or **סגור** (closed, with the date). The monthly report names its close date.
- **Source:** Pilot says its "dashboards aren't monthly snapshots — they're live views", while its formal close lands "by the 10th business day" (Core) [W: pilot.com/platform/dashboards; pilot.com/blog/pilot-vs-median]. This separates a live estimate from a closed figure.
- **Applies to:** The hero (the matched and pending counts already exist: `matchedInvoiceCount`, `pendingLinkCount`), plus `reports/monthly` and the PDF.

### C. Exception and approval queues

**P11. One inbox, sorted by money × urgency, ending in "inbox zero".**
- **Rule:**
  - Every act-now item for the viewer's role sits in **one** queue: discrepancy decisions, VAT allocation numbers missing, claims due, and receiving counts awaiting.
  - Default sort: **blocking first, then ₪ difference descending, then oldest**. The `createdAt` cursor becomes a secondary key.
  - The tab label carries the count and ₪ ("לאישור · 7 · ₪3,412").
  - The empty state is T3 good news ("אין מה לאשר. כל ₪ מוסבר."), never a grey void.
- **Source:** Ramp puts "all approvals for reimbursements, transactions, bills, and spend requests" in the Inbox tab [W: support.ramp.com Reviewing transactions]. Brex's mobile app "opens to a personal task inbox… handled right from your inbox in a few taps" [W: brex.com product announcement, tasks at a glance].
- **Applies to:** C6, in `approvals/page.tsx` and `list.tsx`. Ordering is a `myQueue` input; no engine change is needed.

**P12. Bulk actions: select, a sticky bar with count and ₪, and per-item audit.**
- **Rule:**
  - Each row gets a checkbox (44×44 hit area), plus "בחר הכל בתצוגה" (select all in view).
  - A sticky bottom bar appears on the first selection. It shows "N נבחרו · ₪X" and **one** primary ("אשר N") plus a secondary ("דחה…", which asks for one shared reason).
  - Items with `severity = block` are **not** bulk-approvable: their checkbox is disabled, with the tooltip "דורש בדיקה פרטנית".
  - A bulk action writes **one audit entry per item**.
- **Source:** Ramp's bulk actions include Approve from the "For Approval" tab, plus reminders and mark-paid [W: support.ramp.com Managing bills and payments on Bill Pay]. BILL mobile: "Select → choose bills → Approve Selected", and "swipe right" approves a single bill [W: vendorpayhelp.bill.com iOS/Android approving bills]. Broadsign documents that a bulk approve's status "is not logged in the Content Approval Requests tab", an audit gap to avoid [W: docs.broadsign.com].
- **Applies to:** `approvals/list.tsx` (client loop over the existing `approve` mutation, or a new batch procedure plus a COVERAGE entry), `recovery/tracker-client.tsx` (bulk "letter sent") and the pay-run.

**P13. Reversible decisions are instant with undo. Irreversible ones confirm and name the money.**
- **Rule:**
  - Approve, reject and escalate are optimistic: the row leaves in **180 ms** (height plus opacity, disabled under `prefers-reduced-motion`) [RM-spec].
  - A toast "אושר · ₪412.50 · בטל" stays for **8 s** [RM-spec]. The server commit is deferred or compensating.
  - The list never refetches the whole page.
  - Irreversible or costly actions (write-off, sending a claim letter to a supplier, marking paid) use a ConfirmDialog whose button names the amount and party: "מחק ₪1,240 מהדרישה לספק תנובה".
- **Source:** Stripe Apps quality requirements say "Provide confirmation dialogs for any costly or destructive actions that aren't easily reversible", "Handle all loading states", and "Use concise and descriptive labels for buttons" [W: docs.stripe.com/stripe-apps/review-requirements]. Stripe Disputes gives "only one opportunity to submit your response" [W: docs.stripe.com/disputes/responding], the canonical irreversible money action.
- **Applies to:** C6 and C10. Replace the recovery `<select>` with buttons plus a confirm for `written_off` and `disputed`.

**P14. Desk roles get keyboard throughput.**
- **Rule:**
  - `J/K` move between items, `X` selects, `A` approves, `R` rejects (focuses the reason field), `E` escalates, `O` opens the invoice, `Shift+A` approves the selection, `?` shows the cheat-sheet and `/` focuses search.
  - Shortcuts are inert while an input has focus.
  - The focused row has a 2px primary focus ring.
  - Shortcut hints appear in button tooltips ("אשר · A").
- **Source:** In Stripe Dashboard, pressing `?` gives "a list of available keyboard shortcuts for common actions", and Enter in search opens all results [W: docs.stripe.com/dashboard/basics; support.stripe.com search]. In Emburse, approvers can "approve or deny… using the key A or D, reassign using R, or move back or next using < and >" [W: help.spend.emburse.com release notes]. A Ramp customer complained about approving "27 reimbursement requests… a lot of clicks", and Ramp said shortcuts were coming [W: community.ramp.com/t/…/690].
- **Applies to:** Approvals (bookkeeper and manager), recovery tracker and the catalogue mapping queue.

**P15. On a phone, the decision fits under a thumb.**
- **Rule:** Below 640px each queue card shows the ₪ difference at **≥24px/700**, the supplier and item on one line, and the 3-number "why" line. Approve and reject are **full-width 48px buttons pinned to the card bottom**, with approve on the thumb side; in RTL that is the start edge, on the right. Swipe-to-approve is optional and always paired with buttons; swipe is never the only path. Push and WhatsApp notifications deep-link straight to the card.
- **Source:** BILL lets you approve a single bill "by swiping right" and also offers Select → Approve Selected [W: vendorpayhelp.bill.com]. A Brex G2 reviewer gets "notifications to my phone… easy… to review and approve expenses directly through the app" [W: g2.com via search]. Ramp texts users for receipts and accepts a photo reply, with the reply text becoming the memo [W: support.ramp.com Submitting receipts].
- **Applies to:** Approvals on mobile, the receiver flow (`showcase/receiver`, `receiving/[poId]`) and WhatsApp deep links (outbox is immutable, so only the link targets change).

### D. Reconciliation and documents

**P16. The document sits beside the data, and the two are linked.**
- **Rule:**
  - At ≥1024px the invoice page is a **2-pane split**: the document takes **44%** (sticky, zoom 50–400% in 25% steps, rotate 90°, page thumbnails) and the lines and discrepancies take **56%** [RM-spec].
  - Hovering or focusing a line highlights its region on the image when OCR boxes exist. Otherwise it scrolls the image to the line's page.
  - Below 1024px, a segmented control "מסמך | שורות" swaps the panes and the scroll position is preserved.
  - The scan never requires leaving the page.
- **Source:** Ramp auto-matches a receipt to its transaction by "merchant, amount, and date". Unmatched receipts go to "Missing items" for manual attach [W: support.ramp.com Submitting receipts]. Ramp Bill Pay and BILL show the bill image beside the editable fields on the bill detail [K].
- **Applies to:** C8 in `invoices/[invoiceId]/page.tsx` and `correction-client.tsx`: inline the `/scans/{id}` viewer as the **start-edge** pane, which is the right pane in Hebrew RTL (see the RTL note after P24).

**P17. Reconciliation has named states with counts, and "needs review" is the default.**
- **Rule:** Every match surface (three-way match per invoice, consolidated cross-match, supplier ledger) uses the same 4 states, with counts in the tab labels:
  - **לבדיקה** (needs review): danger or warn, with ₪.
  - **הותאם** (matched): calm green check, collapsed by default.
  - **ממתין** (pending): T4 neutral, with a *reason*, e.g. "מחכה לתעודת משלוח".
  - **הוחרג** (excluded): with who, why, and an Undo.
  - One source line maps to **at most one** counterpart, and the counterpart shows inline.
- **Source:** QuickBooks' bank feed uses **For review / Categorized / Excluded**. Every transaction must be added, matched or excluded. "Only one bank transaction can match one QuickBooks entry". Excluded items can be restored with Undo [W: fitsmallbusiness.com QBO bank feeds; Intuit community mini-guide]. Ramp's three-way match uses receiving statuses "Not received" and "Partially received" [W: support.ramp.com 3-Way Match].
- **Applies to:** `consolidated-panel.tsx`, `suppliers/ledger`, the invoice line table and receiving. Pending stays T4, per AGENTS.md: consolidated invoices are never a false alarm.

**P18. Suggested matches show their basis and need an explicit accept. Bulk-accept is for high confidence only.**
- **Rule:** Each proposed match shows *why* ("סכום זהה · תאריך ±1 יום · מס׳ תעודה 4471") and a confidence label (**גבוהה** / **בינונית**). Only high-confidence rows may be pre-checked. "אשר את כל ההתאמות הוודאיות (12)" is the only bulk accept. Medium needs a per-row tap. A wrong suggestion can be dismissed so that it never returns.
- **Source:** Xero "automatically suggests matches… You can check these matches are correct and accept them" [W: xero.com bank-reconciliation]. Xero users report that suggestions "may not be correct" and stay ticked after edits [W: productideas.xero.com, clear suggested matches]. Its matching is "based on the amounts… being the same"; invoice-number matching is not supported [W: productideas.xero.com matching by invoice number].
- **Applies to:** The consolidated cross-match (`consolidated.proposal`), catalogue mapping (`catalog/mapping`; auto-link at ≥0.95 already exists, so show that confidence) and credit-note allocation.

**P19. A running remainder counts down to zero.**
- **Rule:**
  - When the user allocates many to one (delivery notes to a consolidated invoice, claims to a credit note, payments to invoices), a sticky footer shows "נבחר ₪X מתוך ₪Y · הפרש ₪Z".
  - Z turns **green with a check** at |Z| ≤ `TOTAL_TOLERANCE_ILS` (read from the engine, currently ₪0.10; never redefine it).
  - Confirm is disabled otherwise, with an explicit escape: "רשום את ההפרש כהתאמה…" (record the difference as an adjustment, with a reason).
- **Source:** In Xero Find & Match, "the combined total of the selected items must equal the bank transaction amount". The common workaround is to add an adjustment "for the difference… the amount your balance is out by" [W: help.1stformations.co.uk Xero find & match; help.pay.com.au]. Xero users explicitly request a running total of selected transactions [W: productideas.xero.com show-total-of-selected].
- **Applies to:** `consolidated-panel.tsx` and `recovery/tracker-client.tsx` (`CreditForm`).

### E. Trust, audit and lifecycle

**P20. Every money object has an immutable, human-readable history.**
- **Rule:**
  - Invoice, discrepancy, claim and PO pages each have a "היסטוריה" timeline: **who** (name and role), **what** (verb), **before → after** (₪ and status), **when** (absolute `dd.MM.yyyy HH:mm`, Asia/Jerusalem, plus a relative hint) and **source** (OCR, user, rule `#id`, or supplier reply).
  - Each entry is read-only and kept for at least the 7-year Israeli bookkeeping retention [RM-spec].
  - It is reachable in one click from every ₪ figure that a decision changed.
  - Explanatory text is never smaller than 12px.
- **Source:** Brex's per-expense audit trail lists "budget mapping, policy reviews, itemizations, manual approvals, rejections, accounting categorization, payment, and returns" [W: brex.com/product-announcements/streamline-expense-audits]. BILL's trail shows "who created a bill, who approved a bill, the date… who paid the bill, and the date that the payment went out" [W: destinationcrm.com via search; BILL mobile help].
- **Applies to:** The audit log exists (security stack). Surface it per object. It also fixes C4: the 11px hints become 12px or more.

**P21. Deadlines are countdowns with an absolute date, and "overdue" is said in words.**
- **Rule:**
  - Any item with a clock (VAT allocation-number deduction deadline, supplier claim reply window, credit expected by) shows "נותרו 6 ימים · עד 31.10.2026".
  - At ≤7 days the badge is warn-solid. When late it is danger-solid with "באיחור 3 ימים".
  - The badge's accessible name is the full sentence.
  - The queue sorts by days left within each severity.
  - **A bare "!" is never allowed.**
- **Source:** Stripe disputes expose `evidence_details.due_by` and `past_due`, and there is "only one opportunity to submit your response" [W: docs.stripe.com/api/disputes; docs.stripe.com/disputes/responding].
- **Applies to:** C9 in `recovery/tracker-client.tsx`, plus `vat-at-risk.tsx` and the invoice VAT note (which already has `daysLeft`; lift it into a countdown badge).

**P22. Money states are a small, defined taxonomy, used identically everywhere.**
- **Rule:**
  - Recovery money has exactly **4 states**: **נמצא** (found), **נדרש** (claimed: a letter was sent), **זוכה** (credited: a credit note was received) and **הוחזר** (returned: the money is back or was offset on payment). Each has a one-line definition in a tooltip and the glossary.
  - They render as a funnel bar on the hero and on the recovery page, with the ₪ per stage.
  - "Caught before payment" is a property of **found**, not a fifth state.
  - The hero never shows two tiles whose names are synonyms.
- **Source:** Stripe defines **Available** ("funds ready to pay out"), **Pending** ("funds still within the settlement window") and **Reserved** ("funds held by Stripe for risk purposes"), and warns that these don't map 1:1 to report lines [W: support.stripe.com compare-dashboard-exports; docs.stripe.com/reports/balance].
- **Applies to:** C11: merge "recovered" and "returned this month" in the hero. The same applies to `recovery/page.tsx`, the monthly report and the claim letters.

**P23. Price alerts carry benchmark context and a materiality threshold.**
- **Rule:**
  - Every price alert shows **your price**, **your contract price** and **your 90-day median**.
  - It also shows **% over** and **₪ per month at current volume**.
  - An alert is "material" (T2) only at ≥3% **and** ≥₪50/month [RM-spec]. Below that it is T4 info.
  - The copy names the action: "בקש זיכוי" or "פתח משא ומתן".
- **Source:** Ramp Price Intelligence benchmarks "contract pricing against millions of Ramp transactions, down to the individual SKU". It flags quotes "materially higher than average". A Ramp customer's goal was to be "within a 5% or less variance of what the best price is". Ramp also discloses that its analysis "may be based on incomplete or outdated data" [W: support.ramp.com Price Intelligence; ramp.com/customers/crossbeam].
- **Applies to:** `contracts/overview-card.tsx` (PriceAlertsTeaser), `products/[productId]` and the `dock-price-notes.tsx` "your usual price" note.

**P24. Onboarding reaches the first ₪ fast and shows progress toward it.**
- **Rule:**
  - First value = **the first discrepancy in ₪ on the owner's own invoice**.
  - Onboarding is a checklist of **at most 4 steps** with a visible "2/4". Suggested steps: connect or photograph 1 invoice, add 1 supplier contract or last price, run a match, see the ₪.
  - Until then, the hero shows a **labelled sample** ("דוגמה") state with a "העלה חשבונית" CTA, never a ₪0 that looks like a clean month.
  - Time-to-first-₪ target: **≤10 minutes** [RM-spec].
- **Source:** Stripe and Ramp both open new accounts on a setup checklist with completion state before any real data [K]. Ramp's three-way match lets you create item receipts "directly in Ramp… You do not need to have a direct ERP integration", which removes an integration as a prerequisite for first value [W: support.ramp.com 3-Way Match].
- **Applies to:** `onboarding/page.tsx`, the empty states of the dashboard hero, and the marketing `leak-check` (already a no-login first-value path; make its result a T1 hero identical to the in-app one).

> **RTL note that applies to all of the above:** In Hebrew the reading start is the **right** edge. Where a source puts the document "left" and the data "right" (an LTR product), RestoMatch mirrors it with logical properties (`start`/`end`). The **document sits at the start (right)** because users read the paper first and then verify the data. The severity rail on cards stays on the `end` edge as it is today. Every number group is wrapped in `<bdi>`.

---

## 3. Patterns (14)

Each pattern lists its exemplar, an anatomy (spec) and where it lands in RestoMatch.

### PT1. Hero KPI block
- **Exemplar:** Stripe Dashboard home (one metric, a delta vs previous period, a chart under it) [W: chart-layout; K]. Mercury's home balance [K].
- **Anatomy** [RM-spec]:
  - Eyebrow: "אוקטובר · עד 25.10 · פתוח".
  - Label: "דלף החודש".
  - ₪ value at 56–64px/800 in the UI font with tabular figures.
  - Delta line: "▲ ₪320 (+12%) לעומת 1–25 בספטמבר".
  - Sparkline 120×32.
  - Context line: "1.8% מההוצאה על מזון (₪46,210) · יעד ≤1.5%".
  - One primary CTA and one tertiary "איך הגענו?" link.
  - Freshness line (P10).
- **RestoMatch use:** `LeakHero` in `dashboard/page.tsx`. It replaces 4 footer buttons with 1 + 1 and adds the delta and sparkline by default.

### PT2. Period-over-period delta badge
- **Exemplar:** Stripe Apps analytics badges, shown only "if sufficient historical data is available" [W].
- **Anatomy:**
  - Arrow glyph, then signed ₪ (U+2212 or +), then % in parentheses, then "לעומת …".
  - Colour comes from the metric's good direction (P3).
  - With a thin base, show the ₪ only plus the "בסיס קטן להשוואה" tooltip.
  - Wrap it in `<bdi>`.
- **RestoMatch use:** `DeltaBadge` (exists). Adopt it on the hero by default, on supplier cards and in the monthly report.

### PT3. Inline sparkline next to every trend-bearing KPI
- **Exemplar:** Stripe Apps `Sparkline` (props `data`, `x`, `y`, optional `color`, `tooltip`) [W].
- **Anatomy:** Sizes as in P4. A tooltip on hover or focus shows the date and ₪. The `aria-label` is a summary sentence. The colour is muted ink for neutral series and danger only for the leak series.
- **RestoMatch use:** Hero, `suppliers/[id]/leak-card`, price alerts and recipe food-cost tiles.

### PT4. Unified action inbox
- **Exemplar:** Ramp Inbox (all approvals in one tab) [W]. Brex mobile task inbox [W].
- **Anatomy:**
  - Tabs: "לטיפולי (7 · ₪3,412)" / "ממתין לאחרים" / "טופל".
  - Sort: severity, then ₪, then age.
  - The summary strip (count · ₪ at risk · blockers) stays sticky on scroll.
  - Inbox zero is a T3 state.
- **RestoMatch use:** `dashboard/approvals`, extended with VAT-missing and claim-due items, plus `dashboard/inbox`. Reconcile with the existing inbox route so there is one inbox, not two.

### PT5. Select + sticky bulk-action bar
- **Exemplar:** Ramp bulk Approve from "For Approval" [W]. BILL "Select → Approve Selected" [W].
- **Anatomy:**
  - Row checkbox and header "select all in view (N)".
  - A sticky bottom bar slides in over 160ms [RM-spec]: "N נבחרו · ₪X · [אשר N] [דחה…] [נקה]".
  - Block-severity rows are excluded.
  - Keyboard `X` and `Shift+A`.
  - The audit trail gets one entry per item.
- **RestoMatch use:** Approvals, the recovery tracker ("סמן כנשלח" for N claims) and the pay-run export.

### PT6. Thumb-zone decision card (mobile)
- **Exemplar:** BILL swipe-right approve plus explicit buttons [W]. Brex "few taps" inbox [W].
- **Anatomy:** ₪ difference at ≥24px. A 3-number why-line. Two 48px full-width buttons at the card bottom. Swipe is optional. After a decision the next card slides up and a "בטל" toast shows for 8s.
- **RestoMatch use:** Approvals below 640px and the receiver (gloves, a hurry, the back door): count confirmation cards use the same 48px rule.

### PT7. "Why flagged" risk-insight panel
- **Exemplar:** Stripe Radar risk insights with factor badges ("3.5x") and named risk levels [W].
- **Anatomy:**
  - Title "למה סומן?".
  - Three numbers: expected (with its source and date), charged, and difference (₪ and %).
  - A factor chip ("×1.18 מהחציון ל-90 יום").
  - The rule fired and its threshold ("סף: ±₪0.10").
  - Routing ("עבר אליך כי: מנהל · מעל ₪500").
  - A one-line compact variant.
- **RestoMatch use:** `WhyFlagged` in `approvals/list.tsx` (exists; make it mandatory and compact-capable), invoice lines and claim lines.

### PT8. Document ⇄ data split view
- **Exemplar:** Ramp receipt matching (auto-match by merchant, amount and date; unmatched go to Missing items) [W]. The Ramp and BILL bill-detail layout [K].
- **Anatomy:** As in P16: 44/56 split, sticky viewer, zoom and rotate, line ↔ region highlight, and a mobile segmented toggle. A "OCR confidence" dot per field (green ≥0.95, amber 0.80–0.95, grey below 0.80) [RM-spec], linked to the per-restaurant `ocrReviewThreshold`.
- **RestoMatch use:** `invoices/[invoiceId]` (inline the `/scans` viewer), `receiving/[poId]` and `orders/capture`.

### PT9. Reconciliation state tabs
- **Exemplar:** QuickBooks For review / Categorized / Excluded with one-to-one matching and Undo [W]. Ramp receiving statuses [W].
- **Anatomy:** As in P17: 4 states with counts. "Needs review" is the default. Matched rows are collapsed. Pending carries a reason. Excluded carries Undo.
- **RestoMatch use:** The invoice line table, `consolidated-panel.tsx`, `suppliers/ledger` and the receiving list.

### PT10. Suggested match with basis and confidence
- **Exemplar:** Xero suggested matches you check and accept [W], including its documented failure modes (wrong suggestions stay ticked) [W].
- **Anatomy:** Each proposal shows its match basis and a confidence label. Only high confidence is pre-checked. "אשר את כל הוודאיות (N)" accepts in bulk. A dismissed suggestion never returns.
- **RestoMatch use:** The consolidated cross-match, catalogue mapping (show the ≥0.95 auto-link confidence and let users revert it) and credit-note to claim allocation.

### PT11. Running remainder ("out by") footer
- **Exemplar:** Xero Find & Match (selected total must equal the amount; adjustment for the difference) [W] and the user demand for a running total [W].
- **Anatomy:** A sticky footer "נבחר ₪X מתוך ₪Y · הפרש ₪Z". It turns green at |Z| ≤ the engine's `TOTAL_TOLERANCE_ILS`. The confirm stays disabled until then, with an adjustment escape that requires a reason.
- **RestoMatch use:** `consolidated-panel.tsx` and `CreditForm` in `recovery/tracker-client.tsx`.

### PT12. Per-object audit timeline
- **Exemplar:** Brex per-expense audit trail [W]. BILL's approver trail [W].
- **Anatomy:**
  - A vertical timeline, newest first.
  - Each entry: avatar or initials, then role chip, then verb, then a before→after ₪ or status diff, then an absolute timestamp.
  - A source tag (OCR, user, rule #, supplier).
  - Collapsed to the 3 latest, with "הצג הכל (12)".
  - Exportable with the claim letter.
- **RestoMatch use:** The invoice detail, discrepancy (approval card expand), claim row expand and PO detail.

### PT13. Deadline countdown + one-shot submission
- **Exemplar:** Stripe disputes (`due_by`, `past_due`, one submission) [W].
- **Anatomy:**
  - Badge "נותרו N ימים · עד dd.MM": neutral above 7 days, warn-solid at ≤7, danger-solid when overdue, with the words "באיחור N ימים".
  - The submit step previews exactly what the supplier receives (the letter PDF), then confirms with the amount and supplier named.
- **RestoMatch use:** Recovery (claims), VAT-at-risk (the allocation-number deduction deadline), and claim letters (`leaks/claims`, "שלח" step).

### PT14. Live view vs closed-period report
- **Exemplar:** Pilot's live dashboards vs a formal close by business day 10 [W]. Stripe's estimated home charts vs exact Financial Reports [W].
- **Anatomy:**
  - The dashboard is labelled "חי · מתעדכן".
  - The monthly report is labelled "סגור ב-05.11 · לא ישתנה". It is frozen, and any late change appears as a dated correction line, never a silent restatement.
  - Both link to each other.
- **RestoMatch use:** `reports/monthly` (and its PDF route) vs the dashboard hero, and the owner digest email (preview at `reports/digest`).

---

## 4. Screen-by-screen prescriptions

### 4.1 Leak hero (`dashboard/page.tsx`): T1
1. ₪ in Heebo with tabular figures at 56px (mobile) or 64px (≥640) (P6). Exact agorot in the `title` (P5).
2. Delta vs MTD of last month **on by default** (P2, PT2). Remove the `text-xs` "חודש קודם" line.
3. A 30-day sparkline beside the figure (P4, PT3).
4. Footer: **1** primary ("הצג את החשבוניות", danger-solid only if leak > 0) and **1** tertiary ("איך הגענו ל-₪X?"). Report and digest go to an overflow (P1).
5. Tiles: **Caught before payment** (gold), **Recovery funnel** (found → claimed → credited → returned, a single bar with ₪ per stage) and **Invoices checked** (N/M). Remove the duplicate "returned" tile (P22).
6. Freshness and completeness line (P10). Hints at ≥12px (C4).
7. Clean month: a green check sentence plus "₪0 דלף · 42 חשבוניות נבדקו". Never show a bare ₪0 without the count, or a ₪0 before any data (P24).

### 4.2 Approvals (`dashboard/approvals/*`): T2
1. Sort by severity, then ₪, then age (P11). Tab and summary counts with ₪ in 2 dp, consistent with the rows (P5).
2. `WhyFlagged` in every density, with the compact one-liner (P8, PT7).
3. Optimistic row exit with an 8s undo toast. No full refetch (P13).
4. Checkboxes and a sticky bulk bar. Block severity is excluded (P12, PT5).
5. Shortcuts `J/K/X/A/R/E/O/?` (P14).
6. Mobile thumb-zone card (P15, PT6).
7. Per-item audit expand (P20, PT12).
8. Copy: name the decision's money effect. "אשר" alone is ambiguous: does it mean pay as invoiced, or accept the discrepancy? Use **"אשר תשלום כפי שחויב"** vs **"דחה ובקש זיכוי"** so the button says what happens to the ₪.

### 4.3 Invoice detail (`dashboard/invoices/[invoiceId]/*`)
1. A document ⇄ data split, with the document at the start (right) edge in RTL (P16, PT8).
2. Line table states: needs review, matched, pending (with reason) and excluded (P17, PT9).
3. Each flagged line uses the inline WhyFlagged (P8).
4. VAT allocation number: a countdown badge (P21) instead of the paragraph.
5. A history tab (P20).
6. Primary action by state: if the invoice has open discrepancies, the primary is "החלט על N פערים · ₪X". If it is clean, there is no primary, only "סמן כנבדק" as secondary. "Re-run match" moves to an overflow, because it is a technical action, not the job.

### 4.4 Consolidated invoice (`consolidated-panel.tsx`): T4 by default
1. Suggested delivery-note links show their basis and confidence. Only high confidence is pre-checked (P18, PT10).
2. A running remainder to ₪0.10 (P19, PT11).
3. Pending stays neutral grey or info; never danger (AGENTS.md T4).

### 4.5 Claims and recovery (`leaks/claims`, `recovery/*`): T3 for wins, T2 for due items
1. The funnel taxonomy is the same as the hero's (P22).
2. Countdown badges replace `!` (P21, PT13).
3. Replace the status `<select>` with explicit buttons. Write-off and dispute require a ConfirmDialog that names the ₪ and the supplier (P13).
4. Bulk "letter sent" (PT5). The credit-note allocation has a running remainder (PT11).
5. A letter preview before "send" (PT13). After send, the claim moves to "נדרש" with a dated audit entry (P20).
6. Celebrate recovered money with a calm gold line ("₪1,240 חזרו החודש מ-3 ספקים"). No confetti, no motion over 200ms [RM-spec].

### 4.6 Reports (`reports/monthly`, `leaks/proof`)
1. The closed-period label, close date and frozen numbers (PT14).
2. The headline structure mirrors the hero exactly: same labels, same funnel, same precision rules (P5, P22).
3. The proof's scope sentence ("כולל / לא כולל") sits at the top (P9).
4. Tables right-align ₪ (in RTL, the numeric column aligns to the `end` edge with decimals lined up) and use tabular figures (P6). Negative and credit amounts appear in words plus a sign (P7).

---

## 5. Anti-patterns to remove (checklist)

- [ ] More than 1 primary or equal-weight action in the hero footer (C1).
- [ ] A delta hidden by default, or a month-to-date vs full-month comparison (C2).
- [ ] `font-mono` on `formatIls` output (C3).
- [ ] Any explanatory text below 12px (C4).
- [ ] A total and its rows at different precision on one screen (C5).
- [ ] A full-list refetch after a single-row decision. Destructive state changes with no confirm (C6, C10).
- [ ] The explanation hidden in compact mode (C7).
- [ ] The document only on a separate route (C8).
- [ ] A bare `!` badge, or a raw `ageDays` with no deadline (C9).
- [ ] Synonym money tiles ("recovered" next to "returned") (C11).
- [ ] Colour as the only carrier of good or bad on a delta (WCAG 1.4.1).
- [ ] A ₪0 shown before any data exists. It must be a labelled sample or empty state.

---

## 6. Sources

**Stripe**
- Chart layout pattern: https://docs.stripe.com/stripe-apps/patterns/chart-layout
- Analytics (period comparison badges): https://docs.stripe.com/stripe-apps/analytics
- Sparkline component: https://docs.stripe.com/stripe-apps/components/sparkline
- Badge component: https://docs.stripe.com/stripe-apps/components/badge
- CurrencyField (minor units): https://docs.stripe.com/stripe-apps/components/currencyfield
- Stripe Apps quality/review requirements: https://docs.stripe.com/stripe-apps/review-requirements
- Stripe Apps review changelog (external-link icon rule): https://docs.stripe.com/stripe-apps/review-changelog
- Stripe Apps style (design tokens): https://docs.stripe.com/stripe-apps/style
- Home page charts are estimates: https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights
- Dashboard basics (`?` shortcuts) and search: https://docs.stripe.com/dashboard/basics · https://support.stripe.com/questions/how-do-i-perform-searches-in-the-dashboard
- Disputes (one submission, `due_by`, `past_due`): https://docs.stripe.com/disputes/responding · https://docs.stripe.com/api/disputes
- Radar risk insights and risk levels: https://stripe.com/docs/radar/reviews/risk-insights · https://docs.stripe.com/radar/risk-evaluation
- Balance states and reconciliation: https://docs.stripe.com/reports/balance · https://docs.stripe.com/reports/payout-reconciliation · https://support.stripe.com/questions/compare-dashboard-exports-to-financial-reports
- Mobile release note, past/current period order (weak source): https://www.apkmirror.com/apk/stripe-llc/stripe-dashboard/

**Ramp**
- Bill Pay approvals: https://support.ramp.com/hc/en-us/articles/4417843897747-Bill-Pay-approvals
- Managing bills, bulk approve: https://support.ramp.com/hc/en-us/articles/27579228841875-Managing-bills-and-payments-on-Bill-Pay
- Recurring bills approval toggle: https://support.ramp.com/hc/en-us/articles/8952397876883-Creating-and-managing-recurring-bill-payments-on-Ramp-s-Bill-Pay
- 3-way match: https://support.ramp.com/hc/en-us/articles/30227975187731-3-Way-Match-with-Ramp-Procurement
- Receipts, SMS and auto-match: https://support.ramp.com/hc/en-us/articles/360042588454-Submitting-receipts-memos-and-accounting-for-your-Ramp-transactions
- Reviewing transactions (Inbox): https://support.ramp.com/hc/en-us/articles/4417421399699-Reviewing-transactions-from-Ramp-cards
- Price Intelligence: https://support.ramp.com/hc/en-us/articles/17522214341523-Price-Intelligence-on-Ramp · https://ramp.com/customers/crossbeam
- Community threads: https://community.ramp.com/t/reimbursement-approval-on-desktop-with-fewer-clicks/690 · https://community.ramp.com/t/inbox-for-all-users/216

**Brex**
- Audit trails: https://www.brex.com/product-announcements/streamline-expense-audits
- Mobile task inbox: https://www.brex.com/product-announcements/view-tasks-at-a-glance-in-the-brex-mobile-app
- Payment approvals: https://www.brex.com/product-announcements/payment-approvals-now-easier-to-find-in-app
- Reimbursements: https://www.brex.com/product-announcements/reimbursements-improvements

**BILL**
- iOS approving and denying bills: https://vendorpayhelp.bill.com/hc/en-us/articles/360007254691-iOS-Mobile-App-Approving-and-denying-bills
- Android: https://vendorpayhelp.bill.com/hc/en-us/articles/360006989592-Android-Mobile-App-Approving-and-denying-bills
- Audit trail quote: https://www.destinationcrm.com/Articles/CRM-News/CRM-Featured-Articles/Bill.com-Extends-to-the-Mobile-Market-74631.aspx

**Xero**
- Bank reconciliation: https://www.xero.com/accounting-software/bank-reconciliation/
- Suggested-match issues: https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/51662221-clear-suggested-matches-after-creating-a-prepaymen · https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/46600471-bank-reconciliation-suggestions-matching-by-in
- Running total request: https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/45318157-bank-account-transactions-show-total-of-select
- Right-align request: https://productideas.xero.com/forums/967118-payroll-expenses/suggestions/51354373-au-payroll-right-align-amount-in-new-super-page
- Find & match guides: https://help.1stformations.co.uk/accounting-service/using-xeros-find-and-match-function · https://help.pay.com.au/hc/en-au/articles/14199908283791-How-do-I-manually-reconcile-payments-in-Xero
- Dashboard: https://www.xero.com/uk/accounting-software/dashboard

**QuickBooks / Intuit**
- Bank feeds: https://fitsmallbusiness.com/quickbooks-bank-feeds/ · https://quickbooks.intuit.com/community/banking-4/quick-answers-a-mini-guide-to-mastering-your-bank-feed-24644 · https://quickbooks.intuit.com/community/banking-4/excluding-vs-deleting-unmatched-bank-feed-transactions-21351
- Intuit Content Design, numbers: https://contentdesign.intuit.com/style/numbers/

**Pilot**
- https://pilot.com/platform/dashboards · https://pilot.com/blog/pilot-vs-median

**Mercury (third-party breakdown, unverified)**
- https://www.925studios.co/blog/mercury-design-breakdown

**Airbase**
- No first-party source reached. For threshold-routing context only: https://www.tacto.ai/en/procurement-glossary/procurement-approval-thresholds

**Reference systems**
- SAP Fiori currency: https://www.sap.com/design-system/fiori-design-web/v1-136/ui-elements/currency/usage
- Emburse approval shortcuts: https://help.spend.emburse.com/hc/en-us/articles/25385779725709-February-22-2024-Release-Notes-Expense-Approval-Shortcuts
- Broadsign bulk-approval audit gap: https://docs.broadsign.com/broadsign-platform/en/Documentation_Static_Operations/s-o-mandatory-design-approval.html
- 3-way-match tolerances: https://en.tacto.ai/buyer-lexicon/three-way-match · https://help.getply.com/en/articles/16153888-how-to-create-and-review-a-3-way-match

**Coverage gaps (be honest):** No first-party Airbase material was found, and no first-party Mercury design writing. Exact Stripe home and Ramp or BILL bill-detail layouts are [K]. Re-verify every [W] excerpt on the live page before quoting it in client-facing material.
