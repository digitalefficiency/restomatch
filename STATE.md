# RestoMatch — Build State

**Active milestone:** Production master plan (see ~/.claude/plans/lovely-scribbling-pony.md). Phase 1 (security) COMPLETE. **Phase 3 (entitlements/subscriptions) COMPLETE** (built out-of-order ahead of cred-gated Phase 2 — it's pure-code and the user's priority).
**Last completed task:** Phase 3 — billing/entitlements schema (billing_accounts/plans/subscriptions/usage_counters/billing_events/leads, migration 0006 + RLS), entitlement layer (getEntitlements with implicit-trial fallback, requireFeature middleware, race-safe worker OCR metering meterOcrScan, getQuota), gates on exports (accounting_export) + analytics (advanced_analytics) + WhatsApp (whatsapp_alerts), NoopBillingProvider + Grow skeleton (packages/billing), 13-test entitlement-bypass suite + billing RLS probes. 17-agent revenue-boundary review: 2 HIGH fixed (WhatsApp feature gate; app-role write-revoke on plans/billing tables so a tenant can't rewrite pricing); UX items deferred to Phase 5.
**Next planned task:** Phase 2 production wiring (docs/REMAINING-SESSIONS.md): 2.1 packages/env, then OCR/Resend/observability real clients + CI/CD. Then Phase 4 admin panel → pilot gate.
**Open blockers:** none (cred-gated items written ready-to-activate)
**Tests at end of session:** 334 passing (69 matching + 29 catalog + 24 ocr + 17 procurement + 18 charts + 167 api + 5 db + 5 billing) + 2 E2E

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
- **Phase-2 deploy requirement (from adversarial review, HIGH):** web app must get a dedicated non-owner DATABASE_URL_APP on Supabase (mirror ensureRlsAppRole grants) + startup assertion `rolbypassrls=false`; owner/service URL stays for worker + migrations only. Until then RLS is inert in production.
- **Auth/storage hardening (Session 3):** magic-link sends are rate-limited per canonical mailbox (`enforceMagicLinkLimit`, `canonicalizeEmail` in @restomatch/api) via Redis (`apps/web/lib/rateLimit.ts`, fail-open). `/scans/[invoiceId]` requires a session and resolves only the caller's own restaurant's scan via a service-role **signed URL** (`apps/web/lib/supabase/server.ts`); it is NOT in the middleware public list. tRPC POSTs get an Origin/CSRF check (`isOriginAllowed`). JWT re-validates membership/role every 10min (`MEMBERSHIP_REVALIDATE_MS`) so revocation/demotion takes effect; session maxAge 7d.
- **DB connection split:** `apps/web/lib/db.ts` = tenant queries on the RLS app role (`DATABASE_URL_APP ?? DATABASE_URL`); `apps/web/lib/authDb.ts` = Auth.js identity layer on the owner connection (`DATABASE_URL`). Keep identity writes on authDb (the app role has no DML on users/accounts/sessions).
- **Phase-2 activation TODO (cred-gated, documented in docs/REMAINING-SESSIONS.md):** provision `restomatch_app` non-owner role on Supabase + set `DATABASE_URL_APP` (until then RLS is inert in prod); apply RLS 0001+0002 to Supabase + make invoice-scans bucket private; set `SUPABASE_SERVICE_ROLE_KEY` (required for /scans signed URLs); production uploads must set `invoice_scans.restaurant_id` (the showcase anon uploader writes NULL — non-prod only).
- **Remaining roadmap:** docs/REMAINING-SESSIONS.md maps Phases 2–8 (🟢 code-complete vs 🟡 cred-gated), driven per-phase by a build Workflow + adversarial-review Workflow before each commit.
- **Entitlements (Phase 3):** `getEntitlements`/`requireFeature`/`meterOcrScan`/`getQuota` in `@restomatch/api`. Plan catalog = `PLAN_SEED` in `@restomatch/db` (single source for seed + implicit-trial fallback). **No billing account ⇒ implicit trial** (Pro features, 100 scans/mo, unmetered) so restaurants work pre-billing; admin assigns paid plans (Phase 4). OCR metering is worker-authoritative + race-safe (atomic increment-then-check). Gates: exports=accounting_export, leaks/suppliers=advanced_analytics, WhatsApp=whatsapp_alerts. Billing tables are RLS join-scoped; the app role is read-only on plans/billing (write-revoked in `ensureRlsAppRole`) — worker/admin/webhooks write on the owner connection.
- **Phase-3 deferred to Phase 5 (UX, dormant until paid plans exist):** dashboard pages throw/swallow on ENTITLEMENT_REQUIRED instead of an upgrade CTA (suppliers/page.tsx has no try/catch; leaks shows a role message; dashboard hides the section) — needs `error.tsx` + a cause-aware upgrade component + nav plan-gating. Also: `meterOcrScan` should be idempotent per invoice when the ocr-invoice enqueuer is wired (currently no enqueue path); integrations(sync) feature-gate when a tenant-facing connect path exists.
