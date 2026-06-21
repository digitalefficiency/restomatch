# Deploy Runbook — `feat/supplier-catalog-cadence` (prod 0008 → 0018)

> Branch-specific release runbook. For standing infra (Supabase/Vercel/Fly/Upstash
> coordinates, env list) see [`DEPLOY.md`](./DEPLOY.md).

## Why this exists

Production is **~10 migrations behind this branch.** Verified against the live DB
(read-only):

- `drizzle.__drizzle_migrations` tracks only **9 rows → through migration `0008`**.
- Columns from later migrations are **absent**: `suppliers.order_schedule` (0014),
  `notifications_outbox.dedupe_key` (0016), `products.supplier_id` (0017).

So the entire branch — supplier catalog, order cadence, Zestt PO ingest, the
**magic-link email fix**, and **team invitations** — is undeployed. The login bug
the owner hit is the *old* deployed code (production magic-link send throws when
`EMAIL_FROM` is set). This runbook brings prod fully current and turns login on.

**Do the steps in order.** Migrations create the tables; RLS then locks them; env +
code deploy turn the features on.

---

## 0. Pre-flight (local / CI)

```bash
git checkout feat/supplier-catalog-cadence && pnpm install
pnpm -r typecheck          # ✅ currently green
pnpm -r test               # needs a Postgres test DB (DATABASE_URL_TEST) — run in CI;
                           # includes the RLS attack suite (now covers `invitations`)
pnpm --filter @restomatch/web build   # build sanity
```

## 1. Back up prod FIRST (non-negotiable)

Snapshot the Supabase DB before any DDL on the live pilot:
Supabase Dashboard → Database → Backups (or `pg_dump "$DATABASE_URL" > backup.sql`).

## 2. Apply migrations 0009 → 0018 (drizzle — keeps tracking in sync)

```bash
DATABASE_URL='<PROD_DIRECT_CONNECTION_URL>' pnpm --filter @restomatch/db migrate
```

- Runs `drizzle/postgres-js/migrator` over `./drizzle`, applying every journal entry
  not yet in `drizzle.__drizzle_migrations` — i.e. **0009 through 0018, in order** —
  and records each. Extensions (`vector`, `pg_trgm`, `uuid-ossp`) are ensured first.
- Prefer the **direct** (non-pooled, port 5432) connection string for DDL.
- ⚠️ Do **not** apply via the Supabase MCP / SQL editor — that records in Supabase's
  own migration table and leaves drizzle's tracker at 0008, so a later `pnpm migrate`
  would re-run 0009+ and fail. The drizzle migrator is the single source of truth here.
- Expected tail: `[migrate] done`. Verify:
  `select count(*) from drizzle.__drizzle_migrations;` → **19**.

## 3. Re-apply RLS (NOT auto-run by `migrate`)

Apply in order, against prod, as the **table owner** (the migrate/`postgres` role —
NOT `restomatch_app`):

```bash
psql "$DATABASE_URL" -f packages/db/drizzle/rls/0001_invoice_scans_rls.sql
psql "$DATABASE_URL" -f packages/db/drizzle/rls/0002_core_tenant_rls.sql
```

- Must run **after** step 2 (the tables must exist).
- `0002` is idempotent (`drop policy if exists` + recreate) and now lists **`invitations`
  plus every 0009–0017 tenant table** in its allowlist. Its **completeness invariant
  will `raise exception`** if any `restaurant_id` table lacks RLS — that loud failure is
  the safety net proving full coverage. If it throws, a table is missing RLS — fix the
  allowlist, don't bypass.
- Background: `packages/db/drizzle/rls/README.md`.

## 4. Vercel env — turn login email on

```bash
vercel env add RESEND_API_KEY production   # the Resend API key
vercel env add EMAIL_FROM    production     # e.g.  RestoMatch <auth@restomatch.co.il>
```

- The `EMAIL_FROM` domain **must be verified in Resend** (SPF/DKIM) or mail 403s / lands
  in spam.
- Code gates real send on `NODE_ENV==='production' && RESEND_API_KEY` (`apps/web/lib/email.ts`).
  Without the key, prod falls back to printing the link to logs (safe, but no email).
- Optional: set both for **Preview** too, or leave Preview on the stdout fallback.

## 5. Deploy the code

- Merge / deploy the branch → Vercel builds & deploys the web app.
- Redeploy the **Fly.io worker** too — the branch changes the outbox/cadence jobs.
- Standing steps: `DEPLOY.md` §Web (Vercel) and §Worker (Fly.io).

## 6. Verify

- **Login:** `/login` → your email → real email arrives → click → dashboard.
  (`romkoren252@gmail.com` already has an `owner` membership on "מסעדת הדגמה (רום)".)
- **Team:** `/dashboard/team` → invite a `receiver` → invite email → click → sign in →
  auto-joins as receiver → nav shows only **סקירה + קליטת סחורה**.
- **RLS:** the CI RLS attack suite covers tenant isolation incl. `invitations`.
- **Smoke test:** `DEPLOY.md` §Smoke Test.

## Rollback

- Migrations 0009–0018 are **additive** (new enums/tables/columns); `products.supplier_id`
  (0017) is nullable + FK `RESTRICT`, so no backfill lock. Safest rollback = restore the
  step-1 snapshot.
- Code: redeploy the previous Vercel build / Fly release.

---

## Immediate login unblock (stopgap, before the full deploy)

The **currently deployed (old)** code throws on a prod magic-link when `EMAIL_FROM` is
set, so no link is logged. To get the owner in **today**:

1. Vercel → **temporarily remove** `EMAIL_FROM` from Production (old code then *logs* the
   link instead of throwing).
2. Trigger login on the site; open Vercel → **Runtime Logs**, find the
   `──────── MAGIC LINK ────────` banner and copy the `url: …/api/auth/callback/nodemailer?…`.
3. Paste it into the browser (single-use, 24 h). **Restore `EMAIL_FROM` afterwards.**

(After the full deploy + step 4, this stopgap is obsolete — login just works.)
