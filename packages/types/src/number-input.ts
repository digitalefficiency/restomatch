/**
 * The one decimal-number parser for anything a person types or a supplier file
 * carries (price lists, contracts, order quantities): exact, locale-aware, and
 * it refuses to guess — an ambiguous value is `invalid` (the row is reported,
 * never imported as a wrong number).
 *
 * Grammar (the POS CSV importer's `parseScaled`, packages/api integrations/pos/csv.ts):
 *  - both "," and "." → the later one is the decimal mark, the other must be
 *    proper thousands grouping: "1,234.50"; "1.234,50" (a comma decimal mark)
 *    only in a comma-decimal file — in a dot-decimal file it is refused (the
 *    contract importer's "never guess" rule, kept stricter than parseScaled);
 *  - only "," → "1,250" / "12,345,678" is thousands when grouping is allowed
 *    (money); "12,5", "7,5", "0,250" (a leading 0 is never a thousands group)
 *    is a decimal comma; with grouping off (a quantity) "1,250" is ambiguous;
 *  - only "." → one dot is the decimal point; several ("1.234.567") are
 *    thousands when grouping is allowed. In a comma-decimal file (the file's own
 *    cells say "1.250,00") a lone "1.250" is thousands too;
 *  - at most `scale` decimals; signs ("-5", "5-", "(5)") only when allowed;
 *  - ₪, ש״ח, ILS, NIS and every kind of space are ignored.
 *
 * Client-safe (no Node APIs): the web inputs and the server importers share it.
 */
export type DecimalStyle = 'auto' | 'comma';

export type NumberCell =
  | { kind: 'empty' }
  /** `scaled` = value × 10^scale, an exact integer (price units at scale 4, agorot at 2). */
  | { kind: 'ok'; value: number; scaled: number }
  | { kind: 'invalid'; raw: string };

export interface NumberInputOptions {
  /** Max decimals kept exactly (default 4 = NUMERIC(12,4) unit prices). */
  scale?: number;
  /** Thousands grouping allowed (money, default) — off for quantities, where "1,250" is ambiguous. */
  grouping?: boolean;
  /** A sign is accepted (default false: a price or a quantity is never negative). */
  negative?: boolean;
  /** The file's decimal style (detectDecimalStyle); 'auto' for typed input. */
  decimal?: DecimalStyle;
}

const CURRENCY = /₪|ש["״']?ח|\bils\b|\bnis\b/gi;
const SPACES = /[\s  ‎‏]/g;

function clean(raw: string): string {
  return raw.replace(CURRENCY, '').replace(SPACES, '');
}

export function parseNumberInput(
  raw: string | null | undefined,
  opts: NumberInputOptions = {},
): NumberCell {
  const scale = opts.scale ?? 4;
  const grouping = opts.grouping ?? true;
  if (raw == null) return { kind: 'empty' };
  const original = String(raw).trim();
  if (original === '') return { kind: 'empty' };
  const bad: NumberCell = { kind: 'invalid', raw: original };
  let s = clean(original);
  if (!s) return bad;

  let signs = 0;
  if (/^\(.*\)$/.test(s)) {
    signs++;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    signs++;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    signs++;
    s = s.slice(1);
  }
  if (signs > 1 || (signs === 1 && !opts.negative) || !/^[\d.,]+$/.test(s)) return bad;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let intPart: string;
  let frac = '';
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    if (dec === ',' && opts.decimal !== 'comma') return bad;
    const grp = dec === '.' ? ',' : '.';
    const head = s.slice(0, s.lastIndexOf(dec));
    if (
      !grouping ||
      head.includes(dec) ||
      !new RegExp(`^[1-9]\\d{0,2}(\\${grp}\\d{3})+$`).test(head)
    )
      return bad;
    intPart = head.split(grp).join('');
    frac = s.slice(s.lastIndexOf(dec) + 1);
  } else if (commas) {
    if (/^\d{1,3}(,\d{3})+$/.test(s) && !/^0,/.test(s)) {
      if (!grouping) return bad; // a quantity "1,250": thousands or a decimal comma — don't guess
      intPart = s.replace(/,/g, '');
    } else if (commas === 1) {
      [intPart, frac] = s.split(',') as [string, string];
    } else return bad;
  } else if (dots) {
    if (dots > 1) {
      if (!grouping || !/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) return bad;
      intPart = s.replace(/\./g, '');
    } else if (opts.decimal === 'comma' && /^[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      if (!grouping) return bad;
      intPart = s.replace('.', ''); // "1.250" in a "1.250,00" file
    } else {
      [intPart, frac] = s.split('.') as [string, string];
    }
  } else intPart = s;

  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(frac) || frac.length > scale) return bad;
  const scaled = Number(intPart) * 10 ** scale + Number(frac.padEnd(scale, '0') || '0');
  if (!Number.isSafeInteger(scaled)) return bad;
  const value = Number(frac ? `${intPart}.${frac}` : intPart);
  return signs ? { kind: 'ok', value: -value, scaled: -scaled } : { kind: 'ok', value, scaled };
}

/**
 * The file's decimal style, read from its own cells: one "1.250,00" (dot
 * groups, comma decimals) makes the column comma-decimal. Else 'auto'.
 */
export function detectDecimalStyle(values: Iterable<string | null | undefined>): DecimalStyle {
  for (const v of values) {
    if (v == null) continue;
    if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(clean(String(v)))) return 'comma';
  }
  return 'auto';
}
