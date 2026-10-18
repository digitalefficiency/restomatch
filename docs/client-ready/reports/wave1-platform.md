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
| 4 | **Verification harness** | `scripts/verify.sh [layer1\|layer2\|all]` — layer 1 = the full CI gate locally on a freshly re-created DB (14 steps, `turbo --force` so DB suites really run), layer 2 = seeded verify DB + `next start` (production, boot guards on) + `verify-prod.sh`, optional Playwright; PASS/FAIL table, logs in `.verify/`, local DB only. `scripts/verify-prod.sh <origin>` — GET-only smoke of a live deploy (healthz, landing he/en lang+dir, hero media, `/login`, 12 public paths, unknown path). CI: `supabase-sync --check` added to the blocking test job; new non-blocking `verify-layer2` job | `scripts/verify.sh`, `scripts/verify-prod.sh`, `docs/VERIFICATION.md` (he+en), `.github/workflows/ci.yml` |
| 5 | **Rate limiter cold start** | With `enableOfflineQueue:false`, commands sent before the connection was READY failed at once, so the first logins on every fresh serverless instance skipped rate limiting (orchestrator layer-2 finding). New `whenReady()` (one shared `ready` listener per client) awaited **inside** the existing 1.5 s deadline — a silent Redis still fails open within the deadline; the heartbeat read uses it too | `packages/queue/src/index.ts`, `apps/web/lib/rateLimit.ts`, `apps/web/lib/redis.ts` |
| 6 | **OCR retry sweep** | Worker job `ocr-sweep` every 5 min: re-enqueues invoices `ocr_pending` 10–25 min old with an http(s) scan URL (signed URL lives 30 min) that have **no** ocr-invoice job on record (pending = backlog; failed/completed = already ran and metered), never above 1,000 pending OCR jobs, **once** per invoice (Redis `SET NX` marker + jobId `ocr-sweep-<id>`), ≤ 50 per run, off without `ANTHROPIC_API_KEY` | `apps/worker/src/jobs/ocrSweep.ts`, `cron.ts`, `index.ts`, `healthDigest.ts`, `scripts/smoke-all-jobs.ts`, `docs/MONITORING.md` §3b |
| — | Handoff refresh | `main` is now the real code (Supabase integration production branch) — HANDOFF §3/§7 updated, links to the new runbooks | `docs/HANDOFF.md` |

## Tests

| Test | Proves |
|---|---|
| `packages/observability/src/__tests__/sentry.test.ts` (4) | DSN optional (no DSN → no SDK load, capture no-op); DSN without SDK → warn, disabled, no throw; DSN + SDK → scrubbed `beforeSend`, no tracing/PII, release + service tag; message / exception values / breadcrumbs scrubbed |
| `apps/worker/src/__tests__/healthDigest.test.ts` (7, real Postgres) | depths + 24 h failure window + stale-OCR (2 h counted, 5 min not) + outbox failures; subject wording; one email per recipient, deduped on the second run; clean skip with no recipients; 170 failures paged + counted with PII masked; `force` sends without consuming the day's slot; a bogus `HEALTH_DIGEST_RESTAURANT_ID` falls back |
| `apps/worker/src/__tests__/watchdog.test.ts` (2) | the Redis watchdog calls `onDead` after N consecutive failed PINGs and resets on a success |
| `apps/web/lib/__tests__/rateLimitColdStart.test.ts` (1) | a fake Redis that starts listening 300 ms after the first request: the first attempt is **counted** (red before the fix: `count 0`, failed open), the limit then blocks |
| `packages/queue/src/__tests__/failFast.test.ts` (+1) | `whenReady` resolves at once when ready, otherwise on the first `ready`, with one shared listener for many callers; once a client has been ready, a later outage doesn't wait (stays fail-fast) |
| `apps/worker/src/__tests__/ocrSweep.test.ts` (5, real Postgres + Redis) | only stale / never-run / URL-still-valid / http(s) pending invoices are re-enqueued with the right payload + jobId (queued, failed-before and `smoke://` rows skipped); a second sweep doesn't re-enqueue; a failed enqueue releases the marker; a huge backlog stops the sweep; the Redis marker claims once with a 7-day TTL |
| `scripts/smoke-all-jobs.ts` (now includes `health-digest` and `ocr-sweep`; CI worker job) | the scheduled job runs in a live worker and its email reaches the provider through the outbox |

## Immutable files touched

- `apps/worker/src/cron.ts` — one additive `upsertJobScheduler('health-digest-0645', …)`, its
  `removeJobScheduler`, and the log line. No existing schedule changed.
- `apps/worker/src/cron.ts` — one additive `upsertJobScheduler('ocr-sweep-5m', { every: 5 min })`, its
  remove, the log line; the retention comment that the health-digest insert had split is back above
  its block.
- `apps/web/lib/rateLimit.ts` — `await whenReady(this.redis)` inside the existing deadline (+ import).
- `.github/workflows/ci.yml` — `HEALTH_DIGEST_EMAILS` in the worker runtime smoke step; a
  `supabase-sync --check` step in the test job; the new non-blocking `verify-layer2` job.

## Needs another area / owner

- 👤 Owner: create the Fly app and set secrets (`docs/WORKER-DEPLOY.md`), stop the Mac worker;
  create a Sentry project and `pnpm add @sentry/node` (worker + web) with `SENTRY_DSN`; configure an
  uptime monitor with U1–U5; enable Supabase PITR; create the staging project + `staging` branch.
- S1 (db): a migration making `notifications_outbox.restaurant_id` nullable (or a `scope` column) for
  platform-level notifications, so the digest isn't attributed to a tenant.
- Browser-side Sentry needs `@sentry/nextjs` + a client config (not done; server side covers tRPC and
  rendering failures).
- Web (seen during QA, not this wave's files): `/dashboard/suppliers/<non-uuid>` renders the error
  boundary with 200 instead of `notFound()` (same fix as receiving got in round 2).
- Worker (ocr-procurement): stale invoices older than the 30-min signed URL can't be retried — the
  worker would need to re-sign the scan (`invoice_scans` storage path + a service-role storage client).
  Proposed, not built; the daily digest lists them.
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

### Round 2 of wave 1 — verification harness, limiter cold start, OCR sweep

**Layer 1:** `scripts/verify.sh layer1` on a freshly re-created DB, `turbo --force`: all 14 steps
PASS (install, fresh-db, migrate, provision-rls, check-rls, db-doctor, supabase-sync, typecheck, test,
worker-test, web-lint, web-build, web-tsc, audit).

**Layer 2:**

| Check | Result |
|---|---|
| `scripts/verify.sh layer2` with `VERIFY_E2E=1` (production build, `next start` with boot guards on, then Playwright) | verify-prod **20/20**; Playwright **77/77** |
| Cold start on a fresh production server with real Redis: first wrong-password login | `login:email:…=1`, `login:ip:…=1`, **0** "failing open" lines (before the fix the first attempt failed open: the new test is red without it) |
| Sweep against real BullMQ + Redis + Postgres, with no OCR worker consuming | first run: a `waiting` job `ocr-sweep-<id>` with the right payload; second run: skipped as `queued` |
| Worker `start` + `smoke-all-jobs.ts` | every check PASS, incl. `ocr-sweep`; "started 13 workers"; `[cron] registered: … ocr-sweep(5m)` |
| Mutations | layer 1: a failing vitest + an edited supabase migration → FAIL rc=1; layer 2: hero mp4 removed → FAIL rc=1; `verify-prod.sh` via a mutating proxy (500 / 404 asset / `dir=ltr` / origin down) → FAIL rc=1 each; a local `.env.production` with `ANTHROPIC_API_KEY` → refused, rc=2 |

**Refuter** (one independent agent, adversarial read of this diff):

| # | Finding | Outcome |
|---|---|---|
| 1 | `rateLimit.ts`, `cron.ts` and `ci.yml` are on the immutability list | accepted: changes requested by the orchestrator, minimal, tested, listed under *Immutable files touched* |
| 2 | The sweep re-ran failed jobs: a quota or inactive-subscription failure would be metered again and fail again | fixed: only invoices with **no** ocr-invoice job on record (failed/completed are skipped) + test |
| 3 | A retry drops `mockProviders`, so a stub row could become a paid call | fixed: http(s) scan URLs only (`smoke://` skipped) + test |
| 4 | `whenReady` added the 1.5 s deadline to every request during an outage | fixed: waits only before a client's **first** connection; afterwards it stays fail-fast + test |
| 5 | layer 2 could smoke-test a stale build | fixed: rebuilds unless layer 1 built it in the same run |
| 6 | A verify build could pick up real keys or a Redis URL from `.env.local` | fixed: REDIS_URL pinned to local Redis, ANTHROPIC/SENTRY unset, preflight refuses an env file that sets them; IPv6 `[::1]` accepted |
| 7 | A failed enqueue left the retry marker set | fixed: marker released + test |
| 9 | A failed server start still ran verify-prod | fixed: the server is cleaned up and the smoke is skipped |
| 10 | A public path redirecting to `/login` counted as a pass | fixed: public paths must return 2xx |
| 11 | The cold-start test didn't restore its `console.warn` spy | fixed |
| 8 | The sweep window is measured from `createdAt`, not from the upload | accepted: the margin covers it; documented |

The e2e run also turned up a locator flake in `e2e/auth.spec.ts`: Next's dev route announcer also has
`role="alert"`. The locator now excludes it; the assertion is unchanged.
