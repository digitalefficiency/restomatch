/**
 * Pure parsers for the form primitives (no React — unit-tested in node).
 * Parsing a typed amount is input handling, not money math: the engine's
 * ₪ maths stays in @restomatch/matching, and display stays in `formatIls()`.
 */

const STRIP = /[\s ‎‏‪-‮₪]/g;

/**
 * Normalise a typed decimal to a canonical "1234.5" string, or null when it
 * is not a number. Accepts "7,5" and "7.5" (decimal comma or point),
 * "1,250.50" / "1.250,50" (both separators: the last one is the decimal),
 * and "1,250" / "1,250,000" (comma groups of three = thousands).
 */
export function normalizeDecimal(raw: string, opts: { decimalComma?: boolean } = {}): string | null {
  let s = raw.replace(STRIP, '');
  if (s === '') return null;
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null; // a lone "." or "," is not 0
  // Decimal-comma mode (the keypad, whose only separator key is ","): one comma is the decimal.
  if (opts.decimalComma) {
    if (s.includes('.') || (s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(',', '.');
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let canonical: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    const [intPart, frac, ...extra] = s.split(decimalSep);
    if (extra.length || frac === undefined || frac.includes(groupSep)) return null;
    if (!/^\d{1,3}([.,]\d{3})*$/.test(intPart!) || intPart!.includes(decimalSep)) return null;
    canonical = `${intPart!.split(groupSep).join('')}.${frac}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) {
      // Only valid as thousands groups: 1,250,000 / 1.250.000.
      if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) return null;
      canonical = parts.join('');
    } else if (sep === ',' && /^[1-9]\d{0,2},\d{3}$/.test(s)) {
      canonical = parts.join(''); // "1,250" reads as one thousand two hundred fifty
    } else {
      canonical = `${parts[0] || '0'}.${parts[1]}`;
    }
  } else {
    canonical = s;
  }
  if (!/^\d+(\.\d+)?$/.test(canonical.replace(/\.$/, ''))) return null;
  return canonical.replace(/\.$/, '').replace(/^0+(?=\d)/, '');
}

/** A typed amount in integer agorot (half-up at the third decimal), or null. */
export function parseMoneyInput(raw: string): number | null {
  const n = normalizeDecimal(raw);
  if (n === null) return null;
  const [int, frac = ''] = n.split('.');
  const padded = `${frac}000`;
  let agorot = Number(int) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) agorot += 1;
  return Number.isSafeInteger(agorot) ? agorot : null;
}

/** A typed quantity as a number (up to `maxDecimals`), or null. */
export function parseQuantityInput(raw: string, maxDecimals = 3, opts: { decimalComma?: boolean } = {}): number | null {
  const n = normalizeDecimal(raw, opts);
  if (n === null) return null;
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  const f = 10 ** maxDecimals;
  return Math.round(value * f) / f;
}

/** QtyKeypad text ("1,25": the comma is always the decimal) → a quantity, or null. */
export function parseKeypadQuantity(text: string, maxDecimals = 3): number | null {
  return parseQuantityInput(text, maxDecimals, { decimalComma: true });
}

/** A quantity → QtyKeypad text (decimal comma, no grouping): 1.125 → "1,125". */
export function formatKeypadText(value: number): string {
  return String(value).replace('.', ',');
}

/** Agorot → the field's display text on blur: grouped, 2 dp ("1,250.50"). Not a ₪ string. */
export function formatMoneyField(agorot: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(agorot / 100);
}

export function formatQuantityField(value: number, maxDecimals = 3): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals }).format(value);
}

/** ISO 'yyyy-mm-dd' from typed "25.10.2026", "25/10/26", "25-10-2026" or "25102026"; null if not a real date. */
export function parseDateInput(raw: string): string | null {
  const s = raw.replace(/[\s‎‏]/g, '');
  let d: number, m: number, y: number;
  const sep = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  const packed = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (sep) [d, m, y] = [Number(sep[1]), Number(sep[2]), Number(sep[3])];
  else if (packed) [d, m, y] = [Number(packed[1]), Number(packed[2]), Number(packed[3])];
  else return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * What a DateField holds for its typed text: the ISO date it posts, and
 * whether to flag it. Anything that is not a whole, real, in-range date
 * posts nothing ("") — never a stale or half-typed value.
 */
export function dateFieldValue(text: string, range: { min?: string; max?: string } = {}): { iso: string | null; invalid: boolean } {
  if (text.trim() === '') return { iso: null, invalid: false };
  const iso = parseDateInput(text);
  if (!iso || (range.min && iso < range.min) || (range.max && iso > range.max)) return { iso: null, invalid: true };
  return { iso, invalid: false };
}

/** ISO → "25.10.2026" (Hebrew) or "25/10/2026" (English), independent of the browser locale. */
export function formatDateField(iso: string, locale: 'he' | 'en'): string {
  const [y, m, d] = iso.split('-');
  return [d, m, y].join(locale === 'he' ? '.' : '/');
}

/** The 6×7 Sunday-first grid of ISO days for the month containing `iso` (UTC, no TZ drift). */
export function monthGrid(year: number, month0: number): string[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay()); // getUTCDay: 0 = Sunday (א׳)
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
