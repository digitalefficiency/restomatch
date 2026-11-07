# int-02 — Receiving / Delivery Check: current-state map and automation opportunities

Area: the back door. Covers the receiving board ("inbox"), the Delivery Check wizard (scan → OCR → review → count → close), goods receipts (GR), the dock dispute slip, partial deliveries / follow-up reopen, the late-delivery chase, the supplier confirmation portal (pre-delivery), receiver languages, the offline PWA, and what the receiver sees (must be no ₪).

Source of truth: `release/train-a` checkout (`c6132c0e Merge #208 into train A`). All paths below are relative to that checkout unless marked "main". The receiving router, the web receiving routes, `apps/web/lib/pwa`, `dailyExpectations.ts` and `supplierDelays.ts` are byte-identical on main (`759fb554`); only `packages/api/src/receiving/devOcrStub.ts` differs. Nothing in this area exists only on main.

Owner rules applied as the yardstick: receiver sees NO ₪; chef sees ₪ only on orders and recipes; approval routing manager ₪50–300 / 2–5%, owner above and every blocking gap; MISSING_ON_INVOICE not claimable and out of the leak; claim overdue after 7 days; every money action human-confirmed unless an owner rule says otherwise.

---

## 1. Building blocks at a glance

| Block | Where | Notes |
|---|---|---|
| tRPC router `receiving` | `packages/api/src/routers/receiving.ts:83-1197` | 13 procedures (list in §2). |
| Role gates | `packages/api/src/trpc.ts:133-162` | `receiverProcedure` = owner/manager/receiver (`:149`); `invoiceReaderProcedure` = owner/manager/receiver/bookkeeper (`:158-160`); `memberProcedure` = any member incl. chef (`:133`). |
| Router `receiverLangs` | `packages/api/src/routers/receiverLangs.ts:21-103` | flag `receiverLanguages`. |
| Router `supplierConfirm` | `packages/api/src/routers/supplierConfirm.ts:13-37` + `packages/api/src/supplierConfirm/service.ts` | flag `supplierConfirm`; public side `apps/web/app/s/[token]`, `apps/web/app/api/supplier-confirm/[token]/route.ts`. |
| Match hold/trigger logic | `packages/api/src/receiving/matchTriggers.ts:17-31` | OCR job holds while GR is `pending`; `submitReceipt` re-matches. |
| Delivery state (single definition) | `packages/api/src/lib/deliveryState.ts:15-40` | upcoming / due_today / late (+60 min, `:21`) / in_progress / received / cancelled. |
| Web routes | `apps/web/app/dashboard/receiving/page.tsx` (board), `apps/web/app/dashboard/receiving/[poId]/page.tsx` + `wizard.tsx` (Delivery Check), `apps/web/app/dashboard/receiving/share/route.ts` (PWA share target) | Wizard step components are imported from `apps/web/app/showcase/receiver/_steps/*`. |
| PWA | `apps/web/lib/pwa/ReceiverPwa.tsx`, `offlineQueue.ts`, `lineOutbox.ts`, `useQueuedPhotoUpload.ts`, `apps/web/public/pwa/manifest.webmanifest`, `apps/web/app/receiver-sw.js/route.ts` | flag `receiverPwa`. |
| Worker jobs | `apps/worker/src/jobs/dailyExpectations.ts`, `supplierDelays.ts`, `ocrInvoice.ts`, `matchInvoice.ts`, `endOfDayReport.ts` | Scheduled in `apps/worker/src/cron.ts:54-150` (IMMUTABLE). |
| DB tables | `purchase_orders`, `po_lines`, `goods_receipts`, `gr_lines`, `invoices`, `invoice_lines`, `match_runs`, `discrepancies`, `audit_log`, `memberships.preferred_locale`, `supplier_confirm_links`, `supplier_responses`, `notifications_outbox` | Schema in `packages/db/src/schema.ts` (IMMUTABLE). |
| Feature flags | `packages/api/src/lib/features.ts:11-71` | Everything OFF unless `restaurants.settings.features.<key>` or `all` (`:61-71`); `FEATURES_OFF` env kill-switch (`:56-59`). |

### Procedures in `receiving`

| Procedure | Gate | Purpose | Cite |
|---|---|---|---|
| `todayExpectations` | member | Today's trucks (+ late 7 d, + undated 14 d) | `receiving.ts:88-218` |
| `getPo` | member | PO header + lines (incl. `totalEstimated`, `unitPriceExpected`) + `features.dockSlip` | `receiving.ts:224-275` |
| `getReceipt` | member | GR + gr_lines | `receiving.ts:284-353` |
| `dockSlip` | invoiceReader | Slip header + engine ₪ per claimable line | `receiving.ts:363-513` |
| `getInvoice` | invoiceReader | OCR status, totals, line prices | `receiving.ts:521-603` |
| `updateInvoiceHeader` / `updateInvoiceLine` | manager | OCR corrections | `receiving.ts:610`, `:693` |
| `startReceipt` (incl. `reopen`) | receiver | Create GR mirroring PO; reopen partial | `receiving.ts:750-858` |
| `markGrLine` | receiver | Save one counted line | `receiving.ts:863-927` |
| `submitReceipt` | receiver | Close GR → completed/partial → re-match | `receiving.ts:933-1006` |
| `registerInvoice` | receiver | Invoice row + enqueue OCR | `receiving.ts:1013-1123` |
| `ensureEnglish` | invoiceReader | Fill English names | `receiving.ts:1134-1147` |
| `pendingInvoices` | member | Invoices in OCR / parsed | `receiving.ts:1152-1179` |
| `priceContext` | invoiceReader | flag `dockPriceContext` "usual price" | `receiving.ts:1185-1192` |

---

## 2. Workflows end to end

### W1 — Morning: "what trucks are coming today" (receiver, manager)

**Manual today.** The receiver opens `/dashboard/receiving` (1 tap from nav). The server page calls `receiving.todayExpectations({ includeLate: true })` (`apps/web/app/dashboard/receiving/page.tsx:31`) and renders `ReceivingBoard` (`apps/web/app/dashboard/home/receiving-board.tsx:14-30`): summary line, the next truck enlarged with one 56 px CTA, then late / now / later / no date / received. "No ₪ anywhere: this is the back door" (`receiving-board.tsx:18`). The day window follows the restaurant's timezone (`receiving.ts:102-111`). Undated POs from the last 14 days are listed (`receiving.ts:56`, `:150-156`); open POs up to 7 days late stay as "late" (`receiving.ts:58`, `:157-168`).

**Automatic today.** Cron `daily-expectations` at 06:00 IL (`apps/worker/src/cron.ts:55-59`) runs `processDailyExpectations` (`apps/worker/src/jobs/dailyExpectations.ts:54-142`), which computes the same list per restaurant using `deliveryState` (`:93-103`) — and then **only writes an `audit_log` row** `daily_expectations.computed` (`:122-132`). Grep shows no reader of that action anywhere in the code (only the writer at `dailyExpectations.ts:125`). It sends nothing via `notifications_outbox`; the receiver is not told anything at 06:00. **This job is effectively dead output.**

**Flag-gated.** None for the board itself.

### W2 — Delivery Check: scan → OCR → review → count → close (receiver; owner/manager can also do it)

Route `apps/web/app/dashboard/receiving/[poId]/page.tsx` → client `ReceivingWizard` (`wizard.tsx`). Steps: `RESUMING | SCAN_INVOICE | PROCESSING | RECONCILIATION_REVIEW | ADJUST_QUANTITIES | CONFIRMED | SUMMARY` (`wizard.tsx:97-104`). The supplier step is skipped because the PO carries the supplier (`wizard.tsx:96`).

Step by step, with approximate taps (happy path, 12-line order):

1. **Open truck** (1 tap on board CTA). Server pre-loads PO, existing receipt, localized names (4 s cap), price-context flag in parallel (`[poId]/page.tsx:43-87`).
2. **Photograph invoice** (1-2 taps: camera + shutter; retake possible). Upload goes through `scans.upload` server-side (`wizard.tsx:338-366`); the photo is down-scaled in the browser first (`showcase/receiver/_steps/scanPrep.ts:4-15`). Offline → queued in IndexedDB (`wizard.tsx:321-345`).
3. **GR created lazily** on first real action: `startReceipt` creates `goods_receipts` + one `gr_lines` row per `po_lines` row with qty 0 (`receiving.ts:816-857`; `wizard.tsx:368-374`). Race-safe via unique index (`receiving.ts:813-815`).
4. **Register + OCR**: `registerInvoice` inserts `invoices` (status `ocr_pending`, source `photo`), idempotent on the storage object (`receiving.ts:1043-1081`), and enqueues `ocr-invoice` (`receiving.ts:1100-1120`). The wizard polls `getInvoice` (`wizard.tsx:428-451`); on time-out it falls back to counting against the PO and keeps polling in the background (`wizard.tsx:442-450`, `:487-498`).
5. **Review** (`RECONCILIATION_REVIEW`, `showcase/receiver/_steps/Reconciliation.tsx`): PO vs invoice lines side by side; prices shown only when `showMoney` (`Reconciliation.tsx:35-36`, `:64`); a price difference shows "price goes to the manager" text (`Reconciliation.tsx:108`). 1 tap to continue.
6. **Count** (`ADJUST_QUANTITIES`, `showcase/receiver/_steps/AdjustQuantities.tsx`): per line +/- steppers and chips "as ordered" / "missing" / "damaged" (`AdjustQuantities.tsx:474-555`). A bulk "everything arrived as ordered (N)" is preceded by a **blind spot-check of up to two random lines** (owner decision 20; `AdjustQuantities.tsx:93-113`, `pickSpotCheck` in `_count.ts`), with a time-boxed undo (`AdjustQuantities.tsx:33`, `:129-135`). Count methods `per_line | bulk_as_ordered | spot_check` ride in `condition_notes` until a column exists (`_count.ts:13-14`). Happy path: ~3-4 taps (bulk + 2 spot counts); worst case 2-4 taps per line.
   Every mark saves on change (300 ms debounce) via `markGrLine` with an on-device outbox (`wizard.tsx:213-229`; `receiving.ts:863-927`). Count is never taken from the invoice (`_count.ts:1-11`).
7. **Close** (1 tap): `submit()` flushes the outbox, then `submitReceipt` (`wizard.tsx:729-780`). Server sets `completed` if every line ≥ ordered, else `partial` (`receiving.ts:977-983`), and calls `rematchAfterCount` (`receiving.ts:1003`, `:1217-1274`), which enqueues `match-invoice` with `rematch: true` and the counted PO pinned (`receiving.ts:1253-1272`).
8. **Confirmed**: "Next delivery: <supplier> · 15:00 →" computed client-side from `todayExpectations` (`wizard.tsx:782-799`) — 1 tap to go straight to the next truck.

Total for a clean 12-line delivery with invoice: ~7-9 taps. **No re-typing** of quantities from paper — except where OCR failed/quota (`wizard.tsx:439-441`), in which case the receiver counts against the PO and the manager later fixes the invoice header/lines by hand (`updateInvoiceHeader`/`updateInvoiceLine`, `receiving.ts:610`, `:693`).

**Automatic today.**
- OCR job holds its match while the GR is `pending` (avoids "received 0" false leak), serialized with an advisory lock (`matchTriggers.ts:17-36`); `submitReceipt` claims waiting scans (`receiving.ts:1228-1247`).
- `match-invoice` job notifies roles on a **first** match only (`apps/worker/src/jobs/matchInvoice.ts:186-190`): push always, WhatsApp only with the `whatsapp_alerts` entitlement (`:191-208`), email to manager-tier recipients (`:222-252`). A post-count re-match that *replaces* an earlier run does not re-notify (`:189-190`).
- Approval routing decides who is told (`persisted.rolesNeedingNotification`, rules from `resolveApprovalThresholds(settings.approvalThresholds)` at `matchInvoice.ts:122-128`; engine in `packages/api/src/approvals/engine.ts` — IMMUTABLE).

**Local-demo stub.** `devOcrStub` builds a deterministic OCR from the PO when there is no `ANTHROPIC_API_KEY`, never in production (`packages/api/src/receiving/devOcrStub.ts:15-17`; used at `receiving.ts:1086-1090`). This file differs between trainA and main.

### W3 — Dock dispute slip ("תעודת פערים") to the driver/supplier (receiver, manager)

When anything is short / rejected / over-priced / unordered / duplicate, the wizard offers the slip (`wizard.tsx:265-270`; issue model `[poId]/_dockSlip.ts:14`, `:59-68`). Data from `receiving.dockSlip` (`receiving.ts:363-513`): header (supplier, PO ref, time, receiver name only when the viewer is the receiver, `:396-410`) plus the **engine's** ₪ per claimable line (`claimableLines`, `receiving.ts:478-497`), only after a post-close match run exists (`:451-465`), else a `holdReason` (`:467-474`). `claimableLines` excludes `PRICE_LOWER`, `UNORDERED_ARRIVAL`, `MISSING_ON_INVOICE` (`packages/api/src/lib/claims.ts:19-22`) — consistent with the owner rule.

**Manual today.** Receiver taps "WhatsApp" → a `wa.me` deep link with the slip text, or "Copy" (`[poId]/dock-slip.tsx:141-151`, `:264-278`). The human sends it from their own phone. With `showMoney=false` the slip text carries **quantities only** — no ₪ (`dock-slip.tsx:43-44`, `:91-101`). ~2-3 taps.

**Automatic.** The slip polls until the post-count run lands (`dock-slip.tsx:59-67`). Nothing is stored that the slip was sent; it is not linked to a claim/recovery record.

**Flag.** `dockSlip` — OFF by default (`features.ts:7`, `:29`), ON in the pilot set (`packages/db/scripts/pilot-config.ts:26-37`; admin "pilot defaults" button `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:19-31`).

### W4 — Partial delivery / QTY_SHORT / follow-up truck (receiver, manager)

- A short count closes the GR as `partial` (`receiving.ts:977-983`). The engine raises `QTY_SHORT` from ordered vs received, ₪ = expected price × un-billed shortfall (`packages/matching/src/engine.ts:95-120`, `:257-266` — IMMUTABLE). Billed-but-not-received is counted once (`engine.ts:247-266`).
- For the board, a partial receipt is terminal ("received"): "the missing lines are a backorder, i.e. a new PO" (`deliveryState.ts:35-38`). **No code creates that backorder PO** — grep for "backorder" finds only this comment. The owner/manager must create a new order manually.
- Follow-up delivery for the same PO: closed receipt view `?receipt=<poId>` (`receiving/page.tsx:28-63`) with `ReopenReceipt` for owner/manager/receiver (`page.tsx:50-52`; `apps/web/app/dashboard/home/receipt-view.tsx:8`). `startReceipt({ reopen: true })` flips `partial → pending`, audit-logged `goods_receipt.reopened` (`receiving.ts:762-794`). Stale offline rows from before the reopen are held, not replayed (`wizard.tsx:218-229`).
- Nobody is notified that a delivery closed partial; the only signal is the first-match approval notification (W2), which is about ₪ not about the missing goods.

### W5 — Late truck chase (manager/owner; receiver not involved)

Cron `supplier-delays` 10:00 IL (`cron.ts:83-87`) → `supplierDelays.ts:1-14`: open PO, **no GR at all**, late per `deliveryState`, only on days 1, 3 and 7 after expected (`supplierDelays.ts:95-118`). It enqueues one **email** per owner/manager recipient (`recipientsForRestaurant` default `MANAGER_ROLES = ['owner','manager']`, `packages/api/src/notifications/recipients.ts:28-38`) into the outbox, deduped `po:<id>:late:d<n>:<email>` (`supplierDelays.ts:143-158`); link goes to `/dashboard/receiving/<poId>` (`:139`). Delivery through `outbox-dispatch` every 60 s (`cron.ts:70`).

**Manual.** The manager reads the email and phones/WhatsApps the supplier themselves. The supplier is never contacted by the system; no supplier-facing chase text is drafted.

### W6 — Pre-delivery supplier confirmation (manager; supplier)

`supplierConfirm.createLink` mints a 72 h token link for a sent PO (`routers/supplierConfirm.ts:15-27`; TTL `service.ts:38`). With the flag on, the link is auto-appended to the order document when the order is sent (`packages/api/src/supplierConfirm/documentExtension.ts:5-13`, registered at `packages/api/src/orders/document/index.ts:31`). The supplier answers on public `/s/[token]` (rate-limited, `apps/web/app/api/supplier-confirm/[token]/route.ts:45`) with `qtyAvailable` and `proposedUnitPrice` per line; the restaurant sees a diff card on the order page (`apps/web/app/dashboard/orders/[poId]/supplier-confirm-card.tsx:30-32`; `service.ts:363-400`).

**Gap.** The supplier's answer never reaches receiving: grep finds `supplierResponse*` only in the service, the order page and the public portal — not in `receiving.ts`, the wizard, `todayExpectations`, `dailyExpectations` or `supplierDelays`. A supplier who said "only 8 of 10" is not pre-flagged at the dock, and no one is notified when the supplier answers (no `enqueueNotification` in the route). Flag `supplierConfirm` is OFF by default and **not** in the pilot set (`pilot-config.ts:26-37`).

### W7 — Receiver languages / English names (receiver; manager sets locale)

- Hebrew → ar / ru / th / ti names per PO and invoice (`receiverLangs.localNames`, `receiverLangs.ts:35-55`), DB-cached, Claude within an hourly budget; invoice names need an invoice-reader role (`:45-50`). Member sets own language (`setMyLocale`, `:58-77`); owner/manager sets a member's (`setMemberLocale`, `:83-102`, audited).
- English: `ensureEnglish` (`receiving.ts:1134-1147`), glossary first, Claude otherwise, display-only.
- Pre-fetched on page load with a 4 s cap (`[poId]/page.tsx:46-59`) and refreshed after OCR (`wizard.tsx:274-283`, `:470-478`).
- Flag `receiverLanguages` — OFF by default, not in pilot set. The language picker on the layout is shown to the receiver only when on (`apps/web/app/dashboard/layout.tsx:164`, `:209-211`).

### W8 — Offline / PWA receiver (receiver)

`receiverPwa` (OFF by default, ON in pilot): installable manifest, large touch targets in standalone mode (`apps/web/lib/pwa/ReceiverPwa.tsx:27-40`), photos queued in IndexedDB and replayed `scans.upload → receiving.startReceipt → receiving.registerInvoice` when online (`apps/web/lib/pwa/useQueuedPhotoUpload.ts:29-54`), attribution "taken by" for shared tablets (`wizard.tsx:334-335`), wake lock during counting (`wizard.tsx:240`). PWA `share_target` lands WhatsApp order text on `/dashboard/orders/capture` (flag `orderCapture`) (`apps/web/app/dashboard/receiving/share/route.ts:3-18`).

### W9 — After the dock: who acts on the ₪ (manager / owner / bookkeeper)

Out of this area's write path but triggered by it: post-count match → discrepancies → approvals queue + notifications (W2). The 19:00 `end-of-day-report` email summarizes open credits and today's catches to owner/manager (`apps/worker/src/jobs/endOfDayReport.ts:1-10`, `:53-99`; `cron.ts:91-93`). Nothing in the EOD report is receiving-specific (deliveries closed partial, deliveries not received, receipts left `pending`).

---

## 3. What the receiver sees — ₪ exposure audit

| Surface | UI hides ₪ for receiver? | API still returns ₪ to receiver? | Cite |
|---|---|---|---|
| Board | yes (no ₪ by design) | `todayExpectations` returns no ₪ | `receiving-board.tsx:18`; `receiving.ts:61-81` |
| Delivery Check page payload | yes — `showMoney` only owner/manager/bookkeeper; `totalEstimated` and `unitPriceExpected` nulled | `getPo` (member) returns `totalEstimated` and full `po_lines` incl. prices | `[poId]/page.tsx:29-33`, `:111-132`; `receiving.ts:224-275` |
| English refresh | **no** — `ensureEnglishFor` re-fetches `getPo` client-side and keeps `unitPriceExpected` unfiltered in `poLines` state (not rendered when `showMoney=false`, but present in the browser) | yes | `wizard.tsx:293-309` |
| Review step | yes (`money = null`) | `getInvoice` (invoiceReader incl. receiver) returns `totalExclVat`, `vatAmount`, `totalInclVat`, `unitPriceBilled`, `lineTotal` — fetched by the receiver's browser during polling | `Reconciliation.tsx:35-36`, `:64`; `receiving.ts:521-603`; `wizard.tsx:432`, `:472` |
| Dock slip | yes, quantities only, incl. WhatsApp text | `dockSlip` (invoiceReader) returns `amountIls`, `totalIls` | `dock-slip.tsx:43-44`, `:91-101`; `receiving.ts:363-513` |
| Price context | yes (`showMoney && dockPriceContext`) | `priceContext` (invoiceReader) returns usual prices | `wizard.tsx:272`; `receiving.ts:1185-1192` |
| Confirmed screen | invoice image / invoice link / "amount pending" hidden | — | `wizard.tsx:1008-1011` |

Conclusion: the "receiver sees no ₪" rule is enforced in the UI only; the server-side block is explicitly deferred as a human PR "H-11" (`[poId]/page.tsx:29-31`, `:111-113`). Any automation that pushes content to a receiver (notification, WhatsApp, digest) must be built from a ₪-free projection, not from these procedures' outputs. Changing the procedure gates touches `packages/api/src/__tests__/cross-tenant.attack.test.ts` COVERAGE semantics — tenant-security-warden review.

---

## 4. Flag matrix for this area

| Flag | Default | Pilot set | Gate points |
|---|---|---|---|
| `dockSlip` | OFF | ON | `receiving.ts:273`, `:372`; `wizard.tsx:163` |
| `receiverPwa` | OFF | ON | `[poId]/page.tsx:42`; `receiving/page.tsx:57` |
| `receiverLanguages` | OFF | OFF | `receiverLangs.ts:22-25`, `:51`, `:61`, `:87` |
| `dockPriceContext` | OFF | OFF | `receiving.ts:1188` |
| `supplierConfirm` | OFF | OFF | `routers/supplierConfirm.ts:20`, `:33`; `documentExtension.ts:35-41` |
| `orderCapture` (share target) | OFF | ON | `share/route.ts:6-8` |
| `consolidatedMatch` (חשבוניות ריכוז path) | OFF | OFF | `features.ts:30` |
| Entitlement `whatsapp_alerts` | per plan | — | `matchInvoice.ts:191-192` |
| Env `FEATURES_OFF` | unset | — | `features.ts:56-59` |
| Env dev OCR stub (no `ANTHROPIC_API_KEY`, non-prod) | — | — | `devOcrStub.ts:15-17` |

All flags default OFF (`features.ts:7`, `:61-71`); toggled by admin `setFeatures` (`packages/api/src/routers/admin.ts:371-386`) via `FeaturesPanel.tsx`.

---

## 5. Stubs, dead code, unused columns

1. **`daily-expectations` has no consumer.** Scheduled daily (`cron.ts:55-59`), computes, writes `audit_log` only (`dailyExpectations.ts:122-132`); nothing reads `daily_expectations.computed`. Zero user value today.
2. **`goods_receipts.signature_url` is never written by the UI.** API accepts it (`receiving.ts:937`, `:989`) but the wizard deliberately sends none: "the invoice photo is not a driver's signature (RCV-07/08)" (`wizard.tsx:754-757`).
3. **`gr_lines.photos` never written by the UI.** `markGrLine` accepts up to 20 URLs (`receiving.ts:872`, `:887`), but no web caller passes photos; the short-lived scan URL is "never persisted as evidence" (`wizard.tsx:355-357`). Damage has a chip, not a photo.
4. **Signed-GR photo fallback** (named in AGENTS.md `ocr-procurement-engineer` mission, `AGENTS.md:113`) has **no implementation**: grep for signed GR / delivery-note capture in receiving finds nothing. Delivery-note (ת.מ.) numbers exist only on the consolidated-invoice side (`packages/api/src/ledger/coverage.ts:7-20`, `:128-129`).
5. **Backorder PO for partial deliveries** is described (`deliveryState.ts:35-38`) but not implemented.
6. **`MockWhatsAppNotifier`** is the WhatsApp fallback when no provider token is set (`packages/api/src/notifications/factory.ts:14`, `:63`) — WhatsApp approval alerts from `matchInvoice.ts:194-208` go to the outbox + log only in that case.
7. **Count method** stored in free-text `condition_notes` pending a column (G-03) (`_count.ts:13`) — any automation reading "how was this counted" must parse text.
8. Wizard step components live under `apps/web/app/showcase/receiver/_steps` and are shared by the production wizard (`wizard.tsx:8-15`) — a refactor hazard, not dead code.

---

## 6. Automation opportunities

Each: trigger → action → what a human still confirms → data needed → reuse → immutable touch.

| # | Opportunity | Trigger → action | Human confirms | Data | Reuse | Immutable? |
|---|---|---|---|---|---|---|
| A1 | **Morning truck list to the receiver (₪-free)** | 06:00 `daily-expectations` → enqueue one push/WhatsApp/email per receiver: "today: 4 trucks — Tnuva 08:00 (12 lines) …" + deep link to the board | none (information only, no money) | `DailyExpectationsEntry` already has no ₪ (`dailyExpectations.ts:28-35`); receiver recipients via `recipientsForRestaurant(db, rid, ['receiver'])` (`recipients.ts:35-38`) | the job itself, `enqueueNotification`, outbox-dispatch | Job file is in `apps/worker` (ocr-procurement-engineer) — not immutable; **changing its schedule touches `cron.ts` (HUMAN-PR)**; using `enqueueNotification` without editing `outbox.ts` is fine. |
| A2 | **Truck-late nudge to the receiver/manager the same day** | `deliveryState` turns `late` (+60 min) → push to receiver + manager "Truck X is 60 min late" with "call supplier" link | manager decides to call | `deliveryState.ts:15-21`, PO `expected_delivery_at`, supplier phone | `deliveryState`, outbox | Needs a sub-daily schedule → **`cron.ts` HUMAN-PR** (today only day 1/3/7 emails, `supplierDelays.ts:1-14`). |
| A3 | **Draft supplier chase message** | supplier-delays day-1 → pre-filled `wa.me` text in the manager email ("Order #… expected yesterday, not arrived — when?") | manager taps send from own phone | supplier `contact_whatsapp`, PO ref | `waLink` pattern from `dock-slip.tsx:151`, `supplierDelayEmail` template | Template change only (`packages/api/src/notifications/templates.ts`, not on list); no auto-send (prime directive). |
| A4 | **Pipe supplier confirmation into the dock** | supplier answers `/s/[token]` → (a) notify manager "supplier confirmed with changes"; (b) wizard pre-flags lines with `qtyAvailable < qtyOrdered` ("supplier said 8") and pre-highlights them for counting (never pre-fills the count — count is evidence, `_count.ts:1-11`) | receiver still counts; manager decides on price proposals | `supplier_responses.lines` (`service.ts:363-380`) | `supplierResponseDiff`, `enqueueNotification`, `getPo` | Notification from the public route touches `apps/web/app/api/...` (not the immutable trpc route); schema unchanged. Price proposals must stay owner/manager-confirmed and hidden from receiver. |
| A5 | **Backorder draft on partial close** | `submitReceipt` → status `partial` → create a **draft** PO with the missing qty per line (or a "reorder missing items?" card for the manager) | manager edits + sends the draft (money action) | `gr_lines` vs `po_lines` diff (`receiving.ts:970-983`) | `orders` router create-draft path, approvals queue | No immutable file if done in a router/worker; `orders` status semantics must not move the original PO out of `sent` (`deliveryState.ts:9-13`). |
| A6 | **"Partial delivery" alert to the manager at close** | `submitReceipt` closes `partial` or with `damaged/missing` marks → push to manager "Tnuva: 2 lines short, 1 damaged" (quantities, no ₪ to receiver) | manager decides claim / reorder | gr_lines marks | outbox | none. Note `matchInvoice.ts:189-190` suppresses notices on a replaced run — a separate GR-based notice avoids touching that logic. |
| A7 | **Auto-send dock slip record → recovery claim draft** | slip `ready` (post-count run) → persist "slip shown/sent" + open a claim draft with the engine lines (`claimableLines`) and the 7-day overdue clock started | owner/manager approves the claim (money action) | `dockSlip` engine lines (`receiving.ts:478-497`) | `claimableLines`, recovery service (`packages/api/src/recovery/*`) | Must not alter `claims.ts` exclusions; MISSING_ON_INVOICE stays out (`claims.ts:19-22`). |
| A8 | **Receipts left open** | GR `pending` > N hours (receiver walked away) → push receiver "finish counting Tnuva" ; EOD report adds "3 receipts open, 1 truck not received" | receiver finishes | `goods_receipts.status/updatedAt` | `endOfDayReport` job (add a receiving section), outbox | EOD job file not immutable; any new schedule → `cron.ts` HUMAN-PR. |
| A9 | **Damage photo evidence** | "damaged" chip → optional camera capture stored in `gr_lines.photos` (column exists) and attached to the slip / claim | receiver takes photo | storage path via `scans.upload`-like server upload | `markGrLine.photos` (`receiving.ts:872`) | none (column exists); storage bucket policy review by tenant-security-warden. |
| A10 | **Signed-GR photo fallback** (no-invoice deliveries) | no invoice at the door → photograph the signed delivery note; OCR the note number + lines; later auto-pair with the monthly חשבונית ריכוז via ת.מ. number | receiver photographs; manager confirms pairing when ambiguous | ת.מ. number, lines | `registerInvoice` flow, `deliveryNoteCoverage` (`ledger/coverage.ts`), consolidated match | A new invoice kind / doc type probably needs **`schema.ts` + migration (HUMAN-PR)**; matching changes in `packages/matching` (HUMAN-PR for ₪ math). |
| A11 | **Auto-localize on first sight** | new PO sent / invoice OCR'd → background job warms `localNames` for every receiver locale in the restaurant, so the dock never waits the 4 s cap | none | `memberships.preferred_locale` | `localNames` cache, worker queue | none; budget limits already in place. |
| A12 | **Server-side ₪ block for receiver/chef (H-11)** | prerequisite for any receiver-facing automation: `getPo`/`getInvoice`/`dockSlip`/`priceContext` return a ₪-free projection for `receiver` (and chef, except orders) | — | role in session | `showMoney` logic from `[poId]/page.tsx:32-33` | Router edits are web-feature-engineer scope, but changes attack-suite expectations (`cross-tenant.attack.test.ts`) → tenant-security-warden; flagged by code as human PR. |
| A13 | **Repurpose `daily-expectations` as the "expected today" source for the Ask assistant / home** | the job already computes per-restaurant lists → store in a readable place (or have Ask call `todayExpectations`) | none | as A1 | `packages/api/src/routers/ask.ts` | none unless a table is added (then schema HUMAN-PR). |

Ranking by ₪ impact (North Star: manufacture/protect the leak number): A6 + A5 + A7 protect the QTY_SHORT ₪ (missing goods are re-ordered and claimed instead of forgotten); A4 catches price/qty changes before the truck; A9/A10 strengthen evidence so the owner "believes" the number; A1/A2/A8 reduce missed counts (a delivery with no GR has no QTY_SHORT at all — the leak is invisible).

---

## 7. Immutable-list touch points for this area

- `apps/worker/src/cron.ts` — any new or re-timed schedule (A1 timing, A2 intraday, A8). HUMAN-PR.
- `packages/api/src/notifications/outbox.ts` — reuse `enqueueNotification` as-is; do not modify. HUMAN-PR if a new channel/role-target semantics is needed.
- `packages/matching/src/engine.ts`, `index.ts`, `tolerances.ts`, `units.ts`, `reconciliation.ts` — QTY_SHORT math, tolerance (`DEFAULT_TOLERANCES` read by the UI at `[poId]/page.tsx:5-6`, `:157`). HUMAN-PR.
- `packages/api/src/approvals/engine.ts` — who is notified after a post-count match. HUMAN-PR.
- `packages/db/src/schema.ts` + migrations — a count-method column (G-03), backorder link, signed-GR doc type, slip-sent record. HUMAN-PR.
- `packages/db/src/rls.ts` / RLS SQL — any new table for slips or supplier-response flags. HUMAN-PR.
- `packages/api/src/__tests__/cross-tenant.attack.test.ts` — add coverage entries for any new procedure; never weaken.
- `apps/web/lib/rateLimit.ts` — public supplier portal rate limit (A4 touches the public route but not this file).

## 8. Surprises

- The 06:00 `daily-expectations` cron runs every day and produces nothing a user sees (audit row only, no reader).
- The "receiver sees no ₪" rule is UI-only; four procedures callable by a receiver return ₪, and the English-refresh path keeps PO prices in the receiver's client state (`wizard.tsx:293-309`).
- The supplier confirmation answer (qty available, proposed price) is invisible to the receiver and triggers no notification.
- Partial deliveries are terminal on the board and no backorder is created, although the code comment says the missing lines are "a new PO".
- `signature_url` and `gr_lines.photos` exist end to end in the API but the UI never writes them; the signed-GR photo fallback named in AGENTS.md is unbuilt.
- Late-delivery chase reaches owner/manager by email only, on days 1/3/7; the receiver at the door, who knows first, is never in the loop.
- A post-count re-match that replaces an earlier run sends no new notification (`matchInvoice.ts:189-190`), so the corrected ₪ shows only in the approvals queue.
