# RestoMatch

**Invoice ↔ purchase-order ↔ goods-receipt matching for restaurants — Hebrew-first, English-ready.**

A restaurant photographs a supplier invoice; RestoMatch reads it (OCR), matches every line against
what was ordered and what was actually received, and shows the owner, in shekels, how much money
leaked this month (over-priced lines, short deliveries, unordered items, duplicate invoices…). The
receiver at the back door can check a Hebrew delivery **in English** ("Receiver in English").

| | |
|---|---|
| Users | owner · manager · receiver · bookkeeper · chef (per-restaurant roles, multi-tenant) |
| Languages | Hebrew (default, RTL) and English (LTR) — `?lang=en` on any URL, or the switcher |
| Core output | the monthly **leak figure** (₪, integer-agorot math, asserted by a "leak canary" test) |

> Client-facing technical overview (hosting, data residency, security, costs, limitations):
> **[`docs/HANDOFF.md`](docs/HANDOFF.md)**. Agent/automation contract: `AGENTS.md`. Current build
> state: `STATE.md`. Production go-live checklist: `docs/GO-LIVE.md`.

---

## Architecture

```mermaid
flowchart LR
  subgraph Clients
    B[Browser<br/>Next.js web app]
    M[Expo mobile app<br/>prototype]
  end

  subgraph Vercel
    W[apps/web<br/>Next.js 15 · App Router<br/>Auth.js v5 · tRPC v11]
    C[Vercel Cron<br/>worker watchdog]
  end

  subgraph Supabase
    PG[(Postgres 16<br/>+ pgvector<br/>RLS per restaurant)]
    ST[(Storage<br/>private invoice-scans bucket)]
  end

  R[(Redis<br/>Upstash · BullMQ)]

  subgraph Worker["apps/worker (Docker · Fly.io / any container host)"]
    Q[BullMQ consumers<br/>ocr-invoice · match-invoice · import-catalog<br/>outbox-dispatch · cron jobs]
    H[/health · heartbeat/]
  end

  subgraph External
    AN[Anthropic Claude Vision<br/>OCR]
    RS[Resend<br/>email]
    WA[WhatsApp Cloud<br/>mock today]
  end

  B -->|HTTPS · tRPC| W
  M -.->|tRPC| W
  W -->|restomatch_app role<br/>RLS enforced| PG
  W -->|signed URLs| ST
  W -->|enqueue jobs| R
  R --> Q
  Q -->|owner role<br/>tenant-checked in code| PG
  Q --> AN
  Q --> RS
  Q -.-> WA
  H -->|heartbeat key| R
  C -->|reads heartbeat,<br/>emails owner if stale| W
```

**Request path:** browser → Next.js middleware (auth, locale, CSP nonce) → server components / tRPC
procedures (`packages/api`) → Postgres as the non-owner `restomatch_app` role inside a transaction
that sets `app.current_restaurant_id`, so Row-Level Security scopes every query to one restaurant.

**Async path:** an upload enqueues `ocr-invoice` → the worker runs OCR (Claude Vision, or stub
fixtures without a key), stores invoice lines, links products (pgvector catalog matcher), then
chains `match-invoice` → the 3-way matching engine (`packages/matching`) writes a `match_run` with
discrepancies → the approvals engine routes them to the right role → notifications go to the outbox.

## Monorepo map

pnpm workspaces + turbo. Every package exports its TypeScript sources directly (no build step).

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 web app: marketing site, dashboard, admin, auth (password + TOTP 2FA + magic link), tRPC route, cron route |
| `apps/worker` | BullMQ worker: OCR, matching, catalog import, cadence alerts, outbox dispatch, retention; `/health` server + Redis heartbeat; `Dockerfile` + `fly.toml` |
| `apps/mobile` | Expo (React Native) prototype — see [Mobile](#mobile-app) |
| `packages/api` | tRPC routers, tenant guards, approvals engine, entitlements, notifications |
| `packages/db` | Drizzle schema, hand-written SQL migrations (`drizzle/00NN_*.sql`), RLS policies + provisioning, seed, `db:doctor` |
| `packages/matching` | The 12-discrepancy matching engine + integer-agorot money math + leak canary |
| `packages/charts` | KPI / leak / supplier SQL used by the dashboard |
| `packages/ocr` | OCR pipeline, Claude Vision provider, stub provider, reconciler |
| `packages/catalog` | Product catalog matcher (exact SKU → aliases → pgvector) |
| `packages/procurement` | MarketMan / Zestt purchase-order sync clients |
| `packages/queue` | BullMQ producers shared by web + worker |
| `packages/billing` | Plans, entitlements, provider-agnostic billing rails |
| `packages/crypto` | argon2id password hashing |
| `packages/observability` | Sentry-compatible error hooks (no-op until configured) |
| `packages/types` | Shared zod schemas / types (OCR payloads, cadence, fit score) |
| `packages/ui-tokens` | Design tokens ("command center for money", dark, RTL-aware) |

## Local setup

Requirements: **Node 22** (`.nvmrc`), **pnpm 10.33** (via corepack), and either a local PostgreSQL
(Linux apt / macOS Homebrew) or Docker. Everything else is handled by one script:

```bash
./scripts/dev-setup.sh          # deps · Postgres 16 + pgvector · Redis · migrate + RLS (test + dev DBs)
                                # · seed the demo restaurant · write apps/web/.env.local
pnpm --filter @restomatch/web dev        # → http://localhost:3000
```

Options: `--no-seed`, `--docker` (force docker compose), `DEMO_TODAY=YYYY-MM-DD` (seed "today's"
deliveries for another date). Re-running is safe.

**Demo logins** (restaurant "כפר הזיתים"): `owner@`, `manager@`, `receiver@` (English UI),
`bookkeeper@`, `chef@kfar-hazeitim.test` — password **`RestoMatch-Demo-2026!`**. The owner is a
platform admin (`/admin`). Magic links (no email provider locally) are printed in the dev-server log
and written to `$MAGIC_LINK_FILE`.

**Run the worker too** (otherwise uploads are not processed and the dashboard shows a
"worker is down" banner):

```bash
pnpm dev:worker                          # loads apps/web/.env.local; tsx watch; health on :8080/health
# prove the queues end-to-end (stub OCR → match), self-cleaning:
pnpm --filter @restomatch/worker exec tsx scripts/smoke-queues.ts
```

If the container/laptop restarted: `service postgresql start; redis-server --daemonize yes`
(or `docker compose up -d`).

## Environment variables

Local values are written by `dev-setup.sh` into `apps/web/.env.local`. The full annotated list is
[`.env.example`](.env.example); production values and where to get them are in
[`docs/ENV-PRODUCTION.md`](docs/ENV-PRODUCTION.md). The essentials:

| Variable | Web | Worker | Purpose |
|---|:-:|:-:|---|
| `DATABASE_URL` | ✓ | ✓ | owner connection (worker, migrations, Auth.js identity layer) |
| `DATABASE_URL_APP` | ✓ | | non-owner `restomatch_app` role — RLS enforced (required in prod; boot guard) |
| `REDIS_URL` | ✓ | ✓ | BullMQ queues + rate limiting + worker heartbeat |
| `AUTH_SECRET`, `AUTH_URL`, `APP_URL` | ✓ | | Auth.js |
| `AUTH_ENC_KEY` | ✓ | | encrypts TOTP secrets at rest (back it up) |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✓ | ✓ | email (magic links, invites, alerts) |
| `ANTHROPIC_API_KEY` | | ✓ | real OCR (without it, only stub-fixture jobs run) |
| `NEXT_PUBLIC_SUPABASE_URL`, `…_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ✓ | | invoice scan storage |
| `CRON_SECRET`, `WORKER_ALERT_EMAILS` | ✓ | | worker watchdog cron |

Both apps **fail fast at boot** in production when a required variable is missing
(`apps/web/lib/env.ts`, `apps/worker/src/env.ts`).

## Tests and checks

```bash
export DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test
pnpm test                                   # every package, serially (DB-backed suites, RLS attack suites, leak canary)
pnpm typecheck                              # every package incl. web and mobile
pnpm lint                                   # ESLint (apps/web)
pnpm --filter <pkg> exec vitest run <file>  # one file
pnpm db:doctor                              # read-only schema health report (DATABASE_URL=…)

# Browser suite (Playwright) — creates/seeds its own restomatch_e2e DB and starts `next dev`:
pnpm --filter @restomatch/web test:e2e          # auth (password, 2FA, magic link) + smoke
pnpm --filter @restomatch/web test:e2e:smoke    # every main page in he + en
E2E_SKIP_SEED=1 pnpm --filter @restomatch/web test:e2e:smoke   # reuse the seeded e2e DB

# Production build of the web app
cd apps/web && set -a && . ./.env.local && set +a && pnpm build
```

The smoke suite asserts, for every dashboard and public page in both languages: HTTP < 400, no
bounce to `/login`, correct `<html lang dir>`, no error boundary, no console errors, and no
Hebrew left in the English UI chrome.

**CI** (`.github/workflows/ci.yml`, on every PR): typecheck + tests against Postgres 16 + pgvector
with every migration applied, RLS provisioning + completeness gate + `db:doctor`; worker tests with
Redis; web lint + `next build` (type-checked) + `tsc`; the worker Docker image build; Playwright
(non-blocking during its soak); `pnpm audit` and dependency review. CodeQL and secret scanning run
in their own workflows.

## Deploy

| Component | Where | How |
|---|---|---|
| Web | Vercel (`apps/web`, build `turbo run build --filter @restomatch/web`) | git-connected; env vars per `docs/ENV-PRODUCTION.md`; cron in `apps/web/vercel.json` |
| Database + storage | Supabase | `DATABASE_URL=<direct owner URL> pnpm db:migrate`, then `provision-rls` (`docs/RLS-PROVISIONING-RUNBOOK.md`, `docs/DB-RUNBOOK.md`) |
| Redis | Upstash | `REDIS_URL` (TLS `rediss://`) |
| Worker | any container host (Fly.io config included) | `docker build -f apps/worker/Dockerfile .` from the repo root; `fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .` |

The worker image is multi-stage (≈670 MB), runs as the non-root `node` user with `node` as PID 1
(clean SIGTERM shutdown), and has a `HEALTHCHECK` on `/health`. During the pilot the worker can also
run on the owner's Mac (`apps/worker/scripts/start-worker.sh` + launchd plist). Step-by-step
production rollout: `docs/GO-LIVE.md`.

**Worker hosting options** (same image everywhere; build context = repo root; one instance is
enough for the pilot — BullMQ makes extra instances safe if you scale later):

| Host | Setup |
|---|---|
| Fly.io (config in repo) | `fly launch --no-deploy --copy-config --name restomatch-worker` → `fly secrets set DATABASE_URL=… REDIS_URL=… ANTHROPIC_API_KEY=… RESEND_API_KEY=… EMAIL_FROM=… APP_URL=…` → `fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .`. Set `primary_region` next to the database. |
| Render | New → **Background Worker** → Docker, Dockerfile path `apps/worker/Dockerfile`, context `.`; add the same env vars. (Or a Web Service with health check path `/health` if you want the HTTP probe.) |
| Railway | New service from the repo → Settings → Build: Dockerfile `apps/worker/Dockerfile`, root `/`; Variables: the same env vars; health check `/health`. |
| Any Docker host | `docker run -d --restart=always -p 8080:8080 --env-file worker.env restomatch-worker` |

Behind a TLS-intercepting proxy, build with `--secret id=ca,src=/path/ca.crt` (see the Dockerfile
header).

## Operations

- **Health:** web `GET /api/healthz`; worker `GET /health` (liveness) and `/health/ready` (Redis).
- **Worker watchdog:** the worker writes `restomatch:worker:heartbeat` to Redis every 60 s; Vercel
  Cron hits `/api/cron/worker-heartbeat` every 5 min and emails `WORKER_ALERT_EMAILS` when it is
  stale; the dashboard shows a banner.
- **Failed jobs** are logged one line each (`[queue] job=… attempt=… failed: …`) and sent to Sentry
  when `SENTRY_DSN` is set.
- **DB health:** `pnpm db:doctor` (read-only; safe against production).
- **Backups:** Supabase daily backups (PITR on the Pro tier); before any migration take a
  `pg_dump -Fc` and rehearse with `pnpm --filter @restomatch/db rehearse-cutover`.
- **Admin:** `/admin` (platform admins: `users.is_platform_admin` or `PLATFORM_ADMIN_EMAILS`) —
  restaurants, plans, leads.

## Mobile app

`apps/mobile` is an Expo 52 / React Native 0.76 **prototype** (owner KPIs, approvals queue,
receiving). It typechecks and bundles (`cd apps/mobile && pnpm exec expo export --platform
android`; `pnpm --filter @restomatch/mobile start` for Expo Go, with `EXPO_PUBLIC_API_URL` pointing
at the web app), but it has **no sign-in** — every API call it makes is
rejected as unauthenticated — so it is not demo-able against real data. The web app is responsive
and is the supported mobile experience today. See `docs/HANDOFF.md` → Known limitations.
