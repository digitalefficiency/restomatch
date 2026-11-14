# DS3 · design spec of the clean finish

The source of truth is `reference/reference.html` and its sources in `reference/src/`. This document states the
rules behind it, names the values, and says where each thing lives in the sources so that a package can find
it. Selectors below are the reference's class names (`product.css`); they are **not** the product's names. In
the product every value comes from the DS tokens (`packages/ui-tokens`) and every pattern from a shared
component.

Read `KNOWN-ISSUES.md` beside this file: it lists where the mock-ups are wrong.

## 1. Principles

1. **One number speaks.** On a money screen one number leads and it is the largest thing on the screen. On the
   owner home it is at display size.
2. **Every shekel carries its proof.** From the big number to the line and to the picture of the invoice,
   without leaving the screen.
3. **Ordered, received, billed.** The same small table in the approvals queue and on the invoice. In a letter
   to a supplier the third column is called "בחשבונית"; at the dock only ordered and received appear. The gap
   is written, never left for the reader to compute.
4. **Colour only when money waits for a person.** Grey by default, also for what is merely pending. Red for
   what blocks a payment, amber for a warning that waits for handling, green for money that came back.
5. **Keyboard at the desk, thumb at the dock.** Decisions with one key in front of a screen; counting with one
   thumb beside the truck.

## 2. Colour

The clean finish. Meanings are the product's existing ones (tiers T1 to T4); the values are a modest re-tuning
of the DS2 ramps. `DS3-00` maps each row to a DS2 role; other packages only ever use roles.

| Reference property | Value | Name | Meaning and where it may appear |
| --- | --- | --- | --- |
| `--canvas` | `#F8FBF9` | paper | The page background, and the side menu: the menu sits on the canvas, not on a card. |
| `--surface` | `#FFFFFF` | | Cards, panels, sheets, the flyout list, and the current row of the side menu. |
| `--sunken` | `#F1F5F3` | | Wells: a key cap, a segmented track, a neutral status pill. |
| `--hover` | `#EBF0ED` | | Hover fill of a quiet control or a row. |
| `--rule` | `#E2E8E5` | | Hairline between rows, and the 1 px border of a card. |
| `--line` | `#D4DBD8` | steel | Edges of the frame and of small chrome: the menu's edge and separators, the current menu row, a key cap, a table header, the palette's border. |
| `--line-strong` | `#808984` | steel | Border of a secondary button and of a field (3:1 against the surface). |
| `--fg` | `#121C17` | ink | Text and **every money figure**. |
| `--fg2` | `#49524E` | steel | Secondary text. |
| `--fg3` | `#5D6561` | | Tertiary text, the ₪ sign, the agorot. |
| `--brand` / `--brand-h` | `#00573B` / `#00452D` | basil | The one primary action of a screen; text links. Hover is the second value. |
| `--brand-sub` / `--brand-bd` | `#E0F9ED` / `#ADDEC7` | | Tinted surface and its border. |
| `--leak` / `--leak-solid` | `#B7191C` / `#DD2729` | tomato | Leak and "blocks payment", nothing else. The first is text and the solid pill; the second is a dot or a bar. |
| `--leak-sub` / `--leak-bd` | `#FFF0EE` / `#FACAC5` | | Tinted pill and its border. |
| `--warn` / `--warn-solid` / `--warn-ring` | `#925000` / `#F2AB19` / `#B97500` | turmeric | What waits for handling without blocking: a warning-level gap in the approvals queue, the amber ₪ pill in the menu, a request with no answer for more than 7 days, a counting gap; also the marked favourite star. Lighter than the red, not only a different hue. The ring gives the amber dot 3:1. |
| `--warn-sub` / `--warn-bd` | `#FFF6E1` / `#F5D79A` | | Tinted pill and its border. |
| `--ok` / `--ok-solid` | `#00713E` / `#0EA053` | leaf | A counted line; the tick of good news. **Money that came back is green, not gold**, in the clean finish: the reference draws the tick in `--ok-solid` and the amount in the darker green `#00573B`. In the product that amount is the T3 "recovered" role, whose clean value is that green; do not reuse the action role for it. |
| `--ok-sub` / `--ok-bd` | `#E2FBE9` / `#ADE3BF` | | Tinted pill and its border. |
| `--info` / `--focus` | `#2256BB` | sea | The selected row and keyboard focus. A state of the interface, never of money. |
| `--info-sub` / `--info-bd` | `#ECF4FF` / `#BFD5FD` | | Selected-row fill and its border. |
| `--sh1` | `0 1px 2px rgb(18 28 23 / .05)` | | A resting card. |
| `--sh2` | `0 2px 6px rgb(18 28 23 / .06), 0 12px 28px -10px rgb(18 28 23 / .18)` | | A floating layer: toast, sheet, flyout, palette. |

Rules:

- Measured on the reference: every text and background pair is at least 5:1 (the lowest is 5.42:1, the agorot
  on a selected row). The product's contrast tests keep AA as the gate; do not go below what the reference
  holds without a reason written in the pull request.
- A status never relies on colour alone: a dot or an icon and a word always come with it.
- The four tiers, as the clean finish draws them:
  - **T1, the leak this month:** size and ink. The red is a 8 px dot beside the label, never the number, never
    a frame or a bar at the side of the card.
  - **T2, act now:** a solid pill ("חוסם תשלום": `--leak` background, white text) or an amber pill, the amount
    in ink, and one primary action.
  - **T3, good news:** calm green: a round green tick and the amount in green (see the `--ok` row).
  - **T4, pending:** grey pill with a clock and a reason. Never a warning colour.

## 3. Type and numbers

- **Family:** one family for interface and numbers (the UI font role). The reference renders in Google Sans
  with a switch to IBM Plex Sans Hebrew; both must work. Which one production uses is decided in `DS3-07`
  alone. No package names a font family.
- **Scale (desk), size/line in px:** note 12/16 (the smallest size at the desk) · secondary 13/18, and 13/20
  in running text · body 14/20 inside components, 14/22 in running text · region title 16/22 · 18/24 ·
  section title 20/28 (20/26 for a screen title in compact density) · page title 24/32 · 28/32 where a screen
  has one leading figure that is not the hero. Weights 400, 500 (labels, buttons, figures in rows) and 600
  (titles, totals, the current menu row). 700 appears only in the restaurant's monogram and the flyout header.
- **The hero number:** 84/88 px, weight 400, letter-spacing −0.03 em; on a phone 64/70 px. The ₪ sign is 0.4 em
  and raised slightly (`.hero-num`, `.hero-num .money .cur`).
- **Phone:** body 16/24; primary button text 16 to 18 px; key caps 24 px.
- **Numbers:** `font-variant-numeric: tabular-nums lining-nums` on every figure, in every weight, so a bold
  total still lines up. Columns of numbers are physically right-aligned.
- **Money markup** (`.money`, `.cur`, `.dec`): the amount is one LTR, non-wrapping unit; the ₪ sign sits left
  of the digits at about 0.74 em (never under 12 px) in the tertiary colour; the agorot are in the tertiary
  colour too; thousands separated with a comma. In the product this is the shared money component over
  `formatIls()`; do not build the string by hand.
- Identifiers (invoice, order and SKU numbers) are LTR-isolated (`<bdi>`), in the UI family.

## 4. Shape, borders, elevation, focus

- Radii: **8** controls (buttons, fields, menu rows) · **12** cards and panels, toasts, the flyout list, the
  palette, and every control of the phone flow (its primary buttons, the number-pad keys, the steppers) ·
  **16** dialogs and bottom sheets (the token's "overlay") · a pill is half its height. (Decision D6;
  unchanged.)
- A card is a white surface with a 1 px `--rule` border and `--sh1`. A floating layer uses `--sh2`; the
  palette also has a 1 px `--line` border and the flyout a `--rule` ring.
- Rows are separated by a 1 px `--rule` hairline, not by cards.
- Focus: a 2 px `--focus` outline on every focusable thing, offset 2 px outwards; inside the side menu the
  offset is −2 px (sidebar spec §6); white on a dark toast.
- `forced-colors: active` is handled (see the rule in `product.css`); keep it working.

## 5. Controls

| Control | Sizes | Notes (selector) |
| --- | --- | --- |
| Button | 36 px high, 14 px text, 8 px radius; small 32/13; large 44/16 | `.btn`. Primary: `--brand` fill, white text, **one per viewport**. Secondary: white with a `--line-strong` inset border. Quiet: text only, hover fill. An action that costs money is never the primary one. |
| Key cap | 20 px high, 12 px text | `kbd`. Shown inside a button that has a shortcut. |
| Status pill | 22 px high, 12 px text, a 6 px dot | `.st`, `.st-leak`, `.st-warn`, `.st-ok`, `.st-solid`. |
| Segmented control | 28 px buttons in a 2 px track (44 px on a phone) | `.kit-seg` (settings: density, text size). Use the product's existing segmented control. |
| Switch | 44 × 26 px track | `.sw` (settings). The whole row is the click target. |
| Number field with steppers | 36 px high, 36 px stepper buttons | `.numf` (settings). It holds its limits and says them. On a phone the touch area is 44 px. |
| Menu row | 32 px; 28 px in a window under 800 px high | Sidebar spec. |
| Phone primary button | 60 px high, 12 px radius | `.ph-cta`, `.ph-main`. |
| Number pad key | 64 px high, 12 px radius, 24 px text | `.keys button`. |

Touch targets are at least 44 px on a phone. At the desk nothing clickable is under 24 px and text is never
under 12 px.

## 6. Icons

`reference/src/sprite.html`: 60 symbols on a 24 px grid, drawn at 16 px in content, 20 px in menu rows and
tiles (group glyphs 16 px) and 18 px in the top bar, stroke 1.75, round caps and joins, `currentColor`. The lines follow Lucide, which the product
already ships. What DS3 adds is the **two-tone state**: each symbol has a fill layer whose opacity is the
custom property `--i-duo` (0 at rest). The current page's icon in the menu takes the brand colour, stroke 2
and `--i-duo: .18`; a marked favourite star takes `--i-duo: .9`. Icons that show direction mirror in RTL;
the truck never does.

## 7. Density

Two levels, worded **"רגיל / צפוף"** (decision D4). The reference implements compact as `.is-compact` on the
application frame (26 rules): tighter row padding (a queue row 4/12/5 px instead of the regular 7/12/8 px),
14/18 row titles, 12/16 sub-lines, 20/26 screen titles, smaller table cell padding. It never
drops below 12 px text or below the 44 px touch target on a phone, where density is fixed. The choice is
personal, saved per device, and applies to every screen at once.

## 8. Motion

Motion appears only when it explains what changed: where something came from, where it went, what changed.

| Token | Value | Used for |
| --- | --- | --- |
| `--t-press` | 100 ms | A button, a key, a selected row. |
| `--t-state` | 150 ms | A tick, a gap that changes, a keypad that closes. |
| `--t-panel` | 240 ms | A calculation that opens, a toast that rises, a keypad that opens. |
| `--t-explain` | 400 ms | A number that counts, a line that draws; once, on entry. |
| `--e-std` | `cubic-bezier(0.2, 0, 0.38, 0.9)` | Things that move within the screen. |
| `--e-out` | `cubic-bezier(0, 0, 0.38, 0.9)` | Things that enter. |
| `--e-exit` | `cubic-bezier(0.2, 0, 1, 0.9)` | Things that leave. |

These are the durations and curves `packages/ui-tokens` already defines. DS3 adds exactly one named set
beside them, for the side menu only, because the owner-approved sidebar spec (§10) fixes its timings: 80, 90,
120, 130, 160 and 200 ms with `cubic-bezier(.2, 0, 0, 1)`. `DS3-00` adds that set as tokens and `DS3-02` uses
it. Nothing else adds a duration or a curve. Rules:

- What is done a hundred times a day does not move: a decision by key is instant; the same decision by pointer
  gets a short transition.
- A number counts only when it changed: the leak counts once on entry, within 400 ms.
- The time left to undo is visible: a thin line in the toast shortens over ten seconds and pauses under the
  pointer or focus.
- Nothing bounces or overshoots. The side menu has no count-up, no stagger and no bounce (sidebar spec); its
  collapse is labels out in 80 ms, then width in 160 ms; expanding is width in 200 ms with labels after 130 ms.
- `prefers-reduced-motion: reduce`: everything appears in place, with no transitions and no counting.
- Keyframes in the reference, for orientation: `rm-fade`, `rm-grow`, `rm-draw`, `rm-tick`, `rm-pop`,
  `rm-press`, `rm-rise`, `rm-slide`, `rm-toast`, `rm-timer`, `rm-sheet-in`, `rm-sheet-out`, `rm-flash`,
  `rm-shim`.

## 9. Front-end rules

- **One component for each thing.** An amount, a status and a change against a previous period each go
  through one shared component. A screen never formats ₪ or builds a pill by hand.
- **The screen answers before the server.** A click is acknowledged within 100 ms; a decision shows at once;
  if the server refuses, the row returns to its place with an explanation.
- **Loading that does not flicker.** A skeleton appears only when the wait passes one second and stays long
  enough not to flash.
- **New browser features come in as enhancements.** Whoever lacks one gets the same screen without it. View
  transitions, CSS entry and exit, the built-in popover, container queries and computed colour are allowed on
  those terms; anchor positioning and `interpolate-size` are not relied on. Details and support dates are in
  `reference/PAGE-TEXT.he.md`, section "פרונט־אנד".

## 10. The screens

Each screen is one work package. Its section in `WORKPLAN.md` gives the boundary and acceptance; here is what
it must look like and do. Hebrew strings are the proposal's; where the product already has a string for the
same thing, the product's glossary wins.

### 10.1 Owner home (`#ex1`, `ex1.html`, script section "1 · home")

Title "מה מחכה לך היום" with the date. Two columns at the desk.

- **The leak card.** Label "דליפה החודש" with the red dot and "מתחילת אוקטובר"; the hero number; beside it a
  small pace line (this month against the same days last month, drawn once on entry); under it one sentence
  that sets the scale ("1.8% מהקניות שנבדקו, מתוך ₪42,263 לפני מע״מ") and the change against last month in
  words; a split bar in two parts with a figure and a link under each ("על חשבוניות שעוד לא שולמו" →
  "לחשבוניות שלא שולמו"; "על חשבוניות ששולמו" → "לבקשות הזיכוי"); then "35 חשבוניות נבדקו, ב־13 מהן נמצא פער"
  and the disclosure **"איך הגענו לסכום?"**, which opens the calculation in place: one row per kind of gap
  with its count and amount, the total before rounding, what is counted and what is not, and a link to the
  full breakdown.
- **"מחכה לך"** (with the VAT basis beside the title): up to three tasks, each a dot, a title, a count line, an
  amount and one action. Only the first has the filled primary button ("להחלטה"); the rest are text links
  ("לתזכורות", "לשליחה"). "עוד משימה אחת" discloses the rest.
- **"הוחזר החודש"**: a calm green card with a tick and the amount in green.
- The system note in the top bar ("העיבוד מתעכב, אין צורך לפעול") is neutral (T4).
- On a phone: one column, the leak card first, the hero at 64 px.
- Entry motion: the number counts to its value within 400 ms, the pace line draws, the bar fills; once.

### 10.2 Approvals desk (`#ex2`, `ex2.html`, script section "2 · the decisions desk")

A queue on one side and the evidence of the selected gap on the other.

- **Queue:** grouped "חוסמים תשלום" and "אזהרות", each row a dot, the item, a sub-line, the amount. The head
  shows the count and the sum at risk, and updates after every decision.
- **Evidence:** the title of the gap with its pill; the **"הוזמן · התקבל · חויב"** table with the gap written
  out; a calculation line (quantity × price difference = amount); the document image with the line marked; and
  a fixed bar of decisions at the bottom: "בקשת זיכוי" (key 1) and "שלמו כפי שחויב" (key 2). Paying as billed
  asks for a reason first (a short row of reasons such as "המחיר עודכן בהסכמה", "סכום זניח").
- **Keys:** J and K move, 1 and 2 decide, Z undoes. They work when focus is in the queue, never while typing,
  and can be switched off (the single-key shortcuts preference); with them off the arrow keys still move.
- **After a decision:** the next gap comes in; a toast states what was done ("נוסף לבקשת הזיכוי", "שולם כפי
  שחויב") with "ביטול" and the ten-second line. A line under the buttons says what happens next ("אחרי ההחלטה
  עוברים לבא בתור, נשארו עוד 3").
- **Empty:** calm: the evidence panel reads "הכול מטופל" and the queue "אין פערים פתוחים".
- **Density:** regular and compact.
- Narrow screens show one gap at a time with arrows and the decision buttons at the bottom.
- Roles: the queue a person sees and may decide follows the product's approval rules; what waits for someone
  else is shown as waiting for whom. DS3 does not change who decides what.

### 10.3 Delivery check on a phone (`#ex3`, `ex3.html`, script section "3 · the delivery check on a phone")

- **The list:** one row per ordered item: the unit and ordered quantity, the name, and a large tick at the
  thumb's side. A tick means "arrived as ordered". A pencil opens the quantity sheet.
- **The quantity sheet:** rises from the bottom with the product's own number pad (keys 64 px), a decimal
  point, backspace, a −/+ stepper, the chip "פגום", and a plain statement when the number is far from the
  order ("יותר מפי 2 מההזמנה"). A row then says "חסר", "הגיע פגום" or the quantity. Saving returns focus to
  the row.
- **Primary button:** always states the next step and the count ("הכול הגיע כמו בהזמנה (7)", "סמנו את השאר
  (4)", "סגירת קבלת הסחורה"). The reference spells "הכל" in two places; the product spells "הכול".
- **Before closing:** a spot check appears only when there is something to check; then a summary: gaps, what
  was marked as ordered, whether the document was photographed ("צולם, ייקרא כשהחיבור יחזור").
- **Closing without a connection** is allowed; the end screen says the delivery will be sent when the
  connection returns.
- No ₪ anywhere. Six languages, one family.
- **Order of steps:** the proposal puts counting before the photo and opens the quantity field empty. Both are
  an owner decision that is still open: build them behind a flag that is off by default (see `WORKPLAN.md`).

### 10.4 The shell: side menu (`#ex4`, `tools` sections "the side menu")

`docs/ux/sidebar/SPEC.md` (owner-approved 31.10.2026) is binding in structure, sizes and behaviour; the
reference shows it in the clean finish. In short: 248 px open, 64 px collapsed; rows 32 px (28 px in a low
window); group headers with a glyph and a chevron; a folded group shows a 6 px dot only when it holds T2
money, never an amount, and counts never rise to a group; at most one solid pill; the current page's group is
always open; a fit rule folds the least recently opened group when the window is too low and says so politely;
collapsed, the menu is one tile per group with a 12 px name and a 240 px list beside it; a pin; favourites (a
star beside the page title, at most five); Ctrl or ⌘ with B, `[`, arrows, Home and End; dark tooltips on
icon-only controls. The clean look: the menu sits on the page canvas; labels in the secondary colour; the
current row is a white card with a 1 px border, a 2 px brand-coloured mark at its start edge, ink at weight
600 and the brand-coloured two-tone icon; group names in the tertiary colour. The flyout list is white, and
its current row is filled with the canvas colour.

Declared differences from that spec are look only: DS3's colours, the two-tone icons, 8 px corners, titles at
weight 600 where that spec has 700, and the wording "בקשות זיכוי". Everything `KNOWN-ISSUES.md` lists under "Side menu" is a defect of the mock-up, not a
change to the spec.

### 10.5 The shell: settings and the palette (`#ex4`, script section "4 · settings")

- **Layout:** a list of sections in two groups ("אני", "המסעדה"), the open section beside it, and a search
  field that finds any setting. Each section carries a scope chip: "במכשיר הזה", "אצלך, בכל מכשיר" or "לכל
  המסעדה".
- **Display (personal, acts at once, no save button):** density "רגיל / צפוף"; text size; the side menu; the
  switch "קיצורים בתו אחד". On a phone the settings that do nothing there are not shown.
- **Restaurant settings (save model):** each field shows whether it is at its default ("ברירת מחדל",
  "הותאם", "לא נשמר") and offers "חזרה לברירת המחדל"; a bar "יש שינויים שלא נשמרו · בטלו · שמרו"; after
  saving "נשמר לכל המסעדה, ונרשם בהיסטוריה · ביטול" for ten seconds; a history with who changed what and when
  ("dd.MM.yyyy · HH:mm") and "החזירו ערכים קודמים", which restores as an unsaved change.
- **Before saving a threshold** the screen says what the change would do, in conditional words, computed by
  the matching engine on the gaps that are open now, and always adds when a new threshold starts to act: on
  invoices checked from now on, including an open invoice when it is checked again. Saving itself re-checks
  nothing.
- **Ctrl K:** the palette also finds every setting and runs display commands (collapse the menu, density,
  text size, single-key shortcuts).

### 10.6 The component kit (`#kit`, `kit.html`)

Fifteen components, fourteen of them with the source they were learned from (`kit-sources.json`; the icons
have none): buttons and keys · money ·
change against a previous period · status · the three-way comparison in one line · tabs and filters · table ·
toast with undo · command palette · where the amount comes from · loading, empty, error · an answer from the
data · charts · icons · the track of a credit request. Most have a counterpart in `apps/web/lib/components`;
the work is adoption and restyling far more than building anew.
