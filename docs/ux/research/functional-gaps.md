# Functional gap analysis: RestoMatch vs the newest ERP, ordering and AP products

> **תקציר לבעלים (עברית)**
> - בדקנו את הזרימות בקוד (הזמנה → קבלה בדלת → חשבונית → אישור → תשלום → זיכוי) מול המערכות החדשות ביותר:
>   Choco, Rekki, Supy, MarketMan, Restaurant365, Toast xtraCHEF, Ottimate, Ramp, Zip, Odoo, Rillet, Apicbase, meez.
> - **39 פערים פונקציונליים.** הבעיה המרכזית בנייד: היום רק בעלים/מנהל יכולים להזמין, ההזמנה בנויה מחיפוש ולא
>   מ"רשימת הזמנה קבועה", ומשלוח בלי הזמנה לא נקלט מדף הקבלה. בגלל זה חלק גדול מהרכש לא מקבל הזמנה וקבלה,
>   וההתאמה המשולשת לא רואה אותו. כלומר הדליפה שם לא נמדדת.
> - הבעיה המרכזית במחשב: אישורים אחד-אחד בלי פעולה מרוכזת או מקלדת, אין תיבת משימות אחת, אין תשלום לפי תאריך
>   פירעון, ואין התאמה לכרטסת של הספק. בעלי רשת צריכים להחליף סניף כדי לבצע פעולה.
> - ההתראות לצוות יוצאות היום רק במייל. Push ממומש כ-mock. **פער P0.**
> - 10 פערי P0: רשימת הזמנה, טיוטה מהצוות שמנהל שולח, קבלה בלי הזמנה, קבלה מול ההזמנה (צילום החשבונית במקביל,
>   לא כתנאי), חריגה עם תמונה וסיבה, Push אמיתי, מסך "היום" לפי תפקיד, אישור מרוכז במקלדת, שליחת דרישת זיכוי לספק
>   מתוך המערכת, ומסך ספק לאישור או דחייה של הדרישה.

**Date:** 2026-10-25 · **Scope:** functional (features and flows), not visuals · **Repo:** `/home/user/restomatch`

## 0. Method and evidence levels

- **[Code]**: read in this repo. Paths are repo-relative, with line numbers where they help.
- **[Web]**: a vendor help page or listing, cited inline (vendor claims are marked as such). Many citations are reused
  from the sibling benchmark files in this folder (`ordering-mobile.md`, `erp-modern.md`), plus searches run for this file.
- **[Research]**: the repo's own Hebrew strategy research,
  `docs/research/ניהול חשבוניות ספקים במסעדות/` (report + `notes/*.md`).
- **[Est]**: a sizing estimate. It is not measured. ICP spend band: **₪80k–₪400k food purchases a month**
  (`docs/ICP.md` §1). North-Star leak target: **1.5%** of that, so **₪1,200–₪6,000 a month**.

**The ₪ lens for every ordering and receiving gap.** RestoMatch's leak engine can only see what is in a three-way
match (PO ↔ goods receipt ↔ invoice). [Research]: in Israel the order often goes by phone or a WhatsApp voice note.
When it does, there is no PO, the match runs on two documents, and quantity-short leak is invisible. So an ordering or
receiving feature that **raises PO and GR coverage of spend** directly manufactures the ₪ number.
**[Est]:** each extra 10 percentage points of spend under PO+GR at ₪150k/month is about **₪225/month** more leak that
can be detected. This is the argument for the ICP veto below (§3).

## 1. Who works where (the device split this analysis optimises for)

| Role (`apps/web/lib/roles.ts`) | Main device | Jobs that must be fast | Today's access |
|---|---|---|---|
| `receiver` (door / shift manager) | Phone, often a shared tablet | Today's deliveries, count against the order, exceptions with evidence, delivery note photo | `/dashboard`, `/dashboard/receiving`, `/dashboard/invoices`, ledger (roles.ts:45) |
| `chef` | Phone in the walk-in | Draft orders before cut-off, count, waste, recipes | Recipes and inventory only. **Cannot see orders** (roles.ts:70, 77) |
| `manager` (floor / ops) | Phone, with desktop sometimes | Send orders, approve, chase late deliveries | Most routes |
| `owner` | Desktop for the monthly view; phone for approvals | ₪ hero, T2 act-now items, approve big items, chain | Everything; chain is owner-only |
| `bookkeeper` | Desktop | Verify invoices, link consolidated invoices, pay run, VAT, exports, close | Finance routes, no orders |

## 2. Gap list (39)

Priority: **P0** = it raises PO/GR coverage or recovery rate directly, or unblocks mobile-first work.
**P1** = a large efficiency or ₪ gain for bosses. **P2** = later.
Effort: **S** = about 1 session, **M** = 2–4 sessions, **L** = 5 or more sessions.
🔒 = touches the AGENTS.md immutability list, so it needs a human-authored PR. ⚖️ = needs an `icp-keeper` scope review.

### A. Ordering (mobile: chef, manager)

**FG-01 · Order guide per supplier ("order from a guide, not from search")** · mobile · **P0** · M
- *Today [Code]:* `apps/web/app/dashboard/orders/new/wizard.tsx` is a 4-step wizard (SUPPLIER → BUILD → REVIEW → SENT).
  BUILD is a catalog **search** that browses 8 items (L101–104) and adds one line per tap at qty 1 (L344–362).
  Quantity, unit and price are typed into free inputs (L443–480). Nothing is remembered between orders.
- *Best in class [Web]:*
  - Choco: digital order guides by category, "three taps" per order (vendor claim) ([choco.com/uk/restaurants](https://choco.com/uk/restaurants)).
  - xtraCHEF: Order Guides list a vendor's items with **your normal quantity** ([Toast support](https://support.toasttab.com)).
  - BlueCart: per-vendor guides with preferred quantities.
  - Rekki: "check the latest prices on your order guide" ([Xero app listing](https://apps.xero.com/uk/app/rekki)).
- *Proposal:*
  - Build a per-supplier guide automatically from the last 8 weeks of PO and invoice lines. A helper already exists:
    `recentlyBoughtProducts`, `packages/api/src/inventory/data.ts:122`.
  - Sort it by category or shelf, with an inline stepper on each row.
  - Pre-fill the "usual qty" and the last price or contract price. Contract prices already exist:
    `packages/api/src/contracts/orderPrices.ts`.
  - The manager can pin or unpin items.
- *Value [Est]:* an order drops from about 25+ taps of search and typing to about 5–8 taps. Each order placed in the app
  is a PO the match can use (see the ₪ lens).

**FG-02 · Anyone drafts, a manager sends (team order / requisition)** · both · **P0** · M
- *Today [Code]:*
  - `/dashboard/orders` is owner + manager only (`apps/web/lib/roles.ts:70`).
  - `orders.createDraft`, `placeOrder` and `captureFromText` are `managerProcedure` (`packages/api/src/routers/orders.ts:447, 734, 868`).
  - The chef, who usually knows what is missing, cannot even propose an order. So the order happens off-system, by phone.
- *Best in class [Web]:*
  - Choco Team Order: contributors edit and save "for review"; admin/staff submit ([help.choco.com 8381272](https://help.choco.com)).
  - Ramp Procurement: an intake request goes through an approval policy before it becomes a PO ([support.ramp.com](https://support.ramp.com/how-to-submit-procurement-requests/)).
  - Supy: branch-level approvals and 200+ permissions [Research].
- *Proposal:*
  - Add a "requester" capability for `chef` and `receiver`: create and edit a draft, but never send it.
  - The manager gets a push like "השף ביקש 14 פריטים מ-X (₪1,240)" with one-tap **Send** or **Edit**.
  - New procedures each get a COVERAGE entry in `cross-tenant.attack.test.ts` (adding entries is allowed).
- *Value:* moves the chef's phone order into a PO, so more spend is matched. It also gives one accountable sender.

**FG-03 · "Order again", standing orders, and top-up until the cut-off** · mobile · **P1** · S ⚖️ 🔒(schema for standing orders)
- *Today [Code]:* there is no clone or repeat action anywhere in `packages/api/src/routers/orders.ts` or
  `apps/web/app/dashboard/orders/**`. Every order is built from zero.
- *Best in class [Web]:*
  - Choco: "Order again" from a past order, with **replace or combine** when the cart has items ([help.choco.com 6572394](https://help.choco.com)).
  - Ordermentum: a **Scheduled** tab for standing weekly orders, and **Top Up Orders** onto the same delivery day.
  - Sysco Shop: edit until the cut-off.
- *Proposal:*
  - Add **Order again** on the PO detail page (`orders/[poId]/detail-client.tsx`).
  - Standing orders are auto-drafted at cut-off minus N hours, for the manager to confirm. They are never auto-sent.
  - Allow a top-up before the cut-off that merges into the open PO (re-send the document with a diff).
  - `docs/ICP.md` §5 rates recurring orders "later". The argument for moving it up is PO coverage.
- *Value:* for repeat suppliers (dairy, bread, produce) the order takes 2 taps and is always a PO.

**FG-04 · One ordering session across all suppliers due today** · mobile · **P1** · M
- *Today [Code]:* the wizard is single-supplier. Choosing a supplier resets the lines (`wizard.tsx` L265–270). To order
  from 5 suppliers, the manager runs the wizard 5 times.
- *Best in class [Web]:*
  - R365 App: **single- and multi-vendor** POs from the phone ([docs.restaurant365.com](https://docs.restaurant365.com/docs/orders-mobile)).
  - Choco: one app for all distributors.
  - xtraCHEF needs one order per vendor (the weaker pattern).
- *Proposal:* an "הזמנות היום" screen.
  - List the suppliers whose cut-off is today, sorted by cut-off. Cadence data already exists:
    `previewDelivery`, `packages/api/src/lib/deriveDelivery.ts`.
  - One cart that splits itself into per-supplier POs on **Send all**.
- *Value:* saves the manager about 10–15 min a day [Est], and makes it less likely a supplier gets forgotten. A forgotten
  supplier means a phone order, which means no PO.

**FG-05 · Cut-off countdown and timed reminders** · mobile · **P1** · S (UI) + M (channel, see FG-19) 🔒
- *Today [Code]:*
  - The wizard shows `missedCutoff` after the fact (`wizard.tsx` L741).
  - `apps/worker/src/jobs/orderReminders.ts` sends an **email** `orderNotPlacedEmail`.
- *Best in class [Web]:*
  - Rekki: each supplier profile shows its cut-off.
  - Ordermentum: **per-supplier** push and email reminders before the cut-off.
  - US Foods MOXē: cut-off alerts.
- *Proposal:*
  - A countdown chip per supplier on the ordering home.
  - Push at T-60 and T-15 min that deep-links into that supplier's guide (FG-01).
  - Changing the reminder schedule touches `apps/worker/src/cron.ts` 🔒.
- *Value:* fewer missed cut-offs, so fewer emergency phone orders (no PO) and fewer premium-price top-ups.

**FG-06 · Par / min levels and "fill to par" from the last count** · mobile · **P2** · M ⚖️ 🔒(schema)
- *Today [Code]:* the count exists (`apps/web/app/dashboard/inventory/count/count-screen.tsx`, router
  `packages/api/src/routers/inventory.ts`). It is not connected to ordering, and there is no par field
  (`par_level` appears nowhere in the repo).
- *Best in class [Web]:*
  - R365 App: **Autofill to Par** = Par − On Hand, with In Transit / Last Order / Last 4 Avg per item.
  - Supy: Fill to PAR, plus AI predictive ordering from a 14-day POS forecast ([supy.io](https://supy.io/platform/restaurant-procurement-software/)).
  - MarketMan: "fill to par with one click" ([marketman.com](https://MarketMan.com/platform/restaurant-purchasing-software-and-order-management)).
- *Proposal:*
  - Par per product per branch. Suggested qty = par − last count − in transit.
  - A one-tap fill inside the FG-01 guide.
  - Forecasting stays later; the POS import already exists (`integrations.posImport`).
- *ICP flag:* `docs/ICP.md` §5 puts par/forecast at the **Anti-ICP border** with an active veto. Present it only as
  "fuel for the PO". It needs `icp-keeper` sign-off.

**FG-07 · Order by voice or photo (handwritten sheet) on the phone** · mobile · **P2** · M
- *Today [Code]:* `orderCapture` (flag) accepts pasted WhatsApp **text** only, and only for owner/manager
  (`apps/web/app/dashboard/orders/capture/capture-client.tsx`, `packages/api/src/orders/captureOrder.ts`).
- *Best in class [Web]:*
  - Choco OrderAgent: voice, photo, handwritten notes and email become orders.
  - Choco VoiceAgent (Dec 2025): phone orders in any language.
  - Rekki Connect: AI reads email, voicemail, PDF and SMS orders.
- *Proposal:*
  - Hold-to-talk Hebrew dictation, or a photo of the paper order sheet.
  - It goes into the same `captureOrderDraft` pipeline and creates a draft PO, which the manager confirms.
- *Value:* captures the "order by voice note" habit that [Research] says creates PO-less spend.

**FG-08 · Supplier confirmation updates the expectation; order status timeline; substitutions** · mobile · **P1** · M
- *Today [Code]:*
  - The `supplierConfirm` portal (`packages/api/src/supplierConfirm/service.ts`) records `confirmed` / `changes`, but
    **"The purchase order is never written"** (L35).
  - So receiving still expects the original quantities after the supplier said "only 6 of 10". The dock then flags a
    shortage everyone already knew about, and a substitution has no line type.
- *Best in class [Web]:*
  - Rekki: a message receipt ("I know the supplier received my order at a specific time").
  - Sysco: substitutes with case counts on the delivery summary (May 2026).
  - Choco: delivery confirmation.
  - Ramp: "Waiting for match" / receiving states on the bill.
- *Proposal:*
  - A timeline: sent → seen → confirmed (with a line diff) → out for delivery → received / partial.
  - Accepting a supplier change creates a **revised expectation** for receiving. Keep the original for the audit.
  - A priced substitution line type.
- *Value:* fewer false QTY_SHORT alarms (T4 calm). A real shortage stays a claim.

**FG-09 · Spend control before the order is committed: PO approval threshold and weekly budget** · both · **P1** · M 🔒(if `approvals/engine.ts` changes)
- *Today [Code]:*
  - Approvals act **after** the invoice, on discrepancies (`packages/api/src/approvals/engine.ts`, thresholds via
    `restaurants.settings.approvalThresholds`).
  - Before the PO there is only the price guardrail (median/P90, `orders.guardrail`, `orders.ts:1066`).
  - There is no budget and no PO approval.
- *Best in class [Web]:*
  - Supy: branch-level approvals and budgets [Research].
  - MarketMan: budgets and price limits.
  - Ramp and Zip: conditional approval chains on amount, vendor and category, with a "who's next" view ([support.ramp.com](https://support.ramp.com/hc/en-us/articles/37424276359443-Get-started-with-Procurement)).
- *Proposal:*
  - A weekly food budget per branch and category (₪, or % of the imported POS sales).
  - A budget bar on the order review.
  - A PO over the threshold or over budget goes to the owner, as a push (FG-19), before it is sent.
  - Keep it in a new PO-policy module so the immutable discrepancy engine stays untouched.
- *Value:* stops over-ordering and waste up front. It also gives the owner a "control" story beyond leak.

**FG-10 · A cheaper-supplier hint and a mini-RFQ at order time** · both · **P2** · M ⚖️
- *Today [Code]:*
  - The guardrail compares the price with this supplier's own history.
  - The chain price disparity compares **branches** only (`packages/charts/src/chain-disparity.ts`).
  - The product page has a "cheapest supplier" view, but the wizard never shows it.
- *Best in class [Web]:*
  - Ramp Price Intelligence: SKU-level benchmarks (with a caveat that data may be incomplete).
  - Zip: intake agents compare the price to historical benchmarks.
- *Proposal:*
  - In REVIEW, show "same item at supplier Y: ₪-X/unit (last invoice date)".
  - For large items, send a 2–3 supplier quote request through the existing token portal pattern.
- *Value [Est]:* 2–5% on the top 20 SKUs. Gate it behind ICP review; `docs/ICP.md` §5 locks `product_group_id` as "later".

### B. Receiving at the back door (mobile: receiver)

**FG-11 · Receive a delivery that has no PO, from the receiving screen** · mobile · **P0** · M
- *Today [Code]:*
  - `receiving.todayExpectations` lists only POs with status sent/confirmed/partial for today, or undated recent ones
    (`packages/api/src/routers/receiving.ts:80–130`).
  - The receiving page has no "a supplier arrived without an order" path (`apps/web/app/dashboard/receiving/page.tsx`).
  - The only way such a delivery gets in is the WhatsApp/email invoice inbox, after the fact.
- *Best in class [Web]:*
  - Galley: **ad-hoc receiving** for purchases with no PO ([support.galleysolutions.com](https://support.galleysolutions.com)).
  - Odoo Barcode: create a receipt on the spot and scan to add lines.
  - Choco: Delivery Check.
- *Proposal:*
  - A button "ספק הגיע בלי הזמנה": pick the supplier (or detect it from the delivery-note photo).
  - Count from that supplier's guide (FG-01), create a GR, and auto-create a **retro PO draft** marked `source='walk_in'`.
  - The invoice then matches against a real GR.
- *Value [Est]:* if 30–50% of deliveries arrive PO-less (unmeasured; [Research]), this is the single biggest lift in
  matched spend. At ₪150k/month that is up to ₪675–₪1,125/month of leak that can now be detected.

**FG-12 · Count against the order first; the invoice photo is parallel evidence, not the gate** · mobile · **P0** · M
- *Today [Code]:*
  - The wizard always starts with `SCAN_INVOICE` → `PROCESSING` (OCR poll; "still reading" after 30 s) →
    `RECONCILIATION_REVIEW` → `ADJUST_QUANTITIES` (`apps/web/app/dashboard/receiving/[poId]/wizard.tsx` L70–84, L39–40).
  - The driver waits for OCR, and the receiver is anchored on the invoice's numbers. Backlog item #27 was
    "auto-match before count".
- *Best in class [Web]:*
  - Choco Delivery Check: check each line against the order; ✓ received, ✗ opens an issue.
  - Supy: **Receive Order** creates a GRN from the PO, with photos as "supporting media".
  - Galley: per line, "Receive outstanding / Receive modified / No longer expected".
- *Proposal:*
  - Default = PO lines pre-filled with the expected values, and the receiver touches only exceptions (P12 in `ordering-mobile.md`).
  - The delivery-note or invoice photo is taken any time, and OCR reconciles in the background into the match.
  - Optional **blind count** per supplier (expected qty hidden) for high-risk suppliers.
- *Value:* the driver leaves sooner, and the GR records what was really counted. That is the only legal proof of a
  shortage [Research: the delivery note is the sole real-time document].

**FG-13 · A per-line exception sheet: reason, qty and photo in 4 taps or fewer** · mobile · **P0** · S
- *Today [Code]:*
  - `receiving.markGrLine` already accepts `photos[]` and `conditionNotes` (`packages/api/src/routers/receiving.ts:769–796`).
  - The UI step only offers a ±1 stepper and rejected/damaged toggles. There is **no photo or reason capture**
    (`apps/web/app/showcase/receiver/_steps/AdjustQuantities.tsx` L195–285).
- *Best in class [Web]:*
  - Choco: ✗ → issue type (missing / wrong qty / defective / other) + comment + **photo** → "Request for Supplier"
    (credit note / replacement).
  - Supy: mark the GRN **Disputed** → Resolve Dispute.
- *Proposal:*
  - A bottom sheet with reason chips, qty and a camera.
  - The evidence auto-attaches to the dock slip (`receiving/[poId]/dock-slip.tsx`) and to the claim (FG-32).
- *Value:* evidence is what turns a finding into a credit. It raises the claim win rate, which is ₪ back
  ("₪ recovered / ₪ found", [Research]).

**FG-14 · Weight keypad and catch-weight tolerance** · mobile · **P1** · M 🔒(`packages/matching/src/tolerances.ts`, `units.ts`)
- *Today [Code]:* quantities are adjusted with an integer stepper (`AdjustQuantities.tsx` `incrementQty(±1)`). There is
  no 3-decimal kg entry and no per-product weight tolerance.
- *Best in class [Web]:*
  - HotSchedules/Adaco: weight to 3 decimals, with a confirm when it differs from the order.
  - Odoo catch-weight: out-of-tolerance is rejected at the dock.
  - [Research] lists catch-weight variance as **unfilled by every restaurant tool**.
- *Proposal:*
  - Unit-aware control: a keypad for kg/L and a stepper for units and cases.
  - A per-product tolerance. A short weight produces QTY_SHORT with ₪.
  - The tolerance math is immutable, so it needs a human PR.
- *Value:* meat, fish and produce are the highest ₪-per-unit lines. A 3–5% shortfall there is the classic silent leak.

**FG-15 · Deliveries board: late, overdue, arrived and back-ordered** · mobile · **P1** · S
- *Today [Code]:* the inbox shows only today's window (`todayExpectations`). A PO expected yesterday that never arrived
  drops off the board. Lateness only goes out as an email (`apps/worker/src/jobs/supplierDelays.ts`).
- *Best in class [Web]:*
  - US Foods MOXē: Delivery Tracker plus a "30 minutes away" alert.
  - Sysco: today's delivery status on login.
  - Galley: a Receiving page by date.
- *Proposal:*
  - Groups: **Late** (carried over until resolved), **Expected now**, **Arrived/partial**, **Back-ordered lines**.
  - A one-tap "לא הגיע — עדכן מנהל" action.
- *Value:* a missed delivery gets noticed before service, and a back-order is not billed twice.

**FG-16 · Offline-first for every dock and walk-in action, with a pending count** · mobile · **P1** · M
- *Today [Code]:*
  - Offline queueing covers **invoice photos only** (`apps/web/lib/pwa/offlineQueue.ts`) and count lines in
    localStorage (`count-screen.tsx` L22–38).
  - GR line marks, `submitReceipt` and order drafts need the network. Walk-ins and back doors are dead zones.
- *Best in class [Web]:*
  - Sysco Shop: place orders offline.
  - MarketMan: claims offline sync.
  - WISK: shows the number of unsynced operations.
  - Supy: warns about counts that "look finished but never reached the server".
- *Proposal:*
  - An IndexedDB outbox for GR marks, receipt submits, count saves and drafts, with idempotency keys (lessons from
    M7/M8 double-tap).
  - A visible "N ממתינים לסנכרון" chip.
- *Value:* no lost receipts. A lost GR is a lost shortage claim.

**FG-17 · Optional barcode scan (never required)** · mobile · **P2** · M
- *Today [Code]:* the barcode is only a stored catalog field (`packages/catalog/src/*`, `packages/api/src/catalog/parse.ts`).
  No scanner exists in any flow.
- *Best in class [Web]:*
  - R365 App: add items by barcode scan (May 2024).
  - Odoo Barcode: receipts with scan-to-add and a short-qty pop-up.
  - Supy: mobile counts with barcode.
- *Proposal:* a camera scanner (BarcodeDetector API with a ZXing fallback) in the guide, receiving and count, to jump
  to the line.
- *Value:* faster counts for packaged and dry goods. Lower priority, because Israeli produce and meat rarely carry GS1
  codes [Est].

**FG-18 · Shared kitchen tablet with a personal PIN switch** · mobile · **P1** · M 🔒(schema; tenant-security-warden review)
- *Today [Code]:*
  - Login is password + TOTP, or a magic link (`apps/web/app/login/page.tsx`).
  - The offline queue is keyed by user "for shared tablets" (`wizard.tsx` L97), but switching users means a full
    log-out and log-in.
- *Best in class:* the POS staff-passcode pattern that Israeli kitchens already use (Toast, Tabit).
- *Proposal:*
  - A device bound to one branch.
  - A 4–6 digit personal PIN for receiver and chef, auto-lock after N minutes, and per-person audit.
  - Owner and bookkeeper keep 2FA.
- *Value:* staff actually use the shared device, and every GR has a named person (accountability for disputes).

### C. Notifications and the role home

**FG-19 · Real push (installed PWA) and WhatsApp templates, with actionable deep links (including owner approve-from-phone)** · both · **P0** · M 🔒(`packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts`)
- *Today [Code]:*
  - The push channel is `MockPushNotifier`: it writes to the outbox and logs (`packages/api/src/notifications/push.ts`).
  - Staff alerts are **email** templates: `approvalNeededEmail`, `orderNotPlacedEmail`, `supplierDelayEmail`
    (`notifications/templates.ts`).
  - WhatsApp exists (`whatsappCloud.ts`), but Resend is in sandbox (`STATE.md`).
  - A receiver at the door does not read email.
- *Best in class [Web]:*
  - Ramp: approvals in the Inbox are the same on mobile; Slack DM, then reminders on day 2 and day 3.
  - R365 Red App: approves AP invoices **and payment runs** on mobile.
  - Ordermentum: push order reminders.
  - Tipalti: approvers act by email without logging in.
- *Proposal:*
  - VAPID Web Push for the installed PWA (`public/pwa/manifest.webmanifest` already exists). Subscriptions are per
    role and per event.
  - Each push deep-links to the exact task.
  - The owner gets "₪3,400 ממתין לאישור — אשר / פתח" with an inline approve.
  - WhatsApp template fallback once the credentials exist (Phase 6, human).
- *Value:* time-to-action drops from hours to minutes. This is the precondition for FG-02, FG-05, FG-09 and FG-24.

**FG-20 · A role-based "Today" home instead of one leak dashboard for every role** · both · **P0** · M
- *Today [Code]:*
  - `apps/web/app/dashboard/page.tsx` renders the same leak hero, KPIs and activity feed for every role.
  - The mobile bottom bar is just "the role's first four visible destinations" (`apps/web/app/dashboard/nav.tsx` L269–277).
  - A receiver lands on a ₪ chart, not on "2 deliveries due, 1 late".
- *Best in class [Web]:*
  - Apicbase mobile home tiles: **Count, Waste, Receive Order**.
  - Sysco: today's deliveries on login.
  - Ramp: Inbox of my tasks.
- *Proposal:* a per-role "עכשיו" list.
  - Receiver: deliveries due or late.
  - Chef: cut-offs, count due, requests.
  - Manager: orders to send, approvals.
  - Bookkeeper: invoices to verify, links pending, pay run.
  - Owner: ₪ hero (T1) + T2 act-now items.
- *Value:* every role opens to its next action. Adoption by door staff is what feeds the GR.

**FG-21 · One action inbox with counts and a notification centre (desktop)** · desktop · **P1** · M
- *Today [Code]:*
  - Only the contracts nav entry has a count badge (`nav.tsx` `NavBadge`, L155–157).
  - Approvals, the invoice inbox, overdue claims, VAT at risk and late deliveries each live on their own page with no counts.
- *Best in class [Web]:* Ramp Inbox (Bills / Receipts tabs; release payments from the Inbox); R365 AP Center.
- *Proposal:*
  - One inbox that aggregates every T2 item, with ₪ and age, plus assign, snooze and done.
  - Counts on the nav items.
- *Value:* the owner and bookkeeper clear the day in one place instead of visiting 6 pages.

### D. AP, approvals and payment (desktop: bookkeeper, owner)

**FG-22 · Bulk and keyboard approvals, prev/next, and an invoice-level decision** · desktop · **P0** · S
- *Today [Code]:*
  - `apps/web/app/dashboard/approvals/list.tsx` approves, rejects or escalates **one discrepancy at a time**
    (L81–83, L215–267), 50 per page with "load more".
  - There is no multi-select, no keyboard, and no "approve this invoice's 7 lines".
- *Best in class [Web]:*
  - R365: bulk approve/deny on desktop.
  - Ramp: Ctrl-A approve for card transactions; users ask for prev/next in Bill Pay.
  - Brex: auto-approves in-policy items, so managers see only flagged ones.
- *Proposal:*
  - Multi-select by supplier or invoice. "Approve all info-severity".
  - Keys `j/k/a/r/e`, a right-hand review pane, and an invoice-level decision that resolves its lines.
- *Value [Est]:* a month-end queue of about 150 items drops from about 45 min to about 10 min for the bookkeeper.

**FG-23 · An approval recommendation with its evidence** · both · **P1** · M
- *Today [Code]:* `WhyFlagged` explains the rule that fired (`approvals/list.tsx` L301). There is no recommendation
  and no history.
- *Best in class [Web]:*
  - Ramp Policy Agent: "Approval recommended / Requires review / Rejection recommended" with the rule shown, a summary
    of vendor history and contracts, and a 90% acceptance rate (vendor claim).
  - Zip: intake agents check prices against benchmarks.
- *Proposal:*
  - Per item, recommend **claim / accept / waive**.
  - Show the evidence: the last 5 prices, the contract price, the dock note and photo, and past decisions on the same SKU.
  - One-click accept. It is suggest-only.
- *Value:* faster and more consistent decisions, and fewer "approved by fatigue" claims that are lost.

**FG-24 · Ageing, reminders, delegation and an escalation path** · both · **P1** · S 🔒(cron/outbox for reminders)
- *Today [Code]:*
  - `approvals.escalate` exists (`packages/api/src/routers/approvals.ts:242`).
  - `approvalNeededEmail` goes out once, from `apps/worker/src/jobs/matchInvoice.ts`.
  - There is no ageing, no reminder, and no out-of-office delegate.
- *Best in class [Web]:* Ramp shows who is next, sends reminders on day 2 and day 3, and lets admins skip a step;
  Navan lets you switch the approver.
- *Proposal:*
  - Ageing chips (₪ × days waiting).
  - Reminders.
  - "האצל למנהל עד…" (delegate to the manager until a date).
  - Items blocking payment are surfaced on the pay run.
- *Value:* nothing gets paid by default because nobody decided.

**FG-25 · A split-view verification queue for the bookkeeper, with field confidence and learned corrections** · desktop · **P1** · M
- *Today [Code]:*
  - The invoice page stacks the header, `ConsolidatedPanel` and `InvoiceCorrection`
    (`apps/web/app/dashboard/invoices/[invoiceId]/page.tsx`).
  - The ingest inbox approves or rejects documents one by one (`apps/web/app/dashboard/inbox/inbox-client.tsx` L120–121).
  - There is no queue mode, no image-beside-fields view, and no confidence highlighting.
- *Best in class [Web]:*
  - Odoo: the document preview sits on the right of the bill form; Odoo 19 adds "Reload AI Data".
  - Ramp Smart OCR: per-vendor custom instructions that learn from corrections.
  - MarginEdge: human review [Research].
- *Proposal:*
  - Queue mode: the image on the left, fields on the right.
  - Low-confidence fields are highlighted. Enter = confirm and next.
  - Per-supplier corrections are remembered (unit aliases, SKU mapping).
- *Value:* for Hebrew and handwritten documents [Research: no benchmark exists], the human-in-the-loop is mandatory. It
  needs to be fast.

**FG-26 · Pay run by due date that nets claims, with a bank file, mark-paid and a cash forecast** · desktop · **P1** · M 🔒(schema if new columns)
- *Today [Code]:*
  - `packages/api/src/routers/payRun.ts` (L1–20) groups **the month's** not-paid invoices by supplier into pay / hold / claim.
  - It says "the app has no payment rail". The export is CSV only (`approvals/pay-run/export-button.tsx`).
  - `suppliers.paymentTerms` is free text, and `invoices.due_date` exists in `packages/db/src/schema.ts:813` but the
    pay run does not use it.
- *Best in class [Web]:*
  - Ramp Bill Pay states: Scheduled → Ready for payment → Initiated; release from the Inbox.
  - R365: payment runs approved on mobile.
  - Ottimate VendorPay.
- *Proposal:*
  - Parse the terms (שוטף+30/60/90) into a due date, and build the pay run by week.
  - "Pay ₪X − ₪Y claimed" netting.
  - A bank batch file (Masav or bank CSV), mark-paid with a date, and a 13-week supplier cash forecast.
  - In-app payment comes later, with a licensed initiator ([Research]: the ISA payment-initiation timeline points to Dec 2026).
- *Value:* no early payment of disputed amounts, so the money stays in hand while claims are open. It also enforces
  `חוק מוסר תשלומים` (the 2017 supplier-payment law) compliance [Research].

**FG-27 · Upload and reconcile the supplier's own statement (כרטסת ספק)** · desktop · **P1** · M
- *Today [Code]:* there is an **internal** ledger and delivery-note coverage (`packages/api/src/ledger/coverage.ts`,
  `apps/web/app/dashboard/suppliers/ledger/page.tsx`). There is no import of the **supplier's** statement to compare against.
- *Best in class [Web/Research]:*
  - MarginEdge: a statement tool that flags "credit missing from statement".
  - Ottimate Copilot: statement reconciliation (Summer 2026).
  - Yooz, Oversight and SAP ship statement reconciliation.
- *Proposal:*
  - Upload the PDF or Excel, OCR it, and match it to our invoices, credit notes and payments.
  - Flags: billed but not received, credit promised but missing, payment unapplied, and an invoice we never got.
- *Value:* it catches the "promised credit never issued" leak and duplicate billing across months. This is the
  bookkeeper's monthly pain [Research: כרטסת matching by hand].

**FG-28 · A workflow that chases allocation numbers (מספר הקצאה)** · both · **P1** · S
- *Today [Code]:* `owner.vatAtRisk` and `vat-at-risk.tsx` flag invoices of ₪5,000 or more with no allocation number
  (`packages/api/src/vat/vatAtRisk.ts`). Flagging is where it stops.
- *Best in class [Web]:* the ITA verification service for authorised businesses; Priority's SOP for allocation numbers.
  [Research]: no restaurant tool knows the allocation number.
- *Proposal:*
  - One tap: "בקש מספר הקצאה מהספק" via a WhatsApp or email template.
  - Track the request until a corrected invoice arrives, and block it in the pay run until then.
  - ITA verification comes later, with credentials.
- *Value:* 18% input VAT per affected invoice (₪900+ on a ₪5,000 invoice). This ₪ amount is certain.

**FG-29 · Direct accounting posting and GL auto-coding** · desktop · **P2** · L (credentials = Phase 6, human)
- *Today [Code]:*
  - File exports in Hashavshevet, Priority and Rivhit formats (`packages/api/src/routers/integrations.ts:234`,
    `apps/web/app/dashboard/exports/accounting-files.tsx`).
  - A manual account-code mapping (`integrations/accounting-mapping.tsx`).
- *Best in class [Web]:*
  - Ottimate: line-item GL coding and ERP sync.
  - Ramp AP agents: auto-code lines ("85% right the first time", vendor claim).
  - Rekki: sends invoices to Xero with the file attached.
- *Proposal:*
  - A per-supplier and per-category default GL, plus AI suggestions.
  - A scheduled push to Priority REST, Hashavshevet or Rivhit with the image and allocation number, and a sync status
    on each invoice.
- *Value:* removes double entry by the bookkeeper. It is a retention moat.

**FG-30 · Fraud check when a supplier's bank details change** · desktop · **P2** · S 🔒(schema)
- *Today [Code]:* duplicate detection exists (`packages/api/src/lib/invoiceDedupe.ts`, `DUPLICATE_INVOICE`). The
  supplier record has no bank details and nothing alerts on a change.
- *Best in class [Web]:* Ramp AP agents screen 63 data points, including **new or changed bank details**, before a
  bill is created. [Research]: BEC and vendor impersonation are the dominant attack vectors.
- *Proposal:*
  - Keep the bank details from the invoice or supplier form.
  - On a change, create a callback-verification task that blocks the next pay-run line.
- *Value:* one prevented BEC payment is worth more than a year of subscription.

### E. Suppliers, claims and recovery

**FG-31 · Send the claim from the app, with a supplier claim portal and an automatic chase** · both · **P0** · M 🔒(outbox for sends and reminders)
- *Today [Code]:*
  - Claim letters are **printed** (`apps/web/app/dashboard/leaks/claims/page.tsx` + `print-button.tsx`).
  - Recovery status moves by hand (`packages/api/src/recovery/lifecycle.ts`).
  - Overdue reminders go to the **restaurant**, not the supplier (`packages/api/src/recovery/reminders.ts`).
  - The tokened supplier portal (`apps/web/app/s/[token]/page.tsx`) only handles order confirmation.
- *Best in class [Web/Research]:*
  - Choco: "Request for Supplier" (credit note / replacement) sent from the delivery check.
  - SAP Joule Dispute Resolution Agent (beta).
  - [Research]: **no shipped restaurant product chases credits through to money back**. This is the leapfrog.
- *Proposal:*
  - Send the claim by WhatsApp or email with a 72h token link that reuses the `supplierConfirm` token model.
  - The supplier **accepts or disputes per line** and uploads the credit note. The status moves automatically
    (claimed → acknowledged → credited).
  - A chase cadence on day 3, 7 and 14, approved by a human.
- *Value:* this is the metric [Research] says nobody publishes: ₪ recovered / ₪ found. **[Est]:** moving the recovery
  rate from about 10% (an industry anecdote in [Research]) to 50% on ₪3,000/month of found leak is about ₪1,200/month back.

**FG-32 · A supplier scorecard with delivery KPIs** · desktop · **P2** · S (charts SQL is owned by `matching-engine-guardian`)
- *Today [Code]:* `SupplierScorecard` = `matchRunsCount, cleanMatchPct, avgPriceDeltaPct, duplicateInvoicesCount, trend`
  (`packages/charts/src/suppliers.ts` L19–29).
- *Best in class [Web]:* Choco's Deliveries report compares delivery checks across locations; Ramp Price Intelligence
  adds renewal and price context.
- *Proposal:* add fill rate, on-time %, short-delivery ₪, price vs contract, days-to-credit and claim win rate, and
  export them as a renegotiation pack.
- *Value:* turns leak data into negotiating power at the annual price talk.

**FG-33 · A supplier-maintained price list with effective dates, through the portal** · both · **P2** · M ⚖️
- *Today [Code]:* the restaurant imports catalogs and contracts itself (`apps/web/app/dashboard/catalog/import/wizard.tsx`,
  `apps/web/app/dashboard/contracts/import/wizard.tsx`).
- *Best in class [Web]:* Choco and Rekki suppliers maintain their own catalogs; Zip has a vendor onboarding portal.
- *Proposal:*
  - The supplier proposes price changes with an effective date through the token portal.
  - The owner accepts or rejects. An accepted change updates the contract price, and the alert comes **before** the invoice.
- *Value:* "the price went up" stops being a surprise and becomes a negotiated decision.

### F. Inventory and food cost (mobile: chef)

**FG-34 · Waste log and transfers (branch ↔ branch, central kitchen)** · mobile · **P2** · M ⚖️ 🔒(schema)
- *Today [Code]:*
  - "Waste" exists only as a recipe yield % (`packages/api/src/recipes/cost.ts`, `recipe-editor.tsx`).
  - There is no waste log, and no transfer anywhere ("transfer" does not appear in the dashboard or API code).
- *Best in class [Web]:*
  - Apicbase: the mobile home tiles are Count, **Waste**, Receive.
  - Supy: traces every delivery, count, **transfer** and usage, and runs central-kitchen ordering ([supy.io](https://supy.io/product-features/central-kitchen-operations)).
- *Proposal:*
  - A 3-tap waste entry (item, qty, reason, photo).
  - A branch-to-branch transfer that moves the cost.
  - Both feed actual vs theoretical (`recipes.posVsTheory`).
- *Value:* explains the gap between actual and theoretical food cost, so it is not blamed on the supplier.

**FG-35 · Count templates, shelf order and counting in more than one unit** · mobile · **P2** · S
- *Today [Code]:*
  - `count-screen.tsx` groups lines by six fixed storage areas (`packages/api/src/inventory/valuation.ts:12`), with a
    per-line area select.
  - Each line has one unit, and there is no template.
- *Best in class [Web]:*
  - Sysco: custom list sequencing "to match shelf layout".
  - Supy: count templates.
  - R365: counts in more than one unit of measure.
- *Proposal:* a saved shelf order per area (drag once), templates (a weekly high-value count vs a monthly full count),
  and case + each entry.
- *Value:* a full count goes from about 90 to about 45 min [Est]. Weekly counts of high-value items become realistic.

### G. Owner desktop, chain and close

**FG-36 · Command palette, keyboard and master-detail workspaces organised by job** · desktop · **P1** · M
- *Today [Code]:*
  - The desktop nav is a row of about 20 tabs in 3 groups (`apps/web/app/dashboard/nav.tsx` L81–111).
  - Search (`apps/web/app/dashboard/search.tsx`) has no global hotkey, finds only supplier, product or invoice
    (`searchOptions.ts` L11), and has no actions.
  - Lists open the detail page as a full navigation.
- *Best in class [Web]:*
  - Odoo 17/18: a **Ctrl/Cmd+K** palette with `/` and `@` prefixes, and holding Ctrl/Alt reveals the shortcut on every
    control ([Odoo 18 docs](https://www.odoo.com/documentation/18.0)).
  - Rillet and Linear-style dense, keyboard-first ledgers.
- *Proposal:*
  - Cmd+K: navigate, "הזמנה חדשה ל-X", "חשבונית 4471", search by allocation number, switch branch, approve.
  - Regroup the nav by job (קנייה / קבלה / תשלום / החזרים / ניתוח).
  - Lists open a side detail pane, with j/k between rows.
- *Value:* the owner and bookkeeper navigate the month without hunting through tabs. This is the core of the owner's
  "organised far more efficiently" ask.

**FG-37 · Chain: act across branches without switching (queues, pay run, chain contracts, consolidated-invoice split)** · desktop · **P1** · L (tenant-security-warden review)
- *Today [Code]:*
  - `chain.overview`, `alerts` and price disparity are **read-only** (`packages/api/src/routers/chain.ts:330, 380`).
  - To act, the owner calls `switchTarget` (L415) for each branch. `docs/client-ready/chain-design.md`: "Every
    existing per-restaurant screen stays a per-branch screen."
- *Best in class [Web]:*
  - Ottimate: invoice line items **split across locations** with routing to the right approvers.
  - Choco groups: oversee orders and delivery checks across locations.
  - Supy: multi-site stock and approvals.
  - Rillet: multi-entity consolidation.
- *Proposal:*
  - Chain-scoped approval queue and pay run. Each action still runs inside its own branch's `withRestaurant` (the same
    trust boundary as `aggregateChain`).
  - Chain contract price lists pushed to branches.
  - Split one consolidated supplier invoice across branches.
- *Value:* for the 2–5 branch owner (plan `chain`) this changes "5 logins" into one queue. It is also where the chain
  plan earns its price.

**FG-38 · A month-close checklist and an accountant pack** · desktop · **P1** · M
- *Today [Code]:* the pieces exist on separate pages: the monthly report (`reports/monthly`), exports, the supplier
  ledger, VAT at risk and the consolidated proposal (`routers/consolidated.ts`).
- *Best in class [Web]:* Rillet's close checklist with owners, deadlines, dependencies and approvals ("day one is
  review, not rebuild"); Campfire drafts flux commentary.
- *Proposal:* a "סגירת חודש" page:
  - every delivery note invoiced
  - consolidated invoices linked
  - allocation numbers complete
  - claims open, with ₪
  - pay run approved
  - export sent
  - then one-click "חבילה לרו״ח" (accountant pack)
- *Value:* the bookkeeper closes in hours, and nothing un-invoiced or un-credited slips into next month.

**FG-39 · Agentic drafts (orders, claims, allocation requests, pay run), always approved by a human** · both · **P2** · M
- *Today [Code]:* `ask` has 4 **read-only** tools (`leak_hero, leak_report, leak_breakdown, claimable_lines`;
  `packages/api/src/ask/tools.ts` L179–203), for owner and manager only.
- *Best in class [Web]:*
  - Ramp procurement agents (Apr 2026) catch policy violations before the approver; Ramp AP agents.
  - Campfire: every agent action is logged and reviewable before it posts.
  - Choco runs order agents.
- *Proposal:*
  - The assistant **drafts**: an order from usual quantities, claim letters with evidence, allocation-number requests,
    and a pay-run proposal.
  - Every draft lands in the FG-21 inbox for one-tap approval. It never sends on its own.
- *Value:* turns "chat with the invoices" (2026 table stakes, [Research]) into ₪ actions.

## 3. Governance flags (AGENTS.md)

- **Immutable files touched by proposals (human-authored PR only):**
  - `packages/api/src/notifications/outbox.ts` and `apps/worker/src/cron.ts`: FG-05, FG-19, FG-24, FG-31.
  - `packages/db/src/schema.ts` (+ new migrations only): FG-03, FG-06, FG-14, FG-18, FG-26, FG-30, FG-34.
  - `packages/matching/src/tolerances.ts` / `units.ts`: FG-14.
  - `packages/api/src/approvals/engine.ts`: FG-09 and FG-24, **only if** the rules change. The proposal keeps a
    separate PO-policy and routing layer instead.
- **ICP scope review (`docs/ICP.md` §5 active veto):**
  - Par and forecast (FG-06), recurring orders (FG-03), cross-supplier price compare (FG-10, FG-33) and waste/transfer (FG-34).
  - The case to make in each review: "this raises PO/GR coverage, so it is fuel for the GR". It must not be framed as
    "become MarketMan".
  - The owner's 2026-10-25 direction asks for advanced ordering. That direction and the standing veto need an explicit
    `icp-keeper` decision.
- **New tRPC procedures** (FG-02, FG-11, FG-21, FG-31, FG-37) each add a COVERAGE entry and an isolation assertion in
  `packages/api/src/__tests__/cross-tenant.attack.test.ts`. Public token routes (FG-31, FG-33) need signature or
  secret checks, a rate limit, size limits and their own attack test (MASTER-PLAN §1.4).
- **Credentials** (WhatsApp templates, push VAPID keys, accounting APIs, ITA, bank files): Phase 6, human only.
  Build each one behind a provider interface with a stub.

## 4. Suggested order (dependency-aware)

1. **Mobile wedge, PO/GR coverage:** FG-19 push → FG-20 Today home → FG-01 guide → FG-02 team draft →
   FG-11 receive without a PO → FG-12 count-first → FG-13 exception sheet.
2. **Recovery loop:** FG-31 claim portal + chase → FG-27 statement reconciliation → FG-28 allocation chase.
3. **Boss desktop:** FG-22 bulk/keyboard → FG-21 inbox → FG-36 palette/IA → FG-26 pay run by due date → FG-38 close →
   FG-37 chain actions.
4. **Then:** FG-03/04/05/08/09/14/15/16/18/23/24/25, then the P2s.

## 5. What could not be verified

- MarketMan's exact order-approval mechanics (the platform page mentions only permissions, budgets and price limits).
- Choco's cut-off reminders in the app (help pages show "Order again" as web-only).
- Ramp approval by SMS (the docs list email and Slack).
- The R365 par/suggested-order docs are from 2024.
- The share of Israeli deliveries that arrive without a PO is **unmeasured** ([Research]). The pilot should measure it
  first, because it sizes FG-11.

## Sources

- [Code] paths cited inline (repo `/home/user/restomatch`).
- [Research] `docs/research/ניהול חשבוניות ספקים במסעדות/report.md`, `notes/global_restaurant_ap_vendors.md`,
  `notes/ap_ai_frontier.md`, `notes/israel_regulation_tax.md`.
- Sibling benchmark files (citations reused): `ordering-mobile.md` §2, `erp-modern.md` §3 in this folder.
- [MarketMan purchasing & order management](https://MarketMan.com/platform/restaurant-purchasing-software-and-order-management)
- [Supy procurement](https://supy.io/platform/restaurant-procurement-software/) · [Supy live stock](https://supy.io/product-features/live-stock-visibility) · [Supy central kitchen](https://supy.io/product-features/central-kitchen-operations)
- [Ramp: submit procurement requests](https://support.ramp.com/how-to-submit-procurement-requests/) · [Ramp: get started with Procurement](https://support.ramp.com/hc/en-us/articles/37424276359443-Get-started-with-Procurement)
- [Choco restaurants](https://choco.com/uk/restaurants) · [Choco restaurant groups](https://choco.com/us/restaurant-groups)
- [Rekki on Xero](https://apps.xero.com/uk/app/rekki) · [Rekki app](https://rekki.com/app)
- [R365 App orders](https://docs.restaurant365.com/docs/orders-mobile) · [R365 forecasting](https://restaurant365.com/enhanced-forecasting-experience)
- [Odoo 18 Barcode (Cybrosys)](https://www.cybrosys.com/odoo/odoo-books/v18/barcode/exploring-the-barcode-app-features/)
- [Rillet (Sacra)](https://sacra.com/c/rillet/) · [Rillet (GetApp)](https://www.getapp.com.au/software/2103794/rillet)
- [Decision Logic par ordering](https://decisionlogic.atlassian.net/wiki/spaces/CKB/pages/3019472900) · [HotSchedules par ordering](https://help.hotschedules.com/hc/en-us/articles/360055939952-Inventory-Restaurants-Par-Level-Ordering)
