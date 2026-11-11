import type { CoverageFragment } from './index';

/** AU-03 (A12) COVERAGE fragment: the credit-suggestion procedures (see ./README.md). */
const coverage: CoverageFragment = {
  'recovery.creditSuggestions':
    "isolation — recovery-credit-suggest.test.ts: A's suggestions never contain B's credit line; receiver/chef FORBIDDEN; flag off FEATURE_DISABLED; read-only (no credit note, no status change)",
  'recovery.confirmCreditSuggestion':
    "attack — recovery-credit-suggest.test.ts: B's invoiceLineId or B's claimId from A's session → NOT_FOUND, B's claim and credit notes untouched; another supplier's claim → BAD_REQUEST supplier_mismatch",
};
export default coverage;
