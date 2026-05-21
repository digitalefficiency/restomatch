# RestoMatch — Build State

**Active milestone:** M8 (complete, awaiting approval to start M9)
**Last completed task:** Approvals engine + 7 rules + outbox + WhatsApp/Push mocks + approvals UI on web+mobile
**Next planned task:** Milestone 9 — Polish + Pilot Prep (cron, offline, exports, Sentry, real OCR providers, deploy)
**Open blockers:** none
**Tests at end of session:** 205 passing (48 matching + 29 catalog + 24 ocr + 17 procurement + 17 charts + 66 api + 2 db + 2 E2E)

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
