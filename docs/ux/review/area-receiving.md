# Area review: receiving at the back door (`receiving`)

**Reviewer:** UX review team, area `receiving` · **Date:** 2026-10-25 (DEMO_TODAY) · **Tree:** `main` @ 8fef118c (worktree `scratchpad/ux/wt`)

**Routes:**
- `/dashboard/receiving`: the receiving list (inbox).
- `/dashboard/receiving/[poId]`: the 5-step wizard and the dock slip.
- `/dashboard/receiving/share`: the PWA share target, which redirects to orders/capture.
- The client step components it reuses: `app/showcase/receiver/_steps/*`.

**Archetype:** Field (rubric §0.3). This is a primary flow, so the severity escalator applies.

**Rubric groups applied:**
- In full: G (all 10), B, C, E, F and I.
- Where the pattern appears: A (A4, A5, A9), D (D1, D5), H (H1, H3, H4) and J (J1, J3).

**Benchmarks:**
- Choco Delivery Check and Request for Supplier.
- Galley receiving (Receive outstanding / modified / no longer expected, plus ad-hoc receiving).
- Supy Receive Order and GRN Disputed.
- Square Receive All and Shopify POS Receive all.
- Cut+Dry Request a credit.
- Toast xtraCHEF and MarginEdge invoice capture.
- HotSchedules/Adaco and Odoo catch-weight.
- WMS blind and partial-blind receiving (Odoo Barcode, ShipEdge).
- Restaurant365 offline counts, WISK unsynced count and Toast offline mode.
- US Foods MOXē Delivery Tracker and the DoorDash "Needs Action" tab.

## Scores (0–10, against world-class)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **3.5** | The flow is clean and calm, but it is not a field instrument. The receiver is gated on the invoice before counting. The capture CTA sits at y=931 CSS px against a fold of 844, and the bottom nav top is 791. At 375×667 the CTA is at y=912 against a nav top of 614. The camera opens through a chooser, a "demo invoice" button sits on every real delivery, and the bottom nav stays in the task flow. On review the first line card is at y=869 and "המשך" at y=1,831 (2.2 screens down). Weights are entered with a ±1 stepper. |
| Desktop | **2.0** | The owner, manager and bookkeeper get the phone wizard centred in a 720 px column, and a two-column card grid of today's pending POs. There is no table, no date navigation, no history, no closed-receipt detail (who counted what, photos, slip sent), no branch roll-up, no drag-and-drop or split-pane invoice review, and no live refresh. |
| Functionality | **3.0** | The core leak at the door is uncatchable. A line billed in full and equal to the PO but delivered short is marked "תואם" and **cannot be edited** (0 inputs in the expanded matched list, probe). Other gaps: counts live only in React memory until the final submit; there is no receive without a PO; capture is single-page; offline only queues photos and then bounces the receiver back to the scan step; there is no per-line photo or reason and no driver name. Evidence URLs expire after 30 min, line order is random (UUID), and closed receipts keep a "קלוט סחורה" CTA. |

**Pilot bar:** fails, with 4 P0s (RCV-01 to RCV-04).

**World-class bar:** far off. Choco, Galley and Supy open on the order lines, default every line to the expected quantity and touch only exceptions. A clean delivery closes in 3 taps with no OCR wait.

### Capture and probe notes
- **Lab caveats (not product bugs):**
  - The red "מנוע העיבוד לא זמין" banner (86 CSS px, measured) and the cookie bar show on every capture.
  - In the full-page phone shots, the fixed bottom nav and the consent bar appear mid-page.
  - Lab captures stop at step 2 of the wizard (h1 "צלם את החשבונית"), because every later step needs an upload and a mutation.
- **My probe** (`review/scripts/receiving-probe.cjs`):
  - **Read-only on tenant data.** It logs in as `receiver@kfar-hazeitim.test`, clicks "רק חיוניות" on the consent bar, and measures the list and scan steps at 390×844 and 375×667.
  - **Later steps.** Review, adjust and the expanded matched list were driven through `/showcase/receiver`. That route uses the **same step components** (Reconciliation, AdjustQuantities and Confirmed) with client-side mock data and no server writes. Screenshots are in `review/crops/receiving/`.
- **Key measurements:**
  - The receiver's post-login landing is `/dashboard`, the owner's "חדר הבקרה".
  - List at 390×844: cards are 135 px tall. Three fit above the fold with the lab banner; at 375×667 the third is cut by the nav (nav top 614).
  - Scan step at 390×844:
    - Capture button y=931–979, demo button y=991–1,041, nav top 791.
    - The 4:5 viewfinder is 438 px tall (y=477–915).
    - Without the 86 px lab banner, the capture button would still sit at about y=845. That is still under the nav.
    - `input[type=file]`: `accept="image/*,application/pdf"`, `capture=null`, `multiple=false`.
  - Review (6-line mock): document height 1,959 px. The KPI grid starts at y=456, the first line card is at y=869 and "המשך להתאמת כמויות" is at y=1,831. It is not sticky.
  - Adjust:
    - Steppers measure 48×48 and chips 44 px tall.
    - The quantity input is `type="number"` with `step=0.1` and has no `aria-labelledby`.
    - "סדר עוד 4 שורות" is disabled, and the button is 179 px wide (not full width).
    - Expanded matched list: 2 rows, **0 inputs or buttons**.
- **Crawl metrics:**
  - All 10 captures return 200, with overflowX 0 and axe 0.
  - loadMs is 1.3–1.8 s.
  - Each capture reports 2–3 targets under 24 px. These are shared chrome; the wizard's own controls are ≥44 px. The one in-area offender that wasn't captured is the dock-slip "רענן" button at about 26 px.

---

## 1. What the area really does (code walk)

| Piece | File | What it does | States in code |
|---|---|---|---|
| Receiving list | `apps/web/app/dashboard/receiving/page.tsx:29–114` | Calls `receiving.todayExpectations`, which returns POs in `sent/confirmed/partial` for today's window, plus undated POs from the last 14 days (`packages/api/src/routers/receiving.ts:80–169`, status filter at `:119`). Each card is a whole-card link: supplier, time (mono `text-xs`), line count, an optional receipt badge, and "פתח קבלה חדשה/המשך קבלה קיימת" plus "קלוט סחורה ←". | Empty: `EmptyState` with no CTA (`:46–51`). Loading: `loading.tsx`, a 4-card skeleton. No `error.tsx`. |
| PO page | `receiving/[poId]/page.tsx:17–115` | Runs server awaits **in sequence**: `ensureEnglish` (≤4 s, en), then `receiverLangs.localNames` (≤4 s, ar/ru/th/ti), then `priceContext`, then `getPo`. Then a back link and the wizard. | Not found becomes `notFound()`. It inherits the **list** skeleton. |
| Wizard | `receiving/[poId]/wizard.tsx` | Steps: `SCAN_INVOICE → PROCESSING → RECONCILIATION_REVIEW → ADJUST_QUANTITIES → CONFIRMED` (`:70–83`). OCR is polled (escape offered after 30 s, `:40`; background poll for 10 min). PO-only fallback when OCR fails. `submit()` loops `markGrLine` for every line **sequentially at the end**, then `submitReceipt` (`:485–522`). | A single top error banner (`:543–548`). The OCR notice banner is calm (T4). Duplicate-invoice notice (calm). |
| Capture | `showcase/receiver/_steps/InvoiceScan.tsx` | A static 4:5 "viewfinder" (not a camera) with GSAP corner pulse, plus a file input (`:223–232`, no `capture`, `files?.[0]`). Shrinks the image in the browser (`scanPrep.ts`), uploads, and the receiver then taps "עבד את החשבונית". A **"השתמש בחשבונית-דמה (ללא העלאה)"** button is always shown (`:262–268`). | Upload status overlay with `pct: 30` hard-coded (`:105`), so it shows a spinner only. |
| Review | `_steps/Reconciliation.tsx` | 4 KPI tiles. A "הפסד פוטנציאלי" headline (client estimate). Supplier-contact-change alert. Mismatch and pending banners. Lines in sections (both / invoice-only / order-only): cards on phone, a table on desktop. Gold "הכל תקין — אישור מהיר" when there are no diffs (pending lines are not counted), plus primary "המשך להתאמת כמויות". | The dock-slip button (flag) appears here only. |
| Adjust | `_steps/AdjustQuantities.tsx` | **Only non-matched lines** (`_state.ts:190–193`). Matched lines appear as a read-only collapsed list (`:106–127`). Each card has a ±1 stepper (`:224–254`), a `type="number"` input (`:234–243`), and chips "= הזמנה / = חשבונית / חסר / פגום" (`:257–287`). A sticky footer is lifted above the bottom nav; close is disabled until every exception is touched. | No per-line error; an error shows in the top banner. |
| Confirmed | `_steps/Confirmed.tsx` | A 96 px bouncing check, invoice number, verified counts, "חיסכון פוטנציאלי שתועד" (gold, client estimate), the scan link (a 30-min signed URL), and "חזרה לרשימת המשלוחים" via `window.location.href`. The DockSlip renders underneath when the flag is on (`wizard.tsx:670–681`). | none |
| Dock slip | `receiving/[poId]/dock-slip.tsx`, `_dockSlip.ts` | Lines flagged from the receiver's marks, plus engine discrepancies. ₪ comes **only from the engine** after close and re-match (good). Copy text, or open WhatsApp with the text pre-filled. | Notes: afterClose / held / computing / slow, with refresh. |
| Offline | `lib/pwa/ReceiverPwa.tsx`, `offlineQueue.ts`, `receiver-sw.js` | Behind flag `receiverPwa`: the manifest, a service worker that caches public assets only, the offline page, and an IndexedDB queue **for invoice photos only**. Sign-out or `/login` wipes the queue (`PwaSessionGuard.tsx:19`, `PwaQueueReset.tsx:13–17`). | Offline banner (warn), sync banner and install prompt. |
| Server | `packages/api/src/routers/receiving.ts` | Procedures: `startReceipt` (idempotent, M7), `markGrLine` (`:771–817`), `submitReceipt` (`:819–883`, sets GR status, **never advances the PO status**, stores `signatureUrl`), `registerInvoice` (idempotent, M8). `getPo`, `getReceipt` and `getInvoice` all `orderBy(asc(id))` (`:209, :285, :522`), and the ids are `uuid defaultRandom()`. | none |

**Roles:**
- `ROUTE_ROLES['/dashboard/receiving'] = owner, manager, receiver` (`apps/web/lib/roles.ts:45`). The chef cannot receive.
- Mutations use `receiverProcedure`.

**Strengths worth keeping:**
- **Idempotency is careful:**
  - `clientUploadId` and an object-URL advisory lock in `registerInvoice`.
  - `capturingRef`/`submittingRef` double-tap guards.
  - The M7 unique receipt per PO.
- **Degradation is graceful:** OCR failure, quota or timeout falls back to receiving against the order, and a background poll offers "הצג תוצאות" later. `keepAdjusted` never overwrites the receiver's own edits when the review is rebuilt.
- **The dock slip's ₪ is engine-only.** No client estimate reaches the supplier, and the WhatsApp text is not sent automatically.
- **Calm T4 notices:** duplicate invoice, pending review and OCR slow.
- **Receiver languages** (ar/ru/th/ti, plus English with a Hebrew-original toggle) are a real differentiator against Choco and Galley.
- Status chips carry icon + word + colour (C11 pass).
- Unit-aware bidi in `Qty` (`english.tsx:129–146`).

---

## 2. Primary tasks, walked end to end (phone, receiver, Hebrew)

| # | Task | Today: taps, waits and dead ends | World-class target (exemplar) |
|---|---|---|---|
| A | **Clean delivery** (everything arrived; invoice = PO) | 1. Land on `/dashboard` (owner control room), then bottom nav "קליטת סחורה" (1). 2. Open the PO card (2). 3. **Scroll** (the capture CTA is under the nav). 4. "צלם / העלה קובץ" (3). 5. OS chooser "צלם תמונה" (4). 6. Shutter (5). 7. "השתמש בתמונה" (6). 8. Upload with an indeterminate spinner. 9. "עבד את החשבונית" (7). 10. **OCR wait** (5–15 s typical; the escape only appears at 30 s). 11. **Scroll** past 4 KPI tiles and every line. 12. "הכל תקין — אישור מהיר" (8). 13. "חזרה לרשימת המשלוחים" (9), a full reload. **Total: 9 taps, 2 scrolls and an OCR wait. Nothing was counted.** | **3 taps, 0 s wait.** Card → "✓ הכל הגיע כמו בהזמנה" → "סיים קבלה". The invoice photo is a parallel 2-tap action that never blocks (Choco Delivery Check, Galley "Receive outstanding", Square "Receive All"). |
| B | **Billed in full, delivered short** (invoice = PO = 10 kg tomatoes; 8 kg arrived). This is the classic leak. | **Impossible.** The line is "תואם", Adjust hides it, and the expanded matched list has 0 inputs (probe). Quick confirm writes `qtyReceived = invoiceQty = 10`. The receipt closes "completed", the engine sees no shortage, and **₪ is lost.** | ✗ on the line → "חסר חלקית" → stepper 8 → 📷 → שמור (**≤5 taps**). It lands on the dock slip and the claim (Choco issue types, Cut+Dry "Request a credit"). |
| C | **3 exceptions out of 11 lines** (1 price, 2 qty) | Flow A up to review (7 taps + OCR) → scroll → "המשך להתאמת כמויות" (8) → for each of the 3 exception cards, a chip or stepper (3–6). The **price line also has to be "touched"**, although the receiver can't fix a price at the door. → "סגור קבלה ושמור" (≈12–15) → confirmed → scroll to the slip → wait for the engine ₪ → "שלח לספק בוואטסאפ". **≈16–19 taps.** | ≈7–9 taps: exceptions first, sorted by ₪. Price diffs are routed to the manager and never block the door. One "מה מבקשים? זיכוי / החלפה" question. |
| D | **Weighed line** (ordered 12 kg, scale reads 11.640 kg) | The stepper moves by ±1, so 11.64 is unreachable. The receiver focuses a `type=number` field, clears it and types; the value is rounded to 2 dp (`AdjustQuantities.tsx:191`). There is no tolerance prompt. | Tap the value → numeric keypad sheet showing "הוזמן 12.000 ק״ג" → type `11640` → "שונה ב-3% — לאשר?" (HotSchedules/Adaco, Odoo catch-weight). |
| E | **Offline at the door** (walk-in, basement) | Opening the PO offline returns the static `offline.html` (pages aren't cached). If the PO is already open: capture → photo queued → the wizard **goes back to the scan step** with a red `role=alert` "התמונה נשמרה בטלפון" (`wizard.tsx:266–273`). **The receiver cannot count.** | The full receipt completes in airplane mode and syncs exactly once, with "⟳ 3 ממתינים לסנכרון" visible (R365 offline counts, WISK, Supy). |
| F | **Supplier arrives without a PO** | **Dead end.** The list has no path for it (`page.tsx`). The receiver has to call a manager, who creates a PO on desktop. | "ספק הגיע בלי הזמנה" → pick supplier → count from that supplier's guide → retro PO draft (Galley ad-hoc receiving, Odoo). |
| G | **2-page invoice** | Only `files[0]`, so page 2's lines never reach the matcher. PO lines on page 2 become pending or "missing". | "+ עמוד" loop with a thumbnail strip → one invoice of N pages (xtraCHEF Add Page, MarginEdge). |
| H | **Interrupted** (phone call, screen lock, app switch, tab killed) mid-adjust | Every mark is lost: only React state is kept until the final submit. Reopening starts at "צלם את החשבונית" again, and re-shooting creates a second invoice object and OCR charge. There is no leave guard. | Each line is saved on change ("נשמר במכשיר" → "נשלח"). Reopen resumes at "המשך מ-07:42 · 5/12" (R365, Android offline-first). |
| I | **Owner/manager at the desk:** "what arrived today, what was short, who received it, was the slip sent?" | The list shows pending cards only, and closed receipts look identical (a badge plus the same "קלוט סחורה" CTA). There is no receipt detail and no history; the orders list shows only a status badge. **Dead end for audit.** | A deliveries table with date navigation and a split-pane receipt detail (image | lines | photos | signature | audit). This is the US Foods MOXē / Galley receiving-by-date pattern. |

---

## 3. Findings

Severity follows the task's P-scale, mapped from the rubric:
- **P0:** blocks or misleads a core task, or loses ₪ or trust.
- **P1:** major friction, or below par against the benchmark.
- **P2:** polish.
- **P3:** nit.

`humanPR` = the full fix touches an immutable file or the schema.

### P0

**RCV-01 · A short delivery on a line where the invoice equals the PO cannot be recorded; "אישור מהיר" closes unchecked lines** · mobile+desktop · functional · G4, G5, H3 · M · humanPR no
- **Observed:**
  - `deriveStatus` labels a line `matched` when the PO and invoice quantity and price agree (`receiving/[poId]/_adapters.ts:85–104`). Its mark is pre-touched with `qtyReceived = invoiceQty` (`:263–279`).
  - ADJUST renders only `nonMatchedLines` (`showcase/receiver/_state.ts:190–193`). The matched lines are a read-only list (`AdjustQuantities.tsx:106–127`); the probe found 0 inputs.
  - On review, "הכל תקין — אישור מהיר" calls `submit()` directly (`Reconciliation.tsx:311–320`), so the receiver never sees a quantity control.
  - The showcase mock even sells this exact case: "פלפל אדום" 8 kg billed / 7.5 arrived is shown as "כמות שונה", with identical 8/8 numbers on screen (`_mock.ts:177–186`; `crops/receiving/showcase_recon_phone390.png`). The real adapter can never produce it.
- **Why it matters:** "billed and ordered 10, delivered 8" is the most common leak at the back door. Today the GR records 10, the engine sees no QTY_SHORT, and the ₪ never reaches the hero.
- **Fix:**
  - Make the receiver's count the source of `qtyReceived` for **every** line (big move BM-1).
  - Interim, in this flow:
    - Render matched lines in ADJUST as collapsed one-line rows ("מלפפון חממה · 15 ק״ג ✓ · ערוך"). "ערוך" expands the same AdjustCard.
    - Rename the review status "תואם" to **"החשבונית = ההזמנה"**, so it isn't read as "arrived".
    - Change quick confirm to **"הכל הגיע כמו בהזמנה (12)"**, placed on the count screen, not on the invoice comparison.
- **Exemplar:** Choco Delivery Check (✓/✗ on every order line), Galley "Receive outstanding / Receive modified", Square Receive All + per-row qty.

**RCV-02 · Field work lives only in memory until the last tap; no resume and no leave guard** · mobile · functional/states · G7, I2 · M · humanPR no
- **Observed:**
  - `marks` is React state (`wizard.tsx:123`). `markGrLine` runs only inside `submit()`, sequentially, N round trips (`:494–507`).
  - Reload, an iOS tab eviction, a phone call or the bottom nav loses every count. There is no `beforeunload` or in-app guard (grep: none). The back link (`[poId]/page.tsx:97–103`) and `history.back()` (`wizard.tsx:557`) leave silently.
  - Reopening always starts at `SCAN_INVOICE` (`:104`). It ignores the existing receipt and the invoice already uploaded, and a re-shoot uploads a second copy (a second OCR charge).
  - If one `markGrLine` fails halfway, the receipt is half-persisted and the error shows at the top of the page while the user is at the footer.
- **Fix:**
  - Persist each line on change, debounced 300 ms, through an outbox keyed by `grLineId` with an idempotency key. Show "נשמר במכשיר" → "נשלח" per line.
  - On mount, call `getReceipt({ poId })` and the latest invoice for the GR. Resume at the right step: "המשך מ-07:42 · 5/12 שורות".
  - Add a leave guard while unsynced marks exist.
  - Hold a Screen Wake Lock in the wizard.
- **Exemplar:** Restaurant365 offline counts, Android offline-first "lazy writes", the Supy silent-failure warning.

**RCV-03 · Invoice capture is single-page and opens a chooser, not the rear camera** · mobile · functional · G6 · M · humanPR no
- **Observed:**
  - The file input is `accept="image/*,application/pdf"` with no `capture` and no `multiple`, and the handler reads `e.target.files?.[0]` (`InvoiceScan.tsx:223–232`; probe `capture=null, multiple=false`).
  - On iOS this is an extra action sheet. A 2–4-page delivery invoice or `חשבונית ריכוז` only sends page 1, so page-2 lines never reach the matcher (missed leak, plus false "missing" lines).
  - The viewfinder is a decorative box with a pulsing GSAP corner, not a camera (`:85–91, :195–213`).
  - There is no blur or darkness gate.
- **Fix:**
  - Primary "📷 צלם חשבונית" uses `capture="environment"`; a secondary text link "העלה קובץ / PDF".
  - A multi-page loop: "+ עמוד" / "סיימתי · שלח 3 עמודים", a 64×80 thumbnail strip with retake/delete, up to 10 pages under one `clientUploadId` group and one invoice.
  - A quality check under 1 s with a named reason ("כהה מדי — התקרב לאור").
  - A full `getUserMedia` scanner is BM-3.
- **Exemplar:** Toast xtraCHEF (Add Page), MarginEdge (one photo per page plus per-photo status), BeerBoard SmartBar green frame.

**RCV-04 · No way to receive a delivery that has no PO** · mobile · functional/flow · G4, D1 · M · humanPR no (a retro PO can use `po_source='manual'` plus a note)
- **Observed:**
  - `todayExpectations` lists only open POs (`receiving.ts:80–169`). The list page has no other entry point (`receiving/page.tsx:44–111`), and the empty state has no CTA (`:46–51`).
  - The public showcase *does* offer "הספק לא ברשימה?" (`showcase_receiver__public__phone-he.png`). The demo promises a path that the product lacks.
  - PO-less spend is invisible to the three-way match until an invoice arrives through the inbox. FG-11 estimates ₪675–1,125/month of undetectable leak at ₪150k spend.
- **Fix:**
  - A persistent secondary action on the list (and an FAB on phone): **"ספק הגיע בלי הזמנה"**.
  - Then: supplier picker (recent first) → count from that supplier's last-90-days guide (or photo first, OCR proposes lines) → create a GR plus a retro PO (`source='manual'`, notes "קבלה ללא הזמנה") → the same exception flow.
- **Exemplar:** Galley ad-hoc receiving, Odoo Barcode "create receipt on the spot", Choco.

### P1

**RCV-05 · The wizard is invoice-first: the driver waits for OCR before anything can be counted** · mobile · flow · G4, I3 · M · humanPR no
- **Observed:**
  - `STEP_ORDER` starts at `SCAN_INVOICE` (`wizard.tsx:77–83`).
  - The "המשך לקלוט מול ההזמנה" escape appears only after `STILL_READING_AFTER_MS = 30_000` (`:40, :565`).
  - The review anchors the receiver on the invoice's numbers (task #27 history).
- **Fix:**
  - Open on the PO lines, pre-filled.
  - Put "📷 צלם חשבונית" in the sticky header and let it run in parallel.
  - Have OCR reconcile in the background into a T2 banner after the count: "החשבונית נקראה — 2 הבדלי מחיר · ₪46".
  - Drop the escape to 10 s for anyone still using photo-first.
- **Exemplar:** Choco Delivery Check, Supy Receive Order, Galley.

**RCV-06 · Primary actions are outside the thumb zone, and the global bottom nav stays inside the task flow** · mobile · visual/flow · G1, G2 · S · humanPR no
- **Observed:**
  - **Scan:** the capture CTA is at y=931 at 390×844 (nav top 791) and y=912 at 375×667 (nav top 614) (probe; `dashboard_receiving_ID__receiver__phone-he.png`). The cause is the 438 px 4:5 viewfinder, the `text-3xl` step header and a 2-line subtitle.
  - **Review:** "המשך להתאמת כמויות" is at y=1,831 and is not sticky (`Reconciliation.tsx:302–331`; `crops/receiving/showcase_recon_phone390.png`).
  - **Adjust:** the footer is lifted above the 72 px nav (`wizard.tsx:644`), and the close button is not full width (179 px).
  - The bottom nav (`nav.tsx:421`, translucent `glass`) is never hidden on `/dashboard/receiving/[poId]`.
- **Fix:**
  - Add a field-mode layout: hide `MobileNav` on `/dashboard/receiving/[poId]` and `/inventory/count`, and add "× יציאה" at the top start.
  - One full-width 56 px sticky primary bar above `env(safe-area-inset-bottom)` on every step, with the secondary as a text button above it.
  - Shrink the scan viewfinder to `max-h-[40vh]` (or make the whole viewfinder the capture target).
- **Exemplar:** Shopify POS and DoorDash full-screen task flows; Hoober thumb-zone data.

**RCV-07 · Exceptions have no reason, photo or driver acknowledgement; "חסר" is recorded as rejected** · mobile · functional/trust · G8, H6 · M · humanPR no
- **Observed:**
  - Only 4 chips exist, and none takes a photo or note (`AdjustQuantities.tsx:257–287`). `gr_lines.reject_reason`, `condition_notes` and `photos` already exist, so this is UI only.
  - "חסר" sets `condition:'rejected', qtyRejected: poQty` (`:272–279`). The slip then prints both "חסר: הוזמן…" **and** "נפסל / פגום" for goods that never arrived (`_dockSlip.ts:57–58`). That is a wrong statement on a document handed to the supplier.
  - The invoice photo is attached as the "photo" of every line, and as `signatureUrl` (`wizard.tsx:505, :510`).
  - There is no driver name or signature.
  - There is no "what do we ask the supplier: credit / replacement" step.
  - The slip's send isn't recorded.
- **Fix:**
  - ✗ on a line opens a bottom sheet:
    - Reason chips (single-select): חסר לגמרי / חסר חלקית / פגום / טמפרטורה לא תקינה / תחליף לא מאושר / מחיר בתעודה שונה.
    - A qty stepper for partial.
    - "📷 צלם" with `capture=environment`, at 48 px.
    - A note, then "שמור".
  - "חסר" writes `qtyReceived` only (no rejection).
  - At finish, ask one question, "מה מבקשים מהספק?", then show the driver name plus an optional finger signature.
  - Store the photo per line, and log the slip shares (a timestamp on the GR).
- **Exemplar:** Choco issue types plus Request for Supplier; Cut+Dry Request a credit; Supy Disputed GRN.

**RCV-08 · Receipt evidence is stored as 30-minute signed URLs** · both · functional/trust · H2, H7 · S · humanPR no
- **Observed:**
  - `authedUpload` returns `publicUrl: r.signedUrl` (`wizard.tsx:238`), which has a 30-min TTL (`packages/api/src/routers/scans.ts:9, :130–140`).
  - `submit()` writes that URL into `gr_lines.photos` and `goods_receipts.signature_url` (`wizard.tsx:505, :510`).
  - After 30 minutes, or immediately when OCR was slow, every evidence link in the receipt is dead.
  - Confirmed's "צפה בסריקה" opens the same expiring URL in a new tab (`Confirmed.tsx:119–127`).
- **Fix:**
  - Persist the storage path or the auth-gated `/scans/<id>` route (`scanRouteUrl`), never the signed URL.
  - Stop writing the invoice photo as a "signature".
  - Link "צפה בסריקה" to `/dashboard/invoices/<id>`.
- **Exemplar:** Ramp and Stripe receipts (permanent, permissioned attachment links).

**RCV-09 · Offline covers invoice photos only, and a queued photo blocks the receiver** · mobile · functional · G7 · L · humanPR no
- **Observed:**
  - The service worker never caches the PO page (`receiver-sw.js/route.ts`), so opening a PO offline shows `offline.html`.
  - `markGrLine` and `submitReceipt` are online-only.
  - When a photo is queued, the wizard returns to `SCAN_INVOICE` with a **danger** `role=alert` box (`wizard.tsx:266–273, :543–548`). Offline must be T4 neutral, and the receiver cannot continue to count.
  - Sign-out, or landing on `/login`, wipes queued photos silently (`PwaSessionGuard.tsx:19`, `PwaQueueReset.tsx:13–17`): lost invoices on a shared phone.
- **Fix:**
  - Build an IndexedDB outbox of typed mutations (startReceipt, markGrLine, submitReceipt, photo, slipShared) with idempotency keys.
  - Precache today's POs (`todayExpectations` plus `getPo`) at shift start, and render the wizard from IDB.
  - A neutral queued state lets the receiver continue counting.
  - Sign-out with a non-empty queue asks: "3 תמונות עוד לא עלו — להעלות לפני יציאה?".
  - (BM-2.)
- **Exemplar:** R365 offline counts, WISK unsynced counter, Toast offline banner.

**RCV-10 · Weight entry uses a ±1 stepper on kg and a `type="number"` field rounded to 2 dp** · mobile · functional · G5, C7 · S · humanPR no (a per-product tolerance would be: `tolerances.ts`)
- **Observed:**
  - `incrementQty(±1)` applies to every unit (`AdjustQuantities.tsx:195–197`).
  - The field is `<input type="number" inputMode="decimal" step=0.1>` (`:234–243`; probe). It accepts scroll-wheel changes, rejects a decimal comma, and has no select-on-focus and no `enterKeyHint`.
  - `setQty` rounds with `toFixed(2)` (`:191`), but `qty_received` is `numeric(12,3)`.
  - The stepper box is `dir="ltr"` with the input before the unit, so "ק״ג" renders to the **right** of the number and reads "ק״ג 20" in Hebrew (`crops/receiving/showcase_adjust_matched_phone390.png`).
- **Fix:**
  - Make the control follow the unit:
    - Counted units (יח׳/ארגז/קרטון): a 56 px stepper with long-press repeat.
    - ק״ג/ליטר: tapping the value opens a keypad sheet with 3 decimals, "הוזמן 12.000 ק״ג", and a confirm above a 10% deviation.
  - Use `type="text" inputMode="decimal"`, select-all on focus, `enterKeyHint="next"` and 3 dp.
  - Render the unit inside a `<bdi>` after the number.
  - Per-product weight tolerance goes through a human PR.
- **Exemplar:** HotSchedules/Adaco 3-decimal entry, Odoo catch-weight, the `inventory/count/count-screen.tsx` input.

**RCV-11 · Two different ₪ figures with three names on the confirmation screen** · mobile · trust · A9, H3, A6 · S · humanPR no
- **Observed:**
  - Review shows "הפסד פוטנציאלי מההפרשים" (`Reconciliation.tsx:161–175`). Confirmed shows the same client figure in **gold** as "חיסכון פוטנציאלי שתועד" (`Confirmed.tsx:92–99`). Right under it, the dock slip shows the engine's "סה״כ לדרישת זיכוי" (`dock-slip.tsx:241–246`).
  - The client figure is a heuristic (`_adapters.ts:85–104, :332–341`):
    - It counts |Δqty| in **both** directions, so billing less than ordered still reads as a "loss".
    - It counts the **full value** of every unordered line.
    - It mixes in signed price deltas.
  - The two numbers will routinely differ on one screen.
- **Fix:**
  - Remove the client ₪ from Confirmed. Show "₪ ייקבע אחרי בדיקת המנוע" until the slip's engine total arrives, then show only that, labelled the same way everywhere ("לדרישת זיכוי").
  - On review, replace the ₪ estimate with counts ("3 שורות שונות מההזמנה"), or label it "הערכה".
  - Never use gold or "חיסכון" for an unverified figure.
- **Exemplar:** Stripe Disputes (one amount, one name); Ramp (estimates labelled).

**RCV-12 · Line order is random, not the order on the paper** · both · functional/flow · G4 · S (interim) / M · humanPR **yes** (a `line_no` column on `po_lines` and `invoice_lines` is a schema change)
- **Observed:**
  - `getPo`, `getReceipt` and `getInvoice` all `orderBy(asc(id))` (`receiving.ts:209, :285, :522`), and `po_lines.id` is `uuid().defaultRandom()`. Neither table has a position column.
  - The receiver runs a finger down the paper while the screen shuffles.
- **Fix:**
  - Human PR: add `line_no` to `po_lines` and `invoice_lines`, written by the order wizard and OCR, and order by it.
  - Interim (agent-safe): sort by `supplierSku`, then Hebrew collation of the name. Sort exception cards by |Δ₪| descending.
- **Exemplar:** Galley (expected items in PO order), the "mirrors the paper" rule (restaurant.md P7).

**RCV-13 · List cards have no state machine: closed receipts still say "קלוט סחורה", with no late, arrived or next-truck states** · mobile+desktop · flow/ia · G4, A7, C11 · M · humanPR no
- **Observed:**
  - `submitReceipt` never advances the PO status (`receiving.ts:819–883`). A closed receipt stays listed, with the badge "הקבלה נסגרה" plus "המשך קבלה קיימת · קלוט סחורה ←" (`page.tsx:94–104`), and reopening restarts at scan.
  - "קבלה בתהליך" uses the **warning** tone (`:22`), which is a false alarm (A7).
  - The list is today-only. Yesterday's undelivered PO vanishes (dated POs) and nothing is marked "באיחור".
  - There is no time-window grouping, no next-truck emphasis, no ₪ ordered and no PO reference.
  - Each card says the same thing twice: muted "פתח קבלה חדשה" and link "קלוט סחורה" (`dashboard_receiving__receiver__phone-he.png`).
- **Fix:**
  - One state-labelled CTA per card: "התחל קבלה" → "המשך קבלה (3/12)" → "ממתין לקריאת חשבונית" (T4) → "התקבל ✓ · 2 חריגות · ₪184" (T3/T2).
  - Groups: **דורש טיפול**, **באיחור** (warn, window end + 30 min), **עכשיו / הבא** (an enlarged next-truck card), **בהמשך היום**, **התקבלו היום** (collapsed), **ללא תאריך**.
  - A summary line: "היום: 5 משלוחים · 2 התקבלו · 1 באיחור".
  - `supplier.deliverySchedule` already exists for the windows.
- **Exemplar:** DoorDash merchant one-state button plus "Needs Action", US Foods MOXē Delivery Tracker, Sysco today's deliveries.

**RCV-14 · The review step repeats every line, leads with zero-value KPI tiles, and offers two competing primaries** · mobile+desktop · flow/visual · A4, C12, G4 · M · humanPR no
- **Observed:**
  - 4 KPI tiles (114 px each, two rows on phone) come before any line, and the first line card is at y=869 (probe).
  - In PO-only mode, all four tiles read **0** while every line is pending: zero standing in for "not yet known" (A4).
  - Every line, matched or not, renders as a full 157 px card. The same exceptions then render again on ADJUST, which makes it a redundant screen.
  - In PO-only mode the pending banner says "בדקו אותן מול החשבונית" when there is no invoice. At the same time `allGood` ignores pending lines (`Reconciliation.tsx:57–62`), so the gold **"הכל תקין — אישור מהיר"** appears and closes the receipt as ordered, untouched.
  - Gold and primary sit side by side (`:302–331`).
- **Fix:**
  - Merge review and adjust into one exception-first count screen (BM-1).
  - Until then:
    - Replace the tiles with one sentence ("12 שורות · 3 שונות מההזמנה · 1 לא הוזמן").
    - Collapse matched lines.
    - Hide quick confirm when `pendingCount > 0`.
    - Fix the PO-only banner copy ("אין חשבונית — סמנו מה הגיע").
    - Keep one primary.
- **Exemplar:** QuickBooks bank feed (For review / Matched counts in tabs), Linear triage.

**RCV-15 · On the PO-only fallback, every line must be tapped one by one** · mobile · flow · G4, G5 · S · humanPR no
- **Observed:**
  - Without invoice lines, every line is `pending_review` with `touched:false` (`_adapters.ts:229–233, :278`). "סגור קבלה" stays disabled ("סדר עוד 11 שורות", `AdjustQuantities.tsx:161–168`) until each card gets a chip tap, which is 11+ taps and scrolls.
  - The only alternative is the blind gold quick confirm on review (RCV-14).
- **Fix:**
  - Add a sticky full-width "✓ סמן את השאר כמו בהזמנה (8)" that marks every untouched line as ordered, with a 10 s Undo.
  - Close becomes enabled once each line is resolved.
  - The footer counts "9 מתוך 12 אושרו".
- **Exemplar:** Square Receive All, Choco "mark all received", Saledock defaulting received to ordered.

**RCV-16 · A "demo invoice" button sits on every real delivery** · mobile+desktop · trust/functional · J3, H4 · S · humanPR no
- **Observed:**
  - "השתמש בחשבונית-דמה (ללא העלאה)" is rendered unconditionally at equal visual weight under the capture CTA (`InvoiceScan.tsx:262–268`; he.ts `steps.scan.useDemo`; every scan screenshot).
  - In the authenticated wizard it shows a fake SVG "invoice" with "מצב הדגמה — לא נשמר בשרת" and then silently continues as PO-only (`wizard.tsx:266–277`). The receipt closes with no invoice evidence.
- **Fix:**
  - Render it only when `uploadFile` is undefined (the showcase).
  - In the dashboard, replace it with an honest text action: "אין חשבונית עכשיו — קלוט מול ההזמנה". This is exactly what it does today, labelled truthfully.

**RCV-17 · No document type at capture: suppliers who bill a monthly consolidated invoice hand over a delivery note, not an invoice** · mobile · flow/ia · G6, A7 · M · humanPR **yes** (a persisted per-supplier billing mode or document type needs a column; `suppliers` has no settings jsonb)
- **Observed:**
  - The step is always "צלם את החשבונית" (he.ts `steps.scan.title`), and every photo is registered as an `invoice` with `source:'photo'` (`receiving.ts:885–1004`).
  - The ledger and the consolidated cross-match treat these receipts as **תעודות משלוח** awaiting a `חשבונית מרכזת` (`packages/api/src/match/consolidated.ts:31–40`; suppliers he.ts `noteRow`).
  - The receiver is told to shoot an invoice that doesn't exist, which is why they reach for the demo button.
- **Fix:**
  - A 3-way chip on capture: חשבונית מס / תעודת משלוח / חשבונית זיכוי, defaulted from the supplier's billing mode.
  - A delivery note is still OCR'd for quantities but never counted as spend.
  - The schema part goes through a human PR.
- **Exemplar:** Toast xtraCHEF document-type selector (Invoice / Receipt / credit note).

**RCV-18 · The receiver lands on the owner's control room, and receiving is the second tab** · mobile · ia · D1, D3 · S · humanPR no
- **Observed:**
  - After login the receiver lands on `/dashboard`, with the ₪760 leak hero, "ממתינות לאישור 4" and the activity feed (probe; `dashboard__receiver__phone-he.png`).
  - The bottom bar is "the first four visible items" (`nav.tsx:269–278`), so the receiver's first tab is "סקירה".
- **Fix:**
  - Redirect `receiver` to `/dashboard/receiving` (or a receiver "Today" home).
  - Set the receiver bar to [קבלה, חשבוניות, ספקים, עוד].
  - In the installed PWA, `start_url` = today's next truck.
- **Exemplar:** Apicbase mobile home tiles (Count / Waste / Receive), Sysco today's deliveries on login.

**RCV-19 · Desktop: no receiving control tower** · desktop · ia/functional · B6, D6, C1, H7 · L · humanPR no
- **Observed:**
  - The list is a `md:grid-cols-2` card grid (`page.tsx:53`). At 1440 px it uses about 40% of the canvas, with zig-zag time order in RTL (`dashboard_receiving__owner__desktop-he.png`, `…__desktop-en.png`).
  - Missing:
    - A table.
    - A date picker or history.
    - Filters (supplier, status, receiver).
    - A branch roll-up for chains.
    - Live refresh (server-rendered once; another receiver's progress never appears).
  - Most important: a closed receipt can't be **viewed** at all. There is no page showing counted vs ordered vs billed per line, who received it, when, photos, signature, the slip and the engine discrepancies. The owner can't audit the door.
- **Fix:**
  - Build `/dashboard/receiving` on `lg+` as a dense table:
    - Columns: window, supplier, PO#, lines, ₪ ordered, status chip, receiver, exceptions ₪, invoice status, slip sent.
    - Date navigation ("אתמול / היום / מחר").
    - Saved filters in the URL.
    - A branch column for chain owners.
  - Opening a row gives a split pane: invoice image | lines (ordered / billed / received / Δ₪) | evidence and audit.
  - Poll every 30 s while visible.
  - (BM-5.)
- **Exemplar:** Galley receiving by date, Linear split view, Ramp bill detail with attachments.

**RCV-20 · The desktop wizard is the phone wizard centred** · desktop · visual/flow · B6, B9 · M · humanPR no
- **Observed:**
  - `max-w-3xl` (`wizard.tsx:527`), with a 4:5 "viewfinder" 560 px tall and a file-picker-only flow (`dashboard_receiving_ID__owner__desktop-he.png`).
  - A manager holding a PDF invoice from email can't drag and drop, can't see the image beside the lines, and can't use the keyboard.
  - The review table has no "received" column and an `uppercase tracking-wider` Hebrew header (`Reconciliation.tsx:274`).
- **Fix:**
  - On `lg+`, render a drop zone ("גרור PDF/תמונה או הדבק") with Ctrl+V paste.
  - Review in a split pane: the image with zoom on the start side, editable lines on the end side, with columns ordered / billed / received / Δ₪.
  - Keyboard: `J/K` between lines, digits to type the received quantity, `Enter` next exception.
- **Exemplar:** Ramp and Bill.com invoice review (document beside the coded lines), xtraCHEF web invoice view.

**RCV-21 · The dock slip appears at the wrong moments and isn't driver-facing** · mobile · flow/trust · G8, C10 · M · humanPR no
- **Observed:**
  - The slip button appears only on REVIEW, before the receiver has counted (`wizard.tsx:610–633`); it is absent from ADJUST. After close it renders under Confirmed (`:670–681`), but its ₪ waits for close plus the engine run.
  - The button is danger-outlined.
  - The slip uses `text-xs` metadata and a `text-[11px]` footer (`dock-slip.tsx:167, :270`).
  - There is no full-screen, high-contrast "show to driver" mode and no driver acknowledgement.
  - "שלח לספק בוואטסאפ" is a deep link with no record that it was shared.
- **Fix:**
  - After "סיים קבלה" with exceptions, open a full-screen slip:
    - 18 px+ body text and ink-only text.
    - Per-line photos.
    - Driver name plus an optional signature.
    - Quantities immediately; the ₪ fills in when the engine lands.
    - Primary "שלח לספק ב-WhatsApp", which logs `slip_shared_at`.
  - The claim is auto-drafted in `leaks/claims` (T3 "₪184 נכנסו לדרישה").
  - (BM-4.)
- **Exemplar:** Cut+Dry Request a credit, Choco Request for Supplier.

**RCV-22 · Upload and OCR progress is indeterminate, and the processing screen fakes stages** · mobile · states/trust · G6, I3, H4 · S · humanPR no
- **Observed:**
  - The upload is set to `pct: 30` once and never updated (`InvoiceScan.tsx:105`). The overlay is a spinner with "מעלה את הסריקה..." (`:292–298`).
  - The upload is base64 inside tRPC (+33%) on a 3G back door.
  - `ProcessingPoll` cycles the active stage every 1.4 s forever, whatever the real state (`wizard.tsx:757–761`). It ticks "הסתיים" on stages that haven't run.
  - Eyebrow: "עיבוד", then "צעד 2 מתוך 5" on scan. Step numbering skips step 1.
- **Fix:**
  - Track real XHR or fetch upload progress (`role="progressbar"` with %).
  - Show named stages driven by invoice status (uploaded → reading lines → comparing).
  - Never tick a stage that hasn't happened.
  - Show seconds elapsed, with the "continue with the order" escape at 10 s.
- **Exemplar:** MarginEdge per-photo status, Linear and Vercel deploy logs (truthful stage lists).

**RCV-23 · ₪ is rendered inside `<bdi dir="ltr">` with concatenated "+" signs, including on the client-facing dock slip** · mobile+desktop · rtl · E4, B2 · S · humanPR **yes** (Intl `signDisplay` lives in the immutable `formatIls`)
- **Observed:**
  - 12 sites wrap he-IL ₪ in `dir="ltr"`: `dock-slip.tsx:161, :203, :244`; `Reconciliation.tsx:100, :128, :168, :359, :393, :400`; `AdjustQuantities.tsx:117`; `dock-price-hint.tsx:35, :42`.
  - The sign is concatenated: `+{money(...)}`.
  - The result renders "36.00₪" and "+ 30.00₪" (`crops/receiving/showcase_recon_phone390.png`, `showcase_recon_desk1280.png`).
  - Money is set in `font-mono` (JetBrains Mono, which has no ₪ glyph).
- **Fix:**
  - Agent-safe: wrap money in `<Money>` (a plain `<bdi className="tabular-nums">`, Heebo).
  - Human PR: add `signDisplay:'exceptZero'` to `formatIls` for deltas.
  - Credits are labelled in words.

### P2

**RCV-24 · Field type and target sizes are below the field spec** · mobile · visual/a11y · G3, R-13, B1 · S · humanPR no
- **Observed:**
  - 33 `text-xs`/`text-[11px]` uses on field surfaces: list card meta `page.tsx:79`; review `dt` labels; KPI labels; the adjust meta line (`AdjustQuantities.tsx:206`); the dock-slip `dl`; DockPriceHint (`dock-price-hint.tsx:30`).
  - Item meta uses `text-muted` and `text-subtle`, which fail the field contrast target.
  - Steppers are 48 px (spec 56), chips 44 px (spec 48), and the slip "רענן" is about 26 px (`dock-slip.tsx:230–237`).
  - The bottom nav is translucent `glass`.
  - Neither `data-mode="field"` nor installed mode is applied unless the PWA is launched standalone (`ReceiverPwa.tsx:36–43`).
- **Fix:**
  - Add `data-mode="field"` on the receiving routes regardless of install:
    - Body 16 px, item names 17/600 ink, quantities and ₪ 24 px bold tabular.
    - A 14 px floor.
    - Steppers 56×56, chips 48 px with gaps ≥8 px.
    - Solid surfaces.

**RCV-25 · Hebrew typesetting: letter-spaced eyebrow and an uppercase-tracked table header** · both · rtl/visual · E6 · S · humanPR no
- **Observed:**
  - `StepHeader` eyebrow uses `uppercase tracking-[0.18em]` on "צעד 2 מתוך 5" (`SupplierSelect.tsx:149`), visible as spaced letters in `dashboard_receiving_ID__receiver__phone-he.png`.
  - The review `thead` uses `uppercase tracking-wider` (`Reconciliation.tsx:274`).
- **Fix:** apply tracking and uppercase only under `:lang(en)`. Hebrew uses weight and colour for the eyebrow.

**RCV-26 · Accessibility gaps** · both · a11y · F2, F3, F6, F7, F9 · S · humanPR no
- **Observed:**
  - **Progress segments:** the empty ones are `bg-surface-2` on `bg` (238,243,240 vs 246,248,247, about 1.05:1, measured), so they fail 1.4.11. There is no `role="progressbar"` (`wizard.tsx:531–541`).
  - **Quantity input names:** every card's input is named "כמות שהתקבלה" without the item (`AdjustQuantities.tsx:239`; probe `aria-labelledby=null`).
  - **Chips:** they show the active state by colour only, with no `aria-pressed` (`:322–328`). On the price line both "= הזמנה" and "= חשבונית" look selected while the line is still unresolved (screenshot).
  - **Matched toggle:** it has no `aria-expanded` (`:84–103`).
  - **Motion:** the GSAP viewfinder pulse repeats infinitely and ignores `prefers-reduced-motion` (`InvoiceScan.tsx:85–91`). The Confirmed check bounces with `back.out(2)` (`Confirmed.tsx:39–44`).
  - **Status announcements:** the processing stages have no live region.
  - **Focus ring:** `ring-primary/50` (`page.tsx:65`) is likely under 3:1.
- **Fix:**
  - Segments use `line-strong` (≥3:1), with `role="progressbar" aria-valuenow`.
  - `aria-labelledby` = item name plus "כמות שהתקבלה".
  - Add `aria-pressed` and `aria-expanded`.
  - Respect reduced motion with a GSAP `matchMedia`.
  - Use `role="status"` on the stage text.
  - Use the `--c-focus` token.

**RCV-27 · Errors render far from their trigger; the offline-saved message is styled as danger** · mobile · states · C9, A7 · S · humanPR no
- **Observed:**
  - A single `role="alert"` danger box at the top of the wizard (`wizard.tsx:543–548`) receives every failure: a mid-loop `markGrLine` failure while the user is at the bottom footer, and the neutral "התמונה נשמרה בטלפון" offline notice.
  - No per-line error, and no retry button.
- **Fix:**
  - Show errors on the line or the footer ("שמירת 2 שורות נכשלה · נסה שוב").
  - Offline-queued is a neutral T4 status.
  - Scroll and focus the error into view.

**RCV-28 · The PO page blocks first paint on a chain of server awaits; wrong skeleton; no error boundary** · mobile · perf/states · I1, I4, C8 · S · humanPR no
- **Observed:**
  - `ensureEnglish` (≤4 s) and/or `localNames` (≤4 s), then `priceContext`, then `getPo`, all sequential (`[poId]/page.tsx:39–70`). For an English or Arabic receiver, LCP can exceed 5–8 s with the driver waiting.
  - The PO route has no `loading.tsx`, so it shows the list's card-grid skeleton (`receiving/loading.tsx`).
  - There is no `error.tsx` in the area.
  - GSAP and `@gsap/react` ship on the field route for decorative staggers.
- **Fix:**
  - `Promise.all([getPo, priceContext])`, and stream the names into the wizard after first paint.
  - Add a wizard-shaped `loading.tsx`, and an `error.tsx` with "נסה שוב / חזרה לרשימה".
  - Replace GSAP staggers with CSS transitions (motion tokens).

**RCV-29 · Copy: jargon, mixed grammatical person, duplicated labels** · both · copy · E9, E7 · S · humanPR no
- **Observed (`apps/web/lib/i18n/messages/receiving/he.ts`):**
  - Jargon:
    - "לקבע את החיסכון" (`:12`).
    - "ולהגדיל את החיסכון המוקפא" (`:92`).
    - "ביטחון OCR {confidence}" in every review subtitle (`:85`), which breaks R-11 (confidence only when low).
    - "מנוע ההתאמה מריץ עכשיו את ההצלבה הסופית" (`:148`).
    - "סודר" (`:140`).
  - "וודא" (`:42`) should be "ודאו".
  - Grammatical person is mixed: masculine singular "בחר/וודא/לחץ" alongside plural "פתחו/סמנו/בדקו".
  - "צלם / העלה קובץ" mixes two actions.
  - Chips "= הזמנה (20)" use a cryptic "=".
  - Cards say the same thing twice ("פתח קבלה חדשה" + "קלוט סחורה").
  - The list subtitle runs 2 lines for a receiver who knows the job.
  - "⚠️" is embedded in a string (`:93`).
- **Fix:**
  - Use plural imperative throughout (the house style elsewhere).
  - Labels:
    - "צלמו חשבונית" (camera) and, as a separate action, "העלו קובץ".
    - "כמו בהזמנה · 20" / "כמו בחשבונית · 20".
    - "עודכן ✓".
  - Subtitle: "המשלוחים של היום".
  - Drop the confidence from the subtitle.

**RCV-30 · The confirmation is a celebration screen with an internal id, a reload and no next step** · mobile · flow/visual · J1, D5 · S · humanPR no
- **Observed:**
  - A 96 px `shadow-glow-primary` check with a bounce (`Confirmed.tsx:61–63`).
  - The internal invoice UUID in 11 px mono (`:112–114`).
  - An expiring scan link in a new tab (`:119–127`).
  - "חזרה לרשימת המשלוחים" does a full `window.location.href` reload (`wizard.tsx:662–665`).
  - No "המשלוח הבא: מחלבות הגליל 15:00 →".
- **Fix:**
  - A calm T3 summary: "נקלט 07:42 · 11 שורות · 2 חריגות נשלחו לספק".
  - A primary that names the next truck, via client navigation.
  - No UUID.

**RCV-31 · The empty state has no CTA, and today-only hides tomorrow and late deliveries** · mobile · states · C8 · S · humanPR no
- **Observed:** "אין משלוחים שמתוכננים להיום" plus a jargon description, with no action (`page.tsx:46–51`, he.ts `:10–12`).
- **Fix:** typed empty state:
  - "אין משלוחים צפויים היום".
  - Primary: "ספק הגיע בלי הזמנה" (RCV-04).
  - Secondary: "המשלוחים של מחר (3)".
  - Show "באיחור מאתמול" if any.

**RCV-32 · The chef cannot receive** · mobile · ia · D7 · S · humanPR no
- **Observed:** `ROUTE_ROLES['/dashboard/receiving']` omits `chef` (`roles.ts:45`), and the mutations use `receiverProcedure`. In many independent Israeli kitchens the chef or sous takes the 06:30 produce and meat delivery.
- **Fix:** a restaurant setting "מי מקבל סחורה" (a per-role toggle, default on for chef), mirrored in `receiverProcedure`.

**RCV-33 · No cold-chain or quality check for chilled and frozen lines** · mobile · functional · G4 · M · humanPR no (unless thresholds become engine rules)
- **Observed:** no temperature or condition capture beyond "פגום". Restaurants log receiving temperatures for meat, fish and dairy (HACCP / משרד הבריאות practice), and a warm delivery is the best credit argument there is.
- **Fix:**
  - Optional per-category "טמפ׳ בקבלה" (keypad, °C) on lines whose product category is chilled or frozen.
  - An out-of-range value pre-selects the "טמפרטורה לא תקינה" reason with a photo.
  - It appears on the slip.
- **Exemplar:** FoodDocs and Apicbase HACCP receiving logs [K].

**RCV-34 · The public demo promises more than the product delivers** · both · trust · J3 · S · humanPR no
- **Observed:** the showcase receiver shows things the authenticated flow lacks:
  - The PO ₪ value and "צפוי PO אחד" on supplier cards.
  - "הספק לא ברשימה?".
  - A "billed 8 / arrived 7.5" quantity-difference story (`_mock.ts:177–186`).
- **Fix:** close the gap from the product side (RCV-01, RCV-04, RCV-13). Until then, align the demo copy so a pilot customer doesn't find the gap at the door.

### P3

**RCV-35 · Two back affordances on the scan step** · mobile · flow · D5 · S
- **Observed:** the top "חזרה לרשימת המשלוחים" is a Link (`[poId]/page.tsx:97–103`). The bottom "חזרה" calls `history.back()` (`wizard.tsx:557`; `InvoiceScan.tsx:273–280`), which leaves the app when the page was opened from a push or share.
- **Fix:** one "× יציאה" at the top start, guarded when there is unsaved work.

**RCV-36 · No optional barcode scan or haptic and audio confirmation** · mobile · functional · G3 · M
- **Observed:** no `BarcodeDetector`, `vibrate` or audio cue anywhere in the area (grep).
- **Fix:**
  - An optional scan-to-jump on packaged goods.
  - A ✓ tick sound and an Android haptic on line confirm, as a secondary signal only.
- **Exemplar:** Odoo Barcode, R365 scan-to-add.

---

## 4. Big moves

**BM-1 · "בדיקת משלוח": one count-first, exception-first screen** (replaces SCAN → PROCESSING → REVIEW → ADJUST)
- **Layout:**
  - The PO card opens straight on the line list in paper order. Every line is pre-filled at the expected (or supplier-confirmed) quantity and shows "הוזמן 10 ק״ג".
  - A sticky header: supplier · window · **"📷 צלם חשבונית"** chip (runs in parallel; OCR in the background).
  - A sticky 56 px footer:
    - Primary **"✓ הכל הגיע כמו בהזמנה (12)"**.
    - It becomes **"סיים קבלה · 2 חריגות"** once any line is ✗.
  - Per line: ✓ (default) or ✗.
    - ✗ opens the RCV-07 sheet: reason, qty or keypad, photo.
    - A swipe is optional and always paired with buttons; never swipe-only.
- **When OCR lands:** a T2 banner, "החשבונית נקראה — 2 מחירים גבוהים מההזמנה · ₪46 · לבדיקת המנהל". Price diffs are routed to approvals and never block the door.
- **Optional blind count** per supplier (expected quantity hidden), owner-controlled.
- **Targets:**
  - Clean delivery: 3 taps and ≤20 s.
  - "Billed 10, arrived 8": ≤5 taps.
  - It also fixes RCV-01, 05, 14 and 15.
- **Exemplar:** Choco Delivery Check, Galley receiving, Square Receive All, WMS partial-blind receiving.

**BM-2 · Dock outbox: offline-first and resumable receiving**
- One IndexedDB outbox of typed mutations with idempotency keys:
  - startReceipt, markGrLine on every change, photo pages, submitReceipt, slipShared.
- Today's POs are precached at shift start, and the wizard renders from local data.
- A header chip **"⟳ 3 ממתינים לסנכרון"** opens per-item status. Unsynced items never show "התקבל ✓".
- Resume: "המשך מ-07:42 · 5/12".
- Wake Lock is held during the receipt.
- Sign-out never drops the queue silently.
- Money-committing actions elsewhere stay online-only and say so.
- **Exemplar:** Restaurant365 offline counts, WISK unsynced counter, Toast offline mode, Android offline-first.

**BM-3 · Pro document scanner**
- A full-bleed `getUserMedia` rear camera with a torch toggle.
- Live edge detection, with auto-capture after 600–700 ms of stability and a 72 px manual shutter.
- A blur and darkness gate with a named reason.
- **"+ עמוד"** with a thumbnail strip (retake, delete, reorder).
- Document type chip: חשבונית מס / תעודת משלוח / זיכוי.
- Per-page determinate upload, into one invoice of N pages.
- Fallback: `<input capture="environment" multiple>`.
- Desktop gets drag-and-drop and paste.
- **Exemplar:** Toast xtraCHEF, MarginEdge, Dynamsoft and Veryfi web capture.

**BM-4 · Driver-facing dispute slip and a one-tap claim**
- At finish, with exceptions:
  - One question, "מה מבקשים? זיכוי / החלפה".
  - A full-screen sunlight-legible slip: lines, photos, quantities, then the engine ₪ when ready.
  - Driver name plus a finger signature.
  - "שלח לספק ב-WhatsApp", with the share logged.
- The credit claim is auto-drafted in `leaks/claims` with the photos. The receiver sees a calm T3 "₪184 נכנסו לדרישה".
- This turns a finding into ₪ back on the spot.
- **Exemplar:** Cut+Dry Request a credit, Choco Request for Supplier, Supy Disputed GRN.

**BM-5 · Deliveries board: the receiver's "today" on the phone, a control tower on the desktop**
- **Phone:**
  - Time-window groups (דורש טיפול / באיחור / עכשיו / בהמשך / התקבלו) and an enlarged next-truck card.
  - A "ספק הגיע בלי הזמנה" FAB.
  - The receiver lands here (RCV-18).
- **Desktop:**
  - A dense table with date navigation, branch, status, receiver, ₪ ordered, exceptions ₪, invoice-read status and slip-sent.
  - A row opens a split-pane receipt detail: image | lines ordered / billed / received / Δ₪ | photos, signature and audit timeline.
  - Saved views in the URL.
  - A 30 s live refresh.
- **Exemplar:** US Foods MOXē Delivery Tracker, DoorDash Needs Action, Galley receiving by date, Linear split view.

**BM-6 · Back-door terminal mode** · humanPR **yes** (auth and session minting need a `tenant-security-warden` review)
- A restaurant setting turns a mounted phone or tablet into a receiving terminal:
  - The installed PWA launches into BM-5.
  - A 4-digit **PIN user switch** replaces sign-out, so the queue survives and each GR is attributed to a named person.
  - An idle lock after 5 min.
  - Forced field mode (56 px, 17 px body, solid surfaces, sound on).
  - A receiver-language picker in the flow.
- **Exemplar:** Toast Go and Square Handheld dedicated-device practice, POS staff passcodes used in Israeli kitchens (Tabit/Toast).

---

## 5. Rubric scorecard (Field archetype)

| Criterion | Result | Note |
|---|---|---|
| A4 zero vs unknown | **Fail** | Zero KPI tiles in PO-only mode (RCV-14). |
| A7 T4 never cries wolf | Partial | Calm OCR and duplicate notices pass. But "קבלה בתהליך" is warn, and the offline-saved message uses danger styling. |
| A9 one money vocabulary | **Fail** | Three names, two sources (RCV-11). |
| B1/B2 type and money face | Fail | `text-xs` on field routes; money in mono (RCV-23, RCV-24). |
| B6/B9 density and layout | Fail (desktop) | RCV-19, RCV-20. |
| C4 named reconciliation states | Partial | Sections and statuses exist; no counts in tabs, no "excluded"/Undo. |
| C7 amount and quantity inputs | **Fail** | `type=number`, 2 dp (RCV-10). |
| C8 designed states | Partial | List skeleton only; no `error.tsx`; empty state has no CTA (RCV-28, RCV-31). |
| C9 message by stakes | Fail | One top banner for every error (RCV-27). |
| C11 status chips | Pass | Icon + word + colour. |
| C12 one primary per region | Fail | Gold and primary on review. |
| D1 role lands on its job | **Fail** | RCV-18. |
| E4 ₪ in RTL | **Fail** | 12 `dir=ltr` sites, including the slip (RCV-23). |
| E6 Hebrew typesetting | Fail | RCV-25. |
| E10 receiver languages | **Pass** | ar/ru/th/ti plus the Hebrew-original toggle. |
| F2/F3/F6/F9 | Partial | RCV-26. |
| G1 field mode | **Fail** | Bottom nav present; no `data-mode`. |
| G2 thumb-zone primary | **Fail** | y=931 at 390×844 (RCV-06). |
| G3 gloves/sun | Fail | 48/44 px controls; 12 px muted meta (RCV-24). |
| G4 exception-first, mirrors paper | **Fail** | RCV-01, 12, 13, 14, 15. |
| G5 preset → stepper → keypad | Partial | Presets and stepper exist; no keypad, ±1 on kg. |
| G6 camera capture | **Fail** | Single page, no `capture`, no quality gate (RCV-03). |
| G7 offline-first, resumable | **Fail** | RCV-02, RCV-09. |
| G8 evidence at dispute | **Fail** | RCV-07, RCV-08, RCV-21. |
| H3/H4 provable, labelled numbers | Partial | Slip ₪ engine-only (pass); client estimate labelled "savings" (fail). |
| I1/I3 latency and wait ladder | Fail | Sequential awaits; fake stages; 30 s escape. |
| J1 celebrate quietly | Partial | Bouncing 96 px check. |
| J3 one product everywhere | Fail | The demo outruns the product (RCV-34). |

---

## 6. Governance notes (AGENTS.md)

- **Human PR required:**
  - RCV-12: `line_no` columns (schema).
  - RCV-17: per-supplier billing mode or document type (schema).
  - RCV-23: `signDisplay` in `formatIls`.
  - RCV-10: per-product weight tolerance (`packages/matching/src/tolerances.ts`).
  - BM-6: PIN session switch (auth/RLS, `tenant-security-warden`).
- **Everything else is agent-safe:**
  - Owners: `ocr-procurement-engineer` (wizard, capture, outbox, slip) and `web-feature-engineer` (list, desktop surfaces, roles).
  - Visual tokens and field mode: `rtl-design-steward`.
- **New tRPC procedures:** the receipt detail and a walk-in receipt each need a coverage entry in `cross-tenant.attack.test.ts` (adding entries is allowed).
- **Engine-only ₪:** BM-1 and BM-4 keep the slip's ₪ engine-only, as today. The receiver never sees a client-computed ₪ again (RCV-11).
