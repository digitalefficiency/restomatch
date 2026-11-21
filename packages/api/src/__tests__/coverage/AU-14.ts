import type { CoverageFragment } from './index';

/** AU-14 · pay-run pre-flight + supplier payment note (probes in payrun.attack.test.ts and payrun-preflight.db.test.ts). */
const coverage: CoverageFragment = {
  'payRun.preflight':
    "isolation — payrun.attack.test.ts + payrun-preflight.db.test.ts: A's flags never include B's invoices, suppliers or ₪ (also with B's ids passed in invoiceIds); receiver/chef FORBIDDEN",
  'payRun.remittanceText':
    "attack — payrun.attack.test.ts + payrun-preflight.db.test.ts: a foreign supplierId, or B's invoiceId alone or mixed with A's → NOT_FOUND with the same message as an unknown id; receiver/chef FORBIDDEN; zero outbox rows",
};
export default coverage;
