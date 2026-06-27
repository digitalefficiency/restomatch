import Papa from 'papaparse';
import { type Cell, Workbook } from 'exceljs';
import type { CatalogColumnMapping } from '@restomatch/db';

/**
 * Hard byte ceiling for a spreadsheet, enforced BEFORE handing the bytes to the
 * parser. Bounds zip-bomb / decompression and parse cost on an untrusted upload.
 * Mirrors the ~9 MB binary cap the tRPC `FileInput` schema already enforces on
 * the base64 payload (catalog.ts).
 */
const MAX_XLSX_BYTES = 10 * 1024 * 1024;

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

/**
 * Stringify a single ExcelJS cell deterministically. Handles rich-text,
 * formula results, hyperlinks and dates without applying locale number
 * formatting (so `parseNumeric` sees the raw value, matching the previous
 * SheetJS `raw:false` behaviour for our purposes).
 */
function cellToString(cell: Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text ?? '').join('');
    }
    if ('result' in v) {
      const r = (v as { result?: unknown }).result;
      return r == null ? '' : String(r);
    }
    if ('text' in v) return String((v as { text?: unknown }).text ?? '');
    return '';
  }
  return String(v);
}

async function parseXlsx(buf: Buffer): Promise<ParsedTable> {
  // Size guard BEFORE parse — never decompress an oversized untrusted upload.
  if (buf.byteLength > MAX_XLSX_BYTES) {
    throw new Error(`קובץ גדול מדי (${buf.byteLength} bytes, מקסימום ${MAX_XLSX_BYTES})`);
  }
  const wb = new Workbook();
  // Cast bridges the generic-`Buffer` friction between @types/node and exceljs's
  // bundled typings (Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer>).
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (!sheet || sheet.actualRowCount === 0) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellToString(cell).trim();
  });
  for (let i = 0; i < headers.length; i++) headers[i] = headers[i] ?? '';

  const rows: Array<Record<string, string>> = [];
  const lastRow = sheet.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const line = sheet.getRow(r);
    // Null-prototype row object: a malicious `__proto__` / `constructor` header
    // can never reach Object.prototype (defence-in-depth vs prototype pollution).
    const row: Record<string, string> = Object.create(null) as Record<string, string>;
    let hasValue = false;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i] ?? '';
      const v = cellToString(line.getCell(i + 1)).trim();
      if (h) row[h] = v;
      if (v) hasValue = true;
    }
    if (hasValue) rows.push(row);
  }
  return { headers: headers.filter(Boolean), rows };
}

/** Parse an uploaded catalog file into a header + row table. */
export async function parseCatalogFile(file: CatalogFileInput): Promise<ParsedTable> {
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
