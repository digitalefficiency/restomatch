# Backups, point-in-time recovery, and a staging environment

Companion to `docs/DB-RUNBOOK.md` (production migrations) and
`docs/SUPABASE-GITHUB-DEPLOY.md` (schema deploys through the Supabase GitHub
integration). 👤 = owner action in a dashboard; nothing here runs by itself.

## 1. What has to survive

| Data | Lives in | Loss impact | Protection |
|---|---|---|---|
| Tenants, invoices, POs, receipts, discrepancies, users | Supabase Postgres | the product | daily backup + PITR (Pro) + manual `pg_dump` before risky changes |
| Invoice scans (photos/PDFs) | Supabase Storage bucket `invoice-scans` (private) | evidence for supplier credits | storage is **not** in database backups — see §3 |
| `AUTH_ENC_KEY` | Vercel env + password manager | every enrolled 2FA secret becomes unreadable | keep a copy offline; never rotate without a re-encrypt plan |
| `APP_ROLE_PASSWORD`, `AUTH_SECRET`, API keys | Vercel / Fly secrets + password manager | re-issue (users re-login) | password manager |
| Queues, rate-limit counters, heartbeat | Upstash Redis | in-flight jobs only (BullMQ re-runs stalled jobs; schedules re-register at worker boot) | none needed |

## 2. Database backups and PITR

1. 👤 Supabase → **Project Settings → Billing**: be on **Pro** (daily backups kept
   7 days). Add-on **Point-in-Time Recovery** (7-day window is enough for the pilot):
   Database → Backups → *Point in time* → enable. Restores to any second.
2. 👤 Supabase → **Database → Backups**: confirm a daily backup appears.
3. Before every migration / data repair (the DB-RUNBOOK does this):
   ```bash
   pg_dump --version                      # >= the server major (17)
   pg_dump -Fc --no-owner "$DATABASE_URL_DIRECT" -f "prod-$(date +%F-%H%M).dump"
   ```
   Store the dump encrypted (password-manager attachment or a private bucket);
   it contains PII.
4. **Monthly restore drill** (30 min) — a backup you never restored is a hope:
   ```bash
   createdb restore_drill
   pg_restore --no-owner -d restore_drill prod-YYYY-MM-DD-HHMM.dump
   DATABASE_URL=postgres://…/restore_drill pnpm db:doctor          # 0 FAIL expected
   DATABASE_URL=postgres://…/restore_drill pnpm --filter @restomatch/db rehearse-cutover
   dropdb restore_drill
   ```
   Write the date + result in the ops log.

**Restore options, fastest first:** PITR to "just before the incident" (dashboard,
replaces the whole project's DB) → restore the daily backup (dashboard) → restore a
`pg_dump` into a new project and repoint `DATABASE_URL*` (Vercel + worker).

## 3. Storage (invoice scans)

Supabase backups cover Postgres only. Weekly, copy the bucket:

```bash
# Supabase CLI (logged in + linked to the project; storage commands are
# marked experimental): download the whole bucket to an encrypted volume.
supabase storage cp -r ss:///invoice-scans ./invoice-scans-$(date +%F) --experimental
```

(or an S3-compatible sync with the project's S3 keys, Storage → Settings → S3
connection). Keep 4 weekly copies.

## 4. Staging environment

Goal: a full copy of production you can deploy to first — same code path, fake
data, separate keys. **Supabase branching stays OFF** (each preview branch is a
paid database); staging is a **separate Supabase project** fed by the same GitHub
integration from a long-lived **`staging`** git branch.

| Piece | Production | Staging |
|---|---|---|
| Git branch | `main` | `staging` |
| Supabase project | `restomatch` (prod) | `restomatch-staging` (same region as prod) |
| Supabase GitHub integration | production branch = `main` | production branch = `staging` (its own integration on the staging project) |
| Vercel | Production env (`main`) | Preview env scoped to branch `staging` (stable URL `…-git-staging-….vercel.app`) |
| Worker | Fly app `restomatch-worker` | Fly app `restomatch-worker-staging` (`fly launch --name …-staging`, same `fly.toml`) |
| Redis | Upstash prod DB | a second Upstash DB (never share queues between envs) |
| Email | Resend live key | Resend key restricted to the team's addresses, or no key (magic links logged) |
| OCR | Anthropic key | same key with a low spend limit, or none (stub OCR) |
| Data | real | `pnpm db:seed` + `seed-demo` (the demo tenant) |

### Set-up (👤, ≈45 min, once)

1. `git push origin main:staging` (create the branch from current `main`).
2. Supabase → **New project** `restomatch-staging` (same region as prod, Pro not
   required). Database → Extensions: `vector`, `pg_trgm`, `uuid-ossp`.
3. Supabase staging project → Settings → **Integrations → GitHub** → connect this
   repository, **production branch = `staging`**, *Automatic branching* **off**,
   *Deploy to production* on. Merge/push to `staging` → migrations apply.
4. Provision RLS on staging (owner URL of the staging project):
   `APP_ROLE_PASSWORD=… DATABASE_URL=<staging direct> pnpm --filter @restomatch/db provision-rls`
   then `check-rls` and `db:doctor`.
5. Seed the demo tenant (staging only). The seed refuses any non-local database
   unless you name its host explicitly:
   `SEED_ALLOW_REMOTE_HOST=<staging db host> DATABASE_URL=<staging direct> pnpm db:seed`
   then `pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts` with the same env.
6. Vercel → Project → Settings → **Environment Variables** → add every variable from
   `docs/ENV-PRODUCTION.md` to **Preview** with the *staging* values, scoped to
   the Git branch `staging`. (This also fixes the "every PR preview build fails"
   problem for that branch.)
7. Worker: `fly launch --no-deploy --copy-config --config apps/worker/fly.toml --name restomatch-worker-staging`,
   `fly secrets set -a restomatch-worker-staging …` (staging values), then
   `fly deploy -a restomatch-worker-staging --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .`.

### Promotion flow

`feature → PR into staging` (CI green) → merge → Vercel staging + Supabase staging
migrations deploy → click through the demo path (or run `scripts/verify-prod.sh
<staging-url>` once it lands) → `PR staging → main` → merge = production.

Rules: a migration reaches `main` only after it ran on staging; never point
staging at production keys or the production Redis.
