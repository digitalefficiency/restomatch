# DB-RUNBOOK — production 0018 → latest, step by step

> **Who runs this:** the owner, from a laptop with the repo checked out at the merged
> commit. **Nothing here is run by an agent.** Every command is copy-paste; every
> step says what "good" looks like and how to undo it. Expected total time: **≈20 min**
> (plus the backup), most of it reading output.
>
> Supersedes the ordering in `GO-LIVE.md` §C/§E for the database part. Detail for the
> storage bucket stays in `PR1-storage-isolation-APPLY.md`; RLS background in
> `RLS-PROVISIONING-RUNBOOK.md`.

**Where prod is:** Supabase `cringgshiafwsszyqufo`, schema at **0018**. Pending:
**0019 → 0039** (table in §11; 0033–0038 are unused numbers). The web still runs on the owner connection until
`DATABASE_URL_APP` is flipped (§8).

**The tools (all in `packages/db`):**

| Command | Writes? | What it does |
|---|---|---|
| `pnpm db:doctor` | **never** (one `READ ONLY` transaction) | applied/pending migrations, journal gaps, preconditions of every pending migration on the live rows, RLS, app role + grants, cross-tenant integrity, unindexed FKs, NOT VALID constraints, bucket privacy. Exit 1 on FAIL. |
| `repair-preconditions` | dry run by default; `--apply` writes | fixes exactly the rows that make 0020/0021/0027 abort (one transaction; the dry run performs and rolls back, so its counts are exact). |
| `pnpm db:migrate` | yes | applies every pending migration **in one transaction** — a failure rolls the whole batch back; the DB stays at 0018. |
| `provision-rls` | yes | (re)applies tenant RLS (rls/0002), append-only audit (rls/0003), the `restomatch_app` role + grants, and with `PROVISION_STORAGE_RLS=1` the private bucket (rls/0001). Idempotent. |
| `verify-cutover` | never | the post-cutover gate (migrations, RLS, role, password rotated, FK, NOT NULL, audit trigger, bucket, web routes, backup age). |
| `rehearse-cutover` | yes (scratch DB only) | the whole sequence on a local/restored copy. |

---

## 0. Set up the shell (2 min)

```bash
cd ~/restomatch && git pull && pnpm install --frozen-lockfile

# Owner connection. Use the DIRECT host (db.<ref>.supabase.co:5432) or the SESSION
# pooler (…pooler.supabase.com:5432) — NOT the transaction pooler on :6543.
# Supabase dashboard → Project Settings → Database → Connection string → URI.
export DATABASE_URL_DIRECT='postgresql://postgres:<OWNER_PASSWORD>@db.cringgshiafwsszyqufo.supabase.co:5432/postgres'

# The tenant role's password. 24+ chars, no quotes/spaces. Put it in your password
# manager NOW — you paste it into Vercel in §8. Never paste it in a chat.
export APP_ROLE_PASSWORD="$(openssl rand -hex 32)"

psql "$DATABASE_URL_DIRECT" -Atc "select current_user, version();"   # → postgres | PostgreSQL 15.x/17.x …
```

## 1. Backup + PITR check (5–10 min) — do not skip

1. Supabase dashboard → **Database → Backups**. Note the plan tier.
   - **Pro with PITR:** write down the current time in UTC — that is your restore point.
   - **No PITR:** the daily backup is up to 24 h old. The dump below is your real backup.
2. Always take a logical dump too (pg_dump major version must be ≥ the server's):

```bash
pg_dump --version            # must be >= the server major from step 0 (brew install postgresql@17 if needed)
pg_dump -Fc --no-owner "$DATABASE_URL_DIRECT" -f "prod-$(date +%F-%H%M).dump"
pg_restore --list "prod-$(date +%F)"-*.dump | grep -c "TABLE DATA"   # → ≈40 (non-zero)
export DUMP="$(ls -t prod-*.dump | head -1)"
```

**Rollback for everything below:** PITR to the noted time, or restore this dump into a
fresh project (`pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL_DIRECT" "$DUMP"`).

## 2. Diagnose — `db:doctor` (1 min, read-only)

```bash
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm db:doctor
```

Good output at this stage:

- `migrations › applied: 19/34 … latest applied: 0018_invitations`
- `migrations › pending: 15 pending: 0019_storage_namespaces, …, 0039_invitation_locale` (WARN — expected)
- `migrations › journal gaps: PASS` and **no** `database ahead of checkout`
- `preconditions › …` — one line per pending migration. **Every FAIL here means
  `db:migrate` WILL abort** (harmlessly, atomically). Fix them in §3.
- `rls`, `app role` — should already PASS on prod (RLS on 38 tables, role exists). If
  `app role` FAILs on grants, §6 fixes it.
- `integrity › cross-tenant references` — WARN lines are data to look at, not blockers.

If anything outside `preconditions`/`pending` FAILs, stop and read its detail line —
each one names the fix.

## 3. Repair the preconditions (3 min)

```bash
# 0021: cross-tenant products — the provenance-based backfill first (dry run, then apply)
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db exec tsx scripts/backfill-product-supplier.ts
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db exec tsx scripts/backfill-product-supplier.ts --apply

# 0020 / 0021 leftovers / 0027: dry run — read every line
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db repair-preconditions
# then commit it
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db repair-preconditions --apply

DATABASE_URL="$DATABASE_URL_DIRECT" pnpm db:doctor     # → no FAIL under "preconditions"
```

What the repairs do (src/repairs.ts):

| Migration | Offending rows | Repair |
|---|---|---|
| 0020 | `invoice_scans.restaurant_id IS NULL` | `walk-ins/…` rows (anonymous showcase) are deleted; a NULL row whose invoice exists gets that invoice's restaurant. **Anything else → `BLOCK`**: decide per row with `PR1-storage-isolation-APPLY.md` §2b (attribute or delete), then re-run. |
| 0021 | product whose supplier is another restaurant's | detach (`supplier_id = NULL`; the column is nullable by design). Run the backfill above first — it re-points from provenance instead. |
| 0027 | a PO with two goods receipts (double-tap) | keep the receipt with the most lines (then the earliest), re-point its match runs, delete the empty duplicate. Lines are not merged (that would recreate the double count 0027 prevents). |
| 0032 | rows violating a new CHECK | nothing to do now — 0032 adds them `NOT VALID` and cannot fail. The doctor lists them; see §9. |

## 4. (Recommended, 5 min) Dress rehearsal on the dump

```bash
createdb -h localhost -U postgres restomatch_rehearsal
pg_restore --no-owner --no-acl -h localhost -U postgres -d restomatch_rehearsal "$DUMP"   # ignore supabase-schema warnings
DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_rehearsal \
  pnpm --filter @restomatch/db rehearse-cutover --skip-seed
```

Ends with `✔ rehearsal complete`. (Without a dump, run it on an empty DB: it seeds a
realistic 0018 fixture with every guarded edge case and proves the same sequence.)

## 5. Apply the migrations (1 min)

```bash
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm db:migrate
```

- Prints `applying pending migrations through 0039_invitation_locale (one transaction)`
  then `done`. A `NOTICE: 0032: … left NOT VALID` line is fine (§9).
- **If it fails:** nothing was applied (single transaction). Run `pnpm db:doctor`, fix
  what it names, retry. No rollback needed.
- Locks: every statement is a metadata change or an index build on small tables —
  milliseconds each. Run outside service hours anyway.
- **Compatibility of the live (June-26) web with the new schema:** all changes are
  additive, except that the old anonymous showcase can no longer insert a NULL-tenant
  `invoice_scans` row (0020) — the new code no longer does that. Deploy the new code
  soon after (step 8).

Re-running `db:migrate` is a no-op (verified by the upgrade-path test).

## 6. Provision RLS + the non-bypass role (1 min)

```bash
PROVISION_STORAGE_RLS=1 APP_ROLE_PASSWORD="$APP_ROLE_PASSWORD" DATABASE_URL="$DATABASE_URL_DIRECT" \
  pnpm --filter @restomatch/db provision-rls --print-app-url
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db check-rls
```

- The last line prints `DATABASE_URL_APP=postgresql://restomatch_app:<pw>@…` — copy it
  straight into your password manager. (For the web, use the **pooler** host with
  `?pgbouncer=true` if that is what `DATABASE_URL` uses in Vercel today — keep the same
  host/port, only the user and password change.)
- Re-running rotates the password (it is re-applied every run).

## 7. Verify (1 min)

```bash
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db verify-cutover --dump="$DUMP"
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm db:doctor
```

`verify-cutover` → `all checks passed` (it also proves the role's default password no
longer works). `db:doctor` → `0 FAIL`. Acceptable WARNs: NOT VALID constraints (§9),
cross-tenant data lines you have decided to keep.

## 8. Flip the web to the RLS role (3 min)

1. Vercel → Project → Settings → Environment Variables → **Production**:
   `DATABASE_URL_APP` = the URL from §6. Keep `DATABASE_URL` (owner) for Auth.js/admin.
2. Redeploy (Deployments → ⋯ → Redeploy). Boot refuses to start if the role can bypass
   RLS or a tenant table lacks RLS (`instrumentation.ts` guards) — a failed boot means
   §6/§7 did not pass; the previous deployment keeps serving.
3. Smoke: log in (magic link and password), open the dashboard, approvals, receiving,
   upload one invoice, `/privacy` signed-out.
4. Optional: `pnpm --filter @restomatch/db verify-cutover --web-url=https://<prod-domain>`.

## 9. After the cutover

- **NOT VALID constraints** (from 0032): `db:doctor` lists each with its violator count.
  Fix the rows, then e.g. `psql "$DATABASE_URL_DIRECT" -c "ALTER TABLE gr_lines VALIDATE CONSTRAINT gr_lines_qty_received_nonneg;"`.
  Until then new/updated rows are still checked (an UPDATE of a violating row fails —
  repair it first).
- Run `pnpm db:doctor` after every future migration; it is safe at any time.

## 10. Rollback plan (by stage)

| Where it went wrong | State | Undo |
|---|---|---|
| §3 repairs | rows deleted/detached as printed | restore those rows from `$DUMP` (`pg_restore -t <table> --data-only` into a scratch DB, copy back), or PITR. |
| §5 migrate failed | **unchanged (0018)** — atomic | nothing; fix and retry. |
| §5 applied, app misbehaves | schema at 0039 | redeploy the previous Vercel build (schema is backward compatible except the walk-in showcase insert). Schema-level undo per migration is in each file header (0029 restores the global uniques, 0031 `DROP FUNCTION public.set_updated_at() CASCADE`, 0032 `DROP CONSTRAINT`). Last resort: PITR / dump restore (loses writes since §1). |
| §6/§8 RLS role problems | web on `restomatch_app` | **instant:** set `DATABASE_URL_APP` back to the owner URL (or remove it and set `ALLOW_OWNER_DB=1` — not in production) and redeploy. Bucket privacy: `update storage.buckets set public = true where id = 'invoice-scans';` (only if scans must be readable by URL again). |

## 11. Pending production migrations — risk + precondition

| # | What | Risk | Precondition (doctor checks it) |
|---|---|---|---|
| 0019 storage_namespaces | new table (per-tenant bucket prefix) | none — additive | — |
| 0020 invoice_scans NOT NULL | `invoice_scans.restaurant_id` → NOT NULL | **aborts on data** | no NULL-tenant scans (repair §3) |
| 0021 products same-tenant FK | composite FK `(supplier_id, restaurant_id)` | **aborts on data** | no cross-tenant `products.supplier_id`; constraint names must not exist yet |
| 0022 legal_compliance | leads consent columns + `dsr_requests` | none — `IF NOT EXISTS` | — |
| 0023 user_credentials | password/2FA identity tables | aborts only if the tables already exist (created by hand) | tables absent |
| 0024 / 0025 | 2FA ticket + TOTP replay columns | none — `ADD COLUMN IF NOT EXISTS` | — |
| 0026 revoke identity tables | REVOKE from `restomatch_app` | none | — |
| 0027 leak_trust | VAT default 0.18 (+ rows at 0.17 → 0.18), one receipt per PO | **aborts on data** | no PO with two goods receipts (repair §3). Note: restaurants deliberately at 0.17 are moved to 0.18. |
| 0028 english_receiving | `name_en` / `raw_description_en` / `preferred_locale` | none — nullable columns | — |
| 0029 tenant_scoped_uniques | I5: platform refs unique per restaurant | none — the new key is looser | — |
| 0030 fk_indexes | 33 indexes on FKs + hot paths | none — index builds, ms at pilot scale | — |
| 0031 updated_at_triggers | DB maintains `updated_at` on 13 tables | low — triggers only; explicit writes are respected | — |
| 0032 integrity_checks | 21 CHECKs (VAT 0–1, non-negative qty, confidence 0–1, ISO currency, period format…) | none at apply time (`NOT VALID` + guarded VALIDATE) | violators are listed by the doctor and left NOT VALID |
| 0039 invitation_locale (S4) | `invitations.preferred_locale` (language an invitee starts in) | none — nullable column, guarded CHECK | — |

---

## Local development & demo data

```bash
./scripts/dev-setup.sh                 # Postgres(pgvector) + Redis + migrate + RLS + demo seed (Linux, macOS, or --docker)
DEMO_TODAY=2026-10-19 ./scripts/dev-setup.sh   # seed "today's" deliveries for a given date (the evening before a demo)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_dev pnpm db:doctor
```

**Demo logins** (restaurant "כפר הזיתים"): `owner@`, `manager@`, `receiver@`, `bookkeeper@`,
`chef@kfar-hazeitim.test` — password **`RestoMatch-Demo-2026!`** (override with
`DEMO_PASSWORD=…` when seeding). All users are email-verified, so password login works;
magic links still work too. `owner@` is also the platform admin (so `/admin` is demo-able);
`receiver@` (Somchai K.) has `preferred_locale = 'en'`.

**What the demo data shows** (numbers as of a seed on 2026-10-18 — they scale with the date):

| Screen | What you see |
|---|---|
| Overview hero | **₪572 leaked this month = 1.9 % of ₪30,802 food spend** (target 1.5 %); ₪296 caught before payment; ₪276 claimed back from suppliers; 9 of 24 matched invoices with a finding; last month 1.0 % — the leak is creeping up |
| Approvals queue | 5 open items (entrecôte and salmon price creep, beer keg +10.6 %, a short tomato delivery billed in full); older ones resolved via credit notes |
| Leak detective | entrecôte ₪139 → ₪149, salmon ₪89 → ₪96, draft-beer keg ₪520 → ₪575 |
| Invoices | 90 matched (ocr'd photos), 2 **consolidated invoices (חשבוניות ריכוז) parsed and pending** — they cover this week's bakery drops and the latest dairy delivery, which have goods receipts but no per-delivery invoice, so spend is not double-counted and nothing alarms |
| Receiving | **3 POs due today** (10:00 produce, 12:30 butcher, 15:00 dairy) with English line names for `receiver@`; 2 more for the coming days |
| Catalog | 10 supplier price lists (56 items, מק״ט, list price, English names) as committed imports + learned aliases |

The story behind the numbers: 10 fictional Israeli suppliers, 56 products in Hebrew + English,
8 weeks of deliveries on each supplier's real cadence, all received, invoiced and run through
the real matching + approvals + baselines engines. Re-seed the morning of the demo (≈10 s) so
"today" is right, or the evening before with `DEMO_TODAY=<demo date>`:

```bash
DEMO_TODAY=2026-10-19 ./scripts/dev-setup.sh
# or just the data:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_dev DEMO_TODAY=2026-10-19 pnpm --filter @restomatch/db seed
DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_dev DEMO_TODAY=2026-10-19 pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts
```

`seed-demo` prints the exact hero numbers (it calls the same `computeLeakHero` the dashboard uses).

**Worker online for the demo.** The dashboard shows "the processing engine is offline" whenever
no worker heartbeat (Redis key `restomatch:worker:heartbeat`, refreshed every 60 s) exists. Start
the worker next to `next dev` — it needs the dev DB and Redis (both started by `dev-setup.sh`):

```bash
cd apps/worker && DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_dev \
  REDIS_URL=redis://localhost:6379 pnpm start
# → "[worker] started 11 workers" ; the banner disappears on the next page load
```

Locally it uses the mock notifiers (no real WhatsApp; e-mail goes to `MAGIC_LINK_FILE` without
`RESEND_API_KEY`). For a demo on the production deployment the worker runs on the owner's Mac via
`apps/worker/scripts/start-worker.sh` (GO-LIVE §B) with the production env.

**Local Postgres limits.** `dev-setup.sh` raises `max_connections` to 300 (override with
`PG_MAX_CONNECTIONS`): `next dev` hot reloads plus the test suite exhaust the default 100
("sorry, too many clients already"). It restarts Postgres once, only when the value is lower.

**The seed refuses any non-local database** (it TRUNCATEs every restaurant and user):
the host must be localhost/127.0.0.1/::1/`postgres`. For a disposable demo project
only: `SEED_ALLOW_REMOTE_HOST=<exact host>`. The production project is refused even then.
