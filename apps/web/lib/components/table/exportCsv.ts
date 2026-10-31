import { toCsv, type CsvColumn, type CsvRow } from '../views/csv';
import type { ColumnDef } from './types';

/**
 * ExportMenu CSV (exec-desktop-17): the `views/csv` escaping and BOM, plus
 * header rows that say what the file is — period, scope, filters and the
 * generated-at time in Asia/Jerusalem — then the column header, the rows and
 * the totals row. A file opened a month later still says what it covers.
 */

export interface ExportMeta {
  title: string;
  period: string;
  scope: string;
  filters: string;
  generatedAt: Date;
}

export interface ExportLabels {
  period: string;
  scope: string;
  filters: string;
  generatedAt: string;
}

/** dd.MM.yyyy HH:mm in Israel time, whatever the browser's zone. */
export function formatGeneratedAt(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}.${p('month')}.${p('year')} ${p('hour')}:${p('minute')} (Asia/Jerusalem)`;
}

function line(...cells: string[]): string {
  // A one-row CSV through the shared escaper: a header with no body rows.
  return toCsv(
    cells.map((label, i) => ({ key: String(i), label })),
    [],
  );
}

export function buildExportCsv(
  meta: ExportMeta,
  labels: ExportLabels,
  columns: CsvColumn[],
  rows: CsvRow[],
  totals?: CsvRow,
): string {
  const head = [
    line(meta.title),
    line(labels.period, meta.period),
    line(labels.scope, meta.scope),
    line(labels.filters, meta.filters),
    line(labels.generatedAt, formatGeneratedAt(meta.generatedAt)),
    '',
  ];
  const body = toCsv(columns, totals ? [...rows, totals] : rows);
  return [...head, body].join('\r\n');
}

export const CSV_BOM = '﻿';

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([CSV_BOM, text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * CSV columns and rows from table column defs. Money goes out as a plain
 * shekel number (agorot / 100, so Excel can sum it and a negative is never
 * quoted by the formula guard) with ₪ in the header; text as-is.
 */
export function exportTable<Row>(
  columns: readonly ColumnDef<Row>[],
  rows: readonly Row[],
  totals?: { label: string; columnId?: string; sumAgorot?: number },
  /** Written in a money cell whose amount is unknown (pending) — never blank, never 0. */
  unknownLabel = '',
): { columns: CsvColumn[]; rows: CsvRow[]; totals?: CsvRow } {
  const money = (agorot: unknown) =>
    typeof agorot === 'number' && Number.isFinite(agorot)
      ? Math.round(agorot) / 100
      : agorot == null || typeof agorot === 'number'
        ? unknownLabel
        : (agorot as string);
  const csvColumns = columns.map((c) => ({ key: c.id, label: c.kind === 'money' ? moneyHeaderText(c.header) : c.header }));
  const csvRows = rows.map((r) => {
    const out: CsvRow = {};
    for (const c of columns) {
      const v = (c.exportValue ?? c.value)?.(r);
      out[c.id] = c.kind === 'money' && !c.exportValue ? money(v) : v;
    }
    return out;
  });
  let totalsRow: CsvRow | undefined;
  if (totals) {
    totalsRow = { [columns[0]?.id ?? 'total']: totals.label };
    const col = columns.find((c) => c.id === totals.columnId);
    if (col && totals.sumAgorot != null) totalsRow[col.id] = money(totals.sumAgorot);
  }
  return { columns: csvColumns, rows: csvRows, totals: totalsRow };
}

function moneyHeaderText(header: string): string {
  return header.includes('₪') ? header : `${header} (₪)`;
}
