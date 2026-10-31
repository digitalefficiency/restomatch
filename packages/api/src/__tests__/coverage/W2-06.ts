// W2-06 COVERAGE fragment. Loaded by W2-01's mergeCoverage() once it merges
// (until then it is inert; the base COVERAGE in cross-tenant.attack.test.ts is unchanged).
// `CoverageFragment` (= Record<string, string>) arrives with W2-01's ./index; typed locally until then.
type CoverageFragment = Record<string, string>;

const coverage: CoverageFragment = {
  'orders.orderGuide': "attack — orders-w2-06.attack.test.ts: A asking for B's supplier guide → NOT_FOUND, B untouched",
  'orders.supplierBoard': "isolation — orders-w2-06.attack.test.ts: A's board lists only A's suppliers, never B's POs or drafts",
  'orders.openDraft': "attack — orders-w2-06.attack.test.ts: A opening a draft for B's supplier → NOT_FOUND",
  'orders.saveDraft': "attack — orders-w2-06.attack.test.ts: B's supplierId, draftId or productId → NOT_FOUND, nothing written for A or B",
  'orders.prepareManualSend': "attack — orders-w2-06.attack.test.ts: B's poId → NOT_FOUND, no text of B's order",
  'orders.markSentManually': "attack — orders-w2-06.attack.test.ts: B's poId → NOT_FOUND, B's draft stays a draft",
  'orders.addOrderLine': "attack — orders-w2-06.attack.test.ts: B's poId or B's productId → NOT_FOUND, no line written",
  'orders.sendMany': "attack — orders-w2-06.attack.test.ts: B's poId in the batch → NOT_FOUND, nothing sent or queued",
  'orders.viewCounts': "isolation — orders-views.test.ts: A's view counts never include B's orders",
  'orders.threeWay': "attack — orders-three-way.test.ts: A asking for B's PO 3-way view → NOT_FOUND",
  'orders.amendSent': "attack — orders-w2-06.attack.test.ts: B's poId or productId → NOT_FOUND, no amendment text",
};
export default coverage;
