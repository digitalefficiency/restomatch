/**
 * W3-04 COVERAGE fragment (slice a). No new tRPC procedure: `search.global`
 * keeps its base entry ('isolation', cross-tenant.attack.test.ts), and a
 * fragment may never repeat a base key. Its W3-04 change (server role filter,
 * add-only `orders` + `recipes` kinds) is pinned in search-roles.test.ts:
 * tenant scope for both new kinds, receiver → no records, chef → orders and
 * recipes only, bookkeeper → no kitchen records, no ₪ field in any row.
 * Slice b adds `ask.*` entries here.
 */
const fragment: Readonly<Record<string, string>> = {};
export default fragment;
