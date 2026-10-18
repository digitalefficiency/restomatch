'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Ban, Pencil, Send, Trash2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  Input,
  Select,
  displayName,
  entitlementCauseOf,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { OrderStatusBadge } from '../orders-table';
import { lineLabel, parsePositive, parsePrice } from '../order-logic';

type OrderData = inferRouterOutputs<AppRouter>['orders']['get'];
type Line = OrderData['lines'][number];
type Channel = 'email' | 'whatsapp' | 'none';

interface LineDraft {
  rawDescription: string;
  qtyOrdered: string;
  unit: string;
  unitPriceExpected: string;
}

export function OrderDetail({ data, canEdit }: { data: OrderData; canEdit: boolean }) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const po = data.po!;
  const isDraft = po.status === 'draft';
  const canCancel = po.status !== 'cancelled' && po.status !== 'closed';
  const editable = canEdit && isDraft;

  const [channel, setChannel] = useState<Channel>('none');
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [ld, setLd] = useState<LineDraft>({ rawDescription: '', qtyOrdered: '', unit: '', unitPriceExpected: '' });

  const errorFor = (e: unknown, placing = false) => {
    if (entitlementCauseOf(e)) return t('errors.whatsappGated');
    return friendlyError(e, tc, {
      CONFLICT: po.status === 'draft' ? t('errors.notDraft') : t('errors.cannotCancel'),
      PRECONDITION_FAILED: t('detail.lastLine'),
      // placeOrder's only BAD_REQUEST is "supplier has no email/WhatsApp".
      ...(placing
        ? {
            BAD_REQUEST: t('errors.noContact', {
              channel: t(`detail.channelNames.${channel === 'whatsapp' ? 'whatsapp' : 'email'}`),
            }),
          }
        : {}),
    });
  };
  const done = (msg: string) => {
    toast.success(msg);
    router.refresh();
  };
  const onErr = (e: unknown) => toast.error(errorFor(e));

  const cancel = trpc.orders.cancelOrder.useMutation({ onSuccess: () => done(t('detail.cancelled')), onError: onErr });
  const place = trpc.orders.placeOrder.useMutation({
    onSuccess: (r) => done(r.sentChannel ? t('detail.placed') : t('detail.placedNoChannel')),
    onError: (e) => toast.error(errorFor(e, true)),
  });
  const updateLine = trpc.orders.updateOrderLine.useMutation({
    onSuccess: () => {
      setEditingLine(null);
      done(t('detail.lineUpdated'));
    },
    onError: onErr,
  });
  const delLine = trpc.orders.deleteOrderLine.useMutation({ onSuccess: () => done(t('detail.lineDeleted')), onError: onErr });

  const busy = cancel.isPending || place.isPending || updateLine.isPending || delLine.isPending;

  function startEdit(l: Line) {
    setEditingLine(l.id);
    setLineError(null);
    setLd({
      rawDescription: l.rawDescription ?? '',
      qtyOrdered: String(Number(l.qtyOrdered)),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected != null ? String(Number(l.unitPriceExpected)) : '',
    });
  }

  function saveLine(l: Line) {
    const qty = parsePositive(ld.qtyOrdered);
    if (qty == null) return setLineError(t('detail.qtyInvalid'));
    const price = parsePrice(ld.unitPriceExpected);
    if (price === 'invalid') return setLineError(t('detail.priceInvalid'));
    setLineError(null);
    updateLine.mutate({
      lineId: l.id,
      patch: {
        rawDescription: ld.rawDescription.trim() || undefined,
        qtyOrdered: qty,
        unit: ld.unit.trim() || l.unit,
        unitPriceExpected: price,
      },
    });
  }

  const money = (v: number | string | null | undefined) =>
    v != null ? formatIls(Number(v), { locale, maximumFractionDigits: 2 }) : '—';
  const qtyFmt = (v: string | number) => formatNumber(Number(v), locale, { maximumFractionDigits: 3 });

  return (
    <div className="space-y-6">
      <Card flow elevated padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-4">
              <OrderStatusBadge status={po.status} />
            </div>
            <div>
              <dt className="text-xs text-subtle">{t('detail.created')}</dt>
              <dd className="tabular-nums text-ink">{formatDateTime(po.createdAt, locale)}</dd>
            </div>
            {po.sentAt ? (
              <div>
                <dt className="text-xs text-subtle">
                  {po.sentChannel
                    ? t('detail.sentVia', { channel: t(`detail.channelNames.${po.sentChannel as 'email' | 'whatsapp'}`) })
                    : t('detail.sentAt')}
                </dt>
                <dd className="tabular-nums text-ink">{formatDateTime(po.sentAt, locale)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-subtle">{t('detail.expectedDelivery')}</dt>
              <dd className="tabular-nums text-ink">
                {po.expectedDeliveryAt
                  ? formatDate(po.expectedDeliveryAt, locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">{t('detail.total')}</dt>
              <dd className="font-mono text-lg font-bold tabular-nums text-ink">{money(po.totalEstimated)}</dd>
            </div>
            {po.notes ? (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-subtle">{t('detail.notes')}</dt>
                <dd className="text-ink">{po.notes}</dd>
              </div>
            ) : null}
          </dl>

          {canEdit && canCancel && (
            <div className="flex flex-wrap items-center gap-2">
              {isDraft && (
                <>
                  <Select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as Channel)}
                    className="w-auto text-sm"
                    aria-label={t('detail.channelLabel')}
                  >
                    <option value="none">{t('detail.channels.none')}</option>
                    <option value="email">{t('detail.channels.email')}</option>
                    <option value="whatsapp">{t('detail.channels.whatsapp')}</option>
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={place.isPending}
                    disabled={busy || data.lines.length === 0}
                    onClick={() => place.mutate({ poId: po.id, channel })}
                  >
                    <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /> {t('detail.send')}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                loading={cancel.isPending}
                onClick={() => {
                  if (confirm(t('detail.confirmCancel'))) cancel.mutate({ poId: po.id });
                }}
              >
                <Ban className="h-4 w-4 text-danger" aria-hidden="true" /> {t('detail.cancel')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card elevated padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-start text-sm">
          <caption className="sr-only">{t('detail.linesTitle')}</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('lineColumns.description')}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t('lineColumns.qty')}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('lineColumns.unit')}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t('lineColumns.unitPrice')}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t('lineColumns.lineTotal')}</th>
              {editable && (
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">{t('lineColumns.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const editing = editingLine === l.id;
              const label = lineLabel(l, locale);
              const lineTotal =
                l.unitPriceExpected != null ? Number(l.qtyOrdered) * Number(l.unitPriceExpected) : null;
              return (
                <tr key={l.id} className="border-b border-line/60 align-top last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 text-ink">
                    {editing ? (
                      <Input
                        value={ld.rawDescription}
                        onChange={(e) => setLd({ ...ld, rawDescription: e.target.value })}
                        aria-label={t('lineColumns.description')}
                        maxLength={400}
                      />
                    ) : (
                      <>
                        <span>{label.primary}</span>
                        {label.secondary ? (
                          <span className="block text-xs text-subtle" lang="he" dir="rtl">
                            {label.secondary}
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums text-muted">
                    {editing ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={ld.qtyOrdered}
                        onChange={(e) => setLd({ ...ld, qtyOrdered: e.target.value })}
                        aria-label={t('lineColumns.qty')}
                        className="w-24 text-end"
                      />
                    ) : (
                      qtyFmt(l.qtyOrdered)
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {editing ? (
                      <Input
                        value={ld.unit}
                        onChange={(e) => setLd({ ...ld, unit: e.target.value })}
                        aria-label={t('lineColumns.unit')}
                        maxLength={32}
                        className="w-20"
                      />
                    ) : (
                      l.unit
                    )}
                  </td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums text-ink">
                    {editing ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={ld.unitPriceExpected}
                        onChange={(e) => setLd({ ...ld, unitPriceExpected: e.target.value })}
                        aria-label={t('lineColumns.unitPrice')}
                        className="w-28 text-end"
                      />
                    ) : (
                      money(l.unitPriceExpected)
                    )}
                  </td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums text-ink">{money(lineTotal)}</td>
                  {editable && (
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="primary" loading={updateLine.isPending} onClick={() => saveLine(l)}>
                              {t('detail.save')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingLine(null)}
                              aria-label={t('detail.cancelEdit')}
                              title={t('detail.cancelEdit')}
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                          {lineError ? (
                            <p role="alert" className="text-xs text-danger">
                              {lineError}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('detail.editLine')}: ${label.primary}`}
                            title={t('detail.editLine')}
                            disabled={busy}
                            onClick={() => startEdit(l)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('detail.deleteLine')}: ${label.primary}`}
                            title={data.lines.length === 1 ? t('detail.lastLine') : t('detail.deleteLine')}
                            disabled={busy || data.lines.length === 1}
                            onClick={() => {
                              if (confirm(t('detail.confirmDeleteLine', { name: label.primary }))) {
                                delLine.mutate({ lineId: l.id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {data.lines.length === 0 && (
              <tr>
                <td colSpan={editable ? 6 : 5} className="px-4 py-6 text-center text-subtle">
                  {t('detail.noLines')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
