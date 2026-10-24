'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ShoppingCart } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { EmptyState, ErrorNotice, LinkButton, LoadMore, Spinner, cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { OrdersTable, type OrderStatus } from './orders-table';

type Order = inferRouterOutputs<AppRouter>['orders']['list'][number];
type StatusFilter = 'all' | OrderStatus | 'received';

const PAGE = 50;

const FILTERS: StatusFilter[] = ['all', 'draft', 'sent', 'partial', 'received', 'closed', 'cancelled'];

/**
 * Open orders filter by their goods receipt (orders.list `delivery`): "sent" = not received
 * yet, "partial" / "received" from the latest receipt. The stored PO status never moves on
 * receipt, so a status filter alone would never find a delivered order.
 */
function queryOf(f: StatusFilter): { status?: OrderStatus; delivery?: 'awaiting' | 'partial' | 'received' } {
  if (f === 'all') return {};
  if (f === 'sent') return { delivery: 'awaiting' };
  if (f === 'partial') return { delivery: 'partial' };
  if (f === 'received') return { delivery: 'received' };
  return { status: f };
}

export function OrdersList({ initial, canEdit }: { initial: Order[]; canEdit: boolean }) {
  const t = useT(ordersNs);
  const [status, setStatus] = useState<StatusFilter>('all');
  // Pages past the first, fetched by offset (orders.list caps `limit` at 100, so
  // growing one query's limit broke "load more" at the third page).
  const [more, setMore] = useState<Order[]>([]);
  const [lastPage, setLastPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const utils = trpc.useUtils();

  const q = trpc.orders.list.useQuery(
    { ...queryOf(status), limit: PAGE },
    {
      initialData: status === 'all' ? initial : undefined,
      placeholderData: (prev) => prev,
    },
  );
  const first = q.data ?? [];
  const seen = new Set(first.map((o) => o.id));
  const orders = [...first, ...more.filter((o) => !seen.has(o.id))];
  const hasMore = (lastPage ?? first.length) >= PAGE;

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await utils.orders.list.fetch({ ...queryOf(status), limit: PAGE, offset: first.length + more.length });
      setMore((m) => [...m, ...page]);
      setLastPage(page.length);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('filters.label')} className="flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={status === f}
            onClick={() => {
              setStatus(f);
              setMore([]);
              setLastPage(null);
              setMoreError(false);
            }}
            className={cn(
              'whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              status === f
                ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted">
          <Spinner className="h-4 w-4" /> {t('list.loading')}
        </div>
      ) : q.isError ? (
        <ErrorNotice message={t('list.error')} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-6 w-6" />}
          title={status === 'all' ? t('list.emptyTitle') : t('list.emptyFilteredTitle')}
          description={status === 'all' ? t('list.emptyBody') : t('list.emptyFilteredBody')}
          action={
            canEdit ? (
              <LinkButton href="/dashboard/orders/new" size="sm">
                {t('newOrder')}
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <div className={cn('transition-opacity', q.isFetching && !q.isLoading && 'opacity-70')}>
          <OrdersTable orders={orders} />
        </div>
      )}

      {moreError ? <ErrorNotice message={t('list.error')} /> : null}
      <LoadMore onClick={loadMore} loading={loadingMore || q.isFetching} hasMore={hasMore} />
    </div>
  );
}
