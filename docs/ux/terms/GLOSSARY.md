# בקשת זיכוי: glossary and rollout plan (owner, 7.11)

Everything was read-only, from `origin/main@4c887688` and the open PR heads. I committed, pushed and commented nothing.

**Two things the earlier sweeps missed:**
- **#201 (W2-13a, glossary-as-code) bans the owner's new word.** `apps/web/lib/i18n/glossary.ts:151-154` sets `creditClaim.he = 'דרישת זיכוי'` and puts `'בקשת זיכוי'` and `'לבקש זיכוי'` on its retired-word list. `glossary.test.ts:46` pins this. It has to be flipped before #201 or #212 merge.
- **Train B adds new copies of the old term.** #213 (letterhead) adds `settings/he.ts` "פרטים למכתבי דרישת זיכוי" and "מופיעים בראש כל מכתב דרישת זיכוי לספק". #216 adds five more internal ones.

---

## 1. Glossary

### 1a. Term families

| Old | New, text the supplier sees | New, owner / manager / bookkeeper screens | English UI | Notes |
|---|---|---|---|---|
| דרישת / דרישות זיכוי | **בקשת זיכוי** | **בקשת זיכוי** / בקשות זיכוי (nav: "בקשות זיכוי") | Credit request(s) | This is the binding term at `docs/ux/wave2/README.md:107`; it flips (§3e). |
| מכתב דרישת זיכוי · מכתבי זיכוי לספקים (`leaks/he.ts:105`) · מכתב תביעה | **מכתב בקשת זיכוי**; subject "הנדון: בקשת זיכוי — פערים בחשבוניות {month}" | מכתב בקשת זיכוי, or "המכתב" where space is short | Credit-request letter | **Never "מכתב זיכוי"** (see the decision below the table). `growth/he.ts:84` already uses the new form. |
| דרוש {amount} מהספק · נדרש מהספק · ניתן לדרוש | — (never) | CTA "בקשת זיכוי · {amount}"; done "נוסף לבקשת הזיכוי"; tile "אפשר לבקש זיכוי" | Request {amount} credit · Added to credit request · Credit you can request | A noun-form CTA also clears #201's masculine-imperative rule ("דרוש"). |
| לדרישה · אושר לדרישה · נדרש (funnel) | — | "לבקשת זיכוי" · "אושר לבקשת זיכוי" · "התבקש" / "התבקש מהספקים" | Approved for a credit request · Requested | `leakProof/he.ts:32-34`, `leaks/he.ts:202-206`, `chain/he.ts:28`, `recovery/he.ts:187,229`. |
| תביעה · לתבוע · מכתבי תביעה | never | "על מה כדאי לבקש זיכוי השבוע?" · "אפשר לבקש זיכוי על {total} ב-{count} פערים" | Credit request | `ask/he.ts:16,42,58,59`. Keep `packages/api/src/ask/offline.ts:23` matching "תביע", because users type it. |
| עדיין חייבים לך · עוד חייבים · "ספקים עדיין חייבים לך כסף" | never | **T1 hero: "ממתין לזיכוי"**, with hint "כסף שאמור לחזור אליך מספקים". The reminder e-mail heading becomes "בקשות זיכוי שממתינות לתשובה". | Awaiting credit | The old phrase is harsh, and in bookkeeping terms it is backwards: the supplier's card normally carries a credit balance. |
| גיול החוב הפתוח · חוב פתוח | never (no "חוב" at all) | "גיול בקשות הזיכוי הפתוחות" | Ageing of open credit requests | `recovery/he.ts:19`, `:135` |
| במחלוקת · סמנו במחלוקת · מחלוקת | never (if needed: "נבדוק יחד") | **"בבירור"** · "העברה לבירור" | Checking with supplier | Also the CSV header "₪ במחלוקת" in #247 → "₪ בבירור". |
| באיחור (about credits) · דרישות זיכוי באיחור | never (a reminder is "תזכורת קטנה") | "אין תשובה {days} ימים" · "{count} בקשות בלי תשובה 7+ ימים" | No reply for {days} days | **Late deliveries keep "באיחור".** It is a fact on staff screens and is pinned in `home/__tests__/board.test.ts:41,56`. |
| לגבייה · לגבות | never | "זיכויים פתוחים" (drop the word "לגבייה") · "כסף שעוד אמור לחזור מהספקים" | Open credits | `templates.test.ts:107,122` pins "זיכויים פתוחים", so keep it. |
| ויתרנו · ויתור על הסכום | never | "נסגר בלי זיכוי" · "סגירה בלי זיכוי" | Closed without credit | The DB enum `written_off` does not change. |
| דליפה | never; use "פערים" | Keep it, but **only for the owner's monthly leak number** (README §7:108) | Leak | The print card "דליפה עם הספק — 90 יום" breaks both rules. |
| חריגה · חריג · תאריך חריג | "פער" · "נבקש לבדוק את תאריך החשבונית" | "פער" (already guarded) · label "תאריך לא צפוי" | Discrepancy · Unexpected date | The label at `approvals/he.ts:182` also reaches the dock slip through `dock-slip.tsx:125`. |
| "זו חשבונית כפולה" (`leaks/he.ts:159`) | "נראה שהחשבונית הזו הגיעה אלינו פעמיים." | "חשבונית כפולה" (internal label, keep) | Possible duplicate | In supplier text, ask; don't assert. |
| חויבנו… (`leaks/he.ts:151-158`) | Make the invoice the subject: "המחיר בחשבונית גבוה מהמחיר שסוכם בהזמנה" | — | — | W2-10 rebuilds these lines from `whySegments`. |
| לקיזוז לפני תשלום (`:130`) | Keep it as the formal offset notice, framed softly: "בחשבוניות שעוד לא שולמו נשלם בניכוי הפערים" | "לקיזוז בתשלום" | Offset against payment | The letter must still state the deduction plainly. Contracts Law §53 is cited from memory; the accountant should confirm. |
| The supplier's own document | Ask for **"חשבונית זיכוי"** by name in every letter and reminder | The "credit received" form asks which document arrived: **חשבונית זיכוי** (counts for VAT) or **תעודת זיכוי** (against delivery notes, offset in the consolidated invoice) | Credit note · Credit slip | Don't retire "תעודת זיכוי" (#201 `glossary.ts:72`); give it its own glossary entry. `recovery/he.ts:57,158` say "תעודת זיכוי" today. |
| "מי מוסיף עלויות סמויות" (`suppliers/he.ts:7`) | — | "אצל מי הכי הרבה פערים" | — | It implies wrongdoing. |
| Order document: "…חיוב בחשבונית מעבר להם ייבדק." (`packages/api/src/orders/document/text.ts:49`) | "אם מחיר השתנה — נשמח לעדכון לפני האספקה." | — | — | Mild. Belongs to W2-06. |
| English: Claim … back · Credit claims · Disputed · Still owed to you · Chase … overdue · Open a dispute · Total to claim | credit request · Total for credit | — | Request credit · Credit requests · Checking with supplier · Awaiting credit · Send a reminder · No reply for N days · Open a clarification | `approvals/en.ts:16,41,44,135`; `nav/en.ts:23`; `recovery/en.ts:13,18,98,204`; `showcase/en.ts:280,294`; `receiving/en.ts:176`; `leaks/en.ts:98,108,110,115,125,130,133` |

Keys and enum values stay as they are: `claims`, `openForClaim`, `claimWeek`, `rm_claim_*`, and `recovery_claims.status`. Only the visible text changes, so no migration is needed. The guard checks values only, not keys (`terminology.test.ts:15`).

**What our letter is called: "מכתב בקשת זיכוי", not "מכתב זיכוי".**
> «מכתב זיכוי» נשמע כמו מסמך שהספק מוציא (חשבונית/הודעת זיכוי) ועלול להיתייק אצל מנהל החשבונות כזיכוי שכבר התקבל; «מכתב בקשת זיכוי» אומר בדיוק מה זה: בקשה שלנו.

### 1b. Statuses

The status labels at `recovery/he.ts:94-100` and the funnel at `:71-75` and `:78` change. The enum does not.

| State | Enum / derivation | Internal label (he) | Tier | What the supplier sees | English |
|---|---|---|---|---|---|
| To send | `claimed` | "לשליחה" (row: "בקשה · טרם נשלחה") | T2: ₪ + "שליחת המכתב" | — | To send |
| Sent | `letter_sent`, same day | "נשלחה לספק · {date}" | T4 | "בקשת הזיכוי ששלחנו ב-{date}" | Sent |
| Waiting for reply | `letter_sent`, ≤7 days | "ממתינה לתשובה · נותרו {days} ימים" | T4 | — | Awaiting reply |
| Reply overdue (>7 days) | `letter_sent`, >7 days (`overdueClaim` = 7 days; AU-03 fires on day 7) | "אין תשובה {days} ימים" + CTA "הכנת תזכורת" | T2 warn + ₪ | "תזכורת קטנה…" | No reply for {days} days |
| Supplier agreed | `acknowledged` | "הספק אישר · ממתינים לחשבונית זיכוי" | T4 | — | Supplier agreed |
| Credit received | `credited` | "התקבל זיכוי · לקיזוז בתשלום הבא" | T3 | the thank-you message | Credit received |
| Settled | `recovered` (`:151-152`) | "קוזז בתשלום" / "הוחזר בהעברה" (kept) | T3 | — | Offset / Refunded |
| Closed without credit | `written_off` | "נסגר בלי זיכוי" | T4 | — | Closed without credit |
| Under clarification | `disputed` | "בבירור" | T4 | "נבדוק יחד" | Checking with supplier |

Funnel sentence: "התבקשו {claimed}: קוזזו/הוחזרו {returned}, זוכו {credited}, ממתינים {open}, בבירור {disputed}, נסגרו בלי זיכוי {writtenOff}."

---

## 2. Tone guide for text the supplier sees

**Six rules**
1. **Ask, don't demand.** Use בקשה, נשמח, נבקש, נודה. Never דרישה, תביעה, חוב, חייבים, מחלוקת, באיחור, עליכם, לאלתר or "יש להעביר".
2. **Make the invoice the subject, not the person.** Write "בחשבונית מופיע…", not "חייבתם אותנו…".
3. **Soft words, hard facts.** Every line keeps the invoice number, date, item, quantity, price, ₪ amount (via `formatIls()`) and the evidence (delivery note or PO). Every letter asks for **"חשבונית זיכוי"** by name. Unpaid invoices are stated as "נשלם בניכוי {amount}".
4. **Assume good faith and leave room.** "ייתכן שפספסנו משהו — אם יש תעודה חתומה, נשמח לראות."
5. **Tie a date to a shared need, not a penalty.** "כדי שנסגור את החודש" or "לפני התשלום ב-{date}". Reminders are "תזכורת קטנה". Escalation is never a template; a person writes it in their own words.
6. **Close the loop warmly and keep internal words inside.** Thank them for every credit, sign with a real name, and use plural or neutral forms. WhatsApp uses the same words as the letter. דליפה, ויתרנו, זיכויים פתוחים and בבירור-as-a-status never reach the supplier.

**Eight sample sentences**
1. Subject: "הנדון: בקשת זיכוי — פערים בחשבוניות {month}"
2. Opening: "שלום {supplier}, תודה על העבודה המשותפת. בבדיקת החשבוניות של {month} מול ההזמנות ותעודות המשלוח מצאנו כמה פערים, בסך {amount}, ונשמח לחשבונית זיכוי עליהם."
3. Quantity line: "חשבונית {no} · {date} · עגבניות: בחשבונית 12 ק״ג, התקבלו 10 ק״ג (תעודת משלוח {dn}) · פער של {amount}"
4. Possible duplicate: "חשבונית {no}: נראה שהיא הגיעה אלינו פעמיים (גם כ-{no2}) — נשמח לחשבונית זיכוי על אחת מהן."
5. Unpaid invoices (the offset notice): "בחשבוניות שעוד לא שולמו נשלם את הסכום בניכוי הפערים ({amount}), ונשמח לחשבונית זיכוי מתאימה."
6. Closing: "נודה לחשבונית זיכוי עד {date}, כדי שנסגור את החודש מסודר. אם משהו לא מסתדר אצלכם — דברו איתנו ונבדוק יחד. תודה, {signer}"
7. WhatsApp reminder after 7 days: "היי {supplier}, תזכורת קטנה לגבי בקשת הזיכוי ששלחנו ב-{date} ({count} שורות, {amount}). אפשר לעדכן מתי תצא חשבונית הזיכוי? תודה! {signer}"
8. Thank-you, or a partial credit: "תודה {supplier}! קיבלנו את חשבונית הזיכוי מס׳ {no} על {amount}. נשארו {n} שורות ({rest}) — נעבור עליהן שוב ונחזור אליכם."

---

## 3. Where each change lands

### (a) Text on main that the ציקטי pilot will show (live Wed 11.11)

**Verdict: yes, ship one small values-only hotfix in train B** (human merges Tue 10.11 09:00; staging cut-off Mon 9.11 18:00).
- **Vehicle.** Preferred: one extra commit on **#213** (`claude/pilot-w1-08-letterhead`). It already edits `leaks/{he,en}.ts` claims and `settings/he.ts`, and it adds the two new old-term strings. If #213's review is closed, use a separate values-only PR merged last in train B, in the slot Batch P had.
- **Owner agent:** web-feature-engineer.
- **Test impact: none.**
  - `letters.test.ts:301-302` only requires "פערים" in `subject` and `intro`. The new subject keeps it, and `:128` is unchanged.
  - `e2e/W1-08.spec.ts:116` only bans "תביע".
  - `terminology.test.ts` covers `approvals`; "תאריך לא צפוי" passes.
  - I grepped every `e2e`/`__tests__` file on main and on #211, #213, #216 and #219: none pins the keys below.

| # | file:line (main) | Now → new | Hotfix? |
|---|---|---|---|
| 1 | `apps/web/lib/i18n/messages/leaks/he.ts:127` | subject → "הנדון: בקשת זיכוי — פערים בחשבוניות {month}" (printed letter and mailto subject) | **Yes** |
| 2 | `leaks/he.ts:166` | text.intro → "מצורפת בקשת זיכוי מ{restaurant} על {count} שורות, בסך {amount}:" (WhatsApp/e-mail) | **Yes** |
| 3 | `leaks/he.ts:97` | reminder.text → sample 7 wording, with {restaurant}/{date}/{count}/{amount}/{signer} kept | **Yes** |
| 4 | `leaks/he.ts:131` | sectionForCredit → "לזיכוי — נשמח לחשבונית זיכוי על השורות האלה" | **Yes** |
| 5 | `leaks/he.ts:159` / `:160` | → "נראה שהחשבונית הזו הגיעה אלינו פעמיים." / "נבקש לבדוק את תאריך החשבונית." | **Yes** |
| 6 | `receiving/he.ts:177` | dockSlip.total → "סה״כ לזיכוי" (goes to the driver and to WhatsApp via `dock-slip.tsx:138`) | **Yes** |
| 7 | `approvals/he.ts:182` | DATE_ANOMALY label → "תאריך לא צפוי" (reaches the slip via `dock-slip.tsx:125`) | **Yes** |
| 8 | `leaks/he.ts:96,99-102,104,105,112,114,116,121,136,139` | The rest of the claims block on the same letters page (title, CTAs, summary, "מכתבי זיכוי לספקים", sentLate "ממתין לתשובה, {days} ימים אחרי המועד", note "באיחור?" → "אין תשובה?"). Without this the letter and the page around it say different things. | **Yes, same commit** |
| 9 | `receiving/en.ts:176`; `leaks/en.ts:90,98,108,110,115,125,130,133,153,154`; `approvals/en.ts:179` | "Total to claim" → "Total for credit"; "claim" → "credit request"; the reasons match items 5 and 7 | **Yes** (trivial) |
| 10 | `settings/he.ts`, new in #213 | "פרטים למכתבי בקשת זיכוי" · "מופיעים בראש כל מכתב בקשת זיכוי לספק. ממלאים פעם אחת." | **Yes** (fix in #213 itself) |
| 11 | `suppliers/he.ts:158,160,161,163,165,167,176` and `leaks/he.ts:99` (print card "כרטיס ספק למו״מ") | → "פערים מול הספק — 90 יום" · "פערים ב־90 הימים האחרונים" · "{count} שורות עם פער" · "שלושת סוגי הפערים הגדולים" · "פתוח לטיפול / לבקשת זיכוי" · "למכתבי בקשת הזיכוי" · "אין פערים מול הספק ב־90 הימים האחרונים" | **Only if** the per-restaurant flag `supplierLeakCard` is on for ציקטי (`FeaturesPanel.tsx:27`); otherwise it goes to W2-11. The red badge colour (`leak-card-view.tsx:98`) is a rendering change for W2-11 and rtl-design-steward, not a copy hotfix. |
| — | `leaks/he.ts:130,134,151-158`; `orders/document/text.ts:49`; `lib/messageTemplates.ts:41` | Mild, factual, or unused (no callers) | **No.** Goes to W2-10 / W2-06; #212 already rewrites messageTemplates. |

### (b) Open PRs. Each package's session flips its own strings before its train.

| PR · package · branch | Strings to change | Pins to update in the same PR |
|---|---|---|
| **#201 W2-13a** `claude/ux-w2-13-templates`, with **#212** stacked (`…-copy-system`) | `glossary.ts:151-162`: `creditClaim.he='בקשת זיכוי'`, en `Credit request`, retire דרישת/דרישות זיכוי, לדרוש זיכוי, תביעה, לתבוע, מכתב(י) זיכוי. `overdueClaim` → "בקשה בלי תשובה 7+ ימים". `:133` funnel per §1b. `:13` header. `:72` keep "תעודת זיכוי" as its own concept. `notifications/copy/he.ts:77` "אפשר לבקש זיכוי: {amount}"; `:96` "זיכויים פתוחים". In #212: `components/he.ts:40` "נוסף לבקשת הזיכוי", `:55` "התבקש {amount}"; `match/persist.ts:279` "חריגה". | `glossary.test.ts:46`; `email-copy.test.ts` "דרוש מהספק" |
| **#209 W2-04** `ux-w2-04-approvals-desk` (owns `DECISION_COPY`) | `approvals/he.ts:19,24,44,47,138` and `en.ts:16,41,44,135`; `templates.ts:339` / #201 `copy/he.ts:122,125` | `vocab.test.ts:129,132` (`:150,:271` change "/דרוש/" to "/בקשת זיכוי/"); `approvals-router.test.ts:582,640`; `e2e/W1-04.spec.ts:318`; `W1-07.spec.ts:161,201-202` |
| **#197 W2-10** `ux-w2-10-claims-recovery` (includes #194) | **Supplier-facing, must fix before merge:** `recovery/he.ts:167` "תזכורת: בקשת זיכוי · {count} פערים · {amount}"; `:168` "…תזכורת קטנה לגבי בקשת הזיכוי ששלחנו… ממתינה {days} ימים…". Also `:162,:171-172`; the whole `recovery/he.ts`, about 36 strings (§1a/§1b); `packages/api/src/recovery/reminders.ts:94,106,110`; letter reasons `leaks/he.ts:151-158`; the "credit received" form asks which document arrived. | `recovery/__tests__/logic.test.ts:37` (title) |
| **#249 W2-11** `ux-w2-11-supplier-page` | `suppliers/he.ts:242,243,265,271` (new), `:7`, `:201` "זיכוי שהתבקש", the leakCard block if it wasn't hotfixed; keep open requests out of "יתרה פתוחה" (`:203`) | — |
| **#248 W2-03** `ux-w2-03-pay-run` | `payRun/he.ts:30,69,70`; comment `lib/claims.ts:10` | `payrun-mark-paid.test.ts:83` title → "בבירור" |
| **#247 W2-14** `ux-w2-14-settings-team` | `routers/exports.ts:75` CSV "₪ בבירור"; `accounting/he.ts:14,16`; `summary.tsx:12` | `exports-summary.test.ts:85` |
| **#250 W3-05a** `w3-05-close` | `accounting/he.ts:56` "בקשות זיכוי שלא נשלחו" · "זיכויים שהוחלט לבקש" · "לשליחת הבקשות" | — |
| **#246 W3-04a** `w3-04-palette` | `lib/hotkeys.ts:39` "בקשות זיכוי" / "Credit requests"; `palette/copy.ts:36` | — |
| **#195 / #192 G-12** (ask) | `ask/he.ts:16,42,58,59`; `ask/en.ts:15,41,57,58` | `ask.test.ts:430` (chip text); `:110,:124` user-typed input stays |
| **#216 / #200** (train B, internal manager text) | `auth/he.ts:192,196`; `invoices/he.ts:13,41,49`; `receiving/he.ts:182`; `catalog/he.ts:245`; `routers/receiving.ts:1943` | Optional in the train-B commit; otherwise W2-02, W2-05 or W2-16b |
| **#204 W2-16** `ux-w2-16-copy-focus` | `explain/he.ts:36` "…שאושרו לבקשת זיכוי"; `:10` comment; the inventories under `docs/ux/wave2/copy-focus/*` | — |
| **#184 W2-06** (orders) | `orders/document/text.ts:49` | — |
| **#241 H-03ʰ / #252 H-04ʰ** | `packages/db/src/schema.ts:2502` / `:2560` comment → "(בקשת זיכוי)". **This file is immutable, so the human author changes it.** | — |
| **W2-08** (starts 10.11) | `overview/he.ts:89-90` "{count} בקשות זיכוי" · "בקשות שעוד לא נשלחו לספק" | — |

### (c) W2-16b copy rows (start Mon 16.11): everything no open PR owns

- **In W2-16b's own scope:**
  - `catalog/he.ts:241` (and `:245` after #200);
  - `chain/he.ts:28` "התבקש מהספקים" (and `:31` "חריגות" → "פערים");
  - `auth/he.ts:192,196` if #216 didn't flip them;
  - the reports screen (`app/dashboard/reports/**`).
- **Boundary additions to confirm on day 1:**
  - `nav/he.ts:26` and `common/he.ts:148` "בקשות זיכוי (לשליחה)". `common` is W2-13's own namespace, so hand it to #201 if it's still open.
  - `nav/routes/leaks.ts:62`: **add** the search alias "בקשה" and keep "דרישה", because people search with the old word.
  - `packages/api/src/reports/monthly.ts:329,331,340,342`. This server text is scanned by #201's gate; give it to W2-13 if W2-13 is still running.
  - `notifications/templates.ts:431,450,458`, if #201 has not moved them.
  - `invoices/he.ts:15,44-46`, `payRun:27`, `settings:13,57,66,72` "חריגות" → "פערים".
  - `lab/tokens/copy.ts:36-41` (sample copy; rtl-design-steward).
- **growth-pmm-engineer, not W2-16b:**
  - `showcase/en.ts:280,294` "Open a clarification";
  - `showcase/dashboard/suppliers/[supplierId]/_mock.ts:632` and `mockText.ts:160` "בירור על חוסר במשלוח".
  - The demo seed `seed-recovery-demo.ts:115` needs nothing: its label follows the status.

### (d) Vocabulary guard: old words fail CI on supplier-facing paths (add-only, test-sentinel)

1. **New file `apps/web/lib/__tests__/supplier-wording.test.ts`.** It hard-fails, checks he and en, and **rides train B with the hotfix**.
   - **Keys scanned:**
     - `leaks.claims.{subject,intro,introReplyBy,section*,subtotal,total,closing,reason.*,math.*,text.*,reminder.text,basis.*,mixedBasis,letterhead.*}`
     - `receiving.dockSlip.*`
     - `approvals.*.label` (labels flow into the slip)
     - the print subset of `suppliers.leakCard.*`
     - `supplierConfirm.*`
     - `recovery.reminders.{subject,body}` (asserted once #197 lands)
   - **Server literals scanned:** `packages/api/src/orders/supplierMessage.ts`, `orders/document/**` and `apps/web/lib/messageTemplates.ts`. Use #201's `lintServerFiles` when present; until then, `readFileSync` with a regex over the string literals.
   - **Banned in Hebrew:** `/דריש|דרוש|נדרש/`, `/תביע|לתבוע|נתבע/`, `/מחלוק/`, `/(^|[^א-ת])חוב(?![א-ת])/`, `/חייב(ים|ת)?\s+(לך|לכם|לנו)/`, `/איחור/`, `/דליפ|דלף/`, `/חריג/`, `/עליכם|לאלתר|יש להעביר/`, and `/מכתבי? זיכוי/` (the ambiguous name).
   - **Banned in English:** `/\bclaim/i`, `/\bdisput/i`, `/\bowe[sd]?\b/i`, `/\boverdue/i`, `/\bleak/i`, `/\bdemand/i`.
   - **Required, to keep the hard facts:**
     - `claims.subject` contains "בקשת זיכוי" and "פערים";
     - `claims.introReplyBy` and `claims.text.replyBy` contain "חשבונית זיכוי";
     - the English subject contains "credit request".
2. **Internal ratchet over every Hebrew namespace** (`messages/index.ts`, or `ALL_NAMESPACES` once #201 is in). It lands **Tue 10.11 into α**.
   - **Rules:**
     - `/דריש(ת|ות) (ה)?זיכוי/`
     - `/מכתב(י)? (ה)?דרישה/`
     - `/דרוש\s.*מהספק/`
     - `/תביע/`
     - `/במחלוקת/`
     - `/חייבים לך/`
     - `/גיול החוב/`
     - `/לגבי?יה|לגבות/`
   - **Exemptions:** "דרושה החלטה" (it means a decision is needed) and late *deliveries* ("באיחור" outside claims, recovery and reminders).
   - **How the ratchet works:** a frozen `LEGACY` set of `ns:key` lists today's offenders. The test fails on any **new** offender and on any **stale** entry, so the list can only shrink. Each PR in (b)/(c) deletes its own rows. The suite is green on day one, and every flip is enforced from then on.
3. **Existing guard, `terminology.test.ts`:** change only the hint `:24 use: 'בקשת זיכוי'` and the comment `:13`. Nothing is removed. Once #250 is rebased, the ratchet flags `accounting/he.ts:56` on purpose.

### (e) Docs

- **`docs/ux/wave2/README.md:107` (§7, binding).** New text: "בקשת זיכוי (credit request); our letter is מכתב בקשת זיכוי; the supplier's document is חשבונית זיכוי; never דרישה / תביעה / מחלוקת / חוב / באיחור in supplier-facing text (owner 7.11)".
  - Write it on **#236** (`claude/wave2-kit-addendum-0711`), never on #226's head.
  - #226 carries the old line into main with train B, so the orchestrator also sends every running session one message with the decision **today**.
- **Specs:**
  - `docs/ux/wave2/W2-13.md:62,64`;
  - `docs/ux/review/lens-copy-rtl.md:146` (G27), `:147` (G28 → "נסגר בלי זיכוי"), `:149` (G30), `:150` (G31);
  - `docs/ux/wave2/W2-10.md:136,140,146` ("במחלוקת" → "בבירור").
- **Client-facing (growth-pmm-engineer):**
  - `docs/client-ready/PILOT-PROPOSAL.md:17,30,76`;
  - `DEMO-PACK.md:77,93,148` ("תעודת מחלוקת" → "תעודת פערים"), `:167,251,258,300`.
- **WhatsApp templates (#254).** Fix these **before** registering with Meta; after approval, every change needs a new approval. The template names stay.
  - `rm_owner_brief`: "…ו-{{4}} בקשות זיכוי שממתינות לתשובה יותר מ-7 ימים…"
  - `rm_claim_overdue`: "עברו 7 ימים מאז נשלחה בקשת הזיכוי ל{{1}} על {{2}}, ועוד אין תשובה. אפשר לשלוח תזכורת מהטלפון שלך."
  - `rm_claim_reply`: "{{1}} השיבו על בקשת הזיכוי בסך {{2}}: {{3}}", where {{3}} is "מאשרים" or "רוצים לבדוק חלק מהשורות".
  - Buttons "[לבקש זיכוי] [לוותר] [פרטים]". Confirm: "לבקש זיכוי של 96 ₪ מירקות השרון…?". Done: "נוספו לבקשת הזיכוי מול…".
  - `WA-02.md:78` "…ובקשות זיכוי". Marketing line at `report.md:388`: "…כמה ₪ מגיעים לך בחזרה מהספקים, ומכינה את בקשת הזיכוי".
  - **Files and lines:**
    - `10-design-and-plan.md:108,111,115,468,470,471`
    - `20-action-catalog.md:148,186,192-194,208,215,228,267,469,481,487`
    - `WA-07.md:52,54`
    - `WA-08.md:53`
    - `report.md:140,143,147,171,388`

---

## 4. Owner summary (Hebrew)

> 1. מעכשיו «בקשת זיכוי» במקום «דרישת זיכוי» — בכל המוצר, ובעיקר בכל מה שהספק רואה.
> 2. המסמך שהספק מוציא נשאר «חשבונית זיכוי», וכל מכתב ממשיך לבקש אותה במפורש, עם מספרי חשבוניות וסכומים.
> 3. יוצאות המילים: תביעה, דרישה, מחלוקת, «חייבים לך», «באיחור» (על זיכויים). במקומן: בקשה, בבירור, ממתין לזיכוי, ממתין לתשובה.
> 4. סטטוסים: לשליחה · נשלחה · ממתינה לתשובה · אין תשובה 7+ ימים (תזכורת) · הספק אישר · התקבל זיכוי · נסגר בלי זיכוי · בבירור.
> 5. אצלך הכסף נשאר ברור: «ממתין לזיכוי ₪X» עם כפתור תזכורת. «דליפה» נשארת רק המספר החודשי שלך ולא מגיעה לספק.
> 6. לפני הפיילוט (רכבת ב׳, ג׳ 10.11): תיקון מילים בלבד במכתב, בוואטסאפ לספק, בתזכורת ובתעודת הפערים לנהג. השאר עובר בגל 2.
> 7. בדיקה אוטומטית תכשיל כל מילה ישנה שתחזור לטקסט שהספק רואה.
> 8. שאלה אחת: הצעת «מכתב זיכוי». אנחנו ממליצים «מכתב בקשת זיכוי», כי «מכתב זיכוי» נשמע כמו מסמך שהספק מוציא, או כזיכוי שכבר התקבל. מאשר?