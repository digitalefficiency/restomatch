# S7 platform — report

Branch `claude/client-ready-platform` (merged with `claude/client-ready` @ 68ed10d — S1, S3, S4,
S5, S6 included; the gate below ran on the merged tree).
Scope: build/type health, lint, CI, e2e, worker runtime, mobile, performance, handoff docs.

## Works (verified)

| What | How verified |
|---|---|
| Web `tsc --noEmit` | 0 errors, ~20 s, 925k instantiations; 4 clean runs (before and after the S1/S3/S4/S6 merge) |
| `next build` **with type-checking on** | green, 36 routes, shared First Load JS 102 kB |
| Every package `typecheck` (incl. mobile) | `pnpm turbo run typecheck --concurrency=1` → 16/16 |
| Full suite | `pnpm test` → 12/12 tasks green (see Gate) |
| Worker boots locally | 11 BullMQ workers, cron schedules registered, `/health` + `/health/ready` 200, heartbeat key written to Redis |
| Worker processes the queues | `apps/worker/scripts/smoke-queues.ts`: stub-OCR `ocr-invoice` → chained `match-invoice` → `match_run` written (~0.7 s), against local Postgres + Redis — both with `tsx` and inside the Docker image |
| Worker Docker image | builds (669 MB), runs as `node` (uid 1000), Docker `HEALTHCHECK` healthy, stops in <1 s on SIGTERM; prod mode refuses to boot without its secrets (correct) |
| Auth e2e | 7/7: password login, wrong password, unauthenticated redirect, TOTP 2FA gate + code, wrong code keeps the gate closed, magic link → onboarding → new restaurant |
| Smoke e2e (merged tree) | 64/64: 19 authenticated + 13 public pages × he/en — status, no bounce, `lang`/`dir`, no error boundary, zero console errors (two known items filtered, see below), no Hebrew in English chrome |
| Page speed (warm `next dev`, SSR) | 0.4–1.2 s per dashboard page, slowest `/dashboard/orders` 1.16 s; no outlier worth a query fix (S1's FK indexes landed) |
| Mobile bundles | `expo export --platform android` → 3.9 MB Hermes bundle in 52 s |
| `pnpm dev:worker` | boots the worker from `apps/web/.env.local` (11 workers, `/health` 200) |
| `db:doctor` on a freshly migrated CI-like DB | 0 FAIL / 0 WARN |

## Fixed

| Problem | Fix | Test |
|---|---|---|
| `typescript.ignoreBuildErrors: true` hid type errors from `next build` ("AppRouter inference drops routers" flake). It did **not reproduce**: repeated clean `tsc` runs and a full build with checking on are clean. The likely source was the iCloud-evicted `~/Desktop` replica (dataless files) STATE.md warns about | Flag removed (`apps/web/next.config.ts`); CI web typecheck is now blocking | `apps/web/test/appRouterShape.test.ts` — type-level (every router key must exist on the inferred `AppRouter`, none unlisted; verified it fails `tsc` when a router is dropped) + runtime (equals the mounted routers) |
| No ESLint at all (`next lint` had no config) | ESLint 9 flat config `apps/web/eslint.config.mjs` (`next/core-web-vitals` + `next/typescript`); `lint` = `eslint .`; `react/no-unescaped-entities` off (Hebrew gershayim `ש"ח`) | `pnpm lint` → 0 errors, 10 warnings (listed below) |
| `next dev` exhausted Postgres (`sorry, too many clients already`) — one 10-connection pool per module copy / HMR reload | `globalThis` memo for the pools in `apps/web/lib/db.ts` and `apps/web/lib/authDb.ts` (S4 asked for this in its report) | smoke run: app-role connections stayed at 3 (were exhausting 100) |
| Dashboard layout + page each built their own tRPC caller → `auth()` (JWT + session-security DB read) twice per request | `createServerCaller` wrapped in React `cache()` (`apps/web/lib/trpc/server.ts`) | tsc; smoke suite |
| Worker: failed jobs were invisible without Sentry; no `'error'` listener on BullMQ workers (an EventEmitter `error` with no listener throws → a Redis blip could kill the process) | `apps/worker/src/queue.ts`: one log line per failed job + `error` listener | `apps/worker/src/__tests__/queue.test.ts` |
| Worker Dockerfile: single stage, installed the whole monorepo (Next + Expo), ran as root via `pnpm` (signals not forwarded), 2 GB | multi-stage: lockfile-cached `pnpm fetch` → offline install of `@restomatch/worker...` only → runtime stage; non-root; `node --import tsx` as PID 1; `HEALTHCHECK`; optional BuildKit `ca` secret for TLS-intercepting proxies; `.dockerignore` keeps only web/mobile manifests | built + ran + smoke-tested locally; CI `worker image` job |
| Playwright suite stale (pre-password/2FA; wiped all users/restaurants of the shared test DB in `beforeEach`) | New suite on its **own DB** `restomatch_e2e` (`e2e/prepare-db.ts`: create, migrate, provision RLS, seed demo — once per run; `E2E_SKIP_SEED=1` reuses). Web server runs on the **RLS app role** like prod. Setup project signs in through Auth.js endpoints (UI-independent). Uses the preinstalled Chromium when the revision differs | `e2e/auth.spec.ts` (7), `e2e/smoke.spec.ts` (64) |
| Smoke coverage was missing | `e2e/smoke.spec.ts`: 19 authenticated + 13 public pages × he/en — HTTP < 400, no `/login` bounce, `<html lang dir>`, no error boundary/not-found, no console errors/uncaught exceptions, no Hebrew in the English chrome | see Gate |
| SEO metadata streamed into `<body>` for crawlers (S6 ask) | `htmlLimitedBots` regex in `next.config.ts` (Google/Bing/social unfurlers get blocking `<head>` metadata) | build |
| Worker for a demo needed a manual env dance (S4/S5 ask) | root `pnpm dev:worker` (loads `apps/web/.env.local`); README "Run the worker too" | ran it |
| CI | `ci.yml`: web job = lint + `next build` (type-checked) + blocking `tsc`; `db:doctor --strict` after the RLS gate (S1 ask); refreshed e2e job (own DB, no separate migrate step); new `worker image` job | YAML validated; every step run locally |
| `dump.rdb` (Redis snapshot from dev-setup) got committed; Playwright output tracked | untracked + `.gitignore` | — |

## Still broken / not done

- **e2e stays non-blocking in CI** (step-level `continue-on-error`) for a soak; under `next dev`
  each page compiles on first hit (~30 s), so the run is long. Proposal: run e2e against
  `next build && next start` — needs a test-mode email transport (prod mode demands
  `RESEND_API_KEY`), see "Needs another area" (S4).
- **Mobile app is not demo-able.** It installs and typechecks, but it has no sign-in, so every
  tRPC call is UNAUTHORIZED; it is also React 18 / Expo 52 while the web is React 19. Documented
  honestly in README + HANDOFF. Making it real = token auth endpoint + Expo 53 upgrade + i18n.
- **Audit gate (`pnpm audit`)**: the orchestrator took this over on the integration branch (asked
  me not to touch overrides/lockfile) — not in this branch.
- **GitHub `main`** is an unrelated placeholder history with a junk `azure-webapps-node.yml`. I did
  not touch it (no force-push). Exact steps for the owner: `docs/HANDOFF.md` §3.
- **Bundle size** (First Load JS, merged build; shared 103 kB): `/dashboard/receiving/[poId]`
  240 kB and `/showcase/receiver` 208 kB (S2 — scan/camera stack client-side), landing `/` 197 kB
  (S6 — animation lib); the rest 106–168 kB. Worth `dynamic()` imports for the scan step and the
  landing animations.
- **Vercel pool size:** `createDb` opens `max: 10` per serverless instance per connection (×2: app +
  auth). Against Supabase this must go through the transaction pooler (6543) — `docs/ENV-PRODUCTION.md`
  already says so; consider `max: 1–3` when `VERCEL` is set (S1's `client.ts`).
- Money-engine ask "schedule `baselines` after the nightly match batch": there is no nightly match
  batch — matching is per invoice (chained from OCR); `baselines` runs at 02:00 and reads all
  matched history, so the order already holds. Monthly leak report: proposal below.

## Feature & improvement proposals (value / effort)

1. **Host the worker in the cloud before the pilot grows** (high / S): `fly launch --no-deploy
   --copy-config --name restomatch-worker`, `fly secrets set …`, `fly deploy --config
   apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .`. Move `primary_region` with the DB.
2. **EU data residency** (high / M): prod DB is Sydney; Frankfurt is the natural region for Israel
   (HANDOFF §4).
3. **Staging env** (high / S): second Supabase project + Vercel Preview vars; run the e2e smoke on
   every preview URL (`E2E_BASE_URL` is a 5-line addition to the config).
4. **e2e on a production build** (medium / S) and then make it blocking.
5. **Monthly leak report email** from the worker (medium / S) — data exists in `owner.leakHero`.
6. **Sentry on web + worker** (medium / XS once a DSN exists; hooks are in place).
7. **Mobile**: PWA install of the web receiving flow instead of maintaining Expo (medium / S).

## Immutable files touched

- `.github/workflows/ci.yml` — owner asked for CI health. Web typecheck promoted to blocking +
  lint step, `db:doctor` step, refreshed e2e job, new `worker image` job. No gate weakened.
- No engine/schema/RLS/approvals/cron/outbox/leads/plans file touched. `apps/worker/src/cron.ts`
  untouched.

## Touched outside the S7 table (minimal, flagged)

- `apps/web/lib/db.ts` (unowned) and `apps/web/lib/authDb.ts` (S4) — 4-line `globalThis` pool
  memo; S4's own report requested it.
- `apps/web/lib/trpc/server.ts` (unowned) — `cache()` wrapper.
- `.dockerignore`, `.gitignore` (root) — worker image + ignore entries.
- `apps/web/package.json` + `pnpm-lock.yaml` — eslint devDeps, `lint`/`test:e2e:smoke` scripts.

## Needs another area

- **S4 — CSP:** `lib/securityHeaders.ts` puts `upgrade-insecure-requests` in the **Report-Only**
  policy; Chrome logs *"The Content Security Policy directive 'upgrade-insecure-requests' is ignored
  when delivered in a report-only policy"* as a console **error on every page**. Emit it only when
  `CSP_ENFORCE=1`. (Filtered in `e2e/helpers.ts` with a comment — remove the filter after.)
- **S4 — 2FA URL:** after the password server action, the 2FA screen renders but the address bar
  stays `/dashboard` (server-action redirect → middleware redirect of the RSC fetch). Redirect the
  password action straight to `/login/2fa` when the user has 2FA (or `redirect: false` + client
  navigation). The gate itself holds (tested).
- **S4 — e2e on `next start`:** an explicit e2e/demo email mode (write magic links to
  `MAGIC_LINK_FILE` even with `NODE_ENV=production` when e.g. `E2E_EMAIL_SINK=1` and not on
  Vercel) so the browser suite can run against a production build. S6 asked for the same.
- **S6 — favicon:** no `app/icon.*` / `public/favicon.ico`: `/favicon.ico` 404s on every page
  (console error; filtered in `e2e/helpers.ts`).
- **S1 — pools:** consider moving the `globalThis` memo + a serverless-aware `max` into
  `createDb` (`packages/db/src/client.ts`) so every caller gets it.
- **S2 — bundle:** lazy-load the scan/camera step of `/dashboard/receiving/[poId]`.
- **S2 — receiving wizard mutates on view:** merely opening `/dashboard/receiving/[poId]` fires
  `receiving.startReceipt` (seen twice per visit in the dev log — React strict-mode double effect).
  M7 makes it idempotent, but a page view creating a goods receipt is surprising (audit trail,
  "receiving started" activity). Start the receipt on the first user action instead.
- **Lint warnings (owners fix at leisure, 11, 0 errors):** `orders/[poId]/detail-client.tsx`,
  `receiving/[poId]/wizard.tsx` (+ `react-hooks/exhaustive-deps`), `suppliers/manager.tsx`,
  `scans/[invoiceId]/page.tsx` (+ `<img>`), `showcase/deliveries/page.tsx`,
  `showcase/receiver/_steps/InvoiceScan.tsx` (`<img>`), `lib/components/Heading.tsx`,
  `lib/__tests__/{env,passwords}.test.ts`, `postcss.config.mjs`.

## Gate

Run on the merged tree (this branch + `claude/client-ready` @ 68ed10d), local Postgres 16 +
pgvector and Redis 7:

| Command | Result |
|---|---|
| `pnpm turbo run typecheck --concurrency=1` | 16/16 tasks, exit 0 (web + mobile included) |
| `DATABASE_URL_TEST=…/restomatch_test pnpm test` | 12/12 tasks: api 446, web 183, matching 86 (leak canary untouched), catalog 50, db 45, ocr 39, charts 33, procurement 17, crypto 12, worker 11 (+1 Redis-gated skip), billing 5 — **927 passed** |
| `REDIS_URL=redis://localhost:6379 pnpm --filter @restomatch/worker test` | 12/12 (the Redis-gated test runs) |
| `cd apps/web && pnpm exec tsc --noEmit -p .` | exit 0 |
| `cd apps/web && set -a && . ./.env.local && set +a && pnpm build` | exit 0, **with type-checking** ("Checking validity of types") |
| `pnpm lint` | 0 errors, 11 warnings |
| `pnpm --filter @restomatch/web test:e2e` | auth 7/7; smoke 64/64 (the English public pages + `/admin` re-run after the locale-switcher fix: 15/15) |
| `pnpm --filter @restomatch/db run doctor --strict` (fresh migrated DB) | 0 FAIL · 0 WARN |
| `docker build -f apps/worker/Dockerfile .` + run + `scripts/smoke-queues.ts` | image builds on the merged tree; OCR → match processed in the container |
| `cd apps/mobile && pnpm exec expo export --platform android` | exit 0 |
