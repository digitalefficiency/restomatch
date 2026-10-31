'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Ban, CheckCheck, ChevronRight, FilePen, PackageCheck, PackageMinus, Repeat, Send } from 'lucide-react';
import { Badge, Card, displayName, type BadgeTone } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { deliveryStatusOf, ltrIsolate, poRefOf, type DisplayOrderStatus, type ReceiptStatus } from './order-logic';
import { RowMenu } from './row-menu';

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

/** Icon + word + tone: never colour alone; cancelled is history, not an alarm (orders-34). */
export const STATUS_TONE: Record<DisplayOrderStatus, BadgeTone> = {
  draft: 'neutral',
  received: 'accent',
  sent: 'info',
  confirmed: 'accent',
  partial: 'warning',
  closed: 'neutral',
  cancelled: 'neutral',
};

const STATUS_ICON: Record<DisplayOrderStatus, typeof Send> = {
  draft: FilePen,
  sent: Send,
  confirmed: CheckCheck,
  partial: PackageMinus,
  received: PackageCheck,
  closed: Archive,
  cancelled: Ban,
};

export function OrderStatusBadge({ status, receiptStatus }: { status: OrderStatus; receiptStatus?: ReceiptStatus }) {
  const shown = deliveryStatusOf(status, receiptStatus);
  const t = useT(ordersNs);
  const Icon = STATUS_ICON[shown] ?? FilePen;
  return (
    <span data-testid="order-status" data-status={shown}>
      <Badge
        tone={STATUS_TONE[shown] ?? 'neutral'}
        icon={<Icon className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />}
      >
        {t(`status.${shown}`)}
      </Badge>
    </span>
  );
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/**
 * Purchase-order table shared by /dashboard/orders and the supplier "orders"
 * tab. Desktop: one stretched link per row (one Tab stop, named supplier · #ref ·
 * date · ₪) plus a ⋯ menu; numbers physically right-aligned in both locales (owner
 * decision) and tabular. Phones: cards with the
 * same stretched link and one inline action ("הזמן שוב"). `canReorder` shows it.
 */
export function OrdersTable({
  orders,
  hideSupplier = false,
  canReorder = false,
}: {
  orders: OrderRow[];
  hideSupplier?: boolean;
  canReorder?: boolean;
}) {
  const t = useT(ordersNs);
  const locale = useLocale();
  const router = useRouter();
  const date = (d: Date | string | null) => (d ? formatDate(d, locale, SHORT_DATE) : '—');
  const total = (v: string | null) => (v != null ? formatIls(Number(v), { locale, maximumFractionDigits: 2 }) : '—');
  const supplier = (o: OrderRow) => displayName(o.supplierName, o.supplierNameEn, locale).primary;
  const rowLabel = (o: OrderRow) =>
    t('list.rowLabel', { supplier: supplier(o), ref: ltrIsolate(`#${poRefOf(o.id)}`), date: date(o.createdAt), total: total(o.totalEstimated) });
  const reorderable = (o: OrderRow) => canReorder && o.status !== 'draft' && o.lineCount > 0;
  const reorderHref = (o: OrderRow) => `/dashboard/orders/new?from=${o.id}`;

  return (
    <>
      <Card elevated padding="none" className="hidden overflow-x-auto md:block">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-subtle ltr:uppercase ltr:tracking-wide">
              {!hideSupplier && <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.supplier')}</th>}
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.ref')}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.created')}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.status')}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('columns.expectedDelivery')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t('columns.lines')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t('columns.total')}</th>
              {canReorder ? (
                <th scope="col" className="w-14 px-2 py-3">
                  <span className="sr-only">{t('columns.actions')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={o.id}
                className="relative border-b border-line/60 last:border-0 focus-within:bg-surface-2/60 hover:bg-surface-2/60"
                data-testid="order-row"
              >
                {!hideSupplier && (
                  <td className="px-4 py-3 font-medium text-ink">
                    {/* The row's one link, stretched over the whole row. */}
                    <Link
                      href={`/dashboard/orders/${o.id}`}
                      aria-label={rowLabel(o)}
                      className="after:absolute after:inset-0 after:content-[''] hover:text-primary focus:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
                    >
                      {supplier(o)}
                    </Link>
                  </td>
                )}
                <td className="px-4 py-3 text-muted">
                  <bdi dir="ltr" className="font-mono text-xs" data-testid="order-ref">
                    #{poRefOf(o.id)}
                  </bdi>
                </td>
                <td className="px-4 py-3 tabular-nums text-muted">
                  {hideSupplier ? (
                    <Link
                      href={`/dashboard/orders/${o.id}`}
                      aria-label={rowLabel(o)}
                      className="after:absolute after:inset-0 after:content-[''] hover:text-primary focus:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary"
                    >
                      {date(o.createdAt)}
                    </Link>
                  ) : (
                    date(o.createdAt)
                  )}
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={o.status} receiptStatus={o.receiptStatus} />
                </td>
                <td className="px-4 py-3 tabular-nums text-muted">{date(o.expectedDeliveryAt)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted">{formatNumber(o.lineCount, locale)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{total(o.totalEstimated)}</td>
                {canReorder ? (
                  <td className="px-2 py-1 text-end">
                    {reorderable(o) ? (
                      <RowMenu
                        label={t('list.more', { supplier: supplier(o), ref: ltrIsolate(`#${poRefOf(o.id)}`) })}
                        items={[
                          {
                            key: 'reorder',
                            label: t('list.reorder'),
                            icon: <Repeat className="h-4 w-4" aria-hidden="true" />,
                            onSelect: () => router.push(reorderHref(o)),
                          },
                        ]}
                      />
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="space-y-2 md:hidden">
        {orders.map((o) => (
          <li
            key={o.id}
            data-testid="order-card"
            className="relative rounded-2xl border border-line bg-surface p-4 shadow-card focus-within:border-primary"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/orders/${o.id}`}
                    aria-label={rowLabel(o)}
                    className="truncate font-semibold text-ink after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary"
                  >
                    {hideSupplier ? date(o.createdAt) : supplier(o)}
                  </Link>
                  <OrderStatusBadge status={o.status} receiptStatus={o.receiptStatus} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <bdi dir="ltr" className="font-mono text-xs" data-testid="order-ref">
                    #{poRefOf(o.id)}
                  </bdi>
                  <span className="tabular-nums">{t('list.delivery', { date: date(o.expectedDeliveryAt) })}</span>
                  <span className="tabular-nums">{t('list.linesCount', { count: formatNumber(o.lineCount, locale) })}</span>
                  <span className="tabular-nums font-medium text-ink">{total(o.totalEstimated)}</span>
                </div>
              </div>
              {!reorderable(o) ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden="true" />
              ) : null}
            </div>
            {reorderable(o) ? (
              <div className="relative z-10 mt-3 flex justify-end">
                <Link
                  href={reorderHref(o)}
                  data-testid="card-reorder"
                  aria-label={t('list.reorderAria', { supplier: supplier(o) })}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Repeat className="h-4 w-4" aria-hidden="true" /> {t('list.reorder')}
                </Link>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
