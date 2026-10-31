# Lens review: owner and bookkeeper desktop efficiency (`exec-desktop`)

**Date:** 2026-10-25 · **Lens:** cross-cutting, all desk pages · **Viewport:** 1440×900 (`*__desktop-he.png`, `*__desktop-en.png`), plus code
**Who:** the owner (one branch or a chain) at 07:00 and on Sunday review, the external bookkeeper (חשב/ת, רו״ח) in the first 10 days of the month, and the multi-branch owner every day.
**Inputs:**
- `research/RUBRIC.md`, mainly groups A, B3–B9, C1–C3, C8, D, H2/H3/H7 and I.
- `research/exec-desktop.md` (P1–P22, PT1–PT13), `research/erp-modern.md` §E (P18–P21), `research/functional-gaps.md` (FG-22, 26, 36–38) and `research/ia-map.md`.
- 98 dashboard desktop captures (`crawl-results.json`) and the public showcase.
- The code at `wt/` (HEAD `8fef118c`). Crops are in `review/crops-exec/`.

**Related area reviews.** Page-level detail stays there. This lens only references it:
- `area-command.md`: command-02/04/07/09/10/28 (home).
- `area-approvals.md`: approvals-02/08/09/14/21/22/25/31/39/40 (queue, pay run, invoice).
- `area-leaks.md`: leaks-03/05/12/13.
- `area-chain.md`: chain-03/06/07/11/12/18.
- `area-admin.md`: admin-04 to admin-07 (exports).
- `area-suppliers.md`: list and ledger reachability.

**This lens covers what those reviews can't:**
- the **desk shell**;
- the **shared primitives** every money list needs (DataTable, SplitPane, Peek, DrillLink, ViewBar, BatchBar, palette and hotkeys);
- the **drill contract** from KPI to transaction;
- **branch scope**;
- **saved views and export**;
- the **bookkeeper's desk** as one job;
- **the click and scroll budget for each desk task**.

> **Lab caveats** (not product bugs):
> - The red "מנוע העיבוד לא זמין" banner (≈60 px) appears because the lab has no job heartbeat. Every y-coordinate below is quoted **with** the banner, followed by the value without it.
> - The consent bar sits mid-page in full-page captures.
> - `/admin*` and `/leak-check*` are out of scope here.

---

## 0. Verdict

**Scores (0–10, against Ramp, Linear, Stripe, Shopify admin and R365):**
- desktop **3.0**
- functionality **4.0**
- mobile **3.5**. This is outside this lens and only shows how the desktop patterns degrade; it agrees with `lens-mobile-field.md`.

**What already works, and should be kept:**
- View state lives in the URL (`lib/components/views/state.ts`): period, compare, group, chart, density, TV mode and 5 filters. Every view is a shareable link.
- The **aligned to-date comparison engine already exists.** `packages/charts/src/leak-views.ts:95-113` cuts a running period at today before shifting, so Oct 1–25 compares with Sep 1–25. It is simply **off by default**.
- The hero drill to the breakdown is 2 clicks and keeps the period and filters (`serializeView`).
- CSV export with a UTF-8 BOM (`views/csv.ts`).
- The chain ranking and the heatmap.
- The orders table: 45 px rows, status tabs, the only dense money list in the app.
- The ledger grid's sticky identity column (`ledger-ui.tsx:237,246`).
- The **showcase already has the desk the product lacks**: an invoice register with filter counts, an audit timeline, a scan viewer and a PO-compare viewer (`app/showcase/dashboard/invoices/*`, `_components/Invoice*Viewer.tsx`).

**What's broken for the bosses, in one breath:**
- The desk is a **phone layout stretched to 1,104 px**:
  - 18 tabs wrap onto 2 rows, so the header is 152 px.
  - The H1 is 36 px.
  - A 2-row toolbar sits above the money.
  - Every list is a **stack of cards**, so pages are 3,945–5,162 px tall. Approvals shows **one decision per screen**.
- **Numbers are not doors.** 3 of the 4 hero sub-tiles and all 4 chain KPIs are not links. The same label shows different ₪ with no scope: "נדרש מהספקים" is ₪464 on the home and ₪3,672 on recovery.
- **The transaction level is missing.**
  - There is no invoice register.
  - Every drill ends on an OCR **correction form**.
  - There is no split pane, peek, keyboard, palette or bulk action anywhere.
- **The bookkeeper cannot run a month from the desk.**
  - They land on the owner's control room.
  - Their nav has no pay run, ledger or invoices.
  - Their queue says "אין חריגות" while ₪296 waits on the owner.
  - The pay run is read-only.
- **Multi-branch is a session.** Every "go to branch" is a full reload to that branch's home. No money list has an "all branches" scope.

**The fix is organisation and primitives, not new data.** Almost every number needed is already computed. Phase 1 (§5, BM-1 to BM-3) needs **no immutable file**.

---

## 1. Who sits at the desk, and the 5-second question

| Persona (`lib/roles.ts`) | When | 5-second question | Lands on today | Should land on |
|---|---|---|---|---|
| Owner, 1 branch | 07:00 daily; Sunday review | "How much ₪ needs my decision, and is the leak better than at this point last month?" | `/dashboard` hero, with decisions at y≈2,206 as a count | The Needs-you strip in ₪ at y≤336, the hero with an aligned delta, then the top suppliers table |
| Owner, 2+ branches | Daily | "Which branch leaks most, why, and what's waiting in each?" | The single-branch home of whichever branch is active | Scope "כל הסניפים": summed strip, then the branch × metric matrix |
| Bookkeeper | Weekly; days 1–10 of the month | "What's left before I can pay, close and export?" | The **owner's** control room (`dashboard__bookkeeper__desktop-he.png`) | "שולחן החשב": strip, then close checklist, then invoice register |
| Chain bookkeeper / CFO | Monthly | "Close all branches in one pass" | Nothing: the chain is owner-only (`roles.ts:94`) | The same desk, with scope = all |

---

## 2. Desk tasks walked at 1440×900 (today → target)

Clicks count mouse clicks or chords from where the task starts. Scroll is in CSS px.

| # | Task (persona) | Today (evidence) | Target | Fix |
|---|---|---|---|---|
| 1 | "How much ₪ needs my decision?" (owner) | Scroll 2,206 px to "ממתינות לאישור 4" (a count), click, read "₪296" on approvals = **1 click + 2,206 px** (`home_mid.png`) | Read it in the strip at y 176–336 = **0 clicks, 0 scroll** | exec-desktop-12 |
| 2 | Approve the 2 warn items (owner) | Two 315 px cards; each "אשר" refetches page 1 = **2 clicks + ≈650 px** scroll, no undo (`approvals_fold.png`, `list.tsx:65-76`) | X, X, 1 → batch bar "אשר 2 · ₪152.50" with 10 s undo = **3 keys, 0 scroll** | 05, 08, 09 |
| 3 | Check the evidence for one flag (owner) | "פתח חשבונית / תקן OCR" → full navigation to a correction form, then Back (scroll lost) = **2 page loads** | Space → peek with document and lines = **0 page loads** | 07 |
| 4 | Find invoice MF-24950 and see its status (bookkeeper) | Click search, type, wait 250 ms, Enter → a correction form with **no status** = 1 click + typing, and the status can't be learned | Ctrl+K "MF-24950" Enter → register with `?sel=`, status chip, document, history = **0 clicks** | 02, 09 |
| 5 | Open this week's pay run (bookkeeper) | Not in the nav. Approvals → "ריצת תשלומים" = **2 clicks** | Strip tile or כסף › ריצת תשלומים (`G P`) = **1 click** | 03, 04 |
| 6 | Mark Friday's payments as paid (bookkeeper) | **Impossible**: the pay run has no mutation (`payRun.ts` has 2 queries) | Select rows → "סמן כשולם · ₪5,901.02" → undo = **3 interactions** | 03 (approvals-21) |
| 7 | Open the supplier ledger (bookkeeper) | **No path.** The only link is in the supplier hub, which the bookkeeper can't open | כסף › כרטסת ספקים = **1 click** | 03, 04 |
| 8 | Worst branch → its biggest open item (chain owner) | רשת → "מעבר לסניף" (server action + `window.location.assign('/dashboard')`) → אישורים → card = **3 clicks + 1 reload**. Back = switcher → own branch (reload) → רשת = **2 clicks + 1 reload** | Matrix cell "ירושלים ₪975" → `approvals?b=<jer>` → Space = **2 clicks, 0 reloads**. Back = 1 crumb | 11 |
| 9 | "Why did the leak change vs last month?" (owner) | Toolbar → compare dropdown → "תקופה קודמת" → read ±₪; then breakdown, which has no grouping = **≈4 clicks and no answer in words** | The drivers line under the delta = **0 clicks**; a chip = 1 click to the filtered list | 10, 19 |
| 10 | Share "blocking items, supplier X" with the manager (owner) | Filter → save the view (**localStorage**, this browser only); otherwise copy the URL by hand | ☆ save → "העתק קישור", or a restaurant view (human PR) = **2 clicks** | 15, 16 |
| 11 | Month-close status (bookkeeper) | No place for it. VAT at risk is on the home, the pay run is orphaned and export is separate | Strip "סגירת אוק׳ 3/6" → checklist = **1 click** | 03 |
| 12 | Export October for 3 branches (chain bookkeeper) | Switch branch (reload) → ייצוא → download, × 3 = **≈9 clicks + 3 reloads** | Scope "כל הסניפים" → download with a "סניף" column = **2 clicks** | 11 (admin-07) |
| 13 | Keep 4 invoices open in tabs to compare | Every tab reads "RestoMatch" (0 `metadata` exports under `app/dashboard`) | "MF-24950 · דגי הים התיכון · RestoMatch" | 18 |

**Chrome cost before the first actionable pixel at 1440×900.** Today's numbers are measured with the lab banner, then without it.

| Page | First money or decision today | Without banner | Target with the desk shell |
|---|---|---|---|
| `/dashboard` (owner) | Hero top y≈478; first decision y≈2,206 | 418 / 2,146 | Strip y=176, hero y=352 |
| `/dashboard/approvals` | First card y≈530 (1 card above the fold) | 470 | First row y=256; **13 rows** (48 px) / **20 rows** (32 px) above the fold |
| `/dashboard/approvals/pay-run` | First supplier group y≈730 | 670 | First row y=256 |
| `/dashboard/leaks/breakdown` | First invoice y≈660; 13 cards = 4,210 px | 600 | Table of 13 invoices × 48 px = **≈1 screen** |

---

## 3. The desktop layout system ("Desk"): the deliverable

### 3.1 Principles (each one is checkable)

1. **Height is the scarce resource on a laptop, not width.** Chrome above content is ≤176 px (top bar 56, page head 72, context bar 48).
2. **Rows at ≥1024 px, cards only below 768 px.** A money list on the desk is a DataTable. Cards are a phone pattern.
3. **Every number is a door.** Each ₪ or count is a link to the rows that sum to it, and the landing page echoes that number to the agora.
4. **Open, decide, next, with 0 page loads.** Use a split pane or a peek. Selection lives in the URL.
5. **Scope is a filter, not a session.** Branch, period and compare are URL state, visible on every money page and applied without a reload.
6. **The keyboard is first-class and layout-proof.** Bind by `KeyboardEvent.code`, so the Hebrew layout works (ח = KeyJ, ל = KeyK, ע = KeyG).

### 3.2 Breakpoints and pane modes (Tailwind defaults: `lg` 1024, `xl` 1280, `2xl` 1536)

| Width | Rail | Content padding | List → detail pages | Queues (approvals, inbox, pay run) | Read-heavy tables |
|---|---|---|---|---|---|
| < 1024 | Mobile shell (`lens-mobile-field.md` §3) | 16 | Cards → detail page | Cards → sheet | Cards |
| 1024–1279 | **64 px icon rail**; Ctrl/⌘+B expands it as an overlay (248) | 24 | Full-width list + **peek 480** from the inline-end | List + peek 480 | Full width + peek 480 |
| 1280–1535 | **248 px**, persisted per user | 32 | **Split**: list 400 \| detail flex (min 560) | **2 panes**: list 380 \| detail (document and decision as tabs) | Full width + peek 520 |
| ≥ 1536 | 248 | 32 | Split: list 440 \| detail | **3 panes**: list 380 \| document flex \| decision 400 | Full width + peek 520 |
| ≥ 1920 | 248 | 32 | Same | Same | Same |

At ≥1920, analytic card grids cap at `--desk-max-analytic: 1680px` and centre. Tables and panes never cap.

**RTL:** the rail and list pane sit at the inline-start edge (the right in Hebrew). Peeks open from the inline-end edge (the left). The invoice document pane sits at the start, per H2.

**Width actually gained:**
- At 1440 the content area is 1440 − 248 − 64 = **1,128 px**. Today it is 1,104 px. The real win at 1440 is **vertical**: −96 px of chrome, no wrap, and rows instead of cards.
- At 1920 the content area is **1,608 px** against 1,104 today (+46%).

### 3.3 Shell regions and tokens

These live in `packages/ui-tokens/src/index.ts` and the `globals.css :root`. The owner is `rtl-design-steward`.

```
--desk-rail-w: 248px;          --desk-rail-w-collapsed: 64px;
--desk-topbar-h: 56px;         --desk-contextbar-h: 48px;   --desk-viewtabs-h: 40px;
--desk-pagehead-h: 72px;       /* min; wraps to 2 lines only for long object titles */
--desk-gutter: 24px (lg) | 32px (xl+);   --desk-gap: 24px;
--desk-list-w: 400px | 440px (2xl);      --desk-decision-w: 400px;   --desk-peek-w: 480px | 520px (xl+);
--row-compact: 32px;  --row-default: 48px;  --row-touch: 56px;   /* B6; header row = body row */
--desk-sticky-top: calc(var(--desk-topbar-h) + var(--desk-contextbar-h));
z: rail 30 · contextbar 35 · topbar 40 · table-head 20 (local) · batchbar 45 · peek 50 · palette 60 · toast 70
```

**Rail** (`nav.tsx` → new `DeskRail`). Top to bottom:
1. **Scope chip** (44 px, multi-branch only): "מוצג: כל הסניפים ▾".
2. **⌘K field** (36 px): "חיפוש או פקודה… Ctrl K".
3. **Primary items:** "חדר הבקרה" and "לטיפולי", with a ₪ badge.
4. **☆ מועדפים**: at most 7 pins, from saved views or entities.
5. **Groups:** כסף · תובנות · רכש · מטבח · רשת (the tree is in `research/exec-desktop.md` §6).
6. **Footer:** ניהול (collapsed), then the avatar menu (name, role, branch memberships, language, **sign-out**).

Rail styling:
- Item 36 px tall, `body-sm` 14/20, icon 16 (J4).
- Group header in `caption` 12/16, weight 600, muted; it collapses and persists (`rm:rail:groups`, try/catch).
- Active item: `aria-current="page"`, a filled `surface-2` pill, weight 600 and a 2 px inline-start bar. It is never marked by colour alone.
- **Badges:**
  - ₪ on money items, in full digits through `formatIls`, 0 dp. Never compact (B4).
  - A count on capture items.
  - A danger dot only when a `block` item exists.
  - Hidden at 0.
  - Refreshed every 60 s and on focus.

**Top bar** (56 px, sticky):
- Start side: the **breadcrumb**, which carries the view state (§3.7).
- End side: the ⌘K button, the notifications bell (in-app list of D9 events), "?" (cheat sheet) and the avatar.
- The restaurant name and email move into the rail and avatar. The email loses its mono face.

**Context bar** (48 px, sticky under the top bar; analytic and money-list pages only). It holds one row, left to right in reading order:
1. `[scope ▾]`
2. `[period ▾]`
3. `[מול ▾]`
4. The summary sentence, e.g. "אוק׳ 1–25 · מול ספט׳ 1–25 · ‎+₪112 (+17%)".
5. At most 3 driver chips.
6. Filter chips, with "סינון (3)" overflowing to a popover.
7. At the end: export ⤓ and ☆.

This **replaces** today's 2-row `ViewToolbar` above the hero (A8). Chart type, TV mode and density move into a "תצוגה" popover.

**Page header** (≥72 px):
- An H1 at `heading-lg` 24/32. Today it is 36 px (`Heading.tsx:4`, `text-3xl sm:text-4xl`).
- A context line at `caption` 12/16: "כפר הזיתים — ירושלים · אוקטובר 2026 (פתוח) · עודכן לפני 4 דק׳".
- One primary action at the inline-end, plus "⋯".

### 3.4 Page archetype templates (12-column grid, gap 24)

**A. Overview, owner single branch (`/dashboard`).** Target ≤1,800 px tall, against 3,945 today.

```
┌───────────────────────────────────────────────────────────────────────┬────────────┐
│ TOP BAR 56 · חדר הבקרה › אוקטובר 2026                  ⌘K  🔔  ?  (av)│ RAIL 248   │
│ CONTEXT 48 · אוק׳ 1–25 · מול ספט׳ 1–25 · ‎−₪299 (−28%) · [קצביית הכרם]│ ⌘K         │
├───────────────────────────────────────────────────────────────────────┤ ■ חדר הבקרה│
│ NEEDS YOU (y 176–336) grid 5×1fr, tiles 152 px, each an <a>           │ □ לטיפולי   │
│ [חוסם תשלום ‎₪143.50·2] [ממתין לאישור ‎₪152.50·2] [ריצת תשלומים ו׳     │   ‎₪296 ●   │
│  ‎₪5,901.02·8] [זיכויים לשליחה ‎₪464·N ספקים] [מע״מ בסיכון ‎₪1,123·1 · 154 ימים]│ ☆ מועדפים │
├──────────────────────────────────────────┬────────────────────────────┤ כסף ▾       │
│ HERO span 7 (≤240 px): דלף החודש ‎₪760     │ FUNNEL span 5 (4 states,   │  אישורים    │
│ 1.8% מההוצאה על סחורה · ‎₪42,263          │ A9), each row a DrillLink: │  ריצת תשלום │
│ ▼ ‎₪299 מול ספט׳ 1–25 · sparkline 120×32  │ נמצא ‎₪760 › נדרש ‎₪464 ›   │  חשבוניות   │
│ 35 חשבוניות נבדקו · 2 ממתינות לשיוך       │ זוכה ‎₪… › הוחזר ‎₪1,267     │  כרטסת      │
│ [מה מאחורי המספר] · איך הגענו ל-‎₪760?     │ (scope caption per row)    │  זיכויים    │
├──────────────────────────────────────────┴────────────────────────────┤  סגירת חודש │
│ TOP SUPPLIERS span 8: DataTable compact, │ ALERTS RAIL span 4:        │ תובנות ▸    │
│ 8 rows: ספק · דליפה ₪ · % · Δ · פתוח ₪   │ התראות מחיר (1) · מנות (4) │ רכש ▸ מטבח ▸│
│ (every cell a DrillLink)                 │ · זחילת מחירים             │ ─────────── │
├──────────────────────────────────────────┴────────────────────────────┤ ניהול · (av)│
│ ▸ מגמה יומית (collapsed, remembered) · ▸ פעילות אחרונה (5 rows)          │            │
└───────────────────────────────────────────────────────────────────────┴────────────┘
```

- At 1024–1279 the strip shows 3 tiles plus "עוד 2". The hero and funnel stack; the suppliers table and alerts stack.
- A zero tile merges into one calm T3 line: "הכול מטופל · ‎₪0 ממתין".

**B. Bookkeeper desk ("שולחן החשב", `/dashboard` for `bookkeeper`).**

```
STRIP: [מנותב אליי ‎₪…·n | הכל ‎₪296·4] [ריצת תשלומים ו׳ ‎₪5,901.02·8] [סגירת אוק׳ 3/6]
       [מע״מ בסיכון ‎₪1,123] [ייצוא אחרון: —]
ROW:   CLOSE CHECKLIST span 4 (6 auto-ticking items, owner + due + ₪ open + link)
     | INVOICE REGISTER span 8 (view tabs: החודש · חריגות · מוכן לתשלום · ריכוז · ללא מספר הקצאה;
       compact 32 px rows; Enter → /dashboard/invoices?sel=<id> split)
```

**C. Chain owner (scope = all).**

```
STRIP (summed; hover shows the per-branch split) → HERO span 5 "דליפה ברשת ‎₪2,090 · 1.5%"
| MATRIX span 7: total row pinned on top; columns סניף · דליפה ₪ · % מהרכש · נתפס ₪ · ממתין לאישור ₪
  · זיכויים פתוחים ₪ · Δ; every cell → its list with b=<branch>; row action "פתח את התור של הסניף"
TABS below: מפת חום · פערי מחיר · ספקים ברשת
```

**D. Queue, 3-pane at ≥1536 (`approvals`, `inbox`; pay run uses B/E).**

```
│ LIST 380 (view tabs + rows 48/32)    │ DOCUMENT flex (scan, zoom, page thumbs,   │ DECISION 400               │
│ ● חוסם  ‎₪104.80 משקאות שטיינברג ST-… │ line highlight on hover)                  │ claim · ₪ math (H1) · rule  │
│   אזהרה ‎₪100.00 קצביית הכרם HK-…     │                                           │ history (H7) · [1 אשר כפי   │
│ J/K moves; ?sel=<id>                 │                                           │ שחויב] [2 דחה ובקש זיכוי]   │
```

**E. Register (`invoices` new, `orders`, `suppliers`, `leaks/claims`, `recovery`).** The list (400/440) sits at the start and the detail (flex) at the end.
- `?sel=` holds the selection; J/K move it; Enter opens the full page; ⌘/Ctrl+Enter opens it in a new tab; Esc clears.
- Below 1280 the list goes full width with a peek.

**F. Read-heavy table (`suppliers/ledger`, `leaks/breakdown`, chain tables).** Full width; Space peeks.

**G. Report document (`reports/monthly`, `leaks/proof`, `leaks/report`).** A document column of at most 880 px at the start, and a sticky actions and contents rail (span 3) at the end: PDF, send, "סגור את החודש".

**H. Form (`settings`, imports, `orders/new` on desk).**
- 8/4 split: the form, at most 720 px, then a summary aside.
- `exports` uses H with the preview (admin-05) in the aside. Today the card is 640 px with an empty half page (`dashboard_exports__bookkeeper__desktop-he.png`).

### 3.5 DataTable: one primitive for every desk list

**Location and owner:** `apps/web/lib/components/table/` (`DataTable.tsx`, `MoneyCell.tsx`, `BatchBar.tsx`, `useTableUrlState.ts`), owned by `web-feature-engineer`.

**Engine:** headless `@tanstack/react-table` with `@tanstack/react-virtual` above 200 rows. `@tanstack/react-query` is already a dependency.

**Anatomy, top to bottom:**
1. **Toolbar (40 px):**
   - View tabs with live counts and ₪, e.g. "חוסמים (2 · ‎₪143.50)".
   - Table search (`/` focuses it when the table has focus).
   - Filter chips.
   - At the end: density, columns, ⤓ export.
2. **Batch bar.** It replaces the toolbar while at least one row is selected, and is sticky at `--desk-sticky-top`:
   - It reads: "‏3 נבחרו · ‎₪152.50 · [אשר 3 · ‎₪152.50] [⋯] [נקה · Esc]".
   - Per-row actions are disabled in batch mode.
3. **Header row:**
   - Sticky at `--desk-sticky-top`, with height equal to the body row.
   - Each sortable `<th>` holds a `<button>` and carries `aria-sort`.
   - On first render exactly one column is sorted and shows its arrow.
   - **₪ columns sort descending on first click**; text and dates sort ascending.
4. **Rows:**
   - Height `--row-compact` 32, `--row-default` 48, or `--row-touch` 56 under `pointer: coarse` whatever the density.
   - Hover: `surface-2`.
   - Selected: `primary/8` plus a 2 px inline-start bar and `aria-selected`.
   - Focus: the single `--c-focus` ring (R-5).
5. **Columns:**
   - **Select** (40): whole-row label; ≥44 px hit area on touch.
   - **Identity**: sticky at inline-start, min 200, wraps to 2 lines before truncating, always has a `title`, and never truncates shared prefixes.
   - **Money**, via `<MoneyCell agorot precision>`:
     - It wraps `formatIls`, which is unchanged.
     - Heebo with `tabular-nums lining-nums` (R-2).
     - **Physically right-aligned in both locales** (R-1).
     - Fixed decimals per column; ₪ goes in the header "סכום (₪)".
     - Exact agorot appear in `title`.
   - **Status:** chip with icon, word and role colour (C11). A roll-up shows its worst child.
   - **Due or age:** "נותרו 6 ימים · עד 31.10" (H8).
   - **Actions:** sticky at inline-end. At most **2** inline on hover or focus, plus "⋯", which is always visible on touch (C2).
6. **Totals:**
   - `tfoot` for ledgers and registers, or a pinned **top** total row for roll-ups (chain).
   - Same precision as the rows.
   - Label: "סה״כ (N שורות)".
   - Server-computed, so it never sums only the loaded page.
7. **Footer:**
   - "מציג 1–50 מתוך 312 · סה״כ ‎₪18,420.30", then the pager.
   - **No "load more" in money tables.** It stays in feeds only (activity).
8. **States:**
   - Layout-true skeleton (8 rows).
   - First-use empty: one CTA.
   - No results: "נקה סינון".
   - Error row: "לא נטען · נסה שוב". **Never ₪0** (A4).
   - Stale-while-revalidate keeps rows visible.

**Default sort per table type:**

| Type | Default sort |
|---|---|
| Queues | `block` first, then ₪ desc, then age desc |
| Registers | Date desc |
| Ledgers | Supplier asc |
| Roll-ups | Leak ₪ desc |
| Claims and recovery | Days to deadline asc within status |

**Batch rules:**
- `block` rows are never selectable; their checkbox is disabled with the visible reason "דורש בדיקה פרטנית" (R-12).
- Items above the ₪200 cap are excluded from select-all.
- The bar's ₪ is Σ|Δ| of the selection.
- Each item calls the **existing per-item procedure**. `approvals/engine.ts` is untouched.
- 10 s undo (R-7) and one audit entry per item.

**Props sketch:**

```ts
<DataTable<QueueRow>
  id="approvals"                                   // URL namespace + views key
  rows={page.rows} total={{ count: page.count, sumAgorot: page.sumAgorot }}  // server totals
  columns={cols} rowKey={(r) => r.id} defaultSort={[{ id: 'severity' }, { id: 'delta', desc: true }]}
  selectable={(r) => (r.severity === 'block' ? { disabled: t('table.blockReason') } : true)}
  batchActions={[{ id: 'approve', primary: true, label: (n, sum) => t('batch.approve', { n, sum }), run: approveEach }]}
  rowActions={(r) => [approveAction(r), disputeAction(r)]} onOpen={(r) => openSel(r.id)}
  peek={(r) => <InvoicePeek invoiceId={r.invoiceId} />}
  views={BUILTIN_VIEWS.approvals} exportable={{ csv: true, xlsx: true, link: true }}
/>
```

**Rollout order.** Each step is independently shippable:
1. approvals
2. pay run
3. invoices (new)
4. leaks/breakdown
5. leaks/claims
6. recovery
7. suppliers (manage + scores)
8. suppliers/ledger
9. orders
10. chain tables
11. catalog and contracts

### 3.6 SplitPane and Peek

- **`<SplitPane list detail sel>`:**
  - `sel` comes from `?sel=`.
  - J/K in the list swaps the detail **without a route change** (`router.replace` with `scroll:false`), and prefetches the next 3 rows' detail queries.
  - Back restores the selection and the list scroll (D8).
  - The divider is draggable from 320 to 560 and persisted.
- **`<Peek>`:**
  - Opens from the inline-end edge at 480/520 px, from cached data in under 100 ms (D6).
  - Space toggles it; Esc closes it and **returns focus to the row**.
  - It traps focus and has a "פתח במסך מלא" control (⌘Enter).
  - It never covers the batch bar.
- **Peek contents for an invoice:**
  - A header: supplier, number, ₪, status, due.
  - The line table with ordered / received / billed and one variance chip.
  - The document thumbnail.
  - The last 3 history entries.
  - Reuse `showcase/dashboard/_components/InvoiceScanViewer.tsx` and `InvoicePoCompareViewer.tsx`.

### 3.7 The drill contract (KPI → filtered list → transaction)

- **`<DrillLink to amountAgorot count scope label>`** renders an `<a data-drill data-drill-total="29600">` with the accessible name "נתפס לפני תשלום ‎₪296 — פתח 4 שורות".
- **The landing page echoes the clicked number** in its header from the **same tRPC procedure**: "‏‎₪296.00 · 4 חריגות פתוחות · אוק׳ 1–25 · כפר הזיתים". It also exposes `[data-drill-total]`.
  - If data moved in between, it shows a T4 line: "המספר התעדכן מאז: ‎₪296 → ‎₪311".
- **Every KPI label carries its scope.** The unlabelled same-name tiles today show different ₪, so scope is part of the label:
  - "נדרש מהספקים · החודש"
  - "נדרש מהספקים · כל הזמנים"
  - "עדיין חייבים לך · פתוח"
- **The breadcrumb carries the view.** For example: `חדר הבקרה › דליפה · אוק׳ 1–25 › קצביית הכרם › HK-24108`. Each crumb restores its exact query (P5).
- **The test** (`test-sentinel`): an e2e walks every `[data-drill]` on home, chain, the monthly report and the ledger, clicks it, and asserts that the landing `[data-drill-total]` is equal to the agora.

### 3.8 ViewBar and URL state (one grammar everywhere)

| Param | Meaning | Default | Where |
|---|---|---|---|
| `p`, `from`, `to` | Period | `this_month` | Every analytic and money page. **Replaces** `?m=0\|-1` (breakdown, claims, pay run) and `?month=` (reports) via 308 redirects |
| `cmp` | `off \| prev \| yoy` | **`prev` while the period is running** (aligned to-date; the engine exists) | Analytic pages |
| `b` | `all \| <restaurantId> \| g:<groupId>` | The user's primary scope; `all` for a chain owner | Every money page |
| `view` | Built-in or saved view id | Per role (§3.10) | DataTable pages |
| `q`, `sup`, `cat`, `type`, `sev`, `st` | Quick filter and filters | Empty | DataTable pages |
| `sort` | `col:dir[,col:dir]` | Per table type (§3.5) | DataTable |
| `cols` | Visible columns and their order | Per table | DataTable |
| `sel` / `peek` | Selected or peeked row | None | Split and Peek |
| `page` | Page | 1 | DataTable |
| `d` | Density override | Per-user setting | DataTable |

- The **period label is never absent**. A number without a period is the Shopify 2026 home regression.
- Every route also sets `<title>` to "‹object or page› · ‹period/scope› · RestoMatch".

### 3.9 Keyboard map

Every key is bound by `KeyboardEvent.code`. Keys are inactive while an input has focus, and queue keys are active only while the grid has focus (WCAG 2.1.4).

**Global keys:**

| Keys | Action |
|---|---|
| Ctrl/⌘+K | Command palette |
| `/` | Palette, or table search when a table has focus. Physical `Slash`, **and** `key === '/'`, which on the Hebrew layout is KeyQ |
| `?` | Cheat sheet |
| Ctrl/⌘+B | Rail |
| `G` then `H` / `Q` / `A` / `P` / `I` / `L` / `R` / `S` / `O` / `B` / `K` | Home / my queue / approvals / pay run / invoices / leaks / reports / suppliers / orders / chain / kitchen. Each chord must complete within 1,000 ms |
| Alt held 600 ms | Key hints on visible buttons |

**Table and queue keys (R-9):**

| Keys | Action |
|---|---|
| J / K, or ↓ / ↑ | Move |
| Enter | Peek, or open the detail in split mode |
| O | Open full page |
| ⌘/Ctrl+Enter | Open in a new tab |
| X | Select |
| Shift+X | Select a range |
| Ctrl/⌘+A | Select all eligible |
| 1 | Primary ("אשר כפי שחויב") |
| 2 | Dispute (reason chips, H6) |
| 3 | Defer |
| H | Snooze |
| Z | Undo |
| Esc | Clear or close |
| `[` / `]` | Previous / next row in the detail page |

**Palette** (D4, PT3):
- Sections in fixed order: Needs-you → מסכים → פעולות → ספקים / מוצרים / חשבוניות → "שאל את RestoMatch: …".
- Screens are client-side with no network call.
- Hebrew is normalised: wrong layout (`,bucv` → תנובה), final letters folded, geresh ignored.
- → or ← opens a 360 px peek.
- **Money actions only stage the normal confirm screen.** They never execute from the palette (Mercury Command).

### 3.10 Role defaults

| Role | Home | Default view on queues | Density |
|---|---|---|---|
| Owner | A (or C when `b=all`) | Approvals "חוסמים"; pay run "השבוע" | default 48 |
| Bookkeeper | B | Approvals "**הכל**" with "שלי" one click away; register "החודש"; pay run "מוכן לתשלום" | **compact 32** |
| Manager | Strip with warn approvals, orders to send, deliveries today and price alerts | Approvals "שלי" | default |

### 3.11 Desk performance budget

- **Shell:** the layout's data comes in **one** parallel batch. Today it is 5 sequential awaits; see exec-desktop-21.
- **Route change:** a layout-true `loading.tsx` per desk segment. The shell paints within 100 ms.
- **Palette:** open in ≤100 ms. **J/K detail swap:** ≤100 ms from cache.
- **Tables:** 500 rows virtualised, with no frame over 16 ms.
- **Home:** LCP ≤2.5 s, with the hero ₪ as the LCP candidate.

### 3.12 Acceptance checks (Playwright, 1440×900 and 1920×1080, he and en)

1. The top bar is ≤56 px. `main` content top is ≤180 px. No nav row wraps (`desktop-nav-row` is removed).
2. Owner home `scrollHeight` is ≤1,800. The Needs-you strip's bottom is ≤340, and every tile is an `<a>`.
3. Approvals shows ≥12 rows above the fold at default density and ≥18 at compact.
4. Every `[data-drill]` lands on a page whose `[data-drill-total]` is equal.
5. Each DataTable has exactly one `th[aria-sort]` that isn't `none`. Its totals equal the server sum.
6. From row 1, pressing J 9 times sets `?sel=` to row 10 with **0 document navigations**.
7. Changing scope fires **no** `waitForNavigation`. The totals equal Σ of the branch rows.
8. No dashboard `<title>` equals "RestoMatch".
9. A CI script fails on any `page.tsx` that is in neither the rail registry nor the palette registry, except `[id]` pages.
10. Ctrl+K dispatched as `code:'KeyK', key:'ל'` (Hebrew layout) opens the palette.

---

## 4. Findings

Format: `exec-desktop-NN · severity · kind · route · role · device`. Rubric IDs are in brackets. "Related" points to area reviews that hold page-level detail.

### P0

**exec-desktop-01 · P0 · trust · `/dashboard`, `/chain`, `/reports/monthly`, `/recovery`, `/approvals` · owner, bookkeeper · desktop [A9, B3, D6, H3]: numbers aren't doors, and same-named numbers disagree with no scope**
- **Problem:**
  - Only 1 of the 4 hero sub-tiles is a link (`page.tsx:440-452`: `HeroStat` gets `href` only for `returned`). None of the 4 chain KPI cards are links (`chain/page.tsx:205-243`).
  - The same label shows different ₪ across surfaces with no scope word:
    - "נדרש מהספקים" is **₪464** on the home and the monthly report, but **₪3,672** on recovery.
    - "עדיין חייבים לך" is **₪464** on the monthly report and **₪1,759** on recovery.
    - The monthly report shows ₪464 twice in one row, **green** as "נדרש" and **red** as "עדיין חייבים לך".
  - The approvals tiles "בתור / סכום בסיכון / חוסמים" are computed from the **loaded page** (`list.tsx:106-125`, `items.length`), so at 50+ items the "in queue" count undercounts.
  - The home's decision KPI is a **count**: "ממתינות לאישור 4", with no ₪.
- **Evidence:** `home_top.png`, `monthly_tiles.png`, `recovery_top.png`, `chain_kpis_ranking.png`; `apps/web/app/dashboard/page.tsx:144-162,440-452`; `chain/page.tsx:205-243`; `approvals/list.tsx:106-125`.
- **Recommendation:** ship the drill contract (§3.7).
  - Add `lib/components/DrillLink.tsx`.
  - Wrap all hero sub-tiles:
    - נתפס → `approvals?st=open`
    - נדרש → `leaks/claims`
    - הוחזר → `recovery?st=returned`
    - "13 מתוך 35" → `invoices?view=leak`
  - Wrap the chain KPIs, with `b=all`.
  - Wrap the monthly-report tiles and the ledger cells.
  - Add a scope suffix to every KPI label (`החודש` / `פתוח` / `כל הזמנים`) in `lib/i18n/messages/*`.
  - Make approvals tiles read server totals: a `myQueue` sibling `myQueueSummary({filters})` returning count and Σ agorot (router change plus a COVERAGE entry).
  - Landing headers echo the number.
  - Add the e2e equality test.
- **Exemplar:** Stripe balance summary (click an amount to see the itemised transactions; one source); Mosaic ("transaction-level detail within a few clicks").
- **Effort:** M · **Human PR:** no · **Related:** leaks-03, leaks-13, chain-07, approvals-08.

**exec-desktop-02 · P0 · functional · `/dashboard/invoices` (missing), `/dashboard/invoices/[id]` · owner, bookkeeper · desktop [H2, H7, D6, C1]: the transaction level of every drill doesn't exist**
- **Problem:**
  - There is **no invoice register**: `app/dashboard/invoices/` holds only `[invoiceId]`. Yet `roles.ts:84` already grants the route to 4 roles.
  - Every drill (approvals, breakdown, ledger, pay run, search) ends on `InvoiceCorrectionPage`. That page is an OCR **edit form** with 5 inputs and a line table. It has:
    - no status;
    - no discrepancies;
    - no ordered / received / billed;
    - no document;
    - no history;
    - no prev/next;
    - no decision;
    - no breadcrumb (`dashboard_invoices_ID__owner__desktop-he.png`).
  - The bookkeeper therefore can't answer "show me October's invoices that are ready to pay".
  - The **public showcase** has this register, with filter counts "הכל · 5 / עם חריגות · 4 / תקינות · 1 / עם חוסם · 1" (`showcase_invoices.png`).
- **Recommendation:**
  - **New `/dashboard/invoices`** (archetype E):
    - DataTable columns: date · ספק · מס׳ חשבונית · ₪ total · status chip (תקינה / חריגה / ממתינה לקבלה / ריכוז (T4) / שולמה) · ₪ leak · מספר הקצאה ✓/✗ · due · סניף (when `b=all`).
    - Built-in views: החודש · חריגות · מוכן לתשלום · ריכוז · ללא מספר הקצאה.
    - Split detail.
  - New `invoices.list({view, filters, sort, page, b})` in `packages/api/src/routers/`, with a COVERAGE entry.
  - **Turn `[invoiceId]` into a review view:**
    - header: status, ₪, due, allocation number;
    - document | lines split (H2);
    - the discrepancy decision;
    - history (H7);
    - `[`/`]` for prev/next;
    - "תקן נתוני OCR" moves into "⋯ ערוך".
  - **Port** `InvoiceScanViewer`, `InvoicePoCompareViewer` and the audit timeline from `app/showcase/dashboard/*` into `lib/components/invoice/` instead of rebuilding them.
- **Exemplar:** Ramp bill detail (image beside the fields, approval trail); Shopify order index (views as tabs, dynamic counts); R365 AP Center.
- **Effort:** L · **Human PR:** no (new procedure plus a COVERAGE entry; `tenant-security-warden` review) · **Related:** approvals-31, approvals-39, approvals-40, approvals-41.

**exec-desktop-03 · P0 · flow · `/dashboard` (bookkeeper), nav, `/approvals`, `/approvals/pay-run`, `/exports` · bookkeeper · desktop [D1, D7, C4, A5]: the bookkeeper cannot run a month from the desk**
- **Problem:** the role's whole job is unreachable or unfinishable.
  1. **The wrong landing.** The bookkeeper lands on the owner's control room, with a 914 px daily-leak chart and recipes (`bookkeeper_fold.png`; `page.tsx` has no bookkeeper branch beyond `vatRisk`).
  2. **Missing nav.** The nav has 8 items, with **no pay run, ledger, invoices or integrations**, although `ROUTE_ROLES` allows all of them. The ledger has **no path at all**.
  3. **A false inbox zero.** Their approvals page shows the T3 "אין חריגות בתור כרגע" while **4 items / ₪296 block payment** on the owner. `myQueue` filters by the viewer's role (`approvals.ts` `expandVisibleRoles`), and there is no "הכל / שלי" toggle (`bookkeeper_approvals_empty.png`).
  4. **A read-only pay run.** It has no mark-paid and no due dates (approvals-21/22).
  5. **A blind, unlogged export** (admin-05/06).
  6. **No close status** anywhere.
- **Recommendation:**
  - **"שולחן החשב"** home (archetype B).
    - Strip: routed-to-me, pay run, close X/6, VAT at risk, last export.
    - Below it: the **close checklist** with 6 auto-ticking items, each with owner, due and ₪ open:
      1. כל החשבוניות הותאמו
      2. חשבוניות ריכוז הוצלבו
      3. מספרי הקצאה התקבלו
      4. ריצת תשלומים אושרה
      5. מכתבי זיכוי נשלחו
      6. ייצוא בוצע
    - Next to the checklist: the invoice register.
  - Rail group "כסף": אישורים · ריצת תשלומים · חשבוניות · כרטסת ספקים · זיכויים · סגירת חודש וייצוא.
  - The approvals view tabs "שלי / הכל" default to **הכל** for the bookkeeper. Items routed to someone else render read-only, with "ממתין ל-בעלים · 3 ימים".
  - Pay-run actions per approvals-21: mark-paid uses the existing `invoice_status 'paid'` (`schema.ts:64-70`). Due date per approvals-22: `invoices.due_date` exists (`schema.ts:813`).
- **Exemplar:** Rillet close checklist (owners, deadlines, status; "day one is review"); R365 AP Center "My List" vs all; Ramp Homepage "All / My" filter.
- **Effort:** L · **Human PR:** no for the desk, checklist and nav. The export log (admin-06) needs a schema PR, which is human. · **Related:** command-10, approvals-15/21/22/23, admin-05/06, suppliers ledger reachability.

### P1

**exec-desktop-04 · P1 · ia · all desk routes · owner, bookkeeper, manager · desktop [D2, B9, A8, B1]: the shell is a phone layout stretched to 1,104 px**
- **Problem:**
  - 18 owner tabs wrap onto **two rows** (the `nav.tsx:168-174` comment admits "wider than the max-w-6xl header at every viewport"). The sticky header is **152 px**.
  - Content is `max-w-6xl` (`layout.tsx:123,175`): 1,104 px usable, which is 77% of 1440 and 57% of 1920.
  - The H1 is 36 px (`Heading.tsx:4`, against `heading-lg` 24 in B1).
  - The 2-row `ViewToolbar` sits **above** the T1.
- **Result:**
  - Owner home is 3,945 px (4.4 screens). Breakdown is 4,210, claims 5,162 and recovery 4,419.
  - The first approvals decision sits at y≈530 (470 without the lab banner).
  - Sign-out is a standing header button. The email is set in mono.
- **Evidence:** `home_top.png`, `approvals_fold.png`, `crawl-results.json` heights.
- **Recommendation:** build the desk shell per §3.2–§3.3.
  - `DeskRail` (248/64, Ctrl+B) replaces `DesktopNav`, organised by the job-ordered tree in `research/exec-desktop.md` §6.
  - A 56 px top bar with the breadcrumb, ⌘K, bell, ? and avatar (sign-out moves into the avatar).
  - Remove `max-w-6xl` from `main` in favour of the fluid container plus `--desk-max-analytic` for card grids.
  - H1 at `heading-lg`.
  - A 48 px sticky context bar replaces the 2-row toolbar.
  - Keep `MobileNav` below `lg`.
- **Exemplar:** Linear sidebar (Inbox / My issues / Favorites / Teams, collapsible); Ramp left nav with Insights as its own group; Shopify admin pinned items at the bottom.
- **Effort:** L · **Human PR:** no · **Related:** command-07/09, ia-map #3.

**exec-desktop-05 · P1 · functional · `/approvals`, `/approvals/pay-run`, `/leaks/breakdown`, `/leaks/claims`, `/recovery`, `/suppliers` · owner, bookkeeper · desktop [C1, C3, B6, A5]: every desk list is a stack of cards**
- **Problem:** on a 1440 screen:
  - **Approvals:** 315 px cards with an always-open "למה סומן?" box. **One decision per viewport**; 50 items is about 16,000 px.
  - **Breakdown:** 13 invoice cards over 4,210 px, including ₪0.00 rows ("חסר בכמות שהתקבלה ₪0.00").
  - **Pay run:** supplier cards.
  - **Claims:** full A4 letters stacked (5,162 px).
  - **Recovery:** 9 identical gold primaries.
  - **Suppliers:** contact cards with **no ₪ at all**, and the destructive "השבתה" inline beside "עריכה".
  - Only **orders** is a dense table.
- **Evidence:** `approvals_fold.png`, `breakdown_fold.png`, `payrun_fold.png`, `claims_top.png`, `recovery_top.png`, `dashboard_suppliers__owner__desktop-he.png`.
- **Recommendation:**
  - At ≥1024 each of these renders through DataTable (§3.5): 48 px default rows, or 32 px compact.
  - Explanation goes in the detail or peek pane, plus a one-line H1 summary in the row ("צפוי ‎₪522.60 → חויב ‎₪575.00").
  - Claims become a table of letters (supplier · lines · ₪ · status · due). The letter itself opens in the detail pane, so printing stays.
  - The supplier list gains money columns: רכש החודש ₪ · דליפה ₪ · זיכויים פתוחים ₪ · יתרה פתוחה ₪ · משלוח הבא. "השבתה" moves into "⋯".
  - Cards stay below 768 px.
- **Exemplar:** Polaris IndexTable (`condensed`, promoted bulk actions; bulk hidden only below 490 px); Gmail density; Linear list rows.
- **Effort:** L · **Human PR:** no · **Related:** approvals-02/25, leaks-12, chain-06/08, area-suppliers.

**exec-desktop-06 · P1 · functional · all tables · owner, bookkeeper · desktop [C1, C2, C3, B4, A4]: there is no table primitive, so every table re-invents (and drops) the basics**
- **Problem:** there are 29 `<table>` elements in 20 files. Across all of them:
  - **0** `aria-sort`;
  - **1** sticky header;
  - **1** `tfoot` (claims);
  - no column chooser;
  - no server-side counts or totals.
- **Paging and totals:** money lists paginate with "load more" (6 call sites), so any summary over them describes the loaded rows only.
- **Row actions disagree** between tables:
  - Catalog shows a red trash, disable and edit on every row, always visible (`catalog_top.png`).
  - Contracts shows trash and edit (`contracts_top.png`).
  - Orders shows nothing.
- **"—" fillers:** the ledger cells are not links, and "—" stands in for "no invoices" (`dashboard_suppliers_ledger__owner__desktop-he.png`; A4).
- **Recommendation:**
  - Build `lib/components/table/DataTable` (§3.5) with `MoneyCell`, `StatusCell`, `DueCell`, `BatchBar`, `ColumnsMenu`, `ExportMenu` and `useTableUrlState` (`sort`, `cols`, `page`, `sel`, `view`).
  - Every list procedure returns `{rows, count, sumAgorot}`.
  - Migrate in the §3.5 order.
  - Add `test-sentinel` checks:
    - exactly one `th[aria-sort]`;
    - totals equal the server sum;
    - `truncate` always has a `title`.
- **Exemplar:** GitHub Primer DataTable; Polaris IndexTable; IBM Carbon data table sizes.
- **Effort:** L · **Human PR:** no.

**exec-desktop-07 · P1 · flow · `/approvals`, `/leaks/breakdown`, `/suppliers/ledger`, `/orders`, `/recovery` · owner, bookkeeper · desktop [D6, D8, H2]: no split pane or peek, so every check costs a page load and your place**
- **Problem:**
  - "פתח חשבונית / תקן OCR" (`list.tsx:193-200`), ledger links (`ledger-ui.tsx:128,151`), breakdown "פתח חשבונית" and order rows all do full navigations.
  - Back reloads page 1 of the queue: `refreshFirstPage` holds no selection, and nothing records the scroll position.
  - There is no `?sel=` anywhere (`state.ts` has no such key).
- **Recommendation:**
  - Add `SplitPane` and `Peek` (§3.6). Approvals uses the 3-pane at ≥1536.
  - Breakdown, ledger and chain tables use Space-peek.
  - Registers use split with `?sel=`.
  - The target is "open → decide → next" with 0 page loads.
- **Exemplar:** Linear Peek (Space toggles, "similar to Quicklook"); Ramp approve-from-inbox; Superhuman auto-advance.
- **Effort:** M · **Human PR:** no · **Related:** approvals-09, approvals-40.

**exec-desktop-08 · P1 · functional · `/approvals`, `/approvals/pay-run`, `/inbox`, `/leaks/claims`, `/recovery` · owner, bookkeeper · desktop [C2, I2, C10, R-12]: no batch action anywhere money moves**
- **Problem:**
  - There are no checkboxes on approvals, pay run, inbox or claims.
  - Recovery's checkboxes (`tracker-client.tsx:340-383`) only choose lines for a letter.
  - A month-end queue of about 150 items is 150 × (scroll + click + refetch).
  - Decisions refetch page 1 instead of exiting optimistically (`list.tsx:65-76`).
- **Recommendation:**
  - DataTable batch mode (§3.5): `useSelection` plus `BatchBar`, "N נבחרו · ‎₪X · [primary] [⋯] [נקה]".
  - `block` rows are disabled with a visible reason, and items over the ₪200 cap are excluded (R-12).
  - Each item calls the existing per-item mutation, with an optimistic exit and a 10 s undo (R-7).
  - Pay run: "סמן כשולם" (approvals-21).
  - Claims: "שלח N מכתבים", previewed and then deferred with "בטל שליחה" (R-8). The outbound part needs `outbox.ts`, so it is a human PR; until then the batch action is "הדפס / PDF N מכתבים".
- **Exemplar:** R365 bulk approve/deny; Ramp release payments from the Inbox; IBM Carbon batch actions.
- **Effort:** M · **Human PR:** no (sending through outbox is human) · **Related:** approvals-02/37, chain-03, FG-22.

**exec-desktop-09 · P1 · functional · global · owner, bookkeeper · desktop [D4, I6, F8]: no command palette and no keyboard layer**
- **Problem:**
  - `search.tsx` searches only suppliers, products and invoices (`searchOptions.ts:11`), from 2 characters with a 250 ms debounce.
  - It has **no Ctrl/⌘+K and no `/`**, and finds **no screens and no actions**.
  - `keydown` listeners exist only in the nav drawer, the branch switcher, `names-grid` and TV mode.
  - The 25 routes with no nav entry (ia-map) can only be reached by in-page links.
- **Recommendation:**
  - **Palette** per §3.9. Wrap `DashboardSearch` in a `Dialog`, add `kind: 'screen' | 'action'` to `searchOptions.ts`, and build a `lib/navRegistry.ts` shared by the rail, the palette and the orphan-route CI check.
  - **`lib/hotkeys.ts`** with G-chords and queue keys, **bound by `code`**, so the Hebrew layout works without switching keyboards.
  - A `?` cheat sheet and Alt-hold hints.
  - After 3 mouse approvals, a one-time coach mark: "טיפ: 1 לאישור, 2 לחלוקה".
- **Exemplar:** Linear (⌘K runs any action, G-chords, `?`); Shopify admin (⌘K from any page, sequences within about 1 s); Odoo hold-Alt hints; Superhuman.
- **Effort:** M · **Human PR:** no · **Related:** command palette items in area-command, ia-map #10.

**exec-desktop-10 · P1 · flow · `/dashboard`, `/leaks*`, `/chain`, `/reports/*`, `/approvals/pay-run`, `/leaks/claims` · owner, bookkeeper · desktop [A2, A3, D8]: three period grammars, and comparison is off by default**
- **Problem:**
  - **Three period grammars:**
    - `p/from/to/cmp` via `ViewToolbar` (6 surfaces);
    - `?m=0|-1` (breakdown, claims, pay run);
    - `?month=YYYY-MM` (leak report, monthly report, digest).
  - Ledger, recovery, orders and suppliers have **no period control**.
  - `DEFAULT_VIEW.compare = 'off'` (`state.ts:70`). Every toolbar shows "ללא השוואה", although the **aligned to-date engine exists** (`leak-views.ts:95-113`).
  - Instead, the hero's only comparison is a full-month caption, "חודש קודם: ₪1,059", beside an MTD ₪760 (`page.tsx:422-424`; command-04 holds the S0 detail).
  - The chain hero has no delta.
- **Recommendation:**
  - One `ViewBar` (§3.8) on every analytic and money page.
  - `cmp` defaults to `prev` while the period is running. The engine is already aligned, so only `DEFAULT_VIEW` and the hero's caption change.
  - 308-redirect `m` and `month` to `p` plus `from`/`to`.
  - The context bar sentence always names both ranges.
  - Colour by meaning (`DeltaBadge upIsGood`).
- **Exemplar:** Stripe home (a comparison-range dropdown); R365 OPTD/OYTD aligned to-date; Mercury Insights (time-frame top-right, comparisons across periods); the Shopify 2026 home-period regression as the anti-pattern.
- **Effort:** M · **Human PR:** no · **Related:** command-04, leaks-05, chain-16.

**exec-desktop-11 · P1 · functional · `/chain`, all money lists, `/exports` · owner (chain), bookkeeper · desktop [D8, D1, FG-37]: multi-branch is a session switch, not a scope**
- **Problem:**
  - Every "כניסה" and "מעבר לסניף" runs `switchBranchAction` and then `window.location.assign('/dashboard')` (`chain/switch-button.tsx`; `branch-switcher.tsx:84`). That is a full reload **to that branch's home**.
  - No money list (approvals, pay run, invoices, claims, recovery, ledger, exports) has an "all branches" scope or a branch column.
  - The chain view is owner-only (`roles.ts:94`), so a chain's bookkeeper has no roll-up.
  - The ranking table has no pending-approvals ₪, open-claims ₪ or delta columns, no total row and no sort.
  - Task 8 in §2 costs 3 clicks and 1 reload, and 2 clicks and 1 reload to return.
- **Recommendation:**
  - A **`b` URL param** and a **scope chip** at the top of the rail (popover 320 px: כל הסניפים / groups / branches, each with ₪ leak and open count). It applies instantly, with no reload.
  - With `b=all`, money lists gain a "סניף" column and filter; the strip sums with a per-branch split.
  - Reads aggregate per membership, as `aggregateChain` does today.
  - **Writes run in the row's own tenant context** (`withRestaurant(row.restaurantId)` after a membership check). `rls.ts` and `applyCoreTenantRls` are untouched.
  - Every new procedure gets a COVERAGE entry and `tenant-security-warden` review.
  - The chain ranking becomes the matrix (archetype C), with a pinned total row and every cell a DrillLink.
  - "כניסה" is renamed "פתח את התור של הסניף" and points to `approvals?b=<id>`.
  - Open the chain view to `bookkeeper` on chain accounts (ROUTE_ROLES plus a router check).
- **Exemplar:** Toast "You are viewing" (a group auto-selects its children); R365 Location Group on every widget; Rillet consolidated ↔ entity "with the flip of a switch".
- **Effort:** L · **Human PR:** no (warden gate; never widen RLS) · **Related:** chain-11/12/18, approvals-13, admin-07.

**exec-desktop-12 · P1 · ia · `/dashboard` · owner, manager · desktop [A1, A5, A8, D1]: the home is a report to scroll, not a desk to act from**
- **Problem:**
  - The decision KPI is a count at **y≈2,206**.
  - **914 px** of 24 daily bars sit between the hero and the decisions (y≈1,267–2,181).
  - The hero has 4 sub-tiles plus 4 links (the "מה מאחורי המספר" danger-solid button, report, digest, proof).
  - VAT at risk (₪1,123), the one T2 item with a deadline, is a full-width card.
  - There is no unified "לטיפולי" queue.
  - The activity feed is at y≈3,250.
- **Evidence:** `dashboard__owner__desktop-he.png`, `home_top.png`, `home_mid.png`; `page.tsx:194-277`.
- **Recommendation:**
  - Use archetype A (§3.4). The **Needs-you strip** comes first, in ₪, with 5 tiles that each link (blocking ₪143.50·2, warn ₪152.50·2, pay run ₪5,901.02·8, claims ₪464 · N suppliers, VAT ₪1,123·154 days).
  - The hero is ≤240 px, with the aligned delta and a 120×32 sparkline.
  - Next to the hero, the 4-state recovery funnel as DrillLinks.
  - Then the top-suppliers DataTable and an alerts rail.
  - The full trend sits behind a remembered disclosure.
  - The page is ≤1,800 px.
  - The "לטיפולי" rail item is phase 1 of the unified queue (approvals with tabs).
- **Exemplar:** Ramp Homepage (the task feed replaced the Inbox; collapse persists); R365 "My List".
- **Effort:** M · **Human PR:** no · **Related:** command-02/07/09.

**exec-desktop-13 · P1 · trust · `/showcase/dashboard/invoices` vs `/dashboard/invoices/[id]` · owner (prospect), bookkeeper · desktop [J3, H2, H7]: the demo sells a desk the product doesn't have**
- **Problem:** the public showcase has:
  - an invoice register with filter counts;
  - an audit timeline (`AuditTimelineEvent`);
  - a scan viewer;
  - a PO-vs-invoice compare viewer;
  - keyboard close (`_detail.tsx`, `_components/InvoiceScanViewer.tsx`, `InvoicePoCompareViewer.tsx`).

  A prospect who signs up then gets a correction form and no register. J3 rates client-facing demo drift as S1, and the gap undermines "one number an owner believes".
- **Evidence:** `showcase_invoices.png` vs `dashboard_invoices_ID__owner__desktop-he.png`.
- **Recommendation:**
  - Move the three viewers and the timeline into `apps/web/lib/components/invoice/`, with props fed by real tRPC data.
  - The showcase then renders the **same** components with mock data, and drops its own GSAP sheet.
  - Ship them inside exec-desktop-02.
- **Exemplar:** Stripe (dashboard, docs and demos are one product); Linear.
- **Effort:** M · **Human PR:** no · **Related:** ia-map #20, approvals-40.

**exec-desktop-14 · P1 · states · `/approvals`, `/leaks/breakdown`, all tables · bookkeeper, owner · desktop [B6, H1]: density changes padding, not rows, and compact hides the explanation**
- **Problem:**
  - `d=compact` only shrinks card padding (`list.tsx:133,161`) and **drops `WhyFlagged` entirely** (`list.tsx:191`). H1 rates hiding the explanation in any density as S1.
  - Density is a per-page URL param, not a user setting.
  - There are no row-height tokens.
- **Recommendation:**
  - Row tokens `--row-compact` 32, `--row-default` 48, `--row-touch` 56 (B6) in `ui-tokens`.
  - A per-user density setting, with defaults by role (bookkeeper compact). The `d` param overrides it.
  - In compact, the explanation collapses to one line that **keeps the ₪ math**: "צפוי ‎₪522.60 · חויב ‎₪575.00 · Δ ‎₪52.40 · סף ±2%".
  - Below 1024, label the setting "במסכים רחבים".
- **Exemplar:** Gmail Default / Comfortable / Compact; IBM Carbon table sizes; Stripe Radar compact signals.
- **Effort:** S · **Human PR:** no.

**exec-desktop-15 · P1 · functional · all DataTable pages · owner, bookkeeper · desktop [D8, C1]: saved views are a per-browser dropdown on 6 pages**
- **Problem:**
  - `savedViews.ts` stores views in `localStorage` (`rm:views:<page>`, at most 20). They are invisible to the bookkeeper, lost on a new laptop, have no counts, and come with no built-in views.
  - `ViewToolbar` (and so saved views and CSV) exists on **6 surfaces only**. Pay run, claims, recovery, ledger, orders and suppliers have none.
  - There is no "copy link" and no favourites.
- **Recommendation (interim, no schema):**
  - View **tabs** above each DataTable, showing built-in views defined in code (`lib/components/table/views.ts`) with live count and ₪ fetched in one batched call:
    - approvals: חוסמים · ממתין · שלי · הכל
    - pay run: השבוע · מוכן לתשלום · מושהה
    - invoices: as exec-desktop-02
    - claims: לשליחה · נשלחו · באיחור
  - Personal views stay in localStorage as extra tabs.
  - Add "העתק קישור", since the URL already carries the view.
  - ☆ pins a view or an entity to the rail's מועדפים (at most 7, localStorage).
  - A modified view shows a dot and "שמור / שמור כחדש".
- **Exemplar:** Shopify order views (filters, columns, order and sort saved as tabs; dynamic); Linear Favorites in the sidebar.
- **Effort:** M · **Human PR:** no.

### P2

**exec-desktop-16 · P2 · functional · all DataTable pages, `/reports/digest` · owner, bookkeeper, manager · desktop [D8, D9]: no team views, role defaults or scheduled subscriptions (human PR)**
- **Problem:**
  - An owner can't publish "מוכן לתשלום" as the bookkeeper's default.
  - No view can be emailed every Sunday at 07:00.
  - The digest is a fixed preset.
- **Recommendation:**
  - A `saved_views` table: `{id, restaurant_id, page, name, query, scope: personal|restaurant, role_default, created_by}`. It needs RLS like the core tables.
  - A `view_subscriptions` table: `{view_id, cadence: daily|weekly|monthly, hour, recipients[]}`.
  - The UI: "שמור לכל הצוות", "ברירת מחדל ל-חשב/ת" and "שלח לי ▾" (daily or Sunday 07:00, or the 1st 07:00 Israel time). The email holds the ₪ summary with its period, a "פתח בתצוגה" link and the CSV. One-click unsubscribe.
  - Until it ships, the UI hides these controls.
- **Exemplar:** Linear "Set default for everyone"; Stripe Sigma scheduled queries (CSV link, unsubscribe); Toast email export.
- **Effort:** L · **Human PR:** **yes**. It needs `packages/db/src/schema.ts` plus a new migration (schema), and `packages/api/src/notifications/outbox.ts` with `apps/worker/src/cron.ts` (delivery).

**exec-desktop-17 · P2 · functional · all tables · bookkeeper · desktop [C1, A9]: export is page-specific, CSV-only and can't carry a link**
- **Problem:**
  - CSV is available only from `ViewToolbar` (6 surfaces), the pay-run button and the ledger button.
  - There is no XLSX, no "copy view link" and no export on orders, suppliers, recovery, claims or contracts tables.
  - Exported files have no period or scope header row.
  - Export-page problems are in admin-04 to admin-07.
- **Recommendation:**
  - A DataTable `ExportMenu` (⤓) with:
    - CSV, which keeps the BOM (`views/csv.ts`);
    - XLSX, generated client-side with a light writer or server-side;
    - "העתק קישור לתצוגה";
    - print.
  - The first rows of every file name the period, scope, filters and generated-at time (Asia/Jerusalem).
  - Totals rows are included.
- **Exemplar:** Stripe per-section "Download"; Toast export to download or email.
- **Effort:** S · **Human PR:** no · **Related:** admin-04/05/06/07.

**exec-desktop-18 · P2 · copy · every dashboard route · all · desktop [J4, D5, F5]: every desk tab is titled "RestoMatch"**
- **Problem:**
  - There are 0 `metadata`/`generateMetadata` exports under `app/dashboard`.
  - All 98 dashboard captures have `title = "RestoMatch"` (`crawl-results.json`).
  - Bosses who keep the queue, the pay run and 3 invoices open in tabs can't tell them apart, and browser history is useless.
- **Recommendation:**
  - In the root `app/layout.tsx`, set `title: { default: 'RestoMatch', template: '%s · RestoMatch' }`.
  - Every page exports `generateMetadata`, for example:
    - "תור אישורים (4)"
    - "MF-24950 · דגי הים התיכון"
    - "דליפה · אוק׳ 2026"
  - Counts in queue titles refresh on focus.
- **Exemplar:** Linear and Gmail tab titles with counts; Stripe object tab titles.
- **Effort:** S · **Human PR:** no.

**exec-desktop-19 · P2 · functional · `/dashboard`, `/leaks`, `/chain` · owner · desktop [A2, A3]: the delta is never explained**
- **Problem:** "Why did the leak change?" takes about 4 clicks and is never answered in words. The leaks hub shows "דליפה לפי ספק" bars with no comparison, and the chain ranking has no driver.
- **Recommendation:**
  - A `leakDrivers({view, compare, b})` query in `packages/charts` (charts SQL, owner `matching-engine-guardian`), consumed through tRPC.
  - It returns the top 3 (supplier, product, type) contributors to Δ, in ₪.
  - Render at most 3 chips in the context bar and under the hero, e.g. "‎+₪74 קצביית הכרם · אנטריקוט +7.2%". Each chip is a DrillLink.
  - The same chips appear per chain matrix row.
  - Colour follows meaning.
- **Exemplar:** Pigment Insights (ranked drivers with written summaries); Runway variance (cost metrics with reversed colours).
- **Effort:** M · **Human PR:** no (charts SQL is not immutable; `engine.ts` is untouched).

**exec-desktop-20 · P2 · ia · nav · owner, bookkeeper · desktop [D2, A7]: the only nav badge is a red count on a price alert**
- **Problem:**
  - `NavBadge` renders only for `contracts` (`nav.tsx:155-163`). It uses a danger tint (`bg-danger/15 text-danger`) for one non-blocking price alert, which cries wolf (A7).
  - Approvals (₪296, 2 blocking), pay run (due date), invoices (needs review) and claims (₪464) have no badge.
- **Recommendation:** use the rail badge spec (§3.3):
  - ₪ on money items, in full digits;
  - a danger dot only when `block` items exist;
  - neutral style for price alerts below materiality (≥3% and ≥₪50 per month, A5);
  - refreshed every 60 s and on focus.
- **Exemplar:** Linear Inbox counts; Ramp Homepage action items.
- **Effort:** S · **Human PR:** no.

**exec-desktop-21 · P2 · perf · every desk route · all · desktop [I1, I4, C8]: the shell and the home load as waterfalls, and 38 of 43 pages have no skeleton**
- **Problem:**
  - `layout.tsx` awaits in sequence: `myMemberships` → `Promise.all` → `ask.status` → `getWave1Access` → `chain.branches` (L36–98).
  - The home also awaits in sequence:
    - `enabledFeatures` → `vatAtRisk` (L63–67), **before** its `Promise.all`;
    - then `leakProofNs` (L91), `returnedThisMonth` (L97) and `owner.leaks` (L112).
  - Only 5 `loading.tsx` files exist (approvals, exports, receiving, settings, suppliers).
  - Lab load: owner home **2,039 ms**, against about 1,500 ms for other pages (`crawl-results.json`).
- **Recommendation:**
  - Fold every independent call into one `Promise.all` in each of the two files.
  - Add a layout-true `loading.tsx` to each desk segment: home, leaks, chain, reports, invoices, pay run, ledger. They should copy the §3.4 grids.
  - Stream T1 first.
  - Prefetch on hover for rail items.
  - Prefetch the next 3 `sel` rows.
- **Exemplar:** Linear (local-first, instant navigation); Next.js prefetch down to the nearest loading boundary; Polaris SkeletonPage.
- **Effort:** M · **Human PR:** no · **Related:** command-28, approvals-19.

**exec-desktop-22 · P2 · ia · `/invoices/[id]`, `/leaks/*`, `/recovery`, `/reports/*`, `/approvals/pay-run` · owner, bookkeeper · desktop [D5, D7]: wayfinding has three patterns, and crumbs lose the view**
- **Problem:**
  - Pages use `Breadcrumbs` (10 files), a "back" link (breakdown, proof, report and pay run use "חזרה לחדר הבקרה" or "תור אישורים"), or nothing (invoice, claims, recovery, reports).
  - Crumbs never carry the period, filters or scope.
  - The ledger crumb points to `/dashboard/suppliers`, which the bookkeeper can't open (D7).
- **Recommendation:**
  - One breadcrumb in the top bar, generated from `navRegistry`, carrying the serialized view of each ancestor.
  - It drops any crumb the role can't open.
  - It always names the period and scope on analytic pages.
- **Exemplar:** Stripe object pages (breadcrumb plus object header); Runway (P&L → department → vendor).
- **Effort:** S · **Human PR:** no · **Related:** approvals-41, leaks-20, ia-map #6/#7.

**exec-desktop-23 · P2 · flow · branch switcher (all desk pages) · owner, manager with 2+ memberships · desktop [D8]: switching branch throws away the page you were on**
- **Problem:** `BranchSwitcher` and `SwitchBranchButton` always run `window.location.assign('/dashboard')` (`branch-switcher.tsx:84`, `chain/switch-button.tsx`). Comparing "approvals in Jerusalem" with "approvals in Haifa" costs 2 extra clicks and a reload each way.
- **Recommendation:**
  - After `switchBranchAction`, call `router.replace(currentPathWithoutIds + preservedQuery)` and `router.refresh()`.
  - Fall back to `/dashboard` only for `[id]` routes or routes the target role can't see.
  - This is a quick win before scope (exec-desktop-11) lands.
- **Exemplar:** Linear workspace/team switch keeps the view type; Toast keeps the report when the location changes.
- **Effort:** S · **Human PR:** no · **Related:** ia-map #11, chain-11.

**exec-desktop-24 · P2 · visual · `/dashboard`, `/leaks`, `/chain`, `/exports`, `/recovery` · owner, bookkeeper · desktop [A8, C12, B9]: controls outrank money and primaries multiply**
- **Problem:**
  - On the home and leaks pages, a 2-row toolbar comes **before** the T1: period, compare, 5 filters, chart type, CSV, saved views and full screen.
  - Exports has two solid primaries side by side (green CSV and gold "קובץ אחיד").
  - Recovery has 9 solid gold "רישום תעודת זיכוי" buttons.
  - Exports leaves half the page empty at 1440 (`dashboard_exports__bookkeeper__desktop-he.png`).
- **Recommendation:**
  - Put the controls in the one-row context bar, with "תצוגה" and "סינון (N)" popovers.
  - One primary per region (C12). On recovery, the row action becomes a ghost button with "⋯", and the page primary is "רשום תעודת זיכוי" in the header.
  - Exports uses archetype H with the preview aside.
- **Exemplar:** Linear (opinionated defaults, controls in "Display"); Apple HIG (one or two prominent buttons per view).
- **Effort:** S · **Human PR:** no · **Related:** approvals-30, chain-08, admin-04.

---

## 5. Big moves (ranked by ₪ value ÷ risk)

| # | Move | Why | What | Device | Effort | Exemplar |
|---|---|---|---|---|---|---|
| BM-1 | **Desk shell**: rail, 56 px top bar, context bar, fluid panes, per-route titles, ⌘K and hotkeys | Removes the 2-row nav, the 152 px header and the phone layout. Every later move plugs into it | 04, 09, 18, 20, 22, 23, 24; `DeskRail`, `TopBar`, `ContextBar`, `navRegistry`, `hotkeys.ts`, title template | desktop | L | Linear, Shopify admin, Ramp |
| BM-2 | **One DataTable plus SplitPane and Peek**, rolled out to the 11 desk lists | Turns 1 decision per screen into 13–20 rows; "open → decide → next" with 0 page loads | 05, 06, 07, 08, 14, 15, 17 | desktop | L | Polaris IndexTable, Linear Peek, Ramp Inbox |
| BM-3 | **Drill contract**: every ₪ is a door, and the landing page echoes it to the agora | The owner must believe the number. Today the same label shows 3 different ₪ | 01, 12, 19; `DrillLink`, scope suffixes, e2e equality | both | M | Stripe balance drill, Mosaic |
| BM-4 | **Bookkeeper desk**: invoice register, invoice review view, pay-run actions, close checklist, export preview | The role can't finish its month in the app; the showcase already sells this desk | 02, 03, 13 (+ approvals-21/22, admin-05) | desktop | L | Rillet close checklist, Ramp bill detail, R365 AP Center |
| BM-5 | **Scope, not session**: `b=all` on every money list, a matrix roll-up, and writes in the row's own tenant | The chain plan's value is "one queue instead of 5 logins" | 11, 23 (+ chain-11/12/18, admin-07) | desktop | L (warden gate) | Toast "You are viewing", R365 Location Group, Rillet |
| BM-6 | **One period and compare grammar, plus drivers** | Every number gets its period and an honest, aligned delta with a reason | 10, 19 | desktop | M | Stripe comparison range, Pigment Insights |
| BM-7 | **Shared views and subscriptions** (human PR) | Team defaults per role, plus a Sunday 07:00 email of any view | 16 | desktop | L | Linear "default for everyone", Stripe Sigma schedules |

**Order:**
- **Phase 1** (no immutables, no new procedures): BM-1, the BM-3 links, 12, 14, 18, 23.
- **Phase 2:** BM-2, and BM-4 with the new `invoices.list` and summary procedures and COVERAGE entries.
- **Phase 3:** BM-5 (warden) and BM-6.
- **Phase 4** (human PRs): BM-7, plus the export log (admin-06).

---

## 6. Platform capability audit

Grep of `apps/web/app` and `apps/web/lib`, excluding tests, at `8fef118c`.

| Capability | Today | Target |
|---|---|---|
| Sidebar / rail | 0 (2-row tab strip, `nav.tsx:191`) | 1 `DeskRail` |
| Content container | `max-w-6xl` (`layout.tsx:123,175`) | Fluid, plus `--desk-max-analytic` |
| `<table>` | 29 in 20 files, hand-rolled | 1 `DataTable` |
| `aria-sort` | **0** | 1 per table |
| Sticky table header | 1 | All |
| `tfoot` / totals rows | 1 (claims) | Every money table |
| Row selection for batch | 0 (recovery has a letter picker only) | Approvals, pay run, inbox, claims, recovery |
| Split pane / peek | 0 in the product (the showcase has a sheet) | Registers and queues |
| `?sel=` / `sort` / `cols` / `b` URL params | 0 | All DataTables |
| Global hotkeys / ⌘K | 0 / 0 | Palette plus `hotkeys.ts` |
| `ViewToolbar` surfaces | 6 | All analytic and money pages (as the ViewBar) |
| Saved views storage | localStorage (`savedViews.ts`) | Built-in tabs, then server (human PR) |
| Export formats | CSV (BOM) | CSV, XLSX, link, print |
| `generateMetadata` under `/dashboard` | **0** | 43 |
| `loading.tsx` under `/dashboard` | 5 | Every desk segment |
| Invoice register route | Missing (`invoices/` has only `[invoiceId]`) | `/dashboard/invoices` |
| Pay-run mutations | 0 (2 queries in `payRun.ts`) | Mark paid, hold, net (approvals-21) |
| Branch scope param | 0 (session switch plus reload) | `b=` everywhere |

---

## 7. Rubric scorecard (desk archetypes, this lens)

| Criterion | Score | Why |
|---|---|---|
| A1 One T1, one action | Partial | One ₪ hero, but 4 equal-weight hero links plus a danger-solid button |
| A2 Hero tells the story | **Fail** | No delta by default; a full-month caption beside MTD (command-04); no completeness line on chain |
| A5 T2 first, in ₪ | **Fail** | Decisions are a count at y≈2,206 |
| A8 Emphasis budget | **Fail** | A 2-row toolbar above T1 |
| A9 One number, one name | **Fail** | "נדרש מהספקים" is ₪464 vs ₪3,672 with no scope |
| B3 Precision contract | Partial | Approvals tiles sum only the loaded page |
| B6 Density by persona | **Fail** | Padding only; compact hides meaning |
| B9 Layout, width | Partial | One container, but too narrow; tables don't get the widest one |
| C1 Tables sort/stick/wrap | **Fail** | 0 `aria-sort`, 1 sticky header |
| C2 Batch mode | **Fail** | None on money queues |
| C8 Designed states | Partial | 5 of 43 have `loading.tsx` |
| C12 Action hierarchy | Partial | Exports has 2 primaries; recovery has 9 |
| D1 Role lands on its job | **Fail** | The bookkeeper lands on the owner room |
| D2 Nav by job, honest badges | **Fail** | 18 tabs wrap; one red badge on a price alert |
| D4 Palette | **Fail** | No hotkey, entities only |
| D5 Where am I | Partial | Three wayfinding patterns |
| D6 Glance, peek, page | **Fail** | Every check is a page load |
| D7 Reachability | **Fail** | The bookkeeper has no path to the ledger or pay run |
| D8 State in URL | Partial | Views yes; selection, sort and scope no; branch switch loses the page |
| H2 Evidence beside data | **Fail** | The invoice page is a form; the scan is a separate page |
| H7 History | **Fail** | No per-invoice history (the showcase has one) |
| I2 Optimistic, advance | **Fail** | `refreshFirstPage` |
| I4 Skeletons | **Fail** | No skeleton on home, leaks or chain |
| I6 Keyboard triage | **Fail** | None |
| J3 One product on every surface | **Fail** | The showcase desk is ahead of the product |
| J4 Craft (titles) | Partial | Every tab is "RestoMatch" |

---

## 8. Governance (AGENTS.md)

| Change | Owner agent | Immutable touch? |
|---|---|---|
| `DeskRail`, `TopBar`, `ContextBar`, `DataTable`, `SplitPane`, `Peek`, `DrillLink`, palette, hotkeys, titles, `loading.tsx` | `web-feature-engineer` | No |
| `--desk-*` and `--row-*` tokens, rail and badge styling, density tokens | `rtl-design-steward` | No |
| `MoneyCell` | `web-feature-engineer`, reviewed by `money-format-marshal` | **Wraps** `formatIls` only; no new option, no compact notation |
| `invoices.list`, `myQueueSummary`, cross-branch reads and writes (`b=all`) | `web-feature-engineer` plus a **`tenant-security-warden` gate** | Adds COVERAGE entries (allowed). Never touches `rls.ts` / `applyCoreTenantRls` |
| `leakDrivers` query | `matching-engine-guardian` (charts SQL), consumed via tRPC | Charts SQL is not immutable; `engine.ts` is untouched |
| Batch approve / mark paid | `web-feature-engineer` | `approvals/engine.ts` is untouched: one call per item, and `block` is never bulk |
| Server saved views, role defaults, subscriptions; export log | Human | **Yes**: `packages/db/src/schema.ts` plus a migration, `notifications/outbox.ts`, `apps/worker/src/cron.ts` |
| Orphan-route and drill-equality CI checks | `test-sentinel` writes them; a human adds the gate step | `.github/workflows/*` is human-only |

**North Star check:**
- BM-1 to BM-3 **deliver** the ₪ faster and make it **believable**: the same number on both sides of every click.
- BM-4 and BM-5 **protect** it: no early payment of disputed money, and every branch's leak in one place.
- Nothing here adds anti-ICP scope. There is no widget builder (the R365 200-widget approach is rejected).
