# Lens review: states and perceived performance (`perf-states`)

**Date:** 2026-10-25 · **Lens:** cross-cutting, every route · **Code:** `wt/` at `8fef118c` (main), production build on `:3320`, demo tenant "כפר הזיתים", DEMO_TODAY 2026-10-25
**Who:** the receiver at the back door (phone, cold cache, weak signal), the chef in the walk-in, the floor manager approving between covers, and the owner and bookkeeper at a desk.
**Inputs:**
- `research/RUBRIC.md`: C8, C9, C10, G6, G7, I1–I7, J1, and the R-6, R-7 and R-8 resolutions.
- `research/pwa-field.md` (G9–G11, P7–P9, P17, P18), `ordering-mobile.md` (P16, PT12), `erp-modern.md` (P21), `systems.md`, `ainative.md`.
- All 225 crawl captures and `crawl-results.json`.
- Six live probes I wrote for this lens (scripts in `review/scripts/`, outputs in `review/crops-perf/`):
  - `perf-probe.cjs` (A–F)
  - `cls-probe.cjs`
  - `nav-probe.cjs`
  - `states-probe.cjs`
  - `spin-probe.cjs`
  - `view-probe.cjs`

  Every probe **intercepted and aborted all tRPC POSTs and server actions in the browser**, so no tenant data was written.

**Related reviews (cross-referenced, not repeated here):**
- `mobile-field-02`: the field outbox.
- `mobile-field-15`: optimistic UI and Undo, in field terms.
- `mobile-field-23`: motion on field routes.
- `a11y-09`: toast timing and announcements.
- `design-system-20`: feedback primitives.
- `RCV-22`: OCR stages.
- `approvals-*` and `catalog-30`: per-area loading.

This lens adds:
- measured evidence;
- **the states contract** (§2), which the area reviews can share;
- the **Next 15 soft-navigation constraint** that any "add a `loading.tsx`" fix has to respect (§2.2).

> **Lab caveats:**
> - Server timings come from localhost with a tiny database, so production adds a database round trip per sequential stage.
> - The worker banner is a lab artefact. It is also the LCP element on most phone routes in the lab, so I don't quote LCP values as product numbers.
> - The consent bar shows because every capture is a first visit.

---

## 0. Verdict

**Scores (0–10, against Linear, Superhuman, Ramp and Toast/Square field apps):** mobile **3.5** · desktop **4.5** · functionality **4.0**

### What already works (keep it)
- **Count autosave is local-first.** `localStorage` mirror, debounced save, flush on `visibilitychange`, and a "נשמר / שומר / שגיאה" indicator (`inventory/count/count-screen.tsx:99–203`, `:412`). This is the best state handling in the app.
- **The offline photo queue is idempotent** (`clientUploadId`). It has a correct offline banner (probe D3: "אין חיבור לאינטרנט · אפשר להמשיך לצלם…") and a static multi-language `offline.html` inside the receiving scope.
- **Double-tap is guarded.** `useSingleFlight` and the button `loading` state hold it to one request. Probe F: a double-click on "אשר" sent **1** request, and two taps 120 ms apart sent **1**.
- **OCR polling is honest about time.** It backs off (1 s, then 2 s, then 4 s), keeps going through dropped requests for 120 s, and offers a refresh (`receiving/[poId]/_poll.ts`).
- **The building blocks exist:** `friendlyError()` maps tRPC codes to Hebrew; there is a top `RouteProgress` bar; there is a worker-down banner; `initialData` + `placeholderData` keep filter changes on catalog, orders and products from flashing.
- **The team wrote a production regression script** for the soft-nav stall (`apps/web/scripts/check-soft-nav.mjs`).

### Why it is not world-class yet
1. **Waiting is mostly invisible.**
   - 33 of 43 dashboard pages have no loading boundary, and there is **no `<Suspense>` anywhere in app code**.
   - Server pages run 5–7 sequential await stages: layout plus page.
   - Nine routes then wait on a client fetch after SSR.
   - On the measured mobile profile, a tap on a route with no boundary leaves the old page on screen for 0.6–1.5 s, with only a 2 px bar.
   - On a cold cache the **bottom nav appears 2.2 s after the content** (client portal).
2. **Decisions are not instant and not undoable.**
   - Approve waits for 2 round trips, then reloads page 1. That collapses any loaded "טען עוד" pages.
   - A failed approve renders its error **821 px above the viewport** (probe E1).
   - There is no Undo anywhere in the product.
3. **Dead ends are silent.**
   - Offline, "אשר" spins forever and sends nothing (probe D1).
   - Any dashboard navigation offline shows Chrome's "No internet" page (D2).
   - Any server error or bad id drops the whole app shell (E2).
   - An expired session reads as "אין לכם הרשאה".
4. **Some waits are dishonest.**
   - The OCR screen cycles fake stages every 1.4 s.
   - The upload bar is pinned at 30%.
   - The AI answer is a static "חושב…".
   - The bookkeeper's **"N invoices were left out of the accounting file"** warning is a toast that disappears after 7 s.
5. **Layout jumps under the thumb.** CLS on the receiver's two main screens is **0.12**, caused by a sync banner that flashes on every mount, and **0.19 / 0.16** on the chef's inventory and recipes pages.

---

## 1. Measurements

### 1.1 Server time to full HTML (owner, desktop, localhost, median of 3)
Nothing streams, so time to first byte ≈ the full render.

| Route | Document ms | Note |
|---|---|---|
| `/dashboard/suppliers/ledger` | **394** | slowest |
| `/dashboard` | 189 | 7 page stages + 5 layout stages |
| `/dashboard/chain` | 180 | |
| `/dashboard/leaks` | 127 | |
| `/dashboard/catalog` | 125 | |
| others | 62–104 | |

On localhost every database call costs about 1 ms. In production each **sequential** stage adds a database round trip (Vercel → Supabase) or a cold-start penalty. The structure matters more than these numbers:
- **Layout:** `auth()` → `myMemberships()` → `Promise.all(7)` → `ask.status()` → `getWave1Access()` → `chain.branches()`, then `<WorkerStatusBanner>` (un-suspended, deadline **1,500 ms**) (`app/dashboard/layout.tsx:30, 36, 44, 61, 81, 94, 176`).
- **Home:** `searchParams` → `createServerCaller` → `Promise.all(auth, memberships)` → `enabledFeatures` → `vatAtRisk` → `Promise.all(getT×4)` → `Promise.all(8 queries)` → `getT` → `returnedThisMonth` → `owner.leaks` (`app/dashboard/page.tsx:53–112`).
- **Receiving wizard:** `auth` → `Promise.all(4)` → **`Promise.race(ensureEnglish, 4,000 ms)`** or **`Promise.race(localNames, 4,000 ms)`** → `priceContext` → `getPo` (`receiving/[poId]/page.tsx:22–65`). For an English or Arabic/Russian/Thai/Tigrinya receiver, the first paint can wait **4 s or more**.

### 1.2 Phone, cold vs warm cache (4× CPU, 150 ms RTT, 1.6 Mbps)
From `nav-probe.cjs`:

| Route (role) | FCP (cold) | Bottom nav appears (cold) | JS transferred (cold) | FCP (warm) | Nav (warm) |
|---|---|---|---|---|---|
| `/dashboard/receiving` (receiver) | 884 ms | **3,084 ms** | 209 KB | 580 | 849 |
| `/dashboard` (owner) | 1,240 ms | **3,531 ms** | 225 KB | 720 | 1,252 |
| `/dashboard/approvals` (owner) | 944 ms | **3,368 ms** | 217 KB | 640 | 924 |

### 1.3 Layout shift (phone, 4× CPU)
From `cls-probe.cjs`:

| Route (role) | CLS | Source |
|---|---|---|
| `/dashboard/inventory` (chef) | **0.190** | `period-card` (client `useQuery`) pops in at about 1.0 s and pushes "ספירות קודמות" |
| `/dashboard/recipes` (chef) | **0.155** | the target-food-cost block appears at about 0.97 s and pushes the tabs down 265 px |
| `/dashboard/receiving` (receiver) | **0.122** | a 70 px PWA "מסנכרן" banner appears at 887 ms and is gone at 948 ms; every card shifts twice |
| `/dashboard/receiving/[poId]` (receiver) | **0.116** | the same banner flash, plus the GSAP viewfinder corners |
| `/dashboard/products` | 0.019 | |
| `/dashboard`, `/orders`, `/catalog` | 0 | |

### 1.4 What the user sees after tapping a link (phone, throttled)
From `perf-probe C`; frames in `crops-perf/C_*`:

| Tap | Has `loading.tsx`? | At 150 ms | At 600 ms | At 1,500 ms |
|---|---|---|---|---|
| home → approvals | yes | old page + bar | **skeleton** (`C_approvals_600ms.png`) | content |
| approvals → leaks | no (removed) | old page + bar | **old page + bar** (`C_leaks_600ms.png`) | content |
| leaks → receiving | yes | old page + bar | skeleton | content |
| receiving → orders | no | old page | old page | content |

A programmatic `router.push` (search results, post-mutation redirects without `startRouteProgress`) shows **no bar at all**.

### 1.5 First paint vs settled, per route (desktop, 4× CPU)
From `states-probe.cjs` and `spin-probe.cjs`. These routes render a **spinner in the server HTML** and then fetch on the client:

| Route | Client queries after hydration | Settles at |
|---|---|---|
| `/dashboard/catalog` | `catalog.items` | **3,092 ms** |
| `/dashboard/orders` | `orders.list` | 2,332 ms |
| `/dashboard/settings` ("טוען…" referral) | `growth.myReferral`, `growth.referralStats` | 2,162 ms |
| `/dashboard/recipes` | 4: `inventory.period`, `recipes.list`, `posVsTheory`, `priceAlerts` | 1,618 ms |
| `/dashboard/integrations` | 3 | 1,126 ms |
| `/dashboard/inventory/count` | `inventory.current` (spinner-only page) | 1,051 ms |
| `/dashboard/orders/new` | `suppliers.list`, `documentSettings` | 898 ms |
| `/dashboard/inventory` | 3 (spinners only) | 830 ms |

Pages that already receive `initialData` **still refetch on mount**, because the `QueryClient` default `staleTime` is 0 (`lib/trpc/client.tsx:13`):
- `suppliers.list`
- `suppliers.get`
- `catalog.items`
- `orders.list`
- `mapping.unmapped`
- `recipes.list`

### 1.6 Failure and offline behaviour
From `perf-probe D/E/F`:

| Probe | Result |
|---|---|
| D1: approve while offline (phone) | **0 requests sent.** The button spins indefinitely (React Query pauses the mutation), with no message and no offline indicator (`D1_approve_offline_4s.png`). |
| D2: navigate to `/dashboard/leaks` while offline | Chrome's "No internet / ERR_INTERNET_DISCONNECTED" page. The service worker covers `/dashboard/receiving` only. |
| D3: receiver offline | The offline banner is correct. Opening a PO wizard offline shows the static `offline.html`, so a PO that wasn't already open can't be received. |
| E1: approve fails (500), 3rd card | The button is at y=1884 and the viewport is 1558–2402. The alert renders at **y=737**, off-screen (`E1_approve_fail_viewport.png`). |
| E2: bad ids and unknown path, 5 URLs | All five render the root 404 card **with no header and no bottom nav**. `receiving/<bad>` and `suppliers/<bad>` return **HTTP 200**. |
| F: double-click "אשר" | 1 request (good). |
| View change: period select on `/dashboard` and `/leaks` (400 ms RTT) | The select **snaps back to "החודש"** for about 0.4–0.9 s, with no bar and no `aria-busy`; then it jumps to "חודש קודם" and the ₪ changes. |

### 1.7 Weight
From the `next build` table:
- `/dashboard/receiving/[poId]` is the **heaviest route in the app: 252 kB first-load JS**. That is +149 kB over the 103 kB shared chunk, and includes GSAP via the showcase steps.
- It is also the route used at the door on the weakest network.

---

## 2. The states contract (the deliverable)

One contract for every surface. Each rule names the component or file that owns it.

### 2.1 State taxonomy (every data region declares which of these it can be in)

| State | What it means | Shows | Never |
|---|---|---|---|
| `loading-first` | No data yet | A layout-true skeleton with static text real, after 300 ms (React's reveal throttle). Once shown, keep it at least 500 ms. | A centred spinner with "טוען…" for a page or section |
| `refreshing` | Data shown, newer data coming | The old data dimmed to `opacity-.6` after 150 ms, `aria-busy="true"` on the region, and a 2 px indeterminate line under the toolbar | Swapping back to a skeleton, or snapping the control back |
| `pending-write` | The user acted and the server hasn't confirmed | The optimistic result. On field routes, a "נשמר במכשיר" chip | A frozen spinner over 2 s with no text |
| `empty:first-use` | Nothing has ever existed | An action title plus **one** primary CTA | Grey art with no action |
| `empty:no-results` | Filters hide everything | What to change, plus **"נקה סינון"**, plus the hidden count | A ✓ "everything handled" icon |
| `empty:inbox-zero` | All work is done | T3 calm: "הכל מטופל ✓" + what was auto-handled (count, ₪) + the next expected event | A dashed grey void |
| `partial` | A list is paginated, or one section failed | The totals say they are partial ("50 מתוך 57") and the failed section shows inline retry | Sums over the loaded page shown as totals |
| `error:section` | One query failed | An in-place card: cause + "נסה שוב". The rest of the page renders. | The whole page replaced |
| `error:page` | The route failed | **Inside the app shell**: cause + "נסה שוב" + the parent page + error code | Losing the header and bottom nav |
| `not-found` | The entity doesn't exist or isn't visible | Inside the shell: "ההזמנה לא נמצאה" + a link to the parent list | "חזרה לסקירה" for a supplier or anonymous visitor |
| `offline` | No network | T4 neutral chip. Field writes queue; money decisions are disabled with a reason. | A spinner, red, or the browser dino page |
| `session-expired` | 401 | A re-auth sheet that **keeps the page state**: "ההתחברות פגה — התחברו שוב, שום דבר לא נמחק" | "אין לכם הרשאה" |
| `permission` | Role can't see it (D7) | Who can, plus "בקשו גישה מהבעלים" | A 404 |

### 2.2 Loading architecture (Next 15.5, respecting the soft-nav stall)

**Constraint.** Commit `0baf09e5` removed `app/dashboard/loading.tsx` and `leaks/loading.tsx`. A **same-route, search-param-only** navigation re-rendered under the already-revealed route-level boundary and stalled forever in production builds. `pay-run` still works around the same stall with a **full document reload** for its month toggle (`approvals/pay-run/page.tsx:136–140`, plain `<a href>`).

**Rules:**
1. **`loading.tsx` is allowed only on segments with no same-route param navigation.**
   - Add one to: `inbox`, `leaks/proof`, `leaks/claims`, `recovery`, `reports/*`, `ask`, `catalog`, `catalog/mapping`, `catalog/import`, `contracts/import`, `products`, `products/[productId]`, `orders`, `orders/[poId]`, `orders/new`, `orders/capture`, `invoices/[invoiceId]`, `inventory`, `inventory/[countId]`, `inventory/count`, `recipes`, `recipes/[recipeId]`, `recipes/new`, `integrations`, `team`, `branches`.
   - That makes **26 new files**. With them, Next prefetches the shell for every viewport and hover link, so a tap shows the destination in under 100 ms.
2. **Segments with `ViewToolbar` or tabs get in-page streaming instead:**
   - The segments: `/dashboard`, `leaks`, `leaks/breakdown`, `leaks/report`, `chain`, `approvals`, `approvals/pay-run`, `suppliers/[id]` (`?tab=`).
   - Wrap each data section in `<Suspense key={viewKey} fallback={<Skeleton.X/>}>`.
   - The **key changes with the view**, so the boundary remounts. The commit found that remounting boundaries (cross-route) never stalled.
   - Move each section's query into its own async server component.
   - Replace `approvals/loading.tsx` with this pattern, and change pay-run's month `<a>` back to `<Link>`.
3. **Extend `check-soft-nav.mjs`** with:
   - approvals filters;
   - the pay-run month;
   - supplier tabs;
   - one cross-route tap per new `loading.tsx`.

   Run it on every PR that touches a boundary. Wiring it into CI is a **human PR** (`.github/workflows` is immutable).
4. **The T1 ₪ streams first.** On `/dashboard` the hero section awaits only `owner.leakHero()`. KPIs, trend, activity, VAT, recipes and price alerts are separate `<Suspense>` siblings.
5. **The layout does one wave.**
   - `auth()` and `myMemberships()` run in parallel.
   - The `ask`, `wave1` and `chain` checks join the existing `Promise.all`.
   - Wrap `<WorkerStatusBanner/>` in `<Suspense fallback={null}>` so the heartbeat read (up to 1.5 s) never blocks a byte.
   - Target: **at most 1 sequential DB stage** before the shell, and 1 more before the T1 ₪.
6. **Client queries:**
   - Configure `new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: (n, e) => !is4xx(e) && n < 2 }, mutations: { networkMode: 'always' } } })`.
   - Server-render the first view of every list (`initialData`, or `prefetch` + `HydrationBoundary`).
   - No page may ship a spinner in its server HTML.
7. **Prefetch where the next tap is predictable:**
   - the bottom-bar targets on idle (`router.prefetch`);
   - the next card's invoice in a queue;
   - today's POs on the receiving list (pairs with the outbox precache, `mobile-field-02`).

**Skeleton primitives** (`lib/components/Skeleton.tsx`):
- **Variants:** `hero` (240 px desk, 280 px phone), `kpiRow`, `row`, `card`, `table`, `form`, `wizardStep`.
- **Content:** static titles render as real text; only values are placeholders.
- **Accessibility:** `aria-busy` on the region, and `motion-reduce:animate-none` (today `animate-pulse` ignores reduced motion).
- **Layout:** each `loading.tsx` copies its page grid within 8 px.

### 2.3 Wait ladder, per flow (I3)

| Flow | Under 1 s | 1–3 s | 3–10 s | Over 10 s |
|---|---|---|---|---|
| Cross-route tap | Prefetched shell | Skeleton | Skeleton + bar | Error card with "נסה שוב" |
| View change (period, filter, tab) | Control commits at once (`useOptimistic`); data dims after 150 ms | Dimmed + 2 px line | Same, plus "מעדכן…" | Error inline under the toolbar |
| Approve, reject, map, accept | Row exits in 150 ms; Undo 10 s | (server behind) | (server behind) | Failure: the row returns to its index with an inline error |
| Invoice photo upload | Determinate % from XHR `upload.onprogress` | "מעלה… 63%" | Same | At 10 s, offer "המשך לפי ההזמנה — החשבונית תעלה ברקע" |
| OCR | Real stage from invoice status | "קורא את החשבונית · שלב 1 מתוך 3" | Stage text changes at least every 2 s | **At 10 s** (today 30 s) "המשך לקלוט לפי ההזמנה"; notify when ready |
| AI "שאלו את RestoMatch" | Streamed tokens | Stage text "מחפש בחשבוניות… מחשב…" | Streaming + "עצור" | Partial answer kept |
| Accounting export, CSV, PDF | Spinner in the button | Same | "מכין קובץ · 1,240 מתוך 3,603 שורות" | Background job + "הקובץ מוכן" in Needs-you |
| Catalog or contracts import commit | Spinner in the button | Same | Determinate rows | Background + notification |
| Count line, receipt line | "נשמר במכשיר" within 300 ms | "נשלח ✓" on ack | Chip "↑ 3 ממתינים" | Outbox sheet (`mobile-field-02`) |

### 2.4 Mutation feedback contract (C9, C10, I2, I7, R-6, R-7, R-8)

| Action | Model | Success feedback | Failure feedback |
|---|---|---|---|
| Approve, reject, escalate (approvals); approve or reject document (inbox); map SKU; accept a price alert | **Optimistic** (`onMutate` → `utils.x.setData`). Row exits in 150 ms, tiles recount, focus moves to the next row. | Toast "אושר · ₪100.00 · בטל" (10 s, pause on hover or focus) | Row re-inserts **at its index** with an inline error and "נסה שוב". Never a card at the list top. |
| Recovery status change (written_off, disputed…) | A menu, not `<select onChange>`. `written_off` gets a ConfirmDialog that names the ₪ and the supplier. Other changes are optimistic + Undo. | Row badge changes; Undo 10 s | Inline on the row |
| Send order or claim letter to a supplier (outbound) | Preview, then **deferred send**: "נשלח לספק בעוד 10 שניות · בטל שליחה" | Status chip "נשלח ✓" | Inline + "שלח שוב" |
| Delete (contract, recipe, product, team member), discard count | ConfirmDialog with ₪ or name ("מחק את החוזה של תנובה — 14 מוצרים"), never `window.confirm` (8 call sites) | Toast + Undo where the server can soft-delete | Inline |
| Field writes (line ✓, qty, count entry) | Local-first outbox | "נשמר במכשיר" → "נשלח ✓" | Chip "⚠ 1 נכשל — נסה שוב"; data is never dropped |
| Exports and imports with warnings | Server returns the warnings | **Persistent result panel** listing what was skipped, with a link to the items | Persistent; **never a toast** |

**Message type by stakes** (C9):
- **Toast:** only to confirm a result that isn't already visible.
- **Inline:** errors.
- **Banner:** page-level (one).
- **Dialog:** blocking decisions.
- **Placement:** the toast container sits **above the bottom bar and the consent bar**: `bottom: calc(var(--bottom-nav-h) + var(--consent-h) + env(safe-area-inset-bottom) + 8px)`, on the bottom-start side.
- Timing and announcement follow `a11y-09` and `design-system-20`.

### 2.5 Connectivity and session layer (new, `lib/net/`)
- **`useOnline()`:** a `useSyncExternalStore` over `online` and `offline`, confirmed by a `HEAD /api/healthz` with a 3 s timeout, because `navigator.onLine` lies on captive Wi-Fi.
- **Header chip** (T4 neutral, never red):
  - desk: "אין חיבור · נעדכן כשהרשת תחזור";
  - field: "אין חיבור · הנתונים נשמרים במכשיר" with the outbox count.
- **Money decisions offline:** the buttons render as disabled with a reason ("אין חיבור — האישור לא נשלח"). They never pause silently.
- **Mutations:** `networkMode: 'always'`, so a mutation fails fast with `errors.network`, shown inline.
- **Session expiry:** a tRPC link plus a `MutationCache` / `QueryCache` `onError` catch `UNAUTHORIZED` and open a re-auth sheet:
  - password or magic link, in place;
  - in-memory wizard state is kept;
  - the failed call is retried after re-auth.

  Split `friendlyError` so that `UNAUTHORIZED` ≠ `FORBIDDEN` (`lib/components/errors.ts:30–32`).
- **Service worker** (one app-wide scope `/dashboard`, see `mobile-field` §3.11):
  - an offline fallback per route family;
  - "הדף לא נשמר במכשיר — חזרו לרשימת המשלוחים" for field routes, with cached POs from the outbox precache;
  - never the browser error page.

### 2.6 Error-boundary map

| File (new) | Renders inside | Content |
|---|---|---|
| `app/dashboard/error.tsx` | The dashboard layout (header + bottom nav kept) | "לא הצלחנו לטעון את הדף" + the friendly cause + "נסה שוב" (`startTransition(() => { router.refresh(); reset(); })`) + parent link + digest + "דווחו לנו" |
| `app/dashboard/not-found.tsx` + per-entity `not-found.tsx` (`orders/[poId]`, `invoices/[invoiceId]`, `receiving/[poId]`, `suppliers/[id]`, `products/[productId]`, `recipes/[recipeId]`, `inventory/[countId]`) | The dashboard layout | "ההזמנה לא נמצאה — ייתכן שנמחקה או שייכת לסניף אחר" + "לכל ההזמנות" + the branch switcher when relevant |
| `<SectionBoundary>` (client class component, `lib/components`) | Around every optional section | Inline card: cause + "נסה שוב" (`router.refresh`). The home renders without that card. |
| `app/s/[token]/not-found.tsx` | Supplier portal shell | "הקישור לא תקף או שכבר נענה. בקשו מהמסעדה ששלחה אותו קישור חדש." **No app CTA.** |
| Public `not-found` (marketing group) | Marketing shell | "חזרה לאתר" + "בדיקת דליפה" / "כניסה" |

For the home:
- the hero failing → `error:page`;
- VAT, price alerts, recipes card, activity or leaks grid failing → `error:section` (today one failed query in the `Promise.all` of 8 kills the page).

### 2.7 Empty-state catalogue

`EmptyState` gains `kind: 'first-use' | 'no-results' | 'inbox-zero' | 'error' | 'permission'`. Today there are 38 call sites and 9 with an action.

| Site | Today | Kind and copy (he) | CTA |
|---|---|---|---|
| `approvals` (no items) | "אין חריגות בתור כרגע" (grey) | inbox-zero, T3: "הכל מטופל ✓" · "החודש נעצרו 37 חריגות · ₪1,240 לפני תשלום" · "החשבונית הבאה צפויה: תנובה, 07:30" | "לבלש הדליפות" (secondary) |
| `approvals` (filtered) | The same ✓ title + "התצוגה מסוננת…" | no-results: "אין חריגות שמתאימות לסינון · 12 מוסתרות" | **"נקה סינון"** |
| `inbox` | "עדיין לא התקבלו חשבוניות", no CTA | first-use: "חברו מייל או וואטסאפ — חשבוניות ייכנסו לבד" | "הגדרת כתובת קליטה" (anchor `#channels`) |
| `catalog/mapping` | "הכול ממופה", no CTA | inbox-zero: "כל המק״טים ממופים ✓ · 28 מופו אוטומטית השבוע" | "לקטלוג" |
| `receiving` | "אין משלוחים שמתוכננים להיום", no CTA | first-use/day-empty: "אין משלוחים מתוכננים להיום" | **"קבלת סחורה בלי הזמנה"** (`RCV-04`) + "המשלוחים של מחר" |
| `orders` (list) | (from code) | first-use: "צרו הזמנה ראשונה — נשווה אותה לחשבונית אוטומטית" | "הזמנה חדשה" |
| `recipes` | 4 sites | first-use: "הוסיפו מנה כדי לראות עלות מנה בש״ח" | "מנה חדשה" |
| `leaks/claims` | 1 site | inbox-zero, T3: "אין דרישות פתוחות · ₪X הוחזרו החודש" | "למעקב ₪ חוזר" |
| Integration disconnected | none | error: "החיבור ל-MarketMan נותק" | "חבר מחדש" |
| Role cannot see a route | 404 today | permission: "הדף הזה זמין לבעלים ולהנהלת חשבונות" | "בקשו גישה" |

**Layout:** start-aligned inside pages; centred only inside small tiles.

### 2.8 Budgets and gates

| Surface | LCP p75 | INP | CLS | Route JS (gz, on top of shared) | Server stages before shell |
|---|---|---|---|---|---|
| Field: `receiving*`, `inventory/count`, `orders/new`, `orders/capture` | ≤2.5 s (aim 2.0) | ≤200 ms | **≤0.05** | ≤170 KB, no GSAP | 1 |
| Queues: `approvals*`, `inbox`, `mapping`, `claims` | ≤2.5 s | ≤200 ms (decision ≤100 ms visual) | ≤0.05 | — | 1 |
| Overview and report | ≤2.5 s; T1 ₪ is the LCP | ≤200 ms | ≤0.1 | — | 1 before the shell, 1 before the hero |

Reference device and network for the budgets: Moto G Power class on slow 4G.

**Measurement:**
- `useReportWebVitals` in `app/layout.tsx`, tagged with route, role and `pointer: coarse`, sent to Vercel Speed Insights (no schema change).
- A Playwright gate (owned by `test-sentinel`):
  - CLS on the 8 field and queue routes under 4× CPU;
  - `check-soft-nav.mjs`;
  - JS size per route from the `next build` output.

  CI wiring is a **human PR**.

---

## 3. Per-route gap matrix

**Legend:**
- **LB** = loading boundary (✓ has · ✗ none · ✗s = none, safe to add · ✗v = none, needs keyed Suspense).
- **CF** = client fetch after SSR.
- **Empty** = empty-state quality.
- **Feedback** = mutation feedback.

| Route | LB | CF / first paint | Measured | Empty | Error | Offline | Feedback | Top gap |
|---|---|---|---|---|---|---|---|---|
| `/dashboard` | ✗v | – | 189 ms SSR (7 + 5 stages) | activity only | 1 failed query kills page | dino | – | Hero waits for 9 queries; period select reverts |
| `/approvals` | ✓ (generic, 144 vs 310 px cards) | refetch per decision | – | 1 component for 3 states | card at list top, off-screen | stuck spinner | server-wait + reload page 1 | perf-states-07 |
| `/approvals/pay-run` | inherits approvals | – | full reload on month | 2 sites | root | dino | – | `<a>` reload workaround |
| `/inbox` | ✗s | – | – | first-use, no CTA | raw `{message}` toast | dino | `router.refresh()` | |
| `/leaks`, `/leaks/breakdown`, `/leaks/report` | ✗v | – | – | ok | root | dino | – | no pending on view change |
| `/leaks/claims`, `/leaks/proof` | ✗s | – | – | – | root | dino | print | |
| `/recovery` | ✗s | – | – | – | message at top | dino | `<select>` writes on change + refresh | perf-states-14 |
| `/reports/*`, `/ask` | ✗s | ask: blocking mutation | – | – | – | dino | "חושב…" | perf-states-16 |
| `/chain`, `/branches` | ✗v / ✗s | – | 180 ms SSR | 4 sites | root | dino | full reload on switch (ok) | |
| `/suppliers` | ✓ (grid) | `suppliers.list` refetch | 1.2 s settle | – | – | dino | – | double fetch |
| `/suppliers/[id]` | ✓ (list-shaped) | `suppliers.get` refetch | – | – | – | dino | `router.refresh()` | layout-untrue skeleton |
| `/suppliers/ledger` | ✓ | – | **394 ms SSR** | 1 | – | dino | – | slowest SSR |
| `/contracts`, `/contracts/import` | ✗s | `contracts.list` client | 1.0 s | 4 sites | – | dino | `window.confirm` | |
| `/catalog`, `/catalog/import` | ✗s | `catalog.items` | **3.1 s settle** | – | `ErrorNotice` | dino | `toast.error` | |
| `/catalog/mapping` | ✗s | `mapping.unmapped` refetch | – | inbox-zero not T3 | – | dino | – | |
| `/products`, `/products/[id]` | ✗s | refetch | CLS 0.019 | – | – | dino | `router.refresh()` | |
| `/orders` | ✗s | `orders.list` | 2.3 s settle | – | `ErrorNotice` | dino | – | |
| `/orders/[poId]` | ✗s | – | – | – | toast | dino | `router.refresh()` | outbound send not deferred |
| `/orders/new` | ✗s | `suppliers.list` (spinner) | 0.9 s | 2 sites | – | dino; lines in memory | – | |
| `/orders/capture` | ✗s | – | – | – | – | dino | – | |
| `/receiving` | ✓ | – | **CLS 0.122** | day-empty, no CTA | – | banner ✓ | – | sync-banner flash |
| `/receiving/[poId]` | ✓ (list-shaped) | – | **252 kB JS, CLS 0.116, up to 4 s server race** | – | top `role=alert` | `offline.html` | fake OCR stages, upload 30% | perf-states-11 |
| `/invoices/[invoiceId]` | ✗s | – | – | – | root | dino | `router.refresh()` | |
| `/recipes`, `/recipes/[id]`, `/recipes/new` | ✗s | 4 / 3 / 1 client queries | **CLS 0.155** | 4 sites | toast | dino | `window.confirm` | |
| `/inventory`, `/inventory/[countId]` | ✗s | 3 spinner queries | **CLS 0.190** | – | `ErrorNotice` (assertive) | dino | `router.refresh()` | |
| `/inventory/count` | ✗s | spinner-only page | 1.05 s | 2 sites | toast + save chip ✓ | local ✓, no SW | autosave ✓ | `window.confirm` discard |
| `/exports` | ✓ | `integrations.status` | – | – | toast | dino | **warnings as 7 s toasts** | perf-states-10 |
| `/integrations` | ✗s | 3 client queries | 1.1 s | – | – | dino | toast | |
| `/team`, `/settings` | ✗s / ✓ | settings: "טוען…" 2.2 s | – | 1 | – | dino | `window.confirm` (×2) | |
| `/s/[token]` | – | – | – | – | invalid → "חזרה לסקירה" | – | – | perf-states-09 |
| `/leak-check*` (flag off) | – | – | – | – | 404 → "חזרה לסקירה" | – | – | perf-states-09 |

---

## 4. Findings

Severity follows the task scale:
- **P0:** misleads a core task or loses money or trust.
- **P1:** major friction, or below par against the benchmark.
- **P2:** polish.
- **P3:** nit.

### P1

**perf-states-01 · P1 · states · 33 dashboard routes · all roles · both: most taps show nothing for up to 1.5 s, and the fix must not re-trigger the soft-nav stall**
- **Evidence:**
  - Loading coverage script: 10/43 pages covered by 5 `loading.tsx` files (approvals, exports, receiving, settings, suppliers). Zero `<Suspense>` in `apps/web/app` and `lib`.
  - Probe C (throttled phone): approvals → leaks still shows the old page at 600 ms (`crops-perf/C_leaks_600ms.png`); receiving → orders still shows the old page at 600 ms. Routes with a boundary show a skeleton at 600 ms (`C_approvals_600ms.png`).
  - Next prefetches only down to the nearest loading boundary, so hover and viewport prefetch buys nothing on 33 routes.
  - Programmatic `router.push` shows no bar (`RouteProgress.tsx:73–87` listens to anchor clicks only).
  - `pay-run` uses a full document reload to dodge the stall (`approvals/pay-run/page.tsx:136–140`).
  - Commit `0baf09e5` documents the stall.
- **Problem:** the field user taps, sees nothing change, and taps again. That is the classic double-navigation and rage-tap pattern. The bookkeeper's month toggle reloads the whole document.
- **Recommendation:** §2.2.
  - (a) Add a layout-true `loading.tsx` to the 26 segments with no same-route param navigation.
  - (b) For the 8 view-toolbar or tab segments: keyed in-page `<Suspense key={viewKey}>` per data section; delete `approvals/loading.tsx`; change pay-run's month `<a>` back to `<Link>`.
  - (c) Extend `apps/web/scripts/check-soft-nav.mjs` with approvals filters, pay-run month, supplier tabs and one cross-route tap per new boundary. All must pass 6/6 in he and en before merge.
  - (d) Call `startRouteProgress()` in every `router.push` after a mutation.
  - Owner: `web-feature-engineer`. The CI step for (c) is a human PR.
- **Exemplar:** Linear (the destination shell paints on tap; data streams in); Vercel dashboard (Next prefetch to the loading boundary); Polaris SkeletonPage.
- **Effort:** M · **humanPR:** partial (CI wiring only).

**perf-states-02 · P1 · perf · layout + `/dashboard` + `/receiving/[poId]` · all · both: server waterfalls hold the first byte; the T1 ₪ waits for everything**
- **Evidence:**
  - `layout.tsx:30, 36, 44, 61, 81, 94`: 6 sequential stages. `:176` `<WorkerStatusBanner/>` is un-suspended, with a deadline of 1,500 ms (`worker-status.tsx:8`).
  - `page.tsx:53–112`: 7 more stages. The hero, `leakHero`, sits inside a `Promise.all` with activity, trend, KPIs and options, then `returnedThisMonth` and `owner.leaks` run sequentially after it.
  - `receiving/[poId]/page.tsx:39–65`: `ensureEnglish` or `localNames` race 4,000 ms, then `priceContext`, then `getPo`.
  - Probe A: `/dashboard` is 189 ms on localhost, and nothing streams.
  - `router.refresh()` (20 call sites) re-runs the whole layout waterfall each time.
- **Problem:** every database round trip in production multiplies by about 12 stages before any byte. The receiver in Arabic or English waits up to 4 s for a translation before seeing the PO. This blocks rubric I1 (LCP ≤2.5 s, with the hero as the LCP).
- **Recommendation:**
  - Layout: one `Promise.all`, and wrap the banner in `<Suspense fallback={null}>`.
  - Home: hero section = `<Suspense>` around an async `HeroSection` that awaits only `leakHero` and `returnedThisMonth`, in parallel. Every other card is its own `<Suspense>` + `<SectionBoundary>`.
  - Receiving wizard: render the PO with Hebrew names at once. Stream localized names in a `<Suspense>` client patch, or `use()` a promise passed from the server. Run `priceContext` and `getPo` in parallel.
  - Budget: ≤1 sequential stage before the shell (§2.8).
- **Exemplar:** Next.js streaming with Suspense (Vercel commerce pattern); Linear (shell first); Stripe Dashboard (the KPI header renders before the charts).
- **Effort:** M · **humanPR:** no.

**perf-states-03 · P1 · perf/states · `/inventory`, `/inventory/count`, `/recipes`, `/catalog`, `/orders`, `/orders/new`, `/integrations`, `/settings` · chef, manager, owner · mobile: pages ship a spinner and then fetch, and the chef's screens jump**
- **Evidence:**
  - `spin-probe.cjs`: these routes contain an `animate-spin` "טוען" in their server HTML.
  - `states-probe`: settle at 4× CPU: catalog 3.1 s, orders 2.3 s, settings 2.2 s ("טוען…"), recipes 1.6 s (4 client queries).
  - `cls-probe`: CLS **0.190** on `/dashboard/inventory` (`period-card.tsx:26, 38` pops in) and **0.155** on `/dashboard/recipes` (`recipes-home.tsx:41–47`, 265 px push).
  - `inventory-home.tsx:22–23, 43, 66`: spinner-only sections.
  - `inventory/count/count-screen.tsx:46, 54`: the count screen, a primary field flow, renders a spinner until `inventory.current` returns.
- **Problem:** two waits stacked: the server render, then hydration plus a fetch on a phone. Content arrives after the chef has started scrolling, and the page jumps under the thumb.
- **Recommendation:**
  - Fetch these queries on the server and pass `initialData`, or `prefetch` + `HydrationBoundary`. Start with `inventory.current`, `inventory.period`, `inventory.history`, `recipes.list` + `posVsTheory` + `priceAlerts`, `suppliers.list` for `orders/new`, and the settings referral.
  - Where a section must stay client-side, its skeleton reserves the final height (CLS ≤0.05).
  - Add a lint rule or test: no `Spinner` inside an `isLoading` branch at page level.
- **Exemplar:** Linear (local cache: no spinners on revisit); Toast mobile counts (open on cached data).
- **Effort:** M · **humanPR:** no.

**perf-states-05 · P1 · perf/a11y · `/dashboard/receiving`, `/dashboard/receiving/[poId]` · receiver · mobile: a sync banner flashes on every mount and shifts the delivery cards 70 px twice (CLS 0.12)**
- **Evidence:**
  - `cls-probe`: shifts at 887 ms (+70 px) and 948 ms (−70 px) on the list, and at 1231/1280 ms on the wizard. All three PO cards and the "קלוט סחורה" links move.
  - `lib/pwa/ReceiverPwa.tsx:151`: `refreshCount().then(() => sync())`. `:110`: `setSyncing(true)` runs even when the queue is empty. `:189`: the banner renders when `queued > 0 || syncing`.
- **Problem:** the receiver taps a card exactly as it jumps, so the tap lands on the wrong PO or misses. CLS on the most important mobile screen fails the ≤0.05 field budget.
- **Recommendation:**
  - In `sync()`, return early when `(await idbQueueStore.list()).filter(mine).length === 0`, before `setSyncing(true)`.
  - Only show "מסנכרן" if syncing lasts over 400 ms.
  - Render the banner in a slot of reserved height, or as an overlay chip in the header (the sync chip from `mobile-field` §3.7), not in the content flow.
  - Remove the GSAP viewfinder-corner `from` animation (CLS sources on the wizard; see `mobile-field-23`).
- **Exemplar:** WISK and MarginEdge pending-upload chips (persistent and fixed, never pushing content); web.dev CLS guidance.
- **Effort:** S · **humanPR:** no.

**perf-states-06 · P1 · states · every dashboard route · all mobile roles · mobile: the bottom bar renders only after hydration, 2.2 s after the content on a cold phone**
- **Evidence:**
  - `nav-probe`, cold cache: FCP 884 ms vs nav 3,084 ms (receiver `/receiving`); 1,240 vs 3,531 ms (owner `/dashboard`); 944 vs 3,368 ms (approvals). Warm: about 0.3–0.5 s gap.
  - `app/dashboard/nav.tsx:264–265, 417`: `mounted ? createPortal(<nav…/>)`. It is portalled because the header's `backdrop-filter` makes it the containing block for `position: fixed`.
- **Problem:**
  - The primary navigation of the mobile product is missing for 2–3 s on every first load of the day, then appears and covers the bottom 72 px.
  - Any tap meant for content in that zone during the gap lands on the nav when it pops in.
  - The SSR page carries no thumb-zone navigation at all.
- **Recommendation:** render `<MobileBottomBar>` from `app/dashboard/layout.tsx` as a **sibling of `<header>`** (outside the backdrop-filter element), server-rendered. Keep only the drawer portal client-side. Expose `--bottom-nav-h` for toasts and sticky bars (§2.4).
- **Exemplar:** Toast Go and Square handheld (the chrome is there before the data); Shopify POS.
- **Effort:** S · **humanPR:** no.

**perf-states-07 · P1 · states/functional · `/dashboard/approvals` (+ `/dashboard/inbox`) · owner, manager, bookkeeper · both: deciding waits 2 round trips, collapses the loaded list, and reports failures where nobody looks**
- **Evidence:**
  - `approvals/list.tsx:65–79`: `onSuccess` → `refreshFirstPage()` → `setItems(fresh 50)`. Rows loaded through "טען עוד" (`:85–101`) disappear and the scroll jumps.
  - `:71, 128`: a single error card with `role=alert` at the list top.
  - Probe E1: failing approve at button y=1884, viewport 1558–2402, alert at **y=737**, never visible (`E1_approve_fail_viewport.png`). The button simply returns to "אשר".
  - `:106–124`: the "בתור" and "₪ בסיכון" tiles sum **loaded rows only**, so they read as totals over 50 rows when they are partial.
  - Inbox: `inbox-client.tsx:129–136` uses `router.refresh()` (full tree) per decision, and `toast.error(t('inbox.actionFailed', { message: err.message }))` interpolates raw server text into a 7 s toast.
- **Problem:**
  - At volume (the bookkeeper on desktop, 30–60 items) every decision costs about 0.5–1.5 s and loses the user's place.
  - A failure looks like nothing happened, so the user taps again or moves on believing the invoice is approved.
  - The ₪-at-risk tile under-states when more than 50 items are open.
  - Complements `mobile-field-15` and `a11y-05`; this finding adds the list-truncation and error-placement evidence.
- **Recommendation:**
  - `onMutate`: `utils.approvals.myQueue.setData(...)` removes the row (150 ms exit), keeps the paginated tail, moves focus to the next row, and recounts the tiles.
  - `onError`: re-insert at the original index with an inline `role=status` error on that card ("האישור לא נשמר — נסה שוב") and a retry button.
  - `onSettled`: invalidate counts only.
  - Toast "אושר · ₪100.00 · בטל" for 10 s (R-6, R-7); Undo calls a `reopen`.
  - Tiles get their totals from the server (`myQueueSummary`), shown as "57 בתור · ₪3,120" even when 50 are loaded.
  - Inbox: the same pattern; replace `{message}` with `friendlyError()`.
- **Exemplar:** Superhuman (instant archive, auto-advance, Undo); Linear Triage (optimistic, rollback); Ramp approvals (inline per-row errors) [K].
- **Effort:** M · **humanPR:** no (`approvals/engine.ts` is untouched; the routers are not immutable).

**perf-states-08 · P1 · states/functional · every dashboard route outside `/dashboard/receiving` · all · both: offline is a silent dead end**
- **Evidence:**
  - Probe D1: offline approve sends 0 requests, `aria-busy` spins indefinitely, with no text (`D1_approve_offline_4s.png`). React Query's default `networkMode: 'online'` pauses mutations, and `lib/trpc/client.tsx:13` sets no defaults. When the network returns, the paused approve fires without the user knowing.
  - Probe D2: navigation offline shows Chrome's "No internet" page. The SW scope is `/dashboard/receiving` (`ReceiverPwa.tsx:135`; `receiver-sw.js/route.ts`).
  - No connectivity indicator exists outside `ReceiverPwa` (grep: `navigator.onLine` only in `lib/pwa`).
- **Problem:**
  - The manager approving in the walk-in (no signal), the chef in the cellar, and the owner on a train get a frozen button or a browser error page.
  - A paused money decision that fires later without being seen is a trust problem.
  - The field outbox (`mobile-field-02`) solves field writes. This finding is the **desk and queue** side.
- **Recommendation:** §2.5.
  - Add `useOnline()` + a header chip (T4).
  - `mutations: { networkMode: 'always' }`, so failures show inline at once.
  - Money buttons disabled offline with the reason "אין חיבור — האישור לא נשלח".
  - One app-wide SW scope `/dashboard` with an offline page per route family that links back to cached field routes.
  - Read-only cached views (last-loaded approvals list) can render with a "נתונים מ-07:42" stamp.
- **Exemplar:** Toast offline mode (a banner, explicit unavailable actions); Superhuman offline (queue + clear state); Linear offline (the sync indicator).
- **Effort:** M · **humanPR:** no.

**perf-states-09 · P1 · states · every dashboard error and not-found; `/s/[token]`; `/leak-check*` · all + supplier + public · both: errors throw the user out of the app; public and supplier visitors are sent to "חזרה לסקירה"**
- **Evidence:**
  - Only `app/error.tsx`, `app/not-found.tsx` and `app/global-error.tsx` exist.
  - Probe E2: `/dashboard/orders/not-a-uuid`, `/invoices/<zero uuid>`, `/receiving/<zero uuid>`, `/suppliers/<zero uuid>` and `/dashboard/nope` all render a centred card **without the header or bottom nav** (`crops-perf/E2_*.png`). Two of them return HTTP 200.
  - `app/error.tsx:42–48` and `not-found.tsx:25`: the only way out is "חזרה לסקירה" → `/dashboard`.
  - `s_invalid-demo-token__public__phone-he.png`: a supplier with a mistyped or revoked link gets the same card. Its CTA leads to `/login`.
  - The `leak-check` 404 (flag off) is the same for marketing visitors.
  - Home `page.tsx:78–90`: one failed non-hero query (activity, trend, options, kpis) fails the whole page.
- **Problem:**
  - A transient error on the receiving wizard costs the receiver their place and their navigation.
  - The supplier, a client-facing surface (J3 S1), sees an internal app's "overview" button.
  - A broken activity feed hides the ₪ hero.
- **Recommendation:** §2.6.
  - Add `app/dashboard/error.tsx` and `app/dashboard/not-found.tsx` (inside the layout).
  - Add per-entity `not-found.tsx` with the parent link.
  - Add `<SectionBoundary>` around optional home cards, plus `Promise.allSettled` for the non-hero queries.
  - Add `app/s/[token]/not-found.tsx` (supplier copy, no app CTA) and a marketing `not-found` ("חזרה לאתר").
  - `error.tsx` copy: "לא הצלחנו לטעון את הדף. נסו שוב — אם זה חוזר, שלחו לנו את הקוד {digest}."
- **Exemplar:** Linear and GitHub (errors inside the app chrome, with retry); Stripe (section-level "Couldn't load" cards); Primer Blankslate (error kind).
- **Effort:** S–M · **humanPR:** no.

**perf-states-10 · P1 · trust · `/dashboard/exports` (accounting files) · bookkeeper, owner · desktop: "invoices were left out of the accounting file" is a toast that vanishes in 7 s**
- **Evidence:** `exports/accounting-files.tsx:47–54`. After the download, up to **4 toasts** fire at once:
  - success "הורדו N";
  - error "לא נכללו חשבוניות בלי מספר, תאריך, סכום או ספק: {count}";
  - error "replaced chars";
  - success "derived VAT".

  `Toast.tsx:28, 48`: errors dismiss at 7,000 ms and the stack keeps 4. There is no persistent result and no list of the skipped invoices.
- **Problem:**
  - The bookkeeper sends the accountant an incomplete file without knowing it, and VAT deductions for those invoices are missed.
  - This is data integrity, not a notification.
  - It breaks C9 (stakes → message type) and H3 (the file must match the ₪ shown elsewhere).
- **Recommendation:**
  - Replace the toasts with a persistent **export result panel** under the buttons:
    - "הקובץ ירד · 412 חשבוניות · ₪184,220";
    - a warn row: "7 חשבוניות לא נכללו — חסר מספר/תאריך/ספק" with **"הצג ותקן"** (a link to `/dashboard/invoices?missing=1`) and "ייצא שוב";
    - an info row for derived VAT.
  - Keep the panel until the next export.
  - Never route data-integrity warnings through `toast.error`. Add a lint rule for `toast.error(` with `skipped|rejected|replaced`.
- **Exemplar:** QuickBooks and Xero bank-feed import summaries (persistent "N skipped" with a fix link) [K]; Stripe exports (a job page with a row count).
- **Effort:** S · **humanPR:** no.

**perf-states-11 · P1 · states/trust · `/dashboard/receiving/[poId]` (scan → processing) · receiver · mobile: the upload bar is frozen at 30% and the OCR stages are a loop animation**
- **Evidence:**
  - `showcase/receiver/_steps/InvoiceScan.tsx:105`: `setUpload({ phase: 'uploading', pct: 30 })`. `pct` is never updated, and `:292–297` shows a spinner banner at `text-xs`.
  - `receiving/[poId]/wizard.tsx:759`: `setInterval(… (a + 1) % 3, 1400)`. "Done" ticks reset every 4.2 s regardless of real status.
  - `:40`: `STILL_READING_AFTER_MS = 30_000`. The escape hatch "המשך לפי ההזמנה" appears only at 30 s (rubric G6 / I3: 10 s).
- **Problem:**
  - On a weak signal a 3 MB photo can take 10–20 s, and the receiver can't tell "uploading slowly" from "stuck".
  - The looping ✓ marks look fake once noticed, and that undermines trust in the ₪ that follows (H4).
  - The driver waits 30 s before the receiver may proceed.
  - Complements `RCV-22` with exact lines and timings.
- **Recommendation:**
  - Upload via XHR (or `fetch` with a streams upload where supported) with `upload.onprogress` → `<ProgressBar role="progressbar" aria-valuenow>`, "מעלה… 63%".
  - OCR stages driven by `getInvoice().status` + `ocr_job.stage`:
    - `uploaded` → "קורא את החשבונית · 1/3";
    - `matching` → "מתאים לקטלוג · 2/3";
    - `compared` → "משווה להזמנה · 3/3".
  - The text changes at least every 2 s.
  - Show "המשך לקלוט לפי ההזמנה — החשבונית תושלם ברקע" at **10 s**, and send a notification when it is ready.
  - Delete the 1.4 s cycle.
- **Exemplar:** Toast xtraCHEF and MarginEdge (per-upload status: "Processing / Ready"); Apple HIG progress indicators (determinate when knowable); NN/g 0.1 / 1 / 10 s limits.
- **Effort:** M · **humanPR:** no (an `ocr_job.stage` column would be a schema change; use existing statuses first).

**perf-states-14 · P1 · states/trust · recovery, contracts, recipes, team, settings, count, approvals, orders · owner, manager, bookkeeper · both: there is no Undo anywhere, a `<select>` writes money states on change, and 8 native confirms**
- **Evidence:**
  - Grep `undo` in the dashboard: only a chain icon import.
  - `recovery/tracker-client.tsx:280–297`: `<select value="" onChange={() => transition.mutate({ to })}>`. Picking "ויתור" writes `written_off` at once (reversible only by finding "claimed" in the same menu). The control is `text-xs py-1` (~26 px). Feedback is a message at the top plus `router.refresh()`.
  - `window.confirm` in `team-client.tsx:235`, `recipe-editor.tsx:373`, `settings/dsr.tsx:67`, `account-section.tsx:121`, `count-screen.tsx:394`, `contracts-panel.tsx:121`, `thresholds-panel.tsx:81` (+ admin).
  - `Toast` has no action slot.
- **Problem:**
  - A mis-tap in a dense desktop table writes off a ₪ claim with no confirmation and no Undo.
  - Native dialogs are English-chromed and LTR on many browsers, and ignore the design language.
  - No reversible action has a safety net, so users slow down on every click: the opposite of "instant".
- **Recommendation:**
  - Adopt the §2.4 table:
    - replace the recovery `<select>` with a row menu (`DropdownMenu`);
    - `written_off` → `ConfirmDialog` "לוותר על ₪320.16 מול מאפיית ברנר?";
    - the other transitions are optimistic + Undo toast for 10 s.
  - Replace all 8 `window.confirm` with `ConfirmDialog`. It already exists in `lib/components` and has 3 uses today.
  - Toast v2 with an action slot (`design-system-20`).
- **Exemplar:** Gmail and Superhuman Undo; Stripe (confirm costly actions, naming the amount); Linear (Z to undo).
- **Effort:** M · **humanPR:** no.

**perf-states-15 · P1 · states · every authenticated route · all (worst: receiver and chef on shared phones) · both: an expired session reads as "you don't have permission", and in-memory work is lost**
- **Evidence:**
  - `lib/components/errors.ts:30–32`: `case 'FORBIDDEN': case 'UNAUTHORIZED': return t('errors.forbidden')` → "אין לכם הרשאה לפעולה הזו".
  - `lib/sessionLifetime.ts:13`: the default session (no "remember me") is 24 h, and the cookie dies with the browser session.
  - Receipt marks and order lines live in React state (`RCV-02`). There is no tRPC link-level 401 handling.
- **Problem:**
  - A receiver who signed in yesterday starts a receipt. The first write fails with a permission error that doesn't name the cause.
  - Reloading sends them to `/login`, and the marks are gone.
- **Recommendation:** §2.5.
  - A tRPC link + `QueryCache` / `MutationCache` `onError` intercept `UNAUTHORIZED` and open a re-auth sheet in place: "ההתחברות פגה. התחברו שוב — העבודה שלכם נשמרה."
  - Password, or a magic link that returns to the same URL.
  - Retry the failed call after re-auth.
  - New copy key `errors.sessionExpired`.
- **Exemplar:** Google Workspace and Notion re-auth modals (state preserved); Linear (silent token refresh).
- **Effort:** M · **humanPR:** no (the auth callbacks in `auth.ts` are not on the immutability list).

### P2

**perf-states-04 · P2 · perf · catalog, orders, suppliers, supplier detail, mapping, recipes · all · both: every server-seeded list is fetched twice**
- **Evidence:** `lib/trpc/client.tsx:13` uses `new QueryClient()` with no defaults (`staleTime: 0`). `states-probe` records the client refetch right after hydration on `suppliers.list`, `suppliers.get`, `catalog.items`, `orders.list`, `mapping.unmapped` and `recipes.list`, all of which receive `initialData`.
- **Problem:** this doubles database work per view, adds a hydration-time network burst on phones, and risks a flicker when the second payload differs.
- **Recommendation:** `defaultOptions.queries.staleTime = 30_000` (or `initialDataUpdatedAt` from the server render time), `retry` skips 4xx, and `refetchOnWindowFocus` stays on for freshness.
- **Exemplar:** TanStack Query SSR guidance (`staleTime > 0` with SSR data).
- **Effort:** S · **humanPR:** no.

**perf-states-12 · P2 · states · `/dashboard`, `/leaks*`, `/chain`, `/approvals` (`ViewToolbar`) · owner, bookkeeper · desktop: a period or filter change looks ignored for up to a second**
- **Evidence:**
  - `view-probe`: after choosing "חודש קודם", the select shows "החודש" again at 100 and 400 ms. It switches at about 900 ms (400 ms RTT), with no progress and no `aria-busy` (`crops-perf/V__dashboard_400ms.png`).
  - `ViewToolbar.tsx:108–116`: a bare `router.replace` with no `useTransition`.
  - `RouteProgress` ignores same-path navigations (`routeProgressState.ts:32`).
- **Problem:** the owner thinks the click missed and clicks again. Two navigations then race, and the numbers flash.
- **Recommendation:**
  - `const [isPending, start] = useTransition(); const [optView, setOptView] = useOptimistic(view);`, rendering controls from `optView`.
  - Provide `isPending` through a `ViewPendingContext`. Data regions get `aria-busy` + `opacity-60` after 150 ms, plus a 2 px line under the toolbar.
  - Pairs with the keyed Suspense in perf-states-01.
  - Announce "מעדכן לתקופה: חודש קודם" (`a11y-13`).
- **Exemplar:** Linear filters (instant chip, data refreshes behind); Vercel Analytics range picker; React `useOptimistic` docs.
- **Effort:** S · **humanPR:** no.

**perf-states-13 · P2 · states/copy · 38 `EmptyState` sites · all · both: empty states are untyped; filtered-empty claims "all handled"; inbox-zero isn't earned calm**
- **Evidence:**
  - `EmptyState.tsx` has no `kind`, is always centred, and its action is optional (9 of 38 sites have one).
  - `approvals/page.tsx:87–92`: the same ✓ "אין חריגות בתור כרגע" for empty and for **filtered** views, with no "נקה סינון".
  - `inbox` first-use has no CTA (`dashboard_inbox__owner__phone-he.png`).
  - `catalog/mapping` "הכול ממופה" has no count and no next step.
  - `receiving` "אין משלוחים שמתוכננים להיום" has no CTA for a delivery without a PO.
- **Problem:** users can't tell "nothing to do" from "hidden by a filter" from "not set up", which costs trust and activation (J2).
- **Recommendation:** add the `kind` prop, layout rules and the copy table in §2.7. Make `action` required for `first-use` and `no-results` (enforced through TypeScript overloads).
- **Exemplar:** Primer Blankslate; Carbon empty states (three types); Polaris EmptyState; Superhuman inbox zero.
- **Effort:** M · **humanPR:** no.

**perf-states-16 · P2 · states · `/dashboard/ask` · owner, manager · both: the AI answer is a blocking request behind a static "חושב…"**
- **Evidence:** `ask/ask-client.tsx:111`: `trpc.ask.ask.useMutation()`. `:175–176`: a `Loader2` + `t('thinking')` until the full answer returns. There is no streaming, no stages and no cancel.
- **Problem:** LLM answers take 3–15 s. Beyond 3 s the ladder needs progress text, and beyond 10 s it needs to keep partial output. A frozen "חושב…" reads as broken.
- **Recommendation:**
  - Move to a route handler that returns a `ReadableStream` (or tRPC v11 `httpSubscriptionLink`), rendering tokens as they arrive.
  - Show stage chips first ("מחפש בחשבוניות של אוקטובר…", "מחשב…").
  - Add an "עצור" button.
  - Keep sources linked as today.
- **Exemplar:** ChatGPT and Claude (token streaming + stop); Ramp Intelligence and Perplexity (visible research steps).
- **Effort:** M · **humanPR:** no.

**perf-states-17 · P2 · perf · `/dashboard/receiving/[poId]` · receiver · mobile: the field route is the heaviest page in the app**
- **Evidence:**
  - `next build`: 252 kB first-load JS (17.3 kB page + showcase steps). Probe B: 97 KB route-specific transferred with a warm cache; ~210 KB on a cold load.
  - `InvoiceScan.tsx:3–4` and `AdjustQuantities.tsx:3–4` import `gsap` + `@gsap/react`.
  - `DockSlip`, `dock-price-context` and the localize helpers are all eager.
- **Problem:** the weakest network carries the heaviest bundle. Hydration (and the bottom nav, perf-states-06) arrives last on the receiver's phone.
- **Recommendation:**
  - Remove GSAP from dashboard routes (CSS transitions, or nothing on field routes; see `mobile-field-23`).
  - `next/dynamic` for `DockSlip` and the processing view.
  - Keep the showcase twin separate from the field components.
  - Budget ≤170 KB route JS (§2.8), checked from the `next build` output.
- **Exemplar:** Alex Russell's global P75 budget; Toast Go (native-feel field app).
- **Effort:** S–M · **humanPR:** no.

**perf-states-18 · P2 · visual/a11y · the 5 existing `loading.tsx` · all · both: skeletons are generic and layout-untrue, and the shimmer ignores reduced motion**
- **Evidence:**
  - `approvals/loading.tsx:20`: `h-36` cards vs ~310 px real cards (`area-approvals`).
  - `receiving/loading.tsx` is a 2-column list grid, also shown for the `[poId]` wizard.
  - `suppliers/loading.tsx` is a card grid, also shown for `/suppliers/ledger` (a table) and `/suppliers/[id]` (tabs).
  - Static page titles render as skeleton bars (`C_approvals_600ms.png`).
  - `Skeleton.tsx:6`: `animate-pulse`, with no `motion-reduce:animate-none`.
- **Recommendation:**
  - `Skeleton` variants (§2.2).
  - A `loading.tsx` per leaf segment that renders the real `<h1>` and copies the grid.
  - `motion-reduce:animate-none`.
  - `aria-busy="true"` on the region (`design-system-20`, `a11y-15`).
- **Exemplar:** Polaris SkeletonPage (the title renders as real text); Carbon skeleton states.
- **Effort:** S · **humanPR:** no.

**perf-states-19 · P2 · perf · 20 `router.refresh()` sites (inbox, recovery, orders detail, count actions, product, supplier details, contracts, invoice correction, branches) · all · both: every small write re-renders the entire app tree**
- **Evidence:**
  - `grep router.refresh()`: 20 dashboard and lib sites.
  - Each re-runs the layout waterfall (perf-states-02), the heartbeat read and the full page queries.
  - `chain-26`: on recovery it runs `syncClaims` twice per action.
- **Problem:** decisions feel slow, and the server does 10–20× the necessary work. The scroll and focus can reset.
- **Recommendation:**
  - Local optimistic update + targeted `utils.<router>.<proc>.invalidate()` for client-owned lists.
  - For server-rendered sections, move the list to a client query seeded with `initialData`, or use a server action with `revalidatePath` scoped to the page.
  - Reserve `router.refresh()` for locale and branch switches.
- **Exemplar:** Linear (local transactions, no page refetch).
- **Effort:** M · **humanPR:** no.

**perf-states-20 · P2 · visual/states · toasts on every dashboard route · all · mobile: toasts collide with the bottom bar, the safe area and the consent bar**
- **Evidence:**
  - `Toast.tsx:65`: `fixed inset-x-4 bottom-20 z-50` (80 px).
  - The bottom bar is `bottom-[var(--consent-h)] … pb-[env(safe-area-inset-bottom)]` (`nav.tsx:420`), about 72 px plus 34 px of safe area in an installed iPhone PWA, so about 106 px.
  - The consent card is `fixed bottom-0 z-50` and later in the DOM (`CookieConsent.tsx:88`, root layout).
- **Problem:** on an installed iPhone app the toast overlaps the nav. On a first visit it hides behind the consent card. The receiver never sees "נשמר".
- **Recommendation:** `bottom: calc(var(--bottom-nav-h,0px) + var(--consent-h,0px) + env(safe-area-inset-bottom) + 8px)`, on the bottom-start side (C9), with a z-index token above the consent card (`mobile-field` §3.2 layers).
- **Exemplar:** Material 3 snackbar above the bottom navigation; Polaris Toast offset.
- **Effort:** S · **humanPR:** no.

**perf-states-21 · P2 · perf · global · all · both: no field measurement and no performance gate; the soft-nav regression check is manual**
- **Evidence:**
  - No `web-vitals` or `useReportWebVitals` in `apps/web`.
  - `apps/web/package.json:16`: `test:prod-softnav` exists, but no workflow runs it (grep `.github/workflows`).
  - There is no bundle-size check.
- **Problem:** the budgets in §2.8 can't be held. The stall fixed in `0baf09e5` can come back with the next `loading.tsx` (perf-states-01 depends on this gate).
- **Recommendation:**
  - `useReportWebVitals` → Vercel Speed Insights, tagged with route, role and coarse pointer.
  - A `test-sentinel` Playwright perf spec (CLS on 8 routes at 4× CPU; LCP element = hero on `/dashboard`).
  - The soft-nav check against `next start`.
  - A bundle budget from the build manifest.
  - Workflow wiring is a **human PR**.
- **Exemplar:** Vercel Speed Insights; Shopify Web Performance dashboard; Google CrUX.
- **Effort:** S · **humanPR:** yes (`.github/workflows/*` is immutable).

---

## 5. Big moves (ranked by ₪ value ÷ risk)

1. **Streaming shell everywhere.**
   - perf-states-01, 02, 03, 06 and 18.
   - One sprint for `web-feature-engineer`. Every tap paints the destination shell in under 100 ms. The T1 ₪ streams first. The bottom bar is server-rendered. No page ships a spinner.
   - Gated by the extended `check-soft-nav.mjs`, which keeps the October stall from returning.
   - **Benchmark:** Linear and the Vercel dashboard.
2. **Instant, undoable decisions.**
   - perf-states-07, 14, 19 and 12.
   - Optimistic row exit, pagination kept, inline rollback errors, a 10 s Undo, menus instead of money `<select>`s, and `ConfirmDialog` that names the ₪.
   - The bookkeeper's 50-item queue goes from about 50 s of waiting to about 0, the owner can triage one-handed, and every mistake is reversible.
   - **Benchmark:** Superhuman and Linear Triage.
3. **No dead ends.**
   - perf-states-08, 09, 15, 13 and 10.
   - A connectivity and session layer, error boundaries inside the chrome, typed empty states, and persistent integrity warnings.
   - Offline, expired, broken, empty or filtered, the user always sees **why** and **the next step**, and never leaves the app.
   - **Benchmark:** Toast offline mode, Google re-auth, Primer Blankslate.
4. **Honest waits at the dock.**
   - perf-states-11, 05, 17 and 16.
   - A determinate upload, real OCR stages, the 10 s escape, no layout jumps, the field bundle under budget, and a streamed AI answer.
   - **Benchmark:** xtraCHEF and MarginEdge upload status; ChatGPT streaming.
5. **Performance as a gate** (perf-states-21; human PR for CI): RUM per route and role, plus CI budgets, so "world-class" stays measurable after launch.

---

## 6. Governance (AGENTS.md)
- **No immutable file is needed for findings 01–20.** The touched areas:
  - routers in `packages/api` (not `leads.ts`);
  - `apps/web` pages, components and `lib`;
  - the service-worker route;
  - `auth.ts` callbacks.

  `approvals/engine.ts`, `notifications/outbox.ts`, `cron.ts`, `formatIls()`, schema and RLS stay untouched.
- **perf-states-21:** adding the soft-nav, CLS and bundle steps to `.github/workflows/ci.yml` is a **human PR**. `test-sentinel` writes the specs.
- **perf-states-11:** if real OCR stages need a new column (`ocr_job.stage`), that migration is human-only. The first step uses existing invoice statuses.
- **perf-states-07:** a server `myQueueSummary` for honest totals is a new read procedure. It needs a **COVERAGE manifest entry** in `cross-tenant.attack.test.ts` (adding an entry is allowed; weakening one is not).
- No probe wrote to the database. Every POST and server action was aborted in the browser (`review/scripts/perf-probe.cjs` `guardWrites`).
