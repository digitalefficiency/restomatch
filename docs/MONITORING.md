# Monitoring — errors, uptime, daily health

Three layers, cheapest first. Everything is **off by default** and needs no
code change to enable — only env vars (and, for Sentry, one dependency).

| Layer | Catches | Where |
|---|---|---|
| Worker heartbeat watchdog | worker process down / laptop asleep / Redis unreachable | built in (`/api/cron/worker-heartbeat`, every 5 min on Vercel Cron) |
| Uptime monitor (external) | web down, cron not running, TLS/DNS problems | spec below (Better Stack / UptimeRobot / Checkly) |
| Sentry | exceptions in web (server) and worker, with PII scrubbed | `@restomatch/observability` → `initSentryFromEnv` |
| Daily health digest | slow rot: stuck OCR, failed jobs, failed emails, queue backlog | worker job `health-digest`, 06:45 Asia/Jerusalem |

## 1. Sentry (web server + worker)

Wiring is complete: `initSentryFromEnv({ service })` runs at boot in the worker
(`apps/worker/src/index.ts`) and in the web server (`apps/web/instrumentation.node.ts`);
Next's `onRequestError` hook (`apps/web/instrumentation.ts`) forwards every
uncaught server error (pages, route handlers, server actions); failed BullMQ jobs
are reported by the worker. Every event passes `scrubSentryEvent` (emails, phone
numbers, cookies, auth headers, tokens, DB URLs removed), tracing is off and
`sendDefaultPii` is false.

**`SENTRY_DSN` is optional** (tested: `packages/observability/src/__tests__/sentry.test.ts`):
unset → nothing loads, `captureException` is a no-op; set but SDK missing → one
warning at boot, the app runs normally.

To enable:

```bash
pnpm --filter @restomatch/worker add @sentry/node      # worker
pnpm --filter @restomatch/web add @sentry/node          # web server-side
# then set, per environment:
SENTRY_DSN=https://…ingest.sentry.io/…   # Sentry → Project → Client Keys
SENTRY_ENV=production                     # or staging
# release is taken from VERCEL_GIT_COMMIT_SHA (web) / FLY_IMAGE_REF (worker) automatically
```

Browser-side errors are not reported yet (that needs `@sentry/nextjs` and a
client config; the server side covers tRPC and rendering failures).

Recommended alert rules in Sentry: *new issue* → email; *issue seen > 10 times in
1 h* → email + Slack.

## 2. Uptime checks (external monitor spec)

Configure in any monitor (Better Stack, UptimeRobot, Checkly). Regions: at least
2, one in Europe. Alert after 2 consecutive failures.

| # | Check | Request | Expect | Interval | Why |
|---|---|---|---|---|---|
| U1 | Web liveness | `GET https://<app>/api/healthz` | 200, JSON `"status":"ok"`, < 2 s | 1 min | web up, no DB/Redis coupling (never flaps on a dependency) |
| U2 | Login page renders | `GET https://<app>/login` | 200, body contains `RestoMatch` | 5 min | full render path (layout, i18n, CSP) |
| U3 | Worker alive | `GET https://<app>/api/cron/worker-heartbeat` with header `Authorization: Bearer <CRON_SECRET>` | 200, body contains `"status":"ok"` | 5 min | worker heartbeat in Redis is < 10 min old |
| U4 | Worker process (Fly only) | built-in Fly check `GET :8080/health` | 200 | 15 s | restarts a hung machine automatically (`fly.toml`) |
| U5 | TLS | certificate on `<app>` | > 14 days left | daily | |

U3 doubles as "is Vercel Cron running": the same route also emails
`WORKER_ALERT_EMAILS` when the beat is stale. It returns 401 without the bearer
(never expose `CRON_SECRET` to a monitor that shares dashboards publicly). A 500
from U3 means the alert email itself failed — the next tick retries.

## 3. Daily health digest

Worker job `health-digest` (`apps/worker/src/jobs/healthDigest.ts`), scheduled
06:45 Asia/Jerusalem in `cron.ts`. It emails, **through the outbox** (so the normal
dispatcher, retries and provider gating apply):

- queue depths per queue — waiting / active / delayed / failed-kept,
- jobs that failed in the last 24 h (queue, id, first line of the error),
- invoices in `ocr_pending` for more than 30 minutes (OCR never ran or got stuck),
- outbox notifications that ended `failed` in the last 24 h.

Subject says `all clear` or `N items need attention`, so it can be filtered.

| Env | Meaning |
|---|---|
| `HEALTH_DIGEST_EMAILS` | recipients (falls back to `WORKER_ALERT_EMAILS`, then `PLATFORM_ADMIN_EMAILS`); none → the job logs "skipped" |
| `HEALTH_DIGEST_RESTAURANT_ID` | outbox rows need a restaurant: the digest is attributed to this one (default: the oldest restaurant). Platform-level rows without a restaurant need a migration — proposed, not done |

Run it on demand: enqueue `health-digest` with `{}` (e.g. `scripts/smoke-all-jobs.ts`
does), or wait for the schedule. One email per recipient per day (dedupe key
`health-digest:<YYYY-MM-DD>:<email>`).

## 4. Where alerts go

| Signal | Recipient | Channel |
|---|---|---|
| Worker down > 10 min | `WORKER_ALERT_EMAILS` | email (heartbeat route) |
| Uptime U1–U5 | owner + on-call | monitor's email/SMS/Slack |
| Sentry new issue | owner | email |
| Daily digest | `HEALTH_DIGEST_EMAILS` | email (outbox) |
