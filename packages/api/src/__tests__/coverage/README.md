# COVERAGE fragments — one file per package

Every tRPC procedure must be declared in the cross-tenant COVERAGE map, or
`cross-tenant.attack.test.ts` › "coverage completeness" fails (it also fails on a stale
entry). COVERAGE = `BASE_COVERAGE` (human-owned, in the attack file) merged with the
fragments in this directory by `mergeCoverage()` in `./index.ts`.

- **Each package owns exactly one file: `coverage/<package-id>.ts`** (`W2-09.ts`, `W2-09a.ts`,
  `G-07.ts`, `H-03.ts`). Create yours when you add your first procedure; never edit
  another package's file, and never pre-create one for someone else.
- **The attack test goes in your package's own `*.attack.test.ts`** (or another test file of
  yours), never in `cross-tenant.attack.test.ts`. The fragment value names that file.
- **Never re-declare a base key.** Strengthening or changing a base entry is a human PR.

Template (`coverage/W2-NN.ts`):

```ts
import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'tasks.list': "isolation — tasks.attack.test.ts: B's list never contains A's tasks",
  'tasks.complete': "attack — tasks.attack.test.ts: B completing A's task id → NOT_FOUND, A's row untouched",
};
export default coverage;
```

Value format: `attack — <file>.test.ts: <claim>` · `isolation — <file>.test.ts: <claim>` ·
or a justification of ≥30 characters (why no tenant data can leak), without "TODO".

`mergeCoverage()` fails the suite, naming the source, when a fragment:
1. declares a key already in the base or in another fragment (names both sources);
2. has a file name that is not a package id (`^(W[1-4]-\d{2}[a-z]?|G-\d{2}|H-\d{2})\.ts$`);
3. uses a bare `'attack'` / `'isolation'` (base-only: "a test below in this file"), a
   malformed attack/isolation value, or a justification under 30 characters or with "TODO";
4. names a `<file>.test.ts` that does not exist under `src/__tests__/`.

Check locally: `pnpm --filter @restomatch/api exec vitest run src/__tests__/coverage-manifest.test.ts`.
