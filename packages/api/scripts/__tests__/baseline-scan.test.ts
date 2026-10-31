import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceOcrResult } from '@restomatch/types';
import type { Extractor } from '../baseline-scan';

/**
 * Offline baseline scan (pilot brief S15, part B) with a MOCKED extractor —
 * no Claude call, no real customer document. The DB / storage modules are
 * mocked so that importing one would be recorded: the script must never load
 * any of them.
 */
const touched = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock('@restomatch/db', () => {
  touched.modules.push('@restomatch/db');
  return {};
});
vi.mock('postgres', () => {
  touched.modules.push('postgres');
  return { default: () => undefined };
});
vi.mock('@supabase/supabase-js', () => {
  touched.modules.push('@supabase/supabase-js');
  return {};
});

const scan = await import('../baseline-scan');
const { formatIlsAgorot } = await import('../../src/reports/money');

// ── Synthetic invoices (made-up suppliers, products and prices) ───────────────
type Line = InvoiceOcrResult['lines'][number];
const line = (rawDescription: string, qty: number, unitPrice: number, lineTotal = qty * unitPrice, extra: Partial<Line> = {}): Line => ({
  rawDescription,
  qty,
  unit: 'ק"ג',
  unitPrice,
  lineTotal,
  ...extra,
});
const invoice = (
  invoiceNumber: string,
  invoiceDate: string,
  lines: Line[],
  totals: { subtotal: number; vat: number; total: number },
): InvoiceOcrResult => ({ supplier: { name: 'OCR name ignored' }, invoiceNumber, invoiceDate, lines, totals });

/** Each document's bytes carry a marker the mocked extractor keys on. */
const OCR: Record<string, InvoiceOcrResult> = {
  'veg-1': invoice('V-100', '2026-08-03', [line('עגבניות', 10, 5), line('מלפפונים', 5, 4)], { subtotal: 70, vat: 0, total: 70 }),
  // VAT billed on 0% produce (12.60), tomatoes crept 5 → 6 (+10.00 on 10 kg).
  'veg-2': invoice('V-101', '2026-09-07', [line('עגבניות', 10, 6), line('מלפפונים', 5, 4)], { subtotal: 80, vat: 12.6, total: 92.6 }),
  // Same invoice number again (a re-sent copy) — a note, never counted.
  'veg-3': invoice('V-101', '2026-09-08', [line('עגבניות', 10, 9)], { subtotal: 90, vat: 0, total: 90 }),
  // Meat: contract 50/kg for SKU 7001 (Aug–Sep), 55/kg from October.
  //   line 1 billed 52 on 2026-08-10 → above contract by 2 × 20 kg = 40.00
  //   line 2 printed total 130 for 2 × 60 = 120 → line arithmetic 10.00
  //   VAT 18% of the printed subtotal 1170 = 210.60, billed 220.60 → VAT over by 10.00
  //   total 1400.40 vs 1170 + 220.60 = 1390.60 → total arithmetic 9.80
  'meat-1': invoice(
    'M-1',
    '2026-08-10',
    [line('פרגית טרייה', 20, 52, 1040, { sku: '7001' }), line('כבד עוף', 2, 60, 130)],
    { subtotal: 1170, vat: 220.6, total: 1400.4 },
  ),
  // October: 55 is inside the new contract; the creep from 52 → 55 is NOT counted
  // because the contract covers that line.
  'meat-2': invoice('M-2', '2026-10-05', [line('פרגית', 20, 55, 1100, { sku: '7-001' })], { subtotal: 1100, vat: 198, total: 1298 }),
};

class MockExtractor implements Extractor {
  calls = 0;
  async extract(image: Buffer): Promise<InvoiceOcrResult> {
    this.calls++;
    const key = /doc:([a-z0-9-]+)/.exec(image.toString('latin1'))?.[1];
    if (key === 'unreadable') throw new Error('could not read the invoice');
    const out = key ? OCR[key] : undefined;
    if (!out) throw new Error(`no fixture for ${key}`);
    return structuredClone(out);
  }
}

const jpeg = (key: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(` doc:${key} `)]);
const pdf = (key: string, pages: number) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} >> endobj\n${'<< /Type /Page >>\n'.repeat(pages)}% doc:${key}\n`);

const CONTRACT_CSV = [
  'מק״ט,תיאור,יחידה,מחיר חוזה לפני מע״מ,בתוקף מתאריך,בתוקף עד',
  '7001,פרגית טרייה,ק"ג,50,01/08/2026,30/09/2026',
  '7001,פרגית טרייה,ק"ג,"55.00",01/10/2026,',
].join('\n');

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'baseline-scan-'));
  const veg = path.join(dir, 'ירקות השדה');
  const meat = path.join(dir, 'עוף טוב');
  await mkdir(veg);
  await mkdir(meat);
  await writeFile(path.join(veg, '01.jpg'), jpeg('veg-1'));
  await writeFile(path.join(veg, '02.png'), jpeg('veg-2'));
  await writeFile(path.join(veg, '03.jpeg'), jpeg('veg-3'));
  await writeFile(path.join(veg, 'supplier.json'), JSON.stringify({ zeroVat: true }));
  await writeFile(path.join(veg, 'notes.txt'), 'ignored');
  await writeFile(path.join(meat, 'aug.pdf'), pdf('meat-1', 2));
  await writeFile(path.join(meat, 'oct.pdf'), pdf('meat-2', 1));
  await writeFile(path.join(meat, 'contract.csv'), '﻿' + CONTRACT_CSV);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(extra: Partial<Parameters<typeof scan.runBaseline>[0]> = {}) {
  const suppliers = await scan.readInputFolder(dir);
  const extractor = new MockExtractor();
  const result = await scan.runBaseline({ dir, suppliers, extractor, maxDocs: 50, approved: true, ...extra });
  return { result, extractor };
}

describe('baseline scan', () => {
  it('finds each overcharge once, traceable to file + page + line, in integer agorot', async () => {
    const { result, extractor } = await run();
    expect(extractor.calls).toBe(5);
    const got = result.findings.map((f) => [f.supplier, f.file, f.pages, f.line, f.kind, f.amountAgorot]);
    expect(got).toEqual([
      ['עוף טוב', path.join('עוף טוב', 'aug.pdf'), '1–2', 1, 'above_price_list', 4000],
      ['ירקות השדה', path.join('ירקות השדה', '02.png'), '1', null, 'vat_on_zero_rated', 1260],
      // equal amounts: by file name
      ['ירקות השדה', path.join('ירקות השדה', '02.png'), '1', 1, 'price_creep', 1000],
      ['עוף טוב', path.join('עוף טוב', 'aug.pdf'), '1–2', 2, 'line_arithmetic', 1000],
      ['עוף טוב', path.join('עוף טוב', 'aug.pdf'), '1–2', null, 'vat_overcharge', 1000],
      ['עוף טוב', path.join('עוף טוב', 'aug.pdf'), '1–2', null, 'total_arithmetic', 980],
    ]);
    expect(result.findings.every((f) => Number.isInteger(f.amountAgorot) && f.amountAgorot > 0)).toBe(true);
    const creep = result.findings.find((f) => f.kind === 'price_creep')!;
    expect(creep.ref).toBe(`${path.join('ירקות השדה', '01.jpg')} שורה 1`);
    // The re-sent V-101 is a note, not money.
    expect(result.suppliers[0]!.notes.join('\n')).toMatch(/03\.jpeg: אותו מספר חשבונית/);
  });

  it('report totals = Σ of the rows, to the agora (per supplier and overall, CSV and Markdown)', async () => {
    const { result } = await run();
    const sum = result.findings.reduce((n, f) => n + f.amountAgorot, 0);
    expect(result.leakAgorot).toBe(sum);
    expect(sum).toBe(4000 + 1260 + 1000 + 1000 + 1000 + 980);
    for (const s of result.suppliers) expect(s.leakAgorot).toBe(s.findings.reduce((n, f) => n + f.amountAgorot, 0));

    const csv = scan.toCsv(result);
    const rows = csv.replace(/^﻿/, '').trim().split('\n').slice(1);
    expect(rows).toHaveLength(result.findings.length);
    const amountCol = 9; // amount_agorot (no commas or quotes in the numeric columns)
    const csvSum = rows.reduce((n, r) => n + Number(r.split(',')[amountCol]), 0);
    expect(csvSum).toBe(result.leakAgorot);

    const md = scan.toMarkdown(result, '2026-11-05 09:00');
    expect(md).toContain(scan.REPORT_LABEL);
    expect(md).toContain(formatIlsAgorot(result.leakAgorot, { maximumFractionDigits: 2 }));
    expect(md.startsWith('<div dir="rtl">')).toBe(true);
    // Top 10 opens the report, before the per-supplier sections.
    expect(md.indexOf('## 10 הממצאים הגדולים')).toBeLessThan(md.indexOf('## לפי ספק'));
    expect(md).not.toMatch(/Intl|NaN|undefined/);
  });

  it('spend counts each analysed invoice once (the duplicate is excluded)', async () => {
    const { result } = await run();
    const veg = result.suppliers.find((s) => s.name === 'ירקות השדה')!;
    expect(veg.analysedInvoices).toBe(2);
    expect(veg.spendAgorot).toBe(7000 + 9260);
  });

  it('refuses to call Claude without --i-approved-spend', async () => {
    const suppliers = await scan.readInputFolder(dir);
    const extractor = new MockExtractor();
    await expect(scan.runBaseline({ dir, suppliers, extractor, maxDocs: 50, approved: false })).rejects.toBeInstanceOf(
      scan.SpendNotApprovedError,
    );
    expect(extractor.calls).toBe(0);

    const make = vi.fn(async () => extractor);
    const logs: string[] = [];
    expect(await scan.main(['--dir', dir], { makeExtractor: make, log: (m) => logs.push(m) })).toBe(2);
    expect(make).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/--i-approved-spend/);
  });

  it('--estimate makes 0 calls and prices photos and PDF pages', async () => {
    const make = vi.fn(async () => new MockExtractor());
    const logs: string[] = [];
    expect(await scan.main(['--dir', dir, '--estimate', '--i-approved-spend'], { makeExtractor: make, log: (m) => logs.push(m) })).toBe(0);
    expect(make).not.toHaveBeenCalled();
    const est = await scan.estimateSpend(await scan.readInputFolder(dir));
    expect(est).toEqual({ docs: 5, photos: 3, pdfs: 2, pdfPages: 3, usd: 0.35 }); // 3 × 0.055 + 3 × 0.06
    expect(logs[0]).toContain('$0.35');
  });

  it('--max-docs is a hard cap: a bigger folder is refused before any call', async () => {
    const suppliers = await scan.readInputFolder(dir);
    const extractor = new MockExtractor();
    await expect(scan.runBaseline({ dir, suppliers, extractor, maxDocs: 4, approved: true })).rejects.toBeInstanceOf(
      scan.MaxDocsExceededError,
    );
    expect(extractor.calls).toBe(0);

    const make = vi.fn(async () => extractor);
    expect(await scan.main(['--dir', dir, '--max-docs', '4', '--i-approved-spend'], { makeExtractor: make, log: () => undefined })).toBe(2);
    expect(make).not.toHaveBeenCalled();

    expect(scan.parseArgs(['--dir', dir]).maxDocs).toBe(scan.DEFAULT_MAX_DOCS);
    expect(() => scan.parseArgs(['--dir', dir, '--max-docs', '0'])).toThrow();
  });

  it('an unreadable document is listed, not counted, and the run goes on', async () => {
    await writeFile(path.join(dir, 'עוף טוב', 'zz-bad.jpg'), jpeg('unreadable'));
    const { result, extractor } = await run();
    expect(extractor.calls).toBe(6);
    const meat = result.suppliers.find((s) => s.name === 'עוף טוב')!;
    expect(meat.failures).toEqual([{ file: path.join('עוף טוב', 'zz-bad.jpg'), error: 'could not read the invoice' }]);
    expect(result.leakAgorot).toBe(9240);
  });

  it('end to end: writes the CSV + Markdown locally and nothing else', async () => {
    const out = path.join(dir, '..', `${path.basename(dir)}-out`);
    try {
      const code = await scan.main(['--dir', dir, '--out', out, '--i-approved-spend'], {
        makeExtractor: async () => new MockExtractor(),
        log: () => undefined,
        now: () => new Date('2026-11-05T07:00:00Z'),
      });
      expect(code).toBe(0);
      const md = await readFile(path.join(out, 'baseline-report.md'), 'utf8');
      expect(md).toContain('2026-11-05 07:00');
      const csv = await readFile(path.join(out, 'baseline-findings.csv'), 'utf8');
      expect(csv.startsWith('﻿supplier,file,pages,line')).toBe(true);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('never loads a database or storage client', () => {
    expect(touched.modules).toEqual([]);
  });

  it('contract CSV: Hebrew headers, quoted prices, date formats, open-ended rows', () => {
    const rows = scan.parseContractCsv(CONTRACT_CSV);
    expect(rows).toEqual([
      { sku: '7001', description: 'פרגית טרייה', unit: 'ק"ג', unitPrice: 50, validFrom: '2026-08-01', validTo: '2026-09-30' },
      { sku: '7001', description: 'פרגית טרייה', unit: 'ק"ג', unitPrice: 55, validFrom: '2026-10-01', validTo: null },
    ]);
    expect(() => scan.parseContractCsv('תיאור,יחידה\nא,ב')).toThrow(/מחיר חוזה/);
  });
});
