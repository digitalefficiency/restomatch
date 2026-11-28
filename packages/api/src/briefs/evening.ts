import { briefCopy } from './copy';
import { goLink } from './links';
import { briefIls } from './money';
import { briefHtml, type BriefHtmlLine } from './render';
import type { BriefContext, BriefMessage } from './types';

/** Only finance roles get the evening digest; the chef and the receiver never do. */
export type EveningRole = 'owner' | 'manager' | 'bookkeeper';
export const EVENING_ROLES: readonly EveningRole[] = ['owner', 'manager', 'bookkeeper'];

/**
 * A7 · the 19:00 decision digest, one per person. Every figure is optional: a
 * source that has not merged yet (W2-03 due dates, AU-03 overdue claims, AU-02
 * intake) is passed as `null/undefined` and its line is omitted — never shown as 0.
 * ₪ comes ONLY from `awaitingDecision` (G-12) and AU-03's claims, in integer
 * agorot; the old "open credits" sum (it counted never-claimable types) is gone.
 */
export interface EveningInput extends BriefContext {
  role: EveningRole | (string & {});
  ilDate: string;
  /** G-12 `awaitingDecision`, scoped to the recipient's routed role. */
  awaiting?: { count: number; agorot: number; oldestDays: number } | null;
  /** W2-03: invoices due ≤2 days that are still held. */
  dueSoonHeld?: { count: number } | null;
  /** `goods_receipts.status = 'pending'` created today. No ₪. */
  openReceiptsToday?: { count: number } | null;
  /** AU-03 `isAwaitingChase`: credit requests with no reply for 7+ days. Count + ₪ only, no supplier list. */
  noReplyClaims?: { count: number; agorot: number } | null;
  /** AU-02 `intakeAttention` (owner/manager only). */
  intake?: { count: number; oldestHours: number } | null;
}

export function eveningBrief(input: EveningInput): BriefMessage | null {
  if (!(EVENING_ROLES as readonly string[]).includes(input.role)) return null;
  const locale = input.locale ?? 'he';
  const c = briefCopy(locale).evening;
  const go = (to: string) => goLink(input.baseUrl, input.restaurantId, to);
  const lines: BriefHtmlLine[] = [];
  const a = input.awaiting;
  if (a && a.count > 0) {
    lines.push({ text: c.awaiting(a.count, briefIls(a.agorot, locale), a.oldestDays), href: go('/dashboard/approvals'), linkLabel: c.open });
  }
  if (input.dueSoonHeld && input.dueSoonHeld.count > 0) {
    lines.push({ text: c.dueSoonHeld(input.dueSoonHeld.count), href: go('/dashboard/invoices'), linkLabel: c.open });
  }
  if (input.openReceiptsToday && input.openReceiptsToday.count > 0) {
    lines.push({ text: c.openReceiptsToday(input.openReceiptsToday.count), href: go('/dashboard/receiving'), linkLabel: c.open });
  }
  const o = input.noReplyClaims;
  if (o && o.count > 0) {
    lines.push({ text: c.noReplyClaims(o.count, briefIls(o.agorot, locale)), href: go('/dashboard/recovery'), linkLabel: c.open });
  }
  const i = input.intake;
  if (i && i.count > 0 && input.role !== 'bookkeeper') {
    lines.push({ text: c.intake(i.count, i.oldestHours), href: go('/dashboard/inbox'), linkLabel: c.open });
  }
  if (lines.length === 0) return null; // quiet day → no message
  const deepLink = lines[0]!.href!;
  const subject = c.subject(lines.length);
  const text = `${c.heading}\n\n${lines.map((l) => `• ${l.text}\n  ${l.href}`).join('\n')}`;
  const html = briefHtml({ locale, preview: lines[0]!.text, heading: c.heading, lines });
  return { subject, text, html, deepLink, dedupeSuffix: input.ilDate, automationId: 'A7' };
}
