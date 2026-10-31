'use client';

import Link from 'next/link';
import { History } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Card, Spinner, type BadgeTone } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';

type Status = 'pending' | 'mapped' | 'committed' | 'failed';
const TONE: Record<Status, BadgeTone> = {
  pending: 'info',
  mapped: 'info',
  committed: 'accent',
  failed: 'danger',
};

/**
 * Recent price-list imports for one supplier (catalog_imports), newest first:
 * file, when, status, rows / new / updated. Failed imports show their error so
 * a manager can tell why yesterday's file didn't land. Polls while an import is
 * still being processed by the worker.
 */
export function ImportHistory({ supplierId }: { supplierId: string }) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const q = trpc.catalog.imports.useQuery(
    { supplierId, limit: 10 },
    {
      refetchInterval: (query) =>
        query.state.data?.some((i) => i.status === 'pending' || i.status === 'mapped') ? 5000 : false,
    },
  );
  const n = (v: number) => formatNumber(v, locale);

  return (
    <section aria-labelledby="import-history-title">
      <h2 id="import-history-title" className="mb-3 flex items-center gap-2 text-base font-bold text-ink">
        <History className="h-4 w-4 text-subtle" aria-hidden="true" /> {t('history.title')}
      </h2>
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-4 text-sm text-subtle">{t('history.empty')}</p>
      ) : (
        <Card elevated padding="none">
          <ul className="divide-y divide-line/60">
            {(q.data ?? []).map((imp) => {
              const status = imp.status as Status;
              return (
                <li key={imp.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink" dir="auto" title={imp.filename}>
                    {imp.filename}
                  </span>
                  <span className="tabular-nums text-xs text-subtle">{formatDateTime(imp.createdAt, locale)}</span>
                  <Badge tone={TONE[status] ?? 'neutral'}>{t(`history.statuses.${status}`)}</Badge>
                  <span className="text-xs tabular-nums text-muted">
                    {t('history.rows')}: {n(imp.rowCount)} · {t('history.created')}: {n(imp.createdItems)} ·{' '}
                    {t('history.updated')}: {n(imp.updatedItems)}
                  </span>
                  {imp.unlinkedItems > 0 ? (
                    <Link
                      href={`/dashboard/catalog/import?supplierId=${encodeURIComponent(supplierId)}&review=${encodeURIComponent(imp.id)}`}
                      className="inline-flex min-h-6 items-center rounded text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [@media(pointer:coarse)]:min-h-[44px]"
                    >
                      {t('history.review', { count: n(imp.unlinkedItems) })}
                    </Link>
                  ) : null}
                  {status === 'failed' && imp.error ? (
                    <p className="w-full truncate text-xs text-danger" title={imp.error}>
                      {t('history.failedHint', { error: imp.error.replace(/^CATALOG_[A-Z_]+:\s*/, '') })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
