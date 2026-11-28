/**
 * W3-10 COVERAGE fragment (one "לקשר" queue), merged by coverage/index.ts.
 */
import type { CoverageFragment } from './index';

const W3_10: CoverageFragment = {
  'mapping.queue':
    'attack — catalog-w3-10.attack.test.ts: B’s unlinked lines, review rows and ₪ never list for A, even with B’s supplierId filter; chef / receiver FORBIDDEN, bookkeeper reads',
  'mapping.queueSummary':
    'attack — catalog-w3-10.attack.test.ts: counts and sums only the caller restaurant (B’s ₪ never in A’s total); chef / receiver FORBIDDEN, bookkeeper reads',
  'catalog.revertImport':
    'attack — catalog-import-revert.test.ts: B’s import id from A → NOT_FOUND and B’s rows untouched; chef / receiver / bookkeeper FORBIDDEN; a second revert → CONFLICT',
  'products.mergePreview':
    'attack — catalog-merge-preview.attack.test.ts: either product of B → NOT_FOUND from A, counts only A rows, writes nothing; chef / receiver / bookkeeper FORBIDDEN',
};

export default W3_10;
