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

/* ------------------------------------------------------------------------- *
 * parseDecimalInput (G-13): the ONE input parser for a typed or imported number.
 * A kind → {scale, grouping} mapping over parseNumberInput (whose grammar does
 * not change) plus the split of its `invalid` into `ambiguous` (a real number
 * we refuse to guess — "1,250" as a quantity) and `invalid` (not a number).
 * The integer it returns is exact: build money from it, never Math.round(x*100).
 * ------------------------------------------------------------------------- */

/** ils → agorot (scale 2) · unitPrice → price units = 1/100 agora (scale 4) · qty → milli (scale 3) · percent → basis points (scale 2). */
export type DecimalKind = 'ils' | 'unitPrice' | 'qty' | 'percent';

interface KindSpec {
  scale: number;
  grouping: boolean;
}
const KINDS: Record<DecimalKind, KindSpec> = {
  ils: { scale: 2, grouping: true },
  unitPrice: { scale: 4, grouping: true },
  qty: { scale: 3, grouping: false },
  percent: { scale: 2, grouping: false },
};

/** The integer field each kind returns. */
export interface DecimalScaledField {
  ils: 'agorot';
  unitPrice: 'priceUnits';
  qty: 'milli';
  percent: 'basisPoints';
}
const FIELD: DecimalScaledField = { ils: 'agorot', unitPrice: 'priceUnits', qty: 'milli', percent: 'basisPoints' };

/** A real number with two readings: ask the person, never pick one. */
export type DecimalAmbiguousReason =
  /** "1,250" for a quantity/percent: 1250 or 1.25? */
  | 'thousands-or-decimal-comma'
  /** "1.250" for ₪: ₪1,250 (European grouping) or ₪1.25 with three decimals? */
  | 'thousands-or-three-decimals';

export type DecimalInvalidReason =
  | 'not-a-number'
  | 'negative-not-allowed'
  /** "1.234,50" outside a comma-decimal file. */
  | 'comma-decimal-needs-comma-file'
  | 'too-many-decimals'
  /** Thousands grouping in a quantity or a percent ("1.250.000"). */
  | 'grouping-not-allowed'
  /** Beyond exact integer range. */
  | 'out-of-range';

export type DecimalInput<K extends DecimalKind = DecimalKind> =
  | { kind: 'empty' }
  | ({ kind: 'ok'; value: number } & { [F in DecimalScaledField[K]]: number })
  | { kind: 'ambiguous'; raw: string; reason: DecimalAmbiguousReason }
  | { kind: 'invalid'; raw: string; reason: DecimalInvalidReason };

export interface DecimalInputOptions {
  /** A sign ("-5", "5-", "(5)") is accepted. Default false. */
  negative?: boolean;
  /** The file's decimal style (detectDecimalStyle); 'auto' (default) for typed input. */
  decimal?: DecimalStyle;
}

/** Bidi isolates/marks that `moneyText` output carries, beyond what parseNumberInput already ignores. */
const ISOLATES = /[⁦-⁩‪-‮؜]/g;

export function parseDecimalInput<K extends DecimalKind>(
  raw: string | null | undefined,
  kind: K,
  opts: DecimalInputOptions = {},
): DecimalInput<K> {
  if (raw == null) return { kind: 'empty' };
  const original = String(raw).trim();
  let s = original.replace(ISOLATES, '');
  if (kind === 'percent') s = s.replace(/%\s*$/, '').replace(/^\s*%/, '');
  if (s.trim() === '') return original === '' ? { kind: 'empty' } : { kind: 'invalid', raw: original, reason: 'not-a-number' };
  const spec = KINDS[kind];
  const body = clean(s);
  // Both separators can only mean one thing ("1,234.500" kg), so grouping is safe for every kind.
  const both = body.includes(',') && body.includes('.');
  const cell = parseNumberInput(s, {
    scale: spec.scale,
    grouping: spec.grouping || both,
    negative: opts.negative,
    decimal: opts.decimal,
  });
  if (cell.kind === 'empty') return { kind: 'empty' };
  if (cell.kind === 'ok') {
    return { kind: 'ok', value: cell.value, [FIELD[kind]]: cell.scaled } as DecimalInput<K>;
  }
  return { raw: original, ...why(body, spec, opts) } as DecimalInput<K>;
}

/** Why parseNumberInput refused: re-check the shapes it rejects, most specific first. */
function why(
  body: string,
  spec: KindSpec,
  opts: DecimalInputOptions,
): { kind: 'ambiguous'; reason: DecimalAmbiguousReason } | { kind: 'invalid'; reason: DecimalInvalidReason } {
  const inv = (reason: DecimalInvalidReason) => ({ kind: 'invalid' as const, reason });
  const s = body.replace(/^\((.*)\)$/, '$1').replace(/^-|-$/g, '');
  if (s !== body && !opts.negative && /^[\d.,]+$/.test(s)) return inv('negative-not-allowed');
  if (!/^[\d.,]+$/.test(s)) return inv('not-a-number');
  const groupedComma = /^\d{1,3}(,\d{3})+$/.test(s) && !/^0,/.test(s);
  if (groupedComma && !spec.grouping) return { kind: 'ambiguous', reason: 'thousands-or-decimal-comma' };
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    if (!spec.grouping) return inv('grouping-not-allowed');
    if (/^[1-9]\d{0,2}\.\d{3}$/.test(s) && spec.scale < 3) return { kind: 'ambiguous', reason: 'thousands-or-three-decimals' };
  }
  if (s.includes('.') && s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.') && opts.decimal !== 'comma')
    return inv('comma-decimal-needs-comma-file');
  const frac = /[.,](\d+)$/.exec(s)?.[1];
  if (frac && frac.length > spec.scale && /^\d+[.,]\d+$/.test(s)) return inv('too-many-decimals');
  if (/^\d+([.,]\d+)?$/.test(s)) return inv('out-of-range');
  return inv('not-a-number');
}
