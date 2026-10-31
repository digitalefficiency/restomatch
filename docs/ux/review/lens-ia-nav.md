# Lens review: global IA and navigation across roles (`ia-nav`)

**Reviewer:** UX review team, cross-cutting lens `ia-nav` · **Date:** 2026-10-25 (DEMO_TODAY) · **Tree:** `main` @ 8fef118c (`scratchpad/ux/wt`)
**Scope:** every dashboard route (43 `page.tsx` under `app/dashboard`), plus `/scans/[id]`, the PWA manifest and share target, `/admin` (code only), and notification deep links.
**Rubric groups:** all of D (D1–D9). Also F1 (consistent help), F5 (titles and landmarks), G1 (field focus mode) and I1 (chrome cost), where navigation causes the problem.
**Inputs:**
- `research/ia-map.md`, `exec-desktop.md` (§2.1, §4.C/F, §6), `erp-modern.md` (P14–P20), `pwa-field.md` (§1, Pattern 1/11/13), `ordering-mobile.md` (§6, P7), `ainative.md` (P1–P3, P12–P14) and `functional-gaps.md` (FG-19..21).
- The 12 area reviews in this folder. Where an area review owns the page-level detail, this lens gives the system-level contract and links to it.
- All 225 captures and `crawl-results.json`.
- A live probe I ran against the lab (`review/scripts/ia-probe.cjs` and `ia-probe2.cjs`, output in `review/crops-ia/ia-probe.json`). It logged in as each of the 5 roles at 1440×900 and 390×844 and measured chrome geometry, `document.title`, Ctrl+K and `/`, forbidden-route redirects, search results by role, bottom-bar metrics, drawer depth, branch-switch landing and a cross-branch deep link.

**Benchmarks:**
- Sidebar and app shell: Linear, Ramp, Stripe Dashboard, Mercury (Tasks + Command), Shopify admin, Toast Web (multi-location), Restaurant365, Odoo 17.
- Mobile: Material 3 navigation bar, iOS tab bar, Toast Now / Toast Go, MarketMan mobile, Apicbase mobile home, Shopify POS smart grid, DoorDash Merchant "Needs action".
- Command and search: Linear ⌘K, Superhuman Command, Raycast, Mercury Command, Vercel ⌘K.
- Scope switching: Toast "You are viewing", R365 location groups, Vercel and Stripe account switchers that keep the current page [K].
- Permissions: Notion, Figma and Google Drive "request access" pages [K].
- Evidence tags: [Shot] screenshot, [Code] file:line, [Probe] live lab measurement, [K] platform or product knowledge not re-verified live.

---

## Scores (0–10, against world-class)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **3.0** | The bottom bar is the role's "first 4 items in array order" (`nav.tsx:277`). It has 11 px labels, a 53 px translucent bar and no badges. It never contains Orders for the people who order, it spends a slot on Settings for the receiver and chef, and it stays on screen inside the receiving, count and order task flows. Every role lands on the owner's ₪ control room. The receiver PWA's scope excludes the very links in its own bottom bar. |
| Desktop | **3.0** | The owner and manager get an 18- or 16-tab strip that **wraps to 2 rows** inside a 1,152 px column. Sticky chrome is **152 px** of a 900 px screen. There is no sidebar, no ⌘K (`Ctrl+K` leaves focus on `<body>` [Probe]), no keyboard layer and no badges except contracts. Every tab is titled "RestoMatch". A branch switch throws away the page and its filters. |
| Functionality | **3.5** | Reachability and routing have real holes. The bookkeeper and receiver may open the supplier ledger but have no path to it. Forbidden links bounce silently to the home. A cross-branch invoice link shows a 404 outside the app shell. The order-reminder email deep-links with `?supplier=`, but the page reads `?supplierId=`. The PWA share target sends receivers to a page they can't open. There is no invoice index and no unified "needs me" queue. |

**Pilot bar:** fails.
- 1 P0: staff land on the owner's money page instead of their job.
- 13 P1s, on primary flows: approvals, receiving, ordering and deep links.

**World-class bar:** far off. Linear, Ramp and Mercury give each user an inbox-first home. They put ≤7 groups in a collapsible sidebar with live counts and offer a ⌘K that can go, find, do and ask. Their links survive a workspace change. That is the target below.

---

## 0. Executive summary: the 12 decisions this lens asks the owner to approve

1. **One nav registry** (`apps/web/lib/nav/registry.ts`) becomes the single source for roles, flags, labels, aliases, parents, badges, titles, mobile slots and field mode. It drives the sidebar, bottom bar, "עוד" sheet, palette, breadcrumbs, `<title>`, redirects and a CI reachability test. `ROUTE_ROLES` is derived from it. (ia-nav-06)
2. **Desktop:** a **right-side (inline-start) sidebar of 248/64 px with 6 groups**: כסף · דליפות · רכש · מטבח · רשת · ניהול. It has two top items, בית and לטיפולי, a scope chip, a ⌘K field and live badges. The **56 px top bar** holds breadcrumbs, the bell and the avatar. The content container becomes fluid up to 1,600 px. (ia-nav-02)
3. **Mobile:** **role-specific bottom bars** (table in §4.2). Each has 64 px plus the safe area, 12 px labels, a filled active pill and live badges. The bar is hidden on field routes. "עוד" becomes a grouped sheet. (ia-nav-03, -11, -18)
4. **`/dashboard` renders by role:** the owner's ₪ "מחכה לך" home, the manager's "Today", the bookkeeper's desk, the chef's kitchen and the receiver's deliveries board. No role sees a module it can't act on. (ia-nav-01)
5. **לטיפולי** is a single per-viewer queue of every T2 item (₪ + age + one verb). The home stack, the bell, the sidebar badge and the PWA app badge all read from it. (ia-nav-19, -17)
6. **⌘K / Ctrl+K / `/`** opens a palette with five sections in fixed order: Needs-you → Go to → Records → Actions → Ask. It normalises Hebrew, filters by role, peeks records at L1 and never executes a money move directly. A **keyboard layer** sits on top: G-chords bound by `KeyboardEvent.code`, `?`, and `[` to toggle the sidebar. (ia-nav-04, -21)
7. **Branch is scope, not a reset.**
   - A switch keeps the current page and its filters (detail pages fall back to their parent list).
   - Every external link carries `r=<restaurantId>` through a `/dashboard/go` resolver.
   - Chain owners get `b=all` on money lists (behind a warden gate).

   (ia-nav-08, -09)
8. **The money pipeline is one group in decide → pay → claim → recover order:** אישורים · חשבוניות · ריצת תשלומים · זיכויים · כרטסת ספקים · סגירת חודש. The **leak story is one hub with tabs**. (ia-nav-12, -13)
9. **Every page has one `PageHeader` contract:**
   - a breadcrumb or up-link from the registry, never to a parent the role can't open;
   - one `h1` equal to the nav label;
   - `<title>` = "h1 · branch — RestoMatch";
   - a branch and period context line.

   (ia-nav-05, -15, -16)
10. **No silent bounces.** A forbidden route shows a T4 "זמין ל… · בקשו גישה" page inside the shell. Flag-off routes 404 inside the shell. A 404 for a multi-branch user offers "ייתכן שזה בסניף אחר". (ia-nav-07)
11. **The PWA becomes the whole app for field roles:**
    - scope `/dashboard/`;
    - `start_url` = the role home;
    - shortcuts;
    - a file share target routed by role: receiver → invoice capture, manager → order capture.

    (ia-nav-10)
12. **Help and the accessibility statement** sit in the same place on every shell: the sidebar footer and the "עוד" sheet. (ia-nav-20)

---

## 1. What exists today (measured)

### 1.1 Shell anatomy [Probe] [Code]

| Metric | Owner | Manager | Bookkeeper | Chef | Receiver | Target |
|---|---|---|---|---|---|---|
| Landing URL after login | `/dashboard` (leak hero) | same | same | same | same | role home (§5) |
| Desktop sticky header height | **152 px** (2 tab rows) | **152 px** | 110 px | 110 px | 110 px | **56 px** top bar + sidebar |
| Desktop nav items / rows | **18 / 2** | **16 / 2** | 8 / 1 | 4 / 1 | 3 / 1 | ≤7 groups, 0 wrap |
| `<main>` width at 1440 | 1,152 px (80%) | same | same | same | same | fluid, ≤1,600 |
| `document.title` on every page | "RestoMatch" | same | same | same | same | "h1 · branch — RestoMatch" |
| `Ctrl+K` / `/` | nothing (focus on `BODY` / `MAIN`) | same | same | same | same | palette |
| Phone bottom bar | סקירה · קליטת סחורה · תור אישורים · בלש דליפות · עוד | same | סקירה · תור אישורים · תיבת חשבוניות · בלש דליפות · עוד | סקירה · עלות מנה · ספירת מלאי · **הגדרות** · עוד | סקירה · קליטת סחורה · **הגדרות** · עוד | §4.2 |
| Bar geometry | 53 px tall, labels **11 px**, `rgba(255,255,255,.82)` glass, **0 badges** | same | same | same | same | 64 px + safe area, 12 px, solid, badges |
| Phone drawer | 18 links. The nav viewport is **349 px of 912 px of content**, so "הזמנות" sits at y=1,008 and needs a scroll; the branch list takes the top 270 px | 16 links, scroll | 8 links | 4 links, **all already in the bar** | 3 links, **all already in the bar** | grouped sheet |
| Search placeholder | "חיפוש ספקים, מוצרים, חשבוניות…" | same | same | same | same | role-true |
| "דגי" (a supplier) | ✓ supplier | ✓ | **no results** | **no results** | **no results** | role-scoped records |
| "אישורים" (a screen) | **no results** | **no results** | **no results** | **no results** | **no results** | Go-to section |

Sources: `layout.tsx:121-174` (header), `:123` and `:175` (`max-w-6xl`); `nav.tsx:80-112` (`NAV_ITEMS`), `:191` and `:198` (`flex-wrap`), `:269-278` (bar selection), `:421` (`glass`), `:432` and `:450` (`text-[11px]`); `search.tsx:51` (250 ms), `:55` (2 characters); `searchOptions.ts:28-64` (groups dropped by role); `app/layout.tsx:22-33` (the only `title`).

Screenshots: `crops-ia/owner_desk_he_header.png`, `owner_desk_en_header.png`, `bk_desk_he_header.png`, `recv_desk_he_header.png`, `chef_desk_he_header.png`, `*_phone_mid.png`, `drawer_owner_phone.png`.

### 1.2 Reachability: allowed by role vs reachable from that role's nav [Code + Probe]

Computed from `ROUTE_ROLES` (`lib/roles.ts:43-95`) by longest-prefix match over all 43 routes, compared with the visible nav items:

| Role | Routes allowed | Non-detail routes allowed | Not in nav (reachable only by an in-page button, or not at all) |
|---|---|---|---|
| owner | 43 | 35 | **17**: pay-run, branches (when chain is shown), catalog/import, catalog/mapping, contracts/import, **integrations**, inventory/count, leaks/breakdown, **leaks/claims**, leaks/proof, leaks/report, orders/capture, orders/new, products, recipes/new, reports/digest, **suppliers/ledger** |
| bookkeeper | 17 | 16 | **8**: **pay-run**, contracts/import (then 404s by `canManage`), integrations, leaks/breakdown, **leaks/claims**, leaks/proof, leaks/report (renders a role card), **suppliers/ledger (no path at all)** |
| receiver | 6 | 4 | **suppliers/ledger (no path at all)** |
| chef | 8 | 6 | inventory/count, recipes/new (page CTAs, fine) |

- **Dead ends:** the ledger's breadcrumb (`suppliers/ledger/page.tsx:30-33`) and its row links point to `/dashboard/suppliers*`, which bounce the bookkeeper and the receiver.
- **Silent bounces [Probe]:** these 307-redirect to `/dashboard` with no message:
  - bookkeeper → `/dashboard/orders`, `/suppliers`, `/recipes`, `/chain`
  - chef → `/approvals`, `/exports`, `/suppliers/ledger`, `/approvals/pay-run`, `/integrations`, `/leaks/claims`
  - receiver → `/approvals`, `/orders`, `/integrations`, `/leaks/claims`
  - manager → `/chain`, `/exports`

  The cause is `middleware.ts:81-91`.

### 1.3 Wayfinding today [Code + crawl]

| Route | Nav label | `h1` | `<title>` | Way up |
|---|---|---|---|---|
| `/dashboard` | סקירה | **חדר הבקרה** | RestoMatch | (root) |
| `/receiving` | קליטת סחורה | **none** (`SectionHeader` without `level`, `receiving/page.tsx:44`) | RestoMatch | none |
| `/inbox` | תיבת חשבוניות | **none** (`inbox/page.tsx:43`) | RestoMatch | none |
| `/team`, `/settings`, `/inventory/count` | צוות, הגדרות, (none) | **none** | RestoMatch | none / back link |
| `/leaks` | בלש דליפות | בלש **ה**דליפות | RestoMatch | none |
| `/recovery` | ₪ חוזר | מעקב ₪ חוזר | RestoMatch | **none** |
| `/catalog` | קטלוג | חיפוש מאוחד בקטלוג | RestoMatch | none |
| `/products` | (lights "קטלוג") | שמות באנגלית | RestoMatch | breadcrumb |
| `/exports` | ייצוא | ייצואים להנהלת חשבונות | RestoMatch | none |
| `/chain` | רשת | דאשבורד רשתי | RestoMatch | none |
| `/invoices/[id]` | — | תיקון חשבונית | RestoMatch | **none**. This is the most-linked detail page, reached from receiving, approvals, the breakdown, the pay run, the ledger, the inbox and search |
| `/leaks/claims`, `/reports/*`, `/orders/new`, `/orders/capture`, `/ask` | — | ✓ | RestoMatch | **none** |

- Breadcrumbs appear on 10 pages, back links on 8, and nothing on 7 (`ia-map.md` §3).
- With the title frozen at "RestoMatch", **Next's route announcer never fires**. It announces only when the title changes (`next/dist/client/components/app-router-announcer.js:54-67`), so screen-reader users hear nothing on any client-side navigation.

### 1.4 Branches, deep links and the PWA [Probe] [Code]

- **Branch switch:** from `/dashboard/approvals?sev=block`, switching to "— חיפה" lands on **`/dashboard`** and drops the filter [Probe, `ia-probe2.cjs`]. The cause is `branch-switcher.tsx:75,84` (`then = '/dashboard'`, `window.location.assign`).
- **Cross-branch link:** with Haifa active, opening an invoice that belongs to כפר הזיתים renders the **root 404 page, outside the dashboard shell** (no nav, `h1` empty, title "RestoMatch") [Probe, `crops-ia/cross_branch_invoice.png`]. Its only exit is "חזרה לסקירה".
- **Approval e-mails** link to the queue root `/dashboard/approvals`, with no invoice and no branch (`apps/worker/src/jobs/matchInvoice.ts:241`, `endOfDayReport.ts:115`).
- **The order-reminder e-mail links to `/dashboard/orders/new?supplier=<id>`** (`orderReminders.ts:101`), but the page reads only `supplierId` (`orders/new/page.tsx:10-13`). The supplier is never preselected.
- **PWA:**
  - `scope` and the SW scope are both `/dashboard/receiving` (`public/pwa/manifest.webmanifest`, `lib/pwa/ReceiverPwa.tsx:135`).
  - The receiver's own bar links to `/dashboard` and `/dashboard/settings`, and the flow opens `/dashboard/invoices/*`. All three are out of scope.
  - The `share_target` (`receiving/share/route.ts`) is text-only GET and always redirects to `/dashboard/orders/capture`. **The receiver role can't open that page.**

---

## 2. Target IA principles (how every decision below was made)

1. **Home → act → understand → operate → configure.** Groups appear in that order; act-now items (לטיפולי, אישורים) are never below analytics (D2; Linear Inbox first; Ramp Home + Inbox).
2. **Device by job, not by breakpoint.**
   - Phone first: anything done standing, with goods in hand or against a clock (receiving, count, ordering, single approvals). These get one-handed task modes.
   - Desktop first: anything that compares rows, months or branches (pay run, close, ledger, chain). These get dense tables, a sidebar and the keyboard (`ordering-mobile.md` §6; `erp-modern.md` §1).
3. **One name per thing.** The nav label, the `h1` short form, the palette alias and the bottom-bar label come from one vocabulary entry (§9.4).
4. **Every allowed route is reachable within 2 interactions** from the role's nav, from a parent hub or from ⌘K, and no link points to a route the viewer can't open (D7).
5. **Scope is explicit and portable.** Branch and period live in the URL, survive a switch, and appear in the header and title (D5, D8).
6. **Depth: glance → peek → page** (D6). Palette results, evidence chips and queue rows open an L1 peek, and ⌘↵ opens the full page.
7. **Field routes are a focused product** (G1). No global bottom bar, an explicit ✕, and one 56 px primary.
8. **Badges are honest** (D2). They appear only on queues the viewer can act on, show ₪ for money and a count for capture, use danger only when a `block` exists, and are hidden at 0.

---

## 3. Desktop navigation spec (≥1024 px)

### 3.1 Anatomy (RTL; the sidebar is on the right, which is inline-start; in English it is on the left)

```
┌───────────────────────────────────────────────────────────────┬────────────────────────┐
│ TOP BAR 56: כסף › אישורים · חיפה          [אוק׳ 1–25 ▾] 🔔3 (א)│ SIDEBAR 248 (64 rail)  │
├───────────────────────────────────────────────────────────────┤ ▣ כפר הזיתים ▾  (3)    │ ← scope chip (≥2 branches)
│                                                               │ 🔍 חיפוש או פקודה  ⌘K  │
│  PAGE · fluid, max-w 1600, gutters 32                         │ ■ בית                  │
│  PageHeader: h1 + context line + 1 primary + ⋯                │ □ לטיפולי        7 ●   │ ← danger dot = a block exists
│                                                               │ ⭐ מועדפים (≤7, phase 3)│
│                                                               │ כסף ▾                  │
│                                                               │   אישורים      ‏296 ₪ ● │
│                                                               │   חשבוניות          2  │
│                                                               │   ריצת תשלומים    ו׳   │
│                                                               │   זיכויים      ‏464 ₪   │
│                                                               │   כרטסת ספקים          │
│                                                               │   סגירת חודש      4/6  │
│                                                               │ דליפות ▾               │
│                                                               │   דליפה · דוחות · שאלו  │
│                                                               │ רכש ▾                  │
│                                                               │   הזמנות  · קבלת סחורה 3│
│                                                               │   ספקים · קטלוג ·      │
│                                                               │   חוזים ומחירים     1  │
│                                                               │ מטבח ▸   רשת ▸         │
│                                                               │ ───────────────────────│
│                                                               │ ניהול ▸ · עזרה · נגישות│
└───────────────────────────────────────────────────────────────┴────────────────────────┘
```

The numbers are illustrative and use the demo seed: 4 approvals worth ₪296 (2 blocking), ₪464 in claims to send, and 1 open price alert.

### 3.2 Exact specs

| Element | Spec |
|---|---|
| Widths | 248 px expanded and 64 px rail. Default: expanded at ≥1280 px, rail at 1024–1279 px. Toggle with `[` (Linear) or Ctrl/⌘+`\`; persist in `localStorage['rm:nav:rail']` inside try/catch. |
| Top bar | 56 px, sticky, solid `surface` with a 1 px `line` bottom border (no glass). Start side: the breadcrumb (§9). End side: the page's period/compare chip (pages with views only), the bell (§7.4) and the avatar menu (name, role, branch, language, 2FA/devices, settings, sign-out). The email is removed from permanent chrome. |
| Item | 36 px tall, 14 px label, 16 px icon, `radius-md`, `ps-3`. Hover: `surface-2`. Active: `bg-primary/10`, a 3 px inline-start indicator bar, weight 600 and `aria-current="page"`, so it never relies on colour alone. A detail page lights its registry parent; for example `/invoices/[id]` lights חשבוניות. |
| Group header | 12 px, weight 600, `subtle`, rendered as a `<button aria-expanded>` with a chevron. The collapsed state persists in `rm:nav:groups`. A group the role can see only one item of renders that item flat, with no header. |
| Badge | Pinned to inline-end, 20 px tall pill, tabular figures. **Money** (אישורים, זיכויים): the ₪ via `formatIls(x, {0 dp})` inside `<Money>`, solid danger only when a `block` exists, otherwise warn-subtle. **Count** (חשבוניות needs-review, קבלת סחורה today, contracts): neutral pill. **Status** (ריצת תשלומים): due weekday "ו׳", warn on the due day. Hidden at 0; "99+" cap. Rail mode shows an 8 px dot. Data comes from one batched `nav.badges` query (`staleTime` 30 s, refetch on focus and every 60 s). |
| Scope chip | Only with ≥2 memberships. `▣ <branch> ▾ (n)` opens a 320 px popover: each branch with its role, its ₪ leak and its open-items count, plus "כל הסניפים" for chain owners (phase 3). Behaviour in §8. |
| ⌘K field | 36 px tall and full width, showing "חיפוש או פקודה" plus a `⌘K`/`Ctrl K` kbd chip. Clicking it opens the palette (§7). |
| Footer | ניהול (collapsed group), then "עזרה", "הצהרת נגישות" and "צור קשר" in the same place on every shell (§10.4). |
| Container | `main` loses `max-w-6xl` (`layout.tsx:175`) and becomes a fluid container with `max-width: 1600px` and 32 px gutters. Reading pages (reports, letters, settings) keep a `max-w-4xl` content column inside it. |
| Landmarks | `<nav aria-label="ניווט ראשי">` (sidebar), `<header>` (top bar), `<main id="main-content">`. The skip link stays the first focusable element. |

### 3.3 Groups and items (≤7 top-level; registry keys in `code`)

| # | Group (he / en) | Items, in order (he label → route) | Visible to |
|---|---|---|---|
| — | top | **בית** `home` → `/dashboard` (renders by role) · **לטיפולי** `queue` → `/dashboard/queue` (new; phase 1 = the home stack + bell, phase 2 = its own page) | all / owner, manager, bookkeeper |
| 1 | **כסף** / Money | אישורים `approvals` · חשבוניות `invoices` (new index; tabs הכול · **נכנסות** (= today's `/inbox`) · ריכוז · ללא מספר הקצאה) · ריצת תשלומים `payRun` · זיכויים `claims` (tabs לשליחה = `/leaks/claims` · מעקב ₪ חוזר = `/recovery`) · כרטסת ספקים `ledger` · סגירת חודש וייצוא `close` (= `/exports` + checklist) | per `ROUTE_ROLES`; the manager gets no `close` |
| 2 | **דליפות** / Leaks | דליפה `leaks` (tabs סקירה · פירוק · הוכחה · מגמה) · דוחות `reports` (tabs הדוח החודשי · דוח דליפות A4 · תצוגת מייל) · שאלו את RestoMatch `ask` (flag) | owner, manager; bookkeeper sees דליפה (+ דוחות once `leaks/report` is fixed) |
| 3 | **רכש** / Procurement | הזמנות `orders` · קבלת סחורה `receiving` (desktop = today's review table) · ספקים `suppliers` · קטלוג `catalog` (tabs חיפוש · שמות באנגלית = `/products` · מיפוי מק״טים) · חוזים ומחירים `contracts` (tabs חוזים · התראות · ספים) | owner, manager; bookkeeper sees חוזים ומחירים |
| 4 | **מטבח** / Kitchen | עלות מנה `recipes` · ספירת מלאי `inventory` | owner, manager, chef |
| 5 | **רשת** / Chain | סקירת רשת `chain` · סניפים `branches` | owner with ≥2 branches. A single-branch owner sees סניפים in ניהול ("פתיחת סניף") |
| 6 | **ניהול** / Admin (footer) | צוות `team` · אינטגרציות `integrations` · הגדרות `settings` (tabs: אישי · מסעדה · התאמה ומע״מ · פרטיות) · סניפים (single-branch) | per role |

- **Counts:** 6 groups, at most 6 items per group.
- **Owner:** 2 + 6 + 3 + 5 + 2 + 2 + 3 = 23 entries, down from 18 tabs plus 17 orphans.
- **Bookkeeper:** 12 entries. Pay run, claims, ledger and integrations are reachable for the first time.
- **Chef:** בית, מטבח (2) and הגדרות. A chef order draft is added when ia-nav-14 ships.
- **Receiver:** בית (deliveries) and הגדרות on desktop. The receiver is phone-first.

### 3.4 Per-role default open groups (desktop)

| Role | Expanded by default | Collapsed |
|---|---|---|
| owner (1 branch) | כסף, דליפות | רכש, מטבח, ניהול |
| owner (chain) | רשת, כסף | דליפות, רכש, מטבח, ניהול |
| manager | רכש, כסף | דליפות, מטבח, ניהול |
| bookkeeper | כסף | דליפות, רכש, ניהול |
| chef | מטבח | ניהול |

---

## 4. Mobile navigation spec (<1024 px)

### 4.1 Top bar (56 px + `env(safe-area-inset-top)`, solid surface)

- **Start:**
  - With ≥2 memberships: the branch chip "כפר הזיתים — חיפה ▾", 16 px semibold, ≥44 px tall, which opens the branch sheet (§8).
  - Otherwise: the restaurant name.
  - In both cases a role line at 12 px follows. **No email** (today the email takes the second line in `font-mono` and is truncated, `layout.tsx:146-150`).
- **End:**
  - 🔍 44×44 opens the palette full-screen (D3, D4).
  - 🔔 44×44 shows a dot when a T2 item exists.
  - The language picker leaves the top bar for every role **except** the receiver with `receiverLanguages` on, because the receiver's phone is often shared. For everyone else it moves to "עוד → פרופיל".
- **≡ menu button:** removed. "עוד" in the bar replaces it, which leaves one way into secondary nav instead of two.

### 4.2 Bottom bar per role (4 destinations + "עוד"; home on the right/start)

| Role | 1 (start) | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **receiver** | **בית**: deliveries today (badge = trucks still expected) | **צלם**: capture an invoice that arrived without a PO (a camera sheet). This is an action tab | **קבלות**: my receipts, last 7 days, with the dispute and sync status (badge = offline queue, warn) | — | **עוד** |
| **chef** | **בית** (kitchen today) | **ספירה** (badge = open count, "34/80") | **מנות** (badge = dishes over target) | **הזמנה**: draft an order for the manager (ia-nav-14) | **עוד** |
| **manager** | **בית** (today) | **הזמנות** (badge = cut-offs closing today) | **קבלה** (badge = deliveries today, warn when late) | **אישורים** (₪ badge, danger dot only for a block) | **עוד** |
| **owner** | **בית** | **אישורים** (₪ badge) | **דליפה** | **הזמנות**; a chain owner gets **סניפים** instead | **עוד** |
| **bookkeeper** | **בית** | **אישורים** | **תשלומים** (the pay run) | **חשבוניות** | **עוד** |

- **Labels:** ≤7 characters, except "חשבוניות" (8). That label measures about 50 px at 12 px Heebo inside a 78 px slot, so it never truncates. "בית" is the same word in slot 1 for every role, with the same position and meaning; the page `h1` carries the role-specific title ("היום · 3 משלוחים").
- **Geometry:**
  - Height 64 px + `env(safe-area-inset-bottom)`; solid `surface` (no `glass`) with a 1 px `line` top border.
  - 5 equal slots. Icon 24 px. Label 12 px; weight 600 plus `aria-current="page"` when active.
  - The active indicator is a 56×28 `primary/12` pill behind the icon (the Material 3 active indicator).
  - The badge is an 8 px dot, or a pill at least 16 px tall with 12 px digits, at the icon's top inline-end corner.
- **Layout variable:** publish `--rm-bottomnav-h: calc(64px + env(safe-area-inset-bottom))` on `:root` and replace `pb-[calc(5rem+…)]` (`layout.tsx:120`). The consent bar keeps stacking above the bottom bar through `--consent-h`.
- **Hidden** on field routes (registry `field: true`): `receiving/[poId]`, `inventory/count`, `orders/new`, `orders/capture`. Those use their own sticky action bar and a ✕ at the top start (G1). Also hidden while the on-screen keyboard is open (`visualViewport.height` drops by more than 150 px), so the bar never rides on the keyboard.
- **Personalise:** "עוד → התאמת הסרגל" lets the user swap slots 2–4 among the role's allowed items. The choice is stored per device in `localStorage['rm:bar:<role>']`; device-level is the right scope for this.

### 4.3 "עוד" sheet (replaces the drawer)

- A bottom sheet at 85vh with a drag handle; Esc or swipe-down closes it and focus returns to "עוד".
- **Contents, in order:**
  1. The search field, which opens the palette.
  2. A collapsed branch row "סניף: X ▾", only with ≥2 memberships.
  3. The role's remaining registry items as a **2-column tile grid** (64 px tiles, icon, label and badge), grouped with the same headers as the desktop sidebar.
  4. פרופיל: language, 2FA and devices, help, accessibility statement, sign-out.
- Today the owner's drawer shows 7 of 18 links in a 349 px scroll region below a 270 px branch list (`crops-ia/drawer_owner_phone.png`). The sheet shows **all groups in the first screen** for every role (owner: 23 entries ≈ 12 tile rows, so 2 screens; manager: fewer).

---

## 5. Role homes: "what needs me now"

`/dashboard` stays the single home URL (bookmarks, PWA start, e-mails) and **renders by role**. `page.tsx` branches into `OwnerHome`, `ManagerHome`, `BookkeeperHome`, `ChefHome` and `ReceiverHome`. Each role answers its own 5-second question (D1; `ainative.md` P2). The page-level layout detail is in `area-command.md` BM-1..BM-4; this table is the contract.

| Role · main device | First viewport (390×844 and 1440×900), top to bottom | Data (existing procedures) | Zero state | Never shows |
|---|---|---|---|---|
| **Receiver** · phone | `h1` "היום · 3 משלוחים · 1 באיחור" → **next truck card** (supplier, window, items, one 56 px "התחלת קבלה" straight into the PO) → the rest of today as rows with status chips (צפוי / הגיע / התקבל / חלקי / באיחור) → "חשבונית בלי הזמנה" → the offline queue chip "2 ממתינות לשליחה" | `receiving.todayExpectations`, the PWA outbox | "אין משלוחים צפויים היום · המשלוח הבא: יום ב׳ 07:30 ירקות השרון" | the ₪ hero, the view toolbar, the approvals count |
| **Chef** · phone | the count tile (start or continue, progress ring "34/80", walk-in order) → **dishes over target** (dish, food-cost % vs target, cause ingredient with old ← new price) → suppliers whose cut-off is today (draft an order) | `inventory.current`, recipes alerts (`dishPriceAlert`), supplier `orderSchedule` | "כל המנות ביעד ✓ · ספירה הבאה: יום א׳" | the leak hero, approvals, the restaurant's sales figures |
| **Manager** · phone, desktop after close | **cut-offs** "ירקות השרון נסגרת 14:00 · כמו בפעם הקודמת" → deliveries today (expected, arrived, late) → "₪ ממתין לאישור שלך" (count + ₪, one verb) → open count → compact leak line | the supplier schedule, `receiving.todayExpectations`, `approvals.myQueue`, `inventory.current`, the leak hero | an inbox-zero line with the next cut-off time | the view toolbar on the phone |
| **Owner** · phone (push-driven) and desktop (weekly) | **compact T1 hero** (≤240 px on the phone: ₪760, 1.8% of food spend, aligned delta, completeness line) → **"מחכה לך" stack** (≤3 on the phone, a strip of ≤5 on desktop, at y≤330): חוסם תשלום ₪ · ממתין להחלטה ₪ · זיכויים לשליחה ₪ · ריצת תשלומים (day, ₪) · מספר הקצאה חסר ₪ → T3 "חזר החודש ₪1,267" → (desktop right rail) price alerts with ₪/month, dishes over target | `approvals.myQueue`, `recovery.summary`, `payRun.month`, `owner.vatAtRisk`, `priceAlerts.openCount`, `consolidated.coverage` | "הכול מטופל ✓ · 42 חשבוניות נבדקו · ₪0 בסיכון" (ainative P3) | the 914 px daily bar chart above the decisions (it moves to דליפה › מגמה) |
| **Bookkeeper** · desktop | **strip:** מנותב אליי ₪ · ריצת תשלומים (day, ₪, n) · סגירת אוק׳ 4/6 · ללא מספר הקצאה ₪ · נכנסות לבדיקה n → **close checklist** (auto-ticking) beside the **invoice index** (views: החודש · חריגות · ממתין לתשלום · ריכוז · ללא הקצאה) | `approvals.myQueue` (role-routed), `payRun.month`, `owner.vatAtRisk`, ingest `needs_review`, `consolidated.coverage`, exports last-run | "אוקטובר מוכן לסגירה ✓ · ייצוא" | the owner's leak hero as the first block |

- **Chain owner** (scope = all branches): the strip sums across branches with a per-branch split chip, and the hero row becomes the branch roll-up matrix (`exec-desktop.md` PT10; `area-chain.md`).
- **Platform admin:** the avatar menu gets "קונסולת פלטפורמה" → `/admin`, shown only when `isPlatformAdmin` is true.

---

## 6. לטיפולי: one per-viewer queue (the source for the home stack, bell, badges and app badge)

| Item type | Tier | Source | Who | Verb (names the ₪ effect) | Opens |
|---|---|---|---|---|---|
| Blocking discrepancy before payment | T2 danger | `approvals.myQueue` (severity block) | owner, manager, routed bookkeeper | "דחה ובקש זיכוי" / "אשר כפי שחויב" | L1 peek of the invoice |
| Warn discrepancy | T2 warn | `approvals.myQueue` | same | same | peek |
| Claims to send | T2 warn | `recovery` claims with no letter | owner, manager, bookkeeper | "שלח מכתב דרישה" | זיכויים › לשליחה (filtered by supplier) |
| Overdue claims | T2 warn | `recovery.summary` (ageing) | same | "תזכר ספק" | tracker row |
| Pay run due | T2 warn on the due day, otherwise T4 | `payRun.month` | owner, bookkeeper | "אשר ריצה" | ריצת תשלומים |
| Missing VAT allocation number ≥ threshold | T2 warn | `owner.vatAtRisk` | finance | "בקש מספר הקצאה" | invoice peek |
| Incoming docs needing review | T2 count | ingest `needs_review` | owner, manager, bookkeeper | "בדוק" | חשבוניות › נכנסות |
| Receiving mismatch while the driver is at the door | T2 danger | receiving (GR vs PO) | manager, owner | "פתח תעודת חריגה" | PO |
| Material price alert (≥3% and ≥₪50/month) | T2 warn; below that T4 info | `priceAlerts` | owner, manager | "בדוק מול חוזה" | חוזים ומחירים › התראות |
| Consolidated invoice pending its delivery notes | **T4 neutral** (never alarm) | `consolidated.coverage` | finance | — | invoice |

- **Ranking:** ₪ at stake × urgency (payment date, driver at the door, cut-off). Ties go to the oldest.
- **Scope switch:** "שלי / הכול".
- **Phase 1** renders the stack on the home and in the bell with no new route. **Phase 2** adds `/dashboard/queue` with J/K triage and the R-9 keys.
- **"Seen" state:** `localStorage` in the interim. A server `seen_at` column needs a schema change, so it is **human PR**. Delivery routing (push and WhatsApp) belongs to `outbox.ts`/`cron.ts`, so it is a **human-PR proposal** too.

---

## 7. Global search and the ⌘K palette

### 7.1 Entry points

- Desktop:
  - `Ctrl+K` / `⌘K`, bound on `KeyboardEvent.code === 'KeyK'` so it also works on a Hebrew layout.
  - `/` when no input is focused.
  - The sidebar field.
- Mobile: the 🔍 in the top bar and the search row in "עוד".
- Esc closes the palette and returns focus to the trigger (D4).

### 7.2 Layout

- **Desktop:** a modal 640 px wide and at most 480 px tall, placed 20% from the top, with a 48 px input and 40 px rows. The footer shows key hints: "↵ תצוגה מהירה · ⌘↵ מסך מלא · Esc סגירה".
- **Phone:** a full-screen sheet with the input pinned at the top, 56 px rows and the same sections.

### 7.3 Sections (fixed order) and behaviour

1. **מחכה לך:** the top 3 items from §6.
2. **מעבר אל:** every registry route the role can open, with aliases. For example `אש`/`approvals` → אישורים, `כרט`/`ledger`/`הנה״ח` → כרטסת ספקים, `קב` → קבלת סחורה.
3. **רשומות:**
   - suppliers, products, **invoices by number**, **POs by number and by supplier name for today**, and recipes;
   - each group is filtered by role, so the receiver gets invoices plus today's POs, and the chef gets recipes plus ingredients;
   - prefixes: `#` for document numbers, `@` for suppliers, `>` for actions;
   - a digits-only query also matches invoice and PO numbers and ₪ totals within ±₪1.
4. **פעולות:**
   - the list: הזמנה חדשה · צלם חשבונית · התחל ספירה · ריצת תשלומים · ייצוא חודש קודם · עבור לסניף חיפה · הזמנה מוואטסאפ · מנה חדשה;
   - each row shows its shortcut chip;
   - **an action that moves money opens its normal confirm screen; the palette never executes it** (Mercury Command).
5. **שאלו את RestoMatch:** unmatched text becomes "שאלו: <query>" → `/dashboard/ask?q=`. Shown only when `aiAssistant` is on.

**Speed:**
- At 0 characters the palette shows frecency recents (the last 20 picks, `localStorage` in try/catch) plus the needs-you items, with no network call.
- Local sections filter on every keystroke from 1 character, within one frame.
- Server records debounce at ≤150 ms (today 250 ms and a 2-character minimum) and keep stale results visible while fetching.

**Hebrew normalisation:** one shared `normalizeHe()` in `apps/web/lib/search/normalize.ts`, mirrored server-side in `search.global`. It handles:
- SI-1452 ↔ QWERTY wrong-layout input (`,bucv` → תנובה);
- final letters folded;
- geresh and gershayim ignored;
- niqqud stripped;
- `nameEn` and supplier aliases.

**Peek:** Enter on a record opens an L1 peek (480 px side sheet on desktop, 85vh sheet on the phone). ⌘↵ opens the full page (D6).

**Placeholder:** it says what the role can actually find. Receiver: "חיפוש חשבונית או משלוח של היום". Chef: "חיפוש מנה או מוצר". Finance roles: "חיפוש או פקודה".

**Files:**
- `search.tsx` becomes `CommandPalette.tsx`, keeping its combobox ARIA.
- `searchOptions.ts` gains `kind: 'screen' | 'action' | 'po' | 'recipe'`.
- `packages/api/src/routers/search.ts` gains POs and recipes, role-gated with the same procedure tiers. That needs **COVERAGE entries** (warden).

### 7.4 Bell (notification centre, desktop and phone)

- A popover of 360 px on desktop, or a sheet on the phone, listing the same items as §6 plus T3 news ("₪120 זוכו מתנובה"). Each item deep-links to the **exact card**, never the home (D9).
- "סמן הכול כנקרא" works in the interim through `localStorage`.
- On the phone, the PWA app badge (`navigator.setAppBadge`) uses the same count.
- Push delivery is a **human-PR proposal**.

### 7.5 Keyboard layer (desktop)

- **G-chords** within 1,000 ms, bound by `code`:

  | Chord | Destination |
  |---|---|
  | G H | בית |
  | G Q | לטיפולי |
  | G A | אישורים |
  | G I | חשבוניות |
  | G P | ריצת תשלומים |
  | G C | זיכויים |
  | G L | דליפה |
  | G O | הזמנות |
  | G R | קבלת סחורה |
  | G S | ספקים |
  | G B | רשת |

- `?` opens the cheat sheet (2 columns, "ניווט" / "בעמוד זה").
- `[` toggles the sidebar.
- Holding Alt for 600 ms overlays key hints.
- All keys are off while an input is focused (WCAG 2.1.4).
- Queue keys follow rubric R-9.
- Files: a new `apps/web/lib/hotkeys.ts` (registry-driven), plus `layout.tsx`.

---

## 8. Branch scope and the switcher

Two concepts, two controls:

| Concept | Who | Control | URL | Reload? |
|---|---|---|---|---|
| **Work as** a branch (the session's active membership, role and RLS context) | receiver, manager, chef, owner acting locally | scope chip / branch sheet → `switchBranchAction` | path kept | one full navigation **to the same page** (keeps the #418-safe pattern of `branch-actions.ts:43-47`) |
| **View** across branches (read-only roll-ups) | chain owner, chain bookkeeper | the chip's "כל הסניפים" / group entries | `?b=all\|<id>\|g:<id>` | none (client re-query) |

**Rules:**

1. **Keep the place on a switch.** `pick(id, then)` (`branch-switcher.tsx:75`) receives `then = branchSafeTarget(pathname, search)`:
   - a list or hub route keeps its path, plus the period and status filters `p from to cmp sev type st`;
   - **entity filters `sup` and `cat` are dropped**, because supplier and category ids are per-tenant;
   - a detail route (`[id]`) falls back to its registry `parent`, with a toast: "עברת לחיפה · פתחנו את <parent>";
   - a route the role can't open in the target branch lands on that branch's home, with a toast that says why.
2. **The current scope is always visible:** in the chip, in the context line of the page header ("חיפה · אוקטובר 1–25"), and in `<title>`.
3. **Deep links are branch-aware.** Every link that leaves the app (e-mail, WhatsApp, push, PDF, Ask citations, the supplier portal back-link) goes through **`/dashboard/go?r=<restaurantId>&to=<relative path>`**. The route handler:
   - re-checks membership with the same `chain.switchTarget` check;
   - updates the session (`unstable_update`, already validated by `lib/activeRestaurant.ts`);
   - validates `to` with `safeRelativePath`;
   - 303s to the target.
   - Non-members get the forbidden page (§10).
4. **A 404 for a multi-membership user** renders `app/dashboard/not-found.tsx` inside the shell (not the root 404). For a detail URL it asks a new `whereIs({ kind, id })` procedure, which looks up the id across the caller's memberships under per-membership RLS (warden gate, plus a COVERAGE entry). If the record exists in another branch it offers "החשבונית שייכת ל"כפר הזיתים" · פתח שם".
5. **`b=all` on money lists** (approvals, pay run, invoices, claims, ledger) adds a "סניף" column and a branch filter. Write actions run in the row's own tenant context. This is phase 3, **tenant-security-warden gate**; never widen `applyCoreTenantRls`.
6. **Chain drill:** every chain cell and KPI links to the filtered list with `b=<id>`, and the breadcrumb reads "רשת › ירושלים › אישורים". "כניסה" is renamed "פתח את התור של הסניף" (see `area-chain.md`).

Benchmarks: Toast "You are viewing"; R365 location groups; Vercel's scope switcher and Stripe's account switcher keep the current page [K]; Slack and Linear permalinks switch workspace before opening [K].

---

## 9. Breadcrumbs, back, titles: the `PageHeader` contract

### 9.1 One component for every page

`apps/web/lib/components/PageHeader.tsx` (server-safe) replaces the mix of `SectionHeader`, ad-hoc back links and `Breadcrumbs`:

```tsx
<PageHeader
  route="invoiceDetail"                 // registry key → parent chain, title, group
  title={invoice.number}                // h1 (level 1, always)
  entity={{ kind: 'invoice', supplier }} // context line: "דגי הים התיכון · 28.9.2026 · ‏1,123 ₪"
  status={<Badge tone="warn">מע״מ בסיכון</Badge>}
  from={searchParams.from}              // whitelisted origin crumb (see 9.2)
  primary={<Button>…</Button>}          // one primary
  overflow={[…]}                        // ⋯ menu
/>
```

### 9.2 Breadcrumb rules

- Render it when the registry depth is 2 or more: `parent › … › current`, at most 4 crumbs, separated by "›". The separator is the existing mirrored chevron (`Breadcrumbs.tsx`).
- Group names (כסף, רכש) are **not** crumbs, because they are not pages.
- **Origin crumb:** detail pages accept `?from=` from a whitelist (`approvals | payRun | ledger | invoices | incoming | breakdown | receiving | search`). The first crumb is then the list you came from, **with its filters restored**. The list URL is kept in `sessionStorage['rm:lastList:<routeKey>']`. Example: "ריצת תשלומים › דגי הים התיכון › MF-24950" instead of today's nothing (`area-approvals.md`).
- A crumb the role can't open renders as plain text (`canSeeRoute`). This removes the ledger → ספקים dead end for the bookkeeper and the receiver.
- **Phone:** the trail collapses to one up-link "‹ <parent>" (44 px) at the top start. **Field routes** use "✕" plus a leave guard instead (G1).

### 9.3 Title and `h1`

- `generateMetadata` on every route returns `${h1} · ${branchShort} — RestoMatch`. The branch appears only with ≥2 memberships. Detail pages use the entity: "MF-24950 · דגי הים התיכון — RestoMatch".
- This also restores Next's route announcement (§1.3).
- The registry test fails if a `page.tsx` has no title or no `h1` (`level={1}` on `receiving/page.tsx:44`, `inbox/page.tsx:43`, `team/page.tsx:22`, `settings/page.tsx`, `inventory/count`).

### 9.4 Vocabulary (nav label = `h1` short form = palette alias = bottom-bar label)

| Concept | Today (nav / h1 / elsewhere) | Canonical he | Bottom bar | en |
|---|---|---|---|---|
| Home | סקירה / חדר הבקרה | **בית** (`h1` per role: "חדר הבקרה" for the owner, "היום" for the receiver) | בית | Home |
| Goods receipt | קליטת סחורה / (none) / **קבלת סחורה** in marketing, the PWA name and 9 message files / "קלוט סחורה" on the CTA | **קבלת סחורה** (verb: "קבלת משלוח") | קבלה | Receiving |
| Approvals | תור אישורים | **אישורים** | אישורים | Approvals |
| Ingested documents | תיבת חשבוניות | **נכנסות** (a tab of חשבוניות) | — | Incoming |
| Leak | בלש דליפות / בלש הדליפות | **דליפה** (hub); the detective table becomes the "מגמה" tab | דליפה | Leak |
| Claims + recovery | (orphan) / ₪ חוזר / מעקב ₪ חוזר | **זיכויים** (tabs: לשליחה · מעקב ₪ חוזר) | — | Credits |
| Exports | ייצוא / ייצואים להנהלת חשבונות | **סגירת חודש וייצוא** | — | Close & export |
| Catalog | קטלוג / חיפוש מאוחד בקטלוג | **קטלוג** | — | Catalog |
| Chain | רשת / דאשבורד רשתי | **סקירת רשת** | סניפים | Chain |
| Contracts | חוזים והתראות / חוזים והתראות מחיר | **חוזים ומחירים** | — | Contracts & prices |

Copy owner: the `nav` and per-page i18n namespaces (`lib/i18n/messages/nav/he.ts` and siblings). Marketing copy already says "קבלת סחורה", so the app aligns to it.

---

## 10. Permissions, flags, errors and deep links

1. **Forbidden.** `middleware.ts:81-91` **rewrites** (not redirects) to `/dashboard/forbidden?from=<path>` with status 403, rendered inside the shell as a T4 card:
   - "המסך ‘ריצת תשלומים’ זמין לבעלים, מנהל/ת וחשב/ת. נכנסתם כ־שף."
   - [בקשו גישה מ־<owner name>]: a prefilled WhatsApp or e-mail message with the link;
   - [חזרה לבית];
   - when another membership allows the route: [פתחו ב־<branch> (בעלים)].

   No warn tone (T4 calm). This also replaces the warn-tone "owner only" cards on `/leaks` and `leaks/report` (ia-map §4.8).
2. **Flag-off.** One behaviour: `notFound()` renders `app/dashboard/not-found.tsx` **inside the shell**, with the nav kept. Today the root `app/not-found.tsx` drops the shell. A closed entitlement keeps `<EntitlementUpsell>`. The pay-run "disabled" empty state and the silent tab fallbacks on the supplier hub align to this.
3. **Errors and loading.** Add `app/dashboard/error.tsx`, which keeps the shell and offers "נסה שוב" plus "חזרה ל<parent>". Add `loading.tsx` skeletons for the registry hubs (today only 5 of 43 routes have one).
4. **Help and accessibility.** "עזרה · הצהרת נגישות · צור קשר" sit in the same place on every shell: the sidebar footer, the "עוד" sheet, the auth card footer, the supplier portal and the receiver PWA (WCAG 3.2.6, IS 5568, rubric F1). The `/accessibility` page itself belongs to `growth-pmm-engineer`.
5. **Deep-link contract.** Every outbound link is `/dashboard/go?r=<restaurantId>&to=<path>` and points at the **object**:
   - approval → `/dashboard/approvals?sel=<invoiceId>`
   - order reminder → `/dashboard/orders/new?supplierId=<id>&from=last`
   - delay → `/dashboard/receiving/<poId>`
   - claim → `/dashboard/claims?supplier=<id>`

   Fix now: `orders/new/page.tsx` accepts `supplier` as an alias of `supplierId`, and `orderReminders.ts:101` uses `supplierId`.
6. **`/scans/[invoiceId]`.** Today it is a full page outside the shell with no way back. It becomes an L1 viewer opened from the invoice page (✕ returns to the invoice). Add a `/scans` rule mirroring `/dashboard/invoices` (no chef), with a warden check.

---

## 11. Sitemap: old route → new place

Phase 1 changes **no URLs**: grouping, labels and hub tabs are rendered by layouts and a shared `HubTabs` component that links existing sibling routes. Phase 2 moves only the routes whose path contradicts the new hierarchy, with `permanent: true` (308) redirects in `next.config.ts` `redirects()`, new `ROUTE_ROLES` entries and an e2e test per redirect.

| # | Old route (today's entry) | New place (desktop sidebar › item › tab) | Canonical URL (phase) | Mobile | Notes |
|---|---|---|---|---|---|
| 1 | `/dashboard` (tab סקירה) | **בית** | `/dashboard` (renders by role, P1) | slot 1, every role | the owner's trend, heatmap, price creep and activity move to דליפה › סקירה/מגמה |
| 2 | — (new) | **לטיפולי** | `/dashboard/queue` (P2) | bell + home stack | §6 |
| 3 | `/dashboard/approvals` (tab תור אישורים) | כסף › אישורים | keep | owner 2, manager 4, bookkeeper 2 | ₪ badge; `?sel=` peek |
| 4 | `/dashboard/approvals/pay-run` (button only) | כסף › ריצת תשלומים | keep | bookkeeper 3 | badge = due day |
| 5 | — (new) | כסף › חשבוניות (הכול · נכנסות · ריכוז · ללא הקצאה) | `/dashboard/invoices` (P2) | bookkeeper 4 | new list procedure + COVERAGE |
| 6 | `/dashboard/inbox` (tab תיבת חשבוניות) | כסף › חשבוניות › נכנסות | P1 keep; P2 308 → `/dashboard/invoices?tab=incoming` | via חשבוניות | badge = needs_review |
| 7 | `/dashboard/invoices/[invoiceId]` (row links) | detail under חשבוניות | keep | — | `from=` origin crumb |
| 8 | `/scans/[invoiceId]` (outside the shell) | L1 viewer from the invoice | keep | sheet | ✕ back; `/scans` role rule |
| 9 | `/dashboard/leaks/claims` (orphan) | כסף › זיכויים › לשליחה | P2 308 → `/dashboard/claims` | עוד | ₪ badge |
| 10 | `/dashboard/recovery` (tab ₪ חוזר) | כסף › זיכויים › מעקב ₪ חוזר | P2 308 → `/dashboard/claims/tracker` | עוד | T3 gold |
| 11 | `/dashboard/suppliers/ledger` (orphan) | כסף › כרטסת ספקים | keep (role-safe crumb) | עוד (receiver too) | first path for bookkeeper and receiver |
| 12 | `/dashboard/exports` (tab ייצוא) | כסף › סגירת חודש וייצוא | keep (label + checklist) | — | `exec-desktop.md` P21 |
| 13 | `/dashboard/leaks` (tab בלש דליפות) | דליפות › דליפה › סקירה (+ מגמה = detective table) | keep | owner 3 | `leaks/layout.tsx` tabs |
| 14 | `/dashboard/leaks/breakdown` (hero link) | דליפות › דליפה › פירוק | keep | tab | — |
| 15 | `/dashboard/leaks/proof` (hero link) | דליפות › דליפה › הוכחה | keep | tab | — |
| 16 | `/dashboard/leaks/report` (link) | דליפות › דוחות › דוח דליפות A4 | keep | tab | fix the bookkeeper role mismatch |
| 17 | `/dashboard/reports/monthly` (tab דוח חודשי) | דליפות › דוחות › הדוח החודשי | keep | tab | `area-command.md` BM-5 merges digest |
| 18 | `/dashboard/reports/digest` (orphan) | דליפות › דוחות › תצוגת מייל | P2 308 → `/dashboard/reports/monthly?view=email` | tab | — |
| 19 | `/dashboard/ask` (tab, drawer-only on mobile) | דליפות › שאלו + **⌘K fallback** | keep | palette | `?q=` |
| 20 | `/dashboard/contracts` (tab חוזים והתראות) | רכש › חוזים ומחירים | keep | עוד | material alerts → לטיפולי |
| 21 | `/dashboard/contracts/import` (button) | action in חוזים ומחירים + palette | keep | — | hidden for the bookkeeper (`canManage`) |
| 22 | `/dashboard/orders` (tab הזמנות) | רכש › הזמנות | keep | manager 2, owner 4 | cut-off badge |
| 23 | `/dashboard/orders/new` (button) | action "הזמנה חדשה" (page CTA, palette, home cut-off rows) | keep (+ `supplier` alias) | **field mode** | chef draft mode (ia-nav-14) |
| 24 | `/dashboard/orders/capture` (button) | action "הזמנה מוואטסאפ" | keep | field mode; share target (manager) | — |
| 25 | `/dashboard/orders/[poId]` (row) | detail under הזמנות | keep | — | crumb "הזמנות › PO", not via the supplier hub |
| 26 | `/dashboard/receiving` (tab קליטת סחורה) | רכש › קבלת סחורה (desktop: today's review table) | keep | receiver = home; manager 3 | label → קבלת סחורה |
| 27 | `/dashboard/receiving/[poId]` (card) | field task | keep | **field mode** | ✕ + leave guard |
| 28 | `/dashboard/receiving/share` (route) | share target | keep; **POST multipart + role routing** | — | receiver → invoice capture |
| 29 | `/dashboard/suppliers` (tab ספקים) | רכש › ספקים | keep | עוד | — |
| 30 | `/dashboard/suppliers/[id]` (row) | detail (tabs) | keep | — | — |
| 31 | `/dashboard/suppliers/[id]/leak-card` (tab button) | print view under the supplier | keep | — | — |
| 32 | `/dashboard/catalog` (tab קטלוג) | רכש › קטלוג › חיפוש | keep | עוד | — |
| 33 | `/dashboard/catalog/import` (button) | action | keep | — | — |
| 34 | `/dashboard/catalog/mapping` (button) | רכש › קטלוג › מיפוי מק״טים | keep | — | badge = unmapped count |
| 35 | `/dashboard/products` (button) | רכש › קטלוג › שמות באנגלית | keep | — | — |
| 36 | `/dashboard/products/[productId]` (search, rows) | detail under קטלוג | keep | — | — |
| 37 | `/dashboard/recipes` (tab עלות מנה) | מטבח › עלות מנה | keep | chef 3 "מנות" | — |
| 38 | `/dashboard/recipes/new` (button) | action "מנה חדשה" | keep | — | — |
| 39 | `/dashboard/recipes/[recipeId]` (row) | detail | keep | — | — |
| 40 | `/dashboard/inventory` (tab ספירת מלאי) | מטבח › ספירת מלאי | keep | chef 2 "ספירה" | — |
| 41 | `/dashboard/inventory/count` (button) | field task / action "התחל ספירה" | keep | **field mode** | — |
| 42 | `/dashboard/inventory/[countId]` (row) | detail | keep | — | — |
| 43 | `/dashboard/chain` (tab רשת, owner >1) | רשת › סקירת רשת | keep | chain owner 4 "סניפים" | every cell links |
| 44 | `/dashboard/branches` (tab סניפים / footer) | רשת › סניפים (single-branch: ניהול › סניפים) | keep | עוד | — |
| 45 | `/dashboard/team` (tab צוות) | ניהול › צוות | keep | עוד | — |
| 46 | `/dashboard/integrations` (orphan) | ניהול › אינטגרציות | keep | עוד | first nav entry |
| 47 | `/dashboard/settings` (tab הגדרות) | avatar › הגדרות אישיות + ניהול › הגדרות מסעדה | keep, with `?tab=me\|restaurant\|matching\|privacy` | עוד › פרופיל | removes Settings from the receiver and chef bars |
| 48 | — (new) | forbidden page | `/dashboard/forbidden` (P1, rewrite target) | — | §10.1 |
| 49 | — (new) | deep-link resolver | `/dashboard/go` (P1, route handler) | — | §8.3 |
| 50 | `/admin`, `/admin/leads`, `/admin/restaurants/[id]` | admin shell | keep | — | ia-nav-24 |

**Accept:**
- 0 orphans.
- Every allowed non-detail route is reachable in ≤2 interactions for each role, and every detail route is reached from a list row or ⌘K.
- Every old URL still works (200 or 308).

---

## 12. Implementation plan (files, owners, phases, acceptance)

### 12.1 The registry

```ts
// apps/web/lib/nav/registry.ts
export type GroupKey = 'top' | 'money' | 'leaks' | 'procure' | 'kitchen' | 'chain' | 'admin';
export interface RouteDef {
  key: RouteKey;                      // 'approvals'
  path: string;                       // '/dashboard/approvals'
  group: GroupKey;
  parent?: RouteKey;                  // breadcrumb, up-link, branch-switch fallback
  roles: UserRole[];                  // ROUTE_ROLES is generated from this
  flags?: { anyOf?: FeatureKey[] };   // nav visibility = flag gate (pages still 404 when off)
  entitlement?: 'advanced_analytics' | 'chain' | 'accounting_export';
  label: string; short?: string;      // i18n keys; short ≤7 chars for the bar
  aliases: string[];                  // palette: ['אש','אישורים','approvals']
  icon: LucideIcon;
  badge?: 'approvals' | 'incoming' | 'claims' | 'receivingToday' | 'payRun' | 'priceAlerts' | 'outbox' | 'count' | 'dishes' | 'cutoffs';
  bar?: Partial<Record<UserRole, 1 | 2 | 3 | 4>>;
  field?: boolean;                    // focus mode: no bottom bar
  nav?: 'item' | 'tab' | 'action' | 'detail';
  shortcut?: string;                  // 'G A'
  tabsOf?: RouteKey;                  // renders as a tab of a hub
}
```

**Consumers:**
- `nav.tsx` (`Sidebar`, `BottomBar`, `MoreSheet`)
- `CommandPalette.tsx`
- `PageHeader.tsx`
- `HubTabs.tsx`
- `generateMetadata` helper `titleFor(routeKey, …)`
- `lib/roles.ts` (`ROUTE_ROLES = fromRegistry()`, keeping `canSeeRoute` and `allowedRolesForPath` as is)
- `middleware.ts` (unchanged API)
- `hotkeys.ts`

**Tests** (`test-sentinel`):
1. Every `page.tsx` has a registry entry.
2. Route × role reachability (≤2 interactions, no link to a forbidden route).
3. Every entry has a title, an `h1` and a non-truncating `short` label at 12 px.
4. Redirect map e2e.
5. Bar slots are unique per role.

### 12.2 Phases

| Phase | Ships | Main files | Accept |
|---|---|---|---|
| **1 (S–M, no schema, no immutables)** | registry; sidebar + 56 px top bar + fluid container; role bottom bars + עוד sheet; PageHeader + titles + `h1`; forbidden rewrite + in-shell 404/error; branch switch keeps path; `/dashboard/go`; `orders/new?supplier` alias; field-mode bar hiding; badges (`nav.badges`); help/accessibility footer | `lib/nav/registry.ts`, `app/dashboard/nav.tsx`, `layout.tsx`, `branch-switcher.tsx`, `middleware.ts`, `lib/components/PageHeader.tsx`, `app/dashboard/{not-found,error,forbidden}`, `app/dashboard/go/route.ts`, `orders/new/page.tsx`, `apps/worker/src/jobs/{orderReminders,matchInvoice,endOfDayReport}.ts` (links only) | top bar ≤56 px; 0 wrapped nav rows; Ctrl+K opens in ≤100 ms; every page has a unique title; 0 silent bounces; switching on `/approvals?sev=block` stays there |
| **2 (M)** | role homes (with `area-command`); ⌘K palette with records + actions + Ask; keyboard layer; hub tabs (דליפה, דוחות, זיכויים, קטלוג); invoice index; `/dashboard/queue`; PWA scope, shortcuts and file share target; chef order drafts | `app/dashboard/page.tsx` (+ role home components), `CommandPalette.tsx`, `lib/hotkeys.ts`, `packages/api/src/routers/{search,orders,invoices}.ts` + COVERAGE, `public/pwa/manifest.webmanifest`, `receiving/share/route.ts`, `lib/pwa/ReceiverPwa.tsx` | receiver: app open → camera in ≤2 taps; manager: bar → new order in 1 tap; bookkeeper: ledger in 1 click; "אש" → אישורים first result |
| **3 (M, warden gate)** | scope `b=all` on money lists; `whereIs` for cross-branch 404s; favorites/pins (`localStorage`) | money list routers + COVERAGE; `branch-switcher.tsx` | scope change fires no document navigation; totals = Σ rows |
| **4 (human PR)** | server-side saved views and role defaults (schema); `seen_at` (schema); push/WhatsApp routing and quiet hours (`outbox.ts`, `cron.ts`); compact ₪ in badges if wanted (`formatIls`) | `packages/db/src/schema.ts` + migration, `notifications/outbox.ts`, `apps/worker/src/cron.ts` | proposals only |

### 12.3 Governance (AGENTS.md)

- **Owners:**
  - `web-feature-engineer`: shell, nav, palette, PageHeader, middleware, role homes, routers.
  - `rtl-design-steward`: sidebar and bar tokens, the active indicator, density and the solid surface.
  - `growth-pmm-engineer`: the `/accessibility` page and help copy.
  - `test-sentinel`: the registry tests and e2e.
  - `tenant-security-warden`: the gate on `/dashboard/go`, `whereIs`, `b=all`, the search additions, chef drafts and the `/scans` rule.
- **Not touched:** `leads.ts`, `api/trpc/[trpc]/route.ts`, `rateLimit.ts`, `rls.ts`, `approvals/engine.ts`, `outbox.ts`, `cron.ts` and `formatIls`.
- **COVERAGE:** entries are **added** for every new procedure: `nav.badges`, `search` additions, `invoices.list`, `whereIs`, `orders.createDraft` for the chef.

---

## 13. Findings

Severity: P0 blocks or misleads a core task, or loses money or trust · P1 major friction or below benchmark · P2 polish · P3 nit.

| ID | Sev | Kind | Device | Title |
|---|---|---|---|---|
| ia-nav-01 | P0 | flow | both | Every role lands on the owner's ₪ control room; there are no role homes |
| ia-nav-02 | P1 | ia | desktop | An 18-tab, 2-row wrapping strip; 152 px of chrome; content capped at 1,152 px |
| ia-nav-03 | P1 | ia | mobile | The bottom bar is "first 4 in array order": no Orders, Settings wasting slots, 11 px labels, no badges |
| ia-nav-04 | P1 | functional | both | No ⌘K or command palette; search is entity-only and promises results the role can't get |
| ia-nav-05 | P1 | a11y | both | Every tab is titled "RestoMatch", 5 pages have no `h1`, and route changes are never announced |
| ia-nav-06 | P1 | ia | both | Reachability holes: the ledger is unreachable for the bookkeeper and receiver; 17 orphan routes; no single nav source |
| ia-nav-07 | P1 | flow | both | Silent bounces on forbidden links; flag-off and 404 drop the shell; warn-tone "owner only" cards |
| ia-nav-08 | P1 | functional | both | A branch switch resets to the home and drops filters; cross-branch links 404 outside the shell |
| ia-nav-09 | P1 | functional | both | Broken and imprecise notification deep links (`?supplier=` vs `supplierId`; queue root; no branch) |
| ia-nav-10 | P1 | functional | mobile | PWA scope, `start_url` and share target are wrong for the roles that use them |
| ia-nav-11 | P1 | flow | mobile | Global chrome stays inside the field task flows (no focus mode) |
| ia-nav-12 | P1 | ia | both | The money pipeline and the leak story are scattered over 3 groups and 13 URLs |
| ia-nav-13 | P1 | functional | desktop | No invoice index; two different "inboxes" |
| ia-nav-14 | P1 | functional | mobile | The chef cannot draft an order (role × route gap) |
| ia-nav-15 | P2 | ia | both | Three wayfinding patterns; 7 pages with no way up; crumbs to forbidden parents |
| ia-nav-16 | P2 | copy | both | Vocabulary drift between nav, `h1`, PWA and marketing |
| ia-nav-17 | P2 | states | both | Only contracts has a badge; the queues people act on have none |
| ia-nav-18 | P2 | ia | mobile | The phone top bar spends space on the email and language; the drawer is flat and deep |
| ia-nav-19 | P2 | functional | both | No bell or notification centre; activity sits at the bottom of the home |
| ia-nav-20 | P1 | a11y | both | No consistent help, accessibility-statement or contact entry in the app shell |
| ia-nav-21 | P2 | flow | desktop | No keyboard layer (G-chords, `?`, sidebar toggle) |
| ia-nav-22 | P2 | ia | both | Saved views live per browser; no favorites or pins |
| ia-nav-23 | P2 | ia | both | `/scans/[id]` sits outside the shell with no way back, and the chef can open it |
| ia-nav-24 | P3 | ia | desktop | Admin shell semantics and its entry point |

### ia-nav-01 · P0 · flow · both · Every role lands on the owner's ₪ control room
- **Evidence:**
  - [Probe] the landing is `/dashboard` for all 5 roles.
  - [Shot] `dashboard__receiver__phone-he.png` shows "חדר הבקרה", the view toolbar, a ₪760 hero and "4 ממתינות לאישור", which the receiver can't act on. `dashboard__chef__phone-he.png` is the same.
  - [Code] `app/dashboard/page.tsx:59` ("the hero is for every role"); the pending card at `:259-268` is rendered unlinked for roles that can't decide.
- **Problem:** The receiver's job (today's trucks) is 1 tap away and the chef's (count, dishes) is 1–2 taps away. Both see the restaurant's leak and spend first, which is noise for them and an exposure the owner may not want. D1 fails for 3 of 5 roles.
- **Recommendation:** `/dashboard` renders by role (§5 table). `ReceiverHome` reuses the receiving list with a next-truck card and "חשבונית בלי הזמנה". `ChefHome` shows count, dishes and cut-offs. `ManagerHome` shows cut-offs, deliveries and ₪ awaiting. `BookkeeperHome` shows strip, checklist and index. The owner gets the compact hero plus "מחכה לך". The view toolbar never renders for receiver or chef.
- **Exemplar:** Linear (Inbox / My issues as home); Ramp Home task feed; Apicbase mobile home (Count · Waste · Receive); Shopify POS smart grid.
- **Effort:** M · **humanPR:** no.

### ia-nav-02 · P1 · ia · desktop · Two-row tab strip, 152 px of chrome, 1,152 px column
- **Evidence:**
  - [Probe] owner and manager `headerH` 152, `navRows` 2, 18/16 items; `mainW` 1,152 at 1440.
  - [Shot] `crops-ia/owner_desk_he_header.png`, `owner_desk_en_header.png`.
  - [Code] `nav.tsx:168-174` (the comment admits the wrap), `:191`, `:198` (`flex-wrap`); `layout.tsx:123,175` (`max-w-6xl`).
- **Problem:**
  - Operations mixes act-now items (receiving, approvals, inbox) with reports, Ask and chain, so there is no order by job.
  - The second row starts mid-screen with no hierarchy.
  - 17% of a 900 px screen is chrome before content, and 288 px of width sits unused at 1440 (768 px at 1920).
- **Recommendation:**
  - The §3 sidebar: 248/64 px on the inline-start side, 6 groups plus בית and לטיפולי, live badges, `[` toggle and collapsible groups.
  - A 56 px top bar with breadcrumb, period chip, bell and avatar.
  - A fluid container up to 1,600 px.
- **Exemplar:** Linear sidebar; Ramp and Stripe left nav with pinned items; Mercury (Tasks with a count on top).
- **Effort:** M · **humanPR:** no.

### ia-nav-03 · P1 · ia · mobile · Mechanical bottom bar
- **Evidence:**
  - [Probe] Every bar is 53 px tall with 11 px labels on `rgba(255,255,255,.82)` glass and 0 badges.
  - Manager and owner: סקירה · קליטת סחורה · תור אישורים · בלש דליפות. **No Orders**, so ordering takes עוד → scroll → הזמנות.
  - Chef: …הגדרות. Receiver: …הגדרות. Settings takes a slot, and "עוד" lists only items that are already on the bar.
  - [Code] `nav.tsx:269-278` (`slice(0,4)` + leaks pin), `:421`, `:432`.
  - [Shot] `crops-ia/*_phone_mid.png`.
- **Problem:** The bar is the most-used control in the product, and it reflects array order instead of jobs. Active is shown by colour and weight only, nothing shows urgency, and the glass lets the hero ₪ show through behind the labels.
- **Recommendation:** The §4.2 role table:
  - 64 px + safe area, solid surface, 12 px labels;
  - a 56×28 active pill, `aria-current` and weight 600;
  - badges from `nav.badges`;
  - "בית" in slot 1 for every role;
  - slots 2–4 personalisable per device;
  - `--rm-bottomnav-h` published on `:root`.
- **Exemplar:** Material 3 navigation bar (active indicator, badges, 3–5 destinations); MarketMan mobile (Order · Receive · Count); Toast Now.
- **Effort:** S · **humanPR:** no.

### ia-nav-04 · P1 · functional · both · No command palette; search is entity-only and lies by role
- **Evidence:**
  - [Probe] `Ctrl+K` leaves focus on `BODY`, and `/` leaves it on `MAIN`.
  - "אישורים" → "לא נמצאו תוצאות" for every role.
  - "דגי" → no results for the bookkeeper, chef and receiver, while the placeholder still says "חיפוש ספקים, מוצרים, חשבוניות…".
  - The chef gets nothing for any query.
  - [Code] `search.tsx:51` (250 ms), `:55` (2 characters), with no document key listener; `searchOptions.ts:28-64`.
- **Problem:** With 43 routes and 17 orphans, the only global finder can't find screens, actions, POs or recipes. Ask is drawer-only on the phone.
- **Recommendation:** The §7 palette:
  - sections Needs-you → Go to → Records → Actions → Ask;
  - `normalizeHe()`, `#`/`@`/`>` prefixes and frecency recents;
  - L1 peek on Enter, ⌘↵ for the full page;
  - role-true placeholders;
  - a top-bar 🔍 on the phone;
  - search gains POs and recipes (COVERAGE).
- **Exemplar:** Linear ⌘K; Superhuman Command; Raycast (aliases, fallback); Mercury Command (stages money actions).
- **Effort:** M · **humanPR:** no.

### ia-nav-05 · P1 · a11y · both · One title for every page, missing `h1`s, silent route changes
- **Evidence:**
  - [Probe + crawl] `document.title` = "RestoMatch" on all 156 dashboard captures.
  - `h1` is empty on `/receiving`, `/inbox`, `/team`, `/settings` and `/inventory/count`.
  - [Code] `app/layout.tsx:22-33` is the only `title`; `receiving/page.tsx:44`, `inbox/page.tsx:43` and `team/page.tsx:22` use `SectionHeader` without `level`.
  - Next's `app-router-announcer.js:54-67` announces only when `document.title` changes.
- **Problem:**
  - WCAG 2.4.2 (Page Titled) fails, and 4.1.3 status is lost on navigation.
  - A desktop boss with 6 tabs open sees 6 identical tabs, and browser history is useless.
  - Screen-reader users get no feedback when a page changes.
- **Recommendation:**
  - `generateMetadata` per route via `titleFor()`: "h1 · branch — RestoMatch", with entity titles on detail pages.
  - `PageHeader` always renders `h1`.
  - A registry test fails a page without a title or an `h1`.
- **Exemplar:** Linear tab titles ("ENG-123 Title"); Stripe ("Payments – Stripe"); GOV.UK page-title pattern.
- **Effort:** S · **humanPR:** no.

### ia-nav-06 · P1 · ia · both · Reachability holes and no single nav source
- **Evidence:** §1.2.
  - The bookkeeper and receiver are allowed on `/suppliers/ledger` (`roles.ts:65`) but have no link to it. Its breadcrumb (`ledger/page.tsx:30-33`) and rows point at `/dashboard/suppliers*`, which bounces them.
  - The owner has 17 allowed routes outside the nav. Pay run is behind a button on approvals, and integrations behind buttons on catalog and exports.
  - `NAV_ITEMS`, `ROUTE_ROLES`, `searchOptions`, the breadcrumbs and the PWA manifest each encode the IA separately.
- **Problem:** The bookkeeper's main tools are hidden or dead-ended, and every new page adds another orphan because nothing checks it.
- **Recommendation:**
  - `lib/nav/registry.ts` (§12.1) generates `ROUTE_ROLES`, the nav, the palette, the crumbs and the titles.
  - A CI test asserts that every allowed non-detail route is reachable in ≤2 interactions per role, and that no rendered link targets a route the viewer can't open.
- **Exemplar:** Shopify admin (every app reachable from nav or search); `exec-desktop.md` P9 CI orphan check.
- **Effort:** M · **humanPR:** no.

### ia-nav-07 · P1 · flow · both · Silent bounces and shell-less error states
- **Evidence:**
  - [Probe] 24 forbidden visits across 4 roles all ended on `/dashboard` with no message, for example bookkeeper → `/dashboard/orders` and chef → `/dashboard/approvals/pay-run`.
  - [Code] `middleware.ts:81-91`; root `app/not-found.tsx` renders outside the shell; no `app/dashboard/not-found.tsx` or `error.tsx`; only 5 `loading.tsx` files.
  - A warn-tone "owner only" card appears on `/leaks` for managers and bookkeepers (ia-map §4.8).
- **Problem:** A link the owner shares with the bookkeeper "doesn't work" and nobody knows why. A flag-off page or a bad ID throws the user out of the app.
- **Recommendation:**
  - Rewrite forbidden routes to the in-shell T4 page (§10.1) with "בקשו גישה מ…" and "פתחו ב-<branch>".
  - Add `app/dashboard/not-found.tsx` and `error.tsx` inside the shell.
  - Replace the warn-tone role cards with the same T4 component.
- **Exemplar:** Google Drive and Figma "request access"; Notion "No access to this page".
- **Effort:** S · **humanPR:** no.

### ia-nav-08 · P1 · functional · both · Branch switch resets, cross-branch links break
- **Evidence:**
  - [Probe] switching to Haifa from `/dashboard/approvals?sev=block` lands on `/dashboard` and loses the filter.
  - The home branch's invoice URL then renders the root 404 with no nav (`crops-ia/cross_branch_invoice.png`).
  - [Code] `branch-switcher.tsx:75,84`; `branch-actions.ts:33-49`.
  - Chain "כניסה" lands on the branch home (`area-chain.md`).
- **Problem:** A chain owner comparing the same queue across 3 branches pays 2 clicks and a reload per hop and has to re-filter. A shared link to another branch's invoice looks like the data is gone.
- **Recommendation:** §8:
  - `branchSafeTarget()` keeps the path and the non-entity filters, and detail pages fall back to their parent;
  - the context line and title name the branch;
  - `/dashboard/go?r=` resolves deep links;
  - the in-shell 404 asks `whereIs` and offers "פתח שם";
  - phase 3 adds `b=all` on money lists (warden).
- **Exemplar:** Toast "You are viewing"; R365 location groups; Vercel and Stripe switchers keep the page [K]; Slack and Linear permalinks switch workspace [K].
- **Effort:** M · **humanPR:** no.

### ia-nav-09 · P1 · functional · both · Notification deep links are broken or imprecise
- **Evidence:**
  - [Code] `apps/worker/src/jobs/orderReminders.ts:101` builds `/dashboard/orders/new?supplier=<id>`, but `orders/new/page.tsx:10-13` reads only `supplierId`, so the cut-off reminder opens a blank wizard.
  - `matchInvoice.ts:241` and `endOfDayReport.ts:115` link to `/dashboard/approvals`, with no invoice and no restaurant.
- **Problem:**
  - Rubric D9: a reminder must land on the exact card.
  - For a multi-branch owner, the approval e-mail opens whichever branch is active, so the flagged item may not be in that queue at all. That reads as "already handled" on the step that blocks payment.
- **Recommendation:**
  - **Now:** accept `supplier` as an alias in `orders/new/page.tsx` and change the job to `supplierId`.
  - **Then:** every outbound link uses `/dashboard/go?r=<restaurantId>&to=<object URL>` (§10.5):
    - approvals → `?sel=<invoiceId>`
    - claims → supplier filter
    - order reminder → `&from=last`
  - Template copy names one action and its ₪. Channel routing and quiet hours stay human-PR proposals (`outbox.ts`, `cron.ts`).
- **Exemplar:** Ramp approval e-mails open the exact bill; Linear notification links open the issue in the right workspace.
- **Effort:** S · **humanPR:** no (the job and template links are not on the immutability list; only channel and cadence changes are).

### ia-nav-10 · P1 · functional · mobile · PWA scope and share target don't fit the field roles
- **Evidence:**
  - [Code] `public/pwa/manifest.webmanifest` has `scope` and `start_url` `/dashboard/receiving`; the SW is registered with scope `/dashboard/receiving` (`ReceiverPwa.tsx:135`).
  - The receiver's own bar links to `/dashboard` and `/dashboard/settings`, and the flow opens `/dashboard/invoices/*`. All are out of scope, which shows browser UI in standalone mode [K].
  - `receiving/share/route.ts` takes text only and always redirects to `/dashboard/orders/capture`. The receiver role can't open that page, so it bounces home.
- **Problem:**
  - The installed app is the receiver's whole product, yet it breaks on its own navigation.
  - Sharing a WhatsApp invoice photo from the supplier, the most common back-door event, is impossible.
  - Owners and managers can't install approvals or ordering.
- **Recommendation:**
  - Manifest `scope: "/dashboard/"` and `start_url: "/dashboard?source=pwa"` (the role home). Keep `id` so existing installs survive.
  - Serve the SW with `Service-Worker-Allowed: /dashboard/` or move it under `/dashboard`.
  - `shortcuts`: צלם חשבונית · הזמנה חדשה · אישורים · ספירה.
  - `share_target`: `POST` multipart that accepts `image/*` and `application/pdf` as well as text, routed by role: receiver/manager + file → invoice capture without a PO; manager + text → order capture.
- **Exemplar:** Twitter/X and Starbucks PWAs (whole-app scope, shortcuts); WhatsApp → share sheet → AP inbox (Ramp receipts).
- **Effort:** M · **humanPR:** no.

### ia-nav-11 · P1 · flow · mobile · Global chrome inside field task flows
- **Evidence:**
  - [Shot] `dashboard_receiving_ID__receiver__phone-he.png`, `dashboard_orders_new__owner__phone-he.png`, `dashboard_inventory_count__owner__phone-he.png`: the bottom bar and the language picker stay on screen.
  - [Code] `nav.tsx:416-461` renders the bar on every route; `area-receiving.md` RCV-06 and `area-orders.md` orders-06 measure the CTAs under the bar.
- **Problem:** A stray tap on the bar mid-count or mid-delivery leaves the task. In-memory quantities are lost (G1 makes this S0 when data is lost), and the primary sits above an unrelated bar.
- **Recommendation:**
  - Registry `field: true` on `receiving/[poId]`, `inventory/count`, `orders/new` and `orders/capture`.
  - The layout drops the bottom bar and header extras on those routes and renders a task header: "✕" at the top start, step "2/5" and the title.
  - Add a leave guard and one 56 px sticky primary.
- **Exemplar:** Shopify POS and DoorDash full-screen task flows; Odoo Barcode.
- **Effort:** S · **humanPR:** no.

### ia-nav-12 · P1 · ia · both · The money pipeline and the leak story are scattered
- **Evidence:**
  - [Code] `nav.tsx:80-112`: approvals (תפעול) → pay run (orphan) → claims (orphan, under `/leaks`) → recovery (₪ חוזר, תפעול) → ledger (orphan, under suppliers) → exports (ניהול).
  - The leak story covers 8 routes under 3 tabs (בלש דליפות, ₪ חוזר, דוח חודשי) and 5 orphans (`exec-desktop.md` §2.1).
- **Problem:** Decide → pay → claim → recover is the North-Star loop, and nowhere does it appear in sequence. The owner can't tell the "דוח דליפות" from the "דוח חודשי".
- **Recommendation:**
  - The **כסף** group in pipeline order and the **דליפות** group with hub tabs (§3.3).
  - Phase 1 uses `HubTabs` with no URL change.
  - Phase 2 308s claims and recovery to `/dashboard/claims*` and digest to `reports/monthly?view=email` (§11).
- **Exemplar:** Ramp Bill Pay (inbox → approve → pay in one area); Mercury Insights (one page, tabs); R365 AP Center tabs.
- **Effort:** M · **humanPR:** no.

### ia-nav-13 · P1 · functional · desktop · No invoice index; two "inboxes"
- **Evidence:**
  - [Code] `app/dashboard/invoices/` holds only `[invoiceId]`. Invoices are reachable only from approvals, breakdown, pay run, ledger, search and the inbox.
  - "תיבת חשבוניות" (ingest) and "תור אישורים" (decisions) are both inboxes, with no all-invoices table between them.
- **Problem:** The bookkeeper's spine object has no list, so month-close work starts from search or another role's queue.
- **Recommendation:**
  - `/dashboard/invoices` as כסף › חשבוניות, with view tabs הכול · נכנסות (= ingest) · ריכוז · ללא מספר הקצאה.
  - Dense rows, a split pane to `[invoiceId]` and `?sel=`.
  - A new list procedure plus COVERAGE.
  - Details in `exec-desktop.md` P22 and `area-approvals.md`.
- **Exemplar:** Shopify order index with view tabs; R365 AP Center; Ramp Bills.
- **Effort:** L · **humanPR:** no.

### ia-nav-14 · P1 · functional · mobile · The chef cannot draft an order
- **Evidence:**
  - [Code] `lib/roles.ts:70` allows `/dashboard/orders` for owner and manager only; `orders.createDraft` is a `managerProcedure` (`packages/api/src/routers/orders.ts:447`).
  - [Probe] chef → `/dashboard/orders` bounces to the home.
- **Problem:** The chef sees what is missing in the walk-in during the count but has no way to put it on the order, so it goes to WhatsApp, outside the PO → GR → invoice match.
- **Recommendation:**
  - Add a chef **draft** mode: `orders.createDraft` moves to `chefProcedure` with `status='draft'` and `submittedBy`; only managers send.
  - Add a route rule so `/dashboard/orders/new` allows the chef.
  - Slot 4 "הזמנה" on the chef bar; the "שלח" CTA becomes "שלח למנהל/ת לאישור".
  - The manager's home lists "טיוטות מהמטבח (2)".
  - Warden check plus a COVERAGE entry.
- **Exemplar:** MarketMan and Choco (team drafts, manager approves); `ordering-mobile.md` P7 / PT13.
- **Effort:** M · **humanPR:** no.

### ia-nav-15 · P2 · ia · both · Three wayfinding patterns; 7 pages with no way up
- **Evidence:**
  - [Code + crawl] breadcrumbs on 10 pages, back links on 8, nothing on 7: `invoices/[id]`, `leaks/claims`, `recovery`, `reports/monthly`, `reports/digest`, `orders/new`, `orders/capture` and `ask`.
  - The `orders/[poId]` crumb runs through the supplier hub (`area-orders.md` orders-31).
  - The ledger crumb points to a forbidden parent.
- **Recommendation:** `PageHeader` (§9), with:
  - registry parents;
  - the `?from=` origin crumb with restored filters;
  - non-link crumbs when `!canSeeRoute`;
  - a single up-link on the phone;
  - ✕ on field routes.
- **Exemplar:** Stripe object pages (breadcrumb plus object header); Polaris Page `backAction`.
- **Effort:** M · **humanPR:** no.

### ia-nav-16 · P2 · copy · both · Vocabulary drift
- **Evidence:** §1.3 and §9.4:
  - nav "קליטת סחורה" vs "קבלת סחורה" in marketing, the PWA `name` and 9 message files vs the CTA "קלוט סחורה";
  - "סקירה" vs `h1` "חדר הבקרה";
  - "רשת" vs "דאשבורד רשתי";
  - "ייצוא" vs "ייצואים להנהלת חשבונות";
  - `/products` (`h1` "שמות באנגלית") lights "קטלוג".
- **Recommendation:** Adopt the §9.4 table. The nav label is the `h1` short form and the palette alias, and the bottom bar uses the `short` key.
- **Exemplar:** Stripe and Linear (the nav label equals the page title).
- **Effort:** S · **humanPR:** no.

### ia-nav-17 · P2 · states · both · Badges only on contracts
- **Evidence:** [Code] `NavBadge` returns null unless `itemKey === 'contracts'` (`nav.tsx:155-163`). [Probe] 0 badges on any phone bar.
- **Problem:** ₪296 awaiting approval (2 blocking), ₪464 in claims to send and today's 3 deliveries are invisible from the nav.
- **Recommendation:**
  - Add a `nav.badges` batched procedure covering approvals ₪ + block flag, incoming needs-review, claims ₪, pay-run due, receiving today/late, open count and dishes over target.
  - Render with the §3.2 and §4.2 rules: hidden at 0, "99+" cap, danger only with a block, and `aria-label` text such as "אישורים, 4 פריטים, ‏296 ₪ בסיכון".
  - Add a COVERAGE entry.
- **Exemplar:** Linear Inbox count; Mercury Tasks count; Material badges.
- **Effort:** M · **humanPR:** no.

### ia-nav-18 · P2 · ia · mobile · Phone top bar and drawer
- **Evidence:**
  - [Shot] `dashboard__receiver__phone-he.png`: the top bar shows "…ceiver@kfar-hazeitim.test" and a language select, with no search icon.
  - [Probe] the owner drawer shows 7 of 18 links in a 349 px region under a 270 px branch list, with "הזמנות" at y=1,008.
  - The branch footer link "דאשבורד רשתי" duplicates the "רשת" item.
- **Recommendation:**
  - The §4.1 top bar: a branch chip, then 🔍 and 🔔, with no email and the language picker shown only to the receiver.
  - The §4.3 "עוד" sheet: grouped 2-column tiles, the branch collapsed to one row, and a profile section.
- **Exemplar:** Ramp and Brex mobile (profile behind the avatar); iOS "More" grid.
- **Effort:** S · **humanPR:** no.

### ia-nav-19 · P2 · functional · both · No bell or notification centre
- **Evidence:** [Code] There is no notification UI in `layout.tsx` or `nav.tsx`. T2 events go only by e-mail (`functional-gaps.md` FG-21), and activity is at the bottom of the home (`dashboard__owner__desktop-he.png`, y≈3,170).
- **Recommendation:**
  - A bell (§7.4) reading the לטיפולי source, with exact-card deep links and the PWA app badge.
  - "Seen" in `localStorage` for now; a `seen_at` column is a schema change (human PR).
- **Exemplar:** Linear Inbox; Ramp notifications; GitHub bell.
- **Effort:** M · **humanPR:** no (UI); schema follow-up yes.

### ia-nav-20 · P1 · a11y · both · No consistent help or accessibility-statement entry in the app
- **Evidence:** [Code] `app/dashboard/layout.tsx`, `nav.tsx` and `settings/` contain no help, contact or accessibility link. There is no `/accessibility` route (`app/(marketing)/` holds about, cookies, pricing, privacy and terms only).
- **Problem:** WCAG 3.2.6 (Consistent Help) and the IS 5568 / Service Accessibility Regulations need the statement and a contact in a consistent place. Rubric F1 rates a missing statement S0; this lens owns its placement in every shell.
- **Recommendation:**
  - "עזרה · הצהרת נגישות · צור קשר" in the sidebar footer, the "עוד" sheet, the auth card footer, `/s/[token]` and the PWA.
  - The statement page belongs to `growth-pmm-engineer`; the coordinator's name is an owner decision.
- **Exemplar:** gov.il footer; Kol Zchut accessibility statement.
- **Effort:** S · **humanPR:** no.

### ia-nav-21 · P2 · flow · desktop · No keyboard layer
- **Evidence:** [Code] Global key handlers exist only in `products/names-grid.tsx`, the drawer and the switcher. There are no G-chords, no `?` and no sidebar toggle. Binding on `e.key` would also break on a Hebrew layout (G types "ע").
- **Recommendation:** §7.5. Add `lib/hotkeys.ts` driven by the registry `shortcut` field, bound by `KeyboardEvent.code`, off inside inputs, with an Alt-hold hint overlay and a `?` cheat sheet tested against the registry.
- **Exemplar:** Linear (G-chords, `?`); Shopify and Stripe `?`; Odoo Alt hints.
- **Effort:** S · **humanPR:** no.

### ia-nav-22 · P2 · ia · both · Views are per browser; no pins
- **Evidence:** [Code] `lib/components/views/savedViews.ts` stores at most 20 views under `rm:views:<page>` in `localStorage`. There are no favorites in the nav.
- **Problem:** An owner's "blocking · קצביית הכרם" view doesn't follow them to the phone or reach the bookkeeper.
- **Recommendation:**
  - **Interim:** pins in the sidebar "מועדפים" (≤7, `localStorage`) plus "העתק קישור" on every view.
  - **Then:** server-side views and role defaults, which need a new table and migration.
- **Exemplar:** Linear Favorites; Shopify pinned items and saved views.
- **Effort:** M · **humanPR:** yes (`packages/db/src/schema.ts` + migration for server views).

### ia-nav-23 · P2 · ia · both · `/scans/[id]` outside the shell with no way back
- **Evidence:** [Code] `app/scans/[invoiceId]/page.tsx` has a full-bleed stage and a "secure link" bar with an external link, but no back or close. It is not in `ROUTE_ROLES`, so the chef can open it (ia-map §4.16).
- **Recommendation:**
  - Open it as an L1 viewer from the invoice page, with ✕ returning to the invoice.
  - On a direct visit, show "‹ חזרה לחשבונית".
  - Mirror the invoices role rule (no chef) after a warden check.
- **Exemplar:** Ramp and Bill receipt viewer (overlay on the bill).
- **Effort:** S · **humanPR:** no.

### ia-nav-24 · P3 · ia · desktop · Admin shell semantics and entry point
- **Evidence:** [Code] `app/admin/layout.tsx`:
  - `<main>` wraps the `<header>`;
  - the `<nav>` has no `aria-label` and no `aria-current`;
  - there is no skip link and no mobile layout;
  - platform admins have no entry from the dashboard.
- **Recommendation:**
  - Use the same shell primitives (top bar + sidebar with 2 items) and landmarks.
  - Add "קונסולת פלטפורמה" to the avatar menu when `isPlatformAdmin`.
- **Effort:** S · **humanPR:** no.

---

## 14. Big moves

1. **The nav registry and `PageHeader` contract.** One file drives:
   - roles (`ROUTE_ROLES` generated from it), sidebar, bottom bars, "עוד", palette, hotkeys, crumbs, titles and redirects;
   - a CI test for reachability, titles and `h1`s.

   This is the foundation; every other move consumes it. Exemplar: Shopify admin and Linear (one route/command registry feeding nav and ⌘K). Device: both. Effort: M.
2. **Desktop work-surface shell:**
   - a right-side 6-group sidebar with live ₪ badges, a scope chip and ⌘K;
   - a 56 px top bar with breadcrumb, period, bell and avatar;
   - a fluid container up to 1,600 px;
   - collapsible groups and `[` rail mode.

   The owner gains 96 px of height on every screen, plus 40 px of width at 1440 and 448 px at 1920. Exemplar: Linear, Ramp, Mercury, Stripe. Device: desktop. Effort: M.
3. **Role homes + לטיפולי + role bottom bars:**
   - `/dashboard` renders 5 role homes;
   - one ranked per-viewer T2 queue feeds the home stack, the bell, the badges and the PWA app badge;
   - each role gets its own 64 px bottom bar, hidden in field flows.

   Exemplar: Ramp Home task feed, Linear Inbox, Apicbase and Shopify POS tiles, Material 3 nav bar. Device: both (mobile-first). Effort: L.
4. **⌘K go / find / do / ask with a keyboard layer:**
   - Hebrew-normalised, role-true records (invoices, POs, recipes), staged actions and an Ask fallback;
   - an L1 peek;
   - G-chords bound by `code`.

   Exemplar: Linear, Superhuman, Raycast, Mercury Command. Device: both. Effort: M.
5. **Branch-aware everything:**
   - a switch keeps the page;
   - the `/dashboard/go?r=` resolver handles every outbound link;
   - the in-shell 404 offers "בסניף אחר";
   - `b=all` on money lists comes behind a warden gate.

   Exemplar: Toast "You are viewing", R365 location groups, Vercel and Stripe scope switchers, Slack and Linear permalinks. Device: both (desktop-heavy). Effort: M.
6. **One money pipeline and one leak hub:**
   - כסף in decide → pay → claim → recover → close order, with an invoice index;
   - דליפות as one hub with tabs;
   - 308s for the 4 moved URLs;
   - field roles get a PWA covering `/dashboard/` with a role-routed file share target.

   Exemplar: Ramp Bill Pay, Mercury Insights, R365 AP Center. Device: both. Effort: L.
