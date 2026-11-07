// Shape of CoverageFragment (coverage/index.ts, W2-01 #180); typed locally until #180 is on main.
const coverage: Readonly<Record<string, string>> = {
  'recovery.suggestAllocation':
    "attack — w3-11.attack.test.ts: B's supplier id → NOT_FOUND; A's candidates never contain B's claim; receiver/chef FORBIDDEN",
  'suppliers.reconcileStatement':
    "attack — w3-11.attack.test.ts: B's supplier id → NOT_FOUND; B's invoice number and credit note never match A's statement; receiver/chef FORBIDDEN",
};
export default coverage;
