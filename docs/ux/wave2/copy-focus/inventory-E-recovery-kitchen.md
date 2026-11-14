# E-recovery-kitchen: in-app copy focus audit (claims recovery, recipes, inventory, chain, ask)

Release source: `rw-release` (read-only, HEAD `b5b27bcd`). Lab: http://localhost:3351 (build ab9908c4), tenant "כפר הזיתים", locale he. Captured 31.10.2026.
Scope: /dashboard/recovery, /dashboard/recipes (5 tabs, editor, new), /dashboard/inventory (home, count, closed count, the food-cost period card, which also renders compact on /dashboard/recipes), /dashboard/chain, /dashboard/branches (+ the branch-switcher error), /dashboard/ask. Catalogs: `recovery` (tracker, funnel, followUp, confirm, creditForm; the report/digest/next keys are A-owner-money's), `recipes` (except overviewCard, A), `inventory`, `chain`, `ask`; plus the server texts in `packages/api/src/recovery/service.ts` and `packages/api/src/ask/index.ts`. Roles: owner (desktop), manager and chef (phone).

**Inventory:** 175 explanatory strings: 61 SHORTEN, 18 CUT (3 of them dead keys), 12 FOLD, 16 MERGE, 68 KEEP (6 of the KEEPs are a11y names, 9 are confirmations). Source-level words: **1554 → 899** visible by default (−655).
Across the 43 captures: **18642** visible words, of which **3393** explanatory; **≈16937 after** (−1705). Most of that drop is one change: the price-source caption under every line of the field count (top change 5).

**Pilot (ציקטי, week 1):** only `recovery` of this area is on (PILOT-RUNBOOK §8: `recovery` on; `recipes`, `inventoryCount`, `dishPriceAlert`, `aiAssistant`, `chain` are scope-vetoed). So pilotCritical = true for the /dashboard/recovery strings and the recovery server error only. ציקטי starts with zero claims, so the recovery **empty state** is what they see first.

JSON: `docs/ux/wave2/copy-focus/inventory-E-recovery-kitchen.json` · scripts, stubs, captured innerText: `docs/ux/wave2/copy-focus/work-E-recovery-kitchen/`

How the numbers were made:
- **Visible words** = Hebrew and Latin tokens in `document.body.innerText` (header, sidebar/bottom bar, sr-only labels and the lab banner included; numbers and ₪ amounts excluded), regex `[A-Za-zא-ת][A-Za-zא-ת'"׳״-]*`. **Explanatory** = the inventory strings (a11y names excluded) matched in that capture, counted with the words their variables rendered (supplier names etc.), times the number of times each shows. **After** = visible − explanatory + the same strings rewritten: CUT = 0, SHORTEN/MERGE = the proposal, FOLD = the visible line + the toggle label. `count.priceFrom` is cut only on the count screen; on the closed count it stays.
- **Lab-safe.** Every non-GET request was aborted. Exceptions: `recipes.importCsv` with `dryRun: true` (a read-only check). Stubbed in the browser, nothing written: `inventory.current` (a draft built from the real 24.10 count: 45 of 51 counted, 2 lines flagged "בדוק", dated 31.10), `inventory.complete` (the closed summary) and `ask.ask` (two offline answers, `reason: noKey`, synthetic figures). Confirm dialogs and the credit form were opened, never submitted.
- **Lab noise in every capture:** the worker banner "מנוע העיבוד לא זמין כרגע…" (16 words; shell area). The count screen's 51 storage `<select>`s put all 6 option names into innerText (≈7 words × 51 lines), although only the selected one shows; that is data, and it inflates the count-screen totals.
- † **Lab ≠ source for the chef.** Build ab9908c4 predates 7118ea3b ("chef and receiver see no ₪"). In the lab the chef still sees the period card and ₪ on /dashboard/inventory (and the compact period card with ₪ on /dashboard/recipes), and ₪ + price sources on the closed count. Source sends the chef none of it (on /dashboard/recipes source shows the chef the period card's error state instead, see Findings 1). The chef rows marked † are therefore over-counted against source.
- **Not reachable in the lab, inventoried from source:** recovery empty state, tab empties, the credit-line suggestions, `recoveredLetGo` (no partial credit in the seed), error states; recipes with a missing price, unit bridge, sub-recipe errors, POS with data (unmatched / implausible); count date conflicts (`notAfterLast*`, `closedOnWarn`), the first-month period card (`needOpening`, `purchaseFoodCostHint`), `implausible`, partial coverage, variance; chain empty / calm / upsell / owner-only; branches not-payer / limit / no billing; ask budget / error / unknown / ungrounded.

## (a) Per-screen counts

| screen | role | viewport | visible words | explanatory words | est. words after | screenshot |
|---|---|---|---:|---:|---:|---|
| /dashboard/recovery: tracker (tab לטיפול) | owner | 1440×900 | 1029 | 52 | 988 (-41) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery--owner--desktop.jpg` |
| /dashboard/recovery: tracker (tab לטיפול) | manager | 390×844 | 918 | 52 | 877 (-41) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery--manager--phone.jpg` |
| /dashboard/recovery: credit-note form open | owner | 1440×900 | 1078 | 68 | 1026 (-52) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery-credit--owner--desktop.jpg` |
| /dashboard/recovery: credit-note form open | manager | 390×844 | 967 | 68 | 915 (-52) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery-credit--manager--phone.jpg` |
| /dashboard/recovery: "הכסף חזר" confirm | owner | 1440×900 | 1053 | 67 | 1012 (-41) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery-confirm-recovered--owner--desktop.jpg` |
| /dashboard/recovery: "הכסף חזר" confirm | manager | 390×844 | 942 | 67 | 901 (-41) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery-confirm-recovered--manager--phone.jpg` |
| /dashboard/recovery: write-off confirm (batch) | owner | 1440×900 | 1070 | 73 | 1029 (-41) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery-confirm-writeoff--owner--desktop.jpg` |
| /dashboard/recovery: write-off confirm (batch) | manager | 390×844 | 958 | 72 | 917 (-41) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recovery-confirm-writeoff--manager--phone.jpg` |
| /dashboard/recipes: מנות (+ compact period card) | owner | 1440×900 | 254 | 48 | 234 (-20) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes--owner--desktop.jpg` |
| /dashboard/recipes: מנות (+ compact period card) | manager | 390×844 | 199 | 48 | 179 (-20) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes--manager--phone.jpg` |
| /dashboard/recipes: מנות (+ compact period card) | chef† | 390×844 | 192 | 43 | 174 (-18) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes--chef--phone.jpg` |
| /dashboard/recipes: מה השתנה החודש | owner | 1440×900 | 274 | 54 | 248 (-26) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-changes--owner--desktop.jpg` |
| /dashboard/recipes: מה השתנה החודש | chef† | 390×844 | 212 | 49 | 188 (-24) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-changes--chef--phone.jpg` |
| /dashboard/recipes: מה אם (run +10%) | owner | 1440×900 | 302 | 52 | 273 (-29) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-impact--owner--desktop.jpg` |
| /dashboard/recipes: מה אם (run +10%) | manager | 390×844 | 247 | 52 | 218 (-29) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-impact--manager--phone.jpg` |
| /dashboard/recipes: תיאורטי מול בפועל (no POS data) | owner | 1440×900 | 219 | 85 | 171 (-48) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-pos--owner--desktop.jpg` |
| /dashboard/recipes: תיאורטי מול בפועל (no POS data) | manager | 390×844 | 164 | 85 | 116 (-48) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-pos--manager--phone.jpg` |
| /dashboard/recipes: ייבוא (sample → בדיקה ok) | owner | 1440×900 | 230 | 89 | 174 (-56) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-import--owner--desktop.jpg` |
| /dashboard/recipes: ייבוא (errors) | owner | 1440×900 | 232 | 93 | 176 (-56) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipes-import-errors--owner--desktop.jpg` |
| /dashboard/recipes/[id]: סטייק אנטריקוט (price alert) | owner | 1440×900 | 224 | 33 | 206 (-18) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipe-detail--owner--desktop.jpg` |
| /dashboard/recipes/[id]: סטייק אנטריקוט (price alert) | manager | 390×844 | 168 | 33 | 150 (-18) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipe-detail--manager--phone.jpg` |
| /dashboard/recipes/[id]: סטייק אנטריקוט (price alert) | chef | 390×844 | 166 | 33 | 148 (-18) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipe-detail--chef--phone.jpg` |
| /dashboard/recipes/new | owner | 1440×900 | 152 | 26 | 145 (-7) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipe-new--owner--desktop.jpg` |
| /dashboard/recipes/new | chef | 390×844 | 93 | 26 | 86 (-7) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--recipe-new--chef--phone.jpg` |
| /dashboard/inventory: home | owner | 1440×900 | 193 | 77 | 158 (-35) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory--owner--desktop.jpg` |
| /dashboard/inventory: home | manager | 390×844 | 138 | 77 | 103 (-35) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory--manager--phone.jpg` |
| /dashboard/inventory: home | chef† | 390×844 | 136 | 77 | 101 (-35) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory--chef--phone.jpg` |
| /dashboard/inventory/count: no open count | manager | 390×844 | 44 | 16 | 28 (-16) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-count-none--manager--phone.jpg` |
| /dashboard/inventory/count: no open count | chef | 390×844 | 43 | 16 | 27 (-16) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-count-none--chef--phone.jpg` |
| /dashboard/inventory/count: open count (stub draft) | manager | 390×844 | 1120 | 257 | 865 (-255) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-count--manager--phone.jpg` |
| /dashboard/inventory/count: open count (stub draft) | chef | 390×844 | 816 | 11 | 815 (-1) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-count--chef--phone.jpg` |
| /dashboard/inventory/count: finish panel (stub) | manager | 390×844 | 1184 | 304 | 916 (-268) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-count-finish--manager--phone.jpg` |
| /dashboard/inventory/count: closed summary (stub) | manager | 390×844 | 55 | 15 | 53 (-2) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-count-done--manager--phone.jpg` |
| /dashboard/inventory/[countId]: closed count | owner | 1440×900 | 629 | 270 | 622 (-7) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-detail--owner--desktop.jpg` |
| /dashboard/inventory/[countId]: closed count | manager | 390×844 | 521 | 270 | 514 (-7) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-detail--manager--phone.jpg` |
| /dashboard/inventory/[countId]: closed count | chef† | 390×844 | 519 | 270 | 512 (-7) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--inventory-detail--chef--phone.jpg` |
| /dashboard/chain | owner | 1440×900 | 458 | 95 | 396 (-62) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--chain--owner--desktop.jpg` |
| /dashboard/chain: all <details> open | owner | 1440×900 | 668 | 95 | 606 (-62) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--chain-open--owner--desktop.jpg` |
| /dashboard/branches | owner | 1440×900 | 155 | 21 | 146 (-9) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--branches--owner--desktop.jpg` |
| /dashboard/ask: empty | owner | 1440×900 | 140 | 29 | 118 (-22) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--ask--owner--desktop.jpg` |
| /dashboard/ask: empty | manager | 390×844 | 84 | 29 | 62 (-22) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--ask--manager--phone.jpg` |
| /dashboard/ask: 2 answers (stub, offline) | owner | 1440×900 | 226 | 48 | 200 (-26) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--ask-answers--owner--desktop.jpg` |
| /dashboard/ask: 2 answers (stub, offline) | manager | 390×844 | 170 | 48 | 144 (-26) | `docs/ux/wave2/copy-focus/shots/E-recovery-kitchen--ask-answers--manager--phone.jpg` |
| **total (43 captures)** | | | **18642** | **3393** | **16937** (-1705) | |

## (b) Repetition: concepts explained in more than one place

"→" names the one string (or fold body) every place should show. Keys outside this area are marked with their area.

1. **concept.twoCounts: actual food cost needs two counts**. `inventory.home.historyEmpty` ("הספירה הראשונה היא מלאי הפתיחה") · `inventory.period.needOpening` · `inventory.period.noCounts` · `inventory.period.purchaseFoodCostHint` ("זה לא עלות המזון בפועל — היא תופיע אחרי הספירה הבאה") · `overview.chef.countNoneHint` (A: "ספירה שבועית מראה את עלות המזון בפועל"). → new `inventory.explain.twoCounts` = "עלות המזון בפועל מחושבת בין שתי ספירות. היא תופיע אחרי הספירה הבאה." (fold body for needOpening and purchaseFoodCostHint; the other two become one short line each). Note the cadence conflict: `inventory.subtitle` says the count "closes the month", the chef home says "weekly". Pick one before re-wording (owner).
2. **concept.notLeak: food cost is separate from the leak**. `inventory.period.separateNote` ("נפרד ממספר הדליפה בחשבוניות") · contradicted by `inventory.subtitle` ("ובדיקה שמספר הדליפה אמין") · same idea in A: `overview.leaks.subtitle`, `vat.card.separate`, `leaks.detective.*`, `leaks.report.creepHint`. → `leaks.concept.notLeak` = "לא חלק מהדליפה" (A's canonical); cut the contradicting subtitle.
3. **concept.notSent: nothing reaches the supplier without your tap**. `recovery.followUp.reminderNote` · A: `leaks.claims.reminder.note`, `recovery.report.whatsappNote`, `recovery.digest.subtitle`/`note` · C: `receiving.dockSlip.noSend`, `ingest.orderCapture.draftHint` · D: `orders.wizard.markedBody`. → new cross-namespace `explain.sentOnlyOnTap` = "התזכורת יוצאת לספק רק כשתלחצו שליחה." for the two reminder notes (recovery + leaks claims); the others keep their own one-liners.
4. **concept.foodCostThreshold: the food-cost "יעד" (banned word)**. `recipes.target.hint` (legend) · `recipes.target.readOnly` · `recipes.alert.banner` + `recipes.alert.title` on the same block · `recipes.alert.crossed` (home card) · `recipes.alert.target` = `inventory.period.target` ("יעד {target}", identical) · labels `recipes.target.{label,edit,saved}`, `recipes.summary.aboveTarget`, `recipes.list.light.*` · A: `overview.homeSubtitle.chef`, `overview.chef.dishesSubtitle`. → one word for the whole feature: **"סף"** (as in "ספי סטייה" in contracts; my proposal, owner to confirm). One label key `recipes.alert.target` = "סף {target}"; the banner is cut, the legend folds.
5. **concept.missingPrice: an ingredient has no paid price**. `recipes.list.incomplete` ("חסר מחיר לחלק מהרכיבים") · `recipes.summary.incomplete` ("חסר מחיר") · `recipes.editor.noPrice` ("עוד לא נקנה — אין מחיר") **and** `recipes.editor.status.missingPrice` ("אין מחיר ששולם") on the same editor row · `recipes.pos.incomplete` · `inventory.period.theoryIncomplete` · inventory says "בלי מחיר" (`home.unpriced`, `count.unpricedWarn`) and "אין מחיר" (`count.noPrice`). → dish level: `recipes.list.incomplete`; ingredient line: `recipes.editor.status.missingPrice` "אין מחיר ששולם" (shown once per row); count line: keep "אין מחיר". Five wordings → three, one per level.
6. **concept.uncountedNotZero: a blank line is "not counted", not zero**. `inventory.count.acceptUncounted` (16 words, says it inside the checkbox) · `inventory.count.notCountedWarn` (line right above it, and on the closed summary) · `inventory.detail.amendQty` ("ריק = לא נספר") · MECHANISM seed `explain.uncountedNotZero`. → `inventory.count.notCountedWarn` "{count} פריטים לא נספרו — הם לא ייכנסו לשווי." already carries it; the checkbox becomes "לסגור בלי הפריטים שלא נספרו". No fold needed (the seed key can be dropped).
7. **concept.notAfterLast: a count was already closed on/after this date**. `inventory.count.notAfterLast` · `inventory.count.closedOnWarn` (16 words, same fix) · `inventory.count.notAfterLastToday`. → `notAfterLast` = "כבר נסגרה ספירה ב-{date}. בחרו תאריך מאוחר יותר." for both; the today variant parallel to it.
8. **concept.countLocked: a closed count is locked**. `inventory.count.finishBody` (confirmation, keep) · `inventory.detail.lockedNote` (15 words). → keep the confirmation; detail subtitle "נעולה מ-{date}. רק הבעלים מתקנים, עם סיבה."
9. **concept.overCount: counted more than last count + received**. `inventory.count.check` badge ("בדוק", masc. singular) · `inventory.count.checkHint` (title= tooltip) · `inventory.count.checkWarn` (finish panel). → the rule is said once, with names, in `checkWarn`; badge "בדקו"; tooltip cut.
10. **concept.posLinkByName: POS items link to dishes by name**. `recipes.pos.unmatched` ("הקישור הוא לפי שם המנה בעברית או באנגלית") · `recipes.pos.emptyNoMatch` ("ודאו ששם המנה תואם לשם הפריט בקופה"). → new `recipes.explain.posLinkByName` = "הקופה מקושרת למנה לפי השם, בעברית או באנגלית." as the fold body of both.
11. **concept.implausible: "this result can't be right"**. `recipes.pos.implausibleHint` (title= on "לבדוק בקופה") · `inventory.period.implausibleTitle` + `implausibleBody` (25 words). → same pattern in both: visible action ("לבדוק בקופה" / "בדקו את הספירה.") + [למה?] fold with the reason. Different bodies (different causes).
12. **concept.disparityMethod: how the branch price gap is computed**. `chain.dashboard.disparity.subtitle` (formula half) · `chain.dashboard.disparity.note` (footnote) · the per-row method badge (לפי מק״ט / לפי שם ויחידה). → new `chain.explain.disparityMethod`, one fold "איך חישבנו?" next to "השפעה בתקופה".
13. **concept.billingOwner: only the billing owner opens branches**. `chain.branches.notPayer` = `chain.errors.notPayer` (identical, character for character) · `chain.branches.add.body` · `chain.branches.subtitle` ("בחשבון החיוב שלך") · `chain.dashboard.scopeNote` ("בחשבון החיוב הזה"). → `chain.branches.notPayer` "רק בעלי חשבון החיוב פותחים סניפים חדשים."; the error reuses it; subtitle and scope note drop the billing-account phrase.
14. **concept.chainUpsell / branchLimit**. `chain.dashboard.upsellBody` · `chain.branches.noBilling` · `chain.branches.upsell` / `chain.dashboard.upsell` (titles) · `chain.branches.limitReached` + `chain.errors.limit` (two wordings). → `upsellBody` "במסלול רשת: עוד סניפים, וכולם במסך אחד." (noBilling reuses it); `limitReached` "הגעתם למגבלת הסניפים במסלול. שדרגו כדי להוסיף סניף." (errors.limit reuses it).
15. **concept.caught: leak you can still stop before payment**. `chain.dashboard.kpis.caughtHint` ("דליפה בחשבוניות שעוד לא שולמו") · A: `leaks.report.caughtChip`, `leakProof.caught`. → A's canonical wording "עוד אפשר לעצור לפני תשלום".
16. **concept.thinBase: too little data for a %**. `chain.dashboard.ranking.thinBase` (title= tooltip) · A: `overview.hero.thinBase`, `views.delta.thinBase`. → `views.delta.thinBase` "מעט מדי נתונים לאחוז", as visible small text, not a tooltip.
17. **concept.returned: money returned this month**. `recovery.hero.returnedHint` (dead) · `overview.hero.returnedHint` (A, rendered on home) · tracker label `recovery.tracker.returnedThisMonthLabel` = `overview.hero.returned` ("הוחזר החודש"). → delete the dead recovery key; A's shortened overview key is the one hint.
18. **concept.exVat: amounts are before VAT**. `recovery.creditForm.vatNote` + the amount label `creditForm.amount` ("₪, לפני מע״מ") on the same form · `inventory.period.purchasesNote` + `inventory.period.sales` label + `inventory.period.missingTotal`. → say it once, in the field label; cut `vatNote`.
19. **concept.offlineAnswer: the assistant answered from data, not AI**. `ask.offlineNote.noKey` / `budget` / `error` all end "זו תשובה אוטומטית מהנתונים" · the badge `ask.mode.offline` "תשובה מהנתונים" on the same answer. → the badge says "from data"; each note keeps only its reason.
20. **concept.askRateLimit**. `ask.rateLimited` (shown) · `packages/api/src/ask/index.ts:53` Hebrew server text (never shown). → `ask.rateLimited`; the server sends a code only.
21. **concept.unitBridge: units don't convert by themselves**. `recipes.editor.bridgeHint` (13 words) · `recipes.errors.unitMismatch` (save toast, 12 words). → hint keeps the example only; the toast says what to fill.
22. **concept.outstanding: what suppliers still owe**. `recovery.tracker.outstanding` + `outstandingHint` · A: `recovery.report.outstanding`, `recovery.digest.outstanding`. → unchanged label; the hint drops "פתוח ובמחלוקת" (the funnel shows both).
23. **concept.claimFromApproval: claims come from approving a gap for a claim**. `recovery.tracker.emptyHint` · A: `leaks.claims.notTracked`. → recovery: "פערים שתאשרו לדרישה יופיעו כאן."

## (c) The 10 highest-value changes (before → after)

1. **recovery · `followUp.reminderNote` (pilot, under the T2 card "ממתינות לתשובת ספק") · MERGE**
   - לפני: התזכורת האוטומטית מגיעה אליכם בלבד. לספק מכינים טיוטה, והיא נשלחת רק בלחיצה שלכם.
   - אחרי: התזכורת יוצאת לספק רק כשתלחצו שליחה.  (`explain.sentOnlyOnTap`, the same string as A's `leaks.claims.reminder.note`)
2. **recovery · `funnel.note` (pilot, on every visit) · FOLD**
   - לפני: בשקלים שלמים, מעוגלים כך שהחלקים מסתכמים בדיוק בסך שנדרש. הסכום המדויק מופיע במעבר עכבר.
   - אחרי: [איך חישבנו? ⌄] ליד "מה קרה לכל שקל שנדרש" ← "השקלים מעוגלים כך שהחלקים מסתכמים בדיוק לסך שנדרש."  (the hover sentence goes; it is false on the phone)
3. **recovery · header + empty state (pilot: ציקטי starts with zero claims) · CUT + SHORTEN**
   - לפני: כל פער שדרשת מהספק — ממכתב הדרישה ועד שהכסף חזר בפועל. / אין עדיין דרישות זיכוי · כשמאשרים פער לדרישה מהספק (בתור האישורים) הוא מופיע כאן אוטומטית.
   - אחרי: (בלי שורת משנה) / אין עדיין דרישות זיכוי · פערים שתאשרו לדרישה יופיעו כאן. [לתור האישורים]
4. **recovery · credit-note form (pilot) · SHORTEN + CUT**
   - לפני: יוחל רק על הדרישות שסומנו (6, ‏401.62 ‏₪), מהישנה לחדשה. כל הסכומים במעקב הם לפני מע״מ, כמו הדליפה בדשבורד.
   - אחרי: יוחל על 6 דרישות (‏401.62 ‏₪), מהישנה לחדשה.  (the amount field already says "לפני מע״מ")
5. **count (field, manager phone) · `count.priceFrom` under every line · CUT on this screen**
   - לפני: ‏149.00 ‏₪ לק״ג · חשבונית HK-24108, 19 באוק׳ 2026, קצביית הכרם   (× 45 lines ≈ 255 words)
   - אחרי: (the line keeps its ₪ value only; the price source stays on the closed count /dashboard/inventory/[countId])
6. **inventory · `subtitle` (home h1 + /count empty state) · CUT**
   - לפני: ספירה שסוגרת את חודש עלות המזון: שווי המלאי בש״ח, עלות המזון בפועל — ובדיקה שמספר הדליפה אמין.
   - אחרי: (בלי שורת משנה) — the start card says "כרבע שעה. הכל נשמר תוך כדי." [התחלת ספירה]. Removes ₪ talk from the chef's screen and the contradiction with "לא חלק מהדליפה".
7. **food-cost period card · two-counts idea in 4 places · FOLD + MERGE**
   - לפני: עלות המזון בפועל מחושבת בין שתי ספירות. אחרי הספירה הבאה תראו אותה כאן. / ספרו את המלאי פעם אחת כדי לקבע מלאי פתיחה; בספירה הבאה תקבלו את עלות המזון בפועל. / …זה לא עלות המזון בפועל — היא תופיע אחרי הספירה הבאה.
   - אחרי: תופיע אחרי הספירה הבאה. [למה?] ← "עלות המזון בפועל מחושבת בין שתי ספירות. היא תופיע אחרי הספירה הבאה." (`inventory.explain.twoCounts`) / תופיע אחרי שתי ספירות. התחילו בספירה הראשונה.
8. **recipes · POS tab (77 explanatory words) · FOLD + MERGE + SHORTEN**
   - לפני: לפי המכירות בקופה: כמה עלו המנות שנמכרו, ומה אחוז עלות המזון על המחיר שבאמת נגבה (הנחות, ארוחות על חשבון הבית ומבצעים כלולים). / אין עדיין נתוני מכירות מהקופה לתקופה הזו. אחרי ייבוא קובץ מכירות במסך האינטגרציות, תראו כאן את עלות המזון בפועל לכל מנה.
   - אחרי: לפי המכירות בקופה, במחיר שנגבה בפועל. [פרטים] / אין מכירות מהקופה לתקופה הזו. [לייבוא מכירות]; unmatched/no-match: "{n} פריטים בקופה בלי מתכון:" [למה?] ← "הקופה מקושרת למנה לפי השם, בעברית או באנגלית."
9. **chain · price gaps between branches (33 words) · FOLD + MERGE**
   - לפני: אותו ספק, אותו מוצר — מחיר שונה בכל סניף. ההשפעה = (המחיר − המחיר הטוב ברשת) × הכמות בתקופה הנבחרת. … מוצגות רק התאמות בטוחות (מק״ט זהה, או שם ויחידה זהים אצל אותו ספק) עם פער של 3% לפחות.
   - אחרי: אותו ספק ומוצר, מחיר שונה בכל סניף. [איך חישבנו?] ← "השפעה = (המחיר − המחיר הטוב ברשת) × הכמות בתקופה. רק התאמות בטוחות, עם פער של 3% לפחות."
10. **recipes · the dish price alert and the "יעד" legend (binding term) · CUT + SHORTEN + FOLD**
   - לפני: המנה חצתה את יעד עלות המזון החודש בגלל עליית מחיר אצל ספק. [חצתה את יעד עלות המזון] … / ירוק — עד היעד · כתום — עד 3 נקודות מעליו · אדום — מעבר לכך
   - אחרי: [מעל סף עלות המזון] 29.3% → 31.4% · +‏3.41 ‏₪ לכל צלחת … (the sentence above it is cut) / [פרטים] ← "ירוק: עד הסף. כתום: עד 3 נקודות מעליו. אדום: מעבר לכך."

Next in line: `inventory.period.implausibleBody` (25 words → "בדקו את הספירה." + [למה?]); `ask.answers.unknown` (25 → 9) and the three `ask.offlineNote.*` (reason only); `inventory.count.acceptUncounted` (16 → 5); `chain.dashboard.alerts.body` bug "אין רכש מהרכש".

## Binding-term and style fixes outside the explanatory set (labels, chips, buttons)

Not explanations, so not in the JSON, but they break the binding vocabulary or the plural house style on the same screens. Same PR is the cheapest place to fix them.

| key (he.ts line) | today | proposal | why | tests that assert it |
|---|---|---|---|---|
| recipes.target.label (14) | יעד עלות מזון | סף עלות מזון | no "יעד" |  |
| recipes.target.edit (16) | שינוי יעד | שינוי הסף | no "יעד" |  |
| recipes.target.saved (18) | היעד נשמר. | הסף נשמר. | no "יעד" |  |
| recipes.summary.aboveTarget (24) | מנות מעל היעד | מנות מעל הסף | no "יעד" |  |
| recipes.list.light.green / amber / red (45-47) | בתוך היעד / קרוב ליעד / מעל היעד | בתוך הסף / קרוב לסף / מעל הסף | no "יעד" (sr-only + badges) |  |
| ask.suggestions.claimWeek (16) | מה כדאי לתבוע השבוע? | על מה לדרוש זיכוי השבוע? | "דרישת זיכוי", never "תביעה" |  |
| ask.screens.claims (42) | מכתבי תביעה | מכתבי דרישת זיכוי | "דרישת זיכוי", never "תביעה" |  |
| inventory.count.finish / finishConfirm (57, 62) | סיים ספירה / כן, סיים | סיימו ספירה / כן, סיימו | plural imperative | `apps/web/e2e/inventory.spec.ts` (button names, lines 139, 141) |
| inventory.count.retry (53) | לנסות שוב | נסו שוב | plural imperative, as recovery.tracker.errorRetry |  |
| inventory.count.saving (30) · ask.thinking (11) · chain.branches.add.submitting (139) | שומר… · בודק בנתונים… · פותח… | שומרים… · בודקים בנתונים… · פותחים… | masculine singular → plural |  |
| chain.errors.notFound (158) · chain.errors.forbidden (160) | …שאין לך גישה אליו · אין לך הרשאה… | …שאין לכם גישה אליו · אין לכם הרשאה… | singular "לך" → plural |  |

## Findings outside copy (route, don't fix here)

1. **The chef sees ₪ on /dashboard/recipes** (cost per plate, menu price, gross margin, "+₪ לכל צלחת" in the price alert, sub-recipe batch cost), in the lab and in source. The binding rule allows ₪ for the chef on the orders screens only. Also, in source `recipes/page.tsx:32` renders `<PeriodCard compact />` for every role, while `inventory.period` is FORBIDDEN for the chef since 7118ea3b: the chef would get the card's error state (title + friendlyError + "לנסות שוב") on the recipes page. → web-feature-engineer / owner decision (recipes is not in the pilot).
2. **Chain weekly alert reads "‏94 ‏₪ דלף · אין רכש מהרכש"** in the lab: `pct()` returns "אין רכש" and `alerts.body` appends "מהרכש". Same risk in `worst.body`. Fix with a no-spend variant (row `chain.dashboard.alerts.body`).
3. **Explanations living in `title=` tooltips** (invisible on touch and to keyboard, MECHANISM §2.7.6): `recovery.tracker.rateHint`, `recipes.editor.wasteHint`, `recipes.pos.implausibleHint`, `inventory.count.checkHint`, `chain.dashboard.ranking.thinBase`. Each has a verdict in the JSON (cut, fold in a header, or visible short text).
4. **Dead keys** (render nowhere; delete he + en): recovery `hero.returnedTile`, `hero.returnedHint`, `creditForm.note`, `report.pdf`; recipes `list.noPrice`, `editor.back`, `editor.ingredient`, `editor.lineCost`, `editor.perUnit`, `changes.dish/before/now/driverProduct/driverPlain/monthlyImpact`, `impact.rowLine/dish/cost/foodCost/margin`; inventory `home.open`, `count.notCounted`, `count.clear`, `count.doneValue`, `detail.priceSource/unitCost/lineValue`, `period.actual`; chain `switcher.current`, `switcher.switching`, `dashboard.kpis.claimedHint`, `dashboard.disparity.product`. Also passed but never rendered (SwitchBranchButton ignores `label` since chain-31 and always says `common.shell.branch.workAs` "עבדו כסניף הזה"): `chain.dashboard.ranking.switchTo`, `dashboard.worst.cta`, `dashboard.alerts.cta`, `branches.list.switchTo`, `branches.add.goThere`.
5. **The server error a user can hit in the recovery tracker is English prose** (`recovery/service.ts:557`) and is replaced on screen by "הפעולה נכשלה — נסו שוב", which invites a retry that cannot succeed. Row `server:recovery.transition CONFLICT (cap full)` (pilot).
6. **Count screen size:** on the phone the manager's open count is ≈1,100 words of innerText; ≈300 are the price-source captions (top change 5) and ≈350 are the hidden option names of 51 storage `<select>`s. If the field count needs to shrink further, the storage select could show only when a line is tapped (layout, not copy).

## testRefs

Grepped `apps/web/e2e/**` and every `**/__tests__/**` for the exact Hebrew text (longest literal run ≥ 8 chars), the English text (≥ 16 chars) and the key (with and without its namespace) of every SHORTEN, CUT, FOLD and MERGE row. **No test asserts any of them**, so every `testRefs` is empty. Tests that exercise these screens without asserting the changed text (keep them green, nothing to edit): `apps/web/e2e/W1-08.spec.ts` (recovery confirms: regex "לוותר על .*₪.* מול", radio "הספק סירב", buttons "אשרו שהכסף חזר", "חזרה" — all KEEP), `apps/web/e2e/inventory.spec.ts` (count flow by test id + button names; only the style fix "סיים ספירה" in the table above touches it), `apps/web/e2e/W1-03.spec.ts` (chef inventory: no "₪" in main — CUTting `inventory.subtitle` only helps), `apps/web/e2e/W1-05.spec.ts` (recovery follow-up test ids), `apps/web/e2e/demo-path.spec.ts` (chain/branches by test id and `m.chain.dashboard.ranking.active`), `apps/web/e2e/a11y.spec.ts` (/dashboard/chain, /dashboard/recovery: new fold toggles must pass axe).

## Full inventory (every non-KEEP row)

| key | where | words | kind | verdict | proposal | pilot |
|---|---|---:|---|---|---|---|
| `recovery.tracker.subtitle` (recovery:13) | recovery tracker | 10 | meaning | CUT | — (להסיר את המחרוזת, he + en) | ✓ |
| `recovery.tracker.outstandingHint` (recovery:15) | recovery tracker | 8 | meaning | SHORTEN | {count} דרישות · מתוך {claimed} שנדרשו | ✓ |
| `recovery.tracker.rateHint` (recovery:17) | recovery tracker | 2 | meaning | CUT | — (להסיר את המחרוזת, he + en) (וגם את title= על שיעור הזיכוי) | ✓ |
| `recovery.funnel.note` (recovery:79) | recovery tracker | 14 | footnote | FOLD | גלוי: — · מתג: «איך חישבנו?» ליד "מה קרה לכל שקל שנדרש" · מקופל: «השקלים מעוגלים כך שהחלקים מסתכמים בדיוק לסך שנדרש.» | ✓ |
| `recovery.followUp.reminderNote` (recovery:86) | recovery tracker | 13 | hint | MERGE | התזכורת יוצאת לספק רק כשתלחצו שליחה. | ✓ |
| `recovery.tracker.tabEmpty.todo` (recovery:48) | recovery tracker | 7 | empty | SHORTEN | אין דרישות פתוחות. | ✓ |
| `recovery.tracker.emptyHint` (recovery:53) | recovery tracker | 10 | empty | SHORTEN | פערים שתאשרו לדרישה יופיעו כאן. | ✓ |
| `recovery.tracker.creditNoteHint` (recovery:57) | recovery tracker | 9 | hint | CUT | — (להסיר את המחרוזת, he + en) | ✓ |
| `recovery.tracker.suggestionsHint` (recovery:59) | recovery tracker | 12 | hint | SHORTEN | סגרו איתן דרישות של אותו ספק בלחיצה. | ✓ |
| `recovery.creditForm.claims` (recovery:163) | recovery tracker · credit-note form | 9 | meaning | SHORTEN | יוחל על {count} דרישות ({amount}), מהישנה לחדשה. | ✓ |
| `recovery.creditForm.vatNote` (recovery:166) | recovery tracker · credit-note form | 9 | meaning | CUT | — (להסיר את המחרוזת, he + en) | ✓ |
| `recovery.tracker.errorBody` (recovery:9) | recovery tracker | 11 | error | SHORTEN | הדרישות לא נטענו. שום דבר לא אבד. | ✓ |
| `recovery.hero.returnedHint` (recovery:174) | home (not rendered) | 7 | meaning | CUT | — (להסיר את המחרוזת, he + en) — מפתח מת | ✓ |
| `recipes.subtitle` (recipes:4) | recipes · dishes | 16 | meaning | SHORTEN | עלות כל מנה לפי המחירים ששילמתם בפועל. |  |
| `recipes.target.hint` (recipes:15) | recipes · dishes | 10 | meaning | FOLD | גלוי: — · מתג: «פרטים» ליד "סף עלות מזון" · מקופל: «ירוק: עד הסף. כתום: עד 3 נקודות מעליו. אדום: מעבר לכך.» |  |
| `recipes.target.readOnly` (recipes:19) | recipes · dishes | 7 | hint | CUT | — (להסיר את המחרוזת, he + en) |  |
| `recipes.list.empty` (recipes:42) | recipes · dishes | 9 | empty | MERGE | עוד אין מנות. הוסיפו מנה ראשונה. |  |
| `recipes.alert.banner` (recipes:214) | recipe editor | 12 | banner | CUT | — (להסיר את המחרוזת, he + en) |  |
| `recipes.alert.title` (recipes:209) | recipes · dishes | 5 | banner | SHORTEN | מעל סף עלות המזון |  |
| `recipes.alert.crossed` (recipes:211) | home (recipes card) | 6 | banner | SHORTEN | מעל סף עלות המזון ({target}) |  |
| `recipes.alert.target` (recipes:210) | recipes · dishes | 2 | meaning | MERGE | סף {target} |  |
| `recipes.editor.isSub` (recipes:59) | recipe editor | 9 | meaning | SHORTEN | תת-מתכון (רוטב, בצק, ציר) |  |
| `recipes.editor.wasteHint` (recipes:77) | recipe editor | 7 | how | FOLD | גלוי: — · מתג: «פרטים» ליד הכותרת "רכיבים" · מקופל: «פחת = קילוף, ניקוי ובישול. כמות לקנייה = נטו ÷ (1 − פחת).» |  |
| `recipes.editor.bridgeHint` (recipes:79) | recipe editor | 13 | how | SHORTEN | למשל 30 ביצים בתבנית. |  |
| `recipes.errors.unitMismatch` (recipes:175) | recipe editor | 12 | error | SHORTEN | מלאו כמה יחידות יש ביחידת מוצר אחת. |  |
| `recipes.editor.noPrice` (recipes:82) | recipe editor | 5 | hint | MERGE | אין מחיר ששולם |  |
| `recipes.editor.noItems` (recipes:98) | recipe editor | 7 | empty | SHORTEN | הוסיפו רכיב כדי לחשב עלות. |  |
| `recipes.changes.subtitle` (recipes:109) | recipes · מה השתנה החודש | 13 | meaning | SHORTEN | מחירי תחילת החודש ({since}) מול היום. |  |
| `recipes.impact.subtitle` (recipes:124) | recipes · מה אם המחיר יעלה? | 10 | how | CUT | — (להסיר את המחרוזת, he + en) |  |
| `recipes.import.subtitle` (recipes:140) | recipes · ייבוא מ-CSV | 15 | how | SHORTEN | מתכון קיים באותו שם יוחלף. |  |
| `recipes.import.columns` (recipes:141) | recipes · ייבוא מ-CSV | 28 | how | FOLD | גלוי: — · מתג: «פרטים» ליד "קובץ CSV" · מקופל: «שורה לכל רכיב, מוצר לפי השם בעברית או באנגלית. חובה: recipe, ingredient, quantity, unit; השאר רשות.» |  |
| `recipes.import.errors.subRecipeInUse` (recipes:168) | recipes · ייבוא מ-CSV | 10 | error | SHORTEN | "{value}" הוא תת-מתכון במנות אחרות — אי אפשר להפוך אותו למנה |  |
| `recipes.errors.cycle` (recipes:173) | recipe editor | 11 | error | SHORTEN | תת-מתכון לא יכול להכיל את עצמו. |  |
| `recipes.errors.importFailed` (recipes:181) | recipes · ייבוא מ-CSV | 10 | error | SHORTEN | הייבוא נכשל. לא נשמר דבר. |  |
| `recipes.pos.subtitle` (recipes:188) | recipes · תיאורטי מול בפועל | 22 | meaning | FOLD | גלוי: «לפי המכירות בקופה, במחיר שנגבה בפועל.» · מתג: «פרטים» · מקופל: «כולל הנחות, ארוחות על חשבון הבית ומבצעים.» |  |
| `recipes.pos.unmatched` (recipes:200) | recipes · תיאורטי מול בפועל | 18 | how | FOLD | גלוי: «{count} פריטים בקופה בלי מתכון:» · מתג: «למה?» · מקופל: recipes.explain.posLinkByName = «הקופה מקושרת למנה לפי השם, בעברית או באנגלית.» |  |
| `recipes.pos.emptyNoMatch` (recipes:206) | recipes · תיאורטי מול בפועל | 16 | empty | MERGE | גלוי: «אף פריט בקופה לא מקושר למנה.» · מתג: «למה?» · מקופל: recipes.explain.posLinkByName |  |
| `recipes.pos.emptyNoData` (recipes:205) | recipes · תיאורטי מול בפועל | 21 | empty | SHORTEN | אין מכירות מהקופה לתקופה הזו. + כפתור [לייבוא מכירות] → /dashboard/integrations |  |
| `recipes.pos.implausibleHint` (recipes:202) | recipes · תיאורטי מול בפועל | 17 | why | FOLD | גלוי: — (התג "לבדוק בקופה" נשאר) · מתג: «למה?» בכותרת העמודה "בפועל" · מקופל: «מכירות אפס או שליליות, או עלות מעל 200%. לרוב החזר, ארוחה על חשבון הבית או מחיר שגוי בקופה.» |  |
| `recipes.pos.incomplete` (recipes:203) | recipes · תיאורטי מול בפועל | 7 | hint | SHORTEN | חסר מחיר רכיב — העלות נמוכה מהאמת |  |
| `inventory.subtitle` (inventory:4) | inventory home · count (no open count) | 16 | meaning | CUT | — (להסיר את המחרוזת, he + en) (גם מ-EmptyState של /count) |  |
| `inventory.home.startHint` (inventory:16) | inventory home | 14 | how | SHORTEN | כרבע שעה. הכל נשמר תוך כדי. |  |
| `inventory.home.draftNote` (inventory:17) | inventory home | 10 | hint | SHORTEN | ספירה פתוחה מ-{date} · {counted} מתוך {lines} נספרו |  |
| `inventory.home.historyEmpty` (inventory:19) | inventory home | 9 | empty | SHORTEN | עוד אין ספירות. הראשונה תהיה מלאי הפתיחה. |  |
| `inventory.count.check` (inventory:38) | count (field) | 1 | hint | SHORTEN | בדקו |  |
| `inventory.count.checkHint` (inventory:39) | count (field) | 7 | why | CUT | — (להסיר את המחרוזת, he + en) (וגם את title= על התג) |  |
| `inventory.count.checkWarn` (inventory:44) | count · finish panel | 11 | banner | SHORTEN | {count} פריטים מעל הספירה הקודמת ומה שהתקבל — בדקו: {names} |  |
| `inventory.count.closersOnly` (inventory:40) | count (field) | 9 | hint | SHORTEN | הכמויות נשמרו. מנהל או בעלים יסגרו את הספירה. |  |
| `inventory.count.acceptUncounted` (inventory:43) | count · finish panel | 16 | confirm | MERGE | לסגור בלי הפריטים שלא נספרו |  |
| `inventory.count.unpricedWarn` (inventory:65) | count · finish panel | 9 | banner | SHORTEN | {count} פריטים בלי מחיר — לא ייכנסו לשווי. |  |
| `inventory.count.emptyList` (inventory:50) | count (field) | 10 | empty | SHORTEN | אין קניות ב-60 הימים האחרונים. הוסיפו מוצר בחיפוש. |  |
| `inventory.count.notAfterLast` (inventory:54) | count (field) | 11 | error | SHORTEN | כבר נסגרה ספירה ב-{date}. בחרו תאריך מאוחר יותר. |  |
| `inventory.count.closedOnWarn` (inventory:56) | count (field) | 16 | banner | MERGE | כבר נסגרה ספירה ב-{date}. בחרו תאריך מאוחר יותר. |  |
| `inventory.count.notAfterLastToday` (inventory:55) | count (field) | 9 | banner | SHORTEN | כבר נסגרה ספירה היום. את הבאה סוגרים מחר. |  |
| `inventory.count.priceFrom` (inventory:36) | count (field) | 7 | footnote | CUT | — במסך הספירה בלבד (נשאר בספירה הסגורה /dashboard/inventory/[countId]) |  |
| `inventory.count.priceFromNoInvoice` (inventory:37) | count (field) | 5 | footnote | CUT | — במסך הספירה בלבד (נשאר בספירה הסגורה) |  |
| `inventory.detail.lockedNote` (inventory:74) | closed count | 15 | meaning | SHORTEN | נעולה מ-{date}. רק הבעלים מתקנים, עם סיבה. |  |
| `inventory.period.separateNote` (inventory:118) | food-cost period card | 4 | meaning | MERGE | לא חלק מהדליפה |  |
| `inventory.period.implausibleBody` (inventory:91) | food-cost period card | 25 | why | FOLD | גלוי: «בדקו את הספירה.» (implausibleTitle) · מתג: «למה?» · מקופל: «התוצאה מחוץ ל-5%–80% מהמכירות. לרוב כמות או יחידה שגויה, או מכירות חלקיות.» |  |
| `inventory.period.coverageCaveat` (inventory:92) | food-cost period card | 13 | footnote | SHORTEN | ספירה חלקית — האחוז פחות מדויק: {parts} |  |
| `inventory.period.coveragePart` (inventory:93) | food-cost period card | 10 | footnote | SHORTEN | {date}: {counted} מתוך {lines} פריטים עם שווי |  |
| `inventory.period.creditsToReceive` (inventory:95) | food-cost period card | 12 | footnote | SHORTEN | זיכוי לקבל: {value} · לא מקוזז עד שיתקבל |  |
| `inventory.period.purchasesNote` (inventory:101) | food-cost period card | 21 | footnote | SHORTEN | קניות מזון: {count} חשבוניות, לפני מע״מ. בלי חד״פ וניקיון {nonFood} · משקאות {beverages} · כפילויות {dups}. |  |
| `inventory.period.accruedLine` (inventory:97) | food-cost period card | 12 | footnote | SHORTEN | {count} תעודות משלוח שעוד לא חויבו (לפי מחירי ההזמנה) |  |
| `inventory.period.reversedLine` (inventory:98) | food-cost period card | 7 | footnote | SHORTEN | תעודות מתקופה קודמת שחויבו עכשיו בחשבונית מרכזת |  |
| `inventory.period.purchaseFoodCostHint` (inventory:100) | food-cost period card | 17 | meaning | FOLD | גלוי: «קניות {purchases} ÷ מכירות {sales}, {from}–{to}» · מתג: «למה?» · מקופל: inventory.explain.twoCounts = «עלות המזון בפועל מחושבת בין שתי ספירות. היא תופיע אחרי הספירה הבאה.» |  |
| `inventory.period.needOpening` (inventory:116) | food-cost period card | 13 | empty | FOLD | גלוי: «תופיע אחרי הספירה הבאה.» · מתג: «למה?» · מקופל: inventory.explain.twoCounts |  |
| `inventory.period.noCounts` (inventory:117) | food-cost period card | 16 | empty | SHORTEN | תופיע אחרי שתי ספירות. התחילו בספירה הראשונה. |  |
| `inventory.period.salesMissing` (inventory:105) | food-cost period card | 9 | hint | SHORTEN | הזינו מכירות מזון כדי לראות אחוז. |  |
| `inventory.period.theoryPartial` (inventory:108) | food-cost period card | 17 | hint | SHORTEN | יש מתכון ל-{coverage} מהמכירות. הוסיפו מתכונים עד 90% כדי להשוות. |  |
| `inventory.period.theoryIncomplete` (inventory:109) | food-cost period card | 14 | hint | SHORTEN | חסר מחיר רכיב בחלק מהמנות. השלימו בעלות מנה כדי להשוות. |  |
| `inventory.period.varianceHint` (inventory:113) | food-cost period card | 13 | meaning | FOLD | גלוי: — · מתג: «למה?» ליד "שימוש לא מוסבר" · מקופל: «ההפרש בין מה שיצא מהמלאי למה שהמתכונים אומרים. לרוב פחת, מנות גדולות או גניבה.» |  |
| `inventory.period.target` (inventory:115) | food-cost period card | 2 | meaning | MERGE | סף {target} |  |
| `chain.dashboard.subtitle` (chain:18) | chain dashboard | 11 | meaning | CUT | — (להסיר את המחרוזת, he + en) (במסך עם נתונים; במסכי upsell/ownerOnly הכותרת לבד מספיקה) |  |
| `chain.dashboard.scopeNote` (chain:19) | chain dashboard | 10 | meaning | SHORTEN | {count} סניפים בבעלותכם |  |
| `chain.dashboard.kpis.caughtHint` (chain:27) | chain dashboard | 5 | meaning | MERGE | עוד אפשר לעצור לפני תשלום |  |
| `chain.dashboard.kpis.claimedHint` (chain:29) | chain dashboard | 3 | meaning | CUT | — (להסיר את המחרוזת, he + en) — מפתח מת |  |
| `chain.dashboard.kpis.pendingHint` (chain:31) | chain dashboard | 9 | meaning | SHORTEN | פערים פתוחים בכל הסניפים · {count} בתורי האישורים |  |
| `chain.dashboard.alerts.body` (chain:36) | chain dashboard | 4 | meaning | SHORTEN | {leak} דלף · {pct} מהרכש; וכשאין רכש: מפתח חדש alerts.bodyNoSpend = «{leak} דלף · אין רכש נבדק» |  |
| `chain.dashboard.alerts.calm` (chain:38) | chain dashboard | 11 | empty | SHORTEN | שבוע רגוע: אף סניף לא דלף מעל {min}. |  |
| `chain.dashboard.ranking.subtitle` (chain:51) | chain dashboard | 5 | how | CUT | — (להסיר את המחרוזת, he + en) |  |
| `chain.dashboard.ranking.thinBase` (chain:64) | chain dashboard | 9 | why | MERGE | מעט מדי נתונים לאחוז |  |
| `chain.dashboard.heatmap.subtitle` (chain:68) | chain dashboard | 10 | meaning | SHORTEN | אחוז דליפה מהרכש, 6 חודשים אחרונים |  |
| `chain.dashboard.suppliers.subtitle` (chain:76) | chain dashboard | 8 | how | CUT | — (להסיר את המחרוזת, he + en) |  |
| `chain.dashboard.disparity.subtitle` (chain:86) | chain dashboard | 16 | how | FOLD | גלוי: «אותו ספק ומוצר, מחיר שונה בכל סניף.» · מתג: «איך חישבנו?» ליד "השפעה בתקופה" · מקופל: chain.explain.disparityMethod = «השפעה = (המחיר − המחיר הטוב ברשת) × הכמות בתקופה. רק התאמות בטוחות, עם פער של 3% לפחות.» |  |
| `chain.dashboard.disparity.note` (chain:104) | chain dashboard | 17 | footnote | MERGE | → chain.explain.disparityMethod (מקופל, ראו disparity.subtitle) |  |
| `chain.dashboard.disparity.empty` (chain:103) | chain dashboard | 9 | empty | SHORTEN | אין פערי מחיר בין הסניפים בתקופה הזו. |  |
| `chain.dashboard.empty.body` (chain:108) | chain dashboard | 9 | empty | CUT | — (להסיר את המחרוזת, he + en) |  |
| `chain.dashboard.upsellBody` (chain:111) | chain (upsell) · branches (upsell) | 12 | banner | SHORTEN | במסלול רשת: עוד סניפים, וכולם במסך אחד. |  |
| `chain.branches.subtitle` (chain:117) | branches | 11 | meaning | SHORTEN | כל סניף מנהל ספקים, הזמנות וחשבוניות משלו. |  |
| `chain.branches.add.body` (chain:131) | branches | 10 | meaning | SHORTEN | באותו חשבון חיוב, ואתם הבעלים. |  |
| `chain.branches.notPayer` (chain:144) | branches | 14 | meaning | SHORTEN | רק בעלי חשבון החיוב פותחים סניפים חדשים. |  |
| `chain.errors.notPayer` (chain:159) | branches | 14 | error | MERGE | רק בעלי חשבון החיוב פותחים סניפים חדשים. |  |
| `chain.branches.limitReached` (chain:145) | branches | 11 | banner | SHORTEN | הגעתם למגבלת הסניפים במסלול. שדרגו כדי להוסיף סניף. |  |
| `chain.errors.limit` (chain:161) | branches | 4 | error | MERGE | הגעתם למגבלת הסניפים במסלול. שדרגו כדי להוסיף סניף. |  |
| `chain.branches.noBilling` (chain:147) | branches | 13 | banner | MERGE | במסלול רשת: עוד סניפים, וכולם במסך אחד. |  |
| `ask.subtitle` (ask:7) | ask | 20 | how | SHORTEN | כל תשובה מהנתונים שלכם, עם קישור למקור. |  |
| `ask.placeholder` (ask:8) | ask | 5 | hint | SHORTEN | כתבו שאלה… |  |
| `ask.empty` (ask:36) | ask | 9 | empty | CUT | — (להסיר את המחרוזת, he + en) |  |
| `ask.offlineNote.noKey` (ask:27) | ask | 11 | banner | SHORTEN | העוזר החכם לא מחובר. |  |
| `ask.offlineNote.budget` (ask:28) | ask | 10 | banner | SHORTEN | נגמרה מכסת השאלות היומית לעוזר החכם. |  |
| `ask.offlineNote.error` (ask:29) | ask | 9 | banner | SHORTEN | העוזר החכם לא זמין כרגע. |  |
| `ask.answers.unknown` (ask:47) | ask | 25 | how | SHORTEN | אני עונה כרגע על חמש השאלות הנפוצות. בחרו אחת מהן. |  |
| `ask.answers.claimNone` (ask:58) | ask | 6 | empty | SHORTEN | אין כרגע פערים פתוחים לדרישת זיכוי. |  |
| `ask.answers.claimIntro` (ask:59) | ask | 8 | meaning | SHORTEN | אפשר לדרוש זיכוי על {total} ב-{count} פערים. הגדולים: |  |
| `server:recovery.transition CONFLICT (cap full)` (service.ts:557) | recovery tracker | 14 | error | SHORTEN | appCode claim_cap_full → מפתח UI recovery.errors.capFull = «כבר נדרש כל סכום החשבונית.» | ✓ |
| `server:ask TOO_MANY_REQUESTS` (index.ts:53) | ask | 8 | error | MERGE | להחליף ב-appCode בלבד; ה-UI כבר מציג ask.rateLimited («הרבה שאלות בזמן קצר — חכו רגע ושאלו שוב.») |  |

KEEP (no change): `recovery.funnel.sentence`, `recovery.tracker.tabEmpty.all`, `recovery.tracker.tabEmpty.closed`, `recovery.creditForm.noneSelected`, `recovery.creditForm.remainder`, `recovery.confirm.writeOffTitle`, `recovery.confirm.writeOffBody`, `recovery.confirm.recoveredTitle`, `recovery.confirm.recoveredBody`, `recovery.confirm.recoveredLetGo`, `recovery.confirm.reason`, `recovery.actions.failed`, `recovery.tracker.loading`, `recovery.batch.select`, `recovery.actions.menu`, `recipes.list.emptySub`, `recipes.list.incomplete`, `recipes.editor.yieldHint`, `recipes.editor.preview`, `recipes.editor.deleteConfirm`, `recipes.changes.empty`, `recipes.impact.none`, `recipes.import.ok`, `recipes.import.errorsTitle`, `recipes.import.errors.missingColumn`, `recipes.import.errors.tooManyRows`, `recipes.import.errors.badQuantity`, `recipes.import.errors.badUnit`, `recipes.import.errors.badWaste`, `recipes.import.errors.badPrice`, `recipes.import.errors.badYield`, `recipes.import.errors.unknownIngredient`, `recipes.import.errors.empty`, `recipes.import.errors.tooLong`, `recipes.import.errors.tooManyLines`, `recipes.import.errors.subRecipeCycle`, `recipes.errors.duplicateName`, `recipes.errors.notSubRecipe`, `recipes.errors.inUse`, `recipes.errors.tooLarge`, `inventory.count.notCountedWarn`, `inventory.count.finishBody`, `inventory.count.discardConfirm`, `inventory.count.saveError`, `inventory.count.loadError`, `inventory.count.qtyLabel`, `inventory.count.progress`, `inventory.detail.amendQty`, `inventory.detail.amendReason`, `inventory.detail.amended`, `inventory.period.formula`, `inventory.period.missingTotal`, `inventory.period.salesInvalid`, `chain.dashboard.truncated`, `chain.dashboard.worst.clean`, `chain.dashboard.suppliers.empty`, `chain.dashboard.ownerOnlyBody`, `chain.switcher.failed`, `chain.branches.add.createdCopied`, `chain.branches.ownerOnly`, `chain.errors.generic`, `chain.errors.notFound`, `chain.errors.forbidden`, `chain.errors.nameInvalid`, `ask.ungrounded`, `ask.error`, `ask.rateLimited`, `ask.answers.priceNone`.
