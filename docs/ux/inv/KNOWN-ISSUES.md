# INV · known issues in the reference

The mock-ups are a proposal, not product code. They were reviewed in several independent rounds, and the code
of the area was mapped file by file before this folder was written. The points below are where a mock-up is
looser than the product's rules, shows something the product does not have, or draws something that needs a
server field. **Where this file and the reference disagree, this file wins. Where the product's code or
`SPEC.md` and the reference disagree, the code or the spec wins.** The list is not complete: check your own
screen as you map it, and add what you find to your pull request.

File and line citations are from `main@de5cfcf7` (`main` on 28.11.2026); "DS3-04:" means the finished desk
branch at `a6be4080`. What was run to write this folder: the partition check, the gates of the merged bases,
a trial of the desk's merge with `main`, a trial of the empty message groups, the product's copy guard on
the one sentence two screens share, and the suites with and without the lab's environment ("Not determined",
at the end; `WORKPLAN.md`, S10; `README.md`, step 6). Behaviour is read from the code.

## `main` moved after the proposal was drawn

The proposal's "היום" pictures and sentences describe `main` at `9dc0b934`. The code maps were read at
`83bda7d7`, and this folder describes `main` at `de5cfcf7`, 181 commits later. Inside this area `main` gained,
among others: an allocation-number field on the invoice screen
(`apps/web/app/dashboard/invoices/[invoiceId]/allocation-field.tsx`, mounted in `[invoiceId]/page.tsx` by pull
request 341), "לא נספר" on a line whose receipt was closed without a count
(`packages/api/src/routers/invoices.ts:469`), a helper for the desk's summary refresh
(`apps/web/app/dashboard/approvals/summaryRefresh.ts`), and more payment methods in the pay run's selection.
The approvals desk was rebuilt by DS3-04 on its own branch and is not on `main`. Start from current `main`,
map your screen first, and build the difference only.

**`STATE.md` on `main` is behind the code in two places, and the code wins.** It says the approvals engine
has 7 rules, and that a duplicate is routed "to the bookkeeper who cannot act" (`STATE.md:134-135`). The
engine has eight rule ids and a fallback (`packages/api/src/approvals/engine.ts:152-217`, `:254`), and the
bookkeeper decides a gap routed to the bookkeeper (`packages/api/src/routers/approvals.ts:59-60`, `:386`,
`:1246-1262`; `packages/api/src/lib/roles.ts:44`). This folder follows the code. `STATE.md` is not yours to
edit.

## Every mock-up: demo shortcuts

1. **One gap per invoice, of two kinds.** The demo has four invoices, each with one gap: a bill for more than
   was received, or a price above the expected one. A real invoice can carry several gaps, gaps at two roles
   at once, gaps that sit on no line (a total that does not match its lines, a duplicate, an item missing on
   the invoice) and rows to review with no ₪. Everything "per invoice" in the mock-ups (its place, its role,
   its one line, its one card) needs the rule in `SPEC.md` §8, points 1, 2, 3 and 11. Point 11 also says
   which gap the places that exist once per screen speak for (the line "חפשו במסמך", the phone's dock, the
   foot of the whole-screen dialog, the pinned bar): the screen's current gap.
2. **One store behind four mock-ups.** A decision in one mock-up repaints the other three at once, and the
   role switch "להציג כמו" changes who is looking. The product has neither: each screen reads the server, and
   a refresh after an undo must never join a request that is still in flight (the lesson of pull request 360).
3. **Everything is decided "today".** The mock-ups keep a decision in memory, so the words are "הוחלט היום" and
   "נפתחה היום", and the stamp is the browser's clock. In the product a decision is read back from the server
   with its own time, and a decision of an earlier day must not say "היום". The words for an earlier day are
   not written anywhere: print the date in its place and name it in your pull request.
4. **"10 ימים" exists only on the demo day, and no running server shows it.** The e2e seed dates everything
   from the day of the run. The lab's seed is pinned to 25.10.2026, but its server runs on the real clock
   (`README.md`, step 5), so a wait there reads 10 plus the days since. The reference's day counts are
   reproduced only in a unit test that passes "now". The count is also not what the mock-ups imply: a
   re-match replaces the gap rows, so "since when" restarts (`packages/api/src/routers/match.ts:184-193`).
   State it; do not hide it.
5. **The reason has only three phrases.** `INV.because` returns the quantity phrase for every blocking gap
   that is not a price gap, the ₪ band for `cumulative-medium`, and nothing for every other rule. The engine
   has eight rule ids and a fallback (`packages/api/src/approvals/engine.ts:152-217`). Do not print "חיוב על
   יותר ממה שהתקבל חוסם תשלום" on an item that was not ordered, and do not print the ₪ band on a gap the
   percentage routed. The rule's stored name is not a substitute: it holds the retired word "הפרש"
   (`engine.ts:195`, `:204`). And the price phrase's "10%" is not a constant: it is the restaurant's own
   `tolerances.blockPricePercent` (default 0.1, `packages/matching/src/tolerances.ts:9`), editable on the
   settings screen. Print the setting, and only when the gap's own percent is at or above it.
6. **Only the manager passes a gap on.** "הניהול העביר אחרי N ימים" is fixed text, and the earlier routing in
   the history is hard-coded. The product offers the pass-on to any role but the owner, on a gap it may
   decide that is not the owner's (`apps/web/app/dashboard/approvals/vocab.ts:103-105`): also the bookkeeper
   on a duplicate, and the manager on an unrouted gap. Keep that, and use the word of the role that passed
   it; the bookkeeper's phrase is not approved yet (`SPEC.md` §8, point 18). The mock-up also shows only the
   day of the pass-on ("מהיום"): `SPEC.md` §2.2 says what the wait reads on later days.
7. **Passing on is one press.** The product opens a sheet with an optional note, and the owner reads that
   note. The sheet stays.
8. **People.** The top bar says "דנה כהן · בעלים". Those names are invented; the demo seed has other people,
   and who is looking is the shell's to show. No screen of this batch prints a person's name beside an act.
9. **Amounts are floats.** The mock-ups round with `Math.round(x * 100) / 100` and build ₪ strings by hand.
   The product reads integer agorot and prints through `formatIls()` or the shared money component.
10. **Singular forms are partly fixed text** ("נמצא פער אחד" in the history). Every count needs its singular
    and plural, in Hebrew and in English.
11. **The frames are scaled.** A frame is 1240 px wide and is drawn smaller as one picture on a narrower
    window; under 900 px of frame width it switches to the phone layout. So the reference shows no real
    layout between about 900 and 1240 px. `SPEC.md` gives the rules for 1024 and for a tablet.
12. **Dense rows follow the role alone.** The product also has a personal density preference; read it.
13. **`[` and `]` always act in the mock-up**, and act whenever the pointer is over the frame. In the product
    they follow the single-key switch and the focus, as today's handler does for typing.
14. **The message with "ביטול" is placed by script** over the part of the mock-up that is on screen, because a
    mock-up is taller than a window. That is a property of the page. The product uses the desk's own message,
    which is a component its view places. On the invoice screen `INV-01` keeps the places for it (the slot
    `message` of `gap-actions.tsx`: `WORKPLAN.md`, S7), and `INV-05` draws it there.
15. **English.** The mock-ups are Hebrew only. Every new string needs its English twin in the same commit.

## The invoices list (`INV-02`)

- **The places are computed in the browser** from the demo's one gap per invoice. In the product the place of
  an invoice and the sums of the cards come from the server (`place`, `places[]`).
- **A possible duplicate has no card.** The mock-up maps it to a place that no card shows, so an invoice
  could be in no place. `SPEC.md` §8, point 2.
- **"ממתינות לשיוך" holds more than its name.** The mock-up puts invoices being read and invoices waiting for
  the count there too, and its third line "חשבוניות מרכזות" is true only because both demo invoices are
  consolidated. Today an invoice waiting for the count sits in the tab "בהשהיה"
  (`packages/api/src/routers/invoices.ts:65-75`). The default is `SPEC.md` §8, point 17: both kinds are in
  that place, the third line is printed only when every invoice in it is consolidated, and the card's name
  when it holds other kinds needs the owner's word.
- **"שולמו" is the demo's.** Its third line "בנתוני ההדגמה" and the summary's "מסומנת כשולמה בנתוני ההדגמה."
  are true for the seed only. Nothing records a payment for a real restaurant, so the card is hidden there.
- **"חסר מספר הקצאה" is not drawn with data.** October has none. The product's rule is the pay run's
  (`packages/api/src/vat/vatAtRisk.ts`): above the threshold of the invoice's date, a malformed number counts
  as missing, an invoice being read and a credit are left out. That read looks at the 2,000 newest invoices
  (`vatAtRisk.ts:137`). The line "צריך לבקש מהספק" must not contradict a number that was already asked for.
  It is not the row's existing `allocationRequired`, which looks at the date and the amount only
  (`packages/api/src/routers/invoices.ts:114-118`).
- **The summary's calculation needs a unit price** ("3 ק״ג × ₪12.90 = ₪38.70"). On `INV-02`'s base the queue
  row has quantities and no unit price (DS3-04 adds it, on its own branch): read `invoices.detail` for the
  picked row, and never derive a price by division.
- **The sentence is the month's; the desk's queue is not.** A gap on last month's invoice is on the desk and
  missing from "אין פערים פתוחים החודש." Say what the sentence counts; do not present it as everything open.
- **Today's gap figure is not "the open gap".** `gapAgorot` on a row is every leak finding whatever its
  decision, capped at the invoice's total. The open ₪ comes from the new `holding` field, never from a sum in
  the screen. The mock-up's paid rows show a gap in grey: those are gaps of the past.
- **A late invoice has no words.** The mock-ups say "נותרו N ימים" and "היום האחרון" only. The desk has
  "באיחור מ־{date}" (DS3-04: `messages/approvals/he.ts:131`); whatever is said stays plain text, never a
  coloured chip.
- **The gap column's head says "לפני מע״מ"**, and a duplicate's amount includes VAT while a VAT mismatch is the
  VAT itself. Print the basis the server returns.
- **Enter opens the summary** in the mock-up and the invoice screen today
  (`(register)/register-client.tsx:240`); the list test of `apps/web/e2e/W2-02.spec.ts` that follows a row to
  the invoice changes on purpose.
- **Not drawn, and kept:** the month links, the export, the column and density menus, the paging, "להשלמת
  שורות" and "נכנסות". The mock-up shows all 37 rows at a desk with no paging.
- **The summary on a phone** is drawn as a sticky block at the end of the list. Use the product's sheet.

## The invoice screen (`INV-01`, `INV-05`)

- **The mock-up opens on step two.** The switch "המסמך" starts on "עם סימון", so the first thing a reader sees
  is what this batch does not build: the mark with its tab "פער", "הציגו את השורה", the sentence "בשורה
  המסומנת: …", the caption "השורה עם הפער מסומנת", the document opening on the gap's line, the phone's window
  onto the lines around the gap, a row of the table pointing at the document and back. Use "בלי סימון" and
  "בלי קובץ" only. The checks `verify15.cjs`, `verify16.cjs` and `verify17.cjs` test many of these: do not
  port them as acceptance.
- **The documents are drawings, not files.** Each is 760 by 1075 px of HTML, one page, straight and sharp,
  and its supplier, addresses, numbers and SKUs are invented (the SKU is computed from the line's position).
  A real file is a photograph of any size and angle, a scan, or a PDF of several pages; a real SKU is what the
  reading stored and can be absent.
- **A PDF is drawn like an image** in the mock-up, with "PDF · עמוד 1 מתוך 1". In the product a PDF stays in
  the browser's sandboxed frame (`apps/web/lib/components/invoice/InvoiceScanViewer.tsx:88`), which has its
  own tools and may not draw on a phone. `INV-01` adds no dependency. And no page count reaches the invoice
  page today: `resolveScan` returns `pageCount: null` for an invoice id
  (`apps/web/lib/supabase/server.ts:132`, `:106`, `:153`), so the toolbar says "PDF" (`WORKPLAN.md`,
  `INV-01`, slice 4).
- **The PDF library's licence is not verified.** The page text says "pdf.js של Mozilla, רישיון Apache 2.0". No
  PDF-drawing library is in the repository, nobody read the licence of an exact version, and the product's
  security policy has no allowance for a worker or for WebAssembly
  (`apps/web/lib/securityHeaders.ts:70-86`). Whether the storage host lets a script read a file's bytes
  cannot be learned from the code. That is all of `INV-06`, optional, with three checks that each stop it.
- **The file's address expires.** A signed address lives 30 minutes (`apps/web/lib/supabase/server.ts:41`). A
  document left open can fail to load again: one calm line and "פתחו את המקור", never a broken frame.
- **No demo invoice has a file.** The e2e lab stores no scans (`apps/web/e2e/W2-02.spec.ts:176`), so today
  no spec exercises the viewer, the demo seed attaches none, and the lab's production server cannot serve a
  local file (`packages/api/src/lib/localScanStorage.ts:29-33`). `INV-01` brings a stored image and a stored
  PDF for its own spec; `WORKPLAN.md`, `INV-01`, "Seeing a document locally", says how a file is attached
  and where it can be looked at.
- **The card decides in the mock-up.** In `INV-01` it does not: one button opens the desk. The two buttons,
  the reasons, the message and the undo arrive with `INV-05`, mounted from the desk and never copied. Until
  then the pinned bar's button reads "לפרטי הפער" for every role: the mock-up's "להחלטה" there returns the
  pane to the card's two buttons, which `INV-01` does not have.
- **"לפער הבא, אצל הנהלת החשבונות" is five words** (the reference builds it the same way,
  `reference/src/inv-invoice.js:61`), and the owner can meet it, since the owner may decide a duplicate. A
  button holds four: `INV-05` proposes a shorter label for that case under "Owner decisions touched" and
  does not ship the five-word one.
- **Stepping exists only from the list.** The mock-up always shows "חשבונית 1 מתוך 4 שנמצא בהן פער" and its
  two buttons. In the product the place line, the buttons and `[` / `]` exist only when the person came from
  the list (`from=register`), as today (`[invoiceId]/cockpit.tsx:125`, `:361`).
- **The mock-up has no switch between two panes and one column**: it scales one 1240 px frame. In the
  product the switch is the window's width, 1024 px, as today (`cockpit.tsx:100`); at a 1024 px window the
  content box is 712 px with the side menu open, so the document's pane sits at its narrowest stop.
- **Two retired words on this screen today.** `invoices:correction.linesLocked.consolidated` says "חשבונית
  ריכוז" (`apps/web/lib/i18n/messages/invoices/he.ts:45`): `INV-01` rewords it with "חשבונית מרכזת", both
  languages. `invoices:needsLines.heldTitleReadOnly` says "הבעלים או המנהל" (`he.ts:113`): it stays in this
  batch, because `apps/web/e2e/pilot-unread-invoices.spec.ts:117`, which nobody may edit, pins it; name it in
  the pull request under "Requests to other packages".
- **The payment block has two drawn states.** "בהשהיה" because of the gap, and "ניתן לשלם". The allocation
  line is fixed text ("מספר הקצאה לא נדרש בסכום הזה.") and the check line is always ticked. The product has
  eight reasons for a hold (`packages/api/src/routers/payRun.ts:451-475`), three forms of the allocation line
  (not required, the number itself, missing), and a check that can fail or not exist yet
  (`messages/invoices/he.ts:212`). Only "not required" has words in the reference: the other forms use the
  product's own words and are named in the pull request. The sentence "ההחלטה על הפער תשחרר את החשבונית
  לתשלום." is true only when the gap is the only thing holding the invoice. Where the allocation field is
  mounted it already says the number, its state and the deadline, so there the field is the allocation line
  and the block prints its own only for "not required" (`SPEC.md` §4.6); on such an invoice the field's chip
  still reads "חסר", because the field's state is about the stored number alone (missing, valid or
  malformed) and not about whether one is required (`packages/api/src/routers/vat.ts:101`). The file is not
  `INV-01`'s: name it in the pull request.
- **"חשבונית 1 מתוך 4 שנמצא בהן פער"** fits the mock-up, which walks the four invoices with a gap. The product
  walks the place the person came from; the words after the count must be true for that place, or be left
  out.
- **The chain is gone at a desk.** Today's chain links to the order and to the receipt
  (`apps/web/lib/components/documents/DocumentFlow.tsx`); the mock-up shows it on a phone only. Keep both
  links reachable at a desk and say where.
- **Kept and not drawn:** the reading correction ("ערכו נתוני סריקה") and its automatic re-match, "לבדיקה",
  "לא נספר", "פתחו את המקור", the consolidated panel, the dock-price notes, the partial-load banner, the
  duplicate notice, the findings that sit on no line, the five origins of the back link. Where each sits in
  the new screen is the first slice of `INV-01`. The allocation field is a case of its own: it is mounted
  on `main` (pull request 341), and `INV-01` moves that one mount into the payment block, unchanged, adds
  none and never edits the file.
- **Two things were left as they are in the reference, on purpose.** For about 60 px of scrolling the pinned
  amount lies over the card's buttons. And the whole-screen document covers the message with "ביטול" when it
  is opened inside its ten seconds: in the product the message must stay reachable for its whole window, so
  the dialog has a place for it above its foot (`WORKPLAN.md`, S7, the slot `message`).
- **The order's date differs between two screens today.** The invoice screen reads the expected delivery date
  (`packages/api/src/routers/invoices.ts:312`), the desk the date the order was sent
  (`packages/api/src/routers/approvals.ts:298`). The new group head uses the sent date on both.
- **The count of gaps differs between two screens today.** `invoices.detail.openCount` counts the ₪0 twin
  (`routers/invoices.ts:480`); the desk hides it. The screen reads the new `queueOpenCount`.

## Approvals by role (`INV-04`)

- **The mock-up is a drawing of the desk, not the desk.** It has no bulk selection, no "approve the whole
  invoice", no filters, saved views or CSV, no branch strip, no key help, and none of the bar's other forms
  (a duplicate, "סמנו כנבדק", "שייך להזמנה"). All of them exist on DS3-04 and stay. Build on DS3-04's files;
  `docs/ux/ds3/SPEC.md` §10.2 stays binding for the desk's look. One label changes its form: "שייך להזמנה"
  is a singular imperative on a button (`main`: `messages/approvals/he.ts:114`; DS3-04: `:300`), which
  `README.md` forbids, so `INV-04` rewords it to "שייכו להזמנה", key unchanged, with the test line that pins
  it (`approvals/__tests__/vocab.test.ts:158`).
- **Title and row meta.** The mock-up's title is "אישורים" and a row shows the days it waits; the product's
  title is "תור אישורים" (`messages/approvals/he.ts:8`) and DS3-04's row shows the due date (DS3-04:
  `queue.tsx:405-417`). `SPEC.md` §8, point 13.
- **The undo's word.** "ביטול" in the mock-up, "בטלו" in the product (`main`:
  `messages/approvals/he.ts:182`; DS3-04: `:368`). `SPEC.md` §8, point 12.
- **The message's words.** The desk's own message is "{verb} · {amount} {basis}", and its line after an undo
  is "ההחלטה בוטלה · הפער חזר לתור" (DS3-04: `messages/approvals/he.ts:284`, `:370`;
  `approvals/desk-text.ts:123`). The mock-up's are "{result}, {supplier}" and "ההחלטה בוטלה." The desk's
  stay, on both screens. Two cases do not fit and are `INV-04`'s: "הפער חזר לתור" is wrong on the invoice
  screen, which has no queue, so the exported decision gives a host without a queue the line without it
  (`WORKPLAN.md`, S9); and with the ending "החלטתם במקום הנהלת החשבונות" the desk's form passes the eight
  words a message may hold, so `INV-04` names that one under "Owner decisions touched" and does not shorten
  an approved phrase by itself.
- **A row paid as billed drops the role.** Under "הוחלט היום" the mock-up writes "נוסף לבקשת הזיכוי · בעלים"
  and only "הפער: שולם כפי שחויב". The page text promises the result and the role for both: show the role on
  both.
- **The card "מי מחליט על מה" is fixed text.** Six rows with ₪300, ₪50, 5 % and 2 % typed in. The product
  takes the numbers from `settings.effective` and the order from the engine, which has eight rule ids and a
  fallback, among them one added after the proposal's research (`non-leak-acknowledge`) and two whose amounts
  do not change who decides (an invoice with no order, an item that was not ordered: both reach the owner at
  any amount). Whether the card lists those is the owner's to say; a person's pull request (359) changes one
  rule's wording, so the card follows what `main` holds when the package ships. The lists "מה חוסם תשלום" and
  "מה נחשב מידע" are facts of the matching engine: take them from the code, read-only, not from the mock-up.
- **The same gap is drawn two ways** (not decided by the owner). The desk tints one cell and writes "3 ק״ג
  פחות"; the invoice screen draws the two cells that disagree as an ink pair and writes "חויבו 3 ק״ג יותר".
  Each screen keeps its own drawing; do not "align" them either way without saying so.
- **The document in the evidence** is three retyped lines in the mock-up. DS3-04 has its own.
- **"הכול מטופל".** DS3-04 says it whenever the viewer's own queue is empty and draws the green mark of an
  empty inbox. Under this spec it shows only when nothing is open for anyone, with a grey mark.
- **The jump narrows the desk; the mock-up's does not.** `/dashboard/approvals?invoice=<id>&sel=<gapId>`
  narrows the queue and the summary to that invoice (DS3-04: `approvals/page.tsx:50-52`, `:68-70`), while the
  mock-up only picks the gap on the full queue (`reference/src/inv-core.js:199-201`). After "להחלטה" from
  the list, the invoice screen or the pay run, the head's counts, "1 מתוך 4" and the hint "אחריו נשארים עוד N
  פערים" are that invoice's. `INV-04` (slice 2) makes the filter visible and cleared in one press, and after
  the invoice's last gap the desk shows the filtered note (DS3-04: `approvals/page.tsx:156-157`), never
  "הכול מטופל" while gaps are open elsewhere.
- **The retired word "הפרש" is also in labels the desk shows** (DS3-04: `messages/approvals/he.ts:28`, `:310`,
  `:314`; on `main`: `:26`, `:124`, `:128`): `summary.vat`, `amountLabel.vat`, `amountLabel.other`. Reword
  them with "פער", both languages, keys unchanged, and name it in the pull request;
  `approvals/__tests__/vocab.test.ts:308` pins one of them and changes with it.
- **Not answered by the mock-up:** whether the other roles' rows and the decided rows show while a filter or
  `?invoice=` is set, and whether the CSV holds them; what the single-invoice landing
  (`/dashboard/approvals/[invoiceId]`) says to a role with nothing to decide there while gaps are open for
  others; more than 50 open gaps (the desk reads pages of 50, DS3-04: `desk-state.ts:38`, `page.tsx:68`;
  the server allows up to 100 a call, `packages/api/src/routers/approvals.ts:227`). Decide each as the desk
  decides the same case and name it in the pull request.

## The pay run (`INV-03`)

- **The pay run is off for the pilot restaurant.** That is the owner's statement on the proposal page. The
  admin panel's pilot preset (`apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:25-37`) lists ten keys
  and `payRun` is not one of them, which agrees with it; what is stored for the pilot restaurant is in the
  production database, which no session reads. `PILOT_FEATURE_KEYS` in
  `packages/db/scripts/pilot-setup.ts:61-95` is only the list of keys that exist (`payRun` is in it, as every
  key is). The mock-up shows the demo, with a notice that is the mock-up's own. The product's disabled state
  stays as it is.
- **Four groups are drawn; the server has eight reasons** (`packages/api/src/routers/payRun.ts:451-475`: a
  duplicate copy, waiting to be linked, waiting for the count, an open question, a held reading, a note
  billed twice, a decision, a missing allocation number), and one invoice can carry several. One group per
  invoice needs an order of precedence (the server's own order), the second reason as words in the row, and a
  place for the five reasons the mock-up does not draw (`SPEC.md` §8, point 10).
- **A duplicate has two homes, by whether it is decided.** The server gives a live duplicate the reason
  `duplicate` first, an undecided one included, and never a `decision` reason beside it
  (`routers/payRun.ts:192`, `:453`, `:461`). Grouped by first reason alone, an undecided duplicate would sit
  in the last group, the bookkeeper's decision group could never exist, and the list would show the same
  invoice under "אצל הנהלת החשבונות". So a `duplicate` reason splits by `invoices.holding`: a decision group
  while a gap of the invoice still waits, the last group once the copy is held (`SPEC.md` §6.3).
- **"השיוך לתעודות המשלוח עוד לא פעיל."** is true for a consolidated invoice only. The same hold covers an
  ordinary invoice with no order link, whose words are the list's "מחכה לשיוך להזמנה". Both lines are
  `INV-00`'s keys: the list prints the same sentence, it is six words, and the product's copy guard fails
  the same text of six words or more in two keys (`apps/web/lib/copy/guard.ts:28`, `:60-66`). Written once
  in `messages/invoices/list.ts` and once in `messages/payRun`, each pull request is green alone and the
  second to land turns `main` red.
- **"חסר מספר הקצאה" is one hand-placed invoice** (MF-24950, a September invoice outside the mock-up's
  store), and its note sums the VAT of that one. For several invoices, and for a number already asked for,
  the sentence is not written.
- **"פער של ₪X לפני מע״מ" assumes one basis.** The server's open ₪ can mix bases (a VAT mismatch is the VAT
  itself). Print what the server returns with its basis; a hold whose open ₪ is zero prints no ₪0.
- **The figure can move.** Two open pull requests (369, 374) change how an invoice's claimable ₪ is computed.
  Print what the server returns and pin no figure outside the demo day.
- **"להחלטה" needs the gap's id**, which `payRun.list` does not return: it is `decideGapId` of
  `invoices.holding`, the first gap of the invoice the viewer may decide, not its leading gap.
- **`payRun.list` names a role and days of its own, and they are not the batch's.** Its role is that of the
  oldest open finding (`packages/api/src/routers/payRun.ts:273-281`), and its days count from the gap's
  creation (`:283-288`, `:733`), so a gap passed on today reads N days there. The group, the days and
  `canAct` of a row come from `invoices.holding`; from `payRun.list` come the hold reasons, the dates and the
  sums.
- **One invoice can be held for a decision and for a missing number** (`routers/payRun.ts:461-473`). It sits
  in its decision group and says the missing number as its second reason.
- **The five due sections go as headings**: the approved screen groups held invoices by who holds them and
  lists payable invoices in one table by due date.
- **Not drawn, and kept:** the month filter, the notices on a due date ("אין תנאי תשלום · הגדירו", "מעבר
  לתקרת החוק", "תנאים קצרים מהמוסכם"), the credit sentence, the selection and its export, the branch strip,
  the link from a row to the invoice screen.
- **A row decided before today** has no words ("הוחלט היום" only): see point 3 of the first list.
- **The export in the mock-up answers "בהדמיה לא נוצר קובץ".** The product's export stays, and nothing shows
  a history of exports.
- **The home's "to pay" figure and this screen disagree** for an invoice that is held only for a missing
  allocation number: the month's total behind the home never reads that hold (`routers/payRun.ts:863-959`),
  and this screen's list does (`:707-709`). The fix is in a file no package of this batch writes, and it has a
  pull request of its own, draft 384. Do not "fix" it on the screen, and do not compare the two figures in a
  spec. An existing spec does compare them (`apps/web/e2e/W1-05.spec.ts:344-352`): it is not `INV-03`'s to
  change; keep the payable total printed on the screen.
- **No route-level loading file.** It was removed on purpose (`apps/web/scripts/check-soft-nav.mjs:193-196`).

## Limits of the data, to state and not to hide

- **Days restart after a re-match**, and the history thins: a decision and a pass-on are carried onto the new
  gap row (`packages/api/src/match/persist.ts:455-482`), but the undo pairs, the recorded role and reason code
  of a carried decision, and the time of a carried pass-on are lost.
- **Numbers in a reason** are printed only when they are provably the ones that routed the gap; the owner may
  have changed a threshold since.
- **`invoices.detail` is open to the receiver.** Every new field is null without the right to see money, and
  the queue is not asked for a role that may not read it (`packages/api/src/routers/approvals.ts:251-252`).
- **Names.** The server returns a colleague's name as null by row security, which is why the product prints
  "משתמש אחר" today (`messages/approvals/he.ts:163`). This batch prints roles; names need a person.

## Not determined

- Whether `main` merged with the desk's branch passes the build, the full server suites and the e2e specs.
  What was run, on 28.11.2026 (`WORKPLAN.md`, S10): `main@de5cfcf7` merged with the components branch (`daec849e`) passed the
  install, the database migrate, the RLS provisioning and check, the type checks, the web lint, the test
  suites except the worker's, and the web build, each with exit code 0; the worker's tests, the e2e specs, the
  worker image and the dependency audit were not run on it. `main@de5cfcf7` merged with the desk's branch at
  `a6be4080` and resolved as `WORKPLAN.md`, S10, says: the type check of the 17 packages and of `apps/web`,
  the web lint and `guards` exit 0; the web unit suite passes (226 files, 2,562 tests), the desk's own unit
  tests among them (14 files, 317 tests); `approvals-router`, `approvals-queue-fields` and `approvals-scope`
  pass (64 tests). The full server suites, the web build and the e2e specs were not run on that tree, and
  `INV-04` runs the desk's suites on its own merge first.
- The licence of any PDF library, and whether the real storage lets a script read a file.
- Settled: empty message groups composed as `WORKPLAN.md`, S3, says pass the type check, the parity test, the
  copy budget and the copy gate (tried on `main@9dd26ef9` merged with the components branch;
  `messages/invoices/` and the tests the trial ran are unchanged at `de5cfcf7`).
- Settled: the switch-off key for deciding from the invoice screen stays, named `decideOnInvoice` and on by
  default (`WORKPLAN.md`, `INV-05`); `INV-01` does not depend on it.
- Whether the home's pay-run figure makes an e2e spec red at month end: the cause is in the code; the spec was
  not run. The fix is draft pull request 384, outside this batch.
