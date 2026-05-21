# RestoMatch — Build State

**Active milestone:** M6 (complete, awaiting approval to start M7)
**Last completed task:** Receiving flow end-to-end with mobile screens, daily expectations cron, suppliers.external_ref
**Next planned task:** Milestone 7 — Owner Dashboard (Web + Mobile parity)
**Open blockers:** none
**Tests at end of session:** 154 passing (48 matching + 29 catalog + 24 ocr + 17 procurement + 32 api + 2 db + 2 E2E)

## Quick start for next session

```bash
brew services list | grep -E "(postgresql|redis)"
cd ~/Desktop/restomatch
git log --oneline -8
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
- Mobile has React 18 but workspace hoists @types/react@19 — use cast wrappers (`as unknown as React.ComponentType<...>`) for Stack/Provider components. Runtime is unaffected.
- Drizzle operators re-exported from `@restomatch/db` — never import `drizzle-orm` directly outside packages/db.
- Matching engine is pure — pass `knownInvoiceNumbers` and `baselines` as input.
- fast-check 3.x: use `fc.double`, not `fc.float`.
- Catalog matcher uses pgvector via raw SQL `<=>` operator with `vector_literal::vector` casting.
- OCR reconciler: Claude wins string conflicts, Document AI tie-breaks numerics. Line matching by Dice bigram coefficient.
- OCR pipeline: auto-link product when top candidate confidence ≥ 0.95.
- Per-restaurant review threshold lives in `restaurants.settings.ocrReviewThreshold` (jsonb).
- HTTP client in `@restomatch/procurement` retries 5xx + 429 with exponential backoff. 4xx never retries.
- Procurement adapters use `// VERIFY: pending real API contract` tags on interfaces until real docs land.
- MSW 2.x (not nock) for HTTP test mocking — works with Node 20 fetch.
- Sync worker upserts POs by `(source_platform, source_ref)` — unique key prevents duplicates.
- **Suppliers now have `external_ref` + `source_platform`** with unique index. 3-tier sync lookup: by external_ref → by name (lowercase) → insert new.
- credentialsVaultRef uses `env:VAR_NAME` convention until M9 brings real Vault.
- **Test concurrency: `--concurrency=1`** at the root test script — packages share test DB; race conditions break parallel runs.
- Vitest configs in db/catalog/api/matching all use `pool: 'forks', singleFork: true`.
- **Filesystem note:** if file Write call returns success but content seems reverted later, re-read before next edit. Linter/watcher may rollback between sessions.
- Receiving flow: tRPC `receiving.*` covers todayExpectations/getPo/startReceipt/markGrLine/submitReceipt/registerInvoice/pendingInvoices.
- Daily expectations worker writes to `audit_log` with action='daily_expectations.computed'. Notification triggers come in M8.
