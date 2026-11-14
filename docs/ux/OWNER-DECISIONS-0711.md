# Owner decisions, Sat 7.11.2026 (binding)

The owner answered all 30 questions on the decision page (design, data order, money, supplier wording). Every answer took the recommendation except **D-display**, where he chose **"now"** instead of "wave 3". These rules bind every wave-2, wave-3 and AU session. `AGENTS.md` still wins on immutable files: a decision that needs one goes through a human-authored PR.

Sources the build sessions read: `docs/ux/ds2/` (DS2-SPEC, VERDICT, PROCESSES, FONTS, prototype shots), `docs/ux/ia/` (IA-SPEC, ROLE-NEEDS, wireframes WF-1..4), `docs/ux/terms/GLOSSARY.md`.

## Design (DS2)

| # | Decision |
|---|---|
| D1 | Direction **A · מאזן**, with the grafts from B and C listed in `ds2/VERDICT.md` §5, and the prototype fix list in §6. |
| D2 | Font **IBM Plex Sans Hebrew** (OFL). |
| D3 | Invoice numbers and IDs use the same family (Plex Sans 500 + `tnum`), not a mono face. |
| D4 | Density by role: owner and manager "רגיל", bookkeeper "צפוף", field mode fixed. Each user gets a saved toggle. |
| D5 | Tone: calm and audited, with human copy. No warm paper colour. |
| D6 | Card radius 12; control 8; overlay 16. |
| D7 | One filled primary per viewport. It follows focus, and the bulk bar owns it while rows are selected. |
| D8 | ₪ appears once in the column header, in the bookkeeper's compact tables only. `formatIls()` is immutable, so a human PR from money-format-marshal is needed. |
| D9 | Selection colour blue (`#EBF2FD`). The hero CTA is a secondary button, never red. |
| D10 | Users see the new font on **24.11 (train β)**. Train α 17.11 adds tokens only, with 0 pixels changed. |
| D11 | **Frank Ruhl Libre on the monthly report cover NOW.** The owner chose this over "wave 3". It ships with the β font swap, for the report cover and print header only, and never for ₪. |

## Data order (IA)

| # | Decision | Lands in |
|---|---|---|
| I1 | The owner home drops to 5 blocks: hero, 3 tasks with one action each, and 1 good-news row. Activity moves to the bell; price tiles move to the leaks page; VAT shows as a task only within 30 days of the deadline. | W2-08 |
| I2 | Manager home: shift tasks first; the leak becomes a link row below them. | W2-08 |
| I3 | Bookkeeper: no leak hero on her home, and read-only access to the 10 screens blocked to her today. | W2-08 (home) + IA-03 |
| I4 | One copy of the month: "דוח החודש" with 3 tabs. "הוכחת הדליפה" and "תקציר" leave the side menu now. | interim: W2-08 nav; full: W3-08 |
| I5 | "בקשות זיכוי": actions at the top, history in a tab, letters folded to one row per supplier. | W2-10 (γ) |
| I6 | The printed supplier card carries no internal score. | W2-11 |
| I7 | **A paid invoice is locked for edits.** It can be corrected only through "פתיחה מחדש" with a reason, which writes an audit row. On main, `receiving.updateInvoiceHeader` / `updateInvoiceLine` have no status guard today. | G-05 lifecycle sweep (26–29.11) |

## Money

| # | Decision |
|---|---|
| M1 | Owner approval before payment for **₪5,000 and above**, and for the **first invoice from a new supplier** (G-15). |
| M2 | Non-leak (info) rows leave the approval queues and are labelled "לידיעה, בלי ₪". The hero is unchanged (G-15 ₪ diff signed). |
| M3 | Paid invoices keep their credit requests. The ₪ move is signed: 33 invoices, ₪1,758.58 (W2-03). |
| M4 | `PAYMENT_LAW_MAX_DAYS_AFTER_EOM = 45` (W2-03). |
| M5 | A closed ("resolved") credit request counts as decided in letters and the pay run too, the same as on the recovery screen (W2-03 / G-14). |
| M6 | The G-14 partition (Σ = hero to the agora) and "caught before payment" are signed. The interim figure is high until H-03's `paid_at` lands. |
| M7 | **Tiny gaps inside the tolerance that the engine auto-approved: waive, and send no credit request.** They are already outside the leak (`leak-hero.ts:13`). Credit-request letters carry only gaps worth asking for (G-14 `lib/claims.ts`). |
| M8 | The bookkeeper also edits the expense, input-VAT and movement-type codes, with an audit log (W2-14, already built). |
| M9 | Re-seed the prod demo tenants so November is not ₪0. This is a prod write with a backup first; it runs after train B is deployed. |
| M10 | The 30-day Pro trial terms are decided after the pilot (H-10). |

## Supplier wording

| # | Decision |
|---|---|
| W1 | Our letter is **"מכתב בקשת זיכוי"**. The supplier's document is "חשבונית זיכוי" (or "תעודת זיכוי"). |
| W2 | The tone guide in `terms/GLOSSARY.md` §2 is approved. Ask, don't demand; the invoice is the subject; keep the hard facts; assume good faith; send a small reminder; thank them for each credit. |

## Signatures, Sat 7.11 evening (binding)

The owner signed every item on the signing page (13 of 13, all as recommended, 20:51–20:52Z). Each Hebrew summary was cross-checked against the diff before signing; the PR bodies carry the signed text.

| Item | Signed |
|---|---|
| H-02 legal pages #234 (privacy, terms, cookies) | Publish now, still tagged "for counsel review" → train B (Tue 10.11) |
| G-03 #237 · H-03 #241 (schema) | Signed. Upload **Tue 24.11 at 15:30**, backup first, the app goes up only after the deploy checks pass |
| H-05 #261 (notification send path) | Signed |
| Supplier reminder rule | **(a) the first reminder after 7 full days (day 8), then every 7 days.** The day-3 courtesy flag stays off. A manager always presses send |
| H-06 #266 (supplier reply link) · H-07 #263 (monthly close) · H-11 #258 (server ₪ strip) | Signed |
| G-13 #187 commit 87c705f (half-agora rounding) · W2-01 #180 delta edd1a4a (AU/WA/IA fragments) | Signed |
| DS2 β font (#284, VR-2 shots) | Approved for 24.11 |
| rls/0003 on the AGENTS.md immutable list | Yes → human-PR proposal #285 (the owner merges it) |
