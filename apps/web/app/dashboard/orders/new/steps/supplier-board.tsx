'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Clock } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Spinner, cn, displayName } from '@/lib/components';
import { StatusChip } from '@/lib/components/feedback/StatusChip';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatRelative } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { countdown, cutoffTone } from '../../w2-logic';

/**
 * The cut-off board (W2-06 §5.2, orders-04 / orders-19): 72 px rows sorted by
 * the next cut-off, a "היום" group first, a countdown chip (warn ≤ 3 h, danger ≤
 * 30 min — the only T2 here), the last order and the caller's open draft. The
 * ₪ of the last order shows only when the server sent it (the receiver's
 * payload carries none).
 */
export function SupplierBoard({
  current,
  localDraftCount,
  onPick,
}: {
  current: string;
  localDraftCount: (id: string) => number;
  onPick: (id: string) => void;
}) {
  const t = useT(ordersNs);
  const locale = useLocale();
  const board = trpc.orders.supplierBoard.useQuery(undefined, { retry: false });
  // The countdown ticks once a minute; nothing else re-renders.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (board.isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted">
        <Spinner className="h-4 w-4" />
      </div>
    );
  }
  const rows = board.data?.rows ?? [];
  const today = rows.filter((r) => r.today);
  const rest = rows.filter((r) => !r.today);

  const Row = ({ r }: { r: (typeof rows)[number] }) => {
    const tone = cutoffTone(r.nextOrderCutoffAt, now);
    const total = (r.lastOrder as { totalEstimated?: string | null } | null)?.totalEstimated;
    const when = r.lastOrder ? formatRelative(r.lastOrder.at, locale, now) : null;
    const drafts = Math.max(r.myDraft?.lineCount ?? 0, localDraftCount(r.supplierId));
    return (
      <li>
        <button
          type="button"
          data-testid="supplier-row"
          data-cutoff={r.nextOrderCutoffAt ?? ''}
          aria-current={r.supplierId === current ? 'true' : undefined}
          onClick={() => onPick(r.supplierId)}
          className="flex min-h-[72px] w-full items-center justify-between gap-3 px-4 py-2 text-start hover:bg-surface-2 focus:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{displayName(r.name, r.nameEn, locale).primary}</span>
            {when ? (
              <span className="block truncate text-xs text-muted">
                {total != null
                  ? t('w2.board.lastOrderTotal', { when, total: formatIls(Number(total), { locale, maximumFractionDigits: 0 }) })
                  : t('w2.board.lastOrder', { when })}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {tone && r.nextOrderCutoffAt ? (
              <StatusChip
                tone={tone === 'closed' ? 'neutral' : tone}
                emphasis={tone === 'danger' ? 'bold' : 'subtle'}
                icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                label={tone === 'closed' ? t('w2.board.closed') : t('w2.board.closesIn', { time: countdown(r.nextOrderCutoffAt, now) })}
              />
            ) : null}
            <span className="flex items-center gap-2">
              {drafts > 0 ? <Badge tone="neutral">{t('w2.board.draft', { count: formatNumber(drafts, locale) })}</Badge> : null}
              <ArrowRight className={cn('h-4 w-4 rtl:-scale-x-100', 'text-subtle')} aria-hidden="true" />
            </span>
          </span>
        </button>
      </li>
    );
  };

  const List = ({ label, items }: { label: string; items: typeof rows }) =>
    items.length ? (
      <section aria-label={label}>
        <h3 className="mb-1 mt-3 text-xs font-semibold text-muted first:mt-0">{label}</h3>
        <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line" data-testid="supplier-board">
          {items.map((r) => (
            <Row key={r.supplierId} r={r} />
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <div aria-label={t('w2.board.title')}>
      <List label={t('w2.board.today')} items={today} />
      <List label={today.length ? t('w2.board.later') : t('w2.board.title')} items={rest} />
    </div>
  );
}
