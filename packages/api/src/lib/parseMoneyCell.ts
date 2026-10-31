/**
 * Strict, locale-aware parsing of a money cell from a supplier file (price
 * list or contract). The parse boundary for imported ₪: a cell either reads
 * as one unambiguous non-negative amount or it is reported, never guessed.
 *
 * Why strict: the old catalog parser read a lone comma as a decimal point, so
 * "1,250" became ₪1.25 (catalog-02). Israeli price lists write thousands with
 * a comma ("1,250", "₪ 2,400") and occasionally decimals with one ("12,90").
 *
 * Accepted (₪, ש״ח, ILS, NIS, spaces and NBSP ignored):
 *   "1250" · "12.5"                       plain
 *   "1,250" · "1,250,000" · "1,250.00"    comma = thousands (groups of 3)
 *   "12,90" · "7,5"                       comma decimal (1–2 digits, no other separator)
 * With `decimal: 'comma'` (the file's own cells use "1.250,00"):
 *   "1.250,50" · "1.250" · "7,5"          dot = thousands, comma = decimal
 * Rejected: signs ("-5"), accounting negatives ("(5)"), exponents ("1e3"),
 *   "1,2345", "1.250,5" in a dot-decimal file, letters.
 */
export type DecimalStyle = 'auto' | 'comma';

export type MoneyCell =
  | { kind: 'empty' }
  | { kind: 'ok'; value: number }
  | { kind: 'invalid'; raw: string };

const CURRENCY = /₪|ש["״']?ח|\bils\b|\bnis\b/gi;

/** Strip currency marks and every kind of space, keep the digits and separators. */
function clean(raw: string): string {
  return raw.replace(CURRENCY, '').replace(/[\s  ‎‏]/g, '');
}

export function parseMoneyCell(raw: string | null | undefined, decimal: DecimalStyle = 'auto'): MoneyCell {
  if (raw == null) return { kind: 'empty' };
  const original = String(raw).trim();
  if (original === '') return { kind: 'empty' };
  const s = clean(original);
  if (s === '') return { kind: 'invalid', raw: original };
  let norm: string | null = null;
  if (decimal === 'comma') {
    if (/^\d+(?:,\d+)?$/.test(s)) norm = s.replace(',', '.');
    else if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) norm = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+(?:\.\d+)?$/.test(s)) norm = s;
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) norm = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) norm = s.replace(',', '.');
  if (norm === null) return { kind: 'invalid', raw: original };
  const n = Number(norm);
  return Number.isFinite(n) ? { kind: 'ok', value: n } : { kind: 'invalid', raw: original };
}

/**
 * The file's decimal style, read from its own cells: one "1.250,00" (dot
 * groups, comma decimals) means the whole column is comma-decimal. Anything
 * else stays 'auto' (a lone "1,250" is thousands).
 */
export function detectDecimalStyle(values: Iterable<string | null | undefined>): DecimalStyle {
  for (const v of values) {
    if (v == null) continue;
    const s = clean(String(v));
    if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(s)) return 'comma';
  }
  return 'auto';
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
