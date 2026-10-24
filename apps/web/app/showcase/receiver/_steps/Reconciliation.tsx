'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { AlertTriangle, ArrowLeft, Check, Clock, Info, Minus, Plus, X, Zap } from 'lucide-react';
import { useRef } from 'react';
import { lineTotalIls } from '@/app/dashboard/orders/order-logic';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatPercent } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import type { Translator } from '@/lib/i18n/translate';
import { messageTemplates, telLink, waLink } from '@/lib/messageTemplates';
import { formatIls } from '@/lib/money';
import type { LineStatus, ReconciliationLine, ReconciliationResult } from '../_mock';
import { noLinePaired, reconSections, type ReconSection } from '../_state';
import { HebrewToggle, ItemName, Qty } from './english';
import { StepHeader } from './SupplierSelect';

type T = Translator<typeof receiving.he>;

interface Props {
  result: ReconciliationResult;
  onQuickConfirm: () => void;
  onContinueAdjust: () => void;
  onRetake: () => void;
}

export function Reconciliation({ result, onQuickConfirm, onContinueAdjust, onRetake }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT(receiving);
  const locale = useLocale();
  const dir = useDir();

  useGSAP(
    () => {
      gsap.from('.kpi-card', {
        y: 16,
        opacity: 0,
        stagger: 0.05,
        duration: 0.4,
        ease: 'power3.out',
      });
      gsap.from('.recon-row', {
        y: 8,
        opacity: 0,
        stagger: 0.03,
        duration: 0.35,
        ease: 'power2.out',
        delay: 0.2,
      });
    },
    { scope: ref },
  );

  const allGood =
    result.summary.qtyDiffCount +
      result.summary.priceDiffCount +
      result.summary.unorderedCount +
      result.summary.missingCount ===
    0;

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });

  // Say "wrong invoice?" instead of listing every line as "pending review".
  const mismatch = noLinePaired(result.lines);
  const sections = reconSections(result.lines);

  const renderCard = (line: ReconciliationLine, i: number) => (
    <li
      key={`${line.productName}-${i}`}
      className={`recon-row rounded-2xl border border-line p-4 ${rowTone(line.status)}`}
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
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-subtle">{t('steps.recon.ordered')}</dt>
          <dd className="text-ink">
            <LineQty qty={line.poQty} unit={line.poUnit} price={line.poUnitPrice} money={money} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">{t('steps.recon.invoiced')}</dt>
          <dd className="text-ink">
            <LineQty qty={line.invoiceQty} unit={line.invoiceUnit} price={line.invoiceUnitPrice} total={line.invoiceLineTotal} money={money} />
          </dd>
        </div>
      </dl>
      {line.deltaIls > 0 ? (
        <div className="mt-2 text-sm font-semibold text-danger">
          <bdi dir="ltr" className="font-mono tabular-nums">+{money(line.deltaIls)}</bdi>
        </div>
      ) : null}
      {line.sku ? <div className="mt-1 font-mono text-xs text-subtle" dir="ltr">{line.sku}</div> : null}
    </li>
  );

  const renderRow = (line: ReconciliationLine, i: number) => (
    <tr key={`${line.productName}-${i}`} className={`recon-row border-t border-line ${rowTone(line.status)}`}>
      <td className="p-3 font-mono tabular-nums text-subtle text-xs whitespace-nowrap" dir="ltr">
        {line.sku ?? '—'}
      </td>
      <td className="p-3 font-medium text-ink">
        <ItemName he={line.productName} en={line.productNameEn} strike={line.status === 'missing_from_invoice'} />
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
      <td className="p-3 font-mono tabular-nums">
        {line.deltaIls > 0 ? (
          <bdi dir="ltr" className="text-danger font-semibold">+{money(line.deltaIls)}</bdi>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
    </tr>
  );

  return (
    <div ref={ref} dir={dir}>
      <StepHeader
        eyebrow={t('steps.stepOf', { current: 4, total: 5 })}
        title={t('steps.recon.title')}
        subtitle={result.invoiceMeta.noInvoice ? t('steps.recon.subtitleNoInvoice') : t('steps.recon.subtitle', {
          number: result.invoiceMeta.invoiceNumber,
          confidence: formatPercent(result.invoiceMeta.ocrConfidence, locale, 0),
        })}
      />

      {/* KPI Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile label={t('steps.recon.matched')} value={result.summary.matchedCount} icon={<Check className="w-5 h-5" />} tone="primary" />
        <KpiTile
          label={t('steps.recon.different')}
          value={result.summary.qtyDiffCount + result.summary.priceDiffCount}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="warn"
        />
        <KpiTile label={t('steps.recon.unordered')} value={result.summary.unorderedCount} icon={<Plus className="w-5 h-5" />} tone="danger" />
        <KpiTile label={t('steps.recon.missing')} value={result.summary.missingCount} icon={<Minus className="w-5 h-5" />} tone="neutral" />
      </div>

      {/* Headline delta */}
      {result.summary.headlineDelta > 0 ? (
        <div className="mb-6 relative overflow-hidden rounded-2xl border border-warn/25 bg-warn/8 px-5 py-4 flex items-center gap-3">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-0.5 leak-gradient" />
          <Zap className="w-5 h-5 text-warn shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink">
              {t('steps.recon.potentialLoss')}{' '}
              <bdi dir="ltr" className="font-mono tabular-nums text-danger">
                {money(result.summary.headlineDelta)}
              </bdi>
            </div>
            <div className="text-xs text-muted mt-0.5">{t('steps.recon.potentialLossHint')}</div>
          </div>
        </div>
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
              <div key={i} className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
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
      <div className="mb-6 space-y-5" data-testid="recon-cards">
        {sections ? (
          sections.map((s) => (
            <section key={s.key} data-testid={`recon-section-${s.key}`}>
              <h2 className="mb-2 text-xs font-semibold text-muted">
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
          <thead className="bg-surface-2 text-subtle text-xs uppercase tracking-wider">
            <tr>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colSku')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colProduct')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colOrdered')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colInvoiced')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colStatus')}</th>
              <th className="text-start p-3 font-semibold">{t('steps.recon.colDelta')}</th>
            </tr>
          </thead>
          {sections ? (
            sections.map((s) => (
              <tbody key={s.key} data-testid={`recon-section-${s.key}`}>
                <tr className="border-t border-line bg-surface-2">
                  <th colSpan={6} scope="colgroup" className="p-3 text-start text-xs font-semibold text-muted">
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

      {/* Bottom CTAs */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onRetake}
          className="min-h-11 text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
        >
          {t('steps.recon.retake')}
        </button>
        <div className="flex flex-col gap-2 sm:flex-row">
          {allGood && !mismatch ? (
            <button
              type="button"
              onClick={onQuickConfirm}
              className="inline-flex min-h-12 items-center justify-center gap-2 bg-gold hover:brightness-110 text-on-primary rounded-xl px-5 py-3 font-medium shadow-glow-gold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-gold"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              {t('steps.recon.quickConfirm')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onContinueAdjust}
            data-testid="continue-adjust"
            className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary hover:brightness-110 text-on-primary rounded-xl px-5 py-3 font-medium shadow-glow-primary transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
          >
            {t('steps.recon.continueAdjust')}
            <ArrowLeft className="w-4 h-4 ltr:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </div>
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
  money: (v: number) => string;
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
      {section.totalIls !== null ? (
        <>
          {' · '}
          <bdi dir="ltr" className="font-mono tabular-nums">
            {money(section.totalIls)}
          </bdi>
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
  money: (v: number) => string;
}) {
  if (qty === null) return <span className="text-subtle">—</span>;
  // The × sits between its own isolates so it reads "37.5 ליטר × ₪6.43" in
  // both directions; inside one LTR isolate with the price it drifted to the
  // far left in RTL ("× 6.43₪ 37.5 ליטר").
  return (
    <span className="flex flex-col gap-0.5">
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <Qty qty={qty} unit={unit} />
        {price !== null ? (
          <>
            <span className="text-xs text-subtle">×</span>
            <bdi dir="ltr" className="font-mono text-xs tabular-nums text-subtle">
              {money(price)}
            </bdi>
          </>
        ) : null}
      </span>
      {price !== null ? (
        <bdi dir="ltr" className="self-start font-mono tabular-nums text-ink">
          {money(total ?? lineTotalIls(qty, price))}
        </bdi>
      ) : null}
    </span>
  );
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
  qty_diff: { tint: 'bg-warn/12 text-warn ring-1 ring-warn/25', icon: <AlertTriangle className="w-3 h-3" /> },
  price_diff: { tint: 'bg-warn/12 text-warn ring-1 ring-warn/25', icon: <Zap className="w-3 h-3" /> },
  unordered: { tint: 'bg-danger/12 text-danger ring-1 ring-danger/25', icon: <Plus className="w-3 h-3" strokeWidth={3} /> },
  missing_from_invoice: { tint: 'bg-surface-2 text-muted ring-1 ring-line', icon: <X className="w-3 h-3" strokeWidth={3} /> },
  // Neutral by design (calm UX): an unchecked line is never a red alarm.
  pending_review: { tint: 'bg-surface-2 text-muted ring-1 ring-line', icon: <Clock className="w-3 h-3" /> },
};

export function StatusBadge({ status, t }: { status: LineStatus; t: T }) {
  const info = STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${info.tint}`}>
      {info.icon}
      <span>{t(`steps.status.${status}`)}</span>
    </span>
  );
}

function KpiTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'primary' | 'warn' | 'danger' | 'neutral';
}) {
  const tints = {
    primary: { bg: 'bg-primary/8', border: 'border-primary/25', icon: 'text-primary', value: 'text-ink' },
    warn: { bg: 'bg-warn/8', border: 'border-warn/25', icon: 'text-warn', value: 'text-ink' },
    danger: { bg: 'bg-danger/8', border: 'border-danger/25', icon: 'text-danger', value: 'text-danger' },
    neutral: { bg: 'bg-surface-2', border: 'border-line', icon: 'text-muted', value: 'text-ink' },
  };
  const tone_ = tints[tone];
  return (
    <div className={`kpi-card rounded-2xl border ${tone_.border} ${tone_.bg} p-4`}>
      <div className={`mb-2 ${tone_.icon}`}>{icon}</div>
      <div className="text-xs text-muted font-medium mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${tone_.value}`}>{value}</div>
    </div>
  );
}

export type { ReconciliationLine };
