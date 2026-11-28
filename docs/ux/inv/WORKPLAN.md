# INV · work plan

One package, one coding session, one branch, one draft pull request. The partition below is drawn so that two
packages never write the same file. `README.md` in this folder has the rules and the way of working;
`SPEC.md` says what each screen looks like and does; `KNOWN-ISSUES.md` says where the mock-ups are looser than
the product's rules or the code; `OPEN-PRS.md` lists the open pull requests inside each boundary.

`packages.json` beside this file is the same partition for a machine: ids, waves, branches, bases, globs,
seams, the files given to nobody, the immutable list. `check-partition.cjs` checks it against a checkout. If
this file and `packages.json` ever differ on an id, a branch, a base or a path, report the difference in your
pull request; do not pick one.

Paths are relative to the repository root. A file and line is from `main` at `9dd26ef9` (28.11.2026) unless it
is marked "DS3-04:", which means the finished desk branch `claude/ds3-04-approvals-desk` at `be22850e`. Lines
move; the names beside them do not. Three things behind this plan were run: the partition check, a type check
of the two merged bases (S10) and a trial of the empty message groups (S3). Everything else is read from the
code.

## The batch (opened 28.11.2026)

| Package | What | Wave | Branch | Session starts from · merges in first | Pull request base |
| --- | --- | --- | --- | --- | --- |
| `INV-00` | The server reads, and the words every screen shares | 1 | `claude/inv-00-server-reads` | `main` · nothing | `main` |
| `INV-01` | The invoice screen: the document beside the data (reads only; the button still opens the desk) | 1 | `claude/inv-01-invoice-screen` | `main` · `claude/ds3-01-components`, `claude/inv-00-server-reads` | `claude/ds3-01-components` |
| `INV-02` | The invoices list | 2 | `claude/inv-02-invoices-list` | `main` · `claude/ds3-01-components`, `claude/inv-00-server-reads` | `claude/ds3-01-components` |
| `INV-03` | The pay run | 2 | `claude/inv-03-pay-run` | `main` · `claude/ds3-01-components`, `claude/inv-00-server-reads` | `claude/ds3-01-components` |
| `INV-04` | Approvals by role, and the decision a second screen can mount | 2 | `claude/inv-04-approvals-by-role` | `main` · `claude/ds3-04-approvals-desk`, `claude/inv-00-server-reads` | `claude/ds3-04-approvals-desk` |
| `INV-05` | Deciding from the invoice screen | 3 | `claude/inv-05-decide-on-invoice` | `main` · `claude/inv-04-approvals-by-role`, `claude/inv-01-invoice-screen` | `claude/inv-04-approvals-by-role` |
| `INV-06` | Optional: a PDF in the same viewer (opened only if the owner asks and a person can do the storage check) | 3, not opened by default | `claude/inv-06-pdf-viewer` | `main` · `claude/inv-01-invoice-screen` | `claude/inv-01-invoice-screen` |

Owning agent of every package (`AGENTS.md`, "Ownership map"): `web-feature-engineer`. One seam lies outside
that agent's paths, `packages/db/scripts/pilot-setup.ts`; `INV-05`'s section says why it is edited. Gates, as
`packages.json` lists them: `test-sentinel` and `icp-keeper` on every package; `tenant-security-warden` on
`INV-00` (routers), `INV-05` (a second screen that sends money decisions) and `INV-06` (a supplier's file
parsed in the product's own origin); `money-format-marshal` on `INV-00` (its words module prints ₪ inside a
phrase) and on `INV-01` to `INV-05`; `rtl-design-steward` on `INV-01` to `INV-06`.

### The waves

- **Wave 1: `INV-00`, then `INV-01`.** `INV-00` pushes its contract first (its slice 0: the types, the
  shapes, the S3 commit and the role words). The lead opens `INV-01` once that commit is on
  `claude/inv-00-server-reads`, so that `INV-01` compiles against the branch from its first hour. `INV-01`
  never creates `apps/web/lib/i18n/messages/invoices/screen.ts` and never edits
  `apps/web/lib/i18n/messages/invoices/index.ts`; its section says what it does if it was opened before the
  commit exists.
- **Wave 2: `INV-02`, `INV-03`, `INV-04`.** The lead opens it. What the code needs is that `INV-00` has pushed
  its contract. `INV-04` sits on DS3-04, which is finished (`be22850e`, 28.11.2026 08:26 UTC). Its slices 0
  and 1 need nothing from `INV-00`, and its slice 2 needs only the role words of the contract commit; the lead
  may open it with wave 1, which brings `INV-05` forward.
- **Wave 3: `INV-05`** opens when slice 1 of `INV-04` is pushed and `INV-01`'s branch has the gap card and
  `gap-actions.tsx` with the interface S7 fixes. **`INV-06`** is not opened unless the owner asks for it and
  a person can do its third check.

**One change against the plan the owner was told.** The owner was told two waves: the server reads and the
invoice screen, then the list, the pay run and approvals by role. That stands. One part moves: the decision
itself on the invoice screen (decision 2) is its own package, `INV-05`, after approvals by role. The reason is
in the code. On `main` the desk's decisions, reasons and undo are inside one client file of 1,626 lines
(`apps/web/app/dashboard/approvals/list.tsx`: `UNDO_MS` at `:72`, the six mutations at `:163-168`); a second
screen cannot mount it, and a copy would be a second implementation of a money decision. On the finished desk
they are separate files, but the controller is a queue controller: it reads `approvals.myQueue` with no
`scope`, so only the viewer's own queue (DS3-04: `use-desk.ts:274`, `:411`; `page.tsx:68`), it writes `?sel=`
on the page that mounts it (DS3-04: `use-desk.ts:141-144`), and the bar has no read-only form (DS3-04:
`decision-bar.tsx:48`). Those gaps are what approvals by role builds. Until `INV-05` lands, the invoice screen
keeps what it has today: one button that opens the desk on this invoice
(`apps/web/app/dashboard/invoices/[invoiceId]/cockpit.tsx:415-417`, test id `cockpit-decide`).

### Where each decision of 28.11.2026 is built

| Decision | Where |
| --- | --- |
| 1 · the four screens | `INV-01` (invoice screen), `INV-02` (list), `INV-04` (approvals by role), `INV-03` (pay run) |
| 2 · decide from the invoice screen, same actions and same undo | `INV-04` slice 1 (the decision as something a second screen mounts), `INV-05` (the mount) |
| 3 · the owner decides a gap that waits for the manager | Nothing on the server: the owner may already (`packages/api/src/lib/roles.ts:41-48`, `packages/api/src/routers/approvals.ts:1246`). On the desk: `INV-04`. On the invoice screen: `INV-05`. In the history: `INV-00` |
| 4 · roles, not names | `INV-00` (the new history read returns no name and no user id), `INV-04` (the desk's history line and "כבר הוחלט") |
| 5 · "שולמו" hidden, "חסר מספר הקצאה" exact | `INV-00` (the field and the count), `INV-02` (the cards) |
| 6 · any open gap holds the invoice | No change: it is so today (`packages/api/src/routers/payRun.ts:197-204`). `INV-03` says it in words |
| 7 · step one: the document beside the data, and "חפשו במסמך" | `INV-01`. Step two is not in this batch |
| Small: no colour for an old gap | Nobody adds one |
| Small: the percent base stated on the settings screen | In no boundary: the settings screen is DS3-06's (pull request 353). `INV-04` states the base in the card "מי מחליט על מה". The sentence on the settings screen is a request to DS3-06, sent by the lead when wave 2 opens, with the card's own sentence: "הסכומים לפני מע״מ, והאחוז מסכום החשבונית כולל מע״מ." If 353 merges without it, one follow-up pull request adds it (`README.md`, "Needs a human change") |
| Kept | "בקשת זיכוי · ₪amount" (`INV-04`, `INV-05`), the solid pill "חוסם תשלום" and the tinted row (`INV-01`, `INV-02`, `INV-04`) |

### Rules of the partition

`AGENTS.md` binds every package, and so do the rules of `README.md`. On top of them:

- **A package owns what `packages.json` lists under its `owns`, minus its `reserved`, and nothing else.** A
  screen package owns its route folder, its message file and its e2e spec. Each package section below repeats
  the lists.
- **Seams are the only edits outside a boundary.** Each is one small, named change, listed per package and in
  `packages.json`, and called out in the pull request under "Write boundary" with the file and the reason. A
  need that is not a listed seam is written under "Requests to other packages" and left.
- **The immutability list is never inside a boundary and never a seam** (`AGENTS.md`, "Immutability list";
  `packages.json`, `immutable`): the matching package, `packages/api/src/approvals/engine.ts`, the schema and
  the migrations, row security, `packages/charts/src/leak-views.ts`, the outbox and the cron, the leads
  router, the trpc route handler, billing, the money format layer, `cross-tenant.attack.test.ts` and
  `rls.attack.test.ts`, `.github/workflows/*`, `.claude/agents/*`, `AGENTS.md`, `OPERATING.md`. A package that
  needs one changed writes the proposal into its pull request and leaves that slice out. It is then listed as
  "needs a human change"; it is never improvised.
- **No schema change and no migration.** "מידע חדש מהשרת" means new read fields and read procedures on
  `packages/api/src/routers/invoices.ts` and `packages/api/src/routers/approvals.ts`, all in `INV-00`. No
  package changes `approve`, `reject`, `decideMany`, `escalate`, `reopen`, `reopenMany`, `decide()`,
  `reopenOne()`, `assertCanAct()`, `claimsByRow()`, `REOPEN_WINDOW_MS` or `packages/api/src/lib/roles.ts`.
- **Router files have one writer in this batch: `INV-00`.** A screen that needs one more field asks for it in
  its pull request under "Requests to other packages". Every router change brings the tenant-security gate; a
  new procedure comes with its line in the coverage fragment and its attack case in the same commit.
- **`packages/api/src/routers/payRun.ts` has no writer in this batch.** Decision 6 needs no change there, and
  pull requests 369, 374, 190 and 380 are open on it. What the pay run screen lacks comes from a new read in
  `routers/invoices.ts`.
- **One decision.** The actions, the reasons, the undo and their timing exist once, in the approvals folder.
  `INV-05` mounts them and copies none. A decision from the invoice screen calls the same procedure with the
  same input as the desk. Who may decide what is answered by the server and by `canAct` on the queue row
  (`packages/api/src/routers/approvals.ts:344`); no screen works it out again.
- **Facts and words come from `INV-00`.** A screen does not compute who holds an invoice, since when, why,
  whether it can be paid, or which place it is in, and does not write its own role words or rule phrases. The
  copy guard fails the same text in two keys (`apps/web/lib/copy/guard.ts:86-97`), so a rule's phrase cannot
  be written once per screen.
- **Messages and languages.** Hebrew and English in the same commit, for every key. The areas of this batch
  (`invoices`, `payRun`, `approvals`) have no receiver-language overlays, so nothing is needed in ar, ru, th
  or ti; no string of the batch is added to an area receivers see. No new message area
  (`apps/web/lib/i18n/messages/index.ts` is nobody's). The `invoices` area gets four sub-files, each holding
  both languages, composed once (seam S3). In `messages/approvals` the groups `types`, `severity`,
  `resolution`, `decision`, `rules` and `tolerance` and the exports of
  `apps/web/app/dashboard/approvals/vocab.ts` keep their keys: about twenty files outside the area read them
  (21 on `main@9dd26ef9`, test files aside), among them the invoice screen
  (`apps/web/app/dashboard/invoices/[invoiceId]/page.tsx:18`, `:175-177`). Role words are "בעלים", "ניהול",
  "הנהלת חשבונות", taken from the message files, never from `apps/web/lib/roles.ts`. The copy guard and the
  allow-list stay as they are: meet them, do not loosen them.
- **Shared guard files** (`apps/web/lib/copy/screens.ts`, `apps/web/e2e/ia/screens.ts`,
  `apps/web/lib/copy/budget.allow.ts`): a package edits only its own screen's row, downwards, or adds the row
  of its screen; in the allow-list it only deletes its own area's stale lines and never adds one. Nobody
  changes the `adopter` of a row it lowers in `apps/web/e2e/ia/screens.ts`.
  - **The invoice screen has no row in `apps/web/lib/copy/screens.ts` and gets none.** The spec that reads
    that file opens each row's route as written (`apps/web/e2e/W2-16.spec.ts:105`), and no row carries an id.
    `INV-01` measures the screen's copy in its own spec; `INV-05` measures it again with the decision mounted
    and states the numbers before and after. `INV-05` also measures the row `invoice-owner-desk` of
    `apps/web/e2e/ia/screens.ts` again, once: that is the one planned second measurement of a row.
  - **In `budget.allow.ts` the `invoices:` lines are one block** (`:79-115`): `correction.*` (`:79-97`) and
    `status.clean` (`:115`) are `INV-01`'s; `needsLines.subtitle` (`:114`) is `INV-02`'s; the lines
    `needsLines.held.*` (`:98-113`) stay, because their strings are frozen (S3). There is no `cockpit.*` and no
    `register.*` line. Deletions on the two sides of a border conflict as text: whoever lands second takes
    both. Nobody edits the count in a `// ── W2-0N (n) ──` header, and nobody runs
    `pnpm --filter @restomatch/web copy:baseline`, which rewrites the whole file
    (`apps/web/lib/copy/__tests__/copy-budget.test.ts:114-117`). A stale line only warns
    (`apps/web/lib/copy/guard.ts:101-108`).
  - **A new row has a fixed place**, so that two pull requests never add at the same line: `INV-02`'s row in
    `apps/web/lib/copy/screens.ts` goes directly after the `suppliers` row (`:66`); its two entries in
    `apps/web/e2e/ia/screens.ts` are placed in its section.
  - **When a screen measures above its row.** If the approved screen measures above its row, or over a budget
    that has no allowance today, do not raise or add a number: leave the row, state the measured numbers in
    the pull request under "Owner decisions touched", and name the red line of the budget spec there.
    `apps/web/e2e/IA-01.spec.ts` only reports (`:14-17`); `apps/web/e2e/W2-16.spec.ts` fails a screen that
    grew (`:131-132`).
- **Shared components are read-only**: `apps/web/lib/components/**` outside `invoice/` and `desk/`, the
  tokens, `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/lib/prefs/**`,
  `apps/web/lib/nav/**`, `apps/web/lib/hotkeys.ts`. Something missing is built inside the package's boundary
  and listed under "Promote to shared". `INV-04` may add exports to `apps/web/lib/components/desk/index.ts`
  and removes or renames none in this batch (`cockpit.tsx:17` imports `isTypingTarget` and `useMediaQuery`
  from it). It also does not change what the existing exports of `apps/web/lib/components/desk` do
  (`deskKeyOf`, `moveIndex`, `isTypingTarget`, `Peek`, `SplitPane`, `useMediaQuery`): shared code reads their
  behaviour (`apps/web/lib/components/table/DataTable.tsx:10-12`, `apps/web/lib/hotkeys.ts:17`,
  `apps/web/lib/components/notifications/Bell.tsx:10`, `apps/web/app/dashboard/recovery/claim-peek.tsx:9`). A
  new key or a new behaviour is a new export. The promotion DS3-04 asked of DS3-01 (`UndoToast` with
  `undoTimer`, `MatchTable`, `useActionBarHeight`, the rich-message `Template`) is not done in this batch:
  the files stay in `apps/web/lib/components/desk/` and `apps/web/app/dashboard/approvals/rich-message.tsx`,
  and `INV-05` reaches them only through `gap-decision/index.ts` (S9). The personal preferences are read
  through the store (`usePrefs()`, `singleKeysEnabled()`), never a raw key.
- **No new page, so no nav registry line.** The four screens are routes that exist.
- **e2e specs.** One spec per screen package, `apps/web/e2e/INV-0N.spec.ts` (and `INV-0N-*.spec.ts` where
  `packages.json` lists it), with its own axe run; `INV-00` has none. Evidence screenshots go to
  `apps/web/e2e/__screenshots__/INV-0N/`.
  - **One database, one run.** The suite is one database, seeded once, and one run in file-name order
    (`apps/web/playwright.config.ts:44-47`; `apps/web/e2e/run-sharded.mjs:18-21`): `INV-0N.spec.ts` runs
    after the `AU-*`, `DS3-*`, `G-*` and `IA-*` specs and before every `W*` spec, `demo-path`, `pilot*` and
    `smoke`. A spec creates the rows it decides, passes on, re-matches or counts, under its own tag (invoice
    numbers `INV0N-*`, `rule_id` `'e2e-INV-0N'`), with `e2eSql()`, and removes them in `afterAll`, as the
    desk's spec does (DS3-04: `apps/web/e2e/DS3-04.spec.ts:8-12`, `:34`, `:52-69`). It never decides, passes
    on or reopens a gap of the seeded demo.
  - **Sign-ins share one budget** of 30 per 15 minutes for the whole run (`apps/web/e2e/helpers.ts:103-109`):
    sign in once per role and keep the state (`apps/web/e2e/W2-03.spec.ts:22-36`).
  - **Days and sums.** The e2e seed dates everything from the day of the run, and the server runs on the real
    clock, so a spec asserts a number of days or a month's total as a relation, never as a literal. "10 ימים"
    and the reference's other day counts are reproduced only in a unit test that passes "now" (precedent:
    `packages/api/src/__tests__/invoice-state.test.ts:126-129`). Every function that words a wait takes "now"
    as an argument. The local lab does not pin the server's clock either (`README.md`, step 5).
  - **Other packages' specs.** Shared helpers, seeds and configs, `apps/web/e2e/a11y.spec.ts` and
    `apps/web/e2e/smoke.spec.ts` are read-only. A spec that is not the package's is edited only where the
    package's section lists it as a seam, and there only the assertions that read the package's screen, each
    named in the pull request with why it keeps its meaning. Every other spec stays as it is: the package
    keeps what the spec reads, or writes the assertion and the proposed change under "Requests to other
    packages".
- **Bases and stacking.** A session is created from `main` with its outcome branch and merges its upstream
  branches itself, in the order of the table above. Its pull request's base is the first branch it merged in
  (`main` for `INV-00`). The first line of a stacked pull request states the merge order and what the diff
  also shows until its upstreams are in the base (S10). No `INV` session pushes to a branch that is not its
  own, a DS3 branch included.
- **When an upstream merges.** The order in which a person merges: 346, 345, `INV-00` (at any time), then
  `INV-01`, `INV-02`, `INV-03` in any order, 347, `INV-04`, `INV-05`. When a base branch is merged and
  deleted, GitHub retargets the pull requests stacked on it to `main` (otherwise the base is changed by hand);
  the `INV` session then merges `main` once more, looks at its screen again, and its diff shows `INV-00`'s
  files and its own, and its own alone once `INV-00` is in. If DS3 is not merged, `INV-00` can still be
  merged; a screen package stays a draft stacked on the components branch, and nobody merges it into that
  branch (it would put invoices work into the components pull request). `INV-04` and `INV-05` stay stacked on
  347.
- **Start from current main.** `main` moved 135 commits past the snapshot the area was mapped on. Inside the
  boundaries it added `[invoiceId]/allocation-field.tsx` (pull request 306; a file that nothing mounts yet),
  "לא נספר" in `cockpit.tsx` and `routers/invoices.ts` (371), `approvals/summaryRefresh.ts` and a changed
  `approvals/list.tsx` (360), a line in `pay-run/selection.tsx` and `messages/payRun` (355). A session that
  starts from an older commit merges `main` before its first slice. `main` kept moving while this folder was
  corrected: at `de5cfcf7` (28.11.2026, 10:18 UTC) it also holds pull request 341, which mounts the allocation
  field in `[invoiceId]/page.tsx` and adds the spec `apps/web/e2e/AU-08-cockpit.spec.ts`, and pull request
  364, the re-match when a draft order is sent. The partition check passes on that commit too.
- **Nothing of step two**: no stored position, no mark, no link between a row and a place on the document,
  and never the mock-up's state "עם סימון".
- **Files given to nobody** (`packages.json`, `nobody`): among them `routers/payRun.ts`,
  `packages/api/src/invoices/state.ts`, `packages/api/src/lib/{roles,claims,dueDate,features}.ts`,
  `packages/api/src/{approvals,match,vat,lifecycle}/**`, `packages/db/**`, `packages/ocr/**`,
  `apps/web/lib/supabase/**`, `apps/web/lib/securityHeaders.ts`, `apps/web/lib/copy/**`, `apps/web/e2e/ia/**`,
  `apps/web/app/dashboard/settings/**`, `apps/web/app/dashboard/inbox/**`, `apps/web/app/scans/**`; the
  package root `packages/api/src/index.ts`; the e2e plumbing (`apps/web/e2e/helpers.ts`, which holds
  `e2eSql()` and the sign-in helpers, `apps/web/e2e/helpers/**`, `apps/web/e2e/prepare-db.ts`,
  `apps/web/e2e/seededMonth.ts`, `apps/web/e2e/run-sharded.mjs`, `apps/web/playwright.config.ts`,
  `apps/web/e2e/invariants/**`, `apps/web/e2e/i18n-sweep.spec.ts`); the readers of the guard files
  (`apps/web/e2e/W2-16.spec.ts`, `apps/web/e2e/IA-01.spec.ts`, `apps/web/test/**`); and DS3-04's
  `packages/api/src/__tests__/approvals-queue-fields.test.ts`. A need there is a request, unless a seam of
  yours names the file.
- **The mechanical check.** `node ../inv-handoff/docs/ux/inv/check-partition.cjs "$PWD"` (the handoff
  worktree of `README.md`) fails when a file is owned twice, a glob is dead, an immutable file or a file given
  to nobody is in a boundary, a seam's owner is wrong, a base is not the first branch merged in, or a
  dependency is not merged in. That checks the plan against a tree. **Before you open the pull request, check
  your own commits too:**
  `node ../inv-handoff/docs/ux/inv/check-partition.cjs "$PWD" --changed INV-0N`. It lists the files of the
  commits that are on your branch and on none of `origin/main` and your upstream branches (fetch them first),
  and fails on a file that is neither yours nor one of your seams, and on an immutable file. A stacked pull
  request's diff also holds its upstreams' files, so the list cannot be read off the pull request. Merge
  commits are left out: a conflict you resolved inside a merge is not listed, so name it by hand.

### Shared files: one owner each, and the seam

**S1 · `packages/api/src/routers/approvals.ts`.** Owner: `INV-00`, reads only. DS3-04 (pull request 347, not on
`main`) holds ten changed lines in the same file: four select fields of `myQueue`, added after `:278`, `:292`
and `:294`, and the first line of the returned object at `:341`. The two merge without a conflict today.
`INV-00` adds no select field to `myQueue`: its two row facts
(`reason`, `passedOn`) are loaded by its own helper from the row ids and added after `waitingOn` (`:346`),
five lines below DS3-04's changed line. Its summary fields go into the return of `computeQueueSummary`
(`:1301-1315`). Its new procedure goes after `history` (`:606-634`). It leaves `claimsByRow` (`:1167`,
rewritten by pull request 369) alone. Whoever lands second has at most a mechanical merge.

**S2 · the shared words.** New folder `apps/web/lib/invoices/**` and new file
`apps/web/lib/i18n/messages/invoices/gap.ts`, both `INV-00`'s. Pure functions, no component, no DS3 import.
All four screens and `INV-05` import them; none edits them. A missing phrase is a request to `INV-00`.

**S3 · `apps/web/lib/i18n/messages/invoices/`.** The pattern is the `components` area's:
`apps/web/lib/i18n/messages/components/index.ts:12` composes `he.ts` with `ds.ts`, and `ds.ts:8` holds both
languages (`dsHe`, `dsEn`) under one group key.
- `index.ts`: owner `INV-00`. In its first commit it composes four new groups: `gap` (its own file
  `gap.ts`), `screen` (`screen.ts`), `list` (`list.ts`), `decide` (`decide.ts`). It creates the last three
  with an empty Hebrew and an empty English object (`screenHe`, `screenEn`; `listHe`, `listEn`; `decideHe`,
  `decideEn`) and never opens them again. Nobody edits `index.ts` after that commit. Empty groups composed
  this way pass the type check, the parity test, the copy budget and the copy gate (tried on
  `main@9dd26ef9`, 28.11.2026).
- `screen.ts`: owner `INV-01`. `list.ts`: owner `INV-02`. `decide.ts`: owner `INV-05`. Each is created by
  `INV-00` and by nobody else: an owner whose base does not hold the file yet fetches and merges
  `claude/inv-00-server-reads` before its first string, and never creates the file itself.
- `he.ts`, `en.ts` (the existing keys): owner `INV-01`, which edits the groups `cockpit`, `correction` and
  `status` (`he.ts:174`, `:6`, `:73`). Seam for `INV-02`: the group `register` (`he.ts:121`), and in the group
  `needsLines` (`he.ts:79`) every key except `heldTitle`, `heldTitleReadOnly`, `supplierDetails` and `held.*`;
  there it deletes or changes a string, and its new strings go to `list.ts`.
- **Frozen for every package, key and text:**
  - the group `state` (`he.ts:163-173`, the nine state words). A state word that must change is a request to
    the lead; if the lead lifts the freeze, the edit is `INV-01`'s, the owner of the two files.
    `apps/web/lib/invoices/state.ts` reads the key and holds no word;
  - the key `cockpit.backToInvoice` (read by `apps/web/app/scans/[invoiceId]/page.tsx:63`);
  - in `needsLines`: `heldTitle`, `heldTitleReadOnly`, `supplierDetails` (`he.ts:112-114`) and `held.*`
    (`he.ts:92-111`). The invoice screen draws them (`[invoiceId]/page.tsx:213`, `:217`, `:228`) and the list
    draws `held.*` too (`(register)/page.tsx:116`); their Hebrew is pinned by
    `apps/web/e2e/pilot-unread-invoices.spec.ts:102`, `:106-107`, `:117` and by
    `apps/web/app/dashboard/invoices/__tests__/hold-reasons.test.ts:34-36`. The keys are type-checked
    (`apps/web/lib/i18n/translate.ts:38`), so a deleted key fails the type check of the other package's
    screen once both are merged. `heldTitleReadOnly` keeps "הבעלים או המנהל" in this batch although "המנהל"
    is a retired role word (`KNOWN-ISSUES.md`, the invoice screen); a new sentence for the payment block
    goes to `screen.ts`;
  - the text of `needsLines.reason.ocr_failed` ("הקריאה נכשלה", pinned at `:57` of the same spec).

**S4 · the place of an invoice, and stepping between invoices.** `[` and `]` on the invoice screen walk the
rows of `invoices.list` (`[invoiceId]/cockpit.tsx:125-140`, reading `rows[].tab`, `hasAllocation`, `state`).
Three parts, one owner each:
- the rows: `INV-00` keeps `tab`, `hasAllocation`, `state` and `counts` as they are and adds `place` per row;
- the places, their order and the list the keys walk: `apps/web/lib/invoices/places.ts` (`INV-00`), one module
  used by the list and by the invoice screen;
- the address: `from` (five origins, `[invoiceId]/page.tsx:44`), `month`, and **one** parameter `view`. `view`
  takes a place id or one of today's tab ids (`review`, `lines`, `awaiting`, `matched`, `held`, `paid`,
  `noAllocation`, `intake`); the module resolves an old id to the places it covered. `INV-01` owns the reader
  on the invoice screen and builds it in wave 1; `INV-02` writes place ids on its links in wave 2. The old
  values keep working on the list too, so `apps/web/app/dashboard/close/steps.ts:77` (`view=awaiting`) and
  `packages/api/src/tasks/sources/index.ts:277` (`view=lines`) need no edit.

**S5 · `apps/web/app/dashboard/invoices/(register)/columns.tsx`.** Owner `INV-02`. `INV-01` removes its
import of `STATE_TONE`, `ddmmyyyy` and `InvoiceStateKey` (`cockpit.tsx:20`) and takes the state's tone and the
date from `apps/web/lib/invoices/`. `INV-02` keeps the three exports for the whole batch: its base does not
hold `INV-01`'s change.

**S6 · `apps/web/e2e/W2-02.spec.ts`.** One serial file (`:20`): three list tests (`:118`, `:223`, `:316`),
three invoice-screen tests (`:150`, `:171`, `:190`), two inbox tests (`:245`, `:281`), one chef test (`:304`).
Owner `INV-01`, the first package that changes it on purpose. `INV-02` may change only the three tests whose
title starts with "register"; `INV-05` only the `cockpit-decide` assertions inside the test at `:150`. Nobody
changes the helpers at `:1-117`, the inbox tests or the chef test.

**S7 · `apps/web/app/dashboard/invoices/[invoiceId]/gap-actions.tsx`** (new). Owner `INV-01`: one small
client component, mounted for each gap of the screen in each of its four places: the card, the phone's dock,
the foot of the whole-screen dialog, and the button of the pinned amount bar. In `INV-01` it renders the
button "להחלטה" (to the desk, S8) for a role that may decide. For a role that may not, it renders the full
sentence "ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם." (with the role's word) in the card and the short form
"ההחלטה אצל הבעלים." at the foot of the whole-screen dialog; the phone's dock is absent for that role. In the
pinned bar it renders, in `INV-01`, the quiet button "לפרטי הפער" for every role, which takes the pane to its
top (`SPEC.md` §2.2, §4.4, §4.5).

**Its interface is fixed in wave 1, because it is the only file of the screen `INV-05` changes.** A
restaurant's features are read on the server only (`apps/web/lib/ingest/features.ts:1`, read at
`[invoiceId]/page.tsx:89`), and this is a client component inside the client `Cockpit`
(`[invoiceId]/cockpit.tsx:1`), so everything `INV-05` needs reaches it as props. `INV-01` builds these, under
these names, and threads them from `[invoiceId]/page.tsx` through `Cockpit` to every mount:

| Prop | What it carries |
| --- | --- |
| `gap` | The gap's row of `approvals.myQueue({ scope: 'all', invoiceIds })`, or `null` once the gap is decided |
| `decided` | The decided finding's result from `invoices.detail`, or `null` while the gap is open |
| `slot` | `'card'`, `'dock'`, `'dialog'` or `'bar'` (the button of the pinned amount bar) |
| `features` | The array `enabledFeatures()` returns at `[invoiceId]/page.tsx:89`, passed down as plain strings |
| `screen` | `{ closeDialog(), toTop(), refresh(), holdStep(on) }`: close the whole-screen dialog; take the data pane to its top and put the focus on a control in sight; read the card, the history and the payment block again; hold and release the stepping between invoices |

`INV-01` mounts the component for every gap of the screen, a decided one included (in the card, the dock and
the dialog it renders nothing there in `INV-01`), keeps one empty, named place for a message above the
phone's dock, and makes its `[` / `]` handler and its previous and next buttons do nothing while
`holdStep(true)` is in force. `INV-01` passes all five props and itself reads only `gap`, `decided` and
`slot`.

Seam for `INV-05`: one import and one branch in that file. The branch mounts, from `[invoiceId]/decide/`, the
decision in place of the button, the button to the next gap on a decided gap, the undo message, and in the
pinned bar the button "להחלטה" (named "להחלטה על הפער") for a gap the viewer may decide. It reads the
switch-off key `decideOnInvoice` from the `features` prop: with the key absent, the button to the desk stays.
`INV-05` changes no other file of the screen; something missing in the interface is a request to `INV-01`.

**S8 · the desk's address.** `/dashboard/approvals?invoice=<invoiceId>&sel=<gapId>`. `?invoice=` narrows the
queue to one invoice today (`apps/web/app/dashboard/approvals/page.tsx:45-47`); `?sel=` picks one gap (`main`:
`approvals/list.tsx:473-474`; DS3-04: `desk-state.ts:229-231`, which falls back to the first open row when the
id is not in the queue). `INV-04` makes `sel` work for a gap routed to another role. `INV-01`, `INV-02` and
`INV-03` link with both parameters from the start; `?invoice=` alone keeps working (the notification link
uses it). `INV-03` updates the assertion at `apps/web/e2e/W2-03.spec.ts:126`, which expects the address to end
after the invoice id. From the list and from the pay run the gap in `sel` is the invoice's `decideGapId`
(`INV-00`, "The contract"); from a gap card of the invoice screen it is that card's own gap.

`?invoice=` narrows the whole desk to that invoice: the queue and the summary both take the filter (DS3-04:
`approvals/page.tsx:50-52`, `:68-70`). The mock-up does not narrow: its jump only picks the gap on the full
queue (`reference/src/inv-core.js:199-201`). So after "להחלטה" from the list, the invoice screen or the pay
run, the desk's head, "N מתוך M" and the hint "אחריו נשארים עוד N פערים" count that invoice only. `INV-04`
covers it (its slice 2): the filter is visible and is cleared in one press, and when the invoice's last gap is
decided the desk shows the filtered note (DS3-04: `approvals/page.tsx:156-157`), never "הכול מטופל" while gaps
are open elsewhere.

**S9 · what `INV-04` exports for `INV-05`.** One entry file,
`apps/web/app/dashboard/approvals/gap-decision/index.ts`, inside `INV-04`'s boundary: a controller for one gap
on the desk's own pure builders (DS3-04: `desk-state.ts:317-337` `approveInput`, `rejectInput`,
`escalateInput`; `:360-369` `decisionCall`; `:377-383` `reopenCall`; `failureOutcome`) and the windows of
`undo-window.ts`; the two buttons in a layout that sits inside a card and in a docked bar; the reasons
question; the pass-on sheet; the undo message; the read-only sentence; the `blocked` state pull request 190
needs. It reads `scope: 'all'` and writes nothing to the address of the page that mounts it. `INV-05` imports
from this file only.

**S10 · the bases.**
- `claude/ds3-01-components` (`daec849e`) merges with current `main` without a textual conflict. **Asked of
  the DS3-01 session, or done by the lead, before wave 1 opens: merge current `main` into
  `claude/ds3-01-components`** and run the three blocking jobs on the merged tree. The merged tree
  type-checks (all 17 packages, and `tsc --noEmit` of `apps/web`, 28.11.2026); the lint, the build and the
  suites were not run on it. Then a stacked pull request shows `INV-00`'s files and its own. If it is not
  done, the screen session's own merge of `main` makes its pull request also show `main` since `9dc0b934`;
  its first line says so.
- `claude/ds3-04-approvals-desk` (`be22850e`) has one conflict with current `main`:
  `apps/web/app/dashboard/approvals/list.tsx` (pull request 360 changed 24 lines of the file DS3-04 cut to 76
  lines). **Asked of the DS3-04 session before `INV-04` opens: merge current `main` and resolve it.** The
  resolution is known: keep DS3-04's `list.tsx`; keep `main`'s `approvals/summaryRefresh.ts` and its test; use
  `makeSummaryRefresher` in DS3-04's `use-desk.ts:105-114`, where the same sequence guard still lives without
  the cancel, and keep `holdSummary` working. With DS3-04's `list.tsx` kept, the merged tree type-checks (the
  same two checks, 28.11.2026); the suites were not run on it. If it is not done when `INV-04` opens, `INV-04`
  does this merge in its own branch as its first step (every file involved is inside its boundary) and says
  so in the first line of its pull request. **Exactly one of the two happens, and the lead says which before
  `INV-04` opens.** Once `INV-04` has done the merge, nobody merges `main` into `claude/ds3-04-approvals-desk`
  before `INV-04` is merged, unless that merge repeats `INV-04`'s resolution of `list.tsx` and `use-desk.ts`
  line for line; the lead tells the DS3-04 session. Otherwise `INV-04`'s next merge of its base conflicts
  with its own earlier work.

Everything else two packages need:

| File | Owner | Seam |
| --- | --- | --- |
| `apps/web/app/dashboard/invoices/hold-reasons.ts` and its test | `INV-02` | `INV-01` imports `holdReasonKeys` (`[invoiceId]/page.tsx:26`) and does not edit; the exports are frozen |
| `apps/web/lib/components/invoice/InvoiceScanViewer.tsx` | `INV-01` | `INV-06`: one lazy mount; the frame stays as the fallback |
| `apps/web/e2e/pilot-unread-invoices.spec.ts` | nobody | Both screens keep what it reads. The list: `?view=lines` (`:49`, `:100`) and the test ids `register-lines-row` and `register-lines-reasons` (`:56`, `:101-103`). The invoice screen: the test ids `invoice-held-reasons` and `invoice-held-supplier-link` (`[invoiceId]/page.tsx:211`, `:225`), which `INV-01` keeps inside the payment block. The strings it pins are frozen (S3) |
| `apps/web/e2e/W1-05.spec.ts` | nobody | `INV-04` has the seam (the desk's assertions). The test at `:277` reads the pay run at `:344-352`: `INV-03` keeps the payable total printed and edits nothing there |
| `packages/api/src/index.ts` | nobody | `INV-00` adds no export there; the web derives the new types (`INV-00`, "The contract") |
| `packages/api/src/routers/payRun.ts` | nobody | The pay run screen reads `invoices.holding`; the invoice screen reads `invoices.detail.payment` |
| `packages/api/src/lib/features.ts`, `packages/db/scripts/pilot-setup.ts` | nobody | `INV-05`: the key `decideOnInvoice` in each, if the lead keeps the switch-off |
| `apps/web/package.json`, `pnpm-lock.yaml` | nobody | `INV-06` only |
| `apps/web/lib/copy/screens.ts`, `apps/web/e2e/ia/screens.ts`, `apps/web/lib/copy/budget.allow.ts` | nobody | Each package its own rows, as "Shared guard files" says. `INV-01` and `INV-05` have no seam in `apps/web/lib/copy/screens.ts` |

---

## INV-00 · The server reads, and the words every screen shares

**Goal.** Every screen of the area reads, from one definition, with whom an invoice's gap is, since when and
by which rule; who passed it on; what was decided and by which role; whether the invoice can be paid; which
place it is in; and an invoice's story. And the four screens say it in the same words. Reads only: no table,
no column, no change to a decision. No screen changes in this package.

**Upstream and base.** Wave 1. Starts from `main`, merges nothing. Pull request base `main`. Branch
`claude/inv-00-server-reads`. It depends on nothing in DS3 and can be merged alone and first; until a screen
reads them its new fields are unused. **Downstream: everyone.** Push the contract first, then small and often.

**Reference.** `reference/PAGE-TEXT.he.md`, "מה צריך כדי לבנות", the group "מידע חדש מהשרת", and "איך פער
מגיע לתפקיד"; `reference/src/inv-core.js` (`INV.who`, `INV.because`, `INV.line`, `INV.doneT`, `INV.doneLine`,
`INV.pill`, `INV.places`, `INV.history`).

**Write boundary.**
- `packages/api/src/routers/invoices.ts`
- `packages/api/src/routers/approvals.ts` (reads only, as S1 says)
- `packages/api/src/invoices/index.ts` (export lines)
- new `packages/api/src/invoices/holding.ts`, `packages/api/src/invoices/history.ts`,
  `packages/api/src/invoices/payment.ts`
- `packages/api/src/__tests__/invoices-register.test.ts`, `packages/api/src/__tests__/invoices-detail.test.ts`
  (add cases; the existing ones stay green)
- new `packages/api/src/__tests__/invoice-holding.test.ts`,
  `packages/api/src/__tests__/routing-reason.test.ts`, `packages/api/src/__tests__/invoice-history.test.ts`,
  `packages/api/src/__tests__/invoice-payment.test.ts`, `packages/api/src/__tests__/approvals-decided.test.ts`,
  `packages/api/src/__tests__/invoice-area.attack.test.ts`,
  `packages/api/src/__tests__/invoice-area.fixtures.ts`
- new `packages/api/src/__tests__/coverage/IA-04.ts`. The file name must match the pattern at
  `packages/api/src/__tests__/coverage/index.ts:40`; `INV-00.ts` is refused. No `IA-*` fragment exists on
  `main`, and no open pull request in `OPEN-PRS.md`'s sources adds one; if the name turns out to be taken, any
  id the pattern accepts and nobody uses will do, and the pull request says which.
- new `apps/web/lib/invoices/**` (pure modules and their tests)
- `apps/web/lib/i18n/messages/invoices/index.ts`; new `apps/web/lib/i18n/messages/invoices/gap.ts`

**Reserved (beside the boundary, not yours).** `packages/api/src/routers/payRun.ts` ·
`packages/api/src/invoices/state.ts` · `packages/api/src/approvals/**` · `packages/api/src/lib/roles.ts` ·
`packages/api/src/lib/claims.ts` · `packages/api/src/lib/dueDate.ts` · `packages/api/src/match/**` ·
`packages/api/src/vat/**` · `packages/api/src/lifecycle/**` · `packages/api/src/__tests__/fixtures.ts`.

**Seams.** S3, in the first commit only: create `apps/web/lib/i18n/messages/invoices/screen.ts` (owner
`INV-01`), `apps/web/lib/i18n/messages/invoices/list.ts` (owner `INV-02`) and
`apps/web/lib/i18n/messages/invoices/decide.ts` (owner `INV-05`), each with an empty Hebrew and an empty
English object, and compose them in `index.ts`. Never opened again by `INV-00`.

**Not yours.** `routers/payRun.ts`. `invoices/state.ts` (pull request 369 changes one line of it).
`approvals/{engine,awaiting,bulkPolicy,rebind,payApproval}.ts`: read and call `evaluateApproval`,
`buildRules`, `resolveApprovalThresholds`, `awaitingDecisionDetail`; `engine.ts` is immutable. `match/**`,
`vat/**`, `lifecycle/**`, `lib/{roles,claims,dueDate}.ts`. `__tests__/fixtures.ts` (pull request 237 edits it:
keep new helpers in `invoice-area.fixtures.ts`). `__tests__/{cross-tenant,rls}.attack.test.ts` (immutable: the
fragment replaces an edit there). Everything under `packages/db`, `packages/charts`, `apps/worker`. Every
screen.

**The contract.** The server returns structures, never a printed Hebrew string: the stored `rule_name` holds
the retired word "הפרש" (`packages/api/src/approvals/engine.ts:195`, `:204`). Amounts are integer agorot with
their VAT basis kept apart.
- `invoices.list`: per row `holding`, `lastDecision` (result, when, by which role, in whose place, amount,
  reason code, "it was you"; a gap the system closed is never one), `place`, `allocationMissing`, `payBy`;
  per response `places[]` for the caller's role (count, Σ including VAT, Σ of open gaps before VAT), and a
  new count of `allocationMissing` beside the old counts.
- **`holding`**, the same object wherever it is returned: the role, `mine`, `canAct`, `since`, the leading
  gap's id, `decideGapId`, the worst open severity, the count and ₪ of the open gaps by VAT basis, the
  reason, the pass-on.
  - **The leading gap.** When one of the invoice's open gaps is routed to the viewer's role, the leading gap
    is the viewer's own (blocking first, then the oldest) and `mine` is true. Otherwise it is the invoice's
    blocking-first, oldest gap. The role, `since`, the reason and the pass-on describe the leading gap.
  - **`decideGapId`** is the first gap of the invoice the viewer may decide (own routing first, blocking
    before warning, the oldest first), and `null` when there is none. `canAct` is true exactly when it is not
    `null`. Every "להחלטה" links to `decideGapId`, never to the leading gap's id: a manager whose warning sits
    on an invoice with a blocking gap at the owner would otherwise be sent to a gap the manager cannot decide.
  - **`since`** is the time of the pass-on for a passed-on gap, and otherwise the creation of the gap row. The
    pass-on carries the role that passed the gap, when, and how long the gap had waited before. A pass-on
    carried through a re-match has an audit row written at the re-match (`after.carried`,
    `packages/api/src/match/persist.ts:464-482`), so its time is not known: `since` is then the creation of
    the gap row, the pass-on says that it was carried and carries no days, and no pass-on phrase is printed.
- **`allocationMissing`** is the pay run's rule, from `vatAtRisk()`: a malformed number counts as missing, and
  a credit and an invoice being read are left out. It is not `allocationRequired && !hasAllocation`: the row's
  existing `allocationRequired` looks at the date and the amount only
  (`packages/api/src/routers/invoices.ts:114-118`, `:160`).
- **`payBy`** is the pay run's own date, from `computeDueDate()` in `packages/api/src/lib/dueDate.ts` (`:150`),
  called with the invoice's date, the supplier's terms, `invoices.due_date` and the printed due date, as
  `routers/payRun.ts:713-720` calls it, and never copied: the date and its source, or `null` when the rule
  answers `unknown`. The existing `dueDate` keeps its value, which is only the date a person typed
  (`routers/invoices.ts:134`, `:151`, `:282`). A screen prints no remainder when `payBy` is `null`.
- `invoices.detail`: `holding`, `queueOpenCount`, `payment` (held, payable, paid or being read; the reasons;
  whether an open gap is the only thing holding it), `allocation` (required, the number, valid, missing, the
  VAT at risk), `payBy`, the order's sent date, and per finding its routing, its rule and since when for an
  undecided gap, and the result, when, the role, in whose place and the reason for a decided one.
- New `invoices.holding({ invoiceIds })` (at most 200 ids): per id that is the caller's
  `{ holding, lastDecision, consolidated }`; a foreign id is simply absent.
- New `invoices.history({ invoiceId })`; a foreign id is NOT_FOUND.
- `approvals.myQueue` rows gain `reason` and `passedOn`. `approvals.queueSummary` gains `byRouting` and
  `invoices`. New `approvals.decided({ period })`.
- Every new field is null or absent for a caller without `money.view`: `invoices.detail` is open to the
  receiver (`packages/api/src/trpc.ts:186-188`).
- Every existing field keeps its value: `invoices.list.tab`, `counts`, `counts.noAllocation`, `gapAgorot`,
  `hasAllocation`, `allocationRequired`, `allocationNumber`, `dueDate`; `invoices.detail.openCount`,
  `openGapAgorot`; the queue row's keys (the mobile app and `approvals-scope.test.ts` read them); the
  summary's keys (`packages/api/src/routers/chain.ts:552` reads them).
- **The types are not exported from the package root.** `packages/api/src/index.ts` is not yours, and the
  package exports only `.` and `./client` (`packages/api/package.json:8-11`); your own
  `packages/api/src/invoices/index.ts` is not re-exported from the root. `apps/web/lib/invoices/types.ts`
  (yours) names each new shape once, derived with `inferRouterOutputs<AppRouter>` as
  `[invoiceId]/cockpit.tsx:6-7`, `:22` does today, and every screen imports the types from there.
  `buildRules` and `evaluateApproval` are already exported from the root (`packages/api/src/index.ts:132-133`),
  so the tests of the words need no new export.
- **Not added:** `supplierSku` on the detail lines. The invoice page already loads `receiving.getInvoice`
  (`[invoiceId]/page.tsx:91`), whose lines carry `id` and `supplierSku`
  (`packages/api/src/routers/receiving.ts:635-639`).

The web half, `apps/web/lib/invoices/**`, all pure:
- `words.ts`: "אצלכם" / "אצל הבעלים" / "אצל הניהול" / "אצל הנהלת החשבונות"; the wait ("יום אחד", "יומיים",
  "N ימים", "מהיום" after a pass-on); the phrase of a rule; the full line (for example "אצלכם 10 ימים, כי חיוב
  על יותר ממה שהתקבל חוסם תשלום."); the result of a decision ("נוסף לבקשת הזיכוי", "שולם כפי שחויב"); "החלטתם
  במקום הניהול"; "ההחלטה אצל הבעלים, ואין צורך בפעולה מצדכם."; the role words in their three forms (בעלים ·
  הבעלים · לבעלים). Every ₪ inside a phrase goes through the shared money format, never a hand-made one.
- `places.ts`: the place ids (the reference's are `r-owner`, `r-manager`, `r-bookkeeper`, `wait`, `alloc`,
  `ok`, `paid`), the aliases of today's `view` values, the order of rows (the viewer's gaps, then others',
  blocking before warning, the longest wait first; then waiting, clear, paid; newest first inside each), and
  the list the keys `[` and `]` walk.
- `state.ts`: the dot and word of an invoice's state, colour only when money waits for a person (`INV.pill`),
  and `ddmmyyyy`.

**Defaults the package builds until the owner says otherwise** (`SPEC.md` §8 lists every default of the
batch; each is named in the pull request under "Owner decisions touched").
- An invoice with open gaps at two roles: for the viewer it is "אצלכם" when one of its gaps is routed to the
  viewer's role; otherwise it sits with the role of its leading gap (blocking first, then the oldest).
- A possible duplicate: undecided, it sits with "אצל הנהלת החשבונות" like any gap (the engine routes it
  there, `packages/api/src/approvals/engine.ts:152-156`); once held as a copy it gets a place of its own,
  shown only when it holds an invoice, named by the existing state word "כפולה אפשרית". The state
  `held_duplicate` also covers an accepted duplicate (`packages/api/src/invoices/state.ts:20`); without that
  place the places are not a partition.
- An invoice that waits to be linked and also has a routed gap: its place follows the state ("ממתינות
  לשיוך") and its row still names who holds the gap.
- The reason phrase. Three phrases and the pass-on phrase were approved: "חיוב על יותר ממה שהתקבל חוסם
  תשלום", "עליית מחיר של 10% ומעלה חוסמת תשלום", "הפערים בחשבונית בין ₪50 ל־₪300 לפני מע״מ", "הניהול העביר
  אחרי N ימים". For every other rule (a duplicate, a large invoice with no order, an item that was not
  ordered, a blocking gap of another kind, the larger cumulative rule, the percentage band, the fallback) a
  row says with whom and how long, with no "כי …"; `INV-00` lists proposed phrases in its pull request under
  "Owner decisions touched" for the owner to approve. The pass-on phrase names the role that passed the gap:
  the approved one names the manager, and a gap the bookkeeper passed on says with whom and how long, with
  no "כי …", until the owner approves its words.
- Numbers in a phrase are printed only when they are provably the ones that routed the gap. The 10% of the
  price phrase is one of them: it is the restaurant's own `tolerances.blockPricePercent` (default 0.1,
  `packages/matching/src/tolerances.ts:9`; a setting, `packages/api/src/routers/settings.ts:58`), never a
  literal.
- An invoice being read (`in_ocr`) or waiting for the count (`awaiting_count`) is in the place `wait`, as the
  mock-up has it (`reference/src/inv-core.js:218`); today the first is in the tab `awaiting` and the second
  in `held` (`routers/invoices.ts:65-75`). The card keeps the name "ממתינות לשיוך" (`SPEC.md` §8, point 17).
- A gap with no routed role (`waitingOn: 'unrouted'`, `routers/approvals.ts:346`; the engine leaves no open
  gap unrouted today) has no words in the reference. Today's label for it is "מנהל או בעלים"
  (`apps/web/lib/i18n/messages/approvals/he.ts:38`), which uses a retired role word. The pull request says
  what the module returns for it.

**Slices, in build order.** A slice that adds a procedure adds its line in the fragment and its attack case
in the same commit, or the coverage test fails.
0. **The contract, pushed first**: the types (`apps/web/lib/invoices/types.ts`, as "The contract" says), the
   shapes of the new procedures and fields, the S3 commit, and in `gap.ts` the role words in their three
   forms and the "with whom" strings of `SPEC.md` §2.2, which `INV-04` needs for its slice 2. `INV-01` is
   opened on this commit.
1. **Who, since when, why** (`invoices/holding.ts`). The row set is the queue's own: open or escalated,
   without the ₪0 twin (`routers/approvals.ts:321-322`), so every screen counts what the desk counts. The
   open ₪ comes from `awaitingDecisionDetail` (`packages/api/src/approvals/awaiting.ts:191`), never from a
   sum of its own (pull request 369 changes how an invoice's cap is split). The reason carries numbers only
   when running the pure `evaluateApproval` again on the stored facts with today's thresholds returns the
   stored `rule_id`. That test cannot cover the percent of a blocking price gap, which is a matching
   tolerance and not an approval threshold (`severity-block` has none,
   `packages/api/src/approvals/engine.ts:177-182`): print the price phrase, with today's
   `blockPricePercent` from `settings.effective`, only when the gap's own percent is at or above it;
   otherwise no "כי". A pass-on comes from the latest `discrepancy.escalated` audit row of the gap
   (`routers/approvals.ts:830`; a re-match writes a carried one, `packages/api/src/match/persist.ts:464-482`),
   behind one function (pull request 237, a person's, adds a column that would replace that source).
2. **`invoices.detail`**: the fields above. `payment` is built from the canonical state, whose parity with
   the pay run is pinned (`packages/api/src/invoices/state.ts:27-30`), and from `vatAtRisk()` for the
   allocation number, the function the pay run itself reads (`routers/payRun.ts:707-709`).
3. **`invoices.history`**: the order, the receipt, the reading, each check, the routing with its rule, each
   pass-on, decision and undo. Roles only: no user id, no name, no e-mail anywhere in the payload, and "it
   was you" as a flag.
4. **The words, the places and the state tone** (web), with unit tests for every rule id of the engine,
   every role pair, 0 / 1 / 2 / many days, passed on, decided, decided in another role's place.
5. **`invoices.list` and `invoices.holding`**.
6. **`approvals.myQueue`, `approvals.queueSummary`, `approvals.decided`**: a person's decisions only, by the
   restaurant's day, with the role, "in place of" and the reason; an undone decision leaves the list. The
   read takes the period; the screens of this batch ask for today.
7. **Isolation.** The attack file complete; assertions that another restaurant's gaps, audit rows and
   pass-ons never change the caller's `holding`, `passedOn`, `byRouting`, `places`, history or decided list.
   The tenant-security gate reviews.

**Known limits, to state in the pull request and not to mend here.** A re-match deletes the gaps and writes
new ones (`packages/api/src/routers/match.ts:184-193`), so "since when" restarts, and pull request 364 (merged
after `9dd26ef9`) makes that more frequent. A decision is carried onto the new gap row and a carried pass-on
gets a new audit row (`match/persist.ts:455-482`), but the audit rows of the old gap ids can no longer be
joined to the invoice, so the history loses the undo pairs, the decider's recorded role and reason code of a
carried decision, and the time of a carried pass-on. `vatAtRisk()` reads the 2,000 newest invoices
(`packages/api/src/vat/vatAtRisk.ts:137`). "שולמו" is `invoices.status = 'paid'`, which nothing writes for a
real restaurant.

**Acceptance.**
- For one invoice, `invoices.list`, `invoices.detail`, `invoices.holding` and
  `approvals.myQueue({ scope: 'all' })` name the same role, the same day count and the same rule.
  `queueOpenCount` equals the number of rows the desk shows for the invoice; the ₪0 twin never counts (today
  `invoices.detail.openCount` counts it, `routers/invoices.ts:480`).
- For an invoice whose undecided gaps all have one routing and none was passed on, the role and the days equal
  the pay run's own (`routers/payRun.ts:461-469`). They differ otherwise, and that is expected: `payRun.list`
  takes the role of the oldest open finding and counts the days from the gap's creation
  (`routers/payRun.ts:273-288`, `:733`). `allocationMissing` is true exactly where the pay run holds the
  invoice for a missing number (`routers/payRun.ts:471-473`). `payment` says "held" exactly where
  `payRun.list` returns a hold, for every unpaid invoice of the fixture.
- The places are a partition of the month for each of the three roles, and their sums equal the month's
  total, to the agora.
- A reason carries numbers only when they are provably the ones that routed the gap. The test derives its
  cases from `buildRules()`, not from literals: pull request 359 (a person's) changes one rule's wording.
- The history of an owner deciding a manager's gap says in whose place. A deep scan of the three new reads
  finds no `userId`, `name` or `email` key. What the system closed by itself is never shown as a person's
  decision.
- "Today" in `approvals.decided` turns at midnight in the restaurant's zone.
- Receiver and chef: FORBIDDEN on the three new procedures; null new fields on `invoices.detail` for the
  receiver.
- Every existing field listed under "The contract" keeps its value; the existing cases of
  `invoices-register.test.ts`, `invoices-detail.test.ts` and `approvals-scope.test.ts` pass unchanged.
- The demo's case, in a unit test that passes 25.10.2026 as "now": the words module prints the reference's
  own lines for the four open invoices.
- `decideGapId` is a gap the caller may decide, or `null`; for a manager on an invoice with a blocking gap at
  the owner and a warning of the manager's, `mine` is true and `decideGapId` is the warning.
- Gates: `pnpm --filter @restomatch/db migrate`, then `pnpm turbo run test --concurrency=1`; the coverage
  manifest test green with the fragment and no diff in the manifest file; type check of `packages/api` and of
  `apps/web`; the web unit suite (parity, copy guard). The pull request says "no file of the immutability
  list changed".

**Open pull requests to watch.** `OPEN-PRS.md` has the files. 347 (S1). 369 (`claimsByRow`, one line of
`invoices/state.ts`, `payRun.ts`: no shared hunk if `INV-00` keeps to S1; it grew from 15 to 24 files after
its list was read, so read it again first). 190 (`routers/approvals.ts` +33: `pageQuestion` on queue rows).
374 (`lib/claims.ts`). 364 (merged after `9dd26ef9`: a re-match when an order is sent, so "since when"
restarts more often). 237 (a person's: `escalated_from_role`, `__tests__/fixtures.ts`). 359 (a person's: one
rule's wording). 380 (a person's proposal on `payRun.markPaid`).

## INV-01 · The invoice screen: the document beside the data (reads only; the button still opens the desk)

**Goal.** A person opens one invoice and reads the supplier's document beside what was found in it: the gap
first, with whom it is and why, the payment block, the lines by the three documents, and the invoice's story.
On a phone: one column, a window onto the document, the whole screen one tap away. Step one of decision 7. No
decision is written from this screen in this package.

**Upstream and base.** Wave 1. Starts from `main`; merges `claude/ds3-01-components` and
`claude/inv-00-server-reads`. Pull request base `claude/ds3-01-components`. Branch
`claude/inv-01-invoice-screen`. Outside this batch it depends on DS3-00 (pull request 346) and DS3-01 (345),
with current `main` merged into the components branch (S10). The frame, the divider, the viewer, the dialog,
the phone and the lines need nothing from `INV-00`; the "why" line, the payment block and the history do.

The lead opens this package once `INV-00`'s first commit (its slice 0, with S3) is on
`claude/inv-00-server-reads`. You never create `apps/web/lib/i18n/messages/invoices/screen.ts` and never edit
`apps/web/lib/i18n/messages/invoices/index.ts`. If the branch or that commit is missing when you start, do
slice 1 and the layout of slices 2 to 4 with no new string, fetch again, and merge it before your first
string.

**Reference.** `reference/reference.html#invoice` (mock-up 2, `id="inv-page"`), with the switch "המסמך" on
"בלי סימון" and on "בלי קובץ", never "עם סימון" (that is step two); `reference/src/inv-invoice.js`,
`inv-doc.js`, `inv-doc.css`, `inv-r15.css`; `reference/PAGE-TEXT.he.md`, "חשבונית אחת: המסמך עצמו, ולצידו מה
שנמצא בו"; `reference/checks/verify15.cjs`, `verify16.cjs`, `verify17.cjs` for the viewer's behaviour.

**Write boundary.**
- `apps/web/app/dashboard/invoices/[invoiceId]/**`
- `apps/web/lib/components/invoice/**`
- `apps/web/lib/i18n/messages/invoices/he.ts`, `apps/web/lib/i18n/messages/invoices/en.ts` (the groups
  `cockpit`, `correction`, `status`)
- new `apps/web/lib/i18n/messages/invoices/screen.ts` (created empty by `INV-00`; yours from then on)
- `apps/web/e2e/W2-02.spec.ts` (S6: you own the file; the tests at `:150`, `:171`, `:190` change on purpose)
- new `apps/web/e2e/INV-01.spec.ts`, `apps/web/e2e/INV-01-*.spec.ts`, `apps/web/e2e/INV-01/**` (a stored image
  and a stored PDF for the spec), `apps/web/e2e/__screenshots__/INV-01/**`

**Reserved (inside the boundary's folders, not yours).** Mounted and never edited:
`apps/web/app/dashboard/invoices/[invoiceId]/consolidated-panel.tsx`,
`apps/web/app/dashboard/invoices/[invoiceId]/__tests__/consolidated-panel.test.ts`,
`apps/web/app/dashboard/invoices/[invoiceId]/dock-price-notes.tsx`. Not on `main` yet and never edited:
`apps/web/app/dashboard/invoices/[invoiceId]/review-button.tsx` (arrives with pull request 373). Another
package's: `apps/web/app/dashboard/invoices/[invoiceId]/decide/**` (`INV-05`),
`apps/web/lib/components/invoice/pdf/**` (`INV-06`).

**The allocation field,** `apps/web/app/dashboard/invoices/[invoiceId]/allocation-field.tsx`: never edited,
and never mounted by you. On `main@9dd26ef9` it is a file that nothing imports (pull request 306 added it,
commit `ec26137f`, "UI slice, unmounted"). Pull request 341 mounts it with seven lines in
`[invoiceId]/page.tsx` and merged after that commit (`834d609b`; on `main@de5cfcf7` the mount is at
`page.tsx:252-257`, behind the feature `vatAtRisk`, for the finance roles). It is a control that writes, and
this package reads only: you add no mount of your own. The payment block ends with one named wrapper for it,
and 341's one mount moves into that wrapper, unchanged, when your branch holds it. Its spec,
`apps/web/e2e/AU-08-cockpit.spec.ts`, reads the test ids `allocation-field` and `invoice-vat-at-risk` on this
page and is not yours to change.

**Seams.**
- The row `invoice-owner-desk` in `apps/web/e2e/ia/screens.ts` (`:44`, its allowance at `:71`): lower its
  numbers to what the new screen measures, never raise one, and leave its `adopter`.
- `apps/web/lib/copy/budget.allow.ts`: delete the `invoices:correction.*` lines (`:79-97`) and
  `invoices:status.clean` (`:115`) whose strings went. There is no `invoices:cockpit.*` line. Never add a
  line ("Shared guard files").
- **No row for the invoice screen in `apps/web/lib/copy/screens.ts`**: `apps/web/e2e/W2-16.spec.ts:105` opens
  a row's route as written, and no row there carries an id. `INV-01.spec.ts` measures the screen's copy
  itself with `measureCopy()` (`apps/web/e2e/helpers/copyBudget.ts:28`, read-only), as owner at 1440, and the
  pull request states first, page and blocks against the detail budget (110 / 320 / 3,
  `apps/web/lib/copy/screens.ts:31`).
- Inside your own files: S5 (you remove an import) and S7 (you create `gap-actions.tsx` with the interface
  S7 fixes, and thread its props from `[invoiceId]/page.tsx` through `Cockpit`).

**Not yours.** Every router (ask `INV-00`). `apps/web/lib/invoices/**` and
`messages/invoices/{index,gap,list,decide}.ts`. `(register)/**` and `hold-reasons.ts`. The desk's files.
`apps/web/lib/supabase/server.ts` and `apps/web/lib/securityHeaders.ts`: if the viewer seems to need either,
stop and say so. `apps/web/app/scans/**`. `apps/web/e2e/pilot-unread-invoices.spec.ts`.
`apps/web/package.json`: no dependency in this package. The divider's width is kept for the browser tab only
(a module value survives `[` and `]`), so there is no stored key and no line on the cookie-policy page.

**Seeing a document locally.** The demo seed attaches no file to any invoice, and the lab's main server
cannot serve a local file: local scan storage is off when `NODE_ENV` is `production`
(`packages/api/src/lib/localScanStorage.ts:29-33`), which is how `lab.sh` serves
(`docs/ux/wave2/lab.sh:383`). So in the lab every invoice reads "אין קובץ מצורף לחשבונית הזו." until you
attach a file yourself:
1. Write the file as `<dir>/<restaurantId>/<scanId>.<jpg|png|webp|pdf>` and beside it `<scanId>.json` =
   `{ scanId, restaurantId, mimeType, ext, supplierName, createdAt }`. `<scanId>` is `scan-`, letters and
   digits, a hyphen and eight hex digits (`localScanStorage.ts:22`); `<dir>` is `LOCAL_SCAN_DIR`, or
   `restomatch-scans` in the system's temp folder (`:35-37`, `:55-62`).
2. Set that invoice's `raw_image_url` to `<any origin>/scans/<scanId>/file` (`:50-52`); in a spec, with
   `e2eSql()`, on an invoice of the spec's own, removed with its files in `afterAll`.
3. Look at it where local storage is on: the e2e dev server (`apps/web/playwright.config.ts:70-93`),
   `bash docs/ux/wave2/lab.sh INV-01 --dev`, or `--stub`, which serves the same build a second time on the
   lab's port + 50 with `NODE_ENV=development` and `LOCAL_SCAN_DIR=~/.rm-lab/inv_01/scans`
   (`lab.sh:393-395`). The lab's main server never shows a file.

The viewer's evidence comes from one of the three, and the pull request says which.

**Slices, in build order** (each leaves a screen that works).
1. Map today's screen against the reference and against current `main`: the five origins of the back link,
   the edit mode and its automatic re-match, every test id other specs read, "לא נספר" in the lines
   (`routers/invoices.ts:469`), the allocation field and its one mount from pull request 341 ("Reserved"),
   and what stays undrawn.
2. The frame: the data at the start edge, the document at the end edge, the document 58 % by default; each
   pane scrolls on its own; one column under a 1024 px window; the skeleton in the new shape. The switch is
   the window's width, as today (`cockpit.tsx:100`), not the content's: at a 1024 px window the content box
   is 712 px with the side menu open (a 248 px menu, `apps/web/app/dashboard/nav.tsx:203`; 32 px gutters,
   `apps/web/app/dashboard/layout.tsx:233`), so the document's pane sits at its 34 % stop and opens at the
   reading size.
3. The divider: `role="separator"`, arrows, Home, End, Enter and a double press reset it; it stops where the
   data pane would go under 448 px; `aria-valuenow` and `aria-valuetext` stay true; the 32 px grip and the
   tooltip "גררו לשינוי רוחב המסמך".
4. The viewer for an image: fit to width, 50 to 400 % with the size kept as a fraction, quarter turns that
   re-lay the page, a mouse drags, two fingers and Ctrl + wheel change the size, the keys `+ - 0 R` with the
   focus anywhere in the viewer, the kind of file in the toolbar, "פתחו את המקור" kept. **A PDF keeps today's
   sandboxed frame** (`apps/web/lib/components/invoice/InvoiceScanViewer.tsx:88`) inside the new pane, with
   its page count when the scan row has one (`resolveScan` returns `pageCount`,
   `apps/web/lib/supabase/server.ts:76`). On a phone, where a frame may not draw a PDF, the window shows one
   calm line and the same link.
5. Step one of decision 7: "חפשו במסמך: item, מק״ט sku." under the viewer, in the phone window's caption and
   at the foot of the whole screen; the item alone when a line has no SKU. Nothing on the screen speaks of a
   mark.
6. The whole screen as a real dialog (the native `<dialog>`, as `apps/web/lib/components/overlay/Sheet.tsx`
   does), and the phone: the window with "פתחו את המסמך", the reading size, the switch "מסמך | שורות" removed
   (`cockpit.tsx:399-408`).
7. The header: title, the state as a dot and a word from the shared words, three facts with their VAT basis
   and "נותרו N ימים", the back link by origin, "חשבונית N מתוך M שנמצא בהן פער" with previous and next, `[`
   and `]` (S4), silent while typing, while the dialog is open and when single keys are off. The place line,
   the two buttons and the keys exist only when the person came from the list (`from=register`), as today
   (`cockpit.tsx:125`, `:361`).
8. The gap card, reading part: one card per undecided gap of the queue's row set, the kind and the item, the
   pill "חוסם תשלום" or "אזהרה", the numbers that disagree side by side, the amount with "לפני מע״מ" and its
   arithmetic, the one line from the shared words, a decided gap calm and still there after a reload, the
   pinned amount bar (its button reads "לפרטי הפער" for every role in this package), and `gap-actions.tsx`
   with the whole interface of S7 (S7, S8). The open gaps come from
   `approvals.myQueue({ scope: 'all', invoiceIds: [id] })`, called only for a finance role: the receiver may
   read the invoice and is refused the queue (`routers/approvals.ts:251-252`).
9. The payment block: "בהשהיה" or "ניתן לשלם" with the reason, the due date, before VAT, VAT and including
   VAT, "השורות מסתכמות בסכום שלפני מע״מ, והמע״מ תואם." with no percentage, the allocation line (not required,
   the number itself, or missing). "ההחלטה על הפער תשחרר את החשבונית לתשלום." only when the gap is the only
   reason. The block takes in today's held-reasons note and the VAT note (`[invoiceId]/page.tsx:209-249`) and
   ends with the wrapper for the allocation field: it holds pull request 341's mount, and this package adds
   none of its own ("Reserved").
10. The lines by the three documents: grouped heads with the order's reference and the two dates; the gap
    lines alone by default with "כל N השורות"; every line and dense rows with ₪ in the heads for the
    bookkeeper at a desk; the sticky head; "לבדיקה" and "לא נספר" kept.
11. "מה קרה עם החשבונית" from `invoices.history`, newest first, a role beside every act.
12. Everything kept keeps working with its test ids: the reading correction and its re-match, the
    consolidated panel, the dock-price notes, the partial-load banner, the duplicate notice. One string of
    the correction is reworded: "חשבונית ריכוז" in `correction.linesLocked.consolidated` (`he.ts:45`) is a
    retired word and becomes "חשבונית מרכזת", both languages (`KNOWN-ISSUES.md`, the invoice screen).
13. The spec, the changed tests of `W2-02`, axe on the page and on the dialog, the evidence.

**Defaults until the owner says otherwise** (`SPEC.md` §8). One card per gap when an invoice has several. The
payment block is shown where the pay run is switched off too; it states the invoice's own state. (That the pay
run is off for the pilot restaurant is the owner's statement on the proposal page; no file in the repository
holds the pilot's flags.) The desk tints one cell and writes "3 ק״ג פחות", and this screen draws the pair and
writes "חויבו 3 ק״ג יותר": each screen keeps its drawing.

**Acceptance.** As owner, manager and bookkeeper on the demo restaurant, at 1440, 1280 and 1024 px and at
390 px, in Hebrew and one more language.
1. Two panes in a frame as tall as the window, the document 58 % by default. The divider drags, moves with
   the arrows, goes to its ends with Home and End, resets with Enter and with a double press, never lets the
   data pane go under 448 px, reports `aria-valuenow`, and keeps the same place of the document in the middle.
   Under a 1024 px window the screen is one column; at 1024 and at 1280, with the side menu open, it is two
   panes (the switch is the window's width, slice 2). The width survives `[` and `]` and is forgotten on a
   reload.
2. The viewer, for a JPEG, a PNG and a WebP: fit to width, 50 to 400 %, quarter turns that re-fit, a mouse
   drag, two-finger and Ctrl + wheel sizing, the keys `+ - 0 R` with the focus anywhere in the viewer and in
   the whole-screen dialog, "פתחו את המקור" present, the kind of file in the toolbar. A PDF is in the
   sandboxed frame inside the new pane, with its page count when the scan row has one.
3. No PDF library: `apps/web/package.json` and `pnpm-lock.yaml` are unchanged, and no request for one is made
   on an invoice with an image or with a PDF.
4. The whole screen is a dialog: opened from the toolbar and from the phone window, closed by Escape and by
   its button, the focus kept inside and returned to the opener, the page behind unreachable. At its foot:
   "להחלטה" for a role that may decide, and the short form "ההחלטה אצל הבעלים." (with the role's word) for a
   role that may not. The phone's dock is absent for a role that may not decide.
5. The gap card: the right numbers side by side for a quantity gap and for a price gap, the amount with
   "לפני מע״מ" and its arithmetic, the line "with whom, how long, why" word for word what the shared words
   module returns for the gap.
6. The ₪0 twin is not a gap on the screen, and the count of open gaps equals the desk's for the four demo
   invoices.
7. The payment block says "בהשהיה" or "ניתן לשלם", the due date, before VAT, VAT, including VAT, and the
   check sentence with no percentage; SH-24121 (no VAT) never shows "18%". "ההחלטה על הפער תשחרר את החשבונית
   לתשלום." appears only when `invoices.detail.payment` says the gap is the only reason.
8. The lines: grouped heads with the order's reference and the two dates; the gap lines alone by default and
   "כל N השורות"; every line by default and dense rows for the bookkeeper at a desk; "לבדיקה" still on a
   low-confidence line; "לא נספר" still on an uncounted line.
9. "מה קרה עם החשבונית" lists the order, the receipt, the check, the routing with its rule, every pass-on,
   decision and undo, with roles and never a name or "משתמש אחר".
10. A phone at 390 px: one column, no "מסמך | שורות" switch, the window onto the document, the dock above
    the bottom bar with the amount and the item, the whole screen at a readable size, no sideways scroll,
    targets of 44 px.
11. Step one only: nothing on the screen speaks of a mark; "חפשו במסמך: item, מק״ט sku." appears under the
    viewer, in the phone caption and in the whole screen.
12. From the list (`from=register`), `[` and `]` step between invoices of the place the person came from,
    not while typing, not while the dialog is open, not when single keys are switched off. From any other
    origin there is no stepping, as today. An old `view` value (`review`, `awaiting`, `noAllocation`…) still
    resolves. That the side menu's own `[` yields on this page arrives with pull request 349 and is not
    tested here: nothing outside the page binds `[` on `main` or on the components branch.
13. Everything kept still works with its test ids: the reading correction and its automatic re-match, the
    consolidated panel, `invoice-held-reasons`, `invoice-held-supplier-link`, `invoice-vat-at-risk`, the
    duplicate notice, the partial-load banner, the five back origins. The receiver and the chef stay out of
    the page.
14. The role matrix of the card, from `canAct` of the queue row: the owner on any gap, the manager on the
    manager's gap and the bookkeeper on a duplicate see "להחלטה" with both address parameters (S8); the
    manager on the owner's gap and the bookkeeper on any other gap see the sentence with the role's word.
    **No decision control exists on this screen in this package.** `gap-actions.tsx` has the five props of
    S7, is mounted for every gap in its four places (a decided gap included), and the screen has the empty
    place above the dock and the `holdStep` hold: a unit test mounts the component with each prop and proves
    that `[` and `]` do nothing while the hold is on.
15. Tests added. Unit: the divider's clamp and keys; the viewer's zoom steps, fit and turn geometry; picking
    the gap lines; the ₪0 twin; days left by the Israeli day; the "חפשו במסמך" sentence with and without a
    SKU; the role matrix. e2e `INV-01.spec.ts`: the items above on a stored image and a stored PDF, axe with
    no serious or critical finding on the page and on the dialog, ₪ left of the digits, reduced motion.
    Existing specs that land on the page stay green and are not yours to change: `pilot-unread-invoices`,
    `invoice-manual-lines`, `pilot/pilot-journey` (`:504-528`), `consolidated`, `W1-03`, `W1-04`, `W1-06`,
    `W2-08`, `smoke`, and `AU-08-cockpit` (on `main` since pull request 341 merged). What they read on this
    page are parts you keep: the reading correction with its test ids, the consolidated panel, the
    held-reasons note, the 404 of an unknown invoice. `W2-02` is yours (S6). The copy measurement of "Seams"
    is in the spec and its numbers are in the pull request.
16. The owner's rules of `README.md`, and above all: no ₪ in red; every ₪ through the shared money component
    with its VAT basis beside it or in the column head; one filled button in the viewport; Hebrew and English
    in parity; the copy guard met with no new allow-list line.

**Open pull requests to watch.** 341 (merged after `9dd26ef9`: it mounts the allocation field, `page.tsx` +7,
and adds a spec of its own on this page; "Reserved" says where its mount goes). 190 (`page.tsx` +18,
`messages/invoices` +5 just before `needsLines`, `apps/web/lib/supabase/server.ts`; it makes an invoice's file
a PDF of several pages: the frame shows them through the browser). 373, 374, 120 (`consolidated-panel.tsx`)
and 363 (`dock-price-notes.tsx`): outside the boundary. 349 (the shell already yields `[` on this route). 353
(the preferences store: read through `usePrefs()` and `singleKeysEnabled()`).

## INV-02 · The invoices list

**Goal.** The list answers where each invoice stands: one sentence that says what waits for the viewer, one
card per place with sums that add up to the month, search and a supplier filter, a row that says with whom
its gap is and why, a read-only summary. Decision 5 lands here. No decision is taken here.

**Upstream and base.** Wave 2. Starts from `main`; merges `claude/ds3-01-components` and
`claude/inv-00-server-reads`. Pull request base `claude/ds3-01-components`. Branch
`claude/inv-02-invoices-list`. Outside this batch: DS3-00 (346) and DS3-01 (345), with current `main` merged
into the components branch.

**Reference.** `reference/reference.html#register` (mock-up 1, `id="inv-reg"`);
`reference/src/inv-register.js`, `inv-core.js` (`INV.places`), `inv.css`; `reference/PAGE-TEXT.he.md`,
"הרשימה: איפה כל חשבונית עומדת".

**Write boundary.**
- `apps/web/app/dashboard/invoices/(register)/**`
- `apps/web/app/dashboard/invoices/hold-reasons.ts`,
  `apps/web/app/dashboard/invoices/__tests__/hold-reasons.test.ts` (the exports are frozen: `INV-01` imports
  `holdReasonKeys`)
- new `apps/web/lib/i18n/messages/invoices/list.ts` (created empty by `INV-00`; yours from then on)
- new `apps/web/e2e/INV-02.spec.ts`, `apps/web/e2e/INV-02-*.spec.ts`, `apps/web/e2e/__screenshots__/INV-02/**`

**Reserved (beside the boundary, not yours).** `apps/web/lib/components/table/**` ·
`apps/web/lib/components/desk/**` · `apps/web/app/dashboard/close/**` ·
`apps/web/e2e/pilot-unread-invoices.spec.ts`.

**Seams.**
- `apps/web/lib/i18n/messages/invoices/he.ts` and `apps/web/lib/i18n/messages/invoices/en.ts` (owner
  `INV-01`): the group `register`, and in the group `needsLines` every key except `heldTitle`,
  `heldTitleReadOnly`, `supplierDetails` and `held.*`; there you delete or change a string, both languages in
  the same commit. New strings go to `list.ts`. Those four, the text of `needsLines.reason.ocr_failed`, the
  group `state` and the key `cockpit.backToInvoice` are frozen, key and text: the invoice screen draws them
  and `apps/web/e2e/pilot-unread-invoices.spec.ts` and your own `hold-reasons.test.ts` (`:34-36`) pin their
  Hebrew (S3).
- `apps/web/e2e/W2-02.spec.ts` (owner `INV-01`): only the three tests whose title starts with "register"
  (`:118`, `:223`, `:316`). The helpers at `:1-117`, the inbox tests and the chef test are nobody's to change
  (S6).
- `apps/web/lib/copy/screens.ts`: one new row for the list (owner, 1440), measured, placed directly after
  the `suppliers` row (`:66`).
- `apps/web/e2e/ia/screens.ts`: one new row for the list, which is two entries: a row in `BASE`, directly
  after the `inbox-bookkeeper-desk` row (`:41`), and its entry in `BASELINE_0711`, directly after
  `'team-owner-desk'` (`:77`). `apps/web/test/ia-density.test.ts:154` needs both, and it runs in the web unit
  suite. The row's `adopter` must match the pattern at `ia-density.test.ts:147`: write `adopter: 'W2-02'`,
  never `'INV-02'`.
- `apps/web/lib/copy/budget.allow.ts`: delete `invoices:needsLines.subtitle` (`:114`) if its string went. The
  lines `invoices:needsLines.held.*` (`:98-113`) stay, and there is no `invoices:register.*` line. Never add
  a line ("Shared guard files").
- Contracts, not edits: S4 (you write place ids in `view`; every old value keeps resolving), S5 (you keep
  three exports of `columns.tsx`), S8 (the desk's address).

**Not yours.** Every router and every count: the place of an invoice, the sums of the cards and "חסר מספר
הקצאה" arrive from `INV-00`. `[invoiceId]/**`. `apps/web/lib/invoices/**`. The shared table, `Peek` and the
phone list (`apps/web/lib/components/table/**`, `apps/web/lib/components/desk/Peek.tsx`): what the mock-up
needs beyond them (₪ beside an amount in a cell, a side summary that is not an overlay, a six-line phone
card, "הציגו את כל N") is built inside `(register)/` and listed under "Promote to shared".
`apps/web/app/dashboard/close/steps.ts`. `apps/web/e2e/pilot-unread-invoices.spec.ts`.

**Slices, in build order.**
1. Map today's screen against the reference.
2. Places instead of tabs, from the server's `place` and `places[]`: a card per place that holds an invoice,
   pressed as a toggle; "שולמו" only when the month has a paid invoice (`counts.paid` above zero; nothing new
   from the server); "חסר מספר הקצאה" from `allocationMissing`, absent when empty; every old `view` value
   still resolves.
3. The opening sentence and the one filled "להחלטה" (to the desk, S8), or the secondary "למסך האישורים", or
   nothing.
4. The table: the column "אצל מי ולמה" from the shared words, the state as a dot and a word, the due date as
   a date with a quiet remainder, the gap column, the order from the shared module, the foot with the sums.
5. Search, the supplier filter, the count line in its forms, the empty result with "נקו את הסינון".
6. The summary of a row, read-only, with "פתחו את החשבונית"; a sheet on a phone; the keyboard. Its
   calculation lines read `invoices.detail({ invoiceId })` of the picked row, fetched when the summary opens:
   the lines carry the quantities and the unit prices, and the findings the expected values
   (`packages/api/src/routers/invoices.ts:330`, `:399`, `:460`, `:473`). The row that can be decided and its
   claimable ₪ still come from `approvals.myQueue({ scope: 'all', invoiceIds })`. The queue row has unit
   prices only on DS3-04's branch, which is not in this package's base, and `INV-00` adds no select field to
   `myQueue` (S1): never derive a price by division.
7. The bookkeeper's dense rows with ₪ in the heads; ₪ beside every amount for the owner and the manager.
8. The phone: the six-line row, eight rows then "הציגו את כל N".
9. The exact wording for a consolidated invoice; the spec and the evidence.

**Kept although the mock-up does not draw them** (the owner was not asked to remove them): previous and next
month, the CSV export, the column and density menus, the paging, "להשלמת שורות" (`?view=lines`) and "נכנסות"
(`?view=intake`). The allocation number as a column gives way to the place "חסר מספר הקצאה".

**Acceptance.** As owner, manager and bookkeeper, at 1440, 1280 and 1024 px and at 390 px. The figures below
are the demo's on 25.10.2026, as the reference shows them. The server runs on the real clock, so a spec
asserts the relations and never these literals. In the lab October is `?month=-1` in November 2026 and
`?month=-2` in December; whatever counts days differs there (`README.md`, step 5).
1. The sentence. Owner: "פערים של ₪143.50 לפני מע״מ מחכים לכם, ועוד ₪152.50 אצל הניהול." and one filled
   "להחלטה". Manager: the same sentence with the amounts and "אצל הבעלים" swapped. Bookkeeper: "אין פער שמחכה
   לכם, ופערים של ₪296.00 לפני מע״מ אצל אחרים.", the secondary "למסך האישורים", no filled button. With no
   open gap: "אין פערים פתוחים החודש." and no button.
2. The cards, for the owner in October: אצלכם 2 · ₪3,621.50 · פערים של ₪143.50 (red dot); אצל הניהול 2 ·
   ₪6,527.43 · פערים של ₪152.50 (amber dot); ממתינות לשיוך 2 · ₪3,603.32; בלי פער פתוח 8 · ₪5,901.02 · "כולן
   תקינות"; שולמו 23 · ₪32,259.83; כל החודש 37 · ₪51,913.10 · "פערים פתוחים של ₪296.00 לפני מע״מ". No "חסר
   מספר הקצאה" card in October.
3. Every invoice is in exactly one place, and the cards equal `places[]` to the agora (a unit test on
   fixtures and the screen against the response).
4. "שולמו" is absent when `counts.paid` is 0. "חסר מספר הקצאה" holds the invoices the server puts in that
   place (a number is required, it is missing, and no gap is open), is absent when empty, and never holds an
   invoice that needs no number.
5. The role named in a row equals what `invoices.holding` returns for the invoice.
6. Order: the viewer's gaps first, blocking before warning, the longest wait first; then others'; then
   waiting, clear, paid; newest first inside each. It is the shared module's order, not one of the screen's.
7. Search by part of a supplier name or of an invoice number, the supplier filter, the count line in its
   forms, the empty result with "נקו את הסינון" and where the focus goes after it.
8. A row opens the summary and never a decision: **no decision control anywhere on the screen.** "להחלטה"
   lands on the desk with both address parameters, the second one the row's `decideGapId`; it is shown only
   where `canAct` is true. A role that may not decide reads the sentence with the role's word.
9. Keyboard: one tab stop in the rows; ↑ ↓; Enter and Space open the summary and move the focus into it;
   Escape returns it to the row; J and K follow the single-key preference; no key fires while typing in the
   search.
10. The bookkeeper gets compact rows and ₪ in the column heads at a desk; the owner and the manager get ₪
    beside every amount; on a phone nobody gets dense rows and every amount carries ₪ and its label.
11. Phone: no sideways scroll at 390 and 360; targets at least 44 px; eight rows then "הציגו את כל N" and
    "הציגו פחות"; the summary is a sheet at the foot and the tapped row stays in view.
12. Deep links keep working: `?month=`, `?view=lines`, `?view=awaiting` (the month close), `?sel=`. Your
    links to the invoice screen carry `from=register`, `view=<place id>` and `month`: assert the address. On
    your branch the invoice screen is still `main`'s, which knows tab ids only and walks the whole month for
    a place id (`[invoiceId]/cockpit.tsx:127-133` falls back to all rows); its back link survives a place id
    (`[invoiceId]/page.tsx:123`). Stepping through the place is `INV-01`'s acceptance 12 and is looked at
    once both are merged. The list still serves what `apps/web/e2e/pilot-unread-invoices.spec.ts` reads:
    `?view=lines` and the test ids `register-lines-row` and `register-lines-reasons` (`:56`, `:101-103`).
13. Tests added. Unit, in `(register)/__tests__/`: the sentence for each role and for 0 / 1 / many gaps;
    search and filter; the who-and-why cell for open, passed on, decided, waiting, consolidated; the pill per
    state and severity; the columns per density. e2e `INV-02.spec.ts`: the three roles at 1440 and the owner
    at 390, Hebrew and English, axe clean; the three "register" tests of `W2-02.spec.ts` updated with the
    reason.
14. The owner's rules of `README.md`, and above all: no money figure in red; pending, reading, counting and
    consolidated invoices are grey; red only for an open gap that blocks payment or a possible duplicate,
    amber only for an open warning; no green on clean or paid; a fresh credit request is neutral; every ₪
    states its VAT basis; no ₪0 for an unknown gap and no dash in a money cell; one filled button in the
    viewport.

**Open pull requests to watch.** 190 (`messages/invoices` +5 just before `needsLines`, a textual neighbour of
your seam in `he.ts` and `en.ts`; `routers/close.ts`). 369 (some invoices move from "לבקשת זיכוי" to "תקינה";
no file in common). 341 and the merged 306 (an allocation number can be "already asked for": the card's line
must not contradict it). 348 (one line of `pilot-unread-invoices.spec.ts`). 241, 252, 263, 362, 194 (old
stacks of people that list the list's files from stale bases; 263 and 194 still carry the page this folder
replaced: say so, do not fix).

## INV-03 · The pay run

**Goal.** The screen answers why each invoice is held: groups by who holds it, the viewer's own first, each
with its sum, adding up to "בהשהיה"; one sentence that says how small the gaps are against what they hold;
one "להחלטה" per group; then what can be paid. No control records a payment.

**Upstream and base.** Wave 2. Starts from `main`; merges `claude/ds3-01-components` and
`claude/inv-00-server-reads`. Pull request base `claude/ds3-01-components`. Branch `claude/inv-03-pay-run`.
Outside this batch: DS3-00 (346) and DS3-01 (345), with current `main` merged into the components branch.

**Reference.** `reference/reference.html#payrun` (mock-up 4, `id="inv-pay"`); `reference/src/inv-payrun.js`;
`reference/PAGE-TEXT.he.md`, "ריצת תשלומים: למה כל חשבונית בהשהיה".

**Write boundary.**
- `apps/web/app/dashboard/approvals/pay-run/**` (no `loading.tsx`: it was removed on purpose, and
  `apps/web/scripts/check-soft-nav.mjs:190-197` probes the route)
- `apps/web/app/dashboard/__tests__/payrun-dates.test.ts`
- `apps/web/lib/i18n/messages/payRun/**` (keep the key `open`, read by
  `apps/web/app/dashboard/approvals/page.tsx:99`)
- `apps/web/e2e/W2-03.spec.ts`
- new `apps/web/e2e/INV-03.spec.ts`, `apps/web/e2e/INV-03-*.spec.ts`, `apps/web/e2e/__screenshots__/INV-03/**`

**Reserved (beside the boundary, not yours).** `packages/api/src/routers/payRun.ts` ·
`packages/api/src/payRun/**` · `packages/api/src/vat/**` · `apps/web/lib/components/palette/**`.

**Seams.** The row `pay-run` in `apps/web/lib/copy/screens.ts` (`:68`): lower it to what the new screen
measures. The row `pay-run-bookkeeper-desk` in `apps/web/e2e/ia/screens.ts`: lower, never raise. Stale
`payRun:*` lines deleted from `apps/web/lib/copy/budget.allow.ts` (`:118-122`). S8 for the jump. **No server
seam**: the screen reads `payRun.list` as it is, for the hold reasons, the dates and the sums, and asks
`invoices.holding({ invoiceIds })` for everything about who holds a row: the group's role, `mine`, `canAct`,
the days, the rule, `decideGapId` and the severity, the pass-on, `consolidated`, and the result of a decided
gap on a payable row. `payRun.list` also returns a role and days
(`packages/api/src/routers/payRun.ts:441-442`, `:461-469`), but defines them differently from the batch's
rule: the role of the oldest open finding (`:273-281`) and days from the gap's creation (`:283-288`, `:733`).
Grouped and worded from those, the pay run would disagree with the list and the desk on an invoice with
gaps at two roles and on every passed-on gap; do not use them.

**Not yours.** `packages/api/**`, above all `routers/payRun.ts`: `payRun.list` stays as it is, and the shape
of `payRun.month` is read by the home, the task list and the chain. `packages/api/src/vat/**`. The palette's
wording "אישור ריצת תשלומים" (`apps/web/lib/components/palette/copy.ts:35`, DS3-02's): a request. Role and
rule words come from `apps/web/lib/invoices/`; none are added to `messages/payRun`.
`apps/web/e2e/W1-05.spec.ts:344-352` reads this screen: the home's "to pay" figure must appear as digits in
the page's text. Keep the payable total printed. The assertion is not yours, and it is red when an invoice
is held only for a missing allocation number ("Not in this batch", the pay-run total).

**Slices, in build order.**
1. Map today's screen against the reference.
2. A pure module "reason → group", one group per held invoice, as one typed table (so that the two reasons
   of pull request 190 are two lines); the order by viewer; the sums; the two tiles with "כולל מע״מ".
3. A row held for a decision: the gap and its days, the rule under it, the group's dot, from one call of
   `invoices.holding` for the held rows.
4. "להחלטה" per group: filled on the first group the viewer may decide, secondary on another, "לקריאה בלבד"
   otherwise; the jump.
5. The sentence beside the tiles, with both bases and its singular form; "אין פער שמחזיק חשבונית." when none.
6. "ניתן לשלם": one table in due-date order with the note of a decided gap and a totals row. Today's five
   due sections go as headings (`SPEC.md` §6.1); every row keeps its due date and its due-date notices.
7. Words, colour and format against the owner's rules: "פער … לפני מע״מ", the role names, dates
   `dd.MM.yyyy`, no dash in a money cell, a due date in plain text, a fresh credit request in neutral. The
   paying action is never the filled button (`pay-run/selection.tsx:165` sets `primary: true` today).
8. Density by role and the phone; the export follows the new reasons.
9. The spec; `W2-03` where it pinned the five due sections and the per-row link.

**Kept although the mock-up does not draw them:** the month filter `?m=`, the branch strip, the due-date
notices on a row (the five due sections themselves go as headings, slice 6), the credit sentence, the reasons
the mock-up omits (a duplicate copy, waiting for the count, an open question, a held reading, billed twice)
with their actions, the selection and its export. The rows of those five reasons keep today's sentences in a
last group; the name of that group needs the owner's word, so the pull request proposes one under "Owner
decisions touched".

**Acceptance.** On the demo restaurant with the pay run on. The server runs on the real clock and the e2e
seed is relative to the day of its run: a spec asserts relations. The fixed figures below are the
reference's on 25.10.2026, for comparing by eye in the lab; whatever counts days differs there (`README.md`,
step 5).
1. The tiles read "ניתן לשלם" and "בהשהיה", each with its count and "כולל מע״מ". Σ of the groups' sums
   equals the held tile to the agora; Σ of the payable table equals the payable tile and its own totals row.
   The reference: ₪5,901.02 in 8; ₪21,115.45 in 7 = ₪3,621.50 + ₪6,527.43 + ₪3,603.32 + ₪7,363.20.
2. Every held invoice is in exactly one group, the group of its first reason in the server's order
   (`routers/payRun.ts:451-475`); an invoice with two reasons shows the second as text in its row.
3. Group order follows the viewer: as owner the owner's group is first and wears the only filled "להחלטה";
   the manager's group has a secondary "להחלטה"; as manager the owner's group reads "לקריאה בלבד"; as
   bookkeeper every decision group that is not a duplicate reads "לקריאה בלבד" and the screen has no filled
   button.
4. "להחלטה" carries `?invoice=` and `&sel=`: the `decideGapId` of the group's longest-waiting invoice. A role
   that may not decide gets no link to decide. The assertion at `W2-03.spec.ts:126` is updated for the second
   parameter. The group a row sits in is `holding.role`, with `mine` and `canAct`, from `invoices.holding`,
   so the same invoice is under the same role here, on the list and on the invoice screen.
5. Each row held for a decision reads "פער של ₪X לפני מע״מ · N ימים" and the rule's phrase, word for word
   what the shared words module returns for the same gap. A hold whose open ₪ is zero never prints ₪0.
6. The sentence beside the tiles states both bases, has a singular form for one gap, and reads "אין פער
   שמחזיק חשבונית." when no invoice is held for a decision.
7. "ממתינות לשיוך" is grey with no button; "השיוך לתעודות המשלוח עוד לא פעיל." appears only on consolidated
   invoices.
8. "חסר מספר הקצאה" lists exactly the invoices whose first reason, in the server's order, is the missing
   number, with "בקשו את המספר מהספק, כדי לקזז ₪X מע״מ." and an amber dot. An invoice held for a decision too
   stays in its decision group and says the missing number as its second reason (the server returns both for
   one invoice, `routers/payRun.ts:461-473`).
9. The reasons the mock-up does not draw are still stated in words and keep their actions.
10. Decision 6 is unchanged and pinned by the existing tests: any open gap still holds the invoice. No
    control records a payment while `PAY_RUN_MARK_PAID` is off, and nothing on the screen says "שולם" about
    an invoice.
11. The export downloads a CSV of what the screen shows, with the reason and the VAT basis of every amount.
12. Receiver and chef still get 403 and no ₪.
13. At 1440, 1280, 1024 and 390: no horizontal scroll; at 390 the density is fixed, every amount carries its
    ₪ and its basis, targets are at least 44 px.
14. Tests added. Unit: the grouping module (one group per invoice; order per viewer; sums; singular and
    plural titles; the sentence's three forms; no ₪0), the CSV rows. e2e `INV-03.spec.ts`: the three roles at
    1440 (group order, the buttons, the sums), the jump, 390, English, axe with no serious finding, ₪ left of
    the digits. Unchanged and green: `payrun-dates.test.ts`, the API's pay-run suites, `a11y.spec.ts`,
    `check-soft-nav.mjs`. The spec does not compare the home's "to pay" figure with this screen's (see "Not
    in this batch", the pay-run total).
15. The owner's rules of `README.md`, and above all: no money figure in red; amber and red only on a group
    that waits for a person; a due date is never amber; role names בעלים, ניהול, הנהלת חשבונות (the forms
    "מנהל/ת" of `messages/payRun/he.ts:125-127` go with the strings that held them); at most one filled
    button in a viewport.

**Open pull requests to watch.** 355 (in current `main`: `selection.tsx`, `messages/payRun`). 190
(`pay-run/page.tsx` +26, `messages/payRun` +8, two new hold reasons: whoever lands second re-adds two lines in
the table of slice 2). 369, 374 (the figure in "פער של ₪X" can move: print what the server returns). 380 (a
person's proposal on `markPaid`, behind the flag). 353 (the personal density meets "dense rows for the
bookkeeper"). 194, 263, 362, 241, 252 (old stacks; not a base).

## INV-04 · Approvals by role, and the decision a second screen can mount

**Goal.** The desk shows every open gap as a row, grouped by who decides, the viewer's own first, with its
reason; a role that may not decide reads the same evidence and one sentence; the owner decides a gap that
waits for the manager and the screen says so (decision 3); the history and "כבר הוחלט" name roles (decision
4); "הוחלט היום" keeps what was decided. And the decision itself becomes something the invoice screen mounts.

**Upstream and base.** Wave 2. Starts from `main`; merges `claude/ds3-04-approvals-desk` and
`claude/inv-00-server-reads`. Pull request base `claude/ds3-04-approvals-desk`. Branch
`claude/inv-04-approvals-by-role`. DS3-04 (pull request 347) is finished at `be22850e`, so this package is not
waiting for it; current `main` is merged into its branch by the DS3-04 session, or by this package in its own
branch (S10, slice 0): exactly one of the two, and the lead says which before this package opens. Slices 0
and 1 need nothing from `INV-00`; slice 2 needs the role words and the "with whom" strings, which are in
`INV-00`'s contract commit (its slice 0).

**Reference.** `reference/reference.html#roles` and `#approvals` (mock-up 3, `id="inv-desk"`);
`reference/src/inv-desk.js`; `reference/PAGE-TEXT.he.md`, "מי רואה ומי מחליט" and "אישורים לפי תפקיד: אותם
פערים, לפי מי שמחליט". `docs/ux/ds3/SPEC.md` §10.2 stays binding for the desk's look. The owner's four
questions on the desk are settled as built (28.11.2026): the wording "שלמו כפי שחויב" and "שולם כפי שחויב";
bookkeepers open the desk compact; VAT gaps are decided one by one, never in a batch; the visible undo stays
10 s against the server's 15 s.

**Write boundary** (DS3-04's, after it).
- `apps/web/app/dashboard/approvals/**`
- `apps/web/lib/components/desk/**`
- `apps/web/app/dashboard/lab/desk/**`
- `apps/web/lib/i18n/messages/approvals/**`
- `apps/web/e2e/W2-04.spec.ts`, `apps/web/e2e/W1-07.spec.ts`
- `apps/web/e2e/DS3-04.spec.ts` (the desk's twelve scenarios; it arrives with DS3-04's branch and is not on
  `main`, so `packages.json` lists it as new)
- new `apps/web/e2e/INV-04.spec.ts`, `apps/web/e2e/INV-04-*.spec.ts`, `apps/web/e2e/__screenshots__/INV-04/**`

**Reserved (inside or beside the boundary, not yours).** `apps/web/app/dashboard/approvals/pay-run/**`
(`INV-03`) · `packages/api/src/approvals/engine.ts` (immutable) · `packages/api/src/lib/roles.ts` ·
`apps/web/app/dashboard/settings/**` (DS3-06).

**Seams.**
- `apps/web/e2e/W1-05.spec.ts`, `apps/web/e2e/demo-path.spec.ts`, `apps/web/e2e/W1-04.spec.ts`,
  `apps/web/e2e/pilot/pilot-journey.spec.ts`: only the assertions that read the desk's head, groups or rows,
  each named in the pull request with why it keeps its meaning. In `pilot/pilot-journey.spec.ts` the desk's
  block starts at `:530` (`approvals-others` at `:545`); the lines above it (`:504-528`) read the invoice
  screen and are nobody's to change. In `W1-05.spec.ts` the lines `:344-352` read the pay run and are
  nobody's to change either.
- The rows `approvals` and `manager-approvals` in `apps/web/lib/copy/screens.ts` (`:63`, `:58`) and the rows
  `approvals-owner-desk` and `approvals-manager-phone` in `apps/web/e2e/ia/screens.ts`: lower, never raise.
  Stale `approvals:*` lines deleted from `apps/web/lib/copy/budget.allow.ts` (`:124-133`).
- **No server seam**: `scope: 'all'` exists (`packages/api/src/routers/approvals.ts:241`, `:323`), and
  `decided`, `byRouting`, `reason`, `passedOn` come from `INV-00`.

**Not yours.** `packages/api/**`. `packages/api/src/approvals/engine.ts` and `packages/api/src/lib/roles.ts`:
the card "מי מחליט על מה" and the reasons describe them and follow them. `approvals/pay-run/**`. The settings
screen. `apps/web/e2e/__screenshots__/DS3-04/**` (DS3-04's evidence). In `messages/approvals`, the groups
`types`, `severity`, `resolution`, `decision`, `rules` and `tolerance` keep their keys, and so do the exports
of `vocab.ts` (`approvals/__tests__/vocab.test.ts:136` pins the decision words): about twenty files outside
the area read them (21 on `main@9dd26ef9`, test files aside), among them the invoice screen, which reads
`tolerance` through `toleranceLabel` (`apps/web/app/dashboard/invoices/[invoiceId]/page.tsx:18`, `:175-177`;
`approvals/vocab.ts:62-67`).

`packages/api/src/__tests__/approvals-queue-fields.test.ts` (DS3-04's test of the `myQueue` fields): you are the
first to run it against `INV-00`'s router, and neither of you may edit it. If `INV-00`'s fields turn it red
on your branch, that is a request to `INV-00`.

No `loading.tsx`, `layout.tsx` or `template.tsx` directly under `apps/web/app/dashboard/approvals/`: Next.js
applies them to `approvals/pay-run` too, which is `INV-03`'s route. `approvals/loading.tsx` was removed on
purpose (`apps/web/app/dashboard/approvals/pay-run/page.tsx:277-278`), and
`apps/web/scripts/check-soft-nav.mjs:183-198` probes both routes. Keep the skeleton as a component, as DS3-04
does (`approvals/skeleton.tsx`).

**Slices, in build order.**
0. **The base.** If `claude/ds3-04-approvals-desk` has not taken current `main` and the lead said the merge
   is yours, merge `main` and resolve `approvals/list.tsx` as S10 says. Run the desk's suites on the result
   before anything else. From then on your resolution is the one (S10).
1. **The decision for one gap, exported** (S9), taken out of the queue controller and used first by the
   desk's own single-invoice route (`apps/web/app/dashboard/approvals/[invoiceId]/page.tsx`), so the desk is
   its first user. DS3-04's `s3a-inputs.test.ts` stays green. **Push it: `INV-05` opens on it.**
2. The desk asks for every open gap (`scope: 'all'` in `page.tsx`, `[invoiceId]/page.tsx`, and the first
   page, the reload and the next page of `use-desk.ts`); groups by who decides ("אצלכם", then the other
   roles, then "הוחלט היום"), blocking first and the longest wait first inside a group; the box "ממתין
   לאחרים" goes. **The desk narrowed to one invoice** (`?invoice=`, where every "להחלטה" of the other
   screens lands, S8): the head, "N מתוך M" and the hint count that invoice only, so the filter is visible
   and is cleared in one press; when the invoice's last gap is decided the desk shows the filtered note
   (DS3-04: `approvals/page.tsx:156-157`), never "הכול מטופל" while gaps are open elsewhere.
3. A row the viewer may not decide: the same evidence, the sentence in place of the buttons, the keys 1, 2
   and 3 say the sentence and send nothing; "לקריאה בלבד"; what an empty own group says.
4. The owner on another role's gap: the note "גם אתם רשאים להחליט"; the message and the announcer end with
   "החלטתם במקום הניהול". The role comes from the queue row as it was before the decision (`waitingOn`).
5. The "why" line under every open row and in the evidence, from the shared words; the days as the row's
   meta; the head lines from `queueSummary.byRouting` and `.invoices`.
6. A passed-on gap stays visible to the role that passed it, read-only, and says who passed it and when; the
   owner reads the note. "העבירו לבעלים" is offered where the product offers it today, by `canEscalate`
   (`approvals/vocab.ts:103-105`): any role but the owner, on a gap it may decide that is not the owner's.
   That is the manager on a gap of the manager's or an unrouted one, and the bookkeeper on a duplicate. The
   mock-up draws the manager only; do not take the bookkeeper's pass-on away.
7. "הוחלט היום" from `approvals.decided`: rows that can be picked and stepped through, in calm grey.
8. The card "מי מחליט על מה" from `settings.effective` (`packages/api/src/routers/settings.ts:309-316`), in
   the engine's order, with the base of ₪ and of %: "הסכומים לפני מע״מ, והאחוז מסכום החשבונית כולל מע״מ."
   The 10% in "מחיר שעלה ב־10% ומעלה" is the restaurant's `tolerances.blockPricePercent` from the same read,
   never a literal.
9. Roles, never names: `history.tsx` and `conflicts.ts` print the role, never `actorName`, never "משתמש אחר"
   (DS3-04: `history.tsx:65`, `conflicts.ts:21`). Role words aligned in this area's own file: `roles.manager`
   reads "מנהל" today (`main`: `apps/web/lib/i18n/messages/approvals/he.ts:36`; DS3-04: `:38`) and becomes
   "ניהול". The retired word "הפרש" is also in three labels the desk shows (DS3-04:
   `messages/approvals/he.ts:28`, `:310`, `:314`: `summary.vat`, `amountLabel.vat`, `amountLabel.other`):
   reword them with "פער", both languages, keys unchanged, and name it in the pull request;
   `approvals/__tests__/vocab.test.ts:308` pins one of them and changes with it.
10. The head, the keys legend by what the current row allows, Home / End / PageUp / PageDown, "הכול מטופל"
    only when nothing is open for anyone, the phone, the specs.

**Kept:** the bulk selection and "approve the whole invoice" for rows the viewer may decide, the filters,
saved views and the CSV, the branch strip, the pass-on sheet with its note, the duplicate, "סמנו כנבדק" and
"שייך להזמנה" forms of the bar.

**Defaults until the owner says otherwise** (`SPEC.md` §8). The title stays "תור אישורים" (the mock-up says
"אישורים"). A row shows the days it waits beside the amount. The undo's word stays the product's "בטלו"
(`messages/approvals/he.ts:182`; the mock-up says "ביטול"): one word for both screens, so `INV-05` uses the
desk's. Passing a gap on keeps the desk's sheet with its note. Each is listed in the pull request under "Owner
decisions touched".

**Acceptance.** As owner, manager and bookkeeper at 1440 and 390.
1. Each of the three roles sees every open gap of the demo (4) as rows, in groups by who decides, their own
   first; no "ממתין לאחרים" box; group counts and sums equal `queueSummary` to the agora (read from the
   server, never summed from rows).
2. Every open row has a why-line from the shared words module for its rule. The card "מי מחליט על מה" lists
   the rules in the engine's order with the restaurant's numbers from `settings.effective`, and states the
   base of ₪ and of %.
3. The manager on an owner's gap and the bookkeeper on any gap but a duplicate: no decision button, the
   sentence "ההחלטה אצל …, ואין צורך בפעולה מצדכם."; the keys 1, 2 and 3 change nothing, the sentence is
   announced, and no request is sent.
4. The owner on a manager's gap: decides with the same procedure and input as today; the message and the
   announcer say "החלטתם במקום הניהול"; the audit row has `before.requiresRole = manager` and
   `after.role = owner`.
5. The manager passes a gap on with a note: it moves to "אצל הבעלים", stays visible read-only, says who
   passed it and when; the owner reads the note; an undo inside the window puts it back. The bookkeeper still
   has "העבירו לבעלים" on a duplicate, and the words name the role that passed the gap.
6. A decided gap is under "הוחלט היום" for all three roles, with result and role, in grey; after a reload it
   is still there; an undone one is not.
7. The undo is offered for 10 s, never asked of the server after 12 s (DS3-04: `undo-window.ts:12-18`),
   refused by the server for anyone but the decider; `REOPEN_WINDOW_MS` stays 15 s
   (`packages/api/src/routers/approvals.ts:84`).
8. Every decision still calls the same procedure with the same input: DS3-04's `s3a-inputs.test.ts` and the
   scenarios of `DS3-04.spec.ts` stay green, or change with the reason stated.
9. The exported decision (S9) is used by the desk's own single-invoice route, reads `scope: 'all'`, and
   writes nothing to the address of the page that mounts it.
10. Keys never fire while typing, follow `singleKeysEnabled()`, and work on a Hebrew layout.
11. 390 px: one gap at a time with the who-and-why line; the read-only sentence replaces the buttons; no
    horizontal scroll; targets at least 44 px.
12. With no open gap for anyone: "הכול מטופל". With gaps only for others: never "הכול מטופל". Opened with
    `?invoice=<id>&sel=<gapId>`: the filter is visible and is cleared in one press; after the invoice's last
    gap is decided the desk shows the filtered note and never "הכול מטופל" while gaps are open elsewhere;
    `sel` picks a gap routed to another role too.
13. Tests added. Unit: grouping (role × routing × state, order inside a group), the rules-card rows from
    `settings.effective`, the head sentences, "next after a decision", the read-only refusal in the key
    handlers. e2e `INV-04.spec.ts`: the items above; axe on the desk and on the rules card.
14. The owner's rules of `README.md`, and above all: no ₪ figure in red; colour only on the dot and the
    status word; a decided gap is grey; every ₪ states its VAT basis; one filled button per viewport, and
    "שלמו כפי שחויב" is never the filled one; roles, never names, in the history and in "כבר הוחלט"; no
    engine, routing, data-structure or percentage-base change.

**Open pull requests to watch.** 347 (the base). 360 (in current `main`; slice 0). 190 (`messages/approvals`
+3, `approvals/list.tsx` +12, `pageQuestion` on queue rows, and a decision refused while a page question is
open: keep DS3-04's three seams, `decisionBlockOf`, `blockText` and the bar's `blocked` form, in the read-only
variant too; DS3-04: `desk-facts.ts:640`, `evidence.tsx:48`, `:137`, `decision-bar.tsx:45`). 369 (the
claimable ₪ behind the head's sums: read them from the server, never sum rows). 374 (an undecided gap is "to
decide", never "אפשר לבקש"). 212 (`vocab.test.ts:136` pins the decision words: do not rename `decision.*`).
251, 348 (`W1-05.spec.ts`). 349 (`W1-04.spec.ts`, `demo-path.spec.ts`). 350 (`demo-path.spec.ts`). 359 (a
person's: the rules card follows whatever `main` holds when the package ships).

## INV-05 · Deciding from the invoice screen

**Goal.** Decision 2: the role that may decide decides on the invoice screen, with the desk's own actions,
messages and undo. The owner on another role's gap reads "גם אתם רשאים להחליט" and then "החלטתם במקום
הניהול". Nothing is implemented twice.

**Upstream and base.** Wave 3. Opens when slice 1 of `INV-04` is pushed and `INV-01`'s branch has the gap card
and `gap-actions.tsx` with the whole interface of S7. Starts from `main`; merges
`claude/inv-04-approvals-by-role` and `claude/inv-01-invoice-screen`. Pull request base
`claude/inv-04-approvals-by-role`. Branch `claude/inv-05-decide-on-invoice`. The pull request's first line
states the merge order; until both upstreams are in its base the diff also shows the one that is not.

**Reference.** `reference/reference.html#invoice`: the card's buttons, the question "למה לשלם כפי שחויב?",
the phone's dock, the foot of the whole screen, the state after a decision; `reference/src/inv-invoice.js`;
`reference/checks/verify17.cjs`. What Version 6 of the reference fixed here, to keep: a decision or a press
inside the whole-screen dialog closes the dialog, takes the data pane to its top and puts the focus on a
control that is in sight; the pinned amount bar's button is named "להחלטה על הפער" / "לפרטי הפער" and takes
the focus with no scroll jump; Tab from the undo returns to the screen only when the decision sent the focus
there; "שלמו כפי שחויב" keeps a reason that is already typed; the button's label is the same as on the desk,
"בקשת זיכוי · ₪amount".

**Write boundary.**
- new `apps/web/app/dashboard/invoices/[invoiceId]/decide/**`
- `apps/web/lib/i18n/messages/invoices/decide.ts` (created empty by `INV-00`; only the strings the desk does
  not have: the two lines under the buttons, "לפער הבא שמחכה לכם", "לפער הבא, אצל role")
- new `apps/web/e2e/INV-05.spec.ts`, `apps/web/e2e/INV-05-*.spec.ts`, `apps/web/e2e/__screenshots__/INV-05/**`

**Reserved (beside the boundary, not yours).** `apps/web/app/dashboard/approvals/**` ·
`apps/web/lib/components/desk/**` · `packages/api/src/routers/**`.

**Seams.**
- `apps/web/app/dashboard/invoices/[invoiceId]/gap-actions.tsx` (owner `INV-01`, S7): one import and one
  branch, and no other file of the screen. For a gap the viewer may decide, the branch mounts the decision
  from `[invoiceId]/decide/` in place of the button to the desk; on a decided gap, the button to the next
  gap; the undo message; in the pinned bar, "להחלטה". Everything it needs from the screen arrives as the
  props of S7 (`gap`, `decided`, `slot`, `features`, `screen`). It reads the switch-off key from the
  `features` prop: with the key absent, the button to the desk stays.
- `apps/web/e2e/W2-02.spec.ts` (owner `INV-01`, S6): only the `cockpit-decide` assertions inside the test
  that starts at `:150`.
- The row `invoice-owner-desk` in `apps/web/e2e/ia/screens.ts`: measured again once with the decision
  mounted; the pull request states the numbers before and after. **No row in `apps/web/lib/copy/screens.ts`**
  (`INV-01` adds none): `INV-05.spec.ts` repeats `INV-01.spec.ts`'s copy measurement with the decision
  mounted and states the numbers before and after.
- The switch-off key `decideOnInvoice`, on by default, if the lead keeps it: the key in `FEATURE_KEYS` and in
  `DEFAULT_ON_FEATURES` of `packages/api/src/lib/features.ts` (the precedent is `orderQuestions`, `:49-63`),
  and its mirror in `PILOT_FEATURE_KEYS` of `packages/db/scripts/pilot-setup.ts` (`:61`), each on its own
  line. It is a key in the restaurant's settings, not a schema change; `FEATURES_OFF` switches it off for
  everyone without a deploy of code. One spec sets it `false` and sets it back in `afterAll` (the suite is
  one database). `INV-01` does not depend on the key or on its name: it only passes `features` down. If the
  lead renames the key, the name changes here and in S7; if the lead drops it, these two seams go and the
  pull request says that the only way back is a revert.
  `packages/db/scripts/pilot-setup.ts` is outside `web-feature-engineer`'s paths in `AGENTS.md` (`:125`). It
  is edited because `packages/db/scripts/__tests__/pilot-setup.test.ts:347-348` pins the two key lists equal;
  the one mirrored key follows DS3-05's seam (`docs/ux/ds3/WORKPLAN.md:306-308`) and is named in the pull
  request under "Write boundary". Nothing else under `packages/db`.

**Not yours.** Every file of the desk: import from `apps/web/app/dashboard/approvals/gap-decision/index.ts`
only; what is missing there is a request to `INV-04`. Every router: the four procedures are called as they
are. `gap-actions.tsx` beyond the one branch, and the rest of `INV-01`'s screen.

**Slices, in build order.**
1. The two buttons in the card: "בקשת זיכוי · ₪amount" filled (the claimable ₪ of the queue row,
   `claimAgorot`, never the finding's Δ), "שלמו כפי שחויב" never filled, with the two lines that say what each
   does.
2. The reasons question; "אחר" decides only with words typed; Escape closes it.
3. The undo message, in the place `INV-01` keeps above the dock, and what happens to it when the person
   moves to another invoice with `[`, `]` or the "next gap" button: the move waits (`screen.holdStep`) or
   the message travels.
4. The owner's note and the "במקום" message; "העבירו לבעלים" through the desk's sheet, wherever `canEscalate`
   allows it (the manager on a gap of the manager's or an unrouted one, the bookkeeper on a duplicate).
5. After a decision: the result on the card, the new line in the history, the state word and the payment
   block refreshed, and the one button to the next gap the viewer may decide.
6. The phone's dock and the foot of the whole-screen dialog.
7. Refusals as on the desk: decided elsewhere, the amount changed, forbidden, blocked.
8. The switch and the spec.

**Acceptance.**
1. The requests are the desk's, proven by one test that feeds the same queue row to both:
   `approve { discrepancyId, expectedStatus, seenClaimAgorot }`, `reject { discrepancyId, reason, reasonCode }`,
   `escalate { discrepancyId, note }`, `reopen { discrepancyId }`.
2. The decidable rows, their status and their claimable ₪ come from
   `approvals.myQueue({ scope: 'all', invoiceIds })`, never from the findings of `invoices.detail`. The call
   is not made for a role that may not read the queue.
3. The undo is offered for 10 s, never sent after 12 s, and is not lost by `[`, `]` or the "next gap" button:
   the message travels with the person or the move waits; the pull request says which.
4. Owner, manager, bookkeeper against a gap routed to each: buttons only where `canAct` is true; the owner on
   the manager's gap reads "גם אתם רשאים להחליט" and then "…, החלטתם במקום הניהול"; the manager sees "העבירו
   לבעלים" on a gap of the manager's and never on the owner's; the bookkeeper sees it on a duplicate; the
   owner never sees it; the others read the sentence.
5. "שלמו כפי שחויב" asks the reason first, with the desk's reasons for the gap's kind; "אחר" decides only
   with words typed; Escape closes the question.
6. A row the desk hides, a row the system closed and a review-only row never get a claim button.
7. After a decision: the result with date and time, the role and the reason; one button to the next gap the
   viewer may decide ("לפער הבא שמחכה לכם", or "לפער הבא, אצל role"); the state word of the invoice follows.
   "לפער הבא, אצל הנהלת החשבונות" is five words and a button holds four: propose a shorter label for that
   case under "Owner decisions touched" and do not ship the five-word one (`KNOWN-ISSUES.md`).
   The gap is decided on the desk too, and after an undo it is open on both. A refresh after an undo never
   joins the request still in flight (the lesson of pull request 360).
8. A refusal shows at once and rolls the screen back with the desk's words: decided elsewhere, the amount
   changed, forbidden, blocked.
9. On a phone the two buttons are docked above the bottom bar, and they sit at the foot of the whole-screen
   dialog; a decision made there behaves as the reference does (see "Reference").
10. With the key `false`, the screen is `INV-01`'s: the button to the desk, "לפרטי הפער" in the pinned bar,
    no decision control. No file of `INV-01`'s screen but `gap-actions.tsx` is in the diff.
11. No file of the desk and no router is in the diff. The tenant-security gate reviews: a second screen
    sends money decisions, `invoices.detail` is open to the receiver (`packages/api/src/trpc.ts:186-188`) and
    the queue is not (`packages/api/src/routers/approvals.ts:251-252`).

**Open pull requests to watch.** 190 (the refusal while a page question is open; it also adds a key to
`features.ts` and `pilot-setup.ts`: a textual neighbour). 350 (DS3-05 adds its key to the same two lists).
341 (the allocation field, beside the payment block the decision refreshes). 347 (the desk the decision
comes from).

## INV-06 · Optional: a PDF in the same viewer (opened only if the owner asks and a person can do the storage check)

**Not opened by default.** `INV-01` leaves a supplier's PDF in the browser's own sandboxed frame, as today.
This package replaces the frame with pages drawn by a code library. It opens only if the owner asks for it
and a person can do the third check. It is its own pull request, so the owner decides by merging or closing
it. Nothing else depends on it.

**Upstream and base.** Wave 3. Starts from `main`; merges `claude/inv-01-invoice-screen`. Pull request base
`claude/inv-01-invoice-screen`. Branch `claude/inv-06-pdf-viewer`. Outside this batch it depends on the
owner's word and on a person for the check against real storage.

**Write boundary.** New `apps/web/lib/components/invoice/pdf/**`; new `apps/web/public/pdfjs/**` (the
library's worker file, served from the product's own origin, only if it cannot be bundled by reference); new
`apps/web/e2e/INV-06.spec.ts`, `apps/web/e2e/INV-06/**` (a stored PDF of several pages),
`apps/web/e2e/__screenshots__/INV-06/**`.

**Reserved (beside the boundary, not yours).** `apps/web/lib/securityHeaders.ts` · `apps/web/lib/supabase/**`.

**Seams.** One dependency line with an exact version in `apps/web/package.json` and the matching entries of
`pnpm-lock.yaml`, in the same commit (CI installs with `--frozen-lockfile`). One lazy mount of the PDF stage
in `apps/web/lib/components/invoice/InvoiceScanViewer.tsx` (owner `INV-01`). The library is imported only for
a PDF; any failure to load or draw falls back, at run time, to the sandboxed frame and "פתחו את המקור".

**The three checks, each a stop.**
1. **Licence.** The licence text of the exact version and of what it pulls in, read from the package itself
   and quoted in the pull request. The proposal's "Apache 2.0" was not verified. No CI step can be added for
   it (`.github/workflows/*` is immutable).
2. **Security settings.** The viewer runs with `CSP_ENFORCE=1` and **no change to
   `apps/web/lib/securityHeaders.ts`** (`:70-86`: `script-src 'self' 'nonce-…' 'strict-dynamic' https:
   'unsafe-inline'`; there is no `worker-src`, no `'unsafe-eval'` and no `'wasm-unsafe-eval'`). The library
   never evaluates code from a file and runs no script of the file. `pnpm audit --prod --audit-level=high`
   stays green. An image invoice never downloads the library. The tenant-security gate reviews a supplier's
   file being parsed in the product's own origin instead of an isolated frame.
3. **Loading from storage.** In production the bytes come from a signed URL on the storage host
   (`apps/web/lib/supabase/server.ts:41`, 30 minutes), and a script may read them only if that host allows
   it. A session can prove the local path only (`/scans/<id>/file`, same origin). **A person checks the real
   storage on a preview deployment.** If the storage refuses, the bytes would need a same-origin route, which
   is new server work on a tenant boundary and is not part of this package.

If any check fails, the pull request says so and stays closed; the PDF stays in the browser's viewer.

**Acceptance.** The three checks, each with its evidence in the pull request. A PDF of several pages shows
every page and says "עמוד N מתוך M"; the viewer's tools of `INV-01` (fit, size, turn, drag, keys, the whole
screen, the phone window) work on it as on an image. A PDF that cannot be read shows one calm line and "פתחו
את המקור". An invoice with an image makes no request for the library (a network assertion in the spec). No
violation is reported with `CSP_ENFORCE=1`. `apps/web/lib/securityHeaders.ts` and `apps/web/lib/supabase/**`
are not in the diff.

**Open pull requests to watch.** 377 (dependabot rewrites `pnpm-lock.yaml`: whoever lands second runs the
install again). 190 (several photographed pages become one PDF: draw every page).

---

## Not in this batch

**Step two of decision 7** (the owner's own split): stored positions of lines, the drawn mark, the margin tab
"פער", "הציגו את השורה", opening the document on the gap's line, a row answering the document and a printed
line answering the row, the mock-up's state "עם סימון". It needs line positions from the reading service
(`packages/ocr`, another agent's) and a check against a real reading with keys only a person enters.

**Needs a human change.** No package improvises any of these. Each is an immutable file, the schema, a
credential, or a branch that is not an `INV` session's.
- **Names in the history.** Row security: `packages/db/drizzle/rls/0002_core_tenant_rls.sql:98-101`,
  `packages/db/src/rls.ts`. The batch builds roles only.
- **A recorded payment, "סמנו כשולם", and a "שולמו" place that means something in a real restaurant.** Payment
  columns on `invoices` (pull requests 241, 252). `payRun.markPaid` answers NOT_IMPLEMENTED
  (`packages/api/src/routers/payRun.ts:808-828`).
- **Linking a consolidated invoice to its delivery notes.** The same schema pull request (241).
- **Days waiting that survive a re-match.** The gap rows are replaced
  (`packages/api/src/routers/match.ts:184-193`) and no field stores when a gap was first seen.
- **The reminder ("שלחו תזכורת").** `packages/api/src/notifications/outbox.ts` is immutable and
  `payRun.remind` answers NOT_IMPLEMENTED (`routers/payRun.ts:837-840`).
- **Any change to a routing rule, to who decides what, or to the base of the percentage.**
  `packages/api/src/approvals/engine.ts`.
- **Check 3 of `INV-06`** (loading from real storage) and the reading of the library's licence.
- **Current `main` into `claude/ds3-01-components` and into `claude/ds3-04-approvals-desk`** (S10): their own
  sessions or the lead.
- **The sentence about the percentage's base on the settings screen** (decided 28.11.2026). The folder is
  DS3-06's (pull request 353, a draft that conflicts with current `main`), not an `INV` session's. The lead
  posts the request on 353 when wave 2 opens, with the card's own sentence: "הסכומים לפני מע״מ, והאחוז מסכום
  החשבונית כולל מע״מ." If 353 merges without it, one follow-up pull request adds the sentence. `INV-04`'s
  card states the base inside this area meanwhile.

**Possible without an immutable file, and still left out.**
- **The pay-run total on the home.** DS3-03's final report says that `tasks.mine`'s pay-run total includes an
  invoice the pay-run page holds for a missing allocation number. The code agrees on the cause:
  `computePayRunMonth` builds `totals.payIls` from `payRunStatusOf` alone and never reads `vatAtRisk()`
  (`packages/api/src/routers/payRun.ts:863-959`), and `tasks.mine` reads that figure
  (`packages/api/src/tasks/sources/index.ts:154-170`); `payRun.list` adds the `missing_allocation` hold and
  counts only rows with no hold as payable (`routers/payRun.ts:707-709`, `:471-473`, `:770-776`). The
  assertion that compares the two is `apps/web/e2e/W1-05.spec.ts:344-352`; whether it is red at month end
  was not run. The fix is in `routers/payRun.ts`, which has no writer here and
  four open pull requests on it, and it changes a figure on the home, the task list and the chain, none of
  them this batch's screens. **Named owner: a follow-up server package on `routers/payRun.ts`, after pull
  requests 369 and 374 land, the same one that adopts `packages/api/src/invoices/holding.ts` inside
  `payRun.list`.** `INV-03` does not "fix" it on the screen, and its spec does not compare the two figures.
- **The invoice id in the audit row of a decision.** Two JSON keys and no column, but a change inside the
  decision transaction, and this batch is reads only. Without it the history thins after a re-match
  (`INV-00`, "Known limits").
- **A PDF in the same viewer** (`INV-06`), until the owner asks and the three checks pass.
- **Adopting the shared helper inside `payRun.list`**; the palette's "אישור ריצת תשלומים" (DS3-02's).

**Never decided by the owner, so not built:** passing a gap on with one press and no note (the product's sheet
stays); moving the invoice page under "חשבוניות" in the menu; removing from the list the month links, the
export, the column menus, "להשלמת שורות" or "נכנסות"; removing from the pay run the month filter, the due-date
notices, the selection or the branch strip (its five due sections do go as headings: the approved screen
groups held invoices by who holds them, `SPEC.md` §6.1); removing the bulk actions from the desk; "אתמול" and
"השבוע" beside "הוחלט היום" on the screen (the read takes the period; the screen shows today); a filter of the
queue by routing; a bulk or one-tap decision on the invoice screen; the owner's approval of a payment above an
amount (pull requests 367, 380); a colour for an old gap (the owner said no colour); a stored divider width; a
new feature flag for the list, the pay run or approvals by role.

**Mock-up only:** the role switch "להציג כמו", the switch "המסמך", the demo-day note, the notice that the pay
run is off in the pilot, the drawn papers and their invented suppliers.
