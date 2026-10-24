import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { findInvoiceForJob, markOcrFailed } from '../jobs/ocrInvoice';

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

describe('findInvoiceForJob — enqueue/commit race', () => {
  it('finds an invoice whose inserting transaction commits while the job is already running', async () => {
    const writer = createDb(testDbUrl()); // the web request's connection
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let insertedId = '';
    const request = writer.transaction(async (tx) => {
      const [inv] = await tx
        .insert(invoices)
        .values({ restaurantId, supplierId, status: 'ocr_pending', source: 'photo', rawImageUrl: 'https://x/r.jpg' })
        .returning();
      insertedId = inv!.id;
      await held; // the job is enqueued here, before COMMIT
    });
    while (!insertedId) await new Promise((r) => setTimeout(r, 10));
    const lookup = findInvoiceForJob(db, restaurantId, insertedId, { waitMs: 3_000, stepMs: 50 });
    setTimeout(release, 300); // the request commits a moment later
    await request;
    expect(await lookup).toEqual({ id: insertedId, supplierId });
  });

  it('still refuses a job for another restaurant (after the short wait)', async () => {
    const id = await newInvoice();
    const t0 = Date.now();
    expect(await findInvoiceForJob(db, otherRestaurantId, id, { waitMs: 200, stepMs: 50 })).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
  });
});
