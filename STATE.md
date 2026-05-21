# RestoMatch — Build State

**Active milestone:** M1 (complete, awaiting approval to start M2)
**Last completed task:** E2E tests passing, all typechecks ירוק
**Next planned task:** Milestone 2 — Matching Engine (TDD)
**Open blockers:** none
**Tests at end of session:** 19 passing (15 API + 2 DB unit/integration + 2 E2E)

## Quick start for next session

```bash
# Verify env
brew services list | grep -E "(postgresql|redis)"

# Check git status
cd ~/Desktop/restomatch
git log --oneline -5

# Validate baseline
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm typecheck
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm test
```

## Environment

- DB: Postgres 16 native via brew, pgvector built from source for PG16
- Test DB: `restomatch_test` on same instance
- All extensions enabled in both: vector, pg_trgm, uuid-ossp
- Redis 7 native via brew (running, not yet used)
- Docker: NOT installed (docker-compose.yml ready when needed)

## Architecture notes for future Claude

- **Relative imports MUST NOT use `.js` extension** — `export from './foo'` not `'./foo.js'`. Bundlers (Turbopack, webpack) don't resolve `.js` ↦ `.ts` re-exports correctly.
- **Auth.js v5 requires `auth.config.ts` (Edge-safe) + `auth.ts` (full)** — middleware can ONLY import from `auth.config.ts`. Anything Node.js (fs, nodemailer, drizzle-orm/postgres-js) must stay in `auth.ts`.
- **`@types/react` is pinned to 19.0.10** in `apps/web` — React 19.2+ has the ReactPortal type bug that breaks JSX intrinsic compat.
- **Drizzle operators (`eq`, `and`, `or`, `sql`, etc.) are re-exported from `@restomatch/db`** — don't import `drizzle-orm` directly in `apps/web` or you'll get duplicate-version conflicts.
- **Layout in apps/web uses `React.ReactNode`** (not imported `ReactNode`) to work around the @types/react ReactPortal issue.
