/** Pure helpers for the catalog import screen (unit-tested). */

/** Mirrors the tRPC FileInput cap (~9 MB binary in a 12M-char base64 string). */
export const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = ['xlsx', 'csv'] as const;

export function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

/**
 * Decode CSV bytes. Israeli Excel installs save "CSV" as Windows-1255, which
 * `File.text()` (always UTF-8) turned into mojibake headers — the auto-mapper
 * then found no columns. Strict UTF-8 first (a UTF-8 BOM is dropped), falling
 * back to Windows-1255 when the bytes aren't valid UTF-8.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

export type CatalogErrorKey =
  | 'TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'LEGACY_XLS'
  | 'UNREADABLE'
  | 'EMPTY'
  | 'NO_ROWS'
  | 'MAPPING_NAME';

const KNOWN: CatalogErrorKey[] = [
  'TOO_LARGE',
  'TOO_MANY_ROWS',
  'LEGACY_XLS',
  'UNREADABLE',
  'EMPTY',
  'NO_ROWS',
  'MAPPING_NAME',
];

/** Extract the stable `CATALOG_FILE_<code>` / `CATALOG_MAPPING_NAME` token from a server error. */
export function catalogErrorKey(err: unknown): CatalogErrorKey | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = /^CATALOG_(?:FILE_)?([A-Z_]+?)(?::|$)/.exec(message);
  if (!m) return null;
  const key = m[1] as CatalogErrorKey;
  return KNOWN.includes(key) ? key : null;
}

/** A small, valid sample price list (Hebrew headers the auto-mapper recognizes). */
export function sampleCatalogCsv(): string {
  const rows = [
    ['מק"ט', 'תיאור', 'יחידה', 'מחיר', 'ברקוד'],
    ['1001', 'עגבניות שרי', 'ק"ג', '12.90', '7290000000011'],
    ['1002', 'מלפפון', 'ק"ג', '6.50', '7290000000028'],
    ['1003', 'בצל יבש', 'ק"ג', '4.20', ''],
    ['1004', 'שמן זית כתית 1 ליטר', 'יח\'', '39.90', '7290000000042'],
  ];
  return '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
}
