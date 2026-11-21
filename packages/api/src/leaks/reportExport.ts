// exceljs is a CommonJS bundle: the default import works under Node ESM and vitest (see catalog/parse.ts).
import ExcelJS from 'exceljs';
import type { LeakReport } from '@restomatch/charts';
import { toCsv, type CsvField } from '../exports/csv';

const { Workbook } = ExcelJS;

/**
 * W2-09c · the monthly leak report as files (leaks-30): one XLSX with three
 * sheets (by type · by supplier · מחירים שעלו) and the same three as CSV.
 * Amounts are numbers in shekels at 2 dp (no ₪ text: server money text is
 * G-13's), so a spreadsheet can sum them. Each sheet ends with a total row
 * computed from its own rows, so a file's total equals the rows it shows; the
 * by-type total differs from the hero by `capAdjustmentIls`, the same cap note
 * the screen shows.
 */

export type ExportLocale = 'he' | 'en';

const LABELS = {
  he: {
    sheets: { type: 'לפי סוג פער', supplier: 'לפי ספק', creep: 'מחירים שעלו' },
    type: 'סוג', count: 'מספר', amount: 'סכום (₪)', supplier: 'ספק', invoices: 'חשבוניות', spend: 'הוצאה (₪)',
    leak: 'דליפה (₪)', pct: '% מההוצאה', product: 'מוצר', before: 'מחיר רגיל (₪)', after: 'ממוצע החודש (₪)',
    change: 'שינוי (%)', excess: 'עודף (₪)', qty: 'כמות', total: 'סה״כ', none: 'ללא ספק',
  },
  en: {
    sheets: { type: 'By gap type', supplier: 'By supplier', creep: 'Prices that rose' },
    type: 'Type', count: 'Count', amount: 'Amount (ILS)', supplier: 'Supplier', invoices: 'Invoices', spend: 'Spend (ILS)',
    leak: 'Leak (ILS)', pct: '% of spend', product: 'Product', before: 'Usual price (ILS)', after: 'Month average (ILS)',
    change: 'Change (%)', excess: 'Excess (ILS)', qty: 'Qty', total: 'Total', none: 'No supplier',
  },
} as const;

/** Shekels rounded to the agora, as a number (exact Σ via integer agorot). */
const ils = (v: number) => Math.round(v * 100) / 100;
const sumIls = (xs: number[]) => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100;
const pct1 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);

type Row = Record<string, string | number | null>;
interface Sheet {
  name: string;
  columns: { key: string; header: string }[];
  rows: Row[];
}

/** The three sheets, total row included. Names/labels in `locale`; type codes stay as stored. */
export function reportSheets(report: LeakReport, locale: ExportLocale, typeLabel: (type: string) => string = (t) => t): Sheet[] {
  const L = LABELS[locale];
  const name = (he: string | null, en: string | null) => (locale === 'en' && en ? en : he) ?? L.none;

  const typeRows: Row[] = report.byType.map((r) => ({ type: typeLabel(r.type), count: r.count, amount: ils(r.amountIls) }));
  typeRows.push({
    type: L.total,
    count: report.byType.reduce((s, r) => s + r.count, 0),
    amount: sumIls(report.byType.map((r) => r.amountIls)),
  });

  const supRows: Row[] = report.bySupplier.map((r) => ({
    supplier: name(r.supplierName, r.supplierNameEn),
    invoices: r.invoiceCount,
    spend: ils(r.spendIls),
    leak: ils(r.leakIls),
    pct: pct1(r.leakPct),
  }));
  supRows.push({
    supplier: L.total,
    invoices: report.bySupplier.reduce((s, r) => s + r.invoiceCount, 0),
    spend: sumIls(report.bySupplier.map((r) => r.spendIls)),
    leak: sumIls(report.bySupplier.map((r) => r.leakIls)),
    pct: null,
  });

  const creepRows: Row[] = report.priceCreep.map((r) => ({
    product: name(r.productName, r.productNameEn),
    supplier: name(r.supplierName, r.supplierNameEn),
    before: ils(r.beforePrice),
    after: ils(r.afterPrice),
    change: pct1(r.deltaPct),
    qty: r.qty,
    excess: ils(r.excessIls),
  }));
  creepRows.push({ product: L.total, supplier: null, before: null, after: null, change: null, qty: null, excess: sumIls(report.priceCreep.map((r) => r.excessIls)) });

  return [
    { name: L.sheets.type, columns: [{ key: 'type', header: L.type }, { key: 'count', header: L.count }, { key: 'amount', header: L.amount }], rows: typeRows },
    {
      name: L.sheets.supplier,
      columns: [
        { key: 'supplier', header: L.supplier }, { key: 'invoices', header: L.invoices }, { key: 'spend', header: L.spend },
        { key: 'leak', header: L.leak }, { key: 'pct', header: L.pct },
      ],
      rows: supRows,
    },
    {
      name: L.sheets.creep,
      columns: [
        { key: 'product', header: L.product }, { key: 'supplier', header: L.supplier }, { key: 'before', header: L.before },
        { key: 'after', header: L.after }, { key: 'change', header: L.change }, { key: 'qty', header: L.qty }, { key: 'excess', header: L.excess },
      ],
      rows: creepRows,
    },
  ];
}

export interface LeakReportExport {
  filename: string;
  /** The XLSX, base64 (tRPC carries JSON). */
  xlsxBase64: string;
  csv: { type: string; supplier: string; creep: string };
}

export async function buildLeakReportExport(
  report: LeakReport,
  locale: ExportLocale,
  typeLabel?: (type: string) => string,
): Promise<LeakReportExport> {
  const sheets = reportSheets(report, locale, typeLabel);
  const wb = new Workbook();
  wb.creator = 'RestoMatch';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ rightToLeft: locale === 'he', state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ key: c.key, header: c.header, width: Math.max(12, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r);
    ws.getRow(ws.rowCount).font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  const csvOf = (s: Sheet) => toCsv(s.rows, s.columns.map((c): CsvField<Row> => ({ header: c.header, value: (r) => r[c.key] })));
  return {
    filename: `leak-report-${report.month}`,
    xlsxBase64: Buffer.from(buf as ArrayBuffer).toString('base64'),
    csv: { type: csvOf(sheets[0]!), supplier: csvOf(sheets[1]!), creep: csvOf(sheets[2]!) },
  };
}
