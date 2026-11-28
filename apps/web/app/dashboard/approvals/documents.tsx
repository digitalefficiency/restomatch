'use client';

import Link from 'next/link';
import { Box, ChevronDown } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { Button } from '@/lib/components/Button';
import { Skeleton } from '@/lib/components/Skeleton';
import { cn } from '@/lib/components/cn';
import { Icon, ReceiptGlyph } from '@/lib/components/icon';
import { DateTime } from '@/lib/components/money/DateTime';
import { Money } from '@/lib/components/money/Money';
import { qtyOverKindOf, tierOf, toNumber4, units4 } from './desk-facts';
import { itemName, qtyText } from './desk-text';
import type { DeskMode, GapDocument, PaperLine, QueueItem } from './desk-types';

/** A delayed skeleton: nothing before 1 s, reduced motion included (R12: the global rule would show it at once). */
const SKEL = 'h-4 motion-essential motion-reduce:duration-0';
const CARD = 'rounded-card border border-line-rule bg-surface p-3 ps-3.5 pb-3.5';
const HEAD = 'mb-2 flex items-center gap-1.5';
const H3 = 'flex items-center gap-1.5 text-body-sm font-medium text-fg-secondary';
/** Forced colours drop the tint: the hit line gets an outline on the focus dial (§4.10). */
const FC_OUTLINE =
  'forced-colors:[outline:var(--focus-width)_solid_Highlight] forced-colors:[outline-offset:calc(var(--focus-width)*-1)]';
/** The hit line wears the flagged cell's tint of its tone (block → leak, warn → warn, info → neutral). */
const HIT_TINT = {
  block: 'bg-danger-subtle shadow-[inset_0_0_0_1px_rgb(var(--c-danger-border-subtle))]',
  warn: 'bg-warn-subtle shadow-[inset_0_0_0_1px_rgb(var(--c-warn-border-subtle))]',
  info: 'bg-surface-sunken shadow-[inset_0_0_0_1px_rgb(var(--c-neutral-border-subtle))]',
} as const;
const CELL = 'px-1.5 py-1';
const NUM_CELL = 'num whitespace-nowrap px-1.5 py-1 text-right';

type Slot = { kind: 'line'; line: PaperLine } | { kind: 'skeleton'; key: string };

/** The paper's rows (§5.13): the hit line first, then up to two others — three fixed slots while loading, so nothing
 *  shifts when the lines arrive; on error the hit line only. */
function slotsOf(doc: GapDocument): Slot[] {
  const skel = (key: string): Slot => ({ kind: 'skeleton', key });
  switch (doc.status) {
    case 'loading':
      return [doc.own ? { kind: 'line', line: doc.own } : skel('s0'), skel('s1'), skel('s2')];
    case 'error':
      return doc.own ? [{ kind: 'line', line: doc.own }] : [];
    case 'ready':
      return doc.lines.map((line) => ({ kind: 'line', line }));
    default:
      return [];
  }
}

/** What the receipt counted, only when the row carries it (5b → E, 5a / QTY_SHORT → A, MISSING → Qr; PO unit). */
function countedOf(g: QueueItem): bigint | null {
  switch (g.type) {
    case 'QTY_OVER':
      return qtyOverKindOf(g) === '5b' ? units4(g.expectedValue) : units4(g.actualValue);
    case 'QTY_SHORT':
      return units4(g.actualValue);
    case 'MISSING_ON_INVOICE':
      return units4(g.qtyReceived);
    default:
      return null;
  }
}

export interface DocumentsBlockProps {
  g: QueueItem;
  doc: GapDocument;
  mode: DeskMode;
}

/**
 * The documents behind a gap (DS3-04 spec §4.4, §5.13): the invoice's paper — its lines with the gap's own line
 * marked, prices before VAT, the scan photo behind a closed disclosure — and the goods receipt. The row's own line
 * shows at once; the other lines arrive with `invoices.detail` (`useGapDocument`, the controller side). Values that
 * the server withholds render empty, never ₪0. No line number is ever derived (§0.4).
 */
export function DocumentsBlock({ g, doc }: DocumentsBlockProps) {
  const paper = doc.status !== 'none';
  const receipt = receiptOf(g, doc);
  return (
    // Side by side from a 40rem evidence column — only when both cards are there (one card takes the full width).
    <div className={cn('mt-2.5 grid gap-2.5', paper && receipt && '[@container_(min-width:40rem)]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]')}>
      {paper ? <PaperCard g={g} doc={doc} /> : null}
      {receipt ? <ReceiptCard g={g} receipt={receipt} /> : null}
    </div>
  );
}

function PaperCard({ g, doc }: { g: QueueItem; doc: Exclude<GapDocument, { status: 'none' }> }) {
  const t = useT(approvals);
  const locale = useLocale();
  const slots = slotsOf(doc);
  const tone = tierOf(g);
  // Today's link, now to the gap's own line (the invoice page renders id="line-<id>", cockpit.tsx).
  const href = g.invoiceId
    ? `/dashboard/invoices/${g.invoiceId}${g.invoiceLineId ? `#line-${g.invoiceLineId}` : ''}`
    : null;
  const photo = g.invoiceId != null && (g.hasScan === true || (doc.status === 'ready' && doc.hasImage));
  return (
    <div data-testid="desk-docs-paper" className={CARD}>
      <div className={HEAD}>
        <h3 className={H3}>
          <Icon as={ReceiptGlyph} size="body-sm" />
          {t('desk.docs.paperTitle')}
        </h3>
        {/* The lines' prices and totals are before VAT (R7g). */}
        <span className="text-caption text-fg-tertiary">{t('summary.atRiskBasis')}</span>
        {href ? (
          <Link
            href={href}
            className="ms-auto inline-flex min-h-6 items-center text-body-sm font-medium text-primary underline-offset-2 hover:underline [@media(pointer:coarse)]:min-h-11"
          >
            {t('desk.openInvoice')}
          </Link>
        ) : null}
      </div>
      {slots.length > 0 ? (
        <table className="w-full table-fixed rounded-control bg-surface text-caption text-fg-secondary ring-1 ring-line shadow-e1">
          <caption className="sr-only">{t('desk.sr.paperCaption')}</caption>
          <colgroup>
            <col />
            {/* Wide enough for "10.5 ק״ג", "₪149.00" and "₪12,490.00" at caption size: figures never run together. */}
            <col className="w-14" />
            <col className="w-16" />
            <col className="w-20" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={cn(CELL, 'text-start font-medium text-fg-tertiary')}>
                {t('desk.docs.colItem')}
              </th>
              <th scope="col" className={cn(NUM_CELL, 'font-medium text-fg-tertiary')}>
                {t('desk.table.qty')}
              </th>
              <th scope="col" className={cn(NUM_CELL, 'font-medium text-fg-tertiary')}>
                {t('desk.docs.colPrice')}
              </th>
              <th scope="col" className={cn(NUM_CELL, 'font-medium text-fg-tertiary')}>
                {t('desk.docs.colTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) =>
              slot.kind === 'skeleton' ? (
                <tr key={slot.key}>
                  <td colSpan={4} className={CELL}>
                    <Skeleton delayed className={SKEL} />
                  </td>
                </tr>
              ) : (
                <tr
                  key={slot.line.id}
                  data-testid={slot.line.hit ? 'desk-paper-hit' : undefined}
                  aria-current={slot.line.hit ? 'true' : undefined}
                  className={slot.line.hit ? cn('font-medium text-fg', HIT_TINT[tone], FC_OUTLINE) : undefined}
                >
                  <td className={cn(CELL, 'truncate')}>
                    {slot.line.hit ? <span className="sr-only">{t('desk.sr.hitLine')}</span> : null}
                    <bdi>{slot.line.hit ? slot.line.name || itemName(locale, g) : slot.line.name}</bdi>
                  </td>
                  <td className={NUM_CELL}>{slot.line.qty4 != null ? qtyText(locale, slot.line.qty4, slot.line.unit) : null}</td>
                  <td className={NUM_CELL}>
                    {slot.line.unitPrice4 != null ? <Money value={toNumber4(slot.line.unitPrice4)} context="unit" /> : null}
                  </td>
                  <td className={NUM_CELL}>
                    {slot.line.totalAgorot != null ? <Money agorot={Number(slot.line.totalAgorot)} context="line" /> : null}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      ) : null}
      {doc.status === 'ready' && doc.more > 0 ? (
        <p className="num mt-2 text-caption text-fg-tertiary">{t('desk.docs.more', { count: doc.more })}</p>
      ) : null}
      {doc.status === 'error' ? (
        <>
          <p className="mt-2 text-caption text-fg-secondary">{t('desk.docs.unavailable')}</p>
          <Button variant="ghost" size="sm" onClick={() => doc.retry()}>
            {t('card.retry')}
          </Button>
        </>
      ) : null}
      {photo ? (
        // Closed by default: an image inside a closed <details> is not fetched, so J/K never download a photo (P4).
        <details data-testid="desk-docs-photo" className="group/photo mt-2.5">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 text-body-sm font-medium text-primary [@media(pointer:coarse)]:min-h-11 [&::-webkit-details-marker]:hidden">
            <Icon as={ChevronDown} size="body-sm" className="transition-transform duration-micro ease-standard group-open/photo:rotate-180" />
            {t('desk.evidenceScan')}
          </summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/scans/${g.invoiceId}/file`}
            alt={t('desk.evidenceScan')}
            loading="lazy"
            className="mt-2 max-h-[50vh] w-full rounded-control border border-line-rule bg-surface-sunken object-contain"
          />
        </details>
      ) : null}
    </div>
  );
}

/** What the receipt card shows: the count the row carries, when the receipt started (a delayed skeleton while the
 *  document loads; nothing on error), or that no receipt is linked. Null: nothing to show, no card. */
interface ReceiptFacts {
  counted: bigint | null;
  started: Date | 'loading' | null;
  none: boolean;
}
function receiptOf(g: QueueItem, doc: GapDocument): ReceiptFacts | null {
  const counted = countedOf(g);
  const started = doc.status === 'ready' ? doc.grReceivedAt : doc.status === 'loading' ? 'loading' : null;
  // No linked receipt: said once the document is known (or when there is no invoice to ask about).
  const none = counted == null && ((doc.status === 'ready' && doc.grId === null) || doc.status === 'none');
  return counted == null && started == null && !none ? null : { counted, started, none };
}

function ReceiptCard({ g, receipt }: { g: QueueItem; receipt: ReceiptFacts }) {
  const t = useT(approvals);
  const locale = useLocale();
  const { counted, none } = receipt;
  const started =
    receipt.started === 'loading' ? (
      <Skeleton delayed className={cn(SKEL, 'w-28')} />
    ) : receipt.started ? (
      <DateTime value={receipt.started} variant="datetime" />
    ) : null;
  return (
    <div data-testid="desk-docs-receipt" className={CARD}>
      <div className={HEAD}>
        <h3 className={H3}>
          <Icon as={Box} size="body-sm" />
          {t('desk.docs.receiptTitle')}
        </h3>
      </div>
      {counted != null || started != null ? (
        <dl className="grid gap-1.5 text-body-sm">
          {counted != null ? (
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-fg-tertiary">{t('desk.docs.receiptCounted')}</dt>
              <dd className="num text-fg">{qtyText(locale, counted, g.orderedUnit)}</dd>
            </div>
          ) : null}
          {started != null ? (
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-fg-tertiary">{t('desk.docs.receiptStarted')}</dt>
              <dd className="min-w-0 text-fg">{started}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {none ? <p className="text-body-sm text-fg-secondary">{t('desk.docs.noReceipt')}</p> : null}
    </div>
  );
}
