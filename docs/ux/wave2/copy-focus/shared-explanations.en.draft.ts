/**
 * shared-explanations.en.draft.ts — DRAFT (31.10.2026). The English value for every concept in
 * `shared-explanations.he.draft.ts` (same concept ids, same keys). Hebrew is the source of truth; i18n.test
 * enforces he/en key and placeholder parity once W2-16 turns this into `messages/explain/en.ts` and each
 * namespace owner applies Parts 2–3. Receiver languages (ar/ru/th/ti) are NOT drafted here: W2-16 adds the
 * `toggle` labels and every `receiverOverlay: true` concept to `explain.receiver.ts` (machine translation,
 * marked pending native review, reviewed by W2-05), and a missing one falls back to Hebrew, never English.
 */
import type { SharedConcept } from './shared-explanations.he.draft';

export const EXPLAIN_TOGGLES_EN = {
  why: 'Why?',
  details: 'Details',
  how: 'How we got this', // same words as overview.hero.howCalc (en)
} as const;

export const SHARED_EXPLANATIONS_EN = {
  // ── Part 1 · explain.* ──
  threeWayMatch: 'Every invoice is checked against the order and the goods receipt. Without an order there is nothing to check it against.',
  leakRule:
    'Counts warning- and blocker-level discrepancies, capped at each invoice total. Not counted: "Price below expected", "Waiting for a PO link" and "Ordered line not billed".',
  pendingLink: 'Usually a consolidated invoice waiting to be linked. Until then its amount stays out of the checked spend.',
  notInLeak: 'not part of the leak',
  creepHow: "Flagged when the latest price is in the supplier's top 10% and at least 5% above the usual price. Excess = (price − usual price) × quantity over 30 days.",
  capBadge: 'Capped at the invoice total',
  caught: 'can still be stopped before payment',
  inLetter: 'The letter holds only gaps approved for a claim and not yet sent.',
  noSendWithoutTap: 'Nothing reaches the supplier until you press send.',
  amountAfterClose: 'The amount is set once the goods receipt is closed.',
  reviewNotGap: 'A line to check is not a discrepancy. Mark it by what arrived.',
  possibleDuplicate: 'This invoice number already exists for the supplier. It will be checked before payment.',
  englishName: 'Shown to staff who work in English. Matching and exports stay on the Hebrew name.',
  viewOnly: 'View only',
  leakAfterFirstMatch: 'The leak is calculated once an invoice is matched to its order and goods receipt.',
  thinBase: 'Too little data for a percentage.',
  foodCostTwoCounts: 'Actual food cost is calculated between two counts.',

  // ── Part 2 · <ns>.explain.* ──
  rulesMore: 'An item on an invoice with no order is counted. Gaps within tolerance are not.',
  findingsCount: 'Findings on invoices waiting for a PO link still count in the leak.',
  vatAllocation: 'A tax invoice above the threshold needs an allocation number. You have 6 months to get a corrected invoice.',
  notPaidOrHeld: 'Until linked they are not counted as pay or hold.',
  payRunStatus: 'The status is what was marked in the app. Credit amounts match the credit-claim letters.',
  exportScope: 'Every checked invoice is included, discrepancies too. Invoices still being read, waiting consolidated invoices and duplicate copies are not.',
  rerunMatch: 'Fix lines that were read wrong, then re-run the match.',
  linkOnce: 'One link updates every line, and future orders are recognised automatically.',
  noFakeGaps: 'The rows were saved without a product link so no false discrepancies appear.',
  ruleOverrides: 'A supplier or category rule overrides the default.',
  lateAlert: 'If no goods receipt is recorded by the latest time, a late-delivery alert appears.',
  posLinkByName: 'The POS links to a dish by name, in Hebrew or English.',
  disparityMethod: 'Impact = (price − best price in the chain) × quantity in the period. Safe matches only, with a gap of at least 3%.',
  inviteRoles: 'A shift manager who receives goods: choose "Receiver". Staff who don\'t read Hebrew: choose English.',
  recoveryCodes: "Each code works once, when you can't reach the app.",
  roundedShekels: 'Shekels are rounded so the parts add up exactly to the amount claimed.',

  // ── Part 3 · canonical keys ──
  clean: 'No leak · {count} invoices checked ✓', // current en kept
  noCompare: 'No comparison data', // current en kept (he unchanged)
  savedOnPhone: 'Offline · saved on the phone', // current en kept
  sessionExpired: 'Sign in again — your work is saved.',
  errorRetry: 'Try again. If it keeps happening, send us the code.',
  notFoundPage: 'Wrong link, deleted page, or another branch.',
  notFoundItem: 'Not found — it may have been deleted.', // current en kept
  genericFail: 'Something went wrong. Please try again.', // current en kept
  network: 'No connection. Check your network and try again.', // current en kept
  rateLimit: 'Too many attempts. Wait a moment and try again.',
  forbidden: 'You don’t have permission to do that.', // current en kept
  invalidInput: 'Some fields are invalid. Please check and try again.', // current en kept
  magicLinkSent: 'We sent a sign-in link to {email}, valid for 24 hours.',
  linkExpired: 'This link expired or was already used. Request a new one.',
  devicesSignOut: 'All devices are signed out after the reset.',
  passwordPolicy: 'The password must be at least {min} characters.', // current en kept
  twoFactor: 'Recommended: a code from an authenticator app at every sign-in.',
  lastOwner: "You can't remove the last owner. Promote another owner first.",
  entitlement: 'Not included in your plan. Upgrade to use it.',
  fileTooLarge: 'The file is too large. Split it or save it as CSV.',
  fileLimitsLine: 'Excel or CSV, Hebrew files too · up to 9 MB',
  rowsDetected: 'Found {count} rows. Check the columns:',
  noPriceList: 'No price list for this supplier', // current en kept
  noSuppliers: 'No active suppliers yet.',
  recordOnly: "Don't send · record only",
  unpricedExcluded: 'Excludes {count} lines without a price', // current en kept
  outstanding: "Still owed to you (this month's invoices)", // current en kept (he: only לך → לכם)
  receiptClosed: 'This receipt is already closed', // current en kept
  bulkNotCounted: 'Not counted item by item', // current en kept
  othersWaiting: 'Nothing is waiting for you.',
  missingPrice: 'Some ingredients have no price yet', // current en kept
  notAfterLast: 'A count was already closed on {date}. Pick a later date.',
  billingOwner: 'Only the billing owner opens new branches.',
  branchLimit: "You've reached your plan's branch limit. Upgrade to add a branch.",
  askRateLimit: 'Lots of questions in a short time — wait a moment and ask again.', // current en kept
  poUnchanged: 'The order itself was not changed — check the differences.',
  vatAffectsLeak: 'VAT and the time zone affect the leak calculation. Make sure they are right.',
  belowNotFlagged: 'A gap smaller than this is not flagged.',
} as const satisfies Record<SharedConcept, string>;
