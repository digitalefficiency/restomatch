# Chain & branches — design note (S8)

Owner ask: "split into branches, and above them a chain dashboard". **No schema change** — the
existing `restaurants.billing_account_id`, `memberships`, `plans.limits.restaurants` and the RLS
policies carry everything.

## Data rules

| Concept | Definition |
|---|---|
| **Branch** | a `restaurants` row. Every existing per-restaurant screen stays a per-branch screen. |
| **Chain anchor** | the *active* restaurant's `billing_account_id` (read under RLS, never from input). |
| **Chain of a user** | restaurants where the caller has a membership with **role = `owner`** AND `billing_account_id = anchor`. No billing account ⇒ the chain is just the active branch. |
| **Who may use `chain.*`** | the caller must be `owner` of the active branch (DB membership, not the session role). |
| **Switcher** | lists **every** membership (any role, any account) — switching is per-membership, not per-chain. |

Why owner **and** same billing account: an owner of two unrelated businesses never sees them summed;
a branch where the caller is only a `manager` contributes nothing to the owner-level chain numbers
(they still switch into it and see what their role allows there).

## Trust boundary

1. **Membership lookup** runs in `withUser(db, userId)` → only `memberships_self` +
   `restaurants_member_select` rows are visible: the caller's own memberships.
2. **Every chain number** is computed per branch in its own `withRestaurant(db, rid)` transaction
   (+ `app.current_user_id`), using the existing charts SQL (`computeLeakReport`,
   `computeLeakHero`, `computeOwnerKpis`). There is no cross-tenant SQL; the aggregation over
   branches is a pure TS function (`aggregateChain`, `packages/charts/src/chain.ts`).
3. **Client-supplied restaurant ids** (`switchTarget`, `renameBranch`) are accepted only when they
   are in the RLS-derived set (the owner chain for rename, any membership for switching); otherwise
   `NOT_FOUND` (no existence oracle).
4. **Switching** = server action → `chain.switchTarget` (RLS membership check) → `unstable_update`
   → the `jwt` callback re-reads memberships on the auth connection and accepts the requested id
   **only if it is one of the user's memberships**. A hand-crafted POST to the session endpoint
   therefore cannot select a foreign tenant. The session `restaurantId` then drives the existing
   `withRestaurant` GUC for every procedure.
5. **Add branch** = one transaction: GUC = source branch (read settings / suppliers / catalog), then
   GUC = new uuid (insert restaurant with the anchor billing account, owner membership, storage
   namespace, copies). Everything written satisfies `restaurant_id = GUC`.

## Plan gating (existing entitlements)

- Chain dashboard: `planKey = 'chain'` **or** > 1 chain branch; otherwise the `EntitlementUpsell`.
- Add branch: active entitlements **and** a billing account **and**
  `chainBranches < limits.restaurants` (null = unlimited); otherwise `ENTITLEMENT_REQUIRED:chain`.
  The count is RLS-visible owner branches on the account (documented limitation: a branch on the
  same account that the caller is not a member of is not counted).

## Query plan / perf

Per branch: leak report (4 statements, includes the month hero) + 5 previous-month heroes for the
6-month heatmap/trend + owner KPIs (4) + supplier ids (1) ≈ 14 indexed statements (<1 ms each on the
demo data). Branches run **3 at a time** (pool `max: 10`), hard cap **25 branches** (`truncated`
flag beyond that; the chain plan allows 5).

## Supplier merge across branches

Same supplier = same digits-only business id; else the same normalized name (NFKC, lower-case,
quotes/punctuation and the `בע"מ` / `ltd` suffix stripped, whitespace collapsed). Only rows each
branch could read under its own RLS scope participate.

## Price disparity across branches (feature flag `priceDisparity`)

Same supplier (ח.פ digits, else normalized name) + same product (supplier SKU, else normalized
name **and** unit) bought by ≥ 2 chain branches in the month at different average prices
(Σ line total ÷ Σ qty). Shown only when the gap is ≥ 3 % and the monthly impact
(Σ (branch price − chain-best price) × branch qty) is ≥ ₪5. Each branch's lines are read inside its
own `withRestaurant` transaction (`computeBranchPriceLines`); the comparison is pure
(`computePriceDisparities`, `packages/charts/src/chain-disparity.ts`). The match method is labelled
(`sku` / `name`). Gating: the chain view needs the plan rule **or** `featureEnabled(settings,'chain')`;
the disparity panel needs `featureEnabled(activeBranch.settings,'priceDisparity')`.
