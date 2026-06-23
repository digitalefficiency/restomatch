'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ShoppingCart } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Spinner, cn, type BadgeTone } from '@/lib/components';
import { formatIls } from '@/lib/money';

type Order = inferRouterOutputs<AppRouter>['orders']['list'][number];
type StatusFilter = 'all' | Order['status'];

const PAGE = 50;

const STATUS: Record<Order['status'], { label: string; tone: BadgeTone }> = {
  draft: { label: 'טיוטה', tone: 'neutral' },
  sent: { label: 'נשלחה', tone: 'info' },
  confirmed: { label: 'אושרה', tone: 'accent' },
  partial: { label: 'חלקית', tone: 'warning' },
  closed: { label: 'נסגרה', tone: 'neutral' },
  cancelled: { label: 'בוטלה', tone: 'danger' },
};

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'הכל' },
  { key: 'draft', label: 'טיוטות' },
  { key: 'sent', label: 'נשלחו' },
  { key: 'confirmed', label: 'אושרו' },
  { key: 'closed', label: 'נסגרו' },
];

export function OrdersList({ initial }: { initial: Order[] }) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [limit, setLimit] = useState(PAGE);

  const q = trpc.orders.list.useQuery(
    { status: status === 'all' ? undefined : status, limit },
    { initialData: status === 'all' && limit === PAGE ? initial : undefined },
  );
  const orders = q.data ?? [];
  const hasMore = orders.length >= limit;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => { setStatus(f.key); setLimit(PAGE); }}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              status === f.key
                ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted"><Spinner className="h-4 w-4" /> טוען הזמנות…</div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-6 w-6" />}
          title="אין הזמנות"
          description="צרו הזמנה חדשה מתוך קטלוג הספק."
        />
      ) : (
        <Card elevated padding="none" className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                <th className="px-4 py-3 font-medium">ספק</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">אספקה צפויה</th>
                <th className="px-4 py-3 font-medium">שורות</th>
                <th className="px-4 py-3 font-medium">סכום משוער</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/dashboard/orders/${o.id}`} className="text-primary hover:underline">
                      {o.supplierName}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge></td>
                  <td className="px-4 py-3 text-muted">
                    {o.expectedDeliveryAt
                      ? new Date(o.expectedDeliveryAt).toLocaleDateString('he-IL', {
                          timeZone: 'Asia/Jerusalem',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted">{o.lineCount}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">
                    {o.totalEstimated != null ? formatIls(Number(o.totalEstimated)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" loading={q.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
            טען עוד
          </Button>
        </div>
      )}
    </div>
  );
}
