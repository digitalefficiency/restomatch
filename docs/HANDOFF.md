# RestoMatch — technical handoff

What a client's technical lead needs to know to run, assess and take over RestoMatch.
Written 2026-10-18. Developer setup and commands live in the root [`README.md`](../README.md).
Items marked ⚠️ are decisions or actions still open.

## 1. What the product does

RestoMatch reconciles a restaurant's **supplier invoices** against **purchase orders** and
**goods receipts** (3-way match), and reports the money that leaked — over-charged unit prices,
short or missing deliveries, items that were never ordered, duplicate invoices, VAT and total
errors (12 discrepancy types). Discrepancies go to the right role for approval before payment.
Invoices arrive as photos or PDFs and are read by OCR. The UI is Hebrew-first (RTL) and
fully available in English, including a "Receiver in English" flow that shows a Hebrew delivery's
lines and products in English.

## 2. Stack

| Layer | Technology |
|---|---|
| Web app | Next.js 15 (App Router, React 19), TypeScript strict, Tailwind CSS |
| API | tRPC v11 on Next.js route handlers, zod validation |
| Auth | Auth.js v5: email + password (argon2id), TOTP 2FA (secrets AES-256-GCM encrypted at rest), magic link as a backup, JWT sessions with server-side revocation (`tokenVersion`) |
| Database | PostgreSQL 16 + pgvector (Supabase), Drizzle ORM, hand-written SQL migrations |
| Background jobs | BullMQ on Redis (Upstash), a separate Node 22 worker process |
| OCR | Anthropic Claude Vision (single provider today); Google Document AI is wired but optional |
| Email | Resend |
| Mobile | Expo / React Native prototype (not production — see §9) |
| Monorepo | pnpm 10 workspaces + turbo; 3 apps, 13 packages |

## 3. Hosting and environments

| Component | Provider | Notes |
|---|---|---|
| Web | Vercel | git-connected; Vercel Cron runs the worker watchdog every 5 min |
| Database + file storage | Supabase (Postgres + Storage) | invoice scans in a **private** bucket, served by short-lived signed URLs |
| Redis | Upstash | queues, rate limiting, worker heartbeat |
| Worker | Docker image (`apps/worker/Dockerfile`); Fly.io config included (`apps/worker/fly.toml`) | can also run on any container host (Render, Railway, ECS, a VM). During the pilot it runs on the owner's Mac under launchd |

The worker image is reproducible from the lockfile, runs as a non-root user, exposes `/health` and
`/health/ready`, shuts down cleanly on SIGTERM, and refuses to boot in production without its
secrets. CI builds it on every PR.

**Environments:** production (Vercel + Supabase project). ⚠️ There is no separate staging
environment; Vercel preview builds lack secrets. Recommended: a second Supabase project + Vercel
Preview environment variables.

**GitHub default branch:** done — `main` now holds the real codebase (`main` ==
`claude/client-ready` via a regular merge) and is the Supabase GitHub
integration's production branch, so a merge that touches `supabase/` deploys
schema to production (`docs/SUPABASE-GITHUB-DEPLOY.md`). Still recommended:
branch protection on `main` requiring the CI jobs, and a `staging` branch +
project (`docs/BACKUPS-STAGING.md` §4).

**Worker hosting:** `docs/WORKER-DEPLOY.md` (Fly.io primary, Render fallback).
**Monitoring:** `docs/MONITORING.md` (Sentry, uptime checks, daily health digest).
**Backups / staging:** `docs/BACKUPS-STAGING.md`.

## 4. Data residency and privacy

- ⚠️ **The production Supabase project is in `ap-southeast-2` (Sydney)** and the Fly worker
  config targets `syd` to sit next to it. For an Israeli customer base, the usual choice is an EU
  region (Frankfurt `eu-central-1`): Israel and the EU recognise each other's data-protection
  adequacy, and latency from Israel is far lower. Moving means a new Supabase project in the EU,
  a `pg_dump`/`pg_restore`, copying the storage bucket, and changing connection strings — about
  half a day plus a short maintenance window. Do it **before** onboarding real customers.
- OCR sends invoice images to **Anthropic (USA)**. Google Document AI, if enabled, is configured
  for region `eu`.
- The sub-processor register, records of processing, cross-border transfer assessment, breach
  response plan and DPO notes are drafts in `docs/legal/` and are marked for review by a lawyer
  (Israeli Privacy Protection Law, Amendment 13).
- Retention: a scheduled retention job purges expired data. Data-subject requests: users can
  export their data and delete their account from Settings; admins can erase a lead in `/admin`.

## 5. Security posture

- **Tenant isolation is enforced in the database**, not only in code: the web app connects as a
  non-owner role (`restomatch_app`, `rolbypassrls = false`) and every tenant table has Row-Level
  Security keyed to `app.current_restaurant_id`. The boot sequence refuses to start if the role can
  bypass RLS or a tenant table lacks RLS. CI runs an RLS completeness gate and two attack suites
  (cross-tenant tRPC calls and raw-SQL RLS probes) that must cover every tRPC procedure.
- Identity tables are a separate trust zone (owner connection, never exposed to the app role).
- Passwords: argon2id; account lockout with exponential back-off; uniform error messages (no
  account enumeration); rate limiting on credential surfaces (Redis, with an in-memory fallback).
- 2FA: TOTP with one-time recovery codes; each code works once (replay protection).
- HTTP: nonce-based Content Security Policy (Report-Only until `CSP_ENFORCE=1`), HSTS, frame
  denial, no framework fingerprint header; open-redirect guards on every callback URL; CSRF
  origin checks on tRPC.
- Audit log is append-only at the database level.
- Supply chain: GitHub Actions pinned to commit SHAs, read-only default token, `pnpm audit` gate
  (with dated, itemised exceptions in `docs/SECURITY-AUDIT-EXCEPTIONS.md`), CodeQL, secret
  scanning.
- Worker job payloads are not trusted: each job re-checks that the entity belongs to the
  restaurant in the payload before writing.
- Open items: CSP is still Report-Only; production still has to complete the security-stack
  cutover (migrations, app-role switch) described in `docs/GO-LIVE.md` §E.

## 6. Backup and recovery

- Supabase daily backups; point-in-time recovery on the Pro tier (⚠️ confirm the plan tier).
- Before every migration: `pg_dump -Fc` of the production database and a rehearsal against a
  restored copy (`pnpm --filter @restomatch/db rehearse-cutover`, then `verify-cutover`).
- `pnpm db:doctor` gives a read-only health report (safe against production).
- **Back up `AUTH_ENC_KEY`** separately (password manager / KMS). Without it, every enrolled 2FA
  secret becomes unreadable and those users are locked out.
- Redis holds only queues, rate-limit counters and the heartbeat; losing it loses in-flight jobs,
  not business data.

## 7. Monitoring and operations

- Health endpoints: web `/api/healthz`; worker `/health`, `/health/ready`.
- The worker writes a heartbeat to Redis every 60 s; Vercel Cron emails the owner when it is
  stale for more than 10 minutes; the dashboard shows a banner.
- Errors: Sentry is wired for the web server and the worker (PII-scrubbed); it turns on with
  `SENTRY_DSN` + `pnpm add @sentry/node` (⚠️ not configured in production yet). Failed jobs are
  also logged one line each.
- Daily health digest email (06:45 IL): queue depths, failed jobs, OCR stuck > 30 min, failed
  emails — set `HEALTH_DIGEST_EMAILS`. Uptime-check spec: `docs/MONITORING.md` §2.
- Admin console at `/admin`: restaurants, plans/trials, leads (incl. erasure).

## 8. Costs

Per-restaurant and fixed monthly costs are estimated in [`docs/COSTS.md`](COSTS.md) (it still
names Neon/R2 from an earlier design; the live stack is Supabase + Supabase Storage, which falls in
the same range). The variable cost that matters is OCR (≈ one Claude Vision call per invoice). The
fixed costs are Vercel Pro, the Supabase plan, Upstash, the worker host (Fly `shared-cpu-1x`, 1 GB:
a few dollars a month), and Resend.

## 9. Known limitations

- **Mobile app** (`apps/mobile`): an Expo prototype with owner, approvals and receiving screens. It
  typechecks and bundles, but it has **no sign-in**, so its API calls are rejected. Use the
  responsive web app on phones. Making it real: add a token-based sign-in (the web uses cookie
  sessions), upgrade to Expo 53 / React 19 to match the web, and add i18n/RTL.
- **OCR:** one provider (Claude Vision) fills both reconciler slots; Document AI is optional.
  Without an API key only stub fixtures run (used for demos and tests).
- **Catalog matching** uses a deterministic bigram embedding, not a learned embedding model.
- **WhatsApp and push notifications** are mocks that write to the outbox; email is real.
- **Procurement sync** (MarketMan/Zestt) is implemented but not scheduled; it is waiting for
  partner API access.
- **Billing:** plans and entitlements exist; there is no payment provider yet (trials are
  assigned in `/admin`).
- **Staging:** none (see §3).
- **The e2e browser suite** runs in CI as non-blocking while it soaks.

## 10. Roadmap (suggested order)

1. Production cutover (`docs/GO-LIVE.md`): migrations, RLS app role, private bucket, CSP enforce.
2. Move data to an EU region (§4) and set up a staging environment.
3. Host the worker in the cloud (Docker image is ready; `fly deploy`), turn on Sentry.
4. Real OCR key in production, with a monthly per-restaurant OCR quota (already metered).
5. Payment provider + self-serve plans.
6. Inbound email for invoices (`in.<domain>`), MarketMan/Zestt sync on a schedule.
7. Mobile: sign-in + receiving flow in the app (or an installable PWA).
8. Monthly leak report email and supplier credit-claim workflow.
