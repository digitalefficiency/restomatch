/**
 * The product's own label keys this sample home reuses (the hero split by
 * payment status, the Needs-you "decide" row). Exported so the unit test
 * checks the showcase never copies or rewords them.
 */
export const PRODUCT_LABEL_KEYS = {
  split: 'hero.split',
  unpaid: 'hero.unpaid',
  paid: 'hero.paid',
  needsTitle: 'needs.title',
  needsMore: 'needs.more',
  decideLabel: 'needs.decide.label',
  decideSub: 'needs.decide.sub',
  decideVerb: 'needs.decide.verb',
} as const;
