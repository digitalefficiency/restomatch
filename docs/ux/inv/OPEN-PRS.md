# INV · open pull requests inside each boundary

As of 28.11.2026, 11:10 UTC, with `main` at `de5cfcf7`. Two readings stand behind this file, matched against
the write boundaries and the named seams of `WORKPLAN.md` (`packages.json`):

- **08:00 UTC, the changed-file lists of the open pull requests of the repository.** Files are listed against
  each pull request's own base, so a stacked or stale pull request shows more than it will finally change.
- **11:10 UTC, the branches themselves.** For 29 pull requests the branch was fetched and compared with `main`
  from the commit where it left `main`: #120, #181, #187, #190, #198, #201, #204, #212, #251, #258, #299,
  #345 to #349, #353, #356, #359, #363, #369, #370, #373, #374, #380 and #383 to #386. Where a pull request
  is in both readings, the numbers below are the second.

Use the file to know whom you may meet. Check again before you start and before you finish, because this list
ages quickly:

```bash
gh api "repos/{owner}/{repo}/pulls/<number>/files" --paginate --jq '.[] | "\(.status)\t+\(.additions)\t-\(.deletions)\t\(.filename)"'
```

**What was not read again after 08:00 UTC.** The people's stacks #194, #237, #241, #252, #263 and #362; the
draft #350 (DS3-05); #351, #344, #254, #236, #235, #202 and #197; and #31, #15 and #9, which had no file list.
The lists of #241, #252 and #362 (about 1,500 files each) were cut at 600 files. A second pass read in full
their files in the invoice screen's folder, the approvals folder, the routers and the `invoices` and
`approvals` message areas; whatever else lies beyond their first 600 files (`messages/payRun`, for one) was
not read. The branch of #377 (dependabot) was gone from the remote at 11:10 UTC.

**Two pull requests keep growing.** #369 had 15 files at 07:16 UTC, 24 at 07:49 and 58 at 11:01. #190 had 72
at 07:17 and 82 at 09:59. They are the two that meet this batch most. Read both again before you start.

**Merged, and therefore part of `main` at `de5cfcf7`, not collisions.** On the morning of 28.11: #371 ("לא
נספר" in the invoice lines), #306 (the allocation field's file), #264 (the `vat.*` procedures), #360 (the
desk's summary refresh), #355 (payment methods on the pay run), #367 (the pay-approval gate, unwired), #368,
#375, #354 (e2e shards), #327. After them: #341 (the allocation field's mount in `[invoiceId]/page.tsx`, and
its spec `apps/web/e2e/AU-08-cockpit.spec.ts`), #364 (the re-match when a draft order is sent), #329, #376,
#382, #381 (one number of the `settings` row in `apps/web/lib/copy/screens.ts`) and #338. A session that
starts from current `main` already has them.

**The bases of this batch** are pull requests themselves: #346 DS3-00 (base `main`), #345 DS3-01 (base
`claude/ds3-00-foundation`, at `daec849e`), #347 DS3-04 (base `claude/ds3-01-components`, finished at
`a6be4080`). None has merged `main` since `9dc0b934`, and nobody merges `main` into them for this batch:
`WORKPLAN.md`, S10, says what follows.

## The pull requests named below

| # | Base | What it is |
| --- | --- | --- |
| 120 | `main` | The consolidated pool and the note parser (an older draft) |
| 190 | `main` | `ux(G-09)`: multi-page documents on every intake path. Draft, 82 files at 09:59 UTC |
| 194 | `claude/ux-w2-10a-hpr-attack-setup` | `ux(W2-10a)`: claims at decision time. An old stack, 449 files |
| 198 | `claude/ux-g-05-write-kernel` | `ux(G-05)`: `invoices/state.ts`. An old stacked draft; the same content is on `main` |
| 204 | `main` | W2-16, copy focus and the copy guard. An old draft; the guard files it "adds" are on `main` |
| 212 | `main` | `ux(W2-13)`: the copy system. An old draft |
| 237 | not in the lists read | A person's schema proposal (batch 0): `packages/db/src/schema.ts`, `__tests__/fixtures.ts` |
| 241 | `claude/ux-g-03-schema-batch-0` | A person's proposal (H-03), schema batch A. About 1,590 files from an old base |
| 251 | `main` | W2-08, the task spine. An old draft; three files against current `main` |
| 252 | `claude/ux-h-03-schema-batch-a` | A person's proposal (H-04), schema batch B. About 1,590 files from an old base |
| 263 | `claude/ux-h-03-schema-batch-a` | A person's proposal (H-07), the monthly leak close. 336 files from an old base |
| 345, 346 | see above | DS3-01 components, DS3-00 tokens: the clean finish, not on `main` |
| 347 | `claude/ds3-01-components` | DS3-04, the approvals desk. Draft, finished at `a6be4080` |
| 348 | `claude/ds3-01-components` | DS3-03, the owner home. Draft, finished at `a08639d2` |
| 349 | `claude/ds3-01-components` | DS3-02, the shell. Draft; it conflicts with current `main` in nine files |
| 350 | not in the lists read | DS3-05, the delivery check on a phone (`claude/ds3-05-receiving`). Draft |
| 353 | `claude/ds3-01-components` | DS3-06, settings and the preferences store. Draft; it conflicts with current `main` in six files |
| 356 | `main` | `claude/w3-03b-hold`: a notifications settings page and push. Draft, 70 files |
| 359 | `main` | A person's proposal (G-15 Q5): the no-order rule at "₪5,000 ומעלה". `approvals/engine.ts` |
| 362 | not in the lists read | A person's stack on an old base, about 1,500 files |
| 363 | `main` | A person's proposal (H-11c Q1): no % for the receiver on dock prices |
| 369 | `main` | G-14 Q3: every ₪ screen reads the decision table. Draft, 58 files at 11:01 UTC |
| 373 | `main` | `feat(G-04 Q5)`: "נבדק" on consolidated review items. Draft |
| 374 | `main` | G-14 Q1: an undecided gap is "to decide", never "אפשר לבקש". Draft; needs the owner's sign-off |
| 377 | `main` | dependabot, 38 updates: `apps/web/package.json`, `pnpm-lock.yaml`. Its branch was gone at 11:10 UTC |
| 380 | `main` | A person's proposal (W2-03 / G-15b): the owner's pay-approval gate in `payRun.markPaid`. Draft, 7 files |
| 383 | `main` | `claude/web-boot-guard-lazy`. Draft, 9 files, one of them a dependency line |
| 384 | `main` | `claude/w2-03-month-vat-hold`: "home pay-run row == the page it opens". Draft, 13 files |

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
- **#369**: `packages/api/src/routers/approvals.ts` (+27 −71). It rewrites `claimsByRow`, which now returns
  `{ amounts, claimed }`; and in the object `myQueue` returns it rewrites `claimable` and `claimAgorot`
  (`:342-343`) and adds `claimed` before `canAct`. What you do: leave `claimsByRow` alone, add your two row
  facts after `waitingOn` (`:346`), three untouched lines below its hunk, and take the open ₪ from
  `awaitingDecisionDetail`, never from a sum of your own. Either order of landing works.
  `packages/api/src/routers/invoices.ts` was not among its 58 files at 11:01 UTC.
- **#190**: `packages/api/src/routers/approvals.ts` (+36 −1: `pageQuestion` on queue rows, a decision refused
  while a page question is open, and `pageHeld` after `toReview` in the object `computeQueueSummary` returns)
  and `packages/api/src/routers/invoices.ts` (+9 −5: a tenth invoice state, `included`, for a page that is
  counted at the invoice that carries it; it gets a tab value of its own and is left out of the tab counts
  and of the totals). What you do: nothing in its hunks; put your summary fields at the end of the returned
  object. Whoever lands second rebases.
- **#198**: `packages/api/src/invoices/index.ts` (listed as added, +1). The same content is on `main`. Nothing
  to wait for.
- **#194, #263**: `packages/api/src/routers/invoices.ts` (+117 −2 each), and in #194
  `packages/api/src/routers/approvals.ts` (+2 −3). Old stacks.
- **#241, #252, #362**: `packages/api/src/routers/approvals.ts`, `packages/api/src/routers/invoices.ts`,
  `packages/api/src/invoices/index.ts`. Old stacks.

No seam file of yours is in an open pull request (your three seam files are new).

No file in common, and it changes what you build:
- **#190's tenth state.** It also adds the word "נכלל בחשבונית אחרת" to the frozen group `state` of
  `messages/invoices` and a line to `packages/api/src/invoices/state.ts` (+6 −1). The places must stay a
  partition whose sums equal the month's total. If #190 is on `main` before you finish, `places.ts`,
  `state.ts` and the sums of `places[]` need a rule for such an invoice (#190 shows the row and counts its ₪
  only at its carrier): say in your pull request what you did. Do not build for it before it lands.
- **#369** also changes `packages/api/src/approvals/awaiting.ts` (+15 −11), `packages/api/src/lib/claims.ts`
  (+80 −35), `packages/api/src/invoices/state.ts` (+3 −2) and `routers/payRun.ts` (+36 −35); **#374** changes
  `lib/claims.ts` (+23 −1) and three lines of `routers/payRun.ts`. Both move how an invoice's cap is split
  between decided and undecided gaps. None of those files is yours.
- **#384**: `routers/payRun.ts` (+28 −2), a comment in `invoices/state.ts` (+6 −2) and
  `packages/api/src/tasks/sources/index.ts` (+10 −7): the fix of the home's pay-run total. Not yours, and no
  package of this batch fixes that number. Its comment states a rule you already build on: an invoice with
  VAT at risk is held by the pay run whatever its state.
- **#237** (a person's): adds `discrepancies.escalated_from_role` and edits `__tests__/fixtures.ts` (+8). Keep
  the pass-on read behind one function, and your test helpers in `invoice-area.fixtures.ts`.
- **#359** (a person's): changes one rule's wording in `approvals/engine.ts` (+5 −3). Derive the reason tests
  from `buildRules()`, not from literals.
- **#380** (a person's): `payRun.markPaid`, in `routers/payRun.ts` (+32 −1) and
  `packages/api/src/approvals/payApproval.ts` (+63 −3). Neither is in a boundary.
- **The coverage fragment.** No branch read at 11:10 UTC adds a `coverage/IA-*.ts` file, and none exists on
  `main`. The pull requests that were not read again (above) could: look again before you push `IA-04.ts`.

## INV-01

The allocation field's mount (#341) is on `main` now: `WORKPLAN.md`, `INV-01`, "The allocation field", says
what you do with it.

In the boundary:
- **#190**: `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx` (+18 −1: a page-question note above the
  screen), `apps/web/lib/i18n/messages/invoices/he.ts` and `en.ts` (+6 each: a block just before `needsLines`,
  and one word in the group `state`, which is frozen for you too). What you do: keep your change to
  `page.tsx` easy to rebase; do not move the block before `needsLines`. It also makes an invoice's file a PDF
  of several pages: the sandboxed frame shows them through the browser.
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
- **#190**: `apps/web/app/dashboard/invoices/(register)/columns.tsx` (+9 −3), `(register)/page.tsx` (+1),
  `(register)/register-client.tsx` (+1 −1) and `(register)/__tests__/register-columns.test.ts` (+11 −1): the
  tenth invoice state, `included`, as a tab value, a line of `STATE_TONE` and totals that leave such a row
  out. What you do: you keep the three exports of `columns.tsx` for the whole batch (`WORKPLAN.md`, S5), so
  whoever lands second re-adds the state's lines. The place of such an invoice and the sums of the cards are
  `INV-00`'s (its section above).
- **#194, #263**: `apps/web/app/dashboard/invoices/hold-reasons.ts` and
  `apps/web/app/dashboard/invoices/__tests__/hold-reasons.test.ts` (listed as added). Old stacks. Both still
  carry the page this folder replaced (`apps/web/app/dashboard/invoices/page.tsx`): merged as they are, the
  route would have two pages. Say so in your pull request; do not fix it.
- **#241, #252, #362**: every file of `apps/web/app/dashboard/invoices/(register)/` (listed as added), and in
  #241 and #252 `hold-reasons.ts` and its test. Old stacks.

On a seam file:
- **#190**: `apps/web/lib/i18n/messages/invoices/he.ts` and `en.ts` (+6 each: a new block just before
  `needsLines`, and the word `state.included`). What you do: your seam is the group `register` and the keys
  of `needsLines` that are not frozen (`WORKPLAN.md`, S3); keep the first lines of `needsLines` where they
  are, so that the two changes stay textual neighbours and not a conflict. The group `state` is frozen: you
  do not add the word.
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
- The merged **#341**, **#306** and **#264**: an allocation number can be "already asked for". The card's
  line "צריך לבקש מהספק" must not contradict it.
- **#373, #374, #120**: the consolidated panel and its wording. Your sentence for a consolidated invoice has
  to agree with what is on `main` when you ship.
- **#345** (the base): the table, the status pill, the bookkeeper's compact default.

## INV-03

In the boundary:
- **#380** (a person's proposal: the owner's pay-approval gate in `payRun.markPaid`; 7 files at 09:43 UTC,
  three of them yours): `apps/web/app/dashboard/approvals/pay-run/selection.tsx` (+9 −2: one import, and the
  function `errText` at `:100-101`), `apps/web/lib/i18n/messages/payRun/he.ts` and `en.ts` (+1 each: the key
  `batch.ownerOnly`). Only a person merges it. What you do: read it before you start, and keep your own edits
  to those three files small and away from those hunks. No control of yours records a payment.
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

The router you read and never edit (`packages/api/src/routers/payRun.ts`): **#369** (+36 −35), **#374**
(+3 −1), **#190** (+49 −6), **#380** (+32 −1), **#384** (+28 −2), and the old stacks #194 (+49 −9), #263
(+41 −7), #241, #252, #362.

No file in common, and it changes what you build:
- **#384** (draft, `claude/w2-03-month-vat-hold`): the fix of the home's pay-run total, the figure
  `apps/web/e2e/W1-05.spec.ts:344-352` compares with your screen. Not yours: keep the payable total printed,
  fix nothing on the screen, and do not compare the two figures in your spec.
- **#369, #374**: the figure in "פער של ₪X" can move, because the cap of an invoice is split differently.
  Print what the server returns.
- **#353**: the personal density setting meets "dense rows for the bookkeeper". Read the default through the
  store.
- **#345** (the base): the tile, the dot, the pill, the money figure. **#349**: the shell's crumb.
- **#348** (+66 −58) and **#347** (+3 −1): `apps/web/e2e/W1-05.spec.ts`, which reads your screen at
  `:344-352` (the home's "to pay" figure must appear in the page's text). The file is `INV-04`'s seam, for
  the desk's assertions only, and not yours to change. #251 no longer changes it against current `main`.

## INV-04

In the boundary:
- **#347** (DS3-04, at `a6be4080`): the whole desk, 77 files against its base. 34 files under
  `apps/web/app/dashboard/approvals/` (`list.tsx` +47 −1,595; `desk.tsx` removed; `use-desk.ts`,
  `desk-state.ts`, `decision-bar.tsx`, `reasons.tsx`, `sheets.tsx`, `undo-window.ts`, `history.tsx`,
  `conflicts.ts`, `queue.tsx`, `evidence.tsx` and others added), ten files under
  `apps/web/lib/components/desk/`, `apps/web/app/dashboard/lab/desk/_copy.ts`,
  `apps/web/lib/i18n/messages/approvals/he.ts` (+191 −5) and `en.ts` (+192 −5), `apps/web/e2e/W1-07.spec.ts`,
  `apps/web/e2e/W2-04.spec.ts`, `apps/web/e2e/DS3-04.spec.ts` and its 23 evidence screenshots. What you do: it
  is your base. Build on its head and edit nothing through its branch.
- **#369**: `apps/web/app/dashboard/approvals/vocab.ts` (+5 −3: `decisionActions` takes a third argument,
  `claimed`), two lines of `main`'s `apps/web/app/dashboard/approvals/list.tsx`, and
  `apps/web/app/dashboard/approvals/__tests__/vocab.test.ts` (+12). The desk calls `decisionActions` once
  (DS3-04: `desk-facts.ts:630`). What you do: keep the function's signature as `main` has it when you ship;
  whoever lands second passes the third argument from the queue row.
- **#190**: `apps/web/app/dashboard/approvals/list.tsx` (+12 −1), `apps/web/lib/i18n/messages/approvals/he.ts`
  and `en.ts` (+3 each). What you do: DS3-04 left three seams for it (`decisionBlockOf`, `blockText`, the
  bar's `blocked` form). Keep them, in the read-only variant too. Whoever lands second rebases.
- **#194, #263**: `messages/approvals/he.ts` and `en.ts` (one or two lines). Old stacks.
- **#241, #252, #362**: `approvals/[invoiceId]/page.tsx`, `desk.tsx`, `groups.ts`, `list.tsx` (+530 −100),
  `page.tsx`, `vocab.ts`, `__tests__/bulk-cap.test.ts`, `__tests__/vocab.test.ts`, `W1-07.spec.ts`,
  `W2-04.spec.ts`, `messages/approvals/he.ts` and `en.ts`. Old stacks.

On a seam file (in each: only the assertions that read the desk's head, groups or rows are yours):
- `apps/web/e2e/W1-05.spec.ts`: **#348** (+66 −58), **#347** (+3 −1), and the old stacks #194, #263, #241,
  #252, #362. Expect a rebase here. #251 no longer changes it against current `main`.
- `apps/web/e2e/demo-path.spec.ts`: **#350** (+34 −1, as read at 08:00 UTC), **#348** (+9 −4), **#347**
  (+3 −2), **#349** (+2 −1), and #241, #252, #362.
- `apps/web/e2e/W1-04.spec.ts`: **#349** (+10 −5), and #194, #241, #252, #362.
- `apps/web/e2e/pilot/pilot-journey.spec.ts`: #194, #263, #241, #252 (listed as added), #362 (+1 −1).
- `apps/web/lib/copy/screens.ts`, `apps/web/lib/copy/budget.allow.ts`: #204. `apps/web/e2e/ia/screens.ts`,
  `budget.allow.ts`: #241, #252, #362.

No file in common, and it changes what you build:
- **#360** (merged): `approvals/summaryRefresh.ts` and 24 lines of `main`'s `approvals/list.tsx`. It is the
  one conflict between DS3-04's branch and current `main`. The merge is yours, in your own branch, as your
  slice 0; `WORKPLAN.md`, S10, has the resolution.
- **#369**: the claimable ₪ behind the head's sums, and a new field `claimed` on the queue row. Read the sums
  from the server; never sum rows.
- **#374**: an undecided gap is "to decide", never "אפשר לבקש".
- **#212**: `approvals/__tests__/vocab.test.ts:136` pins the decision words to the server's copy. Do not
  rename `decision.*`.
- **#359** (a person's): the rules card follows whatever `approvals/engine.ts` holds on `main` when you ship.
- **#353** (DS3-06): the settings folder, where the sentence about the percentage's base belongs. A request
  the lead sends (`README.md`, "Needs a human change"); your card states the base inside this area. **#356**
  adds `apps/web/app/dashboard/settings/notifications/` to the same folder, which is not yours.

## INV-05

In the boundary: nothing. Its folder and its message file are new.

On a seam file:
- `packages/api/src/lib/features.ts` and `packages/db/scripts/pilot-setup.ts` (the switch-off key
  `decideOnInvoice`): **#190** (+2 and +2: its own key), **#350** (+4 and +2: DS3-05's key, as read at 08:00
  UTC), and the old stacks #194 (+17 −1; `pilot-setup.ts` +630 −385) and #263 (+17 −1; +2). What you do: one
  key in each list, on its own line; whoever lands second re-adds its line.
- `apps/web/e2e/W2-02.spec.ts`, `apps/web/e2e/ia/screens.ts`: #241, #252, #362 (listed as added).
- `apps/web/app/dashboard/invoices/[invoiceId]/gap-actions.tsx`: new, created by `INV-01` with the interface
  of `WORKPLAN.md`, S7; in no pull request.
- `apps/web/e2e/INV-01.spec.ts`: new, created by `INV-01`; in no pull request. Your seam there is
  `WORKPLAN.md`, S6.

No file in common, and it changes what you build:
- **#190**: the server refuses every decision except a pass-on while a page question is open. Show the
  refusal as the desk does (the `blocked` state of what `INV-04` exports).
- **#369**: the queue row gains `claimed`, and a row that already holds a claim keeps its actions with no ₪
  on the button. You mount what `INV-04` exports, so the change reaches you through it.
- The allocation field (on `main`, #341) sits near the payment block of the screen you mount into.
- **#347**, **#360** (merged): the undo and its refresh. A refresh after an undo never joins the request
  still in flight.

## INV-06

In the boundary: nothing. Its folders are new.

On a seam file:
- `apps/web/package.json` and `pnpm-lock.yaml`: **#383**, **#369** and **#356** (each +1 and +3: one
  dependency line and its entries), #204 (+1 in `package.json`), dependabot (#377 at 08:00 UTC: +6 −6 and
  +3,189 −3,198; its branch was gone at 11:10 UTC), and the old stacks #194, #263, #241, #252, #362. What you
  do: whoever lands second runs the install again and commits the lockfile it produces.
- `apps/web/lib/components/invoice/InvoiceScanViewer.tsx`: #241, #252, #362 (listed as added). Old stacks.

No file in common, and it changes what you build:
- **#190**: several photographed pages become one PDF. Draw every page and say "עמוד N מתוך M".

## Open, with no file in any boundary or seam of this batch

From the branches read at 11:10 UTC: #386, #385, #384, #370, #359, #299, #258, #251, #201, #187, #181, and
the ones named above only as neighbours (#374, #373, #363, #353, #346, #345, #212, #120). #384, #380, #374
and #369 edit files this batch gives to nobody (`routers/payRun.ts`, `invoices/state.ts`, `lib/claims.ts`):
read, never edited. From the lists read at 08:00 UTC and not read again: #351, #344, #254, #237, #236, #235,
#202, #197. Not read: #31, #15, #9.
