# Monitoring — errors, uptime, daily health

Three layers, cheapest first. Everything is **off by default** and needs no
code change to enable — only env vars (and, for Sentry, one dependency).

| Layer | Catches | Where |
|---|---|---|
| Worker heartbeat watchdog | worker process down / laptop asleep / database unreachable | built in (`/api/cron/worker-heartbeat`, every 5 min on Vercel Cron) |
| Uptime monitor (external) | web down, cron not running, TLS/DNS problems | spec below (Better Stack / UptimeRobot / Checkly) |
| Sentry | exceptions in web (server) and worker, with PII scrubbed | `@restomatch/observability` → `initSentryFromEnv` |
| Daily health digest | slow rot: stuck OCR, failed jobs, failed emails, queue backlog | worker job `health-digest`, 06:45 Asia/Jerusalem |

## 1. Sentry (web server + worker)

Server-side wiring is complete: `initSentryFromEnv({ service })` runs at boot in the worker
(`apps/worker/src/index.ts`) and in the web server (`apps/web/instrumentation.node.ts`);
Next's `onRequestError` hook (`apps/web/instrumentation.ts`) forwards every
uncaught server error (pages, route handlers, server actions); failed queue jobs
are reported by the worker. Every event passes `scrubSentryEvent`: request data,
headers (auth/cookies dropped), `extra`, `contexts`, the event `message`, exception
values and breadcrumbs are scrubbed (sensitive keys dropped; emails and phone
numbers masked); `user` keeps only its id; tracing is off and `sendDefaultPii` is
false. Free-text that doesn't look like an email/phone (e.g. a person's name in
an error message) is not detected — keep names out of thrown errors. The SDK is
imported at runtime (`webpackIgnore`, and `@sentry/node` is in the web's
`serverExternalPackages`), so installing it is all the web app needs.

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
| U1 | Web liveness | `GET https://<app>/api/healthz` | 200, JSON `"status":"ok"`, < 2 s | 1 min | web up, no DB coupling (never flaps on a dependency) |
| U2 | Login page renders | `GET https://<app>/login` | 200, body contains `RestoMatch` | 5 min | full render path (layout, i18n, CSP) |
| U3 | Worker alive | `GET https://<app>/api/cron/worker-heartbeat` with header `Authorization: Bearer <CRON_SECRET>` | 200, body contains `"status":"ok"` | 5 min | worker heartbeat in `worker_heartbeats` is < 5 min old |
| U4 | Worker process (Fly only) | built-in Fly check `GET :8080/health` | 200 | 15 s | health status + deploy gate (Fly does not restart on a failed check; the worker's database watchdog exits and `[[restart]]` restarts it) |
| U5 | TLS | certificate on `<app>` | > 14 days left | daily | |

U3 doubles as "is Vercel Cron running": the same route also emails
`WORKER_ALERT_EMAILS` when the beat is stale. It returns 401 without the bearer
(never expose `CRON_SECRET` to a monitor that shares dashboards publicly). A 500
from U3 means either the database is unreachable from the web app (the heartbeat
read fails — no alert email can be sent in that state, so the monitor IS the
alert) or the alert
email itself failed (the next tick retries). Either way: page a human.

## 3. Daily health digest

Worker job `health-digest` (`apps/worker/src/jobs/healthDigest.ts`), scheduled
06:45 Asia/Jerusalem in `cron.ts`. It emails, **through the outbox** (so the normal
dispatcher, retries and provider gating apply):

- `job_queue` counts per queue — waiting / active / delayed / failed-kept,
- jobs that failed in the last 24 h (queue, id, first line of the error),
- invoices in `ocr_pending` for more than 30 minutes (OCR never ran or got stuck),
- outbox notifications **created** in the last 24 h that ended `failed` (the
  outbox has no failed-at timestamp; a row created earlier that failed today is
  not counted).

Failed jobs are counted across up to 1,000 per queue (newest first; the count
shows `+` if that limit was hit) and the 10 most recent are listed with the
first line of the error, emails/phones masked. Backlog = more than 100 *waiting*
jobs in a queue (delayed jobs are scheduler ticks/retries and don't count).

Subject says `all clear` or `N items need attention`, so it can be filtered.

| Env | Meaning |
|---|---|
| `HEALTH_DIGEST_EMAILS` | recipients (falls back to `WORKER_ALERT_EMAILS`, then `PLATFORM_ADMIN_EMAILS`); none → the job logs "skipped" |
| `HEALTH_DIGEST_RESTAURANT_ID` | outbox rows need a restaurant: the digest is attributed to this one (default: the oldest restaurant). Platform-level rows without a restaurant need a migration — proposed, not done |

One scheduled email per recipient per Israel calendar day (dedupe key
`health-digest:<YYYY-MM-DD>:<email>`). For an on-demand run enqueue `health-digest`
with `{ "force": true }`: it sends immediately under its own key and does not use
up the day's scheduled digest. (`{}` behaves like the scheduled run.) A bad
`HEALTH_DIGEST_RESTAURANT_ID` logs a warning and falls back to the oldest
restaurant instead of failing.

## 3b. OCR retry sweep

Worker job `ocr-sweep` (`apps/worker/src/jobs/ocrSweep.ts`), every 5 minutes. An
invoice whose OCR job never ran (enqueue timed out while the queue database was unreachable, a lost
job, every attempt failed) stays `ocr_pending`. The sweep re-enqueues it **once**:

- only invoices created **10–25 minutes ago** with a scan URL — the scan's signed
  URL lives 30 minutes, and the worker can't re-sign it (no storage credentials),
  so older ones are left to a human (the digest lists OCR pending > 30 min);
- only invoices with **no** `ocr-invoice` job on record: a waiting/active/delayed
  one is a backlog, and a failed/completed one already ran and was metered (a quota
  or bad-image failure would only fail again) — those show up in the digest;
- only `http(s)` scan URLs (never stub/smoke rows);
- one automatic retry per invoice (unique `job_queue` dedupe key `ocr-sweep-<id>`,
  so overlapping sweeps or two workers can't double-enqueue), at most 50 per sweep;
- does nothing without `ANTHROPIC_API_KEY` (a retry could only fail).

## 4. Where alerts go

| Signal | Recipient | Channel |
|---|---|---|
| Worker down > 5 min | `WORKER_ALERT_EMAILS` | email (heartbeat route) |
| Uptime U1–U5 | owner + on-call | monitor's email/SMS/Slack |
| Sentry new issue | owner | email |
| Daily digest | `HEALTH_DIGEST_EMAILS` | email (outbox) |
