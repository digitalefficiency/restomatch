'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Download } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Badge, Button, cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { formatIls } from '@/lib/money';
import { downloadCsv, type CsvColumn, type CsvRow } from '@/lib/components/views/csv';

type Outputs = inferRouterOutputs<AppRouter>;
export type SupplierLedgerData = Outputs['suppliers']['ledger'];
export type LedgerGridData = Outputs['suppliers']['ledgerGrid'];
type Status = SupplierLedgerData['months'][number]['status'];

const ils = (agorot: number, locale: 'he' | 'en') => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });

function useMonthLabel() {
  const locale = useLocale();
  return (key: string) => formatDate(`${key}-15T12:00:00Z`, locale, { month: 'long', year: 'numeric' });
}

/**
 * Month status. T3 matched = calm green; T4 open (the current month is still
 * being billed) and pending (notes held by a consolidated invoice awaiting its
 * cross-match) = neutral, never red; T2 a real gap = solid danger.
 */
export function LedgerStatusChip({ status }: { status: Status }) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  switch (status.kind) {
    case 'matched':
      return <Badge tone="accent">{t('ledger.matched')}</Badge>;
    case 'open':
      return <Badge tone="neutral">{t('ledger.open', { count: status.uninvoicedNotes })}</Badge>;
    case 'pending':
      return <Badge tone="neutral">{t('ledger.pending', { count: status.inConsolidated })}</Badge>;
    case 'diff':
      return <Badge tone="danger-solid">{t('ledger.diff', { amount: ils(Math.abs(status.diffAgorot), locale) })}</Badge>;
    default:
      return <span className="text-xs text-subtle">{t('ledger.empty')}</span>;
  }
}

/** One supplier's months (newest first), each expandable to its delivery notes → covering invoice. */
export function SupplierLedgerTable({ data }: { data: SupplierLedgerData }) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const monthLabel = useMonthLabel();
  const [open, setOpen] = useState<string | null>(data.months.find((m) => m.status.kind !== 'empty')?.month ?? null);
  const day = (iso: string) => formatDate(iso, locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-sm" data-testid="supplier-ledger">
        <caption className="sr-only">{t('ledger.title')}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-subtle">
            <th scope="col" className="px-3 py-2 text-start font-medium">{t('ledger.month')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('ledger.notesValue')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('ledger.invoicedExcl')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('ledger.leak')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('ledger.creditsAsked')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('ledger.paid')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('ledger.openBalance')}</th>
            <th scope="col" className="px-3 py-2 text-start font-medium">{t('ledger.status')}</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">{t('ledger.details')}</span></th>
          </tr>
        </thead>
        {/* One <tbody> per month: its row + the optional drill-down row. */}
          {data.months.map((m) => {
            const invoiced = m.invoices.regular.exclVatAgorot + m.invoices.consolidated.exclVatAgorot;
            const isOpen = open === m.month;
            const d = data.detail[m.month];
            return (
              <tbody key={m.month}>
                <tr className="border-b border-line align-top" data-month={m.month}>
                  <th scope="row" className="px-3 py-2 text-start font-semibold text-ink">
                    {monthLabel(m.month)}
                    <span className="block text-xs font-normal text-subtle">
                      {t('ledger.notes')}: {m.notes.count} · {t('ledger.regular')}: {m.invoices.regular.count} · {t('ledger.consolidated')}: {m.invoices.consolidated.count}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-ink" data-agorot={m.notes.agorot}>{ils(m.notes.agorot, locale)}</td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-ink">{ils(invoiced, locale)}</td>
                  <td className={cn('px-3 py-2 text-end font-mono tabular-nums', m.leakAgorot > 0 ? 'text-danger' : 'text-subtle')} data-leak-agorot={m.leakAgorot}>
                    {ils(m.leakAgorot, locale)}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-ink" data-credits-agorot={m.creditsAskedAgorot}>{ils(m.creditsAskedAgorot, locale)}</td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-ink">{ils(m.paidAgorot, locale)}</td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-ink">{ils(m.openBalanceAgorot, locale)}</td>
                  <td className="px-3 py-2"><LedgerStatusChip status={m.status} /></td>
                  <td className="px-3 py-2 text-end">
                    {m.status.kind !== 'empty' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? t('ledger.hideDetails') : t('ledger.details')}: ${monthLabel(m.month)}`}
                        onClick={() => setOpen(isOpen ? null : m.month)}
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                      </Button>
                    )}
                  </td>
                </tr>
                {isOpen && d && (
                  <tr className="border-b border-line bg-surface-2">
                    <td colSpan={9} className="px-3 py-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <section aria-label={t('ledger.notes')}>
                          <h3 className="mb-1 text-xs font-bold text-muted">{t('ledger.notes')}</h3>
                          {d.notes.length === 0 ? (
                            <p className="text-xs text-subtle">{t('ledger.noActivity')}</p>
                          ) : (
                            <ul className="space-y-1">
                              {d.notes.map((n) => (
                                <li key={n.grId} className="flex flex-wrap items-baseline justify-between gap-2">
                                  <span className="text-ink">{t('ledger.noteRow', { date: day(n.receivedAt) })}</span>
                                  <span className="text-xs">
                                    {n.state === 'not_invoiced' || !n.invoiceId ? (
                                      <span className="text-muted">{t('ledger.notBilled')}</span>
                                    ) : (
                                      <Link href={`/dashboard/invoices/${n.invoiceId}`} className="text-primary underline underline-offset-2">
                                        {n.state === 'in_consolidated'
                                          ? t('ledger.proposed', { number: n.invoiceNumber ?? '—' })
                                          : n.invoiceNumber
                                            ? t('ledger.coveredBy', { number: n.invoiceNumber })
                                            : t('ledger.coveredByNoNumber')}
                                      </Link>
                                    )}
                                  </span>
                                  <span className="font-mono text-xs tabular-nums text-ink">{ils(n.valueAgorot, locale)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                        <section aria-label={t('ledger.invoices')}>
                          <h3 className="mb-1 text-xs font-bold text-muted">{t('ledger.invoices')}</h3>
                          {d.invoices.length === 0 ? (
                            <p className="text-xs text-subtle">{t('ledger.noActivity')}</p>
                          ) : (
                            <ul className="space-y-1">
                              {d.invoices.map((i) => (
                                <li key={i.invoiceId} className="flex flex-wrap items-baseline justify-between gap-2">
                                  <Link href={`/dashboard/invoices/${i.invoiceId}`} className="text-primary underline underline-offset-2">
                                    {t('ledger.invoiceRow', { number: i.invoiceNumber ?? '—' })}
                                  </Link>
                                  <span className="text-xs text-muted">
                                    {i.consolidated ? `${t('ledger.consolidatedTag')} · ` : ''}
                                    {t('ledger.notesCovered', { count: i.deliveryNotes })}
                                    {i.invoiceDate ? ` · ${day(i.invoiceDate)}` : ''}
                                  </span>
                                  <span className="font-mono text-xs tabular-nums text-ink">{ils(i.exclVatAgorot, locale)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </div>
                      {(m.uninvoicedNotes.count > 0 || m.invoicesWithoutNote.count > 0) && (
                        <p className="mt-3 text-xs text-muted">
                          {t('ledger.uninvoiced')}: {m.uninvoicedNotes.count} ({ils(m.uninvoicedNotes.agorot, locale)}) · {t('ledger.withoutNote')}:{' '}
                          {m.invoicesWithoutNote.count} ({ils(m.invoicesWithoutNote.agorot, locale)})
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
      </table>
    </div>
  );
}

/** All suppliers × months, with the bookkeeper CSV (BOM, injection-safe, amounts as numbers). */
export function LedgerGridTable({ data }: { data: LedgerGridData }) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const monthLabel = useMonthLabel();
  const name = (s: LedgerGridData['suppliers'][number]) => (locale === 'en' && s.nameEn ? s.nameEn : s.name);

  function exportCsv() {
    const statusText = (st: Status) =>
      st.kind === 'matched'
        ? t('ledger.matched')
        : st.kind === 'open'
          ? t('ledger.open', { count: st.uninvoicedNotes })
          : st.kind === 'pending'
            ? t('ledger.pending', { count: st.inConsolidated })
          : st.kind === 'diff'
            ? t('ledger.diff', { amount: (Math.abs(st.diffAgorot) / 100).toFixed(2) })
            : t('ledger.empty');
    const columns: CsvColumn[] = [
      { key: 'supplier', label: t('ledger.allSuppliers') },
      { key: 'month', label: t('ledger.month') },
      { key: 'notes', label: t('ledger.notesValue') },
      { key: 'invoiced', label: t('ledger.invoicedExcl') },
      { key: 'leak', label: t('ledger.leak') },
      { key: 'open', label: t('ledger.openBalance') },
      { key: 'status', label: t('ledger.status') },
    ];
    const rows: CsvRow[] = data.suppliers.flatMap((s) =>
      s.cells.map((c) => ({
        supplier: name(s),
        month: c.month,
        notes: c.notesAgorot / 100,
        invoiced: c.invoicedExclVatAgorot / 100,
        leak: c.leakAgorot / 100,
        open: c.openBalanceAgorot / 100,
        status: statusText(c.status),
      })),
    );
    // ASCII name: Chromium drops a Hebrew download name (the file arrives as "download", no .csv).
    downloadCsv(`${t('ledger.csvFile')}-${data.months[0]?.key ?? ''}`, columns, rows);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={exportCsv} data-testid="ledger-csv">
          <Download className="h-4 w-4" aria-hidden="true" /> {t('ledger.csv')}
        </Button>
      </div>
      <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm" data-testid="ledger-grid">
          <caption className="sr-only">{t('ledger.gridTitle')}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-subtle">
              <th scope="col" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">{t('ledger.allSuppliers')}</th>
              {data.months.map((m) => (
                <th key={m.key} scope="col" className="px-3 py-2 text-start font-medium">{monthLabel(m.key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.suppliers.map((s) => (
              <tr key={s.supplierId} className="border-b border-line align-top">
                <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-semibold">
                  <Link href={`/dashboard/suppliers/${s.supplierId}?tab=ledger`} className="text-ink underline underline-offset-2 hover:text-primary">
                    {name(s)}
                  </Link>
                </th>
                {s.cells.map((c) => (
                  <td key={c.month} className="px-3 py-2">
                    {c.status.kind === 'empty' ? (
                      <span className="text-xs text-subtle">—</span>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-mono text-xs tabular-nums text-ink">{ils(c.invoicedExclVatAgorot, locale)}</p>
                        {c.leakAgorot > 0 && (
                          <p className="font-mono text-xs tabular-nums text-danger">
                            {t('ledger.leak')} {ils(c.leakAgorot, locale)}
                          </p>
                        )}
                        <LedgerStatusChip status={c.status} />
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
