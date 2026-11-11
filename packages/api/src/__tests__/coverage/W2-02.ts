import type { CoverageFragment } from './index';

/** W2-02: invoice register, cockpit and intake preview / bulk approve. */
const coverage: CoverageFragment = {
  'invoices.list': "isolation — invoices-register.test.ts: A's register lists only A's invoices, never B's; receiver/chef FORBIDDEN",
  'invoices.counts': "isolation — invoices-register.test.ts: A's tab counts equal A's own list counts, B's invoices never counted",
  'invoices.detail': "attack — invoices-detail.test.ts: A asking for B's invoice id → NOT_FOUND; receiver gets no ₪, chef FORBIDDEN",
  'ingest.documentPreview': "attack — ingest.attack.test.ts: A previewing B's document id → NOT_FOUND and no URL; receiver/chef FORBIDDEN",
  'ingest.bulkApprove': "attack — ingest.attack.test.ts: a batch holding B's document id → NOT_FOUND, nothing of A or B registered",
};
export default coverage;
