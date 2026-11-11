'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/lib/i18n/client';
import { leaks } from '@/lib/i18n/messages/leaks';
import { cnMerge as cn } from '../cn';
import { moneyText, type MoneyContext } from '../money/format';
import { drillAttrs } from './attrs';

export { drillAttrs };

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
 * Renders `<a data-drill data-drill-total={agorot}>`: the visible content (usually
 * a `<Money>`) is the caller's and starts the accessible name, followed by screen-reader
 * text like "נתפס לפני תשלום ₪296 — פתחו 4 שורות". An e2e clicks every `[data-drill]` and asserts
 * the landing total equals `data-drill-total` to the agora.
 */
export function DrillLink({ href, totalAgorot, label, rows, context = 'hero', className, children }: DrillLinkProps) {
  const locale = useLocale();
  const t = useT(leaks);
  const amount = moneyText(totalAgorot / 100, context, locale);
  const name =
    rows == null ? t('drill.openNoCount', { label, amount }) : t('drill.open', { label, amount, count: rows });
  // WCAG 2.5.3 (label in name): the visible figure starts the accessible name; the scope and
  // the row count follow as screen-reader text, never an aria-label that hides what is shown.
  return (
    <Link
      href={href}
      {...drillAttrs(totalAgorot)}
      className={cn('rounded-sm underline-offset-4 hover:underline', className)}
    >
      {children}
      <span className="sr-only"> — {name}</span>
    </Link>
  );
}
