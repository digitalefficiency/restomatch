# Deployment Guide — RestoMatch

מדריך פריסה לסביבת staging ו-production. מניח שיש כבר חשבונות Vercel, Supabase, Upstash, Anthropic.

## Architecture

```
Web (Vercel)  ─┐
                ├─ tRPC (Edge + Node mix)
Mobile (Expo) ─┘     │
                     ▼
        Postgres + Storage (Supabase)
              Redis (Upstash)        ──┐
                                       │
                                       ▼
                                Worker (Fly.io)
                                — BullMQ consumers
                                — Cron schedules
                                — Outbox dispatcher
```

## Postgres (Supabase)

The same Supabase project already backs invoice Storage — consolidate the primary
DB onto it (do **not** create a separate DB provider).

1. Use the existing Supabase project (or create one, region `eu-central-1`).
2. Enable extensions — Supabase dashboard → Database → Extensions, or SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```
3. Connection strings — Settings → Database → Connection pooling:
   - `DATABASE_URL` — pooled, port 6543 (web + worker queries)
   - `DATABASE_URL_DIRECT` — direct, port 5432 (migrations only)
4. Run migrations: `DATABASE_URL_DIRECT=... pnpm db:migrate`
5. Apply RLS during this step (NOT auto-run): `packages/db/drizzle/rls/*.sql`
   — see `packages/db/drizzle/rls/README.md`.

## Redis (Upstash)

1. Create database `restomatch-prod` (region: `eu-west-1`)
2. Connection string in env as `REDIS_URL`
3. Enable persistence for production (not required for staging)

## Object Storage (Supabase Storage)

Invoice scans are already served from the Supabase `invoice-scans` bucket.

1. Bucket `invoice-scans` exists in the Supabase project.
2. **Harden it**: set the bucket to private and apply
   `packages/db/drizzle/rls/0001_invoice_scans_rls.sql`; the web app then serves
   signed URLs instead of public URLs (see `apps/web/lib/supabase/*`).
3. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   and `SUPABASE_SERVICE_ROLE_KEY` (server-only, for signed uploads).

## Web (Vercel)

```bash
cd apps/web
vercel link
vercel env add DATABASE_URL production
vercel env add AUTH_SECRET production    # openssl rand -base64 32
vercel env add AUTH_URL production       # https://app.restomatch.co.il
vercel env add EMAIL_FROM production
vercel env add RESEND_API_KEY production
vercel env add S3_ENDPOINT production
# ... repeat for every var in .env.example
vercel --prod
```

Vercel build command (auto-detected):
```
turbo run build --filter @restomatch/web
```

## Worker (Fly.io)

Create `apps/worker/fly.toml`:
```toml
app = "restomatch-worker"
primary_region = "fra"

[env]
  NODE_ENV = "production"

[[services]]
  internal_port = 3001
  protocol = "tcp"

[[services.http_checks]]
  interval = "10s"
  method = "get"
  path = "/health"
```

Deploy:
```bash
cd apps/worker
fly launch --no-deploy
fly secrets set DATABASE_URL=...
fly secrets set REDIS_URL=...
fly secrets set ANTHROPIC_API_KEY=...
fly secrets set GOOGLE_APPLICATION_CREDENTIALS=... # base64-encoded JSON
fly secrets set GOOGLE_DOCUMENT_AI_PROJECT_ID=...
fly secrets set GOOGLE_DOCUMENT_AI_PROCESSOR_ID=...
fly secrets set MARKETMAN_API_KEY=...
fly secrets set WHATSAPP_ACCESS_TOKEN=...
fly deploy
```

## Mobile (Expo EAS)

```bash
cd apps/mobile
eas build:configure
eas build --platform ios
eas build --platform android
eas submit
```

Set `EXPO_PUBLIC_API_URL=https://app.restomatch.co.il` in `eas.json` for production builds.

## Observability

### Sentry
1. Create project `restomatch-web` + `restomatch-worker` in Sentry
2. Add `SENTRY_DSN` to env on each app
3. Web: `pnpm add @sentry/nextjs` + run `npx @sentry/wizard@latest -i nextjs`
4. Worker: `pnpm add @sentry/node` + initialize at top of `apps/worker/src/index.ts`

### PostHog
1. EU instance (`eu.i.posthog.com`)
2. Project key in `POSTHOG_API_KEY`, `POSTHOG_HOST`
3. Web auto-tracks page views; backend `trackRestaurantEvent` calls fire on key events

## Smoke Test (post-deploy)

```bash
# 1. Health check
curl https://app.restomatch.co.il/api/healthz
# Expect 200

# 2. Signup flow
# Visit /login → submit email → check magic link in logs (dev) or inbox (prod)

# 3. Worker queue check
fly ssh console -C "redis-cli -u $REDIS_URL llen bull:sync-platforms:waiting"

# 4. Cron registration check
fly logs -a restomatch-worker | grep cron
# Expect "[cron] registered: daily-expectations(06:00), baselines(02:00), outbox-dispatch(60s)"

# 5. End-to-end demo
# Create restaurant → connect MarketMan (test creds) → wait 30s for sync → see PO in dashboard
```

## Rollback

```bash
# Web
vercel rollback

# Worker
fly releases
fly deploy --image registry.fly.io/restomatch-worker:deployment-N

# Migrations — Drizzle migrations are forward-only.
# For schema rollback, restore from Neon snapshot (Branch + restore in dashboard).
```

## Production Checklist

- [ ] All `.env` vars set in Vercel + Fly
- [ ] Sentry receiving events (test by triggering a known error)
- [ ] PostHog receiving events (check Live Events tab)
- [ ] Cron schedules visible in BullMQ (`fly ssh console` + redis-cli)
- [ ] At least 1 successful end-to-end test (PO→GR→OCR→match) in staging
- [ ] DNS pointed to Vercel
- [ ] HTTPS forced (Vercel default)
- [ ] Auth secrets rotated from staging values
