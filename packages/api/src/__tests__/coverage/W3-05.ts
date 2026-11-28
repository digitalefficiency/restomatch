import type { CoverageFragment } from './index';

/** W3-05 month close + accountant desk. */
const coverage: CoverageFragment = {
  'close.checklist':
    "isolation — close.test.ts: every case seeds tenant B (invoices, consolidated, delivery notes with B's ledger on); A's figures never include B's rows",
  'exports.preview':
    "isolation — exports-preview.test.ts: tenant B's preview holds only B's rows and none of A's invoice ids, in any excluded group",
};
export default coverage;
