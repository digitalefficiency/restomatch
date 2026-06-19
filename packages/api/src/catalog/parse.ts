import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CatalogColumnMapping } from '@restomatch/db';

/**
 * Pure spreadsheet parsing + Hebrew header detection for supplier price-list
 * imports. Runs server-side (tRPC for small files; the import-catalog worker for
 * large ones). The browser only reads the file to base64/text and posts it.
 */

export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface CatalogRow {
  supplierSku: string | null;
  supplierNameRaw: string;
  unit: string | null;
  listPrice: number | null;
  barcodeEan: string | null;
  packSize: number | null;
}

export interface CatalogFileInput {
  filename: string;
  /** base64-encoded bytes (xlsx/xls) */
  base64?: string;
  /** raw text (csv) */
  text?: string;
}

function parseCsv(text: string): ParsedTable {
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = (out.meta.fields ?? []).map((h) => h.trim()).filter(Boolean);
  const rows = (out.data ?? []).filter((r) => r && Object.keys(r).length > 0);
  return { headers, rows };
}

function parseXlsx(buf: Buffer): ParsedTable {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName]!;
  const aoa = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (aoa.length === 0) return { headers: [], rows: [] };
  const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
  const rows: Array<Record<string, string>> = [];
  for (const line of aoa.slice(1)) {
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, i) => {
      const v = String((line as Array<string | number | null>)[i] ?? '').trim();
      if (h) row[h] = v;
      if (v) hasValue = true;
    });
    if (hasValue) rows.push(row);
  }
  return { headers: headers.filter(Boolean), rows };
}

/** Parse an uploaded catalog file into a header + row table. */
export function parseCatalogFile(file: CatalogFileInput): ParsedTable {
  const ext = file.filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || (file.text != null && !file.base64)) {
    const text =
      file.text ?? (file.base64 ? Buffer.from(file.base64, 'base64').toString('utf8') : '');
    return parseCsv(text);
  }
  const buf = file.base64
    ? Buffer.from(file.base64, 'base64')
    : Buffer.from(file.text ?? '', 'utf8');
  return parseXlsx(buf);
}

/** Normalize a header for keyword matching (lowercase, strip quotes/gershayim/spaces). */
function norm(h: string): string {
  return h
    .toLowerCase()
    .replace(/["'״׳`]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

const FIELD_KEYWORDS: Record<keyof CatalogColumnMapping, string[]> = {
  sku: ['מקט', 'מק', 'sku', 'קוד', 'קטלוג', 'itemcode', 'code'],
  name: ['תיאור', 'שם', 'פריט', 'מוצר', 'description', 'name', 'item', 'product'],
  unit: ['יחידה', 'יח', 'unit', 'uom', 'measure'],
  price: ['מחיר', 'price', 'עלות', 'cost', 'מחירון', 'unitprice'],
  barcode: ['ברקוד', 'barcode', 'ean', 'upc'],
  packSize: ['אריזה', 'pack', 'packsize', 'גודל', 'qtyperpack', 'כמותבאריזה'],
};

/** Best-effort auto-mapping of sheet columns → canonical catalog fields. */
export function autoDetectMapping(headers: string[]): CatalogColumnMapping {
  const mapping: CatalogColumnMapping = {};
  const taken = new Set<string>();
  // Match in priority order so e.g. "barcode" isn't grabbed by the sku 'code' rule.
  const order: Array<keyof CatalogColumnMapping> = [
    'barcode',
    'name',
    'price',
    'sku',
    'unit',
    'packSize',
  ];
  for (const field of order) {
    const kws = FIELD_KEYWORDS[field];
    for (const h of headers) {
      if (taken.has(h)) continue;
      const n = norm(h);
      if (kws.some((kw) => n.includes(kw))) {
        mapping[field] = h;
        taken.add(h);
        break;
      }
    }
  }
  return mapping;
}

/** Parse a price/quantity cell that may carry ₪, thousands separators, etc. */
export function parseNumeric(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[₪$€\s]/g, '').trim();
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) {
    // Both present → comma is the thousands separator (e.g. 1,234.56).
    s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    // Only comma → treat as decimal separator (European style).
    s = s.replace(/,/g, '.');
  }
  s = s.replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Project parsed rows onto normalized catalog rows using a column mapping. */
export function extractCatalogRows(table: ParsedTable, mapping: CatalogColumnMapping): CatalogRow[] {
  const get = (row: Record<string, string>, header?: string): string | null => {
    if (!header) return null;
    const v = row[header];
    if (v == null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  };
  const out: CatalogRow[] = [];
  for (const row of table.rows) {
    const supplierNameRaw = get(row, mapping.name);
    if (!supplierNameRaw) continue; // a row without a description can't be a catalog item
    out.push({
      supplierSku: get(row, mapping.sku),
      supplierNameRaw,
      unit: get(row, mapping.unit),
      listPrice: parseNumeric(get(row, mapping.price)),
      barcodeEan: get(row, mapping.barcode),
      packSize: parseNumeric(get(row, mapping.packSize)),
    });
  }
  return out;
}
