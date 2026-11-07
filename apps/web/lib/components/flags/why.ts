import { intlLocaleOf, type Locale } from '@/lib/i18n/config';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { translateUnit } from '@restomatch/translate/units';
import type { WhyLineSegment } from './WhyLine';

/**
 * The ONE "why" formatter (W2-09b, hoisted from approvals/vocab.ts `whyLine`).
 * Pure: facts + labels in, `WhyLine` groups out. Every surface that explains a
 * discrepancy ₪ (approvals card, breakdown lines, proof findings, supplier
 * leak card, claim letters) feeds the same facts here, so the same line reads
 * the same everywhere. Labels are injected, so each namespace keeps its copy.
 *
 * Display only: it never recomputes the claimed amount. A caller that cannot
 * verify the basis (evidence ≠ |Δ| to the agora) passes `unavailable` and the
 * line reads "פירוט לא זמין" — never a wrong formula.
 */

export type WhySegment = WhyLineSegment;

/** One discrepancy's facts (engine columns as NUMERIC strings or numbers). */
export interface WhyFacts {
  type: string;
  deltaAmount: string | number | null;
  expectedValue: string | number | null;
  actualValue: string | number | null;
  toleranceUsed: string | null;
  qtyBilled?: string | number | null;
  billedUnit?: string | null;
  qtyOrdered?: string | number | null;
  orderedUnit?: string | null;
  qtyReceived?: string | number | null;
  poId?: string | null;
  poRef?: string | null;
  poDate?: Date | string | null;
  /** The invoice's leak was capped at its total: add "מוגבל לסכום החשבונית". */
  capped?: boolean;
  /** The basis could not be verified: show only the "unavailable" text. */
  unavailable?: boolean;
}

/**
 * Templates with {placeholders}. `inline` (approvals) reads
 * "₪575.00 × 2 חבית במקום ₪522.60 (הזמנה PO-…, 14.10) = ₪104.80 · +10.0% · סף …";
 * `ledger` (leaks, letters, supplier card) reads
 * "חויב ₪149.00 × 10 ק״ג · בהזמנה ₪139.00 · הפרש ₪100.00 · סף ±2% או ₪5".
 */
export interface WhyTemplates {
  /** inline: '{actual} × {qty} {unit} במקום {expected}' · ledger: 'חויב {actual} × {qty} {unit}' */
  price: string;
  /** inline: '{actual} ליחידה במקום {expected}' · ledger: 'חויב {actual} ליחידה' */
  priceNoQty: string;
  priceP90: string;
  priceP90NoQty: string;
  /** inline: '(הזמנה {po}, {date})' · ledger: 'בהזמנה {po} ({date})' */
  sourcePo: string;
  sourceP90: string;
  /** inline: '= {amount}' · ledger: 'הפרש {amount}' */
  equals: string;
  qtyOver: string;
  qtyShort: string;
  threshold: string;
  /** ledger only: 'בהזמנה {expected}' / 'חציון 90 יום {expected}' (the expected price group). */
  expected?: string;
  expectedP90?: string;
  /** 'מוגבל לסכום החשבונית' */
  capped?: string;
  /** 'פירוט לא זמין' */
  unavailable?: string;
}

export interface WhyLabels {
  locale: Locale;
  layout?: 'inline' | 'ledger';
  templates: WhyTemplates;
  /** Plain-language explanation of a type (fallback when no values are shown). */
  explain: (type: string) => string;
  /** The engine's stored tolerance string, localized. */
  tolerance: (raw: string) => string;
}

export const SEP: WhySegment = { text: ' · ' };

/** "PO-7781" or the first 8 of the id (the dock slip's fallback). */
export function poLabel(poRef: string | null | undefined, poId: string | null | undefined): string | null {
  if (poRef) return poRef;
  return poId ? `PO-${poId.slice(0, 8).toUpperCase()}` : null;
}

/** Fill a template's {placeholders} as isolated segments (so a ₪ never re-orders its neighbours). */
export function fill(template: string, values: Record<string, string>): WhySegment[] {
  const out: WhySegment[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) out.push({ text: template.slice(last, m.index) });
    const v = values[m[1]!];
    out.push(v == null ? { text: m[0] } : { text: v, num: true });
    last = m.index! + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

const numOf = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The engine's p90 basis (packages/matching evaluateBaseline): never shown as an order price. */
const isP90 = (tolerance: string | null) => (tolerance ?? '').startsWith('actual exceeds historical p90');

/** The why-line groups for one discrepancy. Line ₪ at 2 dp; quantities up to 3 dp. */
export function whySegments(d: WhyFacts, labels: WhyLabels): WhySegment[][] {
  const { locale, templates: tp } = labels;
  if (d.unavailable) return [[{ text: tp.unavailable ?? '—' }]];
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const qty = (v: string | number | null | undefined) => {
    const n = numOf(v);
    return n == null ? null : formatNumber(n, locale, { maximumFractionDigits: 3 });
  };
  const exp = numOf(d.expectedValue);
  const act = numOf(d.actualValue);
  const rawDelta = numOf(d.deltaAmount);
  const delta = rawDelta == null ? null : Math.abs(rawDelta);
  const rawUnit = d.billedUnit ?? d.orderedUnit ?? '';
  // Units are free text (mostly Hebrew); English goes through the shared translator (ק״ג → kg).
  const unit = locale === 'he' || !rawUnit ? rawUnit : (translateUnit(rawUnit) ?? rawUnit);
  const p90 = isP90(d.toleranceUsed);
  const po = poLabel(d.poRef, d.poId);
  const poDate = d.poDate ? formatDate(d.poDate, locale, { day: '2-digit', month: '2-digit' }) : '—';
  const equals = delta != null ? fill(tp.equals, { amount: ils(delta) }) : [];
  const groups: WhySegment[][] = [];
  const isPrice = (d.type === 'PRICE_HIGHER' || d.type === 'PRICE_LOWER') && exp != null && act != null;
  const isQty = (d.type === 'QTY_OVER' || d.type === 'QTY_SHORT') && exp != null && act != null;
  const qtyLine = () =>
    d.type === 'QTY_OVER'
      ? fill(tp.qtyOver, { billed: qty(act)!, unit, received: qty(exp)! })
      : fill(tp.qtyShort, { ordered: qty(exp)!, unit, received: qty(act)! });

  if ((labels.layout ?? 'inline') === 'ledger') {
    if (isPrice) {
      const billed = qty(d.qtyBilled);
      groups.push(
        billed
          ? fill(p90 ? tp.priceP90 : tp.price, { actual: ils(act!), qty: billed, unit, expected: ils(exp!) })
          : fill(p90 ? tp.priceP90NoQty : tp.priceNoQty, { actual: ils(act!), expected: ils(exp!) }),
      );
      const expTpl = p90 ? (tp.expectedP90 ?? tp.sourceP90) : po ? tp.sourcePo : (tp.expected ?? tp.sourcePo);
      groups.push(fill(expTpl, { expected: ils(exp!), po: po ?? '', date: poDate }));
    } else if (isQty) {
      groups.push(qtyLine());
    } else {
      groups.push([{ text: labels.explain(d.type) }]);
    }
    if (equals.length) groups.push(equals);
  } else {
    if (isPrice) {
      const billed = qty(d.qtyBilled);
      const formula = billed
        ? fill(p90 ? tp.priceP90 : tp.price, { actual: ils(act!), qty: billed, unit, expected: ils(exp!) })
        : fill(p90 ? tp.priceP90NoQty : tp.priceNoQty, { actual: ils(act!), expected: ils(exp!) });
      const source = p90
        ? [{ text: ' ' }, { text: tp.sourceP90 }]
        : po
          ? [{ text: ' ' }, ...fill(tp.sourcePo, { po, date: poDate })]
          : [];
      groups.push([...formula, ...source, ...(equals.length ? [{ text: ' ' }, ...equals] : [])]);
      if (exp! > 0) {
        const pct = new Intl.NumberFormat(intlLocaleOf(locale), {
          style: 'percent',
          signDisplay: 'exceptZero',
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format((act! - exp!) / exp!);
        groups.push([{ text: pct, num: true }]);
      }
    } else if (isQty) {
      groups.push([...qtyLine(), ...(equals.length ? [{ text: ' ' }, ...equals] : [])]);
    } else {
      groups.push([{ text: labels.explain(d.type) }, ...(equals.length ? [{ text: ' ' }, ...equals] : [])]);
    }
  }
  // In the ledger a p90 "threshold" only restates the expected-price group above it.
  const ledgerP90 = (labels.layout ?? 'inline') === 'ledger' && p90;
  if (d.toleranceUsed && !ledgerP90) groups.push(fill(tp.threshold, { tolerance: labels.tolerance(d.toleranceUsed) }));
  if (d.capped && tp.capped) groups.push([{ text: tp.capped }]);
  return groups;
}

/** Plain text of a why-line (tests, aria descriptions, CSV). */
export function whyText(groups: WhySegment[][]): string {
  return groups.map((g) => g.map((s) => s.text).join('')).join(SEP.text);
}
