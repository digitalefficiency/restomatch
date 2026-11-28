import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'ingest.resolvePageFlag':
    "attack — ingest-grouping.test.ts: a foreign restaurant's document → NOT_FOUND (A's flag and invoice untouched); receiver → FORBIDDEN",
  'ingest.pageQuestionOf':
    "isolation — ingest-grouping.test.ts: B asking about A's flagged invoice gets null; A gets its own page question",
};
export default coverage;
