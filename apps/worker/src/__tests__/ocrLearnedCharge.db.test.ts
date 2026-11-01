import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, invoiceLines, invoices, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import type { InvoiceOcrResult } from '@restomatch/types';

/**
 * G-08 review round 3 (MEDIUM "charge answers aren't learned"): a line a person
 * answered "שורת חיוב — לא מוצר" last week is pre-marked a charge line by the
 * OCR job this week — no question, no hold, and the match is chained.
 */
const enqueued: unknown[] = [];
vi.mock('@restomatch/queue', async (orig) => {
  const real = await orig<typeof import('@restomatch/queue')>();
  return { ...real, enqueueMatchInvoice: async (p: unknown) => (enqueued.push(p), true) };
});
const { processOcrInvoice } = await import('../jobs/ocrInvoice');

const db = createDb(testDbUrl());
let restaurantId = '';
let supplierId = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
}
beforeEach(async () => {
  await cleanup();
  enqueued.length = 0;
  const [r] = await db.insert(restaurants).values({ name: 'G-08 learned charge' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'מחלבה' }).returning();
  supplierId = s!.id;
  // Last week's answer, learned (mapping.markCharge).
  await db
    .update(restaurants)
    .set({ settings: { chargeKeys: [{ supplierId, sku: null, nameKey: 'פיקדון ארגזים', rawName: 'פיקדון ארגזים', minAgorot: 1000, maxAgorot: 1000, by: null, at: '2026-10-24T08:00:00Z' }] } as never })
    .where(eq(restaurants.id, restaurantId));
});
afterAll(cleanup);

const scan = (lines: InvoiceOcrResult['lines']): InvoiceOcrResult =>
  ({
    supplier: { name: 'מחלבה' },
    invoiceNumber: 'W2-1',
    invoiceDate: '2026-10-31',
    lines,
    totals: { subtotal: 10, vat: 0, total: 10 },
  }) as InvoiceOcrResult;

async function runOcr(result: InvoiceOcrResult) {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId, supplierId, status: 'ocr_pending', source: 'photo' })
    .returning({ id: invoices.id });
  await processOcrInvoice({
    id: 'j1',
    name: 'ocr-invoice',
    attemptsMade: 0,
    opts: { attempts: 1 },
    data: { restaurantId, invoiceId: inv!.id, supplierId, imageUrl: 'stub', mockProviders: { docAi: result, claude: result } },
  });
  return inv!.id;
}

describe('OCR pre-marks a learned charge key (round 3)', () => {
  it("week 2's deposit line → a charge line, the invoice is not held, and the match is chained", async () => {
    const id = await runOcr(scan([{ rawDescription: 'פיקדון  ארגזים', qty: 1, unit: 'יח׳', unitPrice: 10, lineTotal: 10 }]));
    const [row] = await db.select({ status: invoices.status, p: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, id));
    const [line] = await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    expect(row!.status).toBe('matched');
    expect((row!.p as unknown as { chargeLineIds: string[] }).chargeLineIds).toEqual([line!.id]);
    expect(enqueued).toHaveLength(1);
  });

  it('a line of another name is still a question (held)', async () => {
    const id = await runOcr(scan([{ rawDescription: 'פיקדון בקבוקים', qty: 1, unit: 'יח׳', unitPrice: 10, lineTotal: 10 }]));
    const [row] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id));
    expect(row!.status).toBe('parsed');
    expect(enqueued).toHaveLength(0);
  });
});
