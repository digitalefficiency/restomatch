# Next-gen ERP, procurement & AP automation: UX research for RestoMatch

**Topic:** what the newest ERP / procure-to-pay / AP products do, and what RestoMatch should copy.
**Owner direction (2026-10-25):** benchmark the newest players, especially modern ERP and advanced
ordering. **Most work happens on the phone** (receiver at the back door, chef, floor manager placing
orders). The **big bosses** (owner, bookkeeper, multi-branch) **work on desktop, and the desktop has to be
organized much more efficiently.** Functionality matters as much as looks.
**Date:** 2026-10-25 · **Author:** product/UX research subagent · **Scope:** research only. No code was changed.

---

## 0. Method and evidence levels

| Tag | Meaning |
|---|---|
| **[Web]** | A WebSearch result summary of the named page (URL in §9). **WebFetch could not reach any vendor page in this session.** `getaddrinfo ENOTFOUND` came back for ramp.com, support.ramp.com and ottimate.com, and the egress proxy returned `403` to `curl` for the same hosts. So every [Web] claim comes from the search engine's summary of the cited page, not from a direct read. Labels in quotes are as the summaries gave them. |
| **[Know]** | My own product knowledge (cutoff mid-2026), not re-verified this session. Treat it as a hypothesis to check. |
| **[Code]** | Read in this repo (`/home/user/restomatch`). Paths are given. |
| **[Shot]** | Local-lab screenshots in `…/scratchpad/ux/shots/` (owner role, he, 1440 px desktop / 390 px phone). |

Vendor capability and accuracy figures (for example "99% OCR" or "93% auto-booked") are **vendor-reported**. I quote
them as product direction, not as benchmarks.

---

## 1. Who works where (the two-device split)

| Persona | Device and context | Core jobs in RestoMatch | Routes today |
|---|---|---|---|
| **Receiver** (מחסנאי / טבח שמקבל) | Phone, one hand, at the back door, driver waiting. Multilingual: he/en/ru/th/ar/ti overlays exist (`lib/i18n/messages/receiverLangs/overlays/*`) | Count the delivery, photograph the invoice, flag a short or damaged delivery | `receiving`, `receiving/[poId]` (5-step wizard) |
| **Chef / floor manager** | Phone, between services, ~2 min at a time | Reorder from suppliers, count inventory, check a price | `orders/new`, `orders/capture`, `inventory/count`, `recipes` |
| **Owner on the move** | Phone, push or WhatsApp driven | Decide flagged invoices, see today's leak in ₪ | `approvals`, `/dashboard` (leak hero) |
| **Owner at the desk / bookkeeper** | Desktop 1440–1920 px, weekly or monthly, 30–90 min sessions | Pay run, claims, consolidated invoices (חשבוניות ריכוז), monthly close, export | `approvals/pay-run`, `leaks/claims`, `invoices/[invoiceId]`, `suppliers/ledger`, `reports/monthly`, `exports` |
| **Chain owner** | Desktop | Compare branches, find the worst supplier or branch | `chain`, `branches`, `leaks/breakdown` |

**Implication:** the phone UI is a set of **short single-task flows** (≤3 min, ≤5 taps for the common path).
The desktop UI is a set of **queues worked in batches** (list + document + decision on one screen, keyboard,
bulk). These are two different products sharing one data model. Today the app is mostly one responsive layout
that stretches between them.

---

## 2. Current-state evidence (what the benchmarks get measured against)

1. **Desktop navigation is 20 top tabs in two rows** at 1440 px (`dashboard/nav.tsx` `NAV_ITEMS`, 19 keys plus search,
   branch switcher, language, logout). Content sits in a column about 1,100 px wide, which leaves about 170 px of
   dead margin on each side [Shot `dashboard__owner__desktop-he.png`]. There is no sidebar, no collapsed rail and no
   badge counts except contracts.
2. **The overview is one long column about 3,950 px tall at 1440 px**, roughly 4.4 screens on a 900 px-high
   laptop. It stacks the leak hero, VAT at risk, a 17-row leak "heatmap" list, KPI cards, menu-cost card, price
   creep and the activity feed [Shot].
3. **The invoice correction page (`invoices/[invoiceId]`) has no source document on screen.** The header fields and
   lines are plain inputs. The image is one link away (`correction-client.tsx:238 → /scans/[id]`, a separate page).
   No per-field confidence is shown. The only confidence shown anywhere is page-level, in the receiving review
   subtitle `'חשבונית {number} · ביטחון OCR {confidence}'` (`lib/i18n/messages/receiving/he.ts:85`) [Code + Shot].
4. **Approvals are one card per discrepancy, not per invoice** (`approvals/list.tsx`, `myQueue` items keyed by
   discrepancy). There are no checkboxes, no bulk action and no keyboard shortcuts (the only `keydown` handlers in
   `dashboard/` are the nav drawer, the branch switcher and the products names-grid).
   - Good already: a "Why flagged?" box with expected/actual, tolerance and routing (`WhyFlagged`), URL-based
     filters, saved views and a density toggle (`ViewToolbar`), and a summary strip (in queue, ₪ at risk, blockers).
   - On the phone, the **first approve button sits about 1,000 CSS px down**, below the fold of a 390×844 viewport,
     after the title, the 5-control filter toolbar and the 3 summary tiles. The approve/reject pills sit inline at the
     bottom-start of each card [Shot `dashboard_approvals__owner__phone-he.png`].
5. **The pay run (`approvals/pay-run`) is a stack of per-supplier cards** with status chips ("ניתן לשלם",
   "להשהות — ממתין להחלטה", "ממתינה לשיוך להזמנה"). It has no selection, no "mark paid" batch and no keyboard. Its
   only output is a CSV export [Shot `dashboard_approvals_pay-run__owner__desktop-he.png`]. The T2/T3/T4 tone mapping
   is already correct (`toneOf()` in `pay-run/page.tsx`).
6. **Receiving on the phone:** in step 2/5 "צלם את החשבונית", the global bottom tab bar is drawn over the camera frame
   [Shot `dashboard_receiving_ID__owner__phone-he.png`]. The flow does not switch into a focused task mode.
7. **New order on the phone** is a 4-step wizard (ספק → פריטים → סקירה → נשלחה) that opens on a native `<select>`
   "— בחרו ספק —". There is no reorder of the last order, no par levels and no "order day today" cue
   (`orders/new/wizard.tsx`, no `reorder`/`par`/`template` symbols) [Code + Shot].
8. **Notification plumbing exists:** channels `'email' | 'whatsapp' | 'push'` (`packages/api/src/notifications/delivery.ts`)
   and a WhatsApp Cloud notifier (`notifications/whatsappCloud`). Delivery cadence lives in the **immutable**
   `outbox.ts` and `apps/worker/src/cron.ts`.
9. **The approval engine has 7 priority rules** (STATE.md): duplicate-invoice 100, large-invoice-without-PO 95,
   unordered-item 90, severity-block 80, cumulative-large 70, cumulative-medium 60, minor-info auto-approve 10, then the
   manager queue. The engine (`packages/api/src/approvals/engine.ts`) is **immutable**.

---

## 3. What the newest players actually do (benchmark digest)

### Ramp (Bill Pay, Procurement, Agents)
- **Smart OCR (Ramp Plus):** extracts line fields (description, amount, quantity, unit price, type, tax rate). It
  identifies the vendor, uses that vendor's past invoices and **applies saved per-vendor custom instructions**. It
  learns from corrections. **OCR runs once per bill;** a changed file is not re-scanned [Web: support.ramp.com "Ramp Bill Pay OCR"].
- **Agents for AP (launched 2025-10-07):**
  - Auto-codes line items from vendor history ("85% of accounting fields right the first time").
  - Screens fraud on 63 data points before a bill is created, including **new or changed bank details**.
  - Gives **approval recommendations plus a summary of vendor history, contracts, prior bills and coding
    consistency**. Ramp reports 90,000 recommendations at a 90% acceptance rate.
  - Gmail inbox ingestion is in beta. Ramp "does not … approve bills through a reply".
  [Web: ramp.com/blog/ramp-ap-agents-announcement; cpapracticeadvisor 2025-10-07; support "AP Agents available in Ramp Bill Pay"]
- **Policy Agent:**
  - Outputs **"Approval recommended" / "Requires review" / "Rejection recommended"** with reasoning. **Hovering the
    (i) on the label shows which policy rule it used.**
  - Defaults to suggest-only. Auto-approve is opt-in, per workflow step.
  - Reviewers can choose **"Policy is wrong"** and get a focused diff of the proposed policy change.
  [Web: support "Use Policy Agent for approvals", "Policy Agent Overview", "Update your policy on the fly during expense review"]
- **Approval chains:**
  - Built from Condition / Approval / Notify / terminal "Approve bill" steps.
  - Conditions on amount, entity, vendor and accounting category. Vendor-owner, department and manager conditions
    are Plus-only.
  - Admins can **test a workflow and revert to past versions**.
  - Approvers can see **who is next**, and Admins can skip approvals and pay now.
  [Web: support "Bill Pay approvals", "Bill lifecycle"]
- **Reminders and channels:** "Approval needed" Slack DMs, then **reminders at day 2 and day 3**. Rejections notify all
  approvers and the creator. Approvals show up in the **Inbox → Bills tab, the same on mobile**, and payers can
  **release payments straight from the Inbox** [Web: support "Bill Pay approvals"; ramp.com/blog/how-ramp-uses-ramp-bill-pay].
- **Bill states:** "Missing info" / "Ready" (drafts) → "For approval" → "Scheduled" / "Ready for payment" →
  "Initiated", plus "Waiting for match" and "Payment failed" [Web: support "Bill lifecycle"].
- **3-way match:** bill ↔ PO ↔ item receipt. Receiving statuses are **"Not received" / "Partially received"**.
  Quantity is tracked only for inventory-coded lines; other lines are only received or not received
  [Web: support "3-Way Match with Ramp Procurement"].
- **Procurement agents (2026-04-29):** conversational intake that asks follow-ups, pre-fills the request and **catches
  policy violations before the approver's queue**. Agents never approve on their own [Web: support "Agentic Intake
  Programs"; cpapracticeadvisor 2026-05-01].
- **Price Intelligence:** SKU-level benchmarks and renewal alerts. Ramp warns its analysis "may be based on incomplete
  or outdated data" [Web: support "Price Intelligence on Ramp"].
- **Receipts:** capture by SMS, WhatsApp, the app, email, Slack or a Chrome extension, with automatic matching
  ("95% matched same day", vendor claim) [Web: support "Submitting receipts…"].
- **Demand signal for desktop speed:** Ramp community threads ask for **Bill Pay keyboard shortcuts ("Ctrl-A to
  approve" exists for card transactions)** and for **prev/next while approving** so users need not return to the
  list [Web: community.ramp.com/t/bill-pay-shortcuts/1463, …/1122].

### Zip (intake-to-procure)
- One "front door" for requests. AI turns plain-language requests into completed forms.
- **Intake agents check details, compare price to historical benchmarks and review contract terms before approvers
  see the request.** 50+ agents.
- Zip sits in front of the ERP and carries structured context into PO and invoice matching
  [Web: softwareconnect Zip review; ziphq.com "Zip in 2025"; erpresearch].

### Ottimate (formerly Plate IQ, restaurant-native AP)
- Line-item GL coding, invoice upload from phone or tablet, and approvals plus payments in the mobile app.
- **Line items split across locations** with routing to the right approvers.
- 3-way match alerts "when something doesn't line up".
- **Contract Pricing:** set item price thresholds. A vendor that breaks the agreed price (example: $47 raised by about 1%)
  triggers an email, and the invoice lands in **"Needs Attention"**.
- **Duplicate detection on date + invoice number + vendor name.** Blurry or incomplete images also go to "Needs Attention".
[Web: ottimate.com/industry/restaurants, /feature/po-match; support "How to Use Contract Pricing", "Duplicates, Handwritten Invoices, Blurred Images"]

### Tipalti
- Separate agents for Invoice Capture and PO Matching (the matching agent reads line descriptions).
- **Tolerance thresholds count near-misses as matched.** Failed matches go to exception approvals, which **approvers
  can action by email without logging in** [Web: tipalti.com PO Matching / Invoice Management].

### Brex / Navan (spend policy UX)
- Brex **auto-approves in-policy spend and auto-declines out-of-policy spend, so managers only see flagged items**,
  and can handle those in Slack or SMS.
- Brex Assistant runs **"auto-pilot" on by default, switchable from a settings icon**, and warns that it "may make
  mistakes".
- Navan auto-flags out-of-policy expenses, can **switch the approver** to someone with more context, and can auto-reject
  above hard limits.
[Web: brex.com/support/brex-assistant, brex.com/platform/brex-ai; navan.com/blog …expense-approvals]

### AI-native ERPs: Rillet, Campfire, Puzzle
- **Rillet:**
  - Perpetual ledger; the agents **propose journal entries and you approve or adjust**.
  - **Close checklist with task owners, deadlines, dependencies and approval workflows.** Flux drafts run during the
    month, so "day one is review, not rebuild".
  - Claims "93% of journal entries automatically booked"; audit trails; segregation of duties.
  [Web: rillet.com/product/close-management, blog "reach zero-day close", January 2026 product update]
- **Campfire:**
  - Ember agents run on a schedule (flux, close prep). **Every agent action is logged, sourced to GL data and
    reviewable before it posts.**
  - **Confidence thresholds set how much the system acts versus surfaces for review.**
  - Flux commentary is drafted on material variances.
  [Web: fortune.com press release 2026-03-12; campfire.ai]
- **Puzzle:**
  - "Governed automation": the AI drafts and a human approves.
  - It **reviews 100% of transactions for inconsistencies**, such as the same vendor booked to different categories.
  [Web: puzzle.io/blog/ai-accuracy-review-for-accountants]

### Odoo 17/18 (the "modern classic" ERP)
- **Ctrl/Cmd+K command palette** with prefixes: `/` for menus and apps, `@` for users. **Holding Ctrl (macOS) or Alt
  (Windows/Linux) reveals the shortcut on every control.**
- Readable URLs (`/odoo/project/5/tasks`). Alt+Shift+U company switcher (Odoo 18) [Web: odoo.com/documentation/18.0 keyboard shortcuts; braintec release note].
- Vendor bills: after upload, a **preview of the document appears on the right side of the screen** next to the form.
  Odoo 19 adds digitization with "Reload AI Data" then Confirm [Web: cybrosys Odoo 19 digitization].
  Third-party Odoo 18 OCR modules sell a **resizable, collapsible split view** [Web: apps.odoo.com aspl_ocr_bill_ee, smart_ocr_vendor_bills].
- 3-way match through **Bill Control = "Received Quantities"**, plus a Purchase Matching view of ordered / received /
  billed [Web: cybrosys "How 3-way matching works in Odoo 18"].
- **Barcode app receipts:** a kanban of receipts, scan-to-add, a pop-up when the quantity is short, and multi-scan in
  one action (Odoo 18) [Web: cybrosys Odoo 18 barcode book; nalios].

### Restaurant-specific modern apps
- **Restaurant365 Red App:** approves AP invoices **and payment runs** on mobile. Mobile was redesigned in Oct 2025.
  Bulk approve/deny exists on desktop [Web: docs.restaurant365.com "R365 App AP Approvals"; restaurant365.com AP Center].
- **Choco:** orders "in just three taps", digital order guides with **pars**, one app for all distributors. The order
  is converted to the supplier's channel (WhatsApp/SMS/fax) [Web: choco.com/restaurants].
- **Price alerts:**
  - xtraCHEF Price Tracker reports **average % change and $ impact** per item, filterable by location and vendor.
  - COGS-Well cost alerts **default to 3%**.
  - Craftable warns on price change **at the moment the invoice is approved**.
  [Web: intercom.help/toast-central xtraCHEF price tracker; cogs-well helpscout; help.craftable.com]

### Israel: Israel Invoices (חשבוניות ישראל) allocation numbers
- Allocation-number threshold (before VAT): **₪20,000 in 2025 → ₪10,000 from 1 Jan 2026 → ₪5,000 from 1 Jun 2026.**
- Without a valid allocation number above the threshold, **the buyer cannot deduct input VAT**. From **1 Aug 2025**
  the related expense is also **not deductible for income tax**.
- The ITA can refuse numbers for "irregular" invoices.
- The ITA offers a **service for authorized businesses to verify a supplier invoice's data against what the supplier
  reported, by allocation number** (access needs ITA-site registration and authorization).
[Web: KPMG TaxNewsFlash 2025-12; Sovos; Herzog; Priority SOP_Tax_Authorities_IL_25_0_H.pdf; chamber.org.il]

---

## 4. Principles (24)

Each principle is checkable: it states a threshold, size, count or label. "Applies to" names the RestoMatch route.

### A. Capture and extraction

**P1. Confidence belongs to fields and lines, not to the page.**
*Source:* Ramp Smart OCR per-line fields; Campfire confidence thresholds; Odoo 19 "Reload AI Data → Confirm".
*Rule:* tier every extracted header field and every line cell:
- ≥0.95: plain, no mark.
- 0.80–0.95: amber dot plus "בדוק", text-only tooltip.
- <0.80: red outline, and it is placed **first in tab order and auto-focused**.

Add a **sum check**: if Σ line totals ≠ subtotal by more than ₪1.00, or subtotal + VAT ≠ total, show a T2 banner
"הסכומים לא מסתדרים: ‎₪12.40 הפרש" above the lines. Drop the page-level "ביטחון OCR 92%" subtitle once tiers exist.
*Applies to:* `receiving/[poId]` RECONCILIATION_REVIEW step, `invoices/[invoiceId]` (`correction-client.tsx`). Reuse
the per-restaurant `settings.ocrReviewThreshold` for the lower bound.

**P2. The source document sits beside the data whenever there is room.**
*Source:* Odoo bill preview on the right; Odoo 18 resizable split modules; Ottimate review.
*Rule:*
- At ≥1280 px, `invoices/[invoiceId]` is a **two-pane layout**: document 50% (sticky, zoom 100/150/200/300%, rotate
  90°, page thumbnails if multi-page), data 50%. Focusing a line scrolls the document to that line's page; if the OCR
  returns a bounding box, draw a 2 px highlight on it.
- On a phone, use a **segmented control "נתונים | מסמך"** at the top. Switching keeps scroll position. The document
  view supports pinch-zoom.
- `/scans/[invoiceId]` stops being a separate destination.

*Applies to:* `invoices/[invoiceId]`, `scans/[invoiceId]`, `receiving/[poId]` review step, `inbox` (needs-review rows).

**P3. A correction should teach the system for that supplier.**
*Source:* Ramp per-vendor custom instructions and learning from corrections.
*Rule:* when a user corrects the **same field for the same supplier twice** within 60 days, show an inline prompt:
"לקרוא תמיד כך אצל ‹ספק›?" with buttons [כן, שמור כלל] [לא]. Show a provenance chip on later extractions:
"נלמד מתיקון ב-12.10".
*Applies to:* `correction-client.tsx`, `suppliers/[id]` `tab-details.tsx` (a "כללי קריאה" list). The extraction side
belongs to `ocr-procurement-engineer` (`packages/ocr`). Persisting a new rule table is a schema change → human PR.

**P4. Each document is scanned once, and duplicates are stopped before any OCR spend.**
*Source:* Ramp "OCR runs once per bill"; Ottimate duplicate check on date + number + vendor.
*Rule:* before OCR runs, hash the file and check supplier + invoice number (where known) + date. If it matches, show a
blocking sheet:
- Text: "כבר קיימת חשבונית MF-24950 מ-28.9".
- Actions: [פתח את הקיימת] (primary) and [זו חשבונית אחרת].
- Never create a second invoice row on a double tap (STATE.md M7/M8).

*Applies to:* `receiving/[poId]` SCAN_INVOICE, `inbox` ingest, `orders/capture`.

### B. Match and exceptions

**P5. Show exceptions only. Clean invoices never reach a human queue.**
*Source:* Tipalti tolerance auto-match; Brex auto-approve in-policy; Rillet "93% auto-booked".
*Rule:*
- An invoice whose lines are all within tolerance skips `approvals` and appears in `pay-run` as "ניתן לשלם" (T3).
- The approvals badge count = exceptions only.
- The approvals header shows one calm line: "34 חשבוניות עברו בדיקה אוטומטית החודש · ‎₪41,880" that links to the
  filtered list. Without that line the zero-touch work stays invisible.

*Applies to:* `approvals`, `approvals/pay-run`, overview KPI "ממתינות לאישור". Tolerances stay where they are in the
immutable `engine.ts` (display only).

**P6. Every invoice line shows ordered / received / billed, plus exactly one variance chip.**
*Source:* Ramp 3-way states "Not received / Partially received"; Odoo ordered / received / billed matching.
*Rule:* a compare row "הוזמן 20 · התקבל 18 · חויב 20" with one chip from a closed set:
- "תואם" (T3)
- "בטולרנס ‎+₪0.80" (T4)
- "מחיר ‎+₪6.00 (+7.2%)" (T2)
- "חוסר ‎−2 ק״ג" (T2)
- "לא הוזמן" (T2)
- "ממתין לקליטה" (T4, clock icon)

The header roll-up reads "12/14 שורות תואמות · 2 חריגות · ‎₪184 בסיכון". All ₪ go through `formatIls()`.
*Applies to:* `invoices/[invoiceId]`, `orders/[poId]`, `receiving/[poId]` review, `consolidated-panel.tsx` (per delivery note).

**P7. "Pending" is neutral, has a date, and is never counted as a leak.**
*Source:* Ramp "Waiting for match" / "Not received"; AGENTS.md T4.
*Rule:* waiting states (PO link missing, goods count missing, consolidated invoice awaiting its delivery notes) are
grey with a clock icon and **always carry the next event and its date**, for example "ממתין לספירת סחורה · משלוח
26.10". They are excluded from "₪ בסיכון" and from the leak hero.
*Applies to:* `pay-run` (already T4, add the date), `consolidated-panel.tsx`, `receiving` list, overview.

**P8. The exception queue is sorted by money, then age. Arrival time is not the sort.**
*Source:* Ramp reminders at day 2 and day 3; the generic "exception queue ordered by impact" practice.
*Rule:* default sort in `approvals` = blockers pinned, then |Δ₪| descending. Show an age badge after 48 h
("ממתין 3 ימים", T2 tone). Items older than 72 h get an "הועבר לבעלים" stamp when escalation fires.
*Applies to:* `approvals/list.tsx` (sort is UI). The escalation cadence lives in the immutable `outbox.ts`/`cron.ts` → human PR.

### C. Approvals and policy

**P9. Decide per invoice, not per discrepancy.**
*Source:* Ramp, R365 and Ottimate approvals are bill-level, with line exceptions inside.
*Rule:* group `myQueue` items by `invoiceId` into one card:
- Header: supplier · invoice no. · Σ ₪ at risk.
- Body: the discrepancy lines stacked.
- **One primary decision for the whole invoice:** "אשר חשבונית" or "החזק ובקש זיכוי".
- Per-line override behind "פרט שורות".

*Target:* an invoice with 3 flags takes 1 decision, not 3.
*Applies to:* `approvals/list.tsx`. A new `approvals.decideInvoice` procedure is optional (needs a COVERAGE entry in
`cross-tenant.attack.test.ts`); otherwise loop the existing `approve`/`reject` mutations.

**P10. Every flag explains itself in one sentence with the numbers and who acts next.**
*Source:* Ramp Policy Agent (i) shows the rule; Ramp approvers see who is next.
*Rule:* the "Why flagged" text template is
"‹כלל›: צפוי ‎₪89.00 → בפועל ‎₪96.00 (‎+₪7.00, +7.9%) · סף ±2% או ‎₪5 · אחריך: ‹שם/תפקיד›".
- On a phone it is clamped to 2 lines with "עוד".
- On desktop it shows in full in the detail pane.
- The existing `WhyFlagged` already has expected, actual, tolerance and routing. Add **"who's next"** and **Δ%**.

*Applies to:* `approvals/vocab.ts`, `WhyFlagged` in `list.tsx`.

**P11. An AI recommendation is a label. It is never a hidden action.**
*Source:* Ramp Policy Agent labels, suggest-only by default, opt-in auto-approve; Campfire's "reviewable before it
posts"; Brex auto-pilot shown with a settings toggle.
*Rule:*
- A recommendation renders as a chip: "מומלץ: לבקש זיכוי" / "מומלץ: לבדוק" / "מומלץ: לאשר", with (i) giving the rule
  and evidence.
- The human button stays the primary CTA, in the same position whatever the recommendation.
- Any automatic action needs an owner-visible rule in `settings` and writes an audit row "אושר אוטומטית · כלל ‹X›"
  (see P20).

*Applies to:* `approvals`, `recovery`, `ask`. Changing what the engine auto-approves is immutable `approvals/engine.ts` → human PR.

**P12. Provide a "the rule is wrong" escape hatch with a diff.**
*Source:* Ramp "Policy is wrong" → focused policy diff.
*Rule:* when a manager approves the **same supplier + product + rule despite the flag twice in 30 days**, show
"להרחיב סבילות ל‹מוצר› מ-±2% ל-±3%?" with a before/after row:
- What would have been flagged last month: 6 → 1 lines.
- ₪ that would have passed.

It applies only after an owner confirms.
*Applies to:* `approvals` → `contracts/thresholds-panel.tsx`. Engine defaults are immutable; per-restaurant overrides
only, via a human-reviewed path.

**P13. A rejection takes 2 taps and carries a reason, and the reason feeds the claim.**
*Source:* Ramp reject → edit → resubmit; Ottimate "Needs Attention".
*Rule:* the reject/hold sheet has **4 preset reason chips**: "מחיר לא לפי הסכם", "חוסר בסחורה", "לא הוזמן",
"כפילות". Free text is optional. One tap on a chip plus one on [החזק] = done. The chosen reason pre-fills the credit
letter in `leaks/claims`.
*Applies to:* `approvals/list.tsx` (replace the free `Textarea`-first flow), `leaks/claims`.

### D. Mobile (receiver, chef, owner on the move)

**P14. On the phone, a flow is a focused task mode with no global chrome.**
*Source:* Odoo Barcode receipts full-screen; Choco 3-tap ordering.
*Rule:*
- Inside `receiving/[poId]`, `inventory/count`, `orders/new` and `orders/capture`, **hide the bottom tab bar and the
  language/branch header**.
- Show "2/5" progress plus a close (✕) at the top, and a **sticky bottom action bar** (≥56 px tall, primary button
  full width, ≥48 px high, 16 px side gutters, `env(safe-area-inset-bottom)` padding).
- Every typed number is kept per keystroke in local state, so a call, a lock screen or a lost connection never loses
  a count. Photos queue with "יישלח כשיחזור חיבור" [Know].

*Evidence:* today the tab bar overlaps the camera frame in step 2/5 [Shot].
*Applies to:* `nav.tsx` (hide on task routes) and those four routes.

**P15. The decision buttons live in the thumb zone, and the first decision is above the fold.**
*Source:* platform HIG target minimums of 44×44 pt / 48×48 dp [Know]; Brex and Ramp keep flagged-only queues short.
*Rule:*
- In `approvals` on a phone, the filter toolbar collapses to **one "סינון (2)" chip row (≤48 px)**.
- The three summary tiles collapse to **one line** "4 בתור · ‎₪296 בסיכון · 2 חוסמים".
- The **first card's decision is visible without scrolling at 390×844**.
- Opening a card puts decisions in a **sticky bottom bar** with two 50/50 buttons ≥48 px high: [החזק / בקש זיכוי]
  and [אשר].

*Evidence:* the first approve pill sits about 1,000 px down today [Shot].
*Applies to:* `approvals/page.tsx`, `list.tsx`, `ViewToolbar` (compact mode).

**P16. A notification leads to a decision in 2 taps, and gets louder on a fixed schedule.**
*Source:* R365 Red App approves invoices and payment runs; Ramp "Approval needed" DM with reminders at day 2 and 3;
Tipalti approval by email without login; Brex flagged review in Slack/SMS.
*Rule:*
- A WhatsApp or push message deep-links to a **single-invoice decision screen**, not the dashboard: tap the link (1),
  tap [אשר] (2).
- Body: "‹ספק› · חשבונית ‹מס׳› · ‎₪‹סכום› · ‹חריגה בשורה אחת›". WhatsApp session messages allow **at most 3 reply
  buttons of ≤20 characters each**; outside the 24-hour window you need an approved template [Know].
- **One-tap approve inside WhatsApp only under an owner-set cap (default ‎₪500).** Above the cap the link requires a
  signed-in session. Hold or reject is always allowed. This follows Ramp's choice not to approve bills by email reply.
- Reminders at +48 h and +72 h, then escalate to the owner.

*Applies to:* a new `approvals/[invoiceId]` route (or a `?invoice=` sheet). Reuse the 72-hour signed-link pattern
from `/s/[token]` (supplier portal) for the token. Channel and cadence are immutable `outbox.ts`/`cron.ts` → human PR.

**P17. Ordering starts from the last order and the par levels, not from a blank form.**
*Source:* Choco "three taps", order guides with pars; Ramp intake pre-fill.
*Rule:*
- `orders/new` opens on **"להזמין שוב"**: one row per supplier whose order day is today, with badge "יום הזמנה: היום"
  and the last order's lines pre-filled at **par − on-hand** (from the latest `inventory` count when there is one).
- Quantity steppers are ±1 with targets ≥44×44 px.
- The supplier picker is a tappable list with the last-order date, not a native `<select>`.
- Show the contract price under each line (`orders/new/contract-price.tsx` exists).

*Target:* a repeat order in **≤4 taps** (supplier → review → send → confirm).
*Applies to:* `orders/new/wizard.tsx`, `suppliers/[id]/tab-schedule.tsx`, `inventory`.

### E. Desktop for the bosses

**P18. Desktop queues are keyboard-first, with letter keys rather than arrow keys.**
*Source:* Odoo Ctrl/Cmd+K with `/` and `@` prefixes and hold-Ctrl/Alt to reveal shortcuts; Corpay One
approve/decline/next-document keys; Ramp users asking for Bill Pay shortcuts and prev/next.
*Rule:*
- Global **Cmd/Ctrl+K** opens the command palette (wire `DashboardSearch` to it). Prefixes: `/` for screens, `@` for
  people, `#` for an invoice number, `$` for suppliers.
- In any queue:
  - **J/K** move to the next/previous row (letters, so RTL never inverts ←/→).
  - **Enter** opens the row, **A** approves, **H** holds/requests credit, **C** creates a claim, **E** edits the field
    under focus.
  - **X** selects, **Shift+X** selects a range, **Esc** closes, **?** opens the cheat-sheet.
  - **G** then **A/P/I/L** jumps to approvals / pay-run / inbox / leaks.
- **Holding Alt for 600 ms shows key hints on the buttons** (Odoo pattern).
- Hotkeys are off while focus is in an input.

*Applies to:* `approvals`, `approvals/pay-run`, `inbox`, `invoices/[invoiceId]`, `leaks/claims`, `search.tsx`.

**P19. Use the width: queues are three panes at ≥1280 px.**
*Source:* Ramp Inbox (approve and release from the same surface); Odoo form + preview.
*Rule:*
- Layout: **start pane = queue list 360 px** (dense rows of 56 px: supplier, invoice no., ₪ at risk, age, chip) |
  **center = document (flex)** | **end pane = decision panel 380 px** (Why-flagged, AI recommendation, line chips,
  timeline, actions).
- Moving with J/K changes only the panes, with no route navigation. The URL keeps `?sel=<id>` so a link or the browser
  back button restores it.
- Below 1280 px: 2 panes (list | detail with a document tab). Below 768 px: a single stack.

*Evidence:* today the content column is about 1,100 px wide in a 1440 px viewport, and every decision navigates or
expands in place [Shot].
*Applies to:* `approvals`, `inbox`, `approvals/pay-run`, `receiving` (desktop review of the day's deliveries).

**P20. Twenty destinations need a sidebar, not two rows of tabs.**
*Source:* Odoo apps menu with readable URLs; the Kick accounting **Cmd+B nav toggle** [Web: docs.kick.co].
*Rule:*
- At ≥1024 px, a start-side rail **240 px expanded / 64 px collapsed** (Cmd+B toggles; the state persists per user)
  replaces both top-tab rows.
- Four groups: תפעול / רכש / כסף / ניהול. The "כסף" group holds approvals, pay run, claims, ledger, monthly report
  and exports.
- **Live badge counts** next to approvals (exceptions), inbox (needs review), receiving (deliveries today) and claims
  (to send).
- Keep the bottom bar on the phone.

*Applies to:* `nav.tsx` (`NAV_ITEMS`, `GROUPS`), `layout.tsx`.

**P21. Bulk actions go in a sticky selection bar that shows the ₪ total. Any batch can be undone.**
*Source:* R365 bulk approve/deny of invoices; Ramp releases payments from the Inbox.
*Rule:*
- Every row in `pay-run`, `inbox` and the non-blocking rows of `approvals` gets a checkbox (whole-row label ≥44 px).
- Selecting shows a **sticky bar: "נבחרו 6 · ‎₪8,412.30"** with [סמן כשולם] [אשר] [ייצא CSV] [נקה].
- **Blocking-severity rows cannot be bulk-approved** (the checkbox is disabled, with a tooltip saying why).
- Batches above an owner-set ₪ cap need a typed confirmation ("אשר ‎₪8,412.30").
- After the action, an **undo toast stays 8 s** ("סומנו 6 חשבוניות כשולמו · בטל").
- Saved views show live counts, for example "חוסמים (2)", "מוכן לתשלום (8)". Each role gets its own default view:
  the bookkeeper lands on "מוכן לתשלום", the owner on "חוסמים".

*Applies to:* `approvals/pay-run/page.tsx`, `approvals/list.tsx`, `inbox/inbox-client.tsx`, `lib/components/views`.

### F. Audit, close, compliance, vendor master

**P22. Each document has one timeline, and AI steps are marked.**
*Source:* Ramp audit trail of who approved what and when; Campfire "every agent action logged, sourced… reviewable";
Rillet audit trails.
*Rule:* the end pane of `invoices/[invoiceId]` shows a vertical timeline, newest last:
1. נקלטה (channel: דלת / וואטסאפ / מייל, sender)
2. OCR (confidence, fields corrected by whom)
3. הותאמה (rules hit)
4. סומנה
5. הוחלט (by, reason)
6. דרישת זיכוי נשלחה
7. זיכוי התקבל
8. שולמה

Agent or automatic steps carry an "AI" or "אוטומטי" tag and the rule id. Each row is ≤1 line plus its time
(`formatDateTime`).
*Applies to:* `invoices/[invoiceId]`, `activity.tsx` (the global feed links into these).

**P23. The monthly close is a checklist with owners, deadlines and an AI-drafted variance note.**
*Source:* Rillet close checklist (owners, deadlines, dependencies, approvals) and "day one is review"; Campfire Ember
flux commentary.
*Rule:* `reports/monthly` opens with a "סגירת חודש ‹אוקטובר›" checklist of 6 items. Each item has a live count, an
owner avatar, a due date and a deep link:
1. כל המשלוחים נספרו
2. כל החשבוניות הותאמו
3. חשבוניות ריכוז הוצלבו מול תעודות משלוח
4. מספרי הקצאה קיימים לכל חשבונית ≥ ‎₪5,000 לפני מע״מ
5. דרישות זיכוי נשלחו
6. יוצא לרו״ח

- An item turns green only at 0 open.
- After export, the month shows "נסגר ע״י ‹שם› ב-‹תאריך›". Later edits to that month show a T2 "שינוי בחודש סגור" stamp.
- At the top, a 2–3 sentence AI draft of the variance, for example "עלות ירקות ‎+12% מול ספטמבר, בעיקר עגבניות שרי
  (‎+₪410) אצל ירקות השרון". It carries a [ערוך] [אשר לדוח] confirm step.

*Applies to:* `reports/monthly`, `exports`, `suppliers/ledger`, `consolidated-panel.tsx`.

**P24. Compliance and vendor-master risks are shown as ₪ plus a deadline plus one CTA, before payment.**
*Source:*
- Israel Invoices thresholds (₪10,000 from 1 Jan 2026, ₪5,000 from 1 Jun 2026; no VAT deduction; expense
  non-deductible since 1 Aug 2025) and the ITA verification service.
- Ramp fraud alerts on new or changed bank details before payment.
- Ottimate contract pricing → "Needs Attention"; COGS-Well 3% default alert.

*Rule:*
- **Allocation number:** every invoice ≥ ₪5,000 before VAT shows a chip. Three states:
  - "מספר הקצאה ✓" (T3). Once the ITA verification credential is connected (Phase-6, human-only), it upgrades to
    "אומת מול רשות המסים".
  - "חסר מספר הקצאה · מע״מ ‎₪1,123 בסיכון · עוד 154 ימים" (T2), with [בקש מהספק] sending a WhatsApp template.
  - "מספר לא תקין" (T2).
- **Vendor bank change:** for 30 days, every unpaid invoice of that supplier shows a red banner "פרטי הבנק של הספק
  שונו ב-‹תאריך›, אמתו בטלפון לפני תשלום". The pay run excludes those invoices from bulk "סמן כשולם" until a second
  person confirms.
- **Contract price:** a line above contract stays in "Needs attention" until resolved (the over-contract badge exists).
  The price-alert threshold defaults to **3%** and is editable per category.

*Applies to:* `vat-at-risk.tsx`, `invoices/[invoiceId]`, `pay-run`, `suppliers/[id]/tab-details.tsx`,
`contracts/thresholds-panel.tsx`, `contracts/alerts-panel.tsx`.

---

## 5. Patterns (14)

| # | Pattern | Exemplar | RestoMatch use |
|---|---|---|---|
| PT1 | **Document ⇄ data split view with per-field confidence** | Odoo vendor bill (preview on the right; "Reload AI Data → Confirm"); Odoo 18 resizable OCR split modules; Ramp Smart OCR line fields | `invoices/[invoiceId]` at ≥1280 px: document 50% / form 50%, with the confidence tiers from P1. Phone: a "נתונים \| מסמך" toggle. Retire `/scans/[id]` as a destination. |
| PT2 | **Line compare table: ordered / received / billed, plus one variance chip** | Ramp 3-way match ("Not received / Partially received"); Odoo Purchase Matching | `invoices/[invoiceId]`, `orders/[poId]`, receiving review, `consolidated-panel.tsx` per delivery note. Roll-up "12/14 תואמות · ‎₪184 בסיכון". |
| PT3 | **Invoice-level decision card with an AI recommendation chip** | Ramp Policy Agent ("Approval recommended / Requires review / Rejection recommended", (i) → rule); Ramp approval summary of vendor history and prior bills | `approvals/list.tsx`: group by invoice. Header Σ₪, stacked lines, "מומלץ: …" chip, one primary decision, "פרט שורות" for overrides. |
| PT4 | **Push or WhatsApp → single-item decision sheet (2 taps)** | R365 Red App AP approvals and payment runs; Ramp DMs with reminders at day 2 and 3; Tipalti approval by email without login | New `approvals/[invoiceId]` mobile sheet, deep-linked from WhatsApp Cloud and push. One-tap approve only under the ₪ cap; otherwise needs a session. Escalation at +48 h and +72 h (human PR: `outbox.ts`/`cron.ts`). |
| PT5 | **Reason-chip reject sheet that feeds the claim** | Ramp reject → edit → resubmit; Ottimate "Needs Attention" | 4 chips plus optional text in `approvals`. The reason pre-fills the `leaks/claims` letter and the `recovery` record. |
| PT6 | **Three-pane keyboard queue with command palette** | Odoo Ctrl/Cmd+K with `/` and `@`, hold Ctrl/Alt for hints; Corpay One approve/next keys; Ramp community demand for prev/next | `approvals`, `inbox`, `pay-run`: list 360 \| document \| decision 380. J/K/A/H/C/X/?, G-chords, `?sel=` in the URL. |
| PT7 | **Sticky bulk-selection bar with ₪ sum, typed confirm over a cap, 8 s undo** | R365 bulk approve/deny; Ramp release payments from the Inbox | `pay-run` [סמן כשולם] [ייצא], `inbox` [שייך לספק] [סמן כנבדק], non-blocking `approvals` [אשר]. |
| PT8 | **Agent draft → human confirm card with provenance** | Rillet "agents propose journal entries… you approve or adjust"; Campfire "logged, sourced… reviewable before it posts"; Zip intake agents pre-check before the approver | Credit-letter drafts in `leaks/claims`, flux note in `reports/monthly`, `ask` answers, consolidated-match proposals. Every draft shows "טיוטה של RestoMatch · מבוסס על 3 חשבוניות" with links, plus [ערוך] [אשר]. Nothing is sent or posted without the confirm. |
| PT9 | **Per-document audit timeline** | Ramp audit trail; Campfire agent logs; Rillet audit trails | End pane of `invoices/[invoiceId]`: the 8 steps from P22, with AI or automatic tags. |
| PT10 | **Close checklist + period lock + flux commentary** | Rillet close management; Campfire Ember flux | `reports/monthly`: 6-item "סגירת חודש" checklist (P23), lock on export, "שינוי בחודש סגור" stamp. |
| PT11 | **Reorder-first order guide with pars** | Choco "three taps", order guides with pars; Ramp intake pre-fill | `orders/new`: "להזמין שוב" list for suppliers ordering today, par − on-hand pre-fill, ±1 steppers, contract price under each line. ≤4 taps. |
| PT12 | **Price/contract guard at the point of entry** | Ottimate Contract Pricing → "Needs Attention"; xtraCHEF Price Tracker (avg % and $ impact); Craftable warns at approval; Ramp Price Intelligence | Show the over-contract chip **while the chef builds the order** (`orders/new`), **while the receiver reviews** (`receiving/[poId]`, `dock-price-hint.tsx` exists) and in approvals. `contracts` shows "avg Δ% · ₪ impact this month" per supplier. |
| PT13 | **Vendor-change / fraud banner before payment** | Ramp Bill Pay fraud: "new or changed bank details" alerts on the bill | `pay-run` and `invoices/[invoiceId]` red banner for 30 days after a supplier bank change. Bulk "שולם" is blocked until a second person confirms. |
| PT14 | **Focused task mode with progress and a sticky bottom action** | Odoo Barcode receipts (kanban → full-screen scan, short-quantity pop-up, multi-scan) | `receiving/[poId]`, `inventory/count`, `orders/new`, `orders/capture`: hide the tab bar, show "2/5" + ✕, sticky bar ≥56 px, autosave per keystroke. |

---

## 6. Screen-by-screen prescription (route → change → device)

| Route | Phone (doers) | Desktop (bosses) | Principles |
|---|---|---|---|
| `/dashboard` (overview) | The leak ₪ hero plus at most 3 "act now" rows (T2: approvals ₪, deliveries today, claims to send), each 1 tap to its task. The rest goes behind "עוד". | Two columns at ≥1280 px: start = leak hero + act-now queue; end = trends (heatmap, price creep). Target ≤2 screens tall (today about 4.4). | P5, P7, P20 |
| `/dashboard/receiving` + `[poId]` | Task mode, no tab bar, sticky action, per-field confidence on review, duplicate stop before OCR | "Today's deliveries" as a 3-pane review for the owner or manager | P1, P4, P6, P14 |
| `/dashboard/approvals` | Collapsed filters (one chip row), one-line summary, invoice-level cards, sticky [החזק]/[אשר], reason chips | 3-pane queue, J/K/A/H, sort by ₪ then age, bulk on non-blocking rows, AI chip, "who's next" | P8–P13, P15, P18, P19, P21 |
| `/dashboard/approvals/[invoiceId]` (new) | Deep-link landing from WhatsApp/push: 2-tap decision | Same component, rendered as the end pane | P16 |
| `/dashboard/approvals/pay-run` | Read-only totals + "פתח במחשב" | Table rows per invoice grouped by supplier, checkboxes, sticky ₪ bar, [סמן כשולם], bank-change block, undo 8 s | P7, P21, P24 |
| `/dashboard/invoices/[invoiceId]` | Data / Document toggle, line chips, timeline under "היסטוריה" | Document ⇄ data split, line compare chips, end-pane timeline, allocation-number chip | P1–P3, P6, P22, P24 |
| `/dashboard/inbox` | Needs-review list → same review sheet as receiving | 3-pane, bulk "שייך לספק" | P2, P19, P21 |
| `/dashboard/orders/new` | "להזמין שוב", par pre-fill, ≤4 taps, contract price under each line | Same data as a dense editable grid (Tab moves between quantity cells) | P17, PT12 |
| `/dashboard/leaks/claims` + `recovery` | Swipe-free list: "לשלוח" (T2) / "נשלח" (T4) / "זוכה" (T3) | Agent-drafted letters → [ערוך] [אשר ושלח], bulk send | P13, PT8 |
| `/dashboard/reports/monthly` | Summary only | Close checklist, lock, flux draft | P23 |
| `/dashboard/suppliers/[id]` | Call / WhatsApp the supplier, order day | Tabs + reading rules (P3) + bank-change history (P24) | P3, P24 |
| `/dashboard/chain` | Branch ₪ leak ranking | Branch × supplier matrix, click → filtered approvals | P19, P20 |
| `dashboard/nav.tsx` | Bottom bar stays; hidden in task mode | Sidebar 240/64 px, 4 groups, badge counts, Cmd+K, Cmd+B | P14, P18, P20 |

---

## 7. Anti-patterns to remove (checklist)

- [ ] Global tab bar drawn over a task flow (receiving step 2/5 today).
- [ ] Source document one navigation away from the fields being corrected (`/scans/[id]` link).
- [ ] Page-level "OCR confidence 92%" as the only trust signal.
- [ ] One approval card per discrepancy, which makes 3 decisions for one invoice.
- [ ] A free-text-first rejection (the reason is lost and never reaches the claim).
- [ ] Filters and summary tiles pushing the first decision below the fold on a phone.
- [ ] Two rows of top tabs on a 1440 px desktop, with about 340 px of dead side margin.
- [ ] Pay run with no selection and no "mark paid": the bookkeeper exports CSV and finishes the work elsewhere.
- [ ] A native `<select>` as the first step of a repeat order.
- [ ] Any AI output that sends, posts or approves without a visible confirm and an audit row.
- [ ] Pending or waiting items counted in ₪ at risk, or styled as danger (T4 violation).

---

## 8. Governance notes (AGENTS.md)

- **Human-PR only:**
  - Auto-approve under a cap, tolerance overrides from "rule is wrong", and anything in `approvals/engine.ts`.
  - WhatsApp/push cadence and escalation (`notifications/outbox.ts`, `apps/worker/src/cron.ts`).
  - New tables for supplier reading rules, close-checklist state or agent-draft provenance (`packages/db/src/schema.ts`
    plus a **new** migration only).
  - Tolerance values (`engine.ts` `TOTAL_TOLERANCE_ILS`) are **display only** in this research.
- **New tRPC procedures** (e.g. `approvals.decideInvoice`, `payRun.markPaid`, `invoices.timeline`) each need a
  **COVERAGE entry** in `cross-tenant.attack.test.ts` (adding is allowed; never weaken it).
- **All ₪ goes through `formatIls()`** (`apps/web/lib/money`). Variance chips carry sign and % next to ₪, with
  tabular numerals.
- **The ITA allocation-number verification** needs a credential → Phase-6, human-only. Until then the chip shows
  presence and format only.
- **Ownership:**
  - UI routes (`apps/web`, `packages/api` routers) → `web-feature-engineer`.
  - Confidence and extraction hints → `ocr-procurement-engineer`.
  - Tokens and visual tiers → `rtl-design-steward`.
  - Match semantics → `matching-engine-guardian`.

---

## 9. Sources

**Ramp**
- support.ramp.com "Ramp Bill Pay OCR": https://support.ramp.com/hc/en-us/articles/45686841394579-Ramp-Bill-Pay-OCR
- support.ramp.com "AP Agents available in Ramp Bill Pay": https://support.ramp.com/hc/en-us/articles/47024360747027-AP-Agents-available-in-Ramp-Bill-Pay
- Ramp AP agents announcement (2025-10-07): https://ramp.com/blog/ramp-ap-agents-announcement · https://www.cpapracticeadvisor.com/2025/10/07/ramp-launches-accounts-payable-agents/170422/ · https://www.pymnts.com/news/artificial-intelligence/2025/ramp-adds-ai-agents-invoice-coding-approval-payment-processing/
- "Use Policy Agent for approvals": https://support.ramp.com/hc/en-us/articles/47618318137875-Use-Policy-Agent-for-approvals · "Policy Agent Overview": https://support.ramp.com/hc/en-us/articles/44072387128979-Policy-Agent-Overview · "Update your policy on the fly": https://support.ramp.com/update-your-policy-during-expense-review
- "Bill Pay approvals": https://support.ramp.com/hc/en-us/articles/4417843897747-Bill-Pay-Approvals-and-AP-Clerks · "Bill lifecycle": https://support.ramp.com/hc/en-us/articles/4417814078611-Bill-Lifecycle · "Bill Pay submission policies": https://support.ramp.com/hc/en-us/articles/51621189131667-Bill-Pay-submission-policies
- "3-Way Match with Ramp Procurement": https://support.ramp.com/hc/en-us/articles/30227975187731-3-Way-Match-with-Ramp-Procurement
- "Bill Pay Fraud": https://support.ramp.com/hc/en-us/articles/37791491771027-Bill-Pay-Fraud · https://ramp.com/ap-fraud-prevention
- "Agentic Intake Programs": https://support.ramp.com/agentic-intake-programs · Ramp procurement agents (2026-05-01): https://www.cpapracticeadvisor.com/2026/05/01/ramp-rolls-out-ai-agents-for-procurement/182627/
- "Price Intelligence on Ramp": https://support.ramp.com/hc/en-us/articles/17522214341523-Price-Intelligence-on-Ramp
- Receipts by SMS/WhatsApp: https://support.ramp.com/hc/en-us/articles/360042588454-Submitting-receipts-memos-and-accounting-for-your-Ramp-transactions
- How Ramp uses Bill Pay (release from Inbox): https://ramp.com/blog/how-ramp-uses-ramp-bill-pay
- Community, shortcuts and prev/next demand: https://community.ramp.com/t/bill-pay-shortcuts/1463 · https://community.ramp.com/t/skip-or-toggle-invoices-to-next-one-while-approving/1122

**Other AP, procurement and spend tools**
- Zip: https://softwareconnect.com/reviews/zip/ · https://ziphq.com/guides/zip-in-2025 · https://www.erpresearch.com/erp-add-ons/procurement/zip-intake
- Ottimate: https://ottimate.com/industry/restaurants/ · https://ottimate.com/feature/po-match/ · https://support.ottimate.com/support/solutions/articles/14000118134-how-to-use-contract-pricing · https://support.ottimate.com/support/solutions/articles/14000035356-duplicates-handwritten-invoices-blurred-images
- Tipalti: https://tipalti.com/en-uk/ap-automation/invoice-management/ · https://tipalti.com/?p=47638
- Brex: https://www.brex.com/support/brex-assistant · https://www.brex.com/platform/brex-ai · https://brex.com/support/brex-and-slack
- Navan: https://navan.com/blog/insights-trends/take-control-of-expense-approvals-with-navan

**AI-native ERPs**
- Rillet: https://www.rillet.com/product/close-management · https://www.rillet.com/blog/reach-zero-day-close · https://www.rillet.com/blog/january-2026-product-update · https://info.rillet.com/automate-month-end-close-fastest-path
- Campfire: https://fortune.com/press-releases/campfire-ember-agents-ai-workers-finance-accounting-2026-03-12 · https://campfire.ai/
- Puzzle: https://puzzle.io/blog/ai-accuracy-review-for-accountants

**Odoo**
- Keyboard shortcuts (18.0): https://www.odoo.com/documentation/18.0/applications/essentials/keyboard_shortcuts.html · Odoo 18 release note: https://braintec.com/en/news/insights/41/odoo-18-release-note
- Odoo 19 digitization: https://www.cybrosys.com/blog/how-to-digitize-accounting-documents-in-odoo-19 · split-view OCR modules: https://apps.odoo.com/apps/modules/18.0/aspl_ocr_bill_ee · https://apps.odoo.com/apps/modules/17.0/smart_ocr_vendor_bills
- Odoo 18 3-way: https://www.cybrosys.com/blog/how-3-way-matching-works-in-odoo-18-purchase-module · Barcode: https://www.cybrosys.com/odoo/odoo-books/v18/barcode/exploring-the-barcode-app-features/ · https://nalios.com/en/blog/what-s-new-in-odoo-6/whats-new-in-the-barcode-application-with-odoo-18-a-leap-to-efficiency-70

**Restaurant-specific apps**
- Restaurant365: https://docs.restaurant365.com/docs/r365-red-app-ap-approvals · https://docs.restaurant365.com/docs/r365-red-app-ap-transactions · https://www.restaurant365.com/blog/centralize-payments-with-r365s-ap-center/
- Choco: https://choco.com/restaurants
- Price alerts: https://intercom.help/toast-central/en/articles/14727583-xtrachef-get-started-with-the-price-tracker · https://cogs-well-inc.helpscoutdocs.com/article/327-what-are-cost-alerts · https://help.craftable.com/learning/understanding-promo-threshold
- Kick (Cmd+K, Cmd+B): https://docs.kick.co/accountants/reference/keyboard-shortcuts · Corpay One shortcuts: https://help.corpayone.com/en/articles/3458373-keyboard-shortcuts-in-corpay-one

**Israel Invoices**
- https://kpmg.com/us/en/taxnewsflash/news/2025/12/tnf-israel-expansion-of-mandatory-e-invoicing-model.html · https://sovos.com/regulatory-updates/vat/israel-tax-authority-confirms-accelerated-timeline-for-ctc-invoice-allocation-number/ · https://herzoglaw.co.il/en/?p=73487 · https://cdn.priority-software.com/docs/SOP_Tax_Authorities_IL_25_0_H.pdf · https://www.chamber.org.il/serviceslobby/finance/1427/150164/

**Unverified this session [Know]**
- WhatsApp Cloud interactive limits (3 reply buttons, 20-char titles, 24-hour window/templates).
- 44 pt / 48 dp touch-target minimums.
- Offline photo queueing as a field-app norm.
- Exact Odoo bill "click a box on the document" behaviour: not confirmed by search, so it is not used as a claim above.
