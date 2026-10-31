# Lens review: functional end-to-end flows (`functional-flows`)

**Date:** 2026-10-25 · **Lens:** cross-cutting, every page, from order to ₪ back · **Code:** `wt/` at HEAD `8fef118c`
**Path:** order → receive → invoice → match → approve → pay → claim → credited → recovered
**Roles:** owner, manager, bookkeeper, chef, receiver
**Inputs:**
- `research/functional-gaps.md` (FG-01…39), which I validated line by line against the code.
- `research/RUBRIC.md` (groups A5, C4, C10, D1, D7, D9, G4, G8, H5, H7, H8, I2).
- `research/ordering-mobile.md`, `erp-modern.md`, `ainative.md`, `pwa-field.md` and `ia-map.md`.
- 225 lab captures (`crawl-results.json`); crops are in `review/crops-ff/`.

**Related reviews.** This file cross-references them and does not repeat their screen-level detail:
- `area-orders.md` (orders-NN), `area-receiving.md` (RCV-NN), `area-approvals.md` (approvals-NN).
- `lens-mobile-field.md` (mobile-field-NN), `lens-exec-desktop.md` (exec-desktop-NN), `lens-ia-nav.md` (ia-nav-NN).

This lens covers what those reviews cannot see from one page:
- the **seams between stages**: hand-offs, state transitions, who is told, and dead ends;
- the **target loop** as one system;
- a **dependency-ordered functional roadmap**.

> **Lab caveats** (not product bugs):
> - The red "מנוע העיבוד לא זמין" banner appears because the lab has no job heartbeat.
> - The consent bar appears because every capture is a first visit.
> - In full-page shots, fixed bars appear mid-page.
> - `/leak-check*` returns 404 (its flag is off). `/admin*` was reviewed from code only.
> - Demo tenant: "כפר הזיתים" at DEMO_TODAY 2026-10-25.

---

## 0. Verdict

**Scores (0–10 against Choco, Ramp, R365, Ottimate and Odoo):**

| Score | Value | Why |
|---|---|---|
| Mobile | **3.0** | The two field roles can't finish their own stage: the chef can't propose an order, and the receiver can't receive a walk-in delivery. Nothing reaches a phone. |
| Desktop | **4.0** | The bookkeeper can't approve a document, correct an invoice, mark a payment or send a claim. The pay run never empties. |
| Functionality | **3.5** | The engines are strong, but the loop is broken at five seams and every state change after the match is manual. |

**What is genuinely good (keep it):**
- **The ₪ engines.** 12-type match, capped per-invoice claims (`lib/claims.ts`), and a credit-note allocation that is integer-agorot exact (`recovery/lifecycle.ts:60–90`).
- **A real recovery lifecycle:** claimed → letter_sent → acknowledged → credited → recovered.
- **A token-secured supplier portal** (`supplierConfirm/service.ts`, 256-bit token, 72 h, first-answer-wins).
- **AI that already drafts something for a human to confirm.** A WhatsApp text becomes a draft PO the owner confirms with one tap (`orders/captureOrder.ts:18–24`).
- **Idempotent dock writes** (M7/M8), a dock slip sent over WhatsApp, the consolidated-invoice proposal, and the supplier ledger.

**Why it is not world-class.** RestoMatch finds the money, then hands the user a printout and a CSV and goes quiet. Ramp, Choco and Ottimate each run the loop *to its end*:

| Product | How far its loop runs |
|---|---|
| Ramp | bill → approval chain with "who's next" and day-2/day-3 reminders → scheduled → paid |
| Choco | order → supplier confirmation → delivery check → "Request for Supplier" credit |
| Ottimate | invoice → approval → payment from the phone |

In RestoMatch, after the match:
- no status moves by itself;
- no person is told on a phone;
- no claim is sent;
- no payment is recorded.

**The five seams that break the loop** (each is a finding below):
1. **States are never advanced.** The PO stays `sent` forever. The invoice never becomes `approved` or `paid`. The supplier's answer is never written (ff-01).
2. **No one is told.** Push is a mock. WhatsApp is addressed to `role:manager`. Escalations and supplier answers are silent (ff-02, ff-03).
3. **Approve-before-pay dead-ends** in a CSV, and no invoice can be marked paid (ff-04).
4. **Claims never leave the building.** Letters are print-only, `letter_sent` is set by hand, and the chase emails the restaurant itself (ff-05).
5. **Spend escapes the 3-way match:** walk-in deliveries, late POs, and "demo invoice" as the only no-invoice path (ff-06).

**One-line benchmark.** Choco + Ramp take a short delivery to a sent credit request in about **4 human touches and 0 manual status changes**. RestoMatch today takes **11 hand-offs, 4 roles, 7 screens, 3 manual status edits and 0 phone notifications** (walked in §1).

---

## 1. The loop today: one short delivery walked from order to ₪ back

**Scenario:** the manager orders 10 kg of tomatoes from ירקות השרון. The supplier answers "only 6". 6 kg arrive, and the invoice bills 10. That is ₪48 of QTY_OVER leak.

| # | Stage | Who / device | What happens today ([Code] + shot) | Hand-off to the next stage |
|---|---|---|---|---|
| 1 | Order | manager / phone | A 4-step wizard. BUILD is catalog search, 8 rows browsed, qty 1 per tap (`orders/new/wizard.tsx:101–104, 358`), about 40 taps (`dashboard_orders_new__owner__phone-he.png`; mobile-field-08). Picking a supplier wipes the lines (`:265–270`). The chef can't start one (`lib/roles.ts:70`). | `placeOrder` queues the order to the outbox and sets `sent` (`routers/orders.ts:868–1010`). WhatsApp to the supplier is free text (see ff-11). |
| 2 | Supplier confirms | supplier / phone | The portal records "6 instead of 10" in `supplier_responses`. **"The purchase order is never written"** (`supplierConfirm/service.ts:35`). | **None.** No notification, no activity row, no PO status. The manager learns only by opening the order (`dashboard_orders_ID__owner__phone-he.png`: "ממתין לתשובת הספק"). |
| 3 | Delivery expected | receiver / phone | The receiver lands on the owner's ₪760 control room, not today's trucks (`dashboard__receiver__phone-he__0.png`). `dailyExpectations` computes today's list at 06:00 and tells no one (`jobs/dailyExpectations.ts`, no enqueue). | Tap "קליטת סחורה" → card. |
| 4 | Receive | receiver / phone | Invoice-first. "צעד 2 מתוך 5 · צלם את החשבונית", then an OCR wait (≤30 s). The only way to count without a photo is **"השתמש בחשבונית-דמה (ללא העלאה)"** (`InvoiceScan.tsx:158–170, 263–267`; `dashboard_receiving_ID__receiver__phone-he__0.png`). The receiver still expects 10, not 6 (step 2 never reached receiving). Exceptions are a ±1 stepper plus "missing"/"damaged", with no reason or photo (`AdjustQuantities.tsx:195–285`). | `submitReceipt` closes the GR (`routers/receiving.ts:819–883`). **The PO stays `sent`.** The invoice photo is saved as every line's "photo" **and** as the driver's "signature" (`receiving/[poId]/wizard.tsx:505, 510`). |
| 5 | Dock slip | receiver → driver | A WhatsApp prefill. "Nothing is sent by us" (`dock-slip.tsx:24–26`), so no record is kept of the slip being shared. | None. The slip is not linked to any later claim. |
| 6 | Match | system | The OCR is held until the count, then the re-match runs (`receiving/matchTriggers.ts`). | Notifications (`jobs/matchInvoice.ts:186–255`): **email** to owner+manager (STATE.md 2026-09-08: Resend sandbox), **push = mock** marked "sent" (`notifications/push.ts:9–19`), **WhatsApp to `role:manager`** (`:196–206`, not a phone number). |
| 7 | Decide | owner or manager / desktop or phone | "אשר" on one card per discrepancy, with no bulk (`approvals/list.tsx`; `dashboard_approvals__owner__desktop-he__0.png`). **Approve = demand the money from the supplier.** If escalated: audit row only (`routers/approvals.ts:242–271`). | **The claim row does not exist yet.** `syncClaims` runs only when someone opens `/recovery` or the monthly report, or in the 08:30 job (`recovery.ts:49, 61`; `reports/monthly.ts:163`; `recovery/reminders.ts:141`). |
| 8 | Claim letter | owner / desktop | `/leaks/claims` prints one letter per supplier. No send, no channel (`leaks/claims/page.tsx:202`; `dashboard_leaks_claims__owner__desktop-he__0.png`, badge "לשליחה"). | The user mails or prints it **outside the app**, then sets "מכתב נשלח" by hand in the tracker (`recovery/tracker-client.tsx:287`). |
| 9 | Chase | system → restaurant | After 14 days, an email reminds **the restaurant's own managers** (`recovery/reminders.ts:19–24`). `dashboard_recovery__owner__desktop-he__0.png` shows "32 באיחור · ₪1,522". | The supplier is never contacted by the system. |
| 10 | Credit note | supplier → inbox → bookkeeper | A credit note arriving by WhatsApp or email is processed as an invoice: there is no document-type classification (grep for "credit" in `packages/ocr/src`: empty). The amount is typed by hand ("רישום תעודת זיכוי", `tracker-client.tsx:67, 193`). | The status moves to `credited` only through that manual entry. |
| 11 | Pay | bookkeeper / desktop | The pay run says "ניתן לשלם" next to a CSV export (`dashboard_approvals_pay-run__owner__desktop-he__0.png`). **Nothing writes `invoices.status='approved'` or `'paid'`** (enum at `schema.ts:64–71`; grep finds no writer). The pay run is month-scoped, ignores `due_date` (never populated) and ignores allocation numbers. | **Dead end.** The invoice is "not marked paid" forever. |

**Totals:**

| Measure | Today | Target (§4) |
|---|---|---|
| Hand-offs | 11 | 11 |
| Hand-offs that are automatic | 1 (the match) | 8 |
| Roles involved | 4 | 4 |
| Screens to visit | 7 | 4 (push → sheet) |
| Manual status edits | 3 (letter sent, credit entry, "paid" impossible) | 0 |
| Phone notifications that work in production | 0 | One per action that needs a human, with ₪ and one verb |

---

## 2. Validation of `functional-gaps.md` against the code

**Verdict key:**
- **✔** confirmed as written.
- **✔+** confirmed and *worse* than described.
- **◐** partly true, or the evidence has moved.
- **✖** refuted.

"My P" is this lens's priority. It differs from FG where the code changes the picture.

| FG | Verdict | Evidence re-checked (2026-10-25, `wt/`) | FG P | My P |
|---|---|---|---|---|
| 01 Order guide | ✔ | `catalog.items` limit 8 when no search (`wizard.tsx:101–104`). `recentlyBoughtProducts` exists (`inventory/data.ts:122`), unused by ordering. | P0 | P0 |
| 02 Anyone drafts, manager sends | ✔ | `/dashboard/orders` owner+manager (`roles.ts:70`). `createDraft`/`placeOrder`/`captureFromText` are `managerProcedure` (`orders.ts:447, 868, 734`). | P0 | P0 |
| 03 Order again / standing / top-up | ✔+ | No clone. Lines can't be edited after send ("רק שורות בטיוטה…", `orders.ts:860`). Cancelling a sent order doesn't reach the supplier (`orders/he.ts:80`). `po_source` already has `'recurring'` (`schema.ts:51–57`), so standing orders need no new enum value. | P1 | P1 |
| 04 Multi-supplier session | ✔ | `setLines([])` on supplier change (`wizard.tsx:265–270`). | P1 | P1 |
| 05 Cut-off countdown | ✔ | `orderReminders` email at 09:00 (`cron.ts:76–82`). Deep link broken (orders-05). | P1 | P1 |
| 06 Par / fill to par | ✔ | `par_level` appears nowhere. ICP veto applies. | P2 | P2 ⚖️ |
| 07 Voice / photo order | ◐ | Text capture exists. A PO-**photo** import (Zestt, `importPo`, `orders.ts:684`) exists behind `ANTHROPIC_API_KEY`. Voice is missing. | P2 | P2 |
| 08 Supplier confirmation → expectation | ✔+ | Never written (`service.ts:35`), and **nobody is notified** (no enqueue or `logActivity` in `supplierConfirm/*`). PO never becomes `confirmed` (grep: no writer). | P1 | **P0** (part of ff-01) |
| 09 PO approval / budget | ✔ | No budget anywhere. Approvals act only after the invoice. | P1 | P1 ⚖️ |
| 10 Cheaper supplier hint | ✔ | Product page has the "cheapest supplier" view. The wizard doesn't. | P2 | P2 ⚖️ |
| 11 Receive without PO | ✔ | `startReceipt` requires `poId` (`receiving.ts:688–705`). `todayExpectations` only lists sent/confirmed/partial POs (`:80–130`). | P0 | P0 |
| 12 Count-first | ✔+ | Invoice-first, **and** the de facto bypass is a button labelled "demo invoice" that sends the receiver down the PO-only path (`InvoiceScan.tsx:158–170`; `wizard.tsx:263–273, 442`). | P0 | P0 |
| 13 Exception sheet | ✔+ | `markGrLine` accepts `photos[]`, `rejectReason`, `conditionNotes` (`receiving.ts:771–817`). The UI sends **the invoice photo as every line's photo** (`wizard.tsx:505`). | P0 | P0 |
| 14 Weight keypad / catch-weight | ◐ | The input is `inputMode="decimal"` with `step=0.1`, but the buttons are ±1 (`AdjustQuantities.tsx:222–255`). Tolerance is immutable. | P1 | P1 🔒 |
| 15 Deliveries board | ✔ | Today-only. Delay alerts are a daily 10:00 email to owner+manager only, never the receiver (`jobs/supplierDelays.ts:84–114`; `recipients.ts` `MANAGER_ROLES`). | P1 | P1 |
| 16 Offline outbox | ✔ | Covered in full by mobile-field-02 / RCV-09. | P1 | P1 |
| 17 Barcode | ✔ | Columns exist (mobile-field-21). | P2 | P2 |
| 18 Shared tablet PIN | ✔ | No PIN (mobile-field-25). | P1 | P1 🔒 |
| 19 Real push + WhatsApp | ✔+ | Push mock **writes "sent" rows that never went anywhere**. The `role:` target is posted verbatim as the WhatsApp `to`. Free-form `type:'text'` (`whatsappCloud.ts:47–58`). `users.phone` exists (`schema.ts:181`), but no screen collects it. No preferences. | P0 | P0 🔒 |
| 20 Role Today home | ✔ | Same hero for every role (`dashboard/page.tsx:59–112`). | P0 | P0 |
| 21 One inbox + counts | ✔ | `NavBadge` renders only for `contracts` (`nav.tsx:155–157`). | P1 | **P0** (it is the spine of §4) |
| 22 Bulk / keyboard approvals | ✔ | No select, keys or undo (grep on `approvals/*`: empty). | P0 | P0 |
| 23 Recommendation + evidence | ✔ | `WhyFlagged` only. | P1 | P1 |
| 24 Ageing / reminders / delegation | ✔+ | `escalate` sends **no notification and logs no activity** (`approvals.ts:242–271`). The escalator then loses sight of the item (`lib/roles.ts:4–15`). | P1 | **P0** (ff-03) |
| 25 Bookkeeper split-view queue | ✔+ | The bookkeeper **can't approve an inbox document** (`ingest.ts:318` `managerProcedure`) or **correct an invoice** (`receiving.ts:553, 636` `managerProcedure`). | P1 | **P0** (ff-07) |
| 26 Pay run by due date, netting, mark paid | ✔+ | **No writer for `paid`/`approved` at all.** `due_date` is never populated by the API. A naive "mark paid" would also **drop claim lines** (`lib/claims.ts:40`). | P1 | **P0** (ff-04) |
| 27 Supplier statement | ✔ | Internal ledger only (`suppliers.ts:99`, `consolidated.ts:43`). | P1 | P1 |
| 28 Allocation chase | ✔+ | Flag only. **The pay run ignores it** (no reference in `payRun.ts`). | P1 | P1 (gate in ff-04) |
| 29 Accounting push / GL | ✔ | File exports. | P2 | P2 |
| 30 Bank-detail change | ✔ | No bank fields. | P2 | P2 🔒 |
| 31 Send claim + portal + chase | ✔+ | Print-only. `letter_sent` is manual. Claims are created lazily. Reminders go to the restaurant. | P0 | P0 🔒 |
| 32 Scorecard KPIs | ✔ | `packages/charts/src/suppliers.ts:19–29`. | P2 | P2 |
| 33 Supplier price list via portal | ✔ | Portal handles order confirmation only. | P2 | P2 ⚖️ |
| 34 Waste / transfers | ✔ | Recipe yield only. | P2 | P2 ⚖️🔒 |
| 35 Count templates | ✔ | Six fixed areas. | P2 | P2 |
| 36 Palette / keyboard / job IA | ✔ | Covered by exec-desktop-09 and ia-nav. | P1 | P1 |
| 37 Chain actions | ✔ | Overview and alerts are read-only queries. Acting means `switchTarget` (`chain.ts:339–463`). | P1 | P1 |
| 38 Month close | ✔ | The pieces are spread across 6 routes. | P1 | P1 |
| 39 Agentic drafts | ✔ | `ask` has 4 read-only tools (`ask/tools.ts:177–205`). The draft→confirm pattern exists only for order capture. | P2 | **P1** (ff-15) |

**New gaps this lens found (not in FG-01…39):**

| # | Gap | Finding |
|---|---|---|
| N1 | PO, invoice and supplier-answer **state machines exist in the schema but are never advanced**. | ff-01 |
| N2 | There is **no document chain**: no link PO ↔ receipt ↔ invoice ↔ claim ↔ credit note on any page. | ff-09 |
| N3 | **Silent hand-offs.** Escalation, supplier answer, OCR failure and dock exception notify no one. | ff-03 |
| N4 | Decision verbs: **the rubric's own sample labels map to the opposite procedure**. | ff-08 |
| N5 | **The consolidated proposal is read-only**, so a ריכוז invoice waits for ever. | ff-13 |
| N6 | **No document type at ingest.** A credit note becomes an "invoice". | ff-14 |
| N7 | **The "approvals" queue looks empty** to manager and bookkeeper while items wait on someone else. | ff-07 |
| N8 | **WhatsApp alerts can't reach a person** even with credentials: role target, free text, no phone on file. | ff-02 |
| N9 | **No flow-health instrumentation.** PO/GR coverage of spend, time-to-decision and claim-send rate are not measured. | ff-20 |

---

## 3. Design principles for the target loop (each one is checkable)

1. **Every object advances itself.** A status changes because an *event* happened (a supplier answered, a receipt closed, a decision was made, a credit note was matched). A person never edits a status by hand, except to correct one, and a correction leaves a history row (H7).
2. **Every hand-off is a task with an owner, a ₪ amount and one verb.** If a stage ends and nobody is told, that is a bug. Test: every mutation that ends a stage either enqueues a task or proves that none is needed.
3. **Drafts are free; sends and money need a human.** AI and automation may *prepare* orders, letters, chases, links and pay runs. A human taps once to send or commit. Outbound messages to a supplier get a 10 s "בטל שליחה" (R-8). Money write-offs get a ConfirmDialog that names the ₪ and the supplier (C10).
4. **Evidence travels with the money.** The dock photo, the driver's acknowledgement and the supplier's reply are attached to the claim automatically, and the claim letter cites them (G8, H7).
5. **Coverage before cleverness.** Any delivery the restaurant pays for must be able to enter the 3-way match, even without a PO, without an invoice photo, or late. This is the North-Star manufacturing step (FG ₪ lens: about ₪225/month per 10 pp of spend under PO+GR at ₪150k).
6. **The phone does the stage; the desk sees the whole chain.** Mobile flows end in a closed state, not a "now go to the desktop". The desktop shows the full document flow and batch actions.

---

## 4. Target end-to-end flow (the deliverable)

### 4.1 Object state machines: what exists, what must fire, and who fires it

Most target states **already exist as enum values**. The work is wiring the transitions, which is mostly agent-safe. 🔒 marks a schema or migration change, which needs a human-authored PR.

| Object | States (enum today) | Missing transition → trigger (owner agent) | New state? |
|---|---|---|---|
| **PO** `po_status` | draft · sent · confirmed · partial · closed · cancelled | **sent → confirmed** on a supplier "confirm as is", or on the manager tapping "קבל שינוי" after "changes" (`supplierConfirm`, web-feature-engineer). **sent/confirmed → partial** when the GR closes partial (`submitReceipt`). **→ closed** when the GR is completed **and** every linked invoice is matched (match job, ocr-procurement-engineer). **cancelled** + supplier notice (deferred send). | `late` and `not_arrived` are **derived** (late = `expected_delivery_at` + 60 min with no GR; not_arrived = the receiver's tap, kept in `activity_events`): no enum change. `seen` needs `supplier_confirm_links.opened_at` (🔒, P2): the table has only `created_at`/`expires_at`/`revoked_at`. |
| **GR** `gr_status` | pending · partial · completed · rejected | Add the **evidence record**: per-line reason chip, qty, photo, and the driver's name + signature (`gr_lines.photos/condition_notes/reject_reason` exist). Today `signature_url` holds the invoice photo. Walk-in GR: a retro PO with `source='manual'` + `source_ref='walk_in'` (no enum change). | none |
| **Invoice** `invoice_status` | ocr_pending · parsed · matched · disputed · approved · paid | **matched/disputed → approved** = "אשר לתשלום" (bulk per supplier; owner/bookkeeper). **approved → paid** = "סמן כשולם" with date, amount and method. When short-paid net of accepted claims, those claims move to `acknowledged` ("קוזז בתשלום"). 🔒 `paid_at`, `paid_amount_agorot`: until they exist, the paid date can live in `audit_log`. | none (🔒 2 columns) |
| **Document type** | none | Classify each ingested or captured document as חשבונית / תעודת משלוח / חשבונית ריכוז / תעודת זיכוי / כרטסת (OCR prompt + a confirm chip). A credit note goes to `credit_notes` and is matched to an open claim (H5). | 🔒 `invoices.doc_type` or a staging column |
| **Discrepancy** `resolution_status` | open · accepted · rejected · escalated · resolved | **accepted → create the claim in the same transaction** (call `syncClaims`). **escalated → owner task + push**, plus a "ממתין לבעלים" lane for the escalator. | none |
| **Claim** `recovery_status` | claimed · letter_sent · acknowledged · credited · recovered · disputed · written_off | **claimed → letter_sent** when the send actually goes out (outbox row `sent`), never by hand. **letter_sent → acknowledged/disputed** from the supplier portal, per line. **→ credited** when a credit note is matched or the invoice is short-paid. **credited → recovered** when the netted payment is marked paid. | 🔒 a claim-portal link table (like `supplier_confirm_links`) |
| **Consolidated link** | none (the proposal is read-only, `consolidated.ts:20–24`) | "אשר שיוך" writes invoice ↔ delivery-note links. Then the invoice leaves T4 "ממתינה לשיוך" and enters the match and pay run. | 🔒 link table; matching-engine-guardian review |

Every transition writes one `activity_events` row (the table exists). That row feeds the document flow (§4.6) and H7 history.

### 4.2 The flow by role and device (target swimlane)

```
            MANAGER (phone)     SUPPLIER (WhatsApp/portal)   RECEIVER (phone)        SYSTEM                      OWNER (phone→desk)        BOOKKEEPER (desk)
 T-2h cut   ◀ push "הזמנה מוכנה" (AI draft from guide/usual qty)
            [שלח] 1 tap ───────▶ order + 72h link
                                  confirm / change lines ──────────────────────────▶ PO→confirmed (or "changes")
            ◀ push "שינו 2 שורות" [קבל שינוי] ───────────────────────────────────────▶ revised expectation (audit keeps original)
 06:30                                                    ◀ push "3 משלוחים היום"
 arrival                                                  card → [הכל כמו שהוזמן] or ✗ line → reason+photo
                                                          📷 invoice/תעודת משלוח (parallel, never blocks)
                                                          driver name+sign → [סיים] ──▶ GR closed, PO→partial/closed
            ◀ push "חסרים 4 ק״ג · ₪48 · הנהג חתם" (time-sensitive, driver still there)
                                                                                   OCR+match (background)
                                                                                   ──────────────────────────▶ ◀ push "₪48 · ירקות השרון · חויב על 10, התקבלו 6"
                                                                                                               [דרוש זיכוי ₪48] (1 tap, Undo 10s)
                                                                                   claim created + evidence ──▶ AI draft letter per supplier (16:00 batch)
                                                                                                               [שלח לספק] → preview → deferred send
                                  portal: accept/dispute per line, upload credit note ─▶ claim→acknowledged/credited
                                                                                   day 3/7/14 chase drafts ──▶ [שלח תזכורת]
                                                                                                                                         pay run (due this week):
                                                                                                                                         invoice ₪X − claim ₪48 = ₪Y
                                                                                                                                         [אשר לתשלום] → bank file
                                                                                                                                         [סמן כשולם] → claim→recovered
```

**Tap budgets per stage.** "Today" figures are from mobile-field and area reviews. Targets are benchmarked.

| Stage | Today | Target | Benchmark |
|---|---|---|---|
| Routine 10–12-line order | ≈40 taps + typing | **6–9 taps, ≤45 s** (pre-filled guide) | R365 Autofill to Par, 6–7; Choco N+6 |
| Accept a supplier change | impossible | **1 tap from push** | Choco delivery confirmation; Rekki read receipts |
| Clean delivery | ≈9 taps + OCR wait | **3 taps, 0 s wait** | Choco Delivery Check, Galley "Receive outstanding" |
| One exception line with evidence | 1–3 taps, no evidence possible | **≤4 taps** (✗ → chip → 📷 → שמור) | Choco ✗ → issue type → photo |
| Decide one flag | open app → queue → card → "אשר" | **1 tap from push** (Android action) or **2 taps** (iOS: push → sheet → verb) | Ramp Inbox on mobile; R365 Red App |
| Send all claims of the day | print → off-app → manual status | **2 taps** (preview → שלח הכל) | Choco "Request for Supplier" |
| Pay a supplier net of claims | impossible | **3 clicks** (select supplier → אשר לתשלום → סמן כשולם) | Ramp release from Inbox |

### 4.3 The task model (one spine for the mobile Today and the desktop Inbox)

Add a computed **`tasks.mine`** query. It needs no new table for v1, because each task is derived from existing rows. It feeds:
- the role home "עכשיו" (FG-20, ia-nav-01);
- nav badges (D2);
- the push and badge count (D9);
- the bookkeeper's desk inbox (FG-21, exec-desktop-03).

Snooze and assign need a table (🔒, P2). The procedure needs a COVERAGE entry in `cross-tenant.attack.test.ts`; adding one is allowed.

| Task type | Source rows | Who | Tier | ₪ shown | Primary verb (he) | Due / age |
|---|---|---|---|---|---|---|
| order_due | supplier schedule × no open PO before cut-off (`previewDelivery`) | manager | T2 | est. order ₪ | **הכן הזמנה** | countdown to cut-off |
| order_request | chef/receiver draft PO (`status='draft'`, `created_by` role ∈ requester) | manager | T2 | draft ₪ | **שלח לספק** | age |
| supplier_change | `supplier_responses` with changes, PO not yet re-acknowledged | PO sender | T2 | Δ ₪ | **קבל שינוי** | before delivery |
| delivery_due / late | PO expected today / expected + 60 min with no GR | receiver (+manager if late) | T2 if late, else T4 | — | **קלוט** / **לא הגיע** | time |
| receipt_exception | GR closed with short/rejected lines in the last 2 h | manager | T2 | short ₪ | **פתח תעודת חריגה** | driver on site |
| doc_review | `ingest_documents` needs review; OCR failed | bookkeeper (+manager) | T2 | invoice ₪ | **אשר לקליטה** / **צלם שוב** | age |
| decision | discrepancy open/escalated routed to me | per `requires_role` | T2 | Δ ₪ | **דרוש זיכוי ₪X** | ageing chip, day 2/3 |
| waiting_on_others | discrepancies routed elsewhere (read-only lane) | escalator, bookkeeper | T4 | Δ ₪ | **הזכר ל‹בעלים›** | age |
| consolidated_link | ריכוז invoice with a proposal | bookkeeper | T4 → T2 at month end | total ₪ | **אשר שיוך** | month close |
| claim_to_send | claims `claimed`, not yet sent | owner/manager | T2 | Σ per supplier | **שלח דרישת זיכוי** | age |
| supplier_disputed | portal reply "dispute" | owner | T2 | ₪ | **השב לספק** | — |
| credit_to_match | credit note with no allocation | bookkeeper | T3 | ₪ | **שייך לדרישה** | — |
| allocation_missing | `vatAtRisk` rows | bookkeeper | T2 | VAT ₪ | **בקש מספר הקצאה** | ITA deadline |
| payment_due | `approved` invoices due ≤7 days | bookkeeper/owner | T2 | Σ − claims | **אשר לתשלום** | due date |
| close_step | unmet month-close checks | bookkeeper | T4 → T2 after the 5th of the month | — | **השלם** | 15th |

### 4.4 Notification matrix (target)

The levels follow D9 and ainative P21. Quiet hours are 23:00–06:00 Asia/Jerusalem, plus Shabbat and holidays, with a per-user override. A person gets **at most 3 time-sensitive messages a day**; anything beyond that is batched. **Passive events never push.**

Every message carries **one ₪ amount, one verb, and a deep link to the exact card**. Android Chrome shows inline actions (`showNotification({actions})`). iOS Home-Screen web push has no action buttons [K], so iOS opens the decision sheet.

| Event (producer) | To | Level | Channel order | When | Message (he) | Deep link → inline action |
|---|---|---|---|---|---|---|
| AI/standing order draft ready (new) | manager | Active | push → in-app | cut-off − 2 h | "הזמנה לירקות השרון מוכנה · 14 פריטים · ₪1,240 · נסגר ב-14:00" | `/orders/[id]?review=1` → **שלח** |
| Chef request (new `orders.request`) | manager | Active (batched 15 min) | push | on submit | "השף ביקש 3 פריטים מירקות השרון · ₪180" | `/orders/[id]` → **הוסף להזמנה** |
| No PO at cut-off − 60 / − 15 (`orderReminders`) | manager | Time-sensitive | push → WhatsApp template | cron 🔒 | "נשארה שעה להזמין ממחלבות הגליל" | supplier guide |
| Supplier answered with changes (`supplierConfirm.submit`) | PO sender | Active | push | on submit | "ירקות השרון שינו 2 שורות · עגבניות 6 במקום 10" | `/orders/[id]#diff` → **קבל שינוי** |
| Supplier confirmed as is | PO sender | Passive | in-app | on submit | "ירקות השרון אישרו את ההזמנה" | — |
| Today's deliveries (`dailyExpectations`, job not immutable) | receiver | Active | push | 06:30 | "3 משלוחים היום · ראשון: ירקות השרון 10:00" | `/receiving` |
| Delivery late (`supplierDelays`) | receiver + manager | Time-sensitive | push | expected + 60 min (cron cadence 🔒) | "ירקות השרון באיחור של שעה" | board → **התקשר / וואטסאפ לסוכן / לא הגיע** |
| Receipt closed with exceptions (`submitReceipt`) | manager | Time-sensitive | push | on close | "חסרים 4 ק״ג עגבניות · ₪48 · הנהג חתם" | `/receiving/[poId]/slip` |
| OCR failed / unreadable (`ocrInvoice`) | the uploader + bookkeeper | Active | push | on failure | "החשבונית מקצביית הכרם לא נקראה · צלמו שוב" | retake |
| Inbox document needs review (`ingest`) | bookkeeper | Active (grouped) | in-app + push | hourly group | "4 מסמכים חדשים לבדיקה" | `/inbox?filter=review` |
| Flag found (`matchInvoice`, exists) | `requires_role` members | Active; Time-sensitive if block ≥ ₪500 before payment | push → WhatsApp template | one per match run | "₪104.80 · משקאות שטיינברג · מחיר מעל החוזה" | `/approvals?invoice=…` → **דרוש זיכוי** / **פתח** |
| Escalated (`approvals.escalate`) | owner | Active | push | on escalate | "נטע העבירה אליך החלטה · ₪100 · קצביית הכרם" | same |
| Decision ageing day 2 / day 3 | decider | Active | push | cron 🔒 | "2 החלטות מחכות יומיים · ₪296" | queue |
| Claims ready to send (new) | owner/manager | Active | push | 16:00 batch | "3 דרישות זיכוי מוכנות · ₪257" | `/leaks/claims` → **שלח הכל** |
| Supplier acknowledged / disputed (portal) | owner + bookkeeper | Active (dispute) / Passive (ack) | push / in-app | on reply | "קצביית הכרם חולקים על ₪100 · 'המחיר עודכן בהסכם'" | claim → **השב** |
| Credit note received and matched (ingest) | bookkeeper | Passive | in-app | on match | "תעודת זיכוי ₪52.50 מדגי הים שויכה לדרישה" | **אשר שיוך** |
| Claim overdue (`recoveryReminders`, exists) | owner/manager | Active | push | 08:30 (exists) | "₪1,522 ממתינים מעל 14 יום · 5 ספקים · תזכורות מוכנות" | **שלח תזכורות** |
| Allocation number missing (`vatAtRisk`) | bookkeeper | Active | push | on match | "חסר מספר הקצאה · מע״מ ₪1,123 בסיכון · דגי הים" | **בקש מהספק** |
| Payments due this week (new) | bookkeeper/owner | Passive (digest) | daily brief | 07:30 | "לתשלום השבוע ₪12,400 ל-6 ספקים · ₪257 מקוזזים" | pay run |
| Daily brief (replaces per-event email) | owner | Passive | email/WhatsApp digest | 07:30 | "בוקר טוב · 3 החלטות · ₪1,240 בסיכון · נתפס אתמול ₪310" | home |

**What is agent-safe and what needs a human PR (AGENTS.md):**
- **Agent-safe:**
  - Event-driven rows: calling `enqueueNotification` from a mutation or job. The outbox already dispatches every 60 s, and `outbox.ts` is used, not changed.
  - Templates (`notifications/templates.ts`).
  - The preferences UI.
  - The service-worker push handler.
  - The phone field in the profile (`users.phone` exists).
- **🔒 Human PR:**
  - New schedules or cadences in `apps/worker/src/cron.ts`.
  - Rate-limit and quiet-hours enforcement in `outbox.ts`.
  - A `push_subscriptions` table (migration).
  - VAPID keys, WhatsApp templates and the Meta business number (Phase-6 credentials).

### 4.5 AI assistance: draft → human confirm

**Rules** (H4, H5; erp-modern P11; ainative P15–P18):
- Every AI output is a **draft object** in the task model.
- It carries the label **"טיוטה של RestoMatch"**, its basis (sources with dates), and one human verb.
- The human verb stays in the same place whatever the recommendation.
- Nothing is sent or committed without a tap.
- Every accept or edit writes an audit row: "נוסח ע״י RestoMatch · אושר ע״י ‹שם›".
- Acceptance rate is measured per draft type (Ramp reports 90%), and any draft type below 60% is turned off.

| Draft | Input (existing data) | Output | Human verb | Guardrails | Benchmark |
|---|---|---|---|---|---|
| **Order draft** | 8 weeks of PO and invoice lines (`recentlyBoughtProducts`), contract prices (`contracts/orderPrices.ts`), supplier schedule (`deriveDelivery.ts`) | draft PO with usual qty, last or contract price, and a "why" per line ("ממוצע 4 הזמנות אחרונות") | **שלח** / **ערוך** | never auto-sends; price guardrail (`orders.guardrail`) shown inline | Choco order guides; Supy AI predictive ordering; R365 Autofill |
| **WhatsApp / voice / photo → order** | `captureOrderDraft` (exists, text) + Hebrew dictation + photo of a paper list | draft PO | **אשר הזמנה** | unknown supplier → candidates, never created | Choco OrderAgent / VoiceAgent |
| **Approval recommendation** | last 5 prices, contract, dock note and photo, past decisions on the same supplier + SKU + rule | chip: "מומלץ: לדרוש זיכוי" / "מומלץ: לבדוק" / "מומלץ: לוותר", with an (i) | the existing verbs | suggest-only; any auto rule is an owner setting + audit (engine untouched) | Ramp Policy Agent |
| **Claim letter / message** | accepted discrepancies + evidence (photo, driver sign-off, contract line) | per-supplier Hebrew letter + WhatsApp text + PDF + portal link | **שלח לספק** (preview, 10 s undo) | amounts come only from `lib/claims.ts`; the LLM never computes ₪ | Choco Request for Supplier; SAP Joule dispute agent |
| **Chase** | claim age, supplier replies | day 3/7/14 follow-up text in escalating tone | **שלח תזכורת** | max 3 drafts; a stop after "disputed" | Ramp reminders; [Research] nobody chases to cash |
| **Allocation-number request** | `vatAtRisk` invoice | WhatsApp/email to supplier | **בקש מהספק** | blocks the pay-run row until it is resolved | ITA flow; Priority SOP |
| **Consolidated link** | `consolidated.proposal` (exists, read-only) | pre-checked high-confidence links | **אשר את כל ההתאמות הוודאיות (N)** | medium needs a per-row tap; tolerance read from the engine (C4) | Xero Find & Match; xtraCHEF |
| **Credit-note match** | ingested credit note + `creditLineSuggestions` (exists) | allocation to claims | **אשר שיוך** | integer agorot via `allocateCredit` | Xero; MarginEdge credit tracking |
| **Pay-run proposal** | approved invoices by due date − accepted claims − VAT holds | batch with net amounts | **אשר לתשלום** | owner sets the threshold; never initiates payment | Ramp Bill Pay; Ottimate VendorPay |
| **Daily brief** | `tasks.mine` + yesterday's catches | 3-line digest | — (read) | nothing is sent when nothing needs the user (P22) | Linear Pulse |

`ask` today has four read tools. Extend it with **draft-only write tools**: `draft_claim_letters`, `draft_order(supplier)`, `draft_pay_run(week)`. Each returns a draft id to open, never a side effect. Each tool needs a COVERAGE entry.

### 4.6 The document flow strip (the desk's "where is my money?")

A `<DocumentFlow>` strip sits at the top of PO, receipt, invoice and claim detail. It is horizontal on desktop and a vertical stepper on phone:

`הזמנה PO-24108 · נשלחה 24.10` → `אישור ספק · שינה 2 שורות` → `קבלה · חלקית, חסרים 4 ק״ג · נחתם` → `חשבונית SH-24124 · ₪870.09 · 2 חריגות ₪48` → `דרישת זיכוי · נשלחה 25.10` → `זיכוי ₪48 · התקבל 2.11` → `שולם נטו ₪822.09 · 5.11`

- Each node is a link, with a status chip (icon + word + colour, C11).
- A missing node reads in T4: "לא נקלטה קבלה".
- Backed by a new read query `documents.flow({kind, id})`, with a COVERAGE entry.

**Exemplars:**
- SAP S/4HANA Fiori "Document Flow / Related documents".
- Odoo smart buttons (PO ↔ receipts ↔ bills).
- Ramp's bill "3-way match" tab, which shows the linked PO and receipt.

---

## 5. Findings

Format: **id · P · kind · route · role · device**, then evidence, problem, recommendation, effort, humanPR and benchmark.

### P0

**functional-flows-01 · P0 · functional · orders, receiving, invoices, pay-run, s/[token] · all · both: the loop's state machines exist in the schema, but nothing advances them**
- **Evidence:**
  - PO status is written only by `placeOrder` (`orders.ts:942, 1006`) and `cancelOrder` (`:777`). Grep for `'confirmed'|'partial'|'closed'` writers in `packages/api/src`: none.
  - `submitReceipt` updates only `goods_receipts` (`receiving.ts:851–866`).
  - The invoice enum has `approved` and `paid` (`schema.ts:64–71`), but no procedure writes them.
  - `supplierConfirm/service.ts:35`: "The purchase order is never written."
  - Shots: `dashboard_orders__manager__phone-he__0.png` (status chips), `dashboard_approvals_pay-run__owner__desktop-he__0.png` ("ניתן לשלם" with no action).
- **Problem:** the order list, the receiving board, the pay run and the ledger can't tell what has really happened to an order or invoice.
  - "Received", "invoiced", "paid" and "supplier changed it" are invisible unless someone opens each object.
  - The PO tabs "חלקיות / התקבלו / נסגרו" fill only from seed data.
  - Downstream tasks (ff-09 chain, task model) have nothing to key on.
- **Recommendation:** add one `lifecycle` module per object (`packages/api/src/orders/lifecycle.ts`, `invoices/lifecycle.ts`), with explicit `canTransition` tables like `recovery/lifecycle.ts`. Fire the transitions from events:
  - supplier confirm → `confirmed`;
  - GR closed partial → `partial`;
  - GR completed + all linked invoices matched → `closed`;
  - "אשר לתשלום" → invoice `approved`;
  - "סמן כשולם" → `paid`.

  Derive `late` and `seen` from timestamps. Each transition writes `activity_events` and calls `enqueueNotification` where §4.4 says. No enum change is needed. Only `paid_at`/`paid_amount` are 🔒 (use `audit_log` until then).
- **Effort:** M · **humanPR:** no for the transitions; the two payment columns are a separate human PR.
- **Benchmark:** Ramp bill states (For approval → Scheduled → Paid; "Waiting for match"); Odoo PO status bar (RFQ → PO → Received → Billed).

**functional-flows-02 · P0 · functional · notifications (all events) · owner, manager, receiver, bookkeeper · mobile: no team member can be reached on a phone**
- **Evidence:**
  - Push is `MockPushNotifier`, which writes outbox rows and **marks them `sent`** (`notifications/push.ts:9–19`). The real dispatcher: "push: no real provider wired yet" (`jobs/outboxDispatch.ts:238`).
  - The WhatsApp alert target is the string `role:${role}` (`jobs/matchInvoice.ts:200`). It is posted verbatim as the Cloud API `to` (`whatsappCloud.ts:47–58`), and it is a free-form `type:'text'` message, which Meta allows only inside a 24 h customer-service window [K].
  - `users.phone` exists (`schema.ts:181`), but no profile or team screen collects it.
  - Settings has no notification preferences (`dashboard/settings/*`).
  - Operational emails go to owner+manager only (`recipients.ts` `MANAGER_ROLES`), so the receiver never hears about a late truck.
- **Problem:** every T2 moment (a flag, a late truck, a supplier change, a dock shortage) waits until someone opens the app on a desk. The outbox reports "sent" pushes that went nowhere, which is misleading for ops. This blocks FG-02/05/09/24 and the whole §4.4 matrix.
- **Recommendation:** in dependency order:
  1. A profile phone field + WhatsApp opt-in (`settings/profile-form.tsx`, `users.phone`).
  2. Resolve role targets to member phones at enqueue time, mirroring `recipientsForRestaurant`, in `matchInvoice.ts` and the other jobs.
  3. **WhatsApp utility templates** with variables (₪, supplier, deep link): `rm_decision_needed`, `rm_delivery_late`, `rm_claim_reply`.
  4. Web Push (VAPID) for the installed PWA:
     - one app-wide manifest (mobile-field-12);
     - a permission ask after the first completed task, from a user gesture (iOS 16.4+ Home Screen);
     - a SW `push` handler with Android `actions`;
     - `navigator.setAppBadge(tasks.count)`.
  5. Preferences (event × channel) plus quiet hours (23:00–06:00 + Shabbat).
  6. Make the mock notifiers write `status='skipped_no_provider'` instead of `sent`.
- **Effort:** L · **humanPR:** **yes** (`push_subscriptions` migration; quiet hours/rate limits in `outbox.ts`; VAPID keys, Meta templates and number are Phase-6 credentials).
- **Benchmark:** Ramp (approval DM + reminders on day 2/3, the same Inbox on mobile); R365 Red App approvals; Apple HIG interruption levels; WebKit Web Push for Home-Screen apps.

**functional-flows-03 · P0 · flow · approvals (escalate), orders (supplier answer), receiving (exceptions), inbox/OCR (failures) · owner, manager, bookkeeper · both: hand-offs between people are silent**
- **Evidence:**
  - `approvals.escalate` inserts an `audit_log` row and returns. There is no `logActivity` and no enqueue (`approvals.ts:242–271`). After escalating, a manager's queue filters to `requires_role='manager'` (`lib/roles.ts:4–15`), so the item vanishes from the escalator's view.
  - The supplier's portal submit has no notification or activity (grep `supplierConfirm/*`).
  - `submitReceipt` with short lines notifies no one (`receiving.ts:819–883`).
  - An OCR failure is visible only on the wizard or inbox row.
- **Problem:** "העבר לבעלים" is a black hole; the owner finds it only by browsing the queue.
  - A supplier's "only 6 of 10" never reaches the manager before the truck.
  - A dock shortage reaches the manager only after OCR + match, which can be hours, by which time the driver is gone.
  - This breaks rubric D9 and principle 2 (§3).
- **Recommendation:** add an event emitter at the end of these four mutations, writing **one activity row + one task + one notification** each (copy in §4.4):
  - `escalate` → owner push "‹שם› העביר/ה אליך החלטה · ₪X". Add a read-only **"ממתין לאחרים"** lane in the escalator's queue: "ממתין לבעלים · יומיים · ₪100 · [הזכר]".
  - Supplier submit → PO sender push "‹ספק› שינו N שורות".
  - `submitReceipt` with shortfall or rejections → manager push, time-sensitive, while the driver is still there.
  - OCR failure → uploader push "צלמו שוב".
- **Effort:** S · **humanPR:** no (uses `enqueueNotification`; no cron change).
- **Benchmark:** Ramp "who's next" and creator notification on rejection; Linear assignment notifications; Rekki order read receipts.

**functional-flows-04 · P0 · functional · /dashboard/approvals/pay-run, /dashboard/invoices/[id] · bookkeeper, owner · desktop: "approve before payment" ends in a CSV, and a payment can never be recorded**
- **Evidence:**
  - The pay run: "Not paid is `invoices.status <> 'paid'` — the app has no payment rail" (`payRun.ts:19, 226`). Nothing writes `paid` or `approved`.
  - `due_date` (`schema.ts:813`) is never populated by API code.
  - `payRun.ts` never reads `vatAtRisk`, so an invoice that cannot be deducted shows "ניתן לשלם".
  - `lib/claims.ts:40`: `if (inv.pendingLink || inv.status === 'paid') return []`. Once "mark paid" exists, **every claim on that invoice disappears from the letters** while the supplier still owes.
  - Shot: `dashboard_approvals_pay-run__owner__desktop-he__0/1.png` ("לדרוש זיכוי ₪0.00", rows "ניתן לשלם", CSV the only action).
  - area-approvals covers the screen side (approvals-21/22/24).
- **Problem:** the bookkeeper can't close a supplier's month in the product. Clean invoices pass with no invoice-level approval (no threshold for big bills). The "pay ₪X − claimed ₪Y" netting that keeps money in hand is impossible. Adding mark-paid naively would silently lower recovery.
- **Recommendation:**
  1. **"אשר לתשלום"** per invoice and per supplier (bulk); invoice → `approved`. Owner policy: invoices over ₪N or from a new supplier need the owner.
  2. **"סמן כשולם"** with date, method and amount. A default amount = total − accepted claims (short-pay) moves those claims to `acknowledged` with the note "קוזז בתשלום ‹תאריך›", and to `recovered` when paid.
  3. **Change `claimableLines` so a paid invoice keeps its unpaid claims** in the tracker (only fully-netted claims drop out).
  4. **Due date:** parse `suppliers.payment_terms` (שוטף+30/60/90) into `invoices.due_date` at match time. Group the pay run by due week, not invoice month.
  5. A pay-run row with a missing allocation number = T2 hold "חסר מספר הקצאה · ₪VAT", with **בקש מהספק** (ff-17).
  6. Bank batch: Masav/bank CSV now; payment initiation later (ISA timeline, Dec 2026).
- **Effort:** M · **humanPR:** **yes** for `paid_at`/`paid_amount_agorot` columns (MVP can write the date to `audit_log`); `lib/claims.ts` needs `matching-engine-guardian` review (it feeds the letters' ₪).
- **Benchmark:** Ramp Bill Pay (For approval → Scheduled → Paid, release from Inbox); Ottimate VendorPay; R365 payment runs approved on mobile; BILL approval → payment.

**functional-flows-05 · P0 · functional · /dashboard/leaks/claims, /dashboard/recovery, /s/[token] · owner, manager, bookkeeper (+ supplier) · both: claims never leave the building, and the clock starts late**
- **Evidence:**
  - Letters are print-only (`leaks/claims/page.tsx:12, 202` `PrintButton`).
  - `letter_sent` is set by hand (`recovery/tracker-client.tsx:287`).
  - Claim rows are created only by `syncClaims`, which runs when `/recovery` or the monthly report is opened, or at 08:30 (`recovery.ts:49, 61`; `reports/monthly.ts:163`; `recovery/reminders.ts:141`). So `claimed_at`, and the 14-day overdue clock, starts whenever someone happens to look.
  - Overdue reminders email the restaurant's own managers (`recovery/reminders.ts:19–24, 140–170`).
  - The token portal confirms orders only (`supplierConfirm/service.ts`).
  - Shots: `dashboard_leaks_claims__owner__desktop-he__0.png` ("לשליחה" badges with print only); `dashboard_recovery__owner__desktop-he__0.png` ("32 באיחור · ₪1,522", recovery rate 52%).
- **Problem:** the recovered ₪ (the "₪ back" the owner believes) depends on a human printing, mailing and re-typing statuses. [Research] calls chasing to cash the unfilled leapfrog: no restaurant product does it.
- **Recommendation:**
  1. Create the claim **inside the `approve` transaction** (call `syncClaims` there), so `claimed_at` = decision time.
  2. On `/leaks/claims`, per supplier: **"שלח דרישת זיכוי"** → preview (letter + WhatsApp text + PDF) → choose channel:
     - WhatsApp template;
     - email;
     - "מהוואטסאפ שלי" (wa.me deep link, zero credentials).
  3. Deferred send with **"בטל שליחה" for 10 s** (R-7/R-8). The status moves to `letter_sent` only when the outbox row is `sent` (or the user confirms they sent it themselves).
  4. **Claim portal** (`/s/c/[token]`, 72 h, reusing the `supplierConfirm` token model): per line **מאשר / חולק + סיבה**, plus an upload for the תעודת זיכוי → `acknowledged` / `disputed` / `credited`.
  5. Chase drafts at day 3/7/14, sent with one tap (AI-drafted, ff-15).
  6. Supplier reply → push to owner (ff-03).
- **Effort:** M–L · **humanPR:** **yes** (new public token route: attack test + rate limit + size limits per MASTER-PLAN §1.4; claim-link table migration; chase cadence in `cron.ts`).
- **Benchmark:** Choco "Request for Supplier" (credit note / replacement from the delivery check); SAP Joule Dispute Resolution Agent; Cut+Dry "Request a credit".

**functional-flows-06 · P0 · functional · /dashboard/receiving, /dashboard/receiving/[poId] · receiver, manager · mobile: real deliveries can't enter the 3-way match (walk-ins, late POs, no-invoice counts)**
- **Evidence:**
  - `todayExpectations` lists sent/confirmed/partial POs dated today, or undated recent ones (`receiving.ts:80–130`).
  - `startReceipt` requires a `poId` (`:688–705`).
  - Yesterday's undelivered PO drops off and stays `sent` for ever (no "didn't arrive" path).
  - The only count-without-photo path is "השתמש בחשבונית-דמה (ללא העלאה)" (`InvoiceScan.tsx:158–170, 263–267`; `lib/i18n/messages/receiving/he.ts:49`). It works only because the mock URL has no `publicUrl`, which triggers `buildFromPoOnly` (`wizard.tsx:263–273, 442`).
  - Shots: `dashboard_receiving__receiver__phone-he__0.png` (three cards, no "+ ספק הגיע בלי הזמנה", no late group); `dashboard_receiving_ID__receiver__phone-he__0.png` (demo button).
  - Screen detail in RCV-04/05/16/31 and mobile-field-03/09. This finding is the **coverage** view.
- **Problem:** every PO-less or late delivery is matched on two documents at best. QTY_SHORT and QTY_OVER on that spend are invisible: that is ₪675–₪1,125/month at ₪150k spend if 30–50% arrive PO-less (FG-11 estimate). A receiver who must skip the photo has to tap a "demo" button on a real delivery.
- **Recommendation:**
  - **Receiving board groups:** באיחור (carried over until resolved) · צפוי היום · התקבל · **[+ ספק הגיע בלי הזמנה]**.
  - **Walk-in:** pick the supplier (or detect it from the delivery-note photo) → count from that supplier's guide → GR + retro PO (`source='manual'`, `source_ref='walk_in'`; no enum change).
  - **"לא הגיע":** notifies the manager, with **קבע מחדש** / **בטל מול הספק**.
  - **Count-first default:** "הכל התקבל כמו שהוזמן"; the invoice or delivery-note photo is a parallel chip "📷 צלם מסמך (אפשר גם אחר כך)".
  - **Rename the demo button** to "אין חשבונית עכשיו — המשך לספירה" and gate the real demo to `/showcase` only.
- **Effort:** M · **humanPR:** no (new procedure `receiving.startWalkIn` + a COVERAGE entry; `tenant-security-warden` review).
- **Benchmark:** Galley ad-hoc receiving; Choco Delivery Check; Supy "Receive Order"; Odoo Barcode create-receipt-on-the-spot.

**functional-flows-07 · P0 · flow · /dashboard/orders, /dashboard/inbox, /dashboard/invoices/[id], /dashboard/approvals · chef, bookkeeper, manager · both: roles stop at stage boundaries, and the queue lies about "all handled"**
- **Evidence:**
  - Chef: `/dashboard/orders` is owner+manager (`roles.ts:70`); `createDraft` is `managerProcedure` (`orders.ts:447`).
  - Bookkeeper: `ingest.approveDocument` is `managerProcedure` (`ingest.ts:318`); `updateInvoiceHeader`/`updateInvoiceLine` are `managerProcedure` (`receiving.ts:553, 636`).
  - Queue: `myQueue` filters by `expandVisibleRoles` — manager→`['manager']`, bookkeeper→`['bookkeeper']` (`approvals.ts:66–130`; `lib/roles.ts:4–15`).
  - Shot: `dashboard_approvals__bookkeeper__desktop-he__0.png` says **"אין חריגות בתור כרגע · כל ההפרשים טופלו"** while the owner's queue holds 4 items and ₪296 (`dashboard_approvals__owner__desktop-he__0.png`). The bookkeeper's pay-run "לתור האישורים" CTA lands there too (approvals-23).
- **Problem:**
  - The chef, who knows what's missing, phones the order in, so there's no PO.
  - The bookkeeper, ICP's strategic channel ("מיכל", `docs/ICP.md` §1), can't do her own job of verifying and correcting invoices before payment. She is also told everything is handled when it isn't.
  - This breaks D7 (reachability) and A4 ("not yet" vs "clean").
- **Recommendation:**
  - **Requester capability:** chef and receiver can `orders.createDraft` / `updateOrderLine` on their own drafts, never `placeOrder`. Their drafts surface as an `order_request` task (§4.3).
  - **Bookkeeper = invoice editor + inbox approver:** add `bookkeeper` to those procedures' roles (`financeProcedure`).
  - **Queue:** add a collapsed, read-only lane **"ממתין לאחרים · 4 · ₪296"**. The empty state says **"אין החלטות שמחכות לך · 4 ממתינות לבעלים"**, never "כל ההפרשים טופלו" unless the restaurant-wide count is 0.
  - Each widened procedure gets a COVERAGE assertion.
- **Effort:** S–M · **humanPR:** no (procedure roles + add-only COVERAGE; `tenant-security-warden` review).
- **Benchmark:** Choco Team Order (contributors draft, admins send); Ramp procurement intake; Ottimate AP clerk role; Ramp "who's next".

**functional-flows-08 · P0 · copy · /dashboard/approvals (+ push, email, dock slip) · owner, manager, bookkeeper · both: the rubric's sample verbs map to the opposite procedure; lock the mapping before anyone relabels**
- **Evidence:**
  - In code, `approve` → `resolution_status='accepted'`, which **creates a claim** (`approvals.ts:142–188`; `CLAIMABLE_FILTER` `recovery/service.ts:44–46`). `reject` = waive (`he.ts:9–10`: "אישור = נדרוש את הכסף מהספק… דחייה = מוותרים").
  - RUBRIC A5 lists "אשר תשלום כפי שחויב" / "דחה ובקש זיכוי" as model labels. Put on today's procedures, those labels mean **"pay as billed" = create a claim** and **"claim" = waive**.
  - approvals-01 notes the inversion versus AP tools.
- **Problem:** the most likely next PR (relabel the buttons per the rubric) would invert the money effect of every decision. That is an S0 by the rubric's own scale.
- **Recommendation:**
  - Freeze the mapping in one place (`approvals/vocab.ts`) with a unit test:
    - `approve()` ⇒ primary label **"דרוש זיכוי ₪{x}"**;
    - `reject()` ⇒ **"ותר ושלם כפי שחויב"** (one-tap reason chips, H6);
    - `escalate()` ⇒ **"העבר לבעלים"**.
  - Use the same labels in push actions, emails and the dock slip.
  - Add a rubric erratum note to A5.
- **Effort:** S · **humanPR:** no (RUBRIC erratum is a doc change).
- **Benchmark:** Ramp Policy Agent ("Rejection recommended" names the effect); E9 "copy that names the money".

**functional-flows-09 · P0 · ia · /dashboard (all roles), nav, push badge · all · both: there is no task model, so every stage's to-do lives on its own page with no count**
- **Evidence:**
  - The same hero for all five roles (`dashboard/page.tsx:59–112`). Shots: `dashboard__receiver__phone-he__0.png` (₪760 hero + "ממתינות לאישור 4", which the receiver can't act on) and `dashboard__chef__phone-he__0.png`.
  - The only nav badge is `contracts` (`nav.tsx:155–157`).
  - Ask, approvals, inbox, claims, recovery, pay run and receiving each compute their own lists.
  - Screen-level fixes are in ia-nav-01, mobile-field-06 and exec-desktop-03.
- **Problem:** without one `tasks` source, the role homes, badges, push counts and the bookkeeper's inbox will each re-implement "what needs me" and drift (A9 for tasks). Hand-offs (ff-03) have nowhere to land.
- **Recommendation:** add `tasks.mine({role})` as specified in §4.3. It is computed, needs no new table, and gets a COVERAGE entry. It returns `{type, entityId, title, ilsAgorot, tier, due, verb, deepLink}`. Consumers:
  - the role home "עכשיו" (up to 3 by ₪ × urgency, then "עוד N");
  - nav badges (count of T2);
  - `setAppBadge`;
  - desktop Inbox with tabs per type;
  - the daily brief.

  Snooze and assign come later (🔒 table).
- **Effort:** M · **humanPR:** no.
- **Benchmark:** Ramp Inbox (Bills/Receipts tabs, the same on mobile); Linear Inbox/Triage; Apicbase mobile tiles (Count, Waste, Receive).

### P1

**functional-flows-10 · P1 · ia · /dashboard/orders/[poId], /dashboard/receiving/[poId], /dashboard/invoices/[id], /dashboard/recovery · owner, bookkeeper, manager · desktop: no document chain, so a 3-way match can't be followed**
- **Evidence:** grep of `href` across `orders/`, `receiving/`, `invoices/`, `recovery/` and `leaks/claims/`:
  - The order detail links to no receipt or invoice.
  - The invoice page links only to a consolidated holder (`correction-client.tsx:184`).
  - Recovery rows link to no invoice.
  - Shots: `dashboard_orders_ID__owner__phone-he__0.png` (only "ביטול הזמנה"), `dashboard_invoices_ID__owner__desktop-he__0.png` (no PO or receipt reference), `dashboard_recovery__owner__desktop-he__1.png` (invoice numbers as plain text).
- **Problem:** "why is this ₪48 a leak?" needs the PO, the count and the bill side by side. Today it takes URL guessing. This breaks H2 and H7 and weakens the North-Star "an owner believes".
- **Recommendation:** the `<DocumentFlow>` strip (§4.6) + `documents.flow` query.
  - Desktop: horizontal, under the page title.
  - Phone: a collapsible vertical stepper.
  - Each node: number · status chip · ₪ · date, as a link. A missing node renders T4 ("לא נקלטה קבלה").
- **Effort:** M · **humanPR:** no.
- **Benchmark:** SAP Fiori Document Flow; Odoo smart buttons; Ramp's 3-way-match tab on the bill.

**functional-flows-11 · P1 · trust · /dashboard/receiving/[poId] (+ dock slip, claim letter) · receiver → owner · mobile: dock evidence is fake or lost before it reaches the claim**
- **Evidence:**
  - `markGrLine` is sent `photos: [image.publicUrl]`, the invoice photo, on **every** line (`wizard.tsx:505`).
  - `submitReceipt` is sent `signatureUrl: image.publicUrl` (`:510`), so the "driver signature" is the invoice.
  - There is no per-line reason or photo UI (`AdjustQuantities.tsx:195–285`).
  - The dock slip only opens a WhatsApp prefill and records nothing (`dock-slip.tsx:24–26`).
  - The claim letter cites no evidence (`leaks/claims/page.tsx:110–185`).
  - RCV-07/08 cover the capture UI.
- **Problem:** when a supplier disputes "you received 10", the restaurant has an invoice photo, not proof. The claim win rate (₪ recovered ÷ ₪ found) depends on that proof. Recording the invoice as a "signature" is also misleading as an audit record.
- **Recommendation:**
  - Per-line exception sheet: reason chips + qty + rear-camera photo → `markGrLine.photos/rejectReason`.
  - Driver step: name (required) + optional signature canvas → a real `signature_url`.
  - Log `dock_slip_shared` in activity.
  - Claim letter and portal: auto-attach "נחתם ע״י ‹נהג› · 25.10 10:42" + thumbnails. Use long-lived storage paths, not 30-min signed URLs (RCV-08).
- **Effort:** M · **humanPR:** no.
- **Benchmark:** Choco ✗ → issue + photo → Request for Supplier; Lightspeed discrepancies with photos; rubric G8.

**functional-flows-12 · P1 · functional · /dashboard/orders/new, /dashboard/orders/[poId] · manager · mobile: ordering doesn't reliably reach the supplier, and changes after send never do**
- **Evidence:**
  - `placeOrder` with `whatsapp` queues a free-form text to `suppliers.contact_whatsapp` (`orders.ts:906–990`). The Cloud API rejects business-initiated free text outside the 24 h window without a template [K], and the channel is an entitlement (`whatsapp_alerts`).
  - There is no "send from my WhatsApp" (orders-09).
  - Cancel: "ביטול כאן לא מודיע לספק — עדכנו אותו בעצמכם" (`orders/he.ts:80`).
  - After send, lines are frozen (`orders.ts:860`).
  - Guide, repeat and multi-supplier are FG-01/03/04 (orders-01/02/19).
- **Problem:** an order the supplier never got becomes a phone order (no PO). A cancelled or changed order the supplier never heard about becomes a QTY_OVER dispute that RestoMatch itself caused.
- **Recommendation:**
  - Default channel **"שלחו מהוואטסאפ שלי"**: a `wa.me/<supplier>?text=` link with the order text + PDF link. `placeOrder(channel:'none')` records `sentChannel` as manual-WhatsApp, with no credentials needed. Template send comes later.
  - **Edit until cut-off**, re-sending a diff document ("עדכון להזמנה PO-…: +2 ק״ג עגבניות").
  - **Cancel** = a deferred cancel notice to the supplier with "בטל שליחה".
  - Then the guide, "הזמן שוב" and the multi-supplier cart, per orders-01/02/19.
- **Effort:** S (wa.me + cancel notice) / M (amend) · **humanPR:** no (WhatsApp template registration is a human Phase-6 task).
- **Benchmark:** Choco (order in chat, supplier read receipts); Ordermentum Top Up; Sysco "edit until cut-off".

**functional-flows-13 · P1 · functional · /dashboard/invoices/[id] (consolidated panel), pay-run "ממתינות לשיוך" · bookkeeper · desktop: the consolidated-invoice proposal is read-only, so חשבוניות ריכוז wait for ever**
- **Evidence:**
  - `consolidated.ts:20–24`: "READ-ONLY: proposals only — nothing is written, the invoice stays pending."
  - Pay run: "מחלבות הגליל · ממתינה לשיוך להזמנה ₪2,340.18" with no CTA (`dashboard_approvals_pay-run__owner__desktop-he__1.png`).
  - Hero: "2 חשבוניות (₪3,603) ממתינות לשיוך" (`dashboard__receiver__phone-he__1.png`).
  - approvals-27 notes the missing CTA.
- **Problem:** for suppliers who bill monthly (dairy, bread), the bill never enters the leak or the pay run. That is ₪3,603 of spend outside the North-Star number in the demo tenant alone.
- **Recommendation:** turn the proposal into an H5 confirm:
  - pre-check high-confidence pairs;
  - **"אשר את כל ההתאמות הוודאיות (N)"**;
  - a per-row tap for medium pairs;
  - a running remainder with the engine's `TOTAL_TOLERANCE_ILS` (C4).

  On confirm, write the links and run the match. The invoice leaves T4.
- **Effort:** M · **humanPR:** **yes** (a link table migration; `matching-engine-guardian` review because it changes what feeds the hero).
- **Benchmark:** Xero Find & Match; xtraCHEF (submit unlocks when totals reconcile); QuickBooks bank feed review.

**functional-flows-14 · P1 · functional · /dashboard/inbox, /dashboard/recovery · bookkeeper · desktop: credit notes have no path to the claim they settle**
- **Evidence:**
  - Ingest and OCR do no document-type classification (grep for "credit" / "docType" in `packages/ocr/src` and `packages/api/src/ingest`: empty). Every document becomes an `invoices` row.
  - Credits are entered by hand per supplier ("רישום תעודת זיכוי", `tracker-client.tsx:67, 193`; `dashboard_recovery__owner__desktop-he__0.png`), although `creditLineSuggestions` exists (`recovery.ts:117`).
- **Problem:** the most important event in the loop (₪ actually coming back) needs re-typing. A credit note sent on WhatsApp may even be read as a new invoice.
- **Recommendation:**
  - Classify at OCR: חשבונית / תעודת משלוח / ריכוז / **תעודת זיכוי** / כרטסת, with a confirm chip on the inbox row.
  - A credit note goes to `credit_notes` with the suggested allocation from `creditLineSuggestions` → **"אשר שיוך"** → claims `credited`.
  - The same classifier feeds RCV-17 (document type at capture).
- **Effort:** M · **humanPR:** no for the classifier (ocr-procurement-engineer); 🔒 if a `doc_type` column is added.
- **Benchmark:** MarginEdge credit tracking; Ottimate credit memos; Xero suggested matches.

**functional-flows-15 · P1 · functional · /dashboard/ask, approvals, claims, orders · owner, manager, bookkeeper · both: AI reads but never prepares the next step**
- **Evidence:**
  - `ask` exposes 4 read-only tools (`ask/tools.ts:177–205`; `dashboard_ask__owner__desktop-he__0.png`: suggested questions only).
  - The working draft→confirm precedent: `captureOrderDraft` (`orders/captureOrder.ts:18–24`).
  - No approval recommendation (FG-23), no claim, chase or allocation drafts (FG-39).
- **Problem:** the 2026 table stake is "chat with your invoices". The leapfrog is "the next action is already drafted". Without drafts, every §4.2 step costs typing.
- **Recommendation:**
  - The §4.5 catalogue, in order: approval recommendation chip → claim letters → chase → order draft → allocation request → consolidated/credit match → pay-run proposal.
  - Each draft is a task card labelled "טיוטה של RestoMatch", with its basis and one verb.
  - Every accept or edit is audited. Acceptance rate is tracked per type; kill-switch below 60%.
  - Extend `ask` with draft-only tools that return draft ids.
  - The LLM never computes ₪: amounts come from `lib/claims.ts` and the engine.
- **Effort:** M per draft type · **humanPR:** no (any auto-apply rule = owner setting + audit; `approvals/engine.ts` untouched).
- **Benchmark:** Ramp Policy Agent (suggest-only, 90% acceptance); Ramp procurement agents (never approve on their own); Campfire (reviewable before it posts); Choco OrderAgent.

**functional-flows-16 · P1 · functional · /dashboard/receiving (board), jobs `dailyExpectations` / `supplierDelays` · receiver, manager · mobile: the day's deliveries are computed at 06:00 and then nobody is told**
- **Evidence:**
  - `dailyExpectations.ts` builds today's PO list and has no enqueue.
  - `supplierDelays` emails owner+manager once at 10:00 (`cron.ts:83–89`; `supplierDelays.ts:84–114`), never the receiver.
  - The public demo shows the late-delivery board with "התקשרות לסוכן / WhatsApp" that the product lacks (`showcase_deliveries__public__phone-he__0.png`; RCV-34).
- **Problem:** a missing truck is found when service starts, not at expected + 60 min. That means an emergency phone order: no PO and a premium price.
- **Recommendation:**
  - From the existing 06:00 job, enqueue a receiver push "3 משלוחים היום" (the job file is not immutable).
  - A late check every 15 min (🔒 cron cadence) → receiver + manager push with **התקשר / וואטסאפ לסוכן / לא הגיע**.
  - Bring the showcase's late board into `/receiving` (ff-06 groups).
- **Effort:** S (morning push) + S (late check, human-PR schedule) · **humanPR:** **yes** for the 15-min cadence.
- **Benchmark:** US Foods MOXē "30 minutes away"; Sysco deliveries on login; Galley receiving by date.

**functional-flows-17 · P1 · functional · /dashboard (VAT card), /dashboard/invoices/[id] banner, pay run · bookkeeper, owner · both: allocation-number risk stops at a flag**
- **Evidence:**
  - `owner.vatAtRisk` flags invoices over the threshold with no valid מספר הקצאה (`vat/vatAtRisk.ts:8, 34–74`). Banner: "מע״מ בסיכון: ₪1,123 · חסר מספר הקצאה" (`dashboard_invoices_ID__owner__desktop-he__0.png`).
  - No request action; the pay run ignores it (ff-04).
- **Problem:** the 17–18% input VAT on that invoice is a *certain* ₪ loss if paid without the number, and the product already knows it.
- **Recommendation:**
  - **"בקש מספר הקצאה מהספק"**: a WhatsApp/email template draft with deferred send.
  - Track request → reply → corrected invoice (OCR re-reads the number).
  - Pay-run row held until resolved.
  - A task `allocation_missing` with the ITA deadline countdown (H8).
- **Effort:** S · **humanPR:** no (templates; WhatsApp credentials are Phase 6).
- **Benchmark:** Priority's allocation SOP; [Research] no restaurant tool handles allocation numbers.

**functional-flows-18 · P1 · functional · (new) /dashboard/close · bookkeeper, owner · desktop: there is no month close**
- **Evidence:** the pieces live on six routes: `reports/monthly`, `exports`, `suppliers/ledger`, VAT at risk, the consolidated proposal and `recovery` (ia-map §2). No checklist, owner or deadline exists (FG-38).
- **Problem:** un-invoiced delivery notes, unlinked ריכוז invoices and unsent claims slip into next month. The accountant (ICP "מיכל") gets the data by hand.
- **Recommendation:** a "סגירת חודש" page fed by `tasks.mine` close steps:
  1. every delivery note invoiced;
  2. consolidated linked;
  3. allocation numbers complete;
  4. claims sent, with ₪ open;
  5. pay run approved;
  6. export sent.

  Each step shows its count + ₪ + verb. Then **"חבילה לרו״ח"** (zip of exports + ledger + claim letters). Closing freezes the month's hero (H3: "closed months frozen").
- **Effort:** M · **humanPR:** no (the freeze flag may need 🔒 storage).
- **Benchmark:** Rillet close checklist ("day one is review, not rebuild"); Campfire flux commentary.

**functional-flows-19 · P1 · functional · /dashboard/orders/[poId], /dashboard/receiving/[poId] · manager, receiver · mobile: a supplier's change never reaches the receiver's expectation**
- **Evidence:**
  - `supplier_responses` stores line answers (`SupplierResponseLine`, `service.ts:13–16`).
  - `receiving.getPo` and the wizard read only `po_lines` (`receiving.ts:171–230`; `wizard.tsx` `adaptReconciliation`).
  - The confirm card only shows "ממתין לתשובת הספק" (`dashboard_orders_ID__owner__phone-he__0.png`).
- **Problem:** the dock flags a shortage everyone already agreed on (a false T2, against A7). Or worse, the receiver accepts 10 when the supplier said 6 and billed 10.
- **Recommendation:**
  - Show the supplier's answer as a diff on the order ("שונה ע״י הספק: 6 במקום 10 · [קבל שינוי] [התנגד]") and on each dock line ("הספק הודיע: 6").
  - "Accept" sets PO `confirmed` and the receiving expectation. Keep the original in history.
  - Matching against the revised quantity is a `MatchInput` change → 🔒 proposal to `matching-engine-guardian`. Display-only first.
- **Effort:** M · **humanPR:** display no; match input **yes**.
- **Benchmark:** Choco delivery confirmation; Sysco substitutions on the delivery summary.

**functional-flows-20 · P1 · functional · /dashboard (owner), /dashboard/reports/monthly, admin health · owner (+ RestoMatch ops) · desktop: the loop's health isn't measured**
- **Evidence:**
  - The recovery tracker shows a rate (52%, `dashboard_recovery__owner__desktop-he__0.png`).
  - No metric anywhere shows **PO coverage of spend**, **GR coverage**, **time from flag to decision**, **claim-send rate** or **days to credit**. FG §5 says the PO-less share is unmeasured and must be measured first.
- **Problem:** the team can't tell whether ff-06/07/12 are working, and the owner can't see why the leak figure covers only part of the spend.
- **Recommendation:**
  - A "כיסוי הבדיקה" line under the hero: "בדקנו 78% מהרכש · 22% הגיע בלי הזמנה (₪9,400)", with a drill to the uncovered invoices.
  - An ops panel (`/admin` health) with 7 KPIs per tenant:
    - PO coverage %;
    - GR coverage %;
    - median flag→decision hours;
    - % claims sent ≤48 h;
    - ₪ recovered ÷ ₪ found;
    - median days to credit;
    - paid-with-open-claim count.

  Charts SQL is owned by `matching-engine-guardian`.
- **Effort:** M · **humanPR:** no (charts SQL owner review).
- **Benchmark:** Ramp Insights; [Research] "₪ recovered / ₪ found" as the metric nobody publishes.

### P2

**functional-flows-21 · P2 · functional · /dashboard/suppliers/ledger · bookkeeper · desktop: the supplier's own statement (כרטסת) can't be reconciled**
- **Evidence:** an internal ledger plus delivery-note coverage (`suppliers.ts:99`; `consolidated.ts:43`). No import of the supplier's statement (FG-27).
- **Problem:** "credit promised but never issued" and "billed twice across months" are found by hand, if at all.
- **Recommendation:**
  - Upload PDF/Excel → OCR (the classifier from ff-14) → C4 reconciliation.
  - Flags: billed-not-received, credit-missing, payment-unapplied, invoice-we-never-got.
  - Each flag becomes a task.
- **Effort:** M · **humanPR:** no.
- **Benchmark:** MarginEdge statement tool; Ottimate Copilot statement reconciliation; Yooz.

---

## 6. Functional roadmap (dependency-ordered)

**Effort:** S ≈ 1 session, M = 2–4, L = 5 or more (FG convention).
**Markers:** 🔒 = human-authored PR (AGENTS.md immutability or credentials). ⚖️ = `icp-keeper` sign-off first, because `docs/ICP.md` §2/§5 says "MarketMan מזמין, RestoMatch בודק". Ordering items are framed as "fuel for the GR", never as becoming MarketMan.

### P0: close the loop (target: weeks 1–4; pilot bar)

| # | Item | Findings / FG | Device | Effort | 🔒 | Owner agent | Depends on | Done when |
|---|---|---|---|---|---|---|---|---|
| 0.1 | Lock decision-verb mapping + vocab test | ff-08 | both | S | – | web-feature-engineer | – | a unit test fails if `approve` is labelled as pay-as-billed |
| 0.2 | Lifecycle transitions (PO confirmed/partial/closed; invoice approved/paid via audit; activity rows) | ff-01 | both | M | partial | web-feature-engineer + ocr-procurement-engineer | 0.1 | orders tabs and pay run reflect real events in e2e |
| 0.3 | Silent hand-offs → events (escalate, supplier answer, dock exception, OCR fail) + "ממתין לאחרים" lane | ff-03, ff-07 | both | S | – | web-feature-engineer | 0.2 | each of the 4 mutations writes activity + enqueue |
| 0.4 | `tasks.mine` + role "עכשיו" home + nav badges | ff-09, FG-20/21 | both | M | – | web-feature-engineer (+ rtl-design-steward) | 0.2, 0.3 | receiver lands on deliveries; badges = T2 count |
| 0.5 | Role capabilities: chef/receiver requester; bookkeeper edits invoices + approves inbox; honest empty queue | ff-07, FG-02/25 | both | S–M | – (COVERAGE add) | web-feature-engineer + tenant-security-warden | 0.4 | the bookkeeper verifies and corrects end to end |
| 0.6 | Receiving coverage: walk-in GR + retro PO, late group, "לא הגיע", count-first default, rename the demo button | ff-06, FG-11/12/15 | mobile | M | – | ocr-procurement-engineer | 0.2 | a PO-less delivery yields GR + PO + match |
| 0.7 | Claim at decision time + send from app (preview, 3 channels incl. wa.me, 10 s undo) + auto `letter_sent` | ff-05 (part 1) | both | M | – | web-feature-engineer | 0.2 | no manual `letter_sent` in 2 weeks of pilot data |
| 0.8 | Pay run: approve for payment, mark paid (short-pay netting), keep claims on paid invoices, due-date grouping, VAT hold | ff-04, FG-26 | desktop | M | **yes** (paid columns) | web-feature-engineer + matching-engine-guardian (claims.ts) | 0.2, 0.7 | the pay run empties; recovered rises on netting |
| 0.9 | Notifications that reach a phone: phone field, role→phone resolution, Web Push + badge, prefs, quiet hours, mock ≠ "sent" | ff-02, FG-19 | mobile | L | **yes** (migration, outbox, VAPID, Meta) | web-feature-engineer (client) + human | 0.4 | an owner approves from the lock screen on Android |
| 0.10 | Order guide + "הזמן שוב" + send-from-my-WhatsApp | FG-01/03, ff-12 | mobile | M | – ⚖️ | web-feature-engineer / growth | 0.5 | routine order ≤9 taps; PO coverage % rises |

### P1: make it fast and self-driving (weeks 5–10)

| # | Item | Refs | Device | Effort | 🔒 | Owner |
|---|---|---|---|---|---|---|
| 1.1 | Supplier claim portal (per-line accept/dispute + credit upload) + chase drafts 3/7/14 | ff-05 (part 2), FG-31 | both | M–L | **yes** (public route, table, cron) | web-feature-engineer + tenant-security-warden |
| 1.2 | Document flow strip + `documents.flow` | ff-10 | desktop | M | – | web-feature-engineer |
| 1.3 | Dock evidence chain (per-line photo/reason, driver name/sign, slip logged, letter attaches) | ff-11, FG-13 | mobile | M | – | ocr-procurement-engineer |
| 1.4 | Consolidated proposal → confirm links | ff-13 | desktop | M | **yes** | matching-engine-guardian |
| 1.5 | Document-type classifier + credit-note → claim match | ff-14 | desktop | M | partial | ocr-procurement-engineer |
| 1.6 | AI drafts v1: approval recommendation, claim letters, chase, allocation request | ff-15, ff-17, FG-23/28/39 | both | M | – | web-feature-engineer |
| 1.7 | Bulk + keyboard + undo approvals; invoice-level decision | FG-22, approvals-02/04 | desktop | S–M | – | web-feature-engineer |
| 1.8 | Morning deliveries push + 15-min late check | ff-16 | mobile | S | **yes** (cadence) | ocr-procurement-engineer + human |
| 1.9 | Supplier change → dock expectation (display), then match input | ff-19, FG-08 | mobile | M | match input **yes** | ocr-procurement-engineer / matching-engine-guardian |
| 1.10 | Coverage line + flow KPIs | ff-20 | desktop | M | – | matching-engine-guardian (SQL) + web |
| 1.11 | Month close + accountant pack | ff-18, FG-38 | desktop | M | partial | web-feature-engineer |
| 1.12 | Offline outbox for every dock and walk-in write | FG-16, mobile-field-02 | mobile | M | – | ocr-procurement-engineer |
| 1.13 | Multi-supplier "הזמנות היום" + cut-off countdown + amend until cut-off | FG-04/05, ff-12 | mobile | M | cadence **yes** ⚖️ | web-feature-engineer |
| 1.14 | Chain-scoped queue and pay run (actions run per-branch `withRestaurant`) | FG-37 | desktop | L | – | web-feature-engineer + tenant-security-warden |
| 1.15 | Approval ageing chips, day-2/day-3 reminders, delegate-until-date | FG-24 | both | S | cadence **yes** | web-feature-engineer |

### P2: depth (after the pilot proves recovery)

| # | Item | Refs | Device | Effort | 🔒 |
|---|---|---|---|---|---|
| 2.1 | Supplier statement reconciliation | ff-21, FG-27 | desktop | M | – |
| 2.2 | AI order drafts from usual qty + standing orders auto-drafted at cut-off − N h | FG-03, ff-15 | mobile | M | ⚖️ |
| 2.3 | Voice / photo-of-paper order capture | FG-07 | mobile | M | credential |
| 2.4 | Pay-run proposal draft + bank batch file (Masav) | ff-04, FG-26 | desktop | M | – |
| 2.5 | PO approval threshold + weekly budget (separate PO-policy module) | FG-09 | both | M | ⚖️ |
| 2.6 | Shared-tablet PIN | FG-18 | mobile | L | **yes** |
| 2.7 | Catch-weight keypad + per-product tolerance | FG-14 | mobile | M | **yes** (`tolerances.ts`) |
| 2.8 | Scorecard delivery KPIs, renegotiation pack | FG-32 | desktop | S | – |
| 2.9 | Supplier price list via portal; cheaper-supplier hint | FG-10/33 | both | M | ⚖️ |
| 2.10 | Waste/transfer, par, barcode, count templates | FG-06/17/34/35 | mobile | M each | ⚖️ / 🔒 |
| 2.11 | Accounting push + GL auto-coding; bank-detail change check | FG-29/30 | desktop | L | credential / 🔒 |
| 2.12 | Snooze/assign on tasks (table) | ff-09 | both | S | **yes** |

**Expected ₪ effect** ([Est], ICP ₪150k/month food spend, from FG §2):
- 0.6 + 0.10 raise PO/GR coverage. That is up to ₪675–₪1,125/month more *detectable* leak if 30–50% of deliveries arrive PO-less today.
- 0.7 + 1.1 + 1.5 + 0.8 move the recovery rate from the tracker's 52% toward a 70%+ target on found leak.
- 1.6 (allocation) saves 17–18% of VAT per affected invoice.

---

## 7. Flow-health metrics to instrument with P0 (definition → target)

| Metric | Definition | Pilot target | Source |
|---|---|---|---|
| PO coverage | ₪ invoiced with a linked PO ÷ ₪ invoiced | ≥ 80% | invoices × match_runs.po |
| GR coverage | ₪ invoiced with a closed GR ÷ ₪ invoiced | ≥ 70% | match_runs.gr_id |
| Time to decision | median hours from flag created to resolved | ≤ 24 h | discrepancies |
| Claim send latency | % of accepted ₪ with `letter_sent` ≤ 48 h after decision | ≥ 90% | recovery_events |
| Recovery rate | ₪ recovered ÷ ₪ claimed (rolling 90 days) | ≥ 70% | recovery_claims |
| Days to credit | median days `letter_sent` → `credited` | ≤ 14 | recovery_claims |
| Paid with open claim | count of invoices `paid` while a claim on them is `claimed`/`letter_sent` | 0 | invoices × claims |
| Push → action | % of T2 pushes acted on within 4 h | ≥ 60% | outbox × activity |
| Draft acceptance | % of AI drafts sent unedited or lightly edited, per type | ≥ 60% (kill-switch below) | audit |

---

## 8. Governance (AGENTS.md)

- **Immutable files touched by proposals here, which go to a human-authored PR:**
  - `apps/worker/src/cron.ts`: late-check cadence, cut-off reminders, chase cadence, ageing reminders.
  - `packages/api/src/notifications/outbox.ts`: quiet hours, per-user budget, rate limits.
  - `packages/db/src/schema.ts` + new migrations:
    - `push_subscriptions`;
    - claim-portal link table;
    - consolidated link table;
    - `invoices.paid_at`/`paid_amount_agorot`;
    - optional `doc_type`;
    - task snooze/assign.
  - `MatchInput` (revised expectation, ff-19) → `matching-engine-guardian` proposal.
  - `packages/matching/src/tolerances.ts` (catch-weight).
- **Not immutable, but needs owner review:**
  - `lib/claims.ts`, which feeds the letters' ₪ (`matching-engine-guardian`);
  - charts SQL for coverage KPIs.
- **New tRPC procedures** each add a COVERAGE entry in `cross-tenant.attack.test.ts` (add-only):
  - `tasks.mine`;
  - `documents.flow`;
  - `receiving.startWalkIn`;
  - `orders.request*`;
  - `invoices.approveForPayment`/`markPaid`;
  - `claims.send`;
  - draft tools.
- **The public claim portal** needs its own attack test, rate limit and size limits.
- **Credentials** (VAPID, Meta WhatsApp templates and number, bank file formats) are Phase-6 human intake. Build each behind a provider interface whose stub reports `skipped_no_provider`, not `sent`.
- **ICP:** order guide, standing orders, multi-supplier, budget, par and price compare need an explicit `icp-keeper` decision, because the owner's 2026-10-25 direction asks for advanced ordering against the standing veto.

## 9. What I could not verify

- **WhatsApp Cloud API behaviour.** The rejection of free-form business-initiated messages outside the 24 h window, and of `role:` targets, is [K] from Meta's documented rules, not tested live (no credentials in the lab).
- **iOS Web Push.** Missing notification action buttons on iOS Home-Screen web apps is [K].
- **Whether a seeded PO's `partial`/`closed` status reflects a real receipt.** The seed sets statuses directly, so the screenshots can't prove the transition gap. The code can (ff-01).
- **The real share of PO-less deliveries in pilot restaurants** is unmeasured. ff-20's coverage line is the way to measure it.
