import Papa from 'papaparse';
import { parseDecimalInput } from '@restomatch/types';
import { PosFileError, type PosParseIssue, type PosParseResult, type PosSaleRow, type PosSalesProvider } from './types';

export const MAX_POS_BYTES = 5 * 1024 * 1024;
export const MAX_POS_ROWS = 50_000;

/** Today in Israel (`YYYY-MM-DD`): the latest business day a POS file can carry. */
function latestBusinessDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Strict UTF-8 first; Israeli POS back offices still export Windows-1255. */
export function decodePosBytes(bytes: Uint8Array): string {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1255').decode(body);
  }
}

function norm(h: string): string {
  return h.toLowerCase().replace(/["'״׳`]/g, '').replace(/[\s_\-.]+/g, '');
}

/** Header keywords per field, most specific first (Hebrew + English POS exports). */
const KEYWORDS = {
  date: ['תאריך', 'יוםעסקים', 'date', 'businessday', 'day'],
  itemRef: ['קודפריט', 'מקט', 'קודמנה', 'plu', 'itemcode', 'sku', 'code', 'קוד'],
  itemName: ['שםפריט', 'שםמנה', 'תיאור', 'פריט', 'מנה', 'itemname', 'description', 'item', 'name', 'שם'],
  qty: ['כמות', 'יחידות', 'qty', 'quantity', 'units', 'count'],
  net: ['מכירותנטו', 'נטו', 'לפנימעמ', 'netsales', 'net', 'סהכ', 'סכום', 'מכירות', 'amount', 'total', 'sales'],
} as const;

/**
 * Header fragments that disqualify a column for a field even when a keyword
 * matches as a substring ("Discount Amount" is not the net, "Discount" is not
 * the count, "Last Updated" is not the business day).
 */
const EXCLUDE: Partial<Record<keyof typeof KEYWORDS, string[]>> = {
  date: ['עודכן', 'עדכון', 'updated', 'modified', 'created', 'time'],
  // "קוד קופאי" (cashier code), register/table/branch/receipt numbers are not the item.
  itemRef: ['קופאי', 'cashier', 'מלצר', 'waiter', 'עובד', 'employee', 'staff', 'קופה', 'register', 'terminal', 'שולחן', 'table', 'סניף', 'branch', 'קבלה', 'receipt', 'חשבונית', 'invoice', 'הזמנה', 'order'],
  itemName: ['קופאי', 'cashier', 'מלצר', 'waiter', 'עובד', 'employee', 'סניף', 'branch', 'לקוח', 'customer'],
  qty: ['הנחה', 'discount', 'החזר', 'refund'],
  // Net = before VAT: gross / incl.-VAT totals are refused (better "missing column" than a wrong ₪).
  net: ['הנחה', 'discount', 'מעמ', 'vat', 'tax', 'מס', 'טיפ', 'tip', 'עלות', 'cost', 'מחיר', 'price', 'gross', 'ברוטו', 'כולל'],
};

type Field = keyof typeof KEYWORDS;

/**
 * Headers that SAY they are net of VAT ("סה״כ לפני מע״מ", "ללא מע״מ",
 * "Net (excl. VAT)", "Sales excl VAT"). They mention VAT, so the generic
 * VAT/"incl" exclusions above must not refuse them — and when one exists it
 * beats a bare "סה״כ" / "Total" (usually incl. VAT, ~15% too high).
 */
const EX_VAT = ['לפנימעמ', 'ללאמעמ', 'לאכולל', 'excl', 'exvat', 'beforevat', 'withoutvat', 'pretax', 'beforetax'];
const NET_EXPLICIT = ['מכירותנטו', 'נטו', 'netsales', 'net', ...EX_VAT];
const NET_VAT_WORDS = new Set(['מעמ', 'vat', 'tax', 'מס', 'כולל']);
/** Says "before / without VAT" — only then may it mention VAT ("Net Tax" stays refused). */
const isExVat = (h: string) => EX_VAT.some((k) => norm(h).includes(k));
const isExplicitNet = (h: string) => NET_EXPLICIT.some((k) => norm(h).includes(k));

export function detectPosColumns(headers: string[]): PosParseResult['columns'] {
  const used = new Set<string>();
  const out = { date: null, itemRef: null, itemName: null, qty: null, net: null } as PosParseResult['columns'];
  const allowed = (field: Field, h: string) => {
    let ex = EXCLUDE[field] ?? [];
    if (field === 'net' && isExVat(h)) ex = ex.filter((x) => !NET_VAT_WORDS.has(x));
    return !ex.some((x) => norm(h).includes(x));
  };
  // Codes before names: "קוד פריט" must not be taken as the item name.
  for (const field of ['date', 'itemRef', 'qty', 'net', 'itemName'] as Field[]) {
    let free = headers.filter((h) => !used.has(h) && allowed(field, h));
    if (field === 'net' && free.some(isExplicitNet)) free = free.filter(isExplicitNet);
    // An exact header ("Qty", "כמות") beats a substring match ("Discount Count").
    const pick =
      KEYWORDS[field].map((kw) => free.find((h) => norm(h) === kw)).find(Boolean) ??
      KEYWORDS[field].map((kw) => free.find((h) => norm(h).includes(kw))).find(Boolean);
    if (pick) {
      out[field] = pick;
      used.add(pick);
    }
  }
  return out;
}

/** `DD/MM/YYYY`, `D.M.YY`, `YYYY-MM-DD` → `YYYY-MM-DD` (Israeli exports are day-first). */
export function parsePosDate(raw: string): string | null {
  const s = raw.trim().split(/[ T]/)[0] ?? '';
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * @deprecated G-13 — use `parseDecimalInput(raw, 'ils' | 'qty', …)` from
 * @restomatch/types, the one input parser. Kept as a thin wrapper so the POS
 * importer and its tests are unchanged: a decimal cell → integer units of
 * 10^-scale (scale 2 = agorot, scale 3 = qty in thousandths), or null when the
 * cell is ambiguous or not a number (the line is reported, not imported).
 *
 * The POS grammar it always had: a sign is allowed; a value with both "," and
 * "." takes the later one as the decimal mark ("1,234.50", "1.234,50") for
 * money and qty alike; "1,250" is thousands for money and ambiguous for a qty;
 * "1.234" as money (3 decimals) is ambiguous. Only ₪, spaces and LRM/RLM are
 * ignored (a currency word is not a POS number).
 */
export function parseScaled(raw: string, scale: 2 | 3): number | null {
  if (/[^\d.,()\-₪\s\u200e\u200f]/.test(raw)) return null;
  const both = raw.includes(',') && raw.includes('.');
  const r = parseDecimalInput(raw, scale === 2 ? 'ils' : 'qty', { negative: true, decimal: both ? 'comma' : 'auto' });
  if (r.kind !== 'ok') return null;
  return 'agorot' in r ? r.agorot : (r as { milli: number }).milli;
}

/** NUMERIC(12,3) qty and NUMERIC(12,2) money ceilings (pos_sales). */
const MAX_QTY_MILLI = 999_999_999_999;
const MAX_NET_AGOROT = 999_999_999_999;

/**
 * Generic CSV adapter: any POS that can export "sales by item" (Tabit,
 * Beecomm, Caspit, Excel → CSV). Rows for the same day + item are summed, so a
 * per-ticket export works too.
 */
export const csvPosProvider: PosSalesProvider = {
  id: 'csv',
  displayName: 'CSV',
  parse({ bytes }) {
    if (bytes.length > MAX_POS_BYTES) throw new PosFileError('TOO_LARGE');
    const text = decodePosBytes(bytes);
    // Rows as arrays (no header mode, no line skipping) so every record maps to
    // its real line in the file — blank lines and quoted multi-line cells
    // included — for the line numbers in the issue list.
    const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
    const records = parsed.data;
    let line = 1;
    const located: Array<{ line: number; cells: string[] }> = [];
    for (const cells of records) {
      const here = line;
      line += 1 + cells.reduce((n, c) => n + (c.match(/\r\n|\r|\n/g)?.length ?? 0), 0);
      if (cells.length === 1 && cells[0]!.trim() === '') continue; // blank line
      located.push({ line: here, cells });
    }
    const [head, ...body] = located;
    const headers = (head?.cells ?? []).map((h) => h.trim());
    if (headers.filter(Boolean).length === 0 || body.length === 0) throw new PosFileError('EMPTY');
    if (body.length > MAX_POS_ROWS) throw new PosFileError('TOO_MANY_ROWS');
    const columns = detectPosColumns(headers.filter(Boolean));
    const missing = (['date', 'qty', 'net'] as const).filter((f) => !columns[f]);
    if (!columns.itemRef && !columns.itemName) missing.push('item' as never);
    if (missing.length) throw new PosFileError('NO_COLUMNS', missing);
    const col = (name: string | null) => (name ? headers.indexOf(name) : -1);
    const at = { date: col(columns.date), ref: col(columns.itemRef), name: col(columns.itemName), qty: col(columns.qty), net: col(columns.net) };

    const issues: PosParseIssue[] = [];
    const latest = latestBusinessDay();
    const byKey = new Map<string, PosSaleRow>();
    for (const { line, cells } of body) {
      // A row whose field count is off (e.g. an unquoted "₪ 1,234.56" split in
      // two) would import shifted values: report it instead.
      if (cells.length !== headers.length) {
        issues.push({ line, code: 'BAD_ROW' });
        continue;
      }
      const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
      const parsedDay = parsePosDate(get(at.date));
      // A future day is a typo (15/09/2062), not a sale.
      if (!parsedDay || parsedDay > latest) {
        issues.push({ line, code: 'BAD_DATE' });
        continue;
      }
      const soldOn = parsedDay;
      const name = get(at.name);
      const ref = Array.from(get(at.ref) || name).slice(0, 64).join('');
      if (!ref) {
        issues.push({ line, code: 'NO_ITEM', soldOn });
        continue;
      }
      const qty = parseScaled(get(at.qty), 3);
      const net = parseScaled(get(at.net), 2);
      if (net === null || Math.abs(net) > MAX_NET_AGOROT) {
        issues.push({ line, code: 'BAD_AMOUNT', soldOn });
        continue;
      }
      // A refund / void line is negative qty with a non-positive amount; it nets out.
      if (qty === null || Math.abs(qty) > MAX_QTY_MILLI || (qty < 0 && net > 0)) {
        issues.push({ line, code: 'BAD_QTY', soldOn });
        continue;
      }
      const key = `${soldOn}\u0000${ref}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.qtyMilli += qty;
        prev.netAgorot += net;
      } else {
        byKey.set(key, { soldOn, itemRef: ref, itemName: name || ref, qtyMilli: qty, netAgorot: net });
      }
    }
    for (const [key, r] of byKey) {
      // Refunds can't take a day below zero items; keep the money, floor the count.
      if (r.qtyMilli < 0) r.qtyMilli = 0;
      if (r.qtyMilli > MAX_QTY_MILLI || Math.abs(r.netAgorot) > MAX_NET_AGOROT) {
        byKey.delete(key);
        issues.push({ line: 0, code: 'BAD_AMOUNT' });
      }
    }
    const rows = [...byKey.values()].sort((a, b) => (a.soldOn + a.itemRef).localeCompare(b.soldOn + b.itemRef));
    // Days that appear in the file but kept NO valid row: an import leaves their
    // earlier data in place, so the result says so.
    const accepted = new Set(rows.map((r) => r.soldOn));
    const rejectedDays = [...new Set(issues.map((i) => i.soldOn).filter((d): d is string => !!d && !accepted.has(d)))].sort();
    return { rows, issues, columns, rejectedDays };
  },
};
