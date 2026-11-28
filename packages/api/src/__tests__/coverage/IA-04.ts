// INV-00 (the invoices area: the server reads and the words every screen shares). Add-only
// fragment (coverage/README.md). The file is named by a free package id the pattern accepts:
// `INV-00.ts` is refused by coverage/index.ts, and no IA-* fragment existed on main.
import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'invoices.holding':
    "isolation — invoice-area.attack.test.ts: A asking for B's invoice ids gets no entry for them; receiver/chef FORBIDDEN",
  'invoices.history':
    "attack — invoice-area.attack.test.ts: A reading B's invoiceId → NOT_FOUND; no userId/name/email key in the payload; receiver/chef FORBIDDEN",
  'approvals.decided':
    "isolation — invoice-area.attack.test.ts: A's decided list never holds one of B's gaps; receiver/chef FORBIDDEN",
};
export default coverage;
