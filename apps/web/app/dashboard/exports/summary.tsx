'use client';

import { AlertTriangle } from 'lucide-react';
import { Money } from '@/lib/components/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { accounting } from '@/lib/i18n/messages/accounting';
import { trpc } from '@/lib/trpc/client';

/**
 * What the export of this range will contain, BEFORE the download (W2-14,
 * admin-04): "412 חשבוניות · ₪184,220 · 3 עם פער פתוח · ₪412 במחלוקת". The ₪
 * figures are 2-dp shekel strings from `exports.summary` (summed in Postgres).
 */
export function ExportSummary({ from, to }: { from: string; to: string }) {
  const t = useT(accounting);
  const locale = useLocale();
  const q = trpc.exports.summary.useQuery({ from, to }, { staleTime: 30_000, retry: false });

  if (q.isError) return null; // the download buttons surface gating/errors
  return (
    <section
      aria-label={t('summary.label')}
      aria-live="polite"
      data-testid="export-summary"
      className="mb-6 rounded-xl border border-line-strong p-4 text-sm text-ink"
    >
      <p className="mb-1 text-xs font-medium text-muted">{t('summary.label')}</p>
      {!q.data ? (
        <p className="text-muted">{t('summary.loading')}</p>
      ) : q.data.invoiceCount === 0 ? (
        <p>{t('summary.none')}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            <span>{t('summary.invoices', { count: formatNumber(q.data.invoiceCount, locale) })}</span>
            <span aria-hidden="true">·</span>
            <Money value={Number(q.data.totalInclVat)} context="tile" />
            {q.data.withOpenGapCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-warn">
                  {t('summary.withGap', { count: formatNumber(q.data.withOpenGapCount, locale) })}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-warn">
                  <Money value={Number(q.data.amountInDispute)} context="line" /> {t('summary.inDispute')}
                </span>
              </>
            ) : null}
            {q.data.undatedCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('summary.undated', { count: formatNumber(q.data.undatedCount, locale) })}</span>
              </>
            ) : null}
          </p>
          {q.data.withOpenGapCount > 0 ? (
            <p className="mt-2 flex items-start gap-2 text-xs text-muted">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
              {t('summary.disputedNote')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
