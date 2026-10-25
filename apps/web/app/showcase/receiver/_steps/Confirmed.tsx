'use client';

import { ArrowLeft, Check, ExternalLink, FileImage, Plus, Receipt } from 'lucide-react';
import type { ReconciliationResult } from '../_mock';
import type { CapturedImage } from '../_state';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import { ActionBar, PRIMARY_56 } from './ActionBar';

interface Props {
  supplierName: string;
  result: ReconciliationResult | null;
  confirmedAt: string | null;
  capturedImage: CapturedImage | null;
  onReset: () => void;
  /** Label of the reset button (defaults to "another receipt"). */
  resetLabel?: string;
  /** Lines the receiver recorded as different from the order (the wizard counts its marks). */
  exceptions?: number;
  /** The real invoice page (dashboard). The showcase links to its demo scan instead. */
  invoiceHref?: string | null;
  /** The engine's ₪ (the dock slip) or "set after the check" — never a client estimate (RCV-11). */
  amount?: React.ReactNode;
  /** Below the summary, above the bar (the dock slip). */
  children?: React.ReactNode;
  /** Who received the goods (the signed-in person on a shared tablet). */
  receivedBy?: string | null;
}

/**
 * The receipt is closed: a calm T3 summary (RCV-30) — when, from whom, how many
 * lines and exceptions, the invoice — and one primary for what comes next. No
 * celebration motion, no internal ids, no client-side "savings" figure.
 */
export function Confirmed({
  supplierName,
  result,
  confirmedAt,
  capturedImage,
  onReset,
  resetLabel,
  exceptions,
  invoiceHref,
  amount,
  children,
  receivedBy,
}: Props) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();

  const time = confirmedAt ? formatDate(confirmedAt, locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const lines = result?.lines.length ?? 0;
  const s = result?.summary;
  const exc =
    exceptions ??
    (s ? s.qtyDiffCount + s.priceDiffCount + s.unorderedCount + s.missingCount + (s.pendingCount ?? 0) : 0);
  const invoiceNumber = result && !result.invoiceMeta.noInvoice ? result.invoiceMeta.invoiceNumber : null;
  const scanHref = invoiceHref ?? (capturedImage?.scanRouteUrl ? (capturedImage.publicUrl ?? capturedImage.scanRouteUrl) : null);

  return (
    <div dir={dir} className="mx-auto max-w-md py-4" data-testid="receipt-confirmed">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 tabIndex={-1} data-step-heading="" className="text-2xl font-extrabold text-ink outline-none">
            {t('steps.confirmed.title')}
          </h1>
          <p className="text-base text-muted">{t('steps.confirmed.subtitle', { time, supplier: supplierName })}</p>
        </div>
      </div>

      <div className="mb-4 space-y-3 rounded-2xl border border-line bg-surface p-4 text-start">
        <p className="text-lg font-semibold text-ink" data-testid="confirmed-summary">
          {exc > 0
            ? td('delivery.confirmed.summary', { lines: formatNumber(lines, locale), exceptions: formatNumber(exc, locale) })
            : td('delivery.confirmed.noExceptions', { lines: formatNumber(lines, locale) })}
        </p>
        {invoiceNumber || scanHref ? (
          <div className="flex items-center justify-between gap-3 text-base">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              {invoiceHref ? <Receipt className="h-5 w-5 shrink-0" aria-hidden="true" /> : <FileImage className="h-5 w-5 shrink-0" aria-hidden="true" />}
              {t('steps.confirmed.invoice')}
              {invoiceNumber ? <bdi className="font-semibold text-ink">{invoiceNumber}</bdi> : null}
            </span>
            {scanHref ? (
              <a
                href={scanHref}
                {...(invoiceHref ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 font-semibold text-primary"
                data-testid="confirmed-invoice-link"
              >
                {invoiceHref ? td('delivery.confirmed.viewInvoice') : t('steps.confirmed.viewScan')}
                {invoiceHref ? null : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
              </a>
            ) : null}
          </div>
        ) : null}
        {receivedBy ? (
          <p className="text-base text-muted" data-testid="confirmed-received-by">
            {td('delivery.confirmed.receivedBy', { name: receivedBy })}
          </p>
        ) : null}
        {amount ? <div className="text-base text-muted">{amount}</div> : null}
      </div>

      {children}

      <ActionBar testId="confirmed-actions">
        <button type="button" onClick={onReset} className={PRIMARY_56} data-testid="confirmed-next">
          {resetLabel ? null : <Plus className="h-5 w-5" strokeWidth={3} aria-hidden="true" />}
          {resetLabel ?? t('steps.confirmed.another')}
          {resetLabel ? <ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" /> : null}
        </button>
      </ActionBar>
    </div>
  );
}
