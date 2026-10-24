import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, suppliers, testDbUrl } from '@restomatch/db';
import { findJobInvoice, INVOICE_COMMIT_GRACE_MS } from '../jobs/findJobInvoice';

// receiving.registerInvoice enqueues the OCR job before its transaction commits
// the invoice row. A worker that read first refused the job ("not found") and
// the scan stayed "still reading" forever. The guard now re-reads briefly; a
// payload naming another restaurant's invoice is still refused.
const db = createDb(testDbUrl());
const restaurantIds: string[] = [];

async function cleanup() {
  for (const id of restaurantIds.splice(0)) {
    await db.delete(invoices).where(eq(invoices.restaurantId, id));
    await db.delete(suppliers).where(eq(suppliers.restaurantId, id));
    await db.delete(restaurants).where(eq(restaurants.id, id));
  }
}

async function newTenant(name: string) {
  const [r] = await db.insert(restaurants).values({ name }).returning();
  restaurantIds.push(r!.id);
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק' }).returning();
  return { restaurantId: r!.id, supplierId: s!.id };
}

function insertInvoice(t: { restaurantId: string; supplierId: string }, id?: string) {
  return db
    .insert(invoices)
    .values({
      ...(id ? { id } : {}),
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      status: 'ocr_pending',
      source: 'photo',
      rawImageUrl: 'https://x/a.jpg',
    })
    .returning();
}

beforeEach(cleanup);
afterAll(cleanup);

describe('findJobInvoice', () => {
  it('waits for a row that commits after the job starts', async () => {
    const t = await newTenant('commit race');
    const id = crypto.randomUUID();
    const late = new Promise((r) => setTimeout(r, 300)).then(() => insertInvoice(t, id));
    const found = await findJobInvoice(db, t.restaurantId, id);
    await late;
    expect(found).toEqual({ id, supplierId: t.supplierId });
  });

  it('waits for an UNCOMMITTED row on another connection (the real request transaction)', async () => {
    const t = await newTenant('open transaction');
    const writer = createDb(testDbUrl()); // the web request's own connection
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let id = '';
    const request = writer.transaction(async (tx) => {
      const [inv] = await tx
        .insert(invoices)
        .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'ocr_pending', source: 'photo', rawImageUrl: 'https://x/r.jpg' })
        .returning();
      id = inv!.id;
      await held; // registerInvoice has enqueued the job; COMMIT comes later
    });
    while (!id) await new Promise((r) => setTimeout(r, 10));
    // Invisible to the worker's connection while the transaction is open…
    const [early] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, id));
    expect(early).toBeUndefined();
    const lookup = findJobInvoice(db, t.restaurantId, id, [100, 200, 400, 800]);
    setTimeout(release, 300);
    await request;
    // …and found once it commits, within the backoff.
    expect(await lookup).toEqual({ id, supplierId: t.supplierId });
  });

  it("still refuses another restaurant's invoice", async () => {
    const a = await newTenant('tenant A');
    const b = await newTenant('tenant B');
    const [inv] = await insertInvoice(b);
    expect(await findJobInvoice(db, a.restaurantId, inv!.id, [5, 5])).toBeNull();
  });

  it('gives up after the backoff when the row never appears', async () => {
    const t = await newTenant('rolled back');
    const started = performance.now();
    expect(await findJobInvoice(db, t.restaurantId, crypto.randomUUID(), [20, 20])).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);
  });

  it('covers a slow commit by default (several seconds of grace)', () => {
    const total = INVOICE_COMMIT_GRACE_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(5_000);
    expect(total).toBeLessThanOrEqual(10_000);
  });
});
