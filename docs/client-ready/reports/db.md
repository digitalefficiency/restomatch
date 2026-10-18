# S1 — Database report (client-ready sprint)

Branch `claude/client-ready-db` → draft PR into `claude/client-ready`. Production was not
touched. The owner's procedure is **`docs/DB-RUNBOOK.md`**.

## Headline

Prod can go 0018 → latest in about 20 minutes with three commands that cannot hurt it
(`pnpm db:doctor` is read-only; `repair-preconditions` does a dry run by default;
`db:migrate` runs as one transaction). A test proves the whole path on a 0018 database
seeded with every edge case the guards check for. The demo data now tells a believable
₪ story: about 2 % of month-to-date food spend surfaced as leak, 6 open items, 4 leaks
on the leaks page, and 3 POs due today. Every seeded user logs in with a known password.

## Works (verified)

- **Fresh DB, 0000 → 0032**, applies cleanly, and re-running is a no-op. The schema
  fingerprint (columns, indexes, constraints, triggers) is identical before and after
  the re-run. Test: `upgrade-path.test.ts`, "fresh database".
- **0018 → latest upgrade** on a scratch DB (journal cut at 0018 + `seedFixture0018`).
  The fixture holds realistic rows plus a NULL-tenant walk-in scan, a cross-tenant
  product, a duplicate goods receipt, a restaurant at VAT 0.17 and a negative quantity:
  - the doctor flags 0020/0021/0027 as FAIL and 0032 as WARN;
  - the migrator refuses, **atomically** (it stays at 0018 and 0019 is rolled back);
  - the repairs fix the rows, the upgrade succeeds, and re-running is a no-op;
  - VAT 0.17 becomes 0.18, the kept receipt is the one with lines, and the data survives;
  - after provision-rls and VALIDATE, the doctor reports 0 FAIL and 0 WARN.

  Test: `upgrade-path.test.ts`, 9 tests.
- **`rehearse-cutover`** (rewritten on the shared fixture, repairs and doctor) runs the
  same sequence end-to-end on a local scratch DB and passes. **`verify-cutover`** passes
  locally, including the `--dump` age check and `--through`.
- **Password login works for the demo users** (Playwright against `next dev`): owner →
  `/dashboard`, receiver → `/dashboard`. The receiving inbox lists the 3 POs due today.
- **`check-rls`** is OK. The RLS + cross-tenant + storage attack suites pass 150/150.
- **EXPLAIN on the seeded data** (`enable_seqscan=off`, so this shows the indexes are
  usable) — every hot path uses an index:
  - leaks SQL → `price_history_restaurant_observed_idx` (new);
  - owner KPI → `discrepancies_queue_idx`;
  - receiving inbox → `po_restaurant_delivery_idx`;
  - invoice detail → `match_runs_invoice_idx` (new);
  - match-run cascade → `discrepancies_match_run_idx` (new);
  - PO → receipt → `goods_receipts_po_idx` (new).

  Each query takes under 0.3 ms.
- Schema audit:
  - no float or money types;
  - `restaurant_id` is NOT NULL on all 22 tenant tables;
  - every table without a `restaurant_id` is join-scoped by RLS (child lines,
    identity, billing).

  The enum values used in code all exist in their enums.

## Fixed

| # | Problem | Fix | Test |
|---|---|---|---|
| I5 | `po_source_ref_unique` and `suppliers_external_ref_unique` were **global**, so a second tenant on the same platform got a 23505 | **0029**: new unique indexes on `(restaurant_id, source_platform, ref)`, created before the old ones are dropped. They cannot fail, because the new key is looser. No `onConflict` targets these indexes; the lookups in `importPo.ts` and `syncPlatforms.ts` were already restaurant-scoped (only their comments changed) | `migration-0029.test.ts`, `upgrade-path.test.ts` (I5 case) |
| — | 44 unindexed foreign keys. Cascades seq-scanned `discrepancies`, `goods_receipts` and others; the leaks SQL filtered `price_history` by `restaurant_id` with no usable index | **0030**: 33 indexes. The remaining 12 low-churn audit pointers (`created_by`…) are an explicit allowlist in the doctor | `migration-0030.test.ts` |
| — | `updated_at` changed only where call sites remembered (~27 sites; 13 tables) | **0031**: a `set_updated_at()` BEFORE UPDATE trigger on every table with `updated_at`. It respects explicit writes | `migration-0031.test.ts`, upgrade test |
| — | Missing CHECKs the code assumes: VAT written as 18 instead of 0.18, negative received quantity, confidence > 1, non-ISO currency, bad `period` | **0032**: 21 CHECKs from `src/integrityChecks.ts`, added `NOT VALID` and then validated only where clean. The migration **cannot fail on real data**; the doctor lists any constraint left unvalidated | `migration-0032.test.ts`, upgrade test |
| — | **seed-demo marked every invoice as DUPLICATE_INVOICE.** It added the number to the same Set it passed to the engine, before `runMatch`. That was the old "114 open discrepancies" and a leak above 100 % of spend | The engine now gets a copy, and the number is added after the run | seed output: 6 open, 1.8 % |
| — | Seeded discrepancies got `created_at = now()`, so all 8 weeks counted as "this month" | `created_at = receivedAt`; items older than 10 days are resolved (credit note) | KPI check |
| — | **Seed guard was a substring match**: `…supabase.co/postgres?x=localhost` passed it (same in `reset.ts`), and `seed-demo` had no guard | `src/seedGuard.ts`: checks the parsed host only. Exact-host opt-in `SEED_ALLOW_REMOTE_HOST` for a disposable demo DB; the production ref is refused even then. Used by seed, seed-demo and reset | `seed-guard.test.ts` (spawns seed/reset with a remote URL → non-zero exit, before any connect) |
| — | Seeded users had no password and no `email_verified`, so password login was impossible | Seed sets argon2id `DEMO_PASSWORD` (default `RestoMatch-Demo-2026!`) and `email_verified`; `receiver@` gets `preferred_locale='en'` | Playwright login |
| — | `user-credentials.test.ts` drops and recreates the credential tables from 0023+0024 only, leaving the **shared test DB** without 0025's column and 0031's trigger | It now re-applies 0025, 0026 and 0031 | full suite |
| — | `migrate.ts` printed hundreds of "already exists, skipping" NOTICEs and hid the important ones | Routine notices are swallowed; others (e.g. 0032 NOT VALID) are surfaced | — |

**New tools**

- `pnpm db:doctor`: `src/doctor.ts` + `scripts/doctor.ts`, with `--json` and
  `--strict`. Read-only `BEGIN READ ONLY` plus a statement timeout. It checks:
  - applied, pending and gap migrations, a DB that is ahead of the checkout, and hash drift;
  - per-pending-migration preconditions for 0019–0032;
  - RLS: completeness, policies and the join-scoped tables;
  - the app role: bypass, superuser, login, identity revokes, read-only tables, grants
    and execute;
  - 14 cross-tenant consistency checks, owner-less restaurants, and matched invoices
    with no match run;
  - unindexed FKs, invalid indexes, NOT VALID constraints and missing `updated_at`
    triggers;
  - bucket privacy and sizes.
- `repair-preconditions`: `src/repairs.ts`. Dry run by default (it rolls back); `--apply` commits.
- Shared helpers: `src/migrations.ts` and `src/upgradeFixture.ts`.

**Demo data** (`packages/db/scripts/seed.ts` + `apps/worker/scripts/seed-demo.ts`)

- **Catalog and team:** 10 fictional Israeli suppliers and 56 products, all with
  Hebrew + `name_en`. `po_lines` and `invoice_lines` carry `raw_description_en`.
- **History:** 8 weeks of deliveries on each supplier's real cadence (99 POs), run
  through the real matching, approvals and baselines engines.
- **Month to date:** spend ₪28,870; leak surfaced ₪529 (**1.8 %**); ₪370 open.
- **Discrepancy types:** PRICE_HIGHER (warn and block), QTY_SHORT + QTY_OVER (short but
  billed in full), UNORDERED_ITEM, VAT_MISMATCH (old 17 %), PRICE_LOWER (info,
  auto-accepted).
- **Leaks page:** entrecôte ₪139→149, salmon ₪89→96, beer keg +10.6 %, olive oil +10 %.
- **Calm items:** 2 consolidated invoices (חשבוניות ריכוז), parsed and **pending**.
- **Today:** 3 POs due (10:00, 12:30, 15:00 Asia/Jerusalem) and 2 upcoming.
- `DEMO_TODAY=YYYY-MM-DD` seeds tomorrow's demo tonight.
- The base seed runs in 2 s and seed-demo in 5 s.

**`scripts/dev-setup.sh`**

- Uses whichever Postgres it finds, in this order: one already listening on
  localhost:5432, then apt on Linux, then Homebrew on macOS, then `docker compose`.
  `--docker` forces Docker.
- Before migrating it checks Node ≥ 20 and pnpm (falling back to corepack), waits for
  Postgres to be ready, and checks pgvector is available.
- It also starts Redis, runs `db:doctor` at the end and prints the demo logins.

## Still broken / not done

- **The Docker fallback in `dev-setup.sh` is untested.** There is no Docker daemon in
  this container. The Linux "existing Postgres" path was verified with two runs.
  macOS/Homebrew was written to brew's conventions but not run.
- **Prod shape is unverified beyond the journal.** The doctor will show drift
  (hash drift, extra tables such as hand-created `user_credentials`, an `invoice_scans`
  that differs from 0003). Running `pnpm db:doctor` against prod is step 2 of the
  runbook and needs only read access.
- The engine counts a short delivery billed in full twice (QTY_SHORT and QTY_OVER both
  add `|delta|`), so that incident shows ₪77 for a real ₪38.7 loss. That is
  matching-engine semantics (S3), not changed here.
- `invoices_dedupe_idx (supplier_id, invoice_number)` does not dedupe invoices whose
  supplier is still NULL (OCR pending). This is by design; noted only.

## Feature & improvement proposals (client value ÷ effort)

1. Run `db:doctor --json` in CI after migrate. It is cheap, and it catches a
   tenant table without RLS or a bad index before review (S7).
2. Have the receiving page and the API apply `memberships.preferred_locale` on login.
   The data is seeded, but the UI ignores it today (S4).
3. A nightly read-only `db:doctor` against prod, posted to the owner's mailbox.
4. Add a `CONCURRENTLY` variant for future index migrations once tables pass about
   100k rows (the migrator runs in one transaction).
5. An `invoice_received` writer in the real OCR job. The seed writes these events, but
   nothing in production does.

## Immutable files touched (owner asked; each is minimal and tested)

- `packages/db/src/schema.ts`: index definitions mirroring 0029 and 0030 (the I5
  uniques renamed to per-restaurant). No column or type changes.
- `packages/db/drizzle/meta/_journal.json`: 4 entries (0029–0032, `when` per the brief).
- New migrations `0029`–`0032` (new files; the applied history is untouched).
- `packages/db/scripts/reset.ts`: uses the shared host-based guard.

`rls.ts`, the RLS SQL and the attack suites were **not** modified.

## Needs another area

- **S2 (receiving):** `apps/web/app/dashboard/receiving/page.tsx:40` formats
  `expectedAt` with `toLocaleTimeString('he-IL', …)` and no `timeZone`, so the server
  renders UTC. Today's 10:00 delivery shows as **07:00**. Pass
  `timeZone: restaurant.timezone` (or use `formatDateTime` from `@/lib/i18n/format`
  with the tz).
- **S4 (auth/team):** apply `memberships.preferred_locale` at sign-in, by setting the
  `rm_locale` cookie when it is non-null. Otherwise `receiver@` lands in Hebrew.
- **S5 (orders/sync):** the `${restaurantId}::` prefix on Zestt `external_ref`
  (`importPo.ts`) is no longer needed after 0029. It was kept for existing rows; the
  comment was updated.
- **S7 (platform):**
  - root `package.json` gained `"db:doctor"` (one line) and `pnpm-lock.yaml` gained one
    importer line (`@restomatch/crypto` as a devDependency of `@restomatch/db`, for the
    seed's argon2 hash);
  - consider `db:doctor` in CI;
  - the worker-down banner shows in a demo unless the worker runs (or its heartbeat is
    present).
- **S3 (money):** QTY_SHORT + QTY_OVER double-count (see above). The owner KPI
  "savings captured" includes auto-accepted info items.

## Gate

| Command | Result |
|---|---|
| `DATABASE_URL_TEST=…/restomatch_test pnpm test` | **12/12 tasks**, 784 tests passed (db 40 → 43 with `doctor.test.ts`, api 386, web 132, matching 76, …), 1 skipped (worker: Redis) |
| `pnpm --filter @restomatch/db exec vitest run` | 13 files, 43 tests passed |
| `pnpm --filter @restomatch/api exec vitest run rls.attack cross-tenant.attack storage.attack` | 150/150 |
| `DATABASE_URL=…/restomatch_test pnpm --filter @restomatch/db check-rls` | OK |
| `DATABASE_URL=…/restomatch_dev pnpm db:doctor` | 0 FAIL · 0 WARN · 21 PASS |
| `rehearse-cutover` on a fresh scratch DB | ✔ complete |
| `verify-cutover` on dev | all checks passed |
| `npx tsc --noEmit -p packages/db` | 0 errors |
| `pnpm --filter @restomatch/web exec tsc --noEmit -p .` · worker + api `typecheck` | 0 errors |
| `./scripts/dev-setup.sh` (re-run on a seeded box) | ✔, 17 s |

## Follow-up round (after the merge into `claude/client-ready` @ 68ed10d)

| Ask | Done | Verified |
|---|---|---|
| Supplier price lists so the catalog isn't empty | `seed.ts` writes 10 committed `catalog_imports` + 56 `supplier_catalog_items` (מק״ט, unit, list price, linked product → English name) + the learned `product_aliases`, i.e. the same tables `catalog/commit.ts` writes; PO lines carry the מק״ט. (S5's fixtures name other suppliers, so the lists are generated from the seeded catalog.) | `/dashboard/catalog` shows "50+ items" across all 10 suppliers with English names (Playwright) |
| Re-verify against the merged engine (S3) — full `pnpm test` on the merged code: 12/12 tasks green | `seed-demo` now prints the **dashboard hero's own numbers** (`computeLeakHero`). Consolidated invoices now *replace* the per-delivery invoices of this week's bakery drops + the latest dairy delivery (goods receipts only), so spend is not double-counted. Added resolved September incidents so "last month" isn't ₪0. S4's `is_platform_admin` for owner@ kept. Doctor has a precondition entry for S4's 0039 | hero (browser): **₪572 = 1.9 % of ₪30,802**, caught before payment ₪296, claimed ₪276, 9/24 invoices, 5 in the approvals queue, 62.5 % clean this week; last month 1.0 % of ₪62,872; leaks page: entrecôte, salmon, beer keg |
| `max_connections` for local runs | `dev-setup.sh` raises it to 300 (`PG_MAX_CONNECTIONS`) via `ALTER SYSTEM` + one restart per mode (service/pg_ctlcluster, brew, docker compose), only when lower | cold start after a container restart: `100 → 300 (restart)`; re-run: step skipped |
| Worker online for the demo | Runbook "Worker online for the demo": `cd apps/worker && DATABASE_URL=… REDIS_URL=redis://localhost:6379 pnpm start` (prod demo: `start-worker.sh` on the owner's Mac) | worker started → heartbeat key present within 1 s → dashboard banner absent (Playwright) |

DB-RUNBOOK updated: pending range now **0019 → 0039** (S4's 0039 in the §11 table), demo section rewritten with the per-screen numbers, worker + `max_connections` notes.

### Follow-up round 2 (base at the S3 round-2 merge)

- **Last month is believable:** a different set of resolved September incidents → hero/monthly report for last month **₪1,137 = 1.8 % of ₪63,205** (20 of 52 invoices); this month **₪572 = 2.0 % of ₪28,389** checked spend (S3 now excludes the never-matched ריכוז invoices). Leaks page unchanged (entrecôte, salmon, beer keg).
- **Journal gaps:** `db:doctor` already FAILs on "entries older than the newest applied row but not applied"; now also **`db:migrate` refuses to run** while a gap exists (`findJournalGaps` in `src/migrations.ts`) instead of letting drizzle skip them silently. Test: `upgrade-path.test.ts` "FAILs on a journal gap" (forgets 0030's tracker row → doctor FAIL naming 0030, `pending` empty, migrate refuses). Runbook §9 explains the cause and the repair.

### Round 3 — schema delivery to the NEW Supabase project via GitHub

- **`pnpm db:supabase-sync`** (`packages/db/src/supabaseSync.ts`, `scripts/supabase-sync.ts`, `--check`): generates `supabase/config.toml` (project_id `restomatch`, PG 17, seed off) and `supabase/migrations/`:
  - a bootstrap (extensions exactly as `migrate.ts` + drizzle tracker);
  - 34 drizzle migrations verbatim + an idempotent tracker row each (drizzle-orm's hash / `created_at`);
  - an idempotent `restomatch_rls_<hash>` file = provision-rls (rls/0002 + 0003, `restomatch_app` NOLOGIN without password, the grants via the new shared `rlsAppRoleGrantsSql()` in `rls.ts`, the private `invoice-scans` bucket, rls/0001 storage policies wrapped so a privilege error warns instead of blocking the deploy). It is re-emitted with a later version whenever its content or the journal tail changes; earlier ones are kept. The generator refuses a new migration older than an already-deployed version.
- **Proof on an emulated Supabase** (non-superuser CREATEROLE migration role, `storage` owned by `supabase_storage_admin`, anon/authenticated/service_role, uuid-ossp in `extensions`):
  - all 36 files applied with `psql -1 -v ON_ERROR_STOP=1`;
  - re-applying the RLS file is a no-op;
  - `db:migrate` is a no-op, and `db:doctor` reports 0 FAIL with the 1 expected WARN (role has no LOGIN yet), then 0 WARN after `ALTER ROLE … LOGIN PASSWORD`;
  - `check-rls` is OK, and the RLS + cross-tenant + storage attack suites pass **159/159** against it.

  The same flow is a CI test (`supabase-deploy.test.ts`, 9 tests). It also fails when `supabase/` is stale, and it shows the storage block degrades to a WARNING without rights on `storage.objects`.
- `db:doctor`: an app role without LOGIN is now WARN (not FAIL); bypass/superuser stay FAIL.
- Docs: **`docs/SUPABASE-GITHUB-DEPLOY.md`** (Hebrew summary on top) covers:
  - integration settings to verify, including turning automatic branching off to avoid paid preview DBs;
  - the `main`-is-a-placeholder branch decision;
  - the one manual SQL step (`alter role restomatch_app with login password …`);
  - Vercel and worker env;
  - doctor;
  - optional data move (upgrade a local copy of old prod, then a data-only load) and the optional demo seed;
  - rollback.

  ⚠️ Assumptions not verifiable from here (Supabase docs unreachable) are marked in §2. DB-RUNBOOK points to it.
- Immutable file touched: `packages/db/src/rls.ts` — the grants block moved verbatim into exported `rlsAppRoleGrantsSql()` (used by `ensureRlsAppRole` and the generator); behaviour unchanged, attack suites green.
- **Hardening before `main` (= Supabase production):**
  - **Data API lockout:** the RLS file revokes Supabase's default `anon`/`authenticated` grants on public tables and sequences, including future tables via default privileges. Without it, tables without RLS (`plans`, `dsr_requests`, the Auth.js identity tables) would have been readable or writable with the public publishable key. The app uses supabase-js for Storage only.
  - `db:doctor` FAILs if those roles can reach any public table.
  - The emulation now mimics Supabase's default grants.
  - Dropped the uncertain `[db.migrations]` key from `config.toml`.
  - The RLS file was regenerated as a single `…_restomatch_rls_2a5eafd1.sql`; the earlier one was never deployed and was removed.
- **Mandatory proof re-run on the final files:**
  - all 36/36 applied as a non-superuser with `psql -1 ON_ERROR_STOP`;
  - RLS re-apply OK;
  - `db:migrate` no-op;
  - `db:doctor` 0 FAIL / 1 expected WARN (no LOGIN yet), Data API PASS;
  - `check-rls` OK;
  - attack suites **169/169**.
- The deploy doc gained a §0 cutover order: schema → `restomatch_app` password → Vercel env → redeploy. There is no seed in migrations.
