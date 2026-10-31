# Area review: Approvals queue, pay run, invoice inbox, invoice detail, scans

**Area key:** `approvals` · **Routes:** `/dashboard/approvals`, `/dashboard/approvals/pay-run`, `/dashboard/inbox`, `/dashboard/invoices/[invoiceId]`, `/scans/[invoiceId]` (code only, not captured)
**Reviewed:** 2026-10-25 against `RUBRIC.md` v1, the research pack (`fintech.md`, `erp-modern.md`, `exec-desktop.md`, `functional-gaps.md`, `ia-map.md`, `ordering-mobile.md`, `rtl.md`), 14 screenshots, `crawl-results.json`, the code on `main` (`8fef118c`) and read-only queries against the lab database (`restomatch_ux`).
**Focus:** managers approve on the phone (one tap with a reason), the bookkeeper runs payments on the desktop, and the invoice detail should put the document, the lines and the variance side by side.
**Crops used in this review:** `scratchpad/ux/review/crops/approvals/*` (phone screenshots cut into 1,700 px device slices, plus desktop crops).

---

## 0. Verdict in one paragraph

This area is where the leak turns into money: either it gets claimed, or the invoice gets paid. The building blocks are honest. `WhyFlagged` shows expected and actual values, the tolerance and the routing rule. The pay run's T2/T3/T4 tone mapping is correct. Filters and saved views live in the URL, and the consolidated cross-match is a real three-way reconciliation. The workflow around those blocks, though, cannot be completed.

1. **The verbs are inverted.** "אשר" means "claim the money from the supplier" and "דחה" means "waive it and pay as billed". The page subtitle has to explain this.
2. **The pay run is read-only.** Nothing in the product can mark an invoice as paid. Only the demo seed sets `status='paid'`.
3. **The pay run filters by invoice month, not by due date.** The most urgent unpaid invoice in the demo, MF-24950 (₪7,363.20, due 28.10, in 3 days), does not appear in the default view.
4. **A dead end for the bookkeeper.** A held invoice's solid "לתור האישורים" button lands the bookkeeper on an empty queue.
5. **The invoice "detail" is not one.** It is an OCR correction form with no PO or receipt, no flags, no decision, and the scan opens on a separate page outside the app shell.
6. **A multi-branch owner can't see most decisions.** About 25 more decisions (≈₪643, including 10 blockers in ירושלים) sit in other branches, invisible from the active one.

On the phone, the first decision button is **≈1,006 CSS px down**. On the desktop, 4 decisions take 2,054 px, and the approve button sits about 1,000 px from the text it decides.

**Scores vs world-class (Ramp Bill Pay / BILL / R365 AP Center / Ottimate):** mobile **3.0**, desktop **3.5**, functionality **3.0**.

---

## 1. What the user actually has today (code-verified)

| Route | Who can open it | Data | Actions | States |
|---|---|---|---|---|
| `/dashboard/approvals` (`approvals/page.tsx`, `list.tsx`, `vocab.ts`) | owner, manager, bookkeeper (`lib/roles.ts:48`). The queue is role-scoped: the owner sees every routed item, the manager sees manager-routed items, the bookkeeper sees bookkeeper-routed items (`approvals.ts:60-65`) | `approvals.myQueue({limit:50, filters})`, ordered by `createdAt DESC` (`approvals.ts:137`), plus `owner.viewOptions`, `myMemberships`, `payRun.enabled` | One card per **discrepancy** with up to 3 inline buttons: העבר לבעלים (ghost), דחה (secondary, opens a required textarea), אשר (primary). Link "פתח חשבונית / תקן OCR" (full navigation). Toolbar: supplier/type/severity filters, comfortable/compact density, CSV, saved views, reset. Header link to the pay run | Empty (`EmptyState`, untyped). `loading.tsx` (3 tiles + 4 × 144 px cards). **No `error.tsx`.** Mutations are not optimistic; `refreshFirstPage()` runs after each one |
| `/dashboard/approvals/pay-run` (flag `payRun`) | finance roles | `payRun.month({monthOffset: 0 \| -1})`. "Not paid" means `invoices.status <> 'paid'`, limited to the **invoice month** (`payRun.ts:224-229`) | Month toggle (this/last, with a plain `<a>` full reload). CSV export. Per-row "לתור האישורים" (unscoped) or "מכתבי דרישת זיכוי". **No selection, no mark-paid, no due date, no partial pay** | Disabled-flag empty, month-empty. Inherits the approvals `loading.tsx` (wrong shape) |
| `/dashboard/inbox` (flags `ingestWhatsapp`/`ingestEmail`, else 404) | finance roles; manage = owner/manager | `ingest.overview`, `ingest.inbox({filter,limit:50})`, `ingest.senders`, `suppliers.list` | Filter pills. Per document: supplier `<select>`, אישור ופענוח, אישור + הוספת השולח, דחייה. Channel generate/rotate/revoke. Allow-list add/remove | Empty ("עדיין לא התקבלו חשבוניות"). **No h1, no loading, no error boundary.** Each action runs a toast plus `router.refresh()` |
| `/dashboard/invoices/[invoiceId]` | owner, manager, bookkeeper, receiver; edit = owner/manager | `receiving.getInvoice` (header + lines + `ocrConfidenceLine`, **no discrepancies**), over-contract badges, dock-price hints, `owner.vatAtRisk`, `consolidated.proposal` (all fetched sequentially) | Edit header (5 inputs, `type="number"`/native date). Edit a line (pencil). **Primary = "הרץ התאמה מחדש".** "צפה בסריקה" → `/scans/{id}`. Print the consolidated letter | Duplicate notice (neutral), OCR pending/failed notices. **No loading.tsx.** In English the page blocks up to 4 s on `ensureEnglish` (`page.tsx:28-33`) |
| `/scans/[invoiceId]` | any signed-in member of the tenant (not in `ROUTE_ROLES`, so the chef can open it) | `resolveScan` → signed URL; demo mocks outside production | View; "open in tab" | Outside the dashboard shell: no back link, no nav, no h1, no skip link |

Found while reading (not visible in the UI):
- `approvals.history` exists (`approvals.ts:276`), but **no component calls it**.
- `approve`, `reject` and `escalate` update the row **without checking its current status** (`approvals.ts:146-160, 199-213, 246-259`). A stale card can overwrite another person's decision.
- `invoices.due_date` is filled for **603 of 603** lab invoices, and suppliers have `payment_terms` such as "שוטף + 30/45/60". The pay run uses neither.
- No procedure writes `invoices.status='paid'` or `'approved'`. The only writer is `apps/worker/scripts/seed-demo.ts:762`.
- The `consolidated` router exposes only `proposal` and `coverage`. **There is no way to accept the proposed delivery-note links** (task #26 is in flight).
- Approval notifications deep-link to the generic `/dashboard/approvals` (`apps/worker/src/jobs/matchInvoice.ts:241`, `endOfDayReport.ts:115`).
- The showcase already contains a better invoice experience than the product: an invoice list with all / has issues / clean / blocked filters, and `InvoicePoCompareViewer`, a side-by-side PO ↔ invoice view with per-line rings and zoom (`showcase/dashboard/_components/InvoicePoCompareViewer.tsx`, 804 lines).

Lab data behind the screenshots, 2026-10-25:

| Item | Value |
|---|---|
| Branch כפר הזיתים, owner queue | 4 items · ₪296.00 · 2 blockers |
| Pay run, can pay | ₪5,901.02 (8 invoices) |
| Pay run, hold | ₪10,148.93 (4 invoices, with only **₪296.00** actually disputed) |
| Pay run, credit | ₪0.00 |
| Pay run, waiting for a PO link | 2 invoices, ₪3,603.32 |
| Other branches, open (owner-visible) | ירושלים: 16 items, ₪538.35, including 10 blockers worth ₪327.77 · חיפה: 9 items, ₪104.41 |
| Unpaid invoice due soonest | MF-24950, 28.09, ₪7,363.20, due **28.10**. It shows only under "חודש קודם" |

---

## 2. Primary tasks, walked end to end

### T1. Floor manager or owner on the phone: "₪104.80 flagged at Steinberg, decide it" (390×844)
1. The email "דרושה החלטה" → "מעבר לתור האישורים" opens the **generic** queue, not the item (1 tap + login).
2. The first viewport holds the worker banner (lab), the title, a 2-line subtitle that explains what the verbs mean, the pay-run button, a **5-control toolbar (≈185 CSS px)** and 3 summary tiles. The first card's buttons sit at **y≈1,006 CSS px**, under the fixed bottom nav (`crops/approvals/appr_phone_1.png`). That costs 1–2 scrolls.
3. Read the card. It shows "צפוי 522.60₪ ⇆ בפועל 575.00₪" (₪ on the wrong side, `dir="ltr"`) and "ההפסד המוערך ₪104.80". **The quantity (2 kegs) is not shown**, so the ₪ can't be checked.
4. Decide:
   - **"אשר"** (12 px label, ≈31 px tall in the capture; 44 px on real touch devices through `globals.css:415`). It sits at the bottom-end corner, the left edge in RTL, away from the thumb. The result: the item is claimed from the supplier. A manager who reads "אשר" as "approve the bill for payment" has just done the opposite.
   - **"דחה"**: a textarea opens. The confirm button stays disabled until the manager **types** a reason on the phone keyboard, then taps "אשר דחייה". That is 3 taps plus typing.
5. Feedback: a spinner, then `refreshFirstPage()` refetches page 1. There is no undo, no "decided" confirmation, and no next card sliding up.
6. To check the evidence first: "פתח חשבונית / תקן OCR" leaves the queue (page load) and opens an OCR form with no flagged line marked → "צפה בסריקה" opens another page outside the shell → browser Back ×2 → the queue reloads at the top → scroll again.

**Count:** 3 taps to approve, 4+ taps plus typing to waive, **7 taps and 3 page loads** to verify and come back. **Benchmark:** BILL mobile swipe-right or Approve; Brex task inbox, a few taps; R365 Red App approves on mobile. Target: **2 taps from the notification**, with evidence in a bottom sheet.

### T2. Owner of 3 branches at the desk: "Clear today's decisions"
1. Approvals (1 click) → 4 items in כפר הזיתים. The page doesn't mention the other branches. The nav has no approvals badge (`nav.tsx:155-157` is contracts-only).
2. Branch switcher → ירושלים. `pick()` hard-navigates to **`/dashboard`** (`branch-switcher.tsx:84`), so approvals takes another click. 16 items there, 10 of them blockers.
3. The same again for חיפה (3 clicks, 1 full reload).
4. Every item is a separate click with a full refetch. No keyboard, no select, no "approve all info".

**Count:** about 9 navigation clicks and 3 reloads before deciding anything, then 29 one-by-one decisions. **Benchmark:** R365 AP Center "My List" across locations; Ramp Inbox. Target: one chain-scoped queue, J/K/1/2, bulk for non-block items.

### T3. Bookkeeper, Sunday payment run (1440)
1. The nav has no pay-run entry. Approvals → small secondary "ריצת תשלומים" (2 clicks). The bookkeeper's approvals queue is **empty** (`dashboard_approvals__bookkeeper__desktop-he.png`).
2. Pay run: 3 KPI cards, then 9 supplier cards, **2,742 px tall**. No due dates. The default month hides MF-24950, due in 3 days.
3. Four invoices are on hold, each with a solid primary **"לתור האישורים"** → an empty queue, because the items are routed to the owner or manager. **Dead end.** No "who is it waiting for", no "remind".
4. ₪4,513.15 (HK-24108) is held whole over a ₪100.00 dispute, with no partial pay.
5. "ייצוא CSV" (1 click) → pay in the bank → **no way to mark paid** → next week the same invoices show again. After two months they drop out of view while still unpaid.

**Result:** the pay run is a report, not a run. **Benchmark:** Ramp Bill Pay (Ready for payment → Scheduled, release from the Inbox); R365 payment runs (approved on mobile); BILL "Approve Selected / Pay".

### T4. Bookkeeper verifies a consolidated invoice (חשבונית ריכוז)
1. Pay run → the "ממתינה לשיוך להזמנה" row (T4, **no CTA**) → open the invoice from the invoice number link.
2. The cross-match panel is read-only and proposes delivery notes. The only action is "print" (a letter). **No "accept the link".** The invoice stays T4 in the pay run indefinitely.

### T5. Owner reviews a WhatsApp document from an unknown sender
1. Inbox → "ממתין לבדיקה" (1 tap).
2. The row shows a filename, the size, a supplier `<select>` and 3 buttons. **There is no thumbnail or preview of the attachment.** The owner approves it into OCR blind, or rejects it with no confirm and no undo.

---

## 3. What is already good (keep it)

- `WhyFlagged` (`list.tsx:301-338`) explains the type, expected/actual, threshold and routing reason in plain Hebrew. It is the right seed for H1.
- The pay run's tone map (`toneOf`, `pay-run/page.tsx:22-26`) gets T2/T3/T4 right. "Waiting for a PO link" and "waiting for the count" are neutral, and duplicates are held and never counted as a credit.
- The pay-run math is careful: integer agorot (`payRun.ts:100-101`), the per-invoice cap shared with the claim letters, and a safety net past the 200-row window.
- URL-based filters and saved views on approvals (`parseView`), plus CSV export.
- The pay run's credit basis is explicit ("לפני מע״מ" / "כולל מע״מ" / "בסיסי מע״מ שונים") and never silently summed.
- The consolidated panel's finding sentence ("חלב 3% · 24 ליטר · חויב ₪7.90 במקום ₪6.40 = ₪36.00", `consolidated-panel.tsx:71-96`) is exactly the H1 math the approvals cards lack.
- The inbox tones are calm: a manager's rejection or a duplicate is neutral, and only failures are red.
- The duplicate-number CONFLICT on header save names the invoice that already holds the number and links to it (`correction-client.tsx:93-100, 180-191`).

---

## 4. Findings

Severity follows the task scale: **P0** blocks or misleads a core task or loses money/trust · **P1** major friction or below benchmark · **P2** polish · **P3** nit. Rubric IDs are in brackets.

### 4.1 Approvals queue (`/dashboard/approvals`)

**approvals-01 · P0 · copy/trust · both [E9, A5, C12]: the decision verbs are inverted versus every AP tool**
- *Evidence:*
  - `lib/i18n/messages/approvals/he.ts:10` (the subtitle has to explain "אישור = נדרוש את הכסף מהספק… דחייה = מוותרים").
  - `he.ts:30-31,35`, `list.tsx:260-273`.
  - `approvals.ts:149` (`approve` → `accepted` → pay run "claim"); `payRun.ts:139-147`.
  - Shots `dashboard_approvals__owner__phone-he.png`, `…desktop-he.png`.
- *Problem:* in Ramp, BILL and R365, "Approve" means **approve the bill for payment**. Here "אשר" means "agree with the flag and claim ₪X back", and "דחה" means "waive it and pay as billed". A manager deciding on the phone cannot tell what happens to the ₪ from the button, and the safe-sounding "אשר" triggers a supplier claim. The activity feed then logs "חריגה אושרה · חיסכון ₪104.80" (`approvals.ts:174-177`).
- *Fix:*
  - Rename the verbs by their money effect. Primary: **"דרוש ₪104.80 מהספק"** (→ `accepted`). Secondary: **"שלם כפי שחויב"** (→ `rejected`, with reason chips, see approvals-10). "העבר לבעלים" moves into a "⋯" menu.
  - English: "Claim ₪104.80 back" / "Pay as billed".
  - Drop the explanatory half of the subtitle.
  - Rename the resolution labels and the activity title to match ("נדרש מהספק" / "שולם כפי שחויב").
- *Exemplar:* Intuit content design (the verb names the outcome); Ramp's bill-level "Approve / Reject" with the outcome stated.
- *Effort:* S · *humanPR:* no.

**approvals-02 · P1 · functional · both [D1, C2]: one card per discrepancy, no invoice-level decision, no bulk, no keyboard**
- *Evidence:* `list.tsx:134-279`; `approvals.myQueue` returns discrepancy rows (`approvals.ts:85-138`); desktop shot (4 cards, 2,054 px).
- *Problem:* an invoice with 3 flags needs 3 decisions. The month-end queue (about 150 items, FG-22) has no select-all, no "approve all info-severity", no J/K. Every decision is a mouse trip and a refetch.
- *Fix:*
  - Group `myQueue` rows by `invoiceId` into one card: "משקאות שטיינברג · ST-24108 · ₪104.80 בסיכון · 1 פער". One primary resolves all lines, and per-line overrides sit behind "פרט שורות".
  - Add checkboxes on non-block cards. Block items are never bulk-selectable (R-12): the checkbox is disabled with the reason "דורש בדיקה פרטנית".
  - A sticky bar "נבחרו 6 · ₪184.20 · [דרוש מהספק] [שלם כפי שחויב] [נקה]".
  - Keys `J/K`, `X`, `1/2/3`, `Z`, `Enter` (peek), `?` through a shared `useHotkeys` on `KeyboardEvent.code`, active only while the list has focus.
  - Either loop the existing mutations or add `approvals.decideInvoice`. If you add the procedure, add a COVERAGE entry in `cross-tenant.attack.test.ts`.
- *Exemplar:* R365 bulk approve/deny; Ramp Inbox; Linear Triage `1/2/3`.
- *Effort:* M.

**approvals-03 · P1 · flow · mobile [G10, A8, F4]: the first decision is ≈1,006 CSS px down; buttons are small and in the wrong corner**
- *Evidence:*
  - `crops/approvals/appr_phone_1.png` and `appr_phone_2.png`: "אשר" sits at device y≈2,013, which is ≈1,006 CSS px.
  - `page.tsx:44-85`: the toolbar renders 5 controls on 4 rows.
  - `list.tsx:245-274`: `size="sm"`, so `text-xs` and `py-1.5`, with 3 inline buttons in the bottom-end corner.
- *Problem:* on 390×844 the phone shows title, explanation, toolbar and tiles, and no decision.
  - The primary is 12 px text at the visual left (away from the right thumb).
  - It measured ≈31 px tall in the capture. The global `(pointer: coarse)` rule lifts it to 44 px on real devices, still below the 48 px full-width spec.
  - Escalate, reject and approve sit side by side, so a mis-tap is a money action.
- *Fix:* below 640 px:
  - Collapse the toolbar into one chip row: "סינון (0) · תצוגה" opens a bottom sheet.
  - Collapse the tiles into one line: "4 בתור · ₪296.00 בסיכון · 2 חוסמים".
  - Remove the subtitle.
  - Each card ends with **two 50/50 full-width 48 px buttons**: "דרוש ₪X" at the start (right) and "שלם כפי שחויב" at the end. Escalate and evidence go in "⋯".
  - Optional swipe with visible button twins, never in receiver flows.
  - Acceptance: the first card's buttons are visible at 390×844 without scrolling.
- *Exemplar:* BILL mobile (swipe right + Approve Selected); Brex mobile task inbox.
- *Effort:* M.

**approvals-04 · P1 · states · both [I2, C9, R-7]: no optimistic exit, no undo; every decision refetches page 1 and shows errors far from the row**
- *Evidence:* `list.tsx:64-79` (`refreshFirstPage`), `list.tsx:127-131` (error card at the top of the list). There is no reopen procedure in `approvals.ts`.
- *Problem:*
  - After "load more", one decision collapses the list back to 50 rows and jumps the scroll.
  - A failure shows at the top, not on the card.
  - A mis-tap on a money decision can't be undone; it needs a manual DB fix.
- *Fix:*
  - Optimistic removal with a 150 ms exit. Recount the summary locally. Move focus to the next card.
  - A **10 s undo toast** ("נדרש מהספק · ₪104.80 · בטל") calling a new `approvals.reopen` (status back to `open`, with an audit row; add a COVERAGE entry).
  - On failure, re-insert the card at its index with an inline error and "נסה שוב".
  - Never refetch page 1.
- *Exemplar:* Superhuman auto-advance + undo; Linear transactions with rollback.
- *Effort:* M.

**approvals-05 · P1 · trust · both [H6]: waiving forces free typing**
- *Evidence:* `list.tsx:202-243` (required textarea; confirm disabled until typed); `approvals.ts:194` (`reason: min(1)`). The textarea placeholder doubles as the label "סיבת דחייה (חובה)" [C5].
- *Fix:* the "שלם כפי שחויב" sheet offers 3–5 reason chips by type.
  - PRICE_HIGHER: "מחיר עודכן בהסכמה", "מבצע/הנחה לא נכללה בהזמנה", "זניח".
  - QTY_OVER: "הגיע בפועל, הקבלה שגויה".
  - Always: "הכלל שגוי / הסף לא נכון".
  - One tap commits. Free text only for "אחר". Store the chip code in the note so claims and the H6 learning loop can read it.
- *Exemplar:* Ramp "Policy is wrong"; erp-modern P13.
- *Effort:* S.

**approvals-06 · P1 · trust · both [H1, B3]: the ₪ on the card can't be verified from the card**
- *Evidence:*
  - Desktop shot card 1: expected ₪522.60, actual ₪575.00, loss ₪104.80. The 2-keg quantity is not shown anywhere.
  - Card 4: "צפוי 6.5 ⇆ בפועל 9.5" has no unit.
  - `vocab.ts:89-96`.
  - "PRICE_HIGHER" explain says "מהמחיר בהזמנה **או** מהמחיר ההיסטורי" without saying which one (`he.ts:55`).
  - `WhyFlagged` is hidden entirely in compact (`list.tsx:191`).
- *Fix:*
  - One why-line per card, in every density: **"₪575.00 × 2 חבית במקום ₪522.60 (הזמנה PO-…, 14.10) = ₪104.80 · ‎+10.0% · סף ±2% או ₪5 · אחריך: בעלים"**.
  - Add `qtyBilled`, `unit`, the expected source (PO / contract / p90) and its date to the `myQueue` select.
  - Compact mode clamps it to one line but never drops it.
- *Exemplar:* Stripe Radar risk insights; the consolidated panel's own `finding.price` sentence.
- *Effort:* M.

**approvals-07 · P1 · rtl · both [E4, B2]: money is forced LTR and set in mono**
- *Evidence:*
  - `list.tsx:316,321` (`dir="ltr"` + `font-mono` around `formatIls`), which renders **"522.60₪"** with the glyph glued on the right. This is visible in the desktop-he and phone-he shots.
  - Same pattern in `correction-client.tsx:262,340,350,357` (`<bdi dir="ltr">`), visible as "145.00₪" in `dashboard_invoices_ID__owner__desktop-he.png`.
  - `font-mono` on all ₪ figures: `list.tsx:178,291`, `pay-run/page.tsx:230,250`.
- *Fix:* replace these with the `<Money>` wrapper (a plain `<bdi className="tabular-nums">`, Heebo). Never put `dir="ltr"` around a he-IL ₪ string. Wrapping is allowed; `formatIls` itself does not change.
- *Effort:* S. Owner: `rtl-design-steward`.

**approvals-08 · P1 · states · both [B3, A9]: the summary tiles disagree with the rows and only count the loaded page**
- *Evidence:* `list.tsx:106-125`: `items.length` and Σ over loaded items only; "₪296" at 0 dp next to rows at 2 dp (desktop shot).
- *Problem:* with more than 50 items, "בתור 50" and "₪ בסיכון" are wrong, and they jump after "load more" or a decision.
- *Fix:*
  - Add a server `approvals.queueSummary`: count, Σ|Δ| in agorot, blockers and oldest age, under the same filters, independent of the cursor.
  - Show "₪296.00".
  - Keep the tiles in sync optimistically after each decision.
- *Effort:* S.

**approvals-09 · P1 · ia · desktop [D6, H2]: checking evidence costs two page loads and loses your place**
- *Evidence:* `list.tsx:193-200` (`<Link href=/dashboard/invoices/{id}>`); the target page does not highlight the flagged line or offer a decision; `correction-client.tsx:237-243` sends the scan to `/scans`.
- *Fix:*
  - "הצג ראיות" opens a **peek**: a 480 px side sheet on desktop, an 85 vh bottom sheet on mobile. It shows the scan crop, the PO line, the receipt line and the invoice line, and keeps the decision buttons inside it.
  - "פתח במסך מלא" goes to `/dashboard/invoices/{id}#line-{lineId}`, which already supports `:target` (`correction-client.tsx:325-326`).
  - Keep `?sel=` in the URL so Back restores the position.
- *Exemplar:* Linear Peek; Ramp approve-from-inbox.
- *Effort:* M.

**approvals-10 · P1 · trust · both [H7]: no decision history, and escalation carries no context**
- *Evidence:* `approvals.history` (`approvals.ts:276-290`) has no caller; `escalate` accepts a `note` the UI never sends (`list.tsx:250-254`).
- *Fix:*
  - Each card gets a "היסטוריה" disclosure with the latest 3 entries: who, role chip, verb, before → after, and `dd.MM HH:mm`.
  - "העבר לבעלים" opens a sheet with note chips ("מעל הסמכות שלי", "ספק חוזר על זה", "צריך לדבר עם הספק") shown to the owner on the card ("הועבר ע״י מנהל · 'ספק חוזר על זה'").
- *Exemplar:* Brex per-expense audit trail; BILL approver trail.
- *Effort:* S.

**approvals-11 · P1 · trust · both [I7]: decisions have no status precondition and no idempotency**
- *Evidence:* `approvals.ts:146-160` (approve), `199-213` (reject) and `246-259` (escalate) update by id only. The owner sees manager-routed items (`expandVisibleRoles`), so two people can act on the same open item.
- *Problem:* a stale card can flip a decision another person already made. It writes a second audit row and a second "חיסכון" activity, and the ₪ moves between "claim" and "pay" silently.
- *Fix:*
  - Add `AND resolution_status IN ('open','escalated')` to the updates and return `CONFLICT` with the earlier decider's name.
  - On CONFLICT the client removes the card and shows "כבר הוחלט ע״י <שם> לפני 3 דק׳" on the row.
  - Add a client UUID idempotency key.
- *Effort:* S. The router is not on the immutable list.

**approvals-12 · P1 · ia · both [D2, D3, D9]: no counts anywhere, and notifications deep-link to the generic queue**
- *Evidence:* `nav.tsx:155-157` (`NavBadge` is contracts-only); `matchInvoice.ts:241`; `endOfDayReport.ts:115`; `templates.ts:342`.
- *Fix:*
  - Badge "אישורים" with the open count (danger only if a block exists, "99+" cap) on the desktop nav and the bottom bar.
  - Notification links become `/dashboard/approvals?invoice=<id>&branch=<rid>`. The route switches branch if needed and opens that invoice's decision sheet.
  - Template copy: "₪104.80 · משקאות שטיינברג · ST-24108 — דרוש / שלם".
  - Link targets and templates are in scope. Channel and cadence (push/WhatsApp, reminders at +48 h/+72 h) are a human-PR proposal for `outbox.ts`/`cron.ts`.
- *Exemplar:* Ramp "Approval needed" DM with day-2/day-3 reminders; R365 Red App.
- *Effort:* M.

**approvals-13 · P1 · functional · desktop [D1, FG-37]: the multi-branch owner sees one branch's decisions**
- *Evidence:* lab DB: ירושלים has 16 open owner-visible items (₪538.35, 10 blockers worth ₪327.77) and חיפה has 9 (₪104.41), none shown from כפר הזיתים. `branch-switcher.tsx:73-85` hard-navigates to `/dashboard`.
- *Fix:*
  - For owners with 2 or more branches, the approvals queue and the pay run default to scope **"כל הסניפים"** with a branch chip per row and per-branch counts in the switcher ("ירושלים · 10 חוסמים").
  - Each mutation still runs inside its row's branch (`withRestaurant`); this needs `tenant-security-warden` review.
  - The switcher keeps the current path (`pick(id, pathname)`).
- *Exemplar:* R365 AP Center (multi-location My List); Ottimate per-location routing.
- *Effort:* L.

**approvals-14 · P1 · flow · both [C1, H8]: the queue is ordered by when the flag was created**
- *Evidence:* `approvals.ts:137` (`desc(createdAt)`); the card shows a `createdAt` timestamp (`list.tsx:183-188`), not age or a payment deadline.
- *Problem:* blockers and items whose invoice is about to be paid are not first.
- *Fix:*
  - Default sort: severity → invoice due date → ₪. Add a sort control.
  - The card shows "ממתין 4 ימים · לתשלום עד 28.10" (warn at 7 days or less, danger when the invoice is due).
- *Effort:* S.

**approvals-15 · P2 · states · both [C8, D1]: the bookkeeper's empty queue is a grey void, with a full toolbar above nothing**
- *Evidence:* `dashboard_approvals__bookkeeper__desktop-he.png`, `…phone-he.png` (empty state below the fold, under the bottom bar and consent); `page.tsx:58-92`.
- *Fix:*
  - T3 inbox-zero: "הכל מטופל ✓ · אין פריטים שמחכים לך".
  - Context line: "4 חשבוניות (₪10,148.93) מחכות להחלטת הבעלים/מנהל — הן מוחזקות בריצת התשלומים".
  - One CTA: "לריצת התשלומים · ₪5,901.02 מוכן לתשלום".
  - Hide the toolbar when the queue is empty and no filter is set.
- *Effort:* S.

**approvals-16 · P2 · visual · both [A8, B1, E6]: emphasis inflation and dark-era type**
- *Evidence:*
  - Desktop shot: 2 red tiles, a red ₪ on every card, a solid badge and a red rail. A non-block warn card still prints its ₪ in danger.
  - `SummaryTile` uses `uppercase tracking-wider` (`list.tsx:289`) and `font-mono` (`291`).
  - The leak-gradient rail is on the end edge (left in RTL), away from the reading start.
- *Fix:*
  - The summary line is ink; danger only on the blocker count.
  - The ₪ is danger only on block cards and ink on warn.
  - Move the severity rail to the start edge.
  - Remove tracking from Hebrew; money in Heebo tabular.
- *Effort:* S.

**approvals-17 · P2 · copy · both [H4, E9]: "ההפסד המוערך" labels a deterministic fact as an estimate**
- *Evidence:* `he.ts:22`; card "ההפסד המוערך ₪104.80".
- *Fix:* price × quantity minus the agreed price is a fact. Use "חויב ביותר" for price types, "חויב על חוסר" for quantity types and "סכום בסיכון" for duplicates. Reserve "הערכה" for real estimates.
- *Effort:* S.

**approvals-18 · P2 · rtl · both [E3, E8]: garbled timestamp bidi**
- *Evidence:* desktop-he shot "11:50 ,21.10.2026" (the comma lands on the wrong side) in `list.tsx:183-188` (mono `<time>` without isolation).
- *Fix:* show the relative age "לפני 4 ימים" with the absolute `21.10.2026 · 11:50` inside a `<bdi>` in the `title`. Never let a comma sit next to an LTR run unisolated.
- *Effort:* S.

**approvals-19 · P2 · states · both [I4, C8]: skeleton not layout-true; no error boundary; pay run inherits the wrong skeleton**
- *Evidence:*
  - `approvals/loading.tsx:13-21` draws 144 px cards against ≈310 px real ones. Pay run inherits it.
  - `pay-run/page.tsx:138-140` documents a soft-navigation stall under this boundary, which forces a full reload for the month toggle.
  - No `error.tsx` under `dashboard/`.
- *Fix:*
  - Give approvals, the pay run, the inbox and the invoice page their own `loading.tsx` that copies the final grid.
  - Fix the stall and restore soft navigation.
  - Add `dashboard/approvals/error.tsx` with a plain-Hebrew cause, "נסה שוב" and a way out.
- *Effort:* S.

**approvals-20 · P2 · a11y · both [F3]: weak focus rings on decision buttons**
- *Evidence:* `Button.tsx:26` (ghost: `focus-visible:ring-line`, 1.39:1), `Button.tsx:23` (secondary: `ring-primary/60`, ≈2.7:1). This affects העבר לבעלים, ביטול and דחה.
- *Fix:* one `--c-focus` token (R-5) on every variant.
- *Effort:* S. Owner: `rtl-design-steward`.

### 4.2 Pay run (`/dashboard/approvals/pay-run`)

**approvals-21 · P0 · functional · both [FG-26]: the pay run cannot be completed, because nothing marks an invoice as paid**
- *Evidence:* `payRun.ts:19,226` (`status <> 'paid'`); the only writer of `'paid'` is `apps/worker/scripts/seed-demo.ts:762`; `pay-run/page.tsx` renders no selection and no mutation; the note admits "סטטוס התשלום הוא מה שסומן במערכת" (`payRun/he.ts:69`), but there is no way to mark it.
- *Problem:*
  - The bookkeeper exports CSV, pays in the bank, and the same invoices return next week.
  - After two months, unpaid invoices drop out of the view entirely.
  - The ledger's `paid` total (`ledger.ts:162`) stays at zero in production.
- *Fix:*
  - Add `payRun.markPaid({invoiceIds, paidOn, method?, reference?})` (finance roles, an audit row per invoice, a COVERAGE entry) and `payRun.unmarkPaid` for undo.
  - UI: a row checkbox and a sticky bar "נבחרו 6 · ₪8,412.30 · [סמן כשולם…] [ייצוא] [נקה]". A date sheet defaults to today, and a 10 s undo toast follows.
  - Held and duplicate rows are not selectable for "paid".
  - Storing `paid_at`/reference as columns needs a new migration, which is human-only. The MVP can keep them in the audit row.
- *Exemplar:* Ramp Bill Pay "Mark as paid" and bulk actions; BILL "Pay / Mark as paid".
- *Effort:* M · *humanPR:* no for the MVP.

**approvals-22 · P0 · functional · both [H8, FG-26]: the pay run is scoped by invoice month, not due date, so the invoice due in 3 days is hidden**
- *Evidence:*
  - `payRun.ts:224-229` (invoice date within this or last month); `page.tsx:36` (`m=0|-1` only); `schema.ts:813` (`dueDate`).
  - Lab DB: 603/603 invoices have `due_date`; terms are "שוטף + 30/45/60".
  - MF-24950 (28.09, ₪7,363.20, due **28.10**) shows only under "חודש קודם". October invoices due 14.11–23.11 fill the default view.
- *Problem:*
  - Under שוטף+60, the invoices due now are two months old and **never appear**.
  - The default view mixes "pay now" with "not due for 4 weeks".
  - This works against the חוק מוסר תשלומים deadlines and against holding disputed money until its due date.
- *Fix:* rebuild the run around the due date.
  - Buckets "באיחור · השבוע · שבוע הבא · מאוחר יותר" over **all** unpaid, checked invoices.
  - A column "מועד תשלום" with a countdown ("נותרו 3 ימים · 28.10"; warn at 7 days or less, danger when late).
  - A pay-date picker ("ריצה ל-30.10") that selects everything due by then.
  - Keep "by invoice month" as a secondary filter for the close.
- *Exemplar:* Ramp Bill Pay (due date → Scheduled → Ready for payment); BILL "Due" sort; R365 AP payment run by due date.
- *Effort:* M.

**approvals-23 · P1 · flow · desktop [D7, C12]: held rows send the bookkeeper to an empty queue**
- *Evidence:* `pay-run/page.tsx:267-270` (`href="/dashboard/approvals"`, solid primary, no invoice scope); `approvals.ts:62-65`; the bookkeeper shots show an empty queue while the pay run shows 4 held invoices.
- *Fix:*
  - Each held row states who it waits for and how long: "ממתין להחלטת: בעלים · 4 ימים · ₪100.00".
  - The CTA depends on the viewer. If they can act (`canActOn`): "החלט" opens the decision sheet for **that invoice** (`/dashboard/approvals?invoice=<id>`, adding `invoiceIds` to the `myQueue` input). Otherwise: "שלח תזכורת לבעלים" (an in-app notification; channel cadence is a human-PR proposal).
  - Rows use secondary style; the page keeps one primary (pay selected).
- *Effort:* S.

**approvals-24 · P1 · functional · both [FG-26]: the whole invoice is held over a small dispute, with no short-pay and no netting**
- *Evidence:* desktop shot: HK-24108 ₪4,513.15 held for ₪100.00; the "להשהות" KPI is ₪10,148.93 against ₪296.00 actually disputed (`payRun.ts:138-147`).
- *Fix:*
  - Per held invoice, offer "שלם ₪4,413.15 עכשיו · החזק ₪100.00" (short-pay the undisputed part).
  - A per-supplier "נטו לתשלום = חשבוניות − זיכויים שאושרו" line, with the "ניתן לשלם" KPI including undisputed portions.
  - The CSV and the remittance list the deduction.
  - Partial-payment state needs a column or table → human-PR (schema).
- *Exemplar:* BILL partial payments; Ottimate VendorPay with credit netting.
- *Effort:* M · *humanPR:* yes.

**approvals-25 · P1 · layout · desktop [B4, C1, C3, B9]: a stack of supplier cards instead of a pay table**
- *Evidence:* `pay-run/page.tsx:197-285`; desktop shot, 2,742 px for 15 invoices. Status and actions sit about 900 px from the invoice number; there is no sort, no columns and no totals row.
- *Fix:* a grouped data table at 1280 px and up.
  - Columns: ☐ · ספק · חשבונית · תאריך · מועד תשלום · סכום כולל מע״מ · בהשהיה · נטו לתשלום · סטטוס · ⋯.
  - Supplier group rows carry subtotals; the header is sticky; ₪ columns are right-aligned on the decimal point (R-1); a totals row closes the table.
  - `ViewToolbar` filters (due window, supplier, status), `J/K/X`, and Space to peek the invoice.
  - At or above 15 rows per 900 px viewport.
- *Exemplar:* Ramp Bill Pay table; R365 AP payment run grid.
- *Effort:* M.

**approvals-26 · P1 · mobile · mobile [G10, A8]: the phone pay run is 4,181 CSS px with nothing to do**
- *Evidence:* `dashboard_approvals_pay-run__owner__phone-he.png`. Three stacked KPI cards take ≈600 px (decorative icon tiles and gradient wash); the first supplier sits on screen 3 (`crops/approvals/payrun_p1.png`, `payrun_p2.png`).
- *Fix:* the phone becomes the **owner's approval step**.
  - A summary card: "לתשלום השבוע ₪5,901.02 · 8 חשבוניות · 4 מוחזקות (₪296.00 במחלוקת)".
  - A primary "אשר ריצת תשלום" (the owner approves; the bookkeeper executes on the desktop), with a typed ₪ confirm above an owner cap.
  - A compact held list; the KPI strip collapses to one line.
- *Exemplar:* R365 Red App (payment runs approved on mobile).
- *Effort:* M.

**approvals-27 · P1 · functional · desktop [C4, H5]: consolidated invoices waiting for a link have no CTA and the cross-match is read-only**
- *Evidence:* `pay-run/page.tsx:267-276` renders no action for `pendingLink`; the `consolidated` router has only `proposal`/`coverage`; `consolidated-panel.tsx` offers print only. In the lab, 2 invoices (₪3,603.32) wait indefinitely.
- *Fix:*
  - In the panel: "אשר שיוך מוצע (3 תעודות · ₪3,603.32)" with per-note checkboxes (pre-checked only at high confidence) and a sticky running remainder "נבחר ₪X מתוך ₪Y · הפרש ₪Z" that turns ✓ at or below `TOTAL_TOLERANCE_ILS`, read from the engine.
  - Add `consolidated.acceptProposal` with a COVERAGE entry.
  - The pay-run row gets "שייך" → `invoice#xmatch`.
  - Coordinate with task #26.
- *Exemplar:* Xero Find & Match; QuickBooks bank feed; xtraCHEF (submit unlocks when the totals reconcile).
- *Effort:* M.

**approvals-28 · P2 · states · both [A4, B2]: "₪0.00" credit shown as a big gold result**
- *Evidence:* `pay-run/page.tsx:179-185`; shots ("₪ 0.00" in 32 px gold mono).
- *Fix:* when it is zero, a calm one-liner: "אין זיכויים לבקש — אף פער לא נדרש מהספק החודש". The KPI only appears when it is above zero. Money in Heebo tabular.
- *Effort:* S.

**approvals-29 · P2 · functional · desktop [FG-26]: CSV is the only output**
- *Evidence:* `pay-run/export-button.tsx`; `payRun/he.ts:57`.
- *Fix:*
  - Add a remittance advice per supplier (PDF/WhatsApp-ready: invoices paid, deductions with the claim reference).
  - Add a Masav / bank-CSV batch from the selection once supplier bank details exist. Bank details and a payments table are schema → human-PR. In-app payment waits for a licensed initiator.
- *Effort:* L · *humanPR:* yes.

**approvals-30 · P2 · visual · both [C12, A8]: four or more solid primaries on one page**
- *Evidence:* every held row has a solid warn badge and a solid primary "לתור האישורים" (desktop shot, 4×).
- *Fix:* one page primary (pay or approve selected); row actions secondary or in "⋯".
- *Effort:* S.

### 4.3 Invoice inbox (`/dashboard/inbox`)

**approvals-31 · P1 · ia · both [D2, A4, C8]: there is no invoice register; the "inbox" shows only WhatsApp/email and says "no invoices" while 49 unpaid invoices exist**
- *Evidence:* `dashboard/invoices/` has only `[invoiceId]`; `inbox/page.tsx:33-38` reads `ingest.inbox` only; `dashboard_inbox__owner__desktop-he.png` shows "עדיין לא התקבלו חשבוניות". In the lab DB, branch כפר הזיתים has 15 unpaid, checked invoices.
- *Problem:*
  - The bookkeeper can't list, filter or search invoices by state.
  - Invoices are reachable only from approvals, pay run, breakdown, ledger or search.
  - The showcase has the list the product lacks (`showcase/dashboard/invoices/page.tsx`: all / has_issues / clean / blocked).
- *Fix:* turn "תיבת חשבוניות" into **one register of all invoices from every channel** (door photo, upload, WhatsApp, email).
  - Tabs with counts: "לבדיקה (N) · ממתינות לשיוך · הותאמו · בהשהיה · שולמו".
  - A channel icon per row and a sortable table (ספק · מס׳ · תאריך · מועד תשלום · סכום · פערים ₪ · סטטוס).
  - Re-word the empty state per channel.
- *Exemplar:* MarginEdge invoices list; Ramp Bill Pay bills list.
- *Effort:* M.

**approvals-32 · P1 · trust · both [H2, C10]: unknown-sender documents are approved into OCR blind**
- *Evidence:* `inbox-client.tsx:286-370`. A `needs_review` row shows the filename, size, a `<select>` and 3 buttons, with no thumbnail or preview (the `stored` flag exists).
- *Fix:*
  - A 64×80 thumbnail; tap opens a preview sheet (signed URL, the same mechanism as `/scans`).
  - Approve or reject inside the preview.
  - Suggest the supplier from the sender, filename or OCR header, pre-selected with "הוצע לפי השולח".
- *Effort:* M.

**approvals-33 · P1 · trust · both [C10, C9]: revoking a receiving address is one ambiguous tap and reports success even on failure**
- *Evidence:*
  - `inbox-client.tsx:471-472`: `await revoke.mutateAsync(...).catch(() => null); toast.success(...)`.
  - The label is "ביטול" (`ingest/he.ts:66`), which reads as "Cancel".
  - Same false success on remove-sender (`565-566`).
- *Fix:*
  - Label "ביטול הכתובת".
  - A ConfirmDialog that names the effect: "ספקים ששולחים לכתובת המסתיימת ב-a91 יקבלו שגיאה מיעכשיו".
  - Real error handling: inline, not auto-dismissed.
- *Effort:* S.

**approvals-34 · P2 · trust · both [C9]: the one-time secret shows "הועתק" even when copying failed**
- *Evidence:* `inbox-client.tsx:499-500` (`navigator.clipboard?.writeText(...).catch(() => null)`, then `setCopied(true)`). The secret is "מוצגת פעם אחת בלבד" (`he.ts:68`).
- *Fix:* branch on the result. On failure, select the text and show "העתיקו ידנית (Ctrl+C)". Keep the secret visible until "שמרתי את הכתובת".
- *Effort:* S.

**approvals-35 · P2 · ia · both [C12, B9]: configuration outshouts the work**
- *Evidence:*
  - `inbox-client.tsx:382-387`: ChannelsCard and SendersCard sit under the queue, with 3 solid primaries (2 × "יצירת כתובת" and a full-width "הוספה").
  - On the phone they take about two thirds of the page (`crops/approvals/inbox_p.png`).
  - English jargon used as a placeholder-label: "Phone number ID (לא חובה)" (`he.ts:72`).
- *Fix:*
  - Move channels and the allow-list to `settings` → "קליטת חשבוניות".
  - The inbox header keeps one status line: "וואטסאפ: פעיל · מייל: לא הוגדר · הגדרות".
  - Use labels above the fields.
- *Effort:* M.

**approvals-36 · P2 · a11y · both [F5, F6, D5]: no h1, a fake tablist, a wrongly named select**
- *Evidence:*
  - `inbox/page.tsx:43` (SectionHeader without `level={1}`); crawl `h1: []`.
  - `inbox-client.tsx:144-151`: `role="tablist"`/`"tab"` on links with no tabpanel.
  - `599`: the channel-kind `<select>` is named "תיבת חשבוניות".
- *Fix:* add `level={1}`; use `nav` with `aria-current` for the filter links; give the select the label "ערוץ".
- *Effort:* S.

**approvals-37 · P2 · flow · both [C2, I2, C9]: per-document row overload, no bulk, and refresh-and-toast feedback**
- *Evidence:*
  - `inbox-client.tsx:296-370`: a select plus 3 buttons inline, and the supplier defaults to "ללא ספק".
  - `act()` (`129-137`) runs `router.refresh()` and auto-dismissing error toasts (7 s, `Toast.tsx:28`) with the raw server message.
- *Fix:*
  - One primary "פענח". "פענח והוסף שולח" and "דחה" go in "⋯".
  - Checkbox bulk "פענח N".
  - Optimistic row status, with errors inline on the row that never auto-dismiss.
- *Effort:* M.

**approvals-38 · P2 · flow · both [A5]: registered documents don't show their outcome**
- *Evidence:* `inbox-client.tsx:258-294`: a registered row says "בפענוח" plus "פתיחת החשבונית".
- *Fix:* after OCR, show the result inline: "תנובה · ₪2,340.00 · 2 פערים · ₪46.00 → החלט". The row becomes a triage entry point.
- *Effort:* M.

### 4.4 Invoice detail (`/dashboard/invoices/[invoiceId]`)

**approvals-39 · P0 · flow · both [H2, A5, C4]: the invoice page is an OCR correction form, not an invoice review**
- *Evidence:*
  - `invoices/[invoiceId]/page.tsx:65-101`: h1 "תיקון חשבונית" on every invoice.
  - `correction-client.tsx:224-390`: header inputs plus a line table, primary "הרץ התאמה מחדש".
  - `receiving.getInvoice` (`receiving.ts:463-545`) returns no discrepancies, PO or receipt.
  - Shot `dashboard_invoices_ID__owner__desktop-he.png`.
- *Problem:* coming from approvals ("פתח חשבונית"), the pay run or the inbox, the user sees:
  - no status (matched / held / paid);
  - no PO or delivery-note reference;
  - no ordered / received / billed comparison;
  - no flagged-line highlight;
  - no leak ₪ unless they press rerun;
  - no decision.
  The page where the evidence should live is a data-entry form.
- *Fix:* rebuild as an **invoice cockpit**.
  - Header: "חשבונית MF-24950 · דגי הים התיכון · ₪7,363.20 כולל מע״מ" with status chips (הותאמה · ממתינה לתשלום עד 28.10 · מע״מ בסיכון), plus PO and delivery-note links.
  - A three-way line table: פריט · הוזמן · התקבל · חויב · מחיר מוסכם (מקור) · מחיר בחשבונית · פער ₪. Flagged lines are expanded with the why-line and inline decision buttons.
  - A sticky decision bar: "החלט על 2 פערים · ₪104.80 [דרוש מהספק] [שלם כפי שחויב]".
  - OCR correction moves behind "ערוך נתוני סריקה" (an edit mode). Rerun goes to "⋯".
  - Port the showcase `InvoicePoCompareViewer` rather than designing from scratch.
- *Exemplar:* Ramp and BILL bill detail; Ottimate 3-way match; Odoo bill + preview.
- *Effort:* L.

**approvals-40 · P1 · flow · desktop [H2, D6]: the scan is a separate page outside the app**
- *Evidence:* `correction-client.tsx:237-243` (`<Link href=/scans/{id}><Button>…`); `scans/[invoiceId]/page.tsx:131-185` has no app shell, no back link, no zoom and no rotate.
- *Fix:*
  - At 1024 px and up, a **44/56 split** with the document at the start (right) edge in RTL.
  - The document pane is sticky and supports zoom 50–400%, rotate 90° and page thumbnails.
  - Hovering or focusing a line highlights its OCR region, or scrolls the image to its page.
  - Below 1024 px, a "מסמך | שורות" segmented control that keeps the scroll position.
  - `/scans` stays only as "open original in a new tab".
- *Effort:* L.

**approvals-41 · P1 · ia · both [D5, F5, J4]: no way up, and the title isn't the object**
- *Evidence:* no breadcrumb or back link (`page.tsx:66-71`); h1 "תיקון חשבונית"; `<title>` "RestoMatch" (crawl).
- *Fix:*
  - Breadcrumb from the origin (`?from=approvals|payrun|inbox|ledger`): "ריצת תשלומים › דגי הים התיכון › MF-24950".
  - h1 and title "MF-24950 · דגי הים התיכון".
  - Prev/next within the originating queue (`J/K`).
- *Effort:* S.

**approvals-42 · P1 · copy/rtl · both [C7, E8, C4]: money inputs are `type="number"`, the date shows MM/DD, and there is no live reconciliation**
- *Evidence:*
  - `correction-client.tsx:281-287, 338-355` (`type="number"`, "6240.00" with no grouping).
  - `278` (native `type="date"` renders **"09/28/2026"** in the Hebrew UI, visible in the desktop-he and phone-he shots).
  - The lines sum to ₪6,240.00 = before VAT, and VAT ₪1,123.20 = 18%, but nothing on screen says so.
- *Fix:*
  - Money fields become `type="text" inputMode="decimal"` with a ₪ adornment at the end side; accept "6,240.5" and "6240,5"; format on blur.
  - A Hebrew date field in `dd.MM.yyyy` format.
  - A live check line under the header: "סכום השורות ₪6,240.00 = לפני מע״מ ✓ · מע״מ 18% ✓ · סה״כ ✓", turning warn on mismatch, with the difference in ₪.
  - Also use `localIsoDate(…, 'Asia/Jerusalem')` instead of `toISOString().slice(0,10)` (`correction-client.tsx:29-33`), as `exports.ts:88` already does. This prevents an off-by-one for local-midnight dates.
- *Effort:* M.

**approvals-43 · P1 · mobile · mobile [C3, B9]: the line table clips the line total on the phone**
- *Evidence:* `crops/approvals/inv_p1.png`, `inv_p2.png`: the "סה״כ שורה" header and values ("75.00₪" of ₪2,175.00) are cut at the left edge inside `overflow-x-auto` (`correction-client.tsx:306-307`). The header form fills the first two screens.
- *Fix:*
  - Below 640 px, each line is a card: "טונה אדומה · 15 ק״ג × ₪145.00 = **₪2,175.00**", with a flag chip and the decision when flagged.
  - The header collapses to a summary row with "ערוך".
- *Effort:* M.

**approvals-44 · P2 · flow · both [H2, E9]: editing needs a separate technical step, and the result has no before/after**
- *Evidence:* `correction-client.tsx:112-119, 244-253, 392` (the hint "הריצו 'התאמה מחדש'"); the rerun banner shows only the new leak.
- *Fix:* re-match automatically after a save, then show "הדליפה בחשבונית: ₪104.80 → ₪52.40 · 1 פער נסגר". Rerun moves to "⋯".
- *Effort:* S.

**approvals-45 · P2 · flow · both [A5, H8, FG-28]: the VAT-at-risk banner has no action and a vague deadline**
- *Evidence:* `page.tsx:72-89`; shot: "בערך עד 28.3.2027…" with no button.
- *Fix:*
  - Countdown "נותרו 154 ימים · עד 28.03.2027".
  - CTA "בקש מספר הקצאה מהספק", a WhatsApp/email template. The template is in scope; channel and cadence are human-PR.
  - Block the invoice in the pay run until a corrected invoice arrives.
- *Effort:* M.

**approvals-46 · P2 · trust · both [H4, R-11]: per-line OCR confidence is fetched but never shown**
- *Evidence:* `receiving.ts:516` (`ocrConfidenceLine`) is unused in `correction-client.tsx`.
- *Fix:* below `ocrReviewThreshold` only, a dotted underline plus "נקרא מהסריקה — כדאי לבדוק" and a crop of the region. At most one marker per row.
- *Effort:* S.

**approvals-47 · P2 · trust · both [A5]: the duplicate-number notice is neutral and has no action**
- *Evidence:* `correction-client.tsx:200-208` (`border-line bg-surface-2`, no link, no action).
- *Fix:*
  - Warn styling: "ייתכן שזו חשבונית כפולה של MF-24950 (₪7,363.20)", with a link to the original and its paid status.
  - Two actions: "סמן ככפולה — אל תשלם" and "זו חשבונית אחרת".
- *Effort:* S.

**approvals-48 · P2 · perf · both [I1, I4]: request waterfall, a 4 s English block, no loading boundary**
- *Evidence:* `page.tsx:28-33` (`Promise.race` with 4,000 ms for `ensureEnglish`) and `35-63` (4 sequential awaits); there is no `loading.tsx` for the invoice page or the inbox.
- *Fix:*
  - `Promise.all` the independent calls and stream the sections with `<Suspense>`.
  - Render Hebrew names immediately and swap in English when ready.
  - Add layout-true `loading.tsx` files.
- *Effort:* M.

**approvals-49 · P2 · rtl · both [E4, C3, A4, R-1]: consolidated panel details**
- *Evidence:*
  - `consolidated-panel.tsx:108`: `signed()` concatenates "+"/"−" to `formatIls`.
  - `251,310-313`: "—" fillers.
  - `281`: the products table is `min-w-[36rem]` with no phone cards (the notes table has them, `204-223`).
  - Numbers are `text-end`, which is left in RTL, against R-1.
  - Print is the only action.
- *Fix:*
  - Signs come from Intl `signDisplay`. This is an option change to the immutable `formatIls()`, so it goes to `money-format-marshal` as a human PR.
  - Blank cells instead of "—".
  - Phone cards for the products table.
  - Add "צור דרישת זיכוי" → a claims draft prefilled with the findings.
- *Effort:* M · *humanPR:* yes (for `signDisplay`).

**approvals-50 · P3 · a11y · both [C13, E2, E6]: nested interactive elements and a mis-mirrored icon**
- *Evidence:*
  - `correction-client.tsx:238-242` nests `<Link><Button>` (invalid HTML, a double tab stop; the Button doc itself says to use `LinkButton`).
  - `251`: `Play` with `ltr:-scale-x-100` points **backwards** in English ("◁ Re-run match", en shot).
  - `309`: thead `uppercase tracking-wide` on Hebrew.
- *Fix:* `LinkButton`; an unmirrored `RefreshCw` icon; remove the tracking.
- *Effort:* S.

### 4.5 Scans (`/scans/[invoiceId]`, code only)

**approvals-51 · P2 · ia/a11y · both [D5, F5, F9, B8, B1, D7]: an orphan page outside the shell**
- *Evidence:* `scans/[invoiceId]/page.tsx`:
  - no back link, nav, h1 or skip link;
  - hex `STAGE_BG` (`97-98`);
  - `text-[10px]` (`147`);
  - a perpetual `animate-ping` dot (`139`) with no reduced-motion guard;
  - no zoom/rotate for images;
  - a PDF `<iframe>` (iOS Safari shows only page 1 [K]);
  - not in `ROUTE_ROLES`, so a chef can open a scan whose invoice page they can't.
- *Fix:*
  - Fold the viewer into the invoice split pane (approvals-40).
  - Keep `/scans` as a minimal "original document" view with "← חזרה לחשבונית", an h1, tokens and a 12 px type floor.
  - Align roles with `/dashboard/invoices`, with a `tenant-security-warden` review.
- *Effort:* M.

### 4.6 Cross-cutting in this area

**approvals-52 · P1 · ia · desktop [D2, D7]: the bookkeeper's main job has no nav entry**
- *Evidence:* `nav.tsx:80-105` has no pay-run item. It is reachable only through `approvals/page.tsx:48-55` (a small secondary button, and only when `payRun.enabled`).
- *Fix:*
  - Add "תשלומים" to the money group for owner, manager and bookkeeper, with a badge "₪ לתשלום השבוע".
  - Bookkeeper landing: "שולחן החשב" (pay run due this week, missing allocation numbers, links pending).
- *Effort:* S.

**approvals-53 · P3 · rtl · desktop [B4, R-1]: money columns not aligned on place value in English**
- *Evidence:* `correction-client.tsx:310-314, 336-358` (`text-start` everywhere). In the en shot, unit price and line total are left-aligned.
- *Fix:* a shared `.num` / `<NumCell>` (`ltr:text-end rtl:text-start`, which is physically right in both locales).
- *Effort:* S.

---

## 5. Big moves (benchmark-grade)

### BM-1 · "שולחן ההחלטות": an invoice-level decision inbox, three panes at 1280 px and up (desktop)
- *Why:* today an owner of 3 branches clears 29 one-at-a-time discrepancy cards across 3 branch switches. Ramp, R365 and Linear prove that throughput comes from the layout plus the keyboard.
- *What:*
  - Start pane: a 360 px list of invoices, not discrepancies. Rows are 56 px: supplier, invoice, Σ ₪ at risk, age/due, severity chip and a branch chip (chain scope by default for multi-branch owners).
  - Centre pane: the document with the flagged lines highlighted.
  - End pane: a 380 px decision panel with the why-line (`₪575.00 × 2 במקום ₪522.60 = ₪104.80`), an optional suggest-only recommendation chip ("מומלץ: לדרוש — הספק חרג 3 פעמים ב-30 יום"), history, and the money verbs "דרוש מהספק" and "שלם כפי שחויב" with reason chips.
  - Keys `J/K`, `1/2/3`, `X`, `Z`, `?`. Bulk on non-block rows with a sticky ₪ bar. Optimistic exit with a 10 s undo.
  - `?sel=` lives in the URL.
- *Exemplar:* Ramp Inbox and Policy Agent (labels, suggest-only); R365 AP Center "My List"; Linear Triage.
- *Effort:* L.

### BM-2 · Two-tap mobile decisions, from the notification to done (mobile)
- *Why:* the owner direction says most work happens on the phone. Today the first decision sits ≈1,006 px down, the verbs are ambiguous and waiving requires typing.
- *What:*
  - A new `/dashboard/approvals/[invoiceId]` (or a `?invoice=` sheet) as the landing for push and WhatsApp.
  - A thumb card: ₪ difference at 24 px or more, supplier · item, the why-line, and a 2-line evidence crop that opens a bottom sheet with the scan.
  - Sticky 50/50 48 px buttons: "דרוש ₪X" (start) and "שלם כפי שחויב" with one-tap reason chips.
  - Optional swipe with button twins. The next card slides up; a 10 s undo follows.
  - The queue view collapses its filters into one chip row and its summary into one line, so the first decision is above the fold.
  - One-tap approve straight from WhatsApp only under an owner cap (default ₪500). Channel and cadence are a human-PR proposal for `outbox.ts`/`cron.ts`.
- *Exemplar:* BILL mobile swipe/Approve Selected; Brex mobile task inbox; R365 Red App; Tipalti approve-by-email.
- *Effort:* M.

### BM-3 · A real pay run: by due date, net of claims, mark paid, owner approves on the phone (both)
- *Why:* the pay run can't be completed, hides the invoice due in 3 days, and holds ₪10,148.93 over ₪296.00 of disputes.
- *What:*
  - Due-date buckets (באיחור / השבוע / שבוע הבא / מאוחר יותר) over all unpaid, checked invoices, with countdown chips.
  - Short-pay ("שלם ₪4,413.15 · החזק ₪100.00") and a supplier net line.
  - A grouped table with checkboxes and a sticky "נבחרו 6 · ₪8,412.30 [סמן כשולם] [ייצוא מס״ב] [נקה]" bar.
  - States: טיוטה → אושרה ע״י בעלים (mobile, typed ₪ confirm above a cap) → בוצעה (bookkeeper marks paid with a date) → per-supplier remittance advice listing the deductions.
  - Held rows name who they wait for and offer "החלט" or "שלח תזכורת".
- *Exemplar:* Ramp Bill Pay states (Ready for payment → Scheduled → Paid, release from the Inbox); R365 payment runs approved on mobile; Ottimate VendorPay netting.
- *Effort:* L · *humanPR:* schema for paid_at, partial payments and bank details.

### BM-4 · The invoice cockpit: document ⇄ three-way lines ⇄ decision (desktop split, phone toggle)
- *Why:* the page every link lands on is an OCR form with no evidence, and the scan is an orphan page.
- *What:*
  - A 44/56 split with the document at the start edge: zoom, rotate, thumbnails, and line ↔ region highlight.
  - A three-way table (הוזמן · התקבל · חויב · מחיר מוסכם (מקור, תאריך) · מחיר בחשבונית · פער ₪) with collapsed matched lines and expanded exceptions.
  - A live header reconciliation ("שורות = לפני מע״מ ✓ · מע״מ 18% ✓").
  - A sticky decision bar "החלט על N פערים · ₪X".
  - A timeline (נקלטה → OCR → הותאמה → הוחלט → שולמה).
  - "ערוך נתוני סריקה" is an explicit mode that auto re-matches and shows the ₪ before → after.
  - Reuse the showcase `InvoicePoCompareViewer` / `InvoiceScanViewer`.
- *Exemplar:* Ramp / BILL bill detail (image beside fields); Odoo bill + preview; Ottimate 3-way.
- *Effort:* L.

### BM-5 · One invoice register for every channel, replacing the WhatsApp/email-only inbox (desktop first)
- *Why:* the bookkeeper has no list of invoices. The inbox says "no invoices" while 15 unpaid invoices sit in this branch, and channel secrets crowd the work.
- *What:* `/dashboard/invoices` becomes the register.
  - State tabs with counts (לבדיקה · ממתינות לשיוך · הותאמו · בהשהיה · שולמו), channel icons (דלת / העלאה / וואטסאפ / מייל), and a sortable table with ₪ and due dates.
  - Thumbnail preview, bulk "פענח N" and supplier suggestions for unknown senders.
  - Each row's outcome inline ("2 פערים · ₪46.00 → החלט").
  - Channel and allow-list setup moves to settings.
- *Exemplar:* MarginEdge invoice list; Ramp bills list; the product's own showcase invoices page.
- *Effort:* M.

### BM-6 · Overrides that teach (both, suggest-only)
- *Why:* a manager who waives the same Tnuva milk increase 5 times is telling the system the contract price is stale. Today that signal is a free-text note nobody reads.
- *What:*
  - Reason chips store codes. After 5 consistent "שלם כפי שחויב" decisions on (supplier, product, type) within 30 days, show a T4 suggestion: "אישרת 5 עליות מחיר של תנובה בחלב. לעדכן את המחיר המוסכם ל-₪6.40?" with [עדכן] [לא עכשיו] [אל תציע שוב]. It edits contract data only.
  - The "הכלל שגוי" chip files a proposal to the owner with a before/after impact ("בחודש שעבר: 6 → 1 שורות"). Engine tolerances stay human-PR.
- *Exemplar:* Ramp "Policy is wrong" and memo learning; Linear Triage Intelligence.
- *Effort:* M · *humanPR:* yes, only if tolerance defaults change.

---

## 6. Rubric scorecard (the criteria that apply to this area)

| Criterion | Approvals | Pay run | Inbox | Invoice | Note |
|---|---|---|---|---|---|
| A1 one T1, one action | Partial | Fail | Partial | Fail | Pay run: 3 equal KPIs plus N primaries. Invoice: primary = rerun |
| A4 zero/unknown honest | Partial | Fail (₪0.00 gold) | Fail (misleading empty) | n/a | |
| A5 T2 = badge + ₪ + money verb | **Fail** (inverted verbs) | Partial | Partial | Fail (VAT and duplicate have no CTA) | |
| B2 money not mono | Fail | Fail | n/a | Fail | |
| B3 precision contract | Fail (0 dp tile) | Pass | n/a | Partial | |
| B4 place-value alignment | n/a | Fail (cards) | n/a | Partial (en) | |
| C1 sort | Fail | Fail | Fail | n/a | |
| C2 row actions and batch | Fail | Fail | Fail | n/a | |
| C3 phone cards | Pass (cards) | Partial | Pass | Fail (clipped) | |
| C7 money inputs | n/a | n/a | n/a | Fail (`type=number`) | |
| C8 states | Partial | Partial | Fail (no h1, loading or error) | Fail (no loading) | |
| C9 message type | Fail (top error card) | n/a | Fail (auto-dismissed errors, false success) | Partial | |
| C10 confirm / undo | Fail (no undo) | n/a | Fail (revoke) | n/a | |
| D5 way up | Pass | Pass (back link) | Pass | Fail | |
| D6 glance / peek / page | Fail | Fail | Fail | Fail | |
| E4 ₪ in RTL | Fail | Pass | n/a | Fail | |
| E8 dates | Partial (bidi) | Pass | Pass | Fail (MM/DD) | |
| E9 money verbs | **Fail** | Partial | Partial | Fail | |
| F5 h1 / structure | Pass | Pass | Fail | Partial | |
| G10 phone desk | Fail | Fail | Partial | Fail | |
| H1 flag explains itself | Partial (no qty math; hidden in compact) | Partial | n/a | Fail (no flags) | |
| H2 evidence beside the data | Fail | n/a | Fail (no preview) | Fail | |
| H6 disagreeing is cheap | Fail | n/a | n/a | n/a | |
| H7 history | Fail | Fail | Partial | Fail | |
| H8 deadlines | Fail | Fail | n/a | Partial | |
| I2 optimistic + undo | Fail | n/a | Fail | n/a | |
| I6 keyboard grammar | Fail | Fail | Fail | Fail | |
| I7 no double post | Partial (no precondition or idempotency) | n/a | Partial | Partial | |

Pilot bar (0 S0 anywhere, 0 S1 on primary flows): **not met.** The P0s are approvals-01, -21, -22 and -39.

---

## 7. Governance notes (AGENTS.md)

- **No immutable file is needed for the core fixes.** Verbs, grouping, bulk, optimistic UI, peeks, the pay-run table, due-date scoping, mark-paid (status only), the register, the invoice cockpit and the inbox fixes all live in `apps/web` and non-immutable routers (`approvals.ts`, `payRun.ts`, `ingest.ts`, `consolidated.ts`, `receiving.ts`).
- **New procedures need a COVERAGE entry** in `cross-tenant.attack.test.ts`; adding one is allowed, weakening one is not. The new procedures are `approvals.reopen`, `approvals.queueSummary`, `approvals.decideInvoice`, `payRun.markPaid`, `payRun.unmarkPaid` and `consolidated.acceptProposal`. Chain-scoped queues need a `tenant-security-warden` review.
- **Human PR:**
  - `paid_at`/payment reference columns, partial payments and supplier bank details: schema plus a **new** migration.
  - `signDisplay` in `formatIls()` (`money-format-marshal`).
  - Push/WhatsApp cadence, reminders and escalation (`notifications/outbox.ts`, `apps/worker/src/cron.ts`).
  - Any change to what `approvals/engine.ts` routes or auto-approves (approvals-05 and BM-6 only *propose*).
  - `TOTAL_TOLERANCE_ILS` is read for the consolidated remainder, never redefined.
- **Owners:**
  - `web-feature-engineer`: pages and routers.
  - `rtl-design-steward`: `<Money>`, focus token, tones.
  - `money-format-marshal`: `formatIls`.
  - `ocr-procurement-engineer`: confidence, inbox OCR outcome and worker deep links.
  - `matching-engine-guardian`: three-way line data for the cockpit.
  - `test-sentinel`: the optimistic-approve, undo and pay-run e2e.

---

## 8. Evidence index

| Shot / crop | What it proves |
|---|---|
| `shots/dashboard_approvals__owner__desktop-he.png` | 4 cards in 2,054 px; "₪296" (0 dp) tile vs 2 dp rows; "522.60₪" glyph on the wrong side; bidi "11:50 ,21.10.2026"; sm buttons about 1,000 px from the text |
| `crops/approvals/appr_phone_1.png`, `appr_phone_2.png` | First decision at ≈1,006 CSS px; 5-control toolbar; 12 px "אשר" at the bottom-end corner |
| `shots/dashboard_approvals__bookkeeper__desktop-he.png`, `…phone-he.png` | Empty queue for the bookkeeper (the dead end for held pay-run rows); toolbar over an empty state |
| `crops/approvals/payrun_d1.png`, `payrun_en.png` | KPI ₪10,148.93 held vs ₪296.00 disputed; "₪0.00" gold; solid "לתור האישורים" per row; no due date or selection |
| `crops/approvals/payrun_p1.png`, `payrun_p2.png` | Phone pay run: 3 stacked KPIs, first supplier on screen 3, nothing actionable |
| `shots/dashboard_inbox__owner__desktop-he.png`, `crops/approvals/inbox_p.png` | "עדיין לא התקבלו חשבוניות" while invoices exist; configuration dominates; English placeholder |
| `shots/dashboard_invoices_ID__owner__desktop-he.png`, `crops/approvals/inv_en.png` | h1 "תיקון חשבונית"; MM/DD date; `type=number` totals; primary = rerun; back-pointing play icon in English; no flags or three-way data |
| `crops/approvals/inv_p1.png`, `inv_p2.png` | Phone line totals clipped at the left edge |
| Lab DB (read-only) | Hidden branches' queues (25 items, ≈₪643); 603/603 due dates; MF-24950 due 28.10 outside the default pay run |
