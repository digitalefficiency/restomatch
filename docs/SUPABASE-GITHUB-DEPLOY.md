# Supabase via GitHub — deploying the schema to the NEW project

> **תקציר בעברית**
>
> הפרויקט החדש ב-Supabase מקבל את מבנה מסד הנתונים **מתוך git**: התיקייה `supabase/migrations`
> נוצרת אוטומטית מהמיגרציות של Drizzle (`pnpm db:supabase-sync`), ואינטגרציית GitHub של Supabase
> מריצה כל קובץ חדש כשממזגים לענף הייצור שהוגדר בה.
>
> מה עושים, לפי הסדר:
> 1. בדשבורד של Supabase → Integrations → GitHub: לוודא שתיקיית העבודה היא שורש הריפו, ושענף הייצור הוא `main`
>    (`main` מכיל עכשיו את הקוד המלא).
>    לכבות **Automatic branching**, כדי שלא ייווצרו מסדי תצוגה בתשלום.
> 2. מיזוג ל-`main` → Supabase מריץ מיד 36 קבצים על מסד הייצור החדש: הכנה, 34 מיגרציות, והרשאות RLS.
>    הקבצים כוללים נעילה של ה-Data API, כך שהמפתח הציבורי לא נותן גישה לאף טבלה. אין בקבצים נתוני דמו.
> 3. ב-SQL Editor להריץ פעם אחת:
>    `alter role restomatch_app with login password '<APP_ROLE_PASSWORD>';`
> 4. להריץ `pnpm db:doctor` מול הפרויקט החדש. התוצאה הצפויה: 0 FAIL ו-0 WARN.
> 5. לעדכן משתני סביבה ב-Vercel ובוורקר (טבלה ב-§5), ולפרוס מחדש.
> 6. אופציונלי: להעביר נתונים מהפרויקט הישן (§6), או לזרוע את נתוני הדמו לפרזנטציה (§7) — רק על מסד ריק.
>
> נבדק מקומית על "Supabase מדומה": משתמש מיגרציה לא-superuser, סכמת storage בבעלות תפקיד נפרד, והתפקידים anon / authenticated / service_role.
> כל הקבצים רצו נקי. מערכת המיגרציות של Drizzle רואה את המסד כמעודכן. `db:doctor` החזיר 0 FAIL, ו-169 מבחני תקיפת RLS עברו.
> לא היה אפשר לגשת לתיעוד של Supabase מכאן, ולכן הנחות שצריך לאשר בדשבורד מסומנות ⚠️.

---

## 0. Cutover order (do not reorder)

1. **Supabase applies the schema.** Merging `supabase/` into the integration's production branch (`main`) deploys it to the NEW project at once.
2. **Owner sets the `restomatch_app` password** in the SQL editor (§4.2), checks the storage policies (§4.3) and runs `pnpm db:doctor` (§4.4).
3. **Owner sets Vercel Production env** to the new project (§5): the DB URLs, Supabase keys and `APP_ROLE_PASSWORD`, plus `AUTH_ENC_KEY`, `AUTH_SECRET` and the rest of `docs/ENV-PRODUCTION.md`. Also update the worker env.
4. **Redeploy** the Vercel production deployment and smoke-test.

Until step 4 the live site keeps using the old project, so steps 1–3 are invisible to users. Data move (§6) or demo seeding (§7) — never both — goes between steps 2 and 3. Both are explicit manual steps; `supabase/migrations` contains schema only, no data.

## 1. How it works

- **Drizzle stays the source of truth.**
  - The source files are `packages/db/drizzle/*.sql`, the journal in `meta/_journal.json`, and `drizzle/rls/*`.
  - `pnpm db:supabase-sync` (logic in `packages/db/src/supabaseSync.ts`) writes `supabase/`.
  - Never edit `supabase/` by hand.
- **The files in `supabase/migrations/`**, which Supabase records by their 14-digit version prefix in `supabase_migrations.schema_migrations`:

  | File | What it does |
  |---|---|
  | `20260521164026_restomatch_bootstrap.sql` | `create extension if not exists vector / pg_trgm / "uuid-ossp"`, exactly as `scripts/migrate.ts` does (no explicit schema, so they resolve the way they do in today's production), plus `drizzle.__drizzle_migrations`. |
  | `<journal when, UTC>_<drizzle tag>.sql` × 34 | The drizzle SQL verbatim, plus an idempotent row in `drizzle.__drizzle_migrations` with the hash and `created_at` exactly as drizzle-orm computes them. After a git deploy, `pnpm db:migrate` is a no-op and `db:doctor` shows the schema as current. |
  | `<tail+1s>_restomatch_rls_<hash>.sql` | `provision-rls` as a migration: core tenant RLS (rls/0002), the append-only audit log (rls/0003), and the role `restomatch_app` with **NOLOGIN and no password in git**. It applies `ensureRlsAppRole`'s grants and revokes, creates the **private `invoice-scans` bucket**, and adds the per-restaurant `storage.objects` policies (rls/0001). It also **locks the Data API out**: it revokes the default grants Supabase gives `anon`/`authenticated` on public tables and sequences, now and for future tables. Those roles are reachable with the publishable key, and RestoMatch never reads tables through PostgREST — supabase-js is used for Storage only. It is idempotent. |
- **When the RLS file is regenerated:** a new one, with a later version, is emitted whenever its content changes or a newer migration lands. Older RLS files stay in the repo, because Supabase has recorded their versions.
- **Forgetting to regenerate fails CI.** `packages/db/src/__tests__/supabase-deploy.test.ts` fails when `supabase/` is stale, and `pnpm db:supabase-sync --check` checks the same thing locally.
- **That test also proves the deploy** on an emulated Supabase:
  - setup: a non-superuser migration role, `storage` owned by `supabase_storage_admin`, the `anon`/`authenticated`/`service_role` roles, and `uuid-ossp` pre-installed in `extensions`;
  - every file applies in order, with one transaction per file;
  - drizzle then sees no gap, and `db:migrate` is a no-op;
  - the doctor reports 0 FAIL, and its only WARN is the role having no LOGIN yet;
  - re-applying the RLS file is a no-op;
  - without rights on `storage.objects`, the RLS file still applies with a WARNING instead of failing the deploy.

  The same files were also applied with `psql -1 -v ON_ERROR_STOP=1`. After that, `check-rls` and the RLS, cross-tenant and storage attack suites passed (169/169).

**Adding a migration later:**
1. Write the drizzle SQL and its journal entry, with a `when` later than everything already in `supabase/migrations`.
2. Run `pnpm db:supabase-sync`.
3. Commit both.

The generator refuses a migration that would be older than an already-deployed version, because Supabase would skip it, just like drizzle does with a journal gap.

## 2. Assumptions to confirm in the Supabase dashboard ⚠️

1. **Integration settings** (Project → Integrations → GitHub):
   - **Working directory / Supabase directory** = the repo root (`.`), which is where `supabase/` lives.
   - **Production branch** = see §3.
   - **Deploy to production** = on.
   - **Automatic branching** = **off** for now. Otherwise every push to a branch that touches `supabase/` can create a paid preview branch.
2. **Postgres 17** (`config.toml` sets `major_version = 17`). Check Project Settings → Infrastructure.
3. **Who runs the migrations:** the integration runs each file as `postgres`, which on Supabase is not a superuser but has CREATEROLE and owns `public`. That is what the emulation used.
4. **Extensions:** `vector` and `pg_trgm` are installable with plain `create extension`. `uuid-ossp` is usually pre-installed in `extensions`, so that statement is a no-op.
5. **Storage policies:** `postgres` can insert into `storage.buckets` and create policies on `storage.objects`. If not, the RLS migration logs `storage.objects policies NOT applied` and continues; then run `packages/db/drizzle/rls/0001_invoice_scans_rls.sql` in the SQL editor (§4).
6. **Data API defaults:** new tables in `public` are granted to `anon`/`authenticated` by default privileges (the RLS migration revokes them, and `db:doctor` FAILs if they come back). If you ever need the Data API, expose a dedicated schema instead.
7. **Pooler user format:** pooled connections use `<role>.<project-ref>` as the user name, e.g. `restomatch_app.abcd1234`. Copy the exact string from Project Settings → Database → Connection string.

## 3. Production branch

`main` on GitHub now holds the full codebase (`main` == `claude/client-ready`, a regular merge), so the integration's production branch is **`main`**. **Merging into `main` deploys new migrations to the production database immediately.** Treat every merge that touches `supabase/` as a production schema change: run the doctor locally first, and take a backup once the project holds real data.

Fallback without the integration, from a laptop with the Supabase CLI:

```bash
supabase link --project-ref <NEW_REF>
supabase db push --dry-run
supabase db push
```

This pushes the same `supabase/migrations`.

## 4. First deploy — checks and the one manual step

1. Merge to the production branch. In the dashboard (Database → Migrations, or the integration's deploy log), expect **36 migrations** applied without error. Or run in the SQL editor:
   ```sql
   select count(*) from supabase_migrations.schema_migrations;   -- 36
   select count(*) from drizzle.__drizzle_migrations;            -- 34
   ```
2. **Give the tenant role its password.** Generate it locally (`openssl rand -hex 32`), store it in your password manager, then run in the SQL editor:
   ```sql
   alter role restomatch_app with login password '<APP_ROLE_PASSWORD>';
   ```
3. Check that the storage policies landed:
   ```sql
   select count(*) from pg_policies where schemaname = 'storage' and policyname like 'invoice_scans%';  -- 6
   select public from storage.buckets where id = 'invoice-scans';                                       -- false
   ```
   If the first query returns 0, paste `packages/db/drizzle/rls/0001_invoice_scans_rls.sql` into the SQL editor and run it.
4. Run the doctor from the repo. It is read-only.
   ```bash
   DATABASE_URL='postgresql://postgres:<pw>@db.<NEW_REF>.supabase.co:5432/postgres' pnpm db:doctor
   ```
   It should report **0 FAIL · 0 WARN**. Before step 2, the single expected WARN is the app role having no LOGIN yet.

## 5. Environment for the new project

**Vercel → Production** (and Preview, if previews should work):

| Variable | Value |
|---|---|
| `DATABASE_URL` | owner, **transaction pooler** `…pooler.supabase.com:6543/postgres` (the code already uses `prepare: false`) |
| `DATABASE_URL_DIRECT` | owner, direct `db.<ref>.supabase.co:5432` (or the session pooler on :5432 for IPv4); used for migrations and scripts |
| `DATABASE_URL_APP` | `restomatch_app.<ref>` + `APP_ROLE_PASSWORD` on the transaction pooler :6543 — the RLS-enforced tenant connection. Boot refuses a role that bypasses RLS. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API keys → publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret (service-role) key — server only |
| `APP_ROLE_PASSWORD` | the password from §4.2 |

Also set everything else from `docs/ENV-PRODUCTION.md` — keep the current values where they exist:
- `AUTH_SECRET` (changing it logs everyone out), `AUTH_URL`, `APP_URL`, `AUTH_ENC_KEY`;
- `RESEND_API_KEY`, `EMAIL_FROM`;
- `REDIS_URL`, `CRON_SECRET`, `TRUSTED_PROXY_HOPS=1`;
- `ANTHROPIC_API_KEY`, `WORKER_ALERT_EMAILS`, `SENTRY_DSN`.

After setting them, redeploy.

**Worker** (`~/.restomatch/worker.env` on the owner's Mac, used by `apps/worker/scripts/start-worker.sh`):
- `DATABASE_URL`: direct or session-pooler owner URL;
- `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
- `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.

After editing it, restart the worker.

## 6. (Optional) Move data from the old project (`cringgshiafwsszyqufo`, schema 0018)

The old data must pass the same guards as the migrations (NULL-tenant scans, cross-tenant products, duplicate receipts). So you upgrade a copy locally first, then move only the data:

```bash
# 1. Dump old prod and restore it into a local scratch DB
pg_dump -Fc --no-owner "$OLD_DIRECT" -f old.dump
createdb -h localhost -U postgres rm_move
pg_restore --no-owner --no-acl -h localhost -U postgres -d rm_move old.dump    # ignore supabase-schema warnings

# 2. Repair and upgrade the local copy to the latest schema
export L=postgres://postgres:postgres@localhost:5432/rm_move
DATABASE_URL=$L pnpm --filter @restomatch/db repair-preconditions --apply
DATABASE_URL=$L pnpm db:migrate
DATABASE_URL=$L pnpm db:doctor

# 3. Dump only public data (no schema, no drizzle/supabase trackers)
pg_dump --data-only --schema=public --no-owner "$L" -f data.sql

# 4. Load into the NEW project BEFORE any traffic (FKs/triggers off for the load)
psql "$NEW_DIRECT" -v ON_ERROR_STOP=1 -1 -c "set session_replication_role = replica" -f data.sql
DATABASE_URL="$NEW_DIRECT" pnpm db:doctor
```

- ⚠️ This assumes `postgres` on Supabase may set `session_replication_role`.
- Invoice **files** live in Storage, not in the dump. Copy the `invoice-scans` objects too (Supabase dashboard or a storage-API script), or old scans will show as missing.
- Users keep their passwords and 2FA: `user_credentials` is part of the data. Sessions survive only if `AUTH_SECRET` stays the same.

## 7. (Optional) Demo tenant for the presentation

Only on an **empty** new project — the seed truncates every restaurant and user:

```bash
SEED_ALLOW_REMOTE_HOST=db.<NEW_REF>.supabase.co DATABASE_URL="$NEW_DIRECT" DEMO_TODAY=<demo date> \
  pnpm --filter @restomatch/db seed
SEED_ALLOW_REMOTE_HOST=db.<NEW_REF>.supabase.co DATABASE_URL="$NEW_DIRECT" DEMO_TODAY=<demo date> \
  pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts
```

- Logins and expected numbers: `docs/DB-RUNBOOK.md` → "Local development & demo data".
- The guard refuses the old production project even with the opt-in.
- Do **not** combine this with §6.

## 8. Rollback

- **Before Vercel points at the new project, nothing has changed for users.** The old project keeps serving.
- **To switch back:** restore the old `DATABASE_URL*` / `SUPABASE_*` values in Vercel, then redeploy.
- **If a migration fails on the new project:** the failing file is rolled back, and the integration stops at that version. Fix it forward in drizzle, regenerate, and merge again.
- **Never edit or delete a migration that has already been deployed.** Its version is recorded.
- **While the new project holds no real data,** recreating it is the cleanest reset.
- **After a data move** (§6), take a backup or PITR snapshot before any further schema change. `docs/DB-RUNBOOK.md` §10 lists per-migration undo SQL.
