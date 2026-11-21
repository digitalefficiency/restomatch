import { briefCopy } from './copy';
import { ilTimeLabel } from './dates';
import { goLink } from './links';
import { briefHtml } from './render';
import type { BriefContext, BriefMessage } from './types';

/**
 * A3 · the 06:00 receiver truck brief. NO ₪ — the input type carries no amount,
 * price or total at all (owner: the receiver sees no ₪ anywhere, notifications
 * included). Zero deliveries → `null` (never "0 משלוחים").
 */
export interface ReceiverDelivery {
  supplierName: string;
  /** The expected instant; `null` when the PO has a day but no time. */
  expectedAt: Date | null;
  lineCount: number;
}

export interface ReceiverMorningInput extends BriefContext {
  /** The IL day the brief is for, 'YYYY-MM-DD'. */
  ilDate: string;
  deliveries: ReceiverDelivery[];
  /** Whether `expectedAt` carries a real time (a midnight-only PO day has none). */
  hasTime?: (d: ReceiverDelivery) => boolean;
}

export function receiverMorningBrief(input: ReceiverMorningInput): BriefMessage | null {
  if (input.deliveries.length === 0) return null;
  const locale = input.locale ?? 'he';
  const c = briefCopy(locale).receiverMorning;
  const hasTime = input.hasTime ?? ((d) => d.expectedAt != null);
  const items = input.deliveries.map((d) =>
    c.delivery(d.supplierName, hasTime(d) && d.expectedAt ? ilTimeLabel(d.expectedAt) : null, d.lineCount),
  );
  const deepLink = goLink(input.baseUrl, input.restaurantId, '/dashboard/receiving');
  const subject = c.subject(items.length);
  const text = `${c.lead(items.length)} ${items.join(' · ')}\n\n${c.cta}: ${deepLink}`;
  const html = briefHtml({
    locale,
    preview: items.join(' · '),
    heading: c.heading,
    lead: c.lead(items.length),
    lines: items.map((t) => ({ text: t })),
    cta: { label: c.cta, url: deepLink },
  });
  return { subject, text, html, deepLink, dedupeSuffix: input.ilDate, automationId: 'A3' };
}
