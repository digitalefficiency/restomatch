'use client';

import { useRouter } from 'next/navigation';
import { DataTable } from '@/lib/components/table';
import type { ColumnDef } from '@/lib/components/table/types';
import { displayName } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { formatIls } from '@/lib/money';
import { termsValueOf } from './terms';

export interface VendorRow {
  supplierId: string;
  name: string;
  nameEn: string | null;
  active: boolean;
  monthSpendAgorot: number;
  leakAgorot: number;
  openAgorot: number;
  nextDeliveryAt: string | null;
  nextDeliveryTime?: string | null;
  paymentTerms: string | null;
}

export interface VendorTotals {
  monthSpendAgorot: number;
  leakAgorot: number;
  openAgorot: number;
}

/**
 * W2-11 · the owner's vendor table: ספק · רכש החודש · דליפה (90 יום, desc by
 * default) · פתוח לדרישה · משלוח הבא · תנאי תשלום. One server query
 * (`suppliers.table`); the totals row is the server Σ of the leak column, and
 * the summary line names all three totals. Over-contract ₪ joins with W2-12.
 */
export function VendorTable({ rows, totals }: { rows: VendorRow[]; totals: VendorTotals }) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const router = useRouter();
  const day = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const termsLabel = (raw: string | null) => {
    const v = termsValueOf(raw);
    if (v.choice === 'none') return t('table.none');
    if (v.choice === 'other') return raw ?? '';
    if (v.choice === 'eomN') return locale === 'he' ? `שוטף+${v.days}` : `EOM+${v.days}`;
    return t(`terms.${v.choice}`);
  };

  const columns: ColumnDef<VendorRow>[] = [
    {
      id: 'name',
      header: t('table.supplier'),
      identity: true,
      sortable: true,
      value: (r) => displayName(r.name, r.nameEn, locale).primary,
      cell: (r) => (
        <span className="font-semibold text-ink">
          {displayName(r.name, r.nameEn, locale).primary}
          {!r.active ? <span className="ms-2 text-xs font-normal text-muted">{t('table.inactive')}</span> : null}
        </span>
      ),
    },
    { id: 'monthSpend', header: t('table.monthSpend'), kind: 'money', decimals: 0, sortable: true, value: (r) => r.monthSpendAgorot },
    { id: 'leak', header: t('table.leak'), kind: 'money', decimals: 0, sortable: true, value: (r) => r.leakAgorot, mobile: 'primary' },
    { id: 'open', header: t('table.open'), kind: 'money', decimals: 0, sortable: true, value: (r) => r.openAgorot },
    {
      id: 'nextDelivery',
      header: t('table.nextDelivery'),
      kind: 'date',
      sortable: true,
      value: (r) => (r.nextDeliveryAt ? new Date(r.nextDeliveryAt).getTime() : null),
      cell: (r) =>
        r.nextDeliveryAt
          ? `${day.format(new Date(r.nextDeliveryAt))}${r.nextDeliveryTime ? ` ${r.nextDeliveryTime}` : ''}`
          : t('table.none'),
      exportValue: (r) => r.nextDeliveryAt?.slice(0, 10) ?? '',
    },
    {
      id: 'terms',
      header: t('table.terms'),
      sortable: true,
      value: (r) => termsLabel(r.paymentTerms),
    },
  ];

  return (
    <div className="space-y-3" data-testid="vendor-table">
      <p className="text-sm text-muted tabular-nums" data-testid="vendor-table-summary">
        {t('table.summary', {
          spend: formatIls(totals.monthSpendAgorot / 100, { locale }),
          leak: formatIls(totals.leakAgorot / 100, { locale }),
          open: formatIls(totals.openAgorot / 100, { locale }),
        })}
      </p>
      <DataTable<VendorRow>
        id="suppliers-table"
        caption={t('table.caption')}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.supplierId}
        defaultSort={{ id: 'leak', desc: true }}
        totals={{ columnId: 'leak', count: rows.length, sumAgorot: totals.leakAgorot }}
        onOpen={(r) => router.push(`/dashboard/suppliers/${r.supplierId}`)}
      />
    </div>
  );
}
