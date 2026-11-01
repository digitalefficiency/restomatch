import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, auditLog, createDb, discrepancies, eq, goodsReceipts, invoiceLines, invoices, matchRuns, testDbUrl } from '@restomatch/db';
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

  it("item 4: an owner's re-scan of the receipt's OCR-read (matched) invoice is a RETAKE — same id, new photo, old read's runs + lines gone, read again", async () => {
    const before = await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, A.invoiceId));
    expect(before.length).toBeGreaterThan(0);
    const count = (await invoicesOf(A)).length;
    const r = await as(A, 'owner').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('3'), supplierId: A.supplierId });
    expect(r).toMatchObject({ invoiceId: A.invoiceId, alreadyExisted: false });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    expect(row!.status).toBe('ocr_pending');
    expect(row!.rawImageUrl).toBe(scan('3'));
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId))).toHaveLength(0);
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, A.invoiceId))).toHaveLength(0);
    expect(enqueueOcrInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: A.invoiceId, grId: A.grId }));
    expect((await invoicesOf(A)).length).toBe(count); // never a second invoice
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

  it('H-1: a follow-up delivery on a reopened partial receipt gets ITS OWN invoice (never swallowed into the first)', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    const d1 = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('d1'), supplierId: A.supplierId });
    await as(A, 'receiver').receiving.submitReceipt({ grId: A.grId }); // 5 of 10 → partial
    const [gr] = await db.select({ status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(gr!.status).toBe('partial');
    await new Promise((r) => setTimeout(r, 20)); // distinct timestamps
    await as(A, 'receiver').receiving.startReceipt({ poId: A.poId, reopen: true });
    const d2 = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('d2'), supplierId: A.supplierId });
    expect(d2.invoiceId).not.toBe(d1.invoiceId);
    expect(d2.alreadyExisted).toBe(false);
    const [row] = await db.select({ url: invoices.rawImageUrl }).from(invoices).where(eq(invoices.id, d2.invoiceId));
    expect(row!.url).toBe(scan('d2'));
    // …and a re-scan in THIS cycle resumes d2 (not d1).
    const again = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('d2b'), supplierId: A.supplierId });
    expect(again.invoiceId).toBe(d2.invoiceId);
  });

  it('a retake never resets an invoice a person built on (hand lines / typed header) — it resumes; a retake is audited', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    const first = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('r1'), supplierId: A.supplierId });
    const failedRaw = { provider: 'claude_vision' as const, raw: { ocrFailed: true, reason: 'extraction_failed', scanGrId: A.grId } };
    await db.update(invoices).set({ status: 'parsed', ocrPayload: failedRaw }).where(eq(invoices.id, first.invoiceId));
    // A hand line (the manualLines marker) → a re-scan resumes, never wipes it.
    const added = await as(A, 'owner').receiving.addInvoiceLine({
      invoiceId: first.invoiceId,
      line: { rawDescription: 'ידני', qtyBilled: 1, unit: 'kg', unitPriceBilled: 5 },
    });
    const r = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('r2'), supplierId: A.supplierId });
    expect(r).toEqual({ invoiceId: first.invoiceId, alreadyExisted: true, resumed: true });
    const [row] = await db.select({ url: invoices.rawImageUrl }).from(invoices).where(eq(invoices.id, first.invoiceId));
    expect(row!.url).toBe(scan('r1'));
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.id, added.lineId))).toHaveLength(1);

    // No person's work left (fresh failed read, no markers, no header audit) → a retake, audited.
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, first.invoiceId));
    await db.update(invoices).set({ status: 'parsed', ocrPayload: failedRaw }).where(eq(invoices.id, first.invoiceId));
    await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('r3'), supplierId: A.supplierId });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, first.invoiceId), eq(auditLog.action, 'receiving.invoice_retaken')));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ status: 'ocr_pending', rawImageUrl: scan('r3') });
  });

  it('item 11: a typed header (updateInvoiceHeader) makes a re-scan resume, never a reset', async () => {
    const before = await db.select({ status: invoices.status, url: invoices.rawImageUrl }).from(invoices).where(eq(invoices.id, A.invoiceId));
    await as(A, 'owner').receiving.updateInvoiceHeader({ invoiceId: A.invoiceId, patch: { invoiceNumber: 'INV-TYPED-1' } });
    const r = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('h1'), supplierId: A.supplierId });
    expect(r).toEqual({ invoiceId: A.invoiceId, alreadyExisted: true, resumed: true });
    const after = await db.select({ status: invoices.status, url: invoices.rawImageUrl }).from(invoices).where(eq(invoices.id, A.invoiceId));
    expect(after).toEqual(before);
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId))).not.toHaveLength(0);
    expect(enqueueOcrInvoice).not.toHaveBeenCalled();
  });
  it("round 3 A: a line a manager corrected with the pencil is never read away — even an owner's re-scan resumes", async () => {
    const [line] = await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, A.invoiceId)).limit(1);
    await as(A, 'manager').receiving.updateInvoiceLine({ lineId: line!.id, patch: { unitPriceBilled: 54 } });
    const r = await as(A, 'owner').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('pencil'), supplierId: A.supplierId });
    expect(r).toEqual({ invoiceId: A.invoiceId, alreadyExisted: true, resumed: true });
    const [kept] = await db.select({ price: invoiceLines.unitPriceBilled }).from(invoiceLines).where(eq(invoiceLines.id, line!.id));
    expect(Number(kept!.price)).toBe(54);
    expect(enqueueOcrInvoice).not.toHaveBeenCalled();
  });

  it("round 3 B: a RECEIVER's re-scan never erases a matched invoice's findings — it resumes, open receipt or closed", async () => {
    const findings = async () =>
      (await db.select({ id: discrepancies.id }).from(discrepancies).innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId)).where(eq(matchRuns.invoiceId, A.invoiceId))).length;
    const before = await findings();
    expect(before).toBeGreaterThan(0);
    for (const status of ['pending', 'completed'] as const) {
      await db.update(goodsReceipts).set({ status }).where(eq(goodsReceipts.id, A.grId));
      const r = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan(`rcv-${status}`), supplierId: A.supplierId });
      expect(r).toEqual({ invoiceId: A.invoiceId, alreadyExisted: true, resumed: true });
      expect(await findings()).toBe(before);
    }
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, A.invoiceId))).not.toHaveLength(0);
    expect(enqueueOcrInvoice).not.toHaveBeenCalled();
  });

  it('round 3 B: a receiver may still retake a never-matched scan while the receipt is being counted', async () => {
    await db.delete(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    const first = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('n1'), supplierId: A.supplierId });
    await db.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, first.invoiceId)); // the blurry read, held
    const again = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('n2'), supplierId: A.supplierId });
    expect(again).toMatchObject({ invoiceId: first.invoiceId, alreadyExisted: false });
    await db.update(invoices).set({ status: 'parsed' }).where(eq(invoices.id, first.invoiceId));
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, A.grId)); // after the count: no
    const late = await as(A, 'receiver').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('n3'), supplierId: A.supplierId });
    expect(late).toEqual({ invoiceId: first.invoiceId, alreadyExisted: true, resumed: true });
  });

  it("round 3 B: an owner's retake records the ₪ it dropped in its audit", async () => {
    const rows = await db
      .select({ delta: discrepancies.deltaAmount })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(eq(matchRuns.invoiceId, A.invoiceId));
    expect(rows.length).toBeGreaterThan(0);
    const leak = rows.reduce((t, r) => t + Math.round(Math.abs(Number(r.delta ?? 0)) * 100), 0);
    await as(A, 'owner').receiving.registerInvoice({ grId: A.grId, imageUrl: scan('own'), supplierId: A.supplierId });
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, A.invoiceId), eq(auditLog.action, 'receiving.invoice_retaken')));
    expect(audit!.before).toMatchObject({ droppedFindings: rows.length });
    expect(Math.round(Number((audit!.before as { droppedLeakIls: string }).droppedLeakIls) * 100)).toBe(leak);
  });
});
