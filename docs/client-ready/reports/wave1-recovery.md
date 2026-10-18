# S12 — Wave 1: "₪ back" tracker + monthly "one number" report

Branch `claude/wave1-recovery` → draft PR into `claude/client-ready`. Flags: **`recovery`**, **`monthlyReport`**
(both off by default; on for the demo tenant through `settings.features.all`; `FEATURES_OFF` kill-switch honoured
by every procedure **and** both worker jobs).

**Headline (demo tenant, October 2026):** of ₪1,558 claimed from suppliers, ₪991 is backed by credit notes,
**₪653 is actually back in the bank this month**, and ₪567 is still owed (10 claims overdue). The recovery rate is 64%.
The leak hero is unchanged at **₪572 · 2.0% of ₪28,389**, and the demo script asserts that before and after.
On the 1st of each month the owner gets one email (he/en), one WhatsApp-length text (stub provider) and a
downloadable PDF with the month's number. The dashboard has a "preview this month's report" button.

## What was built

### 1. ₪-back tracker (`recovery`)
- **Lifecycle** (`packages/api/src/recovery/lifecycle.ts`):
  - Main path: claimed → letter sent → supplier acknowledged → credit received → money back.
  - Side states: disputed and written off. A disputed claim can move forward again; a written-off claim can only be re-opened.
  - Steps may be skipped forward. `credited` can **only** be entered through a credit note, so every credited
    shekel has a `credit_notes` row behind it. Every move writes a `recovery_events` row (an append-only history).
- **Claims** are created automatically from every discrepancy the team accepted to claim back. The rules are the
  hero's: warn/block only, excluding PRICE_LOWER and UNORDERED_ARRIVAL, with resolution accepted/resolved.
  - Amount = |delta| in integer agorot, parsed at the boundary (`round(abs(x)*100)::bigint`).
  - Each invoice is capped at its total, like the hero and the claim letter. A test checks that the claims add up
    exactly to the hero's "claimed".
  - Idempotent: one claim per discrepancy (unique index + `ON CONFLICT DO NOTHING`).
- **Credit notes** have a number, an amount in agorot and a date. They come from one of two sources:
  - **matched to a later invoice's credit (negative) line**: the tracker suggests these lines, then the amount,
    number and date come from the invoice. A line can be used only once (unique index);
  - **entered manually**.

  A note is applied to the supplier's claims oldest first, and never for more than is owed
  (`allocateCredit`, integer agorot). Any remainder is shown to the user.
- **Tracker page** `/dashboard/recovery` (owner/manager/bookkeeper):
  - totals: claimed / credited / returned / outstanding, plus the recovery rate;
  - an overdue banner;
  - ageing buckets (0–30 / 31–60 / 61–90 / 90+ days);
  - a recovery-rate table per supplier;
  - a credit-note form per supplier, and "close with this credit line" suggestions;
  - a claims table with an open/all/closed filter and per-row lifecycle actions.
- **Reminders through the outbox**: a claim still waiting on the supplier more than 14 days after the letter (or
  after the claim) is chased once every 7 days. One email goes to each owner/manager, in the member's language,
  deduped per day (`recovery/reminders.ts`, worker job `recovery-reminders`, 08:30 IL).
- **Hero:** "₪ actually returned this month" (gold tile, links to the tracker) appears when `recovery` is on.

### 2. Monthly "one number" report (`monthlyReport`)
- **Content** (`packages/api/src/reports/monthly.ts`):
  - last month's leak in ₪ and % of spend;
  - caught before payment, claimed, actually returned, still owed;
  - top 3 suppliers and top 3 issues;
  - up to 4 next actions: chase overdue claims, decide open items, send claim letters, link pending invoices, or
    talk to a supplier above 1.5%.
  - Every number comes from the same SQL as the dashboard (`computeLeakReport` → hero), so the email, PDF and
    dashboard always agree. All money in the snapshot is integer agorot.
- **Email (he RTL / en LTR)** goes through the shared `renderEmail` brand frame (the existing email-template pattern),
  in each member's `preferred_locale`.
- **WhatsApp text** (≤ 700 chars) goes through the `Notifier` abstraction with the **stub provider**
  (`MockWhatsAppNotifier`): the outbox row is marked sent and nothing leaves. A real send needs an owner phone number
  and a Meta-approved template (owner action).
- **PDF**: generated server-side with **pdf-lib + @pdf-lib/fontkit** and an embedded 55 KB Hebrew+Latin font subset
  (DejaVu Sans, renamed as its licence requires). Samples: `docs/client-ready/samples/monthly-report-2026-10-{he,en}.pdf`
  (~22 KB each).
  - **Why pdf-lib:**
    - there is no headless browser (Vercel can't ship Chromium);
    - it is pure JS with zero native dependencies;
    - it does **no filesystem reads at runtime**. pdfkit reads its AFM files from disk, and Next's output tracing
      drops those files;
    - the same code runs in the worker, a route handler and a unit test.
  - **Trade-off:** pdf-lib has no layout engine and no bidi, so the page is a fixed A4 layout.
    - `reports/bidi.ts` reorders Hebrew/Latin/number runs (UBA essentials: implicit levels, L2 reversal, bracket mirroring).
    - fontkit also reverses any run that starts with a Hebrew letter, digits included (found in layer 2: the year
      printed as "6202"). So the line is drawn as runs, and a test checks the result against fontkit's real glyph order.
- **Schedule:**
  - The worker job `monthly-report` runs on the **1st of the month at 07:45 IL**.
  - It freezes last month in `monthly_reports`, one row per restaurant-month (migration 0049).
  - It sends once (`sent_at` plus outbox dedupe keys), so it is idempotent.
- **Dashboard:** the "preview this month's report" button sits under the hero (owner/manager).
  `/dashboard/reports/monthly` shows:
  - this month to date, or last month;
  - the one-number card, the top-3 lists and the next actions;
  - the **exact email** (sandboxed iframe) and the WhatsApp bubble;
  - **PDF download (he/en)** through `GET /dashboard/reports/monthly/pdf`.

### 3. Demo — `apps/worker/scripts/seed-recovery-demo.ts` (new, idempotent)
- Run it after `seed-demo.ts`. It stages the demo tenant's claims, oldest first:

  | Share of claims | State |
  |---|---|
  | 35% | money back, this month |
  | 15% | credited |
  | 15% | acknowledged |
  | 20% | letter sent 3 weeks ago (overdue) |
  | Rest | just claimed |
  | Newest claim | disputed |

- It writes one manual credit note per supplier (`DEMO-ZK-00n`).
- Running it again does nothing ("already staged").
- It touches only the recovery tables and **asserts that the hero (this month and last month) is identical before
  and after**.
- Run: `DATABASE_URL=… pnpm --filter @restomatch/worker exec tsx scripts/seed-recovery-demo.ts`. It uses the seed
  guard: local databases only, or `SEED_ALLOW_REMOTE_HOST` for a disposable demo DB.

### 4. i18n, security, migrations
- **i18n:** a new `recovery` namespace in he and en (tracker, statuses, actions, credit form, report, next actions).
  Two nav labels were added to the `nav` namespace.
- **Procedures:** 10 new ones (`recovery.{flags,summary,list,history,transition,recordCreditNote,creditLineSuggestions,returnedThisMonth}`,
  `monthlyReport.{preview,pdf}`).
  - They all run under `memberProcedure`/role procedures inside the RLS transaction.
  - Each has a COVERAGE entry plus attack/isolation tests: A cannot list, move or credit B's claims, use B's supplier
    or credit line, or see B in the report.
  - Flags are refused with FORBIDDEN / appCode `FEATURE_DISABLED`.
- **Migrations:**
  - **0048_recovery** (credit_notes, recovery_claims, recovery_events) and **0049_monthly_reports**.
  - Hand-written and additive, with journal entries and a shape test (`migration-0048.test.ts`, covering both).
  - Every tenant reference is a **composite same-tenant FK** `(x_id, restaurant_id)`, and RLS + the tenant policy are enabled **inside 0048/0049** (S1 cross-QA; `rls/0002` is not edited). Every FK is indexed (db:doctor clean), and `pnpm db:supabase-sync`
    output is regenerated.

## Fixed along the way (pre-existing bug)
- **`enqueueNotification` with a `dedupeKey` threw on real Postgres** (42P10: "no unique or exclusion constraint
  matching the ON CONFLICT specification").
  - `notifications_dedupe_key_unique` is a *partial* index, and `ON CONFLICT` must repeat its predicate.
  - The existing test mocks the DB, so this never surfaced. Every deduped send was broken in production code:
    the end-of-day report and the mock-WhatsApp path.
  - Fix: add the `where` predicate (`notifications/outbox.ts`, 4 lines). New real-DB test
    `outbox-dedupe-db.test.ts`; it fails without the fix (reproduced) and passes with it.

## Immutable files touched (owner review)
| File | Change | Test |
|---|---|---|
| `packages/api/src/notifications/outbox.ts` | **No longer touched.** S7's identical fix landed first (#49); this branch keeps S7's version after the merge | `outbox-dedupe-db.test.ts` (real DB) still passes on S7's fix |
| `apps/worker/src/cron.ts` | +2 schedulers: `recovery-reminders-0830` (`30 8 * * *`), `monthly-report-1st-0745` (`45 7 1 * *`), both IL; +2 removals; log line | `apps/worker/src/__tests__/cron.test.ts` (new) pins the **whole** schedule |
| `packages/db/src/schema.ts` | additive: 4 tables + `RECOVERY_STATUSES` (+ `bigint`/`date` imports) | `migration-0048.test.ts` |
| `packages/db/drizzle/meta/_journal.json` | +0048, +0049 (`when` 1782030000000 / 1782040000000) | db suite |
| `packages/api/src/__tests__/cross-tenant.attack.test.ts` | **additive**: 10 COVERAGE entries + 8 tests | itself |

Shared (not immutable), all additive:
- `packages/api/src/errors.ts` (+`FEATURE_DISABLED`), `apps/web/lib/serverErrors.ts` (its translation),
  `packages/api/src/index.ts` (router + exports);
- `apps/web/app/dashboard/{layout,nav,page}.tsx` (flag-aware nav, hero tile + button);
- `apps/web/lib/roles.ts` (`/dashboard/recovery`, `/dashboard/reports[/monthly]`), `apps/web/test/appRouterShape.test.ts`;
- `apps/worker/src/index.ts` (+2 workers).

## Still not done / proposals
1. **Activating WhatsApp:** this needs an owner phone number per restaurant and a Meta-approved template. Today the
   text goes through the stub notifier only. *(Owner action.)*
2. **Activating email:** the outbox delivers through Resend once `RESEND_API_KEY` and `EMAIL_FROM` are set. Until
   the domain is verified, Resend's sandbox delivers only to the owner's mailbox. *(Owner action.)*
3. **Tracker bulk actions:** a per-supplier "mark letters sent" button that pairs with `/dashboard/leaks/claims`.
   The API already accepts up to 200 claim ids; the UI is one select per row today. **S.**
4. **Auto-matching credit lines on ingest:** when OCR reads a negative line from a supplier with open claims, apply
   it automatically, or just notify. Today it is one click on the suggestion. **S–M.**
5. **Lift `formatIls` into a shared package:** the server-side twin `formatIlsAgorot` (`packages/api/src/reports/money.ts`)
   is pinned to the web util by a parity test. A shared `@restomatch/money-format` would remove the twin.
   (money-format-marshal)
6. **Ageing in the demo:** every outstanding claim is under 30 days old because the seeded discrepancies are recent.
   A September-heavy seed (S1) would fill the 31–60 bucket.

## Needs another area
- **S1 (seed):** call `seed-recovery-demo.ts` from `dev-setup.sh` after `seed-demo.ts`, and from the production demo
  runbook (§7), so the demo tenant has recovery states.
- **S5 (nav):** I added `feature?` to `NavItem` and a `features` prop to Desktop/MobileNav. Other wave-1 sessions
  can reuse it for their own nav items.
- **S7 (worker deploy):** the two new queues need no new environment variables.

## Found by the refuter and fixed (layer 2b, two rounds)
| # | Defect (confirmed with a repro) | Fix | Regression test |
|---|---|---|---|
| R1 | Claimed ₪ could exceed the invoice total and disagree with the hero when a later line was accepted first (the cap ignored existing claims) | Cap = invoice total − Σ existing claims on that invoice | `recovery.test.ts` "cap holds when a later discrepancy is accepted first" |
| R2 | Parallel credit notes over-allocated: 4 notes on one claim in 1 run out of 3 | Claims are read `FOR UPDATE` inside the member transaction; ids are deduped and locked in id order | "parallel credit notes … never over-credit" (8-way) |
| R3 | A partly credited claim lost its shortfall: no further credit was possible, and the remainder vanished from every bucket | A `credited` claim takes further notes while money is still owed. Recovering short books the shortfall as written off (claimed = credited + outstanding + written off) | "a partly credited claim can be topped up …" |
| R4 | The PDF and preview were recomputed live instead of using the frozen report | `loadMonthlyReport` serves the stored snapshot (`frozen: true`) | "preview and PDF show the frozen snapshot" |
| R5 | WhatsApp truncation dropped the link | Truncate the body and keep the URL | "WhatsApp truncation keeps the report link" |
| R6 | Re-using a credit line gave a 500 | Returns CONFLICT | "re-using a credit line is a CONFLICT" |
| R7 | Bidi: "₪ amount · %" swapped places after Hebrew | UBA W7/N1 for numbers in RTL lines | `recovery-lifecycle.test.ts` |
| R8 (round 2) | Two bulk transitions naming the same claims in opposite order deadlocked (40P01 → 500) | All claims of a bulk call are locked up front, sorted by id | "two bulk calls … do not deadlock" (fails without the fix: INTERNAL_SERVER_ERROR) |
| L2 | The Hebrew PDF printed the year as "6202" and "%0.2": fontkit reverses Hebrew runs wholesale | Visual-order runs; tested against fontkit's real glyph order | "PDF runs vs fontkit script detection" |
| L2 | The report nav link showed for every role (`canSeeRoute` is an exact-path lookup; the page itself was already denied) | Exact `ROUTE_ROLES` entry | `roles.test.ts` |
| L2 | 116 px horizontal overflow on the tracker at 390 px in Hebrew | `grid-cols-1` + `min-w-0` | layer-2 overflow check |

Known and accepted (refuter suspicions, not defects):
- A top-up overwrites `credit_note_id`, so the tracker shows the latest note number. The full trail stays in
  `recovery_events` and `credit_notes`.
- ~~A claim whose discrepancy is later re-opened or rejected stays in the tracker.~~ Superseded in Round 4: it is now
  written off automatically (and re-opened if the discrepancy is accepted again).
- A stored monthly snapshot is the record of what was sent. `ensureMonthlyReport({refresh:true})` regenerates an
  unsent snapshot only; a sent one is never rewritten (Round 4).

## Round 3 (orchestrator + S1 cross-QA)

**S1 findings, fixed:**
1. **Cross-tenant FKs (medium).** 0048 now uses composite `(x_id, restaurant_id)` FKs for every tenant reference.
   - Covered: supplier, invoice, discrepancy, credit note, claim.
   - An invoice line is reached through its invoice: `(invoice_line_id, invoice_id)` → `invoice_lines` MATCH FULL.
   - Supporting `UNIQUE (id, restaurant_id)` keys were added on invoices and discrepancies, plus `UNIQUE (id, invoice_id)` on invoice_lines.
   - Tests:
     - `migration-0048.test.ts`: every cross-tenant insert or update is refused with 23503; another tenant's delete cascades nothing; an invoice delete removes only the credit note derived from it.
     - DB-level probe in `cross-tenant.attack.test.ts`.
   - Verified first in a scratch DB: `SET NULL` on the invoice FK would break MATCH FULL mid-cascade, hence CASCADE for credit notes derived from invoice lines.
2. **RLS in the migration.** RLS and the `<table>_tenant` policy are enabled inside 0048/0049, the same way S11/S13/S14/S17 do it. The `rls/0002` edit was reverted (the file is byte-identical to the base).
3. **Merged `origin/claude/client-ready` (197e718).** `outbox.ts` keeps S7's fix. The `supabase/` files were regenerated with `db:supabase-sync` from the base.

**New: `pnpm demo:seed-all`** (orchestrator request).
- One guarded, idempotent command:

  core seed → seed-demo → chain → recovery → recipes → contracts

  Wave-1 steps are skipped when their script or table is missing. The final numbers are printed.
- Guards: the old production project is refused, including via a decoded username, `PGUSER` or `PGHOST`. Shared Supabase pooler hosts are refused. A remote host needs a private `DEMO_PASSWORD`. A non-empty DB needs `--reset`; the not-empty check counts every table the base seed's TRUNCATE CASCADE reaches.
- Runbook in Hebrew and English: `docs/DB-RUNBOOK.md`, "The whole demo in one command".
- Verified:
  - all 6 steps on a local throwaway worktree with S17 and S11 merged in;
  - two `--reset` runs gave identical numbers;
  - the commit cherry-picks onto bare `client-ready` and runs there, skipping what isn't merged.
- An independent refuter found two gaps (the pooler / encoded-username bypass and the narrow not-empty check). Both are fixed with tests.

**Observation, not this PR:** one layer-2 run logged React #418 (a text hydration mismatch) once for chef/he. It did not reproduce in 8 targeted runs or in the full re-run. Likely a relative-time text crossing a boundary (pre-existing activity feed).

## Round 4 (S3 money cross-QA)

| # | S3 finding | Fix | Regression test (`recovery.test.ts` unless noted) |
|---|---|---|---|
| 1 | **BLOCKER** — re-matching an invoice cascaded from `discrepancies` and wiped its claims (letters, credits, history) | The claim → discrepancy FK is now `ON DELETE NO ACTION`. `match.run` first calls `releaseClaimsForRematch`: bare `claimed` claims (and system write-offs with ₪0 credited) are released; any claim with progress makes the re-match a `CONFLICT` with a clear message instead of deleting money history | "re-match vs claims: refuses while money is in flight, and releases bare claims" — fails without the fix |
| 2 | **BLOCKER** — the monthly report's "claimed" was the raw Σ of claims, not capped per invoice | "Claimed" = the hero's own capped figure; top issues come from per-invoice capped SQL (their sum equals the hero leak) | "BLOCKER 2: monthly \"claimed\" and top issues use the per-invoice cap" |
| 3 | **HIGH** — a claim stayed open after its discrepancy was rejected, and kept eating the invoice cap | `syncClaims` writes off untouched (`claimed`/`letter_sent`) claims whose discrepancy is no longer accepted (event note `auto: discrepancy no longer accepted`), re-opens only those on re-accept (a manual write-off stays), and excludes zero-credit write-offs from the cap | "HIGH 3: … writes its untouched claim off (auto), re-accepting re-opens it" (incl. the freed cap) |
| 5 | MEDIUM — duplicate credit notes | Partial unique `(restaurant_id, supplier_id, number)`, plus a client `idempotency_key` (unique). A replay returns `{duplicate:true}`; the same number without the key → `CONFLICT`; 23505 is mapped to `CONFLICT` | "MEDIUM 5: a credit-note number is recorded once per supplier; an idempotency key replays" |
| 6 | MEDIUM — VAT basis undefined; a note was spread over every open claim of the supplier | **Basis: before VAT** (the engine's `totalExclVat`), stated in the 0048 header and on the form. A note is allocated only to the claims the user ticks (oldest first) | "MEDIUM 6: a credit note is applied only to the selected claims" |
| 7 | MEDIUM — "returned" tile was ambiguous | Relabelled **"חזר החודש / Cash back this month"** with the hint "money returned this month, for invoices of any month" | layer 2 |
| L | LOW: overdue off-by-one; ageing in UTC; rate; `MAX_CLAIMS` truncating summaries; outstanding not month-scoped in the snapshot; `refresh` overwriting a sent snapshot; RLS test order; `formatIls` parity | Overdue badge = the reminder rule (`findOverdue`); ageing in Asia/Jerusalem calendar days; summaries read every claim (`limit: null`); snapshot "still owed" is for this month's invoices (labelled so); a sent snapshot is never rewritten; RLS tests self-order; `money-parity.test.ts` pins the server twin to the web `formatIls` | tests: "LOW: a sent snapshot is never rewritten, even with refresh", "LOW: the overdue badge and the reminder job agree at the 14-day boundary", `money-parity.test.ts`; ageing / rate / no-truncation are covered by the existing `summarize` unit test and layer 2, not a new test |

**Item 4 — proposal only (immutable `packages/matching/src/engine.ts`, not edited).** A supplier credit line on an
invoice (negative `lineTotal`) has no PO line, so step 6 emits it as `UNORDERED_ITEM` with a negative `deltaAmount`,
and the leak (`Σ |deltaAmount|`) counts the refund as a leak. Proposed human PR: in step 6, skip invoice lines with
`lineTotal < 0` (they are credits; the tracker's credit-line suggestion already consumes them), and add a canary case
with a credit line asserting the leak does not move. Owner: matching-engine-guardian, human-authored.

**Other files touched this round** (not immutable): `packages/api/src/routers/match.ts` (S3's router: +1 call),
`apps/worker/scripts/seed-demo.ts` and `seed-chain-demo.ts` (delete the restaurant's recovery rows before their
discrepancy wipe, guarded by `to_regclass`), `packages/api/src/__tests__/fixtures.ts` (`resetDb` clears recovery rows
first), and S1's `wave1-checks.test.ts` (adapted earlier to the real `credit_notes`). `.gitleaksignore`: one
reviewed false positive (a test UUID in a variable named `key`; the test now generates it).

## Round 5 (S4 M1 + two refuter rounds on the S3 fixes)

**S4 M1 (orchestrator):** `sendMonthlyReports` and `enqueueRecoveryReminders` run each restaurant inside its own
try/catch. A failing restaurant (for example an invalid timezone → RangeError) is logged with its id and listed in
`failed`, and the run continues. Restaurants are processed in a stable order. Test: a bad-timezone tenant between two
good ones; without the fix it fails with the RangeError.

**Refuter, round 1 on the S3 fixes:**

| Defect (repro confirmed) | Fix | Test |
|---|---|---|
| A re-match deleted claims that had history: letter_sent → written_off → claimed, or letter_sent → auto write-off | A claim is releasable only if it never had a letter, acknowledgement or credit, and has no event beyond its creation and system write-offs / re-opens | "re-match refuses a claim with history …" |
| A re-match racing the tracker sync returned a 500 (23503) | Both take one per-restaurant advisory lock | "re-match racing the tracker sync never 500s" |
| A system re-open after the freed cap was reused claimed the invoice twice (₪217 on ₪117) | The re-open is re-capped to what is left of the invoice; if nothing is left, the claim stays written off. The claim returns to its pre-write-off status (letter_sent stays letter_sent) | "a re-opened claim is re-capped …", "a system re-open restores letter_sent" |
| A manual write-off whose note matched the system note text was treated as a system write-off | System = that note AND no actor | "typing the system note by hand …" |
| (suspicion) An idempotency key reused with a different payload was a silent duplicate | Now a CONFLICT | "an idempotency key reused with a different payload …" |
| (suspicion) The refresh upsert could overwrite a report that was sent in between | `setWhere sent_at IS NULL`, then a re-read | — (code review) |

**Refuter, round 2:**

| Defect (repro confirmed) | Fix | Test |
|---|---|---|
| A human re-open (written_off → claimed) was not re-capped (₪217 held on a ₪117 invoice) | Same re-cap as the system re-open; if nothing is left → CONFLICT | "a human re-open is re-capped too …" |
| A deadlock between a bulk transition and the tracker sync, which surfaced as 40P01 → 500 | Every claim row lock first takes the per-restaurant advisory lock, so there is one lock order everywhere | "… never deadlock" (fails with 40P01 without the fix) |

What held in round 2:
- re-match after a system write-off and a system re-open;
- a bare human re-open blocks re-match;
- several claims re-opening in one sync stay within the cap;
- a re-open next to a partly credited claim;
- idempotency on credit-line notes;
- 8 random concurrency mixes, including the worker path: no 500 / 23503 / 40P01 and no over-cap totals.

Known and accepted (documented, not fixed):
- When a claim is already **acknowledged or disputed** and its discrepancy is later rejected, the claim stays open. The supplier conversation is under way, so the owner decides. The tracker can then show more owed than the hero's "claimed" figure.
- Events written before this round store the caller as actor on system events. Only dev or demo data has such rows, and `demo:seed-all --reset` rebuilds them.
- `transitionClaim` called by a script with no actor counts as "system" for the re-match release. Scripts only seed demo data.
- System events are stamped with DB `now()`, human events with the app clock. Clock skew could reorder the two only within the same second.
- The idempotency check compares supplier, amount, number and date (or the credit line). It does not compare the selected claims.

## Verification (2 layers)
Head: see the PR / orchestrator message. **Round 5 (b019a4b):** layer 1 → 13/13 test tasks on 1477572 (api 597 · web 268 · db 76 · worker 30 · matching 86 · charts 64 · …); after the round-2 fixes the api suite was re-run alone, 599/599 (only `packages/api` changed); typecheck 17/17, web tsc 0, lint 0, `supabase-sync --check` clean, build green; layer 2a → `LAYER2 OK` on b019a4b (5 roles × he/en, same numbers, dev DB reseeded with `demo:seed-all -- --reset`); layer 2b → two refuter rounds (above), every confirmed defect fixed with a test that fails on the previous code. **Round 4 (after the S3 fixes):** layer 1 → 13/13 test tasks (api 589 · web
268 · db 76 · worker 30 · …), typecheck 17/17, web tsc 0, lint 0, `supabase-sync --check` clean, build green; CI on
aa76aef green except gitleaks (the false positive above); layer 2a → `LAYER2 OK` (5 roles × he/en; hero ₪572 · 2.0%,
tile "cash back this month" ₪653, tracker ₪1,558 / ₪991 / ₪653 / ₪567, 0 px overflow at 390 px), dev DB reseeded
with `pnpm demo:seed-all -- --reset`; layer 2b → refuter round on the S3 fixes (see below). **Round 3 (after the merge and the S1 fixes):** layer 1 → 13/13 test tasks (api 582 · web 264 · db 71 · worker 26 · matching 86 · charts 64 · …), typecheck 17/17, web tsc 0, lint 0, `supabase-sync --check` clean, build green; layer 2a → `LAYER2 OK` (5 roles × he/en, dev DB reseeded with `pnpm demo:seed-all -- --reset`). Local Postgres 16 + pgvector and Redis, set up with `./scripts/dev-setup.sh`.

**Layer 1 — full gate**
```
pnpm install --frozen-lockfile                                        → Done (lockfile unchanged after adding pdf-lib)
DATABASE_URL_TEST=…/restomatch_test2 pnpm turbo run test --concurrency=1 --force
  → Tasks 13/13 successful: api 538 · web 205 · matching 86 (canary unchanged) · db 64 · catalog 50 · ocr 44 ·
    charts 33 · translate 69 · procurement 17 · crypto 12 · billing 5 · worker 13 (+1 skipped, needs REDIS in CI)
pnpm turbo run typecheck                                              → 17/17 successful
apps/web: npx tsc --noEmit -p .                                       → 0 errors
apps/web: npx next lint                                               → 0 errors (pre-existing warnings only, none in S12 files)
pnpm db:supabase-sync --check                                         → up to date (42 files)
apps/web: pnpm build (.env.local)                                     → success; /dashboard/recovery 9.8 kB,
                                                                        /dashboard/reports/monthly 1.6 kB, /dashboard/reports/monthly/pdf (ƒ)
```

**Layer 2a — production build, he + en, every role.**
Environment:
- `NODE_ENV=production next start` against the dev DB through the RLS app role (`DATABASE_URL_APP=restomatch_app`);
- password login as the 5 seeded users;
- dummy values for the production-only secrets the boot guard demands (`RESEND_API_KEY`, `EMAIL_FROM`,
  `SUPABASE_SERVICE_ROLE_KEY`). Nothing is sent.

Script `layer2.mjs` (Playwright, Chromium):

| Check | Result |
|---|---|
| `/dashboard`, `/dashboard/recovery`, `/dashboard/reports/monthly` (+ WhatsApp view) for owner, manager, bookkeeper, receiver, chef × he, en | Allowed roles get HTTP < 400; the others are redirected or denied. `<html lang dir>` is correct on every page. **0 console errors, 0 server 5xx** |
| Nav | Tracker shown to owner/manager/bookkeeper only; report shown to owner/manager only |
| Hero | Unchanged at **₪572 · 2.0%**. The returned-this-month tile reads **₪653** for every role |
| Tracker totals (he/en) | **₪1,558 claimed · ₪991 credited · ₪653 returned · ₪567 outstanding · 64%**. These match the demo script's DB-side numbers exactly |
| Report hero | ₪572 · 2% · spend ₪28,389 · caught ₪296 · claimed ₪276 · returned ₪653 · owed ₪567. These match the dashboard hero |
| PDF route | owner/manager get 200 `application/pdf` (he + en); bookkeeper, receiver and chef are denied |
| Phone width (390 px), he + en | 0 px horizontal overflow on all three pages |

Final run: **`LAYER2 OK`**.
- Screenshots: `docs/client-ready/screenshots/wave1-recovery-*.png` (desktop he/en for dashboard, tracker, report,
  WhatsApp view; phone he/en; email preview).
- Sample PDFs: `docs/client-ready/samples/monthly-report-2026-10-{he,en}.pdf`. They were downloaded through the
  production route and checked visually: the Hebrew reads correctly, including the year, percentages and ₪.

**Layer 2b — independent refuter** (a subagent that did not write the code), two rounds:
- **Round 1** found R1–R7 above.
- **Round 2** re-attacked every fix. 7 of 8 held: the cap, the 8-way credit race run 5 times, partial credit and
  shortfall, the snapshot, WhatsApp truncation, credit-line reuse, and bidi. It found the bulk-transition deadlock
  (R8), which is now fixed and tested.
- **What held in both rounds:**
  - **Tenancy:** tenant B using A's claim, invoice line, supplier, history, transition or suggestion ids got
    NOT_FOUND or empty results.
  - **RLS:** as `restomatch_app` on the 4 new tables, cross-tenant select/update/insert returned 0 rows or was
    refused; with no tenant set, 0 rows were visible.
  - **Roles:** receiver and chef are refused on every finance procedure and on the PDF route.
  - **Kill-switch:** `FEATURES_OFF` is honoured by the procedures and both worker jobs.
  - **Month boundary:** correct on the 1st at 00:30 IL.
  - **Escaping:** a `<script>` or `<img onerror>` supplier name is escaped in the email HTML and subject.
  - **PDF:** Cyrillic, Arabic or emoji names don't crash it.
  - **Outbox:** the fix doesn't break the existing callers.
