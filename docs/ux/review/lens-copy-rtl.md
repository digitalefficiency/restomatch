# Lens review: Hebrew microcopy, terminology and bidi (`copy-rtl`)

**Reviewer:** UX review team, cross-cutting lens `copy-rtl` · **Date:** 2026-10-25 (DEMO_TODAY) · **Tree:** `main` checkout at `scratchpad/ux/wt`

**Scope:**
- All 41 Hebrew namespaces in `apps/web/lib/i18n/messages/**/he.ts` (5,735 lines) and their English twins.
- Hebrew that lives outside i18n:
  - `lib/messageTemplates.ts`, `lib/vat/requestText.ts`, `lib/roles.ts` and `lib/components/activityText.ts`;
  - `packages/api/src/notifications/templates.ts` (emails);
  - `packages/api/src/match/persist.ts` (activity prose).
- All 225 captures, plus live probes against the lab (`localhost:3320`).

**Rubric groups:** E3–E10 (all of E except E1 and E2, which belong to the design-system lens), A9, C9 and C10 (copy only), F6 and H1 (copy only).

**Out of scope:** colour, spacing, the `dir="ltr"` money wrapper and `<Money>`. Those belong to `lens-design-system.md` (design-system-…) and are cross-referenced where the copy layer causes or worsens them.

**Inputs:**
- `RUBRIC.md` §0, the ten rules, E and A9.
- `research/rtl.md` (P11–P18, §2 lab, §5.2 cookbook and §5.3 ICU output).
- `fintech.md` and `erp-modern.md` (vocabulary).
- `docs/research/ניהול חשבוניות ספקים במסעדות/notes/israel_regulation_tax.md` and `israel_restaurant_operations.md`. These are the repo's own sources for the Israeli tax and ERP terms.
- `ia-map.md` and `lens-ia-nav.md` §9.4, so the nav vocabulary agrees across lenses.
- Area reviews for local copy findings:
  - `approvals-01` and `approvals-17`;
  - `chain-20`, `chain-28` and `chain-31`;
  - `command-15`;
  - `auth-19`;
  - `RCV-16`;
  - `area-receiving` §copy;
  - `area-marketing` (H1 gender).

**Method:**
1. **String census** (Python over every `he.ts`). Counts are quoted per finding. Main baseline:
   - 236 plural imperatives vs 48 masculine-singular imperative CTAs;
   - 25 singular second-person phrases;
   - 13 slash-gender forms;
   - 130 `{count}` placeholders but only 4 singular variants;
   - 46 ASCII-quoted spans, 3 „…” and 1 ״…״;
   - 94 `ב-` hyphen prefixes vs 14 `ב־` maqaf prefixes;
   - 10 emoji;
   - 18 English tokens (PO, OCR, stub, Webhook…).
2. **Term census.** For example:
   - חריגה 63 / פער 53 / הפרש 15 / ממצא 7;
   - חשבונית ריכוז 10 / מרכזת 5;
   - bare קבלה about 25;
   - תביעה 10 / דרישה 22 / בקשת זיכוי 5;
   - מסלול 22 / תוכנית 10 / חבילה 3.
3. **Live DOM probes** (`review/scripts/copy-probe.cjs`). They dump each string's on-screen left-to-right glyph order, so bidi verdicts don't depend on eyeballing.
4. **Hebrew plural sweep** (`he-plural.cjs`) and **English parity sweep** (`en-sweep.cjs`, which finds visible Hebrew not marked as an original).
5. **Bidi lab** (`review/scripts/copylab/lab.mjs` → `lab-output.txt`, `lab.png`), rendered in headless Chromium 1194 with Heebo.

**Evidence tags:**
- **[Shot]** a capture in `ux/shots/` or a crop in `review/crops-copy/`.
- **[Code]** a file:line in the worktree.
- **[Probe]** live DOM output.
- **[Lab]** bidi lab output.
- **[Census]** a grep or Python count.
- **[K]** platform knowledge, not re-verified live.

---

## Scores (0–10 against world-class)

| Lens | Score | Why |
|---|---|---|
| Mobile | **5.0** | Most mobile copy is short and calm, and the error copy is often excellent ("זה קובץ Excel ישן (‎.xls). פתחו אותו…"). But the receiver flow, the most-used mobile surface, is the worst offender:<br>- 26 of the 48 masculine-singular CTAs are in `receiving/he.ts` ("צלם", "וודא" (misspelt), "לחץ", "סגור קבלה ושמור");<br>- dev jargon reaches the dock ("צפוי PO אחד", "ביטחון OCR", "לקבע… החיסכון המוקפא", "השתמש בחשבונית-דמה");<br>- the same ₪ is called "הפסד פוטנציאלי" on one step and "חיסכון פוטנציאלי שתועד" two steps later;<br>- the inbox card offers two verbs for one tap ("פתח קבלה חדשה" + "קלוט סחורה"). |
| Desktop | **5.0** | The bosses meet four or more names for every key concept:<br>- home: סקירה / חדר הבקרה / דשבורד / מרכז הבקרה / מוקד הבקרה;<br>- discrepancy: חריגה / פער / הפרש / ממצא;<br>- claim: דרישה / תביעה / בקשה;<br>- plan: מסלול / תוכנית / חבילה;<br>- consolidated invoice: ריכוז / מרכזת;<br>- the leak explorer: בלש / חוקר / סייר.<br><br>"דליפה" also names two different ₪ metrics. Accounting words collide with the bookkeeper's own: bare "קבלה" means goods receipt here but a payment receipt in their software; "תעודת זיכוי" is not the legal "חשבונית זיכוי"; "חשב/ת" is a different job; "כרטיס ספק" has 4 meanings. |
| Functionality | **4.5** | The message runtime is missing the parts that make copy correct:<br>- no plurals: "1 מוצרים" on the owner home and "1 מקרים" on the monthly report;<br>- no bidi isolation of interpolated values;<br>- Hebrew activity rows render server-written prose that bypasses i18n and `formatIls` ("₪701 כולל מע״מ" next to the hero's "₪ 760");<br>- emails, supplier WhatsApp texts and role names live outside i18n;<br>- nothing enforces a glossary, so every fix will drift back. |

**Pilot bar:** fails, with 1 P0 (copy-rtl-01).

**World-class bar:** far off, but cheap to reach. About 80% of the fixes are string edits plus three small runtime features (plural, isolate, glossary test). That is the highest ₪-believability return per engineering hour in this review.

---

## 0. Executive summary: 10 decisions this lens asks for

1. **"דליפה" means exactly one thing:** the monthly overcharge in checked invoices, before VAT. The 30-day price-creep metric stops calling itself "דליפה / דליפות מחיר", and its page stops being "בלש הדליפות" (copy-rtl-01, **P0**).
2. **One sentence for the North Star, everywhere** (hero, report, digest, email, chain, Ask, OG): **"דליפה · {חודש}: {₪} · {pct} מהרכש שנבדק"**. "רכש שנבדק" is the only name for the base (copy-rtl-02).
3. **One money funnel with four words:** **נמצא → נדרש → זוכה → הוחזר**, plus "פתוח" (still owed) and "ויתור". The words "חיסכון", "הפסד פוטנציאלי", "נמחק", "תביעה" and "₪ חוזר" are retired from product copy (copy-rtl-03, 04).
4. **Bookkeeper-grade document names,** taken from the repo's own Israeli tax research:
   - **חשבונית מרכזת** (owner decision D-1, because AGENTS.md says "ריכוז");
   - **חשבונית זיכוי**, not "תעודת זיכוי";
   - **תעודת משלוח (ת״מ)**;
   - **קבלת סחורה**, never bare "קבלה" on desk or money surfaces;
   - **ניכוי מע״מ**, not "קיזוז";
   - **כרטסת** / **כרטיס ספק** in their accounting meanings only.

   (copy-rtl-05, 06)
5. **One discrepancy noun: "פער".** It is neutral and blame-free (E9), and it works for all 12 types. One set of 12 type labels is shared by Approvals, Ask, reports and letters, with three severity words: **חוסם · אזהרה · לידיעה** (copy-rtl-07).
6. **One way to address the user:** plural second person ("בחרו", "שלכם"). Buttons use the noun form ("שמירה", "סיום קבלת הסחורה"). There are no masculine-singular imperatives and no slash forms ("את/ה", "חשב/ת") (copy-rtl-08).
7. **Buttons name what happens to the ₪.** This is a product-wide verb grammar, which generalises `approvals-01` (copy-rtl-09).
8. **Three small runtime features in `lib/i18n/translate.ts`** (copy-rtl-10, 12, 13):
   - **ICU plural** (one / two / other, so Hebrew gets "יומיים");
   - **automatic FSI…PDI isolation of every interpolated value,** like Mozilla Fluent and Unicode MessageFormat 2;
   - **structured, locale-free server events** instead of Hebrew prose.
9. **Signs and arrows come from Intl, never from strings** (copy-rtl-11):
   - "(+{amount})" and "3%+" go;
   - "7%+" on the chain is fixed;
   - price moves read old ← new;
   - ranges are written in words.
10. **A glossary-as-code gate** (`lib/i18n/glossary.ts` + a vitest) bans retired terms per locale, so this review doesn't have to be repeated (copy-rtl-20, Big Move 1).

---

## 1. The glossary (canonical terms)

Each concept has **one Hebrew term, one English term and one definition**. The definition is shown once as a tooltip or "מה זה?" and lives in `glossary.ts`. "Retire" lists the strings the gate must reject in `he.ts`. Exceptions are named; everything else is banned.

### 1.1 Documents and objects

| # | Concept | Canonical he | en | Definition (he, one line) | Retire (he) | Today [Census] |
|---|---|---|---|---|---|---|
| G1 | Purchase order | **הזמנה** (pl. הזמנות) | Order | מה שהזמנו מהספק: פריטים, כמויות ומחיר מוסכם | "PO", "POs" (UI); "הזמנת רכש" except in accounting exports | "צפוי PO אחד", "צפויים {count} POs" (`receiving/he.ts:35-36`) |
| G2 | Delivery note | **תעודת משלוח**, short **ת״מ** | Delivery note | המסמך שהנהג מביא עם הסחורה | "ת.מ.", bare "תעודה" when ambiguous | "ת.מ. {number}" (`consolidated/he.ts:34`) |
| G3 | Goods receipt | **קבלת סחורה** (pl. קבלות סחורה); verb **לקבל סחורה**. The receiver's bottom-bar label may be "קבלה" (`lens-ia-nav` §9.4) | Receiving / goods receipt | מה שספרנו ובדקנו בדלת, מול ההזמנה | "קליטת סחורה", "קלוט סחורה", "תעודת קבלה", bare "קבלה/קבלות" in desk or money copy | nav "קליטת סחורה"; about 25 bare "קבלה", incl. the hero "תואמות להזמנות ולקבלות" (`overview/he.ts:26`) |
| G4 | Consolidated invoice | **חשבונית מרכזת** (pl. חשבוניות מרכזות). **D-1**: matches "חשבונית מס מרכזת" in the Tax Authority wording and "חשבונית ספק מרכזת" in Priority (repo research `israel_regulation_tax.md:57,68`, `israel_restaurant_operations.md:25`). If the owner keeps "ריכוז", the 5 "מרכזת" strings flip instead. | Consolidated invoice | חשבונית אחת לחודש שמכסה כמה תעודות משלוח | whichever loses D-1; the bare tag "מרכזת" | ריכוז ×10, מרכזת ×5 (ledger), plus "חשבונית הריכוז" ×3 |
| G5 | Credit invoice | **חשבונית זיכוי** | Credit note | המסמך שהספק מוציא כשהוא מזכה אותנו (סעיף 49 לחוק מע״מ) | "תעודת זיכוי" | `recovery/he.ts:10,17,46,63,73` |
| G6 | Allocation number | **מספר הקצאה** | Allocation number | מספר מרשות המסים שבלעדיו אי אפשר לנכות את המע״מ | — | consistent ✓ |
| G7 | Price list | **מחירון** | Price list | | | consistent ✓ |
| G8 | Agreed price | **מחיר מוסכם** (PO or contract). **מחיר חוזה** only inside the contracts feature | Agreed price / contract price | | "מהמצופה" when the source is known | |
| G9 | Usual price | **המחיר הרגיל** | Usual price | החציון של מה ששילמתם לספק על הפריט ב-N הימים האחרונים | "מחיר חציוני", "החציון", "אחוזון 90" in labels. These stay allowed in "איך חישבנו" text only. | `leaks/he.ts:24,28`, `suppliers/he.ts:86` |
| G10 | SKU | **מק״ט** | SKU | | | consistent ✓ |
| G11 | Supplier ledger | **כרטסת ספק** | Supplier ledger | | | ✓ |
| G12 | Supplier page | **דף הספק** | Supplier page | | "כרטיס ספק" for the page or the scorecard | "כרטיס ספק" used 4 ways (`ask/he.ts:45`, `catalog/he.ts:131`, `suppliers/he.ts:147,157`, `integrations/he.ts:34`) |
| G13 | Supplier account code | **כרטיס ספק** (accounting meaning only) | Supplier account | הקוד של הספק בתוכנת הנהלת החשבונות | | `integrations` ✓ |
| G14 | Supplier scorecard | **דירוג ספק** | Supplier score | | "כרטיס ספק — 90 יום" | `suppliers/he.ts:147` |
| G15 | Dock slip | **דוח פערים לנהג** | Dock discrepancy slip | מה שמראים לנהג לפני שהוא יוצא | "תעודת חריגה"; "תעודת מחלוקת" (DEMO-PACK) | `receiving/he.ts:160,162` |

### 1.2 Money words (the ₪ story; A9)

| # | Concept | Canonical he | en | Definition | Retire | Today |
|---|---|---|---|---|---|---|
| G16 | Leak | **דליפה**. Only this metric. Verb in sentences: "דלף". | Leak | כסף שחויב ביתר בחשבוניות שנבדקו, לפני מע״מ, בתקופה | "הפסד", "הפסד פוטנציאלי", "ההפסד המוערך"; "דליפות מחיר" and "בלש הדליפות" for creep; "חיסכון" for the same ₪ | 7 labels (copy-rtl-02) |
| G17 | Leak base | **רכש שנבדק** | Checked spend | סכום החשבוניות שנבדקו מול הזמנה, לפני מע״מ | "ההוצאה על סחורה", "ההוצאה שנבדקה", bare "הוצאה", "רכש נבדק", "מההוצאה" | 5 phrasings |
| G18 | Above usual price (creep) | **מעל המחיר הרגיל** (metric); **עליית מחיר** (event) | Above usual price / price rise | | "זחילת מחירים", "דליפות מחיר", "מוקדי זחילה" | `overview/he.ts:38`, `leaks/he.ts:12-28`, `leaks/he.ts:122` |
| G19 | Over contract | **מעל החוזה** | Over contract | | | ✓ |
| G20 | Discrepancy | **פער** (pl. פערים) | Discrepancy | שורה שבה החשבונית לא תואמת להזמנה או לקבלת הסחורה | "חריגה" (as this noun), "הפרש", "ממצא" (except leak-proof "ממצא" = a counted finding row → also פער), "אי-התאמה" as a noun | חריגה ×63 / פער ×53 / הפרש ×15 / ממצא ×7 |
| G21 | Severity | **חוסם · אזהרה · לידיעה** | Blocking · Warning · FYI | | "מידע", "חומרה גבוהה/בינונית", "חריגות קלות/חמורות", "חומרה בינונית ומעלה" | 3 vocabularies (copy-rtl-07) |
| G22 | Caught before payment | **נתפס לפני תשלום** (a property of a פער on an unpaid invoice, not a state) | Caught before payment | | | ✓ |
| G23 | Funnel state 1 | **נמצא** | Found | פער שהמערכת מצאה | | |
| G24 | Funnel state 2 | **נדרש** | Claimed | פער שהחלטתם לדרוש מהספק | "נדרש בחזרה" | ✓ mostly |
| G25 | Funnel state 3 | **זוכה** | Credited | הספק הוציא חשבונית זיכוי | "התקבל זיכוי", "זוכה (תעודת זיכוי)" | `recovery/he.ts:10,55` |
| G26 | Funnel state 4 | **הוחזר** | Returned | הכסף ירד מתשלום או הוחזר בפועל | "חזר בפועל", "הכסף חזר", "חזר החודש" | `recovery/he.ts:11,56,88,103,145` |
| G27 | Outstanding | **פתוח** (= נדרש − זוכה). Sentence form: "הספקים עדיין חייבים לכם {₪}" | Outstanding | | "עדיין חייבים לך" (singular) | `recovery/he.ts:12,104,146` |
| G28 | Written off | **ויתור** (+ ConfirmDialog naming the ₪ and the supplier, C10) | Written off | ויתרנו על דרישה שכבר נשלחה | "נמחק", "מחיקה" (reads as data deletion; `chain-28`) | `recovery/he.ts:13,58,66` |
| G29 | Decided not to claim | **שולם כפי שחויב** (`approvals-01`) | Paid as billed | | "ויתור", "דחייה" for this decision | `approvals/he.ts:48`, `leaks/he.ts:118` |
| G30 | Claim | **דרישת זיכוי** (pl. דרישות זיכוי); verb **לדרוש זיכוי** | Credit claim | | "תביעה", "לתבוע" (in Hebrew this means a **lawsuit**), "בקשת זיכוי", "לבקש זיכוי", "זיכויים לבקש" | תביעה ×10, בקשה ×5 |
| G31 | Claim letter | **מכתב דרישת זיכוי**. Letter subject: "דרישה לזיכוי". The owner may soften it to "בקשה לזיכוי" (D-3), but only inside the letter body. | Claim letter | | "מכתבי התביעה", "מכתבי זיכוי לספקים" | `suppliers/he.ts:146`, `ask/he.ts:42`, `leaks/he.ts:67` |
| G32 | VAT at risk | **מע״מ בסיכון**; verb **לנכות** (ניכוי מע״מ תשומות) | VAT at risk | | "לקזז", "קיזוז" | `vat/he.ts:9,34,35` + `lib/vat/requestText.ts:36`; the same card says both |
| G33 | Food cost | **עלות מזון** (%) | Food cost | | "פוד קוסט" | `inventory/he.ts:99` |
| G34 | Theoretical | **תאורטי** (Academy spelling) | Theoretical | | "תיאורטי" | `recipes/he.ts:11,187` vs `inventory/he.ts:108,111` |
| G35 | Tolerance | **סבולת** | Tolerance | הסטייה שמותר לספק בלי שנסמן פער | "סבילות" (means tolerability) | settings ×6 vs leakProof ×1 |

### 1.3 Places, roles and system words

| # | Concept | Canonical he | en | Retire | Today |
|---|---|---|---|---|---|
| G36 | Home | nav **בית**. The owner's `h1` stays "חדר הבקרה" (`lens-ia-nav` §9.4) | Home / Control room | "סקירה", "דשבורד", "דאשבורד", "מרכז הבקרה", "מוקד הבקרה", "Command center" | 5 names: `nav/he.ts:10`, `auth/he.ts:84`, `admin/he.ts:11`, `recovery/he.ts:81`, `leakCheck/he.ts:119`, `templates.ts:107` |
| G37 | Leak hub | nav **דליפה**. Tabs: **פירוט · פילוח · מגמת מחירים** | Leak | "בלש הדליפות", "חוקר הדליפה", "סייר הדליפות" | 3 page names for one place |
| G38 | Credits | nav **זיכויים**; page **מעקב זיכויים** | Credits | "₪ חוזר", "מעקב ₪ חוזר", "₪ back", "₪-back tracker" | |
| G39 | Chain | **סקירת רשת** | Chain overview | "דאשבורד רשתי" | `chain/he.ts:11,17,110,112` |
| G40 | Approvals | **אישורים** | Approvals | "תור אישורים" as the nav label | |
| G41 | Plan | **מסלול**; a feature is **יכולת** | Plan / feature | "תוכנית", "חבילה", "פיצ׳ר" | מסלול ×22 / תוכנית ×10 / חבילה ×3 / פיצ׳ר ×5 |
| G42 | Matching | **התאמה** (verb להתאים) | Match | "הצלבה/להצליב", "השוואה(ות)", "match runs", "הרצות התאמה" | התאמ ×32 / הצלב ×11 / השוואה ×14 |
| G43 | Counting at the door | **ספירת כמויות** | Count quantities | "התאמת כמויות" (this collides with G42) | `receiving/he.ts:92,115` |
| G44 | Machine reading | **קריאת החשבונית**. "OCR" only in Settings › סף בדיקה and admin | Reading the invoice | "OCR" in field and owner copy, "פענוח", "עיבוד", "ביטחון OCR" | OCR ×7, פענוח ×6 |
| G45 | Roles (labels) | **בעלים · ניהול · הנהלת חשבונות · קבלת סחורה · מטבח**. In sentences use plural people: "בעלים ומנהלים" | Owner · Manager · Bookkeeper · Receiver · Chef | "מנהל/ת", "חשב/ת" (a comptroller is a different job), "מקבל סחורה" as a role chip, "רואה החשבון" when the bookkeeper is meant | `lib/roles.ts:14-18`, `suppliers/he.ts:201`, `inventory/he.ts:75` |
| G46 | Email | **מייל** | Email | "אימייל", "דוא״ל", 'דוא"ל' | מייל ×30 / אימייל ×12 / דוא״ל ×1 |
| G47 | All | **הכול** (Academy) | All | "הכל" | הכל ×16 / הכול ×6 |
| G48 | Import / export | **ייבוא / ייצוא** | | "יבוא", "יצוא" | `integrations/he.ts:15`, `views/he.ts:81` |

### 1.4 Units and abbreviations (E7)

ק״ג · גרם · ליטר (ל׳) · מ״ל · יח׳ · ארגז · מארז · תבנית · מע״מ · ח״פ · סה״כ · מס׳ · ת״מ · חד״פ · מו״מ · יום א׳.

Rules:
- **Gershayim U+05F4 and geresh U+05F3 only.**
- **"ח״פ", not "ח.פ."** (7 sites).
- **"₪" in UI sentences;** "ש״ח" only in legal text.
- **Receiver flows add a spoken form,** for example `<span aria-hidden>ק״ג</span><span class="sr-only">קילוגרם</span>` (`UnitText`).

---

## 2. House style (write once, enforce in CI)

### 2.1 Voice and address
- **Plural second person, always.** Use "בחרו", "שלכם" and "אין לכם הרשאה".
  - This is already the house majority: 236 plural imperatives vs 48 masculine-singular.
  - Benchmark: Wix and Monday.com Hebrew UIs [K]; the Gov.il plain-Hebrew guide recommends gender-inclusive plural address [K].
- **Buttons and menu items use the noun form** (שם פעולה), with an object when it isn't obvious. Examples: "שמירה", "שליחת ההזמנה", "סיום קבלת הסחורה", "צילום החשבונית".
- **Navigation links use "ל" plus the destination,** as the codebase already does well. Examples: "לתור האישורים", "לדף הספק".
- **Instructions in body text use the plural imperative.** Examples: "צלמו את כל העמודים", "ודאו שהשורות נראות".
- **No slash forms** ("את/ה", "שלו/ה", "בעל/ת"). Screen readers read them as "את לוכסן ה". Rewrite with plural or neutral phrasing:
  - "רק מי שמשלם על החשבון יכול לפתוח סניף" → better: "פתיחת סניף זמינה לבעלי חשבון החיוב";
  - "(אתם)";
  - "הצטרפו ב-{date}" → "הצטרפות: {date}".
- **Calm, factual and blame-free (E9).** Examples:
  - "הספק חייב מעל המחיר שסוכם", not "הספק עבד עליכם".
  - No "כל הכבוד", no "מצוין", no 🎉/👏/⚠️/✓ in strings (10 today). Icons belong in components.

### 2.2 CTA verb grammar (generalises `approvals-01`; C12, E9)

| Situation | Pattern | Example (he) | en |
|---|---|---|---|
| Money decision | noun + ₪ + party | **דרישת ‎₪104.80 מהספק** · **אישור לתשלום כפי שחויב** | Claim ₪104.80 back · Pay as billed |
| Outbound to a supplier | preview, then "שליחה ל{ספק}" + deferred "ביטול שליחה" (R-8) | "שליחת המכתב לתנובה" → "נשלח בעוד 10 שניות · ביטול שליחה" | |
| Destructive or write-off | confirm button names the ₪ and the party (C10) | "ויתור על ‎₪320 מקצביית הכרם" | Write off ₪320 from Kerem Butchery |
| Field step | noun naming the next state | "התחלת קבלת סחורה" → "המשך ספירה · 3/12" → "סיום קבלת הסחורה" | Start receiving · Continue 3/12 · Finish receiving |
| Never | a bare "אישור" / "אשר" / "דחה" / "כן" / "פעולות" / "עבד" / "סדר" | — | — |

### 2.3 Numbers, plurals and units (E7, E8)
- **Never type ₪, %, + or − into a string.** Placeholders receive pre-formatted values from `formatIls` and `formatPercent`. Signs come from `signDisplay:'exceptZero'`; for ₪ this is a human-PR option on `formatIls` (rubric R-6/E4). For % it is a local `formatPercent` option, which is agent-safe.
- **Plurals use ICU forms with the Hebrew dual,** for example `{count, plural, one {יום אחד} two {יומיים} other {# ימים}}`. No "1 מוצרים", "2 ימים" or "לפני 2 ימים" (use `formatRelative`).
- **Ranges are written in words:** "מ-25.10 עד 31.10", "בין 5 ל-15 שניות", "3% ומעלה". Never "{from} – {to}" for money or dates.
- **Number prefixes take one hyphen-minus:** "ב-25.10", "ל-RestoMatch". The 14 maqaf `ב־` strings align to the 94-site majority, and search folds both forms.
- **Ellipsis "…" (U+2026) is for progress states only.** No "..." (2 sites).

### 2.4 Bidi authoring rules (E3, E4, E5)
1. **Never put quote marks around an interpolated name, file or number** ("מהספק \"{supplier}\"" → "{supplier}"). An ASCII quote next to a Latin name breaks: `".Coca-Cola Ltd"מ` [Lab I]. The runtime isolates values (copy-rtl-13); emphasis comes from weight.
2. **Price moves are written "{old} ← {new}" in Hebrew** (R-4), and preferably rendered by `<PriceMove>`. Never "→" in `he.ts` (0 today ✓); never a component-forced LTR "→" (the home recipes card does this, copy-rtl-11).
3. **Percent signs come from Intl.** A trailing "+" for "and above" is banned (it renders "+3%", [Probe]).
4. **Plain text that leaves the app is isolated with FSI/PDI** (U+2068/U+2069) around every value. This covers WhatsApp, CSV, mail text and the clipboard.

### 2.5 Message templates (C8, C9)

| Type | Template | Example |
|---|---|---|
| Error | What happened + what to do now (+ what was kept). ≤2 sentences. **No raw `{message}`.** | "השמירה לא הצליחה כי אין חיבור. הכמויות שמורות בטלפון ויישלחו כשהחיבור יחזור." |
| Empty | What will appear here + the action that makes it appear + 1 CTA | "אין משלוחים צפויים היום. המשלוח הבא: יום ב׳ 07:30 · ירקות השרון" [לכל ההזמנות] |
| Success | Only when the result isn't visible. Past tense, ≤4 words, no "בהצלחה". | "המכתב נשלח לתנובה" |
| Estimate | Always say "הערכה" (A4, H4) | "‎₪12,400 · הערכה לפי מחירי ההזמנה" |
| Role gate | Who can + who to ask; never "רק לבעלי תפקיד "בעלים"" | "המסך זמין לבעלים. אפשר לבקש גישה מ{owner}." |

---

## 3. Findings

Severity: P0 = misleads a core money task or trust; P1 = major; P2 = polish; P3 = nit. The rubric escalator applies on primary flows.

---

### copy-rtl-01 · P0 · trust/copy · `/dashboard`, `/dashboard/leaks`, `/dashboard/suppliers/[id]` · owner, bookkeeper · both · [A9, E9, H3]

**The word "דליפה" names two different ₪ metrics, and the page called "בלש הדליפות" shows both.**

- **Evidence:**
  - Owner home section "זחילת מחירים · 30 יום אחרונים". Its subtitle says the metric is "לא נכלל בדליפת החודש", but its link reads "לכל הדליפות" (`overview/he.ts:38-41`) [Shot `dashboard__owner__desktop-he.png` y≈2,880].
  - The nav item "בלש דליפות" opens `/dashboard/leaks`. The h1 "בלש הדליפות" is defined as price creep ("מוצרים שבהם המחיר האחרון חורג מהאחוזון ה-90"). But the first ₪ under it is "חוקר הדליפה · דליפה בתקופה ‎₪760", which is the monthly leak (`leaks/he.ts:8-9`, `views/he.ts:80`) [Shot `dashboard_leaks__owner__desktop-he__t0.png`].
  - The creep table still says "דליפות מחיר לפי מוצר וספק" and "לא נמצאו דליפות מחיר פעילות" (`leaks/he.ts:12,21`).
  - On the supplier page, the header ₪ is creep ("שולם מעל המחיר החציוני (30 יום) ‎₪73"). The tab beside it is "דליפה ‎₪415.72 ב־90 הימים", which is the leak rule (`suppliers/he.ts:86,139`) [Probe `?tab=leak`].
  - The leak page for the same supplier shows "דגי הים התיכון ‎₪73" under "דליפה לפי ספק". So **₪73 appears once as "leak" and once as "paid above median"**, and the owner cannot tell which one is the leak.
  - A third name, "סייר הדליפות", points to the same explorer (`suppliers/he.ts:141,203`).
- **Problem:**
  - The North Star is one ₪ figure that one owner believes. When the hero's word also labels a different, rolling, median-based number, a careful owner who compares surfaces finds "two leaks". That is the trust failure H3 and A9 exist to prevent.
  - A9 counts synonym or homonym tiles as S1, and the owner home is a primary flow. The escalator makes this S0.
- **Fix:**
  1. Reserve **דליפה** for G16.
  2. Rename the creep metric:
     - **"שולם מעל המחיר הרגיל · 30 הימים האחרונים"**;
     - the section **"מחירים שעלו"**;
     - the link "למגמת המחירים";
     - the table caption "מחירים מעל הרגיל, לפי מוצר וספק";
     - the empty state "אין כרגע מחירים מעל הרגיל".
  3. Restructure the leak hub nav per `lens-ia-nav` §9.4. Nav "דליפה" opens tabs "פירוט" (breakdown), "פילוח" (today's "חוקר הדליפה") and "מגמת מחירים" (today's "בלש הדליפות"). Retire "בלש", "חוקר" and "סייר".
  4. Supplier header: show the 90-day **leak** as the page ₪, with scope "דליפה · 90 הימים האחרונים". Creep moves into the tab as a secondary line.
  5. Full rewrite rows: §4 (overview, leaks, views, suppliers, ask, nav).
- **Exemplar:** Stripe defines each balance state once (Available, Pending) and never reuses the word for another figure. Ramp says "Spend" in exactly one sense across cards, bills and reports [K].
- **Effort:** S (strings) + S (tab rename).
- **humanPR:** no.

---

### copy-rtl-02 · P1 · copy/trust · hero, `/reports/monthly`, `/reports/digest`, weekly/monthly email, `/chain`, Ask, activity · owner, bookkeeper · both · [A9, B3]

**The same leak has seven labels and five names for its base.**

- **Evidence:**

  | Surface | Label | Base | Source |
  |---|---|---|---|
  | Hero | "דליפה שזוהתה · {month}" + "דלף החודש" | "{pct} מההוצאה על סחורה · מתוך {spend} לפני מע״מ" | `overview/he.ts:10-13` |
  | Monthly report preview | "{amount} דלפו · {pct} מהרכש" | | `recovery/he.ts:98` |
  | Digest | "דלף מהרכש" | "{pct} מהרכש שנבדק ({spend})" | `recovery/he.ts:138-139` |
  | Leak report | "דלף החודש" | "{pct} מההוצאה על סחורה" | `leaks/he.ts:107-108` |
  | Breakdown | "סה״כ דליפה" | "{pct} מההוצאה" | `leaks/he.ts:43-44` |
  | Explorer | "דליפה בתקופה" | "מההוצאה" + "הוצאה שנבדקה" | `views/he.ts:72-75` |
  | Chain | "דליפה ברשת" | "מתוך {spend} רכש נבדק" | `chain/he.ts:22-23` |
  | Ask | "החודש דלפו {leak}" | "מההוצאה שנבדקה" | `ask/he.ts:48` |
  | Activity | "הפסד פוטנציאלי ₪105" | | `persist.ts:280` |
  | Email | "₪X נחסכו / דולף" | | `templates.ts:357-364` |

  The en hero says "of food spend" while he says "על סחורה", so the parity is broken too [Shot `dashboard__owner__desktop-en__t0.png`]. This extends `command-15`, which logged the labels; this finding fixes the **base** term and the sentence.
- **Fix:**
  - One canonical pair in `overview/he.ts` is reused by every surface. `messages/overview` becomes the owner of `leakLabel`/`leakBase`, imported by `leaks`, `recovery`, `views`, `chain`, `ask` and the email templates:
    - `leakLabel: 'דליפה · {period}'`;
    - `leakBase: '{pct} מהרכש שנבדק · {spend} לפני מע״מ'`.
  - Scope words: "אוקטובר (עד 25.10)" for the running month, "אוקטובר 2026" for a closed month, and "90 הימים האחרונים".
  - English: "Leak · {period}" and "{pct} of checked spend · {spend} before VAT". Never "food spend". R-14 suggests "מזון", but the base includes non-food lines (`inventory/he.ts:101` separates them), so "רכש שנבדק" is the accurate term.
  - Precision stays at 0 dp on every hero-class surface (B3).
- **Exemplar:** Stripe's "Gross volume" means the same thing on Home, Reports and email, with the period as a suffix [K]; Polaris content guidelines ("use the same term for the same thing").
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-03 · P1 · copy/trust · receiving wizard, approvals, activity, weekly email · receiver, owner · mobile-first · [A9, E9, H4]

**The same caught ₪ flips between "loss" and "savings".**

- **Evidence:**
  - **Receiving recon step:** "הפסד פוטנציאלי מההפרשים:", with the hint "…ולהגדיל את החיסכון המוקפא" (`receiving/he.ts:91-92`).
  - **Two taps later, the confirmed step:** "חיסכון פוטנציאלי שתועד" (`:152`).
  - **Approvals subtitle:** "אישור = נדרוש את הכסף מהספק (נספר כחיסכון)" (`approvals/he.ts:10`).
  - **Activity:** "חיסכון {amount}" (`components/he.ts:55`).
  - **Weekly email:** "הסיכום השבועי שלך — {₪} נחסכו", with "נחסך/נמנע השבוע" (`templates.ts:357,363`).
  - **Approvals card:** "ההפסד המוערך" for a deterministic delta (`approvals-17`).
- **Problem:**
  - "Savings" claims money the restaurant hasn't got back, which contradicts the funnel (G23–G26).
  - "Loss" next to "savings" for the same ₪ makes the receiver doubt the screen.
  - On the dock, a primary flow, this is S1, escalating toward S0.
- **Fix:**
  - The receiver sees **"פערים מול ההזמנה: ‎₪{x}"** then **"פערים שנרשמו בקבלה: ‎₪{x}"**. The owner sees "נמצא".
  - "חיסכון" is allowed only in pricing and marketing ("חיסכון של ₪X בשנה").
  - Weekly email subject: "{week}: נמצאו ‎₪{x} בפערים · ‎₪{y} עוד פתוחים".
  - "ההפסד המוערך" → "הפער".
- **Exemplar:** Intuit content design: the label describes the state of the money, never a hoped-for outcome [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-04 · P1 · copy · `/recovery`, `/leaks/claims`, Ask, supplier leak card, pay-run, nav · owner, bookkeeper · desktop · [A9, E9, C10]

**Claim and credit vocabulary: "תביעה" means a lawsuit, there are 7 status words for a 4-state funnel, and the write-off reads as deletion.**

- **Evidence:**
  - **"תביעה/לתבוע" ×10:**
    - "מה כדאי לתבוע השבוע?" and "אפשר לתבוע {total}" (`ask/he.ts:16,59`);
    - "מכתבי התביעה" (`suppliers/he.ts:146`);
    - "תביעות ב„מעקב ₪ חוזר”" (`leaks/he.ts:85-89`).
  - **"בקשת/לבקש זיכוי" ×5:**
    - pay-run "לבקש זיכוי {amount}" and "זיכויים לבקש" (`payRun/he.ts:20,29`);
    - letter subject "בקשת זיכוי" (`leaks/he.ts:74,88`).
  - **"דרישה" ×22.**
  - **Statuses:** "נדרש · מכתב נשלח · הספק אישר · התקבל זיכוי · הכסף חזר · במחלוקת · נמחק". The tiles use "זוכה (תעודת זיכוי)" and "חזר בפועל", and "שיעור החזר" is defined as זוכה ÷ נדרש (`recovery/he.ts:9-14,51-58`) [Shot `dashboard_recovery__owner__desktop-he__t0.png`].
  - **"מחיקה" is a money write-off** (`recovery/he.ts:66`). It is also a `<select>` with no confirm (C10, `chain-28`).
  - **The nav and h1 are the symbol-led "₪ חוזר".** A screen reader says "שקל חדש חוזר" [Probe].
- **Fix:**
  - Apply G28–G31 and G38:
    - one noun, "דרישת זיכוי";
    - tiles **נדרש · זוכה · הוחזר · פתוח**;
    - chips "נדרש → מכתב נשלח → הספק אישר → זוכה → הוחזר", plus "במחלוקת" and "ויתור";
    - "שיעור זיכוי" = זוכה ÷ נדרש;
    - the write-off button "ויתור על ‎₪{x} מ{ספק}" behind a ConfirmDialog.
  - The nav label becomes "זיכויים" and the page "מעקב זיכויים".
  - English: "Credits", "Credit claim", "Claimed · Credited · Returned · Outstanding · Written off".
- **Exemplar:** Stripe Disputes uses a fixed state list with one definition each [K]; BILL vendor-credit states [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-05 · P1 · copy/trust · consolidated panel, ledger, inventory period, recovery, VAT card · bookkeeper, owner · desktop · [E9, A9]

**Document names don't match the bookkeeper's legal and ERP vocabulary.**

- **Evidence:**
  - **Consolidated invoice:**
    - "חשבונית ריכוז" in the overview, approvals, leaks, leakProof, consolidated, components and inventory (×10 + "חשבונית הריכוז" ×3);
    - "חשבונית מרכזת" / "מרכזות" in the ledger (`suppliers/he.ts:167,174,187,195,198`).
    - The ledger therefore labels the very documents that the hero calls "ריכוז" as "מרכזות".
    - The repo's own research cites "חשבונית מס מרכזת" (Tax Authority) and "חשבונית ספק מרכזת" (Priority KB Q0001180) (`israel_regulation_tax.md:57,68`, `israel_restaurant_operations.md:25`).
  - **Credit document:** "תעודת זיכוי" ×5 (`recovery/he.ts`). The legal document is a **חשבונית זיכוי** (s.49 VAT Law, same research file), which is the term in the bookkeeper's software.
  - **Delivery-note abbreviation:** "ת.מ." (`consolidated/he.ts:34`).
  - **VAT card:** "אי אפשר לקזז את המע״מ" next to "נותרו כ-154 ימים לניכוי" on the same card (`vat/he.ts:9,22`) [Shot `dashboard__owner__desktop-he__t0.png` y≈1,000]. The supplier request text uses "לקזז" too (`lib/vat/requestText.ts:36`).
  - **"כרטיס ספק"** means the supplier page (Ask, catalog import), the scorecard (`suppliers/he.ts:147`), the negotiation printout (`:157`) and the GL account (`integrations/he.ts:34`).
  - **Dock slip:** "תעודת חריגה" in the UI vs "תעודת מחלוקת" in DEMO-PACK. Neither term exists in Israeli practice.
- **Fix:**
  - Apply G2, G4 (D-1), G5, G12–G15 and G32.
  - Add the definitions as a "מה זה?" tooltip on first use in the ledger, the consolidated panel and the recovery credit form.
  - If D-1 goes to "מרכזת", AGENTS.md §Design vocabulary ("חשבוניות ריכוז") needs a human edit.
- **Exemplar:** Priority ERP Hebrew UI; Morning (Green Invoice) document types "חשבונית מס מרכזת" and "חשבונית זיכוי" [K]; Ramp and BILL use their accountants' GL vocabulary [K].
- **Effort:** S.
- **humanPR:** yes, only for the AGENTS.md vocabulary line, which is immutable. All strings are agent-safe.

---

### copy-rtl-06 · P1 · copy/ia · nav, receiving, hero, ledger, suppliers form, activity · all roles · both · [E9]

**Goods receipt has four names, and bare "קבלה" collides with the bookkeeper's payment receipt.**

- **Evidence:**
  - Nav and h1 "קליטת סחורה" (`nav/he.ts:11`, `receiving/he.ts:7`).
  - CTA "קלוט סחורה" with the status line "פתח קבלה חדשה" on the same card (`receiving/he.ts:17-18`; `receiving/page.tsx:95-99`) [Shot `dashboard_receiving__receiver__phone-he__t0.png`].
  - "תעודת קבלה" (`suppliers/he.ts:65`).
  - "קבלת סחורה" in marketing, the PWA and 9 files.
  - About 25 bare "קבלה/קבלות", including:
    - the owner hero "כל החשבוניות שהותאמו תואמות להזמנות **ולקבלות**" (`overview/he.ts:26`);
    - the supplier scores "ברגע שייכנסו **קבלות** וחשבוניות" (`suppliers/he.ts:16`);
    - the activity "תואמת להזמנה **ולקבלה**" (`components/he.ts:49,56`).
  - In Israeli accounting software, "קבלה" is the payment-receipt document ("חשבונית מס/קבלה") [K]. A bookkeeper reads "invoices that match orders and receipts" as payment receipts.
  - "התאמת כמויות" (the count step) reuses the matching word (`receiving/he.ts:92,115`).
- **Fix:**
  - Apply G3 and G43 (aligned with `lens-ia-nav` §9.4):
    - "קבלת סחורה" everywhere;
    - "קבלה" only as the receiver's bottom-bar label;
    - the hero "תואמות להזמנות ולקבלות הסחורה";
    - one CTA per card that names the next state ("התחלת קבלת סחורה" / "המשך קבלת הסחורה · 3/12");
    - the count step "ספירת כמויות".
- **Exemplar:** Priority "קבלת סחורה" / GRV; Restaurant365 "Receiving"; MarketMan "Receive order" [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-07 · P1 · copy · approvals, Ask, invoice detail, leak reports, hero method · owner, manager, bookkeeper · both · [E9, H1, A9]

**There are four nouns for a discrepancy, two lists of the 12 type labels, and three severity vocabularies.**

- **Evidence:**
  - **Nouns:** חריגה ×63, פער ×53, הפרש ×15, ממצא ×7. One claim letter uses both "חריגות" (subject) and "הפרשים" (intro, column) (`leaks/he.ts:74-80`).
  - **Type labels differ between Approvals and Ask:**

    | Type | Approvals | Ask |
    |---|---|---|
    | PRICE_HIGHER | "מחיר גבוה מהמצופה" | "מחיר גבוה מהמוסכם" |
    | QTY_SHORT | "חסר בכמות שהתקבלה" | "חוסר בכמות" |
    | UNIT_MISMATCH | "אי-התאמת יחידות" | "אי-התאמה ביחידות" |
    | VAT_MISMATCH | "אי-התאמת מע״מ" | "פער במע״מ" |
    | TOTAL_MISMATCH | "סה״כ לא תואם לשורות" | "פער בסה״כ" |
    | UNORDERED_ITEM | "פריט בחשבונית ללא הזמנה" | "פריט שלא הוזמן" |

    Ask also lacks PRICE_LOWER and UNORDERED_ARRIVAL (`approvals/he.ts:52-115` vs `ask/he.ts:64-75`).
  - **Severity:**
    - badges "חוסם/אזהרה/מידע";
    - routing "חומרה גבוהה — אישור בעלים", "הפרש מצטבר בינוני — מנהל" [Shot `dashboard_approvals__owner__phone-he__t1.png`];
    - invoice status "חריגות קלות/חמורות" (`invoices/he.ts:44-47`);
    - hero and report method "חומרה בינונית ומעלה" (`overview/he.ts:27`, `leaks/he.ts:141`);
    - leakProof "ברמת אזהרה או חסימה" (`leakProof/he.ts:35`).
  - **English parity:** the he hero says "בינונית ומעלה" and the en hero says "Warning- and blocker-level".
- **Fix:**
  - One noun, "פער" (G20). "חריגה" is retired as this noun because it implies a violation and puts blame on the supplier (E9).
  - Ask imports `approvals.types.*.label` instead of its own map.
  - Canonical labels:
    - PRICE_HIGHER "מחיר גבוה מהמוסכם" (explain names the source: "בהזמנה ‎₪X · בחשבונית ‎₪Y");
    - QTY_SHORT "התקבל פחות מההזמנה";
    - UNIT_MISMATCH "יחידת מידה שונה";
    - VAT_MISMATCH "מע״מ לא תואם";
    - TOTAL_MISMATCH "הסה״כ לא תואם לשורות";
    - UNORDERED_ITEM "חויב פריט שלא הוזמן".
  - Severity G21 everywhere. Routing reads "חוסם — החלטת בעלים", "פערים מצטברים בחשבונית — החלטת מנהלים", "פער זניח — סומן אוטומטית כתקין".
  - Invoice status: "תקינה · פערים לידיעה · פערים לטיפול · חוסם".
- **Exemplar:** Ottimate and Plate IQ exception taxonomies (one list shared by the queue, reports and vendor emails) [K]; H1 "every flag explains itself" with the same words in every density.
- **Effort:** S. **humanPR:** no. Labels only; the `DiscrepancyType` union is untouched.

---

### copy-rtl-08 · P1 · copy · receiving wizard, approvals, inventory count, invoice correction, views toolbar, auth, team, chain, emails · all · mobile-first · [E9, F6]

**Grammatical person drifts inside the same screen, worst on the dock.**

- **Evidence:**
  - **[Census] masculine-singular imperative CTAs: 48.** 26 are in `receiving/he.ts`:
    - "בחר", "צלם", "וודא" (Academy spelling is "ודא"), "עבד", "השתמש", "חזור", "הצג", "רענן", "עבור", "אמת", "התקשר", "לחץ", "הפחת", "הגדל", "סדר", "סגור קבלה ושמור", "העתק", "שלח", "שתף";
    - `approvals` "פתח/דחה/אשר/העבר/טען";
    - `inventory` "בדוק", "סיים ספירה", "כן, סיים";
    - `invoices` "צפה/הרץ/שמור/ערוך/הצג";
    - `views` "החל/נקה";
    - `auth` "זכור אותי", "התנתק והתחבר מחדש".
  - **Singular second person: 25.** Examples:
    - "ההחלטה שלך", "שאישרת", "ברגע שתקלוט… ותטפל" (`overview/he.ts:7,18,47`);
    - "דרשת", "חייבים לך", "שתקבל", "אליך" (`recovery`);
    - "אין לך הרשאה" in receiving, approvals and chain.
  - **Slash forms: 13**, plus `lib/roles.ts` ("מנהל/ת", "חשב/ת") and the invite email "הזמין/ה".
  - **The same receiving step mixes forms:**
    - "בחר ספק" (`:9`) and "פתחו קבלה ותעדו" (`:12`);
    - "צלם את החשבונית" and "צלמו את החשבונית כתמונה" (`:41,56`).
  - **Emails are all singular:** "לחיצה אחת ואתה בפנים", "פתח את הקישור" (`templates.ts:177,184`).
  - Overlap: `auth-19`, `area-receiving` §copy, `command` (home) and `area-marketing` (H1) logged this locally. This finding is the product-wide rule and list.
- **Fix:**
  - Apply §2.1: noun-form buttons, plural body text, no slashes.
  - Fix list: §4.
  - Add the house-style test (copy-rtl-20). It rejects a `he.ts` leaf whose first word is in the masculine-imperative list, and any `/[א-ת]\/[א-ת]{1,2}\b/`.
- **Exemplar:** Wix and Monday.com Hebrew [K]; Gov.il plain-language guidance [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-09 · P1 · copy/flow · approvals, receiving inbox and wizard, invoice inbox, recovery, chain, inventory · all · both · [C12, E9, C10]

**Buttons describe the mechanism, not what happens to the money or the next state.**

- **Evidence:**
  - "אשר/דחה" (`approvals-01`).
  - Inbox "אישור ופענוח" / "אישור + הוספת השולח לרשימה" (`ingest/he.ts:19-20`): approving what?
  - Receiving:
    - "עבד את החשבונית" and "הכל תקין — אישור מהיר" (`receiving/he.ts:46,114`);
    - "סדר עוד {count} שורות" (`:142`);
    - the card offers two verbs, "פתח קבלה חדשה" and "קלוט סחורה".
  - Recovery "מחיקה" (write-off) and "סימון: מכתב נשלח".
  - Chain "כניסה" (reads as "log in", `chain-31`).
  - Inventory "כן, סיים" (`inventory/he.ts:62`).
  - Invoice "הרץ התאמה מחדש" as a primary (`invoices/he.ts:13`).
- **Fix:**
  - Apply the §2.2 verb grammar:

    | Today | Proposed |
    |---|---|
    | אשר / דחה | "דרישת ‎₪{x} מהספק" / "אישור לתשלום כפי שחויב" |
    | אישור ופענוח | "קריאת החשבונית" / "קריאה ואישור השולח" |
    | עבד את החשבונית | "קריאת החשבונית" |
    | הכל תקין — אישור מהיר | "הכול הגיע כמו בהזמנה" |
    | סדר עוד {count} שורות | "נשארו {count} שורות לספירה" |
    | מחיקה | "ויתור על ‎₪{x}" + confirm |
    | סימון: מכתב נשלח | "סימון שהמכתב נשלח" |
    | כניסה | "פתיחת הסניף" |
    | כן, סיים | "סגירת הספירה · ‎₪{value}" |
    | הרץ התאמה מחדש | "חישוב הפערים מחדש" (in an overflow menu) |

  - The en twins follow the same pattern ("Claim ₪104.80 back", "Pay as billed", "Read invoice", "Everything arrived as ordered").
- **Exemplar:** Intuit content design and Polaris "Buttons: verb + noun, say what happens" [K]; Ramp bill approval states the payment outcome on the button [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-10 · P1 · functional/copy · i18n runtime → home, monthly report, emails, every `{count}` · all · both · [E7, E8, F6]

**There is no plural support, so Hebrew prints "1 מוצרים" and "1 ימים".**

- **Evidence:**
  - `translate.ts` `interpolate()` does plain `{name}` replacement (`lib/i18n/translate.ts:79-84`).
  - [Census] 130 `{count}` placeholders, but only 4 hand-written singular keys (`discrepancyOne`, `toReviewOne`, `countOne`, `branchOne`) and 0 dual forms.
  - **[Probe] live:**
    - "**1 מוצרים** עלו במחיר מעל הסף שהגדרתם." on the owner home (`contracts/he.ts:235`);
    - "פריט בחשבונית ללא הזמנה **1 מקרים**" on `/dashboard/reports/monthly` (`recovery/he.ts:109`).
  - **[Code] the email** says "באיחור של **1 ימים**" (`templates.ts:274`), and "ההזמנה כוללת **1** פריטים".
  - Hebrew needs one / **two** / other: יום אחד / **יומיים** / 3 ימים; שבוע / **שבועיים**. Intl `PluralRules('he')` returns these categories (`rtl.md` §5.3).
- **Fix:**
  - Add ICU-lite plurals to `interpolate()`: `{count, plural, one {…} two {…} other {# …}}`, resolved with `new Intl.PluralRules(intlLocale)`. About 40 lines with no dependency. Alternatively adopt `intl-messageformat` (about 12 kB); either keeps `Shape<typeof he>` typing.
  - Convert the 130 `{count}` keys, starting with the visible ones:
    - `contracts.overview.body`;
    - `recovery.report.issueCount`;
    - `receiving.adjust.subtitle`;
    - `inbox.items`;
    - `vat.card.count` (deletes `countOne`);
    - `components.activity.*` (deletes `discrepancyOne` and `toReviewOne`);
    - `contracts.alerts.period.days/weeks` ("יומיים", "שבועיים");
    - the email templates.
  - Add a test that renders every `{count}` key at 1, 2 and 5 in `he`, and fails on /\b1 [א-ת]+ים\b/ and on "2 ימים/שבועות/חודשים/שעות".
- **Exemplar:** Mozilla Fluent and ICU MessageFormat plural categories; Shopify Polaris i18n uses ICU plurals in every locale [K].
- **Effort:** M. **humanPR:** no.

---

### copy-rtl-11 · P1 · rtl · home recipes card, contracts, leaks, chain, Ask answers · owner · both · [E4, E5]

**Signs, arrows and "3%+" are typed by hand, so they land on the wrong side.**

- **Evidence [Probe]:**
  - The owner home recipes card renders "+ 3.41₪" and "+ 1.61₪" (logical `+‏3.41 ‏₪` in `bdi[dir=ltr]`), with the LTR "29.3% → 31.4%" and "(‎₪139.00 → ‎₪149.00)" [Shot crop `home_recipes_zoom.png`].
  - `/dashboard/contracts` and `/leaks` render "+·100.00₪".
  - `/dashboard/chain` renders the trend "+7%" as **"7%+"**, while other pages render "+7.2%" correctly.
  - The heat-map legend "3%+" (`chain/he.ts:71`) renders **"+3%"**, which reads as "plus three percent" instead of "3% and above".
  - **[Code]** Ask builds "(+{amount})" (`ask/he.ts:53-54`). [Lab E] shows it renders `)₪·1,234+(`, with the sign glued to the far side.
  - Contracts use "{from} ← {to}" (`contracts/he.ts:173`), recipes use "{before} ← {now}" (`recipes/he.ts:116`), and the home card uses "→". Same fact, opposite orders (R-4, `rtl.md` F3).
  - The design-system lens owns the `bdi dir="ltr"` money wrapper; this finding covers the strings and the percent path.
- **Fix:**
  - Delete "+" from `ask/he.ts:53-54`. The caller passes a signed value from `formatIls(v,{signDisplay:'exceptZero'})`, an additive option on the immutable util (human PR, `money-format-marshal`).
  - Until that lands, use words: "גדל ב-{amount}".
  - Give `formatPercent` a `signDisplay` option (`lib/i18n/format.ts:38`, agent-safe), and use it in `chain/page.tsx` trends.
  - Change the legend to "3% ומעלה" / "3% and above".
  - Render every price move with one `<PriceMove from to>` (Hebrew "old ← new").
  - Rule: no "+", "−", "→", "₪" or "%" literal next to a placeholder in `he.ts` (copy-rtl-20 gate).
- **Exemplar:** Intuit (the minus sits before the currency symbol); ICU he-IL `signDisplay` output (`rtl.md` §5.3); Unicode MF2 number formatting [K].
- **Effort:** S (strings, percent) + S (human PR for `formatIls`).
- **humanPR:** yes, for the `formatIls` `signDisplay` option only.

---

### copy-rtl-12 · P1 · functional/rtl · activity feed (owner home), emails, supplier WhatsApp text, role names · owner, all · both · [A9, E4, J3]

**Server-written Hebrew bypasses i18n and `formatIls`, so Hebrew users see a different product voice and a different ₪ format.**

- **Evidence:**
  - **Activity feed:**
    - `localizeActivity()` returns the raw server text whenever `locale === 'he'` (`lib/components/activityText.ts:34`). The structured `fromMetadata` path and the Hebrew keys in `components.activity.*` are therefore **only used in English**.
    - The server writes `הפסד פוטנציאלי ₪${Math.round(leakIls).toLocaleString('he-IL')}` (`packages/api/src/match/persist.ts:280`).
    - [Probe] the home shows "‏₪701 כולל מע״מ" and "הפסד פוטנציאלי ₪105", with no NBSP and the retired term, two cards below the hero's "₪ 760" [Shot crop `activity_zoom.png`].
  - **Emails:**
    - `packages/api/src/notifications/templates.ts` is hard-coded Hebrew;
    - masculine singular ("ביקשת", "ואתה בפנים", "פתח");
    - "1 ימים";
    - emoji subjects (⏰ 📋 🎉);
    - "מוקד הבקרה של הכסף" (a fifth home name);
    - "פתיחת הדשבורד";
    - "₪X נחסכו".
    - The `emails` namespace is empty (`messages/emails/he.ts`).
  - **Supplier WhatsApp templates** (`lib/messageTemplates.ts`):
    - Hebrew outside i18n, with ASCII quotes around supplier names and raw `₪${price}` numbers ("‎₪14.9").
    - 4 of the 5 builders are unused; only `agentVerification` is called (`Reconciliation.tsx:181`).
  - **Role labels** live in `lib/roles.ts` ("מנהל/ת", "חשב/ת") instead of i18n.
- **Fix:**
  1. **Activity:** always use the metadata path in both locales. `persist.ts` and the seed write only `metadata` (and a neutral `title` for audit); `activityText.ts` drops the Hebrew regex reverse-parser (lines 40–83).
  2. **Emails:** move every subject, preview and body string into `messages/emails/{he,en}.ts` with the plural runtime. `templates.ts` is not on the immutability list (only `outbox.ts` is).
  3. **WhatsApp:** move `agentVerification` into a `supplierMessages` namespace, delete the four dead builders, and isolate values (copy-rtl-13).
  4. **Roles:** move them to `messages/team` (G45).
- **Exemplar:** Stripe and Linear emit typed events and render copy client-side per locale [K]; Fluent "the source is a message id + args, never prose".
- **Effort:** M. **humanPR:** no. Delivery and scheduling in `outbox.ts` and `cron.ts` stay untouched; only template text moves.

---

### copy-rtl-13 · P2 · rtl · every interpolated sentence, plain-text exports (dock slip WhatsApp, VAT request, supplier link text, CSV) · all · both · [E3]

**Interpolated values are not isolated, and plain text has no `<bdi>` to fall back on.**

- **Evidence:**
  - `interpolate()` splices raw strings. HTML callers must remember `<WithOriginal>` / `originalProps`, and plain text has no equivalent.
  - [Lab I] "בהזמנה מ"Coca-Cola Ltd." הפריט…" renders `".Coca-Cola Ltd"מ`: the period and the quote jump. This is the exact ASCII-quote pattern in `receiving/he.ts:42` ("מהספק \"{supplier}\"") and `:148`, `catalog/he.ts:53`, `suppliers/he.ts:45-47` and 40 other ASCII-quoted spans [Census].
  - The dock slip's WhatsApp text joins `${t('dockSlip.title')} — ${supplier}` and the receiver name in plain text (`dock-slip.tsx:119-121`). The counter-party reads it.
  - `[Lab J]` "צפויים 2 POs" renders `POs·2·םייופצ`.
- **Fix:**
  - `interpolate(template, vars, { isolate = true })` wraps each value in **U+2068 FSI … U+2069 PDI**. This is Mozilla Fluent's `useIsolating: true` default and the Unicode MessageFormat 2 default bidi strategy.
  - Turn it off only for file names and CSV keys (`payRun.csv.file`, `suppliers.ledger.csvFile`). Add a `stripIsolates()` test helper.
  - Remove every quote mark around placeholders in `he.ts` (§2.4, rule 1).
- **Exemplar:** Mozilla Fluent (`useIsolating`), Unicode MessageFormat 2.0 bidi isolation, W3C "Inline markup and bidirectional text".
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-14 · P1 · copy/trust · `/leaks/claims` letter, consolidated letter, dock slip · owner → supplier · desktop + mobile · [H1, E9, C10]

**The claim letter tells the supplier the amount but not the evidence.**

- **Evidence:**
  - Each line is "חשבונית · פריט · מהות ההפרש: מחיר גבוה מהמצופה · ‎₪104.80 · לפני מע״מ" (`leaks/he.ts:74-83`) [Shot `dashboard_leaks_claims__owner__desktop-he__t0.png`]. There is no ordered vs charged price, no quantity, no PO or delivery-note reference and no date.
  - "מהמצופה" ("than hoped") invites "according to whom?".
  - The subject "בקשת זיכוי בגין חריגות" pairs a soft verb with an accusatory noun.
  - The consolidated letter already does this well: "{name} · {qty} {unit} · חויב {billed} במקום {po} = {delta}" (`consolidated/he.ts:31`). The main letter should match it.
- **Fix:**
  - **Line template:**
    - "{פריט} · {כמות} {יח׳} · חויב ‎₪{billed} ליח׳ במקום ‎₪{agreed} שסוכם (הזמנה {po}, ת״מ {dn}, {date}) = ‎₪{delta}";
    - for shortages: "הוזמן {x}, התקבל {y} (ת״מ {dn} חתומה)".
  - **Subject:** "הנדון: דרישה לזיכוי — פערים בחשבוניות {month}" (D-3 may soften it to "בקשה").
  - **Closing:** "נבקש חשבונית זיכוי בסך ‎₪{total} לפני מע״מ, או חשבונית מתוקנת, עד {date}."
  - **Send:** preview, then deferred send with "ביטול שליחה" (R-8).
- **Exemplar:** Ottimate / Plate IQ credit requests and BILL vendor disputes attach line-level expected vs billed values [K]; a good accounts-payable clerk writes exactly this.
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-15 · P2 · copy · receiving, invoices, settings, ingest, admin, auth, recovery, catalog, products · receiver, owner · both · [E9, G1]

**Developer jargon and English tokens leak into Hebrew UI.**

- **Evidence [Census]: 18 English tokens.**
  - "PO", "POs" (`receiving/he.ts:35-36`).
  - "OCR" ×7, including "פתח חשבונית / תקן OCR" on every approval card and "ביטחון OCR {confidence}" on the dock (`approvals/he.ts:24`, `receiving/he.ts:85`).
  - "(stub)" (`recovery/he.ts:113`).
  - "השוואות (match runs)" (`suppliers/he.ts:16`).
  - "Webhook", "Phone number ID" (`ingest/he.ts:60,73`).
  - "ב-development — חפשו בשורות ה-log" (`auth/he.ts:34`, dev-only; keep it out of `he.ts`).
  - "override", "ADMIN" (admin).
  - Hebrew jargon:
    - "לקבע / החיסכון המוקפא" (`receiving/he.ts:8,92`);
    - "קנוני" (`products/he.ts:37`);
    - "פיצ׳ר" ×5;
    - "פוד קוסט";
    - "דאשבורד" / "דשבורד";
    - "חשבונית-דמה" on a live delivery (`RCV-16`).
- **Fix:**
  - Rewrite per G1, G41–G44 and §4.
  - OCR confidence shows only per low line as "קריאה לא ודאית — בדקו מול הנייר" (R-11).
  - Admin English stays for platform staff only; dev hints move out of i18n into a `process.env.NODE_ENV` branch.
- **Exemplar:** Toast and Square receiving screens say "Invoice", "Order" and "Count", never PO or OCR [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-16 · P2 · copy · all namespaces · all · both · [E7, J4]

**Orthography and punctuation drift.**

- **Evidence [Census]:**
  - Quote styles: 46 ASCII "…", 3 „…” (`leaks/he.ts:85,87`), 1 ״…״ (`leakProof/he.ts:35`), plus 'דוא"ל' (`marketing/he.ts:42`).
  - "..." ×2 (`receiving/he.ts:45,52`).
  - Emoji ×10 (🎉 `recipes:119`, `products:29`; 👏 `chain:47`; ⚠️ `receiving:93`; ✓ `vat:15,29`, `admin:62,71`).
  - Prefix `ב-` ×94 vs `ב־` ×14.
  - הכל/הכול 16/6.
  - ייבוא/יבוא and ייצוא/יצוא (`integrations:15`, `views:81`).
  - תיאורטי/תאורטי.
  - "וודא" (`receiving:42`).
  - "מדרדר" (`suppliers:21`; correct: "מידרדר", better "מחמיר").
  - ח.פ. / ח.פ / ח״פ.
  - "ת.מ.".
  - "בש״ח" / "₪" in sentences (`inventory:4`, `receiving:181`, `chain:64`).
  - סבילות/סבולת.
  - "Zestt PDF" (`orders/he.ts:48`, en `:47`) vs "Zester" in integrations and landing (brand typo).
- **Fix:** apply G34, G35, G46–G48 and §1.4/§2.3 in one mechanical PR, with the gate (copy-rtl-20) holding the line.
- **Exemplar:** Academy of the Hebrew Language spelling rules (כתיב מלא); ICU he-IL emits ״ and ׳ natively (`rtl.md` §5.3).
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-17 · P2 · rtl/copy · chain alerts, contracts validity, views range, supplier leak card window, POS import, receiving processing · all · both · [E8, E5]

**Ranges use dashes instead of words.**

- **Evidence:**
  - `'{from} – {to}'` in `views/he.ts:119`, `contracts/he.ts:28,179`, `suppliers/he.ts:138`, `integrations/he.ts:50`.
  - `'7 הימים האחרונים · {from}–{to}'` (`chain/he.ts:35`).
  - "זה לוקח 5-15 שניות" (`receiving/he.ts:65`).
  - "0–30 יום" (ageing, which is acceptable as a column).
  - `inventory/he.ts:86` already does it right ("{from} עד {to}").
- **Fix:**
  - "מ-{from} עד {to}" for dates.
  - "בין 5 ל-15 שניות".
  - Money ranges "בין ‎₪{a} ל-‎₪{b}" (lab #6 in `rtl.md` shows "10–12 ₪" reversing).
- **Exemplar:** rubric E8; Israeli bank statements use "מ-01.10 עד 31.10" [K].
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-18 · P2 · copy/states · all error toasts and empty states · all · both · [C8, C9]

**Error and empty copy is generic, and two error strings print raw server messages.**

- **Evidence:**
  - "משהו השתבש" ×9 and "הפעולה נכשלה" ×9 with no cause or next step (e.g. `invoices/he.ts:35`, `recovery/he.ts:69`).
  - `'הפעולה נכשלה: {message}'` and `'העלאת הסריקה נכשלה: {message}'` interpolate raw (often English) server text (`ingest/he.ts:24,133`, `receiving/he.ts:55,206`).
  - `common.states.empty` "אין נתונים להצגה" (used as a fallback).
  - Empty states without an action:
    - "אין משלוחים שמתוכננים להיום";
    - "עוד לא שאלתם";
    - recovery "אין עדיין דרישות זיכוי".
  - The worker banner tells the owner that "הבעלים קיבל התראה" (`nav/he.ts:62`).
  - The receiving empty description promises "לקבע את החיסכון" (`receiving/he.ts:12`).
- **Fix:**
  - Apply the §2.5 templates and map server error codes to i18n keys (`lib/serverErrors.ts` already exists; extend it).
  - Empty states get the action and the next real event, for example "אין משלוחים צפויים היום · המשלוח הבא: יום ב׳ 07:30 · ירקות השרון".
  - The banner is role-aware: the owner sees "שלחנו לכם התראה במייל"; other roles see "הבעלים קיבלו התראה".
- **Exemplar:** Polaris error messages (what happened + how to fix); GitHub Primer blankslate (one action) [K].
- **Effort:** S–M. **humanPR:** no.

---

### copy-rtl-19 · P2 · copy/parity · en screens (owner home, leaks filters, chain disparity, nav) · owner, bookkeeper using English · desktop · [J3, E10]

**English parity gaps.**

- **Evidence:**
  - [en-sweep Probe] Hebrew category names in English filters on `/dashboard` and `/dashboard/leaks` ("בשר, דגים, חד״פ, יבשים…").
  - "₪89.00 per ק״ג" on `/dashboard/chain`.
  - The hero base: en "of food spend" vs he "על סחורה".
  - The method: en "Warning- and blocker-level" vs he "חומרה בינונית".
  - Home names: "Control room" on the page vs "Command center for your money" in emails.
  - Symbol-led labels "₪ back" and "₪-back tracker".
  - The en vocabulary drifts too ("discrepancy" 57, "gap" 17, "difference" 19, "finding" 11).
  - The English approvals verbs inherit the he inversion.
- **Fix:**
  - The en column of §1 becomes `glossary.ts` `en`, with the same gate.
  - Translate category labels via the existing translation glossary (`packages/translate`) or a category key map; render units via `UnitText` in `en`.
- **Effort:** S. **humanPR:** no.

---

### copy-rtl-20 · P2 · functional · i18n tooling · — · — · [E9, A9]

**Nothing enforces the glossary or house style, so drift will return.**

- **Evidence:**
  - `i18n.test.ts` checks key parity only. 41 namespaces are owned by 15+ sessions (S2–S17 headers in each `he.ts`).
  - Every drift in this review arose between namespaces, never inside one.
- **Fix:** `lib/i18n/glossary.ts` exports `{ concept, he, en, define, retireHe: RegExp[], retireEn: RegExp[], allow?: string[] }`. A vitest (owner: `test-sentinel`) walks `ALL_NAMESPACES` and fails on:
  1. any `retireHe` / `retireEn` match outside `allow`;
  2. a masculine-imperative first word;
  3. a slash form;
  4. `{count}` without a `plural` block;
  5. a quote mark adjacent to `{…}`;
  6. "+", "−", "→", "₪" or "%" adjacent to `{…}`;
  7. "..." or an emoji;
  8. ASCII `"` between Hebrew letters (the rubric E7 grep);
  9. an English token list (PO, OCR, stub, Webhook) in `he` outside admin.

  `glossary.ts` also feeds a "מילון מונחים" popover (the "מה זה?" links) and the command-palette aliases (`lens-ia-nav` D4).
- **Exemplar:** Shopify Polaris content linting; Atlassian's design-system "word list" [K].
- **Effort:** M.
- **humanPR:** no. Adding the step to CI is human (`.github/workflows` is immutable); the test runs in the existing `turbo test` job.

---

### copy-rtl-21 · P3 · copy · nav, page titles · all · both · [D5]

**Symbol-led and feature-name labels.**

- **Evidence:**
  - "₪ חוזר" (screen reader: "שקל חדש חוזר").
  - "חיפוש מאוחד בקטלוג" (feature name as h1, `catalog-32`).
  - "שאלו את RestoMatch" (fine).
  - "בלש הדליפות" (playful, but it hides the job).
  - All dashboard `<title>` values are "RestoMatch" [crawl].
- **Fix:** labels name the place (G36–G41). Titles: see `lens-ia-nav` §9.3.
- **Effort:** S. **humanPR:** no.

---

## 4. Rewrite list (he source of truth; en where the meaning changes)

Notation: `namespace › key`. "→ plural" means the ICU form from copy-rtl-10. Rows marked † are already proposed by an area review and are repeated here so the list is complete.

### 4.1 Field flows first (receiver, chef and floor manager on the phone)

| # | Key | Today | Proposed he | en (if changed) | Why |
|---|---|---|---|---|---|
| 1 | receiving › inbox.title | קליטת סחורה | קבלת סחורה (receiver h1: "היום · {count} משלוחים") | Receiving | G3 |
| 2 | receiving › inbox.subtitle | הזמנות שצפויות להגיע היום. בחר ספק כדי לצלם את החשבונית, להצליב מול ההזמנה ולקבע מה באמת הגיע. | המשלוחים של היום. בחרו ספק כדי לספור מה הגיע מול ההזמנה. | Today's deliveries. Pick a supplier to count what arrived against the order. | person, jargon, G42 |
| 3 | receiving › inbox.emptyDescription | …פתחו קבלה ותעדו את החריגות כדי לקבע את החיסכון. | כשספק מגיע, פתחו את ההזמנה שלו וספרו מה הגיע. | | jargon, G16 |
| 4 | receiving › inbox.openReceipt / receiveGoods | פתח קבלה חדשה + קלוט סחורה | one CTA: התחלת קבלת סחורה | Start receiving | copy-rtl-09 |
| 5 | receiving › inbox.continueReceipt | המשך קבלה קיימת | המשך קבלת הסחורה · {done}/{total} | Continue · 3/12 | next state |
| 6 | receiving › inbox.badge.pending | קבלה בתהליך | בספירה | Counting | G3 |
| 7 | receiving › steps.supplier.subtitle | בחר את הספק שעומד בדלת. נטען את ההזמנה המתאימה ונשווה אליה את החשבונית. | בחרו את הספק שבדלת. נטען את ההזמנה שלו. | | person |
| 8 | receiving › steps.supplier.expectedOnePo / expectedPos | צפוי PO אחד / צפויים {count} POs | → plural: הזמנה אחת צפויה / שתי הזמנות צפויות / # הזמנות צפויות | → plural | G1 |
| 9 | receiving › steps.supplier.continue | המשך לסריקה | המשך לצילום החשבונית | | |
| 10 | receiving › steps.scan.title | צלם את החשבונית | צילום החשבונית | Photograph the invoice | person |
| 11 | receiving › steps.scan.subtitle | מהספק "{supplier}". וודא שכל פריטי השורה נראים בבירור. | {supplier} · ודאו שכל השורות נראות בבירור. | | quotes, spelling |
| 12 | receiving › steps.scan.capture | צלם / העלה קובץ | צילום החשבונית (secondary: העלאת קובץ) | Take photo / Upload file | one verb per button |
| 13 | receiving › steps.scan.useDemo | השתמש בחשבונית-דמה (ללא העלאה) | remove from the live wizard (showcase only) | | `RCV-16` † |
| 14 | receiving › steps.scan.process | עבד את החשבונית | קריאת החשבונית | Read invoice | G44 |
| 15 | receiving › steps.scan.retake / recon.retake | צלם מחדש / צלם חשבונית מחדש | צילום מחדש | Retake | |
| 16 | receiving › steps.scan.uploading / bannerUploading | מעלה לשרת... / מעלה את הסריקה... | מעלה… / מעלה את הצילום… | | ellipsis |
| 17 | receiving › steps.scan.backToSupplier | חזור לבחירת ספק | חזרה לבחירת ספק | | person |
| 18 | receiving › processing.subtitle | זה לוקח 5-15 שניות. אנחנו מזהים פריטי-שורה ומשווים אותם להזמנה. | בדרך כלל בין 5 ל-15 שניות. אנחנו קוראים את השורות ומשווים להזמנה. | | range |
| 19 | receiving › processing.showResults / refresh | הצג תוצאות / רענן | הצגת התוצאות / רענון | | person |
| 20 | receiving › recon.subtitle | חשבונית {number} · ביטחון OCR {confidence} | חשבונית {number} (confidence only on low lines: "קריאה לא ודאית — בדקו מול הנייר") | | R-11, G44 |
| 21 | receiving › recon.potentialLoss | הפסד פוטנציאלי מההפרשים: | פערים מול ההזמנה: | Discrepancies vs the order: | copy-rtl-03 |
| 22 | receiving › recon.potentialLossHint | עבור להתאמת כמויות כדי לקבע מה באמת הגיע ולהגדיל את החיסכון המוקפא. | ספרו מה הגיע בפועל — כך הסכום ייכנס לדרישת הזיכוי. | Count what actually arrived so the amount goes into the credit claim. | jargon, G30 |
| 23 | receiving › recon.agentChanged | ⚠️ פרטי הסוכן השתנו | פרטי הסוכן השתנו (icon in the component) | | emoji |
| 24 | receiving › recon.verifyWhatsapp / call | אמת בוואטסאפ מול: / התקשר | אימות בוואטסאפ מול: / התקשרות | | person |
| 25 | receiving › recon.quickConfirm | הכל תקין — אישור מהיר | הכול הגיע כמו בהזמנה | Everything arrived as ordered | verb names the fact |
| 26 | receiving › recon.continueAdjust | המשך להתאמת כמויות | המשך לספירת כמויות | Continue to count | G43 |
| 27 | receiving › recon.pendingBanner | …זו לא חריגה, רק בדיקה. | …זה לא פער, רק בדיקה. | | G20 |
| 28 | receiving › adjust.subtitle | {pending} שורות עוד מחכות להתאמה · {done} כבר עודכנו · {matched} תואמות אוטומטית | → plural: נשארו # שורות לספירה · # נספרו · # תואמות להזמנה | | plural, G43 |
| 29 | receiving › adjust.tapToExpand | לחץ להרחבה | (remove; the row is the target) or הקשה להרחבה | | person |
| 30 | receiving › adjust.decrease / increase | הפחת כמות / הגדל כמות | הפחתת כמות / הגדלת כמות (aria-label) | | person |
| 31 | receiving › adjust.settled | סודר | טופל | | |
| 32 | receiving › adjust.fixRemaining | סדר עוד {count} שורות | → plural: נשארה שורה אחת לספירה / נשארו # שורות לספירה | | copy-rtl-09 |
| 33 | receiving › adjust.closeAndSave | סגור קבלה ושמור | סיום קבלת הסחורה | Finish receiving | person, G3 |
| 34 | receiving › adjust.backToResults | חזור לתוצאות | חזרה לתוצאות | | |
| 35 | receiving › confirmed.title | הקבלה נסגרה | קבלת הסחורה נסגרה | Receiving closed | G3 |
| 36 | receiving › confirmed.subtitle | תועדה ב-{time} מהספק "{supplier}". מנוע ההתאמה מריץ עכשיו את ההצלבה הסופית. | נשמרה ב-{time} · {supplier}. אנחנו מחשבים עכשיו את הפערים מול החשבונית. | | quotes, jargon |
| 37 | receiving › confirmed.savings | חיסכון פוטנציאלי שתועד | פערים שנרשמו בקבלה | Discrepancies recorded | copy-rtl-03 |
| 38 | receiving › confirmed.another | קבלה נוספת | קבלת סחורה נוספת | | G3 |
| 39 | receiving › dockSlip.title / open | תעודת חריגה | דוח פערים לנהג | Dock discrepancy slip | G15 |
| 40 | receiving › dockSlip.afterClose | סכום החריגה בש״ח ייקבע… | הסכום ב-₪ ייקבע אחרי סגירת קבלת הסחורה… | | G20, §1.4 |
| 41 | receiving › dockSlip.copy / whatsapp / share | העתק טקסט / שלח לספק בוואטסאפ / שתף בוואטסאפ | העתקת הטקסט / שליחה לספק בוואטסאפ / שיתוף בוואטסאפ | | person |
| 42 | receiving › dockSlip.total | סה״כ לדרישת זיכוי | סה״כ לדרישת זיכוי ✓ (keep) | | |
| 43 | receiving › errors.upload / steps.scan.uploadFailed | העלאת הסריקה נכשלה: {message} | העלאת הצילום לא הצליחה. התמונה שמורה בטלפון — ננסה שוב כשיהיה חיבור. | | no raw message |
| 44 | receiving › errors.forbidden | אין לך הרשאה לפעולה הזו. | אין לכם הרשאה לפעולה הזו. | | person |
| 45 | receiving › english.showHebrew / invoices › correction.showHebrew | הצג מקור בעברית | הצגת המקור בעברית | | person |
| 46 | inventory › count.check / checkHint | בדוק | כדאי לבדוק | Worth checking | person |
| 47 | inventory › count.finish / finishConfirm | סיים ספירה / כן, סיים | סגירת הספירה / סגירת הספירה · {value} | Close count · ₪13,474 | copy-rtl-09 |
| 48 | inventory › subtitle | …שווי המלאי בש״ח… | …שווי המלאי ב-₪… | | §1.4 |
| 49 | inventory › count.closersOnly | מנהל או בעלים סוגרים את הספירה. הכמויות שלך נשמרו. | רק בעלים ומנהלים סוגרים ספירה. הכמויות שלכם נשמרו. | | person |
| 50 | inventory › period.purchaseFoodCost | פוד קוסט רכש | עלות מזון לפי רכש | Purchase-based food cost | G33 |
| 51 | inventory › period.theoretical / theoryPartial | עלות תאורטית ✓ | keep; align recipes "תיאורטי" → "תאורטי" | | G34 |
| 52 | inventory › detail.csv | הורדת CSV לרואה החשבון | הורדת CSV להנהלת החשבונות | | G45 |
| 53 | ingest › orderCapture.subtitle | …נהפוך אותה להזמנת רכש… | …נהפוך אותה להזמנה… | | G1 |

### 4.2 Owner and boss surfaces (desktop)

| # | Key | Today | Proposed he | en (if changed) | Why |
|---|---|---|---|---|---|
| 54 | nav › links.overview | סקירה | בית | Home | G36 † ia-nav |
| 55 | nav › links.receiving | קליטת סחורה | קבלת סחורה | Receiving | G3 † |
| 56 | nav › links.approvals | תור אישורים | אישורים | | G40 † |
| 57 | nav › links.leaks | בלש דליפות | דליפה | Leak | G37 † |
| 58 | nav › links.recovery | ₪ חוזר | זיכויים | Credits | G38 † |
| 59 | nav › links.chain | רשת | סקירת רשת | Chain overview | G39 † |
| 60 | nav › worker.ownerNotified | הבעלים קיבל התראה. | owner: שלחנו לכם התראה במייל. · others: הבעלים קיבלו התראה. | | role-aware |
| 61 | nav › worker.body | …ויעברו OCR והתאמה ברגע שהוא יחזור. | …ייקראו ויותאמו כשהמנוע יחזור. | | G44 |
| 62 | overview › subtitle | תמונת מצב — איפה כסף בורח, ומה דורש את ההחלטה שלך עכשיו. | איפה כסף דולף, ומה מחכה להחלטה שלכם היום. | Where money leaks, and what needs your decision today. | person |
| 63 | overview › hero.eyebrow + hero.leakedLabel | דליפה שזוהתה · {month} + דלף החודש | one label: דליפה · {period} | Leak · {period} | copy-rtl-02 |
| 64 | overview › hero.pctOfSpend / spendBase | {pct} מההוצאה על סחורה / מתוך {spend} לפני מע״מ | {pct} מהרכש שנבדק · {spend} לפני מע״מ | {pct} of checked spend · {spend} before VAT | G17 |
| 65 | overview › hero.recoveredHint | חריגות שאישרת לדרישה מהספק | פערים שאישרתם לדרוש מהספקים | | person, G20 |
| 66 | overview › hero.invoices | חשבוניות עם חריגה | חשבוניות עם פער | | G20 |
| 67 | overview › hero.awaitingCount | …ממתינות לספירת קבלת הסחורה — הן ייבדקו כשהקבלה תיסגר. | …מחכות לסיום קבלת הסחורה. נבדוק אותן כשקבלת הסחורה תיסגר. | | G3 |
| 68 | overview › hero.clean | …תואמות להזמנות ולקבלות. | …תואמות להזמנות ולקבלות הסחורה. | | G3 |
| 69 | overview › hero.calc | חריגות בחומרה בינונית ומעלה, מוגבל לסכום כל חשבונית. לא כולל מחיר נמוך מהמצופה וחשבוניות ללא הזמנה. | נספרים פערים ברמת אזהרה וחוסם, עד סכום כל חשבונית. לא נספרים: מחיר נמוך מהמוסכם, וחשבוניות שעוד לא שויכו להזמנה. | Counts warning and blocking discrepancies, capped at each invoice. Excludes lower-than-agreed prices and invoices not yet linked to an order. | G21, parity |
| 70 | overview › hero.target | יעד: 1.5% מההוצאה | hidden by default (R-14). If the owner wants it: "רף ענפי: 1.5% מהרכש שנבדק" | | R-14, G17 |
| 71 | overview › kpis.pending / pendingHint | ממתינות לאישור / חריגות בתור — בעלים, מנהל, הנהלת חשבונות | פערים להחלטה / פערים שמחכים להחלטה שלכם | | G20 |
| 72 | overview › leaks.title | זחילת מחירים · 30 יום אחרונים | מחירים שעלו · 30 הימים האחרונים | Prices that rose · last 30 days | copy-rtl-01 |
| 73 | overview › leaks.subtitle | מוצרים ששילמתם עליהם מעל המחיר הרגיל. מדד מתגלגל ונפרד — לא נכלל בדליפת החודש שלמעלה. | מוצרים ששילמתם עליהם יותר מהמחיר הרגיל. מדד נפרד — לא נכלל בדליפה. | | 01 |
| 74 | overview › leaks.all / upsell | לכל הדליפות / שדרגו כדי לפתוח את בלש הדליפות | למגמת המחירים / מגמת המחירים זמינה במסלול מקצועי | | 01, G41 |
| 75 | overview › activity.emptyDescription | ברגע שתקלוט חשבוניות ותטפל בחריגות, היומן יתחיל להתמלא כאן. | כשתקבלו סחורה ותטפלו בפערים, הפעילות תופיע כאן. | | person |
| 76 | components › activity.potentialLoss / savings | הפסד פוטנציאלי {amount} / חיסכון {amount} | פער של {amount} / נדרש {amount} | Discrepancy {amount} / Claimed {amount} | copy-rtl-03, 12 |
| 77 | components › activity.matchesOrder(AndReceipt) | תואמת להזמנה ולקבלה | תואמת להזמנה ולקבלת הסחורה | | G3 |
| 78 | components › activity.types.discrepancy_approved / _rejected | חריגה אושרה / חריגה נדחתה | פער נדרש מהספק / פער שולם כפי שחויב | | G29 |
| 79 | components › activity.discrepancies / toReview (+One keys) | {count} חריגות / חריגה אחת | → plural: פער אחד / שני פערים / # פערים | | 10, G20 |
| 80 | components › loadMore.label · approvals › card.loadMore | טען עוד | טעינת עוד | | person |
| 81 | components › entitlement.compactBody / body | …במסלולים בתשלום. | ✓ (keep "מסלול"); auth › serverErrors.entitlementRequired "הפיצ׳ר הזה אינו כלול בתוכנית שלכם" → "היכולת הזו לא כלולה במסלול שלכם" | | G41 |
| 82 | approvals › subtitle | חריגות שמחכות להחלטה שלך. אישור = נדרוש את הכסף מהספק (נספר כחיסכון). דחייה = מוותרים, ההחלטה מתועדת. | פערים שמחכים להחלטה שלכם. כל כפתור אומר מה יקרה לכסף. | | `approvals-01` †, 03 |
| 83 | approvals › card.approve / reject | אשר / דחה | דרישת {amount} מהספק / אישור לתשלום כפי שחויב | Claim {amount} back / Pay as billed | `approvals-01` † |
| 84 | approvals › card.escalate / confirmReject / rejectReason | העבר לבעלים / אשר דחייה / סיבת דחייה (חובה) | העברה לבעלים / אישור — לא נדרוש / למה לא לדרוש? (חובה) | | person, 09 |
| 85 | approvals › card.estimatedLoss | ההפסד המוערך | הפער | Discrepancy | `approvals-17` †, 03 |
| 86 | approvals › card.fixInvoice | פתח חשבונית / תקן OCR | פתיחת החשבונית ותיקון | Open and correct invoice | G44 |
| 87 | approvals › card.forbidden | אין לך הרשאה להחליט על חריגה זו. | אין לכם הרשאה להחליט על הפער הזה. | | person |
| 88 | approvals › empty.title / description | אין חריגות בתור כרגע / כל ההפרשים טופלו… | אין פערים שמחכים להחלטה / פערים חדשים יופיעו כאן כשנמצא אותם בקבלות הסחורה ובחשבוניות. | | G20, G3 |
| 89 | approvals › severity.info | מידע | לידיעה | FYI | G21 |
| 90 | approvals › resolution.rejected | ויתור | שולם כפי שחויב | Paid as billed | G29 |
| 91 | approvals › types.QTY_SHORT / UNIT / VAT / TOTAL / UNORDERED_ITEM labels | חסר בכמות שהתקבלה / אי-התאמת יחידות / אי-התאמת מע״מ / סה״כ לא תואם לשורות / פריט בחשבונית ללא הזמנה | התקבל פחות מההזמנה / יחידת מידה שונה / מע״מ לא תואם / הסה״כ לא תואם לשורות / חויב פריט שלא הוזמן | | 07 |
| 92 | approvals › types.PRICE_HIGHER.label | מחיר גבוה מהמצופה | מחיר גבוה מהמוסכם (the explain names the source and both prices) | Price above agreed | 07, H1 |
| 93 | approvals › rules.* | חומרה גבוהה — אישור בעלים · הפרש מצטבר גבוה בחשבונית — בעלים · …בינוני… — מנהל · הפרש זניח — אושר אוטומטית · ברירת מחדל — מנהל | חוסם — החלטת בעלים · פערים מצטברים גבוהים בחשבונית — החלטת בעלים · פערים מצטברים בחשבונית — החלטת מנהלים · פער זניח — סומן אוטומטית כתקין · ברירת מחדל — החלטת מנהלים | | G21 |
| 94 | ask › types.* | (own map, differs from approvals) | delete; import `approvals.types.*.label` | | 07 |
| 95 | ask › suggestions.claimWeek / answers.claimNone / claimIntro | מה כדאי לתבוע השבוע? / …לתביעה. מצוין. / אפשר לתבוע {total}… | על מה כדאי לדרוש זיכוי השבוע? / אין כרגע פערים פתוחים לדרישה. / אפשר לדרוש זיכוי של {total} ב-{count} פערים פתוחים. הגדולים: | | G30 |
| 96 | ask › answers.leakDriverSupplier / leakDriverType | …אצל {supplier} (+{amount}). / …{type} (+{amount}). | …אצל {supplier}: גדל ב-{amount}. / סוג הפער שגדל הכי הרבה: {type} — גדל ב-{amount}. | | 11 |
| 97 | ask › answers.leakTotal | …{pct} מההוצאה שנבדקה… | …{pct} מהרכש שנבדק… | | G17 |
| 98 | ask › screens.overview / leaks / claims / supplier | סקירה / בלש דליפות / מכתבי תביעה / כרטיס ספק | בית / דליפה / מכתבי דרישת זיכוי / דף הספק | | G36–G38, G12 |
| 99 | ask › thinking | בודק בנתונים… | בודקים בנתונים… | | person |
| 100 | leaks › detective.title / subtitle | בלש הדליפות / מוצרים שבהם המחיר האחרון חורג מהאחוזון ה-90 ההיסטורי… | מגמת מחירים / מוצרים שהמחיר האחרון שלהם גבוה מהרגיל אצל אותו ספק. | Price trends | 01 |
| 101 | leaks › detective.emptyTitle / emptyDescription | לא נמצאו דליפות מחיר פעילות / …והדליפות יתחילו לצוף. | אין כרגע מחירים מעל הרגיל / צריך לפחות 3 חשבוניות לכל מוצר וספק כדי לדעת מה המחיר הרגיל. | | 01 |
| 102 | leaks › detective.totalLabel / hotspots / caption | זחילת מחירים: שולם מעל המחיר הרגיל (30 יום) / מוקדי זחילת מחירים / דליפות מחיר לפי מוצר וספק | שולם מעל המחיר הרגיל · 30 הימים האחרונים / איפה המחירים עלו / מחירים מעל הרגיל, לפי מוצר וספק | | 01, G18 |
| 103 | leaks › detective.colMedian / colExcess | מחיר חציוני / שולם מעל החציון | מחיר רגיל / שולם מעל הרגיל | | G9 |
| 104 | leaks › detective.roleOnly | רק לבעלי תפקיד "בעלים" יש גישה לבלש הדליפות. | המסך הזה זמין לבעלים. | | §2.5 |
| 105 | views › explorer.title / subtitle | חוקר הדליפה / …עם השוואה ויצוא. | פילוח הדליפה / …עם השוואה וייצוא. | Leak by… | 01, G48 |
| 106 | views › kpis.leak / pct / spend | דליפה בתקופה / מההוצאה / הוצאה שנבדקה | דליפה · {period} / מהרכש שנבדק / רכש שנבדק | | 02 |
| 107 | views › toolbar.apply / clearFilters | החל / נקה סינון | החלה / ניקוי הסינון | | person |
| 108 | views › range | {from} – {to} | מ-{from} עד {to} | {from} to {to} | 17 |
| 109 | leaks › claims.open | מכתבי זיכוי לספקים | מכתבי דרישת זיכוי | | G31 |
| 110 | leaks › claims.subject / trackerSubject | הנדון: בקשת זיכוי בגין חריגות בחשבוניות — {month} | הנדון: דרישה לזיכוי — פערים בחשבוניות {month} (D-3) | | 14 |
| 111 | leaks › claims.intro / colIssue | …מצאנו את ההפרשים הבאים… / מהות ההפרש | …מצאנו את הפערים הבאים… / הפער (line template per copy-rtl-14) | | 14, G20 |
| 112 | leaks › claims.trackerTitle / trackerNote / trackerTotal | תביעות ב„מעקב ₪ חוזר” שממתינות למכתב / … / סה״כ תביעות לזיכוי | דרישות זיכוי שעוד לא נשלח עליהן מכתב / {count} פערים ({amount}) שנרשמו לדרישה ועוד לא נשלח עליהם מכתב — גם בחשבוניות ששולמו. אחרי השליחה סמנו "המכתב נשלח". / סה״כ לזיכוי | | G30, quotes |
| 113 | leaks › claims.print · report.print | הדפס / שמור כ-PDF | הדפסה או שמירה כ-PDF | | person |
| 114 | leaks › report.headline / ofSpend | דלף החודש / {pct} מההוצאה על סחורה | דליפה · {period} / {pct} מהרכש שנבדק | | 02 |
| 115 | leaks › report.waived / byTypeTitle / creepTitle | ויתור / לפי סוג חריגה / מחירים שזחלו למעלה | שולם כפי שחויב / לפי סוג פער / מחירים שעלו | | G29, G20, G18 |
| 116 | leaks › report.method | שיטה: חריגות בחומרה בינונית ומעלה… | איך חישבנו: פערים ברמת אזהרה וחוסם… | | G21 |
| 117 | leaks › breakdown.open · payRun › table.openInvoice | פתח חשבונית | פתיחת החשבונית | | person |
| 118 | payRun › status.claim / kpis.credit / creditHint | לבקש זיכוי {amount} / זיכויים לבקש / מחריגות שאישרת לדרישה… | לדרוש זיכוי {amount} / זיכויים לדרוש / מפערים שאישרתם לדרוש · ליד כל סכום מצוין אם הוא לפני או כולל מע״מ | | G30, person |
| 119 | recovery › tracker.title / subtitle | מעקב ₪ חוזר / כל פער שדרשת מהספק… | מעקב זיכויים / כל פער שדרשתם מספק — מהמכתב ועד שהכסף חזר. | Credits tracker | G38, person |
| 120 | recovery › tracker.credited / returned / outstanding / writtenOff | זוכה (תעודת זיכוי) / חזר בפועל / עדיין חייבים לך / נמחק | זוכה / הוחזר / פתוח / ויתור | Credited / Returned / Outstanding / Written off | 04 |
| 121 | recovery › tracker.rate / rateHint | שיעור החזר / זוכה ÷ נדרש | שיעור זיכוי / זוכה ÷ נדרש | Credit rate | `chain-28` † |
| 122 | recovery › tracker.overdueHint | ללא תעודת זיכוי יותר מ-14 יום — נשלחת תזכורת במייל. | בלי חשבונית זיכוי יותר מ-14 יום. התזכורת נשלחת אליכם במייל, לא לספק. | | G5 |
| 123 | recovery › tracker.returnedThisMonth / hero.returnedTile | חזר החודש | הוחזר החודש | | G26 |
| 124 | recovery › status.credited / recovered / written_off | התקבל זיכוי / הכסף חזר / נמחק | זוכה / הוחזר / ויתור | | 04 |
| 125 | recovery › actions.letter_sent / credit / written_off / menu | סימון: מכתב נשלח / רישום תעודת זיכוי / מחיקה / פעולות | סימון שהמכתב נשלח / רישום חשבונית זיכוי / ויתור על {amount} (+confirm) / עוד פעולות | | 04, 09 |
| 126 | recovery › creditForm.title / number | רישום תעודת זיכוי · {supplier} / מספר תעודה | רישום חשבונית זיכוי · {supplier} / מספר חשבונית הזיכוי | Record credit note | G5 |
| 127 | recovery › creditForm.vatNote | …כמו הדליפה בדשבורד. | …כמו הדליפה בחדר הבקרה. | | G36 |
| 128 | recovery › report.headline | {amount} דלפו · {pct} מהרכש | דליפה · {period}: {amount} · {pct} מהרכש שנבדק | | 02 |
| 129 | recovery › report.returned / outstanding | חזר בפועל / עדיין חייבים לך (על חשבוניות החודש) | הוחזר / פתוח (על חשבוניות החודש) | | 04 |
| 130 | recovery › report.issueCount | {count} מקרים | → plural: מקרה אחד / שני מקרים / # מקרים | | 10 ("1 מקרים" live) |
| 131 | recovery › report.whatsappNote | ספק וואטסאפ במצב בדיקה (stub) — שום הודעה לא יוצאת עד הפעלה. | שליחה בוואטסאפ עוד לא מחוברת — שום הודעה לא יוצאת. | | 15 |
| 132 | recovery › next.allClear | אין משימות פתוחות — כל הכבוד | אין משימות פתוחות. | | tone |
| 133 | recovery › digest.subtitle / recovered / oneNumberLabel | כך ייראה המייל שתקבל… / מה חזר אליך / דלף מהרכש | כך ייראה המייל שתקבלו… / מה חזר אליכם / דליפה · {period} | | person, 02 |
| 134 | suppliers › detail.leakLabel | שולם מעל המחיר החציוני (30 יום) | (header ₪ becomes) דליפה · 90 הימים האחרונים; creep moves to the tab: שולם מעל המחיר הרגיל · 30 יום | | 01 |
| 135 | suppliers › leakCard.explorer / ledger.note | בסייר הדליפות / …הדליפה זהה לסייר הדליפות. | בפילוח הדליפה / …הדליפה זהה לזו שבמסך הדליפה. | | 01 |
| 136 | suppliers › leakCard.open / claimsCta | פתוח לטיפול / לתביעה / למכתבי התביעה | פתוח לטיפול או לדרישה / למכתבי דרישת הזיכוי | | G30 |
| 137 | suppliers › leakCard.scorecard / print / printTitle | כרטיס ספק — 90 יום / כרטיס ספק למו״מ (הדפסה) | דירוג ספק · 90 יום / דף למו״מ עם הספק (הדפסה) | | G12, G14 |
| 138 | suppliers › ledger.* "מרכזת/מרכזות" | רגילות ומרכזות / תעודות בהצלבה לחשבונית מרכזת | per D-1 (kept if "מרכזת" wins; else "ריכוז"); "בהצלבה" → "בהתאמה" | | G4, G42 |
| 139 | suppliers › ledger.csv | ייצוא CSV לחשב/ת | ייצוא CSV להנהלת החשבונות | | G45 |
| 140 | suppliers › scores.emptyBody / runs | הדוח מתבסס על השוואות (match runs)… / {count} השוואות בתקופה | הדירוג מבוסס על חשבוניות שנבדקו… / → plural: # חשבוניות שנבדקו | | 15 |
| 141 | suppliers › scores.trend.down | מדרדר | מחמיר | Getting worse | 16 |
| 142 | suppliers › manager.businessId / form.businessId / filterPlaceholder | ח.פ. {id} / ח.פ. / עוסק / סינון לפי שם, ח.פ. או אימייל… | ח״פ {id} / ח״פ / עוסק מורשה / סינון לפי שם, ח״פ או מייל… | | §1.4, G46 |
| 143 | suppliers › form.deliveryHint | …ולא נקלטה תעודת קבלה — תופיע התראת איחור. | …ולא נפתחה קבלת סחורה, תופיע התראת איחור. | | G3 |
| 144 | suppliers › manager.created / activated / deactivated | הספק "{name}" נוסף. | {name} נוסף לספקים. | | quotes |
| 145 | consolidated › finding.note | ת.מ. {number} | ת״מ {number} | | G2 |
| 146 | consolidated › title / subtitle / intro | הצלבה מול תעודות המשלוח / חשבונית הריכוז מול… / בהצלבת חשבונית הריכוז… | התאמה מול תעודות המשלוח / החשבונית המרכזת מול… / בהתאמת החשבונית המרכזת… (per D-1) | | G4, G42 |
| 147 | vat › card.subtitle / invoice.missing / invalid · `lib/vat/requestText.ts:36` | אי אפשר לקזז את המע״מ | אי אפשר לנכות את המע״מ | | G32 |
| 148 | vat › card.clear / request.copied | …כוללות מספר הקצאה ✓ / הועתק ✓ | (no ✓; the icon is in the component) | | 16 |
| 149 | invoices › correction.subtitle | תקנו ערכים שזוהו שגוי ב-OCR (כמות / מחיר / סכום) והריצו התאמה מחדש — … | תקנו כמות, מחיר או סכום שנקראו לא נכון מהחשבונית, ואז חשבו את הפערים מחדש. הדליפה מחושבת מהשורות האלה. | | 15 |
| 150 | invoices › correction.viewScan / rerun / saveDetails / save / edit | צפה בסריקה / הרץ התאמה מחדש / שמור פרטים / שמור / ערוך | צפייה בסריקה / חישוב הפערים מחדש (overflow) / שמירת הפרטים / שמירה / עריכה | | person, 09 |
| 151 | invoices › status.* | נקי — אין חריגות / חריגות קלות / חריגות חמורות / חוסם | תקינה — אין פערים / פערים לידיעה / פערים לטיפול / חוסם | | G21 |
| 152 | contracts › overview.body | {count} מוצרים עלו במחיר מעל הסף שהגדרתם. | → plural: מוצר אחד עלה במחיר מעל הסף שהגדרתם / # מוצרים עלו… | | 10 ("1 מוצרים" live) |
| 153 | contracts › alerts.period.days / weeks | {count} ימים / {count} שבועות | → plural with dual: יום אחד / יומיים / # ימים · שבוע / שבועיים / # שבועות | | 10 |
| 154 | contracts › list.validRange / alerts.range | {from} – {to} | מ-{from} עד {to} | | 17 |
| 155 | chain › dashboard.title / switcher.chainLink / upsell / ownerOnly | דאשבורד רשתי | סקירת רשת | Chain overview | G39 |
| 156 | chain › heatmap.legendHigh | 3%+ | 3% ומעלה | 3% and above | 11 |
| 157 | chain › alerts.window | 7 הימים האחרונים · {from}–{to} | 7 הימים האחרונים · מ-{from} עד {to} | | 17 |
| 158 | chain › dashboard.scopeNote / branches.add.body / notPayer / errors.notPayer | …שבהם את/ה בעלים… / …ואת/ה תהיו הבעלים שלו. / רק בעל/ת חשבון החיוב (המשלם/ת) יכול/ה… | …שבהם אתם בעלים… / …ואתם תהיו הבעלים שלו. / פתיחת סניף זמינה לבעלי חשבון החיוב. | | 08 |
| 159 | chain › worst.clean | אף סניף לא דלף בתקופה הזו. 👏 | אף סניף לא דלף בתקופה הזו. | | emoji |
| 160 | chain › kpis.claimed | נדרש בחזרה מספקים | נדרש מהספקים · {period} · כל הסניפים | | `chain-20` †, G24 |
| 161 | chain › ranking.switchTo / alerts.cta / worst.cta | כניסה / מעבר לסניף | פתיחת הסניף | Open branch | `chain-31` † |
| 162 | chain › suppliers.subtitle | אותו ספק מאוחד לפי ח.פ או שם | אותו ספק מאוחד לפי ח״פ או שם | | §1.4 |
| 163 | team › managerNote / members.you / confirmRemove / joined | כמנהל/ת… / (את/ה) / …הגישה שלו/ה… / הצטרף/ה {date} | בתור מנהלים אפשר… / (אתם) / …הגישה למסעדה תיחסם. / הצטרפות: {date} | | 08 |
| 164 | `lib/roles.ts` → team › roles.* | בעלים / מנהל/ת / מקבל סחורה / חשב/ת / שף | בעלים / ניהול / קבלת סחורה / הנהלת חשבונות / מטבח | Owner / Manager / Receiver / Bookkeeper / Chef | G45 |
| 165 | auth › login.rememberMe | זכור אותי במכשיר הזה | להישאר מחוברים במכשיר הזה | | `auth-19` † |
| 166 | auth › serverErrors.accountGone | …התנתק והתחבר מחדש… | …התנתקו והתחברו מחדש… | | person |
| 167 | auth › serverErrors.memberNotFound | החבר לא נמצא. | חבר הצוות לא נמצא. | | "חבר" reads as "friend" |
| 168 | auth › checkEmail.devHint | ב-development — חפשו בשורות ה-log של השרת תחת | (remove from i18n; dev-only branch) | | 15 |
| 169 | settings › sections.matchingSubtitle / matching.tolerancesTitle / fields.*Percent | ספי הסבילות… / ספי סבילות / סבילות מחיר (%) | ספי הסבולת… / ספי סבולת / סבולת מחיר (%) | | G35 |
| 170 | settings › sections.profileSubtitle | …נושאי משקל לחישוב הדליפה… | …משפיעים על חישוב הדליפה… | | clarity |
| 171 | ingest › inbox.approve / approveAndAllow | אישור ופענוח / אישור + הוספת השולח לרשימה | קריאת החשבונית / קריאה ואישור השולח | Read invoice / Read and trust sender | 09, G44 |
| 172 | ingest › documentStatus.registered / approved | בפענוח / המסמך נשלח לפענוח | בקריאה / החשבונית נשלחה לקריאה | | G44 |
| 173 | ingest › inbox.actionFailed / orderCapture.failed | הפעולה נכשלה: {message} | הפעולה לא הצליחה. {hint} (mapped code, never raw) | | 18 |
| 174 | ingest › channels.phoneNumberId / whatsappHint | Phone number ID (לא חובה) / כתובת ה־Webhook… | מזהה מספר הטלפון ב-Meta (לא חובה) / הכתובת שמגדירים באפליקציית Meta של המסעדה | | 15 |
| 175 | integrations › formats.rivhit.hint | יבוא מגיליון · CSV | ייבוא מגיליון · CSV | | G48 |
| 176 | orders › import.button | ייבוא הזמנה (Zestt PDF) | ייבוא הזמנה (PDF של Zester) | Import order (Zester PDF) | brand typo |
| 177 | orders › wizard.sentTitle | ההזמנה הוגשה בהצלחה | ההזמנה נשלחה ל{supplier} | Order sent to {supplier} | one verb (שליחה) |
| 178 | orders › subtitle / wizard.subtitle | בנו והגישו הזמנות… | בנו ושלחו הזמנות… | | one verb |
| 179 | orders › wizard.guardrailGated | מגן הדליפה בזמן הזמנה זמין בחבילה מתקדמת. | בדיקת מחירים בזמן ההזמנה זמינה במסלול מקצועי. | | G41, 01 |
| 180 | products › form.name | שם המוצר (קנוני, עברית) | שם המוצר בעברית (כפי שיופיע בכל הדוחות) | | 15 |
| 181 | products › names.allDone · recipes › changes.empty | …🎉 | (no emoji) | | 16 |
| 182 | recipes › tabs.pos / pos.title | תיאורטי מול בפועל / עלות מזון: תיאורטי מול בפועל | תאורטי מול בפועל / עלות מזון: תאורטית מול בפועל | | G34 |
| 183 | catalog › title | חיפוש מאוחד בקטלוג | קטלוג | | `catalog-32` † |
| 184 | catalog › import.viewSupplier | לכרטיס הספק | לדף הספק | | G12 |
| 185 | common › states.all · orders/ingest filters.all · recovery filterAll | הכל | הכול | | G47 |
| 186 | common › actions.backToOverview · auth › invite.back · admin › layout.backToDashboard · leakCheck › claim.toDashboard | חזרה לסקירה / חזרה לדשבורד / לדשבורד / למרכז הבקרה | לדף הבית | Home | G36 |
| 187 | marketing › lead.consentText | אני מאשר/ת קבלת תכנים… בדוא"ל / SMS… | אני מסכים/ה לקבל… במייל או ב-SMS… → better: "אישור לקבלת תכנים ועדכונים מ-RestoMatch במייל או ב-SMS. אפשר להסיר את ההסכמה בכל עת." | | 08, §1.4 |

### 4.3 Outside i18n (move in, then rewrite)

| # | File | Today | Proposed | Why |
|---|---|---|---|---|
| 188 | `packages/api/src/match/persist.ts:280` + seed | Hebrew prose in `activity.detail` ("הפסד פוטנציאלי ₪105") | metadata only; the client renders via `components.activity` in both locales | 12 |
| 189 | `packages/api/src/notifications/templates.ts:175-184` (magic link) | "לחיצה אחת ואתה בפנים", "פתח את הקישור", "ביקשת להתחבר" | "לחיצה אחת ואתם בפנים", "פתחו את הקישור", "ביקשתם להתחבר" | 08 |
| 190 | `…/templates.ts:246-259` (invite) | "{inviter} הזמין/ה אותך", "הוזמנת" | "{inviter} מזמינים אתכם להצטרף לצוות של {restaurant}" | 08 |
| 191 | `…/templates.ts:272-289` (late delivery) | "⏰ איחור באספקה", "באיחור של {n} ימים", "ההזמנה כוללת {n} פריטים" | "איחור באספקה · {supplier}" + plural ("באיחור של יום אחד / יומיים / # ימים") | 10, emoji |
| 192 | `…/templates.ts:301` (order reminder) | "📋 לא בוצעה הזמנה" | "תזכורת: היום יום הזמנה ל{supplier}" | emoji |
| 193 | `…/templates.ts:330-344` (approval) | "דרושה החלטה — {n} פערים…", "אישור/דחייה" | plural; "החלטה עכשיו תשחרר את התשלום או תעצור חיוב ביתר" | 10, 09 |
| 194 | `…/templates.ts:357-368` (weekly) | "הסיכום השבועי שלך — {₪} נחסכו", "נחסך/נמנע", "פתיחת הדשבורד" | "{week}: נמצאו {₪} בפערים · {₪} עוד פתוחים", "לחדר הבקרה" | 03, G36 |
| 195 | `…/templates.ts:107` (footer) | "מוקד הבקרה של הכסף" / "Command center for your money" | "חדר הבקרה של הכסף" / "Your money control room" | G36 |
| 196 | `…/templates.ts:413` (daily) | "כל הכבוד — אין זיכויים פתוחים. 🎉" | "אין זיכויים פתוחים." | tone |
| 197 | `lib/messageTemplates.ts` | 5 Hebrew builders, 4 unused; `מ"${supplier}"`; `₪${price}` | delete 4; move `agentVerification` to `supplierMessages`; values isolated (13); money via `formatIls` | 12, 13 |
| 198 | `lib/roles.ts:14-18` | מנהל/ת, חשב/ת | team › roles.* (row 164) | G45 |

---

## 5. Owner decisions this lens needs

- **D-1. Consolidated invoice name.**
  - **Recommended: "חשבונית מרכזת".** The bookkeeper's software and the Tax Authority use this wording (repo research).
  - Alternative: keep "חשבונית ריכוז" (AGENTS.md and 10 strings).
  - Either way, one term. If "מרכזת" wins, AGENTS.md needs a human edit.
- **D-2. Discrepancy noun.**
  - **Recommended: "פער"** (neutral, blame-free, 56 uses in the owner's docs vs 30 for "חריג").
  - Alternative: "חריגה".
- **D-3. Letter register.** The claim letter subject says "דרישה לזיכוי" (recommended, one term), or "בקשה לזיכוי" (softer toward suppliers). Internal UI stays "דרישת זיכוי" either way.
- **D-4. Roles as functions** ("ניהול", "הנהלת חשבונות", "קבלת סחורה", "מטבח"), or as gendered person nouns without slashes ("מנהל", "מנהלת חשבונות", which still isn't inclusive).
- **D-5. Target line on the hero (R-14).** Default: hidden. If shown, "רף ענפי: 1.5% מהרכש שנבדק".

---

## 6. Big moves

1. **Glossary-as-code and a copy gate.**
   - `lib/i18n/glossary.ts` (§1, he + en + definition + retired patterns) plus the vitest from copy-rtl-20.
   - It feeds the "מה זה?" popovers and palette aliases.
   - This is the only way 41 namespaces owned by 15+ sessions stay one voice.
   - Exemplar: Polaris and Atlassian content linting.
2. **ICU-lite message runtime.** Three features in `translate.ts`, about 120 lines with no dependency:
   - plural (one/two/other);
   - automatic FSI/PDI isolation of values;
   - a typed `select`.

   Server code emits events and codes, never prose. Exemplar: Mozilla Fluent and Unicode MessageFormat 2.
3. **The money-language pass.** One leak sentence, the four-state funnel and verbs that name the ₪, shipped in 3 PRs:
   - (a) field flows (§4.1);
   - (b) owner and boss surfaces (§4.2);
   - (c) emails and server (§4.3).

   Exemplar: Stripe balance states; Intuit verbs.
4. **Bookkeeper vocabulary alignment.** "חשבונית מרכזת", "חשבונית זיכוי", "כרטסת", "כרטיס ספק", "ניכוי מע״מ" and "קבלת סחורה", with a one-page "מילון מונחים" linked from Exports and the ledger. Exemplar: Priority and Morning terminology.
5. **Counter-party copy kit.** The claim letter, consolidated letter, dock slip, supplier portal, WhatsApp texts and VAT request become one `supplierMessages` namespace. Each line carries expected vs charged with references, isolated plain text and `formatIls` money, and sending follows the preview → deferred-send flow. Exemplar: Ottimate and BILL vendor credit requests.

---

## 7. Cross-references

| This lens | Related | Relationship |
|---|---|---|
| 01, 02 | `command-15`, `chain-20`, `lens-ia-nav` §9.4 | 02 supplies the canonical strings for `command-15`. 01 adds the creep homonym (new). |
| 04 | `chain-28` | Same tracker. This lens adds "תביעה = lawsuit" and G5. |
| 08 | `auth-19`, `area-receiving` §copy, `area-marketing` H1 | This lens provides the product-wide rule, the census and the gate. |
| 09 | `approvals-01`, `chain-31`, `RCV-16` | This lens generalises the verb grammar. |
| 11 | `design-system` E4 (`bdi dir=ltr` money) | This lens covers strings, percent and arrows; that lens covers the wrapper. |
| 13 | `rtl.md` P18, cookbook §5.2 | Runtime isolation replaces per-call `originalProps`. |
| 21 | `lens-ia-nav` §9.3 | Titles. |

**Artifacts:**
- Probes: `review/scripts/copy-probe.cjs`, `he-plural.cjs`, `en-sweep.cjs`.
- Lab: `review/scripts/copylab/lab.mjs`, `lab-output.txt`, `lab.png`.
- Crops: `review/crops-copy/*.png`. Key crops: `activity_zoom.png`, `home_recipes_zoom.png`, `dashboard_receiving__receiver__phone-he__t0.png`, `dashboard_leaks__owner__desktop-he__t0.png`, `dashboard_suppliers_ID__owner__desktop-he__t0.png`, `dashboard_recovery__owner__desktop-he__t0.png`, `dashboard_leaks_claims__owner__desktop-he__t0.png`.
