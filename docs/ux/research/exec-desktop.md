# Executive desktop efficiency: UX research for RestoMatch (owner / bookkeeper / multi-branch)

> Owner direction (2026-10-25): benchmark the newest ERP and procurement tools. Most of the work happens on mobile
> (receiver at the back door, chef, floor manager ordering). The bosses (owner, bookkeeper, multi-branch owner) work
> on desktop, and the desktop has to be organized far more efficiently. Functionality matters, not only looks.
>
> This report covers the **desktop half** only. The mobile capture flows are in `ordering-mobile.md`. Queue keyboard
> mechanics and the three-pane approvals layout are in `erp-modern.md` §E (P18–P21). Money presentation and the "why
> flagged" panel are in `fintech.md`. This report cross-references those instead of repeating them, and adds what
> they do not cover:
> - the 5-second home
> - KPI → transaction drill depth
> - the information architecture (IA) for all 43 routes
> - branch scope and roll-up
> - saved and shared views
> - density
> - period comparison
> - export and scheduled sharing
> - the bookkeeper's month-close desk

---

## 0. Method and evidence levels

| Tag | Meaning |
|---|---|
| **[Code]** | Read in this repo at `/home/user/restomatch` (file paths given). |
| **[Shot]** | Measured on the lab screenshots at 1440 px wide (`scratchpad/ux/shots/*__desktop-he.png`) and on `scratchpad/ux/crawl-results.json` (page heights, load times). |
| **[Web]** | Confirmed in this session via WebSearch result summaries of the cited page. |
| **[Knowledge]** | From my prior knowledge of the product. **Not** re-verified in this session. |

**Limitation:**
- Direct page fetches were blocked by the egress proxy: `linear.app` and `support.ramp.com` returned CONNECT 403, and
  WebFetch got `ENOTFOUND`.
- Every [Web] claim below therefore rests on a search-engine summary of the cited URL, not on a full read of the page.
- Where a summary came from a third-party page, I say so.
- Screen-level details of Ramp, Mercury, Pigment, Mosaic and Runway that I could not confirm are marked [Knowledge] or
  left out.

---

## 1. Who sits at the desktop, and the one question each must answer in 5 seconds

| Persona (role in `lib/roles.ts`) | When on desktop | The 5-second question | What "done" looks like |
|---|---|---|---|
| **Owner** (`owner`), one branch | 07:00–09:00 at home or in the office, plus Sunday weekly review | "How much ₪ needs my decision now, and is this month's leak getting better or worse?" | Every blocking item decided, the pay run released, claims sent |
| **Bookkeeper** (`bookkeeper`), often external (רו״ח / הנהלת חשבונות) | Weekly, and in the first 10 days of the month for close | "What is left before I can close the month and export?" | Pay run approved, consolidated invoices cross-matched, allocation numbers in hand, export done |
| **Chain owner** (`owner` on 2+ branches, `showChain`) | Daily | "Which branch leaks most, why, and what is waiting in each branch?" | The worst branch is drilled into and its manager has a task |
| **Manager** (`manager`) | Mostly mobile. Desktop for orders, catalog and contracts | "What do I need to order, and which supplier prices rose?" | Out of scope here except in the IA |

Desktop is for **batch decisions over many rows**: approve, pay, claim, close, compare branches. Mobile is for
**capturing one event**: a delivery, a count, an order. The desktop should therefore never copy a mobile flow one to
one. For example, `receiving` on desktop should be a review table of today's deliveries, not the camera flow.

---

## 2. Current-state evidence: the desktop today

All measured at 1440×900, Hebrew, owner of "כפר הזיתים" (3 branches, all wave-1 flags on).

### 2.1 Navigation and IA [Code] [Shot]

- **43 `page.tsx` routes** under `apps/web/app/dashboard`. Only **18 appear in the nav** for a chain owner
  (`NAV_ITEMS` in `nav.tsx`: 19 items in 3 groups, `operations` 9 / `purchasing` 6 / `admin` 4, with chain and branches
  mutually exclusive).
- The desktop nav is a tab row that **wraps onto two lines** at 1440 px (the comment in `nav.tsx` admits it: "~17 tabs —
  wider than the max-w-6xl header at every viewport"). With the header, the sticky top area is **≈150 px** before any
  content.
- **Orphan routes:** money screens that are not in the nav and can only be reached through a button on another page:
  - `approvals/pay-run`: only via a button on `approvals`, and only when the flag is on
  - `leaks/breakdown`, `leaks/proof`, `leaks/report`, `leaks/claims`
  - `reports/digest`
  - `suppliers/ledger`: via the supplier detail → ledger tab → button, **4 clicks**
  - `integrations`: only via buttons on `catalog` and `exports`
- **The ₪ story is spread over 8 routes:** `leaks`, `leaks/breakdown`, `leaks/proof`, `leaks/report`, `leaks/claims`,
  `recovery`, `reports/monthly`, `reports/digest`. They are reached from 3 different nav tabs (בלש דליפות, ₪ חוזר,
  דוח חודשי).
- **No invoice index:** `dashboard/invoices/` contains only `[invoiceId]`. The bookkeeper has no "all invoices this
  month" table. Invoices are reachable only from approvals, breakdown, pay-run, ledger or search.

### 2.2 Home (`dashboard/page.tsx`, "חדר הבקרה") [Shot] [Code]

- Page height **3,945 px** for the owner, 3,271 for the bookkeeper and 3,659 for the manager (crawl). That is **4.4
  screens** at 900 px.
- **Vertical order:** worker banner → title → view toolbar (2 rows) → leak hero (≈ y 477–920) → VAT-at-risk card
  (≈ 945–1,245) → **daily trend rendered as 24 horizontal bars (≈ 1,267–2,181, about 914 px)** → pending-approvals and
  clean-match KPIs (≈ y 2,206) → price alerts → recipes → price creep → activity feed.
- **"What needs me" sits about 2,200 px down and is a count, not ₪.** The tile reads "ממתינות לאישור 4". The ₪296 at
  stake appears only on the approvals page ("סכום בסיכון ₪296").
- **The hero's sub-tiles are mostly dead ends.** The `HeroStat` link renders only for the `returned` tile.
  "נתפס לפני תשלום ₪296", "נדרש מהספקים ₪464" and "13 מתוך 35 חשבוניות עם חריגה" are not links. The drill that does
  exist is good: hero → "מה מאחורי המספר" → `leaks/breakdown` → invoice is **2 clicks**, and the period and filters are
  kept through `serializeView`.
- **Width:** the content container is `max-w-6xl` (1,152 px, 1,104 px usable after padding). That is 77 % of a 1440 px
  screen and **57 % of a 1920 px screen**.

### 2.3 Queues [Shot] [Code]

- **`approvals`:** each decision card is **≈325 px tall** (title, ₪, a "למה סומן" box with 4 lines, two buttons).
  - At 1440×900 the first card starts at y≈541, so **one card is fully visible above the fold**.
  - At the `myQueue` limit of 50 items, the page would be about 16,000 px tall.
  - The density toggle (מרווח / צפוף) exists, but both settings are still cards.
  - There is no bulk action (see `erp-modern.md` P21).

### 2.4 Search, keyboard and views [Code]

- **`DashboardSearch`** (`search.tsx`):
  - Searches only suppliers, products and invoices, from 2 characters with a 250 ms debounce.
  - It is a WAI-ARIA combobox (↑/↓/Enter/Esc).
  - There is **no Cmd/Ctrl+K binding**, it finds **no screens and no actions**, and the app has **no global
    shortcuts**. `keydown` handlers exist only in the nav drawer, the branch switcher, the names grid and TV mode.
- **View state is a strength:**
  - `lib/components/views/state.ts` serializes period (`this_month … custom`), compare (`off|prev|yoy`), group, chart,
    **density (`comfortable|compact`)**, TV mode and 5 filters into the URL. Every view is shareable as a link.
  - `ViewToolbar` is used on **6 surfaces only**: overview, approvals, `leaks/report`, `leaks/breakdown`, the leaks
    explorer and chain.
  - It is **absent** from pay-run, claims, recovery, ledger, orders, suppliers and catalog.
- **Saved views live in `localStorage`** (`savedViews.ts`, key `rm:views:<page>`, at most 20). So:
  - an owner's view is invisible to the bookkeeper
  - it is lost on a new laptop
  - it cannot be a team default

### 2.5 Multi-branch [Code] [Shot]

- **Switching branch is a session switch:** `branch-actions.ts` does a "full document navigation to /dashboard". You
  lose the page you were on.
- **`chain/page.tsx` is the only roll-up.**
  - It has 4 KPI cards: "דליפה ברשת ₪2,090", "אחוז מהרכש 1.5%", "נתפס לפני תשלום ₪819" and "פתוחים בתקופה 25". **None
    of them is a link.**
  - The ranking table has "כניסה" (enter) per branch, which switches the session and lands on that branch's *home*, not
    on its open items.
  - To see branch B's approvals and come back takes **chain → כניסה (reload) → אישורים → switcher → own branch (reload)
    → רשת = 6 clicks and 2 full reloads**.
- **There is no "all branches" scope** on approvals, pay-run, claims or the ledger.

### 2.6 What to keep

- URL-serialized views
- compare prev/YoY with a thin-base guard (`isThinBase`)
- `DeltaBadge` with ₪ and %
- CSV export from the toolbar
- TV mode
- the 2-click hero drill
- the chain ranking, heatmap and price-gap tables

These are a solid base. The problem is **organization and reach, not a lack of features.**

---

## 3. Benchmark digest: what the newest tools actually do

### Ramp: Homepage and Insights

- **The task feed replaced the Inbox.**
  - The new Homepage "replaces Inbox to consolidate tasks and improve efficiency"; the inbox remains reachable by
    clicking its module.
  - The feed lists "Action items (e.g., approvals, missing items, draft submissions)", recommendations (e.g., sync ERP,
    optimize spend) and drafts of in-progress work.
  - It "prioritizes key tasks", with an **All / My Expenses** filter.
  - Users can "collapse any section you want - that collapse will persist until you re-open". [Web: support.ramp.com/introduction-to-homepage]
- **Price Intelligence** lives under **Insights › Price Intelligence** in the left nav. By default it is available to
  Admins, Owners and financial roles only. [Web: support.ramp.com/price-intelligence-on-ramp]
- **Keyboard:** users ask for Bill Pay shortcuts "as you have with credit card transactions (i.e., Ctrl-A to approve)".
  So Ramp has approve shortcuts on cards but not on bills. [Web: community.ramp.com/t/bill-pay-shortcuts/1463]
- **Lesson:**
  - The home **is** the action queue, filtered by "mine vs all".
  - Section collapse persists per user.
  - Insights are a separate nav group, restricted by role.

### Mercury: Insights and Command

- **Insights tabs:**
  - An **Overview** tab (burn, runway, key spend categories) plus **Money in / Money out** tabs that drill into flows
    over time.
  - A time-frame selector sits **top right**. Burn defaults to the **last 3 full months**. [Web: support.mercury.com Insights page overview]
  - The March 2026 update added interactive charts and tables, filtering, "comparisons across time periods" and
    AI-powered cashflow alerts. [Web: mercury.com/blog/march-2026-product-updates]
- **Command** (June 2026) is a conversational layer. It "stages each action and requires the customer's explicit
  confirmation before it executes". [Web: 01net.it press release]
- **Lesson:**
  - One overview with 2 drill tabs, not 8 routes.
  - The default period is a *complete* period (3 full months), not a partial one.
  - An AI agent may stage an action but never execute it unconfirmed. This matches RestoMatch's PR-only and human-gate
    ethos and `/dashboard/ask`.

### Rillet: AI-native ERP close

- **Close Checklist** (March 2025): tasks, **owners, deadlines, document uploads, a status per item**. Approvals control
  what reaches the GL, and reconciliation error detection flags inconsistencies. [Web: rillet.com/blog/march-2025-product-update]
- **"Continuous close":** data is validated and posted throughout the period, so statements are "close-ready at any
  point". [Web: info.rillet.com/continuous-close]
- **Multi-entity:**
  - Entity-level and consolidated reporting, switched "with only the flip of a switch".
  - "The controller has visibility across all entities from a single view."
  - Each entity has its own close checklist and period locks. [Web: rillet.com/product/multi-entity-accounting-consolidation; rillet.com/blog/multi-entity-multi-currency-erp-global-expansion]
  - This is vendor copy; I could not confirm the UI itself.
- **Lesson:**
  - Make close a **visible checklist with owners and due dates**.
  - Scope (one entity vs all) is a **switch on the same screen**, not a different session.

### Pigment, Mosaic and Runway: FP&A

- **Pigment Insights** "automates variance and contribution analysis, eliminating the need for manual drill-downs". It
  **ranks dimensions**, shows drivers as charts **and written summaries**, and suggests next steps. [Web: pigment.com/blog/feature-highlight-insights]
- **Mosaic:** filter by several dimensions and "reach **transaction-level detail within a few clicks**"; 150+ metrics,
  35+ templates; BvA with drill-down to live ERP actuals. [Web: mosaic.tech/workflow/financial-analysis; usagepricing.com profile]
- **Runway BvA:**
  - Click **Customize → Compare → choose scenarios**, then add **Variance and Variance %**.
  - Colours default to green when actuals beat budget. **For cost metrics you reverse the colours by setting a goal below
    zero.** [Web: docs.runway.com/guides/modeling/bva]
  - Marketing pages add "drill-down from P&L to department to vendor" and colour-coded variance tables. [Web: runway.com/lp/financial-dashboards]
- **Lesson:**
  - Explain the delta automatically (top drivers, in words and ₪).
  - Variance colour must follow the *meaning* of the metric. Leak going up is bad; caught or recovered going up is good.
  - The drill chain is total → dimension → vendor → transaction.

### Linear: views, navigation and keyboard

- **Command menu:** **Cmd/Ctrl+K** "runs any action or jumps to any page when you type its name".
- **G-chords:** two-key shortcuts such as **G then I** (Inbox) and **G then M** (My issues). **?** or **Cmd+/** shows the
  full list. [Web: linear.app/enablement/guide/navigating-linear; linear.app/docs/inbox; changelog 2021-03-25]
- **Inbox keys:** **J/K** (or arrows) move, **E/Backspace** delete, **H** snoozes. [Web: linear.app/docs/inbox]
- **Peek:**
  - **Space** toggles peek, or hold it for a temporary preview, from any list or board, "similar to Quicklook".
  - Inside Cmd+K, **→** opens a preview beside the menu. [Web: linear.app/docs/peek.md]
- **Favorites:** "personal shortcuts which appear in your sidebar". A **Favorites** section sits **above Your Teams**,
  with folders and drag-in/out. [Web: linear.app/docs/favorites]
- **Custom views:** "Display" holds grouping and ordering. "Set default for everyone" exists for teams. [Web, third-party: storylane.io / guideflow.com tutorials]
- **Lesson:**
  - The sidebar carries personal saved views.
  - Every list has a preview that does not leave the list.
  - The whole app is reachable without a mouse.

### Stripe: Home, Reports and Sigma

- **Home widgets** can be added, removed and organized.
  - The date-range dropdown adapts granularity (a 1-week range gives daily or hourly).
  - A **comparison range** is picked from a third dropdown. [Web: support.stripe.com/questions/dashboard-home-page-charts-for-business-insights]
- **Stripe labels its own home charts as estimates.** Home charts are "estimated information", and for precise figures
  the user is pointed to Financial Reports. [same]
- **Balance summary drill:**
  - Click the amounts in "Balance change from activity" to go from the summary total to individual transactions.
  - Every section has its own **Download** CSV (top right of the section). [Web: docs.stripe.com/reports/balance]
- **Sigma scheduled queries:**
  - Run daily, weekly or monthly.
  - They email recipients the query name, the date and a **CSV download link**. Recipients can unsubscribe.
  - Results can also be sent as webhook events. [Web: docs.stripe.com/sigma/scheduled-queries]
- **?** lists the dashboard shortcuts. [Web: docs.stripe.com/dashboard]
- **Lesson:**
  - Every summary amount is a link to its rows.
  - Export per section.
  - Any query or view can be subscribed to on a schedule.

### Shopify admin

- **Keyboard:**
  - **Ctrl/Cmd+K** opens search from any page. **?** shows all shortcuts.
  - Sequence shortcuts must be typed **within about one second**. [Web: help.shopify.com/en/manual/productivity-tools/keyboard-shortcuts]
- **Pinned apps** sit at the bottom of the sidebar list (via the pin icon or drag). [Web: help.shopify.com/manual/shopify-admin/shopify-admin-overview]
- **Order views:**
  - Built with **Save as → name → Save view**.
  - A view stores **filters, column choices, column order and sort order**, and shows as a **tab**.
  - Views are **dynamic**: a row enters or leaves as it matches. [Web: help.shopify.com/manual/orders/search-view-print-orders]
- **Polaris `IndexTable`:**
  - Has `bulkActions`, **`promotedBulkActions`**, `condensed` and **`lastColumnSticky`**.
  - Polaris says to hide bulk actions only **below 490 px**. [Web: polaris-react.shopify.com/components/tables/index-table; tessl.io registry]
- **Anti-lesson:** in 2026, merchants complained that the Home stats bar lost its **period label and date selector**.
  One reply said there is no setting to restore it. [Web, community: community.shopify.com/t/home-page-stats-widget-no-longer-shows-time-period-or-date-selector/637406]
  **Never show a number without its period.**

### Toast: multi-location

- **"You are viewing" menu:**
  - Filters a page by **restaurant group or location**.
  - Selecting a group **auto-selects its child locations and sub-groups**; selecting a location also selects its parent
    groups.
  - Then **Update**. [Web: doc.toasttab.com/doc/platformguide/filteringPagesForSpecificRestaurantGroupsAndLocations.html]
- **Location Overview report:**
  - A **sortable table of all locations** at Reports › Overview › Location overview.
  - **15 available columns** behind a **Columns** button (net/gross sales, labor cost, SPLH, labor %).
  - A **"Show Percentages" / "% of total"** toggle and a net/gross gear.
  - **Export: download or email** (top right). [Web: support.toasttab.com/en/article/Restaurant-Management-Location-Overview-Report]
- **Lesson:**
  - Branch scope is a **page filter with group semantics**, not a login switch.
  - The roll-up is one sortable table with a column chooser and "% of total".
  - **Don't copy** the explicit Update button. Apply the scope instantly.

### Restaurant365

- **RADAR Dashboard:**
  - A **Location Group** selector plus a **DOB (date of business)** selector. The DOB defaults to *today or yesterday per
    user setting*.
  - "All widgets are Location Group driven so that they display information at the single restaurant, multi-unit, or
    corporate level."
  - Users see only the dashboards assigned to them, scoped to their **Primary Location Group**.
  - Editing is the pencil icon, with permission. [Web: radar.help.restaurant365.com/support/solutions/articles/12000083581]
- **R365 Intelligence Key Info Comparative Dashboard:**
  - Compares to **PY, PW, OWTD, OPTD and OYTD** across **4 pages**: Totals with Daily Trend, Comparative View by Date,
    Adjacent View by Date, Interval.
  - The default range is **today −1 month −1 day → today −1 day**.
  - Masters can't be edited, only duplicated. [Web: docs.restaurant365.com/docs/r365-intelligence-key-info-comparative-dashboard-master]
- **AP Center:**
  - An **Awaiting Approval** tab with a **"My List"** subtab and a Current Approver column.
  - Workflows run per location, location category or vendor, with **up to 10 levels**.
  - The mobile Red App has "**Assigned to Me**". [Web: docs.restaurant365.com/docs/ap-center-awaiting-approval; …/r365-red-app-ap-approvals]
- **Lesson:**
  - The default scope comes from the user's primary branch group.
  - Comparisons include *to-date* aligned periods.
  - The queue has a "mine" sub-view.
  - 200+ widgets is the anti-pattern for an independent-restaurant ICP. Ship opinionated role homes instead.

### Density reference: Gmail

- Density options are **Default / Comfortable / Compact**. When the window is too small, the option is annotated "**on
  larger screens**". [Web: support.google.com via goo.gle/3su4528; eoi.helpscoutdocs.com]
- **Lesson:** density is a per-user setting that degrades gracefully by viewport.

---

## 4. Principles (22)

Each principle has a **Source**, a checkable **Rule** and an **Applies to** line that names RestoMatch routes and files.
"≤N clicks" counts mouse clicks or key chords from the page where the task starts. A scroll is not a click, but scroll
distance is stated.

### A. The 5-second home

**P1. "דורש אותך עכשיו" (needs you now) is the first content band, in ₪, above the fold.**
*Source:* Ramp Homepage ("replaces Inbox", "action items", "prioritizes key tasks"); R365 Awaiting Approval › My List.
*Rule:*
- At 1440×900 the band's bottom edge is at **y ≤ 330 px**. Today the equivalent tile is at y≈2,206.
- **One row of 3–5 tiles, each 152–168 px tall.** Each tile shows:
  - **₪ (T2, `formatIls`)**
  - a count
  - a due date or age
  - **one CTA**
- **Tile order:**
  1. חוסמים לפני תשלום (blocking): ₪ and count
  2. ממתינים לאישור (warn)
  3. ריצת תשלומים הבאה: date, ₪, number of invoices
  4. מכתבי זיכוי לשליחה: ₪ and number of suppliers
  5. תיבת חשבוניות: count needing review
- **Tiles with zero items collapse into one calm T3 line** ("הכול מטופל · ‎₪0 ממתין"). A zero is never rendered as a red
  tile.
- With the demo data, the owner sees:
  - blocking ₪143.50 · 2 (104.80 + 38.70)
  - warn ₪152.50 · 2
  - claims ₪464

*Applies to:* `dashboard/page.tsx` (new `NeedsYouStrip` above `LeakHero`; the `pendingCard` KPI moves into it).

**P2. Every role lands on its own default home. The scope defaults to the user's primary branch group.**
*Source:* R365 (dashboards assigned per user, scoped to the Primary Location Group; DOB default per user); Ramp All /
My Expenses.
*Rule:*

| Role | `/dashboard` renders | Strip tiles |
|---|---|---|
| Owner, 1 branch | Strip + leak hero + top suppliers | blocking, warn, pay run, claims, inbox |
| Owner, 2+ branches | **Scope = "כל הסניפים"** by default, strip summed across branches with a per-branch split chip, then the roll-up matrix (P19) | same, summed |
| Bookkeeper | "שולחן החשב": strip, then the close checklist (P21), then the invoice index (P22) | routed to me, pay run, close X/6, missing allocation numbers ₪, last export |
| Manager | Strip, then orders due today and price alerts | warn approvals, orders to send, deliveries today, price alerts |

- A **"מוצג: הכול / שלי"** toggle filters the strip to items routed to *me* (the approvals engine already routes
  duplicates to the bookkeeper).

*Applies to:* `dashboard/page.tsx` (branch by role, which it already partly does for `vatRisk`), `lib/roles.ts`.

**P3. The leak hero stays T1 but loses the 914 px of daily bars. The trend becomes a 48–64 px sparkline inside the hero.**
*Source:* Mercury Insights Overview plus drill tabs; Stripe home charts.
*Rule:*
- The hero is **≤ 260 px tall** at 1440 px. It holds:
  - the ₪ figure
  - % of spend
  - a `DeltaBadge`
  - a **sparkline (64 px high, 1 bar per day)**
  - **the top-3 drivers line** (P7)
  - 3 sub-tiles
- The full `BreakdownChart` moves into `leaks` › "מגמה" or behind a **"הצג מגמה" disclosure** that is collapsed by
  default and **remembers its state** (Ramp collapse persistence).
- **Home page height target: ≤ 1,800 px** (from 3,945).

*Applies to:* `dashboard/page.tsx` (`LeakHero`, the trend `<section>`), `lib/components/views/BreakdownChart.tsx`.

**P4. Every number is a link, and any transaction is at most 2 clicks away.**
*Source:* Stripe balance summary (click amounts → individual transactions); Mosaic ("transaction-level detail within a
few clicks").
*Rule:*
- Any ₪ figure or count on home, chain, reports or the ledger is an `<a>` to the **filtered list** that sums to it
  (click 1). The row opens the **invoice in a split pane or peek** (click 2, no page load; see P13).
- **Hero sub-tile targets** (today only `returned` links):

| Hero sub-tile | Target |
|---|---|
| "נתפס לפני תשלום" | `approvals?st=open` |
| "נדרש מהספקים" | claims |
| "13 מתוך 35" | the invoice index filtered to `has_leak=1` |

- **Chain KPI cards:** "דליפה ברשת" → breakdown with `b=all`; "נתפס לפני תשלום" → approvals with `b=all`.
- **The sum on the list page must equal the clicked number to the agora.** Use the same tRPC source; never recompute in
  the UI.

*Applies to:* `dashboard/page.tsx` `HeroStat` (pass `href` for all 3), `chain/page.tsx` KPI cards (wrap in `Link`),
`reports/monthly`, `suppliers/ledger-ui.tsx`.

**P5. Drill-down keeps its context and shows a breadcrumb trail.**
*Source:* Runway (P&L → department → vendor); Stripe summary → itemized.
*Rule:*
- Period, compare, filters **and branch scope** travel in the URL. `serializeView` already does this for the first three
  and needs a new `b` param.
- A breadcrumb row (32 px, 13 px text) appears under the page title on every drilled page, for example:
  `חדר הבקרה › דליפה · אוק׳ 1–25 › קצביית הכרם › חשבונית HK-24108`.
- Each crumb restores its exact view. **Browser Back returns to the same scroll position and selected row.**

*Applies to:* `lib/components/views/state.ts` (add `b`), a new `Breadcrumbs` in `lib/components`, `leaks/breakdown`,
`invoices/[invoiceId]`.

### B. Period comparison and explanation

**P6. The period label and the compare control are always visible, and to-date comparison is aligned.**
*Source:* Shopify 2026 merchant backlash when the Home period label and selector disappeared; R365 OPTD/OYTD; Mercury
"full 3 months" default.
*Rule:*
- A **sticky compare bar (40 px)** sits under the top bar on every analytic page and reads, for example:
  `אוקטובר 2026 (1–25) · מול ספטמבר 1–25 · ‎+₪112 (+17%)`.
- **Default comparison is "previous period, same days elapsed".** Today `cmp=prev` compares a partial month with a full
  one. Add `cmp=prev_td` and make it the default whenever `p=this_month` and today < the month end.
- Keep `yoy`. Keep the `isThinBase` guard.

*Applies to:* `lib/components/views/state.ts` (`COMPARES`), `ViewToolbar.tsx`, `owner.leakSummary` input (web-feature-engineer, consuming the charts SQL).

**P7. Explain the delta: the top-3 drivers in words and ₪, next to the number.**
*Source:* Pigment Insights (ranks dimensions, written summaries, next steps); Runway variance.
*Rule:*
- Under the hero delta, one line of at most 3 chips, each a link. For example:
  `‎+₪74 קצביית הכרם · אנטריקוט +7.2%` · `‎+₪38 ירקות השרון · עגבניות שרי` · `‎−₪20 דגי הים התיכון`.
- **Colour follows meaning** (Runway's "goal below zero" for costs):

| Metric moves | Colour |
|---|---|
| Leak ↑ | danger |
| Leak ↓ | success |
| Caught ↑ | gold (T3) |

- The same driver chips appear in each chain ranking row.

*Applies to:* `LeakHero`, `chain/page.tsx` ranking. The driver query belongs to the charts SQL owned by
matching-engine-guardian, consumed through tRPC.

### C. Navigation and IA

**P8. Use a side nav with at most 7 top-level groups and live badges, instead of a 2-row tab strip.**
*Source:* Linear sidebar (Inbox / My issues / Favorites / Teams); Ramp (Insights as its own group); Shopify (pinned
items at the bottom). See also `erp-modern.md` P20, which proposes 4 groups. This report proposes 7 because "My queue"
and "Chain" must be one click away and must not be buried.
*Rule:*
- At ≥1024 px, an inline-start rail (on the right in RTL), **248 px expanded / 64 px collapsed**.
  - The toggle is **Ctrl/Cmd+B**, persisted per user.
  - It replaces both tab rows, so the top bar shrinks from ≈150 px to **56 px**.
- The **7 groups** are specified in §6.
- **Group headers collapse, and the state persists.**
- **Badge format:**
  - A ₪ amount on money items (for example "‎₪296") with a 10 px dot for blocking.
  - A count on capture items.
- **Badges refresh every 60 s and on focus.**
- Below 1024 px the existing mobile drawer and bottom bar stay.

*Applies to:* `nav.tsx` (`NAV_ITEMS`, `GROUPS`, `DesktopNav`), `layout.tsx` (header, `max-w-6xl` → a fluid container).

**P9. No orphan routes. The 8 ₪-explanation routes collapse into 2 tabbed destinations.**
*Source:* Mercury (1 Insights page with 3 tabs); R365 (1 dashboard with 4 pages).
*Rule:*
- Every one of the 43 routes is reachable from the sidebar **or** Cmd+K in **≤2 interactions**.
- **"בלש הדליפות"** gets tabs: `סקירה | פירוק | הוכחה | מגמה`.
- **"דוחות"** gets tabs: `דוח דליפות | הדוח החודשי | תצוגת מייל`.
- **"זיכויים"** gets tabs: `לשליחה | נשלחו | חזר (₪)`, merging claims and recovery.
- Old URLs **308-redirect** to the new tab URLs.
- **Accept:** a CI script compares `find app/dashboard -name page.tsx` against the nav and palette registry and fails on
  any route that is not in either and is not an `[id]` detail page.

*Applies to:* `leaks/*`, `reports/*`, `recovery`, `leaks/claims`, `nav.tsx`, a new `lib/navRegistry.ts`.

**P10. Cmd/Ctrl+K is a command palette (screens, entities and actions), not only an entity search.**
*Source:* Linear (Cmd+K runs any action or jumps to any page; → previews); Shopify (Cmd+K from any page). See also
`erp-modern.md` P18 for the `/ @ # $` prefixes.
*Rule:*
- Opens on **Ctrl/Cmd+K and on `/`**, at ≤100 ms. The screens list is client-side and needs no network.
- **Empty state:** 5 recent items plus "פעולות מהירות".
- **Sections, in this order:**
  1. מסכים (screens): every registry route, with Hebrew and English aliases (for example "כרטסת", "ledger", "הנה״ח")
  2. פעולות (actions): "ריצת תשלומים חדשה", "ייצוא חודש קודם", "עבור לסניף חיפה", "צור מכתב זיכוי…", "הזמנה חדשה"
  3. ספקים, מוצרים, חשבוניות: the existing `search.global`, 2 characters, 250 ms
- **→ (in RTL also ←) opens a peek** of the highlighted entity beside the palette.
- **Every action that moves money opens its normal confirm screen. The palette never executes it directly** (Mercury
  Command: "stages each action and requires explicit confirmation").

*Applies to:* `search.tsx` (wrap it in a palette dialog), `searchOptions.ts` (add `screen` and `action` kinds), `layout.tsx` (global key listener).

**P11. Add a keyboard layer: G-chords per group and a `?` cheat sheet, using letters so RTL never flips arrows.**
*Source:* Linear (G then I / G then M, `?`, `Cmd+/`); Shopify (sequences within about 1 s, `?`); Stripe (`?`).
*Rule:*
- **G-chords**, each typed within **1,000 ms**:

| Chord | Destination |
|---|---|
| `G H` | home |
| `G Q` | my queue |
| `G A` | approvals |
| `G P` | pay run |
| `G I` | invoices |
| `G L` | leaks |
| `G R` | reports |
| `G S` | suppliers |
| `G O` | orders |
| `G B` | chain |

- **`?`** opens an overlay that lists every shortcut for the current page (2 columns, at most 480 px wide).
- Queue keys (J/K/A/X/E…) follow `erp-modern.md` P18.
- **Hotkeys are off while focus is in an input.**
- **Holding Alt for 600 ms shows key hints** on buttons.

*Applies to:* `layout.tsx`, a new `lib/hotkeys.ts`, approvals, pay-run, invoices, claims.

**P12. Favorites and pinned saved views live in the sidebar, with live counts.**
*Source:* Linear Favorites ("appear in your sidebar… above Your Teams", folders); Shopify pinned items.
*Rule:*
- A "מועדפים" section between the top items and the groups, holding **at most 7 pins**.
- A pin is a saved view or an entity, for example:
  - "חוסמים · קצביית הכרם (2)"
  - "ריצה של יום ו׳ (‎₪18,420)"
  - supplier "ירקות השרון"
- Pin with ☆ on any view toolbar or entity header. Reorder by drag.

*Applies to:* `nav.tsx`, `ViewToolbar.tsx` (☆), supplier and product headers.

### D. Lists, tables, density

**P13. Split pane at ≥1280 px for every list → detail pair, and Space opens a peek on wide tables.**
*Source:* Linear Peek (Space toggles or holds); Ramp approve-from-inbox; see `erp-modern.md` P19 for the 3-pane
approvals layout.
*Rule:*
- **List | detail** for:
  - invoices index → invoice
  - suppliers → supplier
  - orders → PO
  - claims → claim
  - pay run → invoice
- The list is **400 px**. The detail is flexible.
- Selection is in the URL as `?sel=<id>`. **J/K changes the detail without a route change.**
- **On read-heavy tables** (breakdown, ledger, chain suppliers), **Space opens a 520 px peek drawer from the inline-end
  side** (the left in RTL). Esc closes it and focus returns to the row.
- Target: **open → decide → next in 0 page loads.**

*Applies to:* `approvals/list.tsx`, `approvals/pay-run`, `suppliers/page.tsx`, `orders/page.tsx`, `leaks/claims`,
`leaks/breakdown`, `suppliers/ledger-ui.tsx`, the new `invoices/page.tsx`.

**P14. Density means rows at desktop, not cards. Compact is 36 px and comfortable is 52 px.**
*Source:* Gmail Default / Comfortable / Compact ("on larger screens"); Polaris `condensed`.
*Rule:*
- At ≥1024 px every queue renders as a **table row**:

| Density | Row height | Text |
|---|---|---|
| Compact | **36 px** | 13 px |
| Comfortable | **52 px** | 14 px |

- The "למה סומן" panel moves to the detail pane or row expansion and is **not shown inline for every row**.
- **Accept:** at 1440×900, `approvals` shows **≥ 10 rows** in comfortable and **≥ 15** in compact (today: 1 card).
- Density is **per user**, defaults to comfortable, and falls back to comfortable below 1024 px, labelled "במסכים רחבים".
- Touch targets stay ≥ 44 px on touch devices (`pointer: coarse`) whatever the density.

*Applies to:* `approvals/list.tsx`, `lib/components/views/state.ts` (`d` param exists), and density tokens in
`packages/ui-tokens` (rtl-design-steward).

**P15. Tables get inline row actions, promoted bulk actions and a sticky ₪ column.**
*Source:* Polaris `IndexTable` (`promotedBulkActions`, `lastColumnSticky`; hide bulk only below 490 px); R365 bulk
approve. See `erp-modern.md` P21 for the selection bar and undo.
*Rule:*
- **On hover or focus a row shows at most 3 inline actions** at its inline-end edge (in RTL, the left).
  - Approvals: `אשר · דחה · פתח`
  - Pay run: `סמן כשולם · דחה`
  - Claims: `שלח · ערוך`
- **Promoted bulk actions:** at most 2 visible, the rest under "עוד".
- **The ₪ column and the actions column stay sticky** under horizontal scroll.
- **Blocking rows are never bulk-approvable.** The approvals engine (`packages/api/src/approvals/engine.ts`) is called
  once per item, unchanged.

*Applies to:* `approvals/list.tsx`, `approvals/pay-run/page.tsx`, `leaks/claims`, `inbox/inbox-client.tsx`.

**P16. Every roll-up table gets a column chooser, sort on every column and a "% מהסך" toggle.**
*Source:* Toast Location Overview (15 columns behind **Columns**, "Show Percentages / % of total", export
download/email).
*Rule:*
- The column set, order and sort are part of the view state (new `cols` and `sort` URL params) and are saved with the
  view (P17).
- Default columns for **chain ranking:** סניף · דליפה ₪ · % מהרכש · נתפס לפני תשלום ₪ · ממתין לאישור ₪ · זיכויים ₪ ·
  Δ מול תקופה קודמת. Optional: רכש ₪, חשבוניות, % התאמה נקייה, ספק מוביל.
- The **% of total** toggle adds each branch's share of the chain sum under the ₪ value.

*Applies to:* `chain/page.tsx` (`chain-ranking` table), the chain suppliers table, `suppliers/ledger-ui.tsx`,
`leaks/breakdown`.

### E. Saved views, export and sharing

**P17. Saved views are shared, server-side, with live counts and role defaults.**
*Source:* Shopify order views (filters + columns + order + sort, tabs, dynamic); Linear "Set default for everyone"
(third-party source).
*Rule:*
- A view is `{name, page, query, scope: personal | restaurant, roleDefault?: Role}`.
- Views render as **tabs above the table, each with a live count and ₪**, for example `חוסמים (2 · ‎₪143)`,
  `מוכן לתשלום (9 · ‎₪18,420)`, `ריכוז החודש (3)`.
- An owner can mark a view as the **default for a role**. The bookkeeper then lands on "מוכן לתשלום".
- **Interim (no schema change):**
  - Keep `localStorage`.
  - Add **"העתק קישור"**: the URL already carries the view.
  - Seed 3 built-in views per page in code.

*Applies to:* `lib/components/views/savedViews.ts`, `ViewToolbar.tsx`. **The server-side table touches
`packages/db/src/schema.ts` (immutable), so it needs a human-authored PR. See §9.**

**P18. Export is per section and in the formats the bookkeeper uses. Any saved view can be subscribed to on a schedule.**
*Source:* Stripe (per-section Download CSV; Sigma scheduled daily/weekly/monthly email with a CSV link); Toast (export
download or email).
*Rule:*
- **Each table header has a ⤓ menu:**
  - CSV (UTF-8 with BOM, so Hebrew opens correctly in Excel)
  - XLSX
  - "העתק קישור לתצוגה"
- **"שלח לי" on any saved view** offers: every Sunday 07:00 / the 1st of the month 07:00 / every day 07:00, to chosen team
  members. The email carries the ₪ summary, the period and a link plus the CSV.
- Recipients can unsubscribe in 1 click.

*Applies to:* `ViewToolbar.tsx` (`exportData` exists, so add XLSX and link), `exports/page.tsx`. **Scheduled delivery
touches `packages/api/src/notifications/outbox.ts` and `apps/worker/src/cron.ts`, which are immutable, so it needs a
human PR.**

### F. Multi-branch

**P19. Branch scope is a page filter with an "all branches" option, not a session switch.**
*Source:* Toast "You are viewing" (a group auto-selects its children); R365 Location Group selector on every widget;
Rillet ("flip of a switch" consolidated ↔ entity; "visibility across all entities from a single view").
*Rule:*
- **A scope chip sits at the top of the sidebar:** `מוצג: כל הסניפים ▾`.
- **Options:**
  - כל הסניפים
  - each branch
  - user-defined groups (for example "צפון"), where selecting a group selects its branches
- **It applies instantly.** There is no Update button and **no full reload**. It writes `?b=all|<id>|g:<id>`.
- With `b=all`:
  - Money lists (approvals, pay run, invoices, claims, ledger) gain a **"סניף" column** and a branch filter.
  - The strip and KPIs sum across branches, with a per-branch split on hover.
- **Write actions** (approve, mark paid) run in the row's own tenant context. The UI never asks the user to switch
  first.
- The session-level `BranchSwitcher` stays for "work as this branch" (receiver and manager).

*Applies to:* `layout.tsx`, `branch-switcher.tsx`, `chain/*`, and the routers behind the money lists.
**Tenant-security-warden gate:**
- Cross-branch reads must go through per-membership RLS contexts. The chain router already re-checks owner membership.
- Never widen `applyCoreTenantRls`.
- Add a COVERAGE entry for every new procedure.

**P20. Roll-up → drill-in keeps the chain context, so getting back costs 1 click.**
*Source:* Toast Location Overview → location reports; Runway P&L → department → vendor.
*Rule:*
- Every cell in the chain ranking links to the matching list with `b=<branch>` **and** a breadcrumb
  `רשת › כפר הזיתים — ירושלים › …`.
- "כניסה" is **renamed "פתח את התור של הסניף"** and goes to `approvals?b=<id>`, not to that branch's home.
- **Accept** for the task "worst branch → its biggest open item": **≤ 2 clicks, 0 full reloads** (today 4 clicks and
  1 reload, and returning costs 2 more clicks and 1 more reload).

*Applies to:* `chain/page.tsx` (`SwitchBranchButton` usages, KPI cards), `chain/switch-button.tsx`.

### G. The bookkeeper's desk

**P21. Month close is a visible checklist with owners, due dates and ₪ remaining.**
*Source:* Rillet Close Checklist (tasks, owners, deadlines, uploads, status; a checklist per entity) and continuous close.
*Rule:*
- `סגירת חודש · אוקטובר 2026 · 4/6 · ‎₪1,123 פתוח` is a checklist of 6 system-checked items, each with an owner avatar,
  a due day (for example "עד 10.11") and a link:
  1. כל החשבוניות הותאמו (X open)
  2. חשבוניות ריכוז הוצלבו מול תעודות משלוח (`consolidated-panel`)
  3. מספרי הקצאה התקבלו (`vatAtRisk`, ₪ at risk)
  4. ריצת תשלומים אושרה
  5. מכתבי זיכוי נשלחו
  6. ייצוא להנהלת חשבונות בוצע
- **Items tick automatically from data.** Only "export done" and an optional "notes" item are manual.
- **For chains, there is one checklist per branch plus a roll-up line per branch.**

*Applies to:* `exports/page.tsx` becomes "סגירת חודש וייצוא", the bookkeeper home, and `vat-at-risk.tsx`.

**P22. Add an invoice index: the bookkeeper's spine table, which does not exist today.**
*Source:* Shopify order index (views as tabs, columns, bulk); R365 AP Center tabs.
*Rule:*
- A new `/dashboard/invoices`:
  - Columns: date · ספק · מס׳ חשבונית · ₪ total · status chip (התאמה נקייה / חריגה / ממתין לקבלה / ריכוז (T4 neutral) /
    שולם) · ₪ leak · מספר הקצאה ✓/✗ · סניף (when `b=all`).
  - **Default views:** `החודש` · `חריגות` · `ממתין לתשלום` · `ריכוז` · `ללא מספר הקצאה`.
  - **Split pane** to the existing `invoices/[invoiceId]`.
- **Accept:** finding any invoice of the current month takes **≤ 2 interactions** (open the index → type in its filter,
  or Cmd+K → `#HK-24108`).

*Applies to:* the new `apps/web/app/dashboard/invoices/page.tsx`, a new list procedure in `packages/api` routers (plus a
COVERAGE entry), `lib/roles.ts` (the `/dashboard/invoices` rule exists already).

---

## 5. Patterns (13)

### PT1. "Needs you now" ₪ strip

- **Source:** Ramp Homepage task feed; R365 My List.
- **Spec:**
  - 1 row, `grid-cols-5` at ≥1280 px and `grid-cols-3` at 1024–1279 px. Tiles are 160 px tall with a radius from tokens.
  - **Tile anatomy:**
    - icon 20 px
    - label 13 px
    - **₪ value 28 px mono `formatIls`, T2 danger or warn**
    - meta line 12 px ("2 פריטים · הוותיק 4 ימים")
    - CTA text-link 13 px ("לטפל ←")
  - Zero-state tiles merge into a single T3 calm line.
  - **Live via tRPC** with `staleTime` 30 s and a refetch on window focus.
- **RestoMatch:** `dashboard/page.tsx` for owner, manager and bookkeeper (P2 tiles per role).
- **Check:** the strip's bottom edge is ≤ 330 px at 1440×900, and every tile is an `<a>`.

### PT2. Seven-group sidebar with live badges

- **Source:** the Linear sidebar; Ramp Insights group; Shopify pinned items.
- **Spec:**
  - 248 px / 64 px.
  - Top to bottom: scope chip (PT4), the ⌘K field (36 px), חדר הבקרה, לטיפולי, ⭐ מועדפים (≤7), the 5 groups, then the
    footer (ניהול, user, language, sign-out).
  - Item height 32 px, text 14 px, a 16 px icon.
  - Badges sit at inline-end, using `formatIls` for ₪.
  - Group collapse persists.
  - Ctrl/Cmd+B toggles the rail.
- **RestoMatch:** `nav.tsx` and `layout.tsx`. The tree is in §6.
- **Check:** the top bar is ≤ 56 px; no nav row wraps; every route in §6 is reachable in ≤2 clicks.

### PT3. Command palette with peek

- **Source:** Linear Cmd+K plus quick-look →; Shopify Cmd+K.
- **Spec:**
  - A modal 640 px wide, at most 480 px tall, positioned 20 % from the top.
  - The input is 48 px. Result rows are 40 px.
  - **Section order:** recent → screens → actions → suppliers → products → invoices.
  - **→ or ← opens a 360 px peek** beside the modal.
  - The footer shows key hints: `↵ פתח · → תצוגה מקדימה · Esc סגור`.
- **RestoMatch:** `search.tsx`, `searchOptions.ts` (new `kind: 'screen' | 'action'`).
- **Check:** opens in ≤100 ms with no network for screens; `/` also opens it; the existing combobox ARIA semantics are
  kept.

### PT4. Scope selector "מוצג:" (branch / all / group)

- **Source:** Toast "You are viewing"; R365 Location Group; Rillet consolidated ↔ entity switch.
- **Spec:**
  - A chip at the top of the sidebar opens a 320 px popover listing: כל הסניפים (with ₪ leak), groups, then branches.
    Each entry shows its ₪ leak and open-items count.
  - Checkbox semantics for groups.
  - **It applies instantly**, by writing `b=` to the URL.
  - The current scope also shows in the breadcrumb and the compare bar.
- **RestoMatch:** `layout.tsx` and `branch-switcher.tsx` (the popover variant is reused); every money list.
- **Check:** changing scope triggers no `document` navigation (a Playwright `waitForNavigation` must not fire); the
  totals equal the sum of the per-branch rows.

### PT5. List | detail split view and Space peek

- **Source:** Linear Peek; Ramp approve from the inbox.
- **Spec:**
  - The list is 400 px and the detail is flexible. **`?sel=` in the URL.** J/K and ↑/↓ move the selection.
  - **The peek drawer** is 520 px from the inline-end side. It holds the header (supplier, number, ₪) and the line table,
    and has an "פתח מלא" button.
  - Esc closes the drawer and focus returns to the row.
- **RestoMatch:** invoices, approvals, pay run, claims, suppliers, orders, breakdown, ledger.
- **Check:** going from row 1 to row 10 detail by keyboard takes 9 keypresses and 0 route changes.

### PT6. Saved-view tabs with live counts

- **Source:** Shopify order views as tabs (dynamic); Linear views.
- **Spec:**
  - A tab strip (40 px) above the table: built-in views first, then personal views, then "+ שמור תצוגה".
  - The tab label is `name (count · ₪)`, with counts fetched in one batched call.
  - **A view that has been changed but not saved** shows a dot plus "שמור / שמור כחדש".
- **RestoMatch:** approvals, pay run, invoices, claims, ledger, orders. This replaces the "תצוגות שמורות" dropdown in
  `ViewToolbar.tsx`.
- **Check:** each tab count matches its list length; a copied link reproduces the tab for another user with the same
  role.

### PT7. Dense data table: inline actions, bulk bar, column chooser

- **Source:** Polaris IndexTable (`promotedBulkActions`, `condensed`, `lastColumnSticky`); Toast Columns; R365 bulk
  approve.
- **Spec:**
  - Rows 36/52 px. Header 40 px, sticky.
  - ₪ columns are right-aligned in LTR and left-aligned in RTL **by logical end**, mono and tabular.
  - Hover or focus reveals at most 3 actions.
  - A checkbox column, plus the sticky selection bar from `erp-modern.md` P21: "נבחרו 6 · ‎₪8,412.30".
  - The **Columns** popover has checkboxes and drag order.
  - "% מהסך" toggle.
- **RestoMatch:** a single `DataTable` in `lib/components` used by every list in PT5.
- **Check:** axe passes; every `th` has `aria-sort`; the table is keyboard reachable; blocking rows have a disabled
  checkbox with a reason in a tooltip.

### PT8. KPI → filtered list → transaction, with a breadcrumb trail

- **Source:** the Stripe balance summary drill; Mosaic; Runway.
- **Spec:**
  - Every KPI is an `<a>` carrying `data-drill="<route>?<query>"`.
  - The landing page shows the **same ₪ in its header** ("‎₪296 · 4 חריגות פתוחות") plus a breadcrumb of at most 4
    crumbs, separated by "›".
  - Click 2 opens the transaction in a split pane or peek.
- **RestoMatch:** home hero tiles, chain KPIs, `reports/monthly` lines, ledger cells.
- **Check:** an e2e test clicks each KPI and asserts that the list-header ₪ equals the KPI ₪ to the agora.

### PT9. Sticky compare bar with variance drivers

- **Source:** Stripe comparison dropdown; R365 PY/PW/OPTD; Pigment Insights; Runway variance colours.
- **Spec:**
  - 40 px sticky: `[תקופה ▾] [מול ▾: תקופה קודמת עד היום | שנה קודמת | ללא]`, then the summary
    `‎+₪112 (+17%)`, then at most 3 driver chips.
  - Colours by metric semantics (P7).
- **RestoMatch:** home, leaks explorer, chain, reports. This extends `ViewToolbar` and `DeltaBadge`.
- **Check:** on 25.10 the default comparison range is 1–25.09, and the bar text names both ranges.

### PT10. Branch × metric roll-up matrix

- **Source:** Toast Location Overview; R365 Key Info Comparative (Totals with Daily Trend).
- **Spec:**
  - Rows are branches plus a **total row pinned at the top**.
  - The 7 default columns are listed in P16.
  - **Each cell links** (P20).
  - An optional heat tint on the "% מהרכש" column, using tokens.
  - Sort by any column; the default is leak ₪, descending.
  - An inline 60 px sparkline per row.
- **RestoMatch:** the chain owner's home (scope = all) and `chain/page.tsx`. It merges today's ranking table and heatmap
  into one primary table, and the heatmap becomes a tab.
- **Check:** every cell is a link; the total row equals the chain KPI; the default sort is leak ₪ descending.

### PT11. Month-close checklist

- **Source:** Rillet Close Checklist; continuous close.
- **Spec:**
  - A card 360 px wide on the bookkeeper home, or full width on "סגירת חודש".
  - A progress ring and "4/6".
  - Each item shows: a status icon (✓ auto, ⏳ open, ⚠ overdue), the label, the ₪ open, the owner avatar, the due date
    and a link.
  - **Overdue items are T2.** Done items are T3.
- **RestoMatch:** `exports/page.tsx` (renamed), the bookkeeper home, and chain (one row per branch).
- **Check:** auto items flip to ✓ within 60 s of the underlying data changing, with no manual tick.

### PT12. Subscribe to a view (scheduled share)

- **Source:** Stripe Sigma scheduled queries (daily, weekly or monthly; email with a CSV link; unsubscribe); Toast email
  export.
- **Spec:**
  - "שלח לי ▾" in the view toolbar.
  - Frequency: daily 07:00 / Sunday 07:00 / the 1st of the month 07:00, Israel time.
  - Recipients come from the team.
  - **The email body has a ₪ summary with the period**, then a "פתח בתצוגה" link, then the CSV link.
- **RestoMatch:** any saved view; `reports/digest` becomes one preset subscription.
- **Check:** it ships behind a human PR (`outbox.ts` and `cron.ts` are immutable). Until then the UI shows a "בקרוב"
  state, or the item is hidden.

### PT13. Shortcut cheat sheet and Alt hints

- **Source:** the `?` key in Linear, Shopify and Stripe; Odoo-style Alt hints (`erp-modern.md` P18).
- **Spec:**
  - `?` opens an overlay of at most 480 px with 2 columns ("ניווט" / "בעמוד זה") and keys drawn as `kbd` chips.
  - Holding Alt for 600 ms overlays key letters on the visible buttons.
- **RestoMatch:** global (`layout.tsx`).
- **Check:** every shortcut listed in the overlay works on that page, verified by an e2e test that iterates the registry.

---

## 6. Proposed desktop IA: 43 routes → 7 groups

**Top of sidebar (not counted as groups):**
- scope chip (multi-branch only)
- ⌘K
- **חדר הבקרה** `/dashboard` (G H)
- **לטיפולי** (My queue, G Q): a unified queue of blocking and warn approvals, invoice-inbox needs-review, claims to
  send and receiving mismatches, with a ₪ badge. In phase 1 it is `approvals` with tabs; see `fintech.md` PT4.
- ⭐ **מועדפים** (≤7 pins)

| # | Group (key) | Items → existing route(s) | Roles (from `ROUTE_ROLES`) | Notes |
|---|---|---|---|---|
| 1 | **כסף** (G M) | תור אישורים `/approvals` · ריצת תשלומים `/approvals/pay-run` · **חשבוניות** (new `/invoices`, with tab "תיבה" = `/inbox`) · כרטסת ספקים `/suppliers/ledger` · **זיכויים** (`/leaks/claims` + `/recovery` as tabs) · **סגירת חודש וייצוא** `/exports` | owner, manager, bookkeeper (the ledger also for the receiver, as today) | 6 items. Badges: approvals ₪, pay run due date, invoices needs-review count, claims ₪ |
| 2 | **תובנות** (G L) | **בלש הדליפות** `/leaks` (tabs: סקירה · פירוק `/leaks/breakdown` · הוכחה `/leaks/proof` · מגמה) · **דוחות** (tabs: `/leaks/report` · `/reports/monthly` · `/reports/digest`) · חוזים והתראות מחיר `/contracts` (+ `/contracts/import`) · שאלו את RestoMatch `/ask` | owner, manager; bookkeeper for leaks and contracts | 4 items, down from 8 routes and 3 tabs |
| 3 | **רכש** (G O) | הזמנות `/orders` (+ `new`, `capture`, `[poId]`) · קליטת סחורה `/receiving` (desktop = today's review table; + `[poId]`) · ספקים `/suppliers` (+ `[id]`, `[id]/leak-card`) · קטלוג `/catalog` (tabs: מוצרים `/products` · ייבוא `/catalog/import` · מיפוי מק״טים `/catalog/mapping`) | owner, manager (receiver: receiving) | 4 items |
| 4 | **מטבח** (G K) | עלות מנה `/recipes` (+ `new`, `[recipeId]`) · ספירת מלאי `/inventory` (+ `count`, `[countId]`) | owner, manager, chef | 2 items. Mostly mobile for the chef, but the owner reviews food cost here |
| 5 | **רשת** (G B), only `showChain` | דאשבורד רשתי `/chain` (tabs: דירוג · מפת חום · פערי מחיר · ספקים ברשת) · ניהול סניפים `/branches` | owner | This replaces the chain/branches either-or. Single-branch owners get "פתח סניף נוסף" in the footer |
| 6 | **ניהול** (footer, collapsed) | צוות `/team` · אינטגרציות `/integrations` (no longer an orphan) · הגדרות `/settings` · סניפים `/branches` (single-branch) | per `ROUTE_ROLES` | Pinned at the bottom, like Shopify |
| 7 | (top items) | חדר הבקרה, לטיפולי | all | |

**Counts after the change:**
- **6 groups, 7 with chain.**
- **At most 6 items per group.**
- Of the 43 existing routes:
  - **28 are direct sidebar items or tabs**
  - **8 are `[id]` detail pages** (`invoices/[invoiceId]`, `orders/[poId]`, `receiving/[poId]`, `products/[productId]`,
    `recipes/[recipeId]`, `inventory/[countId]`, `suppliers/[id]`, `suppliers/[id]/leak-card`), reached by rows and
    Cmd+K
  - **7 are create or import pages** (`orders/new`, `orders/capture`, `recipes/new`, `inventory/count`,
    `catalog/import`, `catalog/mapping`, `contracts/import`), reached by a page CTA and Cmd+K actions
- The invoice index is the only new route.
- **0 orphans.**

**Role views of the same tree (canSeeRoute-filtered):**
- **Bookkeeper:** home, my queue, כסף (all 6), תובנות (leaks and contracts), ניהול (settings and integrations), in
  12 entries.
  - Today the bookkeeper sees 8 nav entries (overview, approvals, inbox, leaks, recovery, contracts, exports,
    settings).
  - **Pay run, ledger and integrations are orphaned** even though `ROUTE_ROLES` allows them.
- **Chef:** home, מטבח, settings. The bottom bar stays primary on the phone.

---

## 7. Wireframes (1440×900, RTL; the sidebar is on the right)

### 7.1 Owner, single branch: target home

```
┌───────────────────────────────────────────────────────────────┬──────────────────────┐
│ TOP BAR 56px: כפר הזיתים · ⌘K חיפוש או פקודה… · 🔔 · אוואטר     │ SIDEBAR 248px        │
├───────────────────────────────────────────────────────────────┤ ⌘K                   │
│ COMPARE BAR 40px (sticky): אוק׳ 2026 (1–25) · מול ספט׳ 1–25 ·   │ ■ חדר הבקרה          │
│ ‎+₪112 (+17%) · [קצביית הכרם +₪74] [ירקות השרון +₪38]           │ □ לטיפולי   ‎₪296 ●  │
├───────────────────────────────────────────────────────────────┤ ☆ מועדפים            │
│ דורש אותך עכשיו (y 112–280)                                    │   חוסמים · קצביית…(2)│
│ [חוסמים ‎₪143.50·2] [ממתינים ‎₪152.50·2] [ריצת תשלומים ו׳ …]    │ כסף ▾                │
│ [זיכויים לשליחה ‎₪464·3]  [תיבה: 2 לבדיקה]                      │   אישורים    ‎₪296   │
├──────────────────────────────────────┬────────────────────────┤   ריצת תשלומים  ו׳   │
│ HERO T1 (y 296–540)                  │ נתפס לפני תשלום ‎₪296 → │   חשבוניות      2    │
│ דלף החודש  ‎₪760   1.8% מהרכש       │ נדרש מהספקים   ‎₪464 → │   כרטסת ספקים        │
│ ▁▂▅▃▁▂▇▅▃ sparkline 64px            │ חזר החודש   ‎₪1,267 →   │   זיכויים     ‎₪464  │
│ ‎+₪112 מול ספט׳ 1–25 · drivers×3    │ 13/35 חשבוניות → חריגה  │   סגירת חודש 4/6     │
│ [מה מאחורי המספר ←]                  │                        │ תובנות ▸ רכש ▸ מטבח ▸ │
├──────────────────────────────────────┴────────────────────────┤ ──────────────────── │
│ ספקים מובילים בדליפה (8 rows×36px, every cell a link) | התראות │ ניהול · עברית · יציאה │
│ מחיר (3) · מנות שהתייקרו (4)                       (y 556–860) │                      │
└───────────────────────────────────────────────────────────────┴──────────────────────┘
below the fold: VAT at risk · activity feed · (collapsed) full trend
```

### 7.2 Bookkeeper: "שולחן החשב"

```
strip: [מנותב אליי ‎₪X·n] [ריצת תשלומים ו׳ ‎₪18,420·9] [סגירת אוק׳ 4/6] [ללא מספר הקצאה ‎₪1,123] [ייצוא אחרון 1.10]
row:   CLOSE CHECKLIST (PT11, 360px)  |  INVOICE INDEX (PT6 tabs: החודש · חריגות · ממתין לתשלום · ריכוז · ללא הקצאה)
                                       |  36px rows · split pane on select · ⤓ CSV/XLSX
```

### 7.3 Chain owner: scope "כל הסניפים"

```
strip (summed): [חוסמים ‎₪… · ירושלים 2 · חיפה 1] … (a split chip per branch)
hero: דליפה ברשת ‎₪2,090 · 1.5% · drivers   |   ROLL-UP MATRIX (PT10)
  סך הכול  ‎₪2,090 | 1.5% | ‎₪819 | ‎₪… | ‎₪… | Δ      ← total row pinned
  ירושלים  ‎₪975  | 2.9% | …   (each cell → list?b=jer)   [פתח את התור של הסניף]
  כפר הזיתים ‎₪760 | 1.8% | …
  חיפה     ‎₪355  | 0.6% | …
tabs below: מפת חום · פערי מחיר בין סניפים · ספקים ברשת
```

---

## 8. Task-level click audit (before → after)

| # | Task (persona) | Today [Code]/[Shot] | Target | Principles |
|---|---|---|---|---|
| 1 | "How much ₪ needs my decision?" (owner) | Scroll about 2,200 px to "4" (a count); click; read "₪296" on approvals = **1 click + 2,200 px scroll** | Read it in the strip at y≤330 = **0 clicks, 0 scroll** | P1 |
| 2 | Approve the 2 non-blocking items (owner) | Approvals: scroll and click אשר twice across 325 px cards = **1 + 2 clicks, about 650 px scroll** | Strip tile → select 2 rows (X, X) → A = **1 click + 3 keys**, with an undo toast | P13–P15 |
| 3 | Worst branch → its biggest open item (chain) | רשת → כניסה (full reload) → אישורים → row = **3–4 clicks + 1 reload**; returning costs **2 more clicks + 1 reload** | Roll-up cell "ירושלים ‎₪975" → list `b=jer` → Space peek = **2 clicks, 0 reloads**; return = 1 crumb | P19, P20 |
| 4 | Find invoice HK-24108 (bookkeeper) | Click search → type → wait 250 ms → Enter = **1 click + typing** | ⌘K → `#HK…` → Enter = **0 clicks** | P10 |
| 5 | Open the supplier ledger (bookkeeper) | ספקים → supplier → ledger tab → "כרטסת" button = **4 clicks** | כסף › כרטסת ספקים = **1 click** (or `G M` then select) | P9 |
| 6 | See this week's pay run (bookkeeper) | אישורים → "ריצת תשלומים" button = **2 clicks** (flag-gated, otherwise invisible) | Strip tile or כסף › ריצת תשלומים = **1 click** | P1, P9 |
| 7 | Claims to send (owner) | בלש דליפות → report or breakdown → claims = **3 clicks** | Strip tile "זיכויים לשליחה ‎₪464" = **1 click** | P1, P9 |
| 8 | Why did the leak rise vs last month? (owner) | Toolbar → compare → read DeltaBadge; drill to breakdown and group by supplier = **≈4 clicks** | Drivers line under the hero = **0 clicks**; a chip = 1 click to the filtered list | P6, P7 |
| 9 | Share "blocking items of supplier X" with the manager (owner) | Filters → save the view (local to this browser only) → **cannot share** except by copying the URL by hand | ☆ Save view → "העתק קישור" or a restaurant-scope view = **2 clicks** | P17 |
| 10 | Month close status (bookkeeper) | No single place. VAT-at-risk is on home, pay run is orphaned, export is a separate page | Strip "סגירת אוק׳ 4/6" → checklist = **1 click** | P21 |

---

## 9. Governance and ownership (AGENTS.md)

| Change | Owner agent | Immutable touch? | Path |
|---|---|---|---|
| Sidebar, top bar, fluid container, scope chip UI, breadcrumbs, palette, hotkeys, strip, split pane, DataTable | `web-feature-engineer` (apps/web) | No | PR, then `test-sentinel` |
| Density tokens (36/52 px rows), sidebar widths, tiers T1–T4 on new tiles | `rtl-design-steward` (`packages/ui-tokens`, globals.css) | No | PR |
| Compact ₪ in badges (for example ‎₪18.4K) | `money-format-marshal` | **Possibly**: `formatIls` is frozen once it exists. A compact option needs a human-reviewed PR. **Never** an inline `Intl.NumberFormat` | Human PR proposal |
| Driver ("top-3 contributors") query and aligned to-date compare | `matching-engine-guardian` (charts SQL) → consumed by web via tRPC | Charts SQL is not immutable; `engine.ts` must not change | PR |
| Invoice index procedure, cross-branch list procedures (`b=all`) | `web-feature-engineer` + **`tenant-security-warden` gate** | Must **add** entries to the `cross-tenant.attack.test.ts` COVERAGE (allowed). Must **not** touch `rls.ts` / `applyCoreTenantRls` | PR + warden review |
| Server-side saved views and role defaults | — | **Yes**: a new table means `packages/db/src/schema.ts` plus a new migration (schema is immutable) | **Human-authored PR.** Interim: localStorage + "copy link" + built-in views in code |
| Scheduled view emails (PT12) | — | **Yes**: `notifications/outbox.ts`, `apps/worker/src/cron.ts` | **Human-authored PR** |
| Bulk approve | `web-feature-engineer` | `approvals/engine.ts` is immutable. The UI must call the existing per-item approve, and blocking stays non-bulk | PR |

**North Star check:** every item above either **delivers** the ₪ number faster (P1, P3, P4, P7) or **protects** it
(P6: no partial-month false alarms; P19: tenant-safe roll-up; P15: no bulk-approve of blocking items). Nothing here adds
anti-ICP scope. There is no widget builder: the R365 approach of 200+ widgets is explicitly rejected for independents.

---

## 10. Rollout (each step independently shippable and testable)

1. **Phase 1 (no schema, no immutables):**
   - **P1** strip
   - **P3** hero compaction
   - **P4** links on hero, chain and KPIs
   - **P9** redirects and tabs
   - **P8/PT2** sidebar
   - **P10/PT3** palette
   - **P11** hotkeys
   - **P14** rows instead of cards
   - **P5** breadcrumbs

   **Acceptance:**
   - owner home ≤ 1,800 px tall
   - strip bottom ≤ 330 px
   - 0 orphan routes (CI script)
   - approvals ≥ 10 rows above the fold
   - ⌘K ≤ 100 ms
2. **Phase 2:**
   - **P22** invoice index
   - **P13/PT5** split pane
   - **P15/PT7** DataTable with bulk
   - **P16** column chooser
   - **P6** aligned compare
   - **P7** drivers

   This phase includes new procedures, COVERAGE entries and the warden review.
3. **Phase 3:**
   - **P19/P20** scope = all on money lists (warden gate)
   - **P21** close checklist
   - **P12** favorites (localStorage)
4. **Phase 4 (human PRs):**
   - **P17** server-side shared views and role defaults
   - **P18/PT12** scheduled sends
   - compact `formatIls`

---

## 11. Sources

Fetched through search-result summaries only; direct fetches were blocked (see §0).

- Ramp, Homepage: https://support.ramp.com/introduction-to-homepage
- Ramp, Price Intelligence: https://support.ramp.com/price-intelligence-on-ramp · https://support.ramp.com/hc/en-us/articles/17522214341523-Price-Intelligence-on-Ramp
- Ramp community, Bill Pay shortcuts request: https://community.ramp.com/t/bill-pay-shortcuts/1463
- Mercury, Insights page overview: https://support.mercury.com/hc/en-us/articles/44277089544084-Insights-page-overview
- Mercury, March 2026 updates: https://mercury.com/blog/march-2026-product-updates
- Mercury, Command launch: https://www.01net.it/mercury-launches-command-a-new-way-to-run-your-business-through-banking/
- Rillet, March 2025 update (Close Checklist): https://www.rillet.com/blog/march-2025-product-update
- Rillet, continuous close: https://info.rillet.com/continuous-close
- Rillet, multi-entity: https://www.rillet.com/product/multi-entity-accounting-consolidation · https://www.rillet.com/blog/multi-entity-multi-currency-erp-global-expansion
- Pigment, Insights: https://www.pigment.com/blog/feature-highlight-insights
- Mosaic, financial analysis: https://mosaic.tech/workflow/financial-analysis · https://usagepricing.com/blueprint/stack/mosaic
- Runway, BvA docs: https://docs.runway.com/guides/modeling/bva · https://runway.com/lp/financial-dashboards
- Linear, navigating: https://linear.app/enablement/guide/navigating-linear
- Linear, Inbox: https://linear.app/docs/inbox
- Linear, Peek: https://linear.app/docs/peek.md
- Linear, Favorites: https://linear.app/docs/favorites
- Linear, shortcuts help changelog: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
- Linear, custom views (third-party tutorials): https://www.storylane.io/tutorials/how-to-create-custom-views-in-linear · https://www.guideflow.com/et-ee/tutorial/how-to-create-a-view-on-linear
- Stripe, home charts: https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights
- Stripe, balance report: https://docs.stripe.com/reports/balance · https://docs.stripe.com/reports/report-types/balance
- Stripe, Sigma scheduled queries: https://docs.stripe.com/sigma/scheduled-queries
- Stripe, dashboard (`?` shortcuts): https://docs.stripe.com/dashboard
- Shopify, keyboard shortcuts: https://help.shopify.com/en/manual/productivity-tools/keyboard-shortcuts
- Shopify, admin overview (pinning): https://help.shopify.com/manual/shopify-admin/shopify-admin-overview
- Shopify, order views: https://help.shopify.com/manual/orders/search-view-print-orders
- Shopify community, Home period selector removed: https://community.shopify.com/t/home-page-stats-widget-no-longer-shows-time-period-or-date-selector/637406
- Polaris, IndexTable: https://polaris-react.shopify.com/components/tables/index-table · https://tessl.io/registry/tessl/npm-shopify--polaris/files/docs/data-display.md
- Toast, filtering by group or location: https://doc.toasttab.com/doc/platformguide/filteringPagesForSpecificRestaurantGroupsAndLocations.html
- Toast, Location Overview report: https://support.toasttab.com/en/article/Restaurant-Management-Location-Overview-Report
- Toast, Location reports overview: https://support.toasttab.com/en/article/Locations-Reports-Overview
- Toast, multi-location: https://pos.toasttab.com/uk/products/multi-location-management
- R365, RADAR dashboard: https://radar.help.restaurant365.com/support/solutions/articles/12000083581
- R365, Key Info Comparative Dashboard: https://docs.restaurant365.com/docs/r365-intelligence-key-info-comparative-dashboard-master
- R365, AP Center Awaiting Approval: https://docs.restaurant365.com/docs/ap-center-awaiting-approval
- R365, Red App AP Approvals: https://docs.restaurant365.com/docs/r365-red-app-ap-approvals
- Gmail, density: https://goo.gle/3su4528 · https://eoi.helpscoutdocs.com/article/83-gmail-display-density

Repo evidence:
- `apps/web/app/dashboard/{nav.tsx, layout.tsx, page.tsx, search.tsx, searchOptions.ts, branch-switcher.tsx, branch-actions.ts, chain/page.tsx, approvals/page.tsx, approvals/list.tsx}`
- `apps/web/lib/components/views/{state.ts, savedViews.ts, ViewToolbar.tsx}`
- `apps/web/lib/roles.ts`

Lab evidence:
- `scratchpad/ux/shots/dashboard__owner__desktop-he.png`
- `dashboard_chain__owner__desktop-he.png`
- `dashboard_approvals__owner__desktop-he.png`
- `scratchpad/ux/crawl-results.json`
