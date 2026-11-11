import { decimalToScaled } from '../orders/document/build';
import type { StatementLine, StatementLineKind } from './statement';

/**
 * W3-11 · Parse a supplier statement (כרטסת) exported to CSV / pasted from a
 * spreadsheet. Pure. Accepts comma, semicolon or tab separators, a Hebrew or
 * English header row, and either one signed amount column or separate
 * חובה (debit) / זכות (credit) columns. Amounts become positive integer agorot;
 * the line kind carries the direction.
 */

export const MAX_STATEMENT_LINES = 2000;
/** Unreadable rows reported back (the rest are counted, not listed). */
export const MAX_SKIPPED_ROWS = 200;
/** ~2000 lines of a wide export. */
export const MAX_STATEMENT_CSV_CHARS = 400_000;

export interface ParsedStatement {
  lines: StatementLine[];
  /** Rows that were not empty and could not be read (1-based, header = row 1). */
  skipped: Array<{ row: number; reason: 'no_amount' | 'bad_amount' }>;
  /** False when no header column could be recognised. */
  headerFound: boolean;
}

type Col = 'date' | 'type' | 'number' | 'debit' | 'credit' | 'amount';

const HEADERS: Array<[Col, RegExp]> = [
  ['date', /^(תאריך|ת\.?\s*ערך|date)/i],
  ['type', /^(סוג|תיאור|פרטים|type|description|details)/i],
  ['number', /^(אסמכתא|אסמ|מס['׳]?\s*מסמך|מספר|מס['׳]?|number|doc|ref)/i],
  ['debit', /^(חובה|debit)/i],
  ['credit', /^(זכות|credit)/i],
  ['amount', /^(סכום|amount|total)/i],
];

function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * "1,234.50" · "₪ 1234.5" · "(80.00)" · "80.00-" → signed agorot; null when unreadable.
 * `decimalComma` (a European-format file: "1.234,50") reads dots as thousands and the
 * comma as the decimal point. Without it, a value like "12.500" (three decimals) is
 * ambiguous between ₪12.50 and ₪12,500 and is refused rather than guessed.
 */
export function parseStatementAmount(raw: string | undefined, decimalComma = false): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[₪\s\u200e\u200f]/g, '').replace(/ש["״]?ח/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (decimalComma) {
    s = s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  } else {
    if (/^\d+\.\d{3}$/.test(s)) return null;
    s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  }
  const v = decimalToScaled(s, 2);
  if (v === null) return null;
  return neg ? -v : v;
}

/** A value that can only be read in the European format ("1.234,50" · "12,50"). */
const EUROPEAN_VALUE = /^-?\(?\d{1,3}(\.\d{3})+,\d{1,2}\)?-?$|^-?\(?\d+,\d{1,2}\)?-?$/;

/** dd/mm/yyyy · dd.mm.yy · yyyy-mm-dd → YYYY-MM-DD; null when unreadable. */
export function parseStatementDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // Excel exports often carry a time ("01/10/2026 00:00"); the day is what counts.
  const s = raw.trim().replace(/[\sT]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return iso(y, +m[2]!, +m[1]!);
}

/** Statement years we accept; anything else is a typo (and 9999 would overflow the window SQL). */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function iso(y: number, mo: number, d: number): string | null {
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The document type text → a line kind, or null when the text says nothing. Order matters:
 * a cancellation (ביטול / storno) is never read as the thing it cancels; "חשבונית זיכוי" is a
 * credit before it is an invoice; "חשבונית מס קבלה" (invoice-receipt) is decided by the column
 * it sits in ('invoice_receipt' here).
 */
export function kindFromType(raw: string | undefined): StatementLineKind | 'invoice_receipt' | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (/ביטול|מבוטל|storno|reversal|cancel/.test(t)) return 'other';
  if (/זיכוי|credit/.test(t)) return 'credit';
  if (/חשבונית[\s/-]*(מס[\s/-]*)?קבלה|invoice[\s/-]*receipt/.test(t)) return 'invoice_receipt';
  if (/תשלום|קבלה|העברה|צ['׳]?ק|שיק|הפקדה|payment|receipt|transfer|cheque|check/.test(t)) return 'payment';
  if (/חשבונית|ח-ן|חש['׳]|invoice|inv\b/.test(t)) return 'invoice';
  if (/יתרה|פתיחה|balance|opening/.test(t)) return 'other';
  return null;
}

/**
 * A line's kind from its type text and its direction. In the supplier's statement of our
 * account a debit is what we owe (an invoice) and a credit reduces it (a payment or a credit
 * note). When the file carries a direction (debit/credit columns, or a signed amount), a type
 * that contradicts it is an adjustment we don't guess at: 'other'.
 */
function lineKind(typeText: string | undefined, signed: number, directional: boolean): StatementLineKind {
  const k = kindFromType(typeText);
  if (k === 'other') return 'other';
  if (k === 'invoice_receipt') return signed > 0 ? 'invoice' : 'payment';
  if (k === null) return signed > 0 ? 'invoice' : 'other';
  if (!directional) return k;
  if (k === 'invoice') return signed > 0 ? 'invoice' : 'other';
  return signed < 0 ? k : 'other';
}

/** How many rows above the header (a title, the supplier's name, a period line) we skip. */
const MAX_HEADER_SCAN = 25;

function guessSeparator(row: string): string {
  return [',', ';', '\t'].sort((a, b) => row.split(b).length - row.split(a).length)[0]!;
}

export function parseStatementCsv(text: string): ParsedStatement {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const lines: StatementLine[] = [];
  const skipped: ParsedStatement['skipped'] = [];

  // The header is the first row (within MAX_HEADER_SCAN) that names a money column;
  // exports often open with a title line. The separator is guessed from that row.
  let cols = new Map<Col, number>();
  let headerRow = -1;
  let sep = ',';
  for (let i = 0, seen = 0; i < rows.length && seen < MAX_HEADER_SCAN && headerRow < 0; i++) {
    if (!rows[i]!.trim()) continue;
    seen += 1;
    const rowSep = guessSeparator(rows[i]!);
    const found = new Map<Col, number>();
    splitRow(rows[i]!, rowSep).forEach((cell, idx) => {
      for (const [col, re] of HEADERS) if (!found.has(col) && re.test(cell)) found.set(col, idx);
    });
    if (found.has('amount') || found.has('debit') || found.has('credit')) {
      cols = found;
      headerRow = i;
      sep = rowSep;
    }
  }
  const headerFound = headerRow >= 0;
  if (!headerFound) return { lines, skipped, headerFound };

  const body = rows.slice(headerRow + 1).filter((r) => r.trim()).map((r) => splitRow(r, sep));
  const moneyIdx = (['debit', 'credit', 'amount'] as const).map((c) => cols.get(c)).filter((v): v is number => v != null);
  // European format when the file is ';'-separated or any money cell can only be read that way.
  const decimalComma =
    sep === ';' || body.some((cells) => moneyIdx.some((idx) => EUROPEAN_VALUE.test((cells[idx] ?? '').replace(/[₪\s]/g, ''))));
  const directionalColumns = cols.has('debit') || cols.has('credit');

  for (let i = headerRow + 1; i < rows.length && lines.length < MAX_STATEMENT_LINES; i++) {
    const raw = rows[i]!;
    if (!raw.trim()) continue;
    const cells = splitRow(raw, sep);
    const cell = (c: Col) => (cols.has(c) ? cells[cols.get(c)!] : undefined);
    const row = i + 1;
    let signed: number | null = null;
    const debit = parseStatementAmount(cell('debit'), decimalComma);
    const credit = parseStatementAmount(cell('credit'), decimalComma);
    if (debit) signed = debit;
    else if (credit) signed = -credit;
    else if (cols.has('amount')) signed = parseStatementAmount(cell('amount'), decimalComma);
    if (signed === null) {
      const anyText = [cell('debit'), cell('credit'), cell('amount')].some((v) => v && v.trim());
      if (skipped.length < MAX_SKIPPED_ROWS) skipped.push({ row, reason: anyText ? 'bad_amount' : 'no_amount' });
      continue;
    }
    if (signed === 0) continue;
    const kind = lineKind(cell('type'), signed, directionalColumns || signed < 0);
    const number = cell('number')?.trim() || null;
    lines.push({ row, date: parseStatementDate(cell('date')), kind, number, amountAgorot: Math.abs(signed) });
  }
  return { lines, skipped, headerFound };
}
