'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/lib/i18n/client';
import { leaks } from '@/lib/i18n/messages/leaks';
import { cnMerge as cn } from '../cn';
import { moneyText, type MoneyContext } from '../money/format';

/** `data-*` the drill contract stamps on every door (links and buttons alike). */
export function drillAttrs(totalAgorot: number): { 'data-drill': ''; 'data-drill-total': string } {
  if (!Number.isSafeInteger(totalAgorot)) {
    throw new RangeError(`DrillLink: totalAgorot must be integer agorot, got ${totalAgorot}`);
  }
  return { 'data-drill': '', 'data-drill-total': String(totalAgorot) };
}

export interface DrillLinkProps {
  href: string;
  /** The figure this door opens, in integer agorot — the landing header must echo it. */
  totalAgorot: number;
  /** Scope words in front of the ₪: "נתפס לפני תשלום". */
  label: string;
  /** Rows behind the figure; omitted → "open the breakdown". */
  rows?: number;
  /** Precision of the ₪ in the accessible name — match the visible figure (hero/tile 0 dp, line 2 dp). */
  context?: MoneyContext;
  className?: string;
  children: React.ReactNode;
}

/**
 * The drill contract (W2-09b): a number is a door to the rows that sum to it.
 * Renders `<a data-drill data-drill-total={agorot}>` with an accessible name
 * like "נתפס לפני תשלום ₪296 — פתחו 4 שורות". The visible content (usually a
 * `<Money>`) is the caller's. An e2e clicks every `[data-drill]` and asserts
 * the landing total equals `data-drill-total` to the agora.
 */
export function DrillLink({ href, totalAgorot, label, rows, context = 'hero', className, children }: DrillLinkProps) {
  const locale = useLocale();
  const t = useT(leaks);
  const amount = moneyText(totalAgorot / 100, context, locale);
  const name =
    rows == null ? t('drill.openNoCount', { label, amount }) : t('drill.open', { label, amount, count: rows });
  return (
    <Link
      href={href}
      {...drillAttrs(totalAgorot)}
      aria-label={name}
      className={cn('rounded-sm underline-offset-4 hover:underline', className)}
    >
      {children}
    </Link>
  );
}
