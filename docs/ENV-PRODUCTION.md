# Production Env Reference — RestoMatch

> Variable **names + where to get them** (NO secrets). Set these in Vercel (web)
> and via `fly secrets set` (worker). The `apps/web/lib/env.ts` + `apps/worker/src/env.ts`
> fail-fast guards throw a loud boot error if a required one is missing in prod.
>
> The prod Supabase schema is at migration 0018 (RLS provisioned). Migrations 0019–0026 + the
> `restomatch_app` repoint are the Wave-0 cutover — see `docs/GO-LIVE.md`.

## Web (Vercel → Settings → Environment Variables)

| Variable | Source | Required (prod) | Notes |
|---|---|:---:|---|
| `DATABASE_URL` | Supabase → Database → Connection pooling | ✅ | pooled (6543), **owner** role |
| `DATABASE_URL_APP` | same pooler, **`restomatch_app`** role | ✅ | RLS is INERT without it — boot guard asserts `rolbypassrls=false` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | ✅ | signed scan URLs (`/scans/[id]`) |
| `RESEND_API_KEY` | resend.com | ✅ | magic-link login + invites + alerts |
| `EMAIL_FROM` | your verified Resend domain | ✅ | e.g. `RestoMatch <noreply@yourdomain>` |
| `AUTH_URL` | your prod web URL | ✅ | NextAuth callback base |
| `AUTH_SECRET` | `openssl rand -base64 32` | ✅ | JWT signing |
| `APP_URL` | your prod web URL | ✅ | deep links in emails |
| `REDIS_URL` | Upstash | ✅ | OCR/match/cron queue (uploads vanish without it) |
| `AUTH_ENC_KEY` | `openssl rand -hex 32` | ✅ | encrypts TOTP secrets at rest (2FA). **Boot fails without it.** Back it up — losing it locks out every 2FA user |
| `TRUSTED_PROXY_HOPS` | `1` on Vercel | ✅ | rate limiters read the client IP from the right of x-forwarded-for (D1.6); unset = spoofable left-most entry |
| `CRON_SECRET` | `openssl rand -hex 32` | ✅ | Vercel Cron → `/api/cron/worker-heartbeat` bearer token |
| `WORKER_ALERT_EMAILS` | owner mailbox(es), comma-separated | — | recipients of the "worker is down" alert (falls back to `PLATFORM_ADMIN_EMAILS`) |
| `SENTRY_DSN` | sentry.io | — | optional; needs `pnpm add @sentry/nextjs` |

## Worker (`fly secrets set -a restomatch-worker ...`)

| Variable | Source | Required (prod) | Notes |
|---|---|:---:|---|
| `DATABASE_URL` | Supabase pooled, owner | ✅ | worker runs cross-tenant on the owner connection by design |
| `REDIS_URL` | Upstash | ✅ | BullMQ — no jobs run without it |
| `ANTHROPIC_API_KEY` | console.anthropic.com | ✅ | invoice OCR / Zestt PO parsing |
| `RESEND_API_KEY` | resend.com | ✅ | outbox email dispatch |
| `EMAIL_FROM` | verified Resend domain | ✅ | sender (factory falls back to this when `RESEND_FROM` unset) |
| `APP_URL` | prod web URL | ✅ | deep links in cadence/approval emails |
| `GOOGLE_DOCUMENT_AI_PROJECT_ID` | GCP Document AI | — | optional OCR numeric tie-break |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | GCP | — | optional |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP service-account JSON path | — | optional |
| `APP_BASE_URL` | prod web URL | — | deep links in emails when set (else `AUTH_URL`) |
| `SENTRY_DSN` | sentry.io | — | optional (`pnpm add @sentry/node`) |



## DATABASE_URL_APP — getting the restomatch_app password

The `restomatch_app` role exists in prod (`rolbypassrls=false`). If you don't know
its password, reset it in Supabase SQL and build the connection string from it:

```sql
ALTER ROLE restomatch_app WITH PASSWORD '<strong-password>';
```
```
DATABASE_URL_APP=postgresql://restomatch_app:<password>@<pooler-host>:6543/postgres
```

## Deploy order (see docs/DEPLOY_CUTOVER.md for the full runbook)
1. Set web env in Vercel + verify `DATABASE_URL_APP` points at `restomatch_app`.
2. `fly secrets set` the worker vars, then deploy the worker (fly.toml/Dockerfile ready).
3. Merge the PR → Vercel deploys web. The env guard fails-fast if anything is missing.
4. Smoke test: `/api/healthz`, login, upload→OCR→match→leak.

## Provisioning-only (never on Vercel)

| Variable | Used by | Notes |
|---|---|---|
| `APP_ROLE_PASSWORD` | `pnpm --filter @restomatch/db provision-rls` (`ensureRlsAppRole`) | password for the `restomatch_app` login role — **required** against any non-local DB (plan v2 S1); local/test DBs fall back to a throwaway. Build `DATABASE_URL_APP` from it. |
| `DATABASE_URL_DIRECT` | migrations / provisioning / `pg_dump` | owner role, port 5432 (never the pooler, never the app role) |
| `PROVISION_STORAGE_RLS=1` | `provision-rls` | opt-in: also applies `rls/0001` (bucket private + storage.objects policies) — Supabase only |
