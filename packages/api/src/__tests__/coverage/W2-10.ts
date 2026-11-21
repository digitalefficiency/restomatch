import type { CoverageFragment } from './index';

/** W2-10 · claims composer + recovery desk: letters, guarded send / take-back, reminder drafts, export. */
const coverage: CoverageFragment = {
  'recovery.letters': 'isolation — recovery-letters.attack.test.ts: a foreign supplierId returns no letter; letters hold only the caller restaurant claims',
  'recovery.sendLetter': 'attack — recovery-letters.attack.test.ts: a foreign supplierId or claimId is NOT_FOUND and no claim of either tenant moves',
  'recovery.unsendLetter': 'attack — recovery-letters.attack.test.ts: a foreign claimId is NOT_FOUND and the foreign claim stays letter_sent',
  'recovery.reminderDraft': 'attack — recovery-letters.attack.test.ts: a foreign supplierId is NOT_FOUND (no name, contact or ₪ leaks)',
  'recovery.export': 'isolation — recovery-letters.attack.test.ts: the export of tenant A never contains a tenant B claim id or supplier',
};
export default coverage;
