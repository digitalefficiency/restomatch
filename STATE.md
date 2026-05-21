# RestoMatch — Build State

**Active milestone:** M2 (complete, awaiting approval to start M3)
**Last completed task:** Matching engine with 48 tests (39 unit + 9 property-based), worker smoke
**Next planned task:** Milestone 3 — Catalog Matcher (alias → embedding → fuzzy → barcode)
**Open blockers:** none
**Tests at end of session:** 67 passing (48 matching + 15 API + 2 DB + 2 E2E)

## Quick start for next session

```bash
brew services list | grep -E "(postgresql|redis)"
cd ~/Desktop/restomatch
git log --oneline -5
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm typecheck
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm test
```

## Environment

- DB: Postgres 16 native via brew, pgvector from source for PG16
- Test DB: `restomatch_test` with same extensions
- Redis 7 native via brew (running)
- Docker: not installed (compose file ready)

## Architecture notes (carry forward)

- Relative imports MUST NOT use `.js` extension — `export from './foo'`, not `'./foo.js'`. Bundlers can't resolve `.js`→`.ts` re-exports.
- Auth.js v5 requires `auth.config.ts` (Edge-safe for middleware) + `auth.ts` (full with Drizzle, Nodemailer, fs).
- `@types/react` pinned to 19.0.10 in apps/web — React 19.2+ has ReactPortal type regression.
- Drizzle operators (`eq`, `and`, etc.) re-exported from `@restomatch/db` — never import `drizzle-orm` directly in apps/web (multi-version pnpm conflict).
- Matching engine is **pure** — pass `knownInvoiceNumbers: Set<string>` and `baselines: Record<...>` as input. No DB inside the engine.
- fast-check 3.x: use `fc.double`, not `fc.float` (float requires 32-bit precision constraints).
- pricePercent/priceAbsolute work as AND for "clean" (within both → clean); pct >= blockPricePercent always blocks (for PRICE_HIGHER only).
- qtyAbsolute/qtyPercent use MAX as effectiveTol for clean check; below effectiveTol but above qtyPercent → info severity.
