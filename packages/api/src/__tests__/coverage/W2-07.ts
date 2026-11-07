// W2-07 COVERAGE fragment (W2-01 format). Typed inline: `CoverageFragment` from './index'
// is the same shape and lands with W2-01 (#180).
const coverage: Readonly<Record<string, string>> = {
  'inventory.setSales':
    "attack — inventory-rls.attack.test.ts: B setting sales on A's closed count → NOT_FOUND, A's sales untouched; inventory-sales.test.ts: manager+ only, audited",
  'inventory.submitForClose':
    "attack — inventory-rls.attack.test.ts: B submitting A's draft → NOT_FOUND, no audit row and no notification for A",
  'inventory.foodCostPercent':
    "attack — inventory-rls.attack.test.ts: B asking for the % period of A's closed count → notFound; no ₪ key for any role",
};
export default coverage;
