# RestoMatch — Build State

**Active milestone:** Production master plan (see ~/.claude/plans/lovely-scribbling-pony.md) — Phase 1 security sprint, Session 1 COMPLETE
**Last completed task:** Tenant-isolation sweep: fixed markGrLine cross-tenant IDOR + registerInvoice unverified supplierId/grId; scoped worker jobs (matchInvoice/ocrInvoice/syncPlatforms) + catalog matchByAlias; added tenant.ts guards + 21-test cross-tenant attack suite (mutation-verified)
**Next planned task:** Phase 1 Session 2 — wire withRestaurant GUC into tRPC context, apply RLS migrations in test harness under non-owner role, RLS raw-select test
**Open blockers:** none
**Tests at end of session:** 262 passing (69 matching + 29 catalog + 24 ocr + 17 procurement + 18 charts + 100 api + 5 db) + 2 E2E

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
