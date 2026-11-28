'use client';

import Link from 'next/link';
import { Money } from '@/lib/components/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { accounting } from '@/lib/i18n/messages/accounting';
import { trpc } from '@/lib/trpc/client';
import { fixHref } from './fix-href';

/**
 * W3-05b · the rest of the pre-download preview, under W2-14's summary (which
 * already shows the count and ₪): the VAT of the file and every invoice of the
 * range left out, by reason, with a fix link. From `exports.preview` — the same
 * query as the file. Neutral (T4): leaving an invoice out is the guard working.
 * The group rows are data (which reasons appear depends on the invoices): `data-record`,
 * so W2-16's per-screen copy budget counts only the fixed copy (3 words).
 */
export function ExportPreview({ from, to }: { from: string; to: string }) {
  const t = useT(accounting);
  const locale = useLocale();
  const q = trpc.exports.preview.useQuery({ from, to }, { staleTime: 30_000, retry: false });
  if (q.isError || !q.data || (q.data.invoiceCount === 0 && q.data.excluded.length === 0)) return null;
  const p = q.data;
  const n = (v: number) => formatNumber(v, locale);

  return (
    <section aria-label={t('preview.label')} data-testid="export-preview" className="-mt-4 mb-6 rounded-xl border border-line p-4 text-sm text-ink">
      {p.invoiceCount > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2" data-testid="export-preview-vat">
          <span className="text-muted">{t('preview.vat')}</span>
          <Money agorot={p.vatAgorot} context="line" />
        </p>
      ) : null}
      {p.excluded.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-medium text-muted">{t('preview.excludedLabel')}</p>
          <ul className="mt-1 divide-y divide-line">
            {p.excluded.map((g) => (
              <li key={g.reason} data-reason={g.reason} data-record className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  {t(`preview.reasons.${g.reason}`)}
                  <span className="ms-2 text-xs text-muted tabular-nums">{t('preview.count', { count: n(g.count) })}</span>
                </span>
                <Money agorot={g.totalInclVatAgorot} context="line" state="pending" />
                <Link href={fixHref(g.reason, g.invoiceIds, g.count)} className="text-primary underline-offset-2 hover:underline" data-testid={`export-fix-${g.reason}`}>
                  {t('preview.fix')}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {p.missingBusinessId.count > 0 && p.missingBusinessId.supplierIds[0] ? (
        <p className="mt-3 text-xs text-muted" data-testid="export-preview-bizid" data-record>
          {t('preview.missingBusinessId', { count: n(p.missingBusinessId.count) })}{' '}
          <Link href={`/dashboard/suppliers/${p.missingBusinessId.supplierIds[0]}`} className="text-primary underline-offset-2 hover:underline">
            {t('preview.fix')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
