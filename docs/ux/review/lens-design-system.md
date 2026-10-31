# Lens review: design system and visual consistency (`design-system`)

**Reviewer:** UX review team, cross-cutting lens `design-system` · **Date:** 2026-10-25 (DEMO_TODAY) · **Tree:** `main` @ 8fef118c (`scratchpad/ux/wt`)

**Scope:**
- `packages/ui-tokens/src/index.ts`, `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`.
- Every component in `apps/web/lib/components/**`.
- Every page-local re-implementation of a primitive under `apps/web/app/**`: dashboard, marketing, showcase, auth, `/s/[token]` and admin (code only).
- All 225 captures.

**Rubric groups:** B1–B9 (all), C11 and C12, E4 and E6, F2 and F3, I5 and I7, J3 and J4. Also the colour semantics of A3, A4, A6, A7 and A9, where the system rather than a single page causes the problem.

**Out of scope:** page-level IA, navigation and the mobile shell, which are owned by `lens-ia-nav.md` and `lens-mobile-field.md` and cross-referenced where they touch tokens.

**Inputs:**
- `research/systems.md` (P1–P25, token proposal §6), `RUBRIC.md` (§0.4 R-1…R-15) and `rtl.md` (§5.4 contrast).
- `fintech.md` (PT1–PT3), `exec-desktop.md` (P13–P16), `erp-modern.md` (§3, §4.E), `ordering-mobile.md` (P17), `pwa-field.md` and `restaurant.md` (field spec).
- `docs/DESIGN-BRIEF.md` (the T1–T4 table) and `AGENTS.md` §Design vocabulary.

**Method:**
- **Contact sheets** of the first viewport of every dashboard route: desktop 1440 (10 sheets) and phone 390 (5 sheets). They are in `review/crops-ds/desk_top_0*.png` and `phone_top_0*.png`.
- **Full-resolution crops** of the owner home (he and en), approvals, pay-run, catalog, chain, ledger and the phone queues, in `review/crops-ds/*.png`.
- **A grep census** of the tree, recorded below.
- **A contrast calculator** for every proposed token pair: `review/scripts/ds_contrast.py`.

**Benchmarks:**
- **Token systems:** Atlassian tokens (color roles, `font.metric.*`, elevation), Shopify Polaris (`Text numeric`, IndexTable, DataTable, Toast), IBM Carbon (spacing, motion, data table, status pattern), GitHub Primer (focus, Blankslate, DataTable), Vercel Geist (2–3 radii, 10-step scales) [K], Material 3 (state layers, elevation).
- **Product exemplars:** Stripe Dashboard, Ramp, Mercury, Linear, Rillet [K]. For restaurant and field work: Toast and Square Dashboard [K].

**Evidence tags:** [Shot] screenshot or crop, [Code] file:line in `scratchpad/ux/wt`, [Grep] a census count, [Calc] contrast computed with the script, [K] platform knowledge not re-verified live.

---

## Scores (0–10, against world-class)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **4.5** | The base layer is sound:<br>- the token pairs pass AA, and axe found 0 colour-contrast violations in 225 captures;<br>- the global coarse-pointer rule keeps targets at 44 px or more;<br>- the receiving capture CTA is a proper 56 px full-width bar.<br><br>On top of that sit:<br>- 101 uses of 9–11 px text (11 px nav labels, 10 px SKUs and badges);<br>- 12 px `sm` buttons on money decisions (`אשר`/`דחה` ≈ 48×44 pills);<br>- a translucent `glass` bottom bar with content showing through;<br>- ₪ printed on both sides of the number inside one approvals card;<br>- "₪ 0.00" rendered 32 px in danger red on the breakdown. |
| Desktop | **4.0** | There is no density system:<br>- an approval is a ≈310 px card, so a 900 px screen shows about 2.5 decisions;<br>- the ledger stacks 3 lines and a chip in every cell;<br>- the app column is fixed at 1,152 px on a 1,440 screen.<br><br>Money is set in JetBrains Mono, a terminal voice whose subset has **no ₪ glyph**, beside Heebo money on the next card. KPI tiles exist in **9 implementations** and status chips in 6. There is no `DataTable`: 39 hand-rolled tables use ≥10 header styles and 0 `aria-sort`. |
| Functionality | **4.5** | Primitives that real work needs are missing:<br>- no `MoneyInput` (27 `type="number"`);<br>- no `DateField` (14 native date inputs render **MM/DD/YYYY** in the lab browser on exports and invoice correction);<br>- no `IconButton`, `Tabs`, `Steps`, `Banner` or `DataTable`.<br><br>Existing primitives are half-built:<br>- `Field` has no error slot;<br>- `Toast` has no action slot, and its errors auto-dismiss;<br>- `Button` has no pressed state, no tertiary variant and an unstable loading width;<br>- `cn` has no class merge, so a page override is a coin toss;<br>- `EmptyState` has no kind. |

**Pilot bar:** fails, with 1 P0. Money renders forced-LTR in mono on the **dock slip** and the **supplier portal**, the surfaces a counter-party reads (rubric E4: S0).

**World-class bar:** far off. The foundations (palette, AA pairs, Heebo, the T1–T4 vocabulary) are *better than most Israeli SaaS*. What is missing is the **system**: role tokens, a numeric layer, one component per concept, density and lint enforcement. Stripe, Ramp, Mercury and Linear look calm because every surface is built from roughly 25 well-specified primitives, not because of their palettes.

---

## 0. Executive summary: 10 decisions this lens asks the owner and `rtl-design-steward` to approve

1. **One token source, three tiers.**
   - `packages/ui-tokens` becomes the only source: primitives → semantic roles → component tokens.
   - A build step generates the `:root` CSS variables and a **Tailwind preset** that *replaces* (not extends) `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration` and the colour set.
   - The dead `webColors` mirror and the hand-synced `--rm-*` hex aliases go.

   (design-system-16)
2. **Money gets its own numeric layer:** `<Money>`, `<MetricHero>`, `<MetricTile>`, `<NumCell>`, `<Token>` and `<DateTime>`.
   - Money is Heebo with tabular figures. Mono is for identifiers only.
   - **One** visual order for ₪: the glyph at the visual left in Hebrew, via a plain `<bdi>`, never `dir="ltr"`.
   - Precision comes from context: hero 0 dp, line 2 dp, unit 4 dp.
   - `formatIls()` stays frozen; the components only wrap it.

   (design-system-01, -02)
3. **Money states get fixed colours (A9).**

   | Money state | Colour |
   |---|---|
   | leak (T1) | ink figure + danger marker |
   | at risk / blocking (T2) | bold badge, ink figure |
   | caught before payment | gold |
   | claimed | primary |
   | credited | primary + ✓ |
   | returned | gold |
   | still owed | ink + a deadline chip (never danger red) |
   | pending (T4) | muted + clock |
   | zero | muted, or a T3 "₪0 · נבדק ✓"; never red |

   (design-system-05)
4. **Role tokens per status family.**
   - Each family gets `text · icon · border · border-subtle · bg-subtle · bg-subtle-hover · bg-bold · bg-bold-hover · on-bold`. Values are computed and AA-checked in §3.2.
   - This retires all 75 distinct `/NN` alpha hacks (756 uses).

   (design-system-04)
5. **A closed type scale of 10 roles plus 4 metric roles** (R-15).
   - Page `h1` = 24/32. The hero = 56/60 (40/44 on mobile).
   - Floors: 12 px on the desk and 14 px in field mode.
   - No `uppercase` or wide tracking on Hebrew.

   (design-system-03, -14)
6. **Shape and elevation by meaning.**
   - Radii: 8 for controls, 12 for cards, 16 for overlays and the hero, and pill only for chips.
   - Elevation: e0 border, e1 raised, e2 overlay, e3 modal.
   - **Rails only for T1, plus the 3 px row tone in queues.**
   - The `flow-stream` motif only on the app-header hairline.
   - No glow blobs in `/dashboard`.

   (design-system-13)
7. **Density by persona:** `compact` 32 for the bookkeeper's ledgers and exports, `default` 48 for owners and managers, `touch` 56 for coarse pointers. The field layer is the one specified in `lens-mobile-field.md` §3.6. Desktop queues become dense tables, not stacks of cards. (design-system-11, -10)
8. **About 25 core components replace about 60 local variants.** The spec, API and states are in §4. The ones that matter most:
   - **`Button` v2:** primary, secondary, tertiary and danger only; `gold` and `accent` are removed. It gains a pressed state, a locked-width loading state and a `disabledReason`.
   - `IconButton` and `StatusChip` (icon + word + colour).
   - **`MetricTile`**, which replaces 9 KPI implementations.
   - `Card` with a `tier` prop.
   - `PageHeader`, `FilterBar`, `SegmentedControl`, `Tabs` and `Steps`.
   - `DataTable` with `NumCell`, `TotalsRow`, `RowActions`, `BatchBar` and `MobileCardList`.
   - The form fields: `Field` v2, `MoneyInput`, `QuantityInput` and `DateField`.
   - The feedback set: `Banner`, `Toast` v2, `EmptyState` with a kind, and `Skeleton` variants.

   (design-system-07, -08, -09, -10, -12, -19, -20)
9. **One focus token and a motion system.**
   - `--c-focus` #1A5BC7: a 2 px ring with a 2 px offset (3 px in field mode).
   - `scroll-padding` from the measured chrome.
   - 4 durations and 3 easings, no `transition-all`, and reduced motion honoured by `Skeleton` too.

   (design-system-06, -15)
10. **Enforcement, so the system stays a system.**
    - ESLint/grep rules, listed in §6, start in warn mode.
    - A living style page, `app/(internal)/ds`, renders every token and component in he/en × compact/default/touch.
    - A Playwright visual baseline snapshots that page.
    - **Wiring the gate into `.github/workflows/ci.yml` is a human PR** (AGENTS.md immutability).

---

## 1. Audit (design-system skill format)

### 1.1 Summary
**Components in `lib/components`:** 23, plus 7 under `views/`.
**Local re-implementations of a primitive:** 60 or more:
- 9 KPI tiles;
- 6 status chips, plus 17 inline pill spans;
- 3 section headers;
- 11 or more segmented controls and tab sets;
- 4 wizard step indicators;
- 146 raw card `div`s;
- 4 hand-rolled link-buttons on the hero;
- 42 local `ils`/`money` helpers.

**Issues found:** 24 (1 P0 · 11 P1 · 10 P2 · 2 P3). **System score:** 41/100.

### 1.2 Token coverage [Grep] [Code]

| Category | Defined today | Hard-coded / off-system found |
|---|---|---|
| Colour | 15 single-value tokens (`--c-*`, `globals.css:60–73`) + 10 hex aliases (`--rm-*`, `:75–84`) + a **dead** TS mirror `webColors` (`ui-tokens/src/index.ts:9–29`, imported by nothing) + a dark `colors` palette and `glows` still exported and consumed by `apps/mobile` (7 files) | 32 hex in TSX outside `og/` (LeakHeatmap 6, Sparkline 2, global-error 10, showcase 17…); **756 alpha-tinted semantic uses in 75 distinct combinations** (`bg-primary/5/8/10/12/15/20/50/60`, `border-primary/15/20/25/30/40/50/60`…); hard-coded hex in `globals.css` itself (html bg `:91`, scrollbar `:124–141`, flow-stream greens and gold `:150–163`, which are off-palette) |
| Typography | `fontSize` 12–40 in TS (`:94–103`), but **Tailwind does not consume it**: only `fontFamily` is imported (`tailwind.config.ts:2,42–45`), so Tailwind's default scale runs | **21 sizes**; `text-xs` 607 · `text-sm` 683; **101 uses of 9–11 px**; one-off `text-[4.1rem]`, `[3.6rem]`, `[2.6rem]`, `[15px]`, `[1.05rem]`; page `h1` at 20, 24, 30 and 36 px across pages; `font-mono` 327 uses (62 lines directly wrap money); `uppercase` 84; ungated wide tracking 72 |
| Spacing | `{4,8,16,24,32,48}` (`:65–72`), not consumed by Tailwind | 12 px (`p-3`/`gap-3`) is the most-used step and missing from the tokens; **419 off-grid half-steps** (`*-1.5/2.5/3.5` = 6/10/14 px); card padding p-3/4/5/6/8 all in use for the same "card" role |
| Radius | `{4,8,12,16,full}` (`:74–80`), not consumed | 8 values in use: `xl` 206, `full` 112, `2xl` 110, `lg` 95, plain `rounded` 39, `md` 35, `3xl` 14, `sm` 4. Cards are 16 (`Card`), 12 (`StatCard`) or 16 (`KpiCard`); buttons are 12 (`Button`) but pill-shaped on pay-run, catalog and orders |
| Elevation | `shadow-card` + 3 `shadow-glow-*` (dark-era names, `tailwind.config.ts:46–56`) | `shadow-glow-primary` 41 on every primary button; no overlay or modal level; 22 radial `glow-*-blob` decorations; 105 `flow-stream`/`FlowBar`/`flow` accents |
| Motion | none | 53 `transition-all`; ad-hoc `duration-200/300/500`; `animate-pulse` without `motion-safe` (Skeleton) |
| Focus | none | 79× `ring-primary/60` + 19× `/50` (**2.81:1**, [Calc]); `ring-line` 21 (**1.39:1**); 0 `scroll-padding` |
| Density | none | Tables hand-pick `py-2`/`py-3`; no row-height tokens; the coarse-pointer rule in `globals.css:415–447` is the only density logic |

### 1.3 Naming consistency

| Issue | Where | Standard to adopt |
|---|---|---|
| Status family named 3 ways | `warn` (token), `warning` (Badge, KpiCard tone), `accent` = primary (Badge, KpiCard, Button) | Families: `danger · warn · success(primary) · gold · info · neutral`. `accent` is deleted. |
| Effect names describe a look, not a meaning | `shadow-glow-*`, `glow-*-blob`, `leak-gradient`, `glass` | `shadow-e1/e2/e3`. Decoration is not tokenised for the app. |
| A data key contradicts its label | i18n `hero.recovered` = "נדרש מהספקים" (claimed), coloured primary (`overview/he.ts:17`, `page.tsx:440`) | The A9 four-state vocabulary `found · claimed · credited · returned`, plus `caughtBeforePayment`, with key = label = colour role |
| Same component name, different things | `KpiCard` ×3 (lib + 2 showcase), `SectionHeader` ×3, `StatusBadge` ×2, `Stat` ×3 | One export per concept from `lib/components`; local shadowing is linted |
| Tone vs tier | `Card tone="danger"` means "danger border"; `KpiCard emphasis` means T1; `Badge danger-solid` means T2 | One prop vocabulary: `tier="t1|t2|t3|t4"` on containers, `tone` + `emphasis="bold|subtle"` on chips |

### 1.4 Component completeness (today)

Legend: ✅ adequate · ⚠️ partial · ❌ missing.

| Component | Variants | States | A11y | Tokens | Score | Notes |
|---|---|---|---|---|---|---|
| Button / LinkButton | ⚠️ 6 (`accent` alias; `gold` second primary) | ❌ no pressed; loading changes width; disabled opacity-45 with no reason | ⚠️ ghost ring 1.39:1, secondary 2.81:1 | ❌ `transition-all`, `shadow-glow-*` | 4/10 | `sm` = 12 px text, used 109× |
| Badge | ⚠️ 8 tones | n/a | ⚠️ icon optional (6/98 use one) | ❌ alpha tints | 5/10 | No `CountBadge`, so nav reimplements it at 10 px (`nav.tsx:159`) |
| Card | ⚠️ `tone` + `flow` + `elevated` | n/a | ✅ | ⚠️ radius 16 | 5/10 | Only 74 uses vs 146 raw card divs |
| KpiCard / StatCard | ❌ two components for one concept | ❌ no loading/unavailable | ⚠️ colour-only warn (icon tint) | ❌ mono, uppercase, glow blob, physical `-left-12` | 3/10 | Plus 7 local copies |
| Heading / SectionHeader | ⚠️ | n/a | ✅ | ⚠️ h1 36 px; flow accent on every header | 5/10 | |
| Input / Select / Textarea / Field | ⚠️ | ❌ no error/invalid/required | ⚠️ ring 2.81:1 | ⚠️ no explicit 16 px | 4/10 | No Money/Qty/Date fields |
| Toast | ⚠️ success/error only | ❌ no action, errors auto-dismiss 7 s | ⚠️ `role=alert` on errors | ⚠️ | 4/10 | |
| ConfirmDialog | ✅ | ✅ focus return | ✅ | ⚠️ radius 16, `sm` buttons | 7/10 | Needs `amount` + `party` props (C10) |
| EmptyState | ❌ no `kind` | n/a | ✅ | ⚠️ always centred | 4/10 | |
| Skeleton / Spinner | ❌ one shape | n/a | ⚠️ pulse ignores reduced motion | ⚠️ | 3/10 | |
| Sparkline | ❌ | ❌ "—" for no data | ❌ `aria-hidden`, no sentence | ❌ hex strokes | 3/10 | |
| DeltaBadge | ⚠️ | ✅ thin-base handling (good) | ⚠️ | ❌ mono + `dir=ltr` + hand sign | 5/10 | |
| Breadcrumbs | ✅ | ✅ | ⚠️ ring /60 | ⚠️ | 7/10 | |
| ViewToolbar (Segmented inside) | ⚠️ | ⚠️ | ✅ | ⚠️ mixes native selects, pills, segmented | 5/10 | 525 lines |
| **Missing entirely** | — | — | — | — | 0 | Money, MetricHero, MetricTile, NumCell, Token, DateTime, IconButton, StatusChip, CountBadge, PageHeader, Tabs, SegmentedControl, Steps, FilterChip, DataTable, TotalsRow, RowActions, BatchBar, MobileCardList, MoneyInput, QuantityInput, DateField, Banner, InlineMessage, Sheet, Peek, Popover/Menu, Tooltip, Kbd, ProgressBar, DeadlineChip, PriceMove |

### 1.5 Component inventory: the same concept, built N ways [Code] [Shot]

| Concept | Implementations today | What the user sees (screenshots) |
|---|---|---|
| **KPI tile** | `lib/KpiCard`, `lib/StatCard`, `dashboard/page.tsx:527 HeroStat`, `recipes/recipe-editor.tsx:391 Stat`, `leaks/report/page.tsx:347 Stat`, `suppliers/[id]/leak-card-view.tsx:194 Stat`, `showcase/receiver/_steps/Reconciliation.tsx:453 KpiTile`, `showcase/dashboard/page.tsx:231 KpiCard`, `showcase/…/[supplierId]/page.tsx:352 KpiCard` | The same 4 figures (leak · caught · claimed · returned) appear in 5 visual dialects:<br>- home: surface-2 tiles, mono 20 px, coloured;<br>- approvals: white tiles, mono 24 px, label top-start;<br>- pay-run: icon chip, glow blob, mono 30 px, 2 dp;<br>- leaks hub: icon at the end, a danger rail on one tile;<br>- chain: icon chip, a sparkline in one tile, a tinted danger card.<br><br>See `desk_top_00/01/04.png`, `payrun_desk.png`, `chain_desk.png`. |
| **Status chip** | `Badge`, `approvals/list.tsx:345 SeverityBadge`, `suppliers/list.tsx:120 TrendBadge`, `showcase/deliveries/page.tsx:263 StatusBadge`, `showcase/receiver/…/Reconciliation.tsx:443 StatusBadge`, `showcase/…/[supplierId]/page.tsx:295 StatusPill`, plus **17 inline `rounded-full px-2 py-0.5` spans** | Solid "חוסם" and "אזהרה" chips have no icon; "מותאם" is a green pill repeated in **every** ledger cell (`ledger_desk.png`); "בהשהיה" is a tinted pill on pay-run; "נשלחה" is an info outline on orders. |
| **Section header** | `lib/Heading.tsx:26`, `showcase/dashboard/page.tsx:620`, `showcase/…/[supplierId]/page.tsx:649` | A 2 px flow accent above *every* h1/h2. The owner home carries ≥8 decorative accents in one scroll (J4: ≤1). |
| **Segmented control / tabs** | `ViewToolbar.tsx:489 Segmented`, `catalog/browser`, `recipes/recipes-home`, `orders/supplier-document`, `orders/list-client`, `exports/form`, `settings/account-section`, `suppliers/tabs`, `inbox/inbox-client`, `recovery/tracker-client`, plus the pay-run month toggle and the digest toggle | Four looks:<br>- a white pill on surface-2 (pay-run, digest);<br>- green tinted pills (inbox, orders, exports);<br>- an underline (suppliers tabs, contracts);<br>- a bordered segmented control (toolbar). |
| **Wizard steps** | `catalog/import/wizard.tsx:176`, `orders/new/wizard.tsx:221`, `contracts/import/wizard.tsx:174` (**3 copy-pasted `<ol>`s**); `receiving/[poId]/wizard.tsx:537` (gradient segments, `transition-all`) | 12 px step pills on three wizards; a flow-gradient bar on receiving; no `aria-current="step"` on the pills. |
| **Card** | `Card` 74 uses vs **146** raw `rounded-(xl|2xl) border bg-surface` divs | Corner radius alternates 12 and 16 between neighbouring cards (approvals tiles vs cards). |
| **Link-as-button** | `LinkButton` 39 uses; the hero hand-rolls 4 with copied class strings (`page.tsx:472–519`) | Four equal-weight bordered buttons in the hero footer. In English the calculation note collapses to a ≈110 px column (`owner_desk_en.png`). |
| **Money formatting** | `formatIls` (frozen) + **42 local `ils`/`money` wrappers**, each choosing its own precision; 60 `<bdi dir="ltr">` | "₪ 104.80" (₪ left, mono) and "522.60₪" (₪ right, no gap) in the **same approvals card** (`appr_desk.png`); "13,474₪" on inventory; "‎₪701" in activity copy. |
| **Pill-shaped buttons** | `rounded-full` overrides on `Button` (pay-run "לתור האישורים", catalog "ייצוא מחירון", orders "הזמנה חדשה", claims "PDF-ל ייצוא") | Primary buttons are pills on some pages and 12 px rounded rectangles on others. |

---

## 2. What the captures show (cross-page consistency)

1. **Two numeric voices.**
   - The T1 hero ("760 ₪"), the hero tiles, the approvals amounts, the pay-run totals and the catalog prices are in JetBrains Mono.
   - The VAT-at-risk "1,123 ₪", inventory's "13,474₪" and the recipe "26.6%" are in Heebo.
   - In English the hero shows "₪760" with the ₪ drawn by a fallback font, because the mono subset has no U+20AA. It is visibly heavier and wider than the digits (`owner_desk_en.png`).
2. **₪ order flips inside one card.**
   - Approvals: "ההפסד המוערך ₪ 104.80" and, three lines below, "צפוי 522.60₪ · בפועל 575.00₪" (`appr_desk.png`, `appr_phone.png`).
   - The same `dir="ltr"` pattern is on the dock slip and the supplier portal [Code].
3. **Colour means different things on different pages.**
   - "נדרש מהספקים" is green on the home and the report, and ink on recovery.
   - "עדיין חייבים לך ₪1,759" (money the supplier owes *you*) is **danger red**, the leak colour.
   - "זיכויים לבקש ₪0.00" is gold.
   - Leak-trend days with ₪0 print "0 ₪" in red.
   - The breakdown prints a red 32 px "₪ 0.00" under an אזהרה row (`breakdown_phone.png`).
   - A 62.5% clean-match KPI is "warn" only through an orange icon tint, with no word (`owner_desk_2.png`).
4. **Emphasis inflation.**
   - On the owner home: a T1 danger rail, a warn rail on VAT, flow-stream tops on the KPI cards, glow blobs, a red bell chip, a red "חצתה את יעד" solid badge, red mono values on 22 trend rows, and a brown heatmap. T1 no longer stands alone (`owner_desk_1..3.png`).
   - On the approvals desk, *every* card has a rail: a gradient danger rail for block, a solid warn rail for warn.
5. **Controls of three shapes and heights in one toolbar.** Native selects (40 px, radius 12), filter pills (32 px, radius 8–12), a segmented chart switch and outline icon buttons (`owner_desk_0.png`). On the phone this toolbar fills the first viewport (`phone_top_00.png`).
6. **Low density on desktop.**
   - Approvals: 2.5 decisions per 900 px.
   - Ledger: each cell stacks amount, "דליפה ₪X" and a "מותאם" chip, so 9 suppliers fill the screen.
   - The app column stops at 1,152 px on a 1,440 display (`layout.tsx:175`).
7. **Hebrew letter-spacing.** The hero eyebrow "דליפה שזוהתה · אוקטובר 2026", the KPI labels, five table-header families and the receiving eyebrow "צעד 2 מתוך 5" are set `uppercase tracking-wider`. Uppercase is a no-op in Hebrew, but the tracking spaces the letters apart.
8. **Dates in native inputs follow the browser locale.** Exports show "10/01/2026 – 10/25/2026" and invoice correction shows "09/28/2026" (`desk_top_02.png`, `desk_top_04.png`). An Israeli bookkeeper reads 10/01 as the 10th of January.
9. **What is already good, and kept:**
   - The light palette and every text/background pair (AA, [Calc]).
   - Heebo self-hosted with a metric-matched fallback (CLS 0.0003).
   - The coarse-pointer target rule.
   - `ConfirmDialog` as a native `<dialog>` with focus return.
   - `DeltaBadge`'s thin-base honesty.
   - The receiving capture CTA (56 px, full width).
   - The **T1–T4 vocabulary** itself, which is the right idea and only needs a system to carry it.

---

## 3. Design-system upgrade spec: "Command Center Light v2"

Principle: **calm canvas, one loud number.** The surfaces are flat and bordered (Linear, Stripe). Colour is spent only on money states and decisions (Ramp, Mercury). Density follows the persona (Carbon, Gmail). The rules are enforced by lint, not memory.

### 3.1 Architecture
```
packages/ui-tokens/src/
  primitives.ts   // colour ramps (OKLCH-derived hex), raw sizes — never imported by components
  semantic.ts     // roles: surface/text/border/status families/money states/focus/data-viz
  scale.ts        // type roles, space, radius, elevation, motion, density, z-index, containers
  modes.ts        // [data-density=compact|default|touch], [data-mode=field], print overrides
  build.ts        // emits apps/web/app/tokens.css (:root + mode selectors) + tailwind-preset.ts
  native.ts       // the same semantics for apps/mobile (light), replacing `colors`/`glows`
```
- **`globals.css`** imports the generated `tokens.css`. Its hand-written `:root` block (`:52–85`) and the hex aliases (`:75–84`) are removed.
- **`tailwind.config.ts`** uses the preset with `theme: { colors, fontSize, borderRadius, boxShadow, transitionDuration, transitionTimingFunction, spacing }` **replaced**. Two exceptions:
  - `opacity` stays default; the custom 8 and 12 steps used only for alpha hacks are dropped.
  - Spacing keeps Tailwind's numeric keys, but lint restricts them to the grid.
- **`cn()`** becomes `twMerge` configured with the new class groups (`extendTailwindMerge`), so `<Button className="w-full">` deterministically wins.
- **Owner:** `rtl-design-steward` owns the tokens and the visual ₪. `web-feature-engineer` owns the components. `money-format-marshal` reviews `<Money>`, which must not alter `formatIls` output.

### 3.2 Colour

**Surfaces and text** (values unchanged from today, now as roles):

| Role | Value | Notes |
|---|---|---|
| `canvas` | #F6F8F7 | Page background. The faint radial wash moves to the marketing shell only. |
| `surface` | #FFFFFF | Cards, tables, bars (solid; no `glass` on sticky chrome) |
| `surface-sunken` | #EEF3F0 | Inputs at rest, tile wells, T4 panels (was `surface-2`) |
| `surface-overlay` | #FFFFFF + e2 | Menus, popovers, toasts |
| `ink` | #0F1F17 | Primary text and **every money figure** |
| `muted` | #4A5D53 (7.04:1) | Secondary text, labels |
| `subtle` | #5A6A62 (5.72:1) | Tertiary and placeholder; **banned in field mode** |
| `line` | #D3DDD7 (1.39:1) | Decorative dividers only |
| `line-strong` | #7A8B82 (3.59:1) | Control boundaries |
| `line-field` | #66756D (4.85:1) | Field-mode input borders (`lens-mobile-field` §3.6) |
| `focus` | #1A5BC7 (6.24 on white, 5.85 on canvas, 5.56 on sunken) | R-5. Ring = 2 px + 2 px `surface` offset; 3 px in field mode |

**Status families**: the same 9 roles everywhere. All pairs are [Calc]-checked: text on `bg-subtle` ≥5.5:1, text on `bg-subtle-hover` ≥4.95:1, white on `bg-bold` ≥6.2:1, white on `bg-bold-hover` ≥8.1:1.

| Family | text = icon = border = bg-bold | bg-bold-hover | bg-subtle | bg-subtle-hover | border-subtle (decorative) |
|---|---|---|---|---|---|
| `primary` (success, positive action) | #066B4A | #05583D | #E7F3ED | #D3EADF | #A9D3C0 |
| `danger` (leak, block, destructive) | #B80F2A | #990C23 | #FCECEF | #F8DADF | #EDB3BD |
| `warn` | #A63D00 | #893200 | #FDF0E7 | #F9E0CF | #EBBF9F |
| `gold` (money caught or returned) | #755C00 | #5F4A00 | #F8F2DD | #EFE6C3 | #D9C789 |
| `info` | #1A5BC7 | #154BA6 | #EBF2FD | #D9E6FB | #B1CAF1 |
| `neutral` (T4) | #4A5D53 | #3B4B43 | #EEF3F0 | #E2EAE5 | #D3DDD7 |

Tailwind exposes `text-danger`, `bg-danger-subtle`, `bg-danger-bold`, `border-danger-subtle` and so on. `bg-danger/12` and friends are linted out.

**Money-state tokens**: component tokens consumed by `<Money state>`, `<MetricTile state>` and `<StatusChip>`:

| State | Hebrew label (one glossary) | Figure colour | Container | Tier |
|---|---|---|---|---|
| `leak` | דליפה | `ink` | T1 hero: 6 px `danger` rail + `border-danger-subtle`; in rows, a `danger` text figure is allowed only for the Δ₪ column | T1 |
| `atRisk` | ממתין לאישור / חוסם תשלום | `ink` | `StatusChip bold danger|warn` + one primary CTA | T2 |
| `caught` | נתפס לפני תשלום | `gold` | optional `gold-subtle` well | T3 |
| `claimed` | נדרש | `primary` | none | T3 |
| `credited` | זוכה | `primary` + ✓ icon | none | T3 |
| `returned` | הוחזר | `gold` | `gold-subtle` | T3 |
| `outstanding` | עדיין חייבים לך | `ink` | `DeadlineChip`: neutral above 7 days, warn-bold at 7 days or less, danger-bold when late (H8) | T2 only when due |
| `pending` | ממתין להתאמה / חשבונית ריכוז | `muted` | `neutral-subtle` + clock icon | T4 |
| `spend` | רכש / הוצאה | `ink` | none | — |
| `zero` | ₪0 | `muted`, or T3 sentence "₪0 · 42 נבדקו ✓" | never `danger` | — |

**Data-viz tokens**:
- **Categorical (6):** primary #066B4A, info #1A5BC7, gold #755C00, #8A4FBF, #00838F and warn #A63D00. Each is ≥3:1 on white. A shape or pattern encodes series in addition to hue.
- **Sequential "price creep"**: replaces the off-palette brown in `LeakHeatmap.tsx:24–29,95`.

  | Step | Colour | Text on it |
  |---|---|---|
  | h1 | #FDF0E7 | ink 15.3 |
  | h2 | #F4CDB0 | ink 11.6 |
  | h3 | #E8A67A | ink 8.3 |
  | h4 | #B4531A | white 5.0 |
  | h5 | #7A2D00 | white 9.5 |

  Text flips to white at h4, and every cell prints its % (C11).
- **Chart roles:**
  - grid: `line`;
  - axis text: `muted` 12 px;
  - target or baseline: 1 px dashed `muted`;
  - leak series: `danger`;
  - every other series: `ink` at 70%;
  - "now" marker: 4 px dot.
- **No gradients and no drop shadows on bars** (today `owner_desk_1.png` has both).

### 3.3 Typography (Tailwind `fontSize` replaced)

| Token | Size / line height (px) | Weight | Family · features | Use |
|---|---|---|---|---|
| `caption` | 12/16 | 500 (600 for labels) | Heebo | Labels, column headers, chips, timestamps. **Desk floor.** Field mode → 14/20. |
| `body-sm` | 14/20 | 400 | Heebo | Tables, dense UI, helper text |
| `body` | 16/24 | 400 | Heebo | Reading text, **every input** (no iOS zoom) |
| `heading-sm` | 16/24 | 600 | Heebo | Card titles |
| `heading-md` | 20/28 | 700 | Heebo | Section `h2` |
| `heading-lg` | 24/32 | 700 | Heebo | **Page `h1`** (today 36 px extrabold via `Heading.tsx:4`) |
| `metric-sm` | 16/24 | 600 | Heebo `tabular-nums lining-nums` | Inline ₪, totals rows |
| `metric-md` | 24/32 | 700 | same | T2 card amount, pay-run sum; **minimum for field ₪ and qty** |
| `metric-lg` | 32/40 | 700, −0.01em | same | KPI tiles |
| `metric-hero` | 56/60 (mobile 40/44) | 800, −0.02em | same; ₪ glyph in its own span at 0.55em / 600 / `muted` / 0.12em gap | **Exactly one per page:** the T1 leak |
| `id` (not a size) | inherits | 500 | JetBrains Mono, `ltr`, `nowrap` | Invoice, PO, SKU and allocation numbers only, via `<Token>` |

Rules:
- **Weights:** 400/500/600/700/800 only.
- **Line heights:** 1.5 for body, 1.1 for metrics.
- **Hebrew:** no `uppercase`, and no `tracking-*` above 0 except behind `ltr:` (E6).
- **Clipping:** never `leading-none` together with `truncate` on Hebrew.
- **Marketing:** keeps its own `display-*` roles (56–72) inside `MarketingShell` only.
- **Migration codemod:**

  | From | To |
  |---|---|
  | `text-[9–11px]`, `text-xs` | `caption` |
  | `text-sm` | `body-sm` |
  | `text-base` | `body` |
  | `text-lg` | `heading-sm`, or `body` + 600 |
  | `text-xl` | `heading-md` |
  | `text-2xl` | `heading-lg` (heading) or `metric-md` (₪) |
  | `text-3xl`/`4xl` | `metric-lg` |
  | `text-5xl`/`6xl` | `metric-hero` (one) |

### 3.4 Numerals and money rendering (the numeric layer)
- **`.num`** = `font-variant-numeric: tabular-nums lining-nums`. On Heebo it is a no-op, since its digits are already equal width (1151/2048 em, `systems.md` P1). It is kept so a fallback font aligns too.
- **Column alignment is physical right in both locales** (R-1), implemented once in `<NumCell>` as `ltr:text-right rtl:text-left`. This is the B4 allow-listed physical class.
- **₪ visual order:** in Hebrew the glyph is at the visual left with one NBSP ("₪ 1,234"). That is exactly what `formatIls()` + a plain `<bdi>` produce. **`dir="ltr"` around a he-IL ₪ string is banned**, because it yields "1,234₪".
- **Precision by context** (B3):

  | Context | Decimals |
  |---|---|
  | `hero` | 0, with exact agorot in `title` and in the proof |
  | `tile` | 0 |
  | `line`, `claim`, `pay` | 2 |
  | `unit` | 4, only where stored as such |

  A total shown next to its rows uses the rows' precision.
- **Signs:** a credit is the word "זיכוי ₪120", never parentheses. A delta sign comes from `Intl` `signDisplay:'exceptZero'`. **That option is a human-PR addition to `formatIls`** (design-system-24). Until it lands, `<Delta>` renders an arrow glyph plus a word and passes `Math.abs` to `formatIls`, never `"+" + formatIls()`.
- **Unknown, failed and n/a values** never render as ₪0:

  | Case | Renders as | Screen-reader text |
  |---|---|---|
  | `unavailable` | "לא זמין · נסה שוב" | — |
  | `pending` | "ממתין" (T4) | — |
  | `na` | blank cell | "לא רלוונטי" |

### 3.5 Space, layout and containers
- **Space scale (px):** 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Component padding:** 8, 12 or 16. **Card padding:** 16 on mobile, 20 at md, 24 at lg.
- **Section gap:** 24 on mobile, 32 at md, 48 at lg. **Stacks:** 8, 12 or 16.
- **Off-grid steps:** 6, 10 and 14 (419 uses) are linted in `/dashboard`.
- **Containers:**

  | Token | Value | Notes |
  |---|---|---|
  | `--container-app` | fluid, max 1600 | gutters 16, 24 and 32; replaces `max-w-6xl` at `layout.tsx:123,175`, as aligned with `lens-ia-nav` |
  | `--container-form` | 720 | |
  | `--container-prose` | 70ch | |
  | `--container-marketing` | 1280 | |
  | `--container-auth` | 440 | |

  Tables always take the full app width.
- **Chrome measurements** are published as CSS variables: `--rm-header-h`, `--rm-bottomnav-h`, `--rm-actionbar-h` and `--consent-h`. `html { scroll-padding-top: var(--rm-header-h); scroll-padding-bottom: calc(var(--rm-bottomnav-h, 0px) + var(--consent-h, 0px)); }` (F3).
- **z-index tokens:** as in `lens-mobile-field` §3.2.

### 3.6 Shape, elevation and emphasis
- **Radius:** `control` 8 (buttons, inputs, selects, in-table chips), `card` 12 (cards, tiles, table frames), `overlay` 16 (dialogs, sheets, peek, the **T1 hero card**), `pill` (filter chips, count badges, avatars only).
- **Elevation:**

  | Level | Treatment | Used for |
  |---|---|---|
  | **e0** | `surface` + 1 px `line` | Default for every card on the canvas, as in Linear and Stripe |
  | **e1** | today's `shadow-card` | Raised and interactive: the hero, sticky bars, a hovered interactive card |
  | **e2** | `0 8px 16px -4px rgba(15,31,23,.16), 0 0 1px rgba(15,31,23,.24)` | Menus, popovers, toasts, tooltips |
  | **e3** | `0 20px 24px -8px rgba(15,31,23,.22), 0 0 1px rgba(15,31,23,.24)` + scrim `rgba(15,31,23,.48)` | Dialogs, sheets |

  `shadow-glow-*` maps to e1 during migration, then is deleted.
- **Emphasis budget** (A8, J4):
  - **Rails:** a 6 px `danger` inline-start rail **only** on the T1 hero. A 3 px `danger`/`warn` row-tone rail only on T2 rows inside queues (the Polaris IndexTable row tone). No gradient rails: `leak-gradient` is retired.
  - **Motif:** the `flow-stream` primary→gold hairline appears once, on the app-header bottom edge. No flow accents above headings and no flow tops on tiles.
  - **Decoration:** no `glow-*-blob` and no radial washes inside `/dashboard`.
  - **Solid danger and warn** appear only on actionable T2 chips and the danger button.

### 3.7 Density (`data-density` on the table or region; per-user default stored with saved views)

| Mode | Row | Cell padding (inline) | Control height | Text | Default for |
|---|---|---|---|---|---|
| `compact` | 32 | 12 | 32 | `body-sm` | Bookkeeper: ledger, exports, pay-run, admin |
| `default` | 48 | 16 | 40 | `body-sm` (identity column `body`) | Owner and manager desk |
| `touch` | 56 | 16 | 48 | `body` | Any `(pointer: coarse)`; never below this on touch |
| `field` (mode) | 56–64 | 16 | 48 (56 primary) | 16/17/24 | Defined in `lens-mobile-field` §3.6 |

- The header row matches the body row height.
- Density never hides the ₪ or the "why" (H1); compact collapses it to one line.

### 3.8 Motion (R-10)

| Token | Duration | Used for |
|---|---|---|
| `--dur-micro` | 100 ms | hover, press, toggle |
| `--dur-short` | 150 ms | fade, tooltip, row exit |
| `--dur-medium` | 240 ms | toast, popover, peek, palette |
| `--dur-long` | 400 ms | sheet, large expand, the one-time hero count-up |

- **Easing:** standard `cubic-bezier(0.2,0,0.38,0.9)`, enter `(0,0,0.38,0.9)`, exit `(0.2,0,1,0.9)`. Exits run at 0.5–0.7× the entrance duration.
- **Transitions:** Tailwind `transition` is replaced by `transition-colors`, `transition-opacity`, `transition-transform` and `transition-shadow` with the duration token. `transition-all` is linted out.
- **Reduced motion:** opacity only, 150 ms or less. `Skeleton` drops its shimmer to a static fill.

### 3.9 Iconography
- **Family:** lucide-react only (already true: 152 imports). A thin `<Icon>` wrapper fixes `strokeWidth={1.75}`, replacing the 35 `strokeWidth={3}` uses in the receiver and showcase.
- **Size follows the text:**

  | Text | Icon |
  |---|---|
  | `caption` | 14 (filled glyphs at 12) |
  | `body-sm` | 16 |
  | `body` | 20 |
  | 20 px and up | 24 |
- **Direction:** `<DirIcon kind="forward|back|next|prev|send|undo|redo">` replaces the ad-hoc `rtl:-scale-x-100` / `ltr:-scale-x-100` flips (E2).
- **`<IconChip>`** (32 or 40, radius 8): **neutral by default**. It takes a status tone only when the item *is* in that state, and the state is also in words. Today the tint is decorative: a warn icon on "clean matches" and a danger bell on price alerts.

### 3.10 State layers and focus
- **State overlays:**

  | State | Treatment |
  |---|---|
  | hover | 6% `ink` on neutral surfaces, 8% of the family on tinted ones |
  | pressed | 12% overlay, or `bg-bold-hover` on bold surfaces (`active:` within 100 ms, I7) |
  | selected | `primary-subtle` fill + 2 px inline-start `primary` indicator + `aria-selected` / `aria-current` |
- **Disabled** is its own token set, never `opacity-NN` (five values in use today):
  - background `surface-sunken`;
  - text `subtle` (5.10:1 on sunken);
  - border `line`;
  - plus a visible reason (`disabledReason`).
- **Focus:** one utility `.focus-ring` = `outline: 2px solid rgb(var(--c-focus)); outline-offset: 2px` on `:focus-visible`. Outline is used rather than a box-shadow ring, so it survives forced-colors mode. Field mode uses 3 px.

---

## 4. Core component specs (the upgrade)

Each entry gives the API, the anatomy and states, what it replaces, and its benchmark. All components live in `apps/web/lib/components`, use tokens only, are RTL-logical, and ship he/en stories on the `(internal)/ds` page.

### 4.1 Numeric layer
**`<Money value | agorot, context="hero|tile|line|unit|inline", state?, credit?, unavailable?, exact?>`**
- **Renders** `<bdi class="num money">{formatIls(...)}</bdi>`, with no `dir`.
- **`context`** sets the precision (§3.4) and the type role. **`state`** sets the colour from the money-state table.
- **`exact`** adds a `title` with 2 dp when rounded.
- **₪0** never takes `danger`.
- **`hero`** splits the output into digit and glyph spans. It splits the *output string*, so `formatIls` is untouched. The wrapper carries one `aria-label` ("760 שקלים") and its children are `aria-hidden` (F6).
- **Replaces:** the 42 local helpers, the 62 `font-mono` money lines and the 60 `<bdi dir="ltr">`.
- **Benchmarks:** Polaris `Text numeric`, Stripe balance [K].

**`<MetricHero label eyebrow value delta sparkline context freshness primaryAction tertiaryLink overflow>`**
- **Anatomy** (A2), in order:
  1. eyebrow;
  2. label;
  3. `Money context=hero`;
  4. a `Delta` line, on by default with a like-for-like span;
  5. a 120×32 `Sparkline` (96×28 on mobile);
  6. the % of food spend with its base;
  7. a freshness and completeness line.
- **Footer:** exactly **one** primary (danger-bold only when leak > 0), one tertiary link ("איך הגענו ל-₪760?") and a `⋯` menu for the report, digest and ask.
- **Layout:** a two-column grid at lg, with the value column at least 320 px and the side tiles at most 2×2. A single column below md.
- **Card:** `tier="t1"`, radius 16.
- **Replaces:** `page.tsx:383–524`, the monthly report hero (`reports/monthly/page.tsx:95`), the breakdown hero and the digest hero, which become one component on all four surfaces (A9).
- **Benchmarks:** Stripe home KPI, Mercury balance.

**`<MetricTile label value(Money|string) state? context? delta? sparkline? href? action? loading? unavailable?>`**
- **Anatomy:** label (`caption` 600 `muted`) → value (`metric-lg`) → context (`body-sm muted`, ≤2 lines) → optional delta and sparkline → optional one link.
- **Card:** e0, radius 12, padding 16/20. The icon is optional and neutral. No glow, no flow top.
- **States:**
  - `loading`: a skeleton of the same box.
  - `unavailable`: "לא זמין · נסה שוב".
- **Replaces:** `KpiCard`, `StatCard`, `HeroStat`, the three local `Stat`s, `KpiTile` and the 2 showcase `KpiCard`s.
- **Benchmarks:** Atlassian `font.metric.*`, Ramp Insights tiles [K].

**`<NumCell value precision unit?>`** · **`<TotalsRow>`** sit inside DataTable (§4.6).

**`<Token kind="invoice|po|sku|allocation|phone" copy?>`**
- **Renders** `<bdi dir="ltr" class="font-mono whitespace-nowrap">`, at 13 px desk and 14 px field.
- **`copy`** adds a button ("העתק מספר חשבונית" → "הועתק").
- **Fixes:** SKUs wrapping as "GD-/1006" at 10 px (`catalog_desk.png`).

**`<DateTime value variant="short|medium|long|time|relative">`**
- **Renders** `<time datetime>` + `lib/i18n/format` in Heebo `.num` (not mono).
- **`relative`** is always paired with the absolute value in `title`.

**`<Delta current previous goodWhen="up|down|neutral" kind="ils|pct|count">`** and **`<PriceMove from to>`** (old ← new in Hebrew, R-4)
- **Delta anatomy:** arrow glyph + word (עלייה/ירידה) + signed ₪ + optional %. Colour comes from meaning, never from the sign.
- **Supersedes** `DeltaBadge`'s `dir="ltr"` and its hand-built sign.

**`<DeadlineChip due>`**
- "נותרו 6 ימים · עד 31.10.2026", with tone by days (H8).

### 4.2 Actions
**`<Button variant="primary|secondary|tertiary|danger" size="sm|md|lg|xl" icon? iconEnd? loading? success? disabledReason? fullWidth? kbd?>`** (and `LinkButton` with the same API)
- **Variants:**

  | Variant | Look |
  |---|---|
  | primary | `primary-bold` |
  | secondary | `surface` + `line-strong` border, `ink` |
  | tertiary | text only, `primary` text, underline on hover |
  | danger | `danger-bold`; never next to a primary |
- **Sizes:**

  | Size | Height | Text | Where |
  |---|---|---|---|
  | sm | 32 | 14/20 600 | desk tables only |
  | md | 40 | 14/20 600 | default |
  | lg | 48 | 16/24 600 | mobile primary |
  | xl | 56, full width | 16/24 600 | field primary |

  Radius 8. **`rounded-full` overrides are linted.**
- **States:** hover is a state layer; pressed is `active:` with `bg-bold-hover`; focus uses `.focus-ring`.
- **Loading:** the spinner replaces the leading icon, the label stays, and the width is locked (`min-inline-size` measured on mount).
- **Success:** "✓ נשלח" for 1.5 s.
- **Disabled:** the disabled tokens, with `disabledReason` rendered as `caption` text under the button (C12).
- **In flight:** disabled, which is the double-post guard (I7).
- **Removed:** `accent`, the alias of primary (7 uses), and `gold`, a second primary colour (3 uses, e.g. exports' "הורדת קובץ אחיד" beside the green CSV button). Gold is a *money state*, not a button colour.
- **Region rule:** one primary per region (C12).

**`<IconButton label icon size="sm|md|lg" tone?>`**
- `label` is required: it supplies the `aria-label` and the tooltip.
- Hit area: 32 on desk (≥24 visual), 44 on coarse pointers, 48 in field mode.
- **Replaces:** the 3 always-visible row icons in the catalog, where a red trash sits next to edit (`catalog_desk.png`).

**`<RowActions primary? items[]>`**
- At most 2 inline actions; the rest go in a `⋯` `<Menu>`, which is always visible on touch (C2).

**`<Kbd>`**
- `dir="ltr"`, `caption`, shown in tooltips and menus ("אשר · 1").

### 4.3 Status and labels
**`<StatusChip tone emphasis="bold|subtle" icon? label size="sm|md">`**
- `label` is required. Each tone has a default icon:

  | Tone | Default icon |
  |---|---|
  | danger | `OctagonAlert` |
  | warn | `TriangleAlert` |
  | success | `CircleCheck` |
  | gold | `Coins` |
  | info | `Info` |
  | neutral | `Clock` |
- **Sizes:** sm is 20 px tall (`caption` 600, radius 8 inside tables, pill elsewhere); md is 24 px.
- **Emphasis:** `bold` only for T2.
- **Roll-ups** pass `worstOf(children)` (C11).
- **Rule:** no chip when no state matters. The 40 "מותאם" chips in the ledger become nothing, or a T4 "✓" glyph with screen-reader text.

**`<CountBadge count max=99 tone="neutral|danger">`**
- Min 20×20, `caption` 600, hidden at 0. Replaces `nav.tsx:159` (10 px).

**`<Tag>`**
- Neutral metadata such as category or unit. No icon, `caption`, `surface-sunken`.

### 4.4 Containers and page structure
**`<Card tier="default|t1|t2-danger|t2-warn|t3-gold|t3-primary|t4" padding="auto|none" interactive? as>`** with `CardHeader` (title `heading-sm` + description + ≤1 action) · `CardBody` · `CardFooter`
- **`t1`:** radius 16, e1, 6 px rail.
- **`t2-*`:** e0 + a header `StatusChip bold`, with no rail outside queues.
- **`t3`:** the family's subtle surface.
- **`t4`:** `surface-sunken`, no border emphasis.
- **`interactive`:** the whole card is one link with a focus ring. Never nest interactives (C13; axe found `nested-interactive` on the `.audit-row` elements).
- **Replaces:** the 146 raw card divs and the `flow` / `elevated` / `tone` props.

**`<PageHeader title context? backTo? breadcrumbs? actions? tabs?>`**
- **Title:** `h1 heading-lg`.
- **Context line:** `body-sm muted`, for example "כפר הזיתים · אוקטובר 2026 · עודכן לפני 4 דק׳".
- **Actions** at the inline end: ≤1 primary, ≤1 secondary and `⋯`. On mobile the actions collapse into `⋯`, except the primary.
- **Breadcrumb or up-link** comes from the nav registry (`lens-ia-nav` §0.9).
- **Optional `tabs`** slot.
- **No flow accent.**
- **Desktop:** sticky compact mode at 56 px on scroll.
- **Replaces:** `SectionHeader level={1}` (39 uses) and the 6 raw `h1`s in 4 different sizes.

**`<SectionHeader title description? action?>`**
- `h2 heading-md`, one `tertiary` link with a `DirIcon`.

### 4.5 Choosing and filtering
**`<FilterBar>`**
- **Contents:**
  - a search field (40 px);
  - `FilterChip`s (32 on desk, 44 on touch; pill; "ספק: הכל ▾"; active = `primary-subtle` + count + ×);
  - a `PeriodPicker` (popover with presets plus a custom range);
  - a compare toggle.
- **Overflow:** a single "תצוגה" button for power controls below lg (A8).
- **Clear:** when filtered, a chip row with "נקה".
- **Replaces:** the mixed native selects, pills and segmented controls in `ViewToolbar` (525 lines).

**`<SegmentedControl options value onChange size>`**
- A `radiogroup` of 2–5 options: a `surface-sunken` track, a selected `surface` + e1 thumb, 32/40/48 heights.
- **Replaces:** about 8 local toggles (pay-run month, digest, chart type, inbox filters…).

**`<Tabs items counts? variant="underline">`**
- In-page navigation: a 2 px `primary` indicator, `aria-current`, and counts as `CountBadge`.
- **Replaces:** the suppliers, contracts and orders status tabs.

**`<Steps steps current>`**
- **Desktop:** numbered items, with the current one in `primary-subtle` + `aria-current="step"` and completed ones with ✓.
- **Mobile and field:** "שלב 2 מתוך 4 · פריטים" plus a 4 px determinate bar that fills from the right (E2).
- **Replaces:** the 3 copy-pasted `<ol>`s and the receiving gradient segments.

### 4.6 Data
**`<DataTable columns rows density sort defaultSort selectable? rowTone? stickyHeader stickyFirst totals? caption emptyState mobile="cards|scroll">`**
- **Columns:** `{ key, header, align: 'start'|'num', width, sortable, firstSort: 'desc' for money, sticky }`.
- **Header:**
  - `caption` 600 `muted` on `surface`, with a `line` bottom border;
  - no uppercase, no tracking, no mono;
  - sort buttons inside `th`, with `aria-sort` and one column sorted on load (C1);
  - ₪ moves into the header: "סכום (₪)".
- **Rows:** the density token sets the row height.
- **`rowTone`:** the 3 px rail for T2.
- **Row actions** use `RowActions`.
- **Selection** turns the toolbar into a sticky **`BatchBar`**: "N נבחרו · ₪X · [אשר N] [נקה]". `block` rows are not selectable (C2).
- **`<NumCell>`** aligns to the physical right, with tabular digits and fixed decimals per column.
- **`<TotalsRow>`** is `metric-sm`, and its sum equals the visible rows (B3).
- **Cell states:**

  | State | Renders as | Screen-reader text |
  |---|---|---|
  | `na` | blank | "לא רלוונטי" |
  | `pending` | T4 text | — |
  | `unavailable` | alert icon + "נסה שוב" | — |

  No "—" fillers (A4).
- **Below 768 px:** `MobileCardList`:
  - line 1: identity and ₪;
  - line 2: status and date;
  - one action.
- **Order of adoption:** approvals (desktop table, P14 of `exec-desktop.md`), pay-run, supplier ledger (compact), catalog, leaks breakdown, orders, suppliers.
- **Benchmarks:** Polaris IndexTable (row tone, promoted bulk actions, condensed mode), Carbon data table (sizes, batch bar), Primer DataTable (sort contract).

**`<BarList items valueFormat>`**
- Replaces the leak-trend bars: a flat `danger` bar on a `surface-sunken` track, the value at the inline end in `body-sm`, and **₪0 rows muted**.

**`<Sparkline data label tone="muted|leak">`**
- A 1.5 px stroke and a 4 px last-point dot, no axes. `role="img"` with a sentence `aria-label` (C14). Colours come from tokens.

**`<Heatmap>`**
- Uses the sequential tokens, with the % printed in each cell.

**`<ChartFrame title tableToggle legend>`**
- Wraps every chart with a "טבלה" toggle.

**`<ActivityRow icon who verb object amount time>`**
- `DateTime relative` with the absolute value in `title`; `Money` for amounts; ids through `Token`.

### 4.7 Forms
**`<Field label optional? helper? error? children>`**
- **Label:** above the field, `body-sm` 600 `ink`.
- **"(רשות)"** marks the minority of fields.
- **Helper** text sits between the label and the control; the **error** replaces the helper. The component wires `aria-describedby` and `aria-invalid` (C5, C6).

**`<TextInput>`, `<Textarea>`, `<Select>`**
- **Height:** 40 on desk, 48 on touch and field.
- **Text:** always `body` 16 px.
- **Border:** `line-strong` (`line-field` in field mode).
- **States:** invalid uses a `danger` border plus an icon; focus uses `.focus-ring`.

**`<MoneyInput>`**
- `type="text" inputMode="decimal"`, `dir="ltr"` with `rtl:text-right`.
- The ₪ adornment sits outside the value, at the visual left.
- Accepts "7,5" and "7.5", and formats thousands on blur (C7).
- Emits agorot or the existing shape. Parsing never touches `formatIls`.

**`<QuantityInput unit step stepper?>`**
- The same parsing as `MoneyInput`. An optional 48/56 stepper and a unit adornment.
- **Replaces:** the 27 `type="number"` inputs.

**`<DateField>`**
- A masked text field `dd.mm.yyyy` plus a calendar popover: he-IL, weeks starting on Sunday (א׳), holidays marked (E8).
- **Replaces:** the 14 native `type="date"` inputs, whose display follows the *browser* locale (MM/DD/YYYY in the lab).

**`<Checkbox>`, `<Radio>`, `<Switch>`**
- The label is the 44 px target.

**`<ErrorSummary>`**
- For 3 or more errors: focusable, with anchor links to each field (C6).

### 4.8 Feedback and overlays
**`<Banner tone title? children action?>`**
- One per page, under the `PageHeader`, not sticky, ≤2 sentences and 1 action. No `role="alert"` on load (F7).
- T4 is neutral. Example: the worker-down notice becomes a neutral chip in field mode, as specified in the mobile lens.

**`<InlineMessage>`**
- Sits on a row or field. Row errors appear on the row (C9).

**`<Toast>` v2**
- Kinds: success, info, error; `action` slot (Undo).
- Timings (R-6): 5 s plain, at least 10 s with an action, **errors persist**.
- Pauses on hover and focus. Bottom-start, above the bottom bar and action bar. At most 3.

**`<EmptyState kind="first-use|no-results|error|permission|inbox-zero">`**
- **first-use:** one primary CTA.
- **no-results:** "נקה סינון".
- **error and permission:** an alert icon and no art.
- **inbox-zero:** T3, with what was auto-handled.
- Start-aligned in pages; centred only inside tiles (C8).

**`<Skeleton variant="text|metric|row|tile|hero">`**
- Same boxes as the final layout. `motion-safe` shimmer. `aria-busy` on the region (I4).

**`<Spinner delay=400>`** · **`<ProgressBar value label>`**

**`<Dialog>` / `<ConfirmDialog amount party>`**
- The confirm button names the ₪ and the party: "מחק ₪1,240 מהדרישה לספק תנובה" (C10).

**`<Sheet>`, `<Peek>`**
- As specified in `lens-mobile-field` §3.8.

**`<Popover>`, `<Menu>`, `<Tooltip>`**
- e2, radius 12, `--dur-medium`.

---

## 5. Findings

Severity: P0 = misleads a core task or a counter-party, P1 = major friction or below par, P2 = polish a careful owner notices, P3 = nit. Each finding has an id, the rubric criteria, evidence, the problem, the fix and a benchmark.

### P0

**design-system-01 · ₪ renders in two visual orders, including on the dock slip and supplier portal.** · Rubric E4, B2 · Routes `/dashboard/receiving/[poId]` (dock slip), `/s/[token]`, `/dashboard/approvals`, `/dashboard/inventory` · both devices
- **Evidence:**
  - [Shot] `review/crops-ds/appr_desk.png`: "₪ 104.80" vs "522.60₪ · 575.00₪" in one card.
  - [Shot] `appr_phone.png`: "₪ 100.00" vs "139.00₪ · 149.00₪".
  - [Shot] `desk_top_03.png` (inventory "13,474₪").
  - [Code] `apps/web/app/dashboard/receiving/[poId]/dock-slip.tsx:161,203,244`, `apps/web/app/s/[token]/answer-form.tsx:135`, `dashboard/receiving/dock-price-hint.tsx:35,42`, `dashboard/approvals/list.tsx:316,321`, `inventory/[countId]/page.tsx:42`, `inventory/period-card.tsx:85–271`.
  - [Grep] 60 `<bdi dir="ltr">` around money.
- **Problem:** `dir="ltr"` around a he-IL `formatIls` string moves ₪ to the right with a different gap. It is often in JetBrains Mono, whose subset has no ₪, so the glyph also changes font. The driver signing the dock slip and the supplier answering on the portal see a different money format from the claim letter and the app. The rubric makes this S0 on counter-party surfaces.
- **Fix:**
  - Ship `<Money>` (§4.1). Codemod every `<bdi dir="ltr">{formatIls|ils|money(…)}</bdi>` → `<Money context="line">`.
  - Add a grep/ESLint rule: `dir="ltr"` on an element whose child calls a money formatter → error.
  - Playwright: in `he`, the ₪ glyph's `right` < the first digit's `left` on the dock slip and portal.
  - Owner: `rtl-design-steward`. `formatIls` is untouched.
- **Benchmark:** ICU he-IL output; Stripe and Mercury render every amount through one component [K].

### P1

**design-system-02 · Two numeric voices: money in a mono font that has no ₪ glyph.** · B2, J3 · `/dashboard`, approvals, pay-run, chain, catalog, leaks · both devices
- **Evidence:**
  - [Code] `dashboard/page.tsx:410` (hero `font-mono text-5xl/6xl`), `:547` (HeroStat), `KpiCard.tsx:82,93`, `StatCard.tsx:52`, `approvals/list.tsx:178,291`, `reports/monthly/page.tsx:95`.
  - [Grep] 327 `font-mono`, 62 lines directly on money.
  - `ui-tokens/src/index.ts` comments "Mono stack for money figures — terminal feel".
  - [Shot] `owner_desk_en.png` ("₪760" with a fallback ₪), `payrun_desk.png`, versus Heebo money in `owner_desk_1.png` (VAT "1,123 ₪").
- **Problem:**
  - The T1 number, KPI tiles and table amounts read as terminal output, with 0.6 em mono digits and a wide comma gap.
  - The next card sets money in Heebo.
  - ₪ is drawn by whatever the OS has, so weight and baseline differ per device.
  - The "command center" brief asked for premium fintech calm, not a console.
- **Fix:**
  - Metric roles in Heebo (§3.3). `font-mono` only inside `<Token>`.
  - Codemod `font-mono` + money → `<Money>`/`<MetricTile>`.
  - Delete the "terminal feel" comments in `globals.css:109` and `ui-tokens`.
- **Benchmark:** Stripe, Mercury and Ramp balances set money in the brand sans with tabular digits; Polaris `Text numeric`.

**design-system-03 · No closed type scale: 21 sizes, 101 sub-12 px uses, page titles at 4 sizes.** · B1, G3 · all routes · both devices
- **Evidence:**
  - [Grep] `text-[11px]` 53, `[10px]` 45, `[9px]` 3, `text-xs` 607.
  - [Code] `tailwind.config.ts:2` imports only `typography` and does not apply `fontSize`; `Heading.tsx:4` (h1 36 px extrabold); raw `h1` at 20/24 (`app/dashboard/**`); `nav.tsx:432,450` (11 px tab labels); `page.tsx:556` (11 px hero hints); `catalog/browser.tsx` (10 px SKU).
  - [Shot] `desk_top_05.png` (ask `h1` ≈20 px vs approvals 36 px), `phone_top_03.png` (12 px step pills), `catalog_desk.png`.
- **Problem:**
  - Every screen picks its own sizes, so the hierarchy is inconsistent.
  - Field and phone users get 10–12 px labels and meta text, below the 14 px field floor.
  - The oversized 36 px `h1` costs about 100 px of every desktop viewport.
- **Fix:**
  - Replace Tailwind `fontSize` with the 10+4 roles (§3.3) and run the codemod table.
  - In field mode, raise `caption` to 14.
  - Lint: arbitrary `text-[…]` → error; `text-caption` on field routes → error.
- **Benchmark:** Atlassian (separate heading, body and metric families); Polaris `Text` variants; Apple HIG (+2 pt for RTL scripts).

**design-system-04 · Colour is one hex per status plus 75 alpha hacks; no role tokens.** · B8, C11, F2 · all routes · both devices
- **Evidence:**
  - [Code] `globals.css:60–73`; `Badge.tsx:7–15`; `tailwind.config.ts:36–39` (opacity 8/12 "tints used across the app"); `KpiCard.tsx:9–13` (tone `warning` → `glow-gold-blob`).
  - [Grep] 756 alpha-tinted semantic classes in 75 distinct combinations.
  - [Shot] `owner_desk_2.png` (a 62.5% clean-match KPI flagged only by an orange icon tint), `chain_desk.png` (4 icon-chip colours on 4 neutral KPIs).
- **Problem:**
  - Tints, hovers and borders are improvised per page. `primary` alone appears at 8 background and 7 border alphas.
  - Hover and selected states are not defined, and AA must be re-proven at every new alpha.
  - Status is sometimes carried by icon tint alone (WCAG 1.4.1).
- **Fix:**
  - Add the 9-role families (§3.2, values [Calc]-checked) to `ui-tokens` and generate the CSS.
  - Map Badge, Card, Toast, Input and Button to roles.
  - Lint `(bg|text|ring|border)-(danger|warn|gold|primary|info)/\d+` → error after migration.
  - `IconChip` is neutral unless the state is also in words.
- **Benchmark:** Atlassian colour roles (`color.background.danger.bold` …); Geist's 10-step scales [K].

**design-system-05 · Money-state colours drift between pages; ₪0 and money owed back print in loss red.** · A3, A4, A6, A9 · `/dashboard`, `/dashboard/recovery`, `/dashboard/reports/monthly`, `/dashboard/approvals/pay-run`, `/dashboard/leaks/breakdown` · both devices
- **Evidence:**
  - [Code] `page.tsx:439–440` (`hero.recovered` = "נדרש מהספקים", tone primary; `overview/he.ts:17`); `reports/monthly/page.tsx:105–111` (claimed primary, outstanding **danger**); `recovery/page.tsx:126`, `recovery/tracker-client.tsx:168` (owed = `text-danger`).
  - [Shot] `desk_top_08.png` (recovery: "עדיין חייבים לך ₪1,759" red; "נדרש ₪3,672" ink), `payrun_desk.png` ("זיכויים לבקש ₪0.00" gold), `owner_desk_1–2.png` (22 trend rows incl. "0 ₪" in red), `breakdown_phone.png` (red 32 px "₪ 0.00").
- **Problem:**
  - The same state looks different on two pages.
  - Money the supplier owes the owner (a receivable, good news to chase) wears the leak colour.
  - Zeros read as losses.
  - This erodes the one-number trust the North Star depends on, and inflates alarms (T4 crying wolf).
- **Fix:**
  - Money-state tokens and the glossary (§3.2), enforced through `<Money state>` and `<MetricTile state>`.
  - Outstanding money = `ink` + `DeadlineChip` (warn or danger only when due or late).
  - ₪0 = `muted`, or a T3 sentence.
  - The i18n key is renamed with the label: `hero.claimed`.
- **Benchmark:** Stripe balance states (Available / Pending / Reserved, each defined once); Mercury reserves red for errors [K].

**design-system-06 · No focus token: 98 rings below 3:1, no `scroll-padding`.** · F3, F2 · all routes · desktop (keyboard), mobile (external keyboards and switch control)
- **Evidence:**
  - [Code] `Button.tsx:25` (`ring-primary/60`), `:27` (`ring-line`), `Input.tsx:7`, `Toast.tsx:89`, `Breadcrumbs.tsx:26`, `page.tsx:476–519`.
  - [Grep] 79× `/60` + 19× `/50`, 21 `ring-line`, 0 `scroll-padding`.
  - [Calc] 2.81:1 and 1.39:1.
- **Problem:** keyboard users (the bookkeeper desk, power users at volume) lose the focused element. Sticky chrome (the 152 px header, the bottom bar, consent) can cover it (WCAG 2.4.11).
- **Fix:**
  - `--c-focus` #1A5BC7 with a `.focus-ring` utility (2 px + 2 px offset; 3 px in field mode).
  - Every component consumes it.
  - `scroll-padding` comes from the measured chrome variables (§3.5).
  - Lint `ring-line|ring-primary/(50|60)` → error.
- **Benchmark:** Primer (a 2 px focus ring "MUST"); Atlassian `color.border.focused`.

**design-system-07 · One concept, many components: 9 KPI tiles, 6 status chips, 11+ toggles, 4 step indicators, 146 raw cards.** · J3, C11, C12, B9 · all routes · both devices
- **Evidence:** §1.5 table with file:line for each copy. [Shot] `desk_top_00/01/04.png`, `payrun_desk.png`, `chain_desk.png`, `ledger_desk.png`, `phone_top_03.png`.
- **Problem:**
  - The owner sees the same four ₪ figures in five dialects as they move between home, approvals, pay-run, leaks and chain.
  - Fixes land in one copy and miss the others. PR #67 was a double-render bug of exactly this class.
  - Every new page invents another variant.
- **Fix:**
  - Build the §4 components and migrate in the order of §6.
  - Delete `KpiCard`, `StatCard` and the local copies.
  - ESLint `no-restricted-syntax` on local function names `/^(Kpi|Stat|Status(Badge|Pill)|SectionHeader|Segmented|Steps?)\w*$/` in `app/**`.
  - Showcase imports the real components (J3: the demo must look like the product).
- **Benchmark:** Polaris and Primer (one component per concept, documented variants); Linear's small primitive set [K].

**design-system-08 · Button system: no tertiary, gold as a second primary, 12 px `sm`, no pressed state, unstable loading, pill overrides.** · C12, I7, A1, F4 · `/dashboard`, approvals, pay-run, exports, chain, leaks · both devices
- **Evidence:**
  - [Code] `Button.tsx:5,9,14–33`.
  - [Grep] 0 `active:` classes; 109 `size="sm"`; 31 `hover:brightness`; 3 `variant="gold"`; `rounded-full` overrides on pay-run, catalog, orders and claims; the hero's 4 copied link-button class strings (`page.tsx:472–519`).
  - `cn.ts:2–4` (no merge).
  - [Shot] `desk_top_02.png` (exports: gold "הורדת קובץ אחיד" + green "הורדת CSV" side by side), `chain_desk.png` ("מעבר לסניף" solid red in one card, outline in the next), `appr_phone.png` (`אשר` / `דחה` ≈48×44 pills for money decisions).
- **Problem:**
  - Hierarchy collapses: a tertiary action has to be a bordered button, so 4 equal buttons crowd the T1 hero.
  - Two primary colours compete.
  - Taps get no pressed feedback.
  - The loading spinner widens the button and shifts the layout.
  - Class overrides depend on stylesheet order.
- **Fix:**
  - `Button` v2 (§4.2): four variants, four sizes and a `disabledReason`, with `IconButton` and `RowActions` beside it.
  - Swap `cn` for `twMerge`.
  - Lint `variant="gold"|"accent"` and `rounded-full` on Button.
- **Benchmark:** Apple HIG ("one or two prominent buttons per view"); Carbon inline loading; Material 3 state layers.

**design-system-09 · The T1 hero is hand-assembled, and it breaks in English and stacks 4 equal actions.** · A1, A2, B9 · `/dashboard` (also `reports/monthly`, `leaks/breakdown`, `reports/digest`) · both devices
- **Evidence:**
  - [Code] `page.tsx:383–524` (one rail, one glow blob, eyebrow `uppercase tracking-wider` `:400`, mono value `:410`, 4 hand-rolled links `:472–519`).
  - Separate hero markup in `reports/monthly/page.tsx:95` and the breakdown and digest pages.
  - [Shot] `owner_desk_en.png` (the calculation note squeezed into a ≈110 px column, 9 lines tall, beside 4 buttons); `phone_top_00.png` / `owner_phone_sheet.png` (3 bordered buttons + a danger CTA under the hero); `desk_top_04.png` and `desk_top_05.png` (the same ₪760 in three different hero layouts).
- **Problem:** the most important element in the product has no component. Each surface re-lays it out: different size, different anatomy, different actions. The English desktop shows a visibly broken footer.
- **Fix:**
  - `<MetricHero>` (§4.1) with a fixed footer: 1 primary + 1 tertiary + `⋯`.
  - The note moves to the tertiary "איך הגענו ל-₪X?".
  - Use it on all four surfaces with the same label, scope and precision (A9).
- **Benchmark:** Stripe home KPI (one number, one action); Mercury balance header [K].

**design-system-10 · No `DataTable`: 39 hand-rolled tables, ≥10 header styles, 0 sort, chips in every cell.** · C1, C2, C3, B4, B6, A4 · approvals/pay-run, `suppliers/ledger`, catalog, `leaks/breakdown`, orders, recovery · desktop-led, both devices
- **Evidence:**
  - [Grep] 39 `<table>`, 0 `aria-sort`, 3 `md:hidden` card lists.
  - `thead` variants: 5× `uppercase tracking-wider`, 4× `font-mono uppercase`, and others.
  - [Shot] `ledger_desk.png` (each cell = amount + "דליפה ₪X" + a "מותאם" chip; "—" fillers), `catalog_desk.png` (SKU wrapped in 10 px mono, 3 always-visible icons with a red trash per row).
- **Problem:** the bosses' desktop work (ledger, pay-run, catalog) has no sort, no totals row, no sticky header or identity column, no density, no batch bar and no mobile card fallback. Visual noise (repeated chips, red trash icons) hides the exceptions.
- **Fix:**
  - `DataTable` + `NumCell` + `TotalsRow` + `RowActions` + `BatchBar` + `MobileCardList` (§4.6).
  - Adopt in this order: approvals (as rows at ≥1024), pay-run, ledger (compact), catalog, breakdown.
- **Benchmark:** Polaris IndexTable; Carbon data table (sizes, batch actions); Primer DataTable (sort contract); Toast Location Overview (column chooser) [K].

**design-system-11 · No density system: desktop queues are tall cards.** · B6, A8 · `/dashboard/approvals`, `approvals/pay-run`, `suppliers/ledger`, exports · desktop
- **Evidence:**
  - [Shot] `appr_desk.png`: an approval card ≈310 px tall, so a 900 px viewport holds about 2.5 decisions.
  - [Shot] `payrun_desk.png`: each supplier group ≈155 px.
  - [Shot] `ledger_desk.png`: 9 suppliers per screen.
  - [Code] `layout.tsx:175` (`max-w-6xl`); no `--row-*` tokens; the `d` param in `lib/components/views/state.ts` has no tokens behind it.
- **Problem:** the owner asked for a desktop that is "organized far more efficiently". The bookkeeper reconciling 40 invoices scrolls about 16 screens. Ramp, BILL and R365 show 10–15 decisions per screen.
- **Fix:**
  - Density tokens (§3.7): compact 32, default 48, touch 56, with per-user persistence through saved views.
  - App container fluid to 1600.
  - The "למה סומן" explanation becomes a one-line why plus a peek in compact (never hidden, H1).
  - Acceptance: approvals at 1440×900 show ≥10 rows in default density and ≥15 in compact.
- **Benchmark:** Gmail density modes; Carbon row sizes; Ramp bill-pay inbox [K].

**design-system-12 · Form primitives are incomplete: no error slot, no money, quantity or date fields; native date shows MM/DD.** · C5, C6, C7, E8, F10 · `/dashboard/exports`, `invoices/[invoiceId]`, `contracts/import`, `orders/new`, `catalog`, `products/[id]`, `onboarding` · both devices
- **Evidence:**
  - [Code] `Input.tsx:7` (no text size, ring /60), `:41–67` (`Field` without error, required or optional).
  - [Grep] 27 `type="number"`, 14 `type="date"`.
  - [Shot] `desk_top_02.png` (exports "10/01/2026 – 10/25/2026"), `desk_top_04.png` (invoice correction "09/28/2026"; amounts "6240.00" without grouping), `phone_top_03.png` (disabled "המשך" with no reason).
- **Problem:**
  - Israelis read 10/01 as 10 January, and exports are a VAT-period action.
  - `type="number"` rejects "7,5" and changes the value on scroll.
  - Errors have no standard home.
  - Disabled submits give no reason.
- **Fix:** `Field` v2, `TextInput`, `MoneyInput`, `QuantityInput`, `DateField` and `ErrorSummary` (§4.7), then replace all 41 native number and date inputs.
- **Benchmark:** Stripe CurrencyField; Primer forms (validation timing); GOV.UK date input [K].

### P2

**design-system-13 · Emphasis and elevation recipes are improvised: 4 rail styles, 105 flow accents, 22 glow blobs, 8 radii, `glow-*` shadows.** · B7, J4, A8 · `/dashboard`, approvals, chain, pay-run, leaks · both devices
- **Evidence:**
  - [Code] `page.tsx:390–398`, `KpiCard.tsx:66–70,107–113`, `approvals/list.tsx:340–343` (rail tints), `globals.css:166–184`, `tailwind.config.ts:46–56`.
  - [Grep] radii, flow and glow counts in §1.2.
  - [Shot] `owner_desk_0–3.png` (≥8 decorative accents on one page), `appr_desk.png` (a gradient rail vs a solid warn rail).
- **Problem:** T1 is no longer unique, decoration competes with ₪, and corner radii alternate between neighbouring cards.
- **Fix:** shape, elevation and emphasis tokens (§3.6). Only T1 gets the 6 px rail; queue rows get 3 px tone rails; one flow hairline in the app header. Retire `glow-*-blob`, `leak-gradient` as a rail, and `shadow-glow-*`.
- **Benchmark:** Vercel Geist and Linear (2–3 radii, border-first surfaces) [K]; Material 3 elevation.

**design-system-14 · Hebrew set with `uppercase` and wide tracking: 72 ungated tracking uses, 84 uppercase.** · E6, B1 · `/dashboard` (hero eyebrow), KPI labels, table headers, receiving wizard · both devices
- **Evidence:** [Code] `page.tsx:400`, `KpiCard.tsx:90`, `StatCard.tsx:48`, the `thead` variants (§1.2), `receiving/[poId]/wizard.tsx` (eyebrow "צעד 2 מתוך 5"). [Shot] `owner_desk_0.png`, `phone_top_03.png`.
- **Problem:** spaced-out Hebrew reads as a Latin affectation and slows recognition. The T1 eyebrow instance is S1 under E6.
- **Fix:**
  - Labels and eyebrows are `caption` 600 `muted` with `tracking-normal`.
  - `uppercase` and tracking are allowed only behind `ltr:`, as the marketing shell already does.
  - Lint the ungated forms.
- **Benchmark:** RestoMatch's own marketing shell (`ltr:tracking-[0.18em]`); Apple HIG RTL typography.

**design-system-15 · Motion is untokenised: 53 `transition-all`, ad-hoc durations, shimmer that ignores reduced motion.** · I5, F9 · all routes · both devices
- **Evidence:** [Code] `Button.tsx:9`, `Skeleton.tsx:6` (`animate-pulse`), `receiving/[poId]/wizard.tsx:537`. [Grep] 53 `transition-all`, `duration-200/300/500`.
- **Problem:** layout properties animate. Frequent actions animate. Reduced-motion users still get pulse and shimmer.
- **Fix:** motion tokens (§3.8) through the Tailwind preset, property-specific transition utilities, `motion-safe:` shimmer, and lint `transition-all`.
- **Benchmark:** IBM Carbon motion (productive curves, 110–240 ms); Atlassian exit multiplier 0.5.

**design-system-16 · The token source is split and drifting: a dead TS mirror, a hand-synced CSS, a dark palette still shipped to native.** · B5, B8, J3 · global (`packages/ui-tokens`, `globals.css`, `apps/mobile`) · both devices
- **Evidence:**
  - [Code] `ui-tokens/src/index.ts:9–29` (`webColors`, imported by nothing), `:31–63` (dark `colors` + `glows` consumed by 7 `apps/mobile` files), `:65–80` (spacing without 12; radius not consumed).
  - `tailwind.config.ts:2` (imports only typography).
  - `globals.css:75–84` (`--rm-*` hex duplicates).
- **Problem:**
  - "Keep the two in sync" is enforced by comments, not code.
  - The owner decision of 2026-10-24 ("the whole product is light") is not true for the native app.
  - Tokens and code disagree on spacing (12 px is the most-used step and isn't a token).
- **Fix:**
  - The three-tier package with a generator (§3.1).
  - `native.ts` exports the *light* semantics for `apps/mobile`, or it is formally parked in `STATE.md`.
  - Delete `webColors`, `glows` and `--rm-*`.
- **Benchmark:** Atlassian design tokens (one source, generated platforms); Style Dictionary pattern [K].

**design-system-17 · Off-palette colour and untokenised data-viz: a brown heatmap, hex sparklines, gradient bars, red zeros.** · B8, C14, A3 · `/dashboard` (price creep, leak trend), `leaks/*`, chain · both devices
- **Evidence:** [Code] `LeakHeatmap.tsx:24–29,69–73,95`, `Sparkline.tsx:5,22,31` (hex stroke, `aria-hidden`, "—" for no data), `globals.css:150–163` (off-palette greens and gold in `flow-stream`). [Shot] `owner_desk_1–3.png`, `chain_desk.png`.
- **Problem:** charts don't share a palette with the app. Sparklines are invisible to screen readers. Bars carry a gradient and a shadow. Zero days are red.
- **Fix:** data-viz tokens (§3.2) with the sequential ramp ([Calc] text flip at h4), plus `BarList`, `Sparkline` v2, `Heatmap` and `ChartFrame` (§4.6).
- **Benchmark:** Atlassian `chart.*` tokens; Stripe Apps chart and sparkline guidance.

**design-system-18 · No page-header contract or container system: 4 `h1` sizes, accents on every heading, 1,152 px column.** · B9, D5, J4 · all dashboard routes · desktop-led
- **Evidence:** [Code] `Heading.tsx:3–8,47`, `layout.tsx:123,175`; 39 `level={1}` + 6 raw `h1`s. [Shot] `desk_top_01.png` (ask `h1` ≈20 px vs approvals 36 px), `desk_top_05.png` (back links as "→ חזרה" text, breadcrumbs or nothing), `desk_top_02.png` (header actions sometimes at the inline end, sometimes floating at the top).
- **Problem:** wayfinding and hierarchy change page to page. The vertical cost of the header varies from 80 to 150 px. Wide tables wrap inside a narrow column on a 1440 screen.
- **Fix:** `<PageHeader>` and `<SectionHeader>` v2 (§4.4) plus container tokens (§3.5), aligned with `lens-ia-nav`'s registry for breadcrumbs.
- **Benchmark:** Polaris Page; Stripe object header [K].

**design-system-19 · The filter, toggle and step control family is inconsistent in shape, height and semantics.** · A8, C1, B5 · `/dashboard`, approvals, leaks, chain, inbox, orders, exports, wizards · both devices
- **Evidence:** [Code] `ViewToolbar.tsx` (525 lines mixing native `<select>`, pills and `Segmented`), the 11 toggle files and 4 step implementations (§1.5). [Shot] `owner_desk_0.png` (3 heights in one toolbar), `phone_top_00.png` (the toolbar fills the first phone viewport), `desk_top_02/06.png` (12 px step pills).
- **Problem:** users relearn the controls on each page. On the phone the controls push the ₪ below the fold.
- **Fix:** `FilterBar`, `FilterChip`, `SegmentedControl`, `Tabs` and `Steps` (§4.5), with power controls behind one "תצוגה" button below lg.
- **Benchmark:** Linear filters and display options [K]; Polaris Filters; Material segmented buttons.

**design-system-20 · Feedback primitives are half-built: an untyped EmptyState, no Banner, Toast without action or persistence, one Skeleton shape.** · C8, C9, I3, I4, F7 · all routes · both devices
- **Evidence:** [Code] `EmptyState.tsx:20` (always centred, no `kind`), `Toast.tsx:9,28` (`success|error`, errors auto-dismiss at 7 s, no action), `Skeleton.tsx`. [Grep] 40 `role="alert"`, 5 `loading.tsx`, 1 `error.tsx`. [Shot] the worker banner on every capture uses the danger/warn tint for a system state (lab caveat, but the same component class carries real notices).
- **Problem:** Undo (R-7) has nowhere to live. Errors vanish. Page-level notices are built ad hoc with assertive alerts.
- **Fix:** `Banner`, `InlineMessage`, `Toast` v2, `EmptyState kind`, `Skeleton` variants, a delayed `Spinner` and `ProgressBar` (§4.8).
- **Benchmark:** Polaris Toast and Banner; Primer Blankslate; Carbon notifications.

**design-system-21 · Disabled states use five opacities and give no reason.** · C12, C6 · `/dashboard/orders/new`, `catalog/import`, `contracts/import`, `/dashboard/ask` · both devices
- **Evidence:**
  - [Grep] `disabled:opacity-40/45/50/60/70`.
  - [Shot] `phone_top_03.png`, `desk_top_06.png` ("המשך" pale green, no reason), `desk_top_01.png` ("שאלו" pale).
  - [Calc] white on primary@45% = 2.19:1.
- **Problem:** a user can't tell why they are stuck, or whether the control is broken.
- **Fix:** disabled tokens (§3.10) plus `disabledReason` on Button. Submit buttons are never validity-gated: validate on submit (C6).
- **Benchmark:** Primer forms ("don't disable the submit button"); Apple HIG.

**design-system-24 · Signs are concatenated by hand ("+ 3.41₪", "12%+", "+ ₪…").** · E4, A3 · `/dashboard` (recipes card), `inventory`, showcase, `DeltaBadge` · both devices
- **Evidence:** [Code] `KpiCard.tsx:83`, `DeltaBadge.tsx:70,88,99`, `inventory/period-card.tsx:220,225`, plus the rubric baseline sites (`recipe-ui.ts:21–25`, `price-alert.tsx:73`, `over-contract.tsx:84,172`). [Shot] `owner_desk_2.png` ("+ 3.41₪"), `surfaces.png` (showcase "12%+").
- **Problem:** the bidi algorithm detaches hand-built signs. A price move can read as its opposite.
- **Fix:**
  - **Human PR:** add `signDisplay` (and nothing else) to `formatIls`; `money-format-marshal` reviews it.
  - Meanwhile, `<Delta>` uses arrow + word + `formatIls(Math.abs(x))`.
- **Benchmark:** Intuit Content Design (the minus before the currency); ICU `signDisplay`.

### P3

**design-system-22 · Iconography: mixed stroke weights, decorative icon-chip tints, ad-hoc mirroring.** · J4, E2, C11 · receiving, showcase, `/dashboard`, chain · both devices
- **Evidence:** [Grep] 35 `strokeWidth={3}`; icons at `h-3` (12 px) outline next to 12 px text. [Code] `Breadcrumbs.tsx:36` (`rtl:-scale-x-100`), `page.tsx:516` (`ltr:-scale-x-100`). [Shot] `chain_desk.png`, `owner_desk_2.png`.
- **Fix:** `<Icon>` at stroke 1.75, size-by-text, `<DirIcon>` and a neutral-default `<IconChip>` (§3.9).
- **Benchmark:** Primer icon sizing (12 filled / 16 / 24 outline); Material bidirectionality.

**design-system-23 · Showcase and admin carry their own design dialect.** · J3 · `/showcase/*`, `/admin/*` (code) · desktop
- **Evidence:** [Code] `showcase/dashboard/page.tsx:216–231,620`, `showcase/…/[supplierId]/page.tsx:295,352,649` (own `KpiCard`, `SectionHeader`, `StatusPill`); 17 hex in showcase; `app/admin/**` 16 `font-mono` + 6 `uppercase`. [Shot] `surfaces.png`.
- **Problem:** the demo a prospect sees will drift from the product as the product moves to v2.
- **Fix:** showcase and admin import `lib/components` v2. Same tokens; no local primitives.
- **Benchmark:** Stripe (dashboard, docs and receipts feel like one product) [K].

---

## 6. Migration plan and enforcement

| Phase | Scope | Owner | Effort | Visual change |
|---|---|---|---|---|
| **0 · Foundations** | Three-tier `ui-tokens` + generator + Tailwind preset added *beside* today's keys. `--c-focus`, `.focus-ring`, `scroll-padding`, motion tokens, `twMerge`. Lint rules in **warn**. `(internal)/ds` page. | rtl-design-steward + web-feature-engineer | M | None, except the focus ring |
| **1 · Numeric layer** | `Money`, `MetricHero`, `MetricTile`, `Token`, `DateTime`, `Delta`. Codemods for `font-mono` money (327), `bdi dir=ltr` money (60) and the 42 local helpers. Dock slip and portal first (P0). | rtl-design-steward (visual ₪), money-format-marshal review | M | High: the hero, tiles and amounts |
| **2 · Core primitives** | `Button` v2, `IconButton`, `StatusChip`, `CountBadge`, `Card tier`, `PageHeader`, `SectionHeader`. Delete `KpiCard`, `StatCard` and the 7 local copies; type codemod; radius/elevation codemod; remove glow and flow decoration. | web-feature-engineer | L | Medium |
| **3 · Data and density** | `DataTable` family + density tokens + `MobileCardList`. Approvals rows at ≥1024; pay-run; ledger (compact); catalog; breakdown. | web-feature-engineer (+ test-sentinel for `aria-sort` tests) | L | High on desktop |
| **4 · Forms, feedback, controls** | `Field` v2, `MoneyInput`, `QuantityInput`, `DateField`, `ErrorSummary`, `Banner`, `Toast` v2, `EmptyState kind`, `Skeleton` variants, `FilterBar`, `SegmentedControl`, `Tabs`, `Steps`, `Sheet`/`Peek` (with the mobile lens). | web-feature-engineer + ocr-procurement-engineer (field inputs) | L | Medium |
| **5 · Gate** | Rules to **error**. Playwright visual baseline of `(internal)/ds` in he/en × 3 densities. **CI wiring = human PR to `.github/workflows/ci.yml`.** | test-sentinel → human | S | — |

**Lint and grep rules** (`apps/web/eslint` + `scripts/ds-check.sh`). The rubric appendix covers the first part; these are added:

| Rule | Target |
|---|---|
| `font-mono` outside `lib/components/Token.tsx` | 0 |
| `dir="ltr"` on a node whose children call `formatIls`/`ils`/`money` | 0 |
| `text-[…]` arbitrary sizes; `text-caption` inside `(field)` routes | 0 |
| `#[0-9a-f]{6}` in TSX (except `og/`, print replicas) | 0 |
| `(bg|text|ring|border)-(danger|warn|gold|primary|info)/\d+` | 0 |
| `transition-all`; `duration-*` outside tokens | 0 |
| `rounded-(sm|md|lg|xl|2xl|3xl)` (only `control|card|overlay|pill`) | 0 |
| `shadow-glow-`, `glow-*-blob`, `leak-gradient`, `glass` inside `app/dashboard` | 0 |
| ungated `uppercase` and `tracking-(wide|wider|widest|\[)` | 0 |
| `ring-line`, `ring-primary/(50|60)` | 0 |
| `type="number"`, `type="date"` | 0 |
| local `function (Kpi|Stat|StatusBadge|StatusPill|SectionHeader|Segmented|Steps)\w*` in `app/**` | 0 |
| `variant="gold"`, `variant="accent"` | 0 |

---

## 7. Big moves (ranked by ₪ value ÷ risk)

1. **The numeric layer** (`Money`, `MetricHero`, `MetricTile`, `Token`, `DateTime`) plus the money-state tokens. It fixes the P0, the two numeric voices and the colour drift in one pass, and gives the one number one face on every surface. Effort M · both devices · exemplar Stripe and Mercury balances.
2. **Token architecture v2** (three tiers, generator, replaced Tailwind theme, role colours, focus, motion, radius, elevation, density). Everything else consumes it. Effort M · both · exemplar Atlassian tokens.
3. **DataTable plus density for the desktop bosses.** Approvals, pay-run, ledger and catalog become dense, sortable, totalled and batchable, with ≥10 decisions per screen. Effort L · desktop (cards on mobile) · exemplar Polaris IndexTable, Ramp bill inbox, Carbon.
4. **Consolidating the core primitives.** `Button` v2, `IconButton`, `StatusChip`, `Card tier`, `PageHeader`, `FilterBar`, `SegmentedControl`, `Tabs` and `Steps` replace about 60 local variants; showcase and admin migrate too. Effort L · both · exemplar Polaris, Primer, Linear.
5. **Enforcement:** lint in warn → error, the `(internal)/ds` living page and a visual baseline, with the CI wiring done by a human. Effort S–M · both · exemplar Primer and Polaris docs-as-code.

---

## 8. Rubric scorecard (this lens)

| Criterion | Result | Note |
|---|---|---|
| B1 type scale | **Fail** | 21 sizes, 101 sub-12 px uses |
| B2 money face | **Fail** | Mono money; no ₪ glyph in mono |
| B3 precision | Partial | 42 helpers choose ad hoc; approvals tile 0 dp vs rows 2 dp |
| B4 place-value columns | Partial | The ledger aligns right by luck; no `NumCell`; ₪ repeated per cell |
| B5 spacing grid | Partial | 419 off-grid steps; tokens lack 12 |
| B6 density | **Fail** | None |
| B7 shape and elevation | **Fail** | 8 radii; glow names; no e2/e3 |
| B8 colour roles | **Fail** | 75 alpha combinations; 32 hex |
| B9 layout and reflow | Partial | No horizontal overflow on any capture (good); container drift; no page-header contract |
| C11 status chips | Partial | Words present, icons on 6/98; chips where no state matters |
| C12 buttons | **Fail** | Gold second primary; no tertiary; 4 equal hero actions |
| E4 ₪ rendering | **Fail (S0)** | Dock slip and portal |
| E6 Hebrew typesetting | **Fail** | 72 tracking, 84 uppercase |
| F2 contrast | Pass | Every token pair AA [Calc]; axe colour-contrast 0 |
| F3 focus | **Fail** | 98 rings below 3:1 |
| I5 motion | **Fail** | 53 `transition-all`, no tokens |
| I7 button feedback | **Fail** | No pressed state; unstable loading width |
| J3 one product | Partial | Marketing shares the palette; showcase, admin and native diverge |
| J4 restraint | **Fail** | ≥8 accents per view; glow blobs |

---

## 9. Governance (AGENTS.md)

- **Not immutable:** `packages/ui-tokens`, `globals.css`, `tailwind.config.ts` and `lib/components`. Agents may implement them in PRs. Owners: `rtl-design-steward` for tokens and the visual ₪, `web-feature-engineer` for components and pages.
- **`formatIls()` is frozen.** `<Money>` only wraps it, and the hero glyph split slices its *output*. **`signDisplay` (design-system-24) is a human PR** (`money-format-marshal`).
- **Tolerances, approvals engine and schema:** no change is proposed. Money-state colours are presentation only.
- **CI gate wiring** (`.github/workflows/ci.yml`) is a **human PR**. `test-sentinel` writes the Playwright specs and the `ds-check.sh` script.
- **`apps/mobile`:** moving it to the light semantics is an owner decision (product scope), not an immutability issue. Until then it is recorded as parked in `STATE.md` by `icp-keeper`.
- **Evidence files for reviewers:**
  - crops: `review/crops-ds/*.png`;
  - scripts: `review/scripts/ds_sheets.py`, `review/scripts/ds_contrast.py`.
