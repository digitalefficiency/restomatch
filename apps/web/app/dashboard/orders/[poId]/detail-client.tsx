'use client';

import { useState } from 'react';
import { UnitText } from '@/lib/components/UnitText';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Ban, Copy, Pencil, Repeat, Send, Trash2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  ConfirmDialog,
  Input,
  LinkButton,
  Select,
  entitlementCauseOf,
  friendlyError,
  useToast,
  cn,
  useSingleFlight,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { OrderStatusBadge } from '../orders-table';
import { OrderDocumentPreview } from '../order-document-preview';
import {
  cancelNoticeText,
  lineLabel,
  lineTotalIls,
  ltrIsolate,
  mailtoLink,
  parsePositive,
  parsePriceInput,
  poRefOf,
  unpricedCount,
  waLink,
  waPhone,
} from '../order-logic';
import { RowMenu } from '../row-menu';
import { UNDO_MS, UndoCountdown } from '../undo-bar';
import { SendStatusNote, useSendStatus } from '../send-status';
import type { SendState } from '../order-logic';

type OrderData = inferRouterOutputs<AppRouter>['orders']['get'];
type Line = OrderData['lines'][number];
type Channel = 'email' | 'whatsapp' | 'none';

interface LineDraft {
  rawDescription: string;
  qtyOrdered: string;
  unit: string;
  unitPriceExpected: string;
}

/** "25.10.2026 · 09:00" — date and 24h time, one separator (orders-35). */
export function DateTimeText({ value, locale }: { value: Date | string; locale: 'he' | 'en' }) {
  const d = typeof value === 'string' ? new Date(value) : value;
  const date = formatDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = formatDate(d, locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (
    <time dateTime={d.toISOString()} className="tabular-nums">
      {date} · {time}
    </time>
  );
}

export function OrderDetail({
  data,
  canEdit,
  pricedDocument = false,
  restaurantName = '',
}: {
  data: OrderData;
  canEdit: boolean;
  /** Flag `orderPricesOut`: placeOrder sends the priced document, previewed by the page instead. */
  pricedDocument?: boolean;
  /** Signs the cancellation notice to the supplier. */
  restaurantName?: string;
}) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const once = useSingleFlight();
  const router = useRouter();
  const po = data.po!;
  // What really happened to the order message, polled until final (orders.sendStatus).
  const sendStatus = useSendStatus(po.id, { enabled: !!po.sentAt });
  const sendState: SendState = sendStatus.data?.state ?? (po.sentAt ? (po.sentChannel ? 'queued' : 'none') : 'none');
  const sendChannel = sendStatus.data?.channel ?? (po.sentChannel === 'email' || po.sentChannel === 'whatsapp' ? po.sentChannel : null);
  const isDraft = po.status === 'draft';
  // A goods receipt makes the order history even while its status reads 'sent'.
  const canCancel = po.status !== 'cancelled' && po.status !== 'closed' && data.receiptStatus == null;
  const editable = canEdit && isDraft;
  const ref = poRefOf(po.id);
  const supplierName = data.supplierName ?? '';

  // Default to what the supplier can actually receive (as the wizard does) —
  // "don't send" is never the silent default next to the primary Send button.
  // The contact also addresses the cancellation notice.
  const suppliers = trpc.suppliers.list.useQuery({}, { enabled: canEdit });
  const supplier = suppliers.data?.find((s) => s.id === po.supplierId);
  const defaultChannel: Channel = supplier?.contactEmail
    ? 'email'
    : supplier?.contactWhatsapp
      ? 'whatsapp'
      : 'none';
  const [pickedChannel, setChannel] = useState<Channel | null>(null);
  const channel = pickedChannel ?? defaultChannel;
  const [asking, setAsking] = useState<
    null | { kind: 'cancel' } | { kind: 'deleteLine'; lineId: string; name: string }
  >(null);
  const [notify, setNotify] = useState(true);
  const [sending, setSending] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
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

  const asked = (then: () => void) => () => {
    setAsking(null);
    then();
  };
  const cancel = trpc.orders.cancelOrder.useMutation({
    onSuccess: asked(() => done(t('detail.cancelled'))),
    onError: (e) => asked(() => onErr(e))(),
  });

  // The cancellation notice goes out from the manager's own WhatsApp / mail app
  // (nothing is queued by us): wa.me when the supplier has WhatsApp, else mailto.
  const notifyVia: 'whatsapp' | 'email' | null = waPhone(supplier?.contactWhatsapp)
    ? 'whatsapp'
    : supplier?.contactEmail
      ? 'email'
      : null;
  const deliveryShort = po.expectedDeliveryAt
    ? formatDate(po.expectedDeliveryAt, 'he', { weekday: 'short', day: 'numeric', month: 'numeric' })
    : null;
  function confirmCancel() {
    const notice = cancelNoticeText({ supplierName, poRef: ref, deliveryLabel: deliveryShort, restaurantName });
    const wantsNotice = notify && !!po.sentAt && notifyVia !== null;
    // Opened inside the tap (popup blockers), pointed at WhatsApp once the cancel lands.
    const win = wantsNotice && notifyVia === 'whatsapp' ? window.open('about:blank', '_blank') : null;
    // The handle is kept only to point it at WhatsApp; the new page gets no way back to this one.
    if (win) win.opener = null;
    cancel.mutate(
      { poId: po.id },
      {
        onSuccess: () => {
          if (!wantsNotice) return;
          if (notifyVia === 'whatsapp') {
            const url = waLink(supplier?.contactWhatsapp, notice.body);
            if (win) win.location.href = url;
            else window.open(url, '_blank', 'noopener');
          } else if (supplier?.contactEmail) {
            window.location.href = mailtoLink(supplier.contactEmail, notice.subject, notice.body);
          }
        },
        onError: () => win?.close(),
      },
    );
  }
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
  const delLine = trpc.orders.deleteOrderLine.useMutation({
    onSuccess: asked(() => done(t('detail.lineDeleted'))),
    onError: (e) => asked(() => onErr(e))(),
  });

  const busy = cancel.isPending || place.isPending || updateLine.isPending || delLine.isPending || sending !== null;

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
    const price = parsePriceInput(ld.unitPriceExpected);
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
  const unpriced = unpricedCount(data.lines);
  const excludes =
    unpriced === 0
      ? null
      : unpriced === 1
        ? t('detail.totalExcludesOne')
        : t('detail.totalExcludes', { count: formatNumber(unpriced, locale) });
  const sendLabel = t(`send.cta.${channel}`, { supplier: supplierName || t('detail.titleNoSupplier') });
  const canReorder = canEdit && !isDraft && data.lines.length > 0;
  // No cancel while a send is counting down: undo that first.
  const menuItems = canEdit && canCancel && sending === null
    ? [
        {
          key: 'cancel',
          label: t('detail.cancel'),
          tone: 'danger' as const,
          icon: <Ban className="h-4 w-4" aria-hidden="true" />,
          onSelect: () => {
            setNotify(true);
            setAsking({ kind: 'cancel' });
          },
        },
      ]
    : [];
  const wideCol = editingLine ? '' : 'hidden sm:table-cell';
  const qtyFmt = (v: string | number) => formatNumber(Number(v), locale, { maximumFractionDigits: 3 });

  return (
    <div className="space-y-6">
      <Card flow elevated padding="lg" data-testid="order-header">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={po.status} receiptStatus={data.receiptStatus} send={po.sentAt ? sendState : null} />
          <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-sm text-ink">
            <span className="sr-only">{t('detail.refLabel')} </span>
            <bdi dir="ltr" className="font-mono tabular-nums" data-testid="order-ref">
              #{ref}
            </bdi>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(ref).then(() => {
                  setCopied(true);
                  toast.success(t('detail.copied'));
                });
              }}
              aria-label={t('detail.copyRef', { ref })}
              title={t('detail.copyRef', { ref })}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Copy className={cn('h-4 w-4', copied && 'text-primary')} aria-hidden="true" />
            </button>
          </span>
          {data.supplierName ? (
            <a
              href={`/dashboard/suppliers/${po.supplierId}?tab=orders`}
              className="text-sm text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('detail.supplierLink')}
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-subtle">{t('detail.created')}</dt>
              <dd className="text-ink">
                <DateTimeText value={po.createdAt} locale={locale} />
              </dd>
            </div>
            {po.sentAt ? (
              <div>
                {/* Pilot (S16 step 4): "sent" only when the provider took it; else "recorded". */}
                <dt className="text-xs text-subtle" data-testid="placed-label">
                  {sendState === 'sent' && sendChannel
                    ? t('detail.sentVia', { channel: t(`detail.channelNames.${sendChannel}`) })
                    : t('detail.recordedAt')}
                </dt>
                <dd className="text-ink">
                  <DateTimeText value={sendStatus.data?.sentAt ?? po.sentAt} locale={locale} />
                </dd>
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
              <dd className="text-lg font-bold tabular-nums text-ink" data-testid="order-total">
                {money(po.totalEstimated)}
              </dd>
              {excludes ? (
                <dd className="text-xs text-muted" data-testid="total-excludes">
                  {excludes}
                </dd>
              ) : null}
            </div>
            {po.notes ? (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-subtle">{t('detail.notes')}</dt>
                <dd className="text-ink">{po.notes}</dd>
              </div>
            ) : null}
          </dl>

          {canEdit ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {editable && canCancel && (
                <>
                  <Select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as Channel)}
                    fullWidth={false}
                    className="min-h-12 w-auto max-w-full text-sm"
                    aria-label={t('detail.channelLabel')}
                    disabled={busy}
                  >
                    <option value="email">{t('detail.channels.email')}</option>
                    <option value="whatsapp">{t('detail.channels.whatsapp')}</option>
                    <option value="none">{t('detail.channels.none')}</option>
                  </Select>
                  <Button
                    variant="primary"
                    className="min-h-12"
                    loading={place.isPending}
                    disabled={busy || data.lines.length === 0}
                    onClick={() => setSending(Date.now() + UNDO_MS)}
                    data-testid="detail-send"
                  >
                    <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /> {sendLabel}
                  </Button>
                </>
              )}
              {canReorder ? (
                <LinkButton href={`/dashboard/orders/new?from=${po.id}`} variant="secondary" className="min-h-12" data-testid="order-again">
                  <Repeat className="h-4 w-4" aria-hidden="true" /> {t('detail.reorder')}
                </LinkButton>
              ) : null}
              {menuItems.length > 0 ? <RowMenu label={t('detail.more')} items={menuItems} /> : null}
            </div>
          ) : null}
        </div>
        {po.sentAt && po.status !== 'cancelled' ? (
          <SendStatusNote
            className="mt-4"
            poId={po.id}
            state={sendState}
            channel={sendChannel}
            sentAt={sendStatus.data?.sentAt ?? null}
          />
        ) : null}
        {sending !== null ? (
          <UndoCountdown
            className="mt-4"
            testId="send-undo"
            autoFocus
            deadline={sending}
            message={(sec) =>
              channel === 'none'
                ? t('send.countdownNone', { seconds: formatNumber(sec, locale) })
                : t('send.countdown', { supplier: supplierName, seconds: formatNumber(sec, locale) })
            }
            undoLabel={t('send.undo')}
            onUndo={() => {
              setSending(null);
              toast.success(t('send.undone'));
            }}
            onElapse={() => {
              setSending(null);
              once(() => place.mutateAsync({ poId: po.id, channel }));
            }}
          />
        ) : null}
      </Card>

      {editable && !pricedDocument && channel !== 'none' && data.lines.length > 0 && (
        <Card elevated padding="lg">
          <OrderDocumentPreview input={{ poId: po.id }} />
        </Card>
      )}

      {/* Phones: qty × unit price folds under the description so the line total
          stays on screen; editing a line restores the full (scrollable) table. */}
      <Card elevated padding="none" className="overflow-x-auto">
        <table className={cn('w-full text-start text-sm', editingLine ? 'min-w-[640px]' : 'sm:min-w-[640px]')}>
          <caption className="sr-only">{t('detail.linesTitle')}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-subtle ltr:uppercase ltr:tracking-wide">
              <th scope="col" className="px-4 py-3 text-start font-medium">{t('lineColumns.description')}</th>
              <th scope="col" className={cn('px-4 py-3 text-right font-medium', wideCol)}>{t('lineColumns.qty')}</th>
              <th scope="col" className={cn('px-4 py-3 text-start font-medium', wideCol)}>{t('lineColumns.unit')}</th>
              <th scope="col" className={cn('px-4 py-3 text-right font-medium', wideCol)}>{t('lineColumns.unitPrice')}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t('lineColumns.lineTotal')}</th>
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
                l.unitPriceExpected != null
                  ? lineTotalIls(Number(l.qtyOrdered), Number(l.unitPriceExpected))
                  : null;
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
                          <span className="block text-xs text-subtle" lang="he">
                            {label.secondary}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs tabular-nums text-muted sm:hidden">
                          {qtyFmt(l.qtyOrdered)} <UnitText unit={l.unit} />
                          {l.unitPriceExpected != null ? <> × {money(l.unitPriceExpected)}</> : null}
                        </span>
                      </>
                    )}
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums text-muted', wideCol)}>
                    {editing ? (
                      <Input
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        onFocus={(e) => e.currentTarget.select()}
                        value={ld.qtyOrdered}
                        onChange={(e) => setLd({ ...ld, qtyOrdered: e.target.value })}
                        aria-label={t('lineColumns.qty')}
                        className="w-24 text-right"
                      />
                    ) : (
                      qtyFmt(l.qtyOrdered)
                    )}
                  </td>
                  <td className={cn('px-4 py-3 text-muted', wideCol)}>
                    {editing ? (
                      <Input
                        value={ld.unit}
                        onChange={(e) => setLd({ ...ld, unit: e.target.value })}
                        aria-label={t('lineColumns.unit')}
                        maxLength={32}
                        className="w-20"
                      />
                    ) : (
                      <UnitText unit={l.unit} />
                    )}
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums text-ink', wideCol)}>
                    {editing ? (
                      <Input
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        onFocus={(e) => e.currentTarget.select()}
                        value={ld.unitPriceExpected}
                        onChange={(e) => setLd({ ...ld, unitPriceExpected: e.target.value })}
                        aria-label={t('lineColumns.unitPrice')}
                        className="w-28 text-right"
                      />
                    ) : (
                      money(l.unitPriceExpected)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{money(lineTotal)}</td>
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
                            onClick={() => setAsking({ kind: 'deleteLine', lineId: l.id, name: label.primary })}
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

      <ConfirmDialog
        open={asking?.kind === 'cancel'}
        title={supplierName ? t('detail.confirmCancelNamed', { supplier: supplierName }) : t('detail.confirmCancel')}
        body={
          <>
            <p className="tabular-nums text-ink" data-testid="cancel-facts">
              {t('detail.cancelFacts', {
                ref: ltrIsolate(`#${ref}`),
                total: money(po.totalEstimated),
                date: po.expectedDeliveryAt
                  ? formatDate(po.expectedDeliveryAt, locale, { weekday: 'short', day: 'numeric', month: 'numeric' })
                  : '—',
              })}
            </p>
            {po.sentAt ? (
              notifyVia ? (
                <label className="flex min-h-11 items-start gap-2 text-ink">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-line accent-primary"
                    data-testid="cancel-notify"
                  />
                  <span>
                    <span className="font-medium">{t('detail.notifySupplier')}</span>
                    <span className="block text-xs text-muted">
                      {t(notifyVia === 'whatsapp' ? 'detail.notifyWhatsapp' : 'detail.notifyEmail')}
                    </span>
                  </span>
                </label>
              ) : (
                <p className="font-medium text-ink">{t('detail.notifyNone')}</p>
              )
            ) : null}
          </>
        }
        confirmLabel={t('detail.cancel')}
        cancelLabel={t('detail.keepOrder')}
        loading={cancel.isPending}
        onConfirm={confirmCancel}
        onClose={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking?.kind === 'deleteLine'}
        title={asking?.kind === 'deleteLine' ? t('detail.confirmDeleteLine', { name: asking.name }) : ''}
        confirmLabel={t('detail.deleteLine')}
        cancelLabel={t('detail.keepLine')}
        loading={delLine.isPending}
        onConfirm={() => asking?.kind === 'deleteLine' && delLine.mutate({ lineId: asking.lineId })}
        onClose={() => setAsking(null)}
      />
    </div>
  );
}
