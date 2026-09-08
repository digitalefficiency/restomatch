# RestoMatch — Build State

**Updated:** 2026-09-08 · plan v2, Wave 0, Sessions 1–2 done (branches `wave0/s1-ci-state` → `wave0/s2-precutover` → `wave0/s2-human-prs`, plus `wave0/s2-deps-security`; all off `release/security-hardening` @ 6daed6b)
**Canonical repo:** `~/restomatch`. **Never** work in `~/Desktop/restomatch` — it is an iCloud-evicted replica (dataless git objects, 90% of files missing).
**Master plan:** `~/.claude/plans/idempotent-shimmying-wave.md` — 8 waves, ~32 sessions. Read it before touching anything; this file is the per-session pointer.
**Go-live checklist:** `docs/GO-LIVE.md` (the one ordered list; 👤 = owner-run prod steps).

## Where things stand (verified 2026-09-08)

| Area | State |
|---|---|
| Production web | Vercel `project-6bs41`, LIVE on the **2026-06-26** build of `59da7ba` (docs commit on `feat/supplier-catalog-cadence`). Git-connected; every PR preview build fails because the Preview env has no secrets. |
| Production DB | Supabase `cringgshiafwsszyqufo` (ap-southeast-2), schema through **0018**; migrations **0019–0026 written, not applied**; RLS on 38 tables; `restomatch_app` exists (`rolbypassrls=false`) but the web still runs on the owner connection until `DATABASE_URL_APP` is flipped (GO-LIVE §E). |
| Email / Redis | Resend in **sandbox** (delivers only to the owner's mailbox); Upstash `rediss://` set. |
| Worker | Runs only on the owner's Mac (decision: stays there for the pilot). Start script + heartbeat watchdog land in Session 2. |
| Security stack | PR #9 (`release/security-hardening`): password + TOTP 2FA, storage isolation, CSP, RLS boot guards, audit log, legal pages — code-complete, CI `typecheck + test` green, **unmerged**. `main` on GitHub is still the empty placeholder commit; no branch protection. |
| Pilot | 2 tester restaurants + supplier "רום"; logins minted by hand. Nothing can take money yet. |

**Known-wrong things that hit pilot users today (fix order in the plan):** VAT default 17% (M4); receiving inbox hides POs without a delivery date (R5); password reset + legal pages bounce to `/login` (R7); double-tap creates a second goods receipt / a second invoice + OCR spend (M7/M8); `price_history` has no writer so the leak detective is empty (M1); partial deliveries fabricate QTY_SHORT (M2); baseline check double-counts (M3); OCR calls Opus twice per scan (M11).

## Wave 0 progress

- [x] **Session 1** — move to `~/restomatch`; T0 CI matrix (`.github/workflows/ci.yml`: web build + typecheck soak, worker tests with job-scoped Redis, `provision-rls` + `check-rls` after migrate, Playwright soak, dependency-review non-blocking until Dependency graph is enabled); `testDbUrl()` in `packages/db/src/test-env.ts` replacing 28 hard-coded `romkoren@localhost` DSNs; first `apps/worker` test; `docs/GO-LIVE.md`; stale cutover docs retired. → **PR #10** (human-PR: `ci.yml`). First-ever `next build` in CI exposed and fixed an edge-bundle leak in `instrumentation.ts`.
- [x] **Session 2 (agent part)** — **PR #11**: S2–S5, R7, M8, worker heartbeat + `/api/cron/worker-heartbeat` + dashboard banner, `start-worker.sh` + launchd, `cutoverChecks.ts` + `verify-cutover` + `rehearse-cutover`. **PR #12 (HUMAN-PR)**: S1 app-role password, M4 VAT 18%, M7 one receipt per PO, migration **0027_leak_trust**. **PR #13**: security dependency bump (next 15.5.25, next-auth beta.32, sharp, postcss) — clears the audit gate.
- [ ] **👤 Merge order** (each PR is stacked; GitHub retargets the base automatically): **#13 → into `wave0/s1-ci-state`**, then **#10 → `release/security-hardening`**, then **#11**, then **#12**. Every PR is CI-green on `typecheck + test`, `worker tests`, `web build + typecheck`; only `pnpm audit` is red until #13 lands. Then enable **Dependency graph** in repo settings.
- [ ] **Session 3** — 👤 live verification, backup + restore rehearsal (`rehearse-cutover`), Resend domain, inbox MX, security-stack cutover Phases 0–8 (with `APP_ROLE_PASSWORD`), `main` + Preview env, MarketMan partner email. See GO-LIVE §C–F.

## Quick start

```bash
cd ~/restomatch && git status
docker compose up -d                       # pgvector Postgres + Redis (or brew Postgres + DATABASE_URL_TEST)
DATABASE_URL='postgres://postgres:postgres@localhost:5432/restomatch_test' pnpm --filter @restomatch/db migrate
DATABASE_URL='postgres://postgres:postgres@localhost:5432/restomatch_test' pnpm --filter @restomatch/db provision-rls
# LOCAL RUNS ARE SINGLE FILES ONLY — the full suite / tsc hangs or OOMs on this Mac.
pnpm --filter @restomatch/worker exec vitest run src/lib/__tests__/notifyHelpers.test.ts
```

**The gate is CI, not a local claim.** Push the branch, wait for the green run, record its URL in the PR. Budget ≥2 CI rounds (~10–15 min each) per session.

## Rules that changed with plan v2

- **Test DB DSN:** `testDbUrl()` from `@restomatch/db` (`packages/db/src/test-env.ts`); default `postgres://postgres:postgres@localhost:5432/restomatch_test` (matches docker-compose + CI). A brew Postgres without that role exports `DATABASE_URL_TEST`. Only `apps/web/vitest.config.ts` and `playwright.config.ts` inline the expression (config files cannot import workspace packages).
- **Migrations are hand-written** (`drizzle-kit generate` is unsupported — the snapshot chain stops at 0013). Next number: **0027**. Every migration ≥ 0019 gets a shape test. `ALTER TYPE … ADD VALUE` lives alone in its own file. New tenant tables go into `drizzle/rls/0002_core_tenant_rls.sql`'s list or `check-rls` fails CI.
- **Human-PR set is wide** (AGENTS.md immutability list): engine + leak-canary, `plans.ts`, `schema.ts`, `rls.ts`, `.github/workflows/*`, `cron.ts`, `outbox.ts`, `packages/billing/*`, `rateLimit.ts`. The agent drafts the branch + PR; the owner reviews and merges.
- **Redis in CI** is job-scoped to `worker-tests`. Never set `REDIS_URL` repo-wide in CI: it flips `apps/web/lib/rateLimit.ts` and `packages/queue` to real Redis inside the API suites. Redis-dependent worker tests must skip when `REDIS_URL` is unset.
- **Playwright** runs in CI against `next dev` (non-blocking soak). Moving it to a production build needs an e2e-aware email transport: `assertWebEnv` demands `RESEND_API_KEY` in production and `isEmailConfigured()` then routes magic links to Resend instead of the `MAGIC_LINK_FILE` hook. Scheduled for W2 (Session 7) with the auth-flow refresh (the current spec predates password/2FA).
- **Web typecheck in CI** is `continue-on-error` during a soak: `next.config.ts` documents an intermittent tRPC `AppRouter` inference flake. Promote to blocking once measured clean, then drop `typescript.ignoreBuildErrors`.

## Demo data

`apps/worker/scripts/seed-demo.ts` turns the static seed into a fully matched dataset via the real engines (`DATABASE_URL=...dev pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts`). Dev seed owner `owner@kfar-hazeitim.test` is flagged `is_platform_admin`. **`packages/db/scripts/seed.ts` deletes all tenant data and has no prod guard until Session 2 (S5) — never point it at production.**

## RAOS (agent operating system)

`AGENTS.md` + `OPERATING.md` contract, 11 `.claude/agents/*.md`, 7 `.claude/workflows/*.js`. Cron scheduling is opt-in and **not** activated. `.claude/workflows/quality-gate-pr.js` runs the suite locally and will stall on this Mac — it needs a mode that reads the GitHub check status (follow-up). `canary.js` now targets `project-6bs41.vercel.app`.

## Architecture notes (carry forward)

- Relative imports MUST NOT use `.js` extension — bundlers can't resolve `.js`→`.ts` re-exports.
- Auth.js v5 requires `auth.config.ts` (Edge-safe for middleware) + `auth.ts` (full).
- `@types/react` pinned to 19.0.10 in apps/web — React 19.2+ has ReactPortal type regression.
- Mobile has React 18 but workspace hoists @types/react@19 — use cast wrappers (`as unknown as React.ComponentType<...>`) for Stack/Provider components.
- Drizzle operators re-exported from `@restomatch/db` — never import `drizzle-orm` directly outside packages/db.
- Matching engine is pure — pass `knownInvoiceNumbers` and `baselines` as input.
- fast-check 3.x: use `fc.double`, not `fc.float`.
- Catalog matcher uses pgvector via raw SQL `<=>` operator with `vector_literal::vector` casting.
- OCR reconciler: Claude wins string conflicts, Document AI tie-breaks numerics. Line matching by Dice bigram coefficient. **In production both provider slots are the same `ClaudeVision` instance** (`apps/worker/src/jobs/ocrInvoice.ts`) — two Opus calls per scan until M11.
- OCR pipeline: auto-link product when top candidate confidence ≥ 0.95.
- Per-restaurant review threshold lives in `restaurants.settings.ocrReviewThreshold` (jsonb).
- HTTP client in `@restomatch/procurement` retries 5xx + 429 with exponential backoff.
- MSW 2.x (not nock) for HTTP test mocking — works with Node 20 fetch.
- Sync worker upserts POs by `(source_platform, source_ref)`. Suppliers by `(source_platform, external_ref)` unique, fallback to lowercase name. **Both uniques are GLOBAL (no `restaurant_id`) — tenant #2 on the same platform collides (I5, fixed in W3 migration 0030).** `sync-platforms` has no producer and is not scheduled; `listProducts` is never called (I2/I3).
- Test concurrency: `--concurrency=1` at root. Vitest pools=forks, singleFork=true.
- **Filesystem note:** if file Write returns success but content seems reverted, re-read before next edit.
- **`@restomatch/charts` owns SQL** for KPIs/leaks/suppliers/baselines. tRPC router delegates.
- **`@restomatch/api` exports the approvals engine + notifiers** (`evaluateApproval`, `DEFAULT_RULES`, `MockWhatsAppNotifier`, etc.). The worker depends on `@restomatch/api` to call them.
- **Approvals engine has 7 rules** (priority DESC): duplicate-invoice (100), large-invoice-without-po (95), unordered-item-significant (90), severity-block (80), cumulative-large (70), cumulative-medium (60), minor-info auto_approve (10), fallback to manager queue.
- **myQueue uses memberProcedure** (so bookkeepers can see their queue); approve/reject use managerProcedure + per-discrepancy role guard via `requires_role`. (Known role deadlock: DUPLICATE_INVOICE routes to the bookkeeper who cannot act — W2.)
- **Notifications dispatched per unique role per match_run**, not per discrepancy — summary message.
- **Info-level discrepancies auto-resolved at insertion** (resolution_status='accepted') — never enter the queue.
- **Real WhatsApp/Push providers deferred** — mocks write to `notifications_outbox`. Email is real via Resend (sandbox until a domain is verified).
- **Tenant guards (`packages/api/src/tenant.ts`)** — every procedure taking a client-supplied entity id MUST verify ownership (assertGrOwned/assertSupplierOwned/...). Child tables (gr_lines, po_lines, invoice_lines) have no restaurant_id — scope through the parent join.
- **Cross-tenant attack suite** (`packages/api/src/__tests__/cross-tenant.attack.test.ts`) — its COVERAGE manifest must list every tRPC procedure (attack/isolation/justified exemption); adding a procedure without declaring coverage fails the suite. 77 procedures declared as of 6daed6b.
- **Worker job payloads are not a trust boundary** — jobs verify entity ∈ payload.restaurantId before any write (matchInvoice, ocrInvoice); ocrInvoice derives supplierId from the verified invoice row, not the payload.
- **pgvector literals** go through `toVectorLiteral()` in catalog/matcher.ts (rejects non-finite values). Production embeddings are still the bigram `MockEmbeddingProvider` (P7, W7).
- **RLS GUC wiring:** memberProcedure runs in a `withRestaurant` tx (sets `app.current_restaurant_id` + `app.current_user_id`, rolls back on procedure error); onboarding uses `userScopedProcedure` (`withUser`, user GUC only). `createRestaurant` generates the restaurant uuid in code and sets the GUC before inserting — no GUC ⇒ no inserts anywhere.
- **RLS harness:** `rls.attack.test.ts` applies `drizzle/rls/0002` to the test DB and probes via non-owner `restomatch_app` role (helpers in `packages/db/src/rls.ts`). The raw-SQL probes are the RLS proof; the tRPC block is functional regression. 0002 ends with a completeness invariant: any table with restaurant_id but RLS disabled fails the apply. CI now also runs `provision-rls` + `check-rls` right after `migrate`.
- **Identity tables (users/accounts/sessions/...)** are a separate trust zone: app role has only RLS-scoped self-SELECT on users; Auth.js runs on the owner/service connection.
- **Money is integer agorot in the matching domain** — `packages/matching/src/money.ts` (`toAgorot`/`toShekels`/`quantizeIls`/`mulIls`/`sumIls`). The engine takes/returns shekel `number`s (NUMERIC contract) but does ALL deltas, sums, and money-thresholds in integer agorot. Never reintroduce float money sums. The leak figure is asserted to the agora by `packages/matching/src/__tests__/leak-canary.test.ts` (IMMUTABLE — human-PR only).
- **₪ display goes through `formatIls()`** (`apps/web/lib/money.ts`) — never inline `Intl.NumberFormat('he-IL')`. 0 decimals headline, 2 for precise tables.
- **Public-edge rate limiting:** `packages/api/src/edge.ts` (`clientIpFromHeaders`, `trpcRequestTargets`) lets the tRPC route handler throttle `leads.create` per IP via `enforceRateLimit` — the limit lives at the edge because `AppContext` carries no IP. Credential surfaces still omit `trustedProxyHops` (S3, Session 2).
- **matching uses forks/singleFork** (vitest.config) like the DB packages — the default threads pool's vite-env transport times out under detached/CI runners.
- **DB connection split:** `apps/web/lib/db.ts` = tenant queries on the RLS app role via fail-closed `resolveWebDbUrl()` (`DATABASE_URL_APP`, or the owner URL only under `NODE_ENV=test` / `ALLOW_OWNER_DB=1`); `apps/web/lib/authDb.ts` = Auth.js identity layer on the owner connection. `instrumentation.ts` runs `assertWebEnv` + `assertAppRoleNoBypass` + `assertRlsEnabled` at boot. `next build` imports both at page-data collection, so CI's web job sets both URLs to the CI database.
- **Entitlements:** `getEntitlements`/`requireFeature`/`meterOcrScan`/`getQuota` in `@restomatch/api`. Plan catalog = `PLAN_SEED` in `@restomatch/db`. **No billing account ⇒ implicit trial (all features, never expires)** — closed in W2. Gates: exports=accounting_export, leaks/suppliers/guardrail=advanced_analytics, WhatsApp=whatsapp_alerts, integrations (declared, enforced from W3). Billing tables are RLS join-scoped; the app role is read-only on plans/billing. `packages/billing` currently has no importer (W5).
- **Admin panel:** `adminProcedure` (cross-tenant, owner connection via `ctx.adminDb`). Bootstrap an admin via `PLATFORM_ADMIN_EMAILS` or `users.is_platform_admin`. `assignPlan` is the canonical way to put a restaurant on a plan (creates the billing account + subscription, tx-locked; `trialDays ≤ 365` is the pilot path).
- **Security stack (release/security-hardening):** password (argon2id) primary + magic-link backup, TOTP 2FA with AES-256-GCM secret at rest (`AUTH_ENC_KEY`, boot-blocking in prod), `tokenVersion` per-request revocation, lockout, cookie pinning, nonce CSP (Report-Only until `CSP_ENFORCE=1`), storage isolation (private bucket + path-prefix RLS, migrations 0019/0020), composite same-tenant FK on `products.supplier_id` (0021), legal pages + DSR (0022), credential tables (0023–0026). `ensureRlsAppRole` still creates the role with a hard-coded password (S1, Session 2 human-PR).
