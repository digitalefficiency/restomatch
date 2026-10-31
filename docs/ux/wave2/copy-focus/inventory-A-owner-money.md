# A-owner-money — in-app copy focus audit (owner money screens)

Release source: `rw-release` (read-only, `11ea29ce`). Lab: http://localhost:3351 (build ab9908c4), tenant "כפר הזיתים", locale he. Captured 31.10.2026.
Scope: /dashboard (owner and manager homes: needs-you, finance, view disclosure, VAT-at-risk card; the chef and receiver homes because their strings live in `overview`), /dashboard/leaks (+#prices, breakdown, proof, report, claims letters), /dashboard/reports/{monthly,digest}; catalogs `overview, leaks, leakProof, views, vat, components` (money parts), `recovery.report/digest`, `packages/api/src/reports/monthly.ts`; plus the `recipes` and `contracts` cards rendered on these screens.

**Inventory:** 111 explanatory strings — 15 CUT, 4 FOLD, 46 SHORTEN, 21 MERGE, 25 KEEP. Source-level words: **1029 → ~534** visible by default after the change (−495).
JSON: `docs/ux/wave2/copy-focus/inventory-A-owner-money.json` · scripts and captured innerText: `docs/ux/wave2/copy-focus/work-A-owner-money/`.

How the numbers were made:
- Words are Hebrew and Latin tokens in `document.body.innerText`, so the sidebar, the header and sr-only text are included. Numbers and ₪ amounts are excluded.
- "Explanatory" = every inventory string matched in that capture's text. The first number is what shows by default; the number in brackets also counts disclosures opened (the hero ⓘ, the "תצוגה" toolbar, the trend, "עוד N" and the VAT request panel).
- "After" = default-visible words once the verdicts are applied: FOLD keeps only the visible line plus the toggle label, CUT = 0, SHORTEN/MERGE = the proposal.
- Lab noise in every capture: the worker banner "מנוע העיבוד לא זמין כרגע…" (16 words). The lab worker is down; this banner belongs to the shell area, not to this one.

## (a) Per-screen counts

| screen | role | viewport | visible words | explanatory words (default · incl. opened) | est. words after | screenshot |
|---|---|---|---:|---:|---:|---|
| /dashboard (finance home) | manager | 390×844 | 246 | 73 · 114 | 206 (−40) | `docs/ux/wave2/copy-focus/shots/A-owner-money--home--manager--phone.jpg` |
| /dashboard (finance home) | owner | 1440×900 | 357 | 86 · 127 | 313 (−44) | `docs/ux/wave2/copy-focus/shots/A-owner-money--home--owner--desktop.jpg` |
| /dashboard (finance home) | owner | 390×844 | 289 | 86 · 127 | 245 (−44) | `docs/ux/wave2/copy-focus/shots/A-owner-money--home--owner--phone.jpg` |
| /dashboard/leaks | manager | 390×844 | 149 | 38 · 48 | 131 (−18) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks--manager--phone.jpg` |
| /dashboard/leaks | owner | 1440×900 | 374 | 97 · 107 | 313 (−61) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks--owner--desktop.jpg` |
| /dashboard/leaks | owner | 390×844 | 253 | 81 · 91 | 208 (−45) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks--owner--phone.jpg` |
| /dashboard/leaks#prices | owner | 390×844 | 253 | 81 · 91 | 208 (−45) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-prices--owner--phone.jpg` |
| /dashboard/leaks/breakdown | manager | 390×844 | 572 | 102 · 112 | 508 (−64) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-breakdown--manager--phone.jpg` |
| /dashboard/leaks/breakdown | owner | 1440×900 | 664 | 102 · 112 | 600 (−64) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-breakdown--owner--desktop.jpg` |
| /dashboard/leaks/proof | owner | 1440×900 | 340 | 139 · 139 | 260 (−80) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-proof--owner--desktop.jpg` |
| /dashboard/leaks/proof | owner | 390×844 | 283 | 139 · 139 | 203 (−80) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-proof--owner--phone.jpg` |
| /dashboard/leaks/report | manager | 390×844 | 230 | 66 · 66 | 218 (−12) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-report--manager--phone.jpg` |
| /dashboard/leaks/report | owner | 1440×900 | 297 | 66 · 66 | 285 (−12) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-report--owner--desktop.jpg` |
| /dashboard/leaks/claims | manager | 390×844 | 713 | 59 · 59 | 679 (−34) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-claims--manager--phone.jpg` |
| /dashboard/leaks/claims | owner | 1440×900 | 770 | 59 · 59 | 736 (−34) | `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-claims--owner--desktop.jpg` |
| /dashboard/reports/monthly | manager | 390×844 | 133 | 17 · 17 | 127 (−6) | `docs/ux/wave2/copy-focus/shots/A-owner-money--reports-monthly--manager--phone.jpg` |
| /dashboard/reports/monthly | owner | 1440×900 | 188 | 17 · 17 | 182 (−6) | `docs/ux/wave2/copy-focus/shots/A-owner-money--reports-monthly--owner--desktop.jpg` |
| /dashboard/reports/digest | owner | 1440×900 | 175 | 32 · 32 | 158 (−17) | `docs/ux/wave2/copy-focus/shots/A-owner-money--reports-digest--owner--desktop.jpg` |
| /dashboard (chef home) | chef | 390×844 | 71 | 24 · 24 | 61 (−10) | `docs/ux/wave2/copy-focus/shots/A-owner-money--home-chef--chef--phone.jpg` |
| /dashboard (receiver board) | receiver | 390×844 | 122 | 20 · 20 | 110 (−12) | `docs/ux/wave2/copy-focus/shots/A-owner-money--home-receiver--receiver--phone.jpg` |
| **all 20 captures** | | | **6479** | **1384 · 1567** | **5751** (−728) | |
| /dashboard/reports (index) | owner | 1440×900 | 18 | — | — | 404 by design: a gate-only route (lib/nav/routes/reports.ts) with no page of its own; the nav goes to /reports/monthly. `docs/ux/wave2/copy-focus/shots/A-owner-money--reports-root--owner--desktop.jpg` |

Every capture also has an "-open" twin with all disclosures opened: `docs/ux/wave2/copy-focus/shots/A-owner-money--<screen>-open--<role>--<vp>.jpg`.
"/leaks#prices" is the same page as "/leaks" (owner, phone), scrolled to the anchor.

Where the default-view words go:
- **/leaks/breakdown (−64):** almost all of it is `breakdown.noMoneyShort`, a 13-word sentence repeated on every billed short-qty line (6× in the lab month).
- **/leaks/proof (−80 desktop):** the page *is* the explanation, but 139 of its 271 main-column words are rule paragraphs that repeat the home ⓘ and the report.
- **/leaks#prices (−45 phone):** a 33-word statistics paragraph, plus two hints that repeat it.
- **Owner home (−44):** the hourglass note, the VAT card's legal-ish paragraph, the price card's double sentence, and the activity and recipes subtitles that restate their headings.

## (b) Concepts explained in more than one place

1. **What counts in the leak (concept.leakRule)** is explained in 3 different wordings:
   - `overview.hero.calc` (home ⓘ): "פערים בחומרה **בינונית** ומעלה … לא כולל … **וחשבוניות ללא הזמנה**"
   - `leakProof.rules` (proof, 41 words): "ברמת **אזהרה או חסימה** … **"פריט בחשבונית ללא הזמנה" כן נספר**"
   - `leaks.report.method` (report footer)

   The ⓘ **contradicts** the proof page on items without an order, and its severity word differs. → one string, `leaks.concept.leakRule`.
2. **The per-invoice cap (concept.cap)** has 6 strings and 3 more inline mentions:
   - badges `leaks.breakdown.capped` "מוגבל…" and `leakProof.capped` "הוגבל…"
   - `leakProof.topHint`
   - `leaks.report.capNoteShort` **and** `leaks.report.capNote` — both render on the same report, behind the same condition
   - `views.explorer.linesNote`
   - inside the hero ⓘ, the proof rules and the report method

   → one badge and one note.
3. **Invoices waiting for an order link, mostly consolidated (concept.pendingLink):**
   - `overview.hero.pending` (home hourglass)
   - `leaks.breakdown.pendingHint` (section subtitle)
   - `leaks.report.pending`
   - `leakProof.pending` (with the banned "חשבוניות ריכוז")
   - `components.activity.awaitingPoLink`
   - `recovery.next.linkPending`
   - the approvals type label "ממתינה לשיוך להזמנה"

   **They contradict each other.** The home says "לא נספרות בדליפה", but the proof page says (correctly, per `packages/charts/src/leak-hero.ts` and the `leakProof.test` "pending-link invoices with leak included") that findings on them **are** counted; only their spend is left out. → `leaks.concept.pendingLink` (count line) + `leaks.concept.pendingLinkWhy` (folded "למה?").
4. **What מרכזת means / consolidated waiting for delivery notes (concept.consolidated):**
   - `overview.hero.pending` "כנראה חשבוניות מרכזות"
   - `leaks.breakdown.pendingHint` "לרוב חשבונית מרכזת"
   - `leakProof.pending` "חשבוניות ריכוז" ✗
   - `components.activity.consolidatedReceivedNumbered` "חשבונית ריכוז" ✗
   - `components.activity.awaitingDeliveryNotes` / `awaitingMonthlyMatch`
5. **Why a receipt is pending (concept.pendingReceipt):** `overview.hero.awaitingCount`. In this area it appears only here; the receiving and approvals areas have their own versions.
6. **Clean month = matched to orders and receipts (concept.clean)** has 5 wordings:
   - `overview.hero.clean`
   - `leaks.states.clean`
   - `leaks.states.cleanHint`
   - `leaks.breakdown.emptyTitle` + `emptyDescription`
   - `leaks.report.empty`
7. **No data yet (concept.noData):** `overview.hero.noData.hint` and `leaks.states.noDataHint`, which shows on /leaks, the breakdown and the report.
8. **Price creep is not the leak (concept.creep / concept.notLeak)** is said 5 times; on /leaks#prices it is said twice on one screen (subtitle + tile hint):
   - `overview.leaks.subtitle` (home card)
   - `leaks.detective.subtitle`
   - `leaks.detective.totalHint`
   - `leaks.report.creepHint`
   - `vat.card.separate` ("נפרד מהדליפה")
9. **Nothing is sent without you (concept.notSent):**
   - `vat.request.hint`
   - `leaks.claims.reminder.note`
   - `recovery.digest.subtitle` **and** `recovery.digest.note` — twice on the same page
   - `recovery.report.whatsappNote`
10. **What goes into the claim letter (concept.inLetter):**
    - `leaks.claims.note` (footnote and empty-state body)
    - `leaks.claims.undecided.body`
    - `leaks.claims.notTracked`
    - `leakProof.recovered` ("זה עוד לא כסף שנדרש במכתב")
    - `leaks.report.resolvedNote` and `leakProof.resolvedNote` — **byte-identical, written twice**
11. **Still stoppable before payment (concept.caught):**
    - `leakProof.caught` (17 words)
    - `leaks.report.caughtChip` (5 words, the same fact)
    - the labels `overview.hero.unpaid`, `views.kpis.caught`, `recovery.report.caught`
12. **Why this section is hidden from your role (concept.roleOnly / hiddenMoney):** `leaks.detective.roleOnly` and `leaks.report.roleOnly` share the same tail "אפשר לבקש גישה מבעלי המסעדה". In this area, chef and receiver see no ₪, and no string explains that.
13. **Too little data for a % (concept.thinBase):** `overview.hero.thinBase` ("בסיס דליל") and `views.delta.thinBase`.
14. **No comparison (concept.noCompare):** `overview.hero.delta.none`, `overview.hero.delta.noneYoy` and `views.delta.noBase`.
15. **Returned this month (concept.returned):** `overview.hero.returnedHint` and `recovery.hero.returnedHint` (a second wording that is unused, i.e. dead).
16. **Still owed to you (concept.outstanding)** is the same label 3×: `recovery.report.outstanding`, `recovery.digest.outstanding` and `packages/api/src/reports/monthly.ts` `he.outstanding`.
17. **The 6-month VAT window (concept.vatWindow / concept.allocation):** `vat.card.subtitle`, `vat.card.clearHint`, `vat.invoice.deadline` and `vat.invoice.closed`; the allocation consequence also in `vat.invoice.missing` / `invalid`.
18. **How matching works — order + receipt (concept.threeWayMatch)** is restated in 8 places:
    - `leaks.hub.subtitle` (the one definition)
    - `overview.hero.clean`
    - `leaks.states.cleanHint`
    - `leaks.breakdown.emptyDescription`
    - `overview.hero.noData.hint` ("מול ההזמנה והקבלה")
    - `leaks.states.noDataHint`
    - `leaks.report.method`
    - the claim-letter intro

    → keep the definition on /leaks; the others drop the restatement (CUT/MERGE above).
19. **Why a number can change (concept.numberCanChange):** `leaks.report.openMonth` "חודש פתוח · מתעדכן", plus the "החודש (עד היום)" tabs in the report and the digest. Already minimal — KEEP.
20. **Saved views stay in this browser:** `views.toolbar.noSaved` and `views.toolbar.savedHint`, in the same popover.

**Proposed shared strings.** These go in `leaks.concept.*`. `leaks` has no receiver overlays, and chef and receiver never load it, so a shared string can never bring ₪ to them; `finance.tsx` already loads it as `tl`.
- `leaks.concept.leakRule`: «נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה".»
- `leaks.concept.leakRuleMore`: «פריט בחשבונית ללא הזמנה כן נספר. פערים בתוך הסבולת לא נספרים.»
- `leaks.concept.capBadge`: «מוגבל לסכום החשבונית»
- `leaks.concept.capNote`: «סכום השורות גבוה ב-{amount} מהדליפה: היא מוגבלת לסכום כל חשבונית.»
- `leaks.concept.pendingLink`: «{count} חשבוניות ({amount}) ממתינות לשיוך להזמנה»
- `leaks.concept.pendingLinkWhy`: «לרוב חשבונית מרכזת. עד השיוך היא לא נכנסת להוצאה שנבדקה.»
- `leaks.concept.noData`: «הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלה.»
- `leaks.concept.creep`: «מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה»
- `leaks.concept.creepHow`: «מחיר אחרון מעל האחוזון ה-90 ו-5% מעל החציון. העודף = (מחיר − חציון) × כמות ששולמה ב-30 יום.»
- `leaks.concept.notLeak`: «לא חלק מהדליפה»
- `leaks.concept.inLetter`: «במכתב רק פערים שאושרו לדרישה ועוד לא נשלחו.»
- `leaks.concept.resolvedNote`: «מתוכם {amount} ({items}) אושרו אך אינם במכתב.»

## (c) The 10 highest-value changes (before → after)

Ranked by words removed × how often it renders × pilot week-1 use. ★ marks pilot-critical (ציקטי, from 8.11).

1. ★ **/leaks/breakdown — `leaks.breakdown.noMoneyShort`.** Repeats on every billed short-qty line (6× in the lab month, −48 words).
   - Before: «החוסר חויב בחשבונית — הוא נספר פעם אחת, בשורת החיוב על יותר ממה שהתקבל»
   - After: «כבר נספר בשורת החיוב העודף»
2. ★ **/leaks#prices — `detective.subtitle` FOLD, `detective.totalHint` CUT, `detective.hotspotsHint` CUT.**
   - Before: «מסומן כשהמחיר האחרון מעל האחוזון ה-90 של אותו ספק ו-5% ומעלה מעל החציון. העודף מחושב מול החציון × הכמות ששולמה ב-30 יום. זה מדד מגמה — לא חלק מהדליפה החודשית.» + «סכום (מחיר − מחיר חציוני) × כמות ב-30 הימים האחרונים. נפרד מהדליפה החודשית.» + «צמדי מוצר × ספק שחורגים מהגבול»
   - After: «מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה» [איך מסמנים?] → «מחיר אחרון מעל האחוזון ה-90 ו-5% מעל החציון. העודף = (מחיר − חציון) × כמות ששולמה ב-30 יום.»
3. ★ **Owner home — `overview.hero.pending` FOLD.** Stays T4, neutral; this also fixes the false "not counted in the leak".
   - Before: «2 חשבוניות (₪3,603) ממתינות לשיוך להזמנה — כנראה חשבוניות מרכזות. הן לא נספרות בדליפה ולא בהוצאה.»
   - After: «2 חשבוניות (₪3,603) ממתינות לשיוך להזמנה» [למה?] → «לרוב חשבונית מרכזת. עד השיוך היא לא נכנסת להוצאה שנבדקה.»
4. ★ **Owner and manager home rail — VAT-at-risk card: `vat.card.subtitle` FOLD + `vat.card.separate` MERGE.**
   - Before: «חשבונית מס מעל ₪5,000 לפני מע״מ בלי מספר הקצאה — אי אפשר לקזז את המע״מ שלה. יש 6 חודשים מתאריך החשבונית לקבל חשבונית מתוקנת.» + «נפרד מהדליפה — זה מע״מ, לא פער מול הספק.»
   - After: «בלי מספר הקצאה — אי אפשר לקזז את המע״מ.» [למה?] → «חשבונית מס מעל ₪5,000 לפני מע״מ חייבת מספר הקצאה. יש 6 חודשים לקבל חשבונית מתוקנת.» + «לא חלק מהדליפה»
5. ★ **One counting rule — `leaks.concept.leakRule`.** Used by the home ⓘ (`hero.calc`), the proof page (`leakProof.rules`, 41 words) and the report method. This removes a contradiction the owner can see.
   - Before, ⓘ: «פערים בחומרה בינונית ומעלה, מוגבל לסכום כל חשבונית. לא כולל מחיר נמוך מהמצופה וחשבוניות ללא הזמנה.»
   - Before, proof: «… "פריט בחשבונית ללא הזמנה" כן נספר …»
   - After, everywhere: «נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה".» On the proof page, add [פרטים] → «פריט בחשבונית ללא הזמנה כן נספר. פערים בתוך הסבולת לא נספרים.»
6. ★ **/leaks/proof — `leakProof.recovered` FOLD + `leakProof.caught` MERGE + `leakProof.footer` SHORTEN.**
   - Before: «₪463.54 — החלק מהדליפה שהצוות אישר כדרישה מהספק (ממצא שאושר או סומן "טופל"), לכל היותר עד סכום החשבונית. זה עוד לא כסף שנדרש במכתב.» / «₪390.20 מהדליפה נמצאים בחשבוניות שעדיין לא סומנו כשולמו — עוד אפשר לבקש תיקון או זיכוי לפני התשלום.» / «כל הסכומים כאן הם אותם סכומים שבחדר הבקרה, עד האגורה. לא חושב כאן שום מספר חדש.»
   - After: «עוד לא נשלח במכתב.» [פרטים] → «ממצאים שאושרו או סומנו "טופל", עד סכום כל חשבונית.» / «₪390.20 עוד אפשר לעצור לפני תשלום» / «אותם סכומים כמו בחדר הבקרה, עד האגורה.»
7. ★ **Claims letters — `claims.note`, `claims.subtitle`, `claims.undecided.body`, `claims.reminder.note`.**
   - Before: «כולל רק מה שהוחלט לדרוש: דרישות ממעקב ₪ חוזר שעוד לא נשלחו ופערים שאושרו לדרישה. פערים שלא הוחלטו או שבוטלו לא נכללים.» / «מכתב אחד לכל ספק — מה לקזז לפני תשלום ומה לבקש כזיכוי, נכון לאוקטובר 2026.» / «N פערים החודש עוד לא הוחלטו — הם לא נכנסים למכתב עד שתאשרו אותם לדרישה.» / «באיחור? מכינים לספק טיוטת תזכורת בוואטסאפ — היא יוצאת רק כשאתם לוחצים שליחה.»
   - After: «במכתב רק פערים שאושרו לדרישה ועוד לא נשלחו.» / «מכתב לכל ספק · נכון לאוקטובר 2026» / «N פערים מחכים להחלטה — לא במכתב עד אישור.» / «התזכורת יוצאת רק כשתלחצו שליחה.»
8. ★ **/leaks hub — `leaks.hub.subtitle` SHORTEN + `views.explorer.subtitle` CUT.**
   - Before: «דליפה = כסף שחויבתם מעבר להזמנה ולמה שהתקבל, בחשבוניות שנבדקו, לפני מע״מ.» + «אותה דליפה, בכל חיתוך: לפי ספק, קטגוריה, מוצר או סוג פער — מול אותם ימים בתקופה הקודמת.»
   - After: «כסף שחויבתם מעבר להזמנה ולמה שהתקבל, לפני מע״מ.» (the explorer line goes; the "קיבוץ לפי" and "השוואה" controls say it)
9. ★ **Owner home — lines that restate their headings: `overview.activity.subtitle` CUT, `recipes.overviewCard.subtitle` CUT, `overview.leaks.subtitle` MERGE.** The three hidden `homeSubtitle.{owner,manager,bookkeeper}` (display:none) are CUT too.
   - Before: «מה קרה במערכת לאחרונה.» / «עליות מחיר אצל הספקים מכרסמות ברווח לצלחת» / «מעל המחיר הרגיל אצל אותו ספק. מדד נפרד — לא נספר בדליפה של החודש.»
   - After: — / — / «מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה»
10. **The per-invoice cap in one wording — `leaks.concept.capBadge` + `leaks.concept.capNote`.**
    - Before: «מוגבל לסכום החשבונית» / «הוגבל לסכום החשבונית» / «לפי הדליפה של כל חשבונית, לכל היותר עד סכום החשבונית» / «נמצא גבוה ב-₪X מהדליפה: הדליפה בכל חשבונית מוגבלת לסכום החשבונית.» **and** «סכומי השורות גבוהים ב-₪X מהכותרת: …», both on the same report / «סכום שורות הפער לפני תקרת החשבונית — עשוי לעלות מעט על הדליפה הכוללת.»
    - After: badge «מוגבל לסכום החשבונית» · note, once per page, «סכום השורות גבוה ב-₪X מהדליפה: היא מוגבלת לסכום כל חשבונית.» · proof hint «לפי חשבונית, עד סכום החשבונית»

Runner-up (not pilot-critical):
- /reports/digest says "nothing is sent from here" twice. `digest.subtitle` SHORTEN «כך ייראה המייל בתחילת החודש. מכאן לא נשלח דבר.» (this also fixes the masculine "שתקבל") and `digest.note` CUT.

**Suggested before 8.11 (owner home + leak are week-1):** items 3, 4, 5 (accuracy), 1, 2 and 7. All are catalog edits, except that the FOLDs (items 2, 3, 4 and the proof [פרטים]) need one small shared in-place toggle (see the implementation notes).

## Binding-rule and accuracy findings made while auditing (route to the catalog owners)

These are not explanation-length issues, but they render on the owner money screens:
- **"ריכוז"** (rule: מרכזת):
  - `components.activity.consolidatedReceivedNumbered` «חשבונית ריכוז {number} התקבלה» (owner home activity; visible in the lab)
  - `leakProof.pending` «חשבוניות ריכוז» (fixed in the SHORTEN above)
- **"חריגה/חריגות"** (rule: פער) in `components.activity`: `types.discrepancy_approved` «חריגה אושרה», `types.discrepancy_rejected`, `discrepancyOne`, `discrepancies` «{count} חריגות», `toReviewOne`, `toReview` → «פער אושר / פער נדחה / פער אחד / {count} פערים / … לבדיקה».
  - Borderline: `leaks.heatmap.severe` «חריג» (legend), and the LeakHeatmap default label.
- **"יעד"** (rule: never):
  - `overview.homeSubtitle.chef` (CUT above)
  - `overview.chef.dishesTitle` «מנות שעברו את היעד» → «מנות שעלות המזון שלהן עלתה»
  - `overview.chef.dishesSubtitle` (SHORTEN above)
  - `overview.chef.dishesNone` «אף מנה לא עברה את היעד החודש ✓» → «אף מנה לא התייקרה החודש ✓»
  - `recipes.alert.crossed` «חצתה את יעד עלות המזון ({target})» — on the owner home recipes card; visible in the lab — and `recipes.alert.title`.
- **Style:** `recovery.digest.subtitle` «שתקבל» is masculine singular; the catalogs use plural (fixed in the SHORTEN above).
- **Accuracy:**
  - `overview.hero.pending` "הן לא נספרות בדליפה" — false when a pending invoice has findings. See (b) 3.
  - `overview.hero.calc` "לא כולל … חשבוניות ללא הזמנה" vs `leakProof.rules` "פריט בחשבונית ללא הזמנה כן נספר". See (b) 1.
  - `leaks.heatmap.more` «ועוד {count} פריטים בטבלה למטה» is reused on the owner home, which has no table (shows when more than 6 products crept).
  - `monthly.ts` `oneNumber` «… דלפו בחודש שעבר» is also used as the preview subject for the **current** month ("החודש (עד היום)", October) on /reports/monthly and /reports/digest.
  - `leaks.report.capNote` and `capNoteShort` render together.
- **Dead keys (not rendered; delete):**
  - `overview.subtitle`, `overview.kpis.*`, `overview.rail.recovery`
  - `leaks.report.foundHint`
  - `recovery.hero.returnedTile` / `returnedHint`
  - `overview.homeSubtitle.owner|manager|bookkeeper` render but are hidden by `[&_p]:hidden` in `app/dashboard/page.tsx`

## Implementation notes for whoever picks this up

- **FOLD:** reuse the hero's existing ⓘ `<details>` pattern (`lib/components/hero/LeakHero.tsx` calcNote) as one small shared `WhyToggle`:
  - The summary is the short label ("למה?", "פרטים" or "איך מסמנים?"), collapsed by default.
  - The text stays in place on the same screen.
  - The summary keeps a ≥24px target and a visible focus ring.
  - No new page, no help centre.
- **Parity:** `apps/web/lib/__tests__/i18n.test.ts` enforces he⇄en key and placeholder parity.
  - Every CUT/MERGE also edits `en.ts`.
  - `views.explorer.linesNote` → `leaks.concept.capNote` adds `{amount}`; pass `linesTotal − leak`, already computed in `explorer.tsx`.
- **Receiver overlays:** `overview.board.*` and `homeSubtitle.receiver` have ar/ru/th/ti overlays (`receiverLangs/overlays/overview`). `apps/web/lib/__tests__/receiver-langs.test.ts` lists `'homeSubtitle.receiver'` as a root, so update it on the CUT.
- **₪ guard:** `apps/web/app/dashboard/home/__tests__/staff-homes.server.test.ts` asserts no ₪ on the chef and receiver homes. None of the proposals adds ₪ there.
- **Activity strings:** `components.activity.awaiting*` are display strings; the server writes its own Hebrew detail, which `lib/components/activityText.ts` maps by literal. Changing the catalog is safe. `lib/components/__tests__/ops-components.test.ts` asserts the English mapping, so update it if en changes.
- **Unchanged:**
  - Legal, a11y (sr-only captions, live regions, aria names) and T4 wording.
  - Money confirmations: none in this area's catalogs (approvals and recovery own them).
  - Claim-letter body text (intro, closing, reasons). It is the outgoing document, not app explanation, so it is not in the inventory.
- **e2e:** no e2e spec asserts any changed Hebrew explanation text. Text guards that still hold:
  - W1-05: leak-hero must not contain "יעד"
  - W1-08: report-freshness matches /פתוח/
  - W1-05:281: uses `needs.decide.review` (KEEP)
