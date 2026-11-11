import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/components';
import { Money } from '@/lib/components/money';

import type { TaskRow } from '@/lib/components/notifications/rows';

export type NeedTone = TaskRow['tone'];
/**
 * A "מחכה לך" row: the task spine's row (₪ in agorot via <Money>, or a count).
 * `href` omitted = a static row (the public sample home, W3-06 M11) — rendered
 * as a plain box with no link into the product.
 */
export type NeedRow = Omit<TaskRow, 'href'> & { href?: string };

const rail: Record<NeedTone, string> = {
  danger: 'before:bg-danger',
  warn: 'before:bg-warn',
  neutral: 'before:bg-line-strong',
};

/**
 * "מחכה לך" (T2): one ≥48 px link per act-now family, ranked by the caller (₪ ×
 * urgency, on the server). A stacked list of at most `max` rows — one verb
 * each — and the rest behind "עוד N" on every viewport (IA rule 4: a home holds
 * ≤5 blocks). Inbox zero is one calm T3 line.
 */
export function NeedsYou({
  title,
  rows,
  zero,
  zeroTone = 'good',
  moreLabel,
  max = 3,
}: {
  title: string;
  rows: NeedRow[];
  zero: string;
  /** `good` (T3) only when the whole restaurant is clear; `neutral` when it waits on others. */
  zeroTone?: 'good' | 'neutral';
  moreLabel: (count: number) => string;
  /** Rows shown before "עוד N" (owner 3; manager and bookkeeper 5 — their home is the list). */
  max?: number;
}) {
  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  return (
    <section aria-labelledby="needs-you-title" data-testid="needs-you">
      <h2 id="needs-you-title" className="mb-2 text-sm font-bold text-ink">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p
          data-testid="needs-you-zero"
          data-tone={zeroTone}
          className={cn('flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-4 text-sm font-semibold', zeroTone === 'good' ? 'text-primary' : 'text-ink')}
        >
          {zeroTone === 'good' ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
          {zero}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2" data-record="">
            {shown.map((row) => (
              <li key={row.key} data-needs-row={row.key}>
                <NeedLink row={row} />
              </li>
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-2" data-testid="needs-you-more">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
                {moreLabel(rest.length)}
              </summary>
              <ul className="mt-2 grid grid-cols-1 gap-2" data-record="">
                {rest.map((row) => (
                  <li key={row.key} data-needs-row={row.key}>
                    <NeedLink row={row} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function NeedLink({ row }: { row: NeedRow }) {
  const box = cn(
    'relative flex min-h-16 items-center justify-between gap-3 overflow-hidden rounded-xl border border-line bg-surface py-2 pe-3 ps-4 shadow-card',
    // T2 row-tone rail (3 px) on the start edge.
    "before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:content-['']",
    rail[row.tone],
  );
  return row.href ? (
    <Link
      href={row.href}
      data-testid={`needs-${row.key}`}
      className={cn(
        box,
        'transition-colors hover:border-primary/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
      )}
    >
      <NeedBody row={row} />
    </Link>
  ) : (
    <div data-testid={`needs-${row.key}`} className={box}>
      <NeedBody row={row} />
    </div>
  );
}

function NeedBody({ row }: { row: NeedRow }) {
  const tid = (suffix = '') => `needs-${row.key}${suffix}`;
  return (
    <>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-muted">{row.label}</span>
        <span className="block text-2xl font-bold leading-7 tabular-nums text-ink" data-testid={tid('-value')}>
          {row.agorot !== null ? <Money agorot={row.agorot} context="tile" decimals={row.decimals} /> : <bdi>{row.countText}</bdi>}
        </span>
        {row.sub ? (
          <span className="block truncate text-xs text-muted" data-testid={tid('-sub')}>
            {row.sub}
          </span>
        ) : null}
        {row.notes ? (
          <span className="block truncate text-xs text-subtle" data-testid={tid('-notes')}>
            {row.notes}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
          row.tone === 'danger'
            ? 'bg-danger text-on-primary'
            : row.tone === 'warn'
              ? 'bg-warn text-on-primary'
              : 'bg-surface-2 text-ink ring-1 ring-line',
        )}
      >
        {row.verb}
        <ArrowLeft className="h-3.5 w-3.5 ltr:-scale-x-100" aria-hidden="true" />
      </span>
    </>
  );
}
