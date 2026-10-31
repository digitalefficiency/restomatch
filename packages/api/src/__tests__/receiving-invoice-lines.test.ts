import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, invoiceLines, invoices, matchRuns, restaurants, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * B8 — when OCR fails the invoice page says "הזינו את השורות ידנית": the manager
 * adds / deletes lines by hand. The header totals follow the lines to the agora
 * (integer agorot, NUMERIC strings in the DB), the invoice is re-matched, and
 * every invoice edit leaves one audit row with before / after.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let failedId: string;

const as = (role: Session['role']) =>
  appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role } } as AppContext);
const audits = (action: string) => db.select().from(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, action)));
const header = async (id: string) =>
  (await db.select({ excl: invoices.totalExclVat, vat: invoices.vatAmount, incl: invoices.totalInclVat }).from(invoices).where(eq(invoices.id, id)))[0]!;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'ML');
  await db.update(restaurants).set({ vatRate: '0.18' }).where(eq(restaurants.id, A.restaurantId));
  // A scan the OCR could not read: 'parsed', confidence 0, no lines, no totals.
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      status: 'parsed',
      source: 'photo',
      rawImageUrl: 'https://example.com/failed.jpg',
      ocrConfidence: '0',
      ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed' } },
    })
    .returning();
  failedId = inv!.id;
});
afterAll(() => resetDb(db));

describe('manual invoice lines (B8)', () => {
  it('adding lines recomputes the header to the agora and re-matches the invoice', async () => {
    // 2.5 × 12.345 = 30.8625 → 30.86 (half-up); 3 × 9.99 = 29.97.
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 2.5, unit: 'kg', unitPriceBilled: 12.345, productId: A.productId },
    });
    expect(a.totals).toEqual({ totalExclVat: '30.86', vatAmount: '5.55', totalInclVat: '36.41' }); // 30.86 × 18% = 5.5548
    expect(a.rematched).toBe(true);
    const [line] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, a.lineId));
    expect(line).toMatchObject({ qtyBilled: '2.500', unitPriceBilled: '12.3450', lineTotal: '30.86' });

    const b = await as('owner').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'מלפפונים', qtyBilled: 3, unit: 'kg', unitPriceBilled: 9.99 },
    });
    // 60.83 × 18% = 10.9494 → 10.95.
    expect(b.totals).toEqual({ totalExclVat: '60.83', vatAmount: '10.95', totalInclVat: '71.78' });
    expect(await header(failedId)).toEqual({ excl: '60.83', vat: '10.95', incl: '71.78' });
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, failedId))).toHaveLength(1);
  });

  it('deleting a line recomputes the totals and re-matches', async () => {
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 2, unit: 'kg', unitPriceBilled: 10 },
    });
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'בצל', qtyBilled: 1, unit: 'kg', unitPriceBilled: 5.5 },
    });
    const [runBefore] = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, failedId));
    const del = await as('manager').receiving.deleteInvoiceLine({ lineId: a.lineId });
    expect(del.totals).toEqual({ totalExclVat: '5.50', vatAmount: '0.99', totalInclVat: '6.49' });
    expect(del.rematched).toBe(true);
    const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, failedId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).not.toBe(runBefore!.id); // a fresh run
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.id, a.lineId))).toHaveLength(0);
  });

  it('the supplier VAT rate wins over the restaurant default', async () => {
    const { suppliers } = await import('@restomatch/db');
    await db.update(suppliers).set({ vatRate: '0' }).where(eq(suppliers.id, A.supplierId)); // e.g. VAT-exempt produce
    const a = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'פירות', qtyBilled: 1, unit: 'kg', unitPriceBilled: 7.3 },
    });
    expect(a.totals).toEqual({ totalExclVat: '7.30', vatAmount: '0.00', totalInclVat: '7.30' });
  });

  it('a receiver cannot add or delete lines (no ₪ for the receiver)', async () => {
    await expect(
      as('receiver').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as('receiver').receiving.deleteInvoiceLine({ lineId: A.invoiceLineId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a read invoice (matched) is corrected with updateInvoiceLine, not by adding/deleting lines', async () => {
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: A.invoiceId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(as('manager').receiving.deleteInvoiceLine({ lineId: A.invoiceLineId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, A.invoiceId))).toHaveLength(1);
  });

  it('each of the four invoice edits writes ONE audit row with before and after', async () => {
    const added = await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 2, unit: 'kg', unitPriceBilled: 10 },
    });
    await as('manager').receiving.updateInvoiceLine({ lineId: added.lineId, patch: { unitPriceBilled: 11 } });
    await as('manager').receiving.updateInvoiceHeader({ invoiceId: failedId, patch: { invoiceNumber: 'MAN-1' } });
    await as('manager').receiving.deleteInvoiceLine({ lineId: added.lineId });

    const [add] = await audits('receiving.invoice_line_added');
    expect(add).toMatchObject({ entityType: 'invoice_line', entityId: added.lineId, userId: A.ownerUserId });
    expect(add!.before).toEqual({ invoiceId: failedId, totals: { totalExclVat: null, vatAmount: null, totalInclVat: null } });
    expect(add!.after).toMatchObject({ invoiceId: failedId, line: { lineTotal: '20.00' }, totals: { totalExclVat: '20.00' } });

    const [upd] = await audits('receiving.invoice_line_updated');
    expect(upd!.before).toEqual({ invoiceId: failedId, unitPriceBilled: '10.0000' });
    expect(upd!.after).toEqual({ invoiceId: failedId, unitPriceBilled: '11' });

    const [hdr] = await audits('receiving.invoice_header_updated');
    expect(hdr).toMatchObject({ entityType: 'invoice', entityId: failedId });
    expect(hdr!.before).toEqual({ invoiceNumber: null });
    expect(hdr!.after).toEqual({ invoiceNumber: 'MAN-1' });

    const [del] = await audits('receiving.invoice_line_deleted');
    expect(del!.before).toMatchObject({ invoiceId: failedId, line: { rawDescription: 'עגבניות' } });
    expect(del!.after).toEqual({ invoiceId: failedId, totals: { totalExclVat: '0.00', vatAmount: '0.00', totalInclVat: '0.00' } });

    for (const a of ['receiving.invoice_line_added', 'receiving.invoice_line_updated', 'receiving.invoice_header_updated', 'receiving.invoice_line_deleted']) {
      expect(await audits(a)).toHaveLength(1);
    }
  });

  it('a held-for-review read stays editable line by line after the re-match; an approved invoice is locked', async () => {
    await db.update(invoices).set({ ocrPayload: { provider: 'reconciled', raw: { confidence: 0.4 } } }).where(eq(invoices.id, failedId));
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'עגבניות', qtyBilled: 1, unit: 'kg', unitPriceBilled: 4 },
    });
    const [after] = await db.select({ status: invoices.status, raw: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, failedId));
    expect(after!.status).not.toBe('parsed'); // re-matched
    expect(after!.raw?.raw).toMatchObject({ confidence: 0.4, manualLines: true }); // the read kept, the marker added
    await as('manager').receiving.addInvoiceLine({
      invoiceId: failedId,
      line: { rawDescription: 'בצל', qtyBilled: 1, unit: 'kg', unitPriceBilled: 2 },
    });
    expect((await header(failedId)).excl).toBe('6.00');

    await db.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, failedId));
    await expect(
      as('manager').receiving.addInvoiceLine({ invoiceId: failedId, line: { rawDescription: 'x', qtyBilled: 1, unit: 'kg', unitPriceBilled: 1 } }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((await header(failedId)).excl).toBe('6.00');
  });

  it('getInvoice tells the page whether lines can be added by hand (one rule with the API)', async () => {
    expect((await as('manager').receiving.getInvoice({ invoiceId: failedId })).linesEditable).toBe(true);
    expect((await as('manager').receiving.getInvoice({ invoiceId: A.invoiceId })).linesEditable).toBe(false); // read + matched
  });
});
