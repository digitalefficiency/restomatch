# Worker in the cloud — deploy runbook

The worker (`apps/worker`: OCR, matching, catalog imports, the outbox that sends
every email, the daily schedules) runs on the owner's Mac today. A closed lid
means uploads stop being read and no email leaves. This runbook moves it to a
managed container host. **Nothing here creates an account or deploys by itself.**

## Choice: Fly.io (primary), Render (fallback)

| | Fly.io | Render | Railway |
|---|---|---|---|
| Config in repo | `apps/worker/fly.toml` | `render.yaml` (Blueprint) | not added (see below) |
| Continuous health check that **restarts** a stuck process | ✅ machine HTTP check on `/health` + restart policy | ❌ background workers get no HTTP check (crash-restart only) | ⚠ health check only at deploy time |
| Region next to the DB | ✅ `syd` today, `fra` after the EU move | ✅ `frankfurt` (no Sydney) | ✅ EU / ⚠ no Sydney |
| Graceful stop window | `kill_timeout = 120s` | ≈30 s | configurable |
| Cost, 1 × shared-cpu, 1 GB | ≈ $6/month | Starter $7/month | usage-based ≈ $5–10 |

**Fly.io is primary** because it is the only one that keeps checking `/health`
after the deploy and restarts a hung worker, it can sit in the database's region
both today (Sydney) and after the EU move, and it allows a long enough graceful
stop for an in-flight OCR call. Render is the low-touch fallback (dashboard-only,
Frankfurt). Railway was not added: no ongoing health check and no Sydney region.

## What the image guarantees (`apps/worker/Dockerfile`)

- Built from the repo root with the frozen lockfile; only the worker and its
  workspace packages are installed (~710 MB).
- Runs as the non-root `node` user; the code in `/app` is root-owned (read-only).
- `node` is PID 1 → `SIGTERM` reaches the worker: it stops taking jobs, lets
  in-flight jobs finish, drains its Postgres pool and exits. A job cut off anyway
  is "stalled" and BullMQ runs it again — nothing is lost.
- Refuses to boot in production without `DATABASE_URL`, `REDIS_URL`
  (`redis://`/`rediss://` only — the Upstash **REST** URL is rejected),
  `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.
- `GET /health` (liveness) and `GET /health/ready` (Redis PING) on `$PORT` (8080).
- Exactly one instance is enough; BullMQ makes more safe if ever needed.

## Secrets (names only — never paste values into chat or git)

| Name | Required | Notes |
|---|:-:|---|
| `DATABASE_URL` | ✅ | owner/service connection, **session** pooler or direct (the worker is long-lived) |
| `REDIS_URL` | ✅ | Upstash **Redis** URL `rediss://default:…@…upstash.io:6379` (not the REST URL) |
| `ANTHROPIC_API_KEY` | ✅ | invoice OCR |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✅ | outbox email |
| `APP_URL` | ✅ | links inside emails |
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
  DATABASE_URL=… REDIS_URL=… ANTHROPIC_API_KEY=… RESEND_API_KEY=… EMAIL_FROM=… APP_URL=… \
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
fly logs -a restomatch-worker            # "[worker] started 12 workers" + "[cron] registered: …"
fly ssh console -a restomatch-worker -C "node -e \"fetch('http://127.0.0.1:8080/health/ready').then(r=>r.text()).then(console.log)\""
```

Then in the app: upload an invoice photo → it reaches "matched" within a minute;
the dashboard's "worker is down" banner is gone (the worker heartbeat is in Redis);
`/api/cron/worker-heartbeat` (with the cron bearer) returns `"status":"ok"`.

### Day 2

| Task | Command |
|---|---|
| Deploy a new version | `fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .` (after CI is green) |
| Roll back | `fly releases -a restomatch-worker` → `fly deploy --image <previous image ref>` |
| Restart | `fly machine restart -a restomatch-worker` |
| Rotate a secret | `fly secrets set -a restomatch-worker NAME=…` (restarts the machine) |
| Pause everything | `fly scale count 0 -a restomatch-worker` (jobs wait in Redis) |
| Move region (EU) | change `primary_region` to `fra`, `fly deploy`, `fly scale count 1 --region fra` |

## Render — fallback

1. Render → **New → Blueprint** → this repository → it reads `render.yaml`.
2. Fill the secret values (`sync: false` entries) → **Apply**. One `starter`
   background worker in Frankfurt, auto-deploy off.
3. Deploy: Render → the service → **Manual Deploy** (after CI is green).
4. Render restarts the container when it crashes but has no HTTP health check for
   workers: rely on the heartbeat watchdog + uptime monitor (docs/MONITORING.md).

## Local smoke of the exact image

```bash
docker build -f apps/worker/Dockerfile -t restomatch-worker .
docker run --rm --network=host -e NODE_ENV=development -e DATABASE_URL=… -e REDIS_URL=redis://localhost:6379 restomatch-worker
pnpm --filter @restomatch/worker exec tsx scripts/smoke-queues.ts       # OCR → match
```
