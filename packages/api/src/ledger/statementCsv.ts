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

/** "1,234.50" · "₪ 1234.5" · "(80.00)" · "80.00-" → signed agorot; null when unreadable. */
export function parseStatementAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[₪\s‎‏]/g, '').replace(/ש["״]?ח/g, '');
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
  s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  const v = decimalToScaled(s, 2);
  if (v === null) return null;
  return neg ? -v : v;
}

/** dd/mm/yyyy · dd.mm.yy · yyyy-mm-dd → YYYY-MM-DD; null when unreadable. */
export function parseStatementDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return iso(y, +m[2]!, +m[1]!);
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The document type text → a line kind. Credit is checked first: "חשבונית זיכוי" is a credit. */
export function kindFromType(raw: string | undefined): StatementLineKind | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (/זיכוי|credit/.test(t)) return 'credit';
  if (/תשלום|קבלה|העברה|צ['׳]?ק|שיק|הפקדה|payment|receipt|transfer|cheque|check/.test(t)) return 'payment';
  if (/חשבונית|ח-ן|חש['׳]|invoice|inv\b/.test(t)) return 'invoice';
  if (/יתרה|פתיחה|balance|opening/.test(t)) return 'other';
  return null;
}

export function parseStatementCsv(text: string): ParsedStatement {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  const first = rows.find((r) => r.trim()) ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  const lines: StatementLine[] = [];
  const skipped: ParsedStatement['skipped'] = [];

  const cols = new Map<Col, number>();
  let headerRow = -1;
  for (let i = 0; i < rows.length && headerRow < 0; i++) {
    if (!rows[i]!.trim()) continue;
    splitRow(rows[i]!, sep).forEach((cell, idx) => {
      for (const [col, re] of HEADERS) if (!cols.has(col) && re.test(cell)) cols.set(col, idx);
    });
    headerRow = i;
  }
  const headerFound = cols.has('amount') || cols.has('debit') || cols.has('credit');
  if (!headerFound) return { lines, skipped, headerFound };

  for (let i = headerRow + 1; i < rows.length && lines.length < MAX_STATEMENT_LINES; i++) {
    const raw = rows[i]!;
    if (!raw.trim()) continue;
    const cells = splitRow(raw, sep);
    const cell = (c: Col) => (cols.has(c) ? cells[cols.get(c)!] : undefined);
    const row = i + 1;
    let signed: number | null = null;
    const debit = parseStatementAmount(cell('debit'));
    const credit = parseStatementAmount(cell('credit'));
    if (debit) signed = debit;
    else if (credit) signed = -credit;
    else if (cols.has('amount')) signed = parseStatementAmount(cell('amount'));
    if (signed === null) {
      const anyText = [cell('debit'), cell('credit'), cell('amount')].some((v) => v && v.trim());
      skipped.push({ row, reason: anyText ? 'bad_amount' : 'no_amount' });
      continue;
    }
    if (signed === 0) continue;
    // In the supplier's statement of our account, debits are what we owe (invoices)
    // and credits reduce it (payments, credit notes). The type text decides which credit.
    const kind = kindFromType(cell('type')) ?? (signed > 0 ? 'invoice' : 'other');
    const number = cell('number')?.trim() || null;
    lines.push({ row, date: parseStatementDate(cell('date')), kind, number, amountAgorot: Math.abs(signed) });
  }
  return { lines, skipped, headerFound };
}
