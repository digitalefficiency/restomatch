# RestoMatch UI/UX review rubric, v1

**Date:** 2026-10-25 · **Owner:** design director, UX review team
**Built from:** `fintech.md` [fin], `systems.md` [sys], `restaurant.md` [rest], `rtl.md` [rtl] and `ainative.md` [ai], with `ia-map.md` [ia] for group D. Read alongside `AGENTS.md` §Design vocabulary, `packages/ui-tokens/src/index.ts` and `apps/web/app/globals.css`.
**Size:** 90 criteria in 10 groups (A 9 · B 9 · C 14 · D 9 · E 10 · F 10 · G 10 · H 8 · I 7 · J 4).

The North Star decides every close call: **≥1.5% of food spend shown as leak, in ₪, that one owner believes.** If a criterion and a page disagree, ask which choice makes that number clearer, more believable or quicker to act on.

> "Baseline" figures (counts, file:line) were measured by the researchers on the 2026-10-25 working tree. Re-measure before quoting them in a finding. Claims the research marked **[K]** (knowledge, not verified live) are still marked [K] here.

---

## 0. How to use this rubric

### 0.1 Per-page review procedure
1. **Classify the page** into one or more archetypes (§0.3). The matrix there tells you which groups apply.
2. **Capture screenshots:**
   - Every page: `he` at 390×844 and 1280×800, and `en` at 1280×800.
   - Field routes: also `he` at 375×667 with `hasTouch`.
   - States: data, empty (new tenant), loading (throttled to slow 3G), error (forced failure), and long or hostile data (bidi-torture tenant: `Coca-Cola Ltd.`, `Heinz קטשופ 2 ק״ג`, `SKU-88`, `INV-2026/045`, a 60-character Hebrew name, negative credits).
   - One pass with `prefers-reduced-motion: reduce` emulated.
3. **Check the code** with the checks listed under each criterion and the grep pack (Appendix).
4. **Score** each applicable criterion **Pass / Partial / Fail / N/A**. N/A needs a reason.
5. **Log every Partial or Fail** with the finding template (§0.6). One finding = one criterion; reference others by ID.
6. **Run the a11y protocol once per page:**
   - axe-core with `wcag22aa` tags, in `he` and `en`.
   - Keyboard-only pass.
   - 200% zoom and 320 px reflow.
   - NVDA + Chrome for desk pages; VoiceOver + iOS Safari (Hebrew voice) for field pages.

### 0.2 Severity scale
| Level | Meaning | Examples |
|---|---|---|
| **S0 Blocker** | Shows a wrong or misleading ₪, loses user data, takes an irreversible money action without warning, blocks a primary task, or breaks a legal accessibility obligation | ₪0 shown for "no data"; a total that doesn't equal its rows; a block item that can be bulk-approved; a lost count entry; no accessibility statement |
| **S1 Major** | Breaks the T1–T4 hierarchy, fails a WCAG 2.2 AA success criterion, adds real friction to a primary flow, or erodes trust in the number | Two competing T1s; a focus ring under 3:1; a receiver landing on the owner hero; a flag with no "why" |
| **S2 Minor** | Departs from the system (tokens, type, spacing, patterns) in a way a careful owner would notice, or adds friction to a secondary flow | Off-scale font size; hex colour; inconsistent wayfinding |
| **S3 Polish** | Craft detail; batch these | Icon optical alignment; unbalanced heading wrap |

**Escalator:** raise one level when the issue sits on a **primary flow**: owner home, approvals and pay-run, invoice detail, receiving, inventory count, claims, or any client-facing artifact (supplier portal, claim letter, demo). Each criterion's severity guide already assumes the typical case.

**Bars:**
- **Pilot bar:** 0 S0 anywhere, and 0 S1 on primary flows.
- **World-class bar:** 0 S0 and 0 S1; every applicable criterion passes or has a justified N/A; at most 3 S2 per page.

### 0.3 Archetypes and applicability
Archetypes, with examples:
- **Overview:** `/dashboard`, `leaks`, `chain`, `recovery`, `branches`.
- **Queue:** `approvals`, `approvals/pay-run`, `inbox`, `catalog/mapping`, `leaks/claims`, contract alerts.
- **Detail:** `invoices/[invoiceId]`, `scans/[id]`, `orders/[poId]`, `suppliers/[id]`, `products/[id]`, `recipes/[id]`.
- **List:** `suppliers`, `suppliers/ledger`, `catalog`, `orders`, `inventory`, `recipes`, `exports`.
- **Form:** `onboarding`, `orders/new`, `catalog/import`, `contracts/import`, `settings`, `team`, login/2FA/set-password/invite.
- **Field:** `receiving`, `receiving/[poId]` and dock slip, `inventory/count`, `orders/capture`, `showcase/receiver`.
- **Report:** `reports/monthly`, `reports/digest`, `leaks/proof`, `leaks/report`, `leaks/breakdown`, the leak card, PDFs, OG images.
- **Public:** `/`, `pricing`, `about`, `leak-check`, `showcase`, `/s/[token]`, `/accessibility`.

● = review it · ○ = review it where the pattern appears · – = N/A

| Group | Overview | Queue | Detail | List | Form | Field | Report | Public |
|---|---|---|---|---|---|---|---|---|
| A ₪ story | ● | ● | ○ | ○ | – | ○ | ● | ○ |
| B Layout/type | ● | ● | ● | ● | ● | ● | ● | ● |
| C Components | ○ | ● | ● | ● | ● | ● | ○ | ● |
| D Navigation/IA | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| E RTL/copy | ● | ● | ● | ● | ● | ● | ● | ● |
| F Accessibility | ● | ● | ● | ● | ● | ● | ● | ● |
| G Field/mobile | ○ | ○ | ○ | ○ | ○ | ● | – | ○ |
| H Trust | ● | ● | ● | ○ | ○ | ○ | ● | ○ |
| I Speed | ● | ● | ● | ● | ● | ● | ○ | ● |
| J Polish | ● | ○ | ○ | ○ | ● | ○ | ● | ● |

### 0.4 Resolved conflicts: decisions this rubric enforces
The research reports disagreed in places. Reviewers score against these resolutions. Items marked **owner** still need a human decision; until then, enforce the default shown.

| # | Decision | Basis |
|---|---|---|
| R-1 | Numeric and money columns align **physically right in both locales**, so place values line up. ₪ goes in the column header. **Owner:** confirm with 3 Hebrew-reading users (bookkeeper first). | [sys P4] and [rtl P9, rendered lab 2] win over [fin §4.6] "`end`" |
| R-2 | Money in **Heebo with tabular figures**. JetBrains Mono for identifiers only. | Heebo digits measured equal-width; the JetBrains subset has no ₪ glyph [sys P1, rtl F11] |
| R-3 | Chart time runs **left = oldest to right = newest** in both locales. Only the chrome mirrors. | [rtl P8]: Apple and M2 agree; the code is split today |
| R-4 | Price moves in Hebrew read **old ← new**, rendered by one component. | [rtl P11]; matches the existing `he.ts` strings |
| R-5 | One `--c-focus` token: 2 px ring, 2 px offset, ≥3:1 against every adjacent surface. Recommended value #1A5BC7 (6.24:1 on white, distinct from money-green semantics). #066B4A also passes. `rtl-design-steward` picks once; reviewers check the token and the ratio, not the hue. | [sys P10] vs [rtl P20] |
| R-6 | Toasts: 5 s without an action. With an action (Undo): at least 10 s, and never gone before the user's next action. Pause on hover or focus. **Errors never auto-dismiss.** At most 3 stacked. | [sys P23] Polaris values; [ai P8]; [rtl PT10] (6 s) unified |
| R-7 | **Undo window = 10 s everywhere**: queues, field discard, deferred supplier send. | Unifies [fin] 8 s, [rest] 8 s and [ai] 10 s |
| R-8 | **Reversible** → optimistic, plus Undo. **Outbound to a supplier** → preview, then deferred send with "בטל שליחה". **Money write-off or data deletion** → ConfirmDialog that names the ₪ and the party. | [fin P13], [ai P8], [sys P20] |
| R-9 | Queue keys: `1/2/3` (primary/dispute/defer), `J/K`, `X`, `Z`, `Enter` (peek), `O` (open), `?`. Bound via `KeyboardEvent.code`, and active only while the list has focus (WCAG 2.1.4). | [ai P4–P5] over the [fin P14] letter map |
| R-10 | Motion tokens are 100/150/240/400 ms. A row exit uses 150 ms. | [sys P24]; unifies [fin] 180 ms and [ai] 160 ms |
| R-11 | Confidence appears **only** on OCR or fuzzy inputs below `ocrReviewThreshold`, with at most 1 marker per card. No confidence dots on every field. | [ai P16] over [fin PT8] |
| R-12 | `block` items are never bulk-approvable. The per-item bulk cap defaults to ₪200. **Owner:** confirm the cap. | [ai P11] + [fin P12] |
| R-13 | Field spec: 48 px minimum target; 56 px for primary CTAs and steppers; 14 px text floor; inputs at 16 px. The desk floor is 12 px. | [rest §6], [rtl P21] |
| R-14 | The hero context line shows the leak as a % of food spend, with its base ("1.8% מההוצאה על מזון · ₪46,210"). **Owner:** whether to show 1.5% as an owner-facing "יעד" (it can read as "leak is the goal"). Default: no target. | Director call on [fin PT1] / [rtl PT1] |
| R-15 | Hero size token `metric-hero` = 56/60 px desktop, 40/44 px mobile. | [sys P2]; [fin]'s 56 px on mobile is the upper bound |

### 0.5 Governance guardrails (AGENTS.md)
- **`formatIls()` and the agorot↔display boundary are immutable.** `signDisplay` and any new option go through a human PR (`money-format-marshal`). Agents may only **wrap** the util (`<Money>`) and must not change its output.
- **`TOTAL_TOLERANCE_ILS`, `tolerances.ts` and `approvals/engine.ts`:** UI reads these values and never redefines them. "The rule is wrong" files a proposal.
- **`notifications/outbox.ts` and `apps/worker/src/cron.ts`:** interruption levels, quiet hours and seen-suppression routing are **proposals**. Templates and the preferences UI are in scope.
- **Schema and migrations** (for example a `seen_at` column) and **CI workflows** are human-only. `test-sentinel` writes the tests; a human adds the gate step.
- **Fix owners:**
  - Tokens and visual ₪ rendering: `rtl-design-steward`.
  - The money util: `money-format-marshal`.
  - Dashboard pages and routers: `web-feature-engineer`.
  - Marketing, leak-check and the accessibility page: `growth-pmm-engineer`.
  - Receiving, OCR and capture: `ocr-procurement-engineer`.
  - Charts SQL: `matching-engine-guardian`.
  - Lint, e2e and gates: `test-sentinel`.

### 0.6 Finding template
```
[<criterion id>] <S0–S3> · <route> · <role> · <viewport/locale>
Observed:   what is on screen / in code (one or two sentences)
Evidence:   <file:line> + <screenshot path, crop box>
Rule:       the one line of the criterion that is broken
Fix:        concrete change — component, token, copy (he), size
Owner:      <agent>   Immutable touch: no | proposal → <file>
```

---

## The 10 most important rules (read these first)

1. **One T1 hero, one action, an honest comparison** (A1, A2). Each page gets one T1 ₪, one primary CTA, a like-for-like delta on by default (month-to-date vs the same days last month), and a "42 invoices checked · 3 pending" completeness line.
2. **One number, one name, one precision** (A9, B3). The leak ₪ uses the same label, scope and precision on every surface, and every visible total equals its visible rows.
3. **Every flag explains itself, in every density** (H1). Show expected (with source and date), charged, the ₪ difference, and the rule and threshold. Compact mode shortens this; it never hides it.
4. **The hero is provable to the agora** (H3). The proof sums to the hero, with a scope sentence, "הערכה" on every estimate, and closed months frozen.
5. **Act-now = badge word + ₪ + one verb that names the money effect, first on the home; T4 never cries wolf** (A5, A7). Pending and consolidated items stay neutral.
6. **₪ and signs render correctly in RTL** (E4). Use `<Money>` (a plain `<bdi>`), never `dir="ltr"` around a he-IL ₪ string, and take signs from Intl. A wrong render on the dock slip or supplier portal is S0.
7. **Decisions are instant and undoable; irreversible money is confirmed by name** (I2, C10). Optimistic row exit, 10 s Undo, rollback in place; write-offs name the ₪ and the supplier.
8. **Never lose field work or invoice pages** (G7, G6). Offline-first writes with a visible queue, multi-page rear-camera capture, and a 56 px thumb-zone primary (G2).
9. **Each role lands on its job** (D1). The receiver gets today's trucks, not the owner's control room.
10. **The legal and focus floor** (F1, F3). Publish a הצהרת נגישות (IS 5568) and keep one ≥3:1 focus ring that sticky chrome never hides.

---

## A. Hierarchy and the ₪ story (T1–T4): 9 criteria

#### A1 · One T1 hero per page, with one action
- **Rule:**
  - At most one element per page uses `metric-hero`: the T1 ₪.
  - The hero footer holds exactly **one** primary CTA and at most **one** tertiary text link ("איך הגענו ל-₪X?").
  - The primary is solid; it is danger-solid only when leak > 0.
  - Report, digest and "ask about this number" go into "עוד ▾" or the page nav.
- **Check:**
  - Code: count the interactive elements in the hero footer (≤2) and the `metric-hero`/`text-5xl|6xl` uses per page (≤1). Baseline: up to 4 equal-weight actions, `dashboard/page.tsx:478–520`.
  - Screenshot: squint test at 1280 and 390. The eye lands on the ₪ first and the CTA second.
- **Severity:** S1 if two ₪ compete for T1 or there are 3 or more equal-weight hero actions. S2 if the tertiary is styled as a button.
- **Exemplar:** Stripe Dashboard home (one KPI per card); Mercury (single balance) [K].

#### A2 · The hero tells the whole story in one glance
- **Rule:** The hero's anatomy, in this order:
  1. Eyebrow "אוקטובר · עד 25.10 · פתוח" (or "סגור").
  2. Label "דלף החודש".
  3. The ₪ at 0 dp, with the exact agorot in a tooltip or `title`.
  4. A delta line, **on by default**, comparing month-to-date with the **same day-span** last month: "▲ ₪320 (+12%) לעומת 1–25 בספטמבר". With a thin base, show the ₪ only.
  5. A 30-day sparkline (120×32 desktop, 96×28 mobile) with an `aria-label` sentence.
  6. Context: the leak as a % of food spend, with its base (R-14).
  7. Freshness and completeness: "עודכן לפני 4 דק׳ · 42 חשבוניות נבדקו · 3 ממתינות להתאמה".
- **Check:**
  - Code: `DEFAULT_VIEW.compare` (baseline `'off'`, `lib/components/views/state.ts:70`); the `computeLeakHero` bounds (MTD vs MTD, not vs a full month); a `Sparkline` is present; the freshness line uses `matchedInvoiceCount`/`pendingLinkCount`.
  - Screenshot: all seven parts sit in the first viewport at 375×667 and 1280×800.
- **Severity:** S0 if the comparison is month-to-date vs a full month (a misleading direction). S1 if there is no delta by default or no completeness line. S2 for a missing sparkline or eyebrow state.
- **Exemplar:** Stripe Apps analytics (period badges "if sufficient historical data is available"); Pilot (live view vs closed books).

#### A3 · Deltas are coloured by meaning, never by sign
- **Rule:**
  - Leak going up is danger; leak going down is green. Spend changes are neutral ink. Caught, claimed, credited and returned going up are gold or green.
  - Every delta has an arrow glyph, a word (עלייה / ירידה), a signed ₪ (U+2212 or the Intl sign) and an optional %. Never colour alone.
- **Check:**
  - Code: every `DeltaBadge` sets `upIsGood` deliberately (the `false` default is correct for the leak); spend deltas render neutral.
  - Screenshot: in a grayscale capture, the direction is still readable.
- **Severity:** S0 if a good change shows red (or a bad one green) on T1/T2. S1 if colour is the only carrier. S2 if the word is missing.
- **Exemplar:** Stripe Apps Badge semantic types; Mercury (red and yellow reserved for errors and warnings).

#### A4 · Zero, unknown and "not yet" are different, and honest
- **Rule:**
  - **Before any data:** a labelled sample state ("דוגמה") with one CTA ("העלה חשבונית"). Never a ₪0 that looks like a clean month.
  - **Clean month:** a T3 sentence with counts: "₪0 דלף · 42 חשבוניות נבדקו ✓".
  - **In tables:** blank = not applicable (screen-reader label "לא רלוונטי"); ₪0 = checked and clean (T3); "ממתין" = not yet known (T4). No "—" or "x" fillers.
  - **A failed load** renders an "unavailable · נסה שוב" row, never a ₪0.
- **Check:**
  - Code: grep cell renderers for `'—' | '-' | '–'` fallbacks; inspect the hero's empty branch; error branches must not render 0.
  - Screenshot: a new tenant, a clean tenant, and a failed-OCR row.
- **Severity:** S0 if ₪0 stands in for "no data" or "failed". S1 for a missing sample or clean-month treatment. S2 for "—" fillers.
- **Exemplar:** Primer DataTable (blank cells, `unavailable` state); Stripe and Ramp setup checklists [K].

#### A5 · T2 act-now: badge word + ₪ + one verb, placed first
- **Rule:**
  - **Covers:** ₪ awaiting approval, blocking discrepancies, receiving mismatches, claims to send, and missing VAT allocation numbers.
  - **Anatomy:** a solid danger or warn badge **with a word** ("חוסם תשלום"), then a one-line claim, then the ₪ (`metric-md/lg`), then **one** primary CTA whose label names what happens to the ₪: "אשר תשלום כפי שחויב" / "דחה ובקש זיכוי", never a bare "אשר". Secondary verbs go in "⋯".
  - **Materiality sets the tier:** a price alert is T2 only at **≥3% and ≥₪50 a month**; below that it is T4 info.
  - **On the home:** a "מחכה לך" stack of up to 3 items, ranked by ₪ × urgency, sits directly under the hero and above the charts, with "עוד N ←" beyond 3. When empty, show an inbox-zero line.
- **Check:**
  - Code: one `variant="primary"` per card; the badge has text; in `dashboard/page.tsx` the Needs-you stack sits between `LeakHero` and `VatAtRiskCard`.
  - Screenshot: owner home at 375×667 shows the hero ₪ **and** the first Needs-you row without scrolling.
- **Severity:** S1 if decisions sit below the trend chart, a CTA is ambiguous about the money, or a non-material alert is T2 (alarm fatigue). S2 for secondary verbs shown inline.
- **Exemplar:** Ramp Inbox; Linear Triage; Ramp Price Intelligence (materiality).

#### A6 · T3 good news is calm
- **Rule:** Caught, claimed, credited and recovered money use subtle gold or green surfaces (the `bg-subtle` role with gold or primary text). Never solid danger or warn, no motion over 200 ms (except J1), no confetti. Prefer a sentence: "₪1,240 חזרו החודש מ-3 ספקים".
- **Check:**
  - Code: T3 tiles use only the subtle gold/primary roles and no `glow-*`.
  - Screenshot: in a squint test, T3 never out-shouts T1 or an open T2.
- **Severity:** S2. S1 if T3 is louder than an open T2 on the same screen.
- **Exemplar:** Mercury's calm positive states [K]; Superhuman's inbox-zero moment.

#### A7 · T4 neutral never cries wolf
- **Rule:**
  - **Neutral cases:** pending OCR, consolidated invoices (חשבוניות ריכוז) awaiting delivery notes, offline queues, flag-off notices and "owner only" permission notices.
  - **Styling:** ink or muted text on `surface-2`, a clock or info icon, and the reason ("מחכה לתעודת משלוח").
  - **Never:** a danger or warn tone, or `role="alert"`.
- **Check:**
  - Code: the tone props on `consolidated-panel.tsx`, the leaks "owner only" card (baseline: warn tone [ia #8]) and the PWA queue banner.
  - Screenshot: a consolidated invoice with no discrepancy reads calm.
- **Severity:** S1 when pending is red or orange (the AGENTS.md T4 rule). S2 when the reason is missing.
- **Exemplar:** QuickBooks bank feed (pending vs For review); IBM Carbon ("avoid status indicators when no action is required").

#### A8 · Emphasis budget: hide controls, never money
- **Rule:**
  - **Per viewport:** at most 1 T1; solid danger or warn only on actionable items; at most 1 solid primary button per region.
  - **Below `lg`:** power controls (period, compare, chart type, density, saved views, TV, export, filters) collapse behind **one** "תצוגה" button.
  - **Never** push ₪ figures, T2 badges or the primary CTA below the fold, or let controls truncate or wrap them.
  - A filtered view shows one chip row with "נקה".
- **Check:**
  - Code: `ViewToolbar` responsive behaviour on `/dashboard` and approvals.
  - Screenshot: at 390×844, count the solid danger and warn elements; the hero ₪ starts above 50% of the viewport height.
- **Severity:** S1 if controls push T1 or T2 below the fold on mobile. S2 for emphasis inflation.
- **Exemplar:** Linear (opinionated defaults); Arc's "Little Arc" (interface weight matches the task).

#### A9 · One money vocabulary, one number, everywhere
- **Rule:**
  - The leak figure has **one label, one scope and one precision** on the hero, leaks hub, monthly report, digest and WhatsApp, chain view, OG image and the marketing leak-check result.
  - Recovery has exactly four states: **נמצא · נדרש · זוכה · הוחזר**. Each has a one-line definition (tooltip and glossary), and they render as one funnel with ₪ per stage.
  - "נתפס לפני תשלום" is a property of נמצא, not a fifth state.
  - No two tiles with synonym names. Baseline: "הוחזר" next to "returned this month" [fin C11].
- **Check:**
  - Code: grep the i18n files for leak-label variants and recovery state names.
  - Screenshot: hero, monthly report and digest preview side by side show the same words and the same ₪ for the same scope.
- **Severity:** S0 if the same scope shows a different ₪ on two surfaces. S1 for synonym tiles. S2 for label drift.
- **Exemplar:** Stripe balance states (Available, Pending, Reserved, each defined once).

---

## B. Layout, spacing, typography and numerics: 9 criteria

#### B1 · A closed type scale that respects Hebrew metrics
- **Rule:**
  - **Ten roles:**

    | Role | Size / line height (px) |
    |---|---|
    | heading-lg | 24/32 |
    | heading-md | 20/28 |
    | heading-sm | 16/24 |
    | body | 16/24 |
    | body-sm | 14/20 |
    | caption | 12/16 |
    | metric-sm | 16/24 |
    | metric-md | 24/32 |
    | metric-lg | 32/40 |
    | metric-hero | 56/60 (mobile 40/44) |

  - **Floors:** 12 px on the desk, 14 px on field routes. Every input ≥16 px, so iOS doesn't zoom.
  - **Line height:** body 1.5–1.6, display 1.05–1.15.
  - **Never** combine `leading-none` with `overflow-hidden` or `truncate` on Hebrew; it clips the ל ascender and the ק ך ן ף ץ descenders.
  - Must survive WCAG 1.4.12 text spacing.
- **Check:**
  - Code: `grep -rnE "text-\[(8|9|10|11)px\]"` returns 0 (baseline 101 uses); no arbitrary `text-[N rem]`; the Tailwind `fontSize` theme is **replaced**, not extended.
  - Screenshot: zoomed crops of badges, nav labels and KPI hints; the text-spacing bookmarklet applied.
- **Severity:** S1 for text under 12 px on a primary surface, or clipped Hebrew. S2 for off-scale sizes.
- **Exemplar:** Atlassian (separate heading, body and metric token families); Polaris `Text`; Apple HIG (bigger sizes for RTL scripts).

#### B2 · Money in the text face; mono only for identifiers
- **Rule:**
  - Every ₪, quantity, % and unit price is set in Heebo with `tabular-nums lining-nums` (R-2).
  - JetBrains Mono is only for invoice, allocation, PO and SKU numbers.
  - **Hero ₪:** digits in Heebo 800 at −0.02em. The ₪ glyph sits in its own span at 0.55em, weight 600, muted, with a 0.12em gap. The wrapper carries **one** accessible name (`aria-label="48,270 ₪"`) and its children are `aria-hidden`.
- **Check:**
  - Code: `grep font-mono | grep -E "formatIls|ils\(|money\(|₪"` returns 0 (baseline 327 `font-mono` uses, mostly money).
  - Screenshot: DevTools → Rendered Fonts shows Heebo for the ₪; "48,270" has no wide mono comma gap.
- **Severity:** S1 on T1 and T2 figures. S2 elsewhere.
- **Exemplar:** Stripe, Mercury and Ramp balances (brand sans with tabular digits) [K]; Polaris `numeric` text.

#### B3 · A precision contract
- **Rule:**
  - (a) Hero and KPI tiles may round to whole ₪.
  - (b) Anything a user may add up, claim, pay or type shows **2 dp**: line deltas, claim lines, credit notes, pay-run rows. Unit prices show 4 dp only where stored that way.
  - (c) A total shown next to its rows uses **the rows' precision**.
  - (d) Every rounded figure exposes the exact agorot on hover or focus, and in the proof.
  - (e) One `maximumFractionDigits` per column.
- **Check:**
  - Code: compare the approvals "₪ at risk" tile with its rows (baseline 0 dp vs 2 dp, `approvals/list.tsx:116,123`).
  - Screenshot: sum the visible rows by hand and compare with the total.
- **Severity:** S0 if a visible total doesn't equal its visible rows. S1 for mixed precision in a column. S2 for a missing exact-value tooltip.
- **Exemplar:** Stripe CurrencyField (integer minor units) and its "estimated" home charts vs exact reports; SAP Fiori currency control.

#### B4 · Money columns line up on place value
- **Rule:**
  - Numeric cells and their headers align **physically right** in both locales (R-1). Implement this once as `.num` / `<NumCell>` (`ltr:text-end rtl:text-start`) so nobody "fixes" it back.
  - Use fixed decimals per column. In dense tables, ₪ moves to the header ("סכום (₪)"). Never centre numbers.
  - **Never** use `notation:'compact'` for ₪ (it renders "₪1.2M"). Write large amounts in words ("1.2 מיליון ₪") or in full digits.
- **Check:**
  - Code: numeric `text-end` with `tabular` on one line (baseline 78 cells); `notation: 'compact'` returns 0.
  - Screenshot: in a column holding 12.00, 1,234.50 and 98,765.43, one vertical line passes through every decimal point (±1 px).
- **Severity:** S1 on ledgers, pay-run, approvals and invoice lines. S2 elsewhere.
- **Exemplar:** Polaris DataTable ("numerical = right aligned · keep decimals consistent · units in headers"); a Xero user request for decimal alignment.

#### B5 · A 4 px spacing grid that matches the code
- **Rule:** Spacing comes only from 2, 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64.
  - Component padding: 8/12/16.
  - Card padding: 16 mobile, 24 desktop.
  - Section gaps: 32/48.
  - Same-kind siblings get the same gap on every page.
  - `packages/ui-tokens` includes 12 px. It is the most-used step (857 uses) and is missing from the tokens today.
- **Check:**
  - Code: no arbitrary `p-[Npx]`, `gap-[Npx]` or `m-[Npx]`; the token file lists the full set.
  - Screenshot: overlay an 8 px grid; compare card padding on 3 pages.
- **Severity:** S2. S3 for a single offset.
- **Exemplar:** IBM Carbon spacing scale; Atlassian `space.*`.

#### B6 · Density by persona, not by screen
- **Rule:**
  - Three densities:
    - **compact:** 32 px rows, for the bookkeeper's ledgers, exports and admin.
    - **default:** 48 px, for the owner and manager.
    - **touch:** 56 px, for the receiver and any coarse pointer.
  - The header row matches the body row height.
  - A density never hides meaning (see H1).
- **Check:**
  - Code: tables consume `--row-*` tokens, and the density toggle maps to them.
  - Screenshot: the same table in compact and default; the header aligns and nothing meaningful drops.
- **Severity:** S2. S1 if compact hides the explanation or the ₪.
- **Exemplar:** IBM Carbon data table sizes; Primer Condensed / Normal / Spacious.

#### B7 · Shape and elevation by meaning
- **Rule:**
  - **Radii:**
    - 8: controls and badges inside tables.
    - 12: cards.
    - 16: dialogs, sheets and the hero card.
    - `full`: pills and avatars.
  - **Elevation:**
    - e0: flat with a `line` border, for sections.
    - e1: card.
    - e2: overlay, for menus, popovers, toasts and tooltips.
    - e3: modal with a scrim.
  - Shadow names describe the level, not a colour. Retire the dark-era `shadow-glow-*` names.
- **Check:**
  - Code: `grep -rhoE "rounded-(sm|md|3xl|\[)" apps/web/app/dashboard` returns 0 (baseline 8 radius values); `shadow-glow-` returns 0 after the rename.
  - Screenshot: popovers sit visibly above cards, and no card looks like a dialog.
- **Severity:** S2.
- **Exemplar:** Vercel Geist and Linear (2–3 radii) [K]; Material 3 elevation levels; Atlassian `elevation.surface.*`.

#### B8 · Colour comes from role tokens, never hex
- **Rule:**
  - Every status family (danger, warn, primary/success, gold, info, neutral) exposes the same roles: `text`, `icon`, `border`, `bg-subtle`, `bg-subtle-hover`, `bg-bold`, `bg-bold-hover`, `text-on-bold`.
  - Components consume roles. Never `bg-danger/12`, never hex.
  - T2 → bold; T3 → subtle gold or primary; T4 → neutral.
  - Chart palettes come from tokens.
- **Check:**
  - Code: hex in TSX returns 0 outside `og/` (baseline 43); alpha-hacked semantics return 0 once the roles land.
  - Screenshot: eyedropper 5 random elements; all are on-palette.
- **Severity:** S2. S1 if an ad-hoc colour drops a pair below AA (see F2).
- **Exemplar:** Atlassian colour roles (`color.background.danger.bold`…); Geist's 10-step scale jobs [K]; Linear's LCH theming [K].

#### B9 · Layout, width and reflow
- **Rule:**
  - One container width per shell (marketing, app, showcase, auth).
  - One page-header pattern: `h1`, context, and one primary action at the end.
  - Tables get the widest container. Prose lines stay at or under about 70 characters.
  - **No horizontal page scroll** at 320 CSS px (WCAG 1.4.10) or at 390 px. The exception is declared compact bookkeeper tables, which must have a sticky identity column.
  - The page stays usable at 200% zoom.
- **Check:**
  - Code: `max-w-*` per shell; Playwright asserts `scrollWidth ≤ innerWidth` on every route at 320 and 390.
  - Screenshot: 390 and 1280 of each page; 200% zoom at 1280.
- **Severity:** S1 for page-level horizontal scroll, or content lost at 320 px or 200%. S2 for container drift.
- **Exemplar:** IBM Carbon ("give tables the most width on the page"); Polaris page layout.

---

## C. Components and states: 14 criteria

#### C1 · Tables: sort, stick, wrap
- **Rule:**
  - **Sort:**
    - A sortable table loads with one column sorted, showing its arrow.
    - Headers are `<button>`s inside `<th>`, with `aria-sort` on the sorted `th`; reachable by Tab, activated by Space or Enter.
    - ₪ columns sort **descending** on the first click; text and date columns ascending.
    - Three states, plus "sorting…" for server-side sorts.
  - **Stick:** the header sticks under the app header, and the identity column sticks at the start edge on horizontal scroll.
  - **Wrap:**
    - Text wraps before it truncates.
    - Truncate only fixed-width columns, and always expose the full text (`title`, tooltip and accessible name).
    - Never truncate names that share a prefix ("תנובה – מרכז" / "תנובה – צפון").
- **Check:**
  - Code: exactly one `th[aria-sort]` ≠ `none` on first render (baseline: 0 across 39 tables); every `truncate` has a `title`.
  - Screenshot: scroll a long table; the header stays visible and supplier names stay distinct.
- **Severity:** S1 for unsortable money tables in queues or ledgers, or ambiguous supplier truncation. S2 otherwise.
- **Exemplar:** GitHub Primer DataTable; IBM Carbon data table; Polaris ("wrap instead of truncate").

#### C2 · Row actions and batch mode
- **Rule:**
  - **Row actions:** at most 2 inline. With 3 or more, show one primary and put the rest in "⋯", which is always visible on touch.
  - **Batch bar:** selecting rows switches the toolbar to a sticky batch bar, "N נבחרו · ₪X · [אשר N] [דחה…] [נקה]". Per-row actions are disabled in batch mode.
  - **Block items:** `block` rows are **never** bulk-selectable. Their checkbox is disabled with the reason "דורש בדיקה פרטנית".
  - **Cap and sum:** bulk items are each at or below the cap (R-12). The ₪ in the bar is Σ|Δ| of the selection.
  - **Audit and confirm:** one audit entry per item; the confirm step repeats the sum.
  - Checkboxes have a 44×44 hit area on touch.
- **Check:**
  - Code: no row renders more than 2 visible action buttons; `block` rows are excluded from select-all.
  - Screenshot: select 3 rows; the bar shows the count and the ₪.
- **Severity:** S0 if a block item can be bulk-approved. S1 if the bulk ₪ sum is missing. S2 for overflowing row actions.
- **Exemplar:** Ramp and BILL bulk approve; IBM Carbon batch actions; Polaris IndexTable.

#### C3 · Tables become cards on phones; totals and paging
- **Rule:**
  - **Below 768 px**, each row becomes a card:
    - Line 1: identity, with the ₪ at the end of the line.
    - Line 2: status chip and date.
    - One action.
    - Drop low-value columns.
  - Money tables carry a **totals row** (sums only, `metric-sm`) or explicitly declare none.
  - 20 rows per page by default; paginate above 50; use "load more" for feeds.
- **Check:**
  - Code: a `md:hidden` card list exists per queue and list (baseline: orders only); a totals prop.
  - Screenshot: approvals, invoices, suppliers and claims at 390.
- **Severity:** S1 for a queue that is unusable on a phone. S2 otherwise.
- **Exemplar:** Polaris IndexTable `condensed`; Primer ("20 rows is a good place to start").

#### C4 · Reconciliation: named states and a remainder that counts down
- **Rule:**
  - **Four states, with counts in the tabs,** on every match surface (three-way per invoice, consolidated cross-match, supplier ledger, receiving):
    - **לבדיקה:** the default tab; danger or warn with ₪.
    - **הותאם:** calm check; collapsed.
    - **ממתין:** T4, with a reason.
    - **הוחרג:** who and why, plus Undo.
  - One source line maps to at most one counterpart, shown inline.
  - **Many-to-one allocation:**
    - A sticky footer reads "נבחר ₪X מתוך ₪Y · הפרש ₪Z".
    - Z turns green with ✓ at |Z| ≤ `TOTAL_TOLERANCE_ILS`, read from the engine and never redefined.
    - Until then confirm stays disabled, with the reason as visible text.
    - An escape, "רשום את ההפרש כהתאמה…", requires a reason.
- **Check:**
  - Code: the tolerance is imported from `packages/matching`, not written as a literal; state names come from one enum or i18n key set.
  - Screenshot: the consolidated panel mid-allocation.
- **Severity:** S0 if the tolerance is re-implemented with a different value. S1 if allocation has no running remainder. S2 for state-name drift.
- **Exemplar:** QuickBooks bank feed (For review / Categorized / Excluded, one-to-one, Undo); Xero Find & Match; xtraCHEF (submit unlocks once the totals reconcile).

#### C5 · Forms: structure and save model
- **Rule:**
  - **Labels:** above the field, 1–3 words, no colon.
  - **Placeholders:** only as examples ("לדוגמה: 514123456"), never as the label.
  - **Marking:** mark the minority, e.g. "(רשות)".
  - **Helper text:** sits between the label and the field and is replaced by the error.
  - **Width:** reflects the expected length (allocation number about 12ch, amount about 10ch).
  - **Focus:** the first required field is focused on open.
  - **Saving:**
    - One save model per form; never mix autosave and explicit save.
    - On error, keep every typed value.
    - Guard unsaved changes on leave.
- **Check:**
  - Code: axe `label`; no placeholder equals its label; one save model per form.
  - Screenshot: onboarding, orders/new, contracts/import, settings, invite, leak-check.
- **Severity:** S1 for a placeholder used as the label, or data lost on error. S2 otherwise.
- **Exemplar:** IBM Carbon forms pattern; Primer forms and saving.

#### C6 · Validation: reward early, punish late
- **Rule:**
  - **When:** validate on blur after a change. Once a field is invalid, re-validate as the user types.
  - **On submit:** with 3 or more errors, show a focusable error summary with anchor links. Otherwise focus the first invalid field.
  - **Markup:** `aria-invalid` plus `aria-describedby`; no live regions for validation.
  - **Errors** are in Hebrew and name the field, the rule and the fix: "מספר הקצאה צריך 9 ספרות".
  - **Submit button:** never disabled because the form is invalid or unchanged. It is disabled **only while submitting**, which is the double-post guard on money actions.
  - **Async validation** over 1 s shows a spinner.
- **Check:**
  - Code: audit the `disabled=` props (baseline 122) for validity gating; Playwright: submitting an empty form moves `:focus` to the first invalid field or the summary.
  - Screenshot: the error state of each form.
- **Severity:** S1 on money and auth forms. S2 elsewhere.
- **Exemplar:** GitHub Primer forms; warehouse receiving apps (errors name the field, the rule and the next step).

#### C7 · Amount and quantity inputs
- **Rule:** A money or quantity field is:
  - `type="text" inputMode="decimal"`. Never `type="number"`: a scroll wheel changes the value and a decimal comma is rejected.
  - `dir="ltr"` with `rtl:text-right`, `autocomplete="off"`, at least 16 px.
  - Accepts both "7,5" and "7.5", and formats thousands on blur, not while typing.
  - Shows the ₪ or unit adornment outside the value, at the visual left (end) in RTL.
  - In field flows: select-all on focus and `enterKeyHint="next"`.
- **Check:**
  - Code: `grep 'type="number"'` returns 0 for money and quantity (baseline 27); `inventory/count/count-screen.tsx` is the model.
  - Screenshot: type "1234,5" and blur; it shows "1,234.50".
- **Severity:** S1 on money entry (contracts, corrections, catalog price, supplier portal answer). S2 on desk quantities.
- **Exemplar:** Stripe CurrencyField; the Bit and PayBox amount screens [K].

#### C8 · Every route has designed loading, empty and error states
- **Rule:**
  - **Coverage:** each dashboard segment has a layout-true `loading.tsx` (see I4) and an `error.tsx` with a plain-Hebrew cause, "נסה שוב" and a way out. `not-found` offers a path back.
  - **Empty states are typed:**
    - **first-use:** an action title plus exactly one primary CTA. Example: "סרקו חשבונית ראשונה כדי לראות כמה כסף דולף" with "סרוק חשבונית".
    - **no-results:** what to change, plus "נקה סינון".
    - **error, permission or config:** no playful art, the alert icon, and the fix. Example: "החיבור ל-MarketMan נותק" with "חבר מחדש".
  - **Layout:** start-aligned in pages; centred only inside small tiles. Never guilt.
  - **Queue inbox-zero** is T3: "הכל מטופל ✓", plus what was auto-handled (count and ₪), plus the next expected event ("המשלוח הבא: תנובה, 07:30").
- **Check:**
  - Code: `loading.tsx` coverage (baseline 5 files covering 10 of 43 pages); `error.tsx` per area (baseline: root only); every `EmptyState` passes a `kind`.
  - Screenshot: each page empty, errored and filtered-empty.
- **Severity:** S1 for a primary route with no designed loading or error state, or a grey-void inbox-zero. S2 for untyped empty states.
- **Exemplar:** Primer Blankslate; IBM Carbon empty-states pattern (three types); Polaris EmptyState ("one primary call to action… never make merchants feel guilty"); Superhuman inbox zero.

#### C9 · Choose the message type by stakes
- **Rule:**
  - **Inline:** for a field or row; persists until resolved.
  - **Banner:** page or section level. One per page, under the header, not sticky; at most 2 sentences and 1 action.
  - **Toast:** only to confirm a low-stakes result that isn't already visible. Timings per R-6; bottom-start, above the bottom nav; polite; at most 3.
  - **Dialog:** only for decisions that block work.
  - **Row-action errors** appear **on that row**, never as a card at the top of the list.
  - **No success toast** when the UI already shows the result (the row moved to "אושר").
- **Check:**
  - Code: `Toast.tsx` has an `action` slot and **no** auto-dismiss path for `error` (baseline: errors dismiss after 7000 ms); triage each `toast.error(` call site.
  - Screenshot: force a failing approve; the error renders on the row.
- **Severity:** S1 for auto-dismissed errors, or errors shown far from their trigger. S2 for redundant toasts.
- **Exemplar:** Polaris Toast (5 s, or 10 s with an action) and Banner; IBM Carbon notifications; Primer (toasts not recommended for errors).

#### C10 · Confirm, undo or deferred send
- **Rule:** (R-8)
  - **Reversible decisions** (approve, reject, escalate, archive, map): no confirm. Optimistic, plus an Undo toast.
  - **Outbound to a supplier** (claim letter, WhatsApp or email order): first a preview of exactly what the supplier receives, then a deferred send with a countdown: "נשלח לספק בעוד 10 שניות · בטל שליחה".
  - **Money-losing or data-destroying actions** (write-off, delete): a ConfirmDialog whose button names the amount and the party: "מחק ₪1,240 מהדרישה לספק תנובה".
  - **Never** use native `window.confirm` or `alert`, and never a `<select>` that fires a money state change on change.
- **Check:**
  - Code: `grep window\.(confirm|alert)` returns 0; the recovery status `<select>` (baseline: fires `written_off` on change, `recovery/tracker-client.tsx:278–300`); ConfirmDialog copy contains a ₪ amount and a party.
  - Screenshot: walk every destructive path.
- **Severity:** S0 for an irreversible money action with no confirm or undo. S1 for native dialogs or generic confirm copy.
- **Exemplar:** Stripe Apps review requirements (confirm costly actions) and Stripe Disputes (one submission); Superhuman Undo Send.

#### C11 · Status chips: icon + word + colour; a group shows its worst child
- **Rule:**
  - Every status chip has an icon or shape, a text label and a role colour. Colour is never alone.
  - Roll-ups show the highest-attention child; this covers consolidated invoices, chain branch tiles and supplier rows. A roll-up with nothing wrong stays T4.
  - Use a chip only where action or state matters; use plain text otherwise.
- **Check:**
  - Code: `Badge` requires a label; roll-ups take the max severity.
  - Screenshot: apply `filter: grayscale(1)` to the page. Statuses, deltas, chart series, the nav active state and row tones must all stay distinguishable.
- **Severity:** S1 if a status is colour-only (WCAG 1.4.1). S2 otherwise.
- **Exemplar:** IBM Carbon status-indicator pattern; Primer message states.

#### C12 · Buttons and action hierarchy
- **Rule:**
  - **One primary per region** (card, dialog, page header, sticky bar). Secondary = outline; tertiary = text.
  - **Destructive** never sits next to the primary.
  - **Same verb, same variant,** everywhere.
  - **Disabled buttons** show the reason as visible text ("חסר ₪12.40 להתאמה"), not only in a tooltip.
  - **Icon-only buttons** have a Hebrew `aria-label`, a tooltip and a hit area of at least 24 px (44 on touch).
  - **External links** carry an icon.
  - **Labels** are verb + object: "שלח דרישה לספק".
- **Check:**
  - Code: count `variant="primary"` per region; find icon-only buttons without `aria-label`.
  - Screenshot: every sticky bar and dialog footer.
- **Severity:** S1 for two competing primaries at a money decision (baseline: gold and primary side by side in `Reconciliation.tsx`). S2 otherwise.
- **Exemplar:** Apple HIG Buttons ("one or two prominent buttons per view"); Stripe Apps ("concise and descriptive labels").

#### C13 · Overlays: dialogs, sheets, peeks and menus
- **Rule:**
  - Dialogs and sheets trap focus, return it to the trigger on close, close on Esc and lock background scroll.
  - On mobile, use bottom sheets: at most 85vh, a drag handle, swipe-down plus a visible "סגור".
  - Menus are keyboard-navigable (`menuitem`, arrow keys, Esc).
  - Clickable cards never nest interactive elements.
  - A tooltip is never the only home of essential information on touch.
- **Check:**
  - Code: focus handling in ConfirmDialog, the drawer and peek; no `<a>` wrapping a `<button>`.
  - Screenshot: open and close each overlay with the keyboard only.
- **Severity:** S1 for focus loss or a focus trap. S2 otherwise.
- **Exemplar:** Primer focus management; Linear Peek.

#### C14 · Charts tell one truth
- **Rule:**
  - **Time axis:** time runs left = oldest to right = newest in both locales (R-3). Title, legend and tooltip chrome mirror. The value axis and the "now" label sit on the right.
  - **Every chart** has a table toggle with the exact values and an `aria-label` sentence: "מגמת דליפה ב-30 הימים האחרונים: יורדת, מ-₪1,240 ל-₪860".
  - **Sparklines:** no axes, labels or gridlines; a 1.5 px stroke; a 4 px dot on the last point; muted ink, except the leak series.
  - **Palette:** from tokens and colour-blind-safe.
  - A chart is never the only place a number appears.
- **Check:**
  - Code: `rtl:-scale-x-100` removed from `BreakdownChart.tsx:181`; `Sparkline` has an `aria-label`.
  - Screenshot: on the Hebrew breakdown chart, the last month's point sits to the right of the first.
- **Severity:** S1 for time axes that contradict each other across charts (baseline [rtl F4]). S2 otherwise.
- **Exemplar:** Stripe Apps Sparkline and chart layout; Apple RTL guidance (graphs are not flipped).

---

## D. Navigation, IA and wayfinding: 9 criteria

#### D1 · Each role lands on its job
- **Rule:** Each role's first viewport answers that role's question in under 10 s. No role sees a module it can't act on.
  - **Owner:** hero, then Needs-you.
  - **Manager:** Needs-you first, then the hero.
  - **Bookkeeper:** pay-run blockers, VAT at risk, duplicates.
  - **Receiver:** today's deliveries, with no ₪ hero.
  - **Chef:** recipe cost alerts and the count.
- **Check:**
  - Code: `dashboard/page.tsx` branches on role (baseline comment: "the hero is for every role").
  - Screenshot: log in as each of the 5 roles at 390 and 1280.
- **Severity:** S1 when a receiver or chef lands on the owner control room.
- **Exemplar:** Superhuman Split Inbox (split by type of work); Brex's mobile task inbox.

#### D2 · Nav ordered by job, with honest badges
- **Rule:**
  - **Order:** desktop nav groups follow home → act → understand → configure.
  - **Fit:** no wrapping tab rows (baseline: 18 owner tabs wrap to 2 lines). At most 7 primary items per role; the rest go in grouped secondary nav.
  - **One pipeline:** decide → pay → claim → recover is **adjacent and consistently named**.
  - **One leak hub:** tabs for overview, breakdown, proof, report and claims, instead of 7 or more sibling URLs.
  - **Active item:** `aria-current="page"` plus weight or an indicator, not colour alone.
  - **Badges** only on queues the viewer can act on: approvals (block + warn), inbox `needs_review`, claims to send, contracts. Hidden at 0, capped at "99+", danger only when a `block` exists.
- **Check:**
  - Code: group order in `nav.tsx`; `NavBadge` scope (baseline: contracts only).
  - Screenshot: owner nav at 1280 and 1440; manager nav.
- **Severity:** S1 for wrapping or unordered owner nav. S2 for badge scope.
- **Exemplar:** Linear sidebar and Inbox counts; Stripe Dashboard nav [K].

#### D3 · Mobile bottom bar
- **Rule:**
  - **Items:** 4 role-chosen destinations plus "עוד", with home on the right (start).
  - **Labels:** 12 px, at most 7 Hebrew characters, never truncated (בית · חריגות · אישורים · קבלה · עוד).
  - **Active:** filled pill, weight 600 and `aria-current`. Badges as in D2.
  - **Height:** at least 64 px plus `env(safe-area-inset-bottom)`. Publishes `--rm-bottomnav-h`.
  - **Hidden** in field focus mode (G1).
  - A 44×44 search icon in the top bar opens the palette.
- **Check:**
  - Code: `MobileNav` in `nav.tsx:417–460` (baseline: 11 px truncated labels; the first 4 items are picked mechanically).
  - Screenshot: each role at 390.
- **Severity:** S1 for truncated 11 px labels, or no approvals entry for managers. S2 otherwise.
- **Exemplar:** Material 3 navigation bar; iOS tab bar [K].

#### D4 · Command palette: go, find, do, ask
- **Rule:**
  - **Open:** ⌘K / Ctrl+K (by `code`), and `/` when no input is focused, from every dashboard page. Esc returns focus to the trigger.
  - **Sections, in fixed order:** Needs-you → Go to → Records → Actions → Ask. Ask is the fallback "שאל את RestoMatch: …" when `aiAssistant` is on.
  - **Speed:**
    - At 0 characters it shows recents (frecency, `localStorage` inside try/catch) and pinned items, with no network call.
    - Local items filter on every keystroke within one frame.
    - Server records debounce at 150 ms or less and keep stale results visible.
  - **Teaching:** action rows show their shortcut chip; strict aliases jump to the top (אש → אישורים).
  - **Search normalises Hebrew:**
    - Wrong keyboard layout: `,bucv` finds תנובה.
    - Final letters folded.
    - Geresh and gershayim ignored.
    - Niqqud stripped.
    - English names matched.
    - Digits match invoice and PO numbers and ₪ totals.
- **Check:**
  - Code: `search.tsx` (baseline: no hotkey, 2-character minimum, 250 ms debounce, entities only); a shared `normalizeHe()`.
  - Screenshot: the palette empty, after typing "תנ", and after typing ",bucv".
- **Severity:** S1 for no global entry point to records and actions. S2 for normalisation gaps.
- **Exemplar:** Superhuman Command; Linear ⌘K; Raycast (frecency, aliases, fallback commands); Arc Command Bar.

#### D5 · Always know where you are, and how to go up
- **Rule:**
  - **Way up:** every non-root page has a breadcrumb (when the hierarchy is 2 or more deep) or an up-link, never neither. Baseline: the invoice detail, claims, recovery, reports, orders/new and ask pages have none.
  - **One pattern** per page type.
  - **Title:** one `<h1>` that matches the tab `<title>`.
  - **Context:** the current branch and period sit in the page header whenever the data is scoped by them.
- **Check:**
  - Code: breadcrumb or back usage per route; `SectionHeader level={1}` (baseline: missing on inbox, receiving, settings, team and the count start).
  - Screenshot: deep-link into an invoice from search. You can tell where you are and go up in one tap.
- **Severity:** S1 for a hub page with no way up. S2 for inconsistency.
- **Exemplar:** Stripe object pages (breadcrumb and object header) [K]; Polaris page header.

#### D6 · Glance, peek, page
- **Rule:** Three depths:
  - **L0 card:** the number and one line.
  - **L1 peek:** a 480 px side sheet at the inline-end edge on desktop, or an 85vh bottom sheet on mobile.
    - Opens in under 100 ms from cached data and keeps the list position.
    - `Space` toggles it on desktop; Esc or swipe-down closes it.
  - **L2 page:** "פתח במסך מלא" or ⌘Enter.
  - Evidence chips, invoice links in queues, heatmap cells, activity rows and palette results open **L1, not L2**.
- **Check:**
  - Code: approvals "פתח חשבונית / תקן OCR" (baseline: a full navigation).
  - Screenshot: open and close a peek from approvals; the scroll position is unchanged.
- **Severity:** S2. S1 on approvals, where each evidence check costs a page load.
- **Exemplar:** Linear Peek; Arc Peek; Raycast (`Enter` / `⌘Enter`).

#### D7 · Permissions and reachability are explicit
- **Rule:**
  - **No silent bounce:** a forbidden URL renders a T4 page, "המסך הזה זמין לבעלים ולמנהלים · בקשו גישה מ-<owner>", with a way home. A shared link never just "doesn't work".
  - **Flag-off routes** behave one way, either 404 or a T4 "not enabled" state.
  - **Reachability:** every route a role may open is reachable from that role's nav or from a parent hub. Baseline: the bookkeeper has no path to the ledger, and integrations has no nav entry.
  - Breadcrumbs never point to a parent the role can't open.
- **Check:**
  - Code: middleware redirect behaviour; a route × role reachability script built from `canSeeRoute`.
  - Screenshot: open a manager-only link as the bookkeeper.
- **Severity:** S1 for an unreachable allowed route or a silent bounce on a shared link. S2 for inconsistent flag-off behaviour.
- **Exemplar:** Notion and Figma access screens with "request access" [K].

#### D8 · State lives in the URL and survives navigation
- **Rule:**
  - Tabs, period, filters, sort and the selected item live in the URL.
  - Back restores the scroll position and selection.
  - A branch switch keeps the current page and its filters when that page exists in the target branch.
  - Saved views follow the user across devices: stored on the server, not only in `localStorage`.
  - A refresh never loses the user's place.
- **Check:**
  - Code: `branch-switcher.tsx` (baseline: `window.location.assign('/dashboard')`); where views are stored.
  - Screenshot: filter approvals, open an invoice, press Back.
- **Severity:** S2. S1 if Back loses a long filtered queue.
- **Exemplar:** Stripe Dashboard (filters in the URL) [K]; Linear views.

#### D9 · Notifications and digests are precise entry points
- **Rule:**
  - **Every event has an interruption level:**
    - **Time-sensitive** (WhatsApp + push): a duplicate invoice; a block of ₪500 or more before a scheduled payment; a mismatch while the driver is still at the door. At most 3 per person per day.
    - **Active** (in-app badge + push): grouped per match run.
    - **Passive** (in-app and daily brief only): price drift, info items, T3 news, T4 pending.
  - **Quiet hours by default:** 23:00–06:00 Asia/Jerusalem, plus Shabbat and holidays.
  - **Every message** states one action and its ₪, and deep-links to **the exact card**, not the home.
  - **No repeats:** anything already seen in-app is dropped from the digest, and nothing is sent when nothing needs the user.
  - Routing and cron are a human-PR proposal; templates and the preferences UI are in scope.
- **Check:**
  - Code: the copy in `notifications/templates.ts`; the settings preferences; the deep-link targets.
  - Screenshot: the digest and WhatsApp previews at `reports/digest`.
- **Severity:** S1 for deep links that land on the home, or push for passive events. S2 otherwise.
- **Exemplar:** Apple HIG interruption levels; Linear (email digests only for unread notifications; Pulse daily brief).

---

## E. RTL, Hebrew and copy: 10 criteria

#### E1 · Direction comes from the root; logical properties only
- **Rule:**
  - `<html lang dir>` is the only source of direction. No CSS `direction`.
  - No physical classes outside an allowlist: `ml-/mr-/pl-/pr-`, `left-N/right-N`, `text-left/right`, `rounded-l*/r*`, `border-l/r`. The allowlist covers paper replicas, symmetric decoration and the B4 `.num` exception.
  - DOM order = visual order. Never fake RTL with `flex-row-reverse` or `order-*`.
- **Check:**
  - Code: the physical-class grep returns only allowlisted files (baseline about 31 sites, e.g. `HeroVideo.tsx:107 left-3`).
  - Screenshot: a force-RTL pseudo-locale run on English catches physical CSS.
- **Severity:** S1 when a primary page mirrors wrongly. S2 otherwise.
- **Exemplar:** W3C i18n (`dir` on `<html>`); Apple leading/trailing layout.

#### E2 · Mirror direction, not objects
- **Rule:**
  - **One primitive:** `<DirIcon kind="forward|back|next|prev|send|logout|undo|redo">`.
  - **Mirror:** back and forward arrows, chevrons, send, sign-out, undo and redo, list and indent icons.
  - **Never mirror:** checks, X, +/−, media play and pause, clocks, refresh, search, logos, icons containing letters or digits, the Hebrew "?" (Hebrew is an explicit exception), and price-trend arrows.
  - **Progress and wizards:** progress bars fill from the right; wizard step 1 is on the right; "חזרה" sits at the start and "המשך ←" at the end.
  - **Copy arrows:** never hard-code "→" in Hebrew copy. In RTL, forward is "←", because Unicode arrows don't mirror.
- **Check:**
  - Code: raw `ArrowLeft|ArrowRight|ChevronLeft|ChevronRight` outside DirIcon returns 0 (baseline 41); "→" in `he.ts` or JSX returns 0 (baseline: 2 components). Known wrong icons: `Play` flipped in LTR (`correction-client.tsx:251`) and `Undo2` unmirrored.
  - Screenshot: every CTA arrow points in the reading direction, and progress fills from the right.
- **Severity:** S2. S1 when the arrow on a primary CTA points backwards.
- **Exemplar:** Material bidirectionality; Firefox RTL guidelines; Wikimedia Codex (the Hebrew "?" exception).

#### E3 · Isolate every interpolated value
- **Rule:**
  - **Wrap these:** supplier and product names (including OCR'd ones), SKUs, invoice and allocation numbers, emails, URLs and phone numbers. Use `<bdi>`, or `originalProps()` on an **inline** element.
  - **Never** concatenate raw values next to punctuation inside `t()` strings.
  - **`dir="auto"`** goes only on inputs (with fixed `rtl:text-right ltr:text-left`) or inline spans. Never on `<p>`, `<td>` or flex items: a Latin-first value flips the whole block.
  - **Identifiers** use `<Token kind=…>` = `<bdi dir="ltr" class="font-mono">`, with an optional copy button ("העתק מספר חשבונית" → "הועתק").
- **Check:**
  - Code: `dir="auto"` alongside `flex-1|block|truncate|<p|<td`; render the bidi-torture tenant.
  - Screenshot: "Coca-Cola Ltd." at the end of a sentence keeps its period; "SKU-88 × 2 ק״ג" keeps the 2 next to ק״ג.
- **Severity:** S1 when a number detaches from its unit or a name garbles on a money line. S2 otherwise.
- **Exemplar:** W3C "Inline markup and bidirectional text in HTML"; Gmail's Hebrew isolation of addresses [K].

#### E4 · ₪ and signs render correctly in RTL
- **Rule:**
  - **One wrapper:** money goes through `<Money>` = a plain `<bdi className="tabular-nums">{formatIls(…)}</bdi>`.
  - **Never** put `dir="ltr"` around a he-IL ₪ string. It renders "1,234₪", with the gap on the wrong side.
  - **Signs come from Intl** (`signDisplay:'exceptZero'`, a human-PR addition to `formatIls`), never from `"+" + formatIls()`.
  - **Credits are labelled in words** ("זיכוי ₪120"). No accounting parentheses.
  - In Hebrew, ₪ sits to the visual left of the digits with one NBSP.
- **Check:**
  - Code: `<bdi dir="ltr">` around money returns 0 (baseline about 60, including the dock slip and the supplier portal). Concatenated signs return 0; baseline 6 sites:
    - `recipe-ui.ts:21-25`
    - `price-alert.tsx:73`
    - `over-contract.tsx:84,172`
    - `period-card.tsx:220,225`
  - Screenshot: Playwright asserts that in `he`, the ₪ glyph's `right` is less than the first digit's `left`.
- **Severity:** S0 on the dock slip, supplier portal and claim letters, where a counter-party reads the amount. S1 elsewhere.
- **Exemplar:** Intuit Content Design (the minus goes before the currency symbol); ICU he-IL output.

#### E5 · One visual order for price moves; ranges in words
- **Rule:**
  - **One `<PriceMove from to delta?>`:** the old value at the start, a `←` DirIcon, then the new value at the end (in Hebrew).
  - **Delta chip:** "[+2.50 ₪ · +20.8%]", built with `signDisplay`. It is solid only for T2 (above the contract price).
  - The old value may be struck through (`<s>`, with screen-reader text "היה").
  - **Money ranges** go in words ("בין 10 ל-12 ₪"), never "10–12 ₪".
- **Check:**
  - Code: replace the local `Arrow` components in `recipes-home.tsx:198` and `price-alert.tsx:17`, and the "→" in `overview-card.tsx:82`.
  - Screenshot: recipes, contracts and ask put the old price on the same side.
- **Severity:** S1, because today the same fact appears in opposite orders (baseline [rtl F3]).
- **Exemplar:** the Material sequence rule; "was → now" price chips in banking and market apps [K].

#### E6 · Hebrew typesetting: no letter-spacing, no caps
- **Rule:** `tracking-*` above 0 and `uppercase` appear only behind `ltr:` or `[lang=en]`. Hebrew emphasis comes from weight, size and colour. Eyebrows are 12–14 px, weight 600, muted, `tracking-normal`.
- **Check:**
  - Code: the ungated tracking grep returns 0 (baseline 72, including the leak-hero eyebrow `dashboard/page.tsx:400` and table headers).
  - Screenshot: eyebrows and table headers show no spaced-out letters.
- **Severity:** S2. S1 on the T1 hero eyebrow.
- **Exemplar:** RestoMatch's own marketing shell (`ltr:tracking-[0.18em]`), which already gets this right.

#### E7 · Hebrew orthography and units
- **Rule:**
  - Use gershayim ״ (U+05F4) and geresh ׳ (U+05F3), not ASCII quotes: ק״ג, מע״מ, ח״פ, בע״מ, יום א׳.
  - Use one consistent maqaf or hyphen for number prefixes ("ב-25.10").
  - Search folds both forms.
  - In receiver flows, abbreviations get a spoken form: `<span aria-hidden>ק״ג</span><span class="sr-only">קילוגרם</span>`.
- **Check:**
  - Code: `grep -rnP '[\x{05D0}-\x{05EA}]"[\x{05D0}-\x{05EA}]' apps/web/lib/i18n/messages` returns 0; review `UnitText.tsx`.
  - Screenshot: VAT labels and the units on receiving lines.
- **Severity:** S2. S3 for an isolated string.
- **Exemplar:** ICU he-IL, which emits ק״ג and יום א׳ natively.

#### E8 · Israeli dates, times, weeks and calendar
- **Rule:**
  - **Formats:** short 25.10.2026; medium 25 באוק׳ 2026; long יום ראשון, 25 באוקטובר. 24-hour time, Asia/Jerusalem.
  - **Weeks** start on Sunday; the weekend is Friday–Saturday.
  - **Relative dates** use the Intl dual forms (אתמול, שלשום, לפני שבועיים, מחרתיים), never "לפני 2 ימים". A relative time always has the absolute in a tooltip and a `<time datetime>`.
  - **Delivery and pay calendars** mark holidays, ערב חג and Friday short days.
  - **Date ranges** in words: "מ-25.10 עד 31.10".
  - **Never** MM/DD. ISO dates only in machine contexts such as filenames.
- **Check:**
  - Code: every date goes through `lib/i18n/format.ts`; the date picker's first column is א׳.
  - Screenshot: order delivery dates, approval due dates, the digest.
- **Severity:** S1 for MM/DD or 12-hour time on a money deadline. S2 otherwise.
- **Exemplar:** Israeli bank and payroll apps [K]; the Geist relative-time card [K].

#### E9 · Copy that names the money
- **Rule:**
  - **Claims** are plain-Hebrew sentences: "הספק חייב מעל המחיר שסוכם".
  - **Verbs** say what happens to the ₪.
  - **One term per concept**, from a glossary: דליפה, פער, חריגה, זיכוי, דרישה, each defined once and used identically.
  - **Gender-inclusive address**, one convention product-wide: plural imperative ("בחרו") or infinitive/noun forms.
  - **Concrete numbers:** ₪ and counts, never "some".
  - **No blame.**
  - **Technical actions** ("הרץ התאמה מחדש") go to overflow.
  - **Estimates** say "הערכה".
- **Check:**
  - Code: review the i18n strings against the glossary; grep `he.ts` for mixed singular masculine/feminine imperatives.
  - Screenshot: read every heading and button aloud. An owner could act on each one without a tooltip.
- **Severity:** S1 for an ambiguous money verb (a bare "אשר") or two terms for one concept. S2 for tone or gender drift.
- **Exemplar:** Intuit Content Design; Polaris voice and tone.

#### E10 · Receiver languages keep the Hebrew anchor
- **Rule:**
  - **Hebrew line:** in the ar, ru, th and ti receiver flows, the Hebrew item name stays visible as a secondary line, always on and not behind a toggle, because the paper is Hebrew.
  - **Digits:** Western digits everywhere. Never Arabic-Indic; if ar-IL is ever used, use `ar-IL-u-nu-latn`.
  - **Fonts and language:** script fonts load only when their glyphs appear; `lang` is set per phrase.
- **Check:**
  - Code: the `HebrewToggle` default; the `intlLocaleOf()` mapping.
  - Screenshot: the receiving wizard in ar and th at 390.
- **Severity:** S1 when the receiver can't match the screen to the paper. S2 for font or `lang` issues.
- **Exemplar:** Restaurant365 (count screens mirror the physical order); BeerBoard "Preview Invoice Details".

---

## F. Accessibility (WCAG 2.2 AA + IS 5568): 10 criteria

WCAG 2.2 AA is the bar. It is a superset of whichever WCAG base IS 5568 is read against; the sources conflict, so this rubric covers both.

#### F1 · The legal layer: הצהרת נגישות and consistent help
- **Rule:**
  - **Page:** `/accessibility` (Hebrew default, English available).
  - **Linked from:** every shell footer, dashboard settings, the supplier portal and the receiver PWA.
  - **Contents:**
    - The standard and level: ת״י 5568 AA and WCAG 2.2 AA.
    - The date of the last audit.
    - The browsers and screen readers tested.
    - The accessibility arrangements and the known gaps.
    - The coordinator's name, phone and email, and a response SLA.
  - **No accessibility overlay widget.**
  - **Help and contact** sit in the same place on every page (WCAG 3.2.6).
- **Check:**
  - Code: the route exists, is in `sitemap.ts`, and is linked in MarketingShell, dashboard settings and `/s/[token]`.
  - Screenshot: the footer of each shell.
- **Severity:** S0. The Israeli Service Accessibility Regulations (reg. 35) require it, and the baseline has no statement. The coordinator's name is an owner decision.
- **Exemplar:** the SII, Kol Zchut and TAU accessibility statements.

#### F2 · Contrast for text and controls
- **Rule:**
  - **Text:** at least 4.5:1, or 3:1 at 24 px or 18.66 px bold, against its **actual** background, including tints and gradients.
  - **Non-text:** control boundaries, icons and chart marks at least 3:1. `line-strong` (3.59:1) passes. `line` #D3DDD7 (1.39:1) is decorative only: never a control border and never a focus ring.
  - **Placeholders:** at least 4.5:1.
  - **States:** hover and selected states keep these ratios.
- **Check:**
  - Code: computed pairs from the tokens (table in [rtl §5.4]); recompute any new pair.
  - Screenshot: axe `color-contrast` on each route, plus a manual check on gradients (`flow-stream`, the hero wash).
- **Severity:** S1 (a WCAG 1.4.3 or 1.4.11 failure).
- **Exemplar:** Atlassian and Primer contrast documentation for their tokens.

#### F3 · Focus is visible, strong and never hidden
- **Rule:**
  - **Ring:** the `--c-focus` ring (R-5), 2 px with a 2 px offset, through `:focus-visible` on every interactive element. Never opacity-reduced (`ring-primary/60` measures 2.73–2.81:1), never `ring-line` (1.39:1), never removed without a replacement.
  - **Never hidden:** the sticky header, bottom bar and cookie banner never cover the focused element. Set `scroll-padding-top` and `scroll-padding-bottom` from the measured `--rm-header-h`, `--rm-bottomnav-h` and `--consent-h`.
- **Check:**
  - Code: `ring-line|ring-primary/60` returns 0 (baseline 21 / 86); `scroll-padding` is in `globals.css` (baseline 0).
  - Screenshot: tab through approvals at 390×844 and 1280×800. Every focused element is at least 50% visible and its ring is at least 3:1.
- **Severity:** S1 (WCAG 1.4.11, 2.4.7, 2.4.11).
- **Exemplar:** GitHub Primer (a 2 px focus ring "MUST" be used); Atlassian `color.border.focused`.

#### F4 · Target size and pointer alternatives
- **Rule:**
  - **Fine pointer:** at least 24×24 CSS px, or passes the 24 px circle spacing test (2.5.8).
  - **Coarse pointer:** at least 44×44 (already global). The field spec is in G3.
  - **Drag:** every file drop or reorder has a button alternative, "בחר קובץ" (2.5.7).
  - **Swipe:** every swipe has a visible button twin (2.5.1).
- **Check:**
  - Code: a Playwright bounding-box scan with an allowlist for inline links; the import wizards have file buttons.
  - Screenshot: icon buttons in approval and invoice rows. `h-6 w-6` buttons need the spacing check.
- **Severity:** S1 on primary actions. S2 otherwise.
- **Exemplar:** Apple HIG (44 pt); Material (48 dp); WCAG 2.5.8.

#### F5 · Structure, landmarks and order
- **Rule:**
  - **Headings:** one `<h1>` per page that matches a unique tab `<title>`; heading levels never skip.
  - **Landmarks:** `<header>`, `<nav>`, `<main id>` and `<footer>`, with distinct Hebrew labels (ניווט ראשי / ניווט תחתון).
  - **Skip link:** "דלג לתוכן הראשי" is the first focusable element on **every** shell, including `/s/[token]`, `/scans/[id]`, login and 2FA, invite and the receiver showcase.
  - **Order:** reading and focus order follow visual order.
  - **Tables** use `th`, `scope` and a caption.
- **Check:**
  - Code: `SectionHeader level={1}` per page; a skip link in each layout.
  - Screenshot: axe `landmark-*` and `page-has-heading-one`; a headings-outline check.
- **Severity:** S1 for a missing skip link or `h1` on a primary page. S2 otherwise.
- **Exemplar:** gov.il ("דלג לתוכן המרכזי") [K]; Primer page structure.

#### F6 · Names, language and spoken numbers
- **Rule:**
  - **Icon-only controls** have a Hebrew accessible name from i18n, never an English literal in `he`.
  - **Composite money** exposes one accessible string that NVDA and VoiceOver read as a number: "48,270 שקלים", not "שקל … ארבעים ושמונה".
  - **English phrases** inside Hebrew carry `lang="en"`; proper names are exempt (3.1.2).
  - **Label in name:** an `aria-label` never contradicts the visible text (2.5.3).
- **Check:**
  - Code: audit the `aria-label=` literals (baseline 163) for English; the hero wrapper's `aria-label`.
  - Screenshot: NVDA + Chrome on the owner home; VoiceOver + iOS on receiving.
- **Severity:** S1 on T1, T2 and primary controls. S2 otherwise.
- **Exemplar:** Apple HIG Accessibility; WAI-ARIA Authoring Practices.

#### F7 · Live regions and timing
- **Rule:**
  - **Assertive** (`role="alert"` / `aria-live="assertive"`) only for messages injected after a user action, such as "save failed" or "payment blocked".
  - **Load-time banners** get no role, or `role="status"`.
  - **Toasts** are polite and pause on hover or focus.
  - **Optimistic changes are announced:** "אושר · ₪52".
  - **Timing:** no time limits on decisions; Undo windows (R-7) extend on hover or focus.
- **Check:**
  - Code: triage the `role="alert"` uses (baseline 40, e.g. on a load-time banner at `recipes/price-alert.tsx:53`).
  - Screenshot: the NVDA speech log while loading a page with a banner shows no interruption.
- **Severity:** S1 for load-time assertive alerts on a primary page. S2 otherwise.
- **Exemplar:** the WAI live-region guidance; Red Hat alert accessibility.

#### F8 · Keyboard operability, including shortcuts
- **Rule:**
  - Everything works with the keyboard (2.1.1), with no traps (2.1.2).
  - Single-character shortcuts (J, K, 1, 2, 3, X, Z) are active only while the list has focus, **or** can be turned off in settings (2.1.4).
  - Shortcuts bind to `KeyboardEvent.code`, so they work on the Hebrew SI-1452 layout.
  - Shortcuts are suppressed inside inputs, selects and contenteditable, except Esc and ⌘K.
- **Check:**
  - Code: a shared `useHotkeys`; shortcuts that match `e.key ===` return 0 (baseline `products/names-grid.tsx:107`).
  - Screenshot: approve → open the invoice → go back, keyboard only, with the Hebrew layout active.
- **Severity:** S1 (a WCAG 2.1.1 or 2.1.4 failure).
- **Exemplar:** the Linear and Superhuman shortcut systems; WCAG 2.1.4.

#### F9 · Motion and auto-moving content
- **Rule:**
  - `prefers-reduced-motion: reduce` is honoured everywhere: CSS, scroll-driven animations and GSAP (`gsap.matchMedia()`). Reduced motion means opacity only, 150 ms or less.
  - Anything that moves on its own for more than 5 s next to other content has a visible pause control (2.2.2, Level A). Examples: the marketing `rm-morph` 7 s infinite loop and the hero video.
  - Nothing flashes (2.3.1).
- **Check:**
  - Code: GSAP calls without `matchMedia` (baseline: the `AdjustQuantities.tsx` stagger); a pause control on each loop.
  - Screenshot: emulate reduced motion on the receiver adjust step and on the landing page.
- **Severity:** S1 (2.2.2 is Level A). S2 for GSAP reduced-motion gaps.
- **Exemplar:** Apple HIG Motion; IBM Carbon motion.

#### F10 · Accessible forms and authentication
- **Rule:**
  - **Autocomplete:** personal fields carry it (name, email, tel, organization) (1.3.5).
  - **Errors:** identified in text, with a suggestion (3.3.1, 3.3.3).
  - **No redundant entry:** never ask for what the flow already knows; prefill the restaurant name, the supplier and the VAT id (3.3.7).
  - **Login and 2FA** (3.3.8):
    - Allow paste and password managers.
    - The OTP field is `autocomplete="one-time-code" inputMode="numeric"`.
    - No cognitive puzzles.
  - **Magic link:** the flow says where the email went and offers a resend with a visible timer.
- **Check:**
  - Code: inputs on login, 2FA, set-password, invite and onboarding.
  - Screenshot: paste a 6-digit code into 2FA.
- **Severity:** S1 on auth, where users can get locked out. S2 elsewhere.
- **Exemplar:** GOV.UK form patterns [K]; WCAG 2.2 3.3.7 and 3.3.8.

---

## G. Mobile and receiver field ergonomics: 10 criteria

#### G1 · Field mode is a stricter, focused product
- **Rule:**
  - **Scope:** the receiving list and wizard, the dock slip, the inventory count and orders/capture run under `data-mode="field"` with the field spec (R-13).
  - **Focus mode:** inside a wizard or an active count, the 72 px global bottom nav is hidden and replaced by the flow's own sticky bar. Leaving needs an explicit "× / חזרה" at the top start.
  - **Never:**
    - Gesture-only actions.
    - Moving between items without saving what was typed (Restaurant365's swipe trap).
    - Native `confirm` or `alert`.
    - Structural edits mid-task. A per-row area `<select>` during a count belongs in an "edit layout" mode.
- **Check:**
  - Code: the `data-mode` attribute; the nav is absent on `/dashboard/receiving/[poId]` and `/dashboard/inventory/count`; `window.confirm` in `count-screen.tsx` (baseline).
  - Screenshot: the wizard at 390×844 shows no bottom nav and one sticky bar.
- **Severity:** S0 if navigating loses entered quantities. S1 for exits beside the CTA.
- **Exemplar:** Shopify POS and DoorDash full-screen task flows [K]; Restaurant365 (the anti-pattern: a swipe does not save).

#### G2 · The primary sits in the thumb zone
- **Rule:**
  - **One** primary CTA per field screen.
  - **Size:** full width (viewport − 32 px), 56 px tall.
  - **Position:** pinned to the bottom above `env(safe-area-inset-bottom)`, entirely inside the bottom 33% of 390×844.
  - **Secondary actions** are text buttons above it, never beside it.
  - At 375×667 the capture button is visible without scrolling.
- **Check:**
  - Code: one `data-primary` per screen; Playwright asserts `boundingBox.y ≥ 0.66 × viewport height` and width ≥ viewport width − 40.
  - Screenshot: the receiving scan step at 375×667 (baseline estimate: capture is below the fold).
- **Severity:** S1, because completion at the back door depends on it.
- **Exemplar:** Hoober's thumb study; Apple HIG Buttons.

#### G3 · Built for gloves, sun and hurry
- **Rule:**
  - **Targets:** at least 48×48, with gaps of 8 px or more. Primary CTAs and ± steppers are 56×56.
  - **Text sizes:** button text ≥16 px; body 16 px; item names 17 px at weight 600; quantities and ₪ 24 px bold tabular. The floor is 14 px: no `text-xs` or `text-[11px]` on field routes.
  - **Contrast:** quantities, ₪ and item names use `ink` (≥7:1). `muted` (6.6:1) and `subtle` (5.36:1) fail the field target.
  - **Status** is always icon + word + colour.
  - **Feedback:** a pressed state within 100 ms; haptics only on Android, and only as a secondary signal.
- **Check:**
  - Code: chips `min-h-11` → `min-h-12` (`AdjustQuantities.tsx:325`); steppers `w-12 h-12` → `w-14 h-14`; the order wizard's `size="sm"` buttons; a Playwright 48 px scan on field routes.
  - Screenshot: a glare simulation (+40% brightness, −30% contrast); the numbers stay legible.
- **Severity:** S1 for targets under 44 px or muted numerals. S2 for targets between 44 and 48 px.
- **Exemplar:** Android (48 dp); field-work glove guidance (50–60 px).

#### G4 · Receiving is exception-first and mirrors the paper
- **Rule:**
  - **A clean delivery takes 3 taps or fewer** after opening the PO: capture → confirm → "הכל התקבל כמו בהזמנה". A receive-all path also appears when OCR is slow or has failed.
  - **Lines:**
    - Matched lines are collapsed; exceptions are expanded and sorted by |Δ₪| descending.
    - Line order follows the paper.
    - Ordered and billed quantities sit side by side in one unit: "הוזמן 10 · חויב 8 ק״ג".
  - **Receiving-list cards** have one CTA whose label is the next state: "התחל קבלה" → "המשך קבלה (3/12)" → "ממתין לקריאת חשבונית" (T4) → "הושלם ✓".
  - **Ordering of the list:** the next truck comes first and is enlarged; blocked items sit on top under "דורש טיפול".
- **Check:**
  - Code: the sort in `AdjustQuantities.tsx`; the CTA logic on the receiving-list cards.
  - Screenshot: count the taps for a clean PO; a list showing 3 states.
- **Severity:** S1, because the driver is waiting.
- **Exemplar:** Square (Receive All / None); Shopify POS (Receive all, plus Reject); DoorDash tablet (state button and "Needs Action").

#### G5 · Preset, then stepper, then keypad
- **Rule:**
  - **Input options per exception row, in order:**
    1. Preset chips: as ordered N, as invoiced N, missing, damaged.
    2. A 56 px ± stepper.
    3. Direct entry (per C7), with select-all on focus; `enterKeyHint="next"` jumps to the next **unresolved** exception.
  - **Resolved rows** collapse to one line with "ערוך".
  - **Save feedback:** "נשמר במכשיר" within 300 ms of blur or Enter, then "נשלח" when the server acknowledges.
- **Check:**
  - Code: input types and focus order in `AdjustQuantities.tsx` and `Reconciliation.tsx`.
  - Screenshot: resolve 3 exceptions with one thumb.
- **Severity:** S2. S1 if typing is the only path.
- **Exemplar:** the Restaurant365 count keypad; Apple HIG text fields.

#### G6 · Camera capture that gets it right the first time
- **Rule:**
  - **One tap:** "צלם חשבונית" opens the rear camera (`accept="image/*" capture="environment"`). "העלה קובץ/PDF" is a separate secondary.
  - **Multi-page loop:** "הוסף עמוד" / "סיימתי, שלח N עמודים", with a 64×80 thumbnail strip and per-page retake and delete; up to 10 pages, submitted as one invoice.
  - **Coaching:** corner guides plus a one-line hint in the viewfinder.
  - **Quality check, in under 1 s,** with a **named** reason: "כהה מדי — הדלק אור או התקרב לדלת", blurry, cropped, or a short edge under 1000 px. The corners turn green on pass.
  - **Upload:** a determinate bar with % (`role="progressbar"`). OCR shows named stages.
  - **At 10 s** (baseline 30 s), offer "המשך לפי ההזמנה — החשבונית תושלם ברקע".
- **Check:**
  - Code: `InvoiceScan.tsx`. Baseline: no `capture`, only `files?.[0]`, and a spinner even though `pct` is tracked. Also `STILL_READING_AFTER_MS`.
  - Screenshot: capture a 2-page consolidated invoice.
- **Severity:** S0 for single-page-only capture of multi-page invoices, which misses leak lines. S1 for no rear camera, or an indeterminate upload.
- **Exemplar:** Toast xtraCHEF ("Add page"); MarginEdge (one page per photo, Pending Uploads); BeerBoard SmartBar (a frame that turns green).

#### G7 · Offline-first and resumable
- **Rule:**
  - **Local first:** photos, receipt marks, condition marks and count entries write to IndexedDB first, then sync.
  - **Visible queue:** a persistent chip, "↑ 3 ממתינים לשליחה", opens per-item status (queued, sending, sent, failed + "נסה שוב").
  - **Retries:**
    - Back off 2, 4, 8, 16, 32 s, capped at 60 s; also retry on `online` and on foreground.
    - Never retry a 4xx; show the fix.
    - Every write carries a client UUID, so retries are idempotent.
  - **Resume:** reopening resumes at the same step with the same entries: "המשך מ-07:42 · 5/12 שורות".
  - **Shared tablets:** queued items are attributed to their creator, with an idle lock: "זה עדיין אתה?".
  - **Offline is T4 neutral,** never red.
- **Check:**
  - Code: the scope of `lib/pwa/offlineQueue.ts` (baseline: photos only).
  - Screenshot: in Playwright, go offline, enter 3 count values and 1 mark, reload; they are still present; go online and the queue drains within 10 s.
- **Severity:** S0 for any lost field entry. S1 for no visible queue.
- **Exemplar:** Android offline-first ("lazy writes"); Restaurant365 offline counts; MarginEdge Pending Uploads.

#### G8 · Evidence at the moment of dispute
- **Rule:**
  - Marking a line missing, damaged or overpriced offers a one-tap rear-camera photo (48 px), and adds the line to the dock slip with the ₪ at stake.
  - The slip captures the driver's name (signature optional) before the truck leaves.
  - A credit claim is auto-drafted in `leaks/claims` with the photos. The confirmation is T3: "₪184 נכנסו לדרישה".
- **Check:**
  - Code: the link from `dock-slip.tsx` to the claim draft.
  - Screenshot: mark a short line end to end.
- **Severity:** S1, because lost evidence means a lost claim.
- **Exemplar:** Cut+Dry "Request a credit"; Lightspeed Purchase (discrepancies with photos).

#### G9 · Count and order follow the walk
- **Rule:**
  - **Counting:**
    - Group lines by storage area in walk order, then by shelf or bin order. Never alphabetical.
    - A sticky area header ("מקרר · 7/12 · ₪1,240", 16 px, weight 600, ink) and a horizontal chip bar with a completion ring per area.
    - Enter goes to the next uncounted item, then to the next area.
    - The last count shows as a muted reference ("בפעם הקודמת 12 ק״ג") and is **never prefilled**.
    - Deviations over 50% or over 2× are flagged, with a one-tap "נכון, השאר".
    - Finish at 100%, or once the uncounted items are explicitly accepted.
    - Several counters can each claim an area.
    - Multi-unit rows add up automatically.
  - **Ordering:**
    - Open on the supplier's order guide: the last 90 days, in shelf order, with "במלאי 3 · פאר 6 · בדרך 1 → מוצע 2" prefilled.
    - Offer "כמו בהזמנה הקודמת"; search is secondary.
    - The review shows the literal outgoing document, the delivery date with its cutoff reasoning, and a CTA that names the channel: "שלח לספק ב-WhatsApp".
- **Check:**
  - Code: `count-screen.tsx` (baseline: headers not sticky, a per-row area select, no last count); `orders/new/wizard.tsx` (baseline: search first, quantity defaults to 1).
  - Screenshot: the count at 390 scrolled mid-area; the order build step.
- **Severity:** S1, because count accuracy makes food cost believable and ordering happens against a cutoff. S2 for missing multi-unit rows.
- **Exemplar:** Restaurant365 counts; Craftable bin numbers; Decision Logic (par − pending − on-hand); Lightspeed (draft orders from par).

#### G10 · The phone desk: decide with a thumb, keep the key number in view
- **Rule:**
  - **Decision cards:** below 640 px, owner and manager queues become cards:
    - The ₪ difference at 24 px or more, weight 700.
    - Supplier and item on one line, plus the 3-number why-line.
    - Approve and dispute as full-width 48 px buttons at the card bottom, with the primary on the start (right) side.
  - **Swipe** is optional, always paired with buttons, commits past 50% of the row, and is never used in receiver flows.
  - **After a decision,** the next card slides up and an Undo toast shows.
  - **The key number stays in view** in a sticky bottom summary:
    - Recipe cost: "עלות מנה ₪X · עלות מזון Y% (יעד Z%)", coloured by tier.
    - Order total vs the supplier minimum.
    - Count progress.
    - Pay-run total.
  - **Notifications** deep-link straight to the card.
- **Check:**
  - Code: the approvals mobile layout; the order of the aside in `recipe-editor.tsx` on mobile (baseline: after the whole form).
  - Screenshot: approvals and the recipe editor at 390, scrolled to the bottom.
- **Severity:** S1 if approvals can't be done one-handed. S2 for a missing sticky summary.
- **Exemplar:** BILL mobile (swipe plus "Approve Selected"); Brex mobile task inbox; Galley's food-cost panel.

---

## H. Trust and explainability of findings: 8 criteria

#### H1 · Every flag explains itself, in every density
- **Rule:**
  - **Each discrepancy shows, in order:**
    1. A one-sentence claim.
    2. The ₪ math:
       - Expected, with its source and date: "מחיר חוזה 12.30 · עודכן 01.09".
       - Charged.
       - The difference in ₪ and %, e.g. `₪14.20 × 40 ק״ג − ₪12.90 × 40 = ₪52.00`.
    3. The rule and threshold: "סף: מעל 2% מהמחיר החוזי".
    4. The routing: "עבר אליך כי: מנהל · מעל ₪500".
    5. Related cases: "אותו ספק, אותה בעיה: 3 פעמים ב-30 יום · ₪140".
  - An optional factor chip: "×1.18 מהחציון ל-90 יום".
  - **Compact density** collapses this to one line but **never removes step 2**.
  - **Price alerts** add your price, the contract price, the 90-day median, the % over, and ₪ per month at current volume.
- **Check:**
  - Code: `WhyFlagged` in `approvals/list.tsx:191` (baseline: hidden entirely in compact), reused on invoice lines and claim lines.
  - Screenshot: approvals in compact and in default density.
- **Severity:** S0 if any flag shows a ₪ without its expected and charged basis. S1 if the explanation is hidden in any density.
- **Exemplar:** Stripe Radar risk insights (signals, factor badges, related payments); Brex (line-item explanations).

#### H2 · Evidence is one tap away, beside the data
- **Rule:**
  - **Evidence chips** for the three-way match open a peek (D6): the הזמנה line, the תעודת משלוח line, the חשבונית line, and the חוזה.
  - **Invoice detail at 1024 px and up** is a split view:
    - The document takes 44% at the **start** (the right in RTL). It is sticky, zooms 50–400%, rotates and has page thumbnails.
    - Lines and discrepancies take 56%.
    - Hovering or focusing a line highlights its OCR region, or scrolls the image to its page.
  - **Below 1024 px,** a "מסמך | שורות" segmented control swaps the panes and keeps the scroll position.
  - The scan never requires leaving the page.
  - **The primary action follows the invoice state:**
    - Open discrepancies: "החלט על N פערים · ₪X".
    - A clean invoice: "סמן כנבדק" as a secondary only.
    - "הרץ התאמה מחדש" lives in overflow.
- **Check:**
  - Code: `correction-client.tsx:238` (baseline: the scan opens on a separate `/scans/{id}` page).
  - Screenshot: invoice detail at 1280 and at 390.
- **Severity:** S1, because checking the evidence costs a page load and trust.
- **Exemplar:** Ramp and BILL bill detail (the image beside the fields) [K]; Ramp receipt auto-matching.

#### H3 · The hero is provable to the agora
- **Rule:**
  - **The proof:** the hero ₪, or its tertiary link, opens a proof where Σ lines = the hero to the agora, with counts. It opens with a scope sentence: "כל החשבוניות שהותאמו בין 1–25 באוקטובר · לא כולל 3 חשבוניות ריכוז ממתינות".
  - **Estimates** (annualised leak, ROI, VAT at risk if unclaimed) say "הערכה".
  - **The dashboard** is labelled "חי · מתעדכן".
  - **The monthly report** is labelled "סגור ב-05.11 · לא ישתנה":
    - It is frozen.
    - Late changes appear as dated correction lines, never as a silent restatement.
  - Each links to the other.
- **Check:**
  - Code: `leaks/proof` (flag `leakProof`); the report's close date; the scope sentence in `hero.calc`.
  - Screenshot: hero → proof; add up the lines.
- **Severity:** S0 if Σ ≠ the hero, or a closed report silently changes. S1 for no proof path, or an unlabelled estimate.
- **Exemplar:** Stripe (home charts labelled "estimated" vs Financial Reports); Pilot (live dashboards vs closed books).

#### H4 · Machine-made numbers are labelled, calibrated and grounded
- **Rule:**
  - **Facts get no badge.** Deterministic results carry no % and no AI sparkle: price × quantity, the 18% VAT check, a duplicate invoice number, a missing allocation number.
  - **OCR and fuzzy inputs** get a marker **only below `ocrReviewThreshold`**: a dotted underline, "נקרא מהסריקה — כדאי לבדוק" and a crop of the scanned region. At most 1 marker per card (R-11).
  - **Auto-applied links** (≥0.95) show "קושר אוטומטית · לא נכון?".
  - **AI answers in `/ask`:**
    - Every ₪ gets an inline citation that opens its source in a peek.
    - The "ungrounded" warning sits **above** the answer, in warn tone, and ungrounded numbers render muted.
    - The mode badge ("מהנתונים" / "Claude") stays.
- **Check:**
  - Code: confidence is surfaced in approvals, invoices and receiving (baseline: catalog import only); citation placement in `ask-client.tsx` `AnswerBody`.
  - Screenshot: a low-confidence line; an ask answer containing 2 ₪ figures.
- **Severity:** S1 for an ungrounded ₪ shown as fact, or confidence shown on everything (miscalibration). S2 for a missing auto-link tag.
- **Exemplar:** Google PAIR (calibrated trust); Notion AI (sources); Microsoft HAX guidelines (G2, G11) [K].

#### H5 · Suggestions show their basis and wait for a yes
- **Rule:**
  - **Applies to:** consolidated cross-match, catalog mapping and credit-note allocation.
  - **Pre-filled with the top candidate,** which shows why: "סכום זהה · תאריך ±1 יום · מס׳ תעודה 4471" or "שם דומה 92% · אותו ספק · אותה יחידה". A confidence word goes with it: גבוהה or בינונית.
  - **Only high confidence** is pre-checked.
  - **The only bulk accept** is "אשר את כל ההתאמות הוודאיות (12)". Medium needs a per-row tap.
  - **A dismissed suggestion** never returns.
  - **Auto-accepted items** stay visible as "טופל אוטומטית (N)".
- **Check:**
  - Code: `consolidated.proposal`; `catalog/mapping/mapper.tsx` (baseline: no pre-suggested candidate).
  - Screenshot: the mapping queue.
- **Severity:** S1 for silent auto-apply or pre-checked medium suggestions. S2 for a missing basis.
- **Exemplar:** Xero suggested matches (and their documented failure modes); Linear Triage Intelligence ("hover to see why").

#### H6 · Disagreeing is first-class, and overrides teach
- **Rule:**
  - **"חלוק/דחה"** opens 3–5 reason chips, prefilled by discrepancy type:
    - PRICE_HIGHER: "מחיר מעל ההסכם", "מבצע לא הוחל", "אחר".
    - QTY_SHORT: "לא הגיע", "הגיע פגום", "אחר".
    - Always: "הכלל שגוי / הסף לא נכון".
  - **One tap commits.** Free text is required only for "אחר".
  - **"The rule is wrong"** files a proposal to the owner and never changes a tolerance (human PR).
  - **Overrides teach:** after 5 consistent overrides of the same (supplier, product, type) within 30 days, show a T4 suggestion: "אישרת 5 עליות מחיר של תנובה בחלב. לעדכן את המחיר המוסכם ל-₪6.40?" with [עדכן] [לא עכשיו] [אל תציע שוב]. It edits contract data only.
- **Check:**
  - Code: the reject branch in `approvals/list.tsx` (baseline: a required textarea, with the button disabled until text is typed).
  - Screenshot: a dispute committed in one tap.
- **Severity:** S1 for forced typing on every dispute. S2 for no learning loop.
- **Exemplar:** Ramp ("Policy is wrong" produces a suggested policy change; memo automation that learns from accepts).

#### H7 · Every money object has a readable history
- **Rule:**
  - **Where:** invoice, discrepancy, claim and PO pages have a "היסטוריה" section.
  - **Each entry shows:**
    - Who: the name and a role chip.
    - The verb.
    - Before → after: ₪ and status.
    - When: absolute `dd.MM.yyyy HH:mm` in Asia/Jerusalem, plus a relative hint.
    - The source: OCR, user, rule #id, or a supplier reply.
  - **Display:** newest first; the latest 3 plus "הצג הכל (12)"; read-only.
  - **Reach:** one click from any ₪ that a decision changed. It exports with the claim letter.
  - **Bulk actions** log one entry per item.
- **Check:**
  - Code: the audit log is surfaced per object.
  - Screenshot: an invoice after an approval and a correction.
- **Severity:** S1 on claims and approvals, where supplier disputes need the record. S2 elsewhere.
- **Exemplar:** Brex per-expense audit trail; BILL approver trail.

#### H8 · Deadlines are countdowns with dates
- **Rule:**
  - **Applies to** anything with a clock: the VAT allocation-number deduction deadline, a supplier's reply window, a credit's expected date, a supplier's order cutoff.
  - **Format:** "נותרו 6 ימים · עד 31.10.2026".
  - **Tone by time left:**
    - Neutral above 7 days.
    - Warn-solid at 7 days or less.
    - Danger-solid when late, with "באיחור 3 ימים".
  - **Accessible name:** the full sentence.
  - **Sorting:** queues sort by days left within each severity.
  - **Never** a bare "!", and never a raw age with no deadline.
- **Check:**
  - Code: `recovery/tracker-client.tsx:271` (baseline: a bare `!` badge and a raw `ageDays`); `vat-at-risk.tsx`; the invoice VAT note's `daysLeft`.
  - Screenshot: the recovery tracker.
- **Severity:** S1, because a missed deadline is lost ₪.
- **Exemplar:** Stripe Disputes (`due_by`, `past_due`, one submission).

---

## I. Speed, perceived performance and micro-interaction: 7 criteria

#### I1 · Latency budgets you can measure
- **Rule:**
  - **Tap or keypress → visual commit:** under 100 ms (aim for under 50).
  - **Route change:** the destination shell in under 100 ms; content in under 1 s.
  - **Core Web Vitals,** on a mid-tier Android over 4G:
    - LCP ≤2.5 s; the hero ₪ is the LCP candidate.
    - INP ≤200 ms.
    - CLS ≤0.1, with a target of ≤0.05.
  - **Fonts** swap without reflow (the metric-matched fallback already exists).
  - **Work over 10 s** offers "leave and we'll notify you", and the result lands in Needs-you.
- **Check:**
  - Code: Web Vitals on preview deploys (`test-sentinel`); `RouteProgress` is only a fallback.
  - Screenshot: a WebPageTest filmstrip of `/dashboard` on a mid-tier phone profile.
- **Severity:** S1 for INP over 500 ms on a decision, or LCP over 4 s on the home. S2 for anything within 2× of budget.
- **Exemplar:** Superhuman (the 100 ms rule); Linear (local-first); Google Core Web Vitals.

#### I2 · Decisions are optimistic, advance, and roll back in place
- **Rule:**
  - **Applies to** approve, dispute, escalate, map and accept. Each updates local state synchronously.
  - **On commit:**
    - The row exits in 150 ms (opacity + height; instant under reduced motion).
    - The summary tiles recount at once.
    - Focus moves to the next row (or the previous one if this was the last) and the scroll stays put.
    - The server call runs behind.
  - **On failure,** the row re-inserts at its **original index** with an inline error and "נסה שוב".
  - **Never** call `router.refresh()` or refetch page 1 to remove a row the user just decided.
- **Check:**
  - Code: `onSuccess: refreshFirstPage` in `approvals/list.tsx` (baseline), `act()` in `inbox-client.tsx`, and `mapper.tsx`; look for `useOptimistic` or `setData`.
  - Screenshot: throttle to 3 s. The row is gone and "₪ בסיכון" has updated within 100 ms. A forced failure returns the row to the same index.
- **Severity:** S1, for throughput and calm in the core queue.
- **Exemplar:** Superhuman (auto-advance, Undo); Linear (transactions with rollback); React `useOptimistic`.

#### I3 · Wait states follow the ladder
- **Rule:**

  | Wait | Show |
  |---|---|
  | Under 1 s | Nothing; no spinner flash |
  | 1–3 s | Indeterminate: a skeleton for content, a spinner inside the button for actions |
  | 3–10 s | Determinate, with text: "מעבד חשבונית… שלב 2 מתוך 3" |
  | Over 10 s | A background task plus a notification when done |

  - A progress indicator never sits still for more than 2 s without a label change.
  - Never show "טוען…" when progress is knowable.
- **Check:**
  - Code: spinner delay thresholds; the OCR and export flows.
  - Screenshot: a throttled run of search, export and OCR.
- **Severity:** S2. S1 on the receiver's OCR wait.
- **Exemplar:** GitHub Primer loading pattern; NN/g response-time limits (0.1 / 1 / 10 s); Apple HIG progress indicators.

#### I4 · Layout-true skeletons and prefetchable shells
- **Rule:**
  - **Coverage:** every dynamic dashboard segment has a `loading.tsx`, so Next can prefetch a shell on viewport and hover.
  - **Layout:** skeletons copy the final grid at each breakpoint. For the home: a hero of about 280 px on mobile and 240 px on desktop, 3 Needs-you rows and 2 KPI cards.
  - **Content:**
    - Static titles render as real text; only dynamic values are placeholders.
    - Skeletons only for containers and data, never for buttons, toasts, menus or dialogs.
    - The T1 number loads first, and the rest streams in.
  - **Accessibility:** `aria-busy` on the region; no shimmer under reduced motion.
- **Check:**
  - Code: a coverage script (baseline: 10 of 43 pages); skeleton bounding boxes within 8 px of the final layout.
  - Screenshot: in a filmstrip, nothing jumps when the content lands.
- **Severity:** S1 for the home and the queues. S2 elsewhere.
- **Exemplar:** Polaris SkeletonPage; IBM Carbon loading pattern; Next.js prefetching (down to the nearest loading boundary).

#### I5 · Motion has a reason and a budget
- **Rule:**
  - **Tokens:**

    | Token | Duration | Used for |
    |---|---|---|
    | micro | 100 ms | hover, press, toggle |
    | short | 150 ms | fade, tooltip, row exit |
    | medium | 240 ms | toast, popover, drawer, peek, palette |
    | long | 400 ms | sheet, large expansion |

  - **Exits** run at 0.5–0.7× the entrance duration.
  - **Easing** (IBM Carbon, productive): standard `cubic-bezier(0.2,0,0.38,0.9)`, enter `(0,0,0.38,0.9)`, exit `(0.2,0,1,0.9)`.
  - **Never** `transition-all`; list the properties.
  - **Frequent actions** get no motion beyond the 100 ms state change. The user never waits for an animation.
  - **List entrances** travel 12 px or less.
  - **Marketing loops** are banned inside `/dashboard`.
- **Check:**
  - Code: `transition-all` in `dashboard` and `lib` returns 0 (baseline 53); every `duration-*` maps to a token.
  - Screenshot: a 60 fps screen recording of approve, peek and toast.
- **Severity:** S2. S1 if motion delays a decision.
- **Exemplar:** IBM Carbon motion; Atlassian (exits at 0.5×); Material 3 duration tokens.

#### I6 · A keyboard triage grammar that teaches itself
- **Rule:**
  - **One grammar on every queue** (approvals, inbox, mapping, claims, price alerts), per R-9:

    | Key | Action |
    |---|---|
    | J / K, or ↓ / ↑ | move |
    | Enter | peek |
    | O | open |
    | 1 / 2 / 3 | primary / dispute / defer |
    | H | snooze |
    | X | select |
    | Shift+X | select a range |
    | Z | undo |
    | ? | cheat sheet |

  - **The focused row** shows the focus ring and `aria-selected`.
  - **Teaching:**
    - Shortcut chips appear in tooltips and menus ("אשר · 1", in `<kbd dir="ltr">`).
    - After 3 mouse approvals, a one-time coach mark: "טיפ: לחצו 1 לאישור, 2 לחלוקה".
- **Check:**
  - Code: one shared `useHotkeys`; the same digits on every queue.
  - Screenshot: the `?` sheet.
- **Severity:** S2. S1 for the bookkeeper and manager queues at volume.
- **Exemplar:** Linear Triage (1/2/3/H); Superhuman (E/Z, and a palette that teaches shortcuts); Emburse approval keys.

#### I7 · Buttons feel alive and never double-post
- **Rule:**
  - **Pressed state:** visible within 100 ms (`active:`).
  - **Async buttons:**
    - Enter loading at once, with a spinner inside the button and no width change.
    - On success: "✓ נשלח" for 1.5 s, then back to rest.
    - On failure: an inline error and "נסה שוב".
    - Disabled while in flight.
  - **Idempotency:** every money write carries a client UUID.
  - **State layers:** hover, selected and pressed use consistent opacities (hover 0.08, pressed 0.12).
- **Check:**
  - Code: the `Button` loading prop; idempotency keys on approve, claim and receipt writes.
  - Screenshot: double-tap "אשר תשלום" on a slow network; one request goes out.
- **Severity:** S0 if a double tap can double-post a money action. S2 for missing pressed or success states.
- **Exemplar:** IBM Carbon inline loading; Primer saving lifecycle; Material 3 state layers.

---

## J. Delight and brand polish: 4 criteria

#### J1 · Celebrate caught money quietly, once
- **Rule:**
  - **When the last T2 item clears or a claim is marked recovered,** the T3 tile counts up once, in gold, in 600 ms or less, from the old ₪ to the new. `aria-live="polite"` announces the final value.
  - **The hero** may count up once on first load (400 ms or less), never on revalidation.
  - **Never:** confetti, sound, or more than once per session.
  - **Reduced motion** swaps the value instantly.
  - Inbox-zero and clean-month states read as earned calm (C8, A4).
- **Check:**
  - Code: the count-up is guarded by a session flag and by reduced motion.
  - Screenshot: clear the last approval.
- **Severity:** S3. S2 if it repeats on every revalidation.
- **Exemplar:** Superhuman's inbox-zero reward; Mercury's calm positive states [K].

#### J2 · The first ₪ arrives fast
- **Rule:**
  - **Onboarding** is a checklist of at most 4 steps with a visible "2/4":
    1. Photograph or connect 1 invoice.
    2. Add 1 contract or last price.
    3. Run a match.
    4. See the ₪.
  - **Time to first ₪:** 10 minutes or less.
  - **Until then,** the hero shows a labelled sample.
  - **The marketing leak-check result** renders the same T1 hero as the app.
  - **`/login`** links back to the site and the demo, and explains the magic link.
- **Check:**
  - Code: `onboarding/page.tsx`; the leak-check result compared with `LeakHero`.
  - Screenshot: a new tenant from the landing page to the first ₪, timed.
- **Severity:** S1, because activation is the North Star's front door. S2 for seam issues.
- **Exemplar:** Stripe and Ramp setup checklists [K]; Ramp (first value without an ERP integration).

#### J3 · One product on every surface
- **Rule:**
  - **Surfaces:** marketing, showcase and demo, auth, dashboard, admin, the supplier portal `/s/[token]`, print and A4 (proof, claim letters, leak card, monthly PDF), OG images, and email and WhatsApp previews.
  - **Shared:** the light tokens, the type scale, ₪ rendering (B2, E4), radius and elevation, and the copy voice.
  - **The demo** looks like the product a prospect will get. Baseline: the showcase has its own max-w-7xl, radial background and GSAP; admin has dark-era mono uppercase headers.
  - **Print surfaces:** A4, Hebrew RTL, the same hierarchy (T1 ₪ first), page numbers and a generated-at timestamp.
- **Check:**
  - Code: every shell consumes the same tokens, with no per-shell inline colours.
  - Screenshot: one contact sheet with every surface side by side.
- **Severity:** S2. S1 for client-facing artifacts: claim letters, the supplier portal, the demo.
- **Exemplar:** Stripe (dashboard, docs, receipts and email feel like one product) [K]; Linear.

#### J4 · Pixel craft and restraint
- **Rule:**
  - **Motif:** the `flow-stream` primary→gold line is an accent only (the header hairline, plus at most one section accent per view).
  - **Decoration:**
    - At most 1 decorative gradient or glow blob per view.
    - No dark-era neon.
    - Illustrations only in first-use empty states and marketing, never in error states.
  - **Icons:** one family and stroke weight. Icon size follows the text: 16 with 14 px, 20 with 16 px, 24 with 20 px and up; 12 px only for filled status glyphs. Icons and text are optically centred.
  - **States:** hover, pressed, selected and disabled look the same everywhere.
  - **Bugs to catch:**
    - Elements double-rendered across breakpoints.
    - Overlaps.
    - Clipped Hebrew.
  - **Polish:**
    - `text-wrap: balance` on headings.
    - A per-route `<title>` ("אישורים · RestoMatch").
    - Favicon, selection colour and scrollbars that match the theme.
- **Check:**
  - Code: count `flow-stream|glow-*-blob|leak-gradient` per page; icon sizes vs the adjacent text class.
  - Screenshot: 200% crops of headers, chips, buttons and table rows at 390 and 1280; check `md:hidden` duplicates (the PR #67 class of bug); squint to confirm decoration never competes with T1 or T2.
- **Severity:** S3. S2 when an owner would see it on a primary page, or when decoration out-shouts a ₪.
- **Exemplar:** Linear; Vercel Geist [K]; Apple.

---

## Appendix: machine-check pack (for `test-sentinel`; run from the repo root)

```bash
# B1 type floor and arbitrary sizes
grep -rnE "text-\[(8|9|10|11)px\]" apps/web/app apps/web/lib --include=*.tsx          # → 0
grep -rnE "text-\[[0-9.]+(px|rem)\]" apps/web/app/dashboard --include=*.tsx          # → 0
# B2 money not in mono
grep -rn "font-mono" apps/web/app apps/web/lib --include=*.tsx | grep -E "formatIls|ils\(|money\(|₪"   # → 0
# B4 compact currency
grep -rn "notation: *'compact'" apps/web                                              # → 0 for ILS
# B7 radius / legacy glow names
grep -rhoE "rounded-(sm|md|3xl|\[)" apps/web/app/dashboard                             # → 0
grep -rn "shadow-glow-" apps/web --include=*.tsx                                       # → 0 after rename
# B8 hex and alpha-hacked semantics
grep -rnE "#[0-9a-fA-F]{6}\b" apps/web/app apps/web/lib --include=*.tsx | grep -v "/og/"   # → 0
grep -rnE "(bg|text|ring|border)-(danger|warn|gold|primary|info)/[0-9]+" apps/web --include=*.tsx  # → 0 after roles
# C7 number inputs
grep -rn 'type="number"' apps/web --include=*.tsx                                       # → 0 for money/qty
# C10 / G1 native dialogs
grep -rnE "window\.(confirm|alert)\(" apps/web/app                                      # → 0
# E1 physical CSS
grep -rnE "\b(ml|mr|pl|pr)-[0-9]|\btext-(left|right)\b|\b(left|right)-[0-9]" apps/web/app apps/web/lib --include=*.tsx  # → allowlist only
# E2 raw direction icons and hard-coded forward arrows
grep -rnE "<(ArrowLeft|ArrowRight|ChevronLeft|ChevronRight)\b" apps/web --include=*.tsx | grep -v DirIcon  # → 0
grep -rn "→" apps/web/lib/i18n/messages --include=he.ts                                 # → 0 (non-comment)
# E4 money forced LTR / concatenated signs
grep -rnE '<bdi dir="ltr"[^>]*>\s*\{?(formatIls|ils|money|ilsDelta)' apps/web --include=*.tsx  # → 0
grep -rnE "\+\{(formatIls|ils)\(|['\`]\+['\`]\s*\+\s*(formatIls|ils)\(" apps/web --include=*.tsx  # → 0
# E6 letter-spacing on Hebrew
grep -rnE "(^|[ \"'\`])tracking-(wide|wider|widest|\[[0-9.]+em\])" apps/web --include=*.tsx  # → 0 (ltr: forms allowed)
# E7 ASCII quotes in Hebrew abbreviations
grep -rnP '[\x{05D0}-\x{05EA}]"[\x{05D0}-\x{05EA}]' apps/web/lib/i18n/messages          # → 0
# F3 weak focus rings / scroll padding
grep -rnE "ring-line|ring-primary/60" apps/web --include=*.tsx                          # → 0
grep -n "scroll-padding" apps/web/app/globals.css                                       # → ≥1
# F7 alerts to triage
grep -rn 'role="alert"' apps/web/app --include=*.tsx                                    # triage each
# F8 layout-fragile shortcuts
grep -rnE "e\.key(\.toLowerCase\(\))?\s*===" apps/web --include=*.tsx                   # → 0 for shortcuts
# G6 rear camera on capture inputs
grep -rn 'capture="environment"' apps/web/app                                            # → present in InvoiceScan
# I5 transition-all
grep -rn "transition-all" apps/web/app/dashboard apps/web/lib                           # → 0
# C8 / I4 loading coverage (every dashboard page has a sibling or ancestor loading.tsx)
for p in $(find apps/web/app/dashboard -name page.tsx); do d=$(dirname "$p"); ok=0; \
  while [ "$d" != "apps/web/app" ]; do [ -f "$d/loading.tsx" ] && ok=1 && break; d=$(dirname "$d"); done; \
  [ $ok = 1 ] || echo "NO LOADING: $p"; done                                              # → no output
```

Playwright gates (spec owned by `test-sentinel`; CI wiring is human):
- `scrollWidth ≤ innerWidth` at 320 and 390 on all non-compact routes (B9).
- `boundingBox` ≥ 24 px on desktop, ≥ 44 px on coarse pointers, and ≥ 48 px on field routes (F4, G3).
- Exactly one `th[aria-sort]` ≠ `none` per sortable table (C1).
- In `he`, the ₪ glyph sits left of the digits (E4).
- In `he`, the chart's last point is right of its first (C14).
- Offline queue round-trip (G7).
- Optimistic approve within 100 ms under a 3 s throttle, and rollback to the same index (I2).
- `Ctrl+K` works with the Hebrew layout (D4, F8).
- Reduced-motion emulation leaves no transform animations (F9).
- axe `wcag22aa` passes on every route in `he` and `en` (F).
