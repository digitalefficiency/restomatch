# DS2 · Judge panel verdict · פסק דין

- **Date:** 7.11.2026 · **Base:** `origin/main` @ `4c887688`.
- **Panel input:**
  - the three prototypes (`proto-A|B|C/`), with their screenshots, `NOTES.md` and audits;
  - `DS2-SPEC.md`, `directions.json`, `fonts/FONTS.md` (with `numerals.jpg` and `digits-13px.jpg`) and `PROCESSES.md`;
  - the W2-15 brief and the wave-2 merge order (`git show origin/claude/wave2-kit-addendum-0711:docs/ux/wave2/…`).
- **Status:** a recommendation only. Nothing in the repo was edited and nothing was pushed. Every repo change below is a proposal for the owning agent's PR (AGENTS.md ownership map), and a human merges and deploys.

---

## בקצרה · For the owner

1. **ההמלצה: כיוון A · מאזן (IBM Plex Sans Hebrew), עם השתלות מ-B ומ-C.** הוא מנצח בכל שקלול סביר. הסיבה העיקרית היא לא הטעם: **A הוא הכיוון היחיד שלא משנה אף צבע קיים.** לכן אפשר להכניס אותו באמצע גל 2 בלי להזיז מסכים של צוותים אחרים. ל-B ול-C יש פלטות חדשות, ולפי החוזה של גל 2 הן יכולות להיכנס רק אחרי 5.12.
2. **החולשה של כל כיוון, בלי הנחות:**
   - **A:** הספרות של Plex רחבות יותר. באב-הטיפוס, כרטיס "הכסף שחוזר אליך" במסך הבית נשבר ב-1440 וגם ב-1280, ו-₪1,759 נכתב על הכותרת שמתחתיו. בנוסף, במסך האישורים נכנסות רק כ-7 החלטות כשיש כותרת לכל חשבונית.
   - **B:** נראה כמו גופן ברירת המחדל של אנדרואיד. פס של 5 סכומים זהים מחליש את הדליפה, ובזמן בחירה יש 2 כפתורים ירוקים מלאים.
   - **C:** ‏Rubik לא טבלאי מעצמו, כך שכל עמודת ₪ תלויה בכלל שאסור לשכוח אף פעם. במסך הבית מופיעים ₪760 וגם ₪759.54, ועוד 8 סכומים גדולים מתחרים בדליפה.
3. **מה לוקחים מהאחרים:**
   - **מ-B:** קיצורי מקשים עם האות העברית ליד הלטינית (J / ח); לשוניות עם סכום ₪; כותרות עמודות בספירה; סימון "הבא בתור".
   - **מ-C:** ₪ בתחילת השורה (₪ ← מה ← פעולה); אזורי "ממתין" שקטים; גיליון חריגה עם שלבים ממוספרים; ברכת בוקר.
4. **החלטות שמחכות לך:**
   - הגופן: Plex, או Rubik / Noto / להישאר עם Heebo;
   - מספרי חשבונית בגופן רגיל, בלי Mono;
   - צפיפות ברירת מחדל לפי תפקיד;
   - הטון: "מבוקר ורגוע + שפה אנושית";
   - פינות 12 ולא 8.

   פירוט ב-§7.
5. **בלי לשבור את הפיילוט (11.11) ואת הרכבות:**
   - **רכבת α ‏17.11:** טוקנים בלבד, אפס שינוי בפיקסלים.
   - **רכבת β ‏24.11:** החלפת הגופן, אחרי שבועיים של פיילוט, עם תקציב משקל ובדיקת ₪.
   - **γ ‏1.12 ו-δ ‏8.12:** רכיבים משותפים.
   - **גל 3:** המסכים עצמם.

---

## 1. Method (and what the panel checked itself)

The panel did not take the builders' audits on trust. Here is what it checked itself:

| Check | How | Where |
|---|---|---|
| Every screenshot of A, B and C | Viewed at full size: home, approvals (selected, focus and capacity) and the three dock phones | `proto-*/shot-*.jpg` |
| **Layout robustness at 1440 and at 1280** (the pilot owner's laptop may be 1280–1366; none of the builders rendered it) | Playwright run over each prototype served by HTTP. For every visible text leaf it records overlapping text boxes, clipped text, ₪ figures at ≥24 px, the smallest font size and horizontal scroll. Every hit was confirmed by eye: sr-only words and ellipsis ranges are false positives | `judge/judge-check.cjs` → `judge/judge-check.json`, `judge/{A,B,C}-{home,approvals}-1280.jpg`, `judge/A-moneyback-crop.jpg` |
| Text below 12 px, filled-primary count, red rails | A second Playwright pass on approvals | `judge/small.cjs` |
| The same figure at two precisions on one screen (N8) | Searched the prototype sources for `759.54` | — |
| Font evidence | Read `numerals.jpg`, `digits-13px.jpg` and the FONTS scorecard | `fonts/` |

**What the panel found that the builders did not report:**

| # | Direction | Finding | Evidence |
|---|---|---|---|
| F1 | **A** | **Home, "הכסף שחוזר אליך": the two T3 figures collapse.** Labels wrap one word per line, and ₪1,759 is painted over "מחירים שעלו · 30 יום" and over the table header. This happens at **1440** and gets worse at **1280**. The contrast audit cannot catch it | 3 real text collisions at 1440; `judge/A-moneyback-crop.jpg` and `judge/A-home-1280.jpg` |
| F2 | **A** | At 1280, the TaskRow titles truncate ("4 פערים מחכים ל…"). That breaks A's own claim that no label is cut off | `A-home-1280.jpg` |
| F3 | **A** | The approvals desk puts a header on **every** invoice, including invoices with a single gap, so the ₪ is printed twice (header + row). Capacity drops to **6.8 decisions** at 1440, under the ≥10 floor | A `NOTES.md` §limits; `shot-approvals.jpg` |
| F4 | **A** | The undo-ring digit is 11 px, below the 12 px desk floor (trivial) | `small.cjs` |
| F5 | **B** | While a selection exists, **2 filled primaries** are on screen (the bulk bar and the focused row). A and C demote the row's verb, as D1 together with §4.1 intends | `proto-B/shot-approvals.jpg` |
| F6 | **B** | A 3 px **red rail on every blocking row in a queue, whatever its due date.** The capacity render shows 6 of them. That breaks C5: in a queue, bold only when the row is overdue or due within 48 h | `shot-approvals-capacity.jpg` |
| F7 | **B** | At 1280 the decision sentence is cut ("מחיר גבוה מהמצופה · בירה מה…"), so P1, "every task is a sentence", is lost exactly where the owner works | `judge/B-approvals-1280.jpg` |
| F8 | **B** | On the dock, the primary is not full width (the camera sits beside it), and the photo is a small button inside the exception sheet. Rows are 64 px with 56 px ✓ targets, which leaves about 8 px between the thumb targets of adjacent rows: tight for gloves | `shot-receiving-flow.jpg` |
| F9 | **C** | **₪760 (hero) and ₪759.54 ("סה״כ" of the supplier card) on the same home page.** This is the live/01 ↔ live/03 trust bug that N8 was written to kill | `proto-C/index.html`; `shot-home-full.jpg` |
| F10 | **C** | TaskRows use `money-card` 28 px, so **8 ₪ figures at ≥24 px** sit above the fold at 1440 (A has 3 and B has 5). The hero still wins, but only by size, not by being alone. N9 puts task rows at `money-row` | `judge-check.json` `bigMoney` |
| F11 | **C** | At 1280 the bulk bar clips its caps text, and the promoted verb in the focused row covers the invoice ID ("…121") | `judge/C-approvals-1280.jpg` |
| F12 | **C** | Exception rows jump to the top of the count list, so the list reorders under the receiver's thumb mid-count. The photo is "(מומלץ)", which makes it optional | `shot-receiving-board.jpg` |

**Shared gaps (all three), which limit how far this verdict reaches:**
- Only 3 surfaces were built: home, the approvals desk and the dock. The phone DecisionCard, SendSheet (J4), pay run (J11), month close (J8) and palette (J9/J10) are not built, so their step counts are unverified in every direction.
- The demo has 4–5 open gaps. The ≥10 capacity was therefore measured on padded or extrapolated data, and only at 1440.
- There are no `en` renders, no 1280 renders from the builders, and the five-owner check (PROCESSES §9) has not been run.

## 2. Scores

The scale runs from 1 to 10, where 10 means world-class for this product, and every score cites evidence. The weights reflect the North Star and the calendar: ₪ trust ×3; speed, field, hierarchy and implementation risk ×2; typography and brand ×1.5; a11y and fonts ×1.

| Criterion (weight) | **A · מאזן** (Plex) | **B · דיוק** (Noto) | **C · מטבח** (Rubik) |
|---|---|---|---|
| **₪ legibility & trust** (×3): T1 hero, money cells, tabular figures | **8**. The best ₪ in the set: drawn to figure height (0.698 em), with distinct 1/l/I and tabular by default. The approvals ₪ ends on one x (881 px). Loses points for F1, an illegible T3 ₪ on the first screen, and F3, the double ₪ | **7**. Clean tabular cells and a hero at 800. The ₪ sits slightly below the figure height, and 1/l/I score 3/5. The flat 5-figure strip dilutes T1 | **7**. `tnum` enforced (0 digit nodes without it), and decimals align within 0.5 px. But F9 (two precisions of the leak on one screen) and F10 (8 big ₪) |
| **Hebrew typographic quality** (×1.5): rhythm, x-height, mixed Latin | **8**. The tallest Hebrew (מ 0.618 em), calm semibold heads and looser line-heights. Plex Mono IDs add a typewriter texture inside Hebrew sentences | **6**. Competent and neutral, with 650 heads. Hebrew condensed to 87.5% in compact is risky for owners over 50. Reads as the Android system face | **7**. Sturdy and friendly, with the best Hebrew–Latin harmony and +1 px small roles. Heavy at 700, and the face is very common on Israeli sites |
| **Operator speed** (×2): steps, one primary action, batch/keys/thumb | **7**. J2 takes 1 key; bulk takes 3 presses; J1 takes 2 presses. F3 caps the desk at 6.8 decisions | **9**. The densest desk (11 per screen), a Hebrew-keycap hint bar, filters plus a density toggle, and tabs carrying Σ₪. F5 and F7 cost a point | **8**. 10.4 decisions (11.9 compact). The ₪→what→verb grammar is the same on home and desk. The keyboard test passes with 1 primary after every step. F11 |
| **Field usability on the phone** (×2): glare, gloves, no ₪ for the receiver | **9**. 72 px rows (8 per screen), a 56×56 ✓ with the word "הגיע" on the start edge, a full-width photo secondary, saved ● vs queued ⟳ per line, and 0 ₪ | **7**. 9 rows. Column headers, "הבא בתור" and the ✓ turning into "חסר" are excellent. F8 | **8**. 80 px rows (only 7 per screen), numbered exception steps, "נשמר גם בלי קליטה", and 0 ₪. F12 |
| **Hierarchy, tiers T1–T4** (×2) | **8**. One hero with a red rail and a secondary CTA. T2 budget 3 on home. Queue chips subtle unless due. A T4 "ממתין לאחרים" group | **6**. The hero sits inside a strip of 4 equal `money-card` tiles. F5 and F6 make it the loudest of the three despite "colour only in chips" | **6**. T4 sunken wells are the best of the three, and T3 is calm. F10 dilutes T1, and F9 undermines it |
| **Accessibility** (×1): AA, focus, sizes | **8**. Minimum contrast 5.67. Focus ring 2 px blue. 12/14 px floors (except F4) | **7**. Minimum 5.54, 12/14 floors. Condensed Hebrew and 28 px compact rows are hard for older owners | **8**. Minimum 5.54, 12/14 floors; +1 px on small roles; 80 px touch rows |
| **Brand fit, Israeli owner-operator** (×1.5) | **7**. "Audited" and calm, which serves "a number I believe". Risk of reading as bank or IBM software | **5**. Linear/Stripe-generic. On Android (about 67% of IL phones) it looks like the system font | **8**. "Of the restaurant": warm paper and "בוקר טוב, רום". Its softness works against "audited" |
| **Implementation cost/risk** (×2), on today's Tailwind tokens with wave 2 in flight | **9**. **Colours unchanged.** The font is one variable. Radius and elevation go through primitives. The only cost is interim mixed radii until the phase-5 codemods | **5**. **Re-values v1 neutrals** (`--c-bg/ink/muted` …), which the wave-2 contract forbids before phase 5. Panes-not-cards restructures page shells inside wave-2 areas | **6**. **Re-values the v1 status and neutral colours** (same contract problem) and adds a permanent `tnum` lint tax. Card radius 16 equals today's, so less shape churn |
| **Font licence/performance** (×1) | **7**. OFL. Static: 4 weights ≈ 97 KB, preload ≈ 49 KB, plus Plex Mono 14 KB. Heebo today is 41 KB | **9**. OFL. One variable pair of 51.4 KB covers every weight and width, and is the same family as the receiver scripts | **9**. OFL. 43.6 KB variable. Secular One is guarded to marketing (its ₪ is the ש״ח form) |
| **Unweighted mean** | **7.9** | **6.8** | **7.4** |
| **Weighted score** | **8.0** | **6.7** | **7.3** |

**How robust the ranking is.** A stays first however the weights move:
- with implementation risk ignored: A 7.8, C 7.5, B 7.0;
- with brand ×3 and speed ×1: A 7.9, C 7.3;
- with speed ×4 (the bookkeeper channel first): A 7.9, C 7.4, B 7.0.

B is never first: its speed lead is outweighed by brand, hierarchy and the contract cost.

## 3. Each direction's weakest point (adversarial)

| | Weakest point | Why it matters | Can it be fixed inside the direction? |
|---|---|---|---|
| **A** | **Horizontal economy.** Plex digits are about 8% wider ("1,267.50" is 4.14 em against Heebo's 3.83), and A's flat 2-up money tiles broke on A's own home page (F1, F2). Grouping under the ≥10 floor (F3) is the same disease: A spends width and rows on structure | The owner's first screen showed an illegible ₪, which is the North Star failing in miniature | **Yes.** Size money in `ch`, never put 2 `money-card` figures side by side under 480 px, wrap titles instead of truncating them, and drop the header for single-gap invoices. Then gate it with the overlap check at 1280 (§9) |
| **B** | **Identity and emphasis.** Noto is what an Android phone already shows. The hero lives in a strip of 5 equal figures, and in queues there are 2 filled primaries plus a rail on every blocking row | "Five equal red tiles is the same as none" (PROCESSES §8.4), and the product looks like any SaaS tool | Partly. The emphasis issues are fixable. The generic face and the contract cost (new neutrals) are intrinsic |
| **C** | **The guardrails of the money voice.** Rubik's digits are proportional by default, so every money surface depends on a lint rule and an e2e check forever. The prototype itself shows the leak at two precisions (F9) and 8 large ₪ figures | One forgotten class misaligns a column, and the bookkeeper notices first. Two versions of ₪760 cost the owner's belief | Partly. F9 and F10 are fixable. The `tnum` dependency and the colour re-valuation are intrinsic |

## 4. Recommendation

**Choose A · מאזן as the base**, with the grafts in §5 and the fixes in §6 done in the lab before the owner sees the final four reference screens.

**Why A:**
1. It serves the North Star directly. It has the only figure-height ₪ and the only unambiguous 1/l/I, and a ruled, flat page makes the figure look checked rather than marketed.
2. **It is the only direction that obeys the wave-2 contract** (DS2 §5.6 rule 1: nothing re-values an existing CSS variable before phase 5). Its look can ship fully inside wave 2 and the pilot window. B and C would either break that contract, which shifts every in-flight PR's screenshots, or wait for their palettes until after ≈5.12.
3. Its weakest point is a layout discipline problem, which tests can enforce. The weakest points of B (identity) and C (a font that is proportional by default) are intrinsic.

**What A must not keep:**
- Plex Mono for IDs, because a second voice is no longer needed: Plex Sans already separates 1/l/I. Take that to decision D3.
- The per-invoice header on single-gap invoices.
- Side-by-side `money-card` figures in narrow columns.

## 5. Grafts into A

| # | From | Graft | Serves | Lands in |
|---|---|---|---|---|
| G1 | **B** | **Hebrew keycaps next to the Latin ones** in a persistent key-hint footer on desk queues ("J ח · K ל · X ס · Z ז · O ם"), as PROCESSES §8.8 asks | P9, J2/J8/J10/J12 | `Kbd` primitive (phase 3) + W2-04 |
| G2 | **B** | **Tabs that carry Σ₪** ("להחלטה 3 · ₪191.20"), with a "בתוך הסף" tab so items inside tolerance are visible but are never tasks | P1, T4 | `WorkQueueTabs` |
| G3 | **B** | **ThreeWayRow cells carry their document ID** (PO-…, SH-…), and the evidence footer states the consequence: "דרישה עכשיו: ₪38.70 יקוזז מהתשלום לירקות השרון" (a gap caught before payment is offset, not chased) | P2, North Star | `EvidenceDrawer` |
| G4 | **B + C** | **No group header for an invoice with one gap.** The invoice ID goes inline, and only invoices with ≥2 gaps get a header with Σ₪. This restores ≥10 decisions per 1440×900 | P7, the ≥10 floor | `DecisionRow` grouping rule |
| G5 | **B** | Dock: a **column-header row** (הגיע · פריט · הוזמן · חריגה), a **"הבא בתור"** marker, the **✓ cell turning into the exception state** (⚠ חסר), and **call / WhatsApp** on a late truck | P4, J3, J7 | `FieldCountRow`, today screen |
| G6 | **C** | **The ₪ leads the row: ₪ → what → verb**, the same on TaskRow and DecisionRow. Each row shows its ₪ once (plus once in the focused verb), and the column stays physically right-aligned (N5) | P1, D2 | `TaskRow`, `DecisionRow` |
| G7 | **C** | **T4 sunken wells** for waiting items, consolidated invoices (חשבוניות ריכוז) and empty evidence: calm, neutral and clearly not a task | T4 | `surface.sunken` usage rule |
| G8 | **C** | **Exception sheet with numbered steps** (1 מה קרה · 2 כמה · 3 צילום); the sheet does the subtraction ("חסרים 3 ק״ג"); the save button says "שמרו · נשמר גם בלי קליטה". **Keep A's full-width photo** (C made it optional) | P4, P6 | `ExceptionSheet` |
| G9 | **C** | **Warmth through copy, not colour:** a greeting line ("בוקר טוב, רום · יום ראשון 25 באוקטובר") and a calm T3 "money back" card, rebuilt so the two figures stack | Brand, T3 | Home (W2-08) |
| G10 | **C** | **DocumentFlow with a "החלטה · עכשיו" node**, which shows where the decision sits in the chain | P2, P8 | `DocumentFlow` |
| G11 | **C** | **▲/▼ drawn as icons, never as text.** Rubik and Noto lack U+25B2/25BC, and a system font painted them. Plex must be checked the same way | N10, R1 | `DeltaCell` |
| G12 | **C** | **A keyboard-flow test that asserts exactly 1 filled primary after every step** (`proto-C-build/keys.cjs`) becomes the D1 e2e gate | D1 | `test-sentinel` (phase 3) |
| G13 | **C** | **A measured fallback face** (C computed Rubik against Liberation Sans). Do the same for Plex: `size-adjust`, `ascent-override` and `descent-override` | CLS ≤0.01 | `fonts.ts` (phase 2) |

**Rejected on purpose:**
- B's rails on every blocking queue row and its two filled primaries;
- B's condensed Hebrew;
- C's warm paper and warmed status colours (a contract cost, and they soften "audited");
- C's `money-card` size on task rows;
- C's reordering of the count list.

## 6. Fix list for prototype A (lab only, before phase 0 closes)

1. **F1:** stack the two T3 figures in "הכסף שחוזר אליך" (one per line under 480 px). A `money-*` figure never shrinks or wraps. Re-render at 1440, 1366 and 1280.
2. **F2:** TaskRow titles wrap to 2 lines and are never truncated (B already does this).
3. **F3 / G4:** single-gap invoices get no header. Re-measure: the target is ≥10 decisions at 1440 and ≥8 at 1280.
4. **F4:** the undo-ring digit goes to 12 px.
5. **D3:** IDs move to Plex Sans 500 with `tnum`, LTR-isolated (if the owner agrees).
6. Apply G1, G2, G5, G6 and G8 to the three screens, then run `judge/judge-check.cjs` and require 0 real overlaps at 1440, 1280 and 390.

## 7. Open owner decisions

| # | Decision | Options | Panel default | Why |
|---|---|---|---|---|
| **D1** | Direction | A · B · C | **A + grafts** | §4 |
| **D2** | **Font** | **IBM Plex Sans Hebrew** · Rubik · Noto Sans Hebrew · keep Heebo | **Plex** | Figure-height ₪, distinct 1/l/I, tallest Hebrew, and no palette change needed. *Keeping Heebo is a real option*: W2-15's safety net already stops the foreign ₪ inside `font-mono`. The swap is an upgrade, not a bug fix, and it costs about +8 KB of preload and about 8% wider figures |
| **D3** | Identifier face | Plex Mono · Plex Sans 500 + `tnum` | **Plex Sans 500** | One numeric voice; saves 14 KB and one family; Plex Sans already separates 1/l/I |
| **D4** | **Density default** | per role | **Owner and manager: "רגיל"** (44 px rows, 64 px decision rows) · **bookkeeper: "צפוף"** (32/52) · field fixed (72 px count rows, 56 px primary) · a per-user "רגיל / צפוף" toggle, saved per user | Spec §2.8. With G4, "רגיל" meets ≥10 decisions, so the owner doesn't need compact |
| **D5** | **Tone** | audited-calm · warm-hospitality · precise-dense | **Audited calm + human copy**: A's palette, ruled tables and flat cards; C's greeting line and ₪-first sentences; no warm paper | Warmth from words is free. Warmth from colour costs the contract and the "audited" look |
| **D6** | Card radius | A's 8 · base 12 · today's 16 | **12** (control 8, overlay 16) | Softer than A's 8 and less churn from today's 16, so un-migrated pages look less mismatched during waves 2 and 3 |
| D7 | The primary follows focus, and the bulk bar owns it while a selection exists (O2) | yes · no | **Yes** | One filled primary per viewport (A and C did this; B did not) |
| D8 | ₪ once in the column header, bookkeeper compact tables only (O1) | yes · no | **Yes** | Needs a human-authored PR from `money-format-marshal`, because `formatIls()` is immutable |
| D9 | Selection colour blue (O3); hero CTA secondary (O4) | — | **Yes / yes** | Green keeps its money meaning; red is only for act-now items |
| D10 | When users see the new font | train α 17.11 · **β 24.11** · after δ | **β 24.11** | Two full weeks of pilot on a stable UI first |
| D11 | A display face for the report cover (Frank Ruhl Libre) | now · wave 3 · never | **Wave 3** | Not on the critical path |

## 8. Phased implementation plan

### Calendar and who does what

The plan protects the pilot (go-live **11.11** per this task; `STATE.md` on main still says 8.11, and the plan works for either date because nothing visible merges before 17.11) and the wave-2 trains α 17.11 · β 24.11 · γ 1.12 · δ 8.12. Owners follow AGENTS.md:
- `rtl-design-steward` (inside W2-15's lane during wave 2) owns tokens, fonts and primitives;
- `test-sentinel` owns the specs;
- `web-feature-engineer` owns the areas;
- `money-format-marshal` raises proposals only, through a human-authored PR;
- **any change to `.github/workflows/*` is a human-authored PR.**

| Phase | When | What lands | Owner | Gate (§9) | Rollback | Risk to in-flight work |
|---|---|---|---|---|---|---|
| **0 · Decide + lab** | 7–10.11 (freeze) | Owner answers D1–D11. Prototype A gets the §6 fixes and grafts. The 4 reference screens are re-rendered at 1440, 1280 and 390, in he and en. No repo change | orchestrator, owner | §6 item 6 at 0 overlaps | — | none |
| **0b · Baseline** | 11–16.11 (pilot stabilisation; branch only, no merge) | Capture **VR-0**: 12 routes × he/en × {1440, 1280, 390} from `main`. The routes are: owner home, approvals, claims, pay run, invoices list, invoice cockpit, supplier ledger, leak breakdown, receiving today, count, exception sheet and the supplier link. Write the report-only specs from §9 | `test-sentinel` | specs run green against `main` | — | none |
| **1 · Tokens-first PR (additive)** | **Train α, 17.11**, after W2-15's drafts PR (14.11) | `primitives.ts`, `directions.ts` (ACTIVE = A), the v2 semantic roles **as aliases of v1**, `components.ts`, `modes.ts`, `fonts.ts` (stacks only, Heebo still active), the `--row-compact/default/touch` constants, `ratchet.test.ts` report-only, and contrast tests for every mode | `rtl-design-steward` (a W2-15 primitive-fix PR) | **VR-1: 0-pixel diff** on all VR-0 routes, which proves the change is additive; drift and contrast green | revert the PR | **None.** The generated block only grows; conflicts resolve by regenerating it |
| **2 · Font swap PR + money voice** | **Train β, 24.11** | Plex Sans Hebrew woff2 (hebrew + latin, 400/500/600/700) + OFL under `apps/web/public/fonts/ibm-plex-sans-hebrew/`; `@font-face` with `unicode-range`; a measured `'IBM Plex Sans Hebrew Fallback'` (G13); a `layout.tsx` preload of 400 + 700 × 2 subsets; `--font-ui` → Plex, with `--font-heebo: var(--font-ui)` so `font-sans` keeps working; `--font-mono` → `var(--font-ui)` with `tnum` (D3); the Inter `cv*` features deleted; `font-synthesis: none` | `rtl-design-steward`; `money-format-marshal` reviews N5–N7 | **VR-2 + PERF** (§9); diffs signed per route by the owner | flip `--font-ui` back to Heebo (its files stay until phase 5) | Low. Every page changes face without a call-site change. **Not in α**, so the pilot's first week is untouched |
| **3a · Money and status primitives** | **Train γ, 1.12** | `Money`/`MoneyCell` (context precision, `ch` widths, no mono, never red), `DeltaCell` (icon glyph, G11), `StatusChip` + registry (subtle/bold by tier, C5), `Button` with `action.*` variants, `ActionToast`, `Card` (radius → card role 12, e0), `Heading` → `title-lg` | `rtl-design-steward` (W2-15 lane, ≤2 days per PR) | VR-3 per primitive; axe; T2 count | revert per primitive | Visible only through shared primitives; no page file changes |
| **3b · Shell + table primitives** | **Train δ, 8.12** (W2-15's final PR ≈5.12 lands first) | The shell sets `data-density` and `data-mode` from role × device (D4); `DataTable` column kinds; `WorkQueueTable` + `WorkQueueTabs` (G2); the `BulkActionBar` primitive (in place, same height, one primary); `Kbd` with Hebrew keycaps (G1); `FieldCountRow` as a primitive (G5) | `rtl-design-steward` | VR-3; one-primary keyboard test (G12) | revert per primitive | Per-page `compact` booleans keep working until phase 4 |
| **4 · Screen adoption per area** | **Wave-3 trains, from mid-December** (dates per the orchestrator). Each area moves only **after its wave-2 package has merged, never in the same train** | In order of ₪ exposure: approvals `DecisionRow` + `EvidenceDrawer` (after W2-04; G3, G4, G6, G10) → claims `SendSheet` (after W2-10) → pay run (after W2-03 and the deployed H-03) → receiving `FieldCountRow` / `ExceptionSheet` (after W2-05 and W2-07; G5, G8) → invoice cockpit (W2-02) → supplier ledger, with ₪ in the header if D8 is approved (W2-11) → home tasks (W2-08; G6, G7, G9) | `web-feature-engineer` per area | VR-4 + the ops-J* step counts | revert per area | Each area edits only its own files |
| **5 · Codemods + legacy delete** | After δ (8.12), between trains, never on files with an open PR | The §5.6 codemods (`rounded-2xl` → `rounded-card`, `font-mono` money removed, `text-end` money → `MoneyCell` …); legacy keys removed when their count reaches 0; the ratchet becomes failing; lint `warn` → `error` in W4-01, blocking in H-09 | `rtl-design-steward` + `test-sentinel`; CI wiring is a **human PR** | full VR diff; `ratchet.test.ts` | revert per area | Scheduled between trains |

**Interim cost to accept.** From γ until phase 5, migrated primitives use radius 12 while un-migrated pages keep `rounded-2xl` (16). D6's 12 keeps that gap small, and it closes with the phase-5 codemod.

## 9. Gates: visual regression, performance, invariants

The specs live in `apps/web/e2e/**` and `__tests__/**` (`test-sentinel`). They are **report-only until wave 4**. Wiring them into `ci.yml` is a human-authored PR.

| Gate | Applies to | Pass condition |
|---|---|---|
| **VR-0 baseline** | 0b | 12 routes × he/en × 1440/1280/390 captured from `main` at the α cut |
| **VR-1 additive proof** | phase 1 | **0 pixels differ** on every VR-0 shot |
| **VR-2 font swap** | phase 2 | Diffs expected and signed per route. Automated invariants: **(a)** CDP `getPlatformFontsForNode` reports Plex for **every ₪ glyph** on all 12 routes in he and en (0 system fallback); **(b)** decimal alignment: in each money column every decimal point shares one x within 0.5 px; **(c)** **overlap and clipping: 0 money text collisions and 0 truncated ₪ at 1440, 1280 and 390.** This is the panel's `judge-check.cjs`, hardened to skip sr-only text and ellipsis ranges, and it would have caught F1 and F2; **(d)** the demo ₪ invariants are unchanged (₪760 / ₪296 / ₪464 / ₪1,267 / ₪1,759), and **one precision per figure per screen** (would have caught F9) |
| **PERF** (font budget) | phase 2 | **Preloaded font bytes ≤ 50 KB** (Plex 400 + 700 × hebrew + latin ≈ 48.6 KB; Heebo today 41.2 KB) · **first-load font bytes on owner home ≤ 100 KB** (all 4 weights ≈ 97 KB; 500 and 600 not preloaded) · **0 KB of Plex Mono** (D3) · Frank Ruhl never on app routes · **CLS ≤ 0.01** on 5 routes (today 0.0003) · **LCP** on owner home (the hero ₪ is the LCP node) **≤ baseline + 100 ms** on a throttled mid-Android profile · `font-display: swap` with the metric-matched fallback · hashed file names with a 1-year immutable cache |
| **VR-3 primitives** | 3a, 3b | Lab baseline per primitive and state; axe 0 serious; **≤1 filled primary per region after every keyboard step** (G12); bold chips ≤3 per viewport on summary surfaces, and in queues only on overdue or ≤48 h rows (C5); 12 px desk and 14 px field floors |
| **VR-4 areas** | phase 4 | ops-J* press counts at the PROCESSES §3 targets; **capacity ≥10 decision rows at 1440 and ≥8 at 1280** (new: every direction truncated at 1280); ≥8 count rows at 390×844; role matrix: the receiver's DOM and tRPC JSON carry 0 ₪; airplane-mode e2e: 20 lines, 0 lost |
| **Ratchet** | from phase 1 (report) → phase 5 (fail) | No legacy count in `ds-baseline.json` goes up |

## 10. Files

The panel's outputs:
- `ds2/VERDICT.md` (this file);
- `ds2/judge/judge-check.cjs` and `judge-check.json` (the overlap, clip, big-₪ and floor check over A, B and C at 1440, 1280 and 390);
- `ds2/judge/small.cjs` (text below 12 px, filled primaries);
- `ds2/judge/{A,B,C}-{home,approvals}-1280.jpg`;
- `ds2/judge/A-moneyback-crop.jpg`.

Working files lived in the orchestrator scratchpad; this folder holds the copies the build sessions use.
