# INV · design spec of the four screens

The source of truth is `reference/reference.html` (Version 6 of the proposal page) and its sources in
`reference/src/`. This document states the rules behind the four mock-ups, quotes their Hebrew strings, and says
for each element whether it exists on `main` today, differs, or is new, which package builds it and from which
server field. Selectors and function names below are the reference's (`inv-core.js`, `inv.css`); they are
**not** the product's names. In the product every value comes from the DS tokens and every pattern from a shared
component.

- **The look is DS3's.** `docs/ux/ds3/SPEC.md` §1 to §9 (colour, type, shape, controls, icons, density, motion,
  front-end rules) is binding here unchanged. For the approvals desk §10.2 of that file and the desk as DS3-04
  built it stay binding too; section 5 below adds to them.
- **Read `KNOWN-ISSUES.md` beside this file.** It lists where the mock-ups are looser than the product's rules
  or than the code allows. Where the two disagree, `KNOWN-ISSUES.md` wins; where the code and a mock-up
  disagree, the code wins.
- **Citations.** A file and line is from `main@9dd26ef9` unless it is marked "DS3-04:", which means the
  finished desk branch `claude/ds3-04-approvals-desk` at `be22850e`. `main` moves: confirm a line before you
  rely on it.
- **Server fields** are named as `WORKPLAN.md` (`INV-00`, "The contract") names them. `INV-00` pushes the exact
  types first; where its pushed contract and this file differ in a name, the contract wins.

Mock-ups and their sources:

| Screen | Anchor on the page | Mock-up | Sources | Route in the product | Built by |
| --- | --- | --- | --- | --- | --- |
| The invoices list | `#register` | `id="inv-reg"` | `inv-register.js`, `inv.css` | `/dashboard/invoices` | `INV-02` |
| The invoice screen | `#invoice` | `id="inv-page"` | `inv-invoice.js`, `inv-doc.js`, `inv-doc.css`, `inv-r15.css` | `/dashboard/invoices/[invoiceId]` | `INV-01`, then `INV-05` (the decision); `INV-06` optional |
| Approvals by role | `#approvals` (and `#roles`) | `id="inv-desk"` | `inv-desk.js`, `inv.css` | `/dashboard/approvals` | `INV-04` |
| The pay run | `#payrun` | `id="inv-pay"` | `inv-payrun.js`, `inv.css` | `/dashboard/approvals/pay-run` | `INV-03` |

`inv-core.js` holds what all four share (the words, the places, the history, the message with "ביטול").
`data.json` is the demo restaurant on the demo day, 25.10.2026.

## 1. Principles

1. **One line, three answers.** Every gap answers, in the same words on every screen: what is its state, with
   whom is it, and why ("מצב · אצל מי · למה").
2. **"אצלכם".** The role a gap reached reads "אצלכם". Everyone else reads the role's name.
3. **Empty when nobody has to act.** A row that waits for no person names nobody.
4. **Colour only when money waits for a person.** Red for a gap that blocks a payment, amber for a warning
   that waits; grey otherwise; a money figure is always ink.
5. **The "why" is the real rule.** The sentence is built from the rule the product stored on the gap and the
   restaurant's own numbers. A screen never guesses a reason.
6. **Everyone sees every gap; each role decides only what reached it; the owner may decide any.** The
   permissions are the server's (`packages/api/src/lib/roles.ts:41-48`). No screen works them out again.
7. **One decision, two places.** A gap is decided on the approvals desk or on the invoice screen with the same
   procedure, the same input, the same message and the same undo.
8. **Only what the product records.** No recorded payment, no named person in the history, no reminder, no
   mark on the document (section 7).

## 2. What every screen shares

All of this section is written once, in `apps/web/lib/invoices/**` and
`apps/web/lib/i18n/messages/invoices/gap.ts` (`INV-00`). A screen imports it and adds no role word and no rule
phrase of its own.

### 2.1 Who sees and who decides

| Role | Sees | Decides | Also |
| --- | --- | --- | --- |
| בעלים | Every open gap: first those that reached the owner, then the others. | Any gap, also one that reached the manager or the bookkeeper (decision 3). | Only the owner edits the amounts and percentages that route a gap. |
| ניהול | Every open gap: first those that reached the manager; the owner's read-only. | A gap that reached the manager. | May pass a gap to the owner ("העבירו לבעלים"); the owners get an e-mail. |
| הנהלת חשבונות | Every open gap, to read; every invoice in dense rows at a desk. | Only a gap that reached the bookkeeper (an invoice that looks like a duplicate). | Needs the allocation number, the VAT, the due date. |
| מטבח, קבלת סחורה | Nothing of this area, and no purchase ₪. | Nothing. | As today: the routes answer 403 and the procedures FORBIDDEN. |

On `main` today: the owner sees every gap mixed with no mark of whose it is; the manager and the bookkeeper see
their own and a count box "ממתין לאחרים" (`apps/web/lib/i18n/messages/approvals/he.ts:29`). The server already
returns the other roles' rows with `canAct` and `waitingOn` (`packages/api/src/routers/approvals.ts:241`,
`:344-346`); no screen asks for them.

### 2.2 The words

**Role words**, three forms each (`inv-core.js`, `ROLES`): בעלים · הבעלים · לבעלים; ניהול · הניהול · לניהול;
הנהלת חשבונות · הנהלת החשבונות · להנהלת החשבונות. Never "מנהל", "מנהל/ת" or "בעלים או מנהל/ת" (on `main`:
`messages/approvals/he.ts:36`, `messages/payRun/he.ts:125-127`).

**With whom** (`INV.who`): "אצלכם" when the gap is routed to the viewer's own role; otherwise "אצל הבעלים",
"אצל הניהול", "אצל הנהלת החשבונות". "אצלכם" means routed to the viewer, not merely decidable by the viewer:
the owner reads "אצל הניהול" on the manager's gap and may still decide it.

**How long** (`nDays`): "יום אחד", "יומיים", "N ימים". After a pass-on the wait reads "מהיום" on the day it was
passed; on later days it counts whole days from the pass-on ("יום אחד", "N ימים"). When the time of the
pass-on is not known (a pass-on carried through a re-match), the wait counts from the gap row and no pass-on
phrase is printed. The count is whole days in the restaurant's zone; every function that words a wait takes
"now" as an argument.

**Why**, one phrase per routing rule, the same wherever a gap is shown (`INV.because`):

| When | Phrase |
| --- | --- |
| Rule `severity-block`, a bill for more than was received | "חיוב על יותר ממה שהתקבל חוסם תשלום" |
| Rule `severity-block`, a price rise | "עליית מחיר של {P}% ומעלה חוסמת תשלום". {P} is the restaurant's own `tolerances.blockPricePercent` from `settings.effective` (default 10; the owner read it with 10), never a literal. It is printed only when the gap's own percent is at or above today's setting; otherwise no reason |
| Rule `cumulative-medium` | "הפערים בחשבונית בין ₪50 ל־₪300 לפני מע״מ" (the two amounts are the restaurant's own; the spaces around the first amount do not break) |
| The gap was passed on | "הניהול העביר אחרי N ימים" (N is how long it waited before). The owner read it with the manager; a gap the bookkeeper passed on has no approved phrase (section 8, point 18) |

The owner read these four. The engine has eight rule ids and a fallback
(`packages/api/src/approvals/engine.ts:152-217`). For every other rule, and whenever the amounts cannot be
shown to be the ones that routed the gap, the row says with whom and how long and prints **no** reason, until
the owner approves a phrase (section 8, points 4 and 5).

**The full line** (`INV.line`): "{אצלכם | אצל הבעלים} {N ימים | מהיום}, כי {phrase}." For example "אצלכם 10
ימים, כי חיוב על יותר ממה שהתקבל חוסם תשלום." With no phrase: "{with whom} {how long}."

**The nine invoice states** (frozen: `messages/invoices/he.ts:163-173`): בקריאה · ממתינה לספירה · ממתינה
לשיוך · תקינה · פער פתוח · לבקשת זיכוי · כפולה אפשרית · אושרה לתשלום · שולמה.

**The gap's level:** "חוסם תשלום" and "אזהרה".

**The result of a decision** (`INV.doneT`, `INV.doneLine`): "נוסף לבקשת הזיכוי" and "שולם כפי שחויב". Beside
the gap's amount, on the document or in a row, the second reads "הפער: שולם כפי שחויב": the amount is the
gap's and nothing records a payment. As a history line: "נוסף לבקשת הזיכוי, ₪38.70 לפני מע״מ" and "הפער של
₪38.70 לפני מע״מ נסגר, שולם כפי שחויב". A gap the system closed by itself is never worded as a person's
decision.

**Counts:** "חשבונית אחת" / "N חשבוניות"; "פער אחד" / "N פערים"; one gap is "פער", several are "פערים".

**Not allowed to decide:** "ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם." (with the role's word). In the list's
summary and at the foot of the whole-screen document the short form "ההחלטה אצל הבעלים."

**The owner on another role's gap:** the note "גם אתם רשאים להחליט", and after the decision "…, החלטתם במקום
הניהול".

### 2.3 Status language and colour

A status is a dot or an icon and a word, never colour alone. Values are DS3's roles
(`docs/ux/ds3/SPEC.md` §2).

| Thing | How it is drawn | Reference |
| --- | --- | --- |
| Invoice state "פער פתוח" | Tinted pill: red when one of its open gaps blocks payment, amber when all are warnings. | `INV.pill`, `.st-leak`, `.st-warn` |
| Invoice state "כפולה אפשרית" | Red tinted pill. | `INV.pill` |
| "ממתינה לשיוך", "בקריאה", "ממתינה לספירה" | Grey pill with a clock. Never a warning colour. | `.iv-wait` |
| "לבקשת זיכוי" | Grey pill with the credit icon. A fresh credit request is neutral, never green. | `.iv-wait` |
| "תקינה", "אושרה לתשלום", "שולמה" | A quiet word, no pill, no green. | `.iv-quiet` |
| Gap level "חוסם תשלום" | The solid red pill with white text (kept by the owner on 28.11). | `.st-solid` |
| Gap level "אזהרה" | Amber tinted pill. | `.st-warn` |
| A group or a place that waits for a person | An 8 px dot before its name: red when one of its gaps blocks payment, otherwise amber. | `.dot-leak`, `.dot-warn` |
| A missing allocation number | Amber dot: it waits for an action (asking the supplier). | `inv-payrun.js`, group `alloc` |
| The gap's line in the lines table | The row tinted red or amber while the gap is open (kept by the owner on 28.11); grey once decided. | `.ivp-tb tr.is-hit` |
| A decided gap, everywhere | Calm grey: grey dot, grey evidence, grey row, the result as words. | `.is-done`, `.row.done` |
| The card that waits for the viewer | A 2 px ink outline. | `.ivp-box.is-mine` |
| The selected row | The interface's blue tint, never a money colour. | `--info-sub` |
| A due date | Plain text and a quiet remainder ("נותרו 20 ימים", "היום האחרון"). Never a coloured chip. | `dueCell`, `dueT` |
| An old gap | No colour (owner, 28.11). The oldest is sorted first and its days are written. | |

Money: **every ₪ figure is ink**, grey on a calm row; never red, never amber. **Green is only for money that
came back**, and nothing on these four screens is that, so none of them draws green.

On `main` today, to change: clean, approved and paid are green and a credit request gold
(`apps/web/app/dashboard/invoices/(register)/columns.tsx:40-50`); an open gap is always amber whatever its
level (same lines); a due date is a `DeadlineChip` that turns amber and red (`columns.tsx:98`,
`apps/web/app/dashboard/approvals/pay-run/page.tsx:174`); the pay run draws the credit to ask for in the colour
of caught money (`pay-run/page.tsx:328`).

### 2.4 Money, VAT basis, dates

- Every ₪ goes through `formatIls()` or the shared money component, from integer agorot as the server returns
  them. ₪ sits left of the digits. Numbers are physically right-aligned in columns.
- **Every amount states its VAT basis** beside it or in its column head. An invoice's total is "כולל מע״מ". A
  gap is "לפני מע״מ". The exception is the server's: a duplicate's amount includes VAT and a VAT mismatch is the
  VAT itself, so print the basis the server returns with the amount and never assume "לפני מע״מ".
- An unknown amount is never ₪0, and a money cell never holds "—" (on `main`: `pay-run/page.tsx:499`).
- The ₪0 twin of a gap (the engine's second row for a bill above the receipt) is never a gap and never counted
  (`packages/api/src/routers/approvals.ts:322`).
- Dates `dd.MM.yyyy`; date and time `dd.MM.yyyy · HH:mm`. Invoice, order and SKU numbers are LTR-isolated.
- No percentage of the invoice is printed in a reason: the product divides the gaps (before VAT) by the total
  including VAT. The base is stated once, in the card "מי מחליט על מה" (section 5.4). The percent base itself
  is unchanged (owner, 28.11).

### 2.5 Density and widths

- **Density.** The bookkeeper gets dense rows by default at a desk, with ₪ once in the column head ("סכום, ₪
  כולל מע״מ", "פער, ₪ לפני מע״מ"); the owner and the manager get ₪ beside every amount. The personal density
  preference is read, never written here: `usePrefs()` and `singleKeysEnabled()` of `apps/web/lib/prefs/`,
  which is already on `claude/ds3-01-components`, the base of the three screen packages. The settings screen
  that writes it is DS3-06 (pull request 353); nobody waits for it. On a phone the density is fixed, nobody gets
  dense rows, and every amount carries its ₪ and a label of its basis.
- **Widths to prove:** 1440, 1280, 1024 and 390 px, with no sideways page scroll at any of them (and at 360).
- **What the reference shows.** Its frames are 1240 px wide and are scaled down as one picture on a narrower
  window; under 900 px of frame width they switch to the phone layout (`base.js`, `fitStages`). So the
  reference at 1024 is a small 1240 drawing, and a 768 px tablet gets the phone layout. The rules for the
  product are below, per screen. The product's own switches differ by component today: the invoice screen
  goes to two columns at 1024 px (`apps/web/app/dashboard/invoices/[invoiceId]/cockpit.tsx:100`), the shared
  table becomes a phone list under 768 px, and the DS3-04 desk shows one gap at a time under 1280 px. A
  package keeps one switch per screen and names it in its pull request.
- **Tablet.** One column, as a phone, with the touch sizes of a phone (targets of 44 px). The whole-screen
  document opens at 100 % there.

### 2.6 Keys, focus, motion

- Keys are read by the physical key (`KeyboardEvent.code`), so they work on a Hebrew layout. No key fires while
  the focus is in a field. The single-character keys of the desk (J, K, 1, 2, 3, Z) and the keys `[` and `]`
  follow the personal switch `singleKeysEnabled()`; the arrows, Enter, Space, Escape, Home, End, PageUp and
  PageDown always work. The viewer's keys act only while the focus is inside the viewer or its dialog.
- Focus is always visible (2 px, DS3 §4) and is never left on the page body: after a decision, an undo, a
  pass-on, a cleared filter, a closed summary or a closed dialog it goes to a control that is in sight.
- One quiet announcer per screen (`role="status"`) says what a message says; the message itself carries no
  live role.
- Motion follows DS3 §8. With `prefers-reduced-motion` nothing animates.

### 2.7 Deciding a gap (the desk and the invoice screen)

Built once, in the approvals folder (`INV-04` exports it from
`apps/web/app/dashboard/approvals/gap-decision/index.ts`); `INV-05` mounts it on the invoice screen and copies
none of it. The rows that can be decided, their status and their claimable ₪ come from
`approvals.myQueue({ scope: 'all', invoiceIds })`, never from the findings of `invoices.detail`.

| Control | Label | What it does | Procedure and input (unchanged) |
| --- | --- | --- | --- |
| The filled button | "בקשת זיכוי · ₪38.70" (kept by the owner; the amount is the row's claimable ₪) | Adds the amount to the credit request for the supplier. | `approvals.approve { discrepancyId, expectedStatus, seenClaimAgorot }` |
| Secondary, never filled | "שלמו כפי שחויב" | Asks why first, then closes the gap without a credit request. | `approvals.reject { discrepancyId, reason, reasonCode }` |
| Quiet, where the product offers it today: any role but the owner, on a gap it may decide that is not the owner's (`apps/web/app/dashboard/approvals/vocab.ts:103-105`). That is the manager on a gap of the manager's or an unrouted one, and the bookkeeper on a duplicate; never the owner | "העבירו לבעלים" | Passes the gap to the owner through the desk's sheet with its optional note. | `approvals.escalate { discrepancyId, note }` |
| In the message | "ביטול" | Takes the decision back. | `approvals.reopen { discrepancyId }` |

Wherever this file writes "ביטול" for the undo control it quotes the mock-up. The product's word today is
"בטלו" (`messages/approvals/he.ts:182`), and it stays on both screens until the owner picks one (section 8,
point 12).

- **The reasons question:** "למה לשלם כפי שחויב?" with the product's own reasons for the gap's kind
  (`messages/approvals/he.ts:130-141`) and "חזרה". "אחר" opens a required field "הסיבה" (hint for a screen
  reader: "כתבו סיבה כדי להמשיך") and its button "שלמו כפי שחויב" works only with words typed. Escape closes
  the question and returns the focus to "שלמו כפי שחויב". The question closes whenever the data changes. Words
  a person typed are shown as text.
- **The message** (at most 8 words, one at a time): "{result}, {supplier}" with "ביטול" and the line that
  shortens over ten seconds; it pauses under the pointer or the focus. When the owner decided another role's
  gap: "{result}, החלטתם במקום הניהול". After a pass-on: "הועבר לבעלים, {supplier}". After an undo the
  announcer says "ההחלטה בוטלה." or "ההעברה בוטלה."
- **Undo:** only the person who decided; offered for 10 s; never asked of the server after 12 s; the server
  allows 15 s (`routers/approvals.ts:84`; DS3-04: `undo-window.ts:12-18`). No number changes. Z takes back the
  last decision only.
- **A role that may not decide** gets the same evidence and the sentence of section 2.2 in place of the
  buttons. Pressing 1, 2 or 3 on such a gap announces the sentence and sends nothing.
- **Refusals** behave as on the desk: decided elsewhere (the role that decided, never a name), the amount
  changed, forbidden, blocked.
- A double press never decides the next gap too.

## 3. Screen 1 · the invoices list (`INV-02`)

**Purpose.** Where each invoice of the month stands: what waits for the viewer, where the month's money is,
with whom each gap is and why. A row opens a read-only summary. **No decision is taken on this screen.**
Owner, manager and bookkeeper; the receiver and the chef never reach it.

### 3.1 Layout

- **A desk (1280 and up).** Head row: the title "חשבוניות", the month's name ("אוקטובר 2026"), and the search
  at the end edge. Then the opening sentence with its one button. Then the cards of the places in one row.
  Then the count line with the supplier filter. Then the table with its foot. A picked row opens the summary
  as a 320 px pane beside the table (`.reg.has-peek`), not an overlay: the row stays in the list.
- **1024.** The same. With the summary open the table drops the date, the due date and the reason line, the
  head "אצל מי ולמה" reads "אצל מי", and the cards drop their third line.
- **Tablet and phone.** One column. The search takes the full width; the cards stand two in a row; each
  invoice is a six-line row: supplier and state; number and date; the total with "כולל מע״מ"; "לתשלום עד" and
  the remainder; with whom and why; the gap with the label "פער לפני מע״מ". Eight rows, then "הציגו את כל N"
  (and "הציגו פחות"). The summary is a sheet fixed to the foot of the list (at most 72 % of the height, radius
  16), and the tapped row is scrolled into view above it.

### 3.2 States

| State | What shows |
| --- | --- |
| Loading | The skeleton in the new shape (head, sentence, cards, rows), by DS3 §9. On `main`: `(register)/loading.tsx` in the tabs' shape. |
| No open gap this month | "אין פערים פתוחים החודש." and no button. |
| Gaps open, none the viewer may decide (the bookkeeper in the demo) | "אין פער שמחכה לכם, ופערים של ₪296.00 לפני מע״מ אצל אחרים." and the secondary "למסך האישורים". No filled button. |
| A filter with no match | "אין חשבונית שמתאימה לסינון" and "נקו את הסינון". |
| A place with no invoice | Its card is not drawn (the mock-up always draws "ממתינות לשיוך" and "בלי פער פתוח"; the product draws a card only for a place that holds an invoice). "כל החודש" is always drawn. |
| An empty month | "אין כאן חשבוניות". |
| A decided gap | The invoice moves to "בלי פער פתוח"; its row says "הפער: נוסף לבקשת הזיכוי" or "הפער: שולם כפי שחויב" and "הוחלט היום · בעלים", in grey. |
| A held invoice | Named by its state pill and by its place; the list does not repeat the pay run's hold reasons. |

### 3.3 The opening sentence and its button

One sentence, by the viewer's role (`headline`): what waits for the viewer, then what waits for others.

- "פערים של ₪143.50 לפני מע״מ מחכים לכם, ועוד ₪152.50 אצל הניהול." (the demo's owner). One gap: "פער של ₪X
  לפני מע״מ מחכה לכם". When the others are several roles: "אצל אחרים".
- Nothing for the viewer: "אין פער שמחכה לכם, ופער של …" / "ופערים של ₪X לפני מע״מ אצל הבעלים."
- Nothing open: "אין פערים פתוחים החודש."

The button: **"להחלטה"**, the one filled button of the screen, opens the approvals desk on the first gap the
viewer may decide (the viewer's own first, blocking before warning, the longest wait first) at
`/dashboard/approvals?invoice=<invoiceId>&sel=<gapId>`, where `<gapId>` is that invoice's `decideGapId`. The
desk opens narrowed to that invoice (section 5.5). When gaps are open and none is the viewer's to decide: the
secondary link "למסך האישורים". When none is open: nothing.

### 3.4 The places

Cards instead of today's eight tabs. Every invoice is in exactly one place and the places add up to the month,
to the agora. The place of an invoice and the sums of the cards come from the server (`place` on each row,
`places[]` on the response); the screen never computes them.

Order: "אצלכם"; then the other roles that hold an open gap ("אצל הבעלים", "אצל הניהול", "אצל הנהלת
החשבונות"); "ממתינות לשיוך"; "חסר מספר הקצאה"; "בלי פער פתוח"; "שולמו"; and last "כל החודש". The group is named
for a screen reader "איפה הכסף של החודש, הסכומים כוללים מע״מ".

Each card: its name with a dot when it waits for a person, the count, the sum with "כולל מע״מ", and a third
line:

| Card | Third line |
| --- | --- |
| A role's card | "פער של ₪38.70 לפני מע״מ" / "פערים של ₪143.50 לפני מע״מ" |
| "ממתינות לשיוך" | "חשבוניות מרכזות" only when every invoice in it is consolidated (true for the demo); otherwise no third line (section 8, point 17) |
| "חסר מספר הקצאה" | "צריך לבקש מהספק" |
| "בלי פער פתוח" | "כולן תקינות" / "אחת מהן בבקשת זיכוי" / "N מהן בבקשת זיכוי" |
| "שולמו" | the mock-up's "בנתוני ההדגמה" is true for the demo seed only (section 8, point 7) |
| "כל החודש" | "פער פתוח של …" / "פערים פתוחים של ₪296.00 לפני מע״מ" / "אין פערים פתוחים" |

- A card is a toggle (`aria-pressed`): pressing it shows that place, pressing "כל החודש" shows all. The pressed
  card is sunken with a 2 px ink line at its foot. After a press the focus stays on the card.
- A role's card appears only when it holds an invoice.
- **"שולמו" appears only when the month has a paid invoice** (decision 5: `counts.paid` above zero, a field
  that exists). In a real restaurant that is never, until a payment record exists.
- **"חסר מספר הקצאה" holds only invoices that must carry a number** and have none (decision 5), by the pay
  run's own rule, from the new field `allocationMissing`. It is absent when empty. It holds only invoices with
  no open gap; an invoice with an open gap stays with whoever holds the gap.
- Every old address keeps working: `?view=` takes a place id or one of today's tab ids (`review`, `lines`,
  `awaiting`, `matched`, `held`, `paid`, `noAllocation`, `intake`), resolved by `apps/web/lib/invoices/places.ts`.

### 3.5 Search, filter, count

- Search as typed, by part of a supplier's name or of an invoice number: placeholder "ספק או מספר חשבונית",
  name for a screen reader "חיפוש ספק או מספר חשבונית". Typing keeps the caret.
- Supplier filter: a select of the month's suppliers in Hebrew order, first "כל הספקים", named "סינון לפי ספק".
- The count line: "כל 37 החשבוניות של החודש" · "מוצגת חשבונית אחת מתוך 37" · "מוצגות 5 מתוך 37"; on a phone
  while eight rows show: "מוצגות 8 מתוך N" (with "שמתאימות" when a filter is on).
- After "נקו את הסינון" the focus goes to the search (to the first row on a phone).

### 3.6 The table

Columns, in this order: ספק · מספר · תאריך · "סכום כולל מע״מ" · "לתשלום עד" · מצב · "אצל מי ולמה" · "פער לפני
מע״מ". Dense: "סכום, ₪ כולל מע״מ" and "פער, ₪ לפני מע״מ". Caption for a screen reader: "חשבוניות החודש. Enter
על שורה פותח את התקציר שלה."

- **"אצל מי ולמה".** An open gap: with whom (bold for the viewer) and " · 10 ימים" (or " · מהיום"), and under
  it the rule's phrase with a full stop. A decided gap: "הפער: נוסף לבקשת הזיכוי" or "הפער: שולם כפי שחויב",
  and under it "הוחלט היום · בעלים". Waiting to be linked: "מחכה לשיוך להזמנה", or for a consolidated invoice
  "השיוך לתעודות המשלוח עוד לא פעיל". Every other row: empty.
- **Due date:** the date and a quiet remainder ("נותרו 20 ימים", "היום האחרון"); nothing after it for a paid
  invoice.
- **Gap:** bold on a row with an open gap, grey on a calm row, empty when there is none (never ₪0.00).
- **Order** (from `places.ts`, not a sort the person picks): the viewer's gaps, then others' (blocking before
  warning, the longest wait first); then waiting for a document; then clear; then paid; newest first inside
  each.
- **Foot:** "סך הכול, 37 חשבוניות", the sum including VAT, the sum of the gaps, and "פתוח ₪X" when part of
  the gaps is decided.
- **Keyboard:** one tab stop in the rows; ↑ and ↓ move (and carry an open summary with them); J and K the same
  when single keys are on; Enter or Space opens the summary and moves the focus into it; Escape closes it and
  returns the focus to its row.

### 3.7 The summary of a row (read-only)

Named "תקציר החשבונית". Head: "<number> · <supplier>" and the close button "סגירת התקציר". Then the state and
the date; "סכום, כולל מע״מ"; "לתשלום עד" with " · נותרו N ימים".

- Open gap: the full line of section 2.2; the gap's kind and item; the two calculation lines ("חויבו 9.5 ק״ג,
  התקבלו 6.5 ק״ג", "3 ק״ג × ₪12.90 = ₪38.70 לפני מע״מ"); then the **secondary** "להחלטה" (to the desk, on this
  gap) for a role that may decide, or "ההחלטה אצל הבעלים." The calculation lines read
  `invoices.detail({ invoiceId })` of the picked row, fetched when the summary opens: on this package's base
  the queue row has quantities and no unit price.
- Decided: "נוסף לבקשת הזיכוי" or "הפער נסגר, שולם כפי שחויב", the amount with "לפני מע״מ", and "הוחלט היום ·
  בעלים · {reason}".
- Waiting to be linked: "החשבונית מחכה לשיוך להזמנה." or "חשבונית מרכזת." with "השיוך שלה לתעודות המשלוח עוד
  לא פעיל."; and "עד השיוך היא לא נספרת בדליפה או בהוצאה."
- Clear: "הותאמה להזמנה ולקבלת הסחורה, בלי פער."
- Last: the link "פתחו את החשבונית".

### 3.8 Element by element

| Element | On `main` today | State | Built by · from |
| --- | --- | --- | --- |
| Title | `(register)/page.tsx:146` | exists | `INV-02` |
| Month's name | not shown; previous and next links only (`register-client.tsx:101-106`) | new; the links stay | `INV-02` · computed from the month |
| Opening sentence | a fixed subtitle | new | `INV-02` · `invoices.list` rows `holding`; words from `lib/invoices/words.ts` |
| "להחלטה" / "למסך האישורים" | none | new | `INV-02` · `decideGapId` and `canAct` in `holding` (never the leading gap's id); the desk's address of section 3.3 |
| Places | eight tabs (`register-client.tsx:14-15`), filtered again on the client (`:48-52`) | differs | `INV-02` · `place`, `places[]` (`INV-00`) |
| "שולמו" only with a paid invoice | the tab is always drawn | differs | `INV-02` · `counts.paid` (exists) |
| "חסר מספר הקצאה" | "ללא מספר הקצאה" counts every invoice with no number (`packages/api/src/routers/invoices.ts:178`). The row already carries `allocationRequired` (the date and the amount only, `routers/invoices.ts:114-118`, `:160`), and the column prints "חסר" only then (`columns.tsx:128-133`) | differs | `INV-00` (`allocationMissing`, the pay run's rule and not `allocationRequired`, and its count, beside the old ones), `INV-02` (the card) |
| Search, supplier filter, count line, empty result | none in the list | new | `INV-02` |
| Column "אצל מי ולמה" | none | new | `INV-02` · `holding`, `lastDecision` (`INV-00`) |
| State as a dot and a word | `STATE_TONE` colours by state alone (`columns.tsx:40-50`) | differs | `INV-00` (`lib/invoices/state.ts`), `INV-02` |
| Due date as text | `DeadlineChip` (`columns.tsx:98`) | differs | `INV-02` · `payBy` (`INV-00`: the pay run's own date, not the row's `dueDate`, which is only the date a person typed); no remainder when it is null |
| Allocation number as a column | `columns.tsx:123-140` | goes; the place replaces it | `INV-02` |
| Order of rows | date, newest first (`register-client.tsx:237`) | differs | `INV-00` (`places.ts`), `INV-02` |
| Summary pane | an overlay with date, total, gap, state (`register-client.tsx:212-241`); Enter opens the invoice (`:240`) | differs | `INV-02` · the calculation lines from `invoices.detail({ invoiceId })` (quantities, unit prices, expected values); the row that can be decided and its claimable ₪ from `approvals.myQueue({ scope: 'all', invoiceIds })`, whose rows carry unit prices only on DS3-04's branch |
| Dense rows and ₪ in the head for the bookkeeper | ₪ in the head for every role | differs | `INV-02`, inside `(register)/`; listed under "Promote to shared" |
| Six-line phone row, "הציגו את כל N" | the shared two-line phone list, pages of 50 | differs | `INV-02`, the same |
| Consolidated wording | a second chip "חשבונית מרכזת" (`columns.tsx:118`) | differs | `INV-02` |

Kept although the mock-up does not draw them: previous and next month, the CSV export, the column and density
menus, the paging, "להשלמת שורות" (`?view=lines`) and "נכנסות" (`?view=intake`).

## 4. Screen 2 · the invoice screen (`INV-01`; the decision `INV-05`)

**Purpose.** One invoice: the supplier's document itself, large enough to read, beside what the product read
in it and found. The gap first, with whom it is and why; then the payment; then the lines by the three
documents; then what happened. Owner, manager and bookkeeper. (`invoices.detail` also answers the receiver,
`packages/api/src/trpc.ts:186-188`, so every new field is null without the right to see money, and the queue
is asked only for a finance role.)

**Step one only.** Open the mock-up with the switch "המסמך" on **"בלי סימון"** or **"בלי קובץ"**. The state "עם
סימון" is step two and is not built (section 7).

**Two packages.** `INV-01` builds the whole screen and writes no decision: where the mock-up draws the two
decision buttons, it shows one button "להחלטה" that opens the desk on this gap, or the read-only sentence
(`[invoiceId]/gap-actions.tsx`). `INV-05` then mounts the decision of section 2.7 in that same place.

### 4.1 Layout

- **A desk (1280 and up).** Above: the back link, the place among the invoices, previous and next. Then the
  header. Then a frame as tall as the window lets it be (the mock-up: at least 480 px, at most 860 px, the
  window less 150 px) with two panes, each scrolling on its own and handing the wheel back to the page at its
  ends: **the data at the start edge, the document at the end edge**, the document 58 % by default, a 20 px
  divider between them. The data pane holds, in order: the pinned amount (once the card's numbers have scrolled
  away), the gap card, the payment block, the lines, what happened. Under the viewer: the line "חפשו במסמך".
- **1024.** Still two panes. The data pane never goes under **448 px**: the divider stops where that floor is.
  When the document's pane is too narrow to read the page fitted to its width (the fit would draw it under
  0.6 of life size), the document opens at a reading size, at the head of the page with the start edge in
  sight. The switch between two panes and one column is the window's width, as today
  (`apps/web/app/dashboard/invoices/[invoiceId]/cockpit.tsx:100`), not the content's. At a 1024 px window the
  content box is 712 px with the side menu open (a 248 px menu, `apps/web/app/dashboard/nav.tsx:203`; 32 px
  gutters, `apps/web/app/dashboard/layout.tsx:233`) and 968 px at 1280, so at 1024 the document's pane sits
  at its 34 % stop and opens at the reading size. The mock-up has no such switch: it scales one 1240 px
  frame.
- **Under a 1024 px window (tablet and phone).** One column: the top row (the place reads "2 מתוך
  4"), the header, a **window onto the document** (156 px high, the head of the page) with the pill "פתחו את
  המסמך" and a caption, then the data in the same order, then the chain "המסמכים שנבדקו", then what happened.
  Today's switch "מסמך | שורות" goes (`cockpit.tsx:399-408`). The action is docked at the foot of the screen
  above the bottom bar.
- **No file.** One quiet line "אין קובץ מצורף לחשבונית הזו." and the data takes the width (at most 880 px).

### 4.2 States

| State | What shows |
| --- | --- |
| Loading | The skeleton in the new shape (header, two panes). The existence check stays above it, so an unknown or foreign invoice is a 404 before the skeleton (`[invoiceId]/layout.tsx`). |
| An image (JPEG, PNG, WebP) | The viewer of section 4.4; the toolbar says "תמונה". |
| A PDF | In `INV-01`: today's sandboxed frame of the browser inside the new pane (`apps/web/lib/components/invoice/InvoiceScanViewer.tsx:88`), with "PDF · עמוד 1 מתוך N" when the scan row has a page count, and "פתחו את המקור". On a phone, where a frame may not draw a PDF, the window shows one calm line and the same link. Drawing a PDF in the same viewer is `INV-06`, optional. |
| No file | The line above; no viewer, no window, no divider. |
| Being read, or no lines | As today: the screen opens in the reading correction (`[invoiceId]/page.tsx:205-207`); who may correct is unchanged (`:86-87`). |
| An open gap the viewer may decide | The card with the 2 px outline when it is the viewer's own; `INV-01`: "להחלטה"; `INV-05`: the two buttons. The payment block says "בהשהיה". |
| An open gap the viewer may not decide | The same card and evidence; "ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם." in place of the action. |
| The owner on another role's gap | The note "גם אתם רשאים להחליט" beside the action. |
| Decided | The card in calm grey with the result, the stamp, the role and the reason; the effect line; the state word and the payment block follow; a new line in "מה קרה עם החשבונית". It is still there after a reload (from `invoices.detail`). |
| No gap | No card; the payment block and the lines. |
| Each role | Owner and manager: the gap lines alone by default, ₪ beside every amount. Bookkeeper at a desk: every line, dense rows, ₪ in the heads. Receiver and chef: no entry. |

### 4.3 Header and stepping

- Back link by where the person came from (five origins, kept: `[invoiceId]/page.tsx:44`); from the list it
  reads "לרשימת החשבוניות".
- "חשבונית 1 מתוך 4 שנמצא בהן פער" with two icon buttons, "החשבונית הקודמת" and "החשבונית הבאה", disabled at
  the ends. `[` and `]` do the same; they walk the place the person came from (`from`, `month`, `view`), in
  the list's order, from `apps/web/lib/invoices/places.ts`. They are silent while typing, while the
  whole-screen document is open and when single keys are off. The place line, the two buttons and the keys
  exist only when the person came from the list (`from=register`), as today (`cockpit.tsx:125`, `:361`):
  from the desk, the pay run, the inbox or the leaks there is no list to walk. The side menu's own `[` must
  not fire here; that it yields arrives with the shell (pull request 349), and nothing outside the page
  binds `[` on `main` or on the components branch.
- Title "<number> · <supplier>" and the state as section 2.3 draws it.
- Three facts: "סכום החשבונית" with "כולל מע״מ"; "תאריך החשבונית"; "לתשלום עד" with "נותרו N ימים".

### 4.4 The document

**The viewer** (`inv-doc.js`, `viewer`). A toolbar named "כלי המסמך": the kind of file, then "הקטינו" (key −),
the size ("גודל התצוגה"), "הגדילו" (+), "התאימו לרוחב" (0, pressed while the size is 100 %, drawn in ink),
"סובבו ברבע סיבוב" (R), "פתחו במסך מלא"; and today's "פתחו את המקור" stays. The canvas is a focusable group
named "המסמך מהספק"; the document is one named picture, "המסמך כפי שהגיע מ<ספק>, <מספר>".

- **Size:** 100 % is the pane's width; 50 to 400 %. The size is kept as a fraction and the label rounds. A
  button, a key or one wheel notch moves to the next quarter (25 %); a trackpad pinch (Ctrl + wheel in pixels,
  small steps) scales smoothly; two fingers on a touch screen change the size. A size button at its stop stays
  in the Tab order and says it is off (`aria-disabled`), so the focus is not dropped.
- **Turn:** quarter turns that lay the page out again at its turned width and height.
- **Moving:** a mouse drags the document (a drag cannot stick); a finger scrolls it.
- **Keys:** + − 0 R, with the focus anywhere in the viewer, its toolbar included, and anywhere in the dialog.
- The size, the turn and the place a person scrolled to are theirs until they open another invoice.

**The divider.** `role="separator"`, vertical, named "רוחב המסמך", tooltip "גררו לשינוי רוחב המסמך", a 32 px
grip at rest, a 44 px target under a finger. Dragged; ← and → move it 2 %; Home and End go to its stops; Enter
or a double press puts it back to 58 %. It runs from 34 % to 62 % and stops earlier where the data pane would
go under 448 px; `aria-valuenow`, `aria-valuemax` and `aria-valuetext` ("58%") stay true. While it moves, the
part of the document the person was looking at stays in the middle. Its place is kept while the browser tab is
open, also across `[` and `]`, and is forgotten on a reload: there is no stored key.

**What to look for (decision 7, step one).** One line, in three places: under the viewer at a desk, in the
caption of the phone's window, and at the foot of the whole-screen document:

> "חפשו במסמך: עגבניות שרי, מק״ט 10129."

The item's name is bold and the SKU is LTR-isolated. In the phone's caption it follows the kind of file:
"תמונה · חפשו במסמך: עגבניות שרי, מק״ט 10129". A line with no SKU names the item alone. Nothing on the screen
speaks of a mark.

**The whole screen.** A real dialog (the native `<dialog>`, as
`apps/web/lib/components/overlay/Sheet.tsx` does), named "המסמך מהספק במסך מלא": the page behind is inert,
Escape and its button "סגרו את המסמך" close it, Tab stays inside, the focus returns to the control that opened
it. A header with "<number> · <supplier>"; the viewer; a foot with the line "חפשו במסמך", the gap in one line
("חויבו 9.5 ק״ג, התקבלו 6.5 ק״ג") and "הפער ₪38.70 לפני מע״מ", then the action: `INV-01` "להחלטה"; `INV-05` the
two buttons; a decided gap "{result} · {role}"; a role that may not decide "ההחלטה אצל הבעלים." At a desk
"fit" stops at a reading width (920 px in the mock-up). On a phone it opens at the size the print can be read
at (150 % at 390 px, 175 % at 360 px), at the head of the page with the start edge in sight. A decision taken
inside it closes it, returns the data pane to its top and puts the focus on a control in sight; "שלמו כפי
שחויב" inside it keeps a reason that is already typed.

### 4.5 The gap card

Named "הפער וההחלטה". One card per undecided gap of the queue's own row set (so the ₪0 twin is never a card and
the count equals the desk's), and a decided gap stays as a calm card.

- **Head:** the gap's kind ("חיוב על יותר ממה שהתקבל", "מחיר גבוה מהמצופה"), the pill "חוסם תשלום" or "אזהרה",
  and the item on its own line under them.
- **The numbers that disagree, side by side.** A quantity gap: "הוזמן"; then "התקבל" and "חויב" in one ink
  outline, and under them "חויבו 3 ק״ג יותר". A price gap: "מחיר צפוי" and "מחיר בחשבונית" in one outline with
  "10.0% יותר", then "כמות", and the note "המחירים ליחידה, לפני מע״מ."
- **The amount, a row of its own:** "הפער", the amount, "לפני מע״מ", and its arithmetic ("3 ק״ג × ₪12.90").
- **The line** of section 2.2.
- **The action** (`gap-actions.tsx`, the one component behind the card's action, the phone's dock, the foot
  of the whole-screen dialog and the pinned bar's button; `WORKPLAN.md`, S7): section 4.2. With the two
  buttons (`INV-05`), two lines under them say
  what each does: '"בקשת זיכוי" מוסיפה ₪38.70 לפני מע״מ לבקשה שנשלחת לספק.' and "תשלום כפי שחויב סוגר את הפער
  בלי בקשת זיכוי."
- **After a decision** (`INV-05`): a tick and the result; "25.10.2026 · 14:32 · בעלים · {reason}"; the effect
  ("₪38.70 לפני מע״מ נוספו לבקשת הזיכוי לספק." or "הפער נסגר בלי בקשת זיכוי."); and one secondary button to
  the next gap the viewer may decide, "לפער הבא שמחכה לכם" or "לפער הבא, אצל הניהול" (their own first, blocking
  first, the oldest first; it may be on another invoice). The focus goes to that button, and by keyboard the
  next stop after it is "ביטול". Tab from "ביטול" returns to the screen only when the decision sent the focus
  there. The message with "ביטול" survives a move with `[`, `]` or the "next gap" button.
- **The pinned amount (a desk).** Once the card's numbers have left the pane, a bar stays at the pane's head:
  "הפער · ₪38.70 לפני מע״מ · עגבניות שרי" and a quiet button "להחלטה" (named "להחלטה על הפער") that returns the
  pane to its top; "לפרטי הפער" for a role that may not decide and for a decided gap, whose bar reads "{result}
  · ₪38.70 לפני מע״מ" with no item (the amount is never cut). **In `INV-01` the bar's button reads "לפרטי הפער"
  for every role**: the card it returns to holds a button to the desk, not a decision, and two buttons named
  "להחלטה" with two effects would mislead. "להחלטה" in the bar arrives with `INV-05`. The bar's text is hidden from a screen reader,
  the button takes the focus with no jump, and the bar is not removed while it holds the focus.
- **The phone's dock.** Fixed at the foot, named "ההחלטה על הפער": the caption "הפער ₪38.70 לפני מע״מ · עגבניות
  שרי" (it may take two lines) over the action. It is absent for a decided gap, for a role that may not decide
  and while the reasons question is open. The message with "ביטול" sits above it.

### 4.6 The payment block

Heading "התשלום", in the pay run's own words, from `invoices.detail.payment` and `.allocation`:

- "בהשהיה" (grey, a clock) or "ניתן לשלם" (a quiet word), with the reason.
- "ההחלטה על הפער תשחרר את החשבונית לתשלום." **only when an open gap is the only thing that holds the
  invoice.** With no open gap and nothing else holding: "אין פער פתוח, והחשבונית בין אלה שניתן לשלם." Held for
  another reason: that reason, in today's words (the block takes in today's held-reasons note and VAT note,
  `[invoiceId]/page.tsx:209-249`, and keeps their test ids).
- "לתשלום עד" · "לפני מע״מ" · "מע״מ" · "כולל מע״מ".
- The check: "השורות מסתכמות בסכום שלפני מע״מ, והמע״מ תואם." with **no percentage** (today's string prints the
  rate, also on an invoice with no VAT: `messages/invoices/he.ts:211`).
- The allocation line, one of three: "מספר הקצאה לא נדרש בסכום הזה."; the number itself; or that it is missing.
  The block ends with one empty, named wrapper for the allocation field
  (`[invoiceId]/allocation-field.tsx`). That field is a file on `main` that nothing mounts; pull request 341
  mounts it. `INV-01` neither mounts nor edits it.

### 4.7 The lines

Heading "שורות החשבונית" with "המחירים והפער לפני מע״מ". A switch named "אילו שורות להציג": "שורות עם פער" and
"כל 11 השורות". The gap lines alone by default, and under them "ועוד 10 שורות בלי פער."; every line by default
for the bookkeeper at a desk.

- Columns in the order of the three documents, with a group head over them: "הזמנה" (the order's reference and
  the date it was sent) over "הוזמן"; "קבלת סחורה" (its date) over "התקבל"; "חשבונית" (its date) over "חויב"
  and "מחיר"; then "מחיר צפוי" beside the invoice's price and outside the order's group (it may come from a
  price list); then "פער לפני מע״מ". Dense: "מחיר, ₪", "מחיר צפוי, ₪", "פער, ₪ לפני מע״מ".
- The gap's row is tinted by its level while open and grey once decided; the two cells that disagree are
  marked.
- With every line shown, the last row of the head stays under the pinned amount (a desk).
- On a phone the same rows with labels: the three quantities on one row, the two prices on the next.
- Kept on a line: "לבדיקה" on a line read in doubt (`cockpit.tsx:188-192`) and "לא נספר"
  (`packages/api/src/routers/invoices.ts:469`).
- A row does not answer the document and the document does not answer a row: that is step two.

### 4.8 What happened ("מה קרה עם החשבונית")

A short list, newest first, from `invoices.history`, built only from what the product records. A role beside
every act, never a name; "it was you" is a flag. A fresh entry is marked.

- "ההזמנה נשלחה לספק"
- "הסחורה התקבלה ונספרה" · קבלת סחורה
- "החשבונית נקלטה ונבדקה מול ההזמנה והקבלה, נמצא פער אחד" · המערכת
- "הפער הגיע לבעלים", and under it the rule's sentence
- "הועבר לבעלים" · ניהול
- the decision, as section 2.2 words it, · בעלים, with ", במקום הניהול" when so, and the reason under it

On a phone the chain "המסמכים שנבדקו" stands above it: הזמנה · קבלת סחורה · חשבונית · בקשת זיכוי ("נפתחה
היום" or "אין").

### 4.9 Element by element

| Element | On `main` today | State | Built by · from |
| --- | --- | --- | --- |
| Two panes | the document at the start edge, 44 / 56, from 1024 px (`cockpit.tsx:100`, `:387`); the viewer sticky, the page scrolls (`:306`) | differs | `INV-01` |
| Divider, pinned amount, whole-screen dialog, phone window | none | new | `INV-01` |
| Image tools | zoom 50 to 400 % in steps of 25 and a turn by CSS (`InvoiceScanViewer.tsx:62-71`, `:96`) | differs: fit, drag, pinch, keys, a turn that re-lays | `INV-01` |
| PDF | a sandboxed frame, 70dvh, no tools (`InvoiceScanViewer.tsx:88`) | kept in `INV-01`; in the same viewer only by `INV-06` | |
| "פתחו את המקור" | `InvoiceScanViewer.tsx:78-83` | exists, kept | `INV-01` |
| No file | `cockpit.tsx:297`, `messages/invoices/he.ts:187` | exists | `INV-01` |
| "חפשו במסמך" | none | new | `INV-01` · the item from `invoices.detail`; the SKU from `receiving.getInvoice`, which the page already loads (`[invoiceId]/page.tsx:91`) |
| Back link by origin | `[invoiceId]/page.tsx:44`, `:124` | exists, kept | `INV-01` |
| Place and previous / next | two text links, only from the list, no place (`cockpit.tsx:363-364`); the keys (`:125-145`) | differs | `INV-01` · `invoices.list` rows `place`; `places.ts` |
| State pill | `STATE_TONE` imported from the list (`cockpit.tsx:20`) | differs | `INV-01` · `lib/invoices/state.ts`; the worst open level in `holding` |
| Three facts | the total without its basis; the due date is returned and not shown | differs | `INV-01` · `invoices.detail` `payBy` (the pay run's own date; no remainder when it is null) |
| Gap card | chips under a flagged line | new | `INV-01` · `invoices.detail` `holding`, per-finding routing and decision; `approvals.myQueue({ scope: 'all', invoiceIds: [id] })` for the open rows |
| Count of open gaps | `openCount` counts the ₪0 twin (`routers/invoices.ts:480`) | differs | `INV-00` (`queueOpenCount`), `INV-01` |
| The action | one sticky link to the desk (`cockpit.tsx:416-417`, test id `cockpit-decide`) | `INV-01`: one button to the desk, or the sentence. `INV-05`: the decision of section 2.7 | `approvals.*`, unchanged |
| Payment block | a held-reasons note and a VAT note beside the screen (`[invoiceId]/page.tsx:209-249`) | differs | `INV-01` · `invoices.detail` `payment`, `allocation`, `payBy` |
| Check line | prints the VAT rate (`messages/invoices/he.ts:211`) | differs | `INV-01` |
| Lines by three documents | a flat table (`cockpit.tsx:210-262`), cards on a phone (`:265-`) | differs | `INV-01` · already returned (`routers/invoices.ts:454-477`); the order's sent date is new |
| History | none on this screen | new | `INV-00` (`invoices.history`), `INV-01` |
| Reading correction ("ערכו נתוני סריקה"), the consolidated panel, dock-price notes, the partial-load banner, the duplicate notice | `cockpit.tsx:334`, `[invoiceId]/page.tsx:182`, `:253` | exist, kept with their test ids | `INV-01` mounts them and edits none |

## 5. Screen 3 · approvals by role (`INV-04`)

**Purpose.** The desk the owner already approved (a queue on one side, the evidence and the decision on the
other), with what he asked for added: who decides what. Every open gap is a real row for every finance role,
grouped by who decides. Owner, manager and bookkeeper. Built on the finished DS3-04 desk.

### 5.1 Layout

As DS3-04 built it: the queue and the evidence side by side from 1280 px; below that one gap at a time with
arrows to step, the decision bar fixed above the bottom bar, and the message above it. So at 1024, on a tablet
and on a phone the desk shows one gap at a time. The desk's height follows the window. New on a narrow screen:
the who-and-why line, the read-only sentence, the place counted over every group ("2 מתוך 4"), and the rules
card as a sheet.

### 5.2 The queue

**Head.** Line 1: "2 פערים אצלכם, ₪143.50 לפני מע״מ." / "פער אחד אצלכם, …" / "אין פער שמחכה לכם." / "אין פערים
פתוחים." Line 2: "4 חשבוניות עם פער פתוח, ₪10,148.93 כולל מע״מ." / "חשבונית אחת עם פער פתוח, …". The figures
come from `approvals.queueSummary` (`byRouting`, `invoices`); the screen never sums rows.

**Groups**, in this order: "אצלכם"; then the other roles that hold a gap ("אצל הבעלים", "אצל הניהול", "אצל
הנהלת החשבונות"); then "הוחלט היום". Each head: the name, the count, "₪143.50 לפני מע״מ", and on another
role's group the note **"גם אתם רשאים להחליט"** or **"לקריאה בלבד"**. Inside a group: blocking first, then the
longest wait. The box "ממתין לאחרים" goes: the rows replace it.

An empty own group still shows, and says what will arrive: "פערים חדשים יופיעו כאן." (owner), "פערים שמגיעים
לניהול יופיעו כאן." (manager), "חשבונית שנראית כפולה תגיע לכאן." (bookkeeper).

**A row:** the dot (red, amber, grey once decided); the item; "<supplier> · <number>"; under them the "why"
line (the rule's phrase with a full stop); at the end the amount and under it the days it waits ("10 ימים",
"מהיום"). A decided row, in calm grey: the amount and "נוסף לבקשת הזיכוי · בעלים" or "הפער: שולם כפי שחויב".

**Keys** (the queue holds the focus): ↑ ↓ or J K move; 1 "בקשת זיכוי"; 2 "שלמו כפי שחויב" (asks why); 3
"העבירו לבעלים" (where `canEscalate` allows it, section 2.7); Z "ביטול"; Home, End, PageUp, PageDown. The legend
under the queue shows only what the current row allows: "J K מעבר" always; "1 בקשת זיכוי" and "2 כפי שחויב"
when the gap can be decided; "3 לבעלים" where `canEscalate` allows it; "Z ביטול" while a decision can be
taken back. The list's name for a screen reader says the same keys.

### 5.3 The evidence and the decision

The form of the approved desk, plus:

- **Top:** the pill "חוסם תשלום" or "אזהרה" (a decided gap: its result); "1 מתוך 4"; "הפער הקודם" and "הפער
  הבא".
- **Title and meta:** the gap's kind; "<item> · <supplier> · <number>", the number a link to the invoice
  screen.
- **The who line:** the full line of section 2.2 with an icon; "גם אתם רשאים להחליט" when the owner looks at
  another role's gap; and the link "מי מחליט על מה".
- **"הוזמן · התקבל · חויב":** the heads carry their document ("הזמנה מ־14.10.2026", "נספר, 15.10.2026 ·
  07:50", "חשבונית SH-24121"); rows "כמות" and "מחיר לק״ג" with "לפני מע״מ"; the cell that disagrees is tinted
  and says by how much ("3 ק״ג פחות", "10.0% יותר"). Then the calculation "3 ק״ג × ₪12.90 = ₪38.70" with "לפני
  מע״מ", and the line on the supplier's document.
- **The bar:** section 2.7, with the key caps 1, 2, 3 in the buttons, and a hint at its end: "אחריו נשארים עוד
  2 פערים" / "אחריו נשאר עוד פער אחד" / "הפער האחרון שמחכה לכם" / "הפער האחרון שנשאר פתוח". After a decision the
  next gap is the next one the viewer may decide, their own first.
- **Read-only:** "ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם." in place of the buttons.
- **A decided gap** (picked from "הוחלט היום"): the evidence in grey; in the bar a tick, the result, and
  "25.10.2026 · 14:32 · בעלים · {reason}".
- **A passed-on gap** moves to "אצל הבעלים", stays visible read-only to the role that passed it, and says
  "הניהול העביר אחרי 6 ימים" and "מהיום"; the owner reads the note.

### 5.4 The card "מי מחליט על מה"

A dialog (a sheet on a narrow screen), closed by its button "סגירה", by Escape and by a press outside; the
focus stays inside and returns to the link. Its numbers come from `settings.effective`
(`packages/api/src/routers/settings.ts:309-316`), in the engine's order, never from literals.

- "כל פער מגיע לתפקיד שמחליט עליו, והכלל הראשון שמתאים קובע."
- The base, stated once: **"הסכומים לפני מע״מ, והאחוז מסכום החשבונית כולל מע״מ."**
- Table "מה נמצא" · "אצל מי": "חשבונית שנראית כפולה" · הנהלת חשבונות; "פער שחוסם תשלום" · בעלים; "הפערים
  בחשבונית מעל ₪300, או מעל 5%" · בעלים; "הפערים בחשבונית בין ₪50 ל־₪300, או בין 2% ל־5%" · ניהול; 'פער ברמת
  "מידע", כשהפערים בחשבונית עד ₪50 ועד 2%' · נסגר לבד; "כל פער אחר, גם אזהרה קטנה" · ניהול.
- "מה חוסם תשלום": "חיוב על יותר ממה שהתקבל" · "מחיר שעלה ב־10% ומעלה" · "פריט או חשבונית בלי הזמנה" · "סכום
  שלא תואם לשורות" · "חשבונית שנראית כפולה". The 10% is the restaurant's `tolerances.blockPricePercent` from
  the same `settings.effective`, never a literal (`packages/matching/src/tolerances.ts:9`;
  `packages/api/src/routers/settings.ts:58`).
- "מה נחשב מידע": "מחיר נמוך מהמצופה" · "סטייה קטנה בכמות".
- "הבעלים יכולים להחליט גם על פער שהגיע לניהול או להנהלת החשבונות." and "את הסכומים והאחוזים משנים הבעלים במסך
  ההגדרות."

### 5.5 States

| State | What shows |
| --- | --- |
| Loading | DS3-04's skeleton. |
| Nothing open for anyone, nothing decided today | "הכול מטופל" with a grey mark and "פערים חדשים יופיעו כאן". |
| Nothing for the viewer, gaps open for others | Never "הכול מטופל": the head says "אין פער שמחכה לכם.", the own group says what will arrive, the others' rows show. |
| Decided | The row drops to "הוחלט היום", for every role, with the result and the role; it can be picked and stepped through; it is still there after a reload; an undone decision leaves it. |
| Held | Not this screen's word. That any open gap holds its invoice is said on the pay run. |
| Owner | Own group first; "גם אתם רשאים להחליט" on the others. |
| Manager | Own group first; the owner's group "לקריאה בלבד"; key 3. |
| Bookkeeper | Every gap as a row, read-only except an invoice that looks like a duplicate, which the bookkeeper may decide or pass to the owner (key 3); dense rows by default. |
| Opened on one invoice (`?invoice=`, where "להחלטה" of the other screens lands) | The desk is narrowed to that invoice: the head, "N מתוך M" and the hint count it alone (DS3-04: `approvals/page.tsx:50-52`, `:68-70`; the mock-up does not narrow). The filter is visible and is cleared in one press. After the invoice's last gap is decided: the filtered note (DS3-04: `approvals/page.tsx:156-157`), never "הכול מטופל" while gaps are open elsewhere. |

### 5.6 Element by element

| Element | On `main` today · DS3-04 | State | Built by · from |
| --- | --- | --- | --- |
| Every open gap as a row | the server has `scope: 'all'` (`routers/approvals.ts:241`, `:323`); the desk asks for the viewer's own (DS3-04: `use-desk.ts:274`, `:411`) | differs | `INV-04` |
| Groups by who decides | by invoice on `main`; by level on DS3-04 ("חוסמים תשלום", "אזהרות") | differs | `INV-04` · `waitingOn`, `canAct` on each row |
| "ממתין לאחרים" | a count box (`messages/approvals/he.ts:29`; DS3-04: `queue.tsx:327`) | goes | `INV-04` |
| The "why" line | the rule id is on every row; nothing prints it, and the stored rule strings use the retired word "הפרש" (`messages/approvals/he.ts:278-281`) | new | `INV-00` (`reason`, `passedOn` on the row; the words), `INV-04` |
| Row meta: the days it waits | DS3-04 shows the due date, and the wait only without one (DS3-04: `queue.tsx:405-417`) | differs (section 8, point 13) | `INV-04` |
| Head lines | one sentence from the server's "mine" | differs | `INV-00` (`queueSummary.byRouting`, `.invoices`), `INV-04` |
| Read-only form of the bar | none (DS3-04: `decision-bar.tsx:48`) | new | `INV-04` |
| "גם אתם רשאים להחליט", "החלטתם במקום הניהול" | the server allows it and records both roles (`routers/approvals.ts:818`, `:827`); no screen says it | new | `INV-04` |
| "העבירו לבעלים" with its sheet, note, e-mail and undo | exists (`routers/approvals.ts:549-575`; DS3-04: `sheets.tsx`) | exists, kept | |
| "הוחלט היום" | a decided row lives as long as its undo | new | `INV-00` (`approvals.decided`), `INV-04` |
| "מי מחליט על מה" | none | new | `INV-04` · `settings.effective` (exists) |
| Roles, not names | a name when one arrives, else "משתמש אחר" (`messages/approvals/he.ts:163`; DS3-04: `history.tsx:65`, `conflicts.ts:21`) | differs | `INV-04` |
| "מנהל" | `messages/approvals/he.ts:36` | becomes "ניהול" | `INV-04` |
| "הפרש" in three labels the desk shows | `summary.vat`, `amountLabel.vat`, `amountLabel.other` (`messages/approvals/he.ts:26`, `:124`, `:128`; DS3-04: `:28`, `:310`, `:314`) | becomes "פער", keys unchanged | `INV-04` |
| Undo, the keys by physical key, the phone's one gap at a time | exist (DS3-04) | exist, kept | |
| "הכול מטופל" | whenever the viewer's own queue is empty (DS3-04: `empty.tsx`) | differs | `INV-04` |
| The decision as something a second screen mounts | a queue controller that writes `?sel=` on its page (DS3-04: `use-desk.ts:141-144`) | new | `INV-04`, slice 1 |

Kept although the mock-up does not draw them: the bulk selection and "approve the whole invoice" on rows the
viewer may decide, the filters, saved views and the CSV, the branch strip, the link to the pay run, and the
duplicate, "סמנו כנבדק" and "שייך להזמנה" forms of the bar.

## 6. Screen 4 · the pay run (`INV-03`)

**Purpose.** Why each invoice is held, and what can be paid. Held invoices are grouped by who holds them, the
viewer's own first, each group with its sum, adding up to "בהשהיה". **No control records a payment.** Owner,
manager and bookkeeper, where the feature `payRun` is on. It is off for the pilot restaurant: that is the
owner's statement on the proposal page. No file in the repository holds the pilot's flags, and
`PILOT_FEATURE_KEYS` in `packages/db/scripts/pilot-setup.ts:61-95` is only the list of keys that exist
(`payRun` is in it, as every key is).

### 6.1 Layout

- **A desk and 1024.** Head: the title "ריצת תשלומים", the quiet chip "כל מה שפתוח", and one secondary button
  "ייצוא להנהלת החשבונות". Then two tiles and, beside them, one sentence. Then "למה חשבוניות בהשהיה": one card
  per group, each a head row and its invoices as rows (supplier · number · due date · why · amount). Then
  "ניתן לשלם": one table by due date with a totals row. **Today's five due sections go as headings:** held
  invoices are grouped by who holds them, and payable invoices are one table in due-date order. Each row
  keeps its due date and its due-date notices.
- **Tablet and phone.** The tiles two in a row and the sentence under them; each group's rows stacked
  (supplier and amount, number, due date, reason); the payable invoices as cards; "כולל מע״מ" after each
  amount; targets of 44 px.

### 6.2 The tiles and the sentence

- "ניתן לשלם" with its count, the amount, "כולל מע״מ". "בהשהיה" the same.
- "פערים של ₪296.00 לפני מע״מ מחזיקים חשבוניות של ₪10,148.93 כולל מע״מ." One gap: "פער של ₪X לפני מע״מ מחזיק
  חשבונית של ₪Y כולל מע״מ." None: "אין פער שמחזיק חשבונית."

### 6.3 The groups

Every held invoice is in exactly one group, and the groups' sums equal the tile to the agora. Order: the
viewer's own decisions; then the other roles' (owner, manager, bookkeeper); then "ממתינות לשיוך"; then "חסר
מספר הקצאה".

| Group | Dot | At the end of its head |
| --- | --- | --- |
| "מחכה להחלטה שלכם" / "מחכות להחלטה שלכם" | red when one of its gaps blocks payment, else amber | **"להחלטה"**, filled on the first group the viewer may decide |
| "מחכות להחלטה של הבעלים" / "… של הניהול" / "… של הנהלת החשבונות" | the same | a secondary "להחלטה" when the viewer may decide (the owner on the manager's group); otherwise **"לקריאה בלבד"** |
| "ממתינות לשיוך" | grey | the note "השיוך לתעודות המשלוח עוד לא פעיל." (a consolidated invoice only) |
| "חסר מספר הקצאה" | amber | "בקשו את המספר מהספק, כדי לקזז ₪1,123.20 מע״מ." |

A group of one invoice reads "מחכה", of several "מחכות". Each head also carries the count and the sum with
"כולל מע״מ". "להחלטה" opens the approvals desk on the `decideGapId` of the group's longest-waiting invoice, at
`/dashboard/approvals?invoice=<invoiceId>&sel=<gapId>`; the desk opens narrowed to that invoice (section
5.5). The group a row sits in is `holding.role`, with `mine` and `canAct`, from `invoices.holding`, so one
invoice is under the same role here, on the list and on the invoice screen.

**A row held for a decision:** supplier · number · "20.11.2026 · נותרו 26 ימים" · "פער של ₪104.80 לפני מע״מ · 4
ימים" and under it the rule's sentence, word for word the list's and the desk's · the amount. A gap passed on
today reads "מהיום" and "הניהול העביר אחרי N ימים". A hold whose open ₪ is zero never prints ₪0.

Decision 6 is unchanged: **any open gap holds its invoice**, a warning as much as a blocking gap
(`packages/api/src/routers/payRun.ts:197-203`, `:222-230`). Two things do not hold an invoice and are not to
be "fixed": the ₪0 twin, and a row of a kind that is not a leak.

### 6.4 What can be paid

Columns: ספק · מספר · "לתשלום עד" · "הערה" · "סכום כולל מע״מ" (dense: "סכום, ₪ כולל מע״מ"), by due date, and a
foot "סך הכול, 8 חשבוניות". The note of a decided gap: "₪38.70 בבקשת זיכוי, לפני מע״מ · הוחלט היום" or "הפער:
שולם כפי שחויב · הוחלט היום"; a row decided today is tinted grey; the head "הערה" is visible only when a row
has a note.

### 6.5 States

| State | What shows |
| --- | --- |
| Loading | No route-level loading file: it stalled the month filter's navigation, and `apps/web/scripts/check-soft-nav.mjs:193-196` probes the route without one. |
| The feature off | The product's own disabled state, as today. The mock-up's notice about the pilot is not built. |
| Nothing held for a decision | "אין פער שמחזיק חשבונית." |
| Owner | The owner's group first with the only filled "להחלטה"; a secondary one on the manager's group. |
| Manager | The manager's group first; the owner's group "לקריאה בלבד". |
| Bookkeeper | Every decision group that is not a duplicate "לקריאה בלבד"; no filled button on the screen; dense rows at a desk. |
| Decided | The invoice moves to "ניתן לשלם" with its note. |

### 6.6 Element by element

| Element | On `main` today | State | Built by · from |
| --- | --- | --- | --- |
| Two tiles | `pay-run/page.tsx:306-322`; the held tile says "… בבירור מול הספק" and no basis (`messages/payRun/he.ts:87`) | differs | `INV-03` · `payRun.list` totals (unchanged) |
| The sentence | none | new | `INV-03` · summed from the rows held for a decision, each on the basis the server returns |
| Groups by who holds | one table per due section, payable and held mixed | differs | `INV-03` · that an invoice is held for a decision, and its ₪, come from `payRun.list`; the group's role, the days and `canAct` come from `invoices.holding`. `payRun.list` defines them differently: the role of the oldest open finding (`routers/payRun.ts:273-281`) and days from the gap's creation (`:283-288`, `:733`) |
| The rule under a row, the dot, `decideGapId` for the jump, a pass-on, the decided note | not returned by `payRun.list` | new | `INV-03` · one call of `invoices.holding({ invoiceIds })` (`INV-00`); words from `lib/invoices/` |
| "להחלטה" per group | a secondary "החליטו" per row, to `?invoice=` only (`pay-run/page.tsx:231`) | differs | `INV-03` · the desk's address of section 6.3 |
| Role words | "מנהל/ת", "בעלים או מנהל/ת" (`messages/payRun/he.ts:125-127`) | differs | `INV-00` (the words), `INV-03` |
| "פער … לפני מע״מ" | "בבירור מול הספק" (`messages/payRun/he.ts:105`, `:114`) | differs | `INV-03` |
| "חסר מספר הקצאה" as an action | the hold and its VAT exist (`routers/payRun.ts:471-473`, `:707-709`; `messages/payRun/he.ts:120`) | differs in form | `INV-03` |
| Due date as text | `DeadlineChip` (`pay-run/page.tsx:174`) | differs | `INV-03` |
| The credit in neutral | drawn as caught money (`pay-run/page.tsx:328`) | differs | `INV-03` |
| Export | "ייצוא CSV להנהלת חשבונות" (`messages/payRun/he.ts:60`) | the label and the columns follow the new reasons | `INV-03` |
| A control that records a payment | hidden while the server flag is off; when on it is the filled button (`pay-run/selection.tsx:165`) | never the filled button; `payRun.markPaid` answers NOT_IMPLEMENTED (`routers/payRun.ts:808-828`) | `INV-03` changes the emphasis only |

Kept although the mock-up does not draw them: the month filter `?m=`, the branch strip, the due-date notices,
the credit sentence, the selection and its export, and the reasons the mock-up omits (a duplicate copy,
waiting for the count, an open question, a held reading, a note billed twice) with their sentences and
actions. `packages/api/src/routers/payRun.ts` is not edited by any package.

## 7. Out of scope

- **Step two of decision 7.** Stored positions of lines; the drawn mark and its margin tab "פער"; "הציגו את
  השורה"; opening the document on the gap's line; a row of the table answering the document and a printed
  line answering the row; the caption "השורה עם הפער מסומנת"; the mock-up's state "עם סימון". The mock-up shows
  all of it; none of it is built, and nothing on the screen speaks of it.
- A recorded payment, "סמנו כשולם", names in the history, the reminder, linking a consolidated invoice to its
  delivery notes, any change to a routing rule or to the base of the percentage: `README.md`, "Needs a human
  change".
- A PDF in the same viewer: `INV-06`, optional, behind its three checks.
- Mock-up only: the role switch "להציג כמו", the switch "המסמך", the note about the demo day, the notice that
  the pay run is off in the pilot, the message "בהדמיה לא נוצר קובץ", the drawn papers and their invented
  suppliers.

## 8. Where the owner has not spoken: the default a package builds

Each default is built until he says otherwise, and each is named in the pull request under "Owner decisions
touched".

1. **An invoice with open gaps at two roles.** For the viewer it is "אצלכם" when one of its gaps is routed to
   the viewer's role; otherwise it sits with the role of its leading gap (blocking first, then the oldest).
2. **A possible duplicate.** Undecided, it sits with "אצל הנהלת החשבונות" like any gap; once held as a copy it
   gets a place of its own, shown only when it holds an invoice, named by the state word "כפולה אפשרית".
3. **An invoice that waits to be linked and also has a routed gap.** Its place follows the state ("ממתינות
   לשיוך") and its row still names who holds the gap.
4. **The reason for a rule he has not read as a phrase** (a duplicate, a large invoice with no order, an item
   that was not ordered, a blocking gap of another kind, the larger cumulative rule, the percentage band, the
   fallback): with whom and how long, with no "כי …". `INV-00` lists proposed phrases in its pull request.
5. **Numbers in the phrase after the thresholds changed:** printed only when they are provably the ones that
   routed the gap.
6. **"N ימים" after an invoice is checked again:** the count restarts. Shown as it is.
7. **"שולמו":** the card appears only when the month has a paid invoice; its third line needs his words for a
   real restaurant.
8. **The payment block where the pay run is off:** shown; it states the invoice's own state.
9. **What the mock-up does not draw on the list:** everything stays except the allocation number as a column,
   which gives way to the place.
10. **What the mock-up does not draw on the pay run:** kept; the rows of the five reasons it omits keep today's
    sentences in a last group, whose name needs his word.
11. **The invoice screen:** one card per gap when an invoice has several; the item alone in "חפשו במסמך" for a
    line with no SKU; passing a gap on through the desk's sheet with its note, not in one press as drawn.
12. **The undo's word:** "ביטול" in the mock-up, "בטלו" in the product today
    (`messages/approvals/he.ts:182`). One word for both screens; until he picks, the product's word stays and
    the pull request says so.
13. **The desk's title** ("אישורים" in the mock-up, "תור אישורים" today, `messages/approvals/he.ts:8`): the
    product's stays. **Beside a row's amount:** the days it waits. **The bulk selection:** stays, only on rows
    the viewer may decide.
14. **The same gap drawn two ways.** The desk tints one cell and writes "3 ק״ג פחות"; the invoice screen draws
    the two cells as an ink pair and writes "חויבו 3 ק״ג יותר". Each screen keeps its own drawing.
15. **The divider's place:** remembered while the tab is open, forgotten on a reload.
16. **"הוחלט היום":** today only on the screen, although the read takes a period; gaps the system closed by
    itself are not in it.
17. **An invoice being read or waiting for the count** (`in_ocr`, `awaiting_count`) is in the place `wait`, as
    the mock-up has it (`reference/src/inv-core.js:218`). The card keeps the name "ממתינות לשיוך"; its third
    line "חשבוניות מרכזות" is printed only when every invoice in it is consolidated, otherwise none. The
    card's name when it holds other kinds needs his word: `INV-02` lists it under "Owner decisions touched".
18. **A gap the bookkeeper passed on** (the product allows it, section 2.7): with whom and how long, with no
    "כי …". The approved pass-on phrase names the manager; `INV-00` proposes the bookkeeper's.
19. **The button to the next gap when it is the bookkeeper's:** "לפער הבא, אצל הנהלת החשבונות" is five words
    and a button holds four. `INV-05` proposes a shorter label and does not ship the five-word one.
