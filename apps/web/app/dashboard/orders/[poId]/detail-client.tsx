'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Ban, CheckCircle2, Pencil, Send, Trash2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Input, type BadgeTone } from '@/lib/components';
import { formatIls } from '@/lib/money';

type OrderData = inferRouterOutputs<AppRouter>['orders']['get'];
type Line = OrderData['lines'][number];
type Status = NonNullable<OrderData['po']>['status'];

const STATUS: Record<Status, { label: string; tone: BadgeTone }> = {
  draft: { label: 'טיוטה', tone: 'neutral' },
  sent: { label: 'נשלחה', tone: 'info' },
  confirmed: { label: 'אושרה', tone: 'accent' },
  partial: { label: 'חלקית', tone: 'warning' },
  closed: { label: 'נסגרה', tone: 'neutral' },
  cancelled: { label: 'בוטלה', tone: 'danger' },
};

interface LineDraft {
  rawDescription: string;
  qtyOrdered: string;
  unit: string;
  unitPriceExpected: string;
}

function num(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function OrderDetail({ data, canEdit }: { data: OrderData; canEdit: boolean }) {
  const router = useRouter();
  const po = data.po!;
  const isDraft = po.status === 'draft';
  const canCancel = po.status !== 'cancelled' && po.status !== 'closed';

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [channel, setChannel] = useState<'email' | 'whatsapp' | 'none'>('none');
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [ld, setLd] = useState<LineDraft>({ rawDescription: '', qtyOrdered: '', unit: '', unitPriceExpected: '' });

  const ok = (msg: string) => {
    setSaved(msg);
    setError(null);
    router.refresh();
  };
  const onErr = (e: { message: string }) => {
    setError(e.message || 'הפעולה נכשלה.');
    setSaved(null);
  };

  const cancel = trpc.orders.cancelOrder.useMutation({ onSuccess: () => ok('ההזמנה בוטלה.'), onError: onErr });
  const place = trpc.orders.placeOrder.useMutation({ onSuccess: () => ok('ההזמנה נשלחה.'), onError: onErr });
  const updateLine = trpc.orders.updateOrderLine.useMutation({
    onSuccess: () => {
      setEditingLine(null);
      ok('השורה עודכנה.');
    },
    onError: onErr,
  });
  const delLine = trpc.orders.deleteOrderLine.useMutation({ onSuccess: () => ok('השורה נמחקה.'), onError: onErr });

  const busy = cancel.isPending || place.isPending || updateLine.isPending || delLine.isPending;

  function startEdit(l: Line) {
    setEditingLine(l.id);
    setLd({
      rawDescription: l.rawDescription ?? '',
      qtyOrdered: String(l.qtyOrdered),
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected != null ? String(l.unitPriceExpected) : '',
    });
    setError(null);
  }

  function saveLine(l: Line) {
    const qty = num(ld.qtyOrdered);
    const price = num(ld.unitPriceExpected);
    updateLine.mutate({
      lineId: l.id,
      patch: {
        rawDescription: ld.rawDescription.trim() || undefined,
        ...(qty != null ? { qtyOrdered: qty } : {}),
        unit: ld.unit.trim() || l.unit,
        unitPriceExpected: price,
      },
    });
  }

  const st = STATUS[po.status];

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {saved && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <CheckCircle2 className="h-4 w-4" /> {saved}
        </p>
      )}

      <Card flow elevated padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <p className="text-sm text-muted">
              אספקה צפויה:{' '}
              <span className="text-ink">
                {po.expectedDeliveryAt
                  ? new Date(po.expectedDeliveryAt).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })
                  : '—'}
              </span>
            </p>
            <p className="text-sm text-muted">
              סכום משוער:{' '}
              <span className="font-mono tabular-nums text-ink">
                {po.totalEstimated != null ? formatIls(Number(po.totalEstimated)) : '—'}
              </span>
            </p>
            {po.notes ? <p className="text-sm text-muted">הערות: {po.notes}</p> : null}
          </div>

          {canEdit && (canCancel || isDraft) && (
            <div className="flex flex-wrap items-center gap-2">
              {isDraft && (
                <>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as 'email' | 'whatsapp' | 'none')}
                    className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-primary/50 focus:outline-none"
                    aria-label="ערוץ שליחה"
                  >
                    <option value="none">ללא שליחה (סמן כנשלחה)</option>
                    <option value="email">שלח באימייל</option>
                    <option value="whatsapp">שלח בוואטסאפ</option>
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={place.isPending}
                    disabled={busy}
                    onClick={() => place.mutate({ poId: po.id, channel })}
                  >
                    <Send className="h-4 w-4" /> שלח הזמנה
                  </Button>
                </>
              )}
              {canCancel && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('לבטל את ההזמנה?')) cancel.mutate({ poId: po.id });
                  }}
                >
                  <Ban className="h-4 w-4 text-danger" /> בטל
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card elevated padding="none" className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
              <th className="px-4 py-3 font-medium">תיאור</th>
              <th className="px-4 py-3 font-medium">כמות</th>
              <th className="px-4 py-3 font-medium">יחידה</th>
              <th className="px-4 py-3 font-medium">מחיר יח׳</th>
              <th className="px-4 py-3 font-medium">סה״כ משוער</th>
              {canEdit && isDraft && <th className="px-4 py-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const editing = editingLine === l.id;
              const lineTotal =
                l.unitPriceExpected != null ? Number(l.qtyOrdered) * Number(l.unitPriceExpected) : null;
              return (
                <tr key={l.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 text-ink">
                    {editing ? (
                      <Input value={ld.rawDescription} onChange={(e) => setLd({ ...ld, rawDescription: e.target.value })} />
                    ) : (
                      (l.rawDescription ?? '—')
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-muted">
                    {editing ? (
                      <Input type="number" inputMode="decimal" step="any" min="0" value={ld.qtyOrdered} onChange={(e) => setLd({ ...ld, qtyOrdered: e.target.value })} />
                    ) : (
                      String(l.qtyOrdered)
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {editing ? <Input value={ld.unit} onChange={(e) => setLd({ ...ld, unit: e.target.value })} /> : l.unit}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">
                    {editing ? (
                      <Input type="number" inputMode="decimal" step="any" min="0" value={ld.unitPriceExpected} onChange={(e) => setLd({ ...ld, unitPriceExpected: e.target.value })} />
                    ) : l.unitPriceExpected != null ? (
                      formatIls(Number(l.unitPriceExpected), { maximumFractionDigits: 2 })
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">
                    {lineTotal != null ? formatIls(lineTotal, { maximumFractionDigits: 2 }) : '—'}
                  </td>
                  {canEdit && isDraft && (
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="primary" loading={updateLine.isPending} onClick={() => saveLine(l)}>
                            שמור
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingLine(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" title="ערוך" disabled={busy} onClick={() => startEdit(l)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="מחק"
                            disabled={busy}
                            onClick={() => {
                              if (confirm('למחוק את השורה?')) delLine.mutate({ lineId: l.id });
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-danger" />
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
                <td colSpan={canEdit && isDraft ? 6 : 5} className="px-4 py-6 text-center text-subtle">
                  אין שורות בהזמנה זו.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
