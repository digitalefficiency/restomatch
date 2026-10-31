import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, createDb, eq, invoices, matchRuns, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

const enqueueOcrInvoice = vi.fn(async (_job: { invoiceId: string; grId?: string }) => true);
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueOcrInvoice: (job: { invoiceId: string; grId?: string }) => enqueueOcrInvoice(job),
}));

/**
 * B7 — one receipt, one invoice. Reopening a half-finished receipt and scanning
 * again registered a SECOND invoice on the same goods receipt (spend and leak
 * doubled; no UI could remove the copy). registerInvoice now resumes the
 * receipt's invoice; a deliberate second one needs additionalInvoice (owner /
 * manager only).
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const as = (t: Tenant, role: Session['role']) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const scan = (n: string) => `https://example.com/scans/${n}.jpg`;
const invoicesOf = (t: Tenant) => db.select().from(invoices).where(eq(invoices.restaurantId, t.restaurantId));

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'OA');
  B = await seedTenant(db, 'OB');
  enqueueOcrInvoice.mockClear();
});
afterAll(() => resetDb(db));

describe('registerInvoice — one receipt, one invoice', () => {
  it('a receipt with no invoice yet: the first scan creates it, stamped with the receipt; a second scan resumes it', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId)); // the receipt has no invoice
    const before = (await invoicesOf(A)).length;

    const first = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('1'), supplierId: A.supplierId });
    expect(first.alreadyExisted).toBe(false);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, first.invoiceId));
    expect((row!.ocrPayload?.raw as { scanGrId?: string }).scanGrId).toBe(A.grId);
    expect(enqueueOcrInvoice).toHaveBeenCalledTimes(1);

    // Reopen the half-finished receipt, photograph again (a new object).
    const second = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('2'), supplierId: A.supplierId });
    expect(second).toEqual({ invoiceId: first.invoiceId, alreadyExisted: true, resumed: true });
    expect((await invoicesOf(A)).length).toBe(before + 1);
    expect(enqueueOcrInvoice).toHaveBeenCalledTimes(1); // no second OCR job (no second spend)
  });

  it("a receipt whose invoice was already matched against it: a re-scan returns that invoice's id", async () => {
    const r = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('3'), supplierId: A.supplierId });
    expect(r).toEqual({ invoiceId: A.invoiceId, alreadyExisted: true, resumed: true });
    expect(enqueueOcrInvoice).not.toHaveBeenCalled();
  });

  it('the same object re-signed (a retry) is still idempotent', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    const a = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: `${scan('4')}?token=a`, supplierId: A.supplierId });
    const b = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: `${scan('4')}?token=b`, supplierId: A.supplierId });
    expect(b.invoiceId).toBe(a.invoiceId);
    expect(b.alreadyExisted).toBe(true);
  });

  it('additionalInvoice by a receiver is FORBIDDEN — nothing is created', async () => {
    const before = (await invoicesOf(A)).length;
    await expect(
      as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('5'), supplierId: A.supplierId, additionalInvoice: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await invoicesOf(A)).length).toBe(before);
    expect(enqueueOcrInvoice).not.toHaveBeenCalled();
  });

  it.each(['owner', 'manager'] as const)('additionalInvoice by an %s creates a second invoice on the receipt', async (role) => {
    const r = await as(A, role).receiving.registerInvoice({
      grId: A.grId,
      imageUrl: scan(`6-${role}`),
      supplierId: A.supplierId,
      additionalInvoice: true,
    });
    expect(r.alreadyExisted).toBe(false);
    expect(r.invoiceId).not.toBe(A.invoiceId);
    expect(enqueueOcrInvoice).toHaveBeenCalledTimes(1);
  });

  it('a first scan whose OCR failed (no lines): the re-scan is a retake — same invoice, new photo, read again', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    const first = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('7'), supplierId: A.supplierId });
    // OCR failed (terminal), the receipt stamp kept.
    await db
      .update(invoices)
      .set({ status: 'parsed', ocrConfidence: '0', ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed', scanGrId: A.grId } } })
      .where(eq(invoices.id, first.invoiceId));
    enqueueOcrInvoice.mockClear();

    const retake = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('8'), supplierId: A.supplierId });
    expect(retake.invoiceId).toBe(first.invoiceId);
    expect(retake.alreadyExisted).toBe(false);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, first.invoiceId));
    expect(row!.status).toBe('ocr_pending');
    expect(row!.rawImageUrl).toBe(scan('8'));
    expect(enqueueOcrInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: first.invoiceId, grId: A.grId }));
  });

  it("another tenant's receipt is NOT_FOUND — never resumes or reveals its invoice", async () => {
    await expect(
      as(A, 'owner').receiving.registerInvoice({ grId: B.grId, imageUrl: scan('9'), supplierId: A.supplierId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [bInv] = await db.select().from(invoices).where(and(eq(invoices.restaurantId, A.restaurantId), eq(invoices.id, B.invoiceId)));
    expect(bInv).toBeUndefined();
  });
});
