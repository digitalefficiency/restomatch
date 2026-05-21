# RestoMatch — Build State

**Active milestone:** M4 (complete, awaiting approval to start M5)
**Last completed task:** OCR pipeline with reconciler, providers, catalog integration; worker wired end-to-end
**Next planned task:** Milestone 5 — MarketMan adapter (procurement platform sync)
**Open blockers:** none
**Tests at end of session:** 120 passing (48 matching + 29 catalog + 24 ocr + 15 API + 2 DB + 2 E2E)

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
- Test DB: `restomatch_test` with vector + pg_trgm + uuid-ossp
- Redis 7 native via brew (running)
- Docker: not installed (compose file ready)

## Architecture notes (carry forward)

- Relative imports MUST NOT use `.js` extension — `export from './foo'`, not `'./foo.js'`. Bundlers can't resolve `.js`→`.ts` re-exports.
- Auth.js v5 requires `auth.config.ts` (Edge-safe for middleware) + `auth.ts` (full with Drizzle, Nodemailer, fs).
- `@types/react` pinned to 19.0.10 in apps/web — React 19.2+ has ReactPortal type regression.
- Drizzle operators (`eq`, `and`, `or`, `isNull`, `sql`, etc.) re-exported from `@restomatch/db` — never import `drizzle-orm` directly outside packages/db.
- Matching engine is **pure** — pass `knownInvoiceNumbers: Set<string>` and `baselines: Record<...>` as input.
- fast-check 3.x: use `fc.double`, not `fc.float`.
- Catalog matcher uses pgvector cosine distance via raw SQL `<=>` operator with `vector_literal::vector` casting (Drizzle doesn't expose pgvector ops).
- pg_trgm GIN index not yet added (deferred to M9 perf pass) — `similarity()` is fast on small datasets.
- MockEmbeddingProvider uses char-bigrams + FNV-1a hash → similar strings produce similar vectors.
- OCR reconciler: Claude wins string conflicts (Hebrew strength), Document AI tie-breaks numerics. Line matching by Dice bigram coefficient, threshold 0.4.
- OCR pipeline: auto-link product when top candidate confidence ≥ 0.95; otherwise leave productId null and surface candidates for human review.
- Real Google Document AI + Claude Vision providers deferred until credentials arrive. Tests use `StubOcrProvider`. Worker requires `mockProviders` until then.
