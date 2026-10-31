# Wave 2: the shared playbook (read this first, once)

## 0. You are here
- You are **one wave-2 package session** for RestoMatch: a Hebrew-first, RTL B2B web app that catches supplier-invoice leaks in ₪ for Israeli restaurants. Next.js 15 in `apps/web`, tRPC in `packages/api`, Drizzle + Postgres RLS in `packages/db`, the engine in `packages/matching`, jobs inside Vercel at `/api/cron/jobs`.
- **Your brief is `docs/ux/wave2/<ID>.md`.** It holds your write boundary, dependencies, interims, acceptance list, tests and exact line pointers. This README is the contract shared by all sessions. On package specifics the brief wins; AGENTS.md wins over both.
- **The orchestrator is session `session_015veCjPjLCiZbqnYFJpdzvR`.** It assigns work, answers boundary questions, integrates on `release/wave-2`, reviews and merges. You build one package on one branch and open a **draft** PR.
- **Timing.** Wave 1 merges to `main` about 3.11. The pilot freeze is 4–8.11 (ציקטי goes live on 8.11): branch work and draft PRs only. Merges to `main` follow the freeze, in the order of §10. Vercel builds only `main`, so your pushes cost no Vercel build. GitHub CI still runs on every PR push.

## 1. First 10 minutes (checklist)
- [ ] AGENTS.md is auto-loaded. Read it: it binds (immutable list, ownership map, money facts, design vocabulary).
- [ ] Read this README, then your brief's §1 "Start here", §2 "Write boundary", §3 "Depends on" and §5 "Acceptance". Read the other sections when you reach that work.
- [ ] `sed -n 1,40p STATE.md`: the top section only. It is partly historical; the brief is newer for wave-2 facts.
- [ ] `git fetch origin main && git switch -c <branch from brief §3> origin/main`.
- [ ] Start the lab **in the background** (`run_in_background`) and keep reading while it builds: `bash docs/ux/wave2/lab.sh <ID>`. Packages with no UI use `--tests-only` (§3).
- [ ] `. ~/.rm-lab/<slug>/env` (slug = the id in lower case with `-` → `_`: W2-09 → `w2_09`, G-05 → `g_05`), then run your brief's targeted test commands. See them **green before you change anything**. If one is red on clean `main`, it is not yours: say so in your first message and carry on.
- [ ] Put the day-1 requests your brief names (path additions, one export line, `AuditAction` values) in **one** message (§6). Don't wait idle for the answer: start on the parts that depend on nothing.

## 2. Token-efficiency rules (enforced in review)
1. **Read in ranges.** `grep -n` first, then `Read` with `offset`/`limit` (±30 lines). Never re-read a file you just edited.
2. **Never `cat`/`Read`:** `pnpm-lock.yaml`, `node_modules/`, `.next/`, `dist/`, `test-results/`, `*.tsbuildinfo`, generated CSS, snapshots. The same applies to the big docs: `docs/ux/REVIEW-REPORT.he.md`, `docs/ux/IMPLEMENTATION-PLAN.md`, `docs/ux/review/area-*.md` and `lens-*.md`, and the planning copies in `docs/ux/wave2/ref/` (§11). Use your brief's line pointers. A finding id (e.g. `receiving-07`): `grep -n 'receiving-07' docs/ux/review/*.md`, then read ±40 lines (there is no findings JSON in the repo). Big test files (`cross-tenant.attack.test.ts`, 2,661 lines): only the cited ranges.
3. **Targeted tests while iterating:** `. ~/.rm-lab/<slug>/env && pnpm --filter <pkg> exec vitest run <file> [-t "<name>"] --reporter=dot`. Before the push, run the full gate **once**: `. ~/.rm-lab/<slug>/env && pnpm turbo run typecheck test --concurrency=1 --filter=...[origin/main] --output-logs=errors-only`. Web `tsc` needs a prior `next build`, which the lab did (a `--tests-only` lab did not: run `pnpm --filter @restomatch/web build` first if you touched web code).
4. **Logs stay in files.** Redirect to a file, then `grep -nE 'FAIL|Error|✗|×' <log> | head -40` or `tail -30`. Never paste a full log, a full diff (use `git diff --stat`) or a full test report.
5. **One push per milestone**, because CI runs on every push. Batch your fixes. Don't merge `main` into your branch. Rebase only when the orchestrator asks; integration happens on `release/wave-2`.
6. **No subagents and no workflows** unless your brief says so. The one exception: at most one review subagent before your final push.
7. **Screenshots: the DoD set only** (§4). Use `shot.cjs` (§3), which prints one JSON line. Open a PNG only when a number in that line looks wrong, and one at a time.
8. **Reuse, never re-implement.** These are verified on `release/wave-1`. Report a primitive bug to the orchestrator for W2-15; don't patch it locally.
   - `apps/web/lib/components/money/`: `Money`, `MetricTile`, `Delta`, `PriceMove`, `DateTime`, `DeadlineChip`, `Token`. `format.ts` has `MONEY_DECIMALS` and `NUM_ALIGN` (`text-right`).
   - `apps/web/lib/components/Input.tsx`: **Field v2**, plus `Input`, `Textarea`, `Select`. `form/`: `MoneyInput`, `QuantityInput`, `DateField`, `SegmentedControl`, `Tabs`, `Steps`, `FilterChip`, `parse.ts`.
   - `apps/web/lib/components/Toast.tsx`: **Toast v2** (`ToastProvider`, `useToast`). `feedback/`: `Banner`, `InlineMessage`, `StatusChip`, `CountBadge`, `LiveRegion` (`useAnnounce`).
   - `apps/web/lib/components/overlay/`: **`Sheet`**, `QtyKeypad`, `RowActions`/`Menu`. Also `ConfirmDialog.tsx`, **`EmptyState.tsx`** and **`Skeleton.tsx`**.
   - W1-02 desk, in `apps/web/lib/components/table/`: **`DataTable`**, **`BatchBar`**, **`ViewTabs`**, `MobileCardList`, `NumCell`, `ColumnsMenu`/`DensityMenu`/`ExportMenu`, `exportCsv.ts`, `useTableUrlState`, `DEFAULT_BULK_CAP_AGOROT` (= 20,000 agorot = ₪200). In `desk/`: **`SplitPane`**, **`Peek`**, `keys.ts`.
   - W1-03 nav registry, in `apps/web/lib/nav/`: `registry.ts`, `routes/<seg>.ts`, `types.ts`, `visibility.ts`, `titles.ts`.
   - The barrel is `apps/web/lib/components/index.ts`. ₪ text comes from `formatIls` in `apps/web/lib/money.ts` (immutable). Number input uses `parseNumberInput` in `packages/types/src/number-input.ts` until G-13's `parseDecimalInput` lands.
9. **Ask instead of exploring.** If a boundary, an owner or a contract is unclear, send one question (§6) rather than reading half the repo.

## 3. The lab
`bash docs/ux/wave2/lab.sh <ID> [port] [flags]` runs from the repo root, in the current checkout. It is local only: it talks to localhost Postgres alone, strips remote or production credentials from the environment, uses placeholder keys, has no e-mail or WhatsApp provider and deploys nothing.

What a default run does:
1. Starts Postgres if it is down (`pg_ctlcluster 16 main start`), checks pgvector and runs `pnpm install` if needed.
2. Re-creates `rm_<id>`, migrates, provisions RLS and reseeds the demo (`reseed:demo --today 2026-10-25`).
3. Prepares the test DB `rm_<id>_test`.
4. Runs `next build` and `next start` on **port 3400+N** (W2-NN → NN, G-NN → 20+NN, H-NN → 40+NN; W2-09 → 3409).
5. Writes `~/.rm-lab/<slug>/env` and `shot.cjs`, then prints the URL and the logins. Logs go to `~/.rm-lab/<slug>/logs/`. The slug is the id in lower case with `-` → `_` (`w2_09`); the DBs are `rm_<slug>`, `rm_<slug>_test` and `rm_<slug>_e2e`.

| Flag | Use |
|---|---|
| `--tests-only` | Test DB + env only: no lab DB, no server (W2-01, G-04, G-05, G-06, G-07, G-08, G-09, G-13; H-03 adds `--reseed` for a seeded DB) |
| `--reseed` | Fresh demo DB; the server keeps running |
| `--serve [--no-build]` | Keep the DB, rebuild and restart (`--no-build` reuses the last production build) |
| `--dev` | `next dev` hot reload for iteration (also G-09's ingest simulator, which needs the dev webhook secrets); never for DoD screenshots |
| `--stub` | Also the dev OCR stub on port+50 plus the worker (W2-05 capture flows) |
| `--fresh-test-db` | Drop and re-create `rm_<id>_test` |
| `--stop` · `--status` | Stop the servers · print the URL, logins and health |
| `--worktree` | Only if asked: build in a detached worktree of HEAD under `~/.rm-lab/<id>/wt` |

- **Logins** (restaurant "כפר הזיתים", `DEMO_TODAY=2026-10-25`):
  - `owner@`, `manager@`, `receiver@`, `chef@` and `bookkeeper@kfar-hazeitim.test`, all with password `RestoMatch-Demo-2026!`.
  - That password is the seed's public local default: `DEFAULT_DEMO_PASSWORD` in `packages/db/scripts/seed.ts:48`, used at :238, repeated in `apps/worker/scripts/reseed-demo.ts:50`. Remote reseeds refuse it.
  - The receiver's UI locale is `en` (seed.ts:306).
  - Every feature flag is on, because the demo tenant gets `features: { all: true }` (seed.ts:295).
- **Tests:** `. ~/.rm-lab/<slug>/env` sets `DATABASE_URL` and `DATABASE_URL_TEST` to `rm_<slug>_test`, as CI does. Suites TRUNCATE that DB, so never point them at the lab DB. Shell state doesn't persist between calls, so prefix each command: `. ~/.rm-lab/<slug>/env && pnpm …`.
- **Safety rule (hard):** every command that can touch a database (`migrate`, `provision-rls`, `reseed`, vitest, playwright, the turbo gate) runs behind that prefix. Never run one with whatever `DATABASE_URL` the session inherited: it may be a remote one. The lab has already migrated both local DBs; run `migrate` again only after a rebase brings a new migration.
- **e2e:** `. ~/.rm-lab/<slug>/env && pnpm --filter @restomatch/web exec playwright test e2e/<ID>.spec.ts --reporter=line`.
  - `playwright.config.ts` prepares its own DB (`E2E_DATABASE_URL` = `rm_<id>_e2e`, destructive, ~15 s) and starts `next dev --turbopack` on `E2E_PORT` (= port+100). Add `E2E_SKIP_SEED=1` on reruns.
  - **Stop the lab first** (`--stop`): `next dev` rewrites the `apps/web/.next` that the lab's `next start` serves. Afterwards, restart with `--serve`, not `--no-build`.
- **Chromium** is preinstalled at `/opt/pw-browsers/chromium`. The repo configs use it outside CI (`PW_CHROMIUM_PATH` overrides). In your own scripts, launch with `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`. Never run `playwright install` in the container.
- **Logging in from a spec:** use the password form pattern at `apps/web/e2e/demo-path.spec.ts:246`, or `loginViaMagicLink` at `apps/web/e2e/helpers.ts:38`.
- **Quick look:** `cd apps/web && node ~/.rm-lab/<slug>/shot.cjs <role|public> <path> [he|en] [390|375|1440]`. It logs in once per role and caches the session. It prints `{status, axe criticalOrSerious + ids, overflowX, consoleErrors, shot}`. Ignore axe hits inside the lab worker banner (DoD-2 excludes it).

## 4. Quality bar
**DoD-1..9** apply to every package. The full text is `docs/ux/IMPLEMENTATION-PLAN.md` §0.3, lines 29–38.
1. **Screens.** Playwright on the lab seed for every touched route, per touched role: he 390×844, he 1440×900 and en 1440×900. Field routes also need he 375×667 with touch. Baselines go in `apps/web/e2e/__screenshots__/<ID>/`.
2. **Axe.** `wcag22aa` + best-practice: 0 critical and 0 serious, in he and en.
3. **Keyboard.** Every new control is reachable. The focus ring is ≥3:1 (`--c-focus`) and never hidden under sticky chrome (Tab-walk at 390 and 1440).
4. **RTL and money.** No `dir="ltr"` around a he ₪ string; in he, ₪ sits left of the first digit (bbox check). No `font-mono` on money, no `uppercase`/`tracking` on Hebrew, logical properties only. Charts run time left = oldest. Precision: hero and tiles 0 dp, lines 2 dp. Every visible total equals its visible rows. Numbers in tables are right-aligned.
5. **States.** A layout-true loading state, a typed empty state and an in-shell error state with retry. "Unknown" is never ₪0. A new `loading.tsx` passes `apps/web/scripts/check-soft-nav.mjs` 6/6.
6. **Copy.** he/en key parity (`i18n.test`). Plural-imperative or noun buttons; no masculine-singular CTA, slashes or English jargon in he.
7. **Field** (`receiving/[poId]`, `inventory/count`, `orders/new`, `orders/capture`): the primary action in the bottom third, ≥56 px tall and ≥ viewport−40 wide; targets ≥48 px; text ≥14 px, inputs 16 px; CLS ≤0.05 at 4× CPU; nothing lost on reload.
8. **API.** The right role tier, an entry in your `coverage/<ID>.ts` and a cross-tenant attack test. No schema change unless the package is human-PR.
9. **Build.** CI is green, and the diff touches no immutable path unless the package is human-PR.

**Tests and review:**
- **Failing first.** Every bug gets a test that fails before the fix and passes after; commit it red-then-green, or show both runs in the PR. For a P0, no such test means no merge. Never skip, weaken or delete a test or an assertion. The leak canary stays green.
- **The check layer** runs after the orchestrator integrates you on `release/wave-2`:
  - the CI gate;
  - the ₪ invariants: the canary, `check:demo`, hero = Σ rows, Σ letters = claims ledger = pay-run credit, one "awaiting decision" figure across queue, home, badge and e-mail, and no purchase or leak ₪ for receiver or chef;
  - every screen per role (5 roles × he/en × 390/1440), diffed against the wave-1 baseline for crashes, axe, overflow, console errors and ₪ side.
  A regression comes back to the package that caused it.
- **Before merge**, two independent reviewers read your diff. One lens is correctness, ₪ and tenant isolation; the other is UX, RTL, a11y and copy against §7. A verifier re-checks every finding. The confirmed ones come back to you as one message: fix them in one push and reply once.

## 5. Merge protocol
- **Branch** from `main` after wave 1, named `claude/ux-<id>-<slug>` (the exact name and any slices are in your brief §3, e.g. `claude/ux-w2-09a-charts-exports`).
- **Open a draft PR** titled `ux(<ID>): <title>`. Body sections: **Acceptance checklist** (each item ticked, with how you verified it) · **Evidence** (test names, red→green runs, screenshot paths) · **Owner decisions applied** (§7) · **Placeholders** (each visibly marked) · **Path additions / requested exceptions** · **API for dependents** (exact exports and signatures) · **Human-PR proposals** (§8).
- Subscribe to the PR's activity (`subscribe_pr_activity`) and drive CI to green.
- **Self-repair cap: 2.** If CI fails a third time, stop and send BLOCKED. If `main` is red independently, say so once.
- **Never merge, deploy, write to a production DB, send real e-mail or WhatsApp, or spend money.** Vercel doesn't build branches. The orchestrator integrates on `release/wave-2` in §10 order and merges.
- Keep commits focused. No model names in commits or PR text.

## 6. Communication
- **One message per event** to `session_015veCjPjLCiZbqnYFJpdzvR`, using the claude-code-remote `send_message` tool. Events: **GREEN** (CI green, acceptance list done) · **BLOCKED** (retry cap hit, a dependency missing past its date, an immutable file needed) · **QUESTION** (a boundary or contract is unclear, or the owner must decide).
- Format: `[<ID>] GREEN|BLOCKED|QUESTION · PR #<n> · <≤3 lines: what, what's left, what you need>`.
- **No progress chatter**, no "starting now" and no "still working". Batch the day-1 requests into one QUESTION. The answer arrives as a new turn; keep working on independent parts meanwhile.

## 7. Owner decisions (binding)
- **Terms:**
  - חשבונית מרכזת (consolidated invoice), פער (discrepancy), דרישת זיכוי (credit claim) and קבלת סחורה (receiving);
  - "דליפה" only for the monthly leak; price creep is "מחירים שעלו";
  - never show a "1.5% target".
- **Roles:**
  - Receiver and chef see **no purchase or leak ₪**. This package hides it in the UI; server-side enforcement is H-11. The receiver gets no supplier ledger.
  - The bookkeeper reads everything and edits account cards, with an audit log.
  - The chef orders **directly**, with no approval, and **sees prices and totals on the orders screens only** (owner, 31.10 later). Elsewhere the chef still sees no ₪; H-11's server strip must exempt the chef on `orders.*`.
  - Each worker signs in with their own e-mail and password; there is no PIN.
- **Money limits:** bulk approve is capped at ₪200 per invoice, one-tap WhatsApp approve at ₪500, and a blocking item is never bulk-approved. **The server enforces all three.**
- **Payment:**
  - A paid invoice keeps its claims, and "נתפס" is measured at decision time.
  - שוטף+N = end of month + N, with a warning at the Payment-Delays law limit.
  - Undecided gaps are never sent to suppliers (decision 18).
  - One channel per state (19): an offset before payment, a credit claim after it, never both.
- **Product:** a 30-day Pro trial. The old mobile app is FROZEN.
- **Alerts:** none 23:00–06:00 or on Shabbat, at most 6 per person per day. An overdue-claim reminder is a draft that sends only on a click.
- **Receiving and orders:**
  - "All arrived" asks for a 2-line spot check and marks the rest "לא נספר" (20).
  - A walk-in supplier is approved by the manager. Its expected price comes from the contract, then the restaurant's own last price, then the list; never from the invoice (21).
  - A colleague's photos upload with attribution (22).
- **Process:** the AGENTS.md amendment for number input is a human PR (23). Fixing existing bad data means read-only reports plus human approval, after the pilot (24).
- **Design:**
  - LIGHT "command center for money" (this overrides any "dark" wording). Hebrew-first RTL, he-IL numerals, ₪ only via `formatIls()` / `<Money>`, WCAG AA (4.5:1).
  - Emphasis tiers: **T1** the leak ₪ is the hero · **T2** act-now items get a solid danger/warn badge, ₪ and one primary CTA · **T3** good news is calm gold/green · **T4** pending and consolidated items are neutral, never a false alarm.
  - Tokens live only in `packages/ui-tokens` (W1-01 v2) and `globals.css` vars. No hex in TSX and no second design language.

## 8. Immutable files: human-authored PR only
These come from the AGENTS.md list:
- `packages/matching/**`: the engine, `index.ts`, `reconciliation.ts`, `tolerances.ts`, `units.ts`, the leak canary and its fixtures;
- `apps/web/lib/money.ts` (`formatIls`) and the agorot↔display boundary;
- RLS SQL `drizzle/rls/0001`, `0002` and `packages/db/src/rls.ts`;
- the applied migrations and `drizzle/meta/`, `packages/db/src/schema.ts` and `drizzle.config.ts`;
- `cross-tenant.attack.test.ts` and `rls.attack.test.ts`. You add entries only in your own `coverage/<ID>.ts` once W2-01 lands;
- `packages/db/src/plans.ts` and `packages/billing/*`;
- `packages/api/src/approvals/engine.ts`, `notifications/outbox.ts` and `apps/worker/src/cron.ts`;
- `routers/leads.ts`, `apps/web/app/api/trpc/[trpc]/route.ts` and `apps/web/lib/rateLimit.ts`;
- `.github/workflows/*`, `.claude/agents/*`, `AGENTS.md` and `OPERATING.md`.

After G-13 merges (decision 23), the number parser and server ₪ formatting join the list: `packages/types/src/{number-input.ts,money/**}` and `packages/api/src/reports/{bidi,money}.ts`.

Plan rules, also frozen:
- `packages/api/src/index.ts` takes one export line each for G-06, G-12 and W2-13, serialised by the orchestrator.
- Only W2-15 adds dependencies (`package.json` and lockfile).
- Only W2-13 adds i18n namespaces (`messages/index.ts`).

**If you need an immutable file:** don't touch it on your package branch.
1. Push a separate proposal branch, `claude/ux-<id>-hpr-<slug>`, with only that change.
2. Open a draft PR titled `HUMAN-PR proposal (<ID>): …`, with the exact diff, why it is needed and the tests.
3. Link it under "Human-PR proposals" in your package PR, send one BLOCKED/QUESTION message, and **stop that part**. Build the rest behind an interim.

The human-PR packages (W2-01, G-13, H-01, H-02, H-03) *are* proposal branches: build the proposal branch (the branch in the brief), open a draft PR titled `HUMAN-PR proposal (<ID>): …`, send one message, then **STOP**. A human authors, reviews and merges it; you do not push follow-ups unless the orchestrator asks.

## 9. Wave-2 ownership ledger (who may edit what)
Abbreviations: `web/` = `apps/web/`, `dash/` = `apps/web/app/dashboard/`, `cmp/` = `apps/web/lib/components/`, `nav/` = `apps/web/lib/nav/routes/`, `msg/` = `apps/web/lib/i18n/messages/`, `api/` = `packages/api/src/`, `wkr/` = `apps/worker/`.

Every package also owns:
- `api/__tests__/coverage/<ID>.ts`, if it adds a procedure;
- `web/e2e/<ID>.spec.ts` and `web/e2e/__screenshots__/<ID>/**`;
- the tests its brief lists.

Anything not listed is **read-only: ask first**.

| Pkg | Owns (sources: IMPLEMENTATION-PLAN wave-2 ledger, GAP-PACKAGES ledger, brief §2 corrections) |
|---|---|
| W2-01ʰ | `api/__tests__/cross-tenant.attack.test.ts` (COVERAGE declaration + completeness only), new `coverage/{index.ts,README.md}`, `coverage-manifest.test.ts` |
| W2-02 | `dash/{invoices,inbox}/**`, `web/app/scans/**`, `web/app/showcase/dashboard/invoices/**`, new `cmp/{invoice,documents}/**`, `nav/{invoices,inbox}.ts`, `api/routers/{invoices,ingest,match}.ts`, `msg/{invoices,ingest,scans,consolidated}/**`, `e2e/consolidated.spec.ts` |
| W2-03 | `dash/approvals/pay-run/**`, `api/routers/payRun.ts`, `api/lib/{claims,dueDate}.ts`, `msg/payRun/**` (no `nav/payRun.ts`: the RouteDef stays in W2-04's `nav/approvals.ts`) |
| W2-04 | `dash/approvals/**` except `pay-run/**` (adds `[invoiceId]/**`), `nav/approvals.ts`, `api/routers/approvals.ts`, new `api/approvals/bulkPolicy.ts`, `wkr/src/jobs/{matchInvoice,endOfDayReport}.ts`, `msg/approvals/**`, `e2e/W1-07.spec.ts` |
| W2-05 | `dash/receiving/**`, `web/app/showcase/receiver/{_steps/**,_state.ts,_mock.ts}`, `web/lib/pwa/**` (outbox, `DocumentCapture`), `web/app/receiver-sw.js/**`, `nav/receiving.ts`, `api/routers/{receiving,scans}.ts`, `api/receiving/**`, `msg/{receiving,dockPrice,receiverLangs}/**`, `e2e/{receiving-review,dock-slip}.spec.ts`, `e2e/W1-06.spec.ts` (selectors only) |
| W2-06 | `dash/orders/**`, `nav/orders.ts`, `api/routers/orders.ts`, `api/orders/**`, `msg/orders/**`, `e2e/W1-11.spec.ts` |
| W2-07 | `dash/inventory/**`, `nav/inventory.ts`, `api/routers/inventory.ts`, `api/inventory/**`, `msg/inventory/**`, `e2e/inventory.spec.ts` |
| W2-08 | `dash/{page,layout,nav,not-found,vat-at-risk,activity}.tsx`, `dash/home/**`, `web/lib/nav/**` core + `nav/{home,system}.ts`, `web/lib/__tests__/nav-registry.test.ts`, `cmp/{hero,notifications}/**`, `api/routers/{tasks,nav}.ts`, `api/tasks/**`, `msg/{overview,nav}/**`, `e2e/{nav-fit,role-switch,demo-path}.spec.ts`; registry-wide mechanical edits only (a `badge` key) in the unowned `nav/{ask,branches,catalog,chain,products,recipes,reports}.ts` |
| W2-09 | `dash/leaks/**` except `claims/**`, `dash/suppliers/[id]/leak-card*`, `cmp/{views,drill,flags}/**` + `LeakHeatmap.tsx`, `packages/charts/**`, `api/routers/owner.ts`, new `api/leaks/{evidence,reportExport}.ts`, `nav/leaks.ts` (incl. the `claims` RouteDef), `web/next.config.ts` (`redirects()` only), `msg/{leaks,leakProof,views}/**`, `e2e/supplier-leak-card.spec.ts` |
| W2-10 | `dash/leaks/claims/**`, `dash/leaks/__tests__/letters*`, `dash/recovery/**`, `nav/recovery.ts`, `api/routers/recovery.ts`, `api/recovery/**`, `msg/recovery/**` |
| W2-11 | `dash/suppliers/**` except `[id]/leak-card*`, `nav/suppliers.ts`, `api/routers/suppliers.ts`, `api/ledger/**`, `msg/suppliers/**`, `e2e/supplier-ledger.spec.ts` |
| W2-12 | `dash/contracts/**`, `nav/contracts.ts`, `api/routers/{contracts,priceAlerts}.ts`, `api/{contracts,priceAlerts}/**`, `msg/contracts/**`, `dash/__tests__/contracts-logic.test.ts` (ledger addition) |
| W2-13 | `web/lib/i18n/{translate.ts,glossary.ts,__tests__/**}`, `msg/index.ts`, `msg/{emails,components,common}/**`, `cmp/{ActivityFeed.tsx,activityText.ts}`, `web/lib/messageTemplates.ts`, `api/notifications/{templates.ts,copy/**}`, `api/match/persist.ts`, `wkr/scripts/seed-demo.ts` (activity inserts only) |
| W2-14 | `dash/{settings,team,exports,integrations}/**`, `nav/{settings,team,exports,integrations}.ts`, `api/routers/{settings,team,integrations,exports}.ts`, `api/exports/**`, `api/integrations/accounting/**`, `web/lib/growth/ReferralCard.tsx`, `msg/{settings,team,accounting,integrations}/**` |
| W2-15 | `cmp/**` except the folders owned above (and `CookieConsent.tsx`), new `web/lib/drafts/**`, `packages/ui-tokens/**`, `web/app/globals.css`, `web/tailwind.config.ts`, `web/eslint.config.mjs`, new `web/scripts/ds-check.sh`, `dash/lab/**`, `web/package.json` + `pnpm-lock.yaml` |
| G-04 | `api/match/{buildMatchInput,consolidated}.ts`, new `api/match/receiptTruth.ts` |
| G-05 | new `api/{lifecycle,invoices,discrepancies,events}/**`, new `api/lib/idempotency.ts`, `api/activity.ts`, `api/audit.ts` (union extension only; confirm on day 1) |
| G-06 | `api/notifications/{address,recipients,notify}.ts`, `api/reports/send.ts`, `wkr/src/jobs/ocrInvoice.ts` |
| G-07 | `api/lib/{roles,capabilities}.ts`, `api/trpc.ts`, `api/routers/activity.ts` |
| G-08 | `packages/catalog/**`, `packages/ocr/src/{pipeline.ts,__tests__/pipeline.test.ts}`, `api/catalog/**`, new `wkr/scripts/catalog-alias-remediation.ts`; ledger additions (W3-10 takes them in wave 3): `api/routers/mapping.ts` (provenance at :386 + review rows in `unmapped`) and `api/routers/catalog.ts` (the provenance at :706 only) |
| G-09 | `api/ingest/**`, new `api/documents/**` |
| G-10 | `api/supplierConfirm/**`, `web/lib/supplierConfirm/**`, `web/app/api/supplier-confirm/**`, `web/app/s/[token]/**`, `msg/supplierConfirm/**`, `wkr/scripts/seed-wave1-contracts-demo.ts` (answer block) |
| G-11 | new `web/lib/legal/{registry.ts,LegalLinks.tsx}`, `web/app/(marketing)/_components/{MarketingShell,LegalShell,detail-sections,LeadForm}.tsx` + `seo.ts`, `(marketing)/leak-check/LeakCheckForm.tsx`, `web/app/{robots,sitemap}.ts`, `web/app/{error,global-error}.tsx`, `web/app/admin/layout.tsx`, `web/lib/publicPaths.ts` + `web/lib/__tests__/publicPaths.test.ts`; boundary additions (confirm day 1): the footer `<nav>` of `web/app/(auth)/_components/AuthShell.tsx`, the legal links of `web/app/showcase/_components/ShowcaseFooter.tsx`, the `accessibility.{levelBody,metaDescription}` keys of `msg/marketing/{he,en}.ts` |
| G-12 | new `api/approvals/awaiting.ts`, `api/ask/**`, `apps/mobile/app/{owner,manager}/**`, `msg/ask/**` (copy keys only) |
| G-13ʰ | `packages/types/src/{number-input.ts,index.ts,money/**}`, `api/reports/{bidi,money}.ts`, `wkr/src/lib/notifyHelpers.ts`, `api/integrations/pos/csv.ts`, `api/recipes/csv.ts`; AGENTS.md text as a proposal only |
| H-01ʰ | `web/lib/money.ts`, `web/lib/__tests__/money*.test.ts` |
| H-02ʰ | `web/app/(marketing)/{privacy,terms,cookies}/**`, `msg/marketing/legal.*`, `cmp/CookieConsent.tsx`, `web/lib/cookieConsent.ts`, new `web/lib/legal/{operator,subprocessors,docs}.ts` + `web/lib/legal/__tests__/{subprocessors,legal-readiness,cookie-inventory}.test.ts`; `wkr/fly.toml` and `render.yaml` only if G-02 is absent |
| H-03ʰ | `packages/db/src/schema.ts` (additive), one new migration + journal entry, the `rls/0002` table list, shape tests, an add-only RLS probe block in `api/__tests__/rls.attack.test.ts`, `supabase/migrations/**` + `supabase/released-migrations.json` (via `supabase-sync` only) |

**Cross-boundary exceptions** (each needs the orchestrator's OK first, is named in the PR body, and the orchestrator serialises them):
- `packages/api/src/index.ts`: one additive export line each for G-06 (`notify`), G-12 (`awaitingDecision`) and W2-13 (`EMAIL_COPY`). Nothing else in that file changes.
- G-06 rewrites `api/__tests__/recovery.test.ts:307-321` (W2-10's file) to the honest delivery contract; every new assertion is stricter, with an old→new table in the PR.
- W2-13 moves the `localizeActivity` block out of `cmp/__tests__/ops-components.test.ts` (W2-15's folder) into its own `activity-feed.test.ts`, 1:1.
- H-02 asks the owner to edit the values of `web/lib/contact.ts` `PUBLIC_FACTS.company.*`, and adds one QA-cookie fixture line to `e2e/{consent-clearance,consent-login,W1-01}.spec.ts`.
- W2-14 flips one assertion in `api/__tests__/integrations.test.ts:153-170` (bookkeeper FORBIDDEN → ALLOWED + audit row) by owner decision; the manager, receiver and chef FORBIDDEN assertions stay.

**Unowned in wave 2 (ask before any edit):**
- routers `consolidated` and `supplierConfirm` (G-08 holds the two narrow `mapping`/`catalog` additions above);
- `api/match/priceHistory.ts` and `api/reports/{monthly,pdf}.ts`;
- `api/lib/{deliveryState,scanUrls,supabaseStorage,localScanStorage,features}.ts`;
- `packages/{ingest,queue}`, and `packages/ocr` except `pipeline.ts`.

`apps/mobile/app/receiver/**` is frozen.

## 10. Start order and batches (at most 8 sessions at a time)
Three batches, started in this order. A batch is a queue tier, not a set that runs at once: the next package in the list starts when a slot frees. A slot frees when a session's draft PR is green and it is waiting (on review, a dependency or the orchestrator); it wakes on a message. Human-PR sessions free their slot as soon as the proposal is drafted. A brief that says "start on 3.11" means "as soon as you get a slot". Every package can start before its dependencies merge (column 3 says against what); none may *merge* before them.

Merge steps (MASTER-PLAN §5): **1** W2-01 · **2** enablers (W2-09a, G-05, G-04, G-07, W2-15 drafts; G-12a right after them) · **3** H-01, G-13 · **4** W2-05 → W2-07, W2-06, G-06, G-08, G-09, G-10, G-11 · **5** W2-02, W2-04, W2-10, W2-11, W2-12, W2-13, W2-14 · **6** H-03 (deployed) → W2-03 · **7** W2-08, G-12b, rest of W2-09 · **8** H-02 (counsel), W2-15 last.

| Batch | Pkg | Start before deps merge? Build against these stubs/interims | Step |
|---|---|---|---|
| A (3.11) | W2-01ʰ | Needs nothing. Proposal; human review 8–10.11. Until it merges, your `coverage/<ID>.ts` exists but isn't loaded | 1 |
| A | G-05 | Yes. Detect G-03 objects once per process (`to_regclass`/`pg_enum`) with fallbacks; the `AuditAction` pre-adds go in PR (a); build `invoices/state.ts` last, after W2-09a | 2 |
| A | G-07 | Needs nothing | 2 |
| A | G-04 | Yes. Interim count marker until G-03 `counted_at` is deployed (≥10.11); keep the `SETTLED_STATUSES` literal until G-05 | 2 |
| A | W2-09 | Needs nothing. **09a** (charts exports, no ₪ change) by ~12.11; **09b** (`DrillLink`, `flags/why.ts`) ~15.11; then 09c | 2 / 7 |
| A | W2-15 | Needs nothing. **15a** (`lib/drafts/**`, PrintButton) by 14.11; primitive fixes on request (≤2 working days); final PR last | 2 / 8 |
| A | G-13ʰ | Needs nothing. Proposal; human slot 15–21.11 | 3 |
| A | H-01ʰ | Needs nothing. Proposal | 3 |
| B (as A slots free, ~4–10.11) | W2-06 | Yes. Manager tier first and the chef path only after G-07. `resolveExpectedPrice` goes in your first commit (W2-05 imports it). `matchLine` exact-only until G-08; `supplierAddress()` until G-06 | 4 |
| B | W2-05 | Yes, as 3 slices; **A (outbox core) first**, because W2-07 waits on it. Role procedures until G-07; walk-in price NULL until W2-06; concrete addresses until G-06; no "הספק הודיע" chip until G-10 | 4 |
| B | G-09 | Yes. A `createIntakeInvoice()` wrapper until G-05. Publish `composeDocument`/`attachAsPage`/`splitDocument` types + NOT_IMPLEMENTED stubs on day 1 | 4 |
| B | G-12 | Yes. **G-12a** `awaitingDecision` over per-invoice `computeInvoiceLeak` until W2-09a and `expandVisibleRoles` until G-07; it merges right after them (orchestrator confirms). G-12b (Ask, mobile) in step 7 | 2 / 7 |
| B | W2-10 | Yes. **10a** `materializeClaims` first (~18.11; W2-04 rebases on it). Letter persistence waits for G-03 `claim_letters`; stub the why-formatter until 09b | 5 |
| B | W2-13 | Yes. **13a** templates by 18.11 (W2-04 and G-06 wait on them). Keep the guarded UPDATE in `persist.ts` until G-05; `formatIlsAgorot` until G-13 | 5 |
| B | G-06 | Yes. `address`/`notify`/`recipients`/`send` first; an `onOcrFailed()` wrapper until G-05; an injected `render` until 13a; no ₪ for receiver/chef until G-07 | 4 |
| B | G-08 | Yes. Interim confidence encoding behind one `aliasProvenance()` reader until G-03 `source` is deployed | 4 |
| B | H-03ʰ | Yes, once G-03 has merged (wave 1, ~7.11); otherwise draft as `00NN` and renumber. Moved up from last: it is on the critical path (W2-03's "סמן כשולם" opens only after it is deployed) and the human review is week 5. Deployed with a backup + the second human gate, never in the freeze | 6 |
| C (as slots free, ~10–15.11) | G-10 | Yes. Needs W1-09 only; `parseNumberInput` + one `TODO(G-13)` | 4 |
| C | G-11 | Yes. `LegalShell` `status` defaults to `'draft'` | 4 |
| C | W2-04 | Partly. Start with grouping, 3-pane, keys, history, the `[invoiceId]` landing and `bulkPolicy.ts`. One `decide(tx)` over the wave-1 CAS until G-05; decision in `audit.after` until G-03. Hard-waits for G-12a and 10a | 5 |
| C | W2-02 | Partly. Cockpit, ported viewers, `/scans` and inbox fixes first. An `invoiceStateOf()` adapter until G-05; attach/split hidden until G-09; `financeProcedure` until G-07 | 5 |
| C | W2-11 | Yes. Header ₪ switch, tabs, vendor table, form and ledger UI first. `EXISTS match_runs` until G-05; `receiptTruth` after G-04 | 5 |
| C | W2-12 | Yes. Deep link `/dashboard/approvals?invoice=<id>` until W2-04. `PRICE_ALERT_REASONS` stays off until G-05's PR (a) merges; `<Money>` + a word until H-01 | 5 |
| C | W2-14 | Partly. Settings read, h1s, staged-role UI and export panel first; the rest needs G-07 and the G-05 actions. `phoneVerify` stays off | 5 |
| C | W2-07 | Partly. `setSales`, labels, chef redaction, field shell and DataTable first. The outbox kind after W2-05 slice A; `receiptTruth` after G-04 | 4 |
| C | W2-08 | Yes. `TaskSource` adapters over today's services; swapping to `awaitingDecision` when G-12a lands is one line | 7 |
| C | W2-03 | Partly. `dueDate.ts`, the claims rule, buckets, DataTable and phone layout first. `markPaid` behind `PAY_RUN_MARK_PAID` (off) until H-03 is deployed; short-pay hidden until `payment_deductions` | 6 |
| C | H-02ʰ | Yes, with marked placeholders while `draft` (decision 2 is still open). It merges when counsel signs | 8 |

ʰ = human-PR: the session drafts a proposal branch, and a human authors, reviews and merges it.

**Day-1 rule for everyone:** publish the exports your dependents need in the first commit of your draft PR. Code against a dependency's published signature, never its internals. Swap each interim in one line when the dependency merges.

## 11. Reference copies (read by line range only)
The planning docs the briefs cite live outside the repo, so the kit ships verbatim copies in `docs/ux/wave2/ref/`. Brief line ranges point into these copies:
- `ref/DEEP-FIX.he.md`: the 15 bug classes, each with its systemic fix and carrier packages (e.g. class 14 at 701-752, class 15 at 754-799).
- `ref/GAP-PACKAGES.md`: Part A gap packages, Part B scope amendments, the overlap ledger (e.g. G-02 at 31-41).
- `ref/MASTER-PLAN.he.md`: windows, dependencies, quality gates per wave (§4) and merge order (§5).
- `ref/copylab/lab-output.txt`: W2-13's bidi lab I output. Read it; the generating script is not in the repo (it hard-coded local paths).

Findings and evidence stay in `docs/ux/review/area-*.md` and `lens-*.md` (`grep -n '<id>'`, then ±40 lines). Nothing in `ref/` is binding over AGENTS.md, §7 above or your brief.

## 12. Updates from the orchestrator, 31.10 evening (binding; they override anything above that differs)
- **Wave 1 shipped as one merge (PR #167),** including late cross-package fixes:
  - W1-03 follow-up: `/dashboard/leaks` is the monthly **"דליפה"** hub, and price creep is its `#prices` section ("מחירים שעלו"). Chef inventory and receiver invoices show no ₪, and their search is screens-only.
  - W1-05 follow-up: the home "ממתין להחלטה שלך" = `approvals.queueSummary` (ONE figure). The overdue-claims row = the recovery page's `followUps()`.
  - W1-06 follow-up: re-auth on 401, held stale counts, receiver languages complete. The overlays are machine-translated and pending native review.
  - W1-08 follow-up: the noData CTA goes to a route every tenant has.
  - W1-04 follow-up: one offline chip on receiving routes.
  - Read the merged code, not the wave-1 PR bodies.
- **Side menu: owner-approved.** The spec is `docs/ux/sidebar/SPEC.md` (read its top box first) and the clickable prototype is kept out of the tree (a design file, not product code): `git show 6fe38589:docs/ux/sidebar/PROTOTYPE.html > /tmp/sidebar-prototype.html` and open it locally. W1-03 builds it at the start of wave 2 on the nav registry.
- **Design elevation (new track, UI wave 2):** the owner wants a more advanced design pass over the side menu and the main screens. It runs as a separate design track (competing bold directions, judged, then the owner picks). Packages build on today's tokens and must not hard-code anything that would block a token-level re-theme.
- **Owner decisions of 31.10 (evening) — these were open, now decided:**
  1. **The chef sees ₪ in recipes:** plate cost, menu price and margin. (Elsewhere the chef sees ₪ only on the orders screens, also decided 31.10; the receiver sees no ₪ anywhere.) G-07 models both as chef capabilities; H-11's server strip exempts them; W2-07 drops the chef's %-only rule in recipes.
  2. **MISSING_ON_INVOICE is NOT claimable.** No claim letter, recovery item or "claim" action for it, consistent with W1-07 approvals. The claims side (`lib/claims` `claimableLines`, the letters, `syncClaims`) is fixed in train A by W1-08. The owner ALSO approved (31.10, Hebrew summary) taking it out of the leak figure: `LEAK_FILTER` excludes it from train B (W1-08, owner-approved ₪-math PR). It stays a review item with no ₪. Don't change `LEAK_FILTER` on a package branch; build on train B.
  3. **A credit demand is overdue after ONE WEEK (7 days)** from the letter (or the claim, if no letter went out). This replaces 14 days everywhere: `OVERDUE_DAYS`, `ANSWER_DAYS`, `followUps()`, the home overdue row, the copy "מעל 14 יום", and the letter's answer deadline. Use ONE shared constant. Train A (W1-08) changes the constant; W2-08/W2-10 build on it. The recovery service's `overdueCount` and the reminders still use the older "acknowledged = overdue" rule; aligning them to `followUps()` stays with W2-08.
- **Known items assigned in wave 2:**
  - WorkerStatusBanner pushes content (CLS) when the heartbeat is stale; it moves out of flow (W2-15 or W1-04).
  - Receiver/chef ₪ in tRPC JSON is H-11 (human PR).
  - Chef ordering: the base (route, nav entry, `chefProcedure` on order writes, ₪ visible in orders) lands **before the pilot in train A via W1-11**. W2-06 builds on it and does not redo it.
  - `/dashboard/orders/<unknown>` answers 200 because `loading.tsx` streams before `notFound()`. W2-06 makes it answer 404.
- **Pilot freeze 06.11–10.11:** nothing merges to `main` and nothing deploys. Keep working on your branch; the first wave-2 integration (`release/wave-2`) lands after 10.11.
- **Self-check before you send GREEN:**
  - Run your own e2e spec plus every spec that touches a route you changed (`grep -l '<route>' apps/web/e2e`).
  - Run `check:demo`.
  - Re-read your diff for anything another package's test pins. Wave 1 shipped 47 cross-package e2e breaks that every package's own CI missed.
  - Say in the PR body which specs you ran.
- **Review depth follows risk:**
  - ₪ math, tenant/role, auth, money limits or any immutable-adjacent file get the two-lens review plus a verifier.
  - Copy-only or style-only changes get one lens.

## 13. Updates from the orchestrator, 1.11 (binding; they override anything above that differs)
- **Owner decisions of 31.10 (late evening), consolidated invoices and payment terms:**
  1. **Real consolidated-invoice (חשבונית מרכזת) detection lands BEFORE the pilot, in train B.** That means OCR document kind, billing period and delivery-note list (S14), plus their persistence (S13 #224: `raw.kind`, `periodStart`/`periodEnd`, `deliveryNotes[].number`; a consolidated invoice is never single-PO matched; an unknown supplier goes to review; a ח.פ. mismatch is flagged). Wave-2 packages build on those fields; don't re-detect.
  2. **Payment terms go ALL in wave 2:**
     - **Structured terms per supplier:** W2-11's terms picker writes canonical strings ("מזומן", "שוטף", "שוטף+N") into the existing `suppliers.payment_terms` column. No schema change.
     - **A computed due date:** W2-03 `lib/dueDate.ts` `computeDueDate`; the pay run buckets by due date.
     - **OCR of the printed terms and due date:** the new package **G-17** (ocr-procurement-engineer); values persist in `ocr_payload.raw.printedTerms` / `printedDueDate`.
     - **The new flag "תנאים קצרים מהמוסכם":** G-17 `termsCheck` + W2-03 renders it. It is a **warn** chip in the pay run, with both dates. The pay run sorts by the **agreed** due date.
  3. **Three new consolidated flags (G-04 addendum, below):**
     - a delivery note from another month;
     - a listed note that isn't in the system;
     - a note billed twice, including month-total lines and two consolidated invoices for the same supplier and month.
- **None of these adds a `DiscrepancyType`.** The 12-type union and the engine are immutable. The terms flag carries no ₪. "Billed twice" shows its ₪ as a T2 review item ("אפשר שחויב פעמיים") in the consolidated panel and as a pay-run hold. It enters the leak figure only through a human-authored engine PR. If you think one is needed, write the proposal in your PR body.
- **Train state:**
  - train A merges Tue 3.11 09:00 IL;
  - train B merges Wed 4.11 08:00 IL;
  - the pilot freeze runs 06.11–10.11;
  - the first wave-2 integration comes after 10.11.
  G-17 and the G-04 addendum start after train B is on `main`.
