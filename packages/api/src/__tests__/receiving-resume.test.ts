import { createDb, goodsReceipts, memberships, poLines, purchaseOrders, sql, testDbUrl, users, eq } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '../index';
import type { Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-05 slice B · receiving-02: a reload, or ANOTHER phone, resumes the same
 * receipt and the same invoice from the server — no re-shoot, no second OCR job.
 */
const db = createDb(testDbUrl());
let a: Tenant;
let b: Tenant;
let receiverA: string;
let receiverA2: string;

const as = (s: Session) => appRouter.createCaller({ db, session: s });
const recv = (userId: string, t: Tenant = a): Session => ({ userId, restaurantId: t.restaurantId, role: 'receiver' });

async function receiver(t: Tenant, tag: string): Promise<string> {
  const [u] = await db.insert(users).values({ email: `rcv-${tag}@resume.test`, name: `Receiver ${tag}` }).returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: t.restaurantId, role: 'receiver' });
  return u!.id;
}

async function freshPo(t: Tenant): Promise<string> {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning();
  await db.insert(poLines).values({ poId: po!.id, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '8' });
  return po!.id;
}

async function ocrJobs(invoiceId: string): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT 1 FROM job_queue WHERE queue = 'ocr-invoice' AND payload->>'invoiceId' = ${invoiceId}`,
  )) as unknown as unknown[];
  return rows.length;
}

beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`DELETE FROM job_queue`);
  a = await seedTenant(db, 'resume-a');
  b = await seedTenant(db, 'resume-b');
  receiverA = await receiver(a, 'a1');
  receiverA2 = await receiver(a, 'a2');
});
afterAll(async () => {
  await resetDb(db);
});

describe('receiving.resumeState', () => {
  it('no receipt yet: nothing to resume', async () => {
    const poId = await freshPo(a);
    expect(await as(recv(receiverA)).receiving.resumeState({ poId })).toEqual({
      grId: null,
      status: null,
      version: null,
      marks: [],
      invoice: null,
    });
  });

  it('after a reload, or on another phone: the same receipt, marks and invoice — and 0 new OCR jobs', async () => {
    const poId = await freshPo(a);
    const phone1 = as(recv(receiverA));
    const { receiptId } = await phone1.receiving.startReceipt({ poId });
    const reg = await phone1.receiving.registerInvoice({
      grId: receiptId,
      imageUrl: 'https://example.com/resume-invoice.jpg',
      supplierId: a.supplierId,
    });
    const jobsBefore = await ocrJobs(reg.invoiceId);
    const receipt = await phone1.receiving.getReceipt({ grId: receiptId });
    await phone1.receiving.markGrLine({ grLineId: receipt.lines[0]!.grLineId, qtyReceived: 8, qtyRejected: 0 });

    // A colleague's phone (no local draft at all) asks the server.
    const r = await as(recv(receiverA2)).receiving.resumeState({ poId });
    expect(r.grId).toBe(receiptId);
    expect(r.status).toBe('pending');
    expect(r.invoice).toEqual({ invoiceId: reg.invoiceId, status: 'ocr_pending' });
    expect(r.marks.map((m) => Number(m.qtyReceived))).toEqual([8]);
    // Resuming is a read: no second invoice, no second OCR job.
    expect(await ocrJobs(reg.invoiceId)).toBe(jobsBefore);
    // No ₪ for the receiver: quantities and states only.
    expect(JSON.stringify(r)).not.toMatch(/price|total|amount|₪/i);
  });

  it('a retried registration of the same scan links once and resumes the same invoice', async () => {
    const poId = await freshPo(a);
    const c = as(recv(receiverA));
    const { receiptId } = await c.receiving.startReceipt({ poId });
    const input = { grId: receiptId, imageUrl: 'https://example.com/twice.jpg', supplierId: a.supplierId };
    const one = await c.receiving.registerInvoice(input);
    const two = await c.receiving.registerInvoice({ ...input, imageUrl: `${input.imageUrl}?token=resigned` });
    expect(two.invoiceId).toBe(one.invoiceId);
    const links = (await db.execute(
      sql`SELECT 1 FROM audit_log WHERE action = 'goods_receipt.invoice_registered' AND entity_id = ${receiptId}`,
    )) as unknown as unknown[];
    expect(links).toHaveLength(1);
    expect((await c.receiving.resumeState({ poId })).invoice?.invoiceId).toBe(one.invoiceId);
  });

  it('an invoice read before the receipt was closed and reopened is not resumed into the new cycle', async () => {
    const poId = await freshPo(a);
    const c = as(recv(receiverA));
    const { receiptId } = await c.receiving.startReceipt({ poId });
    await c.receiving.registerInvoice({ grId: receiptId, imageUrl: 'https://example.com/old-cycle.jpg', supplierId: a.supplierId });
    // Closed elsewhere, then reopened for a follow-up delivery: a new open/close cycle.
    await db.update(goodsReceipts).set({ status: 'pending', updatedAt: new Date(Date.now() + 5_000) }).where(eq(goodsReceipts.id, receiptId));
    expect((await c.receiving.resumeState({ poId })).invoice).toBeNull();
  });

  it("another restaurant's PO is NOT_FOUND (attack)", async () => {
    const poId = await freshPo(a);
    await as(recv(receiverA)).receiving.startReceipt({ poId });
    await expect(
      as({ userId: b.ownerUserId, restaurantId: b.restaurantId, role: 'owner' }).receiving.resumeState({ poId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
