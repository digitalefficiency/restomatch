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

---

# Follow-up rounds (after PR #38 merged)

Branch `claude/client-ready-chain`, restarted from `claude/client-ready` @ 8289ce1. The two
commits that were pushed after the merge (`efe7657` and `a48d672`) were rebased onto it.

## What changed

| Area | Change | Tests |
|---|---|---|
| **Price disparity across branches** (flag `priceDisparity`) | The same supplier (by ח.פ) and the same product (by SKU, else by name and unit) at different average prices across branches. Shown only for a gap ≥ 3 % and ≥ ₪5/month. Impact = (price − the chain's best price) × qty. Each row drills into its invoice lines and shows the match method. **Lines the engine already flagged as a price error are excluded**: those are leak, not a branch price, and the refuter caught them showing up as fake gaps. Seeded: Jerusalem pays +12 % for tomatoes and +7 % for salmon; Haifa pays +6 % for entrecôte. | `chain-disparity.test.ts` (6); `chain.attack` (B's prices are never compared; a flagged line is excluded) |
| **Shared view controls** | `/dashboard/chain` now uses S3's `ViewToolbar` (period, custom range, compare, saved views, ranking CSV) in place of the local month selector. `chain.overview({ view, compare })` uses its own `ChainViewInput`, which is strict and rejects filters. Each branch still runs in its own `withRestaurant` transaction (`computeLeakSummary`, plus the per-supplier and open-count SQL over `viewInvoicesSql`). **The disparity panel follows the selected range.** The KPIs and the ranking show the comparison when `cmp` ≠ off. The heatmap highlights the months in the period. | `chain.test.ts` (compare on/off, bounds, `monthOfPeriodEnd`); `chain.attack` (custom/last_month/last_12m, compare=prev, malformed view, filters rejected) |
| **Non-payer `addBranch`** (S4 UX note) | A co-owner on someone else's billing account now gets `NOT_BILLING_OWNER` **before** the plan gate. The UI says "only the account payer can open new branches" (he + en) on the branches page and in the action error, never the plan upsell. | `chain.attack` (stable message); Layer 2 (he + en UI) |
| **Feature flags** | The chain view is shown when the plan rule passes **or** `featureEnabled('chain')`; the disparity panel needs `featureEnabled('priceDisparity')`. | `chain.attack` |
| **Production navigation** | Branch switch, add branch and rename use document navigations or local state. **Shared `ViewToolbar` fallback (S3's file):** if a soft `router.replace` hasn't committed within 1.2 s, it calls `location.assign`. See "Platform bug". | Layer 2; stall rate measured before and after |
| **Review fixes** | A fresh login lands in the **oldest** membership (it used to be any row). The switcher order is stable (main branch first). The Chain tab follows the router's rule. The active branch always stays inside the 25-branch cap. `בע"מ` is stripped only as a whole word. Drill-down rows are keyed by line id. A thrown action no longer leaves a spinner. | unit + Layer 2 |

## Platform bug (reported to the orchestrator)

**Symptom:** in `next build` + `next start` (Next 15.5.25), a same-route soft navigation that only
changes search params frequently never commits. The URL and the controlled `<select>` revert.

**Measured over 6 tries each with Playwright:**

| Page | No delay | 1.5 s pause first |
|---|---|---|
| `/dashboard` (S3's overview) | 4/6 stalled | 2/6 stalled |
| `/dashboard/chain` | 6/6 stalled | 5/6 stalled |

**Ruled out:**
- The server: the RSC GET returns 200 `text/x-component` in under 130 ms, and a replay with the browser's exact headers completes.
- Prefetch: aborting every prefetch changes nothing.
- `AbortController` / `pagehide`: never fired.
- Console and page errors: none at the moment of the stall.

**What happens:** the body is dropped (`net::ERR_ABORTED`) about 100 ms after the headers arrive.
React or Next abandons the transition.

**With the toolbar fallback:** 0/6 stalls on both pages. The root cause is still open and needs S7 /
an upgrade.

## Verification (2 layers), final head

**Layer 1** (all green):

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `DATABASE_URL=$DATABASE_URL_TEST pnpm --filter @restomatch/db migrate` | 0 |
| `pnpm exec turbo test --concurrency=1` | **13/13**: api 533, web 246, charts 68, db 63, matching 86 (canary untouched), worker 11 (+1 skipped), others green |
| `pnpm exec turbo typecheck` | **17/17** |
| `pnpm --filter @restomatch/web exec tsc --noEmit -p .` | **0 errors** |
| `cd apps/web && pnpm exec next lint` | **0 errors** |
| `pnpm --filter @restomatch/db run supabase-sync --check` | up to date (41 files; this branch adds no migration) |
| `pnpm build` (apps/web) | green |

**Demo seed on the merged base:** `seed` → `seed-demo` → `seed-chain-demo` keeps the main branch
**unchanged at ₪572 = 2.0 % of ₪28,389** (asserted by the script). Haifa is 0.8 % and Jerusalem 3.1 %.

**Layer 2(a):** production build (`next build && next start`, `NODE_ENV=production`) on a freshly
migrated and seeded DB.
- The app role is in `DATABASE_URL_APP`, with placeholder `RESEND_API_KEY` / `EMAIL_FROM` /
  `SUPABASE_SERVICE_ROLE_KEY`, and the demo password login.
- Playwright runs every chain flow in he **and** en for owner, manager, receiver, bookkeeper and
  chef. It asserts:
  - HTTP < 400, `<html lang/dir>`, the main hero ₪572 / 2 %, chain ₪1,69x, worst branch Jerusalem 3.1 %;
  - disparity impacts **131 / 125 / 33** this month and **251 / 247 / 48** last month (the panel follows the period);
  - compare=prev shows the deltas;
  - the switch both ways shows ₪782 and then ₪572, with a stable switcher order;
  - add and rename persist;
  - the non-payer message in he and en with no upsell;
  - the manager, receiver, bookkeeper and chef get no Chain/Branches tab and are redirected;
  - the mobile drawer works with no horizontal scroll;
  - a forged session POST is ignored (same `restaurantId`, header unchanged).

| Pass | Result | Log |
|---|---|---|
| 1 | **128/128** | `reports/chain-layer2-pass1.log` |
| 2 | 127/128 | `reports/chain-layer2-pass2.log` |
| 3 | 127/128 | `reports/chain-layer2-pass3.log` |

**The one failure in passes 2 and 3:** an intermittent **React #418 hydration error**, followed by
`parentNode` errors. It appeared once per pass, on a page reached by a document navigation
(`/dashboard` after the manager's branch switch; `/dashboard/chain?p=last_month&cmp=prev` after
toolbar changes).
- It did not reproduce in about 100 targeted production loads (36 toolbar sequences instrumented
  with per-document ids) or in about 70 `next dev` loads.
- Working hypothesis, not proven: the old document is torn down while React is committing a late
  soft navigation.
- No functional impact was observed: every number and flow assertion passed in those same passes.
- **Not fixed. Open.** It goes away together with the platform bug above.

The server log showed 0 errors and no 5xx in every pass.

**Layer 2(b), independent refuter** (fresh agent, diff plus evidence): it found no isolation,
authorization or double-counting hole.

Confirmed and **fixed** in `15d3f11`:
1. Labels still said "this month" after the panels started following the period. The copy is now
   period-neutral (he + en).
2. An empty comparison period showed "▲ the whole leak" per branch next to a "—" KPI. It now shows
   no delta. A unit test and an attack test cover this.

Also fixed: the heatmap no longer runs into future months.

Minor findings, documented and not fixed:
- About half of toolbar changes end up as a full reload through the fallback. The content always
  matches a fresh load.
- The fallback also fires for a soft navigation that is slow (> 1.2 s) but would have worked.
- The heatmap uses the Asia/Jerusalem timezone rather than each branch's own.
- The switcher puts the main branch first only because of name order.
- The Layer-2 `waitForURL` checks can't tell a soft navigation from the fallback.

**Final pass on `15d3f11`** (production build, fresh seed):
- Layer 1 green: 13/13 tests (charts 69, api 533, web 246), typecheck 17/17, tsc 0, lint 0,
  supabase-sync up to date.
- Layer 2 **134/134** (`reports/chain-layer2-final.log`), with 0 console errors and 0 server errors.
- Toolbar period changes went **6/6 on `/dashboard` and on `/dashboard/chain`, in he and in en**.

## Demo hardening (2026-10-24, DEMO_TODAY=2026-10-25)

**QA run:** local seed, `next start`, Playwright, he + en.

- **Per-branch numbers.** Each branch's ₪ leak, % and spend on `/dashboard/chain` equal that branch's own owner dashboard, after switching to it, for:
  - 6 periods: this month, last month, quarter, ytd, 12 months, and a custom range;
  - 3 compare modes: off, prev, yoy;
  - all 3 branches.

  Chain totals equal Σ branches. Result: 190/190.
- **Compare and heatmap.** The `cmp=prev` per-branch delta equals the dashboard delta. The heatmap ends at the period's end month. The worst branch is picked by leak %.
- **Branch switching** at 1366 (header) and 390 (drawer list), plus the chain-row "go to branch" button. Every page has the right html lang/dir, zero console errors, zero 5xx and no horizontal scroll. Result: 202/202.

**Fixed: phone width (390).**
- The ranking table scrolled sideways, with the % column off-screen.
- The heatmap opened on its oldest, empty months.
- The suppliers table was clipped.

Below `sm`, the tables now keep only the key columns:
- the ranking shows branch, ₪, % and trend, with the switch action under the name;
- the heatmap shows the last 3 months;
- each supplier's branches appear under its name.

From `sm` up, nothing changed.

**New: `chainAlerts` flag**, "branch to look at this week".
- `chain.alerts`, last 7 Israel-local days:
  - per branch, inside its own `withRestaurant`, it reuses the existing `computeLeakSummary` + `computeLeakGrouped(type)`;
  - the focus branch is the one with the most leak ₪, at ≥ ₪50;
  - the main driver of each branch is its top discrepancy type and ₪.
- No new charts SQL.
- With the flag off, the card is absent and nothing extra is computed.
- The seeded demo tenant has `features.all`, so the card shows in the demo.
- QA: each branch's week ₪ equals its own dashboard for the same custom range, and its driver ₪ equals the leak explorer's by-type row. Checked in he and en, at 1366 and 390, with zero console errors.
- Tests: chain.attack +6 (flag off; A + A2 only, with B/M/X never in the payload; the active branch's flag decides; manager and forged session get FORBIDDEN; the pure window and focus rules). One COVERAGE entry added.

**Immutable files touched:** none. `cross-tenant.attack.test.ts` only gained one COVERAGE entry, which AGENTS.md allows; no assertion was removed or weakened.
