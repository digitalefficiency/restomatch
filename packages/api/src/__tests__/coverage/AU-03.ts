/**
 * AU-03 COVERAGE fragment (W2-01 mechanism, #180). Until #180 merges the
 * cross-tenant suite does not read fragments; the completeness red that waits
 * on #180 is expected (KICKOFF-0711 §1.6).
 */
const coverage: Readonly<Record<string, string>> = {
  'recovery.creditSuggestions':
    "isolation — recovery-credit-suggest.test.ts: A's suggestions never contain B's credit line; receiver/chef FORBIDDEN; flag off FEATURE_DISABLED; read-only (no credit note, no status change)",
  'recovery.confirmCreditSuggestion':
    "attack — recovery-credit-suggest.test.ts: B's invoiceLineId or B's claimId from A's session → NOT_FOUND, B's claim and credit notes untouched; another supplier's claim → BAD_REQUEST supplier_mismatch",
};
export default coverage;
