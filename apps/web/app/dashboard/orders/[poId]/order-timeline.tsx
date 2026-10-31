import { createServerCaller } from '@/lib/trpc/server';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatDateTime } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

/**
 * One line of what happened to the order (W2-06 §5.5): "נשלח 09:00 · הספק ענה 09:40".
 * A record-only order (no channel) reads "נרשם" — never "נשלח" unless it was sent.
 * The supplier's answer comes from supplierConfirm (flag off → just the send).
 */
export async function OrderTimeline({
  poId,
  sentAt,
  sentChannel,
}: {
  poId: string;
  sentAt: Date | string | null;
  sentChannel: string | null;
}) {
  if (!sentAt) return null;
  const [t, locale, caller] = await Promise.all([getT(ordersNs), getLocale(), createServerCaller()]);
  let answeredAt: Date | string | null = null;
  try {
    const r = await caller.supplierConfirm.responses({ poId });
    answeredAt = (r.response as { submittedAt?: Date | string } | null)?.submittedAt ?? null;
  } catch {
    // Flag off or no access: the send alone.
  }
  const at = (d: Date | string) => formatDateTime(d, locale);
  const parts = [sentChannel ? t('w2.timeline.sent', { time: at(sentAt) }) : t('w2.timeline.recorded', { time: at(sentAt) })];
  if (answeredAt) parts.push(t('w2.timeline.answered', { time: at(answeredAt) }));
  return (
    <p className="mb-4 text-sm text-muted" data-testid="order-timeline">
      {parts.join(' · ')}
    </p>
  );
}
