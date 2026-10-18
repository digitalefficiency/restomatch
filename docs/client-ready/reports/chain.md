# S8: Chain report (branches, branch switcher, chain dashboard)

Branch `claude/client-ready-chain`, draft PR #38 into `claude/client-ready`. Design note:
`docs/client-ready/chain-design.md`. Production, Vercel and remote DBs were not touched.
There is **no schema change and no migration.**

## Works (verified)

- **Branch = restaurant; chain = the caller's owner branches on the active branch's billing account.**
  - The `chain` router: `branches`, `overview`, `switchTarget`, `renameBranch`, `addBranch`.
  - Memberships are read under RLS (`withUser`). Every number comes from the existing charts SQL
    (leak report, leak hero, owner KPIs), run inside that branch's own `withRestaurant`
    transaction, 3 branches in parallel, capped at 25.
  - Summing is pure TS in integer agorot. The chain % is Σleak ÷ Σspend.
- **Branch switcher.**
  - Placement: in the desktop header, and as a list in the mobile drawer. It appears for every
    user with more than one membership, whatever the role.
  - Flow: the server action calls `chain.switchTarget`, then `unstable_update`. The `jwt` callback
    accepts the requested id only if it is a DB membership (`lib/activeRestaurant.ts`).
  - Checked in Playwright: switching to Jerusalem changed the header and every page.
- **`/dashboard/chain`** shows:
  - KPIs: chain leak ₪ with a 6-month sparkline and Δ against last month; % of spend;
    caught before payment and claimed back; pending approvals.
  - A worst-branch callout (highest leak %) with a "go to branch" button.
  - A ranking table: leak ₪, leak %, spend, open discrepancies, ₪ trend against the previous
    month, and switch-in buttons.
  - A branch × month heatmap.
  - Top suppliers across branches, merged by ח.פ digits, else by normalized name.
  - A local month selector (this month / last month / any month).

  Demo, 2026-10-18: **₪1,693 = 1.8 % of ₪94,743**. Worst branch: Jerusalem, 3.1 %. Last month:
  ₪2,064.
- **`/dashboard/branches`** (owner only):
  - list, inline rename, and switch;
  - "open a new branch", which can copy suppliers, the catalog and price lists, and the
    tolerance/approval settings;
  - the plan line ("Chain · 3 of 5"). If the restaurant has no billing account or is not on the
    chain plan, `EntitlementUpsell` shows instead; at the plan limit a limit notice shows.
- **Nav:** owners with more than one branch get a **Chain** tab; single-branch owners get a
  **Branches** tab (discovery and upsell). Only one of the two shows, so the tab row still fits.
  `ROUTE_ROLES` makes both routes owner-only, and the middleware sends a manager on
  `/dashboard/chain` to `/dashboard` (verified).
- **Both languages:** every string lives in the new `chain` namespace (he is the source, en is a
  typed `Shape`; the i18n parity test passes). Layout uses logical classes. ₪ goes through
  `formatIls`, and dates and percents through `lib/i18n/format`. Screenshots:
  `docs/client-ready/screenshots/chain-*.png`, in he + en for desktop, mobile and the mobile drawer.
- **Demo data:** `seed-chain-demo`. Haifa is 0.8 % (₪339 / ₪40,934) and Jerusalem is 3.1 %
  (₪782 / ₪25,420). The main branch is **unchanged at ₪572 = 2.0 % of ₪28,389**; the script
  throws if it ever moves. Re-runs are idempotent, and the leak canary was not touched.
  Documented in `docs/DB-RUNBOOK.md`.

## Security model

| Rule | Where | Test |
|---|---|---|
| Only the caller's own memberships are visible | `myMembershipRows` → `withUser` (RLS `memberships_self` + `restaurants_member_select`) | `chain.attack.test.ts` |
| Chain = **owner** branches on the active billing account; a manager-only branch is excluded; another billing account is a separate chain | `chainScopeOf` (pure) | pure tests + attack tests (A sees A + A2 = ₪140; never B, M or X) |
| Active branch must be owned, judged by DB membership, not the session | `chainScopeOf` | a forged session `restaurantId` = B gives FORBIDDEN |
| Numbers are computed per branch, under that branch's RLS | `inBranch` = `withRestaurant` + user GUC | totals/rows/suppliers exclude B, M, X (app role) |
| A client restaurant id is only used if it is in the RLS-derived set; otherwise NOT_FOUND | `switchTarget`, `renameBranch` | switching to or renaming B or M is rejected and names are unchanged |
| Session switch accepts DB memberships only | `jwt` callback + `pickActiveMembership` | `activeRestaurant.test.ts` |
| Add branch: owner only, and only the **billing account's payer** (`billing_accounts.owner_user_id`), within the plan limit; copies only the source branch's rows | `addBranch`: GUC = source for reads, then GUC = new uuid for writes, in one transaction. The limit is re-counted inside the transaction under `pg_advisory_xact_lock(account)` | limit, manager, no-billing-account and **non-payer co-owner (B)** cases are FORBIDDEN; 3 concurrent adds with room for 2 → exactly 2 succeed; copies = "ספק A" only |

An independent read-only review by the tenant-security-warden agent found **no cross-tenant read or
write path**. It did confirm two billing/authorization gaps, and both are fixed with tests:

- A co-owner on a shared account could bill new branches to the payer.
- Concurrent `addBranch` calls could race past the limit.

## Fixed

- `seed-demo.ts` picked `restaurants … limit(1)` with no ORDER BY. Once branches exist it could
  have re-seeded a branch instead of the main restaurant. It now picks the oldest restaurant.
- `test/appRouterShape.test.ts` now lists the new `chain` router.

## Not done / limitations

- **The plan limit counts only the restaurants on the account that the payer is a member of**
  (RLS-visible). A branch on the account where the payer has no membership is not counted. That
  can't happen through `addBranch`, which always makes the payer an owner; it needs an admin-made
  branch. An exact count needs a SECURITY DEFINER function (a new migration). Proposed, not built.
- In `next dev` on a cold compile, a transient React hydration-attribute warning appeared twice.
  It did not reproduce on a warm server across three further runs (0 console errors).
- Trend vs. previous month compares month-to-date with the full previous month (same as the
  overview hero).
- `addBranch` copies settings JSON, VAT and timezone, but not the `approval_rules` rows or
  product aliases.
- The heatmap shows 6 months. The demo history is about 10 weeks, so May–July show "—".
- The period control is deliberately simple, so S9's shared view controls can replace it.

## Proposals (value / effort)

1. A chain-level leak report PDF (one page per branch plus totals). High value, medium effort.
2. A per-branch manager digest ("your branch leaked X; the chain average is Y"). High / low.
3. A chain-wide price comparison: the same product from the same supplier at different prices in
   different branches. Very high / medium (needs product matching across branches).
4. A SECURITY DEFINER `billing_account_restaurant_count()` for an exact plan limit. Low effort.

## Immutable / shared files touched

- `apps/web/auth.ts` (S4): in the jwt callback, the active-restaurant pick moved to
  `pickActiveMembership` and now honours `activeRestaurantId` **only for DB memberships**.
- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: COVERAGE entries **added** (no
  assertion changed).
- `packages/api/src/index.ts`: registered `chain` (plus exports).
- `packages/api/src/audit.ts`: two audit actions **added** (`chain.branch_added`,
  `chain.branch_renamed`).
- `packages/charts/src/index.ts`: re-exports `chain.ts`.
- `apps/web/app/dashboard/{layout,nav}.tsx`, `lib/roles.ts` and the `nav` messages (S5/S4):
  switcher and tabs.
- `apps/worker/scripts/seed-demo.ts`, `scripts/dev-setup.sh` (S1): restaurant pick + chain seed step.
- `apps/web/lib/i18n/messages/index.ts`: registered the `chain` namespace.
- No engine, schema, RLS, plans or billing file was touched.

## Needs another area

- **S9:** replace `apps/web/app/dashboard/chain/month-selector.tsx` with the shared view controls.
- **S5:** with 11 desktop tabs, the English row is near full width. Consider a "More" overflow.
- **S7:** the e2e smoke test may want a switcher step (`data-testid="branch-switcher"`).

## Gate (final head)

| Check | Command | Result |
|---|---|---|
| Migrate the test DB | `DATABASE_URL=$DATABASE_URL_TEST pnpm --filter @restomatch/db migrate` | ok |
| Full suite | `DATABASE_URL_TEST=… pnpm test` | **13/13 tasks green**: api 517 (incl. `chain.attack` 24), web 204, charts 43 (incl. `chain` 10), db 59, matching 86 (leak canary untouched), worker 11 (+1 skipped), others green |
| Web typecheck | `pnpm --filter @restomatch/web exec tsc --noEmit -p .` | **0 errors** |
| Web lint | `cd apps/web && pnpm exec next lint` | **0 errors** (only warnings that were already there, none in S8 files) |
| Production build | `cd apps/web && set -a && . ./.env.local && set +a && pnpm build` | **green**: `/dashboard/chain` and `/dashboard/branches` built |
| Supabase sync | `pnpm db:supabase-sync --check` | up to date (39 files; no migration) |
| Demo seed | `seed` → `seed-demo` → `seed-chain-demo`, run twice | idempotent; main branch ₪572 / 2.0 % unchanged |
| Click-through | Playwright against `next dev`, he + en, desktop + 390 px | `docs/client-ready/screenshots/chain-*.png` (dashboard, previous month, switcher, branches, switched-into-Jerusalem, mobile + drawer, manager switcher); the manager is redirected from `/dashboard/chain` |
