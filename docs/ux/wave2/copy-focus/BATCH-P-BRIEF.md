# Batch P · Copy focus, values only (train B)

**Session:** new, Batch P · **startsAfter:** #167 merged (Sun 1.11) · **PR green:** Tue 3.11, 18:00 IST · **ships:** train B (cut-off Tue 3.11 20:00, Rom merges Wed 4.11 08:00), merged **last** inside the train · **owner agent:** web-feature-engineer (catalog values) · no test edit (verified 31.10; test-sentinel only re-runs the suites below).

```
PILOT BRIEF Batch P: shorter in-app explanations on the ציקטי pilot screens, values only

GOAL
Owner, 31.10: "למקד טקסטים בתוך המערכת" — then: "לא חייב מקום אחד להסברים, אפשר להשאיר איפה שקיים אבל
בצורה יעילה יותר". Explanations stay on their screen. Before go-live (Sun 8.11) we only shorten them, cut the
dead ones and give repeated ideas one wording, by editing catalog VALUES. Folds, cuts that need a component,
and the shared `explain` namespace come in wave 2 (W2-16). 201 keys in 18 catalog file pairs; the rendered
explanatory text on the pilot screens drops from 7,303 to 6,408 words (−895). Every new value is in the
tables below; do not re-word them. If one reads wrong on screen, drop that row and say so in the PR body.

WHAT YOU CHANGE
1. The values in the tables below, he AND en in the same commit (i18n.test checks key and placeholder
   parity; where a row removes a placeholder it is removed from both). "—" in the en column = keep the
   current en value.
2. No key is removed and no test is edited. (31.10 verification: the two dead-key removals, catalog
   `import.queued` and recovery `hero.returnedHint`, and `approvals.why.sourceP90`, whose new value needed
   vocab.test.ts:221/:295 edited, moved to W2. A failing test means a row is wrong: drop the row, never edit
   the test.)

BOUNDARY (values only)
- No key added, renamed, moved or removed.
- No component, layout, className, fold, new namespace or new placeholder. If a row seems to need code,
  drop it to W2 and list it in the PR body.
- receiverLangs/** untouched: ar/ru/th/ti overlays keep their current text (no overlaid key is removed;
  they are machine translations pending native review, and W2-05 re-translates from the final Hebrew).
  Overlaid keys you change in he/en are marked "overlays untouched" below.
- auth.serverErrors.*: only invoiceNumberTaken changes (it resolves by appCode). The other values double as
  a Hebrew lookup table (lib/serverErrors.ts:53) — never touch them in this batch.
- Binding rules hold, and every value below already respects them: legal text untouched; ₪/destructive
  confirmations untouched; a11y names only shortened; T4 pending/מרכזת lines calm; terms מרכזת, פער,
  דרישת זיכוי, קבלת סחורה, דליפה (monthly only), "מחירים שעלו"; no "יעד"; no ₪ on a receiver or chef screen
  (the two dock-slip notes lose their ₪ character); plural imperative.

ORDER AND CO-OWNED FILES (the train-B path partition)
- Branch claude/copy-focus-batch-p from origin/main after #167. Rebase on main after train A merges
  (Tue 3.11 ~09:30; S5 changes suppliers/he.ts there), then on release/pilot-b once the co-owners below are in.
- Day-1 message to the orchestrator: ask OK for the co-owned files (one line each). Without that OK, skip those
  rows and list them in the PR body as "W2".
    approvals/he.ts, leakProof/he.ts   → W1-08 PR 1 (terminology sweep, values only). Rebase on it; where you
                                         both touch a value, keep W1-08's term and re-apply your shortening.
                                         Or hand W1-08 these rows to apply inside its sweep — same kind of edit.
    leaks/he.ts                        → W1-08 PR 2 (letterhead; different keys)
    receiving/he.ts, receiving/delivery.he.ts → W1-06 (MUST). Never delay W1-06: you rebase on it, not the reverse.
    orders/he.ts                       → W1-11 (truthful send status). If W1-11 rewords a key you also change,
                                         W1-11 wins; drop your row.
    invoices/he.ts                     → S2
  All other files (overview, nav, common, auth, ingest, catalog, contracts, recovery, suppliers, team, views)
  have no train-B co-owner.
- overview.hero.calc lists only what is true on main today: LEAK_FILTER (packages/charts/src/leak-views.ts:134)
  still counts MISSING_ON_INVOICE. W1-08 adds ו"שורת הזמנה לא חויבה" to this value (he + en) inside its own
  LEAK_FILTER PR, in the same commit as the filter change, and aligns leakProof.rules there. Copy never
  ships ahead of the ₪ math it describes.

TESTS AND CHECKS (in your lab, `. ~/.rm-lab/<slug>/env && …`)
1. pnpm --filter @restomatch/web exec vitest run lib/__tests__/i18n.test.ts lib/__tests__/receiver-langs.test.ts \
     lib/__tests__/serverErrors.test.ts app/dashboard/approvals/__tests__/vocab.test.ts \
     app/dashboard/leaks/__tests__/letters.test.ts app/dashboard/home/__tests__ lib/components/__tests__ --reporter=dot
2. pnpm --filter @restomatch/web typecheck (after `next build`; the overlays are type-checked).
3. Text pins: for every changed value, grep the OLD Hebrew and OLD English in tests. The known pins (verified
   31.10 over 391 test files) all still pass: letters.test.ts:337, vocab.test.ts:20-37 (tolerance.*) and :240
   (DUPLICATE_INVOICE), serverErrors.test.ts:30-43 (invoiceNumberTaken by appCode), receiver-langs.test.ts
   (overlay placeholders = he on every overview.board/receiving/receivingDelivery row; no placeholder changes
   there), W1-05.spec.ts:429 / W1-11.spec.ts:682,693 / orders-wizard-delivery.spec.ts:73,79 /
   demo-path.spec.ts:456 (read the catalog at runtime → pass; :79 splits send.cta.none on "{supplier}", which
   the new value no longer has, so the regex becomes the whole label and still matches — re-run it). Command:
     git diff -U0 origin/main -- apps/web/lib/i18n/messages | grep "^-  *[A-Za-z]" | sed -E "s/^-[^:]*: *'(.{0,24}).*/\1/" \
       | sort -u | while read -r s; do [ ${#s} -ge 12 ] && rg -lF -- "$s" apps/web/e2e apps/web/app apps/web/lib packages/api/src --glob '*{test,spec}.ts*'; done | sort -u
   Anything it prints that is not in the list above: fix the expected string in YOUR spec, or drop the row.
4. e2e on the touched routes: playwright test e2e/W1-05.spec.ts e2e/W1-06.spec.ts e2e/W1-11.spec.ts \
     e2e/orders-wizard-delivery.spec.ts e2e/W1-04.spec.ts e2e/W1-09.spec.ts e2e/demo-path.spec.ts e2e/a11y.spec.ts
5. Look at the screens once (shot.cjs, he 390 for receiver/chef/manager, he 1440 for owner): /dashboard (owner,
   chef, receiver), /dashboard/receiving and one /dashboard/receiving/<poId>, /dashboard/approvals (manager 390),
   /dashboard/leaks, /dashboard/leaks/proof, /dashboard/leaks/claims, /dashboard/orders/new,
   /dashboard/orders/capture, /dashboard/recovery, /dashboard/suppliers (form open), /login. No overflow, no
   axe regression, no English in he.
6. Terms on the changed lines print nothing:
     git diff -U0 origin/main -- apps/web/lib/i18n/messages | grep '^+' | rg "יעד|חריג|ריכוז|תביע|קליטת"
7. The two pilot-RULES path checks print nothing (immutable paths; additive files).

DONE =
- Draft PR "pilot: copy focus Batch P (values only)": the tables (applied / dropped rows), "no test edited",
  the commands you ran with their result, the co-owner rebases, and "W2" for anything dropped.
- CI green on a branch updated to the train head. Self-repair cap 2.
- Demo ₪ invariants unchanged (copy only): `check:demo` before/after identical.
- ONE send_message to the orchestrator: PR link, head SHA, keys applied/dropped, test evidence.

DO NOT
- Touch components, routes, receiverLangs/**, any immutable file, or another package's lines.
- Re-word a value, add a fold, or create the `explain` namespace (W2-16 owns them).
```

## Exact edits (rw-release @ 96d47226; re-grep after each rebase; verified 31.10, see "Verification" at the end)

Line numbers are the key line in `apps/web/lib/i18n/messages/<file>`; the en line is in the note. Files without a co-owner first.

### `auth/he.ts` + `auth/en.ts` — 15 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 19 | `login.invitedHint` | ההזמנה נשלחה לכתובת הזו. | Your invite was sent to this address. | (en line 17) |
| 21 | `login.resetDone` | הסיסמה עודכנה. התחברו עם הסיסמה החדשה. | Password updated. Sign in with the new one. | devices sign-out is said once, before the reset (en line 19) |
| 24 | `login.errors.verification` | הקישור פג או כבר נוצל. בקשו קישור חדש. | This link expired or was already used. Request a new one. | merge:linkExpired (en line 22) |
| 27 | `login.errors.emailSignin` | לא הצלחנו לשלוח קישור. נסו שוב בעוד כמה דקות. | We couldn't send a link. Try again in a few minutes. | (en line 25) |
| 33 | `checkEmail.body` | שלחנו קישור כניסה, תקף ל-24 שעות. | We sent a sign-in link, valid for 24 hours. | merge:magicLink (en line 31) |
| 47 | `reset.requestSubtitle` | הזינו את המייל, ונשלח אליו קישור איפוס. | Enter your email and we'll send you a reset link. | **31.10 fix:** "נשלח קישור איפוס" reads as past tense ("a link was sent") on the page before anything was sent; keeps the action. the "if registered" wording stays in resetFlow.sentTo (en line 45) |
| 53 | `reset.chooseSubtitle` | כל המכשירים יתנתקו אחרי האיפוס. | All devices are signed out after the reset. | merge:devicesSignOut (canonical) (en line 51) |
| 56 | `reset.token` | הקישור פג או כבר נוצל. | This link expired or was already used. | **31.10 fix:** reset/page.tsx:40-43 puts the link "בקשת קישור חדש" right after it; "בקשו קישור חדש." doubled it. linkExpired: the canonical moves to login.errors.verification (en line 54) |
| 112 | `signin.lockoutHint` | הכניסה ננעלת לזמן קצר. אפשר להיכנס בלי סיסמה: | Sign-in locks for a short while. You can sign in without a password: | (en line 108) |
| 120 | `signin.newHere` | חדשים? הכניסה הראשונה בקישור במייל פותחת חשבון. | New here? Your first sign-in by email link opens an account. | (en line 116) |
| 125 | `mail.sentTo` | שלחנו קישור כניסה ל-{email}, תקף ל-24 שעות. | We sent a sign-in link to {email}, valid for 24 hours. | merge:magicLink (canonical "sent" line) (en line 120) |
| 152 | `inviteState.usedBody` | כבר בצוות? היכנסו. אחרת, בקשו הזמנה חדשה. | Already on the team? Sign in. Otherwise, ask for a new invite. | (en line 145) |
| 154 | `inviteState.notFoundBody` | פתחו שוב את הקישור מהמייל, או בקשו הזמנה חדשה. | Open the link from the email again, or ask for a new invite. | (en line 147) |
| 163 | `resetFlow.sentTo` | אם {email} רשומה אצלנו, שלחנו אליה קישור לאיפוס. | If {email} is registered with us, we sent it a reset link. | (en line 155) |
| 192 | `serverErrors.invoiceNumberTaken` | המספר {invoiceNumber} כבר רשום אצל הספק הזה ({holderDate}). | Number {invoiceNumber} is already used by this supplier ({holderDate}). | resolved by appCode invoice.numberTaken (serverErrors.ts:37), not by the Hebrew lookup; the "open existing invoice" link stays (en line 184) |

### `catalog/he.ts` + `catalog/en.ts` — 15 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 98 | `import.subtitle` | טענו מחירון ספק מ-Excel או CSV. | Load a supplier price list from Excel or CSV. | (en line 97) |
| 110 | `import.noSuppliers` | עוד אין ספקים. הוסיפו את ספק המחירון: | No suppliers yet. Add the price list's supplier: | (en line 109) |
| 114 | `import.formats` | Excel או CSV, גם בעברית · עד 9MB | Excel or CSV, Hebrew files too · up to 9 MB | concept.fileLimits (en line 113) |
| 137 | `import.vat.hint` | מחירים כולל מע״מ יישמרו בלי מע״מ ({rate}). | Prices with VAT are stored ex-VAT ({rate}). | accuracy: the rate is the supplier's override first (catalog.ts:104), not "the restaurant's" (en line 136) |
| 151 | `import.check.flaggedSummary` | {count} מחירים רחוקים מהמחירון — בדקו לפני הייבוא. | {count} prices are far from the price list — check before importing. | (en line 150) |
| 156 | `import.check.heldHint` | תקנו בקובץ (למשל 12.90) וייבאו שוב. השאר ייובאו. | Fix it in the file (e.g. 12.90) and import again. The rest is imported. | (en line 155) |
| 163 | `import.progress.leave` | אפשר לעזוב — הייבוא ימשיך ברקע. | You can leave — the import continues in the background. | (en line 162) |
| 170 | `import.review.noSuggestion` | אין הצעה. | No suggestion. | the picker + "new product" button stay (en line 169) |
| 193 | `import.review.laterHint` | אפשר לחזור לזה מהיסטוריית הייבוא בכרטיס הספק. | You can come back to it from the import history on the supplier's page. | (en line 192) |
| 210 | `import.errors.TOO_LARGE` | הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV. | The file is too large. Split it or save it as CSV. | merge:fileLimits (= contracts.import.errors.TOO_LARGE) (en line 209) |
| 212 | `import.errors.LEGACY_XLS` | קובץ ‎.xls ישן. שמרו אותו כ-‎.xlsx או CSV. | Old .xls file. Save it as .xlsx or CSV. | merge:fileLimits (en line 211) |
| 213 | `import.errors.UNREADABLE` | הקובץ לא נקרא. העלו ‎.xlsx או CSV תקין. | The file couldn't be read. Upload a valid .xlsx or CSV. | merge:fileLimits (en line 212) |
| 214 | `import.errors.EMPTY` | חסרה שורת כותרות בשורה הראשונה. | The first row must hold the column headers. | merge:fileLimits (en line 213) |
| 215 | `import.errors.NO_ROWS` | אין שמות מוצרים בעמודה שנבחרה. בדקו את המיפוי. | No product names in the selected column. Check the mapping. | **31.10 fix:** an error keeps what to do. (en line 214) |
| 217 | `import.errors.FLAGGED_PRICES` | סמנו שבדקתם את המחירים המסומנים. | Confirm you checked the flagged prices. | merge: the checkbox says the rest (en line 215) |

### `common/he.ts` + `common/en.ts` — 14 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 62 | `errorPage.body` | נסו שוב. אם זה חוזר, רעננו את העמוד או חזרו מאוחר יותר. | Try again. If it keeps happening, refresh the page or come back later. | **31.10 fix:** app/error.tsx:38 shows the code only when error.digest exists, so "שלחו לנו את הקוד" can point at nothing; no longer merge:errorRetry. (en line 64) |
| 67 | `notFound.body` | הקישור שגוי או שהדף הוסר. | The link is wrong or the page was removed. | merge:notFound (en line 69) |
| 78 | `shell.session.body` | התחברו שוב — העבודה שלכם נשמרה. | Sign in again — your work is saved. | merge:sessionExpired (en line 79) |
| 79 | `shell.session.notSent` | לא נשלח · התחברו ונסו שוב. | Not sent · sign in and try again. | (en line 80) |
| 84 | `shell.session.wrong` | פרטים שגויים או יותר מדי ניסיונות. נסו שוב בעוד רגע. | — | (en line 85) |
| 85 | `shell.session.magicLink` | שלחו לי קישור כניסה למייל | Email me a sign-in link | merge:magicLink (one name: "קישור כניסה") (en line 86) |
| 86 | `shell.session.magicSent` | שלחנו קישור כניסה ל־{email}. פתחו אותו וחזרו לכאן. | We sent a sign-in link to {email}. Open it and come back here. | **31.10 fix:** one name for the link: "קישור כניסה" (draft magicLinkSent). (en line 87) |
| 88 | `shell.session.twoFactor` | נדרש אימות דו־שלבי. השלימו אותו בלשונית חדשה וחזרו לכאן. | Two-step verification needed. Finish it in a new tab, then come back. | (en line 89) |
| 103 | `shell.forbidden.requestBody` | נפתח לכם הודעה מוכנה עם הקישור. | We'll open a ready message with the link. | (en line 104) |
| 111 | `shell.forbidden.refreshBody` | רעננו את הגישה כדי לפתוח את ‘{screen}’. | Refresh your access to open '{screen}'. | refreshTitle "התפקיד שלכם עודכן" gives the reason (en line 112) |
| 114 | `shell.forbidden.notMember` | בקשו מהבעלים להוסיף אתכם לסניף. | Ask the owner to add you to this branch. | notMemberTitle gives the reason; the home button stays (en line 115) |
| 120 | `shell.notFound.body` | הקישור שגוי, הדף נמחק, או שהוא בסניף אחר. | Wrong link, deleted page, or another branch. | merge:notFound (en line 121) |
| 127 | `shell.error.body` | נסו שוב. אם זה חוזר, שלחו לנו את הקוד. | Try again. If it keeps happening, send us the code. | merge:errorRetry (canonical) (en line 128) |
| 133 | `shell.error.offline` | אין חיבור. נטען את הדף כשהרשת תחזור. | No connection. We'll load the page when the network is back. | same phrase as the offline chip (en line 134) |

### `contracts/he.ts` + `contracts/en.ts` — 10 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 10 | `readOnly` | צפייה בלבד | View only | merge:viewOnly (en line 8) |
| 49 | `list.emptyBody` | כל חיוב מעל מחיר החוזה יסומן בחשבונית. | Any charge above the contract price is flagged on the invoice. | the add/import buttons stay (en line 47) |
| 82 | `import.subtitle` | העלו קובץ CSV או XLSX עם מחירי החוזה. | Upload a CSV or XLSX file of contract prices. | (en line 80) |
| 137 | `import.errors.TOO_LARGE` | הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV. | The file is too large. Split it or save it as CSV. | merge:fileLimits (en line 135) |
| 139 | `import.errors.LEGACY_XLS` | קובץ ‎.xls ישן. שמרו אותו כ-‎.xlsx או CSV. | Old .xls file. Save it as .xlsx or CSV. | merge:fileLimits (en line 137) |
| 140 | `import.errors.UNREADABLE` | הקובץ לא נקרא. העלו ‎.xlsx או CSV תקין. | The file couldn't be read. Upload a valid .xlsx or CSV. | merge:fileLimits (en line 138) |
| 141 | `import.errors.EMPTY` | חסרה שורת כותרות בשורה הראשונה. | The first row must hold the column headers. | merge:fileLimits (en line 139) |
| 148 | `over.subtitle` | לפי החוזה שהיה בתוקף ביום החשבונית. | By the contract in force on the invoice date. | (en line 146) |
| 163 | `over.emptyBody` | ב־90 הימים האחרונים הכל חויב במחיר החוזה או מתחתיו. | In the last 90 days everything was billed at or below the contract price. | **31.10 fix:** keeps the 90-day window (the query is windowed); T3 calm (en line 161) |
| 168 | `over.leaksBody` | {count} שורות חויבו מעל החוזה | {count} lines billed above the contract | (en line 166) |

### `ingest/he.ts` + `ingest/en.ts` — 5 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 107 | `orderCapture.textHint` | בכל שורה: כמות, יחידה ופריט. | Each line: quantity, unit and item. | (en line 106) |
| 110 | `orderCapture.noLines` | לא מצאנו שורות הזמנה. הדביקו את ההודעה המלאה. | No order lines found. Paste the whole message. | (en line 109) |
| 112 | `orderCapture.pickSupplierHint` | לא זיהינו את הספק — בחרו אותו. | We couldn't tell the supplier — pick it. | (en line 111) |
| 113 | `orderCapture.noSuppliers` | עוד אין ספקים פעילים. הוסיפו ספק קודם. | No active suppliers yet. Add one first. | merge:noSuppliers; keeps the instruction (no button on this screen) (en line 112) |
| 117 | `orderCapture.draftHint` | בדקו ואשרו · לא נשלח דבר לספק | Check and confirm · nothing is sent to the supplier | (en line 116) |

### `nav/he.ts` + `nav/en.ts` — 3 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 126 | `worker.title` | העיבוד מתעכב. | Processing is delayed. | every dashboard page, every role; demo-path.spec.ts:456 reads the catalog → passes (en line 122) |
| 127 | `worker.body` | חשבוניות שתעלו יישמרו ויעובדו אחר כך. | Invoices you upload are saved and processed later. | (en line 123) |
| 129 | `worker.ownerNotified` | אין צורך לפעול. | No action needed. | interim + accuracy: "הבעלים קיבל התראה" is false (the watchdog mails ops); W2 cuts the key (en line 125) |

### `overview/he.ts` + `overview/en.ts` — 17 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 23 | `homeSubtitle.chef` | ספירה ועלות מנות. | Stock count and dish cost. | interim + term: removes "יעד" from the pilot chef home (W2-08 cuts it) (en line 19) |
| 51 | `hero.pending` | {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — לרוב מרכזות. עד השיוך הן לא בהוצאה. | {count} invoices ({amount}) waiting to be linked to an order — mostly consolidated. Until linked they are not in the spend. | interim (W2 folds the why); accuracy: drops the false "לא נספרות בדליפה" — findings on them do count (leak-hero.ts). T4 calm (en line 46) |
| 52 | `hero.awaitingCount` | {count} חשבוניות ({amount}) ממתינות לסגירת קבלת הסחורה | {count} invoices ({amount}) waiting for their goods receipt to close | (en line 47) |
| 53 | `hero.clean` | אין דליפה · {count} חשבוניות נבדקו ✓ | No leak · {count} invoices checked ✓ | merge:clean (= leaks.states.clean) (en line 48) |
| 54 | `hero.calc` | נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה". | Counts warning- and blocker-level discrepancies, capped at each invoice total. Not counted: "Price below expected" and "Waiting for a PO link". | **31.10 fix:** true on main today (LEAK_FILTER, leak-views.ts:134 still counts MISSING_ON_INVOICE). "שורת הזמנה לא חויבה" ships inside W1-08's LEAK_FILTER PR, same commit as the filter, never ahead of it. merge:leakRule (P part); accuracy: the ⓘ said "invoices with no order" are excluded, which is false (en line 49) |
| 55 | `hero.thinBase` | מוקדם לאחוז: נבדקו רק {count} חשבוניות | Too early for a %: only {count} invoices checked | (en line 50) |
| 58 | `hero.noData.hint` | הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה. | The leak is calculated once an invoice is matched to its order and goods receipt. | merge:noData (en line 53) |
| 66 | `hero.delta.none` | אין נתוני השוואה | Nothing to compare with | merge:noCompare (= views.delta.noBase) (en line 61) |
| 114 | `chef.dishesTitle` | מנות שעלות המזון שלהן עלתה | Dishes whose food cost rose | term: no "יעד" (label, not inventoried) (en line 108) |
| 115 | `chef.dishesSubtitle` | עלות המזון עלתה מעל {target} בגלל מחיר רכיב. | Food cost rose above {target} because an ingredient got pricier. | term: no "יעד"; % only, no ₪ (en line 109) |
| 118 | `chef.dishesNone` | אין מנות כאלה החודש ✓ | None this month ✓ | term: no "יעד" (label, not inventoried) (en line 112) |
| 148 | `board.noPo.hint` | בקשו מהמנהל לפתוח הזמנה. | Ask the manager to open an order. | **31.10 fix:** "אחראי המשמרת" is no role in the app (lib/roles.ts: מנהל/ת); no slash form; overlays untouched (en line 142) |
| 152 | `board.empty.hint` | משלוחים מהזמנות עם תאריך אספקה יופיעו כאן. | Deliveries from orders with a delivery date show up here. | **31.10 fix:** "עם תאריך" alone is vague; overlays untouched (en line 146) |
| 156 | `board.receipt.readOnly` | צפייה בלבד | View only | merge:viewOnly; W1-05.spec.ts:429 reads the catalog → passes; overlays untouched (en line 150) |
| 165 | `board.receipt.followUp.hint` | קבלת הסחורה תיפתח שוב לספירת המשלוח · נרשם ביומן | The goods receipt reopens to count this delivery · logged | term: bare "הקבלה" → "קבלת הסחורה"; overlays untouched (en line 159) |
| 177 | `leaks.subtitle` | מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה | Above the usual price from the same supplier · not part of the leak | merge:creep + notInLeak (en line 171) |
| 185 | `activity.emptyDescription` | היומן יתמלא כשחשבוניות ייקלטו. | The log fills up as invoices come in. | (en line 179) |

### `recovery/he.ts` + `recovery/en.ts` — 7 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 9 | `tracker.errorBody` | שום שינוי לא אבד. | No change was lost. | errorTitle + retry stay (en line 8) |
| 15 | `tracker.outstandingHint` | {count} דרישות · מתוך {claimed} שנדרשו | {count} claims · of {claimed} claimed | (en line 14) |
| 48 | `tracker.tabEmpty.todo` | אין דרישות פתוחות. | No open claims. | (en line 47) |
| 53 | `tracker.emptyHint` | פערים שתאשרו לדרישה יופיעו כאן. | Gaps you approve for a claim show up here. | pilot: ציקטי starts with zero claims (en line 52) |
| 59 | `tracker.suggestionsHint` | שורה שלילית בחשבונית מאוחרת — סגרו איתה דרישות בלחיצה. | A negative line on a later invoice — close claims with it in one click. | (en line 58) |
| 86 | `followUp.reminderNote` | שום דבר לא נשלח לספק בלי לחיצה שלכם. | Nothing reaches the supplier until you press send. | merge:noSendWithoutTap (en line 85) |
| 163 | `creditForm.claims` | יוחל על {count} דרישות ({amount}), מהישנה לחדשה. | Applied to {count} claims ({amount}), oldest first. | (en line 162) |

### `suppliers/he.ts` + `suppliers/en.ts` — 13 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 15 | `scores.emptyBody` | הדירוג יופיע אחרי החשבוניות הראשונות. | The ranking appears after the first invoices. | English "(match runs)" out (en line 14) |
| 32 | `manager.emptyBody` | הוסיפו את הספקים שאתם מזמינים מהם. | Add the suppliers you order from. | (en line 31) |
| 55 | `form.nameEn` | שם באנגלית | English name | the hint under the field keeps the why (W2 folds it: explain.englishName) (en line 53) |
| 63 | `form.deliveryTitle` | לוח אספקה — ימים ושעת הגעה אחרונה | Delivery schedule — days and latest arrival time | **31.10 fix:** no "יעד"; "שעה אחרונה" collides with the order cutoff "שעה אחרונה להזמנה" on the same supplier card (en line 61) |
| 64 | `form.deliveryHint` | אם עד שעת ההגעה לא נקלטה קבלת סחורה, תופיע התראת איחור. | If no goods receipt is recorded by the arrival time, a late-delivery alert appears. | **31.10 fix:** "עד השעה האחרונה" also reads "up to the past hour"; interim + term: removes "שעת היעד" and "תעודת קבלה"; W2-11 folds it (en line 62) |
| 86 | `detail.leakLabel` | מחירים שעלו · 30 יום | Prices that rose · 30 days | term: one name for price creep (en line 84) |
| 101 | `catalogTab.emptyBody` | ייבאו את מחירון הספק מ-Excel או CSV. | Import the supplier's price list from Excel or CSV. | (en line 99) |
| 107 | `ordersTab.emptyBody` | צרו את ההזמנה הראשונה לספק. | Create the first order for this supplier. | (en line 105) |
| 113 | `schedule.emptyBody` | הגדירו מתי מזמינים — ותאריך האספקה יחושב לבד. | Set when you order — the delivery date is worked out for you. | (en line 111) |
| 127 | `schedule.pickCutoff` | הזינו שעה אחרונה להזמנה. | Enter the order cutoff time. | (en line 125) |
| 133 | `schedule.clearedPending` | שמרו כדי למחוק את לוח ההזמנות. | Save to delete the order schedule. | (en line 131) |
| 140 | `leakCard.lines` | {count} שורות עם פער | — | term: "חריגה" → "פער" (supplierLeakCard is on for ציקטי) (en line 138) |
| 142 | `leakCard.topTypes` | שלושת סוגי הפער הגדולים | — | term (en line 140) |

### `team/he.ts` + `team/en.ts` — 1 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 8 | `managerNote` | הזמנות ותפקידים — לבעלים בלבד. | Invites and roles — owners only. | (en line 7) |

### `views/he.ts` + `views/en.ts` — 1 keys · no train-B co-owner

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 132 | `filteredNote` | מוצג לפי הסינון | Showing the filtered view | approvals passes it as the empty note (en line 134) |

### `approvals/he.ts` + `approvals/en.ts` — 16 keys · train-B co-owner: **W1-08 (PR 1, terminology sweep)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 13 | `empty.clearDescription` | פערים חדשים יופיעו כאן. | New discrepancies will show up here. | (en line 10) |
| 14 | `empty.othersWaiting` | אין פערים שמחכים לכם. | Nothing is waiting for you. | merge:othersWaiting; drops {count},{role},{amount} in he AND en (the lane below shows them); also fixes singular "לך" (en line 11) |
| 15 | `empty.othersWaitingMany` | אין פערים שמחכים לכם. | Nothing is waiting for you. | merge:othersWaiting; drops {count},{amount} in he AND en (en line 12) |
| 32 | `others.readOnly` | צפייה בלבד | View only | merge:viewOnly (en line 29) |
| 96 | `card.forbidden` | אין הרשאה להחליט על הפער הזה. | — | term: singular "לך" out (en line 93) |
| 120 | `undo.failed` | כבר אי אפשר לבטל. | It can no longer be undone. | (en line 117) |
| 127 | `errorPage.body` | שום החלטה לא אבדה. | No decision was lost. | title above says what failed; retry button stays (en line 124) |
| 146 | `types.PRICE_HIGHER.explain` | מחיר ליחידה גבוה מההזמנה או ממחירי העבר. | Unit price above the order or past prices. | (en line 143) |
| 150 | `types.PRICE_LOWER.explain` | חויב פחות מהמצופה. לא נספר בדליפה. | Billed less than expected. Not counted in the leak. | (en line 147) |
| 166 | `types.MISSING_ON_INVOICE.explain` | ייתכן שיחויב בחשבונית אחרת. | It may be billed on another invoice. | (en line 163) |
| 170 | `types.UNIT_MISMATCH.explain` | יחידה שונה מההזמנה, בלי המרה. | Unit differs from the order, no conversion. | (en line 167) |
| 179 | `types.DUPLICATE_INVOICE.explain` | מספר החשבונית כבר נקלט מהספק הזה. | This invoice number was already received from this supplier. | vocab.test.ts:240 still passes (en line 176) |
| 183 | `types.DATE_ANOMALY.explain` | תאריך החשבונית רחוק ממועד האספקה. | The invoice date is far from the delivery date. | (en line 180) |
| 187 | `types.VAT_MISMATCH.explain` | סכום המע״מ לא תואם לשיעור. | The VAT amount doesn't match the rate. | (en line 184) |
| 198 | `tolerance.date` | ±{days} ימים | ±{days} days | vocab.test.ts:27-37 still pass (no English in he) (en line 195) |
| 205 | `tolerance.vat` | מע״מ {rate}, ±{amount} | {rate} VAT, ±{amount} | (en line 202) |

### `invoices/he.ts` + `invoices/en.ts` — 4 keys · train-B co-owner: **S2 (one invoice per receipt)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 8 | `correction.subtitle` | תקנו שורות שנקראו שגוי והריצו התאמה מחדש. | Fix lines that were read wrong, then re-run the match. | W2 shows it only to editors of a non-מרכזת invoice (en line 7) |
| 37 | `correction.duplicateOf` | חשבונית כפולה אפשרית: מספר {number} כבר קיים אצל הספק. מספר שגוי? תקנו למטה. | Possible duplicate: number {number} already exists for this supplier. Wrong number? Fix it below. | merge:possibleDuplicate (en line 36) |
| 38 | `correction.ocrFailed` | לא הצלחנו לקרוא את החשבונית. הזינו ידנית או צלמו שוב. | We couldn't read the invoice. Enter it by hand or retake the photo. | term: "קליטת הסחורה" out (en line 37) |
| 39 | `correction.ocrQuota` | מכסת הסריקות החודשית נגמרה. הזינו את הנתונים ידנית. | This month's scan quota is used up. Enter the data by hand. | (en line 38) |

### `leakProof/he.ts` + `leakProof/en.ts` — 8 keys · train-B co-owner: **W1-08 (PR 1, terminology sweep)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 9 | `subtitle` | {month} | {month} | the h1 "איך הגענו ל־₪X?" says the rest (en line 7) |
| 16 | `pct` | {pct} = {amount} ÷ {spend} רכש שנבדק, לפני מע״מ | {pct} = {amount} ÷ {spend} checked spend, before VAT | (en line 14) |
| 17 | `pctNone` | אין עדיין רכש שנבדק — אין אחוז | No checked spend yet — no percentage | (en line 15) |
| 19 | `pending` | {count} חשבוניות ({amount}) ממתינות לשיוך להזמנה — לרוב מרכזות. הסכום שלהן לא נכנס לרכש שנבדק עד השיוך; ממצאים עליהן כן נספרים. | {count} invoices ({amount}) waiting to be linked to an order — mostly consolidated. Their amount stays out of checked spend until linked; findings on them still count. | term: removes "חשבוניות ריכוז"; keeps the accurate rule (leak-hero.ts) (en line 17) |
| 22 | `topHint` | לפי חשבונית, עד סכום החשבונית | Per invoice, up to the invoice total | concept.cap (en line 20) |
| 31 | `caught` | {amount} מהדליפה עוד אפשר לעצור לפני תשלום | {amount} of the leak can still be stopped before payment | merge:caught (same phrase as leaks.report.caughtChip) (en line 29) |
| 34 | `resolvedNote` | מתוכם {amount} ({items}) אושרו אך אינם במכתב. | Of which {amount} ({items}) was approved but is in no letter. | merge:resolvedNote — byte-identical with leaks.report.resolvedNote (en line 32) |
| 40 | `footer` | אותם סכומים כמו בחדר הבקרה, עד האגורה. | The same amounts as the control room, to the agora. | (en line 38) |

### `leaks/he.ts` + `leaks/en.ts` — 15 keys · train-B co-owner: **W1-08 (PR 2, letterhead)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 13 | `hub.subtitle` | כסף שחויבתם מעבר להזמנה ולמה שהתקבל, בחשבוניות שנבדקו, לפני מע״מ. | Money billed beyond the order and what arrived, on checked invoices, before VAT. | **31.10 fix:** keeps the condition "בחשבוניות שנבדקו" of the one definition of דליפה, which stays here (en line 8) |
| 17 | `hub.error.body` | שום נתון לא אבד. | Nothing was lost. | title + retry stay (en line 12) |
| 24 | `states.noDataHint` | הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה. | The leak is calculated once an invoice is matched to its order and goods receipt. | merge:noData (= overview.hero.noData.hint); "קבלת הסחורה", never bare "קבלה" (en line 19) |
| 35 | `detective.roleOnly` | המחירים שעלו — לבעלים בלבד. | Prices that rose — owners only. | (en line 30) |
| 37 | `detective.emptyDescription` | צריך לפחות 3 מחירים לכל מוצר וספק. | Needs at least 3 prices per product and supplier. | (en line 32) |
| 58 | `heatmap.more` | ועוד {count} פריטים | and {count} more | accuracy: the owner home reuses it and has no table below (en line 52) |
| 62 | `breakdown.subtitle` | כל חשבונית שתרמה לדליפה ב{month}, מהגדולה לקטנה. | Every invoice that added to the leak in {month}, largest first. | **31.10 fix:** "כל חשבונית עם פער" over-claims: an invoice with only PRICE_LOWER/info gaps is not listed (leak-hero.ts:228). (en line 56) |
| 84 | `breakdown.noMoneyShort` | כבר נספר בשורת החיוב העודף | Already counted in the over-billed line | ×6 per month in the lab; letters.test.ts:337 still passes (en line 78) |
| 96 | `claims.reminder.note` | שום דבר לא נשלח לספק בלי לחיצה שלכם. | Nothing reaches the supplier until you press send. | merge:noSendWithoutTap (en line 90) |
| 103 | `claims.subtitle` | מכתב לכל ספק · נכון ל{month} | One letter per supplier · as of {month} | (en line 97) |
| 116 | `claims.notTracked` | אשרו בתור האישורים כדי לעקוב אחרי השליחה. | Approve in the approvals queue to track sending. | (en line 110) |
| 136 | `claims.note` | במכתב רק פערים שאושרו לדרישה ועוד לא נשלחו. | The letter holds only gaps approved for a claim and not yet sent. | merge:inLetter (en line 130) |
| 139 | `claims.undecided.body` | {count} פערים מחכים להחלטה — לא במכתב עד אישור. | {count} gaps await a decision — not in the letter until approved. | (en line 133) |
| 177 | `claims.mixedBasis` | בסיס המע״מ מצוין ליד כל שורה. | Each line shows its VAT basis. | (en line 171) |
| 204 | `report.resolvedNote` | מתוכם {amount} ({items}) אושרו אך אינם במכתב. | Of which {amount} ({items}) was approved but is in no letter. | merge:resolvedNote (monthlyReport is on for ציקטי) (en line 198) |

### `orders/he.ts` + `orders/en.ts` — 29 keys · train-B co-owner: **W1-11 (truthful send status)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 42 | `list.emptyBody` | רשמו כאן כל הזמנה לספק. | Record every supplier order here. | week 1 = record-only (en line 41) |
| 50 | `list.noSearchResults` | אין הזמנות שמתאימות לחיפוש. | No orders match the search. | W1-11.spec.ts reads the catalog → passes (en line 49) |
| 51 | `list.searchScope` | החיפוש רק בהזמנות שנטענו. | Search covers loaded orders only. | (en line 50) |
| 52 | `list.reorder` | הזמינו שוב | — | term: plural imperative (button, not inventoried) (en line 51) |
| 125 | `detail.reorder` | הזמינו שוב | — | term (en line 124) |
| 53 | `list.reorderAria` | הזמינו שוב מ{supplier} | — | term; a11y name kept (en line 52) |
| 59 | `list.loadErrorBody` | ההזמנות שלכם לא נפגעו. | Your orders are safe. | title + retry stay (en line 58) |
| 136 | `detail.loadErrorBody` | ההזמנה לא נפגעה. | The order is safe. | (en line 135) |
| 74 | `reorder.failed` | ההזמנה הקודמת לא נטענה. אפשר להזמין כרגיל. | The previous order didn't load. You can order as usual. | (en line 73) |
| 86 | `draft.switched` | ההזמנה ל{from} נשמרה כטיוטה. | The {from} order is saved as a draft. | drops {to},{count} in he AND en (en line 85) |
| 93 | `draft.staleSent` | ההזמנה ל{supplier} כבר נשלחה ({ref}) — לא תישלח שוב. | The order to {supplier} was already sent ({ref}) — it won't be sent again. | (en line 92) |
| 94 | `draft.staleCancelled` | ההזמנה ל{supplier} בוטלה ({ref}). הטיוטה הוסרה. | The order to {supplier} was cancelled ({ref}). The draft was removed. | (en line 93) |
| 101 | `send.cta.none` | סמנו כנשלחה · בלי הודעה לספק | Mark as sent · no message to the supplier | drops {supplier} in he AND en; orders-wizard-delivery.spec.ts split("{supplier}") → whole string, re-run (en line 100) |
| 138 | `detail.subtitle` | עוד לא נשלחה לספק. | Not sent to the supplier yet. | the "טיוטה" badge + buttons say the rest (en line 137) |
| 150 | `detail.channels.none` | ללא שליחה · רישום בלבד | Don't send · record only | merge:recordOnly (en line 149) |
| 176 | `detail.lastLine` | שורה אחרונה — בטלו את ההזמנה במקום. | Last line — cancel the order instead. | lives in a title= today (W2-06 makes it visible) (en line 175) |
| 188 | `errors.cannotCancel` | אי אפשר לבטל את ההזמנה הזו. | This order can't be cancelled. | accuracy: the server has a 3rd reason (receiving started) (en line 187) |
| 199 | `wizard.noSuppliers` | עוד אין ספקים פעילים. | No active suppliers yet. | merge:noSuppliers (canonical); the "add supplier" button stays (en line 198) |
| 208 | `wizard.catalogEmpty` | אין מחירון לספק הזה. הוסיפו שורה חופשית. | No price list for this supplier. Add a free-text line. | merge:noPriceList; the import button stays (en line 207) |
| 223 | `wizard.fixLines` | תקנו שורות עם כמות 0 או בלי תיאור. | Fix lines with quantity 0 or no description. | (en line 222) |
| 225 | `wizard.checkingBaseline` | בודקים מחירים… | Checking prices… | term: masculine singular out (en line 224) |
| 226 | `wizard.guardrailGated` | בדיקת מחירים בזמן הזמנה — בחבילה מתקדמת. | Price checks while ordering — on the advanced plan. | term: coined "מגן הדליפה" out (en line 225) |
| 227 | `wizard.aboveP90` | יקר במיוחד לעומת מחירי העבר | Unusually expensive vs. past prices | (en line 226) |
| 228 | `wizard.aboveMedian` | {pct} מעל המחיר הרגיל | {pct} above the usual price | (en line 227) |
| 234 | `wizard.channelNone` | ללא שליחה · רישום בלבד | Don't send · record only | merge:recordOnly (en line 233) |
| 236 | `wizard.draftSaved` | השליחה נכשלה. הטיוטה שמורה. | Sending failed. The draft is saved. | (en line 235) |
| 242 | `wizard.markedBody` | לא נשלח דבר לספק. החשבונית תיבדק מול ההזמנה. | Nothing was sent to the supplier. The invoice will be checked against this order. | pilot: every week-1 order (en line 241) |
| 247 | `wizard.missedCutoff` | עבר המועד להיום · האספקה הקרובה: {date} | Today's cutoff passed · next delivery: {date} | **31.10 fix:** "אספקה קרובה" is not idiomatic; "האספקה הקרובה" = the next delivery. (en line 246) |
| 249 | `wizard.noSchedule` | בחרו תאריך אספקה. | Pick a delivery date. | W1-11.spec.ts + orders-wizard-delivery.spec.ts read the catalog → pass (en line 248) |

### `receiving/delivery.he.ts` + `receiving/delivery.en.ts` — 9 keys · train-B co-owner: **W1-06 (photo shrink, MUST)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 17 | `delivery.scan.noInvoice` | המשיכו בלי חשבונית | Continue without an invoice | button (en line 10) |
| 35 | `delivery.review.lowConfidence` | קריאה לא ודאית — השוו לנייר | Uncertain read — compare with the paper | (en line 28) |
| 36 | `delivery.review.priceToManager` | מחיר שונה — ייבדק באישורים | Price differs — checked in approvals | manager only (en line 29) |
| 40 | `delivery.count.subtitle` | סמנו מה הגיע | Mark what arrived | (en line 33) |
| 73 | `delivery.count.offline` | אין חיבור · הספירה שמורה בטלפון. סגרו כשהחיבור יחזור | No connection · the count is saved on the phone. Close when you're back online | **31.10 fix:** keeps "בטלפון": offline, where the count lives is the fact the receiver needs. (en line 66) |
| 76 | `delivery.count.heldBody` | הספירות האלה לא נשלחו — בחרו מה לעשות בכל שורה | These counts weren't sent — choose for each line | heldTitle above gives the reason (en line 69) |
| 84 | `delivery.count.spotHint` | ספרו ורשמו כמה הגיע בפועל | Count and enter what actually arrived | (en line 77) |
| 103 | `delivery.summary.subtitle` | נקלטה ב־{time} | Received at {time} | (en line 96) |
| 110 | `delivery.error.body` | מה שכבר נספר שמור | What you counted is saved | retry + back buttons stay (en line 103) |

### `receiving/he.ts` + `receiving/en.ts` — 19 keys · train-B co-owner: **W1-06 (photo shrink, MUST)**

| he line | key | new he | new en (— = keep current en) | note |
|---:|---|---|---|---|
| 40 | `steps.scan.subtitle` | ספק: {supplier} | Supplier: {supplier} | (en line 39) |
| 42 | `steps.scan.frameHint` | ודאו שכל השורות בתוך המסגרת | Keep all lines inside the frame | **31.10 fix:** a task instruction needs a verb (plural imperative); absorbs the subtitle's "ודאו שכל השורות נראות" (en line 41) |
| 52 | `steps.scan.bannerQueued` | נשמרה בטלפון | Saved on the phone | merge:savedOnPhone — the PWA chip already says "אין חיבור · נשמר בטלפון" (en line 51) |
| 54 | `steps.scan.tooLarge` | הקובץ גדול מ־{mb} MB — צלמו את החשבונית | File over {mb} MB — take a photo of the invoice | (en line 53) |
| 55 | `steps.scan.unsupportedType` | סוג קובץ לא נתמך — העלו תמונה או PDF | Unsupported file — upload a photo or PDF | (en line 54) |
| 74 | `steps.processing.stillReading` | נציג את החשבונית כשתהיה מוכנה. | We'll show the invoice when it's ready. | the "continue with the order" button sits right under it (en line 73) |
| 76 | `steps.processing.readyLater` | החשבונית נקראה | The invoice is read | the "show results" button says the rest (en line 75) |
| 105 | `steps.recon.duplicateInvoice` | ייתכן שחשבונית {number} כפולה — היא תיבדק. המשיכו כרגיל. | Invoice {number} may be a duplicate — it will be checked. Carry on as usual. | merge:possibleDuplicate; T4 calm (en line 104) |
| 106 | `steps.recon.pendingBanner` | {count} שורות לבדיקה, לא פער — סמנו לפי מה שהגיע | {count} lines to check, not a discrepancy — mark them by what arrived | T4 calm (en line 105) |
| 107 | `steps.recon.mismatchBanner` | אף שורה לא תואמת להזמנה — אולי ספק אחר? | No line matches the order — another supplier? | the two ways out are the two buttons under it (en line 106) |
| 159 | `dockSlip.subtitle` | הראו לנהג לפני שהוא יוצא | Show the driver before they leave | term: plural imperative (en line 158) |
| 178 | `dockSlip.computing` | מחשבים את הסכומים… | Calculating the amounts… | (en line 177) |
| 179 | `dockSlip.afterClose` | הסכום ייקבע אחרי סגירת קבלת הסחורה. | The amount is set once the goods receipt is closed. | **31.10 fix:** byte-identical with explain.amountAfterClose; en "goods receipt" (a "receipt" is a payment receipt). merge:dockAmountLater; no ₪ character (en line 178) |
| 180 | `dockSlip.slow` | החישוב מתעכב — הסכום יתעדכן בהמשך | Taking longer — the amount will follow | no ₪ character (en line 179) |
| 188 | `dockSlip.noSend` | שום דבר לא נשלח לספק בלי לחיצה שלכם. | Nothing reaches the supplier until you press send. | merge:noSendWithoutTap (en line 187) |
| 200 | `errors.ocrFailed` | לא הצלחנו לקרוא את החשבונית | We couldn't read the invoice | the receiver is already counting against the order (en line 199) |
| 201 | `errors.ocrQuota` | מכסת הסריקות לחודש נגמרה | This month's scan quota is used up | (en line 200) |
| 205 | `errors.ocrTimeout` | החשבונית עוד בקריאה | The invoice is still being read | (en line 204) |
| 206 | `errors.queueUnavailable` | החשבונית נשמרה · הקריאה האוטומטית לא זמינה כרגע | The invoice is saved · automatic reading is unavailable right now | (en line 205) |

## Moved out of Batch P (31.10 verification)

Do not apply these four rows in train B.

| key | where it went | why |
|---|---|---|
| `approvals.why.sourceP90` | W2-04 (CUT-LIST "W2 · Approvals") | WhyLine evidence (MECHANISM §1), and vocab.test.ts:221 (he) + :295 (en) pin it. A test edit is not values-only. |
| `catalog.import.queued` | W2-16b dead-key sweep | a key removal, not a value; dead, so 0 rendered words for the pilot |
| `recovery.hero.returnedHint` | W2-10 dead-key sweep | same |
| `receivingDelivery.delivery.confirmed.bulkNote` | none: the current value stays | the proposal lost "סומנו כמו בהזמנה" (the lines were recorded at the ordered quantity), so the calm T4 note turned into a bare negative. It saved 3 words |

## Verification (adversarial pass, Sat 31.10.2026)

**Checked:** all 205 rows of the first brief. Each current value was re-read at file:line in `rw-release @ 96d47226` (a catalog dump plus a key-path line map), and each render site was traced, dynamic `t()` keys included. All 391 test files were grepped for the old he and en text of every row and for its key. Every `merge:` row was compared with `shared-explanations.he.draft.ts`.

| | rows |
|---|---:|
| checked | 205 |
| ✅ unchanged, correct | 184 |
| ❌ total | 21 |
| · fixed in place (Hebrew or accuracy, table above) | 17 |
| · moved to W2 | 3 |
| · dropped, current value kept | 1 |
| wrong line numbers fixed | 3 (`orders.detail.reorder` 125, `orders.detail.loadErrorBody` 136, `PRICE_LOWER` en 147) |
| test edits left in Batch P | **0** (was 1) |
| key removals left in Batch P | **0** (was 2) |
| **rows to apply now** | **201** (196 inventoried + 5 term labels) |

**Corrected totals** (MECHANISM §5.1 metric; the script reproduces the old 6,393 before the corrections): rendered explanatory words on the pilot screens **7,303 → 6,408 (−895, 12.3%)**, was −910. After W2: **≈4,448 (−39%)**.

**All 21 ❌ rows:**

| key | verdict | reason |
|---|---|---|
| `approvals.why.sourceP90` | ❌ moved to W2 | WhyLine evidence (MECHANISM §1 keep) and pinned by vocab.test.ts:221 (he) + :295 (en): a test edit is not values-only → W2-04 |
| `catalog.import.queued` | ❌ moved to W2 | key removal, not a value; dead, so 0 rendered words for the pilot → W2-16b dead-key sweep |
| `recovery.hero.returnedHint` | ❌ moved to W2 | key removal, not a value; dead, so 0 rendered words for the pilot → W2-10 dead-key sweep |
| `receivingDelivery.delivery.confirmed.bulkNote` | ❌ dropped (current value stays) | loses "סומנו כמו בהזמנה" (the lines were recorded at the ordered qty): T4 note turns into a bare negative; saves 3 words → KEEP current value |
| `overview.hero.calc` | ❌ fixed in place → «נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה" ו"ממתינה לשיוך להזמנה".» | true on main today (LEAK_FILTER, leak-views.ts:134 still counts MISSING_ON_INVOICE). "שורת הזמנה לא חויבה" ships inside W1-08's LEAK_FILTER PR, same commit as the filter, never ahead of it |
| `common.errorPage.body` | ❌ fixed in place → «נסו שוב. אם זה חוזר, רעננו את העמוד או חזרו מאוחר יותר.» | app/error.tsx:38 shows the code only when error.digest exists, so "שלחו לנו את הקוד" can point at nothing; no longer merge:errorRetry |
| `auth.reset.token` | ❌ fixed in place → «הקישור פג או כבר נוצל.» | reset/page.tsx:40-43 puts the link "בקשת קישור חדש" right after it; "בקשו קישור חדש." doubled it |
| `auth.reset.requestSubtitle` | ❌ fixed in place → «הזינו את המייל, ונשלח אליו קישור איפוס.» | "נשלח קישור איפוס" reads as past tense ("a link was sent") on the page before anything was sent; keeps the action |
| `common.shell.session.magicSent` | ❌ fixed in place → «שלחנו קישור כניסה ל־{email}. פתחו אותו וחזרו לכאן.» | one name for the link: "קישור כניסה" (draft magicLinkSent) |
| `overview.board.noPo.hint` | ❌ fixed in place → «בקשו מהמנהל לפתוח הזמנה.» | "אחראי המשמרת" is no role in the app (lib/roles.ts: מנהל/ת); no slash form; overlays untouched |
| `overview.board.empty.hint` | ❌ fixed in place → «משלוחים מהזמנות עם תאריך אספקה יופיעו כאן.» | "עם תאריך" alone is vague; overlays untouched |
| `receivingDelivery.delivery.count.offline` | ❌ fixed in place → «אין חיבור · הספירה שמורה בטלפון. סגרו כשהחיבור יחזור» | keeps "בטלפון": offline, where the count lives is the fact the receiver needs |
| `receiving.steps.scan.frameHint` | ❌ fixed in place → «ודאו שכל השורות בתוך המסגרת» | a task instruction needs a verb (plural imperative) |
| `receiving.dockSlip.afterClose` | ❌ fixed in place → «הסכום ייקבע אחרי סגירת קבלת הסחורה.» | byte-identical with explain.amountAfterClose; en "goods receipt" (a "receipt" is a payment receipt) |
| `leaks.hub.subtitle` | ❌ fixed in place → «כסף שחויבתם מעבר להזמנה ולמה שהתקבל, בחשבוניות שנבדקו, לפני מע״מ.» | keeps the condition "בחשבוניות שנבדקו" of the one definition of דליפה |
| `leaks.breakdown.subtitle` | ❌ fixed in place → «כל חשבונית שתרמה לדליפה ב{month}, מהגדולה לקטנה.» | "כל חשבונית עם פער" over-claims: an invoice with only PRICE_LOWER/info gaps is not listed (leak-hero.ts:228) |
| `contracts.over.emptyBody` | ❌ fixed in place → «ב־90 הימים האחרונים הכל חויב במחיר החוזה או מתחתיו.» | keeps the 90-day window (the query is windowed); T3 calm |
| `catalog.import.errors.NO_ROWS` | ❌ fixed in place → «אין שמות מוצרים בעמודה שנבחרה. בדקו את המיפוי.» | an error keeps what to do |
| `orders.wizard.missedCutoff` | ❌ fixed in place → «עבר המועד להיום · האספקה הקרובה: {date}» | "אספקה קרובה" is not idiomatic; "האספקה הקרובה" = the next delivery |
| `suppliers.form.deliveryTitle` | ❌ fixed in place → «לוח אספקה — ימים ושעת הגעה אחרונה» | no "יעד"; "שעה אחרונה" collides with the order cutoff "שעה אחרונה להזמנה" on the same supplier card |
| `suppliers.form.deliveryHint` | ❌ fixed in place → «אם עד שעת ההגעה לא נקלטה קבלת סחורה, תופיע התראת איחור.» | "עד השעה האחרונה" also reads "up to the past hour"; interim, W2-11 folds it |

**Binding rules on the final 201 values:** no "יעד", "חריג", "ריכוז", "תביע" or "קליטת"; no bare "קבלה" for goods; no ₪ on a receiver or chef screen; T4 lines calm; no legal text, ₪/destructive confirmation or a11y name removed; plural imperative throughout; he/en placeholder parity holds, and placeholders drop only in `approvals.empty.othersWaiting*`, `orders.draft.switched` and `orders.send.cta.none`, he and en together, in namespaces with no receiver overlay. No central help centre or glossary is proposed anywhere in this package.
