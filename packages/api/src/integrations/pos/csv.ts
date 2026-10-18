import Papa from 'papaparse';
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
  qty: ['הנחה', 'discount', 'החזר', 'refund'],
  net: ['הנחה', 'discount', 'מעמ', 'vat', 'tax', 'מס', 'טיפ', 'tip', 'עלות', 'cost', 'מחיר', 'price'],
};

type Field = keyof typeof KEYWORDS;

export function detectPosColumns(headers: string[]): PosParseResult['columns'] {
  const used = new Set<string>();
  const out = { date: null, itemRef: null, itemName: null, qty: null, net: null } as PosParseResult['columns'];
  const allowed = (field: Field, h: string) => !(EXCLUDE[field] ?? []).some((x) => norm(h).includes(x));
  // Codes before names: "קוד פריט" must not be taken as the item name.
  for (const field of ['date', 'itemRef', 'qty', 'net', 'itemName'] as Field[]) {
    const free = headers.filter((h) => !used.has(h) && allowed(field, h));
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
 * A decimal cell → integer units of 10^-scale, exact (no float math).
 * Accepts ₪, spaces, thousands separators ("1,234.50", European "1.234,50"),
 * a decimal comma ("12,5", "0,500"), and negatives as "-50", "50-" or "(50)".
 */
export function parseScaled(raw: string, scale: 2 | 3): number | null {
  let s = raw.replace(/[₪\s\u200e\u200f]/g, '');
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
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the later one is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Only commas: "1,234" / "12,345,678" are thousands — except "0,500" (a decimal).
    s = /^[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(scale + 1, '0');
  let v = Number(m[1]) * 10 ** scale + Number(frac.slice(0, scale)) + (Number(frac[scale]) >= 5 ? 1 : 0);
  if (neg) v = -v;
  return Number.isSafeInteger(v) ? v : null;
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
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });
    const headers = (parsed.meta.fields ?? []).filter(Boolean);
    if (headers.length === 0 || parsed.data.length === 0) throw new PosFileError('EMPTY');
    if (parsed.data.length > MAX_POS_ROWS) throw new PosFileError('TOO_MANY_ROWS');
    const columns = detectPosColumns(headers);
    const missing = (['date', 'qty', 'net'] as const).filter((f) => !columns[f]);
    if (!columns.itemRef && !columns.itemName) missing.push('item' as never);
    if (missing.length) throw new PosFileError('NO_COLUMNS', missing);

    const issues: PosParseIssue[] = [];
    // A row whose field count is off (e.g. an unquoted "₪ 1,234.56" split in two)
    // would import shifted values: report it instead.
    const brokenRows = new Set(
      parsed.errors.filter((e) => e.type === 'FieldMismatch' && typeof e.row === 'number').map((e) => e.row as number),
    );
    const latest = latestBusinessDay();
    const byKey = new Map<string, PosSaleRow>();
    parsed.data.forEach((rec, i) => {
      const line = i + 2;
      if (brokenRows.has(i)) return void issues.push({ line, code: 'BAD_ROW' });
      const parsedDay = parsePosDate(rec[columns.date!] ?? '');
      // A future day is a typo (15/09/2062), not a sale.
      if (!parsedDay || parsedDay > latest) return void issues.push({ line, code: 'BAD_DATE' });
      const soldOn = parsedDay;
      const name = (columns.itemName ? rec[columns.itemName] : '')?.trim() ?? '';
      const ref = ((columns.itemRef ? rec[columns.itemRef] : '')?.trim() || name).slice(0, 64);
      if (!ref) return void issues.push({ line, code: 'NO_ITEM' });
      const qty = parseScaled(rec[columns.qty!] ?? '', 3);
      const net = parseScaled(rec[columns.net!] ?? '', 2);
      if (net === null || Math.abs(net) > MAX_NET_AGOROT) return void issues.push({ line, code: 'BAD_AMOUNT' });
      // A refund / void line is negative qty with a non-positive amount; it nets out.
      if (qty === null || Math.abs(qty) > MAX_QTY_MILLI || (qty < 0 && net > 0)) {
        return void issues.push({ line, code: 'BAD_QTY' });
      }
      const key = `${soldOn}\u0000${ref}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.qtyMilli += qty;
        prev.netAgorot += net;
      } else {
        byKey.set(key, { soldOn, itemRef: ref, itemName: name || ref, qtyMilli: qty, netAgorot: net });
      }
    });
    for (const [key, r] of byKey) {
      // Refunds can't take a day below zero items; keep the money, floor the count.
      if (r.qtyMilli < 0) r.qtyMilli = 0;
      if (r.qtyMilli > MAX_QTY_MILLI || Math.abs(r.netAgorot) > MAX_NET_AGOROT) {
        byKey.delete(key);
        issues.push({ line: 0, code: 'BAD_AMOUNT' });
      }
    }
    const rows = [...byKey.values()].sort((a, b) => (a.soldOn + a.itemRef).localeCompare(b.soldOn + b.itemRef));
    return { rows, issues, columns };
  },
};
