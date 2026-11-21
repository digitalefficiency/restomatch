import type { Shape } from '../../translate';

/**
 * Activity-feed strings added by W2-13 (`components.feed.*`). Kept apart from ./he.ts
 * so the complete receiver-locale overlays of ./he.ts (receiverLangs, W2-05) stay
 * untouched; wired in ./index.ts exactly like `ds`.
 */
export const feedHe = {
  /** Link to the invoice a feed row is about (accessible name). */
  openInvoice: 'לחשבונית {number}',
  /** Actor chip, when the feed carries who did it. */
  byActor: 'על ידי {actor}',
  /** Plural forms (the older `activity.discrepancies`/`toReview` keep `{count}` for the receiver overlays' type). */
  discrepancies: '{count, plural, one {פער אחד} two {שני פערים} other {# פערים}}',
  toReview: '{count, plural, one {פער אחד לבדיקה} two {שני פערים לבדיקה} other {# פערים לבדיקה}}',
};

export const feedEn: Shape<typeof feedHe> = {
  openInvoice: 'Open invoice {number}',
  byActor: 'by {actor}',
  discrepancies: '{count, plural, one {# discrepancy} other {# discrepancies}}',
  toReview: '{count, plural, one {# discrepancy to review} other {# discrepancies to review}}',
};
