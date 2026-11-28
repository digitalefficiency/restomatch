# INV · open pull requests inside each boundary

As of 28.11.2026, about 08:00 UTC, from the changed-file lists of the open pull requests of the repository,
matched against the write boundaries and the named seams of `WORKPLAN.md` (`packages.json`). Files are listed
against each pull request's own base, so a stacked or stale pull request shows more than it will finally
change. Use it to know whom you may meet. Check again before you start and before you finish, because this
list ages quickly:

```bash
gh api "repos/{owner}/{repo}/pulls/<number>/files" --paginate --jq '.[] | "\(.status)\t+\(.additions)\t-\(.deletions)\t\(.filename)"'
```

**What was read.** 48 pull requests were open. A file list was read for 44 of them. Four have none: #380 (three
files, not listed; by its title it changes `payRun.markPaid`), #31, #15 and #9. The lists of #241, #252 and
#362 (about 1,500 files each) were cut at 600 files. A second pass read in full their files in the invoice
screen's folder, the approvals folder, the routers and the `invoices` and `approvals` message areas; whatever
else lies beyond their first 600 files (`messages/payRun`, for one) was not read. The lists were not read
again after 08:00 UTC.

**Four pull requests grew after their lists were read**, so their newest files are not below: #369 (15 files
at 07:16 UTC, 24 at 07:49), #190 (72 at 07:17, 79 at 07:37), #359 (4, then 5) and #356 (43, then 52). #369 and
#190 are the two that meet this batch most. Read both again before you start.

**Merged on the morning of 28.11 and therefore part of current `main` (`9dd26ef9`), not collisions:** #371
("לא נספר" in the invoice lines), #306 (the allocation field's file, which nothing mounts yet), #264 (the
`vat.*` procedures), #360 (the desk's summary refresh), #355 (payment methods on the pay run), #367 (the
pay-approval gate, unwired), #368, #375, #354 (e2e shards), #327. A session that starts from current `main`
already has them.

**Merged after the lists were read and after `9dd26ef9`** (they are on `main@de5cfcf7`, 28.11.2026 10:18
UTC): #341 (the allocation field's mount in `[invoiceId]/page.tsx`, and its spec
`apps/web/e2e/AU-08-cockpit.spec.ts`), #364 (the re-match when a draft order is sent), #376, #329, #338, #381
(one number of the `settings` row in `apps/web/lib/copy/screens.ts`) and #382. Where a section below still
calls #341 or #364 open, read "merged".

**The bases of this batch** are pull requests themselves: #346 DS3-00 (base `main`), #345 DS3-01 (base
`claude/ds3-00-foundation`), #347 DS3-04 (base `claude/ds3-01-components`, finished at `be22850e`). None has
merged `main` since `9dc0b934`. `WORKPLAN.md`, S10, says what is asked of them before a wave opens.

## The pull requests named below

| # | Base | What it is |
| --- | --- | --- |
| 120 | `main` | The consolidated pool and the note parser (an older draft) |
| 190 | `main` | `ux(G-09)`: multi-page documents on every intake path. Draft, updated 28.11; 72 of its 79 files were read |
| 194 | `claude/ux-w2-10a-hpr-attack-setup` | `ux(W2-10a)`: claims at decision time. An old stack, 449 files |
| 198 | `claude/ux-g-05-write-kernel` | `ux(G-05)`: `invoices/state.ts`. An old stacked draft; the same content is on `main` |
| 204 | `main` | W2-16, copy focus and the copy guard. An old draft; the guard files it "adds" are on `main` |
| 212 | `main` | `ux(W2-13)`: the copy system. An old draft |
| 237 | not in the lists read | A person's schema proposal (batch 0): `packages/db/src/schema.ts`, `__tests__/fixtures.ts` |
| 241 | `claude/ux-g-03-schema-batch-0` | A person's proposal (H-03), schema batch A. About 1,590 files from an old base |
| 251 | `main` | W2-08, the task spine. An old draft, 99 files |
| 252 | `claude/ux-h-03-schema-batch-a` | A person's proposal (H-04), schema batch B. About 1,590 files from an old base |
| 263 | `claude/ux-h-03-schema-batch-a` | A person's proposal (H-07), the monthly leak close. 336 files from an old base |
| 341 | `main` | AU-08: mount the allocation-number field on the invoice screen. Draft, 3 files |
| 345, 346 | see above | DS3-01 components, DS3-00 tokens: the clean finish, not on `main` |
| 347 | `claude/ds3-01-components` | DS3-04, the approvals desk. Draft, finished at `be22850e` |
| 348 | `claude/ds3-01-components` | DS3-03, the owner home. Draft, finished at `248b4e6c` |
| 349 | `claude/ds3-01-components` | DS3-02, the shell. Draft; it conflicts with current `main` in nine files |
| 350 | not in the lists read | DS3-05, the delivery check on a phone (`claude/ds3-05-receiving`). Draft |
| 353 | `claude/ds3-01-components` | DS3-06, settings and the preferences store. Draft; it conflicts with current `main` |
| 359 | `main` | A person's proposal (G-15 Q5): the no-order rule at "₪5,000 ומעלה". `approvals/engine.ts` |
| 362 | not in the lists read | A person's stack on an old base, about 1,500 files |
| 363 | `main` | A person's proposal (H-11c Q1): no % for the receiver on dock prices |
| 364 | `main` | `feat(G-04 Q4)`: re-match automatically when a draft order is sent. Draft, 4 files |
| 369 | `main` | G-14 Q3: every ₪ screen reads the decision table. Draft, updated 28.11; 15 of its 24 files were read |
| 373 | `main` | `feat(G-04 Q5)`: "נבדק" on consolidated review items. Draft |
| 374 | `main` | G-14 Q1: an undecided gap is "to decide", never "אפשר לבקש". Draft; needs the owner's sign-off |
| 377 | `main` | dependabot, 38 updates: `apps/web/package.json`, `pnpm-lock.yaml` |
| 380 | `main` | A person's proposal (W2-03 / G-15b): the owner's pay-approval gate in `payRun.markPaid`. Draft, 3 files |

**The old stacks (#194, #241, #252, #263, #362).** Their bases are older than the screens of this area, so
their lists show whole folders as "added" although the files are on `main`. What they would really change
against today's `main` could not be read from the lists. They are people's pull requests and are never a
base. #241 is where the payment record and the consolidated links wait. They are named once per package below
and need no action, unless one of them is revived and rebased while you work.

## INV-00

In the boundary:
- **#347**: `packages/api/src/routers/approvals.ts` (+9 −1: four select fields of `myQueue` and the first
  line of the returned object). What you do: `WORKPLAN.md`, S1. Add no select field to `myQueue`; put `reason`
  and `passedOn` after `waitingOn`. Whoever lands second has at most a mechanical merge.
- **#369**: `packages/api/src/routers/approvals.ts` (+8 −64: `claimsByRow`). What you do: leave `claimsByRow`
  alone, and take the open ₪ from `awaitingDecisionDetail`, never from a sum of your own. Either order of
  landing works. Nine of its files were added after the list was read: check whether one of them is
  `packages/api/src/routers/invoices.ts` before you start.
- **#190**: `packages/api/src/routers/approvals.ts` (+33: `pageQuestion` on queue rows, and a decision refused
  while a page question is open). What you do: nothing in its hunks; whoever lands second rebases.
- **#198**: `packages/api/src/invoices/index.ts` (listed as added, +1). The same content is on `main`. Nothing
  to wait for.
- **#194, #263**: `packages/api/src/routers/invoices.ts` (+117 −2 each), and in #194
  `packages/api/src/routers/approvals.ts` (+2 −3). Old stacks.
- **#241, #252, #362**: `packages/api/src/routers/approvals.ts`, `packages/api/src/routers/invoices.ts`,
  `packages/api/src/invoices/index.ts`. Old stacks.

No seam file of yours is in an open pull request (your three seam files are new).

No file in common, and it changes what you build:
- **#369** also changes one line of `packages/api/src/invoices/state.ts` and `routers/payRun.ts`; **#374**
  changes `packages/api/src/lib/claims.ts` and three lines of `routers/payRun.ts`. Both move how an invoice's
  cap is split between decided and undecided gaps. None of those files is yours.
- **#364**: a re-match when an order is sent, so "since when" restarts more often. State it as a known limit.
- **#237** (a person's): adds `discrepancies.escalated_from_role` and edits `__tests__/fixtures.ts` (+8). Keep
  the pass-on read behind one function, and your test helpers in `invoice-area.fixtures.ts`.
- **#359** (a person's): changes one rule's wording in `approvals/engine.ts` (+5 −3). Derive the reason tests
  from `buildRules()`, not from literals.
- **#380** (a person's): `payRun.markPaid`. `routers/payRun.ts` is in no boundary.
- **The coverage fragment.** No pull request in the lists read adds a `coverage/IA-*.ts` file, and none
  exists on `main`. The lists of #241, #252 and #362 are cut and #380, #31, #15 and #9 have none: look again
  before you push `IA-04.ts`.

## INV-01

In the boundary:
- **#341** (merged after `9dd26ef9`): `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx` (+7: the
  allocation field mounted in the side block). At `9dd26ef9` the field is a file that nothing mounts; this
  pull request is its mount. What you do: add no mount of your own. The payment block ends with one named
  wrapper for it, and #341's one mount moves into that wrapper, unchanged. Its other file,
  `[invoiceId]/allocation-field.tsx` (+4 −1), is reserved: never edit it. Its third file is a spec of its own
  on this page (`apps/web/e2e/AU-08-cockpit.spec.ts`): keep it green, do not change it.
- **#190**: `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx` (+18 −1: a page-question note above the
  screen), `apps/web/lib/i18n/messages/invoices/he.ts` and `en.ts` (+5 each, just before `needsLines`). What
  you do: keep your change to `page.tsx` easy to rebase; do not move the block before `needsLines`. It also
  makes an invoice's file a PDF of several pages: the sandboxed frame shows them through the browser.
- **#194, #263**: `[invoiceId]/correction-client.tsx` (+297 −16), `[invoiceId]/page.tsx` (+35),
  `messages/invoices/he.ts` (+78 −5), `en.ts` (+73). Old stacks.
- **#241, #252, #362**: the whole folder `[invoiceId]/` (cockpit, page, layout, load, loading, partial,
  correction-client), `apps/web/lib/components/invoice/**`, `apps/web/e2e/W2-02.spec.ts`,
  `messages/invoices/he.ts` and `en.ts`. Old stacks.

On a seam file:
- **#204**: `apps/web/lib/copy/budget.allow.ts` (listed as added; it is on `main`). An old draft. Nothing to
  do. (You have no seam in `apps/web/lib/copy/screens.ts`: the invoice screen gets no row there.)
- **#241, #252, #362**: `apps/web/e2e/ia/screens.ts`, `apps/web/lib/copy/budget.allow.ts` (listed as added).

Reserved files inside your folders, changed by others (never edit them):
- `[invoiceId]/consolidated-panel.tsx` and its test: **#373** (+19 −3; +42 −7), **#374** (+15 −3; +42),
  **#120** (+7 −1).
- `[invoiceId]/review-button.tsx`: **#373** adds it (+57).
- `[invoiceId]/dock-price-notes.tsx`: **#363** (+2 −1).

No file in common, and it changes what you build:
- **#190** also edits `apps/web/lib/supabase/server.ts` (+7), which is nobody's. If the viewer seems to need
  that file, stop and say so.
- **#349** (the shell): `apps/web/lib/hotkeys.ts` already yields `[` on this route. **#353** (the preferences
  store): read through `usePrefs()` and `singleKeysEnabled()`.
- **#369**: the numbers behind `invoices.detail` can move. Print what the server returns.

## INV-02

In the boundary:
- **#194, #263**: `apps/web/app/dashboard/invoices/hold-reasons.ts` and
  `apps/web/app/dashboard/invoices/__tests__/hold-reasons.test.ts` (listed as added). Old stacks. Both still
  carry the page this folder replaced (`apps/web/app/dashboard/invoices/page.tsx`): merged as they are, the
  route would have two pages. Say so in your pull request; do not fix it.
- **#241, #252, #362**: every file of `apps/web/app/dashboard/invoices/(register)/` (listed as added), and in
  #241 and #252 `hold-reasons.ts` and its test. Old stacks.

On a seam file:
- **#190**: `apps/web/lib/i18n/messages/invoices/he.ts` and `en.ts` (+5 each, a new block just before
  `needsLines`). What you do: your seam is the group `register` and the keys of `needsLines` that are not
  frozen (`WORKPLAN.md`, S3); keep the first lines of `needsLines` where they are, so that the two changes
  stay textual neighbours and not a conflict.
- **#194, #263, #241, #252, #362**: the same two message files; and in #241, #252 and #362
  `apps/web/e2e/W2-02.spec.ts`, `apps/web/e2e/ia/screens.ts`, `apps/web/lib/copy/budget.allow.ts` (listed as
  added). Old stacks.
- **#204**: `apps/web/lib/copy/screens.ts`, `apps/web/lib/copy/budget.allow.ts`. An old draft.

A spec nobody owns, which your screen must keep green (`apps/web/e2e/pilot-unread-invoices.spec.ts`):
**#348** changes one line of it (+1 −1); #362 changes 43 lines of it from an old base.

No file in common, and it changes what you build:
- **#369**: `packages/api/src/invoices/state.ts` (+3 −2). A gap the engine closed inside the tolerance no
  longer makes an invoice "לבקשת זיכוי", so some invoices move to "תקינה". You read the state; you do not
  edit `state.ts`.
- **#341**, and the merged #306 and #264: an allocation number can be "already asked for". The card's line
  "צריך לבקש מהספק" must not contradict it.
- **#373, #374, #120**: the consolidated panel and its wording. Your sentence for a consolidated invoice has
  to agree with what is on `main` when you ship.
- **#345** (the base): the table, the status pill, the bookkeeper's compact default.

## INV-03

In the boundary:
- **#190**: `apps/web/app/dashboard/approvals/pay-run/page.tsx` (+26), `apps/web/lib/i18n/messages/payRun/he.ts`
  and `en.ts` (+8 each): two new reasons an invoice is held (a page question, "included in"), with their own
  actions. What you do: keep "reason → group" as one typed table, so that whoever lands second re-adds two
  lines.
- **#194, #263**: `pay-run/page.tsx` (+26 −3), `messages/payRun/he.ts` and `en.ts` (+4 −1). Old stacks; #194's
  hunk is written against the page as it was before the pay run was rebuilt.
- **#241, #252, #362**: `pay-run/error.tsx`, `export-button.tsx`, `page.tsx`, `selection.tsx`,
  `apps/web/e2e/W2-03.spec.ts` (most listed as added although they are on `main`). Old stacks.

On a seam file:
- **#204**: `apps/web/lib/copy/screens.ts`, `apps/web/lib/copy/budget.allow.ts`. An old draft.
- **#241, #252, #362**: `apps/web/e2e/ia/screens.ts`, `apps/web/lib/copy/budget.allow.ts`.

The router you read and never edit (`packages/api/src/routers/payRun.ts`): **#369** (+31 −33), **#374**
(+3 −1), **#190** (+49 −6), **#380** (by its title), and the old stacks #194 (+49 −9), #263 (+41 −7), #241,
#252, #362.

No file in common, and it changes what you build:
- **#369, #374**: the figure in "פער של ₪X" can move, because the cap of an invoice is split differently.
  Print what the server returns.
- **#380** (a person's): a pay-approval gate in `markPaid`, behind the flag. No control of yours records a
  payment.
- **#353**: the personal density setting meets "dense rows for the bookkeeper". Read the default through the
  store.
- **#345** (the base): the tile, the dot, the pill, the money figure. **#349**: the shell's crumb.
- **#348**, **#251**, **#347**: `apps/web/e2e/W1-05.spec.ts`, which reads your screen at `:344-352` (the
  home's "to pay" figure must appear in the page's text). The file is `INV-04`'s seam, for the desk's
  assertions only, and not yours to change: keep the payable total printed.

## INV-04

In the boundary:
- **#347** (DS3-04): the whole desk. 34 files under `apps/web/app/dashboard/approvals/` (`list.tsx` +47
  −1,595; `desk.tsx` removed; `use-desk.ts`, `desk-state.ts`, `decision-bar.tsx`, `reasons.tsx`, `sheets.tsx`,
  `undo-window.ts`, `history.tsx`, `conflicts.ts`, `queue.tsx`, `evidence.tsx` and others added), ten files
  under `apps/web/lib/components/desk/`, `apps/web/app/dashboard/lab/desk/_copy.ts`,
  `apps/web/lib/i18n/messages/approvals/he.ts` (+191 −5) and `en.ts` (+192 −5), `apps/web/e2e/W1-07.spec.ts`,
  `apps/web/e2e/W2-04.spec.ts`. That list is from 08:00 UTC; the finished head also holds
  `apps/web/e2e/DS3-04.spec.ts`. What you do: it is your base. Build on its head and edit nothing through its
  branch.
- **#190**: `apps/web/app/dashboard/approvals/list.tsx` (+12 −1), `apps/web/lib/i18n/messages/approvals/he.ts`
  and `en.ts` (+3 each). What you do: DS3-04 left three seams for it (`decisionBlockOf`, `blockText`, the
  bar's `blocked` form). Keep them, in the read-only variant too. Whoever lands second rebases.
- **#194, #263**: `messages/approvals/he.ts` and `en.ts` (one or two lines). Old stacks.
- **#241, #252, #362**: `approvals/[invoiceId]/page.tsx`, `desk.tsx`, `groups.ts`, `list.tsx` (+530 −100),
  `page.tsx`, `vocab.ts`, `__tests__/bulk-cap.test.ts`, `__tests__/vocab.test.ts`, `W1-07.spec.ts`,
  `W2-04.spec.ts`, `messages/approvals/he.ts` and `en.ts`. Old stacks.

On a seam file (in each: only the assertions that read the desk's head, groups or rows are yours):
- `apps/web/e2e/W1-05.spec.ts`: **#348** (+66 −58), **#251** (+14 −12), **#347** (+3 −1), and the old stacks
  #194, #263, #241, #252, #362. Expect a rebase here.
- `apps/web/e2e/demo-path.spec.ts`: **#350** (+34 −1), **#348** (+6 −3), **#349** (+2 −1), and #241, #252,
  #362.
- `apps/web/e2e/W1-04.spec.ts`: **#349** (+10 −5), and #194, #241, #252, #362.
- `apps/web/e2e/pilot/pilot-journey.spec.ts`: #194, #263, #241, #252 (listed as added), #362 (+1 −1).
- `apps/web/lib/copy/screens.ts`, `apps/web/lib/copy/budget.allow.ts`: #204. `apps/web/e2e/ia/screens.ts`,
  `budget.allow.ts`: #241, #252, #362.

No file in common, and it changes what you build:
- **#360** (merged): `approvals/summaryRefresh.ts` and 24 lines of `main`'s `approvals/list.tsx`. It is the
  one conflict between DS3-04's branch and current `main`; `WORKPLAN.md`, S10, has the resolution.
- **#369**: the claimable ₪ behind the head's sums. Read them from the server; never sum rows.
- **#374**: an undecided gap is "to decide", never "אפשר לבקש".
- **#212**: `approvals/__tests__/vocab.test.ts:136` pins the decision words to the server's copy. Do not
  rename `decision.*`.
- **#359** (a person's): the rules card follows whatever `approvals/engine.ts` holds on `main` when you ship.
- **#353** (DS3-06): the settings folder, where the sentence about the percentage's base belongs. A request
  the lead sends (`README.md`, "Needs a human change"); your card states the base inside this area.

## INV-05

In the boundary: nothing. Its folder and its message file are new.

On a seam file:
- `packages/api/src/lib/features.ts` and `packages/db/scripts/pilot-setup.ts` (the switch-off key
  `decideOnInvoice`, if the lead keeps it): **#190** (+2 and +2: its own key), **#350** (+4 and +2: DS3-05's
  key), and the old stacks #194 (+17 −1; `pilot-setup.ts` +630 −385) and #263 (+17 −1; +2). What you do: one
  key in each list, on its own line; whoever lands second re-adds its line.
- `apps/web/e2e/W2-02.spec.ts`, `apps/web/e2e/ia/screens.ts`: #241, #252, #362 (listed as added).
- `apps/web/app/dashboard/invoices/[invoiceId]/gap-actions.tsx`: new, created by `INV-01` with the interface
  of `WORKPLAN.md`, S7; in no pull request.

No file in common, and it changes what you build:
- **#190**: the server refuses every decision except a pass-on while a page question is open. Show the
  refusal as the desk does (the `blocked` state of what `INV-04` exports).
- **#341**: the allocation field sits near the payment block of the screen you mount into.
- **#347**, **#360** (merged): the undo and its refresh. A refresh after an undo never joins the request
  still in flight.

## INV-06

In the boundary: nothing. Its folders are new.

On a seam file:
- `apps/web/package.json` and `pnpm-lock.yaml`: **#377** (dependabot: +6 −6 and +3,189 −3,198). What you do:
  whoever lands second runs the install again and commits the lockfile it produces. Also #204 (+1 in
  `package.json`) and the old stacks #194, #263, #241, #252, #362.
- `apps/web/lib/components/invoice/InvoiceScanViewer.tsx`: #241, #252, #362 (listed as added). Old stacks.

No file in common, and it changes what you build:
- **#190**: several photographed pages become one PDF. Draw every page and say "עמוד N מתוך M".

## Open, with no file in any boundary or seam of this batch

By the lists read: #376, #370, #356, #351, #344, #338, #329, #299, #258, #254, #236, #235, #202, #201, #197,
#187, #181, and the ones named above only as neighbours (#374, #373, #364, #363, #359, #353, #346, #345, #237,
#212, #120). Not read: #380, #31, #15, #9.
