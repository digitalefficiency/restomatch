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
import { translateUnit } from '@restomatch/translate/units';
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

type Finding = ConsolidatedProposal['findings'][number];

/**
 * "הצלבה מול תעודות משלוח" — the read-only cross-match of a consolidated invoice
 * against the supplier's delivery notes. Tiers: the proposal itself is T4 (calm,
 * neutral — it is not counted yet); differences are T2 (solid badge + ₪ + one
 * primary action, which prints only this panel as a letter to the supplier); a
 * clean match is T3 (calm green).
 */
export function ConsolidatedPanel({
  proposal,
  t,
  locale,
  supplierName,
  invoiceNumber,
}: {
  proposal: ConsolidatedProposal;
  t: T;
  locale: Locale;
  supplierName: string | null;
  invoiceNumber: string | null;
}) {
  // Agorot: a cross-match is about small differences (₪0.86 must not read as ₪1).
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  // Unit prices keep their 4 decimals (₪2.385, ₪0.0459) — never rounded to the agora.
  const price = (v: number) => formatIls(v, { locale, maximumFractionDigits: 4 });
  const num = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 3 });
  const day = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short' });
  const unitText = (u: string | null) => (!u ? '' : locale === 'he' ? u : (translateUnit(u) ?? u));
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
  const leaking = proposal.findings.filter((f) => f.countsAsLeak);
  /** The finding as the owner (and the supplier) reads it: "חלב 3% · 24 ליטר · חויב ₪7.90 במקום ₪6.40 = ₪36.00". */
  const findingText = (f: Finding) => {
    const name = f.productName ? displayName(f.productName, f.productNameEn, locale).primary : t('products.unnamed');
    if (f.alreadyBilledOn) return t('finding.twice', { other: f.alreadyBilledOn.invoiceNumber ?? '—', delta: ils(f.deltaAmount) });
    if ((f.type === 'PRICE_HIGHER' || f.type === 'PRICE_LOWER') && f.qty != null && f.actual != null && f.expected != null) {
      return t('finding.price', {
        name,
        qty: num(f.qty),
        unit: unitText(f.unit),
        billed: price(f.actual),
        po: price(f.expected),
        delta: ils(f.deltaAmount),
      });
    }
    return t('finding.other', { name, delta: ils(f.deltaAmount) });
  };
  const findingsOf = (number: string | null) => (number ? leaking.filter((f) => f.deliveryNoteNumber === number) : []);
  // The ask follows each line's VAT basis (lib/claims.ts vatBasisOf): "+ מע״מ" only on
  // amounts before VAT — a duplicate is already incl. VAT, a VAT difference IS VAT.
  const exclAsk = leaking.filter((f) => f.basis === 'excl').reduce((s, f) => s + Math.round(f.deltaAmount * 100), 0) / 100;
  const inclAsk = leaking.filter((f) => f.basis !== 'excl').reduce((s, f) => s + Math.round(f.deltaAmount * 100), 0) / 100;
  const letterAsk =
    exclAsk > 0 && inclAsk > 0
      ? t('letter.askBoth', { excl: ils(exclAsk), incl: ils(inclAsk) })
      : inclAsk > 0
        ? t('letter.askIncl', { amount: ils(inclAsk) })
        : t('letter.ask', { amount: ils(exclAsk > 0 ? exclAsk : totals.leakIls) });
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${ils(Math.abs(v))}`;

  return (
    <section
      className="mt-10 min-w-0 max-w-full print:mt-0"
      aria-label={t('title')}
      data-testid="consolidated-panel"
      data-print-root="xmatch"
    >
      {proposal.status === 'differences' ? (
        // Print only: the letter header for the supplier.
        <div className="mb-6 hidden space-y-1 text-sm text-ink print:block" data-testid="xmatch-letter">
          <p className="font-semibold">{t('letter.to', { supplier: supplierName ?? '—' })}</p>
          <p>{t('letter.subject', { number: invoiceNumber ?? '—', period })}</p>
          <p className="pt-2">{t('letter.intro')}</p>
          <ul className="list-disc ps-5">
            {leaking.map((f, i) => (
              <li key={i}>
                {f.deliveryNoteNumber ? `${t('finding.note', { number: f.deliveryNoteNumber })} · ` : ''}
                {findingText(f)}
                {f.basis !== 'excl' ? ` ${t('letter.inclVat')}` : ''}
              </li>
            ))}
          </ul>
          <p className="pt-2 font-semibold">{letterAsk}</p>
        </div>
      ) : null}

      <SectionHeader title={t('title')} subtitle={t('subtitle', { period })} />

      {/* T4: a proposal, not counted yet — calm and neutral. */}
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted print:hidden">
        <Badge tone="neutral" icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />}>
          {t(settled ? 'reference' : 'proposal')}
        </Badge>
        <span>{t(settled ? 'referenceNote' : 'proposalNote')}</span>
      </p>

      {proposal.status === 'differences' ? (
        // T2: act now — solid badge + ₪ + ONE primary action.
        <Card padding="md" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden" data-testid="xmatch-differences">
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
            <PrintButton label={t('print')} primary scope="xmatch" />
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
              [t('totals.difference'), signed(totals.differenceIls)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                  {/* bdi keeps a leading +/− with its ₪ amount (formatIls carries its own direction marks). */}
                  <bdi className="whitespace-nowrap">{value}</bdi>
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mb-2 text-sm font-semibold text-ink">{t('notes.title')}</h3>
          {/* Phone: one card per note, so the Δ and the state are never clipped. */}
          <ul className="mb-6 space-y-2 sm:hidden" data-testid="xmatch-note-cards">
            {proposal.deliveryNotes.map((n) => (
              <li key={n.grId} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink">{n.number ?? '—'}</span>
                  <span className="text-xs text-muted">{day(n.receivedAt)}</span>
                  <Badge tone={NOTE_TONE[n.status]}>{t(`notes.${n.status}`)}</Badge>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums text-ink">{ils(n.receivedValueIls)}</span>
                  {n.deltaIls > 0 ? <span className="font-mono font-semibold tabular-nums text-danger">{ils(n.deltaIls)}</span> : null}
                </div>
                {findingsOf(n.number).map((f, i) => (
                  <p key={i} className="mt-1 text-xs text-danger">
                    {findingText(f)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <div
            className="relative mb-6 hidden max-w-full overflow-x-auto rounded-xl border border-line sm:block"
            tabIndex={0}
            role="region"
            aria-label={t('notes.title')}
          >
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
                {proposal.deliveryNotes.flatMap((n) => {
                  const rows = [
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
                    </tr>,
                  ];
                  const fs = findingsOf(n.number);
                  if (fs.length > 0) {
                    rows.push(
                      <tr key={`${n.grId}-f`} data-testid="xmatch-note-finding">
                        <td colSpan={noteDeltas ? 6 : 5} className="px-3 pb-2 text-xs text-danger">
                          {fs.map((f) => findingText(f)).join(' · ')}
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })}
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
                      <td className={`${cell} text-end font-mono tabular-nums text-muted`}>{p.poPrice != null ? price(p.poPrice) : '—'}</td>
                      <td className={`${cell} text-end font-mono tabular-nums text-muted`}>{p.billedPrice != null ? price(p.billedPrice) : '—'}</td>
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
