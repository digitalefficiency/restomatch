# Restaurant-ops & mobile field flows: UX research for RestoMatch

Researcher lens: senior UX researcher, restaurant back-of-house and mobile field work.
Scope: phone receiving at the back door, invoice camera capture, offline/retry, ordering wizards, inventory counts, recipe costing, supplier pages.
Benchmarks: Toast (xtraCHEF, Toast Now, Toast IQ Inventory), Square, MarketMan, Restaurant365, Lightspeed, Craftable, Apicbase, Galley. Adjacent field apps: DoorDash merchant tablet, Shopify POS, MarginEdge, WISK, CrunchTime, BeerBoard SmartBar, Cut+Dry, Decision Logic, warehouse receiving/scanner apps. Platform guidance: Apple HIG, Android Developers, WCAG.
Date: 2026-10-25.

---

## 0. How this was sourced (read this before trusting a number)

| Source class | How reached | Confidence |
|---|---|---|
| **Apple Human Interface Guidelines** (Accessibility, Buttons, Progress indicators, Loading, Feedback, Right to left, Text fields) | Fetched directly (the HIG JSON data endpoints), and the quotes were extracted verbatim | High. Quotes are exact |
| **Android Developers** (Accessibility "48dp", offline-first data layer) | Fetched directly | High. Quotes are exact |
| **Vendor help centers**: Restaurant365 docs, Toast support/xtraCHEF, MarginEdge, Galley, Shopify Help, DoorDash merchant, Square community, Decision Logic, Cut+Dry, BeerBoard, Lightspeed | Read through **web-search result summaries**. The egress proxy blocked direct fetches of these hosts (403 CONNECT / DNS failure), so I could not open the pages themselves | Medium. The facts come from the cited page as the search engine summarized it. Exact UI labels may differ slightly |
| **MarketMan, Craftable, Apicbase, Square for Restaurants** step-level UI | No help-center page surfaced (403, or only marketing pages). Where I describe their UI I mark it **[K]**, meaning my prior knowledge of the product. Verify these in a demo account | Low to medium |
| Practitioner research (Hoober thumb study, field-work glove/glare guidance, warehouse scanner UX) | Web-search summaries | Medium. Labelled as practitioner guidance, not a standard |

Anything tagged **[K]** is knowledge-based and was not verified against a live page in this session. Every RestoMatch observation comes from reading the repo at `/home/user/restomatch` (file paths given) and is **not** taken from live screenshots. The screenshot lab should confirm the fold and size estimates in §3.

---

## 1. Who is in the field, and what the environment does to them

| Role | Where | Device | Hands | Light | Network | Time budget |
|---|---|---|---|---|---|---|
| **Receiver** (מקבל סחורה) | Back door / loading area, beside the driver | Personal Android or shared tablet | Often one hand (the other holds a box or the paper invoice). Sometimes **gloved** (cold room, wet) | Direct sun at the door, or a dim walk-in | Walk-in cold rooms and basements are Wi-Fi dead zones | **The driver is waiting.** Under 2 min for a clean delivery, under 4 min with exceptions |
| **Chef / manager counting** | Walk-in, dry store, bar, freezer | Phone | One hand, cold fingers | Dim, fogged screen | Often offline in walk-in/freezer | 20 to 60 min per full count. Interrupted constantly |
| **Manager ordering** | Office or pass, after the count | Phone or laptop | Two hands | Normal | Online | 3 to 10 min per supplier, close to the supplier cutoff |
| **Owner / bookkeeper** | Office, home | Laptop, sometimes phone | Two hands | Normal | Online | Reads one number |

Design consequence: RestoMatch has **two products in one shell**, a desk "command center for money" and a **field instrument**. The field instrument has to meet a stricter spec (§4) than the desk product. That spec should be a scoped mode (`data-mode="field"` on the receiving, count and capture routes), not a global change.

---

## 2. Benchmark digest: what each one does best

| Product | What they get right (the transferable idea) | Source |
|---|---|---|
| **Toast xtraCHEF** | Mobile capture that detects and corrects the document image. Explicit **"Add page"** loop for multi-page invoices. Choose **Invoice vs Receipt** before capture. Per-location email inbox as a second channel. **Price Tracker** shows average price-change % **and dollar impact**, filterable by vendor. Line-item edit: **"Submit Changes" stays disabled until invoice amount = item subtotal + other charges** | pos.toasttab.com/integrations/xtrachef; Glitter xtraCHEF scan guide; Toast support "xtraCHEF Price Tracker", "Edit Invoice Line Items" |
| **Toast Now / IQ Inventory** | Count lists **mapped to the kitchen layout**, usable **with or without Wi-Fi**. Offline counting in spotty storage areas. **Badges show who already counted what**, so items are neither missed nor double-counted | pos.toasttab.com/products/inventory-management; Toast community "August 2026 product updates (Retail)"; Toast IQ Inventory Overview |
| **Restaurant365** | The best-documented mobile count. **Storage locations in shelf order** (from Storage Location Manager). **Completion % per location**. Enter qty **per unit of measure**, auto-summed to the reporting UoM. Keypad **+ − × ÷**. **Variance flag vs previous count**. Multi-user real time. **Offline entries stored locally and auto-synced**. Count can be completed only when **every location reaches 100%**. **Approval happens on the web**. One trap: *swiping between items does not save the entry* | docs.restaurant365.com (mobile counts overview, count screens, enter a count, multiple count UoMs) |
| **Square** | The receiving primitive: **Receive All / Receive None / per-row Receive with qty** | Square Seller Community (Community Manager answer) |
| **Shopify POS** | **"Receive all"** to complete, or scan items and adjust. A separate **Reject** path. Purchase orders surface as a **smart-grid tile** with an "In transit" tab | help.shopify.com "Receiving purchase orders on Shopify POS"; shopify.dev POS tile |
| **MarginEdge** | Capture discipline: **one page per photo**, keep **all four edges visible with a small border**, tap to focus in dim light, **finish one invoice before starting the next**. A **Pending Uploads count** in the menu. **Per-photo upload status** (Sent / Confirmed) in Invoice History, kept 90 days | help.marginedge.com (photo guide; "check the status of invoices I've uploaded") |
| **BeerBoard SmartBar** | Capture frame that **turns green, and must stay green, before the shot**. Flat surface, nothing obstructing, enough light. A **Preview Invoice Details** screen to approve or delete before commit | support.beerboard.com (orders tab, invoice capture tips) |
| **Lightspeed (O-Series Purchase)** | **Draft orders generated from par levels**. Receiving on iPhone/iPad, **recording discrepancies and attaching invoice photos/PDFs**. Weighted average cost recalculated on receipt | product-info.lightspeedhq.com/lightspeed-restaurant-o-series-purchase |
| **Decision Logic** | **Suggested order = par − pending − on-hand**, overridable (par 6, pending 1, on hand 3 → 2). Order guide sorted **"sheet to shelf"** | decisionlogic.atlassian.net (Digital Manager ordering; sheet-to-shelf) |
| **Galley** | Recipe costing with explicit **trim / preparation / cooking-method yield**, applied at ingredient or preparation level. **"Usage vs Unprepped" toggle** (AP vs EP quantities). EP cost = AP cost ÷ trim yield. Costs update live from EDI or scanned invoices | support.galleysolutions.com (trim yield; yield types); galleysolutions.com/food-costing-framework |
| **Craftable** | Audit flow: **pick storage location → pick sort → filter category → tap item or "Scan Barcode"**. Items carry **bin numbers** (shelf position). Full vs Partial audit | help.craftable.com (taking an audit; storage; bin numbers), via search summary |
| **Apicbase** | Count app with **"Top Count" progress**, **Partial Counts with clear status**, and a **summary step before finalizing**. Recipe library with automated food cost and **profit alerts** | App Store listing (mirror); Capterra/GetApp listings |
| **WISK / CrunchTime** | **Shelves** as a sub-grouping inside an area. Fully **offline** scan/count/create. CrunchTime: **claim an area**, count it, then sync | help.wisk.ai; crunchtime.com blog |
| **Cut+Dry** | Report a receiving issue at check-in: **choose affected items → enter quantities → attach photo → approval workflow → credit** | help.cutanddry.com "Request a credit" |
| **DoorDash merchant tablet** | **One button that changes label as the state advances** (Confirm → **Ready for pickup**). A **"Needs Action" tab** for anything unconfirmed. Auto-confirm vs manual | merchants.doordash.com "Receive and manage orders on your tablet"; help.doordash.com "fulfill orders" |
| **Warehouse receiving apps** | Receiving = **identification → validation → exception handling → confirmation**. Explicit states for **unmatched code, wrong item, duplicate scan, quantity mismatch**. Errors **name the field, the rule, and the next step**. **Offline-first queue** | cleverence.com (mobile scanning receiving); ontego.de (SAP logistics scanner usability) |

---

## 3. What RestoMatch has today in these flows (from code, not screenshots)

| Flow | File(s) | Already strong | Gaps found |
|---|---|---|---|
| Receiving list | `apps/web/app/dashboard/receiving/page.tsx` | Today's expectations as whole-card links. Status badge. "Continue receipt" vs "Open receipt". PWA offline/sync banner with `role=status` | No "next truck" emphasis. Time is `text-xs` muted. No single per-card state CTA (DoorDash pattern). Install prompt mixed into the list |
| Receiving wizard | `.../receiving/[poId]/wizard.tsx`, `app/showcase/receiver/_steps/*` | Scan → Processing → Reconcile → Adjust → Confirm. **Matched lines collapsed, exceptions shown** (`AdjustQuantities.tsx` L82). Preset chips "as ordered / as invoiced / missing / damaged". 48px ± steppers (`w-12 h-12`). Double-tap guard (`capturedRef`, `clientUploadId`). Photo downscale to ≤3 MB / 2000px (`scanPrep.ts`). IndexedDB photo queue when offline (`lib/pwa/offlineQueue.ts`). Background OCR poll 10 min. "Continue with the order" after 30 s. Receiver languages ar/ru/th/ti with Hebrew toggle | (1) `<input type=file accept="image/*,application/pdf">` has **no `capture="environment"`**, so it opens a chooser instead of the camera. (2) **Single page only** (`e.target.files?.[0]`), with no "add page" loop. (3) Upload banner shows a **spinner although `pct` is tracked**. (4) **Estimate:** at 375×667 (iPhone SE), header + back link + step header (`text-3xl`) + progress + a 4:5 viewfinder about 430px tall push the **Capture button below the fold**, and the 72px bottom nav (`4.5rem`) covers more. Verify in the screenshot lab. (5) Quantities and receipt edits are **online mutations**: only photos are queued offline. (6) Chips are 44px (`min-h-11`), below the 48px field spec. (7) The 30 s "continue" offer is late for a driver standing there |
| Dock slip | `.../receiving/[poId]/dock-slip.tsx` | Dispute slip when short/rejected/overpriced/duplicate. 48px buttons | No per-line photo evidence. No driver name/signature capture (verify) |
| Order capture (free text / photo to PO) | `.../orders/capture/capture-client.tsx` | **56px targets (`min-h-14`) and `text-lg` primary**. This is already the field spec | Should be the reference implementation for the other field screens |
| Order wizard | `.../orders/new/wizard.tsx` | 4 steps (Supplier → Build → Review → Sent). Delivery date derived from cadence/cutoff and **confirmed, never silent**. Supplier-document preview. WhatsApp/email channel | **Catalog search first, 8 items, qty defaults to 1.** No order guide, no par/on-hand/suggested qty, no "same as last order". Next/Back use `size="sm"` (`text-xs`, 12px label). Total is not sticky |
| Inventory count | `.../inventory/count/count-screen.tsx` | **Grouped by storage area** with `n/m` per area. `inputMode="decimal"`, `enterKeyHint="next"`, `dir=ltr` qty. Live ₪ value. Sticky finish bar with progress. Variance `check` badge. "Accept uncounted" gate. Price source shown | Area headers are `text-sm` muted and **not sticky**, with no jump chips. **Per-row area `<select>`** invites accidental re-assignment mid-count. **No last-count reference**. Single UoM. **`window.confirm`** for discard. Save is online-only (`saveState='error'`). Progress bar is `h-1.5` (6px). Price source at `text-[11px]` |
| Recipe editor | `.../recipes/recipe-editor.tsx` | Sub-recipes. Yield qty/unit. Menu price incl/excl VAT. Food cost %, margin, net price. Price-alert banner (`dishPriceAlert`). Sticky cost aside on `lg` | On mobile the **cost panel sits after the whole form** (aside follows main). No per-ingredient contribution ranking. No trim/prep yield (AP vs EP). No "why did cost change" attribution in the editor |
| Supplier hub | `.../suppliers/[id]/layout.tsx`, `tab-*.tsx` | Leak ₪ in header (real paid excess, muted when unknown, never estimated). Tabs: details, catalog, contract, leak, ledger, orders, schedule | The default tab does not answer "what do I need to do with this supplier now?" (open claims, pending invoices, price changes). No 1-tap call/WhatsApp in the header (verify) |

Token check (computed from `apps/web/app/globals.css`): ink #0F1F17 on bg = **16.0:1**. muted #4A5D53 = **6.6:1**. subtle #5A6A62 = **5.36:1**. primary #066B4A on white = **6.54:1**. control border #7A8B82 on white = **3.59:1**. All pass AA. **muted and subtle fail the 7:1 field target** proposed in P4.

---

## 4. Principles (22). Each is checkable and mapped to a screen

### Ergonomics: thumb, gloves, glare

**P1. Thumb-zone primary action**
- *Rule:* On every field screen (receiving steps, count, capture, dock slip) there is **exactly one** primary CTA. It is **full width** (viewport − 2×16px gutters), **56px tall**, and **pinned to the bottom** above `env(safe-area-inset-bottom)`. Its bounding box sits **entirely in the bottom 33%** of a 390×844 viewport. Secondary actions are text buttons **above** it, never beside it.
- *Source:* Hoober (UXmatters, 2013): 49% one-handed, 36% cradled, 15% two thumbs, about 75% of interactions by thumb. Apple HIG Buttons: "Keep the number of prominent buttons to one or two per view". "Use style, not size, to visually distinguish the preferred choice".
- *Apply:* `AdjustQuantities.tsx` footer (primary sits inline with a ghost link, so make it full width). `InvoiceScan.tsx` (Capture/Process buttons flow under the viewfinder, so pin them). `Reconciliation.tsx` (two primary-looking buttons, gold + primary, so demote one). `dock-slip.tsx`.

**P2. Field target sizes: 48 minimum, 56 for primary or gloved use**
- *Rule:* In `data-mode="field"` routes every interactive element is **≥48×48 CSS px**, with **≥8px** between adjacent targets. Primary CTAs and ± steppers are **56px**. Text inside any button is **≥16px** (no `text-xs` buttons on field routes). The desk app keeps the existing 44px `pointer:coarse` baseline.
- *Source:* Android Developers: "touch target size of at least 48dp×48dp. Larger is even better" (fetched). Apple HIG: "hit region of at least 44x44 pt". About 12pt padding around bezeled controls, 24pt around bezel-less ones (fetched). Field/construction guidance: 50 to 60px for gloved use.
- *Apply:* Chips `min-h-11` → `min-h-12` (`AdjustQuantities.tsx` L325). Steppers `w-12 h-12` → `w-14 h-14`. Order wizard `size="sm"` buttons → `md`, with 56px on phone. The `.touch-target` utility gets a `field` variant at 48/56.

**P3. No gesture-only actions; glove-safe input**
- *Rule:* Swipe, long-press, pinch and drag are **never the only path** to an action on a field screen. Every swipe has a visible button. Navigating between items **must save** what was typed (an explicit anti-pattern, below).
- *Source:* Restaurant365 count doc: "swipe left or right to move forward or backward… doing so will **not** save the amount entered". That is the trap to avoid. Field glove guidance.
- *Apply:* Count screen (Enter/Next and blur already flush, so keep that guarantee and test it). Any future swipe-to-mark in receiving.

**P4. Glare-proof contrast and redundant status**
- *Rule:* On field routes, **quantities, ₪ and item names render in `ink` (≥7:1)**, never `muted`/`subtle`. No text below **14px** (ban `text-[11px]` on field routes). Status is always **icon + word + colour**, never a tint alone (`bg-primary/8` is decoration, not meaning). Control borders stay at **≥3:1** (current 3.59:1 passes).
- *Source:* Apple HIG Accessibility: 4.5:1 up to 17pt, plus "Use… color, text, sound, and haptics" so feedback survives a silenced device or a look away (fetched). Field guidance: dark text on light at ≥7:1 for sun (practitioner target equal to WCAG AAA).
- *Apply:* `count-screen.tsx` price-source line (`text-[11px] text-subtle`) → 13 to 14px `muted`, or hide on phone. Receiving "ordered / billed" meta lines. Count area header `text-sm text-muted` → `text-base font-semibold text-ink`.

**P5. Focus mode: hide global chrome inside field wizards**
- *Rule:* While in the receiving wizard or an active count, the global bottom nav (72px) is **hidden** and replaced by the flow's own sticky action bar. Leaving the flow requires an explicit "×/back" at the top start.
- *Source:* Shopify POS and DoorDash run receiving/order handling as full-screen task flows [K]. Apple HIG Tab bars preserve section state for *switching sections*, which is the wrong model mid-task (fetched).
- *Apply:* `wizard.tsx` passes `footerBottomClass="bottom-[calc(4.5rem+…)]"` and `count-screen.tsx` uses `bottom-[calc(4.5rem+…)]` because the nav is present. Hide the nav on these routes. That recovers about 72px and removes nav icons sitting right next to the CTA.

### Receiving at the back door

**P6. Exception-first receiving: "everything arrived" is one tap**
- *Rule:* A clean delivery takes **≤3 taps after opening the PO**: Capture → Confirm photo → "הכל התקבל כמו בהזמנה" (everything as ordered). Matched lines are collapsed by default. Only exceptions are expanded, sorted **₪ impact descending**.
- *Source:* Square "Receive All / Receive None / per-row Receive". Shopify POS "Receive all" plus a separate Reject path. isybuy "Receive all". Warehouse model: identification → validation → **exception handling** → confirmation.
- *Apply:* `AdjustQuantities.tsx` already collapses matched lines, so keep it. Add an explicit "receive all as ordered" path **when OCR is slow or failed** (today the receiver waits 30 s). Sort exception cards by |Δ₪|.

**P7. Mirror the paper**
- *Rule:* The receiver checks paper against screen with a finger, so the line order on screen **follows the paper invoice/PO line order**. The **Hebrew item name stays visible** as a secondary line in any receiver language, and every line shows the **ordered qty and the billed qty side by side** in the same unit.
- *Source:* Restaurant365 counts mirror the physical order ("items appear in the same order and grouping defined in the Storage Location Manager"). BeerBoard "Preview Invoice Details" before commit.
- *Apply:* `AdjustQuantities.tsx` / `Reconciliation.tsx` with `HebrewToggle` (keep Hebrew secondary **always on** for ar/ru/th/ti, not behind a toggle). Show `ordered 10 · billed 8 ק״ג` as one row.

**P8. Preset first, stepper second, keypad third**
- *Rule:* Each exception row offers, in this order: **preset chips** (as ordered N / as invoiced N / missing / damaged) → **± stepper (56px)** → **direct entry** (`inputmode="decimal"`, select-all on focus, `enterkeyhint="next"` jumps to the next *unresolved* exception). A resolved row collapses to one line with an "edit" affordance.
- *Source:* Restaurant365 keypad with arithmetic. Apple HIG Text fields: "show the appropriate keyboard type", "Use a number formatter" (fetched).
- *Apply:* `AdjustQuantities.tsx` already has chips and steppers. Add select-on-focus, next-unresolved focus, and collapse-on-settled. The `type="number"` input should become `type="text" inputMode="decimal"` (avoids scroll-wheel changes and locale comma bugs, as `count-screen.tsx` already does).

**P9. Evidence at the moment of dispute**
- *Rule:* Marking a line **missing / damaged / overpriced** offers a **1-tap photo** (optional, rear camera) and adds the line to the dock slip with **₪ at stake**. The slip captures **driver name (and optional signature)** before the truck leaves. The resulting credit claim is **auto-drafted** with the photos attached.
- *Source:* Cut+Dry: choose affected items → quantities → **attach photo** → approval → credit. Lightspeed Purchase: "record discrepancies and attach invoice photos or PDFs". MarketMan: alerts for shorts, subs and credits.
- *Apply:* `dock-slip.tsx` (flag `dockSlip`) → `leaks/claims`. This feeds the North Star directly: ₪ claimed is the T3 good news.

**P10. Status progression on one button (the DoorDash pattern)**
- *Rule:* Each PO card on the receiving list has **one state-labelled CTA** that changes as the delivery advances: "התחל קבלה" → "המשך קבלה (3/12)" → "ממתין לקריאת חשבונית" (T4 neutral) → "נשלח ✓". Anything blocked goes to a **"דורש טיפול" (Needs action)** section at the top.
- *Source:* DoorDash tablet: Confirm → "Ready for pickup" button, "Needs Action" tab.
- *Apply:* `receiving/page.tsx` cards (today: static "receive goods" text + badge). Sort by expected time, with the next truck first and enlarged.

### Camera capture

**P11. Camera opens in one tap, rear lens, one page per photo, "add page" loop**
- *Rule:* "צלם חשבונית" opens the **rear camera directly** (`<input type="file" accept="image/*" capture="environment">`. Keep a separate "upload file/PDF" secondary). After each shot: **"הוסף עמוד" / "סיימתי"**, with a **thumbnail strip** (page 1, 2, 3…), per-page retake and delete. Submit sends all pages as **one invoice**.
- *Source:* xtraCHEF: "tap Add page and photograph each additional page". MarginEdge: "one page per photo… add as many photos as are needed… submit one entire invoice before beginning a new one". BeerBoard: "single images with multiple pages will not allow the software to accurately scan".
- *Apply:* `InvoiceScan.tsx` (today: no `capture`, `files?.[0]` only). Israeli consolidated invoices (חשבוניות ריכוז) and delivery notes are often 2 to 4 pages, so this is a correctness fix, not polish.

**P12. Coach the shot, check quality in under 1 s, name the fix**
- *Rule:* The viewfinder shows **four corner guides + a single-line hint** ("כל 4 הפינות בתוך המסגרת · משטח שטוח · בלי שמש ישירה"). After capture, a **client-side quality check (<1 s)** flags *too dark / blurry / cropped / too small* (short edge <1000px) with a **specific** retake reason. Never a generic "upload failed".
- *Source:* MarginEdge: all four edges visible with a little border, tap to focus in dim light. BeerBoard: flat surface, nothing obstructing, **capture box turns, and stays, green before the shot**, avoid direct sunlight (reflections). xtraCHEF "detects and corrects the image".
- *Apply:* `InvoiceScan.tsx` corners exist (`viewfinder-corner`) and `scanPrep.ts` already re-encodes. Add a blur/brightness heuristic (Laplacian variance / mean luminance on the downscaled canvas) and map it to i18n reasons.

**P13. Determinate, honest progress; never block the receiver**
- *Rule:* Upload shows a **determinate bar with %** (the state already has `pct`). OCR shows **named stages** ("מעלה 62%" → "קורא שורות" → "משווה להזמנה"). At **10 s** the receiver is offered "המשך לפי ההזמנה, החשבונית תושלם ברקע" (continue by the order, the invoice completes in the background). Today's offer comes at 30 s. Progress never sits stationary for more than 2 s without a label change.
- *Source:* Apple HIG Progress: "When possible, use a determinate progress indicator", "Keep progress indicators moving… a stationary indicator [reads as] a stalled process", "Avoid vague terms like *loading*". HIG Loading: "Show something as soon as possible", "Let people do other things… while they wait" (all fetched). Nielsen's 10-second attention limit [K].
- *Apply:* `UploadStatusBanner` in `InvoiceScan.tsx` (spinner → bar). `STILL_READING_AFTER_MS = 30_000` in `wizard.tsx` → 10 000. `Processing.tsx` stage labels.

### Offline, retry and resilience

**P14. Local-first writes with a visible queue for every field action**
- *Rule:* Photos, receipt quantities, condition marks and **count entries** write to **IndexedDB first**, then sync. A persistent chip shows **"3 ממתינים לשליחה"** whenever the queue is non-empty, and a tap opens the list with per-item status (*queued / sending / sent / failed, retry*). Nothing typed is lost on reload, tab kill or app switch.
- *Source:* Android offline-first: "The local data source… should be the exclusive source of any data that higher layers of the app read". "**Lazy writes**: write to the local data source first, then queue the write… correct choice when the data is critical" (fetched). Restaurant365: "Counts recorded while offline are stored locally and sync automatically". Toast Now offline counting. WISK fully offline. MarginEdge "Pending Uploads" count + per-photo status.
- *Apply:* `lib/pwa/offlineQueue.ts` covers **photos only** (flag `receiverPwa`). Extend it to receipt marks (`AdjustQuantities`) and count lines (`count-screen.tsx`, where today `saveState==='error'` just shows text).

**P15. Retry policy: automatic, bounded, idempotent**
- *Rule:* Failed sends retry with **exponential backoff of 2, 4, 8, 16, 32 s, capped at 60 s**, immediately on the `online` event, and on app foreground. **Do not retry auth/4xx validation errors**: surface them with a fix. Every write carries a **client UUID** (already done for uploads, M8) so a retry can never double-post. The primary button enters the loading state **≤100 ms** after tap and stays disabled until resolved.
- *Source:* Android offline-first: "exponential backoff… do retry network calls that… indicate a lack of connectivity. Don't retry HTTP requests that are not authorized" (fetched). Apple HIG Buttons: "Always include a press state" (fetched).
- *Apply:* `ReceiverPwa.tsx` `processQueue` (verify its backoff schedule). Count mutations. Dock slip send.

**P16. Resume anywhere, on shared devices**
- *Rule:* A receiving or count in progress is **server-draft + local mirror**. Reopening the PO resumes **at the same step with the same entries**, and the list shows "המשך מ-07:42 · 5/12 שורות". On shared tablets, queued items upload **only under the user who created them** (already enforced) and an idle lock asks "זה עדיין אתה?" after N minutes.
- *Source:* Restaurant365 multi-user real-time counts. Toast "badges show who's already counted what". RestoMatch's own `PwaSessionGuard.tsx`.
- *Apply:* Receiving list "continue" card. `wizard.tsx` step persistence. Count claim per area (P18).

### Inventory count

**P17. The count follows the walk (shelf to sheet)**
- *Rule:* Count lines are grouped by **storage area in walk order** (configurable once, not per count) and within an area by **shelf/bin order**, never alphabetically. A **sticky area header** shows `name · 7/12 · ₪ value`, and a horizontal **area chip bar** jumps between areas with a completion ring on each chip. Re-assigning an item's area happens in an **"edit layout" mode**, not inline during a count.
- *Source:* Restaurant365: storage locations + completion %, order from Storage Location Manager. Craftable: pick storage location then sort, bin numbers. WISK shelves. Toast: "count lists mapped to your unique kitchen setup". Decision Logic "sheet to shelf".
- *Apply:* `count-screen.tsx` (`byArea` grouping exists. Header not sticky, no chips, inline `<select>` per row, so move it to edit mode).

**P18. Fast numeric entry: next-item flow, multi-unit, reference, variance**
- *Rule:* (a) Enter/Next moves to the **next uncounted item in the same area**, then to the next area. (b) Items with several count units show **one row per unit** (e.g., "ארגז ×24" and "יח׳"), **auto-summed** to the inventory unit with the result shown live. (c) Show **last count as a muted reference** ("בפעם הקודמת 12 ק״ג"), **not prefilled**: prefill invites blind acceptance. (d) Flag entries that deviate **>50% or >2× from the last count** (tunable) with a warn badge and a one-tap "נכון, השאר" (yes, keep it).
- *Source:* Restaurant365: qty per UoM, auto-totalled to reporting UoM. Keypad +−×÷. "discrepancies… between the previous count and the current count will display an alert flag". Prefill avoidance is [K] (anchoring in data entry).
- *Apply:* `count-screen.tsx` (`enterKeyHint="next"` exists but focus advance should be explicit. `l.check` badge exists: define its threshold and add the confirm action).

**P19. Completion gating and approval split**
- *Rule:* "סיים ספירה" is enabled when **every area is 100%** *or* the user explicitly accepts the listed uncounted items (already implemented). Several counters can split areas (**claim an area**, avatar on the chip). The **approval/close** of a period happens on desktop by a closer role, and the phone just says "נשלח לאישור".
- *Source:* Restaurant365: "After all storage locations reach 100%… can be reviewed and completed. Approval from a web browser". CrunchTime: claim an area. Apicbase: summary step before finalizing.
- *Apply:* `count-screen.tsx` finish bar (keep `acceptUncounted`. Add an area claim. Replace `window.confirm` discard with an inline confirm + 8 s undo).

### Ordering

**P20. Order from a guide, not a search box**
- *Rule:* The Build step opens on the supplier's **order guide**: every item ordered from this supplier in the last 90 days, in **shelf order**, each with **on-hand (last count) · par · suggested qty = max(0, par − on-hand − pending)** prefilled and editable. Shortcuts: **"כמו בהזמנה הקודמת"** (same as last order) and **"לפי ספירה"** (by count). Search is secondary, for adding something new. A **sticky bottom bar** shows `N פריטים · ₪ total · supplier minimum` and the single "המשך" (continue).
- *Source:* Decision Logic: suggested = par − pending − on-hand (par 6, pending 1, on hand 3 → 2), sheet-to-shelf order guide. Lightspeed: **draft orders from par levels**. Toast: order guide **from a count**. MarketMan order guides [K].
- *Apply:* `orders/new/wizard.tsx` (today: catalog search, 8 items, qty=1, total not sticky, `size="sm"` buttons). Data exists: count lines (`inventory`), past POs (`orders`), contract prices (`contract-price.tsx`).

**P21. The review shows what the supplier will receive, the date and the channel**
- *Rule:* Review = the **literal outgoing document** (WhatsApp text / email PDF preview), the **delivery date with its cutoff reasoning** ("ההזמנה תגיע ביום ג׳: עברנו את שעת הסגירה 14:00"), and the channel. One primary CTA, **"שלח לספק ב-WhatsApp"**, names the channel. After send: the status, and an "undo/cancel within 2 min" window if the channel allows.
- *Source:* DoorDash single-state CTA. Toast "send orders directly to suppliers". RestoMatch's own derived-date rule (never silent).
- *Apply:* `orders/new/wizard.tsx` REVIEW/SENT steps, `order-document-preview.tsx`, `supplier-document.tsx` (already strong: make the CTA label channel-specific and full width on phone).

### Recipe costing and supplier hub

**P22. Cost is always in view, explained, and yield-aware**
- *Rule:* (a) On phone, a **sticky bottom summary** shows `עלות מנה ₪X · עלות מזון Y% (יעד Z%)`, coloured by tier (T3 calm when at or under target, T2 warn when over), with a tap to expand the full panel. On desktop the existing `lg:sticky` aside stays. (b) Ingredients can be **sorted by cost contribution** with a share bar and %. (c) Each ingredient carries a **yield %** (trim/prep), and an **AP ↔ EP toggle** shows purchased vs usable quantity and cost (EP = AP ÷ yield). (d) When cost moved, show **which ingredient moved it and by how much in ₪** ("+₪0.80 למנה · עגבניות +18% אצל ירקות הכרם").
- *Source:* Galley: trim/prep/cooking yields, "Usage vs Unprepped" toggle, EP cost = AP ÷ trim yield (vendor claim: skipping it understates produce/protein cost 5 to 15%). xtraCHEF Price Tracker: price-change % **and $ impact**. Apicbase: automated food cost + profit alerts.
- *Apply:* `recipe-editor.tsx` (aside renders after the form on mobile. No yield per ingredient. `PriceAlertLine` exists, so extend it to per-ingredient attribution in the editor).

**(Supplier hub, folded into P22's ₪ logic)**
- *Rule:* The supplier page's **first screen answers "what do I do with this supplier now?"**: (1) leak ₪ (exists), (2) **act-now row**: open credits to claim ₪, invoices awaiting approval ₪, price increases since last order (count + ₪ impact), (3) **next delivery + cutoff**, (4) **1-tap call / WhatsApp** (56px). Tabs follow below.
- *Source:* xtraCHEF Price Tracker (filter by vendor, $ impact). MarketMan alerts for shorts/subs/credits. DoorDash "Needs Action".
- *Apply:* `suppliers/[id]/layout.tsx` + default tab `page.tsx`.

---

## 5. Patterns (15). Exemplar, then the RestoMatch build

| # | Pattern | Exemplar | RestoMatch use (screen + concrete spec) |
|---|---|---|---|
| 1 | **Receive-all + exceptions** | Square "Receive All / None / row Receive". Shopify POS "Receive all" + Reject | Receiving ADJUST: a green "הכל התקבל כמו בהזמנה (12)" full-width button appears **above** exception cards when there are 0 exceptions, or when OCR is slow/failed. Exceptions are sorted by |Δ₪| |
| 2 | **Multi-page capture loop with thumbnail strip** | xtraCHEF "Add page". MarginEdge one page per photo | `InvoiceScan.tsx`: after a shot → preview + "הוסף עמוד" (secondary) + "סיימתי, שלח N עמודים" (primary 56px). Thumbnail strip 64×80px, per-page × to delete, tap to retake. Max 10 pages |
| 3 | **Green-lock capture frame** | BeerBoard SmartBar (box turns and stays green) | Viewfinder corners go from neutral to primary-green when the post-capture quality check passes. When it fails, the corners turn warn-orange and show a one-line reason ("כהה מדי, הדלק אור או התקרב לדלת"). On the web this is post-capture, not live |
| 4 | **Pending-uploads inbox** | MarginEdge "Pending Uploads" count + per-photo Sent/Confirmed | `ReceiverPwa.tsx` banner → persistent header chip "↑ 3" + sheet listing each queued photo/entry with status and "נסה שוב". Keep 14 days of sent history for the receiver ("did my photo go through?") |
| 5 | **Continue-while-processing** | MarginEdge/xtraCHEF async processing. HIG "let people do other things while they wait" | `Processing.tsx`: at 10 s, "המשך לפי ההזמנה" (primary) + "חכה לחשבונית" (text). When OCR lands later, a toast "החשבונית נקראה: 2 הפרשים חדשים" opens the reconcile view |
| 6 | **Storage-area count sheet** | Restaurant365 locations + completion %. Craftable storage → sort. WISK shelves. Toast layout-mapped lists | `count-screen.tsx`: sticky area header (`text-base font-semibold ink`, `7/12 · ₪1,240`), horizontal chip bar of areas with completion rings (44px chips, scroll-snap), walk order set once in "סדר אזורים" settings |
| 7 | **Multi-unit keypad entry** | Restaurant365 "qty for each available unit of measure", auto-summed, keypad +−×÷ | Count line expands to rows per pack unit: `[ארגז ×24] [__]`, `[יח׳] [__]` → "= 53 יח׳" live. Accept simple arithmetic `2*24+5` in the field and show the evaluated result before commit |
| 8 | **Variance flag vs last count** | Restaurant365 alert flag between previous and current count | `l.check` badge with threshold: |current − last| > max(50% of last, 2 units) → warn badge "חריג מהספירה הקודמת (12)". One tap "נכון" clears it. The finish dialog lists unresolved flags (exists as `checkWarn`) |
| 9 | **Par-based suggested order** | Decision Logic (par − pending − on-hand). Lightspeed draft orders from par | `orders/new` BUILD: each guide row shows `במלאי 3 · פאר 6 · בדרך 1 → מוצע 2` with qty prefilled to 2 and ± 56px steppers. Rows with suggestion 0 are collapsed under "לא צריך להזמין (14)" |
| 10 | **Sheet-to-shelf order guide** | Decision Logic sheet-to-shelf. Restaurant365 storage order | Order-guide rows use the **same walk order** as the count, so a manager can order while standing in the store room |
| 11 | **Dock discrepancy report → credit** | Cut+Dry (items → qty → photo → approval → credit). Lightspeed (discrepancies + photos) | `dock-slip.tsx`: per-line photo button (48px camera icon), driver name field, "שלח לספק" + auto-draft in `leaks/claims` with ₪ and photo evidence. On confirm: T3 calm gold "₪184 נכנסו לתביעה" |
| 12 | **Vendor price tracker with ₪ impact** | xtraCHEF Price Tracker (avg change %, $ impact, by vendor) | Supplier hub act-now row: "3 מוצרים התייקרו מאז ההזמנה הקודמת · ₪212 בחודש". Same data powers the recipe-editor ingredient attribution |
| 13 | **AP ↔ EP yield toggle** | Galley "Usage vs Unprepped" + trim/prep/cook yields | `recipe-editor.tsx`: per-ingredient yield % field (default 100, quick presets 90/80/70/60 from the product), segmented toggle "כמות קנייה / כמות נטו". Cost uses EP |
| 14 | **One button, state-labelled** | DoorDash Confirm → "Ready for pickup". "Needs Action" tab | Receiving list cards: one CTA whose label is the next state ("התחל קבלה" / "המשך 3/12" / "ממתין לחשבונית" neutral / "הושלם ✓"). A "דורש טיפול" group pinned on top |
| 15 | **Submit unlocks only when totals reconcile** | xtraCHEF: "Submit Changes" available once invoice amount = item subtotal (+ other charges) | Invoice line edit (`invoices/[invoiceId]`) and reconciliation: show a live "חסר ₪12.40 להתאמה" delta chip. Disabled submit with that reason as visible text, not a tooltip |

---

## 6. Field-mode spec sheet (the numbers in one place)

| Token / rule | Value | Applies to |
|---|---|---|
| Min target (field) | **48×48 CSS px** | All controls on `/dashboard/receiving/**`, `/dashboard/inventory/count`, `/dashboard/orders/capture`, dock slip |
| Primary CTA | **56px** high, full width − 32px, bottom-pinned, `pb-[env(safe-area-inset-bottom)]` | One per screen |
| ± stepper | **56×56**, gap ≥8px from the input | Receiving adjust, order guide rows |
| Chips | **48px** high, 16px horizontal padding, ≥8px gap | Preset chips, area chips (44px allowed for horizontally scrolling area chips) |
| Spacing between targets | **≥8px** (Apple about 12pt around bezeled) | Everywhere in field mode |
| Body text | **16px** min (Apple default body 17pt). Item names 17px semibold | Field mode |
| Quantities / ₪ | **24px** bold `tabular-nums`, `<bdi dir="ltr">` | Count, receiving, order guide |
| Minimum text | **14px**. No `text-[11px]` / `text-xs` labels on field routes | Field mode |
| Contrast | Numerals/names **≥7:1** (`ink`). Other text ≥4.5:1. Control borders ≥3:1 | Field mode |
| Press feedback | Visual pressed state **≤100 ms** (`active:` style). Loading state on async buttons immediately | All buttons |
| Local save ack | "נשמר במכשיר" **≤300 ms** after blur/Enter. "נשלח" when the server acks | Count, receiving marks |
| Offer to continue during OCR | **10 s** (today 30 s) | `wizard.tsx` |
| Background OCR poll | 10 min (keep) | `wizard.tsx` |
| Retry backoff | 2, 4, 8, 16, 32, 60 s cap, plus on `online` + `visibilitychange` | Offline queue |
| Undo window for destructive actions | **8 s** toast with "בטל" | Discard count, remove line, reject item |
| Photo upload | ≤3 MB, long edge 2000px, JPEG ~0.8 (keep, `scanPrep.ts`) | Capture |
| Quality gate | short edge ≥1000px, brightness and blur heuristics, verdict ≤1 s | Capture |
| Multi-page | up to 10 pages per invoice, thumbnails 64×80 | Capture |
| Haptics (Android only) | success `navigator.vibrate(20)`. Exception `vibrate([30,60,30])`. Never the only signal. iOS Safari has no Vibration API [K] | Scan accepted, exception flagged |

---

## 7. Anti-patterns to ban in field flows

1. **Navigating away loses the entry** (Restaurant365's swipe trap). Every navigation flushes.
2. **`window.confirm()`** (seen in `count-screen.tsx` discard). Use an inline confirm or an undo toast: native dialogs are tiny, unstyled, untranslated in some WebViews, and easy to mis-tap with gloves.
3. **Two equally prominent buttons** at the decision point (`Reconciliation.tsx` has gold + primary side by side). One primary, the rest text.
4. **Spinner with "Loading…"** when progress is knowable (HIG). Upload already tracks `pct`.
5. **Search box as the first step of ordering.** Managers re-order the same 30 items: show them.
6. **Inline structural edits mid-task** (per-row area `<select>` during a count).
7. **Status by tint alone** (`bg-*/8` cards with no icon or word).
8. **Red for "still processing"**: pending OCR / consolidated invoice is T4 neutral, never a false alarm (per AGENTS.md).
9. **Prefilling counts with last values.** Show them as a reference, never as the value.
10. **Global nav visible inside a wizard.** It steals 72px and puts exits beside the CTA.

---

## 8. Acceptance checklist (automatable with Playwright at 390×844 and 375×667)

- [ ] On every field route, every `button, a, [role=button], input, select` has a bounding box ≥48×48 (excluding inline links in paragraphs).
- [ ] The single primary CTA's `boundingBox.y ≥ 0.66 × viewport.height` and width ≥ viewport − 40px. Exactly one element is marked `data-primary` per screen.
- [ ] At 375×667 the Capture button is visible without scrolling on `/dashboard/receiving/[poId]`.
- [ ] `InvoiceScan` file input has `capture="environment"` and the flow supports ≥2 pages before submit.
- [ ] Upload shows `role="progressbar"` with `aria-valuenow` updating (not only a spinner).
- [ ] `context.setOffline(true)` → enter 3 count values + 1 receiving mark → reload → values still present, queue chip shows "3"/"1" → `setOffline(false)` → queue drains to 0 within 10 s.
- [ ] Count: Enter on the last item of area A focuses the first uncounted item of area B. Area header stays visible while scrolling (sticky).
- [ ] No `window.confirm`/`alert` calls under `app/dashboard/{receiving,inventory,orders/capture}` (grep gate).
- [ ] No `text-[11px]`, `text-[10px]` or `text-xs` on interactive labels in field routes (lint rule / grep gate).
- [ ] Order wizard BUILD renders the order guide with suggested quantities before any search input is focused.
- [ ] Recipe editor at 390px: food-cost % is visible without scrolling at any scroll position (sticky summary).
- [ ] Global bottom nav is absent on `/dashboard/receiving/[poId]` and `/dashboard/inventory/count`.

---

## 9. Priority (impact on the ₪ North Star × effort)

| Pri | Change | Why it matters for ₪ | Effort |
|---|---|---|---|
| **P0** | Multi-page capture + `capture=environment` (P11, pattern 2) | A missed page means a missed leak line. Consolidated invoices are multi-page | S to M |
| **P0** | Offline queue for receipt marks and count entries (P14/P15) | Lost receiving data means no evidence and no claim | M |
| **P0** | Pinned 56px primary + focus mode (P1, P5) | Completion rate at the door. Every abandoned receipt is a leak we never see | S |
| **P1** | Dock evidence → auto-drafted claim (P9, pattern 11) | Converts leak into ₪ recovered (T3) | M |
| **P1** | Order guide + par suggestions (P20, patterns 9/10) | Fewer emergency orders at off-contract prices | M |
| **P1** | Count: sticky areas, chips, next-item, last-count reference, variance threshold (P17/P18) | Accurate actual food cost, so the leak number is believable | M |
| **P2** | Determinate upload + 10 s continue (P13) | Driver wait time, perceived speed | S |
| **P2** | Recipe sticky summary + yield + ₪ attribution (P22, pattern 13) | Explains *why* margin moved, tied to supplier price leak | M |
| **P2** | Supplier hub act-now row + price tracker (pattern 12) | Surfaces ₪ to claim or negotiate per supplier | S to M |

---

## 10. Sources

**Fetched directly (verbatim quotes used):**
- Apple HIG, Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple HIG, Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG, Progress indicators: https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- Apple HIG, Loading: https://developer.apple.com/design/human-interface-guidelines/loading
- Apple HIG, Feedback: https://developer.apple.com/design/human-interface-guidelines/feedback
- Apple HIG, Right to left: https://developer.apple.com/design/human-interface-guidelines/right-to-left
- Apple HIG, Text fields: https://developer.apple.com/design/human-interface-guidelines/text-fields
- Android, Make apps more accessible (48dp): https://developer.android.com/guide/topics/ui/accessibility/apps
- Android, Build an offline-first app: https://developer.android.com/topic/architecture/data-layer/offline-first

**Read through web-search summaries (direct fetch blocked by the proxy):**
- Toast xtraCHEF integration: https://pos.toasttab.com/integrations/xtrachef
- xtraCHEF scan & submit guide (Glitter): https://www.glitter.io/guides/scan-submit-invoices-xtrachef
- xtraCHEF Price Tracker: https://support.toasttab.com/en/article/xtraCHEF-Price-Tracker
- xtraCHEF Edit Invoice Line Items: https://support.toasttab.com/en/article/xtraCHEF-Editting-Invoice-Line-Items
- xtraCHEF Action Needed invoices: https://intercom.help/toast-central/en/articles/14727783-xtrachef-action-needed-invoices
- Toast inventory management: https://pos.toasttab.com/products/inventory-management
- Toast August 2026 product updates (Retail): https://community.toasttab.com/t5/product-updates/august-2026-product-updates-retail/td-p/19131
- Toast IQ Inventory Overview: https://support.toasttab.com/en/article/Toast-IQ-Inventory-Overview
- Restaurant365 mobile inventory counts overview: https://docs.restaurant365.com/docs/mobile-inventory-counts-overview
- Restaurant365 count / storage location / item count screens (mobile): https://docs.restaurant365.com/docs/inventory-count-screens-mobile
- Restaurant365 manually enter an inventory count (mobile): https://docs.restaurant365.com/docs/enter-an-inventory-count-mobile
- Restaurant365 multiple count UoMs: https://docs.restaurant365.com/docs/inventory-counts-using-multiple-count-u-of-ms
- Restaurant365 new inventory counts overview: https://docs.restaurant365.com/docs/new-inventory-counts-overview
- Restaurant365 R365 app create & enter counts: https://docs.restaurant365.com/docs/r365-app-create-and-enter-inventory-counts
- Square partial receiving (Community Manager): https://community.squareup.com/t5/Orders-Menu-Items-Catalog/How-can-I-track-my-purchases-items-from-my-vendor-using-Square/m-p/161509
- Square retail counting: https://squareup.com/au/en/point-of-sale/retail/features/inventory-counting
- Shopify POS receiving purchase orders: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/stocky/pos-inventory-management/receiving-purchase-orders
- Shopify POS UI extensions tile: https://shopify.dev/docs/api/pos-ui-extensions/latest/web-components/actions/tile
- MarketMan purchasing: https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management
- MarketMan mobile invoice processing: https://es.marketman.com/blog/marketmans-mobile-app-makes-invoice-processing-quick-and-easy
- Lightspeed Restaurant O-Series Purchase: https://product-info.lightspeedhq.com/lightspeed-restaurant-o-series-purchase/
- Lightspeed X-Series scanner receiving: https://x-series-support.lightspeedhq.com/hc/articles/5770498737551
- Craftable taking an audit: https://help.craftable.com/learning/taking-an-audit
- Craftable inventory storages: https://help.craftable.com/learning/creating-inventory-storages
- Craftable bin numbers: https://help.craftable.com/learning/how-do-i-assign-indivudal-items-to-storage-areas-assigning-individual-items-to-storage-areas
- Apicbase app listing: https://mwm.ai/apps/apicbase/1553503445 . Capterra: https://www.capterra.com/p/171584/APIC-Kitchen-Manager
- Galley trim yield: https://support.galleysolutions.com/how-do-i-account-for-trim-yield
- Galley yield types: https://support.galleysolutions.com/what-is-the-difference-between-trim-yield-preparation-yield-cooking-method-yield-percentage-and-recipe-yield
- Galley food costing framework: https://www.galleysolutions.com/food-costing-framework
- MarginEdge upload status: https://help.marginedge.com/hc/en-us/articles/360035399853-How-do-I-check-the-status-of-invoices-I-ve-uploaded-on-my-phone
- MarginEdge photo guide: https://help.marginedge.com/hc/en-us/articles/218822667
- BeerBoard SmartBar orders/invoice capture: https://support.beerboard.com/knowledge/orders-tab . Tips: https://support.beerboard.com/knowledge/invoice-capture-tips
- Cut+Dry request a credit: https://help.cutanddry.com/en_US/orders-order-guides/request-a-credit-for-a-customer
- isybuy receive on mobile: https://support.isybuy.com/hc/en-gb/articles/360013740920-Receive-an-order-on-the-mobile-application-from-the-Orders-tab
- Decision Logic ordering (suggested qty): https://decisionlogic.atlassian.net/wiki/spaces/CKB/pages/3019472900
- Decision Logic sheet-to-shelf & PARs: https://decisionlogic.atlassian.net/wiki/spaces/CKB/pages/2888695854
- DoorDash tablet orders: https://merchants.doordash.com/en-us/learning-center/receive-orders-on-your-doordash-tablet . https://help.doordash.com/en-au/merchants/article/fulfill-orders
- WISK shelves: https://help.wisk.ai/en/articles/5327682-using-shelves . Offline: https://help.wisk.ai/en/articles/4925254
- CrunchTime inventory app: https://www.crunchtime.com/blog/discover-crunchtimes-new-inventory-app
- Hoober, How do users really hold mobile devices: https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- Field/glove/glare guidance: https://thisisglance.com/learning-centre/how-should-i-design-apps-for-construction-workers
- Warehouse receiving workflows: https://www.cleverence.com/articles/business-blogs/mobile-scanning-receiving-4729/
- SAP logistics scanner usability: https://ontego.de/en/about-us/blogs/sap-logistics-ux-mobile-scanner-usability

**Knowledge-based [K] (verify in demo accounts):** MarketMan order-guide UI details. Shopify POS / DoorDash full-screen task flow. iOS Safari lacks the Vibration API. Nielsen response-time limits (0.1 / 1 / 10 s). Anchoring risk of prefilled counts.
