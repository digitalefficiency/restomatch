/**
 * W2-11 COVERAGE fragment (supplier page overview + vendor table). Loaded by
 * coverage/index.ts once W2-01 (#180) is on the base; until then the base
 * completeness test reports these keys as undeclared (expected, GREEN-pending-#180).
 * The changed base procedures (suppliers.ledger / ledgerGrid → finance tier)
 * keep their base entries; the receiver FORBIDDEN is asserted in
 * supplier-ledger.db.test.ts.
 */
const W2_11 = {
  'suppliers.overview':
    'attack — supplier-overview.attack.test.ts: B’s supplierId from A → NOT_FOUND; receiver/chef FORBIDDEN (supplier-overview.test.ts)',
  'suppliers.table':
    'isolation — supplier-overview.attack.test.ts: A’s table lists only A’s suppliers (inactive included); receiver/chef FORBIDDEN',
} as const;

export default W2_11;
