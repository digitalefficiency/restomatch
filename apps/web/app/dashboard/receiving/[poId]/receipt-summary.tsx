'use client';

import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import type { ReconciliationResult } from '@/app/showcase/receiver/_mock';
import { lineKey, type LineMark } from '@/app/showcase/receiver/_state';
import { ActionBar, PRIMARY_56 } from '@/app/showcase/receiver/_steps/ActionBar';
import { ItemName, useUnitLabel } from '@/app/showcase/receiver/_steps/english';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';

/**
 * A receipt that is already closed (completed / partial) opens read-only —
 * never a fresh scan step that would invite a second invoice upload (RCV-02,
 * RCV-13). What was counted, line by line; the dock slip renders below it.
 */
export function ReceiptSummary({
  status,
  receivedAt,
  result,
  marks,
}: {
  status: 'completed' | 'partial';
  receivedAt: string | null;
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
}) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();
  const unit = useUnitLabel();
  const qty = (q: number, u: string | null) => `${formatNumber(q, locale, { maximumFractionDigits: 3 })}${u ? ` ${unit(u)}` : ''}`;
  const time = receivedAt ? formatDate(receivedAt, locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div dir={dir} className="mx-auto max-w-2xl" data-testid="receipt-summary">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />
        </span>
        <div>
          <h1 tabIndex={-1} data-step-heading="" className="text-2xl font-extrabold text-ink outline-none">
            {td('delivery.summary.title')}
          </h1>
          <p className="text-base text-muted">
            {time ? td('delivery.summary.subtitle', { time }) : td('delivery.summary.subtitleNoTime')}
          </p>
          <p className="mt-1 text-base font-semibold text-ink" data-testid="receipt-summary-status">
            {td(`delivery.summary.${status}`)}
          </p>
        </div>
      </div>

      <ul className="mb-4 divide-y divide-line rounded-2xl border border-line bg-surface">
        {result.lines
          .filter((l) => l.poLineId !== null)
          .map((l) => {
            // Only a counted line has a received qty (an unresolved mark merely pre-fills the editor).
            const m = marks[lineKey(l)]?.touched ? marks[lineKey(l)] : undefined;
            const missing = m?.rejectReason === 'missing';
            return (
              <li key={lineKey(l)} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="receipt-summary-line">
                <div className="min-w-0">
                  <ItemName he={l.productName} en={l.productNameEn} className="text-[17px] font-semibold text-ink" />
                  <p className="text-base text-muted">
                    {l.poQty !== null ? td('delivery.count.ordered', { qty: qty(l.poQty, l.poUnit) }) : null}
                  </p>
                </div>
                <p className="shrink-0 text-end text-lg font-bold tabular-nums text-ink">
                  {missing ? td('delivery.count.missingTag') : m ? td('delivery.count.received', { qty: qty(m.qtyReceived, l.poUnit) }) : '—'}
                  {m?.condition === 'damaged' ? <span className="block text-sm text-warn">{td('delivery.count.damagedTag')}</span> : null}
                  {m?.method === 'bulk_as_ordered' ? (
                    <span className="block text-sm font-normal text-muted" data-testid="summary-bulk-tag">
                      {td('delivery.count.bulkTag')}
                    </span>
                  ) : null}
                </p>
              </li>
            );
          })}
      </ul>

      <ActionBar testId="summary-actions">
        <Link href="/dashboard/receiving" className={PRIMARY_56}>
          {t('steps.confirmed.backToInbox')}
          <ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" />
        </Link>
      </ActionBar>
    </div>
  );
}
