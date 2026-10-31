import { parseNumberInput, type DecimalStyle } from '@restomatch/types';

/**
 * The money-cell view of the shared number parser (@restomatch/types
 * number-input — the POS importer's `parseScaled` grammar), for supplier files
 * (price lists, contracts). The parse boundary for imported ₪: a cell either
 * reads as one unambiguous non-negative amount (≤ 4 decimals, NUMERIC(12,4)) or
 * it is reported, never guessed.
 *
 * Why strict: the old catalog parser read a lone comma as a decimal point, so
 * "1,250" became ₪1.25 (catalog-02); a too-eager thousands rule then read
 * "0,250" as 250. Accepted: "1250", "12.5", "1,250", "1,250,000", "1,250.00",
 * "1.250,50", "12,90", "7,5", "0,250"; a comma-decimal file also reads "1.250"
 * as 1250. Rejected: signs, "(5)", exponents, letters, 5+ decimals.
 */
export { detectDecimalStyle, type DecimalStyle } from '@restomatch/types';

export type MoneyCell =
  | { kind: 'empty' }
  | { kind: 'ok'; value: number }
  | { kind: 'invalid'; raw: string };

export function parseMoneyCell(raw: string | null | undefined, decimal: DecimalStyle = 'auto'): MoneyCell {
  const cell = parseNumberInput(raw, { scale: 4, grouping: true, negative: false, decimal });
  return cell.kind === 'ok' ? { kind: 'ok', value: cell.value } : cell;
}

/** Back-compat number-or-null view (the contract importer's original API). */
export function parsePriceCell(raw: string | null): number | null {
  const cell = parseMoneyCell(raw);
  return cell.kind === 'ok' ? cell.value : null;
}

/** NUMERIC(12,4) "price units": 1/100 agorot. */
const PRICE_SCALE = 10_000;

/** An amount → integer price units (half-up at the 4th decimal). */
export function toPriceUnits(value: number): number {
  return Math.round(value * PRICE_SCALE);
}

/**
 * VAT-inclusive → VAT-exclusive, in integer price units with an explicit
 * half-up rounding rule: ex = round(inc / (1 + rate)). The rate comes from the
 * restaurant (the same rate the matching engine is given), never redefined here.
 */
export function exVatPriceUnits(incUnits: number, vatRate: number): number {
  const rateBp = Math.round(vatRate * PRICE_SCALE); // 0.18 → 1800
  const den = PRICE_SCALE + rateBp;
  // floor((2·inc·S + den) / (2·den)) = round-half-up of inc·S/den for inc ≥ 0.
  return Math.floor((2 * incUnits * PRICE_SCALE + den) / (2 * den));
}

/** Price units → the NUMERIC(12,4) string the column stores. */
export function priceUnitsToNumeric(units: number): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / PRICE_SCALE);
  const frac = String(abs % PRICE_SCALE).padStart(4, '0');
  return `${sign}${whole}.${frac}`;
}
