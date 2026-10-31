import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  toggle: {
    why: 'Why?',
    details: 'Details',
    how: 'How we got this',
  },
  threeWayMatch: 'Every invoice is checked against the order and the goods receipt. Without an order there is nothing to check it against.',
  leakRule:
    'Counts warning- and blocker-level discrepancies, capped at each invoice total. Not counted: "Price below expected", "Waiting for a PO link" and "Ordered line not billed".',
  pendingLink: 'Usually a consolidated invoice waiting to be linked. Until then its amount stays out of the checked spend.',
  creepHow:
    "Flagged when the latest price is in the supplier's top 10% and at least 5% above the usual price. Excess = (price − usual price) × quantity over 30 days.",
  reviewNotGap: 'A line to check is not a discrepancy. Mark it by what arrived.',
  possibleDuplicate: 'This invoice number already exists for the supplier. It will be checked before payment.',
  englishName: 'Shown to staff who work in English. Matching and exports stay on the Hebrew name.',
  foodCostTwoCounts: 'Actual food cost is calculated between two counts.',
  notInLeak: 'not part of the leak',
  capBadge: 'Capped at the invoice total',
  caught: 'can still be stopped before payment',
  inLetter: 'The letter holds only gaps approved for a claim and not yet sent.',
  noSendWithoutTap: 'Nothing reaches the supplier until you press send.',
  amountAfterClose: 'The amount is set once the goods receipt is closed.',
  viewOnly: 'View only',
  leakAfterFirstMatch: 'The leak is calculated once an invoice is matched to its order and goods receipt.',
  thinBase: 'Too little data for a percentage.',
};
