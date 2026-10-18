import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { writeOcrHeader } from '../jobs/ocrInvoice';

// invoices_dedupe_idx is UNIQUE (supplier_id, invoice_number). A second scan of
// an invoice whose number is already on file used to throw out of the OCR job
// (the receiver lost the whole read). It must keep the read, drop the number,
// point at the invoice on file and hold the row for a human.
const db = createDb(testDbUrl());
let restaurantId = '';
let supplierId = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'OCR duplicate test' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ספק' }).returning();
  supplierId = s!.id;
});

afterAll(cleanup);

async function newInvoice(invoiceNumber: string | null = null) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId,
      supplierId,
      invoiceNumber,
      status: invoiceNumber ? 'matched' : 'ocr_pending',
      source: 'photo',
      rawImageUrl: 'https://x/a.jpg',
    })
    .returning();
  return inv!.id;
}

function header(invoiceNumber: string | null) {
  return {
    invoiceNumber,
    invoiceDate: new Date('2026-10-18'),
    totalExclVat: '100.00',
    vatAmount: '18.00',
    totalInclVat: '118.00',
    allocationNumber: null,
    ocrPayload: {
      provider: 'reconciled' as const,
      raw: { lines: 4 },
      reconciledAt: '2026-10-18T17:00:00Z',
    },
    ocrConfidence: '1',
    status: 'matched' as const,
  };
}

describe('writeOcrHeader', () => {
  it('writes the header as read when the number is free', async () => {
    const id = await newInvoice();
    const out = await writeOcrHeader(
      db,
      { restaurantId, invoiceId: id, supplierId },
      header('A-100'),
    );
    expect(out.duplicateOf).toBeUndefined();
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(row!.invoiceNumber).toBe('A-100');
    expect(row!.status).toBe('matched');
    expect(row!.totalInclVat).toBe('118.00');
  });

  it('keeps the read of a number already on file, without the number, held for review', async () => {
    const original = await newInvoice('A-100');
    const rescan = await newInvoice();
    const out = await writeOcrHeader(
      db,
      { restaurantId, invoiceId: rescan, supplierId },
      header('A-100'),
    );
    expect(out.duplicateOf).toBe(original);

    const [row] = await db.select().from(invoices).where(eq(invoices.id, rescan));
    expect(row!.invoiceNumber).toBeNull();
    expect(row!.status).toBe('parsed');
    expect(row!.totalInclVat).toBe('118.00');
    expect(row!.ocrPayload?.raw).toEqual({
      lines: 4,
      duplicateOf: { invoiceId: original, invoiceNumber: 'A-100' },
    });

    const [kept] = await db.select().from(invoices).where(eq(invoices.id, original));
    expect(kept!.invoiceNumber).toBe('A-100');
    expect(kept!.status).toBe('matched');
  });

  it('re-writing the same invoice with its own number is not a duplicate (job retry)', async () => {
    const id = await newInvoice();
    await writeOcrHeader(db, { restaurantId, invoiceId: id, supplierId }, header('A-100'));
    const out = await writeOcrHeader(
      db,
      { restaurantId, invoiceId: id, supplierId },
      header('A-100'),
    );
    expect(out.duplicateOf).toBeUndefined();
  });

  it('stores a blank number as NULL, so two unreadable numbers never collide', async () => {
    const first = await newInvoice();
    const second = await newInvoice();
    await writeOcrHeader(db, { restaurantId, invoiceId: first, supplierId }, header(''));
    const out = await writeOcrHeader(db, { restaurantId, invoiceId: second, supplierId }, header('  '));
    expect(out.duplicateOf).toBeUndefined();
    const rows = await db.select().from(invoices).where(eq(invoices.restaurantId, restaurantId));
    expect(rows.map((r) => r.invoiceNumber)).toEqual([null, null]);
    expect(rows.every((r) => r.status === 'matched')).toBe(true);
  });

  it('never writes another tenant’s invoice', async () => {
    const id = await newInvoice();
    const [other] = await db.insert(restaurants).values({ name: 'Other tenant' }).returning();
    try {
      await writeOcrHeader(
        db,
        { restaurantId: other!.id, invoiceId: id, supplierId },
        header('B-1'),
      );
      const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
      expect(row!.invoiceNumber).toBeNull();
      expect(row!.status).toBe('ocr_pending');
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, other!.id));
    }
  });
});
