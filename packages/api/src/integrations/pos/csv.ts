import Papa from 'papaparse';
import { PosFileError, type PosParseIssue, type PosParseResult, type PosSaleRow, type PosSalesProvider } from './types';

export const MAX_POS_BYTES = 5 * 1024 * 1024;
export const MAX_POS_ROWS = 50_000;

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

type Field = keyof typeof KEYWORDS;

export function detectPosColumns(headers: string[]): PosParseResult['columns'] {
  const used = new Set<string>();
  const out = { date: null, itemRef: null, itemName: null, qty: null, net: null } as PosParseResult['columns'];
  // Codes before names: "קוד פריט" must not be taken as the item name.
  for (const field of ['date', 'itemRef', 'qty', 'net', 'itemName'] as Field[]) {
    for (const kw of KEYWORDS[field]) {
      const h = headers.find((x) => !used.has(x) && norm(x).includes(kw));
      if (h) {
        out[field] = h;
        used.add(h);
        break;
      }
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
 * Accepts ₪, spaces, thousands commas ("1,234.50") and a decimal comma ("12,5").
 */
export function parseScaled(raw: string, scale: 2 | 3): number | null {
  let s = raw.replace(/[₪\s‎‏]/g, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(scale + 1, '0');
  let v = Number(m[2]) * 10 ** scale + Number(frac.slice(0, scale)) + (Number(frac[scale]) >= 5 ? 1 : 0);
  if (m[1]) v = -v;
  return Number.isSafeInteger(v) ? v : null;
}

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
    const byKey = new Map<string, PosSaleRow>();
    parsed.data.forEach((rec, i) => {
      const line = i + 2;
      const soldOn = parsePosDate(rec[columns.date!] ?? '');
      if (!soldOn) return void issues.push({ line, code: 'BAD_DATE' });
      const name = (columns.itemName ? rec[columns.itemName] : '')?.trim() ?? '';
      const ref = ((columns.itemRef ? rec[columns.itemRef] : '')?.trim() || name).slice(0, 64);
      if (!ref) return void issues.push({ line, code: 'NO_ITEM' });
      const qty = parseScaled(rec[columns.qty!] ?? '', 3);
      if (qty === null || qty < 0) return void issues.push({ line, code: 'BAD_QTY' });
      const net = parseScaled(rec[columns.net!] ?? '', 2);
      if (net === null) return void issues.push({ line, code: 'BAD_AMOUNT' });
      const key = `${soldOn}\u0000${ref}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.qtyMilli += qty;
        prev.netAgorot += net;
      } else {
        byKey.set(key, { soldOn, itemRef: ref, itemName: name || ref, qtyMilli: qty, netAgorot: net });
      }
    });
    const rows = [...byKey.values()].sort((a, b) => (a.soldOn + a.itemRef).localeCompare(b.soldOn + b.itemRef));
    return { rows, issues, columns };
  },
};
