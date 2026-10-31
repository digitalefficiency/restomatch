# Area review: Recipes / food cost per dish and inventory counts (`foodcost`)

**Reviewer:** UX review team, area `foodcost` · **Date:** 2026-10-25 · **Tree:** `main` @ `8fef118c` (lab worktree)
**Routes:** `/dashboard/recipes`, `/dashboard/recipes/new`, `/dashboard/recipes/[recipeId]`, `/dashboard/inventory`, `/dashboard/inventory/count`, `/dashboard/inventory/[countId]` (+ the owner-home `RecipesOverviewCard` and the chef's landing page, because they are the way into this area)
**Roles walked:** chef (phone first), owner (desktop first), manager (same rights as owner here), bookkeeper (no access, see FC-20)

## Scores against a world-class benchmark (meez, Galley, Apicbase, Restaurant365, Toast IQ Inventory, MarginEdge, WISK)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile (chef in the walk-in / kitchen) | **4 / 10** | The count saves every keystroke and never loses work, which is solid engineering. But it is a long desk form on a phone: the global nav stays, there's a per-row area dropdown, no walk navigation, no last-count reference and under one visible row at 375×667. The recipe editor hides cost and Save three screens down. |
| Desktop (owner / bookkeeper) | **4.5 / 10** | The actual food cost is honest and shows its formula, which is rare and good. But it is a one-shot number with no trend, drill-down or category split, and two contradicting stock values sit on one page. The dish table can't sort or filter, and the closed count is a flat 51-row receipt. |
| Functionality | **5 / 10** | The backend is strong: snapshot prices with an invoice source, theoretical vs POS, sub-recipes, what-if, CSV import, price alerts and owner-only audited amends. Missing are live costing, a count→order loop, waste, multi-unit counts, a chef hand-off, bookkeeper access and a recipe card a cook can use. |

**Pilot bar:** not met. There are 2 P0 trust issues (FC-01, FC-02) and several S1s on a primary flow (inventory count is on the rubric's escalator list).

---

## 1. Evidence base

### 1.1 Screenshots read (all 26 in the area list)
`shots/dashboard_recipes{,_new,_ID}__{owner,chef}__{desktop,phone}-he.png`, the `-en` desktop set, and `dashboard_inventory{,_ID,_count}__…`. Long captures were cut into readable segments under `review/crops/foodcost/`.

### 1.2 Extra captures I made (the crawl could not reach these states)
- **The live count screen was never captured.** The seeded lab has no open draft, so `/inventory/count` rendered only its empty state (crawl row: `h1: []`, height 1000). I ran `review/scripts/count-probe.cjs` against the local lab (:3320). It works as follows:
  1. Starts a draft as the chef.
  2. Measures at 390×844, 375×667 and 1440.
  3. Types `4,5` and `999` into the first two lines.
  4. Opens the owner's finish confirm.
  5. **Discards the draft.** Lines cascade-delete via the `inventory_count_lines_count_same_tenant_fk ON DELETE cascade` constraint. The only residue is one local `inventory.count_discarded` audit row.

  Output: `review/crops/foodcost/count/*.png`.
- **The recipes page tabs are client state, not in the URL,** so the crawl only saw "מנות". `review/scripts/recipes-tabs-probe.cjs` (read-only; the what-if is a query) captured all 5 tabs on desktop and phone. Output: `review/crops/foodcost/tabs/*.png`.

### 1.3 Probe measurements (count, chef, 390×844)

| Metric | Value |
|---|---|
| Lines | 52 in 5 areas (מקרר 17 · ירקות 12 · יבשים 10 · בר 5 · אחר 8) |
| Order within an area | Alphabetical |
| Document height | 6,073 px, about 7.2 screens |
| Qty input size | 44 px tall, about 80 px wide |
| Area `<select>` size | 44 × **122** px (wider than the qty field) |
| Interactive elements | 116, of which **111 are under 48 px** (field spec R-13). One is under 44 px |
| Fixed chrome at the bottom | Count bar of 81 px at y=691, plus the global nav of 53 px at y=791. **134 px**, with the sticky top header on top of that |
| Area header within the top 120 px at scrollY=1400 | **None**. Headers are `position: static` |
| `Enter` in a qty field | Focus stays (no handler) |
| `Tab` from a qty field | Goes to **the next row's area `<select>`**, not the next qty |
| 375×667 | The first qty input's top is at 464 px, so less than one row shows above the two bottom bars |
| Typing `999` for "ביצים L (תבנית 30)" | Line value becomes ₪33,966.00. "שווי עד עכשיו" jumps to ₪34,637 (a normal count is about ₪13k). An amber "בדוק" chip appears only after the server round-trip, and nothing stops you |
| Owner finish confirm | A 353 px panel. "כן, סיים" is disabled until the "accept uncounted" checkbox is ticked |
| Discard | **A native `window.confirm`**: "למחוק את הספירה הפתוחה? …" |

### 1.4 Crawl metrics for the area
- All routes return 200 with no console errors, no axe violations and `overflowX` = 0.
- Load times are 1.3–2.1 s.
- Small-target counts: 2–11 per page. Recipes desktop has 11.

### 1.5 Code read
- **Pages:** `apps/web/app/dashboard/recipes/{page,new/page,[recipeId]/page}.tsx`, `recipes-home.tsx`, `recipe-editor.tsx`, `recipe-ui.ts`, `price-alert.tsx`, `overview-card.tsx`, `inventory/{page,inventory-home,period-card,inventory-ui}.tsx`, `inventory/count/{page,count-screen}.tsx`, `inventory/[countId]/{page,count-actions}.tsx`.
- **Server:** `packages/api/src/routers/{inventory,recipes}.ts`, `packages/api/src/inventory/{data,valuation}.ts`, `packages/api/src/trpc.ts:147-156`, `apps/web/lib/roles.ts:74-77`.
- **Copy:** the i18n `recipes/he.ts` and `inventory/he.ts`.

---

## 2. What is genuinely good (keep it)
- **Count durability.**
  - Every keystroke is mirrored to `localStorage` per count, debounced 700 ms, and flushed on `visibilitychange` / `pagehide`.
  - Saves are ordered through one in-flight chain (`count-screen.tsx:110-163`).
  - Failed batches re-merge under newer edits (`mergeRetry`).

  This is better than Restaurant365, where a swipe loses the typed amount.
- **Blank is not zero** (`acceptUncounted`, `inventory.ts:433-436`), and the finish confirm lists the uncounted items by name.
- **Snapshot pricing with provenance.** Every counted line shows "₪149.00 לק״ג · חשבונית HK-24108, 19 באוק׳, קצביית הכרם". The owner recognises the price. That is excellent for H1 and H3.
- **Actual food cost is honest:**
  - It shows the equation (`period-card.tsx:179-187`).
  - It flags implausible results instead of alarming (`PLAUSIBLE_FOOD_COST_BP`).
  - It says "נפרד ממספר הדליפה".
  - It labels the first month "פוד קוסט רכש" instead of inventing an opening stock.
  - It has a coverage caveat.
- **Owner-only, audited amendment of a closed count** (`inventory.ts:476-505`).
- **Recipe engine:**
  - Sub-recipes with cycle protection.
  - A unit bridge ("כמה ביצים בתבנית").
  - Waste % on each line.
  - Menu price with or without VAT.
  - Month-start vs today drivers.
  - What-if.
  - POS theory vs actual with an implausibility guard.
  - Dish price alerts that name the supplier and the ingredient.

The problems below are almost all **presentation, flow and missing connective features**, not wrong math.

---

## 3. Primary tasks walked end to end

### T1 · Chef counts the walk-in on a phone (the core field flow)
| Step | Taps | What happens | Verdict |
|---|---|---|---|
| Log in | – | Lands on **"חדר הבקרה"** with the owner's ₪760 leak hero and view controls (`dashboard__chef__phone-he.png`) | ✗ D1 (FC-21) |
| Open the count | 1 | Bottom nav "ספירת מלאי". The first screen is the owner's actual food cost card with **restaurant sales ₪136,400** | ✗ (FC-01, FC-14) |
| Start | 1 | "התחלת ספירה" creates the draft, then the route changes | ✓ |
| First screen | – | Lab banner, title, a full-width **date input showing `10/25/2026`**, the area header, then 3 rows. Two bars cover the bottom 134 px | ✗ FC-03, FC-25 |
| Each item | 2 + typing | Tap the qty and type. `Enter` does nothing, so you tap the next qty yourself, scrolling as you go | ✗ FC-04 |
| A fat finger (999) | 0 | The value balloons to ₪34,637. The "בדוק" chip appears after the server round-trip, and its reason lives only in a `title` tooltip | ✗ FC-06 |
| Know where you are mid-list | – | No sticky area header and no chips | ✗ FC-04 |
| Finish | – | The chef **can't close**: "מנהל או בעלים סוגרים את הספירה. הכמויות שלך נשמרו." No hand-off and no notification | ✗ FC-07 (dead end) |

**Total for 52 lines:** about 106 taps plus about 7 screens of scrolling, and the flow ends in a dead end. The world-class target is about 52 numeric entries with `Enter` to advance, zero navigation taps, a jump chip per area, and one "שלח לסגירה".

### T2 · Owner closes the count and reads actual food cost (desktop)
| Step | Clicks | Verdict |
|---|---|---|
| Inventory home → "המשך ספירה" | 1 | ✓ |
| Scan the count on desktop | – | A single 1100 px-wide column of cards. The name sits about 1,000 px from its qty field and there's no keyboard flow (`count_owner_1440_viewport.png`) | ✗ FC-04, FC-26-like density |
| "סיים ספירה" → tick accept-uncounted → "כן, סיים" | 3 | The confirm is clear, but the 50 "uncounted" names it lists start with bar items that never enter food cost anyway | ~ |
| Done → "לעלות המזון של התקופה" | 1 | ✓ |
| Read the result | – | 26.6% · ₪36,245 · a run-on equation line at 12 px. The history row for the same count says **₪13,474** while the equation says **closing stock ₪9,490.66** | ✗ FC-02 (P0) |
| Ask "why is it 26.6%, what moved?" | ∞ | No trend, no category split and no drill. "לבדיקה מנה-מנה" goes to the generic recipes page | ✗ FC-18 |

### T3 · Chef costs a new dish on a phone
1. Recipes (1 tap), then scroll past the owner KPI, target, tiles and tabs.
2. "מנה חדשה" (1). Fill name, category and price.
3. For each ingredient: tap the combobox (1), type, tap a result (1), tap qty (1), type, and maybe set the unit `<select>` (1).
4. Scroll about 3 screens to **"שמירה"**. **No cost is shown until you save** ("החישוב יתעדכן אחרי שמירה").
5. To try 280 g instead of 300 g: edit, scroll to the bottom, Save, read. **Every experiment mutates the live recipe.**

Verdict: FC-10 and FC-11. The world-class version is meez/Galley live costing, with a sticky cost bar that updates per keystroke.

### T4 · Owner reacts to a dish price alert (desktop)
- In the dish table: a solid red "חצתה את יעד עלות המזון" chip, then "29.3% → 31.4%", then "+₪3.41 לכל צלחת", then "אנטריקוט +7.2% (₪139 → ₪149) אצל קצביית הכרם".
- There's **no action**:
  - no "reprice to ₪209 to stay at 30%"
  - no "check the contract or claim" link
  - no ₪/month impact
- The arrows read backwards in Hebrew (FC-16), and the ₪ sits on the wrong side (FC-17).

### T5 · Owner corrects a closed count line
- "תיקון" opens a **native `prompt`** for the quantity, then a second native `prompt` for the reason.
- A reason under 3 characters silently aborts.
- There's no ₪ preview of the change (FC-09).

---

## 4. Findings

Severity uses the task scale:
- **P0:** misleads a core number or trust.
- **P1:** major friction, or below the benchmark on a primary flow.
- **P2:** polish or secondary.
- **P3:** nit.

`humanPR` = the fix touches an immutable file or the schema (AGENTS.md).

### P0
**FC-01 · Anyone who counts can silently change the food-sales denominator, after close too, with no audit** (trust · inventory + recipes · both)
- **Observed:** `PeriodCard` shows "מכירות מזון (לפני מע״מ): ₪136,400 (הוזנו ידנית) · שינוי" to every role, the chef included (`dashboard_recipes__chef__phone-he.png`, segment 00).
- **Code:**
  - `setMeta` is `inventoryProcedure` = `chefProcedure` (`inventory.ts:382-408`). Its own comment says sales "may be set after completion too".
  - Unlike `amendLine` (owner-only plus `recordAudit`, `:476-505`), `setMeta` writes **no audit**.
  - The person whose KPI *is* food cost % can move its denominator, and the owner cannot see that it happened.
- **Fix:**
  - Split out `inventory.setSales` as a `managerProcedure` (later `financeProcedure`) with `recordAudit` (before/after/who).
  - Render "עודכן ע״י מנהל · 25.10 14:02" next to the figure.
  - For the chef, show the % and hide the sales ₪, or show them read-only.
  - Add the COVERAGE entry for the new procedure.

**FC-02 · Two different stock values for the same count on the same screen** (trust · `/dashboard/inventory` · both)
- **Observed:** on `dashboard_inventory__owner__desktop-he.png` the history row reads "24 באוק׳ · שווי מלאי ₪13,474". The equation above it reads "מלאי סגירה ₪9,490.66" for the same count.
- **Why:** the history row is the full count, bar and beverages included (`inventory.ts:161`). The equation uses food-only value (`foodEnd`, `:72-76`). The only hint is buried in `purchasesNote` at 12 px.
- **Precision:** also mixed, 0 dp next to 2 dp (B3c).
- **Fix:**
  - One vocabulary: "שווי מלאי מזון ₪9,490.66 · כולל בר ומשקאות ₪13,474.xx".
  - Show the same two labelled figures in history rows, in the count detail header and on the done screen.
  - Mark bar lines "לא נכנס לעלות המזון".
  - Use one precision per pairing.
- **Rubric:** A9 and B3 (S0: a visible total that doesn't match its visible counterpart).

### P1 · Count (field flow)
**FC-03 · The count is not in field mode; chrome eats the screen**
- **Observed (`count/count_chef_375_viewport_top.png`):**
  - The global nav stays.
  - The count bar is stacked above it (`count-screen.tsx:403`, `bottom-[calc(4.5rem+…)]`).
  - The title and a full-width date input fill the first screen.
  - At 375×667, less than one row is visible.
- **Fix:**
  - Set `data-mode="field"` on `/inventory/count` and hide `MobileNav`.
  - Use a sticky compact header: "× · ספירה 25.10 · מקרר 7/17 · ₪1,240".
  - Turn the date into a chip.
  - Make the bottom bar one row: a progress ring, "שווי ₪13,4xx" and a 56 px primary.
- **Rubric:** G1, G2.

**FC-04 · No "walk" navigation**
- **What's missing:**
  - Headers aren't sticky (the probe found none in view at scrollY=1400).
  - There's no area chip bar.
  - `Enter` is dead, and `Tab` lands on the next row's area `<select>`.
  - Lines are alphabetical within an area (`data.ts:182` orders by `canonicalName`).
  - "הוספת מוצר" sits after all 52 rows, and there's no "find a line in this count".
- **Fix:**
  - Sticky area header plus a horizontal chip bar with completion rings.
  - `onKeyDown` Enter/next moves focus to the next **uncounted** line, then to the next area.
  - A search field at the top that scrolls to a line and focuses it.
  - Shelf order learned once (an "edit layout" drag). A per-product sort column needs the schema, so humanPR.
- **Exemplars:** Restaurant365 storage locations + %, WISK shelves.
- **Rubric:** G9.

**FC-05 · A structural edit sits inside every row** (an area `<select>` 122 px wide, larger than the qty field)
- **Observed:** `count-screen.tsx:328-339`. One mis-tap silently moves an item to another area for every future count, because the next count copies the areas.
- **Fix:** remove the select from the row. Use "סידור אזורים" mode, or a ⋯ menu with "העבר ל…". A row is: name · last-count reference · 56 px qty · unit.
- **Rubric:** G1.

**FC-06 · The count has no memory and a weak fat-finger guard**
- **Observed:**
  - There is no "last time" reference. The server already loads `prevLines` and `received` (`inventory.ts:131-136`) but returns only a boolean `check`.
  - That check is over-count only, and arrives after the round-trip.
  - Its reason is in a `title` tooltip, and finish lists it in a `text-xs` line.
  - `999` trays became ₪33,966 with nothing stopping it (`count/count_chef_390_after_typing.png`).
- **Fix:**
  - Return `prevQty`, `prevUnit` and `receivedSince` per line.
  - Render "בפעם הקודמת 8 · התקבלו 6" muted. **Never prefill.**
  - Run an instant client-side guard: more than 2×, or under 50%, of (previous + received), or a line value over ₪2,000. It opens an inline confirm, "999 תבניות = ₪33,966 — נכון?", with [נכון, השאר] [תקן].
  - Finish stays blocked until every flag is resolved.
- **Exemplar:** the R365 variance flag.
- **Rubric:** G9, H1.

**FC-07 · Chef dead end: counts, can't close, can't hand off**
- **Observed:** `count-screen.tsx:464-471`; `CLOSERS` = owner and manager (`inventory.ts:87`). The bar text is the end of the road. The owner has no Needs-you item.
- **Fix:**
  - A chef primary, "סיימתי · שלח לסגירה". It notifies, and adds "ספירה מוכנה לסגירה · 50/52 · ₪13.4k" to the manager/owner home.
  - The owner then closes in one tap from a summary.
  - A `submitted` status needs the 0070 CHECK and a migration, so **humanPR**. A notification-only interim is not.

**FC-08 · Offline and failed saves are near-silent; Finish can do nothing**
- **Observed:**
  - `if (await flush()) complete.mutate(…)` (`:452-454`). If the flush fails, the tap does nothing beyond a 12 px status word.
  - There's no queue chip.
- **Fix:**
  - A persistent T4 chip: "↑ 3 ממתינים · נשמר במכשיר".
  - On Finish while unsynced, show an inline reason plus "נסה שוב".
  - Move to the shared IndexedDB outbox (FG-16).
- **Rubric:** G7.

**FC-09 · Native dialogs on destructive and money edits; the chef can discard a whole count**
- **Observed:** discard uses `window.confirm` (`count-screen.tsx:394`). Amend uses two `window.prompt`s (`count-actions.tsx:69,74`). `discard` is `chefProcedure` (`inventory.ts:540`).
- **Fix:**
  - A ConfirmDialog naming the scope: "למחוק ספירה 25.10 עם 37 כמויות?". Or limit discard to the starter or manager+, or soft-delete with a 10 s undo.
  - Amend as a bottom sheet: decimal qty, reason chips, and a ₪ preview "₪1,415.50 → ₪1,266.50".
- **Rubric:** C10, G1.

### P1 · Recipes
**FC-10 · No live costing; experiments mutate the live recipe**
- **Observed:** `update()` clears line costs (`recipe-editor.tsx:176`). The aside shows the saved values plus "החישוב יתעדכן אחרי שמירה". A new dish shows no cost at all (`dashboard_recipes_new__owner__desktop-he.png`).
- **Fix:**
  - Add `recipes.preview`, the same `costRecipes` with no write.
  - Debounce it at 250 ms and stream live line ₪, total, food %, margin and the gap to target.
  - Add a share-of-plate bar per ingredient.
  - Save becomes an explicit commit, with an unsaved-changes guard.
- **Exemplars:** meez, Galley.

**FC-11 · On a phone, cost and Save are three screens down, after "הערות"**
- **Observed:** the `lg:` grid only (`recipe-editor.tsx:194,341`); `dashboard_recipes_ID__chef__phone-he` segments 02–03.
- **Fix:** below `lg`, a sticky bottom bar: "עלות ₪52.89 · 31.4% (יעד 30%) · רווח ₪115.75 · [שמירה]". It is coloured by tier and tapping expands it.
- **Rubric:** G10.

**FC-12 · The ingredient combobox can't be used by keyboard**
- **Observed:**
  - No arrow, Enter or `aria-activedescendant` handling.
  - Options are buttons. Tabbing to one blurs the input, the list unmounts after 150 ms and focus is lost (`recipe-editor.tsx:494-572`).
- **Fix:** follow the ARIA combobox pattern (Headless UI or Ariakit). After a pick, focus the new line's qty.
- **Rubric:** F8.

**FC-13 · The dish table on a phone hides gross margin off-screen**
- **Observed:** a 5-column table in an `overflow-x-auto` card. The margin column is out of view with no affordance, and names wrap to 3 lines (`dashboard_recipes__owner__phone-he` segment 01).
- **Fix:** an `md:hidden` card per dish:
  - line 1: name, with the food-cost % at the end (24 px)
  - line 2: "עלות ₪37.96 · מחיר ₪138 · רווח ₪78.99"
  - the alert as a T2 strip
- **Rubric:** C3, A8.

**FC-14 · Recipes page hierarchy: an owner KPI first, no T1, and an unweighted average shown as a peer of the actual**
- **Observed:**
  - Order on the page: PeriodCard (26.6%, with sales), then the target card, then 4 tiles, then tabs. Dishes start about 910 px down on desktop and about 1.4 screens down on a phone.
  - "עלות מזון ממוצעת 24.9%" is a simple mean of dish % (`recipes-home.tsx:145`), shown in green next to the actual 26.6%.
- **Fix:**
  - Branch by role. Chef and manager open on "מנות שדורשות טיפול", then the list.
  - The owner gets one hero line: "בפועל 26.6% · תאורטי 24.9% (ממוצע תפריט, לא משוקלל) · יעד 30% (שינוי)". The target is merged into it.
  - Use a sales-weighted theoretical figure when POS data exists.
- **Rubric:** A1, A9, D1.

**FC-15 · "עלות מזון בפועל" names two different calculations**
- **Observed:** the POS tab tile `pos.actual` (theoretical cost of the dishes sold ÷ POS net sales) has the same label as the count-based actual (`recipes/he.ts:192` vs `inventory/he.ts:85`).
- **Fix:** a glossary:
  - "בפועל" is count-based only.
  - The POS tab tile becomes "עלות תאורטית לפי מכירות".
  - The average becomes "ממוצע תפריט (לא משוקלל)".
  - Each gets a formula tooltip.
- **Rubric:** A9, E9.

**FC-16 · Price moves read backwards in Hebrew; there are two conventions**
- **Observed:**
  - A local `Arrow` renders a forced-LTR "old → new" in the list alert, the editor banner, changes, what-if and the home card (`recipes-home.tsx:198`, `price-alert.tsx:16`, `overview-card.tsx:78,82`).
  - A Hebrew reader meets the new value first, and the arrow points back.
  - `he.ts` itself uses "←" (`changes.driverProduct`, `impact.headline`).
- **Evidence:** `tabs/z_changes_row.png`, where "149.00 ₪ → 139.00 ₪" reads as a drop.
- **Fix:** one `<PriceMove from to>` (R-4): old at the start, then a `←` DirIcon, then new, with the old value struck through.
- **Rubric:** E5.

**FC-17 · ₪ on the wrong side and concatenated signs**
- **Observed:** a `dir="ltr"` wrapper puts ₪ to the right of the digits:
  - "3.41₪" (`z_alert_zoom.png`)
  - "34,637₪" and "670.50₪" (count)
  - "13,474₪" and "1,415.50₪" (closed count)

  Signs are built as "+"+ils (`recipe-ui.ts:21-26`, `price-alert.tsx:73,80`). The what-if row glues "6.09₪31.4%" together (`z_impact_row.png`).
- **Fix:**
  - Use `<Money>`, a plain `<bdi>`.
  - Signed deltas need `formatIls` `signDisplay`, a **human PR** to money-format-marshal. Until then, use a word chip ("עלייה ₪3.41").
  - Replace `ms-3` on the `bdi` with flex `gap`.
- **Rubric:** E4.

### P1 · Owner, bookkeeper and IA
**FC-18 · Actual food cost has no trend, no breakdown and no drill-down**
- **Observed:**
  - A single number plus a 12 px equation.
  - History shows date and ₪ only.
  - "לבדיקה מנה-מנה" goes to the generic recipes page.
- **Fix:** a food-cost workspace (Big move 3):
  - Periods on a sparkline of actual vs target vs theoretical.
  - A clickable equation: purchases go to invoices, credits to claims, closing to the count.
  - A category split with the change vs the previous period.
- **Rubric:** A2, H3, D6.

**FC-19 · The closed count is a flat receipt, not a review tool**
- **Observed:**
  - No header row, no area subtotals and no change vs the previous count.
  - Uncounted lines are hidden (`[countId]/page.tsx:53`).
  - Bar items are unmarked.
  - There's a "תיקון" button on all 51 rows, plus an 11 px source line.
- **Fix:**
  - A data table: item | area | qty | unit cost | value | Δ qty / Δ₪ vs previous count | source (peek).
  - Area subtotal rows.
  - Chips: "שינוי חריג", "לא נספר (2)", "בלי מחיר".
  - Sort by |Δ₪|. Amend from a row menu.
- **Rubric:** C1, B4, A4.

**FC-20 · The bookkeeper can't open inventory, yet the CSV is labelled "לרואה החשבון"**
- **Observed:** `roles.ts:75-77`; `chefProcedure` excludes the bookkeeper.
- **Fix:**
  - Give the bookkeeper read-only access to `history`, `get`, `period` and `exportCsv`.
  - Add closing stock to the accountant pack (FG-38).
  - This needs a warden review and COVERAGE entries.
- **Rubric:** D7.

**FC-21 · The chef lands on the owner's control room** (cross-area)
- **Observed:** `dashboard/page.tsx` has no chef branch. The chef's first view is "דלף החודש ₪760" with view controls. The chef's bottom nav spends a slot on "הגדרות".
- **Fix:**
  - A chef home, "המטבח": continue the count (5/52), dishes that crossed target, price rises on the chef's ingredients, and a waste log.
  - Bottom nav: מטבח · ספירה · מנות · הזמנה · עוד.
- **Rubric:** D1, D3.

**FC-22 · No designed loading or error states**
- **Observed:**
  - There's no `loading.tsx` or `error.tsx` under recipes or inventory (only exports, receiving, approvals, settings and suppliers have loading files).
  - `ChangesTab` returns `null` on error (`recipes-home.tsx:336`).
  - Load-time `role="alert"` is used in history and period errors.
- **Fix:**
  - Layout-true skeletons.
  - A segment `error.tsx` with "נסה שוב".
  - A retry branch in each tab.
- **Rubric:** C8, I4, F7.

### P2
- **FC-23 · No multi-unit counting.** One unit per product (`inventory.ts:311`). You can't count "2 ארגזים + 5 יח׳" or part of a keg.
  - Fix: count units per product, auto-summed ("= 53 יח׳"), with a keypad that accepts `2*24+5`.
  - Schema, so **humanPR**. G9, FG-35.
- **FC-24 · Field spec misses on the count:**
  - qty inputs are 44 px (spec 48/56)
  - 111 of 116 controls are under 48 px
  - the price source is `text-[11px]` subtle, truncated and bidi-garbled ("HK-24108, 19 חשבונית …")
  - units are `text-xs` and truncated at `w-10`
  - area headers are 14 px muted
  - progress uses `transition-all`

  G3, B1, I5.
- **FC-25 · The count date is a native `10/25/2026` (MM/DD) input on the first screen,** and changing it re-prices the whole count.
  - Fix: a chip, "תאריך: היום, 25.10.2026 · שינוי", that opens a he-IL date sheet with consequence copy. E8.
- **FC-26 · The recipe editor is not built for desktop.**
  - Each ingredient is a 130 px card, so 5 ingredients fill the screen.
  - There's no share-of-plate figure. The entrecôte is 96% of ₪52.89 and nothing says so.
  - Rows move with ↑/↓ icons.
  - The H1 is the generic "עריכת מתכון".
  - Fix: a dense grid with drag, the H1 set to the dish name, and inline add. B6, D5.
- **FC-27 · Inconsistent inputs and validation:**
  - waste % and target are `type="number"`
  - the menu price rejects "68,50" while the count accepts "2,5"
  - an invalid price shows only a red border and silently disables Save
  - Save is disabled until there's a name
  - there's no ₪ adornment
  - delete sits under Save with `window.confirm`
  - there's no unsaved-changes guard

  C5, C6, C7, C10, C12.
- **FC-28 · Tier noise:**
  - The "מנות מעל היעד 2" tile is danger-red while both dishes are amber.
  - A solid-red "crossed" chip sits on a row whose pill is amber.
  - The tiles are in JetBrains Mono (`StatCard.tsx:52`).

  A5, A7, B2.
- **FC-29 · Tab problems:**
  - Tabs aren't in the URL.
  - "תיאורטי מול בפועל" and "ייבוא" are clipped on a phone (382 > 358 px).
  - The POS tab has an empty state with no CTA.
  - What-if results land under the fold.

  D8, C8.
- **FC-30 · Changes and what-if lack ₪ impact:**
  - Changes are shown per plate only; the `changes.monthlyImpact` string is unused.
  - What-if has no ₪/month, no "crosses target" flag and no suggested menu price.
  - The product list includes non-food items ("אקונומיקה 4 ל׳").
  - Search plus a select is a two-step choice.
  - "1 מנות" is a grammar bug.

  A5, E9.
- **FC-31 · Recipe changes aren't audited.** There's no `recordAudit` in `recipes.ts`, and no version history of cost, price or target. H7.
- **FC-32 · No usable kitchen recipe card.** No method, photo, allergens, plating or batch scaling. Schema, so humanPR.
- **FC-33 · No waste log.** "שימוש לא מוסבר" can only be explained in prose (FG-34). Schema, so humanPR.
- **FC-34 · The desktop dish table has no sort, filter or category grouping.**
  - The food-cost % is the smallest element on the row.
  - Numbers are `text-end`, which is physical left in RTL (R-1).

  C1, B4.

### P3
- **FC-35 · English and i18n leaks:**
  - raw Hebrew units in the English count and detail ("9.5 ק״ג", "₪149.00 per ק״ג")
  - "Correct" is ambiguous as the amend label
  - Hebrew category names show in English
  - a 🎉 emoji in `changes.empty`

---

## 5. Big moves (benchmark-grade)

### BM-1 · "Walk the shelf": a count that is a field instrument (mobile, chef) · L
- **Model:** Restaurant365 mobile counts (locations in shelf order, % per location, qty per unit, variance flag), Toast IQ (who counted what, offline), WISK shelves and CrunchTime area claim.
- **Design:**
  1. **Full-screen focus mode:**
     - No global nav, and "×" at the top start.
     - A sticky header: area name · 7/17 · ₪1,240.
     - A horizontal **chip bar of areas** with completion rings and avatars of whoever claimed each area.
  2. **Compact rows, one decision each:**
     - The name in 17 px semibold.
     - A muted reference: "בפעם הקודמת 8 · התקבלו 6 מאז".
     - A **56 px numeric field** (24 px bold) and the unit.
     - Optional ± steppers for countables.
     - **Enter / Next jumps to the next uncounted line**, then to the next area.
  3. **Multi-unit lines:** "ארגז ×24 [2] + יח׳ [5] = 53". The keypad accepts `2*24+5`.
  4. **An instant plausibility guard:** an inline sheet "999 תבניות = ₪33,966?" with [נכון] [תקן]. Finish requires every flag resolved.
  5. **A search-to-jump field and a barcode button** (BarcodeDetector) at the top.
  6. **An offline outbox chip:** "↑ 3 ממתינים". Never lose an entry. Finish explains why it can't send.
  7. **Hand-off:** the chef's primary is "סיימתי · שלח לסגירה". The manager gets a Needs-you card and closes from a one-screen summary: Δ vs last count, flagged lines and uncounted lines.
- **Data that already exists:** `prevLines`, `receivedBetween`, `priceSource`, and the per-count localStorage mirror.
- **New (humanPR):** shelf order, count units, a `submitted` status and area claims.

### BM-2 · Live recipe workbench and kitchen card (desktop split + mobile sticky cost) · L
- **Model:** meez (recipe as the kitchen's source of truth, live costing, scaling), Galley (AP/EP yields, live cost), Apicbase (profit alerts).
- **Desktop:**
  - A split view. On the start side, a dense ingredient grid (qty · unit · פחת · ₪/unit · line ₪ · a **share-of-plate bar**).
  - On the end side, a sticky cost panel that updates on every keystroke through `recipes.preview`: plate cost, food %, margin, gap to target, and a "suggested menu price for 30%" button.
- **Sandbox mode:** "נסה בלי לשמור" forks a what-if of this dish (swap the supplier, change the portion) and shows the before/after; "החל" commits it.
- **Version timeline:** who changed what (audited) plus a plate-cost sparkline driven by supplier prices.
- **Kitchen card tab:**
  - method, photo, allergens, plating
  - batch scaling ("×3 for Friday")
  - a tablet/print view for the line
- **Mobile:** the same cost bar is sticky at the bottom. Ingredients are added by voice or search with the qty keypad focused immediately.

### BM-3 · Food-cost control room for the owner and bookkeeper (desktop) · L
- **Model:** R365 Actual vs Theoretical, MarginEdge controllable P&L, Craftable variance, Pigment variance drivers, and the menu-engineering matrix (Kasavana–Smith).
- **One T1:** "עלות מזון בפועל 26.6% · יעד 30% · ▼0.8 נק׳ מול התקופה הקודמת". It has a period sparkline (actual, theoretical and target lines) and a scope line ("ספירות 30.9–24.10 · 37 חשבוניות").
- **A clickable equation**, where each term opens the list that sums to it:
  - opening (count)
  - purchases (invoices by receipt date)
  - credits (claims)
  - closing (count)
- **A variance bridge:** the theoretical ₪ moving to the actual ₪ through the top 10 items by unexplained usage in ₪ (count usage minus recipe usage × sold). Each row links to its count lines, invoices and recipes.
- **A category split** (meat, fish, produce, dairy, dry) with the change vs the previous period.
- **A menu-engineering quadrant** (popularity × margin) when POS data is on, with "reprice / re-portion / feature" verbs.
- **For the bookkeeper:**
  - a read-only mode
  - closing stock pushed into the month-close checklist and accountant pack (FG-38)

### BM-4 · Price → plate radar with one-tap responses (desktop + phone) · M
- **Model:** xtraCHEF Price Tracker (% and $ impact), Ramp Price Intelligence (materiality).
- **The chain:** connect the supplier price move to the dishes affected, then the ₪ per plate, then **₪/month at current volume** (POS, or covers labelled "הערכה").
- **Materiality rule:** T2 only when it is ≥3% and ≥₪50/month (A5). Otherwise it is a T4 digest line.
- **Each alert carries exactly one primary**, picked by cause:
  - Above contract: "פתח דרישה לזיכוי מקצביית הכרם · ₪212".
  - Market move with an alternative supplier: "השווה ספקים".
  - Otherwise: "עדכן מחיר תפריט ל-₪209 (שומר על 30%)".
- **Prices** are rendered with `<PriceMove>` (old ← new) and `<Money>`.

### BM-5 · Kitchen home and the count → order → waste loop (chef, mobile) · M (par is humanPR and needs an ICP check)
- **Model:** the Apicbase mobile home (Count · Waste · Receive), R365 "Autofill to Par", Lightspeed draft orders from par.
- **The chef's landing tiles:**
  - continue the count
  - dishes that crossed target
  - supplier cut-offs today
  - a 3-tap waste log (item · qty · reason · photo)
- **After a count closes:** "הזמנה מוצעת" per supplier = par − on hand − in transit, in **the same shelf order**, sent to `orders/new` for manager approval.
- **Waste entries** feed the variance bridge in BM-3, so unexplained usage shrinks to a number the owner believes.

---

## 6. Rubric scorecard (Pass / Partial / Fail)

| Criterion | Recipes list | Editor | Inventory home | Count | Closed count |
|---|---|---|---|---|---|
| A1 one T1 + one action | Fail (no T1; 3 competing %) | Partial | Partial | n/a | Partial |
| A9 one number, one name | Fail (FC-15) | – | **Fail (FC-02)** | Partial | Fail |
| B2 money in Heebo | Fail (StatCard mono) | Pass | Pass | Pass | Pass |
| B3 precision | Pass | Pass | Fail (0 dp vs 2 dp) | Partial | Pass |
| C1 sortable tables | Fail | – | – | – | Fail |
| C3 cards on phones | Fail | Partial | Pass | Pass | Partial |
| C6/C7 inputs and validation | Fail | Fail | Partial | Pass (`inputMode`, comma) | Fail (prompt) |
| C8 loading/error | Fail | Fail | Partial | Partial | Fail |
| C10 confirm/undo | – | Fail | – | Fail | Fail |
| D1 role landing | – | – | – | – | – (chef: Fail, FC-21) |
| D5 H1 and way up | Pass | Partial (generic H1) | Pass | Fail (empty state has no h1) | Pass |
| D8 state in URL | Fail (tabs) | Pass | Pass | Pass | Pass |
| E4 ₪ side and signs | Fail | Pass | Fail | Fail | Fail |
| E5 price-move order | Fail | Fail | – | – | – |
| E8 dates | Partial | – | Pass | Fail (MM/DD input) | Pass |
| F7 live regions | Fail (load-time alert) | Fail | Partial | Pass | Pass |
| F8 keyboard | Pass | **Fail (combobox)** | Pass | Partial (no Enter flow) | Pass |
| G1 field mode | – | – | – | **Fail** | – |
| G2 thumb-zone primary | – | Fail (Save at the bottom of the doc) | Pass | Partial (44 px, above nav) | – |
| G3 gloves/sun | – | – | – | Fail (11 px, 44 px) | – |
| G7 offline | – | – | – | Partial (local mirror, no queue) | – |
| G9 count follows the walk | – | – | – | **Fail** | – |
| G10 sticky key number | – | **Fail** | – | Pass (₪ in bar) | – |
| H1 flags explain themselves | Partial (alert explains its cause, no action) | Partial | Pass (formula) | Fail ("בדוק" reason in tooltip) | Pass (price source) |
| H3 provable | – | – | Pass (formula), Fail (no drill) | – | Pass |
| H7 history | – | Fail (no audit) | Fail (`setMeta` unaudited) | – | Pass (amend audited) |

## 7. Governance notes
- **humanPR (immutable or schema):**
  - FC-07 `submitted` status (0070 CHECK)
  - FC-17 `signDisplay` in `formatIls`
  - FC-23 count units
  - FC-04 shelf-order column
  - FC-32 recipe card fields
  - FC-33 waste table
  - BM-5 par
- **Not immutable (web-feature-engineer / rtl-design-steward):**
  - FC-01 (`inventory.setSales` with audit; add a COVERAGE entry in `cross-tenant.attack.test.ts`, adding only)
  - FC-10 (`recipes.preview`, plus a COVERAGE entry)
  - FC-20 (bookkeeper read access: tenant-security-warden review)
  - the rest are UI-only
- **Lab residue from my probe:** one discarded draft count. Its lines were cascade-deleted, leaving one `inventory.count_discarded` audit row in the **local** lab DB `restomatch_ux`. Nothing was written to any repo file.
