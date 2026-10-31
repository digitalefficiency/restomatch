'use client';

import { AlertTriangle, ArrowLeft, Check, Clock, Info, Plus, RefreshCw, X, Zap } from 'lucide-react';
import { lineTotalIls } from '@/app/dashboard/orders/order-logic';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { Translator } from '@/lib/i18n/translate';
import { messageTemplates, telLink, waLink } from '@/lib/messageTemplates';
import { formatIls } from '@/lib/money';
import type { LineStatus, ReconciliationLine, ReconciliationResult } from '../_mock';
import { noLinePaired, reconSections, type ReconSection } from '../_state';
import { ActionBar, PRIMARY_56, SECONDARY_48 } from './ActionBar';
import { HebrewToggle, ItemName, Qty } from './english';
import { StepHeader } from './SupplierSelect';

/** Below this OCR confidence the review says "compare with the paper" (R-11: confidence only when low).
 *  PLACEHOLDER: the per-restaurant `ocrReviewThreshold` is not exposed to the client yet. */
export const LOW_READ_CONFIDENCE = 0.85;

type T = Translator<typeof receiving.he>;

interface Props {
  result: ReconciliationResult;
  /** Unused: "everything arrived" lives on the Delivery Check now (RCV-01/14). Kept for the showcase wiring. */
  onQuickConfirm?: () => void;
  onContinueAdjust: () => void;
  onRetake: () => void;
  /** Optional per-line sub-line (flag `dockPriceContext`: "your usual price"). */
  lineExtra?: (line: ReconciliationLine) => React.ReactNode;
  eyebrow?: string;
  /** Under the lines, above the bar (the dock-slip button). */
  children?: React.ReactNode;
  /** Prices and totals. Off for the receiver and the chef (owner decision): quantities only. Default on (showcase). */
  showMoney?: boolean;
}

/**
 * The invoice compared with the order — read-only facts (RCV-14): one summary
 * sentence (no zero tiles), every line once, no client-side ₪ estimate (the ₪
 * comes only from the engine, on the dock slip — RCV-11), and ONE primary: on
 * to the Delivery Check, where every line is counted.
 */
export function Reconciliation({ result, onContinueAdjust, onRetake, lineExtra, eyebrow, children, showMoney = true }: Props) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();

  const n = (v: number) => formatNumber(v, locale);
  const s = result.summary;
  const summary = [
    td('delivery.review.lines', { count: n(result.lines.length) }),
    s.qtyDiffCount + s.priceDiffCount > 0 ? td('delivery.review.differ', { count: n(s.qtyDiffCount + s.priceDiffCount) }) : null,
    s.unorderedCount > 0 ? td('delivery.review.unordered', { count: n(s.unorderedCount) }) : null,
    (s.pendingCount ?? 0) > 0 ? td('delivery.review.pending', { count: n(s.pendingCount ?? 0) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lowConfidence = !result.invoiceMeta.noInvoice && result.invoiceMeta.ocrConfidence < LOW_READ_CONFIDENCE;

  // null = money hidden for this viewer; every ₪ below goes through this.
  const money = showMoney ? (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 }) : null;

  // Say "wrong invoice?" instead of listing every line as "pending review".
  const mismatch = noLinePaired(result.lines);
  const sections = reconSections(result.lines);

  const renderCard = (line: ReconciliationLine, i: number) =>
    line.status === 'matched' ? (
      // Invoice = order: one compact row, not a full card (RCV-14).
      <li key={`${line.productName}-${i}`} className="recon-row flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <ItemName he={line.productName} en={line.productNameEn} className="text-base font-semibold text-ink" />
        <span className="flex shrink-0 items-center gap-2 text-base text-muted">
          <Qty qty={line.invoiceQty} unit={line.invoiceUnit} />
          <StatusBadge status={line.status} t={t} />
        </span>
      </li>
    ) : (
    <li
      key={`${line.productName}-${i}`}
      className={`recon-row rounded-2xl border p-4 ${cardBorder(line.status)} ${rowTone(line.status)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <ItemName
          he={line.productName}
          en={line.productNameEn}
          strike={line.status === 'missing_from_invoice'}
          className="text-base font-semibold text-ink"
        />
        <StatusBadge status={line.status} t={t} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-base">
        <div>
          <dt className="text-sm text-muted">{t('steps.recon.ordered')}</dt>
          <dd className="text-ink">
            <LineQty qty={line.poQty} unit={line.poUnit} price={line.poUnitPrice} money={money} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('steps.recon.invoiced')}</dt>
          <dd className="text-ink">
            <LineQty qty={line.invoiceQty} unit={line.invoiceUnit} price={line.invoiceUnitPrice} total={line.invoiceLineTotal} money={money} />
          </dd>
        </div>
      </dl>
      {line.status === 'price_diff' ? <p className="mt-2 text-sm text-muted">{td('delivery.review.priceToManager')}</p> : null}
      {lineExtra?.(line)}
      {line.sku ? <div className="mt-1 font-mono text-sm text-muted" dir="ltr">{line.sku}</div> : null}
    </li>
  );

  const renderRow = (line: ReconciliationLine, i: number) => (
    <tr key={`${line.productName}-${i}`} className={`recon-row border-t border-line ${rowTone(line.status)}`}>
      <td className="p-3 font-mono tabular-nums text-muted text-sm whitespace-nowrap" dir="ltr">
        {line.sku ?? '—'}
      </td>
      <td className="p-3 font-medium text-ink">
        <ItemName he={line.productName} en={line.productNameEn} strike={line.status === 'missing_from_invoice'} />
        {lineExtra?.(line)}
      </td>
      <td className="p-3 text-muted">
        <LineQty qty={line.poQty} unit={line.poUnit} price={line.poUnitPrice} money={money} />
      </td>
      <td className="p-3 text-muted">
        <LineQty qty={line.invoiceQty} unit={line.invoiceUnit} price={line.invoiceUnitPrice} total={line.invoiceLineTotal} money={money} />
      </td>
      <td className="p-3">
        <StatusBadge status={line.status} t={t} />
      </td>
    </tr>
  );

  return (
    <div dir={dir}>
      <StepHeader
        compact
        eyebrow={eyebrow}
        title={t('steps.recon.title')}
        subtitle={
          result.invoiceMeta.noInvoice
            ? t('steps.recon.subtitleNoInvoice')
            : td('delivery.review.invoice', { number: result.invoiceMeta.invoiceNumber })
        }
      />

      <p className="mb-4 text-lg font-semibold text-ink" data-testid="recon-summary">
        {summary}
      </p>
      {lowConfidence ? (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-base text-ink" data-testid="recon-low-confidence">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          {td('delivery.review.lowConfidence')}
        </p>
      ) : null}

      {/* Supplier-contact change alerts (e.g. agent phone changed since last invoice) */}
      {result.contactAlerts && result.contactAlerts.length > 0 ? (
        <div className="mb-6 space-y-3">
          {result.contactAlerts.map((a, i) => {
            const msg = messageTemplates.agentVerification({
              supplierName: t('steps.recon.theSupplier'),
              role: a.role,
              name: a.name ?? undefined,
              newPhone: a.newPhone,
            });
            return (
              <div key={i} className="rounded-2xl border border-warn/40 bg-warn/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{t('steps.recon.agentChanged')}</div>
                    <div className="text-sm text-muted mt-1">
                      {t('steps.recon.phoneChanged', {
                        who: `${a.role}${a.name ? ` · ${a.name}` : ''}`,
                        old: a.oldPhone,
                        new: a.newPhone,
                      })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span className="text-sm text-muted">{t('steps.recon.verifyWhatsapp')}</span>
                      {a.allNumbers.map((p) => (
                        <a
                          key={p}
                          href={waLink(p, msg)}
                          target="_blank"
                          rel="noopener noreferrer"
                          dir="ltr"
                          className="inline-flex min-h-11 items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          {p}
                        </a>
                      ))}
                      <a
                        href={telLink(a.newPhone)}
                        className="inline-flex min-h-11 items-center gap-1 bg-surface-2 border border-line text-muted rounded-xl px-3 py-1.5 text-sm font-medium hover:text-ink transition-all"
                      >
                        {t('steps.recon.call')}
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {mismatch ? (
        <div
          role="status"
          data-testid="recon-mismatch-banner"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-surface-2 px-5 py-4"
        >
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="text-sm text-ink">{t('steps.recon.mismatchBanner')}</div>
        </div>
      ) : (result.summary.pendingCount ?? 0) > 0 ? (
        <div
          role="status"
          data-testid="recon-pending-banner"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-surface-2 px-5 py-4"
        >
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="text-sm text-ink">
            {t('steps.recon.pendingBanner', { count: result.summary.pendingCount ?? 0 })}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex justify-end">
        <HebrewToggle />
      </div>

      {/* Mobile: one card per line (receivers use phones), grouped by side. */}
      <div className="mb-6 space-y-5 md:hidden" data-testid="recon-cards">
        {sections ? (
          sections.map((s) => (
            <section key={s.key} data-testid={`recon-section-${s.key}`}>
              <h2 className="mb-2 text-sm font-semibold text-muted">
                <SectionLabel section={s} t={t} money={money} />
              </h2>
              <ul className="space-y-2">{s.items.map(({ line, index }) => renderCard(line, index))}</ul>
            </section>
          ))
        ) : (
          <ul className="space-y-2">{result.lines.map((line, i) => renderCard(line, i))}</ul>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-2xl border border-line bg-surface overflow-hidden shadow-card mb-6">
        <table className="w-full text-sm" data-testid="recon-table">
          <thead className="bg-surface-2 text-muted text-sm ltr:uppercase ltr:tracking-wider ltr:text-xs">
            <tr>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colSku')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colProduct')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colOrdered')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colInvoiced')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colStatus')}</th>
            </tr>
          </thead>
          {sections ? (
            sections.map((s) => (
              <tbody key={s.key} data-testid={`recon-section-${s.key}`}>
                <tr className="border-t border-line bg-surface-2">
                  <th colSpan={5} scope="colgroup" className="p-3 text-start text-sm font-semibold text-muted">
                    <SectionLabel section={s} t={t} money={money} />
                  </th>
                </tr>
                {s.items.map(({ line, index }) => renderRow(line, index))}
              </tbody>
            ))
          ) : (
            <tbody>{result.lines.map((line, i) => renderRow(line, i))}</tbody>
          )}
        </table>
      </div>

      {children}

      <ActionBar testId="recon-actions">
        <button type="button" onClick={onRetake} className={SECONDARY_48}>
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          {t('steps.recon.retake')}
        </button>
        <button type="button" onClick={onContinueAdjust} data-testid="continue-adjust" className={PRIMARY_56}>
          {t('steps.recon.continueAdjust')}
          <ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" />
        </button>
      </ActionBar>
    </div>
  );
}

/** "רק בחשבונית · 2 · ₪34.00": which side the lines are on, how many, and what they come to. */
function SectionLabel({
  section,
  t,
  money,
}: {
  section: ReconSection;
  t: T;
  money: ((v: number) => string) | null;
}) {
  const count = section.items.length;
  const label =
    section.key === 'both'
      ? t('steps.recon.sectionBoth', { count })
      : section.key === 'invoiceOnly'
        ? t('steps.recon.sectionInvoiceOnly', { count })
        : t('steps.recon.sectionOrderOnly', { count });
  return (
    <>
      {label}
      {section.totalIls !== null && money ? (
        <>
          {' · '}
          <bdi className="tabular-nums">{money(section.totalIls)}</bdi>
        </>
      ) : null}
    </>
  );
}

function LineQty({
  qty,
  unit,
  price,
  total,
  money,
}: {
  qty: number | null;
  unit: string | null;
  price: number | null;
  /** Printed line total (invoice side); else qty × price. */
  total?: number | null;
  money: ((v: number) => string) | null;
}) {
  if (qty === null) return <span className="text-muted">—</span>;
  if (!money) return <Qty qty={qty} unit={unit} />;
  // The × sits between its own isolates so it reads "37.5 ליטר × ₪6.43" in
  // both directions; inside one LTR isolate with the price it drifted to the
  // far left in RTL ("× 6.43₪ 37.5 ליטר").
  return (
    <span className="flex flex-col gap-0.5">
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <Qty qty={qty} unit={unit} />
        {price !== null ? (
          <>
            <span className="text-sm text-muted">×</span>
            <bdi className="text-sm tabular-nums text-muted">{money(price)}</bdi>
          </>
        ) : null}
      </span>
      {price !== null ? (
        <bdi className="self-start tabular-nums text-ink">{money(total ?? lineTotalIls(qty, price))}</bdi>
      ) : null}
    </span>
  );
}

/** Card border: a line that differs from the order is outlined in its tone. */
function cardBorder(status: LineStatus): string {
  if (status === 'qty_diff' || status === 'price_diff') return 'border-warn/50';
  if (status === 'unordered') return 'border-danger/50';
  return 'border-line';
}

function rowTone(status: LineStatus): string {
  switch (status) {
    case 'matched':
      return 'bg-surface';
    case 'qty_diff':
      return 'bg-warn/8';
    case 'price_diff':
      return 'bg-warn/8';
    case 'unordered':
      return 'bg-danger/8';
    case 'missing_from_invoice':
      return 'bg-surface-2';
    case 'pending_review':
      return 'bg-surface';
  }
}

const STATUS_STYLE: Record<LineStatus, { tint: string; icon: React.ReactNode }> = {
  matched: { tint: 'bg-primary/12 text-primary ring-1 ring-primary/25', icon: <Check className="w-3 h-3" strokeWidth={3} /> },
  // T2 "act now": lines that differ from the order get solid badges.
  qty_diff: { tint: 'bg-warn text-on-primary ring-1 ring-warn', icon: <AlertTriangle className="w-3 h-3" /> },
  price_diff: { tint: 'bg-warn text-on-primary ring-1 ring-warn', icon: <Zap className="w-3 h-3" /> },
  unordered: { tint: 'bg-danger text-on-primary ring-1 ring-danger', icon: <Plus className="w-3 h-3" strokeWidth={3} /> },
  missing_from_invoice: { tint: 'bg-surface-2 text-muted ring-1 ring-line', icon: <X className="w-3 h-3" strokeWidth={3} /> },
  // Neutral by design (calm UX): an unchecked line is never a red alarm.
  pending_review: { tint: 'bg-surface-2 text-muted ring-1 ring-line', icon: <Clock className="w-3 h-3" /> },
};

export function StatusBadge({ status, t }: { status: LineStatus; t: T }) {
  const info = STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${info.tint}`}>
      {info.icon}
      <span>{t(`steps.status.${status}`)}</span>
    </span>
  );
}

export type { ReconciliationLine };
