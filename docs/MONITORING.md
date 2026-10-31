# Monitoring — errors, uptime, daily health

Three layers, cheapest first. Everything is **off by default** and needs no
code change to enable — only env vars (and, for Sentry, one dependency).

**Production has no worker process (#136).** Every background job — OCR, matching,
e-mails, the scheduled tasks of `cron.ts`, stall recovery — runs inside Vercel:
Vercel Cron calls `/api/cron/jobs` every minute (`apps/web/vercel.json`); it
beats `worker_heartbeats` (worker_id `vercel-cron`), recovers stalled jobs, runs
due scheduled tasks and drains the queue for ~240 s. Uploads are also kicked
right after their request (`lib/jobKick.ts`). "Worker" below means that runner.
The Mac / Fly worker (`apps/worker`) is optional and may run next to it.

The owner's on-call card (what each alert means, the first check, what to do)
is `docs/ops/ALERT-CARD.he.md`; the morning read-only queries are
`docs/ops/DAILY-CHECKS.sql`.

| Layer | Catches | Where |
|---|---|---|
| Job-runner heartbeat watchdog | `/api/cron/jobs` not running (Vercel Cron off, deploy broken) / database unreachable | built in (`/api/cron/worker-heartbeat`, every 5 min on Vercel Cron) |
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

## 2. Uptime checks (UptimeRobot — the owner creates these)

**UptimeRobot**, free plan, three HTTP(S) **Keyword** monitors. All three use the same settings:
- interval **5 min**;
- alert after **2 consecutive failures** (UptimeRobot: "Alert after 2 down checks" / confirmation);
- notify via the **UptimeRobot phone app (push)**, plus e-mail as a backup.

No secret is needed by any of them, and none of them sends one.

| # | Monitor name | Type / URL | Keyword (alert when NOT found) | Means when it fires |
|---|---|---|---|---|
| U1 | `RestoMatch healthz` | Keyword · `GET https://restomatchrrr.vercel.app/api/healthz` | `"status":"ok"` | the web app is down (no DB coupling: never flaps on a dependency) |
| U2 | `RestoMatch login` | Keyword · `GET https://restomatchrrr.vercel.app/login` | `RestoMatch` | the login page does not render (layout, i18n, CSP) |
| U3 | `RestoMatch jobs` | Keyword · `GET https://restomatchrrr.vercel.app/api/healthz?jobs=1` | `"jobs":"ok"` | the job runner has not beaten for ≥ 180 s (OCR / e-mails stopped), or the database did not answer |
| U5 | (optional) SSL expiry | UptimeRobot's SSL check on the U1 monitor | — | certificate < 14 days left |

U3 is public and secret-free. `/api/healthz?jobs=1` adds two fields to the U1 answer, and always answers HTTP 200 so that only the keyword decides:
- `jobs`:
  - `ok`: the freshest `worker_heartbeats` row is under 180 s old (the runner beats every 60 s);
  - `stale`: it is older, or there is no row;
  - `unknown`: the database errored or was slower than 2.5 s.
- `heartbeatAgeSec`: the age of that row.

It sends `Cache-Control: no-store`. The base `/api/healthz` never touches the database and its answer is unchanged.

The **e-mail** side of the same signal is `/api/cron/worker-heartbeat`, run by Vercel Cron every 5 min with `CRON_SECRET`:
- it e-mails `WORKER_ALERT_EMAILS` once when the beat is stale (> 5 min), and again on recovery;
- it is NOT an uptime target, because it needs the bearer;
- when the database itself is down it cannot e-mail; U3 is the alert then.

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
| Job runner down > 5 min | `WORKER_ALERT_EMAILS` | email (heartbeat route) |
| Uptime U1 / U2 / U3 | owner | UptimeRobot phone-app push (+ e-mail) |
| Sentry new issue | owner | email |
| Daily digest | `HEALTH_DIGEST_EMAILS` | email (outbox) |
