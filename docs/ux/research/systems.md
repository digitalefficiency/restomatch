# Design systems and component craft: what the best systems do, and what RestoMatch should copy

**Scope:** type and numbers, spacing and density, data tables, forms and validation, empty, loading and error states, toasts versus inline messages, focus and keyboard, motion, elevation, color roles, iconography.
**Systems studied:** Shopify Polaris, Atlassian Design System, IBM Carbon, Google Material 3, Apple HIG, GitHub Primer, Linear, Vercel Geist. WCAG 2.2 is used as the floor.
**Target:** `apps/web` (Next.js 15, Hebrew-first, RTL, light "command center for money"), tokens in `packages/ui-tokens` and `apps/web/app/globals.css`.
**Date:** 2026-10-25.

---

## 0. How this research was done (read this before trusting a number)

The design-system websites (carbondesignsystem.com, polaris.shopify.com, m3.material.io, primer.style, atlassian.design, vercel.com, linear.app) are **blocked by this sandbox's egress proxy** (403 on CONNECT; WebFetch DNS fails). So I went to the **published source of those same pages**, which is more exact than the rendered sites:

| System | What I actually read | Tag |
|---|---|---|
| IBM Carbon | The MDX source of the website: `carbon-design-system/carbon-website` → `src/pages/components/data-table/{usage,style,accessibility}.mdx`, `elements/motion/overview.mdx`, `elements/spacing/overview.mdx`, `components/notification/usage.mdx`, `patterns/{notification,loading,empty-states,forms,status-indicator}-pattern/index.mdx` | **[src]** |
| Shopify Polaris | `Shopify/polaris` → `polaris-tokens/src/themes/base/{motion,space,font,shadow}.ts`, `polaris.shopify.com/content/components/{tables/index-table,tables/data-table,feedback-indicators/banner,feedback-indicators/skeleton-page,layout-and-structure/empty-state,typography/text}.mdx`, `polaris-react/src/components/Text/Text.module.css`, `polaris-react/src/components/Frame/components/Toast/Toast.tsx` | **[src]** |
| Material 3 | `material-components/material-web` → `tokens/versions/v0_192/_md-sys-{motion,typescale,elevation,state}.scss` | **[src]** |
| GitHub Primer | `primer/design` → `content/ui-patterns/{loading,saving,notification-messaging,empty-states}.mdx`, `content/ui-patterns/forms/overview.mdx`, `content/components/data-table.mdx`, `content/guides/accessibility/focus-management.mdx`; `primer/primitives` → `src/tokens/functional/size/{size,size-coarse,size-fine,border}.json5`, `src/tokens/base/motion/{timing,easing}.json5` | **[src]** |
| Atlassian | npm packages `@atlaskit/tokens` (generated theme CSS: spacing, typography, motion, light colors), `@atlaskit/motion` (`utils/durations.js`, `exiting-durations.js`), `@atlaskit/flag` (`auto-dismiss-flag.js`) | **[src]** |
| Apple HIG | `developer.apple.com/tutorials/data/design/human-interface-guidelines/{accessibility,typography,motion,right-to-left,loading,feedback}.json` (the JSON behind the HIG pages) | **[src]** |
| Vercel Geist | Site unreachable. Toast numbers come from the `sonner` npm package (the toast library used across the Vercel and shadcn ecosystem). Color-step roles and type naming come from what I know of vercel.com/geist. | **[kn]** + **[src: sonner]** |
| Linear | Site unreachable. Used what I know of Linear's published redesign posts and product behavior (URL confirmed by search). | **[kn]** |

Then I **measured RestoMatch itself** (greps over `apps/web/app` and `apps/web/lib`, font tables of the shipped `.woff2` files via fontTools, WCAG contrast math on the real token hex values). Every "Evidence in RestoMatch" line below can be checked again with the same commands.

---

## 1. Executive summary: the 10 moves that matter most

1. **One numeric voice.** Show money in Heebo, not JetBrains Mono. Heebo's digits are already all the same width (1151 font units each, measured). JetBrains Mono's shipped subset **has no ₪ glyph** (U+20AA is not in its cmap), so every `font-mono` amount draws its ₪ from whatever fallback font the operating system has. Keep mono only for identifiers: invoice number, allocation number, PO number.
2. **Line up place values in RTL.** In money columns, the decimal separators must sit on one vertical line. Numbers always render left-to-right, so the last digit sits on the **physical right** edge even inside an RTL page. Use tabular digits, a fixed number of decimals per column, and put ₪ in the column header (the Polaris rule: units go in the header).
3. **Bidi-isolate every amount.** A negative credit written as "-₪120" inside Hebrew text must not render as "120-". Every money value must be a bidi-isolated left-to-right run.
4. **Close the type scale.** RestoMatch uses **21 distinct font sizes** today, including **101 uses of 9–11px** (`text-[9px]`, `text-[10px]`, `text-[11px]`). Close the scale at 10 named roles with a 12px floor, plus a dedicated **metric** role for ₪ figures (Atlassian ships `font.metric.*` tokens for exactly this).
5. **Make sortable tables real.** There are **39 `<table>`s and 0 `aria-sort`** attributes. Adopt the Carbon and Primer sort contract: one column sorted on load, three icon states, `Tab` then `Space`/`Enter`, and `aria-sort` on the header.
6. **Fix the focus ring.** The ghost button's focus ring uses `ring-line` (#D3DDD7), which is **1.39:1** against white. The secondary button uses `ring-primary/60`, which is **2.81:1**. Both fail WCAG 1.4.11's 3:1 minimum. Use one `--c-focus` token, 2px wide with a 2px offset (Primer: 2px width "MUST" be used for focus rings).
7. **Errors never auto-dismiss.** `lib/components/Toast.tsx` removes error toasts after 7000 ms. Carbon, Primer and Polaris all keep errors inline or persistent. Toasts are only for low-stakes confirmations: 5 s without an action, 10 s with one (Polaris source values).
8. **Tokenize motion.** Today there are **53 `transition-all`** and no duration tokens. Use 4 durations (100/150/240/400 ms), exits at about half the entrance time (Atlassian's multiplier is 0.5), and Carbon's productive easing.
9. **Add density modes per persona.** Rows of 32px (bookkeeper ledger), 48px (owner and manager, the default), and 56px or more (receiver at the back door). The table header row always matches the body row height (Carbon).
10. **Give every route a loading, empty and error state.** Only **5 `loading.tsx`** exist across about 60 dashboard routes, and only **1 `error.tsx`** (the root). Adopt Primer's wait-time ladder (<1 s nothing; 1–3 s skeleton or spinner; 3–10 s determinate progress; >10 s background task) and Carbon's three empty-state types.

---

## 2. RestoMatch baseline, measured (2026-10-25)

| Metric | Value | Why it matters |
|---|---|---|
| Distinct font sizes in TSX | **21** (683 `text-sm`, 607 `text-xs`, 53 `text-[11px]`, 45 `text-[10px]`, 3 `text-[9px]`, plus 8 one-off arbitrary sizes such as `text-[4.1rem]`) | Polaris ships 11 text variants and Atlassian 13 (7 heading, 3 body, 3 metric). 21 sizes means there is no scale. |
| Font weights in use | 6 (semibold 510, bold 227, medium 211, extrabold 48, normal 17, black 3) | Polaris uses 4 weights (450/550/650/700) and Atlassian 4. |
| `font-mono` uses | **327** | Mostly money. JetBrains Mono subset has **no ₪**, and its digits are 600/1000 em wide while Heebo's are 1151/2048 (≈0.56 em), so the page has two numeric voices. |
| `.nums` / `tabular-nums` uses | 376 / 385 | Good intent, but Heebo has **no `tnum` feature** (GSUB: ccmp, frac, liga, locl only). It is already tabular by design, so the class does nothing on Heebo text. Harmless, but don't rely on it for other fonts. |
| `<table>` elements | 39 | — |
| `aria-sort` | **0** | No accessible sorting anywhere. |
| Mobile card collapse (`md:hidden` lists) | 4 (orders table only) | 35+ tables likely scroll sideways on a phone. |
| Hex colors inside TSX | **43** | Breaks the "tokens only" rule in AGENTS.md and DESIGN-BRIEF.md. |
| Border-radius values in use | **8** (`xl` 206, `full` 112, `2xl` 110, `lg` 95, `md` 35, `3xl` 14, `sm` 4, `[2rem]` 2) | Geist and Linear use 2–3 radii. |
| Shadows | `shadow-card` 83, `shadow-glow-primary` 41 (legacy dark-theme name), `glow-danger` 6, `glow-gold` 4 | There are no elevation levels defined by meaning. |
| `transition-all` | **53** | Animates layout properties too, and has no duration or easing tokens. |
| `loading.tsx` / `error.tsx` | 5 / 1 | Most routes have no designed loading or error state. |
| `disabled=` props | 122 | Primer says never disable a form's submit button for validation. Audit these. |
| Toast durations | success 3500 ms, error 7000 ms (auto-dismiss) | Errors must persist. Success is slightly short compared with Polaris (5000) and Sonner (4000). |
| Focus ring contrast | ghost `ring-line` **1.39:1**; secondary `ring-primary/60` **2.81:1**; secondary hover border `primary/40` 1.91:1 | WCAG 1.4.11 needs 3:1. |
| Global Cmd/Ctrl+K | none (`search.tsx` has arrow and Enter navigation, but no global open shortcut) | Linear-grade navigation needs it. |
| Spacing token file | `spacing = {4, 8, 16, 24, 32, 48}` | The most-used Tailwind step is `3` (12px, 857 uses), which is missing from the tokens, so the tokens are out of sync with the code. |

---

## 3. Principles (25): concrete and checkable

Each principle gives the **rule**, its **sources**, the **evidence in RestoMatch**, where to **apply** it, and an **acceptance check** a reviewer or agent can run.

### A. Type and numbers

#### P1. One numeric voice: money in the text face, mono only for identifiers
- **Rule:** Every ₪ amount, quantity, percentage and unit price renders in Heebo with `font-variant-numeric: tabular-nums lining-nums`. JetBrains Mono is reserved for **identifiers that people compare character by character**: invoice number, allocation number (מספר הקצאה), PO number, barcode or SKU, and codes in exports.
- **Sources:**
  - Polaris `Text` has a `numeric` prop that compiles to `font-variant-numeric: tabular-nums lining-nums` (Text.module.css L202–203) **[src]**.
  - Polaris IndexTable: "Numeric cells should use the numeric style" **[src]**.
  - Primer DataTable: "Right-align numeric values and use the `tabular-num` font variant" **[src]**.
  - Geist separates `label-*-mono` and `copy-*-mono` styles for code-like strings from the text styles **[kn]**.
- **Evidence:** 327 `font-mono` uses. JetBrains Mono's shipped cmap lacks U+20AA (₪), so ₪ falls through to `ui-monospace`, then SFMono, Menlo, Consolas, depending on the OS: different weight, width and baseline on every platform. Heebo's digits are all 1151 units wide, so it is already tabular.
- **Apply:** leak hero (`app/dashboard/page.tsx` ~L410), `KpiCard`, `StatCard`, every money column, approvals and pay-run totals, supplier ledger. Keep mono in `invoices/[invoiceId]` and in the identifier column of `scans/[invoiceId]`.
- **Check:** `grep -rn "font-mono" apps/web/app | grep -i "ils\|₪\|amount\|formatIls"` returns 0. Every ₪ glyph on a page comes from Heebo (verify with DevTools → Computed → Rendered Fonts).

#### P2. A dedicated metric role, separate from headings
- **Rule:** Money figures use **metric** tokens, never heading tokens. Metric styles are tabular, bold, with tight letter-spacing, and their line height sits on the 4px grid. Only **one T1 hero per page**.
- **Sources:**
  - Atlassian ships `font.metric.large` (653 weight, 1.75rem/2rem), `font.metric.medium` (1.5rem/1.75rem) and `font.metric.small` (1rem/1.25rem), separate from `font.heading.*` **[src]**.
  - Polaris uses negative letter-spacing on large text (`font-letter-spacing-densest` −0.54px, `denser` −0.3px, `dense` −0.2px) **[src]**.
  - Primer: line heights are "unitless … making them align to the 4px grid" **[src]**.
- **Evidence:** the hero uses `text-5xl`/`text-6xl`, KPI tiles use `text-4xl`, and there are arbitrary `text-[4.1rem]` and `text-[3.6rem]` sizes. There is no metric role, so each screen picks its own size.
- **Apply:** proposed scale. Desktop is ≥1024px; mobile values in brackets.

  | Token | Size / line height (px) | Weight | Use |
  |---|---|---|---|
  | `metric-hero` | 56/60 (mobile 40/44) | 800 | T1 leak ₪ only: dashboard, leaks, report, chain |
  | `metric-lg` | 32/40 | 700 | KPI tiles, T2 card amount |
  | `metric-md` | 24/32 | 700 | Section totals, pay-run sum |
  | `metric-sm` | 16/24 | 600 | Table totals row, inline ₪ in sentences |

  Letter-spacing: −0.02em at ≥32px, otherwise 0.
- **Check:** at most one element per page carries `metric-hero`. No `text-[N rem]` anywhere.

#### P3. A closed type scale with a Hebrew floor of 12px
- **Rule:** At most 10 named text roles, no arbitrary sizes, **minimum 12px**. Body default is 16px for reading and 14px for dense UI.
- **Sources:**
  - Polaris variants range from `bodyXs` 11px to `heading3xl` 36px **[src]**.
  - M3: `body-large` 16/24, `body-medium` 14/20, `label-small` 11/16 **[src]**.
  - Atlassian: `font.body` 14/20, `body.large` 16/24, `body.small` 12/16 **[src]**.
  - HIG: iOS default 17pt, minimum 11pt **[src]**. HIG right-to-left: Hebrew "can appear too small when next to uppercased Latin text … increase the RTL font size by about 2 points" **[src]**.
  - Hebrew has no x-height or case variation, so take the Latin floors (11px) **+1px**: 12px.
- **Evidence:** 101 uses of 9–11px, including `text-[11px]` on the dashboard (~L556).
- **Apply:** `heading-lg` 24/32, `heading-md` 20/28, `heading-sm` 16/24, `body` 16/24, `body-sm` 14/20, `caption` 12/16, plus the four metric roles: 10 roles in total. Retire `text-[9|10|11px]` and use `caption` (12px) for badges, column headers and timestamps.
- **Check:** `grep -rnE "text-\[(9|10|11)px\]" apps/web` returns 0. The Tailwind `fontSize` theme is replaced (not extended) with these 10 keys.

#### P4. Line up the decimal separators in money columns (RTL-correct)
- **Rule:** In any column of amounts, all decimal separators share one x-coordinate. Achieve this with (a) tabular digits, (b) the **same number of decimals in every row** (2 for ₪ amounts, 4 for unit prices, as stored), (c) the cell aligned to the number's **last-digit edge, which is the physical right edge** because numbers render left-to-right even in RTL, and (d) **₪ moved to the column header** (`סכום (₪)`), so a trailing ₪ doesn't make the edge ragged. Headers align with their data, and nothing is centered.
- **Sources:**
  - Polaris DataTable: "Numerical = Right aligned … Align headers with their related data … Don't center align", "Include units of measurement symbols [in headers] so they aren't repeated", "Keep decimals consistent. For example, don't use 3 decimals in one row and 2 in others" **[src]**.
  - HIG RTL: "Don't reverse the order of numerals in a specific number … Hebrew text uses Western Arabic numerals" **[src]**.
- **RTL nuance:** mirroring Polaris's "right" to `text-end` (which is the left side in RTL) aligns the *most*-significant digits. "₪1,234.50" over "₪12.00" then puts the decimal points at different x positions. Place value lives on the physical right. Treat this as an explicit owner decision and validate with 3 Hebrew-reading users (bookkeeper persona first).
- **Apply:** supplier ledger (`suppliers/ledger`), approvals and pay-run, leaks breakdown, monthly report, invoice lines in `invoices/[invoiceId]`, catalog prices.
- **Check:** screenshot a column holding 12.00, 1,234.50 and 98,765.43. A vertical line through one decimal point passes through all three.

#### P5. Every amount is a bidi-isolated left-to-right run
- **Rule:** Each rendered money value is wrapped so the bidi algorithm can't move its sign or symbol: `<bdi>` or `unicode-bidi: isolate` on the money span. Negative amounts and credits use a real minus (U+2212) or the format's sign, inside the isolated run. Ranges ("₪1,200–₪1,500"), dates (25.10.2026) and phone numbers never reverse.
- **Sources:**
  - HIG RTL: "Don't reverse the order of numerals in a specific number … phone number, credit card number" and "Reverse the order of numerals that show progress … never flip the numerals themselves" **[src]**.
- **Evidence:** formatting goes through `apps/web/lib/money.ts` and `packages/api/src/reports/money.ts`. Isolation is a **rendering** concern, so it belongs to `rtl-design-steward`, not a change to the frozen `formatIls()` util.
- **Apply:** credit claims ("זיכוי ₪-120"), price-alert deltas (`DeltaBadge`), recovery page, `vat-at-risk.tsx`, and sentences such as "נחסכו לך ₪3,240 החודש".
- **Check:** render `formatIls(-120)` inside a Hebrew sentence in a test page. The minus stays attached to the digits, and nothing jumps to the far end of the line.

### B. Spacing, density and shape

#### P6. A 4px grid with explicit steps, tokenized to match reality
- **Rule:** Spacing comes only from `2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Component padding uses 8/12/16, card padding uses 16 (mobile) or 24 (desktop), section gaps use 32/48.
- **Sources:**
  - Carbon: `$spacing-01`…`13` = 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 **[src]**.
  - Atlassian: `space.025`…`space.1000` = 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80 **[src]**.
  - Polaris: `space-025`…`space-3200` on a 4px base **[src]**.
- **Evidence:** `packages/ui-tokens` spacing is `{4, 8, 16, 24, 32, 48}`, yet the code's most-used step is 12px (`p-3`/`gap-3`, 857 uses). Tokens and reality disagree.
- **Apply:** add `space-050` (2px), `space-150` (12px), `space-250` (20px), `space-500` (40px) and `space-800` (64px) to ui-tokens and sync Tailwind `spacing`.
- **Check:** no `p-[Npx]`, `gap-[Npx]` or `m-[Npx]` arbitrary values in TSX.

#### P7. Density modes chosen by persona, not by screen
- **Rule:** Three row and control densities.

  | Mode | Row height | Cell padding (inline) | Control height | Who uses it |
  |---|---|---|---|---|
  | `compact` | 32px | 12px | 32px | Bookkeeper: ledger, exports, admin |
  | `default` | 48px | 16px | 40px | Owner and manager |
  | `touch` | 56px | 16px | 48px | Receiver; any `(pointer: coarse)` context |

  The header row always matches body row height. On coarse pointers, interactive targets are ≥44×44 with about 12px between bezeled controls.
- **Sources:**
  - Carbon rows: xs 24, sm 32, md 40, **lg 48 (default)**, xl 64 ("only … if … 2 lines of content"). "The column header row … should always match the row size". Column padding 16 (`$spacing-05`) **[src]**.
  - Primer DataTable density: Condensed / Normal (default) / Spacious **[src]**. Primer control heights 24/28/32/40/48 and `minTarget` coarse **44px**, fine 16px **[src]**.
  - HIG: 44×44 pt default (28 minimum) on iOS, plus "about 12 points of padding around elements that include a bezel … 24 points … without a bezel" **[src]**.
  - WCAG 2.2 2.5.8: 24×24 CSS px is the AA floor.
- **Evidence:** `globals.css` already forces min-height 44px on coarse pointers (good). There are no density tokens for tables.
- **Apply:** `receiving/[poId]` (wizard and dock slip): 56px rows, 48px quantity steppers, and a bottom sticky "סיים קבלה" button inside the thumb zone. `suppliers/ledger` and `exports`: compact. Everything else: default.
- **Check:** a Playwright test at 390px with `hasTouch` asserts every `button`, `[role=button]` and `a.touch-target` in `receiving/*` has a bounding box of at least 44×44.

#### P8. At most 4 radii and 4 elevation levels, assigned by meaning
- **Rule:** Radius: 8 (controls, inputs, badges inside tables), 12 (cards), 16 (dialogs, sheets, the hero card), `full` (pills, avatars). Elevation:

  | Level | Treatment | Used for |
  |---|---|---|
  | e0 | flat, `line` border | Page sections |
  | e1 | `shadow-card` | Cards |
  | e2 | overlay shadow | Menus, popovers, toasts, tooltips |
  | e3 | modal shadow + scrim | Dialogs, sheets |

  Shadow names describe a level, not a color ("glow").
- **Sources:**
  - M3 elevation levels 0/1/3/6/8/12 dp, plus state-layer opacities hover 0.08, focus 0.12, pressed 0.12, dragged 0.16 **[src]**.
  - Atlassian: `elevation.surface`, `.raised` (shadow `0 1px 1px #1E1F2140, 0 0 1px #1E1F214F`), `.overlay` (`0 8px 12px #1E1F2126, 0 0 1px #1E1F214F`) **[src]**.
  - Polaris `shadow-100`…`shadow-600` (e.g. 400 = `0 8px 16px -4px rgba(26,26,26,.22)`) **[src]**.
- **Evidence:** 8 radius values; 51 uses of `glow-*` shadow names left over from the dark era.
- **Apply:** remove `rounded-3xl`, `rounded-[2rem]`, `rounded-sm` and `rounded-md` from app screens (marketing may keep `3xl` for its hero art). Rename `shadow-glow-*` to `shadow-e1` plus an emphasis ring.
- **Check:** `grep -rhoE "rounded-(sm|md|3xl|\[)" apps/web/app/dashboard` returns 0.

### C. Color roles and focus

#### P9. Semantic tokens per role, not one hex per status plus alpha hacks
- **Rule:** Every status family (danger, warn, success/primary, money-recovered/gold, info, neutral) exposes the **same set of roles**: `text`, `icon`, `border`, `bg-subtle`, `bg-subtle-hover`, `bg-bold`, `bg-bold-hover`, `text-on-bold`. Components consume roles (`bg-danger-subtle`), never `bg-danger/12`, and never hex.
- **Sources:**
  - Atlassian: `color.background.danger` #FFECEB, `.danger.hovered`, `.danger.subtler`, `.danger.bold` #C9372C, `.danger.bold.hovered` #AE2E24, `color.text.danger` #AE2E24, `color.border.danger`, `color.icon.danger`, plus `chart.danger.*` **[src]**.
  - Geist's 10-step scales assign fixed jobs: steps 1–3 component backgrounds (default, hover, active), 4–6 borders (default, hover, active), 7–8 solid high-contrast backgrounds, 9–10 secondary and primary text and icons **[kn]**.
  - Linear generates its themes in the LCH color space so equal lightness reads as equal brightness across hues **[kn]**.
- **Evidence:** a single value per semantic (`--c-danger` etc.) plus ad-hoc alphas `/10`, `/12` and `/25` in `Badge.tsx`; 43 hex literals inside TSX.
- **Apply:** extend `globals.css` `:root` with the role tokens (keep the existing hex values as `bold`). Map T2 to `bg-bold`, T3 to `bg-subtle` (gold or primary), and T4 to the neutral roles.
- **Check:** `grep -rnE "#[0-9a-fA-F]{6}" apps/web/app apps/web/lib --include=*.tsx` returns 0 outside `og/` and charts' generated SVG. `grep -rnE "(bg|text|ring)-(danger|warn|gold|primary|info)/[0-9]+"` returns 0.

#### P10. One focus token: 2px wide, at least 3:1, always visible on keyboard focus
- **Rule:** `--c-focus` (proposal: info #1A5BC7, contrast 6.24 on white, 5.85 on `bg`, 5.56 on `surface-2`), applied as a 2px ring with a 2px offset in the surface color, through `:focus-visible` only. It must never take a decorative token (`line`) or an alpha below 3:1. A sticky header or footer must never cover the focused element.
- **Sources:**
  - Primer `borderWidth.thick` 2px: "MUST use for focus rings on interactive elements" **[src]**. Primer: "never remove the focus indicator unless you are replacing it … use `:focus-visible`" **[src]**.
  - Atlassian `color.border.focused` #4688EC, a dedicated focus color distinct from brand **[src]**.
  - WCAG 2.2: 1.4.11 (3:1 non-text contrast), 2.4.11 (Focus Not Obscured, AA), 2.4.13 (Focus Appearance, AAA: an area at least a 2px perimeter with 3:1 change).
- **Evidence:** `Button.tsx` ghost uses `focus-visible:ring-line`, which is **1.39:1**. Secondary uses `focus-visible:ring-primary/60`, which is **2.81:1**. 128 `outline-none` uses, of which 5 have no `focus-visible`/`focus:ring` replacement on the same line.
- **Apply:** `Button`, `Input`, nav links, table header sort buttons, the `search.tsx` combobox, the branch switcher.
- **Check:** axe-core rule `focus-visible` plus a custom contrast test that reads the computed `box-shadow` color of `:focus-visible` on every variant: ≥3:1 against the parent background.

#### P11. Status needs color, an icon and a label; groups take the worst child's status
- **Rule:** Every status chip has a shape or icon, a text label and color. Color is never alone; `danger` versus `ink` is only 2.56:1 by hue. When several statuses roll up (a consolidated invoice made of several delivery notes), the **roll-up shows the highest-attention child status**. A consolidated invoice with nothing wrong stays T4 neutral and must never be colored danger by default.
- **Sources:**
  - Carbon status pattern: icon indicators "require an icon, a shape, a meaningful color, and a descriptive inline label". "When multiple statuses are consolidated, use the highest-attention color to represent the group" **[src]**. Carbon: "Avoid using status indicators when no user action is required … use plain text" **[src]**.
  - Primer message states each pair an icon with a color (info, warning, critical, success, unavailable, upsell). Icons are filled at 12px and outline at 16/24px **[src]**.
- **Apply:** match-status badges in `invoices/*` and `inbox`, receiving line status, chain branch tiles (`chain/page.tsx`): a branch rolls up its worst invoice.
- **Check:** a visual test in grayscale (CSS `filter: grayscale(1)`): every status is still distinguishable.

### D. Data tables

#### P12. The sort contract
- **Rule:**
  - A sortable table **loads with one column already sorted**, and that column shows its arrow.
  - Unsorted sortable headers show their affordance only on hover or focus.
  - Three states (none → first direction → reverse), plus a "sorting…" state for server sorts.
  - Headers are `<button>`s inside `<th>`, reachable by `Tab` and activated by `Space`/`Enter`. `aria-sort` sits on the sorted `<th>`.
  - **RestoMatch deviation:** for ₪ columns the first click sorts **descending** (biggest money first). For text and date columns, ascending (Primer default).
- **Sources:**
  - Primer: "If a table is sortable, it must start with one column sorted on page load … If a column is not sorted yet, the first click sorts in ascending order". States: unsorted, ascending, descending, sort in progress **[src]**.
  - Carbon: three states `arrows`, `arrow--up`, `arrow--down`; "Only the sorted column displays an icon, and unsorted icons are only visible on hover". Headers "reachable by `Tab` and sortable with `Space` or `Enter`" **[src]**.
  - Polaris DataTable: sortable headers use `aria-sort` plus an `aria-label` that describes what activating will do **[src]**.
- **Evidence:** 0 `aria-sort` across 39 tables.
- **Apply:** approvals list (default sort: ₪ descending), leaks breakdown (₪ descending), suppliers (leak ₪ descending), invoices and inbox (date descending), catalog (name ascending).
- **Check:** a unit test over each table component: exactly one `th[aria-sort]` whose value is not `none` on first render.

#### P13. Sticky header, a sticky identity column, and wrap before truncating
- **Rule:**
  - Table headers stick (`position: sticky; top: <app-header height>`), and the first (identity) column sticks on horizontal scroll.
  - Long text **wraps**. Truncate only when a column has a set width, and then always expose the full text (title or tooltip).
  - Column titles wrap to 2 lines, then truncate.
  - **Never truncate names that share a prefix** ("תנובה – מרכז" and "תנובה – צפון" would look identical).
- **Sources:**
  - Polaris DataTable: "Wrap instead of truncate content … if row titles start with the same word, they'll all appear the same when truncated" **[src]**.
  - Primer: "Avoid wrapping or truncation … truncation is available as a last resort when column widths are set. The full content may be exposed in a tooltip" **[src]**.
  - Carbon column titles: "wrap the text to two lines and then truncate … full text … in a tooltip on hover" **[src]**.
  - HIG: "Keep text truncation to a minimum" **[src]**.
- **Evidence:** 87 `truncate` uses; 16 `sticky` (mostly navigation, not table headers).
- **Apply:** supplier names, product names (catalog mapping), invoice descriptions in `scans/[invoiceId]`.
- **Check:** every `truncate` element has a `title` or tooltip. No `truncate` on the supplier-name column.

#### P14. Row actions: at most 2 inline, the rest in an overflow menu; batch mode replaces row actions
- **Rule:**
  - 1–2 row actions show inline as labeled or icon buttons. With 3 or more, show one primary action and put the rest behind an overflow (⋯) menu. Never pull out more than one.
  - On touch devices overflow menus are **always visible**; there is no hover reveal.
  - Selecting rows switches the toolbar into a **batch bar** ("נבחרו 4 · ₪12,480 · אשר לתשלום") and disables per-row actions until the user exits batch mode.
  - The actions column has no visible header.
- **Sources:**
  - Carbon: "When the overflow menu contains fewer than three options, keep the actions inline as icon buttons". Overflow icons are "persistent on each row" by default, and touch user agents "persist the overflow menus even if … `overflowMenuOnHover`". Batch bar: "When batch mode is active, single action icons and overflow menus on the row should be disabled". Up to 5 toolbar actions **[src]**.
  - Primer: "1 primary action, other actions in an overflow … Do not pull out more than 1 action". "The column that contains row actions does not have a visible column header" **[src]**.
  - Polaris IndexTable bulk actions follow verb + noun, and shift-click range selection uses `position` **[src]**.
- **Apply:** approvals (primary "אשר", overflow: "דחה עם סיבה", "פתח חשבונית", "העבר לבירור"), claims ("שלח דרישה"), pay-run batch approve with the ₪ sum in the batch bar.
- **Check:** no row renders more than 2 visible action buttons. When the batch bar is shown, row buttons are `disabled` or `aria-disabled`.

#### P15. Empty cells, zero and unknown are three different things
- **Rule:** A **blank** cell means "not applicable" and carries a screen-reader label ("לא רלוונטי"). **₪0** means "checked, no leak" and renders as a T3 calm value. **"ממתין"** (pending) means "not yet known" and renders T4 neutral. Never use "—" or "x" as filler.
- **Sources:** Primer DataTable: "By default, leave empty cells blank … don't use a character like 'x' or '-'. It creates a weird experience for assistive technologies" **[src]**. The money adaptation is mine: in a leak product, "zero" is a result worth showing and "unknown" is a state.
- **Apply:** leaks breakdown, supplier scorecards, chain grid, receiving mismatches.
- **Check:** grep table renderers for the literal `'—'`, `'-'` or `'–'` used as cell fallbacks; the count should trend to 0.

#### P16. Responsive collapse: below 768px a row becomes a card
- **Rule:** Below `md` (768px), each row renders as a card with: identity (supplier or invoice) on line 1, the T1 or T2 ₪ amount at the end of line 1, status chip and date on line 2, and **one** action. Low-value columns are dropped, not squeezed. Horizontal scroll is allowed only for the bookkeeper's compact tables, and then with a sticky identity column. Bulk selection may be hidden below 490px if it isn't essential.
- **Sources:**
  - Primer narrow-viewport strategies: "Use the column width options, remove less important columns, scroll horizontally" **[src]**.
  - Polaris IndexTable `condensed` hides bulk actions "on screens smaller than 490px … only … when the bulk actions are not essential" **[src]**.
  - Carbon: give tables "the most width on the page" and "avoid placing data tables inside … smaller containers" **[src]**.
- **Evidence:** only `orders-table.tsx` has a mobile list (`md:hidden`).
- **Apply:** approvals (the manager on a phone), invoices, inbox, suppliers, claims, receiving list.
- **Check:** Playwright at 390px: `document.scrollingElement.scrollWidth <= 390` on every dashboard route except the declared compact ones.

#### P17. Page size and totals
- **Rule:** 20 rows per page by default. Paginate any list that can exceed 50 rows, and use "load more" for feeds such as activity and inbox. A **totals row** sums the visible money columns and sits under the header or as the last row, styled with `metric-sm`. No calculations other than sums in the summary row.
- **Sources:**
  - Primer: "20 rows is a good place to start" **[src]**.
  - Polaris IndexTable: "Paginate when the current list contains more than 50 items" **[src]**. Polaris DataTable: "Include a summary row to surface the column totals … Not include calculations within the summary row" **[src]**.
  - Carbon: "Load more" for progressive batches; pagination always at the table's bottom **[src]**.
- **Apply:** ledger, pay-run (the total ₪ to approve is the T2 number), monthly report, exports preview.
- **Check:** every money table either has a totals row or is explicitly marked "no totals" in its component props.

### E. Forms and validation

#### P18. Labels on top, short, never placeholders; mark the minority
- **Rule:** Labels sit above their field, are 1–3 words, and have no colon. Placeholder text is only an example ("לדוגמה: 514123456"), never the label. If most fields are required, mark only the optional ones "(רשות)", and the other way round. Helper text goes between the label and the field, is one line, and is replaced (not joined) by the error message when invalid. Field width reflects the expected length: allocation number about 12ch, amount about 10ch.
- **Sources:**
  - Carbon forms: top-aligned labels; "Do not use colons … one to three words"; mark the minority as "(optional)" or "(required)"; "field widths should reflect the intended length"; "the first required input field … should receive focus on presentation" **[src]**.
  - Primer forms: labels "no more than 3 words"; "Placeholder text is never an acceptable substitute for a label … disappears … too light … screen readers do not read"; "Show the validation message and remove the caption" **[src]**.
- **Apply:** onboarding, `orders/new`, `contracts/import`, `catalog/import`, settings, team invite, set-password, login/2fa, `leak-check` (marketing funnel).
- **Check:** no `<input>` without an associated `<label>` (axe `label`). No placeholder equals its label text.

#### P19. Validation timing: reward early, punish late; never block with a disabled submit
- **Rule:**
  - Validate a field **on blur after the user changed it**. Once a field is invalid, re-validate **as the user types** so the error clears the moment it's fixed.
  - On submit: if there are 3 or more errors, show an **error-summary banner** at the top that receives focus and lists anchor links to each field. Otherwise focus and scroll to the first invalid field.
  - Mark fields with `aria-invalid="true"` and `aria-describedby` → the error id. Don't use live regions for validation.
  - **Don't disable the submit button** for an invalid or unchanged form. Disable it only *while submitting*, to prevent a double post (critical for "אשר תשלום").
  - Show a spinner if async validation takes more than 1 s.
- **Sources:**
  - Primer forms: validation-on-submit as default; "If the form has 3 or more errors, you may show an interactive summary"; "first invalid input should be focused"; `aria-invalid`, `aria-describedby`; "Live regions should not be used for form validation"; inline validation "until after the user has made a change … and has removed focus"; "only after the first time the input has been validated and the input is in an invalid state"; ">1 second, show a loading indicator". Primer saving: "Do not disable or hide a form's save button even if the form is invalid" **[src]**.
  - Carbon forms: client-side validation "as soon as the field loses focus"; "When a user submits a form, disable the primary action button to prevent" double submission **[src]**.
- **Evidence:** 122 `disabled=` props. Audit which ones gate validity rather than pending state.
- **Apply:** contract import (many fields), order creation, catalog mapping, invite flow, 2FA code entry.
- **Check:** for each form, submitting empty moves focus to the first invalid field or the summary heading (Playwright `expect(page.locator(':focus'))`).

#### P20. One save model per form; keep the user's data; confirm or undo risky actions
- **Rule:** Never mix autosave and explicit save in one form. On a save error, keep every value the user typed. A destructive or money-moving action gets **either** a confirm step that names the object and the ₪ amount ("לאשר תשלום ₪12,480 ל־תנובה?") **or** an undo window. Prefer undo for reversible actions, and confirm for irreversible ones such as sending a claim email to a supplier. Warn on navigating away with unsaved changes.
- **Sources:** Primer saving: "never mix save patterns in a single form"; "the user's data should be preserved in the form"; `beforeunload` for unsaved changes; "Before submitting a form with potentially destructive consequences … ask the user to confirm … For risky changes, provide a way to undo" **[src]**. HIG feedback: "don't warn people when data loss is the expected result of their action" **[src]**.
- **Apply:** pay-run approval (confirm), reject approval (undo), archive claim (undo), send claim to supplier (confirm, naming the supplier and ₪), team role change (confirm).
- **Check:** `ConfirmDialog` copy always contains the object name and the ₪ value when money is involved.

### F. Feedback: loading, empty, error, messages

#### P21. The wait-time ladder, plus skeletons that are honest
- **Rule:**

  | Wait | Show |
  |---|---|
  | Under 1 s | Nothing (no flashing spinner) |
  | 1–3 s | Indeterminate: a skeleton for content regions, a spinner inside the button for actions |
  | 3–10 s | Determinate progress with text ("מעבד חשבונית… שלב 2 מתוך 3") |
  | Over 10 s | A background task with a notification when done (OCR batch, export) |

  Skeleton rules:
  - Skeletons copy the final layout. **Static titles render as real text**; only dynamic values are placeholders.
  - Skeletons only for containers and data (cards, tables, tiles), **never** for buttons, toasts, menus, dialogs or loaders.
  - Load the most important data first (the T1 number), and show items as they arrive.
  - Announce busy state to screen readers (`aria-busy` on the region).
- **Sources:**
  - Primer loading: "**Less than 1 second:** Don't show a loading state … **1–3 seconds:** indeterminate … **3–10 seconds:** determinate … **More than 10 seconds:** … background task"; "Show each item … as soon as it loads"; "prioritize the most important pieces of data"; "avoid creating a jarring layout shift" **[src]**.
  - Carbon loading: "Only use skeleton states on container-based components … Never represent toast notifications, overflow menus, dropdown items, modals, and loaders with skeleton states" **[src]**.
  - Carbon data table: "If extra load time is expected … use skeleton states instead of spinners" **[src]**.
  - Polaris SkeletonPage: "Show page titles that never change … Don't use placeholder content that will change" **[src]**.
  - HIG loading: "Show something as soon as possible" **[src]**.
- **Evidence:** 5 `loading.tsx` across about 60 dashboard routes; `Skeleton` is a bare `animate-pulse` box (8 importers).
- **Apply:** a `loading.tsx` for dashboard, leaks/*, invoices/*, suppliers/*, inbox, chain, reports/*. OCR scan progress in `scans/[invoiceId]` (determinate). Export generation as a background task with a notification.
- **Check:** every route folder under `app/dashboard` has `loading.tsx`. The rendered skeleton's bounding box matches the final layout within 8px (CLS < 0.1).

#### P22. Three kinds of empty state, each with one next step
- **Rule:** Name the type and write for it:
  - **(a) First use / no data:** an action-oriented title plus one primary CTA. Example: "סרקו חשבונית ראשונה כדי לראות כמה כסף דולף" with the CTA "סרוק חשבונית".
  - **(b) User action / no results:** say what to change. Example: "אין חשבוניות שתואמות לסינון" with "נקה סינון".
  - **(c) Error, permission or config:** plain words with no playful art, and the way out. Example: "החיבור ל־MarketMan נותק" with "חבר מחדש".

  Blocks are start-aligned (right in RTL) inside pages; center only inside small tiles. Never make the user feel guilty.
- **Sources:**
  - Carbon empty states: the three types; "Where possible, write this as a positive statement"; "Empty state elements should be left-aligned as a block. The one exception … small tile" **[src]**.
  - Polaris EmptyState: "Use only one primary call-to-action", action-oriented titles ("Create orders and send invoices", not "Orders and invoices"), "never make merchants feel unsuccessful or guilty" **[src]**.
  - Primer Blankslate: error states should "not attempt to bring delight … Default to using the alert icon", and "Error states are unlikely to ever have a secondary action" **[src]**.
- **Evidence:** `EmptyState.tsx` is always centered with a dashed border, whatever the type (29 importers).
- **Apply:** add a `kind: 'first-use' | 'no-results' | 'error'` prop to `EmptyState`. Fill dashboard first-run, leaks (no leak yet is T3 good news, not an empty void), claims, recovery, inventory, recipes, contracts.
- **Check:** every `EmptyState` call site passes `kind`. `first-use` has exactly one primary action.

#### P23. Choose the message type by stakes: inline, then banner, then toast, then dialog
- **Rule:**
  - **Inline message:** feedback tied to a field or row. It persists until resolved.
  - **Banner:** page- or section-level and persistent. One per page, placed under the page header, scrolling with content (not sticky). Dismissible unless critical. 1–2 sentences, at most 1 primary action.
  - **Toast:** only a low-stakes confirmation of a user action whose result is **not already visible**. Auto-dismiss after **5 s** without an action, **10 s** with one (an "בטל"/undo). The timer pauses on hover or focus. At most 3 stacked, newest on top. **Errors never go in an auto-dismissing toast.**
  - **Dialog:** only for decisions that block work.
  - Skip success messages when the UI already shows the result (the row moved to "אושר").
- **Sources:**
  - Polaris Toast source: `DEFAULT_TOAST_DURATION = 5000`, `DEFAULT_TOAST_DURATION_WITH_ACTION = 10000` **[src]**. Polaris Banner: "Be dismissible unless they contain critical information", "no more than one primary action", body "1 to 2 sentences", placed "below the page header" **[src]**.
  - Carbon notifications: inline "persist until … resolved or dismissed"; toast "can … dismiss automatically after five seconds"; "If the toast includes an action button … remain on screen until the user dismisses it"; banners "not sticky … Only show one banner at a time"; stacked toasts newest on top **[src]**.
  - Primer: "Use success messaging sparingly"; a note to avoid toasts on github.com for now because of accessibility issues; "Prioritize showing messaging inside the Dialog … rather than closing the Dialog" **[src]**.
  - Atlassian `AUTO_DISMISS_SECONDS = 8` (flags) **[src]**. Sonner `TOAST_LIFETIME = 4000`, `VISIBLE_TOASTS_AMOUNT = 3`, `TOAST_WIDTH = 356`, `GAP = 14` **[src]**. M3 snackbars: one at a time, at most one action **[kn]**.
- **Evidence:** `Toast.tsx` `DURATION_MS = { success: 3500, error: 7000 }`, so errors auto-dismiss. 31 files use `useToast`; audit which of them report errors.
- **Apply:** approval failure moves inline onto the row. OCR failure becomes an inline "unavailable" row state plus a retry. "Claim sent" becomes a toast. "Invoice approved" needs no toast because the row moves.
- **Check:** `Toast.tsx` has no `error` auto-dismiss path. A lint rule flags `toast.error(` and suggests inline or banner.

### G. Motion

#### P24. Four durations, two easings, exits faster than entrances, and quiet for frequent actions
- **Rule:**

  | Token | Value | Use | Comparable tokens |
  |---|---|---|---|
  | `--dur-micro` | 100ms | Hover, press, toggle, checkbox | Carbon `fast-02` 110, Atlassian `xshort` 100, M3 `short2` 100 |
  | `--dur-short` | 150ms | Fade, tooltip, small expand | Carbon `moderate-01` 150, Atlassian `short` 150, M3 `short3` 150 |
  | `--dur-medium` | 240ms | Toast in, popover, accordion, mobile drawer | Carbon `moderate-02` 240 ("toast"), M3 `medium1` 250 |
  | `--dur-long` | 400ms | Large expansion, sheet, hero value change | Carbon `slow-01` 400, Atlassian `xlong` 400, M3 `medium4` 400 |

  - **Exits** run at 0.5–0.7× the entrance duration.
  - **Easing:** standard `cubic-bezier(0.2, 0, 0.38, 0.9)`, entrance `cubic-bezier(0, 0, 0.38, 0.9)`, exit `cubic-bezier(0.2, 0, 1, 0.9)` (Carbon productive).
  - Never `transition-all`: list the properties (`opacity`, `transform`, `background-color`, `border-color`, `box-shadow`).
  - **No motion** on frequent interactions (row approve, quantity stepper) beyond the 100ms state change. Never make the user wait for an animation.
  - Under `prefers-reduced-motion: reduce`, everything is 0 except opacity fades of 150ms or less.
  - The T1 hero may count up **once** on first load (400ms or less), never on every revalidation.
- **Sources:**
  - Carbon motion: durations 70/110/150/240/400/700; productive versus expressive curves; "Productive motion … rendering data tables"; "Do micro-interactions fall within … 90–120 ms?" **[src]**.
  - M3: short1–4 = 50/100/150/200, medium1–4 = 250/300/350/400, long1–4 = 450–600, extra-long 700–1000; standard `cubic-bezier(0.2,0,0,1)`, emphasized decelerate `(0.05,0.7,0.1,1)`, emphasized accelerate `(0.3,0,0.8,0.15)` **[src]**.
  - Atlassian: `--ds-duration-*` 50/100/150/200/250/400/600; `@atlaskit/motion` small 100, medium 350, large 700 with `EXITING_MOTION_MULTIPLIER = 0.5` **[src]**.
  - Polaris: `motion-duration-50`…`500`, `ease-out` `cubic-bezier(0.19,0.91,0.38,1)` **[src]**.
  - Primer: base durations 0–1000 in 100ms steps **[src]**.
  - HIG motion: "generally avoid adding motion to UI interactions that occur frequently"; "Let people cancel motion … don't make people wait" **[src]**.
- **Evidence:** 53 `transition-all`; durations used ad hoc (`duration-500`, `duration-300`, `duration-200`); no motion tokens. Marketing has 7s infinite morph loops (fine for marketing, banned inside `/dashboard`).
- **Apply:** `Button`, `Badge` transitions, nav drawer, toast, dialog, accordion rows in leaks breakdown, the receiver's stepper.
- **Check:** `grep -rn "transition-all" apps/web/app/dashboard apps/web/lib` returns 0. Every `duration-*` class maps to a token.

### H. Keyboard, command and focus management

#### P25. Keyboard-first: a command menu, triage keys, and focus that follows the work

- **Global command menu:** `⌘K` / `Ctrl+K` opens `search.tsx` from anywhere, and `/` focuses search when no input has focus. The menu lists routes, suppliers, invoices, and actions ("אשר את כל החשבוניות הנקיות"). Shortcuts are displayed **inside menus and tooltips** next to each action, so they teach themselves. `?` opens the shortcut sheet. **[kn: Linear's command menu, single-key actions shown in context menus, and `?` help; Geist `Kbd` component]**
- **Triage keys in the approvals queue:** `J`/`K` next/previous, `A` approve, `R` reject with a reason, `O` open invoice, `X` select. After an approve, **focus moves to the next row**, not to `<body>`. **[Primer focus management: "When removing content, focus should return to a logical spot … By default … it will return to the body element"; "When adding content … focus should move to the first item that is added" — src]**
- **Dialogs** trap focus and return it to the trigger on close **[Primer, src]**. **Filters** keep focus on the filter control after applying **[Primer, src]**.
- **Evidence:** `search.tsx` handles arrow keys, Enter and Escape but has no global open shortcut (no `metaKey`/`ctrlKey` handler). The approvals `list.tsx` has no keyboard actions.
- **Apply:** `app/dashboard/search.tsx` (global `⌘K` and `/`), `app/dashboard/approvals/list.tsx` (triage keys plus focus-to-next-row), `ConfirmDialog` (focus return).
- **Check:** Playwright: pressing `Control+K` on any dashboard route focuses the search combobox. In approvals, pressing `A` on a focused row approves it and `:focus` moves to the next row.

---

## 4. Iconography (folded into P11 and P23 in the summary; listed for completeness)

- **Sizes tied to text:** 16px icons with 14px text, 20px with 16px, 24px with 20px and up. Use 12px only for filled status glyphs inside 12px badges. **[Primer: "Icons sized at 12px utilize the filled variant, while 16px and 24px utilize the outline variant paired with 14px text or larger" — src]**
- **Icon-only buttons** need `aria-label` plus a tooltip, and a hit area of at least 24×24 (fine pointer) or 44×44 (coarse). **[WCAG 2.5.8; Primer minTarget — src]**
- **RTL mirroring:**
  - **Mirror:** back/forward arrows, breadcrumb chevrons, "next step" arrows, progress bars and steppers, text-alignment and list icons, the `FlowBar` direction.
  - **Never mirror:** the checkmark, clocks, the camera, the ₪ symbol, logos, charts' value axis, or the search magnifier. Flip the magnifier only if the brand chooses to; SF Symbols keeps it unflipped.
  - **[HIG RTL: "Flip controls that show progress … Flip an interface icon that shows forward or backward motion … Don't flip logos or universal signs and marks … like the checkmark … avoid flipping interface icons that depict real-world objects … clocks" — src]**
- **Banner icons:** use the default status icon per tone; don't invent new ones. **[Polaris Banner — src]**

---

## 5. Patterns (14): exemplar to RestoMatch screen

| # | Pattern | Exemplar (system, artifact) | RestoMatch use |
|---|---|---|---|
| 1 | **Metric tile with delta** | Atlassian `font.metric.*` tokens; Polaris numeric `Text`; Geist stat layouts | Dashboard KPI row: "נתפס לפני תשלום ₪X" (T3 gold), "ממתין לאישור ₪Y" (T2 warn-bold + "לתור"), "שיעור דליפה 2.1%" with a target line of 1.5%. `metric-lg`, delta as icon + sign + ₪, never color alone. |
| 2 | **Index table with bulk actions and condensed mobile** | Polaris `IndexTable` (`condensed` under 490px, shift-click ranges via `position`, verb+noun bulk actions, row `tone` critical/warning/success/subdued) | `approvals`, `invoices`, `inbox`: row tone = emphasis tier, bulk "אשר N לתשלום". On a phone, a card list. |
| 3 | **Data table with totals row and units in the header** | Polaris `DataTable` (column content types numeric/text, totals row, "Keep decimals consistent") | `suppliers/ledger` (כרטסת ספק), `reports/monthly`, `approvals/pay-run`: header "סכום (₪)", place-value aligned, totals in `metric-sm`. |
| 4 | **Expandable row for progressive disclosure** | Carbon data table *With expansion* (expanded area for "supplementary information or data that needs additional query time"; batch-expand off by default) | `leaks/breakdown` and three-way match: the row shows supplier · discrepancy type · ₪; expanding shows PO line ↔ GR line ↔ invoice line with the delta highlighted. Lazy-load on expand. |
| 5 | **Batch action bar** | Carbon batch actions (bar appears on selection, row actions disabled, cancel at the far end) | `approvals/pay-run`: "נבחרו 6 · ₪18,240 · [אשר לתשלום] [ביטול]". The ₪ sum updates live, and the confirm dialog repeats the sum. |
| 6 | **Interactive error summary** | Primer forms (banner that receives focus, with anchor links to each invalid field when there are 3+ errors) | `contracts/import`, `orders/new`, `onboarding`, `catalog/import`. |
| 7 | **Honest skeleton page** | Polaris `SkeletonPage` (real static titles, skeleton for dynamic values); Carbon progressive loading (structure first, then data) | Every `dashboard/**/loading.tsx`: the real page title, the T1 hero slot loaded first, table skeleton rows at the final row height and column widths. |
| 8 | **Typed blankslate** | Primer `Blankslate` + Carbon empty-state types | `EmptyState kind=first-use / no-results / error`: first-run dashboard, filtered invoices, disconnected integrations. |
| 9 | **Undo toast instead of confirm** | Polaris Toast with action (10 s); Carbon actionable toast persists | Reject approval, archive claim, dismiss a price alert: "הבקשה נדחתה · בטל". The server commit is deferred or reversible. |
| 10 | **Command menu with visible shortcuts** | Linear ⌘K plus shortcut hints in menus **[kn]**; Geist `Kbd` **[kn]** | Global `⌘K` on `search.tsx`; `J/K/A/R` in approvals; shortcut chips in the row overflow menu. |
| 11 | **Relative time with exact time on hover or focus** | Geist Relative Time Card **[kn]** | Inbox, invoices, activity feed: "לפני 3 שעות", with "25.10.2026, 06:42" in a tooltip and `<time datetime>`. |
| 12 | **Status indicator with icon, label and roll-up** | Carbon status-indicator pattern (icon + shape + color + label; worst child wins); Primer message states | Match status: תואם (check, primary), פער (alert, danger-bold), ממתין לריכוז (clock, neutral T4). A chain branch tile rolls up to its worst invoice. |
| 13 | **Inline button loading → success → rest** | Carbon inline loading; Primer loading lifecycle (initiated → in progress → success → failed with retry) | "שלח דרישה לספק", "אשר", "סנכרן": the button shows a spinner (no layout shift), then ✓ "נשלח" for 1.5 s, then rest. On failure, an inline error with "נסה שוב". |
| 14 | **Degraded "unavailable" row state** | Primer `unavailable` message state ("A row of a data table could not be loaded"); Carbon error-management empty state | An OCR-failed invoice row, a MarketMan/Zester sync gap, a supplier with no catalog: neutral row with an alert icon and "לא נטען · נסה שוב", never blank and never a fake ₪0. |

---

## 6. Token proposal (for `rtl-design-steward` → `packages/ui-tokens` + `globals.css`)

> **Ownership:** colors and typography tokens belong to `rtl-design-steward`. The `formatIls()` util and the agorot↔display boundary are **frozen** (AGENTS.md immutability list), so P4 and P5 are applied as **rendering wrappers and classNames**, not by changing the util. Any change to `formatIls` output is a human-authored PR.

```css
/* Proposed additions to :root in apps/web/app/globals.css (values are proposals). */

/* Type: 10 roles, rem-based, line-heights on the 4px grid.
   Each value is a size/line-height pair for the `font:` shorthand (weight and family are added per role). */
--text-caption: 0.75rem/1rem;      /* 12/16: floor */
--text-body-sm: 0.875rem/1.25rem;  /* 14/20: tables, dense UI */
--text-body:    1rem/1.5rem;       /* 16/24: reading */
--text-heading-sm: 1rem/1.5rem;    /* 16/24, 600 */
--text-heading-md: 1.25rem/1.75rem;/* 20/28, 700 */
--text-heading-lg: 1.5rem/2rem;    /* 24/32, 700 */
--text-metric-sm: 1rem/1.5rem;     /* 16/24, 600, tabular */
--text-metric-md: 1.5rem/2rem;     /* 24/32, 700, tabular */
--text-metric-lg: 2rem/2.5rem;     /* 32/40, 700, tabular, -0.02em */
--text-metric-hero: 3.5rem/3.75rem;/* 56/60 (mobile 2.5rem/2.75rem), 800, tabular, -0.02em */

/* Space: 4px grid */
--space-050: 2px; --space-100: 4px; --space-200: 8px; --space-300: 12px; --space-400: 16px;
--space-500: 20px; --space-600: 24px; --space-800: 32px; --space-1000: 40px; --space-1200: 48px; --space-1600: 64px;

/* Density */
--row-compact: 32px; --row-default: 48px; --row-touch: 56px;
--control-sm: 32px; --control-md: 40px; --control-lg: 48px; --target-coarse: 44px;

/* Shape and elevation */
--radius-control: 8px; --radius-card: 12px; --radius-dialog: 16px; --radius-pill: 9999px;
--shadow-e1: 0 1px 2px rgba(15,31,23,.06), 0 8px 24px -12px rgba(15,31,23,.12); /* = today's shadow-card */
--shadow-e2: 0 8px 16px -4px rgba(15,31,23,.16), 0 0 1px rgba(15,31,23,.24);
--shadow-e3: 0 20px 24px -8px rgba(15,31,23,.22), 0 0 1px rgba(15,31,23,.24);

/* Focus */
--c-focus: 26 91 199; /* #1A5BC7, 6.24:1 on white; 2px ring + 2px surface offset */

/* Motion */
--dur-micro: 100ms; --dur-short: 150ms; --dur-medium: 240ms; --dur-long: 400ms;
--ease-standard: cubic-bezier(0.2, 0, 0.38, 0.9);
--ease-enter: cubic-bezier(0, 0, 0.38, 0.9);
--ease-exit: cubic-bezier(0.2, 0, 1, 0.9);

/* Color roles (danger shown; repeat for warn, gold, primary, info, neutral).
   Bold = today's hex. Subtle values must be re-validated for AA with the real text token. */
--c-danger-text: 184 15 42;       /* #B80F2A, 6.69:1 on white */
--c-danger-icon: 184 15 42;
--c-danger-border: 184 15 42;
--c-danger-bg-subtle: 252 236 238;/* ≈ danger/8 on white, flattened */
--c-danger-bg-bold: 184 15 42;
--c-danger-bg-bold-hover: 150 10 34;
--c-on-danger-bold: 255 255 255;
```

---

## 7. Reviewer acceptance checklist (machine-checkable where possible)

| # | Check | Command or test |
|---|---|---|
| 1 | No sub-12px text | `grep -rnE "text-\[(9\|10\|11)px\]" apps/web/app apps/web/lib` → 0 |
| 2 | No arbitrary font sizes | `grep -rnE "text-\[[0-9.]+(px\|rem)\]" apps/web/app/dashboard` → 0 |
| 3 | Money not in mono | `grep -rn "font-mono" apps/web/app \| grep -E "formatIls\|₪"` → 0 |
| 4 | Sortable tables accessible | each sortable table has exactly one `th[aria-sort]` ≠ `none` on first render |
| 5 | Focus ring ≥3:1 | computed `:focus-visible` ring color vs parent bg ≥ 3.0 for every `Button` variant |
| 6 | No hex in TSX | `grep -rnE "#[0-9a-fA-F]{6}" apps/web/app apps/web/lib --include=*.tsx` → 0 (except `og/`) |
| 7 | No alpha-hacked semantics | `grep -rnE "(bg\|text\|ring)-(danger\|warn\|gold\|primary\|info)/[0-9]+"` → 0 after roles land |
| 8 | No `transition-all` in app | `grep -rn "transition-all" apps/web/app/dashboard apps/web/lib` → 0 |
| 9 | Errors persist | `Toast.tsx` has no auto-dismiss for `error`; lint flags `toast.error(` |
| 10 | Every dashboard route has a loading state | `for d in app/dashboard/*/; do test -f "$d/loading.tsx"; done` |
| 11 | No sideways scroll at 390px | Playwright: `scrollWidth <= 390` on all non-compact routes |
| 12 | Touch targets in receiving | Playwright (hasTouch, 390px): all interactive boxes ≥44×44 in `receiving/*` |
| 13 | Place-value alignment | Visual snapshot of a money column: decimal points share one x |
| 14 | Bidi | `formatIls(-120)` inside a Hebrew sentence keeps the sign attached (snapshot) |
| 15 | Empty states typed | every `EmptyState` passes `kind`; `first-use` has 1 primary action |
| 16 | Radius set | `grep -rhoE "rounded-(sm\|md\|3xl\|\[)" apps/web/app/dashboard` → 0 |

---

## 8. Sources

**Canonical pages** (the human-readable versions). The source files listed in section 0 were read directly.

- IBM Carbon:
  - Data table: [usage](https://carbondesignsystem.com/components/data-table/usage/), [style](https://carbondesignsystem.com/components/data-table/style/), [accessibility](https://carbondesignsystem.com/components/data-table/accessibility/)
  - [Motion](https://carbondesignsystem.com/elements/motion/overview/) · [Spacing](https://carbondesignsystem.com/elements/spacing/overview/)
  - [Notification (component)](https://carbondesignsystem.com/components/notification/usage/) · [Notification pattern](https://carbondesignsystem.com/patterns/notification-pattern/)
  - [Loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/) · [Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/) · [Forms](https://carbondesignsystem.com/patterns/forms-pattern/) · [Status indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
  - Source repo: `github.com/carbon-design-system/carbon-website` (`src/pages/**`)
- Shopify Polaris:
  - Components: [Text](https://polaris.shopify.com/components/typography/text) · [Index table](https://polaris.shopify.com/components/tables/index-table) · [Data table](https://polaris.shopify.com/components/tables/data-table) · [Banner](https://polaris.shopify.com/components/feedback-indicators/banner) · [Empty state](https://polaris.shopify.com/components/layout-and-structure/empty-state) · [Skeleton page](https://polaris.shopify.com/components/feedback-indicators/skeleton-page) · [Toast](https://polaris.shopify.com/components/feedback-indicators/toast)
  - Tokens: [motion](https://polaris.shopify.com/tokens/motion) · [space](https://polaris.shopify.com/tokens/space) · [font](https://polaris.shopify.com/tokens/font) · [shadow](https://polaris.shopify.com/tokens/shadow)
  - Source repo: `github.com/Shopify/polaris`
- Material 3:
  - [Easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) · [Type scale tokens](https://m3.material.io/styles/typography/type-scale-tokens) · [Elevation](https://m3.material.io/styles/elevation/tokens) · [State layers](https://m3.material.io/foundations/interaction/states/state-layers) · [Snackbar](https://m3.material.io/components/snackbar/guidelines)
  - Source repo: `github.com/material-components/material-web` (`tokens/versions/v0_192`)
- GitHub Primer:
  - [Loading](https://primer.style/ui-patterns/loading) · [Saving](https://primer.style/ui-patterns/saving) · [Forms](https://primer.style/ui-patterns/forms/overview) · [Notification messaging](https://primer.style/ui-patterns/notification-messaging) · [Empty states](https://primer.style/ui-patterns/empty-states) · [Data table](https://primer.style/components/data-table) · [Focus management](https://primer.style/guides/accessibility/focus-management)
  - Source repos: `github.com/primer/design`, `github.com/primer/primitives`
- Atlassian:
  - [Auto-dismiss flag](https://atlassian.design/components/flag/auto-dismiss-flag) · [Design tokens](https://atlassian.design/components/tokens/all-tokens) · [Spacing](https://atlassian.design/foundations/spacing) · [Typography](https://atlassian.design/foundations/typography)
  - npm packages: `@atlaskit/tokens`, `@atlaskit/motion`, `@atlaskit/flag`
- Apple HIG: [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) · [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left) · [Loading](https://developer.apple.com/design/human-interface-guidelines/loading) · [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
- Linear **[kn]**: [How we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui) · [Changelog 2024-03-20 New Linear UI](https://linear.app/changelog/2024-03-20-new-linear-ui)
- Vercel Geist **[kn]**: [Colors](https://vercel.com/geist/colors) · [Typography](https://vercel.com/geist/typography) · [design.md](https://vercel.com/design.md) · toast defaults from the npm package `sonner` (`dist/index.js`)
- WCAG 2.2: [W3C Recommendation](https://www.w3.org/TR/WCAG22/) (1.4.11, 2.4.11, 2.4.13, 2.5.8) · [What's new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
