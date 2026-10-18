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

---

# Round 2 — whole-system QA on the release candidate

Base: `claude/client-ready` @ b5334f6 → d09a57f (all sessions merged), fast-forwarded/merged into
this branch. Node v22.22.0, pnpm 10.33.0 throughout.

## Fixed in round 2

| # | Problem (severity) | Fix | Test |
|---|---|---|---|
| R2-1 | **EN-7 / F7** (high): `packages/queue` producers used ioredis' offline queue + `maxRetriesPerRequest:null`, so a set-but-unreachable or malformed `REDIS_URL` (classically Upstash's `https://` REST URL) made `registerInvoice` hang until the function timed out | Producers: no offline queue, 3 s connect timeout, hard 3 s deadline on `add()`, coded `QueueUnavailableError` (`queue.unavailable`), `redisUrlProblem()` scheme check, throttled `error` log. `registerInvoice` keeps the invoice and returns `ocrQueued:false`; the wizard shows a he/en message and receives against the PO; `catalog.import` falls back to the inline commit. Boot: web WARNs; worker WARNs in dev, refuses to boot in prod | `packages/queue/src/__tests__/failFast.test.ts` (8: scheme, deadline, refused host ≈3 s, black-holed host ≈3 s, REST URL instant), `receiving.test.ts` (+3), `apps/worker/src/__tests__/env.test.ts` (3) |
| R2-2 | **Outbox dedupe** (critical, found by the worker runtime smoke): `notifications_dedupe_key_unique` is a PARTIAL index; `ON CONFLICT (dedupe_key)` without its predicate raised *"no unique or exclusion constraint matching the ON CONFLICT specification"* — the **end-of-day report, order reminders, supplier-delay alerts and `orders.placeOrder` by email/WhatsApp all failed**. The existing test used a mocked DB | `DEDUPE_INDEX_PREDICATE` on the conflict target in `notifications/outbox.ts` (immutable list — sprint-approved, minimal) and `routers/orders.ts` | `outbox-dedupe.db.test.ts` — real Postgres, red before / green after |
| R2-3 | **Worker connection leak** (critical, found by the soak): every job run called `createDb(url)`; postgres.js never closes idle connections → each run leaked its connection for the life of the process (measured: 30 `outbox-dispatch` runs → 31 open connections; outbox ticks every 60 s) | `apps/worker/src/db.ts` `jobDb(url)` — one pool per process; 11 jobs switched (one line each, incl. S2's `ocrInvoice.ts` / S3's `matchInvoice.ts`) | `apps/worker/src/__tests__/db.test.ts`; re-measured: 60 runs → 1 connection |
| R2-4 | No CI coverage of the worker at runtime | `ci.yml` worker job: seed a throwaway DB, boot the worker with a local email sink, `scripts/smoke-all-jobs.ts` (every queue once) | ran the exact step locally on a fresh DB → OK |
| R2-5 | `engines.node` said `>=20` | `>=22.0.0 <23` (CI/.nvmrc/Docker already 22) | — |
| R2-6 | e2e favicon filter no longer needed (S6 added `app/icon.svg`; S4 already removed the CSP one) | filter removed | e2e 71/71 |
| R2-7 | **Request-path Redis could stall login and every dashboard render** (high — refuter D1): `lib/redis.ts` and `lib/rateLimit.ts` used the default offline queue; a black-holed Redis made a rate-limit check wait 30 s, a silent one forever; the dashboard worker banner awaited a Redis GET with no Suspense | both clients use `failFastRedisOptions()` + a 1.5 s `withDeadline` per call (rate limiter still fails OPEN); `getRedis()` ignores a wrong-scheme URL. `rateLimit.ts` is on the immutable list — minimal change, flagged | `lib/__tests__/redisFailFast.test.ts` (3) — red (15 s timeouts) before, green after |
| R2-8 | Timed-out catalog enqueue could be committed twice (refuter D7: `Promise.race` doesn't cancel `queue.add`; the router falls back inline, BullMQ lands the job later) | worker `import-catalog` returns `skipped: 'already committed'` for a committed import | `smoke-all-jobs.ts` step "duplicate is skipped" |
| R2-9 | Unset `REDIS_URL` reported `ocrQueued:true` and the wizard polled 30 s (refuter D10) | `enqueueOcrInvoice` returns `false` with no queue → `ocrQueued:false` | `receiving.test.ts` |
| R2-10 | `/dashboard/receiving/<malformed id>` showed the error boundary (refuter D2) | `BAD_REQUEST` from zod → `notFound()` | e2e `malformed ids` (receiving/orders/invoices × he/en, 6) |
| R2-11 | Docker hygiene (refuter D8/D9): `.env` only ignored at the root, sources writable by the app user | `.dockerignore` drops `**/.env*`, `**/*.env`, keys, dumps; build fails if an env file reaches the context; runtime `/app` root-owned (node can't write it). Note: the tracked `.npmrc` must stay in the context — excluding it changed the install and bloated the image to 1.79 GB (caught, reverted) | image 709 MB, `touch` in `/app` → EACCES, boots + OCR→match OK |
| R2-12 | Worker shutdown left pools open | `closeJobDbs()` on SIGTERM/SIGINT | `db.test.ts` |

## QA results

| Area | Result |
|---|---|
| Clean clone → `pnpm install --frozen-lockfile` → full gate (migrate, RLS provision + completeness, `db:doctor --strict`, typecheck, lint, tests, worker tests with Redis, audit, `next build`) | see Verification — layer 1 |
| e2e (`next dev`, own seeded DB, RLS app role) | **71/71** (auth 7, smoke 64 = 32 pages × he/en) |
| Production build + `next start` (NODE_ENV=production, boot guards on) crawl | **126 page loads**: 5 roles × he/en logged in with the demo password, 22 dashboard/admin routes (owner) + 5 per other role, 14 public routes; **0** console errors, **0** Hebrew in English chrome, every `<html lang dir>` correct. 404 page translated (`העמוד לא נמצא` / `Page not found`). Slowest SSR: `/` 2.5 s (first hit), dashboard pages 1.0–1.5 s |
| robots / sitemap / OG | 200; robots disallows app routes, sitemap lists the 7 marketing routes with he/en alternates; OG 1200×630 PNG + full `og:*` tags. ⚠ host is baked in **at build time** from `APP_URL` (was `localhost:3000` in a build made with the dev env) |
| Heartbeat route | no/wrong bearer → 401; right `CRON_SECRET` → 200 `status:ok`; stale + email provider unreachable → 500 (alert flag not set → retried next tick) |
| Worker runtime, every queue once (seeded DB, local email sink) | **13/13**: 7 scheduled jobs, outbox → sink → `sent` (4 EOD emails delivered), OCR(stub) → match chain, catalog import → `committed`, `sync-platforms` without credentials fails cleanly — after R2-2 (before: EOD report failed) |
| Worker Docker image | builds (709 MB; was 669 MB — new `translate` package), boots as `node`, `/health` 200, OCR → match processed inside the container, `docker stop` 0.3 s |
| 10-minute soak (production server, logged-in crawl) | **2,361 page loads, 0 failures**; web app-role connections flat at **5** the whole time; owner-role 4–5 (the 28–33 bump mid-run was the leaking worker — R2-3 — gone when it stopped); `next-server` RSS 313 MB → 766 MB in the first 2.5 min (warm-up/route caches), then +27 MB over 7.5 min → no leak signal |
| Bundles (First Load JS, vs round 1) | shared 103 kB (=); `/dashboard/receiving/[poId]` 240 → 253 kB; `/showcase/receiver` 208 → 220 kB; `/` 197 → 198 kB; `/dashboard/suppliers/[id]` 168 → 172 kB |
| Node | v22.22.0 everywhere (local, clean clone, Docker `node:22-slim`, CI `.nvmrc`) |

## Needs another area (round 2)

- **S6 — robots/sitemap/OG host:** `SITE_URL` is read at build time; make `robots.ts`/`sitemap.ts`
  `dynamic = 'force-dynamic'` (or prefer `VERCEL_PROJECT_PRODUCTION_URL`) so a preview/staging build
  never advertises the wrong host.
- **S2 — receiving bundle:** `/dashboard/receiving/[poId]` grew to 253 kB; lazy-load the scan step.
- **S2 / ops:** an invoice whose OCR enqueue failed (`ocrQueued:false`) stays `ocr_pending` forever —
  add a "retry reading" action on the invoice page, or a worker sweep that re-enqueues
  `ocr_pending` invoices older than N minutes (needs a `cron.ts` entry → owner review).
- **Owner — heartbeat alert copy** still tells the owner to `launchctl kickstart` (Mac-only);
  update once the worker moves to Fly/Docker.
- **S2 — demo trip-wires (refuter, high for the demo):** "Use a demo invoice" on a real PO lands on
  the PO-only fallback with *OCR confidence 100%* and every line as "missing on invoice" (11 false
  alarms, `wizard.tsx:186`); the closed-receipt summary says "0 matched, 0 checked by hand" and "the
  matching engine is now running" while the banner says it is unavailable; the step counter says
  "STEP 2 OF 5" over a 4-segment bar; the cookie banner covers "Continue to quantities" at 1366×900.
- **S3 — approvals/leaks polish (refuter):** a "Short delivery" card shows a red *Estimated loss
  ₪0.00*; "Escalate to owner" is offered to the owner; "Expected 522.6 ⇆ Actual 575" bypasses
  `formatIls`; no toast after approve/reject; the three headline figures (leaks ₪357 / dashboard ₪490
  / approvals at-risk ₪331) differ with no explanation; Hebrew category subtitles under English
  product names on the leak table.
- **S2/S4 — soft 404s:** `/dashboard/{orders,invoices,suppliers,products}/<bad id>` render the
  translated not-found page with HTTP 200 (streamed after the layout); harmless for users, fix if
  monitoring keys on status.
- **S6 — OG:** the OG image is English-only while `og:title` is Hebrew; `twitter:card` should be
  `summary_large_image`; robots `Host:` should not carry a scheme.

## Verification (2 layers)

**Layer 1 — full gate from a clean clone** (`scratchpad/clean-gate.sh <sha>`: fresh `git clone`,
`pnpm install --frozen-lockfile`, migrate, `provision-rls`, `check-rls`, `db:doctor --strict`,
`turbo typecheck`, `pnpm lint`, all package tests, worker tests with Redis, `pnpm audit --prod
--audit-level=high`, `next build`):

| SHA | Result |
|---|---|
| e08ee3c (EN-7) | 11/11 steps rc=0 |
| 8a53a9a (+ outbox, worker pools, CI smoke, base d09a57f) | 11/11 rc=0 · 1,083 tests + worker 16 · typecheck 17/17 · lint 0 errors |
| bbcbef4 (+ refuter fixes) | 11/11 rc=0 · **1,086 tests + worker 17** · lint 0 errors (6 warnings) · build green |
| c339a64 (final; `.dockerignore` only) | covered by bbcbef4 + image rebuild below |

**Layer 2 — production build + click-through, plus an independent refuter.**
- Production `next start` (NODE_ENV=production, boot guards on) at c339a64: **130 page loads**, 5
  roles × he/en via password login, 0 console errors, 0 Hebrew in English chrome, correct
  `lang/dir` everywhere, malformed ids → translated not-found.
- 10-minute soak: 2,361 loads, 0 failures, web connections flat (see QA).
- Worker image c339a64: 709 MB, boots read-only as `node`, OCR → match processed; all-jobs smoke
  13/13 (+ duplicate-import skip).
- e2e on dev: 71/71 (pre-refuter) + the 6 new malformed-id tests.
- **Independent refuter** (separate agent, read-only, ~16 min, 58 tool calls) re-verified claims
  1–7: CONFIRMED the outbox fix (rendered SQL + rolled-back insert pair; no other partial-index
  conflict target in the repo), the worker pool fix (no per-call pools left in worker/api/web), the
  EN-7 producers (≈3 s rejection for silent / refused / black-holed / NXDOMAIN / TLS-mismatch hosts,
  1 ms for https://) and the he/en demo path for all 5 roles; REFUTED "no other hang paths" (→ R2-7),
  "never double-processed" (→ R2-8), "404 everywhere" (→ R2-10), and found D8/D9 (→ R2-11), D10
  (→ R2-9). Remaining refuter findings outside S7 are listed under *Needs another area*.
