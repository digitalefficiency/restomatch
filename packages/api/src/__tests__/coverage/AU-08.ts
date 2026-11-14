// AU-08 (A13) — allocation-number guard and chase. Add-only fragment (W2-01 pattern);
// typed locally so it compiles before coverage/index.ts lands on main.
const coverage: Record<string, string> = {
  'vat.invoiceCase':
    "attack — vat-allocation.attack.test.ts: A reading B's invoiceId → NOT_FOUND; receiver/chef FORBIDDEN",
  'vat.requestDraft':
    "attack — vat-allocation.attack.test.ts: A drafting for B's supplierId → NOT_FOUND, no B invoice or contact leaks; receiver/chef FORBIDDEN",
  'vat.setAllocationNumber':
    "attack — vat-allocation.attack.test.ts: A setting B's invoiceId → NOT_FOUND, B's allocation_number untouched, no audit row; manager/receiver/chef FORBIDDEN",
  'vat.markRequested':
    "attack — vat-allocation.attack.test.ts: A marking B's supplier/invoices → NOT_FOUND, no audit row in B; manager/receiver/chef FORBIDDEN",
};
export default coverage;
