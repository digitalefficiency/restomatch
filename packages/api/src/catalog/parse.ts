import Papa from 'papaparse';
// exceljs is a CommonJS bundle with no ESM named exports. Under Node's native
// ESM loader (the worker runs `tsx src/index.ts` as type:module) a named import
// `{ Workbook }` throws "does not provide an export named 'Workbook'" — vitest's
// transform masked it in CI. The default import works on both loaders.
import ExcelJS from 'exceljs';
import type { Cell } from 'exceljs';
const { Workbook } = ExcelJS;
import type { CatalogColumnMapping } from '@restomatch/db';
import {
  detectDecimalStyle,
  exVatPriceUnits,
  parseMoneyCell,
  priceUnitsToNumeric,
  toPriceUnits,
  type DecimalStyle,
} from '../lib/parseMoneyCell';

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

/**
 * A user-fixable problem with an uploaded catalog file. `code` is stable so the
 * UI can show a localized explanation (the tRPC layer forwards it as
 * `CATALOG_FILE_<code>` in a BAD_REQUEST message).
 */
export type CatalogFileErrorCode = 'TOO_LARGE' | 'LEGACY_XLS' | 'UNREADABLE' | 'EMPTY' | 'TOO_MANY_ROWS';

export class CatalogFileError extends Error {
  constructor(
    readonly code: CatalogFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogFileError';
  }
}

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
    throw new CatalogFileError(
      'TOO_LARGE',
      `קובץ גדול מדי (${buf.byteLength} bytes, מקסימום ${MAX_XLSX_BYTES})`,
    );
  }
  // Legacy binary Excel (.xls, OLE2 "D0 CF 11 E0") — exceljs reads only .xlsx.
  if (buf.byteLength >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    throw new CatalogFileError('LEGACY_XLS', 'קובץ Excel ישן (.xls) — שמרו אותו כ-.xlsx או כ-CSV');
  }
  // .xlsx is a zip container ("PK"); anything else can't be a workbook.
  if (buf.byteLength < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new CatalogFileError('UNREADABLE', 'הקובץ אינו גיליון Excel תקין');
  }
  const wb = new Workbook();
  try {
    // Cast bridges the generic-`Buffer` friction between @types/node and exceljs's
    // bundled typings (Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer>).
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new CatalogFileError('UNREADABLE', 'לא ניתן לקרוא את קובץ ה-Excel');
  }
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

/**
 * Parse an uploaded catalog file into a header + row table. Throws
 * `CatalogFileError` for files the user has to fix (legacy .xls, corrupt
 * workbook, no header row) so the UI can say exactly what to do.
 */
export async function parseCatalogFile(file: CatalogFileInput): Promise<ParsedTable> {
  const ext = file.filename.toLowerCase().split('.').pop() ?? '';
  let table: ParsedTable;
  if (ext === 'csv' || (file.text != null && !file.base64)) {
    const text =
      file.text ?? (file.base64 ? Buffer.from(file.base64, 'base64').toString('utf8') : '');
    table = parseCsv(text);
  } else {
    const buf = file.base64
      ? Buffer.from(file.base64, 'base64')
      : Buffer.from(file.text ?? '', 'utf8');
    table = await parseXlsx(buf);
  }
  if (table.headers.length === 0) {
    throw new CatalogFileError('EMPTY', 'לא נמצאה שורת כותרות בקובץ');
  }
  return table;
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

/** Header fragments that mark a code/identifier column (never the product name). */
const CODE_HINTS = ['קוד', 'מקט', 'sku', 'code', 'ברקוד', 'barcode'];

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
      // "קוד פריט" / "item code" is an identifier, not the description, even
      // though it contains the name keyword "פריט"/"item".
      if (field === 'name' && CODE_HINTS.some((kw) => n.includes(kw))) continue;
      if (kws.some((kw) => n.includes(kw))) {
        mapping[field] = h;
        taken.add(h);
        break;
      }
    }
  }
  return mapping;
}

/**
 * Parse a price/quantity cell that may carry ₪, thousands separators, etc.
 * Strict (lib/parseMoneyCell): "1,250" is 1250, "12,90" is 12.9, and a cell
 * that can't be read unambiguously ("-5", "1,2345") is null, never guessed.
 */
export function parseNumeric(raw: string | undefined | null, decimal: DecimalStyle = 'auto'): number | null {
  const cell = parseMoneyCell(raw, decimal);
  return cell.kind === 'ok' ? cell.value : null;
}

/** Is the price list quoted before VAT ('ex', the default) or including it ('inc')? */
export type VatBasis = 'ex' | 'inc';

/**
 * The catalog import's choices beyond column → field, stored with the mapping
 * in `catalog_imports.column_mapping` (jsonb, no schema change) and carried in
 * the worker's job payload, so the inline and background paths read the file
 * the same way.
 */
export interface CatalogImportOptions {
  vatBasis?: VatBasis;
  /**
   * The restaurant's VAT rate at import time, as its NUMERIC(5,4) string
   * ("0.1800"); used only when vatBasis = 'inc'. A string so the mapping stays a
   * flat string map (the queue payload's shape).
   */
  vatRate?: string;
}
export type CatalogImportMapping = CatalogColumnMapping & CatalogImportOptions;

/** A header that says the prices include VAT ("כולל מע״מ", "incl. VAT"). */
const INC_VAT = /כולל\s*מע["״'׳]?מ|כולל\s*מעמ|incl(?:uding|\.)?\s*vat|vat\s*incl/i;
const EX_VAT = /(?:לא\s*כולל|ללא|לפני)\s*מע["״'׳]?מ|excl(?:uding|\.)?\s*vat|before\s*vat|\+\s*מע["״'׳]?מ/i;

/** Pre-set the VAT basis from the headers: a "כולל מע״מ" header → 'inc', else null (ask). */
export function detectVatBasis(headers: string[]): VatBasis | null {
  if (headers.some((h) => EX_VAT.test(h))) return 'ex';
  if (headers.some((h) => INC_VAT.test(h))) return 'inc';
  return null;
}

/** Why a non-empty row is held out of the commit. */
export type HeldReason = 'UNCLEAR_PRICE';

export interface HeldRow {
  /** 1-based data-row number (the header is row 0) — what the user sees in the file. */
  rowNumber: number;
  supplierNameRaw: string;
  supplierSku: string | null;
  rawPrice: string;
  reason: HeldReason;
}

export interface AnalyzedRow extends CatalogRow {
  rowNumber: number;
  /** The price cell as written in the file. */
  rawPrice: string | null;
}

export interface CatalogRowsAnalysis {
  /** Rows that will be committed (prices already VAT-exclusive). */
  rows: AnalyzedRow[];
  /** Rows with a non-empty price cell that didn't parse — never committed. */
  held: HeldRow[];
  decimal: DecimalStyle;
}

/**
 * Project parsed rows onto catalog rows using a column mapping, holding out
 * any row whose price cell is present but unreadable ("מחיר לא ברור"), and
 * converting VAT-inclusive prices to ex-VAT (integer price units, half-up).
 */
export function analyzeCatalogRows(table: ParsedTable, mapping: CatalogImportMapping): CatalogRowsAnalysis {
  const get = (row: Record<string, string>, header?: string): string | null => {
    if (!header) return null;
    const v = row[header];
    if (v == null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  };
  const decimal = mapping.price ? detectDecimalStyle(table.rows.map((r) => get(r, mapping.price))) : 'auto';
  const vatRate = Number(mapping.vatRate);
  const inc = mapping.vatBasis === 'inc' && Number.isFinite(vatRate) && vatRate > 0 && vatRate < 1;
  const rows: AnalyzedRow[] = [];
  const held: HeldRow[] = [];
  table.rows.forEach((row, i) => {
    const supplierNameRaw = get(row, mapping.name);
    if (!supplierNameRaw) return; // a row without a description can't be a catalog item
    const supplierSku = get(row, mapping.sku);
    const rawPrice = get(row, mapping.price);
    const cell = parseMoneyCell(rawPrice, decimal);
    if (cell.kind === 'invalid') {
      held.push({ rowNumber: i + 1, supplierNameRaw, supplierSku, rawPrice: cell.raw, reason: 'UNCLEAR_PRICE' });
      return;
    }
    let listPrice: number | null = cell.kind === 'ok' ? cell.value : null;
    if (listPrice != null) {
      const units = toPriceUnits(listPrice);
      listPrice = Number(priceUnitsToNumeric(inc ? exVatPriceUnits(units, vatRate) : units));
    }
    rows.push({
      rowNumber: i + 1,
      rawPrice,
      supplierSku,
      supplierNameRaw,
      unit: get(row, mapping.unit),
      listPrice,
      barcodeEan: get(row, mapping.barcode),
      packSize: parseNumeric(get(row, mapping.packSize)),
    });
  });
  return { rows, held, decimal };
}

/**
 * The committable catalog rows (held-out rows excluded). Shared by the inline
 * tRPC commit and the import-catalog worker, so neither can store a guess.
 */
export function extractCatalogRows(table: ParsedTable, mapping: CatalogImportMapping): CatalogRow[] {
  return analyzeCatalogRows(table, mapping).rows.map(
    ({ supplierSku, supplierNameRaw, unit, listPrice, barcodeEan, packSize }) => ({
      supplierSku,
      supplierNameRaw,
      unit,
      listPrice,
      barcodeEan,
      packSize,
    }),
  );
}
