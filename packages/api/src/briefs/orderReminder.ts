import { orderNotPlacedEmail } from '../notifications/templates';
import { trimBase } from './links';
import type { BriefContext, BriefMessage } from './types';

/**
 * A5 · the 09:00 order reminder, truthful: a DRAFT is not an order. When the
 * supplier has an unsent draft the message links that draft; otherwise the
 * new-order wizard with the supplier picked. No ₪ (the chef is a recipient).
 * Rendered by W2-13's `orderNotPlacedEmail` (the one reviewed design).
 */
export interface OrderReminderInput extends BriefContext {
  ilDate: string;
  supplierId: string;
  supplierName: string;
  /** e.g. "יום ראשון". */
  orderDayLabel: string;
  /** The window's cut-off as printed ("16:00"), if any. */
  cutoffLabel?: string | null;
  /** The newest open draft PO for this supplier, if any. */
  draftPoId?: string | null;
}

/** The new-order wizard with the supplier picked (what the wizard reads: `?supplierId=`). */
export function newOrderPath(supplierId: string): string {
  return `/dashboard/orders/new?supplierId=${encodeURIComponent(supplierId)}`;
}

export function orderReminderBrief(input: OrderReminderInput): BriefMessage {
  const cutoff = input.cutoffLabel?.trim() || undefined;
  const draft = Boolean(input.draftPoId);
  const to = draft ? `/dashboard/orders/${encodeURIComponent(input.draftPoId!)}` : newOrderPath(input.supplierId);
  // Direct links, as today (brief AC 4: `orderReminderUrl` unchanged; the wizard
  // link is pinned by orderReminders.test.ts). The go-link swap is W2-04's sweep.
  const deepLink = `${trimBase(input.baseUrl)}${to}`;
  // ONE design: W2-13's reviewed template (bidi isolation, plurals, copy parity).
  const mail = orderNotPlacedEmail({
    supplierName: input.supplierName,
    orderDayLabel: input.orderDayLabel,
    cutoffLabel: cutoff,
    ...(draft ? { draftUrl: deepLink } : { ordersUrl: deepLink }),
    locale: input.locale ?? 'he',
  });
  return { ...mail, deepLink, dedupeSuffix: `${input.supplierId}:${input.ilDate}`, automationId: 'A5' };
}
