'use client';

import { ArrowLeft, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/lib/components';
import type { ReconciliationResult } from '@/app/showcase/receiver/_mock';
import type { CapturedImage } from '@/app/showcase/receiver/_state';
import { ActionBar } from '@/app/showcase/receiver/_steps/ActionBar';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { DockGap } from './_dock';
import { PHONE_CTA } from './_phone';
import { GapList, type DocState } from './dock-close-sheet';

/**
 * The end screen (SPEC §10.3): closed — or closed on the phone and sent when the
 * connection returns — the items and the gaps, what was marked as ordered without
 * a count, where the document stands, where the data is, and one button to the
 * next delivery. A calm summary: no celebration motion, no internal ids, no
 * client-side ₪ (the dock slip below carries the engine's amounts, for the
 * roles that see money).
 */
export function DockDone({
  supplierName,
  result,
  confirmedAt,
  capturedImage,
  invoiceHref,
  invoiceNumber,
  amount,
  receivedBy,
  bulkCount = 0,
  gaps,
  doc,
  countFirst = false,
  closeQueued,
  resetLabel,
  onReset,
  listLabel,
  onList,
  children,
}: {
  supplierName: string;
  result: ReconciliationResult | null;
  confirmedAt: string | null;
  /** Money roles only: the photographed page (the receiver and the chef get no link to it). */
  capturedImage: CapturedImage | null;
  /** Money roles only: the invoice page. */
  invoiceHref: string | null;
  invoiceNumber: string | null;
  /** Money roles only: "set after the check" — never a client estimate. */
  amount: React.ReactNode;
  receivedBy: string | null;
  bulkCount?: number;
  gaps: DockGap[];
  doc: DocState;
  /** The document came after the count (flag `dockCountFirst`): it is read in the background. */
  countFirst?: boolean;
  /** Closed on this phone with no signal: the close waits in the outbox and goes by itself. */
  closeQueued: boolean;
  resetLabel: string;
  onReset: () => void;
  /** A second way out, to the deliveries list, when the first button goes to the next delivery. */
  listLabel?: string;
  onList?: () => void;
  /** Below the summary, above the bar (the dock slip). */
  children?: React.ReactNode;
}) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();
  const time = confirmedAt ? formatDate(confirmedAt, locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const lines = result?.lines.length ?? 0;
  const items = td('delivery.dock.items', { count: lines, n: formatNumber(lines, locale) });
  const n = gaps.length;
  const scanHref = invoiceHref ?? (capturedImage?.scanRouteUrl ? (capturedImage.publicUrl ?? capturedImage.scanRouteUrl) : null);
  const docText =
    doc === 'none'
      ? td('delivery.dock.done.docNone')
      : doc === 'queued' || (closeQueued && countFirst)
        ? td('delivery.dock.done.docLater')
        : countFirst
          ? td('delivery.dock.done.docReading')
          : td('delivery.dock.done.docDone');

  return (
    <div dir={dir} className="mx-auto w-full max-w-xl py-2" data-testid="receipt-confirmed" data-queued={closeQueued ? 'true' : 'false'}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-pill border border-ok-subtle bg-ok-subtle text-ok">
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 tabIndex={-1} data-step-heading="" className="text-title-lg text-ink outline-none">
            {closeQueued ? td('delivery.dock.done.titleQueued') : t('steps.confirmed.title')}
          </h1>
          {/* A close found waiting on this phone at reopen has no count on screen: no summary to give. */}
          {result ? (
            <p className="text-body text-muted" data-testid="confirmed-summary">
              {td('delivery.dock.done.sum', {
                items,
                rest: n > 0 ? td('delivery.dock.check.gaps', { count: n, n: formatNumber(n, locale) }) : td('delivery.dock.done.clean'),
              })}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="mb-4 divide-y divide-line rounded-card border border-line bg-surface text-body">
        <Row term={td('delivery.dock.done.supplier')}>
          <span>{supplierName}</span>
          {time ? <span className="text-muted"> · {td('delivery.dock.done.at', { time })}</span> : null}
        </Row>
        {n > 0 ? (
          <Row term={td('delivery.dock.done.gaps', { count: n })}>
            <GapList gaps={gaps} />
          </Row>
        ) : null}
        {bulkCount > 0 ? (
          <Row term={td('delivery.dock.done.notCounted')} testId="confirmed-bulk-note">
            {td('delivery.dock.done.bulk', { count: bulkCount, n: formatNumber(bulkCount, locale) })}
          </Row>
        ) : null}
        <Row term={td('delivery.dock.done.doc')} testId="confirmed-doc">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {docText}
              {invoiceNumber ? (
                <>
                  {' · '}
                  <bdi className="font-semibold text-ink">{invoiceNumber}</bdi>
                </>
              ) : null}
            </span>
            {scanHref ? (
              <a
                href={scanHref}
                {...(invoiceHref ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-control border border-line px-3 font-semibold text-primary"
                data-testid="confirmed-invoice-link"
              >
                {invoiceHref ? td('delivery.confirmed.viewInvoice') : t('steps.confirmed.viewScan')}
                {invoiceHref ? null : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
              </a>
            ) : null}
          </span>
        </Row>
        {closeQueued ? (
          <Row term={td('delivery.dock.done.sending')}>
            <span role="status" data-testid="close-queued">
              {td('delivery.dock.done.sendingAuto')}
            </span>
          </Row>
        ) : (
          <Row term={td('delivery.dock.done.saving')}>{td('delivery.dock.done.saved')}</Row>
        )}
        {receivedBy ? (
          <Row term={td('delivery.dock.done.receiver')} testId="confirmed-received-by">
            {receivedBy}
          </Row>
        ) : null}
      </dl>

      {amount ? <p className="mb-4 text-body text-muted">{amount}</p> : null}

      {children}

      <ActionBar testId="confirmed-actions">
        <Button size="xl" onClick={onReset} className={PHONE_CTA} data-testid="confirmed-next" iconEnd={<ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" />}>
          {resetLabel}
        </Button>
        {onList && listLabel ? (
          <Button size="lg" variant="tertiary" onClick={onList} className="min-h-12" data-testid="confirmed-list">
            {listLabel}
          </Button>
        ) : null}
      </ActionBar>
    </div>
  );
}

function Row({ term, children, testId }: { term: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4" data-testid={testId}>
      <dt className="shrink-0 text-body-sm font-semibold text-muted sm:w-32 sm:pt-0.5">{term}</dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}
