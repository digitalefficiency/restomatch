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
| `packages/observability/src/__tests__/sentry.test.ts` (3) | DSN optional (no DSN → no SDK load, capture no-op); DSN without SDK → warn, disabled, no throw; DSN + SDK → scrubbed `beforeSend`, no tracing/PII, release + service tag |
| `apps/worker/src/__tests__/healthDigest.test.ts` (4, real Postgres) | depths + 24 h failure window + stale-OCR (2 h counted, 5 min not) + outbox failures; subject wording; one email per recipient, deduped on the second run; clean skip with no recipients |
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

## Verification (2 layers)

_(filled at the final commit)_
