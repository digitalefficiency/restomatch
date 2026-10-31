# Wave-2 kit: completeness critique (31.10)

Scope: README.md, lab.sh and the 28 briefs (W2-01..W2-15, G-04..G-13, H-01..H-03), checked against `release/wave-1 @ 76ca5ca5`, MASTER-PLAN, IMPLEMENTATION-PLAN, GAP-PACKAGES, DEEP-FIX and AGENTS.md. Every fix below was made in place. A pre-fix snapshot is outside the kit, in the critic scratch folder.

## Verdict per check
| # | Check | Result |
|---|---|---|
| 1 | Structure | All 28 briefs exist and have §1–§8. No change needed. |
| 2 | Start-here paths | Every repo path checked against the checkout's `git ls-files`, with suffix matching and brace expansion. Paths not in the checkout are new files the brief creates (marked "new"), files a dependency creates (marked as such) or code identifiers. **8 broken pointers fixed** (see A). |
| 3 | Boundaries | The write sets are disjoint. The pairwise matrix found 1 real shared file, `packages/api/src/index.ts`, where G-06, G-12 and W2-13 each add one export line, serialised by the orchestrator (already a plan rule). No agent package owns an immutable file. Every human-PR brief says "proposal branch, draft PR, STOP". The ledger was **out of sync with 7 briefs** (see C). |
| 4 | Acceptance | The criteria are testable. No brief shows a "1.5% target". Bulk ₪200 / one-tap ₪500 / never-bulk-a-blocker are server-enforced in W2-04 with an attack test. **4 owner-decision gaps fixed** (see B). |
| 5 | Dependencies | They match the MASTER-PLAN table. One package listed later-wave items as deps (W2-03: G-14/G-15), now fixed. Two deliberate deviations are flagged for the orchestrator (see E). |
| 6 | Token notes | All 28 §8 sections are concrete: line ranges, file sizes, reuse targets and named traps. 2 notes pointed at files outside the repo, now fixed. |
| 7 | README | It has the start order, the ledger and the token rules. The batches were re-cut to A/B/C, and the ledger and lab sections were corrected (see C, D). |
| 8 | lab.sh | `bash -n` passes. No secrets: the demo password is read from `seed.ts`, and the keys are labelled placeholders. The scrub list was missing a few app env families (see D). |

## A. Broken pointers (sessions would have read nothing)
1. G-06, G-11, G-13, H-02 cited `ux/deep/DEEP-FIX.he.md` and `ux/deep/GAP-PACKAGES.md` "(kit copy)", but no kit copy existed and `docs/ux/deep/` is not in the repo. **Fix:** the kit now ships verbatim copies in `ref/` (`DEEP-FIX.he.md`, `GAP-PACKAGES.md`, `MASTER-PLAN.he.md`), so the cited line ranges hold (verified: class 14 at 701, class 15 at 754, class 12 at 604, G-02 at 31). The pointers now read `docs/ux/wave2/ref/…`, and README §11 documents them.
2. G-06 cited `ux/wave2-kit/G-05.md`. Now `docs/ux/wave2/G-05.md`.
3. W2-13 cited the scratchpad lab `ux/review/scripts/copylab/{lab.mjs,lab-output.txt}`. It is now copied to `ref/copylab/`; README tells sessions to read the output and not re-run it (hard-coded local paths).
4. H-01 and W2-14 told sessions to query `all-findings.json`, which is not in the repo. Both now use `grep -n '<id>' docs/ux/review/*.md`.
5. G-07 pointed at a hashed `node_modules/.pnpm/…/initTRPC-BRf4imah.mjs` path, which contradicts the never-read-node_modules rule and breaks on reinstall. It is now a stated fact, with a 5-line test as the way to verify it.
6. G-10 said `lib/legal` "arrives with W1-12a". W1-12a never created it; G-11 does. Corrected.
7. W2-09b had no branch name. It is now `claude/ux-w2-09b-drill-helpers`.

## B. Owner decisions not yet carried by acceptance
1. **W2-03.** It lacked decision 19 (one channel per state) and the receiver/chef rule. Added AC 13: short-pay offsets only invoices unpaid until this run; a paid invoice's claim goes on a letter; no claim is both deducted and on a letter (shared parity test). Added AC 14: `payRun.*` is finance tier, receiver and chef get FORBIDDEN (attack test), and they see no pay-run ₪.
2. **W2-05.** The decision-20 spot check appeared only as "keep W1-06". Added an explicit AC: "הכל הגיע" asks for the 2-line spot check, the rest is "לא נספר", and a server test asserts the uncounted ids are recorded.
3. **W2-14.** It owns team/invites but had no per-person sign-in rule. Added AC 17: one login per person (own e-mail + password), no PIN, shared-device or role login, and an invite always targets one e-mail.
4. **AuditAction gaps.** W2-06 (`order.*`), W2-07 (`inventory.sales_set`, `inventory.count_submitted`) and W2-12 (`contracts.*`, `price_alert.*`) each needed values that G-05's pre-add list lacked. That meant three day-1 round trips, and W2-07's said outright "not in G-05's list". **Fix:** G-05's pre-add list now has all 9 values, shipped in its PR (a), and the three adopter briefs say so.

## C. Boundaries and ledger
1. The README listed `routers/mapping` and `routers/catalog` as unowned, while G-08's brief claims narrow ledger additions in both. The README G-08 row now carries them (mapping provenance + review rows; catalog `:706` only), and the unowned list was trimmed.
2. Ledger rows completed from the briefs:
   - W2-05: `e2e/W1-06.spec.ts`, selectors only.
   - W2-08: `nav-registry.test.ts`, plus badge-key-only edits in the 7 unowned route files.
   - W2-12: `contracts-logic.test.ts`.
   - G-08: `pipeline.test.ts`.
   - G-11: `publicPaths.test.ts` plus the 3 boundary additions (AuthShell footer, ShowcaseFooter links, 2 marketing keys).
   - H-02: the `lib/legal` tests and `fly.toml`/`render.yaml` if G-02 is absent.
   - H-03: the add-only RLS probe block in `rls.attack.test.ts` and `released-migrations.json`.
3. New README list, **cross-boundary exceptions**, each orchestrator-approved and named in the PR:
   - the three `index.ts` export lines;
   - G-06 rewriting `recovery.test.ts:307-321` (W2-10's file; stricter assertions only);
   - W2-13 moving the `localizeActivity` block out of W2-15's `ops-components.test.ts`;
   - H-02's `contact.ts` values and its 3 e2e fixture lines;
   - W2-14's owner-decision assertion flip in `integrations.test.ts`.
4. W2-01 AC 1 said `COVERAGE = { ...BASE_COVERAGE, ...fragments }`. A spread silently lets a fragment override (downgrade) a base entry, which is the exact failure its own §8 forbids. It now reads `mergeCoverage(BASE_COVERAGE, loadFragments())`. Its list of fragment owners named G-14 (wave 3) as a wave-2 owner and missed the G packages; it now reads "every package that adds a procedure".

## D. Lab, safety and README mechanics
1. **Production-write risk.** 16 briefs ran a bare `pnpm --filter @restomatch/db migrate`. W2-09/10/11 chained it after the lab, W2-13 chained it before its tests, and W2-01 and H-03 hard-coded `postgres://…/restomatch_test`. A session that inherited a remote `DATABASE_URL` would have migrated it. **Fix:**
   - every command block now opens with "run each DB/test/e2e command as `. ~/.rm-lab/<slug>/env && …`";
   - every migrate line is env-prefixed and marked "only after a rebase brings a new migration";
   - the hard-coded URLs are gone;
   - README §3 has a hard safety rule.
2. **Slug.** The lab writes `~/.rm-lab/<slug>/` (`w2_09`), but the README said `~/.rm-lab/<id>/`, so `. ~/.rm-lab/W2-09/env` would have failed. The README now defines the slug, and every brief uses its literal slug.
3. **`--tests-only`.**
   - W2-01, G-04, G-05, G-06, G-07 and G-08 ran a full `next build` for no UI. They now use `--tests-only`. G-07 runs one full lab before its PR, to check receiver/chef home.
   - H-03 uses `--tests-only` then `--reseed`: a seeded DB for the run-twice migration check, with the exact command.
   - G-09 was in both the `--tests-only` and `--stub` lists, and its simulator targeted `:3000` against a production `next start` that refuses dev webhook secrets. It now uses `--tests-only`, plus `--dev` on :3429 with `DATABASE_URL="$LAB_DATABASE_URL"` for the optional intake run.
4. README §2 rule 3: the turbo gate is env-prefixed, with a note that a `--tests-only` lab has no `next build` for web `tsc`.
5. **lab.sh scrub list.** Added `POSTHOG_*`, `INGEST_*`, `WORKER_*`, `BLOB_*` and `KV_*`, found in `.env.example`, so lab runs can't post analytics or reach real webhooks. `bash -n` is still clean.
6. README §8 now says human-PR packages open a draft PR and STOP. W2-06, W2-12, W2-14, G-05, G-07, G-08 and G-10 had no "draft PR only / no production writes" line in §7; each now has one.

## E. Start order (A/B/C) and flags for the orchestrator
- The README's 4 batches (A–D) were re-cut to **A/B/C**, keeping the old order within each:
  - **A**, 3.11: the 8 enablers and human proposals;
  - **B**, as A slots free: the 8 interim-capable packages that unblock others, plus H-03;
  - **C**: the rest.
  A batch is a queue tier under the 8-session cap. A session with a green draft PR waiting on review or a dependency frees its slot.
- **H-03 moved from last to batch B.** It is on the MASTER-PLAN critical path ("עד 05.12 W2-03 + W2-04 + W2-10 + H-03"), W2-03's "סמן כשולם" waits on its deploy, its human review is week 5, and a proposal frees its slot fast.
- **Flag 1, G-12 split.** MASTER-PLAN puts G-12 in step 7, but W2-04 (step 5) and W2-08 depend on it. The kit merges G-12a (`awaitingDecision`) right after the step-2 enablers and keeps G-12b in step 7. This needs your confirmation.
- **Flag 2, W2-05 → W2-15.** MASTER-PLAN lists W2-15 as a W2-05 dependency. The brief keeps it soft, because W2-15 hoists its leave guard *from* W2-05's `_fieldHooks.ts`. A hard dependency would be circular.
- **Flag 3, W2-04 → G-06.** MASTER-PLAN lists G-06 as a W2-04 dependency. The brief builds against concrete addresses and now says to switch to `notify()` before leaving draft (G-06 merges in step 4, before W2-04).
- `PAYMENT_LAW_MAX_DAYS_AFTER_EOM` (W2-03) is a proposed 45, pending leak-economist confirmation. It is still open.

## Not changed (checked, fine)
- Effort and humanPR match MASTER-PLAN for all 28.
- Terminology rules (חשבונית מרכזת, פער, דרישת זיכוי, קבלת סחורה, "דליפה" only for the monthly leak, מחירים שעלו) are in every UI brief that writes copy, and W2-13 turns them into a test.
- Receiver/chef no-₪ is server-tested in W2-05, W2-06, W2-09, W2-10, W2-11, W2-12, G-06, G-07 and G-12, plus W2-03 now.
- Quiet hours, the 6/day cap, the click-only overdue reminder, undecided gaps never sent, paid keeps claims, the frozen mobile app, the 30-day trial (H-02) and the read-only remediation report (G-08, decision 24) are all present.
