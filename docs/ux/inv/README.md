# INV · the invoices area

**Status, 28.11.2026:** direction approved by the owner, every recommendation taken; implementation as separate
work packages, one coding session and one draft pull request each. Nothing here ships without the owner's merge
(`AGENTS.md`: pull requests only).

## What this is

The owner wrote that the invoices area is the most important part of the product for them, and that the main
work there is the display and the approvals by role. A design proposal followed: four live mock-ups (the
invoices list, the screen of one invoice, the approvals desk by role, the pay run), a switch above each that
shows it as the owner, the manager and the bookkeeper see it, and a list of seven decisions with a
recommendation beside each. The proposal was published in six versions, each after a round of independent
review; Version 6 is in this folder.

The owner's words on 28.11.2026:

> קח את ההחלטות והמלצות ורוץ קדימה

So: build the four screens, with every recommendation of the proposal as the decision.

One thing arrives a step later than the owner was told. Deciding a gap from the invoice screen (decision 2) is
its own package, `INV-05`, after approvals by role. The invoice screen itself comes in the first wave; until
`INV-05` lands it keeps what it has today, one button that opens the approvals desk on that invoice. The reason
is in the code: a decision on the invoice screen has to be the desk's own decision, mounted and not copied, and
the desk becomes something a second screen can mount only in the approvals package (`WORKPLAN.md`, `INV-04`,
slice 1).

## What is in this folder

| Path | What it is |
| --- | --- |
| `SPEC.md` | The design spec of the four screens: what every screen shares (the words, the status language, money, dates, keys, the decision), then each screen with its layout by width, its states, its exact Hebrew strings, and for each element whether it exists on `main`, which package builds it and from which server field. Binding for every package. |
| `WORKPLAN.md` | The work packages `INV-00` … `INV-06`: goal, write boundary, seams, upstream, slices, acceptance, and the rules of the partition. Binding for every package. |
| `KNOWN-ISSUES.md` | Where the mock-ups are looser than the product's rules or than the code allows. Read it before copying behaviour or wording from the reference. |
| `OPEN-PRS.md` | The open pull requests whose files fall inside each package's boundary or on one of its seams, as of 28.11.2026, 11:10 UTC. |
| `CHANGES.md` | Corrections to this folder made after the sessions started, newest first. It is created with the first correction. |
| `packages.json` | The partition in a form a script reads: for each package what it owns, what it creates, its seams; the files given to nobody; the immutability list. Generated from `main@de5cfcf7`, which is `main` on 28.11.2026. |
| `check-partition.cjs` | Checks `packages.json` against a checkout: no file owned twice, no immutable file inside a boundary or a seam, every base the first branch merged in. With `--changed INV-0N` it checks a session's own commits against its boundary and seams. Writes nothing. |
| `reference/reference.html` | The proposal page, Version 6, with the four mock-ups live, in one standalone page. **The visual and behavioural source of truth.** |
| `reference/src/` | The sources of that page: `body.html` (the page), `inv-core.js` (the words and the store all four share), `inv-register.js`, `inv-invoice.js`, `inv-doc.js`, `inv-desk.js`, `inv-payrun.js`, `inv-page.js`, `inv.css`, `inv-doc.css`, `inv-r15.css`, `product.css` (the clean finish), `base.js`, `sprite.html`, `data.json` (the demo restaurant on 25.10.2026). |
| `reference/PAGE-TEXT.he.md` | The Hebrew text of the proposal page as the owner read it: what changes on each screen and why, what is needed to build it, and the seven decisions. Its "היום" statements describe `main` as it was when the proposal was drawn; see the note at its top. |
| `reference/checks/` | Eight scripts that drive the reference in a headless browser (`check.cjs`, `verify10.cjs` … `verify17.cjs`), with `launch.cjs` and a `README.md` that lists what each checks. They are executable descriptions of expected behaviour. |

The look of everything here is the clean finish: `docs/ux/ds3/SPEC.md` stays binding in full.

## Decisions: what is settled and what is not

All seven were approved on 28.11.2026 with the page's recommendation.

| # | Question on the proposal page | Status | What the packages do |
| --- | --- | --- | --- |
| 1 | Build the four screens? | **Approved.** | `INV-01` the invoice screen, `INV-02` the list, `INV-03` the pay run, `INV-04` approvals by role; `INV-00` the server reads and the shared words. |
| 2 | Decide a gap from the invoice screen too? | **Approved:** the same actions and the same undo as the approvals desk. | `INV-04` (slice 1) makes the desk's one-gap decision something a second screen mounts; `INV-05` mounts it. Same procedure, same input, nothing implemented twice. |
| 3 | May the owner decide a gap that waits for the manager? | **Approved:** keep it. | Nothing on the server: it already allows it and already records both roles. `INV-04` and `INV-05` say it on the screen ("גם אתם רשאים להחליט", "החלטתם במקום הניהול"); `INV-00` says it in the history. |
| 4 | Names or roles in the history? | **Roles.** | `INV-00`'s history read returns roles and no name or user id; `INV-04` prints the role in the desk's history and in "כבר הוחלט". **Names need a human change** (row security). |
| 5 | Hide "שולמו", and fix "ללא מספר הקצאה"? | **Approved.** | `INV-02`: "שולמו" appears only when the month has a paid invoice. `INV-00` and `INV-02`: "חסר מספר הקצאה" counts only invoices that must carry a number, by the pay run's own rule. A recorded payment **needs a human change** (the data structure). |
| 6 | Does a warning at the manager keep holding the whole invoice? | **As today:** any open gap holds the invoice out of the pay run. | No change on the server. `INV-03` says it in words. |
| 7 | Mark the gap's line on the supplier's document? | **In two steps.** Step one is in this batch; step two is **not**. | `INV-01`: the document beside the data, and the line "חפשו במסמך: {item}, מק״ט {sku}". Stored positions and a drawn mark on real documents are step two and are built by nobody here; they **need a human** (the reading service, its keys). |
| small | After how many days is a gap old? | **No colour for an old gap.** | The oldest is sorted first and its days are written. Nobody adds a colour. |
| small | The base of the percentage in the rules | **Unchanged**, and stated on the settings screen. | `INV-04` states the base in the card "מי מחליט על מה". The sentence on the settings screen itself is in no package's boundary: the folder is DS3-06's (pull request 353), and the lead sends the request ("Needs a human change", below). A change of the base **needs a human change** (the approvals engine). |
| kept | Three things two reviewers questioned | **Kept.** | The button "בקשת זיכוי · ₪amount"; the solid pill "חוסם תשלום"; the tinted row of the gap's line. |

Where the owner has not spoken and a screen needs an answer, `SPEC.md` §8 gives the default each package
builds and names in its pull request.

**Needs a human change.** No package improvises any of these; each is a file of the immutability list, the
data structure, a credential, or a branch, a pull request or a spec that is not an `INV` session's. A
package that meets one writes the need into its pull request and leaves that slice.

- Names in the history (row security: `packages/db/drizzle/rls/0002_core_tenant_rls.sql`,
  `packages/db/src/rls.ts`).
- A recorded payment, "סמנו כשולם", and a "שולמו" place that means something in a real restaurant (payment
  columns on invoices; pull requests 241 and 252). `payRun.markPaid` answers NOT_IMPLEMENTED today.
- Linking a consolidated invoice to its delivery notes (the same pull request 241).
- Days waiting that survive a re-match: a re-match replaces the gap rows, and nothing stores when a gap was
  first seen.
- The reminder "שלחו תזכורת" (`packages/api/src/notifications/outbox.ts`; `payRun.remind` answers
  NOT_IMPLEMENTED).
- Any change to a routing rule, to who decides what, or to the base of the percentage
  (`packages/api/src/approvals/engine.ts`).
- Step two of decision 7: line positions from the reading service (`packages/ocr`, another agent's), and a
  check against a real reading, which needs keys only a person enters.
- For the optional `INV-06`: reading the licence of the PDF library, and checking that it loads a file from the
  real storage.
- The merge of the clean finish and of the desk: pull requests 346, 345 and 347 wait for the owner. Nobody
  merges `main` into `claude/ds3-01-components` or into `claude/ds3-04-approvals-desk` for this batch, and no
  `INV` session pushes to either: a session merges its upstream branch into its own branch, and `INV-04`
  resolves the desk's one conflict with `main` there, as its slice 0 (`WORKPLAN.md`, S10).
- The sentence about the percentage's base on the settings screen (decided 28.11.2026). The folder is
  DS3-06's (pull request 353). The lead posts the request on 353 when `INV-02` and `INV-03` open, with the
  card's own sentence, "הסכומים לפני מע״מ, והאחוז מסכום החשבונית כולל מע״מ.", printed from the key `INV-04`
  adds in `messages/approvals` and never written a second time: the copy guard fails the same text in two
  keys. If 353 merges without it, one follow-up pull request adds the sentence, from that key.
- The home's pay-run total, which counts an invoice the pay-run page holds for a missing allocation number:
  draft pull request 384 (`claude/w2-03-month-vat-hold`) is its fix, in `packages/api/src/routers/payRun.ts`.
  No package of this batch fixes that number (`WORKPLAN.md`, "Not in this batch").
- The owner's approval of a payment (pull request 380, a person's proposal, in `payRun.markPaid`): only a
  person merges it. Three of its seven files are inside `INV-03`'s boundary (`OPEN-PRS.md`).
- The sentence "החשבונית ממתינה לבדיקה של הבעלים או המנהל" on the invoice screen keeps the retired role word
  "המנהל" in this batch: `apps/web/e2e/pilot-unread-invoices.spec.ts:117` pins it and no package may edit that
  spec. The string and the spec change together, outside the batch (`KNOWN-ISSUES.md`, the invoice screen).

**Never decided by the owner, so not built:** passing a gap on with one press and no note (the product's sheet
stays); moving the invoice page under "חשבוניות" in the menu; removing from the list the month links, the
export, the column menus, "להשלמת שורות" or "נכנסות"; removing from the pay run the month filter, the due-date
notices, the selection or the branch strip (its five due sections do go as headings, because the approved
screen groups held invoices by who holds them: `SPEC.md` §6.1); removing the bulk actions from the desk;
"אתמול" and "השבוע" beside
"הוחלט היום"; a filter of the queue by routing; a bulk or one-tap decision on the invoice screen; the owner's
approval of a payment above an amount; a colour for an old gap; a stored divider width; a new feature flag for
the list, the pay run or approvals by role.

**In the mock-ups only:** the role switch "להציג כמו", the switch "המסמך", the note about the demo day, the
notice that the pay run is off in the pilot, the drawn supplier documents and their invented suppliers.

## Rules every package keeps

`AGENTS.md` is binding in full: pull requests only; the immutability list; the ownership map; a retry cap of
two; an artifact for every run. On top of it, for this batch:

- **The immutability list is never inside a write boundary and never a seam.** The matching engine,
  `packages/api/src/approvals/engine.ts`, the database schema and migrations, row security, the leads router,
  the tRPC route handler, billing, the outbox and the scheduled jobs, `.github/workflows/*`, `.claude/agents/*`,
  `AGENTS.md`, `OPERATING.md`. `packages.json` holds the list as paths.
- **No schema change and no migration.** "מידע חדש מהשרת" means new read fields and read procedures on the
  routers that exist, all of them in `INV-00`, which brings the tenant-security gate. No package changes a
  decision procedure, who may decide what, or the undo window.
- **One decision.** A gap decided from the invoice screen calls the same procedure with the same input as the
  approvals desk. Who may decide what is the server's answer (`canAct` on the queue row); no screen works it
  out again.
- **Facts and words come from `INV-00`.** A screen does not compute who holds an invoice, since when, why,
  whether it can be paid or which place it is in, and writes no role word or rule phrase of its own. A
  sentence of six words or more that two screens print is `INV-00`'s too: the copy guard fails the same text
  in two keys, and it would fail on `main` only once both screens have landed (`WORKPLAN.md`, "Rules of the
  partition").
- **No real OCR, e-mail, WhatsApp, storage provider or other credentialed service; no production database; no
  secrets.**
- **Two packages never own the same file.** A file two packages need has one owner and a written seam
  (`WORKPLAN.md`).
- **Nothing of step two** of decision 7: no stored position, no mark, no link between a row and a place on the
  document.

The owner's rules that the proposal was reviewed against, stated once:

- **Light product only.** Calm and precise: a command centre for money, never alarming. Every text and
  background pair passes WCAG AA (4.5:1); the reference holds 5:1.
- **Emphasis tiers T1 to T4 keep their meaning** (`AGENTS.md`, "Design vocabulary").
- **A money figure is never red.** Ink, muted, green or the brand colour only.
- **Pending is never a warning.** Waiting to be linked, being read, waiting for the count and consolidated
  invoices are neutral grey.
- **Green is only for money that came back.** A fresh credit request is neutral.
- **Colour only when money waits for a person:** red for what blocks a payment, amber for a warning that
  waits, grey otherwise. A status is a dot or an icon and a word, never colour alone. No colour for an old gap.
- **Words.** The word for a discrepancy is **"פער"**; the term is **"בקשת זיכוי"**. Never: נחסם, נחסך, הפסד,
  חיסכון, חריגה, ריכוז, הפרש, ממצא, דרישה, תביעה, יעד, "1.5%". A bare "אישור" or "אשרו" never appears on a gap:
  a button says its effect ("בקשת זיכוי · ₪X", "שלמו כפי שחויב"). The roles are **בעלים, ניהול, הנהלת
  חשבונות**. Spell "הכול".
- **Lengths.** A button: at most 4 words, a plural imperative ("שלמו כפי שחויב") or the name of what it creates
  or opens ("בקשת זיכוי", "להחלטה"); never a singular imperative. A visible line: one sentence, at most 12
  words. A toast: at most 8 words. Gender-neutral Hebrew, plural address.
- **Money.** ₪ sits left of the digits; every ₪ goes through `formatIls()` or the shared money component;
  **every amount states its VAT basis** ("לפני מע״מ", "כולל מע״מ") beside it or in its column head; numbers
  are physically right-aligned in columns. Unknown is never ₪0; no "—" in a money cell.
- **Dates** `dd.MM.yyyy`; date and time `dd.MM.yyyy · HH:mm`.
- **Undo** is visible for 10 s; the server allows 15 s (`REOPEN_WINDOW_MS`) so that a press at the last moment
  still lands; the screen never asks after 12 s. Change none of the three.
- **Roles, not names,** wherever a person's act is shown.
- **Show only what exists.** Never show as existing: a recorded payment, approval of a whole invoice, a second
  approver, a named assignee, comments, attachments other than the scan, a "seen" flag, an editable due date,
  an export history, reminders, delegation.
- **One filled primary button per viewport, and never a paying action.** Touch targets at least 44 px on a
  phone; desk text at least 12 px; type sizes 12, 13, 14, 16, 18, 20, 24, 28; radii 8 (control), 12 (card), 16
  (overlay). No decoration that carries no information.
- **Density.** The bookkeeper gets dense rows by default at a desk. On a phone the density is fixed.
- **Widths.** Every screen works at 1440, 1280 and 1024 px and on a 390 px phone.
- **Keyboard.** `[` and `]` step to the previous and the next invoice. Keys are read by the physical key, never
  fire while typing, and the single-character ones follow the personal switch. Focus is always visible.
  Reduced motion is respected.
- **Receivers never see ₪; chefs see ₪ only where they do today.** Neither enters this area.
- **No colour, size, radius, shadow, duration or easing is hard-coded outside the tokens.**
- **Messages.** Hebrew and English in the same commit. The areas `invoices`, `approvals` and `payRun` have no
  receiver-language overlays, so a new key there needs those two languages only; a new key in `nav`,
  `components` or the listed parts of `common` would need all four overlay languages, and this batch adds none
  there. No new message area.

## How a package works

1. **Read first:** `AGENTS.md`, `STATE.md`, this file, `SPEC.md`, your section of `WORKPLAN.md` and its "Rules
   of the partition", `KNOWN-ISSUES.md`, `OPEN-PRS.md`, then `docs/ux/ds3/SPEC.md` for the look. Open
   `reference/reference.html` at 1440 px and at 390 px and use the mock-up of your screen, as each of the three
   roles. Read the mock-up's source for the exact words and behaviour.
2. **Map before you change.** The proposal was drawn against `main` at `9dc0b934`, and the code maps behind
   this folder were read at `83bda7d7`. This folder describes `main` at `de5cfcf7`, which is `main` on
   28.11.2026: every file and line it cites was read there. `main` keeps moving, so start from `main` as it is
   on your day. List what exists on your screen, what differs and what is missing, and build only the
   difference. Reuse and extend the shared components; do not create a parallel set. Keep every test id
   that another spec reads.
3. **Stay inside your write boundary** (`WORKPLAN.md`, `packages.json`). The only edits allowed outside it are
   the seams your section names, each one small and named in your pull request. A router has one writer in
   this batch, `INV-00`: a screen that needs one more field asks for it under "Requests to other packages".
   Something missing from the shared components is built inside your boundary and listed under "Promote to
   shared". Never push to a branch that is not yours. Before you open the pull request, run the check of your
   own commits ("To check that the partition still holds", at the end of this file).
4. **Check the open pull requests** that touch your boundary before you start and before you finish
   (`OPEN-PRS.md` is the state of 28.11.2026, 11:10 UTC). Where one overlaps, say so in your pull request and
   keep your change easy to rebase.
5. **Verify like a user.** Run the local demo stack and look at your screen as each role that can reach it
   (owner, manager, bookkeeper; and confirm that the receiver and the chef are kept out), at 1440 px and at
   390 px, and at 1280 and 1024 where `SPEC.md` gives a rule for them, in Hebrew and in one more language.
   Compare with the reference side by side.
   - `bash docs/ux/wave2/lab.sh INV-0N` (from the repository root; its head lists the flags, and it takes any
     id of letters, digits and hyphens) seeds the demo restaurant "כפר הזיתים" as of 25.10.2026 with every
     feature on and serves a production build. It is local only. The demo accounts are `owner@`, `manager@`,
     `bookkeeper@`, `chef@` and `receiver@kfar-hazeitim.test`.
   - **The lab's server runs on the real clock.** `lab.sh` pins the seed to 25.10.2026 and nothing in the
     product reads `DEMO_TODAY` (`docs/ux/wave2/lab.sh:35`, `:100`, `:249-250`). So in the lab a wait reads 10
     plus the days since 25.10.2026, and `/dashboard/invoices` opens on the current month, which is empty:
     open `/dashboard/invoices?month=-1` in November 2026 and `?month=-2` in December (the list falls back to
     the previous month only in a month's first five days,
     `apps/web/app/dashboard/invoices/(register)/month.ts:11`, `:29`). The reference's day counts ("10 ימים")
     are reproduced only in a unit test that passes "now" (precedent:
     `packages/api/src/__tests__/invoice-state.test.ts:126-129`): every function that words a wait takes
     "now" as an argument and has one. In e2e the seed is dated from the day of the run: assert relations.
   - The lab runs no worker unless you pass `--stub`, so the shell shows the banner "העיבוד מתעכב."
     (`apps/web/lib/i18n/messages/nav/he.ts:133`); it is the lab's, not your screen's.
   - The demo seed attaches no file to any invoice and the lab's main server serves none: `WORKPLAN.md`,
     `INV-01`, "Seeing a document locally", says how a document is attached and where it can be looked at.
   - No real reading service, e-mail, WhatsApp or storage provider, no production database, no secret.
6. **Keep the gates green** (`AGENTS.md`, "Test / CI facts"; the workflow `.github/workflows/ci.yml` is the
   truth: it blocks on the test job, the worker tests, the web lint, build and type check, the worker image
   and the dependency audit; the e2e job reports and does not block).
   - **The suites need a migrated local database.** `bash docs/ux/wave2/lab.sh INV-0N` prepares it
     (`rm_<id>_test`) and writes its address to `~/.rm-lab/<id>/env`, where `<id>` is the package id in lower
     case with `_` for the hyphen (`~/.rm-lab/inv_00/env` for `INV-00`; `docs/ux/wave2/lab.sh:85-88`,
     `:258-273`). Load it in the shell that runs a suite: `. ~/.rm-lab/inv_00/env`. Run the full lab first,
     not `--tests-only` alone: the file also sets `LAB_DATABASE_URL`, and the lab-parity cases of
     `packages/api/src/__tests__/invoices-register.test.ts` (`:120-123`) and `invoice-state.test.ts`
     (`:128`, `:142`) read the seeded lab database, which `--tests-only` does not create. Tried on
     28.11.2026 at `main@de5cfcf7`: with no environment the web unit suite failed 18 of its 210 files with
     'database "restomatch_test" does not exist'; with the file loaded all 210 passed.
   - Server: `pnpm --filter @restomatch/db migrate`, then
     `pnpm turbo run test --concurrency=1 --filter='!@restomatch/worker'`. That is the CI's test job
     (`.github/workflows/ci.yml:120`); the worker's suite is a job of its own (`:171`), and no package of
     this batch touches `apps/worker`. A new tRPC procedure needs its line in a coverage fragment and its
     attack test in the same commit.
   - Web: `pnpm --filter @restomatch/web lint`, `typecheck`, `test`, `guards` and `build`. The copy guard and
     the he/en parity test run in the web unit suite; meet them, never loosen them.
   - e2e: one spec per screen package (`INV-00` has none), `apps/web/e2e/INV-0N.spec.ts`, with its own axe
     run (no serious or critical finding). All specs run against one database, one after another in file-name
     order, and
     `INV-0N.spec.ts` sorts before every `W1-*` and `W2-*` spec (`apps/web/playwright.config.ts:44-47`). A
     spec that decides, passes on, re-matches or counts creates its own tagged invoices with `e2eSql()` and
     removes them in `afterAll`, as `DS3-04.spec.ts` does on the desk's branch; it never decides a gap of the
     seeded demo. All sign-ins of the run share one budget of 30 per 15 minutes
     (`apps/web/e2e/helpers.ts:103-109`): sign in once per role and keep the state. `WORKPLAN.md`, "e2e
     specs", has the rule in full.
   - A spec that is not yours is edited only where your section of `WORKPLAN.md` lists it as a seam, and
     there only the assertions that read your screen, each named in the pull request with why it keeps its
     meaning. Every other spec stays as it is: keep what it reads, or write the assertion and the proposed
     change under "Requests to other packages". Shared helpers, seeds, configs, `a11y.spec.ts` and
     `smoke.spec.ts` are read-only.
   - The gates on a pull request: `test-sentinel` always; `tenant-security-warden` on `INV-00`, `INV-05` and
     `INV-06`; `money-format-marshal` wherever ₪ is rendered (`INV-00` too: its words module prints ₪ inside a
     phrase); `rtl-design-steward` for the look; `icp-keeper` for scope.
   - If a gate fails after your pull request is open you get at most two fix attempts; on the third failure
     stop and write what failed. A red run that matches a known flaky gate is re-run, not "fixed".
   - A gate that is red with none of your files involved, on `main` itself or from the merge of two bases, is
     written into the pull request with the failing line and the commit it ran on. Do not fix a file outside
     your boundary to make it green.
7. **Open one draft pull request when the package is complete and its local gates are green, and stop.** On
   a session's branch CI runs only once a pull request is open (`.github/workflows/ci.yml:33-36`), and the
   two fix attempts count from that moment. Title `ux(INV-NN): …`. Commits prefixed `ux(INV-NN):`,
   `test(INV-NN):`, `fix(INV-NN):`, `docs(INV-NN):`. Attribution: end a commit message and the pull request
   body with the lines your session's own instructions give, and add none of your own. When the pull request
   is stacked, its first line states the merge order. Body sections: What · Why · Write boundary (the boundary, then every seam, one file and
   one reason each) · Evidence (before and after screenshots at both widths, per role, from a production build
   of the lab, with the date of the run stated; the viewer's evidence from where a local file can be served,
   as `WORKPLAN.md`, `INV-01`, says; files under `apps/web/e2e/__screenshots__/INV-0N/`) · Tests (gate, result
   and the commit it ran on) · Owner decisions touched · Requests to other packages · Promote to shared · Not
   done. The body says in words: "no file of the immutability list changed". Then a short report to the owner
   in plain, gender-neutral Hebrew: what was built, the link, what is still open, what needs the owner's decision.

### Upstream and bases

The clean finish is not on `main` yet: DS3-00 (tokens, pull request 346) ← DS3-01 (shared components, 345) ←
DS3-04 (the approvals desk, 347, finished at `a6be4080`). A screen package needs it, so it is stacked.

| Package | What | Wave | Merges in first | Pull request base | Branch |
| --- | --- | --- | --- | --- | --- |
| `INV-00` | The server reads, and the words every screen shares | 1 | nothing | `main` | `claude/inv-00-server-reads` |
| `INV-01` | The invoice screen (reads only) | 1 | `claude/ds3-01-components`, `claude/inv-00-server-reads` | `claude/ds3-01-components` | `claude/inv-01-invoice-screen` |
| `INV-02` | The invoices list | 2 | the same two | `claude/ds3-01-components` | `claude/inv-02-invoices-list` |
| `INV-03` | The pay run | 2 | the same two | `claude/ds3-01-components` | `claude/inv-03-pay-run` |
| `INV-04` | Approvals by role, and the decision a second screen can mount | 2 | `claude/ds3-04-approvals-desk`, `claude/inv-00-server-reads` | `claude/ds3-04-approvals-desk` | `claude/inv-04-approvals-by-role` |
| `INV-05` | Deciding from the invoice screen | 3 | `claude/inv-04-approvals-by-role`, `claude/inv-01-invoice-screen` | `claude/inv-04-approvals-by-role` | `claude/inv-05-decide-on-invoice` |
| `INV-06` | Optional, not opened unless the owner asks: a PDF in the same viewer | 3 | `claude/inv-01-invoice-screen` | `claude/inv-01-invoice-screen` | `claude/inv-06-pdf-viewer` |

- Every session starts from current `main` with its own branch, then `git fetch origin <branch>` and merges
  its upstream branches itself. The pull request's base is the upstream branch it merged in (a stacked pull
  request, as the DS3 batch did). No `INV` session pushes to a DS3 branch, and nobody merges `main` into one
  for this batch: until pull requests 346 and 345 are merged, the diff of a stacked pull request also shows
  what `main` gained since `9dc0b934`, and its first line says so (`WORKPLAN.md`, S10).
- The order of opening. `INV-00` opens first, alone, and pushes its contract first (its slice 0: the three
  new procedures and the new fields registered with their final types and empty answers, the types module,
  the signatures of the words, places and state modules, the empty message sub-files and the role words).
  The lead opens `INV-01` and `INV-04` once that commit is on `claude/inv-00-server-reads`, so that the
  screens compile against its branch from their first hour; `INV-04` is in wave 2 and is opened with
  `INV-01` on purpose (`WORKPLAN.md`, "The waves"). `INV-02` and `INV-03` open when `INV-00` has pushed the
  reads they need (their sections name them).
- The three message sub-files (`messages/invoices/screen.ts`, `list.ts`, `decide.ts`) are created by `INV-00`
  and by nobody else: if your base does not hold yours yet, fetch and merge `claude/inv-00-server-reads`
  before your first string, and never create the file or edit `messages/invoices/index.ts`. Merge `INV-00`
  again before you finish and look at your screen with the real values.
- `INV-05` changes one file of the invoice screen, `gap-actions.tsx`, so `INV-01` builds that component's
  whole interface in wave 1 (`WORKPLAN.md`, S7).
- `INV-05` opens when slice 1 of `INV-04` is pushed and `INV-01`'s branch has the gap card and
  `gap-actions.tsx` with the interface of S7. `INV-06` is not opened.
- **The pushes another session is opened on.** There are five: `INV-00`'s contract, its slice 4 and its
  slice 5; `INV-04`'s slice 1; `INV-01`'s gap card with `gap-actions.tsx`. Each is a commit whose subject
  carries the slice: `ux(INV-00): contract (slice 0)`, `ux(INV-00): slice 4 …`, `ux(INV-00): slice 5 …`,
  `ux(INV-04): slice 1, the exported decision`, `ux(INV-01): gap card and gap-actions (S7)`. After the push,
  say it in one line in the session, with the commit: the lead reads the session and opens the next one.
- **Never rebase, amend or force-push a commit you have pushed.** Other sessions merge your branch, and
  `check-partition.cjs --changed` reads their commits against it: a rewritten upstream turns its old
  commits into the downstream session's own. When `main` moves, merge it.
- The order in which a person merges: 346, 345, `INV-00` (at any time; it depends on nothing in DS3), then
  `INV-01`, `INV-02` and `INV-03` in any order, then 347, `INV-04`, `INV-05`.
- What breaks if a screen package starts without the clean finish: it does not compile once it imports the
  DS3 components or the preferences store, and where it compiles it draws the old finish, so its screenshots
  and its copy, density and accessibility measurements would have to be redone.

### Where this folder lives until it is merged

Branch `claude/admiring-faraday-3oxulo` (a docs-only draft pull request). From a checkout of `main`:

```bash
git fetch origin claude/admiring-faraday-3oxulo
```

```bash
git worktree add ../inv-handoff origin/claude/admiring-faraday-3oxulo
```

Then read `../inv-handoff/docs/ux/inv/` (and `../inv-handoff/docs/ux/ds3/` for the look). Do not copy the
folder into your own branch.

**That worktree holds old code.** It is the docs branch, which left `main` at `9dc0b934` on 14.11.2026, 300
commits before `de5cfcf7`. Outside `docs/ux/` it is an old copy of the product with the same relative paths
as your checkout, and an older `AGENTS.md` (its immutability list lacks `packages/charts/src/leak-views.ts`).
It has no `approvals/summaryRefresh.ts` and no `[invoiceId]/allocation-field.tsx`. Read only `docs/ux/inv/`
and `docs/ux/ds3/` there. Read code, `AGENTS.md` and `STATE.md` in your own checkout only, and give every
subagent the two roots by name.

The branch moves when the handoff is corrected; to refresh:

```bash
git -C ../inv-handoff fetch origin claude/admiring-faraday-3oxulo && git -C ../inv-handoff checkout --detach origin/claude/admiring-faraday-3oxulo
```

Refresh before your first slice, each time you fetch an upstream branch, and before you open the pull
request. Then read `CHANGES.md` in this folder: it lists every correction made after the sessions started,
newest first, and an entry that names your package tells you which sections to read again. Until the first
such correction the file does not exist.

### Using the reference and its checks

Open `../inv-handoff/docs/ux/inv/reference/reference.html` in a browser. The page's anchors are `#register`,
`#invoice`, `#approvals` and `#payrun`; the switch "להציג כמו" above each mock-up changes all four together.
On the invoice screen set the switch "המסמך" to "בלי סימון" or "בלי קובץ": "עם סימון" is step two and is not
built. The mock-ups show the demo day, 25.10.2026.

```bash
cd ../inv-handoff/docs/ux/inv/reference/checks && node check.cjs 1440
```

That drives the four mock-ups end to end in a headless browser and reports what passed. `check.cjs`,
`verify10.cjs` and `verify11.cjs` also take `390`; `reference/checks/README.md` lists what each script checks
and its result on Version 6. The scripts need Playwright with a Chromium it can launch, and write their working
copies to an `out` folder beside them, which the repository ignores. They test the **mock-ups**, not the
product: read them for the behaviour that is expected, and remember that a passing check does not override
`KNOWN-ISSUES.md`. The reference loads its typefaces from Google Fonts; without network access it falls back to
a system font and widths shift a little.

To check that the partition still holds on your checkout:

```bash
node ../inv-handoff/docs/ux/inv/check-partition.cjs "$PWD"
```

That checks the plan against a tree, whatever you changed. Before you open the pull request, check your own
commits as well (fetch `origin/main` and your upstream branches first):

```bash
node ../inv-handoff/docs/ux/inv/check-partition.cjs "$PWD" --changed INV-0N
```

It lists the files of the commits that are on your branch and on none of `origin/main` and your upstream
branches, and fails on a file that is neither yours nor one of your seams, and on an immutable file. A stacked
pull request's diff also holds its upstreams' files, so the list cannot be read off the pull request. Merge
commits are left out: a conflict you resolved inside a merge is not listed, so name it by hand. A seam file
that passes is still only the edit its text names.
