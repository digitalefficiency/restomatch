import type { CoverageFragment } from './index';

/** W2-09 COVERAGE fragment (coverage/README.md): the owner.* procedures W2-09c adds. */
const coverage: CoverageFragment = {
  'owner.leakComparison':
    "isolation — owner-drivers.test.ts: A's comparison counts only A's invoices (B's ₪999 never appears); receiver/chef FORBIDDEN",
  'owner.leakDrivers':
    "isolation — owner-drivers.test.ts: A's drivers never name B's supplier or amount; Σ drivers + other = Δ; receiver/chef FORBIDDEN",
  'owner.leakReportExport':
    "isolation — owner-export.test.ts: A's XLSX/CSV never contain B's supplier or amounts; totals = the report; receiver/chef FORBIDDEN",
  'owner.lineHistory': 'attack — owner-evidence.test.ts: a foreign discrepancyId → NOT_FOUND',
};
export default coverage;
