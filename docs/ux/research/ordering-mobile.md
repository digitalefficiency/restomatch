# Mobile-first restaurant ordering and procurement: UX research for RestoMatch

**Researcher lens:** senior product and UX researcher, restaurant procurement and ordering apps
**Date:** 2026-10-25
**Owner direction this serves (2026-10-25):** benchmark the newest ordering and procurement systems. Most work happens on a **phone**: the receiver at the back door, the chef, the floor manager ordering. The bosses (owner, bookkeeper, multi-branch) work on a **desktop**, and that desktop must be organized much more efficiently. **Functionality comes first.**
**Products studied:** Choco (with Choco AI/OrderAgent and VoiceAgent), Rekki (with Rekki Connect), Ordermentum, BlueCart, Supy, Galley, Apicbase, MarketMan, Restaurant365 (R365 App), Toast xtraCHEF, meez. Four reference systems are added because they state a rule more precisely than the brief's list: US Foods MOXē (delivery tracking, "Did You Forget"), Sysco Shop (list sequencing, substitutes, offline ordering), MarginEdge (invoice photo capture), and the catch-weight docs of HotSchedules/Adaco, Infor and Odoo (weight entry at the dock).
**RestoMatch surfaces mapped:** new order wizard (`apps/web/app/dashboard/orders/new/wizard.tsx`), orders list (`dashboard/orders/*`), order detail plus supplier confirmation (`dashboard/orders/[poId]/*`), WhatsApp text capture (`dashboard/orders/capture/*`), receiving inbox (`dashboard/receiving/page.tsx`), receiving wizard (`dashboard/receiving/[poId]/wizard.tsx` with steps from `app/showcase/receiver/_steps/*`), dock slip (`receiving/[poId]/dock-slip.tsx`), inventory count (`dashboard/inventory/count/count-screen.tsx`), offline queue (`apps/web/lib/pwa/offlineQueue.ts`), mobile and desktop nav (`dashboard/nav.tsx`), shell (`dashboard/layout.tsx`), role routing (`apps/web/lib/roles.ts`).

---

## 0. Method and evidence levels

- **The web was only partly reachable.** `WebSearch` worked and returned page-level excerpts with URLs. Direct page fetches did not work. `WebFetch` failed DNS (`getaddrinfo ENOTFOUND`) for help.choco.com, choco.com and apps.apple.com, and `curl` through the agent proxy got `CONNECT tunnel failed, response 403`. Every **[W]** claim therefore comes from a search excerpt of the cited page, not a full read. Check the live page before quoting its wording.
- **[K]** marks a claim from my working knowledge of the product's public UI or of platform guidelines (Apple HIG, Material, web APIs) that I **could not verify this session**. Treat it as a strong hypothesis, not a citation.
- **[RM-spec]** marks a value I prescribe for RestoMatch (a pixel size, a threshold, a timing, a tap budget). It is a design decision drawn from the pattern, not something a source states.
- **[Code]** marks something I read in the RestoMatch repo this session, with a file and line.
- **[Derived]** marks a tap count I worked out from documented steps (competitor) or from code (RestoMatch). It has not been measured on a device.
- **Coverage honesty:**
  - **Galley:** its receiving workflow is documented for the web receiving page. I found no proof of a dedicated phone app.
  - **meez:** this is a recipe hub, not an ordering app. It informs only the recipe → par link.
  - **Rekki, Apicbase, MarketMan, BlueCart:** their help centers were mostly not reachable, so their entries lean on marketing pages and third-party listings.

---

## 1. Current-state evidence ([Code])

These are the facts the principles respond to. Line numbers are from the working tree on 2026-10-25.

| # | Where | What is there now | Why it matters |
|---|---|---|---|
| C1 | `orders/new/wizard.tsx:61` | The order is a 4-step wizard, `SUPPLIER → BUILD → REVIEW → SENT`, for **one supplier per order**. | Every leader opens on an **order guide** of known items. RestoMatch opens on a search box (P1, P18). |
| C2 | `wizard.tsx:300–420` | BUILD is a catalog **search** list. A tap adds the line at `qty: 1` (`:358`). The quantity is then a typed number `Input` in a 5-column grid (`:417`). There are no steppers, no last-order quantity, no par, no suggestion. | A 10-line routine order needs about 10 searches plus 10 keyboard edits (see §3). That is the opposite of "order in under a minute" (P1–P3). |
| C3 | `wizard.tsx:741`, `packages/api/src/routers/orders.ts:573` | `previewDelivery` derives the delivery date from `suppliers.order_schedule` (order weekdays + `cutoff` 'HH:MM' + fulfillment, `packages/db/src/schema.ts:448–500`). The wizard shows `missedCutoff` as small `text-xs text-warn` text. | The data model for cut-off **already exists**. Only the countdown and the reminder are missing (P4). |
| C4 | `lib/roles.ts:70`; `routers/orders.ts:447, 734, 868` | `/dashboard/orders` is visible only to `owner` and `manager`. `createDraft`, `captureFromText` and `placeOrder` are `managerProcedure`. | The **chef cannot order at all**, though the chef is the person who knows what is short. Choco solves this with "team order" (P7). |
| C5 | `orders/[poId]/detail-client.tsx` (keys `detail.send`, `detail.editLine`, `detail.cancel`) | The order page can send, edit lines and cancel. There is **no "order again"** anywhere in `dashboard/orders` (grep for reorder/repeat/clone found nothing). | Choco's "Order again", Ordermentum favourites and xtraCHEF order guides all make repeat ordering the default path (P6). |
| C6 | `orders/[poId]/supplier-confirm-card.tsx:1–30` | `supplierConfirm` (flag) shows the supplier's answer as differences against the PO. The PO itself is never changed. | This is a good base for the confirmation timeline and substitutions (P8, P9). |
| C7 | `orders/capture/capture-client.tsx:20–26` | WhatsApp text is pasted or shared, turned into a draft, then confirmed with one tap (`placeOrder`, channel `none`). | This is RestoMatch's version of Choco OrderAgent. It is a strong differentiator to extend (P19). |
| C8 | `receiving/page.tsx` | The receiving inbox is a grid of cards: supplier, expected time, item count, receipt badge (`md:grid-cols-2`). A PO with no date shows `inbox.noDeliveryDate`. | There is no "late" state, no time-window grouping, no today summary (P10). |
| C9 | `receiving/[poId]/wizard.tsx:70–84, 104` | Receiving starts at **`SCAN_INVOICE`**, then `PROCESSING` (OCR). After `STILL_READING_AFTER_MS = 30_000` (`:40`) it offers "continue with the order". Then come `RECONCILIATION_REVIEW → ADJUST_QUANTITIES → CONFIRMED`. | Invoice-first makes the driver wait for OCR. Choco, Galley and Supy start from the **order lines** (P11). |
| C10 | `showcase/receiver/_steps/AdjustQuantities.tsx:225–290` | The adjust card has a ± stepper with 48×48 buttons (`w-12 h-12`), changing by **±1 for every unit, including kg** (`incrementQty(±1)`, input `step={0.1}`). Chips: "as ordered", "as invoiced", **"missing"**, **"damaged"**. | There are only 2 reasons, **no per-line photo**, and no weight mode (P13, P14). |
| C11 | `packages/db/src/schema.ts` (`gr_lines`) | `gr_lines` already has `qty_received numeric(12,3)`, `qty_rejected`, `reject_reason text`, `condition_notes text` and `photos jsonb` **per line**. | A reason taxonomy and a per-line photo are **UI-only work**, with no schema change (P13). |
| C12 | `showcase/receiver/_steps/InvoiceScan.tsx:226`; `_steps/scanPrep.ts:8–24` | Invoice capture is a single `<input accept="image/*,application/pdf">`. `scanPrep` resizes to a 2000 px long edge at JPEG ~0.8. There is no multi-page support, no edge detection and no blur check. | xtraCHEF and MarginEdge guide the camera, take one photo per page and gate blurry shots (P15). |
| C13 | `lib/pwa/offlineQueue.ts:196`; `wizard.tsx:204–221` | The offline queue (flag `receiverPwa`) stores **photos only** (`enqueuePhoto`) in IndexedDB. | Line marks, counts and order drafts made in a walk-in with no signal are not queued (P16). |
| C14 | `nav.tsx:277`; `layout.tsx:123, 175` | The mobile bottom bar holds the role's first 4 destinations plus "More". The desktop shell is capped at `max-w-6xl` (1152 px). Per the comment at `nav.tsx` ~line 150, an owner has about 17 tabs that wrap onto 2 rows. | Bosses on a 1440–1920 px screen get a 1152 px column and a two-row tab bar. That is the "organize the desktop better" complaint (P21). |

---

## 2. What the leaders do (digest with citations)

**Choco** (Berlin; restaurant ordering app plus the supplier-side OrderAgent)
- **Ordering** [W]: open the supplier chat → start an order → add products → **Basket** (bottom right) → **Add Delivery Date** (calendar) → **Checkout** → **Order Now**. On web, pick the delivery date, then **Go to Checkout**. [help.choco.com/…/6572394]
- **Reordering** [W]: "Order again" from a past order's **View details**. The help center lists this as web only. In the app, if the cart already has items, Choco asks whether to **replace the cart or combine the orders**. [6572394], [10295755]
- **Marketing claims** [W]: "three taps" per order and 85% fewer mistakes. These are vendor claims. [choco.com/restaurants]
- **Team order** [W]: a team member taps **Team order → Start Team Order** and saves the order "for review/editing". **Contributors can edit but not submit. Admin/Staff can edit and submit.** The order shows as In Progress. [help.choco.com/…/8381272]
- **Delivery check** [W]: **Orders tab → Past Orders → order → Start Delivery Check**. A checkmark marks a line received. **X** opens an issue type (**missing, wrong quantity, defective, other**) with details, a comment and a **photo**, saved with the bottom-right checkmark. **Continue** opens **Request for Supplier** (**credit note / replacement / custom**), which you can save for the team or send. [help.choco.com/…/8381277]
- **Groups and web** [W]: "check deliveries" across team members and locations, plus a **Deliveries report** on Choco Web that compares delivery checks across locations. [choco.com/us/restaurant-groups], [8381277]
- **AI** [W]: OrderAgent (formerly Choco AI, 2023) turns voice, photo, text and email orders into digital orders. The VoiceAgent (Dec 4, 2025, built with OpenAI) takes phone orders in any language, checks stock and suggests alternatives. [choco.com press], [choco.com stories]

**Rekki** (London; chef ordering app)
- **Cut-off** [W]: each supplier profile lists its cut-off (examples: 04:00, 03:00, 00:00). [rekki.com/gb/food-wholesalers/cheesman-brothers]
- **Supplier receipts** [W]: an operator praises the **message receipt** feature, because "I know the supplier received my order at a specific time". The same article mentions par tracking ("how much you used last week"). [totalfood.com]
- **Navigation** [W]: the **Market** tab sits bottom left. Search a supplier and tap to start ordering, or add a missing one by email. [rekki.com/article/how-do-i-add-a-supplier]
- **Rekki Connect** (2024) [W]: AI reads email, voicemail, PDF, CSV and SMS orders. [rekki.com/article/rekki-connect-order-processing]

**Ordermentum** (Australia)
- **Ordering** [W]: start an order → scroll categories → add to cart → confirm. You get an on-screen confirmation plus an email. A **Scheduled** tab holds standing (recurring weekly) orders. [ordermentum.com/blog], [venezianocoffee.com.au]
- **Top-ups and minimums** [W]: **Top Up Orders** add to the same delivery day without meeting the **MOV** again. The MOV is shown at checkout. One-off edits are allowed until the cut-off. The venue and supplier articles disagree on freight. [help.ordermentum.com venue 9186945; supplier 9764933]
- **Reminders** [W]: notification settings are set **per supplier** (Settings → Notification Settings → supplier), with push "Order Reminders" and email reminders before cut-off. [help.ordermentum.com/…/9186942] The App Store listing mentions reordering from favourites and standing orders, plus cut-off reminders. [apps.apple.com/app/id1271283718]

**Restaurant365 (R365 App)**
- **Creating an order** [W]: quantities are filled "manually or by Suggested Qty or Par Qty". To fill every line, "tap the **menu icon in the top right** … **Suggested Quantity** or **Autofill to Par**".
- **On Hand** [W]: shows a **theoretical on hand** (from usage per $1000 of sales) in **grey**. An edited actual value shows in **black**.
- **Item context** [W]: the item screen shows **In Transit, Last Order, Last 4 Average, Suggested**. **Save** keeps the order In Progress and does not send it. [docs.restaurant365.com/docs/r365-app-creating-an-order; freshdesk mirror]
- **Autofill to Par** [W] is defined as "Par Qty minus the On Hand". [docs …/purchase-orders-use-shopping-lists]
- **May 2024 release** [W]: ordering in the app, **single- or multi-vendor** orders, **add items by barcode scan**. [docs …/release-notes-may-2024]
- **Navigation** [W]: More → Orders. [docs …/r365-app-orders-overview]

**Toast xtraCHEF**
- **Mobile scan** [W]: start from the **camera icon** on the mobile dashboard. Hold the phone parallel to the document on a flat, well-lit background. **Add Page** sits bottom left. Set the document type (**Invoice / Receipt**) or mark a **credit note**, then submit. [support.toasttab.com/article/xtraCHEF-Mobile-Invoice-Uploads] Toast's integration page says the app "detects, captures and corrects" the image. [pos.toasttab.com/integrations/xtrachef]
- **Orders (web docs)** [W]: Order Guides list a vendor's invoice items with your normal quantity, added with "+". **Create Order** works from the catalog or an order guide. For several vendors, "this step will need to be repeated for each vendor". The vendor clicks **Confirm Order** in the automated email and the status updates automatically. [support.toasttab.com xtraCHEF-Order-Guides, -Create-Orders]

**Supy** (Dubai)
- **Receiving** [W]: the **Receive Order** button in the mobile app creates a GRN from the order, with a "Supporting Media" photo field. [help.supy.io/…/8596863]
- **Disputes** [W]: note the discrepancies under Received Items → mark the GRN **disputed** → it moves to a **Disputed** section → **Resolve Dispute** when it is fixed. [help.supy.io/…/11121915]
- **Ordering** [W]: par plus a min level per item per site, and **Fill to PAR** pre-fills order quantities from the stock-to-par gap. The buyer "still reviews and edits every line". Separately, AI predictive ordering works from a **14-day** POS demand forecast. [supy.io/blog/learn-automated-par-level-reordering], [supy.io/blog/learn-restaurant-ai-predictive-ordering-multi-site]
- **Offline counting** [W]: Supy warns about the silent-failure mode, where the count "looks finished on the screen, but the data never reached the server". [supy.io/blog/learn-restaurant-stock-count-offline]

**Galley** [W]
- Once a PO is set to "sent", its items appear on the **Receiving Page** for the delivery date.
- Each expected item has three buttons: **Receive outstanding / Receive modified / No longer expected**.
- Every item keeps an **event log**, and the **Modify** button corrects a mistaken event.
- **Ad hoc** receiving covers purchases with no PO.
- Sources: [support.galleysolutions.com/how-do-i-use-the-receiving-workflow], [/how-to-receive], [/receiving-from-orders-ad-hoc-and-invoices]

**Apicbase** [W]: the mobile home screen shows **Count, Waste, Receive Order** as primary tiles [mwm.ai listing]. Order suggestions come from real-time inventory and recent sales [getapp.com; hospitalitynet.org].

**MarketMan** [W]: par alerts, and "fill to par with one click" [marketman.com platform page]. It claims to work offline and sync on reconnect [marketman.com blog]. Third-party reviews mention mobile limitations and occasional syncing issues [getapp.com reviews].

**BlueCart** [W]: per-vendor order guides with regular items, par levels and preferred quantities, reviewed before submission [softabase.com]. In-app messaging is organized by order number [trustradius.com]. A "predictive ordering" launch is reported but unverified [cbinsights.com].

**Reference systems**
- **US Foods MOXē** [W]: a **Delivery Tracker** tile on the home screen opens a truck map, plus a push/email alert when the truck is **30 minutes away**. At review, **"Did You Forget"** lists regularly bought items missing from the order. You can also edit the delivery date and add a PO number before submitting, and get alerts before the cut-off. [usfoods.com/our-services/moxe-help-center/ordering-on-moxe.html], [usfoods.com/alerts]
- **Sysco Shop** [W]: **custom list sequencing** to "match the order sheet to shelf layout". Orders can be **placed offline**, and existing orders modified up to the delivery cut-off. Out-of-stock items can be swapped for a **substitute**, and since May 2026 the delivery summary shows case counts for substitutes. Today's delivery status shows on login. [sysco.com/shopmobile], [apps.apple.com/app/id1374586010], [appsupport.shop.sysco.com/…/15033655]
- **MarginEdge** [W]: one photo per page. All four sides must be visible, with a small border. A **blur warning** offers retake or accept. **Invoice History** shows each photo's upload status. [help.marginedge.com/…/218283058, …/360035399853]
- **Catch weight** [W]:
  - HotSchedules/Adaco: the receiver enters weight to **3 decimals**. A gap such as 2.000 kg ordered vs 2.500 kg entered asks for confirmation. [help.hotschedules.com/…/360042714151]
  - Infor: an actual weight is required on catch-weight lines. [docs.infor.com]
  - Odoo: a weight outside tolerance is rejected at the dock. [apps.odoo.com/…/catchweight]
- **WISK** [W]: the app shows the **number of operations not yet synced**. [help.wisk.ai/…/4925254]
- **Decision Logic** [W] (a worked par example): par 6, 1 pending, 3 on hand gives a suggestion of **2**. [decisionlogic.atlassian.net/…/3019472900]

**meez** [W]: a recipe hub (import, scaling, yields, sort by station or location). I found no ordering or mobile-receiving feature [getmeez.com/2025/organization]. It is relevant only as a source of **recipe yield → expected usage → par** (see P2).

---

## 3. Benchmark flows: tap budgets ([Derived])

| Flow | Leader (documented steps) | RestoMatch today ([Code], derived) | RestoMatch target [RM-spec] |
|---|---|---|---|
| **Routine 10–12-line order to a known supplier** | **R365:** Orders → new → vendor → ⋮ → *Autofill to Par* → Submit ≈ **6–7 taps, independent of line count**. **Choco:** chat → start order → N item taps → Basket → Add Delivery Date → day → Checkout → Order Now = **N + 6**. | Orders (via More on mobile, +1) → New → supplier select (2) → Continue → **per line**: focus search, type 3–5 chars, tap row, focus qty, type → Continue → date/channel (1–3) → Send ≈ **40+ taps + ~20 typing bursts**, about 3–5 min. | Home card "**הזמנה ל{ספק} — נסגר בעוד 2:15**" (1) → BUILD opens **pre-filled** from the guide (0) → adjust 2–3 lines with steppers (3–6) → **המשך** (1) → **שלח** (1) = **6–9 taps, ≤45 s median**, no keyboard. |
| **Repeat last order** | **Choco:** View details → Order again → delivery day → Checkout (≈4). | Not possible. | Orders list row ⋮ → **הזמן שוב** (2) → if a draft exists, the replace/combine sheet (1) → **שלח** (1) = **3–4 taps**. |
| **Receive a clean delivery (all as ordered)** | **Choco:** Orders → Past → order → Start Delivery Check → mark received → done (≈5–6). **Galley:** one *Receive outstanding* per line. | Card (1) → scan (2–3 incl. camera) → **OCR wait** (seconds, up to 30 s before the escape) → review → Continue (1) → Confirm (1) ≈ **6 taps + OCR wait**. | Card (1) → **הכל התקבל כמו שהוזמן** (1) → **סיים קבלה** (1) = **3 taps, 0 s wait**. The invoice photo is an optional parallel step (2–3 taps) that never blocks. |
| **Each exception line** | **Choco:** X → issue type → (comment/photo) → ✓ = 3–5. | Stepper/chip (1–3). No photo, 2 reasons only. | **✗** (1) → reason chip (1) → [qty stepper 0–3] → [📷 2] → **שמור** (1) = **3–8 taps**. |
| **Multi-page invoice photo** | **xtraCHEF:** camera icon → shoot → Add Page per page → type → submit ≈ **4 + 2 per extra page**. | One file input, one image. | Camera opens on the viewfinder (1) → **auto-capture** per page (0–1) → **+ עמוד** (1 per page) → **סיום** (1). The blur gate adds at most 1. |

The single biggest functional win is that the **routine order goes from about 40 taps plus typing to under 10 taps**. That needs no new data: RestoMatch already has PO history per supplier, contract prices, the supplier schedule and inventory counts.

---

## 4. Principles (23)

Format for each: **Rule** (what to build) · **Evidence** · **RestoMatch mapping** · **Check** (how to tell it is done).

### P1. Order from a guide, not from search
- **Rule:** BUILD opens on the supplier's **order guide**: every item ordered from this supplier in the last 8 POs (v1, derived) or a saved guide (v2). It is grouped by the user's shelf/storage order ("מקרר", "מקפיא", "יבש", "ירקות") and every row has an inline stepper. Search and the free line are a secondary "+ פריט אחר" at the bottom.
- **Evidence:**
  - Choco order guides are customizable by category [W apps.apple.com/app/id1385672901].
  - xtraCHEF Order Guides hold each vendor's items with their normal quantity [W].
  - Sysco custom list sequencing matches the order sheet to the shelf layout [W].
  - BlueCart keeps per-vendor guides [W].
- **RestoMatch:** `orders/new/wizard.tsx` BUILD (C1, C2). v1 is derived from `po_lines` history, so no schema change is needed.
- **Check:** with 8+ prior POs to a supplier, BUILD shows ≥90% of the next order's lines without the user typing anything.

### P2. One action fills the whole order, and the math is shown
- **Rule:** a ⋮ menu at the top end of BUILD offers **מלא לפי פאר** / **כמות מוצעת** / **כמו בהזמנה הקודמת** / **אפס הכל**. The fill formula is `max(0, par − onHand − inTransit)`, rounded up to the pack size. Each row shows a 1-line explanation: "פאר 6 · במלאי 3 · בדרך 1 → 2".
- **Evidence:**
  - R365's top-right menu offers *Suggested Quantity / Autofill to Par*, and Par = Par Qty − On Hand [W].
  - Supy Fill to PAR, with the buyer editing every line [W].
  - MarketMan "fill to par with one click" [W].
  - Decision Logic's worked example: 6 − 1 − 3 = 2 [W].
- **Data:**
  - v1 "suggested" = average of the last 4 POs' quantities, which needs no schema.
  - "On hand" comes from the latest `inventory_counts` (S17, migration 0070).
  - **Par** needs storage. That means a new migration plus a `schema.ts` edit, which is **human-PR** (immutable).
  - meez-style recipe yields × POS sales (POS sales exist, migration 0058) can later replace a fixed par, like Supy's 14-day forecast [W].
- **RestoMatch:** `wizard.tsx` BUILD; `inventory/count` → "create order from this count".
- **Check:** one tap fills every line, and an undo toast (5 s) restores the previous quantities.

### P3. Every line carries its own context
- **Rule:** under the item name, show **אחרון 6 · ממוצע 5 · בדרך 0**. Show on-hand in **grey when estimated** (from the last count minus usage) and in **ink when counted today**. Never show a context number with no label.
- **Evidence:** R365 shows In Transit, Last Order, Last 4 Average and Suggested per item, with theoretical on-hand in grey and edited in black [W]. Rekki's par tracking is "how much you used last week" [W].
- **RestoMatch:** the guide row (PT1) in `wizard.tsx`. Contract price (`contract-price.tsx`) stays at the row's end as today.
- **Check:** a hallway tester can answer "how much did we order last time?" for any row without leaving the screen.

### P4. A cut-off is a countdown, and suppliers are sorted by it
- **Rule:** the SUPPLIER step (and the home screen for manager and chef) lists suppliers **by next cut-off, soonest first**, each with a chip:
  - **נסגר ב-16:00** (neutral) when >3 h away
  - **נסגר בעוד 2:15** (warn) when ≤3 h
  - **נסגר בעוד 25 ד׳** (solid danger, T2) when ≤30 min
  - after the cut-off: **המשלוח הבא: ג׳ 07:00** (neutral)

  The thresholds are [RM-spec]. The missed-cut-off state reuses the existing `derived.missedCutoff`.
- **Evidence:** Rekki shows the cut-off on every supplier profile [W]. Ordermentum sends cut-off reminders [W]. US Foods sends order alerts before the cut-off [W]. A chef quoted by Rekki said that missing cut-offs "is a problem" [W].
- **RestoMatch:** `wizard.tsx` SUPPLIER step plus the `/dashboard` overview for manager and chef. Data: `suppliers.order_schedule.windows[].cutoff` (C3).
- **Check:** at 14:00 with a 16:00 cut-off, that supplier is first in the list with a "נסגר בעוד 2:00" chip.

### P5. Edit until the cut-off, and merge a top-up into the open order
- **Rule:** a sent PO stays editable until the supplier's cut-off, with the label "**ניתן לערוך עד 16:00**". Adding items for the **same supplier and delivery day** appends them to the open PO as a marked "תוספת" block, instead of creating a second PO. Receiving then has **one card per delivery**.
- **Evidence:** Ordermentum allows one-off edits until the cut-off, and Top Up Orders for the same delivery day skip the MOV [W]. Sysco allows changes to existing orders up to the delivery cut-off [W].
- **RestoMatch:** `orders/[poId]/detail-client.tsx` (edit already exists, so add the cut-off gate and label); `wizard.tsx` (detect an open PO for supplier + date → "להוסיף להזמנה הקיימת?"); `receiving/page.tsx` stays one card per PO. The matching engine is untouched (one PO = one expectation).
- **Check:** ordering twice from the same supplier for tomorrow produces one PO and one receiving card.

### P6. Repeating an order takes two taps
- **Rule:** every past order (orders list row, order detail, supplier page) has **הזמן שוב**. It opens BUILD pre-filled with that order's lines and the next valid delivery date. If a draft for that supplier already exists, a bottom sheet asks **החלף את הטיוטה / צרף לטיוטה**.
- **Evidence:** Choco's "Order again", and the replace-or-combine prompt when the cart is not empty [W]. Ordermentum reorders from favourites and has standing orders [W]. US Foods saved lists [W].
- **RestoMatch:** `orders/list-client.tsx` / `orders-table.tsx` row action; `orders/[poId]/detail-client.tsx`; `suppliers/[id]/page.tsx` (C5).
- **Check:** from the orders list, a repeat order is sent in ≤4 taps (§3).

### P7. Anyone can draft, a manager sends
- **Rule:** **chef** (and optionally **receiver**) can build a draft. Their primary button is **שלח למנהל לאישור**. The manager gets a "ממתין לשליחה (2)" section at the top of `/dashboard/orders` and sends with one tap. No new approval engine is involved: this is a status on the draft PO.
- **Evidence:** Choco Team order: Contributors edit but cannot submit, Admin/Staff submit, "Start Team Order", the order shows In Progress [W].
- **RestoMatch:**
  - `lib/roles.ts:70` adds a chef-only `/dashboard/orders/new` entry.
  - Add a new `memberProcedure`-tier `orders.createDraftRequest` (chef/manager/owner) and keep `placeOrder` as `managerProcedure` (C4).
  - **The cross-tenant COVERAGE manifest needs an entry** for the new procedure. Agents may add one.
- **Check:** a chef can build and submit a draft but cannot send it to a supplier, and the manager sees it within one refresh.

### P8. Supplier confirmation is a visible state with times and a line diff
- **Rule:** the PO status reads like a timeline: **נשלח 14:02 (WhatsApp)** → **נפתח ע״י הספק 14:10** → **אושר** or **אושר עם 2 שינויים** → **התקבל**. Changes (quantity cut, price, substitution) show as struck-through original → new, with the ₪ delta via `formatIls()`. Confirmed changes become the **receiving expectation** (the "as ordered" chip shows "כמו שאושר").
- **Evidence:** Rekki message receipts ("received at a specific time") [W]. In xtraCHEF the vendor clicks **Confirm Order** and the status updates automatically [W]. Choco sends a confirmation after a supplier edits and confirms [W].
- **RestoMatch:** `orders/[poId]/supplier-confirm-card.tsx` (C6); the status chip in `orders-table.tsx`; `receiving/page.tsx` card badge "אושר עם שינויים". The "opened" timestamp needs the supplier link to record the first view, which is part of the `supplierConfirm` router (web-feature-engineer).
- **Check:** for any sent PO, the owner can tell from the list row alone whether the supplier has seen it.

### P9. Substitutions are explicit and priced
- **Rule:** a substitution is its own diff row: "**במקום** עגבניות שרי 250 ג׳ → עגבניות שרי תמר 250 ג׳ · **+₪0.80 ליח׳** · 6 יח׳", with **אשר תחליף / דחה**. An accepted substitute becomes the expected item at receiving. A substitute arriving **without** acceptance is flagged at the dock as "תחליף לא מאושר", and the engine already treats it as an unordered item.
- **Evidence:** Sysco Shop lets you choose a substitute for an out-of-stock item, and its delivery summary shows substitute case counts [W]. Choco's VoiceAgent "suggests alternatives" [W].
- **RestoMatch:** `supplier-confirm-card.tsx`; receiving ADJUST (PT6); a reason chip in PT7.
- **Check:** a substitution's ₪ delta is visible before it is accepted.

### P10. A "today" board for deliveries, with late and arrived states
- **Rule:** the receiver's home is **today's deliveries**:
  - grouped by time window ("06:00–09:00", "09:00–12:00")
  - a summary line: "היום: 5 משלוחים · 2 התקבלו · 1 באיחור"
  - card states: צפוי (neutral T4), **באיחור** (warn, once the window end + 30 min passes [RM-spec]), בקבלה (primary), התקבל (calm T3, with "2 חריגות · ₪184" if any)
  - a separate "ללא תאריך" bucket at the bottom, so undated POs are never hidden (STATE R5)

  Don't promise a truck map: Israeli suppliers rarely have telematics. Offer "**הספק עדכן: בדרך**" via the supplier link instead.
- **Evidence:** US Foods MOXē's Delivery Tracker tile with a truck map and a 30-min-away alert [W]. Sysco Shop shows today's delivery status, items and invoice on login [W].
- **RestoMatch:** `receiving/page.tsx` (C8); the `/dashboard` overview for the `receiver` role.
- **Check:** a late delivery is visibly distinct (warn tier, with a label as well as color) without opening it.

### P11. Receive against the order; the invoice photo is parallel evidence, never the gate
- **Rule:** the receiving wizard opens on the **PO line list** (PT6). Invoice capture is a button in the sticky header (**📷 צלם חשבונית**) that can be used at any time. OCR runs in the background and the reconciliation arrives as a banner ("החשבונית נקראה — 2 הבדלי מחיר") **after** the count. The driver is never kept waiting on OCR.
- **Evidence:** Choco's delivery check starts from the order lines [W]. Galley lists expected items from the sent PO [W]. Supy's "Receive Order" creates the GRN from the order [W]. STATE.md task #27 ("receiving auto-match before count") shows the count-first order also protects the leak figure.
- **RestoMatch:** reorder `STEP_ORDER` in `receiving/[poId]/wizard.tsx:77–83` to count → (photo any time) → reconcile → confirm (C9). Invoice-first remains the entry path for a delivery with **no PO** (Galley "ad hoc" [W]).
- **Check:** a receiver with no photo and no network can finish the count. Time from opening the card to "count done" on a clean delivery is ≤20 s [RM-spec].

### P12. The default equals the expectation; the user touches only exceptions
- **Rule:** every line starts at the **ordered (or supplier-confirmed) quantity**. A full-width **הכל התקבל כמו שהוזמן** marks every untouched line OK. The sticky footer counts "9 מתוך 12 אושרו". **סיים קבלה** is enabled once every line is resolved.
- **Evidence:** Galley's *Receive outstanding* [W]. Choco "mark all products received" [W]. In Saledock, quantity received defaults to quantity ordered [W].
- **RestoMatch:** `AdjustQuantities.tsx` (there is a "settled" state already, `mark.touched`); the footer of `receiving/[poId]/wizard.tsx`.
- **Check:** a clean 12-line delivery takes 3 taps (§3).

### P13. An exception is a reason, an amount and optional evidence, in ≤4 taps
- **Rule:** **✗** on a line opens a bottom sheet (PT7) with single-select reason chips: **חסר לגמרי / חסר חלקית / פגום או מקולקל / טמפרטורה לא תקינה / תחליף לא מאושר / מחיר בתעודה שונה**. Below them: an amount stepper (for partial), **📷 צלם** (opens the rear camera directly), an optional note, and **שמור**. At **סיים קבלה**, if there are exceptions, one question: **מה מבקשים מהספק? זיכוי / החלפה / אחר**. The answer seeds the claim in `leaks/claims` and `recovery`.
- **Evidence:** Choco's issue types (missing / wrong qty / defective / other) with comment and photo, and the request type (credit note / replacement / custom) [W].
- **RestoMatch:** `AdjustQuantities.tsx` (replace the 2 chips, C10); `gr_lines.reject_reason`, `condition_notes` and `photos` **already exist** (C11), so this is UI only. It also feeds `dock-slip.tsx` (תעודת חריגה).
- **Check:** "6 of 12 tomatoes short, with a photo" is recorded in ≤6 taps, and the reason shows on the dock slip and the claim.

### P14. Steppers for counted units, a keypad for weight
- **Rule:** the control follows the unit:
  - **Counted** (יח׳, ארגז, קרטון, שק): ± stepper, step 1, 48×48 buttons; long-press repeats at about 8/s after 400 ms [RM-spec].
  - **Weighed** (ק״ג, ליטר): tapping the value opens a **numeric keypad sheet** with 3 decimals and "הוזמן 12.000 ק״ג" shown. If |actual − expected| / expected > 10% [RM-spec], the sheet asks "שונה ב-18% מההזמנה — לאשר?".
  - Never a ±1 stepper on kg.
- **Evidence:** HotSchedules enters weight to 3 decimals and confirms a 2.000 vs 2.500 kg gap [W]. Infor requires an actual weight on catch-weight lines [W]. Odoo applies a tolerance band at the dock [W].
- **RestoMatch:** `AdjustQuantities.tsx:225–255` (C10); `inventory/count/count-screen.tsx:362` (already `inputMode="decimal"`). `gr_lines.qty_received` is already `numeric(12,3)` (C11).
- **Check:** entering 11.640 kg takes one tap plus 5 keypad digits, and no stepper appears on kg lines.

### P15. Guided, multi-page, quality-gated invoice capture
- **Rule:** an in-app viewfinder with:
  - a **document-edge overlay** and **auto-capture** after about 700 ms of stability [RM-spec], with a 72 px manual shutter
  - **+ עמוד** for extra pages
  - a type toggle: **חשבונית מס / תעודת משלוח / חשבונית זיכוי**
  - a **blur and darkness gate** before upload ("התמונה מטושטשת — לצלם שוב?" → **צלם שוב / השתמש בכל זאת**)
  - a per-page upload status (בתור / עולה / הועלה / ממתין לרשת)

  Fall back to the current `<input capture>` when `getUserMedia` is not available.
- **Evidence:**
  - xtraCHEF: hold parallel, Add Page bottom left, document type, credit note [W]; "detects, captures and corrects" [W].
  - MarginEdge: one photo per page, all four sides visible, retake-or-accept blur warning, per-photo upload status [W].
  - Veryfi: automatic edge detection with no need to "fit" the borders [W].
  - Browser edge detection (e.g. OpenCV.js / jscanify) is feasible on the PWA [K].
- **RestoMatch:** `showcase/receiver/_steps/InvoiceScan.tsx:226`, `scanPrep.ts` (C12); also the `inbox` upload path. OCR spend matters (STATE M11), so the blur gate reduces wasted OCR calls.
- **Check:** a 3-page invoice is one invoice record with 3 images, and a blurry frame is caught before upload.

### P16. Offline-first for every action at the dock and in the walk-in, with a visible pending count
- **Rule:**
  - Queue **line marks, exception reasons and photos, counts and order drafts**, not only invoice photos.
  - Show a header chip **⟳ 3 ממתינים לסנכרון** (warn) while the queue is non-empty, and a 32 px "אין חיבור — הנתונים נשמרים במכשיר" banner while offline.
  - Never show "התקבל ✓" (T3) for something not yet synced: use a hollow "נשמר במכשיר" state.
  - On reconnect, show a toast **סונכרן ✓**. Per-line last-writer-wins with an audit entry.
- **Evidence:** Sysco Shop lets you place orders offline [W]. MarketMan says it works offline and syncs on reconnect [W]. WISK shows the count of unsynced operations [W]. Supy warns about the silent-failure mode [W].
- **RestoMatch:** `lib/pwa/offlineQueue.ts:196` (C13); `receiving/[poId]/wizard.tsx`; `inventory/count/count-screen.tsx`; the header in `layout.tsx`. It must keep the M7 rule of **one goods receipt per PO** (idempotent `clientUploadId`-style keys per action).
- **Check:** in airplane mode, a full receipt can be completed and syncs exactly once when the network returns.

### P17. Thumb-zone layout on every mobile flow
- **Rule:**
  - The primary action is a **sticky, full-width bottom button** 56 px high, plus `env(safe-area-inset-bottom)`.
  - Touch targets are ≥48×48 px (HIG 44 pt, Material 48 dp [K]).
  - A destructive action (✗ / reject / cancel order) is never adjacent to the primary and never in the bottom-end corner.
  - The bottom nav is **hidden inside a task flow** (order build, receiving) so the sticky bar owns the bottom.
  - Numbers keep `dir="ltr"` inside RTL (as `AdjustQuantities` already does).
- **Evidence:** Choco's Basket sits bottom right and its delivery-check save is bottom right [W]. Rekki's Market tab sits bottom left [W]. Platform guidelines [K].
- **RestoMatch:** `nav.tsx` MobileNav (hide on `/orders/new` and `/receiving/[poId]`); the wizard footers. In BUILD, the line grid `grid-cols-[4rem_4.5rem_5rem…]` (`wizard.tsx:417`) should become the PT1 row on phones.
- **Check:** at 390×844, every primary action is reachable with the right thumb without moving the grip, and there is no horizontal scroll.

### P18. A multi-supplier cart splits itself by supplier
- **Rule:** when lines come from several suppliers (from an inventory count's "low" list, from product pages comparing suppliers, or from a chef's draft), REVIEW groups them **per supplier**. Each group has its own delivery date, cut-off chip and MOV bar. One **שלח הכל (3 ספקים)** creates N POs. Never make the user check out once per vendor.
- **Evidence:** R365 supports multi-vendor orders [W]. xtraCHEF's "repeat for each vendor" is the anti-pattern [W].
- **RestoMatch:** a new mode of `orders/new/wizard.tsx`; entry points `inventory/count` and `products/[productId]` (cheapest supplier). `createDraft` is called once per supplier group, with no engine change.
- **Check:** ordering 3 items from 3 suppliers takes one review screen and one send.

### P19. Free text, voice or WhatsApp in; a structured order out
- **Rule:** extend `orders/capture` so that:
  - it is a **PWA share target**, so "Share → RestoMatch" from WhatsApp opens capture pre-filled [K: Web Share Target API]
  - it accepts a **voice note**
  - it shows parsed lines with a confidence marker ("לא זוהה — בחר מוצר" inline picker)
  - one tap confirms
- **Evidence:** Choco OrderAgent handles voice, photo, text and email orders [W], and the VoiceAgent takes phone orders in any language [W]. Rekki Connect reads email, voicemail, PDF and SMS [W].
- **RestoMatch:** `orders/capture/capture-client.tsx` (C7), which already turns text into a draft with one-tap confirm. Hebrew-first parsing is a moat that the English-first leaders lack.
- **Check:** a WhatsApp order message reaches a confirmable draft in ≤3 taps from WhatsApp.

### P20. Notifications are per supplier and timed around the cut-off and the arrival
- **Rule:** per-supplier settings (**תזכורת לפני סגירה: 2 ש׳ / 30 ד׳ / כבוי**). Reminders fire only on that supplier's order days and only if no PO is sent yet. For a late delivery, nudge the receiver once.
- **Evidence:** Ordermentum's Settings → Notification Settings → per-supplier push/email reminders [W]. US Foods' 30-min truck alert and pre-cut-off alerts [W].
- **RestoMatch:** `settings/page.tsx` (preferences); delivery belongs to `packages/api/src/notifications/outbox.ts` + `apps/worker/src/cron.ts`, which are **immutable**: **human-PR proposal**. v1 without touching them: the in-app cut-off chip (P4) and a home card.
- **Check:** with a 16:00 cut-off and nothing sent, the manager's phone shows a reminder at 14:00 (once the human PR lands).

### P21. The desktop is for bosses: dense, bulk, comparative, wide
- **Rule:** at ≥1280 px, procurement pages are **tables in a master-detail split** (list about 40% / detail about 60%):
  - ≥20 rows visible at 1440×900
  - multi-select bulk actions (send drafts, cancel, export)
  - keyboard: `j/k` move, `Enter` open, `s` send, `/` search [RM-spec]
  - persisted filters: היום / ממתין לאישור ספק / ממתין לשליחה / במחלוקת
  - data pages may go beyond `max-w-6xl` to `max-w-[1600px]`
  - the ~17-tab top row becomes a **grouped side rail** (operations / purchasing / admin, which `NAV_ITEMS.group` already defines)

  For chains, a **delivery-accuracy comparison**: per branch × supplier, lines OK %, ₪ short, late %.
- **Evidence:** Choco Web's Deliveries report compares delivery checks across locations [W]. Supy's Disputed section [W]. Galley's per-item event log [W]. R365 builds ordering on the web first, then mobile (May 2024) [W].
- **RestoMatch:** `layout.tsx:123, 175`; `nav.tsx` DesktopNav (C14); `orders/orders-table.tsx`; `approvals`; `chain/page.tsx`; `suppliers/ledger`.
- **Check:** an owner can see every open PO for the week, with confirmation and receiving status, on one 1440×900 screen without scrolling horizontally.

### P22. A dispute is a tracked queue until it is resolved, and every line has a history
- **Rule:**
  - Receiving exceptions put the receipt into **במחלוקת**. It is listed on the desktop until the credit or replacement arrives, then **סגור מחלוקת** (with "זיכוי התקבל ₪184").
  - Each line keeps an event log (received 12 → corrected 10 by דנה 07:42).
  - A correction is an event, never a silent overwrite.
- **Evidence:** Supy's mark disputed → Disputed section → Resolve Dispute [W]. Galley's event log and **Modify** [W]. Choco's request type flows to the supplier, who "is expected to respond" [W].
- **RestoMatch:** `leaks/claims`, `recovery/page.tsx` (the ₪-back tracker), a receipt history on `orders/[poId]`. The recovery stage feeds the T3 "recovered" number on the overview.
- **Check:** every dock exception appears in exactly one open dispute until it is closed, and its ₪ comes from the matching engine, never recomputed in the UI.

### P23. A barcode speeds things up, but is never required
- **Rule:** a **סרוק** icon in the BUILD search field and in the receiving list header opens the rear camera with barcode detection [K: BarcodeDetector where supported, a JS fallback otherwise]. A match jumps to the row and adds +1 (counted) or opens the keypad (weighed). An unknown code offers "שייך למוצר".
- **Evidence:** R365 adds items by barcode scan (May 2024) [W].
- **RestoMatch:** `wizard.tsx` BUILD search; the receiving PT6 header; `inventory/count`. Catalog mapping (`catalog/mapping`) stores the code. Check whether the catalog already has a barcode/GTIN column. If not, adding one is a schema change and a **human PR**.
- **Check:** scanning a known item in BUILD changes its quantity in ≤1 s with haptic or visual feedback.

---

## 5. Patterns (15)

Every size is [RM-spec] unless marked. Colors use the existing tokens (`primary`, `warn`, `danger`, `ink`, `muted`, `line`, `surface-2`). ₪ goes through `formatIls()`.

### PT1. Guide row with an inline stepper
- **Anatomy:**
  - Row min-height 64 px, 16 px side padding.
  - Start side: item name (16 px semibold, 1 line, truncated), and under it a 12 px muted context line "אחרון 6 · ממוצע 5 · בדרך 0".
  - End side: the stepper `[−] qty [+]`. Each button is 48×48 and the qty cell is 56 px wide at 20 px tabular.
  - At **qty 0** only a single 48 px **[+]** shows. When qty > 0 the row tints to `primary/8`.
  - Tapping the qty number opens the keypad sheet (PT8).
  - Category headers stick at 36 px ("מקרר · 6 פריטים").
  - Contract or list price goes in the 12 px context line ("₪12.40/ק״ג") and never takes its own column on a phone.
- **Exemplar:** Choco order guide by category [W]; R365 Purchase item fields [W]; Sysco list sequencing [W].
- **RestoMatch use:** replaces the search list and the line grid in `orders/new/wizard.tsx` BUILD on <640 px. Desktop keeps a table with the same columns.

### PT2. Sticky cart bar
- **Anatomy:**
  - A bottom bar 64 px high plus the safe area, on `surface` with a top hairline.
  - Start side: "**7 פריטים · ₪1,240**" and under it a 12 px delivery chip "משלוח מחר 07:00".
  - End side: the primary **המשך** (48 px high, ≥120 px wide).
  - Hidden at 0 lines.
  - The bottom nav is hidden in this flow (P17).
- **Exemplar:** Choco's Basket bottom right [W]; Ordermentum's checkout shows the MOV [W].
- **RestoMatch use:** `wizard.tsx` BUILD and REVIEW (it replaces the inline Continue/Back buttons at `:510–513`).

### PT3. Cut-off chip and supplier board
- **Anatomy:** a 24 px pill with a clock icon. The states and thresholds are those in P4. Labels must be text-distinct, not only colored (WCAG). Rows in the SUPPLIER step are 72 px: supplier name, then a second line "יום הזמנה היום · משלוח ב׳ 07:00", with the chip at the end. They are sorted by next cut-off.
- **Exemplar:** Rekki's supplier cut-off [W]; Ordermentum's reminders [W].
- **RestoMatch use:** `wizard.tsx` SUPPLIER step; the `/dashboard` overview "להזמין היום" card for manager and chef; `suppliers/page.tsx` list.

### PT4. Bulk-fill overflow menu with undo
- **Anatomy:**
  - A 48 px ⋮ at the top end of BUILD opens an action sheet: **מלא לפי פאר** (disabled with the hint "הגדר פאר" when there is no par), **כמות מוצעת**, **כמו בהזמנה הקודמת**, **אפס הכל**.
  - After an action, a toast "מולאו 14 שורות · **בטל**" for 5 s.
  - Rows whose quantity was set by the fill show a small "מוצע" tag until they are touched.
- **Exemplar:** R365's top-right menu → Suggested Quantity / Autofill to Par [W].
- **RestoMatch use:** `wizard.tsx` BUILD.

### PT5. Replace-or-combine sheet
- **Anatomy:** a bottom sheet with the title "יש כבר טיוטה ל{ספק}". It has two stacked 56 px buttons, **צרף לטיוטה** (primary) and **החלף את הטיוטה** (secondary), plus a text link **ביטול**. A one-line summary under the title: "טיוטה: 5 פריטים · הזמנה קודמת: 11 פריטים".
- **Exemplar:** Choco's reorder prompt [W].
- **RestoMatch use:** **הזמן שוב** from `orders/list-client.tsx`, `orders/[poId]`, `suppliers/[id]`.

### PT6. Delivery-check list (receiving, order-first)
- **Anatomy:**
  - **Header (sticky, 56 px):** supplier name, "הזמנה #1042 · 12 שורות", the **📷 חשבונית** button (48 px, shows a page count badge once captured), and the ⟳ pending chip (PT13).
  - **Rows (64 px):** name, "הוזמן 12 יח׳" (or "אושר 10 יח׳" when the supplier changed it), and two 48 px toggles, **✓** and **✗**.
    - ✓ collapses the row to 48 px with a calm check (T3).
    - ✗ opens PT7.
    - A resolved exception row shows its reason chip, its quantity and a 📷 thumbnail.
  - **Footer (sticky):** the secondary full-width **הכל התקבל כמו שהוזמן**, then the primary **סיים קבלה** (56 px), disabled until every line is resolved, plus the counter "9 מתוך 12".
  - **Not-ordered items** go under a "פריטים שלא הוזמנו" section, added from the invoice or the barcode.
- **Exemplar:** Choco Start Delivery Check [W]; Galley's Receive outstanding / Receive modified / No longer expected [W]; Supy Receive Order [W].
- **RestoMatch use:** the new first step of `receiving/[poId]/wizard.tsx` (P11). It replaces the `SCAN_INVOICE`-first order and absorbs `ADJUST_QUANTITIES`.

### PT7. Exception bottom sheet
- **Anatomy:**
  - Max 85vh, with a grabber.
  - Title: the item name.
  - **Reason chips** (single-select, 44 px, wrapping) as in P13.
  - **Amount:** a "התקבל בפועל" stepper or keypad (PT8), pre-set to 0 for **חסר לגמרי**.
  - **📷 צלם** is a 48 px secondary button that opens the rear camera (`capture="environment"`) and shows up to 3 thumbnails.
  - An optional note (1 line, growing).
  - **שמור** is the primary at 56 px.
  - **Final step** (in the footer after **סיים קבלה**, when any exception exists): a 3-option segmented control, **זיכוי / החלפה / אחר**, then **שלח לספק** / **שמור לצוות**. "Send" reuses `dock-slip.tsx`'s WhatsApp pre-fill, so nothing is sent by RestoMatch itself.
- **Exemplar:** Choco's X → issue type → comment and photo → Continue → Request for Supplier [W].
- **RestoMatch use:** `AdjustQuantities.tsx` (C10), writing `gr_lines.reject_reason`, `condition_notes` and `photos` (C11). The dock slip and `leaks/claims` read the reason.

### PT8. Unit-aware quantity control
- **Anatomy:**
  - **Counted:** PT1/PT6 stepper with 48 px buttons and long-press repeat.
  - **Weighed:** the value shows as a tappable 3-decimal "12.000 ק״ג" field that opens a **keypad sheet**:
    - a 3×4 grid of 64 px keys with "," and ⌫
    - an "הוזמן 12.000" reference line
    - a live variance line "−3.0%" (neutral when ≤10%, warn when >10% [RM-spec])
    - confirm with **אישור**
    - over the threshold, a second tap is required ("לאשר 14.300 ק״ג? (+19%)")
- **Exemplar:** HotSchedules' 3-decimal weight with a confirm on large gaps [W]; Infor/Odoo tolerances [W].
- **RestoMatch use:** `AdjustQuantities.tsx:225–255` (removes ±1 on kg), `inventory/count/count-screen.tsx`, `wizard.tsx` BUILD qty for weighed items.

### PT9. Document camera
- **Anatomy:**
  - A full-screen viewfinder with a quadrilateral overlay (`primary`, 3 px) that snaps to the detected page.
  - Hint text at the top ("החזק מקביל לדף") that changes to "מצלם…" when the frame is stable for 700 ms and then auto-captures.
  - A 72 px manual shutter at the bottom center and a torch toggle.
  - After each page, a 64 px **thumbnail tray** with **+ עמוד** and per-thumb delete.
  - A type segmented control: **חשבונית מס / תעודת משלוח / זיכוי**.
  - The **blur gate** runs before upload (variance-of-Laplacian under a threshold, or mean luminance under a floor) and offers **צלם שוב / השתמש בכל זאת**.
  - **Upload status** per page: בתור / עולה / הועלה / ממתין לרשת.
  - Fallback: the existing file input.
- **Exemplar:** xtraCHEF mobile upload [W]; MarginEdge's capture tips and blur warning [W]; Veryfi edge detection [W].
- **RestoMatch use:** `showcase/receiver/_steps/InvoiceScan.tsx`, `scanPrep.ts` (keep the 2000 px downscale). It opens from the PT6 header.

### PT10. Order status timeline with a supplier diff (incl. substitutions)
- **Anatomy:**
  - **Mobile:** one status chip in the list row ("אושר עם 2 שינויים", warn) and a vertical timeline on the order page with a time per step.
  - **Diff block:** each changed line shows the original quantity struck through, the new quantity in ink, and the ₪ delta at the end via `formatIls()`.
  - **Substitution rows** (P9) carry **אשר תחליף / דחה** (44 px).
  - **Desktop:** the same data as columns, "נשלח · נפתח · אושר", in `orders-table.tsx`.
- **Exemplar:** Rekki message receipts [W]; xtraCHEF Confirm Order [W]; Sysco substitutes [W].
- **RestoMatch use:** `orders/[poId]/supplier-confirm-card.tsx`, `detail-client.tsx`, `orders-table.tsx`, and the receiving card badge.

### PT11. Today's deliveries board
- **Anatomy:**
  - A summary strip (48 px): "היום: 5 משלוחים · 2 התקבלו · 1 באיחור".
  - Time-window section headers.
  - Cards (min 88 px): supplier, window "07:00–09:00", "12 שורות", the status pill (P10 states), and for received cards "2 חריגות · ₪184" (T3/T2 per state).
  - Sort order: arrived/receiving first, then by window.
  - A "ללא תאריך" bucket at the end.
  - Pull-to-refresh.
- **Exemplar:** US Foods MOXē Delivery Tracker [W]; Sysco's today view [W].
- **RestoMatch use:** `receiving/page.tsx` (C8) and the receiver's `/dashboard` overview.

### PT12. Pending-sync chip and offline banner
- **Anatomy:**
  - Header chip "⟳ 3" with the label "ממתינים לסנכרון" (warn) whenever the queue is above 0. Tapping it opens a sheet listing the queued actions ("קבלה — ירקות השרון · 07:41", "צילום עמוד 2") with **נסה שוב**.
  - A 32 px top banner while offline: "אין חיבור — הנתונים נשמרים במכשיר".
  - Unsynced items use a hollow check "נשמר במכשיר" rather than the solid T3 check.
- **Exemplar:** WISK's unsynced-operations count [W]; Sysco's offline ordering [W]; Supy's silent-failure warning [W].
- **RestoMatch use:** `dashboard/layout.tsx` header, `lib/pwa/offlineQueue.ts` (extend it from photos to actions), `ReceiverPwa.tsx`.

### PT13. Team draft → manager send
- **Anatomy:**
  - **Chef BUILD:** the primary is **שלח למנהל לאישור**, plus an optional note field ("נגמר הבצל, צריך עד שישי").
  - **Manager, mobile:** a push card (after the human PR) and a section at the top of `/dashboard/orders`, "ממתין לשליחה (2)". Each row shows "**שף דני** · ירקות השרון · 9 פריטים · ₪640 · נסגר בעוד 1:40" with the primary **שלח לספק** (one tap) and the secondary **ערוך**.
  - **Desktop:** the same rows, with bulk **שלח נבחרים**.
- **Exemplar:** Choco Team order (contributors vs admins) [W].
- **RestoMatch use:** `lib/roles.ts`, a new `orders.createDraftRequest`, `orders/list-client.tsx` (C4).

### PT14. "שכחת משהו?" interstitial
- **Anatomy:**
  - At REVIEW, when items that are usually ordered are missing, show an inline card (not a modal) above the lines.
  - "Usually" means the item appears in ≥3 of the last 4 POs to this supplier [RM-spec].
  - Up to 5 rows, each "בצל יבש · בד״כ 10 ק״ג" with a 48 px **[+]** that adds the usual quantity.
  - Dismiss with **לא, תודה**. It is never shown twice for the same draft.
- **Exemplar:** US Foods MOXē "Did You Forget" [W].
- **RestoMatch use:** `wizard.tsx` REVIEW.

### PT15. Desktop master-detail with bulk and a cross-branch comparison
- **Anatomy:**
  - **≥1280 px:** a list pane (about 40%: dense 40 px rows, sticky column headers, checkbox column, saved filters as tabs) and a detail pane (about 60%: the order or receipt with its PT10 timeline and line diff).
  - Keyboard shortcuts as in P21.
  - The layout uses up to 1600 px.
  - **Chain page:** a branch × supplier matrix with **lines OK %**, **₪ short** and **late %**. Each cell drills into that supplier's receipts for that branch.
  - **Nav:** a side rail grouped by `operations / purchasing / admin` (the groups already exist in `NAV_ITEMS`).
- **Exemplar:** Choco Web's Deliveries report across locations [W]; Supy's Disputed section [W]; Galley's event log [W].
- **RestoMatch use:** `orders/orders-table.tsx`, `approvals/*`, `chain/page.tsx`, `suppliers/ledger`, `layout.tsx`, `nav.tsx` (C14).

---

## 6. Which device each role uses for which job

| Role | Phone, primary (design for 390×844) | Desktop, primary (design for 1440×900) |
|---|---|---|
| **receiver** (מקבל סחורה) | Today's board (PT11), delivery check (PT6/PT7), invoice camera (PT9), dock slip; offline (PT12). | none |
| **chef** (שף) | Inventory count, **draft orders** (PT13), "low items → cart" (P18), recipes. | Recipe and food-cost editing. |
| **manager** (מנהל/ת) | Supplier board with cut-off (PT3), routine orders from the guide (PT1/PT2/PT4), sending chef drafts, repeat order (PT5), supplier diffs (PT10), late-delivery nudges. | Weekly order review, receipt history, disputes. |
| **owner** (בעלים) | Only T2 act-now items: an approval push, the cut-off reminder for a missing order, a large dispute. One-tap approve. | Leak hero, approvals, chain comparison (PT15), supplier ledger, contracts. |
| **bookkeeper** (חשב/ת) | none | Approvals, ledger, exports, consolidated invoices, disputes for ₪ follow-up. |

**Rule of thumb [RM-spec]:** any job done **standing up, with goods in hand, or under time pressure** (driver waiting, cut-off coming) is phone-first and needs **≤10 taps with no keyboard**. Any job that **compares across rows, branches or months** is desktop-first and needs a **dense table with bulk actions**.

---

## 7. Ownership and immutability flags (AGENTS.md)

| Recommendation | Files | Who and how |
|---|---|---|
| Guide (P1), suggested quantity from history (P2 v1), repeat (P6), did-you-forget (PT14), multi-supplier review (P18) | `apps/web/app/dashboard/orders/**`, `packages/api/src/routers/orders.ts` | `web-feature-engineer`. No schema change: derive from `po_lines` and `inventory_counts`. Add COVERAGE entries for new procedures. |
| **Par storage** (P2 v2), supplier **MOV**, **barcode/GTIN** if the column is missing (P23) | new migration + `packages/db/src/schema.ts` | **Human PR** (schema is immutable). New tenant tables go on the `0002_core_tenant_rls.sql` list (also immutable: human PR). |
| Chef drafting (P7, PT13) | `apps/web/lib/roles.ts`, `routers/orders.ts`, `cross-tenant.attack.test.ts` | `web-feature-engineer` plus `tenant-security-warden` review. COVERAGE: **add only**. |
| Receiving order-first, reasons, per-line photo, weight keypad (P11–P14, PT6–PT8) | `dashboard/receiving/[poId]/*`, `app/showcase/receiver/_steps/*` | `web-feature-engineer`. The `gr_lines` columns already exist. The ₪ on the dock slip and claims stays engine-sourced (`matching-engine-guardian` owns the math). |
| Document camera (P15, PT9) | `InvoiceScan.tsx`, `scanPrep.ts` | `ocr-procurement-engineer` (capture into the OCR path) with `web-feature-engineer` (UI). |
| Offline actions (P16, PT12) | `apps/web/lib/pwa/*` | `web-feature-engineer`. Keep the M7 one-receipt-per-PO idempotency. |
| Cut-off and arrival **push** reminders (P20) | `packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts` | **Human PR** (immutable). v1 uses in-app chips only. |
| Desktop rail and wide layout (P21, PT15) | `dashboard/layout.tsx`, `nav.tsx`, `apps/web/app/globals.css` tokens | `web-feature-engineer` plus `rtl-design-steward` (tokens and visual tiers). |
| Any ₪ shown | the `formatIls()` util | Consume only; the util is immutable (`money-format-marshal`). |

---

## 8. Gaps and what I could not verify

- I could not open any help page in full (WebFetch blocked). Labels such as "Start Delivery Check", "Autofill to Par", "Order again" and "Receive outstanding" come from search excerpts of the cited pages, so check the exact wording before copying it.
- The Choco "three taps" figure is a vendor claim, and none of the tap counts in §3 were measured on a device.
- Galley: I found no evidence of a phone receiving app. The three-button pattern is from its **web** receiving page.
- Rekki: I could not confirm photo or WhatsApp ordering. Rekki Connect lists email, voicemail, PDF, CSV and SMS.
- MarketMan, Apicbase and BlueCart: no help-center steps were reachable, only marketing and listings.
- meez has no ordering or receiving features. It informs only P2's recipe → par link.
- Edge detection in the browser (P15), Web Share Target (P19) and BarcodeDetector (P23) are [K]. Test them on the pilot devices (an iPhone with Safari, a mid-range Android) before you commit.

---

## Sources

**Choco**
- https://help.choco.com/en/articles/6572394-how-to-place-or-re-place-an-order
- https://help.choco.com/en/articles/10295755-how-to-place-an-order-for-a-customer
- https://help.choco.com/en/articles/6593247-getting-started-with-choco-placing-your-first-order
- https://help.choco.com/en/articles/8381272-how-to-place-a-team-order
- https://help.choco.com/en/articles/8381277-how-to-do-a-delivery-check
- https://help.choco.com/en/articles/10295858-how-to-confirm-orders
- https://help.choco.com/en/articles/6853398-how-to-edit-orders
- https://choco.com/restaurants
- https://choco.com/us/restaurant-groups
- https://choco.com/us/stories/suppliers/grow-your-business
- https://choco.com/us/press/choco-and-openai-join-forces-to-launch-the-first-ai-voice-agent-for-the-food-service-industry
- https://choco.com/us/stories/suppliers/from-restaurant-app-to-ai-partner-for-distributors-the-evolution-of-choco
- https://apps.apple.com/app/id1385672901

**Rekki**
- https://rekki.com/gb/food-wholesalers/cheesman-brothers
- https://rekki.com/uk/food-wholesalers/le-marche-des-chefs
- https://rekki.com/article/how-do-i-add-a-supplier
- https://rekki.com/article/rekki-connect-order-processing
- https://totalfood.com/this-app-is-making-life-easier-for-new-york-restaurants/
- https://us.fitgap.com/products/022843/rekki

**Ordermentum**
- https://help.ordermentum.com/venue/en/articles/9186945-how-to-place-an-order-in-the-ordermentum-app
- https://help.ordermentum.com/supplier/en/articles/9764933-enabling-and-using-top-up-orders-in-ordermentum
- https://help.ordermentum.com/venue/en/articles/9186942-how-to-manage-your-notification-settings
- https://www.ordermentum.com/blog/venues-start-using-ordermentum
- https://venezianocoffee.com.au/pages/how-to-order-with-ordermentum
- https://apps.apple.com/app/id1271283718

**Restaurant365**
- https://docs.restaurant365.com/docs/r365-app-creating-an-order
- https://restaurant365.freshdesk.com/support/solutions/articles/12000099141-r365-app-creating-an-order
- https://docs.restaurant365.com/docs/r365-app-orders-overview
- https://docs.restaurant365.com/docs/purchase-orders-use-shopping-lists
- https://docs.restaurant365.com/docs/release-notes-may-2024
- https://docs.restaurant365.com/docs/release-notes-new-releases

**Toast xtraCHEF**
- https://support.toasttab.com/article/xtraCHEF-Mobile-Invoice-Uploads
- https://support.toasttab.com/article/xtraCHEF-Order-Guides
- https://support.toasttab.com/en/article/xtraCHEF-Create-Orders
- https://pos.toasttab.com/integrations/xtrachef

**Supy**
- https://help.supy.io/en/articles/8596863-how-to-receive-from-suppliers
- https://help.supy.io/en/articles/11121915-resolving-disputes-in-grn
- https://supy.io/blog/learn-automated-par-level-reordering
- https://supy.io/blog/learn-restaurant-ai-predictive-ordering-multi-site
- https://supy.io/blog/learn-restaurant-stock-count-offline

**Galley**
- https://support.galleysolutions.com/how-do-i-use-the-receiving-workflow
- https://support.galleysolutions.com/how-to-receive
- https://support.galleysolutions.com/receiving-from-orders-ad-hoc-and-invoices

**Apicbase**
- https://mwm.ai/apps/apicbase/1553503445
- https://www.getapp.com/all-software/a/apicbase-food-management
- https://www.hospitalitynet.org/product/5000186/procurement.html

**MarketMan**
- https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management
- https://de.marketman.com/blog/mobile-inventory-counting-software
- https://www.getapp.com/operations-management-software/a/marketman/reviews/

**BlueCart**
- https://softabase.com/en/software/restaurant-management/bluecart
- https://www.trustradius.com/vendors/bluecart-inc
- https://www.cbinsights.com/investor/improvonia

**meez**
- https://www.getmeez.com/2025/organization

**US Foods MOXē**
- https://www.usfoods.com/our-services/moxe-help-center/ordering-on-moxe.html
- https://www.usfoods.com/alerts

**Sysco Shop**
- https://sysco.com/shopmobile
- https://apps.apple.com/app/id1374586010
- https://appsupport.shop.sysco.com/en/articles/15033655-sysco-shop-released-05-12-2026-internal
- https://issuu.com/menu2/docs/21foodie_e29_pages_mr/s/27089213

**MarginEdge**
- https://help.marginedge.com/hc/en-us/articles/218283058
- https://help.marginedge.com/hc/en-us/articles/360035399853-How-do-I-check-the-status-of-invoices-I-ve-uploaded-on-my-phone
- https://help.marginedge.com/hc/en-us/articles/360049496713

**Par-based ordering, other systems**
- https://decisionlogic.atlassian.net/wiki/spaces/CKB/pages/3019472900

**Catch weight**
- https://help.hotschedules.com/hc/en-us/articles/360042714151-Inventory-Restaurants-Ordering-Receiving-and-Counting-Catch-Weight-Products-in-Inventory
- https://docs.infor.com/sxe/2021.x/en-us/sxolh/eiw1589404147150.html
- https://apps.odoo.com/apps/modules/19.0/catchweight

**Offline**
- https://help.wisk.ai/en/articles/4925254-does-the-mobile-app-work-offline

**Edge detection**
- https://www.businesswire.com/news/home/20230323005282/en/Now-Available-for-Building-Mobile-Web-Apps-Veryfi-Provides-User-Friendly-Computer-Vision-and-Document-Capture-Framework
