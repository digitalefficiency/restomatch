# RestoMatch — Build State

**Active milestone:** Production master plan (see ~/.claude/plans/lovely-scribbling-pony.md). Phases 1 (security), 3 (entitlements), 4 (admin), and **5+6+7 (UX polish / Hebrew landing / GTM doc) COMPLETE**. Phase 2 (production wiring) PARKED pending credentials — see memory `restomatch-phase2-parked` + docs/REMAINING-SESSIONS.md.
**Last completed task:** Phases 5+6+7 (built via one pipelined workflow, partitioned by file ownership). Backend: settings.get/update (matching-rules editor over restaurants.settings), plans.list (public), leads.create (public, honeypot+bounds), search.global (pg_trgm, migration 0008), non-breaking cursor pagination on activity.feed/approvals.myQueue/owner.suppliers. Web: Hebrew RTL marketing landing (`app/page.tsx` + `app/(marketing)/*` — hero, how-it-works, ROI/leak calculator, pricing from plans.list, lead form), dashboard UX polish (error.tsx/global-error/not-found, EntitlementUpsell upgrade-CTA wired into suppliers/leaks/overview, settings page, "load more" pagination, global search box, loading skeletons). docs/GTM.md. Verified: full monorepo typecheck + 376 tests green + `next build` green (22 pages); search.global & leads.create manually security-reviewed (parameterized, scoped, honeypot).
**Design overhaul:** Dark "command center for money" UX/UI COMPLETE (per docs/DESIGN-BRIEF, direction locked with user) — dark palette in tailwind.config.ts + ui-tokens, money-flow motif (.flow-stream/.leak-gradient) in globals.css, all lib/components restyled dark + new FlowAccent/StatCard, EVERY screen migrated off the light palette. Mono tabular numerals for ₪/KPIs; gold=savings, danger=leak; glass nav. Built by a 5-agent workflow; verified typecheck + 376 tests + next build + live browser QA. Vocabulary doc is in the agent's foundations output (bg/surface/surface-2/ink/muted/subtle/line/primary/gold/danger/warn/info). Skeuomorphic paper-document renderers (InvoicePaperShared, PoPaper) intentionally stay light.
**Demo data:** `apps/worker/scripts/seed-demo.ts` turns the static seed into a fully matched dataset (GRs/invoices/match_runs/discrepancies/price_history/activity) via the REAL matching+approvals engines — run it (DATABASE_URL=...dev pnpm --filter @restomatch/worker exec tsx scripts/seed-demo.ts) so the live dashboard shows real KPIs/approvals. Dev seed owner `owner@kfar-hazeitim.test` is flagged is_platform_admin for /admin.
**RAOS (Agent Operating System) — FOUNDATION COMPLETE** (branch `raos-foundation`, see ~/.claude/plans/restomatch-agent-humble-donut.md). Phases 0–5 built + verified green: (0) `AGENTS.md`+`OPERATING.md` contract; (1) `.github/workflows/ci.yml` enforcement gate (migrate→`turbo run typecheck test --concurrency=1`) + `.claude/workflows/quality-gate-pr.js`; (2) integer-agorot money refactor — `packages/matching/src/money.ts` helpers wired through the whole engine (float drift on the ₪ leak figure eliminated; output stays shekel-contract), single `formatIls()` util (`apps/web/lib/money.ts`) killing the duplicated `formatCurrency`, `leak-canary.test.ts` asserting the leak to the agora; (3) public `leads.create` per-IP rate-limit at the tRPC route handler + `packages/api/src/edge.ts` helpers; (4) 11 `.claude/agents/*.md`; (5) 7 `.claude/workflows/*.js`. Cron scheduling is opt-in (OPERATING.md ramp), NOT activated. Immutability list + PR-only autonomy + retry-cap=2 enforced.
**Next planned task:** Pilot gate (plan §8a). Remaining: Phase 2/6 cred-gated activation (Supabase/Resend/Anthropic/Sentry/Vercel — the deploy blocker; see docs/PRODUCTION-UNBLOCK.md); leak heatmap needs price baselines (3+ samples) to populate. (Per-IP rate-limit on leads.create — DONE, Phase 3 above.)
**Open blockers:** Deploy/Phase-6 blocked on credentials — no `.env`, no linked Vercel target. Code is build-ready; needs the runtime secret set + a deploy target.
**Tests at end of session:** 388 passing (72 matching incl. 3 leak-canary + 29 catalog + 24 ocr + 17 procurement + 18 charts + 218 api incl. 9 edge + 5 db + 5 billing) + 2 E2E; `next build` green. CI verified locally: `db migrate` → `turbo run test --concurrency=1` 8/8 green, non-web typecheck 13/13 green.

## Quick start for next session

```bash
brew services list | grep -E "(postgresql|redis)"
cd ~/Desktop/restomatch
git log --oneline -10
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm typecheck
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm test
```

## Environment

- DB: Postgres 16 native via brew, pgvector from source for PG16
- Test DB: `restomatch_test` with vector + pg_trgm + uuid-ossp
- Redis 7 native via brew
- Docker: not installed

## Architecture notes (carry forward)

- Relative imports MUST NOT use `.js` extension — bundlers can't resolve `.js`→`.ts` re-exports.
- Auth.js v5 requires `auth.config.ts` (Edge-safe for middleware) + `auth.ts` (full).
- `@types/react` pinned to 19.0.10 in apps/web — React 19.2+ has ReactPortal type regression.
- Mobile has React 18 but workspace hoists @types/react@19 — use cast wrappers (`as unknown as React.ComponentType<...>`) for Stack/Provider components.
- Drizzle operators re-exported from `@restomatch/db` — never import `drizzle-orm` directly outside packages/db.
- Matching engine is pure — pass `knownInvoiceNumbers` and `baselines` as input.
- fast-check 3.x: use `fc.double`, not `fc.float`.
- Catalog matcher uses pgvector via raw SQL `<=>` operator with `vector_literal::vector` casting.
- OCR reconciler: Claude wins string conflicts, Document AI tie-breaks numerics. Line matching by Dice bigram coefficient.
- OCR pipeline: auto-link product when top candidate confidence ≥ 0.95.
- Per-restaurant review threshold lives in `restaurants.settings.ocrReviewThreshold` (jsonb).
- HTTP client in `@restomatch/procurement` retries 5xx + 429 with exponential backoff.
- MSW 2.x (not nock) for HTTP test mocking — works with Node 20 fetch.
- Sync worker upserts POs by `(source_platform, source_ref)`. Suppliers by `(source_platform, external_ref)` unique, fallback to lowercase name.
- Test concurrency: `--concurrency=1` at root. Vitest pools=forks, singleFork=true.
- **Filesystem note:** if file Write returns success but content seems reverted, re-read before next edit.
- **`@restomatch/charts` owns SQL** for KPIs/leaks/suppliers/baselines. tRPC router delegates.
- **`@restomatch/api` exports the approvals engine + notifiers** (`evaluateApproval`, `DEFAULT_RULES`, `MockWhatsAppNotifier`, etc.). The worker depends on `@restomatch/api` to call them.
- **Approvals engine has 7 rules** (priority DESC): duplicate-invoice (100), large-invoice-without-po (95), unordered-item-significant (90), severity-block (80), cumulative-large (70), cumulative-medium (60), minor-info auto_approve (10), fallback to manager queue.
- **myQueue uses memberProcedure** (so bookkeepers can see their queue); approve/reject use managerProcedure + per-discrepancy role guard via `requires_role`.
- **Notifications dispatched per unique role per match_run**, not per discrepancy — summary message.
- **Info-level discrepancies auto-resolved at insertion** (resolution_status='accepted') — never enter the queue.
- **Real WhatsApp/Push/Email providers deferred to M9** — mocks write to `notifications_outbox` and mark sent immediately. Real impl swaps the constructor.
- **Tenant guards (`packages/api/src/tenant.ts`)** — every procedure taking a client-supplied entity id MUST verify ownership (assertGrOwned/assertSupplierOwned/...). Child tables (gr_lines, po_lines, invoice_lines) have no restaurant_id — scope through the parent join.
- **Cross-tenant attack suite** (`packages/api/src/__tests__/cross-tenant.attack.test.ts`) — its COVERAGE manifest must list every tRPC procedure (attack/isolation/justified exemption); adding a procedure without declaring coverage fails the suite.
- **Worker job payloads are not a trust boundary** — jobs verify entity ∈ payload.restaurantId before any write (matchInvoice, ocrInvoice); ocrInvoice derives supplierId from the verified invoice row, not the payload.
- **syncPlatforms PO lookup is restaurant-scoped** — TODO Phase 2 migration: composite unique index on (restaurant_id, source_platform, source_ref).
- **pgvector literals** go through `toVectorLiteral()` in catalog/matcher.ts (rejects non-finite values).
- **RLS GUC wiring:** memberProcedure runs in a `withRestaurant` tx (sets `app.current_restaurant_id` + `app.current_user_id`, rolls back on procedure error); onboarding uses `userScopedProcedure` (`withUser`, user GUC only). `createRestaurant` generates the restaurant uuid in code and sets the GUC before inserting — no GUC ⇒ no inserts anywhere.
- **RLS harness:** `rls.attack.test.ts` applies `drizzle/rls/0002` to the test DB and probes via non-owner `restomatch_app` role (helpers in `packages/db/src/rls.ts`). The raw-SQL probes are the RLS proof; the tRPC block is functional regression. 0002 ends with a completeness invariant: any table with restaurant_id but RLS disabled fails the apply.
- **Identity tables (users/accounts/sessions/...)** are a separate trust zone: app role has only RLS-scoped self-SELECT on users; Auth.js runs on the owner/service connection.
- **Money is integer agorot in the matching domain** — `packages/matching/src/money.ts` (`toAgorot`/`toShekels`/`quantizeIls`/`mulIls`/`sumIls`). The engine takes/returns shekel `number`s (NUMERIC contract) but does ALL deltas, sums, and money-thresholds in integer agorot. Never reintroduce float money sums. The leak figure is asserted to the agora by `packages/matching/src/__tests__/leak-canary.test.ts` (IMMUTABLE — human-PR only).
- **₪ display goes through `formatIls()`** (`apps/web/lib/money.ts`) — never inline `Intl.NumberFormat('he-IL')`. 0 decimals headline, 2 for precise tables.
- **Public-edge rate limiting:** `packages/api/src/edge.ts` (`clientIpFromHeaders`, `trpcRequestTargets`) lets the tRPC route handler throttle `leads.create` per IP via `enforceRateLimit` — the limit lives at the edge because `AppContext` carries no IP.
- **RAOS governance:** agents are PR-only (never merge/deploy/spend), respect the AGENTS.md immutability list, and self-repair ≤2× then halt. CI gate excludes web typecheck/lint/build (web `tsc` needs a prior `next build` for `.next/types`) — tracked follow-up.
- **matching uses forks/singleFork** (vitest.config) like the DB packages — the default threads pool's vite-env transport times out under detached/CI runners.
- **Phase-2 deploy requirement (from adversarial review, HIGH):** web app must get a dedicated non-owner DATABASE_URL_APP on Supabase (mirror ensureRlsAppRole grants) + startup assertion `rolbypassrls=false`; owner/service URL stays for worker + migrations only. Until then RLS is inert in production.
- **Auth/storage hardening (Session 3):** magic-link sends are rate-limited per canonical mailbox (`enforceMagicLinkLimit`, `canonicalizeEmail` in @restomatch/api) via Redis (`apps/web/lib/rateLimit.ts`, fail-open). `/scans/[invoiceId]` requires a session and resolves only the caller's own restaurant's scan via a service-role **signed URL** (`apps/web/lib/supabase/server.ts`); it is NOT in the middleware public list. tRPC POSTs get an Origin/CSRF check (`isOriginAllowed`). JWT re-validates membership/role every 10min (`MEMBERSHIP_REVALIDATE_MS`) so revocation/demotion takes effect; session maxAge 7d.
- **DB connection split:** `apps/web/lib/db.ts` = tenant queries on the RLS app role (`DATABASE_URL_APP ?? DATABASE_URL`); `apps/web/lib/authDb.ts` = Auth.js identity layer on the owner connection (`DATABASE_URL`). Keep identity writes on authDb (the app role has no DML on users/accounts/sessions).
- **Phase-2 activation TODO (cred-gated, documented in docs/REMAINING-SESSIONS.md):** provision `restomatch_app` non-owner role on Supabase + set `DATABASE_URL_APP` (until then RLS is inert in prod); apply RLS 0001+0002 to Supabase + make invoice-scans bucket private; set `SUPABASE_SERVICE_ROLE_KEY` (required for /scans signed URLs); production uploads must set `invoice_scans.restaurant_id` (the showcase anon uploader writes NULL — non-prod only).
- **Remaining roadmap:** docs/REMAINING-SESSIONS.md maps Phases 2–8 (🟢 code-complete vs 🟡 cred-gated), driven per-phase by a build Workflow + adversarial-review Workflow before each commit.
- **Entitlements (Phase 3):** `getEntitlements`/`requireFeature`/`meterOcrScan`/`getQuota` in `@restomatch/api`. Plan catalog = `PLAN_SEED` in `@restomatch/db` (single source for seed + implicit-trial fallback). **No billing account ⇒ implicit trial** (Pro features, 100 scans/mo, unmetered) so restaurants work pre-billing; admin assigns paid plans (Phase 4). OCR metering is worker-authoritative + race-safe (atomic increment-then-check). Gates: exports=accounting_export, leaks/suppliers=advanced_analytics, WhatsApp=whatsapp_alerts. Billing tables are RLS join-scoped; the app role is read-only on plans/billing (write-revoked in `ensureRlsAppRole`) — worker/admin/webhooks write on the owner connection.
- **Phase-3 deferred to Phase 5 (UX, dormant until paid plans exist):** dashboard pages throw/swallow on ENTITLEMENT_REQUIRED instead of an upgrade CTA (suppliers/page.tsx has no try/catch; leaks shows a role message; dashboard hides the section) — needs `error.tsx` + a cause-aware upgrade component + nav plan-gating. Also: `meterOcrScan` should be idempotent per invoice when the ocr-invoice enqueuer is wired (currently no enqueue path); integrations(sync) feature-gate when a tenant-facing connect path exists.
- **Admin panel (Phase 4):** `adminProcedure` in `@restomatch/api` (cross-tenant, owner connection via `ctx.adminDb`; web passes `adminDb=authDb` in `lib/trpc/server.ts` + the tRPC route). Bootstrap an admin via `PLATFORM_ADMIN_EMAILS` env (verified email) or set `users.is_platform_admin`. `assignPlan` is the canonical way to put a restaurant on a paid plan (creates the billing account + subscription, tx-locked). Admin UI at `/admin` (gated by `apps/web/lib/admin.ts` + the layout's notFound). When `DATABASE_URL_APP` (RLS) goes live, the web must pass the OWNER connection as `adminDb` — already wired to `authDb` (owner).
