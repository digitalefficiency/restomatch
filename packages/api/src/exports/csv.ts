/**
 * CSV generation utilities — minimal, RFC 4180 compliant.
 * No external dependency.
 */

export interface CsvField<T = Record<string, unknown>> {
  header: string;
  value: (row: T) => string | number | null | undefined | Date;
}

export function toCsv<T>(rows: T[], fields: CsvField<T>[]): string {
  const headerRow = fields.map((f) => escape(f.header)).join(',');
  const dataRows = rows.map((row) =>
    fields.map((f) => escape(formatValue(f.value(row)))).join(','),
  );
  return [headerRow, ...dataRows].join('\n');
}

function escape(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatValue(v: string | number | null | undefined | Date): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
