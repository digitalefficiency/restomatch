/**
 * Owner G-14 Q2 (21.11): no "caught before payment" figure is shown anywhere until H-03 —
 * the real `invoices.paid_at` — is deployed. Today's figure is the old "invoice not marked
 * paid yet" rule, which the owner asked not to present as "נתפס לפני תשלום". Flip this (one
 * place) when H-03 lands and the screens read the G-14 ledger's day-based rule.
 */
export const SHOW_CAUGHT_BEFORE_PAYMENT = false;
