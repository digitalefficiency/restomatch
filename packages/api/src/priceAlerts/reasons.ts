/**
 * W2-12 dismiss reasons for price alerts ("דחו ▾": מחיר מוסכם חדש · טעות בחשבונית
 * · חד-פעמי · אחר). There is no reason column (schema is immutable; H-04
 * proposal), so a reason lives only in the audit row — and the audit values
 * `price_alert.dismissed` / `price_alert.reopened` arrive with G-05's PR (a).
 * Until then the server flag PRICE_ALERT_REASONS stays OFF: the UI shows a
 * plain dismiss (still with undo) and the server records no reason.
 */
export const DISMISS_REASONS = ['new_agreed_price', 'invoice_error', 'one_off', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/** Server flag, default off. TODO(G-05): drop once the AuditAction values are on main. */
export function priceAlertReasonsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRICE_ALERT_REASONS === '1' || env.PRICE_ALERT_REASONS === 'true';
}
