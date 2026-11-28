'use client';

import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { Translator } from '@/lib/i18n/translate';
import { formatIls } from '@/lib/money';
import { Calculation, CalculationFold, type CalcSource } from '@/lib/components/Calculation';
import { cn } from '@/lib/components/cn';
import { Money } from '@/lib/components/money/Money';
import { formatDay } from '@/lib/components/money/format';
import {
  calcOf,
  deltaAgorot,
  sourcesOf,
  toNumber4,
  units4,
  type CalcTerm,
  type SourceFact,
  type TermLabel,
} from './desk-facts';
import { qtyText, unitText } from './desk-text';
import type { DeskMode, GapDocument, QueueItem } from './desk-types';
import { Template } from './rich-message';
import { discrepancyExplain, toleranceLabel } from './vocab';

type T = Translator<typeof approvalsHe>;
type Locale = 'he' | 'en';

export interface CalcCardProps {
  g: QueueItem;
  doc: GapDocument;
  mode: DeskMode;
  /** The desk's density (compact applies at xl only, through the desk root's data-density). */
  compact: boolean;
}

/** Two literal class maps (§4.0): the landing ('single') takes the narrow values unprefixed. */
const CARD: Record<DeskMode, string> = {
  desk: 'mt-2.5 rounded-card border border-line-rule bg-surface px-4 py-3 text-body-sm max-xl:px-3 max-xl:py-2.5',
  single: 'mt-2.5 rounded-card border border-line-rule bg-surface px-3 py-2.5 text-body-sm',
};
/** §4.9 compact (xl only). */
const CARD_COMPACT =
  'xl:group-data-[density=compact]/desk:mt-2 xl:group-data-[density=compact]/desk:px-3.5 xl:group-data-[density=compact]/desk:py-2';

/** The calculation's quantity labels (the `billed` quantity of a price gap is the bare quantity). */
const QTY_KEY = {
  notReceived: 'desk.calc.qtyNotReceived',
  overOrder: 'desk.calc.qtyOverOrder',
  short: 'desk.calc.qtyShort',
  notBilled: 'desk.calc.qtyNotBilled',
  notOrdered: 'desk.calc.qtyNotOrdered',
} as const satisfies Record<Exclude<TermLabel, 'billed'>, string>;

/** The price difference's words by its basis and direction (§4.4): a contract or a p90 never reads "more" plainly. */
function priceDiffKey(term: Extract<CalcTerm, { kind: 'priceDiff' }>) {
  if (term.basis === 'p90') return 'desk.calc.priceOverP90' as const;
  if (term.basis === 'contract') return term.direction === 'more' ? ('desk.calc.priceOverContract' as const) : ('desk.calc.priceLess' as const);
  return term.direction === 'more' ? ('desk.calc.priceMore' as const) : ('desk.calc.priceLess' as const);
}

/** One operand as shown: quantities with their unit, prices with up to 4 decimals, money with its label. */
function termNode(term: CalcTerm, t: T, locale: Locale): React.ReactNode {
  switch (term.kind) {
    case 'qty': {
      const qty = qtyText(locale, term.v4, term.unit);
      if (term.label === 'billed') return <bdi>{qty}</bdi>;
      return <Template text={t(QTY_KEY[term.label])} values={{ qty }} />;
    }
    case 'priceDiff':
      return (
        <Template
          text={t(priceDiffKey(term), { unit: unitText(locale, term.per) })}
          values={{ diff: <Money value={toNumber4(term.v4)} context="unit" /> }}
        />
      );
    case 'price':
      return <Money value={toNumber4(term.v4)} context="unit" />;
    case 'money':
      return (
        <>
          <Money value={toNumber4(term.v4)} context="line" /> <span className="text-fg-secondary">{t(`desk.calc.${term.label}`)}</span>
        </>
      );
    default:
      return null;
  }
}

/** A source line (§2.1.3): where one operand came from, its figures formatted with the viewer's locale (R3). */
function sourceText(s: SourceFact, t: T, locale: Locale): string {
  const unit = s.values?.unit ?? null;
  const qty = (v: bigint | undefined) => (v == null ? '' : qtyText(locale, v, unit));
  const price = (v: bigint | undefined) => (v == null ? '' : formatIls(toNumber4(v), { locale, maximumFractionDigits: 4 }));
  switch (s.key) {
    case 'order':
      return s.poDate ? t('desk.calc.src.order', { date: formatDay(s.poDate, locale) }) : t('desk.calc.src.orderNoDate');
    case 'billedCounted':
      return t('desk.calc.src.billedCounted', { billed: qty(s.values?.billed), counted: qty(s.values?.counted) });
    case 'countedOrdered':
      return t('desk.calc.src.countedOrdered', { counted: qty(s.values?.counted), ordered: qty(s.values?.ordered) });
    case 'orderedCounted':
      return t('desk.calc.src.orderedCounted', { ordered: qty(s.values?.ordered), counted: qty(s.values?.counted) });
    case 'pricesOrder':
    case 'pricesContract':
    case 'pricesP90':
    case 'pricesExpected':
      return t(`desk.calc.src.${s.key}`, { billed: price(s.values?.billed), expected: price(s.values?.expected) });
    default:
      return t(`desk.calc.src.${s.key}`); // invoice · scan · engine
  }
}

/** The rule the check applied, in the product's tolerance words ("הכלל: ±2% מהמחיר או ₪5"); nothing when unknown. */
function RuleLine({ g, testId, className }: { g: QueueItem; testId?: string; className: string }) {
  const t = useT(approvals);
  const rule = toleranceLabel(t, g.toleranceUsed);
  if (!rule) return null;
  return (
    <p data-testid={testId} className={className}>
      {t('desk.calc.rule', { rule })}
    </p>
  );
}

/**
 * The calculation line that opens the explanation (DS3-04 spec §4.4 CalcCard): "3 ק״ג שלא התקבלו × ₪12.90 = ₪38.70
 * לפני מע״מ". The result is always the stored |Δ|; the factors show only when their exact product equals it
 * (desk-facts `calcOf`), otherwise the honest fallback names the amount alone. A minus puts the larger figure first
 * (R4). The VAT basis sits beside the result. The toggle (DS3-01 `CalculationFold`, "איך חישבנו?") opens the same
 * formula with the source of every number (`Calculation`).
 */
export function CalcCard({ g, doc, mode, compact }: CalcCardProps) {
  const t = useT(approvals);
  const locale = useLocale();
  const calc = calcOf(g);
  // The eye (a value read from a photo) also when the ready document says the invoice has an image.
  const scanned = g.hasScan === true || (doc.status === 'ready' && doc.hasImage);
  let line: React.ReactNode = null;
  if (calc.kind === 'times' || calc.kind === 'minus') {
    const left = termNode(calc.left, t, locale);
    const right = termNode(calc.right, t, locale);
    const sources: CalcSource[] = sourcesOf(calc, { ...g, hasScan: scanned }).map((s) => ({
      value: s.term === 'left' ? left : right,
      kind: s.kind,
      text: sourceText(s, t, locale),
    }));
    line = (
      <CalculationFold
        key={g.id}
        about={t('desk.sr.calcAbout')}
        label="how"
        line={
          <p className="num flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span>{left}</span>
            <span className="text-fg-tertiary">{calc.kind === 'minus' ? '−' : '×'}</span>
            <span>{right}</span>
            <span className="text-fg-tertiary">=</span>
            <b data-testid="calc-result" className="text-metric-md font-semibold text-fg">
              <Money agorot={Number(calc.resultAgorot)} context="line" />
            </b>
            <span className="text-caption text-fg-tertiary">
              {calc.basis === 'vat' ? t('desk.calc.vatItself') : t('summary.atRiskBasis')}
            </span>
          </p>
        }
      >
        <Calculation
          terms={[left, right]}
          operator={calc.kind === 'minus' ? 'minus' : 'times'}
          result={<Money agorot={Number(calc.resultAgorot)} context="line" split />}
          sources={sources}
        />
      </CalculationFold>
    );
  } else if (calc.kind === 'fallback') {
    line = (
      <p className="num flex flex-wrap items-baseline gap-x-2">
        <span>{t(calc.label === 'lineTotal' ? 'desk.calc.lineTotal' : 'desk.calc.fallback')}</span>
        <span className="text-fg-tertiary">=</span>
        <b data-testid="calc-result" className="text-metric-md font-semibold text-fg">
          <Money agorot={Number(calc.resultAgorot)} context="line" />
        </b>
        <span className="text-caption text-fg-tertiary">{t('summary.atRiskBasis')}</span>
      </p>
    );
  }
  return (
    <div data-testid="calc-line" className={cn(CARD[mode], compact && mode === 'desk' && CARD_COMPACT)}>
      {line}
      <RuleLine g={g} testId="calc-rule" className="mt-1 text-caption text-fg-secondary" />
    </div>
  );
}

/**
 * The fact card of a gap with no calculation (DS3-04 spec §4.4 "fact"): a duplicate's or an unordered arrival's total
 * with its VAT basis ("כולל מע״מ"), the two units of a unit mismatch, a date anomaly's explanation; then the rule.
 */
export function FactCard({ g, doc }: CalcCardProps) {
  const t = useT(approvals);
  const locale = useLocale();
  const delta = <Money agorot={Number(deltaAgorot(g) ?? 0n)} context="line" />;
  const qty = (raw: string | null, unit: string | null) => {
    const v4 = units4(raw);
    return v4 == null ? t('desk.table.unknown') : qtyText(locale, v4, unit);
  };
  let body: React.ReactNode;
  switch (g.type) {
    case 'DUPLICATE_INVOICE':
      body = (
        <>
          <Template text={t('desk.fact.duplicate')} values={{ amount: delta }} />
          {doc.status === 'ready' && doc.duplicateOf ? (
            <>
              {' · '}
              <Template text={t('desk.fact.duplicateOf')} values={{ number: doc.duplicateOf }} />
            </>
          ) : null}
        </>
      );
      break;
    case 'UNORDERED_ARRIVAL':
      body = <Template text={t('desk.fact.arrival')} values={{ amount: delta }} />;
      break;
    case 'UNIT_MISMATCH':
      body = (
        <Template
          text={t('desk.fact.unit')}
          values={{ billed: qty(g.qtyBilled, g.billedUnit), ordered: qty(g.qtyOrdered, g.orderedUnit) }}
        />
      );
      break;
    default:
      body = discrepancyExplain(t, g.type); // DATE_ANOMALY (and anything unknown)
  }
  return (
    <>
      <p data-testid="desk-fact" className="mt-4 rounded-card border border-line-rule bg-surface px-4 py-3 text-body-sm text-fg">
        {body}
      </p>
      <RuleLine g={g} className="mt-2 text-caption text-fg-secondary" />
    </>
  );
}
