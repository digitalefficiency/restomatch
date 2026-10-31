# CUT-LIST · Copy focus: short explanations, in place

> **Owner decisions 31.10 (evening):** "יעד עלות מזון" → **"עלות מזון רצויה"** (every food-cost target string; "מעל עלות המזון הרצויה" in alerts). Inventory count cadence suggestion → **monthly**.

**For:** the Batch P session (train B, Wed 4.11) and W2-16 + the wave-2 area packages. **Date:** Sat 31.10.2026. **Source of truth:** `rw-release` @ `96d47226` (read-only); every current value below was re-read from that tree and matches the six inventories (0 drift). Line numbers are the key line in `apps/web/lib/i18n/messages/<file>` unless a full path is given; re-grep after you rebase.
**Owner request (31.10):** "יש הרבה מקומות שיש הסבר למה זה ככה ולמה זה ככה צריך לאגד את זה בצורה יעילה יותר". **Clarified:** "לא חייב מקום אחד להסברים, אפשר להשאיר איפה שקיים אבל בצורה יעילה יותר". So every explanation stays on its screen and gets one of four treatments: cut, shorten, share one string, or fold in place. No help centre, no glossary page.
**Verified 31.10** (adversarial pass, see "Verification" at the end): 205 Batch P rows and 70 Batch W2 rows re-read against `rw-release`; corrected totals in the table below. **Inputs:** `inventory-{A..F}-*.json|md` (927 rows, 892 unique keys: 35 keys were audited by two areas and are reconciled here), `MECHANISM.md`, `RULES.he.md`, lab captures in `shots/`. Companion files: `shared-explanations.he.draft.ts` / `.en.draft.ts` (the one wording per repeated concept), `BATCH-P-BRIEF.md`, `W2-16.md`, `OWNER.he.md`.

## Totals

Word metric (MECHANISM §5.1): letter-led tokens; numbers, ₪, %, dates and punctuation never count; `{count}`/`{amount}`-type placeholders count 0, text placeholders (`{supplier}`, `{name}`…) count 1; ICU plural = longest branch. "Explanatory" = every string the six auditors inventoried (hints, subtitles, empty-state bodies, banners, errors, footnotes, a11y names, confirmations, legal). After-W2 counts a fold as its visible line + the toggle label.

| | strings | explanatory words | change |
|---|---:|---:|---:|
| Inventoried (unique keys) | 892 | 7,584 | |
| …of which never rendered (dead keys, server prose the UI never shows) | 39 | 281 | |
| **Rendered today** | **853** | **7,303** | |
| **After Batch P** (train B, values only) | 196 changed (+5 label term fixes) | **6,408** | **−895 (12%)** |
| **After W2** (W2-16 mechanism + area adoption) | 410 (4 also have an interim P value) | **4,448** | **−2,855 (39%)** vs today |

Verdicts (unique keys): SHORTEN 371 · KEEP 291 · CUT 106 · MERGE 93 · FOLD 31 *(31.10 verification: 2 SHORTEN → KEEP, 1 SHORTEN → FOLD)*. KEEP rows (legal, ₪ confirmations, a11y names, T4 wording, deadlines, already-minimal lines) are not listed below; they are in the inventory JSONs.
Batch split: **Batch P** = 196 keys (SHORTEN 171, MERGE 21, no key removal, plus 4 interim values on rows whose fold/cut waits for W2) + 5 term-fix labels = **201 rows**. **Batch W2** = 410 keys (everything with a fold, a code change, a server change, or off the ציקטי week-1 path).

### The three worst pilot screens (lab, primary role/viewport)

- **Settings, owner 1440:** 403 visible words, 225 of them explanatory → **397** after Batch P → **274** after W2. `docs/ux/wave2/copy-focus/shots/F-shell-settings--settings--owner--desktop.jpg`
- **Leak proof, owner 1440:** 340 visible words, 139 of them explanatory → **304** after Batch P → **260** after W2. `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-proof--owner--desktop.jpg`
- **Receiving review + dock slip, manager 390:** 254 visible words, 98 of them explanatory → **217** after Batch P → **210** after W2. `docs/ux/wave2/copy-focus/shots/C-receiving--review-slip--manager--phone.jpg`
- **Owner home 1440:** 357 visible words, 86 of them explanatory → **351** after Batch P → **313** after W2. `docs/ux/wave2/copy-focus/shots/A-owner-money--home--owner--desktop.jpg`
- **Leak breakdown, manager 390:** 572 visible words, 102 of them explanatory → **520** after Batch P → **508** after W2. `docs/ux/wave2/copy-focus/shots/A-owner-money--leaks-breakdown--manager--phone.jpg`
- **Receiving board, receiver 390:** 124 visible words, 23 of them explanatory → **115** after Batch P → **107** after W2. `docs/ux/wave2/copy-focus/shots/C-receiving--inbox--receiver--phone.jpg`

Visible words = auditors' `document.body.innerText` count (includes the shell nav, sr-only text and, in the lab, the stale-worker banner). The W2-16 e2e budget uses the stricter `main`-only metric of MECHANISM §5.2; both are printed side by side there.

## How to read an item
`key` · `file:line` | current → proposal | verdict | conceptId | testRefs. "→ —" means the string goes (CUT). In Batch W2 the verdict cell also names what the change needs and who adopts it (MECHANISM §6.4).

---

# Batch P · train B (Wed 4.11) · values only

Rules (full brief: `BATCH-P-BRIEF.md`): change values, never keys; he and en together; no component, layout, fold or new namespace; no key removal (the two dead keys moved to W2); receiver overlays (ar/ru/th/ti) untouched. Pilot path only (ציקטי week-1 flags, PILOT-RUNBOOK §8). Rows marked *interim* get a value now and their fold or cut in W2. Rows marked *term* fix a binding term (no "יעד", פער not "חריגה", קבלת סחורה not bare "קבלה", plural address) on the same screens.

**Tests that must change with Batch P: none** (31.10 verification moved `approvals.why.sourceP90`, the only row that needed `vocab.test.ts:221/:295` edited, to W2-04). Every testRef in this section reads the catalog at runtime (W1-05.spec.ts:429, W1-11.spec.ts:682/:693, orders-wizard-delivery.spec.ts:73/79, demo-path.spec.ts:456), checks overlay placeholders (receiver-langs.test.ts) or pins a substring the new value keeps (letters.test.ts:337, vocab.test.ts:240, serverErrors.test.ts:30); re-run them. Values that grow on purpose: `overview.chef.dishesTitle`, `suppliers.leakCard.lines`, `suppliers.form.deliveryTitle` (terms); `overview.hero.calc` grows by 1 (16 → 17 words; the first proposal grew it to 21). Each row's verdict cell ends with the 31.10 check: ✅ = re-read at file:line, where it renders; ❌ = fixed in place, moved or dropped, with the reason.

## P · Home `/dashboard` (owner · manager · chef · receiver homes)
Visible words now → after P → after W2: home · owner 1440: **357 → 351 → 313** (expl. 86) · home · manager 390: **246 → 244 → 206** (expl. 73) · home-receiver · receiver 390: **122 → 113 → 110** (expl. 20) · home-chef · chef 390: **71 → 64 → 61** (expl. 24)
Batch P on this screen: 13 keys, 109 → 76 explanatory words (−33) *(verified 31.10; was "14 keys, 116 → 80 explanatory words (−36)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `overview.homeSubtitle.chef` · `overview/he.ts:23` | ספירה, ומנות שעברו את יעד עלות המזון. → **ספירה ועלות מנות.** | CUT *interim* *term* · ✅ renders app/dashboard/page.tsx:43 | — | — |
| `overview.hero.pending` · `overview/he.ts:51` | {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — כנראה חשבוניות מרכזות. הן לא נספרות בדליפה ולא בהוצאה. → **{count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — לרוב מרכזות. עד השיוך הן לא בהוצאה.** | FOLD *interim* · ✅ renders home/finance.tsx:488; accurate: leak-hero.ts sums the leak over every invoice, only spend skips pending ones; T4 calm | concept.pendingLink | — |
| `overview.hero.awaitingCount` · `overview/he.ts:52` | {count} חשבוניות ({amount}) ממתינות לספירת קבלת הסחורה — הן ייבדקו כשהקבלה תיסגר. → **{count} חשבוניות ({amount}) ממתינות לסגירת קבלת הסחורה** | SHORTEN · ✅ renders home/finance.tsx:491 | concept.pendingReceipt | — |
| `overview.hero.clean` · `overview/he.ts:53` | אין דליפה החודש — {count} חשבוניות נבדקו ונמצאו תואמות להזמנות ולקבלות. → **אין דליפה · {count} חשבוניות נבדקו ✓** | MERGE · ✅ renders home/finance.tsx:451 | concept.clean | — |
| `overview.hero.calc` · `overview/he.ts:54` | פערים בחומרה בינונית ומעלה, מוגבל לסכום כל חשבונית. לא כולל מחיר נמוך מהמצופה וחשבוניות ללא הזמנה. → **נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה".** *(was: נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה", "ממתינה לשיוך להזמנה" ו"שורת הזמנה לא חויבה".)* | MERGE · ❌ **fixed**: true on main today (LEAK_FILTER, leak-views.ts:134 still counts MISSING_ON_INVOICE). "שורת הזמנה לא חויבה" ships inside W1-08's LEAK_FILTER PR, same commit as the filter, never ahead of it | concept.leakRule | — |
| `overview.hero.thinBase` · `overview/he.ts:55` | בסיס דליל: {count} חשבוניות נבדקו עד כה — מוקדם מדי לאחוז. → **מוקדם לאחוז: נבדקו רק {count} חשבוניות** | SHORTEN · ✅ renders home/finance.tsx:433 | concept.thinBase | — |
| `overview.hero.noData.hint` · `overview/he.ts:58` | צלמו את החשבונית הראשונה, והדליפה תחושב מול ההזמנה והקבלה. → **הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה.** | MERGE · ✅ renders home/finance.tsx:454; the "צלמו חשבונית" CTA sits next to it (finance.tsx:456) | concept.noData | — |
| `overview.hero.delta.none` · `overview/he.ts:66` | אין חשבוניות באותם ימים בחודש הקודם להשוואה → **אין נתוני השוואה** | MERGE · ✅ renders home/finance.tsx:403 | concept.noCompare | — |
| `overview.chef.dishesSubtitle` · `overview/he.ts:115` | מנות שעלות המזון שלהן עלתה מעל יעד {target} בגלל מחיר רכיב. → **עלות המזון עלתה מעל {target} בגלל מחיר רכיב.** | SHORTEN *term* · ✅ renders home/staff.tsx:103; % only, no ₪; chef card renders only with recipes on | concept.foodCostLine | — |
| `overview.leaks.subtitle` · `overview/he.ts:177` | מעל המחיר הרגיל אצל אותו ספק. מדד נפרד — לא נספר בדליפה של החודש. → **מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה** | MERGE · ✅ renders home/finance.tsx:542 | concept.creep | — |
| `overview.activity.emptyDescription` · `overview/he.ts:185` | כשחשבוניות ייקלטו ופערים יטופלו, היומן יתמלא כאן. → **היומן יתמלא כשחשבוניות ייקלטו.** | SHORTEN · ✅ renders home/finance.tsx:584 | — | — |
| `overview.chef.dishesTitle` · `overview/he.ts:114` | מנות שעברו את היעד → **מנות שעלות המזון שלהן עלתה** | label *term* · ✅ renders home/staff.tsx:101 | — | — |
| `overview.chef.dishesNone` · `overview/he.ts:118` | אף מנה לא עברה את היעד החודש ✓ → **אין מנות כאלה החודש ✓** | label *term* · ✅ renders home/staff.tsx:110 | — | — |

## P · Shell on every dashboard page (worker banner, offline, re-auth, 403/404/error)
Visible words now → after P → after W2: reauth · manager 390: **394 → 379 → 239** (expl. 277) · more-sheet · manager 390: **420 → 414 → 275** (expl. 249) · search · manager 390: **365 → 359 → 220** (expl. 249) · offline · manager 390: **366 → 360 → 221** (expl. 254) · reauth · owner 1440: **436 → 421 → 297** (expl. 253) · +15 more captures in Appendix A
Batch P on this screen: 16 keys, 174 → 108 explanatory words (−66) *(verified 31.10; was "16 keys, 174 → 104 explanatory words (−70)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `common.errorPage.body` · `common/he.ts:62` | נתקלנו בתקלה בלתי צפויה. אפשר לנסות שוב — אם הבעיה חוזרת, רעננו את העמוד או חזרו מאוחר יותר. → **נסו שוב. אם זה חוזר, רעננו את העמוד או חזרו מאוחר יותר.** *(was: נסו שוב. אם זה חוזר, שלחו לנו את הקוד.)* | MERGE · ❌ **fixed**: app/error.tsx:38 shows the code only when error.digest exists, so "שלחו לנו את הקוד" can point at nothing; no longer merge:errorRetry | concept.errorRetry | — |
| `common.notFound.body` · `common/he.ts:67` | הכתובת שחיפשתם לא קיימת או הוסרה. בדקו את הקישור או חזרו לעמוד הראשי. → **הקישור שגוי או שהדף הוסר.** | SHORTEN · ✅ renders not-found.tsx:46 | concept.notFound | — |
| `common.shell.session.notSent` · `common/he.ts:79` | הפעולה לא נשלחה · ההתחברות פגה. התחברו ונסו שוב. → **לא נשלח · התחברו ונסו שוב.** | SHORTEN · ✅ renders components/errors.ts:37 | concept.sessionExpired | lib/__tests__/receiver-langs.test.ts |
| `common.shell.session.wrong` · `common/he.ts:84` | האימייל או הסיסמה שגויים, או שהיו יותר מדי ניסיונות. נסו שוב בעוד רגע. → **פרטים שגויים או יותר מדי ניסיונות. נסו שוב בעוד רגע.** | SHORTEN · ✅ renders net/ShellResilience.tsx:247 | concept.rateLimit | lib/__tests__/receiver-langs.test.ts |
| `common.shell.session.magicLink` · `common/he.ts:85` | אין סיסמה? שלחו לי קישור כניסה במייל → **שלחו לי קישור כניסה למייל** | MERGE · ✅ renders net/ShellResilience.tsx:352 | concept.magicLink | lib/__tests__/receiver-langs.test.ts |
| `common.shell.session.magicSent` · `common/he.ts:86` | שלחנו קישור כניסה ל־{email}. פתחו אותו, וחזרו ללשונית הזו — נמשיך מכאן. → **שלחנו קישור כניסה ל־{email}. פתחו אותו וחזרו לכאן.** *(was: שלחנו קישור ל־{email}. פתחו אותו וחזרו לכאן.)* | SHORTEN · ❌ **fixed**: one name for the link: "קישור כניסה" (draft magicLinkSent) | concept.magicLink | lib/__tests__/receiver-langs.test.ts |
| `common.shell.session.twoFactor` · `common/he.ts:88` | לחשבון הזה יש אימות דו־שלבי. השלימו את הכניסה בלשונית חדשה וחזרו לכאן. → **נדרש אימות דו־שלבי. השלימו אותו בלשונית חדשה וחזרו לכאן.** | SHORTEN · ✅ renders net/ShellResilience.tsx:286 | — | lib/__tests__/receiver-langs.test.ts |
| `common.shell.forbidden.requestBody` · `common/he.ts:103` | נשלח הודעה מוכנה עם הקישור. הבעלים יכולים לשנות תפקיד במסך צוות. → **נפתח לכם הודעה מוכנה עם הקישור.** | SHORTEN · ✅ renders forbidden/page.tsx:151 | concept.forbidden | e2e/W1-04.spec.ts, lib/__tests__/receiver-langs.test.ts |
| `common.shell.forbidden.refreshBody` · `common/he.ts:111` | הבעלים שינו את ההרשאות שלכם. רעננו את הגישה כדי לפתוח את המסך ‘{screen}’. → **רעננו את הגישה כדי לפתוח את ‘{screen}’.** | SHORTEN · ✅ renders forbidden/page.tsx:102 | concept.forbidden | lib/__tests__/receiver-langs.test.ts |
| `common.shell.forbidden.notMember` · `common/he.ts:114` | הקישור שייך לסניף שאין לכם גישה אליו. בקשו מהבעלים להוסיף אתכם, או חזרו לבית. → **בקשו מהבעלים להוסיף אתכם לסניף.** | SHORTEN · ✅ renders forbidden/page.tsx:114 | concept.forbidden | lib/__tests__/receiver-langs.test.ts |
| `common.shell.notFound.body` · `common/he.ts:120` | ייתכן שהוא נמחק, שהקישור שגוי או שהוא שייך לסניף אחר. → **הקישור שגוי, הדף נמחק, או שהוא בסניף אחר.** | SHORTEN · ✅ renders not-found.tsx:25 | concept.notFound | lib/__tests__/receiver-langs.test.ts |
| `common.shell.error.body` · `common/he.ts:127` | נסו שוב. אם זה חוזר, שמרו את הקוד שמופיע כאן — הוא עוזר לאתר את התקלה. → **נסו שוב. אם זה חוזר, שלחו לנו את הקוד.** | SHORTEN · ✅ renders error.tsx:61 | concept.errorRetry | lib/__tests__/receiver-langs.test.ts |
| `common.shell.error.offline` · `common/he.ts:133` | אין חיבור לרשת, ולכן הדף לא נטען. נטען אותו שוב כשהחיבור יחזור. → **אין חיבור. נטען את הדף כשהרשת תחזור.** | SHORTEN · ✅ renders error.tsx:61 | concept.offline | lib/__tests__/receiver-langs.test.ts |
| `nav.worker.title` · `nav/he.ts:126` | מנוע העיבוד לא זמין כרגע. → **העיבוד מתעכב.** | SHORTEN · ✅ renders worker-status.tsx:44 | concept.workerDown | e2e/demo-path.spec.ts, lib/__tests__/receiver-langs.test.ts |
| `nav.worker.body` · `nav/he.ts:127` | חשבוניות שתעלו יישמרו ויעברו OCR והתאמה ברגע שהוא יחזור. → **חשבוניות שתעלו יישמרו ויעובדו אחר כך.** | SHORTEN · ✅ renders worker-status.tsx:44 | concept.workerDown | lib/__tests__/receiver-langs.test.ts |
| `nav.worker.ownerNotified` · `nav/he.ts:129` | הבעלים קיבל התראה. → **אין צורך לפעול.** | CUT *interim* · ✅ renders worker-status.tsx:45; "הבעלים קיבל התראה" is false (api/cron/worker-heartbeat mails WORKER_ALERT_EMAILS/PLATFORM_ADMIN_EMAILS); ar/ru/th/ti overlays still say it until W2-05 | concept.workerDown | lib/__tests__/receiver-langs.test.ts |

## P · Sign-in family `/login` `/reset` `/set-password` `/invite/accept` `/onboarding`
Visible words now → after P → after W2: login-invited · anon 390: **56 → 49 → 39** (expl. 28) · login · anon 1440: **47 → 45 → 35** (expl. 19) · login · anon 390: **47 → 45 → 35** (expl. 19) · login-consent · anon 1440: **60 → 58 → 48** (expl. 26) · login-consent · anon 390: **60 → 58 → 48** (expl. 26) · +11 more captures in Appendix A
Batch P on this screen: 14 keys, 160 → 97 explanatory words (−63) *(verified 31.10; was "14 keys, 160 → 98 explanatory words (−62)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `auth.login.invitedHint` · `auth/he.ts:19` | ההזמנה נשלחה לכתובת הזו — התחברו איתה כדי לקבל גישה. → **ההזמנה נשלחה לכתובת הזו.** | SHORTEN · ✅ renders login/page.tsx:223 | concept.invite | lib/__tests__/receiver-langs.test.ts |
| `auth.login.resetDone` · `auth/he.ts:21` | הסיסמה עודכנה וכל המכשירים נותקו. התחברו עם הסיסמה החדשה. → **הסיסמה עודכנה. התחברו עם הסיסמה החדשה.** | SHORTEN · ✅ renders login/page.tsx:194 | concept.devicesSignOut | lib/__tests__/receiver-langs.test.ts |
| `auth.login.errors.verification` · `auth/he.ts:24` | הקישור פג תוקף או שכבר נעשה בו שימוש. נסו שוב. → **הקישור פג או כבר נוצל. בקשו קישור חדש.** | MERGE · ✅ renders login/page.tsx:39 | concept.linkExpired | lib/__tests__/receiver-langs.test.ts |
| `auth.login.errors.emailSignin` · `auth/he.ts:27` | לא הצלחנו לשלוח קישור התחברות. ייתכן שנשלחו יותר מדי בקשות — נסו שוב בעוד כמה דקות. → **לא הצלחנו לשלוח קישור. נסו שוב בעוד כמה דקות.** | SHORTEN · ✅ renders login/check-email/page.tsx:58 | concept.rateLimit | lib/__tests__/receiver-langs.test.ts |
| `auth.checkEmail.body` · `auth/he.ts:33` | שלחנו לכם קישור התחברות. לחצו עליו כדי להיכנס למערכת. הקישור תקף ל-24 שעות. → **שלחנו קישור כניסה, תקף ל-24 שעות.** | MERGE · ✅ renders login/check-email/page.tsx:52 | concept.magicLink | lib/__tests__/receiver-langs.test.ts |
| `auth.reset.requestSubtitle` · `auth/he.ts:47` | הזינו את כתובת המייל שלכם — אם קיים חשבון, יישלח אליו קישור לאיפוס. → **הזינו את המייל, ונשלח אליו קישור איפוס.** *(was: נשלח קישור איפוס למייל שלכם.)* | SHORTEN · ❌ **fixed**: "נשלח קישור איפוס" reads as past tense ("a link was sent") on the page before anything was sent; keeps the action | concept.linkExpired | — |
| `auth.reset.chooseSubtitle` · `auth/he.ts:53` | הזינו סיסמה חדשה. כל המכשירים המחוברים יתנתקו לאחר האיפוס. → **כל המכשירים יתנתקו אחרי האיפוס.** | SHORTEN · ✅ renders (auth)/reset/page.tsx:35 | concept.devicesSignOut | — |
| `auth.reset.token` · `auth/he.ts:56` | הקישור אינו תקף, פג תוקפו או שכבר נעשה בו שימוש. בקשו קישור חדש. → **הקישור פג או כבר נוצל.** *(was: הקישור פג או כבר נוצל. בקשו קישור חדש.)* | SHORTEN · ❌ **fixed**: reset/page.tsx:40-43 puts the link "בקשת קישור חדש" right after it; "בקשו קישור חדש." doubled it | concept.linkExpired | — |
| `auth.signin.lockoutHint` · `auth/he.ts:112` | אחרי כמה ניסיונות שגויים הכניסה ננעלת לזמן קצר. אפשר להיכנס גם בלי סיסמה: → **הכניסה ננעלת לזמן קצר. אפשר להיכנס בלי סיסמה:** | SHORTEN · ✅ renders login/page.tsx:202 | concept.rateLimit | lib/__tests__/receiver-langs.test.ts |
| `auth.signin.newHere` · `auth/he.ts:120` | חדשים ב-RestoMatch? הכניסה הראשונה עם קישור במייל פותחת חשבון. → **חדשים? הכניסה הראשונה בקישור במייל פותחת חשבון.** | SHORTEN · ✅ renders login/page.tsx:291 | concept.magicLink | lib/__tests__/receiver-langs.test.ts |
| `auth.mail.sentTo` · `auth/he.ts:125` | שלחנו קישור כניסה ל-{email}. לחצו עליו כדי להיכנס — הקישור תקף ל-24 שעות. → **שלחנו קישור כניסה ל-{email}, תקף ל-24 שעות.** | SHORTEN · ✅ renders login/check-email/page.tsx:52 | concept.magicLink | — |
| `auth.inviteState.usedBody` · `auth/he.ts:152` | כבר בצוות? היכנסו לחשבון. אם ההזמנה בוטלה — בקשו הזמנה חדשה. → **כבר בצוות? היכנסו. אחרת, בקשו הזמנה חדשה.** | SHORTEN · ✅ renders invite/accept/page.tsx:106 | concept.invite | — |
| `auth.inviteState.notFoundBody` · `auth/he.ts:154` | ייתכן שהקישור לא הועתק במלואו. פתחו אותו שוב מהמייל, או בקשו הזמנה חדשה. → **פתחו שוב את הקישור מהמייל, או בקשו הזמנה חדשה.** | SHORTEN · ✅ renders invite/accept/page.tsx:107 | concept.invite | — |
| `auth.resetFlow.sentTo` · `auth/he.ts:163` | אם {email} רשומה אצלנו, שלחנו אליה קישור לאיפוס. הקישור תקף לזמן קצר. → **אם {email} רשומה אצלנו, שלחנו אליה קישור לאיפוס.** | SHORTEN · ✅ renders (auth)/reset/page.tsx:100 | concept.linkExpired | — |

## P · Receiving board `/dashboard/receiving` (+ read-only receipt)
Visible words now → after P → after W2: inbox · receiver 390: **124 → 115 → 107** (expl. 23) · inbox · manager 390: **124 → 115 → 107** (expl. 23) · receipt-view · receiver 390: **65 → 63 → 54** (expl. 13) · receipt-view · manager 390: **65 → 63 → 54** (expl. 13)
Batch P on this screen: 4 keys, 37 → 21 explanatory words (−16).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `overview.board.noPo.hint` · `overview/he.ts:148` | ספק הגיע בלי הזמנה? בקשו ממנהל/ת המשמרת לפתוח הזמנה, והמשאית תופיע כאן לקבלה. → **בקשו מהמנהל לפתוח הזמנה.** *(was: בקשו מאחראי המשמרת לפתוח הזמנה.)* | SHORTEN · ❌ **fixed**: "אחראי המשמרת" is no role in the app (lib/roles.ts: מנהל/ת); no slash form; overlays untouched | concept.noPo | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `overview.board.empty.hint` · `overview/he.ts:152` | כשתישלח הזמנה לספק עם תאריך משלוח, המשאית תופיע כאן. → **משלוחים מהזמנות עם תאריך אספקה יופיעו כאן.** *(was: משלוחים מהזמנות עם תאריך יופיעו כאן.)* | SHORTEN · ❌ **fixed**: "עם תאריך" alone is vague; overlays untouched | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `overview.board.receipt.readOnly` · `overview/he.ts:156` | הקבלה נסגרה — לקריאה בלבד → **צפייה בלבד** | SHORTEN · ✅ renders home/receipt-view.tsx:56 | concept.receiptClosed | e2e/W1-05.spec.ts, lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `overview.board.receipt.followUp.hint` · `overview/he.ts:165` | הקבלה תיפתח שוב לספירת מה שהגיע עכשיו. הפתיחה נרשמת ביומן. → **קבלת הסחורה תיפתח שוב לספירת המשלוח · נרשם ביומן** | SHORTEN *term* · ✅ renders home/receipt-view.tsx:89 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |

## P · Delivery Check `/dashboard/receiving/<poId>` (scan → review → count → confirm)
Visible words now → after P → after W2: review-slip · manager 390: **254 → 217 → 210** (expl. 98) · confirmed · manager 390: **178 → 160 → 146** (expl. 58) · review-slip · receiver 390: **216 → 190 → 187** (expl. 68) · review-mismatch · receiver 390: **169 → 149 → 149** (expl. 28) · review-mismatch · manager 390: **167 → 147 → 147** (expl. 28) · +45 more captures in Appendix A
Batch P on this screen: 29 keys, 305 → 148 explanatory words (−157) *(verified 31.10; was "30 keys, 312 → 150 explanatory words (−162)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `common.shell.session.body` · `common/he.ts:78` | התחברו שוב — העבודה שלכם נשמרה. פעולה שלא נשלחה מחכה ללחיצה נוספת שלכם. → **התחברו שוב — העבודה שלכם נשמרה.** | SHORTEN · ✅ renders net/ShellResilience.tsx:279; the control itself says "לא נשלח · התחברו ונסו שוב" (ShellResilience: actions are never replayed) | concept.sessionExpired | e2e/W1-04.spec.ts, lib/__tests__/receiver-langs.test.ts |
| `receivingDelivery.delivery.scan.noInvoice` · `receiving/delivery.he.ts:17` | אין חשבונית עכשיו — קלטו מול ההזמנה → **המשיכו בלי חשבונית** | SHORTEN · ✅ renders showcase/receiver/_steps/InvoiceScan.tsx:311 | concept.continueWithOrder | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.review.lowConfidence` · `receiving/delivery.he.ts:35` | הקריאה לא ודאית — כדאי להשוות לנייר → **קריאה לא ודאית — השוו לנייר** | SHORTEN · ✅ renders showcase/receiver/_steps/Reconciliation.tsx:154 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.review.priceToManager` · `receiving/delivery.he.ts:36` | המחיר בחשבונית שונה מההזמנה — עובר לבדיקת המנהל → **מחיר שונה — ייבדק באישורים** | SHORTEN · ✅ renders showcase/receiver/_steps/AdjustQuantities.tsx:334; manager-only: the receiver gets no PO prices, so no price_diff line | concept.priceDiff | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.count.subtitle` · `receiving/delivery.he.ts:40` | סמנו מה הגיע. שורה שהגיעה כמו בהזמנה — ✓. → **סמנו מה הגיע** | SHORTEN · ✅ renders showcase/receiver/_steps/AdjustQuantities.tsx:160; each line shows a visible "✓ הגיע" button, so the ✓ sentence is redundant | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.count.offline` · `receiving/delivery.he.ts:73` | אין חיבור — הספירה שמורה בטלפון. אפשר לסגור את קבלת הסחורה כשהחיבור יחזור. → **אין חיבור · הספירה שמורה בטלפון. סגרו כשהחיבור יחזור** *(was: אין חיבור · הספירה שמורה. סגרו כשהחיבור יחזור)* | SHORTEN · ❌ **fixed**: keeps "בטלפון": offline, where the count lives is the fact the receiver needs | concept.savedOnPhone | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.count.heldBody` · `receiving/delivery.he.ts:76` | הספירות האלה לא נשלחו — קבלת הסחורה נסגרה בינתיים. בחרו מה לעשות בכל שורה. → **הספירות האלה לא נשלחו — בחרו מה לעשות בכל שורה** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:1258 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.count.spotHint` · `receiving/delivery.he.ts:84` | ספרו את הפריטים האלה ורשמו כמה הגיע בפועל. → **ספרו ורשמו כמה הגיע בפועל** | SHORTEN · ✅ renders showcase/receiver/_steps/AdjustQuantities.tsx:614 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.summary.subtitle` · `receiving/delivery.he.ts:103` | נקלטה ב־{time}. אלה הכמויות שנרשמו. → **נקלטה ב־{time}** | SHORTEN · ✅ renders receiving/[poId]/receipt-summary.tsx:49 | concept.receiptClosed | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receivingDelivery.delivery.error.body` · `receiving/delivery.he.ts:110` | מה שכבר נספר שמור. נסו שוב, או חזרו לרשימת המשלוחים. → **מה שכבר נספר שמור** | SHORTEN · ✅ renders receiving/[poId]/error.tsx:24 | concept.savedOnPhone | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.scan.subtitle` · `receiving/he.ts:40` | מהספק "{supplier}". ודאו שכל השורות נראות בבירור. → **ספק: {supplier}** | SHORTEN · ✅ renders showcase/receiver/_steps/InvoiceScan.tsx:218 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.scan.frameHint` · `receiving/he.ts:42` | מקמו את החשבונית בתוך המסגרת → **ודאו שכל השורות בתוך המסגרת** *(was: כל השורות בתוך המסגרת)* | SHORTEN · ❌ **fixed**: a task instruction needs a verb (plural imperative) | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.scan.bannerQueued` · `receiving/he.ts:52` | נשמרה בטלפון · תעלה כשהחיבור יחזור → **נשמרה בטלפון** | SHORTEN · ✅ renders showcase/receiver/_steps/InvoiceScan.tsx:409 | concept.savedOnPhone | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.scan.tooLarge` · `receiving/he.ts:54` | הקובץ גדול מדי (עד {mb} MB). צלמו את החשבונית כתמונה, או פצלו את ה-PDF. → **הקובץ גדול מ־{mb} MB — צלמו את החשבונית** | SHORTEN · ✅ renders showcase/receiver/_steps/InvoiceScan.tsx:142 | concept.fileLimits | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.scan.unsupportedType` · `receiving/he.ts:55` | סוג קובץ לא נתמך. העלו תמונה (JPG / PNG / WEBP) או PDF. → **סוג קובץ לא נתמך — העלו תמונה או PDF** | SHORTEN · ✅ renders showcase/receiver/_steps/InvoiceScan.tsx:146 | concept.fileLimits | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.processing.stillReading` · `receiving/he.ts:74` | זה לוקח יותר מהרגיל. אפשר להמשיך מול ההזמנה — נציג את החשבונית כשתהיה מוכנה. → **נציג את החשבונית כשתהיה מוכנה.** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:1183 | concept.continueWithOrder | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.processing.readyLater` · `receiving/he.ts:76` | החשבונית נקראה. הציגו את התוצאות כדי להשוות אותה למה שהגיע. → **החשבונית נקראה** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:1119 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.recon.duplicateInvoice` · `receiving/he.ts:105` | מספר החשבונית {number} כבר קיים אצל הספק הזה — סומנה לבדיקה כחשבונית כפולה אפשרית. אפשר להמשיך לקלוט כרגיל. → **ייתכן שחשבונית {number} כפולה — היא תיבדק. המשיכו כרגיל.** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:908 | concept.duplicateInvoice | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.recon.pendingBanner` · `receiving/he.ts:106` | {count} שורות לא הוצלבו אוטומטית — סמנו אותן לפי מה שהגיע. זה לא פער, רק בדיקה. → **{count} שורות לבדיקה, לא פער — סמנו לפי מה שהגיע** | SHORTEN · ✅ renders showcase/receiver/_steps/Reconciliation.tsx:227 | concept.pendingReview | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.steps.recon.mismatchBanner` · `receiving/he.ts:107` | אף שורה בחשבונית לא הותאמה לשורות ההזמנה. אם זו חשבונית של ספק אחר, פתחו את ההזמנה הנכונה או צלמו שוב; אם זה הספק הנכון, עברו על השורות ידנית. → **אף שורה לא תואמת להזמנה — אולי ספק אחר?** | SHORTEN · ✅ renders showcase/receiver/_steps/Reconciliation.tsx:217; the two ways out are the buttons under it | concept.wrongInvoice | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.dockSlip.subtitle` · `receiving/he.ts:159` | להציג לנהג לפני שהוא יוצא — מה חסר, מה פגום ומה חויב ביתר. → **הראו לנהג לפני שהוא יוצא** | SHORTEN *term* · ✅ renders receiving/[poId]/dock-slip.tsx:166 | — | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.dockSlip.computing` · `receiving/he.ts:178` | מנוע ההתאמה מחשב את הסכומים… → **מחשבים את הסכומים…** | SHORTEN · ✅ renders receiving/[poId]/dock-slip.tsx:236 | concept.amountLater | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.dockSlip.afterClose` · `receiving/he.ts:179` | סכום הפער בש״ח ייקבע אחרי סגירת קבלת הסחורה — מנוע ההתאמה בודק מול הספירה בפועל. → **הסכום ייקבע אחרי סגירת קבלת הסחורה.** *(was: הסכום ייקבע אחרי סגירת קבלת הסחורה)* | SHORTEN · ❌ **fixed**: byte-identical with explain.amountAfterClose; en "goods receipt" (a "receipt" is a payment receipt) | concept.amountLater | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.dockSlip.slow` · `receiving/he.ts:180` | החישוב לוקח יותר מהרגיל. הכמויות כבר כאן; ה־₪ יתעדכן בהמשך. → **החישוב מתעכב — הסכום יתעדכן בהמשך** | SHORTEN · ✅ renders receiving/[poId]/dock-slip.tsx:240 | concept.amountLater | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.dockSlip.noSend` · `receiving/he.ts:188` | לא נשלח דבר אוטומטית — הקישור פותח את הוואטסאפ שלכם עם הטקסט. → **שום דבר לא נשלח לספק בלי לחיצה שלכם.** | SHORTEN · ✅ renders receiving/[poId]/dock-slip.tsx:281 | concept.noAutoSend | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.errors.ocrFailed` · `receiving/he.ts:200` | לא הצלחנו לקרוא את החשבונית. אפשר להמשיך לקלוט מול ההזמנה, או לצלם שוב. → **לא הצלחנו לקרוא את החשבונית** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:1122 | concept.continueWithOrder | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.errors.ocrQuota` · `receiving/he.ts:201` | מכסת סריקות החשבוניות לחודש הסתיימה. אפשר להמשיך לקלוט מול ההזמנה. → **מכסת הסריקות לחודש נגמרה** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:1121 | concept.continueWithOrder | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.errors.ocrTimeout` · `receiving/he.ts:205` | קריאת החשבונית לוקחת יותר מהרגיל — אפשר להמשיך לקלוט מול ההזמנה. → **החשבונית עוד בקריאה** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:1117 | concept.continueWithOrder | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |
| `receiving.errors.queueUnavailable` · `receiving/he.ts:206` | החשבונית נשמרה, אבל הקריאה האוטומטית לא זמינה כרגע — ממשיכים לקלוט מול ההזמנה. → **החשבונית נשמרה · הקריאה האוטומטית לא זמינה כרגע** | SHORTEN · ✅ renders receiving/[poId]/wizard.tsx:408 | concept.continueWithOrder | lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |

## P · Approvals `/dashboard/approvals`
Visible words now → after P → after W2: approvals (open) · owner 1440: **407 → 405 → 387** (expl. 33) · approvals · owner 1440: **305 → 305 → 290** (expl. 19) · approvals (open) · bookkeeper 1440: **80 → 75 → 75** (expl. 10) · approvals · bookkeeper 1440: **74 → 71 → 71** (expl. 6) · approvals (open) · manager 390: **158 → 156 → 156** (expl. 4) · +1 more captures in Appendix A
Batch P on this screen: 16 keys, 127 → 68 explanatory words (−59) *(verified 31.10; was "17 keys, 134 → 73 explanatory words (−61)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `approvals.empty.clearDescription` · `approvals/he.ts:13` | אין פערים פתוחים במסעדה. פערים חדשים יופיעו כאן ברגע שיזוהו בקבלות ובחשבוניות. → **פערים חדשים יופיעו כאן.** | SHORTEN · ✅ renders approvals/list.tsx:989 | — | — |
| `approvals.empty.othersWaiting` · `approvals/he.ts:14` | אין פערים שמחכים לך · {count} ממתינים ל{role} ({amount}) → **אין פערים שמחכים לכם.** | SHORTEN · ✅ renders approvals/list.tsx:980; the "ממתין לאחרים · N · ₪" summary stays visible below | concept.othersWaiting | — |
| `approvals.empty.othersWaitingMany` · `approvals/he.ts:15` | אין פערים שמחכים לך · {count} ממתינים לאחרים ({amount}) → **אין פערים שמחכים לכם.** | MERGE · ✅ renders approvals/list.tsx:985; same | concept.othersWaiting | — |
| `approvals.others.readOnly` · `approvals/he.ts:32` | לקריאה בלבד — ההחלטה שלהם. → **צפייה בלבד** | SHORTEN · ✅ renders approvals/list.tsx:1048 | — | — |
| `approvals.card.forbidden` · `approvals/he.ts:96` | אין לך הרשאה להחליט על הפער הזה. → **אין הרשאה להחליט על הפער הזה.** | SHORTEN *term* · ✅ renders approvals/list.tsx:225 | — | — |
| `approvals.undo.failed` · `approvals/he.ts:120` | אי אפשר לבטל: עבר הזמן או שמישהו אחר כבר פעל. → **כבר אי אפשר לבטל.** | SHORTEN · ✅ renders approvals/list.tsx:253 | — | — |
| `approvals.errorPage.body` · `approvals/he.ts:127` | משהו השתבש בטעינת הפערים. שום החלטה לא אבדה. → **שום החלטה לא אבדה.** | SHORTEN · ✅ renders approvals/error.tsx:34 | — | — |
| `approvals.types.PRICE_HIGHER.explain` · `approvals/he.ts:146` | הספק חייב מחיר ליחידה גבוה מהמחיר בהזמנה או מהמחיר ההיסטורי. → **מחיר ליחידה גבוה מההזמנה או ממחירי העבר.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback) | — | — |
| `approvals.types.PRICE_LOWER.explain` · `approvals/he.ts:150` | הספק חייב פחות מהמצופה — לא דליפה, רק לידיעה. → **חויב פחות מהמצופה. לא נספר בדליפה.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback) | concept.notLeak | — |
| `approvals.types.MISSING_ON_INVOICE.explain` · `approvals/he.ts:166` | פריט שהוזמן לא מופיע בחשבונית — ייתכן שיגיע בחשבונית אחרת. → **ייתכן שיחויב בחשבונית אחרת.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback) | — | — |
| `approvals.types.UNIT_MISMATCH.explain` · `approvals/he.ts:170` | יחידת המידה בחשבונית שונה מזו שבהזמנה ואין המרה ביניהן. → **יחידה שונה מההזמנה, בלי המרה.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback) | — | — |
| `approvals.types.DUPLICATE_INVOICE.explain` · `approvals/he.ts:179` | מספר החשבונית כבר נקלט מאותו ספק — סכנה לתשלום כפול. → **מספר החשבונית כבר נקלט מהספק הזה.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback) | concept.duplicate | app/dashboard/approvals/__tests__/vocab.test.ts:240 (passes) |
| `approvals.types.DATE_ANOMALY.explain` · `approvals/he.ts:183` | תאריך החשבונית רחוק ביותר משבוע ממועד האספקה הצפוי. → **תאריך החשבונית רחוק ממועד האספקה.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback); "ביותר משבוע" may go: the WhyLine threshold "סף ±{days} ימים" carries the number | — | — |
| `approvals.types.VAT_MISMATCH.explain` · `approvals/he.ts:187` | סכום המע״מ אינו תואם את שיעור המע״מ על הסכום לפני מע״מ. → **סכום המע״מ לא תואם לשיעור.** | SHORTEN · ✅ renders approvals/vocab.ts:298 (WhyLine fallback) | — | — |
| `approvals.tolerance.date` · `approvals/he.ts:198` | ±{days} ימים ממועד האספקה הצפוי → **±{days} ימים** | SHORTEN · ✅ renders approvals/vocab.ts:65 | — | app/dashboard/approvals/__tests__/vocab.test.ts:20-37 (passes) |
| `approvals.tolerance.vat` · `approvals/he.ts:205` | מע״מ {rate} על הסכום לפני מע״מ, ±{amount} → **מע״מ {rate}, ±{amount}** | SHORTEN · ✅ renders approvals/vocab.ts:67 | — | app/dashboard/approvals/__tests__/vocab.test.ts:20-37 (passes) |

## P · Invoice page `/dashboard/invoices/[id]` (+ `/scans`)
Visible words now → after P → after W2: invoice-vat · bookkeeper 1440: **151 → 142 → 115** (expl. 51) · invoice · bookkeeper 1440: **138 → 129 → 105** (expl. 35) · invoice-consolidated · owner 1440: **325 → 316 → 296** (expl. 42) · invoice-consolidated · manager 390: **244 → 235 → 215** (expl. 42) · invoice-consolidated · bookkeeper 1440: **300 → 291 → 271** (expl. 42) · +5 more captures in Appendix A
Batch P on this screen: 5 keys, 86 → 43 explanatory words (−43).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `auth.serverErrors.invoiceNumberTaken` · `auth/he.ts:192` | מספר החשבונית {invoiceNumber} כבר רשום בחשבונית אחרת של הספק הזה (מתאריך {holderDate}). בדקו את המספר — או פתחו את החשבונית הקיימת. → **המספר {invoiceNumber} כבר רשום אצל הספק הזה ({holderDate}).** | SHORTEN · ✅ renders lib/serverErrors.ts:37 (appCode invoice.numberTaken); resolves by appCode, not the Hebrew lookup; serverErrors.test.ts:30-43 still passes ("1234", holderDate) | concept.duplicate | lib/__tests__/serverErrors.test.ts:30 (passes) |
| `invoices.correction.subtitle` · `invoices/he.ts:8` | תקנו ערכים שזוהו שגוי ב-OCR (כמות / מחיר / סכום) והריצו התאמה מחדש — מספר הדליפה מחושב מהשורות האלה. → **תקנו שורות שנקראו שגוי והריצו התאמה מחדש.** | SHORTEN · ✅ renders invoices/[invoiceId]/page.tsx:70 | concept.rerunMatch | — |
| `invoices.correction.duplicateOf` · `invoices/he.ts:37` | מספר החשבונית {number} כבר קיים אצל הספק הזה — החשבונית סומנה לבדיקה כחשבונית כפולה אפשרית. אם זה מספר אחר, תקנו אותו למטה. → **חשבונית כפולה אפשרית: מספר {number} כבר קיים אצל הספק. מספר שגוי? תקנו למטה.** | SHORTEN · ✅ renders invoices/[invoiceId]/correction-client.tsx:206 | concept.duplicate | — |
| `invoices.correction.ocrFailed` · `invoices/he.ts:38` | לא הצלחנו לקרוא את החשבונית אוטומטית. הזינו את הסכומים והשורות ידנית, או צלמו אותה שוב מקליטת הסחורה. → **לא הצלחנו לקרוא את החשבונית. הזינו ידנית או צלמו שוב.** | SHORTEN *term* · ✅ renders invoices/[invoiceId]/correction-client.tsx:219 | concept.ocrFailed | — |
| `invoices.correction.ocrQuota` · `invoices/he.ts:39` | מכסת סריקות החשבוניות לחודש הסתיימה, ולכן החשבונית לא נקראה אוטומטית. אפשר להזין את הנתונים ידנית. → **מכסת הסריקות החודשית נגמרה. הזינו את הנתונים ידנית.** | SHORTEN · ✅ renders invoices/[invoiceId]/correction-client.tsx:218 | concept.ocrFailed | — |

## P · Leak hub `/dashboard/leaks` (+ `#prices`)
Visible words now → after P → after W2: leaks · owner 1440: **374 → 368 → 313** (expl. 97) · leaks · manager 390: **149 → 137 → 131** (expl. 38)
Batch P on this screen: 7 keys, 63 → 33 explanatory words (−30) *(verified 31.10; was "7 keys, 63 → 31 explanatory words (−32)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `contracts.over.leaksBody` · `contracts/he.ts:168` | {count} שורות חשבונית חויבו מעל מחיר החוזה שסיכמתם. → **{count} שורות חויבו מעל החוזה** | SHORTEN · ✅ renders contracts/over-contract.tsx:54 | concept.overContract | — |
| `leaks.hub.subtitle` · `leaks/he.ts:13` | דליפה = כסף שחויבתם מעבר להזמנה ולמה שהתקבל, בחשבוניות שנבדקו, לפני מע״מ. → **כסף שחויבתם מעבר להזמנה ולמה שהתקבל, בחשבוניות שנבדקו, לפני מע״מ.** *(was: כסף שחויבתם מעבר להזמנה ולמה שהתקבל, לפני מע״מ.)* | SHORTEN · ❌ **fixed**: keeps the condition "בחשבוניות שנבדקו" of the one definition of דליפה | concept.leak | — |
| `leaks.hub.error.body` · `leaks/he.ts:17` | לא הצלחנו לטעון את המספרים. שום נתון לא אבד — נסו שוב. → **שום נתון לא אבד.** | SHORTEN · ✅ renders leaks/error.tsx:19 | — | — |
| `leaks.detective.roleOnly` · `leaks/he.ts:35` | טבלת המחירים שעלו זמינה לבעלים. אפשר לבקש גישה מבעלי המסעדה. → **המחירים שעלו — לבעלים בלבד.** | SHORTEN · ✅ renders leaks/page.tsx:113 | concept.roleOnly | — |
| `leaks.detective.emptyDescription` · `leaks/he.ts:37` | נדרשות לפחות 3 תצפיות מחיר לכל מוצר וספק לפני שמחושב מחיר רגיל. המשיכו לקלוט חשבוניות. → **צריך לפחות 3 מחירים לכל מוצר וספק.** | SHORTEN · ✅ renders leaks/page.tsx:151 | — | — |
| `leaks.heatmap.more` · `leaks/he.ts:58` | ועוד {count} פריטים בטבלה למטה → **ועוד {count} פריטים** | SHORTEN · ✅ renders home/finance.tsx:571 | — | — |
| `views.filteredNote` · `views/he.ts:132` | התצוגה מסוננת — המספרים מתייחסים לסינון בלבד. → **מוצג לפי הסינון** | SHORTEN · ✅ renders home/finance.tsx:105 | — | — |

## P · Leak breakdown `/dashboard/leaks/breakdown`
Visible words now → after P → after W2: leaks-breakdown · manager 390: **572 → 520 → 508** (expl. 102) · leaks-breakdown · owner 1440: **664 → 612 → 600** (expl. 102)
Batch P on this screen: 2 keys, 25 → 13 explanatory words (−12).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `leaks.breakdown.subtitle` · `leaks/he.ts:62` | כל חשבונית שתרמה לדליפה של {month}, מהגדולה לקטנה, עם השורות שגרמו לה. → **כל חשבונית שתרמה לדליפה ב{month}, מהגדולה לקטנה.** *(was: כל חשבונית עם פער ב{month}, מהגדולה לקטנה.)* | SHORTEN · ❌ **fixed**: "כל חשבונית עם פער" over-claims: an invoice with only PRICE_LOWER/info gaps is not listed (leak-hero.ts:228) | — | — |
| `leaks.breakdown.noMoneyShort` · `leaks/he.ts:84` | החוסר חויב בחשבונית — הוא נספר פעם אחת, בשורת החיוב על יותר ממה שהתקבל → **כבר נספר בשורת החיוב העודף** | SHORTEN · ✅ renders leaks/breakdown/page.tsx:279 | concept.countedOnce | app/dashboard/leaks/__tests__/letters.test.ts |

## P · Leak proof `/dashboard/leaks/proof`
Visible words now → after P → after W2: leaks-proof · owner 1440: **340 → 304 → 260** (expl. 139)
Batch P on this screen: 8 keys, 95 → 52 explanatory words (−43).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `leakProof.subtitle` · `leakProof/he.ts:9` | כל שקל במספר, ומאיפה הוא הגיע · {month} → **{month}** | SHORTEN · ✅ renders leaks/proof/page.tsx:74 | — | — |
| `leakProof.pct` · `leakProof/he.ts:16` | {pct} = {amount} ÷ {spend} רכש שנבדק, לפני מע״מ (חשבוניות שהותאמו להזמנה) → **{pct} = {amount} ÷ {spend} רכש שנבדק, לפני מע״מ** | SHORTEN · ✅ renders leaks/proof/page.tsx:102 | — | — |
| `leakProof.pctNone` · `leakProof/he.ts:17` | אין עדיין רכש שנבדק החודש, ולכן אין אחוז → **אין עדיין רכש שנבדק — אין אחוז** | SHORTEN · ✅ renders leaks/proof/page.tsx:103 | — | — |
| `leakProof.pending` · `leakProof/he.ts:19` | {count} חשבוניות, {amount} (חשבוניות ריכוז / עדיין לא שויכו להזמנה). הסכום שלהן לא נכנס לרכש שנבדק (ולאחוז) עד שישויכו; ממצא שנמצא עליהן כן נכלל במספר. → **{count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — לרוב מרכזות. הסכום שלהן לא נכנס לרכש שנבדק עד השיוך; ממצאים עליהן כן נספרים.** | SHORTEN *term* · ✅ renders leaks/proof/page.tsx:117 | concept.pendingLink | — |
| `leakProof.topHint` · `leakProof/he.ts:22` | לפי הדליפה של כל חשבונית, לכל היותר עד סכום החשבונית → **לפי חשבונית, עד סכום החשבונית** | SHORTEN · ✅ renders leaks/proof/page.tsx:126 | concept.cap | — |
| `leakProof.caught` · `leakProof/he.ts:31` | {amount} מהדליפה נמצאים בחשבוניות שעדיין לא סומנו כשולמו — עוד אפשר לבקש תיקון או זיכוי לפני התשלום. → **{amount} מהדליפה עוד אפשר לעצור לפני תשלום** | MERGE · ✅ renders leaks/proof/page.tsx:216 | concept.caught | — |
| `leakProof.resolvedNote` · `leakProof/he.ts:34` | מתוכם {amount} ({items}) אושרו אבל אינם בדרישה במעקב ₪ חוזר, ולכן לא במכתב. → **מתוכם {amount} ({items}) אושרו אך אינם במכתב.** | MERGE · ✅ renders leaks/proof/page.tsx:224 | concept.inLetter | — |
| `leakProof.footer` · `leakProof/he.ts:40` | כל הסכומים כאן הם אותם סכומים שבחדר הבקרה, עד האגורה. לא חושב כאן שום מספר חדש. → **אותם סכומים כמו בחדר הבקרה, עד האגורה.** | SHORTEN · ✅ renders leaks/proof/page.tsx:240 | — | — |

## P · Monthly leak report `/dashboard/leaks/report` + `/dashboard/reports/*`
Visible words now → after P → after W2: reports-digest · owner 1440: **175 → 175 → 158** (expl. 32) · leaks-report · manager 390: **230 → 230 → 218** (expl. 66) · leaks-report · owner 1440: **297 → 297 → 285** (expl. 66) · reports-monthly · manager 390: **133 → 133 → 127** (expl. 17) · reports-monthly · owner 1440: **188 → 188 → 182** (expl. 17)
Batch P on this screen: 2 keys, 20 → 13 explanatory words (−7).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `leaks.states.noDataHint` · `leaks/he.ts:24` | כשתצלמו חשבונית בקבלת סחורה והיא תותאם להזמנה, הדליפה תחושב כאן. → **הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה.** | MERGE · ✅ renders leaks/explorer.tsx:128; LeakStateNote carries the role-aware CTA | concept.noData | — |
| `leaks.report.resolvedNote` · `leaks/he.ts:204` | מתוכם {amount} ({items}) אושרו אבל אינם בדרישה במעקב ₪ חוזר, ולכן לא במכתב. → **מתוכם {amount} ({items}) אושרו אך אינם במכתב.** | MERGE · ✅ renders leaks/report/page.tsx:302 | concept.inLetter | — |

## P · Claim letters `/dashboard/leaks/claims`
Visible words now → after P → after W2: leaks-claims · manager 390: **713 → 682 → 679** (expl. 59) · leaks-claims · owner 1440: **770 → 739 → 736** (expl. 59)
Batch P on this screen: 6 keys, 85 → 42 explanatory words (−43).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `leaks.claims.reminder.note` · `leaks/he.ts:96` | באיחור? מכינים לספק טיוטת תזכורת בוואטסאפ — היא יוצאת רק כשאתם לוחצים שליחה. → **שום דבר לא נשלח לספק בלי לחיצה שלכם.** | SHORTEN · ✅ renders leaks/claims/page.tsx:344 | concept.notSent | — |
| `leaks.claims.subtitle` · `leaks/he.ts:103` | מכתב אחד לכל ספק — מה לקזז לפני תשלום ומה לבקש כזיכוי, נכון ל{month}. → **מכתב לכל ספק · נכון ל{month}** | SHORTEN · ✅ renders leaks/claims/page.tsx:287 | — | — |
| `leaks.claims.notTracked` · `leaks/he.ts:116` | השורות עוד לא אושרו לדרישה — אחרי אישור בתור האישורים אפשר לעקוב אחרי השליחה. → **אשרו בתור האישורים כדי לעקוב אחרי השליחה.** | SHORTEN · ✅ renders leaks/claims/page.tsx:257 | concept.inLetter | — |
| `leaks.claims.note` · `leaks/he.ts:136` | כולל רק מה שהוחלט לדרוש: דרישות ממעקב ₪ חוזר שעוד לא נשלחו ופערים שאושרו לדרישה. פערים שלא הוחלטו או שבוטלו לא נכללים. → **במכתב רק פערים שאושרו לדרישה ועוד לא נשלחו.** | SHORTEN · ✅ renders leaks/claims/page.tsx:331 | concept.inLetter | — |
| `leaks.claims.undecided.body` · `leaks/he.ts:139` | {count} פערים החודש עוד לא הוחלטו — הם לא נכנסים למכתב עד שתאשרו אותם לדרישה. → **{count} פערים מחכים להחלטה — לא במכתב עד אישור.** | SHORTEN · ✅ renders leaks/claims/page.tsx:319 | concept.inLetter | — |
| `leaks.claims.mixedBasis` · `leaks/he.ts:177` | הסכום כולל שורות בבסיסי מע״מ שונים — הבסיס של כל שורה מצוין לידה. → **בסיס המע״מ מצוין ליד כל שורה.** | SHORTEN · ✅ renders leaks/claims/page.tsx:226 | — | — |

## P · Recovery tracker `/dashboard/recovery`
Visible words now → after P → after W2: recovery-credit · owner 1440: **1078 → 1068 → 1026** (expl. 68) · recovery-credit · manager 390: **967 → 957 → 915** (expl. 68) · recovery · owner 1440: **1029 → 1021 → 988** (expl. 52) · recovery · manager 390: **918 → 910 → 877** (expl. 52) · recovery-confirm-recovered · owner 1440: **1053 → 1045 → 1012** (expl. 67) · +3 more captures in Appendix A
Batch P on this screen: 7 keys, 66 → 36 explanatory words (−30).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `recovery.tracker.errorBody` · `recovery/he.ts:9` | לא הצלחנו לטעון את הדרישות. שום שינוי לא אבד — נסו שוב. → **שום שינוי לא אבד.** | SHORTEN · ✅ renders recovery/error.tsx:16 | — | — |
| `recovery.tracker.outstandingHint` · `recovery/he.ts:15` | פתוח ובמחלוקת · מתוך {claimed} שנדרשו ב-{count} דרישות → **{count} דרישות · מתוך {claimed} שנדרשו** | SHORTEN · ✅ renders recovery/page.tsx:100 | concept.outstanding | — |
| `recovery.tracker.tabEmpty.todo` · `recovery/he.ts:48` | אין דרישות פתוחות — כל מה שנדרש נסגר. → **אין דרישות פתוחות.** | SHORTEN · ✅ renders recovery/tracker-client.tsx:365 | — | — |
| `recovery.tracker.emptyHint` · `recovery/he.ts:53` | כשמאשרים פער לדרישה מהספק (בתור האישורים) הוא מופיע כאן אוטומטית. → **פערים שתאשרו לדרישה יופיעו כאן.** | SHORTEN · ✅ renders recovery/page.tsx:78 | concept.claimFromApproval | — |
| `recovery.tracker.suggestionsHint` · `recovery/he.ts:59` | שורה שלילית בחשבונית מאוחרת של אותו ספק — אפשר לסגור איתה דרישות בלחיצה. → **שורה שלילית בחשבונית מאוחרת — סגרו איתה דרישות בלחיצה.** | SHORTEN · ✅ renders recovery/tracker-client.tsx:467 | — | — |
| `recovery.followUp.reminderNote` · `recovery/he.ts:86` | התזכורת האוטומטית מגיעה אליכם בלבד. לספק מכינים טיוטה, והיא נשלחת רק בלחיצה שלכם. → **שום דבר לא נשלח לספק בלי לחיצה שלכם.** | MERGE · ✅ renders recovery/page.tsx:207 | concept.notSent | — |
| `recovery.creditForm.claims` · `recovery/he.ts:163` | יוחל רק על הדרישות שסומנו ({count}, {amount}), מהישנה לחדשה. → **יוחל על {count} דרישות ({amount}), מהישנה לחדשה.** | SHORTEN · ✅ renders recovery/tracker-client.tsx:718 | — | — |

## P · Orders list `/dashboard/orders`
Visible words now → after P → after W2: orders-search-none · manager 390: **72 → 59 → 53** (expl. 28) · orders-filter-empty · owner 1440: **125 → 120 → 107** (expl. 23) · orders · owner 1440: **386 → 381 → 375** (expl. 16) · orders · manager 390: **521 → 516 → 510** (expl. 16) · orders · chef 390: **67 → 67 → 67** (expl. 0)
Batch P on this screen: 7 keys, 34 → 17 explanatory words (−17).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `orders.list.emptyBody` · `orders/he.ts:42` | צרו הזמנה חדשה מתוך קטלוג הספק. → **רשמו כאן כל הזמנה לספק.** | SHORTEN · ✅ renders orders/list-client.tsx:136 | concept.recordOnly | — |
| `orders.list.noSearchResults` · `orders/he.ts:50` | אין הזמנות שמתאימות לחיפוש — נסו שם ספק אחר או מס׳ הזמנה מלא. → **אין הזמנות שמתאימות לחיפוש.** | SHORTEN · ✅ renders orders/list-client.tsx:131 | — | e2e/W1-11.spec.ts |
| `orders.list.searchScope` · `orders/he.ts:51` | החיפוש עובר על ההזמנות שנטענו. "טעינת עוד" מרחיבה אותו. → **החיפוש רק בהזמנות שנטענו.** | SHORTEN · ✅ renders orders/list-client.tsx:94 | — | — |
| `orders.list.loadErrorBody` · `orders/he.ts:59` | ייתכן שהחיבור נקטע. ההזמנות שלכם לא נפגעו. → **ההזמנות שלכם לא נפגעו.** | SHORTEN · ✅ renders orders/error.tsx:25 | — | — |
| `orders.list.reorder` · `orders/he.ts:52` | הזמן שוב → **הזמינו שוב** | label *term* · ✅ renders orders/orders-table.tsx:167 | — | — |
| `orders.detail.reorder` · `orders/he.ts:125` | הזמן שוב → **הזמינו שוב** | label *term* · ✅ renders orders/[poId]/detail-client.tsx:375 | — | — |
| `orders.list.reorderAria` · `orders/he.ts:53` | הזמן שוב מ{supplier} → **הזמינו שוב מ{supplier}** | label *term* · ✅ renders orders/orders-table.tsx:219 | — | — |

## P · New order `/dashboard/orders/new`
Visible words now → after P → after W2: orders-new-build-open · owner 1440: **195 → 190 → 175** (expl. 23) · orders-new-build-open · manager 390: **134 → 129 → 114** (expl. 23) · orders-new-build · owner 1440: **159 → 159 → 140** (expl. 19) · orders-new-build · manager 390: **98 → 98 → 79** (expl. 19) · orders-new · owner 1440: **126 → 126 → 119** (expl. 7) · +4 more captures in Appendix A
Batch P on this screen: 18 keys, 148 → 95 explanatory words (−53).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `orders.reorder.failed` · `orders/he.ts:74` | לא הצלחנו לטעון את ההזמנה הקודמת. אפשר להתחיל הזמנה רגילה. → **ההזמנה הקודמת לא נטענה. אפשר להזמין כרגיל.** | SHORTEN · ✅ renders orders/new/wizard.tsx:404 | — | — |
| `orders.draft.switched` · `orders/he.ts:86` | עברתם ל{to}. ההזמנה ל{from} ({count} פריטים) נשמרה כטיוטה. → **ההזמנה ל{from} נשמרה כטיוטה.** | SHORTEN · ✅ renders orders/new/wizard.tsx:819 | concept.savedOnPhone | — |
| `orders.draft.staleSent` · `orders/he.ts:93` | ההזמנה ל{supplier} כבר נשלחה ({ref}), לכן הטיוטה שבמכשיר הוסרה ולא תישלח שוב. → **ההזמנה ל{supplier} כבר נשלחה ({ref}) — לא תישלח שוב.** | SHORTEN · ✅ renders orders/new/wizard.tsx:839 | concept.savedOnPhone | — |
| `orders.draft.staleCancelled` · `orders/he.ts:94` | ההזמנה ל{supplier} בוטלה ({ref}), לכן הטיוטה שבמכשיר הוסרה. → **ההזמנה ל{supplier} בוטלה ({ref}). הטיוטה הוסרה.** | SHORTEN · ✅ renders orders/new/wizard.tsx:839 | concept.savedOnPhone | — |
| `orders.send.cta.none` · `orders/he.ts:101` | סמנו כנשלחה ({supplier} לא יקבל הודעה) → **סמנו כנשלחה · בלי הודעה לספק** | SHORTEN · ✅ renders orders/new/wizard.tsx:779 + orders/[poId]/detail-client.tsx:237; orders-wizard-delivery.spec.ts:79 regex becomes the whole label and still matches | concept.recordOnly | e2e/orders-wizard-delivery.spec.ts |
| `orders.errors.cannotCancel` · `orders/he.ts:188` | לא ניתן לבטל הזמנה שנסגרה או בוטלה. → **אי אפשר לבטל את ההזמנה הזו.** | SHORTEN · ✅ renders orders/[poId]/detail-client.tsx:121 | — | — |
| `orders.wizard.noSuppliers` · `orders/he.ts:199` | עוד אין ספקים פעילים. הוסיפו ספק כדי להתחיל להזמין. → **עוד אין ספקים פעילים.** | SHORTEN · ✅ renders orders/new/wizard.tsx:915 | concept.noSuppliers | — |
| `orders.wizard.catalogEmpty` · `orders/he.ts:208` | לספק הזה אין עדיין מחירון. ייבאו מחירון או הוסיפו שורה חופשית. → **אין מחירון לספק הזה. הוסיפו שורה חופשית.** | SHORTEN · ✅ renders orders/new/wizard.tsx:995 | concept.noPriceList | — |
| `orders.wizard.fixLines` · `orders/he.ts:223` | יש שורות עם כמות 0 או בלי תיאור — תקנו לפני ההמשך. → **תקנו שורות עם כמות 0 או בלי תיאור.** | SHORTEN · ✅ renders orders/new/wizard.tsx:1152 | — | — |
| `orders.wizard.checkingBaseline` · `orders/he.ts:225` | בודק מול בסיס המחירים… → **בודקים מחירים…** | SHORTEN *term* · ✅ renders orders/new/wizard.tsx:1260 | — | — |
| `orders.wizard.guardrailGated` · `orders/he.ts:226` | מגן הדליפה בזמן הזמנה זמין בחבילה מתקדמת. → **בדיקת מחירים בזמן הזמנה — בחבילה מתקדמת.** | SHORTEN *term* · ✅ renders orders/new/wizard.tsx:1263 | — | — |
| `orders.wizard.aboveP90` · `orders/he.ts:227` | יקר במיוחד — מעל 90% מהמחירים האחרונים אצל הספק → **יקר במיוחד לעומת מחירי העבר** | SHORTEN · ✅ renders orders/new/wizard.tsx:1200 | concept.p90 | — |
| `orders.wizard.aboveMedian` · `orders/he.ts:228` | יקר ב-{pct} מהמחיר הרגיל אצל הספק → **{pct} מעל המחיר הרגיל** | SHORTEN · ✅ renders orders/new/wizard.tsx:1201 | concept.usualPrice | — |
| `orders.wizard.channelNone` · `orders/he.ts:234` | ללא שליחה (סימון כנשלחה) → **ללא שליחה · רישום בלבד** | MERGE · ✅ renders orders/new/wizard.tsx:1293 | concept.recordOnly | — |
| `orders.wizard.draftSaved` · `orders/he.ts:236` | הטיוטה נשמרה. השליחה נכשלה — אפשר לנסות שוב או לפתוח את הטיוטה. → **השליחה נכשלה. הטיוטה שמורה.** | SHORTEN · ✅ renders orders/new/wizard.tsx:1348 | — | — |
| `orders.wizard.markedBody` · `orders/he.ts:242` | לא נשלח דבר לספק. ההזמנה עדיין תוצלב מול החשבונית כשתגיע. → **לא נשלח דבר לספק. החשבונית תיבדק מול ההזמנה.** | SHORTEN · ✅ renders orders/new/wizard.tsx:1371 | concept.recordOnly | — |
| `orders.wizard.missedCutoff` · `orders/he.ts:247` | עבר המועד האחרון להזמנה להיום — המשלוח הקרוב ביותר הוא {date}. → **עבר המועד להיום · האספקה הקרובה: {date}** *(was: עבר המועד להיום · אספקה קרובה: {date})* | SHORTEN · ❌ **fixed**: "אספקה קרובה" is not idiomatic; "האספקה הקרובה" = the next delivery | concept.deliveryDate | — |
| `orders.wizard.noSchedule` · `orders/he.ts:249` | לספק אין לוח הזמנות — בחרו את תאריך האספקה. → **בחרו תאריך אספקה.** | SHORTEN · ✅ renders orders/new/wizard.tsx:1656 | concept.deliveryDate | e2e/W1-11.spec.ts, e2e/orders-wizard-delivery.spec.ts |

## P · Order from WhatsApp `/dashboard/orders/capture`
Visible words now → after P → after W2: orders-capture · owner 1440: **118 → 114 → 103** (expl. 26) · orders-capture · manager 390: **57 → 53 → 42** (expl. 26) · order-capture · manager 390: **57 → 53 → 43** (expl. 26)
Batch P on this screen: 5 keys, 49 → 32 explanatory words (−17).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `ingest.orderCapture.textHint` · `ingest/he.ts:107` | כמות, יחידה ושם הפריט בכל שורה. מחיר — אם כתבתם. → **בכל שורה: כמות, יחידה ופריט.** | SHORTEN · ✅ renders orders/capture/capture-client.tsx:248 | — | — |
| `ingest.orderCapture.noLines` · `ingest/he.ts:110` | לא מצאנו בהודעה שורות הזמנה (כמות + פריט). נסו להדביק את ההודעה המלאה. → **לא מצאנו שורות הזמנה. הדביקו את ההודעה המלאה.** | SHORTEN · ✅ renders orders/capture/capture-client.tsx:50 | — | — |
| `ingest.orderCapture.pickSupplierHint` · `ingest/he.ts:112` | לא זיהינו את הספק מההודעה. בחרו אותו פעם אחת. → **לא זיהינו את הספק — בחרו אותו.** | SHORTEN · ✅ renders orders/capture/capture-client.tsx:187 | — | — |
| `ingest.orderCapture.noSuppliers` · `ingest/he.ts:113` | אין עדיין ספקים. הוסיפו ספק ואז חזרו לכאן. → **עוד אין ספקים פעילים. הוסיפו ספק קודם.** | SHORTEN · ✅ renders orders/capture/capture-client.tsx:190 | — | — |
| `ingest.orderCapture.draftHint` · `ingest/he.ts:117` | בדקו שהשורות נכונות ואשרו. לא נשלח דבר לספק — ההזמנה כבר אצלו. → **בדקו ואשרו · לא נשלח דבר לספק** | SHORTEN · ✅ renders orders/capture/capture-client.tsx:121 | concept.noAutoSend | — |

## P · Order page `/dashboard/orders/<poId>`
Visible words now → after P → after W2: order-detail-open · owner 1440: **309 → 309 → 276** (expl. 58) · order-detail-open · manager 390: **250 → 250 → 217** (expl. 58) · order-detail-closed · owner 1440: **183 → 183 → 150** (expl. 48) · order-detail · owner 1440: **226 → 226 → 200** (expl. 47) · order-detail · manager 390: **167 → 167 → 141** (expl. 47) · +3 more captures in Appendix A
Batch P on this screen: 4 keys, 32 → 17 explanatory words (−15).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `orders.detail.loadErrorBody` · `orders/he.ts:136` | ייתכן שהחיבור נקטע. ההזמנה לא נפגעה. → **ההזמנה לא נפגעה.** | SHORTEN · ✅ renders orders/error.tsx:25 | — | — |
| `orders.detail.subtitle` · `orders/he.ts:138` | טיוטה — עוד לא נשלחה לספק. אפשר לערוך, לשלוח או לבטל. → **עוד לא נשלחה לספק.** | SHORTEN · ✅ renders orders/[poId]/page.tsx:57 | — | — |
| `orders.detail.channels.none` · `orders/he.ts:150` | ללא שליחה (סימון כנשלחה) → **ללא שליחה · רישום בלבד** | SHORTEN · ✅ renders orders/[poId]/detail-client.tsx:359 | concept.recordOnly | — |
| `orders.detail.lastLine` · `orders/he.ts:176` | זו השורה האחרונה — אי אפשר לשלוח הזמנה ריקה. בטלו את ההזמנה במקום. → **שורה אחרונה — בטלו את ההזמנה במקום.** | SHORTEN · ✅ renders orders/[poId]/detail-client.tsx:122 | — | — |

## P · Suppliers `/dashboard/suppliers` (+ card tabs, ledger)
Visible words now → after P → after W2: suppliers-open · owner 1440: **321 → 311 → 279** (expl. 51) · suppliers-open · manager 390: **267 → 257 → 225** (expl. 51) · supplier-details · owner 1440: **167 → 155 → 135** (expl. 44) · supplier-details · manager 390: **112 → 100 → 80** (expl. 44) · suppliers-ledger · owner 1440: **233 → 233 → 217** (expl. 32) · +16 more captures in Appendix A
Batch P on this screen: 14 keys, 142 → 76 explanatory words (−66) *(verified 31.10; was "14 keys, 142 → 75 explanatory words (−67)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `contracts.list.emptyBody` · `contracts/he.ts:49` | הוסיפו מחיר שסיכמתם עם ספק, או ייבאו מחירון חוזה — וכל חיוב מעליו יסומן בחשבונית. → **כל חיוב מעל מחיר החוזה יסומן בחשבונית.** | SHORTEN · ✅ renders contracts/contracts-panel.tsx:191 | concept.overContract | — |
| `suppliers.scores.emptyBody` · `suppliers/he.ts:15` | הדוח מתבסס על השוואות (match runs) מהזמן האחרון. ברגע שייכנסו קבלות וחשבוניות, הספקים יופיעו כאן. → **הדירוג יופיע אחרי החשבוניות הראשונות.** | SHORTEN · ✅ renders suppliers/page.tsx:36 | — | — |
| `suppliers.manager.emptyBody` · `suppliers/he.ts:32` | הוסיפו את הספקים שאתם מזמינים מהם — אחר כך תוכלו לטעון את הקטלוג שלהם ולבצע הזמנות. → **הוסיפו את הספקים שאתם מזמינים מהם.** | SHORTEN · ✅ renders suppliers/manager.tsx:151 | concept.noSuppliers | — |
| `suppliers.form.nameEn` · `suppliers/he.ts:55` | שם באנגלית (לצוות שלא קורא עברית) → **שם באנגלית** | SHORTEN · ✅ renders suppliers/manager.tsx:325 | concept.englishName | — |
| `suppliers.form.deliveryTitle` · `suppliers/he.ts:63` | לוח אספקה — ימים ושעת יעד → **לוח אספקה — ימים ושעת הגעה אחרונה** *(was: לוח אספקה — ימים ושעה אחרונה)* | SHORTEN *term* · ❌ **fixed**: no "יעד"; "שעה אחרונה" collides with the order cutoff "שעה אחרונה להזמנה" on the same supplier card | concept.lateDelivery | — |
| `suppliers.form.deliveryHint` · `suppliers/he.ts:64` | שעת היעד = עד מתי הסחורה אמורה להגיע. אם השעה תעבור ולא נקלטה תעודת קבלה — תופיע התראת איחור. → **אם עד שעת ההגעה לא נקלטה קבלת סחורה, תופיע התראת איחור.** *(was: אם עד השעה האחרונה לא נקלטה קבלת סחורה, תופיע התראת איחור.)* | FOLD *interim* *term* · ❌ **fixed**: "עד השעה האחרונה" also reads "up to the past hour"; interim, W2-11 folds it | concept.lateDelivery | — |
| `suppliers.detail.leakLabel` · `suppliers/he.ts:86` | שולם מעל המחיר החציוני (30 יום) → **מחירים שעלו · 30 יום** | SHORTEN *term* · ✅ renders suppliers/[id]/layout.tsx:98 | concept.creep | — |
| `suppliers.catalogTab.emptyBody` · `suppliers/he.ts:101` | ייבאו את מחירון הספק מקובץ Excel/CSV כדי לבנות הזמנות ולהצליב חשבוניות מולו. → **ייבאו את מחירון הספק מ-Excel או CSV.** | SHORTEN · ✅ renders suppliers/[id]/tab-catalog.tsx:38 | concept.noPriceList | — |
| `suppliers.ordersTab.emptyBody` · `suppliers/he.ts:107` | צרו את ההזמנה הראשונה מתוך מחירון הספק — והיא תוצלב אוטומטית מול החשבונית שתתקבל. → **צרו את ההזמנה הראשונה לספק.** | SHORTEN · ✅ renders suppliers/[id]/tab-orders.tsx:34 | concept.threeWayMatch | — |
| `suppliers.schedule.emptyBody` · `suppliers/he.ts:113` | הגדירו אילו ימים אפשר להזמין, עד איזו שעה, וכמה ימים לוקח המשלוח — וההזמנות יקבלו תאריך אספקה אוטומטי. → **הגדירו מתי מזמינים — ותאריך האספקה יחושב לבד.** | SHORTEN · ✅ renders suppliers/[id]/tab-schedule.tsx:134 | concept.deliveryDate | — |
| `suppliers.schedule.pickCutoff` · `suppliers/he.ts:127` | יש להגדיר שעת סגירה להזמנה (HH:MM). → **הזינו שעה אחרונה להזמנה.** | SHORTEN · ✅ renders suppliers/[id]/tab-schedule.tsx:249 | — | — |
| `suppliers.schedule.clearedPending` · `suppliers/he.ts:133` | כל החלונות הוסרו. שמרו כדי למחוק את לוח ההזמנות. → **שמרו כדי למחוק את לוח ההזמנות.** | SHORTEN · ✅ renders suppliers/[id]/tab-schedule.tsx:134 | — | — |
| `suppliers.leakCard.lines` · `suppliers/he.ts:140` | {count} שורות חריגה → **{count} שורות עם פער** | SHORTEN *term* · ✅ renders suppliers/[id]/leak-card-view.tsx:84 | — | — |
| `suppliers.leakCard.topTypes` · `suppliers/he.ts:142` | שלושת סוגי החריגה הגדולים → **שלושת סוגי הפער הגדולים** | SHORTEN *term* · ✅ renders suppliers/[id]/leak-card-view.tsx:119 | — | — |

## P · Contracts `/dashboard/contracts` (+ import)
Visible words now → after P → after W2: contracts-thresholds · owner 1440: **192 → 192 → 161** (expl. 43) · contracts · bookkeeper 1440: **295 → 286 → 272** (expl. 31) · contracts · owner 1440: **318 → 314 → 300** (expl. 24) · contracts-open · owner 1440: **373 → 369 → 355** (expl. 34) · contracts · manager 390: **263 → 259 → 245** (expl. 24) · +5 more captures in Appendix A
Batch P on this screen: 8 keys, 95 → 55 explanatory words (−40) *(verified 31.10; was "8 keys, 95 → 52 explanatory words (−43)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `contracts.readOnly` · `contracts/he.ts:10` | צפייה בלבד — רק בעלים ומנהלים יכולים לערוך. → **צפייה בלבד** | SHORTEN · ✅ renders contracts/thresholds-panel.tsx:269 | concept.readOnly | — |
| `contracts.import.subtitle` · `contracts/he.ts:82` | העלו קובץ CSV או XLSX עם מחירי החוזה — כל שורה תותאם למוצר בקטלוג לפי מק״ט או שם. → **העלו קובץ CSV או XLSX עם מחירי החוזה.** | SHORTEN · ✅ renders contracts/import/wizard.tsx:173 | — | — |
| `contracts.import.errors.TOO_LARGE` · `contracts/he.ts:137` | הקובץ גדול מדי. פצלו אותו לכמה קבצים או שמרו כ-CSV. → **הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV.** | MERGE · ✅ renders contracts/import/wizard.tsx:100 | concept.fileLimits | — |
| `contracts.import.errors.LEGACY_XLS` · `contracts/he.ts:139` | זה קובץ Excel ישן (‎.xls). פתחו אותו ב-Excel ושמרו בשם כ-‎.xlsx או CSV, ונסו שוב. → **קובץ ‎.xls ישן. שמרו אותו כ-‎.xlsx או CSV.** | MERGE · ✅ renders contracts/import/wizard.tsx:109 | concept.fileLimits | — |
| `contracts.import.errors.UNREADABLE` · `contracts/he.ts:140` | לא הצלחנו לקרוא את הקובץ. ודאו שזה גיליון Excel ‏(.xlsx) או CSV תקין. → **הקובץ לא נקרא. העלו ‎.xlsx או CSV תקין.** | MERGE · ✅ renders contracts/import/wizard.tsx:100 | concept.fileLimits | — |
| `contracts.import.errors.EMPTY` · `contracts/he.ts:141` | לא נמצאה שורת כותרות בקובץ. השורה הראשונה צריכה להכיל את שמות העמודות. → **חסרה שורת כותרות בשורה הראשונה.** | MERGE · ✅ renders contracts/import/wizard.tsx:100 | concept.fileLimits | — |
| `contracts.over.subtitle` · `contracts/he.ts:148` | שורות חשבונית שחויבו מעל מחיר החוזה שהיה בתוקף ביום החשבונית. → **לפי החוזה שהיה בתוקף ביום החשבונית.** | SHORTEN · ✅ renders contracts/over-contract.tsx:108 | concept.overContract | — |
| `contracts.over.emptyBody` · `contracts/he.ts:163` | ב-90 הימים האחרונים כל השורות חויבו במחיר החוזה או מתחתיו. → **ב־90 הימים האחרונים הכל חויב במחיר החוזה או מתחתיו.** *(was: הכל חויב במחיר החוזה או מתחתיו.)* | SHORTEN · ❌ **fixed**: keeps the 90-day window (the query is windowed); T3 calm | concept.clean | — |

## P · Catalog `/dashboard/catalog` (+ import, SKU mapping)
Visible words now → after P → after W2: catalog-import-open · owner 1440: **210 → 194 → 188** (expl. 52) · catalog-import-open · manager 390: **152 → 136 → 130** (expl. 52) · catalog-mapping · owner 1440: **119 → 119 → 98** (expl. 27) · catalog · owner 1440: **673 → 673 → 654** (expl. 24) · catalog · manager 390: **958 → 958 → 939** (expl. 24) · +4 more captures in Appendix A
Batch P on this screen: 15 keys, 169 → 96 explanatory words (−73) *(verified 31.10; was "16 keys, 180 → 93 explanatory words (−87)")*.

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `catalog.import.subtitle` · `catalog/he.ts:98` | טענו מחירון ספק מקובץ Excel או CSV — המערכת תזהה את העמודות ותמזג למוצרים קיימים. → **טענו מחירון ספק מ-Excel או CSV.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:366 | — | — |
| `catalog.import.noSuppliers` · `catalog/he.ts:110` | עוד אין ספקים. הוסיפו את הספק של המחירון כדי להמשיך: → **עוד אין ספקים. הוסיפו את ספק המחירון:** | SHORTEN · ✅ renders catalog/import/wizard.tsx:390 | concept.noSuppliers | — |
| `catalog.import.formats` · `catalog/he.ts:114` | נתמך: Excel ‏(.xlsx) ו-CSV (כולל קבצי עברית בקידוד Windows). עד 9MB. → **Excel או CSV, גם בעברית · עד 9MB** | SHORTEN · ✅ renders catalog/import/wizard.tsx:495 | concept.fileLimits | — |
| `catalog.import.vat.hint` · `catalog/he.ts:137` | מחירים שכוללים מע״מ יישמרו ללא מע״מ, לפי שיעור המע״מ של המסעדה ({rate}). → **מחירים כולל מע״מ יישמרו בלי מע״מ ({rate}).** | SHORTEN · ✅ renders catalog/import/wizard.tsx:587 | concept.vatBasis | — |
| `catalog.import.check.flaggedSummary` · `catalog/he.ts:151` | {count} מחירים רחוקים מאוד מהמחירון הנוכחי. בדקו אותם לפני הייבוא. → **{count} מחירים רחוקים מהמחירון — בדקו לפני הייבוא.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:735 | — | — |
| `catalog.import.check.heldHint` · `catalog/he.ts:156` | תקנו את התא בקובץ (למשל 1,250 או 12.90) וייבאו שוב. שאר השורות ייובאו. → **תקנו בקובץ (למשל 12.90) וייבאו שוב. השאר ייובאו.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:845 | — | — |
| `catalog.import.progress.leave` · `catalog/he.ts:163` | אפשר לעזוב את המסך. הייבוא ימשיך, והתוצאה תופיע בהיסטוריית הייבוא. → **אפשר לעזוב — הייבוא ימשיך ברקע.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:896 | concept.background | — |
| `catalog.import.review.noSuggestion` · `catalog/he.ts:170` | אין הצעה. בחרו מוצר קיים או צרו מוצר חדש. → **אין הצעה.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:1055 | — | — |
| `catalog.import.review.laterHint` · `catalog/he.ts:193` | השורות שמורות בלי קישור. אפשר לחזור אליהן מהיסטוריית הייבוא בכרטיס הספק. → **אפשר לחזור לזה מהיסטוריית הייבוא בכרטיס הספק.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:978 | concept.unlinkedRows | — |
| `catalog.import.errors.TOO_LARGE` · `catalog/he.ts:210` | הקובץ גדול מדי. פצלו אותו לכמה קבצים או שמרו כ-CSV. → **הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:187 (`import.errors.${key}`) | concept.fileLimits | — |
| `catalog.import.errors.LEGACY_XLS` · `catalog/he.ts:212` | זה קובץ Excel ישן (‎.xls). פתחו אותו ב-Excel ושמרו בשם כ-‎.xlsx או CSV, ונסו שוב. → **קובץ ‎.xls ישן. שמרו אותו כ-‎.xlsx או CSV.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:212 | concept.fileLimits | — |
| `catalog.import.errors.UNREADABLE` · `catalog/he.ts:213` | לא הצלחנו לקרוא את הקובץ. ודאו שזה גיליון Excel ‏(.xlsx) או CSV תקין. → **הקובץ לא נקרא. העלו ‎.xlsx או CSV תקין.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:187 | concept.fileLimits | — |
| `catalog.import.errors.EMPTY` · `catalog/he.ts:214` | לא נמצאה שורת כותרות בקובץ. השורה הראשונה צריכה להכיל את שמות העמודות. → **חסרה שורת כותרות בשורה הראשונה.** | SHORTEN · ✅ renders catalog/import/wizard.tsx:187 | concept.fileLimits | — |
| `catalog.import.errors.NO_ROWS` · `catalog/he.ts:215` | אין שורות עם שם מוצר בעמודה שנבחרה. בדקו את המיפוי. → **אין שמות מוצרים בעמודה שנבחרה. בדקו את המיפוי.** *(was: אין שמות מוצרים בעמודה שנבחרה.)* | SHORTEN · ❌ **fixed**: an error keeps what to do | concept.importMapping | — |
| `catalog.import.errors.FLAGGED_PRICES` · `catalog/he.ts:217` | יש בקובץ מחירים רחוקים מאוד מהמחירון הנוכחי. בדקו אותם וסמנו שאפשר לייבא. → **סמנו שבדקתם את המחירים המסומנים.** | MERGE · ✅ renders catalog/import/wizard.tsx:187 | — | — |

## P · Team `/dashboard/team`
Visible words now → after P → after W2: team · owner 1440: **227 → 221 → 194** (expl. 46) · team · manager 390: **114 → 96 → 83** (expl. 43)
Batch P on this screen: 1 keys, 16 → 4 explanatory words (−12).

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `team.managerNote` · `team/he.ts:8` | כמנהל/ת אפשר לראות את הצוות ולקבוע לכל עובד את שפת האפליקציה. הזמנות ותפקידים — בידי הבעלים. → **הזמנות ותפקידים — לבעלים בלבד.** | SHORTEN · ✅ renders team/team-client.tsx:166 | concept.readOnly | — |

## P · Removed from Batch P by the 31.10 verification

Moved to W2 (rows now sit in their W2 area table): `approvals.why.sourceP90` (W2-04), `catalog.import.queued` (W2-16b), `recovery.hero.returnedHint` (W2-10). Dropped, the current value stays:

| key · file:line | current → proposal (he) | verdict | concept | testRefs |
|---|---|---|---|---|
| `receivingDelivery.delivery.confirmed.bulkNote` · `receiving/delivery.he.ts:99` | {count} שורות סומנו כמו בהזמנה — לא נספרו פריט-פריט → **{count} שורות לא נספרו פריט-פריט** | SHORTEN · ❌ **dropped → KEEP**: loses "סומנו כמו בהזמנה" (the lines were recorded at the ordered qty): T4 note turns into a bare negative; saves 3 words → KEEP current value | concept.bulkNotCounted | e2e/W1-06.spec.ts, lib/__tests__/receiver-langs.test.ts (overlay placeholders = he; passes) |

---

# Batch W2 · W2-16 (mechanism) + area packages (adoption)

Long values are truncated with "…"; the full text is in the inventory JSONs (same key).

Everything not in Batch P: all FOLD rows (they need `<Explain>`), cuts that need the component to stop rendering a line, server prose that becomes an appCode + UI key, key merges (one key read by two screens), and every row off the ציקטי week-1 path. Each area package adopts its own rows in its own PR (MECHANISM §6.4–6.5); W2-16b adopts the unowned areas. Proposals are the auditors' wording, reconciled where two areas disagreed; shared concepts point to `shared-explanations.he.draft.ts`.

## W2 · Home `/dashboard` (owner · manager · chef · receiver homes)
Visible words now → after P → after W2: home · owner 1440: **357 → 351 → 313** (expl. 86) · home · manager 390: **246 → 244 → 206** (expl. 73) · home-receiver · receiver 390: **122 → 113 → 110** (expl. 20) · home-chef · chef 390: **71 → 64 → 61** (expl. 24)
W2 on this screen: 20 keys, 143 → 57 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `components.entitlement.compactBody` · `components/he.ts:29` | התכונה הזו זמינה במסלולים בתשלום. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-13 | — | — |
| `components.activity.awaitingDeliveryNotes` · `components/he.ts:50` | ממתינה להתאמה מול תעודות המשלוח של השבוע → ממתינה לתעודות המשלוח של השבוע | SHORTEN · kept out of P: consolidatedMatch is off for ציקטי; ops-components.test.ts pins he + en · W2-13 · ✅ kept out of P correctly (ops-components.test.ts pins he + en) | concept.consolidated | lib/components/__tests__/ops-components.test.ts |
| `components.activity.awaitingMonthlyMatch` · `components/he.ts:57` | ממתינה להתאמה מול תעודות המשלוח של החודש → ממתינה לתעודות המשלוח של החודש | SHORTEN · kept out of P: same · W2-13 | concept.consolidated | lib/components/__tests__/ops-components.test.ts |
| `overview.homeSubtitle.owner` · `overview/he.ts:20` | קודם מה דורש החלטה, אחר כך הדליפה של החודש. → — | CUT · dead key: delete after grep · W2-08 | — | — |
| `overview.homeSubtitle.manager` · `overview/he.ts:21` | אישורים, הזמנות ומשלוחים — לפי מה שדחוף. → — | CUT · stop rendering (component) · W2-08 | — | — |
| `overview.homeSubtitle.bookkeeper` · `overview/he.ts:22` | מה פתוח לפני סגירת החודש. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-08 | — | — |
| `overview.homeSubtitle.chef` · `overview/he.ts:23` | ספירה, ומנות שעברו את יעד עלות המזון. *(P interim: ספירה ועלות מנות.)* → — | CUT · fold/cut; Batch P set an interim value; stop rendering (component); not on the ציקטי week-1 path · W2-08 | — | — |
| `overview.homeSubtitle.receiver` · `overview/he.ts:24` | המשאית הבאה למעלה, אחריה כל השאר. → — | CUT · stop rendering (component) · W2-08 | — | lib/__tests__/receiver-langs.test.ts |
| `overview.hero.pending` · `overview/he.ts:51` | {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — כנראה חשבוניות מרכזות. הן לא נספרות בדליפה ולא בהוצאה. *(P interim: {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — לרוב מרכזות. עד השיוך הן לא בהוצאה.)* → גלוי: «{count} חשבוניות ({amount}) ממתינות לשיוך להזמנה» · מתג: «למה?» · מקופל: explain.pendingLink = «לרוב חשבונית מרכזת שמחכה לשיוך. עד השיוך הסכום שלה לא נכנס להוצאה שנבדקה.» *(was: גלוי: «{count} חשבוניות ({amount}) ממתינות לשיוך להזמנה» · מתג: «למה?» · מקופל: «לרוב חשבונית מרכזת. עד השיוך היא לא נכנסת להוצאה שנבדקה.»)* | FOLD · fold/cut; Batch P set an interim value; fold (`<Explain>`) · W2-08 · ❌ **fixed**: the fold must quote explain.pendingLink verbatim (draft), not a third wording | concept.pendingLink | — |
| `overview.hero.delta.noneYoy` · `overview/he.ts:67` | אין חשבוניות באותם ימים בשנה שעברה להשוואה → אין נתוני השוואה | MERGE · not on the ציקטי week-1 path · W2-08 | concept.noCompare | — |
| `overview.hero.returnedHint` · `overview/he.ts:71` | זיכויים שהתקבלו החודש, גם על חודשים קודמים → זיכויים שהתקבלו החודש, מכל חודש | SHORTEN · kept out of P: saves 2 words, wording gets vaguer · W2-08 · ✅ source matches; renders home/finance.tsx:611 | concept.returned | — |
| `overview.activity.subtitle` · `overview/he.ts:183` | מה קרה במערכת לאחרונה. → — | CUT · stop rendering (component) · W2-08 | — | — |
| `recipes.alert.crossed` · `recipes/he.ts:211` | חצתה את יעד עלות המזון ({target}) → מעל עלות המזון הרצויה ({target}) | SHORTEN · not on the ציקטי week-1 path · W2-16b · ✅ removes "יעד"; owner 31.10 decided "עלות מזון רצויה" | concept.foodCostThreshold | — |
| `recipes.overviewCard.subtitle` · `recipes/he.ts:218` | עליות מחיר אצל הספקים מכרסמות ברווח לצלחת → — | CUT · stop rendering (component) · W2-16b | — | — |
| `recipes.overviewCard.empty` · `recipes/he.ts:221` | עוד אין מנות במערכת — הוסיפו מנה כדי לראות כמה כל צלחת עולה. → עוד אין מנות. הוסיפו מנה ראשונה. | SHORTEN · kept out of P: recipes is off for ציקטי · W2-16b | — | — |
| `vat.card.subtitle` · `vat/he.ts:8` | חשבונית מס מעל {threshold} לפני מע״מ בלי מספר הקצאה — אי אפשר לקזז את המע״מ שלה. יש 6 חודשים מתאריך החשבונית לקבל חשבונית מתוקנת. → גלוי: «בלי מספר הקצאה — אי אפשר לקזז את המע״מ.» · מתג: «למה?» · מקופל: explain.vatAllocation = «חשבונית מס מעל הסף חייבת מספר הקצאה. יש 6 חודשים לקבל חשבונית מתוקנת.» *(was: גלוי: «בלי מספר הקצאה — אי אפשר לקזז את המע״מ.» · מתג: «למה?» · מקופל: «חשבונית מס מעל {threshold} לפני מע״מ חייבת מספר הקצאה. יש 6 חודשים לקבל חשבונית מתוקנת.»)* | FOLD · fold (`<Explain>`) · W2-16b · ❌ **fixed**: fold bodies carry no ₪ (MECHANISM §3.4): {threshold} is formatIls (vat-at-risk.tsx:50); use the draft explain.vatAllocation | concept.allocation | — |
| `vat.card.separate` · `vat/he.ts:13` | נפרד מהדליפה — זה מע״מ, לא פער מול הספק. → לא חלק מהדליפה | MERGE · kept out of P: vatAtRisk is off for ציקטי · W2-16b · ✅ = explain.notInLeak | concept.notLeak | — |
| `vat.card.clearHint` · `vat/he.ts:16` | נבדקו חשבוניות המס שעדיין אפשר לקזז (6 החודשים האחרונים). → נבדקו 6 החודשים האחרונים. | SHORTEN · kept out of P: vatAtRisk is off · W2-16b | concept.vatWindow | — |
| `vat.request.hint` · `vat/he.ts:27` | העתיקו ושלחו לספק בוואטסאפ או במייל. המערכת לא שולחת דבר. → העתיקו ושלחו לספק. המערכת לא שולחת דבר. | SHORTEN · kept out of P: vatAtRisk is off · W2-16b | concept.notSent | — |
| `views.trend.subtitle` · `views/he.ts:107` | דליפה לפי {bucket} בתקופה שנבחרה → דליפה לפי {bucket} | SHORTEN · not on the ציקטי week-1 path · W2-09 | — | — |

## W2 · Shell on every dashboard page (worker banner, offline, re-auth, 403/404/error)
Visible words now → after P → after W2: reauth · manager 390: **394 → 379 → 239** (expl. 277) · more-sheet · manager 390: **420 → 414 → 275** (expl. 249) · search · manager 390: **365 → 359 → 220** (expl. 249) · offline · manager 390: **366 → 360 → 221** (expl. 254) · reauth · owner 1440: **436 → 421 → 297** (expl. 253) · +15 more captures in Appendix A
W2 on this screen: 17 keys, 87 → 63 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `inline:global-error` · `apps/web/app/global-error.tsx:77` | נתקלנו בתקלה בלתי צפויה. נסו לטעון מחדש את העמוד. → נסו שוב. אם זה חוזר, רעננו את העמוד או חזרו מאוחר יותר. *(was: נסו שוב. אם זה חוזר, שלחו לנו את הקוד.)* | MERGE · server code → appCode + UI key · G-11 · ❌ **fixed**: global-error.tsx:79 shows the code only when error.digest exists; same wording as the corrected common.errorPage.body | concept.errorRetry | — |
| `auth.serverErrors.quotaExceeded` · `auth/he.ts:187` | חרגתם ממכסת הסריקות החודשית ({limit}). שדרגו את המנוי כדי להמשיך. → הגעתם למכסת הסריקות החודשית ({limit}). שדרגו כדי להמשיך. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.entitlement | lib/__tests__/serverErrors.test.ts, api/__tests__/app-error-codes.test.ts |
| `auth.serverErrors.entitlementRequired` · `auth/he.ts:188` | הפיצ׳ר הזה אינו כלול בתוכנית שלכם. שדרגו את המנוי כדי להשתמש בו. → לא כלול בתוכנית שלכם. שדרגו כדי להשתמש. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.entitlement | — |
| `auth.serverErrors.forbidden` · `auth/he.ts:189` | אין לכם הרשאה לפעולה הזו. → אין לכם הרשאה לפעולה הזו. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.forbidden | lib/__tests__/serverErrors.test.ts |
| `auth.serverErrors.invalidInput` · `auth/he.ts:191` | אחד הערכים שהוזנו אינו תקין. → חלק מהשדות אינם תקינים. בדקו ונסו שוב. | MERGE · kept out of P: auth.serverErrors values double as a Hebrew lookup table (serverErrors.ts:53); needs the server prose change in the same PR → W2 · W2-16b | concept.invalidInput | lib/__tests__/serverErrors.test.ts |
| `auth.serverErrors.generic` · `auth/he.ts:193` | הפעולה נכשלה. נסו שוב. → הפעולה נכשלה. נסו שוב. | MERGE · kept out of P: same lookup-table trap · W2-16b | concept.genericFail | lib/__tests__/serverErrors.test.ts |
| `common.shell.offline.back` · `common/he.ts:73` | החיבור חזר → — | CUT · dead key: delete after grep · W2-13 | — | lib/__tests__/receiver-langs.test.ts |
| `common.shell.offline.action` · `common/he.ts:74` | אין חיבור — הפעולה לא נשלחה. נסו שוב כשהרשת תחזור. → — | CUT · dead key: delete after grep · W2-13 · ✅ dead (no t() use); it is in the receiver overlay slice: delete it from ar/ru/th/ti in the same commit (W2-05) or receiver-langs.test fails | concept.offline | lib/__tests__/receiver-langs.test.ts |
| `common.shell.session.otherUserLink` · `common/he.ts:92` | לא אתם? כניסה כמשתמש אחר → כניסה עם משתמש אחר | SHORTEN · kept out of P: saves 1 word · W2-13 | concept.switchUser | lib/__tests__/receiver-langs.test.ts |
| `common.shell.session.done` · `common/he.ts:94` | התחברתם שוב. ממשיכים מאיפה שעצרתם. → — | CUT · dead key: delete after grep · W2-13 · ✅ dead; same overlay note | concept.sessionExpired | lib/__tests__/receiver-langs.test.ts |
| `common.shell.forbidden.openIn` · `common/he.ts:108` | פתחו ב־{branch} ({role}) → — | CUT · dead key: delete after grep · W2-13 | concept.forbidden | lib/__tests__/receiver-langs.test.ts |
| `common.shell.notFound.otherBranch` · `common/he.ts:121` | אם הקישור הגיע מסניף אחר, החליפו סניף מהבורר שבראש העמוד. → — | CUT · dead key: delete after grep · W2-13 | concept.notFound | lib/__tests__/receiver-langs.test.ts |
| `common.shell.branch.openedParent` · `common/he.ts:137` | עברתם ל־{branch} · פתחנו את {screen}, כי הפריט שייך לסניף הקודם. → עברתם ל־{branch} · פתחנו את {screen}. | SHORTEN · not on the ציקטי week-1 path · W2-13 | concept.branchSwitch | e2e/W1-04.spec.ts |
| `common.shell.branch.openedHome` · `common/he.ts:138` | עברתם ל־{branch} · המסך ‘{screen}’ לא פתוח לתפקיד שלכם שם, אז פתחנו את הבית. → עברתם ל־{branch} · ‘{screen}’ סגור לכם שם, פתחנו את הבית. | SHORTEN · not on the ציקטי week-1 path · W2-13 · ✅ same meaning, plural address | concept.branchSwitch | — |
| `components.errors.network` · `components/he.ts:15` | אין חיבור לשרת. בדקו את החיבור ונסו שוב. → אין חיבור לרשת. בדקו את החיבור ונסו שוב. | MERGE · kept out of P: no saving; W1-08 holds components/he.ts · W2-13 · ✅ kept out of P correctly (W1-08 holds components) | concept.offline | app/dashboard/receiving/[poId]/__tests__/poll-errors.test.ts, lib/__tests__/receiver-langs.test.ts, lib/components/__tests__/ops-components.test.ts, lib/net/__tests__/resilience.test.ts |
| `nav.worker.lastBeat` · `nav/he.ts:128` | פעימה אחרונה לפני {minutes} דק׳. → — | CUT · stop rendering (component) · W2-08 | concept.workerDown | lib/__tests__/receiver-langs.test.ts |
| `nav.worker.ownerNotified` · `nav/he.ts:129` | הבעלים קיבל התראה. *(P interim: אין צורך לפעול.)* → — | CUT · fold/cut; Batch P set an interim value; stop rendering (component) · W2-08 | concept.workerDown | lib/__tests__/receiver-langs.test.ts |

## W2 · Sign-in family `/login` `/reset` `/set-password` `/invite/accept` `/onboarding`
Visible words now → after P → after W2: login-invited · anon 390: **56 → 49 → 39** (expl. 28) · login · anon 1440: **47 → 45 → 35** (expl. 19) · login · anon 390: **47 → 45 → 35** (expl. 19) · login-consent · anon 1440: **60 → 58 → 48** (expl. 26) · login-consent · anon 390: **60 → 58 → 48** (expl. 26) · +11 more captures in Appendix A
W2 on this screen: 17 keys, 128 → 90 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `auth.login.subtitle` · `auth/he.ts:9` | התחברו עם הסיסמה, או קבלו קישור כניסה למייל (בלי סיסמה). → — | CUT · stop rendering (component) · W2-16b · ✅ the page shows both ways in (password form + "שלחו לי קישור כניסה למייל") | concept.magicLink | lib/__tests__/receiver-langs.test.ts |
| `auth.login.errors.rate` · `auth/he.ts:26` | יותר מדי ניסיונות. נסו שוב מאוחר יותר. → יותר מדי ניסיונות. המתינו רגע ונסו שוב. | MERGE · kept out of P: no saving; becomes a key merge in W2 · W2-16b | concept.rateLimit | lib/__tests__/receiver-langs.test.ts |
| `auth.twoFactor.subtitle` · `auth/he.ts:39` | הזינו את הקוד בן 6 הספרות מאפליקציית האימות, או קוד שחזור חד-פעמי. → הזינו את הקוד מאפליקציית האימות. | SHORTEN · not on the ציקטי week-1 path · W2-16b · ✅ the recovery-code way stays reachable: login/2fa/page.tsx:111 "אין גישה לאפליקציה? הזינו קוד שחזור" | concept.twoFactor | lib/__tests__/receiver-langs.test.ts |
| `auth.reset.sent` · `auth/he.ts:48` | אם הכתובת רשומה אצלנו, שלחנו אליה קישור לאיפוס סיסמה. בדקו את תיבת הדואר. → — | CUT · dead key: delete after grep · W2-16b | concept.linkExpired | — |
| `auth.reset.mismatch` · `auth/he.ts:54` | הסיסמאות אינן תואמות. → הסיסמאות אינן תואמות. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.passwordPolicy | — |
| `auth.reset.policy` · `auth/he.ts:55` | הסיסמה חייבת להכיל לפחות {min} תווים. → הסיסמה חייבת להכיל לפחות {min} תווים. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.passwordPolicy | — |
| `auth.setPassword.subtitleSet` · `auth/he.ts:65` | בחרו סיסמה כדי להתחבר בלי קישור במייל בפעם הבאה. → כדי להיכנס בלי קישור במייל. | SHORTEN · not on the ציקטי week-1 path · W2-16b · ✅ reads as the tail of the h1 "הגדרת סיסמה" | concept.magicLink | — |
| `auth.setPassword.subtitleChange` · `auth/he.ts:66` | הזינו את הסיסמה הנוכחית ובחרו חדשה. שאר המכשירים יתנתקו. → שאר המכשירים יתנתקו. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.devicesSignOut | — |
| `auth.setPassword.errors.generic` · `auth/he.ts:79` | אירעה שגיאה. נסו שוב. → הפעולה נכשלה. נסו שוב. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.genericFail | lib/components/__tests__/ops-components.test.ts |
| `auth.invite.genericError` · `auth/he.ts:85` | אירעה שגיאה בקבלת ההזמנה. → נסו שוב, או בקשו הזמנה חדשה. | SHORTEN · kept out of P: grows the string; W2 · W2-16b | concept.invite | — |
| `auth.signin.queuedOne` · `auth/he.ts:115` | צילום חשבונית אחד ממתין במכשיר · יישלח כשמי שצילם אותו ייכנס → צילום חשבונית אחד ממתין · יישלח כשמי שצילם ייכנס | SHORTEN · kept out of P: W1-09.spec.ts:89 pins "צילום חשבונית אחד ממתין במכשיר"; saves 2 words · W2-16b · ✅ kept out of P correctly (W1-09.spec.ts:89 pin) | concept.savedOnPhone | e2e/W1-09.spec.ts, lib/__tests__/receiver-langs.test.ts |
| `auth.signin.queuedMany` · `auth/he.ts:116` | {count} צילומי חשבונית ממתינים במכשיר · יישלחו כשמי שצילם אותם ייכנס → {count} צילומי חשבונית ממתינים · יישלחו כשמי שצילם ייכנס | SHORTEN · kept out of P: pair of queuedOne · W2-16b | concept.savedOnPhone | lib/__tests__/receiver-langs.test.ts |
| `auth.recovery.subtitle` · `auth/he.ts:138` | הזינו אחד מקודי השחזור ששמרתם בזמן ההפעלה. כל קוד עובד פעם אחת. → הזינו קוד שחזור ששמרתם. כל קוד עובד פעם אחת. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.recoveryCodes | — |
| `auth.serverErrors.inviteWrongEmail` · `auth/he.ts:179` | ההזמנה נשלחה לכתובת מייל אחרת. התחברו עם הכתובת שאליה נשלחה ההזמנה. → ההזמנה נשלחה למייל אחר. התחברו עם הכתובת שקיבלה אותה. | SHORTEN · kept out of P (low value for week 1) · W2-16b | concept.invite | — |
| `onboarding.subtitle` · `onboarding/he.ts:7` | תחילה — ניצור את המסעדה שלכם. תיכנסו אוטומטית כבעלים. → ניצור את המסעדה, ואתם תהיו הבעלים. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `onboarding.businessIdHint` · `onboarding/he.ts:15` | 9–12 ספרות. אפשר להקליד גם עם מקפים. → 9–12 ספרות, אפשר עם מקפים. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `server:onboarding.accountGone` · `packages/api/src/routers/onboarding.ts:49` | החשבון שלך כבר לא קיים. התנתק והתחבר מחדש כדי להמשיך. → החשבון כבר לא קיים. התנתקו והתחברו מחדש כדי להמשיך. | MERGE · server code → appCode + UI key; not on the ציקטי week-1 path · W2-16b | concept.sessionExpired | — |

## W2 · Receiving board `/dashboard/receiving` (+ read-only receipt)
Visible words now → after P → after W2: inbox · receiver 390: **124 → 115 → 107** (expl. 23) · inbox · manager 390: **124 → 115 → 107** (expl. 23) · receipt-view · receiver 390: **65 → 63 → 54** (expl. 13) · receipt-view · manager 390: **65 → 63 → 54** (expl. 13)
W2 on this screen: 2 keys, 9 → 0 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `receiving.inbox.subtitle` · `receiving/he.ts:8` | המשלוחים של היום. בחרו ספק כדי לבדוק מה הגיע. → — | CUT · stop rendering (component) · W2-05 | — | — |
| `server:receiving.startReceipt CONFLICT (reopen)` · `packages/api/src/routers/receiving.ts:769` | רק קבלה חלקית נפתחת להשלמה — הקבלה הזאת נסגרה → appCode receipt_closed → UI key receivingDelivery.delivery.summary.title: "קבלת הסחורה כבר נסגרה" *(was: appCode receipt_closed → UI key: "הקבלה כבר נסגרה")* | SHORTEN · dead key: delete after grep · W2-05 · ❌ **fixed**: bare "קבלה" for goods (binding term); one wording = draft receiptClosed. Needs is "server code → appCode + UI key", not "dead key" | concept.receiptClosed | — |

## W2 · Delivery Check `/dashboard/receiving/<poId>` (scan → review → count → confirm)
Visible words now → after P → after W2: review-slip · manager 390: **254 → 217 → 210** (expl. 98) · confirmed · manager 390: **178 → 160 → 146** (expl. 58) · review-slip · receiver 390: **216 → 190 → 187** (expl. 68) · review-mismatch · receiver 390: **169 → 149 → 149** (expl. 28) · review-mismatch · manager 390: **167 → 147 → 147** (expl. 28) · +45 more captures in Appendix A
W2 on this screen: 19 keys, 86 → 39 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `dockPrice.usual` · `dockPrice/he.ts:3` | המחיר הרגיל שלך: → מחיר רגיל: | SHORTEN · kept out of P: dockPriceContext is never on for ציקטי · W2-05 | concept.usualPrice | — |
| `dockPrice.title` · `dockPrice/he.ts:5` | החציון של מה ששילמת לספק הזה על הפריט ב-{days} הימים האחרונים ({count} חשבוניות) → toggle "איך חישבנו?" → folded: "החציון של מה ששילמתם לספק על הפריט ב־{days} הימים האחרונים ({count} חשבוניות)." | FOLD · fold (`<Explain>`) · W2-05 · ✅ manager-only (prices); fold body has no ₪ placeholder | concept.usualPrice | — |
| `ingest.pwa.offlineBody` · `ingest/he.ts:90` | אפשר להמשיך לצלם. התמונות נשמרות בטלפון ויעלו לבד כשהחיבור יחזור. → — | CUT · dead key: delete after grep · W2-02 catalog · W2-05 screen | concept.savedOnPhone | — |
| `ingest.pwa.savedOffline` · `ingest/he.ts:96` | התמונה נשמרה בטלפון ותעלה כשהחיבור יחזור → — | CUT · stop rendering (component) · W2-02 catalog · W2-05 screen | concept.savedOnPhone | — |
| `ingest.pwa.installHint` · `ingest/he.ts:98` | קיצור דרך למסך הבית — נפתח ישר לקבלת סחורה. → — | CUT · dead key: delete after grep · W2-02 catalog · W2-05 screen | — | — |
| `receiverLangs.picker.hint` · `receiverLangs/he.ts:11` | שפות למקבלי סחורה: ערבית, רוסית, תאילנדית, תיגרינית. מסכים אחרים יוצגו באנגלית. → — | CUT · dead key: delete after grep · W2-05 | — | — |
| `receiverLangs.lines.machine` · `receiverLangs/he.ts:15` | תרגום אוטומטי — בדקו מול החשבונית → — | CUT · dead key: delete after grep · W2-05 | — | — |
| `receiverLangs.lines.untranslated` · `receiverLangs/he.ts:16` | אין תרגום — מוצג בשפת המקור → — | CUT · dead key: delete after grep · W2-05 | — | — |
| `receivingDelivery.delivery.count.unorderedNeeds` · `receiving/delivery.he.ts:82` | סמנו אם הפריטים שלא הוזמנו הגיעו → — | CUT · dead key: delete after grep · W2-05 | — | — |
| `receivingDelivery.delivery.summary.subtitleNoTime` · `receiving/delivery.he.ts:104` | אלה הכמויות שנרשמו. → — | CUT · stop rendering (component) · W2-05 | concept.receiptClosed | — |
| `receivingDelivery.delivery.leave.body` · `receiving/delivery.he.ts:116` | {count} שורות עוד לא נשלחו לשרת. הן שמורות בטלפון ויישלחו כשתחזרו לכאן. → {count} שורות שמורות בטלפון ויישלחו כשתחזרו לכאן | SHORTEN · confirmation (keep ₪ + supplier) · W2-05 · ✅ still says the lines are unsent and where they are | concept.savedOnPhone | — |
| `receivingDelivery.logoutGuard.body` · `receiving/delivery.he.ts:124` | אין חיבור כרגע. אפשר לחכות לחיבור, או להתנתק ולהשאיר אותם בטלפון — הם יעלו כשתתחברו שוב. → אין חיבור. הצילומים יעלו כשתתחברו שוב. | SHORTEN · confirmation (keep ₪ + supplier) · W2-05 · ✅ the two choices are the dialog buttons | concept.savedOnPhone | — |
| `receiving.inbox.emptyDescription` · `receiving/he.ts:10` | הזמנות עם תאריך אספקה היום יופיעו כאן. כשספק מגיע, פתחו קבלה וסמנו מה הגיע. → — | CUT · dead key: delete after grep · W2-05 | — | — |
| `receiving.steps.scan.network` · `receiving/he.ts:57` | אין חיבור לרשת. בדקו את החיבור ונסו שוב. → use receiving.errors.network (delete this key) | MERGE · component change · W2-05 | concept.network | — |
| `receiving.steps.processing.subtitleLive` · `receiving/he.ts:64` | אפשר להמשיך מול ההזמנה בכל רגע — החשבונית תושלם ברקע. → — | CUT · stop rendering (component) · W2-05 | concept.continueWithOrder | — |
| `receiving.steps.recon.potentialLossHint` · `receiving/he.ts:90` | הסכום ייקבע אחרי הבדיקה. → — | CUT · dead key: delete after grep · W2-05 | concept.amountLater | — |
| `receiving.dockSlip.quantitiesOnly` · `receiving/he.ts:176` | כמויות בלבד → — | CUT · stop rendering (component) · W2-05 | concept.amountLater | — |
| `server:receiving.startReceipt CONFLICT (po closed)` · `packages/api/src/routers/receiving.ts:812` | ההזמנה בוטלה או נסגרה — אי אפשר לפתוח עליה קבלה → appCode po_closed → UI key: "ההזמנה בוטלה או נסגרה" | SHORTEN · server code → appCode + UI key; component change · W2-05 | — | — |
| `server:receiving.markGrLine CONFLICT (closed)` · `packages/api/src/routers/receiving.ts:924` | הקבלה כבר נסגרה — אי אפשר לשנות את הספירה → appCode receipt_closed → UI key receivingDelivery.delivery.summary.title: "קבלת הסחורה כבר נסגרה" *(was: appCode receipt_closed → UI key: "הקבלה כבר נסגרה")* | SHORTEN · server code → appCode + UI key; component change · W2-05 · ❌ **fixed**: bare "קבלה" for goods (binding term); one wording = draft receiptClosed | concept.receiptClosed | — |

## W2 · Approvals `/dashboard/approvals`
Visible words now → after P → after W2: approvals (open) · owner 1440: **407 → 405 → 387** (expl. 33) · approvals · owner 1440: **305 → 305 → 290** (expl. 19) · approvals (open) · bookkeeper 1440: **80 → 75 → 75** (expl. 10) · approvals · bookkeeper 1440: **74 → 71 → 71** (expl. 6) · approvals (open) · manager 390: **158 → 156 → 156** (expl. 4) · +1 more captures in Appendix A
W2 on this screen: 24 keys, 96 → 18 explanatory words after Batch P (rendered strings) *(+ `approvals.why.sourceP90`, moved from P 31.10)*.

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `approvals.empty.description` · `approvals/he.ts:11` | אין פערים שמחכים להחלטה שלך. → — | CUT · dead key: delete after grep · W2-04 · ❌ **fixed**: not dead: list.tsx:977 still reads it as the filtered fallback (`filteredNote ?? t('empty.description')`); "delete after grep" breaks typecheck. Needs: drop the fallback (component), W2-04 | — | — |
| `approvals.summary.split` · `approvals/he.ts:22` | {decide} להחלטה (₪) · {review} לבדיקה (ללא ₪) → {decide} להחלטה · {review} לבדיקה | SHORTEN · kept out of P: pinned by queue-summary.test.ts + approvals-router.test.ts; saves 1 word · W2-04 · ✅ kept out of P correctly (queue-summary.test.ts + approvals-router.test.ts) | — | — |
| `approvals.summary.vat` · `approvals/he.ts:26` | + {amount} בהפרשי מע״מ (סכום המע״מ עצמו) → + {amount} בהפרשי מע״מ (סכום המע״מ) | SHORTEN · kept out of P: saves 1 word · W2-04 | concept.vatBasis | — |
| `approvals.card.error` · `approvals/he.ts:94` | ההחלטה לא נשמרה. נסו שוב. → ההחלטה לא נשמרה. | SHORTEN · kept out of P: the proposal drops "נסו שוב" (an error must say what to do) · W2-04 | — | — |
| `approvals.types.UNORDERED_ITEM.explain` · `approvals/he.ts:162` | שורה בחשבונית שאין לה שורה מקבילה בהזמנה. → — | CUT · stop rendering (component) · W2-04 | — | — |
| `approvals.types.UNORDERED_ARRIVAL.explain` · `approvals/he.ts:174` | לא נמצאה הזמנה תואמת — לרוב חשבונית ריכוז או חשבונית שהגיעה מחוץ לחלון התאריכים. לא נספר כדליפה עד שיוך. → גלוי (WhyLine): «לא נמצאה הזמנה תואמת. לא נספר בדליפה עד השיוך.» · מתג: «למה?» ליד "שייך להזמנה" · מקופל: explain.pendingLink = «לרוב חשבונית מרכזת שמחכה לשיוך. עד השיוך הסכום שלה לא נכנס להוצאה שנבדקה.» *(was: גלוי (WhyLine): «לא נמצאה הזמנה תואמת.» · מתג: «למה?» ליד "שייך להזמנה" · מקופל: explain.pendingNotCounted = «לרוב אלה חשבוניות מרכזות. עד השיוך הן לא נספרות בדליפה ובהוצ…)* | MERGE · component change · W2-04 · ❌ **fixed**: points at the withdrawn explain.pendingNotCounted, whose "לא נספרות בדליפה" is the false clause this package removes; current text also says "חשבונית ריכוז" | concept.pendingLink | — |
| `approvals.types.TOTAL_MISMATCH.explain` · `approvals/he.ts:191` | סכום השורות שונה מהסה״כ המופיע בחשבונית. → — | CUT · stop rendering (component) · W2-04 | — | — |
| `approvals.tolerance.duplicate` · `approvals/he.ts:197` | מספר חשבונית ייחודי לכל ספק → — | CUT · stop rendering (component) · W2-04 · ✅ same WhyLine-exception note; applies to tolerance.poRequired/unit/billedOverReceived/missingLine/unorderedLine too | concept.ruleAsThreshold | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.tolerance.poRequired` · `approvals/he.ts:199` | לכל חשבונית חייבת להיות הזמנה → — | CUT · stop rendering (component) · W2-04 | concept.ruleAsThreshold | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.tolerance.unit` · `approvals/he.ts:200` | יחידת המידה חייבת להתאים בין ההזמנה לחשבונית → — | CUT · stop rendering (component) · W2-04 | concept.ruleAsThreshold | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.tolerance.billedOverReceived` · `approvals/he.ts:201` | הכמות שחויבה עולה על הכמות שהתקבלה → — | CUT · stop rendering (component) · W2-04 | concept.ruleAsThreshold | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.tolerance.missingLine` · `approvals/he.ts:202` | כל שורת הזמנה חייבת להופיע בחשבונית → — | CUT · stop rendering (component) · W2-04 | concept.ruleAsThreshold | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.tolerance.unorderedLine` · `approvals/he.ts:203` | כל שורת חשבונית חייבת להתאים לשורת הזמנה → — | CUT · stop rendering (component) · W2-04 | concept.ruleAsThreshold | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.tolerance.p90` · `approvals/he.ts:206` | מעל אחוזון 90 ההיסטורי ({amount}) → — | CUT · stop rendering (component) · W2-04 · ✅ needs an explicit exception to MECHANISM §1 ("WhyLine: never fold or cut") in W2-04's PR; vocab.test.ts:292 + :20-37 change with it (listed) | concept.p90 | app/dashboard/approvals/__tests__/vocab.test.ts |
| `approvals.rules.duplicate-invoice` · `approvals/he.ts:209` | חשבונית כפולה — סומנה: לא לשלם עד החלטה (הנהלת חשבונות) → — | CUT · dead key: delete after grep · W2-04 · ✅ dead only because ruleLabel() (approvals/vocab.ts:30) has no caller; delete ruleLabel in the same PR (applies to all 8 approvals.rules.* rows) | concept.routing | — |
| `approvals.rules.large-invoice-without-po` · `approvals/he.ts:210` | חשבונית גדולה ללא הזמנה — אישור בעלים → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `approvals.rules.unordered-item-significant` · `approvals/he.ts:211` | פריט משמעותי שלא הוזמן — אישור בעלים → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `approvals.rules.severity-block` · `approvals/he.ts:212` | חומרה גבוהה — אישור בעלים → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `approvals.rules.cumulative-large` · `approvals/he.ts:213` | הפרש מצטבר גבוה בחשבונית — בעלים → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `approvals.rules.cumulative-medium` · `approvals/he.ts:214` | הפרש מצטבר בינוני בחשבונית — מנהל → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `approvals.rules.minor-info` · `approvals/he.ts:215` | הפרש זניח — אושר אוטומטית → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `approvals.rules.fallback` · `approvals/he.ts:216` | ברירת מחדל — מנהל → — | CUT · dead key: delete after grep · W2-04 | concept.routing | — |
| `views.toolbar.noSaved` · `views/he.ts:28` | עדיין אין תצוגות שמורות בדפדפן הזה. → אין תצוגות שמורות | SHORTEN · kept out of P: dashViews is off for ציקטי · W2-09 | — | — |
| `approvals.why.sourceP90` · `approvals/he.ts:110` | (אחוזון 90 של מחירי הספק, לא מחיר הזמנה) → (לפי מחירי העבר של הספק) | SHORTEN · moved from Batch P (31.10 verification): WhyLine evidence + vocab.test.ts:221/:295 pin it, a test edit is not values-only · W2-04 | concept.p90 | app/dashboard/approvals/__tests__/vocab.test.ts |

## W2 · Invoice page `/dashboard/invoices/[id]` (+ `/scans`)
Visible words now → after P → after W2: invoice-vat · bookkeeper 1440: **151 → 142 → 115** (expl. 51) · invoice · bookkeeper 1440: **138 → 129 → 105** (expl. 35) · invoice-consolidated · owner 1440: **325 → 316 → 296** (expl. 42) · invoice-consolidated · manager 390: **244 → 235 → 215** (expl. 42) · invoice-consolidated · bookkeeper 1440: **300 → 291 → 271** (expl. 42) · +5 more captures in Appendix A
W2 on this screen: 10 keys, 103 → 44 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `consolidated.subtitle` · `consolidated/he.ts:3` | חשבונית הריכוז מול תעודות המשלוח של הספק בתקופה {period} → חשבונית מרכזת · {period} | SHORTEN · not on the ציקטי week-1 path · W2-02 | concept.consolidated | — |
| `consolidated.proposalNote` · `consolidated/he.ts:5` | לקריאה בלבד: החשבונית עדיין ממתינה לשיוך, ולא נספרת בדליפה או בהוצאה. → «צפייה בלבד» (explain.viewOnly) · מתג: «למה?» · מקופל: explain.pendingLink = «לרוב חשבונית מרכזת שמחכה לשיוך. עד השיוך הסכום שלה לא נכנס להוצאה שנבדקה.» *(was: לא נספרת בדליפה ובהוצאה עד השיוך.)* | SHORTEN · not on the ציקטי week-1 path · W2-02 · ❌ **fixed**: draft lists it under explain.viewOnly ("לקריאה בלבד" prefix) + explain.pendingLink; "לא נספרת בדליפה" is the withdrawn claim | concept.pendingLink | — |
| `consolidated.referenceNote` · `consolidated/he.ts:7` | לקריאה בלבד: החשבונית כבר טופלה — ההצלבה מוצגת לעיון. → החשבונית כבר טופלה. | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `consolidated.status.differencesBody` · `consolidated/he.ts:12` | החשבונית גבוהה ב-{amount} ממה שנמסר במחירי ההזמנה. → KEEP (current value) *(was: יותר ממה שנמסר במחירי ההזמנה.)* | SHORTEN · not on the ציקטי week-1 path · W2-02 · ❌ **fixed**: drops {amount}, the only ₪ figure of the card (the title "פערים מול תעודות המשלוח" has none): a lost number | — | — |
| `consolidated.status.differencesBodyLines` · `consolidated/he.ts:13` | פערים בשורות שחויבו מול תעודות המשלוח שלהן. תעודות שלא חויבו בחשבונית הזו אינן נספרות. → פערים בשורות שחויבו. תעודות שלא חויבו כאן לא נספרות. | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `consolidated.status.noneBody` · `consolidated/he.ts:15` | כשיתקבלו משלוחים מהספק בחודש החשבונית, הם יוצלבו כאן. → משלוחים חדשים יוצלבו כאן. | SHORTEN · not on the ציקטי week-1 path · W2-02 | concept.consolidated | — |
| `invoices.correction.rerunHint` · `invoices/he.ts:32` | אחרי תיקון שורות או סכומים — הריצו "התאמה מחדש" כדי לחשב מחדש את החריגות ואת מספר הדליפה. → — | CUT · stop rendering (component) · W2-02 · ✅ the "התאמה מחדש" button says it; also removes "החריגות" | concept.rerunMatch | — |
| `scans.notLoading` · `scans/he.ts:10` | לא נטען? יכול להיות חוסם פופאפים או דפדפן ללא תוסף PDF. → לא נטען? | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `vat.invoice.deadline` · `vat/he.ts:36` | בערך עד {date} אפשר עוד לנכות את המע״מ, אם תתקבל חשבונית מתוקנת. → אפשר לנכות עד {date} בערך, עם חשבונית מתוקנת. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.vatWindow | — |
| `vat.invoice.closed` · `vat/he.ts:37` | חלון הניכוי (6 חודשים מתאריך החשבונית) נסגר בערך ב-{date}. → חלון הניכוי נסגר בערך ב-{date}. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.vatWindow | — |

## W2 · Leak hub `/dashboard/leaks` (+ `#prices`)
Visible words now → after P → after W2: leaks · owner 1440: **374 → 368 → 313** (expl. 97) · leaks · manager 390: **149 → 137 → 131** (expl. 38)
W2 on this screen: 7 keys, 88 → 24 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `components.entitlement.body` · `components/he.ts:32` | {feature} זמינה במסלולים בתשלום. שדרגו את החשבון כדי לקבל גישה מלאה. → {feature} זמינה במסלולים בתשלום. | SHORTEN · not on the ציקטי week-1 path · W2-13 | — | — |
| `leaks.detective.subtitle` · `leaks/he.ts:32` | מסומן כשהמחיר האחרון מעל האחוזון ה-90 של אותו ספק ו-5% ומעלה מעל החציון. העודף מחושב מול החציון × הכמות ששולמה ב-30 יום. זה מדד מגמה — לא חל… → גלוי: «מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה» · מתג: «איך חישבנו?» · מקופל: explain.creepHow = «מסומן כשהמחיר האחרון בין 10% הגבוהים אצל הספק, ולפחות 5% מעל המחיר הרגיל. העודף = (מחיר − מחיר רגיל) × כמות ב-30 יום.» *(was: גלוי: «מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה» · מתג: «איך מסמנים?» · מקופל: «מחיר אחרון מעל האחוזון ה-90 ו-5% מעל החציון. העודף = (מחיר − חציון) × כמות ששולמה ב-3…)* | FOLD · fold (`<Explain>`) · W2-09 · ❌ **fixed**: uses the statistics words the draft forbids on a working screen and a 4th toggle label ("איך מסמנים?"); one wording = explain.creepHow, toggle = "איך חישבנו?" | concept.creep | — |
| `leaks.detective.totalHint` · `leaks/he.ts:40` | סכום (מחיר − מחיר חציוני) × כמות ב-30 הימים האחרונים. נפרד מהדליפה החודשית. → — | CUT · stop rendering (component) · W2-09 | concept.creep | — |
| `leaks.detective.hotspotsHint` · `leaks/he.ts:42` | צמדי מוצר × ספק שחורגים מהגבול → — | CUT · stop rendering (component) · W2-09 | — | — |
| `views.delta.thinBase` · `views/he.ts:77` | בסיס ההשוואה דל מכדי לחשב אחוז → מעט מדי נתונים לאחוז | SHORTEN · kept out of P: dashViews is off · W2-09 | concept.thinBase | — |
| `views.explorer.subtitle` · `views/he.ts:90` | אותה דליפה, בכל חיתוך: לפי ספק, קטגוריה, מוצר או סוג פער — מול אותם ימים בתקופה הקודמת. → — | CUT · stop rendering (component) · W2-09 | — | — |
| `views.explorer.linesNote` · `views/he.ts:103` | סכום שורות הפער לפני תקרת החשבונית — עשוי לעלות מעט על הדליפה הכוללת. → סכום השורות גבוה ב-{amount} מהדליפה: היא מוגבלת לסכום כל חשבונית. | MERGE · new placeholder (component passes it) · W2-09 · ✅ ₪ placeholder stays on a visible line, not a fold | concept.cap | — |

## W2 · Leak breakdown `/dashboard/leaks/breakdown`
Visible words now → after P → after W2: leaks-breakdown · manager 390: **572 → 520 → 508** (expl. 102) · leaks-breakdown · owner 1440: **664 → 612 → 600** (expl. 102)
W2 on this screen: 2 keys, 20 → 4 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `leaks.breakdown.emptyDescription` · `leaks/he.ts:73` | כל החשבוניות שהותאמו בחודש זה תואמות להזמנות ולקבלות. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-09 | concept.clean | — |
| `leaks.breakdown.pendingHint` · `leaks/he.ts:81` | לא נמצאה הזמנה תואמת — לרוב חשבונית מרכזת. לא נספר כדליפה עד שיוך. → גלוי: «(כותרת הסעיף נשארת)» · מתג: «למה?» · מקופל: explain.pendingLink = «לרוב חשבונית מרכזת שמחכה לשיוך. עד השיוך הסכום שלה לא נכנס להוצאה שנבדקה.» *(was: גלוי: «(כותרת הסעיף נשארת)» · מתג: «למה?» · מקופל: «לרוב חשבונית מרכזת. עד השיוך היא לא נכנסת להוצאה שנבדקה.»)* | MERGE · component change · W2-09 · ❌ **fixed**: quote explain.pendingLink verbatim | concept.pendingLink | — |

## W2 · Leak proof `/dashboard/leaks/proof`
Visible words now → after P → after W2: leaks-proof · owner 1440: **340 → 304 → 260** (expl. 139)
W2 on this screen: 3 keys, 66 → 26 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `leakProof.capped` · `leakProof/he.ts:25` | הוגבל לסכום החשבונית → מוגבל לסכום החשבונית | MERGE · kept out of P: no saving · W2-09 | concept.cap | — |
| `leakProof.recovered` · `leakProof/he.ts:33` | {amount} — החלק מהדליפה שהצוות אישר כדרישה מהספק (ממצא שאושר או סומן "טופל"), לכל היותר עד סכום החשבונית. זה עוד לא כסף שנדרש במכתב. → גלוי: «עוד לא נשלח במכתב.» · מתג: «פרטים» · מקופל: «ממצאים שאושרו או סומנו "טופל", עד סכום כל חשבונית.» | FOLD · fold (`<Explain>`) · W2-09 · ✅ fold body has no ₪; the ₪ stays visible | concept.inLetter | — |
| `leakProof.rules` · `leakProof/he.ts:39` | נספרים פערים ברמת אזהרה או חסימה. לא נספרים: פערים בתוך הסבולת, "מחיר נמוך מהמצופה" (הספק גבה פחות) ו"ממתינה לשיוך להזמנה". "פריט בחשבונית ל… → גלוי: explain.leakRule = «נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה", "ממתינה לשיוך להזמנה" ו"שורת הזמנה לא חויבה".» · מתג: «פרטים» · מקופל: leakProof.explain.rulesMore («פריט בחשבונית ללא הזמנה כן נספר…») *(was: גלוי: «נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה".» · מתג: «פרטים» · מקופל: «פריט בחשבונית ללא הזמנה כן נספר…)* | MERGE · component change · W2-09 · ❌ **fixed**: must read explain.leakRule verbatim, else the proof page omits "שורת הזמנה לא חויבה" while the hero (W2) lists it | concept.leakRule | — |

## W2 · Monthly leak report `/dashboard/leaks/report` + `/dashboard/reports/*`
Visible words now → after P → after W2: reports-digest · owner 1440: **175 → 175 → 158** (expl. 32) · leaks-report · manager 390: **230 → 230 → 218** (expl. 66) · leaks-report · owner 1440: **297 → 297 → 285** (expl. 66) · reports-monthly · manager 390: **133 → 133 → 127** (expl. 17) · reports-monthly · owner 1440: **188 → 188 → 182** (expl. 17)
W2 on this screen: 15 keys, 160 → 97 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `leaks.states.cleanHint` · `leaks/he.ts:27` | כל החשבוניות שנבדקו תואמות להזמנות ולמה שהתקבל. → — | CUT · stop rendering (component) · W2-09 | concept.clean | — |
| `leaks.report.roleOnly` · `leaks/he.ts:190` | הדוח החודשי זמין לבעלים ולמנהלים. אפשר לבקש גישה מבעלי המסעדה. → הדוח החודשי — לבעלים ולמנהלים בלבד. | SHORTEN · not on the ציקטי week-1 path · W2-09 | concept.roleOnly | — |
| `leaks.report.pending` · `leaks/he.ts:196` | {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה ואינן כלולות. → {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — לא בהוצאה שנבדקה. | MERGE · not on the ציקטי week-1 path · W2-09 · ✅ consistent with explain.pendingLink | concept.pendingLink | — |
| `leaks.report.partition` · `leaks/he.ts:206` | ממתין להחלטה + אושר לדרישה + ויתרנו = נמצא, עד האגורה. → שלושתם יחד = נמצא, עד האגורה. | SHORTEN · not on the ציקטי week-1 path · W2-09 | — | — |
| `leaks.report.capNoteShort` · `leaks/he.ts:207` | נמצא גבוה ב-{amount} מהדליפה: הדליפה בכל חשבונית מוגבלת לסכום החשבונית. → סכום השורות גבוה ב-{amount} מהדליפה: היא מוגבלת לסכום כל חשבונית. | MERGE · not on the ציקטי week-1 path · W2-09 | concept.cap | — |
| `leaks.report.creepHint` · `leaks/he.ts:212` | ממוצע המחיר החודש מול המחיר החציוני ב-90 הימים שלפניו. זה מדד מגמה, לא חלק מהדליפה. → ממוצע החודש מול החציון ב-90 הימים שלפניו · לא חלק מהדליפה | SHORTEN · not on the ציקטי week-1 path · W2-09 | concept.creep | — |
| `leaks.report.empty` · `leaks/he.ts:229` | אין דליפה בחודש זה · {count} חשבוניות נבדקו ✓ → אין דליפה · {count} חשבוניות נבדקו ✓ | MERGE · not on the ציקטי week-1 path · W2-09 | concept.clean | — |
| `leaks.report.capNote` · `leaks/he.ts:230` | סכומי השורות גבוהים ב-{amount} מהכותרת: הדליפה בכל חשבונית מוגבלת לסכום החשבונית. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-09 | concept.cap | — |
| `leaks.report.method` · `leaks/he.ts:231` | שיטה: פערים בחומרת אזהרה או חסימה מול הזמנות ותעודות משלוח, מוגבל לסכום כל חשבונית. לא כולל "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה". ההוצ… → שיטה: «נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה", "ממתינה לשיוך להזמנה" ו"שורת הזמנה לא חויבה".» (explain.leakRule) ההוצאה כוללת רק חשבוניות שנבדקו. *(was: שיטה: נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה". ההוצאה כוללת רק חשבוניות שנבדקו.)* | MERGE · not on the ציקטי week-1 path · W2-09 · ❌ **fixed**: same: one leak rule, explain.leakRule | concept.leakRule | — |
| `recovery.digest.outstanding` · `recovery/he.ts:14` | עדיין חייבים לך (על חשבוניות החודש) → עדיין חייבים לכם (על חשבוניות החודש) *(was: עדיין חייבים לך (על חשבוניות החודש))* | MERGE · not on the ציקטי week-1 path · W2-10 · ❌ **fixed**: "לך" breaks the plural address; the draft canonical recovery.report.outstanding says "לכם" | concept.outstanding | — |
| `recovery.report.subtitle` · `recovery/he.ts:178` | המספר האחד של החודש — נשלח אוטומטית ב-1 לחודש ב-07:45 לבעלים ולמנהלים. → נשלח ב-1 לחודש, 07:45, לבעלים ולמנהלים. | SHORTEN · not on the ציקטי week-1 path · W2-10 | — | — |
| `recovery.report.whatsappNote` · `recovery/he.ts:198` | ספק וואטסאפ במצב בדיקה (stub) — שום הודעה לא יוצאת עד הפעלה. → וואטסאפ עוד לא פעיל — לא נשלחות הודעות. | SHORTEN · not on the ציקטי week-1 path · W2-10 · ✅ English "stub" out | concept.notSent | — |
| `recovery.digest.subtitle` · `recovery/he.ts:214` | כך ייראה המייל שתקבל בתחילת החודש — שום דבר לא נשלח מהעמוד הזה → כך ייראה המייל בתחילת החודש. מכאן לא נשלח דבר. | SHORTEN · not on the ציקטי week-1 path · W2-10 | concept.notSent | — |
| `recovery.digest.note` · `recovery/he.ts:234` | השליחה עצמה עוברת רק דרך תור ההודעות ובאישור אדם. התצוגה כאן לא שולחת דבר. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-10 | concept.notSent | — |
| `api.reports.monthly.he.outstanding` · `packages/api/src/reports/monthly.ts:331` | עדיין חייבים לך (על חשבוניות החודש) → עדיין חייבים לכם (על חשבוניות החודש) *(was: עדיין חייבים לך (על חשבוניות החודש))* | MERGE · server code → appCode + UI key; not on the ציקטי week-1 path · unowned (W3-08) · ❌ **fixed**: same: "לכם" | concept.outstanding | — |

## W2 · Recovery tracker `/dashboard/recovery`
Visible words now → after P → after W2: recovery-credit · owner 1440: **1078 → 1068 → 1026** (expl. 68) · recovery-credit · manager 390: **967 → 957 → 915** (expl. 68) · recovery · owner 1440: **1029 → 1021 → 988** (expl. 52) · recovery · manager 390: **918 → 910 → 877** (expl. 52) · recovery-confirm-recovered · owner 1440: **1053 → 1045 → 1012** (expl. 67) · +3 more captures in Appendix A
W2 on this screen: 7 keys, 58 → 15 explanatory words after Batch P (rendered strings) *(+ dead `recovery.hero.returnedHint`, moved from P 31.10)*.

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `recovery.tracker.subtitle` · `recovery/he.ts:13` | כל פער שדרשת מהספק — ממכתב הדרישה ועד שהכסף חזר בפועל. → — | CUT · stop rendering (component) · W2-10 | — | — |
| `recovery.tracker.rateHint` · `recovery/he.ts:17` | זוכה ÷ נדרש → — | CUT · stop rendering (component) · W2-10 | concept.recoveryRate | — |
| `recovery.tracker.creditNoteHint` · `recovery/he.ts:57` | הגיעה תעודת זיכוי? רשמו אותה על הדרישות שהיא סוגרת. → — | CUT · stop rendering (component) · W2-10 · ✅ the "רשמו זיכוי" buttons under the header say it | — | — |
| `recovery.funnel.note` · `recovery/he.ts:79` | בשקלים שלמים, מעוגלים כך שהחלקים מסתכמים בדיוק בסך שנדרש. הסכום המדויק מופיע במעבר עכבר. → גלוי: — · מתג: «איך חישבנו?» ליד "מה קרה לכל שקל שנדרש" · מקופל: «השקלים מעוגלים כך שהחלקים מסתכמים בדיוק לסך שנדרש.» | FOLD · fold (`<Explain>`) · W2-10 · ✅ drops the false "hover" line (touch) | concept.wholeShekels | — |
| `recovery.creditForm.vatNote` · `recovery/he.ts:166` | כל הסכומים במעקב הם לפני מע״מ, כמו הדליפה בדשבורד. → — | CUT · stop rendering (component) · W2-10 | concept.exVat | — |
| `server:recovery.transition CONFLICT (cap full)` · `packages/api/src/recovery/service.ts:557` | nothing is left to claim on this invoice — other claims already cover its total → appCode claim_cap_full → מפתח UI recovery.errors.capFull = «כבר נדרש כל סכום החשבונית.» | SHORTEN · server code → appCode + UI key; component change · W2-10 | — | — |
| `recovery.hero.returnedHint` · `recovery/he.ts:174` | כסף שחזר החודש, על חשבוניות מכל חודש → — (remove key, he + en) | CUT · dead key: delete after grep (home renders overview.hero.returnedHint); moved from Batch P · W2-10 | concept.returned | — |

## W2 · Orders list `/dashboard/orders`
Visible words now → after P → after W2: orders-search-none · manager 390: **72 → 59 → 53** (expl. 28) · orders-filter-empty · owner 1440: **125 → 120 → 107** (expl. 23) · orders · owner 1440: **386 → 381 → 375** (expl. 16) · orders · manager 390: **521 → 516 → 510** (expl. 16) · orders · chef 390: **67 → 67 → 67** (expl. 0)
W2 on this screen: 4 keys, 37 → 19 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `orders.subtitle` · `orders/he.ts:7` | הזמינו מהספקים — וכל חשבונית תיבדק מול ההזמנה. → גלוי: אין שורת משנה · מתג «למה?» בכותרת (PageHeader explain) · מקופל: explain.threeWayMatch = «כל חשבונית נבדקת מול ההזמנה ומול קבלת הסחורה. בלי הזמנה אין מול מה לבדוק.» *(was: גלוי: אין שורת משנה · מתג «למה?» בכותרת (PageHeader explain) · מקופל: «כל חשבונית נבדקת מול ההזמנה ומול מה שהתקבל. בלי הזמנה אין מול מה לבדוק.» (explain.threeWayMatch))* | FOLD · fold (`<Explain>`) · W2-06 · ❌ **fixed**: quote explain.threeWayMatch verbatim ("מול קבלת הסחורה", not "מול מה שהתקבל") | concept.threeWayMatch | — |
| `orders.list.emptyFilteredBody` · `orders/he.ts:44` | נסו סינון אחר או צרו הזמנה חדשה. → — | CUT · stop rendering (component) · W2-06 | — | — |
| `orders.import.notConfigured` · `orders/he.ts:113` | ייבוא מסמכי הזמנה דורש חיבור ל-OCR (לא מוגדר בסביבה הזו). → ייבוא מסמכי הזמנה לא זמין כרגע. | SHORTEN · not on the ציקטי week-1 path · W2-06 | concept.fileLimits | — |
| `orders.import.badFile` · `orders/he.ts:114` | הקובץ ריק, גדול מדי או לא נתמך. העלו PDF או תמונה של ההזמנה. → הקובץ לא נקרא. העלו PDF או תמונה של ההזמנה. | SHORTEN · not on the ציקטי week-1 path · W2-06 | concept.fileLimits | — |

## W2 · New order `/dashboard/orders/new`
Visible words now → after P → after W2: orders-new-build-open · owner 1440: **195 → 190 → 175** (expl. 23) · orders-new-build-open · manager 390: **134 → 129 → 114** (expl. 23) · orders-new-build · owner 1440: **159 → 159 → 140** (expl. 19) · orders-new-build · manager 390: **98 → 98 → 79** (expl. 19) · orders-new · owner 1440: **126 → 126 → 119** (expl. 7) · +4 more captures in Appendix A
W2 on this screen: 15 keys, 97 → 42 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `orders.reorder.draftExistsBody` · `orders/he.ts:70` | לצרף את פריטי ההזמנה הקודמת לטיוטה, או להחליף את הטיוטה בהם? → מה לעשות עם הטיוטה הקיימת? | SHORTEN · confirmation (keep ₪ + supplier) · W2-06 | — | — |
| `orders.draft.resumeBody` · `orders/he.ts:79` | שמרנו אותה כטיוטה. אפשר להמשיך מאיפה שעצרתם. → — | CUT · stop rendering (component) · W2-06 | concept.savedOnPhone | — |
| `orders.draft.leaveConfirm` · `orders/he.ts:83` | ההזמנה עוד לא נשלחה. היא שמורה כטיוטה — לצאת בכל זאת? → ההזמנה נשמרה כטיוטה ולא נשלחה. לצאת? | SHORTEN · confirmation (keep ₪ + supplier) · W2-06 | concept.savedOnPhone | — |
| `orders.wizard.totalExcludes` · `orders/he.ts:127` | לא כולל {count} שורות ללא מחיר → לא כולל {count} שורות ללא מחיר | MERGE · kept out of P: key merge (W2) · W2-06 | concept.unpricedExcluded | — |
| `orders.wizard.totalExcludesOne` · `orders/he.ts:128` | לא כולל שורה אחת ללא מחיר → לא כולל שורה אחת ללא מחיר | MERGE · kept out of P: key merge (W2) · W2-06 | concept.unpricedExcluded | — |
| `orders.errors.noContact` · `orders/he.ts:189` | לספק אין {channel} מוגדר. הוסיפו אותו בפרטי הספק או בחרו ערוץ אחר. → לספק אין {channel} — בחרו ערוץ אחר. | SHORTEN · kept out of P: not on the record-only week-1 path · W2-06 | concept.recordOnly | — |
| `orders.errors.whatsappGated` · `orders/he.ts:190` | שליחת וואטסאפ זמינה בחבילה הכוללת התראות וואטסאפ. בחרו אימייל או שדרגו. → וואטסאפ לא כלול בחבילה. בחרו אימייל. | SHORTEN · kept out of P: not on the record-only week-1 path · W2-06 | — | — |
| `orders.wizard.subtitle` · `orders/he.ts:194` | בנו הזמנה מתוך קטלוג הספק והגישו אותה. → — | CUT · stop rendering (component) · W2-06 | — | — |
| `orders.wizard.browseHint` · `orders/he.ts:212` | הקלידו כדי לחפש, או בחרו מהפריטים הראשונים במחירון: → — | CUT · stop rendering (component) · W2-06 | — | — |
| `orders.wizard.emptyOrderBody` · `orders/he.ts:216` | הוסיפו פריטים מהקטלוג למעלה. → — | CUT · stop rendering (component) · W2-06 | — | — |
| `orders.wizard.sentBody` · `orders/he.ts:239` | אספקה: {date} · נעדכן בעמוד ההזמנה כשתצא, או אם השליחה תיכשל. → אספקה: {date} · נעדכן אם השליחה תיכשל. | SHORTEN · not on the ציקטי week-1 path · W2-06 | — | — |
| `orders.wizard.sentBodyNoDate` · `orders/he.ts:240` | נעדכן בעמוד ההזמנה כשתצא, או אם השליחה תיכשל. → נעדכן אם השליחה תיכשל. | SHORTEN · not on the ציקטי week-1 path · W2-06 | — | — |
| `orders.wizard.deliveryHint` · `orders/he.ts:248` | התאריך נגזר מלוח ההזמנות של הספק. אפשר לשנות אותו. → — | CUT · dead key: delete after grep · W2-06 | concept.deliveryDate | — |
| `orders.wizard.scheduleHint` · `orders/he.ts:251` | לפי לוח ההזמנות של הספק: {date}. → — | CUT · dead key: delete after grep · W2-06 | concept.deliveryDate | — |
| `orders.wizard.reasonNoSchedule` · `orders/he.ts:260` | לספק אין לוח הזמנות — בחרו יום אספקה. → — | CUT · dead key: delete after grep · W2-06 | concept.deliveryDate | — |

## W2 · Order from WhatsApp `/dashboard/orders/capture`
Visible words now → after P → after W2: orders-capture · owner 1440: **118 → 114 → 103** (expl. 26) · orders-capture · manager 390: **57 → 53 → 42** (expl. 26) · order-capture · manager 390: **57 → 53 → 43** (expl. 26)
W2 on this screen: 1 keys, 17 → 18 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `ingest.orderCapture.subtitle` · `ingest/he.ts:103` | הדביקו או שתפו את ההזמנה ששלחתם לספק — נהפוך אותה להזמנת רכש, כדי שנוכל לבדוק מולה את החשבונית. → visible: "הדביקו את ההזמנה ששלחתם לספק" + toggle "למה?" → folded: "נהפוך אותה להזמנת רכש, ונבדוק מולה את החשבונית כשתגיע." | FOLD · fold (`<Explain>`) · W2-02 catalog · W2-06 screen · ✅ action stays visible, why folds | concept.threeWayMatch | — |

## W2 · Order page `/dashboard/orders/<poId>`
Visible words now → after P → after W2: order-detail-open · owner 1440: **309 → 309 → 276** (expl. 58) · order-detail-open · manager 390: **250 → 250 → 217** (expl. 58) · order-detail-closed · owner 1440: **183 → 183 → 150** (expl. 48) · order-detail · owner 1440: **226 → 226 → 200** (expl. 47) · order-detail · manager 390: **167 → 167 → 141** (expl. 47) · +3 more captures in Appendix A
W2 on this screen: 15 keys, 121 → 62 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `orders.detail.notifyWhatsapp` · `orders/he.ts:132` | ייפתח וואטסאפ עם הודעת ביטול מוכנה לשליחה. → ייפתח וואטסאפ עם הודעה מוכנה. | SHORTEN · confirmation (keep ₪ + supplier) · W2-06 · ✅ no ₪ or supplier name is dropped; "ביטול" is the dialog context | — | — |
| `orders.detail.notifyEmail` · `orders/he.ts:133` | ייפתח מייל עם הודעת ביטול מוכנה לשליחה. → ייפתח מייל עם הודעה מוכנה. | SHORTEN · confirmation (keep ₪ + supplier) · W2-06 | — | — |
| `orders.detail.notifyNone` · `orders/he.ts:134` | לספק אין וואטסאפ או אימייל — עדכנו אותו בעצמכם. → עדכנו את הספק בעצמכם. | SHORTEN · confirmation (keep ₪ + supplier) · W2-06 | concept.recordOnly | — |
| `orders.detail.cancelSentWarning` · `orders/he.ts:159` | ההזמנה כבר נשלחה. ביטול כאן לא מודיע לספק — עדכנו אותו בעצמכם. → — | CUT · dead key: delete after grep · W2-06 | concept.recordOnly | — |
| `orders.document.toggleHint` · `orders/he.ts:279` | מסומן: הספק מקבל מק״ט, מחיר מוסכם וסה״כ (ובמייל גם PDF). לא מסומן: רק פריטים וכמויות. → מסומן: עם מק״ט ומחירים. לא מסומן: רק כמויות. | SHORTEN · not on the ציקטי week-1 path · W2-06 | — | — |
| `orders.document.previewBody` · `orders/he.ts:282` | ההזמנה כפי שתישלח: טקסט המייל (עם PDF מצורף) והודעת הוואטסאפ. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-06 | — | — |
| `orders.document.pricesHidden` · `orders/he.ts:288` | המחירים מוסתרים בהזמנות לספקים. אפשר לשנות זאת בהגדרה שבכרטיס הזה. → המחירים מוסתרים מהספק. | SHORTEN · not on the ציקטי week-1 path · W2-06 | — | — |
| `supplierConfirm.card.subtitle` · `supplierConfirm/he.ts:81` | שלחו לספק קישור (תקף 72 שעות) — הוא יאשר, יסמן חוסרים או יציע מחיר. ההזמנה לא משתנה. → שלחו לספק קישור לאישור, חוסרים או מחיר. | SHORTEN · not on the ציקטי week-1 path · G-10 | concept.poUnchanged | — |
| `supplierConfirm.card.notSent` · `supplierConfirm/he.ts:90` | אפשר לשלוח קישור לספק רק אחרי שההזמנה נשלחה. → זמין אחרי שליחת ההזמנה. — רק בטיוטה | SHORTEN · not on the ציקטי week-1 path · G-10 | — | — |
| `supplierConfirm.card.contractTagTitle` · `supplierConfirm/he.ts:100` | המחיר בהזמנה הוא מחיר החוזה → מחיר חוזה | SHORTEN · not on the ציקטי week-1 path · G-10 | concept.overContract | — |
| `supplierConfirm.card.poUnchanged` · `supplierConfirm/he.ts:103` | ההזמנה עצמה לא שונתה — אלו הבדלים לבדיקה. → ההזמנה לא שונתה — בדקו את ההבדלים. | SHORTEN · not on the ציקטי week-1 path · G-10 | concept.poUnchanged | — |
| `orders.server.importAlreadyClosed` · `packages/api/src/orders/importPo.ts:190` | ההזמנה הזו כבר נסגרה או בוטלה — לא ניתן לייבא אותה מחדש → ההזמנה כבר נסגרה או בוטלה — אי אפשר לייבא שוב. | SHORTEN · server code → appCode + UI key; not on the ציקטי week-1 path · W2-06 | — | — |
| `orders.server.importReceiving` · `packages/api/src/orders/importPo.ts:198` | כבר התחילה קבלה על ההזמנה הזו — לא ניתן לייבא אותה מחדש → כבר התחילה קבלה על ההזמנה — אי אפשר לייבא שוב. | SHORTEN · dead key: delete after grep · W2-06 | — | — |
| `orders.server.cancelConflict` · `packages/api/src/routers/orders.ts:782` | לא ניתן לבטל הזמנה שנסגרה, בוטלה או שכבר התחילה קבלה עליה → קוד במקום טקסט: order.notCancellable | CUT · server code → appCode + UI key; stop rendering (component); not on the ציקטי week-1 path · W2-06 · ✅ appCode keeps the 3 reasons out of prose | — | — |
| `SUPPLIER_CONFIRM_DOC_PREVIEW_HE` · `packages/api/src/supplierConfirm/documentExtension.ts:24` | קישור לאישור ההזמנה יצורף בשליחה (תקף 72 שעות). → יצורף קישור לאישור הספק (72 שעות). — רק בטיוטה | SHORTEN · server code → appCode + UI key; not on the ציקטי week-1 path · G-10 | concept.linkValidity | api/__tests__/order-document-confirm-link.db.test.ts |

## W2 · Suppliers `/dashboard/suppliers` (+ card tabs, ledger)
Visible words now → after P → after W2: suppliers-open · owner 1440: **321 → 311 → 279** (expl. 51) · suppliers-open · manager 390: **267 → 257 → 225** (expl. 51) · supplier-details · owner 1440: **167 → 155 → 135** (expl. 44) · supplier-details · manager 390: **112 → 100 → 80** (expl. 44) · suppliers-ledger · owner 1440: **233 → 233 → 217** (expl. 32) · +16 more captures in Appendix A
W2 on this screen: 9 keys, 82 → 26 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `suppliers.subtitle` · `suppliers/he.ts:7` | הקמת ספקים, פרטי קשר ותנאי תשלום — והדירוג שמראה מי מוסיף עלויות סמויות. → — | CUT · stop rendering (component) · W2-11 | — | — |
| `suppliers.form.nameEnHint` · `suppliers/he.ts:57` | מוצג במקום השם העברי כשהממשק באנגלית. לא משפיע על התאמות וייצוא. → מתג «למה?» ליד השדה · מקופל: «מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.» (explain.englishName) | MERGE · component change · W2-11 · ✅ = explain.englishName | concept.englishName | — |
| `suppliers.form.deliveryHint` · `suppliers/he.ts:64` | שעת היעד = עד מתי הסחורה אמורה להגיע. אם השעה תעבור ולא נקלטה תעודת קבלה — תופיע התראת איחור. *(P interim: אם עד השעה האחרונה לא נקלטה קבלת סחורה, תופיע התראת איחור.)* → גלוי: כותרת «לוח אספקה — ימים ושעת הגעה אחרונה» · מתג «למה?» · מקופל: suppliers.explain.lateAlert = «אם עד שעת ההגעה לא נקלטה קבלת סחורה, תופיע התראת איחור.» *(was: גלוי: כותרת «לוח אספקה — ימים ושעה אחרונה» · מתג «למה?» · מקופל: «אם השעה עברה ולא נקלטה קבלת סחורה, תופיע התראת איחור.»)* | FOLD · fold/cut; Batch P set an interim value; fold (`<Explain>`) · W2-11 · ❌ **fixed**: one wording with the corrected Batch P value; "שעה אחרונה" collides with the order cutoff on the same card | concept.lateDelivery | — |
| `suppliers.leakCard.open` · `suppliers/he.ts:144` | פתוח לטיפול / לתביעה → — | CUT · dead key: delete after grep · W2-11 | — | — |
| `suppliers.leakCard.claimsCta` · `suppliers/he.ts:146` | למכתבי התביעה → — | CUT · dead key: delete after grep · W2-11 | — | — |
| `suppliers.leakCard.cleanBody` · `suppliers/he.ts:156` | כל החשבוניות של הספק תאמו את ההזמנות ואת המחירים המוסכמים. נמשיך לבדוק כל משלוח. → כל החשבוניות תאמו. נמשיך לבדוק כל משלוח. | SHORTEN · not on the ציקטי week-1 path · W2-11 | concept.clean | — |
| `suppliers.ledger.gridSubtitle` · `suppliers/he.ts:167` | תעודות משלוח מול חשבוניות (רגילות ומרכזות) בכל חודש — לכל הספקים. → תעודות משלוח מול חשבוניות, לפי חודש. | SHORTEN · not on the ציקטי week-1 path · W2-11 | concept.consolidated | — |
| `suppliers.ledger.note` · `suppliers/he.ts:203` | חודשים לפי שעון ישראל. שווי תעודה = כמות שהתקבלה × המחיר בהזמנה. הדליפה זהה לסייר הדליפות. → גלוי: אין · מתג «איך חישבנו?» מתחת לטבלה · מקופל: «שווי תעודה = כמות שהתקבלה × מחיר בהזמנה. הדליפה זהה למסך הדליפות.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-11 · ✅ fold body has no ₪ | concept.leakSameEverywhere | — |
| `suppliers.ledger.emptyBody` · `suppliers/he.ts:205` | הכרטסת מתמלאת מקבלות סחורה וחשבוניות. היא תופיע כאן מהמשלוח הראשון. → הכרטסת תתמלא מהמשלוח הראשון. | SHORTEN · not on the ציקטי week-1 path · W2-11 | — | — |

## W2 · Contracts `/dashboard/contracts` (+ import)
Visible words now → after P → after W2: contracts-thresholds · owner 1440: **192 → 192 → 161** (expl. 43) · contracts · bookkeeper 1440: **295 → 286 → 272** (expl. 31) · contracts · owner 1440: **318 → 314 → 300** (expl. 24) · contracts-open · owner 1440: **373 → 369 → 355** (expl. 34) · contracts · manager 390: **263 → 259 → 245** (expl. 24) · +5 more captures in Appendix A
W2 on this screen: 11 keys, 103 → 61 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `contracts.subtitle` · `contracts/he.ts:8` | מחירי החוזה שסיכמתם עם הספקים, כל שורת חשבונית שחויבה מעליהם, ומוצרים שהמחיר שלהם מטפס. → — | CUT · stop rendering (component) · W2-12 | concept.overContract | — |
| `contracts.import.dropHint` · `contracts/he.ts:97` | CSV או XLSX, עד 9MB → CSV או XLSX · עד 9MB ו-5,000 שורות | SHORTEN · kept out of P: would duplicate the formats line on the same screen until W2 cuts one · W2-12 | concept.fileLimits | — |
| `contracts.import.formats` · `contracts/he.ts:98` | נתמכים: CSV ‏(UTF-8 או Windows-1255) ו-XLSX, עד 5,000 שורות. → CSV או XLSX · עד 9MB ו-5,000 שורות | MERGE · kept out of P: same · W2-12 · ✅ 9MB + 5,000 rows kept | concept.fileLimits | — |
| `contracts.import.unsupportedType` · `contracts/he.ts:99` | סוג הקובץ לא נתמך — העלו CSV או XLSX. → סוג קובץ לא נתמך. העלו ‎.xlsx או ‎.csv. | MERGE · kept out of P: no saving · W2-12 | concept.fileLimits | — |
| `contracts.import.tooBig` · `contracts/he.ts:100` | הקובץ גדול מדי (מקסימום 9MB). → הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV. | MERGE · kept out of P: grows the string · W2-12 · ✅ the 9MB number stays reachable on the formats line of the same screen | concept.fileLimits | — |
| `contracts.import.rowsDetected` · `contracts/he.ts:103` | זוהו {count} שורות. ודאו שהעמודות ממופות נכון: → זוהו {count} שורות. בדקו את העמודות: | SHORTEN · kept out of P: no saving · W2-12 | concept.importMapping | — |
| `contracts.import.mapRequired` · `contracts/he.ts:117` | חובה למפות עמודת מחיר, ועמודת שם מוצר או מק״ט. → חובה למפות עמודת מחיר, ועמודת שם מוצר או מק״ט. | MERGE · kept out of P: key merge (W2) · W2-12 | concept.importMapping | — |
| `contracts.over.truncated` · `contracts/he.ts:150` | מוצגות השורות האחרונות בלבד — הסכום כולל לכל הפחות את הסכום המוצג → מוצגות השורות האחרונות בלבד. | SHORTEN · kept out of P: the dropped half is a ₪-accuracy hint ("at least this amount") · W2-12 | concept.cap | — |
| `contracts.alerts.emptyBody` · `contracts/he.ts:190` | בכל יום נבדוק אם מחיר של מוצר עלה מעל הסף שהגדרתם, ונתריע כאן. → נתריע כאן כשמחיר יעלה מעל הסף. | SHORTEN · not on the ציקטי week-1 path · W2-12 | concept.priceAlertRule | — |
| `contracts.thresholds.intro` · `contracts/he.ts:194` | ברירת המחדל: התראה כשמחיר עולה ב-{threshold} או יותר בתוך {days} ימים. כלל לספק או לקטגוריה גובר על ברירת המחדל. → גלוי: «ברירת מחדל: עלייה של {threshold} בתוך {days} ימים» · מתג «פרטים» · מקופל: «כלל לספק או לקטגוריה גובר על ברירת המחדל.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-12 | concept.priceAlertRule | — |
| `contracts.thresholds.emptyBody` · `contracts/he.ts:208` | כל ההתראות משתמשות כרגע בברירת המחדל. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-12 | concept.priceAlertRule | — |

## W2 · Catalog `/dashboard/catalog` (+ import, SKU mapping)
Visible words now → after P → after W2: catalog-import-open · owner 1440: **210 → 194 → 188** (expl. 52) · catalog-import-open · manager 390: **152 → 136 → 130** (expl. 52) · catalog-mapping · owner 1440: **119 → 119 → 98** (expl. 27) · catalog · owner 1440: **673 → 673 → 654** (expl. 24) · catalog · manager 390: **958 → 958 → 939** (expl. 24) · +4 more captures in Appendix A
W2 on this screen: 18 keys, 189 → 90 explanatory words after Batch P (rendered strings) *(+ dead `catalog.import.queued`, moved from P 31.10)*.

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `catalog.subtitle` · `catalog/he.ts:7` | חיפוש אחד לרוחב כל הספקים — מצאו כל מוצר מכל מחירון במקום אחד, הבסיס לבניית הזמנות ולהצלבת חשבוניות. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | concept.threeWayMatch | — |
| `catalog.browser.pickSupplierToAdd` · `catalog/he.ts:19` | בחרו ספק כדי להוסיף פריט קטלוג חדש. → בחרו ספק כדי להוסיף פריט. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `catalog.browser.emptyBody` · `catalog/he.ts:22` | ייבאו מחירון ספק מקובץ Excel/CSV, או הוסיפו פריט ידנית. → ייבאו מחירון ספק, או הוסיפו פריט ידנית. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.noPriceList | — |
| `catalog.browser.noResultsBody` · `catalog/he.ts:25` | נסו מילת חיפוש אחרת או נקו את הסינון. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `catalog.item.confirmDeleteBody` · `catalog/he.ts:55` | הפריט יוסר מהמחירון ולא יהיה אפשר לשחזר אותו. כדי להפסיק להשתמש בו בלי למחוק, אפשר להשבית אותו. → לא ניתן לשחזר. אפשר להשבית במקום. | SHORTEN · confirmation (keep ₪ + supplier); not on the ציקטי week-1 path · W2-16b | — | — |
| `catalog.import.dropHint` · `catalog/he.ts:113` | או גררו את הקובץ לכאן → או גררו את הקובץ לכאן | MERGE · kept out of P: no saving · W2-16b | concept.fileLimits | — |
| `catalog.import.rowsDetected` · `catalog/he.ts:118` | זוהו {count} שורות. התאימו את העמודות: → זוהו {count} שורות. בדקו את העמודות: | SHORTEN · kept out of P: no saving · W2-16b | concept.importMapping | — |
| `catalog.import.mapNameRequired` · `catalog/he.ts:129` | חובה להתאים עמודת "תיאור / שם מוצר". → חובה להתאים עמודת "תיאור / שם מוצר". | MERGE · kept out of P: key merge (W2) · W2-16b | concept.importMapping | — |
| `catalog.import.check.sampleNote` · `catalog/he.ts:150` | מוצגות 20 השורות הראשונות. כל השורות נבדקות. → מוצגות 20 שורות ראשונות · כל השורות נבדקות — רק כשיש יותר מ-20 | SHORTEN · kept out of P (low value for week 1) · W2-16b | — | — |
| `catalog.import.review.intro` · `catalog/he.ts:168` | השורות האלה נשמרו בלי קישור למוצר, כדי שלא ייווצרו פערים מדומים. אשרו את ההצעה, בחרו מוצר אחר או צרו מוצר חדש. → גלוי: «קשרו כל שורה למוצר.» · מתג «למה?» · מקופל: «השורות נשמרו בלי קישור למוצר, כדי שלא ייווצרו פערים מדומים.» | FOLD · fold (`<Explain>`) · W2-16b · ✅ = draft noFakeGaps; action visible | concept.unlinkedRows | — |
| `catalog.import.tooBig` · `catalog/he.ts:207` | הקובץ גדול מ-9MB. פצלו אותו או שמרו כ-CSV. → הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV. | MERGE · kept out of P: drops the 9MB limit from the error · W2-16b | concept.fileLimits | — |
| `catalog.mapping.subtitle` · `catalog/he.ts:222` | מק״טים מהזמנות וחשבוניות שעדיין לא חוברו למוצר בקטלוג. חיבור חד-פעמי — וכל הזמנה עתידית מאותו ספק תזוהה אוטומטית. → מק״טים שעוד לא חוברו למוצר בקטלוג. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.skuLearning | — |
| `catalog.mapping.emptyBody` · `catalog/he.ts:227` | אין מק״טים שממתינים למיפוי. כל שורות ההזמנות והחשבוניות מחוברות למוצר. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `catalog.mapping.pending` · `catalog/he.ts:228` | {count} מק״טים ממתינים למיפוי. חיבור מק״ט למוצר מעדכן את כל השורות הקיימות ומלמד את המערכת לזיהוי אוטומטי בעתיד. → גלוי: «{count} מק״טים ממתינים למיפוי» · מתג «למה?» · מקופל: «חיבור אחד מעדכן את כל השורות, וההזמנות הבאות יזוהו לבד.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.skuLearning | — |
| `catalog.mapping.linkedBlocked` · `catalog/he.ts:241` | {count} חשבוניות עם דרישת זיכוי לא נבדקו מחדש. הריצו עליהן התאמה מחדש מדף החשבונית. → {count} חשבוניות עם דרישת זיכוי לא נבדקו — הריצו התאמה מדף החשבונית. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.rerunMatch | — |
| `catalog.mapping.linkedConsolidated` · `catalog/he.ts:243` | {count} חשבוניות מרכזות לא נבדקו מחדש. הן נבדקות מול תעודות המשלוח. → {count} חשבוניות מרכזות נבדקות מול תעודות המשלוח. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.consolidated | — |
| `catalog.mapping.linkedFailed` · `catalog/he.ts:244` | הבדיקה מחדש של {count} חשבוניות לא התחילה. נסו לקשר שוב בעוד רגע. → הבדיקה מחדש לא התחילה. נסו לקשר שוב. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `catalog.import.queued` · `catalog/he.ts:197` | הקובץ ({count} שורות) נשלח לעיבוד ברקע. הפריטים יופיעו בקטלוג בעוד כמה דקות. → — (remove key, he + en) | CUT · dead key: delete after grep; moved from Batch P (a key removal is not a value; 0 rendered words) · W2-16b | concept.background | — |

## W2 · Products `/dashboard/products`
Visible words now → after P → after W2: product-detail · owner 1440: **202 → 202 → 165** (expl. 41) · product-detail-open · owner 1440: **215 → 215 → 178** (expl. 47) · product-detail · manager 390: **141 → 141 → 104** (expl. 41) · product-detail-open · manager 390: **154 → 154 → 117** (expl. 47) · products · owner 1440: **448 → 448 → 429** (expl. 26) · +1 more captures in Appendix A
W2 on this screen: 13 keys, 110 → 30 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `products.subtitle` · `products/he.ts:8` | שם המוצר מזין את מנוע ההצלבה והדוחות. עריכת השם, השם באנגלית, הקטגוריה, היחידה והספק הבלעדי. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | concept.englishName | — |
| `products.names.subtitle` · `products/he.ts:8` | הזינו שמות באנגלית לכמה מוצרים בבת אחת — כך צוות שלא קורא עברית (למשל מקבל סחורה) רואה את המוצרים באנגלית. ההתאמות והייצוא ממשיכים לעבוד על… → גלוי: «שמות באנגלית לכמה מוצרים בבת אחת» · מתג «למה?» · מקופל: «מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.» (explain.englishName) | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.englishName | — |
| `products.names.readOnly` · `products/he.ts:31` | צפייה בלבד — רק בעלים ומנהלים יכולים לערוך. → צפייה בלבד | MERGE · not on the ציקטי week-1 path · W2-16b · ✅ = explain.viewOnly | concept.readOnly | — |
| `products.form.readOnly` · `products/he.ts:31` | צפייה בלבד — רק בעלים ומנהלים יכולים לערוך מוצרים. → צפייה בלבד | MERGE · not on the ציקטי week-1 path · W2-16b | concept.readOnly | — |
| `products.names.leaveBody` · `products/he.ts:35` | במעבר לדף המוצר השמות באנגלית שהקלדתם לא יישמרו. → השמות שהקלדתם לא יישמרו. | SHORTEN · confirmation (keep ₪ + supplier); not on the ציקטי week-1 path · W2-16b | — | — |
| `products.form.name` · `products/he.ts:41` | שם המוצר (קנוני, עברית) → שם המוצר בעברית | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.englishName | — |
| `products.form.nameEnHint` · `products/he.ts:43` | מוצג לצוות שעובד באנגלית (למשל מקבל סחורה). ההתאמות והייצוא ממשיכים לעבוד על השם העברי. → מתג «למה?» ליד השדה · מקופל: «מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.» (explain.englishName) | MERGE · component change; not on the ציקטי week-1 path · W2-16b | concept.englishName | — |
| `products.form.supplierHint` · `products/he.ts:50` | המוצר משויך לספק זה בלבד. ריק = ללא בלעדיות. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `products.form.deleteBlocked` · `products/he.ts:61` | לא ניתן למחוק — המוצר מקושר לחשבוניות או הזמנות. השביתו אותו בקטלוג במקום. → המוצר בשימוש ולא יימחק. השביתו אותו בקטלוג. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `products.history.empty` · `products/he.ts:85` | עוד לא נצפו מחירים בחשבוניות עבור המוצר הזה. → עוד אין מחירים מחשבוניות. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `products.server.deleteBlocked.212` · `packages/api/src/routers/products.ts:212` | לא ניתן למחוק — המוצר משמש במתכון. הסירו אותו מהמתכון קודם. → קוד product.inUse {where} → products.form.deleteBlocked | MERGE · dead key: delete after grep · W2-16b | — | — |
| `products.server.deleteBlocked.225` · `packages/api/src/routers/products.ts:212` | לא ניתן למחוק — המוצר מופיע בספירת מלאי. השביתו אותו בקטלוג במקום למחוק. → קוד product.inUse {where} → products.form.deleteBlocked | MERGE · dead key: delete after grep · W2-16b | — | — |
| `products.server.deleteBlocked.232` · `packages/api/src/routers/products.ts:212` | לא ניתן למחוק — המוצר מקושר לחשבוניות/הזמנות קיימות. השביתו אותו בקטלוג במקום למחוק. → קוד product.inUse {where} → products.form.deleteBlocked | MERGE · dead key: delete after grep · W2-16b | — | — |

## W2 · Supplier portal `/s/:token`
Visible words now → after P → after W2: portal · supplier 390: **184 → 184 → 171** (expl. 22) · portal-open · supplier 390: **190 → 190 → 177** (expl. 22) · portal · supplier 1440: **184 → 184 → 171** (expl. 22) · portal-open · supplier 1440: **190 → 190 → 177** (expl. 22) · portal-invalid · supplier 390: **29 → 29 → 18** (expl. 15)
W2 on this screen: 3 keys, 42 → 14 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `supplierConfirm.portal.subtitle` · `supplierConfirm/he.ts:6` | בדקו את הפריטים, סמנו חוסרים או הציעו מחיר אחר — ואשרו. ההזמנה עצמה לא משתנה; המסעדה תראה את התשובה שלכם. → גלוי: «סמנו חוסרים או מחיר אחר — ואשרו.» · מתג: «פרטים» · מקופל: «ההזמנה עצמה לא משתנה. המסעדה תראה את התשובה שלכם.» *(was: סמנו חוסרים או מחיר אחר — ואשרו.)* | SHORTEN · not on the ציקטי week-1 path · G-10 · ❌ **fixed**: a CUT of info an outside supplier sometimes needs ("the order itself does not change; the restaurant sees your answer"): FOLD, not cut | concept.poUnchanged | — |
| `supplierConfirm.portal.fixFields` · `supplierConfirm/he.ts:63` | יש שדות לא תקינים — תקנו אותם כדי לשלוח. → תקנו את השדות המסומנים. | SHORTEN · not on the ציקטי week-1 path · G-10 | — | e2e/W1-09.spec.ts |
| `supplierConfirm.portal.inactiveBody` · `supplierConfirm/he.ts:77` | ייתכן שנשלח אליכם קישור חדש יותר בוואטסאפ או במייל. אם לא — בקשו מהמסעדה קישור חדש. → בקשו מהמסעדה קישור חדש. | SHORTEN · not on the ציקטי week-1 path · G-10 | concept.linkValidity | — |

## W2 · Pay-run `/dashboard/approvals/pay-run` (flag off for ציקטי)
Visible words now → after P → after W2: payrun · owner 1440: **446 → 446 → 353** (expl. 152) · payrun · manager 390: **390 → 390 → 297** (expl. 152) · payrun · bookkeeper 1440: **423 → 423 → 330** (expl. 152) · payrun-last · owner 1440: **171 → 171 → 131** (expl. 62)
W2 on this screen: 12 keys, 97 → 41 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `approvals.errorPage.bodyPayRun` · `approvals/he.ts:126` | משהו השתבש בטעינת ריצת התשלומים. שום תשלום לא סומן. → שום תשלום לא סומן. | SHORTEN · not on the ציקטי week-1 path · W2-04 | — | — |
| `payRun.subtitle` · `payRun/he.ts:7` | החשבוניות של {month} שנבדקו ולא סומנו כשולמו — מה אפשר לשלם, מה להשהות ועל מה לבקש זיכוי. → חשבוניות {month} שנבדקו ועוד לא סומנו כשולמו. | SHORTEN · not on the ציקטי week-1 path · W2-03 | — | — |
| `payRun.status.hold` · `payRun/he.ts:16` | להשהות — ממתין להחלטה → להשהות | SHORTEN · not on the ציקטי week-1 path · W2-03 | — | — |
| `payRun.kpis.payHint` · `payRun/he.ts:24` | {count} חשבוניות · סכומי חשבונית כולל מע״מ → {count} חשבוניות · כולל מע״מ | MERGE · not on the ציקטי week-1 path · W2-03 | concept.vatBasis | — |
| `payRun.kpis.holdHint` · `payRun/he.ts:26` | {count} חשבוניות ממתינות להחלטה · כולל מע״מ → {count} חשבוניות · כולל מע״מ | MERGE · not on the ציקטי week-1 path · W2-03 | concept.vatBasis | — |
| `payRun.kpis.holdPending` · `payRun/he.ts:27` | חריגות פתוחות ממתינות להחלטה: {amount} → {amount} בפערים שממתינים להחלטה | SHORTEN · not on the ציקטי week-1 path · W2-03 | — | — |
| `payRun.kpis.link` · `payRun/he.ts:28` | {count} חשבוניות ממתינות לשיוך להזמנה ({amount} כולל מע״מ) — לא נספרות בתשלום או בהשהיה. → גלוי: «{count} חשבוניות ממתינות לשיוך להזמנה · {amount}» · מתג: «למה?» · מקופל: «לרוב חשבוניות מרכזות. עד השיוך הן לא נספרות בתשלום ובהשהיה.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-03 · ✅ fold is about pay/hold, not the leak: accurate | concept.pendingLink | — |
| `payRun.kpis.creditHint` · `payRun/he.ts:30` | מחריגות שאישרת לדרישה · הבסיס של כל סכום מצוין לידו → מפערים שאושרו לדרישה | SHORTEN · not on the ציקטי week-1 path · W2-03 | concept.inLetter | — |
| `payRun.table.totalBasis` · `payRun/he.ts:36` | כולל מע״מ → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-03 | concept.vatBasis | — |
| `payRun.supplier.subtotal` · `payRun/he.ts:44` | ביניים לספק → סיכום לספק | SHORTEN · not on the ציקטי week-1 path · W2-03 | — | — |
| `payRun.note` · `payRun/he.ts:69` | סטטוס התשלום הוא מה שסומן במערכת — RestoMatch לא מבצעת תשלומים. סכומי הזיכוי זהים לשורות המאושרות במכתבי דרישת הזיכוי; החריגות הפתוחות מופיע… → גלוי: «RestoMatch לא מבצעת תשלומים.» · מתג: «פרטים» · מקופל: «הסטטוס הוא מה שסומן במערכת. סכומי הזיכוי זהים למכתבי דרישת הזיכוי.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-03 · ✅ removes "החריגות" | concept.noPaymentRail | — |
| `payRun.empty` · `payRun/he.ts:71` | אין חשבוניות שנבדקו ולא סומנו כשולמו ב{month}. → אין חשבוניות לתשלום ב{month}. | SHORTEN · not on the ציקטי week-1 path · W2-03 | — | — |

## W2 · Invoice inbox `/dashboard/inbox` (flag off for ציקטי)
Visible words now → after P → after W2: inbox · bookkeeper 1440: **144 → 144 → 110** (expl. 63) · inbox · owner 1440: **200 → 200 → 172** (expl. 63) · inbox · manager 390: **145 → 145 → 117** (expl. 63)
W2 on this screen: 9 keys, 72 → 44 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `ingest.inbox.subtitle` · `ingest/he.ts:8` | חשבוניות שספקים שלחו בוואטסאפ או במייל נכנסות לכאן ועוברות לפענוח אוטומטית. → חשבוניות שהגיעו בוואטסאפ ובמייל | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `ingest.inbox.emptyDescription` · `ingest/he.ts:11` | הגדירו כתובת מייל או מספר וואטסאפ למטה, ושלחו אליהם חשבונית לניסיון. → הגדירו כתובת קליטה למטה ושלחו חשבונית לניסיון | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `ingest.errors.unsupported_type` · `ingest/he.ts:47` | סוג קובץ לא נתמך (רק PDF, JPG, PNG, WEBP) → סוג קובץ לא נתמך — רק תמונה או PDF | SHORTEN · not on the ציקטי week-1 path · W2-02 | concept.fileLimits | — |
| `ingest.errors.quota_exceeded` · `ingest/he.ts:53` | הגעתם למכסת האחסון היומית למסמכים לבדיקה בערוץ זה → נגמרה המכסה היומית בערוץ הזה. | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `ingest.channels.subtitle` · `ingest/he.ts:58` | לכל מסעדה כתובת סודית משלה. מי שלא מכיר אותה לא יכול לשלוח אליה. → כתובת סודית — רק מי שמכיר אותה יכול לשלוח | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `ingest.channels.emailHint` · `ingest/he.ts:62` | הכתובת שהספקים שולחים אליה חשבוניות. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-02 | — | — |
| `ingest.channels.disabled` · `ingest/he.ts:74` | הקליטה מ{kind} אינה פעילה למסעדה זו. → — | CUT · dead key: delete after grep · W2-02 | — | — |
| `ingest.senders.subtitle` · `ingest/he.ts:78` | חשבוניות משולחים ברשימה נשלחות לפענוח מיד. מכל השאר — ממתינות לבדיקה שלכם. → משולחים מאושרים — לפענוח מיד. מאחרים — לבדיקה שלכם | SHORTEN · not on the ציקטי week-1 path · W2-02 | — | — |
| `api.ingest.senderInvalid` · `packages/api/src/routers/ingest.ts:208` | כתובת / מספר לא תקינים → מספר או כתובת לא תקינים | MERGE · server code → appCode + UI key; not on the ציקטי week-1 path · W2-02 | concept.senderInvalid | — |

## W2 · Exports `/dashboard/exports` (week 3)
Visible words now → after P → after W2: exports · owner 1440: **211 → 211 → 153** (expl. 92) · exports · bookkeeper 1440: **188 → 188 → 130** (expl. 92) · exports · manager 390: **72 → 72 → 72** (expl. 22)
W2 on this screen: 10 keys, 147 → 58 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `accounting.subtitle` · `accounting/he.ts:7` | ייצוא חשבוניות שאושרו במערכת לקבצים מובנים — CSV לגיליונות, או "קובץ אחיד" (1000) להעלאה ישירה לתוכנת הנהלת החשבונות. → כל החשבוניות שנבדקו בטווח התאריכים. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.exportScope | — |
| `accounting.downloadedEmpty` · `accounting/he.ts:32` | אין חשבוניות שנבדקו בטווח הזה. הקובץ ירד ריק (כותרות בלבד). → אין חשבוניות בטווח הזה. ירד קובץ ריק. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.exportEmpty | — |
| `accounting.undated` · `accounting/he.ts:33` | לא נכללו בקובץ — חשבוניות שנבדקו בטווח הזה ואין להן תאריך חשבונית: {count}. יש להוסיף את התאריך בעמוד החשבונית ולהוריד שוב. → {count} חשבוניות בלי תאריך לא נכללו. הוסיפו תאריך בעמוד החשבונית והורידו שוב. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.exportSkipped | — |
| `accounting.note` · `accounting/he.ts:35` | נכללות כל החשבוניות שנבדקו: "הותאמה", "בחריגה" (מסומנת בעמודת הסטטוס), "אושרה" ו"שולמה". חשבוניות שעדיין בעיבוד OCR או חשבוניות ריכוז שממתינ… → גלוי: — (הכותרת המשנית אומרת "כל החשבוניות שנבדקו") · מתג: «פרטים» · מקופל: «נכללות כל החשבוניות שנבדקו, גם עם פערים. לא נכללות חשבוניות בקריאה, מרכזות שממתינות ועותקים כ… | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-14 · ✅ fold, no ₪ | concept.exportScope | — |
| `integrations.accounting.body` · `integrations/he.ts:11` | קובץ קליטה מוכן לחשבשבת, פריוריטי או ריווחית — אותן חשבוניות כמו בייצוא ה-CSV, באותו טווח תאריכים. → אותן חשבוניות ואותו טווח כמו ב-CSV. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.exportScope | — |
| `integrations.accounting.downloaded` · `integrations/he.ts:18` | הקובץ ירד — חשבוניות בקובץ: {count}. → הקובץ ירד — {count} חשבוניות. | MERGE · not on the ציקטי week-1 path · W2-14 | concept.exportDone | — |
| `integrations.accounting.empty` · `integrations/he.ts:19` | אין חשבוניות שנבדקו בטווח הזה. הקובץ ירד ריק. → אין חשבוניות בטווח הזה. ירד קובץ ריק. | MERGE · not on the ציקטי week-1 path · W2-14 | concept.exportEmpty | — |
| `integrations.accounting.skipped` · `integrations/he.ts:20` | לא נכללו חשבוניות בלי מספר, תאריך, סכום או ספק: {count}. → {count} חשבוניות חסרות פרטים לא נכללו. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.exportSkipped | — |
| `integrations.accounting.replaced` · `integrations/he.ts:21` | תווים שאין להם ייצוג בקידוד של חשבשבת (Windows-1255) נכתבו כ-"?": {count}. בדקו את שמות הספקים בקובץ. → {count} תווים הוחלפו ב-"?". בדקו את שמות הספקים. | SHORTEN · not on the ציקטי week-1 path · W2-14 | — | — |
| `integrations.accounting.derivedVat` · `integrations/he.ts:22` | חשבוניות שנשמר להן רק סכום כולל מע״מ — המע״מ חושב לפי שיעור המע״מ: {count}. → ב-{count} חשבוניות המע״מ חושב מהסכום הכולל. | SHORTEN · not on the ציקטי week-1 path · W2-14 | — | — |

## W2 · Settings `/dashboard/settings`
Visible words now → after P → after W2: settings · manager 390: **361 → 355 → 216** (expl. 249) · settings · bookkeeper 1440: **370 → 364 → 233** (expl. 235) · settings · owner 1440: **403 → 397 → 274** (expl. 225) · settings · receiver 390: **158 → 152 → 76** (expl. 114) · settings · chef 390: **156 → 150 → 74** (expl. 114)
W2 on this screen: 31 keys, 322 → 155 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `auth.serverErrors.soleOwner` · `auth/he.ts:183` | יש להעביר בעלות על המסעדה למשתמש אחר לפני מחיקת החשבון → העבירו את הבעלות על המסעדה לפני מחיקת החשבון. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.lastOwner | lib/__tests__/serverErrors.test.ts |
| `growth.referral.body` · `growth/he.ts:33` | שתפו את הקוד עם בעל מסעדה אחר. כשהוא מצטרף ומשלם — שניכם מקבלים חודש חינם. → חודש חינם לשתי המסעדות, כשהמצטרפת משלמת. | SHORTEN · not on the ציקטי week-1 path · W2-14 | — | — |
| `growth.referral.errors.generic` · `growth/he.ts:50` | משהו השתבש. נסו שוב. → הפעולה נכשלה. נסו שוב. | MERGE · not on the ציקטי week-1 path · W2-14 | concept.genericFail | lib/components/__tests__/ops-components.test.ts |
| `settings.sections.accountSubtitle` · `settings/he.ts:9` | שפת האפליקציה, סיסמה וניתוק מכשירים — הגדרות אישיות שלכם בלבד. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-14 | — | — |
| `settings.sections.profileSubtitle` · `settings/he.ts:11` | שם, ח״פ, שיעור מע״מ ואזור זמן — נושאי משקל לחישוב הדליפה ולגבולות היום. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-14 | concept.vatAffectsLeak | — |
| `settings.sections.matchingSubtitle` · `settings/he.ts:13` | ספי הסבילות והאישורים שמכתיבים מתי חריגה מסומנת כחוסמת, נכנסת לתור או מאושרת אוטומטית. → מתי פער נחסם, נכנס לתור או מאושר לבד. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.routing | — |
| `settings.sections.securitySubtitle` · `settings/he.ts:15` | אימות דו-שלבי מוסיף שכבת הגנה שאי-אפשר לעקוף גם דרך קישור-הקסם למייל. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-14 | concept.twoFactor | — |
| `settings.sections.privacySubtitle` · `settings/he.ts:17` | ייצוא הנתונים האישיים שלכם או מחיקת החשבון — מימוש זכויות נושא המידע. → מימוש זכויות נושא המידע. | SHORTEN · legal (keep); not on the ציקטי week-1 path · W2-14 | concept.dsr | — |
| `settings.account.languageHint` · `settings/he.ts:21` | השפה נשמרת בחשבון שלכם במסעדה הזו ומוחלת גם במכשירים חדשים. → נשמרת לחשבון שלכם, בכל מכשיר. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.appLanguage | — |
| `settings.account.passwordSet` · `settings/he.ts:27` | יש לכם סיסמה — אפשר להתחבר איתה או עם קישור-קסם. → סיסמה מוגדרת. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.magicLink | — |
| `settings.account.passwordNone` · `settings/he.ts:28` | אין עדיין סיסמה — כרגע אתם מתחברים רק עם קישור-קסם למייל. → אין סיסמה · נכנסים עם קישור כניסה במייל. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.magicLink | — |
| `settings.account.devicesHint` · `settings/he.ts:32` | ניתוק מכל המכשירים מבטל מיידית כל התחברות פעילה — גם במכשיר הזה. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-14 | concept.devicesSignOut | — |
| `settings.readOnly.profile` · `settings/he.ts:37` | תצוגה בלבד — רק לבעלי תפקיד "בעלים" יש הרשאה לעדכן את פרטי המסעדה. → צפייה בלבד (explain.viewOnly) *(was: צפייה בלבד · עריכה לבעלים)* | MERGE · not on the ציקטי week-1 path · W2-14 · ❌ **fixed**: the draft explain.viewOnly replaces it with "צפייה בלבד" and says who-may-edit is not repeated; one wording | concept.readOnly | — |
| `settings.readOnly.matching` · `settings/he.ts:38` | תצוגה בלבד — רק לבעלי תפקיד "בעלים" יש הרשאה לעדכן את הגדרות ההתאמה. → צפייה בלבד (explain.viewOnly) *(was: צפייה בלבד · עריכה לבעלים)* | MERGE · not on the ציקטי week-1 path · W2-14 · ❌ **fixed**: same as settings.readOnly.profile | concept.readOnly | — |
| `settings.profile.cardSubtitle` · `settings/he.ts:42` | שיעור המע״מ ואזור הזמן משפיעים ישירות על חישוב הדליפה וגבולות היום — ודאו שהם נכונים. → מע״מ ואזור הזמן משפיעים על חישוב הדליפה. ודאו שהם נכונים. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.vatAffectsLeak | — |
| `settings.profile.vatHint` · `settings/he.ts:46` | ברירת מחדל 18% (שיעור המע״מ בישראל מ-2025). → ברירת מחדל 18%. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.vatAffectsLeak | — |
| `settings.matching.tolerancesSubtitle` · `settings/he.ts:55` | אחוזים מוזנים כמספר שלם (5 = 5%). שדה ריק משאיר את הערך הקיים ללא שינוי. → 5 = 5%. שדה ריק = ללא שינוי. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.percentInput | — |
| `settings.matching.approvalsSubtitle` · `settings/he.ts:57` | הסכומים שמכתיבים מתי חריגה מנותבת לתור האישורים לפי גודלה. → מאיזה סכום פער עובר לתור האישורים. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.routing | — |
| `settings.matching.ocrSubtitle` · `settings/he.ts:59` | רמת ביטחון שמתחתיה חשבונית סרוקה נשלחת לבדיקה ידנית (5 = 5%). → מתחת לסף, חשבונית סרוקה עוברת לבדיקה ידנית. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.percentInput | — |
| `settings.matching.fields.pricePercentHint` · `settings/he.ts:66` | חריגת מחיר שמתחתיה לא מסומן. → פער קטן מזה לא מסומן. | MERGE · not on the ציקטי week-1 path · W2-14 · ✅ removes "חריגת" (פער) | concept.flagThreshold | — |
| `settings.matching.fields.priceAbsoluteHint` · `settings/he.ts:68` | הפרש מחיר מוחלט שמתחתיו לא מסומן. → פער קטן מזה לא מסומן. | MERGE · not on the ציקטי week-1 path · W2-14 | concept.flagThreshold | — |
| `settings.matching.fields.blockPricePercentHint` · `settings/he.ts:72` | חריגה מעל סף זה מסומנת כחוסמת (מחליטים לפני התשלום). → פער מעל הסף נחסם עד החלטה לפני תשלום. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.blocking | — |
| `settings.twoFactor.enabledBody` · `settings/he.ts:83` | מופעל — שכבת הגנה נוספת בכל כניסה. נותרו {count} קודי שחזור. → נותרו {count} קודי שחזור. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.twoFactor | — |
| `settings.twoFactor.disabledBody` · `settings/he.ts:84` | מומלץ להפעיל — נדרש קוד חד-פעמי מאפליקציית אימות בנוסף לסיסמה או לקישור. → מומלץ: קוד מאפליקציית אימות בכל כניסה. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.twoFactor | — |
| `settings.twoFactor.wrongDisableCode` · `settings/he.ts:90` | הקוד שגוי. נדרש קוד נוכחי כדי לכבות אימות דו-שלבי. → הקוד שגוי. ודאו שהשעה במכשיר מסונכרנת ונסו שוב. | MERGE · not on the ציקטי week-1 path · W2-14 | concept.twoFactor | — |
| `settings.twoFactor.disableLabel` · `settings/he.ts:91` | כיבוי — הזינו קוד נוכחי לאישור → קוד נוכחי לכיבוי | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.twoFactor | — |
| `settings.twoFactor.scanHint` · `settings/he.ts:93` | סרקו את הקוד באפליקציית אימות (Google Authenticator, 1Password וכו׳), או הזינו את המפתח ידנית: → סרקו באפליקציית אימות (כמו Google Authenticator) או הזינו ידנית: | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.twoFactor | — |
| `settings.twoFactor.codesIntro` · `settings/he.ts:98` | שמרו את קודי השחזור הבאים במקום בטוח — הם מוצגים פעם אחת בלבד. כל קוד תקף לשימוש יחיד אם איבדתם גישה לאפליקציה. → visible: "שמרו את הקודים במקום בטוח. הם מוצגים פעם אחת." · toggle: "פרטים" (collapsed by default) · folded: "כל קוד עובד פעם אחת, כשאין לכם גישה לאפליקציה." | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-14 | concept.recoveryCodes | — |
| `settings.dsr.note` · `settings/he.ts:108` | הייצוא כולל את פרטי החשבון, החברויות והפעילות שלכם. אם אתם הבעלים היחידים של מסעדה עם חברים נוספים, יש להעביר תחילה את הבעלות לפני מחיקת החש… → הייצוא כולל את החשבון, החברויות והפעילות שלכם. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.lastOwner | — |
| `settings.dsr.failed` · `settings/he.ts:109` | הפעולה נכשלה. נסו שוב. → הפעולה נכשלה. נסו שוב. | MERGE · not on the ציקטי week-1 path · W2-14 | concept.genericFail | lib/__tests__/serverErrors.test.ts |
| `server:growth.referralTooLate` · `packages/api/src/routers/growth.ts:184` | אפשר לממש קוד הפניה רק בחודש הראשון → אפשר לממש קוד רק בחודש הראשון. | SHORTEN · server code → appCode + UI key; not on the ציקטי week-1 path · W2-14 | — | — |

## W2 · Team `/dashboard/team`
Visible words now → after P → after W2: team · owner 1440: **227 → 221 → 194** (expl. 46) · team · manager 390: **114 → 96 → 83** (expl. 43)
W2 on this screen: 6 keys, 56 → 27 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `auth.serverErrors.lastOwner` · `auth/he.ts:175` | חייב להישאר לפחות בעלים אחד. → אי־אפשר להוריד את הבעלים האחרון. קדמו קודם בעלים נוסף. | SHORTEN · not on the ציקטי week-1 path · W2-16b · ✅ testRefs list serverErrors.test.ts:6 (Hebrew lookup): change the server prose in the same PR (W2-16 trap) | concept.lastOwner | lib/__tests__/serverErrors.test.ts, api/__tests__/app-error-codes.test.ts |
| `team.subtitle` · `team/he.ts:7` | הזמינו עובדים, הגדירו תפקידים ושפת אפליקציה, ונהלו את הגישה למסעדה. → — | CUT · stop rendering (component) · W2-14 | concept.invite | — |
| `team.invite.subtitle` · `team/he.ts:11` | מנהל משמרת שמקבל סחורה — בחרו "מקבל סחורה". עובד שלא דובר עברית — בחרו שפה English. נשלח קישור הצטרפות לכתובת המייל. → visible: "נשלח קישור הצטרפות למייל." · toggle: "פרטים" (collapsed by default) · folded: "מנהל משמרת שמקבל סחורה: בחרו "מקבל סחורה". עובד שלא דובר עברית: בחרו English." | FOLD · fold (`<Explain>`) · W2-14 · ✅ role/language guidance sometimes needed → fold is right; options are device/he/en (team/he.ts:42) | concept.invite | — |
| `team.invite.copyLinkTitle` · `team/he.ts:23` | העתקת קישור ההזמנה (אין ספק מייל מוגדר) → העתקת קישור ההזמנה | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.invite | — |
| `team.invite.rateLimited` · `team/he.ts:24` | נשלחו יותר מדי הזמנות בשעה האחרונה. נסו שוב מאוחר יותר. → יותר מדי הזמנות בשעה האחרונה. נסו שוב מאוחר יותר. | SHORTEN · kept out of P: saves 1 word · W2-14 | concept.rateLimit | — |
| `team.empty.description` · `team/he.ts:55` | הזמינו את העובד הראשון למעלה. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-14 | concept.invite | — |

## W2 · Integrations `/dashboard/integrations` (flag off for ציקטי)
Visible words now → after P → after W2: integrations-open · owner 1440: **250 → 244 → 195** (expl. 110) · integrations · owner 1440: **220 → 214 → 174** (expl. 88) · integrations-open · manager 390: **128 → 122 → 84** (expl. 83) · integrations · manager 390: **98 → 92 → 63** (expl. 61) · integrations · bookkeeper 1440: **144 → 138 → 111** (expl. 61)
W2 on this screen: 10 keys, 113 → 57 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `integrations.subtitle` · `integrations/he.ts:7` | חיבור RestoMatch לתוכנת הנהלת החשבונות, לקופה ולמערכת הרכש — בלי הקלדה כפולה. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-14 | — | — |
| `integrations.accounting.mapping.body` · `integrations/he.ts:27` | הקודים מתוך מבנה החשבונות שלכם. נשמרים פעם אחת ומשמשים בכל קבצי הקליטה. → נשמרים פעם אחת לכל קבצי הקליטה. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.exportScope | — |
| `integrations.accounting.mapping.suppliersBody` · `integrations/he.ts:32` | ברירת המחדל היא מספר החברה (ח.פ.) של הספק. אפשר להחליף בקוד הכרטיס הקיים אצלכם. → ברירת מחדל: ח.פ. של הספק. אפשר להחליף בקוד שלכם. | SHORTEN · not on the ציקטי week-1 path · W2-14 | — | — |
| `integrations.accounting.mapping.readOnly` · `integrations/he.ts:38` | רק הבעלים יכולים לשנות כרטיסי חשבון. → צפייה בלבד (explain.viewOnly) *(was: צפייה בלבד · עריכה לבעלים)* | MERGE · not on the ציקטי week-1 path · W2-14 · ❌ **fixed**: same as settings.readOnly.profile | concept.readOnly | — |
| `integrations.pos.body` · `integrations/he.ts:45` | ייבוא דוח "מכירות לפי פריט" מהקופה (CSV, בעברית או באנגלית). זה הבסיס לחישוב עלות מנה. → דוח "מכירות לפי פריט" מהקופה (CSV) — הבסיס לעלות מנה. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.posBasis | — |
| `integrations.pos.replaced` · `integrations/he.ts:51` | ימים שכבר יובאו הוחלפו בקובץ החדש (שורות קודמות שהוחלפו: {count}). → {count} שורות מימים קודמים הוחלפו. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.posReplace | — |
| `integrations.pos.rejectedDays` · `integrations/he.ts:58` | ימים שכל השורות שלהם נדחו — הנתונים הקודמים שלהם נשארו: {days}. → ימים שלא עודכנו (כל השורות נדחו): {days}. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.posReplace | — |
| `integrations.procurement.body` · `integrations/he.ts:83` | MarketMan ו-Zester: ספקים, פריטים והזמנות נכנסים אוטומטית. חיבור חשבון אמיתי דורש פרטי גישה מהבעלים. → ספקים, פריטים והזמנות נכנסים אוטומטית. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.realConnect | — |
| `integrations.procurement.previewTitle` · `integrations/he.ts:90` | מה סנכרון יביא — נתוני דוגמה, שום דבר לא נשמר → נתוני דוגמה · שום דבר לא נשמר | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.realConnect | — |
| `integrations.procurement.activate` · `integrations/he.ts:101` | לחיבור חשבון אמיתי: הבעלים מוסיפים את פרטי הגישה לפי הוראות ההפעלה בדוח האינטגרציות. → חיבור חשבון אמיתי דורש פרטי גישה מהבעלים. | SHORTEN · not on the ציקטי week-1 path · W2-14 | concept.realConnect | — |

## W2 · Admin `/admin`
Visible words now → after P → after W2: admin · owner 1440: **45 → 45 → 45** (expl. 0) · admin-leads · owner 1440: **36 → 36 → 36** (expl. 7) · admin-restaurant · owner 1440: **82 → 82 → 82** (expl. 0)
W2 on this screen: 8 keys, 65 → 50 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `admin.list.emptyHint` · `admin/he.ts:42` | מסעדה נוצרת כשמשתמש חדש מסיים את שלב ההצטרפות (/onboarding). → מסעדה נוצרת בסיום ההצטרפות. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `admin.detail.noSubscription` · `admin/he.ts:53` | ללא מנוי — ניסיון משתמע (פיצ׳רים מלאים, נפח נמוך). שייכו תוכנית כדי להתחיל למדוד שימוש. → ללא מנוי — ניסיון משתמע. שייכו תוכנית למדידת שימוש. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `admin.overrides.label` · `admin/he.ts:65` | הרחבות (override) — מספר ריק = ברירת מחדל של התוכנית → הרחבות · ריק = ברירת מחדל | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `admin.roles.lastOwner` · `admin/he.ts:80` | אי-אפשר להוריד את הבעלים האחרון — קדמו קודם בעלים נוסף. → אי־אפשר להוריד את הבעלים האחרון. קדמו קודם בעלים נוסף. | MERGE · not on the ציקטי week-1 path · W2-16b · ✅ one wording with auth.serverErrors.adminLastOwner | concept.lastOwner | — |
| `admin.generic` · `admin/he.ts:101` | הפעולה נכשלה. נסו שוב. → הפעולה נכשלה. נסו שוב. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.genericFail | lib/__tests__/serverErrors.test.ts |
| `auth.serverErrors.adminLastOwner` · `auth/he.ts:185` | אי-אפשר להוריד את הבעלים האחרון — קדמו קודם בעלים נוסף. → אי־אפשר להוריד את הבעלים האחרון. קדמו קודם בעלים נוסף. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.lastOwner | lib/__tests__/serverErrors.test.ts |
| `auth.serverErrors.notFound` · `auth/he.ts:186` | הפריט המבוקש לא נמצא. → הפריט לא נמצא — ייתכן שנמחק. | MERGE · not on the ציקטי week-1 path · W2-16b · ✅ = components.errors.notFound; Hebrew lookup trap noted in the draft | concept.notFound | — |
| `server:admin.noSubscription` · `packages/api/src/routers/admin.ts:251` | restaurant has no subscription — assign a plan first → אין מנוי. שייכו קודם תוכנית. | SHORTEN · server code → appCode + UI key; not on the ציקטי week-1 path · W2-16b | — | — |

## W2 · Inventory `/dashboard/inventory` (+ count; flag off for ציקטי)
Visible words now → after P → after W2: inventory-count-finish · manager 390: **1184 → 1184 → 916** (expl. 304) · inventory-count · manager 390: **1120 → 1120 → 865** (expl. 257) · inventory · owner 1440: **193 → 193 → 158** (expl. 77) · inventory · manager 390: **138 → 138 → 103** (expl. 77) · inventory · chef 390: **136 → 136 → 101** (expl. 77) · +7 more captures in Appendix A
W2 on this screen: 17 keys, 160 → 85 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `inventory.subtitle` · `inventory/he.ts:4` | ספירה שסוגרת את חודש עלות המזון: שווי המלאי בש״ח, עלות המזון בפועל — ובדיקה שמספר הדליפה אמין. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.home.startHint` · `inventory/he.ts:16` | כרבע שעה במחסן: סופרים לפי מקרר, מקפיא, ירקות, יבשים ובר — הכל נשמר תוך כדי. → כרבע שעה. הכל נשמר תוך כדי. | SHORTEN · not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.home.draftNote` · `inventory/he.ts:17` | יש ספירה פתוחה מ-{date}: נספרו {counted} מתוך {lines} פריטים. → ספירה פתוחה מ-{date} · {counted} מתוך {lines} נספרו | SHORTEN · not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.home.historyEmpty` · `inventory/he.ts:19` | עוד אין ספירות סגורות. הספירה הראשונה היא מלאי הפתיחה. → עוד אין ספירות. הראשונה תהיה מלאי הפתיחה. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.twoCounts | — |
| `inventory.count.priceFrom` · `inventory/he.ts:36` | {price} ל{unit} · חשבונית {invoice}, {date}, {supplier} → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-07 | concept.priceSource | — |
| `inventory.count.priceFromNoInvoice` · `inventory/he.ts:37` | {price} ל{unit} · {supplier}, {date} → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-07 | concept.priceSource | — |
| `inventory.count.check` · `inventory/he.ts:38` | בדוק → בדקו | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.overCount | — |
| `inventory.count.checkHint` · `inventory/he.ts:39` | יותר מהספירה הקודמת ומכל מה שהתקבל מאז → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-07 | concept.overCount | — |
| `inventory.count.closersOnly` · `inventory/he.ts:40` | מנהל או בעלים סוגרים את הספירה. הכמויות שלך נשמרו. → הכמויות נשמרו. מנהל או בעלים יסגרו את הספירה. | SHORTEN · not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.count.acceptUncounted` · `inventory/he.ts:43` | לסגור בלי הפריטים שלא נספרו — שורה ריקה היא "לא נספר", לא אפס, והיא לא נכנסת לשווי → לסגור בלי הפריטים שלא נספרו | MERGE · confirmation (keep ₪ + supplier); not on the ציקטי week-1 path · W2-07 · ✅ inventory.count.notCountedWarn says on the line that they stay out of the value | concept.uncountedNotZero | — |
| `inventory.count.checkWarn` · `inventory/he.ts:44` | {count} פריטים מעל הספירה הקודמת + מה שהתקבל מאז, כדאי לבדוק: {names} → {count} פריטים מעל הספירה הקודמת ומה שהתקבל — בדקו: {names} | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.overCount | — |
| `inventory.count.emptyList` · `inventory/he.ts:50` | אין מוצרים שנקנו ב-60 הימים האחרונים. אפשר להוסיף מוצר בחיפוש. → אין קניות ב-60 הימים האחרונים. הוסיפו מוצר בחיפוש. | SHORTEN · not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.count.notAfterLast` · `inventory/he.ts:54` | כבר נסגרה ספירה ב-{date}. כדי לסגור, בחרו תאריך מאוחר ממנו. → כבר נסגרה ספירה ב-{date}. בחרו תאריך מאוחר יותר. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.notAfterLast | — |
| `inventory.count.notAfterLastToday` · `inventory/he.ts:55` | כבר נסגרה ספירה היום — אפשר לסגור את הבאה מחר. → כבר נסגרה ספירה היום. את הבאה סוגרים מחר. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.notAfterLast | — |
| `inventory.count.closedOnWarn` · `inventory/he.ts:56` | כבר נסגרה ספירה ב-{date}, ולכן ספירה בתאריך הזה לא תיסגר. שנו את התאריך למאוחר יותר. → כבר נסגרה ספירה ב-{date}. בחרו תאריך מאוחר יותר. | MERGE · not on the ציקטי week-1 path · W2-07 | concept.notAfterLast | — |
| `inventory.count.unpricedWarn` · `inventory/he.ts:65` | {count} פריטים בלי מחיר ידוע — מוצגים, לא נכנסים לשווי. → {count} פריטים בלי מחיר — לא ייכנסו לשווי. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.notInValue | — |
| `inventory.detail.lockedNote` · `inventory/he.ts:74` | ספירה סגורה ונעולה: המחירים והשווי נעולים מ-{date}. רק הבעלים יכולים לתקן, עם סיבה שנרשמת. → נעולה מ-{date}. רק הבעלים מתקנים, עם סיבה. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.countLocked | — |

## W2 · Recipes `/dashboard/recipes` (flag off for ציקטי)
Visible words now → after P → after W2: recipes-import · owner 1440: **230 → 230 → 174** (expl. 89) · recipes-import-errors · owner 1440: **232 → 232 → 176** (expl. 93) · recipes-pos · owner 1440: **219 → 219 → 171** (expl. 85) · recipes-pos · manager 390: **164 → 164 → 116** (expl. 85) · recipes-impact · owner 1440: **302 → 302 → 273** (expl. 52) · +11 more captures in Appendix A
W2 on this screen: 42 keys, 499 → 202 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `inventory.period.implausibleBody` · `inventory/he.ts:91` | התוצאה לא סבירה (שלילית, או מחוץ לטווח 5%–80% מהמכירות). בדרך כלל זו כמות או יחידה שגויה באחת הספירות, או מכירות שהוזנו חלקית. החישוב המלא מ… → גלוי: «בדקו את הספירה.» (implausibleTitle) · מתג: «למה?» · מקופל: «התוצאה מחוץ ל-5%–80% מהמכירות. לרוב כמות או יחידה שגויה, או מכירות חלקיות.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-07 · ✅ 5%–80% kept in the fold | concept.implausible | — |
| `inventory.period.coverageCaveat` · `inventory/he.ts:92` | ספירה חלקית, ולכן האחוז פחות מדויק ואין התראה על שימוש לא מוסבר: {parts}. → ספירה חלקית — האחוז פחות מדויק: {parts} | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.partialCount | — |
| `inventory.period.coveragePart` · `inventory/he.ts:93` | בספירת {date} יש שווי ל-{counted} מתוך {lines} פריטי מזון → {date}: {counted} מתוך {lines} פריטים עם שווי | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.partialCount | — |
| `inventory.period.creditsToReceive` · `inventory/he.ts:95` | זיכוי לקבל: {value} — אושר מול הספק, עוד לא התקבל, ולכן לא מקוזז. → זיכוי לקבל: {value} · לא מקוזז עד שיתקבל | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.creditPending | — |
| `inventory.period.accruedLine` · `inventory/he.ts:97` | {count} תעודות משלוח שהגיעו בתקופה ועוד לא חויבו (הערכה לפי מחירי הזמנה) → {count} תעודות משלוח שעוד לא חויבו (לפי מחירי ההזמנה) | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.accrual | — |
| `inventory.period.reversedLine` · `inventory/he.ts:98` | תעודות מתקופה קודמת שחויבו בתקופה בחשבונית הריכוז → תעודות מתקופה קודמת שחויבו עכשיו בחשבונית מרכזת | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.consolidated | — |
| `inventory.period.purchaseFoodCostHint` · `inventory/he.ts:100` | קניות {purchases} ÷ מכירות {sales}, {from} עד {to}. זה לא עלות המזון בפועל — היא תופיע אחרי הספירה הבאה. → גלוי: «קניות {purchases} ÷ מכירות {sales}, {from}–{to}» · מתג: «למה?» · מקופל: inventory.explain.twoCounts = «עלות המזון בפועל מחושבת בין שתי ספירות. היא תופיע אחרי הספיר… | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-07 | concept.twoCounts | — |
| `inventory.period.purchasesNote` · `inventory/he.ts:101` | קניות מזון: {count} חשבוניות, לפני מע״מ. לא כולל: חד״פ וניקיון {nonFood} · משקאות {beverages} · כפילויות {dups}. המשקאות והבר לא נכללים גם ב… → קניות מזון: {count} חשבוניות, לפני מע״מ. בלי חד״פ וניקיון {nonFood} · משקאות {beverages} · כפילויות {dups}. | SHORTEN · not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.period.salesMissing` · `inventory/he.ts:105` | הזינו את מכירות המזון של התקופה כדי לראות אחוז. → הזינו מכירות מזון כדי לראות אחוז. | SHORTEN · not on the ציקטי week-1 path · W2-07 | — | — |
| `inventory.period.theoryPartial` · `inventory/he.ts:108` | עלות תאורטית: יש מתכון ל-{coverage} מהמכירות בקופה. כדי להשוות צריך לפחות 90% — מוסיפים מתכונים במסך עלות מנה. → יש מתכון ל-{coverage} מהמכירות. הוסיפו מתכונים עד 90% כדי להשוות. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.theoryCoverage | — |
| `inventory.period.theoryIncomplete` · `inventory/he.ts:109` | עלות תאורטית: לחלק מהמנות שנמכרו חסר מחיר רכיב — משלימים במסך עלות מנה כדי להשוות. → חסר מחיר רכיב בחלק מהמנות. השלימו בעלות מנה כדי להשוות. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.missingPrice | — |
| `inventory.period.varianceHint` · `inventory/he.ts:113` | פחת, מנות גדולות מדי, גניבה — ההפרש בין מה שיצא מהמלאי למה שהמתכונים אומרים. → גלוי: — · מתג: «למה?» ליד "שימוש לא מוסבר" · מקופל: «ההפרש בין מה שיצא מהמלאי למה שהמתכונים אומרים. לרוב פחת, מנות גדולות או גניבה.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-07 | concept.variance | — |
| `inventory.period.target` · `inventory/he.ts:115` | יעד {target} → סף {target} | MERGE · not on the ציקטי week-1 path · W2-07 · ✅ removes "יעד"; "סף" waits for the owner decision | concept.foodCostThreshold | — |
| `inventory.period.needOpening` · `inventory/he.ts:116` | עלות המזון בפועל מחושבת בין שתי ספירות. אחרי הספירה הבאה תראו אותה כאן. → גלוי: «תופיע אחרי הספירה הבאה.» · מתג: «למה?» · מקופל: inventory.explain.twoCounts | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-07 | concept.twoCounts | — |
| `inventory.period.noCounts` · `inventory/he.ts:117` | ספרו את המלאי פעם אחת כדי לקבע מלאי פתיחה; בספירה הבאה תקבלו את עלות המזון בפועל. → תופיע אחרי שתי ספירות. התחילו בספירה הראשונה. | SHORTEN · not on the ציקטי week-1 path · W2-07 | concept.twoCounts | — |
| `inventory.period.separateNote` · `inventory/he.ts:118` | נפרד ממספר הדליפה בחשבוניות. → לא חלק מהדליפה | MERGE · not on the ציקטי week-1 path · W2-07 | concept.notLeak | — |
| `recipes.subtitle` · `recipes/he.ts:4` | כמה עולה כל מנה לפי המחירים ששילמתם בפועל, כמה נשאר לכם מכל צלחת, ומה זז החודש. → עלות כל מנה לפי המחירים ששילמתם בפועל. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.target.hint` · `recipes/he.ts:15` | ירוק — עד היעד · כתום — עד 3 נקודות מעליו · אדום — מעבר לכך → גלוי: — · מתג: «פרטים» ליד "עלות מזון רצויה" · מקופל: «ירוק: עד הסף. כתום: עד 3 נקודות מעליו. אדום: מעבר לכך.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.foodCostThreshold | — |
| `recipes.target.readOnly` · `recipes/he.ts:19` | רק בעלים ומנהלים יכולים לשנות את היעד. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.pos.incomplete` · `recipes/he.ts:40` | חסר מחיר לחלק מהרכיבים — העלות נמוכה מהאמת → חסר מחיר רכיב — העלות נמוכה מהאמת | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.missingPrice | — |
| `recipes.list.empty` · `recipes/he.ts:42` | עוד אין מנות. הוסיפו מנה ראשונה או ייבאו מ-CSV. → עוד אין מנות. הוסיפו מנה ראשונה. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.noDishes | — |
| `recipes.editor.isSub` · `recipes/he.ts:59` | זה תת-מתכון (רוטב, בצק, ציר) — משמש בתוך מנות אחרות → תת-מתכון (רוטב, בצק, ציר) | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.editor.wasteHint` · `recipes/he.ts:77` | קילוף/ניקוי/בישול. הכמות שנקנית = נטו ÷ (1 − פחת). → גלוי: — · מתג: «פרטים» ליד הכותרת "רכיבים" · מקופל: «פחת = קילוף, ניקוי ובישול. כמות לקנייה = נטו ÷ (1 − פחת).» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.waste | — |
| `recipes.editor.bridgeHint` · `recipes/he.ts:79` | היחידות לא מומרות אוטומטית — כמה {unit} יש ב-{productUnit} אחד? (למשל 30 ביצים בתבנית) → למשל 30 ביצים בתבנית. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.unitBridge | — |
| `recipes.editor.noPrice` · `recipes/he.ts:82` | עוד לא נקנה — אין מחיר → אין מחיר ששולם | MERGE · not on the ציקטי week-1 path · W2-16b | concept.missingPrice | — |
| `recipes.editor.noItems` · `recipes/he.ts:98` | הוסיפו לפחות רכיב אחד כדי לחשב עלות. → הוסיפו רכיב כדי לחשב עלות. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.changes.subtitle` · `recipes/he.ts:109` | עלות כל מנה במחירים של תחילת החודש ({since}) מול היום — ומה הזיז אותה. → מחירי תחילת החודש ({since}) מול היום. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.impact.subtitle` · `recipes/he.ts:124` | בחרו מוצר ושינוי מחיר — ותראו מיד אילו מנות נפגעות וכמה. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.import.subtitle` · `recipes/he.ts:140` | שורה לכל רכיב. מוצרים מזוהים לפי השם בעברית או באנגלית. מתכון קיים באותו שם יוחלף. → מתכון קיים באותו שם יוחלף. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.import.columns` · `recipes/he.ts:141` | עמודות: recipe (מנה), ingredient (רכיב), quantity (כמות), unit (יחידה) — חובה; waste_pct, menu_price, yield_qty, yield_unit, sub_recipe, nam… → גלוי: — · מתג: «פרטים» ליד "קובץ CSV" · מקופל: «שורה לכל רכיב, מוצר לפי השם בעברית או באנגלית. חובה: recipe, ingredient, quantity, unit; השאר רשות.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.import.errors.subRecipeInUse` · `recipes/he.ts:168` | "{value}" משמש כתת-מתכון במנות אחרות — אי אפשר להפוך אותו למנה → "{value}" הוא תת-מתכון במנות אחרות — אי אפשר להפוך אותו למנה | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.errors.cycle` · `recipes/he.ts:173` | תת-מתכון לא יכול להכיל את עצמו (גם לא דרך מתכון אחר). → תת-מתכון לא יכול להכיל את עצמו. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.errors.unitMismatch` · `recipes/he.ts:175` | היחידה לא מומרת ליחידת המוצר — מלאו כמה יחידות יש ביחידת מוצר אחת. → מלאו כמה יחידות יש ביחידת מוצר אחת. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.unitBridge | — |
| `recipes.errors.importFailed` · `recipes/he.ts:181` | הייבוא נכשל ולא נשמר דבר. בדקו את הקובץ ונסו שוב. → הייבוא נכשל. לא נשמר דבר. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.pos.subtitle` · `recipes/he.ts:188` | לפי המכירות בקופה: כמה עלו המנות שנמכרו, ומה אחוז עלות המזון על המחיר שבאמת נגבה (הנחות, ארוחות על חשבון הבית ומבצעים כלולים). → גלוי: «לפי המכירות בקופה, במחיר שנגבה בפועל.» · מתג: «פרטים» · מקופל: «כולל הנחות, ארוחות על חשבון הבית ומבצעים.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.posBasis | — |
| `recipes.pos.unmatched` · `recipes/he.ts:200` | {count} פריטים בקופה לא מקושרים למתכון, ולכן אין להם עלות — הקישור הוא לפי שם המנה בעברית או באנגלית: → גלוי: «{count} פריטים בקופה בלי מתכון:» · מתג: «למה?» · מקופל: recipes.explain.posLinkByName = «הקופה מקושרת למנה לפי השם, בעברית או באנגלית.» | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.posLinkByName | — |
| `recipes.pos.implausibleHint` · `recipes/he.ts:202` | מכירות נטו אפסיות/שליליות או עלות מעל 200% — כנראה החזר, ארוחות על חשבון הבית או מחיר שגוי בקופה. → גלוי: — (התג "לבדוק בקופה" נשאר) · מתג: «למה?» בכותרת העמודה "בפועל" · מקופל: «מכירות אפס או שליליות, או עלות מעל 200%. לרוב החזר, ארוחה על חשבון הבית או מחיר שגוי בקופה.… | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b | concept.implausible | — |
| `recipes.pos.emptyNoData` · `recipes/he.ts:205` | אין עדיין נתוני מכירות מהקופה לתקופה הזו. אחרי ייבוא קובץ מכירות במסך האינטגרציות, תראו כאן את עלות המזון בפועל לכל מנה. → אין מכירות מהקופה לתקופה הזו. + כפתור [לייבוא מכירות] → /dashboard/integrations | SHORTEN · component change; not on the ציקטי week-1 path · W2-16b | — | — |
| `recipes.pos.emptyNoMatch` · `recipes/he.ts:206` | יש מכירות בקופה, אבל אף פריט לא מקושר למנה. ודאו ששם המנה תואם לשם הפריט בקופה. → גלוי: «אף פריט בקופה לא מקושר למנה.» · מתג: «למה?» · מקופל: recipes.explain.posLinkByName | MERGE · component change; not on the ציקטי week-1 path · W2-16b | concept.posLinkByName | — |
| `recipes.alert.title` · `recipes/he.ts:209` | חצתה את יעד עלות המזון → מעל עלות המזון הרצויה | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.foodCostThreshold | — |
| `recipes.alert.target` · `recipes/he.ts:210` | יעד {target} → סף {target} | MERGE · not on the ציקטי week-1 path · W2-16b | concept.foodCostThreshold | — |
| `recipes.alert.banner` · `recipes/he.ts:214` | המנה חצתה את יעד עלות המזון החודש בגלל עליית מחיר אצל ספק. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | concept.foodCostThreshold | — |

## W2 · Chain `/dashboard/chain` `/dashboard/branches` (flag off)
Visible words now → after P → after W2: chain · owner 1440: **458 → 458 → 396** (expl. 95) · chain-open · owner 1440: **668 → 668 → 606** (expl. 95) · branches · owner 1440: **155 → 155 → 146** (expl. 21)
W2 on this screen: 23 keys, 217 → 113 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `chain.dashboard.subtitle` · `chain/he.ts:18` | כל הסניפים במבט אחד — כמה כסף דלף, איפה, ואצל איזה ספק. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.scopeNote` · `chain/he.ts:19` | מוצגים {count} סניפים שבהם את/ה בעלים בחשבון החיוב הזה. → {count} סניפים בבעלותכם | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.kpis.caughtHint` · `chain/he.ts:27` | דליפה בחשבוניות שעוד לא שולמו → עוד אפשר לעצור לפני תשלום | MERGE · not on the ציקטי week-1 path · W2-16b | concept.caught | — |
| `chain.dashboard.kpis.claimedHint` · `chain/he.ts:29` | שורות שאושרו לזיכוי → — | CUT · dead key: delete after grep · W2-16b | — | — |
| `chain.dashboard.kpis.pendingHint` · `chain/he.ts:31` | חריגות פתוחות מהתקופה בכל הסניפים · בתורי האישורים כרגע: {count} → פערים פתוחים בכל הסניפים · {count} בתורי האישורים | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.openGaps | — |
| `chain.dashboard.alerts.body` · `chain/he.ts:36` | {leak} דלף · {pct} מהרכש → {leak} דלף · {pct} מהרכש; וכשאין רכש: מפתח חדש alerts.bodyNoSpend = «{leak} דלף · אין רכש נבדק» | SHORTEN · component change; not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.alerts.calm` · `chain/he.ts:38` | שבוע רגוע: אף סניף לא דלף מעל {min} ב-7 הימים האחרונים. → שבוע רגוע: אף סניף לא דלף מעל {min}. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.ranking.subtitle` · `chain/he.ts:51` | ממוין לפי ₪ דליפה בתקופה הנבחרת → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.ranking.thinBase` · `chain/he.ts:64` | בתקופת ההשוואה כמעט אין נתונים — מוצג ההפרש בש״ח בלבד → מעט מדי נתונים לאחוז | MERGE · not on the ציקטי week-1 path · W2-16b | concept.thinBase | — |
| `chain.dashboard.heatmap.subtitle` · `chain/he.ts:68` | אחוז הדליפה מהרכש הנבדק — 6 חודשים עד סוף התקופה הנבחרת (מסומנת) → אחוז דליפה מהרכש, 6 חודשים אחרונים | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.suppliers.subtitle` · `chain/he.ts:76` | אותו ספק מאוחד לפי ח.פ או שם → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.disparity.subtitle` · `chain/he.ts:86` | אותו ספק, אותו מוצר — מחיר שונה בכל סניף. ההשפעה = (המחיר − המחיר הטוב ברשת) × הכמות בתקופה הנבחרת. → גלוי: «אותו ספק ומוצר, מחיר שונה בכל סניף.» · מתג: «איך חישבנו?» ליד "השפעה בתקופה" · מקופל: chain.explain.disparityMethod = «השפעה = (המחיר − המחיר הטוב ברשת) × הכמות בת… | FOLD · fold (`<Explain>`); not on the ציקטי week-1 path · W2-16b · ✅ method folded next to the ₪ column | concept.disparityMethod | — |
| `chain.dashboard.disparity.empty` · `chain/he.ts:103` | לא נמצאו פערי מחיר מובהקים בין הסניפים בתקופה הזו. → אין פערי מחיר בין הסניפים בתקופה הזו. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.disparity.note` · `chain/he.ts:104` | מוצגות רק התאמות בטוחות (מק״ט זהה, או שם ויחידה זהים אצל אותו ספק) עם פער של 3% לפחות. → → chain.explain.disparityMethod (מקופל, ראו disparity.subtitle) | MERGE · component change; not on the ציקטי week-1 path · W2-16b | concept.disparityMethod | — |
| `chain.dashboard.empty.body` · `chain/he.ts:108` | כשיגיעו חשבוניות לסניפים, הדליפה של כל סניף תופיע כאן. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.dashboard.upsellBody` · `chain/he.ts:111` | שדרגו למסלול "רשת" כדי לפתוח סניפים נוספים ולראות את כולם במסך אחד. → במסלול רשת: עוד סניפים, וכולם במסך אחד. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.chainUpsell | — |
| `chain.branches.subtitle` · `chain/he.ts:117` | הסניפים בחשבון החיוב שלך. כל סניף מנהל ספקים, הזמנות וחשבוניות משלו. → כל סניף מנהל ספקים, הזמנות וחשבוניות משלו. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.branches.add.body` · `chain/he.ts:131` | הסניף ייפתח באותו חשבון חיוב ואת/ה תהיו הבעלים שלו. → באותו חשבון חיוב, ואתם הבעלים. | SHORTEN · not on the ציקטי week-1 path · W2-16b | — | — |
| `chain.branches.notPayer` · `chain/he.ts:144` | רק בעל/ת חשבון החיוב (המשלם/ת) יכול/ה לפתוח סניפים חדשים בחשבון הזה. → רק בעלי חשבון החיוב פותחים סניפים חדשים. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.billingOwner | — |
| `chain.errors.notPayer` · `chain/he.ts:144` | רק בעל/ת חשבון החיוב (המשלם/ת) יכול/ה לפתוח סניפים חדשים בחשבון הזה. → רק בעלי חשבון החיוב פותחים סניפים חדשים. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.billingOwner | — |
| `chain.branches.limitReached` · `chain/he.ts:145` | הגעתם למספר הסניפים במסלול. שדרגו או פנו אלינו כדי להוסיף סניף. → הגעתם למגבלת הסניפים במסלול. שדרגו כדי להוסיף סניף. | SHORTEN · not on the ציקטי week-1 path · W2-16b | concept.branchLimit | — |
| `chain.branches.noBilling` · `chain/he.ts:147` | כדי לפתוח סניף נוסף הסניף צריך להיות משויך לחשבון חיוב. שדרגו למסלול רשת. → במסלול רשת: עוד סניפים, וכולם במסך אחד. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.chainUpsell | — |
| `chain.errors.limit` · `chain/he.ts:161` | הגעתם למגבלת הסניפים במסלול. → הגעתם למגבלת הסניפים במסלול. שדרגו כדי להוסיף סניף. | MERGE · not on the ציקטי week-1 path · W2-16b | concept.branchLimit | — |

## W2 · Ask `/dashboard/ask` (flag off)
Visible words now → after P → after W2: ask-answers · owner 1440: **226 → 226 → 200** (expl. 48) · ask-answers · manager 390: **170 → 170 → 144** (expl. 48) · ask · owner 1440: **140 → 140 → 118** (expl. 29) · ask · manager 390: **84 → 84 → 62** (expl. 29)
W2 on this screen: 10 keys, 109 → 55 explanatory words after Batch P (rendered strings).

| key · file:line | current → proposal | verdict · needs · adopter | concept | testRefs |
|---|---|---|---|---|
| `ask.subtitle` · `ask/he.ts:7` | שאלו בשפה חופשית על הכסף של המסעדה. כל תשובה מבוססת רק על הנתונים שלכם, עם קישור למסך שממנו היא באה. → כל תשובה מהנתונים שלכם, עם קישור למקור. | SHORTEN · not on the ציקטי week-1 path · G-12 · ✅ same meaning | — | — |
| `ask.placeholder` · `ask/he.ts:8` | לדוגמה: למה הדליפה עלתה החודש? → כתבו שאלה… | SHORTEN · not on the ציקטי week-1 path · G-12 | — | — |
| `ask.offlineNote.noKey` · `ask/he.ts:27` | העוזר החכם לא מחובר — זו תשובה אוטומטית מהנתונים, לחמש השאלות הנפוצות. → העוזר החכם לא מחובר. | SHORTEN · not on the ציקטי week-1 path · G-12 | concept.offlineAnswer | — |
| `ask.offlineNote.budget` · `ask/he.ts:28` | הגעתם למכסת השאלות היומית לעוזר החכם — זו תשובה אוטומטית מהנתונים. → נגמרה מכסת השאלות היומית לעוזר החכם. | SHORTEN · not on the ציקטי week-1 path · G-12 | concept.offlineAnswer | — |
| `ask.offlineNote.error` · `ask/he.ts:29` | העוזר החכם לא זמין כרגע — זו תשובה אוטומטית מהנתונים. → העוזר החכם לא זמין כרגע. | SHORTEN · not on the ציקטי week-1 path · G-12 | concept.offlineAnswer | — |
| `ask.empty` · `ask/he.ts:36` | עוד לא שאלתם. בחרו שאלה נפוצה או כתבו משלכם. → — | CUT · stop rendering (component); not on the ציקטי week-1 path · G-12 | — | — |
| `ask.answers.unknown` · `ask/he.ts:47` | אני עונה כרגע על חמש שאלות נפוצות: למה הדליפה השתנתה, כמה דלף, איזה ספק העלה מחירים, איזה ספק הכי דולף ומה לתבוע. נסו אחת מהן. → אני עונה כרגע על חמש השאלות הנפוצות. בחרו אחת מהן. | SHORTEN · not on the ציקטי week-1 path · G-12 | — | — |
| `ask.answers.claimNone` · `ask/he.ts:58` | אין כרגע פערים פתוחים לתביעה. מצוין. → אין כרגע פערים פתוחים לדרישת זיכוי. | SHORTEN · not on the ציקטי week-1 path · G-12 | — | — |
| `ask.answers.claimIntro` · `ask/he.ts:59` | אפשר לתבוע {total} ב-{count} פערים פתוחים. הגדולים: → אפשר לדרוש זיכוי על {total} ב-{count} פערים. הגדולים: | SHORTEN · not on the ציקטי week-1 path · G-12 | — | — |
| `server:ask TOO_MANY_REQUESTS` · `packages/api/src/ask/index.ts:53` | יותר מדי שאלות בדקה. נסו שוב בעוד רגע. → להחליף ב-appCode בלבד; ה-UI כבר מציג ask.rateLimited («הרבה שאלות בזמן קצר — חכו רגע ושאלו שוב.») | MERGE · server code → appCode + UI key; component change; not on the ציקטי week-1 path · G-12 · ✅ UI already shows ask.rateLimited | concept.askRateLimit | — |

---

## Appendix A · every lab capture (primary role/viewport), visible words now → after P → after W2

| area | screen | role | vp | visible now | explanatory now | after P | after W2 | screenshot |
|---|---|---|---:|---:|---:|---:|---:|---|
| A | home | manager | 390 | 246 | 73 | 244 | 206 | `A-owner-money--home--manager--phone.jpg` |
| A | home | owner | 1440 | 357 | 86 | 351 | 313 | `A-owner-money--home--owner--desktop.jpg` |
| A | home-chef | chef | 390 | 71 | 24 | 64 | 61 | `A-owner-money--home-chef--chef--phone.jpg` |
| A | home-receiver | receiver | 390 | 122 | 20 | 113 | 110 | `A-owner-money--home-receiver--receiver--phone.jpg` |
| A | leaks | manager | 390 | 149 | 38 | 137 | 131 | `A-owner-money--leaks--manager--phone.jpg` |
| A | leaks | owner | 1440 | 374 | 97 | 368 | 313 | `A-owner-money--leaks--owner--desktop.jpg` |
| A | leaks-breakdown | manager | 390 | 572 | 102 | 520 | 508 | `A-owner-money--leaks-breakdown--manager--phone.jpg` |
| A | leaks-breakdown | owner | 1440 | 664 | 102 | 612 | 600 | `A-owner-money--leaks-breakdown--owner--desktop.jpg` |
| A | leaks-claims | manager | 390 | 713 | 59 | 682 | 679 | `A-owner-money--leaks-claims--manager--phone.jpg` |
| A | leaks-claims | owner | 1440 | 770 | 59 | 739 | 736 | `A-owner-money--leaks-claims--owner--desktop.jpg` |
| A | leaks-proof | owner | 1440 | 340 | 139 | 304 | 260 | `A-owner-money--leaks-proof--owner--desktop.jpg` |
| A | leaks-report | manager | 390 | 230 | 66 | 230 | 218 | `A-owner-money--leaks-report--manager--phone.jpg` |
| A | leaks-report | owner | 1440 | 297 | 66 | 297 | 285 | `A-owner-money--leaks-report--owner--desktop.jpg` |
| A | reports-digest | owner | 1440 | 175 | 32 | 175 | 158 | `A-owner-money--reports-digest--owner--desktop.jpg` |
| A | reports-monthly | manager | 390 | 133 | 17 | 133 | 127 | `A-owner-money--reports-monthly--manager--phone.jpg` |
| A | reports-monthly | owner | 1440 | 188 | 17 | 188 | 182 | `A-owner-money--reports-monthly--owner--desktop.jpg` |
| B | approvals | bookkeeper | 1440 | 74 | 6 | 71 | 71 | `B-ap--approvals--bookkeeper--desktop.jpg` |
| B | approvals | manager | 390 | 131 | 0 | 131 | 131 | `B-ap--approvals--manager--phone.jpg` |
| B | approvals | owner | 1440 | 305 | 19 | 305 | 290 | `B-ap--approvals--owner--desktop.jpg` |
| B | approvals (open) | bookkeeper | 1440 | 80 | 10 | 75 | 75 | `B-ap--approvals-open--bookkeeper--desktop.jpg` |
| B | approvals (open) | manager | 390 | 158 | 4 | 156 | 156 | `B-ap--approvals-open--manager--phone.jpg` |
| B | approvals (open) | owner | 1440 | 407 | 33 | 405 | 387 | `B-ap--approvals-open--owner--desktop.jpg` |
| B | exports | bookkeeper | 1440 | 188 | 92 | 188 | 130 | `B-ap--exports--bookkeeper--desktop.jpg` |
| B | exports | manager | 390 | 72 | 22 | 72 | 72 | `B-ap--exports--manager--phone.jpg` |
| B | exports | owner | 1440 | 211 | 92 | 211 | 153 | `B-ap--exports--owner--desktop.jpg` |
| B | inbox | bookkeeper | 1440 | 144 | 63 | 144 | 110 | `B-ap--inbox--bookkeeper--desktop.jpg` |
| B | inbox | manager | 390 | 145 | 63 | 145 | 117 | `B-ap--inbox--manager--phone.jpg` |
| B | inbox | owner | 1440 | 200 | 63 | 200 | 172 | `B-ap--inbox--owner--desktop.jpg` |
| B | invoice | bookkeeper | 1440 | 138 | 35 | 129 | 105 | `B-ap--invoice--bookkeeper--desktop.jpg` |
| B | invoice | manager | 390 | 110 | 35 | 101 | 84 | `B-ap--invoice--manager--phone.jpg` |
| B | invoice | owner | 1440 | 166 | 35 | 157 | 140 | `B-ap--invoice--owner--desktop.jpg` |
| B | invoice-consolidated | bookkeeper | 1440 | 300 | 42 | 291 | 271 | `B-ap--invoice-consolidated--bookkeeper--desktop.jpg` |
| B | invoice-consolidated | manager | 390 | 244 | 42 | 235 | 215 | `B-ap--invoice-consolidated--manager--phone.jpg` |
| B | invoice-consolidated | owner | 1440 | 325 | 42 | 316 | 296 | `B-ap--invoice-consolidated--owner--desktop.jpg` |
| B | invoice-consolidated-matched | owner | 1440 | 253 | 41 | 244 | 226 | `B-ap--invoice-consolidated-matched--owner--desktop.jpg` |
| B | invoice-vat | bookkeeper | 1440 | 151 | 51 | 142 | 115 | `B-ap--invoice-vat--bookkeeper--desktop.jpg` |
| B | invoice-vat | owner | 1440 | 179 | 51 | 170 | 150 | `B-ap--invoice-vat--owner--desktop.jpg` |
| B | invoices-list | owner | 1440 | 18 | 13 | 18 | 18 | `B-ap--invoices-list--owner--desktop.jpg` |
| B | payrun | bookkeeper | 1440 | 423 | 152 | 423 | 330 | `B-ap--payrun--bookkeeper--desktop.jpg` |
| B | payrun | manager | 390 | 390 | 152 | 390 | 297 | `B-ap--payrun--manager--phone.jpg` |
| B | payrun | owner | 1440 | 446 | 152 | 446 | 353 | `B-ap--payrun--owner--desktop.jpg` |
| B | payrun-last | owner | 1440 | 171 | 62 | 171 | 131 | `B-ap--payrun-last--owner--desktop.jpg` |
| C | confirmed | manager | 390 | 178 | 58 | 160 | 146 | `C-receiving--confirmed--manager--phone.jpg` |
| C | confirmed | receiver | 390 | 146 | 32 | 136 | 133 | `C-receiving--confirmed--receiver--phone.jpg` |
| C | confirmed-clean | manager | 390 | 52 | 7 | 49 | 49 | `C-receiving--confirmed-clean--manager--phone.jpg` |
| C | confirmed-clean | receiver | 390 | 54 | 7 | 51 | 51 | `C-receiving--confirmed-clean--receiver--phone.jpg` |
| C | count | manager | 390 | 154 | 30 | 138 | 138 | `C-receiving--count--manager--phone.jpg` |
| C | count | receiver | 390 | 149 | 23 | 136 | 136 | `C-receiving--count--receiver--phone.jpg` |
| C | count-done | manager | 390 | 177 | 30 | 161 | 161 | `C-receiving--count-done--manager--phone.jpg` |
| C | count-done | receiver | 390 | 172 | 23 | 159 | 159 | `C-receiving--count-done--receiver--phone.jpg` |
| C | count-noinvoice | manager | 390 | 107 | 7 | 103 | 103 | `C-receiving--count-noinvoice--manager--phone.jpg` |
| C | count-noinvoice | receiver | 390 | 109 | 7 | 105 | 105 | `C-receiving--count-noinvoice--receiver--phone.jpg` |
| C | count-ocr-failed | manager | 390 | 118 | 20 | 106 | 106 | `C-receiving--count-ocr-failed--manager--phone.jpg` |
| C | count-ocr-failed | receiver | 390 | 120 | 20 | 108 | 108 | `C-receiving--count-ocr-failed--receiver--phone.jpg` |
| C | count-ocr-reading | manager | 390 | 116 | 17 | 105 | 105 | `C-receiving--count-ocr-reading--manager--phone.jpg` |
| C | count-ocr-reading | receiver | 390 | 118 | 17 | 107 | 107 | `C-receiving--count-ocr-reading--receiver--phone.jpg` |
| C | count-ocr-ready | manager | 390 | 117 | 17 | 105 | 105 | `C-receiving--count-ocr-ready--manager--phone.jpg` |
| C | count-ocr-ready | receiver | 390 | 119 | 17 | 107 | 107 | `C-receiving--count-ocr-ready--receiver--phone.jpg` |
| C | count-offline | manager | 390 | 122 | 16 | 118 | 118 | `C-receiving--count-offline--manager--phone.jpg` |
| C | count-offline | receiver | 390 | 124 | 16 | 120 | 120 | `C-receiving--count-offline--receiver--phone.jpg` |
| C | count-photo-queued | manager | 390 | 124 | 22 | 120 | 114 | `C-receiving--count-photo-queued--manager--phone.jpg` |
| C | count-photo-queued | receiver | 390 | 126 | 22 | 122 | 116 | `C-receiving--count-photo-queued--receiver--phone.jpg` |
| C | count-tolerance | manager | 390 | 168 | 36 | 152 | 152 | `C-receiving--count-tolerance--manager--phone.jpg` |
| C | count-tolerance | receiver | 390 | 163 | 29 | 150 | 150 | `C-receiving--count-tolerance--receiver--phone.jpg` |
| C | inbox | manager | 390 | 124 | 23 | 115 | 107 | `C-receiving--inbox--manager--phone.jpg` |
| C | inbox | receiver | 390 | 124 | 23 | 115 | 107 | `C-receiving--inbox--receiver--phone.jpg` |
| C | leave-sheet | manager | 390 | 139 | 27 | 135 | 130 | `C-receiving--leave-sheet--manager--phone.jpg` |
| C | leave-sheet | receiver | 390 | 141 | 27 | 137 | 132 | `C-receiving--leave-sheet--receiver--phone.jpg` |
| C | order-capture | manager | 390 | 57 | 26 | 53 | 43 | `C-receiving--order-capture--manager--phone.jpg` |
| C | processing | manager | 390 | 48 | 9 | 48 | 39 | `C-receiving--processing--manager--phone.jpg` |
| C | processing | receiver | 390 | 50 | 9 | 50 | 41 | `C-receiving--processing--receiver--phone.jpg` |
| C | processing-slow | manager | 390 | 56 | 13 | 48 | 48 | `C-receiving--processing-slow--manager--phone.jpg` |
| C | processing-slow | receiver | 390 | 58 | 13 | 50 | 50 | `C-receiving--processing-slow--receiver--phone.jpg` |
| C | reauth | manager | 390 | 113 | 7 | 109 | 109 | `C-receiving--reauth--manager--phone.jpg` |
| C | reauth | receiver | 390 | 115 | 7 | 111 | 111 | `C-receiving--reauth--receiver--phone.jpg` |
| C | receipt-view | manager | 390 | 65 | 13 | 63 | 54 | `C-receiving--receipt-view--manager--phone.jpg` |
| C | receipt-view | receiver | 390 | 65 | 13 | 63 | 54 | `C-receiving--receipt-view--receiver--phone.jpg` |
| C | review | manager | 390 | 171 | 46 | 152 | 152 | `C-receiving--review--manager--phone.jpg` |
| C | review | receiver | 390 | 159 | 36 | 143 | 143 | `C-receiving--review--receiver--phone.jpg` |
| C | review-mismatch | manager | 390 | 167 | 28 | 147 | 147 | `C-receiving--review-mismatch--manager--phone.jpg` |
| C | review-mismatch | receiver | 390 | 169 | 28 | 149 | 149 | `C-receiving--review-mismatch--receiver--phone.jpg` |
| C | review-slip | manager | 390 | 254 | 98 | 217 | 210 | `C-receiving--review-slip--manager--phone.jpg` |
| C | review-slip | receiver | 390 | 216 | 68 | 190 | 187 | `C-receiving--review-slip--receiver--phone.jpg` |
| C | scan | manager | 390 | 54 | 17 | 45 | 45 | `C-receiving--scan--manager--phone.jpg` |
| C | scan | receiver | 390 | 56 | 17 | 47 | 47 | `C-receiving--scan--receiver--phone.jpg` |
| C | scan-offline | manager | 390 | 61 | 20 | 53 | 53 | `C-receiving--scan-offline--manager--phone.jpg` |
| C | scan-offline | receiver | 390 | 63 | 20 | 55 | 55 | `C-receiving--scan-offline--receiver--phone.jpg` |
| C | scan-quality | manager | 390 | 51 | 13 | 46 | 46 | `C-receiving--scan-quality--manager--phone.jpg` |
| C | scan-quality | receiver | 390 | 53 | 13 | 48 | 48 | `C-receiving--scan-quality--receiver--phone.jpg` |
| C | scan-uploaded | manager | 390 | 45 | 6 | 40 | 40 | `C-receiving--scan-uploaded--manager--phone.jpg` |
| C | scan-uploaded | receiver | 390 | 47 | 6 | 42 | 42 | `C-receiving--scan-uploaded--receiver--phone.jpg` |
| C | spot-check | manager | 390 | 171 | 38 | 152 | 152 | `C-receiving--spot-check--manager--phone.jpg` |
| C | spot-check | receiver | 390 | 166 | 31 | 150 | 150 | `C-receiving--spot-check--receiver--phone.jpg` |
| C | spot-mismatch | manager | 390 | 165 | 38 | 149 | 149 | `C-receiving--spot-mismatch--manager--phone.jpg` |
| C | spot-mismatch | receiver | 390 | 160 | 31 | 147 | 147 | `C-receiving--spot-mismatch--receiver--phone.jpg` |
| C | summary | manager | 390 | 61 | 11 | 58 | 55 | `C-receiving--summary--manager--phone.jpg` |
| C | summary | receiver | 390 | 63 | 11 | 60 | 57 | `C-receiving--summary--receiver--phone.jpg` |
| D | catalog | manager | 390 | 958 | 24 | 958 | 939 | `D-procurement--catalog--manager--phone.jpg` |
| D | catalog | owner | 1440 | 673 | 24 | 673 | 654 | `D-procurement--catalog--owner--desktop.jpg` |
| D | catalog-add | owner | 1440 | 251 | 17 | 251 | 234 | `D-procurement--catalog-add--owner--desktop.jpg` |
| D | catalog-add-open | owner | 1440 | 253 | 17 | 253 | 236 | `D-procurement--catalog-add-open--owner--desktop.jpg` |
| D | catalog-import | manager | 390 | 87 | 14 | 79 | 79 | `D-procurement--catalog-import--manager--phone.jpg` |
| D | catalog-import | owner | 1440 | 143 | 14 | 135 | 135 | `D-procurement--catalog-import--owner--desktop.jpg` |
| D | catalog-import-open | manager | 390 | 152 | 52 | 136 | 130 | `D-procurement--catalog-import-open--manager--phone.jpg` |
| D | catalog-import-open | owner | 1440 | 210 | 52 | 194 | 188 | `D-procurement--catalog-import-open--owner--desktop.jpg` |
| D | catalog-mapping | owner | 1440 | 119 | 27 | 119 | 98 | `D-procurement--catalog-mapping--owner--desktop.jpg` |
| D | contracts | bookkeeper | 1440 | 295 | 31 | 286 | 272 | `D-procurement--contracts--bookkeeper--desktop.jpg` |
| D | contracts | manager | 390 | 263 | 24 | 259 | 245 | `D-procurement--contracts--manager--phone.jpg` |
| D | contracts | owner | 1440 | 318 | 24 | 314 | 300 | `D-procurement--contracts--owner--desktop.jpg` |
| D | contracts-alerts | manager | 390 | 73 | 17 | 73 | 59 | `D-procurement--contracts-alerts--manager--phone.jpg` |
| D | contracts-alerts | owner | 1440 | 128 | 17 | 128 | 114 | `D-procurement--contracts-alerts--owner--desktop.jpg` |
| D | contracts-import | owner | 1440 | 148 | 17 | 139 | 139 | `D-procurement--contracts-import--owner--desktop.jpg` |
| D | contracts-import-open | owner | 1440 | 197 | 30 | 188 | 187 | `D-procurement--contracts-import-open--owner--desktop.jpg` |
| D | contracts-open | manager | 390 | 318 | 34 | 314 | 300 | `D-procurement--contracts-open--manager--phone.jpg` |
| D | contracts-open | owner | 1440 | 373 | 34 | 369 | 355 | `D-procurement--contracts-open--owner--desktop.jpg` |
| D | contracts-thresholds | owner | 1440 | 192 | 43 | 192 | 161 | `D-procurement--contracts-thresholds--owner--desktop.jpg` |
| D | order-detail | chef | 390 | 67 | 0 | 67 | 67 | `D-procurement--order-detail--chef--phone.jpg` |
| D | order-detail | manager | 390 | 167 | 47 | 167 | 141 | `D-procurement--order-detail--manager--phone.jpg` |
| D | order-detail | owner | 1440 | 226 | 47 | 226 | 200 | `D-procurement--order-detail--owner--desktop.jpg` |
| D | order-detail-cancel | manager | 390 | 136 | 40 | 136 | 111 | `D-procurement--order-detail-cancel--manager--phone.jpg` |
| D | order-detail-cancel | owner | 1440 | 195 | 40 | 195 | 170 | `D-procurement--order-detail-cancel--owner--desktop.jpg` |
| D | order-detail-closed | owner | 1440 | 183 | 48 | 183 | 150 | `D-procurement--order-detail-closed--owner--desktop.jpg` |
| D | order-detail-open | manager | 390 | 250 | 58 | 250 | 217 | `D-procurement--order-detail-open--manager--phone.jpg` |
| D | order-detail-open | owner | 1440 | 309 | 58 | 309 | 276 | `D-procurement--order-detail-open--owner--desktop.jpg` |
| D | orders | chef | 390 | 67 | 0 | 67 | 67 | `D-procurement--orders--chef--phone.jpg` |
| D | orders | manager | 390 | 521 | 16 | 516 | 510 | `D-procurement--orders--manager--phone.jpg` |
| D | orders | owner | 1440 | 386 | 16 | 381 | 375 | `D-procurement--orders--owner--desktop.jpg` |
| D | orders-capture | manager | 390 | 57 | 26 | 53 | 42 | `D-procurement--orders-capture--manager--phone.jpg` |
| D | orders-capture | owner | 1440 | 118 | 26 | 114 | 103 | `D-procurement--orders-capture--owner--desktop.jpg` |
| D | orders-filter-empty | owner | 1440 | 125 | 23 | 120 | 107 | `D-procurement--orders-filter-empty--owner--desktop.jpg` |
| D | orders-new | chef | 390 | 63 | 0 | 63 | 63 | `D-procurement--orders-new--chef--phone.jpg` |
| D | orders-new | manager | 390 | 65 | 7 | 65 | 58 | `D-procurement--orders-new--manager--phone.jpg` |
| D | orders-new | owner | 1440 | 126 | 7 | 126 | 119 | `D-procurement--orders-new--owner--desktop.jpg` |
| D | orders-new-build | manager | 390 | 98 | 19 | 98 | 79 | `D-procurement--orders-new-build--manager--phone.jpg` |
| D | orders-new-build | owner | 1440 | 159 | 19 | 159 | 140 | `D-procurement--orders-new-build--owner--desktop.jpg` |
| D | orders-new-build-open | manager | 390 | 134 | 23 | 129 | 114 | `D-procurement--orders-new-build-open--manager--phone.jpg` |
| D | orders-new-build-open | owner | 1440 | 195 | 23 | 190 | 175 | `D-procurement--orders-new-build-open--owner--desktop.jpg` |
| D | orders-new-review | manager | 390 | 98 | 11 | 98 | 91 | `D-procurement--orders-new-review--manager--phone.jpg` |
| D | orders-new-review | owner | 1440 | 159 | 11 | 159 | 152 | `D-procurement--orders-new-review--owner--desktop.jpg` |
| D | orders-search-none | manager | 390 | 72 | 28 | 59 | 53 | `D-procurement--orders-search-none--manager--phone.jpg` |
| D | portal | supplier | 390 | 184 | 22 | 184 | 171 | `D-procurement--portal--supplier--phone.jpg` |
| D | portal | supplier | 1440 | 184 | 22 | 184 | 171 | `D-procurement--portal--supplier--desktop.jpg` |
| D | portal-invalid | supplier | 390 | 29 | 15 | 29 | 18 | `D-procurement--portal-invalid--supplier--phone.jpg` |
| D | portal-open | supplier | 390 | 190 | 22 | 190 | 177 | `D-procurement--portal-open--supplier--phone.jpg` |
| D | portal-open | supplier | 1440 | 190 | 22 | 190 | 177 | `D-procurement--portal-open--supplier--desktop.jpg` |
| D | product-detail | manager | 390 | 141 | 41 | 141 | 104 | `D-procurement--product-detail--manager--phone.jpg` |
| D | product-detail | owner | 1440 | 202 | 41 | 202 | 165 | `D-procurement--product-detail--owner--desktop.jpg` |
| D | product-detail-open | manager | 390 | 154 | 47 | 154 | 117 | `D-procurement--product-detail-open--manager--phone.jpg` |
| D | product-detail-open | owner | 1440 | 215 | 47 | 215 | 178 | `D-procurement--product-detail-open--owner--desktop.jpg` |
| D | products | manager | 390 | 437 | 26 | 437 | 418 | `D-procurement--products--manager--phone.jpg` |
| D | products | owner | 1440 | 448 | 26 | 448 | 429 | `D-procurement--products--owner--desktop.jpg` |
| D | supplier-catalog | owner | 1440 | 207 | 5 | 205 | 205 | `D-procurement--supplier-catalog--owner--desktop.jpg` |
| D | supplier-contract | owner | 1440 | 130 | 19 | 121 | 121 | `D-procurement--supplier-contract--owner--desktop.jpg` |
| D | supplier-details | manager | 390 | 112 | 44 | 100 | 80 | `D-procurement--supplier-details--manager--phone.jpg` |
| D | supplier-details | owner | 1440 | 167 | 44 | 155 | 135 | `D-procurement--supplier-details--owner--desktop.jpg` |
| D | supplier-leak | manager | 390 | 157 | 9 | 155 | 155 | `D-procurement--supplier-leak--manager--phone.jpg` |
| D | supplier-leak | owner | 1440 | 212 | 9 | 210 | 210 | `D-procurement--supplier-leak--owner--desktop.jpg` |
| D | supplier-leak-card | owner | 1440 | 225 | 18 | 223 | 223 | `D-procurement--supplier-leak-card--owner--desktop.jpg` |
| D | supplier-ledger | owner | 1440 | 257 | 19 | 255 | 243 | `D-procurement--supplier-ledger--owner--desktop.jpg` |
| D | supplier-orders | owner | 1440 | 263 | 5 | 261 | 261 | `D-procurement--supplier-orders--owner--desktop.jpg` |
| D | supplier-schedule | manager | 390 | 76 | 22 | 64 | 64 | `D-procurement--supplier-schedule--manager--phone.jpg` |
| D | supplier-schedule | owner | 1440 | 131 | 22 | 119 | 119 | `D-procurement--supplier-schedule--owner--desktop.jpg` |
| D | supplier-schedule-open | manager | 390 | 93 | 15 | 91 | 91 | `D-procurement--supplier-schedule-open--manager--phone.jpg` |
| D | supplier-schedule-open | owner | 1440 | 148 | 15 | 146 | 146 | `D-procurement--supplier-schedule-open--owner--desktop.jpg` |
| D | suppliers | manager | 390 | 209 | 12 | 209 | 197 | `D-procurement--suppliers--manager--phone.jpg` |
| D | suppliers | owner | 1440 | 263 | 12 | 263 | 251 | `D-procurement--suppliers--owner--desktop.jpg` |
| D | suppliers-ledger | bookkeeper | 1440 | 210 | 32 | 210 | 194 | `D-procurement--suppliers-ledger--bookkeeper--desktop.jpg` |
| D | suppliers-ledger | manager | 390 | 178 | 32 | 178 | 162 | `D-procurement--suppliers-ledger--manager--phone.jpg` |
| D | suppliers-ledger | owner | 1440 | 233 | 32 | 233 | 217 | `D-procurement--suppliers-ledger--owner--desktop.jpg` |
| D | suppliers-open | manager | 390 | 267 | 51 | 257 | 225 | `D-procurement--suppliers-open--manager--phone.jpg` |
| D | suppliers-open | owner | 1440 | 321 | 51 | 311 | 279 | `D-procurement--suppliers-open--owner--desktop.jpg` |
| D | suppliers-scores | owner | 1440 | 211 | 12 | 211 | 199 | `D-procurement--suppliers-scores--owner--desktop.jpg` |
| E | ask | manager | 390 | 84 | 29 | 84 | 62 | `E-recovery-kitchen--ask--manager--phone.jpg` |
| E | ask | owner | 1440 | 140 | 29 | 140 | 118 | `E-recovery-kitchen--ask--owner--desktop.jpg` |
| E | ask-answers | manager | 390 | 170 | 48 | 170 | 144 | `E-recovery-kitchen--ask-answers--manager--phone.jpg` |
| E | ask-answers | owner | 1440 | 226 | 48 | 226 | 200 | `E-recovery-kitchen--ask-answers--owner--desktop.jpg` |
| E | branches | owner | 1440 | 155 | 21 | 155 | 146 | `E-recovery-kitchen--branches--owner--desktop.jpg` |
| E | chain | owner | 1440 | 458 | 95 | 458 | 396 | `E-recovery-kitchen--chain--owner--desktop.jpg` |
| E | chain-open | owner | 1440 | 668 | 95 | 668 | 606 | `E-recovery-kitchen--chain-open--owner--desktop.jpg` |
| E | inventory | chef | 390 | 136 | 77 | 136 | 101 | `E-recovery-kitchen--inventory--chef--phone.jpg` |
| E | inventory | manager | 390 | 138 | 77 | 138 | 103 | `E-recovery-kitchen--inventory--manager--phone.jpg` |
| E | inventory | owner | 1440 | 193 | 77 | 193 | 158 | `E-recovery-kitchen--inventory--owner--desktop.jpg` |
| E | inventory-count | chef | 390 | 816 | 11 | 816 | 815 | `E-recovery-kitchen--inventory-count--chef--phone.jpg` |
| E | inventory-count | manager | 390 | 1120 | 257 | 1120 | 865 | `E-recovery-kitchen--inventory-count--manager--phone.jpg` |
| E | inventory-count-done | manager | 390 | 55 | 15 | 55 | 53 | `E-recovery-kitchen--inventory-count-done--manager--phone.jpg` |
| E | inventory-count-finish | manager | 390 | 1184 | 304 | 1184 | 916 | `E-recovery-kitchen--inventory-count-finish--manager--phone.jpg` |
| E | inventory-count-none | chef | 390 | 43 | 16 | 43 | 27 | `E-recovery-kitchen--inventory-count-none--chef--phone.jpg` |
| E | inventory-count-none | manager | 390 | 44 | 16 | 44 | 28 | `E-recovery-kitchen--inventory-count-none--manager--phone.jpg` |
| E | inventory-detail | chef | 390 | 519 | 270 | 519 | 512 | `E-recovery-kitchen--inventory-detail--chef--phone.jpg` |
| E | inventory-detail | manager | 390 | 521 | 270 | 521 | 514 | `E-recovery-kitchen--inventory-detail--manager--phone.jpg` |
| E | inventory-detail | owner | 1440 | 629 | 270 | 629 | 622 | `E-recovery-kitchen--inventory-detail--owner--desktop.jpg` |
| E | recipe-detail | chef | 390 | 166 | 33 | 166 | 148 | `E-recovery-kitchen--recipe-detail--chef--phone.jpg` |
| E | recipe-detail | manager | 390 | 168 | 33 | 168 | 150 | `E-recovery-kitchen--recipe-detail--manager--phone.jpg` |
| E | recipe-detail | owner | 1440 | 224 | 33 | 224 | 206 | `E-recovery-kitchen--recipe-detail--owner--desktop.jpg` |
| E | recipe-new | chef | 390 | 93 | 26 | 93 | 86 | `E-recovery-kitchen--recipe-new--chef--phone.jpg` |
| E | recipe-new | owner | 1440 | 152 | 26 | 152 | 145 | `E-recovery-kitchen--recipe-new--owner--desktop.jpg` |
| E | recipes | chef | 390 | 192 | 43 | 192 | 174 | `E-recovery-kitchen--recipes--chef--phone.jpg` |
| E | recipes | manager | 390 | 199 | 48 | 199 | 179 | `E-recovery-kitchen--recipes--manager--phone.jpg` |
| E | recipes | owner | 1440 | 254 | 48 | 254 | 234 | `E-recovery-kitchen--recipes--owner--desktop.jpg` |
| E | recipes-changes | chef | 390 | 212 | 49 | 212 | 188 | `E-recovery-kitchen--recipes-changes--chef--phone.jpg` |
| E | recipes-changes | owner | 1440 | 274 | 54 | 274 | 248 | `E-recovery-kitchen--recipes-changes--owner--desktop.jpg` |
| E | recipes-impact | manager | 390 | 247 | 52 | 247 | 218 | `E-recovery-kitchen--recipes-impact--manager--phone.jpg` |
| E | recipes-impact | owner | 1440 | 302 | 52 | 302 | 273 | `E-recovery-kitchen--recipes-impact--owner--desktop.jpg` |
| E | recipes-import | owner | 1440 | 230 | 89 | 230 | 174 | `E-recovery-kitchen--recipes-import--owner--desktop.jpg` |
| E | recipes-import-errors | owner | 1440 | 232 | 93 | 232 | 176 | `E-recovery-kitchen--recipes-import-errors--owner--desktop.jpg` |
| E | recipes-pos | manager | 390 | 164 | 85 | 164 | 116 | `E-recovery-kitchen--recipes-pos--manager--phone.jpg` |
| E | recipes-pos | owner | 1440 | 219 | 85 | 219 | 171 | `E-recovery-kitchen--recipes-pos--owner--desktop.jpg` |
| E | recovery | manager | 390 | 918 | 52 | 910 | 877 | `E-recovery-kitchen--recovery--manager--phone.jpg` |
| E | recovery | owner | 1440 | 1029 | 52 | 1021 | 988 | `E-recovery-kitchen--recovery--owner--desktop.jpg` |
| E | recovery-confirm-recovered | manager | 390 | 942 | 67 | 934 | 901 | `E-recovery-kitchen--recovery-confirm-recovered--manager--phone.jpg` |
| E | recovery-confirm-recovered | owner | 1440 | 1053 | 67 | 1045 | 1012 | `E-recovery-kitchen--recovery-confirm-recovered--owner--desktop.jpg` |
| E | recovery-confirm-writeoff | manager | 390 | 958 | 72 | 950 | 917 | `E-recovery-kitchen--recovery-confirm-writeoff--manager--phone.jpg` |
| E | recovery-confirm-writeoff | owner | 1440 | 1070 | 73 | 1062 | 1029 | `E-recovery-kitchen--recovery-confirm-writeoff--owner--desktop.jpg` |
| E | recovery-credit | manager | 390 | 967 | 68 | 957 | 915 | `E-recovery-kitchen--recovery-credit--manager--phone.jpg` |
| E | recovery-credit | owner | 1440 | 1078 | 68 | 1068 | 1026 | `E-recovery-kitchen--recovery-credit--owner--desktop.jpg` |
| F | account-menu | bookkeeper | 1440 | 379 | 235 | 373 | 242 | `F-shell-settings--account-menu--bookkeeper--desktop.jpg` |
| F | account-menu | owner | 1440 | 413 | 225 | 407 | 284 | `F-shell-settings--account-menu--owner--desktop.jpg` |
| F | admin | owner | 1440 | 45 | 0 | 45 | 45 | `F-shell-settings--admin--owner--desktop.jpg` |
| F | admin-leads | owner | 1440 | 36 | 7 | 36 | 36 | `F-shell-settings--admin-leads--owner--desktop.jpg` |
| F | admin-restaurant | owner | 1440 | 82 | 0 | 82 | 82 | `F-shell-settings--admin-restaurant--owner--desktop.jpg` |
| F | check-email | anon | 390 | 40 | 21 | 33 | 33 | `F-shell-settings--check-email--anon--phone.jpg` |
| F | forbidden | bookkeeper | 1440 | 101 | 34 | 90 | 87 | `F-shell-settings--forbidden--bookkeeper--desktop.jpg` |
| F | forbidden | chef | 390 | 67 | 34 | 56 | 53 | `F-shell-settings--forbidden--chef--phone.jpg` |
| F | forbidden | receiver | 390 | 72 | 34 | 61 | 58 | `F-shell-settings--forbidden--receiver--phone.jpg` |
| F | integrations | bookkeeper | 1440 | 144 | 61 | 138 | 111 | `F-shell-settings--integrations--bookkeeper--desktop.jpg` |
| F | integrations | manager | 390 | 98 | 61 | 92 | 63 | `F-shell-settings--integrations--manager--phone.jpg` |
| F | integrations | owner | 1440 | 220 | 88 | 214 | 174 | `F-shell-settings--integrations--owner--desktop.jpg` |
| F | integrations-open | manager | 390 | 128 | 83 | 122 | 84 | `F-shell-settings--integrations-open--manager--phone.jpg` |
| F | integrations-open | owner | 1440 | 250 | 110 | 244 | 195 | `F-shell-settings--integrations-open--owner--desktop.jpg` |
| F | invite-notfound | owner | 1440 | 27 | 13 | 23 | 23 | `F-shell-settings--invite-notfound--owner--desktop.jpg` |
| F | invite-notfound | receiver | 390 | 27 | 13 | 23 | 23 | `F-shell-settings--invite-notfound--receiver--phone.jpg` |
| F | login | anon | 1440 | 47 | 19 | 45 | 35 | `F-shell-settings--login--anon--desktop.jpg` |
| F | login | anon | 390 | 47 | 19 | 45 | 35 | `F-shell-settings--login--anon--phone.jpg` |
| F | login-consent | anon | 1440 | 60 | 26 | 58 | 48 | `F-shell-settings--login-consent--anon--desktop.jpg` |
| F | login-consent | anon | 390 | 60 | 26 | 58 | 48 | `F-shell-settings--login-consent--anon--phone.jpg` |
| F | login-error | anon | 390 | 51 | 23 | 49 | 39 | `F-shell-settings--login-error--anon--phone.jpg` |
| F | login-invited | anon | 390 | 56 | 28 | 49 | 39 | `F-shell-settings--login-invited--anon--phone.jpg` |
| F | login-sent | anon | 390 | 55 | 27 | 53 | 43 | `F-shell-settings--login-sent--anon--phone.jpg` |
| F | login-signedin | owner | 1440 | 23 | 17 | 15 | 15 | `F-shell-settings--login-signedin--owner--desktop.jpg` |
| F | more-sheet | chef | 390 | 170 | 114 | 164 | 88 | `F-shell-settings--more-sheet--chef--phone.jpg` |
| F | more-sheet | manager | 390 | 420 | 249 | 414 | 275 | `F-shell-settings--more-sheet--manager--phone.jpg` |
| F | more-sheet | receiver | 390 | 172 | 114 | 166 | 90 | `F-shell-settings--more-sheet--receiver--phone.jpg` |
| F | notfound-root | owner | 1440 | 18 | 13 | 10 | 10 | `F-shell-settings--notfound-root--owner--desktop.jpg` |
| F | notfound-root | receiver | 390 | 18 | 13 | 10 | 10 | `F-shell-settings--notfound-root--receiver--phone.jpg` |
| F | notfound-shell | manager | 390 | 48 | 27 | 40 | 37 | `F-shell-settings--notfound-shell--manager--phone.jpg` |
| F | notfound-shell | owner | 1440 | 103 | 27 | 95 | 92 | `F-shell-settings--notfound-shell--owner--desktop.jpg` |
| F | offline | manager | 390 | 366 | 254 | 360 | 221 | `F-shell-settings--offline--manager--phone.jpg` |
| F | offline | owner | 1440 | 408 | 230 | 402 | 279 | `F-shell-settings--offline--owner--desktop.jpg` |
| F | offline | receiver | 390 | 163 | 119 | 157 | 81 | `F-shell-settings--offline--receiver--phone.jpg` |
| F | reauth | manager | 390 | 394 | 277 | 379 | 239 | `F-shell-settings--reauth--manager--phone.jpg` |
| F | reauth | owner | 1440 | 436 | 253 | 421 | 297 | `F-shell-settings--reauth--owner--desktop.jpg` |
| F | reset | anon | 390 | 30 | 12 | 23 | 23 | `F-shell-settings--reset--anon--phone.jpg` |
| F | reset-choose | anon | 390 | 45 | 24 | 36 | 33 | `F-shell-settings--reset-choose--anon--phone.jpg` |
| F | reset-sent | anon | 390 | 32 | 16 | 32 | 32 | `F-shell-settings--reset-sent--anon--phone.jpg` |
| F | search | manager | 390 | 365 | 249 | 359 | 220 | `F-shell-settings--search--manager--phone.jpg` |
| F | search | owner | 1440 | 417 | 231 | 411 | 288 | `F-shell-settings--search--owner--desktop.jpg` |
| F | search-results | owner | 1440 | 413 | 231 | 407 | 284 | `F-shell-settings--search-results--owner--desktop.jpg` |
| F | set-password | owner | 1440 | 32 | 11 | 32 | 26 | `F-shell-settings--set-password--owner--desktop.jpg` |
| F | set-password | receiver | 390 | 32 | 11 | 32 | 26 | `F-shell-settings--set-password--receiver--phone.jpg` |
| F | settings | bookkeeper | 1440 | 370 | 235 | 364 | 233 | `F-shell-settings--settings--bookkeeper--desktop.jpg` |
| F | settings | chef | 390 | 156 | 114 | 150 | 74 | `F-shell-settings--settings--chef--phone.jpg` |
| F | settings | manager | 390 | 361 | 249 | 355 | 216 | `F-shell-settings--settings--manager--phone.jpg` |
| F | settings | owner | 1440 | 403 | 225 | 397 | 274 | `F-shell-settings--settings--owner--desktop.jpg` |
| F | settings | receiver | 390 | 158 | 114 | 152 | 76 | `F-shell-settings--settings--receiver--phone.jpg` |
| F | team | manager | 390 | 114 | 43 | 96 | 83 | `F-shell-settings--team--manager--phone.jpg` |
| F | team | owner | 1440 | 227 | 46 | 221 | 194 | `F-shell-settings--team--owner--desktop.jpg` |

Lab = `:3351`, build ab9908c4 (26 commits older than the release; the source wins on any conflict). Every dashboard capture carries the stale-worker banner (16–17 words) because the lab worker is down. Not reachable in the lab and inventoried from source: chef `orders/new` (403 on that build), held/re-auth states, most error and empty states.

## Appendix B · reconciled duplicates (one key, two auditors)

| key | areas | kept | why |
|---|---|---|---|
| `overview.board.noPo.hint` | A: SHORTEN «בלי הזמנה? בקשו ממנהל/ת המשמרת לפתוח הזמנה.» / C: SHORTEN «בקשו ממנהל/ת המשמרת לפתוח הזמנה.» | בקשו מאחראי המשמרת לפתוח הזמנה. | Batch P value (house style, accuracy) |
| `overview.board.empty.hint` | A: SHORTEN «משלוחים מהזמנות עם תאריך יופיעו כאן.» / C: SHORTEN «משלוחים מהזמנות עם תאריך יופיעו כאן.» | משלוחים מהזמנות עם תאריך יופיעו כאן. | Batch P value (house style, accuracy) |
| `overview.board.receipt.followUp.hint` | A: SHORTEN «הקבלה תיפתח שוב לספירת המשלוח · נרשם ביומן» / C: SHORTEN «הקבלה תיפתח שוב לספירת המשלוח · נרשם ביומן» | קבלת הסחורה תיפתח שוב לספירת המשלוח · נרשם ביומן | Batch P value (house style, accuracy) |
| `views.filteredNote` | A: SHORTEN «מוצג לפי הסינון» / B: SHORTEN «מוצג לפי הסינון» | מוצג לפי הסינון | Batch P value (house style, accuracy) |
| `views.toolbar.noSaved` | A: SHORTEN «אין תצוגות שמורות» / B: SHORTEN «אין תצוגות שמורות» | אין תצוגות שמורות | the stricter verdict; KEEP loses to a real change |
| `views.toolbar.savedHint` | A: KEEP «ללא שינוי» / B: KEEP «ללא שינוי» | ללא שינוי | the stricter verdict; KEEP loses to a real change |
| `vat.invoice.missing` | A: KEEP «ללא שינוי» / B: KEEP «ללא שינוי» | ללא שינוי | the stricter verdict; KEEP loses to a real change |
| `vat.invoice.invalid` | A: KEEP «ללא שינוי» / B: KEEP «ללא שינוי» | ללא שינוי | the stricter verdict; KEEP loses to a real change |
| `vat.invoice.deadline` | A: SHORTEN «אפשר לנכות עד {date} בערך, עם חשבונית מתוקנת.» / B: SHORTEN «אפשר לנכות עד {date} בערך, עם חשבונית מתוקנת.» | אפשר לנכות עד {date} בערך, עם חשבונית מתוקנת. | the stricter verdict; KEEP loses to a real change |
| `vat.invoice.closed` | A: SHORTEN «חלון הניכוי נסגר בערך ב-{date}.» / B: SHORTEN «חלון הניכוי נסגר בערך ב-{date}.» | חלון הניכוי נסגר בערך ב-{date}. | the stricter verdict; KEEP loses to a real change |
| `dockPrice.title` | B: SHORTEN «חציון {days} הימים האחרונים · {count} חשבוניות» / C: FOLD «toggle "איך חישבנו?" → folded: "החציון של מה ששילמתם לספק על הפריט ב־{» | toggle "איך חישבנו?" → folded: "החציון של מה ששילמתם לספק על הפריט ב־{days} הימים האחרונים | the stricter verdict; KEEP loses to a real change |
| `dockPrice.usual` | B: SHORTEN «המחיר הרגיל:» / C: SHORTEN «מחיר רגיל:» | מחיר רגיל: | the stricter verdict; KEEP loses to a real change |
| `ingest.inbox.subtitle` | B: SHORTEN «חשבוניות שהגיעו בוואטסאפ ובמייל.» / C: SHORTEN «חשבוניות שהגיעו בוואטסאפ ובמייל» | חשבוניות שהגיעו בוואטסאפ ובמייל | the stricter verdict; KEEP loses to a real change |
| `ingest.inbox.emptyDescription` | B: SHORTEN «הגדירו כתובת למטה ושלחו חשבונית לניסיון.» / C: SHORTEN «הגדירו כתובת קליטה למטה ושלחו חשבונית לניסיון» | הגדירו כתובת קליטה למטה ושלחו חשבונית לניסיון | the stricter verdict; KEEP loses to a real change |
| `ingest.channels.subtitle` | B: SHORTEN «הכתובות סודיות — שתפו אותן רק עם הספקים.» / C: SHORTEN «כתובת סודית — רק מי שמכיר אותה יכול לשלוח» | כתובת סודית — רק מי שמכיר אותה יכול לשלוח | the stricter verdict; KEEP loses to a real change |
| `ingest.channels.whatsappHint` | B: KEEP «ללא שינוי» / C: KEEP «—» | — | the stricter verdict; KEEP loses to a real change |
| `ingest.channels.emailHint` | B: CUT «» / C: KEEP «—» |  | the stricter verdict; KEEP loses to a real change |
| `ingest.channels.newSecret` | B: KEEP «ללא שינוי» / C: KEEP «—» | — | the stricter verdict; KEEP loses to a real change |
| `ingest.channels.rotateWarning` | B: KEEP «ללא שינוי» / C: KEEP «—» | — | the stricter verdict; KEEP loses to a real change |
| `ingest.channels.disabled` | B: KEEP «ללא שינוי» / C: CUT «— (מפתח מת)» | — (מפתח מת) | the stricter verdict; KEEP loses to a real change |
| `ingest.senders.subtitle` | B: SHORTEN «שולחים מהרשימה נכנסים לפענוח בלי בדיקה.» / C: SHORTEN «משולחים מאושרים — לפענוח מיד. מאחרים — לבדיקה שלכם» | משולחים מאושרים — לפענוח מיד. מאחרים — לבדיקה שלכם | the stricter verdict; KEEP loses to a real change |
| `ingest.senders.empty` | B: KEEP «ללא שינוי» / C: KEEP «—» | — | the stricter verdict; KEEP loses to a real change |
| `ingest.errors.quota_exceeded` | B: SHORTEN «נגמרה המכסה היומית בערוץ הזה.» / C: KEEP «—» | נגמרה המכסה היומית בערוץ הזה. | the stricter verdict; KEEP loses to a real change |
| `ingest.errors.unsupported_type` | B: KEEP «ללא שינוי» / C: SHORTEN «סוג קובץ לא נתמך — רק תמונה או PDF» | סוג קובץ לא נתמך — רק תמונה או PDF | the stricter verdict; KEEP loses to a real change |
| `ingest.orderCapture.inboxNeedsSupplier` | B: KEEP «ללא שינוי» / C: KEEP «—» | — | the stricter verdict; KEEP loses to a real change |
| `common.shell.offline.chip` | C: KEEP «—» / F: KEEP «—» | — | the stricter verdict; KEEP loses to a real change |
| `common.shell.session.body` | C: SHORTEN «התחברו שוב — העבודה שלכם נשמרה.» / F: SHORTEN «התחברו שוב — העבודה שלכם נשמרה.» | התחברו שוב — העבודה שלכם נשמרה. | Batch P value (house style, accuracy) |
| `ingest.orderCapture.subtitle` | C: FOLD «visible: "הדביקו את ההזמנה ששלחתם לספק" + toggle "למה?" → folded: "נהפ» / D: FOLD «גלוי: «הדביקו את ההזמנה ששלחתם לספק» · מתג «למה?» · מקופל: «כל חשבונית» | visible: "הדביקו את ההזמנה ששלחתם לספק" + toggle "למה?" → folded: "נהפוך אותה להזמנת רכש,  | the stricter verdict; KEEP loses to a real change |
| `ingest.orderCapture.textHint` | C: SHORTEN «שורה לכל פריט: כמות, יחידה, שם» / D: SHORTEN «בכל שורה: כמות, יחידה ופריט.» | בכל שורה: כמות, יחידה ופריט. | Batch P value (house style, accuracy) |
| `ingest.orderCapture.noLines` | C: SHORTEN «לא מצאנו שורות הזמנה — הדביקו את ההודעה המלאה» / D: SHORTEN «לא מצאנו שורות הזמנה. הדביקו את ההודעה המלאה.» | לא מצאנו שורות הזמנה. הדביקו את ההודעה המלאה. | Batch P value (house style, accuracy) |
| `ingest.orderCapture.pickSupplierHint` | C: SHORTEN «לא זיהינו את הספק — בחרו אותו פעם אחת» / D: SHORTEN «לא זיהינו את הספק — בחרו אותו.» | לא זיהינו את הספק — בחרו אותו. | Batch P value (house style, accuracy) |
| `ingest.orderCapture.noSuppliers` | C: SHORTEN «אין עדיין ספקים» / D: MERGE «עוד אין ספקים פעילים.» | עוד אין ספקים פעילים. הוסיפו ספק קודם. | Batch P value (house style, accuracy) |
| `ingest.orderCapture.draftHint` | C: SHORTEN «בדקו ואשרו · לא נשלח דבר לספק» / D: SHORTEN «בדקו ואשרו · לא נשלח דבר לספק» | בדקו ואשרו · לא נשלח דבר לספק | Batch P value (house style, accuracy) |
| `ingest.orderCapture.alreadyCaptured` | C: KEEP «—» / D: KEEP «ללא שינוי» | — | the stricter verdict; KEEP loses to a real change |
| `ingest.orderCapture.confirmed` | C: KEEP «—» / D: KEEP «ללא שינוי» | — | the stricter verdict; KEEP loses to a real change |

## Appendix C · pilot-flagged rows left out of Batch P on purpose

| key | why not in P |
|---|---|
| `approvals.summary.split` | pinned by queue-summary.test.ts + approvals-router.test.ts; saves 1 word |
| `approvals.summary.vat` | saves 1 word |
| `approvals.card.error` | the proposal drops "נסו שוב" (an error must say what to do) |
| `auth.login.errors.rate` | no saving; becomes a key merge in W2 |
| `auth.invite.genericError` | grows the string; W2 |
| `auth.serverErrors.invalidInput` | auth.serverErrors values double as a Hebrew lookup table (serverErrors.ts:53); needs the server prose change in the same PR → W2 |
| `auth.serverErrors.generic` | same lookup-table trap |
| `auth.signin.queuedOne` | W1-09.spec.ts:89 pins "צילום חשבונית אחד ממתין במכשיר"; saves 2 words |
| `auth.signin.queuedMany` | pair of queuedOne |
| `common.shell.session.otherUserLink` | saves 1 word |
| `components.errors.network` | no saving; W1-08 holds components/he.ts |
| `components.activity.awaitingDeliveryNotes` | consolidatedMatch is off for ציקטי; ops-components.test.ts pins he + en |
| `components.activity.awaitingMonthlyMatch` | same |
| `contracts.import.dropHint` | would duplicate the formats line on the same screen until W2 cuts one |
| `contracts.import.formats` | same |
| `contracts.import.unsupportedType` | no saving |
| `contracts.import.tooBig` | grows the string |
| `contracts.import.rowsDetected` | no saving |
| `contracts.import.mapRequired` | key merge (W2) |
| `catalog.import.dropHint` | no saving |
| `catalog.import.rowsDetected` | no saving |
| `catalog.import.mapNameRequired` | key merge (W2) |
| `catalog.import.tooBig` | drops the 9MB limit from the error |
| `contracts.over.truncated` | the dropped half is a ₪-accuracy hint ("at least this amount") |
| `dockPrice.usual` | dockPriceContext is never on for ציקטי |
| `leakProof.capped` | no saving |
| `orders.wizard.totalExcludes` | key merge (W2) |
| `orders.wizard.totalExcludesOne` | key merge (W2) |
| `orders.errors.noContact` | not on the record-only week-1 path |
| `orders.errors.whatsappGated` | not on the record-only week-1 path |
| `orders.wizard.deliveryHint` | dead key in a train-B co-owned file (W1-11): delete in W2 cleanup |
| `orders.wizard.scheduleHint` | same |
| `orders.wizard.reasonNoSchedule` | same |
| `orders.detail.cancelSentWarning` | same (W1-11 may reuse it for the truthful send status) |
| `approvals.empty.description` | not dead: list.tsx:977 reads it as the filtered fallback; W2-04 drops the fallback, then the key (31.10 verification) |
| `overview.homeSubtitle.owner` | rendered but hidden; removing the key needs page.tsx (W2-08) |
| `overview.hero.delta.noneYoy` | key merge (W2) |
| `overview.hero.returnedHint` | saves 2 words, wording gets vaguer |
| `receiving.steps.scan.network` | key merge (delete this key, read receiving.errors.network) → W2-05 |
| `recipes.overviewCard.empty` | recipes is off for ציקטי |
| `team.invite.rateLimited` | saves 1 word |
| `vat.card.separate` | vatAtRisk is off for ציקטי |
| `vat.card.clearHint` | vatAtRisk is off |
| `vat.request.hint` | vatAtRisk is off |
| `views.toolbar.noSaved` | dashViews is off for ציקטי |
| `views.delta.thinBase` | dashViews is off |

---

## Verification (adversarial pass, Sat 31.10.2026)

**Method.** Source of truth `rw-release @ 96d47226`, read only. Every catalog was loaded with `tsx` and flattened. Every key path was mapped to its he/en line. Every Batch P key was traced to its `t()` call, dynamic ones included (`types.${type}.explain`, `import.errors.${key}`, `send.cta.${channel}`, `homeSubtitle.${role}`, `tabEmpty.${tab}`, serverErrors by appCode). For each Batch P row, all 391 test files (`apps/**/e2e`, `**/__tests__`, `*.test|spec.*`) were grepped for the old he and en fragments and for the key. Every Batch P merge was compared with `shared-explanations.he.draft.ts` (71 concepts). The W2 sample has 70 rows across all 32 W2 areas. It is weighted to FOLD, MERGE and CUT rows and to binding-rule hazards: ₪, T4, terms, a11y, dead keys and the WhyLine.

### Counts

| | checked | ✅ | ❌ | what happened to the ❌ |
|---|---:|---:|---:|---|
| Batch P rows | 205 | 184 | 21 | 17 fixed in place, 3 moved to W2, 1 dropped (current value kept) |
| Batch W2 rows (sample) | 70 | 49 | 21 | all 21 fixed in place (proposal and/or needs cell) |
| Current values vs source (205 P + 398 W2 catalog rows; the 9 server/inline rows not machine-checkable, 3 of them re-read by hand: global-error.tsx:77, receiving.ts:769, :924) | 603 | 603 | 0 | 0 drift. 3 line numbers were wrong: `orders.detail.reorder` he 52 → **125**, `orders.detail.loadErrorBody` he 59 → **136**, brief `PRICE_LOWER.explain` en 143 → **147** |
| Batch P testRefs | 205 | 168 | 37 | added: receiver-langs.test.ts on 33 overlaid rows (`overview.board.*`, `receiving.*`, `receivingDelivery.*`); serverErrors.test.ts:30 (`invoiceNumberTaken`); vocab.test.ts:240 (`DUPLICATE_INVOICE.explain`); vocab.test.ts:20-37 (`tolerance.date`, `tolerance.vat`). All still pass |
| Central help centre / glossary proposed | 4 files + OWNER.he.md | none | 0 | W2-16 §4, the draft header and OWNER.he.md say there is none. W2-13's `GLOSSARY` stays code-side and points to `explain.*`, so it is not a page |

**Moved P → W2 (3):** `approvals.why.sourceP90` (W2-04). It is WhyLine evidence, and it needed `vocab.test.ts:221/:295` edited; with it out, Batch P has **no test edit**. `catalog.import.queued` (W2-16b) and `recovery.hero.returnedHint` (W2-10) are key removals, not values, and dead, so the pilot gains 0 words from them. **Dropped (1):** `receivingDelivery.delivery.confirmed.bulkNote` keeps its current value. The proposal lost "סומנו כמו בהזמנה" (the lines were recorded at the ordered quantity), which turned a calm T4 note into a bare negative.

**Batch P values corrected (17):** `overview.hero.calc` · `common.errorPage.body` · `auth.reset.token` · `auth.reset.requestSubtitle` · `common.shell.session.magicSent` · `overview.board.noPo.hint` · `overview.board.empty.hint` · `receivingDelivery.delivery.count.offline` · `receiving.steps.scan.frameHint` · `receiving.dockSlip.afterClose` · `leaks.hub.subtitle` · `leaks.breakdown.subtitle` · `contracts.over.emptyBody` · `catalog.import.errors.NO_ROWS` · `orders.wizard.missedCutoff` · `suppliers.form.deliveryTitle` · `suppliers.form.deliveryHint`. Each row's verdict cell gives the reason, and the cell keeps the first proposal as *(was: …)*.

### Corrected totals (same MECHANISM §5.1 metric; the script reproduces the old 7,303 / 6,393 / 4,422 before the corrections)

| | rows | explanatory words | change vs today |
|---|---:|---:|---:|
| Rendered today | 853 strings | 7,303 | |
| After Batch P | **201** (196 inventoried + 5 term labels; was 205) | **6,408** (was 6,393) | **−895 (12.3%)** (was −910) |
| After W2 | **410** keys (was 407) | **4,448** (was 4,422) | **−2,855 (39.1%)** (was −2,881) |

Batch P by verdict: SHORTEN 171 · MERGE 21 · interim 4 (2 CUT + 2 FOLD) · term labels 5 · key removals 0. All-keys verdicts: SHORTEN 371 · KEEP 291 · CUT 106 · MERGE 93 · FOLD 31. The per-screen "Batch P on this screen" lines are recomputed where they changed: Home, Shell, Sign-in, Delivery Check, Approvals, Leak hub, Suppliers, Contracts, Catalog. The per-capture "visible words now → after P → after W2" figures (section headers and Appendix A) were **not re-measured**. Known shifts are ≤ ±4 words per capture, for example leak proof after W2 ≈ 264 (was 260), because `leakProof.rules` now shows the full `explain.leakRule`.

### Top problems found

1. **The Batch P leak-rule copy depended on another PR's ₪-math change.** `overview.hero.calc` called "שורת הזמנה לא חויבה" not counted. On main, `LEAK_FILTER` (`packages/charts/src/leak-views.ts:134`) still counts it. Batch P now ships only what is true today. The item goes into W1-08's LEAK_FILTER PR, in the same commit as the filter.
2. **Rows that were not values-only, or that changed tested evidence:** `approvals.why.sourceP90` (a WhyLine string pinned by vocab.test.ts) and two key deletions. All three moved to W2, and Batch P now needs no test edit.
3. **Copy pointing at UI that is not there, or doubling it:** the root error page and `global-error` show the "code" only when `error.digest` exists, yet the proposal said "שלחו לנו את הקוד". `auth.reset.token` repeated the link "בקשת קישור חדש" printed right after it. The reset subtitle "נשלח קישור…" read as "a link was sent" before anything was sent.
4. **Lost meaning, conditions or numbers:** bulkNote (T4), `leaks.hub.subtitle` ("בחשבוניות שנבדקו"), `contracts.over.emptyBody` (90 days), `leaks.breakdown.subtitle` (it listed every invoice "with a פער" although PRICE_LOWER-only invoices are not listed), offline count "בטלפון", `catalog.import.errors.NO_ROWS` (the action), and in W2 `consolidated.status.differencesBody` (its only ₪ figure).
5. **Shared wording drifted from the draft, or broke a binding rule, in W2:** UNORDERED_ARRIVAL still pointed to the withdrawn, false `explain.pendingNotCounted`. `vat.card.subtitle` put a ₪ placeholder in a fold body. Two server rows used bare "הקבלה". Both outstanding rows used singular "לך". `leakProof.rules` and `leaks.report.method` did not read `explain.leakRule`. The pendingLink, threeWayMatch, creepHow, lateAlert and viewOnly rows each quoted a different wording. `approvals.empty.description` was called dead although `list.tsx:977` reads it.

### Out of this file's edit scope (flagged for the owners)

- `shared-explanations.he.draft.ts`: four concepts need updating.
  - `errorRetry` lists the root error page and `global-error`, but its wording needs the code. Keep it for the in-shell boundary and give the root and global pages the no-code wording.
  - `linkExpired`: the canonical key should be `auth.login.errors.verification`, because `auth.reset.token` now drops "בקשו קישור חדש".
  - `leakRule`: Batch P no longer sets the item list. The P part is the version without "שורת הזמנה לא חויבה".
  - `lateAlert.he`: replace with the corrected wording ("עד שעת ההגעה").
- `RULES.he.md` example 1 still teaches the withdrawn claim "עד השיוך הן לא נספרות בדליפה ובהוצאה" (`explain.pendingNotCounted`). Example 3 quotes `receiving.inbox.emptyDescription`, which is dead, and a "[פתחו קבלה]" button, which uses bare "קבלה".
- `W2-16.md` line 2 still says Batch P takes the words to 6,393 and W2 to ≈4,420. The corrected figures are 6,408 and ≈4,450. Nothing else in W2-16.md conflicts with these corrections, and it proposes no help centre: §4 "No help centre, no glossary page, no tooltips".
- `ar/ru/th/ti` overlays keep the old meaning of every overlaid key that Batch P changes. That includes the false "owner was notified" in `nav.worker.ownerNotified`. W2-05 re-translates from the final Hebrew.
