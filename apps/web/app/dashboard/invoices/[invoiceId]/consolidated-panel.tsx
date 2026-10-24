import { CheckCircle2, ClipboardList, Truck } from 'lucide-react';
import type { ConsolidatedProposal } from '@restomatch/api';
import { Badge, type BadgeTone } from '@/lib/components/Badge';
import { Card } from '@/lib/components/Card';
import { SectionHeader } from '@/lib/components';
import { displayName } from '@/lib/components/displayName';
import { UnitText } from '@/lib/components/UnitText';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as consolidatedHe } from '@/lib/i18n/messages/consolidated/he';
import { formatIls } from '@/lib/money';
import { PrintButton } from '../../leaks/claims/print-button';

type T = Translator<typeof consolidatedHe>;

const NOTE_TONE: Record<ConsolidatedProposal['deliveryNotes'][number]['status'], BadgeTone> = {
  covered: 'accent',
  partly: 'warning',
  not_billed: 'neutral',
};
const SETTLED = new Set(['matched', 'approved', 'paid']);
const PRODUCT_TONE: Record<ConsolidatedProposal['products'][number]['status'], BadgeTone> = {
  ok: 'accent',
  difference: 'danger-solid',
  not_received: 'danger-solid',
  not_billed: 'neutral',
};

/**
 * "הצלבה מול תעודות משלוח" — the read-only cross-match of a consolidated invoice
 * against the supplier's delivery notes. Tiers: the proposal itself is T4 (calm,
 * neutral — it is not counted yet); differences are T2 (solid badge + ₪ + one
 * primary action); a clean match is T3 (calm green).
 */
export function ConsolidatedPanel({ proposal, t, locale }: { proposal: ConsolidatedProposal; t: T; locale: Locale }) {
  // Agorot: a cross-match is about small differences (₪0.86 must not read as ₪1).
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const num = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 3 });
  const day = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short' });
  const period = `${formatDate(proposal.periodStart, locale, { day: 'numeric', month: 'short' })} – ${formatDate(
    new Date(new Date(proposal.periodEnd).getTime() - 1).toISOString(),
    locale,
    { day: 'numeric', month: 'short', year: 'numeric' },
  )}`;
  const { totals } = proposal;
  const cell = 'px-3 py-2';
  // A ריכוז already matched / approved / paid: the same cross-match, for reference.
  const settled = SETTLED.has(proposal.invoiceStatus);
  const noteDeltas = proposal.deliveryNotes.some((n) => n.deltaIls > 0);

  return (
    <section className="mt-10 min-w-0 max-w-full print:mt-0" aria-label={t('title')} data-testid="consolidated-panel">
      <SectionHeader title={t('title')} subtitle={t('subtitle', { period })} />

      {/* T4: a proposal, not counted yet — calm and neutral. */}
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="neutral" icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />}>
          {t(settled ? 'reference' : 'proposal')}
        </Badge>
        <span>{t(settled ? 'referenceNote' : 'proposalNote')}</span>
      </p>

      {proposal.status === 'differences' ? (
        // T2: act now — solid badge + ₪ + ONE primary action.
        <Card padding="md" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="xmatch-differences">
          <div>
            <Badge tone="danger-solid">{t('status.differences')}</Badge>
            <p className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-danger">
              {ils(totals.leakIls > 0 ? totals.leakIls : Math.max(totals.differenceIls, 0))}
            </p>
            {/* The copy follows the sign: "billed more than delivered" only when it is. */}
            <p className="text-sm text-muted">
              {totals.differenceIls > 0
                ? t('status.differencesBody', { amount: ils(totals.differenceIls) })
                : t('status.differencesBodyLines')}
            </p>
          </div>
          <div className="print:hidden">
            <PrintButton label={t('print')} primary />
          </div>
        </Card>
      ) : proposal.status === 'matched' ? (
        // T3: good news — calm green.
        <Card padding="md" className="mb-4 flex items-start gap-3" data-testid="xmatch-matched">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-semibold text-primary">{t('status.matched')}</p>
            <p className="text-sm text-muted">{t('status.matchedBody')}</p>
          </div>
        </Card>
      ) : (
        <Card padding="md" className="mb-4 flex items-start gap-3" data-testid="xmatch-none">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div>
            <p className="font-semibold text-ink">{t('status.none')}</p>
            <p className="text-sm text-muted">{t('status.noneBody')}</p>
          </div>
        </Card>
      )}

      {proposal.deliveryNotes.length > 0 ? (
        <>
          <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="xmatch-totals">
            {[
              [t('totals.notes'), ils(totals.deliveryNotesIls)],
              [t('totals.invoice'), ils(totals.invoiceSubtotalIls)],
              [t('totals.difference'), `${totals.differenceIls > 0 ? '+' : totals.differenceIls < 0 ? '−' : ''}${ils(Math.abs(totals.differenceIls))}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink" dir="ltr">
                  {/* bdi keeps a leading +/− with its ₪ amount in RTL. */}
                  <bdi dir="ltr" className="whitespace-nowrap">
                    {value}
                  </bdi>
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mb-2 text-sm font-semibold text-ink">{t('notes.title')}</h3>
          <div className="relative mb-6 max-w-full overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label={t('notes.title')}>
            <table className="w-full min-w-[28rem] text-sm" data-testid="xmatch-notes">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th scope="col" className={`${cell} text-start font-semibold`}>{t('notes.number')}</th>
                  <th scope="col" className={`${cell} text-start font-semibold`}>{t('notes.date')}</th>
                  <th scope="col" className={`${cell} text-start font-semibold`}>{t('notes.po')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('notes.value')}</th>
                  {noteDeltas ? <th scope="col" className={`${cell} text-end font-semibold`}>{t('notes.delta')}</th> : null}
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('notes.state')}</th>
                </tr>
              </thead>
              <tbody>
                {proposal.deliveryNotes.map((n) => (
                  <tr key={n.grId} className="border-t border-line">
                    <td className={`${cell} font-mono text-xs text-ink`}>{n.number ?? '—'}</td>
                    <td className={`${cell} text-ink`}>{day(n.receivedAt)}</td>
                    <td className={`${cell} font-mono text-xs text-muted`}>{n.poRef ?? t('notes.noRef')}</td>
                    <td className={`${cell} text-end font-mono tabular-nums text-ink`}>{ils(n.receivedValueIls)}</td>
                    {noteDeltas ? (
                      <td className={`${cell} text-end font-mono tabular-nums ${n.deltaIls > 0 ? 'font-semibold text-danger' : 'text-muted'}`}>
                        {n.deltaIls > 0 ? ils(n.deltaIls) : '—'}
                      </td>
                    ) : null}
                    <td className={`${cell} text-end`}>
                      <Badge tone={NOTE_TONE[n.status]}>{t(`notes.${n.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {proposal.products.length > 0 ? (
        <>
          <h3 className="mb-2 text-sm font-semibold text-ink">{t('products.title')}</h3>
          <div className="relative max-w-full overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label={t('products.title')}>
            <table className="w-full min-w-[36rem] text-sm" data-testid="xmatch-products">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th scope="col" className={`${cell} text-start font-semibold`}>{t('products.product')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('products.received')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('products.billed')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('products.poPrice')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('products.billedPrice')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>{t('products.delta')}</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>
                    <span className="sr-only">{t('notes.state')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {proposal.products.map((p) => {
                  const name = p.name ? displayName(p.name, p.nameEn, locale).primary : t('products.unnamed');
                  return (
                    <tr key={p.key} className="border-t border-line">
                      <td className={`${cell} font-medium text-ink`}>
                        {name}
                        {p.unit ? (
                          <span className="ms-1 text-xs text-subtle">
                            (<UnitText unit={p.unit} />)
                          </span>
                        ) : null}
                      </td>
                      <td className={`${cell} text-end font-mono tabular-nums text-ink`}>{num(p.qtyReceived)}</td>
                      <td className={`${cell} text-end font-mono tabular-nums text-ink`}>{num(p.qtyBilled)}</td>
                      <td className={`${cell} text-end font-mono tabular-nums text-muted`}>{p.poPrice != null ? ils(p.poPrice) : '—'}</td>
                      <td className={`${cell} text-end font-mono tabular-nums text-muted`}>{p.billedPrice != null ? ils(p.billedPrice) : '—'}</td>
                      <td className={`${cell} text-end font-mono tabular-nums ${p.deltaIls > 0 ? 'font-semibold text-danger' : 'text-muted'}`}>
                        {p.deltaIls > 0 ? ils(p.deltaIls) : '—'}
                      </td>
                      <td className={`${cell} text-end`}>
                        <Badge tone={PRODUCT_TONE[p.status]}>{t(`products.${p.status}`)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
