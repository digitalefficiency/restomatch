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
| `DATABASE_URL_APP` | same pooler, **`restomatch_app`** role | ✅ | **Production scope only** (not Preview/Development). RLS is INERT without it — boot guard asserts `rolbypassrls=false` |
| `APP_ROLE_PASSWORD` | the `restomatch_app` password (password manager) | ✅ | **on Vercel by design now**: when `DATABASE_URL_APP` is missing or unusable, boot derives the `restomatch_app` URL from `DATABASE_URL`'s host and this password (`deriveAppRoleUrl`); `assertAppRoleNoBypass` still proves the role. Name only here — never paste the value into a doc, chat or ticket |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | ✅ | signed scan URLs (`/scans/[id]`) |
| `RESEND_API_KEY` | resend.com | ✅ | magic-link login + invites + alerts |
| `EMAIL_FROM` | your verified Resend domain | ✅ | e.g. `RestoMatch <noreply@yourdomain>` |
| `AUTH_URL` | your prod web URL | ✅ | NextAuth callback base. Its origin **overrides the request host** for sign-in callbacks — open the app/demo **only on this hostname** (a preview/alias URL loops back to `/login`). Boot WARNs when `APP_URL`'s origin differs |
| `AUTH_SECRET` | `openssl rand -base64 32` | ✅ | JWT signing (legacy name `NEXTAUTH_SECRET` also accepted). **Boot fails without it** — otherwise every login would 500 |
| `APP_URL` | your prod web URL | ✅ | deep links in emails. Must have the **same origin as `AUTH_URL`** (boot WARN otherwise) |
| `QUEUE_DATABASE_URL` | Supabase, owner | — | optional separate connection for the job queue (`job_queue`); defaults to `DATABASE_URL` |
| `AUTH_ENC_KEY` | `openssl rand -hex 32` | ✅ | encrypts TOTP secrets at rest (2FA). **Boot fails without it.** Back it up — losing it locks out every 2FA user |
| `TRUSTED_PROXY_HOPS` | `1` on Vercel | ✅ | rate limiters read the client IP from the right of x-forwarded-for (D1.6); unset = spoofable left-most entry |
| `CRON_SECRET` | `openssl rand -hex 32` | ✅ | Vercel Cron → `/api/cron/worker-heartbeat` and `/api/cron/jobs` (the job runner) bearer token |
| `JOB_KICK` | `off` | — | turns off the after() kick that runs OCR / match / catalog jobs right after an upload; `/api/cron/jobs` still runs them within a minute. Unset = on |
| `SERVERLESS_CRON_SKIP` | task ids or queue names, comma-separated, or `all` | — | pauses scheduled tasks of `/api/cron/jobs` (ids as in `apps/worker/src/cron.ts`, e.g. `recovery-reminders-0830,price-alerts-07`, or queue names such as `outbox-dispatch`). A skipped daily slot is recorded as skipped and is not replayed when the variable is removed. Queued jobs, uploads (the kick) and the heartbeat are not affected. Unset = nothing skipped. Needs a redeploy, like any env change |
| `WORKER_ALERT_EMAILS` | owner mailbox(es), comma-separated | ✅ pilot | recipients of the "job runner is down" alert (falls back to `PLATFORM_ADMIN_EMAILS`). **Unset today → nobody is paged** |
| `HEALTH_DIGEST_EMAILS` | owner mailbox(es), comma-separated | ✅ pilot | recipients of the 06:45 daily health digest. Unset → the digest logs "skipped: no recipients" |
| `PLATFORM_ADMIN_EMAILS` | owner mailbox(es), comma-separated | ✅ pilot | platform-admin accounts (`/admin`) and the fallback for the alerts above |
| `OCR_CLAUDE_MODEL` | model id | — | **global**: the Claude model every OCR read uses (all tenants) |
| `OCR_CLAUDE_EFFORT` | effort level | — | optional effort setting for the Claude reader (`packages/ocr` claudeVision) |
| `OCR_CLAUDE_TIMEOUT_MS` | milliseconds | — | per-call timeout of the Claude reader (arrives with the OCR pilot PR #174) |
| `OCR_JOB_HEADROOM_MS` | milliseconds | — | time kept free inside a job run for the OCR call (arrives with an OCR pilot PR) |
| `OCR_REAL_RESTAURANT_IDS` | restaurant ids, comma-separated | ✅ pilot | the ONLY restaurants whose invoices go to real (paid) Claude OCR; everyone else gets the stub (arrives with #171) |
| `SHOWCASE_REAL_OCR` | `1` | — | lets the public showcase use real OCR — **must be absent in Production** (list below) |
| `SIGNUP_OPEN` / `SIGNUP_ALLOWLIST` | `1` / e-mail domains or addresses | — | public sign-up gate. `SIGNUP_OPEN` **must be absent in Production**; the allowlist is the pilot's way in |
| `NOTIFY_SHABBAT_WINDOW` | window spec | — | **global**: holds staff alerts during Shabbat (arrives with #173) |
| `SENTRY_DSN` | sentry.io | — | optional; needs `pnpm add @sentry/nextjs` |

## Worker (`fly secrets set -a restomatch-worker ...`)

| Variable | Source | Required (prod) | Notes |
|---|---|:---:|---|
| `DATABASE_URL` | Supabase pooled, owner | ✅ | worker runs cross-tenant on the owner connection by design |
| `QUEUE_DATABASE_URL` | Supabase, owner | — | optional separate connection for the job queue; defaults to `DATABASE_URL` |
| `ANTHROPIC_API_KEY` | console.anthropic.com | ✅ | invoice OCR / Zestt PO parsing |
| `RESEND_API_KEY` | resend.com | ✅ | outbox email dispatch |
| `EMAIL_FROM` | verified Resend domain | ✅ | sender (factory falls back to this when `RESEND_FROM` unset) |
| `APP_URL` | prod web URL | ✅ | deep links in cadence/approval emails |
| `GOOGLE_DOCUMENT_AI_PROJECT_ID` | GCP Document AI | — | optional OCR numeric tie-break |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | GCP | — | optional |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP service-account JSON path | — | optional |
| `APP_BASE_URL` | prod web URL | — | deep links in emails when set (else `AUTH_URL`) |
| `SENTRY_DSN` | sentry.io | — | optional (`pnpm add @sentry/node`) |

**No Redis.** The job queue, cron schedules, rate limits and the worker heartbeat live in
Postgres (migration 0061: `job_queue`, `rate_limit_counters`, `worker_heartbeats`, `ops_kv`),
on the existing `DATABASE_URL`. `REDIS_URL` is no longer used by web or worker: a leftover
value only logs a boot warning. Remove it from the worker env; on Vercel delete it a week
after the cutover (the pre-0061 version still needs it for a rollback — `docs/REDIS-REMOVAL.md`).

**Worker `DATABASE_URL`: use the SESSION pooler (port 5432) or a direct connection.** The
worker LISTENs for new-job NOTIFYs (instant pickup) and otherwise polls with a 1 s → 30 s
idle backoff; on the transaction pooler (6543) LISTEN is skipped and new jobs wait up to
30 s. `WORKER_LISTEN=off` forces polling. The web keeps the transaction pooler (NOTIFY works there).

## To delete from Vercel

- `REDIS_URL`: no longer read (0061, Postgres queue); a leftover only logs a boot warning.
- `SERVERLESS_CRON_SKIP`: the pre-pilot pause switch for scheduled tasks; delete it **after Wed 4.11**, once every task runs.
- `POSTGRES_*`: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_DATABASE`. These are the Supabase integration's copies. The app reads `DATABASE_URL` / `DATABASE_URL_APP`; the job runner only falls back to `POSTGRES_URL` when `DATABASE_URL` is beyond repair.

## Must be ABSENT in Production

Each of these acts on **every tenant, including ציקטי**. Check this list before go-live (8.11) and after every env change. Names only:

| Variable | Why it must not be set in Production |
|---|---|
| `OCR_DEV_STUB` | fake OCR results instead of reading the invoice |
| `NEXT_PUBLIC_ENABLE_SCAN_MOCKS` | mock scans in the UI |
| `DEMO_TODAY` | pins "today" to a demo date (every date, every report) |
| `DEMO_PLATFORM_ADMIN` | demo seed: makes a demo user platform admin |
| `DEMO_PASSWORD` | demo seed password |
| `ALLOW_OWNER_DB` | lets the web fall back to the owner role for tenant queries, which bypasses RLS (the boot guard otherwise refuses) |
| `FEATURES_OFF` | kill-switch that turns features off for everyone |
| `SERVERLESS_CRON_SKIP` | pauses scheduled jobs; may be set only until Wed 4.11 |
| `SHOWCASE_REAL_OCR` | paid OCR on the public showcase |
| `SIGNUP_OPEN` | anyone can create a restaurant |
| `LEAK_CHECK_PUBLIC` | opens the public leak-check upload |
| `LEAK_CHECK_REAL_OCR` | paid OCR on the public leak-check |
| `JOB_KICK` | `off` stops immediate OCR after upload |
| `HEALTH_DIGEST_RESTAURANT_ID` | narrows the daily digest to one restaurant |
| `REDIS_URL` | dead (see above) |
| `POSTGRES_*` | integration copies (see above) |
| `SUPABASE_JWT_SECRET` | not used by the app; a needless high-value secret |

**Global settings.** `OCR_CLAUDE_MODEL`, `FEATURES_OFF` and `NOTIFY_SHABBAT_WINDOW` are **global**: there is no per-restaurant value, so a change hits ציקטי and the demo tenant alike.

## DATABASE_URL_APP — the restomatch_app connection (new Supabase project)

On the NEW project (schema deployed from git, `docs/SUPABASE-GITHUB-DEPLOY.md` §4–5) the
migration creates `restomatch_app` **NOLOGIN and without a password** (no secret in git).
Give it both once, in the Supabase SQL editor — generate the password locally with
`openssl rand -hex 32` and keep it in your password manager as `APP_ROLE_PASSWORD`:

```sql
ALTER ROLE restomatch_app WITH LOGIN PASSWORD '<APP_ROLE_PASSWORD>';
```

Build the URL on the **transaction pooler** (port 6543). The pooler identifies the project from
the user name, so the user is **`restomatch_app.<project-ref>`** — copy host and ref from
Project Settings → Database → Connection string (⚠️ confirm the exact format there):

```
DATABASE_URL_APP=postgresql://restomatch_app.<project-ref>:<APP_ROLE_PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

**Prove it before setting it in Vercel** (one line — must print `restomatch_app | f`):

```bash
psql "$DATABASE_URL_APP" -Atc "select current_user, rolbypassrls from pg_roles where rolname = current_user"
```

`f` = the role cannot bypass RLS (the web boot guard refuses anything else). Then
`DATABASE_URL=<owner direct URL> pnpm db:doctor` must show `PASS  restomatch_app … canlogin=true`.
The app uses `prepare: false` everywhere (`createDb`), as transaction pooling requires.

(Old project `cringgshiafwsszyqufo`: the role already has LOGIN — `ALTER ROLE restomatch_app WITH
PASSWORD '…'` to rotate, or `APP_ROLE_PASSWORD=… pnpm --filter @restomatch/db provision-rls
--print-app-url`; its pooler user is likewise `restomatch_app.<ref>`.)

## Deploy order (see docs/DEPLOY_CUTOVER.md for the full runbook)
1. Set web env in Vercel + verify `DATABASE_URL_APP` points at `restomatch_app`.
2. `fly secrets set` the worker vars, then deploy the worker (fly.toml/Dockerfile ready).
3. Merge the PR → Vercel deploys web. The env guard fails-fast if anything is missing.
4. Smoke test: `/api/healthz`, login, upload→OCR→match→leak.

## Provisioning-only (not needed on Vercel, except `APP_ROLE_PASSWORD`)

| Variable | Used by | Notes |
|---|---|---|
| `APP_ROLE_PASSWORD` | `pnpm --filter @restomatch/db provision-rls` (`ensureRlsAppRole`) | password for the `restomatch_app` login role — **required** against any non-local DB (plan v2 S1); local/test DBs fall back to a throwaway. Build `DATABASE_URL_APP` from it. (Also on Vercel now — see the web table.) |
| `DATABASE_URL_DIRECT` | migrations / provisioning / `pg_dump` | owner role, port 5432 (never the pooler, never the app role) |
| `PROVISION_STORAGE_RLS=1` | `provision-rls` | opt-in: also applies `rls/0001` (bucket private + storage.objects policies) — Supabase only |
