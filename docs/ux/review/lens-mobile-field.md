# Lens review: mobile staff workflows, end to end (`mobile-field`)

**Date:** 2026-10-25 · **Lens:** cross-cutting, all pages · **Viewport:** 390×844 @2x (`*__phone-he.png`), plus code
**Who:** receiver at the back door, chef in the walk-in and on the line, floor manager ordering and approving between covers, owner approving on the go.
**Inputs:** `research/RUBRIC.md` (groups D, F4, F9, G, I), `research/pwa-field.md`, `research/ordering-mobile.md`, `research/functional-gaps.md`, `research/ia-map.md`; 57 dashboard phone captures plus the public showcase (`crawl-results.json`); the code at `wt/` (HEAD `8fef118c`). Crops are in `review/crops-mf/`.
**Related area reviews (no duplication here):**
- `area-receiving.md`: RCV-01…36 hold line-level detail.
- `area-orders.md`: orders-01…35.
- `area-foodcost.md`: FC-01…22.
- `area-approvals.md`: BM-2 covers two-tap mobile decisions.

This lens covers what those area reviews can't:
- the **app shell**;
- the **cross-flow platform** (offline, camera, sheets, push, install, voice, barcode, gloves and sunlight);
- the **tap budget for each flow**.

> **Lab caveats** (not product bugs):
> - The red "מנוע העיבוד לא זמין" banner appears because the lab has no job heartbeat.
> - The consent bar appears because every capture is a first visit. Its overlap with field UI **is** judged here (mobile-field-19).
> - Fixed bars appear mid-page in full-page shots.
> - The crawler set `hasTouch`, but the `@media (pointer: coarse)` 44 px floor (`globals.css:415`) did **not** match in the captures: the approve buttons measure 30 px. On a real phone those targets are 44 px, and every size finding below uses the real-device value.

---

## 0. Verdict

**Scores (0–10, against the world-class benchmark):** mobile **3.5** · desktop (as the field lens sees it) **4.5** · functionality **4.0**.

**What already works:**
- The receiver flow exists end to end.
- Count autosave is careful: debounced, flushes on `visibilitychange`, mirrored to `localStorage` (`count-screen.tsx:99–203`).
- Photos queue offline under an idempotent `clientUploadId`.
- The dock slip goes to WhatsApp.
- The six-language receiver UI is a real moat.
- Every field screen is at least usable at 390 px with no horizontal overflow (`overflowX = 0` on all 57 phone captures).

**Why it is not world-class yet.** The phone gets the **desktop product, narrowed**, not a field product:
- Every role lands on the owner's control room.
- The bottom bar is the first four nav items in array order.
- The global header, bottom bar and consent bar stay inside every task flow.
- Primary actions sit below the fold or behind the nav.
- Every write waits on the network, and sign-out deletes unsent work.
- Platform capabilities are absent: no rear-camera intent, multi-page scan, barcode, voice, push, badge, wake lock, sheet, keypad, Undo or optimistic update. The grep is empty for each (§6).

**Benchmark gap in one line.** A clean delivery takes Choco, Galley and Square about **3 taps and 0 s of waiting**. RestoMatch takes **9 taps, 2 scrolls and an OCR wait**. A routine 10-line order takes R365 or Choco **6–9 taps**. RestoMatch takes **about 40 taps plus 20 typing bursts**.

---

## 1. Who works where (the design input)

| Role | Device and posture | Job on the phone | Today's landing (code + shot) |
|---|---|---|---|
| receiver | Own Android (IL is 66.6% Android), one hand, the other holding a crate; sun or a dark corridor; gloves; the driver is waiting | Today's trucks → check the delivery → evidence → slip to the driver | `/dashboard` = owner leak hero ₪760, "ממתינות לאישור 4" (can't act), activity feed. **No deliveries at all** (`dashboard__receiver__phone-he.png`, tiles 00–02) |
| chef | Phone in a 2–4 °C walk-in (no signal, fog, gloves); greasy fingers on the line | Count, look up a recipe, flag what's short | The same owner hero, then approvals, then recipe alerts on the 3rd screen (`dashboard__chef__phone-he.png`) |
| floor manager | Phone during service, interrupted every 30–90 s | Order before the cut-off, approve, check deliveries | The first viewport is the desktop ViewToolbar (period, compare, 5 filters, chart, CSV, saved views, TV mode); the hero starts at y≈610 (`dashboard__manager__phone-he__00.png`) |
| owner | Phone for T2 alerts; desktop for review | Approve on the go | The same as the manager |

---

## 2. The flows, walked on a 390 px phone (today vs target)

Taps are counted from an open app, on the happy path, from the code and the screenshots. "Typing burst" means the keyboard opens and text is entered.

| # | Flow | Today | Target | Lever (finding) | Exemplar |
|---|---|---|---|---|---|
| F1 | **Receiver: clean delivery** (PO exists; everything arrived) | 9 taps + 2 scrolls + OCR wait (escape only at 30 s, `wizard.tsx:40`) | **3 taps, 0 s:** Today card → "✓ הכל הגיע כמו בהזמנה" → "סיים קבלה". The invoice photo is a parallel 2 taps that never blocks. | 03, 05, 06 | Choco Delivery Check; Galley "Receive outstanding"; Square "Receive All" |
| F2 | **Receiver: same, but OCR slow or failed** (PO-only fallback) | Every PO line becomes `pending_review` with `touched=false` (`_adapters.ts:229–278`), so there is **no quick confirm**. Card → capture (≈5) → wait 30 s → "המשך לקלוט מול ההזמנה" → "המשך להתאמת כמויות" → 1 chip tap per line → "סגור קבלה" ≈ **17–21 taps for 12 lines** | 3 (same as F1) | 03 | Square Receive All |
| F3 | **Receiver: 2 exceptions** (1 short, 1 damaged with a photo) | ≈16–19 taps; a per-line photo is **impossible**; "פגום" doesn't change the quantity | **≤13:** 3 + per exception (✗ 1, reason chip 1, stepper 0–2, 📷 2, שמור 1) | 03, 04, 17 | Choco issue types + photo; Cut+Dry "Request a credit" |
| F4 | **Receiver: supplier arrives with no PO** | **Dead end** (no entry point, `receiving/page.tsx:46–111`) | **≤6 + 1 per line:** FAB "משלוח ללא הזמנה" → recent-supplier chip → guide lines → ✓/✗ → סיים | 09 | Galley ad-hoc receiving; Odoo create-on-the-spot receipt |
| F5 | **Receiver: 3-page consolidated invoice** | **Impossible as one invoice:** `files?.[0]` (`InvoiceScan.tsx:229`) | **5:** 📷 → shutter ×3 (or auto) → "סיום · 3 עמ׳" | 04 | Toast xtraCHEF "Add Page"; MarginEdge one photo per page |
| F6 | **Receiver: full receipt with no signal** | **Impossible:** the photo queues, then the wizard jumps back to the scan step with a red alert (`wizard.tsx:266–273`); marks only persist online at submit | Same taps as online, plus a visible "⟳ 3 ממתינים", syncing exactly once | 02 | Toast Go offline mode; R365 offline counts; WISK unsynced count |
| F7 | **Manager: routine 10-line order** | עוד → scroll → הזמנות → הזמנה חדשה → select → option → המשך → (search, tap, edit qty) ×10 → לסקירה → שלח ≈ **40 taps + 20 typing bursts**, 3–5 min | **6–9 taps, 0 keyboard, ≤45 s:** Today card "ירקות השרון · נסגר בעוד 2:15" → guide prefilled → 2–3 steppers → המשך → שלח | 07, 08 | R365 "Autofill to Par"; Choco order guide; Ordermentum |
| F8 | **Manager: repeat last week's order** | Not possible (re-type it) | **3–4:** row ⋯ → "הזמן שוב" → (replace/combine sheet) → שלח | 08 | Choco "Order again" |
| F9 | **Manager: WhatsApp message → PO** | Copy → app → עוד → scroll → הזמנות → "הדבקת הזמנה" → paste → create → confirm ≈ 8 taps + 2 app switches. The share target exists only in the receiver PWA, and it redirects to a page that 404s for the receiver. | **3:** WhatsApp Share → RestoMatch → "אשר הזמנה" | 09, 12 | Choco OrderAgent |
| F10 | **Chef: "the onions ran out"** | Impossible: the chef has no orders route (`roles.ts:70`) | **4:** bar "הזמנה" → supplier → + stepper → "שלח למנהל" | 09 | Choco Team Order |
| F11 | **Owner: approve 1 flagged item** | No push. Open app → bar אישורים → scroll past the filter panel → "אשר" (inline-end corner, 12 px text) = 2 taps + scroll; **no Undo** | **2:** push → peek card "אשר תשלום כפי שחויב" + 10 s Undo | 11, 13, 15 | Ramp mobile inbox; BILL mobile |
| F12 | **Owner: 4 small warn items (≤₪200 each)** | 1 + 4 + scrolls | **2:** "אשר 4 מתחת ל-₪200 · ₪296" (never `block`, R-12) | 11 | BILL "Approve Selected" |
| F13 | **Manager: reject with a reason** | דחה → keyboard, type → confirm: 2 taps + a typing burst | **3 taps, 0 typing:** דחה → reason chip in a sheet → "דחה ובקש זיכוי" | 11, 17 | Superhuman triage bar |
| F14 | **Chef: 80-line count** | 80 field taps + 80 typing bursts. The keyboard "next" lands on the next row's **area `<select>`** (DOM order, `count-screen.tsx:328–375`); alphabetical order means walking back and forth | **80 digit entries, 0 navigation taps:** "הבא" → next uncounted line, in walk order; scan to jump; finish = 2 | 10, 21 | R365 counts; Sysco list sequencing; Odoo scan-to-line |
| F15 | **Chef: "how much entrecôte goes in the steak?" during service** | Bar עלות מנה → scroll ~1.5 screens to the search → type → tap a 3-line-wrapped row → **edit form** → scroll to the ingredients and read an input = 3 taps + 2 scrolls + typing | **2:** bar מתכונים (recents + autofocused search) → **read-only service card** with portion scaling | 16 | meez recipe cards |
| F16 | **Install the app + allow alerts** | Receiver on Chromium only (install card on receiving pages); iOS: nothing; other roles: nothing; push: none | Android: an install sheet after the 2nd completed task (2 taps). iOS: a 3-step coach sheet. Push: 1 tap after a meaningful action. | 12, 13 | WebKit Home-Screen web apps (16.4+) |
| F17 | **Shift change on a shared back-door phone** | Drawer → התנתקות (**wipes unsent photos**) → email + password ≈ 6 taps + typing | **2 taps + 4 digits:** "החלף משתמש" → PIN; queue kept and attributed | 01, 25 | Toast/Square employee PIN |

**Tap budgets to enforce (CI-measurable, Playwright "tap counter" helper):**
- receive clean ≤3;
- each exception ≤4 (+2 for a photo);
- routine order ≤9;
- repeat ≤4;
- WhatsApp to PO ≤3;
- approve from push ≤2;
- count navigation 0 per line;
- recipe lookup ≤2.

---

## 3. Mobile app-shell spec (the deliverable)

One shell, three modes. It replaces the narrowed desktop shell (`dashboard/layout.tsx`, `nav.tsx` MobileNav) below `lg`.

### 3.1 Breakpoints and modes
| Width (CSS px) | Shell | Notes |
|---|---|---|
| < 600 (compact) | **Phone shell:** top bar + role bottom bar | All field roles |
| 600–1023 (medium; kitchen or dock tablet) | Top bar + **navigation rail** 80 px on the inline-start edge (right in RTL) | Rail items = the same role set as the bottom bar; field mode identical |
| ≥ 1024 | Desktop sidebar (out of this lens) | — |

Modes, set as `data-mode` on `<html>`:
- `browse`: the default.
- `field`: task focus (§3.4).
- `kiosk`: the shared back-door device, with forced field tokens and a PIN lock (§3.9).

### 3.2 Layers (z-index tokens)
`content 0 · sticky-section-header 10 · action-bar 30 · top-bar 40 · bottom-bar 40 · scrim 50 · sheet 51 · snackbar 60 · skip-link 70`. Never more than one sheet. Snackbars sit above the action bar or bottom bar: `bottom: calc(var(--rm-actionbar-h, var(--rm-bottomnav-h)) + 8px)`.

### 3.3 Top bar (browse mode)
- **Height and surface:** 56 px + `env(safe-area-inset-top)`. Solid `surface` with a 1 px `line` bottom border. **No `glass`** (today `layout.tsx:121` and `globals.css:187` render 82% white plus blur; content ghosts through it in sunlight).
- **Inline-start (right in RTL):**
  - restaurant or branch name: 16/600 ink, one line;
  - under it, a 12 px role chip "מקבל סחורה";
  - for users with more than one membership, a tap opens the **branch sheet**. Today the branch switcher lives in the drawer only.
- **Inline-end (left), all 48×48:**
  - 🔍 opens the palette as a full-height sheet. Today search exists only inside the drawer (`nav.tsx:355`), which costs 2 taps plus typing.
  - **sync chip** (§3.7), shown only when the queue is above 0 or the device is offline;
  - avatar → **account sheet**: language, sign-out (§3.9), app install, alert settings.
- **Removed from the phone header:**
  - the mono e-mail (`layout.tsx:146–150`): it means nothing to staff and truncates to "…ceiver@kfar-hazeitim.test";
  - the full-width language `<select>` (`layout.tsx:166–170`), which moves to the account sheet. Exception: with `receiverLanguages` on, a compact 48 px language chip stays, because the language is the receiver's lifeline.
- **Also removed:** the ☰ button, which duplicates "עוד".

### 3.4 Bottom bar (browse mode)
- **Height and surface:** 64 px + `env(safe-area-inset-bottom)` (today 52 px, measured on `dashboard_receiving_ID__receiver__phone-he__00.png`, y 684–736). Solid `surface`, top hairline, publishes `--rm-bottomnav-h`.
- **Items:** 4 role destinations + "עוד". Home sits on the inline-start (right).
- **Labels:** 12 px / 500, 600 when active, **never truncated** (today `text-[11px]` + `truncate`, `nav.tsx:432–438`). Labels are 7 Hebrew letters or fewer, except "חשבוניות" (8 letters); check it fits a 72 px slot at 360 px.
- **Active state:** a 56×32 pill (`primary/12`) behind the icon, plus `aria-current="page"`.
- **Badges:** a count pill on actionable queues only. Danger only when a `block` exists; capped at "99+"; hidden at 0.
- **Role sets** (hard-coded per role, replacing `barCandidates.slice(0,4)` at `nav.tsx:275–278`):

| Role | 1 (home) | 2 | 3 | 4 | Badges |
|---|---|---|---|---|---|
| receiver | היום (deliveries board) | קבלות (my receipts + sync) | ספקים (call / WhatsApp the agent) | — (3 + עוד is fine) | היום: late + due-now count |
| chef | היום | ספירה | מתכונים | הזמנה (draft request) | ספירה: dot when a draft count is open |
| manager | היום | הזמנות | אישורים | קבלה | הזמנות: chef drafts waiting / cut-off < 30 min; אישורים: block+warn |
| owner | בית | אישורים | דליפות | הזמנות (chain owner: רשת) | אישורים |
| bookkeeper | בית | אישורים | חשבוניות | ייצוא | אישורים, חשבוניות |

- **Never an action in the bar** (HIG): capture and "משלוח ללא הזמנה" are a FAB or a Today tile.
- **Hidden** in field mode and while the keyboard is open.

### 3.5 Field mode (`<FieldShell>`): the task focus frame
- **Routes:** `receiving/[poId]` (+ the no-PO receive), `inventory/count`, `orders/new` (BUILD/REVIEW), `orders/capture`, and the camera.
- **Setup:** set `data-mode="field"` in a route-group layout (`app/dashboard/(field)/layout.tsx`), so page code doesn't toggle it.
- **Task header**, replacing the top bar and bottom bar. 56 px, solid:
  - inline-start: **× סגור** (48×48). If there is unsynced or unsaved work, it opens a leave sheet ("3 שורות נשמרו בטלפון ויישלחו אוטומטית · צא / המשך"). It never leaves silently, unlike `history.back()` today (`wizard.tsx:557`);
  - title 17/600 ("ירקות השרון");
  - subtitle 13 px ink-muted ("הזמנה #1042 · 12 שורות · 07:30");
  - inline-end: the sync chip, the flow tool (📷 in receiving, 🔍/scan in the count, ⋮ overflow).
- **Progress:** a 4 px determinate bar under the header, showing real counts ("9/12"), not a step index.
- **`<ActionBar>`** (sticky bottom):
  - solid `surface`, top hairline, `padding: 12px 16px calc(12px + env(safe-area-inset-bottom))`;
  - **one** primary, full width (viewport − 32 px), **56 px**, label naming the outcome ("סיים קבלה · 12/12");
  - an optional counter line or **one** secondary text button, 48 px, *above* the primary, never beside it;
  - publishes `--rm-actionbar-h`.
- **Keyboard:** set `export const viewport = { viewportFit: 'cover', interactiveWidget: 'resizes-content' }` in `app/layout.tsx`. Neither is set today, and `env(safe-area-inset-*)` is 0 without `viewport-fit=cover` [K]. The ActionBar then rides above the Android keyboard. iOS gets a `visualViewport` offset fallback.
- **Chrome suppressed in field mode:**
  - the bottom bar;
  - the cookie consent, deferred until the task ends (analytics stay off meanwhile, so it stays compliant);
  - the worker-down banner, which collapses into a neutral header chip "עיבוד חשבוניות מושהה".
- **Screen Wake Lock** while the task is open, re-acquired on `visibilitychange`.

### 3.6 Field tokens (`[data-mode=field]`, in `packages/ui-tokens` + `globals.css`)
| Token | Value | Today |
|---|---|---|
| target-min | 48 px, with gaps ≥ 8 px | 44 px coarse floor (`globals.css:415–427`) |
| target-primary, stepper | 56 px | 48 px steppers (`AdjustQuantities.tsx:229, 250`); 44 px chips (`:325`) |
| text: body / item name / qty & ₪ | 16 / 17-600 / 24-700 tabular | 14–16; `text-xs` meta; `text-[11px] text-subtle` (`count-screen.tsx:351`) |
| floor | 14 px. No `text-xs` or `text-[11px]` on field routes (lint) | Many |
| ink on numbers and names | `ink` 16:1 only. `muted` (7.0:1 on white, 6.6:1 on bg) for labels only; `subtle` (5.7:1, 5.4:1) banned | Numbers in `muted` on several cards |
| input border | `line-strong-field` ≥ 4.5:1 on white (e.g. `#66756D` = 4.85:1) | `lineStrong #7A8B82` ≈ 3.6:1 |
| surfaces | Solid. No `glass`, no `backdrop-blur` | Glass header and bottom bar; `bg-surface/95 backdrop-blur` count bar |
| focus | 3 px ring, ≥ 3:1 | 2 px `primary/60` |
| motion | ≤ 150 ms, transform/opacity only; none under `prefers-reduced-motion` | GSAP staggers + an infinite pulse (finding 23) |
| `prefers-contrast: more` | Swap muted → ink, borders → ink | Not handled |

Today's `html[data-pwa='installed'] main … {min-height:56px}` rule (`ReceiverPwa.tsx:37–42`) applies only to installed receivers on receiving pages. It becomes the general field-token layer above.

### 3.7 Sync chip and outbox UI (one for every field write)
| State | Chip (header) | Tone |
|---|---|---|
| online, queue 0 | hidden | — |
| online, queue N | "⟳ 3 ממתינים" | neutral (T4) |
| offline | "אין חיבור · נשמר בטלפון" | **neutral (T4), never red or warn.** Today's offline banner is warn (`ReceiverPwa.tsx:176`) and the queued-photo message is a red `role=alert` (`wizard.tsx:543–547`) |
| failed ≥ 1 | "⚠ 1 נכשל" | warn |

- **Tap target:** a tap opens the **Outbox sheet**. One row per item ("קבלה · ירקות השרון · 07:41 · נשמר בטלפון"), each with "נסה שוב" or "פתח".
- **Unsynced items:** a hollow ✓ "נשמר בטלפון", never the solid T3 ✓.
- **Never a ₪ result on an unsynced item:** the engine computes ₪ after sync.

### 3.8 Overlay primitives (new, in `lib/components`)
- **`<Sheet>`** (modal bottom sheet):
  - detents 50% / 92%;
  - grabber 32×4 inside a 48 px hit area;
  - scrim `ink/40`;
  - close with a 48 px × button, swipe-down or Esc;
  - focus trap, focus returns to the trigger;
  - primary pinned at the sheet bottom (56 px);
  - `role="dialog" aria-modal="true" aria-labelledby`.
  - Uses: exception line, reject reason, branch and account, palette, supplier picker, unknown-barcode link, leave-task, sign-out-with-queue, discard count, replace/combine draft. It replaces every native `window.confirm`.
- **`<QtyKeypad>`** (sheet):
  - 3×4 grid of 64 px keys, with "," and ⌫;
  - unit label;
  - a reference line ("הוזמן 12.000 ק״ג");
  - a live variance line ("−3.0%", warn when over 10%);
  - "אישור" 56 px; over the threshold it asks a second time.
  - Used for weighed units (ק״ג, ליטר). Counted units use a 56×56 stepper with long-press repeat (400 ms delay, then about 8 per second).
- **`<Snackbar>`:**
  - 10 s with an action (R-6, R-7); errors persist;
  - one at a time on a phone;
  - pauses while touched or focused;
  - `role="status"`, errors `role="alert"`.
- **`<DocCamera>`, `<PhotoField>`, `<ScanButton>`, `<MicButton>`:** see findings 04, 21 and 20.

### 3.9 Identity on shared devices
- **Sign-out with a non-empty queue:**
  - online: flush first, blocking, with progress;
  - offline: show a sheet "3 חשבוניות לא נשלחו. התנתקות תמחק אותן · המתן לחיבור / מחק והתנתק".
- **Kiosk mode** (restaurant setting "מסוף קבלה"): a PIN user switch and auto-lock after 5 min idle; the queue stays attributed per user (finding 25).

### 3.10 Performance budget (field routes)
- **Route-specific JS:** ≤ 170 KB gz, with no GSAP on field routes.
- **Core Web Vitals:** p75 LCP ≤ 2.5 s on a Moto G Power over slow 4G; INP ≤ 200 ms; CLS ≤ 0.05.
- **Loading states:** a layout-true `loading.tsx` on every field route. Today only receiving, approvals, exports, settings and suppliers have one.
- **Server work before first paint:** at most one server round trip (`Promise.all`, then `<Suspense>` for optional data).
- **RUM:** `web-vitals` tagged by route and role, plus the flow timers and tap counters from §2.

### 3.11 PWA surface (app-wide)
- **One manifest:** `id:"/dashboard"`, `scope:"/dashboard"`, `start_url:"/dashboard?source=pwa"`.
- **`shortcuts`:** קבלת משלוח, ספירה, הזמנה חדשה, אישורים.
- **`share_target`:** `POST` multipart, accepting `image/*` and `application/pdf` files as well as text. It goes to `/dashboard/share`, which opens a chooser sheet: "חשבונית למשלוח של היום?" for files, "הזמנה מוואטסאפ" for text.
- **Linking:** `<link rel=manifest>` plus `appleWebApp` metadata in the **root** layout. Today the manifest is linked only from receiving pages (`ReceiverPwa.tsx:164`).
- **Install and push timing:** see findings 12 and 13.

---

## 4. Findings

Severity uses the task scale:
- **P0:** blocks or misleads a core task, or loses ₪ or trust.
- **P1:** major friction, or below par against the benchmark.
- **P2:** polish.
- **P3:** nit.

**humanPR** = the full fix needs an immutable file or the schema (AGENTS.md).

### P0

**mobile-field-01 · Sign-out silently destroys unsent invoice photos** · `/dashboard/*` (drawer sign-out) · receiver · mobile · trust/functional · S · humanPR no · G7, C10
- **Evidence:**
  - `lib/pwa/PwaSessionGuard.tsx:17–20`: any submit of a `data-rm-logout` form calls `clearQueue()` with no check or warning.
  - `:16`: `purgeOtherUsers` drops another user's queued photos on the next login.
  - The sign-out button sits in the drawer footer next to the language picker (`nav.tsx:395–408`).
- **Problem:** on a shared back-door phone, receiver A shoots 3 invoices in the basement and signs out. The photos are gone and never matched, so their leak never reaches the hero. This is the North Star failing silently.
- **Fix:**
  - Gate the sign-out form. If `queueCount > 0`:
    - online: flush first, with a blocking progress sheet;
    - offline: a `<Sheet>` "3 חשבוניות לא נשלחו · התנתקות תמחק אותן מהטלפון" with **המתן לחיבור** (primary) and **מחק והתנתק** (a destructive text button that names the count).
  - Replace `purgeOtherUsers` with "keep them under the original user and upload when that user signs in". Show a T4 note "2 צילומים של דנה ממתינים לה".
  - Unit test: logout with a queue never calls `clearQueue()` without explicit confirmation.
- **Exemplar:** Toast Go warns that uninstalling while offline loses data; MarginEdge "Pending Uploads".

**mobile-field-02 · Field writes are online-only and live in memory; there is no shared outbox and no sync state** · receiving, count, orders/new, approvals · all field roles · mobile · functional/states · L · humanPR no · G7, I2, G1
- **Evidence:**
  - Receiving marks are React state until `submit()`, which then runs N sequential `markGrLine` round trips (`receiving/[poId]/wizard.tsx:123, 494–507`). A reload, a call, an iOS tab eviction or a nav tap loses them. Reopening starts again at `SCAN_INVOICE` (`:104`).
  - Offline, the photo queues but the wizard **returns to the scan step** with a red `role=alert` (`:266–273, 543–547`), so the receiver can't count.
  - The service worker caches only `offline.html` and navigations fall back to it (`receiver-sw.js/route.ts:38–51`), so a PO page can't open with no signal.
  - The count keeps unsaved edits in `localStorage` (good) but retries every 3 s with no visible queue (`count-screen.tsx:118–163`).
  - Order-wizard lines are memory-only.
  - Grep: no `useOptimistic`, `onMutate`, `storage.persist` or `wakeLock`.
- **Fix:** grow `lib/pwa/offlineQueue.ts` into `lib/pwa/outbox.ts`:
  - typed mutations `{id: uuid (idempotency key), kind: 'grLine'|'submitReceipt'|'countLines'|'orderDraft'|'photo', payload, restaurantId, userId, createdAt, attempts}` in IndexedDB;
  - drain on `online`, `visibilitychange`, app start and every 30 s while visible, with backoff 2→60 s; never retry a 4xx;
  - server dedupe on the key (the same M8 pattern as `clientUploadId`; routers are not immutable).
- **Also:**
  - At shift start, precache `receiving.todayExpectations` plus each `getPo` into IndexedDB, so receiving renders with zero bars.
  - Header sync chip and Outbox sheet (§3.7). The offline state is T4 neutral.
  - Stay online-only, and say so: approve payment, send order to supplier, pay-run.
- **Check:** in airplane mode a full receipt and a 20-line count complete, reload keeps them, and back online they sync exactly once within 10 s.
- **Exemplar:** Android "Build an offline-first app" (queued writes, backoff, last-write-wins); R365 offline counts; Supy's warning about the silent-failure mode.
- **Area detail:** RCV-02, RCV-09, FC-08, orders-07.

**mobile-field-03 · Receiving is invoice-first and gated by OCR: 9 taps plus a wait for a clean delivery, 1 tap per line when OCR is slow, and a matched line can't be marked short** · `/dashboard/receiving/[poId]` · receiver · mobile · flow/functional · L · humanPR no · G4, G5, I3
- **Evidence:**
  - `STEP_ORDER` starts at `SCAN_INVOICE` (`wizard.tsx:77–83`), and the "המשך לקלוט מול ההזמנה" escape appears at 30 s (`:40`).
  - In PO-only mode every line is `pending_review` with `touched:false` (`_adapters.ts:229–278`), so quick confirm is hidden (`Reconciliation.tsx` `allGood`) and Adjust needs one chip per line.
  - `matched` lines are pre-touched and read-only in Adjust (RCV-01).
  - Screens: `dashboard_receiving_ID__receiver__phone-he__00/01.png` (the capture CTA is at y≈944 on an 844 px viewport, under the nav).
- **Fix:** the **Delivery Check** screen (big move BM-3):
  - opens on the PO lines, pre-filled with the ordered (or supplier-confirmed) quantity;
  - **"✓ הכל הגיע כמו בהזמנה"** as the ActionBar secondary, **"סיים קבלה · 9/12"** as the primary;
  - ✓ / ✗ per row (48 px); ✗ opens the exception sheet (reason chips, a stepper or keypad, 📷, שמור);
  - 📷 in the task header runs OCR in the background, and the reconciliation arrives as a T2 banner after the count ("החשבונית נקראה · 2 הבדלי מחיר · ₪46");
  - price differences route to the manager and never block the door.
- **Budget:** F1 ≤3 taps; F3 ≤13.
- **Exemplar:** Choco Delivery Check; Galley "Receive outstanding / modified / no longer expected"; Square Receive All.
- **Area detail:** RCV-01, RCV-05, RCV-15.

**mobile-field-04 · Camera capture is a file picker: one page, no rear-camera intent, no quality gate, no per-line evidence, and a "demo invoice" button on every real delivery** · receiving scan, inbox upload, consolidated panel, dock evidence · receiver · mobile · functional · M→L · humanPR no · G6, G8
- **Evidence:**
  - `InvoiceScan.tsx:223–232`: `<input type="file" accept="image/*,application/pdf">` with no `capture`, no `multiple`, and only `files?.[0]`.
  - `:195–213`: the 4:5 "viewfinder" is a decorative box, with a GSAP corner pulse on `repeat:-1` (`:85–91`).
  - `:262–268` + `he.ts:49`: "השתמש בחשבונית-דמה (ללא העלאה)" is shown on production deliveries. In the dashboard it silently becomes the PO-only path.
  - The upload shows a spinner although a percentage could be shown.
  - `AdjustQuantities.tsx:281–286`: "פגום" takes no photo, although `gr_lines.photos jsonb` exists.
  - `manifest.webmanifest`: `share_target` is GET and text-only, so an invoice photo or PDF the supplier sends on WhatsApp can't be shared into the app.
- **Why it matters:** consolidated invoices (`חשבוניות ריכוז`) run to several pages, and page 2+ lines never reach the matcher, so the leak is under-counted (rubric G6 = S0).
- **Fix:** one `<DocCamera>` for every capture point.
  - **v1:**
    - primary "📷 צלם חשבונית" = `<input accept="image/*" capture="environment" multiple>` inside a page loop: "+ עמוד" / "סיימתי · שלח 3 עמ׳", a 64×80 thumbnail strip with retake, delete and ▲▼ reorder, up to 10 pages under one `clientUploadId` group, one invoice;
    - "העלה קובץ / PDF" as a text link;
    - a client blur/darkness gate (Laplacian variance plus mean luminance, under 1 s) with a **named** reason: "כהה מדי — התקרב לאור";
    - a determinate `role="progressbar"`;
    - remove the demo button outside `/showcase`.
  - **v2:** a `getUserMedia` viewfinder with quad detection, auto-capture after 600–700 ms of stability, a 72 px shutter and a torch toggle on Android.
  - **`<PhotoField>`:** one 48 px rear-camera tap on every exception row, shown on the dock slip and the claim.
  - **`share_target`:** POST multipart with files (§3.11).
- **Exemplar:** Toast xtraCHEF "Add Page"; MarginEdge (one photo per page, blur warning, per-photo status); Dynamsoft/Veryfi edge detection.
- **Area detail:** RCV-03, RCV-16, RCV-07.

### P1

**mobile-field-05 · There is no field mode: global chrome stays inside every task, and primaries sit below the fold or behind the nav** · receiving/[poId], inventory/count, orders/new, orders/capture · all field roles · mobile · flow/visual · M · humanPR no · G1, G2
- **Evidence:**
  - The bottom nav renders on every route (`nav.tsx:417–461`). Field screens push their footers above it: `wizard.tsx:644`, and `count-screen.tsx:403` `bottom-[calc(4.5rem+…+var(--consent-h))]`.
  - Measured at 390×844, first visit, on `dashboard_receiving_ID__receiver__phone-he__00.png`: header 68 px + bottom nav 52 px + consent 107 px = **27% of the screen**. On the count route add the finish bar (≈100 px) for **≈39%**.
  - The scan CTA sits at y≈944 (the viewport is 844).
  - "יצירת טיוטת הזמנה" is half hidden behind the nav (`dashboard_orders_capture__owner__phone-he__00.png`).
  - The order wizard's "המשך" / "לסקירה" are in-flow `size="sm"` buttons with 12 px text (`orders/new/wizard.tsx:291, 510–513`; `Button.tsx:31`).
  - Two "back" affordances on the scan step ("חזרה לרשימת המשלוחים" at the top and "חזרה" at the bottom).
- **Fix:** `<FieldShell>` + `<ActionBar>` exactly as in §3.5: task header with × and a leave guard, bottom nav hidden, one 56 px full-width primary in the bottom third, secondary as a text button above it, consent and worker banner deferred.
- **CI:** Playwright asserts on every field route at 375×667 and 390×844 that `[data-primary]` has `boundingBox.y ≥ 0.66 × vh` and width ≥ vw − 40, and that `nav[aria-label=mobile]` is absent.
- **Exemplar:** Shopify POS and DoorDash full-screen task flows; Choco's pinned Basket.

**mobile-field-06 · Every role lands on the owner's control room; the receiver's home has no deliveries at all** · `/dashboard` · receiver, chef, manager · mobile · ia · M · humanPR no · D1, A5
- **Evidence:**
  - `dashboard/page.tsx:59`: "the hero is for every role".
  - `:166–188`: ViewToolbar with period, compare, 5 filters, chart, CSV, saved views and TV mode for everyone.
  - `dashboard__receiver__phone-he__00–02.png`: ₪760 hero, "ממתינות לאישור 4" (the receiver can't approve), an activity feed, and **zero trucks**.
  - `dashboard__manager__phone-he__00.png`: the toolbar fills the first viewport.
  - `dashboard__chef__phone-he__02.png`: the chef's recipe alert is on the 3rd screen.
- **Fix:** a role "Today" home below `lg` (keep the owner hero for owner and bookkeeper):
  - **receiver:** a 48 px summary strip "היום: 5 משלוחים · 2 התקבלו · 1 באיחור", the next truck enlarged with one CTA naming the next state ("התחל קבלה" → "המשך קבלה 3/12" → "ממתין לקריאת חשבונית" → "הושלם ✓"), time-window groups, late in warn with a word, a "ללא תאריך" bucket, and a FAB "משלוח ללא הזמנה";
  - **chef:** count due or open (with progress), dishes over target (from `RecipesOverviewCard`), "חסר משהו? בקש הזמנה";
  - **manager:** cut-off board (the next 3 suppliers by cut-off, chips "נסגר בעוד 2:15"), chef drafts to send, ₪ awaiting approval (top 3, one CTA each), today's deliveries;
  - **owner on phone:** T1 hero plus a "מחכה לך" stack of 3.
- **Also:** hide ViewToolbar below `lg` behind a "תצוגה ▾" sheet.
- **Exemplar:** Apicbase mobile tiles (Count, Waste, Receive Order); Shopify POS smart grid; Sysco "today's delivery on login"; Ramp inbox.

**mobile-field-07 · The bottom bar is mechanical, not role-first: managers have no Orders, two roles waste a slot on Settings, and the labels are 11 px and truncate** · all routes · all roles · mobile · ia/visual · S · humanPR no · D3, D2
- **Evidence:**
  - `nav.tsx:275–278`: `primary = barCandidates.slice(0,4)` plus a leaks pin.
  - Bars today:
    - manager/owner: סקירה · קליטת סחורה · תור אישורים · בלש דליפות;
    - chef: סקירה · עלות מנה · ספירת מלאי · הגדרות;
    - receiver: סקירה · קליטת סחורה · הגדרות.
  - `:432–438`: `text-[11px]` + `truncate`.
  - `:421`: `glass`, translucent.
  - Measured 52 px tall.
  - No badges, except contracts in the drawer.
  - A ☰ in the header duplicates "עוד".
  - Screens: `dashboard_orders__manager__phone-he__00.png`, `dashboard_inventory__chef__phone-he__00.png`, `dashboard_receiving__receiver__phone-he__00.png`.
- **Fix:** the per-role sets, size, badges and solid surface in §3.4.
- **Check:**
  - the manager reaches `orders/new` in ≤1 tap from Today (today: 3 taps + a scroll);
  - no label is truncated at 360 px in he, en, ar or ru;
  - the bar is ≥ 64 px + the safe area.
- **Exemplar:** Material 3 navigation bar (80 dp, 3–5 destinations); iOS tab bar ("fewer tabs are easier"); Linear mobile.
- **Area detail:** orders-16, RCV-18.

**mobile-field-08 · A routine order costs about 40 taps and 20 typing bursts on the phone** · `/dashboard/orders/new` · manager, owner · mobile · flow/functional · L · humanPR partial (par/MOV storage only) · G9, C7, F4
- **Evidence:**
  - Native `<Select>` for the supplier, with no cut-off context (`wizard.tsx:262`).
  - BUILD opens on search, an 8-row `max-h-64` list (`:326`).
  - A tap adds the line at `qty: 1` (`:358`).
  - The qty is `type="number"` (`:446`) and the price is `type="number"` (`:468`); the floor manager can overwrite the expected price.
  - The unit is a free-text input.
  - The delete control is `rounded p-1` (24 px) right beside the price field (`:490`).
  - `size="sm"` Continue/Back (`:510–513`).
  - No guide, "order again", cut-off countdown or pinned cart.
  - Screens: `dashboard_orders_new__owner__phone-he__00.png`, `dashboard_orders__manager__phone-he__00/01.png` (the "מחירים בהזמנה לספק" settings checkbox sits on the list above the orders).
- **Fix** (BM-4):
  - **Supplier step:** a board sorted by next cut-off, with chips. Rows of 72 px: name + "יום הזמנה היום · משלוח ב׳ 07:00".
  - **BUILD:** the supplier's **guide** (lines from the last 8 POs, grouped by storage area):
    - 64 px rows; context line "אחרון 6 · ממוצע 5";
    - 56 px steppers for counted units, `<QtyKeypad>` for weighed units;
    - price read-only, with the contract badge;
    - "+ פריט אחר" (search) at the bottom.
  - **⋮ menu:** "כמו בהזמנה הקודמת" / "כמות מוצעת" / "אפס", each with a 10 s Undo.
  - **Sticky cart bar:** "7 פריטים · ₪1,240 · משלוח מחר 07:00 · המשך".
  - **REVIEW:** "שכחת משהו?" (items in ≥3 of the last 4 POs), the literal outgoing message, and a CTA naming the channel: "שלח לירקות השרון ב-WhatsApp".
  - **Orders list rows:** "הזמן שוב". Move the price-document setting to Settings.
  - **Persistence:** draft lines go to the outbox.
  - **Human PR:** par and MOV need a migration plus `schema.ts`.
- **Budget:** F7 ≤9, F8 ≤4.
- **Exemplar:** R365 "Autofill to Par" (top-right menu); Choco order guide and "Order again"; US Foods MOXē "Did You Forget"; Ordermentum MOV at checkout.
- **Area detail:** orders-01, -02, -04, -06, -07, -23.

**mobile-field-09 · Mobile capabilities are missing per role: the chef can't request an order, the receiver can't receive without a PO, and the receiver app's only share target is a 404 for receivers** · orders, receiving, share · chef, receiver · mobile · functional · M · humanPR no (a new procedure needs an add-only COVERAGE entry and `tenant-security-warden` review) · D1, D7, G4
- **Evidence:**
  - `lib/roles.ts:70`: `/dashboard/orders` is limited to `['owner','manager']`, and `createDraft`/`placeOrder` are `managerProcedure` (orders-03).
  - `receiving/page.tsx:46–51`: the empty state has no CTA, and there is no "arrived without an order" path (RCV-04). The public showcase promises one.
  - `public/pwa/manifest.webmanifest`: `scope:/dashboard/receiving`, `share_target → /dashboard/receiving/share`, which **redirects to `/dashboard/orders/capture`** (`share/route.ts:10–19`). That page calls `notFound()` for any role other than owner or manager (`orders/capture/page.tsx:23–24`). The capture page is also outside the PWA scope, so it opens in browser chrome.
- **Fix:**
  - **Chef draft request:** a new `orders.createDraftRequest` (chef, manager, owner) and a chef bar item "הזמנה". The chef's primary is "שלח למנהל לאישור" with a note field. The manager's orders list gets "ממתין לשליחה (2)" with a one-tap "שלח לספק". `placeOrder` stays manager-only.
  - **Receiver ad-hoc receive:** "משלוח ללא הזמנה" → supplier (recent chips) → guide lines → the Delivery Check → a GR plus a retro PO (`source='manual'`, notes "קבלה ללא הזמנה").
  - **Share target:** route by role and payload. A file goes to "חשבונית למשלוח?" for every role. Text goes to capture for manager or owner, and to "שלח למנהל כבקשת הזמנה" for chef or receiver.
- **Exemplar:** Choco Team Order (contributors draft, admins submit); Galley ad-hoc receiving.

**mobile-field-10 · The count doesn't follow the walk: "next" lands on a select, rows are alphabetical, and there is no last count, no scan and no find** · `/dashboard/inventory/count` · chef, manager · mobile · functional · M · humanPR partial (persisting walk order) · G9, G5, G1, F4
- **Evidence:**
  - DOM order per row is the area `<select>` (`count-screen.tsx:328–339`) **before** the qty input (`:360–375`). `enterKeyHint="next"` is set with no Enter handler, so the iOS form assistant's "next" (and Chrome's form navigation [K]) moves to the **next row's area select**, not the next quantity.
  - The structural per-row select is a mid-task edit (G1 "never").
  - Within an area, lines are ordered by `canonicalName` (`packages/api/src/inventory/data.ts:182`), alphabetical, as in `dashboard_inventory_ID__chef__phone-he__00/01.png`.
  - Area headers are `text-sm text-muted` and not sticky (`:311`).
  - The input is `w-20 py-2` (≈40 px).
  - No previous-count reference, and no "jump to" or scan.
  - "accept uncounted" is a 16 px checkbox (`:440`).
  - Discard uses `window.confirm` (`:394`).
- **Fix:**
  - An `onKeyDown` Enter → focus the **next uncounted** qty (`scrollIntoView({block:'center'})`), and at the end of an area jump to the next area.
  - Move the area select into an "ערוך סידור" mode, so rows have one control.
  - Sticky area header "מקרר · 7/12 · ₪1,240" (16/600 ink) plus a horizontal chip bar of areas with completion rings.
  - The previous count as a muted reference, "בפעם הקודמת 12 ק״ג", **never prefilled**.
  - Flag deviations over 50% or over 2× with a one-tap "נכון, השאר".
  - A 56 px input, or a `<QtyKeypad>` for kg.
  - The accept-uncounted control as a 48 px switch row.
  - Discard through a `<Sheet>` that names the count.
  - A 🔍 / scan in the task header (finding 21).
  - **Walk order:** v1 stores the manual reorder in `restaurants.settings` jsonb (no migration); a per-product `count_sort` column is a human PR.
- **Budget:** F14 has 0 navigation taps per line.
- **Exemplar:** R365 counts; Sysco "custom list sequencing to shelf layout"; Craftable bin numbers.
- **Area detail:** FC-03, -04, -05, -06, -09.

**mobile-field-11 · Phone approvals put the decision in the hard-to-reach corner, offer no Undo, and type the reject reason** · `/dashboard/approvals` · owner, manager · mobile · flow · M · humanPR no (bulk = a loop of the existing approve; `approvals/engine.ts` untouched) · G10, I2, C10, A5
- **Evidence:**
  - `approvals/list.tsx:245–265`: `justify-end` + `size="sm"` puts "אשר"/"דחה" at the **inline-end** (bottom-left) corner, 12 px text, about 44 px tall on a real phone, not full width.
  - `:204–230`: reject opens an inline `Textarea` (keyboard).
  - There is no Undo or optimistic exit.
  - The filter panel and saved-view controls take the first viewport. In `dashboard_approvals__owner__phone-he__00.png` the first card starts at y≈670.
  - Verbs don't name the ₪ effect.
- **Fix:**
  - **Card actions:** full-width 48 px buttons at the card bottom, with the primary on the inline-**start** (right):
    - "אשר תשלום כפי שחויב ₪575";
    - secondary "דחה ובקש זיכוי" opens a reason-chip `<Sheet>` (מחיר לא לפי חוזה / כמות לא התקבלה / פריט לא הוזמן / אחר).
  - **Undo:** optimistic row exit (150 ms), the next card slides up, and a 10 s "בטל" Snackbar.
  - **Batch:** a sticky "אשר 4 מתחת ל-₪200 · ₪296" (never `block`, R-12).
  - **Filters:** collapse into one "סינון (2) ▾" chip that opens a sheet.
  - **Swipe:** optional and RTL-aware (inline-end = approve under threshold), always paired with the buttons.
- **Budget:** F11 ≤2, F12 ≤2, F13 ≤3.
- **Exemplar:** Ramp mobile approvals inbox; BILL mobile "Approve Selected"; Superhuman/Gmail Undo; Linear mobile triage.
- **Area detail:** area-approvals BM-2.

**mobile-field-12 · The installable app is the receiver's only: scoped to one folder, Chromium-only prompt, no iOS path, no shortcuts** · PWA (manifest, `ReceiverPwa`) · all roles · mobile · functional · S–M · humanPR no · D3, G7
- **Evidence:**
  - `manifest.webmanifest`: `id` and `scope` are `/dashboard/receiving`, and `start_url` is receiving for everyone.
  - `<link rel="manifest">` is emitted only on receiving pages (`ReceiverPwa.tsx:164`).
  - The install card relies on `beforeinstallprompt` only (`:150`), which never fires on iOS (33% of IL).
  - No `shortcuts` and no `appleWebApp` metadata in the root layout.
  - Owner, manager and chef can't install the surfaces they use most (approvals, orders, count).
  - Non-installed iOS sites lose script-writable storage after 7 days without use [K], which is fatal for an IndexedDB queue.
- **Fix:**
  - The app-wide manifest of §3.11, linked from the root layout.
  - An install sheet after the user's **2nd completed task** (Android: `prompt()`; iOS: a 3-step illustrated coach sheet "שתף → הוסף למסך הבית"), with no re-ask for 14 days after a dismiss.
  - Ask for `navigator.storage.persist()` after install.
  - An "התקן את האפליקציה" row in the account sheet.
- **Exemplar:** WebKit "Web Push for Web Apps on iOS" (Home-Screen apps, 16.4+); the Next.js PWA guide.

**mobile-field-13 · No push and no app badge: act-now ₪ never reaches the lock screen** · notifications · owner, manager, receiver · mobile · functional · M · **humanPR yes** (`packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts` are immutable) · D9, A5
- **Evidence:**
  - Grep `PushManager|setAppBadge|Notification.requestPermission` in `apps/web`: none.
  - Server push is `MockPushNotifier` (`functional-gaps.md` FG-19).
  - Staff alerts are e-mail templates, and a receiver at the door doesn't read e-mail.
- **Fix:**
  - **In `apps/web` (agents can build it):**
    - a VAPID subscription UI in Settings → "התראות", per role and per event;
    - an SW `push` handler with a `tag` per supplier;
    - `notificationclick` deep-links to the **exact card** (an approvals peek, `receiving/[poId]`);
    - `navigator.setAppBadge(openT2Count)`;
    - permission requested only from a click after a meaningful action ("להודיע לך כשחשבונית ממתינה לאישורך?").
  - **Human-PR proposal (`outbox.ts`, `cron.ts`):**
    - Push only T2 events: ₪ awaiting approval (grouped per match run), a `block` ≥ ₪500 before payment, "ירקות השרון בדרך · 07:30" 10 min ahead for the receiver, and a cut-off reminder 2 h ahead when nothing has been sent.
    - Limits: at most 6 per user per day, quiet hours 23:00–06:00 plus Shabbat and holidays.
    - Body: "₪2,140 ממתין לאישורך · 4 חשבוניות".
- **Exemplar:** Ramp (push on new approvals, weekday reminders); DoorDash "Needs Action" ringing; US Foods 30-minute truck alert; WebKit Badging.

**mobile-field-14 · The glove-and-sunlight spec isn't met on field routes** · receiving, count, orders/new, approvals, recipes · all field roles · mobile · a11y/visual · M · humanPR no · G3, F4, F2, B8
- **Evidence:**
  - Coarse-pointer floor of 44 px (`globals.css:415–427`), against 48/56 for the field.
  - Steppers `w-12 h-12` = 48 (`AdjustQuantities.tsx:229, 250`); chips `min-h-11` = 44 (`:325`).
  - `Button size="sm"` has 12 px text (`Button.tsx:31`) on approvals and the order wizard.
  - Trash `p-1` ≈ 24 px next to the price input (`orders/new/wizard.tsx:490`).
  - The recipe ↑ ↓ 🗑 cluster is sm ghost buttons side by side (`recipe-editor.tsx:452–459`), so a mis-tap deletes an ingredient.
  - `text-[11px] text-subtle` metadata (`count-screen.tsx:351`, `nav.tsx:432`).
  - Glass header and bottom bar, and `bg-surface/95 backdrop-blur` count bar: content ghosts through in sunlight (visible under the nav in `dashboard__receiver__phone-he__00.png`).
  - `lineStrong #7A8B82` ≈ 3.6:1. No `prefers-contrast`.
  - Crawl: 34 targets under 24 px on approvals and 101 on catalog (phone).
- **Fix:**
  - The field-token layer (§3.6), set by `data-mode="field"` (or `pointer: coarse` on field routes), instead of the installed-only rule in `ReceiverPwa.tsx:37–42`.
  - Destructive icons never adjacent to other controls: put them behind "⋯" or behind a swipe that has a button twin.
  - A Playwright 48 px scan on field routes; a lint rule banning `text-xs`/`text-[11px]` and `glass` under `app/dashboard/(field)`.
- **Exemplar:** Material 48 dp; Apple HIG 44 pt; field-work glove guidance of 50–60 px; NTNU outdoor-illumination study (7:1 is not enough).

**mobile-field-15 · Nothing is optimistic or undoable; every tap waits a round trip** · approvals, receiving, orders, count · all · mobile · perf/states · M · humanPR no · I2, R-7, R-8, C10
- **Evidence:**
  - Grep `useOptimistic|onMutate` in `apps/web`: none.
  - Receipt submit is N sequential `markGrLine` calls and then `submitReceipt` (`wizard.tsx:494–513`). On 3G a 12-line receipt is 13 serial requests, and one failure half-persists it, with the error rendered at the page top while the user is at the footer.
  - Approve and reject wait for the server, with no Undo.
- **Fix:**
  - Reversible actions (line ✓, a qty change, approve, snooze) update in ≤100 ms through tRPC `onMutate` and roll back in place on error, with a 10 s Undo Snackbar.
  - Receipt lines persist as they change (outbox, finding 02), so the final submit is one call.
  - Supplier-outbound actions ("שלח הזמנה", the dock slip) use a deferred send with "בטל שליחה" (R-8).
  - Errors render beside their trigger: inline on the row, or in the ActionBar.
- **Exemplar:** Linear optimistic sync; Gmail "Undo Send"; Polaris toasts with actions.

**mobile-field-16 · There is no recipe lookup for the line: the chef gets an editor, not a recipe card** · `/dashboard/recipes`, `/dashboard/recipes/[id]` · chef · mobile · functional · M · humanPR no · G10, D6
- **Evidence:**
  - `dashboard_recipes__chef__phone-he__00/01.png`: the search is about 1.5 screens down, under the actual food-cost card, the target card and the KPI tiles. The list is a 4-column table at 390 px, with dish names wrapping to 3 lines.
  - `dashboard_recipes_ID__chef__phone-he__00–02.png`: the detail opens as "עריכת מתכון" with every field a live input, so a greasy scroll can edit it.
  - The only free text is "הערות": no method steps, yield, portions, allergens or plating photo.
  - Cost and Save sit below "הערות" (FC-11).
- **Fix:** a read-only **service card** as the default on phone (`recipes/[id]` → "ערוך" is a secondary in ⋯):
  - dish photo; ingredients with **net quantities scaled by a portion stepper** ("מנות: 1 · 4 · 10");
  - sub-recipes expandable inline; numbered method steps; allergen chips; hold or plating notes;
  - Wake Lock while it is open.
- **List:** cards of name + 1 line ("עלות ₪52.89 · 31.4% מעל יעד"); the search pinned at the top with recents; the KPIs move under a "עלות מזון" tab.
- **Cost:** the owner's cost view keeps a sticky bottom summary "עלות מנה ₪52.89 · 31.4% (יעד 30%)" (G10).
- **Budget:** F15 ≤2.
- **Exemplar:** meez recipe cards (scaling, sort by station); Apicbase mobile recipe view [K].
- **Area detail:** FC-10, FC-11, FC-13.

### P2

**mobile-field-17 · There is no sheet or keypad primitive; native `window.confirm` and inline expansions stand in** · count, recipes, team, settings, contracts, approvals reject, AdjustQuantities · all · mobile · states/a11y · M · humanPR no · C13, G1, C10
- **Evidence:**
  - `window.confirm` in `count-screen.tsx:394`, `recipe-editor.tsx`, `team-client.tsx`, `settings/account-section.tsx`, `settings/dsr.tsx`, `contracts-panel.tsx` and `thresholds-panel.tsx`. A native dialog means tiny targets, LTR button order on some Android builds, and no ₪ or party named.
  - `lib/components` has `ConfirmDialog` but no Sheet, keypad or Snackbar-with-action.
- **Fix:** `<Sheet>`, `<QtyKeypad>` and `<Snackbar>` as specified in §3.8, a lint rule banning `window.confirm|alert` under `app/dashboard/**`, and money or data deletions naming the ₪ and the party (R-8).
- **Exemplar:** Material 3 modal bottom sheet (scrim, drag handle); iOS sheet detents.

**mobile-field-18 · The phone header spends 68 px on an e-mail and a language select, and hides search** · all dashboard routes · all · mobile · ia/visual · S · humanPR no · D3, D4, D5
- **Evidence:**
  - `layout.tsx:140–151`: restaurant name plus a **mono e-mail** that truncates ("…ceiver@kfar-hazeitim.test"); the role label is pushed off.
  - `:166–170`: a full language `<select>` in the phone header.
  - `:152`: search is `hidden lg:flex`, so on a phone it lives inside the drawer (`nav.tsx:355`).
  - No branch context, no sync state. `glass` surface.
- **Fix:** the top bar in §3.3: branch and role on the start side; 🔍, sync and account on the end side; language in the account sheet (a compact chip for receivers with `receiverLanguages`). The palette opens as a full-height sheet with recents, Hebrew normalisation and actions ("הזמנה חדשה לירקות השרון", "ספירה").
- **Exemplar:** Linear mobile header (search + inbox); Shopify POS top bar.

**mobile-field-19 · On a first visit, the consent bar, bottom nav and field bars cover about 27–39% of the screen inside the signed-in app** · every dashboard route on a new device · all · mobile · visual · S · humanPR no · G2, B9
- **Evidence:**
  - Measured on `dashboard_receiving_ID__receiver__phone-he__00.png`: consent 107 px + nav 52 px + header 68 px.
  - Field bars stack on top through `var(--consent-h)` (`count-screen.tsx:403`, `wizard.tsx:644`).
  - Shared and newly issued staff phones are "first visits" by definition.
  - The `[data-keep-clear]` protection (`CookieConsent.tsx`) covers only the landing hero.
- **Fix:**
  - Inside `/dashboard`, render a one-line, 48 px consent strip at the **top** of the content ("עוגיות חיוניות בלבד · הגדרות"), not a bottom card.
  - In field mode, defer it until the task ends (non-essential cookies stay off, so the deferral is compliant).
  - Remember the choice per account as well as per device, so a signed-in user is asked once.
- **Exemplar:** GOV.UK inline cookie banner pattern [K].

**mobile-field-20 · No Hebrew voice input where hands are busy** · orders/capture, count, exception notes, recipe search · manager, chef, receiver · mobile · functional · M · humanPR no for v1 (a server transcription leg needs a provider credential, which is Phase-6 human intake) · G3, E10
- **Evidence:**
  - Grep `SpeechRecognition|MediaRecorder` in `apps/web`: none.
  - The capture textarea (`dashboard_orders_capture__owner__phone-he__00.png`) relies on the OS keyboard mic.
- **Fix:**
  - A `<MicButton>` (56 px, hold-to-talk) shown only when `SpeechRecognition || webkitSpeechRecognition` exists **and** a one-time he-IL probe succeeded.
  - The transcript always shows before any write, with numbers parsed into editable chips ("12 ק״ג בצל").
  - Places:
    - capture: free speech → `orders.captureFromText`;
    - count: "בצל שתים עשרה קילו" fills that line;
    - exception: the note.
  - v2 records the clip with `MediaRecorder` for server transcription (credential → human).
- **Check:** ≤1 correction in 8 of 10 Hebrew test phrases.
- **Exemplar:** Choco OrderAgent / VoiceAgent (voice into ERP orders); Chrome Web Speech he-IL.

**mobile-field-21 · No barcode scan, although `products.barcode_ean` and `supplier_catalog_items.barcode_ean` exist** · count, receiving, orders BUILD, catalog/mapping · chef, receiver, manager · mobile · functional · M · humanPR no (columns exist: `schema.ts:545, 652`) · G9, G5
- **Evidence:** grep `BarcodeDetector`: none. The data model already carries EAN.
- **Fix:** a `<ScanButton>` in the task header:
  - native `BarcodeDetector` (Chrome Android), else lazy-load the `barcode-detector` ZXing-WASM ponyfill, **self-hosted** (CSP and offline), only on scan screens;
  - formats `ean_13, ean_8, upc_a, code_128, qr_code`; ≤10 fps; torch toggle where supported;
  - a known code jumps to and focuses its line (+pack size for counted units, keypad for weighed);
  - an unknown code opens a "שייך למוצר" sheet that writes the mapping;
  - feedback: a 200 ms green flash, plus `navigator.vibrate(15)` where supported, plus an optional beep (sound toggle);
  - a QR on the printed PO opens `receiving/[poId]`.
- **Check:** scan-to-focus ≤400 ms on a Galaxy A14-class phone.
- **Exemplar:** Odoo Barcode (scan adds or increments, bottom "Validate"); R365 add-by-barcode (May 2024).

**mobile-field-22 · Long tasks don't survive interruption, and the keyboard can cover the action** · receiving/[poId], count, orders/new, recipes/[id] · all field roles · mobile · functional · S–M · humanPR no · G7, G1
- **Evidence:**
  - No `wakeLock` (grep).
  - No receiving resume: always `SCAN_INVOICE`, and a re-shoot uploads a second invoice and a second OCR charge (RCV-02).
  - No leave guard while unsynced work exists.
  - No `viewport` export: no `viewport-fit=cover` (so `env(safe-area-inset-*)` in `nav.tsx:421` and `layout.tsx:120` resolves to 0 [K]) and no `interactive-widget=resizes-content`, so fixed footers can sit under the Android keyboard.
- **Fix:**
  - Wake Lock in FieldShell.
  - Resume from `getReceipt({poId})` plus the outbox: "המשך מ-07:42 · 5/12 שורות".
  - A leave sheet on ×, back and nav while unsynced.
  - `export const viewport = { viewportFit:'cover', interactiveWidget:'resizes-content' }` in `app/layout.tsx`.
- **Check:** lock the phone for 10 minutes mid-count, unlock, and land on the same line with no data loss.
- **Exemplar:** R365 offline counts; the Screen Wake Lock API; Android offline-first resume.

**mobile-field-23 · Field routes carry decorative motion and weight; reduced motion is ignored** · receiving steps (`InvoiceScan`, `Reconciliation`, `AdjustQuantities`), PROCESSING · receiver · mobile · perf/a11y · S · humanPR no · I5, F9, I1, I4
- **Evidence:**
  - GSAP entrance staggers (0.4–0.5 s) on every step, and an **infinite** corner pulse (`InvoiceScan.tsx:75–94`), none behind `prefers-reduced-motion`. Only the marketing hero uses `gsap.matchMedia`.
  - `ProcessingPoll` cycles fake stages on a 1.4 s timer forever (`wizard.tsx:755–761`).
  - No `loading.tsx` for orders, inventory, recipes or invoices; only 5 routes have one.
- **Fix:**
  - Drop GSAP from field routes (CSS transitions ≤150 ms, transform/opacity only, none under reduced motion).
  - Real OCR stages or a determinate bar.
  - Layout-true skeletons on every field route.
  - Enforce the §3.10 budget in CI (Lighthouse at the Moto G Power / slow-4G profile).
- **Exemplar:** web.dev Core Web Vitals thresholds; Alex Russell's performance-inequality budgets.

**mobile-field-24 · Two mobile surfaces, one of them dormant: `apps/mobile` (Expo 52) still ships the dark palette and an early invoice-first receiver** · `apps/mobile/*` · all field roles · mobile · ia · S (decision) · humanPR no (owner decision) · J3
- **Evidence:**
  - `apps/mobile/app/{owner,manager,receiver}/*` is about 1,100 lines.
  - It consumes the legacy dark `colors` (`packages/ui-tokens/src/index.ts`: "still consumed by apps/mobile").
  - The last functional change was m9.1, "receiver wizard — guided invoice-first flow".
  - It shares tRPC with the web, but has none of the PWA queue, languages or dock slip.
- **Why it matters:** a second, stale field product splits effort and contradicts "one product on every surface" (J3).
- **Fix:** an owner decision, written into `STATE.md`. Recommended: **PWA-first now**.
  - Everything in this lens is feasible on the web in 2026, including iOS push and badge for Home-Screen apps.
  - Freeze `apps/mobile` out of CI and the docs.
  - Revisit a native or Capacitor shell only if pilot RUM shows camera, scan or push reliability gaps on iOS.
- **Exemplar:** R365 Red App vs web; Toast Go (dedicated handheld).

**mobile-field-25 · There is no shared-device identity on the back-door phone or kitchen tablet** · auth, account sheet · receiver, chef · mobile · trust/functional · L · **humanPR yes** (a PIN hash and a device registration need a schema change; auth and RLS-adjacent work needs `tenant-security-warden` review) · G7
- **Evidence:**
  - The only way to change user is a full sign-out (which wipes the queue, finding 01) followed by e-mail + password or a magic link.
  - Queued items are scoped by `userId`, but nothing switches users cheaply.
- **Fix:**
  - A restaurant setting "מסוף קבלה / טאבלט מטבח" turns on kiosk mode.
  - A 4–6-digit personal PIN switch (rate-limited), which mints a real per-user session (tenant isolation intact).
  - Auto-lock after 5 min idle ("זה עדיין אתה?").
  - The queue is kept and attributed.
  - Field tokens and sound are forced on.
- **Budget:** F17 = 2 taps + 4 digits.
- **Exemplar:** Toast and Square employee PIN switch; Toast's "one device per employee" offline practice.

---

## 5. Big moves (ranked by ₪ value ÷ risk)

| # | Move | What ships | Effort | Device | Exemplar |
|---|---|---|---|---|---|
| BM-1 | **Field Shell + role Today homes** | §3 shell: top bar, role bottom bar, FieldShell + ActionBar, field tokens, Sheet, Snackbar, viewport meta; Today home for receiver, chef and manager; ViewToolbar behind a sheet on phone | M | mobile | Shopify POS smart grid; Apicbase tiles; M3 nav bar |
| BM-2 | **Dock & walk-in outbox** | `lib/pwa/outbox.ts` for GR lines, receipts, counts and order drafts; sync chip and Outbox sheet; precache today's POs; resume; wake lock; safe sign-out; later the PIN kiosk (human PR) | L | mobile | Android offline-first; Toast Go; R365; WISK |
| BM-3 | **Delivery Check + Pro Document Camera** | Count-first receiving with ✓/✗, an exception sheet (reason, stepper or keypad, 📷), background OCR reconciliation, ad-hoc no-PO receiving, a multi-page `<DocCamera>` with a quality gate, `share_target` files, a driver-acknowledged dock slip via `navigator.share` | L | mobile | Choco Delivery Check; Galley; xtraCHEF Add Page; MarginEdge |
| BM-4 | **Nine-tap ordering** | Cut-off board, guide BUILD with steppers, "order again", a sticky cart, "שכחת משהו?", chef draft → manager send, WhatsApp share and voice capture; par and MOV via a human PR | L | mobile | R365 Autofill to Par; Choco; Ordermentum; US Foods MOXē |
| BM-5 | **Notification spine** | App-wide PWA plus an iOS coach sheet, a VAPID push subscription UI, SW deep links to peek cards, app badge, 2-tap approve with Undo; routing, rate limits and quiet hours as a human-PR proposal to `outbox.ts`/`cron.ts` | M (+ human PR) | mobile | WebKit Web Push and Badging; Ramp; DoorDash Needs Action |
| BM-6 | **Kitchen service mode** | Recipe service cards with scaling and method; the count walk (next-uncounted, sticky areas, last count, keypad); `<ScanButton>`; `<MicButton>` | M | mobile | meez; R365 counts; Odoo Barcode; Choco OrderAgent |

**Order of work:**
1. Finding 01 (S, the highest ₪ risk per line of code).
2. BM-1 shell + bottom bar (S–M).
3. BM-2.
4. BM-3.
5. BM-4.
6. BM-5 (human PR in parallel).
7. BM-6.

**Measure first:** RUM `web-vitals` per route and role; flow timers (PO open → "סיים קבלה", bar tap → "שלח"); the §2 tap counters; outbox health (queued count, p95 age, failures).

---

## 6. Platform capability audit (grep of `apps/web/app` + `apps/web/lib`, excluding tests)

| Capability | Present? | Needed for |
|---|---|---|
| `capture="environment"` / `multiple` on the invoice input | no / no (`multiple` only in LeakCheckForm) | F1, F5 |
| `getUserMedia` viewfinder, torch | no | BM-3 v2 |
| `BarcodeDetector` / ZXing | no (`barcode_ean` columns exist) | F14, ordering |
| `SpeechRecognition` / `MediaRecorder` | no | F9, F14 |
| `PushManager`, `setAppBadge`, `Notification` | no | F11, F12 |
| `navigator.share` (files) | no (the dock slip uses `wa.me`) | dock slip |
| `wakeLock`, `storage.persist` | no / no | F14, F6 |
| `navigator.vibrate` (Android only) | no | scan and saved feedback |
| `useOptimistic` / `onMutate` | no | every decision |
| Bottom sheet / keypad primitive | no; `window.confirm` in 8 files | exceptions, reject, discard |
| `data-mode="field"` / `prefers-contrast` | no / no | gloves and sun |
| `viewport-fit=cover`, `interactive-widget` | no | safe areas, keyboard |

---

## 7. Rubric scorecard (field archetype, this lens)

| Criterion | Score | Note |
|---|---|---|
| D1 role lands on its job | **Fail** | All roles get the owner room (06) |
| D3 mobile bottom bar | **Fail** | Mechanical first four, 11 px truncated, 52 px, glass (07) |
| G1 field mode | **Fail** | Nav, consent and header inside tasks; `window.confirm`; per-row structural select (05, 10, 17) |
| G2 thumb-zone primary | **Fail** | Scan CTA below the fold; sm in-flow buttons (05) |
| G3 gloves/sun | Partial | 44 px floor and 16 px inputs good; 48/56, contrast and glass fail (14) |
| G4 exception-first receiving | **Fail** | Invoice-first; PO-only needs one tap per line (03) |
| G5 preset → stepper → keypad | Partial | Chips and stepper exist; ±1 on kg; `type=number` (03, 10) |
| G6 camera capture | **Fail** | Single page, no capture intent (04) |
| G7 offline-first | **Fail** | Photos only; sign-out wipes (01, 02) |
| G8 evidence at dispute | Partial | Dock slip exists; no per-line photo or driver acknowledgement (04) |
| G9 count/order follow the walk | **Fail** | Alphabetical, Next misroutes, search-first ordering (08, 10) |
| G10 phone desk | Partial | Cards exist; corner buttons, no Undo, no sticky summary (11, 16) |
| F4 target size | Partial | 44 px floor; 24 px trash; sm buttons (14) |
| F9 motion | **Fail** | Infinite GSAP pulse ignores reduced motion (23) |
| I2 optimistic + Undo | **Fail** | None (15) |
| I4 skeletons | Partial | 5 of ~40 routes (23) |

---

## 8. Governance (AGENTS.md)

- **Agent-buildable:**
  - shell, nav, sheets, tokens (`web-feature-engineer` + `rtl-design-steward`);
  - outbox and SW (`web-feature-engineer` + `test-sentinel`);
  - DocCamera and scan (`ocr-procurement-engineer` for capture into OCR, `web-feature-engineer` for UI);
  - recipe service card;
  - chef draft request: a new procedure plus an **add-only** COVERAGE entry in `cross-tenant.attack.test.ts`, with `tenant-security-warden` review.
- **Human PR:**
  - push routing, rate limits, quiet hours and cut-off reminders: `packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts`;
  - par, MOV, per-product count sort, kiosk PIN: `packages/db/src/schema.ts` + a new migration, and a new tenant table goes on the RLS list `0002_core_tenant_rls.sql`;
  - any CI gate step for the tap-budget or field-target Playwright checks: `.github/workflows/*`.
- **Never touched by these recommendations:** `formatIls()` (consume only, via `<Money>`), `TOTAL_TOLERANCE_ILS` and `tolerances.ts` (the keypad's 10% variance prompt is a **UI** threshold and never feeds the engine), `approvals/engine.ts` (bulk approve = a loop of the existing approve; `block` excluded).
