import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { markOcrFailed } from '../jobs/ocrInvoice';

// EN-3: a failed OCR must leave the invoice in a terminal, reviewable state —
// never 'ocr_pending' forever — and must not write any ₪ lines.
const db = createDb(testDbUrl());
let restaurantId = '';
let otherRestaurantId = '';
let supplierId = '';

async function cleanup() {
  for (const id of [restaurantId, otherRestaurantId].filter(Boolean)) {
    await db.delete(invoices).where(eq(invoices.restaurantId, id));
    await db.delete(suppliers).where(eq(suppliers.restaurantId, id));
    await db.delete(restaurants).where(eq(restaurants.id, id));
  }
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'OCR fail test' }).returning();
  const [o] = await db.insert(restaurants).values({ name: 'Other tenant' }).returning();
  restaurantId = r!.id;
  otherRestaurantId = o!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ספק' }).returning();
  supplierId = s!.id;
});

afterAll(cleanup);

async function newInvoice(status: 'ocr_pending' | 'matched' = 'ocr_pending') {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId, supplierId, status, source: 'photo', rawImageUrl: 'https://x/a.jpg' })
    .returning();
  return inv!.id;
}

describe('markOcrFailed (EN-3)', () => {
  it('moves an ocr_pending invoice to a terminal reviewable state with a failure marker', async () => {
    const id = await newInvoice();
    await markOcrFailed(db, restaurantId, id, new Error('ZodError: invalid'));
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(row!.status).toBe('parsed');
    expect(Number(row!.ocrConfidence)).toBe(0);
    expect(row!.ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'extraction_failed' });
  });

  it('records quota exhaustion as its own reason', async () => {
    const id = await newInvoice();
    const err = Object.assign(new Error('over cap'), { name: 'QuotaExceededError' });
    await markOcrFailed(db, restaurantId, id, err);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(row!.ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'quota_exceeded' });
  });

  it('merges into the raw already on the row: scanGrId (and other stamped keys) survive a failed read', async () => {
    const id = await newInvoice();
    const scanGrId = crypto.randomUUID();
    await db
      .update(invoices)
      .set({ ocrPayload: { provider: 'claude_vision', raw: { scanGrId, heldForReceipts: [scanGrId], ocrFailed: false } } })
      .where(eq(invoices.id, id));
    await markOcrFailed(db, restaurantId, id, new Error('ZodError: invalid'));
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(row!.status).toBe('parsed');
    expect(row!.ocrPayload?.provider).toBe('claude_vision');
    expect(row!.ocrPayload?.reconciledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row!.ocrPayload?.raw).toEqual({ scanGrId, heldForReceipts: [scanGrId], ocrFailed: true, reason: 'extraction_failed' });
  });

  it('a non-object raw on the row is replaced, never merged into', async () => {
    const id = await newInvoice();
    await db.update(invoices).set({ ocrPayload: { provider: 'claude_vision', raw: 'garbage' } }).where(eq(invoices.id, id));
    await markOcrFailed(db, restaurantId, id, null, 'ocr_disabled');
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(row!.ocrPayload?.raw).toEqual({ ocrFailed: true, reason: 'ocr_disabled' });
  });

  it('never touches an invoice that already left ocr_pending, or another tenant', async () => {
    const done = await newInvoice('matched');
    await markOcrFailed(db, restaurantId, done, new Error('late'));
    const pending = await newInvoice();
    await markOcrFailed(db, otherRestaurantId, pending, new Error('wrong tenant'));
    const rows = await db.select().from(invoices).where(eq(invoices.restaurantId, restaurantId));
    expect(rows.find((r) => r.id === done)!.status).toBe('matched');
    expect(rows.find((r) => r.id === pending)!.status).toBe('ocr_pending');
  });
});
