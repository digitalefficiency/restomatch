import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/components';

export type NeedTone = 'danger' | 'warn' | 'neutral';

export interface NeedRow {
  key: string;
  tone: NeedTone;
  label: string;
  /** The ₪ (formatIls) or count that the landing list repeats. */
  value: string;
  sub?: string;
  /** Muted side items that are NOT part of the value (e.g. duplicates incl. VAT). */
  notes?: string;
  /** One verb that names what the tap does. */
  verb: string;
  href: string;
}

const rail: Record<NeedTone, string> = {
  danger: 'before:bg-danger',
  warn: 'before:bg-warn',
  neutral: 'before:bg-line-strong',
};

/**
 * "מחכה לך" (T2): one ≥48 px link per act-now family, ranked by the caller (₪ ×
 * urgency). Phone: the first `phoneMax` rows, the rest behind "עוד N". Desktop:
 * a strip of up to `deskMax` tiles. Inbox zero is one calm T3 line.
 */
export function NeedsYou({
  title,
  rows,
  zero,
  moreLabel,
  phoneMax = 3,
  deskMax = 5,
}: {
  title: string;
  rows: NeedRow[];
  zero: string;
  moreLabel: (count: number) => string;
  phoneMax?: number;
  deskMax?: number;
}) {
  const shown = rows.slice(0, deskMax);
  const hiddenOnPhone = Math.max(0, shown.length - phoneMax);
  return (
    <section aria-labelledby="needs-you-title" data-testid="needs-you">
      <h2 id="needs-you-title" className="mb-2 text-sm font-bold text-ink">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p
          data-testid="needs-you-zero"
          className="flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-4 text-sm font-semibold text-primary"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {zero}
        </p>
      ) : (
        <>
          <ul className={cn('grid grid-cols-1 gap-2', shown.length > 1 && 'lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]')}>
            {shown.map((row, i) => (
              <li key={row.key} className={i >= phoneMax ? 'max-lg:hidden' : undefined} data-needs-row={row.key}>
                <NeedLink row={row} />
              </li>
            ))}
          </ul>
          {hiddenOnPhone > 0 ? (
            <details className="mt-2 lg:hidden" data-testid="needs-you-more">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden">
                {moreLabel(hiddenOnPhone)}
              </summary>
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {shown.slice(phoneMax).map((row) => (
                  <li key={row.key}>
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
  return (
    <Link
      href={row.href}
      data-testid={`needs-${row.key}`}
      className={cn(
        'relative flex min-h-16 items-center justify-between gap-3 overflow-hidden rounded-xl border border-line bg-surface py-2 pe-3 ps-4 shadow-card transition-colors hover:border-primary/40',
        // T2 row-tone rail (3 px) on the start edge.
        "before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:content-['']",
        rail[row.tone],
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-muted">{row.label}</span>
        <span className="block text-2xl font-bold leading-7 tabular-nums text-ink" data-testid={`needs-${row.key}-value`}>
          <bdi>{row.value}</bdi>
        </span>
        {row.sub ? (
          <span className="block truncate text-xs text-muted" data-testid={`needs-${row.key}-sub`}>
            {row.sub}
          </span>
        ) : null}
        {row.notes ? (
          <span className="block truncate text-xs text-subtle" data-testid={`needs-${row.key}-notes`}>
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
    </Link>
  );
}
