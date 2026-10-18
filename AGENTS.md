# AGENTS.md — the RestoMatch agent contract

This is the binding contract for every project-native agent in `.claude/agents/*.md` and every
workflow in `.claude/workflows/*.js`. If you are an agent working on this repo, **read this file and
`STATE.md` before you touch anything.** The human operator's view (cadence, kill-switch, cost) lives in
`OPERATING.md`.

## The one number (North Star)

Everything serves: **≥1.5% of a restaurant's food spend, surfaced as leak, in ₪, that one owner
believes.** Before doing work, ask "does this manufacture, dramatize, deliver, or protect that ₪
number?" If it doesn't, it is probably out of scope — route it to a human (see §Out of scope).

## Prime directives

1. **Read `STATE.md` first.** It is the source of truth for what is built, what is parked, and why.
2. **Autonomy is PR-only.** No agent may merge, deploy, write to the production Supabase database, send
   email/WhatsApp, or spend money without a human. Agents **open a PR and stop.** A human reviews,
   merges, and deploys.
3. **Never touch the immutability list** (§below) with an automated edit. Those files change only via a
   human-authored, human-reviewed PR. If your task needs one of them changed, write the proposal into
   your artifact and stop.
4. **Self-repair retry cap = 2.** If you open a PR and the quality gate / CI fails, you get **at most
   two** automatic fix attempts. On the **third** failure you abort, write an error artifact, and halt
   the shift. No infinite fix→fail→fix loops.
5. **Stay inside your write boundary.** Each agent owns a set of paths (§Ownership map). Do not write
   outside yours; if the work spans boundaries, hand the out-of-boundary part to the owning agent or to
   a human.
6. **Leave an artifact.** Every run writes a short result (what you did / found / why) — or, if nothing
   was needed, a one-line "ran, clean." Silence is not allowed (see `OPERATING.md` §Clean silence).

## Out of scope → route to a human

If a task is outside your boundary, requires a credential the repo doesn't have (Phase-2 — see
`docs/PRODUCTION-UNBLOCK.md`), or would change an immutable file, **do not improvise.** Write the
proposal into your artifact and stop. Credential intake is **Phase-6, human-only.**

## Immutability list — human-authored PR only (never auto-edit)

These are the crown jewels (money math, tenant isolation, schema, pricing, public attack surface) and
the governing files. An agent that needs one changed proposes it and stops.

- `packages/matching/src/engine.ts` — leak/discrepancy math, `TOTAL_TOLERANCE_ILS`, VAT default `0.17`,
  severity thresholds, and (post-refactor) the **integer-agorot** money math.
- `packages/matching/src/index.ts` — the **12** `DiscrepancyType` union + `MatchInput` / `MatchOutput`
  contracts. (Plus `reconciliation.ts`, `tolerances.ts`, `units.ts` in the same package.)
- `packages/matching/src/__tests__/leak-canary.test.ts` + `packages/matching/src/__tests__/fixtures.ts`
  — the numbers-canary and its builders.
- The shared `formatIls()` money-format util + the agorot↔display boundary (frozen once it exists).
- `packages/db/drizzle/rls/0001_invoice_scans_rls.sql`, `0002_core_tenant_rls.sql`, and
  `packages/db/src/rls.ts` (`applyCoreTenantRls` / `ensureRlsAppRole` — the tenant trust boundary).
- `packages/db/drizzle/0000..0008_*.sql` + `packages/db/drizzle/meta/` (applied migration history — new
  migrations only), `packages/db/src/schema.ts`, and `packages/db/drizzle.config.ts` (a schema edit
  breaks types fleet-wide).
- `packages/api/src/__tests__/cross-tenant.attack.test.ts` (the **COVERAGE manifest**) and
  `rls.attack.test.ts`. Agents may **add** a coverage entry when adding a tRPC procedure; never delete
  or weaken an assertion.
- `packages/db/src/plans.ts` (`PLAN_SEED` / `priceAgorotMonthly`) and `packages/billing/*`
  (pricing + entitlements).
- `packages/api/src/approvals/engine.ts` (the rules that block before payment).
- `packages/api/src/notifications/outbox.ts` + `apps/worker/src/cron.ts` (delivery + scheduled jobs).
- `packages/api/src/routers/leads.ts` + `apps/web/app/api/trpc/[trpc]/route.ts` (public attack surface)
  + `apps/web/lib/rateLimit.ts` (the Redis/memory rate-limit store).
- `.github/workflows/*`, `.claude/agents/*`, `AGENTS.md`, `OPERATING.md` — **no self-modification of
  governing files.**

## Money facts you must respect

- **Storage:** the matching domain stores money as Postgres `NUMERIC(12,2)` (amounts) and `NUMERIC(12,4)`
  (unit prices) — **shekels**, returned by Drizzle as **strings**. Integer **agorot** are used in
  billing/pricing (`plans.ts`).
- **The refactor (in flight):** matching math moves to **integer agorot** at a parse-at-boundary
  (`NUMERIC string → integer agorot`; prices → integer scale-4 "price units" = 1/100 agorot), with an
  **explicit half-up rounding rule** at the `price × qty → lineTotal` step. Format only at display.
- **Display:** all ₪ rendering goes through the single `formatIls()` util — never re-implement
  `Intl.NumberFormat('he-IL', …)` inline.
- **Leak figure:** `totalDiscrepancyAmount = Σ |deltaAmount|`. The canary asserts it integer-exact
  (`Math.round(total*100) === EXPECTED_LEAK_AGOROT`) plus the discrepancy type-set.

## Test / CI facts

- Package manager **pnpm@10.33.0**, Node **22** (`.nvmrc`), task runner **turbo**.
- Tests run **serially** (`turbo run test --concurrency=1`; DB packages use `singleFork`) against a
  Postgres 16 + pgvector DB. **Bootstrap the schema first:** `pnpm --filter @restomatch/db migrate`
  (creates extensions + applies `0000..0008`). RLS role/policies self-bootstrap inside the attack
  suites. Tests seed themselves (`resetDb`/`seedPlans`/`seedTenant`).
- The CI gate (`.github/workflows/ci.yml`) is the un-bypassable enforcement. Keep it green; never weaken
  it to make a PR pass. Web typecheck/lint/build are **not** in the v1 gate (web `tsc` needs a prior
  `next build` for `.next/types`) — that's a tracked follow-up, not a thing to silently disable.

## Design vocabulary (when touching UI)

Dark "command center for money": Hebrew-first, **RTL**, `he-IL` numerals, ₪ via `formatIls()`. Leak = the
hero number. Calm on "pending / consolidated invoice" (`חשבוניות ריכוז`) — never a false alarm. Tokens
live in `packages/ui-tokens`; rendering in `apps/web` styles. Don't invent a second design language.

## Ownership map (CODEOWNERS-style — the collision-free partition)

Two universal gates wrap every maker: **`test-sentinel`** (always) and **`tenant-security-warden`**
(whenever data is touched), plus the **`icp-keeper`** scope veto.

| Agent | Mission | Write boundary |
|---|---|---|
| `restomatch-conductor` | Front door: decompose, route, enforce the partition | Read-only (routes only) |
| `icp-keeper` | Hold ICP/GTM ground-truth; veto anti-ICP scope drift | `docs/ICP.md`, `docs/GTM.md`, `STATE.md`, `computeFitScore` spec |
| `leak-economist` | "So-what in ₪?" gate; keep COSTS/ROI honest | `docs/COSTS.md`, ROI-calculator copy |
| `matching-engine-guardian` | Protect + extend the 12-discrepancy engine, its ₪ math, `StagedMatch` | `packages/matching`, charts SQL (`packages/charts`) — **human-PR for ₪-math** |
| `ocr-procurement-engineer` | OCR ingest (incl. signed-GR photo fallback), reconciler, MarketMan/Zester sync | `packages/ocr`, `packages/procurement`, `packages/catalog`, `apps/worker` |
| `tenant-security-warden` | Defend RLS/tenant isolation; nothing ships that weakens them | Read-only audit; delegates fixes; owns `__tests__/*attack*` |
| `web-feature-engineer` | Dashboard/marketing/admin features (tRPC↔UI); **consumes** charts SQL, never edits it | `apps/web`, `packages/api` (routers, except immutable `leads.ts`), `packages/billing` |
| `rtl-design-steward` | Guard the dark RTL design + own the **visual** ₪ rendering (className/token) | `packages/ui-tokens`, web styles, `tailwind.config.ts` |
| `money-format-marshal` | Own the **`formatIls()` util** + agorot↔display boundary + VAT formatting contract | the money-format util layer only |
| `test-sentinel` | Keep the suite green, grow coverage, own attack suites + the leak-canary fixtures | all `__tests__`, vitest/e2e config |
| `growth-pmm-engineer` | Hebrew landing, lead funnel, pilot ops, GTM artifacts, `computeFitScore` impl | `apps/web/(marketing)`, leads flow, pilot docs, `packages/types` fit-score |

**Overlap resolutions:** `computeFitScore` → `growth-pmm-engineer` (spec'd by `icp-keeper`). Charts SQL →
`matching-engine-guardian` **owns**, `web-feature-engineer` **consumes** via tRPC only. ₪ split →
`money-format-marshal` owns the util, `rtl-design-steward` owns rendering. `StagedMatch` →
`matching-engine-guardian` (engine) + `ocr-procurement-engineer` (ingest staging).
