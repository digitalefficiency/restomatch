# Worker in the cloud — deploy runbook

The worker (`apps/worker`: OCR, matching, catalog imports, the outbox that sends
every email, the daily schedules) runs on the owner's Mac today. A closed lid
means uploads stop being read and no email leaves. This runbook moves it to a
managed container host. **Nothing here creates an account or deploys by itself.**

## Choice: Fly.io (primary), Render (fallback)

| | Fly.io | Render | Railway |
|---|---|---|---|
| Config in repo | `apps/worker/fly.toml` | `render.yaml` (Blueprint) | not added (see below) |
| Health check after deploy | ✅ machine HTTP check on `/health` (status + gates deploys; does **not** restart) | ❌ none for background workers | ⚠ only at deploy time |
| Restart when the process exits | ✅ `[[restart]] policy = "always"` | ✅ | ✅ |
| Region next to the DB | ✅ `syd` today, `fra` after the EU move | ✅ `frankfurt` (no Sydney) | ✅ EU / ⚠ no Sydney |
| Graceful stop window | `kill_timeout = 120s` | `maxShutdownDelaySeconds: 120` (1–300) | configurable |
| Cost, 1 × shared-cpu, 1 GB | ≈ $6/month | Starter $7/month | usage-based ≈ $5–10 |

**Fly.io is primary** because it can sit in the database's region both today
(Sydney) and after the EU move, its machine check gates every deploy and shows
health continuously, it restarts the process whenever it exits, and it allows a
long enough graceful stop for an in-flight OCR call. No platform restarts a
process that is *up but useless*, so the worker does it itself: a **database
watchdog** exits the process after ~2 minutes without the database (4 failed
`select 1` checks, 30 s apart) and the restart policy brings it back; the heartbeat watchdog + uptime
check U3 (docs/MONITORING.md) alert a human if it still isn't processing.
Render is the low-touch fallback (dashboard-only, Frankfurt, no Sydney).
Railway was not added: health checks only at deploy time and no Sydney region.

## What the image guarantees (`apps/worker/Dockerfile`)

- Built from the repo root with the frozen lockfile; only the worker and its
  workspace packages are installed (~710 MB).
- Runs as the non-root `node` user; the code in `/app` is root-owned (read-only).
- Database watchdog: after ~2 min without the database the process exits (code 1)
  so the platform restarts it — a worker without its database (which is also the
  job queue) would otherwise look healthy.
- `node` is PID 1 → `SIGTERM` reaches the worker: it stops taking jobs, lets
  in-flight jobs finish, drains its Postgres pool and exits. A job cut off anyway
  is "stalled" (its `job_queue` lock is no longer renewed) and a live worker
  queues it again — nothing is lost.
- Refuses to boot in production without `DATABASE_URL`, `ANTHROPIC_API_KEY`,
  `RESEND_API_KEY`, `EMAIL_FROM`. No Redis: the job queue, schedules and the
  heartbeat live in Postgres (migration 0061); a leftover `REDIS_URL` only logs a
  warning.
- `GET /health` (liveness) and `GET /health/ready` (database `select 1` →
  `{"status":"ready","db":"up"}`, else 503) on `$PORT` (8080).
- Exactly one instance is enough; more are safe if ever needed (jobs are claimed
  with `FOR UPDATE SKIP LOCKED`, so two workers never take the same job).

## Secrets (names only — never paste values into chat or git)

| Name | Required | Notes |
|---|:-:|---|
| `DATABASE_URL` | ✅ | owner/service connection, **session** pooler or direct (the worker is long-lived) |
| `QUEUE_DATABASE_URL` | — | separate connection for the job queue; defaults to `DATABASE_URL` |
| `ANTHROPIC_API_KEY` | ✅ | invoice OCR |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✅ | outbox email |
| `APP_URL` | — | public web URL; only used by the local-disk scan storage path |
| `WORKER_ALERT_EMAILS` | — | fallback recipients for the daily digest |
| `HEALTH_DIGEST_EMAILS` | — | daily health digest recipients (comma-separated) |
| `HEALTH_DIGEST_RESTAURANT_ID` | — | restaurant the digest's outbox row is attributed to (default: oldest) |
| `SENTRY_DSN`, `SENTRY_ENV` | — | error reporting (docs/MONITORING.md) |
| `OCR_CLAUDE_MODEL` | — | override the OCR model |
| `RETENTION_CRON_ENABLED`, `RETENTION_PURGE_ENABLED` | — | data retention (dry run unless PURGE=1) |

## Fly.io — first deploy (≈20 min)

```bash
# 0. Install flyctl and log in (owner).  https://fly.io/docs/flyctl/install/
fly auth login

# 1. Create the app from the committed config — does NOT deploy.
fly launch --no-deploy --copy-config --config apps/worker/fly.toml --name restomatch-worker

# 2. Secrets (one command; values from your password manager).
fly secrets set -a restomatch-worker \
  DATABASE_URL=… ANTHROPIC_API_KEY=… RESEND_API_KEY=… EMAIL_FROM=… \
  HEALTH_DIGEST_EMAILS=… SENTRY_DSN=…

# 3. STOP the Mac worker first (two workers are safe, but the Mac one is the
#    thing being retired):
launchctl bootout gui/$(id -u)/com.restomatch.worker   # or Ctrl-C start-worker.sh

# 4. Deploy from the REPO ROOT (build context must be the monorepo).
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .

# 5. Exactly one machine, no autoscaling.
fly scale count 1 -a restomatch-worker
```

### Verify (5 min)

```bash
fly status -a restomatch-worker          # 1 machine, check "health" passing
fly logs -a restomatch-worker            # "[worker] started 13 workers" + "[cron] registered: …"
fly ssh console -a restomatch-worker -C "node -e \"fetch('http://127.0.0.1:8080/health/ready').then(r=>r.text()).then(console.log)\""
```

Then in the app: upload an invoice photo → it reaches "matched" within a minute;
the dashboard's "worker is down" banner is gone (the worker heartbeat is in `worker_heartbeats`);
`/api/cron/worker-heartbeat` (with the cron bearer) returns `"status":"ok"`.

### Day 2

| Task | Command |
|---|---|
| Deploy a new version | `fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .` (after CI is green) |
| Roll back | `fly releases -a restomatch-worker --image` → `fly deploy -a restomatch-worker --config apps/worker/fly.toml --image <previous image ref>` |
| Restart | `fly machine restart -a restomatch-worker` |
| Rotate a secret | `fly secrets set -a restomatch-worker NAME=…` (restarts the machine) |
| Pause everything | `fly scale count 0 -a restomatch-worker` (jobs wait in Postgres `job_queue`) |
| Move region (EU) | change `primary_region` to `fra`, `fly deploy`, `fly scale count 1 --region fra` |

## Render — fallback

1. Render → **New → Blueprint** → this repository → it reads `render.yaml`.
2. Fill the secret values (`sync: false` entries) → **Apply**. One `starter`
   background worker in Frankfurt, auto-deploy off.
3. Deploy: Render → the service → **Manual Deploy** (after CI is green).
4. Render restarts the container when it exits (including the worker's own database
   watchdog exit) but has no HTTP health check for workers: rely on the heartbeat
   watchdog + uptime monitor (docs/MONITORING.md).

## Local smoke of the exact image

```bash
docker build -f apps/worker/Dockerfile -t restomatch-worker .
docker run --rm --network=host -e NODE_ENV=development -e DATABASE_URL=… restomatch-worker
DATABASE_URL=… pnpm --filter @restomatch/worker exec tsx scripts/smoke-queues.ts       # OCR → match
```
