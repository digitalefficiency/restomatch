'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Pencil, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Field, Input, type BadgeTone } from '@/lib/components';
import { DateField, MoneyInput, QuantityInput } from '@/lib/components/form';
import { formatIls } from '@/lib/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { invoices } from '@/lib/i18n/messages/invoices';
import { localizeServerError } from '@/lib/serverErrors';
import { HebrewToggle, ItemName, useUnitLabel } from '@/app/showcase/receiver/_steps/english';

type Invoice = inferRouterOutputs<AppRouter>['receiving']['getInvoice'];
type Line = Invoice['lines'][number];
type MatchResult = inferRouterOutputs<AppRouter>['match']['runForInvoice'];

/** Agorot ↔ the procedure's ₪ number (the receiving procedures take shekels). */
const toAgorot = (v: string | number | null | undefined) => (v == null || v === '' ? null : Math.round(Number(v) * 100));
const fromAgorot = (a: number | null) => (a == null ? null : a / 100);

function dateInput(d: Date | string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, BadgeTone> = {
  clean: 'accent',
  minor: 'warning',
  major: 'danger',
  blocked: 'danger',
};

export function InvoiceCorrection({
  invoice,
  canEdit,
  canRematch = canEdit,
  lineBadges,
}: {
  invoice: Invoice;
  canEdit: boolean;
  /** `invoice.correct` (owner, manager, bookkeeper): a save re-matches automatically. */
  canRematch?: boolean;
  /** Optional server-rendered per-line badges (e.g. wave-1 "over contract"), keyed by line id. */
  lineBadges?: Record<string, React.ReactNode>;
}) {
  // A consolidated invoice (חשבונית ריכוז) has no PO to re-match against — it is
  // cross-matched against its delivery notes below; the server refuses it too.
  const consolidated = invoice.consolidated;
  const router = useRouter();
  const t = useT(invoices);
  const locale = useLocale();
  const unit = useUnitLabel();
  const money = (v: number) => formatIls(v, { maximumFractionDigits: 2, locale });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rematch, setRematch] = useState<MatchResult | null>(null);
  /** The invoice that already carries the number the user tried to save. */
  const [holderId, setHolderId] = useState<string | null>(null);

  // Header draft
  const [num_, setNum] = useState(invoice.invoiceNumber ?? '');
  const [date, setDate] = useState(dateInput(invoice.invoiceDate));
  const [excl, setExcl] = useState<number | null>(toAgorot(invoice.totalExclVat));
  const [vat, setVat] = useState<number | null>(toAgorot(invoice.vatAmount));
  const [incl, setIncl] = useState<number | null>(toAgorot(invoice.totalInclVat));

  // Line editing
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [ld, setLd] = useState<{ rawDescription: string; qtyBilled: number | null; unit: string; unitPriceBilled: number | null; lineTotal: number | null }>({
    rawDescription: '',
    qtyBilled: null,
    unit: '',
    unitPriceBilled: null,
    lineTotal: null,
  });

  // Saving re-matches automatically (approvals-44): no separate "rerun" step.
  const onOk = (msg: string) => {
    setSaved(msg);
    setError(null);
    if (canRematch && !consolidated) runMatch.mutate({ invoiceId: invoice.id });
    else router.refresh();
  };
  const onErr = (e: { message: string }) => {
    setError(locale === 'en' ? t('correction.failed') : e.message || t('correction.failed'));
    setSaved(null);
  };

  const runMatch = trpc.match.runForInvoice.useMutation({
    onSuccess: (res) => {
      setRematch(res);
      setError(null);
      router.refresh();
    },
    onError: () => {
      setError(t('cockpit.rematchFailed'));
      router.refresh();
    },
  });
  const updateHeader = trpc.receiving.updateInvoiceHeader.useMutation({
    onSuccess: () => {
      setHolderId(null);
      onOk(t('correction.savedHeader'));
    },
    onError: (e) => {
      const data = e.data as { appCode?: string; appParams?: { holderInvoiceId?: string } } | undefined;
      if (data?.appCode === 'invoice.numberTaken') {
        // Translated CONFLICT naming the invoice that holds the number.
        setError(localizeServerError(e, locale, t('correction.failed')));
        setHolderId(data.appParams?.holderInvoiceId || null);
        setSaved(null);
        return;
      }
      setHolderId(null);
      onErr(e);
    },
  });
  const updateLine = trpc.receiving.updateInvoiceLine.useMutation({
    onSuccess: () => {
      setEditingLine(null);
      onOk(t('correction.savedLine'));
    },
    onError: onErr,
  });
  function saveHeader() {
    updateHeader.mutate({
      invoiceId: invoice.id,
      patch: {
        invoiceNumber: num_.trim() || null,
        invoiceDate: date ? new Date(date) : null,
        totalExclVat: fromAgorot(excl),
        vatAmount: fromAgorot(vat),
        totalInclVat: fromAgorot(incl),
      },
    });
  }

  function startLine(l: Line) {
    setEditingLine(l.id);
    setLd({
      rawDescription: l.rawDescription,
      qtyBilled: Number(l.qtyBilled),
      unit: l.unit,
      unitPriceBilled: toAgorot(l.unitPriceBilled),
      lineTotal: toAgorot(l.lineTotal),
    });
    setError(null);
  }

  function saveLine(l: Line) {
    const qty = ld.qtyBilled;
    const price = fromAgorot(ld.unitPriceBilled);
    const total = fromAgorot(ld.lineTotal);
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
    ? STATUS_TONE[rematch.status]
      ? {
          label: t(`status.${rematch.status as 'clean' | 'minor' | 'major' | 'blocked'}`),
          tone: STATUS_TONE[rematch.status]!,
        }
      : { label: rematch.status, tone: 'neutral' }
    : null;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          data-testid="correction-error"
          className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
          {holderId ? (
            <>
              {' '}
              <Link
                href={`/dashboard/invoices/${holderId}`}
                data-testid="duplicate-holder-link"
                className="font-medium underline underline-offset-4"
              >
                {t('correction.openHolder')}
              </Link>
            </>
          ) : null}
        </div>
      )}
      {saved && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <CheckCircle2 className="h-4 w-4" /> {saved}
        </p>
      )}

      {invoice.duplicateOf ? (
        <div
          role="status"
          data-testid="invoice-duplicate-notice"
          className="rounded-md border-s-4 border-line bg-surface-2 px-3 py-2 text-sm text-ink"
        >
          {t('correction.duplicateOf', { number: invoice.duplicateOf.invoiceNumber })}
        </div>
      ) : null}

      {invoice.ocrFailed || invoice.status === 'ocr_pending' ? (
        <div
          role="status"
          data-testid={invoice.ocrFailed ? 'invoice-ocr-failed' : 'invoice-ocr-pending'}
          className="rounded-md border-s-4 border-line bg-surface-2 px-3 py-2 text-sm text-ink"
        >
          {invoice.ocrFailed
            ? invoice.ocrFailureReason === 'quota_exceeded'
              ? t('correction.ocrQuota')
              : t('correction.ocrFailed')
            : t('correction.ocrPending')}
        </div>
      ) : null}

      {/* Header */}
      <Card flow elevated padding="lg">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">{t('correction.details')}</h2>
            {invoice.supplierName ? (
              <p className="text-sm text-muted">
                {t('correction.supplier')}:{' '}
                {locale === 'en' && invoice.supplierNameEn ? invoice.supplierNameEn : invoice.supplierName}
              </p>
            ) : null}
          </div>
        </div>

        {st && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-4 py-3">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="text-sm text-ink" role="status" data-testid="rematch-before-after">
              {t('cockpit.rematched', {
                before: formatIls(rematch!.before / 100, { maximumFractionDigits: 2, locale }),
                after: formatIls(rematch!.after / 100, { maximumFractionDigits: 2, locale }),
              })}
            </span>
            <span className="text-sm text-muted">
              {t('correction.discrepancies', { count: rematch!.discrepancyCount })}
            </span>
            {!rematch!.poMatched && <Badge tone="neutral">{t('correction.noMatchingPo')}</Badge>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('correction.number')} htmlFor="inv-num">
            <Input id="inv-num" value={num_} onChange={(e) => setNum(e.target.value)} disabled={!canEdit} maxLength={120} />
          </Field>
          <Field label={t('correction.date')} htmlFor="inv-date">
            <DateField id="inv-date" value={date || null} onValueChange={(v) => setDate(v ?? '')} disabled={!canEdit} />
          </Field>
          <Field label={t('correction.exclVat')} htmlFor="inv-excl">
            <MoneyInput id="inv-excl" value={excl} onValueChange={setExcl} disabled={!canEdit} />
          </Field>
          <Field label={t('correction.vat')} htmlFor="inv-vat">
            <MoneyInput id="inv-vat" value={vat} onValueChange={setVat} disabled={!canEdit} />
          </Field>
          <Field label={t('correction.inclVat')} htmlFor="inv-incl">
            <MoneyInput id="inv-incl" value={incl} onValueChange={setIncl} disabled={!canEdit} />
          </Field>
        </div>

        {canEdit && (
          <div className="mt-4">
            <Button variant="secondary" size="sm" loading={updateHeader.isPending} onClick={saveHeader}>
              {t('correction.saveDetails')}
            </Button>
          </div>
        )}
      </Card>

      {/* Lines */}
      {locale === 'en' ? (
        <div className="flex justify-end">
          <HebrewToggle />
        </div>
      ) : null}
      <Card elevated padding="none" className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 text-start font-medium">{t('correction.colDescription')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('correction.colQty')}</th>
              <th className="px-4 py-3 text-start font-medium">{t('correction.colUnit')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('correction.colUnitPrice')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('correction.colLineTotal')}</th>
              {canEdit && <th className="px-4 py-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => {
              const editing = editingLine === l.id;
              return (
                <tr
                  key={l.id}
                  // Deep-link target (#line-<id>) from the leak proof sheet: highlighted when targeted.
                  id={`line-${l.id}`}
                  className="scroll-mt-28 border-b border-line/60 last:border-0 hover:bg-surface-2/60 target:bg-surface-2 target:ring-2 target:ring-inset target:ring-primary/50"
                >
                  <td className="px-4 py-3 text-ink">
                    {editing ? (
                      <Input aria-label={t('correction.colDescription')} value={ld.rawDescription} onChange={(e) => setLd({ ...ld, rawDescription: e.target.value })} />
                    ) : (
                      <ItemName he={l.rawDescription} en={l.rawDescriptionEn ?? l.productNameEn} />
                    )}
                    {!editing && lineBadges?.[l.id] ? lineBadges[l.id] : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {editing ? (
                      <QuantityInput aria-label={t('correction.colQty')} value={ld.qtyBilled} onValueChange={(v) => setLd({ ...ld, qtyBilled: v })} />
                    ) : (
                      <bdi>{formatNumber(Number(l.qtyBilled), locale, { maximumFractionDigits: 3 })}</bdi>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {editing ? <Input aria-label={t('correction.colUnit')} value={ld.unit} onChange={(e) => setLd({ ...ld, unit: e.target.value })} /> : unit(l.unit)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
                    {editing ? (
                      <MoneyInput aria-label={t('correction.colUnitPrice')} value={ld.unitPriceBilled} onValueChange={(v) => setLd({ ...ld, unitPriceBilled: v })} />
                    ) : (
                      <bdi>{money(Number(l.unitPriceBilled))}</bdi>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
                    {editing ? (
                      <MoneyInput aria-label={t('correction.colLineTotal')} value={ld.lineTotal} onValueChange={(v) => setLd({ ...ld, lineTotal: v })} />
                    ) : (
                      <bdi>{money(Number(l.lineTotal))}</bdi>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="primary" loading={updateLine.isPending} disabled={!ld.rawDescription.trim()} onClick={() => saveLine(l)}>
                            {t('correction.save')}
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={t('correction.cancel')} onClick={() => setEditingLine(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" title={t('correction.edit')} aria-label={t('correction.edit')} onClick={() => startLine(l)}>
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
                  {t('correction.noLines')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

    </div>
  );
}
