/**
 * W2-12 COVERAGE fragment (contracts queue + price intelligence). Loaded by
 * coverage/index.ts once W2-01 (#180) is on the base; until then the base
 * completeness test reports these keys as undeclared (expected, GREEN-pending-#180).
 * Changed base procedures (contracts.importCommit excludeRowIds,
 * priceAlerts.dismiss reason) keep their base entries and are attacked in the
 * same file.
 */
const W2_12 = {
  'contracts.queue':
    'attack — contracts-w2-12.attack.test.ts: tenant B sees none of A’s over-contract lines, alerts or ₪; receiver/chef FORBIDDEN',
  'contracts.priceContext':
    'attack — contracts-w2-12.attack.test.ts: A’s supplier or product from B → NOT_FOUND; receiver/chef FORBIDDEN',
  'contracts.lockCurrentPrices':
    'attack — contracts-w2-12.attack.test.ts: A’s supplier from B → NOT_FOUND (dry run and write), A’s rows unchanged; non-managers FORBIDDEN',
  'contracts.adoptPrice':
    'attack — contracts-w2-12.attack.test.ts: A’s supplier or product from B → NOT_FOUND, A’s rows unchanged; non-managers FORBIDDEN',
  'contracts.importDiff':
    'attack — contracts-w2-12.attack.test.ts: A’s supplier from B → NOT_FOUND; B’s own diff never resolves A’s products or prices; non-managers FORBIDDEN',
  'priceAlerts.previewThreshold':
    'attack — contracts-w2-12.attack.test.ts: B counts only its own history, A’s supplier → NOT_FOUND; receiver/chef FORBIDDEN',
  'priceAlerts.reopen':
    'attack — contracts-w2-12.attack.test.ts: A’s dismissed alert from B → NOT_FOUND, A unchanged; non-managers FORBIDDEN',
} as const;

export default W2_12;
