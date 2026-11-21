import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { discrepancies, eq, invoices } from '@restomatch/db';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { callerFor, db } from './owner-test-helpers';

let A: Tenant;
let B: Tenant;
const NOW = new Date();
const month = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`;
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db.update(invoices).set({ invoiceDate: NOW, totalInclVat: '100000' }).where(eq(invoices.id, t.invoiceId));
    await db.update(discrepancies).set({ type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: t === A ? '74.50' : '999.00' }).where(eq(discrepancies.id, t.discrepancyId));
  }
});
afterAll(async () => resetDb(db));

describe('owner.leakReportExport (W2-09c)', () => {
  it('3 sheets; each total row = Σ its rows = the report; only A’s data', async () => {
    const report = await callerFor(A).owner.leakReport({ month });
    const out = await callerFor(A).owner.leakReportExport({ month, locale: 'he' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(out.xlsxBase64, 'base64') as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['לפי סוג פער', 'לפי ספק', 'מחירים שעלו']);
    const byType = wb.worksheets[0]!;
    const last = byType.getRow(byType.rowCount);
    const rows = Array.from({ length: byType.rowCount - 2 }, (_, i) => Number(byType.getRow(i + 2).getCell(3).value));
    expect(last.getCell(1).value).toBe('סה״כ');
    expect(Math.round(Number(last.getCell(3).value) * 100)).toBe(rows.reduce((s, v) => s + Math.round(v * 100), 0));
    expect(Math.round(Number(last.getCell(3).value) * 100)).toBe(report.byType.reduce((s, r) => s + Math.round(r.amountIls * 100), 0));
    expect(out.csv.type.split('\n').at(-1)).toMatch(/^סה״כ,/);
    const all = out.xlsxBase64 + out.csv.type + out.csv.supplier + out.csv.creep;
    expect(out.csv.supplier).not.toContain(B.supplierName);
    expect(all).not.toContain('999');
  });

  it('the bookkeeper reads the report and its export (finance tier); receiver and chef FORBIDDEN', async () => {
    await expect(callerFor(A, 'bookkeeper').owner.leakReport({ month })).resolves.toBeDefined();
    await expect(callerFor(A, 'bookkeeper').owner.leakReportExport({ month })).resolves.toBeDefined();
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerFor(A, role).owner.leakReport({ month })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A, role).owner.leakReportExport({ month })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
