# Mobile / PWA field-work technology and ergonomics: benchmark for RestoMatch

**Date:** 2026-10-25 · **Researcher lens:** senior product/UX, field operations · **Scope:** receiver at the back door, chef in the walk-in, floor manager ordering (mobile); owner, bookkeeper and chain owner (desktop).
**Owner direction this serves:** benchmark the newest ERP and advanced ordering/procurement systems; most work happens on mobile; bosses work on desktop and need it organised much more efficiently; functionality matters as much as looks.

---

## 0. Method and how far to trust each claim

- **Repo read first.** The screen names, file paths and current behaviour below come from reading `apps/web/app/dashboard/*`, `apps/web/lib/pwa/*`, `apps/web/lib/roles.ts`, `apps/web/app/globals.css` and `packages/ui-tokens/src/index.ts` at HEAD.
- **Web access.** `WebFetch` and `curl` were **blocked by the egress proxy** in this session (`connect_rejected` for web.dev, developer.mozilla.org, m3.material.io and w3.org). `WebSearch` worked, so most claims tagged **[S#]** rest on the search-result text of the cited page, not a full read of it. The Apple HIG and Android offline-first quotes **are** full-text: another researcher had already saved those pages in `scratchpad/ux/research/apple/*` and `web/*`, and I read them there.
- **Tags:** **[S#]** = sourced (list in §9). **[HIG]** = Apple HIG text read locally. **[K]** = my own platform knowledge, not re-verified in this session. Check [K] items on a real device before you rely on them. **[Code]** = observed in this repo.
- **Market fact that drives the budget:** in Israel, Android has **66.6%** of mobile OS share and iOS **33.4%** (Statcounter, Aug 2026) [S24]. So the median field device is a mid- or low-end Android running Chrome, and the iPhone third needs fallbacks for every Chromium-only API.

---

## 1. Who works where: role → device → RestoMatch screens

| Role (`lib/roles.ts`) | Main device / posture | Main RestoMatch screens | Conditions |
|---|---|---|---|
| `receiver` (shift manager at the door) | Personal Android phone, one hand, other hand holding a crate or the driver's slip | `/dashboard/receiving` (inbox) → `/dashboard/receiving/[poId]` (wizard: SCAN_INVOICE → PROCESSING → RECONCILIATION_REVIEW → ADJUST_QUANTITIES → CONFIRMED), dock slip | Back alley, sunlight or a dark corridor, wet or cold hands, gloves, driver waiting (time pressure), weak signal |
| `chef` | Phone, sometimes a kitchen tablet | `/dashboard/inventory/count` (count-screen), `/dashboard/recipes/*` | Walk-in fridge at 2–4 °C (no signal, fogging, gloves), greasy fingers |
| `manager` (floor manager) | Phone during service, desktop after close | `/dashboard/orders/new` (wizard SUPPLIER → BUILD → REVIEW → SENT), `/dashboard/orders/capture` (paste/share WhatsApp text), `/dashboard/approvals`, receiving | Interrupted every 30–90 s; one-handed; ordering for tomorrow's deliveries before the supplier cut-off |
| `owner` | Phone for alerts, approve-on-the-go; desktop for weekly money review | `/dashboard` (leak hero), `/dashboard/leaks/*`, `/dashboard/approvals` + `/approvals/pay-run`, `/dashboard/chain`, `/dashboard/reports/monthly` | Push-driven on mobile; on desktop, batch review across branches |
| `bookkeeper` | Desktop, keyboard + mouse, two monitors | `/dashboard/approvals`, `/dashboard/invoices/[invoiceId]` (incl. consolidated-panel), `/dashboard/exports`, `/dashboard/suppliers/ledger`, `/dashboard/integrations` | Volume work: dozens of invoices per sitting, month-end close |

---

## 2. What RestoMatch already does well, and the gaps (code audit)

**Strengths already in the code (keep them):**
- **Receiver PWA exists** (flag `receiverPwa`). It has a manifest (`public/pwa/manifest.webmanifest`, `lang: he`, `dir: rtl`, `display: standalone`, `share_target`), a service worker at `app/receiver-sw.js/route.ts` that caches only public assets plus `offline.html` and never caches authenticated HTML, an **IndexedDB offline photo queue** keyed by `clientUploadId` so retries map to the same invoice (M8 idempotency) (`lib/pwa/offlineQueue.ts`), and an "installed mode" CSS that sets a **56 px** minimum height on buttons, links and inputs [Code].
- **Coarse-pointer floor:** `@media (pointer: coarse)` raises buttons, inputs, selects and tabs to **44 px** (`globals.css` ~l.415) [Code].
- **Bottom bar + drawer on mobile:** `MobileNav` portals a bottom bar (4 destinations + "עוד") above `env(safe-area-inset-bottom)` [Code].
- **Count screen is mobile-first:** `inputMode="decimal"`, `enterKeyHint="next"`, `dir="ltr"`, 16 px text (no iOS zoom), 700 ms debounced autosave that flushes when the tab hides, and a pinned finish bar with progress and live ₪ value (`inventory/count/count-screen.tsx`) [Code].
- **Quick confirm:** RECONCILIATION_REVIEW has `onQuickConfirm` (one tap when everything matches) [Code].
- **Dock slip** (flag `dockSlip`): a dispute slip shared over WhatsApp while the driver is still at the door [Code].
- **Light tokens with strong contrast:** ink on bg is **16.0:1**; primary on white is **6.54:1** (computed from `packages/ui-tokens`) [Code].

**Gaps that cost time or ₪ (each one is tied to a principle or pattern below):**

| # | Gap | Evidence | Why it matters |
|---|---|---|---|
| G1 | Bottom bar is **"the first four items in array order"**, not role-first. Managers and owners never get **Orders** in the bar; the receiver's first tab is Overview, not Receiving. | `nav.tsx`: `primary = barCandidates.slice(0, 4)` + leaks pin | Starting an order takes 3 taps plus a scroll (עוד → scroll to "רכש" → הזמנות → הזמנה חדשה) instead of 1 |
| G2 | **Desktop nav is a tab row of about 17 items that wraps onto 2 lines** | `nav.tsx` DesktopNav comment ("~17 tabs … WRAPS onto a second line") | Bosses scan two rows of tabs to find their place; there are no counts and no keyboard shortcut |
| G3 | **No keyboard shortcuts anywhere** (no Cmd/Ctrl+K, no J/K triage) | grep `metaKey`/`keydown` in `search.tsx`, `approvals`, `leaks` → none | The bookkeeper's approvals volume is all mouse work |
| G4 | **Approvals: one card at a time, no bulk action, no split view** | `approvals/list.tsx` approves per `discrepancyId` | Month-end: N invoices × 2–3 clicks each |
| G5 | **Invoice capture opens a file picker, not the camera; one page only** | `InvoiceScan.tsx`: `<input type="file" accept="image/*,application/pdf">`, no `capture`, `files?.[0]` | iOS shows an extra action sheet. Consolidated invoices (`חשבוניות ריכוז`) run to several pages, so lines on page 2 or later never reach the matcher and the leak is under-counted |
| G6 | **Only photos are queued offline.** Line marks (`markGrLine`), `submitReceipt`, order drafts and approvals are online-only. Offline navigation falls back to the static `offline.html`. | `receiver-sw.js` fetch handler; `wizard.tsx` | In the walk-in or back alley the receiver loses the wizard mid-count |
| G7 | **Sign-out silently wipes un-uploaded invoice photos** | `PwaSessionGuard.tsx`: logout submit → `clearQueue()`; next user → `purgeOtherUsers()` | On a shared back-door phone, receiver A shoots 3 invoices offline and signs out. The photos are lost and never matched, so the leak is invisible. Directly against the North Star |
| G8 | **PWA scope is `/dashboard/receiving` only**; there is no iOS install guidance (only `beforeinstallprompt`, which is Chromium-only); no web push; no app badge | `manifest.webmanifest` `scope`; `ReceiverPwa.tsx`; grep `PushManager`/`setAppBadge` → none | Owners and managers can't install approvals; "₪ awaiting approval" can't reach the lock screen |
| G9 | **Receiving PO page blocks first paint on sequential server awaits:** up to 4 s `ensureEnglish` **or** 4 s `localNames`, then `priceContext`, **then** `getPo` | `receiving/[poId]/page.tsx` | LCP can exceed 2.5 s on 4G with the driver waiting; `getPo` doesn't depend on the name lookups and could run in parallel |
| G10 | Skeleton `loading.tsx` exists for only **5** routes (approvals, exports, receiving, settings, suppliers) | `ls app/dashboard/*/loading.tsx` | Orders, inventory, leaks, invoices and recipes show a blank page or spinner on slow Android |
| G11 | **No optimistic updates** (no `useOptimistic` / `onMutate` in the dashboard) | grep | Every line tap waits a network round trip, so INP feels like latency on 3G |
| G12 | Order wizard step buttons use `size="sm"` and sit at the end of a long card (they reach 44 px only through the coarse-pointer floor and aren't pinned) | `orders/new/wizard.tsx` l.291/510/513 | The primary action sits outside the thumb zone while scrolling a 30-line order |
| G13 | `AdjustQuantities` uses `type="number"` (scroll-wheel and locale quirks) | `showcase/receiver/_steps/AdjustQuantities.tsx` l.235 | Accidental value changes; `count-screen` already does it correctly |
| G14 | `muted` 6.60:1 and `subtle` 5.36:1 on bg pass AA but are **below a 7:1 outdoor target**; the mobile bottom bar is `glass` (translucent + blur); input borders `line-strong` are 3.59:1 | tokens + `nav.tsx` | Back-door sunlight washes out secondary text and translucent bars |
| G15 | `window.confirm()` is used for destructive count discard | `count-screen.tsx` | Native dialog: tiny targets, LTR button order on some Android builds, no ₪ context |

---

## 3. Benchmarks: the specific mechanic worth taking from each

| Product (category) | Mechanic | Evidence | RestoMatch target |
|---|---|---|---|
| **Shopify POS** (retail POS) | **Smart grid**: the home screen is a grid of **tiles**, each showing *status*, offering a *quick action*, or *starting a workflow*. Tiles have `heading`, `subheading` and `enabled`/`disabled`; one tile per extension per target | [S10] | The mobile `/dashboard` becomes a role tile grid (Pattern 1) |
| **Toast Go** (restaurant handheld) | **Offline mode banner**; handhelds keep taking orders; data is stored on the device; the device switches back online automatically; **uninstalling while offline loses the data**; one device per employee because offline orders don't cross devices; online orders queued during the outage need **manual approval** | [S11] | Outbox + persistent banner + "don't sign out, there is unsent data" (P7, P8, Pattern 4) |
| **Square Handheld / Square Restaurants** | Offline payments sync to the dashboard once the connection returns; some operations are **explicitly unavailable offline** (close-of-day, gift cards, manual cards); built-in barcode scanner | [S13] | Mark which actions work offline. Approve and pay are online-only; count, receive and draft orders work offline |
| **DoorDash Merchant tablet** | **Repeated ringing** until an order is confirmed; loud/quiet setting; **"Needs Action" tab**; a separate chime for courier arrival; auto-confirm toggle | [S27] | "Delivery arriving now" alert for the receiver only; a "דורש פעולה" queue (Pattern 7) |
| **Linear mobile** (modern work OS) | Native app (Swift/Kotlin); **inbox of high-priority items; tap to act, swipe to delete, snooze for later** | [S12] | Approvals triage on mobile with swipe and button parity (Pattern 5); keyboard triage on desktop (Pattern 11) |
| **Superhuman / Gmail** (triage) | Remappable swipe directions; the **triage bar is deliberately cut off** to signal more actions; **Undo** after swipe | [S12] | Undo snackbar after approve or snooze |
| **Odoo Barcode** (modern open ERP) | Operations → Receipts lists receipts generated from POs; **scanning a product adds it or increments its qty**; pencil to edit qty; bottom-of-screen **"Add Product" / "Validate"**; runs in the Odoo mobile app on the warehouse floor | [S25] | Scan-to-receive in `/dashboard/receiving/[poId]` (Pattern 2) |
| **WMS blind / partial-blind receiving** (ShipEdge, Extensiv, ShipMonk, Racklify) | Count **without seeing the expected qty** (or with header only); mismatch → **recount + reason code**; **photo required on exceptions only**; reconcile against paperwork **after** the count | [S31] | Optional "ספירה עיוורת" mode; reason chips; photo only on a discrepancy |
| **MarginEdge** (restaurant back office) | "CAPTURE NEW INVOICE" opens the camera; **one page per photo**; **per-photo upload status** (Sent / Confirmed); 90-day image history | [S15] | Multi-page capture with a per-page status strip (Pattern 3) |
| **Restaurant365** (restaurant ERP) | Mobile is mostly online, **but counts have an offline mode** that uploads on reconnect | [S16] | Count offline (already partly done with localStorage) plus receiving offline |
| **Choco** (newest restaurant↔supplier ordering) | Chat-style ordering with a **list of commonly purchased items, tap to reorder**; **Choco AI turns voicemail / SMS / email / WhatsApp into ERP orders in seconds**; Realtime-API voice agent takes phone orders 24/7 in any language | [S14] | Reorder-from-history plus voice or WhatsApp order capture into `orders/capture` (Patterns 8, 9) |
| **Ramp** (modern spend / AP) | Bills pending your approval appear in a **mobile inbox**; push when requests arrive; **weekday-only auto-reminders**; approvers can edit fields during approval when an admin allows it | [S26] | "₪ ממתין לאישורך" push + inbox + weekday reminders (P15) |
| **Apple HIG** | Tab bar is for navigation, not actions; keep it visible; **fewer tabs are easier**; for complex apps "a tab bar that adapts to a sidebar"; badges only for critical info; **44×44 pt minimum control** (iOS); contrast 4.5:1 up to 17 pt | [HIG] | Role-first bar (P1), sidebar on desktop (P21), badge only for T2 items |
| **Material 3** | Navigation bar default height **80 dp** (Flutter M3 default) [S5]; width classes **Compact < 600 dp, Medium < 840 dp, Expanded ≥ 840 dp** [S28]; typical mapping bar → rail → drawer; **48×48 dp** touch target [K]; standard vs modal (scrim) bottom sheets [S29] | [S5][S28][S29] | Breakpoint map (P21), sheets (P16) |
| **Android "Build an offline-first app"** | "The local data source is the canonical source of truth." Write strategies: **online-only**, **queued writes** ("drain the queue with exponential backoff"), **lazy writes**; conflict policy "**last write wins**" with timestamps | [S32] (full text) | Outbox design (P7) |

---

## 4. Platform capability matrix (what you can rely on in 2026)

| Capability | Chrome Android (≈67% of IL) | iOS Safari / Home-Screen app (≈33%) | RestoMatch use + fallback |
|---|---|---|---|
| Web Push | Yes [K] | **Only for Home-Screen web apps, iOS/iPadOS 16.4+; the permission request must come from a direct user gesture**; notifications reach Lock Screen, Notification Center, Watch, Focus [S1] | Approvals, delivery-arriving, OCR done. Fallback: WhatsApp/email digest (outbox already exists server-side) |
| App Badge (`navigator.setAppBadge`) | Yes on installed PWA [K] | **Home-Screen apps only; auto-granted with notification permission**; manifest `id` needed for multiple installs [S2] | Badge = number of T2 items for this role |
| `beforeinstallprompt` | Yes [K] | **No** (Chromium-only) [K] | iOS coach-mark: Share → "הוסף למסך הבית" |
| BarcodeDetector | Supported (caniuse lists Chrome Android) [S3] | **Disabled by default (17.0–26.x)** [S3] | Use the `barcode-detector` ponyfill (ZXing-C++ WASM) and **self-host the .wasm** (CSP and offline) [S4] |
| `<input capture="environment">` | Opens the rear camera directly [S17] | Opens the camera [K] | One-page invoice and quick product photo |
| `getUserMedia` + live viewfinder | Yes; torch via `applyConstraints({advanced:[{torch:true}]})` [K] | Yes in Safari and Home-Screen app; **no torch** [K] | Multi-page invoice with edge detection (Pattern 3) |
| Background Sync (`SyncManager`) | Yes [S18] | **No** [S18] | Drain the outbox on `online`, `visibilitychange`, app open, and every 30 s while visible |
| Vibration (`navigator.vibrate`) | Yes [K] | **No** (caniuse) [S19] | Haptics are an enhancement only; always pair them with visual and optional audio |
| Web Speech (`SpeechRecognition`) | Yes, server-based; he-IL in Chrome's recognizer [S9] | `webkitSpeechRecognition` exists; **`processLocally` unsupported on iOS**; Hebrew is untested and unconfirmed [S9] | Accelerator only; fallback is the keyboard mic (OS dictation) or a recorded clip sent to the server for transcription |
| Cross-document View Transitions | Chrome **126+** [S22] | Safari **18.2+** [S22] | List → detail continuity (receiving inbox → PO) |
| Web Share (`navigator.share` with files) | Yes [K] | Yes [K] | Dock slip PDF/text to the driver's or supplier's WhatsApp |
| `share_target` (receive shares) | Yes (installed) [K] | **No** [K] | WhatsApp order text → `orders/capture`. iOS fallback: paste |
| IndexedDB persistence | `navigator.storage.persist()` [K] | Script-writable storage of *non-installed* sites is evicted after 7 days without use (ITP); Home-Screen apps are exempt [K] | Another reason to push install for receivers, so the queue survives |
| Screen Wake Lock | Yes [K] | Supported in recent Safari; verify inside Home-Screen apps [K] | Long inventory count; scan screen |

---

## 5. Principles (22): each is checkable and mapped to a screen

> Format: **name** · source · **rule (testable)** · where it applies in RestoMatch.

**P1. Role-first bottom bar (3–5 destinations, ordered by frequency)** · [HIG] tab bars, M3 nav bar [S5]
Rule: the mobile bar holds the role's 3–4 most frequent destinations plus "עוד", hard-coded per role, not `NAV_ITEMS.slice(0,4)`. The first tab is the role's main job. The bar never holds an *action*: actions go in a centred FAB or in a tile. Check: from a cold start, the manager reaches `/dashboard/orders/new` in **≤1 tap** (today it takes 3 plus a scroll).
Apply: `nav.tsx` MobileNav → receiver `[קבלה, חשבוניות, ספקים(ledger), עוד]`; chef `[ספירה, מתכונים, עלות מזון, עוד]`; manager `[הזמנה, קבלה, אישורים, דליפות, עוד]`; owner `[דליפות, אישורים, רשת/סניפים, דוח חודשי, עוד]`; bookkeeper `[אישורים, חשבוניות, יצוא, עוד]`.

**P2. Primary action lives in the bottom third, pinned and full width** · Hoober: 49% of users hold one-handed, thumbs drive 75% of interactions [S21]
Rule: on every field screen the one primary CTA is `position: sticky/fixed`, at the bottom, full width, above the bottom bar plus safe area, and visible without scrolling. Secondary actions are a text button above it or in an overflow menu. Check: screenshot at 360×740; the CTA's y-centre must be ≥ 66% of viewport height.
Apply: `orders/new/wizard.tsx` (BUILD "המשך", REVIEW "שלח לספק" are `size="sm"` in-flow buttons → pinned bar, G12); `InvoiceScan.tsx` capture button (currently below a 4:5 viewfinder, mid-screen); `approvals/list.tsx` per-card approve (fine) plus a sticky "אשר הכל מתחת ל-₪X" on filtered lists.

**P3. Three-tier target sizes: 24 px floor, 44 px platform, 56 px field** · WCAG 2.2 SC 2.5.8 (24×24 CSS px, AA) [S6]; HIG 44×44 pt [HIG]; M3 48 dp [K]
Rule: (a) no target under 24 px anywhere; (b) every target ≥ 44 px on coarse pointers (already in place); (c) **field screens** (receiving, count, order BUILD, capture) use **56 px** targets with **≥ 8 px gaps**, and steppers are 56×56. Check: an automated Playwright test asserts the `getBoundingClientRect()` height of every `button, a, input` on those routes at 390 px is ≥ 56.
Apply: extend the `html[data-pwa='installed']` 56 px rule into a reusable `data-field-mode` attribute set on `receiving/*`, `inventory/count`, `orders/new`, `orders/capture` (installed **or** coarse pointer). The count qty input (`w-20 py-2` ≈ 40 px) becomes 56 px tall and 88 px wide; `AdjustQuantities` steppers go from `w-12 h-12` (48) to 56.

**P4. Gloves, wet hands, cold fingers: no precision gestures** · WCAG 2.5.1 Pointer Gestures, 2.5.7 Dragging Movements [K]; WMS practice [S31]
Rule: every swipe, long-press or drag has a visible single-tap button equivalent. Nothing requires multi-finger gestures or pinch. Keep tap targets ≥ 16 px from the screen's **right edge** in RTL, where the iOS back-swipe starts on the left and the Android back gesture uses both edges [K]. Use a stepper plus a big keypad instead of free text for quantities. Check: complete the receive flow with a capacitive glove and a pen-cap stylus, with zero mis-taps in 10 runs.
Apply: receiving ADJUST_QUANTITIES; count-screen; approvals swipe (Pattern 5).

**P5. Sunlight-legible contrast: 7:1 body, 10:1+ for acted-on numbers, no translucency** · Silktide AAA 7:1; NTNU study: 7:1 is not enough outdoors, suggests ~18:1 [S30]; HIG 4.5:1 minimum [HIG]
Rule: in field mode every number the user acts on (qty, ₪, unit) uses `ink` (16:1). Secondary text uses `muted` (6.6:1) at most; `subtle` (5.36:1) only for decorative captions. Input borders reach ≥ 4.5:1 (`line-strong` is 3.59:1 → darken it in field mode). The bottom bar and sticky footers are **solid `surface`**, not `glass` blur. Respect `prefers-contrast: more`. Check: axe plus a custom contrast script on field routes with threshold 7:1 for text ≤ 17 px.
Apply: `nav.tsx` bottom bar `glass` class; `count-screen.tsx` `text-[11px] text-subtle` price-source line; `receiving/page.tsx` card meta `text-xs text-muted`.

**P6. Numeric entry done right** · MDN `inputmode` [K]; [Code] count-screen pattern
Rule: quantities use `type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off" dir="ltr"` with `font-size ≥ 16px` (prevents iOS focus-zoom) and **select-all on focus**. Never use `type="number"`. Integers-only units (יח׳, ארגז) use `inputMode="numeric"`. "Next" moves focus to the next line's qty and scrolls it into view above the keyboard (`scrollIntoView({block:'center'})`). Check: on a Galaxy A-series, entering 20 counts takes no keyboard dismissals.
Apply: `AdjustQuantities.tsx` (G13); `orders/new/wizard.tsx` qty and price inputs (already `inputMode="decimal"`; add enterKeyHint and select-on-focus); `invoices/[invoiceId]/correction-client.tsx`.

**P7. Offline-first for every field write, not just photos** · Android offline-first: local store is the source of truth; queued writes drained with exponential backoff; last-write-wins [S32]; Toast/R365 [S11][S16]; Safari has no Background Sync [S18]
Rule: one IndexedDB **outbox** (generalising `offlineQueue.ts`) holds typed mutations `{id: uuid (idempotency key), kind, payload, restaurantId, userId, createdAt, attempts}` for `markGrLine`, `submitReceipt`, count lines, order drafts and photo uploads. The server dedupes on the key (the M8 pattern). Drain triggers: `online`, `visibilitychange→visible`, app start, and a 30 s interval while visible. Backoff is 2^n s, capped at 5 min; `MAX_AUTO_ATTEMPTS` stays at 8 and then needs a manual retry. **At shift start, precache today's POs** (`receiving.todayExpectations` plus each `getPo`) in IndexedDB, so the full receive flow renders with zero bars. Money-committing actions stay online-only and say so: approve payment, pay-run export, send order to supplier.
Apply: `lib/pwa/offlineQueue.ts` → `lib/pwa/outbox.ts`; `receiving/[poId]/wizard.tsx`; `inventory/count/count-screen.tsx` (moves from localStorage to the outbox); `receiver-sw.js` (adds an app-shell cache for `/dashboard/receiving/[poId]` JS chunks without caching authenticated HTML: render from IDB data).

**P8. Sync status is always visible, per item, in 3 states, and never destroys data** · Toast: offline banner; uninstall-while-offline loses data [S11]; MarginEdge per-photo status [S15]
Rule: a header pill shows `⏳ 3 ממתינים לשליחה` / `✓ הכל נשלח` / `⚠ 1 נכשל — נסה שוב`. Every queued item shows the same 3 states inline. A spinner never runs longer than 10 s; after that it switches to "נשמר בטלפון, יישלח אוטומטית". **Sign-out with a non-empty queue:** if online, flush first (blocking, with progress); if offline, show a sheet: "3 חשבוניות לא נשלחו. התנתקות תמחק אותן מהטלפון. [המתן לחיבור] [מחק והתנתק]". Check: unit test so that logout with a queue never calls `clearQueue()` without explicit confirmation.
Apply: `PwaSessionGuard.tsx` (G7, **highest ₪ risk**); `ReceiverPwa.tsx` banner; `layout.tsx` header.

**P9. Optimistic for reversible taps, server-acknowledged for money** · INP ≤ 200 ms [S7]
Rule: line ✓, qty change, count entry and order-line add update the UI within **≤ 100 ms** (React 19 `useOptimistic` or tRPC `onMutate`) and reconcile on settle. A failure reverts the line and shows an inline error. Approve, reject, send order, submit receipt and pay-run show a pressed/loading state immediately, then a confirmed state only on the server ack, followed by a **5 s Undo snackbar** where the server allows reversal (approve/snooze). Check: field RUM p75 INP ≤ 200 ms on `/dashboard/receiving/[poId]` and `/dashboard/inventory/count`.
Apply: `wizard.tsx` `markGrLine`; `approvals/list.tsx`; `orders/new/wizard.tsx` line add.

**P10. Multimodal feedback: visual always, haptic and audio as enhancements** · HIG: give feedback through color, text, sound and haptics so people get it even when silenced or looking away [HIG]; iOS lacks `navigator.vibrate` [S19]
Rule: scan success = green flash (200 ms) + `navigator.vibrate(15)` where supported + optional short beep. Mismatch = danger badge + `vibrate([30,60,30])` + distinct tone. Never rely on haptics alone. Provide a sound toggle in the receiver settings (the back door is noisy; the dining room is quiet). Check: a feature-detection unit test; the flow passes with the device muted.
Apply: barcode scan (Pattern 2); count line saved; dock slip sent.

**P11. Camera-first capture: zero pickers, multi-page, quality-gated** · HTML Media Capture `capture="environment"` [S17]; MarginEdge one-page-per-photo + status [S15]; Dynamsoft live edge detection and perspective correction in the browser [S20]
Rule: (a) single page: `capture="environment"`, which removes the OS chooser step on iOS; (b) **"עוד עמוד" (add page)** keeps the viewfinder open, with a thumbnail strip, reorder and delete, and "סיום (N עמ׳)"; (c) live quad detection with auto-capture when stable for 600 ms; (d) client-side blur/glare check (Laplacian variance threshold) before upload, with "התמונה מטושטשת — צלם שוב" so a bad OCR spend never happens. Keep the existing `scanPrep.ts` resize (2000 px long edge, JPEG 0.8). Check: tap count for a 3-page consolidated invoice ≤ 5 (open, shutter×3 or auto, סיום).
Apply: `showcase/receiver/_steps/InvoiceScan.tsx` + `receiving/[poId]/wizard.tsx` SCAN_INVOICE (G5); `/dashboard/inbox` manual upload; `invoices/[invoiceId]/consolidated-panel.tsx` "add missing page".

**P12. Barcode and QR as a first-class input with native-or-WASM detection** · BarcodeDetector: Chrome Android yes, Safari disabled by default; restrict formats for speed [S3]; `barcode-detector` ponyfill (ZXing-C++ WASM); self-host the WASM for CSP and offline [S4]
Rule: feature-detect `'BarcodeDetector' in globalThis` and check `getSupportedFormats()`, else lazy-import the ponyfill **only on scan screens**. Formats: `['ean_13','ean_8','upc_a','code_128','qr_code']` (Israeli GS1 prefix 729 on EAN-13 [K]). Scan at ≤ 10 fps on low-end devices. Offer a torch toggle where `track.getCapabilities().torch` exists. Scanning a known item **jumps to and focuses its line**; scanning it again increments by its pack size (Odoo behaviour [S25]). An unknown code opens a "קשר מוצר" sheet that writes to catalog mapping. Check: scan-to-focus ≤ 400 ms on a Galaxy A14-class device.
Apply: `inventory/count/count-screen.tsx`, `receiving/[poId]` line marking, a QR on the printed PO and supplier document (`orders/supplier-document.tsx`) that opens `/dashboard/receiving/[poId]`, and `catalog/mapping`.

**P13. Hebrew voice as an accelerator, never a dependency** · Web Speech: Chrome supports he-IL; Safari `webkitSpeechRecognition` exists, `processLocally` is unsupported on iOS, and Hebrew is unconfirmed [S9]; Choco AI turns voicemail into ERP orders [S14]
Rule: show the mic button only when `SpeechRecognition || webkitSpeechRecognition` exists **and** a 1-time he-IL probe succeeded; otherwise rely on the keyboard's own dictation key. For long free speech (orders), record with `MediaRecorder` and send the clip to the server for transcription and parsing into the same `orders.captureFromText` pipeline. Always show the transcript for confirmation before any write, with numbers parsed into editable chips ("12 ק״ג בצל"). Check: voice-to-draft-order with ≤ 1 correction in 8 of 10 Hebrew test phrases.
Apply: `orders/capture/capture-client.tsx` (add 🎙 next to the textarea); count-screen ("בצל שתים עשרה קילו" → fills the line); ADJUST_QUANTITIES reason ("חסרים שני ארגזים").

**P14. Install and permission timing for iOS and Android** · Push only for Home-Screen apps, permission from a user gesture [S1]; badge auto-granted with notifications, manifest `id` [S2]
Rule: (a) **one app-wide manifest** (`scope: "/dashboard"`, `start_url` per role via redirect, a stable `id`) instead of the receiving-only manifest; (b) install prompt after the 2nd successful task, not on first load: Chromium uses `beforeinstallprompt`, iOS shows a coach-mark sheet with the 2 steps illustrated; (c) ask for push **after** a meaningful action, framed by value: "להודיע לך כשחשבונית ממתינה לאישורך?" [אפשר התראות]; (d) never re-ask within 14 days after a dismissal. Check: no `Notification.requestPermission()` call outside a click handler (lint rule).
Apply: `public/pwa/manifest.webmanifest`, `lib/pwa/ReceiverPwa.tsx` → `lib/pwa/AppPwa.tsx`; settings → "התראות".

**P15. Notifications are ₪-first, actionable, role-routed and rate-limited** · Ramp: approval inbox, push on new requests, weekday-only reminders [S26]; DoorDash: repeated ringing for "Needs Action" [S27]; HIG: badges only for critical info [HIG]
Rule: body format `₪{amount} · {supplier} · {n} חריגות` with a deep link to the filtered screen. Only T2 items push: awaiting approval, blocking discrepancy, delivery arriving within 15 min (receiver), OCR failed. T3 good news goes only into the daily digest. Quiet hours follow the restaurant's opening hours. Max 6 pushes per user per day, collapsed with a `tag` per supplier. The badge equals the open T2 count. Check: an e2e test that 10 discrepancies on one invoice produce **1** push.
Apply: server `packages/api/src/notifications/outbox.ts` is **immutable** (AGENTS.md), so channel and rate-limit changes must be **proposed via a human PR**. The client side (subscription, SW `push` handler, deep links) lives in `apps/web`.

**P16. Bottom sheets for in-context decisions; full screens for flows** · M3 standard vs modal sheets (modal has a scrim) [S29]; HIG sheets with medium/large detents [K]
Rule: use a modal bottom sheet (drag handle, 2 detents at 50% and 92%, scrim, close button **and** swipe-down, focus trapped, `Esc` closes) for: reject reason, line qty/reason edit, supplier picker, product link, sign-out-with-queue, count discard. Never stack sheets. Never use `window.confirm`. Multi-step flows (receive, order, count) stay full-screen. Check: no `window.confirm` in `app/dashboard/**` (lint).
Apply: `approvals/list.tsx` inline reject textarea → sheet; `count-screen.tsx` discard (G15); `orders/capture` supplier candidates.

**P17. Skeletons that match the final layout, and stale-while-revalidate** · HIG: show placeholder content as it loads [HIG]; CLS ≤ 0.1 [S7]
Rule: every dashboard route has a `loading.tsx` whose blocks match the final card geometry (same heights → CLS ≈ 0). Client lists render the last cached data immediately with an "עודכן לפני 3 דק׳" chip while refetching. Check: Lighthouse CLS ≤ 0.05 on every route at 390 px.
Apply: add `loading.tsx` to `orders`, `orders/[poId]`, `inventory`, `leaks`, `invoices/[invoiceId]`, `recipes`, `chain`, `approvals/pay-run` (G10).

**P18. Low-end Android performance budget, enforced per route** · LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 mobile [S7]; Russell: global-P75 budget of ~150 KiB HTML/CSS/fonts and ~300–350 KiB gz JS (2023 edition), with a much tighter JS budget in 2024 [S8]; Android is 66.6% of IL [S24]
Rule: field routes (`receiving/*`, `inventory/count`, `orders/new`, `orders/capture`) get **≤ 170 KB gz route-specific JS** on top of the shared framework chunk. The WASM scanner, PDF viewer and charts are dynamic imports. **No server await chain longer than one round trip before first paint:** run independent queries in `Promise.all`, and stream slow, optional data (English and receiver-language names, price context) behind `<Suspense>`. Measure field RUM with `web-vitals` (`onLCP/onINP/onCLS`) tagged by route and role. CI runs a Lighthouse budget at Moto G Power / slow-4G profile. Check: p75 LCP ≤ 2.5 s on `/dashboard/receiving/[poId]` in RUM.
Apply: `receiving/[poId]/page.tsx` (G9): `Promise.all([getPo, priceContext])`, and stream `localNames`/`ensureEnglish` into the wizard after first paint.

**P19. Motion: fast, purposeful, interruptible, reduced-motion aware** · Cross-document View Transitions Chrome 126 / Safari 18.2 [S22]; 60 fps = 16.7 ms/frame [K]
Rule: transitions run 150–250 ms and animate only `transform`/`opacity`. Use `@view-transition { navigation: auto; }` with a shared `view-transition-name` from the receiving PO card to the PO header. **The ₪ hero number never count-up animates** (a trust risk). `prefers-reduced-motion: reduce` turns off all non-essential motion. The PROCESSING step's cycling indicator reflects real OCR stages and doesn't loop a fake 1.4 s timer forever. Check: Chrome DevTools performance trace shows no long tasks over 50 ms during transitions on a 4× CPU throttle.
Apply: `receiving/page.tsx` → `[poId]`; `ProcessingPoll` in `wizard.tsx`; the leak hero on `/dashboard`.

**P20. Long field tasks survive interruption** · R365 offline counts [S16]; [Code] count autosave
Rule: count and receive hold a **Screen Wake Lock** while active (re-acquired on `visibilitychange`). Progress (`34/80`, `₪ live value`) stays pinned. Resume returns to the same line and scroll position after a lock, a call, or an app switch. Leaving with unsaved local edits is safe because of the outbox (P7). Ask once for `navigator.storage.persist()` after install. Check: lock the phone mid-count for 10 min, unlock, and resume on the same line with zero data loss.
Apply: `inventory/count/count-screen.tsx`; `receiving/[poId]/wizard.tsx`.

**P21. Desktop for bosses: sidebar, counts, command palette, keyboard** · HIG: for complex apps "a tab bar that adapts to a sidebar… a sidebar for in-depth navigation" [HIG]; M3 Expanded ≥ 840 dp → drawer [S28]; Linear-style triage [S12]
Rule: at ≥ 1024 px, replace the wrapping 17-tab row with a **persistent start-side (right in RTL) sidebar**: 3 groups (תפעול / רכש / ניהול), collapsible to a 64 px rail, each item showing a T2 count badge (₪ or #). **Cmd/Ctrl+K** opens `DashboardSearch` as a palette for navigation, supplier and invoice lookup, and actions ("אשר…", "צור הזמנה לשרון"). Global shortcuts: `g a` approvals, `g l` leaks, `g i` invoices, `/` search, `?` shortcut sheet. Check: the bookkeeper processes 20 approvals with zero mouse use.
Apply: `nav.tsx` DesktopNav (G2), `search.tsx` (G3), `layout.tsx`.

**P22. Same data, two shapes: mobile is a task queue, desktop is a work surface** · Shopify smart-grid tiles (status / quick action / start workflow) [S10]; Linear inbox [S12]; Odoo list → validate [S25]
Rule: on mobile each screen opens on "what needs me now" (T2 cards sorted by ₪ desc, one CTA each). On desktop the same route renders a **dense table + detail pane** with sortable columns, sticky header, multi-select, bulk actions with a ₪ subtotal of the selection, and CSV export. The same tRPC query feeds both; only the presentation switches at `lg`. Check: `/dashboard/approvals` at 1440 px shows ≥ 15 rows above the fold with ₪, supplier, rule, age and branch.
Apply: `approvals/list.tsx` (G4), `leaks/explorer.tsx`, `suppliers/ledger`, `chain/page.tsx` (branch × KPI matrix).

---

## 6. Patterns (13): exemplar → RestoMatch use, with steps and tap counts

### Pattern 1: Role "Today" tile grid (mobile home)
- **Exemplar:** Shopify POS smart grid (tiles show status, offer quick actions, start workflows) [S10]; DoorDash "Needs Action" tab [S27].
- **RestoMatch use:** `/dashboard` on screens below `lg` renders a 2-column grid of 56–96 px tiles, ordered by role:
  - Receiver: `🚚 3 משלוחים היום · הבא: ירקות השרון 07:30` → tap opens that PO directly (skipping the inbox); `📷 חשבונית בלי הזמנה`; `⏳ 2 ממתינים לשליחה` (outbox).
  - Manager: `🛒 הזמנה לשרון נסגרת 14:00` → `orders/new?supplier=…&from=last`; `✅ ₪2,140 ממתין לאישור (4)`; `📦 ספירה פתוחה 34/80`.
  - Owner: leak hero (T1) on top, then `₪ ממתין לאישור`, `החזר ₪ צפוי` (T3 calm), `סניף חיפה ↑ 2.1%`.
- **Taps:** receiver from app open to the camera for the next delivery: **2** (tile → capture), down from 3–4 today.

### Pattern 2: Scan-to-receive with partial-blind option and exception-only photos
- **Exemplar:** Odoo Barcode receipts (scan adds/increments, bottom "Validate") [S25]; WMS blind/partial-blind receiving with recount + reason code and photos on exceptions only [S31].
- **RestoMatch use** (`/dashboard/receiving/[poId]`): add a **"ספור קודם" (count first)** path next to today's photo-first flow, for deliveries that arrive with only a delivery note:
  1. The PO line list opens with a big sticky `✓ הכל התקבל כמו בהזמנה` button (56 px).
  2. Per line: tap ✓ (optimistic, P9), or the stepper ±pack size, or scan the case barcode (P12) to focus and increment.
  3. A diff opens reason chips in a sheet (P16): `חסר` / `פגום` / `הוחלף` / `מחיר שונה`. Only `פגום` asks for a photo (1 tap, `capture="environment"`).
  4. Photograph the invoice now or later (it queues into the outbox).
  5. If there are diffs, the **dock slip** is offered before the driver leaves (already built).
- **Optional "ספירה עיוורת" setting** (owner-controlled): hide expected quantities until the receiver submits counts. This catches more short-shipping, at the cost of about 20% more time [S31: practitioner claim].
- **Taps (happy path, no diffs):** open (1) → `✓ הכל התקבל` (2) → photograph invoice (3–4) → `אישור` (5). Today: about 7 plus the OCR wait before confirming.

### Pattern 3: Multi-page document scanner with live edge detection and per-page status
- **Exemplar:** MarginEdge one-page-per-photo with per-photo status [S15]; Dynamsoft Document Normalizer (live quad detection, perspective correction, contrast) [S20].
- **RestoMatch use** (SCAN_INVOICE, `/dashboard/inbox`, consolidated invoice panel):
  - Full-bleed `getUserMedia` viewfinder (rear camera, torch toggle on Android). A green quad overlays the detected page, and the shot auto-captures when stable for 600 ms. A manual shutter (72 px, bottom centre) is always available.
  - A thumbnail strip at the bottom: `עמ׳ 1 ✓ · עמ׳ 2 ⏳ · עמ׳ 3 ⚠ מטושטש` with tap-to-retake and drag-to-reorder (plus ▲▼ buttons per P4).
  - CTA: `סיום · 3 עמודים`. Pages upload in parallel under one `clientUploadId` group so OCR sees one invoice.
  - Fallback when there is no camera permission or on old devices: `<input type="file" accept="image/*" capture="environment" multiple>`.
- **Why it's about ₪:** consolidated monthly invoices (`חשבוניות ריכוז`) are multi-page. Missing pages means unmatched lines, which means an under-reported leak.

### Pattern 4: Offline outbox with a visible queue and conflict cards
- **Exemplar:** Toast offline mode (banner, local storage, auto-reconnect, data-loss warning) [S11]; Android queued writes + exponential backoff + last-write-wins [S32]; R365 offline counts [S16].
- **RestoMatch use:** `lib/pwa/outbox.ts` (P7) + header pill (P8) + `/dashboard/receiving` "ממתינים לשליחה" list.
- **Conflict card** (rare: two people counting the same item, or a PO edited by the manager while the receiver was offline): `ספרת 12 ק״ג · אבי עדכן 10 ק״ג לפני 4 דק׳ · הפרש ₪36` → [שמור שלי] [קבל של אבי]. The default for counts is last-write-wins with timestamps [S32]; for goods-receipt lines it is a **manual choice** (money).
- **Shared device:** a PIN switch-user ("החלף משתמש") instead of full sign-out on the back-door phone, so the queue survives shift changes and each item stays scoped by `userId` (the existing scoping in `processQueue`).

### Pattern 5: Swipe-to-act triage with button parity and Undo (mobile approvals)
- **Exemplar:** Linear mobile inbox (tap to act, swipe to delete, snooze) [S12]; Superhuman remappable swipes and cut-off triage bar; Gmail Undo [S12].
- **RestoMatch use** (`/dashboard/approvals` below `lg`):
  - Card: `₪1,240 · ירקות השרון · מחיר מעל חוזה (3 שורות)` plus the rule chip.
  - **RTL-aware swipe:** swipe toward the *inline-end* (left in Hebrew) = `אשר` (only when ₪ is below the role's auto-approve threshold; above it the swipe opens the detail sheet instead); swipe toward the inline-start = `דחה לאחר כך` (snooze 4 h).
  - Visible buttons are always present: `[אשר]` primary, `[דחה]` secondary (opens the reason sheet).
  - After any action: a snackbar `אושר · ₪1,240 · בטל` for 5 s.
- **Taps:** approve one item = **1** swipe or 1 tap. Today it is 1 tap, but with no undo, no batch and no snooze.

### Pattern 6: Bottom-sheet quick edit
- **Exemplar:** M3 modal bottom sheet with scrim [S29]; HIG sheets with medium/large detents [K].
- **RestoMatch use:** line edit in ADJUST_QUANTITIES (qty stepper 56 px + unit + reason chips + optional photo), reject reason in approvals, "קשר מוצר" after an unknown barcode, sign-out-with-queue (P8), count discard (replacing `window.confirm`).
- **Spec:** 50% detent by default, drag handle 32×4 visible inside a 48 px hit area, primary CTA pinned at the sheet bottom, `Esc` and swipe-down close it, focus returns to the trigger.

### Pattern 7: Actionable push + app badge + "arriving now" alert
- **Exemplar:** WebKit iOS 16.4 Web Push + Badging for Home-Screen apps [S1][S2]; Ramp approval inbox + weekday reminders [S26]; DoorDash repeated ringing until action [S27].
- **RestoMatch use:**
  - Owner/manager: `₪2,140 ממתין לאישורך · 4 חשבוניות` → deep link `/dashboard/approvals?filter=mine`. The badge shows 4.
  - Receiver: `ירקות השרון בדרך · צפוי 07:30 · 12 שורות` at expectedAt − 10 min → deep link `/dashboard/receiving/[poId]`. It can repeat once at +5 min if not opened (DoorDash-style, opt-in).
  - Bookkeeper: weekday-only digest at 09:00, `7 חשבוניות ריכוז לבדיקה`.
- **Constraint:** delivery and scheduling live in immutable `outbox.ts` / `cron.ts`, so this needs a **human-authored PR proposal**. The `apps/web` subscription UI and SW handler can be built by agents.

### Pattern 8: Voice and WhatsApp-to-order (conversational capture)
- **Exemplar:** Choco AI: voicemail, SMS, email and WhatsApp become structured ERP orders in seconds; the voice agent takes phone orders in any language [S14].
- **RestoMatch use:** `/dashboard/orders/capture` already turns pasted or shared WhatsApp text into a draft and a one-tap confirm. Extend it:
  1. 🎙 hold-to-talk (MediaRecorder → server transcription → `captureFromText`) with a live Hebrew transcript (P13).
  2. Make `orders/capture` a manifest `share_target` (Android) so "share to RestoMatch" from WhatsApp lands there. Today `share_target` only points at `/dashboard/receiving/share`.
  3. The draft shows parsed lines as editable chips with the contract price badge (`orders/new/contract-price.tsx`) **before** confirmation.
- **Taps:** voice order = hold (1) → review chips → `אשר הזמנה` (2).

### Pattern 9: Reorder from history and par-based suggested order
- **Exemplar:** Choco: "a list of commonly purchased items, tap to reorder" [S14]; Odoo/ERP replenishment [K].
- **RestoMatch use** (`/dashboard/orders/new`):
  - The SUPPLIER step shows each supplier with `הזמנה אחרונה: א׳ 20/10 · 14 פריטים · ₪3,210` and a `[כמו בפעם הקודמת]` chip.
  - BUILD then opens **prefilled** with the last order's lines and 56 px steppers. If an inventory count exists: `מוצע = par − במלאי` with a small `ספירה 23/10` source tag.
  - The REVIEW step is a pinned bar `14 פריטים · ₪3,180 · שלח לספק`, with a contract-price warning count in T2.
- **Taps:** routine reorder = bar `הזמנה` (1) → supplier `כמו בפעם הקודמת` (2) → adjust 2–3 steppers → `שלח` (3+n). Today: 3 taps plus a scroll just to reach the wizard, then a catalog search per line.

### Pattern 10: Walk-in count route: scan-to-jump, big keypad, area order, wake lock
- **Exemplar:** R365 offline counts [S16]; Odoo scan-to-line [S25]; WMS blind count [S31].
- **RestoMatch use** (`/dashboard/inventory/count`, which already has areas, autosave and a pinned progress bar):
  - Lines are sorted by **shelf walk order** per area (drag-to-reorder once, remembered).
  - A sticky scan button at the bottom: scan → the line flashes and focuses → a **custom numeric keypad sheet** (3×4, 64 px keys, `.`, `⌫`, `+pack`, unit label `ק״ג`) → `הבא` auto-advances.
  - Wake Lock is held (P20) and the outbox is used instead of localStorage (P7).
  - The finish bar keeps `34/80 · ₪12,480` and adds `לא נספרו: 46` (tap to filter).
- **Taps per line:** scan (1) + digits + `הבא` (1). There is no keyboard open/close churn.

### Pattern 11: Desktop work surface: sidebar + Cmd/Ctrl+K + split view + keyboard triage + bulk
- **Exemplar:** Linear (keyboard-first, command menu, inbox triage) [S12][K]; HIG sidebar for complex apps [HIG]; M3 Expanded → drawer [S28]; Ramp approvals inbox [S26].
- **RestoMatch use:**
  - **Sidebar** (start side = right in RTL) replaces the 2-row tab wrap. Groups have count badges: `אישורים 12 · ₪18,400`, `חשבוניות ריכוז 3`.
  - **Approvals at ≥ 1024 px:** table (☐ · ₪ · ספק · כלל · גיל · סניף) on the right, invoice detail (lines, image, discrepancies) in a left pane. `J/K` move, `A` approve, `R` reject (focuses the reason field), `E` escalate, `X` select, `Shift+A` approves the selection with a confirm showing **Σ₪ of the selection**, `?` shows the shortcuts sheet.
  - **Invoices / consolidated:** split view with a page image beside its extracted lines; hovering a line highlights its region on the image.
  - **Chain:** branch × KPI matrix (food-cost %, leak ₪, open approvals) with click-through to the branch.
- **Check:** the bookkeeper approves 20 low-risk items in ≤ 60 s without a mouse.

### Pattern 12: Share-sheet hand-off at the dock
- **Exemplar:** Toast/Square handheld closing the loop at the table [S11][S13]; Web Share API [K].
- **RestoMatch use:** the dock slip (already built) uses `navigator.share({title, text, files:[slip.pdf]})` when `navigator.canShare({files})` is true, otherwise falls back to the current `wa.me` text link. The receiver hands the phone to the driver for a **finger signature** in a 56 px-tall full-width signature pad sheet; the signed slip attaches to the GR, giving claims (`/dashboard/leaks/claims`) proof.
- **Why it's about ₪:** a signed shortage at the door raises claim recovery (T3 "₪ recovered").

### Pattern 13: "Back-door terminal" field mode for shared devices
- **Exemplar:** Toast Go / Square Handheld dedicated-device feel; Toast's one-device-per-employee offline practice [S11][S13]; the existing `html[data-pwa='installed']` 56 px CSS [Code].
- **RestoMatch use:** a restaurant setting `מסוף קבלה` for a phone or tablet mounted at the back door:
  - The installed PWA launches straight into today's deliveries (Pattern 1, receiver view).
  - **PIN user switch** (4 digits, rate-limited) instead of sign-out, so the queue is preserved and scoped per user.
  - Field mode is forced: 56 px targets, solid high-contrast surfaces, larger type (17 px body), sound on.
  - Auto-lock to the PIN screen after 5 min idle.
- **Security note:** the PIN switch must still mint a real session per user and keep tenant isolation. This touches auth and RLS, so it needs `tenant-security-warden` review.

---

## 7. Flow tap counts: today vs target (390 px Android, happy path)

| Flow | Today (from code) | Target | Main levers |
|---|---|---|---|
| Receiver: open app → invoice photographed and confirmed (matches PO) | PWA opens inbox → PO card (1) → `צלם` (2) → [iOS chooser (3)] → shutter (4) → Use photo (5) → `עבד` (6) → OCR wait → quick confirm (7) | **4–5** | Pattern 1 tile, `capture="environment"`, Pattern 2 count-first, auto-upload |
| Receiver: 3-page consolidated invoice | Not possible as one invoice (single file) | **5** | Pattern 3 |
| Manager: routine reorder of last week's order | עוד (1) → scroll → הזמנות (2) → הזמנה חדשה (3) → supplier (4) → המשך (5) → search + add per line (2×n) → המשך (6) → שלח (7) | **3 + adjustments** | P1 bar, Pattern 9 |
| Manager: order from a WhatsApp message | Copy → open app → עוד → … → capture → paste → submit → confirm (≈ 7) | **3** (Share → RestoMatch → אשר) | `share_target` on capture (Pattern 8) |
| Owner: approve 4 small items from a push | Not possible (no push); open app → approvals (1) → approve ×4 (5) | **2** (push → `אשר הכל מתחת ל-₪500 (4)`) | Pattern 7 + bulk under threshold |
| Bookkeeper: 20 approvals at desktop | 20 × (scroll + click) ≈ 40+ pointer actions | **≤ 25 keystrokes, 0 mouse** | Pattern 11 |
| Chef: 80-line count | 80 × (tap field + type + dismiss/next) ≈ 240 | **≈ 160** (scan + digits + הבא, no keyboard churn) | Pattern 10 |

---

## 8. Ranked build order (value ÷ risk), with owner and constraints

| Rank | Item | ₪ link (North Star) | Owner (AGENTS.md map) | Effort | Immutable-file risk |
|---|---|---|---|---|---|
| 1 | **G7 fix:** never wipe the unsent queue on sign-out (flush or confirm sheet) | Lost invoices make leaks invisible | web-feature-engineer (`apps/web/lib/pwa`) + test-sentinel | S | none |
| 2 | **P1 role-first bottom bar** (+ Orders for manager, Receiving first for receiver) | Faster ordering and receiving means more invoices matched | web-feature-engineer + rtl-design-steward | S | none |
| 3 | **G9 receiving page parallel fetch + Suspense** (LCP) | The driver waits less, so receivers adopt it | web-feature-engineer | S | none |
| 4 | **P11/Pattern 3 multi-page camera capture** (start with `capture` + `multiple` + page strip; edge detection after) | Consolidated invoices fully matched | ocr-procurement-engineer (ingest) + web-feature-engineer (UI) | M → L | none (OCR pipeline must accept page groups) |
| 5 | **P7/Pattern 4 generalised outbox** (GR lines, submitReceipt, count) | Receives and counts recorded even with no signal | web-feature-engineer + test-sentinel | M | server dedupe keys must be honoured in routers (not immutable) |
| 6 | **Pattern 11 desktop sidebar + Cmd/Ctrl+K + approvals table/split + keyboard + bulk** | Bosses clear the "₪ awaiting approval" backlog faster | web-feature-engineer + rtl-design-steward | M | `approvals/engine.ts` immutable (UI only; bulk = loop of existing approve) |
| 7 | **Pattern 9 reorder-from-last + pinned order bar** | More orders through RestoMatch means more POs to match against | web-feature-engineer | M | none |
| 8 | **P14/Pattern 7 app-wide manifest, iOS install coach, push subscription UI + badge** | T2 ₪ reaches the owner's lock screen | web-feature-engineer; **server delivery = human PR** (`outbox.ts`, `cron.ts`) | M | **yes** (propose) |
| 9 | **P12 barcode scan** (count first, then receiving) | Count accuracy feeds actual food cost | web-feature-engineer (+ catalog mapping: ocr-procurement-engineer) | M | none |
| 10 | P3/P5 **field mode** (56 px, solid surfaces, contrast tokens) | Fewer mis-taps at the door | rtl-design-steward (`packages/ui-tokens`, styles) | S | none |
| 11 | P16 sheets (replace `window.confirm`, reject reason) + P17 skeletons on 8 routes + P9 optimistic | Perceived speed and fewer errors | web-feature-engineer | S–M | none |
| 12 | P13/Pattern 8 voice + share_target order capture | Ordering habit moves into RestoMatch | web-feature-engineer + growth (copy) | M | none |
| 13 | Pattern 12 signature on dock slip, Pattern 13 back-door terminal (PIN switch) | Claim recovery ₪ | web-feature-engineer + **tenant-security-warden review** (auth) | L | auth/RLS adjacent, so security review is required |

**Measurement to add first** (so the impact of all of the above can be proven): RUM `web-vitals` per route and role; flow timers (receive: PO open → confirm; order: bar tap → sent); tap counters on the flows in §7; outbox health (queued count, age p95, failures).

---

## 9. Sources

Fetched in full this session: none (the egress proxy blocked direct fetches). [HIG] and [S32] were read in full from pages another researcher had already saved in `scratchpad/ux/research/apple/*` and `web/android-offline.html`. Every other [S#] rests on search-result text.

- [S1] WebKit, *Web Push for Web Apps on iOS and iPadOS*: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- [S2] WebKit, *Badging for Home Screen Web Apps*: https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
- [S3] MDN, *BarcodeDetector*: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector · caniuse: https://caniuse.com/mdn-api_barcodedetector
- [S4] `barcode-detector` (ZXing-C++ WASM ponyfill/polyfill): https://npmjs.com/package/barcode-detector · README: https://cdn.jsdelivr.net/npm/barcode-detector@3.1.3/README.md
- [S5] Flutter `NavigationBar.height` (M3 default 80): https://api.flutter.dev/flutter/material/NavigationBar/height.html (m3.material.io was unreachable)
- [S6] W3C, *What's New in WCAG 2.2*: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22 · SC 2.5.8 explainer: https://tabnav.com/academy/wcag/success-criterion-2.5.8
- [S7] web.dev, *Interaction to Next Paint*: https://web.dev/articles/inp · *Defining Core Web Vitals thresholds*: https://web.dev/defining-core-web-vitals-thresholds/
- [S8] Alex Russell, *The Performance Inequality Gap* (2023 edition): https://infrequently.org/2022/12/ · 2024 edition summary: https://conffab.com/elsewhere/the-performance-inequality-gap-2024-infrequently-noted/
- [S9] caniuse, *SpeechRecognition.processLocally*: https://caniuse.com/mdn-api_speechrecognition_processlocally · Chrome, *Voice driven web apps*: https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api · WebKit bug 239816: https://bugs.webkit.org/show_bug.cgi?id=239816
- [S10] Shopify POS UI extensions, Tile: https://shopify.dev/docs/api/pos-ui-extensions/latest/web-components/actions/tile · overview: https://shopify.dev/docs/api/pos-ui-extensions/2025-10
- [S11] Toast, *Offline mode overview*: https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html · *Use Toast in offline mode*: https://intercom.help/toast-central/en/articles/14725534-use-toast-in-offline-mode
- [S12] Linear mobile: https://linear.app/mobile · Superhuman swipes & triage bar: https://help.superhuman.com/article/461-mobile-customizing-swipes-and-triage-bar
- [S13] Square, *Process card payments with offline mode*: https://squareup.com/help/gb/en/article/7777 · Square Handheld review: https://www.merchantmaverick.com/?p=211320
- [S14] Choco AI: https://choco.com/uk/stories/suppliers/choco-ai · Choco VoiceAgent: https://choco.com/us/stories/suppliers/introducing-the-choco-voice-agent-built-by-choco-in-collaboration-with-openai · TechCrunch: https://techcrunch.com/?p=1904554
- [S15] MarginEdge help, capture: https://help.marginedge.com/hc/en-us/articles/218822667 · upload status: https://help.marginedge.com/hc/en-us/articles/360035399853-How-do-I-check-the-status-of-invoices-I-ve-uploaded-on-my-phone · App Store: https://apps.apple.com/us/app/-/id1591999728
- [S16] Restaurant365 FAQ (mobile offline counts): https://www.restaurant365.com/faqs/
- [S17] MDN `<input type="file">` / `capture`: https://developer.mozilla.org/docs/Web/HTML/Element/Input/file · HTML Media Capture: https://w3c.github.io/html-media-capture/
- [S18] caniuse, *Background Sync*: https://caniuse.com/background-sync · MDN: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- [S19] caniuse, *navigator.vibrate*: https://caniuse.com/mdn-api_navigator_vibrate
- [S20] Dynamsoft, *Document edge detection & normalization (JS)*: https://dynamsoft.com/codepool/javascript-flutter-document-edge-detection-normalization.html
- [S21] Steven Hoober, *How Do Users Really Hold Mobile Devices?* (UXmatters 2013): https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- [S22] Chrome, *Cross-document view transitions*: https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
- [S23] Next.js, *Progressive Web Apps guide* (mirror): https://unpkg.com/next@16.3.8/dist/docs/01-app/02-guides/progressive-web-apps.md
- [S24] Statcounter, *Mobile OS market share Israel*: https://gs.statcounter.com/os-market-share/mobile/israel
- [S25] Odoo documentation (Barcode receipts) PR: https://github.com/odoo/documentation/pull/6077/files
- [S26] Ramp, *Bill Pay approvals*: https://support.ramp.com/hc/en-us/articles/4417843897747-Bill-Pay-approvals · Ramp mobile: https://ramp.com/mobile
- [S27] DoorDash, *Tablet troubleshooting*: https://help.doordash.com/en-us/merchants/article/how-do-i-troubleshoot-my-tablet · *Receive orders on your tablet*: https://merchants.doordash.com/en-ca/learning-center/receive-orders-on-your-doordash-tablet
- [S28] Android, `WindowWidthSizeClass`: https://developer.android.com/reference/kotlin/androidx/compose/material3/windowsizeclass/WindowWidthSizeClass
- [S29] Compose Material 3 `BottomSheetDefaults.DragHandle`: https://kotlinlang.org/api/compose-multiplatform/material3/androidx.compose.material3/-bottom-sheet-defaults/-drag-handle.html · Flutter BottomSheet: https://api.flutter.dev/flutter/material/BottomSheet-class.html
- [S30] NTNU, *Effects of ambient illumination on text recognition for UI development*: https://ntnuopen.ntnu.no/ntnu-xmlui/handle/11250/2588645 · Silktide contrast: https://silktide.com/?p=39824
- [S31] ShipEdge blind count: https://mobile-docs.shipedge.com/blind-count/overview/ · Racklify blind receipt: https://racklify.com/encyclopedia/blind-receipt-strengthening-accuracy-in-warehouse-receiving/ · Extensiv mobile receiving: https://help.extensiv.com/receiving-in-mobile · ShipMonk receiving errors: https://www.shipmonk.com/resources/content-hub/solve-receiving-errors
- [S32] Android Developers, *Build an offline-first app*: https://developer.android.com/topic/architecture/data-layer/offline-first (full text read from the local copy)
- [HIG] Apple Human Interface Guidelines: Tab bars https://developer.apple.com/design/human-interface-guidelines/tab-bars · Accessibility (44×44 pt min control; 4.5:1 ≤17 pt) https://developer.apple.com/design/human-interface-guidelines/accessibility · Feedback https://developer.apple.com/design/human-interface-guidelines/feedback · Loading https://developer.apple.com/design/human-interface-guidelines/loading · Right to left https://developer.apple.com/design/human-interface-guidelines/right-to-left (full text read from local copies)
