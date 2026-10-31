# Copy focus · B-ap: approvals, invoices and bookkeeping

**Owner request (31.10):** focus the in-app texts. **Clarification:** explanations stay where they are, made efficient (no help centre, no glossary).
**Source of truth:** `rw-release` @ `11ea29ce`. Line numbers are from that tree (he.ts key line). **Lab:** `http://localhost:3351` (build ab9908c4), tenant "כפר הזיתים", locale he. Read-only: no decision, re-match or download was clicked.
**Inventory:** `docs/ux/wave2/copy-focus/inventory-B-ap.json` (125 strings). Scripts and text dumps: `docs/ux/wave2/copy-focus/work-B-ap/`.

## Summary

| | |
|---|---|
| Explanatory strings inventoried | **125** (approvals 49 · payRun 16 · ingest 14 + 4 server · integrations 9 · consolidated 8 · accounting 8 · invoices 7 · vat 4 · views 3 · dockPrice 2 · auth 1) |
| Verdicts | SHORTEN 55 · KEEP 39 · CUT 21 · MERGE 7 · FOLD 3 |
| Words in those strings (catalog) | 970 → **511** (459 removed, 47%) |
| Pilot-critical (approvals + invoice detail) | 51 strings, 199 words removed. Everything else in this area is behind flags that are **off for ציקטי in week 1** (`payRun`, `consolidatedMatch`, `vatAtRisk`, `integrations`, `ingest*`, `dockPriceContext`; exports in week 3; PILOT-RUNBOOK §8), so it can ride a later train. |
| Lab shots | 23 captures + 3 with disclosures open = 26 JPEGs, 5,429 visible words in all |

How the numbers were made:
- **Visible words** = letter-led Hebrew/Latin tokens in `document.body.innerText` (numbers and ₪ amounts excluded). This includes `sr-only` text (e.g. each approvals card repeats its WhyLine in an sr-only summary) and the shell nav.
- **Explanatory words** = the words of inventoried explanatory strings found in that text (templates matched with placeholders), plus out-of-area explanatory copy on the 403/404 pages.
- **Estimated words after** = visible words − (explanatory words now − after), using each verdict (CUT = 0, FOLD = visible line + toggle label, role-gated strings = 0 for the role that loses them).
- Every lab shot also carries the shell banner "מנוע העיבוד לא זמין כרגע…" (17 words, `app/dashboard/worker-status.tsx`; the lab worker is down). It is in *visible words* but not in *explanatory words*, and it is not B-ap copy.

## (a) Per screen

| screen | role | viewport | visible words | explanatory words | est. words after | screenshot |
|---|---|---|---:|---:|---:|---|
| approvals | owner | desktop | 305 | 19 | 290 | `docs/ux/wave2/copy-focus/shots/B-ap--approvals--owner--desktop.jpg` |
| approvals (open: saved views, reasons, others) | owner | desktop | 407 | 33 | 387 | `docs/ux/wave2/copy-focus/shots/B-ap--approvals-open--owner--desktop.jpg` |
| approvals | manager | phone | 131 | 0 | 131 | `docs/ux/wave2/copy-focus/shots/B-ap--approvals--manager--phone.jpg` |
| approvals (open) | manager | phone | 158 | 4 | 156 | `docs/ux/wave2/copy-focus/shots/B-ap--approvals-open--manager--phone.jpg` |
| approvals (empty, others waiting) | bookkeeper | desktop | 74 | 6 | 72 | `docs/ux/wave2/copy-focus/shots/B-ap--approvals--bookkeeper--desktop.jpg` |
| approvals (open) | bookkeeper | desktop | 80 | 10 | 76 | `docs/ux/wave2/copy-focus/shots/B-ap--approvals-open--bookkeeper--desktop.jpg` |
| pay-run (this month) | owner | desktop | 446 | 152 | 353 | `docs/ux/wave2/copy-focus/shots/B-ap--payrun--owner--desktop.jpg` |
| pay-run | manager | phone | 390 | 152 | 297 | `docs/ux/wave2/copy-focus/shots/B-ap--payrun--manager--phone.jpg` |
| pay-run | bookkeeper | desktop | 423 | 152 | 330 | `docs/ux/wave2/copy-focus/shots/B-ap--payrun--bookkeeper--desktop.jpg` |
| pay-run (last month) | owner | desktop | 171 | 62 | 131 | `docs/ux/wave2/copy-focus/shots/B-ap--payrun-last--owner--desktop.jpg` |
| invoice detail (MF-24108) | owner | desktop | 166 | 35 | 140 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice--owner--desktop.jpg` |
| invoice detail | manager | phone | 110 | 35 | 84 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice--manager--phone.jpg` |
| invoice detail | bookkeeper | desktop | 138 | 35 | 105 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice--bookkeeper--desktop.jpg` |
| invoice: מרכזת with differences (GD-M-202609) | owner | desktop | 325 | 42 | 296 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice-consolidated--owner--desktop.jpg` |
| invoice: מרכזת with differences | manager | phone | 244 | 42 | 215 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice-consolidated--manager--phone.jpg` |
| invoice: מרכזת with differences | bookkeeper | desktop | 300 | 42 | 271 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice-consolidated--bookkeeper--desktop.jpg` |
| invoice: מרכזת matched (BR-R-24123) | owner | desktop | 253 | 41 | 226 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice-consolidated-matched--owner--desktop.jpg` |
| invoice: VAT at risk (MF-24950) | owner | desktop | 179 | 51 | 150 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice-vat--owner--desktop.jpg` |
| invoice: VAT at risk | bookkeeper | desktop | 151 | 51 | 115 | `docs/ux/wave2/copy-focus/shots/B-ap--invoice-vat--bookkeeper--desktop.jpg` |
| /dashboard/invoices (HTTP 404, gate-only route) | owner | desktop | 18 | 13 | 18 | `docs/ux/wave2/copy-focus/shots/B-ap--invoices-list--owner--desktop.jpg` |
| exports | owner | desktop | 211 | 92 | 153 | `docs/ux/wave2/copy-focus/shots/B-ap--exports--owner--desktop.jpg` |
| exports | bookkeeper | desktop | 188 | 92 | 130 | `docs/ux/wave2/copy-focus/shots/B-ap--exports--bookkeeper--desktop.jpg` |
| exports (HTTP 403, forbidden page) | manager | phone | 72 | 22 | 72 | `docs/ux/wave2/copy-focus/shots/B-ap--exports--manager--phone.jpg` |
| inbox (empty) | owner | desktop | 200 | 63 | 172 | `docs/ux/wave2/copy-focus/shots/B-ap--inbox--owner--desktop.jpg` |
| inbox (empty) | manager | phone | 145 | 63 | 117 | `docs/ux/wave2/copy-focus/shots/B-ap--inbox--manager--phone.jpg` |
| inbox (empty) | bookkeeper | desktop | 144 | 63 | 110 | `docs/ux/wave2/copy-focus/shots/B-ap--inbox--bookkeeper--desktop.jpg` |

Reading the table:
- **Approvals is already lean.** It is evidence first (WhyLine numbers, ₪, two buttons). Its explanatory weight is the WhyLine "סף <rule>" group for rule-type tolerances (shown twice per card, visible and sr-only) and the bookkeeper's empty state repeating the "ממתין לאחרים" lane. Many approvals strings only render in states the lab did not have (fallback explains, errors, undo, duplicates), so their savings are in the catalog total, not in this table.
- **Pay-run is the heaviest screen:** 152 explanatory words, 34 of them "כולל מע״מ" repeated on 17 rows and 7× "— ממתין להחלטה" next to "ממתין להחלטה: ₪X". After: −93 words per role.
- **Exports:** −58 words, mostly the 39-word footnote (folded) and a 16-word subtitle that contradicts it ("שאושרו" vs "שנבדקו").
- The 403 and 404 pages are shared pages (forbidden / not-found namespaces); they are counted but not inventoried here.
- The manager is on the exports 403 page by design (route roles: owner, bookkeeper).

## (b) Repetition: concepts explained in more than one place

| Concept | Where it is explained today | Proposal |
|---|---|---|
| **concept.pendingLink**: an invoice waits for a PO link and is not counted | `approvals.types.UNORDERED_ARRIVAL.explain` (he.ts:174, says "ריכוז") · `payRun.kpis.link` (:28) · `payRun.status.holdLink` · `payRun.supplier.link` · `consolidated.proposal` badge "לעיון — טרם שויכה" + `consolidated.proposalNote` (:5, the same "ממתינה לשיוך" twice) · outside B-ap: `overview.hero.pending`, `leaks.breakdown.pendingHint`, `leaks.report.pending`, `leakProof.pending`, `components.activity.awaitingPoLink` (inventory-A) | Folded why = **`explain.pendingNotCounted`** (MECHANISM §3.6): «לרוב אלה חשבוניות מרכזות. עד השיוך הן לא נספרות בדליפה ובהוצאה.» Approvals uses it behind «למה?». Pay-run keeps a local tail (pay/hold, not leak). The מרכזת page keeps a self-contained one-liner. |
| **concept.consolidated**: what a מרכזת is (invoice vs delivery notes) | `consolidated.subtitle` ("חשבונית הריכוז…") · `consolidated.letter.intro` / `letter.subject` ("ריכוז") · `accounting.note` ("חשבוניות ריכוז שממתינות לתעודות משלוח") · `approvals.types.UNORDERED_ARRIVAL.explain` ("לרוב חשבונית ריכוז") · `consolidated.status.noneBody` | Say **מרכזת** everywhere; the page title "הצלבה מול תעודות משלוח" already explains it, so the subtitle becomes «חשבונית מרכזת · {period}». |
| **concept.duplicate**: duplicate invoice number, do not pay twice | `approvals.types.DUPLICATE_INVOICE.explain` · `approvals.tolerance.duplicate` ("סף מספר חשבונית ייחודי לכל ספק") · `approvals.decision.duplicate*` buttons · `payRun.status.holdDuplicate` · `invoices.correction.duplicateOf` (25 words) · `auth.serverErrors.invoiceNumberTaken` (22 words) · `accounting.note` · `ingest.documentStatus.duplicate` | Facts once per screen: the T2 badge + buttons carry "don't pay"; the sentences shrink to the fact ("המספר כבר קיים אצל הספק"). The tolerance group is cut. |
| **concept.ruleAsThreshold**: the same rule said 2–3 times on one card | 6 `approvals.tolerance.*` rule strings rendered as "סף <rule>" after the card title and explain that already state the rule (lab: "חויבו 9.5 ק״ג, התקבלו 6.5 = ₪38.70 · סף הכמות שחויבה עולה על הכמות שהתקבלה") | Cut: render the threshold group only for numeric tolerances. |
| **concept.p90**: a price above the supplier's history | `approvals.why.sourceP90` + `approvals.tolerance.p90` on the same line, plus `types.PRICE_HIGHER.explain` ("או מהמחיר ההיסטורי") | Keep one: «(לפי מחירי העבר של הספק)»; cut the p90 threshold group. |
| **concept.rerunMatch**: fix lines, then re-run matching | `invoices.correction.subtitle` (top) and `invoices.correction.rerunHint` (bottom) on the same page; also shown to the bookkeeper (read-only) and on a מרכזת (no re-run button) | One 7-word line at the top, only for editors of a non-מרכזת invoice. |
| **concept.vatBasis**: incl/excl VAT | `approvals.summary.atRiskBasis` / `summary.duplicates` / `summary.vat` · `payRun.kpis.payHint` / `holdHint` / `kpis.link` / `creditHint` ("הבסיס של כל סכום מצוין לידו") · `payRun.table.totalBasis` ×N rows · `payRun.mixedBasis` | One caption per KPI («{count} חשבוניות · כולל מע״מ», shared `payRun.kpis.countHint`); per-row invoice basis cut; claim lines keep their basis. |
| **concept.exportScope**: which invoices are in the file | `accounting.subtitle` ("חשבוניות **שאושרו**") vs `accounting.note` ("כל החשבוניות **שנבדקו**") — they contradict · `integrations.accounting.body` ("אותן חשבוניות כמו בייצוא ה-CSV") | Subtitle «כל החשבוניות שנבדקו בטווח התאריכים.»; the details fold behind «פרטים». |
| **concept.exportEmpty / exportDone / exportSkipped** | `accounting.downloadedEmpty` + `integrations.accounting.empty`; `accounting.downloaded` + `integrations.accounting.downloaded`; `accounting.undated` + `integrations.accounting.skipped` (same page, different wording) | One key each: `accounting.downloadedEmpty`, `accounting.downloaded` (keep its wording: demo-path.spec.ts:776). |
| **concept.inLetter**: credits = approved lines in the claim letters | `payRun.note` · `payRun.kpis.creditHint` · outside B-ap: `leaks.claims.note`, `leaks.report.resolvedNote` (inventory-A) | Pay-run keeps it only in the «פרטים» fold. |
| **concept.othersWaiting** | `approvals.empty.othersWaiting` / `othersWaitingMany` repeat count + role + ₪ that the "ממתין לאחרים" lane shows right below (lab: bookkeeper) | One string «אין פערים שמחכים לך.»; the numbers stay in the lane. |
| **"ממתין להחלטה"** on one pay-run row | `payRun.status.hold` ("להשהות — ממתין להחלטה") + `payRun.table.pending` ("ממתין להחלטה: ₪X") + the "לתור האישורים" button; KPI `holdHint` + `holdPending` say it again | Badge «להשהות»; the ₪ line carries the rest. |
| **read-only** | `approvals.others.readOnly` · `consolidated.proposalNote` ("לקריאה בלבד") · `consolidated.referenceNote` ("לקריאה בלבד") next to the badges "לעיון" / "הצלבה לעיון" | The badge says it; the notes drop "לקריאה בלבד". |
| **concept.ocrFailed** | `invoices.correction.ocrFailed`, `ocrQuota`; `ingest.inbox.subtitle` ("עוברות לפענוח אוטומטית"); `ingest.errors.quota_exceeded` | Short status + what to do; the inbox subtitle drops the "how". |
| **concept.vatWindow / allocation** | `vat.invoice.deadline` / `closed` on the invoice + the VAT card (inventory-A) | Same proposals as inventory-A. |
| **concept.senderInvalid** | `ingest.senders.invalid` (client) and `packages/api/src/routers/ingest.ts:208` "כתובת / מספר לא תקינים" (server, shown raw in the toast) | One catalog string; the server returns the code. |

## (c) The 10 highest-value changes (before → after)

1. **Invoice page: one instruction, only for editors** (pilot-critical). `invoices.correction.subtitle` (he.ts:8) + `invoices.correction.rerunHint` (:32)
   - Before (top): «תקנו ערכים שזוהו שגוי ב-OCR (כמות / מחיר / סכום) והריצו התאמה מחדש — מספר הדליפה מחושב מהשורות האלה.»
   - Before (bottom): «אחרי תיקון שורות או סכומים — הריצו "התאמה מחדש" כדי לחשב מחדש את החריגות ואת מספר הדליפה.»
   - After: «תקנו שורות שנקראו שגוי והריצו התאמה מחדש.» — top only; hidden for the bookkeeper and on a מרכזת (lab: −33 words for the bookkeeper, −26 for the owner and the manager).
2. **Approvals: no rule restated as a "threshold"** (pilot-critical). `approvals.tolerance.billedOverReceived` and 5 sibling rule strings (he.ts:197–203)
   - Before: «חויבו 9.5 ק״ג, התקבלו 6.5 = ‏38.70 ₪ · סף הכמות שחויבה עולה על הכמות שהתקבלה»
   - After: «חויבו 9.5 ק״ג, התקבלו 6.5 = ‏38.70 ₪»
   - Numeric thresholds stay ("סף ±2% מהמחיר או ₪5"). The sr-only summary shrinks with the line.
3. **Approvals: the "no PO yet" card** (pilot-critical). `approvals.types.UNORDERED_ARRIVAL.explain` (:174)
   - Before: «לא נמצאה הזמנה תואמת — לרוב חשבונית ריכוז או חשבונית שהגיעה מחוץ לחלון התאריכים. לא נספר כדליפה עד שיוך.»
   - After: «לא נמצאה הזמנה תואמת.» [למה?] → «לרוב אלה חשבוניות מרכזות. עד השיוך הן לא נספרות בדליפה ובהוצאה.» (`explain.pendingNotCounted`)
4. **Approvals: the bookkeeper's empty state** (pilot-critical). `approvals.empty.othersWaiting` / `othersWaitingMany` (:14–15)
   - Before: «אין פערים שמחכים לך · 10 ממתינים לאחרים (‏390.20 ₪)», then the lane right under it: «ממתין לאחרים · 10 · ‏390.20 ₪»
   - After: «אין פערים שמחכים לך.» (one key); the lane keeps the numbers.
5. **Invoice page: the duplicate-number error** (pilot-critical). `auth.serverErrors.invoiceNumberTaken` (auth/he.ts:192)
   - Before: «מספר החשבונית {n} כבר רשום בחשבונית אחרת של הספק הזה (מתאריך {d}). בדקו את המספר — או פתחו את החשבונית הקיימת.» + link «פתחו את החשבונית הקיימת»
   - After: «המספר {n} כבר רשום אצל הספק הזה ({d}).» + the same link
6. **Invoice page: OCR failed** (pilot-critical). `invoices.correction.ocrFailed` (:38), `ocrQuota` (:39)
   - Before: «לא הצלחנו לקרוא את החשבונית אוטומטית. הזינו את הסכומים והשורות ידנית, או צלמו אותה שוב מקליטת הסחורה.»
   - After: «לא הצלחנו לקרוא את החשבונית. הזינו ידנית או צלמו שוב.» (and fixes "קליטת הסחורה")
   - ocrQuota: «מכסת הסריקות החודשית נגמרה. הזינו את הנתונים ידנית.»
7. **Pay-run footnote.** `payRun.note` (:69)
   - Before: «סטטוס התשלום הוא מה שסומן במערכת — RestoMatch לא מבצעת תשלומים. סכומי הזיכוי זהים לשורות המאושרות במכתבי דרישת הזיכוי; החריגות הפתוחות מופיעות תחת "להשהות".»
   - After: «RestoMatch לא מבצעת תשלומים.» [פרטים] → «הסטטוס הוא מה שסומן במערכת. סכומי הזיכוי זהים למכתבי דרישת הזיכוי.»
8. **Pay-run rows: say each thing once.** `payRun.table.totalBasis` (:36) ×17, `payRun.status.hold` (:16) ×7, `payRun.kpis.payHint` / `holdHint` (:24, :26)
   - Before (per row): «‏999.00 ₪ כולל מע״מ … להשהות — ממתין להחלטה · ממתין להחלטה: ‏31.40 ₪»
   - After (per row): «‏999.00 ₪ … להשהות · ממתין להחלטה: ‏31.40 ₪»
   - KPI caption once (shared `payRun.kpis.countHint`): «{count} חשבוניות · כולל מע״מ»
9. **Exports: one honest scope line, details folded.** `accounting.subtitle` (:7) + `accounting.note` (:35)
   - Before: «ייצוא חשבוניות שאושרו במערכת לקבצים מובנים — CSV לגיליונות, או "קובץ אחיד" (1000) להעלאה ישירה לתוכנת הנהלת החשבונות.» … plus a 39-word footnote with "בחריגה" and "ריכוז" that says "שנבדקו"
   - After: «כל החשבוניות שנבדקו בטווח התאריכים.» [פרטים] → «נכללות כל החשבוניות שנבדקו, גם עם פערים. לא נכללות חשבוניות בקריאה, מרכזות שממתינות ועותקים כפולים.»
10. **Pay-run header and the "no PO" line.** `payRun.subtitle` (:7), `payRun.kpis.link` (:28)
    - Subtitle before: «החשבוניות של {month} שנבדקו ולא סומנו כשולמו — מה אפשר לשלם, מה להשהות ועל מה לבקש זיכוי.»
    - Subtitle after: «חשבוניות {month} שנבדקו ועוד לא סומנו כשולמו.»
    - Link line before: «2 חשבוניות ממתינות לשיוך להזמנה (‏3,603.32 ₪ כולל מע״מ) — לא נספרות בתשלום או בהשהיה.»
    - Link line after: «2 חשבוניות ממתינות לשיוך להזמנה · ‏3,603.32 ₪» [למה?] → «לרוב חשבוניות מרכזות. עד השיוך הן לא נספרות בתשלום ובהשהיה.»

Runner-up: the מרכזת panel, `consolidated.subtitle` + `proposalNote`.
- Before: «חשבונית הריכוז מול תעודות המשלוח של הספק בתקופה …» / «לקריאה בלבד: החשבונית עדיין ממתינה לשיוך, ולא נספרת בדליפה או בהוצאה.»
- After: «חשבונית מרכזת · …» / «לא נספרת בדליפה ובהוצאה עד השיוך.»

## Code changes beyond the catalogs (for the implementer)

- `app/dashboard/approvals/vocab.ts` `whyLine()`:
  - push `why.threshold` only for numeric tolerances (price, qty, date, total, vat), never for the rule strings or p90;
  - skip an empty `discrepancyExplain` segment (UNORDERED_ITEM and TOTAL_MISMATCH are cut).
- `app/dashboard/invoices/[invoiceId]/page.tsx`: pass `subtitle` only when `canEdit && !invoice.consolidated`. `correction-client.tsx:392`: delete the `rerunHint` paragraph.
- `app/dashboard/inbox/inbox-client.tsx`:
  - render `inbox.emptyDescription` only when `canManage`;
  - map `actionFailed`'s `{message}` through `friendlyError` (today the raw server Hebrew reaches English users);
  - drop the `emailHint` line.
- `app/dashboard/approvals/pay-run/page.tsx`:
  - drop the per-row `table.totalBasis`;
  - use the `<Explain>` fold (MECHANISM §2) for `kpis.link` («למה?») and `note` («פרטים»).
  - Same fold for `exports/form.tsx` `note` and the approvals UNORDERED_ARRIVAL card.
- Delete dead keys (he + en):
  - `approvals.empty.description` (page always passes `filteredNote`);
  - `approvals.rules.*` (8 keys; `ruleLabel()` has no caller).
- Every catalog edit goes to **he.ts and en.ts together**. `apps/web/lib/__tests__/i18n.test.ts` checks key and placeholder parity. It needs no edit, but it fails if en.ts is not updated. Placeholder changes: `approvals.empty.othersWaiting*` lose `{count}/{role}/{amount}`; `consolidated.status.differencesBody` loses `{amount}`; `approvals.tolerance.p90` is deleted.

## Test files that need an update (testRefs)

Only one file: **`apps/web/app/dashboard/approvals/__tests__/vocab.test.ts`**.
- :221 asserts the exact `why.sourceP90` text.
- :292 asserts "אחוזון 90".
- :27–37 loop over every engine tolerance string through `toleranceLabel` (they still pass if the keys stay and only `whyLine` skips rule tolerances; they fail if the keys are deleted).
- :226–236 the English QTY_OVER `whyText` ends with "threshold billed quantity exceeds…".

Checked and **not** affected:
- `e2e/W1-04.spec.ts:330` ("ההחלטה לא נשמרה" is still in the shortened `card.error`);
- `e2e/demo-path.spec.ts:776` (`accounting.downloaded` stays the canonical wording);
- `e2e/consolidated.spec.ts:63` (the "לעיון — טרם שויכה" badge is kept);
- `e2e/W1-05.spec.ts:285` (`summary.atRisk` label, unchanged);
- `vocab.test.ts:240` ("מספר החשבונית כבר נקלט" is still in the shortened DUPLICATE_INVOICE explain).

## Side findings in this area (not explanatory copy; route to the owner of each)

- **Retired terms in labels** (W1-08 terminology sweep):
  - `invoices.status.clean/minor/major` and `invoices.correction.discrepancies` say "חריגות";
  - `consolidated.letter.subject` says "חשבונית ריכוז" (supplier letter);
  - `approvals.types.DATE_ANOMALY.label` says "תאריך חריג" (adjective; borderline);
  - in the inventory above, the proposals already fix `payRun.kpis.holdPending/creditHint/note`, `invoices.correction.rerunHint/ocrFailed`, `accounting.note` and `consolidated.subtitle/letter.intro`.
- **Plural bug:** `payRun.kpis.payHint` renders "1 חשבוניות" (lab: last month).
- **Dead link:** the approvals "שייך להזמנה" fallback `href='/dashboard/invoices'` (list.tsx:726) is a 404 until W2-02 ships the invoice register.
- **Wrong page title for read-only roles:** the invoice page is titled "תיקון חשבונית" for the bookkeeper (read-only) and for a מרכזת. A neutral title («חשבונית {number}») would fit every role. It is a label, so it is not in the inventory.
- **Singular address** ("שלך", "אין לך", "שאישרת", "ששילמת"): the proposals fix it in `approvals.card.forbidden`, `payRun.kpis.creditHint`, `dockPrice.title/usual` and `approvals.empty.description` (cut).
