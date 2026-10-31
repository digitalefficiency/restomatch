import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import type { Caller } from './caller';
import { ReopenReceipt } from './reopen-receipt';

type Receipt = Awaited<ReturnType<Caller['receiving']['getReceipt']>>;

/**
 * A closed receipt, read-only: what was ordered vs what was counted, per line.
 * Opened from the board's "התקבל ✓" rows — never the wizard, which would let a
 * closed count be edited (the server refuses that too).
 */
export function ReceiptView({
  receipt,
  poId,
  canReopen,
  supplierName,
  t,
  locale,
}: {
  receipt: Receipt;
  poId: string;
  /** May this viewer receive goods (owner / manager / receiver)? */
  canReopen: boolean;
  supplierName: string;
  t: Translator<typeof overviewHe>;
  locale: Locale;
}) {
  // Owner decision §8.15: numbers in tables are right-aligned in both locales (physical right, not text-end).
  const qty = (v: string | number | null) => (v == null ? '—' : formatNumber(Number(v), locale, { maximumFractionDigits: 3 }));
  return (
    <section aria-labelledby="receipt-title" data-testid="receipt-view" className="space-y-4">
      <Link
        href="/dashboard/receiving"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('board.receipt.back')}
      </Link>
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <h2 id="receipt-title" className="text-xl font-bold text-ink">
          {t('board.receipt.title', { supplier: supplierName })}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="font-semibold text-primary">
            {receipt.status === 'partial' || receipt.status === 'rejected' ? t('board.cta.partial') : t('board.cta.received')}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatDate(receipt.receivedAt, locale, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span aria-hidden="true">·</span>
          <span>{t('board.receipt.readOnly')}</span>
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-start text-xs font-semibold text-subtle">
              <th scope="col" className="py-2 text-start">{t('board.receipt.product')}</th>
              <th scope="col" className="py-2 text-right">{t('board.receipt.ordered')}</th>
              <th scope="col" className="py-2 text-right">{t('board.receipt.received')}</th>
              <th scope="col" className="py-2 text-right">{t('board.receipt.rejected')}</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l) => {
              const name = (locale === 'en' ? l.productNameEn : null) ?? l.productName ?? '—';
              const short = l.orderedQty != null && Number(l.qtyReceived) < Number(l.orderedQty);
              return (
                <tr key={l.grLineId} className="border-b border-line/60">
                  <td className="py-2 text-ink">
                    <bdi>{name}</bdi>
                    {l.unit ? <span className="ms-1 text-xs text-muted">({l.unit})</span> : null}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted">{qty(l.orderedQty)}</td>
                  <td className={`py-2 text-right font-semibold tabular-nums ${short ? 'text-warn' : 'text-ink'}`}>{qty(l.qtyReceived)}</td>
                  <td className="py-2 text-right tabular-nums text-muted">{Number(l.qtyRejected) > 0 ? qty(l.qtyRejected) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canReopen && receipt.status === 'partial' ? (
          <ReopenReceipt
            poId={poId}
            label={t('board.receipt.followUp.cta')}
            hint={t('board.receipt.followUp.hint')}
            failed={t('board.receipt.followUp.failed')}
          />
        ) : null}
      </div>
    </section>
  );
}
