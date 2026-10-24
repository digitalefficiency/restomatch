# Vercel Preview environment — proposal

**Problem.** Every PR's Vercel Preview build failed: the Preview environment has
no `DATABASE_URL`, and `next build` imports the DB modules (`lib/authDb.ts`,
`lib/db.ts`), which threw at import ("DATABASE_URL is required for the auth
connection" while collecting page data for `/api/trpc/[trpc]`).

**What changed in code** (this PR): during `next build` only
(`NEXT_PHASE=phase-production-build`) and only when the URL is missing, those
two modules get a placeholder URL (`postgres://…@build-phase-placeholder.invalid`)
that is never dialled — postgres.js connects lazily, and nothing queries at
build time. A build with **no environment at all** now passes locally.
Runtime is unchanged: `next start` / a Vercel function still runs the boot guard
(`assertWebEnv` in `instrumentation.ts`), which refuses to serve production
without the real secrets (tested: `lib/__tests__/env.test.ts`; a no-env
production start answers 500 on every route).

So after this PR, **with no Vercel change**, previews go green as a *build check*,
but the preview URL itself answers 500 until it has runtime env. 👤 Pick one:

## Option A — build-only previews (no Vercel change)

Nothing to set. The Preview check proves the PR builds. Don't open preview URLs;
use `scripts/verify.sh layer2` locally for a running app. Cheapest; recommended
until staging exists.

## Option B — working previews on the staging project

Vercel → Project → Settings → **Environment Variables** → scope **Preview**
(ideally only the `staging` branch, see `docs/BACKUPS-STAGING.md`). Never reuse
production values.

| Variable | Real or placeholder | Value for Preview |
|---|---|---|
| `DATABASE_URL` | **real** (staging) | staging Supabase owner/session-pooler URL |
| `DATABASE_URL_APP` | **real** (staging) | staging `restomatch_app` role URL (`provision-rls` prints it) |
| `AUTH_SECRET` | real, Preview-only | `openssl rand -base64 32` — a new one, not production's |
| `AUTH_ENC_KEY` | real, Preview-only | `openssl rand -hex 32` — a new one |
| `AUTH_URL` / `APP_URL` | real | the stable staging URL (`…-git-staging-….vercel.app`); per-PR URLs can't sign in (callback host) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **real** (staging) | staging project URL + publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | **real** (staging) | staging secret key (signed scan URLs) |
| `REDIS_URL` | real | a second Upstash DB (`rediss://…`), never the production one |
| `RESEND_API_KEY` | placeholder OK | `re_preview_placeholder` boots; magic links then fail to send — use password login, or a Resend key restricted to the team's addresses |
| `EMAIL_FROM` | placeholder OK | `preview@example.invalid` |
| `CRON_SECRET` | placeholder OK | any random string (Vercel Cron doesn't run on previews) |
| `SENTRY_DSN` | leave unset | |
| `ANTHROPIC_API_KEY` | leave unset | web doesn't need it; the staging worker has its own |

The boot guard requires exactly the "real" rows plus `RESEND_API_KEY`,
`EMAIL_FROM` and an `AUTH_URL`/`APP_URL`; anything missing gives a readable
`[env] missing required production secrets` in the function log.

## Not proposed

- Pointing Preview at the production database (tenant data on every PR URL).
- Weakening the boot guard for `VERCEL_ENV=preview` — a preview that boots
  without `DATABASE_URL_APP` would serve tenant pages on the RLS-bypassing owner
  role, the exact failure the guard exists for.
