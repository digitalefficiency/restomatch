# S7 wave 1 — worker in the cloud, monitoring, backups/staging

Branch `claude/client-ready-platform` (after round-2 QA, PR #49). No migrations.
Master plan rows 15–16 (`docs/client-ready/MASTER-PLAN.md`).

## Delivered

| # | Item | What | Files |
|---|---|---|---|
| 1 | **Worker in the cloud** | Deploy config for the existing image on **Fly.io (primary)** and **Render (fallback)**; Railway evaluated and not added (no ongoing health check, no Sydney). Fly: HTTP check `/health:8080` every 15 s, `[[restart]] policy=always`, `kill_signal=SIGTERM` + `kill_timeout=120s` (in-flight OCR can finish; cut-off jobs are re-run as stalled), rolling deploy, exactly one machine (no `http_service` ⇒ never auto-stopped; `fly scale count 1`). Render: Blueprint background worker, Frankfurt, 1 instance, auto-deploy off. Secrets by name only. Runbook with first deploy, verification, day-2 table (deploy, rollback, restart, rotate, pause, region move) | `apps/worker/fly.toml`, `render.yaml`, `docs/WORKER-DEPLOY.md` |
| 2a | **Sentry (web + worker)** | Existing: a PII scrubber and a client registry, but the web never registered anything and the worker's hand-rolled init skipped the scrubber. Now one `initSentryFromEnv({ service })`: no-op without `SENTRY_DSN`; warns and continues if the SDK is absent; otherwise `init` with `beforeSend: scrubSentryEvent`, `sendDefaultPii:false`, no tracing, release from `SENTRY_RELEASE` / `VERCEL_GIT_COMMIT_SHA` / `FLY_IMAGE_REF`, `service` tag. Wired in the worker boot, the web Node boot, and Next's `onRequestError` (server errors in pages, handlers, actions). Enabling = `pnpm add @sentry/node` + DSN (kept out of the lockfile so nothing changes until the owner opts in) | `packages/observability/src/sentry.ts`, `apps/worker/src/index.ts`, `apps/web/instrumentation{,.node}.ts` |
| 2b | **Uptime spec** | U1 `/api/healthz`, U2 `/login`, U3 `/api/cron/worker-heartbeat` with the cron bearer (also proves Vercel Cron runs), U4 Fly machine check, U5 TLS expiry; intervals, expectations, alert routing | `docs/MONITORING.md` §2 |
| 2c | **Daily health digest** | Worker job `health-digest`: BullMQ depths for all 12 queues, jobs failed in 24 h (first error line), invoices `ocr_pending` > 30 min, outbox `failed` in 24 h → one outbox email per recipient per day (dedupe `health-digest:<day>:<to>`), subject "all clear" / "N items need attention". `cron.ts` (immutable): **one additive scheduler** `health-digest-0645` (06:45 Asia/Jerusalem) + its remove. Platform rows need a `restaurant_id` (NOT NULL, no migration this wave) → attributed to `HEALTH_DIGEST_RESTAURANT_ID` or the oldest restaurant | `apps/worker/src/jobs/healthDigest.ts`, `apps/worker/src/cron.ts`, `apps/worker/src/index.ts` |
| 3 | **Backups/PITR + staging** | What must survive (DB, scans bucket, `AUTH_ENC_KEY`, secrets), PITR enablement, pre-change `pg_dump`, a **monthly restore drill** (restore → `db:doctor` → `rehearse-cutover`), weekly storage copy; staging = **separate Supabase project** fed by the same GitHub integration from a long-lived `staging` branch, **branching off**, Vercel Preview env scoped to `staging`, its own Fly app + Upstash DB, seed guard (`SEED_ALLOW_REMOTE_HOST`), promotion flow | `docs/BACKUPS-STAGING.md` |
| — | Handoff refresh | `main` is now the real code (Supabase integration production branch) — HANDOFF §3/§7 updated, links to the new runbooks | `docs/HANDOFF.md` |

## Tests

| Test | Proves |
|---|---|
| `packages/observability/src/__tests__/sentry.test.ts` (4) | DSN optional (no DSN → no SDK load, capture no-op); DSN without SDK → warn, disabled, no throw; DSN + SDK → scrubbed `beforeSend`, no tracing/PII, release + service tag; message / exception values / breadcrumbs scrubbed |
| `apps/worker/src/__tests__/healthDigest.test.ts` (7, real Postgres) | depths + 24 h failure window + stale-OCR (2 h counted, 5 min not) + outbox failures; subject wording; one email per recipient, deduped on the second run; clean skip with no recipients; 170 failures paged + counted with PII masked; `force` sends without consuming the day's slot; a bogus `HEALTH_DIGEST_RESTAURANT_ID` falls back |
| `apps/worker/src/__tests__/watchdog.test.ts` (2) | the Redis watchdog calls `onDead` after N consecutive failed PINGs and resets on a success |
| `scripts/smoke-all-jobs.ts` (now includes `health-digest`; CI worker job) | the scheduled job runs in a live worker and its email reaches the provider through the outbox |

## Immutable files touched

- `apps/worker/src/cron.ts` — one additive `upsertJobScheduler('health-digest-0645', …)`, its
  `removeJobScheduler`, and the log line. No existing schedule changed.
- `.github/workflows/ci.yml` — `HEALTH_DIGEST_EMAILS` in the worker runtime smoke step.

## Needs another area / owner

- 👤 Owner: create the Fly app and set secrets (`docs/WORKER-DEPLOY.md`), stop the Mac worker;
  create a Sentry project and `pnpm add @sentry/node` (worker + web) with `SENTRY_DSN`; configure an
  uptime monitor with U1–U5; enable Supabase PITR; create the staging project + `staging` branch.
- S1 (db): a migration making `notifications_outbox.restaurant_id` nullable (or a `scope` column) for
  platform-level notifications, so the digest isn't attributed to a tenant.
- Browser-side Sentry needs `@sentry/nextjs` + a client config (not done; server side covers tRPC and
  rendering failures).
- Web (seen during QA, not this wave's files): the rate limiter fails open on the very first login after
  boot (ioredis "Stream isn't writeable" — offline queue disabled before the connection is ready; fails
  *open*, so no lock-out, but the first attempt isn't counted); `/dashboard/suppliers/<non-uuid>` renders
  the error boundary with 200 instead of `notFound()` (same fix as receiving got in round 2).
- Worker/outbox: without `RESEND_API_KEY` the dispatcher marks email rows `sent` (dev convenience) — in
  production the env guard refuses to boot without the key, so this only matters for staging without a key.

## Verification (2 layers)

Head `0f84ccd`.

**Layer 1 — clean-clone gate** (fresh clone, `--frozen-lockfile`, local Postgres 16 + pgvector + Redis):
install, migrate, provision-rls, check-rls, `db:doctor --strict`, typecheck (all packages), lint
(0 errors / 6 pre-existing warnings), **1090 tests** (all packages but worker) + **26 worker tests**
(1 pre-existing skip), `pnpm audit --prod --audit-level=high`, web production build — every step rc=0.

**Layer 2 — runtime + independent refuter:**

| Check | Result |
|---|---|
| Web prod build + `next start` with `SENTRY_DSN` and a temporary stub `@sentry/node` (removed after) | `init` called once: DSN, `environment`, `sendDefaultPii:false`, `tracesSampleRate:0`, `beforeSend` set; `service=web` tag — proves the SDK is reachable from the webpack build (refuter D2) |
| Prod crawl (5 roles × he/en + public) on that build | **130 page loads**, 0 console errors (only the 2 intentional 404 probes flagged), lang/dir correct |
| Worker `start` + `scripts/smoke-all-jobs.ts` (CI step, run locally) | **every check PASS** (all 12 queues + chain/duplicate/sink checks) incl. `health-digest` (1 email enqueued → dispatched → local sink) |
| Redis killed under the running worker | watchdog logged and exited code 1 after **112 s** (4 × 30 s PINGs) — what `[[restart]]` / Render restart on (refuter D1) |
| Worker Docker image (`apps/worker/Dockerfile`, built from the repo root) | 709 MB; boots as `node`; `/health/ready` → `{"status":"ready","redis":"up"}`; "started 12 workers"; `docker stop` (SIGTERM) → graceful shutdown, exit 0 |

Refuter (independent agent, adversarial read of the wave-1 diff + docs):

| # | Finding | Outcome |
|---|---|---|
| D1 | Docs claimed Fly health checks restart the machine; they don't | fixed: in-process Redis watchdog (exit → restart policy), fly.toml/docs corrected, live-tested |
| D2 | Web Sentry could never load (variable `import()` → empty webpack context) | fixed: `webpackIgnore` + `serverExternalPackages`; proven with a stub SDK in a prod build |
| D3 | Digest under-reported failed jobs (only the first page read) | fixed: pages up to 1000/queue, `+` when truncated, 10 listed, true count in the subject + test |
| D4 | "Outbox failed (24 h)" actually counts by creation time | made honest: label + docs say "created in the last 24 h that failed" (a failed-at column needs a migration — not this wave) |
| D5 | Sentry scrubber missed `message`, exception values, breadcrumbs (privacy) | fixed + test; failed-job reasons in the digest are redacted too |
| D6 | An early manual run suppressed that day's digest | fixed: `{force:true}` uses its own dedupe key + test; the day key is the Asia/Jerusalem date |
| D7 | Bad `HEALTH_DIGEST_RESTAURANT_ID` → every digest fails | fixed: validated (uuid + exists), warns, falls back to the oldest + test |
| D8 | Small doc/code mismatches (schedule comment, backlog counting delayed jobs, Render stop window, fly `[build]`/`retries`, APP_URL "required", rollback command) | fixed |
| D9 | `cron.ts` and `ci.yml` are on the immutability list | accepted: minimal, additive, listed above under *Immutable files touched* |
