# C-receiving: in-app copy focus audit (receiving phone flow)

Release source: `rw-release` (read-only, HEAD `ed389ffc`). Lab: http://localhost:3351 (build ab9908c4, 26 commits older), tenant "כפר הזיתים", locale he, phone 390×844. Captured 31.10.2026.
Scope: /dashboard/receiving (board, read-only receipt), /dashboard/receiving/<poId> (Delivery Check wizard: scan, processing, review, dock slip, count incl. all-arrived, spot check, tolerance, held rows, OCR notices, confirm, closed summary), offline / leave / re-auth / sign-out guard, PWA chip. Catalogs: `receiving` (incl. `delivery.he.ts`), `dockPrice`, `scans`, `ingest`, `receiverLangs`, plus the `overview.board.*` and `common.shell.*` strings these screens render, and the receiving server errors in `packages/api/src/routers/receiving.ts`. Roles: receiver and manager (phone).

**Inventory:** 107 explanatory strings: 51 SHORTEN, 14 CUT (9 of them dead keys that render nowhere), 2 FOLD, 1 MERGE, 39 KEEP (8 of the KEEPs are a11y names).
Source-level words: **854 → 475**. Of these, strings that actually render: **785 → 475** (−310). Across the 55 captures: 6340 visible words, of which 1259 are explanatory; **≈5689 after** (−651).

JSON: `docs/ux/wave2/copy-focus/inventory-C-receiving.json` · scripts, stub log, captured innerText: `docs/ux/wave2/copy-focus/work-C-receiving/`

How the numbers were made:
- **Visible words** are Hebrew and Latin tokens in `document.body.innerText` (header, sr-only and the lab banner included; numbers and ₪ amounts excluded). **Explanatory** = the inventory strings matched in that capture (a11y names not counted), times the number of times each shows. **After** = visible − explanatory + the same strings rewritten: CUT = 0, SHORTEN/MERGE = the proposal, FOLD = visible line + toggle label.
- **States the lab cannot produce were stubbed, not written.** Inside the browser context, `capture.cjs` answers the receiving mutations (`startReceipt`, `markGrLine`, `submitReceipt`, `scans.upload`, `registerInvoice`) and the reads keyed on the fake receipt or invoice (`getReceipt`, `getInvoice`, `dockSlip`, `priceContext`). Every other read goes to the lab. **Nothing was written to the lab DB:** no receipt opened or closed, no invoice registered. The invoice used is synthetic: 11 PO lines of "ירקות השרון", with one qty diff, one price diff (manager), one missing, one unlinked and one unordered line, low read confidence and a duplicate number. A second synthetic invoice matches nothing.
- **Lab noise in every capture:** the worker banner "מנוע העיבוד לא זמין כרגע…" (16 words; it is a shell string, and the lab worker is down). The lab build also shows two offline chips on receiving screens, a bug that source fixed in f90c7f7c. The source wins.
- **Not reachable in the lab, inventoried from source only:** the error boundary, the sign-out guard, held rows, the dock slip "slow" and "held" notes, the board empty state, the partial-receipt follow-up, the re-auth sheet (build ab9908c4 predates e6add466, so a 401 on a save does not open it there), the scans viewer (the lab invoice has no scan file, so it returns 404) and the invoice inbox (audited in B-ap).

## (a) Per-screen counts

| screen | role | viewport | visible words | explanatory words | est. words after | screenshot |
|---|---|---|---:|---:|---:|---|
| /dashboard/receiving: board | receiver | 390×844 | 124 | 23 | 107 (-17) | `docs/ux/wave2/copy-focus/shots/C-receiving--inbox--receiver--phone.jpg` |
| /dashboard/receiving: board | manager | 390×844 | 124 | 23 | 107 (-17) | `docs/ux/wave2/copy-focus/shots/C-receiving--inbox--manager--phone.jpg` |
| /dashboard/receiving?receipt=: closed receipt (read-only) | receiver | 390×844 | 65 | 13 | 54 (-11) | `docs/ux/wave2/copy-focus/shots/C-receiving--receipt-view--receiver--phone.jpg` |
| /dashboard/receiving?receipt=: closed receipt (read-only) | manager | 390×844 | 65 | 13 | 54 (-11) | `docs/ux/wave2/copy-focus/shots/C-receiving--receipt-view--manager--phone.jpg` |
| /receiving/<poId>: closed receipt summary | receiver | 390×844 | 63 | 11 | 57 (-6) | `docs/ux/wave2/copy-focus/shots/C-receiving--summary--receiver--phone.jpg` |
| /receiving/<poId>: closed receipt summary | manager | 390×844 | 61 | 11 | 55 (-6) | `docs/ux/wave2/copy-focus/shots/C-receiving--summary--manager--phone.jpg` |
| scan step | receiver | 390×844 | 56 | 17 | 47 (-9) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan--receiver--phone.jpg` |
| scan step | manager | 390×844 | 54 | 17 | 45 (-9) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan--manager--phone.jpg` |
| scan: dark photo | receiver | 390×844 | 53 | 13 | 48 (-5) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan-quality--receiver--phone.jpg` |
| scan: dark photo | manager | 390×844 | 51 | 13 | 46 (-5) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan-quality--manager--phone.jpg` |
| scan: uploaded | receiver | 390×844 | 47 | 6 | 42 (-5) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan-uploaded--receiver--phone.jpg` |
| scan: uploaded | manager | 390×844 | 45 | 6 | 40 (-5) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan-uploaded--manager--phone.jpg` |
| scan: offline photo | receiver | 390×844 | 63 | 20 | 55 (-8) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan-offline--receiver--phone.jpg` |
| scan: offline photo | manager | 390×844 | 61 | 20 | 53 (-8) | `docs/ux/wave2/copy-focus/shots/C-receiving--scan-offline--manager--phone.jpg` |
| reading the invoice (3 s) | receiver | 390×844 | 50 | 9 | 41 (-9) | `docs/ux/wave2/copy-focus/shots/C-receiving--processing--receiver--phone.jpg` |
| reading the invoice (3 s) | manager | 390×844 | 48 | 9 | 39 (-9) | `docs/ux/wave2/copy-focus/shots/C-receiving--processing--manager--phone.jpg` |
| still reading (12 s) | receiver | 390×844 | 58 | 13 | 50 (-8) | `docs/ux/wave2/copy-focus/shots/C-receiving--processing-slow--receiver--phone.jpg` |
| still reading (12 s) | manager | 390×844 | 56 | 13 | 48 (-8) | `docs/ux/wave2/copy-focus/shots/C-receiving--processing-slow--manager--phone.jpg` |
| review (תוצאת ההצלבה) | receiver | 390×844 | 159 | 36 | 143 (-16) | `docs/ux/wave2/copy-focus/shots/C-receiving--review--receiver--phone.jpg` |
| review (תוצאת ההצלבה) | manager | 390×844 | 171 | 46 | 153 (-18) | `docs/ux/wave2/copy-focus/shots/C-receiving--review--manager--phone.jpg` |
| review + dock slip open | receiver | 390×844 | 216 | 68 | 187 (-29) | `docs/ux/wave2/copy-focus/shots/C-receiving--review-slip--receiver--phone.jpg` |
| review + dock slip open | manager | 390×844 | 254 | 98 | 210 (-44) | `docs/ux/wave2/copy-focus/shots/C-receiving--review-slip--manager--phone.jpg` |
| review: wrong invoice | receiver | 390×844 | 169 | 28 | 149 (-20) | `docs/ux/wave2/copy-focus/shots/C-receiving--review-mismatch--receiver--phone.jpg` |
| review: wrong invoice | manager | 390×844 | 167 | 28 | 147 (-20) | `docs/ux/wave2/copy-focus/shots/C-receiving--review-mismatch--manager--phone.jpg` |
| Delivery Check (count) | receiver | 390×844 | 149 | 23 | 136 (-13) | `docs/ux/wave2/copy-focus/shots/C-receiving--count--receiver--phone.jpg` |
| Delivery Check (count) | manager | 390×844 | 154 | 30 | 138 (-16) | `docs/ux/wave2/copy-focus/shots/C-receiving--count--manager--phone.jpg` |
| count: qty outside tolerance | receiver | 390×844 | 163 | 29 | 150 (-13) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-tolerance--receiver--phone.jpg` |
| count: qty outside tolerance | manager | 390×844 | 168 | 36 | 152 (-16) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-tolerance--manager--phone.jpg` |
| count: spot check sheet | receiver | 390×844 | 166 | 31 | 150 (-16) | `docs/ux/wave2/copy-focus/shots/C-receiving--spot-check--receiver--phone.jpg` |
| count: spot check sheet | manager | 390×844 | 171 | 38 | 152 (-19) | `docs/ux/wave2/copy-focus/shots/C-receiving--spot-check--manager--phone.jpg` |
| count: spot check failed | receiver | 390×844 | 160 | 31 | 147 (-13) | `docs/ux/wave2/copy-focus/shots/C-receiving--spot-mismatch--receiver--phone.jpg` |
| count: spot check failed | manager | 390×844 | 165 | 38 | 149 (-16) | `docs/ux/wave2/copy-focus/shots/C-receiving--spot-mismatch--manager--phone.jpg` |
| count: all marked | receiver | 390×844 | 172 | 23 | 159 (-13) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-done--receiver--phone.jpg` |
| count: all marked | manager | 390×844 | 177 | 30 | 161 (-16) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-done--manager--phone.jpg` |
| count: no invoice | receiver | 390×844 | 109 | 7 | 105 (-4) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-noinvoice--receiver--phone.jpg` |
| count: no invoice | manager | 390×844 | 107 | 7 | 103 (-4) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-noinvoice--manager--phone.jpg` |
| count: OCR still reading | receiver | 390×844 | 118 | 17 | 107 (-11) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-ocr-reading--receiver--phone.jpg` |
| count: OCR still reading | manager | 390×844 | 116 | 17 | 105 (-11) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-ocr-reading--manager--phone.jpg` |
| count: OCR ready | receiver | 390×844 | 119 | 17 | 107 (-12) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-ocr-ready--receiver--phone.jpg` |
| count: OCR ready | manager | 390×844 | 117 | 17 | 105 (-12) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-ocr-ready--manager--phone.jpg` |
| count: OCR failed | receiver | 390×844 | 120 | 20 | 108 (-12) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-ocr-failed--receiver--phone.jpg` |
| count: OCR failed | manager | 390×844 | 118 | 20 | 106 (-12) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-ocr-failed--manager--phone.jpg` |
| count: offline | receiver | 390×844 | 124 | 16 | 120 (-4) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-offline--receiver--phone.jpg` |
| count: offline | manager | 390×844 | 122 | 16 | 118 (-4) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-offline--manager--phone.jpg` |
| count: photo queued offline | receiver | 390×844 | 126 | 22 | 116 (-10) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-photo-queued--receiver--phone.jpg` |
| count: photo queued offline | manager | 390×844 | 124 | 22 | 114 (-10) | `docs/ux/wave2/copy-focus/shots/C-receiving--count-photo-queued--manager--phone.jpg` |
| count: leave sheet | receiver | 390×844 | 141 | 27 | 132 (-9) | `docs/ux/wave2/copy-focus/shots/C-receiving--leave-sheet--receiver--phone.jpg` |
| count: leave sheet | manager | 390×844 | 139 | 27 | 130 (-9) | `docs/ux/wave2/copy-focus/shots/C-receiving--leave-sheet--manager--phone.jpg` |
| count: session expired (lab predates the sheet) | receiver | 390×844 | 115 | 7 | 111 (-4) | `docs/ux/wave2/copy-focus/shots/C-receiving--reauth--receiver--phone.jpg` |
| count: session expired (lab predates the sheet) | manager | 390×844 | 113 | 7 | 109 (-4) | `docs/ux/wave2/copy-focus/shots/C-receiving--reauth--manager--phone.jpg` |
| confirmed (with dock slip) | receiver | 390×844 | 146 | 32 | 133 (-13) | `docs/ux/wave2/copy-focus/shots/C-receiving--confirmed--receiver--phone.jpg` |
| confirmed (with dock slip) | manager | 390×844 | 178 | 58 | 146 (-32) | `docs/ux/wave2/copy-focus/shots/C-receiving--confirmed--manager--phone.jpg` |
| confirmed: all as ordered | receiver | 390×844 | 54 | 7 | 51 (-3) | `docs/ux/wave2/copy-focus/shots/C-receiving--confirmed-clean--receiver--phone.jpg` |
| confirmed: all as ordered | manager | 390×844 | 52 | 7 | 49 (-3) | `docs/ux/wave2/copy-focus/shots/C-receiving--confirmed-clean--manager--phone.jpg` |
| /dashboard/orders/capture (ingest) | manager | 390×844 | 57 | 26 | 43 (-14) | `docs/ux/wave2/copy-focus/shots/C-receiving--order-capture--manager--phone.jpg` |
| **all 55 captures** | | | **6340** | **1259** | **5689** (-651) | |

What dominates: on the review with the dock slip open (manager), 98 of 254 words explain. There, "pending" is said 3 times, "duplicate" twice, and "no ₪ yet" 4 times (three "כמויות בלבד" labels + one note). On the confirmation (manager), 58 of 178 words explain; 12 of them are the label "כמויות בלבד", repeated on 6 lines. The receiver count screens carry 7–31 explanatory words; most are the duplicate banner and the "how to count" line.

## (b) Concepts explained in more than one place

- **concept.savedOnPhone: "it is saved on the phone and goes up when the connection is back" (10 wordings, 7 surfaces)**
  - `receivingDelivery.pwa.offline` "אין חיבור · נשמר בטלפון": PWA chip, every receiving screen → **canonical**
  - `ingest.pwa.queuedOne` / `queued` "תמונה אחת ממתינה להעלאה": the chip's second line
  - `receiving.steps.scan.bannerQueued` "נשמרה בטלפון · תעלה כשהחיבור יחזור": scan status (same screen as the chip: 3 lines, one fact)
  - `ingest.pwa.savedOffline` "התמונה נשמרה בטלפון ותעלה כשהחיבור יחזור": wizard notice on the count (always together with the chip)
  - `receivingDelivery.delivery.count.queued` "נשמר בטלפון": row save state (status, kept)
  - `receivingDelivery.delivery.count.offline`: count footer when closing offline
  - `receivingDelivery.delivery.leave.body`: leave sheet
  - `receivingDelivery.logoutGuard.body`: sign-out sheet
  - `receivingDelivery.delivery.error.body` "מה שכבר נספר שמור": error boundary
  - `receivingDelivery.delivery.count.sessionExpired` "…הספירה שמורה": count footer
  - `common.shell.offline.chip` "אין חיבור · נעדכן כשהרשת תחזור": shell chip (only when receiverPwa is off)
  - `ingest.pwa.offlineBody`: dead key, a fourth long wording
- **concept.continueWithOrder: "you can keep receiving against the order" (8 places)**
  - `receivingDelivery.delivery.scan.noInvoice` "אין חשבונית עכשיו — קלטו מול ההזמנה": scan button
  - `receiving.steps.processing.subtitleLive` "אפשר להמשיך מול ההזמנה בכל רגע…": processing, before the button exists
  - `receiving.steps.processing.stillReading` + button `continueWithOrder`: processing after 10 s
  - `receiving.errors.ocrTimeout` · `ocrFailed` · `ocrQuota` · `queueUnavailable`: four count-screen banners that each end "אפשר להמשיך לקלוט מול ההזמנה", shown on the count itself
  - `receiving.steps.recon.subtitleNoInvoice` "אין חשבונית — סמנו מה הגיע": showcase only (the authed flow skips the review without an invoice)
- **concept.amountLater: "why there is no ₪ yet" (8 places; manager only)**
  - `receiving.dockSlip.quantitiesOnly` "כמויות בלבד": every slip line (6× on one confirmation)
  - `receiving.dockSlip.afterClose`: slip note before the close (and, by a cache bug, after it)
  - `receiving.dockSlip.computing` · `slow` · `heldReview` · `heldSettled`: slip notes after the close
  - `receivingDelivery.delivery.confirmed.amountPending`: confirmation when the slip flag is off
  - `receiving.steps.recon.potentialLossHint` "הסכום ייקבע אחרי הבדיקה.": dead key
- **concept.pendingReview: "these lines need a manual check, not a פער" (3× on one screen)**
  - `receivingDelivery.delivery.review.pending` "{count} לבדיקה": review summary line
  - `receiving.steps.recon.pendingBanner`: banner under it
  - `receiving.steps.status.pending_review` "לבדיקה ידנית": badge on every such row
  - (wrong invoice) `receiving.steps.recon.mismatchBanner` + "14 לבדיקה" + 14 badges on review-mismatch
- **concept.duplicateInvoice (2× on one screen when the slip is open)**
  - `receiving.steps.recon.duplicateInvoice`: banner on the review AND the count
  - `receiving.dockSlip.duplicate`: inside the slip (part of the WhatsApp text: kept)
  - `ingest.documentStatus.duplicate` "כפול — כבר התקבל": invoice inbox row
- **concept.priceDiff: "the invoice price differs from the order" (manager)**
  - `receiving.steps.status.price_diff` "מחיר שונה": row badge, with both prices printed
  - `receivingDelivery.delivery.review.priceToManager`: under the same row on the review, and on the count
  - `receiving.dockSlip.issue.overPriceNoAmount` "המחיר בחשבונית גבוה מההזמנה": slip line
  - `dockPrice.usual` + `dockPrice.title`: usual-price line under the row (also on /dashboard/invoices/<id>)
- **concept.receiptClosed: one state, four wordings**
  - `receiving.steps.confirmed.title` "קבלת הסחורה נסגרה": just closed
  - `receivingDelivery.delivery.summary.title` "קבלת הסחורה כבר נסגרה" + subtitle: wizard summary
  - `overview.board.receipt.readOnly` "הקבלה נסגרה — לקריאה בלבד" + badge "התקבל ✓": ?receipt= view of the same receipt
  - server CONFLICTs "הקבלה כבר נסגרה — …" (receiving.ts:769, 924): never shown (the UI says "משהו השתבש")
- **concept.sessionExpired (2× at the same moment)**
  - `receivingDelivery.delivery.count.sessionExpired`: count footer
  - `common.shell.session.title` / `body`: re-auth sheet on top of it
  - `receivingDelivery.pwa.signInToUpload`: PWA chip
- **concept.bulkNotCounted**
  - `receivingDelivery.delivery.count.bulkTag` "לא נספר פריט-פריט": count rows and summary rows
  - `receivingDelivery.delivery.confirmed.bulkNote`: confirmation
- **concept.noAutoSend: "nothing is sent automatically"**
  - `receiving.dockSlip.noSend`: dock slip
  - `ingest.orderCapture.draftHint`: order from WhatsApp
- **concept.fileLimits and concept.network: same error, two keys or two wordings**
  - `receiving.steps.scan.network` = `receiving.errors.network` (byte-identical, two keys)
  - `receiving.steps.scan.unsupportedType` vs `ingest.errors.unsupported_type`; `receiving.steps.scan.tooLarge` vs `ingest.errors.too_large`
- **concept.noPo (2× on one card)**
  - `overview.board.noPo.title` "חשבונית בלי הזמנה" + `noPo.hint` "ספק הגיע בלי הזמנה? …"
- **concept.threeWayMatch**
  - `ingest.orderCapture.subtitle` ("…כדי שנוכל לבדוק מולה את החשבונית") and `ingest.orderCapture.confirmed` ("…החשבונית תיבדק מולה")

## (c) The 10 highest-value changes

1. **Wrong-invoice banner, review (`receiving.steps.recon.mismatchBanner`, 28 → 7 words)**
   - לפני: "אף שורה בחשבונית לא הותאמה לשורות ההזמנה. אם זו חשבונית של ספק אחר, פתחו את ההזמנה הנכונה או צלמו שוב; אם זה הספק הנכון, עברו על השורות ידנית."
   - אחרי: "אף שורה לא תואמת להזמנה — אולי ספק אחר?". The two ways out are the two buttons under it.
2. **"Not a פער" banner, review (`receiving.steps.recon.pendingBanner`, 14 → 8; the same screen already says it in the summary and on each row)**
   - לפני: "{count} שורות לא הוצלבו אוטומטית — סמנו אותן לפי מה שהגיע. זה לא פער, רק בדיקה."
   - אחרי: "{count} שורות לבדיקה, לא פער — סמנו לפי מה שהגיע". Stays calm (T4).
3. **Duplicate invoice, review + count (`receiving.steps.recon.duplicateInvoice`, 16 → 7)**
   - לפני: "מספר החשבונית {number} כבר קיים אצל הספק הזה — סומנה לבדיקה כחשבונית כפולה אפשרית. אפשר להמשיך לקלוט כרגיל."
   - אחרי: "ייתכן שחשבונית {number} כפולה — היא תיבדק. המשיכו כרגיל."
4. **OCR notices on the count: drop the "continue against the order" tail, the receiver is already doing it (`receiving.errors.ocrFailed` 13 → 5; also ocrTimeout 10 → 3, ocrQuota 10 → 4, queueUnavailable 12 → 7)**
   - לפני: "לא הצלחנו לקרוא את החשבונית. אפשר להמשיך לקלוט מול ההזמנה, או לצלם שוב."
   - אחרי: "לא הצלחנו לקרוא את החשבונית". "או לצלם שוב" points to a button the count does not have.
5. **Reading the invoice (`receiving.steps.processing.subtitleLive` CUT; `stillReading` 13 → 5)**
   - לפני: "אפשר להמשיך מול ההזמנה בכל רגע — החשבונית תושלם ברקע. / זה לוקח יותר מהרגיל. אפשר להמשיך מול ההזמנה — נציג את החשבונית כשתהיה מוכנה."
   - אחרי: "— / נציג את החשבונית כשתהיה מוכנה.". The first line promises a button that appears only after 10 s.
6. **Saved on the phone: one fact, said once (`ingest.pwa.savedOffline` CUT; `receiving.steps.scan.bannerQueued` 5 → 2; `delivery.count.offline` 12 → 7)**
   - לפני: "התמונה נשמרה בטלפון ותעלה כשהחיבור יחזור / נשמרה בטלפון · תעלה כשהחיבור יחזור / אין חיבור — הספירה שמורה בטלפון. אפשר לסגור את קבלת הסחורה כשהחיבור יחזור."
   - אחרי: "— / נשמרה בטלפון / אין חיבור · הספירה שמורה. סגרו כשהחיבור יחזור". The PWA chip "אין חיבור · נשמר בטלפון" is already on screen.
7. **Dock slip, manager: one note, no per-line label (`receiving.dockSlip.quantitiesOnly` CUT ×N; `afterClose` 14 → 6; `computing` 5 → 2)**
   - לפני: "כמויות בלבד (בכל שורה) + סכום הפער בש״ח ייקבע אחרי סגירת קבלת הסחורה — מנוע ההתאמה בודק מול הספירה בפועל."
   - אחרי: "הסכום ב־₪ ייקבע אחרי סגירת קבלת הסחורה"
8. **Dock slip, both roles (`receiving.dockSlip.subtitle` 12 → 5; `noSend` 11 → 4)**
   - לפני: "להציג לנהג לפני שהוא יוצא — מה חסר, מה פגום ומה חויב ביתר. / לא נשלח דבר אוטומטית — הקישור פותח את הוואטסאפ שלכם עם הטקסט."
   - אחרי: "הראו לנהג לפני שהוא יוצא / שום דבר לא נשלח אוטומטית"
9. **Board (`receiving.inbox.subtitle` CUT; `overview.board.noPo.hint` 14 → 5)**
   - לפני: "המשלוחים של היום. בחרו ספק כדי לבדוק מה הגיע. / ספק הגיע בלי הזמנה? בקשו ממנהל/ת המשמרת לפתוח הזמנה, והמשאית תופיע כאן לקבלה."
   - אחרי: "— / בקשו ממנהל/ת המשמרת לפתוח הזמנה."
10. **Count guidance (`delivery.count.subtitle` 7 → 3; `spotHint` 8 → 5; `review.priceToManager` 7 → 4, manager)**
   - לפני: "סמנו מה הגיע. שורה שהגיעה כמו בהזמנה — ✓. / ספרו את הפריטים האלה ורשמו כמה הגיע בפועל. / המחיר בחשבונית שונה מההזמנה — עובר לבדיקת המנהל"
   - אחרי: "סמנו מה הגיע / ספרו ורשמו כמה הגיע בפועל / מחיר שונה — ייבדק באישורים"

## Other findings

Four things change which explanation the receiver sees, beyond the wording. They are for the wizard owner, not for a copy PR.

1. **The invoice poll and "רענון" read the React Query cache.** `utils.receiving.getInvoice.fetch` (wizard.tsx:432, 489, 504) runs under the app-wide `staleTime` of 30 s (queryClient.ts:11). The stub saw one `getInvoice` request in 28 s of polling. The effect: the review appears at least 30 s after OCR finished, and "עדיין קוראים / זה לוקח יותר מהרגיל" shows when it is not true. "רענון" on the count does nothing for 30 s. Fix: `fetch(input, { staleTime: 0 })`.
2. **The confirmation shows the pre-close slip note.** The dockSlip query is not invalidated on submit, so for 30 s after the close the manager sees "סכום הפער… ייקבע אחרי סגירת קבלת הסחורה" under the title "קבלת הסחורה נסגרה" (lab: confirmed, manager).
3. **CONFLICT errors become "משהו השתבש. נסו שוב."** `receivingErrorText` maps only FORBIDDEN, UNAUTHORIZED and BAD_REQUEST. "Order cancelled" and "receipt already closed" therefore read as a retryable glitch. A closed-receipt row says "השמירה נכשלה · נסו שוב" forever. The 3 server rows in the JSON propose an appCode + a short key.
4. **Plurals:** "1 שורות עוד לא נשלחו" (leave sheet, lab) and "1 צילומי חשבונית עוד לא נשלחו" (sign-out sheet; W1-06.spec.ts:732 asserts that text, so an ICU fix updates the test).

**Receiver languages (receiverLangs):** the ar/ru/th/ti overlays of `receiving` were translated from the pre-W1-06 Hebrew. `git blame` shows the he line newer than all four overlays for 63 of its 174 keys (67 for ru). I checked the Russian against the current Hebrew:
- **Different meaning:** `steps.processing.subtitleLive` (ru: "reading and comparing, a few seconds") and `steps.recon.pendingBanner` (ru: "check them against the invoice"; he: "mark them by what arrived").
- **Explanations the Hebrew dropped:** `steps.confirmed.subtitle` (ru adds "the system is doing the final reconciliation now"), `inbox.subtitle` and `steps.processing.stillReading` (ru adds "up to 2 minutes").

`receivingDelivery`, `ingest.pwa`, `scans` and `receiverLangs` are in sync. Two consequences:
- Every SHORTEN, CUT or MERGE above in an overlaid namespace (`receiving`, `receivingDelivery`, `scans`, `ingest.pwa`, `receiverLangs`, `overview.board`, `common.shell`) needs its 4 overlays redone. The type check (`CompleteOverlays`) and `receiver-langs.test.ts` enforce the keys, not the meaning.
- Redo the stale `receiving` overlays from the final Hebrew in the same PR.

**Dead keys (render nowhere in-app; he + en + 4 overlays each):** 9 explanatory ones are in the JSON as CUT (`receiving.inbox.emptyDescription`, `receiving.steps.recon.potentialLossHint`, `receivingDelivery.delivery.count.unorderedNeeds`, `receiverLangs.picker.hint`, `receiverLangs.lines.machine`, `receiverLangs.lines.untranslated`, `ingest.pwa.offlineBody`, `ingest.pwa.installHint`, `ingest.channels.disabled`). Not listed, because they are labels rather than explanations: the other dead keys. `receiving` has 49 unreferenced keys in all (2 of them explanatory, listed above), among them inbox.badge.*, steps.adjust.*, steps.confirmed.verified*, steps.recon.matched / different / quickConfirm, dockSlip.atStake, english.* except showHebrew and errors.upload / forbidden. `receivingDelivery` adds `delivery.count.close` and `delivery.count.remaining`; `ingest` has 10 unreferenced keys, `receiverLangs` 4. Separately, 19 `receiving` keys are rendered only by /showcase (steps.supplier.*, steps.processing.subtitle and the stage labels, demo.banner); they stay.

**House style (buttons and labels, not explanations; same PR):**
- `delivery.scan.useAnyway` "להשתמש בתמונה בכל זאת" → "השתמשו בתמונה בכל זאת".
- `scans.openInTab` "פתח בטאב נפרד" → "פתחו בלשונית נפרדת".
- `dockPrice.usual` "שלך" and `dockPrice.title` "ששילמת" → plural.
- `dockSlip.subtitle` "להציג" → "הראו".
- The dead `inbox.openReceipt` / `receiveGoods` are masculine singular; deleting them settles it.

**Binding rules held:** no ₪ text added to a receiver surface (all ₪ proposals are on manager-only notes); a11y names kept; T4 wording calm ("לבדיקה, לא פער", "ייתכן … כפולה"); terms פער, דרישת זיכוי and קבלת הסחורה kept; no "יעד". No confirmation that names ₪ and a supplier exists in this area. The destructive "מחקו {count} צילומים והתנתקו" is kept as is.

**testRefs:** only 2 changed strings are read by tests:
- `overview.board.receipt.readOnly`: W1-05.spec.ts:429 imports the catalog, so it passes unchanged.
- `confirmed.bulkNote`: W1-06.spec.ts:332 checks the substring "לא נספרו פריט-פריט", which the proposal keeps.

Every other changed string is checked only by test id (recon-mismatch-banner, recon-pending-banner, ocr-notice-*, dock-slip-after-close, dock-slip-computing, scan-no-invoice, leave-sheet). The generic parity tests (`delivery.test.ts`, `i18n.test.ts`, `receiver-langs.test.ts`) need no edits once he, en and the 4 overlays move together.
