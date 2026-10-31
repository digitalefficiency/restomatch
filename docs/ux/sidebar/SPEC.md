# Desktop side menu — implementation spec (owner-approved 31.10.2026)

> **Status:** the owner approved this design on 31.10.2026 for implementation in wave 2 (owner: W1-03, on top of the wave-1 nav registry). The owner also wants a **more advanced design pass in UI wave 2**; build this version first and keep the tokens and structure open to that pass.
>
> **Corrections that override the prototype where they differ (decisions as of 31.10):**
> - `/dashboard/leaks` is the monthly **"דליפה"** hub (W1-08 + W1-03 follow-up 7118ea3). Price creep is the `#prices` section inside it and keeps the words "מחירים שעלו" there. Do not show a separate "מחירים שעלו" nav item.
> - **Bulk approve (≤ ₪200 per invoice, never blocking rows)** and **one-tap WhatsApp approve (≤ ₪500)** stay OFF in the UI until the server enforces both caps (W2-04 `approvals.decideMany` + one server-side cap constant). Show the disabled state with its reason, as the W1-02 BatchBar does.
> - **Alerts:** the bell is in-app only until a WhatsApp/push provider exists. Quiet hours (23:00–06:00), Shabbat and 6/day are enforced by the dispatcher (PR #173); the bell copy must not promise channels that do not exist yet.
> - **Chef ordering (owner, 31.10 later — supersedes the earlier "hide it" line):** the chef sees, creates, edits, sends and cancels orders of their own restaurant **with no manager approval**, and **sees prices and order totals on the orders screens only** (everywhere else the chef still sees no ₪). The base lands before the pilot in train A (W1-11: route, nav entry, server tier `chefProcedure` on order writes; order-document settings stay manager/owner). Show the chef's הזמנות item as in the role table below.
> - **No ₪ for chef/receiver** (except the chef's orders screens, above, and the chef's recipes — plate cost, menu price, margin — owner 31.10) includes search, palette records, bell and badges (W1-03 follow-up made search screens-only for them).
> - Demo numbers in the prototype (₪760, ₪296, ₪451, branches) are demo data; real badges read the same server sources as the screens (approvals.queueSummary for the approvals badge — one data source for badge, queue and bell).

# W1-03 desktop side menu: implementation spec (final)

**For:** the W1-03 engineer (`web-feature-engineer`), plus `rtl-design-steward` (tokens), `tenant-security-warden` (role and data deltas) and `test-sentinel` (e2e).
**Date:** 2026-10-31. Owner corrections of 31.10 are applied throughout.
**Reference build:** `sidebar/FINAL.html` (the artifact) and `sidebar/FINAL-preview.html` (the same page as a full document). Source: `sidebar/final/final.src.html`; icons are inlined by `sidebar/final/build.mjs`.
**Evidence:** `sidebar/shots/final-*.png` (33 shots). The harness `sidebar/final/shoot.mjs` writes `sidebar/final/report.json`. An independent adversarial pass (`sidebar/verify/verify.mjs` → `sidebar/verify/report.json`, summarised in `sidebar/VERIFY.md`) re-checks the artifact contract, 360/390 widths, axe, the keyboard, the role rules and every number below.
**Repo:** untouched.

---

## 0. The decision

**Base: prototype 1 ("Precision rail").** It won all three judges: craft 8.0, desk 7.5, a11y and build 7.5, a total of 23. It keeps its literal three-axis grid, its colour restraint and its keyboard layer. It also maps almost 1:1 onto PR #152 (`ShellFrame`, 248/64, `rm_nav_rail`, `GROUP_ORDER`).

**Grafted:**

| From | What |
|---|---|
| #3 | All 31.10 content: the ניתוח group, "מחירים שעלו", bulk approval ≤ ‏200 ₪ (blocking rows locked) with the ‏500 ₪ WhatsApp note, a real-alerts bell, and bookkeeper read-all with a view-only eye |
| #3 | Dark ink tooltips (14/600 title, 12/16 meaning line, LTR kbd chip) and the flyout title as an anchor (16/700 ink) with a pin action |
| #3 | A flat, labelled rail for chef and receiver (no 248 panel). Their settings fold into the account menu |
| #3 | The item-level, ₪-ranked לטיפולי page, `aria-current` + ", המסך הנוכחי כאן" on the group holding the page, a polite route announcement, and `<bdi>` badges |
| #2/#3 | 12/16 labels under every rail icon, on a **64 px** rail (not 72, so the W1-03 acceptance stays 248/64). The icon axis stays at 32 in both states |
| #2 | Optical icon sizes (`banknote` ×1.10, `plug` ×1.08, `droplet` ×1.06, `tags` ×1.04, with the stroke divided by the same factor), compact rows below 800 px tall, the `mask-image` overflow fade, the icon help row, `<aside aria-label="תפריט צד">` landmarks, the popover Tab contract, forced-colours outlines, and the switcher copy "נשארים באותו מסך" plus the "10 חוסמים" dot |

**Rejected, with reasons:**

| Rejected | Reason |
|---|---|
| T1 in the chrome (#2's leak card and rail tile, and the desk judge's "דליפה החודש ‏760 ₪" line in the switcher) | T1 is the hero on the page and never a nav element (AGENTS T1, IA §6). The desk need (1 click to דליפה) is met another way: ניתוח is open by default for owner and bookkeeper, plus `G L` and the hero link |
| #3's two-level rail + panel (312 px), mint active fill, solid-ink count disc and seeded tray | They cost content width, put green behind red, and add noise |
| A sidebar recents tray | It pushes money down (craft judge). Recents live in ⌘K ("אחרונים"). **Favourites** (≤ 5) appear as a "מועדפים" group only after the user stars a page; a new account has none |
| Flush flyout attached to the rail tab | It could not be made pixel-exact in all modes. Kept #1's detached flyout, 8 px off the rail |

---

## 1. Anatomy (desktop ≥ 1024, RTL: the sidebar is on the right, inline-start)

All values are measured in Chromium from the reference build (`report.json → checks.expanded`). x is measured from the sidebar's inline-start edge.

### 1.1 Expanded panel: 248 px

| Region | Spec |
|---|---|
| Container | `position: fixed; inset-block: 0; inset-inline-start: 0`, width `--rm-sidebar-w` = **248**. Background `bg` (#F6F8F7, the same as the page canvas), `border-inline-end: 1px line`. No shadow. z 30 |
| **Grid (the invariant)** | Gutter 12 · row padding-inline 8 · icon box 24 (glyph 20) · gap 8. **Icon centre x = 32**, **label start x = 52**, **badge end x = 227** (= 248 − 1 border − 12 − 8). Every icon centre falls on a whole pixel |
| Head | 56 tall, `border-bottom: 1px line`, continuing the top bar's hairline. Switcher button 40 tall, `margin-inline: 12`, `padding-inline: 8 10`, radius 8. Monogram 24×24, radius 6, `primary` / `on-primary` 12/700. Name 14/18 600 ink. Sub-line 12/16 `muted` ("בעלים · 3 סניפים"). **`ChevronsUpDown` 16 sits right after the text, inside the hover pill.** With 1 membership the head is static, with no chevron |
| ⌘K field | Wrapper padding 8 12. Button 32 tall (row height), radius 8, `surface` with inset 1 px `line` + `e1`. `Search` 16 on the icon axis, label 14 `muted` on the label axis, kbd chip "Ctrl K" / "⌘K" (`dir="ltr"`, 20 tall, 12/16 500, `surface-2`) ending on the badge axis |
| Scroll region | `flex: 1; overflow-y: auto`, padding-block 4 6, thin scrollbar in `line`. When it overflows: a 28 px `mask-image` fade at the clipped edge(s) |
| Top items | בית, לטיפולי (O/M/B). Then an 8 px separator |
| Row | **32** tall (**28** when the viewport is < 800 px tall), radius 6. Label 14/20 500 `muted`; active 600 `ink` |
| Group header | A 32 px row on the same grid: **group glyph 16** in the 24 box on the icon axis (stroke 2), label **12/16 600 `muted`** on the label axis, `ChevronDown` 12 after the label (rotated 90° toward inline-end when closed), and the T2 dot (6 px) ending on the badge axis when closed |
| Group spacing | An open group gets 8 px above it and 8 px before the next group. Closed groups stack at a 32 px pitch |
| Footer (pinned) | `border-top: 1px line`, padding-block 8 4. (1) ניהול group (closed by default). (2) Help row, 32 tall: עזרה · נגישות · צור קשר, each a 28 px link with a 16 px icon + 12/16 label |
| User row | `border-top: 1px line`, padding 8 12. Account button 40 tall: avatar 24 (`surface-2`, inset 1 px `line`, initial 12/600) on the icon axis, name 14/18 600, role 12/16 `muted`. **The collapse toggle (32×32) shares the row** at inline-end |
| Edge handle | 6 px hit strip on the inline-end edge. On hover it shows a 2 px `line-strong` line (3.37:1). Click toggles |

### 1.2 Rail: 64 px (Ctrl/⌘+B)

| Part | Spec |
|---|---|
| Tiles | 56 wide, 48 tall (**44** when < 800 px tall), `margin-inline: 4`, radius 10, gap 4 (2 compact). Icon 20 at the top (padding-top 5), **12/16 500 label under it**, max 54 px, centred. Icon centre x = **32**, the same as expanded |
| Contents | ⌘K tile "חיפוש" · בית · לטיפולי · a 9 px separator with a 24 px `line` rule · one tile per group (כסף · ניתוח · רכש · מטבח · רשת) · footer: ניהול, עזרה · avatar · toggle |
| Short labels | קבלה · חוזים · מנות · ספירה (the same words as the phone bar) |
| Dots | 8 px, **2 px cut-out ring in the surface behind it** (`box-shadow: 0 0 0 2px var(--ring)`), at `top: -3px; inset-inline-end: -3px` of the 24 icon box, so the dot sits outside the glyph's stroke. The same rule applies to the bell and the phone bar |
| Here vs open | **Here** = white raised tile, 2×20 primary notch at inline-start, primary icon at stroke 2, label 600, `aria-current="true"`. **Open** (its flyout is showing) = `surface-2` fill |

### 1.3 Flyout (rail only)

240 wide, `surface`, radius 12, `e2` shadow, padding 4 0 6. **8 px off the rail**, top = trigger top − 4, clamped to 8 px from the viewport edges. Title row 44 tall: **16/24 700 ink** group name + a 32×32 pin button ("הצמדת התפריט הפתוח עם כסף"). Rows are identical to panel rows (same badges and active state); the active row uses a `bg` fill + 1 px `line` because the flyout is white. **No rail dots or short labels inside the flyout.**

### 1.4 Chef and receiver (≤ 5 destinations)

**A flat, labelled rail only.** No 248 panel, no collapse toggle, no ⌘K field (only the "חיפוש" tile). Chef: בית · הזמנות · מנות · ספירה. Receiver: בית · קבלה. Footer: עזרה · avatar. הגדרות sits in the account menu.

### 1.5 Top bar (desktop)

56 tall, `bg`, `border-bottom: 1px line`, sticky, padding-inline 32 20. Crumbs 14/20 500 `muted`, the current page 600 ink, separator a 12 px `ChevronLeft` (en: `ChevronRight`) in `line-strong`, `aria-hidden`, pointing toward the current page. Never a text `›`: alone in its flex box, Chromium does not mirror it, so it pointed back at the parent. At inline-end: freshness 12/16 `muted`, the period chip (32 tall, inset 1 px `line-strong`), a 1×20 divider, and **the bell (32×32 icon button)**. The branch switcher, search and avatar live in the sidebar.

### 1.6 Popovers, tooltip, palette

| Element | Spec |
|---|---|
| Branch switcher | `role="menu"`, 320 wide, below the head (beside the rail in rail mode). Header 12/16 600 `subtle`: "סניפים · נשארים באותו מסך" with "דליפה החודש" at the end. A 52 px row per membership: `Store` 16 · name 14/20 500 · "role · רכש ‏42,263 ₪" 12/16 · leak ₪ 14/600 + % 12 on the end axis, tabular · ✓ when current. The ירושלים row adds a 6 px `danger` dot + "10 חוסמים". Owner footer: סקירת רשת · פתיחת סניף. ₪ and % only when the role in that branch is O/M/B |
| Account menu | `role="menu"`, the user row's inner width (223 = 248 − 1 border − 2 × 12 padding, so it lines up with the account button and the toggle), opening upward. Name · role · e-mail (in a `bdi`, never mono) → הגדרות אישיות · קיצורי מקלדת `?` · **קיצורים בתו אחד** (a switch) → שפה (receiver: first) → התנתקות (`LogOut`, mirrored) |
| Bell | `role="dialog"`, 384 wide, below-end of the bell, mounted right after the trigger. Header: "התראות" 16/700 · "3 חדשות · 4 מתוך 6 היום" · "סימון הכול כנקרא". Rows: icon 20 (danger / gold / muted by tier), title 14/20 (600 when new), meta 12/16 ("‏104.80 ₪ · מאשרים רק כאן · 09:12" or "אפשר לאשר מוואטסאפ"), a "וואטסאפ" channel chip, and an unread dot. Quiet line: `Moon` 16 + "לא שולחים בין 23:00 ל־06:00 ובשבת · עד 6 התראות ביום". Footer: "כל מה שמחכה לי: לטיפולי (10)" · "הגדרות התראות · אפליקציה · וואטסאפ". The bell shows a **dot, never a count**; לטיפולי owns the number |
| Tooltip | `ink` background, radius 8, padding 8 10, max 280. Title 14/20 600 `surface` + a kbd chip (`dir="ltr"`, background = surface 16 % over ink). Meaning line 12/16 in `line`. **8 px beside the rail** at inline-end. Shows after 450 ms on hover, 0 ms while moving between items (300 ms skip window), **immediately on keyboard focus**. Hoverable; Esc closes it. **Never overlaps its trigger:** measure at `left: 0` first, then place, and flip if a clamp would cover the trigger. In the expanded panel, tooltips appear only on icon-only controls (toggle, bell, pin, star) |
| Palette | Native `<dialog>` with `showModal()`, `min(640px, 100vw − 32)`, 14vh from the top, radius 12, `e3`. Input row **52 tall, `flex: none`** (it never collapses when empty), 16/24. Sections: מחכה לך → אחרונים → מעבר אל (with G-chords) → רשומות (when typing) → פעולות. Zero-result copy: "אין תוצאות ל„…". נסו שם ספק, מספר חשבונית או מסך." Footer hints, plus "פעולת כסף נפתחת במסך שלה · לא מאשרים מכאן". The selected option gets `surface-2` and the same 2×16 `primary` notch as the nav's active row (not a full-height inset edge) |

---

## 2. Tokens

### 2.1 Existing tokens (use them; never hard-code hex in components)

| Role in the menu | `globals.css` | Tailwind | Value |
|---|---|---|---|
| Sidebar, top bar and page background | `--c-bg` | `bg` | #F6F8F7 |
| Active pill, popovers, flyouts, ⌘K field | `--c-surface` | `surface` | #FFFFFF |
| Hover fill, count pill, kbd chip | `--c-surface-2` | `surface-2` | #EEF3F0 |
| Hairlines, pill rings | `--c-line` | `line` | #D3DDD7 |
| Edge handle line, period chip border | `--c-line-strong` | `line-strong` | #7A8B82 |
| Active label, names | `--c-ink` | `ink` | #0F1F17 |
| Idle label, icons, group headers, meta | `--c-muted` | `muted` | #4A5D53 |
| Popover section headers | `--c-subtle` | `subtle` | #5A6A62 |
| Active icon + notch, monogram, primary CTA | `--c-primary` | `primary` | #066B4A |
| Text on solid fills | `--c-on-primary` | `on-primary` | #FFFFFF |
| T3 good news (bell, page tiles only) | `--c-gold` | `gold` | #755C00 |
| Solid ₪ badge (block), danger dots | `--c-danger` | `danger` | #B80F2A |
| Subtle ₪ badge text, warn dot | `--c-warn` | `warn` | #A63D00 |
| Focus ring | `--c-info` | `info` | #1A5BC7 |

### 2.2 Minimal new tokens (W1-01, owner `rtl-design-steward`)

| Token | Value | Why |
|---|---|---|
| `--c-focus` + `.focus-ring` | = `info` #1A5BC7, 2 px, offset −2 on rows | Today's `ring-primary/60` is 2.81:1 and fails |
| `--c-primary-subtle` | #E7F3ED | Phone-bar active pill (primary on it: 5.75:1) |
| `--c-warn-subtle` | #FDF0E7 | Subtle ₪ badge (warn on it: 5.71:1) |
| `--c-danger-subtle`, `--c-gold-subtle` | #FCECEF, #F8F2DD | Page chips and the recovery meter (not in the menu) |
| `--rm-sidebar-w` / `--rm-rail-w` | 248 / 64 | PR #152 already sets the first inline; lift both into tokens |
| `--rm-nav-row` | 32, and 28 under `(max-height: 799.98px)` | Row and tile density |
| `--rm-bottomnav-h` | 64 + `env(safe-area-inset-bottom)` | Phone bar and `scroll-padding-bottom` |

Everything else is an alpha or a mix **of these tokens**; no new hue:

| Derived value | Formula |
|---|---|
| Pressed | `ink` 7 % |
| Subtle ₪ badge ring | `warn` 28 % over `surface` |
| Neutral dot | `ink` 72 % over `bg` |
| Shadows | `ink` at 6 / 20 / 28 % + an 8 % ring |
| Tooltip | `ink` background; kbd = `surface` 16 % over `ink` |
| Scrim | `ink` 40 % (dialogs), 12 % (overlay) |

### 2.3 Contrast (computed, WCAG 2.x)

| Pair | Ratio |
|---|---|
| Idle label `muted` / `bg` | 6.60 |
| Group header `muted` / `bg` | 6.60 |
| Rail label `muted` / `bg` | 6.60 |
| Hover `ink` / `surface-2` | 15.23 |
| Pressed `ink` / press | 13.98 |
| Active `ink` / `surface` | 17.09 |
| Count `muted` / `surface-2` | 6.28 |
| Solid ₪: white / `danger` | 6.69 |
| Subtle ₪: `warn` / `warn-subtle` | 5.71 |
| Popover header `subtle` / `surface` | 5.72 |
| Tooltip title white / `ink` | 17.09 |
| Tooltip meaning `line` / `ink` | 12.28 |
| Phone active `primary` / `primary-subtle` | 5.75 |
| Gold / `surface` | 6.39 |
| Non-text: primary icon and notch / `surface` | 6.54 |
| Non-text: dots on `bg` (danger / warn / neutral) | 6.27 / 5.99 / 6.55 |
| Focus ring on `bg` / `surface` / `surface-2` / pressed | 5.85 / 6.24 / 5.56 / 5.10 |
| Edge line `line-strong` / `bg` | 3.37 |

---

## 3. Type and icons

**Type:** Heebo only, through the existing `--font-heebo` stack. The menu never hard-codes `font-family`, so the receiver-locale Noto rules keep working. Nothing below 12 px, no letter-spacing or uppercase on Hebrew. `tabular-nums lining-nums` sits **on the badge element itself**, declared after any `font` shorthand.

| Text | Size / weight |
|---|---|
| Nav label | 14/20, 500 (active 600) |
| Group header | 12/16, 600 |
| Badge | 12/16, 600 |
| kbd | 12/16, 500 |
| Rail label | 12/16, 500 (here: 600) |
| Flyout title | 16/24, 700 |
| Page `h1` | 24/32, 700 |

**Icons:** lucide-react 0.469, canonical names only. In the app:

```tsx
<Icon size={20} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />
```

- **Sizes and stroke:** utilities and group glyphs are 16 at stroke 2. Active icons use stroke 2.0, matching the 600 label.
- **Optical sizes:** a small `<NavIcon>` wrapper scales the `viewBox` by k and divides the stroke by k (`banknote` 1.10, `plug` 1.08, `droplet` 1.06, `tags` 1.04).
- **Mirroring:** only `log-out`, `clipboard-list` and `list-checks` (lists and exits read right to left) are mirrored.
- **Utility glyphs the build also uses** (all canonical in 0.469): `Pin`, `Star`, `Bell`, `X`, `Ellipsis`, `Check`, `ChevronLeft` ("לכל התור ‹" points to inline-end), `Clock`, `History`, `Keyboard`, `Languages`, `ListChecks`, `OctagonAlert`, `CircleCheck`, `Sun`, `UserRoundCog`, `Plus`, `Camera`, `ClipboardCheck`.
- **Collapse toggle:** pick the glyph by `dir`, never with `scale-x`. In he: `PanelRightClose` / `PanelRightOpen`. In en: `PanelLeftClose` / `PanelLeftOpen`.
- **Chevrons:** a closed group's chevron points toward inline-end.

---

## 4. Items per role

Labels, routes and icons follow `current-and-ia.md` §4. The only changes are the 31.10 corrections and the rail group glyphs.

### 4.1 Master table

| Group (key) | Hebrew label · rail short form | Route | lucide-react | Badge (kind · source) | O | M | B | C | R |
|---|---|---|---|---|---|---|---|---|---|
| top | בית | `/dashboard` | `House` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| top | לטיפולי | P1 `/dashboard#needs-you-title` → P2 `/dashboard/queue` | `Inbox` | count + danger dot · `nav.badges.queue` | ✓ | ✓ | ✓ | — | — |
| כסף (`money`, rail glyph `Wallet`) | אישורים | `/dashboard/approvals` | `BadgeCheck` | ₪ T2 · `approvals.myQueue` Σ\|Δ\| excl. `PRICE_LOWER`; solid when any `severity='block'` | ✓ | ✓ | ✓ | — | — |
| | חשבוניות נכנסות | `/dashboard/inbox` | `ReceiptText` | count · `ingest.overview().needsReview` (hidden at 0; a pending חשבונית מרכזת is never counted) | ✓ | ✓ | ✓ | — | — |
| | ריצת תשלומים | `/dashboard/approvals/pay-run` | `Banknote` (×1.10) | status (after W2-03) | ✓ | — (`navHiddenFor`) | ✓ | — | — |
| | דרישות זיכוי | `/dashboard/leaks/claims` (tabs לשליחה · מעקב זיכויים) | `HandCoins` | ₪ T2 warn · `nav.badges.claims` | ✓ | ✓ | ✓ | — | — |
| | כרטסת ספקים | `/dashboard/suppliers/ledger` | `BookOpenText` | — (B: edits with an audit log) | ✓ | ✓ | ✓ | — | **✕** |
| | סגירת חודש וייצוא | `/dashboard/exports` | `CalendarCheck` | status "4/6" (W3-05) | ✓ | — | ✓ | — | — |
| ניתוח (`analysis`, was `leaks`; rail glyph `ChartSpline`) | דליפה | `/dashboard/leaks` (tabs סקירה · פירוק · הוכחה · מגמה) | `Droplet` (×1.06) | — (T1 lives on the page) | ✓ | ✓ | ✓ | — | — |
| | דוחות | `/dashboard/reports/monthly` | `FileChartColumn` | — | ✓ | ✓ | ✓ | — | — |
| | שאלו את RestoMatch | `/dashboard/ask` | `Sparkles` | — | ✓ | ✓ | — | — | — |
| רכש (`procure`, rail glyph `ShoppingBasket`) | הזמנות | `/dashboard/orders` | `ShoppingCart` | count (W2-06); chef: count only | ✓ | ✓ | ✓ 👁 | **✓** (orders directly, no approval) | — |
| | קבלת סחורה · קבלה | `/dashboard/receiving` | `PackageCheck` | count · `receiving.todayExpectations` (warn when late) | ✓ | ✓ | ✓ 👁 | — | ✓ |
| | ספקים | `/dashboard/suppliers` | `Truck` | — | ✓ | ✓ | ✓ 👁 | — | — |
| | קטלוג | `/dashboard/catalog` | `Tags` (×1.04) | — | ✓ | ✓ | ✓ 👁 | — | — |
| | חוזים ומחירים · חוזים | `/dashboard/contracts` | `Handshake` | count, neutral · `priceAlerts.openCount` ("מחיר אחד שעלה מעל החוזה"); none for B (view-only rows carry no badge) | ✓ | ✓ | ✓ 👁 | — | — |
| מטבח (`kitchen`, rail glyph `Utensils`) | עלות מנה · מנות | `/dashboard/recipes` | `ChefHat` | count only (P2) | ✓ | ✓ | ✓ 👁 | ✓ | — |
| | ספירת מלאי · ספירה | `/dashboard/inventory` | `ClipboardList` (mirrored) | status · `inventory.current` | ✓ | ✓ | ✓ 👁 | ✓ | — |
| רשת (`chain`, rail glyph `Building2`) | סקירת רשת | `/dashboard/chain` | `Network` | — | ✓ (chain) | — | — | — | — |
| | סניפים | `/dashboard/branches` | `Store` | — | ✓ | — | — | — | — |
| ניהול (`admin`, footer; rail glyph `SlidersHorizontal`) | צוות | `/dashboard/team` | `Users` | — | ✓ | ✓ | ✓ 👁 | — | — |
| | חיבורים | `/dashboard/integrations` | `Plug` (×1.08) | — | ✓ | ✓ | ✓ | — | — |
| | הגדרות | `/dashboard/settings` | `Settings` | — | ✓ | ✓ | ✓ | menu | menu |
| footer | עזרה · נגישות (aria-label "הצהרת נגישות") · צור קשר | `/accessibility#help` · `/accessibility` · `/accessibility#contact` | `CircleHelp` · `Accessibility` · `MessageCircle` | — | all | all | all | all | all |

**Notes:**
- 👁 = bookkeeper read-only (owner 31.10: the bookkeeper reads everything and edits the supplier account cards). The row gets a 16 px `Eye` on the badge axis and the SR text ", צפייה בלבד"; the page note says "צפייה בלבד במסך הזה. עריכה פתוחה לך בכרטסת הספקים, וכל שינוי שם נרשם ביומן." On כרטסת ספקים the bookkeeper edits, and every change is logged ("כל שינוי נרשם ביומן השינויים"). Her own finance work (אישורים routed to her, ריצת תשלומים, דרישות זיכוי, סגירת חודש) stays actionable. דוחות carries no eye: it is read-only for everyone.
- **Entry counts:** owner 23 · manager 19 · bookkeeper 20 · chef 5 · receiver 3.
- **Top-level groups:** 7 (top, כסף, ניתוח, רכש, מטבח, רשת, ניהול), plus "מועדפים" only after the user stars a page.

### 4.2 Default-open groups and the fit rule

| Role | Open by default | Why |
|---|---|---|
| owner | כסף + ניתוח | דליפה is a top-3 owner job; סקירת רשת is also in the switcher |
| manager | כסף + רכש | ‏153 ₪ and הזמנות / קבלה are 1 click away |
| bookkeeper | כסף + ניתוח | — |
| chef, receiver | — | flat rail |

- **The active route's group always opens.**
- **User toggles persist** (`rm:nav:groups:<role>`).
- **Fit rule** (runs after every open, route change and resize): while the list overflows, fold the **least-recently-opened** group that is not the one just opened, not the active route's group, and **does not hold a T2 ₪ badge**. כסף never folds while it carries ₪. A fold is announced politely ("קיפלנו את ניתוח כדי שהתפריט ייכנס במסך").
- **Measured:** owner, manager and bookkeeper keep both defaults with 0 px overflow at 1440×900, 1536×864, 1366×768 and 1280×800. The full fit matrix (5 roles × 5 viewports × 2 modes, plus "open every group") shows 0 overflow and 0 overlap.

---

## 5. Badges

### 5.1 Grammar

| Kind | Look | Demo |
|---|---|---|
| ₪ T2, blocking | **solid `danger`**, white 12/600, 20 tall, radius 10 | אישורים ‏296 ₪ (4 פערים, 2 blocking) |
| ₪ T2, not blocking | `warn-subtle` + `warn` text + 1 px ring (`warn` 28 %) | דרישות זיכוי ‏451 ₪; manager אישורים ‏153 ₪ |
| Count | `surface-2` + `muted` + 1 px `line` ring; turns `surface` on a hovered row. Capped at `99+` (`<bdi dir="ltr">`, SR "יותר מ־99") | לטיפולי 10, קבלת סחורה 3, חוזים ומחירים 1 |
| Count with a block inside | the same pill plus a 6 px `danger` dot | לטיפולי ● 10 |
| View-only | `Eye` 16 in `subtle` | bookkeeper rows |
| T1 / T3 / T4 | **never in the menu** | ‏760 ₪ hero · ‏1,914 ₪ gold tile · חשבוניות מרכזות pending |

**Rules:**
- There is at most one solid pill, and only when payment is blocked.
- In the rail, each item becomes an 8 px dot (danger / warn / neutral).
- Collapsed groups and rail group tiles get a dot **only for T2 ₪**; counts never bubble up. A manager's non-blocking ₪153 still shows a **warn** dot on כסף.
- **₪ text is `formatIls(v, { maximumFractionDigits: 0, locale })` output, inside `<bdi>` with no `dir`** — in the menu and everywhere else an amount sits inside a Hebrew sentence (bell lines, palette rows, notes, tile captions). Plain-text surfaces (toasts) wrap it in FSI…PDI (U+2068/U+2069) instead. The visible pill is `aria-hidden`; the link carries the meaning, e.g. "אישורים, 4 פערים, ‏296 ₪ בסיכון, 2 חוסמים תשלום".
- **Rounding:** summaries and badges at 0 dp (‏153 ₪), line items at 2 dp (‏152.50 ₪, ‏100.00 ₪), including bell lines.

### 5.2 Typed shape (replaces PR #152's `Record<string, number>`)

```ts
type NavBadge =
  | { kind: 'count'; n: number; tone?: 'neutral' | 'warn'; dot?: 'danger' }
  | { kind: 'ils'; agorot: number; n: number; block: number } // never emitted for chef/receiver
  | { kind: 'status'; text: string; tone: 'neutral' | 'warn' };
type NavBadges = Partial<Record<RouteKey | 'queue', NavBadge>>;
```

### 5.3 Data each badge needs

| Badge | Phase 1 (existing procedure, called in `layout.tsx` `Promise.all`) | Phase 2: `nav.badges` (new) |
|---|---|---|
| לטיפולי | Derived: `approvals.myQueue` rows + claim letters | `tasks.mine` count + block flag, the **same source** as the queue page and the bell footer |
| אישורים | `approvals.myQueue({ limit: 100 })` (`memberProcedure`, role-filtered); ₪ = W1-05 `queueAtRisk()` | the same, inside the batch |
| דרישות זיכוי | **none safe**: `recovery.summary` runs `syncClaims()` (writes) | read-only `count(*)`, `sum(amount_agorot)` where `status='claimed'` |
| קבלת סחורה | `receiving.todayExpectations()` (`memberProcedure`) | the same |
| חשבוניות נכנסות | `ingest.overview().needsReview` (`financeProcedure`; wrap in `.catch(() => 0)`, it throws when the ingest flags are off) | the same |
| חוזים ומחירים | `priceAlerts.openCount` (already read via `getWave1Access`) | plus materiality (≥3 % **and** ≥‏50 ₪/month) → warn |
| עלות מנה / ספירת מלאי | — / `inventory.current()` | `recipes.priceAlerts().alerts.length` (count only) / the open-draft status |
| Bell | — | `notifications.inbox` (the alert log, read side) |

**`nav.badges` (W2-08) rules:**
- It is **one batched query** (`staleTime` 30 s, refetch on focus and every 60 s).
- It **never returns `kind: 'ils'` for chef or receiver.** The client resolver drops `ils` for field roles as a second guard.
- It needs a COVERAGE entry in `packages/api/src/__tests__/cross-tenant.attack.test.ts` (add-only) and an attack test that a chef or receiver session receives no `agorot` (`tenant-security-warden`).
- `search.*` palette results (records, amounts) must be role-gated the same way (COVERAGE entry).

---

## 6. States

| State | Treatment |
|---|---|
| Idle | `muted` 500 on `bg`; icon `muted` at stroke 1.75 |
| Hover (80 ms) | `surface-2` fill (darker), text and icon `ink`; a count pill flips to `surface` |
| Pressed | `ink` 7 % |
| **Active (here)** | **White raised pill:** `surface` + inset 1 px `line` + `e1`, **2×16 primary notch** at inline-start (inset 8 px top and bottom), label `ink` 600, icon `primary` at stroke 2, `aria-current="page"`. Hover goes darker and active goes lighter, so they can never be confused. **No mint fill**, so no green behind a red pill |
| Focus-visible | 2 px `info` outline, offset **−2** on rows and tiles (never clipped by the scroll region, never touching a solid red pill) |
| Collapsed group holding the page | header `ink`, glyph `primary`, `aria-current="true"` + SR ", המסך הנוכחי כאן" |
| Rail tile, here | the white tile + 2×20 notch + primary glyph + label 600 + `aria-current="true"` |
| Rail tile, open | `surface-2`. When it is both open and here, the white tile wins |
| View-only (bookkeeper) | idle look + `Eye` on the badge axis |
| Group closed with T2 inside | 6 px dot on the badge axis (danger or warn) + SR text |
| Overflowing list | 28 px top and/or bottom mask fade |
| Loading badges | no pill, and no layout shift (the pill is absolutely sized; the space is not reserved) |
| Badge source error | no pill; never "0" and never a spinner in the menu |
| Empty לטיפולי | no count; the queue page shows "אין משהו שמחכה לך" |
| Forced colours | the active row and here-tile get a 2 px `Highlight` outline; pills a 1 px `CanvasText` border; dots keep their colour |

---

## 7. Behaviour

### 7.1 Expand, collapse and overlay

| Viewport | Default | Ctrl/⌘+B, `[`, the toggle or the edge |
|---|---|---|
| ≥ 1280 | expanded (unless the cookie says rail) | toggles 248 ↔ 64 and persists |
| 1024–1279 | **rail** | opens the 248 panel as a **modal overlay**: `e3` shadow, `ink` 12 % scrim, `inert` on `main`, focus stays in the panel (Tab and Shift+Tab wrap from the toggle to the switcher and back), Esc / outside click / route change close it and return focus to the toggle. **The page is never squeezed** (content width 1036 at 1100) |
| < 1024 | no sidebar | bottom bar (§11) |

- **Persistence:** the rail state lives in the **`rm_nav_rail` cookie, read on the server** in `layout.tsx` (no width flash), with `localStorage` `rm:nav:rail` as a mirror.
- Group state (`rm:nav:groups:<role>`), favourites (`rm:nav:fav:<role>`, ≤ 5) and the single-key switch (`rm:keys:single`) live in `localStorage`, each read and write inside `try/catch`. Server-side pins are a schema change and need a human PR.

### 7.2 Flyouts (rail)

- They open **on click / Enter / ←**, or after **220 ms** of hover.
- **Aim detection:** a safe triangle runs from the pointer's last position on the trigger to the flyout's near edge (±12 px). While the pointer is inside it, hovering another group tile waits **300 ms** and only switches if the pointer is still on that tile. Leaving closes the flyout after 300 ms (or 400 ms inside the triangle). Verified: the diagonal from כסף to its last row crosses ניתוח and keeps כסף.
- The pin button expands the panel with that group open (or opens the overlay at 1024–1279).
- Tooltips are suppressed on hover over a group tile (the flyout names it) but shown on keyboard focus.

### 7.3 Branch switch

- The switch keeps the path and non-entity filters (W1-04 `branchSafeTarget`). A detail page falls back to its registry parent with a toast.
- The head, crumb, context line and **`<title>`** update: "אישורים · ירושלים — RestoMatch". The palette also has "מעבר לחיפה / לירושלים".

### 7.4 לטיפולי, approvals and the bell (31.10)

- **לטיפולי page:** ranked blocking first, then by ₪. "שלי / הכול" segmented control. J/K moves; Enter opens. Verbs name the ₪ effect: "דחייה ובקשת זיכוי", "אישור כפי שחויב", "שליחת המכתב". A חשבונית מרכזת awaiting delivery notes never enters the queue.
- **Approvals bulk:**
  - Checkboxes appear only on **non-blocking rows ≤ ‏200 ₪ per invoice**. Blocking rows show a `Lock` + SR "פער חוסם: נבדק לבד, לא נכלל באישור מרוכז".
  - Bar: "N פערים קטנים נבחרו · ‏152.50 ₪", then "אישור מרוכז: עד ‏200 ₪ לחשבונית · פער חוסם לא נכלל · השרת אוכף את התקרה", then "אישור מרוכז (N)" → an inline confirm "לאשר N פערים, ‏X ₪? כן, לאשר / ביטול".
  - Note: "מוואטסאפ אפשר לאשר פער בהקשה אחת עד ‏500 ₪, ורק פער שאינו חוסם".
  - The palette action "אישור מרוכז של פערים קטנים" **only opens the list**.
- **Bell:** real alerts (in-app + push/WhatsApp), ≤ 6 per person per day, none 23:00–06:00 or on Shabbat (the morning summary is one of them). The caps and quiet hours are enforced server-side (see §15).

---

## 8. Keyboard map (RTL; every binding on `KeyboardEvent.code`)

| Keys | Action | Guards |
|---|---|---|
| Ctrl/⌘ + B (`KeyB`, Hebrew נ) | collapse / expand, or the overlay at 1024–1279 | no repeat, not in an editable field, not while a dialog is open; closes popovers first |
| Ctrl/⌘ + K (`KeyK`) | palette (toggles) | — |
| `/` · `[` · `?` | palette · collapse · cheat sheet | **single-key**, off in inputs; can be switched off (2.1.4) |
| G then H Q A I P C L O R S B | בית · לטיפולי · אישורים · נכנסות · תשלומים · זיכוי · דליפה · הזמנות · קבלה · ספקים · רשת | single-key; 1 s window; shown in tooltips, the palette and the sheet. **A pending G is resolved before `/` and `?`**: on the Hebrew layout `KeyQ` types "/", so G Q must not open the palette. `/` binds on `code: 'Slash'` (or `key: '/'` from a non-letter key) |
| ↑ / ↓ · Home / End | move through rows and group headers in the panel | — |
| **←** on a group header | closed: opens it · open: enters its first item | RTL: ← = toward the child (Radix `SUB_OPEN_KEYS.rtl`) |
| **→** | on an item: back to its header · on a header: close | — |
| Rail: ← / Enter / Space on a group tile | opens the flyout on its first item; ↑↓ stay inside (they wrap through the pin and the rows); → or Esc closes and refocuses the tile | — |
| Esc | tooltip → flyout → popover → overlay, in that order; focus returns to the trigger | — |
| Popovers | Tab / Shift+Tab out closes and continues from the trigger. Menus: ↑↓ Home End | — |
| J / K on לטיפולי | next / previous item | single-key |

- **The single-key switch** ("קיצורים בתו אחד") is in the account menu, the cheat sheet and the palette, and persists. Ctrl/⌘ combinations always stay on.
- **Tab order** = DOM = visual order: skip link → switcher → ⌘K → בית → לטיפולי → כסף → **אישורים (Tab 7)** → … → footer → account → toggle → top bar → main. (The reference page's presenter controls add 2 stops before the switcher; they are not part of the app.)

---

## 9. ARIA and landmarks

- **Landmarks:**
  - The whole sidebar (switcher, ⌘K, nav, footer, account, toggle) is `<aside aria-label="תפריט צד">`. Inside it, `<nav aria-label="ניווט ראשי">` wraps the scroll region and the footer.
  - The top bar has `<nav aria-label="מיקום">` (crumbs). The phone bar is `<nav aria-label="ניווט תחתון">`.
  - **No `region` landmarks:** groups are `div[role=group][aria-labelledby]` around a `<ul>`.
- **Group header:** `<button aria-expanded aria-controls>`. In the rail it reflects the flyout. `aria-current="true"` + ", המסך הנוכחי כאן" when it holds the page and is closed (or in the rail).
- **Links:**
  - `aria-current="page"` on the active row; the favourites copy of a route never carries it.
  - Badge meaning goes in visually hidden text inside the link, not in `aria-label` on a span.
  - Rail labels are `aria-hidden` duplicates of the visually hidden full label, so the accessible name is the full Hebrew name.
- **Dialogs:**
  - The palette, the cheat sheet and the phone "עוד" sheet are **native `<dialog>` + `showModal()`** (focus contained, Esc returns to the opener), with a 44×44 close on the sheet.
  - The bell is `role="dialog"` with `aria-labelledby`, mounted right after its trigger. The switcher and the account menu are `role="menu"` with `menuitemradio` / `menuitemcheckbox`.
- **Route change:** focus moves to `h1#pageH1` (`tabindex="-1"`, no visible ring: it is not a control), `<title>` updates, and a polite live region says "נפתח: אישורים".
- **A route the role cannot open** (a pasted link, an old bookmark) is never a silent bounce: the page lands on בית, the address is replaced with it, and a toast says why: "המסך „כרטסת ספקים" לא זמין לתפקיד מקבל סחורה · עברת לבית". Palette records always open a screen the role has (chef: an order → הזמנות; receiver: an invoice → קבלת סחורה).
- **Sticky chrome (2.4.11):** `html { scroll-padding-top: 64px; }` with `scroll-margin-top: 80px` on the `h1`. Below 1024 the shell is an **app shell**: the top bar and the bottom bar are flex siblings of the one scrolling column (`scroll-padding-top: 64px`), so no content and no focused control ever slides under a bar. (With a sticky bar over document scroll, whatever link straddles the bar at rest fails axe `target-size` as "partially obscured"; the reference build hit this at 360, 375, 390 and 412.) The skip link is off-canvas at `top: -200px` and **has its shadow only on `:focus-visible`** (no ghost smudge).
- **`<kbd dir="ltr">`** on every key token ("Ctrl K", "G A", "99+"). **Never `dir="ltr"` around a he-IL ₪ string.** "RestoMatch" inside Hebrew is `<span lang="en" dir="ltr">`.

---

## 10. Motion

| What | Timing | Notes |
|---|---|---|
| Collapse | labels fade **80 ms** linear, **then** width 248→64 in **160 ms** `cubic-bezier(.2,0,0,1)` | Icons keep x = 32 throughout (measured at 40/90/140/260 ms) and glide vertically to their tiles with a 180 ms FLIP. Nothing is sliced mid-word |
| Expand | rail labels fade 80 ms, then width in **200 ms**; labels fade in 140 ms after 130 ms | — |
| Overlay (1024–1279) | the same width motion; scrim fades | — |
| Hover · chevron · tooltip | 80 ms · 120 ms · 90 ms opacity | — |
| Badge value change | 150 ms cross-fade | No bounce, no count-up, no stagger, no toast on collapse |
| `prefers-reduced-motion` | everything 0 ms | — |

Animate `width` and `inset-inline-start` only (logical properties: RTL needs no maths). Never `transition: all`.

---

## 11. Phone and tablet (< 1024): bottom bars

- **Bar:** 64 tall + a 1 px `line` top border + `env(safe-area-inset-bottom)`, `surface`. It is the last flex child of the app shell (not sticky over content). Slots are equal width.
- **Slot:** icon 24 inside a 56×28 pill (active: `primary-subtle`, icon `primary`, label `ink` 600, `aria-current="page"`). Label 12/16 500.
- **Badge:** 18 tall, `top: −6px`, its inline-start edge 6 px past the pill's centre (`inset-inline-start: calc(50% + 6px)`), so it grows toward inline-end: top-left in Hebrew, the mirror of the usual top-right badge. 2 px ring in `surface`.
- **"עוד"** opens a native `<dialog>` bottom sheet: ⌘K row, then the role's other items grouped like the desktop, then help and sign-out. 44×44 close; 48 px rows.

| Role | Bar |
|---|---|
| manager | **היום · הזמנות · קבלה · אישורים · עוד** (owner decision, verbatim) |
| owner (chain) | בית · אישורים · דליפה · סניפים · עוד |
| bookkeeper | בית · אישורים · תשלומים · חשבוניות · עוד |
| chef | היום · ספירה · מנות · הזמנות · עוד |
| receiver | היום · צלם · קבלות · עוד (no ledger) |

**Phone header:**
- Branch name (switcher when ≥ 2 memberships), then search 44×44 and the bell 44×44 (dot only).
- No horizontal scroll at 390 or 360 (`scrollWidth` = viewport width for all five roles, with the bell, palette, switcher and "עוד" sheet open).
- Text links ("לכל התור", "לקבלת סחורה", "לכל המנות") are at least 24 px tall (2.5.8).

---

## 12. Files (inside W1-03's write boundary)

| File | Change |
|---|---|
| `apps/web/app/dashboard/nav.tsx` | `Sidebar` (one DOM, two layouts: panel and rail), `SidebarItem` (grid, states, `NavBadge`), `SidebarGroup` (header row, fit rule, flyout in rail), `RailTile`, `Flyout` (aim detection), `NavTooltip`, `BranchSwitcher` head, `AccountMenu` (incl. the single-key switch), `BellPopover`, `BottomBar` + `MoreSheet`, `NavIcon` (optical k) |
| `apps/web/lib/nav/types.ts` | `RouteDef.badge`, typed `NavBadge`, `railLabel`, `viewOnlyFor` |
| `apps/web/lib/nav/registry.ts` + `routes/*.ts` | `queue` entry; `recovery` → `linked` under `claims`; `leaksProof` → tab; `monthlyReport` nav label דוחות; `payRun.navHiddenFor: ['manager']`; short rail labels; group key `leaks` → `analysis` (label ניתוח) |
| `apps/web/lib/nav/icons.ts` | canonical icons per §4.1 and the group glyphs `Wallet`, `ChartSpline`, `ShoppingBasket`, `Utensils`, `Building2`, `SlidersHorizontal` |
| `apps/web/lib/nav/groups.ts` | `defaultOpenGroups(viewer)` per §4.2 + `fitGroups()` (LRU, never a T2 group, never "here") |
| `apps/web/lib/nav/prefs.ts` | `rm_nav_rail` cookie + `localStorage` keys, all in `try/catch` |
| `apps/web/lib/nav/keys.ts` (new) | chords by `code`, guards, single-key switch |
| `apps/web/app/dashboard/layout.tsx` | read the cookie; on ≥ 1024 the top bar = crumbs + period + bell; P1 badges via `Promise.all` (§5.3); `<title>` per route and branch |
| `apps/web/e2e/nav*.spec.ts` | §14 (with `test-sentinel`) |

**Outside the boundary (route them, do not edit):**

| Change | Owner |
|---|---|
| Tokens in `apps/web/app/globals.css`, `tailwind.config.ts`, `packages/ui-tokens` | `rtl-design-steward` / W1-01 |
| `apps/web/lib/roles.ts` `ROUTE_ROLES`: (a) **remove `receiver` from `/dashboard/suppliers/ledger`** (owner decision; the link is hidden today but the gate still allows it); (b) **add `chef` to `/dashboard/orders`** (+ `orders.*` mutations to `chefProcedure`, ₪-free chef view); (c) **bookkeeper read-all**: add `bookkeeper` to `/dashboard/reports(/monthly)`, `/suppliers`, `/catalog`, `/products`, `/orders`, `/receiving`, `/recipes`, `/inventory`, `/team`, read-only server-side, and make `/contracts` writes owner/manager-only (the bookkeeper's only edit right outside her finance work is the supplier ledger, with an audit log) | `tenant-security-warden` + COVERAGE |
| `nav.badges`, `tasks.mine`, `notifications.inbox` and `search` role-gating in `packages/api` | `web-feature-engineer` + warden; COVERAGE entries add-only |

---

## 13. Persistence keys

| Key | Where | Value |
|---|---|---|
| `rm_nav_rail` | cookie (1 year, `SameSite=Lax`, read in `layout.tsx`) | `1` / `0` |
| `rm:nav:groups:<role>` | `localStorage` | `{ [group]: boolean }` |
| `rm:nav:fav:<role>` | `localStorage` | `RouteKey[]` (≤ 5) |
| `rm:keys:single` | `localStorage` | `1` / `0` |

---

## 14. Playwright acceptance (`apps/web/e2e/`)

Run at 1440×900, 1366×768, 1280×800, 1280×720 and 1100×700 desktop, plus 390×844 phone, in he (and en where noted), for all 5 seeded roles. The reference harness `sidebar/final/shoot.mjs` implements every check below against the prototype; port its selectors.

1. **Side and width.** In he, `aside[aria-label]` has `getBoundingClientRect().right === innerWidth`; in en, `.left === 0`. Width is 248 expanded and 64 rail. At 1100 the default is the rail.
2. **Grid.** Every visible row and header icon has its centre at x = 32 from the inline-start edge in **both** modes; labels start at 52; badges end at 227. `(centre % 1) === 0` in the expanded, rail and flyout-open states.
3. **Collapse moves nothing sideways.** Sample icon centre x at 40/90/140/260 ms after Ctrl+B: always 32.
4. **Ctrl+B on a Hebrew layout:** dispatch `{ code: 'KeyB', key: 'נ', ctrlKey: true }` → rail. Reload **without** clearing storage → still rail, with no first-paint width change (cookie).
5. **Overlay (1100×700):** Ctrl+B → `main` is `inert`, its width is unchanged (1036), and 40 Tabs never leave the panel. Esc closes the overlay and focuses the toggle.
6. **Fit matrix:** for every role × viewport × mode, the scroll region overflows by 0 px, or shows the mask fade. No two sidebar controls overlap (rail at 1100×700 included). After opening every group, כסף stays open whenever it carries ₪, and so does the active route's group.
7. **≤ 2 interactions to every allowed route,** expanded and rail, for every role: a direct visible link = 1; group header or rail tile + item = 2. Verify with `elementFromPoint`.
8. **Tab stops:** from page load, אישורים is reached in ≤ 8 Tabs (the reference build takes 7).
9. **RTL arrows:** on a closed רכש header, ← opens it; ← enters הזמנות; → returns to the header; → closes it. Rail: ← opens the flyout on its first item; ↑ twice keeps focus inside it; Esc closes it and refocuses the tile. **Hebrew layout:** dispatch `{ code: 'KeyG', key: 'ע' }` then `{ code: 'KeyQ', key: '/' }` → `#queue`, and the palette stays closed.
10. **Aim detection:** hover כסף in the rail, then move diagonally (14 steps) to its last flyout row, crossing ניתוח. The flyout is still כסף.
11. **Tooltips:** keyboard focus on a rail tile shows the tooltip within 200 ms; its rect never intersects the trigger; it sits 8 px beside the rail; Esc hides it.
12. **₪ order (he):** for every visible text node containing U+20AA, the ₪ glyph rect is **left of the first digit** (Range rects). No ancestor of a ₪ string has `dir="ltr"`.
13. **No ₪ for chef or receiver** (the whole document, presenter copy included): `body.innerText`, every `aria-label` / `title` / tooltip attribute and every `.sr` node contain no U+20AA on בית, הזמנות, עלות מנה, ספירת מלאי, קבלת סחורה and הגדרות, in the bell, in the account menu, and in the palette for the queries "", אישור, דליפה, זיכוי, ספק, תנובה, 1, 24950, 104, @ and #. **Server-side:** the `nav.badges` and `search` responses for those roles contain no `agorot` field.
14. **Receiver has no ledger:** no `[href*="/suppliers/ledger"]` anywhere, and a direct visit is refused by middleware (after the warden delta).
15. **Branch switch keeps the page:** on `/dashboard/approvals`, switch to ירושלים → the path is unchanged and `document.title` contains "ירושלים".
16. **Popover Tab contract:** Tab out of the switcher → focus on the ⌘K field, popover closed. Tab out of the bell never lands on `<body>`.
17. **Palette:** "תנובה", ",bucv" (wrong layout) and "@ירקות" find the supplier; "24950" finds MF-24950; "104" finds ‏104.80 ₪ (±1); an empty query keeps a 52 px header; "אישור מרוכז" only navigates.
18. **31.10 copy:** no text "דליפות", "התראת מחיר", "1.5%", "יעד", "אין התראות" or "חשבוניות ריכוז" in the DOM for any role. אישורים has checkboxes only on non-blocking rows ≤ ‏200 ₪, and every blocking row shows a lock.
19. **Phone (390×844 and 360×780):** `scrollWidth` equals the viewport width for every role (bell, palette, switcher and sheet open too); the manager bar reads exactly "היום·הזמנות·קבלה·אישורים·עוד"; a 40-step Tab-walk never leaves the focused element fully hidden under the bars (`elementFromPoint` at 5 points); the "עוד" sheet is a modal `<dialog>` with a ≥ 44×44 close.
20. **Skip link:** the first Tab shows it at `top ≥ 0`; Enter focuses `main` and the `h1` top ≥ the top bar's bottom.
21. **axe** (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`): **0 serious or critical** (the reference build has 0 of any impact) in the expanded, rail, flyout, switcher, account, bell, palette, approvals, queue, overlay, 5 roles, phone and sheet states.
22. **Visual:** `toHaveScreenshot` at 1440×900 for the owner expanded, owner rail, rail flyout (כסף), manager, chef and receiver, with masks on the clock text. Diff threshold 0.1 %.

---

## 15. Do not

- **Do not** put the T1 leak (‏760 ₪), any T3 good news or any "target"/"1.5%" in the menu, the switcher's own row or the bell.
- **Do not** use more than one solid pill, a mint/`primary` active fill, a solid-ink count disc, or hue alone for state.
- **Do not** emit, render, tooltip or announce ₪ for chef or receiver. That includes the palette, the bell and SR text. Hiding is not enough: gate it on the server.
- **Do not** show the receiver a supplier-ledger link, or leave `/suppliers/ledger` open to the receiver in `ROUTE_ROLES`.
- **Do not** use "דליפות" as a group name or "התראת מחיר" anywhere ("דליפה" = the monthly leak only; price creep = "מחירים שעלו"). Use חשבונית מרכזת · פער · דרישת זיכוי · קבלת סחורה.
- **Do not** offer bulk approval for blocking items or above ‏200 ₪ per invoice, and never execute an approval from the palette, the bell or the menu.
- **Do not** expand the whole rail on hover, couple the nav toggle to other panels, or squeeze the page with the overlay at 1024–1279.
- **Do not** read the rail state from `localStorage` on first paint (cookie), or call `localStorage` outside `try/catch`.
- **Do not** bind shortcuts on `event.key` (Hebrew layout), or ship single-key shortcuts without the off switch.
- **Do not** wrap a he-IL ₪ string in `dir="ltr"`, re-implement `Intl.NumberFormat` for money (call `formatIls`), compact ₪ ("₪1.2K"), or render `99+` without LTR isolation.
- **Do not** mirror `ShoppingCart`, `Truck`, `HandCoins`, `Search`, `CircleHelp` or chart glyphs; choose `PanelRight*` / `PanelLeft*` by `dir` instead of flipping.
- **Do not** use `role="menu"`, `tree` or `region` for the nav itself, or `aria-label` on a role-less span.
- **Do not** call `recovery.summary` for a badge (it writes), and do not add a nav-only DB query outside `nav.badges` with COVERAGE.
- **Do not** add Radix or any other dependency for these popovers in W1-03; build on native `<dialog>` and the patterns above.
- **Do not** hard-code colours outside the tokens, use `.glass` on the sidebar or top bar, or use `transition: all`.

---

## 16. Human-only items (immutable files: propose, do not edit)

1. **Bulk approval caps** (‏200 ₪ per invoice from the list, ‏500 ₪ one-tap from WhatsApp, never for blocking items) must be enforced in `packages/api/src/approvals/engine.ts`. **Immutable: human-authored PR.**
2. **Real alerts:** ≤ 6 per person per day, no sends 23:00–06:00 or on Shabbat, channel routing. This lives in `packages/api/src/notifications/outbox.ts` + `apps/worker/src/cron.ts`. **Immutable: human-authored PR.** The bell UI reads only.
3. **`formatIls()`** is used unchanged; any change is a `money-format-marshal` human PR.
4. **`AGENTS.md`** (immutable) still says "dark RTL design" and "חשבוניות ריכוז". The owner decided **light only** and **חשבונית מרכזת**. Flag it for the human.
5. **New tRPC procedures** (`nav.badges`, `tasks.mine`, `notifications.inbox`) and the `search` gating need **add-only** COVERAGE entries in `cross-tenant.attack.test.ts`, reviewed by `tenant-security-warden`.
