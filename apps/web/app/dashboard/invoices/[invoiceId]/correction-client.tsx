'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, FileText, Pencil, Play, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Field, Input, type BadgeTone } from '@/lib/components';
import { formatIls } from '@/lib/money';

type Invoice = inferRouterOutputs<AppRouter>['receiving']['getInvoice'];
type Line = Invoice['lines'][number];
type MatchResult = inferRouterOutputs<AppRouter>['match']['runForInvoice'];

function num(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function dateInput(d: Date | string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  clean: { label: 'נקי — אין חריגות', tone: 'accent' },
  minor: { label: 'חריגות קלות', tone: 'warning' },
  major: { label: 'חריגות חמורות', tone: 'danger' },
  blocked: { label: 'נחסם', tone: 'danger' },
};

export function InvoiceCorrection({ invoice, canEdit }: { invoice: Invoice; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rematch, setRematch] = useState<MatchResult | null>(null);

  // Header draft
  const [num_, setNum] = useState(invoice.invoiceNumber ?? '');
  const [date, setDate] = useState(dateInput(invoice.invoiceDate));
  const [excl, setExcl] = useState(invoice.totalExclVat != null ? String(invoice.totalExclVat) : '');
  const [vat, setVat] = useState(invoice.vatAmount != null ? String(invoice.vatAmount) : '');
  const [incl, setIncl] = useState(invoice.totalInclVat != null ? String(invoice.totalInclVat) : '');

  // Line editing
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [ld, setLd] = useState({ rawDescription: '', qtyBilled: '', unit: '', unitPriceBilled: '', lineTotal: '' });

  const onOk = (msg: string) => {
    setSaved(msg);
    setError(null);
    router.refresh();
  };
  const onErr = (e: { message: string }) => {
    setError(e.message || 'הפעולה נכשלה.');
    setSaved(null);
  };

  const updateHeader = trpc.receiving.updateInvoiceHeader.useMutation({
    onSuccess: () => onOk('פרטי החשבונית נשמרו.'),
    onError: onErr,
  });
  const updateLine = trpc.receiving.updateInvoiceLine.useMutation({
    onSuccess: () => {
      setEditingLine(null);
      onOk('השורה נשמרה.');
    },
    onError: onErr,
  });
  const runMatch = trpc.match.runForInvoice.useMutation({
    onSuccess: (res) => {
      setRematch(res);
      setError(null);
      router.refresh();
    },
    onError: onErr,
  });

  function saveHeader() {
    updateHeader.mutate({
      invoiceId: invoice.id,
      patch: {
        invoiceNumber: num_.trim() || null,
        invoiceDate: date ? new Date(date) : null,
        totalExclVat: num(excl),
        vatAmount: num(vat),
        totalInclVat: num(incl),
      },
    });
  }

  function startLine(l: Line) {
    setEditingLine(l.id);
    setLd({
      rawDescription: l.rawDescription,
      qtyBilled: String(l.qtyBilled),
      unit: l.unit,
      unitPriceBilled: String(l.unitPriceBilled),
      lineTotal: String(l.lineTotal),
    });
    setError(null);
  }

  function saveLine(l: Line) {
    const qty = num(ld.qtyBilled);
    const price = num(ld.unitPriceBilled);
    const total = num(ld.lineTotal);
    updateLine.mutate({
      lineId: l.id,
      patch: {
        rawDescription: ld.rawDescription.trim(),
        ...(qty != null ? { qtyBilled: qty } : {}),
        unit: ld.unit.trim() || l.unit,
        ...(price != null ? { unitPriceBilled: price } : {}),
        ...(total != null ? { lineTotal: total } : {}),
      },
    });
  }

  const st: { label: string; tone: BadgeTone } | null = rematch
    ? (STATUS_TONE[rematch.status] ?? { label: rematch.status, tone: 'neutral' })
    : null;

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

      {/* Header */}
      <Card flow elevated padding="lg">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-ink">פרטי החשבונית</h3>
          <div className="flex items-center gap-2">
            {invoice.rawImageUrl && (
              <Link href={`/scans/${invoice.id}`}>
                <Button variant="ghost" size="sm">
                  <FileText className="h-4 w-4" /> צפה בסריקה
                </Button>
              </Link>
            )}
            {canEdit && (
              <Button
                variant="primary"
                size="sm"
                loading={runMatch.isPending}
                onClick={() => runMatch.mutate({ invoiceId: invoice.id })}
              >
                <Play className="h-4 w-4" /> הרץ התאמה מחדש
              </Button>
            )}
          </div>
        </div>

        {st && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-4 py-3">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="text-sm text-muted">
              דליפה:{' '}
              <span className="font-mono font-semibold text-ink">
                {formatIls(rematch!.totalDiscrepancyAmount, { maximumFractionDigits: 2 })}
              </span>
            </span>
            <span className="text-sm text-muted">{rematch!.discrepancyCount} חריגות</span>
            {!rematch!.poMatched && <Badge tone="neutral">ללא הזמנה תואמת</Badge>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="מספר חשבונית" htmlFor="inv-num">
            <Input id="inv-num" value={num_} onChange={(e) => setNum(e.target.value)} disabled={!canEdit} maxLength={120} />
          </Field>
          <Field label="תאריך" htmlFor="inv-date">
            <Input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="סכום לפני מע״מ (₪)" htmlFor="inv-excl">
            <Input id="inv-excl" type="number" inputMode="decimal" step="any" min="0" value={excl} onChange={(e) => setExcl(e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="מע״מ (₪)" htmlFor="inv-vat">
            <Input id="inv-vat" type="number" inputMode="decimal" step="any" min="0" value={vat} onChange={(e) => setVat(e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="סכום כולל מע״מ (₪)" htmlFor="inv-incl">
            <Input id="inv-incl" type="number" inputMode="decimal" step="any" min="0" value={incl} onChange={(e) => setIncl(e.target.value)} disabled={!canEdit} />
          </Field>
        </div>

        {canEdit && (
          <div className="mt-4">
            <Button variant="secondary" size="sm" loading={updateHeader.isPending} onClick={saveHeader}>
              שמור פרטים
            </Button>
          </div>
        )}
      </Card>

      {/* Lines */}
      <Card elevated padding="none" className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
              <th className="px-4 py-3 font-medium">תיאור</th>
              <th className="px-4 py-3 font-medium">כמות</th>
              <th className="px-4 py-3 font-medium">יחידה</th>
              <th className="px-4 py-3 font-medium">מחיר יח׳</th>
              <th className="px-4 py-3 font-medium">סה״כ שורה</th>
              {canEdit && <th className="px-4 py-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => {
              const editing = editingLine === l.id;
              return (
                <tr key={l.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3 text-ink">
                    {editing ? (
                      <Input value={ld.rawDescription} onChange={(e) => setLd({ ...ld, rawDescription: e.target.value })} />
                    ) : (
                      l.rawDescription
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-muted">
                    {editing ? (
                      <Input type="number" inputMode="decimal" step="any" min="0" value={ld.qtyBilled} onChange={(e) => setLd({ ...ld, qtyBilled: e.target.value })} />
                    ) : (
                      String(l.qtyBilled)
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {editing ? <Input value={ld.unit} onChange={(e) => setLd({ ...ld, unit: e.target.value })} /> : l.unit}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">
                    {editing ? (
                      <Input type="number" inputMode="decimal" step="any" min="0" value={ld.unitPriceBilled} onChange={(e) => setLd({ ...ld, unitPriceBilled: e.target.value })} />
                    ) : (
                      formatIls(Number(l.unitPriceBilled), { maximumFractionDigits: 2 })
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">
                    {editing ? (
                      <Input type="number" inputMode="decimal" step="any" min="0" value={ld.lineTotal} onChange={(e) => setLd({ ...ld, lineTotal: e.target.value })} />
                    ) : (
                      formatIls(Number(l.lineTotal), { maximumFractionDigits: 2 })
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="primary" loading={updateLine.isPending} disabled={!ld.rawDescription.trim()} onClick={() => saveLine(l)}>
                            שמור
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingLine(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" title="ערוך" onClick={() => startLine(l)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {invoice.lines.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-4 py-6 text-center text-subtle">
                  אין שורות בחשבונית זו.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-subtle">
        אחרי תיקון שורות או סכומים — הריצו "התאמה מחדש" כדי לחשב מחדש את החריגות ואת מספר הדליפה.
      </p>
    </div>
  );
}
