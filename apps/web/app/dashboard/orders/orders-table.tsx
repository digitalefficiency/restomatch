'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Badge, Card, displayName, type BadgeTone } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { deliveryStatusOf, type DisplayOrderStatus, type ReceiptStatus } from './order-logic';

export type OrderStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';
export type { DisplayOrderStatus } from './order-logic';

export interface OrderRow {
  id: string;
  supplierName: string;
  supplierNameEn?: string | null;
  status: OrderStatus;
  /** Latest goods receipt of the PO (orders.list); drives "received" / "partially received". */
  receiptStatus?: ReceiptStatus;
  createdAt: Date | string;
  expectedDeliveryAt: Date | string | null;
  lineCount: number;
  totalEstimated: string | null;
}

export const STATUS_TONE: Record<DisplayOrderStatus, BadgeTone> = {
  draft: 'neutral',
  received: 'accent',
  sent: 'info',
  confirmed: 'accent',
  partial: 'warning',
  closed: 'neutral',
  cancelled: 'danger',
};

export function OrderStatusBadge({ status, receiptStatus }: { status: OrderStatus; receiptStatus?: ReceiptStatus }) {
  const shown = deliveryStatusOf(status, receiptStatus);
  const t = useT(ordersNs);
  return (
    <span data-testid="order-status" data-status={shown}>
      <Badge tone={STATUS_TONE[shown] ?? 'neutral'}>{t(`status.${shown}`)}</Badge>
    </span>
  );
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/**
 * Purchase-order table shared by /dashboard/orders and the supplier "orders"
 * tab. Desktop: a real table with end-aligned tabular numbers. Phones: a
 * stacked card list (no sideways scrolling). Every row links to the detail.
 */
export function OrdersTable({ orders, hideSupplier = false }: { orders: OrderRow[]; hideSupplier?: boolean }) {
  const t = useT(ordersNs);
  const locale = useLocale();
  const date = (d: Date | string | null) => (d ? formatDate(d, locale, SHORT_DATE) : '—');
  const total = (v: string | null) => (v != null ? formatIls(Number(v), { locale, maximumFractionDigits: 2 }) : '—');
  const supplier = (o: OrderRow) => displayName(o.supplierName, o.supplierNameEn, locale).primary;

  return (
    <>
      <Card elevated padding="none" className="hidden overflow-x-auto md:block">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.created')}</th>
              {!hideSupplier && <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.supplier')}</th>}
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.status')}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.expectedDelivery')}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t('columns.lines')}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t('columns.total')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="group border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                <td className="px-4 py-3 tabular-nums text-muted">
                  <Link
                    href={`/dashboard/orders/${o.id}`}
                    className="rounded text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    aria-label={`${t('list.open')}: ${supplier(o)} · ${date(o.createdAt)}`}
                  >
                    {date(o.createdAt)}
                  </Link>
                </td>
                {!hideSupplier && (
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/dashboard/orders/${o.id}`} className="hover:text-primary hover:underline" tabIndex={-1}>
                      {supplier(o)}
                    </Link>
                  </td>
                )}
                <td className="px-4 py-3">
                  <OrderStatusBadge status={o.status} receiptStatus={o.receiptStatus} />
                </td>
                <td className="px-4 py-3 tabular-nums text-muted">{date(o.expectedDeliveryAt)}</td>
                <td className="px-4 py-3 text-end tabular-nums text-muted">{formatNumber(o.lineCount, locale)}</td>
                <td className="px-4 py-3 text-end font-mono tabular-nums text-ink">{total(o.totalEstimated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="space-y-2 md:hidden">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/dashboard/orders/${o.id}`}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-ink">
                    {hideSupplier ? date(o.createdAt) : supplier(o)}
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-ink">{total(o.totalEstimated)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <OrderStatusBadge status={o.status} receiptStatus={o.receiptStatus} />
                  {!hideSupplier && <span className="tabular-nums">{date(o.createdAt)}</span>}
                  <span className="tabular-nums">
                    {t('columns.expectedDelivery')}: {date(o.expectedDeliveryAt)}
                  </span>
                  <span className="tabular-nums">
                    {t('columns.lines')}: {formatNumber(o.lineCount, locale)}
                  </span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
